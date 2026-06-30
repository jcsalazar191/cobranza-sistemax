import { useMemo, useState, useRef, useEffect } from 'react';
import Modal from './Modal.jsx';
import { soles, normaliza, estadoMeta } from '../lib/ui.js';
import { IconSearch, IconChevron } from './Icons.jsx';

// Selector rapido de cliente para cobrar. Lista solo activos; al tocar uno -> onElegir.
export default function CobrarPicker({ clientes, onElegir, onClose }) {
  const [busqueda, setBusqueda] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const visibles = useMemo(() => {
    const q = normaliza(busqueda.trim());
    return clientes
      .filter((c) => c.activo)
      .filter((c) => !q || normaliza(c.nombre).includes(q));
    // El backend ya entrega ordenado por deuda desc.
  }, [clientes, busqueda]);

  return (
    <Modal titulo="¿A quién le cobras?" onClose={onClose}>
      <div className="space-y-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true">
            <IconSearch width={18} height={18} />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente..."
            aria-label="Buscar cliente"
            className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          />
        </div>

        {visibles.length === 0 ? (
          <p className="text-center text-slate-500 py-10">Sin clientes para esa búsqueda.</p>
        ) : (
          <ul className="space-y-2 max-h-[55vh] overflow-y-auto -mx-1 px-1">
            {visibles.map((c) => {
              const meta = estadoMeta(c.estado);
              const debe = Number(c.deuda) > 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onElegir(c)}
                    className="w-full flex items-center gap-3 text-left rounded-xl bg-slate-800/60 border border-slate-700/60 px-4 py-3 hover:bg-slate-800 hover:border-slate-600 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.dot}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-100 truncate">{c.nombre}</span>
                      <span className="block text-xs text-slate-500 truncate">
                        Pagado hasta <span className="text-slate-400 capitalize">{c.pagado_hasta_label}</span>
                      </span>
                    </span>
                    <span className={`tabular font-bold shrink-0 ${debe ? meta.text : 'text-slate-500'}`}>
                      {soles(c.deuda)}
                    </span>
                    <span className="text-slate-600 shrink-0" aria-hidden="true">
                      <IconChevron width={18} height={18} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
