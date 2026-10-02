// v0.36 — sustained-viability trend check (ax7's "slow degradation" item).
//
// The tick-zero viability gate (seed 3 must be VIABLE) guards a failure
// that isn't happening: it only detects NEW breakage. This tool reads the
// release-to-release ledger (probes/qa-viability-ledger.jsonl) and flags
// SLOW degradation: seed-3 births or alive-count dropping >30% vs the
// rolling mean of previous releases, or a VIABLE→EXTINCT flip. A flag
// blocks the release pending investigation — it is not auto-waived.
// The ledger accrues one row per release (written by the release builder;
// the full 12-seed battery is the release-time procedure, seed 3 is the
// per-release minimum). With fewer than 2 prior rows, the tool reports
// "insufficient history" rather than inventing a trend.
// Run: node probes/qa-viability-trend.mjs
import { readFileSync } from 'node:fs';

const PROBES = new URL('./', import.meta.url).pathname;
const rows = readFileSync(PROBES + 'qa-viability-ledger.jsonl', 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => JSON.parse(l));
const withSeed3 = rows.filter((r) => r.seed3 && r.seed3.births !== undefined);

if (withSeed3.length < 2) {
  console.log(JSON.stringify({ verdict: 'INSUFFICIENT HISTORY',
    rows: rows.length, note: 'trend tracking accrues per release; no flag possible yet' }, null, 2));
  process.exit(0);
}
const cur = withSeed3[withSeed3.length - 1];
const prev = withSeed3.slice(0, -1);
const mean = (k) => prev.reduce((a, r) => a + r.seed3[k], 0) / prev.length;
const flags = [];
for (const k of ['births', 'alive']) {
  const m = mean(k), drop = (m - cur.seed3[k]) / m;
  if (drop > 0.3) flags.push(`${k}: ${cur.seed3[k]} vs rolling mean ${m.toFixed(0)} — ${Math.round(drop * 100)}% drop`);
}
if (prev[prev.length - 1].seed3.verdict === 'VIABLE' && cur.seed3.verdict !== 'VIABLE') {
  flags.push(`verdict flip: VIABLE → ${cur.seed3.verdict}`);
}
console.log(JSON.stringify({
  current: { version: cur.version, seed3: cur.seed3 },
  rollingMean: { births: +mean('births').toFixed(0), alive: +mean('alive').toFixed(0), n: prev.length },
  flags, verdict: flags.length ? 'FLAGGED — slow degradation suspected, investigate before release' : 'CLEAN',
}, null, 2));
process.exit(flags.length ? 1 : 0);
