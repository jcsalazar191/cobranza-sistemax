import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { IconWhatsapp, IconMoreVertical } from './Icons.jsx';

const ESTADOS = [
  { v: 'nuevo', label: 'Nuevo', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  { v: 'contactado', label: 'Contactado', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { v: 'atendido', label: 'Atendido', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { v: 'convertido', label: 'Convertido', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  { v: 'descartado', label: 'Descartado', cls: 'bg-slate-600/20 text-slate-400 border-slate-600/40' },
];
const ETAPAS_TABLERO = ['por_pagar', 'negociando', 'cotizado', 'demo', 'por_confirmar', 'info_enviada', 'primer_contacto', 'frio'];

// De las notas del analisis IA ("[etapa/temperatura] resumen -> paso") saca un
// badge con la etapa, para ver de un vistazo en que punto esta cada posible.
const ETAPAS = {
  por_pagar: { label: '💰 Por pagar', cls: 'bg-green-500/20 text-green-300 border-green-500/40' },
  negociando: { label: '🤝 Negociando', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  cotizado: { label: '💵 Cotizado', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  demo: { label: '🖥️ Demo', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  por_confirmar: { label: '⏳ Por confirmar', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  info_enviada: { label: '📤 Info enviada', cls: 'bg-slate-600/25 text-slate-300 border-slate-600/40' },
  primer_contacto: { label: '👋 Primer contacto', cls: 'bg-slate-600/25 text-slate-300 border-slate-600/40' },
  cerrado: { label: '✅ Cerrado', cls: 'bg-green-600/25 text-green-200 border-green-500/40' },
  frio: { label: '❄️ Frio', cls: 'bg-slate-700/30 text-slate-400 border-slate-700/50' },
  descartado: { label: '✖ Descartado', cls: 'bg-slate-700/30 text-slate-500 border-slate-700/50' },
};
function analisis(notas) {
  const m = /^\[([a-z_]+)\/(\w+)\]\s*(.*)$/i.exec(String(notas || ''));
  if (!m) return null;
  return { etapa: ETAPAS[m[1]] || null, raw: m[1], temp: m[2], texto: m[3] };
}


// URL del archivo guardado (foto/PDF/audio). El backend lo sirve autenticado.
const BASE_API = import.meta.env.VITE_API_URL || 'http://localhost:3100/api';
const urlMedia = (archivo) => `${BASE_API}/leads/media/${archivo}`;

function mediaKind(m) {
  if (m.tipo === 'imagen' || m.tipo === 'audio' || m.tipo === 'video' || m.tipo === 'pdf' || m.tipo === 'archivo') return m.tipo;
  const mime = String(m.media_mime || '').toLowerCase();
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return m.media_archivo ? 'archivo' : null;
}

// Tarjeta de adjunto inspirada en Open BSP UI. El texto descriptivo queda
// separado del archivo para que no parezca que una imagen/audio es solo texto.
function MediaAttachment({ message }) {
  const [fallo, setFallo] = useState(false);
  const kind = mediaKind(message);
  if (!kind) return null;
  if (!message.media_archivo) {
    return <div className="mb-1 rounded-lg bg-black/10 px-3 py-2 text-xs text-slate-400">Archivo multimedia pendiente de procesar.</div>;
  }
  const url = urlMedia(message.media_archivo);
  if (fallo) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="mb-1 block rounded-lg bg-black/10 px-3 py-2 text-xs text-amber-200 underline">
        No se pudo cargar el archivo. Reintentar
      </a>
    );
  }
  if (kind === 'imagen') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mb-1 block overflow-hidden rounded-lg bg-black/10">
        <img src={url} alt={message.media_nombre || 'Imagen recibida'} loading="lazy"
          onError={() => setFallo(true)} className="max-h-72 w-full object-contain" />
      </a>
    );
  }
  if (kind === 'audio') {
    return <audio controls preload="metadata" src={url} onError={() => setFallo(true)} className="mb-1 h-10 w-full min-w-[230px]" />;
  }
  if (kind === 'video') {
    return <video controls preload="metadata" src={url} onError={() => setFallo(true)} className="mb-1 max-h-72 w-full rounded-lg bg-black object-contain" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onError={() => setFallo(true)}
      className="mb-1 flex min-w-[220px] items-center gap-3 rounded-lg bg-black/10 px-3 py-3 hover:bg-black/20">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-500/20 text-xs font-bold text-red-200">{kind === 'pdf' ? 'PDF' : 'FILE'}</span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{message.media_nombre || (kind === 'pdf' ? 'Documento PDF' : 'Documento')}</span>
        <span className="block text-[11px] text-slate-400">{kind === 'pdf' ? 'Abrir PDF' : 'Abrir o descargar'}</span>
      </span>
    </a>
  );
}

const estadoInfo = (v) => ESTADOS.find((e) => e.v === v) || ESTADOS[0];

// Foto de perfil de WhatsApp (como en la app real) con iniciales de respaldo
// si no hay foto o la URL ya no carga (las de WhatsApp a veces rotan/vencen).
function Avatar({ url, nombre, size = 44 }) {
  const [fallo, setFallo] = useState(false);
  const inicial = (nombre || '#').trim().charAt(0).toUpperCase();
  if (!url || fallo) {
    return (
      <div style={{ width: size, height: size }}
        className="shrink-0 rounded-full bg-slate-700 text-slate-300 grid place-items-center font-semibold">
        {inicial}
      </div>
    );
  }
  return (
    <img src={url} alt="" onError={() => setFallo(true)} style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover bg-slate-700" />
  );
}

function fmt(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  // Siempre 12 horas (5:30 p. m.), no 24 horas -- explicito para no depender del locale.
  return d.toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function estadoConversacion(lead) {
  if (lead.ultima_direccion === 'in') {
    return { texto: 'TE ESPERA', clase: 'text-amber-300 bg-amber-400/10 border-amber-400/30' };
  }
  if (lead.ultima_direccion === 'out') {
    return { texto: 'ESPERANDO RESPUESTA', clase: 'text-slate-400 bg-slate-800 border-slate-700' };
  }
  return { texto: 'SIN MENSAJES', clase: 'text-slate-500 bg-slate-800 border-slate-700' };
}

export default function PosiblesView() {
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [filtroLista, setFiltroLista] = useState('todos');
  // 'reciente' = tal cual WhatsApp (el que hablo hace menos, primero) para
  // ubicar un chat rapido. 'prioridad' = por valor comercial (a punto de
  // cerrar primero), para priorizar seguimiento.
  const [orden, setOrden] = useState('reciente');
  const [selected, setSelected] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [borrador, setBorrador] = useState('');
  const [contextoIA, setContextoIA] = useState('');
  // id de la ultima sugerencia: al enviar se manda para que el copiloto sepa
  // si Jean la uso tal cual o la corrigio (asi aprende de sus ediciones).
  const [sugerenciaId, setSugerenciaId] = useState(null);
  const [ultimaSugerenciaEnviada, setUltimaSugerenciaEnviada] = useState(null);
  const [guardandoResultado, setGuardandoResultado] = useState(false);
  const [cargandoConv, setCargandoConv] = useState(false);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviandoCotizacion, setEnviandoCotizacion] = useState(false);
  const [error, setError] = useState('');
  const [wa, setWa] = useState({ conectado: null, estado: '' });
  const [qr, setQr] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  // vista: lista completa | cola de hoy | tablero por etapa
  const [tab, setTab] = useState('lista');
  const [etapasVisibles, setEtapasVisibles] = useState(ETAPAS_TABLERO);
  const [ordenTablero, setOrdenTablero] = useState('antiguos');
  const [seguimientos, setSeguimientos] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [verPlantillas, setVerPlantillas] = useState(false);
  const [citas, setCitas] = useState([]);
  const [numeroAvisos, setNumeroAvisos] = useState('');
  const [embudo, setEmbudo] = useState(null);
  const [aprendizaje, setAprendizaje] = useState(null);
  const threadRef = useRef(null);
  const searchTimer = useRef(null);

  async function cargarLeads() {
    try { setLeads(await api.listarLeads({ search, orden })); } catch (e) { setError(e.message); }
  }
  const [todos, setTodos] = useState([]);
  const todosVisibles = todos.filter((l) => {
    if (filtroLista === 'respondieron') return l.ultima_direccion === 'in';
    if (filtroLista === 'pendientes') return l.ultima_direccion === 'out';
    return true;
  });
  async function cargarTodos() {
    try { setTodos(await api.todosLeads({ search })); } catch (e) { setError(e.message); }
  }
  async function cargarWa() {
    try { setWa(await api.estadoWa()); } catch { /* ignore */ }
  }

  async function cargarSeguimientos() {
    try { setSeguimientos(await api.seguimientos()); } catch { /* ignore */ }
  }
  async function cargarPlantillas() {
    try { setPlantillas(await api.plantillas()); } catch { /* ignore */ }
  }
  async function cargarCitas() {
    try { setCitas(await api.citas()); } catch { /* ignore */ }
  }
  async function cargarConfigAvisos() {
    try { const r = await api.configRecordatorios(); setNumeroAvisos(r.numero || ''); } catch { /* ignore */ }
  }
  async function guardarNumeroAvisos() {
    try { await api.guardarConfigRecordatorios(numeroAvisos); setError('Número guardado.'); }
    catch (e) { setError(e.message); }
  }
  async function enviarCotizacion() {
    if (!selected) return;
    setEnviandoCotizacion(true); setError('');
    try {
      await api.enviarCotizacion(selected.id, 1);
      await abrir(selected);
      setError('Cotización enviada.');
    } catch (e) { setError(e.message); } finally { setEnviandoCotizacion(false); }
  }

  async function cancelarCita(id) {
    try { await api.editarCita(id, { cancelar: true }); await cargarCitas(); } catch (e) { setError(e.message); }
  }

  async function cargarEmbudo() {
    try { setEmbudo(await api.embudo()); } catch { /* ignore */ }
  }
  async function cargarAprendizaje() {
    try { setAprendizaje(await api.estadisticasAprendizaje()); } catch { /* ignore */ }
  }

  useEffect(() => { cargarLeads(); cargarTodos(); cargarWa(); cargarSeguimientos(); cargarPlantillas(); cargarCitas(); cargarConfigAvisos(); cargarEmbudo(); cargarAprendizaje(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Refresca las citas cada 2 min mientras el buzon esta abierto (para ver el aviso ya enviado).
  useEffect(() => { const id = setInterval(cargarCitas, 120000); return () => clearInterval(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { cargarLeads(); cargarTodos(); }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search, orden]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir(lead) {
    setSelected(lead); setBorrador(''); setContextoIA(''); setSugerenciaId(null); setUltimaSugerenciaEnviada(null); setMensajes([]); setCargandoConv(true); setError('');
    try {
      const m = await api.conversacionLead(lead.id);
      setMensajes(m);
      setTimeout(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, 40);
    } catch (e) { setError(e.message); } finally { setCargandoConv(false); }
  }

  async function sugerir() {
    if (!selected) return;
    setSugiriendo(true); setError('');
    try {
      const r = await api.sugerirLead(selected.id, contextoIA);
      setBorrador(r.sugerencia);
      setSugerenciaId(r.sugerencia_id || null);
    }
    catch (e) { setError(e.message); } finally { setSugiriendo(false); }
  }

  async function enviar() {
    if (!selected || !borrador.trim()) return;
    setEnviando(true); setError('');
    try {
      const r = await api.enviarLead(selected.id, borrador.trim(), sugerenciaId);
      const aprendizajeId = r?.aprendizaje?.id || null;
      setBorrador(''); setSugerenciaId(null);
      await abrir(selected);
      if (aprendizajeId) setUltimaSugerenciaEnviada(aprendizajeId);
      await cargarLeads();
      await cargarSeguimientos();
      // Le da un momento a la ficha (memoria) para procesar el mensaje nuevo
      // antes de refrescar citas (por si quedo una fecha agendada).
      setTimeout(cargarCitas, 4000);
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  }

  async function registrarResultado(resultado) {
    if (!selected) return;
    setGuardandoResultado(true); setError('');
    try {
      await api.registrarResultadoAprendizaje(selected.id, resultado, ultimaSugerenciaEnviada);
      setError('Resultado guardado para el aprendizaje.');
      setUltimaSugerenciaEnviada(null);
    } catch (e) { setError(e.message); } finally { setGuardandoResultado(false); }
  }

  async function cambiarEstado(v) {
    if (!selected) return;
    try {
      await api.actualizarLead(selected.id, { estado: v });
      setSelected((s) => ({ ...s, estado: v }));
      setLeads((ls) => ls.map((l) => (l.id === selected.id ? { ...l, estado: v } : l)));
    } catch (e) { setError(e.message); }
  }

  async function conectarWa() {
    setQrOpen(true); setQr(null); setError('');
    try {
      await api.conectarWa(); // crea la instancia + registra el webhook
      const { qr: q } = await api.qrWa();
      setQr(q);
    } catch (e) { setError(e.message); }
  }

  // El QR de WhatsApp rota cada ~30-40s; con el modal abierto lo refrescamos y
  // detectamos la conexion automaticamente (si no, se escanea un codigo ya vencido).
  useEffect(() => {
    if (!qrOpen) return undefined;
    let cancelado = false;
    const tick = async () => {
      try {
        const st = await api.estadoWa();
        if (cancelado) return;
        setWa(st);
        if (st.conectado) { setQrOpen(false); await cargarLeads(); return; }
        const { qr: q } = await api.qrWa();
        if (!cancelado && q) setQr(q);
      } catch { /* reintenta en el siguiente tick */ }
    };
    const id = setInterval(tick, 4000);
    return () => { cancelado = true; clearInterval(id); };
  }, [qrOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const [importandoWa, setImportandoWa] = useState(false);
  async function importarDeWa() {
    setImportandoWa(true); setError('');
    try {
      const { nuevos, actualizados } = await api.importarWa();
      await cargarLeads();
      await cargarTodos();
      setError(`Chats nuevos: ${nuevos}. Nombres actualizados: ${actualizados}.`);
    } catch (e) { setError(e.message); } finally { setImportandoWa(false); }
  }

  const [clasificando, setClasificando] = useState(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  async function clasificar(id, categoria) {
    setClasificando(id); setError('');
    try {
      await api.clasificarLead(id, categoria);
      setTodos((ls) => ls.map((l) => (l.id === id ? { ...l, categoria } : l)));
      setPreview(null);
      if (categoria === 'posible') await cargarLeads();
    } catch (e) { setError(e.message); } finally { setClasificando(null); }
  }

  // Vista previa EN VIVO (sin guardar nada) de un chat "por clasificar", para
  // poder leerlo antes de decidir si es posible o conocido.
  const [preview, setPreview] = useState(null); // {id, telefono, nombre}
  const [previewMensajes, setPreviewMensajes] = useState(null);
  const [previewError, setPreviewError] = useState('');
  async function abrirPreview(lead) {
    setPreview(lead); setPreviewMensajes(null); setPreviewError(''); setPreviewBorrador(''); setMenuAbierto(false); setVerPlantillasPreview(false);
    try { const r = await api.previewLead(lead.id); setPreviewMensajes(r.mensajes); }
    catch (e) { setPreviewError(e.message); }
  }

  // A veces un "por clasificar" resulta ser un cliente actual que necesita
  // respuesta ya -- se puede responder sin clasificar (queda sin_clasificar).
  const [previewBorrador, setPreviewBorrador] = useState('');
  const [previewEnviando, setPreviewEnviando] = useState(false);
  const [previewSugiriendo, setPreviewSugiriendo] = useState(false);
  const [verPlantillasPreview, setVerPlantillasPreview] = useState(false);
  async function enviarPreview() {
    if (!preview || !previewBorrador.trim()) return;
    setPreviewEnviando(true); setPreviewError('');
    try {
      await api.responderPorClasificar(preview.id, previewBorrador.trim());
      setPreviewMensajes((ms) => [...(ms || []), { direccion: 'out', cuerpo: previewBorrador.trim(), fecha: new Date().toISOString() }]);
      setPreviewBorrador('');
    } catch (e) { setPreviewError(e.message); } finally { setPreviewEnviando(false); }
  }
  async function sugerirPreview() {
    if (!preview) return;
    setPreviewSugiriendo(true); setPreviewError('');
    try {
      const r = await api.sugerirPorClasificar(preview.id);
      setPreviewBorrador(r.sugerencia);
    } catch (e) { setPreviewError(e.message); } finally { setPreviewSugiriendo(false); }
  }

  const inputCls = 'w-full h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 text-sm';

  // ---------- Detalle de una conversacion ----------
  if (selected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSelected(null)} className="h-9 px-3 rounded-lg bg-slate-900 border border-slate-700/60 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">← Volver</button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-100 truncate">{selected.nombre || selected.telefono}</p>
            <p className="text-xs text-slate-500 tabular">{selected.telefono}</p>
          </div>
          <select value={selected.estado} onChange={(e) => cambiarEstado(e.target.value)} className="h-9 px-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 cursor-pointer">
            {ESTADOS.map((e) => <option key={e.v} value={e.v}>{e.label}</option>)}
          </select>
        </div>

        {selected.notas && (
          <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 px-4 py-2.5">
            <p className="text-xs text-sky-200">{selected.notas}</p>
          </div>
        )}

        <div ref={threadRef} className="h-[55vh] min-h-[360px] overflow-y-auto rounded-xl bg-[#efeae2] dark:bg-slate-950 border border-slate-700/40 p-3 space-y-2 shadow-inner lg:h-[62vh]">
          {cargandoConv && <p className="text-center text-slate-500 text-sm py-4">Cargando…</p>}
          {!cargandoConv && mensajes.length === 0 && <p className="text-center text-slate-500 text-sm py-4">Sin mensajes guardados todavia.</p>}
          {mensajes.map((m, i) => (
            <div key={i} className={`flex ${m.direccion === 'in' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[86%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm
                ${m.direccion === 'in' ? 'bg-white text-slate-800 rounded-tl-sm' : 'bg-[#d9fdd3] text-slate-800 rounded-tr-sm'}`}>
                <MediaAttachment message={m} />
                {false && false && (m.media_archivo && (m.tipo === 'pdf' || m.tipo === 'archivo')) && (
                  <a href={urlMedia(m.media_archivo)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 mb-1 px-2 py-1.5 rounded-lg bg-black/20 hover:bg-black/30 transition-colors">
                    <span className="text-lg">📄</span>
                    <span className="text-xs underline truncate max-w-[180px]">{m.media_nombre || 'Documento'}</span>
                  </a>
                )}
                {m.media_texto && m.media_archivo && mediaKind(m) !== 'pdf' && (
                  <details className="mt-1 text-xs text-slate-500">
                    <summary className="cursor-pointer select-none">Ver interpretación</summary>
                    <p className="mt-1 whitespace-pre-wrap">{m.media_texto}</p>
                  </details>
                )}
                {(!mediaKind(m) || !m.media_archivo) && m.cuerpo}
                <div className={`text-[10px] mt-1 ${m.direccion === 'in' ? 'text-slate-500' : 'text-emerald-100/70'}`}>{fmt(m.fecha)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {verPlantillas && (
            <div className="rounded-xl bg-slate-800/70 border border-slate-700 p-2 space-y-1 max-h-40 overflow-y-auto">
              {plantillas.length === 0 ? (
                <p className="text-xs text-slate-500 px-2 py-1">Sin respuestas rápidas todavía.</p>
              ) : plantillas.map((pl) => (
                <button key={pl.id} type="button"
                  onClick={() => { setBorrador(pl.texto.replace(/{nombre}/g, selected.nombre || '')); setVerPlantillas(false); }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
                  <span className="text-xs font-semibold text-slate-200">{pl.titulo}</span>
                  <span className="block text-[11px] text-slate-400 truncate">{pl.texto}</span>
                </button>
              ))}
            </div>
          )}
          <details className="rounded-xl bg-slate-900/70 border border-slate-700/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-slate-300">+ Dar contexto a la IA</summary>
            <textarea value={contextoIA} onChange={(e) => setContextoIA(e.target.value)} rows={2}
              placeholder="Ej.: Ya hicimos demo por AnyDesk y llamada de 33 min; falta enviar precio."
              className="mt-2 w-full px-2.5 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 text-xs resize-none" />
            <p className="text-[11px] text-slate-500 mt-1">Se guardará como contexto de este chat.</p>
          </details>
          <textarea
            value={borrador} onChange={(e) => setBorrador(e.target.value)} rows={3}
            placeholder="Escribe tu respuesta o toca 'Sugerir respuesta'…"
            className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 text-sm resize-none"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setVerPlantillas((v) => !v)}
              className="shrink-0 h-11 w-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700 transition-colors cursor-pointer"
              title="Respuestas rápidas">⚡</button>
            <button type="button" onClick={enviarCotizacion} disabled={enviandoCotizacion}
              className="shrink-0 h-11 w-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-60"
              title="Enviar cotización en PDF">{enviandoCotizacion ? '…' : '📄'}</button>
            <button type="button" onClick={sugerir} disabled={sugiriendo}
              className="flex-1 h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm font-medium hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-60">
              {sugiriendo ? 'Pensando…' : '✨ Sugerir respuesta'}
            </button>
            <button type="button" onClick={enviar} disabled={enviando || !borrador.trim()}
              className="flex-1 h-11 rounded-xl bg-emerald-500 text-slate-950 text-sm font-semibold hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
              <IconWhatsapp width={16} height={16} /> {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
          {ultimaSugerenciaEnviada && (
            <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 p-2.5">
              <p className="text-xs text-sky-200 mb-2">¿Qué resultado tuvo esta respuesta? Ayuda a mejorar las próximas sugerencias.</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['respondio', 'Respondió'], ['demo', 'Agendó demo'], ['cotizacion', 'Pidió cotización'],
                  ['negociacion', 'Negoció'], ['pago', 'Pagó'], ['rechazo', 'Rechazó'], ['sin_respuesta', 'Sin respuesta'],
                ].map(([v, label]) => (
                  <button key={v} type="button" disabled={guardandoResultado} onClick={() => registrarResultado(v)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-60 cursor-pointer">
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  // ---------- Lista de posibles ----------
  return (
    <div className="space-y-3">
      {/* Estado de conexion de WhatsApp */}
      {wa.conectado === false && (
        <div className="flex items-center justify-between rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3">
          <p className="text-sm text-amber-200">WhatsApp no conectado. Vincula tu número para responder.</p>
          <button type="button" onClick={conectarWa} className="h-9 px-3 rounded-lg bg-amber-500 text-slate-950 text-sm font-semibold cursor-pointer">Conectar</button>
        </div>
      )}
      {wa.conectado === true && (() => {
        const horas = wa.ultimo_mensaje_recibido ? (Date.now() - new Date(wa.ultimo_mensaje_recibido).getTime()) / 3_600_000 : 0;
        if (horas < 6) return null; // conectado y al dia: no hace falta mostrar nada
        const texto = horas < 48 ? `hace ${Math.round(horas)}h` : `hace ${Math.round(horas / 24)}d`;
        return (
          <p className="text-xs text-amber-400">⚠ último mensaje recibido {texto}. Si no cuadra con tu WhatsApp, puede haber un corte de sincronización.</p>
        );
      })()}

      {/* Vistas: lista completa / cola de hoy / tablero / citas / resumen */}
      <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-700/50 overflow-x-auto">
        {[
          { k: 'lista', l: 'Lista' },
          { k: 'posibles', l: 'Posibles' },
          { k: 'hoy', l: `Hoy${seguimientos.length ? ` (${seguimientos.length})` : ''}` },
          { k: 'tablero', l: 'Tablero' },
          { k: 'citas', l: `Citas${citas.length ? ` (${citas.length})` : ''}` },
          { k: 'resumen', l: 'Resumen' },
        ].map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} aria-pressed={tab === t.k}
            className={`shrink-0 h-9 px-3.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer
              ${tab === t.k ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ---- HOY: a quien escribirle, con el motivo ---- */}
      {tab === 'hoy' && (
        seguimientos.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-8">Nada pendiente por hoy. 👌</p>
        ) : (
          <ul className="space-y-2">
            {seguimientos.map((sg) => (
              <li key={sg.id}>
                <button type="button" onClick={() => abrir(sg)}
                  className="w-full text-left rounded-xl bg-slate-900 border border-slate-700/50 px-4 py-3 hover:bg-slate-800/70 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100 truncate">{sg.nombre || sg.telefono}</span>
                    <span className="shrink-0 text-[11px] font-bold text-emerald-300 tabular">{sg.score ?? '–'}</span>
                  </div>
                  <p className="text-xs text-amber-300 mt-0.5">{sg.motivo_texto} · hace {sg.dias}d</p>
                  {sg.ultimo_mensaje && <p className="text-xs text-slate-400 truncate mt-0.5">{sg.ultimo_mensaje}</p>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {/* ---- TABLERO: leads agrupados por etapa ---- */}
      {tab === 'tablero' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="shrink-0 text-[11px] font-semibold text-slate-500">Mostrar:</span>
            {ETAPAS_TABLERO.map((et) => {
              const activo = etapasVisibles.includes(et);
              return (
                <button key={et} type="button" onClick={() => setEtapasVisibles((actual) => activo ? actual.filter((x) => x !== et) : [...actual, et])}
                  aria-pressed={activo} className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${activo ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>
                  {ETAPAS[et]?.label || et}
                </button>
              );
            })}
          </div>
          <button type="button" title="Cambiar orden" aria-label="Cambiar orden del tablero" onClick={() => setOrdenTablero((actual) => actual === 'antiguos' ? 'recientes' : 'antiguos')}
            className="inline-flex h-8 items-center rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer">
            {ordenTablero === 'antiguos' ? 'Antiguos' : 'Recientes'}
          </button>
          <div className="hidden">
            <label htmlFor="orden-tablero" className="shrink-0 text-[11px] font-semibold text-slate-500">Orden:</label>
            <select id="orden-tablero" value={ordenTablero} onChange={(e) => setOrdenTablero(e.target.value)}
              className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] text-slate-300 cursor-pointer">
              <option value="antiguos">Más antiguos primero</option>
              <option value="recientes">Más recientes primero</option>
            </select>
            <span className="text-[11px] text-slate-600">Al enviar, el contacto pasa al final de la cola.</span>
          </div>
          <div className="flex flex-nowrap gap-4 overflow-x-auto pb-2 snap-x">
          {ETAPAS_TABLERO.filter((et) => etapasVisibles.includes(et)).map((et) => {
            const col = leads.filter((l) => analisis(l.notas)?.raw === et)
              .sort((a, b) => {
                const ta = new Date(a.ultimo_contacto || 0).getTime() || 0;
                const tb = new Date(b.ultimo_contacto || 0).getTime() || 0;
                return ordenTablero === 'antiguos' ? ta - tb : tb - ta;
              });
            if (!col.length) return null;
            return (
              <div key={et} className="shrink-0 w-[min(82vw,280px)] snap-start">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-semibold text-slate-300">{ETAPAS[et]?.label || et}</span>
                  <span className="text-xs text-slate-500">{col.length}</span>
                </div>
                <ul className="space-y-2">
                  {col.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => abrir(l)}
                        className="w-full text-left rounded-lg bg-slate-900 border border-slate-700/50 px-3 py-3 hover:bg-slate-800/70 transition-colors cursor-pointer">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-sm font-medium text-slate-100 truncate">{l.nombre || l.telefono}</span>
                          {l.score != null && <span className="text-[11px] font-bold text-emerald-300 tabular">{l.score}</span>}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{l.telefono}{l.ciudad ? ` · ${l.ciudad}` : ''}</p>
                        {(() => { const estado = estadoConversacion(l); return (
                          <span className={`inline-flex mt-2 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${estado.clase}`}>{estado.texto}</span>
                        ); })()}
                        {l.ultimo_mensaje && <p className="text-[11px] text-slate-500 truncate mt-0.5">{l.ultimo_mensaje}</p>}
                        <p className="text-[10px] text-slate-600 mt-1">{fmt(l.ultimo_contacto)}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!etapasVisibles.length && <p className="py-8 text-sm text-slate-500">Activa al menos una etapa para mostrarla.</p>}
          </div>
        </div>
      )}

      {/* ---- CITAS: proximas demos/reuniones + a que numero llegan los avisos ---- */}
      {tab === 'citas' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-4 py-3">
            <p className="text-xs font-semibold text-slate-300 mb-1.5">⏰ Avisos por WhatsApp a</p>
            <div className="flex gap-2">
              <input value={numeroAvisos} onChange={(e) => setNumeroAvisos(e.target.value)}
                placeholder="Tu número (9 dígitos)" className={inputCls} />
              <button type="button" onClick={guardarNumeroAvisos}
                className="shrink-0 h-10 px-3 rounded-lg bg-emerald-500 text-slate-950 text-sm font-semibold cursor-pointer">
                Guardar
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Cuando quede una demo/reunión agendada con fecha y hora, te avisamos antes de que llegue.
            </p>
          </div>

          {citas.length === 0 ? (
            <p className="text-center text-slate-500 text-sm py-8">Sin citas agendadas por ahora.</p>
          ) : (
            <ul className="space-y-2">
              {citas.map((c) => (
                <li key={c.id} className="rounded-xl bg-slate-900 border border-slate-700/50 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100 truncate">{c.nombre || c.telefono}</span>
                    <span className="shrink-0 text-xs font-bold text-emerald-300 tabular">
                      {new Date(c.fecha_hora).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{c.texto}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-slate-500">
                      {c.recordatorio_enviado_at ? '✅ Aviso enviado' : `Avisa ${c.recordatorio_minutos} min antes`}
                    </span>
                    <button type="button" onClick={() => cancelarCita(c.id)}
                      className="text-[11px] text-red-400 hover:text-red-300 cursor-pointer">Cancelar</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---- RESUMEN: embudo por etapa, sin librerias de graficos ---- */}
      {tab === 'resumen' && (
        embudo ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3 text-center">
                <p className="text-xl font-bold text-slate-100 tabular">{embudo.total}</p>
                <p className="text-[11px] text-slate-500">Total activos</p>
              </div>
              <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3 text-center">
                <p className="text-xl font-bold text-emerald-300 tabular">{embudo.calientes}</p>
                <p className="text-[11px] text-slate-500">Calientes (≥60)</p>
              </div>
              <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3 text-center">
                <p className="text-xl font-bold text-green-400 tabular">{embudo.cerrados}</p>
                <p className="text-[11px] text-slate-500">Cerrados</p>
              </div>
            </div>

            {aprendizaje && (
              <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-300">Aprendizaje del copiloto</p>
                    <p className="text-[11px] text-slate-500">Se alimenta de tus envíos, ediciones y resultados.</p>
                  </div>
                  <span className="text-[11px] text-emerald-300 tabular">{aprendizaje.exitosas || 0} exitosas</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {[
                    ['Generadas', aprendizaje.total],
                    ['Enviadas', aprendizaje.usadas],
                    ['Editadas', aprendizaje.editadas],
                    ['Tal cual', aprendizaje.tal_cual],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-800/70 px-2 py-2 text-center">
                      <p className="text-lg font-bold text-slate-100 tabular">{value || 0}</p>
                      <p className="text-[10px] text-slate-500">{label}</p>
                    </div>
                  ))}
                </div>
                {aprendizaje.por_etapa?.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-400">Rendimiento por etapa</p>
                    {aprendizaje.por_etapa.slice(0, 6).map((e) => (
                      <div key={e.etapa} className="flex items-center justify-between text-[11px] gap-2">
                        <span className="text-slate-300 truncate">{ETAPAS[e.etapa]?.label || e.etapa}</span>
                        <span className="text-slate-500 tabular shrink-0">{e.usadas} enviadas · {e.exitosas} exitosas · {e.editadas} editadas</span>
                      </div>
                    ))}
                  </div>
                )}
                {aprendizaje.por_categoria?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-400">Por tipo de cliente</p>
                    {aprendizaje.por_categoria.map((e) => (
                      <div key={e.categoria} className="flex items-center justify-between text-[11px] gap-2">
                        <span className="text-slate-300 capitalize">{e.categoria.replaceAll('_', ' ')}</span>
                        <span className="text-slate-500 tabular">{e.usadas} enviadas · {e.exitosas} exitosas</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-4 py-3">
              <p className="text-xs font-semibold text-slate-300 mb-3">Por etapa</p>
              <div className="space-y-2">
                {embudo.etapas.map((e) => {
                  const max = Math.max(...embudo.etapas.map((x) => x.n), 1);
                  const pct = Math.round((e.n / max) * 100);
                  const info = ETAPAS[e.etapa];
                  return (
                    <div key={e.etapa}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-slate-300">{info?.label || e.etapa}</span>
                        <span className="text-slate-400 tabular">{e.n} · score {e.score_prom}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-center text-slate-500 text-sm py-8">Cargando…</p>
        )
      )}

      {/* ---- LISTA: TODOS los chats tal cual WhatsApp, sin filtrar nada. Los
           que no son "Posible" abren la vista simple (leer + responder +
           marcar categoria); los "Posible" abren la ficha completa con IA. ---- */}
      {tab === 'lista' && (
      <>
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre o número" className={inputCls} />
        <button type="button" onClick={importarDeWa} disabled={importandoWa}
          className="shrink-0 h-10 px-3 rounded-lg bg-slate-900 border border-slate-700/60 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer disabled:opacity-60">
          {importandoWa ? 'Cargando…' : 'Sincronizar'}
        </button>
       </div>

       <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar chats">
         {[['todos', 'Todos'], ['respondieron', 'Me respondieron'], ['pendientes', 'Falta responder']].map(([valor, label]) => (
           <button key={valor} type="button" onClick={() => setFiltroLista(valor)} aria-pressed={filtroLista === valor}
             className={`shrink-0 h-9 px-3 rounded-full border text-xs font-semibold cursor-pointer ${filtroLista === valor ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}>
             {label}
           </button>
         ))}
       </div>

       {error && <p className="text-sm text-red-400">{error}</p>}

       {todosVisibles.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-8">Nada todavía. Toca "Sincronizar" para traer tus chats de WhatsApp.</p>
      ) : (
        <ul className="space-y-2">
           {todosVisibles.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => (l.categoria === 'posible' ? abrir(l) : abrirPreview(l))}
                className="w-full text-left rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3 hover:bg-slate-800/70 transition-colors cursor-pointer flex gap-3">
                <Avatar url={l.foto_url} nombre={l.nombre || l.telefono} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100 truncate">{l.nombre || l.telefono}</span>
                    {l.ultimo_contacto && <span className="shrink-0 text-[11px] text-slate-500 tabular">{fmt(l.ultimo_contacto)}</span>}
                  </div>
                   {l.ultimo_mensaje && <p className="text-xs text-slate-400 truncate mt-0.5">{l.ultimo_mensaje}</p>}
                   <p className={`text-[11px] font-semibold mt-0.5 ${l.ultima_direccion === 'in' ? 'text-amber-300' : 'text-slate-500'}`}>
                     {l.ultima_direccion === 'in' ? 'Te respondio · falta contestar' : l.ultima_direccion === 'out' ? 'Sin respuesta pendiente' : 'Sin mensajes'}
                   </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 tabular">{l.telefono}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      </>
      )}

      {tab === 'posibles' && (
      <>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre o número" className={inputCls} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {leads.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-8">No hay posibles todavía. Los que te escriban aparecerán aquí, o márcalos desde "Lista".</p>
      ) : (
        <ul className="space-y-2">
          {leads.map((l) => {
            const info = estadoInfo(l.estado);
            return (
              <li key={l.id}>
                <button type="button" onClick={() => abrir(l)} className="w-full text-left rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3 hover:bg-slate-800/70 transition-colors cursor-pointer flex gap-3">
                  <Avatar url={l.foto_url} nombre={l.nombre || l.telefono} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-100 truncate">{l.nombre || l.telefono}</span>
                      <span className="shrink-0 flex items-center gap-1.5">
                        {l.score != null && (
                          <span className={`text-[11px] font-bold tabular ${l.score >= 60 ? 'text-emerald-300' : l.score >= 35 ? 'text-amber-300' : 'text-slate-500'}`}>{l.score}</span>
                        )}
                        {(() => { const a = analisis(l.notas); const b = a?.etapa || info;
                          return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${b.cls}`}>{b.label}</span>; })()}
                      </span>
                    </div>
                    {l.ultima_direccion === 'in' && (
                      <p className="text-[11px] font-semibold text-amber-300 mt-0.5">⏳ Te espera</p>
                    )}
                    {l.ultimo_mensaje && <p className="text-xs text-slate-400 truncate mt-0.5">{l.ultimo_mensaje}</p>}
                    {l.notas && <p className="text-[11px] text-sky-300/80 truncate mt-0.5">{analisis(l.notas)?.texto || l.notas}</p>}
                    <p className="text-[11px] text-slate-500 mt-0.5 tabular">{l.telefono} · {fmt(l.ultimo_contacto)}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </>
      )}

      {qrOpen && (
        <Modal titulo="Conectar WhatsApp" onClose={() => setQrOpen(false)}>
          <p className="text-sm text-slate-400 mb-3">Abre WhatsApp → <strong>Dispositivos vinculados</strong> → Vincular dispositivo, y escanea:</p>
          <div className="grid place-items-center">
            {qr ? (
              <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR" className="w-56 h-56 rounded-lg bg-white p-2" />
            ) : (
              <p className="text-slate-500 text-sm py-10">Generando QR…</p>
            )}
          </div>
        </Modal>
      )}

      {preview && (
        <Modal
          titulo={preview.nombre || preview.telefono}
          onClose={() => setPreview(null)}
          accionesHeader={(
            <div className="relative">
              <button type="button" onClick={() => setMenuAbierto((v) => !v)} aria-label="Más opciones"
                className="grid place-items-center w-11 h-11 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer">
                <IconMoreVertical width={20} height={20} />
              </button>
              {menuAbierto && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuAbierto(false)} />
                  <div className="absolute right-0 top-12 z-20 w-44 rounded-xl bg-slate-800 border border-slate-700 shadow-xl overflow-hidden">
                    <button type="button" disabled={clasificando === preview.id}
                      onClick={() => { setMenuAbierto(false); clasificar(preview.id, 'posible'); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-emerald-300 hover:bg-slate-700 cursor-pointer disabled:opacity-60">✅ Marcar Posible</button>
                    <button type="button" disabled={clasificando === preview.id}
                      onClick={() => { setMenuAbierto(false); clasificar(preview.id, 'conocido'); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 cursor-pointer disabled:opacity-60">🚫 Marcar Conocido</button>
                  </div>
                </>
              )}
            </div>
          )}
          footer={(
            <div className="flex flex-col gap-2 w-full">
              {verPlantillasPreview && (
                <div className="rounded-xl bg-slate-800/70 border border-slate-700 p-2 space-y-1 max-h-40 overflow-y-auto">
                  {plantillas.length === 0 ? (
                    <p className="text-xs text-slate-500 px-2 py-1">Sin respuestas rápidas todavía.</p>
                  ) : plantillas.map((pl) => (
                    <button key={pl.id} type="button"
                      onClick={() => { setPreviewBorrador(pl.texto.replace(/{nombre}/g, preview.nombre || '')); setVerPlantillasPreview(false); }}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
                      <span className="text-xs font-semibold text-slate-200">{pl.titulo}</span>
                      <span className="block text-[11px] text-slate-400 truncate">{pl.texto}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input value={previewBorrador} onChange={(e) => setPreviewBorrador(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') enviarPreview(); }}
                  placeholder="Responder…" className={inputCls} />
                <button type="button" disabled={previewEnviando || !previewBorrador.trim()} onClick={enviarPreview}
                  className="shrink-0 h-10 px-4 rounded-lg bg-emerald-500 text-slate-950 font-semibold text-sm cursor-pointer disabled:opacity-60">Enviar</button>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setVerPlantillasPreview((v) => !v)}
                  className="shrink-0 h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700 transition-colors cursor-pointer"
                  title="Respuestas rápidas">⚡</button>
                <button type="button" onClick={sugerirPreview} disabled={previewSugiriendo}
                  className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-medium hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-60">
                  {previewSugiriendo ? 'Pensando…' : '✨ Sugerir respuesta'}
                </button>
              </div>
            </div>
          )}
        >
          <p className="text-xs text-slate-500 tabular mb-3">{preview.telefono}</p>
          {previewError ? (
            <p className="text-sm text-red-400">{previewError}</p>
          ) : previewMensajes === null ? (
            <p className="text-center text-slate-500 text-sm py-8">Cargando conversación…</p>
          ) : previewMensajes.length === 0 ? (
            <p className="text-center text-slate-500 text-sm py-8">No se pudo traer el historial (puede que WhatsApp haya cambiado de identidad a este contacto). Igual puedes responderle abajo.</p>
          ) : (
            <div className="space-y-2">
              {previewMensajes.map((m, i) => (
                <div key={i} className={`flex ${m.direccion === 'in' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm
                    ${m.direccion === 'in' ? 'bg-slate-800 text-slate-100 rounded-tl-sm' : 'bg-emerald-600/80 text-white rounded-tr-sm'}`}>
                    <MediaAttachment message={m} />
                    {(!mediaKind(m) || !m.media_archivo) && <p className="whitespace-pre-wrap break-words">{m.cuerpo}</p>}
                    {m.media_texto && m.media_archivo && mediaKind(m) !== 'pdf' && <p className="mt-1 text-xs text-slate-400">{m.media_texto}</p>}
                    <div className={`text-[10px] mt-1 ${m.direccion === 'in' ? 'text-slate-500' : 'text-emerald-100/70'}`}>{fmt(m.fecha)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
