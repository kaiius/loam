// Unit tests for the material-world substrate (M1): src/material/grid.js
// and src/material/process.js. Run: node --test test/material-substrate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_PX, MAT, MAT_PROPS,
  createGrid, cellIndex, inBounds, matAtPx,
} from '../src/material/grid.js';
import {
  tickMaterials, ROT_THRESHOLD, IGNITION_HEAT, BURNING_HEAT,
} from '../src/material/process.js';

const I = (g, x, y) => cellIndex(g, x, y);

function makeMw(cols, rows, opts = {}) {
  return { grid: createGrid(cols, rows), tick: 0, fireOn: true, permanentTunnels: false, ...opts };
}

function tickN(mw, n, opts) {
  for (let t = 0; t < n; t++) tickMaterials(mw, opts);
}

// ================= grid =================

test('grid: createGrid dims and zeroed arrays', () => {
  const g = createGrid(10, 8);
  assert.equal(g.cols, 10);
  assert.equal(g.rows, 8);
  assert.ok(g.mat instanceof Uint8Array);
  assert.ok(g.moist instanceof Float32Array);
  assert.ok(g.root instanceof Uint8Array);
  assert.ok(g.grownId instanceof Uint16Array);
  assert.ok(g.dug instanceof Uint8Array);
  assert.ok(g.heat instanceof Float32Array);
  assert.ok(g.water instanceof Float32Array);
  for (const f of ['mat', 'moist', 'root', 'grownId', 'dug', 'heat', 'water']) {
    assert.equal(g[f].length, 80, f);
    assert.ok(g[f].every((v) => v === 0), `${f} zeroed`);
  }
});

