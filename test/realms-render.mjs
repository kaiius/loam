// Realms render checks (v0.18 "Realms"). Headless: builds a world, renders
// one frame through the SVG shim, and asserts the new render surface holds
// up — no crash, no NaN, water rects flow from the biomes module, all 8
// biome keys are paintable, predators draw and inspect cleanly.
// Run: node --test test/realms-render.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SvgCtx } from './svg-shim.mjs';
import * as wmod from '../src/sim/world.js';
import { createWorld, bindWorld, tickWorld, addPlant, addFood } from '../src/sim/world.js';
import { render, biomesReady } from '../src/render/renderer.js';
import { BIOME_KEYS, biomeGroundInfo, drawWater, drawWaters, drawPredator, smoothGroundAt, seaSurfaceYAt, FLOW_TRANS } from '../src/render/painter.js';
import * as BIO from '../src/sim/biomes.js';
import { describeEntity } from '../src/sim/observer.js';

const populateWorld = wmod.populateGenesis || wmod.populate;

function fakeRenderer() {
  const W = 1440, H = 810;
  const ctx = new SvgCtx(W, H);
  const fakeCanvas = { width: W, height: H, clientWidth: W, clientHeight: H };
  const r = {
    canvas: fakeCanvas, ctx, scale: 1, ox: 0, oy: 0, dpr: 1,
    stars: [], cam: { manual: true }, fitScale: 1,
  };
  let a = 1234567;
  const rnd = () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; };
  for (let i = 0; i < 140; i++) r.stars.push({ x: rnd(), y: rnd() * 0.6, s: rnd() });
  return r;
}

test('all 8 biome keys are paintable', () => {
  assert.equal(BIOME_KEYS.length, 8);
  for (const k of BIOME_KEYS) {
    const info = biomeGroundInfo(k);
    assert.ok(info, `ground info for ${k}`);
    assert.ok(info.name && info.tint, `name + tint for ${k}`);
  }
  assert.equal(biomeGroundInfo('nope'), null);
});

test('drawWater emits a body rect + surface line; salt vs fresh differ', () => {
  for (const salt of [true, false]) {
    const ctx = new SvgCtx(200, 200);
    drawWater(ctx, { x0: 10, x1: 190, surfaceY: 60, salt }, 200, 1);
    const svg = ctx.toSVG();
    assert.ok(svg.includes('<rect'), 'water rect emitted');
    assert.ok(!svg.includes('NaN'), 'no NaN in water');
  }
  const a = new SvgCtx(200, 200);
  drawWater(a, { x0: 0, x1: 10, surfaceY: 5, salt: true }, 200, 1);
  const b = new SvgCtx(200, 200);
  drawWater(b, { x0: 0, x1: 10, surfaceY: 5, salt: false }, 200, 1);
  assert.notEqual(a.toSVG(), b.toSVG(), 'salt vs fresh tints differ');
  // degenerate rects draw nothing and never crash
  const c = new SvgCtx(200, 200);
  drawWater(c, { x0: 50, x1: 50, surfaceY: NaN, salt: false }, 200, 1);
  assert.ok(!c.toSVG().includes('NaN'));
});

test('drawPredator draws shark and bear distinctly, never crashes', () => {
  const svgs = {};
  for (const kind of ['shark', 'bear']) {
    const ctx = new SvgCtx(400, 400);
    drawPredator(ctx, { kind, x: 200, y: 200, r: 26, id: 1, hunting: kind === 'shark' }, 1.0, 1);
    const svg = ctx.toSVG();
    assert.ok(svg.length > 200, `${kind} drew something`);
    assert.ok(!svg.includes('NaN'), `no NaN in ${kind}`);
    svgs[kind] = svg;
  }
  assert.notEqual(svgs.shark, svgs.bear, 'shark and bear read differently');
  // hunting shark tints the eyes red
  const calm = new SvgCtx(400, 400);
  drawPredator(calm, { kind: 'shark', x: 200, y: 200, r: 26, id: 1 }, 1.0, 1);
  const hunting = new SvgCtx(400, 400);
  drawPredator(hunting, { kind: 'shark', x: 200, y: 200, r: 26, id: 1, hunting: true }, 1.0, 1);
  assert.notEqual(calm.toSVG(), hunting.toSVG(), 'hunting state is visible');
  assert.ok(hunting.toSVG().includes('224,52,43'), 'hunting eyes tint red');
  // unknown kind falls back to the bear body — never blank, never NaN
  const u = new SvgCtx(400, 400);
  drawPredator(u, { kind: 'mystery', x: 200, y: 200 }, 1.0, 1);
  assert.ok(!u.toSVG().includes('NaN'));
});

test('predator + new food kinds survive the inspector', () => {
  const world = bindWorld(createWorld(11));
  const shark = describeEntity(world, { kind: 'shark', id: 5, x: 4300, y: 800, damage: 0.8, hunting: true });
  assert.ok(shark, 'shark describes');
  assert.equal(shark.title, 'Shark');
  assert.ok(shark.rows.some(([l]) => l === 'Range limit'), 'shark range limit shown');
  assert.ok(shark.rows.some(([l, v]) => l === 'Damage' && /0\.80/.test(v)), 'damage shown');
  const bear = describeEntity(world, { kind: 'bear', id: 6, x: 200, y: 760 });
  assert.ok(bear && bear.title === 'Bear', 'bear describes');
  assert.ok(bear.rows.some(([l, v]) => l === 'Damage' && /not modeled/.test(v)), 'missing damage is honest');
  for (const fk of ['bug', 'minnow', 'corpse']) {
    const d = describeEntity(world, {
      kind: 'food', id: 99, foodKind: fk, x: 300, y: 700,
      nutrition: 1, amount: 1, rotsAt: 0,
    });
    assert.ok(d, `${fk} describes without crashing`);
  }
});

