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
    -- Dia del mes en que cobra (1-31). Cada cliente tiene el suyo; en ese dia vence.
    dia_cobro     SMALLINT    NOT NULL DEFAULT 1 CHECK (dia_cobro BETWEEN 1 AND 31),
    -- Paga al FINAL del periodo (vencido) en vez de adelantado. Por defecto adelantado.
    cobro_vencido BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Ultimo mes cubierto (se guarda como el dia 1 de ese mes). DERIVADO: cobertura_base + bloques pagados.
    pagado_hasta  DATE        NOT NULL,
    -- Cobertura con 0 pagos (punto de partida para recalcular con el modelo de saldo).
    cobertura_base DATE,
    -- Dinero pagado a cuenta que aun no completa un bloque de cobertura (baja la deuda S/ por S/).
    saldo         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
    -- Dinero ya "sellado" en cobertura_base a una tarifa anterior (al cambiar la cuota).
    -- Solo el dinero por encima de esto se convierte a la tarifa actual (no re-valora lo pagado).
    dinero_aplicado NUMERIC(10,2) NOT NULL DEFAULT 0,
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
-- Tarifas (historial): "desde <mes> la cuota es <monto>/<periodo>".
-- Cada mes de cobertura/deuda se cobra a la tarifa VIGENTE ese mes.
-- La tarifa mas antigua cubre hacia atras. clientes.monto = tarifa actual.
-- ----------------------------------------------------------------
CREATE TABLE tarifas (
    id          SERIAL PRIMARY KEY,
    cliente_id  INTEGER     NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    monto       NUMERIC(10,2) NOT NULL CHECK (monto >= 0),
    periodo     TEXT        NOT NULL DEFAULT 'MENSUAL'
                CHECK (periodo IN ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL')),
    -- Dia 1 del mes desde el que rige esta tarifa.
    desde       DATE        NOT NULL,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tarifas_cliente ON tarifas(cliente_id, desde);

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

-- ----------------------------------------------------------------
-- Leads ("posibles"): personas que escriben por WhatsApp preguntando por
-- SysFarma (el producto). Base para el seguimiento con el copiloto de IA.
-- ----------------------------------------------------------------
CREATE TABLE leads (
    id                 SERIAL PRIMARY KEY,
    -- Telefono en formato Evolution (digitos con codigo pais, ej. 51987654321).
    telefono           VARCHAR(20)  NOT NULL UNIQUE,
    -- JID interno "@lid" de WhatsApp (identidad nueva, sin telefono visible en
    -- el JID) cuando WhatsApp enruta a este contacto por ahi en vez de por
    -- telefono. Permite resolver telefono en el webhook cuando llega asi.
    lid                VARCHAR(40)  UNIQUE,
    nombre             TEXT,
    -- nuevo|contactado|atendido|convertido|descartado
    estado             TEXT         NOT NULL DEFAULT 'nuevo',
    -- sin_clasificar (recien importado, en espera) | posible (prospecto real,
    -- entra al copiloto/IA) | conocido (amigo/cliente actual, se ignora para
    -- siempre). Los que escriben de verdad entran directo como 'posible'.
    categoria          TEXT         NOT NULL DEFAULT 'sin_clasificar'
                       CHECK (categoria IN ('sin_clasificar','posible','conocido')),
    foto_url           TEXT, -- foto de perfil de WhatsApp (URL directa, no se descarga)
    ciudad             TEXT,
    ultimo_mensaje     TEXT,
    mensajes_in        INTEGER      NOT NULL DEFAULT 0,
    primer_contacto    TIMESTAMPTZ,
    ultimo_contacto    TIMESTAMPTZ,
    ultimo_seguimiento TIMESTAMPTZ,
    notas              TEXT,
    -- Estado derivado por el copiloto. Se puede reconstruir desde el historial.
    memoria            JSONB,
    memoria_hasta      INTEGER NOT NULL DEFAULT 0,
    score              SMALLINT CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
    score_motivo       TEXT,
    creado_en          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_estado ON leads(estado);
CREATE INDEX idx_leads_ultimo_contacto ON leads(ultimo_contacto DESC);

-- ----------------------------------------------------------------
-- Conversacion por WhatsApp con cada lead. direccion: in = el lead escribio,
-- out = respondimos (tu o el copiloto). wa_message_id dedupe del webhook.
-- ----------------------------------------------------------------
CREATE TABLE lead_mensajes (
    id            SERIAL PRIMARY KEY,
    lead_id       INTEGER     NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    direccion     TEXT        NOT NULL CHECK (direccion IN ('in','out')),
    cuerpo        TEXT        NOT NULL,
    -- id del mensaje en WhatsApp (evita re-procesar entregas repetidas). NULL en salientes propios.
    wa_message_id TEXT        UNIQUE,
    wa_id         TEXT,
    tipo          TEXT,
    media_archivo TEXT,
    media_mime    TEXT,
    media_nombre  TEXT,
    media_texto   TEXT,
    automatico    BOOLEAN     NOT NULL DEFAULT FALSE,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_mensajes_lead ON lead_mensajes(lead_id, id);

-- ----------------------------------------------------------------
-- Feedback del copiloto. No es entrenamiento automatico del modelo: es el
-- dataset supervisado que se construye con lo que Jean acepta, corrige y con
-- el resultado real de cada conversacion.
-- ----------------------------------------------------------------
CREATE TABLE sugerencias (
    id                  SERIAL PRIMARY KEY,
    lead_id             INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sugerido            TEXT NOT NULL,
    enviado             TEXT,
    editado             BOOLEAN,
    etapa               TEXT,
    contexto            TEXT,
    resultado            TEXT CHECK (resultado IS NULL OR resultado IN
                         ('sin_respuesta','respondio','demo','cotizacion','negociacion','pago','rechazo','otro')),
    resultado_nota      TEXT,
    resultado_at        TIMESTAMPTZ,
    fecha               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sugerencias_lead_fecha ON sugerencias(lead_id, fecha DESC);
CREATE INDEX idx_sugerencias_resultado ON sugerencias(resultado) WHERE resultado IS NOT NULL;

CREATE INDEX idx_recordatorios_cliente ON recordatorios(cliente_id);
