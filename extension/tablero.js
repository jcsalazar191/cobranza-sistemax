// Tablero de posibles INTEGRADO en WhatsApp Web: overlay a pantalla completa
// con columnas por etapa (clon del PosiblesView). Clic en una tarjeta = abre
// ese chat aqui mismo via wa-js. Cargado antes que content.js (mismo mundo
// ISOLATED); expone window.__copTablero.toggle() para el boton del panel.
(function () {
  'use strict';

  const ETAPAS_TABLERO = ['por_pagar', 'negociando', 'cotizado', 'demo', 'por_confirmar', 'info_enviada', 'primer_contacto', 'frio'];
  const ETAPAS = {
    por_pagar: '💰 Por pagar', negociando: '🤝 Negociando', cotizado: '💵 Cotizado',
    demo: '🖥️ Demo', por_confirmar: '⏳ Por confirmar', info_enviada: '📤 Info enviada',
    primer_contacto: '👋 Primer contacto', frio: '❄️ Frio',
  };
  const analisis = (notas) => /^\[([a-z_]+)\/(\w+)\]\s*(.*)$/i.exec(String(notas || ''));

  // Mismo blindaje que content.js: extension recargada = runtime muerto.
  const MUERTO = { ok: false, status: 0, data: { error: 'Extension recargada: presiona F5 en WhatsApp Web.' } };
  const api = (method, path, body) => new Promise((resolve) => {
    if (!chrome.runtime?.id) return resolve(MUERTO);
    try {
      chrome.runtime.sendMessage({ tipo: 'api', method, path, body }, (r) => {
        resolve(r || { ok: false, status: 0, data: { error: chrome.runtime.lastError?.message || 'Extension sin respuesta.' } });
      });
    } catch { resolve(MUERTO); }
  });

  let leads = [];
  let hoy = [];               // cola de seguimientos del dia (con motivo)
  let etiquetas = null;       // columnas por etiqueta de WhatsApp Business
  let modo = 'wa';            // 'wa' = etiquetas de WhatsApp | 'ia' = etapas del backend
  let visibles = new Set(ETAPAS_TABLERO);
  let ordenAntiguos = false;
  let montado = false;

  const raiz = document.createElement('div');
  raiz.id = 'cop-tab';
  raiz.hidden = true;

  function montar() {
    if (montado) return;
    montado = true;
    document.documentElement.appendChild(raiz);
    raiz.innerHTML = `
      <header>
        <span class="cop-tab-titulo">Posibles</span>
        <button id="cop-tab-modo-hoy" type="button">📆 Hoy</button>
        <button id="cop-tab-modo-wa" type="button" class="activa">Etiquetas WA</button>
        <button id="cop-tab-modo-ia" type="button">Etapas IA</button>
        <div id="cop-tab-chips" hidden></div>
        <span class="cop-tab-sep"></span>
        <button id="cop-tab-orden" type="button">Antiguos</button>
        <button id="cop-tab-refrescar" type="button" title="Actualizar">⟳</button>
        <button id="cop-tab-cerrar" type="button" title="Cerrar">✕</button>
      </header>
      <p id="cop-tab-estado" class="cop-tab-nota">Cargando…</p>
      <main id="cop-tab-cols"></main>`;

    const setModo = (m) => {
      modo = m;
      for (const [id, clave] of [['cop-tab-modo-hoy', 'hoy'], ['cop-tab-modo-wa', 'wa'], ['cop-tab-modo-ia', 'ia']]) {
        raiz.querySelector('#' + id).classList.toggle('activa', m === clave);
      }
      raiz.querySelector('#cop-tab-chips').hidden = m !== 'ia';
      cargar();
    };
    raiz.querySelector('#cop-tab-modo-hoy').addEventListener('click', () => setModo('hoy'));
    raiz.querySelector('#cop-tab-modo-wa').addEventListener('click', () => setModo('wa'));
    raiz.querySelector('#cop-tab-modo-ia').addEventListener('click', () => setModo('ia'));

    // Respuesta de inject.js (MAIN) con las etiquetas del WhatsApp vinculado.
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (ev.source !== window || d?.fuente !== 'copiloto-sysfarma' || d.tipo !== 'etiquetas') return;
      etiquetas = d.columnas;
      if (modo === 'wa') render();
    });

    const chips = raiz.querySelector('#cop-tab-chips');
    for (const et of ETAPAS_TABLERO) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cop-tab-chip activa';
      b.textContent = ETAPAS[et];
      b.addEventListener('click', () => {
        if (visibles.has(et)) visibles.delete(et); else visibles.add(et);
        b.classList.toggle('activa', visibles.has(et));
        render();
      });
      chips.appendChild(b);
    }
    raiz.querySelector('#cop-tab-orden').addEventListener('click', (ev) => {
      ordenAntiguos = !ordenAntiguos;
      ev.currentTarget.classList.toggle('activa', ordenAntiguos);
      render();
    });
    raiz.querySelector('#cop-tab-refrescar').addEventListener('click', cargar);
    raiz.querySelector('#cop-tab-cerrar').addEventListener('click', () => { raiz.hidden = true; });
  }

  async function cargar() {
    const estado = raiz.querySelector('#cop-tab-estado');
    estado.textContent = 'Cargando…';
    estado.hidden = false;
    if (modo === 'wa') {
      // Pide las etiquetas a inject.js; la respuesta llega por el listener.
      window.postMessage({ fuente: 'copiloto-sysfarma-ui', tipo: 'listar-etiquetas' }, '*');
      return;
    }
    if (modo === 'hoy') {
      const rh = await api('GET', '/leads/seguimientos');
      if (!rh.ok) {
        estado.textContent = rh.status === 401
          ? 'Sin sesion: entra desde el panel ✨ Copiloto.'
          : (rh.data?.error || `Error ${rh.status}.`);
        return;
      }
      hoy = Array.isArray(rh.data) ? rh.data : [];
      render();
      return;
    }
    const r = await api('GET', '/leads');
    if (!r.ok) {
      estado.textContent = r.status === 401
        ? 'Sin sesion: entra desde el panel ✨ Copiloto.'
        : (r.data?.error || `Error ${r.status}.`);
      return;
    }
    leads = Array.isArray(r.data) ? r.data : [];
    render();
  }

  function fmt(fecha) {
    if (!fecha) return '';
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-PE', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // Columnas = etiquetas reales del WhatsApp Business vinculado.
  function renderWa() {
    const cont = raiz.querySelector('#cop-tab-cols');
    const estado = raiz.querySelector('#cop-tab-estado');
    cont.textContent = '';
    if (!Array.isArray(etiquetas) || !etiquetas.length) {
      estado.hidden = false;
      estado.textContent = etiquetas === null
        ? 'Este WhatsApp no expone etiquetas (se necesita WhatsApp Business).'
        : 'Sin chats con etiqueta todavia.';
      return;
    }
    estado.hidden = true;

    for (const col of etiquetas) {
      const columna = document.createElement('section');
      columna.className = 'cop-tab-col';
      const head = document.createElement('header');
      const etiqueta = document.createElement('span');
      etiqueta.className = 'etiqueta';
      if (col.color) {
        const punto = document.createElement('span');
        punto.className = 'punto';
        punto.style.background = col.color;
        etiqueta.appendChild(punto);
      }
      etiqueta.appendChild(document.createTextNode(col.nombre));
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = col.chats.length;
      head.append(etiqueta, n);
      columna.appendChild(head);

      const ul = document.createElement('ul');
      const orden = [...col.chats].sort((a, b) => {
        const ta = new Date(a.fecha || 0).getTime() || 0;
        const tb = new Date(b.fecha || 0).getTime() || 0;
        return ordenAntiguos ? ta - tb : tb - ta;
      });
      for (const ch of orden) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cop-tab-tarjeta';
        const nombre = document.createElement('p');
        nombre.className = 'nombre';
        const nom = document.createElement('span');
        nom.textContent = ch.nombre || ch.telefono || '(sin numero)';
        nombre.appendChild(nom);
        const tel = document.createElement('p');
        tel.className = 'tel';
        tel.textContent = ch.telefono || 'sin numero visible';
        const fe = document.createElement('p');
        fe.className = 'fecha';
        fe.textContent = fmt(ch.fecha);
        btn.append(nombre, tel, fe);
        if (ch.telefono) {
          btn.addEventListener('click', () => {
            window.postMessage({ fuente: 'copiloto-sysfarma-ui', tipo: 'abrir-chat', telefono: ch.telefono }, '*');
            raiz.hidden = true;
          });
        }
        li.appendChild(btn);
        ul.appendChild(li);
      }
      columna.appendChild(ul);
      cont.appendChild(columna);
    }
  }

  // Cola del dia: a quien escribirle hoy y POR QUE (seguimientos del backend).
  function renderHoy() {
    const cont = raiz.querySelector('#cop-tab-cols');
    const estado = raiz.querySelector('#cop-tab-estado');
    cont.textContent = '';
    if (!hoy.length) {
      estado.hidden = false;
      estado.textContent = '✓ Nadie pendiente hoy: la cola esta vacia.';
      return;
    }
    estado.hidden = true;

    const columna = document.createElement('section');
    columna.className = 'cop-tab-col cop-tab-col-ancha';
    const head = document.createElement('header');
    const etiqueta = document.createElement('span');
    etiqueta.className = 'etiqueta';
    etiqueta.textContent = '📆 Escribir hoy';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = hoy.length;
    head.append(etiqueta, n);
    columna.appendChild(head);

    const ul = document.createElement('ul');
    for (const l of hoy) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cop-tab-tarjeta';

      const nombre = document.createElement('p');
      nombre.className = 'nombre';
      const nom = document.createElement('span');
      nom.textContent = l.nombre || l.telefono;
      nombre.appendChild(nom);
      if (l.score != null) {
        const sc = document.createElement('span');
        sc.className = 'score';
        sc.textContent = l.score;
        nombre.appendChild(sc);
      }

      const tel = document.createElement('p');
      tel.className = 'tel';
      tel.textContent = l.telefono + (l.dias != null ? ` · ${l.dias} dia${l.dias === 1 ? '' : 's'} sin contacto` : '');

      const badge = document.createElement('span');
      badge.className = 'badge espera';
      badge.textContent = String(l.motivo || 'seguimiento').replace(/_/g, ' ').toUpperCase();

      btn.append(nombre, tel, badge);
      if (l.ultimo_mensaje) {
        const sn = document.createElement('p');
        sn.className = 'snippet';
        sn.textContent = l.ultimo_mensaje;
        btn.appendChild(sn);
      }
      btn.addEventListener('click', () => {
        window.postMessage({ fuente: 'copiloto-sysfarma-ui', tipo: 'abrir-chat', telefono: l.telefono }, '*');
        raiz.hidden = true;
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }
    columna.appendChild(ul);
    cont.appendChild(columna);
  }

  function render() {
    if (modo === 'hoy') return renderHoy();
    if (modo === 'wa') return renderWa();
    const cont = raiz.querySelector('#cop-tab-cols');
    const estado = raiz.querySelector('#cop-tab-estado');
    cont.textContent = '';
    let pintadas = 0;

    for (const et of ETAPAS_TABLERO) {
      if (!visibles.has(et)) continue;
      const col = leads
        .filter((l) => analisis(l.notas)?.[1] === et)
        .sort((a, b) => {
          const ta = new Date(a.ultimo_contacto || 0).getTime() || 0;
          const tb = new Date(b.ultimo_contacto || 0).getTime() || 0;
          return ordenAntiguos ? ta - tb : tb - ta;
        });
      if (!col.length) continue;
      pintadas += 1;

      const columna = document.createElement('section');
      columna.className = 'cop-tab-col';
      const head = document.createElement('header');
      const etiqueta = document.createElement('span');
      etiqueta.className = 'etiqueta';
      etiqueta.textContent = ETAPAS[et];
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = col.length;
      head.append(etiqueta, n);
      columna.appendChild(head);

      const ul = document.createElement('ul');
      for (const l of col) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cop-tab-tarjeta';

        const nombre = document.createElement('p');
        nombre.className = 'nombre';
        const nom = document.createElement('span');
        nom.textContent = l.nombre || l.telefono;
        nombre.appendChild(nom);
        if (l.score != null) {
          const sc = document.createElement('span');
          sc.className = 'score';
          sc.textContent = l.score;
          nombre.appendChild(sc);
        }

        const tel = document.createElement('p');
        tel.className = 'tel';
        tel.textContent = l.telefono + (l.ciudad ? ` · ${l.ciudad}` : '');

        const badge = document.createElement('span');
        const espera = l.ultima_direccion === 'in';
        badge.className = 'badge' + (espera ? ' espera' : '');
        badge.textContent = espera ? 'TE ESPERA' : 'ESPERANDO RESPUESTA';

        btn.append(nombre, tel, badge);
        if (l.ultimo_mensaje) {
          const sn = document.createElement('p');
          sn.className = 'snippet';
          sn.textContent = l.ultimo_mensaje;
          btn.appendChild(sn);
        }
        const fe = document.createElement('p');
        fe.className = 'fecha';
        fe.textContent = fmt(l.ultimo_contacto);
        btn.appendChild(fe);

        // Abre el chat aqui mismo (inject.js -> WPP.chat.openChatBottom) y cierra.
        btn.addEventListener('click', () => {
          window.postMessage({ fuente: 'copiloto-sysfarma-ui', tipo: 'abrir-chat', telefono: l.telefono }, '*');
          raiz.hidden = true;
        });
        li.appendChild(btn);
        ul.appendChild(li);
      }
      columna.appendChild(ul);
      cont.appendChild(columna);
    }

    estado.hidden = pintadas > 0;
    if (!pintadas) estado.textContent = leads.length ? 'Nada en las etapas activas.' : 'Sin posibles con etapa todavia.';
  }

  window.__copTablero = {
    toggle() {
      montar();
      raiz.hidden = !raiz.hidden;
      if (!raiz.hidden) cargar();
    },
  };
})();
