import { sinSpoilers } from './format.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const ESQUEMA = `
-- identidad: 'google:<sub>' (o 'prueba:<nombre>' en desarrollo). No se guarda el correo.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  identidad TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'mod', 'admin')),
  created_at INTEGER NOT NULL,
  banned_until INTEGER,
  ban_reason TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY,
  board TEXT NOT NULL,
  subject TEXT NOT NULL,
  op_post_id INTEGER,
  created_at INTEGER NOT NULL,
  bumped_at INTEGER NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS threads_board ON threads (board, visible, archived, bumped_at);

-- status: published (visible) · queued (espera a un mod; solo lo ve el autor) · removed (bajado por un mod)
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads (id),
  user_id INTEGER NOT NULL REFERENCES users (id),
  body TEXT NOT NULL,
  sage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('published', 'queued', 'removed')),
  created_at INTEGER NOT NULL,
  mod_decision TEXT,
  mod_rule TEXT,
  mod_reason TEXT,
  mod_model TEXT,
  mod_input_tokens INTEGER,
  mod_output_tokens INTEGER,
  reviewed_by INTEGER REFERENCES users (id),
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS posts_thread ON posts (thread_id, id);
CREATE INDEX IF NOT EXISTS posts_user ON posts (user_id, created_at);
CREATE INDEX IF NOT EXISTS posts_status ON posts (status);

