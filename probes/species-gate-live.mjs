// v0.30 "Species gate" — LIVE execution probe (not a unit test).
// Force-selects mating pairs in a TICKING world and watches what happens:
//   A) tanglekin female x beetle male, adjacent on one platform:
//      she must never court-to-mating — zero eggs, however long she tries.
//   B) tanglekin female x tanglekin male from different detected tribe
//      bands: two phases. Phase 1 (900px apart, beyond mate-sense range):
//      nothing happens — no spooky action at a distance. Phase 2 (he is
//      moved next to her; tribe bands are by homeX, unchanged): courtship,
//      approach, mating, eggs. The gate is species-level, never tribe-level.
// The pairs are force-selected (action locked to 'mate', needs topped up —
// lab conditions); the sense filter, courtship movement, tryMate gate and
// egg-laying are all live code paths.
// Run: node probes/species-gate-live.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { founderPheno } from '../src/sim/species.js';
import { createCreature } from '../src/sim/creature.js';
import { detectTribes } from '../src/sim/social.js';

const seed = parseInt(process.argv[2] || '4242', 10);

function snapToPlatform(world, x) {
  // Find a valid platform near x: the exact x may fall between platforms.
  for (const dx of [0, 60, -60, 140, -140, 260, -260, 420, -420, 700, -700]) {
    const pi = platformIndexAt(world, x + dx, 800);
    if (pi >= 0) {
      const p = world.platforms[pi];
      const cx = Math.min(Math.max(x + dx, p.x1 + 30), p.x2 - 30);
      return { x: cx, pi };
    }
  }
  throw new Error('no platform near x=' + x);
}

function mkAdult(world, skey, sex, x) {
  const { x: sx, pi } = snapToPlatform(world, x);
  const { genome, pheno } = founderPheno(skey, createRng(1000 + Math.round(sx)));
  const c = createCreature(genome, sx, pi, world.rng);
  c.pheno = pheno;
  c.sex = sex;
  c.biochem.age = pheno.lifespanSec * 0.5; // adult
  c.mateCooldown = 0;
  c.homeX = sx;
  world.creatures.push(c);
  return c;
}

// Lab conditions: fed, watered, rested, unafraid, unhurt, locked on the mate action.
// Everything downstream (senses, courtship, tryMate, eggs) runs live.
// v0.32 (Bart's lab-hygiene finding): the lab is SEALED — health and injury
// are topped up too, so a death in the lab can only come from the mechanism
// under test, never from background causes the lab doesn't control.
function labRat(c) {
  c.biochem.hunger = 0;
  c.biochem.energy = 0.95;
  c.biochem.fear = 0;
  c.biochem.illness = 0;
  c.biochem.hydration = 1;
  c.biochem.bloodSugar = 1;
  c.biochem.health = 1; // v0.32: sealed
  c.biochem.injury = 0; // v0.32: sealed
  c.mateCooldown = 0;
  c.action = 'mate';
  c.actionTimer = 1e9;
}

function runScenarioA() {
  const world = bindWorld(createWorld(seed));
  world.creatures.length = 0; // just our pair
  const f = mkAdult(world, 'tanglekin', 'female', 1900);
  const m = mkAdult(world, 'beetle', 'male', 1960);
  const eggs0 = world.eggs.length;
  let courted = false, t = 0;
  for (t = 0; t < 1500; t++) {
    labRat(f); labRat(m);
    if (f.actionLabel === 'courting' || f.actionLabel === 'climbing to a mate') courted = true;
    tickWorld(world, 0.1);
    if (!f.alive || !m.alive) break;
    if (world.eggs.length > eggs0) break; // mated — the gate failed
  }
  return {
    ticks: t, courted, mated: world.eggs.length > eggs0,
    eggs: world.eggs.length - eggs0, fAlive: f.alive, mAlive: m.alive,
  };
}

function runScenarioB() {
  const world = bindWorld(createWorld(seed));
  world.creatures.length = 0;
  const f = mkAdult(world, 'tanglekin', 'female', 1200);
  const m = mkAdult(world, 'tanglekin', 'male', 2100);
  const tribes = detectTribes(world);
  const eggs0 = world.eggs.length;
  let courted = false, t = 0;
  // Phase 1: 900px apart — different tribe bands, beyond mate-sense range.
  for (t = 0; t < 200; t++) {
    labRat(f); labRat(m);
    tickWorld(world, 0.1);
    if (world.eggs.length > eggs0) break;
  }
  const phase1eggs = world.eggs.length - eggs0;
  // Phase 2: bring him into courtship range. homeX (tribe bands) untouched.
  const pf = world.platforms[f.platformIndex];
  m.x = Math.min(f.x + 100, pf.x2 - 40);
  m.platformIndex = f.platformIndex;
  for (; t < 2000; t++) {
    labRat(f); labRat(m);
    if (f.actionLabel === 'courting' || f.actionLabel === 'climbing to a mate') courted = true;
    tickWorld(world, 0.1);
    if (!f.alive || !m.alive) break;
    if (world.eggs.length > eggs0) break;
  }
  return {
    ticks: t, courted, mated: world.eggs.length > eggs0,
    eggs: world.eggs.length - eggs0, phase1eggs,
    tribes: tribes.length, fAlive: f.alive, mAlive: m.alive,
  };
}

console.log('=== v0.30 species-gate LIVE probe, seed', seed, '===');
const A = runScenarioA();
console.log(`A: ticks=${A.ticks} courted=${A.courted} mated=${A.mated} eggs=${A.eggs} fAlive=${A.fAlive} mAlive=${A.mAlive}`);
const B = runScenarioB();
console.log(`B: ticks=${B.ticks} courted=${B.courted} mated=${B.mated} eggs=${B.eggs} phase1eggs=${B.phase1eggs} tribes=${B.tribes} fAlive=${B.fAlive} mAlive=${B.mAlive}`);

let fail = 0;
if (A.mated || A.eggs > 0) { console.log('FAIL A: cross-species mating happened'); fail++; }
else console.log('PASS A: no cross-species mating in', A.ticks, 'ticks of forced courtship');
if (B.phase1eggs > 0) { console.log('FAIL B phase 1: mating at a distance'); fail++; }
if (!B.mated || B.eggs === 0) { console.log('FAIL B phase 2: same-species cross-tribe pair never mated'); fail++; }
else console.log(`PASS B: cross-tribe tanglekins mated after ${B.ticks} ticks, ${B.eggs} egg(s)`);
if (B.tribes < 2) { console.log('WARN B: pair not in distinct tribe bands (tribes=' + B.tribes + ')'); fail++; }
process.exit(fail ? 1 : 0);
