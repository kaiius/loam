// Canopy v0.28 "Day and night" — the day becomes physics, activity phase evolvable.
//
// These tests pin the day/night contract:
//   - DAY length is a world parameter (ticks per day, default 3000, reported)
//   - light(t) is integer-tick analytic: (tick % dayTicks) / dayTicks —
//     deterministic at millions of ticks, true night (~0.02 at midnight)
//   - the diurnal T ripple rides the reversion target through thermal mass
//     (flux-shaped, never an absolute ΔT — the v0.25/v0.27 heat-pump lesson)
//   - the seasonal wave is DAYLIGHT-GATED: summer lifts the afternoon,
//     midnight is untouched in every season (the "midnight sun" fix)
//   - activityPhase locus (0=diurnal, 1=nocturnal) + instPhaseSleep instinct,
//     own RNG sub-stream (pass 7), appended sense 36 phaseSleepiness
//   - vision range scales with light through eyeSize; big eyes see farther
//     at night but are dazzled at clear noon (the runaway check)
//   - predators carry a phase (set, not DNA); vigor peaks in their active phase
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, bindWorld, tickWorld, timeOfDay, daylightCurve, updateLight, DAY_TICKS_DEFAULT, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome, phenotype, GENES, DAYNIGHT28_KEYS, SENSE32, CHROMOSOMES } from '../src/sim/genome.js';
import { createBrain, senseVector, N_IN } from '../src/sim/brain.js';
import { gatherSenses, visionLightFactor, phaseSleepiness, predatorVigor, spawnPredators, createCreature } from '../src/sim/creature.js';
import { seasonalForcing, SEASON_AMP_MAX } from '../src/sim/weather.js';

test('v0.28: exactly two new loci — activityPhase + instPhaseSleep (GENES 232)', () => {
  assert.equal(GENES.length, 349); // D1: 257 + 92 regulatory loci
  assert.deepEqual([...DAYNIGHT28_KEYS].sort(), ['activityPhase', 'instPhaseSleep']);
  const chr4 = CHROMOSOMES[3];
  assert.ok(chr4.includes('activityPhase'), 'activityPhase rides the behavior chromosome');
  assert.ok(chr4.includes('instPhaseSleep'), 'instPhaseSleep rides the instinct chromosome');
  const ap = GENES.find((g) => g.key === 'activityPhase');
  const ips = GENES.find((g) => g.key === 'instPhaseSleep');
  assert.equal(ap.founder, 0.5);
  assert.equal(ips.sense, 36);
  assert.equal(ips.action, 2); // sleep
});

test('v0.28: new loci draw from their own sub-stream — earlier streams untouched', () => {
  // Same seed → bit-identical genomes (determinism).
  const a = randomGenome(createRng(99));
  const b = randomGenome(createRng(99));
  assert.deepEqual(a.alleles, b.alleles);
  // The day/night alleles are deterministic functions of the pin, not the
  // main stream: same pinSub → same activityPhase across different seeds.
  const g1 = randomGenome(createRng(7), { pinSub: 1234 });
  const g2 = randomGenome(createRng(999), { pinSub: 1234 });
  assert.deepEqual(g1.alleles.activityPhase, g2.alleles.activityPhase);
  assert.deepEqual(g1.alleles.instPhaseSleep, g2.alleles.instPhaseSleep);
  // Founder variation spans the axis: 0.5 ± 0.25.
  let lo = 1, hi = 0;
  for (let s = 0; s < 200; s++) {
    const p = phenotype(randomGenome(createRng(s)));
    lo = Math.min(lo, p.activityPhase);
    hi = Math.max(hi, p.activityPhase);
  }
  assert.ok(lo < 0.4 && hi > 0.6, `founder spread ${lo.toFixed(2)}..${hi.toFixed(2)}`);
});

test('v0.32: one new sense — pain at index 37, N_IN 39', () => {
  assert.equal(SENSE32.length, 43); // v0.37: +5 affect senses appended
  assert.equal(SENSE32[36], 'phaseSleepiness');
  assert.equal(SENSE32[37], 'pain'); // v0.32: pain still at 37 — appended, never renumbered
  assert.deepEqual(SENSE32.slice(38), ['libido', 'curiosity', 'attachment', 'care', 'pairNear']); // v0.37
  assert.equal(N_IN, 44); // v0.37: +5 affect senses (libido, curiosity, attachment, care, pairNear)
  const s = {};
  for (const k of SENSE32) s[k] = 0;
  s.phaseSleepiness = 0.7;
  s.pain = 0.9;
  const v = senseVector(s);
  assert.equal(v.length, 44); // v0.37: 43 senses + bias
  assert.equal(v[36], 0.7);
  assert.equal(v[37], 0.9);
  assert.equal(v[43], 1); // bias still last // v0.37: 43 senses + bias
});

