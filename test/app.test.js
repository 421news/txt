import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb } from '../src/db.js';
import { createApp, limpiarTexto } from '../src/app.js';
import { formatear } from '../src/format.js';

// Google falso: el "code" con el que vuelve el login es el nombre de la persona.
const googleFalso = {
  urlAutorizacion: ({ state }) => `https://google.test/auth?state=${state}`,
  canjearCodigo: async ({ code }) => ({ sub: `sub-${code}`, email: `${code}@gmail.com` }),
};

async function montar({ google = googleFalso } = {}) {
  const db = openDb(':memory:');
  const reloj = { t: 1_800_000_000_000 };
  const filtro = { decision: 'approve' };
  const moderar = async () => ({
    decision: filtro.decision,
    rule: filtro.decision === 'reject' ? 'respeto' : 'ninguna',
    reason: filtro.decision === 'reject' ? 'Tu mensaje ataca a otra persona.' : '',
    model: 'falso',
    input_tokens: 1,
    output_tokens: 1,
    grave: filtro.grave ?? 'ninguna',
  });
  const app = createApp({
    db,
    moderar,
    google,
    loginDePrueba: !google,
    secret: 'secreto-de-prueba',
    baseUrl: 'http://prueba',
    siteName: 'prueba',
    adminEmails: ['mod@gmail.com'],
    now: () => reloj.t,
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
  const texto = async (ruta, sesion) => (await pedir(ruta, { sesion })).text();

  async function leerSesion(respuesta) {
    const cookie = respuesta.headers
      .getSetCookie()
      .find((c) => c.startsWith('sid='))
      .split(';')[0];
    const home = await (await pedir('/', { cookie })).text();
    return { cookie, csrf: home.match(/name="_csrf" value="([^"]+)"/)[1] };
  }

  async function inicioGoogle() {
    const r = await pedir('/auth/google');
    assert.equal(r.status, 302);
    return {
      oauth: r.headers.getSetCookie()[0].split(';')[0],
      state: new URL(r.headers.get('location')).searchParams.get('state'),
    };
  }

  async function entrar(nombre) {
    const { oauth, state } = await inicioGoogle();
    const r = await pedir(`/auth/google/callback?code=${nombre}&state=${state}`, { cookie: oauth });
    assert.equal(r.status, 303);
    return leerSesion(r);
  }

  return {
    db,
    filtro,
    pedir,
    texto,
    entrar,
    inicioGoogle,
    leerSesion,
    avanzar: (seg) => (reloj.t += seg * 1000),
    base,
    documento: app.locals.documento,
    cerrar: () => server.close(),
  };
}

test('formatear escapa todo y agrega solo las marcas propias', () => {
  const h = formatear('<script>alert(1)</script>\n>cita\n>>5 y >>9\n[spoiler]final[/spoiler]', {
    idsLocales: new Set([5]),
  });
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(h.includes('<span class="verde">&gt;cita</span>'));
  assert.ok(h.includes('<a class="cita" href="#p5">&gt;&gt;5</a>'));
  assert.ok(h.includes('<a class="cita" href="/p/9">&gt;&gt;9</a>'));
  assert.ok(!h.includes('<span class="verde"><a'), 'una línea que empieza con >>N no es cita verde');
  assert.ok(h.includes('<span class="spoiler" tabindex="0">final</span>'));
});

test('limpiarTexto saca caracteres invisibles y conserva espacios y signos', () => {
  const anchoCero = String.fromCharCode(0x200b);
  const invertir = String.fromCharCode(0x202e);
  const entrada = `hola${anchoCero} mundo${invertir}, ¿qué tal?\n\n\n\nchau  `;
  assert.equal(limpiarTexto(entrada), 'hola mundo, ¿qué tal?\n\nchau');
});

test('entrar con Google guarda solo el identificador, nunca el correo', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  await s.entrar('ana');
  assert.deepEqual(s.db.prepare('SELECT identidad FROM users').all(), [{ identidad: 'google:sub-ana' }]);
  const columnas = s.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(!columnas.includes('email'));
});

test('el login con Google rechaza un state que no coincide', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const { oauth } = await s.inicioGoogle();
  assert.equal((await s.pedir('/auth/google/callback?code=ana&state=otro', { cookie: oauth })).status, 400);
  assert.equal((await s.pedir('/auth/google/callback?code=ana&state=otro')).status, 400);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('el acceso de prueba solo existe cuando no hay Google', async (t) => {
  const conGoogle = await montar();
  t.after(conGoogle.cerrar);
  assert.equal((await conGoogle.pedir('/entrar/prueba', { datos: { nombre: 'x' } })).status, 404);

  const sinGoogle = await montar({ google: null });
  t.after(sinGoogle.cerrar);
  assert.equal((await sinGoogle.pedir('/auth/google')).status, 404);
  const r = await sinGoogle.pedir('/entrar/prueba', { datos: { nombre: 'Juan', admin: '1' } });
  assert.equal(r.status, 303);
  const juan = await sinGoogle.leerSesion(r);
  assert.equal((await sinGoogle.pedir('/mod', { sesion: juan })).status, 200);
});

test('publicar un hilo aprobado y verlo sin HTML inyectado', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');

  const r = await s.pedir('/b/cultura/hilo', {
    sesion: ana,
    datos: { asunto: 'Libros <b>raros</b>', cuerpo: 'Recomienden <script>alert(1)</script>' },
  });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/h/1');

  const hilo = await s.texto('/h/1');
  assert.ok(hilo.includes('Libros &lt;b&gt;raros&lt;/b&gt;'));
  assert.ok(!hilo.includes('<script>alert'));
  assert.ok(hilo.includes('Pseudoanónimo'));
  assert.ok((await s.texto('/b/cultura')).includes('/h/1'));
  assert.ok((await s.texto('/')).includes('/h/1'), 'la portada muestra los hilos');
});

test('abrir un hilo desde la portada exige elegir tablón', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');

  const sinTablon = await s.pedir('/hilo', { sesion: ana, datos: { asunto: 'Sin tablón', cuerpo: 'hola' } });
  assert.equal(sinTablon.status, 422);
  assert.ok((await sinTablon.text()).includes('Elegí en qué tablón'));

  const r = await s.pedir('/hilo', { sesion: ana, datos: { tablon: 'juegos', asunto: 'Con tablón', cuerpo: 'hola' } });
  assert.equal(r.status, 303);
  assert.equal(s.db.prepare('SELECT board FROM threads WHERE id = 1').get().board, 'juegos');
});

