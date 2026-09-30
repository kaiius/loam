// Viability proof (Christine's reproducibility standard): a self-contained
// script that proves a Canopy world sustains a breeding population.
// Run: node test/viability-proof.mjs [seed] [ticks]
// A seed is VIABLE if, at the end of the run, the population is alive,
// births happened, and matings happened. The claim "Canopy v0.13 sustains
// populations" reduces to: every listed seed is viable. Same seed + same
// code = same result (deterministic RNG); anyone can re-run this file.
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = parseInt(process.argv[3] || '20000', 10);
const DT = 0.5; // 10000 sim-seconds ≈ 2.8 sim-hours

const world = bindWorld(createWorld(seed));
populate(world);

let births = 0, matings = 0, deaths = 0;
// tickWorld truncates world.events to the last 60, so index-based counting
// misses. Count via the push method instead — every event is observed.
const origPush = world.events.push.bind(world.events);
world.events.push = (e) => {
  if (e.type === 'hatch') births++;
  else if (e.type === 'mating') matings++;
  else if (e.type === 'death') deaths++;
  return origPush(e);
};

let maxPop = 0, finalPop = 0;
for (let i = 0; i < TICKS; i++) {
  tickWorld(world, DT);
  const alive = world.creatures.filter((c) => c.alive).length;
  if (alive > maxPop) maxPop = alive;
}
finalPop = world.creatures.filter((c) => c.alive).length;

const viable = finalPop > 0 && births > 0 && matings > 0;
console.log(JSON.stringify({
  seed, ticks: TICKS, simSeconds: TICKS * DT,
  alive: finalPop, maxPop, births, matings, deaths,
  verdict: viable ? 'VIABLE' : 'EXTINCT',
}, null, 2));
process.exit(viable ? 0 : 1);
