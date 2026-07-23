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
import CobrarPicker from './components/CobrarPicker.jsx';
import ChatCobro from './components/ChatCobro.jsx';
import PerfilModal from './components/PerfilModal.jsx';
import PinLock from './components/PinLock.jsx';
import Login from './components/Login.jsx';
import { IconPlus, IconChat, IconDatabase, IconLogout, IconCash, IconMic, IconUser } from './components/Icons.jsx';
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
  const [pagoInicial, setPagoInicial] = useState(null); // valores pre-llenados (desde chat)
  const [cobrarOpen, setCobrarOpen] = useState(false);  // selector de cliente para cobrar
  const [chatOpen, setChatOpen] = useState(false);      // chat de voz/texto
  const [formCliente, setFormCliente] = useState(undefined); // undefined=cerrado, null=nuevo, obj=editar
  const [mensajeTemplate, setMensajeTemplate] = useState(PLANTILLA_DEFAULT);
  const [mensajeAldia, setMensajeAldia] = useState(PLANTILLA_ALDIA_DEFAULT);
  const [geminiConfigurado, setGeminiConfigurado] = useState(false);
  const [nvidiaConfigurado, setNvidiaConfigurado] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [datosOpen, setDatosOpen] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [pinActivo, setPinActivo] = useState(null); // null=desconocido hasta cargar config
  const [diaGracia, setDiaGracia] = useState(10);   // dia de plazo de pago (configurable)
  const [desbloqueado, setDesbloqueado] = useState(() => sessionStorage.getItem('pin_ok') === '1');
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
      setGeminiConfigurado(Boolean(cfg?.gemini_configurado));
      setNvidiaConfigurado(Boolean(cfg?.nvidia_configurado));
      setPinActivo(Boolean(cfg?.pin_activo));
      if (cfg?.dia_gracia) setDiaGracia(Number(cfg.dia_gracia));
    } catch (err) {
      setErrorCarga(err.message);
    } finally {
      setCargando(false);
    }
  }, []);

  // Verifica sesion al inicio.
  useEffect(() => {
    api.me().then((r) => { setEmail(r?.email || ''); setAuth(true); }).catch(() => setAuth(false));
  }, []);

  // Carga datos solo cuando hay sesion.
  useEffect(() => { if (auth) cargar(); }, [cargar, auth]);

  async function salir() {
    try { await api.logout(); } catch { /* ignore */ }
    sessionStorage.removeItem('pin_ok');
    setDesbloqueado(false);
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

  // Abre el formulario de NUEVO cliente pre-llenado (desde el chat). Sin id -> crea.
  function abrirNuevoPrefill(prefill) {
    const hoy = new Date();
    const ph = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    setFormCliente({
      nombre: prefill?.nombre || '',
      whatsapp: prefill?.whatsapp || '',
      monto: prefill?.monto ?? '',
      periodo: prefill?.periodo || 'MENSUAL',
      dia_cobro: prefill?.dia_cobro || 1,
      pagado_hasta: ph,
      activo: true,
    });
  }

  async function guardarPago(data) {
    await api.registrarPago(data);
    setPagoDe(null);
    setPagoInicial(null);
    await cargar();
  }

  // Abre el modal de pago para un cliente (desde el selector o el chat).
  function cobrarA(cliente, inicial = null) {
    setCobrarOpen(false);
    setChatOpen(false);
    setPagoInicial(inicial);
    setPagoDe(cliente);
  }

  function cerrarPago() {
    setPagoDe(null);
    setPagoInicial(null);
  }

  async function guardarCliente(data, id) {
    if (id) await api.editarCliente(id, data);
    else await api.crearCliente(data);
    setFormCliente(undefined);
    await cargar();
  }

  async function guardarConfig(template, aldia, geminiKey, nvidiaKey) {
    const payload = { mensaje_template: template, mensaje_aldia: aldia };
    if (geminiKey !== undefined) payload.gemini_api_key = geminiKey;
    if (nvidiaKey !== undefined) payload.nvidia_api_key = nvidiaKey;
    const r = await api.guardarConfig(payload);
    setMensajeTemplate(r.mensaje_template);
    setMensajeAldia(r.mensaje_aldia);
    setGeminiConfigurado(Boolean(r.gemini_configurado));
    setNvidiaConfigurado(Boolean(r.nvidia_configurado));
    setConfigOpen(false);
  }

  async function guardarPin(pin) {
    const r = await api.guardarConfig({ pin });
    setPinActivo(Boolean(r.pin_activo));
  }

  async function guardarDiaGracia(n) {
    const r = await api.guardarConfig({ dia_gracia: n });
    if (r?.dia_gracia) setDiaGracia(Number(r.dia_gracia));
    await cargar(); // recalcula deudas con el nuevo plazo
  }

  function desbloquear() {
    sessionStorage.setItem('pin_ok', '1');
    setDesbloqueado(true);
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
    return <Login onLogin={() => { desbloquear(); setAuth(true); }} />;
  }
  // Con sesion valida: si hay PIN configurado, pedirlo antes de mostrar la app.
  if (pinActivo === null) {
    return <div className="min-h-dvh grid place-items-center text-slate-500">Cargando...</div>;
  }
  if (pinActivo && !desbloqueado) {
    return <PinLock onOk={desbloquear} onSalir={salir} />;
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
            aria-label="Mensajes y asistente"
            title="Mensajes de recordatorio y asistente (IA)"
            className="grid place-items-center w-10 h-10 rounded-xl bg-slate-900 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconChat width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={() => setDatosOpen(true)}
            aria-label="Datos"
            title="Respaldo, restaurar e importar"
            className="grid place-items-center w-10 h-10 rounded-xl bg-slate-900 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconDatabase width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={() => setPerfilOpen(true)}
            aria-label="Perfil y PIN"
            title="Perfil (PIN de acceso)"
            className="grid place-items-center w-10 h-10 rounded-xl bg-slate-900 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconUser width={18} height={18} />
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
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setFormCliente(null)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-slate-900 border border-slate-700/60 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors cursor-pointer"
              >
                <IconPlus width={16} height={16} /> Nuevo cliente
              </button>
            </div>

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

      {/* Acciones principales: Cobrar (manda) + chat de voz. Solo en vista Clientes. */}
      {vista === 'clientes' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCobrarOpen(true)}
            className="inline-flex items-center gap-2 h-14 px-7 rounded-full bg-emerald-500 text-slate-950 font-bold text-base shadow-lg shadow-emerald-500/25 hover:bg-emerald-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            <IconCash width={22} height={22} /> Cobrar
          </button>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            aria-label="Cobrar por chat de voz"
            title="Cobrar por voz o texto"
            className="grid place-items-center w-14 h-14 rounded-full bg-slate-800 text-emerald-300 border border-slate-700 shadow-lg hover:bg-slate-700 hover:text-emerald-200 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          >
            <IconMic width={24} height={24} />
          </button>
        </div>
      )}

      {configOpen && (
        <ConfigModal
          plantillaDeuda={mensajeTemplate}
          plantillaAldia={mensajeAldia}
          geminiConfigurado={geminiConfigurado}
          nvidiaConfigurado={nvidiaConfigurado}
          onClose={() => setConfigOpen(false)}
          onGuardar={guardarConfig}
        />
      )}
      {cobrarOpen && (
        <CobrarPicker
          clientes={clientes}
          onElegir={(c) => cobrarA(c)}
          onClose={() => setCobrarOpen(false)}
        />
      )}
      {chatOpen && (
        <ChatCobro
          clientes={clientes}
          geminiConfigurado={geminiConfigurado}
          autoGrabar
          onCambio={cargar}
          onAbrirCliente={(c) => { setChatOpen(false); abrirEditar(c); }}
          onNuevoCliente={(prefill) => { setChatOpen(false); abrirNuevoPrefill(prefill); }}
          onAbrirAjustes={() => { setChatOpen(false); setConfigOpen(true); }}
          onClose={() => setChatOpen(false)}
        />
      )}
      {pagoDe && (
        <PagoModal cliente={pagoDe} inicial={pagoInicial || {}} onClose={cerrarPago} onGuardar={guardarPago} />
      )}
      {formCliente !== undefined && (
        <ClienteFormModal
          key={formKey}
          cliente={formCliente}
          diaCobroDefault={diaGracia}
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
      {perfilOpen && (
        <PerfilModal
          email={email}
          pinActivo={pinActivo}
          diaGracia={diaGracia}
          onGuardarPin={guardarPin}
          onGuardarDiaGracia={guardarDiaGracia}
          onClose={() => setPerfilOpen(false)}
        />
      )}
    </div>
  );
}
