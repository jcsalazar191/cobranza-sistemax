// Helpers de presentacion compartidos.

const fmt = new Intl.NumberFormat('es-PE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// "S/ 1,234.00"
export function soles(n) {
  return `S/ ${fmt.format(Number(n) || 0)}`;
}

// Metadatos visuales por estado de deuda.
export const ESTADOS = {
  0: { label: 'AL DIA',   dot: 'bg-emerald-400', text: 'text-emerald-300', ring: 'border-emerald-500/30', chip: 'bg-emerald-500/15 text-emerald-300' },
  1: { label: '1 MES',    dot: 'bg-amber-400',   text: 'text-amber-300',   ring: 'border-amber-500/30',   chip: 'bg-amber-500/15 text-amber-300' },
  2: { label: '2 MESES',  dot: 'bg-orange-400',  text: 'text-orange-300',  ring: 'border-orange-500/40',  chip: 'bg-orange-500/15 text-orange-300' },
  3: { label: 'CRITICO',  dot: 'bg-red-500',     text: 'text-red-300',     ring: 'border-red-500/50',     chip: 'bg-red-500/15 text-red-300' },
};

export function estadoMeta(estado) {
  return ESTADOS[estado] ?? ESTADOS[0];
}

// "junio 2026" -> ya viene calculado del backend como pagado_hasta_label.

// Convierte la fecha ISO de pagado_hasta a "YYYY-MM" para <input type="month">.
export function aMonthInput(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 7);
}

// Plantillas por defecto (fallback si el backend no responde).
export const PLANTILLA_DEFAULT =
  'Hola {nombre}, le recordamos su pago pendiente de S/ {deuda}, correspondiente a {rango_meses}. Gracias.';
export const PLANTILLA_ALDIA_DEFAULT =
  'Hola {nombre}, su servicio esta cubierto hasta {cubierto}. Le recordamos su proxima renovacion. Gracias.';

// Lista legible de los meses que el cliente debe, a partir de pagado_hasta + meses_debe.
// Ej: "marzo, abril y mayo de 2026" (o con año por mes si cruza de año).
export function mesesAdeudados(pagadoHastaIso, mesesDebe) {
  const n = Number(mesesDebe) || 0;
  if (!pagadoHastaIso || n <= 0) return '';
  const ym = String(pagadoHastaIso).slice(0, 7); // 'YYYY-MM' del ultimo mes cubierto
  const [y, m] = ym.split('-').map(Number);
  const items = [];
  for (let i = 1; i <= n; i += 1) {
    const d = new Date(y, (m - 1) + i, 1);
    items.push({ nombre: MESES_LARGOS[d.getMonth()], anio: d.getFullYear() });
  }
  const unSoloAnio = items.every((x) => x.anio === items[0].anio);
  const partes = items.map((x) => (unSoloAnio ? x.nombre : `${x.nombre} de ${x.anio}`));
  const ultimo = partes.pop();
  const lista = partes.length ? `${partes.join(', ')} y ${ultimo}` : ultimo;
  return unSoloAnio ? `${lista} de ${items[0].anio}` : lista;
}

// Rango "mes inicio a mes fin de año" de los meses adeudados.
// Ej: "marzo a agosto de 2026"  |  cruza año: "junio de 2026 a mayo de 2027"  |  1 mes: "junio de 2026".
export function rangoMeses(pagadoHastaIso, mesesDebe) {
  const n = Number(mesesDebe) || 0;
  if (!pagadoHastaIso || n <= 0) return '';
  const [y, m] = String(pagadoHastaIso).slice(0, 7).split('-').map(Number);
  const ini = new Date(y, (m - 1) + 1, 1);
  const fin = new Date(y, (m - 1) + n, 1);
  const ni = MESES_LARGOS[ini.getMonth()];
  const nf = MESES_LARGOS[fin.getMonth()];
  if (n === 1) return `${ni} de ${ini.getFullYear()}`;
  if (ini.getFullYear() === fin.getFullYear()) return `${ni} a ${nf} de ${ini.getFullYear()}`;
  return `${ni} de ${ini.getFullYear()} a ${nf} de ${fin.getFullYear()}`;
}

