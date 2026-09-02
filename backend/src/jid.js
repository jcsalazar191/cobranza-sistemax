// Resolucion de jid de WhatsApp -> telefono. Compartido entre el webhook y la
// importacion masiva. Los "@lid" (identidad nueva de WhatsApp, sin telefono en
// el jid) se resuelven via el jid alterno que manda Evolution (remoteJidAlt/
// senderPn, desde v2.3.7) o, si no viene, via el mapa lid->telefono guardado
// en leads.lid (poblado por la importacion de la etiqueta "Posible" via
// Playwright, o aprendido solo cuando llega el jid alterno).
import { query } from './db.js';

export function jidToPhone(jid) {
  const s = String(jid || '');
  if (!s || s.endsWith('@g.us') || s.endsWith('@broadcast') || s.endsWith('@lid') || s.includes('status')) return '';
  const num = (s.split('@')[0] || '').replace(/\D/g, '');
  // "670400..." es un jid sintetico que manda WhatsApp para conversaciones que
  // arrancan desde un anuncio de Facebook/Instagram (Click-to-WhatsApp) antes
  // de que se revele el numero real -- no es un telefono real, no se puede
  // escribir. "0" es el placeholder que usa la cuenta "WhatsApp Business" del
  // sistema. Ambos generaban leads basura (0 mensajes, imposibles de contactar).
  if (!num || num === '0' || num.startsWith('670400') || num.length < 8) return '';
  return num;
}

export async function resolverTelefono(jid, jidAlt) {
  const directo = jidToPhone(jid);
  if (directo) return directo;
  const s = String(jid || '');
  if (!s.endsWith('@lid')) return '';

  const alt = jidToPhone(jidAlt);
  if (alt) {
    await query('UPDATE leads SET lid = $1 WHERE telefono = $2 AND lid IS NULL', [s, alt]).catch(() => {});
    return alt;
  }

  const { rows } = await query('SELECT telefono FROM leads WHERE lid = $1', [s]);
  return rows[0]?.telefono || '';
}
