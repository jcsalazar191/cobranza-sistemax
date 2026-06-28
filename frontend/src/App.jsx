import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';
import Resumen from './components/Resumen.jsx';
import Filtros from './components/Filtros.jsx';
import ClienteCard from './components/ClienteCard.jsx';
import PagoModal from './components/PagoModal.jsx';
import ClienteFormModal from './components/ClienteFormModal.jsx';
import IngresosView from './components/IngresosView.jsx';
import ConfigModal from './components/ConfigModal.jsx';
import DatosModal from './components/DatosModal.jsx';
import Login from './components/Login.jsx';
import { IconPlus, IconDownload, IconChat, IconDatabase, IconLogout } from './components/Icons.jsx';
import { PLANTILLA_DEFAULT, PLANTILLA_ALDIA_DEFAULT, normaliza } from './lib/ui.js';

function pasaFiltro(c, filtro) {
  switch (filtro) {
    case 'morosos':   return c.activo && c.meses_debe >= 1;
    case 'criticos':  return c.activo && c.estado === 3;
    case 'porvencer': return c.activo && c.deuda === 0 && c.meses_cobertura === 0;
    case 'aldia':     return c.activo && c.estado === 0;
    case 'inactivos': return !c.activo;
    default:          return c.activo; // "Todos" = solo activos; los de baja viven en Inactivos
  }
}

