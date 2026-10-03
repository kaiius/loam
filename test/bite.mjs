// Canopy v0.22.1 — the bite lands: case 'bite' in executeAction.
// Before this fix, action 23 ('bite') fell through the switch to wandering —
// a forced bite for 600 ticks did nothing and no predator could kill.
// These tests pin the mechanics: damage, armor, fatigue, retaliation,
// the kill → corpse path, and the clean miss.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld, bindWorld, populate, tickWorld, platformIndexAt,
} from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { createCreature } from '../src/sim/creature.js';
import { randomGenome } from '../src/sim/genome.js';
import { founderGenome } from '../src/sim/species.js';
import { ACTIONS } from '../src/sim/brain.js';

assert.equal(ACTIONS[23], 'bite', 'bite appended at 23, never renumbered');

// A world with two creatures staged adjacent on the same platform.
function duelWorld(seed = 77, speciesA = 'jungle-cat', speciesB = 'tanglekin') {
  const world = bindWorld(createWorld(seed));
  world.creatures.length = 0;
  const pi = platformIndexAt(world, 1500, 800);
  const mk = (species, x) => {
    const c = createCreature(founderGenome(species, world.rng), x, pi, world.rng);
    c.biochem.age = c.pheno.lifespanSec * 0.5; // adult — full mass
    c.pheno.spikes = 0; c.pheno.spikeArmor = 0; // no accidental armor
    c.biochem.hunger = 0; c.biochem.energy = 1; // fed and rested
    world.creatures.push(c);
    return c;
  };
  const a = mk(speciesA, 1500);
  const b = mk(speciesB, 1512);
  return { world, a, b };
}

const forceBite = (c) => { c.action = 'bite'; c.actionTimer = 100; };

test('v0.22.1: bite executes when selected — injury lands, event logged', () => {
  const { world, a, b } = duelWorld();
  forceBite(a);
  tickWorld(world, 0.1);
  assert.ok(b.biochem.injury > 0, `prey injured, got ${b.biochem.injury}`);
  assert.ok(world.events.some((e) => e.type === 'bite' && e.other === b), 'bite event in the ledger');
  assert.equal(a.actionLabel, 'biting');
});

test('v0.22.1: damage scales with mouthSize × mass', () => {
  const w1 = duelWorld(78); forceBite(w1.a);
  w1.a.pheno.mouthSize = 0.9; w1.a.pheno.size = 0.8;
  tickWorld(w1.world, 0.1);
  const big = w1.b.biochem.injury;
  const w2 = duelWorld(79); forceBite(w2.a);
  w2.a.pheno.mouthSize = 0.3; w2.a.pheno.size = 0.3;
  tickWorld(w2.world, 0.1);
  const small = w2.b.biochem.injury;
  assert.ok(big > small * 2, `big bite ${big.toFixed(3)} >> small bite ${small.toFixed(3)}`);
});

test('v0.22.1: spikeArmor reduces damage', () => {
  const w1 = duelWorld(80); forceBite(w1.a);
  tickWorld(w1.world, 0.1);
  const bare = w1.b.biochem.injury;
  const w2 = duelWorld(81); forceBite(w2.a);
  w2.b.pheno.spikes = 0.9; w2.b.pheno.spikeArmor = 0.9 * 0.3; // the genome.js formula
  tickWorld(w2.world, 0.1);
  const armored = w2.b.biochem.injury;
  assert.ok(armored < bare * 0.85, `armored ${armored.toFixed(3)} < bare ${bare.toFixed(3)}`);
});

