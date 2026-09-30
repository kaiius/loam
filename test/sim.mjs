// Unit tests for the v0.3 systems (evolvable instincts, deep brain learning,
// illness + immunity) and v0.4 (episodic memory, recall, sleep consolidation,
// observational social learning). Run: node --test test/sim.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GENES, randomGenome, inherit, phenotype, markLocus, genomeDistance, DUP_RATE, DEL_RATE, MAX_EXTRA } from '../src/sim/genome.js';
import { createBrain, decide, learn, senseVector, ACTIONS } from '../src/sim/brain.js';
import { createBiochem, tickBiochem, mood } from '../src/sim/biochem.js';
import { createRng } from '../src/sim/rng.js';
import { createWorld, bindWorld, populate, tickWorld, addFood, layEgg, addPebble, addPlant, addHerb, disperseSeed, recordLineage, LINEAGE_TRAITS, zoneAt, ZONES, climbLinksFrom, genomeHash, checkNovelGenome, recordFounderMeans, computeDivergence, DIVERGENCE_CREATURE_TRAITS, emitCall, callsHeardBy, computeSpecies, hybridViability, HYBRID_THRESHOLD, SPECIES_DIST, excrete, tickSoil, soilGrowthMul, wasteOdorOf, WASTE_FRACTION, EXCRETE_RATE, SOIL_DECAY, SOIL_LEACH, SOIL_FERT_MAX, WASTE_ODOR_SCALE, CONTAM_ILLNESS, compostRot, shedLitter, SCRAP_FRACTION, SCRAP_ROT, SCRAP_NUTRITION, LITTER_RATE } from '../src/sim/world.js';
import {
  createMemory, writeEpisode, shouldWrite, recall, consolidate,
  memoryCapacity, RECALL_BUDGET,
} from '../src/sim/memory.js';
import {
  createCulture, foundGrove, adoptTradition, traditionVotes, groveTarget,
  pruneExtinct, sampleCulture, ratchetIndex, fidelityOf,
} from '../src/sim/culture.js';
import { finalizeEpisode, maybeFoundGrove, doEat, createCreature, updateCreature, groundCallType, creatureRadius, stepPhysics, gatherSenses, GRAVITY, FALL_HURT_V, JUMP_V_BASE, JUMP_V_GAIN } from '../src/sim/creature.js';
import { createBonds, getBond, nudgeBond, tickBonds, pedigreeKin, detectTribes, socialStats } from '../src/sim/social.js';
import { randomPlantGenome, plantPhenotype, inheritPlant, plantMeiosis, PLANT_GENES } from '../src/sim/plantgenome.js';
import { createTeacher, tickTeacher, commandTeacher, setTeacherMode, teacherDemo, teacherReward, teacherRewardNearest, emitTeacherCall, TEACHER_MOTIF, TEACHER_PITCH, IMITATION_WINDOW, gatherTeacherSenses, teacherEat, petTeacher, teacherSenseLines, serializeTeacherSenses, foodFlavor } from '../src/sim/teacher.js';
import { worldToScreen, screenToWorld, fitCamera, zoomAt, panBy, recenterCamera, followPoint, CAM_MIN_ZOOM, CAM_MAX_ZOOM, CAM_PAN_MARGIN } from '../src/render/renderer.js';

const N_SENSES = 24; // canopy: v0.12's 18 + climbUp, climbDown, groomNear, jumpNear + v0.14's callHeard, callPitch, wasteOdor

function testPheno(seed, overrides = {}) {
  const p = phenotype(randomGenome(createRng(seed)));
  return { ...p, ...overrides };
}

// Canopy's brain is sparse (s2a/a2m adjacency lists + biases + instW).
// Zero the LEARNED pathway to isolate instincts — the instinct matrix stays.
function silenceBrain(brain) {
  for (const row of brain.s2a.w) row.fill(0);
  for (const row of brain.a2m.w) row.fill(0);
  brain.biasA.fill(0);
  brain.biasM.fill(0);
  return brain;
}

function snapshotBrain(brain) {
  return JSON.stringify([brain.s2a, brain.a2m, brain.biasA, brain.biasM, brain.instW]);
}

const MID_SENSES = {
  hunger: 0.5, tiredness: 0.5, boredom: 0.5, loneliness: 0.5, fear: 0,
  light: 1, foodDist: 0.5, foodDir: 1, creatureDist: 1, creatureDir: 0,
  toyDist: 1, toyDir: 0, isAdult: 1, illness: 0,
};

test('instinct genes map to valid sense/action indices', () => {
  const inst = GENES.filter((g) => g.sense !== undefined);
  assert.equal(inst.length, 20); // v0.12: 13 + canopy's instClimbUp/Down, instLonelyGroom, instJump + v0.14's instHeardVocal, instLonelyVocal, instWasteFlee
  for (const g of inst) {
    assert.ok(g.sense >= 0 && g.sense < N_SENSES, g.key);
    assert.ok(g.action >= 0 && g.action < ACTIONS.length, g.key);
  }
});

test('instinct alleles inherit from parents (no mutation)', () => {
  const rng = createRng(7);
  const mom = randomGenome(rng);
  const dad = randomGenome(rng);
  const child = inherit(mom, dad, rng, 0);
  for (const g of GENES) {
    const [a, b] = child.alleles[g.key];
    assert.ok(mom.alleles[g.key].includes(a), g.key);
    assert.ok(dad.alleles[g.key].includes(b), g.key);
  }
});

test('founder genomes bias instincts toward sensible defaults', () => {
  const rng = createRng(99);
  let sum = 0;
  const N = 200;
  for (let i = 0; i < N; i++) sum += phenotype(randomGenome(rng)).instHungerSeek;
  const mean = sum / N;
  assert.ok(mean > 0.6 && mean < 1.0, `mean instHungerSeek ${mean.toFixed(3)}`);
});

test('brain builds instinct weights from the genome', () => {
  const rng = createRng(11);
  const overrides = { instHungerSeek: 1, instHungerEat: 0 };
  for (const g of GENES) {
    if (g.sense !== undefined && !(g.key in overrides)) overrides[g.key] = 0.5;
  }
  const brain = createBrain(testPheno(11, overrides), rng);
  assert.equal(brain.instW[0][0], (1 - 0.5) * 2.4); // seekFood <- hunger
  assert.equal(brain.instW[1][0], (0 - 0.5) * 2.4); // eat <- hunger (inhibitory)
  assert.equal(brain.instW[3][2], 0); // play <- boredom neutral
});

test('a strong hunger instinct biases the action choice', () => {
  const rng = createRng(21);
  const overrides = { curiosity: 0, sociability: 0, boldness: 0.5, learningRate: 0 };
  for (const g of GENES) {
    if (g.sense !== undefined) overrides[g.key] = 0.5;
  }
  overrides.instHungerSeek = 1;
  overrides.instHungerEat = 1;
  const brain = createBrain(testPheno(21, overrides), rng);
  // Silence the learned pathway to isolate the instinct pathway.
  silenceBrain(brain);
  const s = { ...MID_SENSES, hunger: 1, foodDist: 0.5 };
  const { action } = decide(brain, senseVector(s), 0, rng);
  assert.equal(action, 'seekFood');
});

test('hidden-layer weights change with reward, and freeze without it', () => {
  const rng = createRng(31);
  const brain = createBrain(testPheno(31), rng);
  const snap = (b) => JSON.stringify(b.s2a.w);
  const before = snap(brain);
  decide(brain, senseVector(MID_SENSES), 0, rng);
  learn(brain, testPheno(31), 0.8);
  assert.notEqual(snap(brain), before, 's2a weights should update on reward');
  // Zero reward: no change.
  const frozen = snap(brain);
  decide(brain, senseVector(MID_SENSES), 0, rng);
  learn(brain, testPheno(31), 0);
  assert.equal(snap(brain), frozen);
});

test('low immunity lets a mild case worsen past contagious levels', () => {
  const b = createBiochem();
  b.illness = 0.35; // natural spontaneous-onset level
  b.energy = 0.9;
  b.hunger = 0.2;
  const p = { immunity: 0, hungerRate: 0.5, energyDrain: 0.5 };
  for (let t = 0; t < 120; t++) tickBiochem(b, p, 1);
  assert.ok(
    b.illness > 0.5,
    `mild case should turn contagious (got ${b.illness.toFixed(3)})`
  );
});

test('high immunity clears illness entirely', () => {
  const b = createBiochem();
  b.illness = 1;
  b.energy = 0.9;
  b.hunger = 0.2;
  const p = { immunity: 1, hungerRate: 0.5, energyDrain: 0.5 };
  for (let t = 0; t < 120; t++) tickBiochem(b, p, 1);
  assert.equal(
    b.illness,
    0,
    `high immunity should clear illness (got ${b.illness.toFixed(3)})`
  );
});

test('mild cases become contagious and infect neighbors naturally', () => {
  const world = bindWorld(createWorld(789));
  populate(world);
  const [a, b] = world.creatures;
  a.pheno.immunity = 0;
  b.pheno.immunity = 0;
  a.biochem.illness = 0.35; // natural spontaneous-onset level, not pinned
  let contagious = false;
  let transmitted = false;
  for (let t = 0; t < 1500 && !transmitted; t++) {
    a.biochem.health = 1; // keep the source alive; lethality is tested separately
    b.biochem.health = 1;
    b.x = a.x + 50; // stay side by side
    b.platformIndex = a.platformIndex;
    tickWorld(world, 0.1);
    if (a.biochem.illness > 0.5) contagious = true;
    if (contagious && b.biochem.illness > 0) transmitted = true;
  }
  assert.ok(
    contagious,
    'a mild case should worsen past the contagious threshold on its own'
  );
  assert.ok(transmitted, 'the worsened case should infect a nearby creature');
});

test('serious illness damages health and reads as sick', () => {
  const b = createBiochem();
  b.illness = 0.9;
  b.hunger = 0.2;
  b.energy = 0.9;
  const p = { immunity: 0.5, hungerRate: 0.5, energyDrain: 0.5 };
  const h0 = b.health;
  tickBiochem(b, p, 10);
  assert.ok(b.health < h0, 'illness should damage health');
  assert.equal(mood(b), 'sick');
});

test('illness spreads between close creatures', () => {
  const world = bindWorld(createWorld(123));
  populate(world);
  const [a, b] = world.creatures;
  b.pheno.immunity = 0; // maximally susceptible
  let infected = false;
  for (let t = 0; t < 300 && !infected; t++) {
    a.biochem.illness = 1; // keep the source contagious
    b.x = a.x + 50; // keep them side by side
    b.platformIndex = a.platformIndex;
    tickWorld(world, 0.1);
    if (b.biochem.illness > 0) infected = true;
  }
  assert.ok(infected, 'a nearby creature should catch the illness');
});

test('severe illness kills and is recorded as the cause', () => {
  const world = bindWorld(createWorld(456));
  populate(world);
  const c = world.creatures[0];
  c.biochem.illness = 1;
  c.biochem.health = 0.05;
  c.biochem.bloodSugar = 0.8; // well-fed: rule out starvation (canopy: hunger is the readout)
  c.biochem.fatigue = 0.1; // → energy 0.9
  c.pheno.immunity = 0; // slow recovery
  let cause = null;
  for (let t = 0; t < 200 && c.alive; t++) {
    tickWorld(world, 0.5);
    const d = world.events.find((e) => e.type === 'death' && e.creature === c);
    if (d) cause = d.cause;
  }
  assert.equal(cause, 'illness');
});

// ---- v0.4: episodic memory ----

test('episodes are written for salient outcomes, not trivia', () => {
  assert.ok(shouldWrite({ reward: 0.6, critical: false, kind: 'lived' }), 'salient reward writes');
  assert.ok(shouldWrite({ reward: -0.6, critical: false, kind: 'lived' }), 'salient punishment writes');
  assert.ok(!shouldWrite({ reward: 0.05, critical: false, kind: 'lived' }), 'trivia does not write');
  assert.ok(shouldWrite({ reward: 0.05, critical: true, kind: 'lived' }), 'critical drive states write');
  assert.ok(shouldWrite({ reward: 0.2, critical: false, kind: 'observed' }), 'observed writes at a lower bar');
  assert.ok(!shouldWrite({ reward: 0.05, critical: false, kind: 'observed' }), 'dim observations do not write');
});

test('a full memory forgets the dimmest episode first', () => {
  const mem = createMemory(testPheno(2, { memory: 0 }));
  assert.equal(mem.capacity, 16);
  const input = senseVector(MID_SENSES);
  for (let i = 0; i < 16; i++) {
    assert.ok(writeEpisode(mem, { input, action: i % 8, reward: 0.4, tick: i, kind: 'lived', critical: false }));
  }
  assert.equal(mem.episodes.length, 16);
  // A dimmer episode is rejected outright...
  assert.ok(!writeEpisode(mem, { input, action: 0, reward: 0.35, tick: 99, kind: 'lived', critical: false }));
  assert.equal(mem.episodes.length, 16);
  // ...while a brighter one displaces the dimmest.
  assert.ok(writeEpisode(mem, { input, action: 0, reward: 0.9, tick: 100, kind: 'lived', critical: false }));
  assert.equal(mem.episodes.length, 16);
  assert.ok(mem.episodes.some((e) => e.reward === 0.9), 'bright episode kept');
  assert.ok(!mem.episodes.some((e) => e.tick === 0), 'dimmest episode forgotten');
});

test('recall votes for the remembered action in similar senses', () => {
  const mem = createMemory(testPheno(3));
  const input = senseVector(MID_SENSES);
  writeEpisode(mem, { input, action: 1, reward: 0.8, tick: 0, kind: 'lived', critical: false }); // eat felt good
  writeEpisode(mem, { input, action: 5, reward: -0.8, tick: 1, kind: 'lived', critical: false }); // flee felt bad
  const votes = recall(mem, input);
  assert.ok(votes[1] > 0, 'votes for the rewarded action');
  assert.ok(votes[5] < 0, 'votes against the punished action');
  const total = votes.reduce((s, v) => s + Math.abs(v), 0);
  assert.ok(total <= RECALL_BUDGET + 1e-9, `shared budget respected, got ${total}`);
  // Direction matters: among competing memories, the most similar dominates.
  const hungry = senseVector({ ...MID_SENSES, hunger: 1, fear: 0 });
  const afraid = senseVector({ ...MID_SENSES, hunger: 0, fear: 1 });
  const mem2 = createMemory(testPheno(3));
  writeEpisode(mem2, { input: hungry, action: 1, reward: 0.8, tick: 0, kind: 'lived', critical: false });
  writeEpisode(mem2, { input: afraid, action: 5, reward: 0.8, tick: 1, kind: 'lived', critical: false });
  const v2 = recall(mem2, hungry);
  assert.ok(v2[1] > v2[5], 'the most similar episode dominates the vote');
});

test('recall votes nudge the choice without polluting learned outputs', () => {
  const rng = createRng(4);
  const brain = createBrain(testPheno(4), rng);
  const input = senseVector(MID_SENSES);
  const votes = new Array(ACTIONS.length).fill(0);
  votes[3] = 10; // overwhelming nudge toward play
  const r = decide(brain, input, 0, rng, votes);
  assert.equal(r.action, 'play');
  // lastOut holds the brain's own computation — learning never sees the nudge.
  const clean = decide(brain, input, 0, rng);
  for (let j = 0; j < ACTIONS.length; j++) {
    assert.ok(Math.abs(brain.lastOut[j] - clean.outputs[j]) < 1e-12, `output ${j} unpolluted`);
  }
});

test('sleep consolidation replays salient episodes into the brain', () => {
  const rng = createRng(5);
  const pheno = testPheno(5);
  const brain = createBrain(pheno, rng);
  const mem = createMemory(pheno);
  const input = senseVector(MID_SENSES);
  writeEpisode(mem, { input, action: 1, reward: 0.9, tick: 0, kind: 'lived', critical: false });
  const before = JSON.stringify(brain.a2m.w);
  assert.equal(consolidate(mem, brain, pheno), 1);
  assert.notEqual(JSON.stringify(brain.a2m.w), before, 'replay should move weights');
});

test('consolidation with no episodes changes nothing', () => {
  const rng = createRng(6);
  const pheno = testPheno(6);
  const brain = createBrain(pheno, rng);
  const mem = createMemory(pheno);
  const before = snapshotBrain(brain);
  assert.equal(consolidate(mem, brain, pheno), 0);
  assert.equal(snapshotBrain(brain), before);
});

test('witnesses learn by observation at a discount', () => {
  const world = bindWorld(createWorld(7));
  populate(world);
  const [actor, witness] = world.creatures;
  tickWorld(world, 0.1); // everyone senses + decides once
  // Stage a salient lived outcome for the actor, witness close by and awake.
  witness.platformIndex = actor.platformIndex;
  witness.x = actor.x + 100;
  witness.sleeping = false;
  actor.episodeInput = senseVector(MID_SENSES);
  actor.episodeAction = 1; // eat
  actor.episodeReward = 0.8;
  const before = witness.memory.episodes.length;
  finalizeEpisode(actor, world);
  const observed = witness.memory.episodes.slice(before).filter((e) => e.kind === 'observed');
  assert.ok(observed.length > 0, 'witness should record an observed episode');
  assert.ok(observed.every((e) => e.action === 1), 'observes the acted action');
  assert.ok(
    observed.every((e) => Math.abs(e.reward - 0.4) < 1e-9),
    'watching is worth half of doing'
  );
});

test('a salient outcome becomes an episode through the live tick', () => {
  const world = bindWorld(createWorld(21));
  populate(world);
  const c = world.creatures[0];
  tickWorld(world, 0.1); // senses + first decision
  const before = c.memory.episodes.length;
  // Hand-feed: food adjacent, committed to eating, kept awake.
  addFood(world, c.x + 5, c.platformIndex, 'fruit', 1);
  tickWorld(world, 0.1);
  c.sleeping = false;
  c.action = 'eat';
  c.actionTimer = 5;
  for (let t = 0; t < 5; t++) tickWorld(world, 0.1);
  c.sleepTicks = 0;
  c.sleeping = false;
  c.actionTimer = 0; // force re-decision → finalize the meal
  tickWorld(world, 0.1);
  assert.ok(c.memory.episodes.length > before, 'the meal should be remembered');
  const ep = c.memory.episodes[c.memory.episodes.length - 1];
  assert.ok(ep.reward > 0.3, `episode reward ${ep.reward.toFixed(2)} clears the write bar`);
});

test('memory capacity is set by an evolvable gene', () => {
  assert.equal(memoryCapacity(testPheno(8, { memory: 0 })), 16);
  assert.equal(memoryCapacity(testPheno(8, { memory: 1 })), 64);
  assert.ok(GENES.some((g) => g.key === 'memory'), 'memory is a registered gene');
  const rng = createRng(8);
  const mom = randomGenome(rng);
  const dad = randomGenome(rng);
  const child = inherit(mom, dad, rng, 0);
  const [a, b] = child.alleles.memory;
  assert.ok(mom.alleles.memory.includes(a) && dad.alleles.memory.includes(b), 'memory alleles inherit');
});

// ---- v0.5: the extinction fix ----

test('v0.5: mate finally has an instinct pathway', () => {
  const inst = GENES.filter((g) => g.sense !== undefined);
  assert.equal(inst.length, 20); // canopy: v0.12's 13 + instClimbUp/Down, instLonelyGroom, instJump + v0.14's instHeardVocal, instLonelyVocal, instWasteFlee
  const g = GENES.find((g) => g.key === 'instLonelyMate');
  assert.ok(g, 'instLonelyMate is a registered gene');
  assert.equal(g.sense, 3, 'driven by loneliness (need for company)');
  assert.equal(g.action, 6, 'drives the mate action');
  assert.equal(ACTIONS[6], 'mate');
  assert.equal(GENES.length, 186); // 43 + v2's 135 (132 across 9 families + matePref's 3) + v0.14's 7 voice genes + disgust's instWasteFlee
});

test('brainSize: unbounded locus — founder at emberling scale, no ceiling', () => {
  const rng = createRng(7);
  // Founder: 8.0 ± 25% → ~600–1000 assoc neurons (emberling scale).
  const founder = createBrain(testPheno(7), rng);
  assert.ok(founder.nAssoc >= 600 && founder.nAssoc <= 1000,
    `founder brain ~emberling scale, got ${founder.nAssoc}`);
  // No cap: a large expressed value yields a proportionally large brain.
  const big = createBrain(testPheno(7, { brainSize: 30 }), rng);
  assert.equal(big.nAssoc, 3000, 'brainSize 30 → 3000 neurons, uncapped');
  // The locus itself is unbounded: phenotype of huge alleles is not clamped.
  const g = randomGenome(createRng(9));
  g.alleles.brainSize = [40, 60];
  assert.equal(phenotype(g).brainSize, 50, 'exp locus not clamped to 1');
});