export default function App() {
  const [auth, setAuth] = useState(null); // null=verificando, false=sin sesion, true=con sesion
  const [clientes, setClientes] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');

  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [vista, setVista] = useState('clientes'); // 'clientes' | 'ingresos'

  const [pagoDe, setPagoDe] = useState(null);     // cliente para modal de pago
  const [formCliente, setFormCliente] = useState(undefined); // undefined=cerrado, null=nuevo, obj=editar
  const [mensajeTemplate, setMensajeTemplate] = useState(PLANTILLA_DEFAULT);
  const [mensajeAldia, setMensajeAldia] = useState(PLANTILLA_ALDIA_DEFAULT);
  const [configOpen, setConfigOpen] = useState(false);
  const [datosOpen, setDatosOpen] = useState(false);
  const [formKey, setFormKey] = useState(0); // fuerza remount del form al refrescar en sitio

  const cargar = useCallback(async () => {
    try {
      setErrorCarga('');
      const [lista, res, cfg] = await Promise.all([
        api.listarClientes(),
        api.resumen(),
        api.getConfig().catch(() => null),
      ]);
      setClientes(lista);
      setResumen(res);
      if (cfg?.mensaje_template) setMensajeTemplate(cfg.mensaje_template);
      if (cfg?.mensaje_aldia) setMensajeAldia(cfg.mensaje_aldia);
    } catch (err) {
      setErrorCarga(err.message);
    } finally {
      setCargando(false);
    }
  }, []);

  // Verifica sesion al inicio.
  useEffect(() => {
    api.me().then(() => setAuth(true)).catch(() => setAuth(false));
  }, []);

  // Carga datos solo cuando hay sesion.
  useEffect(() => { if (auth) cargar(); }, [cargar, auth]);

  async function salir() {
    try { await api.logout(); } catch { /* ignore */ }
    setAuth(false);
  }

  const conteos = useMemo(() => ({
    todos: clientes.filter((c) => c.activo).length,
    morosos: clientes.filter((c) => pasaFiltro(c, 'morosos')).length,
    criticos: clientes.filter((c) => pasaFiltro(c, 'criticos')).length,
    porvencer: clientes.filter((c) => pasaFiltro(c, 'porvencer')).length,
    aldia: clientes.filter((c) => pasaFiltro(c, 'aldia')).length,
    inactivos: clientes.filter((c) => pasaFiltro(c, 'inactivos')).length,
  }), [clientes]);

  const visibles = useMemo(() => {
    const q = normaliza(busqueda.trim());
    return clientes
      .filter((c) => pasaFiltro(c, filtro))
      .filter((c) => !q || normaliza(c.nombre).includes(q));
    // El backend ya entrega ordenado por deuda desc.
  }, [clientes, filtro, busqueda]);

  // --- Acciones ---
  async function abrirEditar(cliente) {
    try {
      const detalle = await api.obtenerCliente(cliente.id); // trae pagos
      setFormCliente(detalle);
    } catch (err) {
      alert(err.message);
    }
  }

  async function guardarPago(data) {
    await api.registrarPago(data);
    setPagoDe(null);
    await cargar();
  }

  async function guardarCliente(data, id) {
    if (id) await api.editarCliente(id, data);
    else await api.crearCliente(data);
    setFormCliente(undefined);
    await cargar();
  }

  async function guardarConfig(template, aldia) {
    const r = await api.guardarConfig({ mensaje_template: template, mensaje_aldia: aldia });
    setMensajeTemplate(r.mensaje_template);
    setMensajeAldia(r.mensaje_aldia);
    setConfigOpen(false);
  }

  async function eliminarCliente(cliente) {
    if (!confirm(`Eliminar a "${cliente.nombre}"? Solo se permite porque no tiene pagos. Esta accion no se puede deshacer.`)) return;
    try {
      await api.eliminarCliente(cliente.id);
      setFormCliente(undefined);
      await cargar();
    } catch (err) {
      alert(err.message);
    }
  }

  // Anular un pago: revierte pagado_hasta y refresca el detalle del cliente abierto.
  async function anularPago(cliente, pago) {
    if (!confirm(`Anular el pago de ${pago.meses} mes(es)? Se retrocede "pagado hasta" esos meses.`)) return;
    try {
      await api.eliminarPago(pago.id);
      const detalle = await api.obtenerCliente(cliente.id);
      setFormCliente(detalle);
      setFormKey((k) => k + 1); // re-inicializa el form con los datos revertidos
      await cargar();
    } catch (err) {
      alert(err.message);
    }
  }

  // Registra el aviso (al tocar Recordar) sin bloquear la apertura de WhatsApp.
  function registrarRecordatorio(cliente) {
    api.registrarRecordatorio(cliente.id).then(() => cargar()).catch(() => {});
  }

  if (auth === null) {
    return <div className="min-h-dvh grid place-items-center text-slate-500">Cargando...</div>;
  }
  if (auth === false) {
    return <Login onLogin={() => setAuth(true)} />;
  }

  return (
    <div className="min-h-dvh max-w-2xl mx-auto px-4 pb-28">
      <header className="pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Cobranzas</h1>
          <p className="text-xs text-slate-500">Mi Negocio</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-slate-900 border border-slate-700/60 text-sm text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Personalizar mensaje de recordatorio"
          >
            <IconChat width={18} height={18} /> Mensaje
          </button>
          <button
            type="button"
            onClick={() => setDatosOpen(true)}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-slate-900 border border-slate-700/60 text-sm text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Respaldo, restaurar e importar"
          >
            <IconDatabase width={18} height={18} /> Datos
          </button>
          <button
            type="button"
            onClick={salir}
            aria-label="Cerrar sesion"
            title="Cerrar sesion"
            className="grid place-items-center w-10 h-10 rounded-xl bg-slate-900 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconLogout width={18} height={18} />
          </button>
        </div>
      </header>

      <div className="space-y-5">
        <Resumen resumen={resumen} />

        {/* Conmutador de vista */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-900 border border-slate-700/50">
          {[
            { key: 'clientes', label: 'Clientes' },
            { key: 'ingresos', label: 'Ingresos por mes' },
          ].map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setVista(v.key)}
              aria-pressed={vista === v.key}
              className={`h-10 rounded-lg text-sm font-semibold transition-colors cursor-pointer
                ${vista === v.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {errorCarga && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 text-sm">
            No se pudo cargar: {errorCarga}. Revisa que el API este corriendo en el puerto 3100.
          </div>
        )}

        {vista === 'ingresos' ? (
          <IngresosView />
        ) : (
          <>
            <Filtros
              busqueda={busqueda} onBusqueda={setBusqueda}
              filtro={filtro} onFiltro={setFiltro}
              conteos={conteos}
            />

            {cargando ? (
              <div className="space-y-3" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-32 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse" />
                ))}
              </div>
            ) : visibles.length === 0 ? (
              <p className="text-center text-slate-500 py-12">Sin clientes para este filtro.</p>
            ) : (
              <ul className="space-y-3">
                {visibles.map((c) => (
                  <li key={c.id}>
                    <ClienteCard cliente={c} onAbrir={abrirEditar} onPago={setPagoDe} onRecordar={registrarRecordatorio} plantillaDeuda={mensajeTemplate} plantillaAldia={mensajeAldia} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* FAB nuevo cliente (solo en vista Clientes) */}
      {vista === 'clientes' && (
        <button
          type="button"
          onClick={() => setFormCliente(null)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 h-14 px-6 rounded-full bg-emerald-500 text-slate-950 font-semibold shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition-colors cursor-pointer"
        >
          <IconPlus /> Nuevo cliente
        </button>
      )}

      {configOpen && (
        <ConfigModal
          plantillaDeuda={mensajeTemplate}
          plantillaAldia={mensajeAldia}
          onClose={() => setConfigOpen(false)}
          onGuardar={guardarConfig}
        />
      )}
      {pagoDe && (
        <PagoModal cliente={pagoDe} onClose={() => setPagoDe(null)} onGuardar={guardarPago} />
      )}
      {formCliente !== undefined && (
        <ClienteFormModal
          key={formKey}
          cliente={formCliente}
          onClose={() => setFormCliente(undefined)}
          onGuardar={guardarCliente}
          onEliminar={eliminarCliente}
          onAnularPago={anularPago}
        />
      )}
      {datosOpen && (
        <DatosModal
          onClose={() => setDatosOpen(false)}
          exportUrl={api.exportUrl}
          onImportRespaldo={api.importRespaldo}
          onImportClientes={api.importClientes}
          onTerminado={cargar}
        />
      )}
    </div>
  );
}
