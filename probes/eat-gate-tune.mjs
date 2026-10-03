// Gene founder tuning v3: warm up attention (50 calls) before measuring.
// Run: node probes/eat-gate-tune.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld } from '../src/material/index.js';
import { spawnSpecies } from '../src/material/species.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { forward, senseVector } from '../src/material/brain.js';

const mw = createMaterialWorld(11, 1);
const rng = createRng(99);
const grub = spawnSpecies(mw, rng, 'grub', 600, 200);
mw.m2creatures.push(grub);
grub.exploration = 0;
const base = gatherMaterialSenses(mw, grub, { others: mw.m2creatures, bonds: [] });

for (const founder of [0.0, 0.1, 0.2]) {
  const w = (founder - 0.5) * 2.4;
  grub.brain.instW[1][6] = w;
  // warmup: 60 identical calls to settle the attention EMA
  const warm = senseVector({ ...base, foodDist: 0.3, hunger: 0.95 });
  for (let i = 0; i < 60; i++) forward(grub.brain, warm);
  let line = `founder ${founder} (w=${w.toFixed(2)}):`;
  for (const fd of [0.0, 0.14, 0.29, 0.4, 0.6, 1.0]) {
    const s = { ...base, foodDist: fd, hunger: 0.95 };
    const o = forward(grub.brain, senseVector(s));
    line += ` fd=${fd.toFixed(2)}:${o[1] > o[0] ? 'EAT ' : 'seek'}(${o[1].toFixed(2)}/${o[0].toFixed(2)})`;
  }
  console.log(line);
}
console.log('reach marker: 120px / sightRange 370 = foodDist 0.32');
