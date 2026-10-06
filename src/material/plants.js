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

import { MAT, CELL_PX, groundIndexBelow } from './grid.js';
import { hash2, NUTRIENT_PER_FRUIT, NUTRIENT_SPROUT_MIN } from './process.js';
import { treeArchParams } from './worldgen.js';
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
    // Fruit count from the yield gene (worldgen set a flat 15).
    if (p.fruiting) p.fruit = 3 + Math.round(4 * p.pheno.yield) + 8;
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
  // D4: tannin — defended seeds survive the gut worse. The survival roll is
  // 0.35 × (1 − 0.3 × tannin_pheno), applied after the roll (the outcrossing
  // logic below is untouched). Founder tannin 0.2 → 0.329.
  const tannin = (plant.pheno && plant.pheno.tannin) ?? 0.2;
  const gutSurvival = 0.35 * (1 - 0.3 * Math.min(1, Math.max(0, tannin)));
  if (h > gutSurvival) return null; // most fruit is just eaten
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

// R3: the nutrient half of the germination gate, exported for the
// D4: the pioneer axis — high-colonizer seeds sprout on bare, poor,
// freshly-weathered ground (threshold → 0.02); low-colonizer seeds need
// enriched ground. Founder colonizer 0.5 → ×0.625 (0.05).
export function sproutThreshold(ph) {
  const col = (ph && ph.colonizer) ?? 0.5;
  const c = col < 0 ? 0 : col > 1 ? 1 : col;
  return NUTRIENT_SPROUT_MIN * (1 - 0.75 * c);
}

// reactive-gate tests (G3). True iff the ground cell below (cx, cy) holds
// enough nutrient to sprout. Optional threshold (D4: the pioneer's
// colonizer-adjusted gate); defaults to the founder threshold.
export function nutrientOkForSprout(mw, cx, cy, threshold = NUTRIENT_SPROUT_MIN) {
  const g = mw.grid;
  if (!g.nutrient) return true;
  const gi = (cy + 1) * g.cols + cx;
  if (gi < 0 || gi >= g.nutrient.length) return false;
  return g.nutrient[gi] >= threshold;
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
  // R3 (reactive biomes): nutrient fronts gate germination — a seed on
  // depleted ground (nutrient < threshold) does not sprout. Groves that
  // fruit hard eat their own soil and stop regenerating.
  // D4: the threshold is the pioneer's — high-colonizer seeds sprout on
  // poor ground where climax seeds can't.
  if (!nutrientOkForSprout(mw, cx, cy, sproutThreshold(ph))) return;
  // Sprout: a new plant, generation + 1, growing from seed.
  const pid = 100000 + s.id; // runtime ids live above worldgen's
  const iters = Math.round(24 + ph.growthRate * 40);
  // M4 tree architecture (same seeded per-tree parameters as worldgen's
  // growPlant — via the shared treeArchParams helper, so the rule sets
  // cannot drift apart).
  const seedH = mw.seed || 1;
  // R2 (SIM-C): runtime seedlings lean with the same wind system as
  // worldgen trees — the global wind at germination, via treeArchParams.
  const { lean, branchK } = treeArchParams(seedH, pid, mw.sky ? mw.sky.windU : 0);
  const p = {
    id: pid, seedX: cx, seedY: cy, iters,
    fruiting: false, fruit: 0,
    genome: s.genome, pheno: ph,
    growth: 0, age: 0, stress: 0,
    generation: (s.parentGen || 0) + 1,
    lean, branchK,
    tips: [{ x: cx, y: cy, ang: -Math.PI / 2 + lean, life: iters, ord: 0, curve: 0, side: 0, blen0: 0, forked: true }],
    iterDone: 0,
    cells: [],
    wood: 0, leaf: 0,
  };
  if (!mw.plants) mw.plants = [];
  mw.plants.push(p);
}

// --- runtime growth: the L-system resumes ---------------------------------
// Same M4 tree-architecture rules as worldgen's growPlant (stateless hash2
// branching), advanced a few iterations per plant-tick from the stored tip
// list. Per-tree lean/branchK are stored on the plant at germination so the
// rule stream matches worldgen's bit-for-bit for the same (seed, id).

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

// M4b: leaf sleeves (same rules as worldgen's putSleeve — the two MUST stay
// in sync). Branches and twigs carry foliage along their length.
function putSleeve(mw, p, t, k) {
  if (t.ord === 0) return;
  if ((t.blen0 - t.life) % 3 !== 0) return;
  const g = mw.grid;
  const seed = mw.seed || 1;
  const side = hash2(seed, p.id, k + 6111) < 0.5 ? -1 : 1;
  const ox = Math.round(-Math.sin(t.ang) * side), oy = Math.round(Math.cos(t.ang) * side);
  if (ox === 0 && oy === 0) return;
  const nx = Math.round(t.x) + ox, ny = Math.round(t.y) + oy;
  if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) return;
  const i = ny * g.cols + nx;
  if (g.mat[i] !== MAT.AIR) return;
  g.mat[i] = MAT.LEAF; g.root[i] = 1; g.grownId[i] = p.id % 65536;
  p.leaf++; p.cells.push(i);
}

