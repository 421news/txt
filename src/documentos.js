// Versión sin HTML de las páginas de lectura, para texto plano (.txt, curl) y Gemini.
//
// Cada página se arma una sola vez como un "documento": una lista de bloques neutros (título,
// párrafo, cita, link, separador). Después un traductor lo escribe en el formato que toque:
// aTexto() para texto plano y aGemtext() para Gemini. Así las dos versiones muestran lo mismo.
//
// Los links llevan una `ruta` lógica del sitio (/h/12, /b/cultura?pagina=2). Cada traductor la
// convierte en su dirección: https://…/h/12.txt en texto plano, /h/12 dentro de la cápsula Gemini.
// Los que solo tienen sentido en la web (publicar, entrar) van con `web: true`.

import { BOARDS, boardBySlug } from './config.js';
import { NORMAS } from './normas.js';
import { extracto, textoPlano } from './format.js';
import { fecha } from './views.js';

const t = (nivel, texto) => ({ tipo: 'titulo', nivel, texto });
const p = (texto) => ({ tipo: 'parrafo', texto });
const link = (ruta, texto, web = false) => ({ tipo: 'link', ruta, texto, web });
const sep = () => ({ tipo: 'separador' });

// Los spoilers no se pueden tapar en texto plano: se reemplazan por un aviso.
const sinSpoilers = (texto) => texto.replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/g, '[spoiler: leelo en la web]');

function encabezado(siteName) {
  return [
    t(1, `${siteName} · foro de texto de 421`),
    p('Solo texto, pseudoanónimo y moderado. Para publicar o responder, entrá desde la web.'),
    { tipo: 'menu', items: [link('/', 'Portada'), ...BOARDS.map((b) => link(`/b/${b.slug}`, b.nombre)), link('/normas', 'Normas')] },
    sep(),
  ];
}

function listaHilos(hilos, { conTablon }) {
  if (!hilos.length) return [p('No hay publicaciones todavía.')];
  return hilos.flatMap((h) => [
    link(`/h/${h.id}`, `${conTablon ? `[${boardBySlug(h.board)?.nombre ?? h.board}] ` : ''}${h.subject} (${h.reply_count} ${h.reply_count === 1 ? 'respuesta' : 'respuestas'})`),
    { tipo: 'detalle', texto: `${fecha(h.bumped_at)} · ${extracto(textoPlano(h.op_body), 160)}` },
  ]);
}

function paginacion(ruta, pagina, paginas) {
  if (paginas <= 1) return [];
  const bloques = [sep(), p(`Página ${pagina} de ${paginas}`)];
  const con = (n) => (n > 1 ? `${ruta}${ruta.includes('?') ? '&' : '?'}pagina=${n}` : ruta);
  if (pagina > 1) bloques.push(link(con(pagina - 1), '← Página anterior'));
  if (pagina < paginas) bloques.push(link(con(pagina + 1), 'Página siguiente →'));
  return bloques;
}

export function docPortada({ siteName, hilos, pagina, paginas }) {
  return [...encabezado(siteName), t(2, 'Últimas publicaciones'), ...listaHilos(hilos, { conTablon: true }), ...paginacion('/', pagina, paginas)];
}

export function docTablon({ siteName, board, hilos, pagina, paginas, archivo }) {
  const ruta = archivo ? `/b/${board.slug}/archivo` : `/b/${board.slug}`;
  return [
    ...encabezado(siteName),
    t(2, archivo ? `Archivo de ${board.nombre}` : board.nombre),
    p(board.descripcion),
    ...(archivo ? [] : [link(`/b/${board.slug}/archivo`, `Archivo de ${board.nombre}`)]),
    ...listaHilos(hilos, { conTablon: false }),
    ...paginacion(ruta, pagina, paginas),
  ];
}

export function docHilo({ siteName, thread, board, posts }) {
  const bloques = [
    ...encabezado(siteName),
    t(2, thread.subject),
    link(`/b/${board.slug}`, `Sección ${board.nombre}`),
  ];
  if (thread.archived) bloques.push(p('Publicación archivada: se puede leer pero ya no acepta respuestas.'));
  else if (thread.locked) bloques.push(p('Publicación cerrada: llegó al límite de respuestas.'));
  bloques.push(link(`/h/${thread.id}`, 'Responder en la web', true));
  for (const post of posts) {
    bloques.push(sep());
    if (post.status === 'removed') {
      bloques.push(p(`No.${post.id} · Eliminado por ${post.body === '' ? 'su autor' : 'moderación'}.`));
      continue;
    }
    const marcas = [post.esAutorOp ? 'OP' : null, post.sage ? 'sage' : null].filter(Boolean).join(' · ');
    bloques.push(t(3, `No.${post.id} · ID ${post.anon}${marcas ? ` · ${marcas}` : ''} · ${fecha(post.created_at)}`));
    // Las líneas que empiezan con > (sin ser >>123) son citas, igual que en la web.
    for (const linea of sinSpoilers(post.body).replace(/\r\n?/g, '\n').split('\n')) {
      bloques.push(/^>(?!>\d)/.test(linea) ? { tipo: 'cita', texto: linea.replace(/^>\s?/, '') } : { tipo: 'usuario', texto: linea });
    }
    if (post.respuestas?.length) bloques.push(p(`Respuestas: ${post.respuestas.map((n) => `>>${n}`).join(' ')}`));
  }
  return bloques;
}

