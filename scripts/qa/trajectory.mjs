// Quick population trajectory probe. Run: node scripts/qa/trajectory.mjs <seed> [minutes]
import { createWorld, bindWorld, populate, tickWorld } from '../../src/sim/world.js';

const seed = Number(process.argv[2] || 22);
const minutes = Number(process.argv[3] || 60);
const world = bindWorld(createWorld(seed));
populate(world);
for (let m = 0; m < minutes; m++) {
  for (let t = 0; t < 600; t++) tickWorld(world, 0.1);
  const alive = world.creatures.filter((c) => c.alive).length;
  console.log(`t=${m + 1}min pop=${alive} food=${world.foods.length}`);
  if (!alive) break;
}
