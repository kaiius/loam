// Tests for the material-field renderer (M1).
// WORLD VIEW ONLY: no text, no UI — the SVG must carry the material field
// and nothing else.
// Run: node --test test/material-render.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SvgCtx } from './svg-shim.mjs';
import { generateMaterialWorld } from '../src/material/worldgen.js';
import { MAT } from '../src/material/grid.js';
import { renderWorldView } from '../src/material/render.js';

const W = 1440, H = 810;
const render = (mw, view, opts) => {
  const ctx = new SvgCtx(W, H);
  renderWorldView(ctx, mw, view, opts);
  return ctx.toSVG();
};
const FULL_VIEW = (mw) => ({ x: 0, y: 0, w: mw.cols * 10, h: mw.rows * 10 });

// --- runs without throwing on the still seeds --------------------------------

for (const seed of [7, 42, 99]) {
  test(`material-render: renders without throwing (seed ${seed})`, () => {
    const mw = generateMaterialWorld(seed, 1);
    const svg = render(mw, FULL_VIEW(mw));
    assert.ok(svg.length > 10000, 'emitted a real SVG scene');
    assert.ok(svg.includes('<rect'), 'scene contains cell rects');
  });
}

// --- sky vs tunnel air --------------------------------------------------------
// A sealed underground AIR pocket must render DARK (earth shadow), while the
// open sky renders as the sky gradient. The pocket is sealed on all sides by
// solid cells and not connected to the top row.

test('material-render: sealed underground air is dark, open sky is sky', () => {
  const mw = generateMaterialWorld(7, 1);
  const { grid, cols, rows } = mw;
  // Find a deep soil column and carve a sealed 4x3 pocket inside it.
  let pcx = -1, pcy = -1;
  outer: for (let cx = 60; cx < cols - 60; cx++) {
    for (let cy = 70; cy < 95; cy++) {
      let ok = true;
      for (let dy = -1; dy <= 3 && ok; dy++) for (let dx = -1; dx <= 4 && ok; dx++) {
        const m = grid.mat[(cy + dy) * cols + (cx + dx)];
        if (!(m === MAT.SOIL || m === MAT.ROCK || m === MAT.CLAY)) ok = false;
      }
      if (ok) { pcx = cx; pcy = cy; break outer; }
    }
  }
  assert.ok(pcx > 0, 'found a solid region to carve a pocket in');
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 4; dx++) {
    const i = (pcy + dy) * cols + (pcx + dx);
    grid.mat[i] = MAT.AIR; grid.dug[i] = 1;
  }
  const view = { x: (pcx - 10) * 10, y: (pcy - 10) * 10, w: 1440, h: 810 }; // scale 1
  const svg = render(mw, view);

  // The pocket's top-left cell rect: dark earth shadow, warm not blue.
  const px = 100, py = 100;
  const re = new RegExp(`<rect x="${px}" y="${py}"[^>]*fill="([^"]+)"`);
  const m = re.exec(svg);
  assert.ok(m, `pocket cell rect emitted at (${px},${py})`);
  const rgb = /rgb\((\d+),(\d+),(\d+)\)/.exec(m[1]);
  assert.ok(rgb, `pocket fill is an rgb color, got ${m[1]}`);
  const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  assert.ok(r < 70 && g < 60 && b < 50, `pocket is dark earth shadow, got rgb(${r},${g},${b})`);
  assert.ok(b < r, `pocket shadow is warm, not blue: rgb(${r},${g},${b})`);

  // Sky-connected air is never painted — the gradient shows through instead.
  // Exact accounting: every in-view cell except open-sky air must emit
  // exactly one cell rect (width/height 10.5 at scale 1).
  const cx0 = Math.max(0, Math.floor(view.x / 10) - 1);
  const cx1 = Math.min(cols - 1, Math.ceil((view.x + view.w) / 10) + 1);
  const cy0 = Math.max(0, Math.floor(view.y / 10) - 1);
  const cy1 = Math.min(rows - 1, Math.ceil((view.y + view.h) / 10) + 1);
  // Recompute sky the way the renderer does: flood from the top row.
  const sky = new Uint8Array(cols * rows);
  const stack = [];
  for (let x = 0; x < cols; x++) {
    if (grid.mat[x] === MAT.AIR && grid.water[x] <= 0.5) { sky[x] = 1; stack.push(x); }
  }
  while (stack.length) {
    const k = stack.pop(), kx = k % cols, ky = (k / cols) | 0;
    const push = (j) => { if (!sky[j] && grid.mat[j] === MAT.AIR && grid.water[j] <= 0.5) { sky[j] = 1; stack.push(j); } };
    if (kx > 0) push(k - 1);
    if (kx < cols - 1) push(k + 1);
    if (ky > 0) push(k - cols);
    if (ky < rows - 1) push(k + cols);
  }
  let total = 0, skySkipped = 0;
  const isSolid = (mm) => mm === MAT.SOIL || mm === MAT.SAND || mm === MAT.CLAY ||
    mm === MAT.ROCK || mm === MAT.WOOD || mm === MAT.DEADWOOD || mm === MAT.BEDROCK;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    total++;
    const k = cy * cols + cx;
    if (grid.mat[k] === MAT.AIR && grid.water[k] <= 0.5 && sky[k]) {
      // Open sky (fewer than 6 solid cells above within 12 — mirrors the
      // renderer's SKYLIGHT_MIN_AO = 0.5) is skipped: the gradient shows
      // through. Capped sky-connected air gets dimmed skylight and IS painted.
      let above = 0;
      for (let r = Math.max(0, cy - 12); r < cy; r++) if (isSolid(grid.mat[r * cols + cx])) above++;
      if (above < 6) skySkipped++;
    }
  }
  const cellRects = (svg.match(/<rect x="[^"]*" y="[^"]*" width="10\.5" height="10\.5"/g) || []).length;
  assert.ok(skySkipped > 0, 'the view contains open-sky cells to skip');
  assert.equal(cellRects, total - skySkipped, 'every non-open-sky cell painted exactly once; open sky skipped');

  // The sky gradient itself is present (soft blue → pale horizon).
  assert.ok(svg.includes('<linearGradient'), 'sky gradient emitted');
});

