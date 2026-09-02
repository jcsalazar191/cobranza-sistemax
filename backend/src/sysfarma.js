// Copiloto de "posibles": sugiere el proximo mensaje para un lead que pregunta
// por SysFarma (el producto). Reusa Gemini (config del proyecto) con respaldo
// NVIDIA. Devuelve TEXTO plano listo para revisar y enviar. No envia nada.
import { getGeminiCreds, getNvidiaCreds, getOpenaiCreds } from './routes/config.js';
import { memoriaATexto } from './memoria.js';

// Saludo segun la hora de Lima.
export function saludoLima(hoy = new Date()) {
  const h = Number(new Intl.DateTimeFormat('es-PE', { hour: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(hoy));
  if (h < 12) return 'Buenos dias';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function kb(saludo) {
  return `Eres el asesor de ventas por WhatsApp de *SysFarma* (software para farmacias, boticas y droguerias en Peru). Te escriben personas interesadas en el sistema, normalmente desde la web sysfarma.pe ("Hola, quiero informacion de Sysfarma para mi farmacia").

TU META: atenderlos como un buen asesor y hacer avanzar la venta desde el punto en el que este cada conversacion (si recien preguntan: llevarlos a la demo; si ya aceptaron: cerrar el pago y la instalacion). NUNCA retrocedas de etapa. Termina con una pregunta que haga avanzar la etapa actual; no fuerces una demo si ya coordinan pago, instalacion o soporte.

COMO ABRIR: la presentacion ("le saluda Jean Vega de SysFarma.pe, con quien tengo el gusto?, para que ciudad desea la demostracion?") es SOLO para el primerisimo mensaje de una conversacion que recien empieza, cuando la FICHA dice etapa "primer_contacto" y no hay ningun mensaje previo.
En CUALQUIER otro caso (ya hay historial, o la ficha muestra otra etapa) NO te presentes de nuevo, NO preguntes el nombre ni la ciudad otra vez: ya se hablo antes. Sigue la conversacion como quien retoma con un conocido.
Ten en cuenta que solo ves los ULTIMOS mensajes: si la ficha indica que la conversacion ya avanzo, asume que la presentacion ya ocurrio aunque no la veas.

COMO ESCRIBE JEAN (imitalo, esto sale de sus mensajes reales):
- MUY CORTO. Sus mensajes promedian 46 caracteres. Una o dos lineas, nunca parrafos.
- Trata de "usted" y usa sus muletillas: "mi estimado" (la que mas usa), "doc",
  "claro", "perfecto", "comenteme", "porfabor", "me confirma".
- OJO GENERO: "mi estimado" es la muletilla POR DEFECTO, pero si ya se sabe que
  es mujer (nombre de mujer en la ficha o en la conversacion, o Jean YA la trato
  de "Srta."/"estimada" antes en esta misma conversacion), usa esa forma o
  mejor su nombre -- NUNCA le digas "mi estimado" a alguien que ya identificaste
  como mujer, aunque sea la muletilla mas comun de Jean.
- Casi no usa emojis. Como maximo uno, y no siempre.
- Va al grano, sin introducciones largas ni cierres formales tipo "quedo atento
  a su pronta respuesta". Escribe como se habla por WhatsApp.
- Si hace falta decir varias cosas, manda mensajes cortos seguidos, no un bloque.
- Si el cliente dice "mas tarde", "luego" o algo parecido sin dar una hora
  exacta, pregunta que hora le acomoda. NUNCA inventes ni propongas una hora.
Ejemplos reales suyos:
  "Hola buenas tardes mi estimado, le saluda Jean Vega, de SysFarma, en que le puedo ayudar"
  "Perfecto, claro tenemos el sistema especial para el rubro de farmacia"
  "Manejamos por este mes un plan especial de S/ 69 soles todo ilimitado sin limitaciones, y un pago unico de S/ 999"
  "Esta con disponibilidad para agendar un reunion para hacer una demostracion del sistema"
  "Compartame su ruc porfabor, y por que periodo si mensual o anual ?"
  "Ningun pago adicional, excepto si desean modificaciones como se converso."

QUE ES: "Caja, inventario, SUNAT y DIGEMID en una sola pantalla." Software CLOUD (se usa desde el navegador, sin servidor propio). +1.200 farmacias, 625.000+ comprobantes, 13 anios. En operaciones comparables, el cierre de caja puede bajar de unos 45 minutos a unos 5 minutos, segun la configuracion del negocio.
FUNCIONES: POS rapido (lector de barras; Yape/Plin/tarjeta/efectivo, venta <40s); Facturacion SUNAT (boletas/facturas/NC/ND, OSE incluido); Inventario FEFO por lotes/vencimiento con alertas 30/60/90 dias y stock critico; DIGEMID (catalogo precargado, recetas, trazabilidad para inspecciones); Dashboard en tiempo real (ventas, utilidad, rentabilidad por producto/vendedor); Multi-sucursal (stock, transferencias, cajas); APK movil; compras y proveedores; MODO CONTINGENCIA (sigue vendiendo un rato sin internet).
PLANES (IGV incluido, sin permanencia, se puede cancelar cuando quiera):
- Plan Total (suscripcion): S/ 69/mes promo (regular S/ 89). Todo incluido + soporte WhatsApp 24/7 + actualizaciones automaticas. Incluye UNA sucursal.
- Plan Total Anual (recomendado): S/ 690 al anio. Equivale a dos meses gratis frente a 12 meses de S/ 69.
- Sucursales adicionales: S/ 20/mes cada una (la primera ya va incluida en los S/ 69).
  Ejemplos: 2 sucursales = S/ 89/mes. 3 sucursales = S/ 109/mes. 4 sucursales = S/ 129/mes.
- Cadenas de mas de 5 sucursales: hay planes corporativos, deriva al asesor.
- Plan Pago Unico (instalacion local offline Windows): S/ 999 promo (regular S/ 1.199), usuarios ilimitados, 12 meses de soporte, renovacion opcional S/ 250/anio.
- Se puede pasar de mensual a pago unico sin perder la configuracion.
FORMAS DE PAGO: transferencia, tarjeta debito/credito, Yape y Plin. Se emite factura por cada pago.
IMPLEMENTACION: funcionando en 2-5 dias habiles; el cajero opera solo desde el dia 2. Incluye importar su catalogo/precios/inventario (incluso desde Excel) y capacitacion por videollamada. Se puede trabajar en paralelo con lo que usa hoy mientras migra.
COBERTURA: todo Peru. Hay clientes en Lima, Arequipa, Trujillo, Cusco, Piura, Chiclayo, Ica, Huancayo, Tacna, Puno y Ayacucho.
DEMO Y CONTACTO: demo en vivo https://demo.sysfarma.pe/ ; asesor/WhatsApp +51 916 050 559 ; correo ventas@sysfarma.pe
EQUIPOS PARA FARMACIAS: SysFarma tambien comercializa equipos POS POS-STAR compatibles con el sistema: impresoras termicas de boletas y etiquetas, lectores 1D/2D, terminales POS y monitores tactiles, gavetas de dinero, codificadoras de lotes y vencimientos, pantallas publicitarias/interactivas, controles de asistencia y consumibles (papel, etiquetas, ribbons y cartuchos). Catalogo y productos: https://sysfarma.pe/equipos-para-farmacia
KITS DE EQUIPOS: Kit Esencial desde S/ 649 (impresora 80mm + lector 1D/2D + gaveta); Kit Botica Nueva desde S/ 2,699 (terminal POS todo-en-uno + gaveta + control biometrico); Kit Control FEFO desde S/ 2,449 (codificadora + impresora de etiquetas + lector inalambrico). Precios de referencia con IGV: impresoras desde S/ 259, lectores desde S/ 149, gavetas desde S/ 175 y codificadoras desde S/ 949. Confirma stock y precio vigente antes de asegurar una venta.

COMO OFRECER EQUIPOS: Si el cliente pregunta por equipos, pregunta primero que necesita (caja, impresion de boletas, lector, control de vencimientos, terminal o pantalla) y cuantas sucursales tiene. No envies todo el catalogo ni inventes compatibilidades: comparte https://sysfarma.pe/equipos-para-farmacia y ofrece cotizar por WhatsApp. Si tambien necesita el software, explica que los equipos se integran con SysFarma y ofrece una demo del sistema.

COMO RESPONDER OBJECIONES (usa esto, es lo que de verdad convence):
- "Lo llevo en Excel / cuaderno": Excel no emite comprobantes SUNAT (necesita otro programa aparte), obliga a revisar los lotes a mano, se traba si dos cajeros escriben a la vez y no deja el historial por lote que pide DIGEMID. Aca todo eso es automatico. Se importa su Excel.
- "Ya tengo otro sistema / FarmaSystem": la diferencia es que SysFarma es cloud: entra desde cualquier navegador, sin servidor ni PC dedicada, con actualizaciones automaticas sin costo y reportes desde el celular. Los sistemas instalados piden infraestructura propia, actualizacion manual y a veces cobran por ella.
- "Es caro / cuanto me cuesta al final": ofrece el anual de S/ 690, equivalente a dos meses gratis, o el mensual de S/ 69 con todo incluido, sin licencia inicial ni costos ocultos y sin permanencia.
- "Y si no tengo internet?": tiene modo contingencia para seguir vendiendo un rato; y si prefiere, existe el plan de instalacion local offline.
- "Es dificil de aprender?": se domina en pocas horas, con capacitacion incluida; el cajero ya opera solo desde el segundo dia.
- "Necesito comprar equipos?": funciona en una PC o laptop normal con navegador.
- "Y mis datos actuales?": se importan catalogo, precios e inventario.

REGLAS: responde SOLO sobre SysFarma con esta info; NO inventes precios/funciones/plazos. Ofrece la demo y, para cerrar o algo personalizado (cadenas, descuentos), deriva al asesor (+51 916 050 559). NO haces operaciones (no tomas pedidos, no registras nada). Pide nombre y ciudad si no los tienes. Si preguntan algo que no esta aca, dilo y deriva al asesor.`;
}

// "hoy", "ayer", "hace 36 dias": el modelo necesita saber CUANDO se dijo cada
// cosa. Sin esto lee un "nos vemos manana" de hace un mes como si siguiera vigente.
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

function conversacionTexto(mensajes) {
  return mensajes
    .filter((m) => (m.cuerpo && String(m.cuerpo).trim() !== '') || m.media_archivo)
    .map((m) => {
      const cuando = hace(m.fecha);
      const media = m.media_archivo
        ? `[${m.tipo || 'archivo'}${m.media_nombre ? `: ${m.media_nombre}` : ''}]`
        : m.cuerpo;
      return `${m.direccion === 'in' ? '[CLIENTE]' : '[JEAN]'}${cuando ? ` (${cuando})` : ''}: ${media}`;
    })
    .join('\n');
}

// Flujo frecuente: se envia AnyDesk, el cliente acepta y luego se realiza una
// llamada. En ese punto la demo tecnica ya ocurrio; no hay que volver a pedir
// instalacion ni proponer otra reunion automaticamente.
function tratoCliente(mensajes) {
  const femenino = mensajes.some((m) => m.direccion === 'out'
    && /\b(srta\.?|señorita|señora|estimada)\b/i.test(String(m.cuerpo || '')));
  return femenino ? 'mi estimada' : 'mi estimado';
}

function seguimientoPostDemo(mensajes) {
  const llamada = [...mensajes].reverse().find((m) =>
    /llamada\s+(saliente|entrante)|llamada.*\d+\s*min|duracion.*llamada/i.test(String(m.cuerpo || '')));
  const dias = llamada?.fecha
    ? Math.max(0, Math.floor((Date.now() - new Date(llamada.fecha).getTime()) / 86400000))
    : null;
  const trato = tratoCliente(mensajes);
  const saludo = saludoLima();
  if (dias === 0) return `${saludo}, ${trato}. \u00bfQu\u00e9 le pareci\u00f3 el sistema?`;
  if (dias === 1) return `${saludo}, ${trato}, \u00bfc\u00f3mo est\u00e1? Ayer conversamos, \u00bfqu\u00e9 le pareci\u00f3 el sistema?`;
  const tiempo = dias !== null && dias < 30 ? `hace ${dias} d\u00edas` : 'hace varios d\u00edas';
  return `${saludo}, ${trato}, \u00bfc\u00f3mo est\u00e1? ${tiempo} conversamos, \u00bfqu\u00e9 le pareci\u00f3 el sistema?`;
}

function respuestaLlamadaPendiente(mensajes) {
  const entrada = [...mensajes].reverse().find((m) => m.direccion === 'in' && m.cuerpo);
  const indice = entrada ? mensajes.lastIndexOf(entrada) : -1;
  const anterior = indice > 0 ? mensajes.slice(0, indice).reverse().find((m) => m.direccion === 'out') : null;
  if (!entrada || !anterior || !/^(claro|si|sí|ok|dale|bueno)[.! ]*$/i.test(String(entrada.cuerpo).trim())) return null;
  if (!/puedo llamarle|puedo llamar|le llamo ahora|llamar ahora/i.test(String(anterior.cuerpo || ''))) return null;
  const dias = entrada.fecha ? Math.max(0, Math.floor((Date.now() - new Date(entrada.fecha).getTime()) / 86400000)) : 0;
  const trato = tratoCliente(mensajes);
  if (dias >= 2) {
    const tiempo = dias < 30 ? `hace ${dias} d\u00edas` : 'hace varios d\u00edas';
    return `${saludoLima()}, ${trato}, \u00bfc\u00f3mo est\u00e1? ${tiempo} quedamos en conversar. \u00bfA\u00fan desea que coordinemos la demostraci\u00f3n?`;
  }
  return `Perfecto, ${trato}. Le llamo ahora.`;
}

function horarioRecientePropuesto(mensajes) {
  const entrada = [...mensajes].reverse().find((m) => m.direccion === 'in' && m.cuerpo);
  if (!entrada || !entrada.fecha) return null;
  const dias = Math.floor((Date.now() - new Date(entrada.fecha).getTime()) / 86400000);
  if (!Number.isFinite(dias) || dias > 1) return null;
  const texto = String(entrada.cuerpo).trim().replace(/[.!?]+$/, '');
  const tieneDia = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo|hoy|ma[nñ]ana|\d{1,2}\/\d{1,2})\b/i.test(texto);
  const tieneHora = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm|de la ma[nñ]ana|de la tarde|de la noche)\b/i.test(texto);
  if (!tieneDia || !tieneHora) return null;
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

function flujoTecnicoCompletado(mensajes) {
  let anydesk = false;
  let llamada = -1;
  let ultimaEntrada = -1;
  mensajes.forEach((m, i) => {
    const texto = String(m.cuerpo || '').toLowerCase();
    if (m.direccion === 'in') ultimaEntrada = i;
    if (m.direccion === 'out' && /anydesk|acceso remoto/.test(texto)) anydesk = true;
    if (/llamada\s+(saliente|entrante)|llamada.*\d+\s*min|duracion.*llamada/i.test(texto)) llamada = i;
  });
  return anydesk && llamada >= 0 && ultimaEntrada < llamada;
}

// La ficha persistida conserva los hechos de todo el chat. Para redactar solo
// necesitamos la ficha y una ventana reciente que mantenga el tono y el ultimo
// intercambio; asi evitamos reenviar conversaciones largas en cada sugerencia.
function ventanaReciente(mensajes, maxMensajes = 32, maxCaracteres = 12000) {
  const visibles = mensajes.filter((m) => (m.cuerpo && String(m.cuerpo).trim() !== '') || m.media_archivo);
  const seleccion = visibles.slice(-maxMensajes);
  let texto = conversacionTexto(seleccion);
  while (texto.length > maxCaracteres && seleccion.length > 2) {
    seleccion.shift();
    texto = conversacionTexto(seleccion);
  }
  return { mensajes: seleccion, texto };
}

// El modelo puede ignorar una regla de estilo aunque el contexto sea correcto.
// Si Jean ya uso trato femenino en este chat, no dejamos pasar "mi estimado".
// No adivinamos genero por el nombre: usamos evidencia explicita.
function validarSugerencia(texto, mensajes = [], contextoManual = '') {
  let salida = String(texto || '').trim();
  // Los overrides de abajo deducen el estado SOLO del chat. Si Jean dio
  // contexto manual (hechos fuera del chat: llamada hecha, acuerdo verbal),
  // esas deducciones quedan desactualizadas y pisarian al modelo con pasos ya
  // resueltos -- se saltan y solo se corrige estilo (genero).
  if (!String(contextoManual || '').trim()) {
  const llamadaPendiente = respuestaLlamadaPendiente(mensajes);
  if (llamadaPendiente) return llamadaPendiente;
  const horario = horarioRecientePropuesto(mensajes);
  if (horario) {
    const remoto = mensajes.some((m) => /anydesk|acceso remoto/i.test(String(m.cuerpo || '')));
    const siguiente = remoto
      ? 'ese día nos conectamos por AnyDesk.'
      : 'le enviaré el enlace antes de la demo.';
    return `Perfecto, ${tratoCliente(mensajes)}. Quedamos para ${horario}; ${siguiente}`;
  }
  if (flujoTecnicoCompletado(mensajes)) {
    return seguimientoPostDemo(mensajes);
  }
  const ultimoCliente = [...mensajes].reverse().find((m) => m.direccion === 'in' && m.cuerpo);
  const ultimoTexto = String(ultimoCliente?.cuerpo || '');
  const mencionaMasTarde = /\b(mas tarde|luego|despues)\b/i.test(ultimoTexto);
  const mencionaHora = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche)\b/i.test(ultimoTexto);
  if (mencionaMasTarde && !mencionaHora) {
    return '¿A que hora le seria mas comodo conectarse?';
  }
  }
  const femenino = mensajes.some((m) => m.direccion === 'out'
    && /\b(srta\.?|señorita|señora|estimada)\b/i.test(String(m.cuerpo || '')));
  if (femenino && /\bmi estimado\b/i.test(salida)) {
    const trato = mensajes
      .filter((m) => m.direccion === 'out')
      .map((m) => String(m.cuerpo || '').match(/\b(srta\.?|señorita|señora|estimada)\b/i)?.[1])
      .filter(Boolean).pop() || 'estimada';
    salida = salida.replace(/\bmi estimado\b/gi, trato);
  }
  return salida;
}

async function geminiTexto(system, userText, creds) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(creds.model)}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': creds.apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0.5 },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) { const e = new Error(`Gemini ${r.status}`); e.status = r.status; throw e; }
  const data = await r.json();
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

