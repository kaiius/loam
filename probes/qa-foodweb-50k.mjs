// v0.36 QA gate 2 — 50k-tick food-web persistence.
// A long, boring, honest run: seed 7, 50000 ticks at DT 0.5 (~9 min).
// PASS = at tick 50000: creatures alive > 0 AND plants alive > 0 AND
// births happened in the last 10k ticks (the lineage continues, not a
// static snapshot — vina's v0.30 challenge) AND the decomposer layer is
// alive (some soil zone with bacteria > 0). Samples every 5k ticks are
// printed so a collapse's timing is visible, not just the endpoint.
// Run: node probes/qa-foodweb-50k.mjs [seed]
import { createWorld, bindWorld, populateGenesis, tickWorld, bacteriaOf } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 0.5, TICKS = 50000, SAMPLE = 5000;

const world = bindWorld(createWorld(seed));
populateGenesis(world);
const seenIds = new Set(world.creatures.map((c) => c.id));
let birthsLast10k = 0;
const birthsByWindow = [];
const series = [];
const t0 = Date.now();
for (let t = 0; t < TICKS; t++) {
  tickWorld(world, DT);
  if ((t + 1) % SAMPLE === 0) {
    let newBirths = 0;
    for (const c of world.creatures) if (!seenIds.has(c.id)) { seenIds.add(c.id); newBirths++; }
    birthsByWindow.push(newBirths);
    const alive = world.creatures.filter((c) => c.alive).length;
    const plants = world.plants.filter((p) => (p.growth || 0) > 0).length;
    series.push({ tick: t + 1, alive, plants, births: newBirths });
    console.log(`tick ${t + 1}: alive=${alive} plants=${plants} births/5k=${newBirths}`);
  }
}
birthsLast10k = birthsByWindow.slice(-2).reduce((a, b) => a + b, 0);
const aliveEnd = world.creatures.filter((c) => c.alive).length;
const plantsEnd = world.plants.filter((p) => (p.growth || 0) > 0).length;
let decomp = false;
try {
  for (const k of Object.keys(world.soil || {})) {
    if (bacteriaOf(world, k) > 0) { decomp = true; break; }
  }
} catch (e) { /* soil shape differs — report */ }
const pass = aliveEnd > 0 && plantsEnd > 0 && birthsLast10k > 0 && decomp;
console.log(JSON.stringify({ seed, ticks: TICKS, gate: 'foodweb-50k-persistence',
  end: { aliveCreatures: aliveEnd, plants: plantsEnd, birthsLast10k, decomposersAlive: decomp },
  minutes: +((Date.now() - t0) / 60000).toFixed(1),
  verdict: pass ? 'PASS — the web persists: producers, consumers, decomposers, and new births'
                : 'FAIL — the web collapsed',
}, null, 2));
process.exit(pass ? 0 : 1);
