// Canopy v0.22.2 — the critter promotion.
// The butterfly and the bug were scripted brainless critters (world.critters,
// drawn by drawCritter). Now they're the 13th and 14th founders — flutter
// (pollinator) and grub (prey base) — on the one engine, and the old path is
// retired entirely. These tests pin the roster, the retirement, the
// pollination mechanic — and per the execution-probe rule, they watch a
// flutter pollinate a flower into fruit and a grub get eaten, in a live sim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld, bindWorld, populate, populateGenesis, tickWorld,
  tickPollination, platformIndexAt, soilAt,
} from '../src/sim/world.js';
import {
  SPECIES, speciesKeys, founderGenome, founderPheno,
  STARTER_SETS, CAPS, TIER_OF, isPromotedLineage,
} from '../src/sim/species.js';
import { createRng } from '../src/sim/rng.js';
import { createCreature, doEat } from '../src/sim/creature.js';
import { expressBuds } from '../src/sim/evodevo.js';
import { GENES } from '../src/sim/genome.js';

const mean = (alleles) => (alleles[0] + alleles[1]) / 2;
const founderAllele = (species, key, seed = 11) =>
  mean(founderGenome(species, createRng(seed)).alleles[key]);

// --- the roster -----------------------------------------------------------------

test('v0.22.2: flutter + grub are the 13th and 14th founders — PIN salts 13/14', () => {
  // PIN salts are pinned sub-streams: same species + seed → identical alleles,
  // different species → different founders even on the same seed.
  const f1 = founderGenome('flutter', createRng(11));
  const f2 = founderGenome('flutter', createRng(11));
  const g1 = founderGenome('grub', createRng(11));
  for (const gene of GENES) {
    assert.deepEqual(f1.alleles[gene.key], f2.alleles[gene.key], `flutter.${gene.key} deterministic`);
  }
  let diff = 0;
  for (const gene of GENES) {
    if (JSON.stringify(f1.alleles[gene.key]) !== JSON.stringify(g1.alleles[gene.key])) diff++;
  }
  assert.ok(diff > 20, `distinct sub-streams: ${diff} loci differ`);
});

test('v0.22.2: flutter founder-exactness — day-one flyer, nectar-feeding, soft prey', () => {
  const { genome, pheno } = founderPheno('flutter', createRng(11));
  assert.equal(pheno.diet, 'herbivore', 'nectar diet');
  assert.ok(pheno.size <= 0.15, `tiny, got ${pheno.size}`);
  assert.ok(Math.abs(pheno.bodyHue - 0.92) < 0.05, `pink — the old butterfly, got ${pheno.bodyHue}`);
  assert.equal(mean(genome.alleles.budDorsalGrow), 1, 'dorsal membranes grown day one');
  assert.ok(expressBuds(pheno, 1).wingArea > 0.6, 'adults clear the glide gate — they fly');
  assert.ok(mean(genome.alleles.instFearFlee) >= 0.85, 'the prey strategy: flee');
  assert.equal(pheno.spikes, 0, 'soft — no armor');
  assert.equal(TIER_OF.flutter, 3, 'bug-tier brain');
  assert.ok(SPECIES.flutter.exact.length > 0, 'documented');
});

test('v0.22.2: grub founder-exactness — the prey base, soft and fearful', () => {
  const { genome, pheno } = founderPheno('grub', createRng(11));
  assert.equal(pheno.diet, 'omnivore', 'detritus + scraps');
  assert.ok(pheno.size <= 0.12, `tiny, got ${pheno.size}`);
  assert.ok(pheno.bodyHue < 0.15, `dark — the old bug, got ${pheno.bodyHue}`);
  assert.equal(mean(genome.alleles.instFearFlee), 1.0, 'the whole strategy is fleeing');
  assert.equal(pheno.spikes, 0, 'soft — edible');
  assert.equal(TIER_OF.grub, 3, 'bug-tier brain');
  assert.ok(SPECIES.grub.exact.length > 0, 'documented');
});

test('v0.22.2: no new loci — GENES stays 230', () => {
  assert.equal(GENES.length, 239, 'promotion adds values, not loci (239 = 233 + v0.32 six nerve loci)');
});

test('v0.22.2: starter sets + caps cover the promoted', () => {
  assert.ok(STARTER_SETS.jungle.some(([k]) => k === 'flutter'), 'flutters seed jungle');
  assert.ok(STARTER_SETS.jungle.some(([k]) => k === 'grub'), 'grubs seed jungle');
  assert.equal(CAPS.flutter, 30);
  assert.equal(CAPS.grub, 40);
});

