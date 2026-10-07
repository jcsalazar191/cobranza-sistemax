import { Router } from 'express';
import { query, pool } from '../db.js';
import {
  enriquecerCliente, aISODia1, sumarMeses, avanzarCobertura, diffMeses,
} from '../logic.js';
import { tarifasDe, tarifasMap } from '../tarifas.js';
import {
  reqStr, optStr, reqWhatsapp, reqNum, reqInt, reqFecha, reqBool, optEnum, ValidationError,
} from '../validate.js';

const PERIODOS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

export const clientesRouter = Router();

// :id debe ser numerico (evita 500 por error de tipo en Postgres).
clientesRouter.param('id', (req, res, next, val) => {
  if (!/^\d+$/.test(val)) return res.status(404).json({ error: 'Cliente no encontrado.' });
  next();
});

// GET /api/clientes  -> lista enriquecida, ordenada por deuda desc.
// Incluye el ultimo recordatorio y la fecha del ultimo pago registrado.
clientesRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT MAX(r.fecha) FROM recordatorios r WHERE r.cliente_id = c.id) AS ultimo_recordatorio,
              (SELECT MAX(p.fecha) FROM pagos p WHERE p.cliente_id = c.id) AS ultimo_pago_fecha
       FROM clientes c
       ORDER BY c.nombre`,
    );
    const tmap = await tarifasMap();
    const data = rows.map((c) => enriquecerCliente({ ...c, tarifas: tmap.get(c.id) || [] }));
    data.sort((a, b) => b.deuda - a.deuda || a.nombre.localeCompare(b.nombre));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/clientes/resumen -> totales para el panel de arriba.
clientesRouter.get('/resumen', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM clientes');
    const tmap = await tarifasMap();
    const activos = rows.filter((c) => c.activo).map((c) => enriquecerCliente({ ...c, tarifas: tmap.get(c.id) || [] }));
    const deuda_total = activos.reduce((s, c) => s + c.deuda, 0);
    const morosos = activos.filter((c) => c.meses_debe >= 1).length;
    const criticos = activos.filter((c) => c.estado === 3).length;
    // Por vencer: al dia pero solo cubiertos hasta el mes en curso (vence pronto).
    const por_vencer = activos.filter((c) => c.deuda === 0 && c.meses_cobertura === 0).length;
    const ingreso_mensual = activos.reduce((s, c) => s + c.monto, 0);

    // Cobrado REAL del mes calendario actual (desde pagos).
    const { rows: cob } = await query(
      `SELECT COALESCE(SUM(monto_total), 0)::float AS total, COUNT(*)::int AS n
       FROM pagos
       WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)`,
    );

    res.json({
      deuda_total: Number(deuda_total.toFixed(2)),
      morosos,
      criticos,
      por_vencer,
      ingreso_mensual: Number(ingreso_mensual.toFixed(2)), // esperado (suma mensualidades)
      cobrado_mes_actual: Number(cob[0].total.toFixed(2)),
      pagos_mes_actual: cob[0].n,
      total_activos: activos.length,
    });
  } catch (err) { next(err); }
});

// GET /api/clientes/:id  -> cliente + historial de pagos.
clientesRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
    const { rows: pagos } = await query(
      'SELECT * FROM pagos WHERE cliente_id = $1 ORDER BY fecha DESC, id DESC',
      [req.params.id],
    );
    const tarifas = await tarifasDe(req.params.id);
    res.json({ ...enriquecerCliente({ ...rows[0], tarifas }), pagos, tarifas });
  } catch (err) { next(err); }
});

function parseClienteBody(body) {
  return {
    nombre: reqStr(body, 'nombre', { max: 200 }),
    whatsapp: reqWhatsapp(body),
    monto: reqNum(body, 'monto', { min: 0, max: 1e7 }),
    dia_cobro: reqInt(body, 'dia_cobro', { min: 1, max: 31 }),
    pagado_hasta: aISODia1(reqFecha(body, 'pagado_hasta')),
    activo: reqBool(body, 'activo', true),
    periodo: optEnum(body, 'periodo', PERIODOS, 'MENSUAL'),
    notas: optStr(body, 'notas', { max: 2000 }),
    cobro_vencido: reqBool(body, 'cobro_vencido', false), // paga al final del periodo
  };
}

// Tarifa base "desde siempre" (cubre todos los meses previos a cualquier cambio).
const TARIFA_BASE_DESDE = '2000-01-01';

// POST /api/clientes  -> crea cliente. Sin pagos: cobertura_base = pagado_hasta, saldo 0.
// Crea tambien la tarifa base (monto actual desde siempre) para el modelo por fechas.
clientesRouter.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const c = parseClienteBody(req.body);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO clientes (nombre, whatsapp, monto, dia_cobro, pagado_hasta, cobertura_base, saldo, activo, periodo, notas, cobro_vencido)
       VALUES ($1,$2,$3,$4,$5,$5,0,$6,$7,$8,$9) RETURNING *`,
      [c.nombre, c.whatsapp, c.monto, c.dia_cobro, c.pagado_hasta, c.activo, c.periodo, c.notas, c.cobro_vencido],
    );
    const nuevo = rows[0];
    await client.query(
      'INSERT INTO tarifas (cliente_id, monto, periodo, desde) VALUES ($1,$2,$3,$4)',
      [nuevo.id, nuevo.monto, nuevo.periodo, TARIFA_BASE_DESDE],
    );
    await client.query('COMMIT');
    const tarifas = [{ monto: nuevo.monto, periodo: nuevo.periodo, desde: TARIFA_BASE_DESDE }];
    res.status(201).json(enriquecerCliente({ ...nuevo, tarifas }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/clientes/:id  -> edita cliente (modelo por FECHAS).
// - Si cambia la cuota/periodo: se agrega una tarifa "desde <mes>" al historial
//   (default: mes actual; opcional body.tarifa_desde). Los meses previos conservan
//   su tarifa; la nueva rige desde esa fecha.
// - El pagado_hasta enviado es la cobertura deseada: si el usuario la mueve
//   manualmente, se desplaza la cobertura_base igual; luego se recalcula con el
//   dinero pagado y el historial de tarifas (deterministico).
clientesRouter.put('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const c = parseClienteBody(req.body);
    const tarifaDesde = req.body.tarifa_desde !== undefined && req.body.tarifa_desde !== ''
      ? aISODia1(reqFecha(req.body, 'tarifa_desde'))
      : null;
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      'SELECT monto, periodo, pagado_hasta, cobertura_base FROM clientes WHERE id = $1 FOR UPDATE', [req.params.id],
    );
    if (cur.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    const prev = cur[0];
    const { rows: sumRows } = await client.query(
      'SELECT COALESCE(SUM(monto_total), 0)::float AS t FROM pagos WHERE cliente_id = $1', [req.params.id],
    );
    const total = Number(sumRows[0].t);

    const cambioTarifa = Number(prev.monto) !== Number(c.monto) || prev.periodo !== c.periodo;
    // Por defecto rige desde el primer mes SIN cobertura (pagado_hasta + 1): con atraso
    // el anual/semestral cubre los meses impagos; con cobertura adelantada espera a que termine.
    const desde = tarifaDesde || aISODia1(sumarMeses(c.pagado_hasta, 1));

    // Historial de tarifas vigente (incluida la nueva si cambia la cuota).
    const { rows: tRows } = await client.query(
      "SELECT monto, periodo, to_char(desde, 'YYYY-MM-DD') AS desde FROM tarifas WHERE cliente_id = $1 ORDER BY desde, id", [req.params.id],
    );
    const tarifas = cambioTarifa
      ? [...tRows, { monto: c.monto, periodo: c.periodo, desde }]
      : tRows;

    // Desplaza la cobertura_base si el usuario movio manualmente el pagado_hasta.
    const base0 = prev.cobertura_base || prev.pagado_hasta;
    const delta = diffMeses(prev.pagado_hasta, c.pagado_hasta);
    const cobertura_base = aISODia1(sumarMeses(base0, delta));

    const { pagado_hasta, saldo } = avanzarCobertura(cobertura_base, total, tarifas, c.monto, c.periodo);

    if (cambioTarifa) {
      await client.query(
        'INSERT INTO tarifas (cliente_id, monto, periodo, desde) VALUES ($1,$2,$3,$4)',
        [req.params.id, c.monto, c.periodo, desde],
      );
    }
    const { rows } = await client.query(
      `UPDATE clientes SET nombre=$1, whatsapp=$2, monto=$3, dia_cobro=$4,
              pagado_hasta=$5, cobertura_base=$6, saldo=$7, activo=$8, periodo=$9, notas=$10, cobro_vencido=$11, dinero_aplicado=0
       WHERE id=$12 RETURNING *`,
      [c.nombre, c.whatsapp, c.monto, c.dia_cobro, pagado_hasta, cobertura_base, saldo, c.activo, c.periodo, c.notas, c.cobro_vencido, req.params.id],
    );
    // ?dry=1 = simulacion: devuelve el resultado (deuda, cobertura) sin guardar nada.
    await client.query(req.query.dry ? 'ROLLBACK' : 'COMMIT');
    res.json(enriquecerCliente({ ...rows[0], tarifas }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/clientes/:id  -> elimina cliente SOLO si no tiene pagos.
// Si ya tiene historial, no se borra: hay que darlo de baja (activo=false).
clientesRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT COUNT(*)::int AS n FROM pagos WHERE cliente_id = $1',
      [req.params.id],
    );
    if (rows[0].n > 0) {
      return res.status(409).json({
        error: 'No se puede eliminar: el cliente tiene pagos registrados. Usa "Dar de baja".',
      });
    }
    const { rowCount } = await query('DELETE FROM clientes WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
    res.status(204).end();
  } catch (err) { next(err); }
});
