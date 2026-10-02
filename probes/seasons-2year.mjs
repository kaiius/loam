// v0.27 "Seasons" — 2-year exit-criterion probe (emergent, not gated).
// Measures, over 2 full seasonal years on a live world:
//   (a) annual mean T stability (year 1 vs year 2 — the no-heat-pump check);
//   (b) spring-born vs autumn-born mean lifetime biomass (>30% = seasons matter);
//   (d) summer soil moisture (no annual desiccation crash);
//   watch: deaths by season, birth seasonality.
// Run: node probes/seasons-2year.mjs [seed]
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';
import { seasonPhase, ensureSeasonClock } from '../src/sim/weather.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 2;

const world = bindWorld(createWorld(seed));
populate(world);
const Y = ensureSeasonClock(world.climate, world);
console.log(JSON.stringify({ seed, yearLength_s: Y, dt: DT }));

// phase quarters: 0 = spring equinox, 0.25 = summer solstice, ...
const quarter = (ph) => ['spring', 'summer', 'autumn', 'winter'][Math.floor(((ph % 1) + 1) % 1 * 4) % 4];
// birth cohorts centered on the equinoxes (breeding peak/trough)
const cohort = (ph) => {
  const p = ((ph % 1) + 1) % 1;
  if (p < 0.125 || p >= 0.875) return 'spring';
  if (p >= 0.375 && p < 0.625) return 'autumn';
  return p < 0.375 ? 'summer' : 'winter';
};

const birthPhase = new Map();   // id -> phase at first sight
const massSec = new Map();      // id -> Σ bodyMass·dt (lifetime biomass)
const founder = new Map();      // id -> is founder (lineage parents null)
const seenAlive = new Set();
const deathsByQ = { spring: 0, summer: 0, autumn: 0, winter: 0 };
let births = 0;

const yearMeanT = [0, 0];
const yearN = [0, 0];
const soilByQ = { spring: 0, summer: 0, autumn: 0, winter: 0 };
const soilN = { spring: 0, summer: 0, autumn: 0, winter: 0 };

const totalTicks = Math.floor((2 * Y) / DT);
for (let t = 0; t < totalTicks; t++) {
  tickWorld(world, DT);
  const ph = seasonPhase(world);
  const q = quarter(ph);
  // climate aggregates
  let sT = 0, sS = 0;
  for (const c of world.climate.cols) { sT += c.T; sS += c.soil; }
  const yr = world.time < Y ? 0 : 1;
  yearMeanT[yr] += sT / world.climate.cols.length; yearN[yr]++;
  soilByQ[q] += sS / world.climate.cols.length; soilN[q]++;

  // creature bookkeeping
  const nowAlive = new Set();
  for (const c of world.creatures) {
    if (!c.alive) continue;
    nowAlive.add(c.id);
    if (!birthPhase.has(c.id)) {
      birthPhase.set(c.id, ph);
      massSec.set(c.id, 0);
      const lin = world.lineage.get(c.id);
      founder.set(c.id, !lin || !lin.parents);
      if (lin && lin.parents) births++;
    }
    massSec.set(c.id, massSec.get(c.id) + (c.bodyMass || 0) * DT);
  }
  for (const id of seenAlive) {
    if (!nowAlive.has(id)) deathsByQ[quarter(birthPhase.get(id) ?? ph)]++;
  }
  seenAlive.clear();
  for (const id of nowAlive) seenAlive.add(id);
}

// (b): completed lives only (still-alive at end are censored), non-founders
const cohortMass = { spring: [], summer: [], autumn: [], winter: [] };
for (const [id, ms] of massSec) {
  if (founder.get(id)) continue;
  if (seenAlive.has(id)) continue; // censored — still living
  cohortMass[cohort(birthPhase.get(id))].push(ms);
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const springM = mean(cohortMass.spring), autumnM = mean(cohortMass.autumn);

console.log(JSON.stringify({
  annualMeanT: [yearMeanT[0] / yearN[0], yearMeanT[1] / yearN[1]],
  soilBySeason: Object.fromEntries(Object.entries(soilByQ).map(([k, v]) => [k, v / soilN[k]])),
  births, deathsByBirthSeason: deathsByQ,
  cohortSizes: Object.fromEntries(Object.entries(cohortMass).map(([k, v]) => [k, v.length])),
  meanLifetimeBiomass: { spring: springM, autumn: autumnM },
  springVsAutumnRatio: springM / autumnM,
}, null, 2));
