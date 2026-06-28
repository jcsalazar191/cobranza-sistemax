// Validaciones simples de inputs. Lanzan Error con .status = 400.

export class ValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.status = 400;
  }
}

export function reqStr(obj, campo, { max = 500 } = {}) {
  const v = obj[campo];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ValidationError(`Campo '${campo}' es obligatorio.`);
  }
  if (v.length > max) throw new ValidationError(`Campo '${campo}' supera ${max} caracteres.`);
  return v.trim();
}

export function optStr(obj, campo, { max = 500 } = {}) {
  const v = obj[campo];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new ValidationError(`Campo '${campo}' debe ser texto.`);
  if (v.length > max) throw new ValidationError(`Campo '${campo}' supera ${max} caracteres.`);
  return v.trim();
}

export function reqWhatsapp(obj, campo = 'whatsapp') {
  const v = String(obj[campo] ?? '').trim();
  if (!/^[0-9]{9}$/.test(v)) {
    throw new ValidationError(`'${campo}' debe tener exactamente 9 digitos (sin +51).`);
  }
  return v;
}

export function reqNum(obj, campo, { min = 0, max = 1e9 } = {}) {
  const v = Number(obj[campo]);
  if (!Number.isFinite(v)) throw new ValidationError(`'${campo}' debe ser numerico.`);
  if (v < min || v > max) throw new ValidationError(`'${campo}' fuera de rango.`);
  return v;
}

export function reqInt(obj, campo, { min, max } = {}) {
  const v = Number(obj[campo]);
  if (!Number.isInteger(v)) throw new ValidationError(`'${campo}' debe ser entero.`);
  if (min !== undefined && v < min) throw new ValidationError(`'${campo}' minimo ${min}.`);
  if (max !== undefined && v > max) throw new ValidationError(`'${campo}' maximo ${max}.`);
  return v;
}

export function reqEnum(obj, campo, valores) {
  const v = obj[campo];
  if (!valores.includes(v)) {
    throw new ValidationError(`'${campo}' debe ser uno de: ${valores.join(', ')}.`);
  }
  return v;
}

export function optEnum(obj, campo, valores, def) {
  const v = obj[campo];
  if (v === undefined || v === null || v === '') return def;
  if (!valores.includes(v)) {
    throw new ValidationError(`'${campo}' debe ser uno de: ${valores.join(', ')}.`);
  }
  return v;
}

// Fecha 'YYYY-MM-DD'.
export function reqFecha(obj, campo) {
  const v = String(obj[campo] ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new ValidationError(`'${campo}' debe ser una fecha YYYY-MM-DD.`);
  }
  return v;
}

export function reqBool(obj, campo, def = true) {
  const v = obj[campo];
  if (v === undefined || v === null) return def;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ValidationError(`'${campo}' debe ser booleano.`);
}