test('el listado muestra las últimas respuestas y cuántas se omitieron', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const bea = await s.entrar('bea');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Largo', cuerpo: 'inicio' } });
  for (const cuerpo of ['r-uno', 'r-dos', 'r-tres', 'r-cuatro', 'r-cinco']) {
    s.avanzar(31);
    await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo } });
  }

  const portada = await s.texto('/?vista=lista');
  assert.ok(portada.includes('2 respuestas omitidas'));
  for (const visible of ['inicio', 'r-tres', 'r-cuatro', 'r-cinco']) assert.ok(portada.includes(visible), visible);
  for (const oculta of ['r-uno', 'r-dos']) assert.ok(!portada.includes(oculta), oculta);
  assert.ok((await s.texto('/h/1')).includes('r-uno'), 'el hilo completo tiene todo');
});

test('el catálogo es la vista por defecto y no filtra spoilers ni anida links', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/b/cultura/hilo', {
    sesion: ana,
    datos: { asunto: 'Final de la serie', cuerpo: '>>99 decía que [spoiler]muere el protagonista[/spoiler] y era mentira' },
  });

  const portada = await s.texto('/');
  assert.ok(portada.includes('class="catalogo"'));
  assert.ok(portada.includes('R: 0'));
  assert.ok(!portada.includes('muere el protagonista'), 'el spoiler no aparece en la ficha');
  const ficha = portada.slice(portada.indexOf('class="ficha"'), portada.indexOf('</a>', portada.indexOf('class="ficha"')));
  assert.ok(!ficha.includes('<a '), 'no hay un link adentro de la ficha');
  assert.ok((await s.texto('/b/cultura')).includes('class="catalogo"'));
});

test('un POST sin token CSRF válido se rechaza', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const r = await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { _csrf: 'falso', asunto: 'a', cuerpo: 'b' } });
  assert.equal(r.status, 403);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 0);
});

test('un rechazo no publica, no explica el motivo y devuelve el texto', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  s.filtro.decision = 'reject';

  const r = await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Asunto rechazado', cuerpo: 'texto original' } });
  assert.equal(r.status, 422);
  const pagina = await r.text();
  assert.ok(pagina.includes('No se publicó: el mensaje no cumple las normas.'));
  assert.ok(!pagina.includes('Tu mensaje ataca a otra persona.'));
  assert.ok(pagina.includes('>texto original</textarea>'));
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM rechazos').get().n, 1);
});

