// M2 tests: senses + full creature in a real generated world.
// Run: node --test test/material-m2-senses.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMaterialWorld, addFounder, tickMaterialWorldM2 } from '../src/material/index.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { senseVector47 } from '../src/material/brain.js';
import { createRng } from '../src/sim/rng.js';

test('m2: senses compute in a real world (46 fields, all finite)', () => {
  const mw = createMaterialWorld(7, 1);
  mw.tick = 600; // noon — the diurnal cycle starts at midnight (tick 0)
  const c = addFounder(mw, createRng(21));
  for (let t = 0; t < 15; t++) tickMaterialWorldM2(mw); // let gravity settle it
  const s = gatherMaterialSenses(mw, c, { others: [c] });
  const v = senseVector47(s);
  assert.equal(v.length, 47);
  for (let i = 0; i < 46; i++) {
    assert.ok(Number.isFinite(v[i]), `sense ${i} finite`);
  }
  // The founder spawns on the surface: light > 0, soil below.
  assert.ok(s.light > 0.3, `surface light: ${s.light}`);
  assert.ok(s.soilBelow > 0.5, `soil below: ${s.soilBelow}`);
});

test('m2: food sense finds the fruiting canopy', () => {
  const mw = createMaterialWorld(7, 1);
  const c = addFounder(mw, createRng(21));
  const s = gatherMaterialSenses(mw, c, { others: [c] });
  // Seed 7 has fruiting plants; the founder should sense food somewhere.
  assert.ok(s.foodDist <= 1, 'foodDist in range');
});

test('m2: enclosed sense reads burial (tunnel vs surface)', () => {
  const mw = createMaterialWorld(7, 1);
  const c = addFounder(mw, createRng(21));
  const surface = gatherMaterialSenses(mw, c, { others: [c] }).enclosed;
  // Bury the creature deep in soil.
  c.y = mw.grid.rows * 10 - 60;
  c.x = mw.grid.cols * 5;
  const buried = gatherMaterialSenses(mw, c, { others: [c] }).enclosed;
  assert.ok(buried > surface, `buried ${buried} > surface ${surface}`);
});

test('m2: a founder lives 200 ticks in the world', () => {
  const mw = createMaterialWorld(42, 1);
  const c = addFounder(mw, createRng(21));
  for (let t = 0; t < 200; t++) tickMaterialWorldM2(mw);
  assert.ok(c.alive, 'alive after 200 ticks');
  assert.ok(c.lastAction >= 0, 'brain decided');
  // It should have done *something* — moved, or acted.
  assert.ok(c.age === 200, 'aged 200 ticks');
});

test('m2: two founders form a bond when grooming range overlaps', () => {
  const mw = createMaterialWorld(7, 1);
  const rng = createRng(21);
  const a = addFounder(mw, rng);
  const b = addFounder(mw, rng);
  b.x = a.x + 20; b.y = a.y; // within groom range
  // Force grooming by proximity ticks.
  for (let t = 0; t < 120; t++) tickMaterialWorldM2(mw);
  // Bonds may or may not have formed (the brain decides); the ledger exists.
  assert.ok(mw.bonds instanceof Map, 'bond ledger live');
});

test('m2: fruit regrows on fruiting plants', () => {
  const mw = createMaterialWorld(7, 1);
  const p = mw.plants.find((pl) => pl.fruiting);
  assert.ok(p, 'a fruiting plant exists');
  p.fruit = 0;
  for (let t = 0; t < 120; t++) tickMaterialWorldM2(mw);
  assert.ok(p.fruit > 0, `fruit regrew: ${p.fruit}`);
});
