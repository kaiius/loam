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
import { timeOfDay, daylightCurve } from './world.js'; // v0.28: the shared integer-tick day clock
import { SUBSTRATE, SUBSTRATE_PROPS } from './worldgen.js'; // v2: substrate properties

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
    // v0.27 "Seasons": per-column seasonal amplitude (fraction of
    // SEASON_AMP_MAX) — set in initClimateFromPainted from the painted
    // biome key; deserts swing hard, rainforests breathe easy, water
    // buffers. The year's length (ticks) — set lazily on the first
    // tickClimate from the founders' median lifespanSec (no rng draws,
    // deterministic per seed), clamped to [2 days, 8 days].
    seasonAmp: new Array(ncols).fill(0.4),
    yearLength: null,
  };
}

// v0.27 "Seasons": the year as a slow radiative forcing on the T field.
//
// Design (Gemini adversarial review, all six findings folded in):
// - The sine modulates the REVERSION TARGET (the radiative-equilibrium
//   temperature), NOT the T values — the sink stays intact, so this cannot
//   become a heat pump. Annual mean of the forcing is zero by construction.
//   Temperature is not a mass pool, so the ledger doesn't book it; the
//   conservation guarantee is the net-zero construction plus the existing
//   conserving diffusion.
// - Phase derives from (t mod YEAR), never raw t — floating-point phase
//   drift at millions of ticks would break same-seed determinism.
// - The water cycle couples from the SAME clock (T-only forcing would
//   collapse relative humidity into an annual desiccation event): rain
//   efficiency rides the seasonal wave (wet summers, dry winters).
// - Volcanic vents are ABSOLUTE geothermal sources, exempt from the
//   seasonal forcing (separate source term, untouched).
// - No rng draws anywhere in the seasonal path; no new loci (seasons are
//   environmental, responses are environmental multipliers).
export const SEASON_AMP_MAX = 0.3; // T-units of seasonal swing at amplitude 1.0
const SEASON_AMP_BY_BIOME = {
  desert: 1.0, plains: 0.5, jungle: 0.4, mountains: 0.6, arctic: 0.8,
  shallows: 0.35, archipelago: 0.35, deep: 0.35,
};
export const SEASON_MIN_YEAR = 600;  // 2 days — a year never blurs into a day
export const SEASON_MAX_YEAR = 2400; // 8 days

// Seasonal clock. Phase 0 = spring equinox (forcing crosses zero rising),
// 0.25 = summer solstice, 0.5 = autumn equinox, 0.75 = winter solstice.
export function seasonPhase(world) {
  const cl = world.climate;
  const Y = (cl && cl.yearLength) || 1200;
  if (!Number.isFinite(world.time)) return 0; // no clock → spring equinox (neutral)
  return (((world.time % Y) + Y) % Y) / Y;
}
export function seasonSin(world) { return Math.sin(seasonPhase(world) * Math.PI * 2); }
// v0.28 "Day and night": the daylight-gated seasonal forcing — exported for
// testability. amp = per-column T-unit amplitude (seasonAmp × SEASON_AMP_MAX),
// sSin = the seasonal sine (−1..1), dayCurve = the shared daylight curve
// (0 at midnight, 1 at noon). Summer lifts the afternoon; midnight is
// untouched in every season.
export function seasonalForcing(amp, sSin, dayCurve) { return amp * sSin * dayCurve; }
// Basking insolation factor: 1.0 at summer solstice, 0.2 at winter solstice.
// (v0.27: else creatures bypass winter by basking.)
export function seasonSun(world) { return 0.6 + 0.4 * seasonSin(world); }
// Breeding multiplier: 1.0 at spring equinox, 0.6 at autumn equinox —
// founder economics (a pull on the mating chance, never a gate).
export function seasonBreedMul(world) { return 0.8 + 0.2 * Math.cos(seasonPhase(world) * Math.PI * 2); }

// Lazy season-clock init: the year's length is relative to the founders'
// lifespans — a typical founder lives ~1 year, so individuals span seasons
// and birth-season effects are measurable. Median of founder lifespanSec,
// clamped; falls back to 1200 with no creatures. Deterministic per seed.
export function ensureSeasonClock(cl, world) {
  if (cl.yearLength != null) return cl.yearLength;
  const lifes = [];
  for (const c of world.creatures || []) {
    if (!c.parents && c.pheno && c.pheno.lifespanSec > 0) lifes.push(c.pheno.lifespanSec);
  }
  if (!lifes.length) {
    for (const c of world.creatures || []) {
      if (c.pheno && c.pheno.lifespanSec > 0) lifes.push(c.pheno.lifespanSec);
    }
  }
  lifes.sort((a, b) => a - b);
  const med = lifes.length ? lifes[lifes.length >> 1] : 1200;
  cl.yearLength = Math.max(SEASON_MIN_YEAR, Math.min(SEASON_MAX_YEAR, med));
  return cl.yearLength;
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
  const layout = world.layout;
  // v2: geothermal zone = arctic + mountains REGIONS from the generated
  // layout. v1: the painted zones (verbatim).
  let lo, hi;
  const size = layout ? layout.size : 1;
  if (layout && !layout.canonical && layout.regions) {
    let x0 = Infinity, x1 = -Infinity;
    for (const r of layout.regions) {
      if (r.label === 'arctic' || r.label === 'mountains') {
        x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1);
      }
    }
    if (x0 < x1) { lo = x0 + 60 * size; hi = x1 - 60 * size; }
  }
  if (lo === undefined) {
    const lz = layout ? layout.zones : null;
    lo = lz ? lz[0].x0 + 60 * size : 60;
    hi = lz ? lz[1].x1 - 60 * size : 1140;
  }
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

