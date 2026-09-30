// The world: terrain, plants, food, critters, toys, eggs, creatures,
// and the day/night cycle. Owns the tick orchestration.

import { createRng } from './rng.js';
import { randomGenome, inherit } from './genome.js';
import { createCreature, updateCreature } from './creature.js';
import { ageStage } from './biochem.js';

export const DAY_LENGTH = 300; // seconds per full day/night cycle

export function createWorld(seed = 1) {
  const rng = createRng(seed);
  const world = {
    rng,
    time: DAY_LENGTH * 0.32, // start mid-morning
    light: 1,
    width: 1600,
    height: 900,
    groundY: 800,
    platforms: [
      { x1: 0, x2: 1600, y: 800 }, // ground
      { x1: 180, x2: 620, y: 610 }, // ledge left
      { x1: 980, x2: 1420, y: 610 }, // ledge right
      { x1: 640, x2: 960, y: 430 }, // high middle
    ],
    plants: [],
    foods: [],
    critters: [],
    toys: [],
    eggs: [],
    creatures: [],
    events: [], // { type, creature?, t } — consumed by UI
  };
  return world;
}

export function timeOfDay(world) {
  return (world.time / DAY_LENGTH) % 1;
}

// Smooth daylight: 1 at noon, ~0.12 at midnight.
export function updateLight(world) {
  const a = (timeOfDay(world) - 0.25) * Math.PI * 2;
  const s = Math.sin(a) * 0.5 + 0.5;
  world.light = 0.12 + 0.88 * s * s * (3 - 2 * s);
}

let nextObjId = 1;
function oid() {
  return nextObjId++;
}

export function addPlant(world, x, platformIndex) {
  const plat = world.platforms[platformIndex];
  world.plants.push({
    kind: 'plant', id: oid(), x, platformIndex, y: plat.y,
    growth: world.rng.range(0.3, 0.8), fruitTimer: world.rng.range(5, 25),
    sway: world.rng.range(0, Math.PI * 2),
  });
}

export function addFood(world, x, platformIndex, kind = 'fruit', amount = 1) {
  const plat = world.platforms[platformIndex];
  world.foods.push({
    kind: 'food', id: oid(), x, platformIndex, y: plat.y, foodKind: kind, amount,
  });
}

export function addCritter(world, x, platformIndex, kind) {
  const plat = world.platforms[platformIndex];
  world.critters.push({
    kind, id: oid(), x, platformIndex, y: plat.y,
    vx: world.rng.pick([-1, 1]) * world.rng.range(15, 40),
    t: world.rng.range(0, 100),
  });
}

export function addToy(world, x, platformIndex) {
  const plat = world.platforms[platformIndex];
  world.toys.push({
    kind: 'ball', id: oid(), x, platformIndex, y: plat.y, vx: 0, r: 16,
  });
}

export function layEgg(world, x, platformIndex, genome, parents = null) {
  const plat = world.platforms[platformIndex];
  world.eggs.push({
    kind: 'egg', id: oid(), x, y: plat.y, platformIndex, genome, parents,
    timer: 18 + world.rng.range(0, 10), wobble: 0,
  });
}

export function tryMate(a, b) {
  // Called with world as `this` via world.tryMate — bound below.
  const world = this;
  const sa = ageStage(a.biochem, a.pheno);
  const sb = ageStage(b.biochem, b.pheno);
  if (sa !== 'adult' || sb !== 'adult') return false;
  if (a.sex === b.sex || a.mateCooldown > 0 || b.mateCooldown > 0) return false;
  if (world.rng.next() > 0.35 + 0.4 * Math.min(a.pheno.fertility, b.pheno.fertility)) return false;
  const mom = a.sex === 'female' ? a : b;
  const dad = a.sex === 'female' ? b : a;
  const genome = inherit(mom.genome, dad.genome, world.rng);
  layEgg(world, (a.x + b.x) / 2, a.platformIndex, genome, [mom.id, dad.id]);
  mom.children.push('egg');
  dad.children.push('egg');
  a.mateCooldown = 90;
  b.mateCooldown = 90;
  a.reward += 0.8;
  b.reward += 0.8;
  world.events.push({ type: 'mating', a, b, t: world.time });
  return true;
}

function hatchEgg(world, egg) {
  const c = createCreature(egg.genome, egg.x, egg.platformIndex, world.rng, {
    parents: egg.parents,
  });
  c.name = uniqueName(world, c.name);
  // Newborns start hungry-ish and sleepy, like real babies.
  c.biochem.hunger = 0.45;
  c.biochem.energy = 0.7;
  world.creatures.push(c);
  world.events.push({ type: 'hatch', creature: c, t: world.time });
  const i = world.eggs.indexOf(egg);
  if (i >= 0) world.eggs.splice(i, 1);
}

