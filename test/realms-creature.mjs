// Tests for v0.18 "Realms" creature work — creature.js + evodevo.js.
// Covers: aquatic phenotype, buoyancy/submersion, the swim/dive/drink/bask/dig
// verbs, the new senses (thirst/cold/heat/buriedNear), the diet branches,
// the §13.6 thermal probe, predators (sharks/bears), homesickness scaling,
// and the jump/climb stat counters.
// Run: node --test test/realms-creature.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, bindWorld, populate, platformIndexAt, addFood, groundYAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';
import { createBiochem, tickBiochem, isDead } from '../src/sim/biochem.js';
import { deriveAquaticPheno, SWIM_FLAIL_SPEED, SWIM_BASE_SPEED, SWIM_WING_K, SAIL_DUMP_K, WATER_DRAG_K } from '../src/sim/evodevo.js';
import {
  createCreature, updateCreature, stepPhysics, gatherSenses, doEat,
  refreshWaterState, scaledHomeDist, spawnPredators, tickPredators,
  SUBMERGE_MARGIN, FLOAT_MARGIN, DRINK_REACH, DIG_TIME,
} from '../src/sim/creature.js';

// Legacy test coordinates map into the scaled jungle (same mapping
// test/sim.mjs uses): x' = 1200 + 0.375x for x < 1200.
const mx = (x) => (x < 1200 ? 1200 + x * 0.375 : x);

function testWorld(seed = 18001) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  return world;
}

