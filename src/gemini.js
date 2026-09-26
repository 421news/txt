import tls from 'node:tls';
import { aGemtext } from './documentos.js';

// Cápsula Gemini (gemini://…). Protocolo: el cliente abre TLS, manda la URL terminada en CRLF, y el
// servidor responde "<estado> <meta>\r\n" y el cuerpo. Estados usados: 10 pedir texto, 20 éxito,
// 30 redirección, 40 error temporal, 51 no encontrado, 53 el pedido es para otro sitio, 59 pedido
// inválido, 60 hace falta un certificado de cliente.
// Se lee siempre como visitante sin sesión (documento de app.js), así que muestra solo lo publicado.
//
// Escribir (desde 2026-09-25): el programa de Gemini se identifica con un certificado de cliente
// (su huella SHA-256). La huella sola NO es una identidad: tiene que estar vinculada a una cuenta de
// txt con un código que se pega en la web (si no, un suspendido volvería al minuto con otro
// certificado). Lo que se publica pasa por el mismo camino que la web (`escritura` = app.locals.gemini).
// El texto llega en la query de la URL, que tiene como mucho 1024 bytes: alcanza para ~800 caracteres.
// Al publicar, el asunto se guarda en memoria (por huella, 30 min) mientras se pide el mensaje, así
// no ocupa lugar en la URL; si se reinicia el servidor en el medio, se vuelve a pedir.
//
// Corre en el mismo proceso que la web: una excepción acá tira abajo todo el sitio. Por eso el
// manejo del pedido está entero dentro de un try (pasó con un %E0 en la URL, auditoría 2026-09-25).
const MAX_BYTES = 1024 + 2; // la URL puede tener hasta 1024 bytes, más el CRLF
const PLAZO_MS = 10_000; // plazo total para mandar el pedido (no se reinicia con cada byte)
const decodificador = new TextDecoder('utf-8', { fatal: true });

const pagina = (gemtext) => `20 text/gemini; charset=utf-8; lang=es\r\n${gemtext}`;

