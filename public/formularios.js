// Al publicar, el botón se desactiva y dice "Revisando…": el filtro tarda unos segundos y en el
// celular la gente tocaba dos veces (el servidor igual evita el duplicado). Si el navegador vuelve
// atrás a esta página desde su caché, el botón se reactiva.
(() => {
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.classList.contains('form-post')) return;
    if (form.dataset.enviado) {
      e.preventDefault();
      return;
    }
    form.dataset.enviado = '1';
    const boton = form.querySelector('button');
    if (boton) {
      boton.dataset.texto = boton.textContent;
      boton.textContent = 'Revisando…';
      // Se desactiva después de este turno, así el envío ya salió.
      setTimeout(() => (boton.disabled = true));
    }
  });
  window.addEventListener('pageshow', () => {
    for (const form of document.querySelectorAll('form.form-post[data-enviado]')) {
      delete form.dataset.enviado;
      const boton = form.querySelector('button');
      if (boton) {
        boton.disabled = false;
        if (boton.dataset.texto) boton.textContent = boton.dataset.texto;
      }
    }
  });
})();
