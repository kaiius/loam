// Canopy v0.27 "Seasons" — the year as a slow radiative forcing on the T field.
//
// These tests pin the seasonal contract:
//   - the clock is (t mod YEAR)/YEAR (no floating-point phase drift);
//   - the forcing moves the REVERSION TARGET, not T (no heat pump —
//     year-over-year mean T is stable);
//   - per-biome amplitude (desert swings, jungle breathes, water buffers);
//   - vents are absolute geothermal sources, exempt from the season;
//   - the vent equilibrium offset is exactly vent.dT at ANY thermal mass
//     (the v0.27 thermal-mass correction);
//   - rain efficiency rides the seasonal wave (wet summers, dry winters);
//   - the fur-insulation singularity is unreachable (genome caps at 0.3,
//     bears at 0.3, driftK has a floor);
//   - basking gain and breeding chance follow the seasonal clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, bindWorld, populate } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome, phenotype, GENES } from '../src/sim/genome.js';
import { createBiochem, tickBiochem } from '../src/sim/biochem.js';
import { spawnPredators } from '../src/sim/creature.js';
import {
  createClimate, tickClimate, applyVentHeat,
  seasonPhase, seasonSun, seasonBreedMul, ensureSeasonClock,
  SEASON_AMP_MAX, SEASON_MIN_YEAR, SEASON_MAX_YEAR,
  WEATHER_COL_W,
} from '../src/sim/weather.js';
import { biomeKeyAt } from '../src/sim/biomes.js';

// Minimal harness for tickClimate: plants, time, events, geo (same shape
// test/weather.mjs uses).
function climWorld(seed = 7) {
  const world = createWorld(seed);
  bindWorld(world);
  world.plants = [];
  return world;
}

function setPhase(world, phase) {
  const Y = world.climate.yearLength || 1200;
  world.time = phase * Y;
}

// tickClimate reads world.time but never advances it (only tickWorld does).
// This helper advances the clock exactly as a live sim would.
function tickSeason(world, dt) {
  tickClimate(world, dt, world.climateGeo);
  world.time += dt;
}

// ---- the seasonal clock ----

test('v0.27: seasonal clock — phase is (t mod YEAR)/YEAR, deterministic at large t', () => {
  const world = climWorld(7);
  world.climate.yearLength = 1200;
  setPhase(world, 0);
  assert.equal(seasonPhase(world), 0, 'phase 0 at t=0');
  world.time = 1200;
  assert.equal(seasonPhase(world), seasonPhase({ ...world, time: 0 }), 't and t+YEAR agree exactly');
  world.time = 1e7;
  const ph = seasonPhase(world);
  assert.ok(Number.isFinite(ph) && ph >= 0 && ph < 1, `phase finite and bounded at t=1e7: ${ph}`);
  const again = seasonPhase({ ...world, time: 1e7 + 1200 });
  assert.equal(ph, again, 'no floating-point phase drift across a year at large t');
});

test('v0.27: year length — 1200 with no creatures, median founder lifespan otherwise', () => {
  const bare = climWorld(7); // no creatures
  assert.equal(ensureSeasonClock(bare.climate, bare), 1200, 'no creatures → 1200');
  // Founders: median of founder lifespanSec, clamped to [2 days, 8 days].
  const world = bindWorld(createWorld(7));
  populate(world);
  const lifes = world.creatures.filter((c) => !c.parents && c.pheno && c.pheno.lifespanSec > 0)
    .map((c) => c.pheno.lifespanSec).sort((a, b) => a - b);
  assert.ok(lifes.length > 0, 'founders exist');
  const expected = Math.max(SEASON_MIN_YEAR, Math.min(SEASON_MAX_YEAR, lifes[lifes.length >> 1]));
  assert.equal(ensureSeasonClock(world.climate, world), expected,
    `yearLength = clamped median founder lifespan: ${expected.toFixed(0)}s`);
});

// ---- forcing enters via the reversion target (no heat pump) ----

