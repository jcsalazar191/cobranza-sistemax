import { Router } from 'express';
import { getEvolutionCreds, enviarTexto } from '../evolution.js';
import { guardarMensaje, guardarLead } from '../leadsStore.js';
import { setQr } from '../qrStore.js';
import { memoriaAlDia } from '../memoria.js';
import { procesarMedia } from '../media.js';
import { sugerirRespuesta } from '../sysfarma.js';
import { query } from '../db.js';
import { jidToPhone, resolverTelefono } from '../jid.js';

export const waWebhookRouter = Router();

// Descarga el media, lo guarda y saca su contenido en texto (transcripcion de
// audio, descripcion de imagen, texto de PDF). Luego actualiza el mensaje y la
// ficha del lead, para que la IA "vea" lo que el cliente mando.
async function procesarMediaMensaje({ waId, leadId, esPosible }) {
  const r = await procesarMedia(waId);
  // tipo = r.tipo (NO COALESCE con el que ya habia): el del webhook es solo
  // una suposicion rapida ("documentMessage" = 'pdf' aunque sea .docx); este
  // es el real, sacado del mimetype ya descargado.
  await query(
    `UPDATE lead_mensajes SET media_archivo = $1, media_mime = $2, media_nombre = $3,
            media_texto = $4, tipo = $5
     WHERE wa_id = $6`,
    [r.archivo, r.mimetype, r.fileName || null, r.texto || null, r.tipo, waId],
  );
  // `procesarMedia` no interpreta el archivo; este bloque queda inactivo y se
  // conserva compatible si en el futuro se decide guardar texto manualmente.
  if (r.texto) {
    await query(
      "UPDATE lead_mensajes SET cuerpo = cuerpo || ' — ' || $1 WHERE wa_id = $2 AND position($1 in cuerpo) = 0",
      [r.texto.slice(0, 500), waId],
    );
  }
  // La ficha (IA) solo se construye para "posible" -- un chat sin_clasificar
  // o conocido nunca debe entrar al copiloto/IA, aunque mande media real.
  if (leadId && esPosible) await memoriaAlDia(leadId).catch(() => {});
}

// AUTO-RESPUESTA en el PRIMER CONTACTO: cuando un numero escribe por primera
// vez (nunca antes en la conversacion), se le responde solo con la apertura de
// siempre (info de SysFarma, pide nombre y ciudad) -- es exactamente lo que
// Jean escribe a mano cada vez, sin comprometer nada (sin precios negociados,
// sin contrato). Los mensajes siguientes SIEMPRE pasan por el copiloto manual
// (sugerir + Jean aprueba). Delay aleatorio 3-8s para no responder al instante
// (patron de bot detectable -> riesgo de baneo, ver investigacion).
async function autoResponderPrimerContacto({ leadId, telefono, cuerpo }) {
  const { rows: cfg } = await query("SELECT valor FROM config WHERE clave = 'auto_primer_contacto'");
  if (cfg[0]?.valor === 'false') return; // toggle apagado

  await new Promise((r) => { setTimeout(r, 3000 + Math.random() * 5000); });

  const { rows: leadRows } = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
  const lead = leadRows[0];
  if (!lead) return;

  const mensajes = [{ direccion: 'in', cuerpo, fecha: new Date() }];
  const texto = await sugerirRespuesta({ lead, mensajes, memoria: null });

  const resp = await enviarTexto(telefono, texto);
  const waId = resp?.key?.id ? String(resp.key.id) : null;
  await guardarMensaje({ telefono, cuerpo: texto, direccion: 'out', waId, automatico: true });
  await memoriaAlDia(leadId).catch(() => {});
}

const nombreDe = (e) => e?.pushName || e?.name || e?.notify || e?.verifiedName || null;

// Un simple "hola" no dice nada de si preguntan por SysFarma -- puede ser
// numero equivocado, un conocido, spam. Mandar la apertura completa de venta
// ahi se ve mal (paso real: alguien puso "hola" y le llego el discurso
// entero). Ahora se exige señal REAL de interes en el negocio (no solo "no
// es un saludo vacio") -- si no menciona nada de esto, se deja para que Jean
// lo vea y decida el, como cualquier mensaje ambiguo del copiloto manual.
const PALABRAS_NEGOCIO = /sysfarma|botica|farmacia|boticario|drogueria|sistema|software|demo|cotiza|precio/i;
function pareceInteresNegocio(texto) {
  // Quita tildes sin depender de rangos Unicode en el codigo fuente (evita
  // que un guardado/copiado pierda bytes, como paso antes con \w en la regex
  // de /media/:archivo).
  const limpio = String(texto || '').toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u');
  return PALABRAS_NEGOCIO.test(limpio);
}

