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
export const BURNING_HEAT = 0.7;    // legacy burning predicate (kept for reference; D3 uses phase)
export const HEAT_DECAY = 0.95;     // heat multiplier per tick
export const SPREAD_K = 0.3;        // heat[n] += heat[c] * flammability[n] * SPREAD_K
export const BURN_TICKS_LEAF = 3;   // burning leaf -> AIR after this many ticks
export const BURN_TICKS_DEADWOOD = 30; // burning deadwood -> SOIL after this many
export const BURN_TICKS_WOOD = 60;  // legacy wood burn (kept for reference; D3 splits it into CHAR_TICKS + CHAR_BURN)
// D3 (material physics): fire as a state machine, not a heat predicate.
export const SMOLDER_HEAT = 0.35;   // heat below this: flaming -> smoldering
export const CHAR_TICKS = 30;       // burning WOOD -> CHAR after this many ticks
export const CHAR_BURN = 30;        // burning CHAR -> DEADWOOD after this many ticks
// Founder parity: CHAR_TICKS + CHAR_BURN = 60 = BURN_TICKS_WOOD, so the
// aggregate WOOD -> DEADWOOD timing is bit-identical to the old path.
export const REFLARE_HEAT = 0.55;   // smoldering cell above this heat re-flares...
export const REFLARE_MOIST = 0.25;  // ...if drier than this moisture
export const SMOLDER_OUT = 120;     // smolder-ticks to burn out to inert residue
export const EMBER_K = 0.02;        // smoldering ember deposit rate to flammable neighbors
export const WIND_SPREAD_K = 0.12;  // wind bias on spread; test worlds have windU=0 -> bias exactly 1
export const FUEL_K = 0;            // fuel-load damping on spread; 0 = today's flat term exactly
// D3: dry granular creep (erosion). (D4: weathering moved to the
// tickWeathering geological pass below — no longer part of tickRot.)
export const REPOSE_DH = 2;         // cells of drop per column boundary that a slope holds
export const CREEP_K = 0;           // creep rate (cells/tick per excess cell); 0 = no tick-time erosion
// (D4: D3's WEATHER_TICKS/Infinity weathering hook is retired — superseded
// by the tickWeathering geological pass below.)

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

