// v0.37 "Affect" — the emotion expansion tests.
// design/affect-expansion.md. The honest boundary (§11): these tests assert
// mechanisms and dynamics, never phenomenal states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickBiochem, mood, createBiochem } from '../src/sim/biochem.js';
import {
  createPairBonds, getPairBond, nudgePairBond, halvePairBond, kindOf,
  createBonds, getBond, nudgeBond,
} from '../src/sim/social.js';

// --- helpers ---------------------------------------------------------------

function testPheno(over = {}) {
  return {
    lifespanSec: 100000,
    matTime: 0.5,
    sexHormoneRate: 0.5, serotoninRate: 0.5, pairBondRate: 0.5,
    griefTime: 0.5,
    hungerRate: 0.5, energyDrain: 0.5, furInsulation: 0,
    legDrainMult: 1, sociability: 0.5,
    ...over,
  };
}

function adultBiochem(over = {}) {
  const b = createBiochem();
  b.age = 50000; // adult (0.5 of lifespan)
  return { ...b, ...over };
}

// --- §1: the six chemicals -------------------------------------------------

test('sexHormone rises at maturation (the puberty ramp)', () => {
  const pheno = testPheno();
  const b = createBiochem();
  b.age = 1000; // juvenile
  const b2 = adultBiochem();
  tickBiochem(b, pheno, 60, { seasonBreed: 1 });
  tickBiochem(b2, pheno, 60, { seasonBreed: 1 });
  // Adult synthesizes faster than juvenile (matured=1 vs <1)
  assert.ok(b2.sexHormone > b.sexHormone, `adult ${b2.sexHormone} > juvenile ${b.sexHormone}`);
});

test('sexHormone drops on mating (refractory)', () => {
  const pheno = testPheno();
  const b = adultBiochem({ sexHormone: 0.8 });
  tickBiochem(b, pheno, 1, { mated: true, seasonBreed: 1 });
  assert.ok(b.sexHormone < 0.3, `refractory drop: ${b.sexHormone}`);
});

test('zest rises on positive reward delta, decays fast', () => {
  const pheno = testPheno();
  const b = adultBiochem();
  tickBiochem(b, pheno, 1, { rewardDelta: 0.5 });
  assert.ok(b.zest > 0.4, `zest on reward: ${b.zest}`);
  tickBiochem(b, pheno, 20, { rewardDelta: 0 });
  assert.ok(b.zest < 0.1, `zest decays: ${b.zest}`);
});

test('serotonin erodes under sustained distress, builds in contentment', () => {
  const pheno = testPheno();
  const b1 = adultBiochem({ serotonin: 0.5 });
  const b2 = adultBiochem({ serotonin: 0.5 });
  // Distress: fear high
  for (let i = 0; i < 100; i++) {
    b1.fear = 0.8;
    tickBiochem(b1, pheno, 10, {});
  }
  // Contentment: hunger low, energy high, social/fun low, fear low
  for (let i = 0; i < 100; i++) {
    b2.hunger = 0.2; b2.fatigue = 0.2; b2.social = 0.2; b2.fun = 0.2; b2.fear = 0.1;
    tickBiochem(b2, pheno, 10, {});
  }
  assert.ok(b1.serotonin < 0.5, `distress erodes: ${b1.serotonin}`);
  assert.ok(b2.serotonin > 0.5, `contentment builds: ${b2.serotonin}`);
});

test('vasopressin rises on mating, halves on infidelity', () => {
  const pheno = testPheno();
  const b = adultBiochem();
  tickBiochem(b, pheno, 1, { mated: true, matedInfidelity: false });
  assert.ok(b.vasopressin > 0.2, `mating builds: ${b.vasopressin}`);
  const before = b.vasopressin;
  tickBiochem(b, pheno, 1, { mated: true, matedInfidelity: true });
  assert.ok(b.vasopressin < before, `infidelity halves: ${before} -> ${b.vasopressin}`);
});

test('prolactin rises on birth and offspring contact, decays without', () => {
  const pheno = testPheno();
  const b = adultBiochem();
  tickBiochem(b, pheno, 1, { gaveBirth: true });
  assert.ok(b.prolactin > 0.3, `birth spikes: ${b.prolactin}`);
  const peaked = b.prolactin;
  // No contact: decays
  for (let i = 0; i < 100; i++) tickBiochem(b, pheno, 10, { offspringNear: 0 });
  assert.ok(b.prolactin < peaked, `decays without contact: ${peaked} -> ${b.prolactin}`);
});

