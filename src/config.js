// Secciones (2026-10-24, pedido del usuario: estilo 4chan). Cuatro madre y las que cuelgan de cada una
// (`grupo` = slug de la madre), más txt aparte. `codigo` es lo que se ve en la barra de escritorio. El orden
// de la lista es el de la barra, el índice (/secciones) y los menús. Las publicaciones viejas no se movieron.
export const BOARDS = [
  { slug: 'tecnologia', nombre: 'Tecnología', codigo: 'tec', grupo: 'tecnologia', descripcion: 'Software, hardware, internet y ciencia.' },
  { slug: 'cultura', nombre: 'Cultura', codigo: 'cul', grupo: 'cultura', descripcion: 'Ideas, arte, historia y filosofía.' },
  { slug: 'musica', nombre: 'Música', codigo: 'mús', grupo: 'cultura', descripcion: 'Discos, bandas, recitales, escenas y lo que estás escuchando.' },
  { slug: 'libros', nombre: 'Libros', codigo: 'lib', grupo: 'cultura', descripcion: 'Lo que estás leyendo, novela, poesía y ensayo.' },
  { slug: 'pantallas', nombre: 'Pantallas', codigo: 'pan', grupo: 'cultura', descripcion: 'Cine, series, anime, YouTube y streaming.' },
  { slug: 'juegos', nombre: 'Juegos', codigo: 'jue', grupo: 'juegos', descripcion: 'Videojuegos, juegos de mesa, rol y cartas.' },
  { slug: 'deportes', nombre: 'Deportes', codigo: 'dep', grupo: 'juegos', descripcion: 'Fútbol, la Selección, F1 y todos los demás.' },
  { slug: 'vida-real', nombre: 'Vida real', codigo: 'vid', grupo: 'vida-real', descripcion: 'Todo lo que NO sucede a través de una pantalla.' },
  // "act" y no "pol": en 4chan /pol/ es el tablón político famoso por la ultraderecha.
  { slug: 'actualidad', nombre: 'Actualidad', codigo: 'act', grupo: 'vida-real', descripcion: 'Política, noticias y el país.' },
  { slug: 'laburo', nombre: 'Laburo y estudio', codigo: 'lab', grupo: 'vida-real', descripcion: 'Trabajo, facultad, plata y carrera.' },
  { slug: 'relaciones', nombre: 'Relaciones', codigo: 'rel', grupo: 'vida-real', descripcion: 'Pareja, citas, amistad y familia.' },
  { slug: 'txt', nombre: 'txt', codigo: 'txt', grupo: 'txt', descripcion: 'El foro: sugerencias, novedades y críticas.' },
];

// Las secciones agrupadas por su madre, en el orden de BOARDS.
export const GRUPOS = BOARDS.filter((b) => b.grupo === b.slug).map((madre) => ({ madre, hijas: BOARDS.filter((b) => b.grupo === madre.slug && b !== madre) }));

export const boardBySlug = (slug) => BOARDS.find((b) => b.slug === slug);

export const LIMITS = {
  asunto: 120,
  cuerpo: 8000,
  hilosPorPagina: 10,
  // El catálogo (vista por defecto) muestra fichas chicas: entran muchas más por página.
  hilosPorPaginaCatalogo: 60,
  // Últimas respuestas que se muestran debajo de cada hilo en la portada y en los tablones.
  respuestasEnResumen: 3,
  // Pasado este número, los hilos menos activos de un tablón van al archivo.
  hilosActivosPorTablon: 150,
  // Después de estas respuestas el hilo deja de subir.
  limiteBump: 300,
  // Y después de estas se cierra.
  limiteRespuestas: 500,
  segEntrePosts: 30,
  segEntreHilos: 600,
  rechazosPorHora: 10,
  // Reportes de personas distintas que sacan un post de la vista hasta que lo revise un mod.
  reportesParaOcultar: 3,
  // Más comentadas: cuántas en el bloque de la portada y en /top (sin páginas).
  topEnPortada: 10,
  topPorPagina: 25,
};
