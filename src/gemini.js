import tls from 'node:tls';
import { aGemtext } from './documentos.js';

// Cápsula Gemini de solo lectura (gemini://…). Protocolo: el cliente abre TLS, manda la URL
// terminada en CRLF, y el servidor responde "<estado> <meta>\r\n" y el cuerpo. Estados usados:
// 20 éxito, 40 error temporal, 51 no encontrado, 53 el pedido es para otro sitio, 59 pedido inválido.
// Se lee siempre como visitante sin sesión (documento de app.js), así que muestra solo lo publicado.
//
// Corre en el mismo proceso que la web: una excepción acá tira abajo todo el sitio. Por eso el
// manejo del pedido está entero dentro de un try (pasó con un %E0 en la URL, auditoría 2026-09-25).
const MAX_BYTES = 1024 + 2; // la URL puede tener hasta 1024 bytes, más el CRLF
const PLAZO_MS = 10_000; // plazo total para mandar el pedido (no se reinicia con cada byte)
const decodificador = new TextDecoder('utf-8', { fatal: true });

export function crearCapsula({ documento, baseUrl, cert, key, hosts = [] }) {
  function atender(linea) {
    let url;
    try {
      url = new URL(linea);
    } catch {
      return '59 URL inválida';
    }
    if (url.protocol !== 'gemini:') return '53 Solo gemini://';
    if (hosts.length && !hosts.includes(url.hostname)) return '53 Este servidor no atiende ese sitio';
    let ruta;
    try {
      ruta = decodeURIComponent(url.pathname || '/').replace(/\/+$/, '') || '/';
    } catch {
      return '59 URL inválida';
    }
    const bloques = documento(ruta, Object.fromEntries(url.searchParams));
    if (!bloques) return '51 No encontrado';
    return `20 text/gemini; charset=utf-8; lang=es\r\n${aGemtext(bloques, { baseUrl })}`;
  }

  const server = tls.createServer({ cert, key, minVersion: 'TLSv1.2' }, (socket) => {
    const trozos = [];
    let largo = 0;
    let respondido = false;
    const plazo = setTimeout(() => socket.destroy(), PLAZO_MS);
    const responder = (texto) => {
      if (respondido) return;
      respondido = true;
      clearTimeout(plazo);
      socket.end(texto.includes('\r\n') ? texto : `${texto}\r\n`);
    };
    socket.on('error', () => socket.destroy());
    socket.on('close', () => clearTimeout(plazo));
    socket.on('data', (trozo) => {
      if (respondido) return;
      trozos.push(trozo);
      largo += trozo.length;
      const todo = Buffer.concat(trozos, largo);
      const fin = todo.indexOf('\r\n');
      if (fin === -1) {
        if (largo > MAX_BYTES) responder('59 Pedido demasiado largo');
        return;
      }
      if (fin > MAX_BYTES - 2) return responder('59 Pedido demasiado largo');
      let linea;
      try {
        linea = decodificador.decode(todo.subarray(0, fin));
      } catch {
        return responder('59 El pedido no es UTF-8 válido');
      }
      try {
        responder(atender(linea));
      } catch (err) {
        console.error('[gemini]', err);
        responder('40 Error temporal');
      }
    });
  });
  // Tope de conexiones simultáneas: la cápsula comparte proceso (y descriptores) con la web.
  server.maxConnections = 200;
  return server;
}
