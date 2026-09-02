import { query } from './db.js';

// Historial de tarifas de un cliente, ordenado por fecha de vigencia.
// `desde` se devuelve como texto 'YYYY-MM-DD' (evita ambiguedad de zona horaria).
export async function tarifasDe(clienteId) {
  const { rows } = await query(
    `SELECT monto, periodo, to_char(desde, 'YYYY-MM-DD') AS desde
     FROM tarifas WHERE cliente_id = $1 ORDER BY desde, id`,
    [clienteId],
  );
  return rows;
}

// Todas las tarifas agrupadas por cliente_id (para la lista de clientes).
export async function tarifasMap() {
  const { rows } = await query(
    `SELECT cliente_id, monto, periodo, to_char(desde, 'YYYY-MM-DD') AS desde
     FROM tarifas ORDER BY cliente_id, desde, id`,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.cliente_id)) map.set(r.cliente_id, []);
    map.get(r.cliente_id).push({ monto: r.monto, periodo: r.periodo, desde: r.desde });
  }
  return map;
}
