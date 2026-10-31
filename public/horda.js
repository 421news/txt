'use strict';
// Horda: shooter de zombies cenital. Todo el estado caliente vive en arrays tipados (sin objetos por
// enemigo ni basura por frame), las colisiones van por grilla espacial y la persecución por un campo
// de flujo (BFS desde el jugador), así el costo crece lineal con la cantidad de enemigos.

const cv = document.getElementById('c');
const ctx = cv.getContext('2d', { alpha: false });
let W = 0, H = 0;
function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; ctx.imageSmoothingEnabled = false; }
addEventListener('resize', resize);
resize();

// ---------- Mapa (bosque) ----------
// 0 = pasto, 1 = árbol, 2 = roca. La lógica es 2D en casilleros; solo el dibujo es isométrico.
const T = 24, MW = 64, MH = 44, WW = MW * T, WH = MH * T;
const map = new Uint8Array(MW * MH);
const variant = new Uint8Array(MW * MH);   // qué árbol/roca va en cada casillero
const PASS = new Uint8Array([1, 0, 0, 1]); // para el campo de flujo: pasto y barricada se cruzan
const bhp = new Float32Array(MW * MH);     // vida de cada barricada
let seed = 421;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function buildMap() {
  map.fill(0); seed = 421;
  const inClearing = (x, y) => Math.abs(x - MW / 2) < 8 && Math.abs(y - MH / 2) < 6;
  const put = (x, y, v) => { if (x > 0 && y > 0 && x < MW - 1 && y < MH - 1 && !inClearing(x, y)) map[y * MW + x] = v; };
  // Borde de bosque cerrado, más ralo hacia adentro.
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const e = Math.min(x, y, MW - 1 - x, MH - 1 - y);
    if (e === 0 || (e <= 3 && rnd() < 0.8 - e * 0.2)) map[y * MW + x] = 1;
  }
  // Bosquecitos: caminatas al azar que plantan árboles.
  for (let i = 0; i < 34; i++) {
    let x = 4 + (rnd() * (MW - 8) | 0), y = 4 + (rnd() * (MH - 8) | 0);
    const n = 4 + (rnd() * 12 | 0);
    for (let k = 0; k < n; k++) { put(x, y, 1); x += (rnd() * 3 | 0) - 1; y += (rnd() * 3 | 0) - 1; }
  }
  for (let i = 0; i < 90; i++) put(3 + (rnd() * (MW - 6) | 0), 3 + (rnd() * (MH - 6) | 0), 1);
  for (let i = 0; i < 22; i++) put(3 + (rnd() * (MW - 6) | 0), 3 + (rnd() * (MH - 6) | 0), 2);
  for (let i = 0; i < MW * MH; i++) variant[i] = (rnd() * 3) | 0;
}

const solid = (x, y) => {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  return tx < 0 || ty < 0 || tx >= MW || ty >= MH || map[ty * MW + tx] !== 0;
};
// Paredes de verdad (árbol o roca): las balas atraviesan las barricadas propias.
const wallAt = (x, y) => {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  return tx < 0 || ty < 0 || tx >= MW || ty >= MH || map[ty * MW + tx] === 1 || map[ty * MW + tx] === 2;
};
const blocked = (x, y, r) => solid(x - r, y - r) || solid(x + r, y - r) || solid(x - r, y + r) || solid(x + r, y + r);

// Proyección isométrica 2:1. ISO_OX corre todo a la derecha para que no haya x negativas.
const ISO_OX = MH * T, GUN_Z = 15;   // altura del pecho del mago: de ahí salen los hechizos
const ZOOM = 1.25;   // cámara más cerca: el mundo se dibuja agrandado, el HUD no
const isoX = (x, y) => x - y + ISO_OX;
const isoY = (x, y) => (x + y) / 2;

// Piso pintado una sola vez; la sangre y las quemaduras se pintan encima y quedan.
const floor = document.createElement('canvas');
floor.width = (MW + MH) * T; floor.height = (MW + MH) * T / 2;
const fctx = floor.getContext('2d');
function diamond(g, tx, ty, color) {
  const x = tx * T, y = ty * T;
  g.fillStyle = color; g.beginPath();
  g.moveTo(isoX(x, y), isoY(x, y)); g.lineTo(isoX(x + T, y), isoY(x + T, y));
  g.lineTo(isoX(x + T, y + T), isoY(x + T, y + T)); g.lineTo(isoX(x, y + T), isoY(x, y + T));
  g.closePath(); g.fill();
}
function paintFloor() {
  fctx.fillStyle = '#10140d'; fctx.fillRect(0, 0, floor.width, floor.height);
  seed = 77;
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const i = ty * MW + tx;
    const dirt = Math.sin(tx * 0.35) + Math.cos(ty * 0.42 + tx * 0.1) > 1.2;
    const g = 52 + (rnd() * 10 | 0);
    let color = dirt ? `rgb(${88 + (rnd() * 8 | 0)},${70 + (rnd() * 6 | 0)},${46})` : `rgb(${g - 16},${g + 36},${g - 20})`;
    if (map[i]) color = '#2c3d22';
    diamond(fctx, tx, ty, color);
  }
  // Pasto alto, flores y hojas caídas (decoración plana, no tapa nada).
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * WW, y = rnd() * WH, px = isoX(x, y), py = isoY(x, y), r = rnd();
    if (r < 0.7) { fctx.strokeStyle = r < 0.35 ? '#5f8f3e' : '#4b7532'; fctx.lineWidth = 1; fctx.beginPath(); fctx.moveTo(px, py); fctx.lineTo(px - 1, py - 4); fctx.moveTo(px + 2, py); fctx.lineTo(px + 3, py - 3); fctx.stroke(); }
    else if (r < 0.8) { fctx.fillStyle = ['#e9d66b', '#f2f2f2', '#c96fbf'][(rnd() * 3) | 0]; fctx.fillRect(px, py - 1, 2, 2); }
    else { fctx.fillStyle = ['#8a5a2b', '#a8742f', '#6d4b26'][(rnd() * 3) | 0]; fctx.fillRect(px, py, 3, 1.5); }
  }
}
function stain(x, y, r, color, alpha) {
  fctx.globalAlpha = alpha; fctx.fillStyle = color;
  fctx.beginPath(); fctx.ellipse(isoX(x, y), isoY(x, y), r * 1.4, r * 0.7, 0, 0, 6.2832); fctx.fill();
  fctx.globalAlpha = 1;
}

// ---------- Campo de flujo ----------
const INF = 1e9;
const dist = new Int32Array(MW * MH), fdx = new Float32Array(MW * MH), fdy = new Float32Array(MW * MH);
const nxt = new Int32Array(MW * MH);   // casillero siguiente hacia el jugador (-1 si no hay)
const queue = new Int32Array(MW * MH);
let flowTile = -1;
function buildFlow(px, py) {
  const s = Math.floor(py / T) * MW + Math.floor(px / T);
  if (s === flowTile) return;
  flowTile = s;
  dist.fill(INF); dist[s] = 0;
  let h = 0, t = 0; queue[t++] = s;
  while (h < t) {
    const i = queue[h++], x = i % MW, y = (i / MW) | 0, d = dist[i] + 1;
    if (x > 0 && PASS[map[i - 1]] && dist[i - 1] > d) { dist[i - 1] = d; queue[t++] = i - 1; }
    if (x < MW - 1 && PASS[map[i + 1]] && dist[i + 1] > d) { dist[i + 1] = d; queue[t++] = i + 1; }
    if (y > 0 && PASS[map[i - MW]] && dist[i - MW] > d) { dist[i - MW] = d; queue[t++] = i - MW; }
    if (y < MH - 1 && PASS[map[i + MW]] && dist[i + MW] > d) { dist[i + MW] = d; queue[t++] = i + MW; }
  }
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    const i = y * MW + x;
    fdx[i] = 0; fdy[i] = 0; nxt[i] = -1;
    if (!PASS[map[i]] || dist[i] >= INF) continue;
    let best = dist[i], bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const j = i + oy * MW + ox;
      if (!PASS[map[j]]) continue;
      if (ox && oy && (!PASS[map[i + ox]] || !PASS[map[i + oy * MW]])) continue; // sin cortar esquinas
      if (dist[j] < best) { best = dist[j]; bx = ox; by = oy; }
    }
    const l = Math.hypot(bx, by) || 1;
    fdx[i] = bx / l; fdy[i] = by / l;
    nxt[i] = (bx || by) ? i + by * MW + bx : -1;
  }
}

// ---------- Enemigos ----------
const ME = 6000;
const ex = new Float32Array(ME), ey = new Float32Array(ME), ehp = new Float32Array(ME);
const ekx = new Float32Array(ME), eky = new Float32Array(ME);   // empuje (balas, explosiones)
const ecd = new Float32Array(ME), eat = new Float32Array(ME);   // recarga de disparo o embestida, y de mordida
const ech = new Float32Array(ME);                               // embestida en curso (segundos que le quedan)
const eslow = new Float32Array(ME);                             // congelado por la ventisca (segundos)
const efl = new Float32Array(ME);                               // destello al recibir daño
const ewu = new Float32Array(ME);                               // macho cabrío: preparando la embestida (segundos)
const edx = new Float32Array(ME), edy = new Float32Array(ME);   // dirección fija de la embestida
const et = new Uint8Array(ME);
let nE = 0;
const ETYPES = [
  { r: 8, spd: 52, hp: 3, dmg: 8, pts: 10 },   // caminante
  { r: 9, spd: 78, hp: 8, dmg: 12, pts: 35 },  // cuernudo: tira fuegos fatuos
  { r: 11, spd: 42, hp: 45, dmg: 25, pts: 250 }, // macho cabrío: lento, duro, embiste (r < T/2 para pasar entre árboles)
  { r: 11, hr: 24, spd: 34, hp: 300, dmg: 30, pts: 5000 }, // Rey del Bosque: jefe cada 10 oleadas
  { r: 7, spd: 105, hp: 2, dmg: 6, pts: 20, fly: true },     // diablillo alado: rápido, frágil, vuela sobre los árboles
  { r: 9, spd: 48, hp: 14, dmg: 14, pts: 80 },               // caballero óseo: tira hachas
];

function spawnEnemy(type, x, y) {
  if (nE >= ME) return;
  const i = nE++;
  ex[i] = x; ey[i] = y; et[i] = type;
  ehp[i] = ETYPES[type].hp * (1 + wave * 0.05);
  ekx[i] = eky[i] = 0; efl[i] = 0; eat[i] = 0;
  ecd[i] = 1 + Math.random() * 2; ech[i] = 0; eslow[i] = 0; ewu[i] = 0;
  if (type === 3) { bossMax = ehp[i]; ecd[i] = 3; ech[i] = 5; }
}

// Los muertos se marcan con hp <= 0 y se compactan al final del paso (la grilla guarda índices).
function compactEnemies() {
  let w = 0;
  for (let i = 0; i < nE; i++) {
    if (ehp[i] <= 0) continue;
    if (w !== i) {
      ex[w] = ex[i]; ey[w] = ey[i]; ehp[w] = ehp[i]; ekx[w] = ekx[i]; eky[w] = eky[i];
      ecd[w] = ecd[i]; eat[w] = eat[i]; efl[w] = efl[i]; et[w] = et[i]; ech[w] = ech[i]; eslow[w] = eslow[i];
      ewu[w] = ewu[i]; edx[w] = edx[i]; edy[w] = edy[i];
    }
    w++;
  }
  nE = w;
}

// ---------- Grilla espacial ----------
const GC = 32, GW = Math.ceil(WW / GC), GH = Math.ceil(WH / GC);
const cellStart = new Int32Array(GW * GH + 1), cellFill = new Int32Array(GW * GH);
const cellItems = new Int32Array(ME), ecell = new Int32Array(ME);
const cellOf = (x, y) => {
  let cx = (x / GC) | 0, cy = (y / GC) | 0;
  if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
  if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
  return cy * GW + cx;
};
function buildGrid() {
  cellStart.fill(0);
  for (let i = 0; i < nE; i++) { const c = cellOf(ex[i], ey[i]); ecell[i] = c; cellStart[c + 1]++; }
  for (let c = 0; c < GW * GH; c++) cellStart[c + 1] += cellStart[c];
  cellFill.set(cellStart.subarray(0, GW * GH));
  for (let i = 0; i < nE; i++) cellItems[cellFill[ecell[i]]++] = i;
}

// ---------- Proyectiles ----------
const MB = 3000;
const bx = new Float32Array(MB), by = new Float32Array(MB), bvx = new Float32Array(MB), bvy = new Float32Array(MB);
const bc = new Uint8Array(MB);
const bp = new Uint8Array(MB), bhl = new Int32Array(MB);   // enemigos que todavía puede atravesar, y el último que tocó
const bvox = new Float32Array(MB), bvoy = new Float32Array(MB);   // desfase de dibujo: arranca en la vara y se apaga   // color: 0 varita, 1 chispas, 2 ráfaga, 3 rayos, 4 tótem
const BCOLORS = ['#9fd8ff', '#ffb347', '#c08bff', '#fff27a', '#7dffd8'];
const bl = new Float32Array(MB), bd = new Float32Array(MB);
let nB = 0;
function addBullet(x, y, a, speed, dmg, life, color = 0, vox = 0, voy = 0, pierce = 0) {
  if (nB >= MB) return;
  const i = nB++;
  bx[i] = x; by[i] = y; bvx[i] = Math.cos(a) * speed; bvy[i] = Math.sin(a) * speed; bd[i] = dmg; bl[i] = life; bc[i] = color;
  bvox[i] = vox; bvoy[i] = voy; bp[i] = pierce; bhl[i] = -1;
}
function removeBullet(i) {
  const j = --nB;
  bx[i] = bx[j]; by[i] = by[j]; bvx[i] = bvx[j]; bvy[i] = bvy[j]; bl[i] = bl[j]; bd[i] = bd[j]; bc[i] = bc[j];
  bvox[i] = bvox[j]; bvoy[i] = bvoy[j]; bp[i] = bp[j]; bhl[i] = bhl[j];
}

const MF = 800;
const fx = new Float32Array(MF), fy = new Float32Array(MF), fvx = new Float32Array(MF), fvy = new Float32Array(MF), flife = new Float32Array(MF);
const fk = new Uint8Array(MF);   // 0 fuego fatuo (10 de daño), 1 hacha (15)
let nF = 0;
function addFireball(x, y, a, kind = 0, speed = 210) {
  if (nF >= MF) return;
  const i = nF++;
  fx[i] = x; fy[i] = y; fvx[i] = Math.cos(a) * speed; fvy[i] = Math.sin(a) * speed; flife[i] = 2.5; fk[i] = kind;
}
function removeFireball(i) {
  const j = --nF;
  fx[i] = fx[j]; fy[i] = fy[j]; fvx[i] = fvx[j]; fvy[i] = fvy[j]; flife[i] = flife[j]; fk[i] = fk[j];
}

// ---------- Jugador, armas y objetos ----------
const PR = 8;
const player = { x: 0, y: 0, hp: 100, mana: 100, castT: 0, aim: 0, cd: 0, weapon: 0, hurt: 0, moving: false, noMana: 0 };
const WEAPONS = [
  { id: 'varita',   name: 'Varita',        key: '1', rate: 0.26,  unlock: 0,   cost: 0, semi: true },   // un tiro por clic     // proyectil arcano
  { id: 'chispas',  name: 'Chispas',       key: '2', rate: 0.75,  unlock: 8,   cost: 3 },     // abanico de chispas, de cerca
  { id: 'runa',     name: 'Runa',          key: '3', rate: 0.45,  unlock: 15,  cost: 8 },     // mina: explota al pisarla o al dispararle
  { id: 'frascos',  name: 'Frascos',       key: '4', rate: 0.6,   unlock: 25,  cost: 6 },     // frascos de fuego en arco
  { id: 'muro',     name: 'Muro',          key: '5', rate: 0.35,  unlock: 35,  cost: 5 },     // muro de piedra
  { id: 'rayos',    name: 'Rayos',         key: '6', rate: 0.035, unlock: 50,  cost: 0.35 },  // tormenta de rayos
  { id: 'bola',     name: 'Bola de fuego', key: '7', rate: 0.8,   unlock: 65,  cost: 9 },
  { id: 'totem',    name: 'Tótem',         key: '8', rate: 1,     unlock: 80,  cost: 30 },    // tótem arcano que dispara solo
  { id: 'meteoros', name: 'Meteoros',      key: '9', rate: 1,     unlock: 100, cost: 40 },    // altar que llama meteoros
  { id: 'ventisca', name: 'Ventisca',      key: '0', rate: 2,     unlock: 120, cost: 60 },    // lluvia de hielo sobre una zona grande
];
const NW = WEAPONS.length;
// Maná: una sola reserva para todos los hechizos. Se recarga sola y con los cofres.
const MANA_MAX = 100, MANA_REGEN = 3, MANA_CHEST = 35;
const unlocked = [true, ...Array(NW - 1).fill(false)];
const level = Array(NW).fill(0);        // cada nivel: +25% daño y 10% más rápido
let lootT = 0;                          // lootT: segundos peleando sin que caiga una caja
// Experiencia estilo LoL: cada nivel da un punto para desbloquear un hechizo o subirle un rango.
let xp = 0, plevel = 1, points = 0;
const xpNeed = (L) => 12 * L;           // XP para pasar del nivel L al L+1
let barrels = [], crates = [], booms = [];
let boulders = [], quakes = [];         // piedras que tira el macho cabrío y el polvo donde caen
let throws = [], rockets = [], turrets = [], barricades = [], storms = [];   // granadas/morteros en vuelo, cohetes, torretas, barricadas

let state = 'menu', wave = 0, score = 0, kills = 0, combo = 1, comboT = 0;
const pending = [0, 0, 0, 0, 0, 0];   // por tipo: cuántos faltan salir en esta oleada
const pendingTotal = () => pending.reduce((a, b) => a + b, 0);
let bossMax = 1;                  // vida inicial del jefe vivo, para la barra
let spawnT = 0, spawnRate = 0.5, breakT = 0;
let banner = '', bannerT = 0, showStats = true, waveT = 0;
let spawnTiles = [];

function say(text, t = 2.5) { banner = text; bannerT = t; }

function reset() {
  buildMap(); paintFloor(); indexScenery();
  spawnTiles = [];
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    const edge = x <= 5 || y <= 5 || x >= MW - 6 || y >= MH - 6;
    if (edge && !map[y * MW + x]) spawnTiles.push(y * MW + x);
  }
  Object.assign(player, { x: WW / 2, y: WH / 2, hp: 100, cd: 0, weapon: 0, hurt: 0 });
  player.mana = MANA_MAX; player.noMana = 0;
  unlocked.fill(false); unlocked[0] = true;
  level.fill(0); lootT = 0; xp = 0; plevel = 1; points = 0; slots.splice(0, 5, 0, -1, -1, -1, -1);
  nE = nB = nF = 0; barrels = []; crates = []; booms = [];
  boulders = []; quakes = [];
  throws = []; rockets = []; turrets = []; barricades = []; storms = [];
  wave = 0; score = 0; kills = 0; combo = 1; comboT = 0; playTime = 0;
  pending.fill(0); breakT = 1.5; flowTile = -1;
  buildFlow(player.x, player.y);
}

