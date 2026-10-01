// v0.18 "Realms" chemistry tests: the survival chemistry (oxygen,
// hydration, coreTemp), the index contract (senses 28–31, actions 17–19),
// the new instinct genes, and the pinSub confound fix.
// Run: node --test test/realms-chem.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GENES, CHEM5, CHEM7, SENSE32, SENSE24, ACT20, ACT13,
  PLANT_REALMS_LOCI, REALMS18_KEYS, EVO17_KEYS, HANDS20_KEYS, FALLING20_KEYS,
  randomGenome, phenotype,
} from '../src/sim/genome.js';
import { createBrain, senseVector, ACTIONS, N_IN } from '../src/sim/brain.js';
import { createBiochem, tickBiochem, isDead, coldSense, heatSense } from '../src/sim/biochem.js';
import { createRng } from '../src/sim/rng.js';

// A founder phenotype with targeted allele overrides (choice alleles are indices).
// An override value is either a single number (both homologs) or an [a, b] pair.
function pheno(seed, overrides = {}) {
  const g = randomGenome(createRng(seed));
  for (const [k, v] of Object.entries(overrides)) {
    g.alleles[k] = Array.isArray(v) ? v : [v, v];
  }
  return phenotype(g);
}
const N_OUT = ACTIONS.length;

test('v0.18: CHEM7 — seven chemicals, old indices keep their meaning', () => {
  assert.equal(CHEM7.length, 7);
  assert.deepEqual(CHEM7.slice(0, 5), CHEM5, '0–4 unchanged');
  assert.equal(CHEM7[5], 'oxygen');
  assert.equal(CHEM7[6], 'hydration');
  // Family R/C/E vocabularies ride the 7-chemical list; founder choices
  // stay on the old indices.
  for (let i = 0; i < 8; i++) {
    const s = GENES.find((g) => g.key === `rx${i}sub`);
    assert.equal(s.choices.length, 7, 'reaction substrates read 7 chemicals');
    assert.ok(s.founder < 5, 'founder substrate keeps old meaning');
  }
  for (let i = 0; i < 6; i++) {
    const c = GENES.find((g) => g.key === `rc${i}chem`);
    assert.equal(c.choices.length, 7, 'receptor chemicals read 7');
    const e = GENES.find((g) => g.key === `em${i}chem`);
    assert.equal(e.choices.length, 7, 'emitter chemicals read 7');
  }
});

test('v0.18: oxygen — ~25s of air submerged, fast refill, drowning at 0', () => {
  const p = pheno(7, { budNeckGrow: 0 }); // no gills: breathTime exactly 30
  assert.equal(p.breathTime, 30, 'founder breathTime 30 — the honest 25s');
  const b = createBiochem();
  assert.equal(b.oxygen, 1);
  for (let t = 0; t < 25; t++) tickBiochem(b, p, 1, { submerged: 1 });
  assert.ok(b.oxygen <= 0.01, `25s submerged ≈ empty, got ${b.oxygen}`);
  // Refill in air is fast.
  for (let t = 0; t < 4; t++) tickBiochem(b, p, 1, {});
  assert.ok(b.oxygen > 0.95, `refills in air, got ${b.oxygen}`);
  // At 0: health drains and adrenaline spikes.
  const d = createBiochem();
  d.oxygen = 0;
  for (let t = 0; t < 10; t++) tickBiochem(d, p, 1, { submerged: 1 });
  assert.ok(d.health < 1, `drowning drains health, got ${d.health}`);
  assert.ok(d.adrenaline > 0.8, `drowning spikes adrenaline, got ${d.adrenaline}`);
});

test('v0.18: hydration — heat×exertion drain, drank restores, dehydration kills', () => {
  const p = pheno(7);
  const hot = createBiochem(); hot.hydration = 0.8;
  const cool = createBiochem(); cool.hydration = 0.8;
  for (let t = 0; t < 10; t++) {
    tickBiochem(hot, p, 1, { heat: 1, active: 1 });
    tickBiochem(cool, p, 1, { heat: 0, active: 0 });
  }
  // hot+sprinting: 0.004 + 0.016×1×1.0 = 0.02/s → 0.8 − 0.2 = 0.6
  assert.ok(Math.abs(hot.hydration - 0.6) < 0.02, `hot+sprint drains fast, got ${hot.hydration}`);
  // cool+resting: 0.004/s → 0.8 − 0.04 = 0.76
  assert.ok(Math.abs(cool.hydration - 0.76) < 0.02, `cool+rest drains slow, got ${cool.hydration}`);
  assert.ok(hot.hydration < cool.hydration - 0.1, 'heat×exertion accelerates drain');
  // drank restores.
  const w = createBiochem(); w.hydration = 0.2;
  tickBiochem(w, p, 1, { drank: 1 });
  assert.ok(Math.abs(w.hydration - 0.5) < 0.02, `drank restores, got ${w.hydration}`);
  // At 0: health drains.
  const d = createBiochem(); d.hydration = 0;
  for (let t = 0; t < 10; t++) tickBiochem(d, p, 1, {});
  assert.ok(d.health < 1, `dehydration drains health, got ${d.health}`);
});

