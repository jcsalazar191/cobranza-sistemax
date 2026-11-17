import { Router } from 'express';
import { query } from '../db.js';

export const ingresosRouter = Router();

// GET /api/ingresos/:anio
// Cobrado REAL por mes (desde la tabla pagos) para el año dado.
// Devuelve los 12 meses (con 0 si no hubo) + el detalle de pagos de cada mes.
ingresosRouter.get('/:anio', async (req, res, next) => {
  try {
    const anio = Number(req.params.anio);
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
      return res.status(400).json({ error: 'Año inválido.' });
    }

    const [{ rows }, { rows: altas }, { rows: activos }] = await Promise.all([
      query(
        `SELECT p.id, p.cliente_id, c.nombre, p.fecha, p.meses,
                p.monto_total, p.medio, p.comprobante,
                EXTRACT(MONTH FROM p.fecha)::int AS mes
         FROM pagos p
         JOIN clientes c ON c.id = p.cliente_id
         WHERE EXTRACT(YEAR FROM p.fecha) = $1
         ORDER BY p.fecha, p.id`,
        [anio],
      ),
      query(
        `SELECT EXTRACT(MONTH FROM creado_en AT TIME ZONE 'America/Lima')::int AS mes,
                COUNT(*)::int AS total
         FROM clientes
         WHERE creado_en >= make_timestamptz($1, 1, 1, 0, 0, 0, 'America/Lima')
           AND creado_en < make_timestamptz($1 + 1, 1, 1, 0, 0, 0, 'America/Lima')
         GROUP BY 1`,
        [anio],
      ),
      query('SELECT COUNT(*)::int AS total FROM clientes WHERE activo = TRUE'),
    ]);

    const meses = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1,
      total: 0,
      altas: 0,
      pagos: [],
    }));

    for (const alta of altas) meses[alta.mes - 1].altas = alta.total;

    for (const p of rows) {
      const m = meses[p.mes - 1];
      const monto = Number(p.monto_total);
      m.total += monto;
      m.pagos.push({
        id: p.id,
        cliente_id: p.cliente_id,
        nombre: p.nombre,
        fecha: p.fecha,
        meses: p.meses,
        monto_total: monto,
        medio: p.medio,
        comprobante: p.comprobante,
      });
    }
    meses.forEach((m) => { m.total = Number(m.total.toFixed(2)); });

    const total_anio = Number(meses.reduce((s, m) => s + m.total, 0).toFixed(2));
    const total_altas = meses.reduce((s, m) => s + m.altas, 0);
    res.json({ anio, total_anio, total_altas, clientes_activos: activos[0].total, meses });
  } catch (err) { next(err); }
});
