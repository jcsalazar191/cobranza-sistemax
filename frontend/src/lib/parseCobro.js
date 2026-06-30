// Parser determinista (reglas/regex) para el chat de cobranza.
// Entrada: texto libre ("Juan me pago 50 soles hoy por marzo") + lista de clientes.
// Salida: borrador de pago para pre-llenar el PagoModal, con `faltantes` cuando
// algo no se pudo deducir (cliente ambiguo / sin monto).

import { normaliza, MESES_LARGOS, MEDIOS } from './ui.js';

// Numeros en palabras (es) frecuentes al dictar un monto. Suficiente para montos comunes.
const PALABRAS_NUM = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14,
  quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiuno: 21, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200,
  trescientos: 300, cuatrocientos: 400, quinientos: 500, mil: 1000,
};

// Fecha local YYYY-MM-DD (no UTC) para no correr el dia de noche en Peru.
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function detectaMonto(texto, raw) {
  // 1) "S/ 50" o "50 soles" / "50 sol" -> prioridad alta.
  let m = raw.match(/s\/\s*(\d+(?:[.,]\d{1,2})?)/i)
       || texto.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:soles|sol)\b/);
  if (m) return Number(m[1].replace(',', '.'));

  // 2) Numero en palabras seguido (o no) de "soles": "cincuenta soles".
  const palabras = texto.split(/\s+/);
  for (let i = 0; i < palabras.length; i += 1) {
    if (PALABRAS_NUM[palabras[i]] !== undefined) {
      let val = PALABRAS_NUM[palabras[i]];
      // compuestos simples: "cincuenta y cinco", "ciento veinte"
      if (palabras[i + 1] === 'y' && PALABRAS_NUM[palabras[i + 2]] !== undefined) {
        val += PALABRAS_NUM[palabras[i + 2]];
      } else if (PALABRAS_NUM[palabras[i + 1]] !== undefined && val >= 100) {
        val += PALABRAS_NUM[palabras[i + 1]];
      }
      return val;
    }
  }

  // 3) Fallback: cualquier numero "suelto" que no sea un dia ("el 15") ni meses ("3 meses").
  for (const mm of texto.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)) {
    const s = mm[1];
    const idx = mm.index;
    const antes = texto.slice(Math.max(0, idx - 6), idx);
    const despues = texto.slice(idx + s.length, idx + s.length + 6);
    if (/\b(el|dia)\s*$/.test(antes)) continue; // es un dia del mes
    if (/^\s*mes/.test(despues)) continue;      // "3 meses" no es el monto
    return Number(s.replace(',', '.'));
  }
  return null;
}

function detectaCliente(texto, clientes) {
  const activos = clientes.filter((c) => c.activo);
  const hits = [];
  for (const c of activos) {
    const nom = normaliza(c.nombre);
    const primer = nom.split(/\s+/)[0];
    if (nom && texto.includes(nom)) hits.push({ c, score: nom.length + 5 }); // match nombre completo
    else if (primer && primer.length >= 3 && new RegExp(`\\b${primer}\\b`).test(texto)) {
      hits.push({ c, score: primer.length });
    }
  }
  if (hits.length === 0) return { cliente: null, ambiguo: false };
  hits.sort((a, b) => b.score - a.score);
  // Ambiguo solo si hay empate de score entre clientes distintos.
  const ambiguo = hits.length > 1 && hits[1].score === hits[0].score && hits[1].c.id !== hits[0].c.id;
  return { cliente: ambiguo ? null : hits[0].c, ambiguo };
}

function detectaMeses(texto) {
  if (/\b(abono|parcial|adelanto)\b/.test(texto)) return { meses: 0, abono: true };

  const nMeses = texto.match(/(\d+)\s*mes/);
  if (nMeses) return { meses: Math.min(60, Number(nMeses[1])), abono: false };

  if (/\b(anual|un año|el año|por el año)\b/.test(texto)) return { meses: 12, abono: false };
  if (/\b(semestr)/.test(texto)) return { meses: 6, abono: false };
  if (/\b(trimestr)/.test(texto)) return { meses: 3, abono: false };
  if (/\bmensual\b/.test(texto)) return { meses: 1, abono: false };

  // Cuenta meses nombrados: "marzo y abril" -> 2.
  const nombrados = MESES_LARGOS.filter((mes) => new RegExp(`\\b${mes}\\b`).test(texto)).length;
  if (nombrados > 0) return { meses: nombrados, abono: false };

  return { meses: null, abono: false }; // el caller aplica el default del periodo
}

function detectaFecha(texto) {
  const hoy = new Date();
  if (/\bayer\b/.test(texto)) {
    const d = new Date(hoy); d.setDate(d.getDate() - 1); return isoLocal(d);
  }
  if (/\banteayer\b/.test(texto)) {
    const d = new Date(hoy); d.setDate(d.getDate() - 2); return isoLocal(d);
  }
  // "el 15" / "dia 15" -> dia de este mes.
  const dia = texto.match(/\b(?:el|dia)\s+(\d{1,2})\b/);
  if (dia) {
    const n = Number(dia[1]);
    if (n >= 1 && n <= 31) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth(), n);
      return isoLocal(d);
    }
  }
  return null; // "hoy" o sin dato -> el PagoModal usa la fecha de hoy
}

function detectaMedio(texto) {
  if (/\byape\b/.test(texto)) return 'YAPE';
  if (/\bbcp\b|credito\b/.test(texto)) return 'BCP';
  if (/\bbn\b|nacion\b|banco de la nacion\b/.test(texto)) return 'BN';
  if (/\befectivo\b|cash\b|en mano\b/.test(texto)) return 'EFECTIVO';
  return null; // sin dato -> default EFECTIVO en el PagoModal
}

// Devuelve { cliente, monto, meses, abono, fecha, medio, faltantes: [] }.
// Los campos no mencionados quedan en null para que el caller pueda acumular
// datos entre mensajes y el PagoModal aplique sus defaults.
export function parseCobro(raw, clientes) {
  const texto = normaliza(raw || '');
  const { cliente, ambiguo } = detectaCliente(texto, clientes);
  const monto = detectaMonto(texto, raw || '');
  const { meses, abono } = detectaMeses(texto);
  const fecha = detectaFecha(texto);
  const medio = detectaMedio(texto);

  const faltantes = [];
  if (!cliente) faltantes.push(ambiguo ? 'cliente_ambiguo' : 'cliente');
  if (!(monto > 0)) faltantes.push('monto');

  return {
    cliente,
    monto: monto > 0 ? monto : null,
    meses, // null = no especificado
    abono,
    fecha, // null = no especificado (hoy)
    medio, // null = no especificado (EFECTIVO)
    faltantes,
  };
}

// Asegura que MEDIOS quede referenciado (validacion de medio en el caller).
export const MEDIOS_VALIDOS = MEDIOS;
