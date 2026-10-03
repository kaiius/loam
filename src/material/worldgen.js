// Canopy material world — GENERATIVE WORLDGEN (M1).
//
// generateMaterialWorld(seed, size) -> a grown, diggable cellular world.
// New parallel track: does not touch src/sim/, src/render/, or any
// existing test. Tick-time processes are the other agent's job (M2+).
//
// Pipeline (§2.2 draw order — NEVER reorder):
//   1. elevation: seeded fbm + tectonic ridges + rift basins + lake carves
//      + edge pinning + 2-pass box-blur erosion. Free field, no zone anchors.
//   2. rasterize to materials (sea level drawn here) + climate wave (T/M)
//   3. erosion passes (40, worldgen-time): soil creep, pure geometry
//   4. water table: flood-fill WATER from sea level; inland basins = lakes
//   5. grow the flora: deterministic L-system from soil seed cells
//   6. emergent labels: climate classifier over columns (descriptive only)
//   7. viability gate: reject-and-resample, gentle fallback, never throws
//
// Draw order on the worldgen stream (load-bearing, documented):
//   sea level -> noise frequencies -> noise seed -> ridge params ->
//   rift params -> lake-basin carves -> climate wave -> soilDepth jitter ->
//   clay lens draws -> [growth: stateless hash only, no draws] ->
//   [spawn: deterministic pick, no draws]
// (Sea level leads, mirroring design §2.2's "landFrac target" first draw;
// the lake carves target it, so inland basins reliably sit below it.)
//
// Determinism: same (seed, size) -> bit-identical substrate. All worldgen
// draws come from `gen`; the tick never draws. Growth branching angles come
// from hash2(seed, plantId, iter) — stateless, no stream inside growth.
// NOTE: growth uses Math.cos/sin, but only through Math.round of a unit
// step whose components stay clear of .5 boundaries (branch angles are
// drawn from [30.5, 49.5) degrees, never exactly 30/60), so the step is
// robust to float wobble; same-engine runs are bit-identical.

import { createRng } from '../sim/rng.js';
import { createGrid, MAT, CELL_PX } from './grid.js';

export const MATERIAL_ROWS = 110;          // WORLD_H 1100 / CELL_PX
export const MATERIAL_COLS_PER_SIZE = 480; // 4800px wide at size 1
export const WORLD_H_PX = 1100;
export const MAX_ATTEMPTS = 100;

// --- value noise, copied verbatim from src/sim/worldgen.js ------------------
function hash01(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, seed) {
  const ix = Math.floor(x), fx = x - ix;
  const a = hash01(Math.imul(ix, 374761393) + Math.imul(seed, 668265263));
  const b = hash01(Math.imul(ix + 1, 374761393) + Math.imul(seed, 668265263));
  const u = fx * fx * (3 - 2 * fx);
  return a + (b - a) * u;
}

function fbm(x, seed, oct = 3) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x * f, seed + o * 101);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm; // [0,1)
}

