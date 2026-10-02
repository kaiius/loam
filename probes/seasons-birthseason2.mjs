// v0.27 "Seasons" — controlled birth-season experiment, v2 (exit criterion b).
// Two IDENTICAL empty worlds (same seed, no founders — no competition
// confound). Ten juveniles with the same ten genomes are spawned into each:
// one world at the spring equinox, the other at the autumn equinox. The
// birth season is the only difference. Tracks lifetime biomass
// (Σ bodyMass·dt) per individual; reports the paired spring/autumn ratio
// (criterion: > 1.3 — birth season must matter for life outcomes).
// Run: node probes/seasons-birthseason2.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome } from '../src/sim/genome.js';
import { createCreature } from '../src/sim/creature.js';
import { ensureSeasonClock } from '../src/sim/weather.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 2, PAIRS = 10;

const rng = createRng(seed * 7919 + 13);
const genomes = [];
for (let i = 0; i < PAIRS; i++) genomes.push(randomGenome(rng));

function runCohort(birthPhase, birthTime) {
  const world = bindWorld(createWorld(seed)); // NO populate — empty world
  const Y = ensureSeasonClock(world.climate, world);
  world.time = birthTime;
  const pi = platformIndexAt(world, 1500, 800);
  const ids = [];
  genomes.forEach((g, gi) => {
    const c = createCreature(g, 1450 + gi * 12, pi, world.rng);
    c.biochem.age = 1; // newborn
    c.bodyMass = 1.2;
    world.creatures.push(c);
    ids.push(c.id);
  });
  const massSec = new Map(ids.map((id) => [id, 0]));
  const died = new Set();
  const seenAlive = new Set(ids);
  const totalTicks = Math.floor((2 * Y) / DT);
  for (let t = 0; t < totalTicks; t++) {
    tickWorld(world, DT);
    const nowAlive = new Set();
    for (const c of world.creatures) {
      if (!c.alive) continue;
      nowAlive.add(c.id);
      if (massSec.has(c.id)) massSec.set(c.id, massSec.get(c.id) + (c.bodyMass || 0) * DT);
    }
    for (const id of seenAlive) if (!nowAlive.has(id)) died.add(id);
    seenAlive.clear();
    for (const id of nowAlive) seenAlive.add(id);
  }
  return ids.map((id, gi) => ({ pair: gi, mass: massSec.get(id), completed: died.has(id) }));
}

const Y = ensureSeasonClock(bindWorld(createWorld(seed)).climate, { creatures: [] }) || 1200;
const spring = runCohort('spring', 0);
const autumn = runCohort('autumn', 0.5 * Y);
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
const pairs = spring.map((s, gi) => {
  const a = autumn[gi];
  return { pair: gi, spring: Math.round(s.mass), autumn: Math.round(a.mass), ratio: +(s.mass / Math.max(a.mass, 1e-9)).toFixed(2) };
});
console.log(JSON.stringify({
  seed, pairs: PAIRS, yearLength_s: Math.round(Y),
  springMean: Math.round(mean(spring.map((r) => r.mass))),
  autumnMean: Math.round(mean(autumn.map((r) => r.mass))),
  springCompleted: spring.filter((r) => r.completed).length,
  autumnCompleted: autumn.filter((r) => r.completed).length,
  pairedRatioMean: +mean(pairs.map((p) => s_mass_ratio(p))).toFixed(3),
  pairs,
}, null, 2));
function s_mass_ratio(p) { return p.spring / Math.max(p.autumn, 1e-9); }
