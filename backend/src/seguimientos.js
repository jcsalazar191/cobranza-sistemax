// COLA DE SEGUIMIENTOS: "hoy toca escribirle a estos". Detecta los leads que se
// estan enfriando y los ordena por urgencia. NO envia nada: arma la lista para
// que Jean la trabaje uno por uno (nada de campanas masivas -> riesgo de baneo).
import { query } from './db.js';

// Motivos, de mas urgente a menos.
const REGLAS = [
  {
    clave: 'te_espera',
    etiqueta: 'Te escribió y no respondiste',
    prioridad: 1,
    // Ultimo mensaje del cliente y ya pasaron mas de 2 horas.
    cond: `ultima_direccion = 'in' AND horas_sin_contacto >= 2`,
  },
  {
    clave: 'cerca_de_cerrar',
    etiqueta: 'A punto de cerrar, sin novedad',
    prioridad: 2,
    cond: `etapa IN ('por_pagar','negociando','cotizado') AND dias_sin_contacto >= 2`,
  },
  {
    clave: 'demo_sin_seguimiento',
    etiqueta: 'Quedó una demo pendiente',
    prioridad: 3,
    cond: `etapa IN ('demo','por_confirmar') AND dias_sin_contacto >= 3`,
  },
  {
    clave: 'enfriandose',
    etiqueta: 'Se está enfriando',
    prioridad: 4,
    cond: `etapa IN ('info_enviada','primer_contacto') AND dias_sin_contacto BETWEEN 5 AND 45`,
  },
];

// Devuelve los leads que hoy merecen un mensaje, con su motivo.
export async function colaDeSeguimientos({ limite = 30 } = {}) {
  const casos = REGLAS.map((r) => `WHEN ${r.cond} THEN '${r.clave}'`).join('\n           ');
  const prio = REGLAS.map((r) => `WHEN '${r.clave}' THEN ${r.prioridad}`).join(' ');

  const { rows } = await query(
    `WITH base AS (
       SELECT l.id, l.telefono, l.nombre, l.estado, l.score, l.ultimo_mensaje,
              l.ultimo_contacto, l.ultimo_seguimiento,
              COALESCE(l.memoria->>'etapa', '') AS etapa,
              COALESCE(l.memoria->>'temperatura', '') AS temperatura,
              (SELECT m.direccion FROM lead_mensajes m WHERE m.lead_id = l.id
                ORDER BY m.fecha DESC, m.id DESC LIMIT 1) AS ultima_direccion,
              EXTRACT(EPOCH FROM (now() - l.ultimo_contacto)) / 3600 AS horas_sin_contacto,
              EXTRACT(EPOCH FROM (now() - l.ultimo_contacto)) / 86400 AS dias_sin_contacto
       FROM leads l
       WHERE l.categoria = 'posible'
         AND l.estado <> 'descartado'
         AND COALESCE(l.memoria->>'etapa','') NOT IN ('cerrado','descartado')
         AND l.ultimo_contacto IS NOT NULL
         -- no repetir el seguimiento si ya se le escribio hoy
         AND (l.ultimo_seguimiento IS NULL OR l.ultimo_seguimiento < now() - interval '20 hours')
     )
     SELECT *, ROUND(dias_sin_contacto)::int AS dias,
            CASE ${casos} ELSE NULL END AS motivo
     FROM base
     WHERE (CASE ${casos} ELSE NULL END) IS NOT NULL
     ORDER BY (CASE (CASE ${casos} ELSE NULL END) ${prio} ELSE 9 END),
              COALESCE(score, 0) DESC, ultimo_contacto ASC
     LIMIT $1`,
    [limite],
  );

  const etiquetas = Object.fromEntries(REGLAS.map((r) => [r.clave, r.etiqueta]));
  return rows.map((r) => ({ ...r, motivo_texto: etiquetas[r.motivo] || r.motivo }));
}

// Cuantos hay pendientes (para el badge de la pestana).
export async function cuantosPendientes() {
  const filas = await colaDeSeguimientos({ limite: 200 });
  return filas.length;
}