test('grid: MAT ids and MAT_PROPS table', () => {
  assert.deepEqual(
    [MAT.AIR, MAT.SOIL, MAT.SAND, MAT.CLAY, MAT.ROCK, MAT.WOOD, MAT.DEADWOOD, MAT.LEAF, MAT.WATER, MAT.BEDROCK],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(MAT_PROPS[MAT.SOIL].digWork, 3);
  assert.equal(MAT_PROPS[MAT.SOIL].integrity, 3);
  assert.equal(MAT_PROPS[MAT.SAND].digWork, 2);
  assert.equal(MAT_PROPS[MAT.SAND].integrity, 0);
  assert.equal(MAT_PROPS[MAT.CLAY].digWork, 5);
  assert.equal(MAT_PROPS[MAT.CLAY].integrity, 5);
  assert.equal(MAT_PROPS[MAT.ROCK].digWork, 12);
  assert.equal(MAT_PROPS[MAT.ROCK].integrity, 8);
  assert.equal(MAT_PROPS[MAT.WOOD].digWork, 8);
  assert.equal(MAT_PROPS[MAT.WOOD].integrity, 6);
  assert.equal(MAT_PROPS[MAT.DEADWOOD].digWork, 6);
  assert.equal(MAT_PROPS[MAT.DEADWOOD].integrity, 4);
  assert.equal(MAT_PROPS[MAT.LEAF].digWork, 1);
  assert.equal(MAT_PROPS[MAT.LEAF].integrity, 0);
  assert.equal(MAT_PROPS[MAT.WATER].digWork, Infinity);
  assert.equal(MAT_PROPS[MAT.BEDROCK].digWork, Infinity);
  assert.equal(MAT_PROPS[MAT.BEDROCK].integrity, Infinity);
  // solid list: SOIL SAND CLAY ROCK WOOD DEADWOOD BEDROCK
  for (const m of [MAT.SOIL, MAT.SAND, MAT.CLAY, MAT.ROCK, MAT.WOOD, MAT.DEADWOOD, MAT.BEDROCK]) {
    assert.equal(MAT_PROPS[m].solid, true, `mat ${m} solid`);
  }
  for (const m of [MAT.AIR, MAT.LEAF, MAT.WATER]) {
    assert.equal(MAT_PROPS[m].solid, false, `mat ${m} not solid`);
  }
  // climbable: WOOD only (steep-ROCK slope check lives in locomotion)
  assert.equal(MAT_PROPS[MAT.WOOD].climbable, true);
  for (const m of [MAT.SOIL, MAT.ROCK, MAT.DEADWOOD, MAT.AIR]) {
    assert.equal(MAT_PROPS[m].climbable, false, `mat ${m} not climbable`);
  }
  // fertility / flammability / permeability spot checks from the design table
  assert.equal(MAT_PROPS[MAT.SOIL].fertility, 1.0);
  assert.equal(MAT_PROPS[MAT.SAND].permeability, 0.9);
  assert.equal(MAT_PROPS[MAT.DEADWOOD].flammability, 0.9);
  assert.equal(MAT_PROPS[MAT.LEAF].flammability, 0.8);
});

test('grid: cellIndex / inBounds / matAtPx', () => {
  const g = createGrid(10, 8);
  assert.equal(cellIndex(g, 5, 3), 3 * 10 + 5);
  assert.ok(inBounds(g, 0, 0));
  assert.ok(inBounds(g, 9, 7));
  assert.ok(!inBounds(g, 10, 0));
  assert.ok(!inBounds(g, -1, 0));
  assert.ok(!inBounds(g, 0, 8));
  g.mat[I(g, 5, 3)] = MAT.ROCK;
  assert.equal(CELL_PX, 10);
  assert.equal(matAtPx(g, 55, 35), MAT.ROCK); // cell (5,3)
  assert.equal(matAtPx(g, 50, 30), MAT.ROCK); // cell boundary inclusive
  assert.equal(matAtPx(g, 59.9, 39.9), MAT.ROCK);
  assert.equal(matAtPx(g, 60, 30), MAT.AIR); // next cell over
  // out of bounds: below -> BEDROCK, sides/top -> AIR
  assert.equal(matAtPx(g, 55, 80), MAT.BEDROCK);
  assert.equal(matAtPx(g, 55, 85), MAT.BEDROCK);
  assert.equal(matAtPx(g, 55, 1000), MAT.BEDROCK);
  assert.equal(matAtPx(g, -5, 35), MAT.AIR);
  assert.equal(matAtPx(g, 105, 35), MAT.AIR);
  assert.equal(matAtPx(g, 55, -5), MAT.AIR);
});

// ================= slump =================

test('slump: overlong soil span sheds its middle cells', () => {
  const mw = makeMw(12, 6);
  const g = mw.grid;
  // floating soil beam, 5 wide, nothing below
  for (let x = 3; x <= 7; x++) g.mat[I(g, x, 2)] = MAT.SOIL;
  tickMaterials(mw);
  // L=5 > integrity 3 -> middle 2 cells (x=4,5) fall one cell
  assert.equal(g.mat[I(g, 4, 3)], MAT.SOIL, 'middle cell x=4 fell');
  assert.equal(g.mat[I(g, 5, 3)], MAT.SOIL, 'middle cell x=5 fell');
  assert.equal(g.mat[I(g, 3, 2)], MAT.SOIL, 'edge x=3 holds');
  assert.equal(g.mat[I(g, 6, 2)], MAT.SOIL, 'edge x=6 holds');
  assert.equal(g.mat[I(g, 7, 2)], MAT.SOIL, 'edge x=7 holds');
  assert.equal(g.mat[I(g, 4, 2)], MAT.AIR, 'vacated cell is air');
});

test('slump: short spans and bedrock support stay put', () => {
  const mw = makeMw(12, 6);
  const g = mw.grid;
  // 3-wide beam: L=3, not > integrity 3 -> no slump
  for (let x = 3; x <= 5; x++) g.mat[I(g, x, 2)] = MAT.SOIL;
  // soil resting on bedrock floor
  for (let x = 0; x < 12; x++) g.mat[I(g, x, 5)] = MAT.BEDROCK;
  g.mat[I(g, 8, 4)] = MAT.SOIL;
  tickN(mw, 5);
  for (let x = 3; x <= 5; x++) assert.equal(g.mat[I(g, x, 2)], MAT.SOIL, `beam cell x=${x} held`);
  assert.equal(g.mat[I(g, 8, 4)], MAT.SOIL, 'bedrock-supported soil stays');
});

test('slump: sand always falls through open space', () => {
  const mw = makeMw(8, 8);
  const g = mw.grid;
  for (let x = 0; x < 8; x++) g.mat[I(g, x, 7)] = MAT.BEDROCK;
  g.mat[I(g, 3, 1)] = MAT.SAND;
  tickN(mw, 3);
  assert.equal(g.mat[I(g, 3, 4)], MAT.SAND, 'sand fell 3 cells in 3 ticks');
  assert.equal(g.mat[I(g, 3, 1)], MAT.AIR);
  tickN(mw, 10);
  assert.equal(g.mat[I(g, 3, 6)], MAT.SAND, 'sand rests on the bedrock floor');
});

// ================= tunnels =================

function buildTunnel(mw) {
  const g = mw.grid;
  for (let y = 3; y <= 5; y++) for (let x = 0; x < 12; x++) g.mat[I(g, x, y)] = MAT.SOIL;
  for (let x = 0; x < 12; x++) g.mat[I(g, x, 6)] = MAT.BEDROCK;
  for (let x = 4; x <= 7; x++) {
    g.mat[I(g, x, 4)] = MAT.AIR;
    g.dug[I(g, x, 4)] = 1;
  }
}

test('tunnels: permanentTunnels=true freezes the void', () => {
  const mw = makeMw(12, 8, { permanentTunnels: true });
  buildTunnel(mw);
  tickN(mw, 20);
  const g = mw.grid;
  for (let x = 4; x <= 7; x++) {
    assert.equal(g.mat[I(g, x, 4)], MAT.AIR, `tunnel void x=${x} stays open`);
    assert.equal(g.mat[I(g, x, 3)], MAT.SOIL, `ceiling x=${x} never collapses`);
  }
});

test('tunnels: permanentTunnels=false caves the tunnel in (realistic)', () => {
  const mw = makeMw(12, 8, { permanentTunnels: false });
  buildTunnel(mw);
  tickN(mw, 20);
  const g = mw.grid;
  let caved = 0;
  for (let x = 4; x <= 7; x++) if (g.mat[I(g, x, 4)] === MAT.SOIL) caved++;
  assert.ok(caved > 0, `soil slumped into the tunnel (${caved} cells)`);
});

// ================= water =================

function buildBasin(mw) {
  const g = mw.grid;
  // U-shaped rock basin: floor y=6 x=2..9, walls x=2 and x=9 y=3..5
  for (let x = 2; x <= 9; x++) g.mat[I(g, x, 6)] = MAT.ROCK;
  for (let y = 3; y <= 5; y++) {
    g.mat[I(g, 2, y)] = MAT.ROCK;
    g.mat[I(g, 9, y)] = MAT.ROCK;
  }
  for (let x = 0; x < 12; x++) g.mat[I(g, x, 7)] = MAT.BEDROCK;
}

test('water: pools in a rock basin and levels out', () => {
  const mw = makeMw(12, 8);
  buildBasin(mw);
  const g = mw.grid;
  // pour water above the basin interior
  for (const x of [4, 5, 6]) g.water[I(g, x, 1)] = 1;
  tickN(mw, 150);
  // no water escaped the walls
  for (let y = 0; y < 8; y++) {
    for (const x of [0, 1, 10, 11]) {
      assert.equal(g.water[I(g, x, y)], 0, `no water outside the basin at (${x},${y})`);
    }
  }
  // water pooled on the basin floor and the surface leveled
  const depths = [];
  for (let x = 3; x <= 8; x++) {
    const d = g.water[I(g, x, 5)];
    assert.ok(d > 0.1, `pooled water in column x=${x} (got ${d})`);
    depths.push(d);
  }
  const spread = Math.max(...depths) - Math.min(...depths);
  assert.ok(spread < 0.12, `surface leveled (spread ${spread.toFixed(3)})`);
});

test('water: flows downhill along a ramp', () => {
  const mw = makeMw(16, 8);
  const g = mw.grid;
  // stepped rock ramp descending west->east: floor y = 4 + floor(x/4)
  for (let x = 0; x < 16; x++) {
    const fy = 4 + Math.floor(x / 4);
    for (let y = fy; y < 8; y++) g.mat[I(g, x, y)] = MAT.ROCK;
  }
  // pour at the high (west) end
  for (let x = 0; x <= 3; x++) {
    g.water[I(g, x, 0)] = 1;
    g.water[I(g, x, 1)] = 1;
  }
  tickN(mw, 120);
  let west = 0;
  let east = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) west += g.water[I(g, x, y)];
    for (let x = 8; x < 16; x++) east += g.water[I(g, x, y)];
  }
  assert.ok(east > west, `water migrated downhill (west ${west.toFixed(2)}, east ${east.toFixed(2)})`);
  assert.ok(east > 2, `substantial water reached the low end (${east.toFixed(2)})`);
});

