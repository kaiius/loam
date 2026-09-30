// Wildcode bootstrap: world, renderer, UI, fixed-timestep game loop.

import { createWorld, bindWorld, populate, tickWorld } from './sim/world.js';
import { createRenderer, render } from './render/renderer.js';
import { createUI } from './ui/ui.js';

const canvas = document.getElementById('game');
const world = bindWorld(createWorld((Date.now() % 100000) | 0));
populate(world);

const renderer = createRenderer(canvas);
const ui = createUI(canvas, renderer, world);

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
