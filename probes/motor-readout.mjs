// Full motor readout for a starving grub next to food.
// Run: node probes/motor-readout.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { forward, senseVector, ACTIONS } from '../src/material/brain.js';
import { CELL_PX } from '../src/material/grid.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);
const fp = mw.plants.find((p) => p.fruiting);
const grub = mw.m2creatures.find((c) => c.species === 'grub' && c.alive);
grub.x = fp.seedX * CELL_PX + 30;
grub.y = fp.seedY * CELL_PX;
grub.chem.bloodSugar = 0.0;
grub.chem.oxytocin = 0.0; // max loneliness
const ctx = { others: mw.m2creatures, bonds: mw.bonds };
const s = gatherMaterialSenses(mw, grub, ctx);
console.log('senses: hunger', s.hunger.toFixed(2), 'loneliness', s.loneliness.toFixed(2),
  'boredom', s.boredom.toFixed(2), 'foodDist', s.foodDist.toFixed(2),
  'creatureDist', s.creatureDist.toFixed(2), 'curiosity', s.curiosity.toFixed(2));
// warmup attention
const v = senseVector(s);
for (let i = 0; i < 60; i++) forward(grub.brain, v);
const o = forward(grub.brain, senseVector(s));
const ranked = o.map((x, j) => [ACTIONS[j], x]).sort((a, b) => b[1] - a[1]);
console.log('top motor outputs:');
for (const [name, val] of ranked.slice(0, 8)) console.log('  ', name, val.toFixed(3));
console.log('pheno: sociability', grub.pheno.sociability?.toFixed(2), 'curiosity', grub.pheno.curiosity?.toFixed(2), 'boldness', grub.pheno.boldness?.toFixed(2));
