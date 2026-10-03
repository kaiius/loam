// Tests for the material-world M1 locomotion + creature layer:
//   src/material/locomotion.js, src/material/creature.js
// Run: node --test test/material-creature.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_PX, MAT, MAT_PROPS,
  createGrid, cellIndex,
} from '../src/material/grid.js';
import {
  sampleMat, isSolid, isClimbable, isClimbableAt,
  supportBelow, surfaceNormal, headroom,
} from '../src/material/locomotion.js';
import {
  spawnCreature, tickCreature, sense43_45,
  BODY_H, BODY_W, LEG_LENGTH, WALK_SPEED, DIG_POWER,
  SENSE_DIG_AHEAD, SENSE_SOIL_BELOW, SENSE_ENCLOSED,
} from '../src/material/creature.js';

// ---------- world builders (hand-built, no worldgen) ----------

function makeMw(cols, rows) {
  return { grid: createGrid(cols, rows), tick: 0, fireOn: false, permanentTunnels: true };
}

function fillRect(g, x0, y0, x1, y1, mat) { // cell coords, inclusive
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++)
      g.mat[cellIndex(g, cx, cy)] = mat;
}

// Flat soil plain: rows surfaceRow..rows-1 are SOIL, the rest AIR.
function flatWorld(cols = 120, rows = 40, surfaceRow = 30) {
  const mw = makeMw(cols, rows);
  fillRect(mw.grid, 0, surfaceRow, cols - 1, rows - 1, MAT.SOIL);
  return mw;
}

// Flat world with a wall block ahead of the spawn point (500, 300):
// cols 52..54, rows 25..29 — the dig target cell is (52, 27).
function digWorld(wallMat) {
  const mw = flatWorld(60, 40, 30);
  fillRect(mw.grid, 52, 25, 54, 29, wallMat);
  return mw;
}

// ================= locomotion queries =================

test('sampleMat reads the substrate in pixel coords', () => {
  const mw = flatWorld(60, 40, 30);
  assert.equal(sampleMat(mw, 50, 295), MAT.AIR);
  assert.equal(sampleMat(mw, 50, 305), MAT.SOIL);
  assert.equal(sampleMat(mw, 50, 5000), MAT.BEDROCK); // below grid
  assert.equal(sampleMat(mw, -50, 100), MAT.AIR);     // sides
  assert.equal(sampleMat(mw, 50, -50), MAT.AIR);      // top
});

test('isSolid matches the material table', () => {
  for (const m of [MAT.SOIL, MAT.SAND, MAT.CLAY, MAT.ROCK, MAT.WOOD, MAT.DEADWOOD, MAT.BEDROCK]) {
    assert.equal(isSolid(m), true, `solid ${m}`);
    assert.equal(MAT_PROPS[m].solid, true);
  }
  for (const m of [MAT.AIR, MAT.WATER, MAT.LEAF]) {
    assert.equal(isSolid(m), false, `not solid ${m}`);
  }
});

test('isClimbable: wood always, rock only when steep', () => {
  assert.equal(isClimbable(MAT.WOOD), true);
  assert.equal(isClimbable(MAT.WOOD, 0), true);
  assert.equal(isClimbable(MAT.ROCK, 0.8), true);
  assert.equal(isClimbable(MAT.ROCK, -0.71), true);
  assert.equal(isClimbable(MAT.ROCK, 0.7), false); // strict >
  assert.equal(isClimbable(MAT.ROCK, 0.2), false);
  assert.equal(isClimbable(MAT.ROCK), false); // nx defaults to 0
  assert.equal(isClimbable(MAT.SOIL, 1), false);
  assert.equal(isClimbable(MAT.BEDROCK, 1), false);
  assert.equal(isClimbable(MAT.DEADWOOD, 1), false);
});

test('isClimbableAt composes sample + normal', () => {
  const mw = flatWorld(60, 40, 30);
  mw.grid.mat[cellIndex(mw.grid, 10, 25)] = MAT.WOOD;
  assert.equal(isClimbableAt(mw, 105, 255), true); // on the wood cell
  assert.equal(isClimbableAt(mw, 50, 295), false); // open air over soil
});

