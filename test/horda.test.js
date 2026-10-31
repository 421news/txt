import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

// HORDA (/horda, 2026-10-31): el juego y su tabla de puntajes con la cuenta de txt.
const googleFalso = {
  urlAutorizacion: ({ state }) => `https://google.test/auth?state=${state}`,
  canjearCodigo: async ({ code }) => ({ sub: `sub-${code}`, email: `${code}@gmail.com` }),
};

async function montar({ horda = true } = {}) {
  const db = openDb(':memory:');
  const reloj = { t: 1_800_000_000_000 };
  const app = createApp({
    db,
    moderar: async () => ({ decision: 'approve', rule: 'ninguna', reason: '', model: 'falso', input_tokens: 1, output_tokens: 1, grave: 'ninguna' }),
    google: googleFalso,
    secret: 'secreto-de-prueba',
    baseUrl: 'http://prueba',
    siteName: 'prueba',
    adminEmails: ['mod@gmail.com'],
    now: () => reloj.t,
    horda,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const pedir = (ruta, { sesion, datos, cookie } = {}) =>
    fetch(base + ruta, {
      method: datos ? 'POST' : 'GET',
      headers: sesion || cookie ? { cookie: sesion?.cookie ?? cookie } : {},
      body: datos ? new URLSearchParams({ ...(sesion ? { _csrf: sesion.csrf } : {}), ...datos }) : undefined,
      redirect: 'manual',
    });
  async function inicioGoogle(volver) {
    const r = await pedir(`/auth/google${volver ? `?volver=${encodeURIComponent(volver)}` : ''}`);
    return {
      oauth: r.headers.getSetCookie()[0].split(';')[0],
      state: new URL(r.headers.get('location')).searchParams.get('state'),
    };
  }
  async function entrar(nombre, volver) {
    const { oauth, state } = await inicioGoogle(volver);
    const r = await pedir(`/auth/google/callback?code=${nombre}&state=${state}`, { cookie: oauth });
    assert.equal(r.status, 303);
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
    const resp = await pedir('/horda/estado.json', { cookie });
    // Con HORDA apagado no hay estado.json: el token sale del formulario de la portada.
    const estado = resp.ok
      ? await resp.json()
      : { csrf: (await (await pedir('/', { cookie })).text()).match(/name="_csrf" value="([^"]+)"/)[1], yo: null };
    return { cookie, csrf: estado.csrf, yo: estado.yo, location: r.headers.get('location') };
  }
  return { db, pedir, entrar, avanzar: (seg) => (reloj.t += seg * 1000), cerrar: () => server.close() };
}

const PARTIDA = { puntos: '1000', oleada: '3', bajas: '50', segundos: '60' };

test('HORDA: /horda sirve el juego con su propia CSP, sin nada inline', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const r = await s.pedir('/horda');
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  for (const d of ["script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self' data:", "connect-src 'self'"]) assert.ok(csp.includes(d), d);
  assert.ok(!csp.includes('unsafe'));
  const h = await r.text();
  assert.match(h, /<script src="\/static\/horda\.js\?v=[0-9a-f]{10}"><\/script>/);
  assert.match(h, /<link rel="stylesheet" href="\/static\/horda\.css\?v=[0-9a-f]{10}">/);
  assert.ok(!/<script>|<style>|style="/.test(h), 'nada inline');
  assert.ok(!h.includes('googleapis'));
  const fuente = await s.pedir('/static/press-start-2p.woff2');
  assert.equal(fuente.status, 200);
});

test('HORDA: estado sin y con sesión', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const r = await s.pedir('/horda/estado.json');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await r.json(), { logueado: false, csrf: null, yo: null });
  const ana = await s.entrar('ana');
  const e = await (await s.pedir('/horda/estado.json', { sesion: ana })).json();
  assert.equal(e.logueado, true);
  assert.ok(e.csrf);
  assert.match(e.yo, /^[A-Za-z0-9_-]{8}$/);
  // Estable entre sesiones de la misma cuenta.
  const otraVez = await s.entrar('ana');
  assert.equal(otraVez.yo, e.yo);
});

