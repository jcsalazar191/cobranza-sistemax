-- ============================================================
--  Cobranzas | seed.sql  (DATOS DE EJEMPLO)
--  Clientes ficticios para probar la app. Reemplaza por los tuyos.
--  Formato: (nombre, whatsapp(9 dig), monto, dia_cobro, pagado_hasta, activo, periodo, notas)
--  pagado_hasta = primer dia del ULTIMO mes cubierto (ej. '2026-05-01').
-- ============================================================

TRUNCATE TABLE pagos RESTART IDENTITY CASCADE;
TRUNCATE TABLE clientes RESTART IDENTITY CASCADE;

INSERT INTO clientes (nombre, whatsapp, monto, dia_cobro, pagado_hasta, activo, periodo, notas) VALUES
  ('Bodega Central',          '900000001', 50.00,  5,  '2026-06-01', TRUE,  'MENSUAL',    'Al dia'),
  ('Farmacia Salud',          '900000002', 80.00,  10, '2026-05-01', TRUE,  'MENSUAL',    'Debe 1 mes'),
  ('Restaurante Sabor',       '900000003', 120.00, 1,  '2026-03-01', TRUE,  'MENSUAL',    'Critico'),
  ('Veterinaria Patitas',     '900000004', 90.00,  15, '2026-11-01', TRUE,  'SEMESTRAL',  'Pago adelantado'),
  ('Estudio Contable',        '900000005', 70.00,  20, '2027-03-01', TRUE,  'ANUAL',      'Pago anual'),
  ('Tienda Cerrada',          '900000006', 0.00,   1,  '2026-06-01', FALSE, 'MENSUAL',    'Dado de baja');