test('supportBelow finds the topmost solid cell within reach', () => {
  const mw = flatWorld(60, 40, 30);
  assert.deepEqual(supportBelow(mw, 50, 100, 500), { y: 300, mat: MAT.SOIL });
  assert.equal(supportBelow(mw, 50, 100, 100), null); // ground 200px down
  assert.deepEqual(supportBelow(mw, 50, 295, 24), { y: 300, mat: MAT.SOIL });
  // below-grid reports the world floor plane, not a phantom row
  const empty = makeMw(60, 40);
  const deep = supportBelow(empty, 50, 100, 500);
  assert.equal(deep.y, 400);
  assert.equal(deep.mat, MAT.BEDROCK);
});

test('surfaceNormal on flat ground is (0, -1)', () => {
  const mw = flatWorld(60, 40, 30);
  const n = surfaceNormal(mw, 50, 295);
  assert.ok(Math.abs(n.nx) < 1e-9, `nx=${n.nx}`);
  assert.ok(Math.abs(n.ny + 1) < 1e-9, `ny=${n.ny}`);
  // vertical wall: the normal points away from the solid
  fillRect(mw.grid, 20, 20, 20, 29, MAT.SOIL);
  const w = surfaceNormal(mw, 195, 250);
  assert.ok(Math.abs(w.nx + 1) < 1e-9, `wnx=${w.nx}`);
  assert.ok(Math.abs(w.ny) < 1e-9, `wny=${w.ny}`);
});

test('headroom counts air/water cells above before solid', () => {
  const mw = flatWorld(60, 40, 30);
  assert.equal(headroom(mw, 50, 295), 29); // rows 28..0
  const g = mw.grid;
  g.mat[cellIndex(g, 5, 10)] = MAT.WOOD;
  assert.equal(headroom(mw, 50, 295), 18); // rows 28..11
  g.mat[cellIndex(g, 5, 15)] = MAT.WATER;
  assert.equal(headroom(mw, 50, 295), 18); // water counts as open
});

// ================= creature =================

test('spawnCreature defaults', () => {
  const mw = flatWorld();
  const c = spawnCreature(mw, 123, 456);
  assert.equal(c.x, 123);
  assert.equal(c.y, 456);
  assert.equal(c.vx, 0);
  assert.equal(c.vy, 0);
  assert.equal(c.facing, 1);
  assert.equal(c.grounded, false);
  assert.equal(c.digTicks, 0);
  assert.equal(c.digPower, DIG_POWER);
  assert.equal(c.carried, null);
  assert.equal(c.wantDig, false);
  assert.equal(c.alive, true);
  assert.equal(BODY_H, 60);
  assert.equal(BODY_W, 30);
});

test('creature falls and lands grounded', () => {
  const mw = flatWorld();
  const c = spawnCreature(mw, 300, 100);
  assert.equal(c.grounded, false);
  for (let t = 0; t < 200; t++) tickCreature(mw, c);
  assert.equal(c.grounded, true);
  assert.equal(c.y, 300); // snapped to the surface
  assert.equal(c.vy, 0);
});

test('creature walks forward and displaces x over 200 ticks', () => {
  const mw = flatWorld();
  const c = spawnCreature(mw, 300, 300);
  const x0 = c.x;
  for (let t = 0; t < 200; t++) tickCreature(mw, c);
  const dx = c.x - x0;
  assert.ok(dx > 300, `displaced ${dx}px (expect ~${199 * WALK_SPEED})`);
  assert.equal(c.facing, 1);
  assert.equal(c.grounded, true);
  assert.equal(c.y, 300);
});

