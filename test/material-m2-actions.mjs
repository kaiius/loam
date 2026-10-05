// M2 execution probes: every new/changed verb force-selected in a live sim,
// watching the effect happen. Wiring tests are not proof (AGENTS.md lesson).
// Run: node --test test/material-m2-actions.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAT, CELL_PX, createGrid } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';
import { spawnMaterialCreature, tickMaterialCreature } from '../src/material/mcreature.js';
import { executeAction } from '../src/material/actions.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { ACTIONS } from '../src/material/brain.js';

// A synthetic micro-world: 60x40, soil in the bottom half, air above.
// Precise, fast, deterministic.
function microWorld() {
  const cols = 60, rows = 40;
  const grid = createGrid(cols, rows);
  for (let y = 20; y < rows; y++)
    for (let x = 0; x < cols; x++) grid.mat[y * cols + x] = MAT.SOIL;
  return {
    seed: 7, tick: 0, grid, cols, rows,
    plants: [], bonds: new Map(),
    surf: new Array(cols).fill(20),
  };
}

import { randomGenome } from '../src/sim/genome.js';
function genomeFor() { return randomGenome(createRng(7), {}); }

function spawnAt2(mw, px, py) {
  return spawnMaterialCreature(mw, genomeFor(), px, py);
}

const IDX = (name) => ACTIONS.indexOf(name);

test('probe: DIG removes the facing soil cell and yields carried soil', () => {
  const mw = microWorld();
  const c = spawnAt2(mw, 300, 200); // feet at surface (y=200 = row 20)
  c.grounded = true;
  // Face a soil wall: put soil at body height ahead.
  const g = mw.grid;
  const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
  g.mat[ty * g.cols + tx] = MAT.SOIL;
  const s = gatherMaterialSenses(mw, c, { others: [] });
  assert.ok(s.digAhead > 0.5, `digAhead senses the wall: ${s.digAhead}`);
  // Force dig until the cell breaks (soil = 3 work ticks at digPower 1).
  for (let i = 0; i < 10 && !c.carried; i++) {
    executeAction(mw, c, IDX('dig'), gatherMaterialSenses(mw, c, { others: [] }), {});
  }
  assert.ok(c.carried, 'creature carries dug soil');
  assert.equal(c.carried.material, 'soil');
  assert.equal(g.mat[ty * g.cols + tx], MAT.AIR, 'the cell is gone');
  assert.equal(g.dug[ty * g.cols + tx], 1, 'dug flag set');
});

test('probe: PILE places carried soil into the facing air cell', () => {
  const mw = microWorld();
  const c = spawnAt2(mw, 300, 200);
  c.grounded = true;
  c.carried = { material: 'soil', weight: 1 };
  // Facing cell at body height must be AIR.
  const g = mw.grid;
  const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
  g.mat[ty * g.cols + tx] = MAT.AIR;
  for (let i = 0; i < 8 && c.carried; i++) {
    executeAction(mw, c, IDX('pile'), gatherMaterialSenses(mw, c, { others: [] }), {});
  }
  assert.equal(c.carried, null, 'hands empty after piling');
  assert.equal(g.mat[ty * g.cols + tx], MAT.SOIL, 'a soil cell was built');
  assert.equal(c.piled, 1, 'pile counter incremented');
});

test('probe: INSTPILE dumps carried soil at the feet, fast', () => {
  const mw = microWorld();
  const c = spawnAt2(mw, 300, 200);
  c.grounded = true;
  c.carried = { material: 'soil', weight: 1 };
  executeAction(mw, c, IDX('instPile'), gatherMaterialSenses(mw, c, { others: [] }), {});
  assert.equal(c.carried, null, 'hands empty after dumping');
  assert.equal(c.dumped, 1, 'dump counter incremented');
  // Loose soil (sand) at the feet.
  const g = mw.grid;
  const cx = Math.floor(c.x / CELL_PX), cy = Math.floor((c.y - 4) / CELL_PX);
  assert.equal(g.mat[cy * g.cols + cx], MAT.SAND, 'loose soil at feet');
});

test('probe: CLIMB moves up a wood trunk (surface-following)', () => {
  const mw = microWorld();
  const g = mw.grid;
  // A wood trunk: column x=30, rows 8..19.
  for (let y = 8; y < 20; y++) g.mat[y * g.cols + 30] = MAT.WOOD;
  const c = spawnAt2(mw, 305, 200); // next to the trunk (x=305 → col 30.5)
  c.x = 30 * CELL_PX + CELL_PX / 2 + 12; // just right of the trunk
  c.grounded = true;
  const y0 = c.y;
  const s = gatherMaterialSenses(mw, c, { others: [] });
  assert.ok(s.climbUp > 0.5 || s.climbDown > 0.5, `climb sense fires near wood: up=${s.climbUp}`);
  for (let i = 0; i < 20; i++) {
    executeAction(mw, c, IDX('climb'), gatherMaterialSenses(mw, c, { others: [] }), {});
  }
  assert.ok(c.y < y0 - 10, `climbed up: ${y0} → ${c.y}`);
  assert.ok(c.climbing, 'climbing flag set');
});

