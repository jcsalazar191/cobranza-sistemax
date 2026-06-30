// Migracion al modelo "saldo a favor".
// - Agrega columnas cobertura_base (DATE) y saldo (NUMERIC) a clientes.
// - Backfill: calcula cobertura_base de cada cliente de modo que el modelo
//   reproduzca su pagado_hasta ACTUAL, y fija el saldo (dinero a cuenta que aun
//   no completa un bloque). No cambia ninguna cobertura existente.
// Idempotente: re-ejecutarla da el mismo resultado.
import { pool } from '../src/db.js';
import { convertirSaldo, recomputarCobertura, aISODia1, sumarMeses } from '../src/logic.js';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cobertura_base DATE');
    await client.query('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo NUMERIC(10,2) NOT NULL DEFAULT 0');

    const { rows: clientes } = await client.query('SELECT * FROM clientes ORDER BY id');
    let cambios = 0;
    for (const c of clientes) {
      const { rows: s } = await client.query(
        'SELECT COALESCE(SUM(monto_total), 0)::float AS t FROM pagos WHERE cliente_id = $1', [c.id],
      );
      const total = Number(s[0].t);
      const monto = Number(c.monto);
      const adv = convertirSaldo(c.periodo, monto, total).mesesAvance;
      // base tal que recompute reproduzca el pagado_hasta actual.
      const base = aISODia1(sumarMeses(c.pagado_hasta, -adv));
      const { pagado_hasta, saldo } = recomputarCobertura(base, c.periodo, monto, total);
      await client.query(
        'UPDATE clientes SET cobertura_base = $1, pagado_hasta = $2, saldo = $3 WHERE id = $4',
        [base, pagado_hasta, saldo, c.id],
      );
      if (Number(saldo) > 0) {
        cambios += 1;
        console.log(`  ${c.nombre}: saldo a favor S/${saldo} (deuda baja)`);
      }
    }
    await client.query('COMMIT');
    console.log(`Migracion saldo OK: ${clientes.length} clientes (${cambios} con saldo a favor).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migracion fallo:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
