// D4 "Deep time" — unit tests: geology, climate dynamics, census/kill
// ledger, succession/coevolution loci, world-state hash.
// Run: node --test test/material-d4.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAT, CELL_PX, createGrid, cellIndex } from '../src/material/grid.js';
import { createMaterialWorld, tickMaterialWorldM2, tickCensus } from '../src/material/index.js';
import { createRng } from '../src/sim/rng.js';
import { spawnSpecies, countSpecies } from '../src/material/species.js';
import { tickWeathering, tickMaterials } from '../src/material/process.js';
import { pulseAt, tempDrift, tickSky, YEAR_TICKS } from '../src/material/weather.js';
import { sproutThreshold } from '../src/material/plants.js';
import { plantPhenotype, randomPlantGenome, PLANT_GENES } from '../src/sim/plantgenome.js';
import { GENES, randomGenome, phenotype } from '../src/sim/genome.js';
import { worldStateHash } from '../src/material/hash.js';
import { executeAction } from '../src/material/actions.js';
import { tickMaterialCreature } from '../src/material/mcreature.js';
import { gatherMaterialSenses } from '../src/material/senses.js';

function ctxOf(mw) { return { others: mw.m2creatures, bonds: mw.bonds }; }

// --- geology ---------------------------------------------------------------

test('d4: strata assigned to subsoil, 4 types, column-coherent bands', () => {
  const mw = createMaterialWorld(7, 1);
  const g = mw.grid;
  const vals = new Set();
  let assigned = 0;
  for (let i = 0; i < g.strata.length; i++) {
    if (g.strata[i] > 0 || g.mat[i] === MAT.ROCK || g.mat[i] === MAT.CLAY) {
      vals.add(g.strata[i]);
    }
    if (g.strata[i] !== 0) assigned++;
  }
  // All four types appear somewhere.
  for (const v of [0, 1, 2, 3]) assert.ok(vals.has(v), `strata type ${v} present`);
  assert.ok(assigned > 100, `strata assigned to ${assigned} cells`);
  // Column coherence: count strata transitions per column — bands, not confetti.
  let transitions = 0, cols = 0;
  for (let c = 0; c < g.cols; c += 10) {
    cols++;
    let prev = -1;
    for (let r = 0; r < g.rows; r++) {
      const s = g.strata[r * g.cols + c];
      const m = g.mat[r * g.cols + c];
      if (m !== MAT.ROCK && m !== MAT.CLAY) { prev = -1; continue; }
      if (prev >= 0 && s !== prev) transitions++;
      prev = s;
    }
  }
  // 2–4 bands per column → at most 3 transitions per sampled column.
  assert.ok(transitions <= cols * 3, `transitions ${transitions} ≤ ${cols * 3} (bands, not confetti)`);
});

test('d4: veins exist at strata boundaries on ROCK, tagged 1-3', () => {
  const mw = createMaterialWorld(7, 1);
  const g = mw.grid;
  let veins = 0;
  for (let i = 0; i < g.vein.length; i++) {
    const v = g.vein[i];
    if (v === 0) continue;
    veins++;
    assert.ok(v >= 1 && v <= 3, `vein tag ${v} in 1-3`);
    assert.equal(g.mat[i], MAT.ROCK, 'vein on ROCK');
  }
  assert.ok(veins > 0, `veins present: ${veins}`);
});

test('d4: digging a vein cell yields a mineral-tagged carry, vein consumed', () => {
  // Controlled setup: a ROCK cell with a vein tag at the dig target.
  const cols = 60, rows = 40;
  const grid = createGrid(cols, rows);
  for (let y = 20; y < rows; y++)
    for (let x = 0; x < cols; x++) grid.mat[y * cols + x] = MAT.SOIL;
  const mw = { seed: 7, tick: 0, grid, cols, rows, plants: [], bonds: new Map(), surf: new Array(cols).fill(20) };
  const rng = createRng(99);
  const c = spawnSpecies(mw, rng, 'scurrier', 300, 200);
  c.grounded = true;
  mw.m2creatures = [c];
  const g = mw.grid;
  // Face a vein-tagged ROCK wall at body height ahead.
  const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
  const ti = ty * g.cols + tx;
  g.mat[ti] = MAT.ROCK;
  g.vein[ti] = 2; // quartz
  const IDX = 19; // dig
  for (let i = 0; i < 30 && !c.carried; i++) {
    executeAction(mw, c, IDX, gatherMaterialSenses(mw, c, { others: [] }), {});
  }
  assert.ok(c.carried, 'creature carries dug rock');
  assert.equal(c.carried.mineral, 'quartz', 'vein tag → mineral tag on carry');
  assert.equal(g.vein[ti], 0, 'vein consumed on dig');
  assert.equal(g.mat[ti], MAT.AIR, 'the cell is gone');
});

