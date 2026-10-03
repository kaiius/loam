// Trace the strongest-wired scurrier for 800 ticks.
// Run: node probes/scurrier-trace.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { ACTIONS } from '../src/material/brain.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);
const sc = mw.m2creatures.filter((c) => c.species === 'scurrier' && c.alive)
  .sort((a, b) => b.pheno.instHungerEat - a.pheno.instHungerEat)[0];
console.log('scurrier wire:', sc.pheno.instHungerEat.toFixed(2), 'start bs:', sc.chem.bloodSugar.toFixed(2));

const counts = {};
let rose = 0;
for (let t = 0; t < 800; t++) {
  const before = sc.chem.bloodSugar;
  tickMaterialWorldM2(mw, {});
  const a = ACTIONS[sc.lastAction];
  counts[a] = (counts[a] || 0) + 1;
  if (sc.chem.bloodSugar > before + 0.01) rose++;
  if (t % 200 === 0) console.log(`t=${t} ${a} bs=${sc.chem.bloodSugar.toFixed(2)} foodD=${sc._foodTarget ? sc._foodTarget.d.toFixed(0) : 'none'}`);
}
console.log('actions:', JSON.stringify(counts));
console.log('ate ticks:', rose, 'final bs:', sc.chem.bloodSugar.toFixed(3), 'alive:', sc.alive);
