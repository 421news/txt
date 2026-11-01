// Entorno aislado para revisar Gemini: no carga .env ni usa credenciales o la base habitual.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { crearCapsula } from '../src/gemini.js';

const BASE_URL = 'http://127.0.0.1:3000';
const GEMINI_URL = 'gemini://127.0.0.1:1965';
const DIRECTORIO = fileURLToPath(new URL('../data/gemini-local/', import.meta.url));

export function crearEntornoGeminiLocal(directorio = DIRECTORIO) {
  if (process.env.NODE_ENV === 'production') throw new Error('dev:gemini es solo para desarrollo.');
  directorio = path.resolve(directorio);
  fs.mkdirSync(directorio, { recursive: true, mode: 0o700 });
  const cert = path.join(directorio, 'cert.pem');
  const key = path.join(directorio, 'key.pem');
  if (fs.existsSync(cert) !== fs.existsSync(key)) {
    throw new Error(`Falta parte del certificado local. Borrá cert.pem y key.pem de ${directorio} y volvé a iniciar.`);
  }
  if (!fs.existsSync(cert)) {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
        '-nodes', '-days', '365', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout', key, '-out', cert], { stdio: 'pipe' });
    } catch (err) {
      throw new Error('No se pudo generar el certificado local. Necesitás openssl en PATH.', { cause: err });
    }
    fs.chmodSync(key, 0o600);
  }
  const secreto = path.join(directorio, 'secret');
  if (!fs.existsSync(secreto)) fs.writeFileSync(secreto, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
  const archivoDb = path.join(directorio, 'textboard.db');
  if (!fs.existsSync(archivoDb)) {
    // Se publica la base solo al terminar: un fallo del fixture no deja una inicialización a medias.
    const nuevaDb = path.join(directorio, 'inicial.db');
    // cwd separado y entorno mínimo: fixture.js no lee el .env del repo ni hereda claves de APIs.
    execFileSync(process.execPath, [fileURLToPath(new URL('./fixture.js', import.meta.url))], {
      cwd: directorio, env: { NODE_ENV: 'development', DB_PATH: nuevaDb }, stdio: 'pipe',
    });
    const ejemplos = openDb(nuevaDb);
    try {
      ejemplos.exec('UPDATE threads SET archived = 1 WHERE id IN (SELECT id FROM threads ORDER BY id LIMIT 3)');
    } finally {
      ejemplos.close();
    }
    fs.renameSync(nuevaDb, archivoDb);
  }
  const db = openDb(archivoDb);
  try {
    const app = createApp({
      db, secret: fs.readFileSync(secreto), baseUrl: BASE_URL, geminiUrl: GEMINI_URL,
      siteName: 'txt · prueba local (moderación simulada)', loginDePrueba: true,
      moderar: async () => ({ decision: 'approve', rule: 'ninguna', reason: '', grave: 'ninguna', model: 'prueba-local' }),
    });
    const capsula = crearCapsula({
      documento: app.locals.documento, escritura: app.locals.gemini, baseUrl: BASE_URL,
      cert: fs.readFileSync(cert), key: fs.readFileSync(key), hosts: ['localhost', '127.0.0.1'],
    });
    return { app, capsula, db };
  } catch (err) {
    db.close();
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { app, capsula, db } = crearEntornoGeminiLocal();
    const web = app.listen(3000, '127.0.0.1', () => console.log(`Web y acceso de prueba: ${BASE_URL}/entrar`));
    capsula.listen(1965, '127.0.0.1', () => console.log(`Cápsula: ${GEMINI_URL}/`));
    console.log(`Datos persistentes: ${DIRECTORIO}`);
    console.log('Solo localhost. Moderación simulada: aprueba todo, sin llamadas a APIs. Ctrl+C para apagar.');
    const cerrar = (codigo = 0) => {
      capsula.close();
      web.close(() => { db.close(); process.exit(codigo); });
      setTimeout(() => process.exit(codigo), 2000).unref();
    };
    for (const server of [web, capsula]) server.on('error', (err) => {
      console.error(`No se pudo iniciar: ${err.message}. Revisá que los puertos 3000 y 1965 estén libres.`);
      cerrar(1);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cerrar());
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
