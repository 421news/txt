// Fuente única de las normas: las usa la página /normas, el filtro de Claude y el menú de reportes.
// El texto es corto a propósito (pedido del usuario, 2026-09-25): los matices van en los criterios
// del prompt (moderation.js). Los id no se cambian: quedan guardados en posts, rechazos y reportes.
export const NORMAS = [
  { id: 'respeto', titulo: 'Sin acoso', texto: 'Se puede putear y discutir fuerte. Ensañarse con alguien, no.' },
  { id: 'odio', titulo: 'Sin odio', texto: 'Nada que desprecie a personas por su origen, religión, género, orientación o discapacidad.' },
  { id: 'sexual', titulo: 'Sin contenido sexual', texto: 'Nada explícito. Sexualizar a menores es suspensión inmediata.' },
  { id: 'violencia', titulo: 'Sin amenazas', texto: 'Nada de amenazar ni incitar a lastimar a alguien concreto.' },
  { id: 'privacidad', titulo: 'Sin datos personales', texto: 'Nada de datos de personas privadas: nombres reales, direcciones, teléfonos, chats.' },
  { id: 'autolesion', titulo: 'Cuidado con la autolesión', texto: 'Hablar de salud mental está bien. Alentar la autolesión, no.' },
  { id: 'ilegal', titulo: 'Nada ilegal', texto: 'Nada que facilite delitos: vender drogas o armas, estafas, meterse en cuentas ajenas.' },
  { id: 'spam', titulo: 'Sin spam', texto: 'Ni publicidad, ni referidos, ni apuestas.' },
];