// Variant for auxiliary arrays that are not per-cell (e.g. per-column).
function auxN(mw, name, Ctor, n) {
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
  tickCreep(mw); // D3: dry granular creep (no-op at founder CREEP_K = 0)
  if ((mw.tick | 0) % waterEvery === 0) tickWater(mw);
  tickDiffuse(mw); // R3: scalar diffusion before fire — moisture gates ignition
  tickFire(mw, fireOn);
  tickRot(mw);
  // D4: the geological weathering pass — every 200 ticks, ROCK at soil
  // interfaces accrues toward SOIL (deep time; ~51k ticks per conversion).
  if (((mw.tick | 0) % WEATHER_EVERY) === 0) tickWeathering(mw);
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
  // D4: the geology tags (strata, vein, weather) travel too.
  for (const f of ['mat', 'moist', 'root', 'grownId', 'dug', 'heat', 'water', 'nutrient', 'strata', 'vein', 'weather']) {
    const t = g[f][a];
    g[f][a] = g[f][b];
    g[f][b] = t;
  }
  for (const f of ['rot', 'burn', 'phase', 'smolder', 'weather']) {
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

// ---- Creep: dry granular erosion (D3) ----
//
// Sediment-ledger creep — NO fluids. One column pass per tick: where the
// surface drops more than REPOSE_DH cells across a column boundary, the
// higher column sheds its top loose cell (SOIL/SAND/CLAY only;
// ROCK/BEDROCK/WOOD immune) onto the lower column's surface. Cells
// relocate whole — every per-cell field travels via the swapCells
// discipline — so the invariant is exact: sum over columns of
// count(mat = m) is constant for every material m. Nothing is created or
// destroyed; nothing pours.
//
// Deterministic: boundaries process west -> east; when two boundaries
// compete for one donor column in a tick, west wins (sweep order).
// At founder CREEP_K = 0 this is a no-op — tick-time erosion did not
// exist before D3 (worldgen keeps its own erosion passes).
function surfaceHeight(g, c) {
  // y of the topmost solid cell in column c, or rows if none.
  for (let y = 0; y < g.rows; y++) {
    if (MAT_PROPS[g.mat[y * g.cols + c]].solid) return y;
  }
  return g.rows;
}

const CREEP_LOOSE = new Set([MAT.SOIL, MAT.SAND, MAT.CLAY]);

export function tickCreep(mw) {
  // Probe hook: mw.creepK overrides the founder default (0) so the live
  // value can be exercised without touching the shipped constant.
  const ck = mw.creepK ?? CREEP_K;
  if (ck <= 0) return;
  const g = mw.grid;
  const { cols, rows, mat } = g;
  const H = auxN(mw, '_surfH', Int32Array, cols);
  for (let c = 0; c < cols; c++) H[c] = surfaceHeight(g, c);
  const acc = auxN(mw, '_creepAcc', Float32Array, cols - 1);
  for (let c = 0; c < cols - 1; c++) {
    const d = H[c] - H[c + 1]; // signed drop (y grows downward)
    const excess = Math.abs(d) - REPOSE_DH;
    if (excess <= 0) continue;
    acc[c] = Math.min(4, acc[c] + ck * excess); // bounded pressure memory
    if (acc[c] < 1) continue;
    const dc = d < 0 ? c : c + 1; // donor = the higher column (smaller y)
    const lc = dc === c ? c + 1 : c;
    const dy = H[dc];
    if (dy >= rows) continue;
    const di = dy * cols + dc;
    if (!CREEP_LOOSE.has(mat[di])) continue; // only loose cells creep
    const ly = H[lc] - 1; // the air cell atop the lower column's surface
    if (ly < 0 || mat[ly * cols + lc] !== MAT.AIR) continue;
    swapCells(g, mw, di, ly * cols + lc);
    acc[c] -= 1;
    H[dc] = surfaceHeight(g, dc);
    H[lc] = surfaceHeight(g, lc);
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
// D3: fire as a state machine, not a heat predicate. Per-cell `phase`
// (Uint8 aux): 0 unlit / 1 flaming / 2 smoldering — phase carries the
// memory that heat alone cannot. `smolder` (Float32 aux) accrues
// smolder-ticks on smoldering cells.
//
// Cells with flammability > 0 and heat above the moisture-gated ignition
// ignite (phase 0 -> 1). Flaming cells spread heat to flammable
// 8-neighbors (post-sweep, ~1 cell/tick) and convert after sustained
// burn: LEAF -> AIR (fast), WOOD -> CHAR -> DEADWOOD (the char layer is
// timing-neutral at founder defaults: 30 + 30 = today's 60-tick WOOD
// burn), DEADWOOD -> SOIL. When a flaming cell's heat falls below
// SMOLDER_HEAT it smolders: slow charring, ember deposits to neighbors,
// re-flare if reheated while dry, burnout to inert residue after
// SMOLDER_OUT smolder-ticks. With fireOn=false there is no ignition, no
// spread, and no conversion — heat just decays and phase clears.
function burnTicksFor(m) {
  if (m === MAT.LEAF) return BURN_TICKS_LEAF;
  if (m === MAT.WOOD) return CHAR_TICKS;
  if (m === MAT.CHAR) return CHAR_BURN;
  return BURN_TICKS_DEADWOOD;
}

const clampSpread = (v) => (v < 0 ? 0 : v > 2 ? 2 : v);

export function tickFire(mw, fireOn) {
  const g = mw.grid;
  const { cols, rows, mat, heat, moist } = g;
  const burn = aux(mw, 'burn', Float32Array);
  const phase = aux(mw, 'phase', Uint8Array);
  const smolder = aux(mw, 'smolder', Float32Array);
  // Spread accumulates here and applies after the sweep: fire advances
  // ~1 cell per tick. (Applying spread in-sweep let one tick chain
  // across the whole fuel bed — a lightning strike flash-burned half
  // the world's canopy. It also let heat run to Infinity.)
  const spread = aux(mw, 'spread', Float32Array);
  // D3: wind bias drinks from the pinned global sky wind only (not the
  // per-cell hash noise, which stays in the renderer/leaf-sway domain).
  // No sky (test worlds) -> windU = 0 -> bias exactly 1, deterministic.
  const windU = mw.sky ? mw.sky.windU : 0;
  // Probe hook: mw.fuelK overrides the founder default (0).
  const fuelK = mw.fuelK ?? FUEL_K;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      heat[i] *= HEAT_DECAY;
      // Heat is a 0..1-ish intensity (strike sets 0.9) — clamp it.
      if (heat[i] > 1.5) heat[i] = 1.5;
      if (!fireOn) {
        // Heat decays only; the fire's memory clears with it.
        if (phase[i] !== 0) { phase[i] = 0; burn[i] = 0; smolder[i] = 0; }
        continue;
      }
      const m = mat[i];
      const fl = MAT_PROPS[m].flammability;
      if (fl <= 0) {
        // Unburnable (or became so mid-fire, e.g. dug out) — no phase.
        if (phase[i] !== 0) { phase[i] = 0; burn[i] = 0; smolder[i] = 0; }
        continue;
      }
      // Ignition (phase 0 -> 1). Two doors, matching the old code's two
      // independent predicates: the moisture-gated ignition gate (which
      // also arms spreading), and the raw burning predicate — a cell hot
      // enough to burn is burning even when too wet to carry fire
      // (it burns out alone, spreading nothing: the spread loop below
      // stays gate-limited by the cell's own moisture, as before).
      // R3 (reactive biomes): ignition is moisture-gated — dry fuel catches
      // at IGNITION_HEAT, soaked fuel needs twice the heat. A lightning
      // strike (heat 0.9) ignites at moist < 0.80, fizzles above it.
      if (phase[i] === 0) {
        if (heat[i] > IGNITION_HEAT * (1 + moist[i]) || heat[i] > BURNING_HEAT) phase[i] = 1;
        else continue;
      }
      if (phase[i] === 1) {
        // ---- flaming ----
        burn[i] += 1;
        if (heat[i] < SMOLDER_HEAT) {
          phase[i] = 2; // the fire goes underground, into the coals
        } else if (heat[i] > IGNITION_HEAT * (1 + moist[i])) {
          // Spread, modulated — only while hot enough to carry. The
          // post-sweep accumulation discipline is unchanged (this is the
          // guardrail the old flash-burn bug taught).
          // windBias = clamp(1 + WIND_SPREAD_K·U·sign(dx), 0, 2);
          // fuelLoad = 1 - FUEL_K·(burn/BURN_TICKS_m) — a nearly-spent cell
          // pushes the front weakly. At founder defaults (FUEL_K = 0,
          // windU = 0 in test worlds) this is today's flat term exactly.
          const fuel = 1 - fuelK * (burn[i] / burnTicksFor(m));
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
              if (fn > 0) {
                const wb = clampSpread(1 + WIND_SPREAD_K * windU * Math.sign(dx));
                spread[n] = Math.min(1.5, spread[n] + heat[i] * fn * SPREAD_K * (1 - moist[n]) * wb * fuel);
              }
            }
          }
        }
        // Conversions. LEAF -> AIR (fast), DEADWOOD -> SOIL (rots to
        // earth), WOOD -> CHAR -> DEADWOOD (long burn through the char layer).
        if (m === MAT.LEAF && burn[i] >= BURN_TICKS_LEAF) {
          mat[i] = MAT.AIR;
          heat[i] = 0; burn[i] = 0; smolder[i] = 0; phase[i] = 0;
        } else if (m === MAT.WOOD && burn[i] >= CHAR_TICKS) {
          mat[i] = MAT.CHAR;
          heat[i] = 0; burn[i] = 0; smolder[i] = 0; // still flaming, now as char
        } else if (m === MAT.CHAR && burn[i] >= CHAR_BURN) {
          mat[i] = MAT.DEADWOOD;
          heat[i] = 0; burn[i] = 0; smolder[i] = 0;
        } else if (m === MAT.DEADWOOD && burn[i] >= BURN_TICKS_DEADWOOD) {
          mat[i] = MAT.SOIL; // mass-conserving: it rots to earth
          heat[i] = 0; burn[i] = 0; smolder[i] = 0; phase[i] = 0;
        }
      } else {
        // ---- smoldering (phase 2) ----
        smolder[i] += 0.25; // slow charring — quarter rate
        if (heat[i] > REFLARE_HEAT && moist[i] < REFLARE_MOIST) {
          phase[i] = 1; // re-flare: the coals catch again
          smolder[i] = 0;
        } else if (smolder[i] >= SMOLDER_OUT) {
          phase[i] = 0; // burned out to inert CHAR/DEADWOOD residue
          burn[i] = 0; smolder[i] = 0;
        } else {
          // Ember carryover: a smoldering log is a real ignition risk,
          // but too slow to run away on its own.
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
              const n = ny * cols + nx;
              if (MAT_PROPS[mat[n]].flammability > 0) {
                spread[n] = Math.min(1.5, spread[n] + EMBER_K * (1 - moist[n]));
              }
            }
          }
        }
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

// --- D4 geology: the weathering pass ----------------------------------------
// D4 supersedes D3's tickRot weathering (WEATHER_TICKS/Infinity probe hook,
// removed): weathering is now a first-class geological process on the
// grid's own Uint8 `weather` array (grid.js), run every WEATHER_EVERY
// material ticks.
//
// Rule: ROCK cells adjacent (4-neighborhood) to SOIL, SAND, CLAY, or AIR
// accrue weather[i] += step; at 255 the cell becomes SOIL in place —
// 51,200 ticks per conversion at founder step 1 (~21 days), honest deep
// time. Fresh-weathered soil starts nutrient-poor (nutrient = 0); the vein
// tag survives the conversion (the minerals don't vanish when the rock
// becomes soil — geophagy reads it there). Mass-conserving: the cell above
// is unchanged; no teleportation.
//
// Frozen control (same pattern as tickRot's rot deposit): the conversion
// still happens (mechanics), but the scalar side-effects (moist, nutrient
// writes) are skipped.
// P6 neutral: mw.weatherStep = 0 disables the pass entirely.
export const WEATHER_EVERY = 200;
export const WEATHER_STEP = 1;
export const WEATHER_CONVERT = 255;

export function tickWeathering(mw) {
  const g = mw.grid;
  const step = mw.weatherStep ?? WEATHER_STEP;
  if (!(step > 0)) return;
  const { cols, rows, mat, moist, nutrient, weather } = g;
  if (!weather) return;
  const frozen = !!mw.frozenBiome;
  const n = cols * rows;
  const weatherable = (m) => m === MAT.SOIL || m === MAT.SAND || m === MAT.CLAY || m === MAT.AIR;
  for (let i = 0; i < n; i++) {
    if (mat[i] !== MAT.ROCK) continue;
    const x = i % cols, y = (i / cols) | 0;
    let adj = false, mSum = 0, mN = 0;
    if (x > 0 && weatherable(mat[i - 1])) { adj = true; mSum += moist[i - 1]; mN++; }
    if (x < cols - 1 && weatherable(mat[i + 1])) { adj = true; mSum += moist[i + 1]; mN++; }
    if (y > 0 && weatherable(mat[i - cols])) { adj = true; mSum += moist[i - cols]; mN++; }
    if (y < rows - 1 && weatherable(mat[i + cols])) { adj = true; mSum += moist[i + cols]; mN++; }
    if (!adj) continue;
    const w = weather[i] + step;
    if (w >= WEATHER_CONVERT) {
      mat[i] = MAT.SOIL;
      weather[i] = 0;
      // The vein tag survives (mineral endowment, not material).
      if (!frozen) {
        moist[i] = mN > 0 ? mSum / mN : moist[i];
        if (nutrient) nutrient[i] = 0; // fresh soil is poor — it must be earned
      }
    } else {
      weather[i] = w;
    }
  }
}