test('HORDA: tabla vacía, envío sin sesión, CSRF inválido y valores imposibles', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  assert.deepEqual(await (await s.pedir('/horda/top.json')).json(), { top: [] });

  const sinSesion = await s.pedir('/horda/puntaje', { datos: PARTIDA });
  assert.equal(sinSesion.status, 401);
  assert.deepEqual(await sinSesion.json(), { error: 'sesion' });

  const ana = await s.entrar('ana');
  const csrf = await s.pedir('/horda/puntaje', { sesion: ana, datos: { ...PARTIDA, _csrf: 'otro' } });
  assert.equal(csrf.status, 403);
  assert.deepEqual(await csrf.json(), { error: 'csrf' });

  for (const malo of [
    { puntos: '-5' },
    { puntos: '1.5' },
    { puntos: '' },
    { puntos: '1e3' },
    { puntos: '99999999999' },
    { oleada: '0' },
    { segundos: '10' }, // 3 oleadas en 10 s
    { bajas: '0' }, // puntos sin bajas
  ]) {
    const r = await s.pedir('/horda/puntaje', { sesion: ana, datos: { ...PARTIDA, ...malo } });
    assert.equal(r.status, 400, JSON.stringify(malo));
    assert.deepEqual(await r.json(), { error: 'valores' });
  }
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM horda_puntajes').get().n, 0);
});

test('HORDA: un envío válido aparece con el ID pseudoanónimo, una fila por cuenta con su mejor puntaje', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const beto = await s.entrar('beto');
  const r = await s.pedir('/horda/puntaje', { sesion: ana, datos: PARTIDA });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.puesto, 1);
  assert.deepEqual(d.top, [{ id: ana.yo, puntos: 1000, oleada: 3 }]);
  const crudo = await (await s.pedir('/horda/top.json')).text();
  assert.ok(!crudo.includes('user_id'));
  const anaId = s.db.prepare("SELECT id FROM users WHERE identidad = 'google:sub-ana'").get().id;
  assert.ok(!JSON.parse(crudo).top.some((f) => f.id === String(anaId)));

  // Un puntaje peor no cambia su fila; uno mejor la reemplaza. Beto queda en el medio.
  await s.pedir('/horda/puntaje', { sesion: ana, datos: { ...PARTIDA, puntos: '500' } });
  const b = await (await s.pedir('/horda/puntaje', { sesion: beto, datos: { ...PARTIDA, puntos: '2000', oleada: '4' } })).json();
  assert.equal(b.puesto, 1);
  const a = await (await s.pedir('/horda/puntaje', { sesion: ana, datos: { ...PARTIDA, puntos: '3000', oleada: '5', segundos: '90' } })).json();
  assert.equal(a.puesto, 1);
  assert.deepEqual(a.top, [
    { id: ana.yo, puntos: 3000, oleada: 5 },
    { id: beto.yo, puntos: 2000, oleada: 4 },
  ]);
  // El peor de ana sigue guardando su puesto según su mejor.
  const peor = await (await s.pedir('/horda/puntaje', { sesion: ana, datos: { ...PARTIDA, puntos: '10' } })).json();
  assert.equal(peor.puesto, 1);
  assert.equal(peor.top.length, 2);
  assert.notEqual(ana.yo, beto.yo);
});

test('HORDA: límite de envíos por minuto y cuenta suspendida', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  for (let i = 0; i < 6; i++) assert.equal((await s.pedir('/horda/puntaje', { sesion: ana, datos: PARTIDA })).status, 200);
  const septimo = await s.pedir('/horda/puntaje', { sesion: ana, datos: PARTIDA });
  assert.equal(septimo.status, 429);
  assert.deepEqual(await septimo.json(), { error: 'limite' });
  s.avanzar(61);
  assert.equal((await s.pedir('/horda/puntaje', { sesion: ana, datos: PARTIDA })).status, 200);

  const beto = await s.entrar('beto');
  s.db.prepare("UPDATE users SET banned_until = ? WHERE identidad = 'google:sub-beto'").run(1_900_000_000_000);
  const r = await s.pedir('/horda/puntaje', { sesion: beto, datos: PARTIDA });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'suspendida' });
});

