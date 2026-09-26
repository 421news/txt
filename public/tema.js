// Tema claro/oscuro sin recargar. El botón es un link a /tema, que guarda la cookie y vuelve a la
// página: funciona sin JavaScript, pero recarga y deja la página arriba de todo. Con este script el
// cambio se hace en el lugar: se escribe la misma cookie que pone el servidor y se cambia data-tema
// en <html>, que es lo que el CSS ya mira. Si no carga, el link sigue funcionando como siempre.
(() => {
  // Los mismos colores que views.js pone en <meta name="theme-color"> (la barra del navegador).
  const COLORES = { claro: '#f5eddc', oscuro: '#020803' };
  const UN_ANIO = 365 * 86_400;

  function barraDelNavegador(tema) {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();
    const metas = tema
      ? [{ content: COLORES[tema] }]
      : [
          { content: COLORES.oscuro, media: '(prefers-color-scheme: dark)' },
          { content: COLORES.claro, media: '(prefers-color-scheme: light)' },
        ];
    for (const datos of metas) document.head.append(Object.assign(document.createElement('meta'), { name: 'theme-color', ...datos }));
  }

  document.addEventListener('click', (e) => {
    // Abrir en otra pestaña (cmd/ctrl/medio) sigue siendo un link común.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href^="/tema?"]');
    if (!link) return;
    e.preventDefault();
    const t = new URL(link.href).searchParams.get('t');
    const tema = Object.hasOwn(COLORES, t) ? t : null; // "auto": vuelve a seguir al sistema
    const seguro = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = tema ? `tema=${tema}; path=/; max-age=${UN_ANIO}; samesite=lax${seguro}` : 'tema=; path=/; max-age=0';
    if (tema) document.documentElement.dataset.tema = tema;
    else delete document.documentElement.dataset.tema;
    barraDelNavegador(tema);

    if (link.closest('.boton-tema')) {
      // El CSS esconde el botón tocado y muestra el otro: el foco del teclado pasa al que quedó. Sin
      // preventScroll, focus() lleva la página hasta la posición original de la barra fija (arriba).
      if (document.activeElement === link) [...link.parentElement.children].find((a) => a !== link)?.focus({ preventScroll: true });
    } else if (!tema) {
      // "Usar el tema del sistema" (en el pie) ya no hace falta.
      if (link.previousElementSibling?.tagName === 'BR') link.previousElementSibling.remove();
      link.remove();
    }
  });
})();
