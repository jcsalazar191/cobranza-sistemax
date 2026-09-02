// Cliente de WhatsApp para el modulo de "posibles". Soporta 2 modos, como el
// proyecto de farmacia:
//  - PROXY BuhoLa (lo que usa el negocio): auth Basic con client_id/secret,
//    endpoints /api/bot/instances/... La config vive en la tabla config:
//      buho_url, buho_client_id, buho_client_secret
//  - Evolution DIRECTO (fallback): apikey header, endpoints /message/...
//      evolution_url, evolution_apikey
//  Comun a ambos: evolution_instance (nombre de la instancia = el WhatsApp),
//  evolution_webhook_token (valida el webhook entrante).
import { query } from './db.js';
import { getQr } from './qrStore.js';

export async function getEvolutionCreds() {
  const { rows } = await query("SELECT clave, valor FROM config WHERE clave LIKE 'evolution_%' OR clave LIKE 'buho_%'");
  const cfg = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  const evoUrl = cfg.evolution_url || process.env.EVOLUTION_URL || '';
  const evoKey = cfg.evolution_apikey || process.env.EVOLUTION_APIKEY || '';
  const direct = Boolean(evoUrl && evoKey);
  return {
    direct,
    baseUrl: (direct ? evoUrl : (cfg.buho_url || process.env.BUHO_URL || '')).replace(/\/+$/, ''),
    apiKey: evoKey,
    clientId: cfg.buho_client_id || process.env.BUHO_CLIENT_ID || '',
    clientSecret: cfg.buho_client_secret || process.env.BUHO_CLIENT_SECRET || '',
    instance: cfg.evolution_instance || process.env.EVOLUTION_INSTANCE || '',
    webhookToken: cfg.evolution_webhook_token || process.env.EVOLUTION_WEBHOOK_TOKEN || '',
  };
}

// Telefono a formato WhatsApp: solo digitos; 9 digitos (celular peruano) -> 51 + numero.
export function normalizarTelefono(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 9 ? `51${d}` : d;
}

function authHeaders(creds) {
  if (creds.direct) return { apikey: creds.apiKey };
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

async function evoFetch(creds, path, { method = 'GET', body, timeout = 20000 } = {}) {
  if (!creds.baseUrl) throw new Error('WhatsApp no esta configurado.');
  const r = await fetch(`${creds.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders(creds) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text().catch(() => '');
  if (!r.ok) {
    const e = new Error(`WhatsApp ${r.status}`);
    e.status = 502;
    e.detalle = text.slice(0, 300);
    throw e;
  }
  try { return JSON.parse(text); } catch { return {}; }
}

const P = {
  send: (c) => (c.direct ? `/message/sendText/${encodeURIComponent(c.instance)}` : `/api/bot/instances/${encodeURIComponent(c.instance)}/messages/text`),
  sendMedia: (c) => (c.direct ? `/message/sendMedia/${encodeURIComponent(c.instance)}` : `/api/bot/instances/${encodeURIComponent(c.instance)}/messages/media`),
  qr: (c) => (c.direct ? `/instance/connect/${encodeURIComponent(c.instance)}` : `/api/bot/instances/${encodeURIComponent(c.instance)}/qr`),
  state: (c) => (c.direct ? `/instance/connectionState/${encodeURIComponent(c.instance)}` : `/api/bot/instances/${encodeURIComponent(c.instance)}/state`),
};

// URL publica del webhook de cobranza (Evolution/proxy la llama con el token).
export function webhookUrl(creds, base) {
  return `${base.replace(/\/+$/, '')}/api/wa/${creds.webhookToken}`;
}

// Crea la instancia (idempotente) y registra el webhook a cobranza. En modo
// proxy el webhook se manda en la creacion; en directo, en un segundo llamado.
export async function crearInstancia(publicBaseUrl) {
  const creds = await getEvolutionCreds();
  if (!creds.instance) throw new Error('Falta configurar el nombre de la instancia.');
  const hook = webhookUrl(creds, publicBaseUrl);

  if (!creds.direct) {
    const res = await evoFetch(creds, '/api/bot/instances', { method: 'POST', timeout: 60000, body: { instance_name: creds.instance, webhook_url: hook } })
      .catch((e) => { if (/already/i.test(e?.detalle || '')) return { already_exists: true }; throw e; });
    // Asegura el webhook a cobranza (por si la instancia ya existia).
    await evoFetch(creds, `/api/bot/instances/${encodeURIComponent(creds.instance)}/webhook`, { method: 'PUT', body: { url: hook } }).catch(() => {});
    return res;
  }
  const res = await evoFetch(creds, '/instance/create', {
    method: 'POST', timeout: 60000,
    body: { instanceName: creds.instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
  }).catch((e) => { if (/already/i.test(e?.detalle || '')) return { already_exists: true }; throw e; });
  await evoFetch(creds, `/webhook/set/${encodeURIComponent(creds.instance)}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true, url: hook, webhookByEvents: false,
        events: ['QRCODE_UPDATED', 'MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT', 'CONTACTS_SET', 'CHATS_UPSERT', 'CHATS_SET', 'CALL'],
      },
    },
  }).catch(() => {});
  return res;
}

