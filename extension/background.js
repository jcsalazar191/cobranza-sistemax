// Service worker: unico punto que habla con el backend (los content scripts no
// pueden por CORS). La sesion es la cookie normal de cobranza: al hacer login
// desde la extension, fetch con credentials la guarda en el navegador.

const BASE_DEFECTO = 'https://cobranza.sysfarma.pe/api';

async function baseApi() {
  const { apiBase } = await chrome.storage.sync.get('apiBase');
  return (apiBase || BASE_DEFECTO).replace(/\/$/, '');
}

async function llamarApi({ method = 'GET', path, body }) {
  const base = await baseApi();
  try {
    const resp = await fetch(base + path, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await resp.json(); } catch { /* respuesta sin cuerpo */ }
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'Sin conexion con el backend: ' + (e?.message || e) } };
  }
}

// El tablero vive DENTRO de WhatsApp Web (overlay). El icono de la extension
// enfoca (o abre) la pestaña de WA y le pide al content script mostrarlo.
async function abrirTablero() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.sendMessage(tab.id, { tipo: 'abrir-tablero' }).catch(() => {});
    return;
  }
  chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
}

// Desde el tablero: enfoca (o abre) la pestaña de WhatsApp Web y le pide al
// content script abrir el chat de ese numero.
async function abrirChatEnWhatsApp(telefono) {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.sendMessage(tab.id, { tipo: 'abrir-chat', telefono }).catch(() => {});
    return { ok: true };
  }
  await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
  return { ok: true, nota: 'WhatsApp Web recien abierto: vuelve a dar clic cuando cargue.' };
}

chrome.action.onClicked.addListener(abrirTablero);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.tipo === 'api') { llamarApi(msg).then(sendResponse); return true; }
  if (msg?.tipo === 'abrir-tablero') { abrirTablero(); sendResponse({ ok: true }); return; }
  if (msg?.tipo === 'abrir-chat') { abrirChatEnWhatsApp(String(msg.telefono || '')).then(sendResponse); return true; }
});
