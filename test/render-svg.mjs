// Renders real game frames to SVG (via the shim) for visual QA.
import { writeFileSync } from 'fs';
import { SvgCtx } from './svg-shim.mjs';
import { createWorld, bindWorld, populate, tickWorld, layEgg } from '../src/sim/world.js';
import { randomGenome } from '../src/sim/genome.js';
import { render } from '../src/render/renderer.js';

const seed = Number(process.argv[2] || 7);
const simSeconds = Number(process.argv[3] || 45);
const outPng = process.argv[4] || '/tmp/wc-frame.png';

const world = bindWorld(createWorld(seed));
populate(world);
// Keep a fresh egg around so the egg-drawing path gets exercised.
layEgg(world, 1050, 0, randomGenome(world.rng), null);
for (let t = 0; t < simSeconds; t += 0.1) tickWorld(world, 0.1);
if (!world.eggs.length) layEgg(world, 1050, 0, randomGenome(world.rng), null);

const W = 1440, H = 810;
const ctx = new SvgCtx(W, H);
const fakeCanvas = { width: W, height: H, clientWidth: W, clientHeight: H };
const r = { canvas: fakeCanvas, ctx, scale: 1, ox: 0, oy: 0, dpr: 1, stars: [], cam: { manual: true, x: 800, y: 400, zoom: 1 }, fitScale: 1 };
let a = 1234567;
const rnd = () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; };
for (let i = 0; i < 140; i++) r.stars.push({ x: rnd(), y: rnd() * 0.6, s: rnd() });

// Select the egg if there is one (exercises egg selection), else a creature.
const ui = { selected: world.eggs[0] || world.creatures[0] || null, hover: null };
render(r, world, ui, simSeconds);

const svg = ctx.toSVG();
writeFileSync('/tmp/wc-frame.svg', svg);

// Rasterize with cairosvg.
const { execSync } = await import('child_process');
execSync(`python3 -c "
import cairosvg
cairosvg.svg2png(url='/tmp/wc-frame.svg', write_to='${outPng}', output_width=1440, output_height=810)
"`);
console.log('wrote', outPng, '| creatures:', world.creatures.length,
  world.creatures.map((c) => `${c.name}@${c.x.toFixed(0)}:${c.actionLabel}`).join(' '));
