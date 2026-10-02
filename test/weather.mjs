// Canopy v0.23 "Weather" — the sky as physics.
//
// These tests pin the climate field's mechanics: donor-limited advection,
// the 85/15 rain split, emergent jungle/desert rainfall gap, determinism,
// √dt stability, lightning events, the Whittaker seed points, wind vs
// flight, and drought withering. Patterns marked (Paul) are re-derived from
// Wildcode v0.17's weather.js — see ~/workspace/paul-review/
// wildcode-v017-review.md §5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, bindWorld, tickWorld } from '../src/sim/world.js';
import {
  createClimate, initClimateFromPainted, tickClimate, whittakerKey, colAt,
  tempAt, droughtStressAt, windAt, totalWater, placeVents, diffuseT,
  VENT_COUNT, CLIMATE_SEED,
  WEATHER_COLS, WEATHER_COL_W,
} from '../src/sim/weather.js';
import { BIOMES, biomeAt, biomeKeyAt, biomeCenterX } from '../src/sim/biomes.js';

// Minimal harness for tickClimate: plants, time, events, geo.
function climWorld(seed = 7, nPlants = 0) {
  const world = createWorld(seed);
  bindWorld(world);
  world.plants = [];
  for (let i = 0; i < nPlants; i++) {
    world.plants.push({ x: 1500 + (i % 5) * 10, growth: 1 });
  }
  return world;
}

test('v0.23: initial climate reproduces the painted map (the migration pin)', () => {
  const world = climWorld(7);
  for (let i = 0; i < 8; i++) {
    const cx = biomeCenterX(i);
    const painted = BIOMES[i].key;
    const emergent = biomeKeyAt(cx, 800, world);
    assert.equal(emergent, painted, `biome ${painted} @${cx}: emergent=${emergent}`);
  }
});

test('v0.23: Whittaker seed points map to the eight keys', () => {
  const cases = [
    ['arctic', 0.05, 0.45], ['mountains', 0.38, 0.55],
    ['jungle', 0.55, 0.85], ['plains', 0.60, 0.45],
    ['desert', 1.00, 0.15],
  ];
  for (const [key, T, M] of cases) {
    assert.equal(whittakerKey(T, M, null), key, `${key} seed (${T}, ${M})`);
  }
  assert.equal(whittakerKey(0.6, 0.8, 'shallows'), 'shallows', 'water bodies are geography');
  assert.equal(whittakerKey(0.6, 0.5, 'deep'), 'deep', 'water bodies are geography');
});

test('v0.23: advection is donor-limited and two-sided (Paul §5.3)', () => {
  const world = climWorld(7);
  const cl = world.climate;
  // Still air except column 10: strong eastward wind, loaded with vapor.
  for (const c of cl.cols) { c.windU = 0; c.cloud = 0; }
  cl.cols[10].windU = 80;
  cl.cols[10].vapor = 0.5; // below saturation at T=0.5 — no condensation this tick
  cl.cols[11].vapor = 0.1;
  // Freeze everything but advection: no evap (no plants, no water), no rain
  // (vapor below saturation everywhere). Cap BEFORE measuring the baseline.
  for (const c of cl.cols) { c.T = 0.5; c.soil = 0; if (c.vapor > 0.5) c.vapor = 0.5; }
  const before = totalWater(cl);
  tickClimate(world, 1, world.climateGeo);
  const moved = 0.5 - cl.cols[10].vapor;
  assert.ok(moved > 0, 'vapor left the donor');
  assert.ok(moved <= 0.5 + 1e-9, 'donor-limited: never more than the donor held');
  // Two-sided: what left 10 entered 11 (up to the tick's other small terms —
  // soil is 0 so evap is 0; vapor was below sat so no condensation).
  const gained = cl.cols[11].vapor - 0.1;
  assert.ok(Math.abs(moved - gained) < 1e-6, `two-sided flux: moved=${moved} gained=${gained}`);
  const after = totalWater(cl);
  assert.ok(Math.abs(after - before) < 1e-6, `advection conserves: ${before} → ${after}`);
});

