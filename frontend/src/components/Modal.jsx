import { useEffect } from 'react';
import { IconClose } from './Icons.jsx';

// Modal mobile-first: hoja inferior en movil, centrado en pantallas grandes.
export default function Modal({ titulo, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700/60 rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-slate-100">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid place-items-center w-11 h-11 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconClose />
          </button>
        </header>

        <div className="px-5 py-4 overflow-y-auto">{children}</div>

        {footer && (
          <footer className="px-5 py-4 border-t border-slate-700/60 flex gap-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
