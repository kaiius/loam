// Loam R7 — geophagy economics probes + assert-on-unhandled.
// A: deficit-depth instrumentation (arion's discriminating metric).
// B: double-quantum counterfactual lever (mw.geoQuantumScale).
// C: spatial autocorrelation data + starvation failure-mode counters.
// D: the action table can never declare what the executor can't do —
//    the registry assertion, by construction.
// Run: node --test test/material-r7-geophagy.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMaterialWorld, tickMaterialWorldM2, addFounder } from '../src/material/index.js';
import { executeAction, actionCoverage, soilWithinRange, GEO_LOCOMOTION_PX } from '../src/material/actions.js';
import { ACTIONS } from '../src/material/brain.js';
import { MAT, CELL_PX } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';

// --- D1: the registry covers the whole declared table ---
test('r7: actionCoverage — 33 declared, 33 handled, none missing', () => {
  const cov = actionCoverage();
  assert.equal(cov.declared, ACTIONS.length);
  assert.equal(cov.declared, 33, `ACTIONS has 33 entries, got ${cov.declared}`);
  assert.deepEqual(cov.missing, [], `unhandled actions: ${cov.missing}`);
  assert.equal(cov.handled, 33);
});

// --- D2: the honest holds are exactly the declared-but-unported set ---
test('r7: unported actions are explicit honest holds with reasons', () => {
  const cov = actionCoverage();
  const idx = cov.unported.map((u) => Number(u.split(':')[0])).sort((a, b) => a - b);
  assert.deepEqual(idx, [12, 14, 15, 18, 20, 21, 22, 24, 25, 26, 27, 28, 29],
    `honest-hold set changed: ${idx}`);
  for (const u of cov.unported) assert.ok(u.includes('—'), `reason documented: ${u}`);
});

// --- D3: every declared index dispatches without throwing; unknown throws ---
test('r7: executeAction dispatches 0..32, throws on unregistered', () => {
  const mw = createMaterialWorld(99, 1);
  const rng = createRng(7);
  for (let i = 0; i < 33; i++) {
    const c = addFounder(mw, rng);
    assert.doesNotThrow(() => executeAction(mw, c, i, {}, {}), `action ${i}:${ACTIONS[i]} threw`);
  }
  assert.throws(() => executeAction(mw, addFounder(mw, rng), 999, {}, {}), /no executor/,
    'unregistered action must throw, not hold silently');
  assert.throws(() => executeAction(mw, addFounder(mw, rng), -1, {}, {}), /no executor/);
});

// --- D4: honest hold marks the creature, stays visible ---
test('r7: unported dispatch sets _unportedAction (inspector-visible)', () => {
  const mw = createMaterialWorld(99, 1);
  const c = addFounder(mw, createRng(8));
  executeAction(mw, c, 12, {}, {});
  assert.equal(c._unportedAction, 12);
});

// --- A: deficit depth is instrumented and respects the gate ---
test('r7: geophagy events record deficit depth >= the 0.4 gate', () => {
  const mw = createMaterialWorld(31415, 1, { fireOn: true });
  const rng = createRng(((31415 * 7919 + 13) >>> 0) || 1);
  for (let i = 0; i < 4; i++) addFounder(mw, rng);
  for (let t = 0; t < 4000; t++) tickMaterialWorldM2(mw);
  const d = mw.stats.geophagyDeficit || [];
  assert.ok(d.length > 0, 'expected geophagy events on the pinned seed');
  for (const v of d) assert.ok(v >= 0.4 - 1e-9 && v <= 1, `deficit ${v} outside [0.4, 1]`);
  const cells = mw.stats.geophagyCells || [];
  assert.equal(cells.length, d.length, 'one cell record per event');
  for (const e of cells) {
    assert.ok(Number.isFinite(e.t) && Number.isFinite(e.cx) && Number.isFinite(e.cy), 'cell record shape');
    assert.ok(e.nut >= 0 && e.nut <= 1, `nut ${e.nut} outside [0,1]`);
  }
  // effective (post-clamp) uptake can never exceed the billed yield
  assert.ok((mw.stats.geophagyYieldEff || 0) <= (mw.stats.geophagyYield || 0) + 1e-9);
});