// POST /api/wa/:token  (PUBLICO: Evolution/proxy no manda cookie; se valida con
// el token del path). Captura la conversacion y, en la sincronizacion inicial,
// los contactos/chats existentes (los "posibles"). NO responde automatico.
waWebhookRouter.post('/:token', async (req, res) => {
  try {
    const creds = await getEvolutionCreds();
    if (!creds.webhookToken || req.params.token !== creds.webhookToken) {
      return res.status(401).json({ ok: false });
    }

    const body = req.body || {};
    const evento = String(body.event || body.eventName || '').toLowerCase().replace(/_/g, '.');
    const data = body.data;

    // Diagnostico: ver que eventos llegan (temporal).
    console.log('[wa-webhook] event=', evento, 'dataType=', Array.isArray(data) ? `array(${data.length})` : typeof data);

    // --- QR para vincular (Evolution lo manda por este evento, no por /connect) ---
    if (evento === 'qrcode.updated') {
      const b64 = data?.qrcode?.base64 || data?.base64 || (typeof data?.qrcode === 'string' ? data.qrcode : null);
      if (b64) setQr(b64);
      console.log('[wa-webhook] qrcode.updated guardado=', !!b64);
      return res.json({ ok: true });
    }

    // --- Llamada (entrante o saliente): en WhatsApp real una llamada sube el
    // chat al tope de la lista aunque no haya texto -- aca solo se refleja eso
    // (se actualiza ultimo_contacto de un lead YA existente), no se arma un
    // registro de llamadas nuevo (eso quedo como extraccion manual, una vez).
    if (evento === 'call') {
      const entradas = Array.isArray(data) ? data : (data ? [data] : []);
      for (const e of entradas) {
        const jid = e?.from || e?.chatId || e?.peerJid;
        const tel = await resolverTelefono(jid, e?.fromAlt);
        if (!tel) continue;
        await query("UPDATE leads SET ultimo_contacto = now() WHERE telefono = $1 AND categoria <> 'conocido'", [tel]).catch(() => {});
      }
      return res.json({ ok: true });
    }

    // --- Contactos / chats (sincronizacion): crea un lead por cada uno ---
    if (['contacts.upsert', 'contacts.update', 'contacts.set', 'chats.upsert', 'chats.set'].includes(evento)) {
      const entradas = Array.isArray(data) ? data : (data ? [data] : []);
      let n = 0;
      for (const e of entradas) {
        const jid = e?.id || e?.remoteJid || e?.jid;
        const tel = await resolverTelefono(jid, e?.remoteJidAlt || e?.senderPn);
        if (!tel) continue;
        try { await guardarLead({ telefono: tel, nombre: nombreDe(e), foto: e?.profilePicUrl || null }); n += 1; } catch { /* dup */ }
      }
      console.log(`[wa-webhook] ${evento}: ${n} leads`);
      return res.json({ ok: true, leads: n });
    }

    // --- Historial de mensajes (sincronizacion) ---
    if (evento === 'messaging.history.set' || evento === 'messaging-history.set') {
      const chats = Array.isArray(data?.chats) ? data.chats : [];
      const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
      let n = 0;
      for (const e of [...chats, ...contacts]) {
        const jid = e?.id || e?.jid;
        const tel = await resolverTelefono(jid, e?.remoteJidAlt || e?.senderPn);
        if (!tel) continue;
        try { await guardarLead({ telefono: tel, nombre: nombreDe(e), foto: e?.profilePicUrl || null }); n += 1; } catch { /* dup */ }
      }
      console.log(`[wa-webhook] history.set: ${n} leads`);
      return res.json({ ok: true, leads: n });
    }

    // --- Mensaje individual (entrante o tu respuesta) ---
    if (evento && evento !== 'messages.upsert') {
      return res.json({ ok: true, ignored: evento });
    }

    const remoteJid = String(data?.key?.remoteJid || '');
    const remoteJidAlt = data?.key?.remoteJidAlt || data?.senderPn || null;
    const fromMe = Boolean(data?.key?.fromMe);
    const waId = data?.key?.id ? String(data.key.id) : null;
    const msg = data?.message || {};

    const telefono = await resolverTelefono(remoteJid, remoteJidAlt);
    if (!telefono && remoteJid.endsWith('@lid')) {
      console.log('[wa-webhook] lid sin resolver:', remoteJid, '- mensaje perdido, falta mapear (sincronizar etiquetas)');
    }
    if (!telefono || !waId) return res.json({ ok: true, ignored: 'filtered' });

    // Si ya esta marcado "conocido" (amigo/cliente actual, confirmado a mano
    // en el buzon), su conversacion NUNCA se guarda ni pasa por la IA -- es la
    // regla explicita del dueño: solo "posible" entra al copiloto.
    const { rows: existeRows } = await query('SELECT categoria FROM leads WHERE telefono = $1', [telefono]);
    if (existeRows[0]?.categoria === 'conocido') return res.json({ ok: true, ignored: 'conocido' });

    // Texto plano, o un MEDIA (foto/pdf/audio/video). Antes se descartaba todo
    // lo que no fuera texto y por eso las fotos y PDF nunca llegaban.
    const texto = msg.conversation ?? msg.extendedTextMessage?.text;
    const media = msg.imageMessage ? { clave: 'imagenMessage', m: msg.imageMessage, tipo: 'imagen', etiqueta: '📷 Foto' }
      : msg.documentMessage ? { m: msg.documentMessage, tipo: 'archivo', etiqueta: '📄 Documento' }
        : msg.audioMessage ? { m: msg.audioMessage, tipo: 'audio', etiqueta: '🎤 Nota de voz' }
          : msg.videoMessage ? { m: msg.videoMessage, tipo: 'video', etiqueta: '🎥 Video' }
            : null;

    let cuerpo;
    if (typeof texto === 'string' && texto.trim() !== '') cuerpo = texto.trim();
    else if (media) {
      const cap = String(media.m?.caption || '').trim();
      const nom = String(media.m?.fileName || '').trim();
      cuerpo = [media.etiqueta, nom || cap].filter(Boolean).join(': ');
    } else {
      return res.json({ ok: true, ignored: 'sin_contenido' });
    }

    const pushName = typeof data?.pushName === 'string' && data.pushName.trim() !== '' ? data.pushName.trim() : null;
    const { leadId, nuevo: esNuevo, primerContacto } = await guardarMensaje({
      telefono,
      cuerpo,
      direccion: fromMe ? 'out' : 'in',
      waId,
      pushName: fromMe ? null : pushName,
      tipo: media ? media.tipo : 'texto',
      mediaNombre: media ? (media.m?.fileName || null) : null,
    });

    // "posible" es lo unico que puede entrar al copiloto/IA (ficha, score,
    // auto-respuesta) -- sin_clasificar/conocido solo guardan el mensaje.
    const esPosible = esNuevo
      ? (await query('SELECT categoria FROM leads WHERE id = $1', [leadId])).rows[0]?.categoria === 'posible'
      : false;

    // El media se descarga y se "lee" (transcribe/describe/extrae) aparte: el
    // webhook tiene que ackear rapido. Esto SI pasa siempre (se guarda el
    // archivo real independiente de la categoria), solo la ficha se gatea adentro.
    if (esNuevo && media && leadId) {
      procesarMediaMensaje({ waId, leadId, esPosible }).catch((e) => console.error('[media]', e?.message || e));
    }

    // Primer mensaje ALGUNA VEZ de este numero, en texto plano (no solo una
    // foto/pdf/audio): se responde solo con la apertura de siempre. Cualquier
    // mensaje despues de este pasa por el copiloto manual, nunca automatico.
    if (esNuevo && !fromMe && !media && primerContacto && leadId && pareceInteresNegocio(cuerpo)) {
      autoResponderPrimerContacto({ leadId, telefono, cuerpo }).catch((e) => console.error('[auto-primer-contacto]', e?.message || e));
    } else if (esNuevo && leadId && esPosible) {
      // Mantiene la FICHA del lead al dia con cada mensaje (incremental). Si
      // hubo auto-respuesta, ya la actualiza autoResponderPrimerContacto.
      memoriaAlDia(leadId).catch((e) => console.error('[memoria]', e?.message || e));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[wa-webhook]', err?.message || err);
    res.json({ ok: true, error: true });
  }
});