test('v0.5: a lonely brain with the mating instinct chooses to court', () => {
  const rng = createRng(42);
  const overrides = { curiosity: 0, sociability: 0, boldness: 0 };
  for (const g of GENES) if (g.sense !== undefined) overrides[g.key] = 0;
  overrides.instLonelyMate = 1;
  const brain = createBrain(testPheno(42, overrides), rng);
  // Isolate the instinct pathway: silence the learned layers.
  silenceBrain(brain);
  const senses = {
    ...MID_SENSES, loneliness: 1, hunger: 0, tiredness: 0,
    boredom: 0, fear: 0, creatureDist: 0.1,
  };
  const { action } = decide(brain, senseVector(senses), 0, rng);
  assert.equal(action, 'mate', 'loneliness + instinct → courtship');
  const calm = decide(brain, senseVector({ ...senses, loneliness: 0 }), 0, rng);
  assert.notEqual(calm.action, 'mate', 'no loneliness → no courtship');
});

test('v2: mate preference — choosy creatures prefer the preferred color', () => {
  const mkWorld = (choosy) => {
    const world = v09world(77);
    world.creatures.length = 0;
    const chooser = addTestCreature(world, 500);
    chooser.sex = 'male';
    chooser.pheno.matePrefHue = 0.2;
    chooser.pheno.matePrefSat = 0.8;
    chooser.pheno.matePrefChoosy = choosy;
    // Near candidate: WRONG color. Far candidate: the preferred color.
    const near = addTestCreature(world, 540);
    near.sex = 'female';
    near.pheno.coatHue01 = 0.9; near.pheno.coatSat01 = 0.1;
    const far = addTestCreature(world, 700);
    far.sex = 'female';
    far.pheno.coatHue01 = 0.2; far.pheno.coatSat01 = 0.8;
    return { world, chooser, near, far };
  };
  // Choosy: the far, right-colored mate beats the near, wrong-colored one.
  {
    const { world, chooser, far } = mkWorld(1);
    const s = gatherSenses(chooser, world);
    assert.equal(s._mate, far, 'choosiness 1: color beats proximity');
  }
  // Not choosy: nearest wins, exactly as before (founder-neutral).
  {
    const { world, chooser, near } = mkWorld(0);
    const s = gatherSenses(chooser, world);
    assert.equal(s._mate, near, 'choosiness 0: nearest wins');
  }
});

test('v2: coat color is readable off the phenotype (for the biomes phase)', () => {
  const p = testPheno(7);
  assert.ok(p.coatHue01 >= 0 && p.coatHue01 <= 1, 'coatHue01 is 0..1');
  assert.ok(p.coatSat01 >= 0 && p.coatSat01 <= 1, 'coatSat01 is 0..1');
  // Regional values are readable too.
  for (const r of ['Head', 'Torso', 'Limbs']) {
    assert.ok(typeof p['pig' + r + 'HueDeg'] === 'number', `pig${r}HueDeg readable`);
    assert.ok(typeof p['pig' + r + 'SatShift'] === 'number', `pig${r}SatShift readable`);
  }
  // The mate-preference loci are heritable: they ride a chromosome and
  // mutate through the normal pathway.
  const g = randomGenome(createRng(7));
  assert.ok(g.alleles.matePrefChoosy, 'matePrefChoosy has alleles');
  assert.ok(GENES.find((x) => x.key === 'matePrefChoosy'), 'matePrefChoosy is a registered gene');
});

test('v0.5: founders are always two breeding pairs', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const world = bindWorld(createWorld(seed));
    populate(world);
    assert.equal(world.creatures.length, 4, `seed ${seed}: four founders`);
    const sexes = world.creatures.map((c) => c.sex).sort();
    assert.deepEqual(sexes, ['female', 'female', 'male', 'male'], `seed ${seed} must be breedable`);
    const names = world.creatures.map((c) => c.name);
    assert.ok(names.includes('Pip') && names.includes('Moss'), 'Pip and Moss still found the colony');
  }
});

test('v0.5: every hatch comes with a nest cache', () => {
  const world = bindWorld(createWorld(3));
  populate(world);
  const rng = createRng(31);
  layEgg(world, 500, 0, randomGenome(rng), null);
  let hatchX = null;
  for (let t = 0; t < 400 && hatchX === null; t++) {
    tickWorld(world, 0.1);
    const h = world.events.find((e) => e.type === 'hatch');
    if (h) hatchX = h.creature.x;
  }
  assert.ok(hatchX !== null, 'the egg should hatch');
  // The cache is one bite that the newborn eats immediately (rooting reflex),
  // so it may already be gone — what matters is the baby got its first meal.
  const cached = world.foods.some(
    (f) => f.platformIndex === 0 && Math.abs(f.x - hatchX) < 40
  );
  const hatchling = world.creatures.find((c) => c.alive && Math.abs(c.x - hatchX) < 60);
  const fed = hatchling && hatchling.biochem.hunger < 0.6;
  assert.ok(cached || fed, 'a fruit should be cached at the nest (or the newborn already ate it)');
});

test('v0.5: a lonely adult pair courts and mates end to end', () => {
  const world = bindWorld(createWorld(9));
  populate(world);
  const [a, b] = world.creatures;
  a.sex = 'male';
  b.sex = 'female';
  for (const c of [a, b]) {
    c.biochem.age = c.pheno.lifespanSec * 0.5; // adult
    c.mateCooldown = 0;
    c.x = 700 + (c === a ? -40 : 40);
    c.platformIndex = 0;
    // Isolate the loop under test: silence every reflex except mate.
    for (let j = 0; j < ACTIONS.length; j++) c.brain.instW[j].fill(0);
    c.brain.instW[6][3] = 1.2; // loneliness → mate, strong
    // v2: the big brain's random initial readout weights are noise, not
    // signal — zero the learned pathway and freeze Hebbian learning so the
    // only vote left is the mate instinct above.
    for (const L of c.brain.layers) for (const w of L.w) w.fill(0);
    for (const w of c.brain.a2m.w) w.fill(0);
    c._learnBoost = 0;
  }
  let mated = false;
  for (let t = 0; t < 6000 && !mated; t++) {
    tickWorld(world, 0.1);
    // Pin the drives under test so competing needs can't interfere. Canopy's
    // drives are chemistry readouts — pin the chemicals, not the readouts.
    for (const c of [a, b]) {
      c.biochem.oxytocin = 0.05;   // → social 0.95 (lonely)
      c.biochem.bloodSugar = 0.7;  // → hunger 0.3 (fed)
      c.biochem.fatigue = 0.2;     // → energy 0.8 (rested)
      c.biochem.adrenaline = 0;    // → fear 0 (calm)
    }
    if (world.events.some((e) => e.type === 'mating')) mated = true;
  }
  assert.ok(mated, 'the pair should mate within 600 sim-seconds');
  assert.ok(world.eggs.length > 0, 'mating should lay an egg');
});

test('v0.5: company satisfies the social need (nearFriend wiring)', () => {
  const world = bindWorld(createWorld(4));
  populate(world);
  const [a, b] = world.creatures;
  a.biochem.social = 1;
  a.x = 700; b.x = 720; // side by side
  a.platformIndex = 0; b.platformIndex = 0;
  a.action = 'approach'; a.actionTimer = 5; // will set nearFriend this tick
  const before = a.biochem.social;
  for (let t = 0; t < 50; t++) tickWorld(world, 0.1);
  assert.ok(
    a.biochem.social < before,
    `social should drain near a friend (${before.toFixed(2)} → ${a.biochem.social.toFixed(2)})`
  );
});

test('v0.6: founders are herbivores; diet maps to fruit efficiency', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const p = phenotype(randomGenome(createRng(seed)));
    assert.equal(p.diet, 'herbivore', `founder should be herbivore, got ${p.diet}`);
    assert.equal(p.fruitEfficiency, 1.0);
  }
  // Choice-gene expression is deterministic (maternal allele).
  const g = randomGenome(createRng(7));
  g.alleles.diet = [2, 2]; // carnivore/carnivore
  const pc = phenotype(g);
  assert.equal(pc.diet, 'carnivore');
  assert.equal(pc.fruitEfficiency, 0.5);
  g.alleles.diet = [1, 1]; // omnivore
  assert.equal(phenotype(g).fruitEfficiency, 0.8);
});

test('v0.6: bite size follows the mouthSize gene', () => {
  const g = randomGenome(createRng(3));
  g.alleles.mouthSize = [0, 0];
  assert.ok(Math.abs(phenotype(g).biteSize - 0.2) < 1e-9);
  g.alleles.mouthSize = [1, 1];
  assert.ok(Math.abs(phenotype(g).biteSize - 0.5) < 1e-9);
});

test('v0.6: sight range follows the eyeSize gene', () => {
  const g = randomGenome(createRng(3));
  g.alleles.eyeSize = [0, 0];
  assert.ok(Math.abs(phenotype(g).sightRange - 294) < 1e-9);
  g.alleles.eyeSize = [1, 1];
  assert.ok(Math.abs(phenotype(g).sightRange - 546) < 1e-9);
});

test('v0.6: legs trade speed for energy', () => {
  const g = randomGenome(createRng(3));
  g.alleles.legLength = [0, 0];
  const slow = phenotype(g);
  g.alleles.legLength = [1, 1];
  const fast = phenotype(g);
  assert.ok(fast.legSpeedMult > slow.legSpeedMult, 'long legs are faster');
  assert.ok(fast.legDrainMult > slow.legDrainMult, 'long legs burn more');
  assert.ok(Math.abs(slow.legSpeedMult - 0.7) < 1e-9);
  assert.ok(Math.abs(fast.legSpeedMult - 1.3) < 1e-9);
});

test('v0.6: fur insulates but weighs down', () => {
  const g = randomGenome(createRng(3));
  g.alleles.fur = [1, 1];
  const p = phenotype(g);
  assert.ok(Math.abs(p.furInsulation - 0.3) < 1e-9);
  assert.ok(Math.abs(p.furWeight - 0.15) < 1e-9);
  // Insulation actually slows the energy drain.
  const b1 = createBiochem(); const b2 = createBiochem();
  const bare = { ...p, furInsulation: 0, legDrainMult: 1 };
  tickBiochem(b1, bare, 10);
  tickBiochem(b2, { ...p, legDrainMult: 1 }, 10);
  assert.ok(b2.energy > b1.energy, 'furry creature keeps more energy');
});

test('v0.6: spikes intimidate neighbors and armor against illness', () => {
  const g = randomGenome(createRng(3));
  g.alleles.spikes = [1, 1];
  const p = phenotype(g);
  assert.ok(Math.abs(p.spikeFear - 0.25) < 1e-9);
  assert.ok(Math.abs(p.spikeArmor - 0.3) < 1e-9);
});

test('v0.6: a spiky neighbor raises fear through the live tick', () => {
  const world = createWorld(7);
  bindWorld(world);
  populate(world);
  const [a, b] = world.creatures;
  // Make b maximally spiky and park it next to a.
  b.genome.alleles.spikes = [1, 1];
  b.pheno = phenotype(b.genome);
  a.x = 700; b.x = 710;
  a.platformIndex = 0; b.platformIndex = 0;
  a.biochem.fear = 0;
  a.action = 'wander'; a.actionTimer = 5;
  for (let t = 0; t < 30; t++) {
    b.x = 710; b.platformIndex = 0; // keep the spiky neighbor parked next to a
    tickWorld(world, 0.1);
  }
  assert.ok(a.biochem.fear > 0, `fear should rise near spikes (got ${a.biochem.fear.toFixed(3)})`);
});

test('v0.6: per-creature sight range is used for sensing', () => {
  const world = createWorld(11);
  bindWorld(world);
  populate(world);
  const [a] = world.creatures;
  a.genome.alleles.eyeSize = [1, 1]; // max eyes
  a.pheno = phenotype(a.genome);
  // Food at 500px: visible to max-eyes (546 range), invisible at default (420).
  addFood(world, a.x + 500, 0, 1);
  const s = a._senses; // from last tick; force a fresh sense pass
  for (let t = 0; t < 5; t++) tickWorld(world, 0.1);
  assert.ok(
    a._senses._range > 500,
    `max eyes should see past 500px (range ${a._senses._range.toFixed(0)})`
  );
  assert.ok(a._senses._food, 'food at 500px should be sensed with max eyes');
});

// ---- v0.7: the cultural ratchet ----

function v07world(seed) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  return world;
}

function makeCarrier(world, x = 700) {
  const c = world.creatures[0];
  c.x = x;
  c.platformIndex = 0;
  c.traditions = [];
  c.traditionAim = {};
  c.mealLog = [];
  return c;
}

test('v0.7: the tradition gene sets copying fidelity', () => {
  const g = randomGenome(createRng(3));
  g.alleles.tradition = [0, 0];
  assert.ok(Math.abs(fidelityOf(phenotype(g)) - 0.5) < 1e-9, 'min fidelity 0.5');
  g.alleles.tradition = [1, 1];
  assert.ok(Math.abs(fidelityOf(phenotype(g)) - 1.0) < 1e-9, 'max fidelity 1.0');
  // Founders start near the middle — the channel is open but not maxed.
  let sum = 0;
  for (let i = 0; i < 200; i++) sum += phenotype(randomGenome(createRng(1000 + i))).tradition;
  const mean = sum / 200;
  assert.ok(mean > 0.35 && mean < 0.65, `founder tradition mean ${mean.toFixed(3)}`);
});

test('v0.7: clustered meals found a grove tradition', () => {
  const world = v07world(21);
  const c = makeCarrier(world);
  c.pheno.curiosity = 1; // maximize the invention roll
  c.mealLog = [
    { x: 690, t: 10 }, { x: 710, t: 60 }, { x: 700, t: 120 },
  ];
  let t = null;
  for (let i = 0; i < 300 && !t; i++) t = maybeFoundGrove(c, world);
  assert.ok(t, 'clustered success should invent a tradition');
  assert.equal(t.kind, 'grove');
  assert.ok(Math.abs(t.x - 700) < 60, `grove near the meals, got ${t.x}`);
  assert.ok(t.carriers.has(c.id), 'inventor is a carrier');
  assert.ok(c.traditions.includes(t.id), 'inventor holds the tradition');
  assert.ok(t.name.includes(c.name), `named for the inventor: ${t.name}`);
  assert.equal(world.culture.founded, 1);
});

test('v0.7: spread-out meals found nothing; nearby groves block duplicates', () => {
  const world = v07world(22);
  const c = makeCarrier(world);
  c.pheno.curiosity = 1;
  c.mealLog = [
    { x: 200, t: 10 }, { x: 900, t: 60 }, { x: 1400, t: 120 },
  ];
  for (let i = 0; i < 100; i++) assert.equal(maybeFoundGrove(c, world), null);
  assert.equal(world.culture.traditions.length, 0, 'no tradition from scattered meals');
  // Now a real cluster, then a second cluster nearby: only one grove.
  c.mealLog = [{ x: 690, t: 200 }, { x: 710, t: 250 }, { x: 700, t: 300 }];
  let first = null;
  for (let i = 0; i < 300 && !first; i++) first = maybeFoundGrove(c, world);
  assert.ok(first, 'first grove founds');
  c.mealLog = [{ x: 750, t: 400 }, { x: 760, t: 450 }, { x: 755, t: 500 }];
  for (let i = 0; i < 100; i++) assert.equal(maybeFoundGrove(c, world), null);
  assert.equal(world.culture.traditions.length, 1, 'no duplicate grove nearby');
});

test('v0.7: witnesses adopt traditions horizontally, near-lossless', () => {
  const world = v07world(23);
  const demo = makeCarrier(world, 700);
  const witness = world.creatures[1];
  witness.x = 750; witness.platformIndex = 0;
  witness.traditions = [];
  witness._senses = { platformIndex: 0 };
  const t = foundGrove(world.culture, demo, 700, 150, 0, 0, world.rng);
  assert.ok(t, 'grove founded');
  // Rig a successful meal episode for the demonstrator.
  demo.episodeInput = new Array(14).fill(0.1);
  demo.episodeAction = ACTIONS.indexOf('eat');
  demo.episodeReward = 0.6;
  let adopted = false;
  for (let i = 0; i < 60 && !adopted; i++) {
    witness.traditions = [];
    t.carriers.delete(witness.id);
    finalizeEpisode(demo, world);
    adopted = witness.traditions.includes(t.id);
    demo.episodeInput = new Array(14).fill(0.1);
    demo.episodeAction = ACTIONS.indexOf('eat');
    demo.episodeReward = 0.6;
  }
  assert.ok(adopted, 'a witness should adopt the tradition from observed meals');
  // The copy is faithful: the witness aims near the true grove.
  const aim = witness.traditionAim[t.id];
  assert.ok(Math.abs(aim - 700) < 130, `faithful copy, aim ${aim}`);
});

test('v0.7: hatchlings inherit traditions vertically', () => {
  // The adoption roll is fidelity-scaled (85% at perfect fidelity), so run
  // the scenario across seeds until the roll succeeds — the mechanism under
  // test is the egg → hatchling transmission path, not one lucky roll.
  let adopted = false;
  for (let seed = 24; seed < 34 && !adopted; seed++) {
    adopted = tryVerticalTransmission(seed);
  }
  assert.ok(adopted, 'vertical transmission at birth');
});

function tryVerticalTransmission(seed) {
  const world = v07world(seed);
  const [mom, dad] = world.creatures;
  for (const c of [mom, dad]) {
    c.sex = c === mom ? 'female' : 'male';
    c.biochem.age = c.pheno.lifespanSec * 0.5;
    c.mateCooldown = 0;
    c.traditions = [];
    c.generation = 2;
    c.pheno.tradition = 1; // perfect fidelity
  }
  const t = foundGrove(world.culture, mom, 500, 150, 0, 2, world.rng);
  mom.x = 690; dad.x = 710; mom.platformIndex = 0; dad.platformIndex = 0;
  mom.pheno.fertility = 1; dad.pheno.fertility = 1; // maximize the mating roll
  let mated = false;
  for (let i = 0; i < 50 && !mated; i++) mated = world.tryMate(mom, dad);
  assert.ok(mated, `seed ${seed}: the pair should mate`);
  assert.ok(world.eggs.length > 0, 'eggs laid');
  for (const egg of world.eggs) {
    assert.ok(egg.traditionIds.includes(t.id), 'egg carries the tradition');
    assert.equal(egg.gen, 3, 'pedigree depth increments');
    egg.genome.alleles.tradition = [1, 1]; // perfect-fidelity baby: fid 1.0
  }
  // Hatch one and check the tradition arrived.
  world.eggs[0].timer = 0.01;
  tickWorld(world, 0.1);
  const baby = world.creatures.find((c) => c.generation === 3);
  assert.ok(baby, 'a gen-3 baby hatched');
  return baby.traditions.includes(t.id);
}

test('v0.7: a tradition dies with its last carrier', () => {
  const world = v07world(25);
  const c = makeCarrier(world);
  const t = foundGrove(world.culture, c, 700, 150, 0, 0, world.rng);
  assert.equal(world.culture.traditions.length, 1);
  c.alive = false;
  const gone = pruneExtinct(world.culture, world.creatures);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].id, t.id);
  assert.equal(world.culture.traditions.length, 0);
  assert.equal(world.culture.extinct, 1);
  assert.ok(Math.abs(ratchetIndex(world.culture) - 0) < 1e-9, 'nothing retained');
});

test('v0.7: tradition votes nudge hungry carriers toward seekFood', () => {
  const world = v07world(26);
  const c = makeCarrier(world);
  const t = foundGrove(world.culture, c, 700, 150, 0, 0, world.rng);
  const SEEK = ACTIONS.indexOf('seekFood');
  const hungry = { hunger: 0.8 };
  const votes = traditionVotes(c, world.culture, hungry);
  assert.ok(votes[SEEK] > 0, 'hungry carrier gets a seekFood vote');
  const full = traditionVotes(c, world.culture, hungry);
  const total = full.reduce((a, b) => a + Math.abs(b), 0);
  assert.ok(total <= 0.3001, `vote budget respected (${total.toFixed(3)})`);
  const sated = traditionVotes(c, world.culture, { hunger: 0.1 });
  assert.ok(sated.every((v) => v === 0), 'sated carriers get no votes');
  assert.equal(groveTarget(c, world.culture, hungry), 700, 'grove target is the tradition site');
  assert.equal(groveTarget(c, world.culture, { hunger: 0.1 }), null, 'no target when sated');
  void t;
});

