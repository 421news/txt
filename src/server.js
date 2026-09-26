import './env.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, limpiarVencidos } from './db.js';
import { createApp } from './app.js';
import { crearModerador } from './moderation.js';
import { crearGoogle } from './google.js';
import { crearCapsula } from './gemini.js';
import { crearSombra } from './sombra.js';

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

const app = createApp({
  db,
  secret,
  baseUrl,
  siteName,
  production,
  google,
  loginDePrueba: !google && !production,
  moderar: crearModerador({ siteName }),
  geminiUrl: process.env.GEMINI_URL || null,
  codigoUrl: process.env.CODIGO_URL || null,
  sombra: process.env.TYPESAFE_API_KEY ? crearSombra({ apiKey: process.env.TYPESAFE_API_KEY }) : null,
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
});

setInterval(() => limpiarVencidos(db), 3_600_000).unref();
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
