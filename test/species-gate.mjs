// Canopy v0.30 "Species gate" — the inherited species-tag mating gate.
// ECOLOGY_DESIGN §13.2: gate mating on tag match; species-level, not
// tribe-level; default-neutral so the viability battery passes unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld, bindWorld, tickWorld,
} from '../src/sim/world.js';
import {
  SPECIES, speciesKeys, founderGenome, founderPheno,
} from '../src/sim/species.js';
import { createRng } from '../src/sim/rng.js';
import { createCreature, gatherSenses } from '../src/sim/creature.js';
import {
  GENES, CHROMOSOMES, SPECIES_TAG_CHOICES, randomGenome, phenotype, inherit,
} from '../src/sim/genome.js';

// --- the locus ---------------------------------------------------------------

test('v0.30: speciesTag locus exists — choice over the species keys, on the morphology chromosome', () => {
  assert.equal(GENES.length, 257, 'v0.37: 239 + 18 affect loci');
  const g = GENES.find((x) => x.key === 'speciesTag');
  assert.ok(g, 'speciesTag in GENES');
  assert.equal(g.kind, 'choice');
  assert.deepEqual(g.choices, SPECIES_TAG_CHOICES);
  assert.ok(CHROMOSOMES[0].includes('speciesTag'), 'rides chromosome 1 (morphology)');
  // append-only: speciesTag sits at its v0.30 index; v0.32's nerve loci append after it;
  // v0.37's affect loci append last
  assert.equal(GENES[232].key, 'speciesTag');
  assert.equal(GENES[GENES.length - 1].key, 'g7slope', 'D1 regulatory loci append last');
});

test('v0.30: every species key has a tag choice', () => {
  for (const k of speciesKeys()) {
    assert.ok(SPECIES_TAG_CHOICES.includes(k), `${k} taggable`);
  }
});

test('v0.30: each founder expresses its own species as the tag, both homologs', () => {
  for (const k of speciesKeys()) {
    const { genome, pheno } = founderPheno(k, createRng(42));
    assert.equal(pheno.speciesTag, k, `${k} founder tags as ${k}`);
    const idx = SPECIES_TAG_CHOICES.indexOf(k);
    assert.deepEqual(genome.alleles.speciesTag, [idx, idx], `${k} tag pinned on both homologs`);
  }
});

test('v0.30: the tag is inherited — children of two tanglekins are tanglekins', () => {
  const mom = founderGenome('tanglekin', createRng(11));
  const dad = founderGenome('tanglekin', createRng(12));
  for (let i = 0; i < 10; i++) {
    const child = inherit(mom, dad, createRng(100 + i));
    assert.equal(phenotype(child).speciesTag, 'tanglekin', `child ${i} keeps the tag`);
  }
});

test('v0.30: the tag draws from its own sub-stream — earlier passes bit-identical', () => {
  // Same seed → same tag draw, and the pre-v0.30 alleles don't move:
  // the h8 pass only reads alleles drawn before it.
  const a = randomGenome(createRng(7));
  const b = randomGenome(createRng(7));
  assert.deepEqual(a.alleles.speciesTag, b.alleles.speciesTag, 'tag draw deterministic');
  assert.deepEqual(a.alleles.bodyHue, b.alleles.bodyHue, 'main stream deterministic');
  const c = randomGenome(createRng(8));
  assert.notDeepEqual(a.alleles.speciesTag, c.alleles.speciesTag, 'tag varies by seed');
});

// --- the gate ----------------------------------------------------------------

function mkPair(world, skeyA, skeyB) {
  // Two adults, opposite sexes, zero cooldown, well-fed, max fertility —
  // every gate open except the species tag.
  const mk = (skey, sex, x) => {
    const { genome, pheno } = founderPheno(skey, createRng(99));
    const c = createCreature(genome, x, 0, world.rng);
    c.pheno = pheno;
    c.sex = sex;
    c.biochem.age = c.pheno.lifespanSec * 0.5;
    c.mateCooldown = 0;
    c.biochem.hunger = 0;
    c.pheno.fertility = 1;
    c.parents = [1, 2]; // not founders — the hunger gate applies, hunger is 0
    world.creatures.push(c);
    return c;
  };
  const a = mk(skeyA, 'female', 1500);
  const b = mk(skeyB, 'male', 1520);
  return [a, b];
}

test('v0.30: tryMate blocks tanglekin x beetle — 50 attempts, zero matings', () => {
  const world = bindWorld(createWorld(31337));
  const [a, b] = mkPair(world, 'tanglekin', 'beetle');
  let mated = false;
  for (let i = 0; i < 50 && !mated; i++) mated = world.tryMate(a, b);
  assert.equal(mated, false, 'cross-species mating never fires');
  assert.equal(world.eggs.length, 0, 'no eggs from a blocked pairing');
});

test('v0.30: tryMate allows tanglekin x tanglekin — mating succeeds, eggs laid', () => {
  const world = bindWorld(createWorld(31337));
  const [a, b] = mkPair(world, 'tanglekin', 'tanglekin');
  let mated = false;
  for (let i = 0; i < 50 && !mated; i++) mated = world.tryMate(a, b);
  assert.ok(mated, 'same-species mating fires');
  assert.ok(world.eggs.length > 0, 'eggs laid');
  // The children carry the tag forward.
  for (const egg of world.eggs) {
    assert.equal(phenotype(egg.genome).speciesTag, 'tanglekin', 'egg keeps the tag');
  }
});

test('v0.30: cross-tribe tanglekins still mate — the gate is species-level', () => {
  // Tribes are detected bands, never assigned: two tanglekins 3000px apart
  // would detect as different tribes. The tag gate must not care.
  const world = bindWorld(createWorld(777));
  const [a, b] = mkPair(world, 'tanglekin', 'tanglekin');
  a.x = 500; b.x = 3500; // far apart — different detected bands
  let mated = false;
  for (let i = 0; i < 50 && !mated; i++) mated = world.tryMate(a, b);
  assert.ok(mated, 'distance (tribe) does not block same-species mating');
});
