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

// GET /api/config -> { mensaje_template, mensaje_aldia }
configRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT clave, valor FROM config');
    const cfg = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
    res.json({
      mensaje_template: cfg.mensaje_template ?? DEFAULTS.mensaje_template,
      mensaje_aldia: cfg.mensaje_aldia ?? DEFAULTS.mensaje_aldia,
    });
  } catch (err) { next(err); }
});

// PUT /api/config -> guarda las plantillas enviadas (mensaje_template y/o mensaje_aldia)
configRouter.put('/', async (req, res, next) => {
  try {
    const updates = {};
    const tpl = optStr(req.body, 'mensaje_template', { max: 1000 });
    const ald = optStr(req.body, 'mensaje_aldia', { max: 1000 });
    if (tpl) updates.mensaje_template = tpl;
    if (ald) updates.mensaje_aldia = ald;

    for (const [clave, valor] of Object.entries(updates)) {
      await query(
        `INSERT INTO config (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [clave, valor],
      );
    }

    const { rows } = await query('SELECT clave, valor FROM config');
    const cfg = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
    res.json({
      mensaje_template: cfg.mensaje_template ?? DEFAULTS.mensaje_template,
      mensaje_aldia: cfg.mensaje_aldia ?? DEFAULTS.mensaje_aldia,
    });
  } catch (err) { next(err); }
});