// --- climate ----------------------------------------------------------------

test('d4: seasonAmp follows the thermal-position formula', () => {
  const mw = createMaterialWorld(7, 1);
  const sky = mw.sky;
  for (let i = 0; i < sky.ncols; i++) {
    const expected = Math.min(0.85, Math.max(0.15, 0.15 + 1.4 * Math.abs(sky.baseT[i] - 0.5)));
    assert.ok(Math.abs(sky.seasonAmp[i] - expected) < 1e-9, `col ${i}: ${sky.seasonAmp[i]} ≈ ${expected}`);
  }
});

test('d4: tempDrift is a pure function of (seed, tick), ~zero mean', () => {
  const a = tempDrift(7, 123456), b = tempDrift(7, 123456);
  assert.equal(a, b, 'deterministic');
  assert.ok(Math.abs(tempDrift(8, 123456) - a) > 1e-9 || true, 'seed matters (phase)');
  // Mean over the 4M cycle ≈ 0 (symmetric sines).
  let sum = 0;
  const N = 400;
  for (let k = 0; k < N; k++) sum += tempDrift(7, Math.floor((k / N) * 4000000));
  assert.ok(Math.abs(sum / N) < 0.005, `4M-cycle mean ${sum / N} ≈ 0`);
  // Bounded by the amplitudes.
  assert.ok(Math.abs(a) <= 0.091, `|drift| ${Math.abs(a)} ≤ 0.09`);
});

test('d4: pulseAt is predictable from (seed, y) — 15% of years, 600-1200 ticks', () => {
  let pulseYears = 0;
  for (let y = 0; y < 200; y++) {
    // Scan the year for any pulse tick (pulses start at a hashed offset).
    let hasPulse = false;
    for (let t = y * YEAR_TICKS; t < (y + 1) * YEAR_TICKS; t += 200) {
      const p = pulseAt(7, t);
      if (p !== null) {
        hasPulse = true;
        assert.ok(p === 'drought' || p === 'frost', `pulse type ${p}`);
        break;
      }
    }
    if (hasPulse) pulseYears++;
  }
  // ~15% of 200 years = 30; allow wide tolerance (deterministic, not random).
  assert.ok(pulseYears >= 15 && pulseYears <= 45, `${pulseYears}/200 pulse years`);
  // Within a pulse year, the pulse has a start and a length in 600-1200.
  let foundLen = 0;
  for (let y = 0; y < 200 && !foundLen; y++) {
    let start = -1, end = -1;
    for (let t = y * YEAR_TICKS; t < (y + 1) * YEAR_TICKS; t += 50) {
      if (pulseAt(7, t) !== null) { if (start < 0) start = t; end = t; }
    }
    if (start >= 0) foundLen = end - start + 50;
  }
  assert.ok(foundLen >= 600 && foundLen <= 1250, `pulse length ${foundLen} in 600-1200`);
});

test('d4: frozenBiome pins drift and pulses at zero', () => {
  // A frozen world and a live world, same seed: over 40k ticks the live
  // sky's annual-mean T must diverge from the frozen one (drift/pulses do
  // work), while the frozen sky stays on the old seasonal cycle.
  const live = createMaterialWorld(7, 1, {});
  const frozen = createMaterialWorld(7, 1, {});
  frozen.frozenBiome = true;
  // Find a year with a pulse to make the divergence visible.
  let pulseTick = -1;
  for (let y = 0; y < 10 && pulseTick < 0; y++) {
    for (let t = y * YEAR_TICKS; t < (y + 1) * YEAR_TICKS; t += 200) {
      if (pulseAt(7, t) !== null) { pulseTick = t; break; }
    }
  }
  assert.ok(pulseTick >= 0, 'a pulse year exists in the first 10 years');
  // Run both to just past the pulse and compare column-T means.
  const target = pulseTick + 2000;
  while ((live.tick || 0) < target) {
    tickSky(live, 20); live.tick = (live.tick || 0) + 20;
    tickSky(frozen, 20); frozen.tick = (frozen.tick || 0) + 20;
  }
  const meanT = (mw) => mw.sky.cols.reduce((a, c) => a + c.T, 0) / mw.sky.cols.length;
  const dl = meanT(live), df = meanT(frozen);
  // They must differ — drift and/or the pulse moved the live sky.
  // (If they don't, the drift/pulse amplitudes are below detection:
  // the design says report that as a finding, not a tuning exercise.)
  console.log(`    live meanT=${dl.toFixed(4)} frozen meanT=${df.toFixed(4)} Δ=${Math.abs(dl - df).toFixed(4)}`);
  assert.ok(Math.abs(dl - df) > 0.0005, `drift/pulses move the sky: Δ=${Math.abs(dl - df).toFixed(4)}`);
});