test('v0.28: DAY length is a world parameter (ticks per day, default 3000)', () => {
  assert.equal(DAY_TICKS_DEFAULT, 3000);
  const w1 = createWorld(7);
  assert.equal(w1.dayTicks, 3000);
  const w2 = createWorld(7, { dayTicks: 600 });
  assert.equal(w2.dayTicks, 600);
  // The phase completes a cycle in exactly dayTicks.
  w2.tick = 0;
  assert.equal(timeOfDay(w2), 0);
  w2.tick = 150;
  assert.equal(timeOfDay(w2), 0.25);
  w2.tick = 600;
  assert.equal(timeOfDay(w2), 0);
});

test('v0.28: light(t) is integer-tick analytic — no drift at millions of ticks', () => {
  const w = createWorld(7);
  w.tick = 3_000_000 + 750; // a far-future tick, quarter day
  assert.equal(timeOfDay(w), 0.25);
  updateLight(w);
  const l1 = w.light;
  w.tick = 3_000_000 + 750 + 3000 * 41; // 41 days later — same phase
  updateLight(w);
  assert.equal(w.light, l1);
  // True night: ~0.02 at midnight, 1.0 at noon.
  w.tick = 0;
  updateLight(w);
  assert.ok(Math.abs(w.light - 0.02) < 1e-9, `midnight ${w.light}`);
  w.tick = 1500;
  updateLight(w);
  assert.ok(Math.abs(w.light - 1.0) < 1e-9, `noon ${w.light}`);
  // The shared curve: 0 at midnight, 1 at noon.
  assert.equal(daylightCurve(0), 0);
  assert.equal(daylightCurve(0.5), 1);
});

test('v0.28: seasonal forcing is daylight-gated — midnight untouched', () => {
  // Summer midnight: no seasonal energy with no sun behind it.
  assert.ok(seasonalForcing(0.3, 1, 0) === 0);
  assert.ok(seasonalForcing(0.3, -1, 0) === 0);
  // Summer noon: full amplitude; winter noon: symmetric cooling.
  assert.equal(seasonalForcing(0.3, 1, 1), 0.3);
  assert.equal(seasonalForcing(0.3, -1, 1), -0.3);
  // Twilight: half gate.
  assert.equal(seasonalForcing(0.3, 1, 0.5), 0.15);
  assert.ok(SEASON_AMP_MAX > 0);
});

test('v0.28: phaseSleepiness — the body knows when it should sleep', () => {
  const mk = (phase, light) => phaseSleepiness({ pheno: { activityPhase: phase } }, { light });
  assert.equal(mk(1, 1), 1); // nocturnal at noon: sleepy
  assert.equal(mk(0, 1), 0); // diurnal at noon: wide awake
  assert.ok(mk(0, 0.02) > 0.95); // diurnal at midnight: sleepy
  assert.ok(mk(1, 0.02) < 0.05); // nocturnal at midnight: wide awake
  assert.equal(mk(0.5, 0.5), 1); // the neutral phase peaks at twilight
});

test('v0.28: vision scales with light through eyeSize — dazzle caps the runaway', () => {
  const f = (light, eyeSize) => visionLightFactor({ light }, { eyeSize });
  // Clear noon: small eyes full range, big eyes pay a gentle dazzle tax
  // (softened from 0.60 — the steeper curve broke the vulture QA's diurnal
  // foraging; the check on runaway is the tax's existence, not its size).
  assert.equal(f(1.0, 0), 1.0);
  assert.ok(Math.abs(f(1.0, 1) - 0.86) < 0.02, `big eyes at noon: ${f(1.0, 1).toFixed(3)}`);
  assert.ok(f(1.0, 1) < f(1.0, 0.5) && f(1.0, 0.5) <= 1.0);
  // Midnight: everyone is dim, but big eyes see ~2× farther than small.
  const small = f(0.02, 0), big = f(0.02, 1);
  assert.ok(big > small * 1.8, `night ratio ${big.toFixed(4)}/${small.toFixed(4)}`);
  assert.ok(big < 0.15, 'night is the hearing animal\'s world');
  // Overcast noon: no dazzle when the light is softer — big eyes fine.
  assert.equal(f(0.45, 1), 1.0);
});

