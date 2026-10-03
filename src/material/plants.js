// Loam M3 — living plants. Not decoration.
//
// Every plant carries a diploid genome (sim/plantgenome.js: yield,
// fruitSize, interval, growthRate, bitterness, waterRet, coldTol, heatTol,
// saltTol, potency). Seeds inherit with mutation; pollinators outcross;
// grazers, drought, and cold select. A plant lineage evolves — heavy
// foraging spreads high-yield plants while bitterness deters, exactly the
// coevolution the platform track built.
//
// Lifecycle: seed → germination → growth (the L-system resumes at runtime,
// same stateless hash2 branching as worldgen) → maturity → fruiting →
// seeding → death (drought, cold, heat, age, fire, dug). Dead wood rots
// through the existing rot process; leaves fall.
//
// Ticks at the slow rate (every 50 material ticks); seeds every 10.
// Deterministic: stochastic choices use hash2(seed, id, tick), never a
// stream.

import { MAT, CELL_PX } from './grid.js';
import { hash2 } from './process.js';
import { createRng } from '../sim/rng.js';
import { randomPlantGenome, inheritPlant, plantPhenotype } from '../sim/plantgenome.js';
import { tempAt, moistureAt, windAt } from './weather.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- genome attachment (worldgen) ----------------------------------------
// Call once after growFlora: every plant becomes an individual.
export function attachPlantGenomes(plants, rng) {
  for (const p of plants) {
    p.genome = randomPlantGenome(rng);
    p.pheno = plantPhenotype(p.genome);
    p.growth = 1;          // worldgen plants are mature
    p.age = 0;             // plant-ticks lived
    p.stress = 0;          // drought/cold stress accumulator
    p.cells = null;        // worldgen plants don't track cells (bulk cleanup by grownId)
    p.generation = 0;
    // Fruit count from the yield gene (worldgen set a flat 5).
    if (p.fruiting) p.fruit = 1 + Math.round(2 * p.pheno.yield) + 3;
  }
  return plants;
}

// --- seeds ----------------------------------------------------------------

let nextSeedId = 1;

export function makeSeed(mw, x, y, genome, opts = {}) {
  return {
    id: nextSeedId++,
    x, y, vx: opts.vx || 0, vy: 0,
    genome,
    age: 0,
    parentId: opts.parentId || 0,
  };
}

// A fruit was eaten: the eater may carry a seed away (endozoochory).
// Pollinators that fed here enable outcrossing for this plant's seeds.
export function seedFromFeeding(mw, plant, eater) {
  if (!mw.seeds) mw.seeds = [];
  if (!plant.genome) return null; // decoration, not lineage — no seeds
  // Each fruit eaten is an independent event: the counter makes the 35%
  // roll differ per feeding even when no ticks pass between them.
  const n = (mw._feedCount = (mw._feedCount || 0) + 1);
  const h = hash2(mw.seed || 1, plant.id * 31 + (eater ? eater.id : 0) + n * 7919, mw.tick || 0);
  if (h > 0.35) return null; // most fruit is just eaten
  const mom = plant.genome;
  let dad = mom; // self-pollination is the common case
  const sp = eater ? eater.species : null;
  if (sp === 'beetle' || sp === 'flutter') {
    // A pollinator fed here: it carried foreign pollen. The nearest other
    // fruiting plant donates — outcrossing, the way the platform track
    // built it (v0.13 Roots).
    let best = null;
    for (const q of mw.plants || []) {
      if (q === plant || !q.fruiting || !q.genome) continue;
      const d = Math.abs(q.seedX - plant.seedX);
      if (!best || d < best.d) best = { d, q };
    }
    if (best) dad = best.q.genome;
  }
  // Meiosis draws from a stateless sub-stream: (seed, plant, tick).
  const mrng = createRng((hash2(mw.seed || 1, plant.id, mw.tick || 0) * 4294967296) >>> 0);
  const genome = inheritPlant(mom, dad, mrng, 0.008);
  const s = makeSeed(mw, eater ? eater.x : plant.seedX * CELL_PX, (eater ? eater.y : plant.seedY * CELL_PX) - 10, genome, { parentId: plant.id });
  s.parentGen = plant.generation || 0; // the generation counter is honest
  // Animal-carried: the seed drops from the eater with a small nudge in
  // the facing direction. The wind does the real moving (tickSeeds).
  s.vx = (eater && eater.facing ? eater.facing : 1) * (2 + h * 4);
  s.vy = -2;
  mw.seeds.push(s);
  return s;
}

