// Loam R3 — the reactive-not-decorative failure-declaration procedure
// (REACTIVE_GATE.md §2). specie's question: quantify how a build is
// declared failed when environmental flux doesn't impact survival
// probability.
//
// For each pinned seed: run world A (biome live) and world B (frozen
// control — after worldgen, moist and nutrient are never updated: no
// diffusion, no rain/sky coupling, no corpse/deadwood deposits, no decay,
// no plant drawdown; the R2 static-moist fire/collapse mechanics are
// identical in both). The build FAILS unless on ≥2 of 3 seeds at least
// one billed creature number moves by its threshold:
//   |Δ mean bloodSugar| ≥ 0.02, or fruit-eaten differs ≥ 10%,
//   or mean geophagy yield differs ≥ 20%.
// Render quality is not consulted at any point.
//
// Usage: node probes/reactive-gate.mjs [seedA seedB seedC] [ticks]
// Exit 0 = gate PASS, 1 = gate FAIL.
import { createMaterialWorld, tickMaterialWorldM2, addFounder } from '../src/material/index.js';
import { createRng } from '../src/sim/rng.js';

const SEEDS = process.argv[2]
  ? [process.argv[2], process.argv[3], process.argv[4]].map(Number)
  : [31415, 27182, 16180];
const TICKS = Number(process.argv[5] || 6000);
const FOUNDERS = 4;

function run(seed, frozen) {
  const mw = createMaterialWorld(seed, 1, { fireOn: true });
  mw.frozenBiome = frozen;
  const rng = createRng(((seed * 7919 + 13) >>> 0) || 1);
  for (let i = 0; i < FOUNDERS; i++) addFounder(mw, rng);
  let bsSum = 0, bsN = 0, fruitEaten = 0;
  let prev = new Map(mw.plants.map((p, i) => [i, p.fruit || 0]));
  for (let t = 0; t < TICKS; t++) {
    tickMaterialWorldM2(mw);
    if (t % 50 === 0) {
      const cur = new Map();
      for (const [j, p] of mw.plants.entries()) {
        const f = p.fruit || 0; cur.set(j, f);
        const d = (prev.get(j) ?? f) - f;
        if (d > 0) fruitEaten += d;
      }
      prev = cur;
      const al = mw.m2creatures.filter((c) => c.alive);
      if (al.length) {
        bsSum += al.reduce((a, c) => a + (c.chem ? c.chem.bloodSugar ?? 0 : 0), 0) / al.length;
        bsN++;
      }
    }
  }
  const alive = mw.m2creatures.filter((c) => c.alive).length;
  const geo = mw.stats.geophagyEvents || 0;
  return {
    meanBs: bsN ? bsSum / bsN : 0,
    fruitEaten,
    geoEvents: geo,
    geoYield: geo > 0 ? (mw.stats.geophagyYield || 0) / geo : null,
    alive,
    dead: mw.m2creatures.length - alive,
  };
}

const verdicts = [];
for (const seed of SEEDS) {
  const live = run(seed, false);
  const frozen = run(seed, true);
  const dBs = Math.abs(live.meanBs - frozen.meanBs);
  const fruitRel = Math.abs(live.fruitEaten - frozen.fruitEaten) / Math.max(1, frozen.fruitEaten);
  let geoRel = null;
  if (live.geoEvents >= 5 && frozen.geoEvents >= 5) {
    geoRel = Math.abs(live.geoYield - frozen.geoYield) / Math.max(1e-9, frozen.geoYield);
  }
  const moved =
    dBs >= 0.02 || fruitRel >= 0.10 || (geoRel !== null && geoRel >= 0.20);
  verdicts.push({ seed, live, frozen, dBs: +dBs.toFixed(4), fruitRel: +fruitRel.toFixed(3), geoRel: geoRel === null ? null : +geoRel.toFixed(3), moved });
  console.log(
    `seed ${seed}: live(bs=${live.meanBs.toFixed(3)}, fruit=${live.fruitEaten}, geo=${live.geoEvents}x${live.geoYield === null ? '-' : live.geoYield.toFixed(2)}) ` +
    `frozen(bs=${frozen.meanBs.toFixed(3)}, fruit=${frozen.fruitEaten}, geo=${frozen.geoEvents}x${frozen.geoYield === null ? '-' : frozen.geoYield.toFixed(2)}) ` +
    `→ Δbs=${dBs.toFixed(3)} Δfruit=${(fruitRel * 100).toFixed(1)}% Δgeo=${geoRel === null ? 'n/a' : (geoRel * 100).toFixed(1) + '%'} ${moved ? 'MOVED' : 'static'}`
  );
}
const movedN = verdicts.filter((v) => v.moved).length;
const pass = movedN >= 2;
console.log(`\nREACTIVE GATE: ${movedN}/${SEEDS.length} seeds moved a billed number → ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
