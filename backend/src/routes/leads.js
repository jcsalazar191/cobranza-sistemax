import { Router } from 'express';
import { query } from '../db.js';
import {
  enviarTexto, enviarMedia, normalizarTelefono, estadoConexion, obtenerQr, crearInstancia,
  listarChats, listarContactos, listarMensajes,
} from '../evolution.js';
import { generarCotizacion } from '../cotizacion.js';
import { guardarMensaje, marcarCategoria, textoDeMensaje } from '../leadsStore.js';
import { sugerirRespuesta } from '../sysfarma.js';
import { memoriaAlDia } from '../memoria.js';
import { registrarSugerencia, registrarEnvio, registrarResultado, ejemplosDeJean, ejemplosATexto, estadisticas } from '../aprendizaje.js';
import { MEDIA_DIR } from '../media.js';
import { colaDeSeguimientos } from '../seguimientos.js';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { jidToPhone } from '../jid.js';
import { descargarMedia } from '../media.js';

export const leadsRouter = Router();

const ESTADOS = ['nuevo', 'contactado', 'atendido', 'convertido', 'descartado'];

// :id numerico (evita 500 por tipo en Postgres). No aplica a rutas estaticas.
leadsRouter.param('id', (req, res, next, val) => {
  if (!/^\d+$/.test(val)) return res.status(404).json({ error: 'Lead no encontrado.' });
  next();
});

// GET /api/leads/estado-wa -> estado de conexion del WhatsApp (Evolution).
leadsRouter.get('/estado-wa', async (req, res, next) => {
  try {
    const estado = await estadoConexion();
    // Ultimo mensaje ENTRANTE recibido: si esto se queda "viejo" con WhatsApp
    // "conectado", es la señal de un corte silencioso (como el que paso con
    // el reset de la instancia -- se ve aca en vez de enterarse dias despues).
    const { rows } = await query("SELECT MAX(fecha) AS ultimo FROM lead_mensajes WHERE direccion = 'in'");
    res.json({ ...estado, ultimo_mensaje_recibido: rows[0]?.ultimo || null });
  } catch (err) { next(err); }
});

// GET /api/leads/qr -> QR (base64) para vincular el WhatsApp.
leadsRouter.get('/qr', async (req, res, next) => {
  try { res.json({ qr: await obtenerQr() }); } catch (err) { next(err); }
});

