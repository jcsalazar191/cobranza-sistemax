import { Router } from 'express';
import { query } from '../db.js';
import {
  enriquecerCliente, aISODia1, sumarMeses, convertirSaldo, recomputarCobertura,
} from '../logic.js';
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
// Incluye ultimo_recordatorio (fecha del ultimo aviso por WhatsApp).
clientesRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT MAX(r.fecha) FROM recordatorios r WHERE r.cliente_id = c.id) AS ultimo_recordatorio
       FROM clientes c
       ORDER BY c.nombre`,
    );
    const data = rows.map((c) => enriquecerCliente(c));
    data.sort((a, b) => b.deuda - a.deuda || a.nombre.localeCompare(b.nombre));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/clientes/resumen -> totales para el panel de arriba.
clientesRouter.get('/resumen', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM clientes');
    const activos = rows.filter((c) => c.activo).map((c) => enriquecerCliente(c));
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
    res.json({ ...enriquecerCliente(rows[0]), pagos });
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

// POST /api/clientes  -> crea cliente. Sin pagos: cobertura_base = pagado_hasta, saldo 0.
clientesRouter.post('/', async (req, res, next) => {
  try {
    const c = parseClienteBody(req.body);
    const { rows } = await query(
      `INSERT INTO clientes (nombre, whatsapp, monto, dia_cobro, pagado_hasta, cobertura_base, saldo, activo, periodo, notas, cobro_vencido)
       VALUES ($1,$2,$3,$4,$5,$5,0,$6,$7,$8,$9) RETURNING *`,
      [c.nombre, c.whatsapp, c.monto, c.dia_cobro, c.pagado_hasta, c.activo, c.periodo, c.notas, c.cobro_vencido],
    );
    res.status(201).json(enriquecerCliente(rows[0]));
  } catch (err) { next(err); }
});

// PUT /api/clientes/:id  -> edita cliente. El "pagado_hasta" que manda el usuario
// es la cobertura deseada; calculamos cobertura_base para que el modelo de saldo
// (con los pagos existentes) la reproduzca, y recalculamos saldo.
clientesRouter.put('/:id', async (req, res, next) => {
  try {
    const c = parseClienteBody(req.body);
    const { rows: cur } = await query(
      'SELECT monto, periodo, saldo, dinero_aplicado FROM clientes WHERE id = $1', [req.params.id],
    );
    if (cur.length === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
    const prev = cur[0];
    const { rows: sumRows } = await query(
      'SELECT COALESCE(SUM(monto_total), 0)::float AS t FROM pagos WHERE cliente_id = $1', [req.params.id],
    );
    const total = Number(sumRows[0].t);

    const cambioTarifa = Number(prev.monto) !== Number(c.monto) || prev.periodo !== c.periodo;
    let cobertura_base;
    let dinero_aplicado;
    if (cambioTarifa) {
      // SELLADO: lo ya cubierto/pagado queda a la tarifa VIEJA (se marca como dinero
      // ya aplicado); la nueva tarifa solo afecta pagos futuros y meses aun no pagados.
      cobertura_base = c.pagado_hasta;
      dinero_aplicado = Math.max(0, Number((total - Number(prev.saldo || 0)).toFixed(2)));
    } else {
      // Sin cambio de tarifa: conserva el dinero_aplicado y reproduce el pagado_hasta enviado.
      dinero_aplicado = Number(prev.dinero_aplicado) || 0;
      const disponible = Math.max(0, total - dinero_aplicado);
      const adv = convertirSaldo(c.periodo, c.monto, disponible).mesesAvance;
      cobertura_base = aISODia1(sumarMeses(c.pagado_hasta, -adv));
    }
    const { pagado_hasta, saldo } = recomputarCobertura(cobertura_base, c.periodo, c.monto, total, dinero_aplicado);

    const { rows } = await query(
      `UPDATE clientes SET nombre=$1, whatsapp=$2, monto=$3, dia_cobro=$4,
              pagado_hasta=$5, cobertura_base=$6, saldo=$7, activo=$8, periodo=$9, notas=$10, cobro_vencido=$11, dinero_aplicado=$12
       WHERE id=$13 RETURNING *`,
      [c.nombre, c.whatsapp, c.monto, c.dia_cobro, pagado_hasta, cobertura_base, saldo, c.activo, c.periodo, c.notas, c.cobro_vencido, dinero_aplicado, req.params.id],
    );
    res.json(enriquecerCliente(rows[0]));
  } catch (err) { next(err); }
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