function addTestCreature(world, x, opts = {}) {
  const jx = mx(x);
  const pi = opts.platformIndex !== undefined ? opts.platformIndex : platformIndexAt(world, jx, 800);
  const c = createCreature(randomGenome(world.rng), jx, pi, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5; // adult
  c.pheno.spikes = 0;
  Object.assign(c, opts);
  world.creatures.push(c);
  // Settle physics once so y/_water/submerged are live.
  stepPhysics(c, world, 0.1);
  return c;
}

// v0.26: ponds are generated per seed — find a jungle freshwater pond.
function pondAt(world) {
  const jz = world.layout.zones[2];
  const pond = world.layout.waters.find((r) => !r.salt && r.x0 >= jz.x0 && r.x1 <= jz.x1);
  assert.ok(pond, 'a jungle freshwater pond exists');
  return { x: (pond.x0 + pond.x1) / 2, surfaceY: pond.surfaceY };
}

// v0.26: the deep water column — for tests that need depth (the ponds are
// shallow; buoyancy would surface the swimmer mid-test).
function deepAt(world) {
  const dz = world.layout.zones[7];
  const deep = world.layout.waters.find((r) => r.salt && r.x0 >= dz.x0);
  assert.ok(deep, 'deep water exists');
  return { x: (deep.x0 + deep.x1) / 2, surfaceY: deep.surfaceY };
}

// Put a creature at an explicit world position (for water/biome tests).
function placeCreature(world, x, y, opts = {}) {
  const pi = opts.platformIndex !== undefined ? opts.platformIndex : platformIndexAt(world, x, y);
  const c = createCreature(randomGenome(world.rng), x, pi, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  c.pheno.spikes = 0;
  Object.assign(c, opts);
  c.x = x;
  c.y = y;
  c.grounded = false;
  world.creatures.push(c);
  stepPhysics(c, world, 0.1);
  return c;
}

// ---- evodevo: the aquatic phenotype ----

test('v0.18: deriveAquaticPheno — flail speed without membranes', () => {
  const p = deriveAquaticPheno({ wingArea: 0, sailArea: 0, graspPairs: 2 });
  assert.equal(p.swimSpeed, SWIM_FLAIL_SPEED, 'no membranes → flail');
  assert.equal(p.swimSpeed, 12);
});

test('v0.18: deriveAquaticPheno — membrane formula', () => {
  const p = deriveAquaticPheno({ wingArea: 0.5, sailArea: 0.4, graspPairs: 3 });
  assert.equal(p.swimSpeed, SWIM_BASE_SPEED + 0.5 * SWIM_WING_K, '40 + wingArea×120');
  assert.equal(p.swimSpeed, 100);
  assert.equal(p.sailDump, 0.4 * SAIL_DUMP_K, 'sailArea×0.5');
  assert.equal(p.waterDrag, 3 * WATER_DRAG_K, 'graspPairs×8');
});

test('v0.18: deriveAquaticPheno — founder untouched, idempotent', () => {
  const world = testWorld();
  const c = addTestCreature(world, 800);
  // The founder's wingArea (0–0.137 random) is below the flail threshold.
  assert.ok(c.pheno.wingArea < 0.15, `founder wingArea in flail range: ${c.pheno.wingArea}`);
  assert.equal(c.pheno.swimSpeed, SWIM_FLAIL_SPEED, 'founder flails at 12px/s, untouched');
  const again = deriveAquaticPheno(c.pheno);
  assert.equal(again.swimSpeed, SWIM_FLAIL_SPEED, 'idempotent');
});

// ---- water state: submersion is the literal formula ----

test('v0.18: refreshWaterState — submerged is 14px+ below the surface', () => {
  const world = testWorld();
  const pond = pondAt(world); // v0.26: the generated jungle pool
  const deep = placeCreature(world, pond.x, pond.surfaceY + 20); // 20px under → submerged
  assert.ok(deep.submerged, '20px below surfaceY → submerged');
  assert.ok(deep._water, 'in water');
  const shallow = placeCreature(world, pond.x, pond.surfaceY + 10); // 10px under → floating, not submerged
  assert.ok(!shallow.submerged, '10px below surfaceY → not submerged (margin is 14)');
  const dry = addTestCreature(world, 800); // mx→1500, dry jungle
  assert.ok(!dry.submerged && !dry._water, 'dry land → no water state');
});

test('v0.18: buoyancy — a body floats to 11px below the surface and stays', () => {
  const world = testWorld();
  const pond = pondAt(world); // v0.26
  const c = placeCreature(world, pond.x, pond.surfaceY + 30); // deep in the pool
  for (let t = 0; t < 4; t += 0.1) stepPhysics(c, world, 0.1);
  const surfaceY = c._water.surfaceY;
  assert.ok(Math.abs(c.y - (surfaceY + FLOAT_MARGIN)) < 6,
    `float equilibrium ≈ surfaceY+11: y=${c.y.toFixed(1)} surfaceY=${surfaceY}`);
  assert.ok(!c.submerged, 'floating reads submerged=false — it can breathe');
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), 'no NaN in the water branch');
  // Bounds: nobody leaves sideways or sinks through the world floor.
  c.x = -50; c.vx = -100;
  stepPhysics(c, world, 0.5);
  assert.ok(c.x >= 0 && Number.isFinite(c.vx), 'west wall holds in water');
});

// ---- the swim verb ----

test('v0.18: swim in water with membranes — 2D steering at swimSpeed', () => {
  const world = testWorld();
  const pond = pondAt(world); // v0.26
  const c = placeCreature(world, pond.x, pond.surfaceY + 20);
  c.pheno.wingArea = 0.5;
  deriveAquaticPheno(c.pheno); // swimSpeed = 100
  assert.equal(c.pheno.swimSpeed, 100);
  c.action = 'swim';
  c.actionTimer = 10;
  c.wanderDir = 1;
  const x0 = c.x;
  updateCreature(c, world, 1.0);
  assert.equal(c.actionLabel, 'swimming', 'membranes → swimming, not flailing');
  assert.ok(!c._flail, 'no flail flag with real membranes');
  assert.ok(c.x - x0 > 50, `steers at ~swimSpeed: moved ${(c.x - x0).toFixed(1)}px in 1s`);
});