// Cada hechizo tiene 5 mejoras en orden. Tipos: rate (más cadencia), multi (un proyectil más), pierce
// (atraviesa un enemigo más), auto (repetición: se dispara manteniendo apretado), radius (explosión 25% más grande), dmg (+30% daño), hp (+50% vida), shards (+10 esquirlas).
const PERKS = {
  varita:   ['auto', 'multi', 'pierce', 'rate', 'multi'],
  chispas:  ['multi', 'rate', 'pierce', 'multi', 'dmg'],
  runa:     ['radius', 'dmg', 'radius', 'dmg', 'radius'],
  frascos:  ['radius', 'dmg', 'multi', 'radius', 'dmg'],
  muro:     ['hp', 'hp', 'hp', 'hp', 'hp'],
  rayos:    ['rate', 'pierce', 'rate', 'pierce', 'dmg'],
  bola:     ['radius', 'dmg', 'multi', 'radius', 'dmg'],
  totem:    ['rate', 'multi', 'dmg', 'rate', 'hp'],
  meteoros: ['rate', 'radius', 'multi', 'dmg', 'rate'],
  ventisca: ['shards', 'radius', 'dmg', 'shards', 'dmg'],
};
const PERK_NAME = { auto: 'repetición', rate: 'más cadencia', multi: 'proyectil extra', pierce: 'atraviesa enemigos', radius: 'explosión más grande',
  dmg: 'más daño', hp: 'más resistencia', shards: 'más esquirlas' };
// Versión corta para las cartas del menú de nivel.
const PERK_CARD = { auto: 'REPETICION', rate: 'CADENCIA', multi: '+PROYECTIL', pierce: 'ATRAVIESA', radius: '+RADIO',
  dmg: '+PODER', hp: '+RESISTENCIA', shards: '+ESQUIRLAS' };
// Cuántas veces tiene un hechizo una mejora de cierto tipo.
const perk = (w, kind) => { let n = 0; const list = PERKS[WEAPONS[w].id]; for (let k = 0; k < level[w]; k++) if (list[k] === kind) n++; return n; };

// Árbol de habilidades estilo Diablo: tres ramas; cada fila pide un nivel del mago y tener la habilidad de arriba.
const TREE = [
  { name: 'ARCANO', color: '#b98cff', skills: ['varita', 'runa', 'totem'] },
  { name: 'FUEGO', color: '#ff8a3a', skills: ['chispas', 'frascos', 'bola', 'meteoros'] },
  { name: 'TORMENTA', color: '#7fd8ff', skills: ['rayos', 'muro', 'ventisca'] },
];
const ROW_LEVEL = [1, 6, 12, 18];
const WIDX = Object.fromEntries(WEAPONS.map((W_, w) => [W_.id, w]));
const NODE = {};                        // por hechizo: rama, fila y el de arriba
TREE.forEach((b, bi) => b.skills.forEach((id, row) => { NODE[WIDX[id]] = { bi, row, parent: row ? WIDX[b.skills[row - 1]] : -1 }; }));
// Desbloquear pide el nivel de la fila; cada mejora siguiente, 2 niveles más (rango n: fila + 2n - 2).
const rankReq = (w) => ROW_LEVEL[NODE[w].row] + (unlocked[w] ? 2 * level[w] : 0);
const canRank = (w) => level[w] < 5 && plevel >= rankReq(w) && (NODE[w].parent < 0 || unlocked[NODE[w].parent]);
// Control: 5 casillas (teclas 1-5) con las habilidades elegidas; -1 es casilla vacía.
const slots = [0, -1, -1, -1, -1];
function bindSlot(k, w) {
  if (!unlocked[w]) return;
  const old = slots.indexOf(w);
  if (old >= 0) slots[old] = slots[k];   // si ya estaba en otra casilla, se intercambian
  slots[k] = w;
  if (!slots.includes(player.weapon)) player.weapon = slots.find((x) => x >= 0);
}
function spendPoint(w) {
  if (!points || !canRank(w)) return;
  points--;
  if (!unlocked[w]) {
    unlocked[w] = true;
    const free = slots.indexOf(-1);
    if (free >= 0) { slots[free] = w; player.weapon = w; }
    say('Nueva habilidad: ' + WEAPONS[w].name + (free >= 0 ? ' (tecla ' + (free + 1) + ')' : ''));
  } else { const kind = PERKS[WEAPONS[w].id][level[w]]; level[w]++; say(`${WEAPONS[w].name}: ${PERK_NAME[kind]}`, 3); }
}
// Ficha de cada habilidad: descripción y stats con L mejoras tomadas (los mismos números que usa fire()).
const DESC = {
  varita: 'PROYECTIL ARCANO A DISTANCIA', chispas: 'ABANICO DE CHISPAS DE CERCA', runa: 'MINA: EXPLOTA AL PISARLA O DISPARARLE',
  frascos: 'FRASCO DE FUEGO QUE CAE EN ARCO', muro: 'LEVANTA UN BLOQUE DE PIEDRA', rayos: 'CHORRO CONTINUO DE RAYOS',
  bola: 'BOLA QUE EXPLOTA AL PRIMER IMPACTO', totem: 'TÓTEM QUE DISPARA SOLO', meteoros: 'ALTAR QUE LLAMA METEOROS',
  ventisca: 'LLUVIA DE HIELO QUE FRENA ENEMIGOS',
};
function spellStats(w, L) {
  const id = WEAPONS[w].id, n = (kind) => PERKS[id].slice(0, L).filter((k) => k === kind).length;
  const m = 1 + n('dmg') * 0.3, multi = n('multi'), pierce = n('pierce'), rad = 1 + n('radius') * 0.25, hpm = 1 + n('hp') * 0.5;
  const rate = Math.pow(0.8, n('rate')), cd = WEAPONS[w].rate * rate, f1 = (v) => (Math.round(v * 10) / 10).toString(), f0 = (v) => String(Math.round(v));
  const out = [];
  const add = (label, v) => out.push([label, v]);
  switch (id) {
    case 'varita': add('DAÑO', f1(1.6 * m)); add('PROYECTILES', f0(1 + multi)); add('ATRAVIESA', f0(pierce)); add('DISPAROS/S', f1(1 / cd));
      add('DAÑO/S', f1(1.6 * m * (1 + multi) / cd)); add('ALCANCE', '648'); add('MODO', n('auto') ? 'REPETICIÓN' : 'UN TIRO X CLIC'); break;
    case 'chispas': add('DAÑO', f1(1.15 * m) + ' C/U'); add('CHISPAS', f0(7 + multi * 2)); add('ATRAVIESA', f0(pierce));
      add('DAÑO/S', f1(1.15 * m * (7 + multi * 2) / cd)); add('ALCANCE', '235'); break;
    case 'runa': add('DAÑO', f0(14 * m)); add('RADIO', f0(85 * rad)); add('MÁXIMO', '40 RUNAS'); break;
    case 'frascos': add('DAÑO', f0(13 * m)); add('RADIO', f0(70 * rad)); add('FRASCOS', f0(1 + multi)); add('ALCANCE', '60-240'); break;
    case 'muro': add('RESISTENCIA', f0(120 * hpm)); add('MÁXIMO', '20 BLOQUES'); break;
    case 'rayos': add('DAÑO', f1(1.1 * m)); add('ATRAVIESA', f0(pierce)); add('DAÑO/S', f1(1.1 * m / cd)); add('ALCANCE', '640'); break;
    case 'bola': add('DAÑO', f0(18 * m)); add('RADIO', f0(75 * rad)); add('BOLAS', f0(1 + multi)); add('ALCANCE', '860'); break;
    case 'totem': add('DAÑO', f1(1.1 * m)); add('PROYECTILES', f0(1 + multi)); add('DISPAROS/S', f1(1 / (0.11 * rate)));
      add('ALCANCE', '260'); add('VIDA', f0(80 * hpm)); break;
    case 'meteoros': add('DAÑO', f0(13 * m)); add('RADIO', f0(70 * rad)); add('METEOROS', f0(1 + multi)); add('CADA', f1(1.6 * rate) + ' S');
      add('ALCANCE', '90-380'); add('VIDA', '60'); break;
    case 'ventisca': add('DAÑO', f0(9 * m) + ' C/U'); add('ESQUIRLAS', f0(28 + n('shards') * 10)); add('ZONA', f0(150 * rad)); add('EFECTO', 'RALENTIZA'); break;
  }
  if (!['varita', 'chispas', 'rayos'].includes(id)) add('RECARGA', f1(cd) + ' S');
  add('MANÁ', WEAPONS[w].cost ? String(WEAPONS[w].cost) : 'LIBRE');
  return out;
}
let treeFrom = 'play';                  // a qué estado vuelve el árbol al cerrarse
function openTree() { treeFrom = state; state = 'tree'; shooting = false; clickQueued = false; }
function gainXp(n) {
  xp += n;
  let up = false;
  while (xp >= xpNeed(plevel)) { xp -= xpNeed(plevel); plevel++; points++; up = true; }
  // Al subir de nivel se abre el árbol; si no hay nada para subir, el punto queda guardado.
  if (up && state === 'play' && WEAPONS.some((_, k) => canRank(k))) openTree();
}

// Cada oleada (desde la 2) arranca con una caja de munición cerca: el loop nunca te deja seco mucho rato.
function supplyDrop() {
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.random() * 6.283, r = 60 + Math.random() * 60;
    const x = player.x + Math.cos(a) * r, y = player.y + Math.sin(a) * r;
    if (!blocked(x, y, 8)) { crates.push({ x, y, kind: 0, life: 20 }); return; }
  }
}

function startWave() {
  if (wave > 0) supplyDrop();
  wave++;
  // Curva de dificultad: cada enemigo nuevo entra de a uno y va ganando peso en la mezcla.
  // Cada 5 oleadas hay un pico (x1,4) y la siguiente afloja un poco, para respirar.
  const peak = wave % 5 === 0 ? 1.4 : wave % 5 === 1 && wave > 1 ? 0.85 : 1;
  pending[0] = Math.round((10 + wave * 8 + wave * wave * 0.35) * peak);                  // musgosos
  pending[1] = wave >= 3 ? Math.round((1 + (wave - 3) * 1.3 + (wave - 3) ** 2 * 0.06) * peak) : 0; // cuernudos
  pending[2] = wave >= 6 ? Math.round((1 + Math.floor((wave - 6) / 3)) * peak) : 0;      // machos cabríos
  pending[3] = wave % 10 === 0 ? 1 : 0;                                                   // jefe
  pending[4] = wave >= 2 ? Math.round((2 + (wave - 2) * 1.6) * peak) : 0;                // diablillos
  pending[5] = wave >= 8 ? Math.round((1 + (wave - 8) * 0.7) * peak) : 0;                // caballeros óseos
  spawnRate = Math.max(0.03, 0.6 - wave * 0.035);   // las primeras oleadas salen de a poco
  waveT = 2.6;   // cartel grande de OLEADA N, sin más avisos
}

function spawnFromEdge(type) {
  for (let tries = 0; tries < 10; tries++) {
    const t = spawnTiles[(Math.random() * spawnTiles.length) | 0];
    if (dist[t] >= INF) continue;
    const x = (t % MW) * T + T / 2, y = ((t / MW) | 0) * T + T / 2;
    if (Math.hypot(x - player.x, y - player.y) < 360) continue;
    spawnEnemy(type, x, y);
    return;
  }
  // Si el borde está tapado, cualquier claro alcanzable y lejos del jugador.
  for (let tries = 0; tries < 20; tries++) {
    const t = (Math.random() * MW * MH) | 0;
    if (map[t] || dist[t] >= INF) continue;
    const x = (t % MW) * T + T / 2, y = ((t / MW) | 0) * T + T / 2;
    if (Math.hypot(x - player.x, y - player.y) < 420) continue;
    spawnEnemy(type, x, y);
    return;
  }
}

// ---------- Tabla de puntajes (en txt: rutas /horda/* de src/app.js) ----------
// El puntaje se guarda con la cuenta de txt y en la tabla cada cuenta aparece con su ID pseudoanónimo
// de HORDA (el mejor puntaje de cada una). Sin sesión, el puntaje queda pendiente en sessionStorage
// y se manda solo al volver a /horda después de entrar.
const PENDIENTE = 'horda:pendiente';
// phase: cargando → enviando (si entra al top) → listo; entrar (sin sesión); o error si no hay conexión.
const board = { phase: 'idle', top: [], mine: -1, puesto: 0, yo: null, csrf: null, logueado: false, aviso: '' };
let playTime = 0;
const entrarBtn = { x: 0, y: 0, w: 0, h: 0 };   // botón de entrar a txt (sin sesión)
function pedirJSON(url, opts) {
  return fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts)).then((r) =>
    r.json().catch(() => ({})).then((d) => {
      if (!r.ok) { const e = new Error(d.error || String(r.status)); e.status = r.status; e.codigo = d.error; throw e; }
      return d;
    }));
}
function leerEstado() {
  return pedirJSON('/horda/estado.json').then((d) => { board.logueado = !!d.logueado; board.csrf = d.csrf; board.yo = d.yo; });
}
function leerPendiente() { try { return JSON.parse(sessionStorage.getItem(PENDIENTE) || 'null'); } catch (e) { return null; } }
// Si ya había uno pendiente (otra partida sin entrar), queda el mejor de los dos.
function guardarPendiente(p) {
  const antes = leerPendiente();
  if (antes && Number(antes.puntos) >= p.puntos) return;
  try { sessionStorage.setItem(PENDIENTE, JSON.stringify(p)); } catch (e) { /* sin almacenamiento: se pierde */ }
}
function borrarPendiente() { try { sessionStorage.removeItem(PENDIENTE); } catch (e) { /* nada */ } }
function marcarMio() { board.mine = board.yo ? board.top.findIndex((t) => t.id === board.yo) : -1; }
function irAEntrar() { location.href = '/entrar?volver=' + encodeURIComponent('/horda'); }
function gameOver() {
  const p = { puntos: score, oleada: wave, bajas: kills, segundos: Math.round(playTime) };
  Object.assign(board, { phase: 'cargando', top: [], mine: -1, puesto: 0, aviso: '' });
  Promise.all([leerEstado(), pedirJSON('/horda/top.json')]).then(([, d]) => {
    board.top = d.top || [];
    marcarMio();
    const entra = p.puntos > 0 && (board.top.length < 10 || p.puntos > board.top[board.top.length - 1].puntos);
    if (!board.logueado) {
      if (p.puntos > 0) { guardarPendiente(p); board.phase = 'entrar'; } else board.phase = 'listo';
    } else if (entra) sendScore(p);
    else board.phase = 'listo';
  }).catch(() => { board.phase = 'error'; });
}
function sendScore(p) {
  board.phase = 'enviando';
  const body = new URLSearchParams({ _csrf: board.csrf || '', puntos: p.puntos, oleada: p.oleada, bajas: p.bajas, segundos: p.segundos });
  pedirJSON('/horda/puntaje', { method: 'POST', body }).then((d) => {
    if (!d.top) throw new Error('sin tabla');
    board.top = d.top; board.puesto = d.puesto || 0; marcarMio(); board.phase = 'listo';
  }).catch((e) => {
    board.aviso = e.status === 429 ? 'DEMASIADOS ENVIOS: ESPERA UN MINUTO'
      : e.codigo === 'suspendida' ? 'TU CUENTA DE TXT ESTA SUSPENDIDA'
      : e.status === 400 ? 'ESE PUNTAJE NO SE PUEDE GUARDAR'
      : e.status === 401 || e.status === 403 ? 'SE VENCIO LA SESION: RECARGA LA PAGINA' : '';
    board.phase = 'error';
  });
}
// Al volver de entrar a txt: si quedó un puntaje pendiente y ahora hay sesión, se manda y se muestra
// la tabla con esa partida. Sin sesión queda guardado para la próxima.
function retomarPendiente() {
  const p = leerPendiente();
  if (!p) return;
  leerEstado().then(() => {
    if (!board.logueado || state !== 'menu') return;
    borrarPendiente();
    score = Number(p.puntos) || 0; wave = Number(p.oleada) || 0; kills = Number(p.bajas) || 0;
    Object.assign(board, { top: [], mine: -1, puesto: 0, aviso: '' });
    state = 'over';
    sendScore({ puntos: score, oleada: wave, bajas: kills, segundos: Number(p.segundos) || 0 });
  }).catch(() => {});
}

function hurt(n) {
  if (state !== 'play') return;
  player.hp -= n; player.hurt = 0.25;
  if (player.hp <= 0) { player.hp = 0; state = 'over'; gameOver(); }
}

function onKill(j) {
  const E = ETYPES[et[j]];
  kills++;
  combo = comboT > 0 ? Math.min(combo + 1, 999) : 1;
  comboT = 1.3;
  score += E.pts * combo;
  if (et[j] === 3) {
    booms.push({ x: ex[j], y: ey[j], t: 0 });
    stain(ex[j], ey[j], 30, '#1e3a14', 0.7);
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * 6.2832, x = ex[j] + Math.cos(a) * 30, y = ey[j] + Math.sin(a) * 30;
      if (!blocked(x, y, 8)) crates.push({ x, y, kind: k & 1, life: 25 });
    }
  }
  stain(ex[j], ey[j], 5 + Math.random() * 6, et[j] ? '#5a0f1a' : '#3d4a17', 0.5);
  // Cajas con ritmo: la chance crece con el tiempo sin que caiga ninguna, y a los 8 s cae seguro.
  if (crates.length < 6 && (lootT >= 8 || Math.random() < 0.03 + lootT * 0.02)) {
    const health = Math.random() < (player.hp < 50 ? 0.5 : 0.15);
    crates.push({ x: ex[j], y: ey[j], kind: health ? 1 : 0, life: 14 });
    lootT = 0;
  }
  gainXp(E.pts / 10);
}

function nearestEnemy(x, y, R, minD = 0) {
  let best = -1, bd = R * R;
  const c0x = Math.max(0, ((x - R) / GC) | 0), c1x = Math.min(GW - 1, ((x + R) / GC) | 0);
  const c0y = Math.max(0, ((y - R) / GC) | 0), c1y = Math.min(GH - 1, ((y + R) / GC) | 0);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const c = cy * GW + cx;
    for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
      const j = cellItems[k];
      if (ehp[j] <= 0) continue;
      const dx = ex[j] - x, dy = ey[j] - y, dd = dx * dx + dy * dy;
      if (dd < bd && dd >= minD * minD) { bd = dd; best = j; }
    }
  }
  return best;
}

function damageEnemy(j, dmg, kx, ky) {
  if (ehp[j] <= 0) return;
  ehp[j] -= dmg; efl[j] = 0.07; ekx[j] += kx; eky[j] += ky;
  if (ehp[j] <= 0) onKill(j);
}

function explode(x, y, R = 85, dmg = 14, self = 18, ice = false) {
  booms.push({ x, y, t: 0, ice, R });
  if (ice) stain(x, y, R * 0.35, '#dff3ff', 0.25); else stain(x, y, 26, '#110d0a', 0.6);
  const c0x = Math.max(0, ((x - R) / GC) | 0), c1x = Math.min(GW - 1, ((x + R) / GC) | 0);
  const c0y = Math.max(0, ((y - R) / GC) | 0), c1y = Math.min(GH - 1, ((y + R) / GC) | 0);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const c = cy * GW + cx;
    for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
      const j = cellItems[k], dx = ex[j] - x, dy = ey[j] - y, d = Math.hypot(dx, dy);
      if (d < R) { const f = 1 - d / R; if (ice) eslow[j] = 3; damageEnemy(j, dmg * f + 2, dx / (d || 1) * 600 * f, dy / (d || 1) * 600 * f); }
    }
  }
  // Las explosiones propias no lastiman al mago.
  for (const b of barrels) if (b.fuse === Infinity && Math.hypot(b.x - x, b.y - y) < R) b.fuse = 0.12; // cadena
}