test('probe: GEOPHAGY restores minerals from soil when deficient', () => {
  const mw = microWorld();
  const c = spawnAt2(mw, 300, 200);
  c.grounded = true;
  c.minerals = 0.2; // deficient
  const g = mw.grid;
  const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
  g.mat[ty * g.cols + tx] = MAT.SOIL;
  const m0 = c.minerals;
  executeAction(mw, c, IDX('geophagy'), gatherMaterialSenses(mw, c, { others: [] }), {});
  assert.ok(c.minerals > m0, `minerals rose: ${m0} → ${c.minerals}`);
  assert.equal(g.mat[ty * g.cols + tx], MAT.AIR, 'the eaten soil cell is gone');
});

test('probe: GEOPHAGY does nothing when minerals are fine', () => {
  const mw = microWorld();
  const c = spawnAt2(mw, 300, 200);
  c.grounded = true;
  c.minerals = 0.9; // replete
  const g = mw.grid;
  const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
  g.mat[ty * g.cols + tx] = MAT.SOIL;
  executeAction(mw, c, IDX('geophagy'), gatherMaterialSenses(mw, c, { others: [] }), {});
  assert.equal(g.mat[ty * g.cols + tx], MAT.SOIL, 'no needless earth-eating');
});

test('r2: GEOPHAGY pays more on nutrient-rich soil (rotted matter enriches)', () => {
  const eat = (nutrient) => {
    const mw = microWorld();
    const c = spawnAt2(mw, 300, 200);
    c.grounded = true;
    c.minerals = 0.2; // deficient
    const g = mw.grid;
    const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
    g.mat[ty * g.cols + tx] = MAT.SOIL;
    g.nutrient[ty * g.cols + tx] = nutrient;
    const m0 = c.minerals;
    executeAction(mw, c, IDX('geophagy'), gatherMaterialSenses(mw, c, { others: [] }), {});
    return c.minerals - m0;
  };
  const plain = eat(0);
  const enriched = eat(1.2);
  assert.ok(Math.abs(plain - 0.4) < 1e-9, `plain soil pays the base 0.4 (got ${plain})`);
  assert.ok(Math.abs(enriched - 0.8) < 1e-9, `enriched soil pays 0.8 (got ${enriched})`);
  assert.ok(enriched > plain, 'rotted-matter soil pays more');
});

test('probe: EAT takes fruit from a fruiting plant', () => {
  const mw = microWorld();
  // seedX/seedY are CELL coords (cell-vs-pixel fix); creature at px (300,200).
  mw.plants = [{ seedX: 32, seedY: 15, fruiting: true, fruit: 3 }];
  const c = spawnAt2(mw, 300, 200);
  c.grounded = true;
  const sugar0 = c.chem.bloodSugar;
  c.chem.bloodSugar = 0.3;
  const chemCtx = executeAction(mw, c, IDX('eat'), gatherMaterialSenses(mw, c, { others: [] }), {});
  assert.ok((chemCtx.ate || 0) > 0, 'ate something');
  assert.equal(mw.plants[0].fruit, 2, 'one fruit consumed');
});

test('probe: anatomy gate — pile needs grasp pairs', () => {
  const mw = microWorld();
  const c = spawnAt2(mw, 300, 200);
  c.grounded = true;
  c.carried = { material: 'soil', weight: 1 };
  c.body.graspPairs = 0; // no hands
  const g = mw.grid;
  const tx = Math.floor((c.x + 20) / CELL_PX), ty = Math.floor((c.y - 30) / CELL_PX);
  g.mat[ty * g.cols + tx] = MAT.AIR;
  for (let i = 0; i < 8; i++) {
    executeAction(mw, c, IDX('pile'), gatherMaterialSenses(mw, c, { others: [] }), {});
  }
  assert.ok(c.carried, 'no hands → still carrying (gate held)');
  assert.equal(g.mat[ty * g.cols + tx], MAT.AIR, 'nothing built');
});

test('probe: full tick — brain, senses, action, chemistry, learning run together', () => {
  const mw = microWorld();
  const c = spawnAt2(mw, 300, 200);
  c.grounded = true;
  const others = [c];
  for (let t = 0; t < 50; t++) {
    mw.tick = t;
    tickMaterialCreature(mw, c, { others });
  }
  assert.ok(c.lastAction >= 0 && c.lastAction < 33, `brain decided: ${ACTIONS[c.lastAction]}`);
  assert.ok(Number.isFinite(c.lastReward), 'reward is finite');
  assert.ok(c.alive, 'alive after 50 ticks');
});

test('probe: determinism — same seed/tick/creature → same action', () => {
  const run = () => {
    const mw = microWorld();
    const c = spawnMaterialCreature(mw, genomeFor(), 300, 200);
    c.grounded = true;
    mw.tick = 7;
    tickMaterialCreature(mw, c, { others: [c] });
    return c.lastAction;
  };
  assert.equal(run(), run(), 'identical runs decide identically');
});
