ALTER TABLE lead_mensajes ADD COLUMN IF NOT EXISTS automatico BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO config (clave, valor) VALUES ('auto_primer_contacto', 'true') ON CONFLICT DO NOTHING;
SELECT 'mig2 ok' AS estado;
