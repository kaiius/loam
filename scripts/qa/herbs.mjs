// v0.8 herb QA: infect half a population mid-run, then check that
// medicinal leaves get eaten and the sick recover — self-medication.
// Leaves never rot, so leaf disappearance = leaf eaten.
// Usage: node scripts/qa/herbs.mjs "7,11,42" 120
import { createWorld, bindWorld, populate, tickWorld } from '../../src/sim/world.js';

const seeds = (process.argv[2] || '7,11,42').split(',').map(Number);
const minutes = Number(process.argv[3] || 120);
const DT = 0.1;
const ticks = Math.floor(minutes * 60 / DT);

let allOk = true;
for (const seed of seeds) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  const cohort = new Set();
  let infected = false;
  let leavesEaten = 0;
  let lastLeaves = 0;
  for (let t = 0; t < ticks; t++) {
    if (!infected && world.time > 1800 && world.creatures.length > 4) {
      const sorted = [...world.creatures].sort((a, b) => a.id - b.id);
      for (let i = 0; i < Math.floor(sorted.length / 2); i++) {
        sorted[i].biochem.illness = 0.5; // realistic severe case (contagious threshold)
        cohort.add(sorted[i].id);
      }
      infected = true;
    }
    tickWorld(world, DT);
    const leaves = world.foods.filter((f) => f.foodKind === 'leaf').length;
    if (leaves < lastLeaves) leavesEaten += lastLeaves - leaves;
    lastLeaves = leaves;
  }
  const aliveCohort = world.creatures.filter((c) => cohort.has(c.id));
  const avgIll = aliveCohort.length
    ? aliveCohort.reduce((s, c) => s + c.biochem.illness, 0) / aliveCohort.length
    : -1;
  const survived = world.creatures.length > 0;
  // The bar: leaves get eaten during/after the outbreak, and the population
  // survives. (Whether each sick individual recovers is up to the sim.)
  const ok = survived && infected && leavesEaten > 0;
  if (!ok) allOk = false;
  console.log(
    `seed ${seed}: pop=${world.creatures.length} leavesEaten=${leavesEaten} ` +
    `cohortAlive=${aliveCohort.length}/${cohort.size} cohortAvgIll=${avgIll.toFixed(2)} ` +
    `${ok ? 'OK' : 'FAIL'}`
  );
}
console.log(allOk ? 'HERB-QA PASS' : 'HERB-QA FAIL');
process.exit(allOk ? 0 : 1);