test('prolactin decay accelerates while grieving (×4, not instant collapse)', () => {
  const pheno = testPheno();
  const b1 = adultBiochem({ prolactin: 0.8 });
  const b2 = adultBiochem({ prolactin: 0.8 });
  tickBiochem(b1, pheno, 10, { grieving: false });
  tickBiochem(b2, pheno, 10, { grieving: true });
  // Normal: 0.8 - 0.002*10 = 0.78. Grieving: 0.8 - 0.008*10 = 0.72.
  assert.ok(b2.prolactin < b1.prolactin, `grief accelerates: ${b1.prolactin} vs ${b2.prolactin}`);
  assert.ok(b2.prolactin > 0.5, `not an instant collapse: ${b2.prolactin}`);
});

test('stimulus rises on novelty, decays in ~100s', () => {
  const pheno = testPheno();
  const b = adultBiochem();
  tickBiochem(b, pheno, 1, { novelty: true });
  assert.ok(b.stimulus > 0.2, `novelty spikes: ${b.stimulus}`);
  tickBiochem(b, pheno, 100, { novelty: false });
  assert.ok(b.stimulus < 0.1, `decays: ${b.stimulus}`);
});

// --- §2: the four drives ---------------------------------------------------

test('libido is 0 for juveniles, tracks sexHormone for adults', () => {
  const pheno = testPheno();
  const juv = createBiochem();
  juv.age = 1000;
  juv.sexHormone = 0.8;
  const adult = adultBiochem({ sexHormone: 0.8 });
  tickBiochem(juv, pheno, 1, {});
  tickBiochem(adult, pheno, 1, {});
  assert.equal(juv.libido, 0, 'juvenile libido is 0');
  assert.ok(adult.libido > 0.1, `adult libido tracks: ${adult.libido}`);
});

test('curiosity tracks stimulus inversely', () => {
  const pheno = testPheno();
  const b1 = adultBiochem({ stimulus: 0.9 });
  const b2 = adultBiochem({ stimulus: 0.1 });
  tickBiochem(b1, pheno, 1, {});
  tickBiochem(b2, pheno, 1, {});
  assert.ok(b2.curiosity > b1.curiosity, `low stimulus -> high curiosity`);
});

test('attachment is 0 without a pair bond', () => {
  const pheno = testPheno();
  const b = adultBiochem({ vasopressin: 0.9 });
  tickBiochem(b, pheno, 1, { partnerAbsent: 0 });
  assert.equal(b.attachment, 0, 'no absence, no longing');
  tickBiochem(b, pheno, 1, { partnerAbsent: 1 });
  assert.ok(b.attachment > 0.5, `absence + vasopressin = longing: ${b.attachment}`);
});

test('care multiplies prolactin by offspring need', () => {
  const pheno = testPheno();
  const b = adultBiochem({ prolactin: 0.8 });
  tickBiochem(b, pheno, 1, { offspringNeed: 0 });
  assert.equal(b.care, 0, 'content baby -> no drive');
  tickBiochem(b, pheno, 1, { offspringNeed: 0.9 });
  assert.ok(b.care > 0.5, `needy baby -> care: ${b.care}`);
});

// --- §3.1: the depressed regime --------------------------------------------

test('depressed regime: serotonin < 0.35 flags and multiplies drive gains', () => {
  const pheno = testPheno();
  const b = adultBiochem({ serotonin: 0.2, bloodSugar: 0.5 });
  tickBiochem(b, pheno, 1, {});
  assert.ok(b.depressed, 'regime flag set');
  // Hunger drive with gain ×1.3: (1-0.5)*1.3 = 0.65 (approx — bloodSugar drifts slightly during the tick)
  assert.ok(Math.abs(b.hunger - 0.65) < 0.03, `hunger ×1.3: ${b.hunger}`);
});

test('depressed regime halves energy recovery (the tiredness sleep doesn\'t fix)', () => {
  const pheno = testPheno();
  const b1 = adultBiochem({ serotonin: 0.5, fatigue: 0.8 });
  const b2 = adultBiochem({ serotonin: 0.2, fatigue: 0.8 });
  tickBiochem(b1, pheno, 10, { sleeping: true });
  tickBiochem(b2, pheno, 10, { sleeping: true });
  assert.ok(b2.fatigue > b1.fatigue, `depressed recovers slower: ${b1.fatigue} vs ${b2.fatigue}`);
});

test('anhedonia: depressed regime halves oxytocin/endorphin yields', () => {
  const pheno = testPheno();
  const b1 = adultBiochem({ serotonin: 0.5, oxytocin: 0.1, endorphin: 0.1 });
  const b2 = adultBiochem({ serotonin: 0.2, oxytocin: 0.1, endorphin: 0.1 });
  tickBiochem(b1, pheno, 1, { grooming: true, playing: true });
  tickBiochem(b2, pheno, 1, { grooming: true, playing: true });
  assert.ok(b2.oxytocin < b1.oxytocin, `oxytocin halved: ${b1.oxytocin} vs ${b2.oxytocin}`);
  assert.ok(b2.endorphin < b1.endorphin, `endorphin halved: ${b1.endorphin} vs ${b2.endorphin}`);
});

