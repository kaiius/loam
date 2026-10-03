// Starvation measurement probe — reproduces the adversarial review numbers.
// Run: node probes/starvation-measure.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);

let eatSelections = 0, eatInReach = 0, distSum = 0, distN = 0, distMax = 0, fruitEaten = 0;
let bsSum = 0, bsN = 0;
const distSamples = [];

// wrap: count fruit via plant fruit deltas
let fruit0 = mw.plants.reduce((a, p) => a + (p.fruit || 0), 0);

const TICKS = 3000;
for (let t = 0; t < TICKS; t++) {
  tickMaterialWorldM2(mw, {});
  for (const c of mw.m2creatures) {
    if (!c.alive) continue;
    if (c.lastAction === 1) {
      eatSelections++;
      // In-reach: kind-aware (fruit/buried 120px, corpse 70px, carried always).
      const carried = c.carried && c.carried.edible;
      const d = carried ? 0 : c._foodTarget ? c._foodTarget.d : Infinity;
      const kind = c._foodTarget ? c._foodTarget.kind : null;
      const reach = kind === 'corpse' ? 70 : 120;
      if (Number.isFinite(d)) { distSum += d; distN++; }
      distMax = Math.max(distMax, d);
      if (d < reach) eatInReach++;
      if (eatSelections % 500 === 0) distSamples.push(d === Infinity ? 'Inf' : d.toFixed(0));
    }
    bsSum += c.chem.bloodSugar; bsN++;
  }
}
const fruit1 = mw.plants.reduce((a, p) => a + (p.fruit || 0), 0);
console.log('ticks:', TICKS, 'creatures:', mw.m2creatures.filter(c=>c.alive).length + '/' + mw.m2creatures.length);
console.log('EAT selections:', eatSelections);
console.log('in-reach rate (d<120):', eatSelections ? (100*eatInReach/eatSelections).toFixed(1)+'%' : 'n/a');
console.log('mean target dist at EAT:', distN ? (distSum/distN).toFixed(0)+'px' : 'n/a', 'max:', distMax === Infinity ? 'Inf' : distMax.toFixed(0));
console.log('dist samples:', distSamples.join(','));
console.log('fruit eaten (plant deltas):', fruit0 - fruit1, '(start', fruit0, 'end', fruit1, ')');
console.log('avg bloodSugar:', (bsSum/bsN).toFixed(3));
// per-species blood sugar
const bySp = {};
for (const c of mw.m2creatures) {
  const sp = c.species || c.pheno?.speciesTag || '?';
  bySp[sp] = bySp[sp] || { n: 0, bs: 0 };
  bySp[sp].n++; bySp[sp].bs += c.chem.bloodSugar;
}
for (const [sp, v] of Object.entries(bySp)) console.log('  ', sp, 'n='+v.n, 'avgBS='+(v.bs/v.n).toFixed(3));
