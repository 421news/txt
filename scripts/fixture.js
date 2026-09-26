// Carga publicaciones de ejemplo (scripts/fixture-datos.js) en la base de desarrollo, con fechas de
// los últimos días. Escribe directo en la base, así que se puede correr con el server andando.
// Se puede correr varias veces: primero borra lo que haya cargado antes.
// Uso: npm run fixture            carga (o recarga) las publicaciones
//      npm run fixture -- --borrar  solo borra lo cargado
import '../src/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { boardBySlug } from '../src/config.js';
import { HILOS } from './fixture-datos.js';

// Señales de producción: NODE_ENV, el login de Google configurado o la base en el volumen /data.
if (
  process.env.NODE_ENV === 'production' ||
  process.env.GOOGLE_CLIENT_ID ||
  (process.env.DB_PATH || '').startsWith('/data')
) {
  console.error('El fixture es solo para desarrollo: no corre con NODE_ENV=production, GOOGLE_CLIENT_ID cargado ni DB_PATH en /data.');
  process.exit(1);
}

const raiz = fileURLToPath(new URL('..', import.meta.url));
const archivo = path.resolve(raiz, process.env.DB_PATH || 'data/textboard.db');
const db = openDb(archivo);
const PREFIJO = 'prueba:fixture-';
const USUARIOS = 16;
const MIN = 60_000;

// Azar con semilla: cada corrida arma las mismas conversaciones con los mismos tiempos relativos.
let semilla = 421;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));

