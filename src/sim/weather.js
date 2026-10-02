// v0.23 "Weather" — the sky as physics, not paint.
//
// The world carries a per-column climate field: temperature (T), atmospheric
// vapor, cloud cover, soil moisture, and wind. Every flux is donor-limited
// and two-sided, so water is conserved by construction; the sea and the water
// table are LABELED boundary sinks/sources (nothing vanishes silently).
//
// Debts acknowledged in-code: the donor-limited advection flux, the √dt-kick /
// dt-reversion stability convention, the 85/15 rain split, and the linearized
// Clausius–Clapeyron saturation are Paul's Wildcode v0.17 patterns, re-derived
// here for Canopy's column field (see ~/workspace/paul-review/
// wildcode-v017-review.md §5). Canopy keeps its own stronger invariant: the
// global mass ledger (v0.24) will audit total water, which Paul's local audits
// cannot see.
//
// Biomes are EMERGENT: whittakerKey(T, M, water, elev) maps the generated
// temperature/moisture field through a Whittaker lookup. The painted BIOMES
// table survives only as the initial condition (initClimateFromPainted) and
// as the pure-geography fallback when no climate state exists. Biomes drift
// as the climate evolves; creatures read experienced T/M, not labels.

import { createRng } from './rng.js';

export const WEATHER_COL_W = 100;
export const WEATHER_COLS = 48; // WORLD_W 4800 / 100
export function NC(climate) { return (climate && climate.ncols) || WEATHER_COLS; }

// Canonical climate per painted biome — the INITIAL condition only.
// T is on the biochem's ambient scale (0..1, 0.5 neutral): the experienced
// temperature feeds coreTemp directly, so the seed reproduces the painted
// thermal behavior exactly at worldgen (founder eq 0.797 < 0.80 hyper in the
// jungle, arctic survivable at rest). Thresholds in whittakerKey are tuned so
// these eight seed points map back to their painted keys with margin
// (pinned by test/weather.mjs); the field then evolves by physics.
export const CLIMATE_SEED = {
  arctic:      { T: 0.05, M: 0.45 },
  mountains:   { T: 0.38, M: 0.55 },
  jungle:      { T: 0.55, M: 0.85 },
  plains:      { T: 0.60, M: 0.45 },
  desert:      { T: 1.00, M: 0.15 },
  shallows:    { T: 0.62, M: 0.80 },
  archipelago: { T: 0.58, M: 0.60 },
  deep:        { T: 0.45, M: 0.70 },
};

// --- field construction -------------------------------------------------

// v0.26: the column count scales with world size (100px columns across the
// generated width). climate.ncols is the live count; the NC() helper reads
// it with a fallback to WEATHER_COLS for hand-built climates.
export function createClimate(seed, ncols = WEATHER_COLS) {
  const cols = [];
  for (let i = 0; i < ncols; i++) {
    const cx = (i + 0.5) * WEATHER_COL_W;
    cols.push({ T: 0.5, vapor: 0.3, cloud: 0.2, soil: 0.4, windU: baseWindU(cx), rain: 0 });
  }
  return {
    cols,
    ncols,
    // v0.9 decorRng lesson, v0.14 teacherRng lesson: the sky draws from its
    // OWN pinned sub-stream. Weather must never shift the main stream's
    // sequence (founder genomes, brain rolls, etc.).
    rng: createRng((seed * 1009 + 5) >>> 0),
    baseT: new Array(ncols).fill(0.5), // slow climate baseline per column
    wet: new Array(ncols).fill(1.0),   // biome wetness factor (saturation)
    lightning: [], // { x, t } — physical events, chronicle-logged
    runoff: 0,     // labeled boundary sink: rain runoff to the sea
    drainage: 0,   // labeled boundary sink: soil drainage to the water table
    waterTable: 0, // v0.24: deep groundwater pool — leached fertility and
                   // capped-soil overflow land here (transfer, never deleted)
    meanCloud: 0,  // updated each tick — the cloud-shading feedback reads this
    tick: 0,
    // v0.25 "Heat": thermal mass per column (water slow, land fast) — built
    // lazily in tickClimate from geography, so it never disturbs the rng
    // sequence. Volcanic vents — explicit worldgen heat sources, NOT a
    // biome (there is no volcanic biome; the Whittaker lookup reads
    // whatever T results).
    thermalMass: null,
    vents: [], // { x, dT, sigma } — placed by placeVents at worldgen
  };
}

