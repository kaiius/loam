// Tests for the material-world generative worldgen (M1).
//
// A world is grown, never placed: plants are 8-connected cell sets grown
// from soil seed cells by a deterministic L-system, so floating flora is
// structurally impossible. The viability gate rejects unplayable rolls;
// re-rolls are deterministic (attempt mixed into the stream).
// Run: node --test test/material-worldgen.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateMaterialWorld, checkViability } from '../src/material/worldgen.js';
import { MAT, CELL_PX } from '../src/material/grid.js';

const LAND_KEYS = new Set(['arctic', 'mountains', 'jungle', 'plains', 'desert', 'archipelago']);

const matBytes = (w) => Buffer.from(w.grid.mat);
const landKeysOf = (w) =>
  new Set(w.labels.filter((l) => LAND_KEYS.has(l.key)).map((l) => l.key));

// --- determinism: the same (seed, size) is the same world, bit-for-bit -----

test('material: same seed → byte-identical mat array (run twice)', () => {
  const a = generateMaterialWorld(7, 1);
  const b = generateMaterialWorld(7, 1);
  assert.ok(matBytes(a).equals(matBytes(b)), 'mat arrays byte-identical');
  assert.deepEqual(a.plants, b.plants, 'plants identical');
  assert.deepEqual(a.labels, b.labels, 'labels identical');
  assert.deepEqual(a.spawn, b.spawn, 'spawn identical');
  assert.equal(a.orphansDeleted, b.orphansDeleted, 'orphan counts identical');
});

test('material: the attempt counter changes the roll (re-rolls explore)', () => {
  const a = generateMaterialWorld(7, 1, { attempt: 0, maxAttempts: 1 });
  const b = generateMaterialWorld(7, 1, { attempt: 1, maxAttempts: 1 });
  assert.ok(!matBytes(a).equals(matBytes(b)), 'different attempts → different worlds');
});

test('material: different seeds → different worlds', () => {
  const a = generateMaterialWorld(7, 1);
  const b = generateMaterialWorld(99, 1);
  assert.ok(!matBytes(a).equals(matBytes(b)), 'mat arrays differ');
});

// --- the anti-floating guarantee --------------------------------------------

for (const seed of [7, 42, 99]) {
  test(`material: seed ${seed} grows no orphans (orphansDeleted === 0)`, () => {
    const w = generateMaterialWorld(seed, 1);
    assert.equal(w.orphansDeleted, 0, `log: ${w.log.join(' | ')}`);
  });
}

test('material: every WOOD cell is 8-connected to some seed (independent flood-fill)', () => {
  const w = generateMaterialWorld(42, 1);
  const { grid, cols, rows, plants } = w;
  assert.ok(plants.length > 0, 'world has plants');
  // Independent BFS: 8-connected WOOD from every seed cell.
  const reached = new Uint8Array(cols * rows);
  const stack = [];
  for (const p of plants) {
    const si = p.seedY * cols + p.seedX;
    if (!reached[si]) { reached[si] = 1; stack.push(si); }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % cols, y = (i / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (!reached[j] && grid.mat[j] === MAT.WOOD) { reached[j] = 1; stack.push(j); }
    }
  }
  let woodTotal = 0, woodStranded = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (grid.mat[i] === MAT.WOOD) { woodTotal++; if (!reached[i]) woodStranded++; }
  }
  assert.ok(woodTotal > 0, 'world has grown wood');
  assert.equal(woodStranded, 0, `${woodStranded}/${woodTotal} wood cells unreachable from a seed`);
  // Every LEAF cell is 8-adjacent to reached WOOD.
  let leafStranded = 0, leafTotal = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (grid.mat[i] !== MAT.LEAF) continue;
    leafTotal++;
    const x = i % cols, y = (i / cols) | 0;
    let ok = false;
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (reached[ny * cols + nx]) { ok = true; break; }
    }
    if (!ok) leafStranded++;
  }
  assert.ok(leafTotal > 0, 'world has grown leaves');
  assert.equal(leafStranded, 0, `${leafStranded}/${leafTotal} leaf cells not adjacent to connected wood`);
});

// --- the viability gate ------------------------------------------------------

for (const seed of [7, 42, 99]) {
  test(`material: seed ${seed} passes the viability gate`, () => {
    const w = generateMaterialWorld(seed, 1);
    assert.ok(!w.fallback || w.gateOk, 'never throws: fallback also gates');
    const gate = checkViability(w);
    assert.ok(gate.ok, `gate failures: ${gate.failures.join('; ')}`);
  });

  test(`material: seed ${seed} labels cover ≥ 3 land types`, () => {
    const w = generateMaterialWorld(seed, 1);
    const keys = landKeysOf(w);
    assert.ok(keys.size >= 3, `only ${keys.size} land labels: ${[...keys].join(',')}`);
  });

  test(`material: seed ${seed} spawn is a non-submerged SOIL surface cell`, () => {
    const w = generateMaterialWorld(seed, 1);
    const c = Math.floor(w.spawn.x / CELL_PX), r = Math.floor(w.spawn.y / CELL_PX);
    assert.equal(w.grid.mat[r * w.cols + c], MAT.SOIL, 'spawn cell is SOIL');
    assert.equal(w.grid.mat[(r - 1) * w.cols + c], MAT.AIR, 'open sky above spawn');
    assert.ok(r <= w.seaRow, 'spawn not submerged');
    assert.deepEqual(w.spawn, { x: (c + 0.5) * CELL_PX, y: r * CELL_PX }, 'feet on the surface cell');
  });
}

// --- the returned world keeps the contract -----------------------------------

test('material: returned world keeps the contract shape', () => {
  const w = generateMaterialWorld(7, 1);
  assert.equal(w.seed, 7);
  assert.equal(w.size, 1);
  assert.equal(w.cols, 480);
  assert.equal(w.rows, 110);
  assert.equal(w.cellPx, 10);
  assert.ok(w.grid.mat instanceof Uint8Array);
  assert.ok(w.grid.moist instanceof Float32Array);
  assert.ok(w.grid.root instanceof Uint8Array);
  assert.ok(w.grid.grownId instanceof Uint16Array);
  assert.ok(w.grid.dug instanceof Uint8Array);
  assert.ok(w.grid.heat instanceof Float32Array);
  assert.ok(w.grid.water instanceof Float32Array);
  assert.ok(Array.isArray(w.plants) && w.plants.length > 0);
  assert.ok(Array.isArray(w.labels) && w.labels.length > 0);
  assert.equal(w.tick, 0);
  assert.equal(w.fireOn, true);
  assert.equal(w.permanentTunnels, false);
  // grown cells carry their plant id
  let grownSeen = 0;
  for (let i = 0; i < w.cols * w.rows; i++) {
    if (w.grid.mat[i] === MAT.WOOD || w.grid.mat[i] === MAT.LEAF) {
      assert.equal(w.grid.root[i], 1, 'grown cell has root=1');
      assert.ok(w.grid.grownId[i] > 0, 'grown cell has a plant id');
      grownSeen++;
    }
  }
  assert.ok(grownSeen > 0, 'world has grown cells');
  // fruiting plants exist (G1)
  assert.ok(w.plants.filter((p) => p.fruiting).length >= 8, '≥ 8 fruiting plants');
});
