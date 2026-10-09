// Prueba "en sombra" de Jev (TypeSafe) como filtro alternativo (desde 2026-09-25).
//
// Jev NO decide nada: después de que Claude decide, se le manda el mismo mensaje en paralelo y se
// guarda lo que habría dicho, para comparar con datos reales antes de usarlo. Si falla, no pasa nada.
// Se activa solo con TYPESAFE_API_KEY. Las preguntas van en inglés (su idioma más fuerte según su
// documentación) con los mismos matices que el prompt de Claude; el mensaje va tal cual.

import { NORMAS_FILTRO } from './normas.js';

const URL_API = 'https://api.typesafe.ai/v1/systemone';
export const MODELO_JEV = 'jev-latest';
export const PRECIO_JEV_POR_MTOK = 0.042; // USD por millón de tokens de entrada; la salida no se cobra

// Una pregunta por norma. `criteria.false` lleva lo que está permitido a propósito en txt.
const PREGUNTAS_NORMAS = {
  respeto: {
    instructions: 'Does the `message` harass a specific person: stalking them across posts, telling them to kill themselves, urging others to attack them, wishing them rape, sexual abuse or beatings, or degrading them sexually or for being a woman, e.g. calling a female user a whore (even in a single message, even with misspelled words like "6orda uta")?',
    criteria: { true: 'Targeted harassment, misogynistic abuse, or wishing sexual or physical violence on a specific person', false: 'No harassment. (Swearing is judged by a separate question.)' },
  },
  odio: {
    instructions: 'Does the `message` demean or dehumanize people for their origin, ethnicity, religion, gender, sexual orientation or disability, or generalize about women as a group, attributing a behavior to all women ("women are all gold diggers", "typical of women", "because women always..."), even as a joke or an "observation"?',
    criteria: { true: 'Hate against a protected group, or a generalization about women', false: 'No hate and no generalization about women. Criticizing ideas, politicians or public figures, or discussing gender inequality seriously, is allowed.' },
  },
  sexual: {
    instructions: 'Does the `message` contain anything sexual: explicit content, sexual jokes, innuendo or double meanings, talk about one\'s own or others\' sex life ("I\'m a virgin", "I never get laid"), or coded or misspelled words for sex or genitals (e.g. "bonchita")? Or any sexualization of minors? This is a strictly safe-for-work forum.',
    criteria: { true: 'Sexual content, jokes, innuendo or sex-life talk, or sexualization of minors', false: 'Nothing sexual. Informative talk about news, court cases, health or sex education is allowed.' },
  },
  violencia: {
    instructions: 'Does the `message` threaten or incite harm against a concrete, identifiable person (another user, or someone named), or describe violence in graphic detail to enjoy it?',
    criteria: { true: 'A real threat against an identifiable person, or gratuitous graphic violence', false: 'No real threat. Hyperbole and angry figures of speech about generic groups ("heads should roll", "politicians\' heads on a pike") are allowed.' },
  },
  privacidad: {
    instructions: 'Does the `message` expose personal data of a private individual: real name together with accusations, home address, workplace, phone number or private chats?',
    criteria: { true: 'Exposes a private person\'s personal data', false: 'No private personal data. Naming and criticizing public figures is allowed.' },
  },
  autolesion: {
    instructions: 'Does the `message` encourage self-harm or suicide, or show that the author may be at risk of harming themselves?',
    criteria: { true: 'Encourages self-harm or the author seems at risk', false: 'No self-harm risk. Talking about mental health is allowed.' },
  },
  ilegal: {
    instructions: 'Does the `message` facilitate a crime that harms people: selling drugs or weapons, scams, or stealing or selling other people\'s accounts?',
    criteria: { true: 'Facilitates a harmful crime', false: 'No harmful crime. Piracy (torrents, download sites, how to download books, games or films) is allowed on this site.' },
  },
  lenguaje: {
    instructions: 'Does the `message` contain any swear word, profanity or insult, in Argentine Spanish or otherwise (e.g. "mierda", "puta", "concha", "carajo", "boludo", "pelotudo", "forro", "hdp", "lpm"), even if not aimed at anyone, or disguised with symbols or misspellings? The word "gordo"/"gorda" used as a nickname between users does not count.',
    criteria: { true: 'Contains swearing, profanity or an insult', false: 'Clean language. Harsh criticism without swear words, and "gordo" as a friendly nickname, are allowed.' },
  },
  streaming: {
    instructions: 'Is the `message` about the Argentine streaming channels and their shows (Blender, Olga, Luzu TV, Gelatina, Carajo, Bondi, Azz and similar), their hosts and panelists (e.g. Guillermo Aquino, Rebord), or the gossip and fights around them? Solo Twitch or Kick streamers who stream on their own (e.g. Davo Xeneize, Coscu, Spreen) do not count.',
    criteria: { true: 'About Argentine streaming channels, their people or their drama', false: 'Not about Argentine streaming channels (solo streamers are allowed)' },
  },
  spam: {
    instructions: 'Is the `message` advertising, referral links, gambling promotion or investment schemes?',
    criteria: { true: 'Spam or promotion', false: 'Not spam' },
  },
};