// --- stateless hash -> [0,1): branching angles, never a stream --------------
function hash2(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// --- stream mixer: new salt 0x38 (v2 used 0x27, v0.26 used 0x26) ------------
function mixSeed(seed, size, attempt) {
  return (((seed * 2654435761) ^ (size * 40503) ^ (attempt * 65599) ^ 0x38) >>> 0);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// === stage 1: elevation (row units, 0 = top) =================================
// seaRow is drawn BEFORE elevation (design §2.2: the "landFrac target" draw
// leads) so the lake-basin carves can target floors just below it.
function buildElevation(gen, cols, seaRow, gentle) {
  const o1 = gentle ? 0.004 : 0.004 + gen.range(0, 0.002);
  const o2 = gentle ? 0.016 : 0.016 + gen.range(0, 0.008);
  const o3 = gentle ? 0.05 : 0.05 + gen.range(0, 0.02);
  const sN = gentle ? 123456789 : gen.int(1, 1e9);
  const base = 62;
  const field = new Float32Array(cols);
  for (let i = 0; i < cols; i++) {
    field[i] = base
      + (fbm(i * o1, sN, 3) - 0.5) * 26
      + (fbm(i * o2 + 500, sN + 1, 3) - 0.5) * 10
      + (fbm(i * o3 + 900, sN + 2, 3) - 0.5) * 4;
  }
  if (!gentle) {
    // Tectonic ridges: 1-3 gaussian uplifts (subtracted: higher altitude).
    const ridges = 1 + gen.int(0, 2);
    for (let k = 0; k < ridges; k++) {
      const cx = gen.range(cols * 0.15, cols * 0.85);
      const wdt = gen.range(18, 42), hgt = gen.range(10, 20);
      for (let i = 0; i < cols; i++) {
        const d = (i - cx) / wdt;
        if (d > -3 && d < 3) field[i] -= hgt * Math.exp(-d * d);
      }
    }
    // Rift basins: 60% chance of one sunken basin.
    if (gen.next() < 0.6) {
      const cx = gen.range(cols * 0.2, cols * 0.8);
      const wdt = gen.range(12, 26), dep = gen.range(6, 12);
      for (let i = 0; i < cols; i++) {
        const d = (i - cx) / wdt;
        if (d > -3 && d < 3) field[i] += dep * Math.exp(-d * d);
      }
    }
    // Lake-basin carves: 2-3 gaussian pits with floors a few rows below
    // sea level and rims above it -> inland freshwater lakes.
    const nLakes = 2 + gen.int(0, 1);
    for (let k = 0; k < nLakes; k++) {
      const cx = gen.range(cols * 0.15, cols * 0.85);
      const wdt = gen.range(6, 12);
      const floorT = seaRow + 2 + gen.next() * 4; // 2-6 rows below sea level
      const dep = Math.max(0, floorT - field[Math.round(cx)]);
      if (dep <= 0) continue;
      for (let i = 0; i < cols; i++) {
        const d = (i - cx) / wdt;
        if (d > -3 && d < 3) field[i] += dep * Math.exp(-d * d);
      }
    }
  } else {
    // Gentle fallback: flatten toward the baseline, one fixed lake basin.
    for (let i = 0; i < cols; i++) field[i] = base + (field[i] - base) * 0.3;
    const cx = cols * 0.5, wdt = 8, dep = Math.max(0, (seaRow + 4) - field[Math.round(cx)]);
    for (let i = 0; i < cols; i++) {
      const d = (i - cx) / wdt;
      if (d > -3 && d < 3) field[i] += dep * Math.exp(-d * d);
    }
  }
  // Edge pinning: no sheer cliffs at the world boundary.
  for (let i = 0; i < 12; i++) {
    const t = i / 12, s = t * t * (3 - 2 * t);
    field[i] = field[12] + (field[i] - field[12]) * s;
    const j = cols - 1 - i;
    field[j] = field[cols - 13] + (field[j] - field[cols - 13]) * s;
  }
  // Erosion: two box-blur passes (radius 2), then round to integer rows.
  let cur = Array.from(field);
  for (let pass = 0; pass < 2; pass++) {
    const next = cur.slice();
    for (let i = 0; i < cols; i++) {
      let sum = 0, cnt = 0;
      for (let k = -2; k <= 2; k++) {
        const v = cur[i + k];
        if (v !== undefined) { sum += v; cnt++; }
      }
      next[i] = sum / cnt;
    }
    cur = next;
  }
  // Slope on the PRE-ROUNDED field (rounding first would stairstep it).
  const slope = new Float32Array(cols);
  for (let i = 0; i < cols; i++) {
    const e0 = cur[Math.max(0, i - 1)], e1 = cur[Math.min(cols - 1, i + 1)];
    slope[i] = Math.abs(e1 - e0) / 2;
  }
  const surf = cur.map((v) => Math.max(6, Math.min(MATERIAL_ROWS - 4, Math.round(v))));
  return { surf, slope };
}

// === stage 2: rasterize + climate ============================================
function buildClimate(gen, cols, surf, seaRow, gentle) {
  const T = new Float32Array(cols), M = new Float32Array(cols);
  if (gentle) {
    // Fixed warm-west -> cool-east gradient: guarantees label spread.
    for (let c = 0; c < cols; c++) {
      const t = c / Math.max(1, cols - 1);
      T[c] = clamp01(0.85 - 0.55 * t + (fbm(c * 0.008, 12345, 2) - 0.5) * 0.06);
      M[c] = clamp01(0.55 + (fbm(c * 0.006 + 300, 67890, 3) - 0.5) * 0.4);
    }
    return { T, M };
  }
  const warmWest = gen.next() < 0.5;
  const latAmp = 0.10 + gen.next() * 0.10;
  const tSeed = gen.int(1, 1e9), mSeed = gen.int(1, 1e9);
  for (let c = 0; c < cols; c++) {
    const lat = warmWest ? 1 - c / (cols - 1) : c / (cols - 1); // 1 = warm side
    const lapse = Math.max(0, 62 - surf[c]) / 40;              // elevation cold
    const beach = surf[c] <= seaRow && (seaRow - surf[c]) <= 2;
    const uw = surf[c] > seaRow;
    T[c] = clamp01(0.72 + latAmp * (lat - 0.5) * 2 - 0.35 * lapse
      + (fbm(c * 0.008, tSeed, 2) - 0.5) * 0.16);
    M[c] = clamp01(0.42 + (fbm(c * 0.006 + 300, mSeed, 3) - 0.5) * 0.7
      - 0.10 * lapse + ((uw || beach) ? 0.35 : 0));
  }
  return { T, M };
}

function rasterize(gen, g, cols, rows, surf, slope, M, seaRow, gentle) {
  for (let c = 0; c < cols; c++) {
    const s = surf[c];
    const underwater = s > seaRow;
    const beach = !underwater && (seaRow - s) <= 2; // within 25px above sea
    const cliff = !underwater && !beach && slope[c] > 0.9; // steep -> ROCK face
    let sd = 0;
    if (!underwater && !cliff) {
      // soilDepth 3-8 from fertility x moisture, with a seeded jitter draw.
      sd = 3 + Math.min(5, Math.floor(1.0 * M[c] * 6 + gen.next()));
      if (beach) sd = Math.max(2, sd - 2);
      if (gentle) sd = 6;
    }
    for (let r = s; r < rows; r++) {
      const i = r * cols + c;
      if (r >= rows - 3) { g.mat[i] = MAT.BEDROCK; continue; }
      const d = r - s;
      if (underwater) {
        if (d < 3) { g.mat[i] = MAT.SAND; g.moist[i] = 1; }
        else g.mat[i] = MAT.ROCK;
      } else if (cliff) {
        g.mat[i] = MAT.ROCK; g.moist[i] = M[c] * 0.4;
      } else if (beach) {
        if (d < 2) g.mat[i] = MAT.SAND;
        else if (d < 2 + sd) g.mat[i] = MAT.SOIL;
        else g.mat[i] = MAT.ROCK;
        g.moist[i] = M[c];
      } else {
        if (d < sd) { g.mat[i] = MAT.SOIL; g.moist[i] = M[c]; }
        else { g.mat[i] = MAT.ROCK; g.moist[i] = M[c] * 0.4; }
      }
    }
    // CLAY lenses where moisture is high (seeded): replace a short run of
    // ROCK below the soil with CLAY.
    if (!underwater && !cliff && M[c] > 0.55 && gen.next() < (M[c] - 0.55) * 2.5) {
      const center = s + sd + 2 + gen.int(0, 5);
      const half = 1 + gen.int(0, 2);
      for (let r = center - half; r <= center + half; r++) {
        if (r <= s + sd || r >= rows - 3) continue;
        const i = r * cols + c;
        if (g.mat[i] === MAT.ROCK) g.mat[i] = MAT.CLAY;
      }
    }
  }
}

// === stage 3: erosion (40 passes, soil creep, pure geometry, no draws) ======
function erode(g, cols, rows, surf, seaRow) {
  const REPOSE = 2, PASSES = 40;
  for (let pass = 0; pass < PASSES; pass++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = c, b = c + 1;
      const diff = surf[a] - surf[b];
      if (diff <= REPOSE && diff >= -REPOSE) continue;
      const hi = diff < 0 ? a : b; // smaller row = higher altitude
      const lo = diff < 0 ? b : a;
      if (surf[hi] > seaRow || surf[lo] > seaRow) continue; // not seabeds
      if (surf[lo] <= 1) continue;
      const si = surf[hi] * cols + hi, di = (surf[lo] - 1) * cols + lo;
      if (g.mat[si] !== MAT.SOIL) continue;
      if (g.mat[di] !== MAT.AIR) continue;
      g.mat[di] = MAT.SOIL; g.moist[di] = g.moist[si];
      g.mat[si] = MAT.AIR; g.moist[si] = 0;
      surf[hi]++; surf[lo]--;
    }
  }
}

// === stage 4: water table ====================================================
function fillWater(g, cols, rows, surf, seaRow) {
  for (let c = 0; c < cols; c++) {
    const s = surf[c];
    for (let r = seaRow; r < s && r < rows; r++) {
      const i = r * cols + c;
      if (g.mat[i] === MAT.AIR) { g.mat[i] = MAT.WATER; g.water[i] = 1; }
    }
  }
  // Ocean = water connected to the world edges (4-connectivity).
  const seen = new Uint8Array(cols * rows);
  const stack = [];
  for (let r = 0; r < rows; r++) {
    for (let e = 0; e < cols; e += Math.max(1, cols - 1)) {
      const i = r * cols + e;
      if (g.mat[i] === MAT.WATER) { seen[i] = 1; stack.push(i); }
    }
  }
  const pushWaterNeighbor = (j, mark, st) => {
    if (!mark[j] && g.mat[j] === MAT.WATER) { mark[j] = 1; st.push(j); }
  };
  while (stack.length) {
    const i = stack.pop();
    const x = i % cols, y = (i / cols) | 0;
    if (x > 0) pushWaterNeighbor(i - 1, seen, stack);
    if (x < cols - 1) pushWaterNeighbor(i + 1, seen, stack);
    if (y > 0) pushWaterNeighbor(i - cols, seen, stack);
    if (y < rows - 1) pushWaterNeighbor(i + cols, seen, stack);
  }
  // Distinct inland bodies >= 4 cells = freshwater lakes.
  const seenLake = new Uint8Array(cols * rows);
  let lakes = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (g.mat[i] !== MAT.WATER || seen[i] || seenLake[i]) continue;
    let size = 0;
    const st = [i]; seenLake[i] = 1;
    while (st.length) {
      const j = st.pop(); size++;
      const x = j % cols, y = (j / cols) | 0;
      if (x > 0) pushWaterNeighbor(j - 1, seenLake, st);
      if (x < cols - 1) pushWaterNeighbor(j + 1, seenLake, st);
      if (y > 0) pushWaterNeighbor(j - cols, seenLake, st);
      if (y < rows - 1) pushWaterNeighbor(j + cols, seenLake, st);
    }
    if (size >= 4) lakes++;
  }
  // moist = 1 on solid cells near water.
  for (let i = 0; i < cols * rows; i++) {
    if (g.mat[i] !== MAT.WATER) continue;
    const x = i % cols, y = (i / cols) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (g.mat[j] !== MAT.WATER && g.mat[j] !== MAT.AIR) g.moist[j] = 1;
    }
  }
  return lakes;
}

