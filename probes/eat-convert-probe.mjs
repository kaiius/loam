// Why don't in-reach EATs convert? Place a grub at a fruiting plant's base.
// Run: node probes/eat-convert-probe.mjs
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { executeAction } from '../src/material/actions.js';
import { CELL_PX } from '../src/material/grid.js';

const mw = createMaterialWorld(7, 1);
const rng = createRng(7);
seedEcology(mw, rng);

const fp = mw.plants.find((p) => p.fruiting);
console.log('fruiting plant:', !!fp, 'fruit:', fp && fp.fruit, 'seedX/Y:', fp && fp.seedX, fp && fp.seedY);
const grub = mw.m2creatures.find((c) => c.species === 'grub' && c.alive);
// stand the grub at the plant base
grub.x = fp.seedX * CELL_PX + 30;
grub.y = fp.seedY * CELL_PX;
grub.chem.bloodSugar = 0.05;
const ctx = { others: mw.m2creatures, bonds: mw.bonds };
const s = gatherMaterialSenses(mw, grub, ctx);
console.log('_foodTarget:', grub._foodTarget && { kind: grub._foodTarget.kind, d: grub._foodTarget.d.toFixed(0) });
console.log('foodDist sense:', s.foodDist.toFixed(3));
const fruit0 = fp.fruit;
const ret = executeAction(mw, grub, 1 /* eat */, s, ctx);
console.log('executeAction returned chemCtx.ate =', ret.ate);
console.log('fruit before/after:', fruit0, fp.fruit);
console.log('grub bloodSugar:', grub.chem.bloodSugar.toFixed(3));

// now let it live: 500 ticks, watch bloodSugar
for (let t = 0; t < 500; t++) tickMaterialWorldM2(mw, {});
console.log('after 500 ticks: bloodSugar =', grub.chem.bloodSugar.toFixed(3), 'alive =', grub.alive, 'plant fruit =', fp.fruit);
