import { html, raw, esc } from './html.js';
import { estatico } from './estaticos.js';
import { BOARDS, LIMITS, boardBySlug } from './config.js';
import { NORMAS } from './normas.js';
import { formatear, extracto, textoPlano } from './format.js';

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: process.env.TZ_SITIO || 'America/Argentina/Buenos_Aires',
});
export const fecha = (ms) => formatoFecha.format(new Date(ms));

const esMod = (u) => !!u && (u.role === 'mod' || u.role === 'admin');

const AVISOS = {
  cola: 'Tu mensaje quedó en revisión. Mientras tanto solo lo ves vos.',
  reportado: 'Gracias por el reporte. Lo va a revisar un moderador.',
  'cuenta-borrada': 'Tu cuenta y tus mensajes quedaron borrados.',
  'gemini-ok': 'Listo: ya podés escribir desde Gemini con ese certificado.',
  'gemini-invalido': 'El código no existe o venció (dura 15 minutos). Pedí uno nuevo desde Gemini.',
  'gemini-suspendida': 'Mientras dure la suspensión no se pueden vincular certificados.',
  'gemini-tope': 'Llegaste al máximo de 5 certificados. Desvinculá alguno antes de sumar otro.',
};

const AYUDA = raw(
  '<code>&gt;</code> al inicio de una línea: cita · <code>&gt;&gt;123</code>: referencia a un post · <code>[spoiler]texto[/spoiler]</code> · <a href="/formato">Todos los códigos</a>',
);

// Botón de tema: se dibujan los dos y el CSS muestra el que corresponde al tema que se está viendo
// (también cuando sigue al sistema, que el servidor no conoce).
// Íconos en SVG inline: toman el color del texto (currentColor), así sirven en los dos temas.
const svg = (cuerpo) => raw(`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`);
const ICONOS = {
  sol: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
  luna: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  correo: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 7l9 6 9-6"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  lupa: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
};

function botonTema(ruta) {
  const volver = encodeURIComponent(ruta);
  return html`<span class="boton-tema"><a class="icono a-claro" href="/tema?t=claro&amp;volver=${volver}" rel="nofollow" title="Pasar a modo claro" aria-label="Pasar a modo claro">${ICONOS.sol}</a><a class="icono a-oscuro" href="/tema?t=oscuro&amp;volver=${volver}" rel="nofollow" title="Pasar a modo oscuro" aria-label="Pasar a modo oscuro">${ICONOS.luna}</a></span>`;
}

// Barra inferior para celular (en escritorio se oculta por CSS y queda la barra de arriba).
function barraAbajo(ctx) {
  const { user, csrf, ruta = '/', novedades } = ctx;
  const camino = ruta.split('?')[0];
  const seccion = camino.match(/^\/b\/([^/]+)/)?.[1];
  const publicar = user ? `${seccion ? `/b/${seccion}` : '/'}?publicar=1#publicar` : '/entrar';
  const activa = (cond) => (cond ? raw(' class="activa"') : '');
  return html`<nav class="abajo" aria-label="Navegación">
  <a href="/"${activa(camino === '/')}><b>⌂</b>Inicio</a>
  <details class="abajo-menu"><summary${activa(!!seccion)}><b>☰</b>Secciones</summary>
    <div class="menu-abajo">${BOARDS.map((b) => html`<a href="/b/${b.slug}">${b.nombre}</a>`)}</div>
  </details>
  <a href="${publicar}"><b>+</b>Publicar</a>
  ${user
    ? html`<a href="/respuestas"${activa(camino === '/respuestas')}><b>✉${novedades ? html`<span class="badge">${novedades}</span>` : ''}</b>Respuestas</a>
  <details class="abajo-menu derecha"><summary${activa(camino === '/cuenta' || camino === '/guardados' || camino === '/mod')}><b>☺</b>Cuenta</summary>
    <div class="menu-abajo">
      <a href="/guardados">Guardados</a>
      <a href="/cuenta">Mi cuenta</a>
      ${esMod(user) ? html`<a href="/mod">Moderación</a><a href="/mod/estadisticas">Estadísticas</a>` : ''}
      <a href="/normas">Normas</a>
      <a href="/formato">Formato</a>
      <form method="post" action="/salir"><input type="hidden" name="_csrf" value="${csrf}"><button class="enlace">Salir</button></form>
    </div>
  </details>`
    : html`<a href="/entrar"${activa(camino === '/entrar')}><b>→</b>Entrar</a>
  <a href="/normas"${activa(camino === '/normas')}><b>§</b>Normas</a>`}
</nav>`;
}

// Misma regla que documentos.rutaTxt (no se importa para no crear un ciclo views ↔ documentos).
const versionTexto = (ruta) => {
  const [camino, query] = ruta.split('?');
  return `${camino === '/' ? '/index' : camino}.txt${query ? `?${query}` : ''}`;
};

// Fondo de cada tema, para la barra del navegador en el celular. Tiene que coincidir con --fondo.
const COLOR_TEMA = { oscuro: '#020803', claro: '#f5eddc', descanso: '#191a1d', monocromo: '#161616' };

export const DESCRIPCION_SITIO =
  'Foro de texto de 421. Tecnología, cultura, música, juegos y vida real.';

