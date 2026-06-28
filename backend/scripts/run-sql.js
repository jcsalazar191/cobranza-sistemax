// Ejecuta un archivo .sql contra DATABASE_URL. Uso: node scripts/run-sql.js schema.sql
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error('Falta el archivo SQL. Ej: node scripts/run-sql.js schema.sql');
  process.exit(1);
}

const sqlPath = resolve(__dirname, '..', file);
const sql = readFileSync(sqlPath, 'utf8');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(sql);
  console.log(`OK: ${file} ejecutado.`);
} catch (err) {
  console.error(`Error ejecutando ${file}:`, err.message);
  process.exit(1);
} finally {
  await client.end();
}