// v0.25 "Heat": place volcanic vents — explicit, seeded worldgen heat
// sources with Gaussian distance falloff.
//
// RNG hygiene: vents draw from their OWN sub-stream
// (createRng(world.seed ^ VENT_SEED_XOR)), not the climate's — vent
// placement must not shift the post-worldgen weather-noise draw sequence
// (a 4-draw shift once flipped a knife-edge vulture QA pin by changing
// the cloud/wind realization, not the physics). Deterministic per seed.
//
// Placement (a founder-economics decision): vents live in the GEOTHERMAL
// ZONE — arctic + mountains (the volcanic arc and the geothermal north,
// physically where vents belong). v0.26: the zone is read from the
// generated layout (60px insets, verbatim at size 1); the lowland founder
// biomes (jungle/plains/desert) stay vent-free: the v0.22 QA pins establish
// the plains as the vultures' thermal home (ambient 0.6), and a vent in the
// middle of a founder platform would rewrite that biome's thermal regime.
// Land only (waterFrac < 0.25), ≥500px apart, 2 per world.
export const VENT_COUNT = 2;
export const VENT_SIGMA = 250; // px — the warm apron around a vent
export const VENT_MIN_SEP = 500;
const VENT_SEED_XOR = 0x9e3779b9;

export function placeVents(world) {
  const cl = world.climate;
  const rng = createRng((world.seed >>> 0) ^ VENT_SEED_XOR);
  const geo = world.climateGeo;
  // v0.26: geothermal zone = arctic + mountains from the layout.
  const lz = world.layout ? world.layout.zones : null;
  const size = world.layout ? world.layout.size : 1;
  const lo = lz ? lz[0].x0 + 60 * size : 60;
  const hi = lz ? lz[1].x1 - 60 * size : 1140;
  cl.vents = [];
  let guard = 0;
  while (cl.vents.length < VENT_COUNT && guard++ < 300) {
    const x = lo + rng.next() * (hi - lo);
    if (geo && geo.waterFrac && geo.waterFrac(x) >= 0.25) continue;
    if (cl.vents.some((v) => Math.abs(v.x - x) < VENT_MIN_SEP)) continue;
    cl.vents.push({ x, dT: 0.22 + rng.next() * 0.08, sigma: VENT_SIGMA });
  }
  return cl.vents;
}

// v0.25 "Heat": slow, stable diffusion of temperature between neighboring
// columns. Explicit scheme with zero-flux boundaries; k = D*dt is clamped
// far below the 0.5 stability limit, so it cannot go unstable. Two-sided
// like the vapor advection: what leaves one column enters the next —
// diffusion conserves total heat (up to the clamp01 rails, which a sane
// field never touches).
export const THERMAL_DIFF_D = 0.004; // /s — slow

export function diffuseT(climate, dt) {
  const n = NC(climate);
  const k = Math.min(0.4, THERMAL_DIFF_D * dt);
  const d = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const tL = i > 0 ? climate.cols[i - 1].T : climate.cols[i].T;
    const tR = i < n - 1 ? climate.cols[i + 1].T : climate.cols[i].T;
    d[i] = k * (tL + tR - 2 * climate.cols[i].T);
  }
  for (let i = 0; i < n; i++) climate.cols[i].T = clamp01(climate.cols[i].T + d[i]);
}

