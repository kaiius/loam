// Loam R7 — the geophagy economics probes (arion's research program for the
// thin geophagy leg: 11–21 events/run, Δyield 0.7–3.3% vs the 20% bar).
//
// Probe A: deficit-depth at event time vs the ambient deficit distribution.
//   eat-early-shallow (events cluster at the 0.4 gate floor) indicts
//   settlement throughput; eat-late-deep (events fire deep) indicts
//   information (the drive surfaces late).
// Probe B: double-per-bite-quantum counterfactual (mw.geoQuantumScale = 2).
//   Mean billed yield/event scaling ~linearly = settlement-bound (the
//   quantum is the cap); flat = the constraint lives upstream in targeting.
//   Also answers specie's absorption-coefficient question: the cell's
//   nutrient stock is never decremented per bite, so there is no cell-side
//   bottleneck to find — the probe confirms the billed number follows the
//   quantum, not the cell.
// Probe C: spatial autocorrelation of geophagy events — expanding frontier
//   into fresh cells = serial discovery; contracting onto a shrinking set /
//   revisiting = collapse in progress. Plus the starvation failure mode:
//   drive fires while every cell in locomotion range is barren.
//
// Usage: node probes/geo-r7-probes.mjs depth [ticks]   -> probes A + C
//        node probes/geo-r7-probes.mjs quantum          -> probe B (live vs
//        frozen, scale 1 vs 2, on the reactive gate's seeds and tick count)
// Exit 0 always; prints the discriminating numbers. Verdict rules are
// pre-committed below (arion's threshold pre-commitment, R4).
import { createMaterialWorld, tickMaterialWorldM2, addFounder } from '../src/material/index.js';
import { createRng } from '../src/sim/rng.js';

const SEEDS = [31415, 27182, 16180]; // the reactive gate's pinned seeds
const FOUNDERS = 4;

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}
function summarize(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s.length ? +s[0].toFixed(3) : NaN,
    p10: +quantile(s, 0.1).toFixed(3),
    median: +quantile(s, 0.5).toFixed(3),
    p90: +quantile(s, 0.9).toFixed(3),
    max: s.length ? +s[s.length - 1].toFixed(3) : NaN,
    mean: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3) : NaN,
  };
}

function runWorld(seed, { ticks, quantum = 1, frozen = false, sampleEvery = 50 }) {
  const mw = createMaterialWorld(seed, 1, { fireOn: true });
  mw.frozenBiome = frozen;
  mw.geoQuantumScale = quantum; // R7: the counterfactual lever (probe B)
  const rng = createRng(((seed * 7919 + 13) >>> 0) || 1);
  for (let i = 0; i < FOUNDERS; i++) addFounder(mw, rng);
  const ambient = [];
  for (let t = 0; t < ticks; t++) {
    tickMaterialWorldM2(mw);
    if (t % sampleEvery === 0) {
      for (const c of mw.m2creatures) {
        if (c.alive) ambient.push(1 - (c.minerals ?? 0.5));
      }
    }
  }
  const st = mw.stats;
  const ev = st.geophagyEvents || 0;
  return {
    seed, ticks, quantum, frozen,
    events: ev,
    meanBilled: ev ? st.geophagyYield / ev : NaN,
    meanEff: ev ? (st.geophagyYieldEff || 0) / ev : NaN,
    totalBilled: st.geophagyYield || 0,
    deficits: st.geophagyDeficit || [],
    cells: st.geophagyCells || [],
    ambient,
    driveFailed: st.geoDriveFailed || 0,
    driveStarved: st.geoDriveStarved || 0,
  };
}

