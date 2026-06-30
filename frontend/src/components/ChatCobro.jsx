import { useState, useEffect, useRef, useCallback } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import Modal from './Modal.jsx';
import { parseCobro } from '../lib/parseCobro.js';
import { soles, periodoMeta } from '../lib/ui.js';
import { IconMic, IconSend, IconCash } from './Icons.jsx';

const VACIO = { cliente: null, monto: null, meses: null, abono: false, fecha: null, medio: null };

function combina(prev, p) {
  return {
    cliente: p.cliente ?? prev.cliente,
    monto: p.monto ?? prev.monto,
    meses: p.meses ?? prev.meses,
    abono: p.abono || prev.abono,
    fecha: p.fecha ?? prev.fecha,
    medio: p.medio ?? prev.medio,
  };
}

function completo(d) {
  return Boolean(d.cliente) && Number(d.monto) > 0;
}

// Resumen legible del borrador, ya con los defaults que aplicaria el PagoModal.
function lineaResumen(d) {
  const meses = d.abono ? 0 : (d.meses ?? (d.cliente ? periodoMeta(d.cliente.periodo).meses : 1));
  const partes = [soles(d.monto)];
  if (d.abono) partes.push('abono');
  else partes.push(`${meses} mes${meses === 1 ? '' : 'es'}`);
  partes.push(d.medio ?? 'EFECTIVO');
  if (d.fecha) partes.push(d.fecha);
  return partes.join(' · ');
}

export default function ChatCobro({ clientes, onCobrar, onClose }) {
  const [mensajes, setMensajes] = useState([
    { from: 'bot', text: 'Dime el cobro por voz o escribiéndolo. Ej: "Juan me pagó 50 soles hoy".' },
  ]);
  const [texto, setTexto] = useState('');
  const draftRef = useRef(VACIO);
  const [draft, setDraft] = useState(VACIO);
  const scrollRef = useRef(null);
  const prevListening = useRef(false);

  const {
    transcript, listening, resetTranscript, browserSupportsSpeechRecognition,
  } = useSpeechRecognition();

  // Auto-scroll al ultimo mensaje.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes]);

  // Mientras dicta, refleja el transcript en el input.
  useEffect(() => { if (listening) setTexto(transcript); }, [transcript, listening]);

  const enviar = useCallback((raw) => {
    const t = (raw ?? '').trim();
    if (!t) return;
    const p = parseCobro(t, clientes);
    const next = combina(draftRef.current, p);
    draftRef.current = next;
    setDraft(next);

    const reply = !next.cliente
      ? (p.faltantes.includes('cliente_ambiguo')
        ? 'Hay varios clientes parecidos. Dime el nombre completo.'
        : '¿De qué cliente es el pago? Dime el nombre.')
      : Number(next.monto) > 0
        ? `Listo: ${next.cliente.nombre} — ${lineaResumen(next)}. Revisa y guarda.`
        : `¿Cuánto pagó ${next.cliente.nombre}? Dime el monto.`;

    setMensajes((m) => [...m, { from: 'user', text: t }, { from: 'bot', text: reply }]);
    setTexto('');
  }, [clientes]);

  // Al soltar el microfono, envia lo dictado.
  useEffect(() => {
    if (prevListening.current && !listening) {
      const t = transcript.trim();
      if (t) { enviar(t); resetTranscript(); }
    }
    prevListening.current = listening;
  }, [listening, transcript, enviar, resetTranscript]);

  // Detiene la escucha al cerrar.
  useEffect(() => () => { SpeechRecognition.stopListening(); }, []);

  function toggleMic() {
    if (listening) {
      SpeechRecognition.stopListening();
    } else {
      resetTranscript();
      setTexto('');
      SpeechRecognition.startListening({ language: 'es-PE', continuous: false });
    }
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

  return (
    <Modal titulo="Cobrar por chat" onClose={onClose}>
      <div className="space-y-4">
        <div ref={scrollRef} className="h-72 overflow-y-auto flex flex-col gap-2 pr-1">
          {mensajes.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-snug ${
                m.from === 'user'
                  ? 'self-end bg-emerald-500 text-slate-950 rounded-br-sm'
                  : 'self-start bg-slate-800 text-slate-200 rounded-bl-sm'
              }`}
            >
              {m.text}
            </div>
          ))}
          {listening && (
            <div className="self-end text-xs text-emerald-400 px-2">escuchando…</div>
          )}
        </div>

        {listo && (
          <button
            type="button"
            onClick={confirmar}
            className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            <IconCash width={20} height={20} /> Revisar y guardar — {draft.cliente.nombre}
          </button>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); enviar(texto); }}
          className="flex items-center gap-2"
        >
          {browserSupportsSpeechRecognition && (
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={listening}
              aria-label={listening ? 'Detener dictado' : 'Dictar por voz'}
              title={listening ? 'Detener' : 'Hablar'}
              className={`grid place-items-center w-12 h-12 shrink-0 rounded-xl border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/60 ${
                listening
                  ? 'bg-red-500 border-red-500 text-white animate-pulse'
                  : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <IconMic width={20} height={20} />
            </button>
          )}
          <input
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder='Ej: "Ana pagó 100 yape ayer"'
            aria-label="Escribir el cobro"
            className="flex-1 h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          />
          <button
            type="submit"
            disabled={!texto.trim()}
            aria-label="Enviar"
            className="grid place-items-center w-12 h-12 shrink-0 rounded-xl bg-slate-100 text-slate-900 hover:bg-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          >
            <IconSend width={20} height={20} />
          </button>
        </form>

        {!browserSupportsSpeechRecognition && (
          <p className="text-xs text-slate-500">
            Tu navegador no soporta dictado por voz. Escribe el cobro (funciona igual).
          </p>
        )}
      </div>
    </Modal>
  );
}
