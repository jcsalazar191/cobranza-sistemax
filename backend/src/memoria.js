// MEMORIA POR CHAT: en vez de re-leer toda la conversacion en cada sugerencia
// (y re-deducir los hechos, que es de donde salian los errores tipo "pedir la
// ciudad que ya te dieron"), cada lead guarda un ESTADO vivo en leads.memoria.
//
//   - Se construye UNA vez desde el historial (construirMemoria).
//   - Despues solo se ACTUALIZA con los mensajes nuevos (actualizarMemoria),
//     mandando el estado + lo nuevo, no el historial completo.
//   - Los hechos quedan fijados (que se envio, que datos hay, que falta), no
//     se vuelven a inferir. Es la base para responder de forma autonoma.
import { query } from './db.js';
import { getOpenaiCreds, getGeminiCreds } from './routes/config.js';

const ESQUEMA = `{
  "etapa": "primer_contacto|info_enviada|demo|cotizado|por_confirmar|negociando|por_pagar|cerrado|frio|descartado",
  "temperatura": "caliente|tibio|frio",
  "datos": { "nombre": null, "negocio": null, "ciudad": null, "ruc": null, "razon_social": null, "plan": null, "precio_acordado": null },
  "enviado": [],
  "pendiente": [],
  "acuerdos": [],
  "resumen": "",
  "score": 0,
  "score_motivo": "",
  "cita_iso": null,
  "cita_texto": ""
}`;

const REGLAS = `Mantienes la FICHA de un posible cliente de SysFarma (software para farmacias en Peru), a partir de su conversacion de WhatsApp con Jean (el vendedor).

Devuelve SOLO un JSON con esta forma exacta:
${ESQUEMA}

- datos: lo que el cliente YA dijo. null si aun no lo dijo. No inventes nada.
- enviado: cosas que Jean YA le mando. Usa estas etiquetas cuando corresponda:
  "demo_link", "cotizacion", "contrato", "medios_pago", "datos_requeridos", "fotos", "video".
  Pistas: "📄 Cotizacion..." -> cotizacion; "📄 Contrato..." -> contrato;
  "MEDIOS DE PAGO" -> medios_pago; "DATOS A REQUERIR" -> datos_requeridos;
  "demo.sysfarma.pe" -> demo_link.
- pendiente: lo que falta para avanzar (ej. "pago", "clave SUNAT", "logo", "confirmar hora de demo").
- acuerdos: cosas ya acordadas, con el detalle (ej. "S/ 99 mensual sin costos adicionales").
- resumen: 1-2 frases de en que quedo la conversacion.
- score: 0 a 100, que tan cerca esta de COMPRAR. Guiate por:
  +30 si ya acepto o pidio contrato/datos de pago
  +20 si pidio o vio una demo
  +15 si pregunto precios en serio o dio su RUC
  +10 si tiene botica operando y dijo cuantos locales
  +10 si hay urgencia (necesita facturacion electronica, le exige SUNAT)
  +10 si el que escribe es el dueno o decide
  -20 si no responde hace semanas
  -30 si dijo que no, que ya tiene otro sistema, o que no le interesa
- score_motivo: en pocas palabras, por que ese puntaje.
- En "pendiente", si quedo una cita/demo con fecha u hora, anotala en formato de
  12 HORAS (ej. "demo agendada 18/07 5:00 p.m."), nunca en 24 horas. Si esa fecha
  YA PASO y no hubo novedad, anota "reagendar demo (la del 18/07 no se concreto)".
- cita_iso: OJO CON LAS FECHAS -- cada mensaje trae entre parentesis la fecha en
  que se escribio (y hace cuanto, respecto a HOY). Las palabras relativas
  ("mañana", "hoy", "el lunes") se calculan SIEMPRE respecto a la fecha en que
  ESE mensaje se escribio, NUNCA respecto a HOY. Ej: si un mensaje del 18/07
  dice "nos vemos mañana a las 5", esa cita fue el 19/07 -- NO recalcules
  "mañana" como si fuera desde HOY. Con esa fecha ya calculada, cita_iso es la
  fecha/hora exacta en ISO 8601 (zona Peru, ej "2026-08-25T17:00:00-05:00")
  SOLO SI esa fecha es HOY o POSTERIOR a HOY (una cita futura de verdad). Si esa
  fecha ya paso (aunque en su momento haya sido "mañana"), si no hay cita, si
  quedo ambigua ("la otra semana") o si no se confirmo hora exacta: null.
  Un "mañana" o "el lunes" dicho hace dias/semanas/meses YA PASO -- nunca lo
  confirmes como una cita vigente. NUNCA inventes una hora que no se dijo.
- cita_texto: 1 frase corta de que es la cita (ej. "Demo del sistema con Ricardo").`;

