// v0.28 "Day and night" — foraging probe: nocturnal vs diurnal food intake.
// Two founders with pinned activityPhase (0.15 nocturnal, 0.85 diurnal) and
// strong instPhaseSleep, foraging in a food-rich world through full day/night
// cycles. Measures food eaten (via _ate) during day (light > 0.5) vs night.
// Expectation: the diurnal eats more by day, the nocturnal more by night —
// the phase niche, behaviorally.
// Run: node probes/daynight-foraging.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt, addFood } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';
import { createCreature } from '../src/sim/creature.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DAY_TICKS = 600; // short days: 60s per day, 5 days in 3000 ticks

const world = bindWorld(createWorld(seed, { dayTicks: DAY_TICKS }));
const pi = platformIndexAt(world, 1500, 800);

const mk = (phase, x) => {
  const g = randomGenome(createRng(seed + Math.round(phase * 100)), {
    overrides: { activityPhase: phase, instPhaseSleep: 0.9, eyeSize: phase < 0.5 ? 0.9 : 0.3 },
  });
  const c = createCreature(g, x, pi, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.3;
  world.creatures.push(c);
  return c;
};

const noct = mk(0.15, 1400); // prefers dark
const diur = mk(0.85, 1600); // prefers light

// Food-rich: fruit scattered, replenished.
const feed = () => {
  for (let x = 1200; x <= 1800; x += 100) {
    if (!world.foods.some((f) => Math.abs(f.x - x) < 60)) {
      addFood(world, x, pi, 'fruit', 2.0, 0, { nutrition: 1 });
    }
  }
};

let nDay = 0, nNight = 0, dDay = 0, dNight = 0;
const TICKS = 3000;
for (let t = 0; t < TICKS; t++) {
  if (t % 50 === 0) feed();
  // _ate holds last tick's intake (cleared by tickBiochem); sample before ticking.
  const day = world.light > 0.5;
  const nAte = noct._ate || 0, dAte = diur._ate || 0;
  if (day) { nDay += nAte; dDay += dAte; } else { nNight += nAte; dNight += dAte; }
  tickWorld(world, 0.1);
}

console.log(`seed ${seed}, ${TICKS} ticks (${TICKS / DAY_TICKS} days):`);
console.log(`  nocturnal (phase 0.15): day ${nDay.toFixed(2)}, night ${nNight.toFixed(2)}`);
console.log(`  diurnal (phase 0.85):   day ${dDay.toFixed(2)}, night ${dNight.toFixed(2)}`);
const nNightBias = nNight / Math.max(0.001, nDay + nNight);
const dDayBias = dDay / Math.max(0.001, dDay + dNight);
console.log(`  nocturnal night-bias: ${(nNightBias * 100).toFixed(0)}%, diurnal day-bias: ${(dDayBias * 100).toFixed(0)}%`);
console.log(nNightBias > 0.6 && dDayBias > 0.6
  ? 'PHASE NICHE CONFIRMED: each forages mainly in its phase.'
  : 'WEAK/NO SORTING: phases do not strongly segregate foraging (reported, not gated).');
