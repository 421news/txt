// Se importa primero en server.js: carga .env antes de que el resto de los módulos lea process.env.
try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan las variables del entorno (así corre en producción).
}
