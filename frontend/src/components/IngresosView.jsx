import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { soles, MESES_CORTOS, MESES_LARGOS } from '../lib/ui.js';
import { IconChevron } from './Icons.jsx';

export default function IngresosView() {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mesSel, setMesSel] = useState(hoy.getMonth() + 1); // 1-12
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError('');
    api.ingresos(anio)
      .then((d) => { if (vivo) setData(d); })
      .catch((e) => { if (vivo) setError(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [anio]);

  const mes = data?.meses.find((m) => m.mes === mesSel);

  return (
    <div className="space-y-4">
      {/* Navegacion de año */}
      <div className="flex items-center justify-between rounded-xl bg-slate-900/80 border border-slate-700/50 px-3 py-2">
        <button
          type="button"
          onClick={() => setAnio((a) => a - 1)}
          aria-label="Año anterior"
          className="grid place-items-center w-11 h-11 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer rotate-180"
        >
          <IconChevron />
        </button>
        <div className="text-center">
          <p className="text-lg font-bold text-slate-100 tabular">{anio}</p>
          <p className="text-[11px] text-slate-500">
            Total año <span className="tabular text-emerald-300">{soles(data?.total_anio ?? 0)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAnio((a) => a + 1)}
          aria-label="Año siguiente"
          className="grid place-items-center w-11 h-11 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <IconChevron />
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Grilla de 12 meses (cobrado real) */}
      <div className="grid grid-cols-3 gap-2">
        {(data?.meses ?? Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, total: 0, pagos: [] }))).map((m) => {
          const activo = m.mes === mesSel;
          const vacio = m.total === 0;
          return (
            <button
              key={m.mes}
              type="button"
              onClick={() => setMesSel(m.mes)}
              aria-pressed={activo}
              className={`rounded-xl border px-2 py-2.5 text-left transition-colors cursor-pointer
                ${activo
                  ? 'bg-emerald-500/15 border-emerald-500/50'
                  : 'bg-slate-900 border-slate-700/50 hover:bg-slate-800'}`}
            >
              <p className={`text-xs font-semibold ${activo ? 'text-emerald-300' : 'text-slate-300'}`}>
                {MESES_CORTOS[m.mes - 1]}
              </p>
              <p className={`tabular text-sm font-bold ${vacio ? 'text-slate-600' : 'text-slate-100'}`}>
                {soles(m.total)}
              </p>
            </button>
          );
        })}
      </div>

      {/* Detalle del mes seleccionado */}
      <div className="rounded-2xl bg-slate-900 border border-slate-700/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200 capitalize">
            {MESES_LARGOS[mesSel - 1]} {anio}
          </h3>
          <span className="tabular font-bold text-emerald-300">{soles(mes?.total ?? 0)}</span>
        </div>

        {cargando ? (
          <p className="text-sm text-slate-500">Cargando...</p>
        ) : !mes || mes.pagos.length === 0 ? (
          <p className="text-sm text-slate-500">Sin pagos registrados en este mes.</p>
        ) : (
          <ul className="space-y-2">
            {mes.pagos.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm rounded-lg bg-slate-800/50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-slate-200 truncate">{p.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {String(p.fecha).slice(0, 10)} · {p.meses === 0 ? 'abono' : `${p.meses} mes(es)`} · {p.medio}
                    {p.comprobante ? ` · ${p.comprobante}` : ''}
                  </p>
                </div>
                <span className="tabular font-semibold text-emerald-300 shrink-0 ml-2">{soles(p.monto_total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
