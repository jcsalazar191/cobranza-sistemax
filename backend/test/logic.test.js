import test from 'node:test';
import assert from 'node:assert/strict';
import { avanzarCobertura, enriquecerCliente, inferirMesesPago, recalcularCoberturaPagos } from '../src/logic.js';

test('exposes the overdue date for a monthly client before the next cycle is due', () => {
  const cliente = enriquecerCliente({
    pagado_hasta: '2026-08-01', cobertura_base: '2026-07-01', saldo: 0,
    monto: 69, periodo: 'MENSUAL', dia_cobro: 22, cobro_vencido: false,
  }, new Date('2026-10-07T12:00:00'));

  assert.equal(cliente.deuda, 69);
  assert.equal(cliente.fecha_vencimiento, '2026-09-22');
  assert.equal(cliente.fecha_vencimiento_label, '22 de septiembre de 2026');
  assert.equal(cliente.pagado_hasta_label, '22 de septiembre 2026');
});

test('shows the next due date after the September cycle is paid', () => {
  const cliente = enriquecerCliente({
    pagado_hasta: '2026-09-01', cobertura_base: '2026-07-01', saldo: 0,
    monto: 69, periodo: 'MENSUAL', dia_cobro: 22, cobro_vencido: false,
  }, new Date('2026-10-07T12:00:00'));

  assert.equal(cliente.deuda, 0);
  assert.equal(cliente.fecha_vencimiento, '2026-10-22');
  assert.equal(cliente.fecha_vencimiento_label, '22 de octubre de 2026');
});

test('monthly client debt uses the five-for-six discount block', () => {
  const cliente = enriquecerCliente({
    pagado_hasta: '2026-04-01', cobertura_base: '2026-04-01', saldo: 0,
    monto: 55, periodo: 'MENSUAL', dia_cobro: 1, cobro_vencido: false,
  }, new Date('2026-09-07T12:00:00'));

  assert.equal(cliente.meses_debe, 5);
  assert.equal(cliente.deuda, 275);
  assert.equal(cliente.meses_a_pagar, 6);
});

test('prices a payment at the first uncovered month when the tariff changes', () => {
  const tarifas = [
    { monto: 89, periodo: 'SEMESTRAL', desde: '2000-01-01' },
    { monto: 79, periodo: 'SEMESTRAL', desde: '2026-09-01' },
    { monto: 79, periodo: 'ANUAL', desde: '2026-09-01' },
  ];

  assert.deepEqual(
    avanzarCobertura('2026-08-01', 790, tarifas, 79, 'ANUAL'),
    { pagado_hasta: '2027-08-01', saldo: 0, mesesAvance: 12 },
  );
});

test('uses the new tariff for a block beginning the month after coverage', () => {
  const tarifas = [
    { monto: 89, periodo: 'SEMESTRAL', desde: '2000-01-01' },
    { monto: 79, periodo: 'SEMESTRAL', desde: '2026-09-01' },
  ];

  assert.deepEqual(
    avanzarCobertura('2026-08-01', 445, tarifas, 79, 'SEMESTRAL'),
    { pagado_hasta: '2027-02-01', saldo: 50, mesesAvance: 6 },
  );
});

test('applies the six-month discount block and retains sub-month credit', () => {
  const tarifas = [{ monto: 79, periodo: 'ANUAL', desde: '2026-09-01' }];

  assert.deepEqual(
    avanzarCobertura('2026-08-01', 789, tarifas, 79, 'ANUAL'),
    { pagado_hasta: '2027-06-01', saldo: 78, mesesAvance: 10 },
  );
});

test('recalculates leftover credit with the tariff at the next block start', () => {
  const tarifas = [
    { monto: 180, periodo: 'MENSUAL', desde: '2000-01-01' },
    { monto: 150, periodo: 'MENSUAL', desde: '2026-07-01' },
  ];

  assert.deepEqual(
    avanzarCobertura('2026-03-01', 839, tarifas, 150, 'MENSUAL'),
    { pagado_hasta: '2026-07-01', saldo: 149, mesesAvance: 4 },
  );
});

test('monthly-rate payment of five fees covers six months even if the usual plan is monthly', () => {
  const tarifas = [{ monto: 55, periodo: 'MENSUAL', desde: '2000-01-01' }];

  assert.deepEqual(
    avanzarCobertura('2026-04-01', 275, tarifas, 55, 'MENSUAL'),
    { pagado_hasta: '2026-10-01', saldo: 0, mesesAvance: 6 },
  );
});

test('ten monthly fees cover twelve months and two six-month payments remain deterministic', () => {
  const tarifas = [{ monto: 55, periodo: 'MENSUAL', desde: '2000-01-01' }];

  assert.deepEqual(
    avanzarCobertura('2026-04-01', 550, tarifas, 55, 'MENSUAL'),
    { pagado_hasta: '2027-04-01', saldo: 0, mesesAvance: 12 },
  );
  assert.equal(
    avanzarCobertura('2026-04-01', 550, tarifas, 55, 'MENSUAL').mesesAvance
      - avanzarCobertura('2026-04-01', 275, tarifas, 55, 'MENSUAL').mesesAvance,
    6,
  );
});

test('six- and twelve-month discounts do not depend on the customer usual plan', () => {
  const tarifas = [{ monto: 55, periodo: 'ANUAL', desde: '2000-01-01' }];

  assert.equal(
    avanzarCobertura('2026-04-01', 275, tarifas, 55, 'ANUAL').mesesAvance,
    6,
  );
  assert.equal(
    avanzarCobertura('2026-04-01', 550, tarifas, 55, 'ANUAL').mesesAvance,
    12,
  );
});

test('recalculation preserves months recorded per payment instead of reclassifying old amounts', () => {
  const tarifas = [{ monto: 55, periodo: 'MENSUAL', desde: '2000-01-01' }];
  const result = recalcularCoberturaPagos('2026-04-01', [
    { meses: 5, monto_total: 275 }, // pago anterior: cinco meses, no se convierte retroactivamente en seis
    { meses: 6, monto_total: 275 }, // el pago posterior sí registra seis meses
  ], tarifas, 55, 'MENSUAL');

  assert.deepEqual(result, { pagado_hasta: '2027-03-01', saldo: 0, mesesAvance: 11 });
});

test('recalculation after deleting a payment keeps the remaining payment coverage and abonos', () => {
  const tarifas = [{ monto: 55, periodo: 'MENSUAL', desde: '2000-01-01' }];
  assert.deepEqual(
    recalcularCoberturaPagos('2026-04-01', [
      { meses: 0, monto_total: 20 },
      { meses: 6, monto_total: 275 },
    ], tarifas, 55),
    { pagado_hasta: '2026-10-01', saldo: 20, mesesAvance: 6 },
  );
});

test('legacy callers infer months only for the new payment', () => {
  const tarifas = [{ monto: 55, periodo: 'MENSUAL', desde: '2000-01-01' }];
  assert.equal(inferirMesesPago('2026-04-01', 275, tarifas, 55), 6);
  assert.equal(inferirMesesPago('2026-04-01', 550, tarifas, 55), 12);
  assert.equal(inferirMesesPago('2026-04-01', 20, tarifas, 55), 0);
});
