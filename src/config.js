export const BOARDS = [
  { slug: 'tecnologia', nombre: 'Tecnología', descripcion: 'Software, hardware, internet y ciencia.' },
  { slug: 'cultura', nombre: 'Cultura', descripcion: 'Libros, cine, arte, historia e ideas.' },
  { slug: 'musica', nombre: 'Música', descripcion: 'Discos, bandas, recitales, escenas y lo que estás escuchando.' },
  { slug: 'juegos', nombre: 'Juegos', descripcion: 'Videojuegos, juegos de mesa, rol y cartas.' },
  { slug: 'vida-real', nombre: 'Vida real', descripcion: 'Todo lo que NO sucede a través de una pantalla.' },
];

export const boardBySlug = (slug) => BOARDS.find((b) => b.slug === slug);

export const LIMITS = {
  asunto: 120,
  cuerpo: 4000,
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
};
