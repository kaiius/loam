// Trace one grub's actions for 500 ticks next to a fruiting plant.
// Run: node probes/grub-trace.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { ACTIONS } from '../src/material/brain.js';
import { CELL_PX } from '../src/material/grid.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);
const fp = mw.plants.find((p) => p.fruiting);
const grub = mw.m2creatures.find((c) => c.species === 'grub' && c.alive);
grub.x = fp.seedX * CELL_PX + 30;
grub.y = fp.seedY * CELL_PX;
grub.chem.bloodSugar = 0.05;

const counts = {};
let ateTicks = 0;
for (let t = 0; t < 500; t++) {
  const before = grub.chem.bloodSugar;
  tickMaterialWorldM2(mw, {});
  const a = ACTIONS[grub.lastAction];
  counts[a] = (counts[a] || 0) + 1;
  if (grub.chem.bloodSugar > before + 0.01) ateTicks++;
  if (t % 100 === 0) console.log(`t=${t} action=${a} bs=${grub.chem.bloodSugar.toFixed(2)} x=${grub.x.toFixed(0)} foodD=${grub._foodTarget ? grub._foodTarget.d.toFixed(0) : 'none'}`);
}
console.log('action counts:', JSON.stringify(counts));
console.log('ticks where bloodSugar rose:', ateTicks);
console.log('final bs:', grub.chem.bloodSugar.toFixed(3), 'plant fruit:', fp.fruit);