// Respaldo principal: OpenAI (gpt-4o-mini). El modelo de NVIDIA que se usaba
// antes llego a su fin de vida (HTTP 410), asi que OpenAI va primero.
async function openaiTexto(system, userText, creds) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.apiKey}` },
    body: JSON.stringify({
      model: creds.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: userText }],
      temperature: 0.5,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) { const e = new Error(`OpenAI ${r.status}`); e.status = r.status; throw e; }
  const data = await r.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

async function nvidiaTexto(system, userText, creds) {
  const r = await fetch(`${creds.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.apiKey}` },
    body: JSON.stringify({
      model: creds.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: userText }],
      temperature: 0.5,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) { const e = new Error(`NVIDIA ${r.status}`); e.status = r.status; throw e; }
  const data = await r.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

// Sugiere el proximo mensaje de Jean para este lead. Si lo ultimo lo dijo el
// cliente, responde a eso; si lo ultimo lo dijo Jean (cliente callado), sugiere
// un seguimiento breve. Gemini con respaldo NVIDIA.
export async function sugerirRespuesta({ lead, mensajes, memoria = null, ejemplos = '', contextoManual = '' }) {
  const saludo = saludoLima();
  const system = `${kb(saludo)}${ejemplos}

MODO SUGERENCIA: Redacta UNICAMENTE el proximo mensaje que Jean enviaria ahora, listo para copiar y enviar. No expliques, no uses comillas ni encabezados, solo el mensaje.

