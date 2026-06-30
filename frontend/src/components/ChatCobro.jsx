import { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { parseCobro } from '../lib/parseCobro.js';
import { blobToWavBase64 } from '../lib/audioWav.js';
import { soles } from '../lib/ui.js';
import { IconMic, IconSend, IconCash, IconPlay, IconPause, IconStop, IconPlus, IconChevron } from './Icons.jsx';

const VACIO = { cliente: null, monto: null, meses: null, abono: false, fecha: null, medio: null };

// Rellena solo lo que falta, sin borrar lo ya conocido.
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
function hhmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const WAVE = [8, 14, 10, 18, 12, 20, 9, 15, 11, 17, 7, 13, 19, 10, 14, 8, 16, 12, 9, 15];

// Burbuja de nota de voz reproducible (estilo WhatsApp).
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

export default function ChatCobro({ clientes, geminiConfigurado, onCobrar, onAbrirCliente, onNuevoCliente, onAbrirAjustes, onClose }) {
  const [mensajes, setMensajes] = useState(() => [{
    from: 'bot',
    kind: 'text',
    time: hhmm(),
    text: geminiConfigurado
      ? 'Hola 👋 Dime un cobro ("Ana me pagó 100 yape hoy"), o pídeme crear/eliminar un cliente, anular un pago, o consultar quién debe.'
      : 'Para el chat necesitas tu API key de Gemini (gratis). Configúrala en Ajustes; mientras tanto puedes registrar el pago manual.',
  }]);
  const [texto, setTexto] = useState('');
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [sinKey, setSinKey] = useState(!geminiConfigurado);
  const [draft, setDraft] = useState(VACIO);
  const [pendiente, setPendiente] = useState(null); // accion no-pago lista para abrir su pantalla

  const draftRef = useRef(VACIO);
  const scrollRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recStartRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, enviando]);

  // Limpieza al cerrar.
  useEffect(() => () => {
    clearInterval(timerRef.current);
    try { if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

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
    return Object.keys(c).length ? c : undefined;
  }

  function aplicarRespuesta(resp) {
    if (resp.configurado === false) {
      setSinKey(true);
      pushBot(resp.respuesta || 'Configura tu API key de Gemini en Ajustes.');
      return;
    }
    setSinKey(false);
    const accion = resp.accion || 'registrar_pago';

    // Pago: acumula en el borrador y muestra la confirmacion (tarjeta "Revisar y guardar").
    if (accion === 'registrar_pago') {
      setPendiente(null);
      const next = combina(draftRef.current, resp);
      setDraftBoth(next);
      pushBot(resp.respuesta || (completo(next) ? `Listo, ${next.cliente.nombre}.` : '¿Me das un dato más?'));
      return;
    }

    // Acciones que se resuelven abriendo la ficha del cliente (anular pago, eliminar,
    // dar de baja, reactivar) — ahi estan los botones con su confirmacion.
    if (['eliminar_pago', 'eliminar_cliente', 'baja_cliente', 'reactivar_cliente'].includes(accion)) {
      setDraftBoth(VACIO);
      pushBot(resp.respuesta);
      setPendiente(resp.cliente ? { tipo: 'ficha', cliente: resp.cliente } : null);
      return;
    }

    // Crear cliente: abre el formulario de nuevo cliente pre-llenado.
    if (accion === 'crear_cliente') {
      setDraftBoth(VACIO);
      pushBot(resp.respuesta);
      setPendiente({ tipo: 'nuevo', prefill: resp.nuevo_cliente || {} });
      return;
    }

    // Consultar / ninguna: solo responde.
    setDraftBoth(VACIO);
    setPendiente(null);
    pushBot(resp.respuesta || '¿En qué te ayudo?');
  }

  // Fallback local (sin conexion al asistente): parser por reglas, solo texto.
  function aplicarLocal(t) {
    const p = parseCobro(t, clientes);
    const next = combina(draftRef.current, p);
    setDraftBoth(next);
    const reply = !next.cliente
      ? '¿De qué cliente es el pago?'
      : Number(next.monto) > 0
        ? `Anotado: ${next.cliente.nombre}, ${soles(next.monto)}. Revisa y guarda.`
        : `¿Cuánto pagó ${next.cliente.nombre}?`;
    pushBot(`(sin conexión al asistente) ${reply}`);
  }

  async function enviarTexto(t) {
    const txt = (t ?? '').trim();
    if (!txt || enviando) return;
    pushUser(txt);
    setTexto('');
    setPendiente(null);
    setEnviando(true);
    try {
      const resp = await api.chatCobro({ texto: txt, contexto: contextoDraft() });
      aplicarRespuesta(resp);
    } catch {
      aplicarLocal(txt);
    } finally {
      setEnviando(false);
    }
  }

  async function enviarAudio(blob) {
    setPendiente(null);
    setEnviando(true);
    try {
      const audio = await blobToWavBase64(blob);
      const resp = await api.chatCobro({ audio, contexto: contextoDraft() });
      aplicarRespuesta(resp);
    } catch {
      pushBot('No pude procesar el audio. Repítelo o escríbelo, por favor.');
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
      if (ms > 60000) detenerGrabacion(); // tope 60s
    }, 100);
  }

  function detenerGrabacion() {
    clearInterval(timerRef.current);
    setRecording(false);
    try { if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop(); } catch { /* noop */ }
  }

  function elegirCliente(c) {
    const next = combina(draftRef.current, { cliente: c });
    setDraftBoth(next);
    pushBot(completo(next)
      ? `Perfecto, ${c.nombre}. Revisa y guarda.`
      : `¿Cuánto pagó ${c.nombre}?`);
  }

  function confirmar() {
    const d = draftRef.current;
    if (!completo(d)) return;
    const inicial = { abono: d.abono };
    if (d.monto != null) inicial.montoTotal = d.monto;
    if (!d.abono && d.meses != null) inicial.meses = d.meses;
    if (d.medio) inicial.medio = d.medio;
    if (d.fecha) inicial.fecha = d.fecha;
    onCobrar(d.cliente, inicial);
  }

  const listo = completo(draft);
  const activos = clientes.filter((c) => c.activo);
  const mostrarChips = !draft.cliente && !enviando && mensajes.length > 1 && activos.length > 0;

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
            <div className="self-start bg-slate-800 rounded-2xl rounded-bl-sm px-3 py-3" aria-label="escribiendo">
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

        {sinKey && (
          <button
            type="button"
            onClick={onAbrirAjustes}
            className="w-full h-11 rounded-xl bg-slate-800 border border-amber-500/40 text-amber-300 text-sm font-medium hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Configurar API key de Gemini en Ajustes
          </button>
        )}

        {listo && (
          <button
            type="button"
            onClick={confirmar}
            className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-transform active:scale-[0.98]"
          >
            <IconCash width={20} height={20} /> Revisar y guardar — {draft.cliente.nombre}
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
            <IconPlus width={18} height={18} /> Crear cliente{pendiente.prefill?.nombre ? ` — ${pendiente.prefill.nombre}` : ''}
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