// v0.25 "Heat" (v0.27: thermal-mass-corrected, extracted for testability):
// explicit worldgen heat sources with Gaussian distance falloff. The source
// rate is divided by the column's thermal mass — the SAME divisor as the
// reversion in tickClimate §1 — so the equilibrium offset is exactly
// vent.dT everywhere (source dT*0.02/m balances reversion 0.02/m). Before
// the fix the source was undivided: near-shore vents (thermalMass up to 2)
// ran up to 2× hotter than designed while the comment claimed "exactly
// vent.dT". Vents are ABSOLUTE geothermal sources, exempt from seasonal
// forcing (v0.27): the season moves the reversion target, never the vent.
// No volcanic biome exists: the Whittaker lookup reads whatever T results,
// same as any other warm column.
export function applyVentHeat(cl, dt) {
  if (!cl.vents.length) return;
  for (let i = 0; i < NC(cl); i++) {
    const cx = (i + 0.5) * WEATHER_COL_W;
    let src = 0;
    for (const v of cl.vents) {
      const dx = cx - v.x;
      src += v.dT * Math.exp(-(dx * dx) / (2 * v.sigma * v.sigma));
    }
    const m = cl.thermalMass ? cl.thermalMass[i] : 1;
    if (src > 0) cl.cols[i].T = clamp01(cl.cols[i].T + src * dt * 0.02 / m);
  }
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
    // v0.27: mass-aware — heat diffuses, not temperature. dT_i = k/m_i × ΣΔT
    // (the seasonal reversion and the vent source already divide by m; the
    // diffusion term was the odd one out). Conserved quantity is Σ(m·T).
    const m = climate.thermalMass ? climate.thermalMass[i] : 1;
    d[i] = k * (tL + tR - 2 * climate.cols[i].T) / m;
  }
  for (let i = 0; i < n; i++) climate.cols[i].T = clamp01(climate.cols[i].T + d[i]);
}

// v2: seasonal amplitude by SUBSTRATE (not painted biome). Sand swings
// hard (desert-like), water buffers, soil breathes easy.
export const SEASON_AMP_BY_SUBSTRATE = {
  [SUBSTRATE.DEEP_WATER]: 0.35,
  [SUBSTRATE.SHALLOW_WATER]: 0.35,
  [SUBSTRATE.SAND]: 1.0,
  [SUBSTRATE.SOIL]: 0.5,
  [SUBSTRATE.ROCK]: 0.6,
  [SUBSTRATE.ALPINE]: 0.8,
};

// v2: init the climate field from the generated physical fields — T from
// Tinit, soil moisture from substrate retention, thermal mass from substrate
// heat capacity, seasonal amplitude by substrate, wind from the thermal
// equator. The old painted path (initClimateFromPainted) is kept for the
// canonical layout.
export function initClimateFromPhysical(climate, layout) {
  const rng = climate.rng;
  const n = NC(climate);
  const tinit = layout.Tinit;
  const sub = layout.substrate;
  const eqX = layout.thermalEquatorX || 0;
  climate.thermalMass = [];
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * WEATHER_COL_W;
    // Map the 100px weather column to the 20px terrain columns.
    const ti = Math.max(0, Math.min(tinit.length - 1, Math.floor(cx / 20)));
    const T0 = tinit[ti];
    const s = sub[ti];
    const props = SUBSTRATE_PROPS[s] || SUBSTRATE_PROPS[SUBSTRATE.SOIL];
    const c = climate.cols[i];
    c.T = clamp01(T0 + rng.range(-0.02, 0.02));
    c.soil = clamp01(props.retention + rng.range(-0.05, 0.05));
    c.vapor = clamp01(0.25 + props.retention * 0.5 + rng.range(-0.05, 0.05));
    c.cloud = clamp01(0.15 + props.retention * 0.3);
    c.windU = baseWindU(cx, eqX) + rng.range(-8, 8);
    climate.baseT[i] = c.T;
    climate.wet[i] = 0.5 + props.retention;
    climate.seasonAmp[i] = SEASON_AMP_BY_SUBSTRATE[s] !== undefined
      ? SEASON_AMP_BY_SUBSTRATE[s] : 0.4;
    // Thermal mass from heat capacity (water slow, land fast) — precomputed
    // here instead of lazily in tickClimate (same values, earlier).
    const wf = (s === SUBSTRATE.DEEP_WATER || s === SUBSTRATE.SHALLOW_WATER) ? 1 : 0;
    climate.thermalMass.push(1 + 4 * wf);
  }
}

