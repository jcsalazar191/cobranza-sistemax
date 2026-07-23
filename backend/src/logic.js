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

// Se cobra POR ADELANTADO con plazo hasta un "dia de gracia" de cada mes.
// Hasta ese dia (inclusive) el mes en curso todavia esta "en plazo" (no vencido).
// Es CONFIGURABLE desde Perfil (se guarda en config y se sincroniza aca).
let diaGraciaActual = Number(process.env.DIA_GRACIA) > 0 ? Number(process.env.DIA_GRACIA) : 10;
export function getDiaGracia() { return diaGraciaActual; }
export function setDiaGracia(n) {
  const v = Number(n);
  if (Number.isInteger(v) && v >= 1 && v <= 28) diaGraciaActual = v;
}

// Meses que debe un cliente, usando SU dia de cobro (cada cliente tiene el suyo).
// - Adelantado (lo normal): en su dia de cobro el mes en curso YA vence; antes de
//   ese dia todavia no cuenta.
// - Vencido (paga al final del periodo): debe el periodo anterior (un mes atras).
export function mesesDebe(pagadoHasta, hoy = new Date(), diaCobro = 1, cobroVencido = false) {
  const ph = aPrimerDiaMes(pagadoHasta);
  const dia = Number(diaCobro) >= 1 && Number(diaCobro) <= 31 ? Number(diaCobro) : 1;
  const objetivo = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  if (hoy.getDate() < dia) objetivo.setMonth(objetivo.getMonth() - 1); // aun no llega su dia
  if (cobroVencido) objetivo.setMonth(objetivo.getMonth() - 1);        // paga al final
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

// "Bloque" de cobertura que se compra de una: cuantos meses avanza y cuanto cuesta.
// Mensual/trimestral = mes a mes (1 mes = 1 cuota). Semestral/anual = el periodo
// completo con descuento (semestral: 5 cuotas por 6 meses; anual: 10 por 12).
export function bloquePlan(periodo, monto) {
  const m = Number(monto) || 0;
  const plan = PLAN_PERIODO[periodo];
  if (plan) return { meses: plan.meses, costo: Number(((plan.meses - plan.descuento) * m).toFixed(2)) };
  return { meses: 1, costo: Number(m.toFixed(2)) }; // MENSUAL / TRIMESTRAL
}

// Modelo "saldo a favor": el dinero total pagado se convierte en bloques completos
// de cobertura; lo que no alcanza un bloque queda como saldo (baja la deuda S/ por S/).
// Devuelve cuantos meses avanza la cobertura y el saldo restante.
export function convertirSaldo(periodo, monto, dinero) {
  const { meses, costo } = bloquePlan(periodo, monto);
  let rem = Number(dinero) || 0;
  if (costo <= 0) return { mesesAvance: 0, saldo: Number(rem.toFixed(2)) };
  let av = 0;
  while (rem >= costo) { rem -= costo; av += meses; }
  return { mesesAvance: av, saldo: Number(rem.toFixed(2)) };
}

// Recalcula cobertura (pagado_hasta) y saldo desde el dinero total pagado, partiendo
// de la cobertura base (la que tendria el cliente con 0 pagos). Es deterministico:
// permite registrar Y anular pagos sin descuadres.
export function recomputarCobertura(coberturaBase, periodo, monto, dineroTotal) {
  const { mesesAvance, saldo } = convertirSaldo(periodo, monto, dineroTotal);
  return { pagado_hasta: aISODia1(sumarMeses(coberturaBase, mesesAvance)), saldo };
}

// Enriquece una fila de cliente con deuda/estado calculados.
export function enriquecerCliente(c, hoy = new Date()) {
  const debe = mesesDebe(c.pagado_hasta, hoy, Number(c.dia_cobro) || 1, Boolean(c.cobro_vencido));
  const monto = Number(c.monto);
  const plan = PLAN_PERIODO[c.periodo];

  let deudaBruta; let mesesAPagar;
  if (plan && debe > 0) {
    // Semestral/anual: al vencerse, se cobra el/los periodo(s) completo(s) con descuento.
    const periodos = Math.ceil(debe / plan.meses);
    mesesAPagar = periodos * plan.meses;                  // meses que cubre la regularizacion
    deudaBruta = Number((periodos * (plan.meses - plan.descuento) * monto).toFixed(2));
  } else {
    // Mensual/trimestral: mes a mes.
    mesesAPagar = debe;
    deudaBruta = Number((debe * monto).toFixed(2));
  }

  // Modelo "saldo a favor": los pagos parciales bajan la deuda S/ por S/.
  const saldo = Number(c.saldo) || 0;
  const deuda = Number(Math.max(0, deudaBruta - saldo).toFixed(2));

  return {
    ...c,
    monto,
    saldo,                      // dinero pagado a cuenta (aun no completa un bloque)
    meses_debe: debe,           // meses vencidos reales (urgencia / color)
    meses_a_pagar: mesesAPagar, // meses que cubre la regularizacion (para listar en el mensaje)
    deuda_bruta: deudaBruta,    // deuda por cobertura, antes de descontar saldo
    deuda,                      // deuda neta (lo que realmente falta pagar)
    estado: estado(debe),
    meses_cobertura: mesesCobertura(c.pagado_hasta, hoy),
    // Incluye el dia de cobro del cliente: "15 de junio 2026".
    pagado_hasta_label: `${Number(c.dia_cobro) || 1} de ${etiquetaMes(c.pagado_hasta)}`,
  };
}
