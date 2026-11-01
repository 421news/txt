// Últimas notas de 421 para el zócalo de txt. Se piden a la Content API de Ghost (clave pública, la misma
// que usa el sitio de 421). Hasta el 2026-10-31 había además un link "Leé 421 ↗" en la barra de secciones
// con la última nota en el title; se sacó a pedido del usuario porque el zócalo ya cumple esa función.
const API = 'https://421bn.ghost.io/ghost/api/content/posts/';
const CLAVE = '420da6f85b5cc903b347de9e33';

// Zócalo de arriba de todo (2026-10-31, pedido del usuario): las últimas notas de 421 en castellano corriendo
// de costado. Content API una vez por hora, en memoria, y si falla queda la lista anterior (o vacía: sin notas
// no se dibuja el zócalo). Las notas ocultas (#oculta) no entran.
export function crearUltimasNotas({ pedir = fetch, cada = 3_600_000, limite = 10 } = {}) {
  let notas = [];
  async function actualizar() {
    try {
      const url = `${API}?key=${CLAVE}&limit=${limite}&fields=title,url&filter=tag:hash-es%2Btag:-hash-oculta`;
      const r = await pedir(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`Ghost ${r.status}`);
      const nuevas = ((await r.json()).posts ?? [])
        .filter((p) => typeof p?.title === 'string' && p.title.trim() && /^https:\/\/www\.421\.news\//.test(p?.url ?? ''))
        .map((p) => ({ titulo: p.title.trim().slice(0, 200), url: `${p.url}?utm_source=txt&utm_medium=zocalo` }));
      if (nuevas.length) notas = nuevas;
    } catch (err) {
      console.error('[421] No se pudieron traer las últimas notas:', err?.message ?? err);
    }
  }
  actualizar();
  setInterval(actualizar, cada).unref();
  return () => notas;
}
