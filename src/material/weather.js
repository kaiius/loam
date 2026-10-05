// Loam M3 — the sky. Weather as physics, not paint.
//
// Ported from the platform track's sim/weather.js (v0.23 "Weather" through
// v0.28 "Day and night"), re-derived for the material grid. The big
// difference: Loam's water is CELLS, not a column field — so rain ADDS
// water to the grid, and the grid's own water process moves it. The sky
// and the ground are one water cycle with two halves.
//
// Per-column field: T (0..1 ambient), vapor, cloud, soil (moisture),
// windU (px/s, +x eastward), rain (accumulator). Every flux is
// donor-limited and two-sided where it matters.
//
// The sky draws from its OWN pinned sub-stream — weather must never shift
// the main stream's sequence (founder genomes, brain rolls). Same seed →
// same sky, bit-identical.
//
// Ticks decoupled: tickSky runs every SKY_EVERY material ticks with
// dt=SKY_EVERY (the field is O(columns), cheap; the grid coupling is the
// cost). Seasons ride one clock so wet/dry can never creep out of alignment
// with warm/cold.
//
// Deliberately left behind from the platform sky: volcanic vents (no
// geothermal zone in Loam worldgen yet), the water-table/drainage ledger
// (Loam's grid IS the water table — infiltration handles it), orographic
// lift (Loam's relief is meters, not mountains; revisit if ranges grow).

import { MAT, CELL_PX, MAT_PROPS } from './grid.js';
import { createRng } from '../sim/rng.js';
import { IGNITION_HEAT, hash2 } from './process.js';
import { TICKS_PER_DAY, timeOfDay, daySun } from './senses.js';

export const SKY_EVERY = 20;          // sky ticks per material tick batch
export const SKY_COL_W = 100;         // px per climate column
export const YEAR_TICKS = 9600;       // 4 days — individuals span seasons
export const SEASON_AMP_MAX = 0.25;   // T-units of seasonal swing
// R2 (SIM-C): per-cell wind noise — deterministic, no per-tick RNG.
export const WIND_NOISE_AMP = 6;      // px/s of hash noise around the global wind
export const WIND_NOISE_BLOCK = 200;  // material ticks per noise-pattern block
export const WIND_LEAN_PER = 0.25;    // degrees of tree lean per px/s of wind
export const WIND_LEAN_MAX = 14;      // degrees: wind-shaped, not wind-bent

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- construction -------------------------------------------------------

// R2 (SIM-C): the sky's initial global wind, a pure function of the seed —
// pinned like the sky's own sub-stream, so the same seed always grows the
// same wind-shaped trees. Westerly baseline (12 px/s) with per-seed spread.
export function initialGlobalWind(seed) {
  const ws = ((seed * 1009 + 5) >>> 0) || 1;
  return {
    U: 12 + (hash2(ws, 0, 0, 0, 101) - 0.5) * 24,
    V: (hash2(ws, 0, 0, 0, 102) - 0.5) * 8,
  };
}

export function createSky(seed, widthPx, opts = {}) {
  const ncols = Math.max(8, Math.round(widthPx / SKY_COL_W));
  const cols = [];
  for (let i = 0; i < ncols; i++) {
    cols.push({
      T: opts.T ? opts.T(i) : 0.5,
      vapor: 0.3, cloud: 0.2,
      soil: opts.soil ? opts.soil(i) : 0.4,
      windU: 10,
      rain: 0,
    });
  }
  const windSeed = ((seed * 1009 + 5) >>> 0) || 1;
  const iw = initialGlobalWind(seed);
  return {
    cols, ncols,
    rng: createRng(windSeed),
    windSeed,
    // R2 (SIM-C): the GLOBAL wind vector — one system. Evolved slowly on
    // the sky's own pinned sub-stream (never the main stream).
    windU: iw.U,
    windV: iw.V,
    baseT: cols.map((c) => c.T),
    seasonAmp: new Array(ncols).fill(opts.seasonAmp ?? 0.4),
    lightning: [],
    tick: 0,
  };
}