REGLA CRITICA -- LEE TODA LA CONVERSACION ANTES DE ESCRIBIR:
- FLUJO TECNICO: si Jean pidio AnyDesk y despues aparece una llamada con
  duracion, la demostracion ya se hizo. No vuelvas a pedir AnyDesk, instalarlo,
  aceptar ni agendar otra reunion; pregunta que le parecio o continua al cierre.
- Si se envio un enlace de Google Meet y luego aparece una llamada o mensajes
  posteriores a la demostracion, considera la reunion realizada y no la repitas.
- NUNCA pidas un dato que el cliente YA dio (nombre, ciudad, RUC, razon social, plan elegido).
- NUNCA ofrezcas algo que YA se envio (demo, cotizacion, contrato, medios de pago, link).
  Si en la conversacion aparece "📄 Contrato...", "📄 Cotizacion...", "MEDIOS DE PAGO" o
  "DATOS A REQUERIR", eso YA se mando: continua desde ahi, no lo repitas.
- Si el cliente ya dijo que acepta ("cerrado", "trabajamos contigo", "ya te pago"), NO
  vuelvas a vender ni a ofrecer demo: pasa a lo operativo (confirmar el pago, pedir SOLO
  los datos que falten, coordinar la instalacion).
- Si el cliente ya dio un dia y una hora exactos (por ejemplo, "jueves a las 10 am"),
  NO preguntes otra vez si tiene disponibilidad: confirma ese horario y continua con
  el siguiente paso (enviar enlace o indicar la llamada). Si la fecha del mensaje ya
  paso, reconoce que vencio y propone reagendar; no la confirmes como futura.
