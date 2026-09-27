import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const modulo = new URL('../src/env.js', import.meta.url).href;

function cargar(t, { archivo, antes = '', despues = '' } = {}) {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'txt-env-'));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  if (archivo !== undefined) writeFileSync(path.join(carpeta, '.env'), archivo);
  // Proceso y carpeta aislados: nunca se lee el .env del proyecto ni se modifica el entorno del test.
  const proceso = spawnSync(process.execPath, ['--input-type=module', '-e', `${antes}\nawait import(${JSON.stringify(modulo)});\n${despues}`], {
    cwd: carpeta,
    env: {},
    encoding: 'utf8',
  });
  assert.ifError(proceso.error);
  return proceso;
}

test('entorno: sin .env el arranque continúa', (t) => {
  const r = cargar(t);
  assert.equal(r.status, 0, r.stderr);
});

test('entorno: carga las variables de un .env existente', (t) => {
  const r = cargar(t, { archivo: 'TXT_PRUEBA_ENTORNO=presente\n', despues: "console.log(process.env.TXT_PRUEBA_ENTORNO);" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'presente');
});

test('entorno: un error de permisos se propaga e impide continuar el arranque', (t) => {
  const r = cargar(t, {
    antes: "process.loadEnvFile = () => { throw Object.assign(new Error('lectura denegada'), { code: 'EACCES' }); };",
    despues: "console.log('arranque');",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /lectura denegada/);
  assert.match(r.stderr, /EACCES/);
  assert.equal(r.stdout, '');
});