const borrar = db.transaction(() => {
  const ids = db.prepare('SELECT id FROM users WHERE identidad LIKE ?').all(`${PREFIJO}%`).map((u) => u.id);
  if (!ids.length) return 0;
  const lista = JSON.stringify(ids);
  // Publicaciones abiertas por el fixture, con todo lo que tengan adentro (aunque responda otra cuenta).
  const hilos = db
    .prepare(`SELECT t.id FROM threads t JOIN posts p ON p.id = t.op_post_id WHERE p.user_id IN (SELECT value FROM json_each(?))`)
    .all(lista)
    .map((t) => t.id);
  const posts = `SELECT id FROM posts WHERE thread_id IN (SELECT value FROM json_each(@hilos)) OR user_id IN (SELECT value FROM json_each(@usuarios))`;
  const p = { hilos: JSON.stringify(hilos), usuarios: lista };
  db.prepare(`DELETE FROM busqueda WHERE rowid IN (${posts})`).run(p);
  db.prepare(`DELETE FROM notificaciones WHERE post_id IN (${posts})`).run(p);
  db.prepare(`DELETE FROM reports WHERE post_id IN (${posts})`).run(p);
  db.prepare(`UPDATE mod_log SET post_id = NULL WHERE post_id IN (${posts})`).run(p);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'guardados'").get()) {
    db.prepare('DELETE FROM guardados WHERE thread_id IN (SELECT value FROM json_each(?))').run(p.hilos);
  }
  // Si se entró con una cuenta del fixture y se respondió en otras publicaciones, esas respuestas
  // también se van y el contador de esas publicaciones se recalcula.
  const ajenos = db
    .prepare(`SELECT DISTINCT thread_id FROM posts WHERE user_id IN (SELECT value FROM json_each(@usuarios))
      AND thread_id NOT IN (SELECT value FROM json_each(@hilos))`)
    .all(p)
    .map((t) => t.thread_id);
  db.prepare(`DELETE FROM posts WHERE id IN (${posts})`).run(p);
  db.prepare(`UPDATE threads SET reply_count = (SELECT COUNT(*) FROM posts x
      WHERE x.thread_id = threads.id AND x.status = 'published' AND x.id != threads.op_post_id)
    WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ajenos));
  db.prepare('DELETE FROM threads WHERE id IN (SELECT value FROM json_each(?))').run(p.hilos);
  // Lo que haya hecho alguien que entró con una cuenta del fixture: sin esto, borrar el usuario falla por
  // las claves foráneas.
  db.prepare('DELETE FROM reports WHERE user_id IN (SELECT value FROM json_each(?))').run(lista);
  db.prepare('DELETE FROM rechazos WHERE user_id IN (SELECT value FROM json_each(?))').run(lista);
  db.prepare('UPDATE posts SET reviewed_by = NULL WHERE reviewed_by IN (SELECT value FROM json_each(?))').run(lista);
  db.prepare('DELETE FROM actividad_dia WHERE user_id IN (SELECT value FROM json_each(?))').run(lista);
  db.prepare('DELETE FROM users WHERE id IN (SELECT value FROM json_each(?))').run(lista);
  return hilos.length;
});

const cargar = db.transaction(() => {
  const ahora = Date.now();
  const crearUsuario = db.prepare('INSERT INTO users (identidad, role, created_at) VALUES (?, ?, ?)');
  const usuarios = [];
  for (let i = 1; i <= USUARIOS; i++) {
    const identidad = `${PREFIJO}${String(i).padStart(2, '0')}`;
    usuarios.push(Number(crearUsuario.run(identidad, 'user', ahora - 10 * 24 * 60 * MIN).lastInsertRowid));
  }

  // Primero se arma la línea de tiempo de todas las publicaciones y después se inserta en orden,
  // así los ids crecen con la fecha como en el sitio de verdad.
  const eventos = [];
  for (const [h, hilo] of HILOS.entries()) {
    if (!boardBySlug(hilo.tablon)) throw new Error(`Tablón desconocido: ${hilo.tablon}`);
    const autores = [];
    const libres = [...usuarios].sort(() => azar() - 0.5);
    let t = ahora - hilo.horas * 60 * MIN - entre(0, 40) * MIN;
    for (const [i, m] of hilo.mensajes.entries()) {
      const msj = typeof m === 'string' ? { t: m } : m;
      const texto = msj.op ?? msj.t;
      let autor;
      if (i === 0) autor = libres.shift();
      else if (msj.op !== undefined) autor = autores[0];
      else if (msj.de !== undefined) autor = autores[msj.de];
      else autor = libres.shift();
      if (autor === undefined) throw new Error(`"${hilo.asunto}", mensaje ${i}: autor inválido`);
      // Entre respuestas pasan de minutos a horas, sin pasarse de ahora: el tiempo que queda se reparte.
      if (i > 0) t += Math.min(entre(2, i < 4 ? 40 : 150) * MIN, (ahora - t) / (hilo.mensajes.length - i + 1));
      autores.push(autor);
      eventos.push({ h, i, autor, texto, sage: msj.sage ? 1 : 0, t });
    }
  }
  eventos.sort((a, b) => a.t - b.t);

  const insertarHilo = db.prepare('INSERT INTO threads (board, subject, created_at, bumped_at, visible) VALUES (?, ?, ?, ?, 1)');
  const insertarPost = db.prepare(`INSERT INTO posts (thread_id, user_id, body, sage, status, created_at, mod_decision, mod_rule, mod_model)
    VALUES (?, ?, ?, ?, 'published', ?, 'approve', 'ninguna', 'fixture')`);
  const buscar = db.prepare('INSERT INTO busqueda (rowid, asunto, cuerpo) VALUES (?, ?, ?)');
  const avisar = db.prepare('INSERT OR IGNORE INTO notificaciones (user_id, post_id, tipo, created_at, leida) VALUES (?, ?, ?, ?, 1)');
  const activo = db.prepare(`INSERT OR IGNORE INTO actividad_dia (dia, user_id)
    VALUES (strftime('%Y-%m-%d', ? / 1000, 'unixepoch', '-3 hours'), ?)`);
  const hiloId = [];
  const postIds = HILOS.map(() => []);
  const autoresDe = HILOS.map(() => []);

  for (const e of eventos) {
    const hilo = HILOS[e.h];
    // >>#N cita al mensaje N de la misma publicación: se reemplaza por su id real.
    const cuerpo = e.texto.replace(/>>#(\d+)/g, (_, n) => {
      if (postIds[e.h][n] === undefined) throw new Error(`"${hilo.asunto}": >>#${n} cita un mensaje que todavía no existe`);
      return `>>${postIds[e.h][n]}`;
    });
    if (e.i === 0) hiloId[e.h] = Number(insertarHilo.run(hilo.tablon, hilo.asunto, e.t, e.t).lastInsertRowid);
    const id = Number(insertarPost.run(hiloId[e.h], e.autor, cuerpo, e.sage, e.t).lastInsertRowid);
    postIds[e.h][e.i] = id;
    autoresDe[e.h][e.i] = e.autor;
    buscar.run(id, e.i === 0 ? hilo.asunto : '', cuerpo);
    activo.run(e.t, e.autor);
    if (e.i === 0) {
      db.prepare('UPDATE threads SET op_post_id = ? WHERE id = ?').run(id, hiloId[e.h]);
      continue;
    }
    for (const [, n] of e.texto.matchAll(/>>#(\d+)/g)) {
      const citado = autoresDe[e.h][n];
      if (citado !== e.autor) avisar.run(citado, id, 'respuesta', e.t);
    }
    if (autoresDe[e.h][0] !== e.autor) avisar.run(autoresDe[e.h][0], id, 'comentario', e.t);
    db.prepare(`UPDATE threads SET reply_count = reply_count + 1${e.sage ? '' : ', bumped_at = ?'} WHERE id = ?`).run(
      ...(e.sage ? [] : [e.t]),
      hiloId[e.h],
    );
  }
  return eventos.length;
});

const borradas = borrar();
if (borradas) console.log(`Se borraron ${borradas} publicaciones cargadas antes.`);
if (!process.argv.includes('--borrar')) {
  const n = cargar();
  console.log(`Listo: ${HILOS.length} publicaciones y ${n - HILOS.length} respuestas en ${archivo}.`);
  console.log(`Para entrar como una de esas cuentas, en /entrar usá el nombre fixture-01 a fixture-${USUARIOS}.`);
}
db.close();
