// Se importa primero en server.js: carga .env antes de que el resto de los módulos lea process.env.
import { intentar } from './resultado.js';

const resultado = intentar(() => process.loadEnvFile());
// Sin .env se usan las variables del entorno (producción). Otros errores deben impedir el arranque.
if (!resultado.ok && resultado.error?.code !== 'ENOENT') throw resultado.error;