test('creature turns at a cliff edge', () => {
  const mw = flatWorld(120, 40, 30);
  const g = mw.grid;
  fillRect(g, 60, 30, 69, 39, MAT.AIR);    // the pit (10 wide, 10 deep)
  fillRect(g, 0, 20, 2, 39, MAT.SOIL);     // left wall (keeps it in-world)
  fillRect(g, 117, 20, 119, 39, MAT.SOIL); // right wall
  const c = spawnCreature(mw, 500, 300);
  let firstFlipX = null;
  let prevFacing = c.facing;
  let sawNeg = false;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let t = 0; t < 400; t++) {
    tickCreature(mw, c);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
    if (c.facing === -1) sawNeg = true;
    if (prevFacing === 1 && c.facing === -1 && firstFlipX === null) firstFlipX = c.x;
    prevFacing = c.facing;
  }
  assert.ok(sawNeg, 'turned around at least once');
  assert.ok(firstFlipX !== null && firstFlipX > 560 && firstFlipX < 600,
    `first flip at the pit edge, x=${firstFlipX}`);
  assert.equal(minY, 300, 'never fell into the pit');
  assert.equal(maxY, 300, 'never fell into the pit');
});

test('creature turns at a wall', () => {
  const mw = flatWorld(120, 40, 30);
  fillRect(mw.grid, 60, 25, 62, 39, MAT.ROCK); // rock wall on the plain
  const c = spawnCreature(mw, 500, 300);
  let sawNeg = false;
  let maxX = -Infinity;
  for (let t = 0; t < 300; t++) {
    tickCreature(mw, c);
    maxX = Math.max(maxX, c.x);
    if (c.facing === -1) sawNeg = true;
  }
  assert.ok(sawNeg, 'turned away from the wall');
  assert.ok(maxX < 590, `never crossed the wall, maxX=${maxX}`);
});

test('buoyancy: slow sink in water', () => {
  const mw = makeMw(60, 40);
  fillRect(mw.grid, 40, 20, 55, 39, MAT.WATER); // deep water column
  const c = spawnCreature(mw, 470, 250);
  let maxVy = 0;
  for (let t = 0; t < 40; t++) {
    tickCreature(mw, c);
    maxVy = Math.max(maxVy, c.vy);
  }
  assert.ok(maxVy <= 3.0001, `sank slowly, max vy=${maxVy}`);
  assert.ok(c.y > 250, 'sank downward');
});

// ================= digging =================

test('digging: soil cell removed after 3 work-ticks', () => {
  const mw = digWorld(MAT.SOIL);
  const c = spawnCreature(mw, 500, 300);
  c.wantDig = true;
  const g = mw.grid;
  const idx = cellIndex(g, 52, 27); // the facing cell at body height
  assert.equal(g.mat[idx], MAT.SOIL);
  tickCreature(mw, c);
  assert.equal(c.digTicks, 1, 'work accumulates');
  tickCreature(mw, c);
  tickCreature(mw, c);
  assert.equal(g.mat[idx], MAT.AIR, 'cell removed');
  assert.equal(g.dug[idx], 1, 'dug flag set');
  assert.equal(g.root[idx], 0, 'root cleared');
  assert.equal(c.digTicks, 0, 'work counter reset');
  assert.equal(c.carried.material, 'soil', 'yields a carried item');
});

test('digging: sand takes 2 ticks, clay takes 5', () => {
  for (const [mat, need] of [[MAT.SAND, 2], [MAT.CLAY, 5]]) {
    const mw = digWorld(mat);
    const c = spawnCreature(mw, 500, 300);
    c.wantDig = true;
    const g = mw.grid;
    const idx = cellIndex(g, 52, 27);
    for (let t = 0; t < need - 1; t++) tickCreature(mw, c);
    assert.equal(g.mat[idx], mat, `${mat} still there after ${need - 1} ticks`);
    tickCreature(mw, c);
    assert.equal(g.mat[idx], MAT.AIR, `${mat} removed after ${need} ticks`);
    assert.equal(g.dug[idx], 1);
  }
});

test('digging: bedrock is never diggable', () => {
  const mw = digWorld(MAT.BEDROCK);
  const c = spawnCreature(mw, 500, 300);
  c.wantDig = true;
  const idx = cellIndex(mw.grid, 52, 27);
  for (let t = 0; t < 10; t++) tickCreature(mw, c);
  assert.equal(mw.grid.mat[idx], MAT.BEDROCK);
  assert.equal(mw.grid.dug[idx], 0);
  assert.equal(c.digTicks, 0);
});