test('v0.28: instPhaseSleep wires phaseSleepiness → sleep in the brain', () => {
  const g = randomGenome(createRng(3), { overrides: { instPhaseSleep: 1 } });
  const p = phenotype(g);
  const brain = createBrain(p, createRng(4));
  // (pheno − 0.5) × 2.4 → action 2 (sleep), sense 36 (phaseSleepiness).
  assert.ok(Math.abs(brain.instW[2][36] - 1.2) < 1e-9, `instW ${brain.instW[2][36]}`);
});

test('v0.28: predators carry a phase (set, not DNA); vigor peaks in-phase', () => {
  // The night hunter at full vigor at midnight, sluggish at noon.
  assert.ok(predatorVigor(0.8, 0.02) > 1.2, `shark midnight ${predatorVigor(0.8, 0.02).toFixed(2)}`);
  assert.ok(predatorVigor(0.8, 1.0) < 0.8, `shark noon ${predatorVigor(0.8, 1.0).toFixed(2)}`);
  assert.ok(predatorVigor(0.8, 0.02) > predatorVigor(0.8, 1.0));
  // Bounds: 0.6..1.4.
  assert.ok(predatorVigor(0, 1) >= 0.6 && predatorVigor(1, 0) <= 1.4);
  // Spawned predators actually carry their phases.
  const world = createWorld(7);
  bindWorld(world);
  const preds = spawnPredators(world);
  const sharks = preds.filter((p) => p.kind === 'shark');
  const bears = preds.filter((p) => p.kind === 'bear');
  assert.ok(sharks.length > 0 && bears.length > 0);
  assert.ok(sharks.every((s) => s.phase === 0.8));
  assert.ok(bears.every((b) => b.phase === 0.3));
});

test('v0.28: tickWorld advances the integer clock; cloud shading still applies', () => {
  const world = createWorld(7);
  bindWorld(world);
  // Noon tick: updateLight alone gives 1.0; the full tick can only shade down.
  world.tick = 1500;
  updateLight(world);
  assert.equal(world.light, 1.0);
  tickWorld(world, 0.1);
  assert.equal(world.tick, 1501, 'integer clock advances by one per tick');
  assert.ok(world.light <= 1.0, `shaded noon ${world.light}`);
});

test('v0.28: basking follows the diurnal sun — no midnight sunbathing', () => {
  // The basking warmth term scales by daySun (world.light): at midnight it
  // pays ~nothing, at noon it pays full. (Gemini P2-7: else creatures bypass
  // night by basking.)
  const world = createWorld(7);
  bindWorld(world);
  const pi = platformIndexAt(world, 1500, 800);
  const c = createCreature(randomGenome(createRng(7)), 1500, pi, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  c.biochem.coreTemp = 0.5;
  world.creatures.push(c);
  const bask = () => {
    c.action = 'bask'; c.actionTimer = 100;
    c.biochem.bloodSugar = 1; // pin fed — isolate thermoregulation, not hunger
    c.biochem.fear = 0;
  };
  // Midnight: light ~0.02. Force basking, warm ambient so warmthFrac is live.
  world.tick = 0; // midnight phase
  updateLight(world);
  assert.ok(world.light < 0.1, `midnight light ${world.light}`);
  bask();
  const t0 = c.biochem.coreTemp;
  for (let i = 0; i < 100; i++) { bask(); tickWorld(world, 0.1); }
  const midnightGain = c.biochem.coreTemp - t0;
  // Noon: light 1.0.
  world.tick = 1500;
  updateLight(world);
  assert.equal(world.light, 1.0);
  c.biochem.coreTemp = 0.5;
  bask();
  const t1 = c.biochem.coreTemp;
  for (let i = 0; i < 100; i++) { bask(); tickWorld(world, 0.1); }
  const noonGain = c.biochem.coreTemp - t1;
  assert.ok(noonGain > midnightGain * 1.2,
    `basking pays by day (${noonGain.toFixed(3)}) not by night (${midnightGain.toFixed(3)})`);
});
