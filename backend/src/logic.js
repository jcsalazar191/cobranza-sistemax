// Logica de deuda. Trabaja a nivel de mes (ignora el dia).

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Indice de mes absoluto (anio*12 + mes) a partir de un Date.
function indiceMes(d) {
  return d.getFullYear() * 12 + d.getMonth();
}

// Normaliza una fecha (Date o 'YYYY-MM-DD') al dia 1 de su mes, en hora local.
export function aPrimerDiaMes(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(`${fecha}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Suma n meses a una fecha (devuelve dia 1 del mes resultante).
export function sumarMeses(fecha, n) {
  const d = aPrimerDiaMes(fecha);
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// 'YYYY-MM-DD' (dia 1) para guardar en la BD.
export function aISODia1(fecha) {
  const d = aPrimerDiaMes(fecha);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-01`;
}

// Etiqueta legible: "junio 2026".
export function etiquetaMes(fecha) {
  const d = aPrimerDiaMes(fecha);
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

// Se cobra POR ADELANTADO con plazo hasta el dia 10 de cada mes.
// Hasta el dia 10 el mes en curso todavia esta "en plazo" (no vencido).
export const DIA_GRACIA = 10;

// Meses que debe un cliente.
// pagado_hasta cubre HASTA ese mes inclusive. El "mes objetivo" (ultimo mes que
// ya debio estar pagado) es el mes actual, salvo que estemos dentro del plazo
// (dia <= DIA_GRACIA), en cuyo caso el mes en curso aun no cuenta y el objetivo
// es el mes anterior.
export function mesesDebe(pagadoHasta, hoy = new Date(), diaGracia = DIA_GRACIA) {
  const ph = aPrimerDiaMes(pagadoHasta);
  const objetivo = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  if (hoy.getDate() <= diaGracia) {
    objetivo.setMonth(objetivo.getMonth() - 1);
  }
  const diff = indiceMes(objetivo) - indiceMes(ph);
  return diff > 0 ? diff : 0;
}

// Estado: 0 al dia, 1, 2, 3 (=3 o mas, critico).
export function estado(meses) {
  if (meses <= 0) return 0;
  if (meses >= 3) return 3;
  return meses;
}

// Meses de cobertura por delante: cuantos meses (>=0) le quedan cubiertos
// contando desde el mes actual. 0 = solo cubre el mes en curso (vence pronto).
export function mesesCobertura(pagadoHasta, hoy = new Date()) {
  const ph = aPrimerDiaMes(pagadoHasta);
  const actual = aPrimerDiaMes(hoy);
  const diff = indiceMes(ph) - indiceMes(actual);
  return diff > 0 ? diff : 0;
}

// Planes que se cobran por PERIODO completo con descuento (semestral/anual).
const PLAN_PERIODO = {
  SEMESTRAL: { meses: 6, descuento: 1 },
  ANUAL: { meses: 12, descuento: 2 },
};

// Enriquece una fila de cliente con deuda/estado calculados.
export function enriquecerCliente(c, hoy = new Date()) {
  const debe = mesesDebe(c.pagado_hasta, hoy);
  const monto = Number(c.monto);
  const plan = PLAN_PERIODO[c.periodo];

  let deuda; let mesesAPagar;
  if (plan && debe > 0) {
    // Semestral/anual: al vencerse, se cobra el/los periodo(s) completo(s) con descuento.
    const periodos = Math.ceil(debe / plan.meses);
    mesesAPagar = periodos * plan.meses;                  // meses que cubre la regularizacion
    deuda = Number((periodos * (plan.meses - plan.descuento) * monto).toFixed(2));
  } else {
    // Mensual/trimestral: mes a mes.
    mesesAPagar = debe;
    deuda = Number((debe * monto).toFixed(2));
  }

  return {
    ...c,
    monto,
    meses_debe: debe,           // meses vencidos reales (urgencia / color)
    meses_a_pagar: mesesAPagar, // meses que cubre la deuda (para listar en el mensaje)
    deuda,
    estado: estado(debe),
    meses_cobertura: mesesCobertura(c.pagado_hasta, hoy),
    pagado_hasta_label: etiquetaMes(c.pagado_hasta),
  };
}