// POST /api/leads/conectar -> crea la instancia y apunta su webhook a cobranza.
leadsRouter.post('/conectar', async (req, res, next) => {
  try {
    const base = process.env.PUBLIC_BASE_URL || 'https://cobranza.sysfarma.pe';
    await crearInstancia(base);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/leads/importar-wa -> trae TODOS los chats/contactos del WhatsApp
// vinculado como leads "por clasificar" -- SOLO nombre/telefono, SIN traer su
// historial de mensajes (eso solo pasa cuando el dueño confirma "Posible" en
// /por-clasificar). Amigos y clientes actuales tambien quedan aca sin tocar,
// como "sin_clasificar", hasta que el dueño los marque uno por uno (nunca
// entran solos al copiloto/IA). Los que ya eran leads solo se refrescan de
// nombre. Los @lid sin telefono conocido (sin etiqueta "Posible" resincronizada)
// se saltan -- no hay como identificarlos sin numero real.
leadsRouter.post('/importar-wa', async (req, res, next) => {
  try {
    const items = [];
    try { const chats = await listarChats(); if (Array.isArray(chats)) items.push(...chats); } catch { /* ignore */ }
    try { const cont = await listarContactos(); if (Array.isArray(cont)) items.push(...cont); } catch { /* ignore */ }

    const { rows: existentes } = await query('SELECT telefono, lid FROM leads');
    const porTelefono = new Set(existentes.map((r) => r.telefono));
    const porLid = new Map(existentes.filter((r) => r.lid).map((r) => [r.lid, r.telefono]));

    const vistos = new Set();
    let nuevos = 0;
    let actualizados = 0;
    // Los CHATS van primero en `items` (arriba) y traen `updatedAt` +
    // `lastMessage` real (fecha y contenido de la ultima conversacion) --
    // los CONTACTOS son solo la libreta (sin actividad), por eso quedan de
    // relleno y NUNCA pisan la fecha/snippet real de un chat.
    for (const e of items) {
      const jid = String(e?.remoteJid || e?.id || e?.jid || '');
      if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.includes('status')) continue;

      let tel = null;
      let lid = null;
      if (jid.endsWith('@lid')) { tel = porLid.get(jid) || null; lid = jid; }
      else { tel = jidToPhone(jid) || null; }
      if (!tel || vistos.has(tel)) continue;
      vistos.add(tel);

      const nombre = e?.pushName || e?.name || e?.notify || e?.verifiedName || null;
      const foto = e?.profilePicUrl || null;
      const ultimoContacto = e?.lastMessage && e?.updatedAt ? new Date(e.updatedAt) : null;
      const ultimoMensaje = e?.lastMessage ? textoDeMensaje(e.lastMessage) : null;

      if (porTelefono.has(tel)) {
        if (nombre || foto) {
          await query(
            'UPDATE leads SET nombre = COALESCE(nombre, $2), foto_url = COALESCE($3, foto_url) WHERE telefono = $1',
            [tel, nombre, foto],
          );
          actualizados += 1;
        }
      } else {
        await query(
          `INSERT INTO leads (telefono, nombre, lid, estado, categoria, ultimo_contacto, ultimo_mensaje, foto_url)
           VALUES ($1, $2, $3, 'nuevo', 'sin_clasificar', $4, $5, $6)
           ON CONFLICT (telefono) DO NOTHING`,
          [tel, nombre, lid, ultimoContacto, ultimoMensaje, foto],
        );
        nuevos += 1;
      }
    }
    res.json({ ok: true, nuevos, actualizados });
  } catch (err) { next(err); }
});

// GET /api/leads/todos -> TODOS los chats, cualquier categoria, tal cual se
// ve en WhatsApp (sin filtrar nada, ordenados por lo mas reciente). Cada fila
// trae su `categoria` para que el frontend sepa como abrirla: 'posible' abre
// la ficha completa (copiloto/IA), 'sin_clasificar'/'conocido' abren la vista
// simple (leer + responder + marcar categoria), sin IA de por medio.
leadsRouter.get('/todos', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const cond = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      cond.push(`(telefono ILIKE $${params.length} OR nombre ILIKE $${params.length})`);
    }
    // "conocido" = el dueño YA lo marco como amigo/cliente actual, decision
    // explicita suya -- a diferencia de "sin_clasificar" (nunca revisado, si
    // se muestra), un "conocido" no se vuelve a mostrar aca.
    cond.push(`categoria <> 'conocido'`);
    const where = `WHERE ${cond.join(' AND ')}`;
    const { rows } = await query(
      `SELECT l.id, l.telefono, l.nombre, l.foto_url, l.categoria, l.score, l.ultimo_contacto, l.ultimo_mensaje,
              (SELECT m.direccion FROM lead_mensajes m WHERE m.lead_id = l.id ORDER BY m.fecha DESC, m.id DESC LIMIT 1) AS ultima_direccion
       FROM leads l ${where}
       ORDER BY ultimo_contacto DESC NULLS LAST, id DESC LIMIT 500`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/leads/por-clasificar/:id -> vista previa de la conversacion EN VIVO
// (directo de Evolution, sin guardar nada en la BD) para poder leerla antes de
// decidir si es un "posible" o un "conocido" -- no se persiste porque todavia
// no esta confirmado que deba entrar al sistema.
// Mensajes de un lead: combina la copia local con el historial vivo de
// Evolution. La copia local conserva multimedia procesado; Evolution completa
// mensajes que llegaron antes de activar el webhook o quedaron sin guardar.
async function obtenerMensajesLead(leadId, lead) {
  const { rows: locales } = await query(
    `SELECT wa_id, direccion, cuerpo, fecha, tipo, media_archivo, media_mime, media_nombre, media_texto
     FROM lead_mensajes WHERE lead_id = $1 ORDER BY fecha, id`,
    [leadId],
  );

  const jid = lead.lid || `${lead.telefono}@s.whatsapp.net`;
  let registros = await listarMensajes(jid, { limite: 100 }).catch(() => []);
  if (!registros.length) {
    try {
      const chats = await listarChats();
      const actual = Array.isArray(chats) && chats.find((c) => String(c?.remoteJid || '').includes(lead.telefono));
      if (actual?.remoteJid && actual.remoteJid !== jid) {
        registros = await listarMensajes(actual.remoteJid, { limite: 100 }).catch(() => []);
      }
    } catch { /* se queda sin historial */ }
  }
  const remotos = registros
    .map((m) => ({ wa_id: m?.key?.id || null, direccion: m?.key?.fromMe ? 'out' : 'in', cuerpo: textoDeMensaje(m), fecha: m?.messageTimestamp ? new Date(m.messageTimestamp * 1000) : null }))
    .filter((m) => m.cuerpo)
  const vistos = new Set();
  const combinados = [...locales, ...remotos].filter((m) => {
    if (!m.wa_id) return true;
    if (vistos.has(m.wa_id)) return false;
    vistos.add(m.wa_id);
    return true;
  });
  return combinados.sort((a, b) => (new Date(a.fecha || 0).getTime() || 0) - (new Date(b.fecha || 0).getTime() || 0));
}

leadsRouter.get('/por-clasificar/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT telefono, nombre, lid FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'No encontrado.' });
    const mensajes = await obtenerMensajesLead(req.params.id, lead);
    res.json({ telefono: lead.telefono, nombre: lead.nombre, mensajes });
  } catch (err) { next(err); }
});

// POST /api/leads/por-clasificar/:id/sugerir -> IA sugiere un mensaje para
// CUALQUIER chat (posible o no): al entrar puede resultar ser un cliente real
// que necesita respuesta ya, sin etiqueta todavia. A diferencia de POST
// /:id/sugerir, esto NUNCA construye/actualiza la ficha (memoria) ni lo
// registra en el ciclo de aprendizaje -- eso sigue reservado solo para
// "posible" (la IA no debe aprender de conversaciones sin confirmar).
leadsRouter.post('/por-clasificar/:id/sugerir', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'No encontrado.' });
    const mensajes = await obtenerMensajesLead(req.params.id, lead);
    const sugerencia = await sugerirRespuesta({ lead, mensajes, memoria: null });
    res.json({ sugerencia });
  } catch (err) { next(err); }
});

