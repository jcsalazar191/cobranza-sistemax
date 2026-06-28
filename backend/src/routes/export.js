import { Router } from 'express';
import { query } from '../db.js';

export const exportRouter = Router();

// GET /api/export -> descarga un JSON de respaldo con todo.
exportRouter.get('/', async (req, res, next) => {
  try {
    const { rows: clientes } = await query('SELECT * FROM clientes ORDER BY id');
    const { rows: pagos } = await query('SELECT * FROM pagos ORDER BY id');
    const { rows: config } = await query('SELECT * FROM config ORDER BY clave');
    const { rows: recordatorios } = await query('SELECT * FROM recordatorios ORDER BY id');
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="respaldo-cobranza-${fecha}.json"`);
    res.send(JSON.stringify({
      version: 1,
      generado_en: new Date().toISOString(),
      clientes,
      pagos,
      config,
      recordatorios,
    }, null, 2));
  } catch (err) { next(err); }
});