function extraerJson(txt) {
  const s = String(txt || '').trim().replace(/^```(?:json)?|```$/g, '').trim();
  return JSON.parse(s);
}

async function pedirJson(system, userText) {
  // OpenAI primero (respeta JSON de forma fiable); Gemini como respaldo.
  const o = await getOpenaiCreds();
  if (o.apiKey) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({
        model: o.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userText }],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) {
      const d = await r.json();
      return extraerJson(d?.choices?.[0]?.message?.content);
    }
  }
  const g = await getGeminiCreds();
  if (!g.apiKey) throw new Error('No hay IA configurada para la memoria.');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(g.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': g.apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 }, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const d = await r.json();
  return extraerJson((d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
}

// Incluye la fecha de cada mensaje: la ficha necesita saber si una cita ya vencio.
// hace cuanto se escribio (no solo dd/mm): sin esto el modelo tiene que hacer
// la resta el mismo y a veces lee un "mañana" de hace un mes como si fuera de hoy.
function hace(fecha) {
  if (!fecha) return '';
  const dias = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);
  if (!Number.isFinite(dias) || dias < 0) return '';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'hace 1 mes' : `hace ${meses} meses`;
}

const linea = (m) => {
  const f = m.fecha ? new Date(m.fecha) : null;
  let dia = '';
  if (f && !Number.isNaN(f.getTime())) {
    const fechaCorta = f.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', timeZone: 'America/Lima' });
    const antiguedad = hace(m.fecha);
    dia = ` (${fechaCorta}${antiguedad ? `, ${antiguedad}` : ''})`;
  }
  const contenido = m.media_archivo
    ? `[${m.tipo || 'archivo'}${m.media_nombre ? `: ${m.media_nombre}` : ''}]`
    : m.cuerpo;
  return `${m.direccion === 'in' ? 'CLIENTE' : 'JEAN'}${dia}: ${contenido}`;
};

// Fecha Y HORA de hoy, para que el modelo sepa que citas ya pasaron -- incluso
// las de HOY MISMO (sin la hora, "11:00 a.m." parece siempre valido aunque
// ya sean las 11:17 a.m.).
const hoyTexto = () => {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima',
  });
  const hora = ahora.toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Lima' });
  return `${fecha}, y son las ${hora} AHORA MISMO (si es una hora de HOY, tiene que ser DESPUES de esta hora para seguir siendo valida)`;
};

// Construye la memoria desde CERO leyendo todo el historial. Se usa una sola vez
// por lead (o si se quiere recalcular). Despues se actualiza incremental.
export async function construirMemoria(mensajes) {
  const conv = mensajes.map(linea).join('\n');
  return pedirJson(REGLAS + String.fromCharCode(10) + String.fromCharCode(10) + "HOY es " + hoyTexto() + ".", `Conversacion completa:\n${conv}\n\nDevuelve la ficha en JSON.`);
}

// Actualiza la memoria con SOLO los mensajes nuevos. No manda el historial:
// manda el estado actual + lo nuevo. Esto es lo barato y lo que no pierde datos.
export async function actualizarMemoria(memoria, nuevos) {
  const conv = nuevos.map(linea).join('\n');
  const system = `${REGLAS}

HOY es ${hoyTexto()}.

Te doy la ficha ACTUAL y los mensajes NUEVOS. Devuelve la ficha ACTUALIZADA.
- CONSERVA todo lo que ya estaba (datos, enviado, acuerdos): solo se agrega o se corrige con lo nuevo.
- Nunca borres un dato que ya estaba por no aparecer en los mensajes nuevos.`;
  return pedirJson(system, `Ficha actual:\n${JSON.stringify(memoria)}\n\nMensajes nuevos:\n${conv}\n\nDevuelve la ficha actualizada en JSON.`);
}

