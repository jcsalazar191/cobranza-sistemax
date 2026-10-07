import test from 'node:test';
import assert from 'node:assert/strict';
import { resumenEstadoPago } from '../src/lib/ui.js';

const hoy = new Date(2026, 9, 7);

test('explains the unpaid period without repeating the last covered month', () => {
  assert.equal(
    resumenEstadoPago({ deuda: 110, pagado_hasta: '2026-08-01', meses_a_pagar: 2 }, hoy),
    'Pendiente: septiembre a octubre de 2026',
  );
});

test('shows one next-payment date for an account without debt', () => {
  assert.equal(
    resumenEstadoPago({ deuda: 0, fecha_vencimiento: '2026-11-01' }, hoy),
    'Próximo pago: 1 de noviembre de 2026',
  );
});

test('does not show a stale past date as the next payment when there is no debt', () => {
  assert.equal(
    resumenEstadoPago({ deuda: 0, fecha_vencimiento: '2026-09-01' }, hoy),
    'Cuenta al día',
  );
});

test('uses a same-day payment message instead of implying a future date', () => {
  assert.equal(
    resumenEstadoPago({ deuda: 0, fecha_vencimiento: '2026-10-07' }, hoy),
    'Pago programado para hoy',
  );
});