test('water: infiltration raises soil moisture', () => {
  const mw = makeMw(5, 5);
  const g = mw.grid;
  g.mat[I(g, 2, 2)] = MAT.SOIL;
  // rock box: water cannot flow away, only infiltrate
  g.mat[I(g, 1, 2)] = MAT.ROCK;
  g.mat[I(g, 3, 2)] = MAT.ROCK;
  g.mat[I(g, 2, 3)] = MAT.ROCK;
  g.water[I(g, 2, 2)] = 1;
  tickN(mw, 10);
  assert.ok(g.moist[I(g, 2, 2)] > 0.25, `moisture rose (${g.moist[I(g, 2, 2)].toFixed(3)})`);
  assert.ok(g.water[I(g, 2, 2)] < 0.75, `water drained into the soil (${g.water[I(g, 2, 2)].toFixed(3)})`);
  assert.equal(g.mat[I(g, 2, 2)], MAT.SOIL, 'soil keeps its material id');
});

// ================= fire =================

function buildLeafFire(mw) {
  const g = mw.grid;
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) g.mat[I(g, x, y)] = MAT.LEAF;
  g.mat[I(g, 0, 0)] = MAT.LEAF; // control leaf, far away
  g.heat[I(g, 5, 5)] = 1; // ignition
}

