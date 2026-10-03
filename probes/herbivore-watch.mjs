// Watch one herbivore: seek -> approach -> EAT -> bloodSugar rises.
// Run: node probes/herbivore-watch.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { ACTIONS } from '../src/material/brain.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);
// pick a grub, starve it, place at grove edge
const grub = mw.m2creatures.find((c) => c.species === 'grub');
grub.chem.bloodSugar = 0.05;
console.log('watching grub id', grub.id, 'start bs=0.05');

let ate = 0;
for (let t = 0; t < 1000; t++) {
  const before = grub.chem.bloodSugar;
  tickMaterialWorldM2(mw, {});
  const a = ACTIONS[grub.lastAction];
  if (grub.lastAction === 1) ate++;
  if (grub.chem.bloodSugar > before + 0.05) {
    console.log(`t=${t} ATE! bs ${before.toFixed(2)} -> ${grub.chem.bloodSugar.toFixed(2)}`);
  }
  if (t % 200 === 0) {
    console.log(`t=${t} ${a} bs=${grub.chem.bloodSugar.toFixed(2)} foodD=${grub._foodTarget ? grub._foodTarget.d.toFixed(0) : 'none'}`);
  }
  if (!grub.alive) { console.log('died at t=' + t); break; }
}
console.log('total EATs:', ate, 'final bs:', grub.chem.bloodSugar.toFixed(3));
