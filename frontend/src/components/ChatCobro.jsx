import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { parseCobro } from '../lib/parseCobro.js';
import { blobToWavBase64 } from '../lib/audioWav.js';
import { soles } from '../lib/ui.js';
import { IconMic, IconSend, IconPlay, IconPause, IconStop, IconPlus, IconChevron } from './Icons.jsx';

const VACIO = { cliente: null, monto: null, meses: null, abono: false, fecha: null, medio: null };

function combina(prev, r) {
  return {
    cliente: r.cliente ?? prev.cliente,
    monto: r.monto ?? prev.monto,
    meses: r.meses != null ? r.meses : prev.meses,
    abono: Boolean(r.abono) || prev.abono,
    fecha: r.fecha ?? prev.fecha,
    medio: r.medio ?? prev.medio,
  };
}
function completo(d) { return Boolean(d.cliente) && Number(d.monto) > 0; }

// Acumula los datos de un cliente NUEVO entre mensajes (para pedir lo que falte).
function combinaCliente(prev, nc) {
  const p = prev || {};
  return {
    nombre: nc.nombre || p.nombre || '',
    whatsapp: /^\d{9}$/.test(String(nc.whatsapp || '')) ? String(nc.whatsapp) : (p.whatsapp || ''),
    monto: Number(nc.monto) > 0 ? Number(nc.monto) : (p.monto ?? null),
    periodo: nc.periodo || p.periodo || 'MENSUAL',
    dia_cobro: nc.dia_cobro || p.dia_cobro || 1,
    pago_inicial: Number(nc.pago_inicial) > 0 ? Number(nc.pago_inicial) : (p.pago_inicial || 0),
  };
}
function clienteCompleto(nc) {
  return Boolean(nc && nc.nombre) && /^\d{9}$/.test(String(nc?.whatsapp || '')) && Number(nc?.monto) > 0;
}
function hhmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function isoFecha(v) { return String(v || '').slice(0, 10); }

// Payload completo para PUT/POST de cliente, partiendo del cliente enriquecido.
function payloadCliente(c, over = {}) {
  return {
    nombre: c.nombre,
    whatsapp: String(c.whatsapp),
    monto: Number(c.monto),
    dia_cobro: Number(c.dia_cobro) || 1,
    pagado_hasta: isoFecha(c.pagado_hasta),
    activo: Boolean(c.activo),
    periodo: c.periodo || 'MENSUAL',
    notas: c.notas || null,
    ...over,
  };
}

const WAVE = [8, 14, 10, 18, 12, 20, 9, 15, 11, 17, 7, 13, 19, 10, 14, 8, 16, 12, 9, 15];

function VoiceBubble({ url, durMs }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);
  return (
    <div className="flex items-center gap-3 min-w-[200px]">
      <button
        type="button"
        onClick={() => { const a = ref.current; if (!a) return; if (playing) a.pause(); else a.play(); }}
        aria-label={playing ? 'Pausar' : 'Reproducir'}
        className="grid place-items-center w-10 h-10 shrink-0 rounded-full bg-slate-950/15 text-slate-950 transition-transform active:scale-[0.96]"
      >
        {playing ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} className="translate-x-[1px]" />}
      </button>
      <div className="flex items-center gap-[3px] h-7 flex-1">
        {WAVE.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full"
            style={{ height: `${h}px`, background: i / WAVE.length <= prog ? 'currentColor' : 'rgba(2,6,23,0.30)' }}
          />
        ))}
      </div>
      <span className="tabular-nums text-xs text-slate-900/70 shrink-0">{mmss(durMs)}</span>
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProg(0); }}
        onTimeUpdate={(e) => { const a = e.currentTarget; if (a.duration) setProg(a.currentTime / a.duration); }}
      />
    </div>
  );
}

