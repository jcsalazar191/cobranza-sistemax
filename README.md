# Cobranzas

Webapp de cobranzas (mobile-first) para pequeños negocios. Controla la deuda de
tus clientes: cuánto deben, quién está al día y quién en crítico, registra pagos
(con modelo de **saldo a favor**), manda recordatorios por WhatsApp y registra
cobros **por chat de voz o texto** con un asistente de IA.

- **Frontend:** React + Vite + Tailwind v4 (mobile-first, modo oscuro).
- **Backend:** Node + Express (API REST).
- **Base de datos:** PostgreSQL.
- **Asistente IA (opcional):** chat de voz/texto para registrar pagos, anular,
  crear clientes y consultar deudas. Usa **tu propia API key gratuita** de Gemini
  (y NVIDIA como respaldo) — se configura dentro de la app, en Ajustes.

> **Auto-hospedable y privado:** es código abierto (MIT). Lo despliegas en tu
> propio servidor, así que **tus datos de cobranza viven contigo**, no en la nube
> de nadie. Cada despliegue es una instancia independiente.

---

## Estructura

```
apk-cobranza/
├─ backend/          API Express + lógica de deuda
│  ├─ src/
│  ├─ scripts/run-sql.js
│  ├─ schema.sql     estructura de tablas
│  ├─ seed.sql       datos de ejemplo (reemplazar por tus clientes)
│  └─ .env
└─ frontend/         React + Vite
   ├─ src/
   └─ .env
```

---

## Desplegar con Docker (recomendado para tu servidor)

La forma más simple de tener tu propia instancia. Necesitas **Docker** y
**Docker Compose**. El stack levanta la app (Node, sirve API + frontend en el
puerto `3100`) y un PostgreSQL dedicado, aislados.

```bash
git clone https://github.com/jcsalazar191/cobranza-sistemax.git
cd cobranza-sistemax

# 1) Configura el entorno (claves fuertes con: openssl rand -base64 24)
cp .env.deploy.example .env
nano .env          # DB_PASSWORD, AUTH_EMAIL, AUTH_PASSWORD, SESSION_SECRET

# 2) Levanta todo
docker compose up -d --build
```

La app queda en `http://127.0.0.1:3100`. Para exponerla con dominio + HTTPS, pon
un reverse-proxy delante (Apache/Nginx) apuntando a ese puerto. Los datos
persisten en el volumen `pgdata`.

