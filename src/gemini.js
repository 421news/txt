import tls from 'node:tls';
import { aGemtext } from './documentos.js';

// Cápsula Gemini de solo lectura (gemini://…). Protocolo: el cliente abre TLS, manda la URL
// terminada en CRLF, y el servidor responde "<estado> <meta>\r\n" y el cuerpo. Estados usados:
// 20 éxito, 51 no encontrado, 59 pedido inválido, 53 el pedido es para otro sitio.
// Se lee siempre como visitante sin sesión (documento de app.js), así que muestra solo lo publicado.
export function crearCapsula({ documento, baseUrl, cert, key, hosts = [] }) {
  const server = tls.createServer({ cert, key, minVersion: 'TLSv1.2' }, (socket) => {
    let pedido = '';
    const responder = (encabezado, cuerpo = '') => socket.end(`${encabezado}\r\n${cuerpo}`);
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (trozo) => {
      pedido += trozo.toString('utf8');
      if (pedido.length > 1026) return responder('59 Pedido demasiado largo');
      const fin = pedido.indexOf('\r\n');
      if (fin === -1) return;
      socket.removeAllListeners('data');
      let url;
      try {
        url = new URL(pedido.slice(0, fin));
      } catch {
        return responder('59 URL inválida');
      }
      if (url.protocol !== 'gemini:') return responder('53 Solo gemini://');
      if (hosts.length && !hosts.includes(url.hostname)) return responder('53 Este servidor no atiende ese sitio');
      const ruta = decodeURIComponent(url.pathname || '/').replace(/\/+$/, '') || '/';
      const query = Object.fromEntries(url.searchParams);
      let bloques;
      try {
        bloques = documento(ruta, query);
      } catch (err) {
        console.error('[gemini]', err);
        return responder('40 Error temporal');
      }
      if (!bloques) return responder('51 No encontrado');
      responder('20 text/gemini; charset=utf-8; lang=es', aGemtext(bloques, { baseUrl }));
    });
  });
  return server;
}