const PREGUNTA_GRAVE = {
  type: 'choice',
  instructions: 'Is the `message` itself one of these zero-tolerance cases? Telling about abuse one suffered, reporting it, or commenting on news is NOT one of them.',
  criteria: {
    ninguna: 'None of the zero-tolerance cases',
    menores: 'Any sexualization of minors',
    abuso: 'Describes sexual abuse in detail to enjoy, celebrate or promote it, or asks for such material',
    violencia_explicita: 'Gore, torture or violence described in graphic detail to revel in it',
  },
};

export function preguntas() {
  const q = { grave: PREGUNTA_GRAVE };
  for (const n of NORMAS_FILTRO) {
    const p = PREGUNTAS_NORMAS[n.id];
    if (p) q[n.id] = { type: 'noul', ...p };
  }
  return q;
}

// Lo que habría decidido Jev con umbrales simples (se pueden ajustar mirando los datos).
export const UMBRAL_RECHAZO = 0.6;
export const UMBRAL_DUDA = 0.35;
export function decisionJev(respuestas) {
  const grave = respuestas?.grave;
  if (grave && grave.choice !== 'ninguna' && (grave.probabilities?.[grave.choice] ?? 0) >= 0.5) {
    return { decision: 'reject', rule: 'grave', grave: grave.choice };
  }
  let peor = null;
  for (const n of NORMAS_FILTRO) {
    const v = respuestas?.[n.id]?.noul;
    if (typeof v === 'number' && (!peor || v > peor.v)) peor = { id: n.id, v };
  }
  if (!peor || peor.v < UMBRAL_DUDA) return { decision: 'approve', rule: 'ninguna', grave: 'ninguna' };
  // Autolesión nunca se rechaza: va a una persona, igual que con Claude.
  if (peor.id === 'autolesion') return { decision: 'queue', rule: 'autolesion', grave: 'ninguna' };
  return { decision: peor.v >= UMBRAL_RECHAZO ? 'reject' : 'queue', rule: peor.id, grave: 'ninguna' };
}

export function crearSombra({ apiKey, fetch: pedir = globalThis.fetch, timeoutMs = 8000 }) {
  return async function evaluar({ tablon, asunto, cuerpo, esHilo }) {
    const inicio = Date.now();
    const r = await pedir(URL_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELO_JEV,
        state: { site: 'txt, a text-only anonymous forum in Argentine Spanish', board: tablon, subject: asunto, is_new_thread: esHilo, message: cuerpo },
        questions: preguntas(),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`TypeSafe ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const datos = await r.json();
    return { modelo: datos.model, respuestas: datos.answers, tokens: datos.usage?.input_tokens ?? null, ms: Date.now() - inicio };
  };
}

// --- Filtro mixto (desde 2026-09-26, decisión del usuario) ------------------------------------
// Jev mira cada mensaje primero. Si lo ve claramente limpio (ninguna norma llega a UMBRAL_LIMPIO y no
// marca ningún caso grave), se publica sin consultar a Claude. Todo lo demás, y cualquier falla de
// Jev, lo decide Claude como siempre: Jev nunca rechaza ni suspende por su cuenta.
// Medido con 1.420 mensajes reales (2026-09-26): con 0,2 se saltea a Claude en el 78% y ninguno de
// los que Claude rechazó hubiera pasado. Jev solo frenaba de más el humor sexual y las puteadas.
export const UMBRAL_LIMPIO = 0.2;

export function limpioParaJev(respuestas, umbral = UMBRAL_LIMPIO) {
  if (respuestas?.grave?.choice !== 'ninguna') return false;
  const valores = NORMAS_FILTRO.map((n) => respuestas?.[n.id]?.noul);
  if (valores.some((v) => typeof v !== 'number')) return false;
  return Math.max(...valores) < umbral;
}

export function crearFiltroMixto({ jev, claude, umbral = UMBRAL_LIMPIO }) {
  return async function moderar(datos) {
    let r;
    try {
      r = await jev(datos);
    } catch (err) {
      const v = await claude(datos);
      return { ...v, jev: { error: String(err?.message ?? err).slice(0, 300) } };
    }
    if (limpioParaJev(r.respuestas, umbral)) {
      return {
        decision: 'approve', rule: 'ninguna', reason: '', grave: 'ninguna', filtro: 'jev',
        model: r.modelo ?? MODELO_JEV, input_tokens: r.tokens, output_tokens: 0, cache_read_tokens: null, cache_write_tokens: null,
        jev: r,
      };
    }
    const v = await claude(datos);
    return { ...v, filtro: 'claude', jev: r };
  };
}
