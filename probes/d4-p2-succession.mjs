// D4 P2 — Succession: pioneer → climax on the plant genome.
// Ignite a fire-cleared plot, then track the colonizer and longevity
// allele means among plants germinated on the cleared cells, in 10k-tick
// cohorts, over 100k ticks.
// PASSES if: cohort colonizer mean rises ≥0.15 above the pre-fire baseline
// in the first 20k ticks, then falls back toward/below baseline by 80k
// ticks while longevity mean rises ≥0.1 — the pioneer→climax sequence in
// allele frequencies, not asserted.
// Run: node probes/d4-p2-succession.mjs [seed]
import { probeWorld, runSampled, meanPlantAllele } from './d4-helper.mjs';
import { plantPhenotype } from '../src/sim/plantgenome.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = 100000;
const EVERY = 10000;

const mw = probeWorld(seed, { light: true });
const g = mw.grid;

// Pre-fire baseline: allele means across all plants.
const baselineCol = meanPlantAllele(mw.plants, 'colonizer');
const baselineLon = meanPlantAllele(mw.plants, 'longevity');
console.log(`baseline: colonizer=${baselineCol.toFixed(3)} longevity=${baselineLon.toFixed(3)} (${mw.plants.length} plants)`);

// Ignite a plot: pick 15 plants, set their cells' heat above ignition.
// Record the burned region (seed cells) for the cohort filter.
const burned = new Set();
const victims = mw.plants.slice(0, 15);
for (const p of victims) {
  burned.add(`${p.seedX},${p.seedY}`);
  for (const ci of p.cells || []) g.heat[ci] = 1;
}
console.log(`ignited ${victims.length} plants`);

// Track cohorts: plants germinated on burned cells, by 10k-tick window.
const cohorts = []; // { tick, plants: [...] }
const seenIds = new Set(mw.plants.map((p) => p.id));
let cur = [];
const samples = runSampled(mw, TICKS, EVERY, (w, t) => {
  // Collect newly germinated plants on burned cells since the last sample.
  for (const p of w.plants) {
    if (seenIds.has(p.id)) continue;
    seenIds.add(p.id);
    if (burned.has(`${p.seedX},${p.seedY}`)) cur.push(p);
  }
  const col = meanPlantAllele(cur, 'colonizer');
  const lon = meanPlantAllele(cur, 'longevity');
  const row = { tick: t, n: cur.length, colonizer: +col.toFixed(4), longevity: +lon.toFixed(4) };
  cohorts.push(row);
  cur = [];
  return row;
});

console.log('cohort series (10k ticks):');
for (const r of cohorts) console.log(`  tick ${r.tick}: n=${r.n} colonizer=${r.colonizer} longevity=${r.longevity}`);

// Verdict.
const early = cohorts.slice(0, 2); // first 20k ticks
const late = cohorts.slice(6, 8);  // 70-80k ticks
const maxEarlyCol = Math.max(...early.map((r) => r.colonizer));
const minLateCol = Math.min(...late.map((r) => r.colonizer));
const maxLateLon = Math.max(...late.map((r) => r.longevity));
const colRise = maxEarlyCol - baselineCol;
const colFall = maxEarlyCol - minLateCol;
const lonRise = maxLateLon - baselineLon;
console.log(`colonizer: baseline=${baselineCol.toFixed(3)} early-max=${maxEarlyCol.toFixed(3)} (+${colRise.toFixed(3)}) late-min=${minLateCol.toFixed(3)} (fall ${colFall.toFixed(3)})`);
console.log(`longevity: baseline=${baselineLon.toFixed(3)} late-max=${maxLateLon.toFixed(3)} (+${lonRise.toFixed(3)})`);
const pass = colRise >= 0.15 && colFall >= 0.1 && lonRise >= 0.1;
console.log(pass ? 'P2 PASS — pioneer→climax succession in allele frequencies'
  : 'P2 FAIL — succession signal absent (finding, not a tuning exercise)');
process.exit(pass ? 0 : 1);
