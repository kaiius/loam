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