// SEO: cada página lleva descripción, canonical y Open Graph. `indexar: false` para lo que no
// tiene que aparecer en buscadores (entrar, cuenta, moderación, vistas duplicadas, errores).
// `canonical` es la ruta sin dominio; si falta, no se emite. `jsonLd` es un objeto que va tal cual.
export function pagina(ctx, { titulo, cuerpo, aviso, descripcion = DESCRIPCION_SITIO, canonical, indexar = true, tipo = 'website', jsonLd }) {
  const { user, csrf, siteName, baseUrl, tema, ruta = '/' } = ctx;
  const tituloCompleto = titulo ? `${titulo} · ${siteName}` : `${siteName} · foro de texto de 421`;
  const url = canonical ? `${baseUrl}${canonical}` : null;
  // Un "</" dentro del JSON cerraría el <script>: se escapa.
  const ld = jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : '';
  return `<!doctype html>${html`<html lang="es"${tema ? raw(` data-tema="${tema}"`) : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tituloCompleto}</title>
<meta name="description" content="${descripcion}">
${indexar ? '' : raw('<meta name="robots" content="noindex, follow">')}
${url ? html`<link rel="canonical" href="${url}">` : ''}
${canonical && /^\/($|b\/|h\/|normas$)/.test(canonical) ? html`<link rel="alternate" type="text/plain" href="${baseUrl}${versionTexto(canonical)}">` : ''}
<meta property="og:site_name" content="${siteName}">
<meta property="og:locale" content="es_AR">
<meta property="og:type" content="${tipo}">
<meta property="og:title" content="${tituloCompleto}">
<meta property="og:description" content="${descripcion}">
${url ? html`<meta property="og:url" content="${url}">` : ''}
<meta property="og:image" content="${baseUrl}${estatico('og.jpg')}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="&gt;_ txt · solo texto. Foro pseudoanónimo de 421">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${baseUrl}${estatico('og.jpg')}">
<meta name="twitter:site" content="@421net">
<meta name="twitter:title" content="${tituloCompleto}">
<meta name="twitter:description" content="${descripcion}">
${ld}
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/static/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
${tema
  ? html`<meta name="theme-color" content="${COLOR_TEMA[tema]}">`
  : raw('<meta name="theme-color" content="#020803" media="(prefers-color-scheme: dark)">\n<meta name="theme-color" content="#f5eddc" media="(prefers-color-scheme: light)">')}
<link rel="stylesheet" href="${estatico('style.css')}">
<script src="${estatico('tema.js')}" data-colores="${JSON.stringify(COLOR_TEMA)}" defer></script>
${user ? html`<script src="${estatico('formularios.js')}" defer></script>` : ''}
</head>
<body>
<header class="cabecera">
  <div class="cab-fila">
    <a class="marca" href="/">${siteName}</a>
    <div class="cab-der">
      <a class="icono lupa" href="/buscar" title="Buscar" aria-label="Buscar">${ICONOS.lupa}</a>
      ${botonTema(ruta)}
      ${user
        ? html`<a class="icono correo${ctx.novedades ? ' hay-novedades' : ''}" href="/respuestas" title="Respuestas" aria-label="Respuestas${ctx.novedades ? ` (${ctx.novedades} nuevas)` : ''}">${ICONOS.correo}${ctx.novedades ? html`<span class="badge">${ctx.novedades}</span>` : ''}</a>`
        : html`<a class="icono" href="/entrar">Entrar</a>`}
      <details class="menu-cab">
        <summary class="icono" aria-label="Menú">${ICONOS.menu}<span>Menú</span></summary>
        <div class="menu-desplegable">
          ${user ? html`<a href="/respuestas">Respuestas${ctx.novedades ? ` (${ctx.novedades})` : ''}</a><a href="/guardados">Guardados</a><a href="/cuenta">Mi cuenta</a>` : html`<a href="/entrar">Entrar</a>`}
          ${esMod(user) ? html`<a href="/mod">Moderación</a><a href="/mod/estadisticas">Estadísticas</a>` : ''}
          <a href="/normas">Normas</a>
          <a href="/formato">Formato</a>
          ${user ? html`<form method="post" action="/salir"><input type="hidden" name="_csrf" value="${csrf}"><button class="enlace">Salir</button></form>` : ''}
        </div>
      </details>
    </div>
  </div>
  <nav class="secciones">${BOARDS.map((b) => html` <a href="/b/${b.slug}"${(ruta.split('?')[0].match(/^\/b\/([^/]+)/)?.[1] === b.slug) ? raw(' class="activa"') : ''}>${b.nombre}</a>`)}</nav>
</header>
<main>
${aviso && Object.hasOwn(AVISOS, aviso) ? html`<p class="aviso">${AVISOS[aviso]}</p>` : ''}
${cuerpo}
</main>
${barraAbajo(ctx)}
<footer class="pie"><a href="/normas">Normas</a> · <a href="/formato">Formato</a> · <a href="/texto">Versión texto</a> · <a href="/terminos">Términos</a> · <a href="/privacidad">Privacidad</a> · <a href="mailto:admin@421.news">admin@421.news</a>${ctx.codigoUrl ? html` · <a href="${ctx.codigoUrl}">Código fuente</a> (AGPLv3)` : ''}
${tema ? html`<br><a href="/tema?t=auto&amp;volver=${encodeURIComponent(ruta)}" rel="nofollow">Usar el tema del sistema</a>` : ''}</footer>
</body>
</html>`}`;
}

export const mensaje = (titulo, texto) => html`<h1>${titulo}</h1><p>${texto}</p>`;

// Un hilo en un listado: mensaje inicial, "N respuestas omitidas" y las últimas respuestas.
function listaHilos(ctx, hilos, { conTablon = false } = {}) {
  if (!hilos.length) return html`<p class="ayuda">No hay publicaciones todavía.</p>`;
  return hilos.map(
    (t) => html`<section class="hilo-resumen">
  <h2><a href="/h/${t.id}">${t.subject}</a>${marcaNovedad(t)}${conTablon
    ? html` <a class="etiqueta" href="/b/${t.board}">${boardBySlug(t.board)?.nombre}</a>`
    : ''}</h2>
  ${vistaPost(ctx, t.op, { esOp: true, resumen: true })}
  ${t.omitidas
    ? html`<p class="omitidas">${t.omitidas === 1 ? '1 respuesta omitida' : `${t.omitidas} respuestas omitidas`}. <a href="/h/${t.id}">Ver la publicación completa</a></p>`
    : ''}
  ${t.respuestas.map((p) => vistaPost(ctx, p, { resumen: true }))}
  <p class="ayuda"><a href="/h/${t.id}#responder">Responder</a> · ${t.reply_count} respuestas${t.locked ? ' · cerrada' : ''}</p>
</section>`,
  );
}

// "nuevo" si se abrió desde tu visita anterior, o "N nuevas" si tiene respuestas desde entonces.
function marcaNovedad(t) {
  if (t.esNuevo) return html` <span class="marca-nuevo">nuevo</span>`;
  if (t.nuevas) return html` <span class="marca-nuevo">${t.nuevas === 1 ? '1 nueva' : `${t.nuevas} nuevas`}</span>`;
  return '';
}

// Catálogo: una ficha por hilo (asunto, comienzo del mensaje, respuestas).
function catalogo(hilos, { conTablon = false } = {}) {
  if (!hilos.length) return html`<p class="ayuda">No hay publicaciones todavía.</p>`;
  return html`<div class="catalogo">${hilos.map(
    (t) => html`<article class="ficha">
    <div class="ficha-barra"><span>${conTablon ? boardBySlug(t.board)?.nombre : `No.${t.op_post_id}`}</span><span class="solo-eww"> · </span><span>${marcaNovedad(t)} R: ${t.reply_count}</span></div>
    <h2 class="ficha-titulo"><a class="ficha-asunto" href="/h/${t.id}"><strong>${t.subject}</strong></a></h2>
    <div class="ficha-texto">${extracto(textoPlano(t.op_body), 180)}</div>
    <div class="ficha-pie">${fecha(t.bumped_at)}${t.locked ? ' · cerrada' : ''}</div>
  </article>`,
  )}</div>`;
}

function selectorVista(vista) {
  return html`<nav class="vistas">Vista: ${vista === 'catalogo' ? html`<strong>catálogo</strong>` : html`<a href="?">catálogo</a>`}
  ${vista === 'lista' ? html`<strong>lista</strong>` : html`<a href="?vista=lista">lista</a>`}</nav>`;
}

const listado = (ctx, hilos, vista, opciones) =>
  vista === 'lista' ? listaHilos(ctx, hilos, opciones) : catalogo(hilos, opciones);

function paginacion(paginaActual, totalPaginas, parametros = {}) {
  if (totalPaginas <= 1) return '';

  const url = (pagina) => `?${new URLSearchParams({ ...parametros, pagina })}`;

  function renderPagina(pagina) {
    if (pagina === paginaActual) {
      return html`<strong aria-current="page" aria-label="Página ${pagina}">${pagina}</strong>`;
    }
    return html`<a href="${url(pagina)}" aria-label="Página ${pagina}">${pagina}</a>`;
  }

  const paginasVisibles = [];

  if (totalPaginas <= 7) {
    for (let pagina = 1; pagina <= totalPaginas; pagina++) paginasVisibles.push(pagina);
  } else {
    let primeraPaginaVisible = paginaActual - 1;

    if (primeraPaginaVisible < 2) primeraPaginaVisible = 2;
    if (primeraPaginaVisible > totalPaginas - 3) primeraPaginaVisible = totalPaginas - 3;
    const ultimaPaginaVisible = primeraPaginaVisible + 2;

    paginasVisibles.push(1);

    for (let pagina = primeraPaginaVisible; pagina <= ultimaPaginaVisible; pagina++) {
      paginasVisibles.push(pagina);
    }

    paginasVisibles.push(totalPaginas);
  }

  const elementosPaginacion = [];
  let ultimaPaginaAgregada = 0;

  for (const pagina of paginasVisibles) {
    const paginasOmitidas = pagina - ultimaPaginaAgregada - 1;
    if (paginasOmitidas === 1) {
      elementosPaginacion.push(renderPagina(pagina - 1));
    } else if (paginasOmitidas > 1) {
      elementosPaginacion.push(html`<span aria-hidden="true">…</span>`);
    }
    elementosPaginacion.push(renderPagina(pagina));
    ultimaPaginaAgregada = pagina;
  }

  return html`<nav class="paginas" aria-label="Paginación">
${paginaActual > 1 ? html`<a href="${url(paginaActual - 1)}" rel="prev">← Anterior</a>` : ''}
${elementosPaginacion}
${paginaActual < totalPaginas ? html`<a href="${url(paginaActual + 1)}" rel="next">Siguiente →</a>` : ''}
</nav>`;
}