test('en revisión solo lo ve el autor hasta que un mod lo aprueba', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  s.filtro.decision = 'queue';

  const r = await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Dudoso', cuerpo: 'algo ambiguo' } });
  assert.equal(r.headers.get('location'), '/h/1?aviso=cola');
  assert.equal((await s.pedir('/h/1')).status, 404);
  assert.ok((await s.texto('/h/1', ana)).includes('En revisión'));

  const mod = await s.entrar('mod');
  assert.ok((await s.texto('/mod', mod)).includes('Dudoso'));
  assert.equal((await s.pedir('/mod', { sesion: ana })).status, 404, 'un usuario común no ve /mod');

  assert.equal((await s.pedir('/mod/p/1/aprobar', { sesion: mod, datos: {} })).status, 303);
  const publico = await s.pedir('/h/1');
  assert.equal(publico.status, 200);
  assert.ok(!(await publico.text()).includes('En revisión'));
});

test('límite de frecuencia, y sage responde sin subir el hilo', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const bea = await s.entrar('bea');
  const orden = async () => {
    const h = await s.texto('/b/cultura');
    return h.indexOf('/h/1') < h.indexOf('/h/2') ? [1, 2] : [2, 1];
  };

  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Hilo uno', cuerpo: 'primero' } });
  s.avanzar(601);
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Hilo dos', cuerpo: 'segundo' } });
  assert.deepEqual(await orden(), [2, 1]);

  s.avanzar(1);
  await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'respuesta con sage', sage: '1' } });
  assert.deepEqual(await orden(), [2, 1], 'sage no sube el hilo');

  const apurada = await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'otra enseguida' } });
  assert.equal(apurada.status, 429);
  assert.ok((await apurada.text()).includes('Esperá'));

  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'respuesta normal' } });
  assert.deepEqual(await orden(), [1, 2], 'una respuesta normal sí lo sube');
});

test('tres reportes ocultan el post hasta que lo revise un mod', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const bea = await s.entrar('bea');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Tema', cuerpo: 'arranque' } });
  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'respuesta-a-ocultar' } });

  const reportantes = [];
  for (const nombre of ['c1', 'c2', 'c3']) reportantes.push(await s.entrar(nombre));
  // Cuentas recién creadas: reportan, pero no alcanzan para ocultar.
  for (const u of reportantes) await s.pedir('/p/2/reportar', { sesion: u, datos: { motivo: 'respeto' } });
  assert.ok((await s.texto('/h/1')).includes('respuesta-a-ocultar'));
  // Con más de un día, los mismos reportes sí ocultan.
  s.avanzar(86_401);
  const c4 = await s.entrar('c4');
  s.db.prepare("UPDATE reports SET created_at = created_at").run();
  await s.pedir('/p/2/reportar', { sesion: c4, datos: { motivo: 'respeto' } });
  assert.ok(!(await s.texto('/h/1')).includes('respuesta-a-ocultar'));
  const mod = await s.entrar('mod');
  assert.ok((await s.texto('/mod', mod)).includes('respuesta-a-ocultar'));
});

test('la página de privacidad existe y no promete guardar el correo', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const texto = await s.texto('/privacidad');
  assert.ok(texto.includes('Ley Nº 25.326'));
  assert.ok(texto.includes('no lo guardamos'));
  assert.ok((await s.texto('/entrar')).includes('href="/privacidad"'));
});

test('borrar la cuenta vacía los mensajes y deja las respuestas ajenas', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const bea = await s.entrar('bea');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Asunto-de-ana', cuerpo: 'texto-de-ana' } });
  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'respuesta-de-bea' } });

  const r = await s.pedir('/cuenta/borrar', { sesion: ana, datos: { confirmar: '1' } });
  assert.equal(r.status, 303);
  const hilo = await s.texto('/h/1');
  assert.ok(!hilo.includes('texto-de-ana') && !hilo.includes('Asunto-de-ana'));
  assert.ok(hilo.includes('respuesta-de-bea'));
  assert.ok(hilo.includes('Eliminado por su autor'));
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE identidad LIKE '%ana%'").get().n, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE identidad LIKE 'borrada:%'").get().n, 1);
  // La sesión vieja ya no sirve.
  assert.equal((await s.pedir('/cuenta', { sesion: ana })).status, 303);
});

test('una publicación sin respuestas se oculta al borrar la cuenta', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Sola', cuerpo: 'sin-respuestas' } });
  await s.pedir('/cuenta/borrar', { sesion: ana, datos: { confirmar: '1' } });
  assert.ok(!(await s.texto('/')).includes('Sola'));
});