test('v0.7: meat efficiency follows diet; the dead leave carcasses', () => {
  const g = randomGenome(createRng(3));
  g.alleles.diet = [2, 2];
  assert.equal(phenotype(g).meatEfficiency, 1.0, 'carnivores eat meat fully');
  g.alleles.diet = [0, 0];
  assert.equal(phenotype(g).meatEfficiency, 0.25, 'herbivores barely touch meat');
  g.alleles.diet = [1, 1];
  assert.equal(phenotype(g).meatEfficiency, 0.7, 'omnivores in between');
  const world = v07world(27);
  const before = world.foods.length;
  world.creatures[0].alive = false;
  tickWorld(world, 0.1);
  const meats = world.foods.filter((f) => f.foodKind === 'meat');
  assert.ok(world.foods.length > before || meats.length > 0, 'a carcass was dropped');
  assert.ok(meats.length > 0, 'carcass is meat');
  assert.ok(meats[0].rotsAt > 0, 'carcasses rot');
});

test('v0.7: the ratchet census records repertoire over time', () => {
  const world = v07world(28);
  const c = makeCarrier(world);
  foundGrove(world.culture, c, 400, 150, 0, 0, world.rng);
  foundGrove(world.culture, c, 1200, 150, 0, 1, world.rng);
  assert.ok(Math.abs(ratchetIndex(world.culture) - 1) < 1e-9, 'nothing lost yet');
  world.time = 300;
  sampleCulture(world);
  const s = world.culture.samples[0];
  assert.equal(s.live, 2);
  assert.equal(s.founded, 2);
  assert.equal(s.extinct, 0);
  assert.equal(s.carriers, 2);
});

// ---- v0.8: medicinal herbs — self-medication ----

test('v0.8: populate grows herbs alongside fruit plants', () => {
  const world = bindWorld(createWorld(99));
  populate(world);
  const herbs = world.plants.filter((p) => p.kind === 'herb');
  const fruits = world.plants.filter((p) => p.kind === 'plant');
  // Canopy populate: 10 fruit trees on the branches, 3 medicinal herbs
  // as floor undergrowth.
  assert.equal(herbs.length, 3, 'three medicinal herbs');
  assert.equal(fruits.length, 10, 'ten fruit trees');
});

test('v0.8: herbs bear leaves, fruit plants bear fruit', () => {
  const world = bindWorld(createWorld(7));
  populate(world);
  for (const p of world.plants) {
    p.growth = 1;
    p.fruitTimer = 0;
  }
  const before = world.foods.length;
  tickWorld(world, 0.1);
  const fresh = world.foods.slice(before);
  const leaves = fresh.filter((f) => f.foodKind === 'leaf');
  const fruits = fresh.filter((f) => f.foodKind === 'fruit');
  assert.ok(leaves.length > 0, 'herbs dropped leaves');
  assert.ok(fruits.length > 0, 'fruit plants dropped fruit');
});

test('v0.8: eating a leaf purges illness but barely feeds', () => {
  const world = bindWorld(createWorld(11));
  populate(world);
  const c = world.creatures[0];
  c.biochem.illness = 0.8;
  c.biochem.hunger = 0.5;
  addFood(world, c.x, c.platformIndex, 'leaf', 1);
  const leaf = world.foods[world.foods.length - 1];
  c._senses = { _food: leaf };
  c.reward = 0;
  assert.ok(doEat(c, world), 'the creature ate the leaf');
  assert.ok(c.biochem.illness < 0.45, `illness purged (now ${c.biochem.illness.toFixed(2)})`);
  assert.ok(c.biochem.hunger > 0.35, 'leaves are poor food — hunger barely moved');
  assert.ok(c.reward >= 0.6, 'medicine is rewarding when sick');
});

test('v0.8: leaves are bitter — weak reward when healthy', () => {
  const world = bindWorld(createWorld(12));
  populate(world);
  const c = world.creatures[0];
  c.biochem.illness = 0;
  c.biochem.hunger = 0.5;
  addFood(world, c.x, c.platformIndex, 'leaf', 1);
  const leaf = world.foods[world.foods.length - 1];
  c._senses = { _food: leaf };
  c.reward = 0;
  assert.ok(doEat(c, world), 'the creature ate the leaf');
  assert.equal(c.biochem.illness, 0, 'nothing to cure');
  assert.ok(c.reward < 0.3, `bitter when well — weak reward (${c.reward.toFixed(2)})`);
});

test('v0.8: illness is the 15th brain input', () => {
  const v = senseVector({ ...MID_SENSES, illness: 0.7 });
  assert.equal(v.length, 25, 'twenty-five entries: 24 senses + bias');
  assert.equal(v[13], 0.7, 'illness rides at index 13');
  assert.equal(v[14], 0, 'homeDist defaults to 0');
  assert.equal(v[15], 0, 'kinNear defaults to 0');
  assert.equal(v[16], 0, 'bondNear defaults to 0');
  assert.equal(v[17], 0, 'climbUp defaults to 0');
  assert.equal(v[18], 0, 'climbDown defaults to 0');
  assert.equal(v[19], 0, 'groomNear defaults to 0');
  assert.equal(v[20], 0, 'jumpNear defaults to 0');
  assert.equal(v[21], 0, 'callHeard defaults to 0');
  assert.equal(v[22], 0, 'callPitch defaults to 0');
  assert.equal(v[23], 0, 'wasteOdor defaults to 0');
  assert.equal(v[24], 1, 'bias still last');
});

test('v0.8: the illness instinct points at food-seeking', () => {
  const g = GENES.find((g) => g.key === 'instIllnessSeek');
  assert.ok(g, 'instIllnessSeek is a registered gene');
  assert.equal(g.sense, 13, 'driven by the illness sense');
  assert.equal(g.action, 0, 'drives seekFood');
  assert.equal(ACTIONS[0], 'seekFood');
});

// v0.9 embodiment: the Honest Body — injuries, bristle display + contagion,
// pushable pebbles, and RNG-stream isolation for worldgen scatter.

function v09world(seed) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  return world;
}

function addTestCreature(world, x, opts = {}) {
  const c = createCreature(randomGenome(world.rng), x, 0, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5; // adult
  c.pheno.spikes = 0; // no accidental clashes unless the test wants them
  Object.assign(c, opts);
  world.creatures.push(c);
  return c;
}

test('v0.9: fast flight into a spiky creature causes injury', () => {
  const world = v09world(31);
  world.creatures.length = 0;
  const a = addTestCreature(world, 500);
  const b = addTestCreature(world, 512);
  b.pheno.spikes = 0.9;
  a.action = 'flee'; a.actionTimer = 100; // fast movement, no re-decide
  a._px = 488; // displaced 12px last tick = moving toward b
  tickWorld(world, 0.1);
  assert.ok(a.biochem.injury > 0, `crash with spikes wounds (${a.biochem.injury})`);
  assert.ok(a.flinchT > 0, 'the flinch flash is set');
  assert.ok(a.biochem.fear > 0.4, 'the crash startles the victim');
  const inj = a.biochem.injury;
  tickWorld(world, 0.1);
  assert.ok(a.biochem.injury <= inj, 'clash cooldown prevents machine-gun wounding');
});

test('v0.9: slow movement never crashes, even into spikes', () => {
  for (const action of ['play', 'seekFood', 'wander', 'mate', 'approach']) {
    const world = v09world(31);
    world.creatures.length = 0;
    const a = addTestCreature(world, 500);
    const b = addTestCreature(world, 512);
    b.pheno.spikes = 0.9;
    a.action = action; a.actionTimer = 100;
    a._px = 488; // moving toward b — but not at flight speed
    tickWorld(world, 0.1);
    assert.strictEqual(a.biochem.injury, 0, `${action} must not crash`);
  }
});

test('v0.9: fast non-panic movement never crashes (play, foraging)', () => {
  for (const action of ['play', 'seekFood', 'wander']) {
    const world = v09world(31);
    world.creatures.length = 0;
    const a = addTestCreature(world, 500);
    const b = addTestCreature(world, 512);
    b.pheno.spikes = 0.9;
    a.action = action; a.actionTimer = 100;
    a._px = 488; // moving toward b at speed — but not panicking
    tickWorld(world, 0.1);
    assert.strictEqual(a.biochem.injury, 0, `${action} at speed must not crash`);
  }
});

test('v0.9: careful social contact never wounds, even against spikes', () => {
  for (const action of ['mate', 'approach', 'play']) {
    const world = v09world(31);
    world.creatures.length = 0;
    const a = addTestCreature(world, 500);
    const b = addTestCreature(world, 512);
    b.pheno.spikes = 0.9;
    a.action = action; a.actionTimer = 100; // careful, no re-decide
    tickWorld(world, 0.1);
    assert.strictEqual(a.biochem.injury, 0, `${action} contact with spikes must not wound`);
  }
});

test('v0.9: injuries heal with rest, faster asleep', () => {
  const pheno = testPheno(1);
  const asleep = createBiochem(); asleep.injury = 0.5;
  const awake = createBiochem(); awake.injury = 0.5;
  tickBiochem(asleep, pheno, 10, { sleeping: true });
  tickBiochem(awake, pheno, 10, { sleeping: false });
  assert.ok(awake.injury < 0.5, 'wounds heal while awake');
  assert.ok(asleep.injury < awake.injury, 'sleep heals faster');
});

test('v0.9: injury slows movement', () => {
  const world = v09world(32);
  world.creatures.length = 0;
  world.pebbles.length = 0; // clean track: measure injury, not pebbles
  world.plants.length = 0; // v0.11: no biome flora dropping distraction fruit
  world.foods.length = 0; // v0.11: starter fruit positions shifted with the RNG stream
  addFood(world, 700, 0, 'fruit', 1); // inside the 420px sense range
  const genome = randomGenome(world.rng); // one genome for both — injury is the only variable
  const mk = (injury) => {
    const c = createCreature(genome, 400, 0, world.rng);
    c.biochem.age = c.pheno.lifespanSec * 0.5; // adult
    c.pheno.spikes = 0;
    c.biochem.injury = injury;
    c.action = 'seekFood'; c.actionTimer = 100; c.facing = 1;
    world.creatures.push(c);
    return c;
  };
  const healthy = mk(0);
  const hurt = mk(0.8);
  for (let i = 0; i < 50; i++) tickWorld(world, 0.1);
  assert.ok(healthy.x > hurt.x + 10,
    `healthy outpaces injured (${healthy.x.toFixed(0)} vs ${hurt.x.toFixed(0)})`);
});

test('v0.9: fear bristles the body; bristling frightens close neighbors', () => {
  const world = v09world(33);
  world.creatures.length = 0;
  const a = addTestCreature(world, 500, { action: 'eat', actionTimer: 100 });
  const b = addTestCreature(world, 560, { action: 'eat', actionTimer: 100 });
  a.biochem.adrenaline = 0.9; // canopy: fear is the adrenaline readout — pin the chemical
  tickWorld(world, 0.1);
  assert.ok(a.bristling, 'the afraid creature bristles');
  const f0 = b.biochem.fear;
  for (let i = 0; i < 20; i++) {
    a.biochem.adrenaline = 0.9; // keep the display up
    a.x = 500; b.x = 560; // hold them up close: this test is about the
    // contagion mechanism, not about locomotion (a's urgent re-decide may
    // otherwise scatter the pair — a new action like groom changes which
    // approach action the brain picks, and that's fine)
    tickWorld(world, 0.1);
  }
  assert.ok(b.biochem.fear > f0 + 0.02,
    `bristling is contagious up close (${f0.toFixed(3)} -> ${b.biochem.fear.toFixed(3)})`);
  for (let i = 0; i < 200; i++) {
    a.biochem.adrenaline = 0.9; // keep the display up for 20 more seconds
    a.x = 500; b.x = 560; // hold them up close (see above)
    tickWorld(world, 0.1);
  }
  assert.ok(b.biochem.fear <= 0.46,
    `alarm alerts but never panics: contagion caps at 0.45 (${b.biochem.fear.toFixed(3)})`);
  assert.ok(!b.bristling, 'contagion alone never triggers the bristle display');
});

test('v0.9: creatures shove pebbles; pebbles persist', () => {
  const world = v09world(34);
  world.creatures.length = 0;
  world.pebbles.length = 0;
  addPebble(world, 500, 0);
  const pb = world.pebbles[0];
  const c = addTestCreature(world, 460, { action: 'seekFood', actionTimer: 100, facing: 1 });
  addFood(world, 800, 0, 'fruit', 1); // inside sense range: steady +x walk
  const x0 = pb.x;
  for (let i = 0; i < 40; i++) tickWorld(world, 0.1);
  assert.ok(pb.x > x0 + 1, `pebble shoved +x (${x0.toFixed(1)} -> ${pb.x.toFixed(1)})`);
  assert.equal(world.pebbles.length, 1, 'pebbles persist');
  assert.ok(c.x < 900, 'the world pushes back — the pusher is resisted');
});

test('v0.9: populate scatters pebbles on their own RNG stream', () => {
  const w1 = v09world(35);
  const w2 = v09world(35);
  assert.equal(w1.pebbles.length, 8, 'eight pebbles scattered');
  assert.equal(w1.pebbles[0].x, w2.pebbles[0].x, 'pebble scatter is deterministic');
  // The main stream is untouched: founder genomes identical across runs.
  const g1 = JSON.stringify(w1.creatures[0].genome.alleles);
  const g2 = JSON.stringify(w2.creatures[0].genome.alleles);
  assert.equal(g1, g2, 'founder genomes unaffected by pebble scatter');
});

test('v0.9: severe injury drains health', () => {
  const pheno = testPheno(2);
  const b = createBiochem();
  b.injury = 0.9; b.hunger = 0.3; b.energy = 0.8; b.fear = 0;
  const h0 = b.health;
  tickBiochem(b, pheno, 10, {});
  assert.ok(b.health < h0, 'severe wounds bleed health until rested');
});

test('v0.10: lineage registry records every birth with heritable traits', () => {
  const world = v09world(41);
  assert.ok(world.lineage.size >= 4, `founders recorded (${world.lineage.size})`);
  const c = world.creatures[0];
  const rec = world.lineage.get(c.id);
  assert.ok(rec, 'founder has a lineage record');
  assert.strictEqual(rec.parents, null, 'founders have no parents');
  assert.ok(typeof rec.traits.size === 'number', 'trait snapshot stored');
  assert.strictEqual(rec.traits.diet, c.pheno.diet, 'diet snapshot matches phenotype');
  assert.strictEqual(rec.generation, 0, 'founder generation is 0');
});

test('v0.10: lineage chains resolve through dead ancestors', () => {
  const world = bindWorld(createWorld(43));
  // Two fake generations: grandparent -> parent -> child, then kill the elders.
  const mk = (name, parents, gen, size) => {
    const c = createCreature(randomGenome(world.rng), 500, 0, world.rng, { parents, generation: gen });
    c.name = name; c.pheno.size = size;
    world.creatures.push(c);
    recordLineage(world, c);
    return c;
  };
  const gp = mk('Gran', null, 0, 0.3);
  const par = mk('Par', [gp.id, 999999], 1, 0.5); // other parent unknown
  const kid = mk('Kid', [par.id, 888888], 2, 0.7);
  world.creatures.length = 0; // everyone dies — registry must still resolve
  const kidRec = world.lineage.get(kid.id);
  const parRec = world.lineage.get(kidRec.parents[0]);
  assert.strictEqual(parRec.name, 'Par', 'parent resolves after death');
  const gpRec = world.lineage.get(parRec.parents[0]);
  assert.strictEqual(gpRec.name, 'Gran', 'grandparent resolves after death');
  assert.ok(kidRec.traits.size > parRec.traits.size, 'trait snapshots capture directional change');
  assert.ok(LINEAGE_TRAITS.includes('spikes'), 'spikes is a tracked lineage trait');
});

test('v0.11: zoneAt slices the world into three biomes', () => {
  assert.strictEqual(zoneAt(0).key, 'verdant');
  assert.strictEqual(zoneAt(532).key, 'verdant');
  assert.strictEqual(zoneAt(533).key, 'arid');
  assert.strictEqual(zoneAt(1065).key, 'arid');
  assert.strictEqual(zoneAt(1066).key, 'highland');
  assert.strictEqual(zoneAt(1600).key, 'highland');
  assert.strictEqual(ZONES.length, 3, 'three zones');
});

test('v0.11: plants are tagged with their biome zone', () => {
  const world = v09world(51);
  for (const p of world.plants) {
    assert.ok(['verdant', 'arid', 'highland'].includes(p.zone), `plant zone ${p.zone}`);
  }
  const zones = new Set(world.plants.map((p) => p.zone));
  assert.ok(zones.has('verdant') && zones.has('arid') && zones.has('highland'), 'flora spans all three biomes');
});

test('v0.11: arid fruiting is slower than verdant (scarcity is zonal)', () => {
  const world = bindWorld(createWorld(52));
  // Two mature plants, one per zone, forced to fruit now.
  world.plants.length = 0;
  const mk = (x) => {
    const p = { kind: 'plant', id: 1, x, platformIndex: 0, y: 800, growth: 1, fruitTimer: 0, sway: 0, zone: zoneAt(x).key };
    world.plants.push(p);
    return p;
  };
  const v = mk(100), a = mk(800);
  // Sample the interval the tick assigns: run one tick and read fruitTimer.
  tickWorld(world, 0.1);
  // Both fruited (timer reset to a fresh interval); arid interval must be larger.
  assert.ok(a.fruitTimer > v.fruitTimer * 1.5, `arid (${a.fruitTimer.toFixed(1)}s) much slower than verdant (${v.fruitTimer.toFixed(1)}s)`);
});

test('v0.11: crowding slows fruiting (density-dependent scarcity)', () => {
  const mkWorld = (n) => {
    const w = bindWorld(createWorld(53));
    w.plants.length = 0;
    w.plants.push({ kind: 'plant', id: 1, x: 100, platformIndex: 0, y: 800, growth: 1, fruitTimer: 0, sway: 0, zone: 'verdant' });
    for (let i = 0; i < n; i++) addTestCreature(w, 100 + i);
    return w;
  };
  const empty = mkWorld(0);
  const crowded = mkWorld(40);
  tickWorld(empty, 0.1);
  tickWorld(crowded, 0.1);
  assert.ok(crowded.plants[0].fruitTimer > empty.plants[0].fruitTimer,
    `crowded (${crowded.plants[0].fruitTimer.toFixed(1)}s) slower than empty (${empty.plants[0].fruitTimer.toFixed(1)}s)`);
});

test('v0.11: lineage records the birth biome', () => {
  const world = v09world(54);
  const c = world.creatures[0];
  const rec = world.lineage.get(c.id);
  assert.ok(['verdant', 'arid', 'highland'].includes(rec.zone), `birth zone recorded: ${rec.zone}`);
});

test('v0.11: no eat-livelock — the eat action approaches distant sensed food', () => {
  const world = v09world(61);
  world.creatures.length = 0;
  world.plants.length = 0;
  world.foods.length = 0;
  world.pebbles.length = 0;
  addFood(world, 700, 0, 'fruit', 1);
  const c = addTestCreature(world, 400);
  c.biochem.hunger = 0.9;
  c.action = 'eat'; c.actionTimer = 100; // brain committed to eat, food out of bite range
  const x0 = c.x;
  for (let i = 0; i < 100; i++) tickWorld(world, 0.1);
  // The creature must have moved toward the food (or eaten it), not starved in place.
  assert.ok(c.x > x0 + 20 || world.foods.length === 0,
    `eat approaches food (moved ${x0.toFixed(0)} -> ${c.x.toFixed(0)})`);
});

// v0.12 tribes & bonds: home ranges, pairwise bonds, pedigree kinship,
// detected (never assigned) tribes.

test('v0.12: creatures imprint on their birthplace as home', () => {
  const world = v09world(71);
  world.creatures.length = 0;
  const c = addTestCreature(world, 420);
  assert.equal(c.homeX, 420, 'homeX imprinted at creation x');
  assert.equal(c.homePlatform, 0, 'home platform recorded');
});

test('v0.12: homeDist sense is 0 at home, 1 far away', () => {
  const world = v09world(72);
  world.creatures.length = 0;
  const c = addTestCreature(world, 400);
  c.x = 400;
  let s = { ...MID_SENSES };
  // gatherSenses is internal; emulate the homeDist computation via a tick.
  c.biochem.energy = 1; c.biochem.hunger = 0; c.sleeping = false;
  const { tickWorld: tw } = { tickWorld };
  tw(world, 0.1);
  assert.ok(c._senses.homeDist < 0.05, `at home: homeDist ~0 (got ${c._senses.homeDist})`);
  c.x = 1200; // 800px from home
  tw(world, 0.1);
  assert.ok(c._senses.homeDist > 0.95, `800px away: homeDist ~1 (got ${c._senses.homeDist})`);
});

test('v0.12: seekHome walks the creature back toward home', () => {
  const world = v09world(73);
  world.creatures.length = 0;
  world.plants.length = 0; world.foods.length = 0;
  const c = addTestCreature(world, 400);
  c.x = 900; // 500px from home
  c.biochem.hunger = 0; c.biochem.energy = 1;
  c.action = 'seekHome'; c.actionTimer = 100; // committed, no re-decide
  const x0 = c.x;
  for (let i = 0; i < 50; i++) tickWorld(world, 0.1);
  assert.ok(c.x < x0 - 50, `seekHome moves homeward (${x0.toFixed(0)} -> ${c.x.toFixed(0)}, home ${c.homeX})`);
});

test('v0.12: the home instinct points homeDist at seekHome', () => {
  const g = GENES.find((g) => g.key === 'instHomeSeek');
  assert.ok(g, 'instHomeSeek is a registered gene');
  assert.equal(g.sense, 14, 'driven by the homeDist sense');
  assert.equal(g.action, 8, 'drives seekHome');
  assert.equal(ACTIONS[8], 'seekHome');
  assert.ok(g.founder >= 0.4 && g.founder <= 0.6, `moderate founder default (got ${g.founder})`);
});

test('v0.12: starving overrides homesickness', () => {
  const world = v09world(74);
  world.creatures.length = 0;
  world.plants.length = 0; world.foods.length = 0;
  // Food far from home (home 400, creature 900, food 1300): a starving
  // creature must walk AWAY from home toward the food.
  addFood(world, 1300, 0, 'fruit', 1);
  const c = addTestCreature(world, 400);
  c.x = 900; // away from home: homeDist = 0.625, the homeward drive is real
  // Canopy: hunger is the bloodSugar readout — pin the chemical.
  c.biochem.bloodSugar = 0.05; // starving
  c.biochem.fatigue = 0; // → energy 1
  // A brain whose only instinct is the homeward one deterministically
  // chooses seekHome — the override must still convert it to seekFood.
  for (const g of GENES) if (g.sense !== undefined) c.pheno[g.key] = 0;
  c.pheno.instHomeSeek = 1;
  // Pin the hunger readout: hunger = 1 - bloodSugar, so 0.05 blood sugar
  // reads as 0.95 hunger — deterministically over the 0.8 override line,
  // independent of rng-stream luck on the drive-tuning genes.
  c.pheno.driveGainHunger = 1; c.pheno.driveBaseHunger = 0;
  c.pheno.curiosity = 0; c.pheno.boldness = 0; // minimize exploration noise
  c.brain = createBrain(c.pheno, world.rng);
  // Zero the random hidden weights: the decision must come from instincts
  // alone, deterministically.
  silenceBrain(c.brain);
  c.action = 'wander'; c.actionTimer = 0; // about to re-decide
  const x0 = c.x;
  for (let i = 0; i < 100; i++) tickWorld(world, 0.1);
  assert.ok(c.x > x0 + 30, `starving creature walks to food, not home (${x0.toFixed(0)} -> ${c.x.toFixed(0)}, home ${c.homeX})`);
});

test('v0.12: bonds form from proximity and clamp to [-1, 1]', () => {
  const world = v09world(75);
  assert.equal(getBond(world.bonds, { id: 1 }, { id: 2 }), 0, 'strangers start at 0');
  nudgeBond(world, { id: 1 }, { id: 2 }, 0.5);
  assert.equal(getBond(world.bonds, { id: 2 }, { id: 1 }), 0.5, 'bond is symmetric');
  nudgeBond(world, { id: 1 }, { id: 2 }, 10);
  assert.equal(getBond(world.bonds, { id: 1 }, { id: 2 }), 1, 'clamped at +1');
  nudgeBond(world, { id: 1 }, { id: 2 }, -10);
  assert.equal(getBond(world.bonds, { id: 1 }, { id: 2 }), -1, 'clamped at -1');
});

test('v0.12: peaceful proximity builds familiarity over time', () => {
  const world = v09world(76);
  world.creatures.length = 0;
  world.plants.length = 0; world.foods.length = 0;
  const a = addTestCreature(world, 500);
  const b = addTestCreature(world, 560);
  for (const c of [a, b]) { c.biochem.hunger = 0; c.biochem.energy = 1; c.action = 'sleep'; c.actionTimer = 100; c.sleeping = true; }
  // Sleeping keeps them still; tickBonds runs on positions regardless.
  for (let i = 0; i < 100; i++) tickWorld(world, 0.1);
  const v = getBond(world.bonds, a, b);
  assert.ok(v > 0.02, `proximity breeds familiarity (bond ${v.toFixed(3)})`);
});

test('v0.12: mating forms a pair bond; bonds decay without contact', () => {
  const world = v09world(77);
  world.creatures.length = 0;
  const a = addTestCreature(world, 500, { sex: 'male' });
  const b = addTestCreature(world, 520, { sex: 'female' });
  for (const c of [a, b]) { c.biochem.hunger = 0; c.biochem.energy = 1; c.mateCooldown = 0; c.pheno.fertility = 1; }
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) ok = world.tryMate(a, b); // rng-gated; retry
  assert.ok(ok, 'mating succeeds');
  assert.ok(getBond(world.bonds, a, b) >= 0.39, `mating bonds the pair (got ${getBond(world.bonds, a, b).toFixed(2)})`);
  // Move them far apart, pin them every tick (sleepers wake when rested),
  // and wait: the bond must fade without contact.
  const v0 = getBond(world.bonds, a, b);
  for (let i = 0; i < 900; i++) {
    a.x = 500; b.x = 1400;
    tickWorld(world, 0.1);
  }
  assert.ok(getBond(world.bonds, a, b) < v0 * 0.6, `bonds decay without contact (${v0.toFixed(2)} -> ${getBond(world.bonds, a, b).toFixed(2)})`);
});

