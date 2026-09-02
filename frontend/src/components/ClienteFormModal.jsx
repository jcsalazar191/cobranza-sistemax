import { useState } from 'react';
import Modal from './Modal.jsx';
import { soles, aMonthInput, PERIODOS, periodoMeta, linkRecibo } from '../lib/ui.js';
import { IconTrash, IconWhatsapp } from './Icons.jsx';

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

const MESES_LBL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const MEDIOS = ['YAPE', 'EFECTIVO', 'BCP', 'BN'];

// Normaliza un numero pegado desde WhatsApp (+51, espacios, guiones) -> 9 digitos.
function limpiarWhatsapp(v) {
  const d = String(v).replace(/\D/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}

// 'YYYY-MM-DD' o 'YYYY-MM' -> "junio 2026".
function mesLabel(iso) {
  const [y, m] = String(iso).split('-').map(Number);
  return `${MESES_LBL[m - 1]} ${y}`;
}

export default function ClienteFormModal({ cliente, diaCobroDefault, onClose, onGuardar, onEliminar, onAnularPago }) {
  const editando = Boolean(cliente?.id);
  const [form, setForm] = useState({
    nombre: cliente?.nombre ?? '',
    whatsapp: cliente?.whatsapp ?? '',
    monto: cliente?.monto ?? '',
    dia_cobro: cliente?.dia_cobro ?? new Date().getDate(), // dia de creacion = dia que paga
    pagado_hasta: cliente ? aMonthInput(cliente.pagado_hasta) : mesActual(),
    activo: cliente?.activo ?? true,
    periodo: cliente?.periodo ?? 'MENSUAL',
    notas: cliente?.notas ?? '',
    cobro_vencido: cliente?.cobro_vencido ?? false,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [tarifaDesde, setTarifaDesde] = useState(mesActual());
  // Alta: normalmente el cliente ya pago al registrarse -> registra un pago real.
  const [yaPago, setYaPago] = useState(true);
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoMedio, setPagoMedio] = useState('YAPE');

  const set = (campo) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [campo]: v }));
  };

  // Cambio de cuota al editar: dispara el flujo de tarifa con fecha de vigencia.
  const cambioTarifa = editando && form.monto !== ''
    && (Number(form.monto) !== Number(cliente.monto) || form.periodo !== cliente.periodo);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!/^[0-9]{9}$/.test(String(form.whatsapp))) {
      setError('WhatsApp debe tener 9 digitos (sin +51).');
      return;
    }
    setGuardando(true);
    // Alta "ya pago": se crea cubierto hasta el mes anterior y el pago inicial
    // lo lleva al mes actual (queda al dia, con ingreso e historial reales).
    const conPago = !editando && yaPago;
    // Base = mes anterior a HOY (no el pagado_hasta que el tap de plan pudo inflar);
    // el pago avanza el bloque del plan (mensual +1, anual +12) y lo deja al dia.
    const pagadoHasta = conPago ? `${shiftMes(mesActual(), -1)}-01` : `${form.pagado_hasta}-01`;
    const pagoInicial = conPago
      ? { monto_total: pagoMonto !== '' ? Number(pagoMonto) : Number(form.monto), medio: pagoMedio }
      : null;
    try {
      await onGuardar({
        nombre: form.nombre.trim(),
        whatsapp: String(form.whatsapp).trim(),
        monto: Number(form.monto),
        dia_cobro: Number(form.dia_cobro),
        pagado_hasta: pagadoHasta,
        activo: Boolean(form.activo),
        periodo: form.periodo,
        notas: form.notas.trim() || null,
        cobro_vencido: Boolean(form.cobro_vencido),
        ...(cambioTarifa ? { tarifa_desde: `${tarifaDesde}-01` } : {}),
      }, cliente?.id, pagoInicial);
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
            <input id="whatsapp" type="tel" inputMode="numeric" required
              value={form.whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, whatsapp: limpiarWhatsapp(e.target.value) }))}
              placeholder="9XXXXXXXX" className={`${inputCls} tabular`} />
          </div>
          <div>
            <label htmlFor="monto" className={labelCls}>Monto (S/)</label>
            <input id="monto" type="number" min="0" step="0.01" required
              value={form.monto} onChange={set('monto')} className={`${inputCls} tabular`} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="dia_cobro" className={labelCls}>Día de cobro</label>
            <input id="dia_cobro" type="number" min="1" max="31" required
              value={form.dia_cobro} onChange={set('dia_cobro')} className={`${inputCls} tabular`} />
            <p className="mt-1 text-xs text-slate-500">Ese día vence su mes.</p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-slate-800/60 border border-slate-700/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-200">
              {form.cobro_vencido ? 'Cobro vencido' : 'Cobro adelantado'}
            </p>
            <p className="text-xs text-slate-500">
              {form.cobro_vencido ? 'Paga al terminar su periodo (debe el mes anterior).' : 'Debe apenas llega su día de cobro.'}
            </p>
          </div>
          <button
            type="button" role="switch" aria-checked={form.cobro_vencido} aria-label="Cobro vencido"
            onClick={() => setForm((f) => ({ ...f, cobro_vencido: !f.cobro_vencido }))}
            className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${form.cobro_vencido ? 'bg-amber-500' : 'bg-slate-600'}`}
          >
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${form.cobro_vencido ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {!editando && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-emerald-100">Ya pagó al registrarse</p>
                <p className="text-xs text-emerald-200/70">Registra el pago y lo deja al día este mes.</p>
              </div>
              <button
                type="button" role="switch" aria-checked={yaPago} aria-label="Ya pagó al registrarse"
                onClick={() => setYaPago((v) => !v)}
                className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer shrink-0 ${yaPago ? 'bg-emerald-500' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${yaPago ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            {yaPago && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pago_monto" className="block text-xs font-medium text-emerald-200 mb-1">Monto pagado</label>
                  <input
                    id="pago_monto" type="number" min="0" step="0.01" value={pagoMonto}
                    onChange={(e) => setPagoMonto(e.target.value)}
                    placeholder={form.monto ? `S/ ${form.monto}` : 'Cuota'}
                    className={`${inputCls} tabular`}
                  />
                </div>
                <div>
                  <label htmlFor="pago_medio" className="block text-xs font-medium text-emerald-200 mb-1">Método</label>
                  <select id="pago_medio" value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)} className={inputCls}>
                    {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {cambioTarifa && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3">
            <label htmlFor="tarifa_desde" className="block text-sm font-medium text-amber-200 mb-1.5">
              La nueva tarifa (S/ {form.monto}) rige desde
            </label>
            <input
              id="tarifa_desde" type="month" value={tarifaDesde}
              onChange={(e) => setTarifaDesde(e.target.value)}
              className={`${inputCls} tabular`}
            />
            <p className="mt-1 text-xs text-amber-200/70">
              Los meses anteriores se cobran a la tarifa vieja (S/ {cliente.monto}); desde este mes, S/ {form.monto}.
            </p>
          </div>
        )}

        {(editando || !yaPago) && (
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
        )}

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

      {editando && Array.isArray(cliente.tarifas) && cliente.tarifas.length > 1 && (
        <div className="mt-6 pt-5 border-t border-slate-700/60">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Historial de tarifas</h3>
          <ul className="space-y-1.5">
            {[...cliente.tarifas]
              .sort((a, b) => String(b.desde).localeCompare(String(a.desde)))
              .map((t, i) => (
                <li key={i} className="flex items-center justify-between text-sm rounded-lg bg-slate-800/50 px-3 py-2">
                  <span className="text-slate-400">
                    {t.desde === '2000-01-01' ? 'Tarifa inicial' : `Desde ${mesLabel(t.desde)}`}
                  </span>
                  <span className="tabular font-semibold text-slate-200">
                    {soles(t.monto)}
                    {t.periodo !== 'MENSUAL' ? ` · ${String(t.periodo).toLowerCase()}` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

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
                    {linkRecibo(cliente, p) && (
                      <a
                        href={linkRecibo(cliente, p)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Enviar recibo por WhatsApp"
                        title="Enviar recibo por WhatsApp"
                        className="grid place-items-center w-8 h-8 rounded-lg text-emerald-300 hover:bg-emerald-500/15 transition-colors cursor-pointer"
                      >
                        <IconWhatsapp width={16} height={16} />
                      </a>
                    )}
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