test('v0.22.1: biting is billed — exertion set, blood sugar drains faster than rest', () => {
  const { world, a } = duelWorld(82);
  world.creatures.length = 1; // no target: the miss path still bills
  forceBite(a);
  tickWorld(world, 0.1);
  assert.ok(a._active >= 0.8, `exertion billed, got ${a._active}`);
  // The billed cost is real over time: 120 ticks of snapping at air
  // drains blood sugar faster than 120 ticks of sleep.
  const w2 = bindWorld(createWorld(83));
  w2.creatures.length = 0;
  const pi = platformIndexAt(w2, 1500, 800);
  // v0.22.1: use the SAME genome for both — the 229th locus (instHungerBite)
  // shifted the random stream, so two random genomes no longer isolate the
  // activity cost. Same genome => the only difference is the forced action.
  const sharedGenome = randomGenome(w2.rng);
  const mkIdle = (action) => {
    const c = createCreature(sharedGenome, 1500, pi, w2.rng);
    c.biochem.age = c.pheno.lifespanSec * 0.5;
    c.biochem.hunger = 0; c.biochem.energy = 1;
    c.action = action; c.actionTimer = 100000; c.sleeping = action === 'sleep';
    w2.creatures.push(c);
    return c;
  };
  const biter = mkIdle('bite');
  const sleeper = mkIdle('sleep');
  for (let t = 0; t < 120; t++) {
    biter.action = 'bite'; biter.actionTimer = 100000; // re-force: miss resets the timer
    // v0.37: re-force sleep too — the woken sleeper's brain now has 5 new
    // affect senses, so its post-wake action choice differs from v0.36.
    // The test isolates activity cost, not action selection.
    sleeper.action = 'sleep'; sleeper.actionTimer = 100000; sleeper.sleeping = true;
    tickWorld(w2, 0.1);
  }
  assert.ok(biter.biochem.bloodSugar < sleeper.biochem.bloodSugar,
    `biting costs: ${biter.biochem.bloodSugar.toFixed(3)} < resting ${sleeper.biochem.bloodSugar.toFixed(3)}`);
});

test('v0.22.1: biting a spiky target injures the biter (retaliation)', () => {
  const { world, a, b } = duelWorld(84);
  b.pheno.spikes = 0.9; b.pheno.spikeArmor = 0.9 * 0.3;
  forceBite(a);
  tickWorld(world, 0.1);
  assert.ok(a.biochem.injury > 0, `biter hurt by spikes, got ${a.biochem.injury}`);
  assert.ok(world.events.some((e) => e.type === 'clash'), 'clash event in the ledger');
});

test('v0.22.1: a kill leaves a corpse — cause reads wounds', () => {
  const { world, a, b } = duelWorld(85);
  let dead = false;
  for (let t = 0; t < 600 && !dead; t++) {
    forceBite(a);
    b.x = a.x + 12; // staged geometry: the cat holds the range
    b.biochem.bloodSugar = 1; // fed — hunger is derived from blood sugar;
    // isolate the wound kill, not starvation
    tickWorld(world, 0.1);
    dead = b.alive === false;
  }
  assert.ok(dead, 'the prey died within 600 forced bites');
  const death = world.events.find((e) => e.type === 'death' && e.creature === b);
  assert.ok(death, 'death in the ledger');
  assert.equal(death.cause, 'wounds', `cause reads wounds, got ${death.cause}`);
  assert.ok(world.foods.some((f) => f.foodKind === 'corpse'), 'a corpse was left for the scavengers');
});

test('v0.22.1: bite with no creature in range is a clean miss', () => {
  // Alone: no target, nothing sensed → falls back to wander (the codebase
  // convention for a targetless action), no crash, no phantom damage.
  const { world, a } = duelWorld(86);
  world.creatures.length = 1; // the biter, alone
  forceBite(a);
  const injuryBefore = a.biochem.injury;
  tickWorld(world, 0.1); // must not crash
  assert.equal(a.biochem.injury, injuryBefore, 'no phantom self-damage');
  assert.equal(a.action, 'wander', 'targetless bite falls back to wander');
  assert.ok(!world.events.some((e) => e.type === 'bite'), 'no bite event without a target');
});

test('v0.22.1: bite with a creature in sight but out of reach closes in', () => {
  // The eat precedent (v0.11): sensed but out of strike reach → move
  // toward it. Standing still was a livelock that killed a founder.
  const { world, a, b } = duelWorld(87);
  b.x = a.x + 200; // in sight (sightRange 533), out of strike reach (~60)
  const x0 = a.x;
  forceBite(a);
  tickWorld(world, 0.1);
  assert.equal(a.actionLabel, 'closing in');
  assert.ok(Math.abs(a.x - b.x) < 200, `closed the distance: gap now ${Math.abs(a.x - b.x).toFixed(1)}`);
  assert.ok(b.biochem.injury === 0, 'no damage dealt out of reach');
});