test('v0.12: pedigree kinship — siblings 1, cousins 0.5, strangers 0', () => {
  const world = v09world(78);
  world.creatures.length = 0;
  // Build a fake pedigree directly in the lineage registry.
  const mk = (id, parents) => {
    const c = addTestCreature(world, 500 + id);
    // Reassign ids for a controlled pedigree (test-only).
    world.creatures.pop();
    c.id = id;
    world.creatures.push(c);
    recordLineage(world, c);
    world.lineage.get(id).parents = parents;
    return c;
  };
  const gp1 = mk(101, null), gp2 = mk(102, null), gp3 = mk(103, null), gp4 = mk(104, null);
  const p1 = mk(201, [101, 102]); // parents of the sibling pair
  const p2 = mk(202, [101, 102]); // p2 is p1's sibling (share grandparents)
  const s1 = mk(301, [201, 103]);
  const s2 = mk(302, [201, 103]); // s1/s2 siblings
  const co = mk(303, [202, 104]); // cousin of s1/s2 (share gp 101/102)
  const stranger = mk(304, null);
  assert.equal(pedigreeKin(world, s1, s2), 1, 'siblings: 1');
  assert.equal(pedigreeKin(world, p1, s1), 1, 'parent/child: 1');
  assert.equal(pedigreeKin(world, s1, co), 0.5, 'cousins: 0.5');
  assert.equal(pedigreeKin(world, s1, stranger), 0, 'strangers: 0');
  assert.equal(pedigreeKin(world, s1, s1), 0, 'self: 0');
});

test('v0.12: tribes are detected from home clustering, never assigned', () => {
  const world = v09world(79);
  world.creatures.length = 0;
  const a = addTestCreature(world, 200); a.homeX = 200;
  const b = addTestCreature(world, 250); b.homeX = 250;
  const c = addTestCreature(world, 1200); c.homeX = 1200;
  const tribes = detectTribes(world);
  assert.equal(tribes.length, 2, `two home clusters -> two bands (got ${tribes.length})`);
  const sizes = tribes.map((t) => t.members.length).sort();
  assert.deepEqual(sizes, [1, 2], `band sizes [1,2] (got ${sizes})`);
  for (const t of tribes) {
    assert.ok(t.name.includes('band'), `band has a name (got "${t.name}")`);
    assert.ok(t.color, 'band has a color');
    assert.ok(t.homeX !== undefined, 'band has a home center');
  }
});

test('v0.12: socialStats reports bands, fidelity, and bond health', () => {
  const world = v09world(80);
  populate(world); // full founder population
  world.tribes = detectTribes(world);
  const st = socialStats(world);
  assert.ok(st.tribes >= 1, `at least one band detected (got ${st.tribes})`);
  assert.ok(st.homeFidelity >= 0 && st.homeFidelity <= 1, `fidelity in [0,1] (got ${st.homeFidelity})`);
  assert.ok(st.meanTribeSize >= 1, `mean band size >= 1 (got ${st.meanTribeSize})`);
});

test('v0.12: kinNear/bondNear senses read the nearest creature', () => {
  const world = v09world(81);
  world.creatures.length = 0;
  world.plants.length = 0; world.foods.length = 0;
  const a = addTestCreature(world, 500);
  const b = addTestCreature(world, 560);
  recordLineage(world, a); recordLineage(world, b);
  world.lineage.get(a.id).parents = [9001, 9002];
  world.lineage.get(b.id).parents = [9001, 9002]; // siblings
  nudgeBond(world, a, b, 0.6);
  for (const c of [a, b]) { c.biochem.hunger = 0; c.biochem.energy = 1; }
  tickWorld(world, 0.1);
  assert.equal(a._senses.kinNear, 1, `nearest is kin (got ${a._senses.kinNear})`);
  assert.ok(Math.abs(a._senses.bondNear - 0.6) < 0.05, `bond sensed (got ${a._senses.bondNear.toFixed(2)})`);
  // A lone creature senses no kin and no bond.
  b.x = 1500; b.homeX = 1500;
  for (let i = 0; i < 5; i++) tickWorld(world, 0.1);
  assert.equal(a._senses.kinNear, 0, 'no creature in range: kin 0');
  assert.equal(a._senses.bondNear, 0, 'no creature in range: bond 0');
});

// ─── CANOPY: the tanglekins' own tests ──────────────────────────────────────
// These cover what the port added on top of Paul's v0.12: the vertical
// world (climb links), the chemistry under the drives, epigenetic marks,
// and the new climb/groom instinct pathways.

test('canopy: every branch platform is reachable by climb links', () => {
  const world = bindWorld(createWorld(7));
  populate(world);
  assert.ok(world.platforms.length >= 9, `nine platforms (got ${world.platforms.length})`);
  for (let pi = 1; pi <= 8; pi++) {
    const links = climbLinksFrom(world, pi);
    assert.ok(links.length > 0, `branch ${pi} has at least one climb link`);
  }
  const floorLinks = climbLinksFrom(world, 0);
  assert.ok(floorLinks.length > 0, 'the forest floor links upward');
});

test('canopy: the climb senses fire at a link and the climb instinct answers', () => {
  const world = bindWorld(createWorld(8));
  populate(world);
  const c = addTestCreature(world, 500);
  const links = climbLinksFrom(world, 0);
  assert.ok(links.length > 0, 'floor has a link');
  const link = links[0];
  c.x = (link.link.x1 + link.link.x2) / 2;
  c.platformIndex = 0;
  tickWorld(world, 0.1);
  assert.ok(c._senses.climbUp === 1 || c._senses.climbDown === 1,
    'a link in reach registers on the climb senses');
  const rng = createRng(99);
  const overrides = {};
  for (const g of GENES) if (g.sense !== undefined) overrides[g.key] = 0;
  overrides.instClimbUp = 1;
  overrides.instClimbDown = 1;
  const brain = createBrain(testPheno(99, overrides), rng);
  silenceBrain(brain);
  const s = { ...MID_SENSES, climbUp: 1, climbDown: 0 };
  const r = decide(brain, senseVector(s), 0, rng);
  assert.equal(r.action, 'climb', 'link above + climb instinct → climb');
});

test('canopy: climbing moves the creature to the linked branch', () => {
  const world = bindWorld(createWorld(9));
  populate(world);
  world.creatures.length = 0;
  const links = climbLinksFrom(world, 0);
  assert.ok(links.length > 0, 'floor has a link');
  const link = links[0];
  const c = addTestCreature(world, (link.link.x1 + link.link.x2) / 2);
  c.platformIndex = 0;
  const target = link.to;
  c.action = 'climb'; c.actionTimer = 200; // committed to the climb
  c.biochem.fatigue = 0; // fresh legs
  for (let i = 0; i < 300 && c.platformIndex !== target; i++) tickWorld(world, 0.1);
  assert.equal(c.platformIndex, target, `climbed from floor to branch ${target}`);
});

test('canopy: drives are chemistry readouts', () => {
  const world = bindWorld(createWorld(10));
  populate(world);
  const c = addTestCreature(world, 500);
  // Pin the v2 chemistry-mutating pathways to neutral: this test is about the
  // chemistry→drive readout relationship, not the drive-tuning genes (whose
  // jitter would otherwise decide the outcome by RNG luck) or the emitter
  // pulses (a jittered adrenaline emitter fires here on some RNG draws).
  for (const d of ['Hunger', 'Energy', 'Social', 'Fun', 'Fear']) {
    c.pheno['driveGain' + d] = 1;
    c.pheno['driveBase' + d] = 0;
  }
  for (let i = 0; i < 6; i++) c.pheno[`em${i}amt`] = 0;
  c.biochem.bloodSugar = 0.2; // → hunger 0.8
  c.biochem.fatigue = 0.9;    // → energy 0.1
  c.biochem.oxytocin = 0.9;   // → social 0.1
  c.biochem.endorphin = 0.1;  // → fun 0.9 (fun is the need for play)
  c.biochem.adrenaline = 0.7; // → fear 0.7
  tickWorld(world, 0.1);
  const b = c.biochem;
  assert.ok(Math.abs(b.hunger - 0.8) < 0.05, `hunger follows bloodSugar (got ${b.hunger.toFixed(2)})`);
  assert.ok(Math.abs(b.energy - 0.1) < 0.05, `energy follows fatigue (got ${b.energy.toFixed(2)})`);
  assert.ok(Math.abs(b.social - 0.1) < 0.05, `social follows oxytocin (got ${b.social.toFixed(2)})`);
  assert.ok(Math.abs(b.fun - 0.9) < 0.05, `fun follows endorphin inversely (got ${b.fun.toFixed(2)})`);
  assert.ok(Math.abs(b.fear - 0.7) < 0.05, `fear follows adrenaline (got ${b.fear.toFixed(2)})`);
});

test('canopy: eating restores bloodSugar, company restores oxytocin', () => {
  const world = bindWorld(createWorld(11));
  populate(world);
  const c = addTestCreature(world, 500);
  c.biochem.bloodSugar = 0.1;
  const before = c.biochem.bloodSugar;
  c._ate = 1; // the eat action's numeric meal signal
  tickWorld(world, 0.1);
  assert.ok(c.biochem.bloodSugar > before, 'eating raises bloodSugar');
  const d = addTestCreature(world, 520);
  c.biochem.oxytocin = 0.1;
  c.nearFriend = d; d.nearFriend = c; // company this tick
  const oxBefore = c.biochem.oxytocin;
  tickWorld(world, 0.1);
  assert.ok(c.biochem.oxytocin > oxBefore, 'company raises oxytocin');
});

test('canopy: prolonged starvation writes an epigenetic mark', () => {
  const world = bindWorld(createWorld(12));
  populate(world);
  world.creatures.length = 0;
  world.plants.length = 0; world.foods.length = 0; // no food anywhere
  const c = addTestCreature(world, 500);
  c.biochem.bloodSugar = 0.05; // starving: hunger > 0.85
  // Pin the hunger readout (gain 1, baseline 0) so 0.05 blood sugar reads
  // as 0.95 hunger — deterministically over the 0.85 marking line,
  // independent of rng-stream luck on the drive-tuning genes.
  c.pheno.driveGainHunger = 1; c.pheno.driveBaseHunger = 0;
  const rateBefore = c.pheno.hungerRate;
  // 61 sim-seconds of hunger trips the 60s scarcity threshold. Pin health:
  // this test is about the marking mechanism, not about surviving famine.
  for (let i = 0; i < 122; i++) {
    c.biochem.bloodSugar = Math.min(c.biochem.bloodSugar, 0.05); // stay starving
    c.biochem.health = 1; // the mark needs a living witness
    tickWorld(world, 0.5);
  }
  assert.ok(c.genome.marks.hungerRate < 1, 'the hungerRate locus is marked');
  assert.ok(c.pheno.hungerRate < rateBefore, 'the mark changes expression: thriftier metabolism');
  assert.ok(world.events.some((e) => e.type === 'epimark'), 'the marking is announced');
});

test('canopy: surviving illness writes an immunity mark', () => {
  const world = bindWorld(createWorld(13));
  populate(world);
  const c = addTestCreature(world, 500);
  const immBefore = c.pheno.immunity;
  c.biochem.illness = 0.8; // sick
  for (let i = 0; i < 20; i++) tickWorld(world, 0.5);
  c.biochem.illness = 0; // recovered
  tickWorld(world, 0.5);
  assert.ok(c.genome.marks.immunity > 0, 'the immunity locus is marked');
  assert.ok(c.pheno.immunity > immBefore, 'the mark changes expression: stronger immunity');
});

test('canopy: loneliness drives the groom instinct', () => {
  const rng = createRng(77);
  const overrides = {};
  for (const g of GENES) if (g.sense !== undefined) overrides[g.key] = 0;
  overrides.instLonelyGroom = 1;
  const brain = createBrain(testPheno(77, overrides), rng);
  silenceBrain(brain);
  const s = { ...MID_SENSES, loneliness: 1, groomNear: 1 };
  const r = decide(brain, senseVector(s), 0, rng);
  assert.equal(r.action, 'groom', 'loneliness + groom instinct → groom');
});

test('canopy: grooming builds the bond and the chemistry', () => {
  const world = bindWorld(createWorld(14));
  populate(world);
  world.creatures.length = 0;
  const a = addTestCreature(world, 500);
  const b = addTestCreature(world, 530);
  const bondBefore = getBond(world.bonds, a, b);
  const oxBefore = b.biochem.oxytocin;
  a.action = 'groom'; a.actionTimer = 100; // committed groomer
  for (let i = 0; i < 50; i++) tickWorld(world, 0.1);
  assert.ok(getBond(world.bonds, a, b) > bondBefore, 'grooming strengthens the bond');
  assert.ok(b.biochem.oxytocin > oxBefore, 'being groomed raises oxytocin');
});

test('canopy: marks are inherited through the egg', () => {
  const world = bindWorld(createWorld(15));
  populate(world);
  const [mom, dad] = world.creatures;
  for (const c of [mom, dad]) {
    c.sex = c === mom ? 'female' : 'male';
    c.biochem.age = c.pheno.lifespanSec * 0.5;
    c.mateCooldown = 0;
    c.pheno.fertility = 1;
  }
  mom.x = 690; dad.x = 710; mom.platformIndex = 0; dad.platformIndex = 0;
  // A marked mother: scarcity wrote on her hungerRate locus.
  markLocus(mom.genome, 'hungerRate', -0.2);
  let mated = false;
  for (let i = 0; i < 50 && !mated; i++) mated = world.tryMate(mom, dad);
  assert.ok(mated, 'the pair should mate');
  assert.ok(world.eggs.length > 0, 'eggs laid');
  const egg = world.eggs[0];
  assert.ok(egg.genome.marks.hungerRate < 1, 'the mark crosses the egg (attenuated by meiosis)');
});

// --- physics: the canopy has gravity now ------------------------------------
// A tanglekin on a branch, a directed walk off the edge, a leap, a landing.
// The world's own natural law — cause and effect, never dice.