test('borrar la cuenta exige confirmar', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const r = await s.pedir('/cuenta/borrar', { sesion: ana, datos: {} });
  assert.equal(r.status, 422);
});

test('la página de términos existe', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  assert.ok((await s.texto('/terminos')).includes('Términos de uso'));
});

test('SEO: metas, canonical, noindex donde corresponde, sitemap y datos de foro', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Libros </script> raros', cuerpo: 'Recomienden ciencia ficción argentina' } });

  const portada = await s.texto('/');
  assert.ok(portada.includes('<meta name="description"'));
  assert.ok(portada.includes('rel="canonical" href="http://localhost/"') || portada.includes('rel="canonical"'));
  assert.ok(!portada.includes('noindex'));
  assert.ok((await s.texto('/?vista=lista')).includes('noindex'));
  assert.ok((await s.texto('/entrar')).includes('noindex'));

  const hilo = await s.texto('/h/1');
  assert.ok(hilo.includes('content="Recomienden ciencia ficción argentina"'));
  assert.ok(hilo.includes('"@type":"DiscussionForumPosting"'));
  // El asunto con </script> no puede cerrar el bloque JSON-LD.
  const ld = hilo.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(ld).headline, 'Libros </script> raros');

  const mapa = await s.texto('/sitemap.xml');
  assert.ok(mapa.includes('/h/1</loc>') && mapa.includes('/b/cultura</loc>'));
  assert.ok((await s.texto('/robots.txt')).includes('Sitemap:'));
});

test('responder a un post: cita precargada, respuestas entrantes y marca propia', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const bea = await s.entrar('bea');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Tema', cuerpo: 'arranque' } });
  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'primera respuesta' } });
  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: ana, datos: { cuerpo: '>>2\nte contesto a vos' } });

  const conCita = await s.texto('/h/1?cita=2', bea);
  assert.ok(conCita.includes('>&gt;&gt;2\n</textarea>') || conCita.includes('&gt;&gt;2\n</textarea>'));
  assert.ok(conCita.includes('href="?cita=2#responder"'));

  const hilo = await s.texto('/h/1', bea);
  assert.ok(hilo.includes('Respuestas: <a href="#p3">&gt;&gt;3</a>'));
  // bea ve "(vos)" solo en su mensaje; sin sesión no aparece.
  assert.equal(hilo.split('marca-vos').length - 1, 1);
  assert.ok(!(await s.texto('/h/1')).includes('marca-vos'));

  const cuenta = await s.texto('/cuenta', ana);
  assert.ok(cuenta.includes('href="/h/1">Tema</a>'));
});

test('la página de formato muestra cada código escrito y renderizado', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const p = await s.texto('/formato');
  assert.ok(p.includes('<span class="spoiler"'));
  assert.ok(p.includes('<a class="cita" href="#p34">'));
  assert.ok(p.includes('<span class="verde">'));
  assert.ok((await s.texto('/sitemap.xml')).includes('/formato</loc>'));
});

test('notificaciones: comentario al OP, respuesta por cita, nunca a uno mismo, se marcan leídas', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const bea = await s.entrar('bea');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Tema', cuerpo: 'arranque' } });
  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: ana, datos: { cuerpo: 'me comento a mí misma' } });
  assert.ok(!(await s.texto('/', ana)).includes('class="badge"'));

  await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'comentario de bea' } });
  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: ana, datos: { cuerpo: '>>3\nte cito, bea' } });

  assert.ok((await s.texto('/', ana)).includes('<span class="badge">1</span>'));
  assert.ok((await s.texto('/', bea)).includes('<span class="badge">1</span>'));
  const pagina = await s.texto('/respuestas', bea);
  assert.ok(pagina.includes('te respondió') && pagina.includes('te cito, bea'));
  assert.ok(!(await s.texto('/', bea)).includes('class="badge"'));
});

test('actualización en vivo: /h/:id/nuevos trae solo lo posterior y respeta la visibilidad', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const bea = await s.entrar('bea');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Tema', cuerpo: 'arranque' } });
  const pagina = await s.texto('/h/1');
  assert.ok(pagina.includes('data-hilo="1" data-ultimo="1"') && pagina.includes('/static/vivo.js?v='));

  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: bea, datos: { cuerpo: 'algo nuevo' } });
  const r = JSON.parse(await s.texto('/h/1/nuevos?desde=1'));
  assert.equal(r.ultimo, 2);
  assert.ok(r.html.includes('algo nuevo') && !r.html.includes('arranque'));
  assert.equal(JSON.parse(await s.texto('/h/1/nuevos?desde=2')).html.trim(), '');
  assert.equal((await s.pedir('/h/99/nuevos?desde=0')).status, 404);
});

