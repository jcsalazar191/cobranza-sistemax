// MEDIA de WhatsApp: descarga (Evolution descifra por nosotros) y guarda el
// archivo para que Jean lo vea. No se manda a modelos de IA: leer/transcribir
// multimedia consume creditos y no es necesario para el flujo comercial.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEvolutionCreds } from './evolution.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MEDIA_DIR = process.env.MEDIA_DIR || resolve(__dirname, '../media');

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
};

export function tipoDeMime(mime = '') {
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'archivo';
}

// Baja el media de un mensaje de WhatsApp. Evolution hace el descifrado.
export async function descargarMedia(waMessageId) {
  const c = await getEvolutionCreds();
  if (!c.baseUrl || !c.instance) throw new Error('WhatsApp no configurado.');
  const r = await fetch(`${c.baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(c.instance)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', apikey: c.apiKey },
    body: JSON.stringify({ message: { key: { id: waMessageId } }, convertToMp4: false }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`media ${r.status}`);
  const d = await r.json();
  if (!d?.base64) throw new Error('sin base64');
  return { base64: d.base64, mimetype: d.mimetype || '', fileName: d.fileName || '', size: d.size };
}

// Guarda el archivo en disco y devuelve el nombre con el que quedo.
export async function guardarArchivo(waMessageId, base64, mimetype) {
  await mkdir(MEDIA_DIR, { recursive: true });
  const ext = EXT[mimetype] || 'bin';
  const nombre = `${String(waMessageId).replace(/[^\w-]/g, '')}.${ext}`;
  await writeFile(resolve(MEDIA_DIR, nombre), Buffer.from(base64, 'base64'));
  return nombre;
}

// Procesa un media completo: descarga y guarda el archivo, sin leer su contenido.
// Devuelve lo necesario para actualizar el mensaje en la BD.
export async function procesarMedia(waMessageId) {
  const { base64, mimetype, fileName } = await descargarMedia(waMessageId);
  const archivo = await guardarArchivo(waMessageId, base64, mimetype);
  const tipo = tipoDeMime(mimetype);

  return { archivo, mimetype, fileName, tipo, texto: '' };
}