export function ncols(sky) { return sky.ncols; }
export function colAt(sky, x) {
  const i = Math.max(0, Math.min(sky.ncols - 1, Math.floor(x / SKY_COL_W)));
  return sky.cols[i];
}

// --- accessors: experienced climate -------------------------------------

export function tempAt(mw, x) {
  if (!mw.sky) return 0.5;
  return colAt(mw.sky, x).T;
}
export function windAt(mw, x) {
  if (!mw.sky) return 0;
  const sky = mw.sky;
  // R2 (SIM-C): the unified wind — the global vector plus deterministic
  // per-cell noise (spatial hash + slow temporal modulation). NO per-tick
  // RNG: the same (seed, x, tick-block) always reads the same wind, so
  // seed dispersal, leaf sway, and tree lean all drink from one system.
  const cx = Math.floor(x / CELL_PX);
  const tb = Math.floor((mw.tick || 0) / WIND_NOISE_BLOCK);
  const h = hash2(sky.windSeed, cx, tb, 0, 77);
  return sky.windU + (h - 0.5) * 2 * WIND_NOISE_AMP;
}
export function moistureAt(mw, x) {
  if (!mw.sky) return 0.4;
  return colAt(mw.sky, x).soil;
}
export function cloudAt(mw, x) {
  if (!mw.sky) return 0.2;
  return colAt(mw.sky, x).cloud;
}
export function tempCOf(T) { return -10 + 45 * T; }

// Seasonal phase: 0 = spring equinox, 0.25 = summer solstice.
export function seasonPhase(mw) {
  const t = mw.tick || 0;
  return (((t % YEAR_TICKS) + YEAR_TICKS) % YEAR_TICKS) / YEAR_TICKS;
}
export function seasonSin(mw) { return Math.sin(seasonPhase(mw) * Math.PI * 2); }

// --- the tick -------------------------------------------------------------

const EVAP_BASE = 0.0006;
const EVAP_WARM = 0.0022;
// Rain as a fraction of cloud stock per sky tick, superlinear in cloud:
// drizzle under fair skies, deluge under storm heads. The old linear
// RAIN_RATE=0.02 drained 40% of the cloud stock per sky tick while
// evaporation supplied ~0.004 — cloud pinned at ~0.01 forever, so
// lightning (gate: cloud > 0.75) never fired in any long run.
const RAIN_K = 0.019;
const RAIN_SOIL = 0.85;
const ADVECT_K = 0.0001;
const LIGHTNING_P = 0.004;

