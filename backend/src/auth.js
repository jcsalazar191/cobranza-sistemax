import crypto from 'node:crypto';
import { Router } from 'express';

// Login simple de un solo usuario (credenciales y secreto desde .env).
const EMAIL = (process.env.AUTH_EMAIL || 'admin@ejemplo.com').toLowerCase();
const PASSWORD = process.env.AUTH_PASSWORD || 'changeme';
const SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const DIAS = 30;
const COOKIE = 'sesion';

function firmar(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verificar(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const esperado = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// Comparacion en tiempo (semi) constante para evitar timing trivial.
function igual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (verificar(token)) return next();
  return res.status(401).json({ error: 'No autorizado.' });
}

export const authRouter = Router();

// POST /api/login { email, password }
authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!igual(email, EMAIL) || !igual(password, PASSWORD)) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }
  const exp = Date.now() + DIAS * 86400000;
  const token = firmar({ email, exp });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: DIAS * 86400000,
    path: '/',
  });
  res.json({ ok: true, email });
});

// POST /api/logout
authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// GET /api/me -> 200 si hay sesion valida, 401 si no.
authRouter.get('/me', (req, res) => {
  const payload = verificar(req.cookies?.[COOKIE]);
  if (!payload) return res.status(401).json({ error: 'No autorizado.' });
  res.json({ email: payload.email });
});
