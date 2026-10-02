// v0.34 pollination tests — flower state, pollen tags, same-species
// deposition, outcrossing. The exclosure experiment lives in
// probes/pollination-exclosure.mjs (execution probe, not a unit test).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld, bindWorld, populateGenesis, tickWorld,
  tickPollination, disperseSeed, tickGutSeeds,
} from '../src/sim/world.js';
import { founderGenome } from '../src/sim/species.js';
import { createRng } from '../src/sim/rng.js';
import { createCreature } from '../src/sim/creature.js';

function bloomWorld(seed = 4242) {
  const world = bindWorld(createWorld(seed));
  populateGenesis(world);
  world.creatures.length = 0;
  const flowers = world.plants.filter((p) => p.kind === 'plant');
  assert.ok(flowers.length >= 2, 'flowers to test');
  const [A, B] = flowers;
  for (const p of [A, B]) { p.growth = 1; p.flower = 'bloom'; }
  B.x = A.x + 100; B.y = A.y; B.platformIndex = A.platformIndex;
  B.floraId = A.floraId; // same species
  const fl = createCreature(founderGenome('flutter', createRng(11)), A.x, A.platformIndex, world.rng);
  fl.biochem.age = fl.pheno.lifespanSec * 0.4;
  world.creatures.push(fl);
  return { world, A, B, fl };
}

test('v0.34: flower phenology cycles bud → bloom → spent → bud', () => {
  const world = bindWorld(createWorld(99));
  populateGenesis(world);
  const p = world.plants.find((pl) => pl.kind === 'plant');
  p.growth = 1;
  assert.equal(p.flower, 'bud', 'starts as bud');
  p.bloomTimer = 0.1;
  tickWorld(world, 0.5);
  assert.equal(p.flower, 'bloom', 'bud opens');
  p.fruitTimer = 0.01; // force fruit set
  p.pollination = 1;
  tickWorld(world, 0.5);
  assert.equal(p.flower, 'spent', 'fruiting spends the bloom');
  p.spentTimer = 0.1;
  tickWorld(world, 0.5);
  assert.equal(p.flower, 'bud', 'spent rests back to bud');
});

test('v0.34: deposition needs a second flower of the same species', () => {
  const { world, A, B, fl } = bloomWorld();
  // Visit A: pickup only, no deposition (self-pollen doesn't fertilize).
  fl.x = A.x; fl.y = A.y;
  tickWorld(world, 0.5);
  assert.equal(A.pollination, 0, 'self-pollen does not fertilize');
  assert.ok((fl.pollen || []).length >= 1, 'carries a pollen tag');
  assert.equal(fl.pollen[0].floraId, A.floraId, 'tag carries the flora species id');
  assert.ok(fl.pollen[0].donorGenome, 'tag carries the donor genome');
  // Visit B (same species) carrying A's pollen: deposition.
  fl.x = B.x; fl.y = B.y;
  for (let i = 0; i < 4; i++) tickWorld(world, 0.5);
  assert.ok(B.pollination > 0, `same-species deposition, got ${B.pollination}`);
  assert.ok(B.pollenDonorGenome, 'donor genome recorded for outcrossing');
});

test('v0.34: cross-species pollen does not fertilize', () => {
  const { world, A, B, fl } = bloomWorld();
  B.floraId = 'alien:spore'; // different species now
  fl.x = A.x; fl.y = A.y;
  tickWorld(world, 0.5);
  fl.x = B.x; fl.y = B.y;
  for (let i = 0; i < 4; i++) tickWorld(world, 0.5);
  assert.equal(B.pollination, 0, 'cross-species pollen does not fertilize');
});

test('v0.34: pollen goes stale — old tags cannot fertilize', () => {
  const { world, A, B, fl } = bloomWorld();
  fl.x = A.x; fl.y = A.y;
  tickWorld(world, 0.5);
  assert.ok((fl.pollen || []).length >= 1, 'picked up a tag');
  // Age the tag past viability without visiting (deterministic decay).
  for (const t of fl.pollen) t.viability = 0.1;
  fl.x = B.x; fl.y = B.y;
  for (let i = 0; i < 4; i++) tickWorld(world, 0.5);
  assert.equal(B.pollination, 0, 'stale pollen does not fertilize');
});