// Paint the initial field from the painted biome map (world.js passes its
// keyAt). After this, physics owns the field.
export function initClimateFromPainted(climate, keyAt) {
  const rng = climate.rng;
  for (let i = 0; i < NC(climate); i++) {
    const cx = (i + 0.5) * WEATHER_COL_W;
    const k = keyAt(cx, 800) || 'jungle';
    const s = CLIMATE_SEED[k] || CLIMATE_SEED.jungle;
    const c = climate.cols[i];
    c.T = clamp01(s.T + rng.range(-0.02, 0.02));
    c.soil = clamp01(s.M + rng.range(-0.05, 0.05));
    c.vapor = clamp01(0.25 + s.M * 0.5 + rng.range(-0.05, 0.05));
    c.cloud = clamp01(0.15 + s.M * 0.3);
    c.windU = baseWindU(cx) + rng.range(-8, 8); // ITCZ regimes, +x eastward
    climate.baseT[i] = c.T;
    climate.wet[i] = 0.5 + s.M; // dry biomes saturate easier, wet biomes hold more
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function colAt(climate, x) {
  const i = Math.max(0, Math.min(NC(climate) - 1, Math.floor(x / WEATHER_COL_W)));
  return climate.cols[i];
}

// Temperature in °C for the Whittaker lookup: T=0 → −10°C, T=1 → 35°C.
export function tempCOf(T) { return -10 + 45 * T; }

// --- emergent biomes: the Whittaker lookup --------------------------------
//
// waterKey: 'shallows' | 'archipelago' | 'deep' | null (from water geography —
// water bodies are geography, not climate). Altitude enters through T: callers
// pass the lapse-adjusted temperature for high positions (tempAt does this).
export function whittakerKey(T, M, waterKey) {
  if (waterKey) return waterKey;
  const tempC = tempCOf(T);
  if (tempC < 2) return 'arctic';
  if (tempC < 10) return M < 0.32 ? 'plains' : 'mountains';
  if (tempC < 24) return M < 0.62 ? 'plains' : 'jungle'; // grassland vs forest
  // Hot: the desert/savanna/rainforest split.
  if (M < 0.30) return 'desert';
  if (M < 0.60) return 'plains';
  return 'jungle';
}

// --- accessors: experienced climate, not labels ---------------------------

export function tempAt(world, x, y = 800) {
  const c = colAt(world.climate, x);
  // Altitude lapse: the air thins and cools above the ground (~800).
  const lapse = Math.max(0, 800 - y) / 550;
  return clamp01(c.T - lapse * 0.30);
}

export function moistureAt(world, x) { return colAt(world.climate, x).soil; }
export function vaporAt(world, x) { return colAt(world.climate, x).vapor; }
export function cloudAt(world, x) { return colAt(world.climate, x).cloud; }
export function windAt(world, x) { return colAt(world.climate, x).windU; }
export function rainRateAt(world, x) { return colAt(world.climate, x).cloud; }

// Drought stress 0..1: soil moisture below 0.12 stresses plants (Paul's gate).
export function droughtStressAt(world, x) {
  const s = colAt(world.climate, x).soil;
  return s < 0.12 ? (0.12 - s) / 0.12 : 0;
}

// --- the tick --------------------------------------------------------------

const EVAP_BASE = 0.00006;  // per-tick vapor rate at T=0 (Paul's constant)
const EVAP_WARM = 0.00022;  // additional rate at T=1 (Paul's constant)
const BIO_EVAP_K = 0.9;     // evapotranspiration: biomass breathes water skyward
const WATER_EVAP_K = 2.0;   // open water evaporates freely (boundary source)
const VAPOR_GAIN = 1.0;     // soil→vapor unit conversion — LABELED, 1:1 by construction
const RAIN_RATE = 0.02;     // cloud → rain per second at full overcast
const RAIN_SOIL = 0.85;     // 85% of rain soaks in; 15% runs off (Paul's split)
const DRAIN_K = 6e-7;       // soil drainage ≈5%/day to the water table (Paul's constant)
const ADVECT_K = 0.0001;   // vapor advection per (px/s) wind — 10x slower than
                            // Paul's 0.001: at 0.001 the 20px/s westerly flushes
                            // each column in 50s, far faster than evap can
                            // resupply, so vapor never reaches saturation and
                            // nothing ever rains (jungle desertifies)
const LIFT_K = 0.000004;    // orographic lift: windward condensation per px rise
const LIGHTNING_P = 0.004;  // strike probability per second at full storm

// The ITCZ: westerlies west of x=1500, easterlies (trades) east of it.
// The trades carry sea moisture WEST to the rainforest — the real Amazon's
// "flying rivers". Where the regimes meet, air converges, rises, and rains.
// (A uniform westerly just flushes every column's vapor to the sea in 50s;
// vapor never reaches saturation and nothing ever rains.)
export function baseWindU(x) {
  const t = Math.max(0, Math.min(1, (x - 1300) / 400));
  return 20 * (1 - t) + (-15) * t;
}

export function tickClimate(world, dt, geo) {
  const cl = world.climate;
  const rng = cl.rng;
  const sdt = Math.sqrt(dt);
  const tod = (world.time / 300) % 1; // DAY_LENGTH = 300
  const diurnal = Math.sin(tod * Math.PI * 2 - Math.PI / 2) * 0.04; // warm afternoon

  // Biomass per column for evapotranspiration ∝ biomass.
  const biomass = new Array(NC(cl)).fill(0);
  for (const p of world.plants) {
    const i = Math.max(0, Math.min(NC(cl) - 1, Math.floor(p.x / WEATHER_COL_W)));
    biomass[i] += (p.growth || 0);
  }

  let cloudSum = 0;

  // 1. Temperature: diurnal target, dt mean-reversion, √dt kicks.
  // (Paul §5.4: kicks scale with √dt, reversion with dt — stated once,
  // followed everywhere. Keeps 10s physics ticks and per-frame ticks agreeing.)
  // v0.25 "Heat": thermal mass — water changes temperature slowly, land
  // fast. The sea is a thermal reservoir; the land tracks the sky. Built
  // once from geography (deterministic, no rng draws).
  if (!cl.thermalMass) {
    cl.thermalMass = [];
    for (let i = 0; i < NC(cl); i++) {
      const wf = geo && geo.waterFrac ? geo.waterFrac((i + 0.5) * WEATHER_COL_W) : 0;
      cl.thermalMass.push(1 + 4 * wf); // open water: 5× the thermal inertia
    }
  }
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    const target = clamp01(cl.baseT[i] + diurnal);
    c.T += (target - c.T) * Math.min(1, dt * 0.02 / cl.thermalMass[i]);
    c.T += rng.range(-1, 1) * 0.006 * sdt;
    c.T = clamp01(c.T);
  }

  // 1b. Volcanic vents: explicit worldgen heat sources, Gaussian distance
  // falloff. The rate is written so the equilibrium offset at the vent
  // center is exactly vent.dT (source dT*0.02/s balances reversion 0.02/s)
  // — physics, not a paint job. No volcanic biome exists: the Whittaker
  // lookup reads whatever T results, same as any other warm column.
  if (cl.vents.length) {
    for (let i = 0; i < NC(cl); i++) {
      const cx = (i + 0.5) * WEATHER_COL_W;
      let src = 0;
      for (const v of cl.vents) {
        const dx = cx - v.x;
        src += v.dT * Math.exp(-(dx * dx) / (2 * v.sigma * v.sigma));
      }
      if (src > 0) cl.cols[i].T = clamp01(cl.cols[i].T + src * dt * 0.02);
    }
  }

  // 1c. Slow stable diffusion of T between neighbor columns (v0.25).
  diffuseT(cl, dt);

  // 2. Evaporation: open water + transpiring biomass, DONOR-LIMITED from soil.
  // Convective fraction: in the real world ~half of transpired water rises
  // in thermals and condenses directly (convective parameterization) —
  // it never sits in the vapor pool waiting for saturation. Without this,
  // the vapor equilibrates just below saturation and it never rains.
  const CONV_FRAC = 0.5;
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    const cx = (i + 0.5) * WEATHER_COL_W;
    const rate = (EVAP_BASE + EVAP_WARM * c.T) * (geo.waterFrac(cx) * WATER_EVAP_K + biomass[i] * BIO_EVAP_K);
    const draw = Math.min(c.soil, rate * dt);
    c.soil -= draw;
    c.vapor += draw * (1 - CONV_FRAC) * VAPOR_GAIN;
    c.cloud += draw * CONV_FRAC; // capped in the 3b normalization pass (never deleted)
  }

  // 3. Saturation, condensation, orographic lift, rain.
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    const cx = (i + 0.5) * WEATHER_COL_W;
    // Linearized Clausius–Clapeyron: warm air holds more (Paul §1).
    const sat = (0.30 + 0.55 * c.T) * (0.75 + 0.25 * Math.min(1.5, cl.wet[i]));
    // Orographic lift: wind blowing INTO rising terrain forces condensation;
    // the lee side dries (rain shadow) via the warmed, descended air.
    const j = Math.max(0, Math.min(NC(cl) - 1, i + Math.sign(c.windU)));
    const dElev = geo.terrainElev((j + 0.5) * WEATHER_COL_W) - geo.terrainElev(cx);
    if (dElev > 0 && Math.abs(c.windU) > 1) {
      const lift = dElev * Math.abs(c.windU) * LIFT_K * c.vapor * dt;
      const l = Math.min(c.vapor, lift);
      c.vapor -= l;
      c.cloud += l; // capped in the 3b normalization pass (never deleted)
    } else if (dElev < -50 && Math.abs(c.windU) > 1) {
      // Rain shadow: descending air warms and dries — nudge T up, vapor down.
      c.T = clamp01(c.T + dt * 0.0005);
    }
    const excess = c.vapor - sat;
    if (excess > 0) {
      const cond = excess * Math.min(1, dt * 1.5);
      c.vapor -= cond;
      c.cloud += cond; // 1:1 — condensation is a transfer, not a sink (capped in 3b)
    }
    // Rain: cloud → soil (85%) + runoff to the sea (15%, LABELED sink).
    // Soil-cap overflow joins the runoff (never deleted — v0.24 cap rule).
    const rain = Math.min(c.cloud, c.cloud * RAIN_RATE * dt);
    c.cloud -= rain;
    c.rain += rain; // per-column accumulator — the emergent-rainfall probe reads this
    const rainAdd = rain * RAIN_SOIL;
    const rainSpace = Math.max(0, 1 - c.soil);
    c.soil += Math.min(rainSpace, rainAdd);
    cl.runoff += rain * (1 - RAIN_SOIL) + Math.max(0, rainAdd - rainSpace);
    cloudSum += Math.min(1, c.cloud);
  }

  // 3b. Caps never delete (v0.24, Paul's cap rule): supersaturated vapor
  // condenses to cloud; cloud overflow rains out immediately (85/15).
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    if (c.vapor > 1.15) { c.cloud += c.vapor - 1.15; c.vapor = 1.15; }
    if (c.cloud > 1.2) {
      const ex = c.cloud - 1.2; c.cloud = 1.2;
      c.rain += ex;
      const add = ex * RAIN_SOIL;
      const space = Math.max(0, 1 - c.soil);
      c.soil += Math.min(space, add);
      cl.runoff += ex * (1 - RAIN_SOIL) + Math.max(0, add - space);
    }
    if (c.vapor < 0) c.vapor = 0;
    if (c.cloud < 0) c.cloud = 0;
  }

  // 4. Advection: donor-limited, written as a two-sided flux — what leaves one
  // cell enters the next (Paul §5.3, verbatim shape). Mass cannot leak between
  // the read and the write. v0.24: the flux MAGNITUDE is always positive and
  // donor-limited; the wind direction only picks the recipient neighbor.
  // (The old sign-carrying formula went backwards on westward wind and drove
  // the upwind column's vapor negative — the ledger caught the phantom mass
  // the 3b clamp then fabricated.)
  const flux = new Array(NC(cl)).fill(0);
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    const j = i + Math.sign(c.windU);
    if (j < 0 || j >= NC(cl) || c.windU === 0) continue;
    const f = Math.abs(c.windU) * ADVECT_K * dt * c.vapor;
    flux[i] = Math.min(f, c.vapor); // donor-limited
  }
  for (let i = 0; i < NC(cl); i++) {
    if (flux[i] === 0) continue;
    const j = i + Math.sign(cl.cols[i].windU);
    cl.cols[i].vapor -= flux[i];
    cl.cols[j].vapor += flux[i];
  }

  // 5. Soil drainage ≈5%/day to the water table (LABELED boundary sink).
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    const drain = c.soil * DRAIN_K * dt;
    c.soil -= drain;
    cl.drainage += drain;
  }

  // 6. Wind: slow walk, √dt kicks, dt reversion to the ITCZ baseline.
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    const cx = (i + 0.5) * WEATHER_COL_W;
    c.windU += (baseWindU(cx) - c.windU) * Math.min(1, dt * 0.005);
    c.windU += rng.range(-1, 1) * 2.0 * sdt;
    c.windU = Math.max(-60, Math.min(80, c.windU));
  }

  // 7. Lightning: convective storms discharge. Position + timestamp, logged —
  // the ignition source future Ember (v0.24 'Making') will read. Fire is NOT
  // built here: a strike is a physical event, nothing more.
  for (let i = 0; i < NC(cl); i++) {
    const c = cl.cols[i];
    if (c.cloud > 0.75 && c.T > 0.6) {
      const p = LIGHTNING_P * dt * (c.cloud - 0.75) * 4 * c.T;
      if (rng.next() < p) {
        const x = (i + 0.5) * WEATHER_COL_W + rng.range(-40, 40);
        cl.lightning.push({ x, t: world.time });
        if (world.events) world.events.push({ type: 'lightning', x, t: world.time });
        if (cl.lightning.length > 200) cl.lightning.shift();
      }
    }
  }

  cl.meanCloud = cloudSum / NC(cl);
  cl.tick++;
}

// Total tracked water (vapor + cloud + soil, all columns) — the v0.24 ledger
// will assert this moves only through labeled boundaries.
export function totalWater(climate) {
  let s = 0;
  for (const c of climate.cols) s += c.vapor + Math.min(1, c.cloud) + c.soil;
  return s;
}
