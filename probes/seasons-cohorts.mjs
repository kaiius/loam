// v0.27 "Seasons" — multi-seed birth-season biomass probe.
// Birth rates per seed-year are low (2-6), so aggregate completed
// non-founder lives across seeds × 3 years. Reports spring-born vs
// autumn-born mean lifetime biomass (exit criterion: ratio > 1.3).
// Run: node probes/seasons-cohorts.mjs
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';
import { seasonPhase, ensureSeasonClock } from '../src/sim/weather.js';

const DT = 2, YEARS = 3;
const cohort = (ph) => {
  const p = ((ph % 1) + 1) % 1;
  if (p < 0.125 || p >= 0.875) return 'spring';
  if (p >= 0.375 && p < 0.625) return 'autumn';
  return p < 0.375 ? 'summer' : 'winter';
};

const cohortMass = { spring: [], summer: [], autumn: [], winter: [] };
const birthsByCohort = { spring: 0, summer: 0, autumn: 0, winter: 0 };
let totalBirths = 0;

for (let seed = 1; seed <= 12; seed++) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  const Y = ensureSeasonClock(world.climate, world);
  const birthPhase = new Map(), massSec = new Map(), isFounder = new Map();
  const seenAlive = new Set();
  const totalTicks = Math.floor((YEARS * Y) / DT);
  for (let t = 0; t < totalTicks; t++) {
    tickWorld(world, DT);
    const ph = seasonPhase(world);
    const nowAlive = new Set();
    for (const c of world.creatures) {
      if (!c.alive) continue;
      nowAlive.add(c.id);
      if (!birthPhase.has(c.id)) {
        birthPhase.set(c.id, ph);
        massSec.set(c.id, 0);
        const lin = world.lineage.get(c.id);
        isFounder.set(c.id, !lin || !lin.parents);
      }
      massSec.set(c.id, massSec.get(c.id) + (c.bodyMass || 0) * DT);
    }
    seenAlive.clear();
    for (const id of nowAlive) seenAlive.add(id);
  }
  for (const [id, ms] of massSec) {
    if (isFounder.get(id)) continue;
    totalBirths++;
    const ch = cohort(birthPhase.get(id));
    birthsByCohort[ch]++;
    if (!seenAlive.has(id)) cohortMass[ch].push(ms); // completed lives only
  }
  console.log(`seed ${seed}: non-founder births=${[...massSec.keys()].filter((id) => !isFounder.get(id)).length}`);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const out = {};
for (const k of Object.keys(cohortMass)) out[k] = { n: cohortMass[k].length, mean: mean(cohortMass[k]) };
out.springVsAutumnRatio = out.spring.mean / out.autumn.mean;
out.totalBirths = totalBirths;
out.birthsByCohort = birthsByCohort;
console.log(JSON.stringify(out, null, 2));
