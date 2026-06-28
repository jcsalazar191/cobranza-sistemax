import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { soles, MEDIOS, MESES_OPCIONES, periodoMeta, montoSugerido, mesesCobrados, DESCUENTO_MESES } from '../lib/ui.js';

export default function PagoModal({ cliente, onClose, onGuardar }) {
  const [meses, setMeses] = useState(periodoMeta(cliente.periodo).meses);
  const [medio, setMedio] = useState('EFECTIVO');
  const [fecha, setFecha] = useState(() => {
    const d = new Date(); // fecha LOCAL (no UTC) para no correr el dia de noche en Peru
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [comprobante, setComprobante] = useState('');
  const [montoTotal, setMontoTotal] = useState(Number(cliente.monto));
  const [montoEditado, setMontoEditado] = useState(false);
  const [abono, setAbono] = useState(false); // abono parcial: no avanza pagado_hasta
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Sugerencia automatica (con descuento semestral/anual), salvo abono o edicion manual.
  useEffect(() => {
    if (!montoEditado && !abono) setMontoTotal(montoSugerido(meses, cliente.monto));
  }, [meses, cliente.monto, montoEditado, abono]);

  const descuento = DESCUENTO_MESES[meses] || 0; // meses gratis para 6/12

  async function submit(e) {
    e.preventDefault();
    setError('');
    const total = Number(montoTotal);
    if (!Number.isFinite(total) || total <= 0) {
      setError('El monto debe ser mayor a 0.');
      return;
    }
    setGuardando(true);
    try {
      await onGuardar({
        cliente_id: cliente.id,
        meses: abono ? 0 : meses, // abono = 0 meses (no avanza)
        medio,
        fecha,
        comprobante: comprobante.trim() || undefined,
        monto_total: total,
      });
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={`Registrar pago - ${cliente.nombre}`}
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
            form="form-pago"
            disabled={guardando}
            className="flex-1 h-12 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : (abono ? 'Guardar abono' : 'Guardar pago')}
          </button>
        </>
      }
    >
      <form id="form-pago" onSubmit={submit} className="space-y-5">
        <div className="flex items-center justify-between rounded-xl bg-slate-800/60 border border-slate-700/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-200">Abono parcial</p>
            <p className="text-xs text-slate-500">Registra el dinero pero NO avanza la cobertura.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={abono}
            aria-label="Abono parcial"
            onClick={() => { setAbono((v) => !v); setMontoEditado(true); setMontoTotal(''); }}
            className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${abono ? 'bg-amber-500' : 'bg-slate-600'}`}
          >
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${abono ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {!abono && (
          <fieldset>
            <legend className="text-sm font-medium text-slate-300 mb-2">Meses que cubre</legend>
            <div className="grid grid-cols-4 gap-2">
              {MESES_OPCIONES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMeses(m)}
                  aria-pressed={meses === m}
                  className={`h-12 rounded-xl font-semibold tabular border transition-colors cursor-pointer
                    ${meses === m
                      ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                      : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-slate-300 mb-2">Medio de pago</legend>
          <div className="grid grid-cols-4 gap-2">
            {MEDIOS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMedio(m)}
                aria-pressed={medio === m}
                className={`h-11 rounded-xl text-xs font-semibold border transition-colors cursor-pointer
                  ${medio === m
                    ? 'bg-slate-100 text-slate-900 border-slate-100'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="fecha_pago" className="block text-sm font-medium text-slate-300 mb-2">
            Fecha del pago
          </label>
          <input
            id="fecha_pago"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 tabular focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          />
          <p className="mt-1 text-xs text-slate-500">Cámbiala si registras un pago de un mes anterior.</p>
        </div>

        <div>
          <label htmlFor="comprobante" className="block text-sm font-medium text-slate-300 mb-2">
            Comprobante <span className="text-slate-500">(opcional)</span>
          </label>
          <input
            id="comprobante"
            type="text"
            value={comprobante}
            onChange={(e) => setComprobante(e.target.value)}
            placeholder="N de operacion, nota..."
            className="w-full h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          />
        </div>

        <div>
          <label htmlFor="monto_total" className="block text-sm font-medium text-slate-300 mb-2">
            {abono ? 'Monto del abono (S/)' : 'Total a registrar (S/)'}
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 tabular">S/</span>
            <input
              id="monto_total"
              type="number"
              min="0"
              step="0.01"
              value={montoTotal}
              onChange={(e) => { setMontoEditado(true); setMontoTotal(e.target.value); }}
              className="w-full h-12 pl-11 pr-4 rounded-xl bg-slate-800 border border-slate-700 text-emerald-300 font-bold tabular text-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {abono
              ? 'Queda como abono; "pagado hasta" no cambia. El cliente sigue debiendo.'
              : `Sugerido ${soles(montoSugerido(meses, cliente.monto))} (${mesesCobrados(meses)} × ${soles(cliente.monto)}${descuento ? ` · ${descuento} mes${descuento > 1 ? 'es' : ''} gratis` : ''}). Cubre ${meses} mes${meses > 1 ? 'es' : ''}.`}
          </p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  );
}
