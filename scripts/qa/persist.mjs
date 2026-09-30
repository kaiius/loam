// Multi-seed persistence QA: does the population survive, stay bounded,
// and produce multiple generations? Run: node scripts/qa/persist.mjs [seeds...]
import { createWorld, bindWorld, populate, tickWorld } from '../../src/sim/world.js';

const seeds = process.argv.slice(2).map(Number);
const SEEDS = seeds.length ? seeds : [11, 22, 33, 44, 55];
const TICKS = 144000; // 4 sim-hours at 10 ticks/sec

for (const seed of SEEDS) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  let matings = 0, hatches = 0, extinctAt = null, maxPop = 0;
  const deaths = {};
  for (let t = 0; t < TICKS; t++) {
    tickWorld(world, 0.1);
    for (const e of world.events.splice(0)) {
      if (e.type === 'mating') matings++;
      if (e.type === 'hatch') hatches++;
      if (e.type === 'death') deaths[e.cause] = (deaths[e.cause] || 0) + 1;
    }
    maxPop = Math.max(maxPop, world.creatures.filter((c) => c.alive).length);
    if (!world.creatures.some((c) => c.alive)) { extinctAt = world.time; break; }
  }
  const alive = world.creatures.filter((c) => c.alive).length;
  console.log(
    `seed ${seed}: ${extinctAt ? 'EXTINCT@' + extinctAt.toFixed(0) + 's' : 'ALIVE pop=' + alive}` +
    ` matings=${matings} hatches=${hatches} maxPop=${maxPop} deaths=${JSON.stringify(deaths)}`
  );
}