function fire() {
  const w = player.weapon, a = player.aim;
  const cost = WEAPONS[w].cost;
  if (player.mana < cost) { player.noMana = 0.3; return; }
  // Los proyectiles nacen en la punta de la vara de la pose de lanzamiento: (±24, 8) del diseño,
  // espejado igual que el sprite (el espejo intercambia x e y), y salen hacia el punto del mouse.
  // Todo sale del centro del mago (del círculo mágico del pecho), hacia donde apunta.
  // Nace a 2 px del centro: con 12 px por paso, el primer chequeo ya cubre a los enemigos pegados.
  const mx = player.x + Math.cos(a) * 2, my = player.y + Math.sin(a) * 2;
  const vox = 0, voy = 0, aa = a;
  const id = WEAPONS[w].id, m = 1 + perk(w, 'dmg') * 0.3, multi = perk(w, 'multi'), pierce = perk(w, 'pierce');
  const rad = 1 + perk(w, 'radius') * 0.25, hpm = 1 + perk(w, 'hp') * 0.5;
  // Proyectiles extra: en abanico chico alrededor de la puntería.
  const fan = (n, f) => { for (let k = 0; k <= n; k++) f(aa + (k - n / 2) * 0.09); };
  if (id === 'varita') fan(multi, (b) => addBullet(mx, my, b + (Math.random() - 0.5) * 0.04, 720, 1.6 * m, 0.9, 0, 0, 0, pierce));
  else if (id === 'chispas') for (let k = 0; k < 7 + multi * 2; k++) addBullet(mx, my, aa + (Math.random() - 0.5) * 0.42, 600 + Math.random() * 140, 1.15 * m, 0.35, 1, 0, 0, pierce);
  else if (id === 'runa') {
    const x = player.x + Math.cos(a) * 22, y = player.y + Math.sin(a) * 22;
    if (blocked(x, y, 7) || barrels.length >= 40) return;
    barrels.push({ x, y, hp: 1, fuse: Infinity, arm: 0.5, R: 85 * rad, dmg: 14 * m });
  } else if (id === 'frascos') {
    // Frasco de fuego: va al punto del mouse (entre 60 y 240 px) en arco.
    let tx = player.tx, ty = player.ty;
    if (!usingMouse || tx === undefined) { tx = player.x + Math.cos(a) * 160; ty = player.y + Math.sin(a) * 160; }
    const dd = Math.hypot(tx - player.x, ty - player.y), k = Math.min(240, Math.max(60, dd)) / (dd || 1);
    tx = player.x + (tx - player.x) * k; ty = player.y + (ty - player.y) * k;
    for (let k = 0; k <= multi; k++) {
      const ox = k ? (Math.random() - 0.5) * 60 : 0, oy = k ? (Math.random() - 0.5) * 60 : 0;
      throws.push({ x0: player.x, y0: player.y, x1: tx + ox, y1: ty + oy, t: 0, dur: 0.45 + dd / 700 + k * 0.08, h: 30 + dd * 0.15, R: 70 * rad, dmg: 13 * m, self: 15 });
    }
  } else if (id === 'muro') {
    const x = player.x + Math.cos(a) * 26, y = player.y + Math.sin(a) * 26;
    const t = Math.floor(y / T) * MW + Math.floor(x / T);
    if (map[t] !== 0 || barricades.length >= 20 || Math.hypot((t % MW + 0.5) * T - player.x, (((t / MW) | 0) + 0.5) * T - player.y) < PR + 13) return;
    map[t] = 3; bhp[t] = 120 * hpm; barricades.push(t);
  } else if (id === 'rayos') addBullet(mx, my, aa + (Math.random() - 0.5) * 0.14, 800, 1.1 * m, 0.8, 3, 0, 0, pierce);
  else if (id === 'bola') fan(multi, (b) => rockets.push({ x: mx, y: my, vox: 0, voy: 0, vx: Math.cos(b) * 430, vy: Math.sin(b) * 430, life: 2, dmg: 18 * m, R: 75 * rad }));
  else if (id === 'ventisca') {
    let tx = player.tx, ty = player.ty;
    if (!usingMouse || tx === undefined) { tx = player.x + Math.cos(a) * 200; ty = player.y + Math.sin(a) * 200; }
    storms.push({ x: tx, y: ty, t: 0, next: 0, left: 28 + perk(w, 'shards') * 10, m, R: 150 * rad });
    say('¡Ventisca!', 1);
  }
  else if (id === 'totem' || id === 'meteoros') {
    const x = player.x + Math.cos(a) * 22, y = player.y + Math.sin(a) * 22;
    if (blocked(x, y, 8) || turrets.length >= 6) return;
    const kind = id === 'totem' ? 0 : 1, hp = (kind ? 60 : 80) * hpm;
    turrets.push({ x, y, kind, hp, maxHp: hp, cd: 0.5, aim: a, m, rate: Math.pow(0.8, perk(w, 'rate')), multi, rad });
  }
  player.mana -= cost;
  player.cd = WEAPONS[w].rate * Math.pow(0.8, perk(w, 'rate'));
  player.castT = Math.max(0.14, Math.min(0.3, player.cd));
}

// ---------- Entrada ----------
const keys = new Set();
let mouseX = W / 2, mouseY = H / 2, usingMouse = false, shooting = false, clickQueued = false;   // clickQueued: un tiro pendiente para los hechizos de a uno
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !e.repeat) clickQueued = true;
  keys.add(e.code);
  if (state === 'over' && board.phase === 'entrar' && e.code === 'KeyE') { irAEntrar(); return; }
  // Esc vuelve a txt (el árbol de habilidades usa Esc para cerrarse, pero se atiende antes y sale con return).
  if (e.code === 'Escape' && (state === 'menu' || state === 'pause' || (state === 'over' && board.phase !== 'enviando'))) { location.href = '/'; return; }
  if (e.code === 'Enter' && (state === 'menu' || (state === 'over' && board.phase !== 'enviando'))) { reset(); state = 'play'; }
  if (e.code === 'KeyP' && (state === 'play' || state === 'pause')) state = state === 'play' ? 'pause' : 'play';
  if (e.code === 'KeyF') showStats = !showStats;
  if (state === 'tree') {
    // Con el mouse sobre una habilidad, 1-5 la pone en esa casilla. T o Esc cierran.
    const k = '12345'.indexOf(e.key), node = treeHit();
    if (k >= 0 && node) bindSlot(k, node.idx);
    if (e.code === 'KeyT' || e.code === 'Escape') state = treeFrom;
    return;
  }
  if (e.code === 'KeyT' && (state === 'play' || state === 'pause')) { openTree(); return; }
  if (state !== 'play') return;
  const n = '12345'.indexOf(e.key);
  if (n >= 0 && slots[n] >= 0) player.weapon = slots[n];
  if (e.code === 'KeyQ' || e.code === 'KeyE') {
    const dir = e.code === 'KeyE' ? 1 : -1, cur = slots.indexOf(player.weapon);
    for (let k = 1; k <= 5; k++) {
      const w = slots[(cur + dir * k + 10) % 5];
      if (w >= 0) { player.weapon = w; break; }
    }
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; usingMouse = true; });
addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (state === 'over' && board.phase === 'entrar' && inBox(entrarBtn)) { irAEntrar(); return; }
  if (state === 'tree') {
    if (inBox(backBtn)) { state = treeFrom; return; }
    const c = treeHit(); if (c) spendPoint(c.idx); return;
  }
  if (state === 'play' && inBox(treeBtn)) { openTree(); return; }
  shooting = true; clickQueued = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) shooting = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => { keys.clear(); shooting = false; if (state === 'play') state = 'pause'; });

// ---------- Simulación ----------
let camX = 0, camY = 0;
function update(dt) {
  playTime += dt;
  // Jugador
  // Las teclas son direcciones de pantalla; en isométrico se pasan al mundo: x = sy + sx/2, y = sy - sx/2.
  let sx = 0, sy = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) sy--;
  if (keys.has('KeyS') || keys.has('ArrowDown')) sy++;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) sx--;
  if (keys.has('KeyD') || keys.has('ArrowRight')) sx++;
  player.moving = !!(sx || sy);
  if (player.moving) {
    const mx = sy + sx / 2, my = sy - sx / 2;
    const l = Math.hypot(mx, my), sp = 150 * dt;
    const nx = player.x + mx / l * sp, ny = player.y + my / l * sp;
    if (!blocked(nx, player.y, PR)) player.x = nx;
    if (!blocked(player.x, ny, PR)) player.y = ny;
    if (!usingMouse) player.aim = Math.atan2(my, mx);
  }
  if (usingMouse) {
    // El mouse apunta a la altura del torso (GUN_Z) sobre el piso.
    const fxv = mouseX / ZOOM + camX - ISO_OX, fyv = mouseY / ZOOM + camY + GUN_Z;
    player.tx = fyv + fxv / 2; player.ty = fyv - fxv / 2;
    player.aim = Math.atan2(player.ty - player.y, player.tx - player.x);
  }
  player.cd -= dt; player.hurt -= dt; player.noMana -= dt; player.castT -= dt;
  player.mana = Math.min(MANA_MAX, player.mana + MANA_REGEN * dt);
  // Los hechizos de a uno (varita) disparan una vez por clic; si se hace clic durante la recarga, sale apenas puede.
  // Con la mejora de repetición pasan a disparar solos mientras se mantiene apretado.
  if (WEAPONS[player.weapon].semi && !perk(player.weapon, 'auto')) { if (clickQueued && player.cd <= 0) { fire(); clickQueued = false; } }
  else { clickQueued = false; if ((shooting || keys.has('Space')) && player.cd <= 0) fire(); }
  comboT -= dt; if (comboT <= 0) combo = 1;
  if (nE > 0) lootT += dt;
  bannerT -= dt; waveT -= dt;

  // Oleadas
  const left = pendingTotal();
  if (left > 0) {
    spawnT -= dt;
    while (spawnT <= 0 && pendingTotal() > 0) {
      // Se sortea el tipo en proporción a lo que falta, así los grandes salen mezclados con la horda.
      let r = Math.random() * pendingTotal(), t = 0;
      while (r >= pending[t]) { r -= pending[t]; t++; }
      pending[t]--; spawnFromEdge(t);
      spawnT += spawnRate;
    }
  } else if (nE === 0) {
    breakT -= dt;
    if (breakT <= 0) { startWave(); breakT = 3; }
  }

  buildFlow(player.x, player.y);
  buildGrid();

  // Enemigos
  const px = player.x, py = player.y;
  for (let i = 0; i < nE; i++) {
    if (ehp[i] <= 0) continue;
    const t = et[i], E = ETYPES[t], r = E.r;
    const dx = px - ex[i], dy = py - ey[i], d = Math.hypot(dx, dy) || 1;
    let mvx = dx / d, mvy = dy / d;
    const ti = ((ey[i] / T) | 0) * MW + ((ex[i] / T) | 0);
    if (dist[ti] > 1 && nxt[ti] >= 0) {
      // Apuntar al centro del próximo casillero (no a la dirección cruda) hace que rodee los troncos.
      const n = nxt[ti], tx = (n % MW + 0.5) * T - ex[i], ty = (((n / MW) | 0) + 0.5) * T - ey[i];
      const tl = Math.hypot(tx, ty) || 1;
      mvx = tx / tl; mvy = ty / tl;
    }
    // Macho cabrío: se frena y escarba (aviso), después embiste en línea recta hacia donde estabas.
    // Si te agarra: golpe fuerte y te tira para atrás. Si choca contra algo, la embestida se corta.
    if (t === 2) {
      ecd[i] -= dt;
      if (ewu[i] > 0) {
        ewu[i] -= dt; mvx = mvy = 0;
        if (ewu[i] <= 0) { edx[i] = dx / d; edy[i] = dy / d; ech[i] = 0.9; }
      } else if (ech[i] > 0) {
        ech[i] -= dt; mvx = edx[i] * 5.5; mvy = edy[i] * 5.5;
        stain(ex[i], ey[i], 3, '#3a2a18', 0.3);
        if (d < r + PR + 6) {
          hurt(35); eat[i] = 1.2; ech[i] = 0;
          for (let k = 0; k < 6; k++) {
            const nx = player.x + edx[i] * 6, ny = player.y + edy[i] * 6;
            if (blocked(nx, ny, PR)) break;
            player.x = nx; player.y = ny;
          }
        }
      } else if (d < 200 && ecd[i] <= 0) { ewu[i] = 0.6; ecd[i] = 4 + Math.random() * 2; }
      // De lejos arranca una piedra y la tira en arco adonde estás: el círculo rojo en el piso avisa dónde cae.
      else if (d < 380 && ecd[i] <= 0) {
        boulders.push({ x0: ex[i], y0: ey[i], x1: px, y1: py, t: 0, dur: 0.9 + d / 600 });
        ecd[i] = 3 + Math.random() * 2; efl[i] = 0.12;
      }
    }
    if (t === 3) {
      const angry = ehp[i] < bossMax / 2;
      ecd[i] -= dt; ech[i] -= dt;
      if (ecd[i] <= 0) {
        const n = angry ? 16 : 12, off = Math.random();
        for (let k = 0; k < n; k++) addFireball(ex[i], ey[i], (k + off) / n * 6.2832);
        ecd[i] = angry ? 2.2 : 3.5;
      }
      if (ech[i] <= 0) {
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * 6.2832, x = ex[i] + Math.cos(a) * 40, y = ey[i] + Math.sin(a) * 40;
          if (!blocked(x, y, 8)) spawnEnemy(0, x, y);
        }
        ech[i] = angry ? 5 : 7;
      }
      if (angry) { mvx *= 1.5; mvy *= 1.5; }
    }
    if (t === 5) {
      ecd[i] -= dt;
      if (d < 280 && ecd[i] <= 0) { addFireball(ex[i], ey[i], Math.atan2(dy, dx), 1, 180); ecd[i] = 2.4 + Math.random() * 1.2; }
      if (d < 120) { mvx *= 0.4; mvy *= 0.4; }
    }
    if (E.fly) { mvx = dx / d; mvy = dy / d; }
    if (t === 1) {
      ecd[i] -= dt;
      if (d < 330 && ecd[i] <= 0) { addFireball(ex[i], ey[i], Math.atan2(dy, dx)); ecd[i] = 2 + Math.random() * 1.5; }
      if (d < 150) { mvx *= 0.25; mvy *= 0.25; }
    }
    // Separación: como mucho 10 vecinos, así una pila de mil no se vuelve cuadrática.
    let sx = 0, sy = 0, checks = 0;
    const c = ecell[i], ccx = c % GW, ccy = (c / GW) | 0;
    for (let gy = ccy - 1; gy <= ccy + 1 && checks < 10; gy++) {
      if (gy < 0 || gy >= GH) continue;
      for (let gx = ccx - 1; gx <= ccx + 1 && checks < 10; gx++) {
        if (gx < 0 || gx >= GW) continue;
        const cc = gy * GW + gx;
        for (let k = cellStart[cc]; k < cellStart[cc + 1] && checks < 10; k++) {
          const j = cellItems[k];
          if (j === i) continue;
          checks++;
          const ox = ex[i] - ex[j], oy = ey[i] - ey[j], dd = ox * ox + oy * oy, rr = r + ETYPES[et[j]].r;
          if (dd < rr * rr && dd > 0.0001) { const dl = Math.sqrt(dd), f = (rr - dl) / rr; sx += ox / dl * f; sy += oy / dl * f; }
        }
      }
    }
    const sp = E.spd * dt * (1 + Math.min(0.3, wave * 0.015)) * (eslow[i] > 0 ? 0.4 : 1);
    eslow[i] -= dt;
    const vx = mvx * sp + sx * sp * 1.7 + ekx[i] * dt, vy = mvy * sp + sy * sp * 1.7 + eky[i] * dt;
    ekx[i] *= 0.82; eky[i] *= 0.82;
    const ox0 = ex[i], oy0 = ey[i];
    const nx = ex[i] + vx, ny = ey[i] + vy;
    if (E.fly) { ex[i] = Math.min(WW - T, Math.max(T, nx)); ey[i] = Math.min(WH - T, Math.max(T, ny)); }
    else {
      if (!blocked(nx, ey[i], r)) ex[i] = nx;
      if (!blocked(ex[i], ny, r)) ey[i] = ny;
    }
    if (!E.fly && ex[i] === ox0 && ey[i] === oy0 && (vx || vy)) {
      const side = (i & 1) ? 1 : -1, l = Math.hypot(vx, vy);
      const sx2 = ex[i] - vy / l * sp * side, sy2 = ey[i] + vx / l * sp * side;
      if (!blocked(sx2, sy2, r)) { ex[i] = sx2; ey[i] = sy2; }
      if (t === 2 && ech[i] > 0) ech[i] = 0;   // la embestida choca y se corta
    }
    {
      const bt = Math.floor((ey[i] + mvy * (r + 4)) / T) * MW + Math.floor((ex[i] + mvx * (r + 4)) / T);
      if (map[bt] === 3) bhp[bt] -= E.dmg * 0.7 * dt;
      for (const tu of turrets) if (Math.abs(tu.x - ex[i]) < r + 10 && Math.abs(tu.y - ey[i]) < r + 10) tu.hp -= E.dmg * 0.7 * dt;
    }
    efl[i] -= dt; eat[i] -= dt;
    if (d < (E.hr || r) + PR + 3 && eat[i] <= 0) { hurt(E.dmg); eat[i] = 0.9; }
  }

  // Balas
  for (let i = nB - 1; i >= 0; i--) {
    bl[i] -= dt;
    const x = bx[i] + bvx[i] * dt, y = by[i] + bvy[i] * dt;
    if (bl[i] <= 0 || wallAt(x, y)) { removeBullet(i); continue; }
    bx[i] = x; by[i] = y; bvox[i] *= 0.6; bvoy[i] *= 0.6;
    let hit = false;
    for (const b of barrels) {
      if (Math.abs(b.x - x) < 9 && Math.abs(b.y - y) < 9) { b.hp -= bd[i]; if (b.hp <= 0 && b.fuse === Infinity) b.fuse = 0; hit = true; break; }
    }
    if (!hit) {
      const c = cellOf(x, y), ccx = c % GW, ccy = (c / GW) | 0;
      search:
      for (let gy = Math.max(0, ccy - 1); gy <= Math.min(GH - 1, ccy + 1); gy++) {
        for (let gx = Math.max(0, ccx - 1); gx <= Math.min(GW - 1, ccx + 1); gx++) {
          const cc = gy * GW + gx;
          for (let k = cellStart[cc]; k < cellStart[cc + 1]; k++) {
            const j = cellItems[k];
            if (ehp[j] <= 0) continue;
            const ox = ex[j] - x, oy = ey[j] - y, rr = (ETYPES[et[j]].hr || ETYPES[et[j]].r) + 3;
            if (j === bhl[i]) continue;
            if (ox * ox + oy * oy < rr * rr) {
              damageEnemy(j, bd[i], bvx[i] * 0.12, bvy[i] * 0.12);
              if (bp[i] > 0) { bp[i]--; bhl[i] = j; break search; }
              hit = true; break search;
            }
          }
        }
      }
    }
    if (hit) removeBullet(i);
  }

  // Bolas de fuego
  for (let i = nF - 1; i >= 0; i--) {
    flife[i] -= dt;
    fx[i] += fvx[i] * dt; fy[i] += fvy[i] * dt;
    if (flife[i] <= 0 || wallAt(fx[i], fy[i])) { removeFireball(i); continue; }
    if (Math.hypot(fx[i] - px, fy[i] - py) < PR + 4) { hurt(fk[i] ? 15 : 10); removeFireball(i); continue; }
    for (const tu of turrets) if (Math.abs(tu.x - fx[i]) < 9 && Math.abs(tu.y - fy[i]) < 9) { tu.hp -= 10; removeFireball(i); break; }
  }

  // Piedras del macho cabrío: al caer lastiman en un radio chico.
  for (let k = boulders.length - 1; k >= 0; k--) {
    const b = boulders[k];
    if ((b.t += dt) < b.dur) continue;
    if (Math.hypot(player.x - b.x1, player.y - b.y1) < 30 + PR) hurt(20);
    const bt = Math.floor(b.y1 / T) * MW + Math.floor(b.x1 / T);
    if (map[bt] === 3) bhp[bt] -= 40;
    for (const tu of turrets) if (Math.hypot(tu.x - b.x1, tu.y - b.y1) < 30) tu.hp -= 20;
    stain(b.x1, b.y1, 10, '#2a2218', 0.5);
    quakes.push({ x: b.x1, y: b.y1, t: 0 });
    boulders.splice(k, 1);
  }
  for (let k = quakes.length - 1; k >= 0; k--) if ((quakes[k].t += dt) > 0.35) quakes.splice(k, 1);
  // Granadas y obuses de mortero en vuelo
  for (let k = throws.length - 1; k >= 0; k--) {
    const g = throws[k];
    if ((g.t += dt) >= g.dur) { explode(g.x1, g.y1, g.R, g.dmg, g.self, g.ice); throws.splice(k, 1); }
  }
  // Ventiscas: 28 esquirlas de hielo en 2 s sobre un círculo de 150 px.
  for (let k = storms.length - 1; k >= 0; k--) {
    const st = storms[k];
    st.t += dt;
    while (st.next <= st.t && st.left > 0) {
      const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * (st.R || 150), x = st.x + Math.cos(a) * r, y = st.y + Math.sin(a) * r;
      throws.push({ x0: x - 25, y0: y - 25, x1: x, y1: y, t: 0, dur: 0.4, h: 0, fall: 200, R: 45, dmg: 9 * st.m, self: 6, ice: true });
      st.next += 0.07; st.left--;
    }
    if (st.left <= 0) storms.splice(k, 1);
  }
  // Cohetes: explotan contra el primer enemigo o pared
  for (let k = rockets.length - 1; k >= 0; k--) {
    const r = rockets[k];
    r.x += r.vx * dt; r.y += r.vy * dt; r.life -= dt; r.vox *= 0.6; r.voy *= 0.6;
    let boom = r.life <= 0 || wallAt(r.x, r.y);
    if (!boom) {
      const j = nearestEnemy(r.x, r.y, 30);
      if (j >= 0 && Math.hypot(ex[j] - r.x, ey[j] - r.y) < (ETYPES[et[j]].hr || ETYPES[et[j]].r) + 5) boom = true;
    }
    if (boom) { explode(r.x, r.y, r.R || 75, r.dmg, 8); rockets.splice(k, 1); }
  }
  // Torretas (ametralladora) y morteros: apuntan solos, duran un rato
  for (let k = turrets.length - 1; k >= 0; k--) {
    const tu = turrets[k];
    if (tu.hp <= 0) { booms.push({ x: tu.x, y: tu.y, t: 0.2 }); turrets.splice(k, 1); continue; }
    if ((tu.cd -= dt) > 0) continue;
    if (tu.kind === 0) {
      const j = nearestEnemy(tu.x, tu.y, 260);
      if (j < 0) { tu.cd = 0.2; continue; }
      tu.aim = Math.atan2(ey[j] - tu.y, ex[j] - tu.x);
      for (let q = 0; q <= (tu.multi || 0); q++) addBullet(tu.x + Math.cos(tu.aim) * 10, tu.y + Math.sin(tu.aim) * 10, tu.aim + (q - (tu.multi || 0) / 2) * 0.09 + (Math.random() - 0.5) * 0.08, 760, 1.1 * tu.m, 0.5, 4);
      tu.cd = 0.11 * (tu.rate || 1);
    } else {
      const j = nearestEnemy(tu.x, tu.y, 380, 90);
      if (j < 0) { tu.cd = 0.3; continue; }
      const dd = Math.hypot(ex[j] - tu.x, ey[j] - tu.y);
      for (let q = 0; q <= (tu.multi || 0); q++) {
        const qx = q ? (Math.random() - 0.5) * 70 : 0, qy = q ? (Math.random() - 0.5) * 70 : 0;
        throws.push({ x0: ex[j] - 40 + qx, y0: ey[j] - 40 + qy, x1: ex[j] + qx, y1: ey[j] + qy, t: 0, dur: 0.9 + q * 0.15, h: 0, fall: 220, R: 70 * (tu.rad || 1), dmg: 13 * tu.m, self: 0 });
      }
      tu.cd = 1.6 * (tu.rate || 1);
    }
  }
  // Barricadas rotas
  for (let k = barricades.length - 1; k >= 0; k--) {
    const t = barricades[k];
    if (bhp[t] <= 0) { map[t] = 0; barricades.splice(k, 1); }
  }

  // Barriles (la explosión usa la grilla, que sigue válida hasta compactar)
  for (const b of barrels) {
    // Runa armada: explota sola cuando un enemigo la pisa (además de cuando le disparan).
    if (b.fuse === Infinity && (b.arm -= dt) <= 0 && nearestEnemy(b.x, b.y, 20) >= 0) b.fuse = 0.15;
    if (b.fuse !== Infinity && (b.fuse -= dt) <= 0) { b.dead = true; explode(b.x, b.y, b.R || 85, b.dmg || 14); }
  }
  if (barrels.some((b) => b.dead)) barrels = barrels.filter((b) => !b.dead);

  // Cajas
  for (let k = crates.length - 1; k >= 0; k--) {
    const cr = crates[k];
    if ((cr.life -= dt) <= 0) { crates.splice(k, 1); continue; }
    if (Math.hypot(cr.x - px, cr.y - py) < 16) {
      if (cr.kind === 0) { player.mana = Math.min(MANA_MAX, player.mana + MANA_CHEST); say('+' + MANA_CHEST + ' maná', 1); }
      else { player.hp = Math.min(100, player.hp + 30); say('+30 vida', 1); }
      crates.splice(k, 1);
    }
  }
  for (const b of booms) b.t += dt;
  if (booms.length && booms[0].t > 0.4) booms = booms.filter((b) => b.t <= 0.4);

  compactEnemies();
}

