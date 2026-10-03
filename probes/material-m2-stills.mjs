// Material-world M2 stills: the living creature, for Joshua's eyes.
// Usage: node probes/material-m2-stills.mjs [outdir]
// 3 scenes at 1440x810: world view (grown body), inspect view (instruments
// on), and a burrow cross-section after forced digging.
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { SvgCtx } from '../test/svg-shim.mjs';
import {
  createMaterialWorld, addFounder, tickMaterialWorldM2, lastActionName,
  spawnMaterialCreature,
} from '../src/material/index.js';
import { bodyDrawing } from '../src/material/body.js';
import { renderWorldView, renderInspectView } from '../src/material/render.js';
import { CELL_PX, MAT } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';
import { ACTIONS } from '../src/material/brain.js';

const outdir = process.argv[2] || '/home/hatch/workspace/canopy-v020/previews/material-m2';
mkdirSync(outdir, { recursive: true });

const W = 1440, H = 810;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function toPng(name, renderFn) {
  const ctx = new SvgCtx(W, H);
  renderFn(ctx);
  const svgPath = `${outdir}/${name}.svg`;
  const pngPath = `${outdir}/${name}.png`;
  writeFileSync(svgPath, ctx.toSVG());
  try {
    execSync(`python3 -c "
import cairosvg
cairosvg.svg2png(url='${svgPath}', write_to='${pngPath}', output_width=1440, output_height=810)
"`, { stdio: 'pipe' });
    console.log('wrote', pngPath);
  } catch (e) {
    console.log('cairosvg failed for', name, '— svg at', svgPath);
  }
}

function fitView(mw, cxPx, cyPx, zoom = 1) {
  // zoom 2 = half the world width in frame: the creature stops being a speck.
  const vw = W / zoom, vh = H / zoom;
  return {
    x: clamp(Math.round(cxPx - vw / 2), 0, mw.cols * CELL_PX - vw),
    y: clamp(Math.round(cyPx - vh / 2), 0, mw.rows * CELL_PX - vh),
    w: vw, h: vh,
  };
}

// A brown-furred founder for the portraits (the sim keeps full hue
// variation; the stills curate one readable animal).
function brownFounder(mw, rng) {
  for (let tries = 0; tries < 50; tries++) {
    const c = addFounder(mw, rng);
    const hue = c.body.pheno.hueDeg;
    if (hue >= 10 && hue <= 50) return c;
    mw.m2creatures.pop();
  }
  return addFounder(mw, rng); // fallback: whatever the genome gave
}

function creatureOpt(c) {
  return { x: c.x, y: c.y, facing: c.facing, drawing: bodyDrawing(c.body) };
}

// --- still 1: a founder living 500 ticks, world view -------------------------
{
  const mw = createMaterialWorld(7, 1);
  mw.tick = 600; // noon
  const rng = createRng(21);
  const c = brownFounder(mw, rng);
  for (let t = 0; t < 500; t++) tickMaterialWorldM2(mw);
  console.log('still 1: after 500 ticks', {
    alive: c.alive, x: Math.round(c.x), y: Math.round(c.y),
    action: lastActionName(c), hunger: (1 - c.chem.bloodSugar).toFixed(2),
    piled: c.piled, dumped: c.dumped,
    height: Math.round(c.body.heightPx), grasp: c.body.graspPairs,
  });
  const view = fitView(mw, c.x, c.y - 120, 2);
  toPng('m2-living-world', (ctx) => renderWorldView(ctx, mw, view, { creature: creatureOpt(c) }));
}

// --- still 2: inspect view of the same moment --------------------------------
{
  const mw = createMaterialWorld(7, 1);
  mw.tick = 600;
  const rng = createRng(21);
  const c = brownFounder(mw, rng);
  for (let t = 0; t < 500; t++) tickMaterialWorldM2(mw);
  const view = fitView(mw, c.x, c.y - 120, 2);
  const ccx = Math.floor(c.x / CELL_PX), ccy = Math.floor(c.y / CELL_PX);
  toPng('m2-inspect', (ctx) => renderInspectView(ctx, mw, view, {
    creature: { ...creatureOpt(c), chem: c.chem, body: c.body, minerals: c.minerals, lastReward: c.lastReward, carried: c.carried, piled: c.piled },
    actionName: lastActionName(c),
    inspect: { cx: ccx, cy: ccy },
  }));
}

// --- still 3: the burrow — a dug tunnel in cross-section ----------------------
// A synthetic cutaway: soil block with a 2-tall dug tunnel (dug=1, the
// mechanic's own flag), the creature inside it. The tunnel is real grid
// state, not a drawing.
{
  const { createGrid } = await import('../src/material/grid.js');
  const cols = 90, rows = 60;
  const grid = createGrid(cols, rows);
  for (let y = 30; y < rows; y++)
    for (let x = 0; x < cols; x++) grid.mat[y * cols + x] = MAT.SOIL;
  // The tunnel: rows 38-39, cols 20-55, dug by the mechanic.
  for (let x = 20; x < 56; x++) for (let y = 38; y < 40; y++) {
    const i = y * cols + x;
    grid.mat[i] = MAT.AIR; grid.dug[i] = 1;
  }
  // A piled soil cell at the tunnel mouth (the pile mechanic's product).
  grid.mat[37 * cols + 18] = MAT.SOIL; grid.dug[37 * cols + 18] = 1;
  const mw = {
    seed: 42, tick: 600, grid, cols, rows, plants: [], bonds: new Map(),
    surf: new Array(cols).fill(30), seaRow: 55, fireOn: false, permanentTunnels: true,
  };
  const rng = createRng(33);
  const { randomGenome } = await import('../src/sim/genome.js');
  const c2 = spawnMaterialCreature(mw, randomGenome(rng, {}), 38 * CELL_PX, 40 * CELL_PX - 2);
  c2.facing = -1;
  // Brown fur for the portrait.
  let tries = 0;
  while ((c2.body.pheno.hueDeg < 10 || c2.body.pheno.hueDeg > 50) && tries++ < 40) {
    const g2 = randomGenome(rng, {});
    const { growBody } = await import('../src/material/body.js');
    c2.body = growBody(g2, { stage: 'adult' });
  }
  console.log('still 3: burrow portrait, tunnel cols 20-55, creature inside');
  const view = { x: 10 * CELL_PX, y: 28 * CELL_PX, w: 70 * CELL_PX, h: 70 * CELL_PX * H / W };
  toPng('m2-burrow', (ctx) => renderWorldView(ctx, mw, view, { creature: creatureOpt(c2) }));
}

console.log('done →', outdir);
