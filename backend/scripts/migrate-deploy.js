// Migraciones incrementales para deploy. No ejecutar schema.sql en produccion.
import 'dotenv/config';
import pg from 'pg';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrations, splitMigrations } from './migration-lib.js';

const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) {
  console.error('Uso: node scripts/migrate-deploy.js [--check|--apply]');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL es obligatorio para aplicar migraciones.');
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrations = readMigrations(resolve(__dirname, '../migrations'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const lockKey = '843027091';

async function assertBaselineSchema() {
  const required = ['clientes', 'pagos', 'config'];
  const { rows } = await client.query(
    'SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1)',
    [required],
  );
  const present = new Set(rows.map((row) => row.tablename));
  const missing = required.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`La base no coincide con el baseline; faltan tablas: ${missing.join(', ')}.`);
}

try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    git_commit TEXT NOT NULL
  )`);
  await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
  const { rows: applied } = await client.query('SELECT id, checksum FROM schema_migrations ORDER BY id');
  const pending = splitMigrations(migrations, applied);
  const result = {
    pending: pending.map((migration) => migration.id),
    pendingCount: pending.length,
    rollbackSafe: pending.every((migration) => migration.backwardCompatible),
  };

  if (mode === '--check') {
    console.log(JSON.stringify(result));
  } else {
    for (const migration of pending) {
      if (migration.id === '000_baseline') await assertBaselineSchema();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (id, checksum, git_commit) VALUES ($1, $2, $3)',
          [migration.id, migration.checksum, process.env.GIT_COMMIT || 'unknown'],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log(JSON.stringify({ ...result, applied: pending.map((migration) => migration.id) }));
  }
} catch (error) {
  console.error(`Migracion detenida: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]); } catch {}
  await client.end();
}