test('digging: rock is below the dig threshold (digAhead 0.3)', () => {
  const mw = digWorld(MAT.ROCK);
  const c = spawnCreature(mw, 500, 300);
  c.wantDig = true;
  const idx = cellIndex(mw.grid, 52, 27);
  for (let t = 0; t < 10; t++) tickCreature(mw, c);
  assert.equal(mw.grid.mat[idx], MAT.ROCK, 'rock untouched');
  assert.equal(c.digTicks, 0, 'no work accumulated');
  assert.equal(c.facing, -1, 'turned away from the undiggable wall');
});

test('digging needs the wantDig flag', () => {
  const mw = digWorld(MAT.SOIL);
  const c = spawnCreature(mw, 500, 300);
  // wantDig stays false: the creature walks into the wall and turns.
  for (let t = 0; t < 10; t++) tickCreature(mw, c);
  assert.equal(mw.grid.mat[cellIndex(mw.grid, 52, 27)], MAT.SOIL);
  assert.equal(c.digTicks, 0);
});

// ================= senses =================

test('senses: digAhead, soilBelow, enclosed', () => {
  assert.equal(SENSE_DIG_AHEAD, 43);
  assert.equal(SENSE_SOIL_BELOW, 44);
  assert.equal(SENSE_ENCLOSED, 45);

  const mw = digWorld(MAT.SOIL);
  const c = spawnCreature(mw, 500, 300);
  c.wantDig = true;
  const s = sense43_45(mw, c);
  assert.ok(Math.abs(s.digAhead - 1) < 1e-9, `digAhead facing soil = ${s.digAhead}`);

  const air = spawnCreature(mw, 500, 100);
  assert.equal(sense43_45(mw, air).soilBelow, 0, 'soilBelow 0 in air');
  assert.equal(sense43_45(mw, air).digAhead, 0, 'digAhead 0 facing air');

  tickCreature(mw, c); // lands on the soil plain
  assert.ok(Math.abs(sense43_45(mw, c).soilBelow - 1) < 1e-9,
    `soilBelow on soil = ${sense43_45(mw, c).soilBelow}`);

  // buried: all 8 neighbors of the body-center cell are solid
  const bw = makeMw(60, 40);
  fillRect(bw.grid, 0, 0, 59, 39, MAT.SOIL);
  const buried = spawnCreature(bw, 300, 350);
  const bs = sense43_45(bw, buried);
  assert.ok(Math.abs(bs.enclosed - 1) < 1e-9, `enclosed buried = ${bs.enclosed}`);
  assert.ok(Math.abs(bs.soilBelow - 1) < 1e-9, `soilBelow buried = ${bs.soilBelow}`);

  // open air: nothing enclosed
  const open = sense43_45(mw, air);
  assert.equal(open.enclosed, 0, 'enclosed 0 in open air');
});

// ================= determinism =================

function trajectory(build, sx, sy, n, setup) {
  const mw = build();
  const c = spawnCreature(mw, sx, sy);
  if (setup) setup(c);
  const traj = [];
  for (let t = 0; t < n; t++) {
    tickCreature(mw, c);
    traj.push([c.x, c.y, c.vx, c.vy, c.facing, c.grounded, c.digTicks,
      c.carried ? c.carried.material : null]);
  }
  return traj;
}

test('determinism: identical runs produce identical trajectories', () => {
  const a = trajectory(() => flatWorld(), 300, 300, 300);
  const b = trajectory(() => flatWorld(), 300, 300, 300);
  assert.deepEqual(a, b);

  // with a digging interlude and a cliff turn mixed in
  const digBuild = () => digWorld(MAT.SOIL);
  const da = trajectory(digBuild, 500, 300, 60, (c) => { c.wantDig = true; });
  const db = trajectory(digBuild, 500, 300, 60, (c) => { c.wantDig = true; });
  assert.deepEqual(da, db);

  const cliffBuild = () => {
    const mw = flatWorld(120, 40, 30);
    fillRect(mw.grid, 60, 30, 69, 39, MAT.AIR);
    return mw;
  };
  const ca = trajectory(cliffBuild, 500, 300, 200);
  const cb = trajectory(cliffBuild, 500, 300, 200);
  assert.deepEqual(ca, cb);
});
