// M2 tests: genome → body. The diploid genome, meiosis, epigenetics are
// imported from sim/genome.js (untouched); body.js grows the body from it.
// Run: node --test test/material-m2-genome.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { randomGenome, phenotype, meiosis, inherit, markLocus } from '../src/sim/genome.js';
import { createRng } from '../src/sim/rng.js';
import { growBody, bodyDrawing, addMark } from '../src/material/body.js';
import { M2_GENES, m2PhenoDefaults } from '../src/material/genes.js';

test('m2: randomGenome + phenotype produce a working phenotype', () => {
  const g = randomGenome(createRng(7), {});
  const p = phenotype(g);
  assert.ok(p.bodyRadius > 0, 'bodyRadius');
  assert.ok(p.brainSize > 0, 'brainSize');
});

test('m2: meiosis + inherit produce a child genome', () => {
  const rng = createRng(42);
  const mom = randomGenome(rng, {});
  const dad = randomGenome(rng, {});
  const child = inherit(mom, dad, rng);
  assert.ok(child.alleles, 'child has alleles');
  assert.equal(typeof phenotype(child).size, 'number');
});

test('m2: epigenetic marks scale expression', () => {
  const rng = createRng(99);
  const g = randomGenome(rng, {});
  const before = phenotype(g).size;
  markLocus(g, 'size', -0.5);
  const after = phenotype(g).size;
  assert.ok(after < before, 'mark reduces expression');
});

test('m2: growBody returns a grown body, founder-shaped', () => {
  const g = randomGenome(createRng(7), {});
  const body = growBody(g, { stage: 'adult' });
  assert.ok(body.heightPx > 40 && body.heightPx < 120, `height ${body.heightPx}`);
  assert.ok(body.plan.limbs.length >= 4, 'limbs exist');
  assert.ok(body.graspPairs >= 1, 'founder has grasp pairs');
  // Anatomy gate: founder digPower == M1's DIG_POWER == 1
  assert.equal(body.digPower, 1, 'founder digPower is 1');
});

test('m2: babies are smaller than adults (development is honest)', () => {
  const g = randomGenome(createRng(7), {});
  const baby = growBody(g, { stage: 'baby' });
  const adult = growBody(g, { stage: 'adult' });
  assert.ok(baby.heightPx < adult.heightPx, 'baby < adult');
  assert.ok(baby.growth01 < adult.growth01, 'growth01 reflects stage');
});

test('m2: starved juveniles stunt', () => {
  const g = randomGenome(createRng(7), {});
  const fed = growBody(g, { stage: 'child', juvSugarMean: 0.9 });
  const starved = growBody(g, { stage: 'child', juvSugarMean: 0.2 });
  assert.ok(starved.heightPx < fed.heightPx, 'starvation stunts');
});

test('m2: different genomes grow different bodies', () => {
  const a = growBody(randomGenome(createRng(7), {}), { stage: 'adult' });
  const b = growBody(randomGenome(createRng(1234), {}), { stage: 'adult' });
  assert.ok(a.heightPx !== b.heightPx || a.plan.limbs.length !== b.plan.limbs.length,
    'genomes individualize bodies');
});

test('m2: bodyDrawing describes the body for the renderer', () => {
  const g = randomGenome(createRng(7), {});
  const d = bodyDrawing(growBody(g, { stage: 'adult' }));
  assert.ok(d.limbs.length > 0 && d.tails >= 1, 'drawing has limbs + tail');
  assert.ok(d.hueDeg >= 0 && d.hueDeg <= 360, 'hue in range');
});

test('m2: world marks accumulate on the body', () => {
  const g = randomGenome(createRng(7), {});
  const body = growBody(g, { stage: 'adult' });
  assert.equal(addMark(body, { kind: 'scar', limb: 0, severity: 0.8 }), 1);
  const d = bodyDrawing(body);
  assert.ok(d.limbs[0].scarred, 'scarred limb draws scarred');
  assert.equal(d.scarCount, 1);
});

test('m2: M2 instinct genes target the new actions', () => {
  const acts = M2_GENES.map((g) => g.action).sort();
  // The three new M2 verbs (pile, instPile, geophagy) must have genes
  // (Paul's v0.5 rule). The starvation-fix genes (drive priority, proximity
  // gate) target older actions — they are Loam-specific overrides, also
  // in M2_GENES, and also tested below.
  for (const a of [30, 30, 31, 32]) {
    assert.ok(acts.includes(a), `action ${a} has an M2 gene`);
  }
  for (const g of M2_GENES) {
    assert.ok(g.sense >= 0 && g.sense <= 46, `${g.key} sense in range`);
  }
  const d = m2PhenoDefaults();
  for (const g of M2_GENES) assert.equal(d[g.key], g.founder, `${g.key} default`);
});
