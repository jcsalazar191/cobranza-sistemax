const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3100/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // enviar/recibir la cookie de sesion
    ...options,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  me: () => request('/me'),
  login: (email, password) => request('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/logout', { method: 'POST' }),
  resumen: () => request('/clientes/resumen'),
  listarClientes: () => request('/clientes'),
  obtenerCliente: (id) => request(`/clientes/${id}`),
  crearCliente: (data) => request('/clientes', { method: 'POST', body: JSON.stringify(data) }),
  editarCliente: (id, data) => request(`/clientes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  simularCliente: (id, data) => request(`/clientes/${id}?dry=1`, { method: 'PUT', body: JSON.stringify(data) }),
  eliminarCliente: (id) => request(`/clientes/${id}`, { method: 'DELETE' }),
  registrarPago: (data) => request('/pagos', { method: 'POST', body: JSON.stringify(data) }),
  eliminarPago: (id) => request(`/pagos/${id}`, { method: 'DELETE' }),
  registrarRecordatorio: (cliente_id) => request('/recordatorios', { method: 'POST', body: JSON.stringify({ cliente_id }) }),
  chatCobro: (payload) => request('/chat-cobro', { method: 'POST', body: JSON.stringify(payload) }),
  ingresos: (anio) => request(`/ingresos/${anio}`),
  getConfig: () => request('/config'),
  guardarConfig: (data) => request('/config', { method: 'PUT', body: JSON.stringify(data) }),
  verificarPin: (pin) => request('/config/verificar-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
  importRespaldo: (data) => request('/import', { method: 'POST', body: JSON.stringify(data) }),
  importClientes: (filas) => request('/import/clientes', { method: 'POST', body: JSON.stringify({ filas }) }),
  exportUrl: `${BASE}/export`,

  // Posibles (leads) + copiloto de WhatsApp
  listarLeads: ({ search = '', estado = '', orden = 'reciente' } = {}) => request(`/leads?search=${encodeURIComponent(search)}&estado=${encodeURIComponent(estado)}&orden=${encodeURIComponent(orden)}`),
  conversacionLead: (id) => request(`/leads/${id}/conversacion`),
  sugerirLead: (id, contexto = '') => request(`/leads/${id}/sugerir`, { method: 'POST', body: JSON.stringify({ contexto }) }),
  enviarLead: (id, texto, sugerencia_id = null) => request(`/leads/${id}/enviar`, { method: 'POST', body: JSON.stringify({ texto, sugerencia_id }) }),
  registrarResultadoAprendizaje: (id, resultado, sugerencia_id = null, nota = '') => request(`/leads/${id}/aprendizaje-resultado`, { method: 'POST', body: JSON.stringify({ resultado, sugerencia_id, nota }) }),
  estadisticasAprendizaje: () => request('/leads/aprendizaje'),
  actualizarLead: (id, data) => request(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  importarLeads: (texto) => request('/leads/importar', { method: 'POST', body: JSON.stringify({ texto }) }),
  importarWa: () => request('/leads/importar-wa', { method: 'POST' }),
  estadoWa: () => request('/leads/estado-wa'),
  qrWa: () => request('/leads/qr'),
  conectarWa: () => request('/leads/conectar', { method: 'POST' }),
  seguimientos: () => request('/leads/seguimientos'),
  plantillas: () => request('/leads/plantillas'),
  guardarPlantilla: (data) => request('/leads/plantillas', { method: 'POST', body: JSON.stringify(data) }),
  borrarPlantilla: (id) => request(`/leads/plantillas/${id}`, { method: 'DELETE' }),
  embudo: () => request('/leads/embudo'),
  citas: () => request('/leads/citas'),
  editarCita: (id, data) => request(`/leads/citas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  configRecordatorios: () => request('/leads/config-recordatorios'),
  guardarConfigRecordatorios: (numero) => request('/leads/config-recordatorios', { method: 'PUT', body: JSON.stringify({ numero }) }),
  enviarCotizacion: (id, sucursales = 1) => request(`/leads/${id}/cotizacion`, { method: 'POST', body: JSON.stringify({ sucursales }) }),
  todosLeads: ({ search = '' } = {}) => request(`/leads/todos?search=${encodeURIComponent(search)}`),
  previewLead: (id) => request(`/leads/por-clasificar/${id}`),
  responderPorClasificar: (id, texto) => request(`/leads/por-clasificar/${id}/responder`, { method: 'POST', body: JSON.stringify({ texto }) }),
  sugerirPorClasificar: (id) => request(`/leads/por-clasificar/${id}/sugerir`, { method: 'POST' }),
  clasificarLead: (id, categoria) => request(`/leads/${id}/categoria`, { method: 'PATCH', body: JSON.stringify({ categoria }) }),
};
