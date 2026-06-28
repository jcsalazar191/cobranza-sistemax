import { soles, MESES_CORTOS } from '../lib/ui.js';

function Kpi({ label, valor, tono = 'slate', sub }) {
  const tonos = {
    red: 'text-red-300',
    orange: 'text-orange-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    slate: 'text-slate-100',
  };
  return (
    <div className="rounded-xl bg-slate-900/80 border border-slate-700/50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</p>
      <p className={`mt-1 tabular text-xl font-semibold ${tonos[tono]}`}>{valor}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Resumen({ resumen }) {
  if (!resumen) return null;
  const mesCorto = MESES_CORTOS[new Date().getMonth()];
  return (
    <section className="grid grid-cols-2 gap-3" aria-label="Resumen general">
      <Kpi label="Deuda total" valor={soles(resumen.deuda_total)} tono="red" />
      <Kpi
        label={`Cobrado ${mesCorto}`}
        valor={soles(resumen.cobrado_mes_actual ?? 0)}
        tono="emerald"
        sub={`Esperado ${soles(resumen.ingreso_mensual)} · ${resumen.total_activos} activos`}
      />
      <Kpi label="Morosos" valor={resumen.morosos} tono="amber" />
      <Kpi label="Criticos" valor={resumen.criticos} tono="orange" />
    </section>
  );
}
