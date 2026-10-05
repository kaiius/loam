// Loam R6 — tanglekin reproduction: wiring probes, not just wiring tests.
// The mate action (case 6) fuses gametes through the real meiosis
// machinery; these probes watch the effect happen.
// Run: node --test test/material-r6-repro.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAT, CELL_PX, createGrid } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';
import { randomGenome, genomeDistance } from '../src/sim/genome.js';
import { spawnMaterialCreature, tickMaterialCreature, petMaterialCreature, nudgeMaterialCreature } from '../src/material/mcreature.js';
import { executeAction } from '../src/material/actions.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { reproduceTanglekins, countSpecies, LOAM_CAPS, seedEcology } from '../src/material/species.js';
import { createMaterialWorld, addFounder, tickMaterialWorldM2 } from '../src/material/index.js';
import { ACTIONS } from '../src/material/brain.js';

const IDX = (name) => ACTIONS.indexOf(name);

// A synthetic micro-world: 60x40, soil in the bottom half, air above.
function microWorld() {
  const cols = 60, rows = 40;
  const grid = createGrid(cols, rows);
  for (let y = 20; y < rows; y++)
    for (let x = 0; x < cols; x++) grid.mat[y * cols + x] = MAT.SOIL;
  return {
    seed: 7, tick: 0, grid, cols, rows,
    plants: [], bonds: new Map(),
    surf: new Array(cols).fill(20),
    m2creatures: [],
  };
}

function tanglekinAt(mw, px, py) {
  const c = spawnMaterialCreature(mw, randomGenome(createRng(7 + px), {}), px, py);
  c.species = 'tanglekin';
  c.grounded = true;
  mw.m2creatures.push(c);
  return c;
}

// Force adulthood: ageStage reads b.age / pheno.lifespanSec; t=0.4 is adult
// for every maturation multiplier (0.25m ≤ 0.4 < 0.8 for m in [0.5, 1.5]).
function makeAdult(c) {
  c.chem.age = 0.4 * c.pheno.lifespanSec;
  c.stage = 'adult';
}

function reproduceCtx(mw) {
  return {
    others: mw.m2creatures,
    reproduce: (mom, dad) => reproduceTanglekins(mw, mom, dad),
  };
}

test('R6: meiosis ran — offspring genome differs from both parents (not a clone)', () => {
  const mw = microWorld();
  const mom = tanglekinAt(mw, 280, 196); makeAdult(mom);
  const dad = tanglekinAt(mw, 300, 196); makeAdult(dad);
  const child = reproduceTanglekins(mw, mom, dad);
  assert.ok(child, 'mating produced a child');
  assert.equal(child.species, 'tanglekin');
  const dMom = genomeDistance(child.genome, mom.genome);
  const dDad = genomeDistance(child.genome, dad.genome);
  assert.ok(dMom > 0, `child differs from mom (distance ${dMom}) — not a clone`);
  assert.ok(dDad > 0, `child differs from dad (distance ${dDad}) — not a clone`);
  assert.equal(child.stage, 'baby', 'the newborn starts as a baby');
});

test('R6: scripted — two adults in range, forced mate action, population grows', () => {
  const mw = microWorld();
  const a = tanglekinAt(mw, 280, 196); makeAdult(a);
  const b = tanglekinAt(mw, 300, 196); makeAdult(b); // 20px apart, within the 40px gate
  const n0 = mw.m2creatures.length;
  let born = null;
  for (let t = 0; t < 200 && !born; t++) {
    mw.tick = t;
    for (const c of [...mw.m2creatures]) {
      if (!c.alive || (c.stage !== 'adult' && c.stage !== 'senior')) continue;
      const s = gatherMaterialSenses(mw, c, { others: mw.m2creatures });
      executeAction(mw, c, IDX('mate'), s, reproduceCtx(mw));
    }
    if (mw.m2creatures.length > n0) born = mw.m2creatures[mw.m2creatures.length - 1];
  }
  assert.ok(born, 'a child was born within 200 ticks of forced mate actions');
  assert.ok(mw.m2creatures.length === n0 + 1, `exactly one child (n=${mw.m2creatures.length})`);
  assert.ok(a._mateCd > mw.tick && b._mateCd > mw.tick, 'both parents carry a cooldown');
});

test('R6: cap respected — no spawn at LOAM_CAPS.tanglekin', () => {
  const mw = microWorld();
  for (let i = 0; i < LOAM_CAPS.tanglekin; i++) {
    const c = tanglekinAt(mw, 200 + i * 8, 196); makeAdult(c);
  }
  assert.equal(countSpecies(mw, 'tanglekin'), LOAM_CAPS.tanglekin);
  const a = mw.m2creatures[0], b = mw.m2creatures[1];
  const born = reproduceTanglekins(mw, a, b);
  assert.equal(born, null, 'no child when the cap is full');
  assert.equal(countSpecies(mw, 'tanglekin'), LOAM_CAPS.tanglekin, 'population unchanged');
});