// POST /api/leads/sugerir-directo { telefono, nombre?, mensajes:[{direccion,cuerpo,fecha?}] }
// Para la EXTENSION de WhatsApp Web: la conversacion llega EN VIVO desde el
// navegador (wa-js), asi la IA puede sugerir aunque Evolution este caido o
// desincronizado. Si el numero ya es lead usa su ficha/notas como contexto;
// si no existe, sugiere solo con la conversacion recibida. NUNCA envia ni
// aprende: el humano copia/edita y manda desde su propio WhatsApp.
leadsRouter.post('/sugerir-directo', async (req, res, next) => {
  try {
    const telefono = normalizarTelefono(req.body?.telefono || '');
    if (!telefono) return res.status(400).json({ error: 'Falta el telefono.' });
    const mensajes = (Array.isArray(req.body?.mensajes) ? req.body.mensajes : [])
      .map((m) => ({
        direccion: m?.direccion === 'out' ? 'out' : 'in',
        cuerpo: String(m?.cuerpo || '').slice(0, 4000),
        fecha: m?.fecha ? new Date(m.fecha) : null,
      }))
      .filter((m) => m.cuerpo)
      .slice(-60);
    if (!mensajes.length) return res.status(400).json({ error: 'Faltan los mensajes.' });

    const { rows } = await query('SELECT * FROM leads WHERE telefono = $1', [telefono]);
    const lead = rows[0] || { telefono, nombre: String(req.body?.nombre || '').trim() || null, notas: null };
    let memoria = null;
    if (rows[0]?.categoria === 'posible') {
      try { memoria = await memoriaAlDia(rows[0].id); } catch { /* sigue sin ficha */ }
    }

    // Contexto manual de lo hecho FUERA del chat (llamada, Meet, Zoom, acuerdos
    // verbales). Igual que en la webapp: se guarda en la ficha para que las
    // proximas sugerencias tambien lo recuerden.
    const contextoManual = String(req.body?.contexto || '').trim().slice(0, 1200);
    if (contextoManual && rows[0]) {
      await query(
        `UPDATE leads SET memoria = jsonb_set(COALESCE(memoria, '{}'::jsonb), '{contexto_manual}', to_jsonb($1::text), true) WHERE id = $2`,
        [contextoManual, rows[0].id],
      );
      memoria = { ...(memoria || {}), contexto_manual: contextoManual };
    }

    // Consistencia: usa lo ya aprendido (las correcciones de Jean) igual que
    // el flujo de la webapp.
    let ejemplos = '';
    try { ejemplos = ejemplosATexto(await ejemplosDeJean({ etapa: memoria?.etapa })); } catch { /* sin ejemplos */ }

    const sugerencia = await sugerirRespuesta({ lead, mensajes, memoria, ejemplos, contextoManual });

    // Registra la sugerencia para poder comparar despues con lo que Jean mande
    // de verdad (la extension reporta el envio via /aprendizaje-envio).
    let sugerencia_id = null;
    if (rows[0]) {
      try {
        const contexto = mensajes.slice(-4).map((m) => `${m.direccion === 'in' ? 'CLIENTE' : 'JEAN'}: ${m.cuerpo}`).join('\n');
        sugerencia_id = await registrarSugerencia({ leadId: rows[0].id, sugerido: sugerencia, etapa: memoria?.etapa, contexto });
      } catch { /* el registro es opcional */ }
    }

    res.json({ sugerencia, sugerencia_id, lead_id: rows[0]?.id || null, categoria: rows[0]?.categoria || null });
  } catch (err) { next(err); }
});

