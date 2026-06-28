import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en .env');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Alinea la zona horaria de cada conexion con Peru (para CURRENT_DATE / date_trunc).
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'America/Lima'").catch(() => {});
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PG:', err.message);
});

export const query = (text, params) => pool.query(text, params);