// === stage 5: grow the flora (the anti-floating guarantee) ==================
// A plant is GROWN, never placed: every new WOOD cell is 8-adjacent to the
// previous tip cell, so the whole plant is 8-connected back to its seed by
// construction. LEAF clusters are 3x3 around a tip (Chebyshev <= 1), so each
// LEAF cell is 8-adjacent to its tip's WOOD.
function growPlant(seed, pid, sx, sy, iters, g, cols, rows) {
  let wood = 0, leaf = 0;
  const putWood = (x, y) => {
    if (x < 0 || y < 1 || x >= cols || y >= rows - 3) return false;
    const i = y * cols + x;
    if (g.mat[i] !== MAT.AIR) return false;
    g.mat[i] = MAT.WOOD; g.root[i] = 1; g.grownId[i] = pid; wood++;
    return true;
  };
  // M2: lusher canopies via DENSER branching (every 3rd iteration in good
  // climate), not bigger clusters — the 3x3 cluster keeps every leaf
  // 8-adjacent to tip WOOD, which is what the orphan assert guarantees.
  // (A 5x5 fringe broke it: fringe leaves touch leaf, not wood.)
  const putLeafCluster = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const i = ny * cols + nx;
      if (g.mat[i] !== MAT.AIR) continue;
      g.mat[i] = MAT.LEAF; g.root[i] = 1; g.grownId[i] = pid; leaf++;
    }
  };
  // Tips: the apical shoot, then branch buds. {x, y, ang, life, bud}.
  let tips = [{ x: sx, y: sy, ang: -Math.PI / 2, life: iters, bud: false }];
  for (let it = 0; it < iters && tips.length; it++) {
    const next = [];
    for (const t of tips) {
      // M2: every 3rd iteration the apical shoot buds a branch at +/-30-50deg
      // (was 4th — denser branching = lusher canopies, same 3x3 clusters).
      // Angles come from hash2(seed, plantId, iter): stateless, no stream.
      // Drawn from [30.5, 49.5) — never exactly 30/60, so Math.round of the
      // unit step never sits on a .5 boundary (float-wobble safety).
      if (!t.bud && it > 0 && it % 3 === 0) {
        const hr = hash2(seed, pid, it);
        const side = hr < 0.5 ? -1 : 1;
        const deg = 30.5 + hash2(seed, pid, it + 7919) * 19;
        const budLen = 6 + Math.floor(hash2(seed, pid, it + 104729) * 5);
        next.push({ x: t.x, y: t.y, ang: t.ang + side * deg * Math.PI / 180, life: budLen, bud: true });
      }
      const nx = Math.round(t.x + Math.cos(t.ang));
      const ny = Math.round(t.y + Math.sin(t.ang));
      let grew = false;
      if (t.life > 0 && putWood(nx, ny)) { t.x = nx; t.y = ny; t.life--; grew = true; }
      if (grew && t.life === 0) putLeafCluster(nx, ny); // bud/apex terminates
      else if (grew) next.push(t);
      // A tip that cannot advance dies (crowded stop) — no leaf cluster.
    }
    tips = next;
  }
  return { wood, leaf };
}