// --- the retirement ---------------------------------------------------------------

test('v0.22.2: world.critters is retired — the field is gone', () => {
  const world = createWorld(7);
  assert.ok(!('critters' in world), 'no critters field on a new world');
  const w2 = bindWorld(createWorld(8));
  populate(w2); // the legacy path — spawned bugs + butterflies before
  assert.ok(!('critters' in w2), 'legacy populate spawns no critters');
});

// --- genesis spawns them as creatures ---------------------------------------------

test('v0.22.2: genesis grows 6 flutters + 8 grubs on the one engine', () => {
  const world = bindWorld(createWorld(117));
  populateGenesis(world);
  const flutters = world.creatures.filter((c) => isPromotedLineage(c) && c.pheno.bodyHue > 0.85);
  const grubs = world.creatures.filter((c) => isPromotedLineage(c) && c.pheno.bodyHue < 0.15);
  assert.equal(flutters.length, 6, 'six flutters');
  assert.equal(grubs.length, 8, 'eight grubs');
  for (const c of [...flutters, ...grubs]) {
    assert.ok(c.genome && c.brain && c.biochem, 'full creature — genome, brain, body');
    assert.ok(c.alive, 'born alive');
  }
  // Every cohort breeds: both sexes present.
  assert.ok(flutters.some((c) => c.sex === 'male') && flutters.some((c) => c.sex === 'female'), 'flutter sexes');
  assert.ok(grubs.some((c) => c.sex === 'male') && grubs.some((c) => c.sex === 'female'), 'grub sexes');
  // Flutters on branches, grubs on the ground.
  for (const c of flutters) assert.equal(world.platforms[c.platformIndex].kind, 'branch', 'flutter on a branch');
  for (const c of grubs) assert.equal(world.platforms[c.platformIndex].kind, 'ground', 'grub on the ground');
});

// --- the grub eats ------------------------------------------------------------------

test('v0.22.2: grub grazes detritus — the v0.22 detritivory path, smaller', () => {
  const world = bindWorld(createWorld(4242));
  const c = createCreature(founderGenome('grub', createRng(11)), 1500, 0, world.rng);
  c._senses = { _food: null };
  c.biochem.illness = 0;
  // v2: soil is keyed by region id, not zone label — soilAt resolves it.
  const soil = soilAt(world, 1500);
  soil.waste = 3.0;
  const wasteBefore = soil.waste;
  const ateBefore = c._ate || 0;
  assert.ok(doEat(c, world), 'grub eats with no food item present');
  assert.ok(soil.waste < wasteBefore, 'waste left the soil');
  assert.ok((c._ate || 0) > ateBefore, 'nutrition entered the body');
  assert.equal(c.actionLabel, 'grazing detritus');
});

// --- EXECUTION PROBE 1: the flutter pollinates ----------------------------------------
// A live flutter visits two flowers in a ticking world; the second flower's
// pollination meter rises; a fully-pollinated flower sets more fruit than an
// unvisited one. This is the probe the QA bar demands — not a wiring test.

