// D4 P4 — Climate: drift+pulses vs frozenBiome control.
// Compare fruiting schedules (fruit regrown per plant-tick, binned by
// season phase) between a run with drift+pulses on and the frozenBiome
// control, same seed, 40k ticks.
// PASSES if: seasonal amplitude of fruiting differs measurably AND the
// drift run's annual-mean fruiting shows a nonzero slope over the run
// (the millennial scalar is doing work), while the control's doesn't.
// Run: node probes/d4-p4-climate.mjs [seed]
import { probeWorld, runSampled } from './d4-helper.mjs';
import { seasonPhase } from '../src/material/weather.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = 40000;
const EVERY = 2400; // one day

function runWorld(frozen) {
  const mw = probeWorld(seed, { light: true });
  mw.frozenBiome = frozen;
  // Track fruit regrown per day: sample total fruit on fruiting plants.
  const series = runSampled(mw, TICKS, EVERY, (w, t) => {
    let fruit = 0;
    for (const p of w.plants) if (p.fruiting) fruit += p.fruit || 0;
    return { tick: t, fruit, phase: seasonPhase(w) };
  });
  return series;
}

console.log('running drift+pulses...');
const live = runWorld(false);
console.log('running frozenBiome control...');
const frozen = runWorld(true);

// Seasonal amplitude: bin fruit by season phase quarter, take max-min.
function amplitude(series) {
  const bins = [[], [], [], []];
  for (const r of series) {
    const q = Math.floor((((r.phase % 1) + 1) % 1) * 4) % 4;
    bins[q].push(r.fruit);
  }
  const means = bins.map((b) => b.reduce((a, x) => a + x, 0) / Math.max(1, b.length));
  return Math.max(...means) - Math.min(...means);
}
// Annual-mean slope: linear regression of daily fruit vs tick.
function slope(series) {
  const n = series.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const r of series) { sx += r.tick; sy += r.fruit; sxx += r.tick * r.tick; sxy += r.tick * r.fruit; }
  return (n * sxy - sx * sy) / Math.max(1, n * sxx - sx * sx);
}

const ampLive = amplitude(live), ampFroz = amplitude(frozen);
const slopeLive = slope(live), slopeFroz = slope(frozen);
console.log(`seasonal amplitude: live=${ampLive.toFixed(1)} frozen=${ampFroz.toFixed(1)} (Δ=${Math.abs(ampLive - ampFroz).toFixed(1)})`);
console.log(`annual-mean slope: live=${slopeLive.toExponential(2)} frozen=${slopeFroz.toExponential(2)}`);
const ampDiff = Math.abs(ampLive - ampFroz) > 1.0;
const slopeNZ = Math.abs(slopeLive) > 2 * Math.abs(slopeFroz) && Math.abs(slopeLive) > 1e-7;
const pass = ampDiff && slopeNZ;
console.log(pass ? 'P4 PASS — drift/pulses move the fruiting climate'
  : 'P4 FAIL — climate signal absent at safe amplitudes (finding, not tuning)');
process.exit(pass ? 0 : 1);