// Reemplaza los placeholders de la plantilla con los datos del cliente.
export function aplicarPlantilla(template, cliente) {
  const deudaFmt = fmt.format(Number(cliente.deuda) || 0);
  const montoFmt = fmt.format(Number(cliente.monto) || 0);
  return (template || PLANTILLA_DEFAULT)
    .replaceAll('{nombre}', cliente.nombre ?? '')
    .replaceAll('{deuda}', deudaFmt)
    .replaceAll('{meses}', String(cliente.meses_debe ?? 0))
    .replaceAll('{meses_lista}', mesesAdeudados(cliente.pagado_hasta, cliente.meses_a_pagar ?? cliente.meses_debe))
    .replaceAll('{rango_meses}', rangoMeses(cliente.pagado_hasta, cliente.meses_a_pagar ?? cliente.meses_debe))
    .replaceAll('{monto}', montoFmt)
    .replaceAll('{periodo}', periodoMeta(cliente.periodo).corto)
    .replaceAll('{cubierto}', cliente.pagado_hasta_label ?? '');
}

// Link de WhatsApp. Elige automaticamente la plantilla:
// - debe (deuda > 0)  -> plantillaDeuda
// - al dia (deuda = 0) -> plantillaAldia (recordatorio de proximo pago)
// Devuelve null si el whatsapp no es valido (9 digitos).
export function linkRecordatorio(cliente, plantillaDeuda, plantillaAldia) {
  if (!/^\d{9}$/.test(String(cliente.whatsapp ?? ''))) return null;
  const debe = (Number(cliente.deuda) || 0) > 0;
  const tpl = debe ? plantillaDeuda : (plantillaAldia ?? plantillaDeuda);
  const msg = aplicarPlantilla(tpl, cliente);
  return `https://wa.me/51${cliente.whatsapp}?text=${encodeURIComponent(msg)}`;
}

// Normaliza texto para buscar: minusculas y sin tildes/diacriticos (Ñ -> n).
export function normaliza(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// "hace X dias" a partir de una fecha ISO (o null).
export function haceDias(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} dias`;
}

export const PLACEHOLDERS_DEUDA = ['{nombre}', '{deuda}', '{meses}', '{rango_meses}', '{meses_lista}', '{monto}', '{periodo}'];
export const PLACEHOLDERS_ALDIA = ['{nombre}', '{cubierto}', '{monto}', '{periodo}'];

export const MEDIOS = ['EFECTIVO', 'BCP', 'BN', 'YAPE'];
export const MESES_OPCIONES = [1, 3, 6, 12];

// Plan habitual del cliente. Solo sugiere los meses por defecto al registrar un
// pago; NO es restriccion (un cliente puede pagar mensual y luego un semestre).
export const PERIODOS = [
  { key: 'MENSUAL',    label: 'Mensual',    corto: 'mensual',    meses: 1 },
  { key: 'TRIMESTRAL', label: 'Trimestral', corto: 'trimestral', meses: 3 },
  { key: 'SEMESTRAL',  label: 'Semestral',  corto: 'semestral',  meses: 6 },
  { key: 'ANUAL',      label: 'Anual',      corto: 'anual',      meses: 12 },
];

export function periodoMeta(key) {
  return PERIODOS.find((p) => p.key === key) ?? PERIODOS[0];
}

// Descuento por pago adelantado: semestral (6m) = 1 mes gratis, anual (12m) = 2 meses gratis.
export const DESCUENTO_MESES = { 6: 1, 12: 2 };

// Meses que se cobran (con descuento) para una cantidad de meses cubiertos.
export function mesesCobrados(meses) {
  return meses - (DESCUENTO_MESES[meses] || 0);
}

// Monto sugerido de un pago de N meses, ya con el descuento aplicado.
export function montoSugerido(meses, monto) {
  return Number((mesesCobrados(meses) * (Number(monto) || 0)).toFixed(2));
}

export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
