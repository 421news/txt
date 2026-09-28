import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';

// La forma de las consultas de los listados (marcarNovedades, ultimasRespuestas): "de estos hilos, los publicados".
const DE_ESTOS_HILOS = `SELECT thread_id, COUNT(*) AS n FROM posts
  WHERE thread_id IN (SELECT value FROM json_each(?)) AND status = 'published' GROUP BY thread_id`;

test('al abrir una base con mensajes, los listados buscan por hilo y no recorren todos los publicados', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, 'textboard.db');

  let db = openDb(archivo);
  db.prepare("INSERT INTO users (identidad, role, created_at) VALUES ('prueba:x', 'user', 0)").run();
  const hilo = db.prepare("INSERT INTO threads (board, subject, created_at, bumped_at, visible) VALUES ('cultura', 'a', 0, 0, 1)");
  const post = db.prepare("INSERT INTO posts (thread_id, user_id, body, status, created_at) VALUES (?, 1, 'hola', 'published', 0)");
  // 50 publicaciones de 20 mensajes, todos publicados: pocos mensajes por publicación y todos con el
  // mismo estado, que es lo que las estadísticas tienen que descubrir.
  db.transaction(() => {
    for (let h = 0; h < 50; h++) {
      const id = hilo.run().lastInsertRowid;
      for (let i = 0; i < 20; i++) post.run(id);
    }
  })();
  db.close();

  // Como al reiniciar el server con una base que ya tiene mensajes.
  db = openDb(archivo);
  // EXPLAIN QUERY PLAN dice qué índice usaría SQLite, sin ejecutar la consulta. Tiene que ser el de
  // publicación (posts_thread) y no el de estado (posts_status).
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${DE_ESTOS_HILOS}`).all('[1,2,3]').map((f) => f.detail).join('\n');
  db.close();
  assert.match(plan, /posts_thread/);
  assert.doesNotMatch(plan, /posts_status/);
});
