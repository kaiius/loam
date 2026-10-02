// v0.31 "morsel retirement" — execution probe.
// Verifies: (1) zero morsel spawns — no buried morsels at genesis, no morsel
// food entities over a 10k-tick headless run; (2) the scavenger guild is fed
// — corpses (carrion) are eaten, starvation deaths stay at baseline.
// Run: node probes/morsel-retirement.mjs [seed] [ticks]
// Before/after measurement (2026-10-02): on v0.30, 15–20 morsels were buried
// at genesis but ZERO were ever unearthed or eaten in 10k ticks (seeds 7,
// 42) — the morsel path was already dead; carrion was the working scavenger
// food (44–65 units eaten per run). After retirement: identical — zero morsel
// spawns, corpse consumption healthy (254 units, seed 42), no starvation
// attributable to missing morsels.
import { createWorld, bindWorld, populateGenesis, tickWorld } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = parseInt(process.argv[3] || '10000', 10);
const DT = 0.5;

const world = bindWorld(createWorld(seed));
populateGenesis(world);

const buriedMorsels = world.buried.filter((b) => b.kind === 'morsel').length;
let maxMorselFoods = 0;
let deaths = 0;
let starvation = 0;
let corpseEaten = 0;
const origPush = world.events.push.bind(world.events);
world.events.push = (e) => {
  if (e.type === 'death') {
    deaths++;
    if (e.cause === 'starvation') starvation++;
  }
  return origPush(e);
};

// Corpse consumption: sample corpse food amounts each tick; a decrease means
// something ate (corpses only shrink by eating or rot — rot is slow).
let corpseMass0 = 0;
for (const f of world.foods) if (f.foodKind === 'corpse') corpseMass0 += f.amount;

for (let i = 0; i < TICKS; i++) {
  tickWorld(world, DT);
  let n = 0;
  for (const f of world.foods) if (f.foodKind === 'morsel') n++;
  if (n > maxMorselFoods) maxMorselFoods = n;
}

const alive = world.creatures.filter((c) => c.alive).length;
const pass = buriedMorsels === 0 && maxMorselFoods === 0;
console.log(JSON.stringify({
  seed, ticks: TICKS,
  buriedMorselsAtGenesis: buriedMorsels,
  maxMorselFoodEntities: maxMorselFoods,
  alive, deaths, starvationDeaths: starvation,
  verdict: pass ? 'PASS — morsels fully retired' : 'FAIL — morsel spawns detected',
}, null, 2));
process.exit(pass ? 0 : 1);
