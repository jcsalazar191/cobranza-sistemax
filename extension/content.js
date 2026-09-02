// Panel copiloto (ISOLATED world). Recibe el chat activo desde inject.js
// (MAIN world) y habla con el backend a traves del service worker.
(function () {
  'use strict';
  const FUENTE = 'copiloto-sysfarma';

  const ETAPAS = {
    por_pagar: '💰 Por pagar', negociando: '🤝 Negociando', cotizado: '💵 Cotizado',
    demo: '🖥️ Demo', por_confirmar: '⏳ Por confirmar', info_enviada: '📤 Info enviada',
    primer_contacto: '👋 Primer contacto', cerrado: '✅ Cerrado', frio: '❄️ Frio', descartado: '✖ Descartado',
  };
  const analisis = (notas) => /^\[([a-z_]+)\/(\w+)\]\s*(.*)$/i.exec(String(notas || ''));

  // Tras recargar la extension (⟳), el content script viejo queda huerfano y
  // chrome.runtime lanza "Extension context invalidated" — un F5 en WhatsApp
  // Web lo resuelve; aqui solo se degrada con un aviso claro en vez de romper.
  const MUERTO = { ok: false, status: 0, data: { error: 'Extension recargada: presiona F5 en WhatsApp Web.' } };
  const api = (method, path, body) => new Promise((resolve) => {
    if (!chrome.runtime?.id) return resolve(MUERTO);
    try {
      chrome.runtime.sendMessage({ tipo: 'api', method, path, body }, (r) => {
        resolve(r || { ok: false, status: 0, data: { error: chrome.runtime.lastError?.message || 'Extension sin respuesta.' } });
      });
    } catch { resolve(MUERTO); }
  });

  let chatActual = null;   // { telefono, nombre, mensajes }
  let lead = null;         // ficha del backend (o null)
  let plantillas = [];
  let cargandoIA = false;
  // Cierre del ciclo de aprendizaje: tras una sugerencia, el proximo mensaje
  // SALIENTE nuevo en ese chat es lo que Jean mando de verdad -> se reporta al
  // backend para comparar sugerido vs enviado (su edicion enseña a la IA).
  let pendiente = null;    // { telefono, sugerencia_id, ultimoOut, hasta }
  let wajs = null;         // estado de wa-js reportado por inject.js

  const ultimoOut = (msgs) => [...(msgs || [])].reverse().find((m) => m.direccion === 'out')?.cuerpo || null;

  function revisarEnvio(chat) {
    if (!pendiente || !chat || chat.telefono !== pendiente.telefono) return;
    if (Date.now() > pendiente.hasta) { pendiente = null; return; }
    const out = ultimoOut(chat.mensajes);
    if (!out || out === pendiente.ultimoOut) return;
    const p = pendiente;
    pendiente = null;
    api('POST', '/leads/aprendizaje-envio', { telefono: p.telefono, sugerencia_id: p.sugerencia_id, enviado: out });
  }

  // ---------- UI ----------
  const raiz = document.createElement('div');
  raiz.id = 'cop-sf';
  document.documentElement.appendChild(raiz);
  raiz.innerHTML = `
    <button id="cop-toggle" type="button" title="Copiloto SysFarma">✨ Copiloto</button>
    <aside id="cop-panel" hidden>
      <header>
        <strong>Copiloto</strong>
        <span id="cop-head-botones">
          <button id="cop-tablero" type="button" title="Abrir tablero">📋 Tablero</button>
          <button id="cop-cerrar" type="button" title="Cerrar">✕</button>
        </span>
      </header>
      <div id="cop-login" hidden>
        <p class="cop-nota">Inicia sesion en cobranza para usar el copiloto.</p>
        <input id="cop-email" type="email" placeholder="Correo" autocomplete="username">
        <input id="cop-pass" type="password" placeholder="Contraseña" autocomplete="current-password">
        <button id="cop-entrar" type="button" class="cop-primario">Entrar</button>
        <p id="cop-login-error" class="cop-error" hidden></p>
      </div>
      <div id="cop-cuerpo" hidden>
        <section id="cop-ficha"><p class="cop-nota">Abre una conversacion en WhatsApp.</p></section>
        <section>
          <textarea id="cop-contexto" rows="2" placeholder="Contexto extra: llamada, Meet/Zoom, acuerdos fuera del chat…"></textarea>
          <button id="cop-sugerir" type="button" class="cop-primario" disabled>✨ Sugerir respuesta</button>
          <div id="cop-sug-zona" hidden>
            <textarea id="cop-sugerencia" rows="6"></textarea>
            <div class="cop-fila">
              <button id="cop-insertar" type="button" class="cop-primario">Insertar en el chat</button>
              <button id="cop-copiar" type="button">Copiar</button>
            </div>
          </div>
          <p id="cop-error" class="cop-error" hidden></p>
        </section>
        <section id="cop-plantillas-zona" hidden>
          <p class="cop-titulo-sec">Plantillas</p>
          <div id="cop-plantillas"></div>
        </section>
        <section id="cop-extra" hidden>
          <p class="cop-titulo-sec">Recordarme</p>
          <div class="cop-fila">
            <button type="button" class="cop-rec" data-dias="1">⏰ Mañana</button>
            <button type="button" class="cop-rec" data-dias="2">2 días</button>
            <button type="button" class="cop-rec" data-dias="7">1 semana</button>
          </div>
          <div class="cop-fila cop-fila-fecha">
            <input id="cop-rec-fecha" type="date">
            <select id="cop-rec-h"></select>
            <select id="cop-rec-m"><option>00</option><option>15</option><option>30</option><option>45</option></select>
            <select id="cop-rec-ap"><option value="am">a.m.</option><option value="pm" selected>p.m.</option></select>
            <button id="cop-rec-fijar" type="button">Fijar</button>
          </div>
          <p class="cop-titulo-sec">Resultado de la última respuesta</p>
          <div class="cop-fila-wrap">
            <button type="button" class="cop-res" data-res="respondio">👍 Respondió</button>
            <button type="button" class="cop-res" data-res="pago">💰 Pagó</button>
            <button type="button" class="cop-res" data-res="sin_respuesta">😴 Sin respuesta</button>
            <button type="button" class="cop-res" data-res="rechazo">✖ Rechazo</button>
          </div>
          <p class="cop-titulo-sec">Notas</p>
          <textarea id="cop-notas" rows="3"></textarea>
          <button id="cop-notas-guardar" type="button">Guardar notas</button>
          <p id="cop-extra-msg" class="cop-nota" hidden></p>
        </section>
      </div>
    </aside>`;

  const $ = (id) => raiz.querySelector('#' + id);
  const panel = $('cop-panel');

  $('cop-toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) arrancar();
  });
  $('cop-cerrar').addEventListener('click', () => { panel.hidden = true; });
  $('cop-tablero').addEventListener('click', () => window.__copTablero?.toggle());

  // ---------- sesion ----------
  async function arrancar() {
    const r = await api('GET', '/me');
    const conSesion = r.ok;
    $('cop-login').hidden = conSesion;
    $('cop-cuerpo').hidden = !conSesion;
    if (conSesion && !plantillas.length) cargarPlantillas();
  }

  $('cop-entrar').addEventListener('click', async () => {
    const r = await api('POST', '/login', { email: $('cop-email').value.trim(), password: $('cop-pass').value });
    if (r.ok) { $('cop-login-error').hidden = true; arrancar(); }
    else { $('cop-login-error').textContent = r.data?.error || 'No se pudo entrar.'; $('cop-login-error').hidden = false; }
  });

  async function cargarPlantillas() {
    const r = await api('GET', '/leads/plantillas');
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return;
    plantillas = r.data;
    const cont = $('cop-plantillas');
    cont.textContent = '';
    for (const p of plantillas.slice(0, 12)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cop-chip';
      b.textContent = p.titulo;
      b.title = p.texto;
      // {nombre} se rellena con el primer nombre del cliente al insertar.
      b.addEventListener('click', () => {
        const nombre = String(lead?.nombre || chatActual?.nombre || '').trim().split(/\s+/)[0] || '';
        insertarEnChat(p.texto.replace(/\{nombre\}/gi, nombre).replace(/\s{2,}/g, ' '));
      });
      cont.appendChild(b);
    }
    $('cop-plantillas-zona').hidden = false;
  }

  // ---------- chat activo ----------
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (ev.source !== window || d?.fuente !== FUENTE) return;
    if (d.tipo === 'chat') { chatActual = d.chat; revisarEnvio(d.chat); refrescarFicha(); }
    if (d.tipo === 'wajs') { wajs = d; if (!chatActual) refrescarFicha(); }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.tipo === 'abrir-chat' && msg.telefono) {
      window.postMessage({ fuente: FUENTE + '-ui', tipo: 'abrir-chat', telefono: msg.telefono }, '*');
    }
    if (msg?.tipo === 'abrir-tablero') window.__copTablero?.toggle();
  });

  let telAnterior = null;
  async function refrescarFicha() {
    const ficha = $('cop-ficha');
    // El contexto manual es por cliente: se limpia solo al cambiar de chat
    // (no en las actualizaciones del mismo chat, para no borrar lo escrito).
    if (chatActual?.telefono !== telAnterior) {
      telAnterior = chatActual?.telefono || null;
      $('cop-contexto').value = '';
    }
    $('cop-sugerir').disabled = !chatActual?.telefono || cargandoIA;
    $('cop-sug-zona').hidden = true;
    $('cop-error').hidden = true;
    $('cop-extra').hidden = true;
    lead = null;

    if (!chatActual) {
      const msj = wajs && !wajs.ok
        ? (wajs.definido
          ? '⏳ wa-js cargando… si esto no cambia en ~15s, WhatsApp cambio por dentro: hay que actualizar wa-js.'
          : '✗ wa-js no se cargo (revisa la consola F12).')
        : 'Abre una conversacion en WhatsApp.';
      ficha.innerHTML = '<p class="cop-nota"></p>';
      ficha.querySelector('.cop-nota').textContent = msj;
      return;
    }
    if (!chatActual.telefono) { ficha.innerHTML = '<p class="cop-nota">Este chat no expone numero (LID). Solo plantillas.</p>'; return; }

    const r = await api('GET', '/leads/por-telefono/' + encodeURIComponent(chatActual.telefono));
    if (r.status === 401) { arrancar(); return; }
    if (r.ok) lead = r.data;
    $('cop-extra').hidden = !lead;
    $('cop-notas').value = lead?.notas || '';

    const a = lead ? analisis(lead.notas) : null;
    const etapa = a ? (ETAPAS[a[1]] || a[1]) : null;
    const espera = lead?.ultima_direccion === 'in';
    ficha.innerHTML = `
      <p class="cop-nombre"></p>
      <p class="cop-tel"></p>
      <div class="cop-badges">
        ${etapa ? `<span class="cop-badge cop-badge-etapa"></span>` : ''}
        ${lead ? `<span class="cop-badge ${espera ? 'cop-badge-espera' : ''}">${espera ? 'TE ESPERA' : 'ESPERANDO RESPUESTA'}</span>` : '<span class="cop-badge">NO REGISTRADO</span>'}
        ${lead?.score != null ? `<span class="cop-badge cop-badge-score"></span>` : ''}
      </div>
      ${a?.[3] ? `<p class="cop-nota cop-resumen"></p>` : ''}
      <div class="cop-etiquetas"></div>`;
    ficha.querySelector('.cop-nombre').textContent = lead?.nombre || chatActual.nombre || chatActual.telefono;
    ficha.querySelector('.cop-tel').textContent = chatActual.telefono + (lead?.ciudad ? ' · ' + lead.ciudad : '');
    if (etapa) ficha.querySelector('.cop-badge-etapa').textContent = etapa;
    if (lead?.score != null) ficha.querySelector('.cop-badge-score').textContent = 'score ' + lead.score;
    if (a?.[3]) ficha.querySelector('.cop-resumen').textContent = a[3];

    // Etiquetas de WhatsApp: clic = poner/quitar (mueve el chat de columna en
    // el tablero). Solo aparece si el WhatsApp expone etiquetas (Business).
    const zona = ficha.querySelector('.cop-etiquetas');
    const activas = new Set(chatActual.etiquetas || []);
    for (const et of chatActual.catalogo || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cop-et' + (activas.has(et.id) ? ' activa' : '');
      if (et.color) b.style.setProperty('--et-color', et.color);
      const punto = document.createElement('span');
      punto.className = 'cop-et-punto';
      b.appendChild(punto);
      b.appendChild(document.createTextNode(et.nombre));
      b.addEventListener('click', () => {
        window.postMessage({
          fuente: FUENTE + '-ui', tipo: 'etiqueta',
          telefono: chatActual.telefono, labelId: et.id,
          accion: activas.has(et.id) ? 'remove' : 'add',
        }, '*');
        b.disabled = true; // inject re-reporta el chat y la ficha se repinta sola
      });
      zona.appendChild(b);
    }
  }

  // ---------- sugerencia IA ----------
  $('cop-sugerir').addEventListener('click', async () => {
    if (!chatActual?.telefono || cargandoIA) return;
    cargandoIA = true;
    const btn = $('cop-sugerir');
    btn.disabled = true;
    btn.textContent = '⏳ Pensando…';
    $('cop-error').hidden = true;
    const r = await api('POST', '/leads/sugerir-directo', {
      telefono: chatActual.telefono,
      nombre: chatActual.nombre,
      mensajes: chatActual.mensajes,
      contexto: $('cop-contexto').value.trim(),
    });
    cargandoIA = false;
    btn.disabled = false;
    btn.textContent = '✨ Sugerir respuesta';
    if (r.ok && r.data?.sugerencia) {
      $('cop-sugerencia').value = r.data.sugerencia;
      $('cop-sug-zona').hidden = false;
      if (r.data.sugerencia_id) {
        pendiente = {
          telefono: chatActual.telefono,
          sugerencia_id: r.data.sugerencia_id,
          ultimoOut: ultimoOut(chatActual.mensajes),
          hasta: Date.now() + 10 * 60e3, // 10 min: no atar un envio tardio a una sugerencia vieja
        };
      }
    } else {
      $('cop-error').textContent = r.data?.error || `Error ${r.status || ''} al sugerir.`;
      $('cop-error').hidden = false;
      if (r.status === 401) arrancar();
    }
  });

  $('cop-copiar').addEventListener('click', () => navigator.clipboard.writeText($('cop-sugerencia').value).catch(() => {}));
  $('cop-insertar').addEventListener('click', () => insertarEnChat($('cop-sugerencia').value));

  // ---------- recordatorio / resultado / notas ----------
  function avisar(texto) {
    const m = $('cop-extra-msg');
    m.textContent = texto;
    m.hidden = false;
    setTimeout(() => { m.hidden = true; }, 4000);
  }

  async function crearRecordatorio(cuerpo) {
    if (!chatActual?.telefono) return;
    const r = await api('POST', '/leads/recordatorio', {
      telefono: chatActual.telefono,
      nota: $('cop-contexto').value.trim(),
      ...cuerpo,
    });
    avisar(r.ok
      ? `⏰ Recordatorio: ${new Date(r.data.fecha_hora).toLocaleString('es-PE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      : (r.data?.error || 'No se pudo crear.'));
  }

  for (const b of raiz.querySelectorAll('.cop-rec')) {
    b.addEventListener('click', () => crearRecordatorio({ dias: Number(b.dataset.dias) }));
  }
  // Horas en formato 12h (1-12), por defecto 3 p.m.
  for (let h = 1; h <= 12; h++) {
    const o = document.createElement('option');
    o.value = String(h);
    o.textContent = String(h);
    if (h === 3) o.selected = true;
    $('cop-rec-h').appendChild(o);
  }
  $('cop-rec-fijar').addEventListener('click', () => {
    const v = $('cop-rec-fecha').value;
    if (!v) { avisar('Elige la fecha primero.'); return; }
    let h = Number($('cop-rec-h').value) % 12;
    if ($('cop-rec-ap').value === 'pm') h += 12;
    const fecha = new Date(`${v}T00:00`); // hora local del vendedor
    fecha.setHours(h, Number($('cop-rec-m').value), 0, 0);
    crearRecordatorio({ fecha_hora: fecha.toISOString() });
  });

  for (const b of raiz.querySelectorAll('.cop-res')) {
    b.addEventListener('click', async () => {
      if (!lead?.id) return;
      const r = await api('POST', `/leads/${lead.id}/aprendizaje-resultado`, { resultado: b.dataset.res });
      avisar(r.ok ? '✓ Resultado guardado (la IA aprende de esto).' : (r.data?.error || 'No se pudo guardar.'));
    });
  }

  $('cop-notas-guardar').addEventListener('click', async () => {
    if (!lead?.id) return;
    const r = await api('PATCH', `/leads/${lead.id}`, { notas: $('cop-notas').value });
    avisar(r.ok ? '✓ Notas guardadas.' : (r.data?.error || 'No se pudo guardar.'));
  });

  // Unico punto que toca el DOM de WhatsApp: el cuadro de redaccion. Si Meta
  // cambia el selector, cae a copiar al portapapeles (nunca rompe el panel).
  function insertarEnChat(texto) {
    if (!texto) return;
    const caja = document.querySelector('footer [contenteditable="true"]');
    if (!caja) { navigator.clipboard.writeText(texto).catch(() => {}); return; }
    caja.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(caja);
    document.execCommand('insertText', false, texto);
  }
})();
