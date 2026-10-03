// Motor output probe v2: inject foodDist directly into the sense object.
// Run: node probes/eat-drive-probe.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld } from '../src/material/index.js';
import { spawnSpecies } from '../src/material/species.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { forward, senseVector } from '../src/material/brain.js';

const mw = createMaterialWorld(11, 1);
const rng = createRng(99);
const grub = spawnSpecies(mw, rng, 'grub', 600, 200);
mw.m2creatures.push(grub);
grub.chem.bloodSugar = 0.05; // starving
grub.exploration = 0;

const base = gatherMaterialSenses(mw, grub, { others: mw.m2creatures, bonds: [] });
for (const fd of [0.0, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0]) {
  const s = { ...base, foodDist: fd, hunger: 0.95 };
  const o = forward(grub.brain, senseVector(s));
  const eat = o[1], seek = o[0];
  console.log(`foodDist=${fd.toFixed(2)} (~${(fd*420).toFixed(0)}px) -> eat=${eat.toFixed(3)} seekFood=${seek.toFixed(3)} winner=${eat > seek ? 'EAT' : 'seekFood'}`);
}
console.log('instW[eat][hunger]=', grub.brain.instW[1][0].toFixed(3));
console.log('instW[seek][hunger]=', grub.brain.instW[0][0].toFixed(3), 'instW[seek][foodDist]=', grub.brain.instW[0][6].toFixed(3));
