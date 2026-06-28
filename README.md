# Cobranzas

Webapp interna de cobranzas (mobile-first). Controla la deuda mensual de tus
clientes de software: cuánto deben, quién está al día y quién en crítico,
registra pagos y manda recordatorios por WhatsApp.

- **Frontend:** React + Vite + Tailwind v4 (mobile-first, modo oscuro).
- **Backend:** Node + Express (API REST).
- **Base de datos:** PostgreSQL.

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
