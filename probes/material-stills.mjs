// Material-world M1 stills: 3 composed PNG scenes at 1440x810.
// Usage: node probes/material-stills.mjs [outdir]
// Renders the material FIELD (no UI, no text) via renderWorldView -> SvgCtx
// -> cairosvg PNG. For Joshua's eyes.
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { SvgCtx } from '../test/svg-shim.mjs';
import { generateMaterialWorld } from '../src/material/worldgen.js';
import { MAT, CELL_PX } from '../src/material/grid.js';
import { renderWorldView } from '../src/material/render.js';

const outdir = process.argv[2] || '/home/hatch/workspace/canopy-v020/previews/material-m1';
mkdirSync(outdir, { recursive: true });

const W = 1440, H = 810;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function toPng(name, mw, view, opts) {
  const ctx = new SvgCtx(W, H);
  renderWorldView(ctx, mw, view, opts);
  const svg = ctx.toSVG();
  const svgPath = `${outdir}/${name}.svg`;
  const pngPath = `${outdir}/${name}.png`;
  writeFileSync(svgPath, svg);
  try {
    execSync(`python3 -c "
import cairosvg
cairosvg.svg2png(url='${svgPath}', write_to='${pngPath}', output_width=1440, output_height=810)
"`, { stdio: 'pipe' });
    console.log('wrote', pngPath);
  } catch (e) {
    console.log('cairosvg failed for', name, '— svg saved at', svgPath);
  }
}

function fitView(mw, cxPx, cyPx) {
  return {
    x: clamp(Math.round(cxPx - W / 2), 0, mw.cols * CELL_PX - W),
    y: clamp(Math.round(cyPx - H / 2), 0, mw.rows * CELL_PX - H),
    w: W, h: H,
  };
}

// --- still 1: seed 7, the largest grown plant — canopy + terrain -----------
{
  const mw = generateMaterialWorld(7, 1);
  const top = mw.plants.slice().sort((a, b) => (b.wood + b.leaf) - (a.wood + a.leaf))[0];
  console.log('still 1: largest plant', { id: top.id, seedX: top.seedX, seedY: top.seedY, wood: top.wood, leaf: top.leaf, iters: top.iters });
  // Center slightly above the seed cell so the crown and the ground both read.
  const view = fitView(mw, top.seedX * CELL_PX, top.seedY * CELL_PX - 120);
  console.log('still 1: view', view);
  // A tanglekin at the tree's foot, for scale — humble, facing the trunk.
  // Grounded on the ACTUAL surface at its own column (never floating).
  const ccx = top.seedX + 6;
  const creature = { x: ccx * CELL_PX, y: mw.surf[ccx] * CELL_PX, facing: -1 };
  toPng('material-m1-jungle', mw, view, { creature });
}

// --- still 2: seed 42, open water + shoreline + terrain ----------------------
{
  const mw = generateMaterialWorld(42, 1);
  const { grid, cols, rows, surf, seaRow } = mw;
  // Find the longest run of submerged columns (surf below sea level): a sea
  // or lake. Center the view on the run's shoreline edge so the frame holds
  // open water, the waterline, and the land rising beyond it.
  let runStart = -1, bestStart = 0, bestLen = 0;
  for (let cx = 0; cx <= cols; cx++) {
    const submerged = cx < cols && surf[cx] > seaRow;
    if (submerged && runStart < 0) runStart = cx;
    if (!submerged && runStart >= 0) {
      if (cx - runStart > bestLen) { bestLen = cx - runStart; bestStart = runStart; }
      runStart = -1;
    }
  }
  // Shoreline = the landward edge of the longest water run.
  const shoreCx = bestLen > 0 ? bestStart + bestLen : Math.floor(cols / 2);
  console.log('still 2: longest water run', bestLen, 'cols, shoreline at col', shoreCx, 'seaRow', seaRow);
  // Reframe on the largest actual water body instead: flood-fill MAT.WATER.
  const seen = new Uint8Array(cols * rows);
  let best = { n: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let s = 0; s < cols * rows; s++) {
    if (grid.mat[s] !== MAT.WATER || seen[s]) continue;
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const st = [s]; seen[s] = 1;
    while (st.length) {
      const k = st.pop(); n++;
      const x = k % cols, y = (k / cols) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [k - 1, k + 1, k - cols, k + cols]) {
        if (j >= 0 && j < cols * rows && !seen[j] && grid.mat[j] === MAT.WATER) { seen[j] = 1; st.push(j); }
      }
    }
    if (n > best.n) best = { n, x0, y0, x1, y1 };
  }
  const wcx = (best.x0 + best.x1) / 2, wcy = (best.y0 + best.y1) / 2;
  console.log('still 2: largest water', best.n, 'cells, bbox cols', best.x0 + '-' + best.x1, 'rows', best.y0 + '-' + best.y1);
  // Water slightly below center: sky and the land rising beyond it above,
  // depth-darkened earth below.
  const view = fitView(mw, wcx * CELL_PX, wcy * CELL_PX - 170);
  console.log('still 2: view', view);
  toPng('material-m1-water', mw, view, {});
}

// --- still 3: seed 99, a dug burrow — depth shadows + embers -----------------
{
  const mw = generateMaterialWorld(99, 1);
  const { grid, cols, rows, surf } = mw;
  // Pick a solid-soil surface column away from water.
  let tc = -1;
  for (let cx = 200; cx < 320; cx++) {
    const s = surf[cx];
    if (s < mw.seaRow - 10 && grid.mat[s * cols + cx] === MAT.SOIL) { tc = cx; break; }
  }
  if (tc < 0) tc = 260;
  const top = surf[tc];
  const dig = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const i = cy * cols + cx;
    grid.mat[i] = MAT.AIR; grid.dug[i] = 1; grid.water[i] = 0;
  };
  // Vertical shaft, then a horizontal burrow with a chamber at the end.
  for (let cy = top; cy < top + 12; cy++) dig(tc, cy);
  for (let cx = tc - 1; cx < tc + 22; cx++) { dig(cx, top + 11); dig(cx, top + 12); }
  for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) dig(tc + 21 + dx, top + 11 + dy);
  console.log('still 3: burrow at col', tc, 'surface row', top);
  // A small ember patch in the chamber: deadwood embers (fire overlay demo).
  // Placed programmatically like the dug tunnel itself — a renderer demo,
  // not a worldgen claim.
  const ex = tc + 21, ey = top + 11;
  const ei = ey * cols + ex;
  grid.mat[ei] = MAT.DEADWOOD; grid.heat[ei] = 0.95;
  const ei2 = ey * cols + ex + 1;
  grid.mat[ei2] = MAT.DEADWOOD; grid.heat[ei2] = 0.7;
  console.log('still 3: ember cells lit at', ex + ',' + ey);
  const view = fitView(mw, (tc + 10) * CELL_PX, (top + 8) * CELL_PX);
  console.log('still 3: view', view);
  // Grounded on the actual surface at its own column — never floating.
  const mcx = tc - 4;
  const creature = { x: mcx * CELL_PX, y: mw.surf[mcx] * CELL_PX, facing: 1 };
  toPng('material-m1-burrow', mw, view, { creature });
}

console.log('done');
