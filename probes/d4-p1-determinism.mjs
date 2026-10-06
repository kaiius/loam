// D4 P1 — Deep-time determinism.
// Same seed, 100k-tick run, twice → identical worldStateHash at every
// 10k-tick checkpoint. 3 seeds.
// FAILS if any checkpoint hash differs (stream leaks, per-tick RNG,
// unordered iteration).
//
// IMPORTANT: the two runs of each seed execute in SEPARATE node processes.
// Creature IDs come from a module-level counter, so two worlds built in one
// process get different IDs (and different per-creature RNG streams). Across
// processes — the "across runs" of the determinism contract — module state
// resets and the worlds are identical.
// Run: node probes/d4-p1-determinism.mjs
import { spawn } from 'node:child_process';

const SEEDS = [7, 42, 1234];
const TICKS = 100000;
const EVERY = 10000;

function runSeed(seed) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['probes/d4-p1-worker.mjs', String(seed), String(TICKS), String(EVERY)], {
      cwd: '/home/hatch/workspace/canopy-v020',
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { process.stderr.write(d); });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`worker seed ${seed} exited ${code}`));
      else resolve(JSON.parse(out));
    });
  });
}

let failures = 0;
for (const seed of SEEDS) {
  console.log(`seed ${seed}: run 1...`);
  const h1 = await runSeed(seed);
  console.log(`seed ${seed}: run 2...`);
  const h2 = await runSeed(seed);
  for (let i = 0; i < h1.length; i++) {
    const ok = h1[i].hash === h2[i].hash;
    if (!ok) failures++;
    console.log(`  tick ${h1[i].tick}: ${ok ? 'MATCH' : `MISMATCH ${h1[i].hash} vs ${h2[i].hash}`}`);
  }
}
console.log(failures === 0 ? 'P1 PASS — deep-time determinism holds' : `P1 FAIL — ${failures} checkpoint mismatches`);
process.exit(failures === 0 ? 0 : 1);
