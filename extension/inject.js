// Corre en el MAIN world de web.whatsapp.com, con wa-js (window.WPP) ya
// cargado por el manifest. Lee el chat activo y sus mensajes usando los
// modulos INTERNOS de WhatsApp (nada de scrapear clases CSS) y se los pasa al
// content script por postMessage. NUNCA envia mensajes solo: el humano decide.
(function () {
  'use strict';
  const FUENTE = 'copiloto-sysfarma';
  let ultimoChat = null;
  let ultimoTotal = 0;

  function listo() {
    return Boolean(window.WPP && (WPP.isReady || WPP.webpack?.isReady));
  }

  // Segun la version del bundle, el loader arranca solo o hay que llamarlo.
  try { if (window.WPP && !listo() && WPP.webpack?.injectLoader) WPP.webpack.injectLoader(); } catch { /* ya estaba */ }

  function telefonoDeChat(chat) {
    const id = chat?.id || {};
    if (id.server === 'c.us' || id.server === 's.whatsapp.net') return String(id.user || '');
    // Chats @lid: el numero real viene en el contacto, si WhatsApp lo expone.
    const alt = chat?.contact?.phoneNumber;
    if (alt?.user) return String(alt.user);
    if (typeof alt === 'string') return alt.replace(/@.*/, '');
    return '';
  }

  function textoDeMensaje(m) {
    const cuerpo = m?.body || m?.caption || '';
    if (cuerpo) return String(cuerpo);
    const tipo = String(m?.type || '');
    // Las llamadas importan para la IA: "llamada hecha" = la demo/coordinacion
    // ya paso (el prompt del backend lo interpreta asi).
    if (/call/i.test(tipo)) return `Llamada ${(m?.fromMe ?? m?.id?.fromMe) ? 'saliente' : 'entrante'}`;
    return tipo && tipo !== 'chat' ? `[${tipo}]` : '';
  }

  // Diagnostico: le cuenta al panel si wa-js llego a iniciar (si WhatsApp
  // cambia por dentro, esto es lo primero que se rompe y hay que verlo claro).
  let ultimoEstado = null;
  function avisarEstado() {
    const ok = listo();
    const definido = Boolean(window.WPP);
    const clave = `${definido}:${ok}`;
    if (clave === ultimoEstado) return;
    ultimoEstado = clave;
    window.postMessage({ fuente: FUENTE, tipo: 'wajs', definido, ok }, '*');
  }

  async function reportarChatActivo() {
    try {
      if (!listo()) {
        // Algunas builds de wa-js necesitan que el loader se lance cuando el
        // webpack de WhatsApp ya arranco; reintentar es idempotente.
        try { WPP?.webpack?.injectLoader?.(); } catch { /* ya estaba */ }
        avisarEstado();
        return;
      }
      avisarEstado();
      const chat = WPP.chat.getActiveChat();
      const id = chat?.id?._serialized || null;
      const total = chat?.msgs?.length || 0;
      // Reenvia si cambio el chat O llegaron mensajes nuevos al mismo chat.
      if (id === ultimoChat && total === ultimoTotal) return;
      ultimoChat = id;
      ultimoTotal = total;

      if (!chat || chat.isGroup) {
        window.postMessage({ fuente: FUENTE, tipo: 'chat', chat: null }, '*');
        return;
      }
      const registros = await WPP.chat.getMessages(chat.id, { count: 60 });
      const mensajes = (registros || [])
        .map((m) => ({
          direccion: (m.fromMe ?? m.id?.fromMe) ? 'out' : 'in',
          cuerpo: textoDeMensaje(m),
          fecha: m.t ? new Date(m.t * 1000).toISOString() : null,
        }))
        .filter((m) => m.cuerpo);

      // Etiquetas: las del chat + el catalogo completo, para que el panel
      // permita ponerlas/quitarlas (organiza el tablero sin salir del chat).
      let catalogo = null;
      try {
        if (WPP.labels?.getAllLabels) {
          catalogo = (await Promise.resolve(WPP.labels.getAllLabels()))
            .map((lb) => ({ id: String(lb.id), nombre: lb.name || String(lb.id), color: lb.hexColor || lb.color || null }));
        }
      } catch { /* sin etiquetas */ }

      window.postMessage({
        fuente: FUENTE,
        tipo: 'chat',
        chat: {
          telefono: telefonoDeChat(chat),
          nombre: chat?.contact?.name || chat?.contact?.pushname || chat?.name || '',
          mensajes,
          etiquetas: (chat.labels || []).map(String),
          catalogo,
        },
      }, '*');
    } catch { /* siguiente tick */ }
  }

  // ponytail: sondeo cada 1.5s; el evento chat.active_chat cambia entre
  // versiones de wa-js y el poll es identico en resultado para un solo usuario.
  setInterval(reportarChatActivo, 1500);

  // Etiquetas de WhatsApp Business: columnas = tus etiquetas reales, con los
  // chats que las llevan. columnas=null cuando este WhatsApp no las expone.
  async function reportarEtiquetas() {
    try {
      if (!listo()) return;
      let columnas = null;
      if (WPP.labels?.getAllLabels) {
        const labels = await Promise.resolve(WPP.labels.getAllLabels());
        const chats = await Promise.resolve(WPP.chat.list());
        columnas = (labels || []).map((lb) => ({
          id: String(lb.id),
          nombre: lb.name || String(lb.id),
          color: lb.hexColor || lb.color || null,
          chats: [],
        }));
        const porId = new Map(columnas.map((c) => [c.id, c]));
        for (const ch of chats || []) {
          if (!ch || ch.isGroup) continue;
          const ids = (ch.labels || []).map(String);
          if (!ids.length) continue;
          const item = {
            telefono: telefonoDeChat(ch),
            nombre: ch?.contact?.name || ch?.contact?.pushname || ch?.name || ch?.formattedTitle || '',
            fecha: ch.t ? new Date(ch.t * 1000).toISOString() : null,
          };
          for (const id of ids) porId.get(id)?.chats.push(item);
        }
        columnas = columnas.filter((c) => c.chats.length);
      }
      window.postMessage({ fuente: FUENTE, tipo: 'etiquetas', columnas }, '*');
    } catch (e) {
      window.postMessage({ fuente: FUENTE, tipo: 'etiquetas', columnas: null, error: String(e?.message || e) }, '*');
    }
  }

  // Ordenes desde el content script (panel / tablero).
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (ev.source !== window || d?.fuente !== FUENTE + '-ui') return;
    if (d.tipo === 'abrir-chat' && d.telefono && listo()) {
      WPP.chat.openChatBottom(`${d.telefono}@c.us`).catch(() => {});
    }
    if (d.tipo === 'listar-etiquetas') reportarEtiquetas();
    if (d.tipo === 'etiqueta' && d.labelId && listo()) {
      const activo = WPP.chat.getActiveChat();
      const id = activo?.id?._serialized;
      if (id && telefonoDeChat(activo) === String(d.telefono || '')) {
        Promise.resolve(WPP.labels.addOrRemoveLabels([id], [{ labelId: String(d.labelId), type: d.accion === 'remove' ? 'remove' : 'add' }]))
          .then(() => { ultimoChat = null; ultimoTotal = -1; reportarChatActivo(); })
          .catch(() => {});
      }
    }
    if (d.tipo === 'refrescar') { ultimoChat = null; ultimoTotal = -1; reportarChatActivo(); }
  });
})();