// --- no text, ever ------------------------------------------------------------

test('material-render: emits no text elements (world view only)', () => {
  for (const seed of [7, 42, 99]) {
    const mw = generateMaterialWorld(seed, 1);
    const svg = render(mw, FULL_VIEW(mw), { creature: { x: 1500, y: 600, facing: 1 } });
    assert.ok(!/<text[\s>]/.test(svg), `no <text> in seed ${seed} output`);
    assert.ok(!/fillText/.test(svg), 'no fillText artifacts');
  }
});

// --- determinism: same seed -> identical SVG -----------------------------------

test('material-render: same seed renders byte-identical SVG (zero RNG)', () => {
  const a = render(generateMaterialWorld(42, 1), { x: 200, y: 100, w: 1440, h: 810 });
  const b = render(generateMaterialWorld(42, 1), { x: 200, y: 100, w: 1440, h: 810 });
  assert.equal(a, b, 'identical SVG strings across runs');
});

// --- fire overlay -------------------------------------------------------------

test('material-render: heat > 0.5 paints an ember overlay', () => {
  const mw = generateMaterialWorld(7, 1);
  const { grid, cols } = mw;
  const cx = 120, cy = 60;
  const i = cy * cols + cx;
  grid.mat[i] = MAT.DEADWOOD;
  grid.heat[i] = 0.9;
  const svg = render(mw, { x: (cx - 10) * 10, y: (cy - 10) * 10, w: 400, h: 400 });
  assert.ok(svg.includes('rgb(255, 118, 22)'), 'ember-orange overlay emitted for hot cell');
});

// --- creature overlay is optional and humble ----------------------------------

test('material-render: creature overlay draws, and is skippable', () => {
  const mw = generateMaterialWorld(7, 1);
  const view = { x: 1400, y: 400, w: 1440, h: 810 };
  const withC = render(mw, view, { creature: { x: 2100, y: 700, facing: -1 } });
  const withoutC = render(mw, view);
  assert.ok(withC.length > withoutC.length, 'creature adds shapes to the scene');
  assert.ok(withC.includes('<ellipse'), 'creature body drawn as ellipse');
});
