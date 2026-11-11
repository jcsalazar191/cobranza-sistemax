// LEER MEDIA: convierte audio / imagen / PDF / video de WhatsApp en TEXTO para que la IA
// "vea" lo que mando el cliente. Gemini primero (acepta todo sin convertir); si falla,
// respaldo con modelos GRATUITOS de OpenRouter (limites y caidas posibles: es solo respaldo).
import { getGeminiCreds, getOpenrouterCreds } from './routes/config.js';

const MAX_BYTES = 15 * 1024 * 1024; // inline: sobre esto ni se intenta (el archivo igual queda guardado)

const PROMPTS = {
  audio: 'Transcribe literalmente este audio de WhatsApp (espanol de Peru). Solo la transcripcion, sin comentarios. Si no se entiende nada, responde: [audio ininteligible].',
  imagen: 'Describe esta imagen enviada por un cliente en WhatsApp en 1-3 frases y copia TEXTUALMENTE todo texto visible. Si es un comprobante de pago (Yape, Plin, transferencia) indica monto, fecha, hora, banco y numero de operacion. Si es captura de un sistema o pantalla, resume que muestra. Sin introducciones.',
  pdf: 'Extrae el contenido de este documento: resume en maximo 8 lineas e incluye datos clave (nombres, RUC, montos, fechas). Sin introducciones.',
  video: 'Resume este video de WhatsApp en 1-3 frases e incluye textualmente lo que se diga o se lea en pantalla. Sin introducciones.',
};

// Respaldo gratuito por tipo (orden de intento). Los de NVIDIA razonan: se excluye el "pensamiento".
const GRATIS = {
  audio: [], // probado: el unico gratuito con audio rechaza OGG/Opus de WhatsApp (400); habria que convertir con ffmpeg
  imagen: ['nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free'],
  video: ['nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free'],
  pdf: [],
};

export async function leerConGemini({ base64, mimetype, tipo }) {
  const creds = await getGeminiCreds();
  if (!creds.apiKey) throw new Error('Sin clave de Gemini.');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(creds.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': creds.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPTS[tipo] }, { inline_data: { mime_type: mimetype, data: base64 } }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0.1, maxOutputTokens: 700 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const data = await r.json();
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

function parteOpenrouter({ base64, mimetype, tipo }) {
  const url = `data:${mimetype};base64,${base64}`;
  if (tipo === 'imagen') return { type: 'image_url', image_url: { url } };
  if (tipo === 'video') return { type: 'video_url', video_url: { url } };
  if (tipo === 'audio') {
    const format = /mpeg|mp3/.test(mimetype) ? 'mp3' : /wav/.test(mimetype) ? 'wav' : (mimetype.split('/')[1] || 'ogg').split(';')[0];
    return { type: 'input_audio', input_audio: { data: base64, format } };
  }
  return { type: 'file', file: { filename: 'documento.pdf', file_data: url } };
}

export async function leerConOpenrouter({ base64, mimetype, tipo }, model) {
  const creds = await getOpenrouterCreds();
  if (!creds.apiKey) throw new Error('Sin clave de OpenRouter.');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.1,
      reasoning: { exclude: true },
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPTS[tipo] }, parteOpenrouter({ base64, mimetype, tipo })] }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(`OpenRouter ${data?.error?.code || r.status}: ${String(data?.error?.message || '').slice(0, 120)}`);
  const msg = data?.choices?.[0]?.message;
  const texto = (typeof msg?.content === 'string' ? msg.content : '').trim();
  if (!texto) throw new Error('OpenRouter sin texto (solo razonamiento).');
  return texto;
}

// Devuelve el texto leido o '' si no se pudo (nunca lanza: leer es un extra, no debe romper el webhook).
export async function leerMedia({ base64, mimetype, tipo }) {
  if (!PROMPTS[tipo] || !base64 || (base64.length * 3) / 4 > MAX_BYTES) return '';
  try {
    const t = await leerConGemini({ base64, mimetype, tipo });
    if (t) return t;
  } catch (e) { console.error('[leer-media] Gemini:', e?.message || e); }
  for (const modelo of GRATIS[tipo] || []) {
    try {
      const t = await leerConOpenrouter({ base64, mimetype, tipo }, modelo);
      if (t) return t;
    } catch (e) { console.error('[leer-media] OpenRouter', modelo, e?.message || e); }
  }
  return '';
}