test('v0.27: annual mean T is stable across years — the forcing is a boundary, not a pump', () => {
  const world = climWorld(7);
  ensureSeasonClock(world.climate, world);
  const Y = world.climate.yearLength;
  const meanT = () => {
    let s = 0;
    for (const c of world.climate.cols) s += c.T;
    return s / world.climate.cols.length;
  };
  const yearMean = (yearIdx) => {
    setPhase(world, 0);
    world.time = yearIdx * Y; // jump the clock — T state is continuous
    let acc = 0, n = 0;
    const steps = Math.floor(Y / 2);
    for (let t = 0; t < steps; t++) {
      tickSeason(world, 2);
      acc += meanT(); n++;
    }
    return acc / n;
  };
  const m0 = yearMean(0); // includes the initial transient — discarded
  const m1 = yearMean(1);
  const m2 = yearMean(2);
  void m0;
  assert.ok(Math.abs(m1 - m2) < 0.01,
    `year-over-year mean T stable (no heat pump): ${m1.toFixed(4)} vs ${m2.toFixed(4)}`);
  // And the season actually moves T: track the annual swing of the mean.
  setPhase(world, 0);
  let lo = 1, hi = 0;
  for (let t = 0; t < Math.floor(Y / 2); t++) {
    tickSeason(world, 2);
    const m = meanT();
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  assert.ok(hi - lo > 0.05, `the year has a real thermal swing: ${(hi - lo).toFixed(3)}`);
});

test('v0.27: per-biome seasonal amplitude — desert swings, jungle breathes, water buffers', () => {
  const world = climWorld(7);
  const cl = world.climate;
  let desert = -1, jungle = -1, deep = -1;
  for (let i = 0; i < cl.cols.length; i++) {
    const k = biomeKeyAt((i + 0.5) * WEATHER_COL_W, 800, world.layout);
    if (k === 'desert' && desert < 0) desert = i;
    if (k === 'jungle' && jungle < 0) jungle = i;
    if (k === 'deep' && deep < 0) deep = i;
  }
  assert.ok(desert >= 0 && jungle >= 0, 'found desert and jungle columns');
  assert.equal(cl.seasonAmp[desert], 1.0, 'desert amplitude 1.0');
  assert.equal(cl.seasonAmp[jungle], 0.4, 'jungle amplitude 0.4');
  if (deep >= 0) assert.equal(cl.seasonAmp[deep], 0.35, 'open water buffers at 0.35');
  assert.equal(SEASON_AMP_MAX, 0.3, 'max seasonal swing 0.3 T-units');
});

// ---- vents: thermal-mass-corrected equilibrium, season-exempt ----

test('v0.27: vent equilibrium offset is exactly vent.dT at any thermal mass', () => {
  // The retrospective-review P1: the old vent source skipped the thermalMass
  // divisor, so near-shore vents (mass up to 2) ran up to 2× hotter than the
  // "exactly vent.dT" comment claimed. Replicate tickClimate §1 (reversion)
  // + §1b (applyVentHeat) on a 3-column hand-built climate.
  const cl = createClimate(7, 3);
  cl.baseT = [0.5, 0.5, 0.5];
  cl.seasonAmp = [0, 0, 0]; // no seasonal forcing in this probe
  cl.thermalMass = [1, 2, 5];
  for (const c of cl.cols) c.T = 0.5;
  cl.vents = [{ x: 1.5 * WEATHER_COL_W, dT: 0.2, sigma: 1e9 }]; // uniform source
  for (let t = 0; t < 4000; t++) {
    for (let i = 0; i < 3; i++) {
      const c = cl.cols[i];
      c.T += (0.5 - c.T) * Math.min(1, 2 * 0.02 / cl.thermalMass[i]);
    }
    applyVentHeat(cl, 2);
  }
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(cl.cols[i].T - 0.7) < 0.02,
      `column mass=${cl.thermalMass[i]}: offset ${((cl.cols[i].T - 0.5)).toFixed(3)} ≈ dT 0.2`);
  }
});

test('v0.27: vents are exempt from seasonal forcing — the offset holds in summer and winter', () => {
  // Flatten the field (the v0.25 pattern): uniform baseT and uniform
  // seasonal amplitude, so vent-vs-far is a pure vent offset at any phase.
  const world = climWorld(7);
  ensureSeasonClock(world.climate, world);
  const cl = world.climate;
  for (const c of cl.cols) { c.T = 0.5; c.vapor = 0.3; c.cloud = 0.2; c.soil = 0.4; c.windU = 0; }
  for (let i = 0; i < cl.cols.length; i++) { cl.baseT[i] = 0.5; cl.seasonAmp[i] = 0.6; }
  const v = cl.vents[0];
  assert.ok(v, 'worldgen placed at least one vent');
  const tAt = (x) => cl.cols[Math.max(0, Math.min(cl.cols.length - 1, Math.floor(x / WEATHER_COL_W)))].T;
  const offsetAt = (phase) => {
    setPhase(world, phase); // hold the phase — equilibrate against it
    for (let t = 0; t < 700; t++) tickClimate(world, 2, world.climateGeo);
    return tAt(v.x) - tAt(v.x + 1200);
  };
  const summer = offsetAt(0.25), winter = offsetAt(0.75);
  assert.ok(Math.abs(summer - v.dT) < 0.06,
    `summer vent offset ≈ dT: ${summer.toFixed(3)} vs ${v.dT.toFixed(3)}`);
  assert.ok(Math.abs(winter - v.dT) < 0.06,
    `winter vent offset ≈ dT: ${winter.toFixed(3)} vs ${v.dT.toFixed(3)}`);
});

