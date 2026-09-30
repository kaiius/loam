// v0.11: measure trait divergence between biomes after a long run.
// Reports mean heritable traits per birth zone from the lineage registry.
import { createWorld, bindWorld, populate, tickWorld } from '../../src/sim/world.js';

const seeds = [7, 42, 77, 99];
const TRAITS = ['size', 'legLength', 'spikes', 'fur', 'eyeSize', 'immunity', 'learningRate', 'boldness'];

for (const seed of seeds) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  for (let i = 0; i < 144000; i++) tickWorld(world, 0.1); // 4 sim-hours
  const byZone = {};
  for (const rec of world.lineage.values()) {
    if (rec.generation < 3) continue; // only established lineages
    const z = rec.zone || 'unknown';
    byZone[z] = byZone[z] || { n: 0, sums: {} };
    byZone[z].n++;
    for (const t of TRAITS) byZone[z].sums[t] = (byZone[z].sums[t] || 0) + rec.traits[t];
  }
  console.log(`seed ${seed}: pop=${world.creatures.length}`);
  for (const [z, d] of Object.entries(byZone)) {
    const means = TRAITS.map((t) => `${t}=${(d.sums[t] / d.n).toFixed(2)}`).join(' ');
    console.log(`  ${z} (n=${d.n}): ${means}`);
  }
}
