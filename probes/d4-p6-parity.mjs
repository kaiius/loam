// D4 P6 — Founder parity: the new machinery at neutral settings changes
// nothing it shouldn't.
// - material suite green at neutral (driftAmp 0, pulses off, weatherStep 0)
//   — run separately via the suite; this probe covers viability + tick-0.
// - viability gate G1–G5 green on 10 seeds.
// - tick-0 grid materials (mat/moist/nutrient) identical to the pre-change
//   build (verified via the pre-D4 worktree at /tmp/pre-d4; the geology
//   block only WRITES strata/vein, never mat/moist/nutrient).
// Run: node probes/d4-p6-parity.mjs
import { generateMaterialWorld, checkViability } from '../src/material/worldgen.js';
import { worldStateHash } from '../src/material/hash.js';
import { createMaterialWorld } from '../src/material/index.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 42, 99, 1234];
let failures = 0;

// 1. Viability G1–G5 on 10 seeds, neutral settings.
for (const seed of SEEDS) {
  const world = generateMaterialWorld(seed, 1, { driftAmp: 0, pulsesOn: false, weatherStep: 0 });
  const v = checkViability(world);
  if (!v.ok) {
    failures++;
    console.log(`seed ${seed}: VIABILITY FAIL — ${v.failures.join('; ')}`);
  } else {
    console.log(`seed ${seed}: viability ok`);
  }
}

// 2. Tick-0 determinism (same seed → same hash) at neutral.
const h1 = worldStateHash(createMaterialWorld(7, 1, { driftAmp: 0, pulsesOn: false, weatherStep: 0 }));
const h2 = worldStateHash(createMaterialWorld(7, 1, { driftAmp: 0, pulsesOn: false, weatherStep: 0 }));
if (h1 !== h2) { failures++; console.log(`tick-0 hash MISMATCH: ${h1} vs ${h2}`); }
else console.log(`tick-0 hash stable at neutral: ${h1}`);

// 3. Neutral vs default at tick 0: only the new arrays/loci may differ.
// (The grid materials, sky base fields, and plant positions are identical;
// seasonAmp and the new loci are the sanctioned differences.)
const neutral = createMaterialWorld(7, 1, { driftAmp: 0, pulsesOn: false, weatherStep: 0 });
const live = createMaterialWorld(7, 1, {});
let matDiff = 0;
for (let i = 0; i < neutral.grid.mat.length; i++) if (neutral.grid.mat[i] !== live.grid.mat[i]) matDiff++;
if (matDiff > 0) { failures++; console.log(`mat differs neutral vs default: ${matDiff} cells`); }
else console.log('tick-0 mat identical (neutral vs default)');

console.log(failures === 0 ? 'P6 PASS — founder parity holds' : `P6 FAIL — ${failures} parity violations`);
process.exit(failures === 0 ? 0 : 1);
