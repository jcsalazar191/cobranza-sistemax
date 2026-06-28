import { useState } from 'react';
import Modal from './Modal.jsx';
import { IconDownload } from './Icons.jsx';

// Parser CSV simple (soporta comillas dobles y comas dentro de comillas).
function parseCSV(texto) {
  const filas = [];
  const lineas = texto.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lineas.length === 0) return [];
  const split = (linea) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < linea.length; i += 1) {
      const ch = linea[i];
      if (ch === '"') { if (q && linea[i + 1] === '"') { cur += '"'; i += 1; } else q = !q; }
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lineas[0]).map((h) => h.toLowerCase());
  for (let i = 1; i < lineas.length; i += 1) {
    const cols = split(lineas[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] ?? ''; });
    filas.push(obj);
  }
  return filas;
}

export default function DatosModal({ onClose, exportUrl, onImportRespaldo, onImportClientes, onTerminado }) {
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function restaurarJSON(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setMsg('');
    if (!confirm('Restaurar REEMPLAZA todos los datos actuales por los del respaldo. ¿Continuar?')) return;
    setOcupado(true);
    try {
      const data = JSON.parse(await file.text());
      const r = await onImportRespaldo(data);
      setMsg(`Restaurado: ${r.clientes} clientes, ${r.pagos} pagos.`);
      await onTerminado();
    } catch (err) {
      setError(`No se pudo restaurar: ${err.message}`);
    } finally {
      setOcupado(false);
    }
  }

  async function importarCSV(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setMsg('');
    setOcupado(true);
    try {
      const filas = parseCSV(await file.text());
      if (filas.length === 0) throw new Error('El archivo no tiene filas.');
      const r = await onImportClientes(filas);
      let t = `Actualizados: ${r.actualizados}, nuevos: ${r.insertados}.`;
      if (r.omitidos?.length) t += ` Omitidos: ${r.omitidos.length} (revisa nombre/whatsapp/pagado_hasta).`;
      setMsg(t);
      await onTerminado();
    } catch (err) {
      setError(`No se pudo importar: ${err.message}`);
    } finally {
      setOcupado(false);
    }
  }

  const fileBtn = 'block w-full text-center h-12 leading-[3rem] rounded-xl bg-slate-800 border border-slate-700 text-slate-100 font-medium hover:bg-slate-700 transition-colors cursor-pointer';

  return (
    <Modal titulo="Datos y respaldo" onClose={onClose}>
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold text-slate-200 mb-1">Respaldo</h3>
          <p className="text-xs text-slate-500 mb-2">Descarga un JSON con clientes, pagos, mensajes y avisos.</p>
          <a
            href={exportUrl}
            className="inline-flex w-full items-center justify-center gap-2 h-12 rounded-xl bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 transition-colors cursor-pointer"
          >
            <IconDownload width={18} height={18} /> Descargar respaldo
          </a>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-200 mb-1">Restaurar respaldo</h3>
          <p className="text-xs text-slate-500 mb-2">Sube un JSON de respaldo. <span className="text-red-300">Reemplaza todo.</span></p>
          <label className={fileBtn}>
            Elegir archivo JSON
            <input type="file" accept="application/json,.json" onChange={restaurarJSON} disabled={ocupado} className="hidden" />
          </label>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-200 mb-1">Importar clientes (CSV)</h3>
          <p className="text-xs text-slate-500 mb-2">
            Actualiza por <b>nombre</b> (o crea nuevos). Exporta tu Excel a CSV con columnas:
            <span className="font-mono text-slate-400"> nombre, whatsapp, monto, dia_cobro, pagado_hasta, periodo, activo</span>.
            Solo <span className="font-mono">nombre</span> es obligatorio; el resto opcional. <span className="font-mono">pagado_hasta</span> en formato <span className="font-mono">2026-04</span>.
          </p>
          <label className={fileBtn}>
            Elegir archivo CSV
            <input type="file" accept=".csv,text/csv" onChange={importarCSV} disabled={ocupado} className="hidden" />
          </label>
        </section>

        {ocupado && <p className="text-sm text-slate-400">Procesando...</p>}
        {msg && <p className="text-sm text-emerald-300">{msg}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
