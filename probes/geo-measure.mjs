// Blood sugar by distance-to-grove, with the gate fix in place.
// Run: node probes/geo-measure.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { CELL_PX } from '../src/material/grid.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);
const fpts = mw.plants.filter((p) => p.fruiting).map((p) => [p.seedX * CELL_PX, p.seedY * CELL_PX]);
const distToGrove = (c) => Math.min(...fpts.map(([px, py]) => Math.hypot(px - c.x, py - 40 - c.y)));

for (let t = 0; t < 3000; t++) tickMaterialWorldM2(mw, {});
let near = { n: 0, bs: 0 }, far = { n: 0, bs: 0 };
for (const c of mw.m2creatures) {
  if (!c.alive) continue;
  const d = distToGrove(c);
  const b = d < 450 ? near : far;
  b.n++; b.bs += c.chem.bloodSugar;
}
console.log('near grove (<450px): n=' + near.n + ' avgBS=' + (near.bs / Math.max(1, near.n)).toFixed(3));
console.log('far from grove: n=' + far.n + ' avgBS=' + (far.bs / Math.max(1, far.n)).toFixed(3));
