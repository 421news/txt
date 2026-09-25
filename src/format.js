import { esc } from './html.js';

// Convierte el texto de un post en HTML seguro. Todo se escapa primero; después se agregan
// solo tres marcas: >cita (línea verde), >>123 (referencia a un post) y [spoiler]…[/spoiler].
// Los links no se convierten en <a>: el sitio es de texto y así se corta el spam de enlaces.
export function formatear(texto, { idsLocales = new Set() } = {}) {
  return texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linea) => {
      let h = esc(linea)
        .replace(/&gt;&gt;(\d{1,10})/g, (_, n) => {
          const href = idsLocales.has(Number(n)) ? `#p${n}` : `/p/${n}`;
          return `<a class="cita" href="${href}">&gt;&gt;${n}</a>`;
        })
        .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/g, '<span class="spoiler" tabindex="0">$1</span>');
      if (/^>(?!>\d)/.test(linea)) h = `<span class="verde">${h}</span>`;
      return h;
    })
    .join('<br>');
}

// Texto sin marcas para las fichas del catálogo: tapa los spoilers y junta las líneas.
export function textoPlano(texto) {
  return texto.replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/g, '[spoiler]').replace(/\s+/g, ' ').trim();
}

export function extracto(texto, max = 400) {
  return texto.length <= max ? texto : `${texto.slice(0, max).trimEnd()}…`;
}
