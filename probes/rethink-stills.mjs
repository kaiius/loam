// Worldgen-rethink stills: 4 biomes showing continuous ground + real trees.
// Usage: node probes/rethink-stills.mjs [outdir]
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { SvgCtx } from '../test/svg-shim.mjs';
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';

const outdir = process.argv[2] || '/tmp/rethink-stills';
mkdirSync(outdir, { recursive: true });

const { render, biomesReady } = await import('../src/render/renderer.js');
await biomesReady();

const world = bindWorld(createWorld(7));
populate(world);
for (let t = 0; t < 120; t += 0.1) tickWorld(world, 0.1);
world.tick = Math.round(0.5 * world.dayTicks);
world.time = 0.5 * 24 * 3600;
for (let t = 0; t < 5; t += 0.1) tickWorld(world, 0.1);

// Four biomes from the layout's own regions (reliable): jungle with the
// largest extent (tree canopies), mountains (cliffs), desert (flat),
// shallows (mangroves).
const targets = ['jungle', 'mountains', 'desert', 'shallows'];
const biomes = [];
for (const key of targets) {
  let best = null;
  for (const r of world.layout.regions) {
    if (r.label !== key) continue;
    const w = r.x1 - r.x0;
    if (!best || w > best.x1 - best.x0) best = { x0: r.x0, x1: r.x1 };
  }
  if (best) biomes.push({ key, x0: best.x0, x1: best.x1, label: key });
  else console.log('no region for', key);
}

const W = 1440, H = 810;
for (const b of biomes) {
  world.tick = Math.round(0.5 * world.dayTicks);
  for (let t = 0; t < 5; t += 0.1) tickWorld(world, 0.1);
  const ctx = new SvgCtx(W, H);
  const fakeCanvas = { width: W, height: H, clientWidth: W, clientHeight: H };
  let bw = b.x1 - b.x0;
  let fx0 = b.x0, fx1 = b.x1;
  if (bw < 800) {
    const mid = (b.x0 + b.x1) / 2;
    fx0 = Math.max(0, mid - 400);
    fx1 = Math.min(world.width, mid + 400);
    bw = fx1 - fx0;
  }
  const scale = W / (bw * 1.15);
  const r = {
    canvas: fakeCanvas, ctx, scale, dpr: 1,
    ox: -fx0 * scale + (W - bw * scale) / 2,
    oy: H - 800 * scale - 40,
    stars: [], cam: { manual: true }, fitScale: scale,
    trails: new Map(), trailWorld: null,
  };
  let a = 1234567;
  const rnd = () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; };
  for (let i = 0; i < 140; i++) r.stars.push({ x: rnd(), y: rnd() * 0.6, s: rnd() });

  const cand = world.creatures.find((c) => c.alive && c.x >= b.x0 && c.x <= b.x1);
  const ui = { selected: cand || world.creatures[0] || null, hover: null, showCreatures: true };

  for (let f = 0; f < 12; f++) {
    for (let t = 0; t < 2; t += 0.1) tickWorld(world, 0.1);
    render(r, world, ui, 120 + f * 0.2);
  }

  const svg = ctx.toSVG();
  const svgPath = `${outdir}/rethink-${b.label}.svg`;
  const pngPath = `${outdir}/rethink-${b.label}.png`;
  writeFileSync(svgPath, svg);
  try {
    execSync(`python3 -c "
import cairosvg
cairosvg.svg2png(url='${svgPath}', write_to='${pngPath}', output_width=1440, output_height=810)
"`, { stdio: 'pipe' });
    console.log('wrote', pngPath);
  } catch (e) {
    console.log('cairosvg failed for', b.label, '— svg saved at', svgPath);
  }
}
console.log('done');