// Lee todos los CONTACTOS de la instancia (Evolution directo). Base para importar.
export async function listarContactos() {
  const creds = await getEvolutionCreds();
  return evoFetch(creds, `/chat/findContacts/${encodeURIComponent(creds.instance)}`, { method: 'POST', body: {}, timeout: 30000 });
}

// Lee el HISTORIAL de mensajes de un chat puntual (paginado). Se usa cuando
// el dueño marca un lead "por clasificar" como Posible: recien ahi se trae su
// conversacion real (nunca antes, para no guardar historial de nadie sin
// confirmar que es un prospecto).
export async function listarMensajes(remoteJid, { limite = 500 } = {}) {
  const creds = await getEvolutionCreds();
  const mensajes = [];
  let page = 1;
  for (;;) {
    const data = await evoFetch(creds, `/chat/findMessages/${encodeURIComponent(creds.instance)}`, {
      method: 'POST',
      timeout: 30000,
      body: { where: { key: { remoteJid } }, page },
    });
    const registros = data?.messages?.records || [];
    mensajes.push(...registros);
    const totalPaginas = data?.messages?.pages || 1;
    if (page >= totalPaginas || mensajes.length >= limite) break;
    page += 1;
  }
  return mensajes;
}

// Lee todos los CHATS de la instancia (Evolution directo).
export async function listarChats() {
  const creds = await getEvolutionCreds();
  return evoFetch(creds, `/chat/findChats/${encodeURIComponent(creds.instance)}`, { method: 'POST', body: {}, timeout: 30000 });
}

// Envia un texto por WhatsApp. Devuelve la respuesta (incluye key.id, util para
// no re-procesar su eco en el webhook).
export async function enviarTexto(telefono, texto) {
  const creds = await getEvolutionCreds();
  if (!creds.instance) throw new Error('WhatsApp no esta configurado (sin instancia).');
  return evoFetch(creds, P.send(creds), {
    method: 'POST',
    body: { number: normalizarTelefono(telefono), text: texto, delay: 0, linkPreview: true },
  });
}

// Envia un archivo (imagen/pdf/audio) en base64. `mediatype` es 'image'|'document'|'audio'|'video'.
export async function enviarMedia(telefono, { base64, mediatype, mimetype, fileName, caption }) {
  const creds = await getEvolutionCreds();
  if (!creds.instance) throw new Error('WhatsApp no esta configurado (sin instancia).');
  return evoFetch(creds, P.sendMedia(creds), {
    method: 'POST',
    timeout: 45000,
    body: {
      number: normalizarTelefono(telefono),
      mediatype,
      mimetype,
      media: base64,
      fileName: fileName || undefined,
      caption: caption || undefined,
      delay: 0,
    },
  });
}

// Estado de conexion de la instancia.
export async function estadoConexion() {
  const creds = await getEvolutionCreds();
  if (!creds.baseUrl || !creds.instance) return { conectado: false, estado: 'sin_configurar' };
  try {
    const data = await evoFetch(creds, P.state(creds));
    const estado = data?.instance?.state || data?.state || data?.status || 'unknown';
    return { conectado: estado === 'open' || estado === 'connected', estado };
  } catch {
    return { conectado: false, estado: 'error' };
  }
}

// QR (base64) para vincular. Evolution v2 lo entrega por el evento webhook
// QRCODE_UPDATED (cache en qrStore); si no, se intenta /instance/connect.
export async function obtenerQr() {
  const cached = getQr();
  if (cached) return cached;
  const creds = await getEvolutionCreds();
  if (!creds.instance) throw new Error('Falta configurar la instancia.');
  const data = await evoFetch(creds, P.qr(creds));
  return data?.base64 || data?.qrcode?.base64 || data?.qr || (typeof data?.qrcode === 'string' ? data.qrcode : null) || null;
}
