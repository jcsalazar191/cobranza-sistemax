import { useState } from 'react';
import Modal from './Modal.jsx';
import { IconLock } from './Icons.jsx';

// Perfil: configurar el PIN de acceso de 4 digitos (bloqueo rapido al abrir la app).
export default function PerfilModal({ email, pinActivo, diaGracia, onClose, onGuardarPin, onGuardarDiaGracia }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [dg, setDg] = useState(diaGracia || 10);
  const [guardandoDg, setGuardandoDg] = useState(false);
  const [dgMsg, setDgMsg] = useState('');

  async function guardarDg() {
    const n = Number(dg);
    if (!Number.isInteger(n) || n < 1 || n > 28) { setDgMsg('Debe ser entre 1 y 28.'); return; }
    setDgMsg(''); setGuardandoDg(true);
    try { await onGuardarDiaGracia(n); setDgMsg('Guardado ✓'); } catch (e) { setDgMsg(e.message); } finally { setGuardandoDg(false); }
  }

  const soloDigitos = (v) => v.replace(/\D/g, '').slice(0, 4);

  async function guardar(e) {
    e.preventDefault();
    setError(''); setMsg('');
    if (!/^\d{4}$/.test(pin)) { setError('El PIN debe tener 4 dígitos.'); return; }
    if (pin !== pin2) { setError('Los dos PIN no coinciden.'); return; }
    setGuardando(true);
    try {
      await onGuardarPin(pin);
      setMsg('PIN guardado. Se pedirá al abrir la app.');
      setPin(''); setPin2('');
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  }

  async function quitar() {
    if (!confirm('¿Quitar el PIN? Cualquiera con la sesión abierta entrará sin PIN.')) return;
    setError(''); setMsg('');
    setGuardando(true);
    try {
      await onGuardarPin('');
      setMsg('PIN quitado.');
      setPin(''); setPin2('');
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  }

  const inputCls = 'w-full h-14 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-center text-2xl tracking-[0.4em] tabular focus:outline-none focus:ring-2 focus:ring-emerald-500/60';

  return (
    <Modal
      titulo="Perfil"
      onClose={onClose}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-12 rounded-xl bg-slate-800 text-slate-200 font-medium hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
          <button
            type="submit"
            form="form-perfil"
            disabled={guardando}
            className="flex-1 h-12 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : (pinActivo ? 'Cambiar PIN' : 'Activar PIN')}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        {email && (
          <div className="text-sm">
            <span className="text-slate-500">Cuenta:</span>{' '}
            <span className="text-slate-200">{email}</span>
          </div>
        )}

        <div className="rounded-xl bg-slate-800/60 border border-slate-700/60 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-slate-200">Día de cobro por defecto</p>
          <p className="text-xs text-slate-500">
            Se usa como día de cobro al crear clientes NUEVOS. Cada cliente tiene su propio día (editable en su ficha); en ese día vence su mes.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number" min="1" max="28" inputMode="numeric"
              value={dg} onChange={(e) => setDg(e.target.value)}
              className="w-20 h-11 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-center tabular focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            />
            <button
              type="button" onClick={guardarDg} disabled={guardandoDg}
              className="h-11 px-4 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-sm hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-60"
            >
              {guardandoDg ? 'Guardando...' : 'Guardar'}
            </button>
            {dgMsg && <span className="text-xs text-slate-400">{dgMsg}</span>}
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl bg-slate-800/60 border border-slate-700/60 px-4 py-3">
          <span className="text-emerald-400 mt-0.5"><IconLock width={20} height={20} /></span>
          <div>
            <p className="text-sm font-medium text-slate-200">
              PIN de acceso {pinActivo ? '· activo' : '· desactivado'}
            </p>
            <p className="text-xs text-slate-500">
              Un PIN de 4 dígitos que se pide cada vez que abres la app, aunque la sesión siga activa. Ideal si prestas el celular.
            </p>
          </div>
        </div>

        <form id="form-perfil" onSubmit={guardar} className="space-y-3">
          <div>
            <label htmlFor="pin1" className="block text-sm font-medium text-slate-300 mb-1.5">
              {pinActivo ? 'Nuevo PIN' : 'PIN'} (4 dígitos)
            </label>
            <input
              id="pin1" type="password" inputMode="numeric" autoComplete="off"
              value={pin} onChange={(e) => setPin(soloDigitos(e.target.value))}
              placeholder="••••" className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="pin2" className="block text-sm font-medium text-slate-300 mb-1.5">Repetir PIN</label>
            <input
              id="pin2" type="password" inputMode="numeric" autoComplete="off"
              value={pin2} onChange={(e) => setPin2(soloDigitos(e.target.value))}
              placeholder="••••" className={inputCls}
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        </form>

        {pinActivo && (
          <button
            type="button"
            onClick={quitar}
            disabled={guardando}
            className="w-full h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-60"
          >
            Quitar PIN
          </button>
        )}
      </div>
    </Modal>
  );
}
