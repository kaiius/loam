// Wildcode bootstrap: world, renderer, UI, fixed-timestep game loop.

import { createWorld, bindWorld, populate, tickWorld } from './sim/world.js';
// v0.18 "Realms": the browser boots the full 8-biome world. populateGenesis
// is landed by the sim agents — until then the classic populator stands in.
// (populate stays imported: the test suite uses it directly. In the
// single-file dist bundle populateGenesis arrives as a top-level binding,
// which the typeof check below detects without an import.)
const populateWorld = (typeof populateGenesis === 'function') ? populateGenesis : populate;
import { setTeacherMode, commandTeacher, serializeTeacherSenses } from './sim/teacher.js';
import { createRenderer, render } from './render/renderer.js';
import { createUI } from './ui/ui.js';

const canvas = document.getElementById('game');
// v0.24: deterministic seed override for the dist smoke test. The browser
// keeps its random world per load; only dist-smoke.mjs sets
// window.__CANOPY_SEED before the bundle runs, so the suite is deterministic.
const bootSeed = (typeof window !== 'undefined' && typeof window.__CANOPY_SEED === 'number')
  ? (window.__CANOPY_SEED | 0)
  : ((Date.now() % 100000) | 0);
const world = bindWorld(createWorld(bootSeed));
populateWorld(world);

const renderer = createRenderer(canvas);
const ui = createUI(canvas, renderer, world);

// v0.26 "Procedural worldgen": the 🌍 New World button. Regenerate in
// place: build the fresh world, then swap its contents into the live
// `world` object — every closure (UI, teacher bridge, canopyWorld) holds
// that same object, so nothing dangles. Selection/camera reset via
// ui.resetView + auto-fit; speed and other session UI state persist.
ui.onNewWorld = (seed, size) => {
  const fresh = bindWorld(createWorld(seed, { size }));
  populateWorld(fresh);
  for (const k of Object.keys(world)) delete world[k];
  Object.assign(world, fresh);
  bindWorld(world); // rebind tryMate/digAt to the live object
  ui.resetView();
  renderer.cam.manual = false; // camera auto-fits the new world
  acc = 0; // shed any queued ticks from the old world
  ui.toast(`🌍 New world — seed ${seed} · ${size >= 2 ? 'Large (2×)' : 'Standard (1×)'} · ${world.creatures.length} creatures`);
};

// v0.14: the possession bridge — Sunny can feel and drive the teacher from
// chat (or the console), not just the HUD. senses() returns the plain-text
// serialization; command() auto-possesses and queues a command
// ({cmd:'moveTo',x,platformIndex} | {cmd:'demo'} | {cmd:'reward'} |
//  {cmd:'rewardNearest'} | {cmd:'eat'}).
window.canopyTeacher = {
  senses: () => serializeTeacherSenses(world, world.teacher),
  command: (cmd) => {
    const te = world.teacher;
    if (te.mode !== 'possessed') setTeacherMode(world, te, 'possessed');
    return commandTeacher(te, cmd);
  },
  mode: (m) => setTeacherMode(world, world.teacher, m),
};
// v0.15 "Bloom": debug handle for the dist smoke test — lets it assert the
// bundled world stays finite (the moveToward/NaN invisibility regression).
window.canopyWorld = world;

const SIM_DT = 0.1; // 10 sim ticks per second at 1x
let acc = 0;
let last = performance.now();

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // tab was hidden — don't spiral

  if (ui.speed > 0) {
    acc += dt * ui.speed;
    let n = 0;
    while (acc >= SIM_DT && n < 60) {
      tickWorld(world, SIM_DT);
      acc -= SIM_DT;
      n++;
    }
    if (n === 60) acc = 0; // shed backlog rather than spiral
  }

  ui.update();
  render(renderer, world, ui, now / 1000);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
