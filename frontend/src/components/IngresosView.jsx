import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { soles, MESES_CORTOS, MESES_LARGOS } from '../lib/ui.js';
import { IconChevron } from './Icons.jsx';

function GraficoMensual({ titulo, meses, campo, color, formatear, descripcion }) {
  const valores = meses.map((m) => Number(m[campo] || 0));
  const max = Math.max(...valores, 1);
  const ancho = 720;
  const alto = 210;
  const izquierda = 42;
  const base = 168;
  const areaAlto = 142;
  const paso = (ancho - izquierda - 8) / 12;
  const compacta = (n) => {
    if (campo !== 'total') return String(Math.round(n));
    if (n >= 10000) return `S/ ${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `S/ ${(n / 1000).toFixed(1)}k`;
    return `S/ ${Math.round(n)}`;
  };

  return (
    <section className="rounded-2xl bg-slate-900 border border-slate-700/50 p-4" aria-label={titulo}>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-slate-200">{titulo}</h3>
        <p className="text-xs text-slate-500">{descripcion}</p>
      </div>
      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full h-auto" role="img" aria-label={`${titulo}, gráfico de enero a diciembre`}>
          <text x="0" y="31" fill="#64748b" fontSize="11">{compacta(max)}</text>
          <text x="20" y={base + 4} fill="#64748b" fontSize="11">0</text>
          {[0.25, 0.5, 0.75, 1].map((fraccion) => {
            const y = base - areaAlto * fraccion;
            return <line key={fraccion} x1={izquierda} x2={ancho} y1={y} y2={y} stroke="#334155" strokeDasharray="3 5" />;
          })}
          {meses.map((m, i) => {
            const valor = Number(m[campo] || 0);
            const h = (valor / max) * areaAlto;
            const x = izquierda + i * paso + paso * 0.2;
            const w = paso * 0.58;
            return (
              <g key={m.mes}>
                <title>{`${MESES_LARGOS[m.mes - 1]}: ${formatear(valor)}`}</title>
                <rect x={x} y={base - h} width={w} height={Math.max(h, 1)} rx="4" fill={color} opacity={valor ? 0.86 : 0.18} />
                <text x={x + w / 2} y="193" textAnchor="middle" fill="#94a3b8" fontSize="10">{MESES_CORTOS[m.mes - 1]}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

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
  const meses = data?.meses ?? Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, total: 0, altas: 0, pagos: [] }));

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

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Cobrado en {anio}</p>
          <p className="mt-1 text-sm font-bold text-emerald-300 tabular">{soles(data?.total_anio ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Altas en {anio}</p>
          <p className="mt-1 text-sm font-bold text-sky-300 tabular">{data?.total_altas ?? 0}</p>
        </div>
        <div className="rounded-xl bg-slate-900 border border-slate-700/50 px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Activos hoy</p>
          <p className="mt-1 text-sm font-bold text-slate-100 tabular">{data?.clientes_activos ?? '—'}</p>
        </div>
      </div>

      <GraficoMensual
        titulo="Dinero cobrado por mes"
        descripcion="Pagos recibidos en el mes; los planes adelantados pueden concentrar varios meses en un solo cobro."
        meses={meses} campo="total" color="#34d399" formatear={soles}
      />
      <GraficoMensual
        titulo="Nuevos clientes por mes"
        descripcion="Altas según la fecha de registro. El total de activos se muestra aparte porque no hay historial de bajas."
        meses={meses} campo="altas" color="#38bdf8" formatear={(n) => `${n} cliente${n === 1 ? '' : 's'}`}
      />

      {/* Selección de mes para consultar el detalle */}
      <div className="grid grid-cols-3 gap-2">
        {meses.map((m) => {
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