// La portada son los hilos de todos los tablones, ordenados por última respuesta.
export function portada(ctx, { hilos, vista, pagina: actual, paginas, form }) {
  return html`<h1 class="solo-lector">Últimas publicaciones</h1>
${formHilo(ctx, null, form)}
<p class="ayuda">Pseudoanónimo y moderado: cada mensaje se revisa antes de publicarse. <a href="/normas">Normas</a></p>
${selectorVista(vista)}
${listado(ctx, hilos, vista, { conTablon: true })}
${paginacion(actual, paginas, vista === 'lista' ? { vista } : {})}`;
}

function bloqueoPublicar(ctx, accion) {
  if (!ctx.user) return html`<p class="invitacion"><a href="/entrar">Entrá</a> para ${accion}.</p>`;
  if (ctx.user.banned_until && ctx.user.banned_until > ctx.ahora) {
    return html`<p class="aviso">Tu cuenta está suspendida hasta el ${fecha(ctx.user.banned_until)}. Motivo: ${ctx.user.ban_reason}</p>`;
  }
  return null;
}

// Sin board (portada), el formulario pide elegir el tablón.
// Vista previa: el mensaje formateado con el mismo formatear() que usa el sitio, sin publicarlo ni
// pasarlo por el filtro (no gasta API). Va arriba del formulario, que conserva el texto.
function vistaPrevia(asunto, cuerpo, ids = new Set()) {
  if (!cuerpo) return '';
  return html`<section class="vista-previa" aria-label="Vista previa">
  <p class="ayuda">Vista previa: todavía no se publicó.</p>
  ${asunto ? html`<h2>${asunto}</h2>` : ''}
  <div class="texto">${raw(formatear(cuerpo, { idsLocales: ids }))}</div>
</section>`;
}

function formHilo(ctx, board, { asunto = '', cuerpo = '', tablon = '', error, abrir, previa } = {}) {
  const bloqueo = bloqueoPublicar(ctx, 'publicar');
  if (bloqueo) return bloqueo;
  return html`<details class="nuevo-hilo" id="publicar"${error || asunto || cuerpo || abrir ? raw(' open') : ''}>
  <summary>Publicar${board ? ` en ${board.nombre}` : ''}</summary>
  ${previa ? vistaPrevia(asunto, cuerpo) : ''}
  <form class="form-post" method="post" action="${board ? `/b/${board.slug}/hilo` : '/hilo'}">
    ${error ? html`<p class="error">${error}</p>` : ''}
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    ${board
      ? ''
      : html`<label>Tablón <select name="tablon" required>
      <option value="">Elegí dónde publicarlo</option>
      ${BOARDS.map((b) => html`<option value="${b.slug}"${b.slug === tablon ? raw(' selected') : ''}>${b.nombre}</option>`)}
    </select></label>`}
    <label>Asunto <input type="text" name="asunto" maxlength="${LIMITS.asunto}" required value="${asunto}"></label>
    <label>Mensaje <textarea name="cuerpo" rows="8" maxlength="${LIMITS.cuerpo}" required>${cuerpo}</textarea></label>
    <p class="botones"><button>Publicar</button> <button class="secundario" name="vista" value="1" formnovalidate>Vista previa</button></p>
    <p class="ayuda">${AYUDA}</p>
  </form>
</details>`;
}

function formRespuesta(ctx, thread, { cuerpo = '', sage = false, error, previa, ids, cita } = {}) {
  const bloqueo = bloqueoPublicar(ctx, 'responder');
  if (bloqueo) return bloqueo;
  return html`<form class="form-post" method="post" action="/h/${thread.id}/responder" id="responder">
  <h2>Responder</h2>
  ${previa ? vistaPrevia('', cuerpo, ids) : ''}
  ${error ? html`<p class="error">${error}</p>` : ''}
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <textarea name="cuerpo" rows="6" maxlength="${LIMITS.cuerpo}" required aria-label="Mensaje"${previa ? raw(' autofocus') : ''}${cita ? html` data-cita="${cita}"` : ''}>${cuerpo}</textarea>
  <p class="botones"><button>Publicar</button> <button class="secundario" name="vista" value="1" formnovalidate>Vista previa</button></p>
  <label class="ayuda"><input type="checkbox" name="sage" value="1"${sage ? raw(' checked') : ''}> sage: responder sin subir la publicación</label>
  <p class="ayuda">${AYUDA}</p>
</form>`;
}

export function tablon(ctx, { board, hilos, vista, pagina: actual, paginas, archivo, form }) {
  return html`<header class="tablon-cabecera">
  <h1>${board.nombre}${archivo ? ' · archivo' : ''}</h1>
  <p>${board.descripcion}</p>
  <p class="ayuda">${archivo
    ? html`<a href="/b/${board.slug}">Volver a las publicaciones activas</a>`
    : html`<a href="/b/${board.slug}/archivo">Archivo</a>`}</p>
</header>
${archivo ? '' : formHilo(ctx, board, form)}
${selectorVista(vista)}
${listado(ctx, hilos, vista, {})}
${paginacion(actual, paginas, vista === 'lista' ? { vista } : {})}`;
}

// resumen: versión para listados (texto recortado, sin reportar, sin ancla propia).
const abiertoPara = (p) => p.abierto !== false;

function vistaPost(ctx, p, { ids = new Set(), esOp = false, resumen = false }) {
  if (p.status === 'removed') {
    // Cuerpo vacío = lo borró su autor al borrar la cuenta (ver borrarCuenta en app.js).
    const quien = p.body === '' ? 'su autor' : 'moderación';
    return html`<article class="post respuesta retirado" id="p${p.id}"><p>No.${p.id} · Eliminado por ${quien}.</p></article>`;
  }
  const clases = ['post', esOp ? 'op' : 'respuesta', p.status === 'queued' ? 'en-revision' : ''].filter(Boolean).join(' ');
  return html`<article class="${clases}" id="p${p.id}">
  <header class="post-meta">
    <span class="anon">Pseudoanónimo</span>
    <span class="id" title="Identifica a la misma persona dentro de esta publicación">ID ${p.anon}</span>
    ${p.esAutorOp ? html`<span class="marca-op">OP</span>` : ''}
    ${p.esMio ? html`<span class="marca-vos" title="Solo lo ves vos">(vos)</span>` : ''}
    ${p.esNuevo && !resumen ? html`<span class="marca-nuevo" title="Desde tu visita anterior">nuevo</span>` : ''}
    <time>${fecha(p.created_at)}</time>
    <a class="num" href="#p${p.id}">No.${p.id}</a>
    ${!resumen && ctx.user && p.status === 'published' && abiertoPara(p)
      ? html`<a class="citar" href="?cita=${p.id}#responder">Responder</a>`
      : ''}
    ${p.sage ? html`<span class="sage">sage</span>` : ''}
  </header>
  ${p.status === 'queued' ? html`<p class="nota">En revisión: por ahora solo lo ves vos.</p>` : ''}
  <div class="texto">${raw(formatear(resumen ? extracto(p.body, 800) : p.body, { idsLocales: ids }))}</div>
  ${!resumen && p.respuestas?.length
    ? html`<p class="respuestas">Respuestas: ${p.respuestas.map((n) => html`<a href="#p${n}">&gt;&gt;${n}</a> `)}</p>`
    : ''}
  ${!resumen && ctx.user && p.status === 'published'
    ? html`<p class="reportar"><a href="/p/${p.id}/reportar" rel="nofollow">Reportar</a></p>`
    : ''}
</article>`;
}