// Seeds tick: wind advection + gravity, then landing → germination.
export function tickSeeds(mw) {
  if (!mw.seeds || !mw.seeds.length) return;
  const g = mw.grid;
  for (let i = mw.seeds.length - 1; i >= 0; i--) {
    const s = mw.seeds[i];
    s.age++;
    // Buried at birth (dropped inside the ground)? Pop up to the first
    // open cell — a seed must fall THROUGH air to land honestly.
    let scx0 = Math.floor(s.x / CELL_PX), scy0 = Math.floor(s.y / CELL_PX);
    if (scx0 >= 0 && scx0 < g.cols && scy0 >= 0 && scy0 < g.rows) {
      const here = g.mat[scy0 * g.cols + scx0];
      if (here !== MAT.AIR && here !== MAT.WATER) {
        let up = scy0;
        while (up > 0 && g.mat[up * g.cols + scx0] !== MAT.AIR) up--;
        if (g.mat[up * g.cols + scx0] === MAT.AIR) { s.y = up * CELL_PX + 5; s.vy = 0; }
        else { mw.seeds.splice(i, 1); continue; } // entombed — lost
      }
    }
    // Wind carries light seeds; gravity pulls.
    const w = windAt(mw, s.x);
    s.vx += w * 0.02;
    s.vx *= 0.98;
    s.vy = Math.min(60, s.vy + 2.2); // falls, terminal velocity
    s.x += s.vx * 0.1;
    s.y += s.vy * 0.1;
    // Landed? Anything solid below catches the seed — soil, wood, leaf,
    // rock. Only soil/sand can germinate (tryGerminate's gate); the rest
    // rot or are eaten. No hovering: a seed that touches down is done.
    const cx = Math.floor(s.x / CELL_PX), cy = Math.floor(s.y / CELL_PX);
    if (cx >= 0 && cx < g.cols && cy + 1 < g.rows && cy >= 0) {
      const below = g.mat[(cy + 1) * g.cols + cx];
      if (below !== MAT.AIR && below !== MAT.WATER) {
        tryGerminate(mw, s, cx, cy); // the air cell where the seed rests
        mw.seeds.splice(i, 1);
        continue;
      }
    }
    if (s.age > 600 || s.x < 0 || s.x > g.cols * CELL_PX) mw.seeds.splice(i, 1);
  }
}

function tryGerminate(mw, s, cx, cy) {
  const g = mw.grid;
  const i = cy * g.cols + cx;
  if (g.mat[i] !== MAT.AIR) return; // needs open air above soil
  const below = g.mat[(cy + 1) * g.cols + cx];
  if (below !== MAT.SOIL && below !== MAT.CLAY) return; // needs earth
  const moist = moistureAt(mw, s.x);
  const T = tempAt(mw, s.x);
  const ph = plantPhenotype(s.genome);
  if (moist < 0.22) return;                       // too dry to sprout
  const tempC = -10 + 45 * T;
  if (tempC < -6 + ph.coldTol * 16) return;       // too cold
  if (tempC > 22 + ph.heatTol * 13) return;       // too hot
  // Sprout: a new plant, generation + 1, growing from seed.
  const pid = 100000 + s.id; // runtime ids live above worldgen's
  const iters = Math.round(24 + ph.growthRate * 40);
  const p = {
    id: pid, seedX: cx, seedY: cy, iters,
    fruiting: false, fruit: 0,
    genome: s.genome, pheno: ph,
    growth: 0, age: 0, stress: 0,
    generation: (s.parentGen || 0) + 1,
    tips: [{ x: cx, y: cy, ang: -Math.PI / 2, life: iters, bud: false }],
    iterDone: 0,
    cells: [],
    wood: 0, leaf: 0,
  };
  if (!mw.plants) mw.plants = [];
  mw.plants.push(p);
}

// --- runtime growth: the L-system resumes ---------------------------------
// Same rules as worldgen's growPlant (stateless hash2 branching), advanced
// a few iterations per plant-tick from the stored tip list.

function putWoodCell(mw, p, nx, ny) {
  const g = mw.grid;
  if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) return false;
  const i = ny * g.cols + nx;
  if (g.mat[i] !== MAT.AIR) return false;
  g.mat[i] = MAT.WOOD; g.root[i] = 1; g.grownId[i] = p.id % 65536;
  p.wood++; p.cells.push(i);
  return true;
}

function putLeafCluster(mw, p, x, y) {
  const g = mw.grid;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
    const i = ny * g.cols + nx;
    if (g.mat[i] !== MAT.AIR) continue;
    g.mat[i] = MAT.LEAF; g.root[i] = 1; g.grownId[i] = p.id % 65536;
    p.leaf++; p.cells.push(i);
  }
}

