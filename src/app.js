import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BOARDS, LIMITS, boardBySlug } from './config.js';
import { NORMAS } from './normas.js';
import * as V from './views.js';
import { extracto, textoPlano } from './format.js';
import * as D from './documentos.js';
import { decisionJev, PRECIO_JEV_POR_MTOK } from './sombra.js';

const DIA = 86_400_000;
const TEMAS = ['claro', 'oscuro', 'descanso', 'monocromo'];
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function leerCookies(header = '') {
  const out = {};
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    try {
      out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
    } catch {
      // cookie mal formada: se ignora
    }
  }
  return out;
}

// Caracteres de control, de ancho cero y de dirección (se usan para esconder texto o dar vuelta
// palabras). Se arma con códigos para que el archivo no tenga caracteres invisibles adentro.
// Desde la auditoría del 2026-09-25 cubre todas las categorías Unicode Cc (controles, incluidos los
// C1 como U+009B, que algunas terminales leen como secuencias de escape) y Cf (formato: ancho cero,
// dirección, U+00AD, los "tag" U+E0000-E007F que sirven para esconderle texto al filtro).
// Se respetan \n y \t.
const INVISIBLES = /(?![\n\t])[\p{Cc}\p{Cf}]/gu;

// Normaliza lo que escribe el usuario: saca caracteres invisibles y colapsa líneas vacías de más.
export function limpiarTexto(valor) {
  if (typeof valor !== 'string') return '';
  return valor
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLES, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createApp({
  db,
  moderar,
  google = null,
  loginDePrueba = false,
  secret,
  baseUrl,
  siteName,
  adminEmails = [],
  production = false,
  now = Date.now,
  geminiUrl = null,
  codigoUrl = null,
  sombra = null,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const hmac = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  const anonId = (userId, threadId) => hmac(`anon:${userId}:${threadId}`).slice(0, 8);
  const esMod = (u) => !!u && (u.role === 'mod' || u.role === 'admin');
  const suspendido = (u) => !!u.banned_until && u.banned_until > now();
  const iguales = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  const q = {
    sesion: db.prepare(`SELECT u.id, u.role, u.created_at, u.banned_until, u.ban_reason, s.id_hash
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?`),
    hilo: db.prepare('SELECT * FROM threads WHERE id = ?'),
    post: db.prepare('SELECT * FROM posts WHERE id = ?'),
    contarPortada: db.prepare('SELECT COUNT(*) AS n FROM threads WHERE visible = 1 AND archived = 0'),
    hilosPortada: db.prepare(`SELECT t.*, p.body AS op_body, p.user_id AS op_user_id, p.created_at AS op_created_at
      FROM threads t JOIN posts p ON p.id = t.op_post_id
      WHERE t.visible = 1 AND t.archived = 0 ORDER BY t.bumped_at DESC LIMIT ? OFFSET ?`),
    contarTablon: db.prepare('SELECT COUNT(*) AS n FROM threads WHERE board = ? AND visible = 1 AND archived = ?'),
    hilosTablon: db.prepare(`SELECT t.*, p.body AS op_body, p.user_id AS op_user_id, p.created_at AS op_created_at
      FROM threads t JOIN posts p ON p.id = t.op_post_id
      WHERE t.board = ? AND t.visible = 1 AND t.archived = ? ORDER BY t.bumped_at DESC LIMIT ? OFFSET ?`),
    // Las últimas N respuestas publicadas de cada hilo de la lista (ids en JSON), sin el mensaje inicial.
    ultimasRespuestas: db.prepare(`SELECT * FROM (
        SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.thread_id ORDER BY p.id DESC) AS rn
        FROM posts p JOIN threads t ON t.id = p.thread_id
        WHERE p.thread_id IN (SELECT value FROM json_each(?)) AND p.status = 'published' AND p.id != t.op_post_id
      ) WHERE rn <= ? ORDER BY thread_id, id`),
    postsHilo: db.prepare(
      `SELECT * FROM posts WHERE thread_id = ? AND (status IN ('published', 'removed') OR user_id = ?) ORDER BY id`,
    ),
    postsHiloMod: db.prepare('SELECT * FROM posts WHERE thread_id = ? ORDER BY id'),
    insertarHilo: db.prepare('INSERT INTO threads (board, subject, created_at, bumped_at) VALUES (?, ?, ?, ?)'),
    fijarOp: db.prepare('UPDATE threads SET op_post_id = ? WHERE id = ?'),
    insertarPost: db.prepare(`INSERT INTO posts
      (thread_id, user_id, body, sage, status, created_at, mod_decision, mod_rule, mod_reason, mod_model, mod_input_tokens, mod_output_tokens, mod_cache_read_tokens, mod_cache_write_tokens)
      VALUES (@thread_id, @user_id, @body, @sage, @status, @created_at, @decision, @rule, @reason, @model, @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens)`),
    insertarRechazo: db.prepare(`INSERT INTO rechazos
      (user_id, board, thread_id, subject, body, rule, reason, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, grave, created_at)
      VALUES (@user_id, @board, @thread_id, @subject, @body, @rule, @reason, @model, @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @grave, @created_at)`),
    actualizarEstado: db.prepare('UPDATE posts SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?'),
    ultimoPost: db.prepare('SELECT MAX(created_at) AS t FROM posts WHERE user_id = ?'),
    ultimoHilo: db.prepare(
      'SELECT MAX(p.created_at) AS t FROM threads t JOIN posts p ON p.id = t.op_post_id WHERE p.user_id = ?',
    ),
    rechazosRecientes: db.prepare('SELECT COUNT(*) AS n FROM rechazos WHERE user_id = ? AND created_at > ?'),
    insertarReporte: db.prepare(
      'INSERT OR IGNORE INTO reports (post_id, user_id, motivo, created_at) VALUES (?, ?, ?, ?)',
    ),
    contarReportes: db.prepare('SELECT COUNT(*) AS n FROM reports WHERE post_id = ? AND resolved = 0'),
    resolverReportes: db.prepare('UPDATE reports SET resolved = 1 WHERE post_id = ?'),
    banear: db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?'),
    log: db.prepare(
      'INSERT INTO mod_log (mod_id, accion, post_id, target_user_id, nota, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    usuarioPorIdentidad: db.prepare('SELECT * FROM users WHERE identidad = ?'),
    contarNovedades: db.prepare(`SELECT COUNT(*) AS n FROM notificaciones x JOIN posts p ON p.id = x.post_id
      JOIN threads t ON t.id = p.thread_id
      WHERE x.user_id = ? AND x.leida = 0 AND p.status = 'published' AND t.visible = 1`),
    notificaciones: db.prepare(`SELECT x.tipo, x.leida, x.created_at, p.id AS post_id, p.body, t.id AS thread_id, t.subject
      FROM notificaciones x JOIN posts p ON p.id = x.post_id JOIN threads t ON t.id = p.thread_id
      WHERE x.user_id = ? AND p.status = 'published' AND t.visible = 1 ORDER BY x.id DESC LIMIT 100`),
    marcarLeidas: db.prepare('UPDATE notificaciones SET leida = 1 WHERE user_id = ? AND leida = 0'),
    guardado: db.prepare('SELECT 1 FROM guardados WHERE user_id = ? AND thread_id = ?'),
    guardar: db.prepare('INSERT OR IGNORE INTO guardados (user_id, thread_id, created_at) VALUES (?, ?, ?)'),
    olvidar: db.prepare('DELETE FROM guardados WHERE user_id = ? AND thread_id = ?'),
    guardados: db.prepare(`SELECT t.id, t.subject, t.board, t.reply_count, t.bumped_at, t.archived
      FROM guardados g JOIN threads t ON t.id = g.thread_id
      WHERE g.user_id = ? AND t.visible = 1 ORDER BY g.created_at DESC LIMIT 200`),
    crearUsuario: db.prepare('INSERT INTO users (identidad, role, created_at) VALUES (?, ?, ?)'),
    hacerAdmin: db.prepare("UPDATE users SET role = 'admin' WHERE id = ?"),
    quitarAdmin: db.prepare("UPDATE users SET role = 'user' WHERE id = ?"),
    crearSesion: db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    borrarSesion: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
    colaMod: db.prepare(`SELECT p.*, t.board, t.subject, u.created_at AS user_created,
        (SELECT COUNT(*) FROM posts x WHERE x.user_id = p.user_id AND x.status = 'removed') AS eliminados,
        (SELECT group_concat(r.motivo, ', ') FROM reports r WHERE r.post_id = p.id AND r.resolved = 0) AS reportes
      FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id
      WHERE p.status = 'queued' ORDER BY p.created_at`),
    reportadosMod: db.prepare(`SELECT p.*, t.board, t.subject, u.created_at AS user_created,
        (SELECT COUNT(*) FROM posts x WHERE x.user_id = p.user_id AND x.status = 'removed') AS eliminados,
        (SELECT group_concat(r.motivo, ', ') FROM reports r WHERE r.post_id = p.id AND r.resolved = 0) AS reportes
      FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id
      WHERE p.status = 'published' AND EXISTS (SELECT 1 FROM reports r WHERE r.post_id = p.id AND r.resolved = 0)
      ORDER BY p.created_at`),
  };

  // --- Efectos de publicar y retirar -------------------------------------------------------

  function archivarExcedentes(board) {
    db.prepare(`UPDATE threads SET archived = 1
      WHERE board = ? AND archived = 0 AND visible = 1 AND id NOT IN (
        SELECT id FROM threads WHERE board = ? AND archived = 0 AND visible = 1 ORDER BY bumped_at DESC LIMIT ?
      )`).run(board, board, LIMITS.hilosActivosPorTablon);
  }

  // Avisos: a quien fue citado con >>N ('respuesta') y al autor de la publicación ('comentario').
  // Nunca a uno mismo; si alguien es citado y además es el OP, recibe un solo aviso (UNIQUE).
  function notificar(p, t) {
    const insertar = db.prepare('INSERT OR IGNORE INTO notificaciones (user_id, post_id, tipo, created_at) VALUES (?, ?, ?, ?)');
    // Solo citas dentro de la misma publicación y como mucho 5 avisos por mensaje (antes un mensaje
    // con cientos de >>N avisaba a medio sitio).
    const citados = [...new Set([...p.body.matchAll(/>>(\d+)/g)].map((m) => Number(m[1])))].slice(0, 20);
    let avisados = 0;
    for (const n of citados) {
      const c = q.post.get(n);
      if (!c || c.thread_id !== p.thread_id || c.status !== 'published' || c.user_id === p.user_id) continue;
      if (insertar.run(c.user_id, p.id, 'respuesta', now()).changes && ++avisados >= 5) break;
    }
    if (t.op_post_id !== p.id) {
      const autorOp = q.post.get(t.op_post_id)?.user_id;
      if (autorOp && autorOp !== p.user_id) insertar.run(autorOp, p.id, 'comentario', now());
    }
  }

  function alPublicar(postId) {
    const p = q.post.get(postId);
    const t = q.hilo.get(p.thread_id);
    notificar(p, t);
    if (t.op_post_id === p.id) {
      db.prepare('UPDATE threads SET visible = 1, bumped_at = ? WHERE id = ?').run(now(), t.id);
      archivarExcedentes(t.board);
      return;
    }
    const n = t.reply_count + 1;
    const sube = !p.sage && n <= LIMITS.limiteBump;
    db.prepare('UPDATE threads SET reply_count = ?, bumped_at = ?, locked = ? WHERE id = ?').run(
      n,
      sube ? now() : t.bumped_at,
      n >= LIMITS.limiteRespuestas ? 1 : t.locked,
      t.id,
    );
  }

  function alRetirar(p) {
    const t = q.hilo.get(p.thread_id);
    if (t.op_post_id === p.id) db.prepare('UPDATE threads SET visible = 0 WHERE id = ?').run(t.id);
    else db.prepare('UPDATE threads SET reply_count = MAX(0, reply_count - 1) WHERE id = ?').run(t.id);
  }

  const cambiarEstado = db.transaction((postId, nuevo, { modId = null, accion, nota = null, resolver = true }) => {
    const p = q.post.get(postId);
    if (!p || p.status === nuevo) return false;
    q.actualizarEstado.run(nuevo, modId, now(), postId);
    if (p.status === 'published') alRetirar(p);
    if (nuevo === 'published') alPublicar(postId);
    if (resolver) q.resolverReportes.run(postId);
    q.log.run(modId, accion, postId, p.user_id, nota, now());
    return true;
  });

  function insertarPost(threadId, userId, cuerpo, sage, v) {
    const id = Number(
      q.insertarPost.run({
        thread_id: threadId,
        user_id: userId,
        body: cuerpo,
        sage,
        status: v.decision === 'approve' ? 'published' : 'queued',
        created_at: now(),
        decision: v.decision,
        rule: v.rule ?? null,
        reason: v.reason ?? null,
        model: v.model ?? null,
        input_tokens: v.input_tokens ?? null,
        output_tokens: v.output_tokens ?? null,
        cache_read_tokens: v.cache_read_tokens ?? null,
        cache_write_tokens: v.cache_write_tokens ?? null,
      }).lastInsertRowid,
    );
    db.prepare("INSERT INTO busqueda (rowid, asunto, cuerpo) VALUES (?, '', ?)").run(id, cuerpo);
    return id;
  }

  const crearHilo = db.transaction((board, asunto, userId, cuerpo, v) => {
    const threadId = Number(q.insertarHilo.run(board, asunto, now(), now()).lastInsertRowid);
    const postId = insertarPost(threadId, userId, cuerpo, 0, v);
    q.fijarOp.run(postId, threadId);
    db.prepare('UPDATE busqueda SET asunto = ? WHERE rowid = ?').run(asunto, postId);
    if (v.decision === 'approve') alPublicar(postId);
    return threadId;
  });

  const crearRespuesta = db.transaction((threadId, userId, cuerpo, sage, v) => {
    const postId = insertarPost(threadId, userId, cuerpo, sage ? 1 : 0, v);
    if (v.decision === 'approve') alPublicar(postId);
    return postId;
  });

  function registrarRechazo(userId, board, threadId, asunto, cuerpo, v) {
    q.insertarRechazo.run({
      user_id: userId,
      board,
      thread_id: threadId,
      subject: asunto,
      body: cuerpo,
      rule: v.rule ?? null,
      reason: v.reason ?? null,
      model: v.model ?? null,
      input_tokens: v.input_tokens ?? null,
      output_tokens: v.output_tokens ?? null,
      cache_read_tokens: v.cache_read_tokens ?? null,
      cache_write_tokens: v.cache_write_tokens ?? null,
      grave: v.grave && v.grave !== 'ninguna' ? v.grave : null,
      created_at: now(),
    });
    // Tolerancia cero: la cuenta queda suspendida en el acto, sin esperar a un mod. Menores:
    // permanente. Abuso y violencia explícita: 30 días. Queda en /mod para revisar o levantar.
    if (v.grave && v.grave !== 'ninguna') {
      const dias = v.grave === 'menores' ? 36500 : 30;
      q.banear.run(now() + dias * DIA, `Automática: ${v.grave}`, userId);
      q.log.run(null, `auto-suspender-${v.grave}`, null, userId, v.reason ?? null, now());
    }
  }

  function motivoBloqueo(user, tipo) {
    if (suspendido(user)) return `Tu cuenta está suspendida hasta el ${V.fecha(user.banned_until)}.`;
    if (q.rechazosRecientes.get(user.id, now() - 3_600_000).n >= LIMITS.rechazosPorHora) {
      return 'Tuviste muchos mensajes rechazados en la última hora. Probá de nuevo más tarde.';
    }
    const espera = LIMITS.segEntrePosts * 1000 - (now() - (q.ultimoPost.get(user.id).t ?? 0));
    if (espera > 0) return `Esperá ${Math.ceil(espera / 1000)} segundos antes de publicar otra vez.`;
    if (tipo === 'hilo') {
      const esperaHilo = LIMITS.segEntreHilos * 1000 - (now() - (q.ultimoHilo.get(user.id).t ?? 0));
      if (esperaHilo > 0) return `Podés hacer otra publicación en ${Math.ceil(esperaHilo / 60_000)} minutos.`;
    }
    return null;
  }

  // --- Estadísticas (sin cookies ni IPs guardadas) -------------------------------------------
  const diaDe = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_SITIO || 'America/Argentina/Buenos_Aires' }).format(new Date(ms));
  const BOT = /bot|crawl|spider|slurp|curl|wget|httpie|python|go-http|preview|monitor|uptime|facebookexternalhit|whatsapp/i;
  let sal = { dia: null, valor: null };
  const q_vista = db.prepare(`INSERT INTO visitas_dia (dia, vistas, visitantes) VALUES (?, 1, 0)
    ON CONFLICT (dia) DO UPDATE SET vistas = vistas + 1`);
  const q_visitante = db.prepare('INSERT OR IGNORE INTO visitantes_dia (dia, h) VALUES (?, ?)');
  const q_sumarVisitante = db.prepare('UPDATE visitas_dia SET visitantes = visitantes + 1 WHERE dia = ?');
  const q_activo = db.prepare('INSERT OR IGNORE INTO actividad_dia (dia, user_id) VALUES (?, ?)');
  // Solo páginas HTML vistas por personas: nada de /static, versión texto, la consulta en vivo ni bots.
  function contarVisita(req) {
    if (req.method !== 'GET') return;
    const ua = req.get('user-agent') ?? '';
    if (!ua || BOT.test(ua)) return;
    if (/^\/(static|auth)\/|\.(txt|xml)$|\/nuevos$|^\/(robots\.txt|favicon)/.test(req.path)) return;
    try {
      const dia = diaDe(now());
      if (sal.dia !== dia) {
        // Sal nueva cada día; los hashes del día anterior se borran: no se puede reconstruir quién fue.
        sal = { dia, valor: crypto.randomBytes(16).toString('hex') };
        db.prepare('DELETE FROM visitantes_dia WHERE dia != ?').run(dia);
      }
      q_vista.run(dia);
      const h = sha256(`${sal.valor}|${req.ip}|${ua}`).slice(0, 16);
      if (q_visitante.run(dia, h).changes) q_sumarVisitante.run(dia);
      if (req.user) q_activo.run(dia, req.user.id);
    } catch (err) {
      console.error('[estadísticas]', err.message);
    }
  }

  // --- Middleware ----------------------------------------------------------------------------

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    });
    next();
  });
  app.use(
    '/static',
    express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: production ? '1d' : 0 }),
  );
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // Desde la terminal (curl, wget, httpie) las páginas de lectura se sirven en texto plano en la
  // misma dirección: `curl txt.421.news` muestra la portada. Se reescribe a la ruta .txt.
  const TERMINAL = /^(curl|wget|httpie)\//i;
  app.use((req, res, next) => {
    res.vary('User-Agent');
    if (req.method !== 'GET' || !TERMINAL.test(req.get('user-agent') ?? '')) return next();
    const [camino, query] = req.url.split('?');
    if (/^\/(|b\/[a-z-]+|b\/[a-z-]+\/archivo|h\/\d+|normas)$/.test(camino)) {
      req.url = D.rutaTxt(camino) + (query ? `?${query}` : '');
    }
    next();
  });

  app.use((req, res, next) => {
    req.user = null;
    req.csrf = null;
    const sid = leerCookies(req.headers.cookie).sid;
    if (sid) {
      const u = q.sesion.get(sha256(sid), now());
      if (u) {
        req.user = u;
        req.csrf = hmac(`csrf:${u.id_hash}`);
      }
    }
    contarVisita(req);
    // Las páginas con sesión llevan el token CSRF y datos propios: que ninguna caché intermedia las guarde.
    if (req.user) res.set('Cache-Control', 'private, no-store');
    const novedades = req.user ? q.contarNovedades.get(req.user.id).n : 0;
    const tema = TEMAS.includes(leerCookies(req.headers.cookie).tema) ? leerCookies(req.headers.cookie).tema : null;
    res.locals.ctx = { user: req.user, csrf: req.csrf, siteName, baseUrl, ahora: now(), novedades, tema, ruta: req.originalUrl, codigoUrl, sombraActiva: !!sombra };
    if (req.method === 'POST') {
      const origen = req.get('origin');
      if (origen && origen !== `${req.protocol}://${req.get('host')}`) return res.status(403).send('Origen no permitido');
    }
    next();
  });

  const enviar = (res, opciones, status = 200) => res.status(status).send(V.pagina(res.locals.ctx, opciones));
  const noEncontrado = (res) =>
    enviar(res, { titulo: 'No encontrado', indexar: false, cuerpo: V.mensaje('No encontrado', 'Esa página no existe o ya no está disponible.') }, 404);

  function exigirUsuario(req, res) {
    if (!req.user) {
      res.redirect(303, '/entrar');
      return false;
    }
    if (!iguales(req.body?._csrf, req.csrf)) {
      enviar(res, { titulo: 'Formulario vencido', cuerpo: V.mensaje('Formulario vencido', 'Recargá la página y probá de nuevo.') }, 403);
      return false;
    }
    return true;
  }

  function exigirMod(req, res) {
    if (!exigirUsuario(req, res)) return false;
    if (!esMod(req.user) || suspendido(req.user)) {
      noEncontrado(res);
      return false;
    }
    return true;
  }

  function paginar(req, total, porPagina) {
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const pagina = Math.min(paginas, Math.max(1, parseInt(req.query.pagina, 10) || 1));
    return { pagina, paginas, porPagina, offset: (pagina - 1) * porPagina };
  }

  // Catálogo por defecto; ?vista=lista muestra cada hilo con sus últimas respuestas.
  const vistaDe = (req) => (req.query.vista === 'lista' ? 'lista' : 'catalogo');
  const porPaginaDe = (vista) => (vista === 'lista' ? LIMITS.hilosPorPagina : LIMITS.hilosPorPaginaCatalogo);

  // Cada hilo de un listado lleva su mensaje inicial, las últimas respuestas y cuántas quedaron afuera.
  function armarResumenes(hilos) {
    if (!hilos.length) return [];
    const ultimas = q.ultimasRespuestas.all(JSON.stringify(hilos.map((t) => t.id)), LIMITS.respuestasEnResumen);
    return hilos.map((t) => {
      const op = { id: t.op_post_id, body: t.op_body, user_id: t.op_user_id, created_at: t.op_created_at, status: 'published', sage: 0 };
      const respuestas = ultimas.filter((p) => p.thread_id === t.id);
      for (const p of [op, ...respuestas]) {
        p.anon = anonId(p.user_id, t.id);
        p.esAutorOp = p.user_id === t.op_user_id;
      }
      return { ...t, op, respuestas, omitidas: Math.max(0, t.reply_count - respuestas.length) };
    });
  }

  // Canonical de un listado: la vista de lista duplica al catálogo, así que no se indexa; en el
  // catálogo, la página 1 va sin parámetro.
  const seoListado = (ruta, vista, pagina) => ({
    canonical: pagina > 1 ? `${ruta}?pagina=${pagina}` : ruta,
    indexar: vista !== 'lista',
  });

  // La URL de la página, no la del POST que la dibujó. /hilo, /b/:board/hilo y /h/:id/responder
  // solo aceptan POST: si el botón de tema volvía a la ruta del request, el 303 caía en un 404 y,
  // además, se perdía el formulario (que era el motivo de volver).
  // `sin` saca parámetros que son de una sola vez, no parte de la página: ?cita= vuelve a escribir
  // el >>N en el mensaje, y ese mensaje ya está en el borrador.
  const rutaDeLaPagina = (req, camino, sin = []) => {
    const query = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    for (const nombre of sin) query.delete(nombre);
    const resto = query.toString();
    return resto ? `${camino}?${resto}` : camino;
  };

  function renderPortada(req, res, { form = { abrir: !!req.query.publicar }, status = 200 } = {}) {
    res.locals.ctx.ruta = rutaDeLaPagina(req, '/');
    const vista = vistaDe(req);
    const { pagina, paginas, porPagina, offset } = paginar(req, q.contarPortada.get().n, porPaginaDe(vista));
    const filas = q.hilosPortada.all(porPagina, offset);
    const hilos = vista === 'lista' ? armarResumenes(filas) : filas;
    const cuerpo = V.portada(res.locals.ctx, { hilos, vista, pagina, paginas, form });
    enviar(res, { cuerpo, aviso: req.query.aviso, ...seoListado('/', vista, pagina) }, status);
  }

  function renderTablon(req, res, board, { archivo = false, form = { abrir: !!req.query.publicar }, status = 200 } = {}) {
    res.locals.ctx.ruta = rutaDeLaPagina(req, `/b/${board.slug}${archivo ? '/archivo' : ''}`);
    const vista = vistaDe(req);
    const total = q.contarTablon.get(board.slug, archivo ? 1 : 0).n;
    const { pagina, paginas, porPagina, offset } = paginar(req, total, porPaginaDe(vista));
    const filas = q.hilosTablon.all(board.slug, archivo ? 1 : 0, porPagina, offset);
    const hilos = vista === 'lista' ? armarResumenes(filas) : filas;
    const cuerpo = V.tablon(res.locals.ctx, { board, hilos, vista, pagina, paginas, archivo, form });
    const ruta = archivo ? `/b/${board.slug}/archivo` : `/b/${board.slug}`;
    enviar(
      res,
      {
        titulo: archivo ? `Archivo de ${board.nombre}` : board.nombre,
        descripcion: `${board.descripcion} Publicaciones de la sección ${board.nombre} en txt, el foro de texto de 421.`,
        cuerpo,
        aviso: req.query.aviso,
        ...seoListado(ruta, vista, pagina),
      },
      status,
    );
  }

  // Los posts de una publicación tal como los ve este lector, con ID pseudoanónimo, marcas y
  // respuestas entrantes. Lo usan la página y la actualización en vivo (/h/:id/nuevos).
  function postsVisibles(req, thread) {
    const posts = esMod(req.user) ? q.postsHiloMod.all(thread.id) : q.postsHilo.all(thread.id, req.user?.id ?? -1);
    const autorOp = q.post.get(thread.op_post_id).user_id;
    const ids = new Set(posts.map((p) => p.id));
    // Respuestas entrantes de cada post (los >>N que lo citan), para seguir una discusión adentro
    // de la publicación sin anidar. Solo cuentan los posts publicados que ve el lector.
    const respuestas = new Map();
    for (const p of posts) {
      p.anon = anonId(p.user_id, thread.id);
      p.esAutorOp = p.user_id === autorOp;
      p.esMio = !!req.user && p.user_id === req.user.id;
      if (p.status !== 'published') continue;
      for (const n of new Set([...p.body.matchAll(/>>(\d+)/g)].map((m) => Number(m[1])))) {
        if (n !== p.id && ids.has(n)) respuestas.set(n, [...(respuestas.get(n) ?? []), p.id]);
      }
    }
    for (const p of posts) p.respuestas = respuestas.get(p.id) ?? [];
    return { posts, ids };
  }

  // Publicación abierta a la vista de este lector (la misma regla que GET /h/:id).
  function hiloVisible(req, id) {
    const thread = q.hilo.get(id);
    if (!thread) return null;
    const autorOp = q.post.get(thread.op_post_id)?.user_id;
    if (!thread.visible && !(req.user && (req.user.id === autorOp || esMod(req.user)))) return null;
    return thread;
  }

  function renderHilo(req, res, thread, form = {}, status = 200) {
    res.locals.ctx.ruta = rutaDeLaPagina(req, `/h/${thread.id}`, ['cita']);
    const board = boardBySlug(thread.board);
    const { posts, ids } = postsVisibles(req, thread);
    // ?cita=N abre el formulario con >>N ya escrito (no hay JavaScript). `cita` marca el campo para
    // que formularios.js sume el >>N al borrador que ya había, en vez de pisarlo.
    const cita = Number(req.query.cita);
    if (!form.cuerpo && ids.has(cita)) form = { ...form, cuerpo: `>>${cita}\n`, cita };
    const guardado = !!req.user && !!q.guardado.get(req.user.id, thread.id);
    const cuerpo = V.hilo(res.locals.ctx, { thread, board, posts, ids, form, guardado });
    const op = posts.find((p) => p.id === thread.op_post_id);
    const publica = thread.visible && op?.status === 'published';
    const resumen = publica ? extracto(textoPlano(op.body), 155) : undefined;
    enviar(
      res,
      {
        titulo: thread.subject,
        descripcion: resumen,
        canonical: `/h/${thread.id}`,
        indexar: !!publica,
        tipo: 'article',
        jsonLd: publica ? jsonLdHilo(thread, board, op, posts) : undefined,
        cuerpo,
        aviso: req.query.aviso,
      },
      status,
    );
  }

  // Datos estructurados de foro (schema.org DiscussionForumPosting). Solo con lo publicado.
  function jsonLdHilo(thread, board, op, posts) {
    const autor = { '@type': 'Person', name: 'Pseudoanónimo' };
    const fecha = (t) => new Date(t).toISOString();
    return {
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      '@id': `${baseUrl}/h/${thread.id}`,
      url: `${baseUrl}/h/${thread.id}`,
      headline: thread.subject,
      text: textoPlano(op.body),
      datePublished: fecha(op.created_at),
      author: autor,
      articleSection: board?.nombre,
      isPartOf: { '@type': 'WebSite', name: siteName, url: baseUrl },
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: thread.reply_count,
      },
      comment: posts
        .filter((p) => p.id !== op.id && p.status === 'published')
        .slice(0, 50)
        .map((p) => ({ '@type': 'Comment', text: textoPlano(p.body), datePublished: fecha(p.created_at), author: autor })),
    };
  }

  // --- Lectura -------------------------------------------------------------------------------

  // --- Texto plano (documentos.js) ---------------------------------------------------------
  const enviarTexto = (res, bloques) =>
    res.type('text/plain; charset=utf-8').send(D.aTexto(bloques, { baseUrl }));
  const datosListado = (req, total, filas) => {
    const { pagina, paginas, porPagina, offset } = paginar(req, total, LIMITS.hilosPorPaginaCatalogo);
    return { pagina, paginas, hilos: filas(porPagina, offset) };
  };

  // Documento de una ruta de lectura, o null si no existe o no es visible para este lector. Lo usan
  // las rutas .txt y la cápsula Gemini (app.locals.documento, que lee como visitante sin sesión).
  function documento(req, ruta) {
    let m;
    if (ruta === '/') {
      const d = datosListado(req, q.contarPortada.get().n, (lim, off) => q.hilosPortada.all(lim, off));
      return D.docPortada({ siteName, ...d });
    }
    if ((m = ruta.match(/^\/b\/([a-z-]+)(\/archivo)?$/))) {
      const board = boardBySlug(m[1]);
      if (!board) return null;
      const archivo = !!m[2];
      const a = archivo ? 1 : 0;
      const d = datosListado(req, q.contarTablon.get(board.slug, a).n, (lim, off) => q.hilosTablon.all(board.slug, a, lim, off));
      return D.docTablon({ siteName, board, archivo, ...d });
    }
    if ((m = ruta.match(/^\/h\/(\d+)$/))) {
      const thread = hiloVisible(req, Number(m[1]));
      if (!thread) return null;
      const { posts } = postsVisibles(req, thread);
      return D.docHilo({ siteName, thread, board: boardBySlug(thread.board), posts });
    }
    if (ruta === '/normas') return D.docNormas({ siteName });
    return null;
  }
  app.locals.documento = (ruta, query = {}) => documento({ user: null, query }, ruta);

  // --- Escribir desde Gemini (src/gemini.js lo usa por app.locals.gemini) -------------------
  const VIGENCIA_CODIGO = 15 * 60_000;
  const MAX_LLAVES = 5;
  const q_g = {
    usuario: db.prepare(`SELECT u.id, u.role, u.created_at, u.banned_until, u.ban_reason, u.identidad
      FROM gemini_llaves g JOIN users u ON u.id = g.user_id WHERE g.huella = ?`),
    uso: db.prepare('UPDATE gemini_llaves SET ultimo_uso = ? WHERE huella = ?'),
    codigoDe: db.prepare('SELECT codigo FROM gemini_codigos WHERE huella = ? AND created_at > ?'),
    nuevoCodigo: db.prepare('INSERT INTO gemini_codigos (codigo, huella, created_at) VALUES (?, ?, ?)'),
    limpiarCodigos: db.prepare('DELETE FROM gemini_codigos WHERE created_at <= ?'),
  };
  // Sin letras ni números que se confundan al copiarlos a mano (0/O, 1/I/L).
  const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const generarCodigo = () => 'TXT-' + Array.from(crypto.randomBytes(6), (b) => ALFABETO[b % ALFABETO.length]).join('');

  async function escribirDesdeGemini(user, { thread, board, asunto = '', cuerpo }) {
    const esHilo = !thread;
    cuerpo = limpiarTexto(cuerpo);
    asunto = limpiarTexto(asunto).replace(/\n+/g, ' ');
    if (!cuentaVigente(user.id)) return { error: 'Tu cuenta no puede publicar.' };
    if (!cuerpo) return { error: 'El mensaje está vacío.' };
    if (cuerpo.length > LIMITS.cuerpo) return { error: `El mensaje puede tener hasta ${LIMITS.cuerpo} caracteres.` };
    if (esHilo && !asunto) return { error: 'Falta el asunto.' };
    if (asunto.length > LIMITS.asunto) return { error: `El asunto puede tener hasta ${LIMITS.asunto} caracteres.` };
    if (thread && (!thread.visible || thread.archived || thread.locked)) return { error: 'Esta publicación ya no acepta respuestas.' };
    const firma = firmaDe(esHilo ? 'hilo' : 'respuesta', esHilo ? board.slug : thread.id, asunto, cuerpo);
    if (enVuelo.get(user.id)?.firma === firma) return enVuelo.get(user.id).promesa;
    const repetido = reciente(user.id, cuerpo, thread?.id);
    if (repetido && !esHilo) return { destino: `/h/${thread.id}#p${repetido.id}` };
    if (repetido && q.hilo.get(repetido.thread_id)?.op_post_id === repetido.id) return { destino: `/h/${repetido.thread_id}` };
    const bloqueo = motivoBloqueo(user, esHilo ? 'hilo' : 'respuesta');
    if (bloqueo) return { error: bloqueo };
    return unaVez(user.id, firma, async () => {
      const tablon = esHilo ? board : boardBySlug(thread.board);
      const datos = { tablon: tablon.nombre, asunto: esHilo ? asunto : thread.subject, cuerpo, esHilo };
      const v = await moderar(datos);
      compararEnSombra(datos, v);
      if (!cuentaVigente(user.id)) return { error: 'Tu cuenta no puede publicar.' };
      if (v.decision === 'reject') {
        registrarRechazo(user.id, tablon.slug, thread?.id ?? null, esHilo ? asunto : null, cuerpo, v);
        return { error: 'No se publicó: el mensaje no cumple las normas.' };
      }
      if (esHilo) {
        const threadId = crearHilo(board.slug, asunto, user.id, cuerpo, v);
        return { destino: `/h/${threadId}`, enRevision: v.decision === 'queue' };
      }
      const ahora = q.hilo.get(thread.id);
      if (!ahora.visible || ahora.archived || ahora.locked) return { error: 'Esta publicación ya no acepta respuestas.' };
      const postId = crearRespuesta(thread.id, user.id, cuerpo, false, v);
      return { destino: `/h/${thread.id}#p${postId}`, enRevision: v.decision === 'queue' };
    });
  }

  app.locals.gemini = {
    // La cuenta vinculada a esta llave, o null.
    usuario(huella) {
      const u = q_g.usuario.get(huella);
      if (!u || u.identidad.startsWith('borrada:')) return null;
      q_g.uso.run(now(), huella);
      return u;
    },
    // Código para vincular esta llave desde la web (el mismo mientras esté vigente).
    codigo(huella) {
      q_g.limpiarCodigos.run(now() - VIGENCIA_CODIGO);
      const vigente = q_g.codigoDe.get(huella, now() - VIGENCIA_CODIGO);
      if (vigente) return vigente.codigo;
      const codigo = generarCodigo();
      q_g.nuevoCodigo.run(codigo, huella, now());
      return codigo;
    },
    secciones: BOARDS,
    hilo: (id) => q.hilo.get(id) ?? null,
    tablon: (slug) => boardBySlug(slug) ?? null,
    responder: (user, thread, cuerpo) => escribirDesdeGemini(user, { thread, cuerpo }),
    publicar: (user, board, asunto, cuerpo) => escribirDesdeGemini(user, { board, asunto, cuerpo }),
  };

  // Web: vincular una llave pegando el código que dio la cápsula, y desvincularlas.
  app.post('/cuenta/gemini', (req, res) => {
    if (!exigirUsuario(req, res)) return;
    const codigo = String(req.body.codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TXT/, 'TXT-');
    const fila = db.prepare('SELECT huella FROM gemini_codigos WHERE codigo = ? AND created_at > ?').get(codigo, now() - VIGENCIA_CODIGO);
    const cuantas = db.prepare('SELECT COUNT(*) AS n FROM gemini_llaves WHERE user_id = ?').get(req.user.id).n;
    let aviso = 'gemini-invalido';
    if (fila && suspendido(req.user)) aviso = 'gemini-suspendida';
    else if (fila && cuantas >= MAX_LLAVES) aviso = 'gemini-tope';
    else if (fila) {
      db.transaction(() => {
        db.prepare(`INSERT INTO gemini_llaves (huella, user_id, created_at) VALUES (?, ?, ?)
          ON CONFLICT (huella) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at`).run(fila.huella, req.user.id, now());
        db.prepare('DELETE FROM gemini_codigos WHERE huella = ?').run(fila.huella);
      })();
      aviso = 'gemini-ok';
    }
    res.redirect(303, `/cuenta?aviso=${aviso}#gemini`);
  });
  app.post('/cuenta/gemini/desvincular', (req, res) => {
    if (!exigirUsuario(req, res)) return;
    db.prepare('DELETE FROM gemini_llaves WHERE huella = ? AND user_id = ?').run(String(req.body.huella ?? ''), req.user.id);
    res.redirect(303, '/cuenta#gemini');
  });

  app.get(['/index.txt', '/b/:board.txt', '/b/:board/archivo.txt', '/h/:id.txt', '/normas.txt'], (req, res) => {
    const ruta = req.path === '/index.txt' ? '/' : req.path.replace(/\.txt$/, '');
    const bloques = documento(req, ruta);
    if (!bloques) return res.status(404).type('text/plain').send('No encontrado.\n');
    enviarTexto(res, bloques);
  });
  // Lupa: búsqueda de texto completo (FTS5, tabla `busqueda`). Cada palabra se busca como prefijo y
  // entre comillas, así nada de lo que escriba la persona se interpreta como sintaxis de FTS.
  app.get('/buscar', (req, res) => {
    const texto = limpiarTexto(String(req.query.q ?? '')).slice(0, 100).trim();
    const palabras = (texto.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
    let resultados = [];
    let pagina = 1;
    let paginas = 1;
    if (palabras.length) {
      const consulta = palabras.map((w) => `"${w}"*`).join(' ');
      const donde = `FROM busqueda JOIN posts p ON p.id = busqueda.rowid JOIN threads t ON t.id = p.thread_id
        WHERE busqueda MATCH ? AND p.status = 'published' AND t.visible = 1`;
      const total = db.prepare(`SELECT COUNT(*) AS n ${donde}`).get(consulta).n;
      ({ pagina, paginas } = paginar(req, total, 20));
      resultados = db
        .prepare(`SELECT p.id, p.thread_id, p.created_at, t.subject, t.board, t.archived, t.op_post_id = p.id AS es_op,
            snippet(busqueda, 1, char(1), char(2), '…', 16) AS fragmento
          ${donde} ORDER BY rank LIMIT 20 OFFSET ?`)
        .all(consulta, (pagina - 1) * 20);
      resultados.total = total;
    }
    enviar(res, {
      titulo: texto ? `Buscar: ${texto}` : 'Buscar',
      indexar: false,
      cuerpo: V.buscar(res.locals.ctx, { texto, resultados, pagina, paginas }),
    });
  });

  app.get('/texto', (req, res) =>
    enviar(res, { titulo: 'Versión texto', canonical: '/texto', descripcion: 'Cómo leer txt en texto puro: desde el navegador con .txt o desde la terminal con curl.', cuerpo: V.texto(res.locals.ctx, { gemini: geminiUrl }) }),
  );

  // Tema claro/oscuro sin JavaScript: una cookie que el servidor lee para marcar <html data-tema>.
  // "auto" la borra y el sitio vuelve a seguir la preferencia del sistema.
  app.get('/tema', (req, res) => {
    const t = String(req.query.t ?? '');
    if (TEMAS.includes(t)) res.cookie('tema', t, { sameSite: 'lax', secure: production, maxAge: 365 * DIA, path: '/' });
    else res.clearCookie('tema', { path: '/' });
    // Solo rutas del propio sitio. "/\\evil.com" pasaba el chequeo viejo y el navegador lo lee
    // como //evil.com (auditoría 2026-09-25).
    const volver = String(req.query.volver ?? '/');
    const seguro = /^\/(?![\/\\])[^\s\\]*$/.test(volver) && new URL(volver, baseUrl).origin === new URL(baseUrl).origin;
    res.redirect(303, seguro ? volver : '/');
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(
      ['User-agent: *', 'Disallow: /mod', 'Disallow: /auth/', 'Disallow: /p/', '', `Sitemap: ${baseUrl}/sitemap.xml`, ''].join('\n'),
    );
  });

  // Portada, secciones, páginas fijas y todas las publicaciones visibles (también las archivadas,
  // que se siguen pudiendo leer).
  app.get('/sitemap.xml', (req, res) => {
    const fecha = (t) => new Date(t).toISOString().slice(0, 10);
    const hilos = db.prepare('SELECT id, bumped_at FROM threads WHERE visible = 1 ORDER BY bumped_at DESC LIMIT 45000').all();
    const urls = [
      { loc: '/', lastmod: hilos[0] ? fecha(hilos[0].bumped_at) : null },
      ...BOARDS.map((b) => ({ loc: `/b/${b.slug}` })),
      ...['/normas', '/formato', '/texto', '/terminos', '/privacidad'].map((loc) => ({ loc })),
      ...hilos.map((t) => ({ loc: `/h/${t.id}`, lastmod: fecha(t.bumped_at) })),
    ];
    const xml = urls
      .map((u) => `<url><loc>${baseUrl}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
      .join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${xml}</urlset>`);
  });

  app.get('/', (req, res) => renderPortada(req, res));

  app.get('/normas', (req, res) =>
    enviar(res, { titulo: 'Normas', canonical: '/normas', descripcion: 'Las normas de txt: qué se puede publicar, cómo funciona la moderación y qué pasa si no se respetan.', cuerpo: V.normas() }),
  );

  app.get('/formato', (req, res) =>
    enviar(res, { titulo: 'Formato', canonical: '/formato', descripcion: 'Los códigos de texto que acepta txt: citas, referencias a otros mensajes y spoilers, con ejemplos.', cuerpo: V.formato() }),
  );

  app.get('/terminos', (req, res) =>
    enviar(res, { titulo: 'Términos', canonical: '/terminos', descripcion: 'Términos de uso de txt, el foro de texto pseudoanónimo de 421.', cuerpo: V.terminos(res.locals.ctx) }),
  );

  app.get('/privacidad', (req, res) =>
    enviar(res, { titulo: 'Privacidad', canonical: '/privacidad', descripcion: 'Qué datos guarda txt, con quién se comparten y cómo ejercer tus derechos (Ley 25.326).', cuerpo: V.privacidad(res.locals.ctx) }),
  );

  app.get('/b/:board', (req, res) => {
    const board = boardBySlug(req.params.board);
    if (!board) return noEncontrado(res);
    renderTablon(req, res, board);
  });

  app.get('/b/:board/archivo', (req, res) => {
    const board = boardBySlug(req.params.board);
    if (!board) return noEncontrado(res);
    renderTablon(req, res, board, { archivo: true });
  });

  app.get('/h/:id', (req, res) => {
    const thread = hiloVisible(req, Number(req.params.id));
    if (!thread) return noEncontrado(res);
    renderHilo(req, res, thread);
  });

  // Actualización en vivo (public/vivo.js): los posts con id mayor a ?desde, ya en HTML.
  app.get('/h/:id/nuevos', (req, res) => {
    const thread = hiloVisible(req, Number(req.params.id));
    if (!thread) return res.status(404).json({ error: 'no encontrado' });
    const desde = Number(req.query.desde) || 0;
    const { posts, ids } = postsVisibles(req, thread);
    const nuevos = posts.filter((p) => p.id > desde);
    res.set('Cache-Control', 'no-store').json({
      ultimo: posts.length ? posts[posts.length - 1].id : desde,
      html: String(V.postsSueltos(res.locals.ctx, { thread, posts: nuevos, ids })),
    });
  });

  app.get('/p/:id', (req, res) => {
    const post = q.post.get(Number(req.params.id));
    if (!post || post.status !== 'published' || !hiloVisible(req, post.thread_id)) return noEncontrado(res);
    res.redirect(302, `/h/${post.thread_id}#p${post.id}`);
  });

  // --- Publicar ------------------------------------------------------------------------------

  // Una moderación en vuelo por cuenta: sin esto, varios POST simultáneos pasaban todos los límites
  // antes de que se guardara el primero (spam y gasto de API sin techo), y un borrado de cuenta en
  // paralelo podía dejar el post publicado o esquivar una suspensión (auditoría 2026-09-25).
  // userId → { firma, promesa }. La firma identifica el envío (dónde + texto): si llega el mismo envío
  // dos veces (doble toque en el celular, pasó mucho desde iPhone), el segundo espera al primero y
  // termina en el mismo lugar, sin duplicar y sin mostrar un error.
  const enVuelo = new Map();
  const firmaDe = (...partes) => sha256(partes.join('\u0000'));
  // Tope global de llamadas al filtro por minuto: si alguien encuentra otra forma de inundarlo, el
  // sitio se frena en vez de gastar sin límite.
  const llamadas = [];
  const TOPE_POR_MINUTO = 150;
  function hayCupo() {
    const hace = now() - 60_000;
    while (llamadas.length && llamadas[0] < hace) llamadas.shift();
    if (llamadas.length >= TOPE_POR_MINUTO) return false;
    llamadas.push(now());
    return true;
  }
  // Prueba en sombra (sombra.js): Jev revisa el mismo mensaje después de Claude, sin esperar ni decidir
  // nada. Solo se guarda la comparación. Sin TYPESAFE_API_KEY no hace nada.
  const guardarSombra = db.prepare(`INSERT INTO sombra_jev (created_at, tablon, es_hilo, asunto, cuerpo, claude_decision,
    claude_rule, claude_grave, jev_decision, jev_rule, jev_grave, respuestas, tokens, ms, error)
    VALUES (@t, @tablon, @es_hilo, @asunto, @cuerpo, @cd, @cr, @cg, @jd, @jr, @jg, @respuestas, @tokens, @ms, @error)`);
  function compararEnSombra(datos, v) {
    if (!sombra) return;
    const base = { t: now(), tablon: datos.tablon, es_hilo: datos.esHilo ? 1 : 0, asunto: datos.asunto, cuerpo: datos.cuerpo,
      cd: v.decision, cr: v.rule ?? null, cg: v.grave ?? 'ninguna' };
    sombra(datos)
      .then((r) => {
        const j = decisionJev(r.respuestas);
        guardarSombra.run({ ...base, jd: j.decision, jr: j.rule, jg: j.grave, respuestas: JSON.stringify(r.respuestas), tokens: r.tokens, ms: r.ms, error: null });
      })
      .catch((err) => {
        try {
          guardarSombra.run({ ...base, jd: null, jr: null, jg: null, respuestas: null, tokens: null, ms: null, error: String(err?.message ?? err).slice(0, 300) });
        } catch {}
      });
  }

  // Corre `tarea` (moderar y guardar) una sola vez por cuenta. Devuelve { destino } o { error, status }.
  async function unaVez(userId, firma, tarea) {
    const actual = enVuelo.get(userId);
    if (actual) {
      if (actual.firma === firma) return actual.promesa;
      return { error: 'Esperá a que termine de revisarse tu mensaje anterior.', status: 429 };
    }
    if (!hayCupo()) return { error: 'Hay mucho movimiento en este momento. Probá de nuevo en un minuto.', status: 503 };
    const promesa = tarea().finally(() => enVuelo.delete(userId));
    enVuelo.set(userId, { firma, promesa });
    return promesa;
  }
  // El mismo texto recién publicado en el mismo lugar (el segundo toque llegó cuando el primero ya había terminado).
  const reciente = (userId, cuerpo, threadId) =>
    db
      .prepare(`SELECT id, thread_id FROM posts WHERE user_id = ? AND body = ? AND created_at > ? AND status != 'removed'
        ${threadId ? 'AND thread_id = ?' : ''} ORDER BY id DESC LIMIT 1`)
      .get(...[userId, cuerpo, now() - 120_000, ...(threadId ? [threadId] : [])]);
  // Después de moderar, se vuelve a leer la cuenta: si se borró o la suspendieron mientras tanto, no se publica.
  const cuentaVigente = (userId) => {
    const u = db.prepare('SELECT identidad, banned_until FROM users WHERE id = ?').get(userId);
    return !!u && !u.identidad.startsWith('borrada:') && !(u.banned_until && u.banned_until > now());
  };

  // `render` redibuja la página de origen (portada o tablón) con el formulario y el error.
  async function publicarHilo(req, res, { board, render }) {
    if (!exigirUsuario(req, res)) return;

    const asunto = limpiarTexto(req.body.asunto).replace(/\n+/g, ' ');
    const cuerpo = limpiarTexto(req.body.cuerpo);
    const fallar = (error, status = 422) => render({ asunto, cuerpo, tablon: board?.slug ?? '', error }, status);
    if (req.body.vista === '1') return render({ asunto, cuerpo, tablon: board?.slug ?? '', previa: true, abrir: true }, 200);

    const firma = firmaDe('hilo', board?.slug, asunto, cuerpo);
    const responder = (r) => (r.destino ? res.redirect(303, r.destino) : fallar(r.error, r.status));
    if (enVuelo.get(req.user.id)?.firma === firma) return responder(await enVuelo.get(req.user.id).promesa);
    const repetido = cuerpo && reciente(req.user.id, cuerpo, null);
    if (repetido && q.hilo.get(repetido.thread_id)?.op_post_id === repetido.id) return res.redirect(303, `/h/${repetido.thread_id}`);

    const bloqueo = motivoBloqueo(req.user, 'hilo');
    if (bloqueo) return fallar(bloqueo, 429);
    if (!board) return fallar('Elegí en qué tablón publicarlo.');
    if (!asunto) return fallar('Falta el asunto.');
    if (asunto.length > LIMITS.asunto) return fallar(`El asunto puede tener hasta ${LIMITS.asunto} caracteres.`);
    if (!cuerpo) return fallar('El mensaje está vacío.');
    if (cuerpo.length > LIMITS.cuerpo) return fallar(`El mensaje puede tener hasta ${LIMITS.cuerpo} caracteres.`);

    const userId = req.user.id;
    const r = await unaVez(userId, firma, async () => {
      const datos = { tablon: board.nombre, asunto, cuerpo, esHilo: true };
      const v = await moderar(datos);
      compararEnSombra(datos, v);
      if (!cuentaVigente(userId)) return { destino: '/' };
      if (v.decision === 'reject') {
        registrarRechazo(userId, board.slug, null, asunto, cuerpo, v);
        return { error: 'No se publicó: el mensaje no cumple las normas.', status: 422 };
      }
      const threadId = crearHilo(board.slug, asunto, userId, cuerpo, v);
      return { destino: `/h/${threadId}${v.decision === 'queue' ? '?aviso=cola' : ''}` };
    });
    responder(r);
  }

  app.post('/hilo', (req, res) =>
    publicarHilo(req, res, {
      board: boardBySlug(req.body?.tablon),
      render: (form, status) => renderPortada(req, res, { form, status }),
    }),
  );

  app.post('/b/:board/hilo', (req, res) => {
    const board = boardBySlug(req.params.board);
    if (!board) return noEncontrado(res);
    return publicarHilo(req, res, { board, render: (form, status) => renderTablon(req, res, board, { form, status }) });
  });

  app.post('/h/:id/responder', async (req, res) => {
    const thread = q.hilo.get(Number(req.params.id));
    if (!thread || !thread.visible) return noEncontrado(res);
    if (!exigirUsuario(req, res)) return;

    const cuerpo = limpiarTexto(req.body.cuerpo);
    const sage = req.body.sage === '1';
    const fallar = (error, status = 422) => renderHilo(req, res, thread, { cuerpo, sage, error }, status);
    if (req.body.vista === '1') return renderHilo(req, res, thread, { cuerpo, sage, previa: true }, 200);

    const firma = firmaDe('respuesta', thread.id, cuerpo);
    const responder = (r) => (r.destino ? res.redirect(303, r.destino) : fallar(r.error, r.status));
    if (enVuelo.get(req.user.id)?.firma === firma) return responder(await enVuelo.get(req.user.id).promesa);
    const repetido = cuerpo && reciente(req.user.id, cuerpo, thread.id);
    if (repetido) return res.redirect(303, `/h/${thread.id}#p${repetido.id}`);

    if (thread.archived || thread.locked) return fallar('Esta publicación ya no acepta respuestas.', 409);
    const bloqueo = motivoBloqueo(req.user, 'respuesta');
    if (bloqueo) return fallar(bloqueo, 429);
    if (!cuerpo) return fallar('El mensaje está vacío.');
    if (cuerpo.length > LIMITS.cuerpo) return fallar(`El mensaje puede tener hasta ${LIMITS.cuerpo} caracteres.`);

    const userId = req.user.id;
    const r = await unaVez(userId, firma, async () => {
      const datos = { tablon: boardBySlug(thread.board).nombre, asunto: thread.subject, cuerpo, esHilo: false };
      const v = await moderar(datos);
      compararEnSombra(datos, v);
      if (!cuentaVigente(userId)) return { destino: '/' };
      if (v.decision === 'reject') {
        registrarRechazo(userId, thread.board, thread.id, null, cuerpo, v);
        return { error: 'No se publicó: el mensaje no cumple las normas.', status: 422 };
      }
      // El estado de la publicación se vuelve a leer: pudo cerrarse, archivarse u ocultarse mientras se moderaba.
      const ahora = q.hilo.get(thread.id);
      if (!ahora.visible || ahora.archived || ahora.locked) return { error: 'Esta publicación ya no acepta respuestas.', status: 409 };
      const postId = crearRespuesta(thread.id, userId, cuerpo, sage, v);
      return { destino: `/h/${thread.id}${v.decision === 'queue' ? '?aviso=cola' : ''}#p${postId}` };
    });
    responder(r);
  });

  // Página para reportar un mensaje. Antes el formulario iba escondido en cada mensaje de la
  // publicación: con sesión, un <select> con todas las normas por mensaje para algo que casi nadie abre.
  app.get('/p/:id/reportar', (req, res) => {
    const post = q.post.get(Number(req.params.id));
    const thread = post?.status === 'published' ? hiloVisible(req, post.thread_id) : null;
    if (!thread) return noEncontrado(res);
    if (!req.user) return res.redirect(303, '/entrar');
    const volver = `/h/${thread.id}#p${post.id}`;
    // Las mismas reglas que el POST: el propio mensaje o una cuenta suspendida vuelven a la publicación.
    if (post.user_id === req.user.id || suspendido(req.user)) return res.redirect(303, volver);
    const autorOp = q.post.get(thread.op_post_id)?.user_id;
    const p = { ...post, anon: anonId(post.user_id, thread.id), esAutorOp: post.user_id === autorOp };
    enviar(res, { titulo: 'Reportar', indexar: false, cuerpo: V.reportar(res.locals.ctx, { post: p, thread, volver }) });
  });

  app.post('/p/:id/reportar', (req, res) => {
    const post = q.post.get(Number(req.params.id));
    if (!post || post.status !== 'published') return noEncontrado(res);
    if (!exigirUsuario(req, res)) return;
    if (post.user_id === req.user.id || suspendido(req.user)) return res.redirect(303, `/h/${post.thread_id}#p${post.id}`);
    const motivo = NORMAS.some((n) => n.id === req.body.motivo) ? req.body.motivo : 'otro';
    db.transaction(() => {
      q.insertarReporte.run(post.id, req.user.id, motivo, now());
      // Para ocultar solo cuentan reportes de cuentas con al menos un día (tres cuentas recién
      // creadas no pueden ocultar lo que quieran). Los demás llegan igual a /mod.
      const validos = db
        .prepare(`SELECT COUNT(*) AS n FROM reports r JOIN users u ON u.id = r.user_id
          WHERE r.post_id = ? AND r.resolved = 0 AND u.created_at <= ?`)
        .get(post.id, now() - DIA).n;
      if (validos >= LIMITS.reportesParaOcultar) {
        cambiarEstado(post.id, 'queued', { accion: 'ocultar-por-reportes', resolver: false });
      }
    })();
    res.redirect(303, `/h/${post.thread_id}?aviso=reportado#p${post.id}`);
  });

  // Guardar una publicación para leer después, o sacarla de guardados (el mismo botón).
  app.post('/h/:id/guardar', (req, res) => {
    const thread = hiloVisible(req, Number(req.params.id));
    if (!thread || !thread.visible) return noEncontrado(res);
    if (!exigirUsuario(req, res)) return;
    if (req.body.quitar === '1') q.olvidar.run(req.user.id, thread.id);
    else q.guardar.run(req.user.id, thread.id, now());
    res.redirect(303, `/h/${thread.id}`);
  });

  // --- Moderación ----------------------------------------------------------------------------

  app.get('/mod', (req, res) => {
    if (!esMod(req.user)) return noEncontrado(res);
    const nombrar = (p) => ({ ...p, board_nombre: boardBySlug(p.board)?.nombre ?? p.board });
    const graves = db
      .prepare(`SELECT r.id, r.user_id, r.body, r.subject, r.rule, r.reason, r.grave, r.created_at, u.banned_until
        FROM rechazos r JOIN users u ON u.id = r.user_id WHERE r.grave IS NOT NULL ORDER BY r.id DESC LIMIT 50`)
      .all();
    const cuerpo = V.mod(res.locals.ctx, { cola: q.colaMod.all().map(nombrar), reportados: q.reportadosMod.all().map(nombrar), graves });
    enviar(res, { titulo: 'Moderación', indexar: false, cuerpo });
  });

  // Estadísticas para mods: últimos 30 días.
  app.get('/mod/estadisticas', (req, res) => {
    if (!esMod(req.user)) return noEncontrado(res);
    const hoy = diaDe(now());
    const dias = Array.from({ length: 30 }, (_, i) => diaDe(now() - (29 - i) * DIA));
    const desde = now() - 31 * DIA;
    const porDia = (sql, ...args) => Object.fromEntries(db.prepare(sql).all(...args).map((r) => [r.dia, r.n]));
    const diaSql = "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '-3 hours')";
    const vistas = porDia('SELECT dia, vistas AS n FROM visitas_dia WHERE dia >= ?', dias[0]);
    const visitantes = porDia('SELECT dia, visitantes AS n FROM visitas_dia WHERE dia >= ?', dias[0]);
    const activos = porDia('SELECT dia, COUNT(*) AS n FROM actividad_dia WHERE dia >= ? GROUP BY dia', dias[0]);
    const publicaciones = porDia(`SELECT ${diaSql.replace('created_at', 'p.created_at')} AS dia, COUNT(*) AS n FROM posts p JOIN threads t ON t.op_post_id = p.id
      WHERE p.created_at >= ? AND p.status != 'removed' GROUP BY 1`, desde);
    const respuestas = porDia(`SELECT ${diaSql.replace('created_at', 'p.created_at')} AS dia, COUNT(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id
      WHERE t.op_post_id != p.id AND p.created_at >= ? AND p.status != 'removed' GROUP BY 1`, desde);
    const nuevas = porDia(`SELECT ${diaSql} AS dia, COUNT(*) AS n FROM users WHERE created_at >= ? AND identidad NOT LIKE 'borrada:%' GROUP BY 1`, desde);
    const serie = (m) => dias.map((dia) => ({ dia, n: m[dia] ?? 0 }));
    const total = db.prepare("SELECT COUNT(*) AS n FROM users WHERE identidad NOT LIKE 'borrada:%'").get().n;
    const desdeVisitas = db.prepare('SELECT MIN(dia) AS d FROM visitas_dia').get().d;
    enviar(res, {
      titulo: 'Estadísticas',
      indexar: false,
      cuerpo: V.estadisticas(res.locals.ctx, {
        hoy,
        total,
        desdeVisitas,
        series: {
          vistas: serie(vistas),
          visitantes: serie(visitantes),
          activos: serie(activos),
          publicaciones: serie(publicaciones),
          respuestas: serie(respuestas),
          nuevas: serie(nuevas),
        },
      }),
    });
  });

  // Panel de la prueba en sombra: cuánto coincide Jev con Claude, qué graves se le escaparon, costo.
  app.get('/mod/sombra', (req, res) => {
    if (!esMod(req.user)) return noEncontrado(res);
    const total = db.prepare('SELECT COUNT(*) AS n, SUM(error IS NOT NULL) AS errores, SUM(tokens) AS tokens, AVG(ms) AS ms FROM sombra_jev').get();
    const cruce = db
      .prepare(`SELECT claude_decision AS c, jev_decision AS j, COUNT(*) AS n FROM sombra_jev WHERE error IS NULL GROUP BY 1, 2 ORDER BY 3 DESC`)
      .all();
    const gravesEscapados = db
      .prepare(`SELECT * FROM sombra_jev WHERE error IS NULL AND claude_grave != 'ninguna' AND jev_grave = 'ninguna' ORDER BY id DESC LIMIT 20`)
      .all();
    const desacuerdos = db
      .prepare(`SELECT * FROM sombra_jev WHERE error IS NULL AND claude_decision != jev_decision ORDER BY id DESC LIMIT 40`)
      .all();
    const costo = ((total.tokens ?? 0) * PRECIO_JEV_POR_MTOK) / 1e6;
    enviar(res, {
      titulo: 'Prueba Jev',
      indexar: false,
      cuerpo: V.sombra(res.locals.ctx, { activa: !!sombra, total, cruce, gravesEscapados, desacuerdos, costo }),
    });
  });

  // Levantar una suspensión (por ejemplo, una automática que fue un error del filtro).
  app.post('/mod/u/:id/levantar', (req, res) => {
    if (!exigirMod(req, res)) return;
    const userId = Number(req.params.id);
    if (userId === req.user.id) return noEncontrado(res);
    q.banear.run(null, null, userId);
    q.log.run(req.user.id, 'levantar-suspension', null, userId, null, now());
    res.redirect(303, '/mod');
  });

  app.post('/mod/p/:id/:accion', (req, res) => {
    if (!exigirMod(req, res)) return;
    const post = q.post.get(Number(req.params.id));
    if (!post) return noEncontrado(res);
    const modId = req.user.id;

    switch (req.params.accion) {
      case 'aprobar':
        cambiarEstado(post.id, 'published', { modId, accion: 'aprobar' });
        break;
      case 'eliminar':
        cambiarEstado(post.id, 'removed', { modId, accion: 'eliminar' });
        break;
      case 'descartar':
        q.resolverReportes.run(post.id);
        q.log.run(modId, 'descartar-reportes', post.id, post.user_id, null, now());
        break;
      case 'banear': {
        if (db.prepare('SELECT role FROM users WHERE id = ?').get(post.user_id)?.role === 'admin') return noEncontrado(res);
        const dias = Math.min(3650, Math.max(1, parseInt(req.body.dias, 10) || 7));
        const motivo = limpiarTexto(req.body.motivo).slice(0, 300) || 'Sin motivo';
        db.transaction(() => {
          cambiarEstado(post.id, 'removed', { modId, accion: 'eliminar' });
          q.banear.run(now() + dias * DIA, motivo, post.user_id);
          q.log.run(modId, `suspender-${dias}d`, post.id, post.user_id, motivo, now());
        })();
        break;
      }
      default:
        return noEncontrado(res);
    }
    res.redirect(303, '/mod');
  });

  // --- Cuenta --------------------------------------------------------------------------------
  // Se entra con Google. De la cuenta se guarda solo el identificador estable (`sub`), nunca el
  // correo: alcanza para suspenderla. El correo se mira únicamente al entrar, para saber si es admin.

  const REDIRECT_GOOGLE = `${baseUrl}/auth/google/callback`;
  const cookieOauth = { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 10 * 60_000, path: '/auth' };

  const iniciarSesion = db.transaction((identidad, esAdmin) => {
    let u = q.usuarioPorIdentidad.get(identidad);
    if (!u) u = { id: Number(q.crearUsuario.run(identidad, esAdmin ? 'admin' : 'user', now()).lastInsertRowid) };
    else if (esAdmin && u.role !== 'admin') q.hacerAdmin.run(u.id);
    else if (!esAdmin && u.role === 'admin') q.quitarAdmin.run(u.id);
    const sid = crypto.randomBytes(32).toString('base64url');
    q.crearSesion.run(sha256(sid), u.id, now(), now() + 30 * DIA);
    return sid;
  });

  function entrarCon(res, identidad, esAdmin) {
    const sid = iniciarSesion(identidad, esAdmin);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 30 * DIA, path: '/' });
    res.redirect(303, '/');
  }

  const paginaEntrar = (res, error, status = 200) =>
    enviar(
      res,
      { titulo: 'Entrar', indexar: false, cuerpo: V.entrar(res.locals.ctx, { google: !!google, prueba: loginDePrueba, error }) },
      status,
    );

  app.get('/entrar', (req, res) => paginaEntrar(res));

  app.get('/auth/google', (req, res) => {
    if (!google) return noEncontrado(res);
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    res.cookie('oauth', `${state}.${verifier}`, cookieOauth);
    res.redirect(302, google.urlAutorizacion({ redirectUri: REDIRECT_GOOGLE, state, codeChallenge: challenge }));
  });

  app.get('/auth/google/callback', async (req, res) => {
    if (!google) return noEncontrado(res);
    const [state, verifier] = (leerCookies(req.headers.cookie).oauth ?? '').split('.');
    res.clearCookie('oauth', { path: '/auth' });
    if (req.query.error) return paginaEntrar(res, 'No se completó el ingreso con Google.', 400);
    if (!state || !verifier || !req.query.code || !iguales(String(req.query.state ?? ''), state)) {
      return paginaEntrar(res, 'El ingreso venció. Probá de nuevo.', 400);
    }
    let perfil;
    try {
      perfil = await google.canjearCodigo({ code: String(req.query.code), redirectUri: REDIRECT_GOOGLE, codeVerifier: verifier });
    } catch (err) {
      console.error('[google]', err);
      return paginaEntrar(res, 'Google no respondió bien. Probá de nuevo en un momento.', 502);
    }
    const esAdmin = !!perfil.email && adminEmails.includes(perfil.email.toLowerCase());
    entrarCon(res, `google:${perfil.sub}`, esAdmin);
  });

  // Solo en desarrollo y sin credenciales de Google: sirve para probar el sitio sin configurar nada.
  app.post('/entrar/prueba', (req, res) => {
    if (!loginDePrueba) return noEncontrado(res);
    const nombre = limpiarTexto(req.body?.nombre).slice(0, 40);
    if (!nombre) return paginaEntrar(res, 'Poné un nombre de prueba.', 422);
    entrarCon(res, `prueba:${nombre.toLowerCase()}`, req.body.admin === '1');
  });

  // Borrar la cuenta: se vacía todo lo que escribió y se reemplaza el identificador de Google, así
  // que no queda nada que la vincule con la persona. Suspendida no se puede: sería volver a entrar
  // con la misma cuenta de Google limpia. Las publicaciones que abrió siguen visibles si tienen
  // respuestas de otros (con el asunto borrado); si no, se ocultan.
  const borrarCuenta = db.transaction((userId) => {
    for (const p of db.prepare("SELECT * FROM posts WHERE user_id = ? AND status = 'published'").all(userId)) {
      const t = q.hilo.get(p.thread_id);
      if (t.op_post_id !== p.id) alRetirar(p);
    }
    db.prepare(`UPDATE threads SET subject = '(eliminada)',
        visible = CASE WHEN reply_count > 0 THEN visible ELSE 0 END
      WHERE op_post_id IN (SELECT id FROM posts WHERE user_id = ?)`).run(userId);
    db.prepare(`UPDATE posts SET body = '', status = 'removed', mod_reason = NULL WHERE user_id = ?`).run(userId);
    db.prepare(`UPDATE busqueda SET asunto = '', cuerpo = '' WHERE rowid IN (SELECT id FROM posts WHERE user_id = ?)`).run(userId);
    db.prepare('DELETE FROM rechazos WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM reports WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM notificaciones WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)').run(userId, userId);
    db.prepare('DELETE FROM gemini_llaves WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM guardados WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare("UPDATE users SET identidad = 'borrada:' || id, role = 'user', ban_reason = NULL WHERE id = ?").run(userId);
    q.log.run(null, 'borrar-cuenta', null, userId, null, now());
  });

  // Se marcan como leídas al abrir la página (después de armarla, así la visita muestra cuáles eran nuevas).
  app.get('/respuestas', (req, res) => {
    if (!req.user) return res.redirect(303, '/entrar');
    const lista = q.notificaciones.all(req.user.id);
    q.marcarLeidas.run(req.user.id);
    enviar(res, { titulo: 'Respuestas', indexar: false, cuerpo: V.respuestas(res.locals.ctx, { lista }) });
  });

  app.get('/guardados', (req, res) => {
    if (!req.user) return res.redirect(303, '/entrar');
    enviar(res, { titulo: 'Guardados', indexar: false, cuerpo: V.guardados(res.locals.ctx, { lista: q.guardados.all(req.user.id) }) });
  });

  app.get('/cuenta', (req, res) => {
    if (!req.user) return res.redirect(303, '/entrar');
    const mias = db
      .prepare(`SELECT t.id, t.subject, t.board, t.reply_count, t.bumped_at, MAX(p.created_at) AS ultima
        FROM posts p JOIN threads t ON t.id = p.thread_id
        WHERE p.user_id = ? AND p.status != 'removed' AND (t.visible = 1 OR t.op_post_id = p.id)
        GROUP BY t.id ORDER BY ultima DESC LIMIT 100`)
      .all(req.user.id);
    const llaves = db.prepare('SELECT huella, created_at, ultimo_uso FROM gemini_llaves WHERE user_id = ? ORDER BY created_at').all(req.user.id);
    enviar(res, { titulo: 'Cuenta', indexar: false, aviso: req.query.aviso, cuerpo: V.cuenta(res.locals.ctx, { suspendida: suspendido(req.user), mias, llaves, geminiUrl }) });
  });

  app.post('/cuenta/borrar', (req, res) => {
    if (!exigirUsuario(req, res)) return;
    const volver = (error) =>
      enviar(res, { titulo: 'Cuenta', indexar: false, cuerpo: V.cuenta(res.locals.ctx, { suspendida: suspendido(req.user), error }) }, 422);
    if (suspendido(req.user)) return volver('Mientras dure la suspensión no se puede borrar la cuenta.');
    if (req.body.confirmar !== '1') return volver('Marcá la casilla para confirmar.');
    if (enVuelo.has(req.user.id)) return volver('Tenés un mensaje revisándose. Esperá unos segundos y probá de nuevo.');
    borrarCuenta(req.user.id);
    res.clearCookie('sid', { path: '/' });
    res.redirect(303, '/?aviso=cuenta-borrada');
  });

  app.post('/salir', (req, res) => {
    if (!exigirUsuario(req, res)) return;
    q.borrarSesion.run(req.user.id_hash);
    res.clearCookie('sid', { path: '/' });
    res.redirect(303, '/');
  });

  // --- Errores -------------------------------------------------------------------------------

  app.use((req, res) => noEncontrado(res));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.locals.ctx ??= { user: null, csrf: null, siteName, baseUrl, ahora: now(), codigoUrl };
    const texto = status === 413 ? 'El mensaje es demasiado largo.' : 'Algo falló. Probá de nuevo en un momento.';
    enviar(res, { titulo: 'Error', cuerpo: V.mensaje('Error', texto) }, status);
  });

  return app;
}
