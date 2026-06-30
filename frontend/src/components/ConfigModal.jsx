import { useState } from 'react';
import Modal from './Modal.jsx';
import {
  aplicarPlantilla, PLACEHOLDERS_DEUDA, PLACEHOLDERS_ALDIA,
  PLANTILLA_DEFAULT, PLANTILLA_ALDIA_DEFAULT,
} from '../lib/ui.js';

const EJ_DEUDA = { nombre: 'Bodega Don Jose', deuda: 100, meses_debe: 2, monto: 50, periodo: 'TRIMESTRAL', pagado_hasta: '2026-04-01', pagado_hasta_label: 'abril 2026' };
const EJ_ALDIA = { nombre: 'Farmacia La Salud', deuda: 0, meses_debe: 0, monto: 80, periodo: 'SEMESTRAL', pagado_hasta_label: 'diciembre 2026' };

function Editor({ titulo, ayuda, valor, setValor, placeholders, ejemplo }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200">{titulo}</h3>
      <p className="text-xs text-slate-500 mb-2">{ayuda}</p>
      <textarea
        rows={4}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 resize-none"
      />
      <div className="flex flex-wrap gap-2 mt-2">
        {placeholders.map((ph) => (
          <button
            key={ph}
            type="button"
            onClick={() => setValor((t) => `${t}${ph}`)}
            className="h-8 px-3 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono text-emerald-300 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            {ph}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-xl bg-slate-800/60 border border-slate-700/60 px-4 py-3 text-sm text-slate-200 whitespace-pre-wrap">
        {aplicarPlantilla(valor, ejemplo)}
      </div>
    </div>
  );
}

export default function ConfigModal({ plantillaDeuda, plantillaAldia, geminiConfigurado, onClose, onGuardar }) {
  const [deuda, setDeuda] = useState(plantillaDeuda || PLANTILLA_DEFAULT);
  const [aldia, setAldia] = useState(plantillaAldia || PLANTILLA_ALDIA_DEFAULT);
  const [geminiKey, setGeminiKey] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!deuda.trim() || !aldia.trim()) { setError('Los mensajes no pueden estar vacios.'); return; }
    setGuardando(true);
    try {
      // La key solo se envia si el usuario escribio algo (vacio = no cambiar).
      await onGuardar(deuda.trim(), aldia.trim(), geminiKey.trim() || undefined);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Mensajes de recordatorio"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-12 rounded-xl bg-slate-800 text-slate-200 font-medium hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-config"
            disabled={guardando}
            className="flex-1 h-12 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="form-config" onSubmit={submit} className="space-y-6">
        <Editor
          titulo="A clientes que deben"
          ayuda="Se envia cuando el cliente tiene deuda (S/ > 0)."
          valor={deuda} setValor={setDeuda}
          placeholders={PLACEHOLDERS_DEUDA} ejemplo={EJ_DEUDA}
        />
        <Editor
          titulo="A clientes al dia (proximo pago)"
          ayuda="Se envia cuando el cliente esta cubierto (deuda S/ 0), para recordar su renovacion."
          valor={aldia} setValor={setAldia}
          placeholders={PLACEHOLDERS_ALDIA} ejemplo={EJ_ALDIA}
        />

        <div className="pt-2 border-t border-slate-700/60">
          <h3 className="text-sm font-semibold text-slate-200">Asistente del chat de voz (Gemini)</h3>
          <p className="text-xs text-slate-500 mb-2">
            {geminiConfigurado
              ? 'API key configurada ✓. Escribe una nueva solo si quieres reemplazarla.'
              : 'Pega tu API key gratuita para activar el chat de voz. Se guarda en tu servidor, nunca se comparte.'}
          </p>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            autoComplete="off"
            placeholder={geminiConfigurado ? '•••••••••• (sin cambios)' : 'AIza... o AQ...'}
            className="w-full h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          />
          <p className="mt-2 text-xs text-slate-500">
            Consíguela gratis en{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline">
              aistudio.google.com/apikey
            </a>.
          </p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  );
}