test('v0.18: coreTemp drifts toward ambient — cold cools, warmth warms', () => {
  const p = pheno(7, { fur: [0, 0] }); // no insulation: pure drift
  const warm = createBiochem(); warm.coreTemp = 0.5;
  const cold = createBiochem(); cold.coreTemp = 0.5;
  for (let t = 0; t < 60; t++) {
    tickBiochem(warm, p, 1, { ambientTemp: 0.8, active: 0 });
    tickBiochem(cold, p, 1, { ambientTemp: 0.2, active: 0 });
  }
  assert.ok(warm.coreTemp > 0.6, `drifts up in warmth, got ${warm.coreTemp}`);
  assert.ok(cold.coreTemp < 0.4, `drifts down in cold, got ${cold.coreTemp}`);
  // Submersion chills: same ambient, one submerged.
  const dry = createBiochem(); dry.coreTemp = 0.5;
  const wet = createBiochem(); wet.coreTemp = 0.5;
  for (let t = 0; t < 60; t++) {
    tickBiochem(dry, p, 1, { ambientTemp: 0.5, active: 0 });
    tickBiochem(wet, p, 1, { ambientTemp: 0.5, active: 0, submerged: 1 });
  }
  assert.ok(wet.coreTemp < dry.coreTemp, 'water chills the body');
});

test('v0.18: hypo/hyper thresholds shift with coldTol/heatTol', () => {
  // Hypothermia: coldTol 0 → threshold 0.25; coldTol 1 → 0.15.
  const pCold0 = pheno(7, { coldTol: 0, fur: 0, longAging: 0 });
  const pCold1 = pheno(7, { coldTol: 1, fur: 0, longAging: 0 });
  const a = createBiochem(); a.coreTemp = 0.2; a.health = 1;
  const c = createBiochem(); c.coreTemp = 0.2; c.health = 1;
  tickBiochem(a, pCold0, 1, { ambientTemp: 0.2, active: 0 });
  tickBiochem(c, pCold1, 1, { ambientTemp: 0.2, active: 0 });
  assert.ok(a.health < 1, `coldTol 0: hypothermic at 0.20, health ${a.health}`);
  assert.equal(c.health, 1, `coldTol 1: fine at 0.20, health ${c.health}`);
  // Hyperthermia: heatTol 0 → threshold 0.75; heatTol 1 → 0.85.
  const pHeat0 = pheno(7, { heatTol: 0, fur: 0, longAging: 0 });
  const pHeat1 = pheno(7, { heatTol: 1, fur: 0, longAging: 0 });
  const h = createBiochem(); h.coreTemp = 0.8; h.health = 1;
  const k = createBiochem(); k.coreTemp = 0.8; k.health = 1;
  tickBiochem(h, pHeat0, 1, { ambientTemp: 0.8, active: 0 });
  tickBiochem(k, pHeat1, 1, { ambientTemp: 0.8, active: 0 });
  assert.ok(h.health < 1, `heatTol 0: hyperthermic at 0.80, health ${h.health}`);
  assert.equal(k.health, 1, `heatTol 1: fine at 0.80, health ${k.health}`);
});

test('v0.18: coldSense/heatSense — 0..1 body-state readers, not drives', () => {
  const p = pheno(7);
  const b = createBiochem();
  b.coreTemp = 0.5;
  assert.equal(coldSense(b, p), 0);
  assert.equal(heatSense(b, p), 0);
  b.coreTemp = 0.2;
  assert.ok(Math.abs(coldSense(b, p) - 0.6) < 1e-9);
  assert.equal(heatSense(b, p), 0);
  b.coreTemp = 0.8;
  assert.equal(coldSense(b, p), 0);
  assert.ok(Math.abs(heatSense(b, p) - 0.6) < 1e-9);
  const drives = ['hunger', 'energy', 'social', 'fun', 'fear'];
  assert.deepEqual(Object.keys(b).filter((k) => drives.includes(k)).length, 5,
    'still five drives — cold/heat are senses');
});