- **Login:** el usuario/clave que pusiste en `AUTH_EMAIL` / `AUTH_PASSWORD`.
- **Asistente IA (opcional):** entra a **Ajustes** (botón "Mensaje") y pega tu
  API key gratuita de [Gemini](https://aistudio.google.com/apikey)
  (y opcionalmente [NVIDIA](https://build.nvidia.com) como respaldo). Sin key, el
  chat avisa y todo lo demás funciona igual. **La key se guarda en tu base de
  datos, nunca se comparte.**

> Para correrlo en local sin Docker (desarrollo), mira la sección siguiente.

---

## Lógica de deuda

- `pagado_hasta` = primer día del **último mes cubierto** (ej. `2026-05-01`).
- `meses_debe` = meses completos entre `pagado_hasta` y el mes actual (mínimo 0).
- `deuda` = `meses_debe × monto`.
- Estado: `0` AL DÍA (verde), `1` 1 MES (amarillo), `2` 2 MESES (naranja),
  `3+` CRÍTICO (rojo).
- Al registrar un pago de N meses, `pagado_hasta` avanza N meses.

---

## Requisitos

- Node.js 18+ (probado con 22)
- PostgreSQL 14+ corriendo en `127.0.0.1:5432`

---

## 1) Correr en local

### a. Base de datos

Crea la base `cobranza_db` (una sola vez). Con `psql`:

```bash
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE cobranza_db"
```

> En Windows el `psql` suele estar en
> `C:\Program Files\PostgreSQL\18\bin\psql.exe`.

### b. Backend

```bash
cd backend
cp .env.example .env          # Windows: copy .env.example .env
# Edita .env y pon tu password de postgres en DATABASE_URL
npm install
npm run migrate               # crea las tablas (schema.sql)
npm run seed                  # carga datos de ejemplo (seed.sql)
npm run dev                   # API en http://localhost:3100
```

Verificación rápida: abre <http://localhost:3100/api/health> → `{"ok":true}`.

### c. Frontend (en otra terminal)

```bash
cd frontend
cp .env.example .env          # Windows: copy .env.example .env
npm install
npm run dev                   # App en http://localhost:5173
```

Abre <http://localhost:5173> en el navegador (o desde el celular usando la IP
de tu PC: `npm run dev -- --host` y entra a `http://TU_IP:5173`).

---

## 2) Variables de entorno

**backend/.env**

| Variable       | Ejemplo                                                          |
|----------------|------------------------------------------------------------------|
| `DATABASE_URL` | `postgresql://postgres:TU_PASS@127.0.0.1:5432/cobranza_db`       |
| `PORT`         | `3100`                                                           |
| `CORS_ORIGIN`  | `http://localhost:5173`                                          |

**frontend/.env**

| Variable       | Ejemplo                          |
|----------------|----------------------------------|
| `VITE_API_URL` | `http://localhost:3100/api`      |

---

## 3) API REST

| Método | Ruta                       | Descripción                                   |
|--------|----------------------------|-----------------------------------------------|
| GET    | `/api/health`              | Healthcheck                                   |
| GET    | `/api/clientes`            | Lista (deuda calculada, ordenada por deuda)   |
| GET    | `/api/clientes/resumen`    | KPIs: deuda total, morosos, críticos, ingreso |
| GET    | `/api/clientes/:id`        | Cliente + historial de pagos                  |
| POST   | `/api/clientes`            | Crear cliente                                 |
| PUT    | `/api/clientes/:id`        | Editar cliente                                |
| DELETE | `/api/clientes/:id`        | Eliminar cliente (y sus pagos)                |
| POST   | `/api/pagos`               | Registrar pago (avanza `pagado_hasta`; acepta `fecha` opcional) |
| DELETE | `/api/pagos/:id`           | Eliminar un pago                              |
| DELETE | `/api/pagos/:id`           | Anula un pago (retrocede `pagado_hasta`)      |
| GET    | `/api/ingresos/:anio`      | Cobrado real por mes (12) + detalle de pagos  |
| GET    | `/api/config`              | Plantillas de WhatsApp (deuda y al día)       |
| PUT    | `/api/config`              | Guardar plantillas                            |
| POST   | `/api/recordatorios`       | Registra un aviso enviado (cliente_id)        |
| GET    | `/api/export`              | Descarga JSON de respaldo (todo + config)     |
| POST   | `/api/import`              | Restaura desde un respaldo JSON (reemplaza)   |
| POST   | `/api/import/clientes`     | Carga masiva: upsert por nombre (CSV)         |

Notas:
- `DELETE /api/clientes/:id` solo elimina si el cliente **no tiene pagos**; si
  tiene historial, dalo de baja (`activo=false`).
- Plantillas con placeholders: deuda → `{nombre}` `{deuda}` `{meses}` `{monto}`
  `{periodo}`; al día → `{nombre}` `{cubierto}` `{monto}` `{periodo}`
  (editables desde el botón **Mensaje**).
- **Datos** (botón en la app): descargar respaldo, restaurar JSON, o importar
  clientes desde CSV (columnas: nombre, whatsapp, monto, dia_cobro,
  pagado_hasta, periodo, activo; solo `nombre` obligatorio).
- Deuda con **cobro adelantado**: el mes en curso no vence hasta pasado el día
  10 (`DIA_GRACIA` en `logic.js`).

Ejemplo registrar pago:

```json
POST /api/pagos
{ "cliente_id": 1, "meses": 3, "medio": "YAPE", "comprobante": "op-123" }
```

---

## 4) Cargar tus clientes

Edita `backend/seed.sql` y reemplaza las filas de ejemplo por tus clientes
reales (formato indicado en el archivo). Luego:

```bash
cd backend
npm run seed
```

> `seed.sql` hace `TRUNCATE` antes de insertar: borra lo existente y deja solo
> lo del archivo. Úsalo solo para la carga inicial.

---

## 5) Build de producción (un solo servidor)

```bash
cd frontend
npm run build         # genera frontend/dist/  (usa VITE_API_URL=/api)
cd ../backend
npm start             # sirve la API y el frontend en http://localhost:3100
```

Cuando `frontend/dist/` existe, el backend lo sirve automáticamente (mismo
puerto que la API, con SPA fallback). Para producción real falta agregar
autenticación y HTTPS. La zona horaria queda fijada a `America/Lima`.

> En desarrollo se usan dos servidores: `backend` (`npm run dev`, :3100) y
> `frontend` (`npm run dev`, :5173 con hot-reload).

---

## Respaldo

Botón **Respaldo** (arriba derecha) o `GET /api/export`: descarga un JSON con
todos los clientes y pagos.

---

## Privacidad y seguridad

- Tus datos (clientes, pagos) viven **solo en tu servidor/base de datos**.
- Las API keys de IA se guardan en tu base de datos y **nunca se exponen** al
  frontend ni se comparten.
- Antes de exponer la app a internet: usa una `AUTH_PASSWORD` fuerte, HTTPS, y
  haz respaldos del volumen de Postgres.

## Licencia

[MIT](LICENSE) — úsalo, modifícalo y despliégalo libremente. Sin garantía.
