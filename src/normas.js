// Fuente única de las normas: las usa la página /normas, el filtro de Claude y el menú de reportes.
// El texto es corto a propósito (pedido del usuario, 2026-09-25): los matices van en los criterios
// del prompt (moderation.js). Los id no se cambian: quedan guardados en posts, rechazos y reportes.
export const NORMAS = [
  { id: 'respeto', titulo: 'Sin acoso', texto: 'Se puede discutir fuerte. Ensañarse con alguien o desearle que lo violen o lo golpeen, no.' },
  { id: 'odio', titulo: 'Sin odio', texto: 'Nada que desprecie a personas por su origen, religión, género, orientación o discapacidad.' },
  { id: 'sexual', titulo: 'Sin contenido sexual', texto: 'Nada explícito. Sexualizar a menores es suspensión inmediata.' },
  { id: 'violencia', titulo: 'Sin amenazas', texto: 'Nada de amenazar ni incitar a lastimar a alguien concreto.' },
  { id: 'privacidad', titulo: 'Sin datos personales', texto: 'Nada de datos de personas privadas: nombres reales, direcciones, teléfonos, chats.' },
  { id: 'autolesion', titulo: 'Cuidado con la autolesión', texto: 'Hablar de salud mental está bien. Alentar la autolesión, no.' },
  { id: 'ilegal', titulo: 'Nada ilegal', texto: 'Nada que facilite delitos: vender drogas o armas, estafas, meterse en cuentas ajenas.' },
  { id: 'spam', titulo: 'Sin spam', texto: 'Ni publicidad, ni referidos, ni apuestas.' },
];

// Normas internas (2026-10-09, decisión del usuario: "un foro Safe for Work en todos los aspectos", sin
// anunciarlo). Las aplican el filtro de Claude y el de Jev, y sus id quedan en /mod, pero NO salen en
// /normas, en la versión texto ni en el menú de reportes. El autor de un rechazo no ve qué norma fue.
export const NORMAS_INTERNAS = [
  { id: 'lenguaje', titulo: 'Sin puteadas', texto: 'Nada de puteadas, malas palabras ni insultos, aunque no apunten a nadie.' },
  { id: 'streaming', titulo: 'Sin canales de streaming argentinos', texto: 'Nada sobre los canales de streaming argentinos (Blender, Olga, Luzu y parecidos), su gente ni sus peleas.' },
];

// Las que usan los filtros: las públicas y las internas.
export const NORMAS_FILTRO = [...NORMAS, ...NORMAS_INTERNAS];