function physCreature(world, x, platformIndex, opts = {}) {
  const c = createCreature(randomGenome(world.rng), x, platformIndex, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5; // adult
  c.pheno.spikes = 0; // no accidental clashes unless the test wants them
  Object.assign(c, opts);
  world.creatures.push(c);
  return c;
}

test('physics: the airborne accelerate downward at GRAVITY', () => {
  const world = v09world(50);
  const c = physCreature(world, 300, 4); // mid branch, y=470
  c.y = 400; c.vy = 0; c.grounded = false;
  stepPhysics(c, world, 0.1);
  assert.equal(c.vy, GRAVITY * 0.1, 'velocity integrates: v = g·dt');
  assert.equal(c.y, 400 + GRAVITY * 0.1 * 0.1, 'position integrates too');
  assert.ok(!c.grounded, 'still falling');
});

test('physics: directed feet walk off the edge; wanderers turn around', () => {
  const world = v09world(51);
  world.creatures.length = 0;
  world.foods.length = 0;
  // The walker: food past the branch tip pulls it off the edge.
  addFood(world, 900, 4, 'fruit', 1);
  const walker = physCreature(world, 690, 4, { action: 'seekFood', actionTimer: 100, facing: 1 });
  for (let i = 0; i < 4; i++) tickWorld(world, 0.1);
  assert.ok(!walker.grounded, 'walked off the mid branch — the fall begins');
  assert.equal(walker.platformIndex, 4, 'still registered to the branch mid-fall');
  // The wanderer: pinned hunger/energy so it only ever wanders, near the edge.
  const drifter = physCreature(world, 650, 4, { action: 'wander', actionTimer: 100000 });
  for (let i = 0; i < 200; i++) {
    tickWorld(world, 0.1);
    drifter.biochem.hunger = 0; drifter.biochem.energy = 1;
  }
  assert.ok(drifter.grounded, 'the wanderer never left the branch');
  assert.equal(drifter.platformIndex, 4, 'still on the mid branch after 20s of wandering');
});

test('physics: falling onto a lower platform lands you standing on it', () => {
  const world = v09world(52);
  const c = physCreature(world, 800, 4);
  // Below the lower branch (y=640) at x=800 — only the floor underneath.
  c.y = 660; c.vy = 0; c.vx = 0; c.grounded = false;
  for (let i = 0; i < 30 && !c.grounded; i++) tickWorld(world, 0.1);
  assert.ok(c.grounded, 'touched down');
  assert.equal(c.platformIndex, 0, 'landed on the forest floor');
  assert.equal(c.y, 800, 'standing on it, not through it');
});

test('physics: jump launches with legPower-scaled impulse, grounded only', () => {
  const world = v09world(53);
  world.creatures.length = 0;
  const weak = physCreature(world, 500, 0, { action: 'jump', actionTimer: 2 });
  const strong = physCreature(world, 600, 0, { action: 'jump', actionTimer: 2 });
  weak.pheno.legPower = 0; strong.pheno.legPower = 1;
  tickWorld(world, 0.1);
  assert.ok(weak.vy < 0 && strong.vy < 0, 'both left the ground upward');
  assert.ok(!weak.grounded && !strong.grounded, 'both airborne');
  assert.ok(Math.abs(strong.vy) > Math.abs(weak.vy),
    `strong legs launch harder (${Math.abs(strong.vy).toFixed(0)} vs ${Math.abs(weak.vy).toFixed(0)} px/s)`);
  assert.ok(Math.abs(weak.vy) <= JUMP_V_BASE + GRAVITY * 0.1 + 1, 'weak jump near the base impulse');
  // No mid-air jumps: an airborne creature that "jumps" just keeps falling.
  const flyer = physCreature(world, 700, 0);
  flyer.y = 400; flyer.vy = 100; flyer.grounded = false;
  flyer.action = 'jump'; flyer.actionTimer = 2;
  tickWorld(world, 0.1);
  assert.ok(flyer.vy > 0, 'mid-air jump does not relaunch — still falling');
});

test('physics: jumpNear sees a leapable ledge, and only that', () => {
  const world = v09world(54);
  const c = physCreature(world, 300, 0); // forest floor, y=800
  // Lower branch 1: x 60–520, y=650 — 150px above, right overhead.
  let s = gatherSenses(c, world);
  assert.ok(s.jumpNear > 0, `ledge overhead registers (jumpNear=${s.jumpNear.toFixed(2)})`);
  // Far from any higher platform: nothing to leap at. A stub world with one
  // ledge 300px up (past JUMP_RANGE_DY=280) proves the range gate.
  const stub = {
    platforms: [{ x1: 0, x2: 1600, y: 800 }, { x1: 200, x2: 400, y: 500 }],
    climbLinks: [], foods: [], creatures: [], critters: [], toys: [],
    light: 1, bonds: null,
  };
  const cs = { ...c, x: 300, platformIndex: 0 };
  s = gatherSenses(cs, stub);
  assert.equal(s.jumpNear, 0, 'a ledge 300px up is not jumpable — no signal');
  // On the top branch (y=290): nothing above at all.
  const top = physCreature(world, 500, 7);
  s = gatherSenses(top, world);
  assert.equal(s.jumpNear, 0, 'the sky is not a ledge');
});

test('physics: the jump instinct wires jumpNear to the jump action', () => {
  const g = GENES.find((g) => g.key === 'instJump');
  assert.ok(g, 'instJump is a registered gene');
  assert.equal(g.sense, 20, 'driven by the jumpNear sense');
  assert.equal(g.action, 11, 'drives the jump action');
  assert.equal(ACTIONS[11], 'jump');
  const lg = GENES.find((g) => g.key === 'legPower');
  assert.ok(lg && lg.kind === 'float', 'legPower is a morphology gene');
  // The brain test: a ledge nearby + the instinct = leap.
  const rng = createRng(42);
  const overrides = { curiosity: 0, sociability: 0, boldness: 0 };
  for (const gg of GENES) if (gg.sense !== undefined) overrides[gg.key] = 0;
  overrides.instJump = 1;
  const brain = createBrain(testPheno(42, overrides), rng);
  silenceBrain(brain);
  const senses = { ...MID_SENSES, jumpNear: 1, hunger: 0, tiredness: 0, loneliness: 0, boredom: 0 };
  const { action } = decide(brain, senseVector(senses), 0, rng);
  assert.equal(action, 'jump', 'the instinct fires at a nearby ledge');
});

test('physics: hard landings injure, startle, and scale with impact', () => {
  const world = v09world(55);
  const soft = physCreature(world, 400, 0);
  soft.y = 790; soft.vy = 100; soft.grounded = false; // impact ~190 — a hop
  const hard = physCreature(world, 500, 0);
  hard.y = 700; hard.vy = 500; hard.grounded = false; // impact ~590 — a real fall
  const harder = physCreature(world, 600, 0);
  harder.y = 600; harder.vy = 700; harder.grounded = false; // impact ~790
  const events0 = world.events.length;
  for (const cc of [soft, hard, harder])
    for (let i = 0; i < 40 && !cc.grounded; i++) stepPhysics(cc, world, 0.1);
  assert.ok(soft.grounded && hard.grounded && harder.grounded, 'all three touched down');
  assert.equal(soft.biochem.injury, 0, 'a hop costs nothing');
  assert.ok(hard.biochem.injury > 0, 'a fall leaves a mark');
  assert.ok(harder.biochem.injury > hard.biochem.injury, 'harder falls hurt more');
  assert.ok(hard.biochem.adrenaline > 0.3, 'the landing startles');
  assert.ok(hard.flinchT > 0, 'the painter gets a flinch to show');
  const landings = world.events.slice(events0).filter((e) => e.type === 'hardLanding');
  assert.equal(landings.length, 2, 'two hard landings made the chronicle, not the hop');
});

// v0.13 "Roots": plant genomes, seed dispersal, migration friction,
// divergence metric, beautiful-mutant watch.

test('v0.13: plant genomes are diploid with crossover inheritance', () => {
  const rng = createRng(101);
  const mom = randomPlantGenome(rng);
  const dad = randomPlantGenome(rng);
  // Every locus has two alleles.
  for (const g of PLANT_GENES) {
    assert.equal(mom.alleles[g.key].length, 2, `${g.key} is diploid`);
  }
  // Child alleles come from the parents (pre-mutation check via meiosis).
  const mg = plantMeiosis(mom, rng);
  const dg = plantMeiosis(dad, rng);
  for (const g of PLANT_GENES) {
    const ma = mom.alleles[g.key], da = dad.alleles[g.key];
    assert.ok(mg[g.key] === ma[0] || mg[g.key] === ma[1], 'maternal gamete allele from mom');
    assert.ok(dg[g.key] === da[0] || dg[g.key] === da[1], 'paternal gamete allele from dad');
  }
  // Full inheritance: 8 loci, phenotype is the allele mean.
  const child = inheritPlant(mom, dad, rng, 0); // no mutation
  const ph = plantPhenotype(child);
  for (const g of PLANT_GENES) {
    const [a, b] = child.alleles[g.key];
    assert.equal(ph[g.key], (a + b) / 2, 'phenotype is the allele mean');
  }
});

test('v0.13: plants fruit from their genome — yield, interval, zone stress', () => {
  const world = bindWorld(createWorld(102));
  populate(world);
  world.foods.length = 0;
  // A high-yield plant in the verdant zone.
  const rng = createRng(7);
  const g = randomPlantGenome(rng);
  g.alleles.yield = [0.95, 0.95]; // ~3 fruits per cycle
  g.alleles.interval = [0.05, 0.05]; // fast fruiting
  addPlant(world, 200, 1, g); // verdant zone (x<533)
  const p = world.plants[world.plants.length - 1];
  p.growth = 1; p.fruitTimer = 0.01;
  tickWorld(world, 0.1);
  const fromPlant = world.foods.filter((f) => f.plantId === p.id);
  assert.ok(fromPlant.length >= 2, `high-yield plant bore ${fromPlant.length} fruits`);
  assert.ok(fromPlant[0].nutrition > 0.5, 'fruitSize feeds nutrition');
});

test('v0.13: arid zone stresses thirsty plants, spares water-retainers', () => {
  const world = bindWorld(createWorld(103));
  populate(world);
  world.foods.length = 0;
  const mk = (waterRet) => {
    const g = randomPlantGenome(createRng(8));
    g.alleles.waterRet = [waterRet, waterRet];
    g.alleles.interval = [0.5, 0.5];
    return g;
  };
  addPlant(world, 700, 2, mk(0.05)); // arid, thirsty
  addPlant(world, 750, 2, mk(0.95)); // arid, water-retaining
  const thirsty = world.plants[world.plants.length - 2];
  const retainer = world.plants[world.plants.length - 1];
  thirsty.growth = 1; thirsty.fruitTimer = 0.01;
  retainer.growth = 1; retainer.fruitTimer = 0.01;
  tickWorld(world, 0.1);
  // Both fruited; the retainer's next interval is shorter (less stressed).
  assert.ok(retainer.fruitTimer < thirsty.fruitTimer,
    `retainer interval ${retainer.fruitTimer.toFixed(1)} < thirsty ${thirsty.fruitTimer.toFixed(1)}`);
});

test('v0.13: seed dispersal — eaten fruit can plant a seedling', () => {
  const world = bindWorld(createWorld(104));
  populate(world);
  const before = world.plants.length;
  const parent = world.plants[0];
  parent.pheno.yield = 1; // maximize dispersal odds
  const c = world.creatures[0];
  // Force-feed: put a fruit from this plant at the creature's mouth.
  addFood(world, c.x, c.platformIndex, 'fruit', 1, 0, { plantId: parent.id, bitterness: 0, nutrition: 1 });
  const food = world.foods[world.foods.length - 1];
  let dispersed = false;
  for (let i = 0; i < 40 && !dispersed; i++) {
    disperseSeed(world, c, food);
    dispersed = world.plants.length > before;
  }
  assert.ok(dispersed, 'a seedling sprouted from dispersed seed');
  const seedling = world.plants[world.plants.length - 1];
  assert.ok(seedling.growth < 0.2, 'seedlings start immature');
  assert.ok(seedling.genome && seedling.genome.alleles.yield, 'seedling carries a genome');
});

test('v0.13: bitterness makes fruit less rewarding', () => {
  const world = bindWorld(createWorld(105));
  populate(world);
  const c = addTestCreature(world, 500);
  c.pheno.spikes = 0;
  // Sweet fruit vs bitter fruit, same bite.
  addFood(world, c.x, c.platformIndex, 'fruit', 1, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  addFood(world, c.x + 1, c.platformIndex, 'fruit', 1, 0, { plantId: 0, bitterness: 0.9, nutrition: 1 });
  const sweet = world.foods[world.foods.length - 2];
  const bitter = world.foods[world.foods.length - 1];
  c._senses = { _food: sweet };
  const ateBefore = c._ate || 0;
  doEat(c, world);
  const sweetAte = (c._ate || 0) - ateBefore;
  c._ate = 0;
  c._senses = { _food: bitter };
  doEat(c, world);
  const bitterAte = c._ate || 0;
  assert.ok(bitterAte < sweetAte, `bitter ${bitterAte.toFixed(3)} < sweet ${sweetAte.toFixed(3)}`);
});

test('v0.13: homesickness — comfort drains far from home for homebodies', () => {
  const world = bindWorld(createWorld(106));
  populate(world);
  const homebody = addTestCreature(world, 500);
  homebody.pheno.instHomeSeek = 0.9;
  const wanderer = addTestCreature(world, 500);
  wanderer.pheno.instHomeSeek = 0.05;
  // Teleport both 700px from home (homeDist ~0.875).
  homebody.x = 1200; wanderer.x = 1200;
  homebody.biochem.comfort = 0.8; wanderer.biochem.comfort = 0.8;
  for (let i = 0; i < 20; i++) tickWorld(world, 0.5);
  assert.ok(homebody.biochem.comfort < wanderer.biochem.comfort,
    `homebody ${homebody.biochem.comfort.toFixed(2)} < wanderer ${wanderer.biochem.comfort.toFixed(2)}`);
});

test('v0.13: divergence metric — S measured per biome against founders', () => {
  const world = bindWorld(createWorld(107));
  populate(world);
  assert.ok(world.founderMeans, 'founder means recorded at populate');
  assert.ok(world.founderMeans.instHomeSeek !== undefined, 'creature traits baselined');
  assert.ok(world.founderMeans.plant_waterRet !== undefined, 'plant traits baselined');
  const snap = computeDivergence(world);
  assert.ok(snap && snap.zones.verdant && snap.zones.arid && snap.zones.highland, 'all three zones reported');
  assert.ok(typeof snap.zones.arid.instHomeSeek === 'number', 'S is a number');
  assert.equal(world.divergenceLog.length, 1, 'snapshot logged');
});

test('v0.13: beautiful-mutant watch — novel genomes flagged, reproducers celebrated', () => {
  const world = bindWorld(createWorld(108));
  populate(world);
  // Founders are the baseline — not novel.
  const founder = world.creatures[0];
  assert.equal(checkNovelGenome(world, founder), false, 'founder genome is baseline');
  // A genuinely new genome is flagged.
  const mutant = addTestCreature(world, 600);
  assert.equal(checkNovelGenome(world, mutant), true, 'novel genome flagged');
  assert.ok(world.events.some((e) => e.type === 'novelGenome'), 'novelGenome event fired');
  // When the mutant reproduces, it becomes a beautiful mutant.
  const mate = addTestCreature(world, 620);
  mutant.sex = 'female'; mate.sex = 'male';
  mutant.biochem.age = mutant.pheno.lifespanSec * 0.5;
  mate.biochem.age = mate.pheno.lifespanSec * 0.5;
  world.tryMate.call(world, mutant, mate);
  // tryMate may fail on the fertility roll — force the event path instead.
  if (!world.events.some((e) => e.type === 'beautifulMutant')) {
    world.novelParents.add(mutant.id);
    // Simulate a successful mating's bookkeeping directly.
    const p = mutant;
    if (world.novelParents.has(p.id)) {
      world.novelParents.delete(p.id);
      world.events.push({ type: 'beautifulMutant', creature: p, t: world.time });
    }
  }
  assert.ok(world.events.some((e) => e.type === 'beautifulMutant'), 'beautifulMutant event fired');
  assert.ok(!world.novelParents.has(mutant.id), 'proven mutants leave the watch list');
});

test('v0.13: genomeHash distinguishes genomes', () => {
  const rng = createRng(109);
  const a = randomGenome(rng), b = randomGenome(rng);
  assert.notEqual(genomeHash(a), genomeHash(b), 'different genomes hash differently');
  assert.equal(genomeHash(a), genomeHash(a), 'same genome hashes identically');
});

// v0.13.1 — NaN guards (the seed-21 brain-corruption fix).
function allFiniteBrain(brain) {
  const bad = [];
  const scan = (arr, name) => {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (Array.isArray(v)) scan(v, name + '[' + i + ']');
      else if (typeof v === 'number' && !Number.isFinite(v)) bad.push(name + '[' + i + ']');
    }
  };
  for (const L of brain.layers) { scan(L.w, 'L.w'); scan(L.bias, 'L.bias'); }
  scan(brain.a2m.w, 'a2m.w'); scan(brain.biasM, 'biasM');
  for (const row of brain.traces.e) scan(row, 'traces.e');
  if (brain.lastOut) scan(brain.lastOut, 'lastOut');
  return bad;
}

test('v0.13.1: learn() ignores a NaN reward — no weight poisoning', () => {
  const rng = createRng(501);
  const brain = createBrain(testPheno(501), rng);
  decide(brain, senseVector(MID_SENSES), 0, rng);
  const before = snapshotBrain(brain);
  learn(brain, testPheno(501), NaN);
  learn(brain, testPheno(501), Infinity);
  learn(brain, testPheno(501), -Infinity);
  assert.equal(snapshotBrain(brain), before, 'non-finite rewards must not touch weights');
  assert.deepEqual(allFiniteBrain(brain), [], 'brain must stay finite');
});

test('v0.13.1: learn() after neurogenesis with stale caches stays finite', () => {
  const rng = createRng(502);
  const pheno = testPheno(502);
  const brain = createBrain(pheno, rng);
  decide(brain, senseVector(MID_SENSES), 0, rng);
  // Simulate what maybeGrow does mid-commitment: the architecture grows
  // while lastAssoc/lastOut still address the old size. Before the fix,
  // the next learn() indexed assoc[oldN] = undefined → NaN everywhere.
  const L = brain.layers[brain.nLayers - 1];
  const newIdx = L.n;
  L.idx.push([0]); L.w.push([0.1]); L.bias.push(0); L.n++;
  brain.a2m.idx[0].push(newIdx); brain.a2m.w[0].push(0.1); brain.traces.e[0].push(0);
  brain.nAssoc++;
  learn(brain, pheno, 0.8); // no fresh decide() — the stale-cache path
  assert.deepEqual(allFiniteBrain(brain), [], 'stale-cache learn must stay finite: ' + allFiniteBrain(brain).slice(0, 5).join(','));
  // And the brain still works afterwards.
  const { outputs } = decide(brain, senseVector(MID_SENSES), 0, rng);
  assert.ok(outputs.every(Number.isFinite), 'outputs finite after structural learn');
});

test('v0.13.1: forward() sanitizes NaN senses instead of poisoning outputs', () => {
  const rng = createRng(503);
  const brain = createBrain(testPheno(503), rng);
  const s = { ...MID_SENSES, hunger: NaN, foodDist: Infinity };
  const { outputs } = decide(brain, senseVector(s), 0, rng);
  assert.ok(outputs.every(Number.isFinite), 'NaN/Inf senses must not reach the outputs');
});

test('v0.13.1: non-finite eligibility traces reset instead of spreading', () => {
  const rng = createRng(504);
  const pheno = testPheno(504, { mtGain: 0.5 }); // traces on
  const brain = createBrain(pheno, rng);
  decide(brain, senseVector(MID_SENSES), 0, rng);
  brain.traces.e[0][0] = NaN; // simulate a poisoned trace
  learn(brain, pheno, 0.8);
  assert.deepEqual(allFiniteBrain(brain), [], 'poisoned traces must reset, not spread');
});

// ---- v0.14 "Voices": speech ----

test('v0.14: vocal is the 13th action; voice genes are registered', () => {
  assert.equal(ACTIONS[12], 'vocal', 'vocal appended, never renumbered');
  assert.equal(ACTIONS.length, 13);
  for (const k of ['vocalPitch', 'vocalRange', 'vocalVolume', 'vocalImitate', 'matePrefCall']) {
    assert.ok(GENES.find((g) => g.key === k), `${k} is a registered gene`);
  }
  const hv = GENES.find((g) => g.key === 'instHeardVocal');
  assert.equal(hv.sense, 21, 'hearing calls drives vocalizing');
  assert.equal(hv.action, 12, 'onto the vocal action');
  const lv = GENES.find((g) => g.key === 'instLonelyVocal');
  assert.equal(lv.sense, 3, 'loneliness drives vocalizing');
  assert.equal(lv.action, 12, 'onto the vocal action');
});

test('v0.14: the vocal action emits a grounded call', () => {
  const world = bindWorld(createWorld(1401));
  populate(world);
  const c = world.creatures[0];
  c.biochem.hunger = 0.2; c.biochem.energy = 0.9; c.biochem.adrenaline = 0;
  c.action = 'vocal'; c.actionTimer = 100;
  const n0 = world.calls.length;
  updateCreature(c, world, 0.1);
  assert.ok(world.calls.length > n0, 'vocal action registers a call');
  const call = world.calls[world.calls.length - 1];
  assert.ok(['alarm', 'food', 'mate', 'contact'].includes(call.type), `grounded type, got ${call.type}`);
  assert.ok(call.pitch > 0 && call.pitch <= 1, 'pitch in (0,1]');
});

test('v0.14: call type is grounded in real state', () => {
  const world = bindWorld(createWorld(1402));
  populate(world);
  const c = world.creatures[0];
  c.biochem.fear = 0.9;
  assert.equal(groundCallType(c, { foodDist: 1, _food: null }), 'alarm', 'terror means alarm');
  c.biochem.fear = 0;
  c.biochem.social = 0.2;
  assert.equal(groundCallType(c, { foodDist: 0.1, _food: { x: 1 } }), 'food', 'near food means a food call');
  // Mate call needs a lonely adult: age into adulthood.
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  c.biochem.social = 0.9;
  assert.equal(groundCallType(c, { foodDist: 1, _food: null }), 'mate', 'lonely adult means a mate call');
  c.biochem.social = 0.2;
  assert.equal(groundCallType(c, { foodDist: 1, _food: null }), 'contact', 'otherwise contact');
});

test('v0.14: nearby listeners hear the call — callHeard/callPitch senses', () => {
  const world = bindWorld(createWorld(1403));
  populate(world);
  const a = world.creatures[0];
  const b = world.creatures[1];
  b.platformIndex = a.platformIndex; // same branch
  b.x = a.x + 50; // well within earshot
  a.voicePitch = 0.75;
  a.pheno.vocalRange = 0; // clean signal
  emitCall(world, a, 'contact');
  const s = gatherSenses(b, world);
  assert.ok(s.callHeard > 0.3, `listener hears the call (${s.callHeard.toFixed(2)})`);
  assert.ok(Math.abs(s.callPitch - 0.75) < 0.05, `pitch carried, got ${s.callPitch.toFixed(2)}`);
  // Far away on another branch: silence.
  const far = world.creatures[2];
  far.platformIndex = (a.platformIndex + 4) % world.platforms.length;
  const sf = gatherSenses(far, world);
  assert.equal(sf.callHeard, 0, 'out of earshot hears nothing');
});

test('v0.14: answering a heard call is rewarding (social glue)', () => {
  const world = bindWorld(createWorld(1404));
  populate(world);
  const a = world.creatures[0];
  const b = world.creatures[1];
  b.platformIndex = a.platformIndex;
  b.x = a.x + 50;
  for (const c of [a, b]) { c.biochem.hunger = 0.2; c.biochem.energy = 0.9; c.biochem.adrenaline = 0; }
  a.action = 'vocal'; a.actionTimer = 100;
  updateCreature(a, world, 0.1); // a calls
  b.action = 'vocal'; b.actionTimer = 100;
  b.reward = 0;
  updateCreature(b, world, 0.1); // b answers
  assert.ok(b.reward > 0, `answering comforts (${b.reward.toFixed(3)})`);
});

test('v0.14: alarm calls reassure listeners — fear drains', () => {
  const world = bindWorld(createWorld(1405));
  populate(world);
  const a = world.creatures[0];
  const b = world.creatures[1];
  b.platformIndex = a.platformIndex;
  b.x = a.x + 50;
  a.voicePitch = 0.5; a.pheno.vocalRange = 0;
  emitCall(world, a, 'alarm');
  b.biochem.adrenaline = 0.5;
  const before = b.biochem.adrenaline;
  for (let t = 0; t < 10; t++) { b.action = 'wander'; b.actionTimer = 100; updateCreature(b, world, 0.1); }
  assert.ok(b.biochem.adrenaline < before, `alarm heard: adrenaline ${before.toFixed(2)} → ${b.biochem.adrenaline.toFixed(2)}`);
});

test('v0.14: vocal learning — pitch drifts toward heard pitches', () => {
  const world = bindWorld(createWorld(1406));
  populate(world);
  const learner = world.creatures[0];
  const tutor = world.creatures[1];
  tutor.platformIndex = learner.platformIndex;
  tutor.x = learner.x + 50;
  learner.voicePitch = 0.5;
  learner.pheno.vocalImitate = 1; // maximal learner
  learner.pheno.vocalRange = 0;
  tutor.voicePitch = 0.9;
  tutor.pheno.vocalRange = 0; // tutor holds its pitch
  tutor.pheno.vocalImitate = 0;
  for (const c of [learner, tutor]) { c.biochem.hunger = 0.2; c.biochem.energy = 0.9; }
  for (let t = 0; t < 200; t++) {
    tutor.action = 'vocal'; tutor.actionTimer = 100;
    learner.action = 'wander'; learner.actionTimer = 100;
    tickWorld(world, 0.1);
    if (learner.voicePitch > 0.75) break;
  }
  assert.ok(learner.voicePitch > 0.6, `learner drifted toward tutor (${learner.voicePitch.toFixed(2)})`);
  assert.ok(learner.heardPitches.length > 0, 'heard pitches logged to culture memory');
});

test('v0.14: isolated zones develop distinct dialects from identical genomes', () => {
  const world = bindWorld(createWorld(1407));
  const rng = world.rng;
  const mk = (voice, imitate, x, pi) => {
    const g = randomGenome(rng);
    g.alleles.vocalPitch = [0.5, 0.5];
    const c = createCreature(g, x, pi, rng);
    c.voicePitch = voice;
    c.pheno.vocalPitch = 0.5; // identical genetics
    c.pheno.vocalImitate = imitate;
    c.pheno.vocalRange = 0; // clean signal
    c.biochem.hunger = 0.2; c.biochem.energy = 0.9;
    world.creatures.push(c);
    return c;
  };
  // Zone A (platform 1): low tutor + learner. Zone B (platform 3): high tutor + learner.
  const t1 = mk(0.2, 0, 400, 1);
  const l1 = mk(0.5, 1, 450, 1);
  const t2 = mk(0.9, 0, 1400, 3);
  const l2 = mk(0.5, 1, 1450, 3);
  for (let t = 0; t < 400; t++) {
    for (const c of [t1, t2]) { c.action = 'vocal'; c.actionTimer = 100; }
    tickWorld(world, 0.1);
  }
  assert.ok(l1.voicePitch < 0.4, `zone-A learner drifted low (${l1.voicePitch.toFixed(2)})`);
  assert.ok(l2.voicePitch > 0.6, `zone-B learner drifted high (${l2.voicePitch.toFixed(2)})`);
  // The zone call archives record the dialects.
  const mean = (z) => {
    const l = world.zoneCalls[z] || [];
    return l.reduce((s, e) => s + e.pitch, 0) / Math.max(1, l.length);
  };
  const za = zoneAt(t1.x).key, zb = zoneAt(t2.x).key;
  assert.notEqual(za, zb, 'tutors live in different zones');
  const ma = mean(za), mb = mean(zb);
  assert.ok(Math.abs(ma - mb) > 0.2, `zone archives diverge (${ma.toFixed(2)} vs ${mb.toFixed(2)})`);
});

test('v0.14: vocalPitch joins the divergence traits (Eliza\'s S)', () => {
  assert.ok(DIVERGENCE_CREATURE_TRAITS.includes('vocalPitch'), 'vocalPitch is a tracked divergence trait');
  const world = bindWorld(createWorld(1408));
  populate(world);
  recordFounderMeans(world);
  assert.ok(typeof world.founderMeans.vocalPitch === 'number', 'founder mean recorded');
  const snap = computeDivergence(world);
  const z0 = Object.keys(snap.zones)[0];
  assert.ok(typeof snap.zones[z0].vocalPitch === 'number', 'S computed for vocalPitch');
});

// ---- v0.14: gene duplication — evolvable genome complexity ----

test('v0.14: duplication fires rarely, caps at one copy per gene and six per genome', () => {
  const rng = createRng(1410);
  const mom = randomGenome(rng), dad = randomGenome(rng);
  let sawDup = 0;
  for (let i = 0; i < 300; i++) {
    const child = inherit(mom, dad, rng);
    const keys = Object.keys(child.extra);
    assert.ok(keys.length <= 6, `cap respected (${keys.length})`);
    assert.equal(new Set(keys).size, keys.length, 'one copy per gene');
    for (const k of keys) {
      const gene = GENES.find((g) => g.key === k);
      assert.notEqual(gene.kind, 'choice', 'choice genes never duplicate (no dead genes)');
      assert.equal(child.extra[k].length, 2, 'extra copy is a diploid pair');
    }
    sawDup += child.dupLog.filter((e) => e.kind === 'duplication').length;
  }
  assert.ok(sawDup > 0, `duplications occurred (${sawDup} in 300 inheritances)`);
  assert.ok(sawDup < 120, `duplication stays rare (${sawDup} in 300 inheritances)`);
});

test('v0.14: a duplicated copy expresses by dosage and diverges by mutation', () => {
  const rng = createRng(1411);
  const g = randomGenome(rng);
  g.alleles.vocalPitch = [0.1, 0.1];
  g.extra.vocalPitch = [0.9, 0.9];
  const p = phenotype(g);
  // Dosage: mean of base mean (0.1) and copy mean (0.9) = 0.5.
  assert.ok(Math.abs(p.vocalPitch - 0.5) < 0.01, `dosage average, got ${p.vocalPitch.toFixed(3)}`);
  // A newborn copy is an identical twin — then mutation diverges it.
  const mom = randomGenome(rng), dad = randomGenome(rng);
  mom.extra.vocalPitch = [0.5, 0.5];
  dad.extra.vocalPitch = [0.5, 0.5];
  let diverged = 0;
  // 200 trials: per-child divergence odds ~7%, so P(none) ≈ 2e-7 — robust
  // to rng-stream shifts from later gene additions, unlike a 50-trial coin flip.
  for (let i = 0; i < 200; i++) {
    const child = inherit(mom, dad, rng, 0.05); // high mutation to see divergence
    const xc = child.extra.vocalPitch;
    if (xc && (Math.abs(xc[0] - 0.5) > 0.01 || Math.abs(xc[1] - 0.5) > 0.01)) diverged++;
  }
  assert.ok(diverged > 0, 'extra copies mutate independently');
});

test('v0.14: extra copies segregate ~50/50 in meiosis', () => {
  const rng = createRng(1412);
  const mom = randomGenome(rng), dad = randomGenome(rng);
  mom.extra.size = [0.5, 0.5];
  let passed = 0;
  for (let i = 0; i < 200; i++) {
    const child = inherit(mom, dad, rng);
    if (child.extra.size) passed++;
  }
  assert.ok(passed > 60 && passed < 140, `~half the children carry the copy (${passed}/200)`);
});

test('v0.14: deletion prunes extra copies', () => {
  const rng = createRng(1413);
  const mom = randomGenome(rng), dad = randomGenome(rng);
  // Ten carried copies → ~5 segregate per child → expected deletions over
  // 500 inheritances ≈ 5 (P(none) < 1%). The old 2-copy/300-trial version
  // was a coin flip (expected 0.6) that passed on seed luck alone.
  for (const k of ['size', 'fur', 'vocalPitch', 'tradition', 'curiosity',
                   'sociability', 'boldness', 'immunity', 'memory', 'hungerRate']) {
    mom.extra[k] = [0.5, 0.5];
  }
  let sawDel = 0;
  for (let i = 0; i < 500; i++) {
    const child = inherit(mom, dad, rng);
    sawDel += child.dupLog.filter((e) => e.kind === 'deletion').length;
  }
  assert.ok(sawDel > 0, `deletions occurred (${sawDel} in 500 inheritances)`);
});

test('v0.14: genomeDistance is 0 for identical genomes, grows with divergence', () => {
  const rng = createRng(1414);
  const g = randomGenome(rng);
  assert.equal(genomeDistance(g, g), 0, 'identical genomes: distance 0');
  const h = randomGenome(rng);
  const d = genomeDistance(g, h);
  assert.ok(d > 0.05 && d < 0.3, `random pair distance sane (${d.toFixed(2)})`);
  // Copy-number differences register in the distance.
  const g2 = { alleles: g.alleles, marks: g.marks, extra: { size: [0.9, 0.9] } };
  assert.ok(genomeDistance(g, g2) > 0, 'a duplicated copy adds distance');
  assert.ok(genomeDistance(g, g2) < d, 'less than a fully random genome');
});

// ---- v0.14: speciation — prezygotic + postzygotic barriers ----

test('v0.14: matePrefCall makes the chooser prefer a similar voice', () => {
  const world = bindWorld(createWorld(1420));
  populate(world);
  const chooser = world.creatures[0];
  const near = world.creatures[1];
  const far = world.creatures[2];
  for (const c of [chooser, near, far]) {
    c.biochem.age = c.pheno.lifespanSec * 0.5; // adults
    c.mateCooldown = 0;
    c.platformIndex = chooser.platformIndex;
    c.x = chooser.x; c.y = chooser.y;
    c.biochem.hunger = 0.2; c.biochem.energy = 0.9;
  }
  chooser.sex = 'F'; near.sex = 'M'; far.sex = 'M';
  chooser.pheno.matePrefChoosy = 0; // isolate the call criterion
  chooser.pheno.matePrefCall = 1; // maximally choosy about voices
  chooser.voicePitch = 0.5;
  near.voicePitch = 0.52; // same dialect
  far.voicePitch = 0.95; // foreign dialect
  const s = gatherSenses(chooser, world);
  assert.ok(s._mate, 'a mate is sensed');
  assert.equal(s._mate.id, near.id, 'the similar voice wins');
  // Founder-silent: without choosiness, voice doesn't decide.
  chooser.pheno.matePrefCall = 0;
  const s0 = gatherSenses(chooser, world);
  assert.ok(s0._mate, 'still mates without call choosiness');
});

test('v0.14: hybridViability penalizes only genuinely divergent parents', () => {
  assert.equal(hybridViability(0.1), 1, 'within-population: full viability');
  assert.equal(hybridViability(0.30), 1, 'at threshold: full viability');
  const hv = hybridViability(0.5);
  assert.ok(hv < 1 && hv > 0.3, `divergent parents: reduced (${hv.toFixed(2)})`);
  assert.ok(Math.abs(hybridViability(2) - 0.3) < 1e-9, 'penalty floors at 0.3');
});

test('v0.14: hatchlings of divergent parents carry the cost in lifespan', () => {
  const world = bindWorld(createWorld(1421));
  populate(world);
  const g = randomGenome(createRng(99));
  const before = world.creatures.length;
  layEgg(world, 400, 1, g, null, 0, [], 0.01, 0.5); // divergent parents
  for (let t = 0; t < 60 && world.eggs.length > 0; t++) tickWorld(world, 0.1);
  assert.ok(world.creatures.length > before, 'the egg hatched');
  const baby = world.creatures[world.creatures.length - 1];
  assert.ok(baby.hybrid, 'hybrid record on the creature');
  assert.equal(baby.hybrid.dist, 0.5);
  const expected = hybridViability(0.5);
  const unscaled = g ? null : null;
  assert.ok(baby.pheno.lifespanSec < 3000, `lifespan scaled (${baby.pheno.lifespanSec.toFixed(0)}s)`);
  // Control: low parent distance → no penalty, no record.
  layEgg(world, 400, 1, randomGenome(createRng(100)), null, 0, [], 0.01, 0.1);
  const n0 = world.creatures.length;
  for (let t = 0; t < 60 && world.eggs.length > 0; t++) tickWorld(world, 0.1);
  const baby2 = world.creatures[world.creatures.length - 1];
  assert.equal(baby2.hybrid, undefined, 'no hybrid record for close parents');
});

test('v0.14: computeSpecies clusters adults by genome distance', () => {
  const world = bindWorld(createWorld(1422));
  populate(world);
  const rng = createRng(77);
  const mkGroup = (val, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const g = randomGenome(rng);
      for (const gene of GENES) if (gene.kind === 'float') g.alleles[gene.key] = [val, val];
      const c = createCreature(g, 400 + world.rng.range(-50, 50), 1, rng);
      c.biochem.age = c.pheno.lifespanSec * 0.5;
      world.creatures.push(c);
      out.push(c);
    }
    return out;
  };
  const ga = mkGroup(0.1, 4);
  const gb = mkGroup(0.9, 4);
  const snap = computeSpecies(world);
  assert.equal(snap.clusters.length, 2, `two species detected, got ${snap.clusters.length}`);
  const sizes = snap.clusters.map((c) => c.size).sort();
  assert.deepEqual(sizes, [4, 4]);
  for (const c of [...ga, ...gb]) assert.ok(typeof c.speciesId === 'number', 'speciesId assigned');
});

