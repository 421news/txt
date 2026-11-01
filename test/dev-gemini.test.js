import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { once } from 'node:events';
import { crearEntornoGeminiLocal } from '../scripts/dev-gemini.js';
import { HILOS } from '../scripts/fixture-datos.js';

test('Gemini local: ejemplos aislados, TLS, moderación sin APIs y datos persistentes', async (t) => {
  const directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-gemini-local-'));
  const ajena = path.join(directorio, 'no-tocar.db');
  const variables = { DB_PATH: ajena, GOOGLE_CLIENT_ID: 'ignorar', GOOGLE_CLIENT_SECRET: 'ignorar', ANTHROPIC_API_KEY: 'ignorar', TYPESAFE_API_KEY: 'ignorar' };
  const anteriores = Object.fromEntries(Object.keys(variables).map((k) => [k, process.env[k]]));
  Object.assign(process.env, variables);
  t.after(() => {
    for (const [k, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[k];
      else process.env[k] = valor;
    }
  });
  const pedir = globalThis.fetch;
  const redExterna = t.mock.method(globalThis, 'fetch', () => { throw new Error('No debe llamar a APIs'); });
  let entorno;
  let web;
  t.after(async () => {
    await Promise.all([web, entorno?.capsula].filter(Boolean).map((s) => new Promise((r) => s.close(r))));
    entorno?.db.close();
    fs.rmSync(directorio, { recursive: true, force: true });
  });
  entorno = crearEntornoGeminiLocal(directorio);
  assert.equal(entorno.db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, HILOS.length);
  assert.equal(entorno.db.prepare('SELECT COUNT(*) AS n FROM threads WHERE archived = 1').get().n, 3);
  web = entorno.app.listen(0, '127.0.0.1');
  await once(web, 'listening');
  entorno.capsula.listen(0, '127.0.0.1');
  await once(entorno.capsula, 'listening');
  const base = `http://127.0.0.1:${web.address().port}`;
  const gemini = (ruta) => new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: '127.0.0.1', port: entorno.capsula.address().port, servername: 'localhost',
      ca: fs.readFileSync(path.join(directorio, 'cert.pem')), rejectUnauthorized: true,
    }, () => socket.write(`gemini://127.0.0.1${ruta}\r\n`));
    let respuesta = '';
    socket.setEncoding('utf8');
    socket.on('data', (x) => { respuesta += x; });
    socket.on('end', () => resolve(respuesta));
    socket.on('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('TLS timeout')));
  });
  const portada = await gemini('/');
  assert.match(portada, /^20 text\/gemini;/);
  assert.ok(portada.includes('moderación simulada') && portada.includes('=> /h/'));
  assert.match(await gemini('/h/1'), /^20 text\/gemini;/);
  assert.match(await gemini('/b/cultura/archivo'), /^20 text\/gemini;/);

  const login = await pedir(`${base}/entrar/prueba`, {
    method: 'POST', body: new URLSearchParams({ nombre: 'local' }), redirect: 'manual',
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
  const home = await (await pedir(base, { headers: { cookie } })).text();
  const csrf = home.match(/name="_csrf" value="([^"]+)"/)[1];
  const publicado = await pedir(`${base}/b/cultura/hilo`, {
    method: 'POST', headers: { cookie }, redirect: 'manual',
    body: new URLSearchParams({ _csrf: csrf, asunto: 'Prueba local', cuerpo: 'Sin llamadas a APIs' }),
  });
  assert.equal(publicado.status, 303);
  assert.equal(entorno.db.prepare("SELECT status FROM posts WHERE body = 'Sin llamadas a APIs'").get().status, 'published');
  assert.equal(redExterna.mock.callCount(), 0);
  assert.ok(!fs.existsSync(ajena), 'ignora DB_PATH y no toca la base del entorno');

  const certificado = fs.readFileSync(path.join(directorio, 'cert.pem'));
  const secreto = fs.readFileSync(path.join(directorio, 'secret'));
  const segundo = crearEntornoGeminiLocal(directorio);
  const otraWeb = segundo.app.listen(0, '127.0.0.1');
  try {
    await once(otraWeb, 'listening');
    assert.deepEqual(fs.readFileSync(path.join(directorio, 'cert.pem')), certificado);
    assert.deepEqual(fs.readFileSync(path.join(directorio, 'secret')), secreto);
    assert.equal(segundo.db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, HILOS.length + 1);
    assert.ok(segundo.db.prepare("SELECT id FROM threads WHERE subject = 'Prueba local'").get());
    const sesion = await (await pedir(`http://127.0.0.1:${otraWeb.address().port}`, { headers: { cookie } })).text();
    assert.ok(sesion.includes(`value="${csrf}"`), 'el secreto estable conserva la sesión');
  } finally {
    await new Promise((r) => otraWeb.close(r));
    segundo.db.close();
  }
});

test('Gemini local: no arranca en producción', () => {
  const anterior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => crearEntornoGeminiLocal(), /solo para desarrollo/);
  } finally {
    if (anterior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = anterior;
  }
});