// POST /api/leads/aprendizaje-envio { telefono, sugerencia_id?, enviado }
// Cierre del ciclo desde la EXTENSION: Jean envia a mano en WhatsApp Web y la
// extension detecta su mensaje saliente y lo reporta. Se compara sugerido vs
// enviado; la edicion de Jean es la correccion que enseña a la IA.
leadsRouter.post('/aprendizaje-envio', async (req, res, next) => {
  try {
    const telefono = normalizarTelefono(req.body?.telefono || '');
    const enviado = String(req.body?.enviado || '').trim();
    if (!telefono || !enviado) return res.status(400).json({ error: 'Faltan datos.' });
    const { rows } = await query('SELECT id FROM leads WHERE telefono = $1', [telefono]);
    if (!rows.length) return res.status(404).json({ error: 'No registrado.' });
    const aprendizaje = await registrarEnvio({
      leadId: rows[0].id,
      sugerenciaId: Number(req.body?.sugerencia_id) || null,
      enviado: enviado.slice(0, 4000),
    });
    res.json({ ok: true, aprendizaje });
  } catch (err) { next(err); }
});

// POST /api/leads/recordatorio { telefono, dias?, nota? } -> "recuerdame en N
// dias" desde la EXTENSION: crea una cita de seguimiento; el cron de
// recordatorios avisa por WhatsApp al numero configurado, como toda cita.
leadsRouter.post('/recordatorio', async (req, res, next) => {
  try {
    const telefono = normalizarTelefono(req.body?.telefono || '');
    if (!telefono) return res.status(400).json({ error: 'Falta el telefono.' });
    const { rows } = await query('SELECT id, nombre FROM leads WHERE telefono = $1', [telefono]);
    if (!rows.length) return res.status(404).json({ error: 'No registrado.' });
    // Momento del recordatorio: fecha_hora exacta (ISO) si viene, si no
    // "dentro de N dias". Maximo un año a futuro.
    let cuando;
    const exacta = req.body?.fecha_hora ? new Date(req.body.fecha_hora) : null;
    if (exacta && !Number.isNaN(exacta.getTime())) {
      if (exacta.getTime() < Date.now()) return res.status(400).json({ error: 'Esa fecha ya paso.' });
      if (exacta.getTime() > Date.now() + 366 * 864e5) return res.status(400).json({ error: 'Fecha demasiado lejana.' });
      cuando = exacta;
    } else {
      const dias = Math.min(Math.max(Number(req.body?.dias) || 1, 0.04), 60);
      cuando = new Date(Date.now() + dias * 864e5);
    }
    const nota = String(req.body?.nota || '').trim().slice(0, 300)
      || `Seguimiento a ${rows[0].nombre || telefono}`;
    const { rows: cita } = await query(
      `INSERT INTO citas (lead_id, fecha_hora, texto, recordatorio_minutos)
       VALUES ($1, $2, $3, 5) RETURNING id, fecha_hora`,
      [rows[0].id, cuando, nota],
    );
    res.json({ ok: true, ...cita[0] });
  } catch (err) { next(err); }
});

