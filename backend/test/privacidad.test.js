import test from 'node:test';
import assert from 'node:assert/strict';
import { enmascarar } from '../src/privacidad.js';

// Los valores de estos ejemplos son inventados.
test('oculta usuario y clave SOL', () => {
  const t = enmascarar('. Usuario : 12345678 y contraseña de SUNAT : Abc12xyz9. . Logo : x');
  assert.ok(!t.includes('12345678') && !t.includes('Abc12xyz9'));
  assert.ok(t.includes('Logo : x'));
});
test('oculta contrasena sin separador cuando parece clave', () => {
  assert.ok(!enmascarar('USUARIO: PRUEBA CONTRASEÑA: Demo2020').includes('Demo2020'));
  assert.ok(!enmascarar('mi clave Ejemplo000 gracias').includes('Ejemplo000'));
});
test('no toca prosa normal', () => {
  const s = 'No me acuerdo la clave, me ayuda por favor';
  assert.equal(enmascarar(s), s);
  assert.equal(enmascarar('Hola mi estimado, paso el pago'), 'Hola mi estimado, paso el pago');
  assert.equal(enmascarar(null), null);
});
