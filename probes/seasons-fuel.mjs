// v0.27 "Seasons" — clone-pair fuel-burn probe (exit criterion c).
// Two identical genomes (same founder genome, same jungle spot, pinned,
// resting) in two worlds differing ONLY in seasonal phase: one held at
// winter solstice, one at summer solstice. Measures the seasonal thermal
// tax as bloodSugar + fat delta over 600 ticks. Emergent, not gated.
// Run: node probes/seasons-fuel.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';
import { createCreature } from '../src/sim/creature.js';
import { ensureSeasonClock } from '../src/sim/weather.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 2, TICKS = 600;

function winterSummerWorlds() {
  // One genome, cloned into two worlds.
  const rng = createRng(seed);
  const genome = randomGenome(rng);
  const mk = (phase) => {
    const world = bindWorld(createWorld(seed));
    const Y = ensureSeasonClock(world.climate, world);
    world.time = phase * Y; // hold the seasonal phase
    const pi = platformIndexAt(world, 1500, 800);
    const c = createCreature(genome, 1500, pi, world.rng);
    c.biochem.age = c.pheno.lifespanSec * 0.5;
    world.creatures.push(c);
    return { world, c, Y };
  };
  return { genome, winter: mk(0.75), summer: mk(0.25) };
}

const { winter, summer } = winterSummerWorlds();
const snap = (c) => ({ bs: c.biochem.bloodSugar, hunger: c.biochem.hunger, core: c.biochem.coreTemp });
const w0 = snap(winter.c), s0 = snap(summer.c);

for (let t = 0; t < TICKS; t++) {
  for (const { world, c } of [winter, summer]) {
    c.x = 1500; c.vx = 0; c.vy = 0; // pin: the thermal tax, not the wandering tax
    c.action = 'rest'; c.actionTimer = 10;
    // hold the phase — a live world would drift, but the probe isolates the season
    tickWorld(world, DT);
  }
  // re-pin the phase each tick (tickWorld advances time; we hold the season fixed)
  winter.world.time = 0.75 * winter.Y;
  summer.world.time = 0.25 * summer.Y;
}

const w1 = snap(winter.c), s1 = snap(summer.c);
const burn = (a, b) => a.bs - b.bs; // bloodSugar drop = fuel burned
console.log(JSON.stringify({
  seed, ticks: TICKS,
  winterSolstice: { dFuel: +burn(w0, w1).toFixed(4), hunger: +w1.hunger.toFixed(3), coreTemp: +w1.core.toFixed(3) },
  summerSolstice: { dFuel: +burn(s0, s1).toFixed(4), hunger: +s1.hunger.toFixed(3), coreTemp: +s1.core.toFixed(3) },
}, null, 2));
