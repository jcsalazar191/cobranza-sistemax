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
  eliminarCliente: (id) => request(`/clientes/${id}`, { method: 'DELETE' }),
  registrarPago: (data) => request('/pagos', { method: 'POST', body: JSON.stringify(data) }),
  eliminarPago: (id) => request(`/pagos/${id}`, { method: 'DELETE' }),
  registrarRecordatorio: (cliente_id) => request('/recordatorios', { method: 'POST', body: JSON.stringify({ cliente_id }) }),
  ingresos: (anio) => request(`/ingresos/${anio}`),
  getConfig: () => request('/config'),
  guardarConfig: (data) => request('/config', { method: 'PUT', body: JSON.stringify(data) }),
  importRespaldo: (data) => request('/import', { method: 'POST', body: JSON.stringify(data) }),
  importClientes: (filas) => request('/import/clientes', { method: 'POST', body: JSON.stringify({ filas }) }),
  exportUrl: `${BASE}/export`,
};
