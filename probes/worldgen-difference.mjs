// probes/worldgen-difference.mjs — the difference-metric instrument.
//
// Paul + Hermes's finding (v0.31 release feedback): the "81.9× worldgen
// difference" headline had no runnable probe in the tree — a number without
// an instrument, the same defect class as the old zone_fit. This probe is
// the instrument. Run: `node probes/worldgen-difference.mjs`.
//
// Metric (design/worldgen-v2.md §3, "the Joshua test"):
//   D(A,B) = normalized |region-width-vector| diff + |seaY diff|/1100
//          + |platform count| diff + mean platform displacement
// over 20 seeds, pairwise; the gate is median D ≥ 5× the v0.26 baseline.
// Normalization choices (documented, since the design doc leaves them
// implicit): region widths are L1-normalized (sum to 1) and compared with
// L1/2 (0..1, shorter vector zero-padded); platform-count diff is divided
// by the larger count (0..1); platform displacement pairs the two worlds'
// platforms sorted by (cx, y) and divides mean euclidean distance by 1100
// (the world-height scale the design doc already uses for seaY).
//
// Baseline: BASELINE_V026 = 0.0116 — the median pairwise D measured on the
// v0.26 tag (painted-template worldgen) by the v0.29 builder, 2026-10-02,
// over 20 seeds with this same procedure. Recorded here as a measurement,
// not a live computation: the v0.26 worldgen no longer exists in the tree.
// To re-measure it: `git worktree add /tmp/wg26 v0.26`, then run this
// probe's D() against that tree's rollLayout.
//
// Caveat (ax7's critique, v0.31 feedback): a ratio against 0.0116 flatters —
// almost any noise clears 5×. The metric is the floor; Joshua's eye-check
// on the side-by-side renders is the real gate. This probe keeps the number
// honest, not sufficient.

import { rollLayout } from '../src/sim/worldgen.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const BASELINE_V026 = 0.0116; // measured 2026-10-02, v0.29 builder, 20 seeds
const GATE_MULT = 5;

function features(layout) {
  const regions = layout.regions || [];
  const widths = regions.map((r) => r.x1 - r.x0);
  const sum = widths.reduce((a, b) => a + b, 0) || 1;
  const plats = (layout.platforms || [])
    .map((p) => ({ cx: (p.x1 + p.x2) / 2, y: p.y }))
    .sort((a, b) => a.cx - b.cx || a.y - b.y);
  return { normW: widths.map((w) => w / sum), seaY: layout.seaY || 0, plats };
}

function D(fa, fb) {
  const n = Math.max(fa.normW.length, fb.normW.length);
  let wdiff = 0;
  for (let i = 0; i < n; i++) wdiff += Math.abs((fa.normW[i] || 0) - (fb.normW[i] || 0));
  wdiff /= 2;
  const sea = Math.abs(fa.seaY - fb.seaY) / 1100;
  const ca = fa.plats.length, cb = fb.plats.length;
  const count = Math.abs(ca - cb) / Math.max(1, Math.max(ca, cb));
  const m = Math.min(ca, cb);
  let disp = 0;
  for (let i = 0; i < m; i++) {
    disp += Math.hypot(fa.plats[i].cx - fb.plats[i].cx, fa.plats[i].y - fb.plats[i].y);
  }
  disp = m > 0 ? disp / m / 1100 : 0;
  return wdiff + sea + count + disp;
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const feats = SEEDS.map((seed) => features(rollLayout(seed, 1).layout));
const ds = [];
for (let i = 0; i < feats.length; i++) {
  for (let j = i + 1; j < feats.length; j++) ds.push(D(feats[i], feats[j]));
}
const med = median(ds);
const ratio = med / BASELINE_V026;
console.log(`seeds=${SEEDS.length} pairs=${ds.length} medianD=${med.toFixed(4)} baseline=${BASELINE_V026} ratio=${ratio.toFixed(1)}x gate=${GATE_MULT}x`);
if (ratio < GATE_MULT) {
  console.error(`FAIL: median pairwise D ${med.toFixed(4)} is ${ratio.toFixed(1)}x baseline, need >= ${GATE_MULT}x`);
  process.exit(1);
}
console.log('PASS: worlds are measurably different (metric floor cleared; eye-check remains the real gate)');