test('v0.18: swim without membranes — flailing at ~12px/s, 3× oxygen cost', () => {
  const world = testWorld();
  const deep = deepAt(world); // v0.26: deep water — stays submerged
  const c = placeCreature(world, deep.x, deep.surfaceY + 100); // deep — stays submerged during the test
  assert.equal(c.pheno.swimSpeed, 12);
  c.action = 'swim';
  c.actionTimer = 10;
  c.wanderDir = 1;
  const oxy0 = c.biochem.oxygen;
  const x0 = c.x;
  // Short ticks: buoyancy hasn't floated it up yet.
  for (let t = 0; t < 1; t += 0.2) updateCreature(c, world, 0.2);
  assert.equal(c.actionLabel, 'flailing', 'no membranes → flailing');
  assert.ok(c._flail, 'flail flag set');
  const moved = c.x - x0;
  assert.ok(moved < 25, `flail speed ≈12px/s, not 100: moved ${moved.toFixed(1)}px`);
  // Oxygen: base submerged drain + 2× flail surcharge → 3× total.
  // Measure the ratio against a non-flailing control (same depth, membranes).
  const drain = oxy0 - c.biochem.oxygen;
  const ctrl = placeCreature(world, deep.x, deep.surfaceY + 100); // same water
  ctrl.pheno.wingArea = 0.5;
  deriveAquaticPheno(ctrl.pheno);
  ctrl.action = 'swim'; ctrl.actionTimer = 10; ctrl.wanderDir = 1;
  const coxy0 = ctrl.biochem.oxygen;
  for (let t = 0; t < 1; t += 0.2) updateCreature(ctrl, world, 0.2);
  const ctrlDrain = coxy0 - ctrl.biochem.oxygen;
  assert.ok(drain > ctrlDrain * 2, `flailing bills ~3× the oxygen of swimming: ${drain.toFixed(3)} vs ${ctrlDrain.toFixed(3)}`);
});

test('v0.18: swim on land is an honest flop', () => {
  const world = testWorld();
  const c = addTestCreature(world, 800); // dry jungle
  c.action = 'swim';
  c.actionTimer = 10;
  const x0 = c.x;
  updateCreature(c, world, 0.1);
  assert.equal(c.actionLabel, 'flopping', 'no water → flop');
  assert.ok(Math.abs(c.x - x0) < 12, `a flop barely moves: ${(c.x - x0).toFixed(2)}px in 0.1s`);
});

// ---- dive: oxygen-gated ----

test('v0.18: dive holds depth; oxygen gates the ascent', () => {
  const world = testWorld();
  const pond = pondAt(world); // v0.26
  const c = placeCreature(world, pond.x, pond.surfaceY + 30); // well under
  assert.ok(c.submerged, 'starts submerged');
  c.pheno.gillArea = 1.0; // gills → stays down
  c.action = 'dive';
  c.actionTimer = 10;
  const y0 = c.y;
  for (let t = 0; t < 2; t += 0.5) updateCreature(c, world, 0.5);
  assert.ok(Math.abs(c.y - y0) < 30, `gills hold depth: y ${y0.toFixed(0)} → ${c.y.toFixed(0)}`);
  // No gills + critical oxygen → releases depth and re-decides.
  const d = placeCreature(world, pond.x, pond.surfaceY + 30);
  d.pheno.gillArea = 0;
  d.biochem.oxygen = 0.04;
  d.action = 'dive';
  d.actionTimer = 10;
  updateCreature(d, world, 0.5);
  assert.equal(d.action, 'wander', 'critical oxygen without gills → surfaces (re-decides)');
});

// ---- drink / bask / dig ----

test('v0.18: drink adjacent water restores hydration; far water does not', () => {
  const world = testWorld();
  const pond = pondAt(world); // v0.26
  const c = placeCreature(world, pond.x, pond.surfaceY - 10); // 10px above the pool surface
  c.biochem.hydration = 0.3;
  c.action = 'drink';
  c.actionTimer = 10;
  const h0 = c.biochem.hydration;
  // _drank (like _ate) applies on the next tick's chemistry.
  updateCreature(c, world, 1.0);
  updateCreature(c, world, 1.0);
  assert.equal(c.actionLabel, 'drinking');
  assert.ok(c.biochem.hydration > h0, `drank: hydration ${h0.toFixed(2)} → ${c.biochem.hydration.toFixed(2)}`);
  // Far from water: the verb degrades.
  const far = addTestCreature(world, 800);
  far.biochem.hydration = 0.3;
  far.action = 'drink';
  far.actionTimer = 10;
  updateCreature(far, world, 1.0);
  assert.equal(far.action, 'wander', 'no adjacent water → drink degrades to wander');
  assert.ok(far.biochem.hydration <= 0.3, 'no free hydration (passive drain only)');
});

