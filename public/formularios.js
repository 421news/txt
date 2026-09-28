// Formularios de publicar y responder:
// - Al publicar, el botón se desactiva y dice "Revisando…": el filtro tarda unos segundos y en el
//   celular la gente tocaba dos veces (el servidor igual evita el duplicado). "Vista previa" no.
// - Contador de caracteres debajo de cada mensaje, contra el máximo del campo.
// - Borrador en sessionStorage: cambiar el tema, recargar o volver atrás es una navegación nueva,
//   y lo escrito en un formulario sin control vive solo en el DOM (se perdía al cambiar el tema).
//   Si el navegador vuelve atrás a esta página desde su caché, el botón se reactiva.
// - "Responder" en un mensaje agrega >>N a lo que ya está escrito, sin recargar la página. Sin
//   JavaScript es un link a ?cita=N; si se llega así, el >>N se suma al borrador en vez de pisarlo.
(() => {
  // Los formularios llevan autocomplete="off": si no, al volver atrás después de publicar el navegador
  // rellenaba el campo con lo ya enviado, sincronizar() lo guardaba como borrador y reaparecía en cada
  // visita. El borrador lo maneja solo este script. "2": descarta los borradores que quedaron pegados así.
  const PREFIJO = 'borrador2:';
  const VALIDEZ = 86_400_000; // un borrador vencido no se vuelve a ofrecer.

  // Un borrador por formulario, no por URL: el mismo "publicar" se dibuja en la portada y en cada
  // sección, y lo escrito tiene que seguir a la persona aunque cambie de página. Cada respuesta es
  // un formulario distinto, así que va aparte.
  const clave = (form) => {
    const responder = (form.getAttribute('action') || '').match(/\/h\/(\d+)\/responder$/);
    return PREFIJO + (responder ? `respuesta:${responder[1]}` : 'nuevo');
  };

  // Solo lo que la persona escribe: ni botones (el de la vista previa se llama "vista") ni campos
  // escondidos, que si no el formulario nunca cuenta como vacío y el borrador viejo no se borra.
  const campos = (form) =>
    [...form.elements].filter((c) => c.name && /^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName) && c.type !== 'hidden');

  const leer = (form) => {
    try {
      const crudo = sessionStorage.getItem(clave(form));
      if (!crudo) return null;
      const guardado = JSON.parse(crudo);
      if (!guardado || typeof guardado.t !== 'number' || Date.now() - guardado.t > VALIDEZ) {
        sessionStorage.removeItem(clave(form));
        return null;
      }
      return guardado.d;
    } catch {
      return null;
    }
  };

  const escribir = (form) => {
    const datos = {};
    for (const campo of campos(form)) {
      datos[campo.name] = campo.type === 'checkbox' ? (campo.checked ? '1' : '') : campo.value;
    }
    try {
      if (Object.values(datos).every((v) => v === '')) sessionStorage.removeItem(clave(form));
      else sessionStorage.setItem(clave(form), JSON.stringify({ t: Date.now(), d: datos }));
    } catch {
      // Sin sessionStorage (privado, cuota llena, cookies de terceros bloqueadas): sigue todo igual.
    }
  };

  const borrar = (form) => {
    try {
      sessionStorage.removeItem(clave(form));
    } catch {
      // ver escribir()
    }
  };

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.classList.contains('form-post')) return;
    // La vista previa vuelve a dibujar el formulario con el texto: el borrador no se toca.
    if (e.submitter && e.submitter.name === 'vista') return;
    if (form.dataset.enviado) {
      e.preventDefault();
      escribir(form); // el envío anterior no llegó a salir: el borrador se queda.
      return;
    }
    // Al publicar el borrador sobra: si la moderación lo rechaza, el servidor devuelve los campos.
    borrar(form);
    form.dataset.enviado = '1';
    const boton = e.submitter || form.querySelector('button');
    if (boton) {
      boton.dataset.texto = boton.textContent;
      boton.textContent = 'Revisando…';
      // Se desactiva después de este turno, así el envío ya salió.
      setTimeout(() => (boton.disabled = true));
    }
  });

  window.addEventListener('pageshow', (e) => {
    for (const form of document.querySelectorAll('form.form-post[data-enviado]')) {
      delete form.dataset.enviado;
      // Volver atrás después de publicar traía la página guardada con el texto todavía escrito, y
      // sincronizar() lo volvía a guardar como borrador. Si la página vuelve de la caché, el envío
      // ya salió: el formulario se vacía (si el filtro lo rechazó, el texto está en la página siguiente).
      if (e.persisted) {
        for (const campo of campos(form)) {
          if (campo.type === 'checkbox') campo.checked = false;
          else if (campo.tagName !== 'SELECT') campo.value = '';
        }
        borrar(form);
      }
      for (const boton of form.querySelectorAll('button')) {
        boton.disabled = false;
        if (boton.dataset.texto) boton.textContent = boton.dataset.texto;
      }
    }
  });

  const formato = new Intl.NumberFormat('es-AR');
  const contadores = new Map();
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
    // En la fila de los botones, a la derecha (los botones van pegados al cuadro de texto).
    const fila = campo.form?.querySelector('.botones');
    if (fila) fila.append(contador);
    else campo.after(contador);
    campo.addEventListener('input', actualizar);
    actualizar();
    contadores.set(campo, actualizar);
  }

  // Pone el borrador en los campos que el servidor dejó vacíos. Lo que ya venga dibujado (una
  // vista previa, un error de moderación, el >>N de ?cita=) gana: es lo que la persona está
  // viendo, no se le pisa.
  const recuperar = (form) => {
    const datos = leer(form);
    if (!datos) return;
    let restauro = false;
    for (const campo of campos(form)) {
      const valor = datos[campo.name];
      if (typeof valor !== 'string') continue;
      if (campo.type === 'checkbox') campo.checked = valor === '1';
      else if (!campo.value) {
        campo.value = valor;
        if (valor) restauro = true;
      } else if (campo.dataset.cita && valor) {
        // El servidor escribió >>N por ?cita=N: se agrega a lo que ya estaba escrito, salvo que el
        // borrador ya lo tenga (por ejemplo, al recargar la misma dirección).
        const cita = `>>${campo.dataset.cita}`;
        campo.value = new RegExp(`${cita}(?!\\d)`).test(valor) ? valor : `${valor.replace(/\s+$/, '')}\n${cita}\n`;
        restauro = true;
      }
    }
    if (!restauro) return;
    // El formulario de hilo es un <details> cerrado por defecto: sin abrirlo, el texto recuperado
    // queda escondido y parece que se perdió igual.
    const caja = form.closest('details');
    if (caja) caja.open = true;
    for (const [campo, actualizar] of contadores) if (campo.form === form) actualizar();
  };

  const sincronizar = () => {
    for (const form of document.querySelectorAll('form.form-post')) {
      recuperar(form);
      // Después de recuperar: si el formulario quedó vacío (se publicó), el borrador viejo se borra.
      escribir(form);
    }
  };

  // Se guarda al escribir, no al salir: cambiar el tema o recargar es una navegación y puede pasar
  // en cualquier momento. "input" alcanza para texto y checkbox; "change" cubre el <select> viejo.
  const alTocar = (e) => {
    const form = e.target.form;
    if (form && form.classList.contains('form-post')) escribir(form);
  };
  document.addEventListener('input', alTocar);
  document.addEventListener('change', alTocar);

  // "Responder" en un mensaje: sin recargar, >>N va donde está el cursor (si está al principio, como
  // cuando nunca se tocó el campo, al final) en una línea propia. Recargar con ?cita=N perdía el lugar en la página y pisaba lo
  // que se venía escribiendo. Abrir en otra pestaña (cmd/ctrl/medio) sigue siendo un link común.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a.citar');
    const n = link && new URL(link.href).searchParams.get('cita');
    const campo = document.querySelector('form#responder textarea[name="cuerpo"]');
    if (!n || !campo) return;
    e.preventDefault();
    const i = campo.selectionEnd || campo.value.length;
    const salto = i > 0 && campo.value[i - 1] !== '\n' ? '\n' : '';
    campo.setRangeText(`${salto}>>${n}\n`, i, i, 'end');
    // Al centro: abajo, en el celular, la barra fija taparía el campo.
    campo.scrollIntoView({ block: 'center' });
    campo.focus({ preventScroll: true });
    // Con texto largo, el campo mostraría el principio y la cita nueva quedaría escondida abajo.
    if (campo.selectionEnd === campo.value.length) campo.scrollTop = campo.scrollHeight;
    campo.dispatchEvent(new Event('input', { bubbles: true })); // contador y borrador
  });

  // Ctrl+Enter (Cmd+Enter en Mac) publica desde el mensaje, como tocar "Publicar".
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.target.tagName !== 'TEXTAREA') return;
    const form = e.target.form;
    if (!form || !form.classList.contains('form-post')) return;
    e.preventDefault();
    const publicar = form.querySelector('.botones button:not([name])');
    if (publicar && !publicar.disabled) form.requestSubmit(publicar);
  });

  // "Cancelar": vacía el formulario y borra el borrador (si no, lo escrito seguía apareciendo en cada
  // página). Sin JavaScript es un link a la página sin el formulario abierto.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a.cancelar');
    const form = link?.closest('form.form-post');
    if (!form || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    for (const campo of campos(form)) {
      if (campo.type === 'checkbox') campo.checked = false;
      else campo.value = '';
    }
    for (const nodo of form.querySelectorAll('.error, .vista-previa')) nodo.remove();
    borrar(form);
    for (const [campo, actualizar] of contadores) if (campo.form === form) actualizar();
    const caja = form.closest('details');
    if (caja) caja.open = false;
  });

  sincronizar(); // el guion va con defer: el DOM ya está
  window.addEventListener('pageshow', sincronizar);
})();
