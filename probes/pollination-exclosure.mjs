// v0.34 exclosure probe — netted vs open flowers.
// Two worlds, same seed: in the netted world every plant is flagged netted
// (tickPollination skips netted plants — the mesh excludes insects, not
// wind). Both run N ticks; the open world must set strictly more fruit
// (pollinator visits stack on top of the wind/selfing baseline), and the
// netted world must still set SOME fruit (the 0.6 wind/selfing floor works).
// This is the execution probe: real visits → real tags → real fruit set.
// Run: node probes/pollination-exclosure.mjs [seed] [ticks]
import { createWorld, bindWorld, populateGenesis, tickWorld } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = parseInt(process.argv[3] || '6000', 10);
const DT = 0.5;

function runWorld(netted) {
  const world = bindWorld(createWorld(seed));
  if (netted) world._exclosure = true; // every plant ever grown is netted
  populateGenesis(world);
  for (let i = 0; i < TICKS; i++) tickWorld(world, DT);
  return {
    fruitSet: world._fruitSetTotal || 0,
    pollinatedEvents: world.events.filter((e) => e.type === 'pollinated').length,
    plants: world.plants.length,
    creatures: world.creatures.filter((c) => c.alive).length,
  };
}

const open = runWorld(false);
const netted = runWorld(true);
const pass = open.fruitSet > netted.fruitSet && netted.fruitSet > 0;
console.log(JSON.stringify({
  seed, ticks: TICKS, open, netted,
  uplift: netted.fruitSet > 0 ? +((open.fruitSet - netted.fruitSet) / netted.fruitSet).toFixed(2) : null,
  verdict: pass
    ? 'PASS — pollinators raise fruit set above the wind/selfing baseline'
    : 'FAIL — no exclosure effect',
}, null, 2));
process.exit(pass ? 0 : 1);
