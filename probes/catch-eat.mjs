// Catch out-of-reach EAT decisions and dump the full motor state.
// Run: node probes/catch-eat.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { forward, senseVector, ACTIONS } from '../src/material/brain.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);

let caught = 0;
for (let t = 0; t < 3000 && caught < 3; t++) {
  tickMaterialWorldM2(mw, {});
  for (const c of mw.m2creatures) {
    if (!c.alive || c.lastAction !== 1) continue;
    const carried = c.carried && c.carried.edible;
    const d = carried ? 0 : c._foodTarget ? c._foodTarget.d : Infinity;
    if (d < 120 || d === 0) continue;
    // Out-of-reach EAT! Dump the decision state.
    caught++;
    console.log(`\n=== t=${t} ${c.species} EAT with target d=${d === Infinity ? 'Inf' : d.toFixed(0)} ===`);
    // Recompute senses and forward
    const ctx = { others: mw.m2creatures, bonds: mw.bonds };
    const s = gatherMaterialSenses(mw, c, ctx);
    console.log('senses: hunger', s.hunger.toFixed(2), 'foodDist', s.foodDist.toFixed(2),
      '_foodTarget.d', c._foodTarget ? c._foodTarget.d.toFixed(0) : 'null');
    const v = senseVector(s);
    const o = forward(c.brain, v);
    const ranked = o.map((x, j) => [ACTIONS[j], x]).sort((a, b) => b[1] - a[1]);
    console.log('top actions:');
    for (const [n, val] of ranked.slice(0, 6)) console.log('  ', n, val.toFixed(3));
    // Decompose EAT
    const brain = c.brain;
    const assoc = brain.lastAssoc, { idx, w } = brain.a2m;
    const cols = idx[1], ws = w[1];
    const norm = Math.sqrt(44 / Math.max(1, cols.length));
    let learned = 0;
    for (let n = 0; n < cols.length; n++) learned += ws[n] * assoc[cols[n]] * norm;
    let inst = 0;
    const iw = brain.instW[1], input = brain.lastInput;
    for (let k = 0; k < iw.length; k++) inst += iw[k] * input[k];
    console.log('EAT components: bias', brain.biasM[1].toFixed(2), 'learned', learned.toFixed(2),
      'instinct', inst.toFixed(2), 'total', o[1].toFixed(3));
    console.log('instW[1] nonzero:', iw.map((x, k) => Math.abs(x) > 0.01 ? k + ':' + x.toFixed(2) : null).filter(Boolean).join(' '));
    break;
  }
}
console.log('\ncaught:', caught);