export function docNormas({ siteName }) {
  return [
    ...encabezado(siteName),
    t(2, 'Normas'),
    p('Un filtro automático revisa cada mensaje antes de publicarlo. Los mensajes reportados por varias personas se ocultan hasta que los mire un moderador.'),
    ...NORMAS.map((n, i) => p(`${i + 1}. ${n.titulo}. ${n.texto}`)),
    p('Quien no las respete puede ser suspendido. Abuso infantil, abuso sexual y violencia explícita: suspensión inmediata.'),
  ];
}

// --- Traductores --------------------------------------------------------------------------

// Corta en líneas de hasta `ancho` columnas sin partir palabras (las muy largas, como una URL,
// quedan enteras). La terminal no hace esto sola con texto plano.
function envolver(texto, ancho, sangria = '') {
  if (!texto) return [sangria.trimEnd()];
  const lineas = [];
  let actual = '';
  for (const palabra of texto.split(/ +/)) {
    if (actual && (actual + ' ' + palabra).length > ancho - sangria.length) {
      lineas.push(sangria + actual);
      actual = palabra;
    } else actual = actual ? `${actual} ${palabra}` : palabra;
  }
  lineas.push(sangria + actual);
  return lineas;
}

// Ruta lógica → dirección de la versión .txt (el .txt va antes de la query).
export function rutaTxt(ruta) {
  const [camino, query] = ruta.split('?');
  const base = camino === '/' ? '/index' : camino;
  return `${base}.txt${query ? `?${query}` : ''}`;
}

// Controles y caracteres de formato fuera (salvo \n y \t): en texto plano, un U+009B se lee en
// algunas terminales como secuencia de escape (auditoría 2026-09-25). Cubre también lo ya guardado.
const limpio = (s) => String(s ?? '').replace(/(?![\n\t])[\p{Cc}\p{Cf}]/gu, '');
const limpiarBloque = (b) => ({ ...b, texto: limpio(b.texto), items: b.items?.map((i) => ({ ...i, texto: limpio(i.texto) })) });

export function aTexto(bloques, { baseUrl, ancho = 78 }) {
  const salida = [];
  for (const b of bloques.map(limpiarBloque)) {
    if (b.tipo === 'titulo') {
      const texto = b.nivel === 1 ? b.texto.toUpperCase() : b.texto;
      salida.push('', texto, (b.nivel === 3 ? '-' : '=').repeat(Math.min(ancho, texto.length)));
    } else if (b.tipo === 'parrafo') salida.push(...envolver(b.texto, ancho));
    // El texto de la gente va con sangría: así no puede imitar un encabezado ni un separador.
    else if (b.tipo === 'usuario') salida.push(...envolver(b.texto, ancho, '  '));
    else if (b.tipo === 'cita') salida.push(...envolver(b.texto, ancho, '  > '));
    else if (b.tipo === 'link') salida.push(...envolver(b.texto, ancho), `  → ${baseUrl}${b.web ? b.ruta : rutaTxt(b.ruta)}`);
    else if (b.tipo === 'menu') {
      const col = Math.max(...b.items.map((i) => i.texto.length)) + 2;
      salida.push('', ...b.items.map((i) => `  ${i.texto.padEnd(col)}${baseUrl}${i.web ? i.ruta : rutaTxt(i.ruta)}`));
    } else if (b.tipo === 'detalle') salida.push(...envolver(b.texto, ancho, '  '), '');
    else if (b.tipo === 'separador') salida.push('', '·'.repeat(ancho));
  }
  return `${salida.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// Gemtext (el formato de Gemini): una línea por elemento; los links van solos en su línea con =>.
// Los enlaces internos quedan como rutas de la cápsula; los que solo existen en la web, con https.
export function aGemtext(bloques, { baseUrl }) {
  const salida = [];
  const destino = (l) => (l.web ? `${baseUrl}${l.ruta}` : l.ruta);
  for (const b of bloques.map(limpiarBloque)) {
    if (b.tipo === 'titulo') salida.push('', `${'#'.repeat(b.nivel)} ${b.texto}`);
    else if (b.tipo === 'parrafo' || b.tipo === 'detalle') salida.push(b.texto);
    else if (b.tipo === 'cita') salida.push(`> ${b.texto}`);
    // Una línea de la gente que empieza como sintaxis de gemtext se neutraliza con un espacio: si no,
    // "=> gemini://…" sería un link, "###" un encabezado falso y "```" se tragaría el resto.
    else if (b.tipo === 'usuario') salida.push(/^(=>|#|\*|```|>)/.test(b.texto) ? ` ${b.texto}` : b.texto);
    else if (b.tipo === 'link') salida.push(`=> ${destino(b)} ${b.texto}`);
    else if (b.tipo === 'menu') salida.push('', ...b.items.map((i) => `=> ${destino(i)} ${i.texto}`));
    else if (b.tipo === 'separador') salida.push('');
  }
  return `${salida.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
