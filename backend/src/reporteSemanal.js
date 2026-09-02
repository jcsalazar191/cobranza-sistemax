// REPORTE SEMANAL: cada lunes a las 8am (hora Peru) manda por WhatsApp un
// resumen del embudo de posibles (nuevos, cerrados, calientes, por etapa) al
// mismo numero configurado para los recordatorios de citas.
import { query } from './db.js';
import { enviarTexto } from './evolution.js';

const REVISAR_CADA_MS = 30 * 60_000; // cada 30 min alcanza para no perderse el lunes 8am
let intervalo = null;

const NOMBRE_ETAPA = {
  por_pagar: 'Por pagar', negociando: 'Negociando', cotizado: 'Cotizado',
  demo: 'Demo', por_confirmar: 'Por confirmar', info_enviada: 'Info enviada',
  primer_contacto: 'Primer contacto', frio: 'Frio', cerrado: 'Cerrado',
  descartado: 'Descartado', sin_clasificar: 'Sin clasificar',
};

function esLunes8am() {
  const h = new Intl.DateTimeFormat('es-PE', {
    weekday: 'long', hour: '2-digit', hour12: false, timeZone: 'America/Lima',
  }).formatToParts(new Date());
  const dia = h.find((p) => p.type === 'weekday')?.value?.toLowerCase() || '';
  const hora = Number(h.find((p) => p.type === 'hour')?.value || -1);
  return dia === 'lunes' && hora === 8;
}

function semanaActual() {
  // "2026-W35" tipo ISO simplificado, sirve como llave para no repetir en la semana.
  const d = new Date();
  const enero1 = new Date(d.getFullYear(), 0, 1);
  const semana = Math.ceil((((d - enero1) / 86400000) + enero1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${semana}`;
}

async function armarReporte() {
  const { rows: etapas } = await query(
    `SELECT COALESCE(memoria->>'etapa','sin_clasificar') AS etapa, COUNT(*)::int AS n
     FROM leads WHERE categoria = 'posible' AND estado <> 'descartado' GROUP BY 1 ORDER BY n DESC`,
  );
  const { rows: tot } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE primer_contacto >= now() - interval '7 days')::int AS nuevos_semana,
            COUNT(*) FILTER (WHERE memoria->>'etapa' = 'cerrado' AND ultimo_contacto >= now() - interval '7 days')::int AS cerrados_semana,
            COUNT(*) FILTER (WHERE COALESCE(score,0) >= 60)::int AS calientes
     FROM leads WHERE categoria = 'posible'`,
  );
  const { rows: msgs } = await query(
    `SELECT COUNT(*) FILTER (WHERE direccion = 'in' AND automatico IS NOT TRUE)::int AS entrantes,
            COUNT(*) FILTER (WHERE automatico = TRUE)::int AS respondidos_solo
     FROM lead_mensajes WHERE fecha >= now() - interval '7 days'`,
  );
  const t = tot[0]; const m = msgs[0];

  const lineas = etapas
    .filter((e) => e.n > 0)
    .map((e) => `• ${NOMBRE_ETAPA[e.etapa] || e.etapa}: ${e.n}`)
    .join('\n');

  return `📊 *Resumen semanal — Posibles SysFarma*

Nuevos esta semana: ${t.nuevos_semana}
Cerrados esta semana: ${t.cerrados_semana}
Calientes ahora (score ≥60): ${t.calientes}
Total activos: ${t.total}
Mensajes atendidos solos (primer contacto): ${m.respondidos_solo}

*Por etapa:*
${lineas || '(sin datos)'}`;
}

async function revisar() {
  try {
    if (!esLunes8am()) return;
    const { rows: cfg } = await query("SELECT valor FROM config WHERE clave = 'reporte_semanal_enviado'");
    if (cfg[0]?.valor === semanaActual()) return; // ya se mando esta semana

    const { rows: num } = await query("SELECT valor FROM config WHERE clave = 'numero_recordatorios'");
    const numero = (num[0]?.valor || '').trim();
    if (!numero) return;

    const texto = await armarReporte();
    await enviarTexto(numero, texto);
    await query(
      `INSERT INTO config (clave, valor) VALUES ('reporte_semanal_enviado', $1)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [semanaActual()],
    );
  } catch (e) {
    console.error('[reporte-semanal] error:', e?.message || e);
  }
}

export function iniciarReporteSemanal() {
  if (intervalo) return;
  intervalo = setInterval(revisar, REVISAR_CADA_MS);
  revisar();
}

export { armarReporte }; // exportado para poder probarlo a mano
