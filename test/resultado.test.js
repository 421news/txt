import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intentar, intentarAsync } from '../src/resultado.js';

test('resultado: los valores vacíos son éxitos, distintos de una excepción sin valor', async () => {
  for (const valor of [undefined, null, false, 0, '']) {
    assert.deepEqual(intentar(() => valor), { ok: true, valor });
    assert.deepEqual(await intentarAsync(async () => valor), { ok: true, valor });
  }
  assert.deepEqual(intentar(() => { throw undefined; }), { ok: false, error: undefined });
  assert.deepEqual(await intentarAsync(async () => { throw undefined; }), { ok: false, error: undefined });
});

test('resultado: conserva el error original, su causa y su código para decidir cómo recuperarse', () => {
  const causa = new Error('sin permisos');
  const error = Object.assign(new Error('no se pudo leer', { cause: causa }), { code: 'EACCES' });
  const resultado = intentar(() => { throw error; });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.error, error);
  assert.equal(resultado.error.cause, causa);
  assert.equal(resultado.error.code, 'EACCES');
});

test('resultado async: captura tanto una excepción antes de devolver la promesa como su rechazo posterior', async () => {
  const error = new Error('servicio caído');
  const sincrono = await intentarAsync(() => { throw error; });
  const asincrono = await intentarAsync(async () => {
    await Promise.resolve();
    throw error;
  });
  assert.deepEqual(sincrono, { ok: false, error });
  assert.deepEqual(asincrono, { ok: false, error });
  assert.equal(sincrono.error, error);
  assert.equal(asincrono.error, error);
});