// ---------- Dibujo ----------
// Todo se arma con cajas isométricas y se pre-renderiza a canvases chicos al arrancar: en cada frame
// los personajes y los árboles son un drawImage cada uno.
const P = (x, y, z) => [x - y, (x + y) / 2 - z];
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function quad(g, ox, oy, pts, color) {
  g.fillStyle = color; g.beginPath();
  pts.forEach(([x, y, z], k) => { const [sx, sy] = P(x, y, z); k ? g.lineTo(ox + sx, oy + sy) : g.moveTo(ox + sx, oy + sy); });
  g.closePath(); g.fill();
}
// Caja apoyada en (x, y, z) con lados w (eje x), d (eje y) y alto h. Se ven la cara +y, la +x y la de arriba.
function box(g, ox, oy, x, y, z, w, d, h, color) {
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y - d / 2, y1 = y + d / 2, z1 = z + h;
  quad(g, ox, oy, [[x0, y1, z], [x1, y1, z], [x1, y1, z1], [x0, y1, z1]], shade(color, 0.7));
  quad(g, ox, oy, [[x1, y0, z], [x1, y1, z], [x1, y1, z1], [x1, y0, z1]], shade(color, 0.9));
  quad(g, ox, oy, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], shade(color, 1.15));
}
// Rectángulo pintado sobre una cara +x (para ojos, barba, boca).
const onFace = (g, ox, oy, x, y0, y1, z0, z1, color) => quad(g, ox, oy, [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], color);

// Personajes: miran hacia +x (abajo a la derecha en pantalla). "back" mira hacia -x; el espejo da los otros dos lados.
const DESIGNS = {
  Pc: (g, ox, oy, back, f) => DESIGNS.P(g, ox, oy, back, f, true),
  // Musgoso: cabeza verde pálida, ojos amarillos grandes, hongo rojo arriba, brazos estirados.
  0(g, ox, oy, back, f) {
    const s = f ? 2 : -2, ax = back ? -4 : 4;
    box(g, ox, oy, s, -3, 0, 5, 5, 7, '#4a3524'); box(g, ox, oy, -s, 3, 0, 5, 5, 7, '#4a3524');
    box(g, ox, oy, ax, -7.5, 12, 10, 3.5, 3.5, '#6b5034');
    box(g, ox, oy, 0, 0, 7, 10, 12, 11, '#6b5034');
    box(g, ox, oy, ax, 7.5, 12, 10, 3.5, 3.5, '#6b5034');
    box(g, ox, oy, 0, 0, 18, 14, 14, 13, '#8fae6a');
    if (!back) { onFace(g, ox, oy, 7, -5, -1.5, 24, 28, '#fff35a'); onFace(g, ox, oy, 7, 1.5, 5, 24, 28, '#fff35a'); }
    box(g, ox, oy, -1, -1, 31, 3, 3, 3, '#efe6d0');
    box(g, ox, oy, -1, -1, 34, 10, 10, 3.5, '#d23b30');
  },
  // Cuernudo: túnica violeta, cabeza negra, ojos naranjas, dos cuernos claros.
  1(g, ox, oy, back, f) {
    box(g, ox, oy, f ? 0.7 : -0.7, 0, 0, 12, 14, 18, '#5b2d8a');
    box(g, ox, oy, 0, 0, 18, 13, 13, 12, '#1b1622');
    if (!back) { onFace(g, ox, oy, 6.5, -4.5, -1.5, 23, 26.5, '#ffa31a'); onFace(g, ox, oy, 6.5, 1.5, 4.5, 23, 26.5, '#ffa31a'); }
    box(g, ox, oy, 0, -4.5, 30, 2.6, 2.6, 8, '#e8dcc0'); box(g, ox, oy, 0, 4.5, 30, 2.6, 2.6, 8, '#e8dcc0');
  },
  // Macho cabrío: bruto marrón, hocico claro, ojos rojos, dos cuernos gruesos hacia atrás.
  2(g, ox, oy, back, f) {
    const s = f ? 2.5 : -2.5;
    box(g, ox, oy, s, -4.5, 0, 7, 7, 13, '#3a2618'); box(g, ox, oy, -s, 4.5, 0, 7, 7, 13, '#3a2618');
    box(g, ox, oy, -s / 2, -11, 14, 6, 5, 13, '#7a4f2e');
    box(g, ox, oy, 0, 0, 12, 14, 18, 17, '#7a4f2e');
    box(g, ox, oy, s / 2, 11, 14, 6, 5, 13, '#7a4f2e');
    box(g, ox, oy, 0, 0, 29, 13, 12, 12, '#7a4f2e');
    box(g, ox, oy, back ? -7 : 7, 0, 29, 8, 8, 7, '#a8784c');
    if (!back) { onFace(g, ox, oy, 6.5, -5, -2, 35, 38, '#ff2a1f'); onFace(g, ox, oy, 6.5, 2, 5, 35, 38, '#ff2a1f'); }
    for (const sy of [-1, 1]) { box(g, ox, oy, -1, sy * 5.5, 41, 4, 4, 5, '#e2d6b8'); box(g, ox, oy, -5, sy * 6.5, 44, 6, 3.5, 3.5, '#e2d6b8'); }
  },
  // Diablillo alado: cuerpito rojo, cuernitos negros, alas oscuras que aletean. Vuela (todo va 10 arriba).
  4(g, ox, oy, back, f) {
    const z = 10 + (f ? 1.5 : 0), wz = f ? 4 : -1;
    box(g, ox, oy, -1, -7, z + 6 + wz, 6, 6, 1.5, '#4a1410');
    box(g, ox, oy, 0, 0, z, 7, 8, 7, '#c73a24');
    box(g, ox, oy, 0, 0, z + 7, 9, 9, 8, '#d9472b');
    if (!back) { onFace(g, ox, oy, 4.5, -3, -1, z + 10.5, z + 12.5, '#ffe14a'); onFace(g, ox, oy, 4.5, 1, 3, z + 10.5, z + 12.5, '#ffe14a'); }
    box(g, ox, oy, 0, -3, z + 15, 1.8, 1.8, 3, '#1a0d0b'); box(g, ox, oy, 0, 3, z + 15, 1.8, 1.8, 3, '#1a0d0b');
    box(g, ox, oy, -1, 7, z + 6 + wz, 6, 6, 1.5, '#4a1410');
  },
  // Caballero óseo: armadura de hierro, cráneo, penacho rojo, hacha en la mano.
  5(g, ox, oy, back, f) {
    const s = f ? 2 : -2;
    box(g, ox, oy, s, -3, 0, 3.5, 3.5, 8, '#d8d2c0'); box(g, ox, oy, -s, 3, 0, 3.5, 3.5, 8, '#d8d2c0');
    if (back) { box(g, ox, oy, -5, 8, 10, 1.6, 1.6, 12, '#5a3d24'); box(g, ox, oy, -5, 8, 18, 5, 1.2, 5, '#9aa3ad'); }
    box(g, ox, oy, 0, 0, 8, 10, 12, 11, '#4a4f57');
    box(g, ox, oy, 0, -7, 16, 5, 4, 4, '#5f656e'); box(g, ox, oy, 0, 7, 16, 5, 4, 4, '#5f656e');
    if (!back) { box(g, ox, oy, 5, 8, 10, 1.6, 1.6, 12, '#5a3d24'); box(g, ox, oy, 5, 8, 18, 5, 1.2, 5, '#9aa3ad'); }
    box(g, ox, oy, 0, 0, 19, 11, 11, 10, '#e8e2d0');
    if (!back) { onFace(g, ox, oy, 5.5, -4, -1.2, 23, 26, '#141414'); onFace(g, ox, oy, 5.5, 1.2, 4, 23, 26, '#141414'); onFace(g, ox, oy, 5.5, -2, 2, 20, 21.5, '#141414'); }
    box(g, ox, oy, 0, 0, 29, 11.4, 11.4, 2.5, '#4a4f57');
    box(g, ox, oy, -1, 0, 31.5, 7, 2.5, 4, '#b0201a');
  },
  // Mago (el jugador): gorro puntudo, barba blanca grande y túnica, gorro y túnica del mismo azul.
  // cast: pose de lanzamiento (brazo adelante, vara inclinada hacia donde apunta, cristal encendido).
  P(g, ox, oy, back, f, cast = false) {
    const C = '#3f56d6', s = f ? 1.5 : -1.5, dir = back ? -1 : 1;
    const staff = () => {
      if (!cast) { box(g, ox, oy, 7 * dir, 8, 0, 2.2, 2.2, 31, '#6b4a2a'); box(g, ox, oy, 7 * dir, 8, 31, 5, 5, 5, '#7fe8ff'); return; }
      // Vara vertical levantada por encima del gorro: conjura sin apuntar a ningún lado.
      box(g, ox, oy, 6 * dir, 8, 12, 2.4, 2.4, 36, '#6b4a2a');
      box(g, ox, oy, 6 * dir, 8, 48, 6.5, 6.5, 6.5, '#e8ffff');
    };
    if (back) staff();
    box(g, ox, oy, s, -3, 0, 4, 4, 3, '#24263a'); box(g, ox, oy, -s, 3, 0, 4, 4, 3, '#24263a');
    box(g, ox, oy, -s / 2, -8, 8, 4, 3.5, 9, C);
    box(g, ox, oy, 0, 0, 2, 11, 13, 16, C);
    if (cast) box(g, ox, oy, 4 * dir, 8, 13, 4, 3.5, 12, C);        // brazo levantado sosteniendo la vara
    else box(g, ox, oy, s / 2, 8, 8, 4, 3.5, 9, C);
    if (!back && !cast) staff();
    box(g, ox, oy, 0, 0, 18, 12, 12, 10, '#efc9a4');
    if (!back) {
      box(g, ox, oy, 6, 0, 9, 3, 11, 13, '#f4f4f4');
      onFace(g, ox, oy, 6, -4, -1.5, 24.5, 26.5, '#1a1a1a'); onFace(g, ox, oy, 6, 1.5, 4, 24.5, 26.5, '#1a1a1a');
    } else {
      onFace(g, ox, oy, 6, -6, 6, 20, 27, '#e6e6e6');
    }
    box(g, ox, oy, 0, 0, 28, 19, 19, 2, C);
    box(g, ox, oy, -0.5, -0.5, 30, 11, 11, 6, C);
    box(g, ox, oy, -1.5, -1.5, 36, 7, 7, 6, C);
    box(g, ox, oy, -3, -3, 42, 3.5, 3.5, 5, C);
    if (!back && cast) staff();
  },
  // Rey del Bosque (jefe): túnica de musgo, cabeza de madera clara, ojos verdes, corona de ramas, báculo con esfera.
  3(g, ox, oy, back, f) {
    box(g, ox, oy, f ? 0.6 : -0.6, 0, 0, 15, 17, 20, '#2f6b2a');
    const sx = back ? -2 : 2;
    box(g, ox, oy, sx, 11, 0, 2.5, 2.5, 34, '#5a3d24'); box(g, ox, oy, sx, 11, 34, 6, 6, 6, '#9dffb0');
    box(g, ox, oy, 0, 0, 20, 14, 14, 13, '#d8c39a');
    if (!back) { onFace(g, ox, oy, 7, -5, -1.5, 26, 29.5, '#7dff8a'); onFace(g, ox, oy, 7, 1.5, 5, 26, 29.5, '#7dff8a'); }
    for (const sy of [-1, 1]) {
      box(g, ox, oy, 0, sy * 4.5, 33, 2.2, 2.2, 7, '#6b4a2a');
      box(g, ox, oy, 0, sy * 7.5, 38, 2.2, 5, 2.2, '#6b4a2a');
      box(g, ox, oy, 0, sy * 9.5, 40, 4.5, 4.5, 4, '#5fb03e');
    }
  },
};

// Los sprites se arman a 1,15x y con contorno oscuro: así se leen contra el pasto y en multitudes.
const SC = 1.15, SW = 80, SH = 96, AX = 40, AY = 84;         // medidas en unidades de diseño
const PW = SW * SC, PH = SH * SC, PAX = AX * SC, PAY = AY * SC; // medidas reales del canvas
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// SPR[tipo][back*8 + flip*4 + flash*2 + frame]
const SPR = [];
function buildSprites() {
  const tmp = makeCanvas(PW, PH), tg = tmp.getContext('2d');
  const sil = makeCanvas(PW, PH), sg = sil.getContext('2d');
  for (const type of Object.keys(DESIGNS)) {
    SPR[type] = [];
    for (let back = 0; back < 2; back++) for (let flip = 0; flip < 2; flip++) for (let flash = 0; flash < 2; flash++) for (let fr = 0; fr < 2; fr++) {
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, PW, PH);
      tg.setTransform(flip ? -SC : SC, 0, 0, SC, flip ? PW : 0, 0);
      DESIGNS[type](tg, AX, AY, back, fr);
      tg.setTransform(1, 0, 0, 1, 0, 0);
      if (flash) { tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = 'rgba(255,255,255,.85)'; tg.fillRect(0, 0, PW, PH); }
      // Silueta oscura para el contorno.
      sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, PW, PH); sg.drawImage(tmp, 0, 0);
      sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#0c0e0a'; sg.fillRect(0, 0, PW, PH);
      const c = makeCanvas(PW, PH), g = c.getContext('2d');
      const big = type === '2' || type === '3';
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(PAX, PAY, (big ? 20 : 12) * SC, (big ? 10 : 6) * SC, 0, 0, 6.2832); g.fill();
      for (const [dx, dy] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) g.drawImage(sil, dx, dy);
      g.drawImage(tmp, 0, 0);
      SPR[type][back * 8 + flip * 4 + flash * 2 + fr] = c;
    }
  }
}
// Hacia dónde mira (dirección en el mundo) → qué variante del sprite.
function facing(dx, dy) {
  const sdx = dx - dy, sdy = (dx + dy) / 2;
  return sdy >= 0 ? (sdx < 0 ? 4 : 0) : 8 + (sdx > 0 ? 4 : 0);
}