function growFlora(seed, g, cols, rows, surf, T, M, seaRow, size, log) {
  const plants = [];
  // Seed selection: SOIL surface cells with fertility x moisture above
  // threshold (soil fertility = 1.0), spaced >= 12 cells apart
  // (competition), west -> east. Count scales with fertile area.
  const SEED_GAP = 12, SEED_THRESH = 0.38;
  const maxPlants = Math.min(400 * Math.max(1, Math.round(size)), 60000);
  let lastX = -SEED_GAP - 1, pid = 0;
  for (let c = 0; c < cols && pid < maxPlants; c++) {
    const s = surf[c];
    if (s > seaRow) continue;                 // submerged: no seeds
    if (c - lastX < SEED_GAP) continue;       // competition spacing
    if (g.mat[s * cols + c] !== MAT.SOIL) continue; // cliffs/beaches don't seed
    if (M[c] < SEED_THRESH) continue;         // fertility(1.0) x moisture
    pid++;
    const score = T[c] * M[c];
    const iters = score > 0.55 ? 56 : score > 0.35 ? 32 : 16; // jungle..scrub (M2: lusher)
    const { wood, leaf } = growPlant(seed, pid, c, s, iters, g, cols, rows);
    plants.push({ id: pid, seedX: c, seedY: s, iters, fruiting: false, wood, leaf });
    lastX = c;
  }
  // Fruiting: best climate first; keep a margin over the G1 requirement.
  const need = 8 * size;
  const ranked = plants
    .map((p) => ({ p, score: T[p.seedX] * M[p.seedX] }))
    .sort((a, b) => (b.score - a.score) || (a.p.seedX - b.p.seedX));
  let mark = ranked.filter((r) => r.score > 0.42);
  if (mark.length < need + 4) mark = ranked.slice(0, Math.min(ranked.length, Math.ceil(need + 4)));
  for (const r of mark) { r.p.fruiting = true; r.p.fruit = 5; } // M2: edible fruit count
  log.push(`flora: ${plants.length} plants grown, ${mark.length} fruiting`);
  return plants;
}

