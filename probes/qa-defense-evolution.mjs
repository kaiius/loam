// v0.36 QA gate 5 — defense evolution.
// The v0.28 design note claims shark vigor's phase-dependence is "the
// selection pressure that sorts prey phase: diurnal prey sleep through the
// sharks' best hour." Sharks here are nocturnal (phase 0.8); the
// activityPhase locus is heritable (founder 0.5 ± 0.25 — standing variation).
//
// Gemini review (v0.36) raised two real objections, both addressed here:
// (a) DRIFT: a 0.05 mean shift in 20-30 generations can be genetic drift in
//     a small population, not selection. Fix: REPLICATION — 3 seeds, and
//     the directional shift must appear in ≥2/3. Drift doesn't replicate
//     directionally.
// (b) REFUGE: shark targeting has no sleep check — a sleeping creature in
//     water is just as vulnerable. If phase doesn't change WHERE creatures
//     are during shark hours, there is no selection pressure and this gate
//     FAILS honestly — which is itself a finding about the v0.28 claim.
//
// Design: per seed, two arms — SHARKS (populateGenesis as-is) vs CONTROL
// (predators removed at genesis; spawnPredators draws from decorRng so the
// removal doesn't shift founder genomes). 20k ticks each. Per seed PASS =
// mean activityPhase(sharks) ends below mean activityPhase(control) by
// ≥0.03 AND the gap grows over time (not a tick-0 artifact).
// Gate PASS = ≥2/3 seeds pass.
// Run: node probes/qa-defense-evolution.mjs (seeds 7,8,9 fixed)
import { createWorld, bindWorld, populateGenesis, tickWorld } from '../src/sim/world.js';

const SEEDS = [7, 8, 9];
const DT = 0.5, TICKS = 20000, SAMPLE = 2000;

function meanPhase(world) {
  const ps = world.creatures.filter((c) => c.alive && c.pheno && c.pheno.activityPhase !== undefined)
    .map((c) => c.pheno.activityPhase);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
}

function runArm(seed, withSharks) {
  const world = bindWorld(createWorld(seed));
  populateGenesis(world);
  if (!withSharks) world.predators = [];
  const series = [meanPhase(world)];
  for (let t = 0; t < TICKS; t += SAMPLE) {
    for (let i = 0; i < SAMPLE; i++) tickWorld(world, DT);
    series.push(meanPhase(world));
  }
  return series;
}

const seedResults = [];
for (const seed of SEEDS) {
  const sharks = runArm(seed, true), control = runArm(seed, false);
  const sEnd = sharks[sharks.length - 1], cEnd = control[control.length - 1];
  const sMid = sharks[Math.floor(sharks.length / 2)], cMid = control[control.length / 2 | 0];
  const gapEnd = (cEnd ?? 0) - (sEnd ?? 0), gapMid = (cMid ?? 0) - (sMid ?? 0);
  const gapStart = (control[0] ?? 0) - (sharks[0] ?? 0);
  const pass = sEnd !== null && cEnd !== null && gapEnd >= 0.03 && gapEnd > Math.abs(gapStart) && gapEnd >= gapMid - 0.02;
  seedResults.push({ seed, gapStart: +gapStart.toFixed(3), gapMid: +gapMid.toFixed(3),
                     gapEnd: +gapEnd.toFixed(3), pass });
  console.log(`seed ${seed}: gap start=${gapStart.toFixed(3)} mid=${gapMid.toFixed(3)} end=${gapEnd.toFixed(3)} → ${pass ? 'SHIFT' : 'no shift'}`);
}
const nPass = seedResults.filter((r) => r.pass).length;
const pass = nPass >= 2;
console.log(JSON.stringify({ gate: 'defense-evolution', seeds: SEEDS, ticks: TICKS,
  seedResults, seedsPassing: `${nPass}/3`,
  verdict: pass ? 'PASS — shark pressure sorts prey phase toward diurnal, replicated'
                : 'FAIL — no replicated phase sorting (drift or no selection pressure; see Gemini note in probe header)',
}, null, 2));
process.exit(pass ? 0 : 1);
