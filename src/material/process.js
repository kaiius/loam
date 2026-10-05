// Canopy material world — tick-time material processes (M1).
//
// tickMaterials(mw, opts) advances the substrate one tick. mw is the
// material-world object: { grid, tick, fireOn, permanentTunnels }.
// opts may override: { fireOn, permanentTunnels, waterEvery }.
//
// ALL processes are deterministic — there is NO RNG anywhere in the tick.
// Sweep order is west->east, top->bottom; ties break by sweep order.
// hash2 is provided for any future stateless stochasticity; M1 needs none.
//
// Process order within a tick: slump -> water -> fire -> rot.

import { MAT, MAT_PROPS } from './grid.js';

// Fire tuning.
export const IGNITION_HEAT = 0.5;   // heat above this ignites flammable cells
export const BURNING_HEAT = 0.7;    // heat above this counts as burning
export const HEAT_DECAY = 0.95;     // heat multiplier per tick
export const SPREAD_K = 0.3;        // heat[n] += heat[c] * flammability[n] * SPREAD_K
export const BURN_TICKS_LEAF = 3;   // burning leaf -> AIR after this many ticks
export const BURN_TICKS_DEADWOOD = 30; // burning deadwood -> SOIL after this many
export const BURN_TICKS_WOOD = 60;  // burning wood -> DEADWOOD after this many

// Rot tuning.
export const ROT_THRESHOLD = 1000;  // damp deadwood -> soil after this many wet ticks

// Nutrient tuning (R2: decomposition → soil enrichment).
export const NUTRIENT_MAX = 2.0;        // per-cell nutrient cap
export const NUTRIENT_DECAY = 0.999;    // per corpse slow-tick multiplicative decay
export const NUTRIENT_PER_MEAT = 1.0;   // corpse meat -> nutrient conversion (1:1, mass-conserving)
export const DEADWOOD_NUTRIENT = 0.2;   // nutrient deposited when deadwood rots to soil
export const NUTRIENT_PER_FRUIT = 0.01; // nutrient drawn from the soil per fruit regrown

// Water tuning.
export const WATER_EVAP = 0.002;    // surface water lost per tick
export const INFILTRATE_K = 0.05;   // moist += water * permeability * INFILTRATE_K
export const WATER_RENDER_AT = 0.5; // water depth at/above this renders as WATER

// R3 (reactive biomes): scalar diffusion — deterministic, seeded (the
// world's seed pins all initial fields), zero RNG. Pure arithmetic on a
// fixed sweep order, so the same seed is bit-identical every run.
// Moisture fronts move fast (weather, days); nutrient fronts creep (soil,
// seasons) — that asymmetry is the point.
export const D_MOIST = 0.004;  // per-tick relaxation of moist toward the 4-neighbour mean
export const D_NUT = 0.0002;    // per-tick relaxation of nutrient toward the 4-neighbour mean
export const NUTRIENT_SPROUT_MIN = 0.08; // ground-cell nutrient below this: no germination

