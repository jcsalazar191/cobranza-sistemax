import { IconSearch } from './Icons.jsx';

export const FILTROS = [
  { key: 'todos',     label: 'Todos' },
  { key: 'morosos',   label: 'Morosos' },
  { key: 'criticos',  label: 'Criticos' },
  { key: 'porvencer', label: 'Por vencer' },
  { key: 'aldia',     label: 'Al dia' },
  { key: 'inactivos', label: 'Inactivos' },
];

export default function Filtros({ busqueda, onBusqueda, filtro, onFiltro, conteos }) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
          <IconSearch />
        </span>
        <input
          type="search"
          inputMode="search"
          value={busqueda}
          onChange={(e) => onBusqueda(e.target.value)}
          placeholder="Buscar por nombre..."
          aria-label="Buscar cliente por nombre"
          className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-900 border border-slate-700/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 focus:border-transparent"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        {FILTROS.map((f) => {
          const activo = filtro === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onFiltro(f.key)}
              aria-pressed={activo}
              className={`shrink-0 h-9 px-3.5 rounded-full text-sm font-medium border transition-colors cursor-pointer
                ${activo
                  ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                  : 'bg-slate-900 text-slate-300 border-slate-700/60 hover:bg-slate-800'}`}
            >
              {f.label}
              {conteos?.[f.key] !== undefined && (
                <span className={`ml-1.5 tabular text-xs ${activo ? 'text-slate-900/70' : 'text-slate-500'}`}>
                  {conteos[f.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
