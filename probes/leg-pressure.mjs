// Leg-pressure experiment — BIOMES_DESIGN §13.7 (v0.33).
// Isolates leg weakness from the illness/contamination confound and finds
// the leg value where climb-pressure is readable independently of illness.
//
// Method: sweep legPower × noFouling (2×2 factorial + sweep). Every founder's
// legPower homologs are overridden post-populate to [X, X] and the phenotype
// re-derived — same world seed → same founders, same worldgen, same initial
// RNG state; the ONLY difference across treatments is legPower. noFouling=ON
// neutralizes contamination at the source, so any remaining leg-dependent
// signal is pure leg effect.
//
// Run: node probes/leg-pressure.mjs [seed] [ticks]
//   seed  — world seed (default 3; viable on v0.32)
//   ticks — ticks per cell (default 20000, the viability standard)
//
// Prints a per-cell JSON table and the verdict. Aggregate across seeds by hand.
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';
import { phenotype } from '../src/sim/genome.js';
import { deriveAquaticPheno } from '../src/sim/evodevo.js';

const seed = parseInt(process.argv[2] || '3', 10);
const TICKS = parseInt(process.argv[3] || '20000', 10);
const DT = 0.5;
const LEG_VALUES = [0.2, 0.25, 0.3, 0.4, 0.5, 0.6]; // trimmed v0.33: the zone
// boundaries live at 0.2/0.25 and 0.3/0.4; 0.45/0.35 added nothing

function runCell(legPower, noFouling) {
  const world = bindWorld(createWorld(seed, { noFouling }));
  populate(world);
  // The §13.7 confound fix: identical initial conditions, legPower only.
  // Same derivation pipeline as createCreature (phenotype + aquatic).
  for (const c of world.creatures) {
    c.genome.alleles['legPower'] = [legPower, legPower];
    c.pheno = deriveAquaticPheno(phenotype(c.genome));
  }
  let jumps = 0, climbs = 0, hardLandings = 0, strandedFalls = 0, births = 0;
  const deaths = {};
  // tickWorld truncates world.events to the last 60 — count via the push
  // method so every event is observed.
  const origPush = world.events.push.bind(world.events);
  world.events.push = (e) => {
    if (e.type === 'jumped') jumps++;
    else if (e.type === 'climbed') climbs++;
    else if (e.type === 'hardLanding') hardLandings++;
    else if (e.type === 'strandedFall') strandedFalls++;
    else if (e.type === 'hatch') births++;
    else if (e.type === 'death') deaths[e.cause] = (deaths[e.cause] || 0) + 1;
    return origPush(e);
  };
  let floorSamples = 0, floorTicks = 0, creatureTicks = 0;
  for (let i = 0; i < TICKS; i++) {
    tickWorld(world, DT);
    if (i % 10 === 0) {
      for (const c of world.creatures) {
        if (!c.alive) continue;
        floorTicks++;
        if (c.platformIndex === 0) floorSamples++; // platform 0 = ground
      }
    }
  }
  // Creature-tick normalization: extinct runs leave most wall-ticks empty,
  // so wall-tick rates are meaningless. Count actual lived ticks instead.
  // (Approximated from the 1-in-10 sampling above × 10.)
  creatureTicks = floorTicks * 10;
  const alive = world.creatures.filter((c) => c.alive).length;
  // Treatment-integrity check: does the founder override survive selection
  // + mutation, or does the population's mean legPower drift off-target?
  const living = world.creatures.filter((c) => c.alive);
  const meanLeg = living.length
    ? +(living.reduce((s, c) => s + (c.pheno.legPower ?? 0), 0) / living.length).toFixed(3)
    : null;
  const k = TICKS / 1000;
  const ck = Math.max(1, creatureTicks) / 1000; // per 1k creature-ticks
  return {
    seed, legPower, noFouling, ticks: TICKS,
    alive, births, endMeanLegPower: meanLeg,
    creatureTicks,
    jumpsPerK: +(jumps / k).toFixed(2),
    jumpsPerCK: +(jumps / ck).toFixed(2),
    climbsPerK: +(climbs / k).toFixed(2),
    climbsPerCK: +(climbs / ck).toFixed(2),
    hardLandingsPerK: +(hardLandings / k).toFixed(3),
    strandedFallsPerK: +(strandedFalls / k).toFixed(3),
    floorFrac: floorTicks ? +(floorSamples / floorTicks).toFixed(3) : null,
    deathsPerK: Object.fromEntries(
      Object.entries(deaths).map(([cause, n]) => [cause, +(n / k).toFixed(3)])
    ),
    deathsPerCK: Object.fromEntries(
      Object.entries(deaths).map(([cause, n]) => [cause, +(n / ck).toFixed(3)])
    ),
  };
}

const rows = [];
for (const noFouling of [false, true]) {
  for (const legPower of LEG_VALUES) {
    const r = runCell(legPower, noFouling);
    rows.push(r);
    console.log(JSON.stringify(r));
  }
}

// Verdict: in the noFouling=ON arm (illness held at ~0), find the legPower
// below which jumps per creature-tick separate from the 0.6 baseline by
// more than 25% — the point where leg-driven behavior becomes readable
// without the illness amplifier. Report the confound arm's illness rate at
// the same threshold.
const clean = rows.filter((r) => r.noFouling);
const base = clean.find((r) => r.legPower === 0.6).jumpsPerCK;
let threshold = null;
for (const r of clean) {
  if (r.jumpsPerCK < 0.75 * base) { threshold = r.legPower; break; }
}
const conf = rows.filter((r) => !r.noFouling);
console.log(JSON.stringify({
  verdict: {
    seed,
    baselineJumpsPerCK_at_0_6_noFouling: base,
    readableThreshold: threshold,
    rule: 'legPower at/below which jumps per 1k creature-ticks < 75% of the 0.6 baseline, illness held at ~0 (noFouling=ON)',
    confoundCheck: conf.map((r) => ({
      legPower: r.legPower,
      illnessPerCK: (r.deathsPerCK['illness'] || 0),
      jumpsPerCK: r.jumpsPerCK,
      alive: r.alive,
    })),
  },
}, null, 2));