test('v0.23: rain splits 85/15 soil/runoff (Paul §5.1)', () => {
  const world = climWorld(7);
  const cl = world.climate;
  for (const cc of cl.cols) { cc.cloud = 0; cc.vapor = 0.3; } // only column 20 rains
  const c = cl.cols[20];
  c.T = 0.9; c.vapor = 1.1; c.cloud = 0.9; c.soil = 0.2; c.windU = 0;
  const soilBefore = c.soil;
  const vaporBefore = c.vapor;
  const runoffBefore = cl.runoff;
  // One second: heavy condensation + rain, no advection (wind 0), no evap (soil small but present — measure it).
  tickClimate(world, 1, world.climateGeo);
  const rain = c.rain;
  assert.ok(rain > 0, 'it rained');
  const soilGained = c.soil - soilBefore;
  // Soil gained ≈ 85% of rain, minus that tick's evap/drain (small); runoff ≈ 15%.
  const runoffGained = cl.runoff - runoffBefore;
  assert.ok(Math.abs(runoffGained - rain * 0.15) < rain * 0.15 * 0.05,
    `runoff ≈ 15% of rain: ${runoffGained} vs ${rain * 0.15} (orographic drizzle elsewhere)`);
  assert.ok(soilGained > rain * 0.85 - 0.01, `soil ≈ 85%: gained ${soilGained} on rain ${rain}`);
});

test('v0.23: jungle out-rains desert on ≥2/3 seeds (Paul §5.2 shape)', () => {
  let jungleWins = 0;
  for (const seed of [7, 42, 77]) {
    const world = climWorld(seed);
    // 12 sim-hours of sky: 300 ticks × 1s... use 600 × 2s for speed parity.
    for (let t = 0; t < 600; t++) tickClimate(world, 2, world.climateGeo);
    const cl = world.climate;
    let jungleRain = 0, desertRain = 0;
    for (let i = 0; i < WEATHER_COLS; i++) {
      const cx = (i + 0.5) * WEATHER_COL_W;
      if (cx >= 1200 && cx < 1800) jungleRain += cl.cols[i].rain;
      if (cx >= 2400 && cx < 3000) desertRain += cl.cols[i].rain;
    }
    if (jungleRain > desertRain * 1.5) jungleWins++;
  }
  assert.ok(jungleWins >= 2, `jungle out-rained desert on ${jungleWins}/3 seeds`);
});

test('v0.23: climate is deterministic — lockstep over 300 ticks', () => {
  const a = climWorld(99, 6), b = climWorld(99, 6);
  for (let t = 0; t < 300; t++) {
    tickClimate(a, 1, a.climateGeo);
    tickClimate(b, 1, b.climateGeo);
  }
  for (let i = 0; i < WEATHER_COLS; i++) {
    for (const k of ['T', 'vapor', 'cloud', 'soil', 'windU']) {
      assert.equal(a.climate.cols[i][k], b.climate.cols[i][k], `col ${i}.${k} diverged`);
    }
  }
});

test('v0.23: √dt stability — kicks scale, reversion anchors (Paul §5.4)', () => {
  // Different dt ⇒ different noise realizations, so compare STATISTICS:
  // √dt kicks keep the walk's variance dt-independent; dt reversion keeps
  // the mean on the diurnal target. 10s physics ticks and per-frame ticks
  // must agree in distribution, not in draw sequence.
  const series = (seed, dt, n) => {
    const w = climWorld(seed, 4);
    const ts = [];
    for (let t = 0; t < n; t++) { tickClimate(w, dt, w.climateGeo); ts.push(w.climate.cols[20].T); }
    const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
    const sd = Math.sqrt(ts.reduce((a, b) => a + (b - mean) ** 2, 0) / ts.length);
    return { mean, sd };
  };
  const a = series(5, 1, 500);   // 500 sim-seconds at 1s
  const b = series(5, 10, 50);   // 500 sim-seconds at 10s
  assert.ok(Math.abs(a.mean - b.mean) < 0.03, `means agree: ${a.mean} vs ${b.mean}`);
  assert.ok(Math.abs(a.sd - b.sd) / Math.max(a.sd, 1e-6) < 0.6, `stds agree: ${a.sd} vs ${b.sd}`);
});

