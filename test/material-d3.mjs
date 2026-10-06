// D3 execution probes as unit tests: char timing, smolder/re-flare,
// creep conservation, weathering founder-off, texture founder identities.
// Run: node --test test/material-d3.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAT, MAT_PROPS, createGrid, cellIndex } from '../src/material/grid.js';
import {
  tickMaterials, CREEP_K, WEATHER_TICKS, FUEL_K, WIND_SPREAD_K,
  CHAR_TICKS, CHAR_BURN,
} from '../src/material/process.js';
import {
  FRICTION_K, IMPACT_K, DIG_HARD_K, WEAR_K, BRITTLE_K,
} from '../src/material/thermo.js';
import { ambientAt, TORPOR_T, K_BASE } from '../src/material/thermo.js';

function makeMw(cols, rows, opts = {}) {
  return { grid: createGrid(cols, rows), tick: 0, fireOn: true, permanentTunnels: false, ...opts };
}
function tickN(mw, n) { for (let t = 0; t < n; t++) tickMaterials(mw); }
const I = (g, x, y) => cellIndex(g, x, y);

// ---------- MAT.CHAR ----------
test('d3: MAT.CHAR is 10 (append-only) and has full MAT_PROPS row', () => {
  assert.equal(MAT.CHAR, 10);
  const p = MAT_PROPS[MAT.CHAR];
  assert.ok(p, 'CHAR row exists');
  assert.equal(Object.keys(p).length, 11); // 7 base + friction/hardness/brittleness/durability
  assert.ok(p.flammability > 0.2 && p.flammability < 0.9);
});

// ---------- char timing ----------
test('d3: WOOD burns 30 ticks as CHAR then 30 as DEADWOOD (timing-neutral 60)', () => {
  const mw = makeMw(10, 10);
  const g = mw.grid, i = I(g, 5, 5);
  g.mat[i] = MAT.WOOD; g.moist[i] = 0;
  // sustain heat (a real fire front keeps feeding heat); burn needs 30 ticks > 0.7
  for (let t = 0; t < 35; t++) { g.heat[i] = Math.max(g.heat[i], 1); tickMaterials(mw); }
  assert.equal(g.mat[i], MAT.CHAR, 'WOOD -> CHAR after 30 burn ticks');
  assert.equal(mw.phase[i], 1);
  for (let t = 0; t < 35; t++) { g.heat[i] = Math.max(g.heat[i], 1); tickMaterials(mw); }
  assert.equal(g.mat[i], MAT.DEADWOOD, 'CHAR -> DEADWOOD after 30 more ticks (60 total, timing-neutral)');
  for (let t = 0; t < 35; t++) { g.heat[i] = Math.max(g.heat[i], 1); tickMaterials(mw); }
  assert.equal(g.mat[i], MAT.SOIL, 'DEADWOOD -> SOIL after 30 more ticks');
});

// ---------- smolder / re-flare ----------
test('d3: flaming -> smoldering when heat drops, smolder accumulates', () => {
  const mw = makeMw(10, 10);
  const g = mw.grid, i = I(g, 5, 5);
  g.mat[i] = MAT.WOOD; g.moist[i] = 0;
  g.heat[i] = 0.6; // above ignition gate, below smolder threshold soon
  tickN(mw, 1);
  assert.equal(mw.phase[i], 1);
  // let heat decay below 0.35 without re-ignition (isolated cell, no fuel around)
  tickN(mw, 20);
  assert.equal(mw.phase[i], 2, 'phase 1 -> 2 when heat < 0.35');
  assert.ok(mw.smolder[i] > 0, 'smolder timer set');
  const s0 = mw.smolder[i];
  tickN(mw, 10);
  assert.ok(mw.smolder[i] > s0, 'smolder accumulates at 0.25/tick');
});

test('d3: re-flare is deterministic (same seed -> same tick)', () => {
  function run() {
    const mw = makeMw(12, 12);
    const g = mw.grid, i = I(g, 6, 6);
    g.mat[i] = MAT.WOOD; g.moist[i] = 0.1;
    g.heat[i] = 1;
    let reflare = -1;
    tickMaterials(mw); // allocate phase aux
    for (let t = 0; t < 200; t++) {
      const was = mw.phase[i];
      tickMaterials(mw);
      if (was === 2 && mw.phase[i] === 1) { reflare = t; break; }
    }
    return reflare;
  }
  const a = run(), b = run();
  assert.equal(a, b, 're-flare tick identical across runs');
});

// ---------- creep conservation ----------
test('d3: creep conserves per-material counts on a slope', () => {
  const mw = makeMw(30, 20, { creepK: 0.02 });
  const g = mw.grid;
  for (let x = 0; x < 30; x++) {
    for (let y = 17; y < 20; y++) g.mat[I(g, x, y)] = MAT.BEDROCK;
    const surf = x < 15 ? 10 : 14;
    for (let y = surf; y < 17; y++) { g.mat[I(g, x, y)] = MAT.SOIL; g.moist[I(g, x, y)] = 0.5; }
  }
  const counts = () => {
    const c = new Array(11).fill(0);
    for (let k = 0; k < g.mat.length; k++) c[g.mat[k]]++;
    return c;
  };
  const c0 = counts();
  tickN(mw, 2000);
  assert.deepEqual(counts(), c0, 'creep relocates whole cells, counts bit-identical');
});

// ---------- weathering founder-off ----------
test('d3: weathering disabled at founder (WEATHER_TICKS = Infinity)', () => {
  assert.equal(WEATHER_TICKS, Infinity);
  assert.equal(CREEP_K, 0);
  const mw = makeMw(10, 10, { fireOn: false }); // no weatherTicks -> founder
  const g = mw.grid;
  for (let x = 3; x <= 6; x++) for (let y = 3; y <= 6; y++) {
    g.mat[I(g, x, y)] = MAT.ROCK; g.moist[I(g, x, y)] = 0.9;
  }
  tickN(mw, 5000);
  for (let x = 3; x <= 6; x++) for (let y = 3; y <= 6; y++)
    assert.equal(g.mat[I(g, x, y)], MAT.ROCK, 'no weathering at founder');
  assert.equal(mw.weather, undefined, 'weather aux never allocated at founder');
});

// ---------- texture founder identities ----------
test('d3: texture constants are founder-zero', () => {
  assert.equal(FRICTION_K, 0);
  assert.equal(IMPACT_K, 0);
  assert.equal(DIG_HARD_K, 0);
  assert.equal(WEAR_K, 0);
  assert.equal(BRITTLE_K, 0);
  assert.equal(FUEL_K, 0);
  assert.equal(WIND_SPREAD_K, 0.12);
  assert.equal(CHAR_TICKS + CHAR_BURN, 60);
});

test('d3: thermo pure functions behave (ambient, torpor threshold)', () => {
  const mw = makeMw(10, 10);
  mw.tick = 0;
  // at tick 0, mid-height: T_BASE + 0 - T_LAPSE*(1-0.5) = 0.5 - 0.075 = 0.425
  const t = ambientAt(mw, 50, 50);
  assert.ok(Math.abs(t - 0.425) < 1e-9, `ambient ${t}`);
  assert.equal(TORPOR_T, 0.25);
  assert.ok(K_BASE > 0);
});