// Árboles y rocas (3 variantes de cada uno).
const TW = 80, TH = 140, TAX = 40, TAY = 128;
const TREES = [], ROCKS = [];
// Objetos: se pre-renderizan con el mismo contorno oscuro que los personajes.
const OBJ = {};
function outlined(w, h, draw) {
  const tmp = makeCanvas(w, h), tg = tmp.getContext('2d');
  draw(tg);
  const sil = makeCanvas(w, h), sg = sil.getContext('2d');
  sg.drawImage(tmp, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#0c0e0a'; sg.fillRect(0, 0, w, h);
  const c = makeCanvas(w, h), g = c.getContext('2d');
  for (const [dx, dy] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) g.drawImage(sil, dx, dy);
  g.drawImage(tmp, 0, 0);
  return c;
}
// ---------- Efectos en 8 bits ----------
// Proyectiles y explosiones son sprites de píxeles (cada píxel del mapa se dibuja de 2x2 o más), sin
// gradientes ni brillo aditivo. Las estelas son cuadraditos.
const FX_PAL = { W: '#ffffff', L: '#9fd8ff', l: '#4a8cff', d: '#1d3fae', Y: '#fff27a', y: '#ffc23a', O: '#ff9a2a', R: '#e0402a', r: '#8a1a10',
  T: '#7dffd8', t: '#2fa890', G: '#8dff9a', g: '#2fb85a', S: '#c3cbd4', s: '#6b737c', B: '#5a3d24', K: '#3a332d', N: '#cfe6f5', I: '#e8f8ff', i: '#8fd6ff' };
function pixCanvas(rows, scale = 2) {
  const h = rows.length, w = rows[0].length, c = makeCanvas(w * scale, h * scale), g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = FX_PAL[ch]; g.fillRect(x * scale, y * scale, scale, scale); } }));
  return c;
}
const FX = {};
function buildFx() {
  const P2 = (rows) => pixCanvas(rows, 2);
  FX.bolt = [P2(['..L..', '.LWL.', 'LWWWL', '.LWL.', '..L..']), P2(['.....', '.LWL.', '.WWW.', '.LWL.', '.....'])];
  FX.spark = [P2(['.y.', 'yYy', '.y.']), P2(['O.O', '.Y.', 'O.O'])];
  FX.zap = [P2(['YW', 'WY']), P2(['WY', 'YW'])];
  FX.totem = [P2(['.T.', 'TWT', '.T.']), P2(['tTt', 'TWT', 'tTt'])];
  FX.wisp = [P2(['.gg.', 'gGGg', 'gGWG', '.gG.']), P2(['.g..', 'gGGg', 'GWGg', '.gg.'])];
  FX.axe = [P2(['...SS.', '..SSSS', '.BBSS.', 'BB..S.', 'B.....', '......']), P2(['B.....', 'BB....', '.BB...', '..BSS.', '..SSSS', '...SS.'])];
  FX.fireball = [P2(['..OO..', '.OYYO.', 'OYWWYO', 'OYWWYO', '.OYYO.', '..OO..']), P2(['.O..O.', 'OOYYOO', '.YWWY.', '.YWWYO', 'OOYYO.', '.O.O..'])];
  FX.flask = [P2(['.B.', '.N.', 'RRR', 'ROR', 'RRR'])];
  FX.meteor = [P2(['.KK.', 'KOKK', 'KKRK', '.KK.'])];
  FX.shard = [P2(['I', 'i', 'I', 'i'])];
  FX.circle = [P2(['...LLL...', '.LL...LL.', '.L.....L.', 'L...W...L', 'L..WWW..L', 'L...W...L', '.L.....L.', '.LL...LL.', '...LLL...']),
               P2(['...lLl...', '.l.....l.', '.L..W..L.', 'l...W...l', 'L.WWWWW.L', 'l...W...l', '.L..W..L.', '.l.....l.', '...lLl...'])];
  FX.star = [P2(['...L...', '...W...', '..LWL..', 'LWWWWWL', '..LWL..', '...W...', '...L...']), P2(['L.....L', '.L.W.L.', '..WWW..', '.WWWWW.', '..WWW..', '.L.W.L.', 'L.....L'])];
  // Explosiones: 6 cuadros por tipo, una grilla de 4 px por píxel con bandas de color y ruido.
  const ring = (cols) => {
    const frames = [];
    for (let f = 0; f < 6; f++) {
      const N = 32, c = makeCanvas(N * 4, N * 4), g = c.getContext('2d'), k = (f + 1) / 6, R = N / 2;
      let seed2 = 7 + f * 31;
      const rr = () => ((seed2 = (seed2 * 1103515245 + 12345) >>> 0) / 4294967296);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R + (rr() - 0.5) * 0.18;
        const outer = 0.35 + 0.65 * k, inner = Math.max(0, k * 1.1 - 0.35);
        if (d > outer || d < inner) continue;
        const band = (d - inner) / Math.max(0.01, outer - inner);
        const col = f >= 4 ? cols[4] : band < 0.25 ? cols[0] : band < 0.5 ? cols[1] : band < 0.8 ? cols[2] : cols[3];
        g.fillStyle = col; g.fillRect(x * 4, y * 4, 4, 4);
      }
      frames.push(c);
    }
    return frames;
  };
  FX.boom = ring(['#ffffff', '#fff27a', '#ff9a2a', '#e0402a', '#4a3a30']);
  FX.ice = ring(['#ffffff', '#e8f8ff', '#8fd6ff', '#4a8cff', '#c9d6e0']);
}
const BSPR = ['bolt', 'spark', 'bolt', 'zap', 'totem'];   // sprite por color de proyectil
const fxDraw = (spr, x, y) => ctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
const blink = (speed = 12, salt = 0) => ((animT * speed + salt) | 0) & 1;

const GLOW = {};
function glow(color) {
  if (GLOW[color]) return GLOW[color];
  const c = makeCanvas(32, 32), g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (GLOW[color] = c);
}
function buildObjects() {
  const O = (w, h, ax, ay, draw) => ({ c: outlined(w, h, (g) => draw(g, ax, ay)), ax, ay });
  // Poción de maná: frasco azul, cuello de vidrio y corcho.
  OBJ.chest = O(36, 44, 18, 36, (g, x, y) => {
    box(g, x, y, 0, 0, 0, 9, 9, 9, '#2f62e8');
    onFace(g, x, y, 4.5, -3, -1, 4, 8, '#8fb8ff');
    box(g, x, y, 0, 0, 9, 4, 4, 5, '#cfe6f5');
    box(g, x, y, 0, 0, 14, 4.6, 4.6, 2.5, '#8a5a2b');
  });
  // Poción de vida: frasco rojo, cuello de vidrio y corcho.
  OBJ.potion = O(36, 44, 18, 36, (g, x, y) => {
    box(g, x, y, 0, 0, 0, 9, 9, 9, '#d6283a');
    onFace(g, x, y, 4.5, -3, -1, 4, 8, '#ff8a96');
    box(g, x, y, 0, 0, 9, 4, 4, 5, '#cfe6f5');
    box(g, x, y, 0, 0, 14, 4.6, 4.6, 2.5, '#8a5a2b');
  });
  // Piedra rúnica: losa parada con una runa tallada que brilla.
  OBJ.rune = O(40, 52, 20, 42, (g, x, y) => {
    box(g, x, y, 0, 0, 0, 7, 13, 19, '#7d828a');
    box(g, x, y, 0, 0, 19, 5, 11, 2, '#8d939b');
    onFace(g, x, y, 3.5, -0.7, 0.7, 4, 16, '#ff6a3a');
    onFace(g, x, y, 3.5, -4, 0.7, 13, 14.4, '#ff6a3a'); onFace(g, x, y, 3.5, -0.7, 4, 7, 8.4, '#ff6a3a');
    box(g, x, y, 0, 0, 0, 11, 15, 1.5, '#5b5f66');
  });
  // Muro de piedra: dos hiladas de bloques trabados.
  const wall = (worn) => (g, x, y) => {
    const a = worn ? '#5d6066' : '#8a8e96', b = worn ? '#51545a' : '#797d85';
    box(g, x, y, -5.5, -5.5, 0, 10.5, 10.5, 8, a); box(g, x, y, 5.5, -5.5, 0, 10.5, 10.5, 8, b);
    box(g, x, y, -5.5, 5.5, 0, 10.5, 10.5, 8, b); box(g, x, y, 5.5, 5.5, 0, 10.5, 10.5, 8, a);
    box(g, x, y, 0, -5.5, 8, 21, 10.5, 7, b); box(g, x, y, 0, 5.5, 8, 21, 10.5, 7, a);
    if (worn) { onFace(g, x, y, 11, 2, 6, 9, 13, '#3d3f43'); }
  };
  OBJ.wall = O(60, 52, 30, 38, wall(false));
  OBJ.wallWorn = O(60, 52, 30, 38, wall(true));
  // Tótem arcano: base y pilar de piedra con runas; el cristal flota aparte.
  OBJ.totem = O(40, 56, 20, 46, (g, x, y) => {
    box(g, x, y, 0, 0, 0, 11, 11, 4, '#4d525c');
    box(g, x, y, 0, 0, 4, 7.5, 7.5, 14, '#6d7380');
    onFace(g, x, y, 3.75, -1, 1, 7, 15, '#7dffd8');
    box(g, x, y, 0, 0, 18, 9, 9, 1.8, '#5a606b');
  });
  // Altar de meteoros: piedra baja con una cuba encendida.
  OBJ.altar = O(52, 44, 26, 32, (g, x, y) => {
    box(g, x, y, 0, 0, 0, 17, 17, 5, '#5a5048');
    box(g, x, y, 0, 0, 5, 13, 13, 3, '#6e6359');
    box(g, x, y, 0, 0, 8, 8, 8, 1, '#ff6a2a');
  });
}

function buildScenery() {
  const pine = (g) => {
    box(g, TAX, TAY, 0, 0, 0, 6, 6, 14, '#5a3d24');
    box(g, TAX, TAY, 0, 0, 12, 24, 24, 12, '#2f5d2a'); box(g, TAX, TAY, 0, 0, 24, 18, 18, 11, '#386b2f');
    box(g, TAX, TAY, 0, 0, 35, 12, 12, 10, '#43793a'); box(g, TAX, TAY, 0, 0, 45, 5, 5, 6, '#4f8a41');
  };
  const oak = (g) => {
    box(g, TAX, TAY, 0, 0, 0, 7, 7, 22, '#634328');
    box(g, TAX, TAY, 0, 0, 20, 28, 28, 18, '#3b6e2e'); box(g, TAX, TAY, 2, -2, 38, 18, 18, 7, '#4a8236');
  };
  const birch = (g) => {
    box(g, TAX, TAY, 0, 0, 0, 5, 5, 26, '#d9d4c7');
    box(g, TAX, TAY, 0, 0, 8, 5.2, 5.2, 1.5, '#2b2b2b'); box(g, TAX, TAY, 0, 0, 17, 5.2, 5.2, 1.5, '#2b2b2b');
    box(g, TAX, TAY, 0, 0, 24, 20, 20, 14, '#7a9a3a'); box(g, TAX, TAY, 0, 0, 38, 12, 12, 6, '#8fb04a');
  };
  for (const draw of [pine, oak, birch]) {
    for (const alpha of [1, 0.35]) {
      const c = makeCanvas(TW, TH), g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(TAX, TAY, 22, 11, 0, 0, 6.2832); g.fill();
      g.globalAlpha = alpha; draw(g);
      TREES.push(c);
    }
  }
  for (let v = 0; v < 3; v++) {
    const c = makeCanvas(TW, 60), g = c.getContext('2d');
    box(g, TAX, 48, 0, 0, 0, 16 + v * 2, 14, 8 + v, '#7a7d80');
    box(g, TAX, 48, 2 - v, -2, 8 + v, 9, 8, 4, '#8d9094');
    box(g, TAX, 48, -5, 5, 0, 5, 5, 3, '#6b6e70');
    ROCKS.push(c);
  }
}

// Orden por profundidad: cubetas por (x + y), de atrás hacia adelante. Lineal, sin ordenar.
const DK = T / 2, NBK = Math.ceil((WW + WH) / DK) + 4;
const headE = new Int32Array(NBK), nextE = new Int32Array(ME);
const scenery = [];   // por cubeta: casilleros con árbol o roca
function indexScenery() {
  for (let k = 0; k < NBK; k++) scenery[k] = [];
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const i = ty * MW + tx;
    if (map[i] === 1 || map[i] === 2) scenery[Math.floor((tx + ty + 1) * T / DK)].push(i);
  }
}
const depth = (x, y) => Math.min(NBK - 1, Math.max(0, Math.floor((x + y) / DK)));

