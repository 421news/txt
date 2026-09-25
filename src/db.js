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
  tipo TEXT NOT NULL CHECK (tipo IN ('comentario', 'respuesta')),
  created_at INTEGER NOT NULL,
  leida INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS notificaciones_usuario ON notificaciones (user_id, leida);
`;

export function openDb(archivo) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const db = new Database(archivo);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(ESQUEMA);
  const columnas = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!columnas.includes('identidad')) {
    throw new Error(`${archivo} tiene el esquema viejo (login por correo). Movelo a otra carpeta y reiniciá: se crea una base nueva.`);
  }
  // Tokens cacheados del filtro (agregados el 2026-09-25): input_tokens queda como lo no cacheado.
  const agregar = (tabla, col) => {
    if (!db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} INTEGER`);
  };
  agregar('posts', 'mod_cache_read_tokens');
  agregar('posts', 'mod_cache_write_tokens');
  agregar('rechazos', 'cache_read_tokens');
  agregar('rechazos', 'cache_write_tokens');
  agregar('rechazos', 'grave');
  db.exec('CREATE INDEX IF NOT EXISTS threads_portada ON threads (visible, archived, bumped_at)');
  db.exec('CREATE INDEX IF NOT EXISTS threads_op ON threads (op_post_id)');
  return db;
}

export function limpiarVencidos(db, ahora = Date.now()) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(ahora);
}
