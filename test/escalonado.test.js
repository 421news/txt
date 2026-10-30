import test from 'node:test';
import assert from 'node:assert/strict';
import { crearModeradorEscalonado } from '../src/moderation.js';

const dice = (decision, model) => async () => ({ decision, rule: decision === 'approve' ? 'ninguna' : 'sexual', reason: '', grave: 'ninguna', model });

test('escalonado: lo que Haiku aprueba sale sin Sonnet; lo demás lo decide Sonnet', async () => {
  let firmes = 0;
  const contar = (f) => async (d) => (firmes++, f(d));
  const aprueba = crearModeradorEscalonado({ rapido: dice('approve', 'haiku'), firme: contar(dice('reject', 'sonnet')), muestra: 0 });
  const v1 = await aprueba({ cuerpo: 'hola' });
  assert.equal(v1.model, 'haiku');
  assert.equal(firmes, 0);

  for (const d of ['reject', 'queue']) {
    const m = crearModeradorEscalonado({ rapido: dice(d, 'haiku'), firme: contar(dice('approve', 'sonnet')), muestra: 0 });
    const v = await m({ cuerpo: 'x' });
    assert.equal(v.decision, 'approve'); // Sonnet tiene la última palabra
    assert.equal(v.model, 'sonnet');
    assert.equal(v.escalado.decision, d);
  }
  assert.equal(firmes, 2);
});

test('escalonado: una muestra de lo aprobado la audita Sonnet sin demorar la respuesta', async () => {
  const auditados = [];
  let listo;
  const hecho = new Promise((r) => (listo = r));
  const m = crearModeradorEscalonado({
    rapido: dice('approve', 'haiku'),
    firme: dice('reject', 'sonnet'),
    muestra: 0.5,
    azar: () => 0.1,
    alAuditar: (d, v1, v2) => { auditados.push([d.cuerpo, v1.decision, v2.decision]); listo(); },
  });
  const v = await m({ cuerpo: 'algo' });
  assert.equal(v.decision, 'approve');
  await hecho;
  assert.deepEqual(auditados, [['algo', 'approve', 'reject']]);
});
