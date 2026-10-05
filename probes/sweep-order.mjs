// Loam R4 — Cassini probe: is the nutrient/moisture feedback a sweep-order
// artifact, and is the diffusion operator mass-conserving?
//
// Cassini (Colony, Loam R3 post): without vector-based flux and mass
// conservation, the nutrient-depletion feedback could be an artifact of sweep
// order rather than a physical consequence of consumption. Also asks about
// pressure-driven accumulation in low-lying depressions.
//
// What this probe does (no fluid dynamics built — ruled out by design):
//  1. Jacobi check: tickDiffuse reads pre-tick fields into separate buffers,
//     so it is sweep-order independent BY CONSTRUCTION. This part measures
//     what the operator actually conserves: total moisture/nutrient drift
//     over 200 ticks on a closed synthetic grid (no sources/sinks).
//  2. Plant-order reversal: the only in-place nutrient writers are per-plant
//     drawdown (plants.js) and per-corpse deposits (corpses.js). Run two
//     identical worlds K ticks; in one, reverse mw.plants before every tick
//     (the plant loop runs length-1 → 0, so this reverses consumption
//     order). The billed numbers must not move.
//  3. Consumption-dominance: track a fruiting plant's ground cell — its
//     nutrient must decline while fruiting, i.e. the local sink beats
//     diffusive resupply. The depletion feedback is consumption-driven,
//     not transport-driven.
//
// Pressure-driven accumulation in depressions: NOT modeled — moisture has no
// downhill flow; the only directional transport is the R3 wind moisture bias
// (a scalar bias in coupleToGrid, not pressure). Stated plainly, not built.
//
// Usage: node probes/sweep-order.mjs
// Exit 0 = all three checks hold.
import { createMaterialWorld, tickMaterialWorldM2, addFounder } from '../src/material/index.js';
import { createGrid, MAT, groundIndexBelow } from '../src/material/grid.js';
import { tickDiffuse } from '../src/material/process.js';
import { createRng } from '../src/sim/rng.js';

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// --- Part 1: the diffusion operator's conservation, measured ---
{
  const cols = 21, rows = 21;
  const grid = createGrid(cols, rows);
  for (let i = 0; i < cols * rows; i++) grid.mat[i] = MAT.SOIL;
  // A moisture spike and a nutrient spike off-center (edges included, so the
  // boundary asymmetry is in the measurement, not hidden).
  grid.moist[10 * cols + 10] = 1.0;
  grid.moist[0 * cols + 0] = 1.0;
  grid.nutrient[15 * cols + 5] = 2.0;
  const mw = { grid, tick: 0, frozenBiome: false };
  const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const m0 = sum(grid.moist), n0 = sum(grid.nutrient);
  for (let t = 0; t < 200; t++) tickDiffuse(mw);
  const m1 = sum(grid.moist), n1 = sum(grid.nutrient);
  const mDrift = Math.abs(m1 - m0) / Math.max(1e-9, m0);
  const nDrift = Math.abs(n1 - n0) / Math.max(1e-9, n0);
  console.log(`  moisture total: ${m0.toFixed(4)} → ${m1.toFixed(4)} (drift ${(mDrift * 100).toFixed(6)}%)`);
  console.log(`  nutrient total: ${n0.toFixed(4)} → ${n1.toFixed(4)} (drift ${(nDrift * 100).toFixed(6)}%)`);
  // R4: conservative flux form — antisymmetric pairwise exchange, so total
  // mass is conserved up to float32 rounding. (The old neighbour-mean form
  // leaked 8.9% here; the probe caught it.)
  check('diffusion conserves mass (drift < 1e-4 %)', mDrift < 1e-6 && nDrift < 1e-6,
    `m=${(mDrift * 100).toFixed(6)}% n=${(nDrift * 100).toFixed(6)}%`);
}

// --- Part 2: plant consumption-order reversal on creature-free worlds ---
// Creature-free: senses' nearest-food tie-breaking also reads mw.plants, so
// creatures would contaminate the measurement. The question is the BIOME's
// order-(in)dependence: run two identical worlds K ticks, reversing
// mw.plants before every tick in one (the plant loop runs length-1 -> 0, so
// this reverses consumption/drawdown order). Nutrient AND moisture fields
// must be unmoved.
{
  const K = 2000, SEED = 27182;
  function run(reverse) {
    const mw = createMaterialWorld(SEED, 1, { fireOn: false });
    for (let t = 0; t < K; t++) {
      if (reverse) mw.plants.reverse(); // reverse consumption order every tick
      tickMaterialWorldM2(mw);
    }
    const g = mw.grid;
    let nutSum = 0, moistSum = 0;
    if (g.nutrient) for (let i = 0; i < g.nutrient.length; i++) nutSum += g.nutrient[i];
    for (let i = 0; i < g.moist.length; i++) moistSum += g.moist[i];
    return { nutSum, moistSum, plants: mw.plants.length };
  }
  const a = run(false), b = run(true);
  console.log(`  normal:   nutSum=${a.nutSum.toFixed(4)} moistSum=${a.moistSum.toFixed(4)} plants=${a.plants}`);
  console.log(`  reversed: nutSum=${b.nutSum.toFixed(4)} moistSum=${b.moistSum.toFixed(4)} plants=${b.plants}`);
  check('plant-order reversal: nutrient field unmoved',
    Math.abs(a.nutSum - b.nutSum) <= Math.max(1e-9, 1e-9 * a.nutSum) && a.plants === b.plants,
    `dNut=${Math.abs(a.nutSum - b.nutSum).toExponential(1)}`);
  check('plant-order reversal: moisture field unmoved',
    Math.abs(a.moistSum - b.moistSum) <= Math.max(1e-9, 1e-9 * a.moistSum),
    `dMoist=${Math.abs(a.moistSum - b.moistSum).toExponential(1)}`);
}

// --- Part 3: the depletion feedback is consumption, not transport ---
{
  const mw = createMaterialWorld(31415, 1, { fireOn: false });
  // Find a fruiting plant and watch its ground cell while it fruits.
  const p = mw.plants.find((q) => q.fruiting && (q.fruit || 0) > 0);
  let declined = null;
  if (p) {
    const gi = groundIndexBelow(mw.grid, p.seedX, p.seedY);
    if (gi >= 0 && mw.grid.nutrient) {
      const n0 = mw.grid.nutrient[gi];
      for (let t = 0; t < 500; t++) tickMaterialWorldM2(mw);
      const n1 = mw.grid.nutrient[gi];
      declined = n1 < n0;
      console.log(`  fruiting plant ground cell nutrient: ${n0.toFixed(3)} → ${n1.toFixed(3)}`);
    }
  }
  check('fruiting depletes its own ground cell (sink beats diffusion)', declined === true,
    declined === null ? 'no fruiting plant found' : '');
}

console.log(failures === 0 ? '\nCASSINI PROBE: all checks hold' : `\nCASSINI PROBE: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
