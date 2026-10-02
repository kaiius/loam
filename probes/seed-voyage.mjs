// v0.35 "Seed vectors" — SEED-VOYAGE GATE (execution probe).
// Gravity-only dispersal is over. This probe forces seeds through EACH
// vector in a live sim and watches deposition happen:
//   (a) endozoochory: fruit eaten → gut timer → seedling deposited AWAY
//       from the parent plant;
//   (b) hydrochory: fruit over water → drift seed → current → wash-ashore
//       seedling on new ground.
// PASS = ≥1 endozoochory deposition ≥200px from the eating point AND ≥1
// hydrochory wash-ashore deposition. Run: node probes/seed-voyage.mjs [seed]
import { createWorld, bindWorld, populateGenesis, tickWorld, disperseSeed, dropWindfall } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 0.5;
const world = bindWorld(createWorld(seed));
populateGenesis(world);

const results = { seed, endozoochory: null, hydrochory: null };

// ---- arm (a): endozoochory ----
const plant = world.plants.find((p) => p.genome && p.kind !== 'herb') || world.plants[0];
const eater = world.creatures.find((c) => c.alive);
if (!plant || !eater) {
  console.log(JSON.stringify({ ...results, verdict: 'FAIL — no plant or no creature' }));
  process.exit(1);
}
// Park the eater at the plant and feed it until a seed loads into the gut.
eater.x = plant.x; eater.platformIndex = plant.platformIndex;
const food = { plantId: plant.id, dadGenome: plant.genome, foodKind: 'fruit' };
let loaded = 0;
for (let i = 0; i < 40 && !loaded; i++) {
  disperseSeed(world, eater, food);
  loaded = (eater.gutSeeds || []).length;
}
const xEaten = eater.x;
console.log(`endozoochory: gut loaded=${loaded} at x=${Math.round(xEaten)} (parent plant ${plant.id} @ ${Math.round(plant.x)})`);

// Let the eater wander (it will — brains do that) while the gut clock runs.
for (let i = 0; i < 900; i++) tickWorld(world, DT);
const endoEvents = world.events.filter((e) => e.type === 'seedDispersed' && e.vector === 'endozoochory');
const far = endoEvents.filter((e) => e.dist >= 200);
console.log(`endozoochory: ${endoEvents.length} depositions, ${far.length} ≥200px away ` +
  `(dists: ${endoEvents.map((e) => Math.round(e.dist)).join(', ')})`);
results.endozoochory = {
  depositions: endoEvents.length,
  farDepositions: far.length,
  maxDist: endoEvents.length ? Math.round(Math.max(...endoEvents.map((e) => e.dist))) : 0,
};

// ---- arm (b): hydrochory ----
// Use the widest current (most room to visibly drift).
const cur = (world.currents || []).slice().sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];
if (!cur) {
  console.log(JSON.stringify({ ...results, verdict: 'FAIL — no water currents' }));
  process.exit(1);
}
console.log(`hydrochory: current rect [${Math.round(cur.x0)}, ${Math.round(cur.x1)}] dir=${cur.dir} speed=${cur.speed.toFixed(1)}px/s`);
// Drop windfall fruit over the middle of the water.
const midX = (cur.x0 + cur.x1) / 2;
const wplant = world.plants.find((p) => p.genome) || plant;
for (let i = 0; i < 12; i++) {
  dropWindfall(world, {
    x: midX, y: cur.surfaceY - 50, foodKind: 'fruit', amount: 2,
    plantId: wplant.id, dadGenome: wplant.genome, nutrition: 1,
  }, world.rng);
}
console.log(`hydrochory: drift seeds afloat=${world.driftSeeds.length}`);
const plantsBefore = world.plants.length;
for (let i = 0; i < 3000; i++) tickWorld(world, DT);
const hydroEvents = world.events.filter((e) => e.type === 'seedDispersed' && e.vector === 'hydrochory');
console.log(`hydrochory: ${hydroEvents.length} wash-ashore depositions ` +
  `(at x: ${hydroEvents.map((e) => Math.round(e.plant.x)).join(', ')})`);
console.log(`hydrochory: plants ${plantsBefore} → ${world.plants.length} (new ground colonized)`);
results.hydrochory = {
  washAshore: hydroEvents.length,
  plantsBefore, plantsAfter: world.plants.length,
};

const pass = (results.endozoochory.farDepositions >= 1) && (results.hydrochory.washAshore >= 1);
results.verdict = pass ? 'PASS — both vectors deposit away from parents; new ground colonized'
  : 'FAIL — a vector did not deliver';
console.log(JSON.stringify(results, null, 2));
process.exit(pass ? 0 : 1);