export function tickSky(mw, dt = SKY_EVERY) {
  const sky = mw.sky;
  if (!sky) return;
  const rng = sky.rng;
  const g = mw.grid;
  const sdt = Math.sqrt(dt);
  const tod = timeOfDay(mw);
  const dayCurve = daySun(mw);
  const diurnal = (dayCurve - 0.5) * 0.08;
  const sSin = seasonSin(mw);
  const n = sky.ncols;

  // Water fraction per column for evaporation (open water evaporates freely).
  const waterFrac = new Array(n).fill(0);
  const biomass = new Array(n).fill(0);
  if (mw.plants) {
    for (const p of mw.plants) {
      const i = Math.max(0, Math.min(n - 1, Math.floor((p.seedX * CELL_PX) / SKY_COL_W)));
      biomass[i] += 0.02;
    }
  }

  // 1. Temperature: diurnal + seasonal target, mean-reversion, √dt kicks.
  for (let i = 0; i < n; i++) {
    const c = sky.cols[i];
    const seasonal = (sky.seasonAmp[i] || 0.4) * SEASON_AMP_MAX * sSin * dayCurve;
    const target = clamp01(sky.baseT[i] + diurnal + seasonal);
    c.T += (target - c.T) * Math.min(1, dt * 0.02);
    c.T += rng.range(-1, 1) * 0.006 * sdt;
    c.T = clamp01(c.T);
  }

  // 2. Evaporation: open water + transpiring biomass, donor-limited from
  //    the column's soil stock. (The grid's own water cells are the sea.)
  //    Open water is counted exactly in one grid pass — the old sparse
  //    sampling missed the world's thin sea band entirely.
  {
    const colOf = new Array(g.cols);
    for (let cx = 0; cx < g.cols; cx++) colOf[cx] = Math.max(0, Math.min(n - 1, Math.floor((cx * CELL_PX) / SKY_COL_W)));
    for (let cy = 0; cy < g.rows; cy++) {
      for (let cx = 0; cx < g.cols; cx++) {
        const i = cy * g.cols + cx;
        if (g.mat[i] === MAT.WATER || g.water[i] > 0.3) waterFrac[colOf[cx]] = 1;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const c = sky.cols[i];
    // Open water evaporates freely (the sea doesn't run out); soil
    // moisture only limits the transpiration share.
    const rateWater = (EVAP_BASE + EVAP_WARM * c.T) * waterFrac[i] * 2.0;
    const rateSoil = (EVAP_BASE + EVAP_WARM * c.T) * biomass[i] * 0.9;
    const drawSoil = Math.min(c.soil, rateSoil * dt);
    c.soil -= drawSoil;
    const draw = rateWater * dt + drawSoil;
    c.vapor += draw * 0.5;
    c.cloud += draw * 0.5;
  }

  // 3. Saturation → condensation → lightning → rain. Lightning strikes
  // DURING the storm, not after it's rained itself out.
  for (let i = 0; i < n; i++) {
    const c = sky.cols[i];
    const sat = (0.30 + 0.55 * c.T) * 0.9;
    const excess = c.vapor - sat;
    if (excess > 0) {
      const cond = excess * Math.min(1, dt * 1.5);
      c.vapor -= cond;
      c.cloud += cond;
    }
    // Lightning: convective storms discharge while the cloud is deep.
    // (Gate lowered 2026-10-03: the old cloud > 0.75 was unreachable —
    // the broken water budget pinned cloud at ~0.01. Deep cloud is now
    // cloud > 0.55, which wet columns reach and exceed in spells.)
    if (c.cloud > 0.55 && c.T > 0.55) {
      const p = LIGHTNING_P * dt * (c.cloud - 0.55) * 4 * c.T;
      if (rng.next() < p) {
        const x = (i + 0.5) * SKY_COL_W + rng.range(-40, 40);
        sky.lightning.push({ x, t: mw.tick });
        if (sky.lightning.length > 200) sky.lightning.shift();
        strikeIgnite(mw, x);
      }
    }
    // Wet summers, dry winters — same clock as the T forcing.
    const rain = Math.min(c.cloud, RAIN_K * Math.pow(c.cloud, 2.5) * (1 + 0.5 * sSin) * dt);
    c.cloud -= rain;
    c.rain = rain; // current rainfall rate (eye + grid signal), not an accumulator
    if (rain > 0.001) rainOntoGrid(mw, i, rain);
    // 85% soaks into the column's soil stock; the grid's moist field is
    // written in the coupling pass below.
    c.soil = clamp01(c.soil + rain * RAIN_SOIL);
  }

  // 4. Vapor advection: donor-limited, two-sided.
  const flux = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = sky.cols[i];
    const j = i + Math.sign(c.windU);
    if (j < 0 || j >= n || c.windU === 0) continue;
    flux[i] = Math.min(Math.abs(c.windU) * ADVECT_K * dt * c.vapor, c.vapor);
  }
  for (let i = 0; i < n; i++) {
    if (!flux[i]) continue;
    const j = i + Math.sign(sky.cols[i].windU);
    sky.cols[i].vapor -= flux[i];
    sky.cols[j].vapor += flux[i];
  }

  // 5. Wind: the GLOBAL vector walks slowly on the sky's own pinned
  //    sub-stream (never the main stream — founder genomes/brain rolls
  //    must not shift); each column's wind relaxes toward the global.
  //    Same seed → same sky, bit-identical.
  sky.windU += (12 - sky.windU) * Math.min(1, dt * 0.001);
  sky.windU += rng.range(-1, 1) * 0.35 * sdt;
  sky.windU = Math.max(-60, Math.min(80, sky.windU));
  sky.windV += (0 - sky.windV) * Math.min(1, dt * 0.001);
  sky.windV += rng.range(-1, 1) * 0.35 * sdt;
  sky.windV = Math.max(-40, Math.min(40, sky.windV));
  for (let i = 0; i < n; i++) {
    const c = sky.cols[i];
    c.windU += (sky.windU - c.windU) * Math.min(1, dt * 0.005);
    c.windU += rng.range(-1, 1) * 2.0 * sdt;
    c.windU = Math.max(-60, Math.min(80, c.windU));
  }

  // 6. (Lightning now strikes in step 3, during the storm.)

  // 7. Grid coupling: column soil moisture → grid moist (soil cells only);
  //    wind → downwind fire nudge (the fire process itself is untouched).
  coupleToGrid(mw);

  sky.tick++;
}

// Rain lands: water depth added to air cells at the surface of the column.
// Falls on the canopy first (leaves catch some), then the ground.
function rainOntoGrid(mw, col, rain) {
  const g = mw.grid;
  const x0 = Math.max(0, Math.floor(col * SKY_COL_W / CELL_PX));
  const x1 = Math.min(g.cols, Math.ceil((col + 1) * SKY_COL_W / CELL_PX));
  const depth = rain * 0.6; // rain units → water depth
  for (let cx = x0; cx < x1; cx += 2) {
    // Find the topmost non-air cell in this cell-column.
    for (let cy = 0; cy < g.rows; cy++) {
      const i = cy * g.cols + cx;
      const m = g.mat[i];
      if (m === MAT.AIR) {
        g.water[i] = Math.min(1, g.water[i] + depth);
        break;
      }
      if (m === MAT.LEAF) {
        // Canopy interception: leaves catch some, the rest drips through.
        g.water[i] = Math.min(1, g.water[i] + depth * 0.4);
        break;
      }
      if (m === MAT.WATER) { g.water[i] = Math.min(1, g.water[i] + depth); break; }
    }
  }
}

// Lightning finds the tallest flammable thing in the column and heats it.
function strikeIgnite(mw, x) {
  const g = mw.grid;
  const cx = Math.max(0, Math.min(g.cols - 1, Math.floor(x / CELL_PX)));
  for (let cy = 0; cy < g.rows; cy++) {
    const i = cy * g.cols + cx;
    const m = g.mat[i];
    if (m === MAT.WOOD || m === MAT.LEAF || m === MAT.DEADWOOD) {
      g.heat[i] = Math.max(g.heat[i], 0.9); // above ignition — the storm lights it
      return;
    }
  }
}

// Column moisture → grid moist; wind → downwind heat nudge.
function coupleToGrid(mw) {
  const sky = mw.sky, g = mw.grid;
  const n = sky.ncols;
  for (let i = 0; i < n; i++) {
    const c = sky.cols[i];
    const x0 = Math.max(0, Math.floor(i * SKY_COL_W / CELL_PX));
    const x1 = Math.min(g.cols, Math.ceil((i + 1) * SKY_COL_W / CELL_PX));
    // Moisture relaxes toward the column stock (soil cells drink).
    // Frozen control: the scalars never move — the biome is painted on.
    if (!mw.frozenBiome) {
      for (let cx = x0; cx < x1; cx += 3) {
        for (let cy = 0; cy < g.rows; cy += 3) {
          const idx = cy * g.cols + cx;
          if (g.mat[idx] === MAT.SOIL || g.mat[idx] === MAT.CLAY || g.mat[idx] === MAT.SAND) {
            g.moist[idx] += (c.soil - g.moist[idx]) * 0.05;
          }
        }
      }
      // R3 (reactive biomes): wind shifts surface moisture downwind. A
      // scalar bias, not fluid transport — surface soil cells relax 0.05
      // toward their upwind neighbour each sky tick. Deterministic (the
      // wind is seed-pinned); dry fronts visibly march with the wind.
      const wu = sky.windU;
      if (Math.abs(wu) > 2) {
        const step = 3 * Math.sign(wu);
        for (let cx = x0; cx < x1; cx += 3) {
          const ux = cx - step;
          if (ux < 0 || ux >= g.cols) continue;
          for (let cy = 0; cy < g.rows; cy += 3) {
            const idx = cy * g.cols + cx;
            const m = g.mat[idx];
            if (m !== MAT.SOIL && m !== MAT.CLAY && m !== MAT.SAND) continue;
            const uidx = cy * g.cols + ux;
            const um = g.mat[uidx];
            if (um !== MAT.SOIL && um !== MAT.CLAY && um !== MAT.SAND) continue;
            g.moist[idx] += (g.moist[uidx] - g.moist[idx]) * 0.05;
          }
        }
      }
    }
    // Rain quenches fire: lightning strikes during storms, so most
    // strikes land in falling rain and fizzle — dry lightning is the
    // dangerous kind. Only nascent heat (below ignition) is quenched;
    // a fresh strike lands above ignition and gets its chance to take
    // hold. (Per sky tick; heavy rain ≈ 7%/material-tick on embers.)
    if (c.rain > 0.01) {
      const damp = Math.max(0, 1 - c.rain * 3);
      for (let cx = x0; cx < x1; cx++) {
        for (let cy = 0; cy < g.rows; cy++) {
          const idx = cy * g.cols + cx;
          if (g.heat[idx] > 0.01 && g.heat[idx] < IGNITION_HEAT) g.heat[idx] *= damp;
        }
      }
    }
    // Temperature gates fire: freezing columns quench nascent heat
    // below ignition (no winter wildfires); scorching columns prime
    // flammable cells toward it. The fire process is untouched — this
    // is the sky's hand on the ignition threshold.
    if (c.T < 0.25 || c.T > 0.8) {
      const quench = c.T < 0.25;
      for (let cx = x0; cx < x1; cx++) {
        for (let cy = 0; cy < g.rows; cy++) {
          const idx = cy * g.cols + cx;
          if (quench) {
            if (g.heat[idx] < IGNITION_HEAT) g.heat[idx] *= 0.5;
          } else if (g.heat[idx] > 0.01 && g.heat[idx] < IGNITION_HEAT) {
            const m = g.mat[idx];
            if (m !== MAT.AIR && m !== MAT.WATER && (MAT_PROPS[m] ? MAT_PROPS[m].flammability : 0) > 0) {
              g.heat[idx] = Math.min(IGNITION_HEAT * 0.99, g.heat[idx] * 1.15);
            }
          }
        }
      }
    }
    // Wind pushes fire downwind: burning cells nudge heat leeward.
    // (The fire process is untouched — this is the sky's hand on it.)
    if (Math.abs(c.windU) > 20) {
      const dx = Math.sign(c.windU);
      for (let cx = x0; cx < x1; cx++) {
        for (let cy = 0; cy < g.rows; cy++) {
          const idx = cy * g.cols + cx;
          if (g.heat[idx] > 0.7) {
            const nx = cx + dx;
            if (nx >= 0 && nx < g.cols) {
              const ni = cy * g.cols + nx;
              g.heat[ni] = Math.min(1.5, g.heat[ni] + g.heat[idx] * 0.08);
            }
          }
        }
      }
    }
  }
}
