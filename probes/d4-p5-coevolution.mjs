// D4 P5 — Coevolution: the arms race made allelic.
// 150k-tick run under sustained foraging pressure.
// PASSES if: mean plant tannin moves ≥0.1 off founder AND mean herbivore
// detoxTol moves ≥0.1 off founder, with positive cross-correlation
// (plant leads, lag > 0).
// Honest failure: if only one moves, report which selection pressure is
// missing — no coefficient tuning.
// Run: node probes/d4-p5-coevolution.mjs [seed]
import { probeWorld, runSampled, meanPlantAllele, meanCreatureAllele } from './d4-helper.mjs';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = 150000;
const EVERY = 5000;
const HERBIVORES = ['grub', 'beetle', 'scurrier', 'skimmer', 'flutter'];

const mw = probeWorld(seed, { light: true });
const tannin0 = meanPlantAllele(mw.plants, 'tannin');
const detox0 = meanCreatureAllele(mw.m2creatures, null, 'detoxTol');
console.log(`founder: tannin=${tannin0.toFixed(3)} detoxTol=${detox0.toFixed(3)}`);

const series = runSampled(mw, TICKS, EVERY, (w, t) => {
  let detox = 0, n = 0;
  for (const sp of HERBIVORES) {
    const m = meanCreatureAllele(w.m2creatures, sp, 'detoxTol');
    // weight by population
    const pop = w.m2creatures.filter((c) => c.alive && c.species === sp).length;
    detox += m * pop; n += pop;
  }
  return { tick: t, tannin: meanPlantAllele(w.plants, 'tannin'), detoxTol: n ? detox / n : 0 };
});

const last = series[series.length - 1];
const dTannin = last.tannin - tannin0;
const dDetox = last.detoxTol - detox0;
console.log(`final: tannin=${last.tannin.toFixed(3)} (Δ${dTannin >= 0 ? '+' : ''}${dTannin.toFixed(3)}) detoxTol=${last.detoxTol.toFixed(3)} (Δ${dDetox >= 0 ? '+' : ''}${dDetox.toFixed(3)})`);

// Cross-correlation: plant leads (tannin at lag k vs detoxTol now, k > 0).
function xcorr(a, b, lag) {
  const n = a.length - lag;
  if (n < 5) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i + lag]; }
  ma /= n; mb /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (a[i] - ma) * (b[i + lag] - mb);
    sxx += (a[i] - ma) ** 2; syy += (b[i + lag] - mb) ** 2;
  }
  return sxy / Math.max(1e-9, Math.sqrt(sxx * syy));
}
const tanninSeries = series.map((r) => r.tannin);
const detoxSeries = series.map((r) => r.detoxTol);
let bestLag = 0, bestC = -2;
for (let lag = 1; lag <= 10; lag++) {
  const c = xcorr(tanninSeries, detoxSeries, lag);
  if (c > bestC) { bestC = c; bestLag = lag; }
}
console.log(`cross-correlation (plant leads): best lag=${bestLag} r=${bestC.toFixed(3)}`);
const pass = Math.abs(dTannin) >= 0.1 && Math.abs(dDetox) >= 0.1 && bestC > 0 && bestLag > 0;
console.log(pass ? 'P5 PASS — coevolutionary arms race in the allele series'
  : `P5 FAIL — ${Math.abs(dTannin) < 0.1 ? 'tannin did not move; ' : ''}${Math.abs(dDetox) < 0.1 ? 'detoxTol did not move; ' : ''}${bestC <= 0 ? 'no positive cross-correlation' : ''} (finding)`);
process.exit(pass ? 0 : 1);