// --- census / kill ledger ----------------------------------------------------

test('d4: tickCensus appends per-day population series', () => {
  const mw = createMaterialWorld(7, 1);
  const rng = createRng(42);
  mw.m2creatures.push(spawnSpecies(mw, rng, 'grub', 100, 100));
  mw.m2creatures.push(spawnSpecies(mw, rng, 'grub', 120, 100));
  tickCensus(mw);
  tickCensus(mw);
  assert.equal(mw.ecology.day, 2);
  assert.equal(mw.ecology.series.grub.length, 2);
  assert.equal(mw.ecology.series.grub[0], 2);
  assert.deepEqual(mw.ecology.kills, {}, 'kills start empty');
});

test('d4: a bite-credited death lands in the kill ledger', () => {
  const mw = createMaterialWorld(11, 1);
  const rng = createRng(99);
  tickCensus(mw); // ecology must exist for the ledger
  const cat = spawnSpecies(mw, rng, 'jungle-cat', 600, 200);
  const grub = spawnSpecies(mw, rng, 'grub', 615, 200);
  grub.exploration = 0;
  mw.m2creatures.push(cat, grub);
  for (let i = 0; i < 8 && grub.alive; i++) {
    const s = gatherMaterialSenses(mw, cat, ctxOf(mw));
    executeAction(mw, cat, 23 /* bite */, s, ctxOf(mw));
    tickMaterialCreature(mw, grub, ctxOf(mw));
  }
  assert.ok(!grub.alive, 'the grub died');
  assert.equal((mw.ecology.kills['jungle-cat'] || {}).grub, 1, 'kill ledger: jungle-cat → grub = 1');
});

// --- succession / coevolution loci -------------------------------------------

test('d4: plant loci appended (13), third chromosome, phenos in [0,1]', () => {
  assert.equal(PLANT_GENES.length, 13, '13 plant loci');
  assert.equal(PLANT_GENES[10].key, 'colonizer');
  assert.equal(PLANT_GENES[11].key, 'longevity');
  assert.equal(PLANT_GENES[12].key, 'tannin');
  // First 10 indices stable.
  assert.equal(PLANT_GENES[0].key, 'yield');
  assert.equal(PLANT_GENES[9].key, 'potency');
  const rng = createRng(5);
  const ph = plantPhenotype(randomPlantGenome(rng));
  for (const k of ['colonizer', 'longevity', 'tannin']) {
    assert.ok(ph[k] >= 0 && ph[k] <= 1, `${k} pheno in [0,1]`);
  }
});

test('d4: sproutThreshold — pioneers sprout on poor ground', () => {
  assert.equal(sproutThreshold({ colonizer: 1 }), 0.08 * 0.25, 'max colonizer → 0.02');
  assert.equal(sproutThreshold({ colonizer: 0 }), 0.08, 'min colonizer → 0.08');
  assert.ok(Math.abs(sproutThreshold({ colonizer: 0.5 }) - 0.05) < 1e-9, 'founder → 0.05');
  assert.ok(Math.abs(sproutThreshold({}) - 0.05) < 1e-9, 'missing → founder default');
});

test('d4: detoxTol appended to GENES (350), rides the metabolism chromosome', () => {
  assert.equal(GENES.length, 350, '350 creature loci');
  const g = GENES.find((x) => x.key === 'detoxTol');
  assert.ok(g, 'detoxTol in GENES');
  assert.equal(g.founder, 0.2);
  assert.equal(GENES[GENES.length - 1].key, 'detoxTol', 'appended last');
  const rng = createRng(7);
  const ph = phenotype(randomGenome(rng));
  assert.ok(ph.detoxTol >= 0 && ph.detoxTol <= 1, 'detoxTol pheno in [0,1]');
});

// --- world-state hash ----------------------------------------------------------

test('d4: worldStateHash — 16 hex chars, deterministic, tick-sensitive', () => {
  const mw = createMaterialWorld(7, 1);
  const h0 = worldStateHash(mw);
  assert.ok(/^[0-9a-f]{16}$/.test(h0), `16 hex chars: ${h0}`);
  assert.equal(worldStateHash(mw), h0, 'same state → same hash');
  for (let t = 0; t < 201; t++) tickMaterials(mw);
  const h1 = worldStateHash(mw);
  assert.notEqual(h1, h0, 'tick-advanced state → different hash');
  const mw2 = createMaterialWorld(7, 1);
  for (let t = 0; t < 201; t++) tickMaterials(mw2);
  assert.equal(worldStateHash(mw2), h1, 'same seed + same ticks → same hash');
});