// Stateless hash for any future deterministic stochasticity
// (hash2(seed, x, y, tick, purpose) -> [0, 1)). Unused by M1 processes.
export function hash2(seed, x, y, tick, purpose) {
  let h = (seed >>> 0)
    ^ Math.imul(x | 0, 0x9e3779b1)
    ^ Math.imul(y | 0, 0x85ebca6b)
    ^ Math.imul(tick | 0, 0xc2b2ae35)
    ^ Math.imul(purpose | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Lazily allocate a per-cell auxiliary array on the material-world object.
// Keeps createGrid's contract exact (the worldgen agent builds against its
// named fields); tick state that is not worldgen's business lives here.
function aux(mw, name, Ctor) {
  const g = mw.grid;
  const n = g.cols * g.rows;
  let a = mw[name];
  if (!a || a.length !== n) {
    a = new Ctor(n);
    mw[name] = a;
  }
  return a;
}

// Advance the whole substrate one tick. Advances mw.tick by 1.
export function tickMaterials(mw, opts = {}) {
  const fireOn = opts.fireOn ?? mw.fireOn ?? true;
  const permanentTunnels = opts.permanentTunnels ?? mw.permanentTunnels ?? false;
  const waterEvery = opts.waterEvery ?? 1;
  tickSlump(mw, permanentTunnels);
  if ((mw.tick | 0) % waterEvery === 0) tickWater(mw);
  tickDiffuse(mw); // R3: scalar diffusion before fire — moisture gates ignition
  tickFire(mw, fireOn);
  tickRot(mw);
  mw.tick = (mw.tick | 0) + 1;
  return mw;
}

// ---- Slump / collapse ----
//
// For each row, find maximal runs of consecutive solid cells with nothing
// solid directly below them. If a run of length L exceeds a cell's
// integrity I, the middle (L - I) cells start falling. Falling cells move
// down 1 cell per tick while the cell below is AIR or WATER. SAND
// (integrity 0) therefore always falls through open space.
//
// permanentTunnels=true: cells with dug=1 NEVER collapse — dug voids count
// as support for the span check and are never fall targets, so tunnels stay
// open. false (realistic): dug cells are ordinary air and cave in.
function supportedBelow(g, x, y, permanentTunnels) {
  const { cols, rows, mat, dug } = g;
  const ny = y + 1;
  if (ny >= rows) return true; // the world floor holds everything
  const bi = ny * cols + x;
  if (MAT_PROPS[mat[bi]].solid) return true;
  if (permanentTunnels && dug[bi] === 1) return true; // the void holds the ceiling
  return false;
}

function fallTargetBlocked(g, bi, permanentTunnels) {
  const bm = g.mat[bi];
  if (!(bm === MAT.AIR || bm === MAT.WATER)) return true;
  if (permanentTunnels && g.dug[bi] === 1) return true; // tunnels stay open
  return false;
}

function swapCells(g, mw, a, b) {
  // Every per-cell field travels with the cell when it falls — nutrient
  // included (R2), so enrichment moves with slumping soil, not against it.
  for (const f of ['mat', 'moist', 'root', 'grownId', 'dug', 'heat', 'water', 'nutrient']) {
    const t = g[f][a];
    g[f][a] = g[f][b];
    g[f][b] = t;
  }
  for (const f of ['rot', 'burn']) {
    const arr = mw[f];
    if (arr) {
      const t = arr[a];
      arr[a] = arr[b];
      arr[b] = t;
    }
  }
}

function tickSlump(mw, permanentTunnels) {
  const g = mw.grid;
  const { cols, rows, mat, dug, moist } = g;
  const fall = aux(mw, '_fall', Uint8Array);

  // 1. Span check: mark the middle cells of overlong unsupported runs.
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const i = y * cols + x;
      const m = mat[i];
      const slumpable = MAT_PROPS[m].solid
        && MAT_PROPS[m].integrity < Infinity
        && !(permanentTunnels && dug[i] === 1)
        && !supportedBelow(g, x, y, permanentTunnels);
      if (!slumpable) {
        x++;
        continue;
      }
      // Extend the maximal unsupported run.
      let x1 = x;
      while (x1 + 1 < cols) {
        const j = y * cols + x1 + 1;
        const mj = mat[j];
        if (!MAT_PROPS[mj].solid || MAT_PROPS[mj].integrity === Infinity) break;
        if (permanentTunnels && dug[j] === 1) break;
        if (supportedBelow(g, x1 + 1, y, permanentTunnels)) break;
        x1++;
      }
      const L = x1 - x + 1;
      for (let xx = x; xx <= x1; xx++) {
        const ci = y * cols + xx;
        const m = mat[ci];
        const base = MAT_PROPS[m].integrity;
        // R2 (SIM-A): moisture weakens soil spans — saturated soil loses
        // effective integrity, so wet spans collapse that dry ones hold.
        // Deterministic: moist is grid state, no RNG; ties still break by
        // sweep order. Only SOIL/SAND/CLAY soften (rock/wood don't).
        const eff = (m === MAT.SOIL || m === MAT.SAND || m === MAT.CLAY)
          ? base * (1 - 0.5 * moist[ci])
          : base;
        if (L > eff) {
          const excess = L - eff;
          const start = Math.floor((L - excess) / 2); // center the slump
          const p = xx - x;
          if (p >= start && p < start + excess) fall[ci] = 1;
        }
      }
      x = x1 + 1;
    }
  }

  // 2. SAND always falls through open space, regardless of span.
  for (let i = 0; i < cols * rows; i++) {
    if (mat[i] !== MAT.SAND) continue;
    if (permanentTunnels && dug[i] === 1) continue;
    const y = (i / cols) | 0;
    if (y + 1 < rows && !fallTargetBlocked(g, i + cols, permanentTunnels)) fall[i] = 1;
  }

  // 3. Move falling cells down one cell. Bottom->top so each cell moves
  // exactly once per tick; the fall flag travels with the cell.
  for (let y = rows - 2; y >= 0; y--) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!fall[i]) continue;
      const bi = i + cols;
      if (fallTargetBlocked(g, bi, permanentTunnels)) {
        fall[i] = 0; // landed
        continue;
      }
      swapCells(g, mw, i, bi);
      fall[bi] = 1;
      fall[i] = 0;
    }
  }
}