test('tema claro/oscuro por cookie, sin JavaScript', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const auto = await s.texto('/normas');
  assert.ok(auto.includes('<html lang="es">') && auto.includes('prefers-color-scheme: light'));
  assert.ok(auto.includes('class="boton-tema"') && !auto.includes('Usar el tema del sistema'));

  const r = await s.pedir('/tema?t=claro&volver=%2Fnormas');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/normas');
  const cookie = r.headers.getSetCookie()[0].split(';')[0];
  const claro = await (await s.pedir('/normas', { cookie })).text();
  assert.ok(claro.includes('data-tema="claro"') && claro.includes('Usar el tema del sistema'));

  assert.equal((await s.pedir('/tema?t=oscuro&volver=//evil.com')).headers.get('location'), '/');
});

test('tolerancia cero: un caso grave rechaza, suspende la cuenta y un mod la puede levantar', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  s.filtro.decision = 'reject';
  s.filtro.grave = 'menores';
  const r = await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'x', cuerpo: 'contenido prohibido' } });
  assert.equal(r.status, 422);
  const u = s.db.prepare("SELECT banned_until, ban_reason FROM users WHERE identidad LIKE '%ana%'").get();
  assert.ok(u.banned_until > 1_800_000_000_000 + 365 * 86_400_000 && u.ban_reason.includes('menores'));

  s.filtro.decision = 'approve';
  s.filtro.grave = 'ninguna';
  const bloqueada = await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'y', cuerpo: 'otro' } });
  assert.notEqual(bloqueada.status, 303);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, 0);

  const mod = await s.entrar('mod');
  const panel = await s.texto('/mod', mod);
  assert.ok(panel.includes('abuso infantil (permanente)') && panel.includes('contenido prohibido'));
  const id = s.db.prepare("SELECT id FROM users WHERE identidad LIKE '%ana%'").get().id;
  await s.pedir(`/mod/u/${id}/levantar`, { sesion: mod, datos: {} });
  assert.equal(s.db.prepare('SELECT banned_until FROM users WHERE id = ?').get(id).banned_until, null);
});

test('barra inferior y botón de tema', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const anon = await s.texto('/');
  assert.ok(anon.includes('class="abajo"') && anon.includes('href="/entrar"') && anon.includes('class="boton-tema"'));
  const ana = await s.entrar('ana');
  const conSesion = await s.texto('/b/cultura', ana);
  assert.ok(conSesion.includes('href="/b/cultura?publicar=1#publicar"') && conSesion.includes('>Respuestas</a>'));
  assert.ok((await s.texto('/?publicar=1', ana)).includes('id="publicar" open'));
});

test('versión texto: .txt, curl en la dirección normal, spoilers tapados y 404', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Libros', cuerpo: '>una cita\nhola [spoiler]final[/spoiler]' } });

  const r = await s.pedir('/h/1.txt');
  assert.match(r.headers.get('content-type'), /^text\/plain/);
  const txt = await r.text();
  assert.ok(txt.includes('Libros') && txt.includes('> una cita') && txt.includes('[spoiler: leelo en la web]'));
  assert.ok(!txt.includes('final') && !txt.includes('<'));

  const curl = await fetch(s.base + '/h/1', { headers: { 'user-agent': 'curl/8.5.0' } });
  assert.match(curl.headers.get('content-type'), /^text\/plain/);
  assert.ok((await (await fetch(s.base + '/', { headers: { 'user-agent': 'curl/8.5.0' } })).text()).includes('Últimas publicaciones'));
  assert.match((await s.pedir('/h/1')).headers.get('content-type'), /^text\/html/);

  assert.ok((await s.texto('/b/cultura.txt')).includes('Libros'));
  assert.ok((await s.texto('/normas.txt')).includes('Sin acoso'));
  assert.equal((await s.pedir('/h/99.txt')).status, 404);
  assert.ok((await s.texto('/h/1')).includes('rel="alternate" type="text/plain"'));
});

