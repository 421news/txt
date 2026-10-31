import './env.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, limpiarVencidos } from './db.js';
import { createApp } from './app.js';
import { crearModerador, crearModeradorEscalonado, MODELO_RAPIDO } from './moderation.js';
import { crearGoogle } from './google.js';
import { crearCapsula } from './gemini.js';
import { crearSombra, crearFiltroMixto, UMBRAL_LIMPIO } from './sombra.js';
import { crearUltimaNota, crearUltimasNotas } from './nota421.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const production = process.env.NODE_ENV === 'production';

let secret = process.env.SECRET;
if (!secret) {
  if (production) {
    console.error('Falta SECRET en el entorno.');
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[dev] Sin SECRET: se generó uno al azar. Los IDs anónimos y las sesiones cambian en cada reinicio.');
}

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
const google = clientId && clientSecret ? crearGoogle({ clientId, clientSecret }) : null;
if (!google) {
  if (production) {
    console.error('Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET: sin eso nadie puede entrar.');
    process.exit(1);
  }
  console.warn('[dev] Sin credenciales de Google: /entrar ofrece un acceso de prueba.');
}

const siteName = process.env.SITE_NAME || 'textboard';
const port = Number(process.env.PORT) || 3000;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const db = openDb(path.resolve(raiz, process.env.DB_PATH || 'data/textboard.db'));

const jev = process.env.TYPESAFE_API_KEY ? crearSombra({ apiKey: process.env.TYPESAFE_API_KEY }) : null;
// Haiku primero y Sonnet para todo lo que Haiku no aprueba (ver crearModeradorEscalonado).
// MODERACION_HAIKU=off vuelve a Sonnet solo; HAIKU_MUESTRA (0–1, por defecto 0,1) es la parte auditada.
const auditar = db.prepare('INSERT INTO auditoria_haiku (created_at, tablon, asunto, cuerpo, sonnet_decision, sonnet_rule, sonnet_grave) VALUES (?, ?, ?, ?, ?, ?, ?)');
const claudeFirme = crearModerador({ siteName });
const claudeEscalonado = String(process.env.MODERACION_HAIKU || 'on').toLowerCase() === 'off'
  ? claudeFirme
  : crearModeradorEscalonado({
      rapido: crearModerador({ siteName, modelo: MODELO_RAPIDO }),
      firme: claudeFirme,
      muestra: (() => { const m = Number(process.env.HAIKU_MUESTRA); return m >= 0 && m <= 1 && process.env.HAIKU_MUESTRA ? m : 0.1; })(),
      alAuditar: (d, _v1, v2) => auditar.run(Date.now(), d.tablon ?? null, d.asunto ?? null, d.cuerpo ?? null, v2.decision, v2.rule ?? null, v2.grave ?? null),
    });
// Umbral del filtro mixto: por debajo, Jev aprueba solo. JEV_UMBRAL lo cambia sin tocar código (elegirlo con
// la simulación de /mod/sombra); fuera de 0,05–0,9 o vacío queda en UMBRAL_LIMPIO.
const umbralJev = (() => { const u = Number(process.env.JEV_UMBRAL); return u >= 0.05 && u <= 0.9 ? u : UMBRAL_LIMPIO; })();
const app = createApp({
  db,
  ultimaNota421: crearUltimaNota(),
  notas421: crearUltimasNotas(),
  secret,
  baseUrl,
  siteName,
  production,
  google,
  loginDePrueba: !google && !production,
  // Con clave de TypeSafe, filtro mixto: Jev primero, Claude solo para lo que Jev ve dudoso.
  moderar: jev ? crearFiltroMixto({ jev, claude: claudeEscalonado, umbral: umbralJev }) : claudeEscalonado,
  jevActivo: !!jev,
  umbralJev,
  alcanceKey: process.env.ALCANCE_KEY || null,
  // HORDA=off apaga el juego (/horda) y su tabla de puntajes.
  horda: String(process.env.HORDA || 'on').toLowerCase() !== 'off',
  geminiUrl: process.env.GEMINI_URL || null,
  codigoUrl: process.env.CODIGO_URL || null,
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
});

setInterval(() => {
  limpiarVencidos(db);
  // Estadísticas de la base al día (SQLite solo las recalcula si hace falta). Si falla, queda en el log.
  try {
    db.pragma('optimize');
  } catch (err) {
    console.error('[estadísticas] No se pudieron poner al día:', err);
  }
}, 3_600_000).unref();
const server = app.listen(port, () => console.log(`${siteName} escuchando en ${baseUrl}`));

// Cápsula Gemini: arranca si hay certificado. En Railway sale por un proxy TCP
// hacia GEMINI_PORT; el certificado y la clave viven en variables (nunca en el repo).
let capsula = null;
if (process.env.GEMINI_CERT && process.env.GEMINI_KEY) {
  const puertoGemini = Number(process.env.GEMINI_PORT) || 1965;
  capsula = crearCapsula({
    documento: app.locals.documento,
    escritura: app.locals.gemini,
    baseUrl,
    cert: process.env.GEMINI_CERT.replace(/\\n/g, '\n'),
    key: process.env.GEMINI_KEY.replace(/\\n/g, '\n'),
    hosts: (process.env.GEMINI_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean),
  });
  capsula.listen(puertoGemini, () => console.log(`Cápsula Gemini en el puerto ${puertoGemini}`));
}

// Railway apaga el contenedor viejo con SIGTERM en cada deploy. Si no se atiende, el proceso
// muere con error y Railway lo reporta como "Deploy Crashed". Se cierra prolijo: se dejan de
// aceptar conexiones, se cierra la base y se sale con 0.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    capsula?.close();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8_000).unref();
  });
}
