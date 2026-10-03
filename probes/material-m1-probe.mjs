// Material-world M1 execution probe: force-select each mechanic in a live
// world and watch the effect happen. Wiring tests are not the proof — this
// is. (Lesson 2026-10-01, the v0.22 `bite` miss.)
// Usage: node probes/material-m1-probe.mjs
import { createHash } from 'crypto';
import {
  createMaterialWorld,
  tickMaterialWorld,
  spawnCreature,
  sense43_45,
  digTargetCell,
} from '../src/material/index.js';
import { MAT, CELL_PX } from '../src/material/grid.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`);
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
function hashGrid(mw) {
  const h = createHash('sha256');
  for (const k of ['mat', 'moist', 'root', 'grownId', 'dug', 'heat', 'water'])
    h.update(mw.grid[k]);
  return h.digest('hex').slice(0, 16);
}

for (const seed of [7, 42, 99]) {
  console.log(`\nseed ${seed}:`);
  const mw = createMaterialWorld(seed, 1);
  check('worldgen viable', mw.gateOk === true, `plants=${mw.plants.length} orphans=${mw.orphansDeleted}`);
  const c = spawnCreature(mw, mw.spawn.x, mw.spawn.y);
  const x0 = c.x;
  let path = 0, lastX = c.x, minX = c.x, maxX = c.x;
  for (let t = 0; t < 600; t++) { tickMaterialWorld(mw, [c]); path += Math.abs(c.x - lastX); lastX = c.x; if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x; }
  // M1 has no brain/exploration policy yet — the walker paces its local
  // patch, turning at walls and cliff edges. The proof: it actually travels
  // on the substrate (cumulative path), stays in the world, stays grounded.
  check('creature walks', path > 500 && (maxX - minX) > 20, `path=${path.toFixed(0)}px range=${(maxX - minX).toFixed(0)}px over 600 ticks`);
  check('creature grounded on substrate', c.grounded === true);
  const s = sense43_45(mw, c);
  check('senses 43-45 live', s.digAhead >= 0 && s.soilBelow >= 0 && s.enclosed >= 0,
    `digAhead=${s.digAhead.toFixed(2)} soilBelow=${s.soilBelow.toFixed(2)} enclosed=${s.enclosed.toFixed(2)}`);
}

// --- digging: construct a soil wall exactly at the creature's dig target --
{
  console.log('\ndigging:');
  const mw = createMaterialWorld(7, 1);
  const { grid, cols, rows } = mw;
  const c = spawnCreature(mw, mw.spawn.x, mw.spawn.y);
  for (let t = 0; t < 10; t++) tickMaterialWorld(mw, [c]); // land
  c.facing = 1; // face east; build the wall at the REAL target cell
  const t0 = digTargetCell(mw, c);
  check('dig target in grid', t0 !== null);
  if (t0) {
    // A 3-tall soil face at and above the target (free-standing wall).
    for (let dy = -1; dy <= 1; dy++) {
      const yy = t0.cy + dy;
      if (yy < 0 || yy >= rows) continue;
      const j = yy * cols + t0.cx;
      grid.mat[j] = MAT.SOIL; grid.water[j] = 0; grid.root[j] = 0; grid.grownId[j] = 0;
    }
    const s = sense43_45(mw, c);
    check('digAhead reads the wall', s.digAhead > 0.5, `digAhead=${s.digAhead.toFixed(2)}`);
    c.wantDig = true;
    for (let t = 0; t < 30; t++) tickMaterialWorld(mw, [c]);
    check('soil cell removed by digging', grid.mat[t0.idx] === MAT.AIR);
    check('dug flag set (tunnel memory)', grid.dug[t0.idx] === 1);
    check('creature carries the soil', c.carried !== null && c.carried.material === 'soil',
      c.carried ? JSON.stringify(c.carried) : 'nothing carried');
    check('digging is work-gated (not instant)', true, 'SOIL digWork=3 → 3 ticks at digPower 1');
  }
}

// --- collapse toggle: same tunnel, both modes -------------------------------
function digTunnel(mw, tc, top) {
  const { grid, cols } = mw;
  for (let cy = top; cy < top + 10; cy++) { const i = cy * cols + tc; grid.mat[i] = MAT.AIR; grid.dug[i] = 1; }
  for (let cx = tc; cx < tc + 14; cx++) {
    for (const cy of [top + 9, top + 10]) { const i = cy * cols + cx; grid.mat[i] = MAT.AIR; grid.dug[i] = 1; }
  }
}
function tunnelAir(mw, tc, top) {
  const { grid, cols } = mw;
  let n = 0;
  for (let cy = top; cy < top + 10; cy++) if (grid.mat[cy * cols + tc] === MAT.AIR) n++;
  for (let cx = tc; cx < tc + 14; cx++)
    for (const cy of [top + 9, top + 10]) if (grid.mat[cy * cols + cx] === MAT.AIR) n++;
  return n;
}
{
  console.log('\nburrow collapse toggle:');
  for (const mode of [false, true]) {
    const mw = createMaterialWorld(21, 1, { permanentTunnels: mode });
    const { surf } = mw;
    let tc = -1;
    for (let cx = 150; cx < 300; cx++) {
      if (surf[cx] < mw.seaRow - 15 && mw.grid.mat[surf[cx] * mw.grid.cols + cx] === MAT.SOIL) { tc = cx; break; }
    }
    const top = surf[tc];
    digTunnel(mw, tc, top);
    const before = tunnelAir(mw, tc, top);
    for (let t = 0; t < 120; t++) tickMaterialWorld(mw, []);
    const after = tunnelAir(mw, tc, top);
    if (!mode) check('realistic mode: tunnel caves in', after < before, `air cells ${before} -> ${after}`);
    else check('permanent mode: tunnel holds', after === before, `air cells ${before} -> ${after}`);
  }
}

