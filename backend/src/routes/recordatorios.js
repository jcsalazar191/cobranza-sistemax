import { Router } from 'express';
import { query } from '../db.js';
import { reqInt, optStr } from '../validate.js';

export const recordatoriosRouter = Router();

// POST /api/recordatorios { cliente_id, tipo? } -> registra que se aviso al cliente.
recordatoriosRouter.post('/', async (req, res, next) => {
  try {
    const cliente_id = reqInt(req.body, 'cliente_id', { min: 1 });
    const tipo = optStr(req.body, 'tipo', { max: 30 }) || 'whatsapp';
    const { rows } = await query(
      'INSERT INTO recordatorios (cliente_id, tipo) VALUES ($1, $2) RETURNING *',
      [cliente_id, tipo],
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});