- Si el cliente dice "aun no", "no por ahora" o "pero gracias", no lo presiones
  con pago, instalacion ni otra demo: responde amable, deja abierta la posibilidad
  de ayudarlo y pregunta si desea que lo contactes mas adelante.
- Continua la conversacion desde el punto exacto donde quedo, como lo haria un vendedor
  que se acuerda de todo lo hablado.
- Los marcadores "📷 [foto]", "🎤 [nota de voz]", "📞 Llamada ..." son contexto de lo que
  ya paso: tenlos en cuenta (una llamada larga = ya hablaron de eso).

OJO CON LAS FECHAS (cada mensaje lleva entre parentesis hace cuanto se escribio):
- HOY es ${new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima' })}.
- Son las ${new Date().toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Lima' })} AHORA MISMO. Si estas proponiendo o confirmando una hora
  para HOY, tiene que ser una hora que TODAVIA NO PASO (despues de la hora
  actual) -- nunca confirmes ni ofrezcas una hora de hoy que ya paso.
- Un "manana", "hoy a las 5" o "el lunes" dicho hace dias YA PASO. NUNCA lo
  confirmes como si siguiera en pie (decir "perfecto, manana a las 17:00" sobre
  una cita de hace un mes queda pesimo).
- Si quedo una cita y ya paso sin novedad, retomala con humildad y propone una
  fecha NUEVA, sin dar por hecho la vieja. Ej: "mi estimado, se nos paso la
  reunion, esta con tiempo esta semana?".
- Si pasaron muchos dias sin contacto, reconoce el tiempo transcurrido en vez de
  escribir como si la conversacion siguiera viva de ayer.

HORARIOS SIEMPRE EN FORMATO 12 HORAS (asi se habla en Peru):
- Escribe "5:00 p.m.", "10:30 a.m.", "8 de la noche", "3 de la tarde".
- NUNCA uses formato 24 horas: nada de "17:00", "20:30" ni "las 15 horas".
- Si el cliente escribe en 24 horas ("a las 17:00"), tu respondele en 12 horas
  ("perfecto, 5:00 p.m."), sin corregirlo ni hacerlo notar.`;

  // La memoria es la fuente de verdad del historial. Solo reenviamos una
  // ventana reciente para conservar el tono y el intercambio actual.
  const { mensajes: recientes, texto: conv } = ventanaReciente(mensajes);
  const ultimo = mensajes.filter((m) => m.cuerpo).slice(-1)[0];
  // Con contexto manual, ESE es el estado real: lo que Jean cuenta paso fuera
  // del chat (llamada, Meet, acuerdo verbal) es mas reciente que lo que el
  // chat aparenta -- la instruccion normal de "retomar lo pendiente del chat"
  // haria repetir algo ya resuelto.
  const instruccion = String(contextoManual || '').trim()
    ? `Redacta el proximo mensaje CONTINUANDO desde los HECHOS FUERA DEL CHAT que conto Jean (abajo). Esos hechos son lo mas reciente y real; NO retomes pasos del chat que esos hechos ya dan por resueltos.
RESPETA LOS TIEMPOS ACORDADOS: si los hechos dicen que el cliente confirmara o respondera en un momento futuro ("hoy en la noche", "mañana", "la proxima semana"), NO le pidas esa confirmacion antes de tiempo ni se la vuelvas a preguntar: reconoce lo acordado y deja claro que quedas atento para ese momento (ej. "Perfecto, quedo atento a su confirmacion esta noche"). Presionar antes de la hora acordada arruina la venta.`
    : (ultimo && ultimo.direccion === 'out'
      ? 'El cliente aun no responde tu ultimo mensaje. Sugiere un seguimiento breve y amable que retome EXACTAMENTE lo que quedo pendiente (segun la etapa real de la conversacion), sin sonar insistente y sin repetir lo ya enviado.'
      : 'Redacta la respuesta al ultimo mensaje del cliente, continuando desde donde quedo la conversacion.');

  // La FICHA (memoria) es la fuente de verdad de los hechos: que datos ya dio el
  // cliente, que se le envio y que falta. Si aun no hay memoria, cae a las notas.
  let contexto = memoriaATexto(memoria);
  // Refuerza que la etapa actual no se debe reiniciar por ver solo la ventana.
  if (contexto && mensajes.length > recientes.length) {
    contexto += `\nHISTORIAL: esta conversacion tiene ${mensajes.length} mensajes; la ficha resume los anteriores y aqui ves los ultimos ${recientes.length}. YA te presentaste antes.`;
  }
  if (!contexto) {
    const etapa = /^\[([a-z_]+)\/(\w+)\]\s*(.*)$/i.exec(String(lead?.notas || ''));
    contexto = etapa ? `ETAPA ACTUAL: ${etapa[1]} (${etapa[2]}). ${etapa[3]}` : '';
  }

  const datos = [lead?.nombre ? `Nombre: ${lead.nombre}` : '', lead?.ciudad ? `Ciudad: ${lead.ciudad}` : '']
    .filter(Boolean).join(' · ');
  const contextoExtra = String(contextoManual || '').trim();
  const userText = `${datos ? `${datos}\n` : ''}${contexto ? `FICHA DEL CLIENTE (fuente de verdad, no la contradigas):\n${contexto}\n` : ''}${contextoExtra ? `HECHOS FUERA DEL CHAT contados por Jean (MAXIMA PRIORIDAD: el chat no los registra; si el chat aparenta otra cosa, estos hechos GANAN y la conversacion continua desde aqui):\n${contextoExtra}\n` : ''}\nUltimos mensajes:\n${conv || '(sin mensajes previos)'}\n\n${instruccion}`;

  const gcreds = await getGeminiCreds();
  if (gcreds.apiKey) {
    try {
      const t = await geminiTexto(system, userText, gcreds);
      if (t) return validarSugerencia(t, mensajes, contextoManual);
    } catch { /* cae a NVIDIA */ }
  }
  const ocreds = await getOpenaiCreds();
  if (ocreds.apiKey) {
    try {
      const t = await openaiTexto(system, userText, ocreds);
      if (t) return validarSugerencia(t, mensajes, contextoManual);
    } catch { /* cae a NVIDIA */ }
  }
  const ncreds = await getNvidiaCreds();
  if (ncreds.apiKey) {
    const t = await nvidiaTexto(system, userText, ncreds);
    if (t) return validarSugerencia(t, mensajes, contextoManual);
  }
  throw new Error('No hay IA configurada (Gemini/OpenAI) para sugerir la respuesta.');
}
