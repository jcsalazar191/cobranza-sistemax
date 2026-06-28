import { useState } from 'react';
import Modal from './Modal.jsx';
import { soles, aMonthInput, PERIODOS, periodoMeta } from '../lib/ui.js';
import { IconTrash } from './Icons.jsx';

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Desplaza un valor 'YYYY-MM' por n meses.
function shiftMes(ym, n) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, (m - 1) + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ClienteFormModal({ cliente, onClose, onGuardar, onEliminar, onAnularPago }) {
  const editando = Boolean(cliente?.id);
  const [form, setForm] = useState({
    nombre: cliente?.nombre ?? '',
    whatsapp: cliente?.whatsapp ?? '',
    monto: cliente?.monto ?? '',
    dia_cobro: cliente?.dia_cobro ?? 1,
    pagado_hasta: cliente ? aMonthInput(cliente.pagado_hasta) : mesActual(),
    activo: cliente?.activo ?? true,
    periodo: cliente?.periodo ?? 'MENSUAL',
    notas: cliente?.notas ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const set = (campo) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [campo]: v }));
  };

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!/^[0-9]{9}$/.test(String(form.whatsapp))) {
      setError('WhatsApp debe tener 9 digitos (sin +51).');
      return;
    }
    setGuardando(true);
    try {
      await onGuardar({
        nombre: form.nombre.trim(),
        whatsapp: String(form.whatsapp).trim(),
        monto: Number(form.monto),
        dia_cobro: Number(form.dia_cobro),
        pagado_hasta: `${form.pagado_hasta}-01`,
        activo: Boolean(form.activo),
        periodo: form.periodo,
        notas: form.notas.trim() || null,
      }, cliente?.id);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  const inputCls = 'w-full h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60';
  const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';
  const paso = periodoMeta(form.periodo).meses; // saltos de "pagado hasta" segun el plan
  const stepBtn = 'shrink-0 w-12 h-12 grid place-items-center rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-xl font-bold hover:bg-slate-700 transition-colors cursor-pointer';

  return (
    <Modal
      titulo={editando ? 'Editar cliente' : 'Nuevo cliente'}
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
            form="form-cliente"
            disabled={guardando}
            className="flex-1 h-12 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="form-cliente" onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="nombre" className={labelCls}>Nombre</label>
          <input id="nombre" type="text" required value={form.nombre} onChange={set('nombre')} className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="whatsapp" className={labelCls}>WhatsApp (9 dig.)</label>
            <input id="whatsapp" type="tel" inputMode="numeric" maxLength={9} required
              value={form.whatsapp} onChange={set('whatsapp')} placeholder="9XXXXXXXX" className={`${inputCls} tabular`} />
          </div>
          <div>
            <label htmlFor="monto" className={labelCls}>Monto (S/)</label>
            <input id="monto" type="number" min="0" step="0.01" required
              value={form.monto} onChange={set('monto')} className={`${inputCls} tabular`} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="dia_cobro" className={labelCls}>Dia de cobro</label>
            <input id="dia_cobro" type="number" min="1" max="31" required
              value={form.dia_cobro} onChange={set('dia_cobro')} className={`${inputCls} tabular`} />
          </div>
        </div>

        <div>
          <label htmlFor="pagado_hasta" className={labelCls}>Pagado hasta</label>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              aria-label={`Retroceder ${paso} mes(es)`}
              onClick={() => setForm((f) => ({ ...f, pagado_hasta: shiftMes(f.pagado_hasta, -paso) }))}
              className={stepBtn}
            >
              −
            </button>
            <input id="pagado_hasta" type="month" required
              value={form.pagado_hasta} onChange={set('pagado_hasta')}
              className={`${inputCls} tabular flex-1 text-center`} />
            <button
              type="button"
              aria-label={`Avanzar ${paso} mes(es)`}
              onClick={() => setForm((f) => ({ ...f, pagado_hasta: shiftMes(f.pagado_hasta, paso) }))}
              className={stepBtn}
            >
              +
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Los botones avanzan de a {paso} mes(es), segun el plan ({periodoMeta(form.periodo).label}).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Plan habitual</label>
          <div className="grid grid-cols-4 gap-2">
            {PERIODOS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setForm((f) => ({
                  ...f,
                  periodo: p.key,
                  // Al CREAR, elegir plan adelanta la cobertura; al EDITAR no toca la fecha
                  // (para no mover datos reales por error; usa − / + para eso).
                  pagado_hasta: editando ? f.pagado_hasta : shiftMes(mesActual(), p.meses),
                }))}
                aria-pressed={form.periodo === p.key}
                className={`h-11 rounded-xl text-xs font-semibold border transition-colors cursor-pointer
                  ${form.periodo === p.key
                    ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {editando
              ? 'Cambiar el plan solo cambia la etiqueta. Para mover "Pagado hasta" usa − / + o registra un pago.'
              : 'Al elegir un plan, "Pagado hasta" se adelanta esos meses (Semestral = +6).'}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-slate-800/60 border border-slate-700/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-200">
              {form.activo ? 'Cliente activo' : 'Dado de baja'}
            </p>
            <p className="text-xs text-slate-500">
              {form.activo ? 'Cuenta en deuda e ingreso mensual' : 'Fuera de totales; conserva su historial'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.activo}
            aria-label="Activar o dar de baja"
            onClick={() => setForm((f) => ({ ...f, activo: !f.activo }))}
            className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${form.activo ? 'bg-emerald-500' : 'bg-slate-600'}`}
          >
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${form.activo ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div>
          <label htmlFor="notas" className={labelCls}>Notas</label>
          <textarea id="notas" rows={2} value={form.notas} onChange={set('notas')}
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 resize-none" />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      {editando && (
        <div className="mt-6 pt-5 border-t border-slate-700/60">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Historial de pagos</h3>
          {(!cliente.pagos || cliente.pagos.length === 0) ? (
            <>
              <p className="text-sm text-slate-500">Sin pagos registrados.</p>
              <button
                type="button"
                onClick={() => onEliminar(cliente)}
                className="mt-4 w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-red-500/10 text-red-300 border border-red-500/30 font-medium hover:bg-red-500/20 transition-colors cursor-pointer"
              >
                <IconTrash width={18} height={18} /> Eliminar cliente
              </button>
              <p className="mt-2 text-xs text-slate-500">
                Solo se puede eliminar mientras no tenga pagos. Si ya cobraste, usa "Dar de baja".
              </p>
            </>
          ) : (
            <ul className="space-y-2">
              {cliente.pagos.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm rounded-lg bg-slate-800/50 px-3 py-2">
                  <div className="min-w-0">
                    <span className="tabular text-slate-200">{String(p.fecha).slice(0, 10)}</span>
                    <span className="ml-2 text-slate-400">{p.meses === 0 ? 'abono' : `${p.meses} mes(es)`} · {p.medio}</span>
                    {p.comprobante && <span className="ml-2 text-slate-500">· {p.comprobante}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular font-semibold text-emerald-300">{soles(p.monto_total)}</span>
                    {onAnularPago && (
                      <button
                        type="button"
                        onClick={() => onAnularPago(cliente, p)}
                        aria-label="Anular pago"
                        title="Anular pago (retrocede pagado hasta)"
                        className="grid place-items-center w-8 h-8 rounded-lg text-red-300 hover:bg-red-500/15 transition-colors cursor-pointer"
                      >
                        <IconTrash width={16} height={16} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
