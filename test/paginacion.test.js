import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portada, tablon, buscar } from '../src/views.js';
import { BOARDS } from '../src/config.js';

const navegacion = (pagina) => String(pagina).match(/<nav class="paginas"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
const numeros = (nav) => [...nav.matchAll(/aria-label="Página (\d+)"/g)].map((m) => Number(m[1]));
const destinos = (nav, base = 'http://prueba/') =>
  [...nav.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1].replaceAll('&amp;', '&'), base));
const listado = (pagina, paginas, vista = 'catalogo') => portada({}, { hilos: [], vista, pagina, paginas });

test('sin páginas adicionales no hay navegación; con pocas se muestran todos los números', () => {
  assert.equal(navegacion(listado(1, 1)), '');
  const nav = navegacion(listado(4, 7));
  assert.deepEqual(numeros(nav), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(!nav.includes('…'));
  assert.match(nav, /aria-current="page" aria-label="Página 4"/);
});

test('la paginación larga conserva extremos y vecinas al principio, en el medio y al final', () => {
  for (const [actual, esperados] of [
    [1, [1, 2, 3, 4, 501]],
    [4, [1, 2, 3, 4, 5, 501]],
    [250, [1, 249, 250, 251, 501]],
    [498, [1, 497, 498, 499, 500, 501]],
    [501, [1, 498, 499, 500, 501]],
  ]) {
    const nav = navegacion(listado(actual, 501));
    assert.deepEqual(numeros(nav), esperados, `página ${actual}`);
    assert.equal(nav.includes('rel="prev"'), actual > 1);
    assert.equal(nav.includes('rel="next"'), actual < 501);
    assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
    const urls = destinos(nav);
    assert.ok(urls.every((url) => {
      const n = Number(url.searchParams.get('pagina'));
      return n >= 1 && n <= 501 && n !== actual;
    }));
    if (actual > 1) assert.equal(urls[0].searchParams.get('pagina'), String(actual - 1));
    if (actual < 501) assert.equal(urls.at(-1).searchParams.get('pagina'), String(actual + 1));
  }
});

test('incluso con un millón de páginas la navegación sigue siendo corta', () => {
  const nav = navegacion(listado(500_000, 1_000_000));
  assert.deepEqual(numeros(nav), [1, 499_999, 500_000, 500_001, 1_000_000]);
  assert.ok(destinos(nav).length <= 8);
});

test('los separadores aparecen solo donde se omiten varias páginas, incluido el límite de siete', () => {
  for (const [total, actual, esperado] of [
    [7, 1, '1 2 3 4 5 6 7 Siguiente →'],
    [7, 7, '← Anterior 1 2 3 4 5 6 7'],
    [8, 1, '1 2 3 4 … 8 Siguiente →'],
    [8, 4, '← Anterior 1 2 3 4 5 … 8 Siguiente →'],
    [8, 5, '← Anterior 1 … 4 5 6 7 8 Siguiente →'],
    [8, 8, '← Anterior 1 … 5 6 7 8'],
    [501, 250, '← Anterior 1 … 249 250 251 … 501 Siguiente →'],
  ]) {
    const texto = navegacion(listado(actual, total)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.equal(texto, esperado, `página ${actual} de ${total}`);
  }
});

test('la navegación tiene nombre accesible y la página actual está marcada sin enlace', () => {
  const pagina = String(listado(250, 501));
  assert.match(pagina, /<nav class="paginas" aria-label="Paginación">/);
  const nav = navegacion(pagina);
  assert.match(nav, /<strong aria-current="page" aria-label="Página 250">250<\/strong>/);
  assert.ok(!destinos(nav).some((url) => url.searchParams.get('pagina') === '250'));
});

test('en todas las páginas de distintos tamaños los números son únicos y los enlaces apuntan al número mostrado', () => {
  for (const total of [2, 3, 6, 7, 8, 9, 10, 20, 50, 501]) {
    for (let actual = 1; actual <= total; actual++) {
      const nav = navegacion(listado(actual, total));
      const visibles = numeros(nav);
      const caso = `página ${actual} de ${total}`;
      assert.equal(visibles[0], 1, caso);
      assert.equal(visibles.at(-1), total, caso);
      assert.equal(visibles.filter((n) => n === actual).length, 1, caso);
      assert.ok(visibles.length <= 7, caso);
      assert.deepEqual(visibles, [...new Set(visibles)].sort((a, b) => a - b), caso);
      assert.ok(visibles.every((n) => n >= 1 && n <= total), caso);
      for (const enlace of nav.matchAll(/<a href="([^"]+)" aria-label="Página (\d+)">(\d+)<\/a>/g)) {
        const url = new URL(enlace[1].replaceAll('&amp;', '&'), 'http://prueba/');
        assert.equal(url.searchParams.get('pagina'), enlace[2], caso);
        assert.equal(enlace[2], enlace[3], caso);
      }
    }
  }
});

test('todos los enlaces conservan la vista lista y la ruta del tablón o archivo', () => {
  for (const archivo of [false, true]) {
    const ruta = `/b/cultura${archivo ? '/archivo' : ''}`;
    const nav = navegacion(tablon({}, {
      board: BOARDS[0], hilos: [], vista: 'lista', pagina: 250, paginas: 501, archivo,
    }));
    for (const url of destinos(nav, `http://prueba${ruta}`)) {
      assert.equal(url.pathname, ruta);
      assert.equal(url.searchParams.get('vista'), 'lista');
    }
  }
  for (const url of destinos(navegacion(listado(250, 501, 'lista')))) {
    assert.equal(url.searchParams.get('vista'), 'lista');
  }
});

test('el buscador conserva palabras, tildes y caracteres especiales en todos los enlaces', () => {
  const texto = 'música & "cine" + <libros>';
  const resultados = [{
    thread_id: 1, id: 1, subject: 'Prueba', board: 'cultura', created_at: 1_800_000_000_000,
  }];
  resultados.total = 10_020;
  const pagina = String(buscar({}, { texto, resultados, pagina: 250, paginas: 501 }));
  const nav = navegacion(pagina);
  assert.deepEqual(numeros(nav), [1, 249, 250, 251, 501]);
  for (const url of destinos(nav, 'http://prueba/buscar')) {
    assert.equal(url.pathname, '/buscar');
    assert.equal(url.searchParams.get('q'), texto);
    assert.equal(url.searchParams.size, 2);
  }
  assert.ok(!pagina.includes('<libros>'));
  assert.ok(pagina.includes('&lt;libros&gt;'));
});
