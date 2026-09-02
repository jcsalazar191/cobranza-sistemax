ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_archivo TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_mime TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_nombre TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_texto TEXT;
CREATE INDEX IF NOT EXISTS idx_lead_mensajes_wa ON lead_mensajes(wa_id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score SMALLINT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_motivo TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS asignado_a TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bot_pausado_hasta TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS plantillas (
    id        SERIAL PRIMARY KEY,
    atajo     TEXT NOT NULL UNIQUE,
    titulo    TEXT NOT NULL,
    texto     TEXT NOT NULL,
    usos      INTEGER NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT 'migracion ok' AS estado;