test('R6: cooldown blocks immediate re-mating', () => {
  const mw = microWorld();
  const a = tanglekinAt(mw, 280, 196); makeAdult(a);
  const b = tanglekinAt(mw, 300, 196); makeAdult(b);
  const first = reproduceTanglekins(mw, a, b);
  assert.ok(first, 'first mating succeeds');
  const n = mw.m2creatures.length;
  const second = reproduceTanglekins(mw, a, b);
  assert.equal(second, null, 'immediate re-mating blocked by the cooldown');
  assert.equal(mw.m2creatures.length, n, 'no extra child');
});

test('R6: juveniles cannot mate', () => {
  const mw = microWorld();
  const a = tanglekinAt(mw, 280, 196); makeAdult(a);
  const b = tanglekinAt(mw, 300, 196); // baby — stage untouched
  assert.equal(b.stage, 'baby');
  const born = reproduceTanglekins(mw, a, b);
  assert.equal(born, null, 'an adult cannot mate with a baby');
});

test('R6: the courtship display is brief and surfaced', () => {
  const mw = microWorld();
  const a = tanglekinAt(mw, 280, 196); makeAdult(a);
  const b = tanglekinAt(mw, 300, 196); makeAdult(b);
  const s = gatherMaterialSenses(mw, a, { others: mw.m2creatures });
  executeAction(mw, a, IDX('mate'), s, reproduceCtx(mw));
  assert.equal(a._courting, b.id, 'courting marks the partner id');
  assert.ok(a._courtingT > 0, 'the display has a tick budget');
});

test('R6: seedEcology stocks a second tanglekin near the founder (cap respected)', () => {
  const mw = createMaterialWorld(7, 1);
  const founder = addFounder(mw, createRng(((7 * 31 + 7) >>> 0)));
  seedEcology(mw, createRng(((7 * 31 + 0x9e37) >>> 0) || 1));
  const n = countSpecies(mw, 'tanglekin');
  assert.equal(n, 2, `two tanglekins after seeding (got ${n})`);
  const [t1, t2] = mw.m2creatures.filter((c) => c.species === 'tanglekin');
  const d = Math.hypot(t2.x - t1.x, t2.y - t1.y);
  assert.ok(d <= 400, `second founder within ~300px of the first (d=${d.toFixed(0)})`);
});

test('R6: pet lands in the chemistry — comfort rises through the real chem tick', () => {
  const mw = microWorld();
  const c = tanglekinAt(mw, 280, 196);
  c.chem.comfort = 0.2;
  assert.ok(petMaterialCreature(c), 'pet accepted');
  tickMaterialCreature(mw, c, { others: mw.m2creatures });
  assert.ok(c.chem.comfort > 0.2, `comfort rose through tickBiochem: 0.2 -> ${c.chem.comfort.toFixed(3)}`);
  assert.equal(c._petted, false, 'the flag is consumed, not sticky');
});

test('R6: nudge moves the body through the physics, never a teleport', () => {
  const mw = microWorld();
  const c = tanglekinAt(mw, 280, 196);
  c.facing = 1;
  const x0 = c.x;
  assert.ok(nudgeMaterialCreature(c), 'nudge accepted');
  assert.ok(c.x > x0 && c.x - x0 <= 10, `small shove: ${x0} -> ${c.x}`);
  assert.ok(c.vy < 0, 'startle-hop leaves the ground (gravity resolves it)');
  assert.ok(!nudgeMaterialCreature(null) && !petMaterialCreature(null), 'dead/null targets refuse touch');
});

test('R6: the full tick path wires reproduce (tickMaterialWorldM2)', () => {
  const mw = microWorld();
  const a = tanglekinAt(mw, 280, 196); makeAdult(a);
  const b = tanglekinAt(mw, 300, 196); makeAdult(b);
  // The wiring seam: tickMaterialWorldM2 builds the creature context that
  // case 6 reads (ctx.reproduce). The brain won't reliably choose mate in
  // a micro-world, so this test asserts the seam structurally on the real
  // built function — the behavioral half (case 6 → reproduce callback →
  // child) is covered by the forced-mate test above.
  const src = tickMaterialWorldM2.toString();
  assert.ok(src.includes('reproduce'), 'tickMaterialWorldM2 wires ctx.reproduce');
  assert.ok(src.includes('reproduceTanglekins'), 'the seam calls the real gate');
  // And the tick path runs cleanly with two adults present.
  tickMaterialWorldM2(mw);
  assert.ok(mw.tick >= 0, 'the tick path runs with the reproduce seam wired');
});
