import { Router } from 'express';
import { pool, query } from '../db.js';
import { enriquecerCliente, sumarMeses, aISODia1 } from '../logic.js';
import { reqInt, reqEnum, optStr, reqNum, reqFecha, ValidationError } from '../validate.js';

export const pagosRouter = Router();

pagosRouter.param('id', (req, res, next, val) => {
  if (!/^\d+$/.test(val)) return res.status(404).json({ error: 'Pago no encontrado.' });
  next();
});

// POST /api/pagos
// body: { cliente_id, meses, medio, comprobante?, monto_total? }
// Registra el pago y AVANZA pagado_hasta del cliente esa cantidad de meses.
pagosRouter.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const cliente_id = reqInt(req.body, 'cliente_id', { min: 1 });
    // meses = 0 -> abono parcial (no avanza pagado_hasta).
    const meses = reqInt(req.body, 'meses', { min: 0, max: 60 });
    const medio = reqEnum(req.body, 'medio', ['EFECTIVO', 'BCP', 'BN', 'YAPE']);
    const comprobante = optStr(req.body, 'comprobante', { max: 200 });
    // Fecha del pago: opcional (para registrar pagos de meses pasados). Default hoy.
    const fecha = req.body.fecha !== undefined && req.body.fecha !== ''
      ? reqFecha(req.body, 'fecha')
      : null;

    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM clientes WHERE id = $1 FOR UPDATE',
      [cliente_id],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    const cliente = rows[0];

    // monto_total: por defecto meses * monto del cliente; se puede sobreescribir.
    const monto_total = req.body.monto_total !== undefined
      ? reqNum(req.body, 'monto_total', { min: 0, max: 1e7 })
      : Number((meses * Number(cliente.monto)).toFixed(2));

    // Un abono (meses=0) debe traer monto > 0; un pago normal puede ser 0 no.
    if (meses === 0 && monto_total <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Un abono debe tener un monto mayor a 0.' });
    }

    // meses=0 deja pagado_hasta igual (abono no avanza la cobertura).
    const nuevoPagadoHasta = aISODia1(sumarMeses(cliente.pagado_hasta, meses));

    const { rows: pagoRows } = await client.query(
      `INSERT INTO pagos (cliente_id, fecha, meses, monto_total, medio, comprobante)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6) RETURNING *`,
      [cliente_id, fecha, meses, monto_total, medio, comprobante],
    );

    const { rows: cliRows } = await client.query(
      'UPDATE clientes SET pagado_hasta = $1 WHERE id = $2 RETURNING *',
      [nuevoPagadoHasta, cliente_id],
    );

    await client.query('COMMIT');
    res.status(201).json({
      pago: pagoRows[0],
      cliente: enriquecerCliente(cliRows[0]),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/pagos/:id -> anula un pago Y RETROCEDE pagado_hasta esos meses
// (transaccional, para no dejar la cobertura inflada).
pagosRouter.delete('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM pagos WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado.' });
    }
    const pago = rows[0];

    const { rows: cliRows } = await client.query(
      'SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [pago.cliente_id],
    );
    if (cliRows.length > 0) {
      const revertido = aISODia1(sumarMeses(cliRows[0].pagado_hasta, -pago.meses));
      await client.query('UPDATE clientes SET pagado_hasta = $1 WHERE id = $2', [revertido, pago.cliente_id]);
    }

    await client.query('DELETE FROM pagos WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});
