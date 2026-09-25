// Formularios de publicar y responder:
// - Al publicar, el botón se desactiva y dice "Revisando…": el filtro tarda unos segundos y en el
//   celular la gente tocaba dos veces (el servidor igual evita el duplicado). "Vista previa" no.
// - Contador de caracteres debajo de cada mensaje, contra el máximo del campo.
// Si el navegador vuelve atrás a esta página desde su caché, el botón se reactiva.
(() => {
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.classList.contains('form-post')) return;
    if (e.submitter && e.submitter.name === 'vista') return;
    if (form.dataset.enviado) {
      e.preventDefault();
      return;
    }
    form.dataset.enviado = '1';
    const boton = e.submitter || form.querySelector('button');
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
      for (const boton of form.querySelectorAll('button')) {
        boton.disabled = false;
        if (boton.dataset.texto) boton.textContent = boton.dataset.texto;
      }
    }
  });

  const formato = new Intl.NumberFormat('es-AR');
  for (const campo of document.querySelectorAll('form.form-post textarea[maxlength]')) {
    const maximo = Number(campo.maxLength);
    const contador = document.createElement('p');
    contador.className = 'contador';
    contador.setAttribute('aria-live', 'polite');
    const actualizar = () => {
      const n = campo.value.length;
      contador.textContent = `${formato.format(n)} / ${formato.format(maximo)}`;
      contador.classList.toggle('cerca', n > maximo * 0.9);
    };
    campo.after(contador);
    campo.addEventListener('input', actualizar);
    actualizar();
  }
})();
