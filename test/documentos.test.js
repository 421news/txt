import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aGemtext, aTexto, docPortada, docTablon } from '../src/documentos.js';
import { boardBySlug } from '../src/config.js';

for (const listado of ['portada', 'sección', 'archivo']) {
  test(`Gemini: acciones secundarias y separación en ${listado}`, () => {
    const opciones = { baseUrl: 'https://prueba' };
    const hilos = [
      { id: 1, board: 'cultura', subject: 'Ajena', reply_count: 0, bumped_at: 0, op_body: 'extracto ajeno', op_post_id: 10, op_user_id: 2, guardado: true },
      { id: 2, board: 'cultura', subject: 'Propia', reply_count: 0, bumped_at: 0, op_body: 'extracto propio', op_post_id: 20, op_user_id: 1, guardado: false },
    ];
    const documento = (userId) => {
      const datos = { siteName: 'prueba', hilos, pagina: 1, paginas: 1, userId };
      return listado === 'portada' ? docPortada(datos)
        : docTablon({ ...datos, board: boardBySlug('cultura'), archivo: listado === 'archivo' });
    };

    // La misma separación sirve para publicaciones normales e ignoradas (sin extracto).
    for (const ignorado of [false, true]) {
      hilos[0].ignorado = ignorado;
      const bloques = documento(1);
      const gemtext = aGemtext(bloques, opciones);
      assert.match(gemtext, /^=> \/h\/1\/guardar\/quitar ↳ Sacar de guardados$/m);
      assert.match(gemtext, /^=> \/p\/10\/ignorar ↳ Ignorar \/ dejar de ignorar\n\n=> \/h\/2 /m);
      assert.match(gemtext, /^=> \/h\/2\/guardar ↳ Guardar$/m);
      assert.ok(!gemtext.includes('/p/20/ignorar'), 'no ofrece ignorar la propia publicación');
      assert.equal(gemtext.includes('extracto ajeno'), !ignorado);
      assert.equal(gemtext.includes('[Ignorada]'), ignorado);
      if (ignorado) assert.ok(gemtext.includes('1 publicación ignorada.'));

      const texto = aTexto(bloques, opciones);
      assert.doesNotMatch(texto, /↳|\/guardar|\/ignorar/);
      assert.equal(texto.includes('extracto ajeno'), !ignorado);
      assert.equal(texto.split('·'.repeat(78)).length - 1, 1, 'solo el separador original del encabezado');
      assert.equal(texto, aTexto(documento(), opciones), 'las acciones de la cuenta no alteran el texto plano');

      const anonimo = aGemtext(documento(), opciones);
      assert.doesNotMatch(anonimo, /↳|\/guardar|\/ignorar/);
      assert.match(anonimo, ignorado ? /respuestas\)\n\n=> \/h\/2 / : /extracto ajeno\n\n=> \/h\/2 /);
    }
  });
}