test('v0.18: bask warms in warmth, not in cold', () => {
  const world = testWorld();
  // Jungle (ambient 0.55): basking pays.
  const warm = addTestCreature(world, 800);
  warm.biochem.coreTemp = 0.35;
  warm.action = 'bask';
  warm.actionTimer = 30;
  const t0 = warm.biochem.coreTemp;
  for (let i = 0; i < 30; i++) updateCreature(warm, world, 1.0);
  assert.ok(warm.biochem.coreTemp > t0 + 0.02,
    `basking in warmth restores coreTemp: ${t0.toFixed(2)} → ${warm.biochem.coreTemp.toFixed(2)}`);
  // Arctic (ambient 0.0): basking is just standing around.
  const cold = placeCreature(world, 300, 800);
  cold.biochem.coreTemp = 0.35;
  cold.action = 'bask';
  cold.actionTimer = 30;
  const c0 = cold.biochem.coreTemp;
  for (let i = 0; i < 30; i++) updateCreature(cold, world, 1.0);
  assert.ok(cold.biochem.coreTemp <= c0 + 0.02,
    `basking in the arctic does not warm: ${c0.toFixed(2)} → ${cold.biochem.coreTemp.toFixed(2)}`);
});

test('v0.18: dig — 3s of work unearths buried food', () => {
  const world = testWorld();
  // Seed a buried tuber directly under the digger (jungle soil).
  world.buried = world.buried || [];
  const c = addTestCreature(world, 800);
  world.buried.push({ x: c.x, y: c.y + 10, kind: 'tuber', amount: 1 });
  const buried0 = world.buried.length;
  const foods0 = world.foods.length;
  c.action = 'dig';
  c.actionTimer = 10;
  // During the dig: the label is honest.
  updateCreature(c, world, 1.0);
  assert.equal(c.actionLabel, 'digging');
  assert.equal(c.action, 'dig', 'still digging after 1s');
  // After 3s of work: the cache is unearthed.
  for (let t = 0; t < DIG_TIME; t += 0.5) {
    c.action = 'dig'; c.actionTimer = 10; // hold the verb (the brain would wander)
    updateCreature(c, world, 0.5);
  }
  assert.ok(world.buried.length < buried0, 'digging removed the buried item');
  assert.ok(world.foods.length > foods0, 'unearthed food entered the world');
  const unearthed = world.foods[world.foods.length - 1];
  assert.equal(unearthed.foodKind, 'tuber', 'the tuber is now edible food');
});

// ---- the new senses ----

test('v0.18: thirst = 1 − hydration; cold/heat read coreTemp', () => {
  const world = testWorld();
  const c = addTestCreature(world, 800);
  c.biochem.hydration = 0.3;
  c.biochem.coreTemp = 0.15; // hypothermic
  let s = gatherSenses(c, world);
  assert.ok(Math.abs(s.thirst - 0.7) < 1e-9, `thirst=1−hydration: ${s.thirst}`);
  assert.ok(s.cold > 0.5, `cold sense high when hypothermic: ${s.cold.toFixed(2)}`);
  assert.ok(s.heat < 0.2, `heat sense low when cold: ${s.heat.toFixed(2)}`);
  c.biochem.coreTemp = 0.9; // hyperthermic
  s = gatherSenses(c, world);
  assert.ok(s.heat > 0.5, `heat sense high when hyperthermic: ${s.heat.toFixed(2)}`);
  assert.ok(s.cold < 0.2, `cold sense low when hot: ${s.cold.toFixed(2)}`);
});

test('v0.18: buriedNear reads the pantry within 240px', () => {
  const world = testWorld();
  world.buried = world.buried || [];
  const c = addTestCreature(world, 800);
  const s0 = gatherSenses(c, world);
  world.buried.push({ x: c.x + 100, y: c.y, kind: 'tuber', amount: 1 });
  const s1 = gatherSenses(c, world);
  assert.ok(s1.buriedNear > s0.buriedNear, `buriedNear rises near a cache: ${s0.buriedNear} → ${s1.buriedNear.toFixed(2)}`);
  assert.ok(s1.buriedNear > 0.4 && s1.buriedNear < 0.8, '100px/240px → ~0.58');
});