// Guarda/actualiza la cita del lead en la tabla `citas` (para el recordatorio
// automatico). Una cita activa por lead: si la ficha ya no trae cita_iso (se
// cumplio, se cancelo, quedo vieja), se cancela la que estaba pendiente.
async function sincronizarCita(leadId, memoria) {
  const iso = memoria?.cita_iso;
  const fecha = iso ? new Date(iso) : null;
  const valida = fecha && !Number.isNaN(fecha.getTime()) && fecha.getTime() > Date.now();

  if (!valida) {
    await query(
      "UPDATE citas SET estado = 'cancelada' WHERE lead_id = $1 AND estado = 'pendiente'",
      [leadId],
    );
    return;
  }

  const { rows: existente } = await query(
    "SELECT id, fecha_hora FROM citas WHERE lead_id = $1 AND estado = 'pendiente' ORDER BY id DESC LIMIT 1",
    [leadId],
  );
  const texto = memoria?.cita_texto || 'Demo agendada';

  if (existente.length && new Date(existente[0].fecha_hora).getTime() === fecha.getTime()) {
    return; // misma cita, nada que hacer
  }
  if (existente.length) {
    // La hora cambio (reagendaron): reemplaza y limpia el flag de recordatorio.
    await query(
      'UPDATE citas SET fecha_hora = $1, texto = $2, recordatorio_enviado_at = NULL WHERE id = $3',
      [fecha.toISOString(), texto, existente[0].id],
    );
    return;
  }
  await query(
    'INSERT INTO citas (lead_id, fecha_hora, texto) VALUES ($1, $2, $3)',
    [leadId, fecha.toISOString(), texto],
  );
}

// Asegura que la memoria del lead este al dia. Si hay mensajes nuevos desde
// memoria_hasta, los incorpora (incremental). Devuelve la memoria vigente.
export async function memoriaAlDia(leadId) {
  const { rows } = await query('SELECT memoria, memoria_hasta FROM leads WHERE id = $1', [leadId]);
  if (!rows.length) return null;
  const { memoria, memoria_hasta: hasta } = rows[0];

  const { rows: nuevos } = await query(
    `SELECT id, direccion, cuerpo, fecha, tipo, media_archivo, media_nombre
     FROM lead_mensajes WHERE lead_id = $1 AND id > $2 ORDER BY fecha, id`,
    [leadId, hasta || 0],
  );
  if (!nuevos.length) return memoria;

  let actualizada = memoria
    ? await actualizarMemoria(memoria, nuevos)
    : await construirMemoria(nuevos);
  if (memoria?.contexto_manual) actualizada = { ...actualizada, contexto_manual: memoria.contexto_manual };

  const ultimoId = nuevos[nuevos.length - 1].id;
  // El score viaja dentro de la misma ficha (sin llamada extra a la IA) y se
  // copia a columnas propias para poder ordenar/filtrar por SQL.
  const score = Number.isFinite(Number(actualizada?.score))
    ? Math.max(0, Math.min(100, Math.round(Number(actualizada.score)))) : null;
  await query(
    'UPDATE leads SET memoria = $1, memoria_hasta = $2, score = COALESCE($3, score), score_motivo = COALESCE($4, score_motivo) WHERE id = $5',
    [JSON.stringify(actualizada), ultimoId, score, actualizada?.score_motivo || null, leadId],
  );

  await sincronizarCita(leadId, actualizada);
  return actualizada;
}

// Texto compacto de la memoria para inyectar en el prompt de sugerencia.
export function memoriaATexto(m) {
  if (!m) return '';
  const d = m.datos || {};
  const datos = Object.entries(d).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
  const partes = [
    `ETAPA: ${m.etapa || '?'} (${m.temperatura || '?'})`,
    datos ? `DATOS QUE YA TENGO: ${datos}` : 'DATOS QUE YA TENGO: (ninguno)',
    `YA LE ENVIE: ${(m.enviado || []).join(', ') || '(nada)'}`,
    `PENDIENTE: ${(m.pendiente || []).join(', ') || '(nada)'}`,
    (m.acuerdos || []).length ? `ACUERDOS: ${m.acuerdos.join(' · ')}` : '',
    m.resumen ? `EN QUE QUEDO: ${m.resumen}` : '',
    m.contexto_manual ? `CONTEXTO DE JEAN: ${m.contexto_manual}` : '',
  ].filter(Boolean);
  return partes.join('\n');
}
