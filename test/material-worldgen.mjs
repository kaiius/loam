// Tests for the material-world generative worldgen (M1).
//
// A world is grown, never placed: plants are 8-connected cell sets grown
// from soil seed cells by a deterministic L-system, so floating flora is
// structurally impossible. The viability gate rejects unplayable rolls;
// re-rolls are deterministic (attempt mixed into the stream).
// Run: node --test test/material-worldgen.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateMaterialWorld, checkViability, treeArchParams } from '../src/material/worldgen.js';
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

// --- M4 tree architecture ------------------------------------------------------

test('m4: treeArchParams is deterministic and bounded', () => {
  const a = treeArchParams(7, 3), b = treeArchParams(7, 3);
  assert.deepEqual(a, b, 'same (seed, pid) → same params');
  const D2R = Math.PI / 180;
  assert.ok(Math.abs(a.lean) <= 8 * D2R + 1e-12, `lean ±8°, got ${(a.lean / D2R).toFixed(2)}°`);
  assert.ok([4, 5, 6].includes(a.branchK), `branchK ∈ {4,5,6}, got ${a.branchK}`);
});

test('m4: per-tree variation — adjacent plants do not share architecture', () => {
  const leans = new Set(), ks = new Set();
  for (let pid = 1; pid <= 24; pid++) {
    const p = treeArchParams(7, pid);
    leans.add(p.lean.toFixed(6));
    ks.add(p.branchK);
  }
  assert.ok(leans.size > 20, `leans vary per tree (got ${leans.size}/24 distinct)`);
  assert.ok(ks.size >= 2, `branch intervals vary (got ${[...ks]})`);
});

test('m4: trees keep a dominant leader (apical dominance)', () => {
  // For each large plant, the tallest single-column vertical wood run
  // should be a large fraction of the plant's height — the leader climbs,
  // branches stay subordinate.
  const w = generateMaterialWorld(7, 1);
  const { grid, cols, rows } = w;
  let checked = 0;
  for (const p of w.plants) {
    if (p.wood < 60) continue; // jungle trees only
    const gid = p.id % 65536;
    let top = rows, bottom = 0;
    const colRuns = new Map(); // x -> longest vertical run of this plant's wood
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (grid.mat[i] === MAT.WOOD && grid.grownId[i] === gid) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    const height = bottom - top;
    if (height < 20) continue;
    // longest vertical run in any single column
    let best = 0;
    for (let x = 0; x < cols; x++) {
      let run = 0;
      for (let y = 0; y < rows; y++) {
        const i = y * cols + x;
        if (grid.mat[i] === MAT.WOOD && grid.grownId[i] === gid) { run++; best = Math.max(best, run); }
        else run = 0;
      }
    }
    assert.ok(best >= height * 0.45, `plant ${p.id}: leader run ${best} ≥ 45% of height ${height}`);
    checked++;
  }
  assert.ok(checked >= 3, `checked ${checked} large trees`);
});

test('m4: branch wood stays connected and climbable (no orphans introduced)', () => {
  const w = generateMaterialWorld(7, 1);
  assert.equal(w.orphansDeleted, 0, `no orphans deleted, got ${w.orphansDeleted}`);
  // every plant still grows a real crown: wood + leaf both present
  for (const p of w.plants) {
    assert.ok(p.wood > 0, `plant ${p.id} has wood`);
    assert.ok(p.leaf > 0, `plant ${p.id} has leaves`);
  }
});
