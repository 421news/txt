// Seguir una cadena de respuestas sin subir y bajar. Los >>N de un mensaje, y los de "Respuestas:",
// son links a #pN: sin JavaScript saltan al mensaje como siempre. Con este script, si el mensaje
// citado está en la misma publicación:
// - con mouse (o con el teclado, al llegar al link), se ve una copia flotando arriba del link;
// - en pantallas táctiles, tocar el link despliega la copia ahí mismo, y otro toque la cierra.
// La copia es solo para leer: sin id (no se repite el ancla) ni botones de responder o reportar.
(() => {
  if (!document.getElementById('posts')) return;
  const conMouse = () => matchMedia('(hover: hover)').matches;

  // El mensaje al que apunta un link de cita, o null si no es una cita dentro de esta publicación.
  const citado = (link) => {
    if (!link || !(link.matches('a.cita') || link.closest('.respuestas'))) return null;
    const n = link.getAttribute('href')?.match(/^#p(\d+)$/)?.[1];
    return n ? document.getElementById(`p${n}`) : null;
  };

  const copia = (post, clase) => {
    const c = post.cloneNode(true);
    for (const el of [c, ...c.querySelectorAll('[id]')]) el.removeAttribute('id');
    for (const el of c.querySelectorAll('.citar, .reportar, .respuestas')) el.remove();
    c.classList.add(clase);
    return c;
  };

  let flotante = null;
  const quitar = () => {
    flotante?.remove();
    flotante = null;
  };

  function mostrar(link, post) {
    quitar();
    flotante = copia(post, 'flotante');
    flotante.setAttribute('aria-hidden', 'true'); // el lector de pantalla ya puede seguir el link
    document.body.append(flotante);
    const r = link.getBoundingClientRect();
    const barra = document.querySelector('.cabecera')?.getBoundingClientRect().bottom ?? 0;
    // Arriba del link, tapando lo que haya; si no entra bajo la barra de arriba, abajo.
    let arriba = r.top - flotante.offsetHeight - 6;
    if (arriba < barra + 6) arriba = r.bottom + 6;
    const izquierda = Math.min(r.left, innerWidth - flotante.offsetWidth - 8);
    flotante.style.top = `${arriba}px`;
    flotante.style.left = `${Math.max(8, izquierda)}px`;
  }

  const alEntrar = (e) => {
    const link = e.target.closest?.('a');
    const post = citado(link);
    // Con foco, solo si es del teclado: tocar un link en el celular también le da el foco.
    if (post && (e.type === 'focusin' ? link.matches(':focus-visible') : conMouse())) mostrar(link, post);
  };
  const alSalir = (e) => {
    const link = e.target.closest?.('a');
    if (citado(link) && !link.contains(e.relatedTarget)) quitar();
  };
  document.addEventListener('mouseover', alEntrar);
  document.addEventListener('mouseout', alSalir);
  document.addEventListener('focusin', alEntrar);
  document.addEventListener('focusout', alSalir);
  addEventListener('scroll', quitar, { passive: true });

  // Táctil: el clic despliega (o cierra) la copia en el lugar en vez de saltar. Dentro de la copia,
  // el No.N sigue llevando al mensaje original.
  document.addEventListener('click', (e) => {
    if (conMouse() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a');
    const post = citado(link);
    if (!post) return;
    e.preventDefault();
    const lugar = link.closest('.respuestas') ?? link;
    const n = post.id.slice(1);
    let abierta = lugar.nextElementSibling;
    while (abierta?.classList.contains('desplegada')) {
      if (abierta.dataset.de === n) {
        abierta.remove();
        link.setAttribute('aria-expanded', 'false');
        return;
      }
      abierta = abierta.nextElementSibling;
    }
    const caja = copia(post, 'desplegada');
    caja.dataset.de = n;
    lugar.after(caja);
    link.setAttribute('aria-expanded', 'true');
  });
})();
