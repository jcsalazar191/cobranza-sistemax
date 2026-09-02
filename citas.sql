CREATE TABLE IF NOT EXISTS citas (
    id                    SERIAL PRIMARY KEY,
    lead_id               INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    fecha_hora            TIMESTAMPTZ NOT NULL,
    texto                 TEXT NOT NULL,
    recordatorio_minutos  INTEGER NOT NULL DEFAULT 30,
    recordatorio_enviado_at TIMESTAMPTZ,
    estado                TEXT NOT NULL DEFAULT 'pendiente',
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_citas_pendientes ON citas(fecha_hora) WHERE recordatorio_enviado_at IS NULL AND estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_citas_lead ON citas(lead_id);

-- Numero del vendedor donde llegan los recordatorios (config).
INSERT INTO config (clave, valor) VALUES ('numero_recordatorios', '') ON CONFLICT DO NOTHING;

SELECT 'citas ok' AS estado;
