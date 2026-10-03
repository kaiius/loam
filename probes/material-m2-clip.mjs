// M2 animation feasibility probe: 24 frames of a living world, 1 frame per
// 20 ticks, encoded to mp4. Proves the clip pipeline end to end.
// Usage: node probes/material-m2-clip.mjs [outdir]
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { SvgCtx } from '../test/svg-shim.mjs';
import {
  createMaterialWorld, addFounder, tickMaterialWorldM2,
} from '../src/material/index.js';
import { bodyDrawing } from '../src/material/body.js';
import { renderWorldView } from '../src/material/render.js';
import { CELL_PX } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';

const outdir = process.argv[2] || '/tmp/m2-clip';
mkdirSync(outdir, { recursive: true });

const W = 960, H = 540; // smaller for the probe
const mw = createMaterialWorld(7, 1);
mw.tick = 600;
const rng = createRng(21);
const c = addFounder(mw, rng);

const FRAMES = 24, TICKS_PER_FRAME = 20;
const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) {
  for (let t = 0; t < TICKS_PER_FRAME; t++) tickMaterialWorldM2(mw);
  const ctx = new SvgCtx(W, H);
  const view = {
    x: Math.max(0, Math.min(mw.cols * CELL_PX - W / 2, c.x - W / 4)),
    y: Math.max(0, Math.min(mw.rows * CELL_PX - H / 2, c.y - H / 2)),
    w: W / 2, h: H / 2,
  };
  renderWorldView(ctx, mw, view, {
    creature: { x: c.x, y: c.y, facing: c.facing, drawing: bodyDrawing(c.body) },
  });
  writeFileSync(`${outdir}/f${String(f).padStart(3, '0')}.svg`, ctx.toSVG());
}
console.log(`rendered ${FRAMES} frames in ${Date.now() - t0}ms`);

// SVG -> PNG -> mp4 (cairosvg may be slow; keep frames small for the probe).
execSync(`python3 -c "
import cairosvg, glob
for f in sorted(glob.glob('${outdir}/f*.svg')):
    cairosvg.svg2png(url=f, write_to=f.replace('.svg','.png'), output_width=${W}, output_height=${H})
"`, { stdio: 'pipe' });
execSync(`ffmpeg -y -loglevel error -framerate 8 -i ${outdir}/f%03d.png -c:v libx264 -pix_fmt yuv420p ${outdir}/m2-clip.mp4`, { stdio: 'pipe' });
console.log('wrote', `${outdir}/m2-clip.mp4`);
