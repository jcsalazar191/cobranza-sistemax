import { Router } from 'express';
import { query } from '../db.js';
import { enriquecerCliente } from '../logic.js';
import { getGeminiCreds } from './config.js';

export const chatCobroRouter = Router();

const MEDIOS = ['EFECTIVO', 'BCP', 'BN', 'YAPE'];
const PERIODOS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
const ACCIONES = [
  'registrar_pago', 'eliminar_pago', 'crear_cliente', 'eliminar_cliente',
  'baja_cliente', 'reactivar_cliente', 'consultar', 'ninguna',
];

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

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    accion: { type: 'string', enum: ACCIONES },
    cliente_id: { type: 'integer' },
    monto: { type: 'number' },
    meses: { type: 'integer' },
    abono: { type: 'boolean' },
    fecha: { type: 'string' },
    medio: { type: 'string', enum: MEDIOS },
    nuevo_cliente: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        whatsapp: { type: 'string' },
        monto: { type: 'number' },
        periodo: { type: 'string', enum: PERIODOS },
        dia_cobro: { type: 'integer' },
      },
    },
    transcript: { type: 'string' },
    respuesta: { type: 'string' },
    faltan: { type: 'array', items: { type: 'string' } },
  },
  required: ['accion', 'respuesta'],
};

// POST /api/chat-cobro
// body: { texto?: string, audio?: { mime, data }, contexto?: object }
// Asistente de cobranzas con Gemini: detecta UNA accion y sus datos. La app
// SIEMPRE confirma en pantalla (no ejecuta nada solo).
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
        accion: 'ninguna',
        respuesta: 'Falta tu API key de Gemini. Configurala en Ajustes (boton "Mensaje") para usar el chat.',
      });
    }

    const { rows } = await query('SELECT * FROM clientes ORDER BY nombre');
    const clientes = rows.map((c) => enriquecerCliente(c));
    const lista = clientes
      .map((c) => `${c.id}: ${c.nombre} | ${c.periodo} | ${c.activo ? 'activo' : 'inactivo'} | debe S/${c.deuda} (${c.meses_debe}m) | pagado hasta ${c.pagado_hasta_label}`)
      .join('\n');

    const ctx = req.body.contexto && typeof req.body.contexto === 'object' ? req.body.contexto : null;

    const systemLines = [
      'Eres el asistente de cobranzas de un negocio en Peru. Interpretas un mensaje (texto o nota de voz) y decides UNA sola accion. La app SIEMPRE muestra una pantalla para confirmar; tu nunca ejecutas nada.',
      `Hoy es ${hoyLima()} (zona America/Lima).`,
      'ACCIONES (campo "accion"):',
      '- registrar_pago: alguien pago. Llena cliente_id, monto, meses (1 si no se dice; si es abono parcial: abono=true y meses=0), fecha, medio.',
      '- eliminar_pago: quiere borrar/anular un pago mal hecho. Pon cliente_id (la app abrira su ficha para anular el pago correcto).',
      '- crear_cliente: quiere agregar un cliente nuevo. Llena nuevo_cliente {nombre, whatsapp (9 digitos o vacio si no se dijo), monto, periodo, dia_cobro}.',
      '- eliminar_cliente: quiere eliminar o dar de baja un cliente. Pon cliente_id.',
      '- baja_cliente: dar de baja / desactivar un cliente. Pon cliente_id.',
      '- reactivar_cliente: volver a activar un cliente inactivo. Pon cliente_id.',
      '- consultar: pregunta por deudas, estado o quien debe. Responde con los datos de la lista. No cambia nada.',
      '- ninguna: saludo o no entendiste; pide que aclare.',
      'CLIENTES (usa el id EXACTO de esta lista; si no identificas a ninguno pon cliente_id=0):',
      lista || '(sin clientes)',
      `Medios validos: ${MEDIOS.join(', ')} (default EFECTIVO si no se menciona).`,
      'Reglas: fecha del pago YYYY-MM-DD ("hoy"=hoy, "ayer"=dia anterior, "el 15"=dia 15 de este mes; default hoy). faltan: "cliente" si la accion necesita cliente y cliente_id=0; "monto" si registrar_pago sin monto.',
      'respuesta: 1-2 frases calidas en espanol peruano. Si falta un dato, pidelo amable. Si es consulta, responde el dato. Si es una accion, di que abriras la pantalla para revisar/confirmar.',
      'MUY IMPORTANTE: en "respuesta" y "transcript" NO uses tildes, acentos ni la letra enie (solo letras a-z), porque el audio corrompe los acentos.',
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
      if (!texto) parts.push({ text: 'Interpreta esta nota de voz y decide la accion.' });
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
      return res.status(502).json({ error: 'El asistente no respondio. Intenta de nuevo o usa el cobro manual.' });
    }

    const data = await r.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      return res.status(502).json({ error: 'Respuesta del asistente no valida. Intenta de nuevo.' });
    }

    const accion = ACCIONES.includes(parsed.accion) ? parsed.accion : 'ninguna';
    const cli = clientes.find((c) => c.id === Number(parsed.cliente_id)) || null;
    const monto = Number(parsed.monto) > 0 ? Number(parsed.monto) : null;
    const abono = Boolean(parsed.abono);
    let meses = Number.isInteger(parsed.meses) ? parsed.meses : null;
    if (abono) meses = 0;
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(parsed.fecha || '') ? parsed.fecha : hoyLima();
    const medio = MEDIOS.includes(parsed.medio) ? parsed.medio : 'EFECTIVO';
    const faltan = Array.isArray(parsed.faltan) ? parsed.faltan : [];

    let nuevo = null;
    if (parsed.nuevo_cliente && typeof parsed.nuevo_cliente === 'object') {
      const n = parsed.nuevo_cliente;
      nuevo = {
        nombre: limpiarTexto(n.nombre),
        whatsapp: /^\d{9}$/.test(String(n.whatsapp || '')) ? String(n.whatsapp) : '',
        monto: Number(n.monto) > 0 ? Number(n.monto) : null,
        periodo: PERIODOS.includes(n.periodo) ? n.periodo : 'MENSUAL',
        dia_cobro: Number.isInteger(n.dia_cobro) && n.dia_cobro >= 1 && n.dia_cobro <= 31 ? n.dia_cobro : 1,
      };
    }

    res.json({
      configurado: true,
      accion,
      cliente: cli ? { id: cli.id, nombre: cli.nombre, periodo: cli.periodo, activo: cli.activo } : null,
      monto,
      meses,
      abono,
      fecha,
      medio,
      nuevo_cliente: nuevo,
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