// Debug assert: flood-fill 8-connected WOOD from every seed; any WOOD/LEAF
// cell unreachable is deleted (an orphan = a growth-rule bug, not a world).
function assertNoOrphans(g, cols, rows, plants, log) {
  const n = cols * rows;
  const visited = new Uint8Array(n);
  const stack = [];
  for (const p of plants) {
    const si = p.seedY * cols + p.seedX;
    if (!visited[si]) { visited[si] = 1; stack.push(si); }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % cols, y = (i / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (!visited[j] && g.mat[j] === MAT.WOOD) { visited[j] = 1; stack.push(j); }
    }
  }
  let deleted = 0;
  for (let i = 0; i < n; i++) {
    const m = g.mat[i];
    if (m === MAT.WOOD) {
      if (!visited[i]) { g.mat[i] = MAT.AIR; g.root[i] = 0; g.grownId[i] = 0; deleted++; }
    } else if (m === MAT.LEAF) {
      const x = i % cols, y = (i / cols) | 0;
      let adj = false;
      for (let dy = -1; dy <= 1 && !adj; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (visited[ny * cols + nx]) { adj = true; break; }
      }
      if (!adj) { g.mat[i] = MAT.AIR; g.root[i] = 0; g.grownId[i] = 0; deleted++; }
    }
  }
  log.push(`orphans: flood-fill from ${plants.length} seeds, deleted ${deleted} unreachable cells`);
  return deleted;
}

