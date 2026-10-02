// v0.28 "Day and night" — sleep-starvation probe (P1-4: the sleep-forever exploit).
// A creature forced to sleep constantly must starve: BMR (hungerRate) bills
// during sleep (exert floor 0.6 vs 0.5 awake-minimum), and hunger > 0.8
// overrides sleep → seekFood. If sleep were free, the sleeper would persist.
// Run: node probes/daynight-sleepstarve.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';
import { createCreature } from '../src/sim/creature.js';

const seed = parseInt(process.argv[2] || '7', 10);

const world = bindWorld(createWorld(seed, { dayTicks: 3000 }));
const pi = platformIndexAt(world, 1500, 800);
// Founder with max sleep drive: instPhaseSleep=1, activityPhase matched to
// current light so phaseSleepiness ≈ 1 (the brain wants sleep).
const g = randomGenome(createRng(seed), {
  overrides: { instPhaseSleep: 1, activityPhase: world.light },
});
const c = createCreature(g, 1500, pi, world.rng);
c.biochem.age = c.pheno.lifespanSec * 0.3;
c.biochem.bloodSugar = 0.8;
world.creatures.push(c);

let sleepTicks = 0, wakeFromHunger = 0;
const TICKS = 3000;
for (let t = 0; t < TICKS && c.alive; t++) {
  // Force the sleep choice every tick (the exploit attempt: never wake voluntarily).
  if (!c.sleeping) {
    // The brain may choose otherwise; pin it.
    c.action = 'sleep';
  }
  const wasSleeping = c.sleeping;
  const hungerBefore = 1 - (c.biochem.bloodSugar || 0);
  tickWorld(world, 0.1);
  if (c.sleeping) sleepTicks++;
  // Hunger override: the sim should wake the sleeper when starving.
  if (wasSleeping && !c.sleeping && hungerBefore > 0.5) wakeFromHunger++;
}

console.log(`seed ${seed}: alive=${c.alive} sleepTicks=${sleepTicks}/${TICKS} ` +
  `bloodSugar=${c.biochem.bloodSugar.toFixed(2)} hungerWakeEvents=${wakeFromHunger}`);
console.log(c.alive
  ? 'SURVIVED (check: did it eat? bloodSugar should be low if it never woke to eat)'
  : 'DIED — the sleep-forever exploit fails: BMR bills during sleep.');