test('HORDA: borrar la cuenta borra sus puntajes', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/horda/puntaje', { sesion: ana, datos: PARTIDA });
  await s.pedir('/cuenta/borrar', { sesion: ana, datos: { confirmar: '1' } });
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM horda_puntajes').get().n, 0);
  assert.deepEqual(await (await s.pedir('/horda/top.json')).json(), { top: [] });
});

test('HORDA: el link en los menús y la vuelta a /horda después de entrar', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const portada = await (await s.pedir('/')).text();
  assert.equal(portada.match(/<a href="\/horda"[^>]*>HORDA<\/a>/g)?.length, 2, 'Menú de escritorio y Secciones del celular');

  const entrar = await (await s.pedir('/entrar?volver=%2Fhorda')).text();
  assert.ok(entrar.includes('href="/auth/google?volver=%2Fhorda"'));
  const ana = await s.entrar('ana', '/horda');
  assert.equal(ana.location, '/horda');
  // Solo rutas del sitio.
  for (const afuera of ['//evil.com', '/\\evil.com', 'https://evil.com']) {
    const r = await s.entrar('beto', afuera);
    assert.equal(r.location, '/', afuera);
  }
  assert.equal((await s.entrar('caro')).location, '/');
});

test('HORDA=off apaga las rutas y el link', async (t) => {
  const s = await montar({ horda: false });
  t.after(s.cerrar);
  for (const ruta of ['/horda', '/horda/estado.json', '/horda/top.json']) assert.equal((await s.pedir(ruta)).status, 404, ruta);
  const ana = await s.entrar('ana');
  assert.equal((await s.pedir('/horda/puntaje', { sesion: ana, datos: PARTIDA })).status, 404);
  assert.ok(!(await (await s.pedir('/')).text()).includes('href="/horda"'));
});

test('HORDA: un mod ve los puntajes en /mod y borra uno trucho; queda en el registro; un usuario común no puede', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/horda/puntaje', { sesion: ana, datos: { ...PARTIDA, puntos: '200000', bajas: '900', segundos: '600', oleada: '20' } });
  const fila = s.db.prepare('SELECT id FROM horda_puntajes').get();

  const beto = await s.entrar('beto');
  const r1 = await s.pedir(`/mod/horda/${fila.id}/borrar`, { sesion: beto, datos: {} });
  assert.equal(r1.status, 404, 'un usuario común no borra');
  assert.ok(s.db.prepare('SELECT id FROM horda_puntajes WHERE id = ?').get(fila.id));

  const mod = await s.entrar('mod');
  const panel = await (await s.pedir('/mod', { cookie: mod.cookie })).text();
  assert.ok(panel.includes('id="horda"') && panel.includes(ana.yo) && panel.includes('200000'), 'el mod ve el puntaje con el ID de HORDA');
  assert.ok(panel.includes(`action="/mod/horda/${fila.id}/borrar"`));

  const sinCsrf = await s.pedir(`/mod/horda/${fila.id}/borrar`, { cookie: mod.cookie, datos: {} });
  assert.equal(sinCsrf.status, 403, 'sin CSRF no borra');

  const r2 = await s.pedir(`/mod/horda/${fila.id}/borrar`, { sesion: mod, datos: {} });
  assert.equal(r2.status, 303);
  assert.equal(r2.headers.get('location'), '/mod#horda');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM horda_puntajes').get().n, 0);
  const log = s.db.prepare("SELECT * FROM mod_log WHERE accion = 'horda-borrar'").get();
  assert.equal(log.nota, '200000 puntos');
  assert.deepEqual((await (await s.pedir('/horda/top.json')).json()).top, []);
});
