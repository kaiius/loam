// Tests for v0.26 "Procedural worldgen" — seeded tectonic-like geography.
//
// The 8-zone west→east layout is the invariant structure; everything within
// it is generated per seed (uplift noise, sea level, erosion, platform
// instantiation, waters). The viability gate rejects unplayable rolls;
// re-rolls are deterministic.
// Run: node --test test/worldgen.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateLayout, canonicalLayout, viabilityGate, rollLayout,
  computeClimbLinks, ZONE_KEYS, BASE_ZONE_W,
} from '../src/sim/worldgen.js';
import { createWorld, populateGenesis } from '../src/sim/world.js';
import { biomeAt, waterAt, groundYAt } from '../src/sim/biomes.js';

// --- determinism: the same (seed, size) is the same world, bit-for-bit ---

test('v0.26: same seed → identical layout (bit-for-bit deterministic)', () => {
  const a = generateLayout(7, 1, 0);
  const b = generateLayout(7, 1, 0);
  assert.deepEqual(a, b);
});

test('v0.26: different seeds → different layouts (procedural variety is real)', () => {
  const a = generateLayout(7, 1, 0);
  const b = generateLayout(8, 1, 0);
  assert.notDeepEqual(a.platforms, b.platforms, 'platform y-values differ');
  assert.notEqual(a.seaY, b.seaY, 'sea level differs');
  assert.notDeepEqual(a.waters, b.waters, 'water table differs');
});

test('v0.26: the attempt counter changes the roll (re-rolls explore)', () => {
  const a = generateLayout(7, 1, 0);
  const b = generateLayout(7, 1, 1);
  assert.notDeepEqual(a.platforms, b.platforms);
});

test('v0.26: rollLayout is deterministic across calls', () => {
  const a = rollLayout(42, 1);
  const b = rollLayout(42, 1);
  assert.deepEqual(a.layout, b.layout);
  assert.equal(a.attempts, b.attempts);
});

// --- the canonical layout: the painted world as a layout ---

test('v0.26: canonical layout reproduces the painted platform table', () => {
  const c = canonicalLayout(1);
  assert.equal(c.platforms.length, 47);
  assert.equal(c.waters.length, 6);
  // Spot pins from the painted table.
  assert.deepEqual([c.platforms[0].x1, c.platforms[0].x2, c.platforms[0].y], [1200, 1800, 800]);
  assert.deepEqual([c.platforms[42].x1, c.platforms[42].x2, c.platforms[42].y], [4250, 4400, 690]);
  assert.deepEqual([c.platforms[45].x1, c.platforms[45].x2], [760, 1040]); // foothill fill
  assert.deepEqual([c.platforms[46].x1, c.platforms[46].x2], [3720, 3740]); // seam fill
  // Painted waters, verbatim.
  assert.deepEqual(c.waters.map((w) => [w.x0, w.x1, w.surfaceY, w.salt]), [
    [1300, 1400, 790, false], [1600, 1700, 790, false], [2680, 2760, 820, false],
    [3000, 3600, 800, true], [3600, 4200, 800, true], [4200, 4800, 700, true],
  ]);
});

test('v0.26: the gate accepts the canonical layout (the painted world is viable)', () => {
  const gate = viabilityGate(canonicalLayout(1));
  assert.ok(gate.ok, `canonical must pass: ${gate.failures.join('; ')}`);
});

// --- the viability gate has teeth: sabotage is rejected ---

test('v0.26: gate rejects a layout with no freshwater', () => {
  const l = generateLayout(7, 1, 0);
  l.waters = l.waters.filter((w) => w.salt);
  const gate = viabilityGate(l);
  assert.ok(!gate.ok);
  assert.ok(gate.failures.some((f) => f.startsWith('water:')), gate.failures.join('; '));
});

test('v0.26: gate rejects a deeply submerged founder spawn', () => {
  const l = generateLayout(7, 1, 0);
  // Drown the plains cohort platform: put ocean over it.
  const p = l.platformsByZone.plains[0];
  l.waters.push({ x0: p.x1 - 10, x1: p.x2 + 10, surfaceY: p.y - 100, depth: 200, salt: true });
  const gate = viabilityGate(l);
  assert.ok(!gate.ok);
  assert.ok(gate.failures.some((f) => f.startsWith('spawn:')), gate.failures.join('; '));
});

test('v0.26: gate rejects a stranded jungle (broken climb topology)', () => {
  const l = generateLayout(7, 1, 0);
  // Strand a jungle branch far above climb reach.
  const b = l.platformsByZone.jungle[1];
  b.y = -1000;
  const gate = viabilityGate(l);
  assert.ok(!gate.ok, 'a stranded jungle platform must fail the gate');
  assert.ok(gate.failures.some((f) => f.startsWith('reachable:') || f.startsWith('traversable:')),
    gate.failures.join('; '));
});

// --- structural invariants: the template holds across seeds ---