// Reportar un mensaje (/p/:id/reportar): el mensaje, como en los listados, y el motivo.
export function reportar(ctx, { post, thread, volver }) {
  return html`<h1>Reportar</h1>
<p class="ayuda">En <a href="${volver}">${thread.subject}</a>. Los mensajes reportados por varias personas se ocultan hasta que los mire un moderador.</p>
${vistaPost(ctx, post, { esOp: post.id === thread.op_post_id, resumen: true })}
<form class="form-reportar" method="post" action="/p/${post.id}/reportar">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <label>Motivo <select name="motivo">${NORMAS.map((n) => html`<option value="${n.id}">${n.titulo}</option>`)}</select></label>
  <p class="botones"><button>Enviar reporte</button> <a href="${volver}">Cancelar</a></p>
</form>`;
}

// Guardar para leer después: un formulario (sin JavaScript) que guarda o saca de guardados.
// El botón va en la línea de "← sección" y se asocia al formulario con form="guardar": un <form>
// adentro de un <p> hace que el navegador cierre el párrafo y el botón quede en otra línea.
function botonGuardar(ctx, thread, guardado) {
  if (!ctx.user || !thread.visible) return '';
  return html` · <button class="enlace" form="guardar">${guardado ? 'Sacar de guardados' : 'Guardar'}</button>`;
}

function formGuardar(ctx, thread, guardado) {
  if (!ctx.user || !thread.visible) return '';
  return html`<form id="guardar" method="post" action="/h/${thread.id}/guardar"><input type="hidden" name="_csrf" value="${ctx.csrf}">${guardado ? raw('<input type="hidden" name="quitar" value="1">') : ''}</form>`;
}

export function hilo(ctx, { thread, board, posts, ids, form, guardado = false }) {
  let estado = '';
  if (thread.archived) estado = html`<p class="aviso">Publicación archivada: se puede leer pero ya no acepta respuestas.</p>`;
  else if (thread.locked) estado = html`<p class="aviso">Publicación cerrada: llegó al límite de respuestas.</p>`;
  const abierto = thread.visible && !thread.archived && !thread.locked;
  const ultimo = posts.length ? posts[posts.length - 1].id : 0;
  // data-hilo/data-ultimo los usa /static/vivo.js para traer lo nuevo sin recargar. Sin JS, la
  // página funciona igual que siempre.
  return html`${formGuardar(ctx, thread, guardado)}<p class="ayuda"><a href="/b/${board.slug}">← ${board.nombre}</a>${botonGuardar(ctx, thread, guardado)}</p>
<h1>${thread.subject}</h1>
${estado}
<div id="posts"${abierto ? raw(` data-hilo="${thread.id}" data-ultimo="${ultimo}"`) : ''}>
${postsSueltos(ctx, { thread, posts, ids })}
</div>
<p id="vivo-aviso" class="ayuda" hidden></p>
${abierto ? formRespuesta(ctx, thread, { ...form, ids }) : ''}
${abierto ? html`<script src="${estatico('vivo.js')}" defer></script>` : ''}`;
}

export function postsSueltos(ctx, { thread, posts, ids }) {
  const abierto = thread.visible && !thread.archived && !thread.locked;
  return html`${posts.map((p) => vistaPost(ctx, { ...p, abierto }, { ids, esOp: p.id === thread.op_post_id }))}`;
}

export function normas() {
  return html`<h1>Normas</h1>
<p>Un filtro automático revisa cada mensaje antes de publicarlo; si rechaza el tuyo, te dice por qué. Los mensajes reportados por varias personas se ocultan hasta que los mire un moderador.</p>
<ol class="normas">${NORMAS.map((n) => html`<li><strong>${n.titulo}.</strong> ${n.texto}</li>`)}</ol>
<p>Quien no las respete puede ser suspendido. Abuso infantil, abuso sexual y violencia explícita: suspensión inmediata.</p>`;
}

// Ley 25.326 de Protección de Datos Personales (Argentina). Si cambia lo que se guarda en db.js,
// hay que cambiar esta página.
export function privacidad(ctx) {
  return html`<h1>Privacidad</h1>
<p>${ctx.siteName} es un foro de 421 Broadcasting Network (421.news), responsable de los datos que se describen acá. Contacto: <a href="mailto:admin@421.news">admin@421.news</a>.</p>

<h2>Qué guardamos</h2>
<ul>
  <li><strong>Un identificador de tu cuenta de Google.</strong> Es un número que Google asigna a cada cuenta. Sirve para que puedas volver a entrar y para poder suspender una cuenta que no respeta las <a href="/normas">normas</a>. Al entrar, Google nos muestra tu correo: lo usamos solo para saber si sos moderador y no lo guardamos. No pedimos tu nombre, tu foto ni tus contactos.</li>
  <li><strong>Lo que publicás</strong>, con la fecha. Para el resto de los usuarios es pseudoanónimo: cada persona aparece con un código distinto en cada publicación. Internamente, cada mensaje queda asociado a tu cuenta, para poder moderar.</li>
  <li><strong>Los mensajes que el filtro rechazó</strong>, con el motivo, para detectar abusos.</li>
  <li><strong>Los reportes que hacés</strong> y las decisiones de moderación sobre tus mensajes o tu cuenta.</li>
  <li><strong>Las publicaciones que guardás</strong>, para que las encuentres en Guardados. Solo las ves vos.</li>
  <li><strong>Si escribís desde Gemini</strong>, la huella del certificado de tu programa de Gemini, vinculada a tu cuenta, y la fecha en que lo usaste por última vez. Podés desvincularlo en Mi cuenta.</li>
  <li><strong>Estadísticas de uso, sin rastreo.</strong> Contamos cuántas páginas se ven por día y cuántas personas distintas, sin cookies ni IP guardadas: para no contar dos veces a la misma persona usamos un código anónimo que se descarta al día siguiente. Si tenés cuenta, registramos qué días entraste, solo para saber cuántos usuarios activos hay.</li>
  <li><strong>Una cookie de sesión</strong> (dura 30 días o hasta que salgas) otra de un solo uso durante el ingreso con Google y otra con la hora de tu última visita, que queda en tu navegador y sirve solo para marcar lo nuevo. No usamos cookies de publicidad ni de analítica.</li>
</ul>

<h2>Con quién se comparte</h2>
<ul>
  <li><strong>Anthropic</strong> (Estados Unidos): el texto de cada mensaje pasa por su modelo Claude para revisarlo antes de publicarse. Se envía solo el texto, sin datos de tu cuenta.</li>
  ${ctx.sombraActiva ? html`<li><strong>TypeSafe</strong> (Estados Unidos), durante una prueba: el texto de cada mensaje también pasa por su modelo Jev, para comparar filtros. No decide nada ni recibe datos de tu cuenta.</li>` : ''}
  <li><strong>Google</strong>: gestiona el ingreso con tu cuenta.</li>
  <li><strong>Railway</strong> (Estados Unidos): aloja el sitio y la base de datos. Como cualquier servidor, registra datos técnicos de las conexiones, como la dirección IP.</li>
</ul>
<p>Al borrar la cuenta queda solo un registro de que existió y de las decisiones de moderación que la afectaron, sin tus textos ni el identificador de Google.</p>
<p>No vendemos ni cedemos datos a nadie más. Solo los entregaríamos ante una orden judicial.</p>

<h2>Tus derechos</h2>
<p>Podés borrar tu cuenta y tus mensajes cuando quieras desde <a href="/cuenta">Cuenta</a>. Para pedir acceso a tus datos o corregirlos, escribí a <a href="mailto:admin@421.news">admin@421.news</a> desde el correo de la cuenta de Google con la que entrás. Respondemos dentro de los plazos de la Ley 25.326 (diez días para el acceso, cinco para la corrección o el borrado).</p>
<p>El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326. La Agencia de Acceso a la Información Pública, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.</p>

<p class="ayuda">Última actualización: 25 de septiembre de 2026.</p>`;
}

