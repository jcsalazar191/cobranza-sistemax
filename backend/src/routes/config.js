import { Router } from 'express';
import { query } from '../db.js';
import { optStr } from '../validate.js';

export const configRouter = Router();

const DEFAULTS = {
  mensaje_template:
    'Hola {nombre}, le recordamos su pago pendiente de S/ {deuda}, correspondiente a {rango_meses}. Gracias.',
  mensaje_aldia:
    'Hola {nombre}, su servicio esta cubierto hasta {cubierto}. Le recordamos su proxima renovacion. Gracias.',
};

// flash-lite-latest: cuota gratis mucho mas alta que 2.5-flash (que tiene ~20/dia).
const GEMINI_MODEL_DEFAULT = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

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

// Config publica: incluye si Gemini esta configurado, pero NO la key.
function publicCfg(cfg) {
  return {
    mensaje_template: cfg.mensaje_template ?? DEFAULTS.mensaje_template,
    mensaje_aldia: cfg.mensaje_aldia ?? DEFAULTS.mensaje_aldia,
    gemini_configurado: Boolean(cfg.gemini_api_key || process.env.GEMINI_API_KEY),
    gemini_model: cfg.gemini_model || GEMINI_MODEL_DEFAULT,
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
    const tpl = optStr(req.body, 'mensaje_template', { max: 1000 });
    const ald = optStr(req.body, 'mensaje_aldia', { max: 1000 });
    const model = optStr(req.body, 'gemini_model', { max: 100 });
    if (tpl) updates.mensaje_template = tpl;
    if (ald) updates.mensaje_aldia = ald;
    if (model) updates.gemini_model = model;

    let borrarKey = false;
    if (typeof req.body.gemini_api_key === 'string') {
      const k = req.body.gemini_api_key.trim();
      if (k.length > 400) throw new Error('API key demasiado larga.');
      if (k) updates.gemini_api_key = k;
      else borrarKey = true;
    }

    for (const [clave, valor] of Object.entries(updates)) {
      await query(
        `INSERT INTO config (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [clave, valor],
      );
    }
    if (borrarKey) await query("DELETE FROM config WHERE clave = 'gemini_api_key'");

    res.json(publicCfg(await cfgMap()));
  } catch (err) { next(err); }
});