test('headless realms frame: no crash, no NaN, water + biomes flow', async () => {
  const B = await biomesReady(); // the biomes module is landed; render must use it
  const world = bindWorld(createWorld(7));
  populateWorld(world);
  // every plant morph through the real render path
  const morphs = ['tree', 'grass', 'cactus', 'shrub', 'moss', 'mangrove', 'palm', 'kelp'];
  morphs.forEach((morph, i) => {
    const before = world.plants.length;
    addPlant(world, 100 + i * 60, 1);
    const p = world.plants[before];
    if (p) { p.morph = morph; p.growth = 1; p.sway = 0.5; }
  });
  // new food kinds + predators through the real render path
  for (const fk of ['bug', 'minnow', 'corpse']) addFood(world, 300, 0, fk, 1);
  world.predators = [
    { kind: 'shark', id: 1, x: 1400, y: 850, r: 26, hunting: true },
    { kind: 'bear', id: 2, x: 400, y: 760, r: 24 },
  ];
  for (let t = 0; t < 5; t += 0.1) tickWorld(world, 0.1);
  const r = fakeRenderer();
  const ui = { selected: world.predators[0], hover: null }; // exercises the predator inspect ring
  render(r, world, ui, 5);
  const svg = r.ctx.toSVG();
  assert.ok(svg.length > 1000, 'a frame was produced');
  assert.ok(!svg.includes('NaN'), 'no NaN anywhere in the frame');

  // contract surface: water rects appear and all 8 biome keys render
  assert.ok(B, 'biomes module resolved');
  const rects = B.waterRects();
  assert.ok(Array.isArray(rects) && rects.length > 0, 'water rects exist');
  for (const wr of rects) {
    assert.ok(wr.x1 > wr.x0 && isFinite(wr.surfaceY), 'water rect is sane');
  }
  assert.equal(B.WORLD_W, 4800);
  assert.equal(B.WORLD_H, 1100);
  const seen = new Set();
  for (let x = 0; x < B.WORLD_W; x += 100) seen.add(B.biomeKeyAt(x, B.WORLD_H * 0.5));
  for (const k of BIOME_KEYS) assert.ok(seen.has(k), `biome ${k} sampled from biomeKeyAt`);
});

test('v0.20 flow: smoothGroundAt eases small steps, blends palettes, keeps cliffs', () => {
  // deep interior: untouched sim answer
  const mid = smoothGroundAt(BIO, 300);
  assert.deepEqual(mid, { top: 800, rgb: [216, 230, 242] });
  // arctic(800, pale) -> mountains(800, dark) at x=600: same top, blended color
  const at = smoothGroundAt(BIO, 600);
  assert.equal(at.top, 800);
  assert.deepEqual(at.rgb, [145, 154, 165]); // midpoint of [216,230,242] and [74,78,88]
  // jungle(800) -> plains(820) at x=1800: 20px step eases into a slope
  const j = smoothGroundAt(BIO, 1800);
  assert.equal(j.top, 810); // midpoint of the eased slope
  assert.deepEqual(j.rgb, [106, 148, 83]); // jungle [86,128,74] <-> plains [126,168,92]
  // desert(830) -> shallows(950) at x=3000: a 120px cliff keeps its face
  assert.equal(smoothGroundAt(BIO, 2999).top, 830);
  assert.equal(smoothGroundAt(BIO, 3001).top, 950);
  // ...but the palette still cross-fades across the cliff band
  const west = smoothGroundAt(BIO, 2960).rgb, east = smoothGroundAt(BIO, 3040).rgb;
  assert.ok(west[0] > east[0], `sand fades eastward (${west} -> ${east})`);
  // open water: nothing to paint
  assert.equal(smoothGroundAt(BIO, 3900), null); // archipelago channel
  // outside any transition band: the plain sim answer
  assert.deepEqual(smoothGroundAt(BIO, 1500), { top: 800, rgb: [86, 128, 74] });
});

test('v0.20 flow: seaSurfaceYAt is one continuous surface', () => {
  assert.equal(seaSurfaceYAt(3000), 800);
  assert.equal(seaSurfaceYAt(3600), 800);
  assert.equal(seaSurfaceYAt(4200), 750); // eased midpoint of the deep drop
  assert.equal(seaSurfaceYAt(4500), 700);
  assert.equal(seaSurfaceYAt(2999), null);
  assert.equal(seaSurfaceYAt(4800), null);
  // monotonic eastward, no jumps bigger than the sampling step allows
  // (smoothstep's steepest 20px step drops ~12.5px at the midpoint)
  let prev = seaSurfaceYAt(3000);
  for (let x = 3020; x < 4800; x += 20) {
    const s = seaSurfaceYAt(x);
    assert.ok(s <= prev && prev - s <= 14, `smooth descent at x=${x} (${prev} -> ${s})`);
    prev = s;
  }
});

test('v0.20 flow: drawWaters paints ponds + one sea without crashing', () => {
  const ctx = new SvgCtx(1440, 810);
  drawWaters(ctx, BIO, 1100, 1.0);
  const svg = ctx.toSVG();
  assert.ok(svg.length > 500, 'water was painted');
  assert.ok(!svg.includes('NaN'), 'no NaN in the water layer');
});