test('v0.18: the four realms instinct genes — indices and founders', () => {
  const specs = [
    ['instWaterDrink', 27, 17, 0],
    ['instThirstDrink', 28, 17, 0],
    ['instColdBask', 29, 18, 0],
    ['instDig', 31, 19, 0.15],
  ];
  for (const [key, sense, action, founder] of specs) {
    const g = GENES.find((x) => x.key === key);
    assert.ok(g, `${key} registered`);
    assert.equal(g.sense, sense, `${key} sense`);
    assert.equal(g.action, action, `${key} action`);
    assert.equal(g.founder, founder, `${key} founder`);
    assert.ok(REALMS18_KEYS.has(key), `${key} rides the v0.18 sub-stream`);
  }
  // coldTol/heatTol: family M thermal-tolerance loci.
  for (const key of ['coldTol', 'heatTol']) {
    const g = GENES.find((x) => x.key === key);
    assert.ok(g, `${key} registered`);
    assert.equal(g.kind, 'float');
    assert.equal(g.founder, 0.5);
    assert.ok(REALMS18_KEYS.has(key));
  }
  // Instinct wiring: thirst→drink fires when the instinct is expressed.
  const gp = pheno(7, { instThirstDrink: [1, 1] });
  const brain = createBrain(gp, createRng(11));
  assert.equal(brain.instW[17][28], 1.2, 'thirst→drink wired at full expression');
  // Plant loci are exported for the realms plantgenome.js integration.
  assert.deepEqual(PLANT_REALMS_LOCI.map((g) => g.key), ['heatTol', 'saltTol']);
});

test('v0.18: index contract — N_IN 36, N_OUT 23, append-only', () => {
  assert.equal(N_IN, 36, '35 senses + bias'); // v0.20: +objectNear, +heldWeight, +falling
  assert.equal(N_OUT, 23, '20 old actions + grasp/carry/drop'); // v0.20
  assert.equal(ACTIONS[17], 'drink');
  assert.equal(ACTIONS[18], 'bask');
  assert.equal(ACTIONS[19], 'dig');
  assert.equal(ACTIONS[20], 'grasp'); // v0.20
  assert.equal(ACTIONS[21], 'carry'); // v0.20
  assert.equal(ACTIONS[22], 'drop'); // v0.20
  assert.equal(SENSE32.length, 35); // v0.20: 34 + the falling sense
  assert.deepEqual(SENSE32.slice(0, 24), SENSE24, 'the old 24 untouched');
  assert.equal(SENSE32[28], 'thirst');
  assert.equal(SENSE32[29], 'cold');
  assert.equal(SENSE32[30], 'heat');
  assert.equal(SENSE32[31], 'buriedNear');
  assert.equal(SENSE32[32], 'objectNear'); // v0.20
  assert.equal(SENSE32[33], 'heldWeight'); // v0.20
  assert.equal(SENSE32[34], 'falling'); // v0.20 "Falling": appended, never renumbered
  assert.equal(ACT20.length, 23); // v0.20
  assert.deepEqual(ACT20.slice(0, 13), ACT13, 'the old 13 untouched');
  assert.equal(ACT20[17], 'drink');
  assert.equal(ACT20[18], 'bask');
  assert.equal(ACT20[19], 'dig');
  assert.equal(ACT20[20], 'grasp'); // v0.20
  assert.equal(ACT20[21], 'carry'); // v0.20
  assert.equal(ACT20[22], 'drop'); // v0.20
  const v = senseVector({ thirst: 0.7, cold: 0.1, heat: 0, buriedNear: 0.4 });
  assert.equal(v.length, 36, '35 senses + bias'); // v0.20: +falling
  assert.equal(v[28], 0.7, 'thirst rides at index 28');
  assert.equal(v[29], 0.1, 'cold rides at index 29');
  assert.equal(v[30], 0, 'heat rides at index 30');
  assert.equal(v[31], 0.4, 'buriedNear rides at index 31');
  assert.equal(v[34], 0, 'falling rides at index 34'); // v0.20 "Falling"
  assert.equal(v[35], 1, 'bias still last'); // v0.20: was 32
});

test('v0.18: founder main-stream bit-identity with pinSub + a pinned allele', () => {
  const g1 = randomGenome(createRng(7));
  const g2 = randomGenome(createRng(7), { pinSub: 1234, overrides: { legPower: 0.4 } });
  const subKeys = new Set([...EVO17_KEYS, ...REALMS18_KEYS, ...HANDS20_KEYS,
    ...FALLING20_KEYS, // v0.20 "Falling": rides the hands sub-stream pass
    ...GENES.filter((g) => g.key.startsWith('lex')).map((g) => g.key)]);
  for (const gene of GENES) {
    if (gene.key === 'legPower' || subKeys.has(gene.key)) continue;
    assert.deepEqual(g2.alleles[gene.key], g1.alleles[gene.key],
      `main-stream allele bit-identical: ${gene.key}`);
  }
  assert.deepEqual(g2.alleles.legPower, [0.4, 0.4], 'legPower pinned by the override');
});

