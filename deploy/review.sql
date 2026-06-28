\echo '=== WHATSAPP FALTANTES (activos sin numero real) ==='
SELECT nombre, whatsapp FROM clientes WHERE activo AND (whatsapp='900000000' OR length(whatsapp)<>9) ORDER BY nombre;
\echo ''
\echo '=== RESUMEN WHATSAPP ==='
SELECT count(*) FILTER (WHERE activo) AS activos,
       count(*) FILTER (WHERE activo AND whatsapp<>'900000000' AND length(whatsapp)=9) AS con_numero,
       count(*) FILTER (WHERE activo AND (whatsapp='900000000' OR length(whatsapp)<>9)) AS faltan
FROM clientes;
\echo ''
\echo '=== WHATSAPP DUPLICADOS ==='
SELECT whatsapp, count(*), string_agg(nombre, ' | ') FROM clientes
WHERE activo AND whatsapp<>'900000000' GROUP BY whatsapp HAVING count(*)>1;
\echo ''
\echo '=== DEUDA POR CLIENTE (plazo dia 10) ==='
WITH g AS (SELECT (EXTRACT(YEAR FROM CURRENT_DATE)::int*12+EXTRACT(MONTH FROM CURRENT_DATE)::int)
                  - CASE WHEN EXTRACT(DAY FROM CURRENT_DATE)<=10 THEN 1 ELSE 0 END AS obj)
SELECT c.nombre, to_char(c.pagado_hasta,'YYYY-MM') AS pagado_hasta, c.monto,
       GREATEST(0, g.obj-(EXTRACT(YEAR FROM c.pagado_hasta)::int*12+EXTRACT(MONTH FROM c.pagado_hasta)::int)) AS debe,
       ROUND(GREATEST(0, g.obj-(EXTRACT(YEAR FROM c.pagado_hasta)::int*12+EXTRACT(MONTH FROM c.pagado_hasta)::int))*c.monto,2) AS deuda
FROM clientes c, g WHERE c.activo ORDER BY deuda DESC, c.nombre;
\echo ''
\echo '=== PAGOS REGISTRADOS ==='
SELECT count(*) AS pagos, count(DISTINCT cliente_id) AS clientes_con_pago, COALESCE(sum(monto_total),0) AS total FROM pagos;
\echo ''
\echo '=== PAGOS POR MES ==='
SELECT to_char(fecha,'YYYY-MM') AS mes, count(*) AS n, sum(monto_total) AS total FROM pagos GROUP BY 1 ORDER BY 1;
