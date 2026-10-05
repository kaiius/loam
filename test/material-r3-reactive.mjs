// Loam R3 — the reactive-not-Decorative gate, as unit tests (REACTIVE_GATE.md).
// G1..G4: scalar-delta → state-transition thresholds, each forced through
// real dynamics (diffusion, rot, fire, germination, corpse decay), never
// hand-set steady states. Wiring tests are not proof (AGENTS.md lesson).
// Run: node --test test/material-r3-reactive.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAT, createGrid, groundIndexBelow } from '../src/material/grid.js';
import { tickDiffuse, tickFire, tickRot, NUTRIENT_SPROUT_MIN } from '../src/material/process.js';
import { spawnCorpse, tickCorpses } from '../src/material/corpses.js';
import { nutrientOkForSprout } from '../src/material/plants.js';

function miniWorld(cols = 21, rows = 21) {
  const grid = createGrid(cols, rows);
  return { grid, tick: 0, corpses: [], seed: 7 };
}

// --- G1: moisture → rot state -------------------------------------------
// Δmoist ≥ 0.30 within ≤ 1200 material ticks flips a DEADWOOD cell from
// rot-ineligible to rot-eligible (rot counter 0 → >0). Driven by diffusion
// from a pinned wet source — the real scalar path, not a hand-set field.

test('G1: Δmoist ≥ 0.30 flips deadwood rot eligibility within 1200 ticks', () => {
  const mw = miniWorld();
  const g = mw.grid;
  const cx = 10, cy = 10;
  const di = cy * 21 + cx;
  g.mat[di] = MAT.DEADWOOD;
  g.moist[di] = 0;
  // A wet source ring: pinned at moist=1 every tick (a rain-fed cell).
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
      const i = (cy + dy) * 21 + (cx + dx);
      g.mat[i] = MAT.SOIL;
      g.moist[i] = 1;
    }
  }
  assert.ok(!mw.rot || mw.rot[di] === 0, 'rot counter starts at 0');
  let flipped = -1;
  for (let t = 0; t < 1200; t++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
        g.moist[(cy + dy) * 21 + (cx + dx)] = 1; // re-pin the rain-fed source
      }
    }
    tickDiffuse(mw);
    mw.tick++;
    // rot eligibility is moist > 0.3 — check via the tickRot aux path
    if (g.moist[di] > 0.3) { flipped = t; break; }
  }
  assert.ok(flipped >= 0, 'moist crossed the 0.30 rot gate within 1200 ticks');
  assert.ok(g.moist[di] - 0 >= 0.30, `Δmoist ≥ 0.30 (got ${g.moist[di].toFixed(3)})`);
  // And the real rot process must now accumulate on that cell.
  tickRot(mw);
  assert.ok(mw.rot[di] > 0, 'rot counter accumulates — the cell flipped to rot-eligible');
});

// --- G2: moisture → ignition state --------------------------------------
// A fixed 0.9 heat pulse (a lightning strike) on a flammable cell must
// IGNITE at moist ≤ 0.0 and must NOT ignite at moist ≥ 0.85. Boundary 0.80.

test('G2: 0.9 heat pulse ignites dry fuel, fizzles on soaked fuel', () => {
  for (const [moist, expectIgnite] of [[0.0, true], [0.85, false]]) {
    const mw = miniWorld(7, 7);
    const g = mw.grid;
    // flammable bed: WOOD center, WOOD neighbour to catch the spread
    const ci = 3 * 7 + 3, ni = 3 * 7 + 4;
    g.mat[ci] = MAT.WOOD; g.mat[ni] = MAT.WOOD;
    g.moist[ci] = moist; g.moist[ni] = moist;
    g.heat[ci] = 0.9; // the lightning strike
    const nHeat0 = g.heat[ni];
    tickFire(mw, true);
    const spread = g.heat[ni] - nHeat0;
    if (expectIgnite) {
      assert.ok(spread > 0.01, `dry fuel (moist=${moist}) must spread fire (spread=${spread.toFixed(3)})`);
    } else {
      assert.ok(spread <= 0.01, `soaked fuel (moist=${moist}) must NOT spread fire (spread=${spread.toFixed(3)})`);
    }
  }
});

