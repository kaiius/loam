// v0.35 seed-vector tests — endozoochory (gut timer) and hydrochory
// (current field + wash-ashore). The seed-voyage gate lives in
// probes/seed-voyage.mjs (execution probe, not a unit test).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld, bindWorld, populateGenesis, tickWorld,
  disperseSeed, tickGutSeeds, tickDriftSeeds, dropWindfall,
  GUT_TRANSIT_TICKS,
} from '../src/sim/world.js';
import { founderGenome } from '../src/sim/species.js';
import { createRng } from '../src/sim/rng.js';
import { createCreature } from '../src/sim/creature.js';

function fruitWorld(seed = 777) {
  const world = bindWorld(createWorld(seed));
  populateGenesis(world);
  const plant = world.plants.find((p) => p.genome);
  assert.ok(plant, 'a plant with a genome');
  const c = createCreature(founderGenome('tanglekin', createRng(11)), plant.x, plant.platformIndex, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.4;
  world.creatures.push(c);
  return { world, plant, c };
}

function feedUntilLoaded(world, c, plant, food) {
  for (let i = 0; i < 40 && !(c.gutSeeds || []).length; i++) disperseSeed(world, c, food);
  return (c.gutSeeds || []).length;
}

test('v0.35: eating fruit loads the gut, not the ground — gravity dispersal is over', () => {
  const { world, plant, c } = fruitWorld();
  const n0 = world.plants.length;
  const food = { plantId: plant.id, dadGenome: plant.genome, foodKind: 'fruit' };
  const loaded = feedUntilLoaded(world, c, plant, food);
  assert.ok(loaded >= 1, 'a seed entered the gut');
  assert.equal(world.plants.length, n0, 'no immediate seedling — nothing deposited at the eater');
});

test('v0.35: gut timer deposits away from the eating point', () => {
  const { world, plant, c } = fruitWorld();
  const food = { plantId: plant.id, dadGenome: plant.genome, foodKind: 'fruit' };
  assert.ok(feedUntilLoaded(world, c, plant, food) >= 1, 'gut loaded');
  const xEaten = c.x;
  c.gutSeeds[0].timer = 1; // fast-forward the gut clock
  // The creature traveled: move it to a far platform, the way a real
  // forager would be somewhere else 400+ ticks later.
  const far = world.platforms.findIndex((p, i) => i !== c.platformIndex && Math.abs((p.x1 + p.x2) / 2 - xEaten) > 500);
  assert.ok(far >= 0, 'a far platform exists');
  const fp = world.platforms[far];
  c.platformIndex = far; c.x = (fp.x1 + fp.x2) / 2;
  const n0 = world.plants.length;
  tickGutSeeds(world, c);
  assert.equal(world.plants.length, n0 + 1, 'a seedling was deposited');
  const ev = world.events.filter((e) => e.type === 'seedDispersed' && e.vector === 'endozoochory').pop();
  assert.ok(ev, 'endozoochory event logged');
  assert.ok(ev.dist >= 400, `deposited away from parent (dist=${Math.round(ev.dist)})`);
});

test('v0.35: the seedling carries mom×dad — outcrossing survives the gut', () => {
  const { world, plant, c } = fruitWorld();
  const dad = world.plants.find((p) => p.genome && p.id !== plant.id);
  const food = { plantId: plant.id, dadGenome: dad.genome, foodKind: 'fruit' };
  assert.ok(feedUntilLoaded(world, c, plant, food) >= 1, 'gut loaded');
  c.gutSeeds[0].timer = 1;
  const n0 = world.plants.length;
  tickGutSeeds(world, c);
  assert.equal(world.plants.length, n0 + 1, 'seedling deposited');
  const seedling = world.plants[world.plants.length - 1];
  assert.ok(seedling.genome, 'seedling has a genome');
  assert.notDeepEqual(seedling.genome, plant.genome, 'child is not a clone of mom');
});

test('v0.35: currents are pure geometry — same seed, same field, no stream drawn', () => {
  const a = bindWorld(createWorld(31337));
  const b = bindWorld(createWorld(31337));
  assert.deepEqual(
    a.currents.map((c) => [c.x0, c.x1, c.dir, c.speed]),
    b.currents.map((c) => [c.x0, c.x1, c.dir, c.speed]),
    'current field deterministic per seed',
  );
  assert.ok(a.currents.length > 0, 'water exists to have currents');
  for (const c of a.currents) assert.ok(c.dir === 1 || c.dir === -1, 'direction is ±1');
});

test('v0.35: drift seeds ride the current and wash ashore on new ground', () => {
  const { world } = fruitWorld();
  const cur = world.currents.slice().sort((p, q) => (q.x1 - q.x0) - (p.x1 - p.x0))[0];
  const mom = world.plants.find((p) => p.genome);
  const midX = (cur.x0 + cur.x1) / 2;
  // Force a drift seed directly (deterministic entry point).
  world.driftSeeds.push({
    x: midX, y: cur.surfaceY, momGenome: mom.genome, dadGenome: mom.genome,
    kind: mom.kind, plantId: mom.id, xEaten: midX, ttl: 100000, rect: cur,
  });
  const n0 = world.plants.length;
  let landed = null;
  for (let i = 0; i < 4000 && !landed; i++) {
    tickDriftSeeds(world, 0.5);
    landed = world.events.find((e) => e.type === 'seedDispersed' && e.vector === 'hydrochory');
  }
  assert.ok(landed, 'a drift seed washed ashore and germinated');
  assert.equal(world.plants.length, n0 + 1, 'one new seedling on new ground');
  assert.ok(Math.abs(landed.plant.x - midX) > 50, 'washed ashore away from the drop point');
});

test('v0.35: windfall fruit over water launches drift seeds', () => {
  const { world } = fruitWorld();
  const cur = world.currents[0];
  const mom = world.plants.find((p) => p.genome);
  const midX = (cur.x0 + cur.x1) / 2;
  // The 0.5 spawn chance: drop enough fruit to be sure (deterministic seed).
  for (let i = 0; i < 20; i++) {
    dropWindfall(world, {
      x: midX, y: cur.surfaceY - 50, foodKind: 'fruit', amount: 2,
      plantId: mom.id, dadGenome: mom.genome, nutrition: 1,
    }, world.rng);
  }
  const driftLaunched = world.driftSeeds.length > 0 ||
    world.events.some((e) => e.type === 'seedAdrift');
  assert.ok(driftLaunched, 'at least one windfall seed joined the drift');
});

test('v0.35: no sterility deadlock — a full canopy of mature plants still admits one seedling', () => {
  const { world, plant, c } = fruitWorld();
  // Fill the world with mature plants (no seedlings anywhere).
  while (world.plants.length < 60) {
    const mom = world.plants[0];
    const g = mom.genome;
    // addPlant appends; force maturity.
    const before = world.plants.length;
    world.plants.push({
      kind: 'plant', id: 9000 + before, x: 100 + before * 10, platformIndex: mom.platformIndex,
      y: mom.y, growth: 1, fruitTimer: 10, pollination: 0, flower: 'bud',
      bloomTimer: 2, spentTimer: 0, floraId: mom.floraId, pollenDonorGenome: null,
      netted: false, sway: 0, zone: mom.zone, morph: mom.morph, fruitKind: mom.fruitKind,
      genome: g, pheno: mom.pheno,
    });
  }
  for (const p of world.plants) p.growth = 1;
  assert.ok(!world.plants.some((p) => p.growth < 1), 'all mature, zero seedlings');
  const food = { plantId: plant.id, dadGenome: plant.genome, foodKind: 'fruit' };
  assert.ok(feedUntilLoaded(world, c, plant, food) >= 1, 'gut loaded');
  c.gutSeeds[0].timer = 1;
  tickGutSeeds(world, c);
  assert.ok(world.plants.some((p) => p.growth < 1), 'a seedling was planted — gap dynamics, not sterility');
  assert.ok(world.plants.length <= 60, 'cap still holds');
});

test('v0.35: dispersal draws come from disperseRng — the main stream is untouched by new draws', () => {
  // Every NEW v0.35 draw (gut-timer jitter, child genome, drift ttl,
  // wash-ashore jitter) draws from disperseRng. Draining disperseRng must
  // not shift world.rng's sequence (pebbleRng precedent, v0.33).
  const wa = bindWorld(createWorld(555));
  const wb = bindWorld(createWorld(555));
  for (let i = 0; i < 500; i++) wa.disperseRng.next();
  assert.equal(wa.rng.next(), wb.rng.next(), 'disperseRng drainage never touches the main stream');
});