// ---- Water: full fluid dynamics ----
//
// Pressure-driven flow, west->east / top->bottom. For each cell with water:
//  1. infiltrate into SOIL/SAND (moist += water * permeability * K),
//  2. flow down into AIR/WATER/permeable cells with room,
//  3. spread sideways to the lower of the left/right neighbors
//     (pressure gradient; west wins ties),
//  4. evaporate 0.002/tick from surface water (AIR above).
// Water cannot enter solid non-permeable cells. The WATER material id is
// rendering only: AIR cells at depth >= 0.5 render as WATER, and revert to
// AIR below that. Solid cells keep their id whatever their water field holds.
function canHoldWater(m) {
  return m === MAT.AIR || m === MAT.WATER || m === MAT.SOIL || m === MAT.SAND;
}

function fixWaterId(g, i) {
  const m = g.mat[i];
  if (m === MAT.AIR && g.water[i] >= WATER_RENDER_AT) g.mat[i] = MAT.WATER;
  else if (m === MAT.WATER && g.water[i] < WATER_RENDER_AT) g.mat[i] = MAT.AIR;
}

function tickWater(mw) {
  const g = mw.grid;
  const { cols, rows, mat, water, moist } = g;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let w = water[i];
      if (w <= 0) continue;
      const m = mat[i];

      // 1. Infiltration into permeable ground.
      if (m === MAT.SOIL || m === MAT.SAND) {
        let take = w * MAT_PROPS[m].permeability * INFILTRATE_K;
        const room = 1 - moist[i];
        if (take > room) take = room;
        if (take > 0) {
          moist[i] += take;
          w -= take;
          water[i] = w;
        }
      }
      if (w <= 0.0005) {
        water[i] = 0;
        fixWaterId(g, i);
        continue;
      }

      // 2. Flow down.
      if (y + 1 < rows) {
        const bi = i + cols;
        if (canHoldWater(mat[bi])) {
          const space = 1 - water[bi];
          if (space > 0.0005) {
            const move = Math.min(w, space);
            water[bi] += move;
            w -= move;
            water[i] = w;
            fixWaterId(g, bi);
          }
        }
      }

      // 3. Spread sideways toward the lower neighbor (pressure gradient).
      if (w > 0.0005) {
        let best = -1;
        let bestW = w;
        if (x > 0) {
          const li = i - 1;
          if (canHoldWater(mat[li]) && water[li] < bestW - 0.0005) {
            best = li;
            bestW = water[li];
          }
        }
        if (x + 1 < cols) {
          const ri = i + 1;
          if (canHoldWater(mat[ri]) && water[ri] < bestW - 0.0005) {
            best = ri;
            bestW = water[ri];
          }
        }
        if (best >= 0) {
          const move = Math.min((w - bestW) / 2, 1 - water[best], 0.25);
          if (move > 0.0005) {
            water[best] += move;
            w -= move;
            water[i] = w;
            fixWaterId(g, best);
          }
        }
      }

      // 4. Evaporation from surface water.
      if (w > 0 && (y === 0 || mat[i - cols] === MAT.AIR)) {
        w = Math.max(0, w - WATER_EVAP);
        water[i] = w;
      }
      fixWaterId(g, i);
    }
  }
}

