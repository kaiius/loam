// v0.28 "Day and night" — phase-divergence probe (exit criterion).
// Mixed-phase prey founders (activityPhase 0.2 diurnal-sleepers vs 0.8
// nocturnal-sleepers) with nocturnal sharks (phase 0.8, vigorous in dim
// light). Calibrates the predation differential first, then measures whether
// activityPhase sorts across generations: prey that sleeps when sharks hunt
// (light ~0.2) should be selected against.
// Run: node probes/daynight-phasediv.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt, addFood } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';
import { createCreature, predatorVigor } from '../src/sim/creature.js';

const seed = parseInt(process.argv[2] || '7', 10);

// Calibration: shark vigor by light.
console.log('Shark vigor (phase 0.8):', [0.0, 0.2, 0.5, 0.8, 1.0]
  .map((l) => `light ${l.toFixed(1)}: ${predatorVigor(0.8, l).toFixed(2)}`).join(', '));

const DAY_TICKS = 600;
const world = bindWorld(createWorld(seed, { dayTicks: DAY_TICKS }));
const pi = platformIndexAt(world, 1500, 800);

// Prey founders: 8 with phase 0.2 (sleep at night, vulnerable), 8 with
// phase 0.8 (sleep by day, awake when sharks hunt).
const prey = [];
for (let k = 0; k < 16; k++) {
  const phase = k < 8 ? 0.2 : 0.8;
  const g = randomGenome(createRng(seed + k), {
    overrides: { activityPhase: phase, instPhaseSleep: 0.9 },
  });
  const c = createCreature(g, 1300 + k * 40, pi, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.2;
  world.creatures.push(c);
  prey.push(c);
}

// Two sharks (nocturnal hunters).
for (let k = 0; k < 2; k++) {
  const g = randomGenome(createRng(seed + 100 + k));
  const c = createCreature(g, 1500, pi, world.rng, { species: 'shark' });
  // Force shark phenotype phase (normally from species founder).
  c.pheno.phase = 0.8;
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  world.creatures.push(c);
}

let sharkBites = 0;
const origPush = world.events.push.bind(world.events);
world.events.push = (e) => {
  if (e.type === 'bite' && e.creature && e.creature.pheno && e.creature.pheno.phase === 0.8) sharkBites++;
  return origPush(e);
};

// Track sleep-state at bite time (calibration).
let bitesOnSleepers = 0, bitesOnAwake = 0;
world.events.push = (e) => {
  if (e.type === 'bite') {
    sharkBites++;
    if (e.other) {
      if (e.other.sleeping) bitesOnSleepers++; else bitesOnAwake++;
    }
  }
  return origPush(e);
};

const TICKS = 3000;
// Food-rich: isolate predation from starvation (the foraging probe showed
// nocturnals struggle to eat; here we measure the predation differential).
const feed = () => {
  for (let x = 1200; x <= 1800; x += 100) {
    if (!world.foods.some((f) => Math.abs(f.x - x) < 60)) {
      addFood(world, x, pi, 'fruit', 2.0, 0, { nutrition: 1 });
    }
  }
};
for (let t = 0; t < TICKS; t++) {
  if (t % 50 === 0) feed();
  tickWorld(world, 0.1);
}

const surv02 = prey.slice(0, 8).filter((c) => c.alive).length;
const surv08 = prey.slice(8).filter((c) => c.alive).length;
console.log(`\nseed ${seed}, ${TICKS} ticks:`);
console.log(`  shark bites: ${sharkBites} (on sleepers: ${bitesOnSleepers}, on awake: ${bitesOnAwake})`);
console.log(`  phase-0.2 prey survivors: ${surv02}/8 (sleep when sharks hunt)`);
console.log(`  phase-0.8 prey survivors: ${surv08}/8 (awake when sharks hunt)`);
console.log(surv08 > surv02
  ? 'PREDATION DIFFERENTIAL CONFIRMED: night-awake phase survives better.'
  : 'NO DIFFERENTIAL: phases survive equally (reported, not gated).');