test('v0.26: zone order, widths, and platform x-spans are seed-invariant', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const l = generateLayout(seed, 1, 0);
    assert.deepEqual(l.zones.map((z) => z.key), ZONE_KEYS, 'west→east order');
    for (let i = 0; i < 8; i++) {
      assert.equal(l.zones[i].x0, i * 600);
      assert.equal(l.zones[i].x1, (i + 1) * 600);
    }
    assert.equal(l.platforms.length, 47, 'platform count');
    // X-spans are the invariant: climb-link topology is preserved exactly.
    const c = canonicalLayout(1);
    for (let i = 0; i < 47; i++) {
      assert.equal(l.platforms[i].x1, c.platforms[i].x1, `platform ${i} x1`);
      assert.equal(l.platforms[i].x2, c.platforms[i].x2, `platform ${i} x2`);
      assert.equal(l.platforms[i].kind, c.platforms[i].kind, `platform ${i} kind`);
    }
    // Every generated world passes the gate.
    const gate = viabilityGate(l);
    assert.ok(gate.ok, `seed ${seed}: ${gate.failures.join('; ')}`);
  }
});

test('v0.26: the jungle keeps its 12 climb links at every seed', () => {
  for (const seed of [1, 7, 13, 42]) {
    const l = generateLayout(seed, 1, 0);
    const links = computeClimbLinks(l.platforms);
    const jungleLinks = links.filter((k) => k.a < 9 && k.b < 9);
    assert.equal(jungleLinks.length, 12, `seed ${seed}: 12 jungle links`);
  }
});

test('v0.26: sea level is drawn per seed within its band', () => {
  const seas = new Set();
  for (let s = 1; s <= 10; s++) {
    const l = generateLayout(s, 1, 0);
    assert.ok(l.seaY >= 880 && l.seaY <= 900, `seaY ${l.seaY} in [880,900]`);
    seas.add(Math.round(l.seaY * 100));
  }
  assert.ok(seas.size > 1, 'sea level varies by seed');
});

test('v0.26: land stays above the sea (no spurious flooding)', () => {
  // The ocean surface sits below the land: land zones never flood by
  // construction — flooding is the sea filling the shallows, not lakes
  // in the jungle.
  for (let s = 1; s <= 10; s++) {
    const l = generateLayout(s, 1, 0);
    for (const w of l.waters) {
      if (w.salt) continue;
      const zi = Math.min(7, Math.floor(((w.x0 + w.x1) / 2) / 600));
      assert.ok(zi === 2 || zi === 4, `freshwater only in jungle/desert, seed ${s}`);
    }
  }
});

// --- size scaling ---

test('v0.26: size 2 doubles the world and the platforms', () => {
  const l = rollLayout(7, 2).layout;
  assert.equal(l.width, 9600);
  assert.equal(l.platforms.length, 94, '47 platforms × 2 clusters');
  assert.equal(l.zones[2].x1 - l.zones[2].x0, 1200, 'jungle is 1200 wide');
  // Cluster 1 repeats cluster 0's structure.
  const j0 = l.platformsByZone.jungle.slice(0, 9);
  const j1 = l.platformsByZone.jungle.slice(9, 18);
  for (let i = 0; i < 9; i++) {
    assert.equal(j1[i].x1 - j0[i].x1, 600, `cluster offset ${i}`);
    assert.equal(j1[i].kind, j0[i].kind);
  }
});

test('v0.26: founder cohorts scale with size (encounter density holds)', () => {
  const counts = [];
  for (const size of [1, 2]) {
    const w = createWorld(7, { size });
    populateGenesis(w);
    counts.push(w.creatures.length);
  }
  // 8 cohorts × 3–5 at size 1 (+14 promoted critters); at size 2 each of
  // the 2 clusters gets its own 8 cohorts.
  assert.ok(counts[0] >= 38 && counts[0] <= 54, `size 1: ${counts[0]}`);
  assert.ok(counts[1] >= 62 && counts[1] <= 94, `size 2: ${counts[1]}`);
  assert.ok(counts[1] > counts[0], `size 2 has more founders: ${counts[1]} > ${counts[0]}`);
});

// --- the sim reads the layout, not the painted map ---

test('v0.26: geography functions answer from the generated layout', () => {
  const w = createWorld(7);
  const l = w.layout;
  // biomeAt follows the generated zones.
  assert.equal(biomeAt(100, 0, l), 0);
  assert.equal(biomeAt(4799, 0, l), 7);
  // waterAt sees the generated ponds.
  const pond = l.waters.find((r) => !r.salt);
  assert.ok(pond, 'a pond exists');
  const px = (pond.x0 + pond.x1) / 2;
  const hit = waterAt(px, pond.surfaceY + 5, l);
  assert.ok(hit && !hit.salt, 'pond water is fresh');
  assert.equal(waterAt(px, pond.surfaceY - 50, l), null, 'air above the pond');
  // groundYAt reads the generated terrain.
  const g = groundYAt(1500, l);
  assert.ok(Number.isFinite(g) && g >= 780 && g <= 820, `jungle terrain ${g}`);
  assert.equal(groundYAt(3900, l), null, 'archipelago channel is open water');
});