export function advancePlant(mw, p, steps) {
  const seed = mw.seed || 1;
  for (let it = 0; it < steps && p.tips && p.tips.length; it++) {
    const k = p.iterDone++;
    const next = [];
    for (const t of p.tips) {
      if (!t.bud && k > 0 && k % 3 === 0) {
        const hr = hash2(seed, p.id, k);
        const side = hr < 0.5 ? -1 : 1;
        const deg = 30.5 + hash2(seed, p.id, k + 7919) * 19;
        const budLen = 6 + Math.floor(hash2(seed, p.id, k + 104729) * 5);
        next.push({ x: t.x, y: t.y, ang: t.ang + side * deg * Math.PI / 180, life: budLen, bud: true });
      }
      const nx = Math.round(t.x + Math.cos(t.ang));
      const ny = Math.round(t.y + Math.sin(t.ang));
      let grew = false;
      if (t.life > 0 && putWoodCell(mw, p, nx, ny)) { t.x = nx; t.y = ny; t.life--; grew = true; }
      if (grew && t.life === 0) putLeafCluster(mw, p, nx, ny);
      else if (grew) next.push(t);
    }
    p.tips = next;
  }
  p.growth = clamp01(p.iterDone / p.iters);
}

// --- the plant slow tick ---------------------------------------------------

export function tickPlants(mw) {
  if (!mw.plants) return;
  const g = mw.grid;
  for (let i = mw.plants.length - 1; i >= 0; i--) {
    const p = mw.plants[i];
    p.age++;
    const ph = p.pheno || (p.pheno = plantPhenotype(p.genome || randomPlantGenomeFallback()));
    const px = p.seedX * CELL_PX;
    const T = tempAt(mw, px);
    const moist = moistureAt(mw, px);
    const tempC = -10 + 45 * T;

    // Growing plants advance the L-system.
    if (p.growth < 1 && p.tips) {
      const steps = 1 + Math.round(3 * (ph.growthRate || 0.5));
      advancePlant(mw, p, steps);
      if (p.growth >= 1) {
        p.tips = null;
        // Maturity: fruiting if the climate suits (same gate as worldgen).
        const score = T * moist;
        if (score > 0.35) {
          p.fruiting = true;
          p.fruit = 1 + Math.round(2 * (ph.yield || 0.5));
        }
      }
    }

    // Stress: drought and cold accumulate; relief discharges.
    let stressing = false;
    if (moist < 0.12) { p.stress += 1; stressing = true; }
    if (tempC < -6 + (ph.coldTol || 0.5) * 16) { p.stress += 1; stressing = true; }
    if (tempC > 22 + (ph.heatTol || 0.5) * 13) { p.stress += 1; stressing = true; }
    if (!stressing && p.stress > 0) p.stress = Math.max(0, p.stress - 2);

    // Fire check: any burning cell of this plant.
    let burning = false;
    if (p.cells) {
      for (const ci of p.cells) {
        if (g.heat[ci] > 0.7) { burning = true; break; }
      }
    }

    // Death: stress overload, old age, fire, or the ground dug out from
    // under a young plant. (The support cell: worldgen plants root IN
    // their seed cell; seedlings rest in the air cell ABOVE soil.)
    const maxAge = 1200 + (ph.growthRate || 0.5) * 800; // plant-ticks; ~40-80 days
    const seedCellSolid = g.mat[p.seedY * g.cols + p.seedX] !== MAT.AIR;
    const gy = seedCellSolid ? p.seedY : Math.min(g.rows - 1, p.seedY + 1);
    const groundGone = g.mat[gy * g.cols + p.seedX] === MAT.AIR && p.growth < 1;
    if (p.stress > 40 || p.age > maxAge || burning || groundGone) {
      killPlant(mw, p, burning ? 'fire' : p.stress > 40 ? 'stress' : 'age');
      mw.plants.splice(i, 1);
    }
  }
}

function randomPlantGenomeFallback() {
  // Should never happen (genomes attach at worldgen/birth) — a neutral
  // genome keeps the tick honest if one slips through.
  return { alleles: {} };
}

// Death is material: wood becomes deadwood (rots via tickRot), leaves fall.
export function killPlant(mw, p, cause) {
  const g = mw.grid;
  if (p.cells) {
    for (const ci of p.cells) {
      if (g.mat[ci] === MAT.WOOD) { g.mat[ci] = MAT.DEADWOOD; g.root[ci] = 0; }
      else if (g.mat[ci] === MAT.LEAF) { g.mat[ci] = MAT.AIR; g.root[ci] = 0; g.grownId[ci] = 0; }
    }
  } else {
    // Worldgen plant: bulk cleanup by grownId.
    const gid = p.id % 65536;
    for (let ci = 0; ci < g.mat.length; ci++) {
      if (g.grownId[ci] === gid) {
        if (g.mat[ci] === MAT.WOOD) { g.mat[ci] = MAT.DEADWOOD; g.root[ci] = 0; }
        else if (g.mat[ci] === MAT.LEAF) { g.mat[ci] = MAT.AIR; g.root[ci] = 0; g.grownId[ci] = 0; }
      }
    }
  }
  p.dead = cause;
}
