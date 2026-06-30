-- ============================================================
--  Cobranzas | schema.sql
--  PostgreSQL >= 14
--  Ejecutar contra la base de datos cobranza_db (ya creada).
-- ============================================================

-- Limpieza idempotente (re-ejecutable en local).
DROP TABLE IF EXISTS pagos CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;

-- ----------------------------------------------------------------
-- Clientes
-- ----------------------------------------------------------------
CREATE TABLE clientes (
    id            SERIAL PRIMARY KEY,
    nombre        TEXT        NOT NULL,
    -- WhatsApp: 9 digitos, sin +51 (ej. 987654321)
    whatsapp      VARCHAR(9)  NOT NULL CHECK (whatsapp ~ '^[0-9]{9}$'),
    -- Monto mensual en Soles
    monto         NUMERIC(10,2) NOT NULL CHECK (monto >= 0),
    -- Dia del mes en que cobra (1-31)
    dia_cobro     SMALLINT    NOT NULL DEFAULT 1 CHECK (dia_cobro BETWEEN 1 AND 31),
    -- Ultimo mes cubierto (se guarda como el dia 1 de ese mes). DERIVADO: cobertura_base + bloques pagados.
    pagado_hasta  DATE        NOT NULL,
    -- Cobertura con 0 pagos (punto de partida para recalcular con el modelo de saldo).
    cobertura_base DATE,
    -- Dinero pagado a cuenta que aun no completa un bloque de cobertura (baja la deuda S/ por S/).
    saldo         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
    activo        BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Plan de pago del cliente
    periodo       TEXT        NOT NULL DEFAULT 'MENSUAL'
                  CHECK (periodo IN ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL')),
    notas         TEXT,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------
-- Pagos
-- ----------------------------------------------------------------
CREATE TABLE pagos (
    id           SERIAL PRIMARY KEY,
    cliente_id   INTEGER     NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    fecha        DATE        NOT NULL DEFAULT CURRENT_DATE,
    -- Cuantos meses cubre el pago (1/3/6/12). meses = 0 -> abono parcial (no avanza)
    meses        SMALLINT    NOT NULL CHECK (meses >= 0),
    monto_total  NUMERIC(10,2) NOT NULL CHECK (monto_total >= 0),
    medio        TEXT        NOT NULL CHECK (medio IN ('EFECTIVO','BCP','BN','YAPE')),
    comprobante  TEXT,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagos_cliente ON pagos(cliente_id);
CREATE INDEX idx_clientes_activo ON clientes(activo);

-- ----------------------------------------------------------------
-- Config (clave/valor) - p.ej. plantilla del mensaje de WhatsApp
-- ----------------------------------------------------------------
CREATE TABLE config (
    clave  TEXT PRIMARY KEY,
    valor  TEXT NOT NULL
);

INSERT INTO config (clave, valor) VALUES
  ('mensaje_template',
   'Hola {nombre}, le recordamos su pago pendiente de S/ {deuda}, correspondiente a {rango_meses}. Gracias.'),
  ('mensaje_aldia',
   'Hola {nombre}, su servicio esta cubierto hasta {cubierto}. Le recordamos su proxima renovacion. Gracias.');

-- ----------------------------------------------------------------
-- Recordatorios enviados (log de avisos por WhatsApp)
-- ----------------------------------------------------------------
CREATE TABLE recordatorios (
    id         SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    fecha      DATE    NOT NULL DEFAULT CURRENT_DATE,
    tipo       TEXT    NOT NULL DEFAULT 'whatsapp',
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recordatorios_cliente ON recordatorios(cliente_id);
