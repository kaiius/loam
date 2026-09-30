// Headless harness: stubs DOM/canvas, then runs the real game loop
// (world + renderer + painter + UI) for N frames, surfacing any runtime
// errors in the render/UI code paths that node can't otherwise reach.

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
    appendChild(c) { c._parent = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    get firstChild() { return el.children[0]; },
    remove() { if (el._parent) el._parent.removeChild(el); },
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

const { createWorld, bindWorld, populate, tickWorld } = await import('../src/sim/world.js');
const { createRenderer, render } = await import('../src/render/renderer.js');
const { createUI } = await import('../src/ui/ui.js');

const world = bindWorld(createWorld(99));
populate(world);
const renderer = createRenderer(canvasEl);
const ui = createUI(canvasEl, renderer, world);

const SIM_DT = 0.1;
let acc = 0, last = Date.now(), now = last;
// Simulate 60 seconds of wall time at 1x with 60fps frames.
for (let f = 0; f < 3600; f++) {
  now += 16.67;
  let dt = (now - last) / 1000; last = now;
  acc += dt * ui.speed;
  let n = 0;
  while (acc >= SIM_DT && n < 60) { tickWorld(world, SIM_DT); acc -= SIM_DT; n++; }
  ui.update();
  render(renderer, world, ui, now / 1000);
  // Exercise selection + panel rendering paths.
  if (f === 100 && world.creatures.length) ui.selected = world.creatures[0];
  if (f === 200 && world.eggs.length) ui.selected = world.eggs[0];
  if (f === 300) ui.selected = null;
  if (f === 400) ui.speed = 4;
  if (f === 500) ui.speed = 0;
  if (f === 600) ui.speed = 1;
}
console.log('HEADLESS RUN OK —', world.creatures.length, 'creatures alive,',
  world.eggs.length, 'eggs, time', world.time.toFixed(0) + 's');