// ---- Scalar diffusion (R3: reactive biomes) ----
//
// moist and nutrient relax toward their 4-neighbour mean each tick.
// Deterministic: no RNG, fixed west->east/top->bottom sweep, double
// buffering so the update is order-independent. Air cells don't
// participate — fields live on matter, and air would act as a sink.
// mw.frozenBiome (the reactive-gate control) skips this entirely.
export function tickDiffuse(mw) {
  if (mw.frozenBiome) return;
  const g = mw.grid;
  const { cols, rows, mat, moist } = g;
  const nut = g.nutrient;
  const n = cols * rows;
  const dM = aux(mw, 'diffM', Float32Array);
  const dN = nut ? aux(mw, 'diffN', Float32Array) : null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (mat[i] === MAT.AIR) continue;
      // R4 (Cassini probe): conservative flux form. The old code relaxed
      // toward the neighbour MEAN (dividing by the per-cell neighbour count
      // n_i), which leaks mass at boundaries/air-interfaces by
      // (1/n_i - 1/n_j) asymmetry - measured 8.9% moisture drift over 200
      // ticks on a closed grid. Flux across edge (i,j) is now antisymmetric
      // (D/4)*(v_j - v_i), so every pairwise exchange cancels exactly:
      // total mass is conserved, with no-flux at boundaries.
      // Interior cells (n=4) are bit-identical to the old form.
      let mFlux = 0, nFlux = 0;
      if (x > 0 && mat[i - 1] !== MAT.AIR) { mFlux += moist[i - 1] - moist[i]; if (dN) nFlux += nut[i - 1] - nut[i]; }
      if (x + 1 < cols && mat[i + 1] !== MAT.AIR) { mFlux += moist[i + 1] - moist[i]; if (dN) nFlux += nut[i + 1] - nut[i]; }
      if (y > 0 && mat[i - cols] !== MAT.AIR) { mFlux += moist[i - cols] - moist[i]; if (dN) nFlux += nut[i - cols] - nut[i]; }
      if (y + 1 < rows && mat[i + cols] !== MAT.AIR) { mFlux += moist[i + cols] - moist[i]; if (dN) nFlux += nut[i + cols] - nut[i]; }
      dM[i] = moist[i] + D_MOIST * mFlux * 0.25;
      if (dN) dN[i] = nut[i] + D_NUT * nFlux * 0.25;
    }
  }
  for (let i = 0; i < n; i++) {
    if (mat[i] === MAT.AIR) continue;
    moist[i] = dM[i];
    if (dN) nut[i] = dN[i];
  }
}

