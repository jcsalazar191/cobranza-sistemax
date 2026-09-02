process.env.TZ = process.env.TZ || 'America/Lima'; // zona horaria Peru para los calculos de fecha
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { query } from './db.js';
import { authRouter, requireAuth, requireAdmin } from './auth.js';
import { clientesRouter } from './routes/clientes.js';
import { pagosRouter } from './routes/pagos.js';
import { exportRouter } from './routes/export.js';
import { importRouter } from './routes/import.js';
import { ingresosRouter } from './routes/ingresos.js';
import { configRouter, cargarDiaGracia } from './routes/config.js';
import { recordatoriosRouter } from './routes/recordatorios.js';
import { chatCobroRouter } from './routes/chatCobro.js';
import { waWebhookRouter } from './routes/waWebhook.js';
import { iniciarRecordatoriosCitas } from './recordatoriosCitas.js';
import { iniciarReporteSemanal } from './reporteSemanal.js';
import { leadsRouter } from './routes/leads.js';

const app = express();
const PORT = process.env.PORT || 3100;

// CORS: orígenes permitidos desde .env (coma-separado).
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true }));
app.set('trust proxy', 1); // detras de Apache (cookies Secure)

app.use(express.json({ limit: '5mb' })); // 5mb para permitir import de respaldo
app.use(cookieParser());

// Healthcheck (verifica la BD) - publico.
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

// Auth (login/logout/me) - publico.
app.use('/api', authRouter);

// Webhook de WhatsApp (Evolution) - PUBLICO: no manda cookie; se valida con el
// token del path. Debe ir ANTES del requireAuth.
app.use('/api/wa', waWebhookRouter);

// De aqui en adelante, todo /api requiere sesion.
app.use('/api', requireAuth);

app.use('/api/clientes', requireAdmin, clientesRouter);
app.use('/api/pagos', requireAdmin, pagosRouter);
app.use('/api/ingresos', requireAdmin, ingresosRouter);
app.use('/api/config', configRouter);
app.use('/api/recordatorios', requireAdmin, recordatoriosRouter);
app.use('/api/chat-cobro', requireAdmin, chatCobroRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/export', requireAdmin, exportRouter);
app.use('/api/import', requireAdmin, importRouter);

// 404 para rutas /api desconocidas.
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// En produccion: servir el frontend compilado (frontend/dist) desde el mismo servidor.
const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '../../frontend/dist');
if (existsSync(distDir)) {
  // Los assets llevan hash en el nombre -> cache largo. index.html sin cache
  // para que cada deploy se tome al instante (no quedarse con la app vieja).
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  // SPA fallback (cualquier ruta que no sea /api -> index.html).
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(distDir, 'index.html'));
  });
  console.log('Sirviendo frontend desde', distDir);
}

// Manejo de errores central.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // No filtrar mensajes internos (p.ej. errores de Postgres) en 500.
  const msg = status >= 500 ? 'Error interno del servidor.' : (err.message || 'Error.');
  res.status(status).json({ error: msg });
});

app.listen(PORT, () => {
  console.log(`API cobranza escuchando en http://localhost:${PORT}`);
  cargarDiaGracia(); // sincroniza el dia de plazo guardado
  iniciarRecordatoriosCitas(); // avisa por WhatsApp antes de que llegue cada cita
  iniciarReporteSemanal(); // resumen del embudo cada lunes 8am
});