test('v0.22.2 PROBE: a flutter visits flowers — pollen moves, fruit set rises', () => {
  const world = bindWorld(createWorld(5150));
  populate(world);
  world.creatures.length = 0; // clear the legacy founders — just us and the flowers
  const flowers = world.plants.filter((p) => p.kind === 'plant');
  assert.ok(flowers.length >= 2, 'flowers to visit');
  const [A, B] = flowers;
  A.growth = 1; B.growth = 1;
  A.flower = 'bloom'; B.flower = 'bloom'; // v0.34: only bloom flowers are visitable
  B.floraId = A.floraId; // same species — deposition requires a species match
  B.x = A.x + 100; // visiting distance
  B.y = A.y; B.platformIndex = A.platformIndex;

  const fl = createCreature(founderGenome('flutter', createRng(11)), A.x, A.platformIndex, world.rng);
  fl.biochem.age = fl.pheno.lifespanSec * 0.4;
  world.creatures.push(fl);
  // The wing gate is phenotypic: the live body plan must pass it.
  assert.ok((fl.bodyPlan.wingArea || 0) > 0.1, `flutter is winged, got ${fl.bodyPlan.wingArea}`);

  // Visit flower A: one tick — the FIRST visit, before any wandering.
  fl.x = A.x; fl.y = A.y;
  tickWorld(world, 0.5);
  // The visit registers on the nearest flower in reach — which flower that
  // is depends on the flutter's brain (it may drift a few px), so the probe
  // follows the visit instead of pinning the flower's identity.
  // v0.34: the visit is a pollen TAG { floraId, donorId, donorGenome,
  // viability }, not a bare plant id.
  const firstTag = (fl.pollen || [])[0];
  assert.ok(firstTag, 'the flutter picked up a pollen tag');
  const first = world.plants.find((p) => p.id === firstTag.donorId);
  assert.ok(first, 'the flutter visited a flower');
  assert.ok(Math.abs(first.x - A.x) <= 120, `visited near flower A, got ${first && first.x}`);
  assert.equal(first.pollination, 0, 'first visit carries no other-flower pollen — nothing to deposit');
  assert.ok(firstTag.viability > 0.9, `fresh pollen is viable, got ${firstTag.viability}`);
  // Keep visiting; pollen now moves flower to flower.
  for (let i = 0; i < 3; i++) tickWorld(world, 0.5);

  // Visit flower B carrying A's pollen.
  fl.x = B.x; fl.y = B.y;
  for (let i = 0; i < 4; i++) tickWorld(world, 0.5);
  assert.ok(B.pollination > 0, `flower B pollinated, got ${B.pollination}`);
  assert.ok(world.events.some((e) => e.type === 'pollinated'), 'the visit is in the chronicle');

  // The nectar sip is real: _ate accumulates through tickPollination alone.
  fl._ate = 0;
  tickPollination(world, 0.5);
  assert.ok((fl._ate || 0) > 0, 'the visitor sips nectar');

  // Fruit set: same flower, pollinated vs not.
  A.pollination = 1; B.pollination = 0;
  A.pheno.yield = 0.9; B.pheno.yield = 0.9;
  A.fruitTimer = 0.01; B.fruitTimer = 0.01;
  const foodsBefore = world.foods.length;
  const nearA = (f) => Math.abs(f.x - A.x) < 40;
  const nearB = (f) => Math.abs(f.x - B.x) < 40;
  tickWorld(world, 0.5);
  const fresh = world.foods.slice(foodsBefore);
  const aFruits = fresh.filter(nearA).length;
  const bFruits = fresh.filter(nearB).length;
  assert.ok(aFruits > bFruits, `pollinated flower sets more fruit: ${aFruits} vs ${bFruits}`);
  assert.ok(bFruits >= 1, 'wind-pollinated baseline still fruits');
});

// --- EXECUTION PROBE 2: the grub gets eaten --------------------------------------------
// A jungle-cat bites a grub in a ticking world until it dies; the kill →
// corpse path fires with cause 'wounds'. The prey base feeds the predators.

test('v0.22.2 PROBE: a grub gets eaten — bites kill, the corpse feeds the web', () => {
  const world = bindWorld(createWorld(77));
  world.creatures.length = 0;
  const pi = platformIndexAt(world, 1500, 800);
  const cat = createCreature(founderGenome('jungle-cat', world.rng), 1500, pi, world.rng);
  cat.biochem.age = cat.pheno.lifespanSec * 0.5;
  cat.pheno.spikes = 0; cat.pheno.spikeArmor = 0;
  cat.biochem.hunger = 0; cat.biochem.energy = 1;
  const grub = createCreature(founderGenome('grub', world.rng), 1512, pi, world.rng);
  grub.biochem.age = grub.pheno.lifespanSec * 0.4;
  world.creatures.push(cat, grub);

  let dead = false;
  for (let t = 0; t < 600 && !dead; t++) {
    cat.action = 'bite'; cat.actionTimer = 100; // force the bite
    grub.x = cat.x + 12; // staged geometry: the cat holds the range
    grub.biochem.bloodSugar = 1; // fed — isolate the wound kill, not starvation
    cat.biochem.bloodSugar = 1; // the attacker too — isolate the bite mechanism,
    // not the cat's metabolism (hunger/exhaustion overrides would call off the attack)
    tickWorld(world, 0.1);
    dead = !grub.alive;
  }
  assert.ok(dead, 'the grub dies under bites');
  const death = world.events.find((e) => e.type === 'death' && e.creature === grub);
  assert.ok(death, 'death in the ledger');
  assert.equal(death.cause, 'wounds', `death by bite, not by script — got ${death.cause}`);
  assert.ok(world.foods.some((f) => f.foodKind === 'corpse'), 'the kill leaves a corpse for the scavengers');
});
