// "Leé 421 ↗" en la barra de secciones: el link va a la portada de 421 y, al pasar el mouse, muestra
// el título de la última nota en castellano. Se pide a la Content API de Ghost (clave pública, la
// misma que usa el sitio de 421) una vez por hora y se guarda en memoria. Si falla, el link sigue
// estando, sin título: nada de la página depende de que 421 responda.
const API = 'https://421bn.ghost.io/ghost/api/content/posts/';
const CLAVE = '420da6f85b5cc903b347de9e33';

export const URL_421 = 'https://www.421.news/es/?utm_source=txt&utm_medium=secciones';

export function crearUltimaNota({ pedir = fetch, cada = 3_600_000 } = {}) {
  let titulo = null;
  async function actualizar() {
    try {
      const url = `${API}?key=${CLAVE}&limit=1&fields=title&filter=tag:hash-es`;
      const r = await pedir(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`Ghost ${r.status}`);
      const nuevo = (await r.json()).posts?.[0]?.title;
      if (typeof nuevo === 'string' && nuevo.trim()) titulo = nuevo.trim().slice(0, 200);
    } catch (err) {
      // Se queda con el título anterior (o sin título) hasta la próxima vuelta.
      console.error('[421] No se pudo traer la última nota:', err?.message ?? err);
    }
  }
  actualizar();
  setInterval(actualizar, cada).unref();
  return () => titulo;
}