test('v0.23: lightning is a logged physical event (position + timestamp)', () => {
  const world = climWorld(7);
  const cl = world.climate;
  const c = cl.cols[27]; // desert
  let struck = false;
  for (let t = 0; t < 2000 && !struck; t++) {
    c.cloud = 1.0; c.T = 1.0; c.windU = 0; // driven storm: hold the column convective
    tickClimate(world, 1, world.climateGeo);
    struck = cl.lightning.length > 0;
  }
  assert.ok(struck, 'a storm column discharged within 2000 ticks');
  const s = cl.lightning[0];
  assert.ok(Number.isFinite(s.x) && s.x >= 2600 && s.x <= 2900, `strike x=${s.x} in the desert column`);
  assert.ok(Number.isFinite(s.t), `strike t=${s.t}`);
  const ev = world.events.find((e) => e.type === 'lightning');
  assert.ok(ev, 'lightning chronicle-logged to world.events');
});

test('v0.23: wind pushes an airborne glider (execution probe)', async () => {
  const { integrateGravity } = await import('../src/sim/creature.js');
  const world = climWorld(7);
  const calm = climWorld(7);
  for (const c of calm.climate.cols) { c.windU = 0; c.cloud = 0; }
  const mkGlider = (w) => ({
    x: 2100, y: 100, vx: 0, vy: 0, grounded: false, gliding: true,
    facing: 1, pheno: { glideLift: 0.5 }, bodyPlan: {}, platformIndex: -1,
    health: { injury: 0, adrenaline: 0 }, biochem: { injury: 0, adrenaline: 0 },
    flinchT: 0, reward: 0,
  });
  const g1 = mkGlider(), g2 = mkGlider();
  // Wind 80 (clamp max): the gale-blown glider must travel well east of the
  // still-air one — the air is real for every airborne body.
  world.climate.cols.forEach((c) => { c.windU = 80; });
  for (let t = 0; t < 300; t++) {
    integrateGravity(g1, world, 1 / 60);
    integrateGravity(g2, calm, 1 / 60);
    if (g1.grounded || g2.grounded) break;
  }
  assert.ok(g1.x > g2.x + 5, `gale ${g1.x.toFixed(1)} vs calm ${g2.x.toFixed(1)}`);
});

test('v0.23: drought withers plants', () => {
  const world = climWorld(7);
  bindWorld(world);
  const cl = world.climate;
  // Bone-dry desert column.
  for (let i = 24; i < 30; i++) { cl.cols[i].soil = 0.0; cl.cols[i].vapor = 0.1; cl.cols[i].cloud = 0; }
  world.plants = [{ x: 2700, platformIndex: 26, y: 830, growth: 1, fruitTimer: 999, sway: 0, zone: 'desert', kind: 'plant',
    pheno: { growthRate: 0.5, interval: 0.5, waterRet: 0.5, coldTol: 0.5, saltTol: 0.5 } }];
  assert.ok(droughtStressAt(world, 2700) > 0.9, 'desert column is drought-stressed');
  const g0 = world.plants[0].growth;
  for (let t = 0; t < 600; t++) tickWorld(world, 1);
  assert.ok(world.plants[0].growth < g0, `drought withered the plant: ${g0} → ${world.plants[0].growth}`);
});

// --- v0.25 "Heat": the temperature field lives --------------------------------

test('v0.25: thermal mass — water columns change temperature slower than land', () => {
  const world = climWorld(7);
  const cl = world.climate;
  cl.vents = []; // isolate: no vent heating
  for (const c of cl.cols) c.T = 0.5;
  for (let i = 0; i < WEATHER_COLS; i++) cl.baseT[i] = 0.9; // step up everywhere
  tickClimate(world, 10, world.climateGeo);
  let landD = 0, landN = 0, waterD = 0, waterN = 0;
  for (let i = 0; i < WEATHER_COLS; i++) {
    const d = cl.cols[i].T - 0.5;
    if (cl.thermalMass[i] > 2) { waterD += d; waterN++; }
    else { landD += d; landN++; }
  }
  assert.ok(landN > 0 && waterN > 0, 'both land and water columns exist');
  const landMean = landD / landN, waterMean = waterD / waterN;
  assert.ok(landMean > waterMean * 2,
    `land warms faster than water: land Δ${landMean.toFixed(3)} vs water Δ${waterMean.toFixed(3)}`);
});