export default function ChatCobro({ clientes, geminiConfigurado, autoGrabar, onCambio, onAbrirCliente, onNuevoCliente, onAbrirAjustes, onClose }) {
  const [mensajes, setMensajes] = useState(() => [{
    from: 'bot',
    kind: 'text',
    time: hhmm(),
    text: geminiConfigurado
      ? 'Hola 👋 Dime un cobro ("Ana me pagó 100 yape hoy"), o pídeme crear/eliminar un cliente, anular un pago, o consultar quién debe. Lo hago al toque y te dejo un botón para deshacer.'
      : 'Para el chat necesitas tu API key de Gemini (gratis). Configúrala en Ajustes; mientras tanto puedes registrar el pago manual.',
  }]);
  const [texto, setTexto] = useState('');
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [sinKey, setSinKey] = useState(!geminiConfigurado);
  const [draft, setDraft] = useState(VACIO);
  const [pendiente, setPendiente] = useState(null); // fallback: abrir ficha o nuevo cliente
  const [deshacer, setDeshacer] = useState(null);    // { label, fn }

  const draftRef = useRef(VACIO);
  const scrollRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recStartRef = useRef(0);
  const timerRef = useRef(null);
  const autoIniciado = useRef(false);
  const borradorClienteRef = useRef(null); // cliente nuevo en construccion (datos parciales)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, enviando]);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    try { if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Si se abrio tocando el microfono, empieza a grabar solo (un solo toque).
  useEffect(() => {
    if (autoGrabar && !autoIniciado.current) {
      autoIniciado.current = true;
      iniciarGrabacion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGrabar]);

  function pushBot(text) { setMensajes((m) => [...m, { from: 'bot', kind: 'text', text, time: hhmm() }]); }
  function pushUser(text) { setMensajes((m) => [...m, { from: 'user', kind: 'text', text, time: hhmm() }]); }
  function setDraftBoth(next) { draftRef.current = next; setDraft(next); }

  function contextoDraft() {
    const d = draftRef.current;
    const c = {};
    if (d.cliente) { c.cliente_id = d.cliente.id; c.cliente_nombre = d.cliente.nombre; }
    if (d.monto != null) c.monto = d.monto;
    if (d.meses != null) c.meses = d.meses;
    if (d.abono) c.abono = true;
    if (d.fecha) c.fecha = d.fecha;
    if (d.medio) c.medio = d.medio;
    if (borradorClienteRef.current) c.nuevo_cliente_pendiente = borradorClienteRef.current;
    return Object.keys(c).length ? c : undefined;
  }

  // --- Ejecuciones automaticas (cada una deja un boton Deshacer) ---

  async function ejecutarPago(respuestaTxt) {
    const d = draftRef.current;
    if (!completo(d)) {
      pushBot(respuestaTxt || (!d.cliente ? '¿De qué cliente es el pago?' : `¿Cuánto pagó ${d.cliente.nombre}?`));
      return;
    }
    // El backend (modelo de saldo) decide cuanta cobertura avanza segun el monto.
    const nombre = d.cliente.nombre;
    const monto = d.monto;
    try {
      const r = await api.registrarPago({
        cliente_id: d.cliente.id, medio: d.medio || 'EFECTIVO', fecha: d.fecha || undefined, monto_total: monto,
      });
      setDraftBoth(VACIO);
      const c = r?.cliente;
      const estado = c
        ? (Number(c.deuda) > 0
          ? `Aún debe ${soles(c.deuda)}.`
          : (Number(c.saldo) > 0 ? `Al día (saldo a favor ${soles(c.saldo)}).` : 'Quedó al día.'))
        : '';
      pushBot(`✅ Registré ${soles(monto)} de ${nombre}. ${estado}`.trim());
      const pid = r?.pago?.id;
      if (pid) setDeshacer({ label: 'Deshacer pago', fn: async () => { await api.eliminarPago(pid); pushBot('Listo, anulé ese pago.'); onCambio?.(); } });
      onCambio?.();
    } catch (e) {
      pushBot(`No pude registrar el pago: ${e.message}`);
    }
  }

  async function autoRegistrarPago(resp) {
    setDraftBoth(combina(draftRef.current, resp));
    await ejecutarPago(resp.respuesta);
  }

  async function autoAnularPago(resp) {
    const cid = resp.cliente?.id;
    if (!cid) { pushBot(resp.respuesta || '¿De qué cliente anulo el pago?'); return; }
    try {
      const det = await api.obtenerCliente(cid);
      const pagos = det.pagos || [];
      if (!pagos.length) { pushBot(`${det.nombre} no tiene pagos para anular.`); return; }
      const p = pagos[0]; // mas reciente (el backend ordena fecha DESC, id DESC)
      await api.eliminarPago(p.id);
      pushBot(`✅ Anulé el pago de ${soles(p.monto_total)} del ${isoFecha(p.fecha)} de ${det.nombre}.`);
      setDeshacer({
        label: 'Deshacer (volver a registrar)',
        fn: async () => {
          await api.registrarPago({ cliente_id: cid, meses: p.meses, medio: p.medio, fecha: isoFecha(p.fecha), comprobante: p.comprobante || undefined, monto_total: Number(p.monto_total) });
          pushBot('Listo, restauré el pago.');
          onCambio?.();
        },
      });
      onCambio?.();
    } catch (e) {
      pushBot(`No pude anular: ${e.message}`);
    }
  }

  async function autoToggleActivo(resp, activo) {
    const full = clientes.find((c) => c.id === resp.cliente?.id);
    if (!full) { pushBot(resp.respuesta || 'No identifiqué al cliente.'); return; }
    try {
      await api.editarCliente(full.id, payloadCliente(full, { activo }));
      pushBot(activo ? `✅ Reactivé a ${full.nombre}.` : `✅ Di de baja a ${full.nombre}.`);
      setDeshacer({ label: 'Deshacer', fn: async () => { await api.editarCliente(full.id, payloadCliente(full, { activo: !activo })); pushBot('Listo, lo revertí.'); onCambio?.(); } });
      onCambio?.();
    } catch (e) {
      pushBot(`No pude: ${e.message}`);
    }
  }

  async function autoCrearCliente(resp) {
    // Acumula lo que ya se dijo del cliente nuevo con lo que llega ahora.
    const n = combinaCliente(borradorClienteRef.current, resp.nuevo_cliente || {});
    borradorClienteRef.current = n;
    if (!clienteCompleto(n)) {
      // Falta un dato: lo pedimos en el chat y seguimos acumulando (sin abrir formulario).
      const falta = !n.nombre
        ? 'el nombre'
        : (!/^\d{9}$/.test(String(n.whatsapp || '')) ? 'el WhatsApp (9 dígitos)' : 'la cuota mensual (S/)');
      pushBot(resp.respuesta || `Para crear el cliente me falta ${falta}. ¿Me lo dices?`);
      return;
    }
    borradorClienteRef.current = null;
    const pagoIni = Number(n.pago_inicial) > 0 ? Number(n.pago_inicial) : 0;
    const hoy = new Date();
    const fdm = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    // Si ya pago, lo creamos cubierto hasta el mes ANTERIOR y registramos el pago
    // (queda un pago real + al dia). Si no, cubierto hasta este mes.
    const phInicial = pagoIni ? fdm(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)) : fdm(hoy);
    try {
      const c = await api.crearCliente({
        nombre: n.nombre, whatsapp: String(n.whatsapp), monto: Number(n.monto),
        dia_cobro: n.dia_cobro || 1, pagado_hasta: phInicial, activo: true, periodo: n.periodo || 'MENSUAL', notas: null,
      });
      if (pagoIni && c?.id) {
        const rp = await api.registrarPago({ cliente_id: c.id, monto_total: pagoIni });
        const cli = rp?.cliente;
        const estado = cli ? (Number(cli.deuda) > 0 ? `Aún debe ${soles(cli.deuda)}.` : 'Quedó al día.') : '';
        pushBot(`✅ Creé a ${n.nombre} y registré su pago de ${soles(pagoIni)}. ${estado}`.trim());
        const pid = rp?.pago?.id;
        setDeshacer({
          label: 'Deshacer',
          fn: async () => { if (pid) await api.eliminarPago(pid); await api.eliminarCliente(c.id); pushBot('Listo, deshice todo.'); onCambio?.(); },
        });
      } else {
        pushBot(`✅ Creé a ${n.nombre}.`);
        if (c?.id) setDeshacer({ label: 'Deshacer', fn: async () => { await api.eliminarCliente(c.id); pushBot('Listo, lo eliminé.'); onCambio?.(); } });
      }
      onCambio?.();
    } catch (e) {
      pushBot(`No pude crear: ${e.message}. Te abro la ficha para completarlo.`);
      setPendiente({ tipo: 'nuevo', prefill: n });
    }
  }

  async function autoEliminarCliente(resp) {
    const full = clientes.find((c) => c.id === resp.cliente?.id);
    if (!full) { pushBot(resp.respuesta || 'No identifiqué al cliente.'); return; }
    try {
      await api.eliminarCliente(full.id);
      pushBot(`✅ Eliminé a ${full.nombre}.`);
      const snap = payloadCliente(full);
      setDeshacer({ label: 'Deshacer (recrear)', fn: async () => { await api.crearCliente(snap); pushBot('Listo, lo recreé.'); onCambio?.(); } });
      onCambio?.();
    } catch (e) {
      // 409 = tiene pagos -> no se borra, se da de baja desde la ficha.
      pushBot(`No pude eliminar a ${full.nombre}: ${e.message} Te abro su ficha para darle de baja.`);
      setPendiente({ tipo: 'ficha', cliente: { id: full.id, nombre: full.nombre } });
    }
  }

  async function aplicarRespuesta(resp) {
    if (resp.configurado === false) {
      setSinKey(true);
      pushBot(resp.respuesta || 'Configura tu API key de Gemini en Ajustes.');
      return;
    }
    setSinKey(false);
    setDeshacer(null);
    const accion = resp.accion || 'registrar_pago';
    if (accion !== 'registrar_pago') setDraftBoth(VACIO);
    if (accion !== 'crear_cliente') borradorClienteRef.current = null;

    switch (accion) {
      case 'registrar_pago': return autoRegistrarPago(resp);
      case 'eliminar_pago': return autoAnularPago(resp);
      case 'crear_cliente': return autoCrearCliente(resp);
      case 'eliminar_cliente': return autoEliminarCliente(resp);
      case 'baja_cliente': return autoToggleActivo(resp, false);
      case 'reactivar_cliente': return autoToggleActivo(resp, true);
      default: pushBot(resp.respuesta || '¿En qué te ayudo?'); return undefined;
    }
  }

  // Fallback local (asistente caido): parser por reglas + registra por el API propio.
  async function aplicarLocal(t) {
    const p = parseCobro(t, clientes);
    setDraftBoth(combina(draftRef.current, p));
    pushBot('(sin asistente) lo interpreté localmente.');
    await ejecutarPago();
  }

  async function enviarTexto(t) {
    const txt = (t ?? '').trim();
    if (!txt || enviando) return;
    pushUser(txt);
    setTexto('');
    setPendiente(null);
    setDeshacer(null);
    setEnviando(true);
    try {
      const resp = await api.chatCobro({ texto: txt, contexto: contextoDraft() });
      await aplicarRespuesta(resp);
    } catch {
      await aplicarLocal(txt);
    } finally {
      setEnviando(false);
    }
  }

  async function enviarAudio(blob) {
    setPendiente(null);
    setDeshacer(null);
    setEnviando(true);
    let audio;
    try {
      audio = await blobToWavBase64(blob);
    } catch {
      pushBot('No pude leer el audio. Repítelo o escríbelo, por favor.');
      setEnviando(false);
      return;
    }
    try {
      const resp = await api.chatCobro({ audio, contexto: contextoDraft() });
      await aplicarRespuesta(resp);
    } catch (e) {
      // Muestra el motivo real (p.ej. limite del asistente) y sugiere escribir.
      pushBot(e?.message || 'No pude procesar el audio. Escríbelo, por favor.');
    } finally {
      setEnviando(false);
    }
  }

  async function iniciarGrabacion() {
    if (recording || enviando) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      pushBot('Tu navegador no permite grabar audio. Escribe el cobro.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      pushBot('Necesito permiso del micrófono. Actívalo en el navegador y reintenta.');
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mt = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const mr = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
    mrRef.current = mr;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
      const durMs = Date.now() - recStartRef.current;
      const url = URL.createObjectURL(blob);
      setMensajes((m) => [...m, { from: 'user', kind: 'audio', url, durMs, time: hhmm() }]);
      if (blob.size > 0) await enviarAudio(blob);
    };
    recStartRef.current = Date.now();
    mr.start();
    setRecording(true);
    setRecMs(0);
    timerRef.current = setInterval(() => {
      const ms = Date.now() - recStartRef.current;
      setRecMs(ms);
      if (ms > 60000) detenerGrabacion();
    }, 100);
  }

  function detenerGrabacion() {
    clearInterval(timerRef.current);
    setRecording(false);
    try { if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop(); } catch { /* noop */ }
  }

  function elegirCliente(c) {
    setDraftBoth(combina(draftRef.current, { cliente: c }));
    ejecutarPago();
  }

  const activos = clientes.filter((c) => c.activo);
  const mostrarChips = !draft.cliente && draft.monto != null && !enviando && activos.length > 0;

  return (
    <Modal titulo="Cobrar por chat" onClose={onClose}>
      <div className="space-y-3">
        <div ref={scrollRef} className="h-80 overflow-y-auto flex flex-col gap-2 pr-1">
          {mensajes.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-snug shadow-sm ${
                m.from === 'user'
                  ? 'self-end bg-emerald-500 text-slate-950 rounded-br-sm'
                  : 'self-start bg-slate-800 text-slate-100 rounded-bl-sm'
              }`}
            >
              {m.kind === 'audio'
                ? <VoiceBubble url={m.url} durMs={m.durMs} />
                : <span className="whitespace-pre-wrap">{m.text}</span>}
              <span className={`block text-[10px] mt-0.5 tabular-nums ${m.from === 'user' ? 'text-slate-900/50 text-right' : 'text-slate-500'}`}>
                {m.time}
              </span>
            </div>
          ))}

          {enviando && (
            <div className="self-start bg-slate-800 rounded-2xl rounded-bl-sm px-3 py-3" aria-label="procesando">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          )}
        </div>

        {mostrarChips && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {activos.slice(0, 10).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => elegirCliente(c)}
                className="shrink-0 h-9 px-3 rounded-full bg-slate-800 border border-slate-700 text-sm text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer active:scale-[0.96]"
              >
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {deshacer && (
          <button
            type="button"
            onClick={async () => { const fn = deshacer.fn; setDeshacer(null); try { await fn(); } catch (e) { pushBot(`No pude deshacer: ${e.message}`); } }}
            className="w-full h-11 rounded-xl bg-slate-800 border border-slate-600 text-slate-200 text-sm font-medium hover:bg-slate-700 transition-colors cursor-pointer active:scale-[0.98]"
          >
            ↩ {deshacer.label}
          </button>
        )}

        {pendiente?.tipo === 'ficha' && (
          <button
            type="button"
            onClick={() => onAbrirCliente(pendiente.cliente)}
            className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 text-slate-900 font-semibold hover:bg-white transition-transform active:scale-[0.98]"
          >
            Abrir ficha de {pendiente.cliente.nombre} <IconChevron width={18} height={18} />
          </button>
        )}

        {pendiente?.tipo === 'nuevo' && (
          <button
            type="button"
            onClick={() => onNuevoCliente(pendiente.prefill)}
            className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-transform active:scale-[0.98]"
          >
            <IconPlus width={18} height={18} /> Completar cliente{pendiente.prefill?.nombre ? ` — ${pendiente.prefill.nombre}` : ''}
          </button>
        )}

        {sinKey && (
          <button
            type="button"
            onClick={onAbrirAjustes}
            className="w-full h-11 rounded-xl bg-slate-800 border border-amber-500/40 text-amber-300 text-sm font-medium hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Configurar API key de Gemini en Ajustes
          </button>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); enviarTexto(texto); }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={recording ? detenerGrabacion : iniciarGrabacion}
            disabled={enviando}
            aria-label={recording ? 'Detener grabación' : 'Grabar nota de voz'}
            className={`grid place-items-center w-12 h-12 shrink-0 rounded-xl border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/60 disabled:opacity-40 ${
              recording
                ? 'bg-red-500 border-red-500 text-white'
                : 'bg-slate-800 border-slate-700 text-emerald-300 hover:bg-slate-700'
            }`}
          >
            {recording ? <IconStop width={18} height={18} /> : <IconMic width={20} height={20} />}
          </button>

          {recording ? (
            <div className="flex-1 h-12 px-4 inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-red-500/40 text-slate-200">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm">Grabando</span>
              <span className="ml-auto tabular-nums text-sm text-slate-400">{mmss(recMs)}</span>
            </div>
          ) : (
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder='Escribe: "Ana pagó 100 yape ayer"'
              aria-label="Escribir el cobro"
              disabled={enviando}
              className="flex-1 h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 disabled:opacity-60"
            />
          )}

          {!recording && (
            <button
              type="submit"
              disabled={!texto.trim() || enviando}
              aria-label="Enviar"
              className="grid place-items-center w-12 h-12 shrink-0 rounded-xl bg-slate-100 text-slate-900 hover:bg-white transition-transform active:scale-[0.96] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <IconSend width={20} height={20} />
            </button>
          )}
        </form>
      </div>
    </Modal>
  );
}