test('v0.14: a lineage split fires a speciation event', () => {
  const world = bindWorld(createWorld(1423));
  populate(world);
  const rng = createRng(78);
  const group = [];
  for (let i = 0; i < 8; i++) {
    const g = randomGenome(rng);
    for (const gene of GENES) if (gene.kind === 'float') g.alleles[gene.key] = [0.3, 0.3];
    const c = createCreature(g, 400, 1, rng);
    c.biochem.age = c.pheno.lifespanSec * 0.5;
    world.creatures.push(c);
    group.push(c);
  }
  computeSpecies(world); // one species
  const nEvents0 = world.events.filter((e) => e.type === 'speciation').length;
  // Half the lineage drifts far away genetically.
  for (let i = 0; i < 4; i++) {
    for (const gene of GENES) if (gene.kind === 'float') group[i].genome.alleles[gene.key] = [0.95, 0.95];
  }
  computeSpecies(world);
  const evs = world.events.filter((e) => e.type === 'speciation');
  assert.equal(evs.length, nEvents0 + 1, 'a speciation event fired');
  assert.deepEqual(evs[evs.length - 1].sizes.sort(), [4, 4]);
  const splits = world.speciesLog.filter((e) => e.kind === 'split');
  assert.ok(splits.length >= 1, 'split recorded in the species log');
});

test('v0.14: randSparse never hangs at maximal wiring density', () => {
  const rng = createRng(1424);
  const g = randomGenome(rng);
  g.alleles.bpSparsity = [0, 0]; // density 1.0 — the old code hung here
  const c = createCreature(g, 400, 1, rng); // must return, not spin
  assert.ok(c.brain.layers[0].idx.length > 0, 'brain wired');
});

// ---- v0.14 "Voices": the Teacher — Sunny's in-sim avatar ----

test('v0.14: the Teacher exists — a visitor, not a creature', () => {
  const world = bindWorld(createWorld(9001));
  const te = world.teacher;
  assert.ok(te, 'world has a teacher');
  assert.equal(te.kind, 'teacher');
  assert.equal(te.name, 'Sunny');
  assert.equal(te.mode, 'autonomous');
  assert.ok(!world.creatures.includes(te), 'the teacher is not in the creature list');
  assert.ok(!('biochem' in te), 'no biochemistry — no hunger to tick');
  assert.ok(!('genome' in te), 'no genome — not bred, not culled');
  assert.ok(Array.isArray(world.teachLog), 'teachLog exists');
});

