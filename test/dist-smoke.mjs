// Dist smoke: executes the ACTUAL bundled dist/index.html (not src/) with DOM
// stubs, pumping frames through its own rAF loop. This is the regression test
// for 2026-09-29: scripts/build.js silently dropped src/sim/social.js from the
// MODULES list, so dist threw `createBonds is not defined` and rendered blank —
// while test/sim.mjs and test/headless.mjs (both import from src/) stayed green.
// Run after every build:  node scripts/build.js && node test/dist-smoke.mjs

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 42 });
      if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (p === 'getImageData') return () => ({ data: [] });
      return (...a) => undefined;
    },
    set() { return true; },
  });
}

function makeElement() {
  const el = {
    style: {},
    children: [],
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { el.children.push(c); return c; },
    remove() {},
    addEventListener() {},
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    set innerHTML(v) { el._html = v; },
    get innerHTML() { return el._html || ''; },
    set textContent(v) { el._text = v; },
    get textContent() { return el._text || ''; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1440, height: 810 }; },
    clientWidth: 1440, clientHeight: 810,
    width: 0, height: 0,
    onclick: null,
  };
  el.getContext = () => makeCtx();
  return el;
}

const canvasEl = makeElement();
global.window = {
  addEventListener() {},
  devicePixelRatio: 1,
  innerWidth: 1440, innerHeight: 810,
};
global.document = {
  createElement: () => makeElement(),
  body: makeElement(),
  getElementById: () => canvasEl,
};
global.performance = { now: () => Date.now() };
let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no <script> block found in dist/index.html');

// Indirect eval in global scope, like a browser <script> tag.
(0, eval)(m[1]);

if (typeof rafCb !== 'function') throw new Error('dist did not schedule a frame — init failed silently');

// Pump 10 seconds of wall time at 60fps through the bundle's own loop.
let now = Date.now();
for (let f = 0; f < 600; f++) {
  now += 16.67;
  const cb = rafCb;
  rafCb = null;
  cb(now);
  if (typeof rafCb !== 'function') throw new Error(`rAF loop died at frame ${f}`);
}
console.log('DIST SMOKE OK — bundled page initialized and ran 600 frames');

// v0.15 "Bloom": the moveToward/NaN invisibility regression check. The dist
// bundle concatenates every module into one scope, so a duplicate top-level
// function name silently rebinds — creature movement ran teacher logic and
// wrote NaN into creature.x (invisible creatures, census still said 4).
// Module-scoped src/ tests can never catch this; the bundled world can.
{
  const world = global.window.canopyWorld;
  if (!world) throw new Error('dist smoke: window.canopyWorld missing — world not exposed');
  const bad = [];
  for (const c of world.creatures) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) bad.push(`${c.name} x=${c.x} y=${c.y}`);
  }
  if (world.teacher) {
    // The teacher's y is null by design (derived from its platform each
    // frame); only x must stay finite.
    if (!Number.isFinite(world.teacher.x)) bad.push(`teacher x=${world.teacher.x}`);
  }
  if (bad.length) {
    throw new Error(`dist smoke: NON-FINITE positions after 600 frames (invisibility bug):\n  ${bad.join('\n  ')}`);
  }
  if (!world.creatures.length) throw new Error('dist smoke: no creatures in the bundled world');
  console.log(`DIST SMOKE OK — ${world.creatures.length} creatures, all positions finite`);
}