export function advancePlant(mw, p, steps) {
  const seed = mw.seed || 1;
  const D2R = Math.PI / 180, UP = -Math.PI / 2;
  const lean = p.lean || 0, branchK = p.branchK || 5;
  for (let it = 0; it < steps && p.tips && p.tips.length; it++) {
    const k = p.iterDone++;
    const next = [];
    for (const t of p.tips) {
      if (t.ord === 0) {
        t.ang = UP + lean + (hash2(seed, p.id, k + 6103) - 0.5) * 10 * D2R;
        if (k > 0 && k % branchK === 0) {
          const side = hash2(seed, p.id, k + 6104) < 0.5 ? -1 : 1;
          const spread = (48 + hash2(seed, p.id, k + 6105) * 27) * D2R;
          const blen = 4 + Math.floor(hash2(seed, p.id, k + 6106) * 4);
          const curve = -side * (2.5 + hash2(seed, p.id, k + 6107) * 2) * D2R;
          next.push({
            x: t.x, y: t.y, ang: t.ang + side * spread, life: blen,
            ord: 1, curve, side, blen0: blen, forked: false,
          });
        }
      } else {
        t.ang += t.curve;
        if (t.ord === 1 && !t.forked && t.life <= Math.ceil(t.blen0 / 2)) {
          const tw = (15 + hash2(seed, p.id, k + 6108) * 25) * D2R;
          const tlen = 2 + Math.floor(hash2(seed, p.id, k + 6109) * 3);
          next.push({
            x: t.x, y: t.y, ang: t.ang - t.side * tw, life: tlen,
            ord: 2, curve: -t.side * 2 * D2R, side: t.side, blen0: tlen, forked: true,
          });
          t.forked = true;
        }
      }
      // R2 (SIM-C): fractional tip accumulation — the same rule as
      // worldgen's growPlant, so the wind lean shapes runtime seedlings
      // identically. Sub-cell drift accumulates instead of being rounded
      // away each step (a few degrees of lean never cross the 0.5 rounding
      // threshold on their own).
      const fx = t.x + Math.cos(t.ang);
      const fy = t.y + Math.sin(t.ang);
      const nx = Math.round(fx);
      const ny = Math.round(fy);
      let grew = false;
      if (t.life > 0 && putWoodCell(mw, p, nx, ny)) { t.x = fx; t.y = fy; t.life--; grew = true; putSleeve(mw, p, t, k); }
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
    // D4: foraging pressure — a plant whose crop was stripped to zero
    // twice in one plant-tick (actions.js tryEat counts _stripped) is
    // overgrazed: stress += 1. Overgrazed plants die younger; the plant
    // population feels the herbivores (bottom-up coupling, §2.3).
    if ((p._stripped || 0) >= 2) { p.stress += 1; stressing = true; }
    p._stripped = 0;
    if (!stressing && p.stress > 0) p.stress = Math.max(0, p.stress - 2);

    // Fire check: any burning cell of this plant.
    let burning = false;
    if (p.cells) {
      for (const ci of p.cells) {
        if (g.heat[ci] > 0.7) { burning = true; break; }
      }
    }

    // Fruit regrowth: the crop refills every plant-tick (50 material
    // ticks) while the plant is mature, fruiting, unstressed, and in a
    // suitable climate — the ecology's primary production. The refill
    // scales with the yield phenotype (high-yield varieties put on 5
    // fruit per refill, the rest 4) and the crop caps at the variety's
    // maximum, so production self-limits when uneaten. Not free food:
    // drought, cold, heat, and fire all shut it off, and the rate is a
    // property of the plant genome, selectable by grazers. (Carrying-
    // capacity fix, 2026-10-03: the old interval trickle — one fruit per
    // ~1500 material ticks — plus the index.js flat +1-to-5 hack produced
    // ~0.29 fruit/tick against ~1.0+ of behavioral demand (measured: the
    // brain holds bs ~0.43 on infinite fruit, eating ~2.8/tick). ~60
    // fruiting plants × ~4.5 fruit per 50 ticks ≈ 5/tick potential,
    // ~2.5/tick effective after the foraging distribution, carries the
    // 11-species roster to a healthy equilibrium.) Deterministic
    // (per-plant counters only).
    if (p.fruiting && p.growth >= 1 && !stressing && !burning) {
      const maxFruit = 3 + Math.round(4 * (ph.yield || 0.5)) + 8;
      if ((p.fruit || 0) < maxFruit) {
        const add = ((ph.yield || 0.5) > 0.6 ? 5 : 4);
        p.fruit = Math.min(maxFruit, (p.fruit || 0) + add);
        // R2 (SIM-B): fruit is built from the soil — the plant draws down
        // the nutrient stock of the ground cell below its seed cell.
        // (Soil fertility still gates fruiting on its own; nutrient is the
        // slow currency that rot replenishes.) Frozen control: no drawdown.
        if (g.nutrient && !mw.frozenBiome) {
          const ni = groundIndexBelow(g, p.seedX, p.seedY);
          if (ni >= 0) g.nutrient[ni] = Math.max(0, g.nutrient[ni] - NUTRIENT_PER_FRUIT * add);
        }
      }
    }

    // Death: stress overload, old age, fire, or the ground dug out from
    // under a young plant. (The support cell: worldgen plants root IN
    // their seed cell; seedlings rest in the air cell ABOVE soil.)
    // D4: the lifespan axis — pioneers live ~40% of baseline, climax ~2×.
    // Founder longevity 0.5 → ×1.2, inside the 1200–2000 band.
    const maxAge = (1200 + (ph.growthRate || 0.5) * 800) * (0.4 + 1.6 * ((ph.longevity ?? 0.5)));
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