// Cada ejemplo se muestra escrito y renderizado con el mismo formatear() que usan los posts, así
// la página no puede quedar desactualizada respecto de lo que el sitio realmente acepta.
const EJEMPLOS_FORMATO = [
  {
    codigo: '>texto',
    nombre: 'Cita',
    uso: 'Una línea que empieza con > se muestra como cita, en otro color. Sirve para citar una parte de otro mensaje o un texto de afuera. Vale por línea: para citar varias, poné > al principio de cada una.',
    ejemplo: '>los videojuegos no son arte\nNo estoy de acuerdo, y te digo por qué.',
  },
  {
    codigo: '>>123',
    nombre: 'Referencia a un post',
    uso: 'Dos > seguidos de un número de post (el No. que figura en cada mensaje) crean un link a ese mensaje. Así se le responde a alguien que no es el OP. El botón "Responder" de cada post lo escribe por vos, y el post citado muestra abajo "Respuestas" con los que lo citaron. Si el número es de otra publicación, el link lleva hasta allá.',
    ejemplo: '>>34\nSí, podés responderle a cualquiera.',
    ids: [34],
  },
  {
    codigo: '[spoiler]texto[/spoiler]',
    nombre: 'Spoiler',
    uso: 'Tapa el texto hasta que alguien pasa el mouse, lo toca o lo selecciona con el teclado. En el catálogo aparece como [spoiler]. Abre y cierra en la misma línea.',
    ejemplo: 'El final de la temporada: [spoiler]el narrador era el perro[/spoiler].',
  },
];

export function formato() {
  return html`<h1>Formato</h1>
<p>txt es solo texto: no hay negritas, imágenes ni links clickeables (las direcciones web se pueden escribir, pero no se convierten en links). Estos son los únicos códigos que el sitio reconoce.</p>
${EJEMPLOS_FORMATO.map(
  (e) => html`<section class="formato">
  <h2><code>${e.codigo}</code> · ${e.nombre}</h2>
  <p>${e.uso}</p>
  <div class="formato-ejemplo">
    <div><p class="ayuda">Escribís</p><pre>${e.ejemplo}</pre></div>
    <div><p class="ayuda">Se ve</p><div class="texto">${raw(formatear(e.ejemplo, { idsLocales: new Set(e.ids ?? []) }))}</div></div>
  </div>
</section>`,
)}
<h2>Otras cosas que conviene saber</h2>
<ul>
  <li><strong>sage</strong>: la casilla "sage" del formulario de respuesta publica tu mensaje sin subir la publicación al principio de la lista. Sirve para comentar algo menor sin darle visibilidad.</li>
  <li><strong>ID</strong>: cada persona tiene un código distinto en cada publicación. Dentro de una misma publicación, el mismo ID es la misma persona; en otra publicación, esa persona tiene otro.</li>
  <li><strong>OP</strong>: marca los mensajes de quien abrió la publicación.</li>
  <li><strong>(vos)</strong>: marca tus propios mensajes. Solo lo ves vos.</li>
  <li><strong>Saltos de línea</strong>: se respetan tal cual los escribís.</li>
  <li><strong>Largo</strong>: el asunto puede tener hasta ${LIMITS.asunto} caracteres y el mensaje hasta ${LIMITS.cuerpo}.</li>
  <li><strong>Frecuencia</strong>: entre un mensaje y otro tienen que pasar ${LIMITS.segEntrePosts} segundos, y ${LIMITS.segEntreHilos / 60} minutos entre dos publicaciones nuevas.</li>
</ul>
<p>Lo que se puede publicar y lo que no está en las <a href="/normas">normas</a>.</p>`;
}

