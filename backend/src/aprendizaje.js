// APRENDIZAJE DEL COPILOTO: cada vez que Jean manda un mensaje despues de pedir
// una sugerencia, se guarda el par (lo que propuso la IA, lo que el mando de
// verdad). Sus CORRECCIONES son la senal mas valiosa: ahi se ve como habla el.
//
// Esos pares se usan de dos formas:
//   1. AHORA: respuestas aceptadas/corregidas se inyectan como ejemplos en el
//      prompt (few-shot). El copiloto mejora sin reentrenar nada.
//   2. DESPUES: junto con el resultado comercial, forman un dataset supervisado.
import { query } from './db.js';

// Normaliza para comparar: si Jean solo cambio tildes/espacios, no cuenta como edicion.
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();

// Guarda la sugerencia recien generada (aun sin respuesta de Jean).
export async function registrarSugerencia({ leadId, sugerido, etapa, contexto }) {
  const { rows } = await query(
    'INSERT INTO sugerencias (lead_id, sugerido, etapa, contexto) VALUES ($1,$2,$3,$4) RETURNING id',
    [leadId, sugerido, etapa || null, contexto || null],
  );
  return rows[0].id;
}

// Cierra el ciclo: Jean mando un mensaje. Si venia de una sugerencia, se anota
// que mando realmente y si lo edito.
export async function registrarEnvio({ leadId, sugerenciaId, enviado }) {
  let id = sugerenciaId;
  if (!id) {
    // Sin id explicito: se busca la ultima sugerencia sin responder de ese lead
    // (dentro de 2h, para no atar un envio a una sugerencia vieja).
    const { rows } = await query(
      `SELECT id FROM sugerencias WHERE lead_id = $1 AND enviado IS NULL
         AND fecha > now() - interval '2 hours' ORDER BY id DESC LIMIT 1`,
      [leadId],
    );
    if (!rows.length) return null;
    id = rows[0].id;
  }
  const { rows } = await query('SELECT sugerido FROM sugerencias WHERE id = $1', [id]);
  if (!rows.length) return null;
  const editado = norm(rows[0].sugerido) !== norm(enviado);
  await query('UPDATE sugerencias SET enviado = $1, editado = $2 WHERE id = $3', [enviado, editado, id]);
  return { id, editado };
}

// El resultado lo marca Jean cuando ya sabe que paso con la conversacion. Es
// una senal mucho mas fiable que saber solamente si edito el texto.
export async function registrarResultado({ leadId, sugerenciaId = null, resultado, nota = null }) {
  const permitidos = new Set(['sin_respuesta', 'respondio', 'demo', 'cotizacion', 'negociacion', 'pago', 'rechazo', 'otro']);
  if (!permitidos.has(resultado)) throw new Error('Resultado de aprendizaje no valido.');
  let id = Number(sugerenciaId) || null;
  if (!id) {
    const { rows } = await query(
      `SELECT id FROM sugerencias WHERE lead_id = $1 AND enviado IS NOT NULL
       ORDER BY fecha DESC LIMIT 1`, [leadId],
    );
    id = rows[0]?.id || null;
  }
  if (!id) return null;
  const { rows } = await query(
    `UPDATE sugerencias SET resultado = $1, resultado_nota = NULLIF($2, ''), resultado_at = now()
     WHERE id = $3 AND lead_id = $4 RETURNING id, resultado`,
    [resultado, String(nota || '').trim(), id, leadId],
  );
  return rows[0] || null;
}

// Ejemplos para el prompt: las correcciones mas recientes de Jean. Se priorizan
// las de la MISMA etapa (una correccion en "por_pagar" ensena mas para otro
// "por_pagar" que una de primer contacto).
export async function ejemplosDeJean({ etapa = null, limite = 4 } = {}) {
  const { rows } = await query(
    `SELECT contexto, enviado, etapa FROM sugerencias
     WHERE enviado IS NOT NULL AND length(enviado) > 10
     ORDER BY (resultado IN ('demo','cotizacion','negociacion','pago')) DESC,
              (editado = TRUE) DESC,
              (etapa IS NOT DISTINCT FROM $1) DESC, fecha DESC
     LIMIT $2`,
    [etapa, limite],
  );
  return rows;
}

// Formato compacto de los ejemplos para inyectar en el prompt.
export function ejemplosATexto(ejemplos) {
  if (!ejemplos || !ejemplos.length) return '';
  const bloques = ejemplos.map((e) => {
    const ctx = (e.contexto || '').split('\n').slice(-2).join('\n');
    return `${ctx ? `${ctx}\n` : ''}JEAN RESPONDIO: ${e.enviado}`;
  });
  return `\nASI RESPONDIO JEAN EN CASOS PARECIDOS (imita este tono y largo):\n${bloques.join('\n---\n')}`;
}

// Resumen para la UI / seguimiento del aprendizaje.
export async function estadisticas() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE enviado IS NOT NULL)::int AS usadas,
            COUNT(*) FILTER (WHERE editado = TRUE)::int AS editadas,
            COUNT(*) FILTER (WHERE editado = FALSE)::int AS tal_cual,
            COUNT(*) FILTER (WHERE resultado IS NOT NULL)::int AS resultados,
            COUNT(*) FILTER (WHERE resultado IN ('demo','cotizacion','negociacion','pago'))::int AS exitosas
     FROM sugerencias`,
  );
  const { rows: porEtapa } = await query(
    `SELECT COALESCE(s.etapa, 'sin_etapa') AS etapa,
            COUNT(*)::int AS sugerencias,
            COUNT(*) FILTER (WHERE s.enviado IS NOT NULL)::int AS usadas,
            COUNT(*) FILTER (WHERE s.editado = TRUE)::int AS editadas,
            COUNT(*) FILTER (WHERE s.resultado IN ('demo','cotizacion','negociacion','pago'))::int AS exitosas
       FROM sugerencias s
      GROUP BY COALESCE(s.etapa, 'sin_etapa')
      ORDER BY sugerencias DESC`);
  const { rows: porCategoria } = await query(
    `SELECT COALESCE(l.categoria, 'sin_categoria') AS categoria,
            COUNT(*)::int AS sugerencias,
            COUNT(*) FILTER (WHERE s.enviado IS NOT NULL)::int AS usadas,
            COUNT(*) FILTER (WHERE s.resultado IN ('demo','cotizacion','negociacion','pago'))::int AS exitosas
       FROM sugerencias s
       LEFT JOIN leads l ON l.id = s.lead_id
      GROUP BY COALESCE(l.categoria, 'sin_categoria')
      ORDER BY sugerencias DESC`);
  return { ...rows[0], por_etapa: porEtapa, por_categoria: porCategoria };
}
