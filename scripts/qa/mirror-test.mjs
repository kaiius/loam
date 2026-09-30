// Mirror-test control for the imitation channel (v0.18 "Realms").
// 
// Question: Is Canopy's vocal/lexicon convergence driven by SOCIAL learning
// (mirror-tracking) or by independent world-tracking?
//
// Method: Lesion the social (imitation) channel — zero the call-heard senses
// in gatherSenses — while keeping the world fixed. If convergence collapses,
// it was mirror-tracking (real social learning). If convergence survives,
// it was world-tracking.
//
// Metrics (on survivors):
//   1. Voice pitch stddev (lower = more converged = more social learning)
//   2. Mean pairwise lexicon distance (lower = more converged)
//
// Verdicts:
//   MIRROR-TRACKING: lesioned divergence >> control divergence
//   WORLD-TRACKING:  no meaningful difference between conditions
//   INCONCLUSIVE:    population extinct in either condition
//
// Implementation: The lesioned condition runs in a SUBPROCESS (fresh module
// cache) against a temporarily patched src/sim/creature.js. The source is
// restored afterward. Control runs in-process on pristine source.
//
// Run: node scripts/qa/mirror-test.mjs [seed] [ticks]
//   Default: seed 1, 2000 ticks.

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const CREATURE_JS = join(ROOT, 'src/sim/creature.js');
const BACKUP = '/tmp/creature-mirror-test.bak';

const seed = parseInt(process.argv[2] || '1', 10);
const ticks = parseInt(process.argv[3] || '2000', 10);

// Inner battery script, run via subprocess for a clean module cache.
// Uses absolute imports (the file lives in /tmp).
const BATTERY_SRC = `
import { createWorld, bindWorld, populate, tickWorld } from '${ROOT}/src/sim/world.js';
import { lexiconDistance } from '${ROOT}/src/sim/language.js';
const seed = parseInt(process.argv[2], 10);
const ticks = parseInt(process.argv[3], 10);
const world = bindWorld(createWorld(seed));
populate(world);
for (let i = 0; i < ticks; i++) tickWorld(world, 0.5);
const alive = world.creatures.filter(c => c.alive && c.voicePitch !== undefined);
if (alive.length < 2) {
  console.log(JSON.stringify({ survivors: alive.length }));
} else {
  const pitches = alive.map(c => c.voicePitch);
  const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  const sd = Math.sqrt(pitches.reduce((a, b) => a + (b - mean) ** 2, 0) / pitches.length);
  let td = 0, pairs = 0;
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    if (alive[i].lexicon && alive[j].lexicon) { td += lexiconDistance(alive[i].lexicon, alive[j].lexicon); pairs++; }
  }
  console.log(JSON.stringify({ survivors: alive.length, pitchStddev: sd, lexDist: pairs ? td / pairs : null }));
}
`;
const BATTERY_FILE = '/tmp/mirror-battery.mjs';
writeFileSync(BATTERY_FILE, BATTERY_SRC);

function runBattery() {
  const out = execSync(`node ${BATTERY_FILE} ${seed} ${ticks}`, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(out.trim());
}

function applyLesion() {
  copyFileSync(CREATURE_JS, BACKUP);
  const marker = 'export function gatherSenses(c, world) {';
  let src = readFileSync(CREATURE_JS, 'utf8');
  const fnStart = src.indexOf(marker);
  if (fnStart === -1) throw new Error('gatherSenses not found');
  const fnEnd = src.indexOf('\nexport function', fnStart + marker.length);
  if (fnEnd === -1) throw new Error('gatherSenses end not found');
  let fnBody = src.slice(fnStart, fnEnd);
  if (!fnBody.includes('return senses;')) throw new Error('gatherSenses return not found');
  fnBody = fnBody.replace(
    'return senses;',
    `// MIRROR-TEST LESION: wipe the imitation channel (call CONTENT), keep
  // social presence (callHeard for comfort, _alarmHeard for fear regulation).
  // This isolates content-copying (vocal/lexicon imitation) from the
  // survival-relevant social glue. World fixed.
  senses.callPitch = 0; senses._heardCall = 0;
  return senses;`
  );
  writeFileSync(CREATURE_JS, src.slice(0, fnStart) + fnBody + src.slice(fnEnd));
}

function restoreSource() {
  copyFileSync(BACKUP, CREATURE_JS);
}

console.log(`Mirror test: seed=${seed}, ticks=${ticks}\n`);

// --- CONTROL: social channel intact (subprocess, pristine source) ---
console.log('Running CONTROL (social intact)...');
const control = runBattery();
console.log(`  Survivors: ${control.survivors}`);
if (control.pitchStddev !== undefined) {
  console.log(`  Pitch stddev: ${control.pitchStddev.toFixed(4)}`);
  console.log(`  Lexicon dist: ${control.lexDist !== null ? control.lexDist.toFixed(4) : 'N/A'}`);
}

// --- LESIONED: wipe the social channel ---
console.log('\nApplying social-channel lesion to src/sim/creature.js...');
applyLesion();
let lesioned;
try {
  console.log('Running LESIONED (social wiped, subprocess)...');
  lesioned = runBattery();
} finally {
  restoreSource();
  console.log('  Source restored.');
}
console.log(`  Survivors: ${lesioned.survivors}`);
if (lesioned.pitchStddev !== undefined) {
  console.log(`  Pitch stddev: ${lesioned.pitchStddev.toFixed(4)}`);
  console.log(`  Lexicon dist: ${lesioned.lexDist !== null ? lesioned.lexDist.toFixed(4) : 'N/A'}`);
}

// --- VERDICT ---
console.log('\n=== VERDICT ===');
let verdict;
if (control.pitchStddev === undefined || lesioned.pitchStddev === undefined) {
  verdict = 'INCONCLUSIVE (population extinct in one or both conditions — cannot measure convergence)';
} else {
  const pitchRatio = lesioned.pitchStddev / Math.max(1e-6, control.pitchStddev);
  const lexRatio = (lesioned.lexDist !== null && control.lexDist !== null && control.lexDist > 1e-6)
    ? lesioned.lexDist / control.lexDist : null;
  console.log(`Pitch stddev ratio (lesioned/control): ${pitchRatio.toFixed(2)}`);
  if (lexRatio !== null) console.log(`Lexicon dist ratio (lesioned/control): ${lexRatio.toFixed(2)}`);
  if (pitchRatio > 1.5) {
    verdict = 'MIRROR-TRACKING: lesioning the social channel collapsed convergence — imitation is real social learning.';
  } else if (pitchRatio < 0.67) {
    verdict = 'UNEXPECTED: lesioned converged MORE than control — investigate.';
  } else {
    verdict = 'WORLD-TRACKING: convergence survived the social lesion — not driven by imitation.';
  }
}
console.log(verdict);
console.log('\n' + JSON.stringify({ seed, ticks, control, lesioned, verdict }, null, 2));