export function buscar(ctx, { texto, resultados, pagina, paginas }) {
  // El fragmento viene de FTS con marcas \u0001/\u0002 alrededor de lo encontrado (el texto guardado
  // no puede tenerlas: limpiarTexto saca los controles). Se escapa todo y recién después se marca.
  const resaltar = (s) => raw(esc(s ?? '').replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>'));
  return html`<h1>Buscar</h1>
<form class="form-buscar" method="get" action="/buscar" role="search">
  <input type="search" name="q" value="${texto}" maxlength="100" placeholder="Palabras a buscar" aria-label="Buscar" ${texto ? '' : raw('autofocus')}>
  <button>Buscar</button>
</form>
${texto && !resultados.length ? html`<p class="ayuda">No encontré nada con eso.</p>` : ''}
${resultados.length
  ? html`<p class="ayuda">${resultados.total} ${resultados.total === 1 ? 'resultado' : 'resultados'}, incluido el archivo.</p>
<ol class="resultados">${resultados.map(
      (r) => html`<li>
  <a class="res-asunto" href="/h/${r.thread_id}#p${r.id}">${r.subject}</a>
  <span class="ayuda">${boardBySlug(r.board)?.nombre ?? r.board} · No.${r.id}${r.es_op ? ' · mensaje inicial' : ''} · ${fecha(r.created_at)}${r.archived ? ' · archivada' : ''}</span>
  ${r.fragmento ? html`<p class="res-fragmento">${resaltar(r.fragmento)}</p>` : ''}
</li>`,
    )}</ol>
${paginacion(pagina, paginas, { q: texto })}`
  : ''}`;
}

export function sombra(ctx, { activa, total, cruce, gravesEscapados, desacuerdos, costo }) {
  const pct = (n) => (total.n ? `${Math.round((n / (total.n - (total.errores ?? 0) || 1)) * 100)}%` : '—');
  const coinciden = cruce.filter((c) => c.c === c.j).reduce((s, c) => s + c.n, 0);
  const fila = (r) => {
    const resp = r.respuestas ? JSON.parse(r.respuestas) : {};
    const top = Object.entries(resp)
      .filter(([, a]) => a.type === 'noul')
      .sort((a, b) => b[1].noul - a[1].noul)
      .slice(0, 3)
      .map(([k, a]) => `${k} ${a.noul.toFixed(2)}`)
      .join(' · ');
    return html`<li><span class="ayuda">${fecha(r.created_at)} · Claude: ${r.claude_decision}${r.claude_rule && r.claude_rule !== 'ninguna' ? ` (${r.claude_rule})` : ''} · Jev: ${r.jev_decision}${r.jev_rule && r.jev_rule !== 'ninguna' ? ` (${r.jev_rule})` : ''}${r.jev_grave && r.jev_grave !== 'ninguna' ? ` · grave ${r.jev_grave}` : ''}</span>
  <p class="res-fragmento">${extracto(r.cuerpo ?? '', 280)}</p>
  <p class="ayuda">${top}</p></li>`;
  };
  return html`<h1>Prueba Jev (en sombra)</h1>
<p class="ayuda">${activa ? 'Activa: cada mensaje que revisa Claude también lo revisa Jev, sin decidir nada.' : 'Apagada: falta TYPESAFE_API_KEY.'}</p>
<ul>
  <li>Mensajes comparados: <strong>${total.n}</strong>${total.errores ? ` (${total.errores} con error de Jev)` : ''}</li>
  <li>Coinciden en la decisión: <strong>${pct(coinciden)}</strong></li>
  <li>Graves que detectó Claude y a Jev se le escaparon: <strong>${gravesEscapados.length}</strong></li>
  <li>Costo de Jev hasta ahora: <strong>US$${costo.toFixed(4)}</strong> · demora promedio: ${total.ms ? Math.round(total.ms) : '—'} ms</li>
</ul>
<h2>Cruce de decisiones</h2>
<table class="cruce"><tr><th>Claude</th><th>Jev</th><th>Mensajes</th></tr>
${cruce.map((c) => html`<tr${c.c === c.j ? '' : raw(' class="distinto"')}><td>${c.c}</td><td>${c.j}</td><td>${c.n}</td></tr>`)}</table>
${gravesEscapados.length ? html`<h2>Graves que se le escaparon a Jev</h2><ul class="resultados">${gravesEscapados.map(fila)}</ul>` : ''}
<h2>Últimos desacuerdos</h2>
${desacuerdos.length ? html`<ul class="resultados">${desacuerdos.map(fila)}</ul>` : html`<p class="ayuda">Ninguno todavía.</p>`}`;
}

// Gráfico de líneas en SVG inline, sin JS, en el estilo del panel de analíticas de 421: curva suave,
// área rellena muy suave, un punto por día. Curva monótona (Fritsch-Carlson): no inventa picos ni
// baja de cero entre dos puntos. El detalle de cada día va en <title> sobre un área de toque ancha.
function lineas(titulo, datos) {
  const W = 600;
  const H = 170;
  const arriba = 18;
  const base = H - 26;
  const maximo = Math.max(0, ...datos.map((d) => d.n));
  const max = Math.max(1, maximo);
  const n = datos.length;
  const paso = W / Math.max(1, n - 1);
  const pts = datos.map((d, i) => [i * paso, base - (d.n / max) * (base - arriba)]);
  // Pendientes monótonas.
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const pend = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / dx[i]);
  const m = pts.map((_, i) => {
    if (i === 0) return pend[0] ?? 0;
    if (i === n - 1) return pend[n - 2] ?? 0;
    return pend[i - 1] * pend[i] <= 0 ? 0 : (pend[i - 1] + pend[i]) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (pend[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / pend[i];
    const b = m[i + 1] / pend[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * pend[i]; m[i + 1] = t * b * pend[i]; }
  }
  const f = (v) => v.toFixed(1);
  let curva = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const d = (x1 - x0) / 3;
    curva += `C${f(x0 + d)},${f(y0 + m[i] * d)} ${f(x1 - d)},${f(y1 - m[i + 1] * d)} ${f(x1)},${f(y1)}`;
  }
  const area = `${curva}L${f(pts[n - 1][0])},${base}L${f(pts[0][0])},${base}Z`;
  const etiqueta = (dia) => dia.slice(8, 10) + '/' + dia.slice(5, 7);
  const puntos = datos
    .map((d, i) => {
      const [x, y] = pts[i];
      return `<g class="punto"><rect x="${f(x - paso / 2)}" y="0" width="${f(paso)}" height="${base}" class="hit"/><circle cx="${f(x)}" cy="${f(y)}" r="3.5"/><title>${etiqueta(d.dia)}: ${d.n}</title></g>`;
    })
    .join('');
  const grilla = [0.5, 1]
    .map((k) => `<line x1="0" x2="${W}" y1="${f(base - k * (base - arriba))}" y2="${f(base - k * (base - arriba))}" class="grilla"/>`)
    .join('');
  const ejeX = datos
    .map((d, i) => {
      const ultimo = i === n - 1;
      if (!(i % 7 === 0 || ultimo) || (!ultimo && n - 1 - i < 4)) return '';
      const [x, anclaje] = i === 0 ? [0, 'start'] : ultimo ? [W, 'end'] : [i * paso, 'middle'];
      return `<text x="${f(x)}" y="${H - 4}" text-anchor="${anclaje}">${etiqueta(d.dia)}</text>`;
    })
    .join('');
  const hoy = datos[n - 1]?.n ?? 0;
  return html`<figure class="grafico">
  <figcaption><strong>${titulo}</strong> <span class="ayuda">hoy ${hoy} · máximo ${maximo}</span></figcaption>
  ${raw(`<svg viewBox="-4 0 ${W + 8} ${H}" role="img" aria-label="${esc(titulo)}, últimos ${n} días">${grilla}<line x1="0" y1="${base + 0.5}" x2="${W}" y2="${base + 0.5}" class="base"/><text x="0" y="12" class="tope">${maximo}</text><path d="${area}" class="area"/><path d="${curva}" class="linea"/>${puntos}${ejeX}</svg>`)}
</figure>`;
}

export function estadisticas(ctx, { hoy, total, desdeVisitas, series }) {
  const ultimo = (k) => series[k][series[k].length - 1]?.n ?? 0;
  const tiles = [
    ['Usuarios registrados', total],
    ['Cuentas nuevas hoy', ultimo('nuevas')],
    ['Usuarios activos hoy', ultimo('activos')],
    ['Visitas hoy', ultimo('vistas')],
    ['Visitantes hoy', ultimo('visitantes')],
    ['Publicaciones hoy', ultimo('publicaciones')],
    ['Respuestas hoy', ultimo('respuestas')],
  ];
  const nombres = { vistas: 'Visitas', visitantes: 'Visitantes únicos', activos: 'Usuarios activos', publicaciones: 'Publicaciones', respuestas: 'Respuestas', nuevas: 'Cuentas nuevas' };
  const orden = ['vistas', 'visitantes', 'activos', 'publicaciones', 'respuestas', 'nuevas'];
  return html`<h1>Estadísticas</h1>
<p class="ayuda">Últimos 30 días. Visitas contadas en el servidor, sin cookies ni IPs guardadas${desdeVisitas ? `, desde el ${desdeVisitas}` : ''}: antes de esa fecha no hay datos de visitas. "Usuarios activos" = cuentas que entraron al sitio ese día; los días anteriores se reconstruyeron con inicios de sesión, mensajes y reportes.</p>
<div class="tiles">${tiles.map(([k, v]) => html`<div class="tile"><span class="tile-n">${v.toLocaleString('es-AR')}</span><span class="tile-k">${k}</span></div>`)}</div>
<div class="graficos">${orden.map((k) => lineas(nombres[k], series[k]))}</div>
<details class="tabla-datos"><summary>Ver los números</summary>
<table class="cruce"><tr><th>Día</th>${orden.map((k) => html`<th>${nombres[k]}</th>`)}</tr>
${series.vistas
  .map((_, i) => html`<tr><td>${series.vistas[i].dia}</td>${orden.map((k) => html`<td>${series[k][i].n}</td>`)}</tr>`)
  .reverse()}</table>
</details>`;
}

export function texto(ctx, { gemini } = {}) {
  const b = ctx.baseUrl;
  return html`<h1>Versión texto</h1>
<p>Todo txt se puede leer como texto puro, sin diseño: sirve para la terminal, conexiones lentas, lectores de pantalla o simplemente para leer tranquilo.</p>
<h2>En el navegador</h2>
<p>Agregá <code>.txt</code> al final de la dirección:</p>
<ul>
  <li>Portada: <a href="/index.txt">${b}/index.txt</a></li>
  <li>Una sección: <a href="/b/cultura.txt">${b}/b/cultura.txt</a></li>
  <li>Una publicación: <code>${b}/h/NÚMERO.txt</code></li>
  <li>Normas: <a href="/normas.txt">${b}/normas.txt</a></li>
</ul>
<h2>En la terminal</h2>
<p>Con <code>curl</code>, <code>wget</code> o <code>httpie</code>, las direcciones de siempre responden en texto:</p>
<pre>curl ${b}
curl ${b}/b/juegos
curl ${b}/h/1 | less</pre>
<p class="ayuda">Poné la dirección con <code>https://</code> adelante (o usá <code>curl -L</code>): sin eso, curl se queda en la redirección a https y no muestra nada.</p>
${gemini
  ? html`<h2>En Gemini</h2>
<p>txt también es una cápsula de <a href="https://geminiprotocol.net/">Gemini</a>, la "internet chica": solo texto y links, sin publicidad ni rastreo. Se abre con un programa como <a href="https://gmi.skyjake.fi/lagrange/">Lagrange</a> (computadora y celular) o Amfora (terminal):</p>
<pre>${gemini}</pre>
<p class="ayuda">La primera vez, el programa te va a preguntar si confiás en el certificado de la cápsula: es el nuestro, aceptalo.</p>
<p>Desde Gemini también se puede publicar y responder. Tu programa tiene que usar un certificado de cliente (en Lagrange: Identidades → Nueva identidad). La primera vez que escribas, la cápsula te da un código para pegar en <a href="/cuenta#gemini">Mi cuenta</a>; desde ahí, lo que publiques cuenta como de tu cuenta, con las mismas normas y límites. Cada mensaje puede tener hasta unos 800 caracteres.</p>`
  : ''}
<p class="ayuda">La versión texto es para leer. Para publicar o responder se usa la web. Los spoilers no se pueden tapar en texto, así que ahí aparecen como [spoiler: leelo en la web].</p>`;
}

export function terminos(ctx) {
  return html`<h1>Términos de uso</h1>
<p>${ctx.siteName} es un foro de texto de 421 Broadcasting Network (421.news). Al entrar con tu cuenta y publicar, aceptás estos términos y las <a href="/normas">normas</a>.</p>

<h2>La cuenta</h2>
<ul>
  <li>Para publicar tenés que ser mayor de 18 años y entrar con una cuenta de Google.</li>
  <li>Una persona, una cuenta. Abrir otra para esquivar una suspensión es motivo de suspensión definitiva.</li>
  <li>Podés borrar tu cuenta cuando quieras desde <a href="/cuenta">Cuenta</a>.</li>
</ul>

<h2>Lo que publicás</h2>
<ul>
  <li>Sos responsable de lo que escribís. Que el foro sea pseudoanónimo para los demás no te exime ante la ley.</li>
  <li>Lo que publicás sigue siendo tuyo. Nos das permiso, gratis y sin exclusividad, para mostrarlo en el sitio mientras esté publicado.</li>
  <li>No publiques textos ajenos que no tengas derecho a reproducir.</li>
</ul>

<h2>Moderación</h2>
<ul>
  <li>Cada mensaje pasa por un filtro automático antes de publicarse, y los moderadores pueden retirar mensajes y suspender cuentas que no respeten las normas, sin aviso previo.</li>
  <li>El filtro puede equivocarse en los dos sentidos. Si rechaza algo que no debía, reformulalo; si deja pasar algo que no debía, reportalo.</li>
  <li>Para denunciar contenido ilegal o que infringe derechos de autor, usá el botón de reporte o escribí a <a href="mailto:admin@421.news">admin@421.news</a>.</li>
</ul>

<h2>El servicio</h2>
<ul>
  <li>El foro es gratuito y se ofrece tal como está. Puede cambiar, interrumpirse o cerrar.</li>
  <li>Si cambiamos estos términos, la fecha de abajo lo indica. Seguir usando el foro después del cambio implica aceptarlos.</li>
  <li>Rige la ley argentina. Cómo tratamos tus datos está en <a href="/privacidad">Privacidad</a>.</li>
</ul>

<p class="ayuda">Última actualización: 23 de septiembre de 2026.</p>`;
}

export function respuestas(ctx, { lista }) {
  const tipo = { comentario: 'comentó en tu publicación', respuesta: 'te respondió' };
  return html`<h1>Respuestas</h1>
<p class="ayuda">Comentarios en las publicaciones que abriste y mensajes que te citan con &gt;&gt;. Solo dentro del sitio: no mandamos mails ni notificaciones.</p>
${lista.length
  ? html`<ul class="avisos">${lista.map(
      (n) => html`<li${n.leida ? '' : raw(' class="nueva"')}>
    <a href="/h/${n.thread_id}#p${n.post_id}">${n.subject}</a> <span class="ayuda">· alguien ${tipo[n.tipo]} · ${fecha(n.created_at)}${n.leida ? '' : ' · nueva'}</span>
    <div class="extracto">${extracto(textoPlano(n.body), 200)}</div>
  </li>`,
    )}</ul>`
  : html`<p>Todavía no hay respuestas.</p>`}`;
}

export function guardados(ctx, { lista }) {
  return html`<h1>Guardados</h1>
<p class="ayuda">Publicaciones que guardaste para leer después. Solo las ves vos. Se guardan o se sacan con el botón "Guardar" de cada publicación.</p>
${lista.length
  ? html`<ul class="mias">${lista.map((t) => html`<li><a href="/h/${t.id}">${t.subject}</a> <span class="ayuda">· ${boardBySlug(t.board)?.nombre ?? t.board} · ${t.reply_count} respuestas · ${fecha(t.bumped_at)}${t.archived ? ' · archivada' : ''}</span></li>`)}</ul>`
  : html`<p>Todavía no guardaste nada.</p>`}`;
}

export function cuenta(ctx, { suspendida, error, mias = [], llaves = [], geminiUrl = null } = {}) {
  return html`<h1>Cuenta</h1>
<p>Para el resto del foro sos pseudoanónimo. De tu cuenta de Google solo guardamos un identificador (ver <a href="/privacidad">Privacidad</a>).</p>
<h2>Donde participaste</h2>
${mias.length
  ? html`<ul class="mias">${mias.map((t) => html`<li><a href="/h/${t.id}">${t.subject}</a> <span class="ayuda">· ${boardBySlug(t.board)?.nombre ?? t.board} · ${t.reply_count} respuestas · tu último mensaje: ${fecha(t.ultima)}</span></li>`)}</ul>`
  : html`<p class="ayuda">Todavía no publicaste nada.</p>`}
<p class="ayuda">Solo lo ves vos. En cada publicación, tus mensajes aparecen marcados con "(vos)".</p>
${preferencias(ctx.tema)}
${geminiUrl ? gemini(ctx, llaves, geminiUrl) : ''}
<h2>Borrar la cuenta</h2>
<p>Se borra el texto de todos tus mensajes, los que el filtro te rechazó y los reportes que hiciste. Donde había un mensaje tuyo va a decir "Eliminado por su autor". Si abriste una publicación que tiene respuestas de otras personas, esas respuestas siguen ahí. No se puede deshacer.</p>
${error ? html`<p class="error">${error}</p>` : ''}
${suspendida
  ? html`<p>Mientras dure la suspensión no se puede borrar la cuenta. Si necesitás que borremos tus datos, escribí a <a href="mailto:admin@421.news">admin@421.news</a>.</p>`
  : html`<form class="form-post" method="post" action="/cuenta/borrar">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <label class="ayuda"><input type="checkbox" name="confirmar" value="1" required> Entiendo que se borra todo y no se puede deshacer.</label>
  <p><button>Borrar mi cuenta</button></p>
</form>`}`;
}

// Certificados de cliente de Gemini vinculados a la cuenta (se identifican por su huella).
function gemini(ctx, llaves, geminiUrl) {
  const corta = (h) => `${h.slice(0, 11)}…${h.slice(-5)}`;
  return html`<h2 id="gemini">Gemini</h2>
<p>Podés publicar y responder desde la <a href="/texto">cápsula Gemini</a> (${geminiUrl}). Tu programa de Gemini se identifica con un certificado: la primera vez que escribas te va a dar un código para pegar acá. El certificado solo no alcanza: lo que publiques cuenta como de esta cuenta, con las mismas normas y límites.</p>
<form class="form-post" method="post" action="/cuenta/gemini">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <label>Código <input type="text" name="codigo" required maxlength="20" autocomplete="off" placeholder="TXT-XXXXXX"></label>
  <p><button>Vincular</button></p>
</form>
${llaves.length
  ? html`<ul class="mias">${llaves.map((l) => html`<li><code>${corta(l.huella)}</code> <span class="ayuda">· vinculado ${fecha(l.created_at)}${l.ultimo_uso ? html` · último uso ${fecha(l.ultimo_uso)}` : ''}</span>
  <form method="post" action="/cuenta/gemini/desvincular" class="en-linea"><input type="hidden" name="_csrf" value="${ctx.csrf}"><input type="hidden" name="huella" value="${l.huella}"><button>Desvincular</button></form></li>`)}</ul>`
  : html`<p class="ayuda">No tenés certificados vinculados.</p>`}`;
}

function preferencias(tema) {
  // "sistema" = sin cookie: sigue a prefers-color-scheme (claro u oscuro). Marcado = lo elegido de verdad.
  const opciones = [['auto', 'sistema', !tema], ...Object.keys(COLOR_TEMA).map((v) => [v, v, tema === v])];
  return html`<h2>Preferencias</h2>
<p class="temas">${opciones.map(([valor, nombre, actual]) => html`<a href="/tema?t=${valor}&amp;volver=%2Fcuenta" rel="nofollow"${actual ? raw(' aria-current="true"') : ''}><span class="muestra muestra-${valor}" aria-hidden="true">Aa</span> ${nombre}</a>`)}</p>`;
}

export function entrar(ctx, { google, prueba, error } = {}) {
  return html`<h1>Entrar</h1>
<p>En el foro nadie ve con qué cuenta entraste: todos los mensajes son pseudoanónimos. De tu cuenta de Google solo se guarda un identificador, para poder suspenderla si no respeta las normas. El correo no se guarda. <a href="/privacidad">Privacidad</a></p>
${error ? html`<p class="error">${error}</p>` : ''}
${google ? html`<p><a class="boton" href="/auth/google">Entrar con Google</a></p>` : ''}
${prueba
  ? html`<form class="form-post" method="post" action="/entrar/prueba">
  <p class="aviso">Modo desarrollo: no hay credenciales de Google cargadas. Este acceso de prueba no existe en producción.</p>
  <label>Nombre de prueba <input type="text" name="nombre" required maxlength="40"></label>
  <label class="ayuda"><input type="checkbox" name="admin" value="1"> Entrar como admin</label>
  <p><button>Entrar</button></p>
</form>`
  : ''}`;
}

function botonMod(ctx, id, accion, texto) {
  return html`<form method="post" action="/mod/p/${id}/${accion}" class="en-linea"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button>${texto}</button></form>`;
}

function itemMod(ctx, p) {
  const filtro = [p.mod_decision, p.mod_rule !== 'ninguna' ? p.mod_rule : null, p.mod_reason].filter(Boolean).join(' · ');
  return html`<article class="post">
  <header class="post-meta">
    <a href="/h/${p.thread_id}#p${p.id}">No.${p.id}</a>
    <span>${p.board_nombre} · ${p.subject}</span>
    <span>cuenta #${p.user_id}, creada ${fecha(p.user_created)}</span>
    <span>${p.eliminados} eliminados antes</span>
    <time>${fecha(p.created_at)}</time>
  </header>
  <div class="texto">${raw(formatear(p.body))}</div>
  <p class="ayuda">Filtro: ${filtro || '—'}</p>
  ${p.reportes ? html`<p class="ayuda">Reportes: ${p.reportes}</p>` : ''}
  <div class="acciones">
    ${p.status === 'queued' ? botonMod(ctx, p.id, 'aprobar', 'Aprobar') : ''}
    ${botonMod(ctx, p.id, 'eliminar', 'Eliminar')}
    ${p.status === 'published' && p.reportes ? botonMod(ctx, p.id, 'descartar', 'Descartar reportes') : ''}
    <form method="post" action="/mod/p/${p.id}/banear" class="banear">
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <input type="number" name="dias" value="7" min="1" max="3650" aria-label="Días"> días
      <input type="text" name="motivo" placeholder="Motivo" required aria-label="Motivo">
      <button>Eliminar y suspender</button>
    </form>
  </div>
</article>`;
}

export function mod(ctx, { cola, reportados, graves = [] }) {
  const graveTexto = { menores: 'abuso infantil (permanente)', abuso: 'abuso (30 días)', violencia_explicita: 'violencia explícita (30 días)' };
  return html`<h1>Moderación</h1>
<h2>Suspensiones automáticas (${graves.length})</h2>
<p class="ayuda">Tolerancia cero: el filtro rechazó el mensaje y suspendió la cuenta. Si fue un error, levantá la suspensión.</p>
${graves.length
  ? graves.map((g) => html`<article class="post en-revision">
  <header class="post-meta"><span>${graveTexto[g.grave] ?? g.grave}</span><time>${fecha(g.created_at)}</time></header>
  <p class="nota">${g.reason ?? ''}</p>
  <div class="texto">${g.subject ? html`<strong>${g.subject}</strong><br>` : ''}${g.body}</div>
  ${g.banned_until && g.banned_until > ctx.ahora
    ? html`<form method="post" action="/mod/u/${g.user_id}/levantar" class="en-linea"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button>Levantar suspensión</button></form>`
    : html`<p class="ayuda">Suspensión levantada o vencida.</p>`}
</article>`)
  : html`<p class="ayuda">Ninguna.</p>`}
<h2>En revisión (${cola.length})</h2>
${cola.length ? cola.map((p) => itemMod(ctx, p)) : html`<p class="ayuda">Nada pendiente.</p>`}
<h2>Reportados (${reportados.length})</h2>
${reportados.length ? reportados.map((p) => itemMod(ctx, p)) : html`<p class="ayuda">Sin reportes abiertos.</p>`}`;
}
