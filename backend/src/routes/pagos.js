import { Router } from 'express';
import { pool } from '../db.js';
import { enriquecerCliente, recalcularCoberturaPagos, inferirMesesPago } from '../logic.js';
import { reqInt, reqEnum, optStr, reqNum, reqFecha } from '../validate.js';

export const pagosRouter = Router();

pagosRouter.param('id', (req, res, next, val) => {
  if (!/^\d+$/.test(val)) return res.status(404).json({ error: 'Pago no encontrado.' });
  next();
});

// POST /api/pagos
// body: { cliente_id, monto_total, meses, medio, comprobante?, fecha? }
// `meses` es la cobertura elegida al registrar el pago y queda como fuente de
// verdad. El saldo solo refleja dinero sobrante/abonos; no recalcula meses viejos.
pagosRouter.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const cliente_id = reqInt(req.body, 'cliente_id', { min: 1 });
    const medio = reqEnum(req.body, 'medio', ['EFECTIVO', 'BCP', 'BN', 'YAPE']);
    const comprobante = optStr(req.body, 'comprobante', { max: 200 });
    const fecha = req.body.fecha !== undefined && req.body.fecha !== ''
      ? reqFecha(req.body, 'fecha')
      : null;
    const monto_total = reqNum(req.body, 'monto_total', { min: 0.01, max: 1e7 });
    const mesesSolicitados = req.body.meses === undefined
      ? null
      : reqInt(req.body, 'meses', { min: 0, max: 120 });

    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [cliente_id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    const cli = rows[0];
    const monto = Number(cli.monto);
    const base = cli.cobertura_base || cli.pagado_hasta;

    const { rows: tarifas } = await client.query(
      "SELECT monto, periodo, to_char(desde, 'YYYY-MM-DD') AS desde FROM tarifas WHERE cliente_id = $1 ORDER BY desde, id", [cliente_id],
    );
    const { rows: pagosPrevios } = await client.query(
      'SELECT meses, monto_total FROM pagos WHERE cliente_id = $1 ORDER BY id', [cliente_id],
    );
    const coberturaActual = recalcularCoberturaPagos(base, pagosPrevios, tarifas, monto, cli.periodo).pagado_hasta;
    const pagoMeses = mesesSolicitados ?? inferirMesesPago(coberturaActual, monto_total, tarifas, monto, cli.periodo);

    const { rows: pagoRows } = await client.query(
      `INSERT INTO pagos (cliente_id, fecha, meses, monto_total, medio, comprobante)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6) RETURNING *`,
      [cliente_id, fecha, pagoMeses, monto_total, medio, comprobante],
    );

    const { rows: pagos } = await client.query(
      'SELECT meses, monto_total FROM pagos WHERE cliente_id = $1 ORDER BY id', [cliente_id],
    );
    const { pagado_hasta, saldo } = recalcularCoberturaPagos(base, pagos, tarifas, monto, cli.periodo);
    const { rows: cliRows } = await client.query(
      'UPDATE clientes SET pagado_hasta = $1, saldo = $2, cobertura_base = $3 WHERE id = $4 RETURNING *',
      [pagado_hasta, saldo, base, cliente_id],
    );

    await client.query('COMMIT');
    res.status(201).json({ pago: pagoRows[0], cliente: enriquecerCliente(cliRows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/pagos/:id -> anula un pago y RECALCULA la cobertura desde
// cobertura_base + el total restante (deterministico, sin descuadres).
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

    const { rows: cliRows } = await client.query('SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [pago.cliente_id]);
    await client.query('DELETE FROM pagos WHERE id = $1', [req.params.id]);

    if (cliRows.length > 0) {
      const cli = cliRows[0];
      const base = cli.cobertura_base || cli.pagado_hasta;
      const { rows: tarifas } = await client.query(
        "SELECT monto, periodo, to_char(desde, 'YYYY-MM-DD') AS desde FROM tarifas WHERE cliente_id = $1 ORDER BY desde, id", [pago.cliente_id],
      );
      const { rows: pagos } = await client.query(
        'SELECT meses, monto_total FROM pagos WHERE cliente_id = $1 ORDER BY id', [pago.cliente_id],
      );
      const { pagado_hasta, saldo } = recalcularCoberturaPagos(base, pagos, tarifas, Number(cli.monto), cli.periodo);
      await client.query('UPDATE clientes SET pagado_hasta = $1, saldo = $2, cobertura_base = $3 WHERE id = $4', [pagado_hasta, saldo, base, pago.cliente_id]);
    }

    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});
