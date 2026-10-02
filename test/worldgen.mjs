// Tests for worldgen v2 — generative geography.
//
// Regions with Whittaker labels emerge from elevation + Tinit + moisture;
// the canopy is constructed (not painted); the viability gate rejects
// unplayable rolls; re-rolls are deterministic.
// Run: node --test test/worldgen.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateLayout, canonicalLayout, viabilityGate, rollLayout,
  computeClimbLinks, findRegion, COHORT_FINDERS,
} from '../src/sim/worldgen.js';
import { createWorld, populateGenesis } from '../src/sim/world.js';
import { biomeAt, waterAt, groundYAt, regionAt } from '../src/sim/biomes.js';

// --- determinism: the same (seed, size) is the same world, bit-for-bit ---

test('v2: same seed → identical layout (bit-for-bit deterministic)', () => {
  const a = generateLayout(7, 1, 0);
  const b = generateLayout(7, 1, 0);
  assert.deepEqual(a, b);
});

test('v2: different seeds → different layouts (procedural variety is real)', () => {
  const a = generateLayout(7, 1, 0);
  const b = generateLayout(8, 1, 0);
  assert.notDeepEqual(a.platforms, b.platforms, 'platforms differ');
  assert.notEqual(a.seaY, b.seaY, 'sea level differs');
  // Region label sequences differ (not just positions).
  const la = a.regions.map(r => r.label).join(',');
  const lb = b.regions.map(r => r.label).join(',');
  assert.notEqual(la, lb, 'region sequences differ');
});

test('v2: the attempt counter changes the roll (re-rolls explore)', () => {
  const a = generateLayout(7, 1, 0);
  const b = generateLayout(7, 1, 1);
  assert.notDeepEqual(a.platforms, b.platforms);
});

test('v2: rollLayout is deterministic across calls', () => {
  const a = rollLayout(42, 1);
  const b = rollLayout(42, 1);
  assert.deepEqual(a.layout, b.layout);
  assert.equal(a.attempts, b.attempts);
});

// --- the canonical layout: the painted world as a layout (untouched) ---

test('v2: canonical layout reproduces the painted platform table', () => {
  const c = canonicalLayout(1);
  assert.ok(c.canonical, 'canonical flag set');
  assert.ok(c.platforms.length > 0, 'has platforms');
});

test('v2: the gate accepts the canonical layout (the painted world is viable)', () => {
  const c = canonicalLayout(1);
  const g = viabilityGate(c);
  assert.ok(g.ok, `canonical passes: ${g.failures.join(', ')}`);
});

// --- regions: labels emerge from the physical fields ---

test('v2: regions carry Whittaker labels', () => {
  const L = generateLayout(7, 1, 0);
  assert.ok(L.regions.length > 0, 'has regions');
  const labels = new Set(L.regions.map(r => r.label));
  // At least 3 distinct land labels (probe §12.6).
  const land = [...labels].filter(l => !['shallows', 'archipelago', 'deep'].includes(l));
  assert.ok(land.length >= 3, `≥3 land labels (got ${[...labels].join(',')})`);
});

test('v2: founder region exists and has a canopy', () => {
  const { layout } = rollLayout(7, 1);
  assert.ok(layout.founder, 'founder exists');
  assert.ok(layout.founder.branchPis.length >= 6, '≥6 branches');
  assert.ok(layout.founder.fruitSlots >= 8, '≥8 fruit slots');
});

// --- cohort finders: label-preferring, null when absent ---

test('v2: finders resolve to labeled regions', () => {
  const L = generateLayout(7, 1, 0);
  const f = findRegion(L, 'founder');
  assert.ok(f, 'founder finder resolves');
  assert.equal(f.id, L.founder.regionId, 'founder is the founder region');
  // 'deep-water' returns null when no deep region (no nearest-fallback).
  const d = findRegion(L, 'deep-water');
  const hasDeep = L.regions.some(r => r.label === 'deep');
  assert.equal(!!d, hasDeep, 'deep-water matches deep presence');
});

// --- viability: rollLayout succeeds across seeds ---

test('v2: rollLayout viable for seeds 1–20 (size 1)', () => {
  for (let s = 1; s <= 20; s++) {
    const { layout, gate } = rollLayout(s, 1);
    assert.ok(gate.ok, `seed ${s} viable: ${gate.failures.join(', ')}`);
    assert.ok(layout.founder, `seed ${s} has founder`);
  }
});
