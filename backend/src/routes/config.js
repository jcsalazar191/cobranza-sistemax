import crypto from 'node:crypto';
import { Router } from 'express';
import { query } from '../db.js';
import { optStr, ValidationError } from '../validate.js';

export const configRouter = Router();

// PIN de acceso (4 digitos): bloqueo rapido sobre la sesion. Se guarda hasheado.
const PIN_SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion';
function hashPin(pin) {
  return crypto.createHmac('sha256', PIN_SECRET).update(String(pin)).digest('hex');
}
function pinIgual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const DEFAULTS = {
  mensaje_template:
    'Hola {nombre}, le recordamos su pago pendiente de S/ {deuda}, correspondiente a {rango_meses}. Gracias.',
  mensaje_aldia:
    'Hola {nombre}, su servicio esta cubierto hasta {cubierto}. Le recordamos su proxima renovacion. Gracias.',
};

// gemini-flash-latest: 1500/dia gratis y mejor extraccion que flash-lite (que
// se equivocaba creando clientes). NVIDIA cubre los 429/503 ocasionales.
const GEMINI_MODEL_DEFAULT = process.env.GEMINI_MODEL || 'gemini-flash-latest';
// NVIDIA NIM (OpenAI-compatible) como RESPALDO de texto cuando Gemini falla/429.
const NVIDIA_MODEL_DEFAULT = process.env.NVIDIA_MODEL || 'qwen/qwen3-next-80b-a3b-instruct';
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

async function cfgMap() {
  const { rows } = await query('SELECT clave, valor FROM config');
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
}

// Credenciales de Gemini para el chat. La key vive en la BD (la pone cada quien
// que despliegue desde Ajustes) o, como respaldo, en la env del servidor.
// NUNCA se devuelve al frontend.
export async function getGeminiCreds() {
  const cfg = await cfgMap();
  return {
    apiKey: cfg.gemini_api_key || process.env.GEMINI_API_KEY || '',
    model: cfg.gemini_model || GEMINI_MODEL_DEFAULT,
  };
}

// Credenciales del respaldo NVIDIA (OpenAI-compatible). Solo se usa si Gemini
// falla y la entrada es texto. La key nunca se devuelve al frontend.
export async function getNvidiaCreds() {
  const cfg = await cfgMap();
  return {
    apiKey: cfg.nvidia_api_key || process.env.NVIDIA_API_KEY || '',
    model: cfg.nvidia_model || NVIDIA_MODEL_DEFAULT,
    baseUrl: NVIDIA_BASE_URL,
  };
}

// Config publica: incluye si Gemini esta configurado, pero NO la key.
function publicCfg(cfg) {
  return {
    mensaje_template: cfg.mensaje_template ?? DEFAULTS.mensaje_template,
    mensaje_aldia: cfg.mensaje_aldia ?? DEFAULTS.mensaje_aldia,
    gemini_configurado: Boolean(cfg.gemini_api_key || process.env.GEMINI_API_KEY),
    gemini_model: cfg.gemini_model || GEMINI_MODEL_DEFAULT,
    nvidia_configurado: Boolean(cfg.nvidia_api_key || process.env.NVIDIA_API_KEY),
    pin_activo: Boolean(cfg.pin_hash),
  };
}

// GET /api/config
configRouter.get('/', async (req, res, next) => {
  try {
    res.json(publicCfg(await cfgMap()));
  } catch (err) { next(err); }
});

// PUT /api/config -> guarda plantillas, modelo y/o la API key de Gemini.
//   gemini_api_key: string no vacio = guardar; '' = borrar; ausente = no tocar.
configRouter.put('/', async (req, res, next) => {
  try {
    const updates = {};
    const borrar = [];
    const tpl = optStr(req.body, 'mensaje_template', { max: 1000 });
    const ald = optStr(req.body, 'mensaje_aldia', { max: 1000 });
    const gModel = optStr(req.body, 'gemini_model', { max: 100 });
    const nModel = optStr(req.body, 'nvidia_model', { max: 120 });
    if (tpl) updates.mensaje_template = tpl;
    if (ald) updates.mensaje_aldia = ald;
    if (gModel) updates.gemini_model = gModel;
    if (nModel) updates.nvidia_model = nModel;

    // API keys: string no vacio = guardar; '' = borrar; ausente = no tocar.
    for (const campo of ['gemini_api_key', 'nvidia_api_key']) {
      if (typeof req.body[campo] === 'string') {
        const k = req.body[campo].trim();
        if (k.length > 400) throw new Error('API key demasiado larga.');
        if (k) updates[campo] = k;
        else borrar.push(campo);
      }
    }

    // PIN de acceso: 4 digitos = guardar (hasheado); '' = quitar; ausente = no tocar.
    if (typeof req.body.pin === 'string') {
      const pin = req.body.pin.trim();
      if (pin === '') borrar.push('pin_hash');
      else if (/^\d{4}$/.test(pin)) updates.pin_hash = hashPin(pin);
      else throw new ValidationError('El PIN debe tener 4 digitos.');
    }

    for (const [clave, valor] of Object.entries(updates)) {
      await query(
        `INSERT INTO config (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [clave, valor],
      );
    }
    for (const clave of borrar) await query('DELETE FROM config WHERE clave = $1', [clave]);

    res.json(publicCfg(await cfgMap()));
  } catch (err) { next(err); }
});

// POST /api/config/verificar-pin { pin } -> { ok }. Segundo factor sobre la sesion.
configRouter.post('/verificar-pin', async (req, res, next) => {
  try {
    const pin = String(req.body?.pin ?? '').trim();
    const cfg = await cfgMap();
    if (!cfg.pin_hash) return res.json({ ok: true, sin_pin: true }); // no hay PIN configurado
    res.json({ ok: pinIgual(hashPin(pin), cfg.pin_hash) });
  } catch (err) { next(err); }
});
