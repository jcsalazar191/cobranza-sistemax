import { soles, estadoMeta, linkRecordatorio, periodoMeta, haceDias } from '../lib/ui.js';
import { IconWhatsapp, IconCheck, IconClock } from './Icons.jsx';

export default function ClienteCard({ cliente, onAbrir, onPago, onRecordar, plantillaDeuda, plantillaAldia }) {
  const meta = estadoMeta(cliente.estado);
  const inactivo = !cliente.activo;
  const link = linkRecordatorio(cliente, plantillaDeuda, plantillaAldia);
  const aviso = haceDias(cliente.ultimo_recordatorio);
  // Por vencer: al dia pero solo cubierto hasta este mes.
  const porVencer = cliente.activo && cliente.deuda === 0 && cliente.meses_cobertura === 0;
  // Recordar tiene sentido solo si debe (cobro) o esta por vencer (renovacion).
  // Si esta al dia CON cobertura por delante, no hay nada que recordar.
  const mostrarRecordar = Number(cliente.deuda) > 0 || porVencer;

  // Semestral/anual con deuda: se cobra el periodo completo -> badge del plan en color fuerte
  // (no el "1 MES" amarillo, que se veia leve aunque deba todo el periodo).
  const periodoDebt = cliente.activo && cliente.deuda > 0 && (cliente.periodo === 'SEMESTRAL' || cliente.periodo === 'ANUAL');
  const fuerte = cliente.estado >= 3;
  const chipCls = porVencer
    ? 'bg-amber-500/15 text-amber-300'
    : periodoDebt
      ? (fuerte ? 'bg-red-500/15 text-red-300' : 'bg-orange-500/15 text-orange-300')
      : meta.chip;
  const badgeLabel = porVencer
    ? 'POR VENCER'
    : periodoDebt
      ? `${periodoMeta(cliente.periodo).label.toUpperCase()} VENC.`
      : meta.label;
  const deudaCls = cliente.deuda > 0
    ? (periodoDebt ? (fuerte ? 'text-red-300' : 'text-orange-300') : meta.text)
    : 'text-slate-500';
  const dotCls = periodoDebt ? (fuerte ? 'bg-red-500' : 'bg-orange-400') : meta.dot;
  const ringCls = periodoDebt ? (fuerte ? 'border-red-500/50' : 'border-orange-500/40') : meta.ring;

  return (
    <article
      onClick={() => onAbrir(cliente)}
      className={`rounded-2xl bg-slate-900 border ${ringCls} p-4 cursor-pointer transition-colors hover:bg-slate-800/70
        ${inactivo ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dotCls}`} aria-hidden="true" />
            <h3 className="font-semibold text-slate-100 truncate">{cliente.nombre}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            <span className="tabular">{soles(cliente.monto)}</span>
            <span className="text-slate-600"> / mes</span>
            {cliente.periodo && cliente.periodo !== 'MENSUAL' && !periodoDebt && (
              <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                {periodoMeta(cliente.periodo).label}
              </span>
            )}
            {inactivo && <span className="ml-2 text-[11px] uppercase text-slate-500">inactivo</span>}
          </p>
        </div>

        <div className="text-right shrink-0">
          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${chipCls}`}>
            {badgeLabel}
          </span>
          <p className={`mt-1 tabular text-lg font-bold ${deudaCls}`}>
            {soles(cliente.deuda)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500 flex items-center justify-between gap-2">
        <span>
          Pagado hasta <span className="text-slate-300 capitalize">{cliente.pagado_hasta_label}</span>
          {cliente.meses_cobertura > 0 && (
            <span className="text-slate-600"> · +{cliente.meses_cobertura} mes(es)</span>
          )}
          {Number(cliente.saldo) > 0 && (
            <span className="text-emerald-400/80"> · a cuenta {soles(cliente.saldo)}</span>
          )}
        </span>
        {aviso && (
          <span className="inline-flex items-center gap-1 text-slate-500 shrink-0">
            <IconClock width={12} height={12} /> {aviso}
          </span>
        )}
      </p>

      <div className={`mt-3 grid gap-2 ${mostrarRecordar ? 'grid-cols-2' : 'grid-cols-1'}`} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onPago(cliente)}
          className="h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-sm hover:bg-emerald-400 transition-colors cursor-pointer"
        >
          <IconCheck width={18} height={18} /> Registre pago
        </button>
        {mostrarRecordar && (link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onRecordar?.(cliente)}
            className="h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-800 text-slate-100 font-semibold text-sm border border-slate-700 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <IconWhatsapp width={18} height={18} /> Recordar
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="WhatsApp no valido (9 digitos)"
            className="h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-800/50 text-slate-600 font-semibold text-sm border border-slate-800 cursor-not-allowed"
          >
            <IconWhatsapp width={18} height={18} /> Sin WhatsApp
          </button>
        ))}
      </div>
    </article>
  );
}