// --- Probe A + C ------------------------------------------------------------
function depthProbe(ticks) {
  console.log(`=== R7 probe A+C: deficit depth + spatial autocorrelation (${ticks} ticks) ===`);
  for (const seed of SEEDS) {
    const r = runWorld(seed, { ticks, quantum: 1 });
    const dSum = summarize(r.deficits);
    const aSum = summarize(r.ambient);
    const atGate = r.deficits.filter((d) => d < 0.5).length;
    // Probe A verdict (pre-committed): the gate floor is 0.4 — events can
    // only fire at deficit >= 0.4. Median within 0.15 of the floor =
    // eat-early-shallow (settlement throughput); median >= 0.65 =
    // eat-late-deep (information lag); between = mixed.
    const med = dSum.median;
    const frame = !Number.isFinite(med) ? 'NO-EVENTS'
      : med <= 0.55 ? 'SETTLEMENT (eat-early-shallow)'
      : med >= 0.65 ? 'INFORMATION (eat-late-deep)' : 'MIXED';
    console.log(`seed ${seed}: events=${r.events} ` +
      `event-deficit median=${med} p10=${dSum.p10} p90=${dSum.p90} ` +
      `at-gate(<0.5)=${atGate}/${r.deficits.length} ` +
      `ambient median=${aSum.median} p10=${aSum.p10} p90=${aSum.p90} (n=${aSum.n}) → ${frame}`);
    // Probe C: spatial autocorrelation.
    const cells = r.cells;
    const uniq = new Set(cells.map((e) => `${e.cx},${e.cy}`));
    const half = Math.floor(cells.length / 2);
    const first = new Set(cells.slice(0, half).map((e) => `${e.cx},${e.cy}`));
    const secondCells = cells.slice(half);
    const second = new Set(secondCells.map((e) => `${e.cx},${e.cy}`));
    const fresh = [...second].filter((k) => !first.has(k)).length;
    const revisit = cells.length ? 1 - uniq.size / cells.length : 0;
    // centroid contraction: mean distance from the run centroid, halves
    let contraction = NaN;
    if (cells.length >= 4) {
      const cx = cells.reduce((a, e) => a + e.cx, 0) / cells.length;
      const cy = cells.reduce((a, e) => a + e.cy, 0) / cells.length;
      const dist = (e) => Math.hypot(e.cx - cx, e.cy - cy);
      const d1 = cells.slice(0, half).map(dist);
      const d2 = cells.slice(half).map(dist);
      contraction = (d1.reduce((a, b) => a + b, 0) / d1.length) - (d2.reduce((a, b) => a + b, 0) / d2.length);
    }
    const meanNut = cells.length ? cells.reduce((a, e) => a + e.nut, 0) / cells.length : NaN;
    const verdict = cells.length < 8 ? 'THIN (n<8 — read cautiously)'
      : (fresh >= second.size * 0.5 && revisit < 0.4) ? 'DISCOVERY (expanding frontier)'
      : (revisit >= 0.4 || (Number.isFinite(contraction) && contraction > 0)) ? 'COLLAPSE (contracting/revisiting)'
      : 'MIXED';
    console.log(`  spatial: events=${cells.length} unique=${uniq.size} revisit-rate=${(revisit * 100).toFixed(0)}% ` +
      `fresh-in-2nd-half=${fresh}/${second.size} centroid-contraction=${Number.isFinite(contraction) ? contraction.toFixed(2) : 'n/a'} ` +
      `mean-nut@event=${Number.isFinite(meanNut) ? meanNut.toFixed(2) : 'n/a'} → ${verdict}`);
    console.log(`  starvation: driveFailed=${r.driveFailed} driveStarved(no soil in ${240}px)=${r.driveStarved}`);
  }
}

// --- Probe B ----------------------------------------------------------------
function quantumProbe() {
  console.log('=== R7 probe B: double-quantum counterfactual (6000 ticks, live vs frozen) ===');
  const TICKS = 6000;
  for (const seed of SEEDS) {
    const rows = [];
    for (const quantum of [1, 2]) {
      for (const frozen of [false, true]) {
        rows.push(runWorld(seed, { ticks: TICKS, quantum, frozen }));
      }
    }
    const at = (q, f) => rows.find((r) => r.quantum === q && r.frozen === f);
    const dGeo = (q) => {
      const l = at(q, false), fr = at(q, true);
      if (!Number.isFinite(l.meanBilled) || !Number.isFinite(fr.meanBilled) || fr.meanBilled === 0) return NaN;
      return Math.abs(l.meanBilled - fr.meanBilled) / fr.meanBilled;
    };
    for (const r of rows) {
      console.log(`seed ${seed} q=${r.quantum} ${r.frozen ? 'frozen' : 'live'}: ` +
        `events=${r.events} meanBilled=${Number.isFinite(r.meanBilled) ? r.meanBilled.toFixed(3) : 'n/a'} ` +
        `meanEff=${Number.isFinite(r.meanEff) ? r.meanEff.toFixed(3) : 'n/a'} totalBilled=${r.totalBilled.toFixed(2)}`);
    }
    const l1 = at(1, false), l2 = at(2, false);
    const scaleRatio = (Number.isFinite(l1.meanBilled) && Number.isFinite(l2.meanBilled) && l1.meanBilled > 0)
      ? l2.meanBilled / l1.meanBilled : NaN;
    const evRatio = (l1.events > 0) ? l2.events / l1.events : NaN;
    // Pre-committed read: mean billed/event ratio in [1.7, 2.3] = the
    // billed number follows the quantum (settlement-bound); ratio ~1.0 =
    // the constraint lives upstream in targeting.
    const read = !Number.isFinite(scaleRatio) ? 'NO-EVENTS'
      : (scaleRatio >= 1.7 && scaleRatio <= 2.3) ? 'SETTLEMENT-BOUND (quantum is the cap)'
      : (scaleRatio >= 0.85 && scaleRatio <= 1.15) ? 'UPSTREAM (flat — targeting constraint)' : 'MIXED';
    console.log(`  → billed/event ratio q2/q1 = ${Number.isFinite(scaleRatio) ? scaleRatio.toFixed(2) : 'n/a'} ` +
      `event-count ratio = ${Number.isFinite(evRatio) ? evRatio.toFixed(2) : 'n/a'} → ${read}`);
    console.log(`  → Δgeo(live−frozen) q=1: ${(dGeo(1) * 100).toFixed(1)}%   q=2: ${(dGeo(2) * 100).toFixed(1)}%`);
  }
}

const mode = process.argv[2] || 'depth';
if (mode === 'depth') depthProbe(Number(process.argv[3] || 12000));
else if (mode === 'quantum') quantumProbe();
else { console.error('usage: geo-r7-probes.mjs [depth [ticks] | quantum]'); process.exit(2); }
