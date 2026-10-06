// D4 P3 — Trophic cascade: predator removal vs control.
// Control (light ecology + 1 jungle-cat) vs predator-removal (light
// ecology, no predator), same seed: 60k ticks.
// PASSES if: grub census series diverges upward (≥2× control by tick 40k),
// mean crop-per-plant falls (≥30% below control) — the classic cascade.
// FAILS if the series don't move — the verbs don't couple (honest finding).
// (Light ecology: the full 36-creature roster makes 60k-tick runs
// infeasible; the predator/prey mechanism is unchanged.)
// Run: node probes/d4-p3-cascade.mjs [seed]
import { probeWorld, runSampled } from './d4-helper.mjs';
import { spawnSpecies } from '../src/material/species.js';
import { createRng } from '../src/sim/rng.js';

const seed = parseInt(process.argv[2] || '7', 10);
const TICKS = 60000;
const EVERY = 5000;

function runTreatment(withPredator) {
  const mw = probeWorld(seed, { light: true });
  if (withPredator) {
    const rng = createRng((seed * 331 + 7) >>> 0 || 1);
    const g = mw.grid, W = g.cols * 10;
    const px = W * 0.5;
    const cx = Math.max(0, Math.min(g.cols - 1, Math.floor(px / 10)));
    const cat = spawnSpecies(mw, rng, 'jungle-cat', px, (mw.surf[cx] || 0) * 10 - 4, {});
    mw.m2creatures.push(cat);
  }
  const series = runSampled(mw, TICKS, EVERY, (w, t) => {
    const grub = (w.ecology.series.grub || []).slice(-1)[0] ?? 0;
    let crop = 0, n = 0;
    for (const p of w.plants) if (p.fruiting) { crop += p.fruit || 0; n++; }
    return { tick: t, grub, meanCrop: n ? crop / n : 0, plants: w.plants.length };
  });
  return { series, mw };
}

console.log('running control (with predator)...');
const control = runTreatment(true);
console.log('running predator-removal...');
const removal = runTreatment(false);

const at = (s, tick) => s.series.find((r) => r.tick === tick);
const c40 = at(control, 40000), r40 = at(removal, 40000);
console.log(`tick 40000: control grub=${c40.grub} meanCrop=${c40.meanCrop.toFixed(2)} | removal grub=${r40.grub} meanCrop=${r40.meanCrop.toFixed(2)}`);
const grubRatio = r40.grub / Math.max(1, c40.grub);
const cropDrop = c40.meanCrop > 0 ? (c40.meanCrop - r40.meanCrop) / c40.meanCrop : 0;
console.log(`grub ratio (removal/control): ${grubRatio.toFixed(2)} (need ≥2)`);
console.log(`crop drop: ${(cropDrop * 100).toFixed(1)}% (need ≥30%)`);
console.log(`final plants: control=${control.mw.plants.length} removal=${removal.mw.plants.length}`);
const pass = grubRatio >= 2 && cropDrop >= 0.3;
console.log(pass ? 'P3 PASS — trophic cascade in the recorded series'
  : 'P3 FAIL — the verbs do not couple (honest finding: kills the "real trophic pressure" claim)');
process.exit(pass ? 0 : 1);
