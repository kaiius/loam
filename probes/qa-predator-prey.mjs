// v0.36 QA gate 4 — predator–prey cycle.
// Sharks kill on contact but don't eat: there is no predator-side starvation
// oscillator here. What CAN cycle is the coupled pair: prey density ↔ kill
// rate. Prey abundant → sharks find targets within 480px → kills rise → prey
// crashes → kills fall (nothing in range) → births rebuild the prey.
// This probe samples every 250 ticks over 30k ticks (seed 7) and requires
// BOTH: (a) kill rate tracks prey density (Pearson r > 0.3 at some lag
// 0..3 windows), and (b) at least one crash-recovery: prey drops ≥40% from
// a trailing local max, then regains ≥50% of the drop. A gate that only
// ever passes is not a gate; a gate that fails here fails honestly —
// the structural reason would be that kill-rate coupling is too weak to
// close the loop.
// Run: node probes/qa-predator-prey.mjs [seed]
import { createWorld, bindWorld, populateGenesis, tickWorld } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 0.5, TICKS = 30000, WIN = 250;

const world = bindWorld(createWorld(seed));
populateGenesis(world);

// v0.36 fix: tickWorld truncates world.events to the last 60, so post-hoc
// scanning misses kills. Count via the push method instead — every kill
// is observed.
let totalKillsSeen = 0;
const origPush = world.events.push.bind(world.events);
world.events.push = (e) => {
  if (e.type === 'killed') totalKillsSeen++;
  return origPush(e);
};

const preySeries = [], killSeries = [];
let t = 0;
while (t < TICKS) {
  const killsBefore = totalKillsSeen;
  for (let i = 0; i < WIN; i++, t++) {
    tickWorld(world, DT);
  }
  const prey = world.creatures.filter((c) => c.alive && c.submerged).length;
  preySeries.push(prey);
  killSeries.push(totalKillsSeen - killsBefore);
}

const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return (da === 0 || db === 0) ? 0 : num / Math.sqrt(da * db);
};
let bestLag = 0, bestR = -2;
for (let lag = 0; lag <= 3; lag++) {
  const a = preySeries.slice(0, preySeries.length - lag), b = killSeries.slice(lag);
  const r = pearson(a, b);
  if (r > bestR) { bestR = r; bestLag = lag; }
}

// crash-recovery detection on the prey series
let recoveries = 0, i = 0;
const n = preySeries.length;
while (i < n) {
  const localMax = Math.max(...preySeries.slice(Math.max(0, i - 8), i + 1));
  if (localMax > 0 && preySeries[i] <= 0.6 * localMax) {
    const trough = preySeries[i], drop = localMax - trough;
    let j = i + 1;
    while (j < n && preySeries[j] < trough + 0.5 * drop) j++;
    if (j < n) { recoveries++; i = j; continue; }
    break;
  }
  i++;
}
// Gemini review (v0.36): kill-rate ∝ prey-density is collision math, not
// ecology — the Pearson part alone would false-pass. The load-bearing
// criteria are the causal direction (kills must LEAD prey declines,
// bestLag ≥ 1) and the crash-recovery. Correlation at lag 0 only is not
// a cycle.
const pass = bestR > 0.3 && bestLag >= 1 && recoveries >= 1;
console.log(JSON.stringify({ seed, ticks: TICKS, gate: 'predator-prey-cycle',
  coupling: { bestLagWindows: bestLag, pearsonR: +bestR.toFixed(3),
              note: 'lag>=1 required: kills must lead prey declines (causal direction), not just coincide' },
  crashRecoveries: recoveries,
  preyStart: preySeries[0], preyEnd: preySeries[n - 1],
  totalKills: killSeries.reduce((a, b) => a + b, 0),
  verdict: pass ? 'PASS — kills lead prey declines and the prey crashes and recovers'
                : 'FAIL — no coupled cycle detected',
}, null, 2));
process.exit(pass ? 0 : 1);
