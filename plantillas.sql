INSERT INTO plantillas (atajo, titulo, texto) VALUES
('planes', 'Planes y precios',
 'Manejamos por este mes un plan especial de S/ 69 soles todo ilimitado sin limitaciones, y un pago unico de S/ 999'),
('demo', 'Link de la demo',
 'Le paso el link para que lo pruebe mi estimado: https://demo.sysfarma.pe/'),
('agendar', 'Agendar demostracion',
 'Esta con disponibilidad para agendar una reunion y hacerle la demostracion del sistema ?'),
('datos', 'Pedir datos para el contrato',
 'Compartame su ruc porfabor, y por que periodo, si mensual o anual ?'),
('pago', 'Consultar por el pago',
 'Mi estimado, ya pudo hacer el pago ?'),
('saludo', 'Primer saludo',
 'Hola mi estimado, le saluda Jean Vega de SysFarma.pe, con quien tengo el gusto ? Comenteme, para que ciudad o departamento desea la demostracion ?'),
('sinextra', 'Sin costos adicionales',
 'Ningun pago adicional mi estimado, excepto si desean modificaciones como se converso.'),
('seguimiento', 'Retomar contacto',
 'Mi estimado, como va todo ? Quedo atento por si desea que retomemos lo del sistema.')
ON CONFLICT (atajo) DO UPDATE SET titulo = EXCLUDED.titulo, texto = EXCLUDED.texto;
SELECT COUNT(*) AS plantillas FROM plantillas;
