// Loam beauty-pass stills — for the eye-check, not the suite.
// Usage: node probes/material-beauty-stills.mjs [outdir]
// Renders: noon meadow, dawn, night, rain storm, fire, creature close-ups.
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { SvgCtx } from '../test/svg-shim.mjs';
import {
  createMaterialWorld, tickMaterialWorldM2,
} from '../src/material/index.js';
import { seedEcology } from '../src/material/species.js';
import { portraitFor } from '../src/material/portrait.js';
import { renderWorldView } from '../src/material/render.js';
import { CELL_PX } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';

const outdir = process.argv[2] || '/home/hatch/workspace/canopy-v020/previews/material-beauty';
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
  const vw = W / zoom, vh = H / zoom;
  return {
    x: clamp(Math.round(cxPx - vw / 2), 0, mw.cols * CELL_PX - vw),
    y: clamp(Math.round(cyPx - vh / 2), 0, mw.rows * CELL_PX - vh),
    w: vw, h: vh,
  };
}

function creatureOpt(c, tick) {
  return { x: c.x, y: c.y, facing: c.facing, species: c.species, drawing: portraitFor(c, tick) };
}

function makeWorld(ticks, seed = 7) {
  const mw = createMaterialWorld(seed, 1);
  mw.tick = 600; // noon baseline
  seedEcology(mw, createRng(0x9e37));
  for (let t = 0; t < ticks; t++) tickMaterialWorldM2(mw);
  return mw;
}

const living = (mw) => mw.m2creatures.filter((c) => c.alive);

// --- still 1: noon, wide -------------------------------------------------------
{
  const mw = makeWorld(400);
  const f = mw.m2creatures.find((c) => c.species === 'tanglekin' && c.alive) || living(mw)[0];
  toPng('beauty-noon', (ctx) => {
    renderWorldView(ctx, mw, fitView(mw, f.x, f.y, 1.1),
      { creatures: living(mw).map((c) => creatureOpt(c, mw.tick)) });
  });
  console.log('noon: tick', mw.tick, 'living', living(mw).length);
}

// --- still 2: dawn ---------------------------------------------------------------
{
  const mw = makeWorld(400);
  mw.tick = 60; // dawn
  const f = living(mw)[0];
  toPng('beauty-dawn', (ctx) => {
    renderWorldView(ctx, mw, fitView(mw, f.x, f.y, 1.1),
      { creatures: living(mw).map((c) => creatureOpt(c, mw.tick)) });
  });
}

// --- still 3: night -----------------------------------------------------------------
{
  const mw = makeWorld(400);
  mw.tick = 1800; // midnight
  const f = living(mw)[0];
  toPng('beauty-night', (ctx) => {
    renderWorldView(ctx, mw, fitView(mw, f.x, f.y, 1.1),
      { creatures: living(mw).map((c) => creatureOpt(c, mw.tick)) });
  });
}

// --- still 4: creature close-ups — one per species ---------------------------------------
{
  const mw = makeWorld(200);
  const seen = new Map();
  for (const c of living(mw)) if (!seen.has(c.species)) seen.set(c.species, c);
  let i = 0;
  for (const [sp, c] of seen) {
    toPng(`beauty-sp-${sp}`, (ctx) => {
      renderWorldView(ctx, mw, fitView(mw, c.x, c.y, 4), { creatures: [creatureOpt(c, mw.tick)] });
    });
    if (++i > 12) break;
  }
  console.log('species in frame:', [...seen.keys()].join(', '));
}
console.log('done');