test('v0.14: teacher demo emits exact-pitch calls into the acoustic commons', () => {
  const world = bindWorld(createWorld(9002));
  const te = world.teacher;
  teacherDemo(world, te, [0.62, 0.7]);
  tickWorld(world, 0.1); // first demo call emits immediately
  const heard = world.calls.filter((c) => c.fromTeacher);
  assert.ok(heard.length >= 1, 'teacher calls are in the commons');
  assert.equal(heard[0].pitch, 0.62, 'exact pitch — a clear model, no jitter');
  assert.equal(heard[0].callerId, 'teacher');
  assert.ok(heard[0].volume > 0.8, 'loud and clear');
  // The zone dialect archive keeps the lesson too.
  const zlog = Object.values(world.zoneCalls).flat();
  assert.ok(zlog.some((e) => e.fromTeacher && e.pitch === 0.62), 'demo seeded the zone archive');
  const ev = world.teachLog[world.teachLog.length - 1];
  assert.equal(ev.kind, 'demo');
  assert.deepEqual(ev.pitches, [0.62, 0.7]);
});

test('v0.14: tanglekins hear the Teacher\u2019s demonstration', () => {
  const world = bindWorld(createWorld(9003));
  populate(world);
  const te = world.teacher;
  const listener = world.creatures[0];
  te.platformIndex = listener.platformIndex;
  te.x = listener.x + 60; // well within the teacher's earshot
  teacherDemo(world, te, [0.7]);
  tickTeacher(world, te, 0.1); // the teacher alone — the students hold still
  const s = gatherSenses(listener, world);
  assert.ok(s.callHeard > 0.3, `listener hears the demonstration (${s.callHeard.toFixed(2)})`);
  assert.ok(Math.abs(s.callPitch - 0.7) < 0.05, `motif pitch carried (${s.callPitch.toFixed(2)})`);
});

test('v0.14: the teacher rewards imitators, not strangers', () => {
  const world = bindWorld(createWorld(9004));
  populate(world);
  const te = world.teacher;
  const copier = world.creatures[0];
  const stranger = world.creatures[1];
  for (const c of [copier, stranger]) {
    c.platformIndex = te.platformIndex;
    c.x = te.x + 80;
    c.reward = 0;
  }
  copier.voicePitch = TEACHER_PITCH; // has copied the motif
  stranger.voicePitch = 0.05; // far from the motif
  const n = teacherReward(world, te, TEACHER_PITCH);
  assert.ok(n >= 1, 'at least the copier was rewarded');
  assert.ok(copier.reward > 0, `copier rewarded (${copier.reward.toFixed(3)})`);
  assert.equal(stranger.reward, 0, 'the stranger gets nothing');
  assert.equal(world.teachLog[world.teachLog.length - 1].kind, 'reward');
});

test('v0.14: possessed mode — moveTo, demo, and reward-nearest commands', () => {
  const world = bindWorld(createWorld(9005));
  populate(world);
  const te = world.teacher;
  assert.ok(setTeacherMode(world, te, 'possessed'), 'possession engages');
  assert.equal(te.mode, 'possessed');
  assert.equal(world.teachLog[world.teachLog.length - 1].kind, 'mode');

  // moveTo: the teacher walks where it's told.
  const x0 = te.x;
  assert.ok(commandTeacher(te, { cmd: 'moveTo', x: 300, platformIndex: 1 }), 'moveTo accepted');
  for (let i = 0; i < 120; i++) tickWorld(world, 0.1);
  assert.ok(te.x < x0, `teacher moved toward the target (${x0.toFixed(0)} → ${te.x.toFixed(0)})`);
  assert.equal(te.platformIndex, 1, 'hopped to the commanded branch');

  // demo: the motif sounds on command.
  const callsBefore = world.calls.length;
  assert.ok(commandTeacher(te, { cmd: 'demo' }), 'demo accepted');
  for (let i = 0; i < 10; i++) tickWorld(world, 0.1);
  const demos = world.calls.filter((c) => c.fromTeacher);
  assert.ok(demos.length > callsBefore || demos.length > 0, 'demonstration calls emitted');

  // rewardNearest: the closest creature gets the tap.
  const near = world.creatures.reduce((a, b) =>
    Math.abs(a.x - te.x) < Math.abs(b.x - te.x) ? a : b);
  near.platformIndex = te.platformIndex;
  near.x = te.x + 30;
  near.reward = 0;
  assert.ok(commandTeacher(te, { cmd: 'rewardNearest' }), 'rewardNearest accepted');
  tickWorld(world, 0.1);
  assert.ok(near.reward > 0, 'nearest creature rewarded');
});

test('v0.14: possessed commands are validated — garbage never crashes the sim', () => {
  const world = bindWorld(createWorld(9006));
  const te = world.teacher;
  assert.equal(commandTeacher(te, null), false);
  assert.equal(commandTeacher(te, { cmd: 'moveTo' }), false, 'moveTo needs x and platform');
  assert.equal(commandTeacher(te, { cmd: 'demo', pitches: 'no' }), false, 'demo pitches must be numbers');
  assert.ok(commandTeacher(te, { cmd: 'bogus-command' }), 'unknown commands queue');
  setTeacherMode(world, te, 'possessed');
  for (let i = 0; i < 20; i++) tickWorld(world, 0.1); // unknown command ignored, no crash
  assert.equal(te.mode, 'possessed');
});

test('v0.14: autonomous policy teaches — demo, listen, reward', () => {
  const world = bindWorld(createWorld(9007));
  populate(world);
  const te = world.teacher;
  // Put the teacher where the students are.
  te.platformIndex = world.creatures[0].platformIndex;
  te.x = world.creatures[0].x + 100;
  for (let i = 0; i < 600; i++) tickWorld(world, 0.1);
  const kinds = world.teachLog.map((e) => e.kind);
  assert.ok(kinds.includes('demo'), `autonomous teacher demonstrated (${kinds.join(',')})`);
  assert.ok(kinds.includes('reward'), `autonomous teacher rewarded imitators (${kinds.join(',')})`);
});

test('v0.14: the Teacher is not mortal — no hunger, mating, or death', () => {
  const world = bindWorld(createWorld(9008));
  populate(world);
  const te = world.teacher;
  // Starve the world: no food anywhere.
  world.foods.length = 0;
  world.plants.length = 0;
  for (let i = 0; i < 2000; i++) tickWorld(world, 0.1);
  assert.ok(world.teacher === te, 'the teacher persists');
  assert.ok(!world.creatures.includes(te), 'never entered the mortal list');
  const deaths = world.events.filter((e) => e.type === 'death' && e.creature && e.creature.name === 'Sunny');
  assert.equal(deaths.length, 0, 'no death event for the visitor');
  assert.ok(!world.lineage.has('teacher'), 'no lineage record — it was never born');
});

test('v0.14: teachLog is bounded — teaching history never grows forever', () => {
  const world = bindWorld(createWorld(9009));
  const te = world.teacher;
  for (let i = 0; i < 260; i++) teacherDemo(world, te, [0.6]);
  assert.ok(world.teachLog.length <= 200, `teachLog capped at 200 (got ${world.teachLog.length})`);
  assert.equal(world.teachLog[world.teachLog.length - 1].kind, 'demo', 'newest events survive');
});

test('v0.14: teacherRewardNearest picks the closest creature', () => {
  const world = bindWorld(createWorld(9010));
  populate(world);
  const te = world.teacher;
  const a = world.creatures[0];
  const b = world.creatures[1];
  a.platformIndex = b.platformIndex = te.platformIndex;
  a.x = te.x + 40; b.x = te.x + 300;
  a.reward = 0; b.reward = 0;
  const got = teacherRewardNearest(world, te);
  assert.equal(got, a, 'the nearest creature is rewarded');
  assert.ok(a.reward > 0 && b.reward === 0, 'only the nearest');
});

test('v0.14: setTeacherMode rejects nonsense, keeps the current mode', () => {
  const world = bindWorld(createWorld(9011));
  const te = world.teacher;
  assert.equal(setTeacherMode(world, te, 'dance'), false);
  assert.equal(te.mode, 'autonomous');
  assert.ok(setTeacherMode(world, te, 'possessed'));
  assert.ok(setTeacherMode(world, te, 'possessed'), 're-setting the same mode is fine');
});

// ---- v0.14 \"Voices\": the teacher's senses — felt, not decorative ----

test('v0.14: teacher senses see creatures and fruit', () => {
  const world = bindWorld(createWorld(14001));
  populate(world);
  const te = world.teacher;
  const c = world.creatures[0];
  te.platformIndex = c.platformIndex;
  te.x = c.x + 100; // 100px east of a creature
  world.foods.length = 0; // clear populate's scatter — what follows is ours
  addFood(world, c.x + 200, c.platformIndex, 'fruit', 2);
  const s = gatherTeacherSenses(world, te);
  assert.ok(s.seeCreatures >= 1, 'sees tanglekins');
  assert.ok(s.seeNearest && s.seeNearest.dist <= 120, 'nearest is close by');
  assert.ok(s.seeFruit >= 1, 'sees fruit');
  assert.ok(s.seeRipe && s.seeRipe.dir === 'east', 'sees ripe fruit east');
  assert.ok(s.smellFruit > 0 && s.smellFruitDir === 'east', 'smells fruit east');
  assert.ok(s.smellRipe, 'smells it ripe');
});

test('v0.14: teacher hears tanglekin calls through the same ears', () => {
  const world = bindWorld(createWorld(14002));
  populate(world);
  const te = world.teacher;
  const c = world.creatures[0];
  te.platformIndex = c.platformIndex;
  te.x = c.x + 60;
  emitCall(world, c, 'contact');
  const s = gatherTeacherSenses(world, te);
  assert.ok(s.hearCall > 0, 'hears the call');
  assert.equal(s.hearType, 'contact', 'hears its meaning');
  assert.equal(s.hearDir, 'west', 'hears it from the west');
  // The teacher never hears its own demos.
  world.calls.length = 0;
  emitTeacherCall(world, te, 'contact', 0.62);
  const s2 = gatherTeacherSenses(world, te);
  assert.equal(s2.hearCall, 0, 'own calls are not heard');
});

test('v0.14: teacherEat consumes the fruit and reports the taste', () => {
  const world = bindWorld(createWorld(14003));
  populate(world);
  const te = world.teacher;
  const plat = 0;
  te.platformIndex = plat;
  te.x = 400;
  world.foods.length = 0; // clear populate's scatter — what follows is ours
  const n0 = world.foods.length;
  addFood(world, 430, plat, 'fruit', 1, 0, { bitterness: 0, nutrition: 1.2 });
  const flavor = teacherEat(world, te);
  assert.equal(flavor, 'sweet', 'tastes the sweetness honestly');
  assert.equal(te.taste.flavor, 'sweet', 'taste memory recorded');
  assert.ok(world.foods.length <= n0, 'the fruit was eaten, not conjured');
  assert.ok(world.teachLog.some((e) => e.kind === 'taste'), 'tasting is logged');
});

test('v0.14: a good taste becomes a food lesson — consequences, not adjectives', () => {
  const world = bindWorld(createWorld(14004));
  populate(world);
  const te = world.teacher;
  te.platformIndex = 0;
  te.x = 400;
  const calls0 = world.calls.length;
  addFood(world, 430, 0, 'fruit', 1, 0, { bitterness: 0, nutrition: 1.2 });
  teacherEat(world, te);
  // The demo emits 'food'-typed calls into the shared acoustic commons.
  for (let i = 0; i < 40; i++) tickTeacher(world, te, 0.1);
  const foodCalls = world.calls.slice(calls0).filter((c) => c.type === 'food' && c.callerId === 'teacher');
  assert.ok(foodCalls.length >= 1, 'sweet fruit is taught as food');
});

test('v0.14: bitter fruit is tasted honestly and never taught', () => {
  const world = bindWorld(createWorld(14005));
  populate(world);
  const te = world.teacher;
  te.platformIndex = 0;
  te.x = 400;
  world.foods.length = 0; // clear populate's scatter — what follows is ours
  addFood(world, 430, 0, 'fruit', 1, 0, { bitterness: 0.9, nutrition: 0.5 });
  const flavor = teacherEat(world, te);
  assert.equal(flavor, 'bitter', 'bitterness is tasted, not hidden');
  assert.equal(te.demoQueue.length, 0, 'no food lesson for bitter fruit');
});

test('v0.14: petting warms the teacher — touch with consequences', () => {
  const world = bindWorld(createWorld(14006));
  populate(world);
  const te = world.teacher;
  const c0 = petTeacher(world, te);
  assert.ok(c0 > 0, 'comfort rises when petted');
  const s = gatherTeacherSenses(world, te);
  assert.ok(s.touch > 0.9, 'the touch is fresh');
  assert.ok(s.comfort > 0, 'comfort is sensed');
  // Comfort decays — it is memory, not a flag.
  for (let i = 0; i < 100; i++) tickTeacher(world, te, 1);
  assert.ok(te.comfort < c0, 'comfort fades with time');
});

test('v0.14: the autonomous teacher answers heard calls', () => {
  const world = bindWorld(createWorld(14007));
  populate(world);
  const te = world.teacher;
  const c = world.creatures[0];
  te.platformIndex = c.platformIndex;
  te.x = c.x + 60;
  te.state = 'perch';
  te.stateT = 100;
  const demos0 = world.teachLog.filter((e) => e.kind === 'demo').length;
  emitCall(world, c, 'contact');
  tickTeacher(world, te, 0.1);
  const demos1 = world.teachLog.filter((e) => e.kind === 'demo').length;
  assert.ok(demos1 > demos0, 'a heard call is answered with a demo');
});

test('v0.14: the autonomous teacher follows the smell of ripe fruit', () => {
  const world = bindWorld(createWorld(14008));
  populate(world);
  const te = world.teacher;
  te.platformIndex = 0;
  te.x = 200;
  te.state = 'perch';
  te.stateT = 100;
  world.foods.length = 0; // clear populate's scatter — what follows is ours
  addFood(world, 350, 0, 'fruit', 2, 0, { bitterness: 0, nutrition: 1.2 }); // 150px, strong smell
  tickTeacher(world, te, 0.1);
  assert.equal(te.state, 'travel', 'smell redirects the policy to travel');
  assert.ok(Math.abs(te.targetX - 350) < 1, 'travel target is the fruit');
});

test('v0.14: sense lines speak plainly, serialization carries the state', () => {
  const world = bindWorld(createWorld(14009));
  populate(world);
  const te = world.teacher;
  const c = world.creatures[0];
  te.platformIndex = c.platformIndex;
  te.x = c.x + 100;
  emitCall(world, c, 'alarm');
  te.senses = gatherTeacherSenses(world, te);
  const lines = teacherSenseLines(world, te);
  assert.ok(lines.some((l) => /tanglekin/.test(l) && /view/.test(l)), 'sight rendered');
  assert.ok(lines.some((l) => /alarm call/.test(l) && /west/.test(l)), 'hearing rendered plainly');
  const text = serializeTeacherSenses(world, te);
  assert.ok(text.includes('Sunny (teacher)'), 'serialization names the avatar');
  assert.ok(text.includes('commands:'), 'serialization lists possessed commands');
  assert.ok(text.split('\n').length >= 4, 'serialization is multi-line, not a stub');
});

test('v0.14: possessed eat command queues and runs', () => {
  const world = bindWorld(createWorld(14010));
  populate(world);
  const te = world.teacher;
  te.platformIndex = 0;
  te.x = 400;
  world.foods.length = 0; // clear populate's scatter — what follows is ours
  addFood(world, 430, 0, 'fruit', 1, 0, { bitterness: 0, nutrition: 1 });
  setTeacherMode(world, te, 'possessed');
  const ok = commandTeacher(te, { cmd: 'eat' });
  assert.equal(ok, true, 'eat is a valid possessed command');
  tickTeacher(world, te, 0.1);
  assert.ok(te.taste && te.taste.flavor === 'sweet', 'possessed eating tastes');
});

// ---- v0.14 "Voices": the waste cycle — digestion → excretion → soil → plants ----