test('fire: spreads and consumes leaves with toggle on', () => {
  const mw = makeMw(10, 10, { fireOn: true });
  buildLeafFire(mw);
  tickN(mw, 20);
  const g = mw.grid;
  let burned = 0;
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) {
    if (g.mat[I(g, x, y)] === MAT.AIR) burned++;
  }
  assert.ok(burned >= 2, `fire consumed leaves (${burned}/9 became AIR)`);
  assert.equal(g.mat[I(g, 0, 0)], MAT.LEAF, 'distant control leaf untouched');
  assert.equal(g.heat[I(g, 0, 0)], 0, 'no heat reached the control leaf');
});

test('fire: toggle off — no ignition, no spread, heat decays', () => {
  const mw = makeMw(10, 10, { fireOn: false });
  buildLeafFire(mw);
  tickN(mw, 20);
  const g = mw.grid;
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) {
    assert.equal(g.mat[I(g, x, y)], MAT.LEAF, `leaf (${x},${y}) unburned with fire off`);
  }
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) {
    if (x === 5 && y === 5) continue;
    assert.equal(g.heat[I(g, x, y)], 0, `no spread to (${x},${y})`);
  }
  assert.ok(g.heat[I(g, 5, 5)] < IGNITION_HEAT, 'ignition heat decayed below threshold');
  assert.ok(g.heat[I(g, 5, 5)] < BURNING_HEAT, 'ignition heat decayed below burning');
});

// ================= rot =================

test('rot: damp deadwood becomes soil; dry deadwood persists', () => {
  const mw = makeMw(6, 6, { fireOn: false });
  const g = mw.grid;
  g.mat[I(g, 2, 2)] = MAT.DEADWOOD;
  g.moist[I(g, 2, 2)] = 0.6;
  g.mat[I(g, 3, 3)] = MAT.DEADWOOD;
  g.moist[I(g, 3, 3)] = 0;
  tickN(mw, ROT_THRESHOLD + 100);
  assert.equal(g.mat[I(g, 2, 2)], MAT.SOIL, 'damp deadwood rotted to soil');
  assert.equal(g.mat[I(g, 3, 3)], MAT.DEADWOOD, 'dry deadwood persists');
});

// ================= determinism =================

function buildScenario(mw) {
  const g = mw.grid;
  for (let x = 0; x < 20; x++) g.mat[I(g, x, 11)] = MAT.BEDROCK;
  // soil block with a sand grain on top (will fall)
  for (let y = 8; y <= 10; y++) for (let x = 2; x <= 5; x++) g.mat[I(g, x, y)] = MAT.SOIL;
  g.mat[I(g, 3, 7)] = MAT.SAND;
  // rock basin with water
  for (let x = 10; x <= 15; x++) g.mat[I(g, x, 10)] = MAT.ROCK;
  for (let y = 8; y <= 9; y++) {
    g.mat[I(g, 10, y)] = MAT.ROCK;
    g.mat[I(g, 15, y)] = MAT.ROCK;
  }
  g.water[I(g, 12, 6)] = 1;
  g.water[I(g, 13, 6)] = 1;
  // burning leaves + rotting deadwood
  for (let y = 3; y <= 4; y++) for (let x = 16; x <= 18; x++) g.mat[I(g, x, y)] = MAT.LEAF;
  g.heat[I(g, 17, 3)] = 1;
  g.mat[I(g, 1, 9)] = MAT.DEADWOOD;
  g.moist[I(g, 1, 9)] = 0.8;
}

test('determinism: identical runs give identical arrays', () => {
  const a = makeMw(20, 12);
  const b = makeMw(20, 12);
  buildScenario(a);
  buildScenario(b);
  tickN(a, 60);
  tickN(b, 60);
  for (const f of ['mat', 'moist', 'root', 'grownId', 'dug', 'heat', 'water']) {
    assert.deepEqual(a.grid[f], b.grid[f], `${f} identical across runs`);
  }
  for (const f of ['rot', 'burn', '_fall']) {
    assert.deepEqual(a[f], b[f], `aux ${f} identical across runs`);
  }
  assert.equal(a.tick, b.tick);
});
