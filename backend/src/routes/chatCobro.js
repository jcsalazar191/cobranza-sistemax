import { Router } from 'express';
import { query } from '../db.js';
import { getGeminiCreds } from './config.js';

export const chatCobroRouter = Router();

const MEDIOS = ['EFECTIVO', 'BCP', 'BN', 'YAPE'];

// Gemini, cuando hay audio en la entrada, a veces corrompe los bytes de algunas
// tildes (p.ej. "í"). Por eso pedimos respuesta sin acentos y, por si acaso,
// limpiamos el caracter de reemplazo (U+FFFD) y el soft hyphen (U+00AD) que deja.
function limpiarTexto(s) {
  return String(s || '')
    .replace(/�/g, '')  // caracter de reemplazo de UTF-8 roto
    .replace(/­/g, '')  // soft hyphen que deja la corrupcion
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Fecha de hoy en hora local (el proceso corre con TZ=America/Lima).
function hoyLima() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Esquema de salida estructurada que le pedimos a Gemini.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    cliente_id: { type: 'integer' },
    monto: { type: 'number' },
    meses: { type: 'integer' },
    abono: { type: 'boolean' },
    fecha: { type: 'string' },
    medio: { type: 'string', enum: MEDIOS },
    transcript: { type: 'string' },
    respuesta: { type: 'string' },
    faltan: { type: 'array', items: { type: 'string' } },
  },
  required: ['cliente_id', 'monto', 'respuesta'],
};

// POST /api/chat-cobro
// body: { texto?: string, audio?: { mime: string, data: base64 } }
// Usa Gemini para entender (texto o nota de voz) y devolver el pago + una
// respuesta humana. La key se lee de la config (BD) o de la env del servidor.
chatCobroRouter.post('/', async (req, res, next) => {
  try {
    const texto = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
    const audio = req.body.audio && typeof req.body.audio === 'object' ? req.body.audio : null;
    if (!texto && !(audio && audio.data)) {
      return res.status(400).json({ error: 'Envia texto o audio.' });
    }

    const { apiKey, model } = await getGeminiCreds();
    if (!apiKey) {
      return res.json({
        configurado: false,
        respuesta: 'Falta tu API key de Gemini. Configurala en Ajustes (boton "Mensaje") para usar el chat. El cobro manual funciona igual.',
      });
    }

    const { rows: clientes } = await query(
      'SELECT id, nombre, periodo FROM clientes WHERE activo = true ORDER BY nombre',
    );
    const lista = clientes.map((c) => `${c.id}: ${c.nombre} (${c.periodo})`).join('\n');

    const ctx = req.body.contexto && typeof req.body.contexto === 'object' ? req.body.contexto : null;

    const systemLines = [
      'Eres el asistente de cobranzas de un negocio en Peru. A partir de un mensaje (texto o nota de voz) de la persona que cobra, identifica UN pago y devuelve sus datos.',
      `Hoy es ${hoyLima()} (zona horaria America/Lima).`,
      'CLIENTES (usa el id EXACTO de la lista; si no identificas a ninguno pon cliente_id=0):',
      lista || '(sin clientes activos)',
      `Medios validos: ${MEDIOS.join(', ')} (default EFECTIVO si no se menciona).`,
      'Reglas:',
      '- monto: en soles (numero). Si no se menciona, 0.',
      '- meses: cuantos meses cubre el pago (1 si no se dice). Si es abono parcial: abono=true y meses=0.',
      '- fecha: del pago, formato YYYY-MM-DD. "hoy"=hoy, "ayer"=dia anterior, "el 15"=dia 15 de este mes. Default hoy.',
      '- transcript: lo que entendiste (transcribe la nota de voz si la hay).',
      '- faltan: incluye "cliente" si cliente_id=0, y "monto" si monto=0.',
      '- respuesta: 1-2 frases calidas y naturales en espanol peruano. Si falta algo, pidelo amable; si esta completo, confirma el cobro (cliente, monto, medio).',
      'MUY IMPORTANTE: escribe "respuesta" y "transcript" SIN tildes, sin acentos y sin la letra enie (solo letras a-z), porque el canal de audio corrompe los acentos. Ej: usa "registre", "cuanto", "podrias", "si".',
    ];
    if (ctx) {
      systemLines.push(`Datos ya conocidos de este cobro (mantenlos y completa solo lo que falte): ${JSON.stringify(ctx)}`);
    }
    const system = systemLines.join('\n');

    const parts = [];
    if (texto) parts.push({ text: texto });
    if (audio && audio.data) {
      const mime = String(audio.mime || 'audio/wav').split(';')[0];
      parts.push({ inline_data: { mime_type: mime, data: audio.data } });
      if (!texto) parts.push({ text: 'Transcribe esta nota de voz y registra el pago.' });
    }

    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.2,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      const errTxt = await r.text().catch(() => '');
      console.error('Gemini error', r.status, errTxt.slice(0, 400));
      return res.status(502).json({ error: 'El asistente no respondio. Intenta de nuevo o registra el pago manual.' });
    }

    const data = await r.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      return res.status(502).json({ error: 'Respuesta del asistente no valida. Intenta de nuevo.' });
    }

    const cli = clientes.find((c) => c.id === Number(parsed.cliente_id)) || null;
    const monto = Number(parsed.monto) > 0 ? Number(parsed.monto) : null;
    const abono = Boolean(parsed.abono);
    let meses = Number.isInteger(parsed.meses) ? parsed.meses : null;
    if (abono) meses = 0;
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(parsed.fecha || '') ? parsed.fecha : hoyLima();
    const medio = MEDIOS.includes(parsed.medio) ? parsed.medio : 'EFECTIVO';
    const faltan = Array.isArray(parsed.faltan) ? parsed.faltan : [];

    res.json({
      configurado: true,
      cliente: cli ? { id: cli.id, nombre: cli.nombre, periodo: cli.periodo } : null,
      monto,
      meses,
      abono,
      fecha,
      medio,
      transcript: limpiarTexto(parsed.transcript),
      respuesta: limpiarTexto(parsed.respuesta),
      faltan,
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      return res.status(504).json({ error: 'El asistente tardo demasiado. Intenta de nuevo.' });
    }
    next(err);
  }
});