// === stage 6: emergent labels (descriptive only — physics never reads) ======
const LAND_LABELS = new Set(['arctic', 'mountains', 'jungle', 'plains', 'desert', 'archipelago']);

function classifyColumn(Tc, Mc, depth, slopeC, s) {
  if (depth > 6) return 'deep';
  if (depth > 0) return 'shallows';
  const tempC = -10 + 45 * Tc;
  if (tempC < 2) return 'arctic';
  if (slopeC > 0.9 || s < 40) return 'mountains';
  if (tempC >= 24) return Mc < 0.30 ? 'desert' : (Mc < 0.55 ? 'plains' : 'jungle');
  if (tempC >= 10) return Mc < 0.55 ? 'plains' : 'jungle';
  return Mc < 0.35 ? 'plains' : 'mountains';
}

function computeSlope(surf, cols) {
  const slope = new Float32Array(cols);
  for (let i = 0; i < cols; i++) {
    const e0 = surf[Math.max(0, i - 1)], e1 = surf[Math.min(cols - 1, i + 1)];
    slope[i] = Math.abs(e1 - e0) / 2;
  }
  return slope;
}

function buildLabels(cols, surf, slope, T, M, seaRow) {
  const per = new Array(cols);
  for (let c = 0; c < cols; c++) {
    per[c] = classifyColumn(T[c], M[c], surf[c] - seaRow, slope[c], surf[c]);
  }
  // Archipelago post-pass: land runs < 30 columns wide -> archipelago.
  let c = 0;
  while (c < cols) {
    if (surf[c] <= seaRow) {
      let e = c;
      while (e < cols && surf[e] <= seaRow) e++;
      if (e - c < 30) for (let k = c; k < e; k++) per[k] = 'archipelago';
      c = e;
    } else c++;
  }
  // Merge contiguous same-label columns into ranges (x1 inclusive).
  const labels = [];
  let s0 = 0;
  for (let k = 1; k <= cols; k++) {
    if (k === cols || per[k] !== per[s0]) {
      labels.push({ key: per[s0], x0: s0, x1: k - 1 });
      s0 = k;
    }
  }
  return labels;
}

// === stage 7: spawn + viability gate =========================================
function pickSpawn(w) {
  const { grid, cols, surf, seaRow, plants } = w;
  const fruiting = plants.filter((p) => p.fruiting).sort((a, b) => a.seedX - b.seedX);
  // Defensive: a plant-less roll has no anchor — the gate (G1) will reject
  // it; pickSpawn must not crash before the gate runs.
  const anchor = fruiting.length ? fruiting[fruiting.length >> 1]
    : plants.length ? plants[0] : { seedX: Math.floor(cols / 2) };
  // A spawn needs open sky: 6 cells of AIR headroom above the surface
  // (a soil column under a grown trunk/canopy is not a spawn).
  const HEADROOM = 6;
  const headroomOk = (c, s) => {
    for (let r = s - HEADROOM; r < s; r++) {
      if (r < 0 || grid.mat[r * cols + c] !== MAT.AIR) return false;
    }
    return true;
  };
  let best = -1, bestD = Infinity;
  for (let c = 0; c < cols; c++) {
    const s = surf[c];
    if (s > seaRow) continue;
    if (grid.mat[s * cols + c] !== MAT.SOIL) continue;
    if (!headroomOk(c, s)) continue;
    const d = Math.abs(c - anchor.seedX);
    if (d < bestD) { bestD = d; best = c; }
  }
  let c = best;
  if (c < 0) {
    for (let k = 0; k < cols; k++) {
      const s = surf[k];
      if (s <= seaRow && grid.mat[s * cols + k] === MAT.SOIL && headroomOk(k, s)) { c = k; break; }
    }
  }
  if (c < 0) c = 0; // degenerate: G4 will reject this roll, no crash
  const s = surf[c];
  return { x: (c + 0.5) * CELL_PX, y: s * CELL_PX }; // feet on the surface cell
}