export function tickWorld(world, dt) {
  world.time += dt;
  updateLight(world);
  const rng = world.rng;

  // Plants grow fruit.
  for (const p of world.plants) {
    p.growth = Math.min(1, p.growth + dt / 150);
    p.sway += dt;
    if (p.growth >= 1) {
      p.fruitTimer -= dt;
      if (p.fruitTimer <= 0) {
        p.fruitTimer = 18 + rng.range(0, 22);
        // Fruit drops to the ground platform below the plant.
        addFood(world, p.x + rng.range(-30, 30), 0, 'fruit', 1);
        if (world.foods.length > 40) world.foods.splice(0, world.foods.length - 40);
      }
    }
  }

  // Critters wander.
  for (const cr of world.critters) {
    const plat = world.platforms[cr.platformIndex];
    cr.t += dt;
    cr.x += cr.vx * dt;
    if (cr.x < plat.x1 + 10) { cr.x = plat.x1 + 10; cr.vx = Math.abs(cr.vx); }
    if (cr.x > plat.x2 - 10) { cr.x = plat.x2 - 10; cr.vx = -Math.abs(cr.vx); }
    if (rng.chance(dt * 0.2)) cr.vx = -cr.vx;
  }

  // Toys: friction.
  for (const t of world.toys) {
    const plat = world.platforms[t.platformIndex];
    t.x += t.vx * dt;
    t.vx *= 1 - Math.min(1, 2.5 * dt);
    if (Math.abs(t.vx) < 2) t.vx = 0;
    if (t.x < plat.x1 + t.r) { t.x = plat.x1 + t.r; t.vx = Math.abs(t.vx) * 0.5; }
    if (t.x > plat.x2 - t.r) { t.x = plat.x2 - t.r; t.vx = -Math.abs(t.vx) * 0.5; }
  }

  // Eggs hatch.
  for (const egg of [...world.eggs]) {
    egg.timer -= dt;
    egg.wobble = Math.max(0, egg.wobble - dt);
    if (egg.timer < 3) egg.wobble = 0.3; // wobbling before hatch
    if (egg.timer <= 0) hatchEgg(world, egg);
  }

  // Creatures.
  for (const c of world.creatures) {
    updateCreature(c, world, dt);
  }
  // Remove the dead (UI reads events first).
  for (let i = world.creatures.length - 1; i >= 0; i--) {
    if (!world.creatures[i].alive) world.creatures.splice(i, 1);
  }

  if (world.events.length > 60) world.events.splice(0, world.events.length - 60);
}

// Bind tryMate so creature code can call world.tryMate(a, b).
export function bindWorld(world) {
  world.tryMate = tryMate.bind(world);
  return world;
}

// Creature names must be unique within a world (the pool is small).
export function uniqueName(world, name) {
  const used = new Set(world.creatures.map((c) => c.name));
  if (!used.has(name)) return name;
  let i = 2;
  while (used.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

export function populate(world) {
  const rng = world.rng;
  // Plants on the ground and ledges.
  addPlant(world, 250, 0); addPlant(world, 700, 0); addPlant(world, 1150, 0);
  addPlant(world, 1450, 0); addPlant(world, 400, 1); addPlant(world, 1200, 2);
  // Starter food so the first creatures don't starve immediately.
  for (let i = 0; i < 8; i++) {
    addFood(world, rng.range(100, 1500), 0, 'fruit', 1);
  }
  // Critters and a ball.
  for (let i = 0; i < 5; i++) addCritter(world, rng.range(100, 1500), 0, 'bug');
  for (let i = 0; i < 3; i++) addCritter(world, rng.range(200, 1400), 0, 'butterfly');
  addToy(world, 800, 0);
  // Two founder creatures with fresh random genomes.
  const g1 = randomGenome(rng);
  const g2 = randomGenome(rng);
  const c1 = createCreature(g1, 600, 0, rng, { name: 'Pip' });
  const c2 = createCreature(g2, 1000, 0, rng, { name: 'Moss' });
  c1.name = uniqueName(world, c1.name);
  c2.name = uniqueName(world, c2.name);
  // Start them as juveniles so the player gets to know them.
  c1.biochem.age = c1.pheno.lifespanSec * 0.15;
  c2.biochem.age = c2.pheno.lifespanSec * 0.15;
  world.creatures.push(c1, c2);
  return world;
}
