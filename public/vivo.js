// Actualización en vivo de una publicación: cada 20 segundos, y solo con la pestaña visible, pide
// los mensajes nuevos y los agrega al final. Es el único script del sitio; si no carga, la página
// funciona igual (se ve lo nuevo al recargar).
(() => {
  const lista = document.getElementById('posts');
  if (!lista || !lista.dataset.hilo) return;
  const aviso = document.getElementById('vivo-aviso');
  const cada = 20000;
  let ultimo = Number(lista.dataset.ultimo) || 0;
  let pidiendo = false;

  async function revisar() {
    if (pidiendo || document.hidden) return;
    pidiendo = true;
    try {
      const r = await fetch(`/h/${lista.dataset.hilo}/nuevos?desde=${ultimo}`, { credentials: 'same-origin' });
      if (!r.ok) return;
      const datos = await r.json();
      if (datos.html && datos.html.trim()) {
        lista.insertAdjacentHTML('beforeend', datos.html);
        const n = lista.querySelectorAll('article').length;
        aviso.textContent = `Hay mensajes nuevos (se agregaron solos). Total: ${n}.`;
        aviso.hidden = false;
      }
      ultimo = Math.max(ultimo, Number(datos.ultimo) || 0);
    } catch {
      // Sin conexión o el servidor no respondió: se vuelve a intentar en el próximo turno.
    } finally {
      pidiendo = false;
    }
  }

  setInterval(revisar, cada);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
})();