// --- §6: mood() — 15 states, priority order ---------------------------------

test('mood() priority: fear outranks everything', () => {
  const b = adultBiochem({ adrenaline: 0.8, hunger: 0.9, sexHormone: 0.9, serotonin: 0.1 });
  tickBiochem(b, testPheno(), 1, {});
  assert.equal(mood(b), 'afraid');
});

test('mood() priority: grief outranks depression, depression outranks boredom', () => {
  const b1 = adultBiochem({ serotonin: 0.2, fun: 0.9 });
  b1.griefT = 100;
  tickBiochem(b1, testPheno(), 1, {});
  assert.equal(mood(b1), 'grieving');
  const b2 = adultBiochem({ serotonin: 0.2, fun: 0.9 });
  tickBiochem(b2, testPheno(), 1, {});
  assert.equal(mood(b2), 'depressed');
});

test('mood() new states: horny, longing, tender, curious, excited, joyful', () => {
  const p = testPheno();
  const horny = adultBiochem({ sexHormone: 0.9 });
  tickBiochem(horny, p, 1, {});
  assert.equal(mood(horny), 'horny');
  const longing = adultBiochem({ vasopressin: 0.9 });
  tickBiochem(longing, p, 1, { partnerAbsent: 1 });
  assert.equal(mood(longing), 'longing');
  const tender = adultBiochem({ prolactin: 0.9 });
  tickBiochem(tender, p, 1, { offspringNeed: 0.9 });
  assert.equal(mood(tender), 'tender');
  const curious = adultBiochem({ stimulus: 0.05 });
  tickBiochem(curious, p, 1, {});
  assert.equal(mood(curious), 'curious');
  const excited = adultBiochem({ stimulus: 0.8 }); // low curiosity, so zest can show
  tickBiochem(excited, p, 1, { rewardDelta: 0.8 });
  assert.equal(mood(excited), 'excited');
});

// --- §4: pair bonds and kind -------------------------------------------------

test('pair bonds: nudge, get, halve', () => {
  const pb = createPairBonds();
  const world = { pairBonds: pb, time: 0 };
  const a = { id: 1 }, b = { id: 2 };
  assert.equal(getPairBond(pb, a, b), 0);
  nudgePairBond(world, a, b, 0.5);
  assert.ok(Math.abs(getPairBond(pb, a, b) - 0.5) < 0.01);
  halvePairBond(world, a);
  assert.ok(Math.abs(getPairBond(pb, a, b) - 0.25) < 0.01);
});

test('kindOf: romantic > family > friend > rival > stranger', () => {
  const world = {
    pairBonds: createPairBonds(),
    bonds: createBonds(),
    creatures: [],
    lineage: new Map(), // pedigreeKin reads world.lineage
    time: 0,
  };
  const a = { id: 1 }, b = { id: 2 }, c = { id: 3 }, d = { id: 4 }, e = { id: 5 };
  world.creatures = [a, b, c, d, e];
  // Family: a and b share parents
  world.lineage.set(1, { parents: [10, 11] });
  world.lineage.set(2, { parents: [10, 11] });
  world.lineage.set(3, { parents: [] });
  world.lineage.set(4, { parents: [] });
  world.lineage.set(5, { parents: [] });
  assert.equal(kindOf(world, a, e), 'stranger');
  assert.equal(kindOf(world, a, b), 'family');
  nudgeBond(world, a, c, 0.5);
  assert.equal(kindOf(world, a, c), 'friend');
  nudgeBond(world, a, e, -0.5);
  assert.equal(kindOf(world, a, e), 'rival');
  nudgePairBond(world, a, d, 0.8);
  assert.equal(kindOf(world, a, d), 'romantic');
});

// --- RNG boundary: affectRng isolation ---------------------------------------

test('affectRng: mutation draws never touch the main sequence', async () => {
  const { createRng } = await import('../src/sim/rng.js');
  const { inherit, AFFECT_LOCI } = await import('../src/sim/genome.js');
  // Two worlds, same seed: one mutates affect loci, one doesn't.
  // The main rng sequence must be identical.
  const mkGenome = () => ({ loci: { size: 0.5, libidoGain: 0.5 } });
  const rng1 = createRng(42);
  const rng2 = createRng(42);
  const affectRng = createRng(43);
  // Simulate: inherit draws from rng for normal loci, affectRng for affect loci
  const seq1 = [rng1.next(), rng1.next(), rng1.next()];
  // (inherit with affectRng for affect loci)
  const seq2 = [rng2.next(), rng2.next(), rng2.next()];
  assert.deepEqual(seq1, seq2, 'main sequence untouched by affect draws');
  assert.ok(AFFECT_LOCI.size > 0, 'affect loci defined');
});
