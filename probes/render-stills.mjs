// Combo-pass stills: render 3 biomes in the new style for eye-checking.
// Usage: node probes/render-stills.mjs [outdir]
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { SvgCtx } from '../test/svg-shim.mjs';
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';

const outdir = process.argv[2] || '/tmp/combo-stills';
mkdirSync(outdir, { recursive: true });

const { render, biomesReady } = await import('../src/render/renderer.js');
await biomesReady();

const world = bindWorld(createWorld(7));
populate(world);
// Tick enough for trails to develop and creatures to spread out.
for (let t = 0; t < 120; t += 0.1) tickWorld(world, 0.1);
// Force midday for the beauty shot: tick clock to solar noon.
world.tick = Math.round(0.5 * world.dayTicks);
world.time = 0.5 * 24 * 3600;
for (let t = 0; t < 5; t += 0.1) tickWorld(world, 0.1);

// Find the largest region for each target biome by sampling biomeKeyAt
// (the layout.regions list doesn't always match the biome system's answer).
// Sampled at y=550 (mid-sky); desert/shallows sit lower and don't appear.
const targets = ['jungle', 'plains', 'arctic'];
const biomes = [];
const Bmod = await import('../src/sim/biomes.js');
for (const key of targets) {
  let best = null, runStart = -1;
  for (let x = 0; x <= world.width; x += 20) {
    let bk = null;
    try { bk = Bmod.biomeKeyAt(x, 550, world); } catch (e) { /* skip */ }
    if (bk === key) {
      if (runStart < 0) runStart = x;
    } else {
      if (runStart >= 0) {
        const w = x - runStart;
        if (!best || w > best.x1 - best.x0) best = { x0: runStart, x1: x };
        runStart = -1;
      }
    }
  }
  if (runStart >= 0) {
    const w = world.width - runStart;
    if (!best || w > best.x1 - best.x0) best = { x0: runStart, x1: world.width };
  }
  if (best) biomes.push({ key, x0: best.x0, x1: best.x1, label: key });
  else console.log('no region for', key);
}
// Fallback: frame the creatures if a biome has no region.
if (!biomes.length) {
  const xs = world.creatures.filter((c) => c.alive).map((c) => c.x);
  const x0 = Math.min(...xs) - 100, x1 = Math.max(...xs) + 100;
  biomes.push({ key: 'creatures', x0, x1, label: 'creatures' });
}

const W = 1440, H = 810;
for (const b of biomes) {
  // Reset to midday before each biome so all stills share the same light.
  world.tick = Math.round(0.5 * world.dayTicks);
  for (let t = 0; t < 5; t += 0.1) tickWorld(world, 0.1);
  const ctx = new SvgCtx(W, H);
  const fakeCanvas = { width: W, height: H, clientWidth: W, clientHeight: H };
  // Frame the biome: fit its x-range into the view (minimum 800px wide so
  // tiny regions like desert don't zoom to absurdity).
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

  // Select a creature in this biome to show the readout card.
  const cand = world.creatures.find((c) => c.alive && c.x >= b.x0 && c.x <= b.x1);
  const ui = { selected: cand || world.creatures[0] || null, hover: null, showCreatures: true };

  // A few frames so trails have length.
  for (let f = 0; f < 12; f++) {
    for (let t = 0; t < 2; t += 0.1) tickWorld(world, 0.1);
    render(r, world, ui, 120 + f * 0.2);
  }

  const svg = ctx.toSVG();
  const svgPath = `${outdir}/combo-${b.label}.svg`;
  const pngPath = `${outdir}/combo-${b.label}.png`;
  writeFileSync(svgPath, svg);
  execSync(`python3 -c "
import cairosvg
cairosvg.svg2png(url='${svgPath}', write_to='${pngPath}', output_width=1440, output_height=810)
"`);
  console.log('wrote', pngPath);
}
console.log('done');
