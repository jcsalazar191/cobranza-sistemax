import { pool, query } from './db.js';
import { listarMensajes } from './evolution.js';

// Saca el texto (o un marcador) de un mensaje de Evolution, igual que se
// muestra en el buzon en vivo -- pero aca es para el backfill de historial.
export function textoDeMensaje(m) {
  const msg = m?.message || {};
  const tipo = m?.messageType;
  const llamada = msg.callLogMessage || msg.callMessage;
  if (tipo === 'call' || llamada) {
    const segundos = Number(llamada?.durationSecs ?? llamada?.duration ?? 0);
    const duracion = Number.isFinite(segundos) && segundos > 0
      ? (segundos >= 60 ? `${Math.round(segundos / 60)} min` : `${segundos} s`)
      : '';
    const sentido = m?.key?.fromMe ? 'saliente' : 'entrante';
    return `Llamada ${sentido}${duracion ? ` · ${duracion}` : ''}`;
  }
  return (
    msg.conversation
    ?? msg.extendedTextMessage?.text
    ?? (msg.imageMessage?.caption ? `📷 Foto: ${msg.imageMessage.caption}` : null)
    ?? (msg.videoMessage?.caption ? `🎥 Video: ${msg.videoMessage.caption}` : null)
    ?? (msg.documentMessage?.fileName ? `📄 ${msg.documentMessage.fileName}` : null)
    ?? { imageMessage: '📷 [foto]', videoMessage: '🎥 [video]', audioMessage: '🎤 [nota de voz]', stickerMessage: '[sticker]', documentMessage: '📄 [documento]', contactMessage: '👤 [contacto compartido]', locationMessage: '📍 [ubicación]' }[tipo]
    ?? null
  );
}

// Crea/actualiza un lead SIN mensaje (para importar contactos/chats de la
// sincronizacion de WhatsApp). Idempotente por telefono.
export async function guardarLead({ telefono, nombre = null, foto = null }) {
  await query(
    `INSERT INTO leads (telefono, nombre, foto_url, estado) VALUES ($1, $2, $3, 'nuevo')
     ON CONFLICT (telefono) DO UPDATE SET nombre = COALESCE(leads.nombre, EXCLUDED.nombre), foto_url = COALESCE(leads.foto_url, EXCLUDED.foto_url)`,
    [telefono, nombre, foto],
  );
}

// Guarda un mensaje de la conversacion (in = el lead escribio, out = respondimos)
// y actualiza el lead. Idempotente por wa_message_id (dedupe del webhook y del
// eco del propio envio). Crea el lead si no existe. Devuelve { leadId, nuevo }.
export async function guardarMensaje({
  telefono, cuerpo, direccion, waId = null, pushName = null, tipo = null, mediaNombre = null, automatico = false,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // categoria='posible' solo aplica en el INSERT (lead nuevo -- alguien que
    // escribe de verdad es un prospecto real). Si el lead ya existia (import
    // masivo sin clasificar, o ya marcado "conocido"), el ON CONFLICT NO toca
    // su categoria -- la deja como esta para que el dueño la clasifique.
    const { rows } = await client.query(
      `INSERT INTO leads (telefono, nombre, estado, categoria, primer_contacto, ultimo_contacto)
       VALUES ($1, $2, 'nuevo', 'posible', now(), now())
       ON CONFLICT (telefono) DO UPDATE SET nombre = COALESCE(leads.nombre, EXCLUDED.nombre)
       RETURNING id`,
      [telefono, pushName],
    );
    const leadId = rows[0].id;

    const ins = await client.query(
      `INSERT INTO lead_mensajes (lead_id, direccion, cuerpo, wa_message_id, wa_id, tipo, media_nombre, automatico)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
       ON CONFLICT (wa_message_id) DO NOTHING
       RETURNING id`,
      [leadId, direccion, cuerpo, waId, tipo, mediaNombre, automatico],
    );
    const nuevo = ins.rows.length > 0;

    // mensajes_in ANTES de este mensaje: si es entrante, nuevo, y era 0, este
    // es literalmente el primer mensaje que este numero escribe alguna vez.
    let primerContacto = false;
    if (nuevo && direccion === 'in') {
      const { rows: prev } = await client.query('SELECT mensajes_in FROM leads WHERE id = $1', [leadId]);
      primerContacto = Number(prev[0]?.mensajes_in || 0) === 0;
      await client.query(
        'UPDATE leads SET mensajes_in = mensajes_in + 1, ultimo_mensaje = $2, ultimo_contacto = now() WHERE id = $1',
        [leadId, cuerpo],
      );
    } else if (nuevo) {
      await client.query(
        `UPDATE leads SET ultimo_mensaje = $2, ultimo_contacto = now(), ultimo_seguimiento = now(),
                estado = CASE WHEN estado = 'nuevo' THEN 'contactado' ELSE estado END
         WHERE id = $1`,
        [leadId, cuerpo],
      );
    }

    await client.query('COMMIT');
    return { leadId, nuevo, primerContacto };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Marca la categoria de un lead "por clasificar" (posible|conocido). Al
// confirmar "posible" trae su historial real de Evolution (recien ahi -- para
// no guardar conversaciones de nadie sin confirmar primero que es prospecto).
export async function marcarCategoria(leadId, categoria) {
  const { rows } = await query('SELECT telefono, lid, categoria AS actual FROM leads WHERE id = $1', [leadId]);
  const lead = rows[0];
  if (!lead) throw Object.assign(new Error('Lead no encontrado.'), { status: 404 });

  await query('UPDATE leads SET categoria = $1 WHERE id = $2', [categoria, leadId]);

  let mensajesTraidos = 0;
  if (categoria === 'posible' && lead.actual !== 'posible') {
    const jid = lead.lid || `${lead.telefono}@s.whatsapp.net`;
    const registros = await listarMensajes(jid).catch(() => []);
    for (const m of registros) {
      const cuerpo = textoDeMensaje(m);
      if (!cuerpo) continue;
      const waId = m?.key?.id || null;
      const direccion = m?.key?.fromMe ? 'out' : 'in';
      const fecha = m?.messageTimestamp ? new Date(m.messageTimestamp * 1000) : new Date();
      const ins = await query(
        `INSERT INTO lead_mensajes (lead_id, direccion, cuerpo, wa_message_id, wa_id, tipo, fecha)
         VALUES ($1, $2, $3, $4, $4, 'texto', $5)
         ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
        [leadId, direccion, cuerpo, waId, fecha],
      );
      if (ins.rows.length) mensajesTraidos += 1;
    }
    if (mensajesTraidos > 0) {
      await query(
        `UPDATE leads l SET
           mensajes_in = sub.n_in,
           primer_contacto = COALESCE(l.primer_contacto, sub.primero),
           ultimo_contacto = GREATEST(COALESCE(l.ultimo_contacto, sub.ultimo), sub.ultimo),
           ultimo_mensaje = COALESCE(sub.ultimo_txt, l.ultimo_mensaje),
           estado = CASE WHEN l.estado = 'nuevo' THEN 'contactado' ELSE l.estado END
         FROM (
           SELECT lead_id, COUNT(*) FILTER (WHERE direccion = 'in') AS n_in,
             MIN(fecha) FILTER (WHERE direccion = 'in') AS primero, MAX(fecha) AS ultimo,
             (ARRAY_AGG(cuerpo ORDER BY fecha DESC))[1] AS ultimo_txt
           FROM lead_mensajes WHERE lead_id = $1 GROUP BY lead_id
         ) sub WHERE l.id = sub.lead_id`,
        [leadId],
      );
    }
  }

  return { ok: true, mensajesTraidos };
}