test('v0.25: volcanic vents are seeded heat sources with distance falloff', () => {
  const a = climWorld(7), b = climWorld(7);
  assert.deepEqual(a.climate.vents, b.climate.vents, 'vent placement is deterministic');
  assert.equal(a.climate.vents.length, VENT_COUNT, `${VENT_COUNT} vents per world`);
  for (const v of a.climate.vents) {
    assert.ok(a.climateGeo.waterFrac(v.x) < 0.25, `vent @${v.x.toFixed(0)} sits on land`);
    assert.ok(v.x >= 60 && v.x <= 1140, `vent @${v.x.toFixed(0)} in the geothermal zone (arctic/mountains)`);
    assert.ok(v.dT > 0.2 && v.dT < 0.35, `vent dT sane: ${v.dT}`);
  }
  // Heating with falloff: flat field, vents on.
  const world = climWorld(7);
  const cl = world.climate;
  for (const c of cl.cols) { c.T = 0.5; c.vapor = 0.3; c.cloud = 0.2; c.soil = 0.4; c.windU = 0; }
  for (let i = 0; i < WEATHER_COLS; i++) cl.baseT[i] = 0.5;
  for (let t = 0; t < 600; t++) tickClimate(world, 2, world.climateGeo);
  const v = cl.vents[0];
  const tAt = (x) => cl.cols[Math.max(0, Math.min(WEATHER_COLS - 1, Math.floor(x / WEATHER_COL_W)))].T;
  const nearT = tAt(v.x), midT = tAt(v.x + 400), farT = tAt(v.x + 1200);
  assert.ok(nearT > farT + 0.1, `vent warms its column: near ${nearT.toFixed(2)} vs far ${farT.toFixed(2)}`);
  assert.ok(nearT >= midT && midT >= farT - 0.03, `falloff with distance: ${nearT.toFixed(2)} ≥ ${midT.toFixed(2)} ≥ ~${farT.toFixed(2)}`);
  // No volcanic biome exists: the Whittaker lookup has no such key.
  for (let i = 0; i < WEATHER_COLS; i++) {
    const k = whittakerKey(cl.cols[i].T, cl.cols[i].soil, null);
    assert.notEqual(k, 'volcanic', 'there is no volcanic biome');
  }
});

test('v0.25: T diffusion is slow, stable, and conserves heat', () => {
  const world = climWorld(7);
  const cl = world.climate;
  for (const c of cl.cols) c.T = 0.5;
  cl.cols[20].T = 0.9;
  // Heat is Σ(m·T): diffusion moves heat, not temperature (v0.27: the
  // diffusion term is mass-aware, like the reversion and vent terms).
  const heat = () => cl.cols.reduce((s, c, i) => s + c.T * (cl.thermalMass ? cl.thermalMass[i] : 1), 0);
  const before = heat();
  diffuseT(cl, 10);
  const after = heat();
  assert.ok(Math.abs(after - before) < 1e-9, `diffusion conserves heat: ${before} → ${after}`);
  assert.ok(cl.cols[20].T < 0.9 && cl.cols[20].T > 0.5, 'the spike decays toward its neighbors');
  assert.ok(cl.cols[19].T > 0.5 && cl.cols[21].T > 0.5, 'neighbors warm');
  assert.ok(cl.cols[19].T < 0.6 && cl.cols[21].T < 0.6, 'slow: one 10s tick moves little');
  // Stability: an absurd dt cannot blow the field up.
  for (const c of cl.cols) c.T = 0.5;
  cl.cols[20].T = 1.0;
  diffuseT(cl, 3600);
  for (const c of cl.cols) {
    assert.ok(Number.isFinite(c.T) && c.T >= 0 && c.T <= 1, `stable at dt=3600: col T=${c.T}`);
  }
});
