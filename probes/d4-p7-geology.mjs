// D4 P7 — Geology visibility: 100k-tick run.
// - ROCK→SOIL weathering conversions: >0 and <5% of subsoil cells
// - vein cells at worldgen: >0 per world
// - at least one dug vein cell yields a mineral-tagged carry (scripted)
// - soil depth per column (surface-to-first-ROCK) non-decreasing vs tick 0
// Run: node probes/d4-p7-geology.mjs [seed]
import { runSampled } from './d4-helper.mjs';
import { MAT, CELL_PX, createGrid } from '../src/material/grid.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { createRng } from '../src/sim/rng.js';
import { spawnSpecies } from '../src/material/species.js';
import { executeAction } from '../src/material/actions.js';
import { gatherMaterialSenses } from '../src/material/senses.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = 100000;
const EVERY = 20000;

// Geology is substrate-side: the long run needs no creatures (their brains
// dominate the tick cost). Zero creatures is fastest and the weathering
// pass doesn't read them.
const mw = createMaterialWorld(seed, 1, {});
const g = mw.grid;

// Veins at worldgen.
let veins0 = 0;
for (let i = 0; i < g.vein.length; i++) if (g.vein[i] > 0) veins0++;
console.log(`veins at worldgen: ${veins0}`);

// Soil depth per column at tick 0 (surface row → first ROCK row).
function soilDepth(w) {
  const gg = w.grid, out = [];
  for (let c = 0; c < gg.cols; c++) {
    let d = 0;
    for (let r = 0; r < gg.rows; r++) {
      const m = gg.mat[r * gg.cols + c];
      if (m === MAT.ROCK || m === MAT.BEDROCK) break;
      if (m === MAT.SOIL || m === MAT.SAND || m === MAT.CLAY) d++;
    }
    out.push(d);
  }
  return out;
}
const depth0 = soilDepth(mw);
let soil0 = 0, rock0 = 0;
for (let i = 0; i < g.mat.length; i++) {
  if (g.mat[i] === MAT.SOIL) soil0++;
  if (g.mat[i] === MAT.ROCK) rock0++;
}

runSampled(mw, TICKS, EVERY, (w, t) => {
  let soil = 0;
  for (let i = 0; i < w.grid.mat.length; i++) if (w.grid.mat[i] === MAT.SOIL) soil++;
  console.log(`  tick ${t}: SOIL cells=${soil}`);
  return null;
});

let soil1 = 0;
for (let i = 0; i < g.mat.length; i++) if (g.mat[i] === MAT.SOIL) soil1++;
const conversions = soil1 - soil0;
const subsoil = rock0 + soil0;
console.log(`weathering conversions (SOIL Δ): ${conversions} (${(100 * conversions / Math.max(1, subsoil)).toFixed(2)}% of subsoil)`);

const depth1 = soilDepth(mw);
let decreased = 0;
for (let c = 0; c < depth0.length; c++) if (depth1[c] < depth0[c]) decreased++;
console.log(`columns with decreased soil depth: ${decreased}/${depth0.length}`);

// Scripted dig probe: force-dig a vein cell, check the mineral tag.
let dugMineral = null;
{
  const cols = 60, rows = 40;
  const grid2 = createGrid(cols, rows);
  for (let y = 20; y < rows; y++) for (let x = 0; x < cols; x++) grid2.mat[y * cols + x] = MAT.SOIL;
  const mw2 = { seed: 7, tick: 0, grid: grid2, cols, rows, plants: [], bonds: new Map(), surf: new Array(cols).fill(20) };
  const rng = createRng(99);
  const c = spawnSpecies(mw2, rng, 'scurrier', 300, 200);
  c.grounded = true; mw2.m2creatures = [c];
  const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
  const ti = ty * grid2.cols + tx;
  grid2.mat[ti] = MAT.ROCK; grid2.vein[ti] = 1;
  for (let i = 0; i < 30 && !c.carried; i++) executeAction(mw2, c, 19, gatherMaterialSenses(mw2, c, { others: [] }), {});
  dugMineral = c.carried && c.carried.mineral;
}
console.log(`scripted dig mineral tag: ${dugMineral}`);

const pass = conversions > 0 && conversions < 0.05 * subsoil && veins0 > 0 && decreased === 0 && dugMineral === 'flint';
console.log(pass ? 'P7 PASS — geology is visible on deep time'
  : `P7 FAIL — conversions=${conversions} veins=${veins0} decreased=${decreased} mineral=${dugMineral}`);
process.exit(pass ? 0 : 1);
