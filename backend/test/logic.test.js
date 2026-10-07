import test from 'node:test';
import assert from 'node:assert/strict';
import { avanzarCobertura } from '../src/logic.js';

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

test('keeps the coverage endpoint and balance when the full block is not paid', () => {
  const tarifas = [{ monto: 79, periodo: 'ANUAL', desde: '2026-09-01' }];

  assert.deepEqual(
    avanzarCobertura('2026-08-01', 789, tarifas, 79, 'ANUAL'),
    { pagado_hasta: '2026-08-01', saldo: 789, mesesAvance: 0 },
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