// Traversable = walk on land (step <= 6 cells) + swim across freshwater
// lakes. Ocean (edge-connected water) blocks. Lakes don't fragment the
// world; a world split by ocean does.
function walkableLandFraction(w) {
  const { grid, cols, rows, surf, seaRow, spawn } = w;
  const isLand = new Uint8Array(cols);
  let land = 0;
  for (let c = 0; c < cols; c++) {
    if (surf[c] <= seaRow) { isLand[c] = 1; land++; }
  }
  if (!land) return 0;
  // Lake columns: water not connected to the world edges.
  const isWaterCol = new Uint8Array(cols);
  for (let c = 0; c < cols; c++) {
    let any = false;
    for (let r = seaRow; r < surf[c] && r < rows; r++) {
      if (grid.mat[r * cols + c] === MAT.WATER) { any = true; break; }
    }
    isWaterCol[c] = any ? 1 : 0;
  }
  const ocean = new Uint8Array(cols);
  const stack = [];
  for (const e of [0, cols - 1]) {
    if (isWaterCol[e]) { ocean[e] = 1; stack.push(e); }
  }
  while (stack.length) {
    const c = stack.pop();
    for (const d of [-1, 1]) {
      const nc = c + d;
      if (nc >= 0 && nc < cols && isWaterCol[nc] && !ocean[nc]) { ocean[nc] = 1; stack.push(nc); }
    }
  }
  const traversable = (c) => isLand[c] || (isWaterCol[c] && !ocean[c]);
  const sc = Math.max(0, Math.min(cols - 1, Math.floor(spawn.x / CELL_PX)));
  const seen = new Uint8Array(cols);
  const st = [sc]; seen[sc] = 1;
  let reachLand = 0;
  while (st.length) {
    const c = st.pop();
    if (isLand[c]) reachLand++;
    for (const d of [-1, 1]) {
      const nc = c + d;
      if (nc < 0 || nc >= cols || seen[nc] || !traversable(nc)) continue;
      if (isLand[c] && isLand[nc] && Math.abs(surf[nc] - surf[c]) > 6) continue;
      seen[nc] = 1; st.push(nc);
    }
  }
  return reachLand / land;
}

export function checkViability(world) {
  const failures = [];
  // G1 — food: >= N fruit-bearing grown plants (N scales with size).
  const need = 8 * world.size;
  const fruiting = world.plants.filter((p) => p.fruiting).length;
  if (fruiting < need) failures.push(`G1 food: ${fruiting} fruiting plants, need ${need}`);
  // G2 — water: >= 1 freshwater lake.
  if (world.lakes < 1) failures.push('G2 water: no freshwater lake');
  // G3 — traversable: >= 80% of land surface reachable from spawn.
  const wf = walkableLandFraction(world);
  if (wf < 0.8) failures.push(`G3 traversable: reachable land ${(wf * 100).toFixed(1)}% < 80%`);
  // G4 — spawn is SOIL surface, not submerged.
  const sc = Math.floor(world.spawn.x / CELL_PX), sr = Math.floor(world.spawn.y / CELL_PX);
  const si = sr * world.cols + sc;
  const g4 = world.grid.mat[si] === MAT.SOIL
    && sr > 0 && world.grid.mat[si - world.cols] === MAT.AIR
    && sr <= world.seaRow;
  if (!g4) failures.push('G4 spawn: not a non-submerged SOIL surface cell');
  // G5 — biome spread: >= 3 distinct land labels genuinely emerge.
  const landKeys = new Set(world.labels.filter((l) => LAND_LABELS.has(l.key)).map((l) => l.key));
  if (landKeys.size < 3) failures.push(`G5 labels: ${landKeys.size} distinct land labels, need 3`);
  return { ok: failures.length === 0, failures };
}

