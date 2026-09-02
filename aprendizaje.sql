-- Migracion idempotente para instalaciones existentes.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS memoria JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS memoria_hasta INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score SMALLINT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_motivo TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_archivo TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_mime TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_nombre TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS media_texto TEXT;
ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS automatico BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sugerencias (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sugerido TEXT NOT NULL,
    enviado TEXT,
    editado BOOLEAN,
    etapa TEXT,
    contexto TEXT,
    resultado TEXT,
    resultado_nota TEXT,
    resultado_at TIMESTAMPTZ,
    fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sugerencias ADD COLUMN IF NOT EXISTS resultado TEXT;
ALTER TABLE sugerencias ADD COLUMN IF NOT EXISTS resultado_nota TEXT;
ALTER TABLE sugerencias ADD COLUMN IF NOT EXISTS resultado_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sugerencias_lead_fecha ON sugerencias(lead_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_sugerencias_resultado ON sugerencias(resultado) WHERE resultado IS NOT NULL;
