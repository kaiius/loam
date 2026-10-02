// v0.36 — readings-pins check (ax7's "pins check readings, not just outcomes").
//
// The hole: seed-pinned probes asserted pass/fail, but an emitter change
// quietly doubled a measured number without tripping anything — the pins
// never recorded the numbers. This runner re-runs the pinned probes,
// extracts their quantitative readings, and diffs EXACTLY against
// probes/qa-readings.json. Same seed + same code = same numbers (the sim
// is deterministic), so any delta is a real behavior change, not noise.
// A delta FAILs with expected-vs-got; a legitimate intended change updates
// the manifest with a dated note explaining why (see design/qa-rebaseline.md).
//
// This is release-time tooling (~10 min), not per-commit CI.
// Run: node probes/qa-readings-check.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROBES = new URL('./', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(PROBES + 'qa-readings.json', 'utf8'));

// Gemini review (v0.36): exact-match readings are platform-relative —
// floating-point transcendentals aren't guaranteed bit-identical across
// CPU architectures or JS engines. The manifest records the platform;
// on a different platform the check reports NON-COMPARABLE instead of
// failing (a fail would be a lie about the sim).
const platform = { arch: process.arch, node: process.version };
const manPlat = manifest.platform || {};
if (manPlat.arch && (manPlat.arch !== platform.arch || manPlat.node !== platform.node)) {
  console.log(JSON.stringify({ verdict: 'NON-COMPARABLE',
    reason: 'readings pins are platform-relative',
    manifestPlatform: manPlat, thisPlatform: platform,
    note: 're-run the probes on this platform and record a new manifest section; do not compare across platforms' }, null, 2));
  process.exit(2);
}

function runProbe(cmd) {
  const out = execSync(`node ${PROBES}${cmd}`, { encoding: 'utf8', timeout: 600000 });
  const jsonStart = out.indexOf('{');
  return JSON.parse(out.slice(jsonStart));
}
// flatten {a:{b:1}} → {"a.b":1}
function flat(obj, prefix = '', into = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flat(v, prefix + k + '.', into);
    else if (typeof v === 'number' || typeof v === 'string') into[prefix + k] = v;
  }
  return into;
}

const CHECKS = [
  { cmd: 'seed-voyage.mjs 7', key: 'seed-voyage',
    pick: (j) => flat({ endozoochory: j.endozoochory, hydrochory: j.hydrochory }) },
  { cmd: 'qa-colonization.mjs 7', key: 'qa-colonization',
    pick: (j) => flat({ newcomers: j.newcomers, established: j.established, failed: j.failed }) },
  { cmd: 'pollination-exclosure.mjs 7 6000', key: 'pollination-exclosure',
    pick: (j) => flat({ open: { fruitSet: j.open.fruitSet, pollinatedEvents: j.open.pollinatedEvents },
                        netted: { fruitSet: j.netted.fruitSet, pollinatedEvents: j.netted.pollinatedEvents } }) },
  { cmd: 'qa-pollinator-crash.mjs 7', key: 'qa-pollinator-crash',
    pick: (j) => flat({ control: { fruit2ndHalf: j.control.fruit2ndHalf, pollinated2ndHalf: j.control.pollinated2ndHalf },
                        crash: { fruit2ndHalf: j.crash.fruit2ndHalf, pollinated2ndHalf: j.crash.pollinated2ndHalf,
                                 killed: j.crash.killed } }) },
];

let failures = 0;
const report = [];
for (const c of CHECKS) {
  const expected = manifest.readings[c.key];
  if (!expected) { report.push(`${c.key}: NO MANIFEST ENTRY — cannot pin`); failures++; continue; }
  let got;
  try { got = c.pick(runProbe(c.cmd)); }
  catch (e) { report.push(`${c.key}: PROBE FAILED TO RUN — ${e.message.slice(0, 120)}`); failures++; continue; }
  const exp = flat(expected);
  const keys = new Set([...Object.keys(exp), ...Object.keys(got)]);
  const diffs = [];
  for (const k of keys) {
    if (exp[k] !== got[k]) diffs.push(`${k}: expected ${exp[k]}, got ${got[k]}`);
  }
  if (diffs.length) { failures++; report.push(`${c.key}: READINGS DRIFTED\n    ` + diffs.join('\n    ')); }
  else report.push(`${c.key}: readings pinned (${Object.keys(exp).length} readings, exact)`);
}
console.log(report.join('\n'));
console.log(failures === 0 ? 'READINGS-PINS: all pinned readings exact'
                           : `READINGS-PINS: ${failures} probe(s) drifted — see above`);
process.exit(failures === 0 ? 0 : 1);