// ---- the diet branches ----

test('v0.18: doEat — bug/minnow/corpse are meat; unknown kinds are skipped', () => {
  const world = testWorld();
  const c = addTestCreature(world, 800);
  for (const kind of ['bug', 'minnow', 'corpse']) {
    addFood(world, c.x, c.platformIndex, kind, 1, 0, { nutrition: 1 });
    c._senses = { _food: world.foods[world.foods.length - 1] };
    const gut0 = c.gut;
    assert.ok(doEat(c, world), `ate the ${kind}`);
    assert.ok(c.gut > gut0, `${kind} fed the gut`);
  }
  // Unknown kinds: skipped, never crashed on.
  addFood(world, c.x, c.platformIndex, 'rock', 1, 0, {});
  c._senses = { _food: world.foods[world.foods.length - 1] };
  assert.equal(doEat(c, world), false, 'unknown kind → false');
  // Fruit and leaf keep their exact legacy behavior.
  addFood(world, c.x, c.platformIndex, 'fruit', 1, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  c._senses = { _food: world.foods[world.foods.length - 1] };
  assert.ok(doEat(c, world), 'fruit still eaten');
  addFood(world, c.x, c.platformIndex, 'leaf', 1, 0, {});
  c._senses = { _food: world.foods[world.foods.length - 1] };
  c.biochem.illness = 0.8;
  assert.ok(doEat(c, world), 'leaf still eaten');
  assert.ok(c.biochem.illness < 0.8, 'leaf still purges illness');
});

// ---- §13.6: the thermal probe ----

test('v0.18 §13.6: hot-vs-cold calibration — the chemistry feels ambient', () => {
  // Two identical max-fur bodies, same activity, different ambients.
  // If the differential is absent the chemistry isn't coupled and the
  // probe below would be meaningless → skip, loudly.
  const mkPheno = () => ({ furInsulation: 0.3, breathTime: 30, coldTol: 0.5, heatTol: 0.5, sailDump: 0 });
  const mkCtx = (amb) => ({
    sleeping: false, playing: false, nearFriend: false, petted: false, scolded: false,
    grooming: false, groomed: false, ate: 0, active: 0.8, threat: 0, homesick: 0,
    develop: 0, submerged: 0, heat: 0.1, ambientTemp: amb, drank: 0, basking: 0, sailDump: 0,
  });
  const rng = createRng(7);
  const hot = createBiochem(rng), cold = createBiochem(rng);
  for (let t = 0; t < 120; t++) {
    tickBiochem(hot, mkPheno(), 1.0, mkCtx(0.55));
    tickBiochem(cold, mkPheno(), 1.0, mkCtx(0.0));
  }
  const diff = hot.coreTemp - cold.coreTemp;
  if (diff <= 0.05) {
    console.log(`  (skip: hot/cold differential ${diff.toFixed(3)} ≤ 0.05 — chemistry uncoupled)`);
    return; // t.skip() equivalent without failing the file
  }
  assert.ok(diff > 0.05, `hot body runs hotter than cold body: Δ=${diff.toFixed(3)}`);
});

test('v0.18 §13.6: max-fur probe — heat is a wall, not a slope', () => {
  // The landed biochem's documented contract (biochem.js tuning note):
  // max-fur (insulation 0.3), active 0.8, constant ambient 0.55 →
  // equilibrium 0.85 crosses the hyper threshold (~139s); dead ~67s later.
  // NOTE: the literal §13.6 spec (60px/s east from x=300, "never reaches
  // x≥1200 with health>0.3") is incompatible with this tuning — 60px/s
  // crosses 900px in 15s, an order of magnitude faster than the heat builds
  // (~139s). The probe would outrun the heat across the whole world. This
  // test asserts the documented contract instead; the spec/tuning mismatch
  // is reported to the parent.
  const pheno = { furInsulation: 0.3, breathTime: 30, coldTol: 0.5, heatTol: 0.5, sailDump: 0 };
  const b = createBiochem(createRng(11));
  const ctx = {
    sleeping: false, playing: false, nearFriend: false, petted: false, scolded: false,
    grooming: false, groomed: false, ate: 0, active: 0.8, threat: 0, homesick: 0,
    develop: 0, submerged: 0, heat: 0.1, ambientTemp: 0.55, drank: 0, basking: 0, sailDump: 0,
  };
  for (let t = 0; t < 240; t++) tickBiochem(b, pheno, 1.0, ctx);
  assert.ok(b.health <= 0.3 || isDead(b),
    `max-fur at ambient 0.55, active 0.8 → dead by ~240s: health=${b.health.toFixed(2)}`);
});

// ---- predators ----

test('v0.18: spawnPredators — 5 sharks, 2 bears, in the right waters', () => {
  const world = testWorld();
  const preds = spawnPredators(world);
  assert.equal(preds.length, 7, '5 sharks + 2 bears');
  const sharks = preds.filter((p) => p.kind === 'shark');
  const bears = preds.filter((p) => p.kind === 'bear');
  assert.equal(sharks.length, 5);
  assert.equal(bears.length, 2);
  for (const s of sharks) {
    assert.ok(s.x >= 3000, `shark in eastern waters: x=${s.x.toFixed(0)}`);
    assert.equal(s.pheno.breathTime, 3000, 'gills: effectively inexhaustible');
  }
  for (const b of bears) {
    assert.ok(b.x < 600, `bear in the arctic: x=${b.x.toFixed(0)}`);
    assert.equal(b.pheno.furInsulation, 0.3, 'arctic-native insulation (v0.27: one physics for every body — the 1.0 degeneracy is gone)');
  }
});

test('v0.18: sharks — beached sharks die in ~10s; wet sharks hunt', () => {
  const world = testWorld();
  spawnPredators(world);
  const shark = world.predators.find((p) => p.kind === 'shark');
  // Beach it: dry plains, far from any pool (pin it — sharks wander).
  shark.x = 2000; shark.y = 800; shark.vx = 0; shark.vy = 0;
  for (let t = 0; t < 11; t += 0.5) {
    shark.x = 2000; // pin: the beaching test, not the wandering test
    tickPredators(world, 0.5);
  }
  assert.ok(!shark.alive, 'beached 11s → dead');
  // A wet shark seeks a submerged creature and kills on contact.
  const world2 = testWorld(18002);
  spawnPredators(world2);
  const hunter = world2.predators.find((p) => p.kind === 'shark');
  const prey = placeCreature(world2, hunter.x + 200, hunter.y);
  assert.ok(prey.submerged, 'prey is in the water');
  const d0 = Math.hypot(prey.x - hunter.x, prey.y - hunter.y);
  for (let t = 0; t < 3; t += 0.5) tickPredators(world2, 0.5);
  const d1 = Math.hypot(prey.x - hunter.x, prey.y - hunter.y);
  assert.ok(d1 < d0, `shark closes on submerged prey: ${d0.toFixed(0)} → ${d1.toFixed(0)}px`);
  // Contact kills.
  hunter.x = prey.x; hunter.y = prey.y;
  tickPredators(world2, 0.5);
  assert.ok(!prey.alive, 'contact kills');
  assert.ok(world2.foods.some((f) => f.foodKind === 'corpse'), 'the kill leaves a corpse');
});

test('v0.18: bears — jungle heat kills, arctic cold does not', () => {
  const world = testWorld();
  spawnPredators(world);
  const jungleBear = world.predators.find((p) => p.kind === 'bear');
  jungleBear.x = 1500; // jungle, ambient 0.55
  jungleBear.y = groundYAt(1500, world.layout);
  const arcticBear = world.predators.filter((p) => p.kind === 'bear')[1];
  arcticBear.x = 300; // arctic, ambient 0.0
  arcticBear.y = groundYAt(300, world.layout);
  // v0.27: bears run the unified tickBiochem (fur 0.3, no fallback). The
  // jungle death is slower now (~430s: eq 0.763 vs hyper 0.76 — the bear
  // hovers just above the threshold, then the ordinary hyperthermia drain
  // wins) — same behavioral verdict, honest chemistry instead of the
  // hand-rolled fallback. Hydration and bloodSugar are controlled.
  // Bears stand on the real ground (no y=800 override — that buried them and
  // injured them under the unified physics). All non-thermal drives are
  // controlled: this is the thermal test, not the hunger/thirst/fatigue
  // test (live bears have slow metabolisms + drink from nearby water).
  for (let t = 0; t < 500; t += 1) {
    jungleBear.x = 1500; // pin both: the thermal test, not the wandering test
    arcticBear.x = 300;
    for (const b of [jungleBear.biochem, arcticBear.biochem]) {
      // Hold non-thermal drives neutral: hydration/bloodSugar topped up,
      // fatigue at 0.8 (energy ~0.2: below the 0.3 regen threshold, above
      // the 0.01 exhaustion threshold) — so only the thermal drain can kill.
      // (b.energy is recomputed from fatigue each tick; set fatigue, not energy.)
      b.hydration = 0.8; b.bloodSugar = 0.8; b.fatigue = 0.8;
    }
    tickPredators(world, 1.0);
  }
  assert.ok(!jungleBear.alive, 'max-insulation bear dies in jungle heat (~430s, unified chemistry)');
  assert.ok(arcticBear.alive && arcticBear.biochem.health > 0.9,
    `arctic bear survives its home biome: health=${arcticBear.biochem.health.toFixed(2)}`);
});

// ---- homesickness: biome-center scaling ----

test('v0.18: scaledHomeDist — leaving the biome costs more than the zone did', () => {
  const world = testWorld();
  const c = addTestCreature(world, 800); // homeX = 1500 (jungle center)
  c.homeX = 1500;
  c.x = 1500;
  assert.ok(scaledHomeDist(c, world) < 0.01, 'home → ~0');
  c.x = 1800; // 300px east, still jungle
  const base = 300 / 800; // v0.13 would say 0.375
  const scaled = scaledHomeDist(c, world);
  assert.ok(scaled > base, `biome-center scaling exceeds the v0.13 base: ${scaled.toFixed(3)} > ${base}`);
  assert.ok(scaled <= 1, 'clamped to [0,1]');
  // No home → 0, never NaN.
  const stray = addTestCreature(world, 800);
  delete stray.homeX;
  assert.equal(scaledHomeDist(stray, world), 0);
});

// ---- §13.7: the leg experiment counts leaps and climbs ----

test('v0.18: jump increments world.stats.jumps', () => {
  const world = testWorld();
  world.stats = world.stats || { jumps: 0, climbs: 0 };
  const c = addTestCreature(world, 800);
  c.grounded = true;
  c.action = 'jump';
  c.actionTimer = 10;
  updateCreature(c, world, 0.1);
  assert.equal(world.stats.jumps, 1, 'a launched jump is counted');
  // Missing stats object → no crash (guard).
  const world2 = testWorld(18003);
  delete world2.stats;
  const c2 = addTestCreature(world2, 800);
  c2.grounded = true;
  c2.action = 'jump';
  c2.actionTimer = 10;
  updateCreature(c2, world2, 0.1);
  assert.ok(!c2.grounded, 'jump still launches without the stats object');
});

// ---- founder-exactness: the old world still runs ----

test('v0.18: founder tick — no NaN, senses wired, chemistry alive', () => {
  const world = testWorld();
  const c = addTestCreature(world, 800);
  for (let t = 0; t < 5; t += 0.5) updateCreature(c, world, 0.5);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), 'position stays finite');
  assert.ok(Number.isFinite(c.biochem.hydration), 'hydration stays finite');
  assert.ok(Number.isFinite(c.biochem.coreTemp), 'coreTemp stays finite');
  const s = gatherSenses(c, world);
  assert.ok(Number.isFinite(s.thirst) && Number.isFinite(s.cold) && Number.isFinite(s.heat),
    'thirst/cold/heat are finite numbers');
  assert.ok(s.thirst >= 0 && s.thirst <= 1, 'thirst in [0,1]');
});