let animT = 0;
function render() {
  animT += 1 / 60;
  const pxs = isoX(player.x, player.y), pys = isoY(player.x, player.y);
  const VW = W / ZOOM, VH = H / ZOOM;   // lo que entra en pantalla, en píxeles del mundo
  camX = Math.round(Math.min(Math.max(pxs - VW / 2, 0), Math.max(0, floor.width - VW)));
  camY = Math.round(Math.min(Math.max(pys - VH / 2 - 14, -40), Math.max(0, floor.height - VH)));
  ctx.fillStyle = '#10140d'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.setTransform(ZOOM, 0, 0, ZOOM, -camX * ZOOM, -camY * ZOOM);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(floor, 0, 0);

  const x0 = camX - 60, x1 = camX + VW + 60, y0 = camY - 20, y1 = camY + VH + 140;
  headE.fill(-1);
  for (let i = 0; i < nE; i++) {
    const sx = isoX(ex[i], ey[i]), sy = isoY(ex[i], ey[i]);
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
    const k = depth(ex[i], ey[i]);
    nextE[i] = headE[k]; headE[k] = i;
  }
  const objs = [];
  const addObj = (x, y, draw) => { const k = depth(x, y); (objs[k] || (objs[k] = [])).push(draw); };
  for (const cr of crates) if (cr.life > 4 || ((animT * 8) | 0) & 1) addObj(cr.x, cr.y, () => {
    const o = cr.kind ? OBJ.potion : OBJ.chest, bob = blink(3, cr.x) * 2;
    ctx.drawImage(o.c, isoX(cr.x, cr.y) - o.ax, isoY(cr.x, cr.y) - o.ay + bob);
  });
  for (const t of barricades) {
    const x = (t % MW + 0.5) * T, y = (((t / MW) | 0) + 0.5) * T;
    addObj(x, y, () => {
      const o = bhp[t] < 50 ? OBJ.wallWorn : OBJ.wall;
      ctx.drawImage(o.c, isoX(x, y) - o.ax, isoY(x, y) - o.ay);
    });
  }
  for (const tu of turrets) addObj(tu.x, tu.y, () => {
    const sx = isoX(tu.x, tu.y), sy = isoY(tu.x, tu.y), fh = tu.hp / tu.maxHp;
    ctx.fillStyle = '#000'; ctx.fillRect(sx - 11, sy - 29, 22, 5);
    ctx.fillStyle = fh < 0.35 ? '#e5534b' : '#5fbf3a'; ctx.fillRect(sx - 10, sy - 28, 20 * fh, 3);
    if (tu.kind === 0) {
      ctx.drawImage(OBJ.totem.c, sx - OBJ.totem.ax, sy - OBJ.totem.ay);
      box(ctx, sx, sy, 0, 0, 23 + Math.sin(animT * 4) * 1.5, 5, 5, 5, '#7dffd8');
    } else {
      ctx.drawImage(OBJ.altar.c, sx - OBJ.altar.ax, sy - OBJ.altar.ay);
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(animT * 5); ctx.fillStyle = '#ff8a3a';
      ctx.fillRect(sx - 4, sy - 22, 8, 12); ctx.globalAlpha = 1;
    }
  });
  for (const b of barrels) addObj(b.x, b.y, () => {
    const sx = isoX(b.x, b.y), sy = isoY(b.x, b.y);
    // Rombo de píxeles en el piso: tenue mientras se arma, titila cuando está lista.
    ctx.fillStyle = b.arm > 0 ? '#5a2a1a' : blink(6, b.x) ? '#ff5a3a' : '#b8321e';
    for (let r = 0; r < 4; r++) { const w2 = (4 - r) * 8; ctx.fillRect(Math.round(sx - w2 / 2), Math.round(sy - 2 - r * 2), w2, 2); ctx.fillRect(Math.round(sx - w2 / 2), Math.round(sy + r * 2), w2, 2); }
    ctx.drawImage(OBJ.rune.c, sx - OBJ.rune.ax, sy - OBJ.rune.ay);
  });
  const pk = depth(player.x, player.y);
  addObj(player.x, player.y, () => {
    const a = player.aim, fr = player.moving ? ((animT * 7) | 0) & 1 : 0;
    const casting = player.castT > 0, fc = facing(Math.cos(a), Math.sin(a));
    const spr = (casting ? SPR.Pc : SPR.P)[fc + (player.hurt > 0.15 ? 2 : 0) + fr];
    ctx.drawImage(spr, pxs - PAX, pys - PAY);
    if (casting) {
      // Círculo mágico en el pecho (de ahí sale el hechizo) y chispa en el cristal levantado.
      const back = fc >= 8, flip = (fc & 4) !== 0;
      ctx.imageSmoothingEnabled = false;
      fxDraw(FX.circle[blink(16)], pxs, pys - GUN_Z);
      const [ox2, oy2] = P(back ? -6 : 6, 8, 51);
      fxDraw(FX.spark[blink(18)], pxs + (flip ? -ox2 : ox2) * SC, pys + oy2 * SC);
      ctx.globalCompositeOperation = 'source-over';
    }
  });

  for (let k = 0; k < NBK; k++) {
    for (const i of scenery[k]) {
      const tx = i % MW, ty = (i / MW) | 0, wx = (tx + 0.5) * T, wy = (ty + 0.5) * T;
      const sx = isoX(wx, wy), sy = isoY(wx, wy);
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
      if (map[i] === 2) { ctx.drawImage(ROCKS[variant[i]], sx - TAX, sy - 48); continue; }
      // Un árbol que tapa al jugador se ve transparente.
      const covers = k > pk && Math.abs(sx - pxs) < 36 && sy > pys && sy - 110 < pys;
      ctx.drawImage(TREES[variant[i] * 2 + (covers ? 1 : 0)], sx - TAX, sy - TAY);
    }
    if (objs[k]) for (const draw of objs[k]) draw();
    for (let i = headE[k]; i !== -1; i = nextE[i]) {
      const t = et[i], dx = player.x - ex[i], dy = player.y - ey[i];
      const fr = ((animT * 5 + i * 0.37) | 0) & 1;
      if (t === 3) ctx.drawImage(SPR[3][facing(dx, dy) + (efl[i] > 0 ? 2 : 0) + fr], isoX(ex[i], ey[i]) - PAX * 1.6, isoY(ex[i], ey[i]) - PAY * 1.6, PW * 1.6, PH * 1.6);
      else if (t === 2 && ewu[i] > 0) {
        // Preparando la embestida: tiembla, titila y le sale un signo de alerta.
        const sx = isoX(ex[i], ey[i]) + (((animT * 30) | 0) & 1 ? 1 : -1), sy = isoY(ex[i], ey[i]);
        ctx.drawImage(SPR[t][facing(dx, dy) + (((animT * 12) | 0) & 1 ? 2 : 0)], sx - PAX, sy - PAY);
        ctx.fillStyle = '#000'; ctx.fillRect(sx - 2, sy - PAY - 12, 5, 9); ctx.fillRect(sx - 2, sy - PAY - 1, 5, 4);
        ctx.fillStyle = '#ff3a2a'; ctx.fillRect(sx - 1, sy - PAY - 11, 3, 7); ctx.fillRect(sx - 1, sy - PAY, 3, 2);
      }
      else ctx.drawImage(SPR[t][facing(dx, dy) + (efl[i] > 0 ? 2 : 0) + fr], isoX(ex[i], ey[i]) - PAX, isoY(ex[i], ey[i]) - PAY);
    }
  }

  ctx.imageSmoothingEnabled = false;
  // Piedras del macho cabrío: marca roja que titila donde van a caer, y la piedra en arco con su sombra.
  for (const b of boulders) {
    const k = b.t / b.dur, x = b.x0 + (b.x1 - b.x0) * k, y = b.y0 + (b.y1 - b.y0) * k, z = Math.sin(Math.PI * k) * 70 + 14 * (1 - k);
    const tx = Math.round(isoX(b.x1, b.y1)), ty = Math.round(isoY(b.x1, b.y1));
    ctx.fillStyle = ((animT * 10) | 0) & 1 ? '#ff3a2a' : '#8a1a12'; ctx.globalAlpha = 0.35 + 0.5 * k;
    for (let q = 0; q < 16; q++) { const a = q / 16 * 6.2832; ctx.fillRect(Math.round(tx + Math.cos(a) * 32) - 1, Math.round(ty + Math.sin(a) * 16) - 1, 3, 3); }
    ctx.globalAlpha = 1;
    const sx = Math.round(isoX(x, y)), sy = Math.round(isoY(x, y));
    ctx.fillStyle = '#000'; ctx.globalAlpha = 0.3; ctx.fillRect(sx - 5, sy - 2, 10, 4); ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.fillRect(sx - 10, sy - z - 10, 20, 20);
    ctx.fillStyle = '#6b665e'; ctx.fillRect(sx - 8, sy - z - 8, 16, 16);
    ctx.fillStyle = '#8c867b'; ctx.fillRect(sx - 8, sy - z - 8, 10, 6);
    ctx.fillStyle = '#4a4641'; ctx.fillRect(sx + 2, sy - z + 2, 6, 6);
  }
  // Polvo donde cae la piedra: anillo de cuadraditos marrones que se abre.
  for (const q of quakes) {
    const k = q.t / 0.35, tx = isoX(q.x, q.y), ty = isoY(q.x, q.y), rr = 10 + k * 28;
    ctx.fillStyle = '#8a6a44'; ctx.globalAlpha = 1 - k;
    for (let n = 0; n < 12; n++) { const a = n / 12 * 6.2832; ctx.fillRect(Math.round(tx + Math.cos(a) * rr) - 2, Math.round(ty + Math.sin(a) * rr * 0.5) - 2, 4, 4); }
    ctx.globalAlpha = 1;
  }
  // Frascos, meteoros y esquirlas en el aire, con sombra cuadrada en el piso.
  for (const g of throws) {
    const k = g.t / g.dur, x = g.x0 + (g.x1 - g.x0) * k, y = g.y0 + (g.y1 - g.y0) * k;
    const z = g.fall ? g.fall * (1 - k) : Math.sin(Math.PI * k) * g.h + GUN_Z * (1 - k);
    const fade = (1 - k) ** 3, sx = Math.round(isoX(x, y) + (g.vox || 0) * fade), sy = Math.round(isoY(x, y) + (g.voy || 0) * fade);
    ctx.fillStyle = '#000'; ctx.globalAlpha = 0.3; ctx.fillRect(sx - 4, sy - 2, 8, 4); ctx.globalAlpha = 1;
    if (g.ice) {
      for (let q = 1; q <= 3; q++) { ctx.fillStyle = q & 1 ? '#8fd6ff' : '#e8f8ff'; ctx.fillRect(sx - 1, sy - z - 6 - q * 6, 2, 4); }
      fxDraw(FX.shard[0], sx, sy - z);
    } else if (g.fall) {
      for (let q = 1; q <= 4; q++) { ctx.fillStyle = ['#fff27a', '#ff9a2a', '#e0402a', '#4a3a30'][q - 1]; ctx.fillRect(sx - 6 - q * 3, sy - z - 6 - q * 6, 4, 4); }
      fxDraw(FX.meteor[0], sx, sy - z);
    } else fxDraw(FX.flask[0], sx, sy - z);
  }
  // Bola de fuego: sprite de 2 cuadros y estela de cuadraditos que se apagan.
  for (const r of rockets) {
    const sx = isoX(r.x, r.y) + (r.vox || 0), sy = isoY(r.x, r.y) - GUN_Z + (r.voy || 0);
    for (let k = 1; k <= 5; k++) {
      const tx = r.x - r.vx * 0.011 * k, ty = r.y - r.vy * 0.011 * k, sz = 8 - k;
      ctx.fillStyle = ['#fff27a', '#ff9a2a', '#ff9a2a', '#e0402a', '#4a3a30'][k - 1];
      ctx.fillRect(Math.round(isoX(tx, ty) + (r.vox || 0) - sz / 2 + (blink(20, k) ? 1 : -1)), Math.round(isoY(tx, ty) - GUN_Z + (r.voy || 0) - sz / 2), sz, sz);
    }
    fxDraw(FX.fireball[blink(14)], sx, sy);
  }
  // Proyectiles del jugador y del tótem: estela de 2 cuadraditos y la cabeza en pixel art.
  for (let i = 0; i < nB; i++) {
    const c = bc[i], ox3 = bvox[i], oy3 = bvoy[i], sx = isoX(bx[i], by[i]) + ox3, sy = isoY(bx[i], by[i]) - GUN_Z + oy3;
    if (c === 3) {
      // Rayo: cadena quebrada de bloques de 2x2.
      for (let k = 1; k <= 5; k++) {
        const tx = bx[i] - bvx[i] * 0.006 * k, ty = by[i] - bvy[i] * 0.006 * k;
        ctx.fillStyle = k & 1 ? '#fff27a' : '#ffffff';
        ctx.fillRect(Math.round(isoX(tx, ty) + ox3 + ((Math.random() * 3) | 0) * 2 - 2), Math.round(isoY(tx, ty) - GUN_Z + oy3 + ((Math.random() * 3) | 0) * 2 - 2), 2, 2);
      }
    } else {
      for (let k = 1; k <= 2; k++) {
        const tx = bx[i] - bvx[i] * 0.01 * k, ty = by[i] - bvy[i] * 0.01 * k;
        ctx.fillStyle = BCOLORS[c]; ctx.globalAlpha = k === 1 ? 0.8 : 0.45;
        ctx.fillRect(Math.round(isoX(tx, ty) + ox3) - 2, Math.round(isoY(tx, ty) - GUN_Z + oy3) - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    }
    fxDraw(FX[BSPR[c]][blink(16, i)], sx, sy);
  }
  // Proyectiles enemigos: hacha girando, fuego fatuo titilando.
  for (let i = 0; i < nF; i++) {
    const sx = isoX(fx[i], fy[i]), sy = isoY(fx[i], fy[i]) - 18;
    fxDraw(fk[i] ? FX.axe[blink(14, i)] : FX.wisp[blink(10, i)], sx, sy);
  }
  // Explosiones: 6 cuadros de pixel art, achatadas para el piso isométrico.
  for (const b of booms) {
    const k = Math.min(0.999, b.t / 0.4), fr = (b.ice ? FX.ice : FX.boom)[(k * 6) | 0];
    const size = Math.round(((b.R || 85) * 2.4) / 4) * 4, sx = isoX(b.x, b.y), sy = isoY(b.x, b.y) - 10;
    ctx.drawImage(fr, Math.round(sx - size / 2), Math.round(sy - size * 0.3), size, Math.round(size * 0.6 / 4) * 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (player.hurt > 0) { ctx.fillStyle = `rgba(160,0,0,${player.hurt})`; ctx.fillRect(0, 0, W, H); }
  drawHud();
}


let fps = 60, updMs = 0;
// ---------- Interfaz 8 bits ----------
// Todo el texto va en una tipografía pixelada a tamaños múltiplos de 8, sin suavizado.
const PIX = '"Press Start 2P", ui-monospace, monospace';
function text(s, x, y, size, color, align = 'left') {
  // La fuente no tiene vocales acentuadas en mayúscula: se sacan los acentos (la Ñ sí la tiene).
  s = s.normalize('NFD').replace(/([AEIOUaeiou])[\u0300-\u036f]/g, '$1').normalize('NFC');
  size = Math.max(8, Math.round(size / 8) * 8);
  // Títulos (16 px o más) en la letra gótica de piedra; el texto chico sigue en la fuente pixelada para que se lea.
  if (size >= 16) {
    const LC = Math.max(1, Math.round(size / 16)), c = stoneText(s, LC, color);
    const left = align === 'center' ? x - c.width / 2 : align === 'right' ? x - c.width : x;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, Math.round(left), Math.round(y - 13 * LC - 4));
    return;
  }
  ctx.font = `${size}px ${PIX}`;
  ctx.textAlign = align; x = Math.round(x); y = Math.round(y);
  const o = Math.max(2, size / 8);
  ctx.fillStyle = '#000'; ctx.fillText(s, x + o, y + o);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
// Caja con borde de píxel: negro afuera, color adentro, fondo oscuro.
function pixFrame(x, y, w, h, edge, bg = '#120e0a') {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#000'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = edge; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = bg; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
}
// Barra en bloques (vida del jefe, combo).
function pixBar(x, y, w, h, frac, color, empty = '#2a2218') {
  const n = Math.max(1, Math.floor((w - 4) / 8));
  pixFrame(x, y, w, h, '#6b5232', '#000');
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = k < Math.round(frac * n) ? color : empty;
    ctx.fillRect(Math.round(x + 3 + k * 8), Math.round(y + 3), 6, h - 6);
  }
}

// Íconos de hechizos en pixel art de 10x10 (cada letra es un color, '.' es transparente).
const ICON_PAL = { Y: '#ffe14a', W: '#ffffff', B: '#8a5a2b', O: '#ff9a2a', R: '#e0402a', V: '#c08bff', v: '#7a48d8', G: '#8d939b', g: '#5d6066',
  C: '#7dffd8', c: '#2fa890', L: '#9fd8ff', l: '#4a8cff', K: '#3a332d', F: '#ff6a2a', N: '#cfe6f5', D: '#6b4a2a' };
const ICONS = {
  varita: ['.......Y..', '......YWY.', '.......Y..', '......B...', '.....B....', '....B.....', '...B......', '..B.......', '.B........', '..........'], // varita
  chispas: ['O...O...O.', '.O..O..O..', '..O.O.O...', '...OOO....', '....W.....', '....O.....', '....B.....', '....B.....', '....B.....', '..........'], // chispas
  runa: ['...GGGG...', '..GGGGGG..', '..GGRGGG..', '..GGRGGG..', '..GRRRGG..', '..GGRGRG..', '..GGRGGG..', '..GGGGGG..', '.gggggggg.', '..........'], // runa
  frascos: ['....DD....', '....NN....', '....NN....', '...NRRN...', '..RRRRRR..', '..RROORR..', '..RRRRRR..', '..RRRRRR..', '...RRRR...', '..........'], // frascos
  muro: ['..........', 'GGGgGGGgGG', 'GGGgGGGgGG', 'gggggggggg', 'GgGGGgGGGg', 'GgGGGgGGGg', 'gggggggggg', 'GGGgGGGgGG', 'GGGgGGGgGG', 'gggggggggg'], // muro
  rayos: ['.....YY...', '....YY....', '...YY.....', '..YYYYY...', '....YY....', '...YY.....', '..YY......', '.YY.......', '.Y........', '..........'], // rayos
  bola: ['...O..O...', '..O.OO.O..', '...OFFO...', '..OFRRFO..', '.OFRWWRFO.', '.OFRWWRFO.', '..OFRRFO..', '...OFFO...', '....OO....', '..........'], // bola de fuego
  totem: ['....CC....', '...CWWC...', '....CC....', '..........', '...GGGG...', '...GCcG...', '...GGGG...', '...GcCG...', '..gggggg..', '..........'], // tótem
  meteoros: ['O.........', '.O........', '..O.......', '...OO.....', '....FKK...', '....KKKK..', '.....KKK..', '..........', '...gggggg.', '..gggggggg'], // meteoros
  ventisca: ['....L.....', '.L..L..L..', '..L.L.L...', '...LWL....', 'LLLLWLLLL.', '...LWL....', '..L.L.L...', '.L..L..L..', '....L.....', '..........'], // ventisca
};
const ICON_CANVAS = {};
function buildIcons() {
  for (const [k, rows] of Object.entries(ICONS)) for (const dark of [0, 1]) {
    const c = makeCanvas(10, 10), g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = dark ? '#2b2b2b' : ICON_PAL[ch]; g.fillRect(x, y, 1, 1);
    }));
    (ICON_CANVAS[k] || (ICON_CANVAS[k] = []))[dark] = c;
  }
}