// === driver ==================================================================
function buildWorld(seed, size, attempt, gentle, log) {
  const gen = createRng(mixSeed(seed, size, attempt));
  const cols = Math.max(1, Math.round(MATERIAL_COLS_PER_SIZE * size));
  const rows = MATERIAL_ROWS;
  const grid = createGrid(cols, rows);
  // Sea level leads the draw order (design §2.2: "landFrac target" first).
  const seaRow = gentle ? 78 : 78 + gen.int(-8, 8);
  // 1. elevation
  const { surf, slope } = buildElevation(gen, cols, seaRow, gentle);
  // 2. rasterize + climate
  const { T, M } = buildClimate(gen, cols, surf, seaRow, gentle);
  rasterize(gen, grid, cols, rows, surf, slope, M, seaRow, gentle);
  // 3. erosion (40 passes, no draws)
  erode(grid, cols, rows, surf, seaRow);
  // 4. water table
  const lakes = fillWater(grid, cols, rows, surf, seaRow);
  // 5. flora (stateless hash only)
  const plants = growFlora(seed, grid, cols, rows, surf, T, M, seaRow, size, log);
  const orphansDeleted = assertNoOrphans(grid, cols, rows, plants, log);
  // 6. labels (recompute slope on the post-erosion surface)
  const slope2 = computeSlope(surf, cols);
  const labels = buildLabels(cols, surf, slope2, T, M, seaRow);
  // 7. spawn + gate
  const world = { seed, size, grid, cols, rows, surf, seaRow, lakes, plants, labels, orphansDeleted, log };
  world.spawn = pickSpawn(world);
  return world;
}

function finalize(world, extra) {
  return {
    seed: world.seed,
    size: world.size,
    grid: world.grid,
    cols: world.cols,
    rows: world.rows,
    cellPx: CELL_PX,
    plants: world.plants,
    labels: world.labels,
    spawn: world.spawn,
    tick: 0,
    fireOn: true,
    permanentTunnels: false,
    orphansDeleted: world.orphansDeleted,
    seaRow: world.seaRow,
    lakes: world.lakes,
    surf: world.surf,
    log: world.log,
    ...extra,
  };
}

// Roll worlds until the gate passes. Deterministic: the attempt counter is
// mixed into the stream seed, so (seed, size) always takes the same attempts
// and lands on the same world. Never throws: after MAX_ATTEMPTS the gentle
// fallback (flattened terrain + fixed params) takes over; if even that
// fails, the last world is returned with gateOk: false.
export function generateMaterialWorld(seed, size = 1, opts = {}) {
  const startAttempt = opts.attempt ?? 0;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const log = [];
  const rejections = [];
  let world = null, gate = null, attempt = startAttempt;
  for (let a = 0; a < maxAttempts; a++) {
    attempt = startAttempt + a;
    world = buildWorld(seed, size, attempt, false, log);
    gate = checkViability(world);
    if (gate.ok) {
      log.push(`accept: attempt ${attempt} passed the viability gate`);
      return finalize(world, { attempts: a + 1, rejections, fallback: false, gateOk: true });
    }
    rejections.push({ attempt, failures: gate.failures.slice() });
    log.push(`reject: attempt ${attempt}: ${gate.failures.join('; ')}`);
  }
  for (let k = 0; k < 50; k++) {
    world = buildWorld(seed, size, k, true, log);
    gate = checkViability(world);
    if (gate.ok) {
      log.push(`fallback: gentle attempt ${k} accepted`);
      return finalize(world, { attempts: maxAttempts + k + 1, rejections, fallback: true, gateOk: true });
    }
    rejections.push({ attempt: `gentle-${k}`, failures: gate.failures.slice() });
    log.push(`reject: gentle attempt ${k}: ${gate.failures.join('; ')}`);
  }
  log.push('FAILED: even the gentle fallback failed — returning last world (gate not satisfied)');
  return finalize(world, { attempts: maxAttempts + 50, rejections, fallback: true, gateOk: false });
}