// --- G3: nutrient → germination state ------------------------------------
// Ground nutrient ≥ 0.10: sprout OK; ≤ 0.06: blocked. Boundary 0.08.

test('G3: germination gate flips across NUTRIENT_SPROUT_MIN = 0.08', () => {
  const mw = miniWorld();
  const g = mw.grid;
  const cx = 10, cy = 10;
  g.mat[(cy + 1) * 21 + cx] = MAT.SOIL; // the ground cell below
  g.nutrient[(cy + 1) * 21 + cx] = 0.10;
  assert.ok(nutrientOkForSprout(mw, cx, cy), 'nutrient 0.10 ≥ 0.08: sprout allowed');
  g.nutrient[(cy + 1) * 21 + cx] = 0.06;
  assert.ok(!nutrientOkForSprout(mw, cx, cy), 'nutrient 0.06 < 0.08: sprout blocked');
  assert.equal(NUTRIENT_SPROUT_MIN, 0.08, 'the boundary is the spec number');
});

// --- G4: nutrient → billed yield ----------------------------------------
// One corpse (meat = 1.0) must raise its ground cell's nutrient by ≥ 0.70
// within 2500 material ticks (50 slow ticks). Δnut ≥ 0.70 moves geophagy
// yield by ≥ 0.28 of the 0.40 possible. Calibrated: measured 0.780.

test('G4: one corpse enriches its ground cell by ≥ 0.70 within 2500 ticks', () => {
  const mw = miniWorld();
  const g = mw.grid;
  for (let x = 0; x < 21; x++) g.mat[15 * 21 + x] = MAT.SOIL;
  const k = spawnCorpse(mw, { x: 105, y: 140, bodyMass: 3 });
  k.meat = 1.0;
  const gi = groundIndexBelow(g, 10, 14);
  assert.ok(gi >= 0, 'corpse has a ground cell below');
  const nut0 = g.nutrient[gi];
  for (let s = 0; s < 50; s++) {
    tickCorpses(mw);
    for (let t = 0; t < 50; t++) { tickDiffuse(mw); mw.tick++; }
  }
  const delta = g.nutrient[gi] - nut0;
  assert.ok(delta >= 0.70, `Δnut ≥ 0.70 (got ${delta.toFixed(3)}) — geophagy yield moves ≥ 0.28`);
});

// --- diffusion sanity ----------------------------------------------------

test('diffusion is deterministic and seed-pinned (same seed, same field)', () => {
  const run = () => {
    const mw = miniWorld();
    const g = mw.grid;
    for (let x = 0; x < 21; x++) {
      g.mat[10 * 21 + x] = MAT.SOIL;
      g.moist[10 * 21 + x] = (x * 7919) % 100 / 100;
      g.nutrient[10 * 21 + x] = (x * 104729) % 200 / 100;
    }
    for (let t = 0; t < 200; t++) { tickDiffuse(mw); mw.tick++; }
    return Array.from(g.moist.slice(10 * 21, 11 * 21)).map((v) => v.toFixed(6)).join(',');
  };
  assert.equal(run(), run(), 'diffusion must be bit-identical across runs');
});

test('diffusion conserves the field (no creation/destruction of moisture)', () => {
  const mw = miniWorld();
  const g = mw.grid;
  for (let x = 2; x < 19; x++) {
    g.mat[10 * 21 + x] = MAT.SOIL;
    g.moist[10 * 21 + x] = 0.5;
  }
  let sum0 = 0;
  for (let i = 0; i < 21 * 21; i++) sum0 += g.moist[i];
  for (let t = 0; t < 100; t++) { tickDiffuse(mw); mw.tick++; }
  let sum1 = 0;
  for (let i = 0; i < 21 * 21; i++) sum1 += g.moist[i];
  assert.ok(Math.abs(sum1 - sum0) < 1e-6, `moisture conserved (Δ=${Math.abs(sum1 - sum0).toExponential(2)})`);
});