// --- B: the quantum lever moves the billed yield linearly ---
test('r7: doubling the quantum doubles the mean billed yield per event', () => {
  const means = [];
  for (const q of [1, 2]) {
    const mw = createMaterialWorld(27182, 1, { fireOn: true });
    mw.geoQuantumScale = q;
    const rng = createRng(((27182 * 7919 + 13) >>> 0) || 1);
    for (let i = 0; i < 4; i++) addFounder(mw, rng);
    for (let t = 0; t < 3000; t++) tickMaterialWorldM2(mw);
    const ev = mw.stats.geophagyEvents || 0;
    assert.ok(ev > 0, `expected events at quantum ${q}`);
    means.push(mw.stats.geophagyYield / ev);
  }
  const ratio = means[1] / means[0];
  assert.ok(ratio > 1.7 && ratio < 2.3, `billed/event ratio ${ratio.toFixed(2)} not ~2x — the quantum is not the cap`);
});

// --- specie: the cell's nutrient stock is never decremented per bite ---
test('r7: geophagy never decrements the cell nutrient stock (no cell-side bottleneck)', () => {
  const mw = createMaterialWorld(4242, 1);
  const g = mw.grid;
  // find a soil cell and stand a deficient creature on it
  let fx = -1, fy = -1;
  outer: for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      if (g.mat[y * g.cols + x] === MAT.SOIL) { fx = x; fy = y; break outer; }
    }
  }
  assert.ok(fx >= 0, 'worldgen must include soil');
  const c = addFounder(mw, createRng(11));
  c.x = fx * CELL_PX + CELL_PX / 2;
  c.y = fy * CELL_PX - 1;
  c.minerals = 0.2;
  const idx = fy * g.cols + fx;
  const before = g.nutrient ? g.nutrient[idx] : 0;
  const ev0 = mw.stats.geophagyEvents || 0;
  executeAction(mw, c, 32, {}, {});
  c.minerals = 0.2; // re-deficient: a second bite
  executeAction(mw, c, 32, {}, {});
  assert.equal(mw.stats.geophagyEvents, ev0 + 2, 'both bites billed');
  if (g.nutrient) assert.equal(g.nutrient[idx], before, 'nutrient stock untouched by bites');
});

// --- C: the starvation failure mode is counted ---
test('r7: drive firing on barren ground counts failed/starved', () => {
  const airGrid = (soilCells) => {
    const cols = 40, rows = 30;
    const mat = new Array(cols * rows).fill(MAT.AIR);
    for (const [x, y] of soilCells) mat[y * cols + x] = MAT.SOIL;
    return { cols, rows, mat, nutrient: new Array(cols * rows).fill(0.5) };
  };
  const mk = (soilCells) => ({ grid: airGrid(soilCells), stats: {}, tick: 0 });
  const c = { minerals: 0.2, x: 20 * CELL_PX, y: 15 * CELL_PX, body: { heightPx: 60 } };
  // all air: failed and starved
  const mw1 = mk([]);
  executeAction(mw1, c, 32, {}, {});
  assert.equal(mw1.stats.geoDriveFailed, 1);
  assert.equal(mw1.stats.geoDriveStarved, 1, 'no soil in range → starved');
  // soil nearby (within GEO_LOCOMOTION_PX): failed but not starved
  const mw2 = mk([[22, 15]]);
  executeAction(mw2, c, 32, {}, {});
  assert.equal(mw2.stats.geoDriveFailed, 1);
  assert.equal(mw2.stats.geoDriveStarved || 0, 0, 'soil in range → not starved');
  assert.ok(soilWithinRange(mw2, c, GEO_LOCOMOTION_PX));
  assert.ok(!soilWithinRange(mw1, c, GEO_LOCOMOTION_PX));
});
