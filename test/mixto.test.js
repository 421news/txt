import test from 'node:test';
import assert from 'node:assert/strict';
import { crearFiltroMixto, limpioParaJev } from '../src/sombra.js';
import { NORMAS } from '../src/normas.js';

const respuestas = (valores = {}, grave = 'ninguna') => ({
  grave: { choice: grave, probabilities: { [grave]: 0.9 } },
  ...Object.fromEntries(NORMAS.map((n) => [n.id, { type: 'noul', noul: valores[n.id] ?? 0.02 }])),
});
const claudeDice = (decision) => async () => ({ decision, rule: 'ninguna', reason: '', grave: 'ninguna', model: 'claude' });

test('limpioParaJev: todo bajo el umbral y sin grave; cualquier norma alta, un grave o datos incompletos van a Claude', () => {
  assert.equal(limpioParaJev(respuestas()), true);
  assert.equal(limpioParaJev(respuestas({ sexual: 0.25 })), false);
  assert.equal(limpioParaJev(respuestas({}, 'menores')), false);
  assert.equal(limpioParaJev({ grave: { choice: 'ninguna' } }), false);
  assert.equal(limpioParaJev(null), false);
});

test('filtro mixto: lo limpio lo aprueba Jev solo; lo dudoso y las fallas los decide Claude', async () => {
  let llamadas = 0;
  const claude = async (d) => (llamadas++, claudeDice('reject')(d));
  const limpio = crearFiltroMixto({ jev: async () => ({ respuestas: respuestas(), tokens: 900, ms: 80 }), claude });
  const v1 = await limpio({ cuerpo: 'hola' });
  assert.equal(v1.decision, 'approve');
  assert.equal(v1.filtro, 'jev');
  assert.equal(llamadas, 0);

  const dudoso = crearFiltroMixto({ jev: async () => ({ respuestas: respuestas({ odio: 0.7 }), tokens: 900, ms: 80 }), claude });
  const v2 = await dudoso({ cuerpo: 'x' });
  assert.equal(v2.decision, 'reject');
  assert.equal(v2.filtro, 'claude');
  assert.equal(llamadas, 1);

  const caido = crearFiltroMixto({ jev: async () => { throw new Error('TypeSafe 500'); }, claude });
  const v3 = await caido({ cuerpo: 'x' });
  assert.equal(v3.decision, 'reject');
  assert.match(v3.jev.error, /500/);
  assert.equal(llamadas, 2);
});