-- Lo que el filtro rechazó antes de publicarse. Sirve de auditoría y para frenar a quien insiste.
CREATE TABLE IF NOT EXISTS rechazos (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  board TEXT NOT NULL,
  thread_id INTEGER,
  subject TEXT,
  body TEXT NOT NULL,
  rule TEXT,
  reason TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rechazos_user ON rechazos (user_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts (id),
  user_id INTEGER NOT NULL REFERENCES users (id),
  motivo TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS mod_log (
  id INTEGER PRIMARY KEY,
  mod_id INTEGER,
  accion TEXT NOT NULL,
  post_id INTEGER,
  target_user_id INTEGER,
  nota TEXT,
  created_at INTEGER NOT NULL
);

-- Avisos dentro del sitio (sin mail ni push): alguien comentó en tu publicación o te citó con >>N.
-- Se crean cuando un post se publica; si después se elimina, deja de mostrarse (se filtra por posts.status).
CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts (id),
  tipo TEXT NOT NULL CHECK (tipo IN ('comentario', 'respuesta', 'guardado')),
  created_at INTEGER NOT NULL,
  leida INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS notificaciones_usuario ON notificaciones (user_id, leida);

-- Publicaciones guardadas para leer después. Solo las ve quien las guardó.
CREATE TABLE IF NOT EXISTS guardados (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES threads (id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, thread_id)
);

-- Lo que cada cuenta eligió ignorar (/p/:id/ignorar). Solo lo ve quien ignora: no se oculta a nadie
-- más ni le llega nada al otro. Lo ignorado se muestra colapsado y va al final de los listados.
-- entity_type · entity_id: 'hilo' · id de la publicación; 'mensaje' · id del mensaje; 'autor' · su ID
-- pseudoanónimo en esa publicación (posts.author_id), que no vale en ninguna otra.
CREATE TABLE IF NOT EXISTS ignorados (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('hilo', 'mensaje', 'autor')),
  entity_id TEXT NOT NULL,
  ignored_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id)
);
`;

export function openDb(archivo) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const db = new Database(archivo);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // Avisos de publicaciones guardadas (2026-09-26): el CHECK de `tipo` no se puede cambiar con ALTER,
  // así que una base vieja se migra copiando la tabla.
  const avisos = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'notificaciones'").get();
  if (avisos && !avisos.sql.includes("'guardado'")) {
    db.transaction(() => {
      db.exec('ALTER TABLE notificaciones RENAME TO notificaciones_vieja');
      db.exec('DROP INDEX IF EXISTS notificaciones_usuario');
      db.exec(ESQUEMA);
      db.exec('INSERT INTO notificaciones SELECT * FROM notificaciones_vieja');
      db.exec('DROP TABLE notificaciones_vieja');
    })();
  }
  db.exec(ESQUEMA);
  const columnas = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!columnas.includes('identidad')) {
    throw new Error(`${archivo} tiene el esquema viejo (login por correo). Movelo a otra carpeta y reiniciá: se crea una base nueva.`);
  }
  // Tokens cacheados del filtro (agregados el 2026-09-25): input_tokens queda como lo no cacheado.
  const agregar = (tabla, col) => {
    if (!db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} INTEGER`);
  };
  // Fijada por un mod: momento en que se fijó (null = no fijada). Va primero en portada y sección.
  agregar('threads', 'fijado');
  agregar('posts', 'mod_cache_read_tokens');
  agregar('posts', 'mod_cache_write_tokens');
  agregar('rechazos', 'cache_read_tokens');
  agregar('rechazos', 'cache_write_tokens');
  agregar('rechazos', 'grave');
  // ID pseudoanónimo de cada mensaje (el de "ID abc12345", único por persona y publicación), guardado
  // para poder ignorar a un autor dentro de una publicación. Lo completa completarAutores.
  if (!db.prepare('PRAGMA table_info(posts)').all().some((c) => c.name === 'author_id')) {
    db.exec('ALTER TABLE posts ADD COLUMN author_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS posts_autor ON posts (thread_id, author_id)');
  db.exec('CREATE INDEX IF NOT EXISTS threads_portada ON threads (visible, archived, bumped_at)');
  db.exec('CREATE INDEX IF NOT EXISTS threads_op ON threads (op_post_id)');
  // Estadísticas para mods (/mod/estadisticas). Visitas contadas en el servidor, sin cookies ni IPs:
  // `visitantes_dia` guarda un hash con sal diaria (que vive solo en memoria) para no contar dos veces
  // a la misma persona en el día; se vacía al cambiar de día. `actividad_dia`: qué cuentas usaron el
  // sitio cada día (para "usuarios activos").
  db.exec(`CREATE TABLE IF NOT EXISTS visitas_dia (dia TEXT PRIMARY KEY, vistas INTEGER NOT NULL DEFAULT 0, visitantes INTEGER NOT NULL DEFAULT 0)`);
  // estimado = 1: día anterior al conteo propio, estimado a partir de los requests que registra Railway.
  agregar('visitas_dia', 'estimado');
  db.exec(`CREATE TABLE IF NOT EXISTS visitantes_dia (dia TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (dia, h))`);
  db.exec(`CREATE TABLE IF NOT EXISTS actividad_dia (dia TEXT NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (dia, user_id))`);
  // Historial de usuarios activos anterior a que se contaran las visitas (2026-09-25): se reconstruye con
  // lo que ya está en la base (inicios de sesión, mensajes, rechazos y reportes). Idempotente.
  const dia = (col) => `strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch', '-3 hours')`;
  db.exec(`INSERT OR IGNORE INTO actividad_dia (dia, user_id)
    SELECT ${dia('created_at')}, user_id FROM sessions
    UNION SELECT ${dia('created_at')}, user_id FROM posts
    UNION SELECT ${dia('created_at')}, user_id FROM rechazos
    UNION SELECT ${dia('created_at')}, user_id FROM reports`);
  // Prueba en sombra de Jev (sombra.js): lo que decidió Claude y lo que habría decidido Jev.
  db.exec(`CREATE TABLE IF NOT EXISTS sombra_jev (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL,
    tablon TEXT, es_hilo INTEGER, asunto TEXT, cuerpo TEXT,
    claude_decision TEXT, claude_rule TEXT, claude_grave TEXT,
    jev_decision TEXT, jev_rule TEXT, jev_grave TEXT,
    respuestas TEXT, tokens INTEGER, ms INTEGER, error TEXT
  )`);
  // Escribir desde Gemini: cada "llave" (certificado de cliente, por su huella SHA-256) se vincula
  // una vez con una cuenta de txt pegando en la web un código que da la cápsula. Sin cuenta de Google
  // detrás no se escribe: si alcanzara con el certificado, un suspendido volvería al minuto con otro.
  db.exec(`CREATE TABLE IF NOT EXISTS gemini_llaves (
    huella TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    ultimo_uso INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS gemini_codigos (codigo TEXT PRIMARY KEY, huella TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  // Búsqueda de texto completo (la lupa). rowid = id del post; el asunto va solo en el mensaje inicial.
  // Sin tildes ni mayúsculas. Qué se muestra se decide al consultar (publicado y publicación visible),
  // así que acá alcanza con que el texto esté al día.
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS busqueda USING fts5(asunto, cuerpo, tokenize = 'unicode61 remove_diacritics 2')`);
  // Lo que está entre [spoiler] no se indexa (2026-09-26): el fragmento de /buscar lo mostraba destapado.
  db.function('sin_spoilers', { deterministic: true }, (t) => sinSpoilers(t ?? ''));
  db.exec(`INSERT INTO busqueda (rowid, asunto, cuerpo)
    SELECT p.id, CASE WHEN t.op_post_id = p.id THEN t.subject ELSE '' END, sin_spoilers(p.body)
    FROM posts p JOIN threads t ON t.id = p.thread_id
    WHERE p.id NOT IN (SELECT rowid FROM busqueda)`);
  // Los ya indexados con el spoiler adentro (antes de ese cambio). Solo toca los que lo tienen.
  db.exec(`UPDATE busqueda SET cuerpo = sin_spoilers(cuerpo) WHERE rowid IN (SELECT id FROM posts WHERE body LIKE '%[spoiler]%')
    AND cuerpo LIKE '%[spoiler]%[/spoiler]%'`);
  // Estadísticas para que SQLite elija bien los índices: sin ellas, los listados recorrían todos los
  // mensajes publicados. 0x10002 es lo que recomienda sqlite.org/pragma.html#pragma_optimize para
  // servidores que abren la base al arrancar y la dejan abierta. Si no se pueden calcular, queda en el
  // log y la base se abre igual.
  try {
    db.pragma('optimize = 0x10002');
  } catch (err) {
    console.error('[estadísticas] No se pudieron calcular al abrir la base:', err);
  }
  return db;
}

// Migración de posts.author_id: el ID pseudoanónimo sale de SECRET, que la base no conoce, así que
// la corre la aplicación al arrancar y completa los mensajes que no lo tienen (los de antes de la
// columna). Devuelve cuántos mensajes tocó.
export function completarAutores(db, autorDe) {
  const filas = db.prepare('SELECT id, user_id, thread_id FROM posts WHERE author_id IS NULL').all();
  const poner = db.prepare('UPDATE posts SET author_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const p of filas) poner.run(autorDe(p.user_id, p.thread_id), p.id);
  })();
  return filas.length;
}

export function limpiarVencidos(db, ahora = Date.now()) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(ahora);
}