test('v0.34: outcrossing — a pollinated flower bears mom × donor seed', () => {
  const world = bindWorld(createWorld(777));
  populateGenesis(world);
  const mom = world.plants.find((p) => p.kind === 'plant' && p.genome);
  assert.ok(mom, 'a mother plant');
  // A donor genome distinct from mom's: flip one allele at the first locus.
  const donorGenome = JSON.parse(JSON.stringify(mom.genome));
  const firstKey = Object.keys(donorGenome.alleles)[0];
  donorGenome.alleles[firstKey] = [1, 1];
  mom.genome.alleles[firstKey] = [0, 0];
  // The fruit carries its dad (stamped at fruit set) — this is the path
  // disperseSeed actually reads.
  const fruitFood = { plantId: mom.id, dadGenome: donorGenome };
  const before = world.plants.length;
  // Force the dispersal roll to succeed: call disperseSeed with a fruit food.
  // v0.35: disperseSeed loads the gut; the seedling appears only after gut
  // transit (tickGutSeeds), deposited at the creature's position.
  const c = world.creatures.find((x) => x.alive);
  for (let attempt = 0; attempt < 200 && !(c.gutSeeds && c.gutSeeds.length); attempt++) {
    disperseSeed(world, c, fruitFood);
  }
  assert.ok(c.gutSeeds && c.gutSeeds.length > 0, 'seed loaded into the gut');
  let child = null;
  for (let t = 0; t < 800 && !child; t++) {
    tickGutSeeds(world, c);
    if (world.plants.length > before) child = world.plants[world.plants.length - 1];
  }
  assert.ok(child, 'a seedling dispersed after gut transit');
  const got = child.genome.alleles[firstKey];
  // mom is [0,0], donor is [1,1] — a selfed child would be [0,0]; an
  // outcrossed child carries a 1 from dad (mutation could flip, vanishingly
  // unlikely at one locus to exactly [0,0]... accept either outcross allele).
  assert.ok(got[0] === 1 || got[1] === 1, `child outcrossed mom×donor, got [${got}]`);
});

test('v0.34: the donor is stamped per fruit set — no frozen father', () => {
  const world = bindWorld(createWorld(779));
  populateGenesis(world);
  const mom = world.plants.find((p) => p.kind === 'plant' && p.genome);
  mom.growth = 1; mom.flower = 'bloom';
  mom.pollenDonorGenome = { marker: 'dad' }; // as tickPollination records it
  mom.fruitTimer = 0.01;
  const foodsBefore = world.foods.length;
  tickWorld(world, 0.5);
  assert.equal(mom.pollenDonorGenome, null, 'donor cleared at fruiting');
  const fresh = world.foods.slice(foodsBefore).filter((f) => f.plantId === mom.id);
  assert.ok(fresh.length > 0, 'fruit was set');
  assert.ok(fresh.every((f) => f.dadGenome && f.dadGenome.marker === 'dad'),
    'every fruit carries the stamped dad');
});

test('v0.34: unvisited flowers still self (wind/selfing baseline)', () => {
  const world = bindWorld(createWorld(778));
  populateGenesis(world);
  const mom = world.plants.find((p) => p.kind === 'plant' && p.genome);
  mom.pollenDonorGenome = null; // never visited
  const firstKey = Object.keys(mom.genome.alleles)[0];
  mom.genome.alleles[firstKey] = [0, 0];
  const c = world.creatures.find((x) => x.alive);
  const before = world.plants.length;
  // v0.35: disperseSeed loads the gut; the seedling appears after gut transit.
  let child = null;
  for (let attempt = 0; attempt < 200 && !(c.gutSeeds && c.gutSeeds.length); attempt++) {
    disperseSeed(world, c, { plantId: mom.id });
  }
  assert.ok(c.gutSeeds && c.gutSeeds.length > 0, 'seed loaded into the gut');
  for (let t = 0; t < 800 && !child; t++) {
    tickGutSeeds(world, c);
    if (world.plants.length > before) child = world.plants[world.plants.length - 1];
  }
  assert.ok(child, 'a seedling dispersed after gut transit');
  assert.deepEqual(child.genome.alleles[firstKey], [0, 0], 'unvisited flower selfs');
});