// Paint the initial field from the painted biome map (world.js passes its
// keyAt). After this, physics owns the field. v1 (canonical) only.
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
    // v0.27 "Seasons": per-column seasonal amplitude from the painted biome —
    // the initial condition the field then evolves away from.
    climate.seasonAmp[i] = SEASON_AMP_BY_BIOME[k] !== undefined ? SEASON_AMP_BY_BIOME[k] : 0.4;
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

// The ITCZ: westerlies west of the convergence zone, easterlies (trades)
// east of it. The trades carry sea moisture toward the rainforest — the real
// Amazon's "flying rivers". Where the regimes meet, air converges, rises,
// and rains. (A uniform westerly just flushes every column's vapor to the
// sea in 50s; vapor never reaches saturation and nothing ever rains.)
// v2: the convergence zone is the thermal equator (hottest longitude), not
// the painted x=1500.
export function baseWindU(x, thermalEquatorX = 1500) {
  const t = Math.max(0, Math.min(1, (x - (thermalEquatorX - 200)) / 400));
  return 20 * (1 - t) + (-15) * t;
}

export function tickClimate(world, dt, geo) {
  const cl = world.climate;
  const rng = cl.rng;
  const sdt = Math.sqrt(dt);
  // v0.28 "Day and night": the day phase is integer-tick analytic —
  // timeOfDay(world) = (tick % dayTicks) / dayTicks, never float time.
  // The diurnal ripple rides the reversion target through the thermal-mass
  // divisor (a flux-shaped forcing, never an absolute ΔT — the v0.25/v0.27
  // heat-pump lesson). Amplitude ±0.04, small vs the seasonal wave.
  const tod = timeOfDay(world);
  const dayCurve = daylightCurve(tod); // 0 at midnight, 1 at noon
  const diurnal = (dayCurve - 0.5) * 0.08; // warm afternoon
  // v0.27 "Seasons": one clock for the whole year — the T forcing and the
  // water-cycle modulation below both read this sine, so wet/dry can never
  // creep out of alignment with warm/cold (there is no separate weather
  // cadence; tickClimate runs every tick).
  ensureSeasonClock(cl, world);
  const sSin = seasonSin(world);

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
    // v0.27 "Seasons": the seasonal wave rides the reversion target — the
    // radiative-equilibrium temperature the column relaxes toward. Per-biome
    // amplitude (desert ±0.30, jungle ±0.12). Annual mean of the forcing is
    // zero by construction; diffusion still conserves; vents are a separate
    // term and stay season-exempt.
    // v0.28 "Day and night": the seasonal wave is DAYLIGHT-GATED. An
    // additive seasonal term warms winter nights and cools summer nights
    // with energy that has no sun behind it (the "midnight sun" bug);
    // multiplying by the daylight curve makes the season modulate the
    // insolation that actually exists — summer raises the afternoon, never
    // the midnight. Annual mean unchanged (the sine still integrates to
    // zero over the year); thermal mass still divides the reversion.
    const seasonal = seasonalForcing(
      (cl.seasonAmp ? cl.seasonAmp[i] : 0.4) * SEASON_AMP_MAX, sSin, dayCurve);
    const target = clamp01(cl.baseT[i] + diurnal + seasonal);
    c.T += (target - c.T) * Math.min(1, dt * 0.02 / cl.thermalMass[i]);
    c.T += rng.range(-1, 1) * 0.006 * sdt;
    c.T = clamp01(c.T);
  }

  // 1b. Volcanic vents: explicit worldgen heat sources — see applyVentHeat.
  applyVentHeat(cl, dt);

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
      // v0.27 note (review P2): this nudge is unbooked energy (+0.025 T-units
      // at equilibrium) — a small explicit parameterized heat source in the
      // lee of ridges, in the same family as the volcanic vents. Temperature
      // is not a mass pool, so the mass ledger has nothing to book; the
      // magnitude is bounded and documented here instead of hidden.
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
    // v0.27 "Seasons": wet/dry seasons from the same clock as the T forcing
    // (T-only forcing would collapse relative humidity into an annual
    // desiccation event). Summer rains 1.5×, winter 0.5× — a RATE modulation,
    // so every drop remains a donor-limited transfer and the mass books
    // balance. Vapor and cloud respond emergently (warmer air evaporates
    // more and holds more); their stocks are never touched directly.
    const rain = Math.min(c.cloud, c.cloud * RAIN_RATE * (1 + 0.5 * sSin) * dt);
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
