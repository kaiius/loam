// v0.27 "Seasons" — controlled birth-season experiment (exit criterion b).
// Ten matched genome pairs: one clone born at the spring equinox, its twin
// at the autumn equinox, into the SAME live world. The season is the only
// difference. Tracks lifetime biomass (Σ bodyMass·dt) per individual.
// Reports the paired spring/autumn ratio (criterion: > 1.3).
// Run: node probes/seasons-birthseason.mjs [seed]
import { createWorld, bindWorld, populate, tickWorld, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';
import { createCreature } from '../src/sim/creature.js';
import { seasonPhase, ensureSeasonClock } from '../src/sim/weather.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 2, PAIRS = 10;

const world = bindWorld(createWorld(seed));
populate(world);
const Y = ensureSeasonClock(world.climate, world);

const rng = createRng(seed * 7919 + 13);
const genomes = [];
for (let i = 0; i < PAIRS; i++) genomes.push(randomGenome(rng));

const massSec = new Map(); // id -> Σ bodyMass·dt
const cohortOf = new Map(); // id -> 'spring' | 'autumn'
const genomeIdx = new Map(); // id -> pair index

function spawnJuveniles(phaseName, timeS) {
  world.time = timeS;
  const pi = platformIndexAt(world, 1500, 800);
  genomes.forEach((g, gi) => {
    const c = createCreature(g, 1450 + gi * 12, pi, world.rng);
    c.biochem.age = 1; // newborn
    c.bodyMass = 1.2;
    world.creatures.push(c);
    massSec.set(c.id, 0);
    cohortOf.set(c.id, phaseName);
    genomeIdx.set(c.id, gi);
  });
}

spawnJuveniles('spring', 0);
// run to the autumn equinox, tracking the spring cohort
const ticksHalf = Math.floor((0.5 * Y) / DT);
for (let t = 0; t < ticksHalf; t++) {
  tickWorld(world, DT);
  for (const c of world.creatures) {
    if (c.alive && massSec.has(c.id)) massSec.set(c.id, massSec.get(c.id) + (c.bodyMass || 0) * DT);
  }
}
spawnJuveniles('autumn', 0.5 * Y);
// run two full years more so both cohorts can complete their lives
const ticksRest = Math.floor((2 * Y) / DT);
const diedAt = new Map();
const seenAlive = new Set();
for (let t = 0; t < ticksRest; t++) {
  tickWorld(world, DT);
  const nowAlive = new Set();
  for (const c of world.creatures) {
    if (!c.alive) continue;
    nowAlive.add(c.id);
    if (massSec.has(c.id)) massSec.set(c.id, massSec.get(c.id) + (c.bodyMass || 0) * DT);
  }
  for (const id of seenAlive) if (!nowAlive.has(id) && !diedAt.has(id)) diedAt.set(id, world.time);
  seenAlive.clear();
  for (const id of nowAlive) seenAlive.add(id);
}

const spring = [], autumn = [];
const pairs = [];
for (const [id, ms] of massSec) {
  const ch = cohortOf.get(id);
  const rec = { pair: genomeIdx.get(id), mass: ms, completed: diedAt.has(id) };
  (ch === 'spring' ? spring : autumn).push(rec);
}
for (let gi = 0; gi < PAIRS; gi++) {
  const s = spring.find((r) => r.pair === gi), a = autumn.find((r) => r.pair === gi);
  if (s && a) pairs.push({ pair: gi, spring: s.mass, autumn: a.mass, ratio: s.mass / Math.max(a.mass, 1e-9) });
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
console.log(JSON.stringify({
  seed, pairs: PAIRS,
  springMean: mean(spring.map((r) => r.mass)),
  autumnMean: mean(autumn.map((r) => r.mass)),
  springCompleted: spring.filter((r) => r.completed).length,
  autumnCompleted: autumn.filter((r) => r.completed).length,
  pairedRatioMean: mean(pairs.map((p) => p.ratio)),
  pairs: pairs.map((p) => ({ pair: p.pair, s: Math.round(p.spring), a: Math.round(p.a), r: +p.ratio.toFixed(2) })),
}, null, 2));
