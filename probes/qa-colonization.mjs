// v0.36 QA gate 6 — colonization, both outcomes.
// Hydrochory washes seeds onto new ground (v0.35). A colonization gate that
// only ever succeeds is not a gate: this probe requires BOTH outcomes in
// one run — at least one wash-ashore seedling that ESTABLISHES (alive,
// growth ≥ 0.5 after 8000 ticks) and at least one that FAILS (dead or gone).
// Method: drop windfall fruit over every current rect (seeds the drift),
// run 3000 ticks for drift + wash-ashore, snapshot the new plant ids, run
// 8000 more, classify each. Outcomes are classified by biome at wash-ashore.
// Run: node probes/qa-colonization.mjs [seed]
import { createWorld, bindWorld, populateGenesis, tickWorld, dropWindfall, biomeAt } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '7', 10);
const DT = 0.5;

const world = bindWorld(createWorld(seed));
populateGenesis(world);
const wplant = world.plants.find((p) => p.genome) || world.plants[0];
for (const cur of world.currents || []) {
  const midX = (cur.x0 + cur.x1) / 2;
  for (let i = 0; i < 8; i++) {
    dropWindfall(world, { x: midX + (i - 4) * 30, plantId: wplant.id, genome: wplant.genome,
                          dadGenome: wplant.genome, foodKind: 'fruit' }, world.rng);
  }
}
const beforeIds = new Set(world.plants.map((p) => p.id));
for (let i = 0; i < 3000; i++) tickWorld(world, DT);
const newcomers = world.plants.filter((p) => !beforeIds.has(p.id))
  .map((p) => ({ id: p.id, x: Math.round(p.x), biome: (() => { try { return biomeAt(p.x, world.layout); } catch (e) { return '?'; } })() }));
console.log(`wash-ashore seedlings: ${newcomers.length}`);
for (let i = 0; i < 8000; i++) tickWorld(world, DT);
const liveById = new Map(world.plants.map((p) => [p.id, p]));
let established = 0, failed = 0;
const detail = [];
for (const s of newcomers) {
  const p = liveById.get(s.id);
  if (p && (p.growth || 0) >= 0.5) { established++; detail.push({ ...s, fate: 'established', growth: +p.growth.toFixed(2) }); }
  else { failed++; detail.push({ ...s, fate: p ? 'stunted' : 'dead', growth: p ? +(p.growth || 0).toFixed(2) : null }); }
}
const pass = established >= 1 && failed >= 1;
console.log(JSON.stringify({ seed, gate: 'colonization-both-outcomes',
  newcomers: newcomers.length, established, failed,
  detail: detail.slice(0, 12),
  verdict: pass ? 'PASS — the same drift produces colonies and corpses'
                : 'FAIL — only one outcome observed',
}, null, 2));
process.exit(pass ? 0 : 1);
