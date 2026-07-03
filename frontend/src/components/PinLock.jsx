import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { IconLock, IconBackspace } from './Icons.jsx';

// Bloqueo por PIN de 4 digitos sobre la sesion. Se muestra al abrir la app.
export default function PinLock({ onOk, onSalir }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [verificando, setVerificando] = useState(false);

  const verificar = useCallback(async (valor) => {
    setVerificando(true);
    try {
      const r = await api.verificarPin(valor);
      if (r?.ok) { onOk(); return; }
    } catch { /* red: trata como incorrecto */ }
    setError(true);
    setVerificando(false);
    setTimeout(() => { setPin(''); setError(false); }, 450);
  }, [onOk]);

  const agregar = useCallback((d) => {
    if (verificando) return;
    setPin((p) => {
      if (p.length >= 4) return p;
      const np = p + d;
      if (np.length === 4) verificar(np);
      return np;
    });
  }, [verificar, verificando]);

  const borrar = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  // Teclado fisico (numeros + backspace).
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) agregar(e.key);
      else if (e.key === 'Backspace') borrar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agregar, borrar]);

  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="min-h-dvh grid place-items-center bg-slate-950 px-6">
      <div className="w-full max-w-xs text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700/60 grid place-items-center text-emerald-400 mb-5">
          <IconLock width={24} height={24} />
        </div>
        <h1 className="text-lg font-semibold text-slate-100">Ingresa tu PIN</h1>
        <p className="text-xs text-slate-500 mt-1">4 dígitos para entrar</p>

        <div
          className="flex justify-center gap-4 my-8"
          style={error ? { animation: 'shake 0.45s' } : undefined}
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-colors duration-150 ${
                error ? 'bg-red-500' : i < pin.length ? 'bg-emerald-400' : 'bg-slate-700'
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {teclas.map((t, i) => (t === '' ? (
            <span key={i} aria-hidden="true" />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => (t === 'del' ? borrar() : agregar(t))}
              aria-label={t === 'del' ? 'Borrar' : t}
              className="h-16 grid place-items-center rounded-2xl bg-slate-900 border border-slate-700/60 text-2xl font-semibold text-slate-100 tabular hover:bg-slate-800 transition-[background-color,transform] active:scale-[0.96] cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
              disabled={verificando}
            >
              {t === 'del' ? <IconBackspace width={22} height={22} /> : t}
            </button>
          )))}
        </div>

        {onSalir && (
          <button
            type="button"
            onClick={onSalir}
            className="mt-7 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
          >
            Salir y usar contraseña
          </button>
        )}
      </div>
    </div>
  );
}
