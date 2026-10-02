// v0.36 QA gate 1 — pollinator-crash cascade.
// The v0.34 exclosure probe showed pollinators add +31% fruit set. This gate
// tests the reverse: crash the pollinators mid-run and watch the cascade.
// Two worlds, same seed. Control runs 8000 ticks. Crash arm runs 4000 ticks,
// kills every pollinator (the v0.34 anatomical filter: size ≤ 0.3 +
// flight-capable), then runs to 8000. PASS = second-half fruit set in the
// crash arm collapses to ≤0.7× control (the uplift disappears) AND
// 'pollinated' events stop after the crash.
// Run: node probes/qa-pollinator-crash.mjs [seed]
import { createWorld, bindWorld, populateGenesis, tickWorld } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 0.5, HALF = 4000, FULL = 8000;

const isPollinator = (c) => {
  const ph = c.pheno || {};
  if ((ph.size === undefined ? 1 : ph.size) > 0.3) return false;
  const wingArea = (c.bodyPlan && c.bodyPlan.wingArea) || 0;
  return wingArea > 0.1 || !c.grounded;
};

function runWorld(crash) {
  const world = bindWorld(createWorld(seed));
  populateGenesis(world);
  for (let i = 0; i < HALF; i++) tickWorld(world, DT);
  const fruitMid = world._fruitSetTotal || 0;
  let killed = 0;
  if (crash) {
    for (const c of world.creatures) {
      if (c.alive && isPollinator(c)) { c.alive = false; c.biochem.health = 0; killed++; }
    }
  }
  let pollinated2nd = 0;
  const seenEv = new Set();
  for (let i = HALF; i < FULL; i++) {
    tickWorld(world, DT);
    for (const e of world.events) {
      if (e.type === 'pollinated' && !seenEv.has(e)) { seenEv.add(e); pollinated2nd++; }
    }
  }
  const fruit2nd = (world._fruitSetTotal || 0) - fruitMid;
  const pollinatorsLeft = world.creatures.filter((c) => c.alive && isPollinator(c)).length;
  return { fruit2nd, pollinated2nd, killed, pollinatorsLeft,
           alive: world.creatures.filter((c) => c.alive).length };
}

const control = runWorld(false);
const crash = runWorld(true);
const ratio = control.fruit2nd > 0 ? crash.fruit2nd / control.fruit2nd : null;
const pass = ratio !== null && ratio <= 0.7 && crash.pollinated2nd === 0;
console.log(JSON.stringify({ seed, gate: 'pollinator-crash-cascade',
  control: { fruit2ndHalf: control.fruit2nd, pollinated2ndHalf: control.pollinated2nd },
  crash: { fruit2ndHalf: crash.fruit2nd, pollinated2ndHalf: crash.pollinated2nd,
           killed: crash.killed, pollinatorsLeft: crash.pollinatorsLeft, alive: crash.alive },
  fruitRatio: ratio === null ? null : +ratio.toFixed(3),
  verdict: pass ? 'PASS — fruit set collapses to the wind/selfing floor after the crash'
                : 'FAIL — no cascade',
}, null, 2));
process.exit(pass ? 0 : 1);