test('v0.18: pinSub — same pin, different legPower → only legPower differs', () => {
  const mk = (lp) => randomGenome(createRng(7), { pinSub: 999, overrides: { legPower: lp } });
  const a = mk(0.3), c = mk(0.5);
  for (const gene of GENES) {
    if (gene.key === 'legPower') continue;
    assert.deepEqual(a.alleles[gene.key], c.alleles[gene.key],
      `only legPower differs: ${gene.key}`);
  }
  assert.deepEqual(a.alleles.legPower, [0.3, 0.3]);
  assert.deepEqual(c.alleles.legPower, [0.5, 0.5]);
  // Different pins → different sub-stream alleles (the pin actually seeds).
  const d = randomGenome(createRng(7), { pinSub: 1000, overrides: { legPower: 0.3 } });
  let same = 0, total = 0;
  for (const k of EVO17_KEYS) {
    total++;
    if (JSON.stringify(a.alleles[k]) === JSON.stringify(d.alleles[k])) same++;
  }
  assert.ok(same < total, 'different pins seed different sub-streams');
});

test('v0.18: NaN guards — garbage ctx leaves every body field finite', () => {
  const p = pheno(7);
  const b = createBiochem();
  const garbage = {
    sleeping: NaN, playing: NaN, ate: NaN, active: NaN, threat: NaN,
    submerged: NaN, heat: NaN, drank: NaN, ambientTemp: NaN,
    basking: NaN, sailDump: NaN, homesick: NaN, develop: NaN,
  };
  for (let t = 0; t < 100; t++) tickBiochem(b, p, 1, garbage);
  for (const [k, v] of Object.entries(b)) {
    assert.ok(Number.isFinite(v), `body field finite after garbage ctx: ${k} = ${v}`);
  }
  // Missing ctx entirely is also safe.
  const b2 = createBiochem();
  for (let t = 0; t < 100; t++) tickBiochem(b2, p, 1);
  for (const [k, v] of Object.entries(b2)) {
    assert.ok(Number.isFinite(v), `body field finite with no ctx: ${k} = ${v}`);
  }
});

test('v0.18: §13.6 — max-fur walker at ambient 0.55 overheats and dies', () => {
  // Max fur (furInsulation 0.3), walking (active 0.8), ambientTemp 0.55.
  // Must cross the hyperthermia threshold (0.75 + 0.5×0.1 = 0.80) within
  // 60–180 sim-seconds, then die within a few minutes.
  const p = pheno(7, { fur: [1, 1] });
  assert.ok(Math.abs(p.furInsulation - 0.3) < 1e-9, 'max-fur probe');
  const b = createBiochem();
  const feed = { active: 0.8, ambientTemp: 0.55, ate: 0.05 }; // fed, so only heat can kill
  let crossedAt = -1;
  for (let t = 0; t < 180; t++) {
    tickBiochem(b, p, 1, feed);
    if (crossedAt < 0 && b.coreTemp > 0.80) crossedAt = t + 1;
    if (isDead(b, p)) break;
  }
  assert.ok(crossedAt >= 60 && crossedAt <= 180,
    `hyperthermia crossed at ${crossedAt}s (window 60–180)`);
  // Keep going: it must die within a few minutes of the crossing.
  let deadAt = -1;
  for (let t = 0; t < 600 && deadAt < 0; t++) {
    tickBiochem(b, p, 1, feed);
    if (isDead(b, p)) deadAt = t + 1;
  }
  assert.ok(deadAt > 0 && deadAt <= 300,
    `dead ${deadAt}s after the crossing window (a few minutes)`);
});

test('v0.18: §13.6 — coldTol-0.5 animal resting in arctic ambient does NOT freeze', () => {
  const p = pheno(7, { coldTol: 0.5 }); // founder fur, coldTol pinned 0.5
  const b = createBiochem();
  for (let t = 0; t < 600; t++) {
    tickBiochem(b, p, 1, { active: 0.1, ambientTemp: 0.1, ate: 0.05 });
    assert.ok(!isDead(b, p), `survives arctic rest — died at tick ${t}`);
  }
  assert.ok(b.health > 0.5, `healthy after 10 arctic minutes, health ${b.health}`);
});
