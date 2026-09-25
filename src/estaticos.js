import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// URL de un archivo de public/ con un hash de su contenido (?v=…). /static se sirve con caché de un
// día: sin esto, el navegador sigue usando el CSS viejo después de un deploy (pasó con el tema claro).
const cache = new Map();
export function estatico(nombre) {
  if (!cache.has(nombre)) {
    const archivo = fileURLToPath(new URL(`../public/${nombre}`, import.meta.url));
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex').slice(0, 10);
    cache.set(nombre, `/static/${nombre}?v=${hash}`);
  }
  return cache.get(nombre);
}