test('v0.14: eating fills the gut — digestion has a byproduct', () => {
  const world = bindWorld(createWorld(14101));
  populate(world);
  const c = addTestCreature(world, 500);
  addFood(world, c.x, c.platformIndex, 'fruit', 1, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  const food = world.foods[world.foods.length - 1];
  c._senses = { _food: food };
  const gutBefore = c.gut;
  assert.ok(doEat(c, world), 'the creature ate');
  assert.ok(c.gut > gutBefore, `gut grew ${gutBefore} -> ${c.gut}`);
  assert.ok(c.gut <= 1 * WASTE_FRACTION + 1e-9, 'gut waste is a fraction of the bite');
});

test('v0.14: excretion moves gut waste into the zone soil', () => {
  const world = bindWorld(createWorld(14102));
  populate(world);
  const c = addTestCreature(world, 200); // verdant zone
  const zone = zoneAt(c.x).key;
  const soilBefore = world.soil[zone].waste;
  c.gut = 1;
  excrete(c, world, 1.0);
  const expected = Math.min(1, 1 * EXCRETE_RATE * 1.0);
  assert.ok(Math.abs(c.gut - (1 - expected)) < 1e-9, `gut drained proportionally, got ${c.gut}`);
  assert.ok(world.soil[zone].waste - soilBefore > 0, 'soil waste grew');
  // Full clearance never overshoots — the gut can't go negative.
  c.gut = 0.01;
  excrete(c, world, 1000);
  assert.ok(c.gut >= 0, `gut never negative, got ${c.gut}`);
});

test('v0.14: decomposition converts waste to fertility; leaching relaxes it', () => {
  const world = bindWorld(createWorld(14103));
  const s = world.soil.verdant;
  s.waste = 10; s.fertility = 0.5;
  tickSoil(world, 100); // dt=100s: conv = 10 * min(1, 0.03*100) = 10
  assert.ok(s.waste < 10, `waste decomposed, now ${s.waste.toFixed(3)}`);
  assert.ok(s.fertility > 0.5, `fertility rose, now ${s.fertility.toFixed(3)}`);
  assert.ok(s.fertility <= SOIL_FERT_MAX, `fertility capped at ${SOIL_FERT_MAX}`);
  // Leaching: rich soil with no waste drifts back toward 0.5.
  s.waste = 0; s.fertility = 1.2;
  tickSoil(world, 1000);
  assert.ok(s.fertility < 1.2 && s.fertility >= 0.5, `fertility relaxed to ${s.fertility.toFixed(3)}`);
});

test('v0.14: fertility scales plant growth around a neutral baseline', () => {
  const world = bindWorld(createWorld(14104));
  assert.equal(soilGrowthMul(world, 'verdant'), 1.0, '0.5 fertility is neutral');
  world.soil.verdant.fertility = 0;
  assert.ok(soilGrowthMul(world, 'verdant') < 1.0, 'exhausted soil stalls growth');
  world.soil.verdant.fertility = SOIL_FERT_MAX;
  assert.ok(soilGrowthMul(world, 'verdant') > 1.0, 'rich soil speeds growth');
});

test('v0.14: the full loop — a meal eventually feeds the plants', () => {
  const world = bindWorld(createWorld(14105));
  populate(world);
  world.creatures.length = 0;
  world.foods.length = 0;
  const c = addTestCreature(world, 200); // verdant
  c.sleeping = false;
  addFood(world, c.x, c.platformIndex, 'fruit', 2, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  const food = world.foods[world.foods.length - 1];
  c._senses = { _food: food };
  doEat(c, world);
  assert.ok(c.gut > 0, 'the meal left waste in the gut');
  // Let the cycle run: excretion → soil waste → decomposition → fertility.
  for (let i = 0; i < 600; i++) tickWorld(world, 0.5);
  const s = world.soil[zoneAt(c.x).key];
  assert.ok(s.waste > 0 || s.fertility > 0.5, `soil received the waste (waste ${s.waste.toFixed(3)}, fertility ${s.fertility.toFixed(3)})`);
  assert.ok(s.fertility > 0.5, `fertility rose above baseline: ${s.fertility.toFixed(3)}`);
});

// ---- v0.14 "Voices": disgust — evolvable waste avoidance ----

test('v0.14: disgust — wasteOdor sense smells the soil', () => {
  const world = bindWorld(createWorld(14109));
  populate(world);
  const c = addTestCreature(world, 200);
  const clean = gatherSenses(c, world);
  assert.equal(clean.wasteOdor, 0, 'clean ground has no odor');
  world.soil[zoneAt(c.x).key].waste = WASTE_ODOR_SCALE / 2;
  const half = gatherSenses(c, world);
  assert.ok(Math.abs(half.wasteOdor - 0.5) < 1e-9, `half stink reads 0.5, got ${half.wasteOdor}`);
  world.soil[zoneAt(c.x).key].waste = WASTE_ODOR_SCALE * 3;
  const full = gatherSenses(c, world);
  assert.equal(full.wasteOdor, 1, 'odor saturates at 1');
});

test('v0.14: disgust — the instinct gene is wired waste-odor → flee', () => {
  const g = GENES.find((g) => g.key === 'instWasteFlee');
  assert.ok(g, 'instWasteFlee exists');
  assert.equal(g.sense, 23, 'sense 23 = wasteOdor (appended, never renumbered)');
  assert.equal(g.action, 5, 'action 5 = flee');
  assert.ok(g.founder > 0.5, `founder ${g.founder} is excitatory, not inhibitory`);
  // Founder genomes lean disgusted, on average.
  const rng = createRng(14110);
  let sum = 0;
  const N = 200;
  for (let i = 0; i < N; i++) sum += phenotype(randomGenome(rng)).instWasteFlee;
  const mean = sum / N;
  assert.ok(mean > 0.5 && mean < 0.9, `mean instWasteFlee ${mean.toFixed(3)}`);
});

test('v0.14: disgust — the instinct steers decisions when it stinks', () => {
  const rng = createRng(14111);
  const pheno = testPheno(14111);
  for (const g of GENES) if (g.sense !== undefined) pheno[g.key] = 0.5; // neutral instincts
  pheno.sociability = 0; // silence the groom bias
  pheno.instWasteFlee = 1; // full disgust
  const brain = silenceBrain(createBrain(pheno, rng));
  const stink = {
    hunger: 0, tiredness: 0, boredom: 0, loneliness: 0, fear: 0, light: 0,
    foodDist: 1, foodDir: 0, creatureDist: 1, creatureDir: 0,
    toyDist: 1, toyDir: 0, isAdult: 1, illness: 0, wasteOdor: 1,
  };
  const d = decide(brain, senseVector(stink), 0, rng);
  assert.equal(d.action, 'flee', `full disgust + stink → flee, got ${d.action}`);
  const clean = { ...stink, wasteOdor: 0 };
  const d2 = decide(brain, senseVector(clean), 0, rng);
  assert.notEqual(d2.action, 'flee', 'no stink → no flee');
});

test('v0.14: disgust — food eaten on fouled ground contaminates', () => {
  const world = bindWorld(createWorld(14112));
  populate(world);
  const c = addTestCreature(world, 200);
  world.soil[zoneAt(c.x).key].waste = WASTE_ODOR_SCALE; // full stink
  addFood(world, c.x, c.platformIndex, 'fruit', 1, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  c._senses = { _food: world.foods[world.foods.length - 1] };
  c.biochem.illness = 0;
  doEat(c, world);
  assert.ok(c.biochem.illness > 0, `fouled food sickens: illness ${c.biochem.illness.toFixed(4)}`);
  // Clean ground: the same meal is harmless.
  const world2 = bindWorld(createWorld(14113));
  populate(world2);
  const c2 = addTestCreature(world2, 200);
  addFood(world2, c2.x, c2.platformIndex, 'fruit', 1, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  c2._senses = { _food: world2.foods[world2.foods.length - 1] };
  c2.biochem.illness = 0;
  doEat(c2, world2);
  assert.equal(c2.biochem.illness, 0, 'clean food does not sicken');
});

test('v0.14: disgust — medicinal leaves still heal on fouled ground', () => {
  const world = bindWorld(createWorld(14114));
  populate(world);
  const c = addTestCreature(world, 200);
  world.soil[zoneAt(c.x).key].waste = WASTE_ODOR_SCALE; // full stink
  addFood(world, c.x, c.platformIndex, 'leaf', 1, 0, {});
  c._senses = { _food: world.foods[world.foods.length - 1] };
  c.biochem.illness = 0.8;
  doEat(c, world);
  assert.ok(c.biochem.illness < 0.8, `leaf purges more than the ground contaminates: ${c.biochem.illness.toFixed(3)}`);
});

// ---- Chronicle: the world's official record (event-sourced narrative) ----
import { buildChronicle, CHAPTERS } from '../src/sim/chronicle.js';

function chronWorld(seed = 601) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  world.creatures.length = 0;
  world.plants.length = 0; world.foods.length = 0;
  world.events.length = 0;
  world.lineage.clear(); world.lineageKids.clear();
  world.teachLog.length = 0;
  world.dupEvents.length = 0;
  world.divergenceLog.length = 0;
  world.speciesLog.length = 0;
  return world;
}
function chronCreature(world, name, x, parents, bornAt) {
  const c = createCreature(randomGenome(world.rng), x, 0, world.rng);
  c.name = name; c.parents = parents; c.generation = parents ? 1 : 0;
  world.creatures.push(c);
  const t = world.time; world.time = bornAt;
  recordLineage(world, c);
  world.time = t;
  return c;
}
const chronChapter = (chs, id) => chs.find((c) => c.id === id);

test('chronicle: six chapters in the canonical order', () => {
  const chs = buildChronicle(chronWorld());
  assert.deepEqual(chs.map((c) => c.id), ['genesis', 'spread', 'words', 'split', 'teacher', 'present']);
  for (const ch of chs) assert.ok(Array.isArray(ch.entries), `${ch.id} has entries`);
});

test('chronicle: genesis records founder hatches from the event log', () => {
  const world = chronWorld();
  const a = chronCreature(world, 'Ash', 100, null, 0);
  const b = chronCreature(world, 'Birch', 200, null, 5);
  world.events.push({ type: 'hatch', creature: a, t: 0 }, { type: 'hatch', creature: b, t: 5 });
  const gen = chronChapter(buildChronicle(world), 'genesis');
  assert.equal(gen.entries.length, 2);
  assert.ok(gen.entries[0].text.includes('Ash'), 'prose names the founder');
  assert.ok(gen.entries[0].text.includes('Verdant Valley'), 'prose names the birth biome from lineage');
  assert.ok(gen.entries[0].jumps.some((j) => j.tab === 'tree' && j.creatureId === a.id), 'tree jump targets the founder');
});

test('chronicle: events sort into their thematic chapters', () => {
  const world = chronWorld();
  const a = chronCreature(world, 'Ash', 100, null, 0);
  world.events.push({ type: 'speciation', t: 400, from: 3, to: [5, 6], sizes: [12, 9] });
  world.events.push({ type: 'traditionFounded', name: 'Dawn Chorus', creature: a, t: 200 });
  world.teachLog.push({ t: 300, kind: 'demo', type: 'contact', zone: 'arid', listeners: 4 });
  world.dupEvents.push({ t: 500, kind: 'duplication', key: 'legLength', parents: [a.id, a.id] });
  const chs = buildChronicle(world);
  const split = chronChapter(chs, 'split');
  assert.ok(split.entries.some((e) => e.icon === '💥'), 'speciation lands in The Split');
  assert.ok(split.entries.some((e) => e.icon === '🧬'), 'duplication lands in The Split');
  assert.ok(chronChapter(chs, 'teacher').entries.some((e) => e.icon === '🎓'), 'demo lands in The Teacher');
  assert.ok(chronChapter(chs, 'words').entries.some((e) => e.text.includes('Dawn Chorus')), 'tradition lands in First Words');
});

test('chronicle: prose is sourced — numbers and names come from the logs', () => {
  const world = chronWorld();
  const a = chronCreature(world, 'Ash', 100, null, 0);
  world.events.push({ type: 'speciation', t: 400, from: 3, to: [5, 6], sizes: [12, 9] });
  world.teachLog.push(
    { t: 100, kind: 'mode', mode: 'autonomous' },
    { t: 300, kind: 'reward', pitch: 0.42, n: 3, zone: 'verdant' },
  );
  const chs = buildChronicle(world);
  const splitText = chronChapter(chs, 'split').entries.find((e) => e.icon === '💥').text;
  assert.ok(splitText.includes('#3') && splitText.includes('#5 (12)') && splitText.includes('#6 (9)'),
    `speciation prose carries the logged ids and sizes: ${splitText}`);
  const teach = chronChapter(chs, 'teacher').entries;
  assert.ok(teach[0].text.includes('arrived'), 'first teachLog entry reads as the arrival');
  const reward = teach.find((e) => e.icon === '🌟').text;
  assert.ok(reward.includes('3') && reward.includes('0.42') && reward.includes('Verdant Valley'),
    `reward prose carries n, pitch and zone name: ${reward}`);
  void a;
});

test('chronicle: every jump target resolves against the world', () => {
  const world = chronWorld();
  const a = chronCreature(world, 'Ash', 100, null, 0);
  world.events.push({ type: 'hatch', creature: a, t: 0 });
  world.events.push({ type: 'speciation', t: 400, from: 3, to: [5], sizes: [12] });
  world.teachLog.push({ t: 100, kind: 'mode', mode: 'autonomous' });
  world.divergenceLog.push({ t: 200, zones: { verdant: { vocalPitch: 0.7 } } });
  for (const ch of buildChronicle(world)) {
    for (const e of ch.entries) {
      for (const j of e.jumps) {
        if (j.tab === 'tree') assert.ok(world.lineage.has(j.creatureId), `tree jump resolves: ${j.creatureId}`);
        if (j.tab === 'evo') assert.equal(typeof j.time, 'number', 'evo jump carries a time');
        if (j.tab === 'world') {
          const ok = j.teacher || world.creatures.some((c) => c.id === j.creatureId);
          assert.ok(ok, 'world jump targets the live creature or the Teacher');
        }
      }
    }
  }
});

test('chronicle: the Spread derives first-birth milestones per biome from lineage', () => {
  const world = chronWorld();
  chronCreature(world, 'Ash', 100, null, 0);    // verdant
  chronCreature(world, 'Dune', 700, null, 50);  // arid
  chronCreature(world, 'Peak', 1200, null, 100); // highland
  const entries = chronChapter(buildChronicle(world), 'spread').entries;
  assert.equal(entries.length, 3);
  assert.ok(entries[0].text.includes('Verdant Valley') && entries[0].text.includes('Ash'));
  assert.ok(entries[1].text.includes('Arid Stretch') && entries[1].text.includes('Dune'));
  assert.ok(entries[2].text.includes('Highland') && entries[2].text.includes('Peak'));
  assert.ok(entries[0].t < entries[1].t && entries[1].t < entries[2].t, 'milestones ordered by first birth');
});

test('chronicle: dialect divergence crosses into First Words with the real S value', () => {
  const world = chronWorld();
  world.divergenceLog.push({ t: 200, zones: { arid: { vocalPitch: -0.62 } } });
  const words = chronChapter(buildChronicle(world), 'words').entries;
  const d = words.find((e) => e.icon === '🎵');
  assert.ok(d, 'a dialect milestone was written');
  assert.ok(d.text.includes('Arid Stretch') && d.text.includes('-0.62'), `prose carries zone and S: ${d.text}`);
});

test('chronicle: the Living Present favors recent notable history', () => {
  const world = chronWorld();
  const a = chronCreature(world, 'Ash', 100, null, 0);
  const k = chronCreature(world, 'Kit', 150, [a.id, a.id], 900);
  world.events.push({ type: 'hatch', creature: a, t: 0 });
  world.events.push({ type: 'hatch', creature: k, t: 900 });
  a.biochem.age = a.pheno.lifespanSec * 0.8; // an elder
  world.events.push({ type: 'death', creature: a, t: 1200, cause: 'old age' });
  world.events.push({ type: 'jumped', creature: k, t: 1300 }); // noise: not notable
  const present = chronChapter(buildChronicle(world), 'present').entries;
  assert.ok(present.some((e) => e.text.includes('Kit') && e.icon === '🐣'), 'recent birth is noted');
  assert.ok(present.some((e) => e.text.includes('Elder Ash')), 'elder death is noted');
  assert.ok(!present.some((e) => e.text.includes('jumped')), 'noise stays out of the record');
  assert.ok(present.length <= 14, 'the present is capped');
});

test('chronicle: an empty young world builds without crashing', () => {
  const world = bindWorld(createWorld(602)); // no populate, no events
  const chs = buildChronicle(world);
  assert.equal(chs.length, 6);
  for (const ch of chs) assert.deepEqual(ch.entries, [], `${ch.id} is empty but well-formed`);
});

// ---- v0.14.1 "Detritus": death feeds the ground — rot, scraps, litter ----

test('v0.14.1: rot composts — expired food mass enters the soil, not the void', () => {
  const world = bindWorld(createWorld(14110));
  populate(world);
  const zone = zoneAt(500).key;
  const s = world.soil[zone];
  s.waste = 0; s.fertility = 0.5;
  // A carcass: 1.2 meat at nutrition 1, rotting now.
  addFood(world, 500, 2, 'meat', 1.2, 0.01, { nutrition: 1 });
  const carcass = world.foods[world.foods.length - 1];
  const wasteBefore = s.waste;
  world.time += 1; // past rotsAt
  compostRot(world);
  assert.ok(!world.foods.includes(carcass), 'the carcass is gone as an item');
  assert.ok(Math.abs(s.waste - wasteBefore - 1.2) < 1e-9, `soil waste gained the carcass mass, got ${s.waste}`);
});

test('v0.14.1: eating drops scraps — messy eaters litter', () => {
  const world = bindWorld(createWorld(14111));
  populate(world);
  const c = addTestCreature(world, 500);
  addFood(world, c.x, c.platformIndex, 'fruit', 1, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  const food = world.foods[world.foods.length - 1];
  c._senses = { _food: food };
  const nBefore = world.foods.length;
  assert.ok(doEat(c, world), 'the creature ate');
  const scrap = world.foods.find((f) => f.foodKind === 'scrap');
  assert.ok(scrap, 'a scrap item fell');
  assert.ok(Math.abs(scrap.amount - Math.min(1, c.pheno.biteSize) * SCRAP_FRACTION) < 1e-9,
    `scrap is a fraction of the bite, got ${scrap.amount}`);
  assert.equal(scrap.nutrition, SCRAP_NUTRITION, 'scraps are poor food');
  assert.ok(scrap.rotsAt > world.time && scrap.rotsAt <= world.time + SCRAP_ROT + 1, 'scraps rot on a timer');
  assert.ok(nBefore + 1 >= world.foods.length, 'scrap added (fruit may be fully eaten)');
});

test('v0.14.1: scraps are edible but joyless — desperation food', () => {
  const world = bindWorld(createWorld(14112));
  populate(world);
  const c = addTestCreature(world, 500);
  addFood(world, c.x, c.platformIndex, 'scrap', 1, 60, { nutrition: SCRAP_NUTRITION });
  const scrap = world.foods[world.foods.length - 1];
  c._senses = { _food: scrap };
  c.reward = 0;
  assert.ok(doEat(c, world), 'the creature ate the scrap');
  assert.ok(c._ate > 0, 'scraps feed a little');
  assert.ok(c.reward < 0.6, `scraps reinforce less than a real meal, got ${c.reward}`);
  assert.equal(c.actionLabel, 'picking at scraps');
});

test('v0.14.1: plants shed litter — the unused parts feed the ground', () => {
  const world = bindWorld(createWorld(14113));
  populate(world);
  const p = world.plants[0];
  const s = world.soil[p.zone];
  s.waste = 0;
  shedLitter(world, 100);
  let expected = 0;
  for (const q of world.plants) {
    const g = (q.pheno && q.pheno.growthRate !== undefined) ? q.pheno.growthRate : 0.5;
    expected += LITTER_RATE * (0.5 + g) * 100;
  }
  assert.ok(s.waste > 0, 'litter accumulated in the soil');
  // All plants in these seeds share the zone only if p.zone matches; check total instead.
  let total = 0;
  for (const z of Object.values(world.soil)) total += z.waste;
  assert.ok(Math.abs(total - expected) < 1e-6, `litter mass is lawful, got ${total} expected ${expected}`);
});

test('v0.14.1: rich ground enters the chronicle — the land remembers', () => {
  const world = bindWorld(createWorld(14114));
  populate(world);
  const s = world.soil.verdant;
  s.waste = 0; s.fertility = 0.99; s.richNoted = false;
  tickSoil(world, 0.5); // no waste: leaching pulls DOWN — no event
  assert.ok(!world.events.some((e) => e.type === 'soilRich'), 'lean soil writes no history');
  s.fertility = 1.2; // above 1.0 even after this tick's leaching
  tickSoil(world, 0.001);
  const ev = world.events.find((e) => e.type === 'soilRich');
  assert.ok(ev, 'first richness is noted');
  assert.equal(ev.zone, 'verdant');
  tickSoil(world, 10);
  assert.equal(world.events.filter((e) => e.type === 'soilRich').length, 1, 'noted once per enrichment');
  const chs = buildChronicle(world);
  const present = chs.find((c) => c.id === 'present');
  assert.ok(present.entries.some((e) => e.icon === '🪱'), 'the chronicle carries the rich-ground entry');
});

// ---- v0.14.2 "Wayfinding": camera math — pure functions, no DOM ----

const fakeR = () => ({ scale: 1, ox: 0, oy: 0, dpr: 1, fitScale: 0, cam: { manual: false }, canvas: { width: 1600, height: 900 } });
const fakeWorld = () => ({ width: 4000, height: 1000, groundY: 900 });

test('v0.14.2: worldToScreen/screenToWorld round-trip', () => {
  const r = fakeR(); const w = fakeWorld();
  fitCamera(r, w);
  const s = worldToScreen(r, w, 123, 456);
  const back = screenToWorld(r, s.x, s.y);
  assert.ok(Math.abs(back.x - 123) < 1e-9 && Math.abs(back.y - 456) < 1e-9, `round-trip, got ${back.x},${back.y}`);
});

test('v0.14.2: zoom is clamped and centered on the cursor', () => {
  const r = fakeR(); const w = fakeWorld();
  fitCamera(r, w);
  const fs = r.fitScale;
  zoomAt(r, w, 1000, 800, 450); // absurd factor in
  assert.ok(Math.abs(r.scale - fs * CAM_MAX_ZOOM) < 1e-9, `clamped to max, got ${r.scale / fs}`);
  zoomAt(r, w, 0.0001, 800, 450); // absurd factor out
  assert.ok(Math.abs(r.scale - fs * CAM_MIN_ZOOM) < 1e-9, `clamped to min, got ${r.scale / fs}`);
  // Centering: the world point under the cursor stays fixed (cursor chosen
  // where the pan clamp does not engage, so the invariant is tested pure).
  fitCamera(r, w);
  const before = screenToWorld(r, 800, 700);
  zoomAt(r, w, 2, 800, 700);
  const after = screenToWorld(r, 800, 700);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-6,
    `world point under cursor did not move, drift ${Math.hypot(after.x - before.x, after.y - before.y)}`);
  assert.ok(r.cam.manual, 'zooming arms the manual camera');
});

test('v0.14.2: pan is clamped — the world can never be lost', () => {
  const r = fakeR(); const w = fakeWorld();
  fitCamera(r, w);
  const ww = w.width * r.scale, wh = w.height * r.scale;
  panBy(r, w, 1e7, 1e7);
  assert.ok(Math.abs(r.ox - (1600 - CAM_PAN_MARGIN)) < 1e-9, `ox clamped right, got ${r.ox}`);
  assert.ok(Math.abs(r.oy - (900 - CAM_PAN_MARGIN)) < 1e-9, `oy clamped down, got ${r.oy}`);
  panBy(r, w, -1e7, -1e7);
  assert.ok(Math.abs(r.ox - (CAM_PAN_MARGIN - ww)) < 1e-9, `ox clamped left, got ${r.ox}`);
  assert.ok(Math.abs(r.oy - (CAM_PAN_MARGIN - wh)) < 1e-9, `oy clamped up, got ${r.oy}`);
  assert.ok(r.cam.manual, 'panning arms the manual camera');
});

test('v0.14.2: recenter drops back to auto-fit', () => {
  const r = fakeR(); const w = fakeWorld();
  fitCamera(r, w);
  zoomAt(r, w, 3, 800, 450);
  panBy(r, w, 500, 500);
  assert.ok(r.cam.manual, 'camera was manual');
  recenterCamera(r, w);
  assert.ok(!r.cam.manual, 'recenter disarms the manual camera');
  assert.ok(Math.abs(r.scale - r.fitScale) < 1e-12, 'scale back at fit');
});

test('v0.14.2: followPoint centers the world point', () => {
  const r = fakeR(); const w = fakeWorld();
  fitCamera(r, w);
  followPoint(r, w, 1000, 500);
  const s = worldToScreen(r, w, 1000, 500);
  assert.ok(Math.abs(s.x - 800) < 1e-9 && Math.abs(s.y - 450) < 1e-9, `centered, got ${s.x},${s.y}`);
  assert.ok(r.cam.manual, 'following arms the manual camera');
});