export function crearCapsula({ documento, escritura = null, baseUrl, cert, key, hosts = [], ahora = Date.now }) {
  const asuntos = new Map(); // huella → { board, asunto, t }
  const VIGENCIA_ASUNTO = 30 * 60_000;

  // Pedir el texto con 10, o leerlo de la query. undefined = no hay query todavía.
  function leerQuery(url) {
    if (!url.search || url.search === '?') return undefined;
    return decodeURIComponent(url.search.slice(1));
  }

  function paginaVincular(huella) {
    const codigo = escritura.codigo(huella);
    return pagina(`# Vincular este certificado
Tu certificado de Gemini todavía no está vinculado a una cuenta de txt. Para escribir desde acá:

* Entrá a la web con tu cuenta.
* En Mi cuenta → Gemini, pegá este código:

${codigo}

* Volvé y recargá esta página.

El código vence en 15 minutos. Lo que publiques desde Gemini cuenta como de tu cuenta, con las mismas normas y límites que en la web.
=> ${baseUrl}/cuenta#gemini Mi cuenta en la web
=> / Volver a la portada
`);
  }

  // Resultado de publicar o responder → respuesta de Gemini.
  function resultado(r, origen, volver) {
    if (r.destino && !r.enRevision) return `30 ${origen}${r.destino.split('#')[0]}`;
    if (r.destino) {
      return pagina(`# Quedó en revisión
El filtro tuvo dudas: tu mensaje lo va a mirar una persona antes de publicarse. Mientras tanto solo lo ves vos, en la web.
=> ${r.destino.split('#')[0]} Volver a la publicación
`);
    }
    return pagina(`# No se publicó
${r.error}
=> ${volver} Volver
`);
  }

  async function escribir(url, ruta, huella) {
    const origen = `gemini://${url.host}`;
    const segmentos = url.pathname.split('/').filter(Boolean);
    // /h/:id/responder
    if (segmentos[0] === 'h' && segmentos[2] === 'responder' && segmentos.length === 3) {
      const thread = /^\d+$/.test(segmentos[1]) ? escritura.hilo(Number(segmentos[1])) : null;
      if (!thread || !thread.visible) return '51 No encontrado';
      if (!huella) return '60 Para responder hace falta un certificado de cliente';
      const user = escritura.usuario(huella);
      if (!user) return paginaVincular(huella);
      if (thread.archived || thread.locked) return pagina(`# No se puede responder\nEsta publicación ya no acepta respuestas.\n=> /h/${thread.id} Volver\n`);
      const cuerpo = leerQuery(url);
      if (cuerpo === undefined) return `10 Tu respuesta a "${thread.subject.slice(0, 80)}" (hasta unos 800 caracteres)`;
      return resultado(await escritura.responder(user, thread, cuerpo), origen, `/h/${thread.id}`);
    }
    // /publicar → /publicar/:seccion (pide el asunto) → /publicar/:seccion/mensaje (pide el mensaje)
    if (segmentos[0] === 'publicar' && segmentos.length <= 3 && (segmentos.length < 3 || segmentos[2] === 'mensaje')) {
      if (!huella) return '60 Para publicar hace falta un certificado de cliente';
      const user = escritura.usuario(huella);
      if (!user) return paginaVincular(huella);
      if (segmentos.length === 1) {
        return pagina(`# Publicar\n¿En qué sección?\n${escritura.secciones.map((b) => `=> /publicar/${b.slug} ${b.nombre}`).join('\n')}\n`);
      }
      const board = escritura.tablon(segmentos[1]);
      if (!board) return '51 No encontrado';
      if (segmentos.length === 2) {
        const asunto = leerQuery(url);
        if (asunto === undefined) return `10 Asunto de la publicación en ${board.nombre}`;
        const limpio = asunto.replace(/\s+/g, ' ').trim();
        if (!limpio) return `10 Falta el asunto. Asunto de la publicación en ${board.nombre}`;
        if (limpio.length > 120) return '10 El asunto puede tener hasta 120 caracteres. Probá con uno más corto';
        for (const [h, a] of asuntos) if (a.t < ahora() - VIGENCIA_ASUNTO) asuntos.delete(h);
        asuntos.set(huella, { board: board.slug, asunto: limpio, t: ahora() });
        return `30 ${origen}/publicar/${board.slug}/mensaje`;
      }
      const guardado = asuntos.get(huella);
      if (!guardado || guardado.board !== board.slug || guardado.t < ahora() - VIGENCIA_ASUNTO) return `30 ${origen}/publicar/${board.slug}`;
      const cuerpo = leerQuery(url);
      if (cuerpo === undefined) return `10 ${guardado.asunto.slice(0, 80)} · Tu mensaje (hasta unos 800 caracteres)`;
      const r = await escritura.publicar(user, board, guardado.asunto, cuerpo);
      if (r.destino) asuntos.delete(huella);
      return resultado(r, origen, `/publicar/${board.slug}/mensaje`);
    }
    return null;
  }

  async function atender(linea, huella) {
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
    if (escritura) {
      let escrito;
      try {
        escrito = await escribir(url, ruta, huella);
      } catch (err) {
        if (err instanceof URIError) return '59 URL inválida';
        throw err;
      }
      if (escrito) return escrito;
    }
    const bloques = documento(ruta, Object.fromEntries(url.searchParams));
    if (!bloques) return '51 No encontrado';
    return pagina(aGemtext(bloques, { baseUrl }));
  }

  // requestCert sin rejectUnauthorized: en Gemini los certificados de cliente son autofirmados y
  // opcionales; solo importa su huella.
  const server = tls.createServer({ cert, key, minVersion: 'TLSv1.2', requestCert: !!escritura, rejectUnauthorized: false }, (socket) => {
    const trozos = [];
    let largo = 0;
    let respondido = false;
    let recibido = false;
    const plazo = setTimeout(() => socket.destroy(), PLAZO_MS);
    const responder = (texto) => {
      if (respondido) return;
      respondido = true;
      clearTimeout(plazo);
      socket.end(texto.includes('\r\n') ? texto : `${texto}\r\n`);
    };
    socket.on('error', () => socket.destroy());
    socket.on('close', () => clearTimeout(plazo));
    socket.on('data', async (trozo) => {
      if (respondido || recibido) return;
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
      // Pedido completo: desde acá corre la moderación, que puede tardar más que el plazo de envío.
      recibido = true;
      clearTimeout(plazo);
      const huella = socket.getPeerCertificate?.()?.fingerprint256 || null;
      try {
        responder(await atender(linea, huella));
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
