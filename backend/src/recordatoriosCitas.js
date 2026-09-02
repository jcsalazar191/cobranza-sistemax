// RECORDATORIO DE CITAS: revisa cada minuto si hay citas por vencer y te avisa
// por WhatsApp (a tu propio numero) antes de que llegue, para no repetir casos
// como Ricardo/Julio (demos agendadas que se enfriaron sin que nadie se diera
// cuenta). Un solo proceso, sin Redis/colas: la cita vive en Postgres (tabla
// `citas`), asi que sobrevive un reinicio -- lo unico que se pierde es el aviso
// si el servidor estuvo caido justo en la ventana (rarisimo, y de todos modos
// la cita se sigue viendo en el buzon).
import { query } from './db.js';
import { enviarTexto, normalizarTelefono } from './evolution.js';

const REVISAR_CADA_MS = 60_000;
let intervalo = null;

async function numeroRecordatorios() {
  const { rows } = await query("SELECT valor FROM config WHERE clave = 'numero_recordatorios'");
  const v = (rows[0]?.valor || '').trim();
  return v ? normalizarTelefono(v) : '';
}

// Marca la cita como cumplida cuando ya paso hace rato (limpieza; no dispara nada).
async function cerrarCitasVencidas() {
  await query(
    "UPDATE citas SET estado = 'cumplida' WHERE estado = 'pendiente' AND fecha_hora < now() - interval '1 hour'",
  );
}

async function revisar() {
  try {
    const numero = await numeroRecordatorios();
    if (!numero) return; // sin numero configurado, no hay a quien avisar

    // Cita cuya ventana de aviso (fecha_hora - recordatorio_minutos) ya llego,
    // que aun no paso, y que no se le aviso todavia.
    const { rows } = await query(
      `SELECT c.id, c.fecha_hora, c.texto, l.nombre, l.telefono
       FROM citas c JOIN leads l ON l.id = c.lead_id
       WHERE c.estado = 'pendiente'
         AND c.recordatorio_enviado_at IS NULL
         AND c.fecha_hora > now()
         AND c.fecha_hora <= now() + c.recordatorio_minutos * interval '1 minute'
       ORDER BY c.fecha_hora`,
    );

    for (const c of rows) {
      const hora = new Date(c.fecha_hora).toLocaleString('es-PE', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Lima',
      });
      const quien = c.nombre || c.telefono;
      const texto = `⏰ Recordatorio: ${c.texto} con *${quien}* hoy a las ${hora}.`;
      try {
        await enviarTexto(numero, texto);
        // Se marca ANTES de seguir con la siguiente: si el envio ya salio, no
        // se debe reintentar aunque algo falle despues (evita duplicados).
        await query('UPDATE citas SET recordatorio_enviado_at = now() WHERE id = $1', [c.id]);
      } catch (e) {
        console.error('[recordatorio-cita] no se pudo avisar:', e?.message || e);
      }
    }

    await cerrarCitasVencidas();
  } catch (e) {
    console.error('[recordatorio-cita] error revisando:', e?.message || e);
  }
}

// Arranca el revisor (llamar una vez al iniciar el servidor).
export function iniciarRecordatoriosCitas() {
  if (intervalo) return;
  intervalo = setInterval(revisar, REVISAR_CADA_MS);
  revisar(); // primera pasada inmediata, no esperar el primer minuto
}