// ---- water cycle rides the same clock ----

test('v0.27: rain efficiency rides the seasonal wave — wet summers, dry winters', () => {
  const world = climWorld(7);
  ensureSeasonClock(world.climate, world);
  const cl = world.climate;
  const measure = (phase) => {
    setPhase(world, phase);
    for (const c of cl.cols) { c.cloud = 0.5; c.soil = 0; }
    tickClimate(world, 2, world.climateGeo);
    let s = 0;
    for (const c of cl.cols) s += c.soil;
    return s / cl.cols.length;
  };
  const summer = measure(0.25), winter = measure(0.75);
  const ratio = summer / Math.max(winter, 1e-6);
  assert.ok(ratio > 2.2 && ratio < 4.2,
    `summer rains ~3× winter (rate modulation): ${summer.toFixed(4)} vs ${winter.toFixed(4)}`);
});

// ---- the fur-insulation singularity is unreachable ----

test('v0.27: fur insulation caps at 0.3 — genome and bears alike', () => {
  const rng = createRng(99);
  const g = randomGenome(rng);
  g.alleles.fur = [1, 1]; // max fur
  const p = phenotype(g);
  assert.equal(p.furInsulation, 0.3, 'genome max-fur → exactly 0.3 (fur*0.3, clamp01)');
  const world = bindWorld(createWorld(18001));
  spawnPredators(world);
  for (const b of world.predators.filter((pr) => pr.kind === 'bear')) {
    assert.equal(b.pheno.furInsulation, 0.3, 'bears at the physiological max, not the 1.0 singularity');
  }
});

test('v0.27: driftK has a floor — the chemistry cannot degenerate', () => {
  const rng = createRng(99);
  const g = randomGenome(rng);
  const p = phenotype(g);
  p.furInsulation = 0.99; // unreachable via any real path — defense-in-depth
  const b = createBiochem();
  for (let t = 0; t < 100; t++) {
    tickBiochem(b, p, 1, { ambientTemp: 0.9, active: 0.3 });
  }
  assert.ok(Number.isFinite(b.coreTemp) && Number.isFinite(b.health),
    'no NaN, no rail even at unreachable insulation');
  assert.ok(b.coreTemp < 1, 'still couples to ambient (floor, not zero)');
});

// ---- basking and breeding follow the clock ----

test('v0.27: seasonSun — 1.0 summer solstice, 0.2 winter', () => {
  const world = climWorld(7);
  world.climate.yearLength = 1200;
  setPhase(world, 0.25);
  assert.ok(Math.abs(seasonSun(world) - 1.0) < 1e-9, 'summer solstice: full insolation');
  setPhase(world, 0.75);
  assert.ok(Math.abs(seasonSun(world) - 0.2) < 1e-9, 'winter solstice: 0.2');
  setPhase(world, 0);
  assert.ok(Math.abs(seasonSun(world) - 0.6) < 1e-9, 'spring equinox: 0.6');
});

test('v0.27: seasonBreedMul — 1.0 spring, 0.6 autumn (a pull, not a gate)', () => {
  const world = climWorld(7);
  world.climate.yearLength = 1200;
  setPhase(world, 0);
  assert.ok(Math.abs(seasonBreedMul(world) - 1.0) < 1e-9, 'spring equinox: full fertility');
  setPhase(world, 0.5);
  assert.ok(Math.abs(seasonBreedMul(world) - 0.6) < 1e-9, 'autumn equinox: 0.6');
});

test('v0.27: basking pays more in summer than winter (unit pin of the factor)', () => {
  const run = (seasonSunFrac) => {
    const rng = createRng(99);
    const g = randomGenome(rng); g.alleles.fur = [0.5, 0.5];
    const p = phenotype(g);
    const b = createBiochem(); b.coreTemp = 0.5;
    for (let t = 0; t < 60; t++) {
      tickBiochem(b, p, 1, { ambientTemp: 0.7, heat: 0.3, active: 0, basking: 1, cloud: 0, seasonSun: seasonSunFrac });
    }
    return b.coreTemp;
  };
  const summer = run(1.0), winter = run(0.2);
  assert.ok(summer > winter + 0.05,
    `summer basking warms more: ${summer.toFixed(3)} vs winter ${winter.toFixed(3)}`);
});

test('v0.27: no new senses, no new actions — exactly one new locus (pantCapacity)', () => {
  // The genome is 230 loci (pinned in test/sim.mjs): the seasons build adds
  // exactly one gene — pantCapacity, the evaporative-cooling reflex. It was
  // not in the original seasons design; the v0.22 vulture QA gate regressed
  // under the seasonal climate and the design space contained no survivable
  // vulture genotype, so the panting reflex opened one (founder economics).
  assert.equal(GENES.length, 233, 'v0.30: + speciesTag');
});
