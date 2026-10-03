// Canopy material world — locomotion query interface (M1).
//
// Design §3.3: the one rewrite the stage change touches. The tick never asks
// "what platform am I on" — it asks the substrate. All queries take pixel
// coords in; the grid answers. Deterministic: no RNG anywhere in this file.
//
// Coordinate note: y grows downward (screen space). surfaceNormal points
// AWAY from solid (into the open): on flat ground it is (0, -1), i.e. up.

import { CELL_PX, MAT, MAT_PROPS, matAtPx } from './grid.js';

// The substrate answers: material id at pixel (x, y). Below the grid is
// BEDROCK, sides/top are AIR (the grid.js contract).
export function sampleMat(mw, x, y) {
  return matAtPx(mw.grid, x, y);
}

// SOIL/SAND/CLAY/ROCK/WOOD/DEADWOOD/BEDROCK — read off the table so the
// definition stays in one place (grid.js MAT_PROPS).
export function isSolid(mat) {
  const p = MAT_PROPS[mat];
  return !!p && p.solid === true;
}

// WOOD is always climbable; ROCK only when the local surface is steep
// (|nx| > 0.7 — §3.3). nx comes from surfaceNormal; pass it in so callers
// that already computed the normal don't recompute it.
export function isClimbable(mat, nx = 0) {
  const p = MAT_PROPS[mat];
  if (p && p.climbable) return true; // WOOD (the table's only flag)
  if (mat === MAT.ROCK) return Math.abs(nx) > 0.7;
  return false;
}

// Composition helper: climbable check at a world point (computes the local
// normal internally). The M2 climb action builds on this.
export function isClimbableAt(mw, x, y) {
  const n = surfaceNormal(mw, x, y);
  return isClimbable(sampleMat(mw, x, y), n.nx);
}

// Topmost solid cell within `reach` px below (x, y): { y, mat } where y is
// the pixel y of the cell's top edge — or null when there is no support in
// reach. Scans in cell steps from the point downward.
export function supportBelow(mw, x, y, reach) {
  const g = mw.grid;
  const end = y + reach;
  for (let py = y; py < end; py += CELL_PX) {
    const m = matAtPx(g, x, py);
    if (isSolid(m)) {
      const cy = Math.floor(py / CELL_PX);
      // Below-grid hits are the world floor: report the floor plane, not a
      // phantom cell row past the grid.
      return { y: cy >= g.rows ? g.rows * CELL_PX : cy * CELL_PX, mat: m };
    }
  }
  return null;
}

// Local surface normal from the 3x3 solid gradient. Points away from solid
// (into the open): flat ground -> (0, -1). Degenerate (no surface nearby —
// fully buried or fully open) -> (0, 0).
export function surfaceNormal(mw, x, y) {
  const g = mw.grid;
  const s = (dx, dy) =>
    isSolid(matAtPx(g, x + dx * CELL_PX, y + dy * CELL_PX)) ? 1 : 0;
  const gx = s(1, 0) - s(-1, 0);
  const gy = s(0, 1) - s(0, -1);
  const nx = -gx;
  const ny = -gy;
  const len = Math.hypot(nx, ny);
  if (len < 1e-9) return { nx: 0, ny: 0 };
  return { nx: nx / len, ny: ny / len };
}

// Count of AIR/WATER cells directly above (x, y) before the first solid
// cell — the burrow sense plumbing (§3.3).
export function headroom(mw, x, y) {
  const g = mw.grid;
  const cx = Math.floor(x / CELL_PX);
  let n = 0;
  for (let cy = Math.floor(y / CELL_PX) - 1; cy >= 0; cy--) {
    const m = cx >= 0 && cx < g.cols ? g.mat[cy * g.cols + cx] : MAT.AIR;
    if (m === MAT.AIR || m === MAT.WATER) n++;
    else break;
  }
  return n;
}