test('cápsula Gemini: portada, publicación, 51 y host ajeno', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tls = await import('node:tls');
  const { crearCapsula } = await import('../src/gemini.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });

  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Libros', cuerpo: '>cita\nhola' } });

  const capsula = crearCapsula({ documento: s.documento, baseUrl: 'https://prueba', cert: fs.readFileSync(path.join(dir, 'c.pem')), key: fs.readFileSync(path.join(dir, 'k.pem')), hosts: ['localhost'] });
  await new Promise((r) => capsula.listen(0, '127.0.0.1', r));
  t.after(() => capsula.close());
  const port = capsula.address().port;
  const pedir = (url) => new Promise((resolve, reject) => {
    const c = tls.connect({ host: '127.0.0.1', port, servername: 'localhost', rejectUnauthorized: false }, () => c.write(`${url}\r\n`));
    let d = '';
    c.on('data', (x) => (d += x)).on('end', () => resolve(d)).on('error', reject);
  });

  const portada = await pedir('gemini://localhost/');
  assert.ok(portada.startsWith('20 text/gemini') && portada.includes('=> /h/1 [Cultura] Libros'));
  const hilo = await pedir('gemini://localhost/h/1');
  assert.ok(hilo.includes('## Libros') && hilo.includes('> cita') && hilo.includes('=> https://prueba/h/1 Responder en la web'));
  assert.ok((await pedir('gemini://localhost/h/99')).startsWith('51'));
  assert.ok((await pedir('gemini://otro.sitio/')).startsWith('53'));
  // Auditoría 2026-09-25: un % inválido tiraba abajo todo el proceso (web incluida).
  assert.ok((await pedir('gemini://localhost/%E0')).startsWith('59'));
  assert.ok((await pedir('gemini://localhost/%ZZ')).startsWith('59'));
  assert.ok((await pedir('gemini://localhost/')).startsWith('20'), 'la cápsula sigue viva');
});

test('auditoría: texto y Gemini no dejan pasar controles ni sintaxis del usuario; /tema no redirige afuera', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  await s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: 'Prueba', cuerpo: '=> gemini://evil.example/ click\n### No.99 · OP falso\nhola' } });
  const { aGemtext } = await import('../src/documentos.js');
  const gem = aGemtext(s.documento('/h/1'), { baseUrl: 'https://prueba' });
  assert.ok(!/^=> gemini:\/\/evil/m.test(gem) && !/^### No\.99/m.test(gem));
  const txt = await s.texto('/h/1.txt');
  assert.ok(/^ {2}### No\.99/m.test(txt));
  // U+009B guardado antes del filtro nuevo no sale en la versión texto.
  s.db.prepare("UPDATE posts SET body = 'a' || char(155) || '31mb' WHERE id = 1").run();
  assert.ok(!(await s.texto('/h/1.txt')).includes(String.fromCharCode(155)));
  for (const malo of ['/\\evil.com', '//evil.com', '/\\/evil.com', 'https://evil.com', '/\tevil']) {
    const r = await s.pedir(`/tema?t=claro&volver=${encodeURIComponent(malo)}`);
    assert.equal(r.headers.get('location'), '/', malo);
  }
  assert.equal((await s.pedir('/tema?t=claro&volver=%2Fh%2F1')).headers.get('location'), '/h/1');
});

test('auditoría: una sola moderación en vuelo por cuenta', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const envios = Array.from({ length: 5 }, (_, i) =>
    s.pedir('/b/cultura/hilo', { sesion: ana, datos: { asunto: `Hilo ${i}`, cuerpo: 'texto' } }));
  await Promise.all(envios);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, 1);
});

test('doble toque: el mismo envío repetido termina en un solo mensaje y sin error', async (t) => {
  const s = await montar();
  t.after(s.cerrar);
  const ana = await s.entrar('ana');
  const datos = { asunto: 'Una vez', cuerpo: 'toqué dos veces' };
  const rs = await Promise.all([1, 2, 3].map(() => s.pedir('/b/cultura/hilo', { sesion: ana, datos })));
  assert.deepEqual(rs.map((r) => r.status), [303, 303, 303]);
  assert.deepEqual(new Set(rs.map((r) => r.headers.get('location'))).size, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, 1);
  // Un toque que llega cuando el primero ya terminó también va al mensaje existente.
  const tarde = await s.pedir('/b/cultura/hilo', { sesion: ana, datos });
  assert.equal(tarde.headers.get('location'), '/h/1');
  s.avanzar(31);
  await s.pedir('/h/1/responder', { sesion: ana, datos: { cuerpo: 'respuesta única' } });
  const otra = await s.pedir('/h/1/responder', { sesion: ana, datos: { cuerpo: 'respuesta única' } });
  assert.equal(otra.headers.get('location'), '/h/1#p2');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 2);
});