// GET /api/leads/por-telefono/:tel -> ficha resumida del chat abierto, para el
// panel de la extension junto a WhatsApp Web. 404 = numero no registrado.
leadsRouter.get('/por-telefono/:tel', async (req, res, next) => {
  try {
    const tel = normalizarTelefono(req.params.tel);
    if (!tel) return res.status(400).json({ error: 'Telefono invalido.' });
    const { rows } = await query(
      `SELECT l.id, l.telefono, l.nombre, l.categoria, l.estado, l.ciudad, l.score, l.notas, l.ultimo_contacto,
              (SELECT m.direccion FROM lead_mensajes m WHERE m.lead_id = l.id ORDER BY m.fecha DESC, m.id DESC LIMIT 1) AS ultima_direccion
       FROM leads l WHERE l.telefono = $1`,
      [tel],
    );
    if (!rows.length) return res.status(404).json({ error: 'No registrado.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/leads/por-clasificar/:id/responder { texto } -> a veces un chat
// "por clasificar" resulta ser un CLIENTE ACTUAL que necesita respuesta ya,
// no un prospecto a evaluar con calma. Manda el mensaje sin clasificar ni
// pasar por el copiloto/IA (eso sigue reservado para "posible").
leadsRouter.post('/por-clasificar/:id/responder', async (req, res, next) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'Falta el mensaje.' });
    const { rows } = await query('SELECT telefono FROM leads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado.' });

    const resp = await enviarTexto(rows[0].telefono, texto);
    const waId = resp?.key?.id ? String(resp.key.id) : null;
    await guardarMensaje({ telefono: rows[0].telefono, cuerpo: texto, direccion: 'out', waId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/leads/:id/categoria { categoria: 'posible'|'conocido' }
leadsRouter.patch('/:id/categoria', async (req, res, next) => {
  try {
    const categoria = String(req.body?.categoria || '');
    if (!['posible', 'conocido'].includes(categoria)) return res.status(400).json({ error: 'Categoria invalida.' });
    const r = await marcarCategoria(req.params.id, categoria);
    res.json(r);
  } catch (err) { next(err); }
});

// GET /api/leads/seguimientos -> "hoy toca escribirle a estos", con el motivo.
leadsRouter.get('/seguimientos', async (req, res, next) => {
  try { res.json(await colaDeSeguimientos({ limite: Number(req.query.limite) || 30 })); } catch (err) { next(err); }
});

// GET /api/leads/plantillas -> respuestas rapidas del vendedor.
leadsRouter.get('/plantillas', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, atajo, titulo, texto FROM plantillas ORDER BY usos DESC, titulo');
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/leads/plantillas { atajo, titulo, texto }
leadsRouter.post('/plantillas', async (req, res, next) => {
  try {
    const atajo = String(req.body?.atajo || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const titulo = String(req.body?.titulo || '').trim();
    const texto = String(req.body?.texto || '').trim();
    if (!atajo || !titulo || !texto) return res.status(400).json({ error: 'Faltan datos.' });
    const { rows } = await query(
      `INSERT INTO plantillas (atajo, titulo, texto) VALUES ($1,$2,$3)
       ON CONFLICT (atajo) DO UPDATE SET titulo = EXCLUDED.titulo, texto = EXCLUDED.texto
       RETURNING id, atajo, titulo, texto`,
      [atajo, titulo, texto],
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/leads/plantillas/:pid
leadsRouter.delete('/plantillas/:pid', async (req, res, next) => {
  try {
    if (!/^d+$/.test(req.params.pid)) return res.status(404).json({ error: 'No encontrada.' });
    await query('DELETE FROM plantillas WHERE id = $1', [req.params.pid]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/leads/embudo -> metricas del pipeline (solo SQL).
leadsRouter.get('/embudo', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT COALESCE(memoria->>'etapa', 'sin_clasificar') AS etapa,
              COUNT(*)::int AS n,
              ROUND(AVG(COALESCE(score,0)))::int AS score_prom
       FROM leads WHERE categoria = 'posible' AND estado <> 'descartado'
       GROUP BY 1 ORDER BY n DESC`,
    );
    const { rows: tot } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE memoria->>'etapa' = 'cerrado')::int AS cerrados,
              COUNT(*) FILTER (WHERE COALESCE(score,0) >= 60)::int AS calientes
       FROM leads WHERE categoria = 'posible'`,
    );
    res.json({ etapas: rows, ...tot[0] });
  } catch (err) { next(err); }
});

// GET /api/leads/aprendizaje -> como va aprendiendo el copiloto.
leadsRouter.get('/aprendizaje', async (req, res, next) => {
  try { res.json(await estadisticas()); } catch (err) { next(err); }
});

// POST /api/leads/:id/aprendizaje-resultado
// Marca el resultado real de la ultima respuesta sugerida/enviada. Esto permite
// aprender no solo de la edicion de Jean, sino tambien de lo que funciono.
leadsRouter.post('/:id/aprendizaje-resultado', async (req, res, next) => {
  try {
    const resultado = String(req.body?.resultado || '').trim();
    const nota = String(req.body?.nota || '').trim();
    const r = await registrarResultado({
      leadId: Number(req.params.id),
      sugerenciaId: Number(req.body?.sugerencia_id) || null,
      resultado,
      nota,
    });
    if (!r) return res.status(404).json({ error: 'No hay una respuesta enviada para registrar.' });
    res.json({ ok: true, ...r });
  } catch (err) { next(err); }
});

// GET /api/leads/citas -> proximas citas (pendientes), para verlas en el buzon.
leadsRouter.get('/citas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.lead_id, c.fecha_hora, c.texto, c.recordatorio_minutos,
              c.recordatorio_enviado_at, l.nombre, l.telefono
       FROM citas c JOIN leads l ON l.id = c.lead_id
       WHERE c.estado = 'pendiente'
       ORDER BY c.fecha_hora`,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/leads/citas/:cid { recordatorio_minutos } o cancelar.
leadsRouter.patch('/citas/:cid', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.cid)) return res.status(404).json({ error: 'No encontrada.' });
    if (req.body?.cancelar) {
      await query("UPDATE citas SET estado = 'cancelada' WHERE id = $1", [req.params.cid]);
      return res.json({ ok: true });
    }
    const min = Number(req.body?.recordatorio_minutos);
    if (!Number.isFinite(min) || min < 1 || min > 1440) return res.status(400).json({ error: 'Minutos invalidos.' });
    await query(
      'UPDATE citas SET recordatorio_minutos = $1, recordatorio_enviado_at = NULL WHERE id = $2',
      [Math.round(min), req.params.cid],
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET/PUT /api/leads/config-recordatorios -> a que numero llegan los avisos.
leadsRouter.get('/config-recordatorios', async (req, res, next) => {
  try {
    const { rows } = await query("SELECT valor FROM config WHERE clave = 'numero_recordatorios'");
    res.json({ numero: rows[0]?.valor || '' });
  } catch (err) { next(err); }
});
leadsRouter.put('/config-recordatorios', async (req, res, next) => {
  try {
    const numero = normalizarTelefono(req.body?.numero || '');
    await query(
      `INSERT INTO config (clave, valor) VALUES ('numero_recordatorios', $1)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [numero],
    );
    res.json({ ok: true, numero });
  } catch (err) { next(err); }
});

// GET /api/leads -> lista de posibles (buscar + filtrar por estado).
leadsRouter.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const estado = String(req.query.estado || '').trim();
    const cond = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      cond.push(`(l.telefono ILIKE $${params.length} OR l.nombre ILIKE $${params.length})`);
    }
    if (estado) { params.push(estado); cond.push(`l.estado = $${params.length}`); }
    else cond.push(`l.estado <> 'descartado'`); // por defecto oculta los descartados (no aportan a la venta)
    cond.push(`l.categoria = 'posible'`);
    const where = `WHERE ${cond.join(' AND ')}`;

    // 'reciente' (default) = tal cual WhatsApp, el que hablo hace menos sale
    // primero -- para ubicar a alguien rapido sin perderse. 'prioridad' = el
    // orden viejo por valor comercial (a punto de cerrar primero), como una
    // vista alterna para priorizar seguimiento, no para buscar un chat puntual.
    const orden = String(req.query.orden || 'reciente') === 'prioridad'
      ? `CASE
           WHEN l.notas ILIKE '%[cerrado%' THEN 6
           WHEN l.notas ILIKE '%[descartado%' OR l.estado = 'descartado' THEN 7
           WHEN l.notas ILIKE '%[por_pagar%' THEN 0
           WHEN l.notas ILIKE '%[negociando%' OR l.notas ILIKE '%[cotizado%' THEN 1
           WHEN l.notas ILIKE '%caliente]%' THEN 2
           WHEN l.notas ILIKE '%[demo%' OR l.notas ILIKE '%[por_confirmar%' THEN 3
           WHEN l.notas ILIKE '%tibio]%' OR l.notas ILIKE '%[info_enviada%' OR l.notas ILIKE '%[primer_contacto%' THEN 4
           ELSE 5
         END, l.ultimo_contacto DESC NULLS LAST, l.id DESC`
      : `l.ultimo_contacto DESC NULLS LAST, l.id DESC`;

    const { rows } = await query(
      `SELECT l.id, l.telefono, l.nombre, l.foto_url, l.estado, l.ciudad, l.ultimo_mensaje, l.mensajes_in,
              l.ultimo_contacto, l.ultimo_seguimiento, l.notas,
              -- Direccion del ultimo mensaje: si es in, el lead espera respuesta.
              (SELECT m.direccion FROM lead_mensajes m WHERE m.lead_id = l.id ORDER BY m.fecha DESC, m.id DESC LIMIT 1) AS ultima_direccion
       FROM leads l ${where}
       ORDER BY ${orden} LIMIT 300`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/leads/media/:archivo -> sirve la foto/PDF/audio guardado.
// El nombre lo genera el sistema (waId saneado + extension), no el usuario.
leadsRouter.get('/media/:archivo', (req, res) => {
  const nombre = String(req.params.archivo);
  if (!/^[\w-]+\.[a-z0-9]{2,5}$/i.test(nombre)) return res.status(400).end();
  // nosniff: la extension real siempre sale del mimetype verificado al bajar
  // el archivo (ver media.js EXT{}, nunca del nombre que manda el remitente
  // por WhatsApp), pero esto evita que el navegador "adivine" otro tipo si el
  // contenido no calza exacto con la extension.
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=86400');
  res.set('Content-Disposition', `inline; filename="${nombre}"`);
  if (/\.pdf$/i.test(nombre)) res.type('application/pdf');
  const ruta = resolve(MEDIA_DIR, nombre);
  res.sendFile(ruta, async (err) => {
    if (!err || res.headersSent) return;
    // Compatibilidad con multimedia historico perdido tras recrear el
    // contenedor: si Evolution aun lo conserva, se recupera al primer acceso.
    try {
      const { rows } = await query(
        'SELECT wa_id FROM lead_mensajes WHERE media_archivo = $1 AND wa_id IS NOT NULL LIMIT 1',
        [nombre],
      );
      if (!rows.length) return res.status(404).end();
      const media = await descargarMedia(rows[0].wa_id);
      await mkdir(MEDIA_DIR, { recursive: true });
      await writeFile(ruta, Buffer.from(media.base64, 'base64'));
      if (media.mimetype) res.set('Content-Type', media.mimetype);
      if (media.mimetype === 'application/pdf' || /\.pdf$/i.test(nombre)) {
        res.set('Content-Disposition', `inline; filename="${nombre}"`);
      }
      res.sendFile(ruta, (err2) => { if (err2 && !res.headersSent) res.status(404).end(); });
    } catch (e) {
      console.error('[media] no se pudo recuperar', nombre, e?.message || e);
      if (!res.headersSent) res.status(404).end();
    }
  });
});

// GET /api/leads/:id/conversacion -> mensajes cronologicos.
leadsRouter.get('/:id/conversacion', async (req, res, next) => {
  try {
    const { rows: leadRows } = await query('SELECT id, telefono, lid FROM leads WHERE id = $1', [req.params.id]);
    if (!leadRows.length) return res.status(404).json({ error: 'Lead no encontrado.' });
    res.json(await obtenerMensajesLead(req.params.id, leadRows[0]));
  } catch (err) { next(err); }
});

// POST /api/leads/:id/sugerir -> IA sugiere el proximo mensaje. NO envia.
leadsRouter.post('/:id/sugerir', async (req, res, next) => {
  try {
    const { rows: leadRows } = await query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    if (!leadRows.length) return res.status(404).json({ error: 'Lead no encontrado.' });
    const contextoManual = String(req.body?.contexto || '').trim().slice(0, 1200);
    // Usar el mismo historial combinado que ve la conversacion: la IA tambien
    // debe recuperar de Evolution los mensajes que no llegaron al webhook.
    const msgs = await obtenerMensajesLead(req.params.id, leadRows[0]);
    // La ficha (memoria) se pone al dia con los mensajes nuevos y se pasa como
    // fuente de verdad: asi no hay que re-leer todo el historial cada vez.
    let memoria = null;
    try { memoria = await memoriaAlDia(req.params.id); } catch { /* sigue sin ficha */ }
    if (contextoManual) {
      await query(
        `UPDATE leads SET memoria = jsonb_set(COALESCE(memoria, '{}'::jsonb), '{contexto_manual}', to_jsonb($1::text), true) WHERE id = $2`,
        [contextoManual, req.params.id],
      );
      memoria = { ...(memoria || {}), contexto_manual: contextoManual };
    }

    // Ejemplos de como respondio Jean en casos parecidos (sus correcciones).
    let ejemplos = '';
    try { ejemplos = ejemplosATexto(await ejemplosDeJean({ etapa: memoria?.etapa })); } catch { /* sin ejemplos */ }

    const sugerencia = await sugerirRespuesta({ lead: leadRows[0], mensajes: msgs, memoria, ejemplos, contextoManual });

    // Se guarda para cerrar el ciclo cuando Jean mande (ahi se ve si la edito).
    let sugerencia_id = null;
    try {
      const contexto = msgs.slice(-4).map((m) => `${m.direccion === 'in' ? 'CLIENTE' : 'JEAN'}: ${m.cuerpo}`).join('\n');
      sugerencia_id = await registrarSugerencia({
        leadId: Number(req.params.id), sugerido: sugerencia, etapa: memoria?.etapa, contexto,
      });
    } catch { /* el registro es opcional */ }

    res.json({ sugerencia, memoria, sugerencia_id });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/enviar { texto } -> envia por WhatsApp (individual) + log.
leadsRouter.post('/:id/enviar', async (req, res, next) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'El mensaje esta vacio.' });
    const { rows } = await query('SELECT telefono FROM leads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead no encontrado.' });
    const { telefono } = rows[0];

    const resp = await enviarTexto(telefono, texto);
    const waId = resp?.key?.id ? String(resp.key.id) : null;
    await guardarMensaje({ telefono, cuerpo: texto, direccion: 'out', waId });
    // Marca el seguimiento para que no vuelva a salir en la cola de hoy.
    await query('UPDATE leads SET ultimo_seguimiento = now() WHERE id = $1', [req.params.id]);

    // Cierra el ciclo de aprendizaje: si venia de una sugerencia, se anota lo que
    // Jean mando realmente y si la edito (su correccion ensena a la IA).
    let aprendizaje = null;
    try {
      aprendizaje = await registrarEnvio({
        leadId: Number(req.params.id),
        sugerenciaId: Number(req.body?.sugerencia_id) || null,
        enviado: texto,
      });
    } catch { /* el aprendizaje es opcional, no debe romper el envio */ }

    res.json({ ok: true, aprendizaje });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/cotizacion { sucursales? } -> genera el PDF con los
// datos de la ficha y lo manda por WhatsApp. Precio: S/69 (1 sucursal) + S/20
// por cada adicional.
leadsRouter.post('/:id/cotizacion', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT telefono, nombre, memoria FROM leads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead no encontrado.' });
    const lead = rows[0];
    const d = lead.memoria?.datos || {};
    const sucursales = Number(req.body?.sucursales) || 1;

    const base64 = await generarCotizacion({
      nombre: lead.nombre || d.nombre, negocio: d.negocio, ciudad: d.ciudad, sucursales,
    });

    const resp = await enviarMedia(lead.telefono, {
      base64, mediatype: 'document', mimetype: 'application/pdf',
      fileName: 'Cotizacion-SysFarma.pdf', caption: 'Le comparto la cotizacion 📄',
    });
    const waId = resp?.key?.id ? String(resp.key.id) : null;
    await guardarMensaje({
      telefono: lead.telefono, cuerpo: '📄 Cotizacion-SysFarma.pdf', direccion: 'out', waId, tipo: 'pdf',
    });
    await query('UPDATE leads SET ultimo_seguimiento = now() WHERE id = $1', [req.params.id]);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/leads/:id { estado?, nombre?, ciudad?, notas? }
leadsRouter.patch('/:id', async (req, res, next) => {
  try {
    const sets = [];
    const params = [];
    if (typeof req.body.estado === 'string') {
      if (!ESTADOS.includes(req.body.estado)) return res.status(400).json({ error: 'Estado invalido.' });
      params.push(req.body.estado); sets.push(`estado = $${params.length}`);
    }
    for (const campo of ['nombre', 'ciudad', 'notas']) {
      if (typeof req.body[campo] === 'string') {
        params.push(req.body[campo].trim() || null);
        sets.push(`${campo} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar.' });
    params.push(req.params.id);
    const { rows } = await query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`, params);
    if (!rows.length) return res.status(404).json({ error: 'Lead no encontrado.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/leads/importar { texto } o { numeros:[{telefono,nombre?}] }
// Carga tus "posibles" (numeros) al buzon. 9 digitos -> se guardan como Peru (51...).
leadsRouter.post('/importar', async (req, res, next) => {
  try {
    let items = [];
    if (Array.isArray(req.body?.numeros)) {
      items = req.body.numeros;
    } else if (typeof req.body?.texto === 'string') {
      items = req.body.texto.split(/\r?\n/).map((l) => {
        const [tel, ...resto] = l.split(',');
        return { telefono: tel, nombre: resto.join(',').trim() || null };
      });
    }
    let importados = 0;
    for (const it of items) {
      const tel = normalizarTelefono(it?.telefono);
      if (!tel) continue;
      await query(
        `INSERT INTO leads (telefono, nombre, estado) VALUES ($1, $2, 'nuevo')
         ON CONFLICT (telefono) DO UPDATE SET nombre = COALESCE(leads.nombre, EXCLUDED.nombre)`,
        [tel, it?.nombre || null],
      );
      importados += 1;
    }
    res.json({ ok: true, importados });
  } catch (err) { next(err); }
});