// ---------- Pantalla de título: logo gótico de piedra sobre un bosque de noche (estilo Heretic) ----------
// Letras góticas de HORDA en una grilla de 10x15 celdas, con puntas arriba y abajo; cada celda son LC píxeles del logo.
// Alfabeto gótico de piedra: cada letra en una grilla de 15 filas ('X' es piedra); el ancho sale de las columnas usadas.
const blank = (n) => Array(n).fill('');
const mark = (top, rows) => [...blank(top), ...rows, ...blank(15 - top - rows.length)];   // signos que ocupan sólo algunas filas
const STONE_FONT = {
  A: ['....XX....', '...XXXX...', '...XXXX...', '..XXXXXX..', '..XX..XX..', '.XXX..XXX.', '.XX....XX.', 'XXX....XXX', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XX.....XX', '..X......X'],
  B: ['.X........', 'XXXXXXXX..', 'XXXXXXXXX.', 'XXX...XXX.', 'XXX...XXX.', 'XXX..XXX..', 'XXXXXXX...', 'XXXXXXXX..', 'XXX...XXX.', 'XXX....XXX', 'XXX....XXX', 'XXX...XXX.', 'XXXXXXXXX.', 'XXXXXXXX..', '.X........'],
  C: ['...XXXXX..', '..XXXXXXXX', '.XXX....XX', 'XXX......X', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX......X', '.XXX....XX', '..XXXXXXXX', '...XXXXX..', ''],
  D: ['.X........', 'XXXXXXX...', 'XXXXXXXX..', 'XXX..XXXX.', 'XXX...XXX.', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX...XXX.', 'XXX..XXXX.', 'XXXXXXXX..', 'XXXXXXX...', '.X........'],
  E: ['.X........', 'XXXXXXXXXX', 'XXXXXXXXX.', 'XXX.......', 'XXX.......', 'XXX...X...', 'XXXXXXXX..', 'XXXXXXXX..', 'XXX...X...', 'XXX.......', 'XXX.......', 'XXX.......', 'XXXXXXXXX.', 'XXXXXXXXXX', '.X........'],
  F: ['.X........', 'XXXXXXXXXX', 'XXXXXXXXX.', 'XXX.......', 'XXX.......', 'XXX...X...', 'XXXXXXXX..', 'XXXXXXXX..', 'XXX...X...', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', '.XX.......', '..X.......'],
  G: ['...XXXXX..', '..XXXXXXXX', '.XXX....XX', 'XXX......X', 'XXX.......', 'XXX.......', 'XXX..XXXXX', 'XXX..XXXXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XXX..XXXX', '..XXXXXXXX', '...XXXX.XX', '........X.'],
  H: ['.X......X.', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XX.....XX', '..X......X'],
  I: ['.X.', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', '.XX', '..X'],
  J: ['......X.', '.....XXX', '.....XXX', '.....XXX', '.....XXX', '.....XXX', '.....XXX', '.....XXX', '.....XXX', '.....XXX', 'X....XXX', 'XX...XXX', 'XXXXXXXX', '.XXXXXX.', ''],
  K: ['.X........', 'XXX....XXX', 'XXX...XXX.', 'XXX..XXX..', 'XXX.XXX...', 'XXXXXX....', 'XXXXX.....', 'XXXXXX....', 'XXX.XXX...', 'XXX..XXX..', 'XXX...XXX.', 'XXX....XXX', 'XXX....XXX', '.XX.....XX', '..X......X'],
  L: ['.X........', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX......X', 'XXXXXXXXXX', 'XXXXXXXXXX', '.X........'],
  M: ['.X......X.', 'XXX....XXX', 'XXXX..XXXX', 'XXXXXXXXXX', 'XXX.XX.XXX', 'XXX.XX.XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XX.....XX', '..X......X'],
  N: ['.X......X.', 'XXX....XXX', 'XXXX...XXX', 'XXXXX..XXX', 'XXX.X..XXX', 'XXX.XX.XXX', 'XXX..X.XXX', 'XXX..XXXXX', 'XXX...XXXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XX.....XX', '..X......X'],
  Ñ: ['..XX..X...', '.X..XX....', 'XXX....XXX', 'XXXX...XXX', 'XXXXX..XXX', 'XXX.X..XXX', 'XXX.XX.XXX', 'XXX..X.XXX', 'XXX..XXXXX', 'XXX...XXXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XX.....XX', '..X......X'],
  O: ['...XXXX...', '..XXXXXX..', '.XXX..XXX.', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XXX..XXX.', '..XXXXXX..', '...XXXX...'],
  P: ['.X........', 'XXXXXXXX..', 'XXXXXXXXX.', 'XXX...XXX.', 'XXX....XXX', 'XXX...XXX.', 'XXXXXXXX..', 'XXXXXXX...', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', 'XXX.......', '.XX.......', '..X.......'],
  Q: ['...XXXX...', '..XXXXXX..', '.XXX..XXX.', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX.X..XXX', 'XXX.XX.XXX', '.XXX.XXXX.', '..XXXXXX..', '...XXXXXX.', '.......XXX'],
  R: ['.X........', 'XXXXXXXX..', 'XXXXXXXXX.', 'XXX...XXX.', 'XXX....XXX', 'XXX...XXX.', 'XXXXXXXX..', 'XXXXXXX...', 'XXX.XXX...', 'XXX..XXX..', 'XXX...XXX.', 'XXX...XXX.', 'XXX....XXX', '.XX....XXX', '..X.....XX'],
  S: ['..XXXXX...', '.XXXXXXXX.', 'XXX....XX.', 'XXX.....X.', 'XXX.......', '.XXXX.....', '..XXXXX...', '....XXXX..', '......XXX.', '.......XXX', 'X......XXX', 'XX....XXX.', 'XXXXXXXX..', '.XXXXXX...', ''],
  T: ['X........X', 'XXXXXXXXXX', 'XXXXXXXXXX', 'X..XXX...X', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '....X.....'],
  U: ['.X......X.', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XXX..XXX.', '..XXXXXXX.', '...XXXXXXX', '.........X'],
  V: ['X........X', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', '.XXX..XXX.', '.XXX..XXX.', '.XXX..XXX.', '..XXXXXX..', '..XXXXXX..', '...XXXX...', '...XXXX...', '....XX....', '....XX....', ''],
  W: ['X........X', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX....XXX', 'XXX.XX.XXX', 'XXX.XX.XXX', 'XXX.XX.XXX', 'XXXXXXXXXX', 'XXXXXXXXXX', '.XXX..XXX.', '.XX....XX.', '.X......X.', '', ''],
  X: ['X........X', 'XXX....XXX', '.XXX..XXX.', '.XXX..XXX.', '..XXXXXX..', '...XXXX...', '...XXXX...', '...XXXX...', '..XXXXXX..', '.XXX..XXX.', '.XXX..XXX.', 'XXX....XXX', 'XXX....XXX', 'XX......XX', 'X........X'],
  Y: ['X........X', 'XXX....XXX', 'XXX....XXX', '.XXX..XXX.', '.XXX..XXX.', '..XXXXXX..', '...XXXX...', '...XXXX...', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '...XXX....', '....X.....'],
  Z: ['XXXXXXXXXX', 'XXXXXXXXXX', 'X.....XXX.', '.....XXX..', '.....XXX..', '....XXX...', '...XXX....', '..XXX.....', '..XXX.....', '.XXX......', 'XXX.......', 'XXX......X', 'XXXXXXXXXX', 'XXXXXXXXXX', ''],
  0: ['..XXXX..', '.XXXXXX.', 'XXX..XXX', 'XX....XX', 'XX....XX', 'XX....XX', 'XX....XX', 'XX....XX', 'XX....XX', 'XX....XX', 'XX....XX', 'XXX..XXX', '.XXXXXX.', '..XXXX..', ''],
  1: ['...XX...', '..XXX...', '.XXXX...', 'X.XXX...', '..XXX...', '..XXX...', '..XXX...', '..XXX...', '..XXX...', '..XXX...', '..XXX...', '..XXX...', '.XXXXX..', 'XXXXXXX.', ''],
  2: ['.XXXXX..', 'XXXXXXX.', 'XX...XXX', '.....XXX', '.....XXX', '....XXX.', '...XXX..', '..XXX...', '.XXX....', 'XXX.....', 'XX......', 'XX....X.', 'XXXXXXXX', 'XXXXXXXX', ''],
  3: ['XXXXXXX.', 'XXXXXXXX', '.....XXX', '.....XXX', '....XXX.', '..XXXX..', '..XXXXX.', '.....XXX', '......XX', '......XX', '.....XXX', 'XX..XXXX', 'XXXXXXX.', '.XXXXX..', ''],
  4: ['....XXX.', '...XXXX.', '..XXXXX.', '..XX.XX.', '.XX..XX.', '.XX..XX.', 'XX...XX.', 'XXXXXXXX', 'XXXXXXXX', '.....XX.', '.....XX.', '.....XX.', '....XXXX', '....XXXX', ''],
  5: ['XXXXXXXX', 'XXXXXXXX', 'XX......', 'XX......', 'XXXXXX..', 'XXXXXXX.', '.....XXX', '......XX', '......XX', '......XX', '.....XXX', 'XX..XXXX', 'XXXXXXX.', '.XXXXX..', ''],
  6: ['...XXXX.', '..XXXXX.', '.XXX....', 'XXX.....', 'XX......', 'XXXXXX..', 'XXXXXXX.', 'XXX..XXX', 'XX....XX', 'XX....XX', 'XX....XX', 'XXX..XXX', '.XXXXXX.', '..XXXX..', ''],
  7: ['XXXXXXXX', 'XXXXXXXX', 'XX...XXX', '.....XX.', '....XXX.', '....XX..', '...XXX..', '...XX...', '..XXX...', '..XX....', '..XX....', '..XX....', '.XXXX...', '.XXXX...', ''],
  8: ['..XXXX..', '.XXXXXX.', 'XXX..XXX', 'XX....XX', 'XXX..XXX', '.XXXXXX.', '.XXXXXX.', 'XXX..XXX', 'XX....XX', 'XX....XX', 'XX....XX', 'XXX..XXX', '.XXXXXX.', '..XXXX..', ''],
  9: ['..XXXX..', '.XXXXXX.', 'XXX..XXX', 'XX....XX', 'XX....XX', 'XXX..XXX', '.XXXXXXX', '..XXXXXX', '......XX', '.....XXX', '....XXX.', '...XXX..', '.XXXX...', '.XXX....', ''],
  '.': mark(11, ['XXX', 'XXX', 'XXX']),
  ',': mark(11, ['XXX', 'XXX', '.XX', 'XX.']),
  ':': mark(3, ['XXX', 'XXX', 'XXX', '', '', '', '', '', 'XXX', 'XXX', 'XXX']),
  '·': mark(6, ['XXX', 'XXX', 'XXX']),
  '-': mark(6, ['XXXXXX', 'XXXXXX', 'XXXXXX']),
  '+': mark(3, ['..XXX..', '..XXX..', '..XXX..', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '..XXX..', '..XXX..', '..XXX..']),
  '!': ['XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', '.X.', '', '', 'XXX', 'XXX', 'XXX', ''],
  '¡': ['', 'XXX', 'XXX', 'XXX', '', '', '.X.', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX', 'XXX'],
  '?': ['.XXXXX.', 'XXXXXXX', 'XX...XX', '.....XX', '....XXX', '...XXX.', '..XXX..', '..XXX..', '..XXX..', '', '', '..XXX..', '..XXX..', '..XXX..', ''],
  '/': ['.....XX', '.....XX', '....XX.', '....XX.', '...XX..', '...XX..', '...XX..', '..XX...', '..XX...', '..XX...', '.XX....', '.XX....', 'XX.....', 'XX.....', ''],
  '(': ['..XX', '.XX.', 'XXX.', 'XX..', 'XX..', 'XX..', 'XX..', 'XX..', 'XX..', 'XX..', 'XX..', 'XXX.', '.XX.', '..XX', ''],
  ')': ['XX..', '.XX.', '.XXX', '..XX', '..XX', '..XX', '..XX', '..XX', '..XX', '..XX', '..XX', '.XXX', '.XX.', 'XX..', ''],
  '>': mark(2, ['XX.....', 'XXXX...', '.XXXX..', '...XXXX', '....XXX', '...XXXX', '.XXXX..', 'XXXX...', 'XX.....']),
  '%': ['XXX....XX', 'XXX...XX.', 'XXX...XX.', '.....XX..', '....XX...', '....XX...', '...XX....', '...XX....', '..XX.....', '.XX...XXX', '.XX...XXX', 'XX....XXX', '', '', ''],
};
const GLYPHS = STONE_FONT;
let LOGO = null, FOREST_BG = null;
const hash2 = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
// Pinta una máscara como piedra: degradé gris, bisel con luz arriba a la izquierda, vetas, grietas con musgo y contorno negro.
function stoneArt(mask, w, h, seed) {
  const dist = new Uint8Array(w * h).fill(255), qx = [];
  for (let k = 0; k < w * h; k++) if (!mask[k]) { dist[k] = 0; qx.push(k); }
  for (let n = 0; n < qx.length; n++) {
    const k = qx[n], x = k % w, y = (k / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = ny * w + nx; if (dist[nk] > dist[k] + 1) { dist[nk] = dist[k] + 1; qx.push(nk); }
    }
  }
  // Grietas: caminatas al azar adentro de la piedra.
  const crack = new Uint8Array(w * h);
  for (let c = 0; c < Math.floor(w * h / 900); c++) {
    let x = (hash2(c, seed) * w) | 0, y = (hash2(seed, c) * h) | 0;
    for (let st = 0; st < 26; st++) {
      if (x >= 0 && y >= 0 && x < w && y < h && dist[y * w + x] > 2) crack[y * w + x] = 1;
      x += hash2(c * 7 + st, seed) < 0.5 ? 1 : -1; y += hash2(st, c * 3 + seed) < 0.6 ? 1 : 0;
    }
  }
  const c = makeCanvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, o = k * 4;
    if (!mask[k]) {
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) { near = true; break; } }
      if (near) { d[o] = 8; d[o + 1] = 2; d[o + 2] = 2; d[o + 3] = 255; }
      continue;
    }
    const t = y / h, dd = dist[k];
    let v = 205 - t * 95 + (hash2(x >> 1, (y >> 1) + seed) - 0.5) * 40 + (hash2(x >> 3, (y >> 3) + seed) - 0.5) * 30;
    const up = y > 0 && !mask[k - w], lf = x > 0 && !mask[k - 1], dn = y < h - 1 && !mask[k + w], rt = x < w - 1 && !mask[k + 1];
    if (dd === 1) v = up || lf ? 245 : dn || rt ? 45 : v + 30;
    else if (dd === 2) v += up || lf ? 0 : 18;
    if (((x + y * 2 + seed) % 29 === 0 || (x * 2 - y + seed * 3) % 37 === 0) && dd > 2) v *= 0.55;   // vetas en diagonal
    let r = v, gg = v, b = v * 1.04;
    if (crack[k]) { r = 40; gg = 92; b = 36; }
    const q = 16; d[o] = Math.min(255, Math.round(r / q) * q); d[o + 1] = Math.min(255, Math.round(gg / q) * q); d[o + 2] = Math.min(255, Math.round(b / q) * q); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Texto en piedra: arma la máscara con el alfabeto gótico a LC píxeles por celda y la pinta como piedra.
// El color tiñe la piedra (blanco la deja gris). Se guarda en caché porque los mismos textos se repiten cuadro a cuadro.
const stoneCache = new Map();
function stoneText(str, LC, color) {
  const key = str + '|' + LC + '|' + color;
  let c = stoneCache.get(key);
  if (c) return c;
  const chars = [...str.toUpperCase()].map((ch) => {
    if (ch === ' ') return { w: 5, rows: null };
    const rows = STONE_FONT[ch] || STONE_FONT['?'];
    let a = 99, b = -1;
    rows.forEach((r) => { for (let q = 0; q < r.length; q++) if (r[q] === 'X') { a = Math.min(a, q); b = Math.max(b, q); } });
    return { w: b - a + 1, rows, a };
  });
  const gap = 2, pad = 4, cw = chars.reduce((t, ch) => t + ch.w + gap, -gap);
  const w = Math.max(1, cw * LC + pad * 2), h = 15 * LC + pad * 2, mask = new Uint8Array(w * h);
  let x0 = pad;
  for (const ch of chars) {
    if (ch.rows) ch.rows.forEach((row, r) => { for (let q = ch.a; q < row.length; q++) if (row[q] === 'X')
      for (let yy = 0; yy < LC; yy++) for (let xx = 0; xx < LC; xx++) mask[(pad + r * LC + yy) * w + x0 + (q - ch.a) * LC + xx] = 1; });
    x0 += (ch.w + gap) * LC;
  }
  c = stoneArt(mask, w, h, str.length * 7 + LC);
  if (color && color.toLowerCase() !== '#fff' && color.toLowerCase() !== '#ffffff') {
    const t = makeCanvas(w, h), tg = t.getContext('2d');
    tg.drawImage(c, 0, 0); tg.globalCompositeOperation = 'multiply'; tg.fillStyle = color; tg.fillRect(0, 0, w, h);
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(c, 0, 0);
    c = t;
  }
  if (stoneCache.size > 400) stoneCache.delete(stoneCache.keys().next().value);
  stoneCache.set(key, c);
  return c;
}
function buildLogo() {
  const word = 'HORDA', LC = 5, gap = 6, gw = 10 * LC, gh = 15 * LC;
  const lw = word.length * gw + gap * (word.length - 1) + 8, lh = gh + 8;
  const mask = new Uint8Array(lw * lh);
  [...word].forEach((ch, n) => {
    const x0 = 4 + n * (gw + gap);
    GLYPHS[ch].forEach((row, r) => [...row].forEach((v, q) => {
      if (v !== 'X') return;
      for (let yy = 0; yy < LC; yy++) for (let xx = 0; xx < LC; xx++) mask[(4 + r * LC + yy) * lw + x0 + q * LC + xx] = 1;
    }));
  });
  // Las puntas sueltas de una celda se afinan en diagonal para que corten como en las letras góticas.
  LOGO = stoneArt(mask, lw, lh, 3);
  // Bosque de noche: niebla verde azulada con ruido en varias escalas, luz de luna arriba y tres filas de pinos en silueta.
  const RW = 240, RH = 135, sky = makeCanvas(RW, RH), sg = sky.getContext('2d'), si = sg.createImageData(RW, RH);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), cc = hash2(xi, yi + 1), dd = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + dd) * u * v;
  };
  const MIST = [[3, 6, 8], [6, 14, 16], [10, 24, 26], [16, 36, 38], [24, 52, 52], [36, 72, 70], [56, 98, 92], [86, 130, 120]];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const put = (x, y, c) => { const o = (y * RW + x) * 4; si.data[o] = c[0]; si.data[o + 1] = c[1]; si.data[o + 2] = c[2]; si.data[o + 3] = 255; };
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    const n = noise(x / 30, y / 16) * 0.55 + noise(x / 12 + 9, y / 7) * 0.3 + noise(x / 5 + 3, y / 4) * 0.15;
    const vx = (x - RW / 2) / (RW / 2), vy = (y - RH * 0.3) / (RH * 0.8), vig = Math.max(0, 1 - (vx * vx * 0.7 + vy * vy));
    const val = Math.min(0.999, Math.max(0, n * 1.1 * vig + 0.04)), t = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
    put(x, y, MIST[Math.min(MIST.length - 1, Math.floor(val * (MIST.length - 1) + t))]);
  }
  // Pinos: cada fila más oscura y más grande, del fondo al frente.
  const ROWS = [{ base: 92, h: 30, col: [14, 30, 30], n: 26 }, { base: 108, h: 42, col: [7, 17, 17], n: 18 }, { base: 128, h: 58, col: [2, 6, 6], n: 12 }];
  ROWS.forEach((row, ri) => {
    for (let k = 0; k < row.n; k++) {
      const cx = Math.round((k + hash2(k, ri) * 0.8) * RW / row.n - 6), hh = row.h * (0.7 + hash2(ri, k) * 0.5), top = row.base - hh;
      for (let y = Math.max(0, Math.floor(top)); y < RH; y++) {
        const f = (y - top) / hh, tier = (f * 4) % 1, half = Math.round((y < row.base ? (0.25 + f * 0.75) * (0.55 + tier * 0.45) : 0.12) * hh * 0.32);
        for (let x = cx - half; x <= cx + half; x++) if (x >= 0 && x < RW) put(x, y, row.col);
      }
    }
    for (let y = row.base; y < RH; y++) for (let x = 0; x < RW; x++) put(x, y, row.col);   // suelo de la fila
  });
  sg.putImageData(si, 0, 0);
  FOREST_BG = sky;
}
// Luciérnagas que flotan sobre el bosque (en coordenadas de la imagen de fondo).
const FIREFLIES = Array.from({ length: 46 }, (_, k) => ({ x: hash2(k, 1) * 240, y: 50 + hash2(k, 2) * 80, p: hash2(k, 3) * 6.28, s: 0.4 + hash2(k, 4) }));


// ---------- Adornos de piedra de la interfaz (pixel art propio) ----------
const ORN_PAL = { a: '#2a2724', b: '#4a4641', c: '#6b665e', d: '#8c867b', e: '#aaa395', r: '#ff4a3a', l: '#7fb4ff', t: '#7dffd8', o: '#ff8a3a' };
// Columna con runas talladas que brillan.
const PILLAR = [
  '.bbbbbb.', 'bddddddb', 'bcccccca', '.cdddda.', '.cdXdda.', '.cXXXda.', '.cdXdda.', '.cdddda.',
  '.cddXda.', '.cdXXda.', '.cddXda.', '.cdddda.', '.cdXdda.', '.cdXXda.', '.cdddda.', 'bcccccca', 'bddddddb', 'aaaaaaaa',
];
const ORN = {};
function buildOrnaments() {
  const make = (rows, eye, scale) => {
    const c = makeCanvas(rows[0].length * scale, rows.length * scale), g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = ch === 'X' ? eye : ORN_PAL[ch]; g.fillRect(x * scale, y * scale, scale, scale);
    }));
    return c;
  };
  ORN.pillar = make(PILLAR, ORN_PAL.t, 3);
}
// Losa de ladrillos de piedra en píxeles (fondo de la barra de hechizos).
function stoneSlab(x, y, w, h) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#000'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#4a4641'; ctx.fillRect(x, y, w, h);
  for (let row = 0, yy = y; yy < y + h; row++, yy += 10) {
    const off = row & 1 ? 12 : 0;
    ctx.fillStyle = '#2a2724'; ctx.fillRect(x, yy, w, 2);
    for (let xx = x - off; xx < x + w; xx += 24) if (xx > x) ctx.fillRect(xx, yy, 2, Math.min(10, y + h - yy));
    ctx.fillStyle = '#6b665e'; ctx.fillRect(x, yy + 2, w, 1);
  }
}

// Orbe pixelado: se pinta en una grilla de 28x28 y se agranda sin suavizado.
const ORB_N = 28, orbCv = makeCanvas(ORB_N, ORB_N), orbG = orbCv.getContext('2d');
function orb(cx, cy, R, frac, [hi, mid, lo], label, warn, mark = null) {
  const c = ORB_N / 2, r = c - 2, lvl = Math.round(ORB_N - 2 - frac * (ORB_N - 4)), mk = mark === null ? -1 : Math.round(ORB_N - 2 - mark * (ORB_N - 4));
  const wave = ((animT * 4) | 0) % 4;
  orbG.clearRect(0, 0, ORB_N, ORB_N);
  for (let y = 0; y < ORB_N; y++) for (let x = 0; x < ORB_N; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    if (d > r + 2) continue;
    let col;
    if (d > r + 1) col = '#000';
    else if (d > r) col = warn && ((animT * 6) | 0) & 1 ? '#e5534b' : '#c9a463';
    else if (y === mk) col = '#ffffff';
    else if (y > lvl + 1 || (y === lvl + 1)) col = y > ORB_N - 8 ? lo : mid;
    else if (y === lvl) col = (x + wave) % 4 === 0 ? mid : hi;
    else col = '#0b0b12';
    if (d <= r && x > c - 7 && x < c - 3 && y > c - 8 && y < c - 5) col = 'rgba(255,255,255,.55)';
    orbG.fillStyle = col; orbG.fillRect(x, y, 1, 1);
  }
  const S = Math.max(2, Math.round((R * 2) / ORB_N)), size = S * ORB_N;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(orbCv, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  text(label, cx, cy + size / 2 + 14, 8, '#e8e0d0', 'center');
}

// Barra de hechizos: casillas con marco de píxel, ícono, tecla y costo.
function spellBar(R) {
  const n = slots.length, avail = W - 2 * (2 * R + 60), sw = Math.max(40, Math.min(56, Math.floor(avail / n) - 6));
  const sh = 54, total = n * (sw + 6) - 6, x0 = Math.round((W - total) / 2), y0 = Math.round(H - R - 26 - sh / 2);   // centrada con los orbes
  ctx.imageSmoothingEnabled = false;
  stoneSlab(x0 - 14, y0 - 10, total + 28, sh + 20);
  const py = y0 + sh + 10 - ORN.pillar.height;
  // Botón del árbol de habilidades, pegado a la columna derecha; titila si hay puntos para gastar.
  Object.assign(treeBtn, { x: x0 + total + 12 + ORN.pillar.width + 8, y: y0, w: 54, h: sh });
  const th = inBox(treeBtn), glow = points && ((animT * 3) | 0) & 1;
  pixFrame(treeBtn.x, treeBtn.y, treeBtn.w, treeBtn.h, th || glow ? '#ffd23f' : '#b98cff', th ? '#2a2210' : '#120e0a');
  // Símbolo: tres runas unidas por ramas (un nodo arriba que se abre en dos).
  const TREE_ICON = ['...oo...', '...oo...', '...ll...', '..llll..', '.l....l.', 'oo....oo', 'oo....oo'];
  const ic = th || glow ? '#ffd23f' : '#b98cff', isx = treeBtn.x + (treeBtn.w - 8 * 4) / 2, isy = y0 + 8;
  TREE_ICON.forEach((row, yy) => [...row].forEach((ch, xx) => {
    if (ch === '.') return;
    ctx.fillStyle = ch === 'o' ? ic : '#6b5232'; ctx.fillRect(isx + xx * 4, isy + yy * 4, 4, 4);
  }));
  text(points ? '+' + points : 'T', treeBtn.x + treeBtn.w / 2, y0 + sh - 8, 8, points ? '#ffd23f' : '#888', 'center');
  ctx.drawImage(ORN.pillar, x0 - 14 - ORN.pillar.width + 2, py);
  ctx.drawImage(ORN.pillar, x0 + total + 12, py);
  for (let k = 0; k < n; k++) {
    const w = slots[k], x = x0 + k * (sw + 6), sel = w >= 0 && w === player.weapon;
    pixFrame(x, y0, sw, sh, sel ? '#ffd23f' : w >= 0 ? '#6b5232' : '#2a2a2a', sel ? '#2a2210' : '#120e0a');
    text(String(k + 1), x + 4, y0 + 12, 8, w >= 0 ? '#c9a463' : '#555');
    if (w < 0) continue;
    const W_ = WEAPONS[w], isz = 30;
    ctx.drawImage(ICON_CANVAS[W_.id][0], x + (sw - isz) / 2, y0 + 6, isz, isz);
    text(W_.cost ? String(W_.cost) : 'LIBRE', x + sw / 2, y0 + sh - 6, 8, player.mana >= W_.cost ? '#7fb4ff' : '#e5534b', 'center');
    if (level[w]) text('+' + level[w], x + sw - 3, y0 + 12, 8, '#ffd23f', 'right');
  }
  text(WEAPONS[player.weapon].name.toUpperCase() + (level[player.weapon] ? '  RANGO ' + level[player.weapon] + '/5' : ''), W / 2, y0 - 34, 8, '#ffd23f', 'center');
  // Experiencia: nivel del mago y barra hasta el próximo.
  const lv = 'NV ' + plevel + (points ? '  +' + points + ' (T)' : ''), bx0 = x0 - 14 + lv.length * 8 + 10;
  text(lv, x0 - 14, y0 - 16, 8, '#b98cff');
  pixBar(bx0, y0 - 26, x0 + total + 14 - bx0, 12, xp / xpNeed(plevel), '#b98cff');
}

// Árbol de habilidades: tres columnas, una por rama, con las filas atadas al nivel del mago.
let treeNodes = [];
const backBtn = { x: 0, y: 0, w: 0, h: 0 };   // botón de volver al juego
const treeBtn = { x: 0, y: 0, w: 0, h: 0 };   // botón del árbol, al lado de la barra de habilidades
const inBox = (r) => mouseX >= r.x && mouseX < r.x + r.w && mouseY >= r.y && mouseY < r.y + r.h;
const treeHit = () => treeNodes.find((r) => mouseX >= r.x && mouseX < r.x + r.w && mouseY >= r.y && mouseY < r.y + r.h);
function treeMenu() {
  ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(0, 0, W, H);
  text('ARBOL DE HABILIDADES', W / 2, 44, 16, '#ffd23f', 'center');
  text(`NIVEL ${plevel}   ${points} ${points === 1 ? 'PUNTO' : 'PUNTOS'}`, W / 2, 68, 8, points ? '#b98cff' : '#888', 'center');
  const cw = Math.min(210, Math.floor((W - 40) / 3) - 16), gap = Math.min(60, (W - 3 * cw) / 4);
  const top = 132, nh = Math.max(64, Math.min(90, Math.floor((H - top - 120) / 4) - 22)), rowH = nh + 22;
  const x0 = (W - 3 * cw - 2 * gap) / 2, hov = treeHit();
  treeNodes = [];
  TREE.forEach((b, bi) => {
    const x = Math.round(x0 + bi * (cw + gap));
    text(b.name, x + cw / 2, top - 10, 8, b.color, 'center');
    b.skills.forEach((id, row) => {
      const w = WIDX[id], y = top + row * rowH, ok = canRank(w) && points > 0, on = unlocked[w], h = hov && hov.idx === w;
      if (row) { ctx.fillStyle = on ? b.color : '#3a3226'; ctx.fillRect(x + cw / 2 - 2, y - 22, 4, 22); }
      pixFrame(x, y, cw, nh, h ? '#ffd23f' : ok ? b.color : on ? '#6b5232' : '#2a2a2a', h ? '#2a2210' : '#120e0a');
      ctx.drawImage(ICON_CANVAS[id][on ? 0 : 1], x + 8, y + 8, 30, 30);
      text(WEAPONS[w].name.toUpperCase(), x + 46, y + 20, 8, on ? '#e8e0d0' : '#777');
      for (let k = 0; k < 5; k++) { ctx.fillStyle = !on ? '#222' : k < level[w] ? '#ffd23f' : '#3a3226'; ctx.fillRect(x + 46 + k * 12, y + 28, 10, 6); }
      const slot = slots.indexOf(w);
      if (slot >= 0) text(String(slot + 1), x + cw - 8, y + 20, 8, '#ffd23f', 'right');
      const next = level[w] >= 5 ? 'MAXIMO' : !on ? 'DESBLOQUEAR' : PERK_CARD[PERKS[id][level[w]]];
      text(next, x + 8, y + nh - 22, 8, ok ? '#7dffd8' : '#666');
      if (level[w] < 5 && !canRank(w)) text(plevel < rankReq(w) ? 'NV ' + rankReq(w) : 'FALTA LA DE ARRIBA', x + 8, y + nh - 8, 8, '#777');
      else if (WEAPONS[w].cost) text('MANA ' + WEAPONS[w].cost, x + 8, y + nh - 8, 8, '#7fb4ff');
      treeNodes.push({ x, y, w: cw, h: nh, idx: w });
    });
  });
  text('MOUSE ENCIMA: DETALLE    CLIC: SUBIR    1-5: PONER EN EL CONTROL    T: VOLVER', W / 2, 92, 8, '#e0dccf', 'center');
  // Botón para volver al juego (o a la pausa, si se abrió desde ahí).
  Object.assign(backBtn, { x: Math.round(W / 2 - 110), y: Math.round(Math.min(top + 4 * rowH + 8, H - 136)), w: 220, h: 40 });
  const bh = inBox(backBtn);
  pixFrame(backBtn.x, backBtn.y, backBtn.w, backBtn.h, bh ? '#ffd23f' : '#6b5232', bh ? '#2a2210' : '#120e0a');
  text(treeFrom === 'pause' ? 'VOLVER' : 'VOLVER AL JUEGO', backBtn.x + backBtn.w / 2, backBtn.y + 25, 8, bh ? '#ffd23f' : '#e8e0d0', 'center');
  if (hov) spellDetail(hov);
}
// Ficha de detalle al lado de la habilidad: stats actuales (y cómo quedan con la próxima mejora) y las 5 mejoras.
function spellDetail(node) {
  const w = node.idx, id = WEAPONS[w].id, on = unlocked[w], L = level[w], row = ROW_LEVEL[NODE[w].row];
  const cur = spellStats(w, L), nxt = on && L < 5 ? spellStats(w, L + 1) : null;
  const pw = 380, ph = 96 + cur.length * 16 + 5 * 30 + 30;
  let x = node.x + node.w + 14; if (x + pw > W - 8) x = node.x - pw - 14; if (x < 8) x = Math.max(8, (W - pw) / 2);
  const y = Math.round(Math.max(8, Math.min(H - ph - 8, node.y)));
  x = Math.round(x);
  pixFrame(x, y, pw, ph, TREE[NODE[w].bi].color, '#0c0a08');
  text(WEAPONS[w].name.toUpperCase(), x + 12, y + 24, 16, '#ffd23f');
  text(on ? `RANGO ${L}/5` : 'BLOQUEADA · NV ' + row, x + pw - 12, y + 22, 8, on ? '#e8e0d0' : '#888', 'right');
  text(DESC[id], x + 12, y + 44, 8, '#9fc48a');
  let yy = y + 70;
  text('STATS', x + 12, yy, 8, '#888'); if (nxt) text('PRÓXIMA', x + pw - 12, yy, 8, '#888', 'right'); yy += 18;
  cur.forEach(([label, v], k) => {
    text(label, x + 12, yy, 8, '#c9b89a');
    const nv = nxt && nxt[k][1] !== v ? nxt[k][1] : null;
    text(v, x + (nv ? 210 : pw - 12), yy, 8, '#e8e0d0', 'right');
    if (nv) text('> ' + nv, x + pw - 12, yy, 8, '#7dffd8', 'right');
    yy += 16;
  });
  yy += 10;
  text('MEJORAS', x + 12, yy, 8, '#888'); yy += 18;
  PERKS[id].forEach((kind, k) => {
    const done = on && k < L, next = on && k === L, req = row + 2 * k;
    const col = done ? '#ffd23f' : next ? '#7dffd8' : '#666';
    ctx.fillStyle = col; ctx.fillRect(x + 12, yy - 8, 8, 8);
    if (!done) { ctx.fillStyle = '#0c0a08'; ctx.fillRect(x + 14, yy - 6, 4, 4); }
    text((k + 1) + '. ' + PERK_CARD[kind], x + 28, yy, 8, col);
    if (!done) text('NV ' + req, x + pw - 12, yy, 8, plevel >= req ? col : '#555', 'right');
    // Qué cambia en las stats con esta mejora (las que entren en una línea).
    const a = spellStats(w, k), b = spellStats(w, k + 1), max = Math.floor((pw - 40) / 8);
    let line = '';
    for (let q = 0; q < a.length; q++) {
      if (a[q][1] === b[q][1]) continue;
      const part = `${a[q][0]} ${a[q][1]}>${b[q][1]}`;
      if ((line ? line.length + 3 : 0) + part.length > max) break;
      line += (line ? '   ' : '') + part;
    }
    text(line, x + 28, yy + 14, 8, done ? '#b09a4a' : next ? '#5fbfa4' : '#555');
    yy += 30;
  });
}

function drawHud() {
  ctx.imageSmoothingEnabled = false;
  if (state === 'menu') {
    // Bosque de noche de fondo, luciérnagas que titilan, el logo de piedra y APRETÁ ENTER.
    ctx.imageSmoothingEnabled = false;
    const ks = Math.max(W / FOREST_BG.width, H / FOREST_BG.height), kx = Math.round((W - FOREST_BG.width * ks) / 2), ky = Math.round((H - FOREST_BG.height * ks) / 2);
    ctx.drawImage(FOREST_BG, kx, ky, Math.round(FOREST_BG.width * ks), Math.round(FOREST_BG.height * ks));
    for (const f of FIREFLIES) {
      const a = Math.sin(animT * 2 * f.s + f.p);
      if (a < 0.1) continue;
      const fx = (f.x + Math.sin(animT * 0.4 * f.s + f.p) * 6 + 240) % 240, fy = f.y + Math.cos(animT * 0.3 * f.s + f.p * 2) * 4;
      const px = kx + Math.round(fx) * ks, py = ky + Math.round(fy) * ks;
      ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#c8ff6a'; ctx.fillRect(Math.round(px - ks), Math.round(py - ks), Math.ceil(ks * 3), Math.ceil(ks * 3));
      ctx.globalAlpha = a; ctx.fillStyle = '#f4ffb0'; ctx.fillRect(Math.round(px), Math.round(py), Math.ceil(ks), Math.ceil(ks));
    }
    ctx.globalAlpha = 1;
    const ls = Math.max(2, Math.floor(Math.min((W - 220) / LOGO.width, (H * 0.36) / LOGO.height))), lx = Math.round((W - LOGO.width * ls) / 2), ly = Math.round(H * 0.2);
    ctx.globalAlpha = 0.7; ctx.filter = 'brightness(0)'; ctx.drawImage(LOGO, lx + ls * 3, ly + ls * 4, LOGO.width * ls, LOGO.height * ls); ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.drawImage(LOGO, lx, ly, LOGO.width * ls, LOGO.height * ls);
    // Embebido en un iframe, el juego no recibe teclas hasta que se le hace clic.
    if (((animT * 2) | 0) & 1) text(document.hasFocus() ? 'APRETA ENTER' : 'HACE CLIC', W / 2, ly + LOGO.height * ls + 80, 24, '#ffd23f', 'center');
    text('ESC: VOLVER A TXT', W / 2, Math.min(H - 24, ly + LOGO.height * ls + 130), 8, '#e0dccf', 'center');
    return;
  }
  text('OLEADA ' + wave, 16, 28, 16, '#fff');
  text('PUNTOS ' + score, 16, 52, 8, '#e0dccf');
  if (combo > 1) {
    text('x' + combo, 16, 84, 24, '#ffd23f');
    pixBar(16, 92, 100, 12, Math.max(0, comboT / 1.3), '#ffd23f');
  }
  const R = Math.min(76, Math.max(48, H * 0.09));
  orb(R + 24, H - R - 26, R, Math.min(1, player.hp / 100), ['#ff6a5a', '#c41e22', '#6a0a0e'], `VIDA ${Math.ceil(Math.min(player.hp, 999))}`, player.hp < 35);
  const wc = WEAPONS[player.weapon].cost;
  orb(W - R - 24, H - R - 26, R, player.mana / MANA_MAX, ['#8fc4ff', '#2f62e8', '#122a7a'], `MANA ${Math.floor(player.mana)}`, player.noMana > 0,
      wc ? Math.max(0, player.mana - wc) / MANA_MAX : null);
  spellBar(R);
  if (showStats) {
    text(`${fps.toFixed(0)} FPS  SIM ${updMs.toFixed(2)}MS`, W - 16, 24, 8, '#9ad', 'right');
    text(`${nE} ENEMIGOS  ${nB} BALAS`, W - 16, 40, 8, '#9ad', 'right');
  }
  for (let i = 0; i < nE; i++) if (et[i] === 3 && ehp[i] > 0) {
    const bw = Math.min(520, W - 80), f = ehp[i] / bossMax;
    text('REY DEL BOSQUE', W / 2, 28, 16, f < 0.5 ? '#ff7a5a' : '#cfe8b0', 'center');
    pixBar((W - bw) / 2, 38, bw, 16, f, f < 0.5 ? '#d6452f' : '#5fbf3a');
    break;
  }
  if (waveT > 0) {
    ctx.globalAlpha = Math.min(1, waveT / 0.5, (2.6 - waveT) / 0.3);
    text('OLEADA ' + wave, W / 2, H / 2 - 110, 48, '#fff', 'center');
    ctx.globalAlpha = 1;
  } else if (bannerT > 0) text(banner.toUpperCase(), W / 2, H / 3, 16, '#fff', 'center');
  if (state === 'tree') treeMenu();
  if (state === 'pause') {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
    text('PAUSA', W / 2, H / 2 - 110, 64, '#fff', 'center');
    text('T  ARBOL DE HABILIDADES     P  SEGUIR     ESC  VOLVER A TXT', W / 2, H / 2 - 54, 8, '#e0dccf', 'center');
  }
  if (state === 'over') {
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, H);
    const top0 = Math.max(70, H / 2 - 250);
    text('TE COMIERON', W / 2, top0, 48, '#ff7a6a', 'center');
    text(`OLEADA ${wave}  ${kills} BAJAS  ${score} PUNTOS`, W / 2, top0 + 40, 8, '#e0dccf', 'center');
    const by = top0 + 100;
    if (board.phase === 'cargando' || board.phase === 'enviando') text(board.phase === 'cargando' ? 'CARGANDO LA TABLA...' : 'GUARDANDO...', W / 2, by, 8, '#888', 'center');
    else if (board.phase === 'error') text(board.aviso || 'NO SE PUDO CONECTAR CON LA TABLA', W / 2, by, 8, '#e5534b', 'center');
    else if (board.phase === 'listo' || board.phase === 'entrar') {
      // La tabla: el ID pseudoanónimo de HORDA de cada cuenta (el propio, resaltado).
      text('MEJORES MAGOS', W / 2, by + 10, 24, '#ffd23f', 'center');
      board.top.forEach((t, k) => {
        const y = by + 46 + k * 22, col = k === board.mine ? '#ffd23f' : '#e0dccf';
        text(String(k + 1) + '.', W / 2 - 150, y, 8, col, 'right');
        text(t.id, W / 2 - 130, y, 8, col);
        text(String(t.puntos), W / 2 + 60, y, 8, col, 'right');
        text('OLEADA ' + t.oleada, W / 2 + 150, y, 8, k === board.mine ? col : '#888', 'right');
      });
      if (!board.top.length) text('TODAVIA NO HAY PUNTAJES', W / 2, by + 50, 8, '#888', 'center');
      if (board.phase === 'listo' && board.mine < 0 && board.puesto > 0) text('TU MEJOR PUNTAJE ESTA EN EL PUESTO ' + board.puesto, W / 2, by + 46 + 10 * 22 + 6, 8, '#ffd23f', 'center');
      if (board.phase === 'entrar') {
        Object.assign(entrarBtn, { x: Math.round(W / 2 - 230), y: Math.round(by + 46 + 10 * 22 - 8), w: 460, h: 40 });
        const hover = inBox(entrarBtn);
        pixFrame(entrarBtn.x, entrarBtn.y, entrarBtn.w, entrarBtn.h, hover ? '#ffd23f' : '#6b5232', hover ? '#2a2210' : '#120e0a');
        text('ENTRA A TXT PARA GUARDAR TU PUNTAJE · E: ENTRAR', W / 2, entrarBtn.y + 25, 8, hover ? '#ffd23f' : '#e8e0d0', 'center');
      }
    }
    if (board.phase !== 'enviando' && ((animT * 2) | 0) & 1) text('APRETA ENTER', W / 2, Math.min(H - 40, by + 330), 24, '#ffd23f', 'center');
    if (board.phase !== 'enviando') text('ESC: VOLVER A TXT', W / 2, Math.min(H - 16, by + 370), 8, '#e0dccf', 'center');
  }
}

// ---------- Bucle (paso fijo de 60 Hz) ----------
const DT = 1 / 60;
let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0;
function frame(now) {
  let el = (now - last) / 1000; last = now;
  if (el > 0.25) el = 0.25;
  fpsAcc += el; fpsN++;
  if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (state === 'play') {
    acc += el;
    let steps = 0;
    const t0 = performance.now();
    while (acc >= DT && steps < 4 && state === 'play') { update(DT); acc -= DT; steps++; }
    if (steps === 4) acc = 0; // si no da abasto, se ralentiza en vez de trabarse en espiral
    if (steps) updMs = updMs * 0.9 + (performance.now() - t0) / steps * 0.1;
  }
  render();
  requestAnimationFrame(frame);
}
buildSprites();
buildScenery();
buildObjects();
buildIcons();
buildFx();
buildOrnaments();
buildLogo();
reset();
// La letra de la interfaz es propia (horda.css): se espera a que cargue antes del primer dibujo, con
// un tope de 3 s para no quedar en negro si falla.
const fuenteLista = document.fonts && document.fonts.load ? document.fonts.load('8px "Press Start 2P"').catch(() => {}) : Promise.resolve();
Promise.race([fuenteLista, new Promise((r) => setTimeout(r, 3000))]).then(() => {
  retomarPendiente();
  last = performance.now();
  requestAnimationFrame(frame);
});