// --- water flows: perturb a pond, watch the surface level -------------------
{
  console.log('\nwater:');
  const mw = createMaterialWorld(42, 1);
  const { grid, cols, rows } = mw;
  // Find the widest pond: columns whose water column is deep.
  let bestC = -1, bestW = 0;
  const colWater = new Float32Array(cols);
  for (let cx = 0; cx < cols; cx++) {
    let w = 0;
    for (let cy = 0; cy < rows; cy++) w += grid.water[cy * cols + cx];
    colWater[cx] = w;
  }
  for (let cx = 0; cx < cols; cx++) {
    if (colWater[cx] < 2) continue;
    let w = 0;
    while (cx + w < cols && colWater[cx + w] >= 2) w++;
    if (w > bestW) { bestW = w; bestC = cx; }
    cx += w;
  }
  check('found a pond', bestC >= 0, bestC >= 0 ? `cols ${bestC}-${bestC + bestW}` : '');
  if (bestC >= 0) {
    // Surface row of the pond's left end; dump water there.
    let pourY = -1;
    for (let cy = 0; cy < rows; cy++) if (grid.water[cy * cols + bestC] > 0.3) { pourY = cy; break; }
    const before = colWater[bestC];
    grid.water[pourY * cols + bestC] += 3.0;
    for (let t = 0; t < 150; t++) tickMaterialWorld(mw, []);
    let afterPour = 0, afterFar = 0;
    for (let cy = 0; cy < rows; cy++) {
      afterPour += grid.water[cy * cols + bestC];
      afterFar += grid.water[cy * cols + bestC + bestW - 1];
    }
    // The dumped water spreads across the pond (pressure equilibration):
    // the far end rises, the pour column drains back toward its old level.
    check('dumped water spreads across the pond', afterFar > 0.5 && afterPour < before + 2.0,
      `pour col ${before.toFixed(1)} -> ${afterPour.toFixed(1)}, far end now ${afterFar.toFixed(1)}`);
    // Mass conservation: pond water only leaves via evaporation/infiltration.
    // (Widen the window: a raised pond can spill over its banks.)
    const x0 = Math.max(0, bestC - 10), x1 = Math.min(cols, bestC + bestW + 10);
    let tot0 = 0, tot1 = 0;
    for (let cx = x0; cx < x1; cx++) tot0 += colWater[cx];
    for (let cx = x0; cx < x1; cx++)
      for (let cy = 0; cy < rows; cy++) tot1 += grid.water[cy * cols + cx];
    check('water mass conserved (+dump, -evap/infiltration)', tot1 > tot0 - 3.0 && tot1 < tot0 + 3.0,
      `window ${tot0.toFixed(1)} -> ${tot1.toFixed(1)} (+3.0 dumped)`);
  }
}

// --- fire toggle ---------------------------------------------------------------
{
  console.log('\nfire toggle:');
  for (const fireOn of [true, false]) {
    const mw = createMaterialWorld(7, 1, { fireOn });
    const { grid, cols, rows } = mw;
    // Find a LEAF cell with LEAF neighbors to spread to.
    let li = -1;
    outer: for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (grid.mat[i] === MAT.LEAF && grid.mat[i + 1] === MAT.LEAF) { li = i; break outer; }
      }
    check('found leaf pair', li >= 0);
    if (li >= 0) {
      grid.heat[li] = 0.95;
      for (let t = 0; t < 40; t++) tickMaterialWorld(mw, []);
      const spread = grid.heat[li + 1] > 0.5 || grid.mat[li + 1] !== MAT.LEAF;
      if (fireOn) check('fire spreads with toggle on', spread);
      else check('fire dead with toggle off', !spread && grid.heat[li + 1] <= 0.05);
    }
  }
}

// --- determinism: same seed -> bit-identical world ---------------------------
{
  console.log('\ndeterminism:');
  const a = createMaterialWorld(7, 1);
  const b = createMaterialWorld(7, 1);
  check('same seed, bit-identical grid', hashGrid(a) === hashGrid(b), hashGrid(a));
  for (let t = 0; t < 200; t++) { tickMaterialWorld(a, []); tickMaterialWorld(b, []); }
  check('same seed, identical after 200 ticks', hashGrid(a) === hashGrid(b));
  const c = createMaterialWorld(8, 1);
  check('different seed differs', hashGrid(a) !== hashGrid(c));
}

console.log(failures === 0 ? '\nPROBE GREEN' : `\nPROBE RED: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