// ---- Fire ----
//
// Cells with flammability > 0 and heat above the moisture-gated ignition
// heat to flammable 8-neighbors: heat[n] += heat[c] * flammability[n] * 0.3.
// Burning cells (heat > BURNING_HEAT) convert after sustained burn:
// LEAF -> AIR (fast), DEADWOOD -> SOIL (rots to earth), WOOD -> DEADWOOD
// (long burn). Heat decays *0.95 per tick. With fireOn=false there is no
// ignition, no spread, and no conversion — heat just decays.
export function tickFire(mw, fireOn) {
  const g = mw.grid;
  const { cols, rows, mat, heat, moist } = g;
  const burn = aux(mw, 'burn', Float32Array);
  // Spread accumulates here and applies after the sweep: fire advances
  // ~1 cell per tick. (Applying spread in-sweep let one tick chain
  // across the whole fuel bed — a lightning strike flash-burned half
  // the world's canopy. It also let heat run to Infinity.)
  const spread = aux(mw, 'spread', Float32Array);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      heat[i] *= HEAT_DECAY;
      // Heat is a 0..1-ish intensity (strike sets 0.9) — clamp it.
      if (heat[i] > 1.5) heat[i] = 1.5;
      if (!fireOn) continue;
      const m = mat[i];
      const fl = MAT_PROPS[m].flammability;
      if (fl <= 0) continue;
      // R3 (reactive biomes): ignition is moisture-gated — dry fuel catches
      // at IGNITION_HEAT, soaked fuel needs twice the heat. A lightning
      // strike (heat 0.9) ignites at moist < 0.80, fizzles above it.
      if (heat[i] > IGNITION_HEAT * (1 + moist[i])) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const n = ny * cols + nx;
            const fn = MAT_PROPS[mat[n]].flammability;
            // R2 (SIM-A): target moisture damps spread — wet cells don't
            // carry fire. (1 - moist[n]) is 1 for dry fuel, 0 when soaked.
            if (fn > 0) spread[n] = Math.min(1.5, spread[n] + heat[i] * fn * SPREAD_K * (1 - moist[n]));
          }
        }
      }
      if (heat[i] > BURNING_HEAT) {
        burn[i] += 1;
        if (m === MAT.LEAF && burn[i] >= BURN_TICKS_LEAF) {
          mat[i] = MAT.AIR;
          heat[i] = 0;
          burn[i] = 0;
        } else if (m === MAT.DEADWOOD && burn[i] >= BURN_TICKS_DEADWOOD) {
          mat[i] = MAT.SOIL; // mass-conserving: it rots to earth
          heat[i] = 0;
          burn[i] = 0;
        } else if (m === MAT.WOOD && burn[i] >= BURN_TICKS_WOOD) {
          mat[i] = MAT.DEADWOOD;
          heat[i] = 0;
          burn[i] = 0;
        }
      } else {
        burn[i] = 0;
      }
    }
  }
  if (fireOn) {
    for (let i = 0; i < heat.length; i++) {
      if (spread[i] !== 0) {
        heat[i] = Math.min(1.5, heat[i] + spread[i]);
        spread[i] = 0;
      }
    }
  } else {
    spread.fill(0);
  }
}

// ---- Rot (slow) ----
//
// DEADWOOD with moist > 0.3 accumulates rot; at ROT_THRESHOLD ticks it
// becomes SOIL, mass-conserving (moisture and fertility stay in the cell).
// Drying pauses the counter, it does not reset it.
// R2: the rotting wood enriches the soil — a nutrient deposit, so rotted
// deadwood is worth eating (geophagy).
export function tickRot(mw) {
  const g = mw.grid;
  const { mat, moist, nutrient } = g;
  const rot = aux(mw, 'rot', Float32Array);
  const n = g.cols * g.rows;
  for (let i = 0; i < n; i++) {
    if (mat[i] === MAT.DEADWOOD && moist[i] > 0.3) {
      rot[i] += 1;
      if (rot[i] >= ROT_THRESHOLD) {
        mat[i] = MAT.SOIL;
        rot[i] = 0;
        // Frozen control: the rot still converts (it's R1 mechanics), but
        // the nutrient deposit is scalar flux — skipped.
        if (nutrient && !mw.frozenBiome) nutrient[i] = Math.min(NUTRIENT_MAX, nutrient[i] + DEADWOOD_NUTRIENT);
      }
    }
  }
}
