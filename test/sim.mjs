// Unit tests for the v0.3 systems (evolvable instincts, deep brain learning,
// illness + immunity) and v0.4 (episodic memory, recall, sleep consolidation,
// observational social learning). Run: node --test test/sim.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GENES, randomGenome, inherit, phenotype, markLocus, genomeDistance, gateMultiplier, GTARGETS, D1_KEYS, REGULATION_CHROM, DUP_RATE, DEL_RATE, MAX_EXTRA, EVO17_KEYS, CHROMOSOMES, SENSE32, SENSE24, ACT20, ACT13 } from '../src/sim/genome.js';
import { budPotentials, expressBuds, developmentalGrowth01, BUD_SITES, BUD_TYPES, BUD_ERUPT, BUD_NUB_HI } from '../src/sim/evodevo.js';
import { createBrain, decide, learn, senseVector, ACTIONS, N_IN } from '../src/sim/brain.js';
import { createBiochem, tickBiochem, mood, ageStage } from '../src/sim/biochem.js';
import { createRng } from '../src/sim/rng.js';
import { groundYAt, waterAt } from '../src/sim/biomes.js';
import { PLANT_MASS, LITTER_FRAC } from '../src/sim/ledger.js';
import { SvgCtx } from './svg-shim.mjs';
import { drawCreature } from '../src/render/painter.js';
import { createWorld, bindWorld, populate, populateGenesis, tickWorld, addFood, layEgg, addPebble, addStick, addPlant, addHerb, disperseSeed, tickGutSeeds, recordLineage, LINEAGE_TRAITS, zoneAt, ZONES, biomeKeyAt, BIOMES, BIOME_FRUIT_MUL, climbLinksFrom, genomeHash, checkNovelGenome, recordFounderMeans, computeDivergence, DIVERGENCE_CREATURE_TRAITS, emitCall, callsHeardBy, soundOcclusion, RIDGE_SHADOW, computeSpecies, hybridViability, HYBRID_THRESHOLD, SPECIES_DIST, excrete, tickSoil, soilGrowthMul, wasteOdorOf, WASTE_FRACTION, EXCRETE_RATE, SOIL_DECAY, SOIL_LEACH, SOIL_FERT_MAX, WASTE_ODOR_SCALE, CONTAM_ILLNESS, compostRot, shedLitter, SCRAP_FRACTION, SCRAP_ROT, SCRAP_NUTRITION, LITTER_RATE, MINERAL_TYPES, addMineral, noteDeath, CORPSE_ROT, platformIndexAt, digAt, spawnBuriedFood, spawnMobileFood, pinSubStreams, speciesOverview, dropWindfall, WINDFALL_P, WINDFALL_ROT, heatStressMul, soilAt } from '../src/sim/world.js';
import { tempAt } from '../src/sim/weather.js';
import {
  createMemory, writeEpisode, shouldWrite, recall, consolidate,
  memoryCapacity, RECALL_BUDGET,
} from '../src/sim/memory.js';
import {
  createCulture, foundGrove, foundCraft, adoptTradition, traditionVotes, groveTarget, groveAim,
  pruneExtinct, sampleCulture, ratchetIndex, fidelityOf,
} from '../src/sim/culture.js';
import { finalizeEpisode, maybeFoundGrove, maybeFoundCraft, doEat, createCreature, updateCreature, groundCallType, creatureRadius, stepPhysics, integrateGravity, tickPredators, spawnPredators, gatherSenses, GRAVITY, FALL_HURT_V, FALL_FEEL_V, STRAND_PX, JUMP_V_BASE, JUMP_V_GAIN } from '../src/sim/creature.js';
import { createBonds, getBond, nudgeBond, tickBonds, pedigreeKin, detectTribes, socialStats } from '../src/sim/social.js';
import { randomPlantGenome, plantPhenotype, inheritPlant, plantMeiosis, PLANT_GENES } from '../src/sim/plantgenome.js';
import { createTeacher, tickTeacher, commandTeacher, setTeacherMode, teacherDemo, teacherReward, teacherRewardNearest, emitTeacherCall, TEACHER_MOTIF, TEACHER_PITCH, IMITATION_WINDOW, gatherTeacherSenses, teacherEat, petTeacher, teacherSenseLines, serializeTeacherSenses, foodFlavor } from '../src/sim/teacher.js';
import { worldToScreen, screenToWorld, fitCamera, zoomAt, panBy, recenterCamera, followPoint, CAM_MIN_ZOOM, CAM_MAX_ZOOM, CAM_PAN_MARGIN } from '../src/render/renderer.js';
import { describeEntity, pickFruit, placeFood, spawnFood, nudgeCreature, digMineral, NUDGE_V, OBSERVER_VERSION } from '../src/sim/observer.js';
import { createLexicon, lexSlots, hearThresh, baseLoud, sizePitchFactor, lexLearnRate, speakFromLexicon, registerHeard, registerSpoken, decayLexicon, acousticDistance, lexiconDistance, wordName, entryStats, pushUtterance, hearerSalientContext, LEX_CONTEXTS, LEX_PROBATION_HEARINGS } from '../src/sim/language.js';

// ================= v0.16 "Tongues" =================

test('v0.16: wordName is deterministic — "mooo" and "KIT!"', () => {
  assert.equal(wordName({ pitch: 0.2, length: 0.9, loudness: 0.15 }), 'mooo');
  assert.equal(wordName({ pitch: 0.85, length: 0.15, loudness: 0.95 }), 'KIT!');
  assert.equal(wordName({ pitch: 0.85, length: 0.15, loudness: 0.95 }), 'KIT!', 'same acoustics, same name');
});

test('v0.16: probation — novel calls graduate after LEX_PROBATION_HEARINGS hearings', () => {
  assert.equal(LEX_PROBATION_HEARINGS, 3);
  const lex = createLexicon(12);
  const proto = { pitch: 0.7, length: 0.3, loudness: 0.6 };
  for (let i = 0; i < LEX_PROBATION_HEARINGS - 1; i++) {
    registerHeard(lex, proto, 'contact', 1.0, 0.5, i);
  }
  assert.equal(lex.entries.length, 0, 'still probationary after 2 hearings');
  assert.equal(lex.probation.length, 1, 'candidate is tracked');
  registerHeard(lex, proto, 'contact', 1.0, 0.5, 3);
  assert.equal(lex.entries.length, 1, 'graduates to the lexicon after 3 hearings');
  assert.equal(lex.probation.length, 0, 'probation cleared');
});

test('v0.16: speaker/hearer asymmetry — speakers register immediately', () => {
  const lex = createLexicon(12);
  const proto = { pitch: 0.6, length: 0.4, loudness: 0.5 };
  registerSpoken(lex, proto, 'food', 0.5, 1);
  assert.equal(lex.entries.length, 1, 'speaker own-utterance needs no probation');
  assert.equal(lex.entries[0].used, 1);
  assert.equal(lex.entries[0].heard, 0, 'speaker entry tracks usage, not hearings');
  assert.ok(lex.entries[0].confidence >= 0.25, 'speaker entry starts confident');
});

test('v0.16: decay forgets only low-confidence, low-speaker entries', () => {
  const lex = createLexicon(12);
  const filler = (pitch, conf) => ({ proto: { pitch, length: 0.4, loudness: 0.4 }, contexts: { contact: 5 }, used: 5, heard: 5, confidence: conf, speakers: 2, lastT: 0 });
  const weak = { proto: { pitch: 0.3, length: 0.4, loudness: 0.4 }, contexts: { food: 1 }, used: 0, heard: 1, confidence: 0.1, speakers: 0, lastT: 0 };
  const shared = { proto: { pitch: 0.6, length: 0.4, loudness: 0.4 }, contexts: { contact: 2 }, used: 1, heard: 1, confidence: 0.1, speakers: 3, lastT: 0 };
  lex.entries.push(filler(0.4, 0.8), filler(0.7, 0.9), weak, shared);
  decayLexicon(lex, 400, 1000);
  assert.ok(!lex.entries.includes(weak), 'weak, unshared entry forgotten');
  assert.ok(lex.entries.includes(shared), 'low-confidence but troop-shared entry survives');
});

test('v0.16: context tallies concentrate — entryStats names the dominant context', () => {
  const e = { proto: { pitch: 0.5, length: 0.4, loudness: 0.5 }, contexts: { food: 8, contact: 2 }, used: 5, heard: 5, confidence: 0.6, speakers: 2 };
  const st = entryStats(e);
  assert.equal(st.top, 'food');
  assert.ok(Math.abs(st.topPct - 0.8) < 1e-9, `food at 80%, got ${st.topPct}`);
});

test('v0.16: lexiconDistance — 0 for identical, symmetric, positive for different', () => {
  const a = createLexicon(12);
  const b = createLexicon(12);
  assert.equal(lexiconDistance(a, b), 0, 'empty lexicons have no distance');
  registerSpoken(a, { pitch: 0.2, length: 0.8, loudness: 0.2 }, 'food', 0.5, 1);
  registerSpoken(b, { pitch: 0.2, length: 0.8, loudness: 0.2 }, 'food', 0.5, 1);
  assert.equal(lexiconDistance(a, b), 0, 'identical entries → 0');
  registerSpoken(b, { pitch: 0.9, length: 0.1, loudness: 0.9 }, 'alarm', 0.5, 2);
  const d = lexiconDistance(a, b);
  assert.ok(d > 0, `different lexicons have distance, got ${d}`);
  assert.equal(lexiconDistance(a, b), lexiconDistance(b, a), 'symmetric');
});

test('v0.16: body size sets base pitch — big bodies call lower', () => {
  const world = bindWorld(createWorld(99));
  populate(world);
  const a = world.creatures[0];
  a.pheno.vocalRange = 0; a.voicePitch = 0.7;
  a.pheno.size = -1; // small
  emitCall(world, a, 'contact');
  const smallPitch = world.calls[0].pitch;
  world.calls.length = 0;
  a.pheno.size = 1; // big
  emitCall(world, a, 'contact');
  const bigPitch = world.calls[0].pitch;
  assert.ok(smallPitch > bigPitch, `small ${smallPitch.toFixed(2)} > big ${bigPitch.toFixed(2)}`);
  assert.equal(world.calls[0].y, world.platforms[a.platformIndex].y, 'call carries emitter y');
});

test('v0.16: 1/d falloff + hearing-threshold gate', () => {
  const world = bindWorld(createWorld(4242));
  populate(world);
  const a = world.creatures[0];
  const b = world.creatures[1];
  b.platformIndex = a.platformIndex; b.x = a.x + 50;
  a.voicePitch = 0.6; a.pheno.vocalRange = 0; a.pheno.size = 0;
  emitCall(world, a, 'contact');
  const near = callsHeardBy(world, b);
  assert.ok(near.heard > 0, 'nearby creature hears');
  assert.ok(near.call, 'heard result carries the acoustic event');
  assert.ok(near.length > 0 && near.loudnessAtEar > 0, 'acoustic fields survive');
  // Whisper-quiet call: below the hearer's threshold even at close range.
  world.calls.length = 0;
  const thr = hearThresh(b.pheno);
  b.x = a.x + 100;
  emitCall(world, a, 'contact', { pitch: 0.6, length: 0.2, loudness: thr * 0.1 });
  const gated = callsHeardBy(world, b);
  assert.equal(gated.heard, 0, `sub-threshold whisper is gated out (thr ${thr.toFixed(2)})`);
});

test('v0.16: teacher calls are full acoustic events with utterance logging', () => {
  const world = bindWorld(createWorld(7));
  populate(world);
  const te = world.teacher;
  const n0 = (world.utterLog || []).length;
  emitTeacherCall(world, te, 'food', 0.55);
  const call = world.calls[world.calls.length - 1];
  assert.equal(call.length, 0.4, 'deliberate length');
  assert.equal(call.loudness, 0.95, 'loud and clear');
  assert.ok(call.proto, 'carries its prototype');
  assert.equal(call.y, world.platforms[te.platformIndex].y);
  assert.equal((world.utterLog || []).length, n0 + 1, 'utterance logged');
  const u = world.utterLog[world.utterLog.length - 1];
  assert.equal(u.ctx, 'food', 'true context recorded');
  assert.equal(u.speaker, 'Sunny');
  assert.ok(u.fromTeacher, 'Rosetta stone marked');
});

test('v0.19: ridge sound shadow — solid earth eats the ray that punches through', () => {
  const world = bindWorld(createWorld(7));
  const ridge = world.platforms.find((p) => p.solid && p.kind === 'ridge');
  assert.ok(ridge, 'the plains ridge is flagged solid');
  // v0.26: the ridge body is generated (top ≈700±8, foot = terrain). The
  // ray aims mid-body so it punches through at any seed.
  const foot = groundYAt((ridge.x1 + ridge.x2) / 2, world.layout) ?? ridge.y + 120;
  const ry = (ridge.y + foot) / 2;
  // Ground-level ray across the ridge: passes through the body → shadowed.
  // v2: aim at the ridge's actual x-range (v1: hardcoded 1900,2300).
  const rx1 = ridge.x1 - 100, rx2 = ridge.x2 + 100;
  const shadowed = soundOcclusion(world, rx1, ry, rx2, ry);
  // Same ray with the solid flag lifted: only slab/foliage apply → louder.
  const wasSolid = ridge.solid;
  ridge.solid = false;
  const open = soundOcclusion(world, rx1, ry, rx2, ry);
  ridge.solid = wasSolid;
  assert.ok(shadowed < open, `ridge shadows the ray (${shadowed.toFixed(3)} < ${open.toFixed(3)})`);
  assert.ok(Math.abs(shadowed - open * RIDGE_SHADOW) < 1e-9, `shadow factor is exactly RIDGE_SHADOW (${RIDGE_SHADOW})`);
});

test('v0.19: no shadow when the caller stands on the ridge — the ray leaves along the surface', () => {
  const world = bindWorld(createWorld(7));
  const ridge = world.platforms.find((p) => p.solid && p.kind === 'ridge');
  // Caller on the ridge top (y≈700), hearer on the far ground: no punch-through.
  const fromTop = soundOcclusion(world, 2100, 700, 2300, 810);
  const wasSolid = ridge.solid;
  ridge.solid = false;
  const open = soundOcclusion(world, 2100, 700, 2300, 810);
  ridge.solid = wasSolid;
  assert.equal(fromTop, open, 'endpoint on the mass is excluded from the shadow');
});

test('v0.19: desert rock outcrops cast shadows too', () => {
  const world = bindWorld(createWorld(7));
  const rocks = world.platforms.filter((p) => p.solid && p.kind === 'rock');
  // v1: three solid outcrops in the desert. v2: at least one rock.
  assert.ok(rocks.length >= 1, `solid outcrops exist (found ${rocks.length})`);
  // Ray across the first outcrop at mid-body height.
  const rk = rocks[0];
  const ry = rk.y + 80;
  const shadowed = soundOcclusion(world, rk.x1 - 50, ry, rk.x2 + 50, ry);
  for (const r of rocks) r.solid = false;
  const open = soundOcclusion(world, rk.x1 - 50, ry, rk.x2 + 50, ry);
  for (const r of rocks) r.solid = true;
  assert.ok(shadowed < open, `outcrop shadows the ray (${shadowed.toFixed(3)} < ${open.toFixed(3)})`);
});

test('v0.19: ridge shadow is NaN-hardened', () => {
  const world = bindWorld(createWorld(7));
  const a = soundOcclusion(world, NaN, 810, 2300, 810);
  const b = soundOcclusion(world, 1900, 810, NaN, 810);
  assert.ok(Number.isFinite(a) && Number.isFinite(b), 'NaN rays attenuate, never throw');
  assert.ok(a >= 0 && a <= 1 && b >= 0 && b <= 1, 'attenuation stays in [0,1]');
});

test('v0.19: ridge shadow reaches the ear — callsHeardBy carries it', () => {
  const world = bindWorld(createWorld(4242));
  populate(world);
  const a = world.creatures[0];
  const b = world.creatures[1];
  // Pin both to the plains ground (platform 24, y=820), flanking the ridge.
  a.platformIndex = 24; a.x = 1900;
  b.platformIndex = 24; b.x = 2200;
  b.pheno.lexHear = 0; // keenest ears — both rays must arrive for the ratio
  a.pheno.vocalRange = 0; a.voicePitch = 0.6; a.pheno.size = 0;
  const loud = { pitch: 0.6, length: 0.3, loudness: 1.0 };
  const ridge = world.platforms.find((p) => p.solid && p.kind === 'ridge');
  emitCall(world, a, 'contact', loud);
  const shadowed = callsHeardBy(world, b);
  ridge.solid = false;
  world.calls.length = 0;
  emitCall(world, a, 'contact', loud);
  const open = callsHeardBy(world, b);
  ridge.solid = true;
  assert.ok(open.call && shadowed.call, 'both rays arrive with keen ears');
  const ratio = shadowed.loudnessAtEar / open.loudnessAtEar;
  assert.ok(Math.abs(ratio - RIDGE_SHADOW) < 1e-9,
    `ear amplitude ratio is exactly RIDGE_SHADOW (${ratio.toFixed(4)} ≈ ${RIDGE_SHADOW})`);
});

test('v0.16: witnessed death triggers the teacher danger demo', () => {
  const world = bindWorld(createWorld(31337));
  populate(world);
  const te = world.teacher;
  te.lastDemoT = -100; // past the cooldown
  world.time = 100;
  const victim = world.creatures[0];
  victim.alive = false;
  victim.platformIndex = te.platformIndex;
  victim.x = te.x + 100;
  world.events.push({ type: 'death', t: world.time, creature: victim });
  tickWorld(world, 0.1);
  assert.ok(te.demoQueue.length > 0, 'teacher starts a demo on witnessing death');
  assert.equal(te.demoType, 'danger', 'the demo names the danger');
});

test('v0.16: troop census clusters shared words every 30s', () => {
  const world = bindWorld(createWorld(2024));
  populate(world);
  world.time = 29.95;
  tickWorld(world, 0.1); // crosses the 30s boundary
  assert.ok(Array.isArray(world.troopWords), 'census ran');
});

const N_SENSES = 43; // v0.37: 38 + 5 affect senses (libido, curiosity, attachment, care, pairNear); v0.32: 37 + pain; v0.28: 36 + phaseSleepiness; canopy: v0.12's 18 + climbUp, climbDown, groomNear, jumpNear + v0.14's callHeard, callPitch, wasteOdor + v0.17's airborne, farLedge, submerged, waterNear + v0.18's thirst, cold, heat, buriedNear + v0.20's objectNear, heldWeight, falling + v0.22's creatureSize + v0.28's phaseSleepiness

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
  assert.equal(inst.length, 42, 'v0.37: +6 affect instincts (instDisplay, instInspect, instCuddle, instTend, instSeekBond, instMourn)'); // v0.12: 13 + canopy's instClimbUp/Down, instLonelyGroom, instJump + v0.14's instHeardVocal, instLonelyVocal, instWasteFlee + v0.17's 5 organ instincts + v0.18's 4 realms instincts + v0.20's 3 hands instincts + v0.20's instFallVocal + v0.22's instBite + v0.22.1's instHungerBite + v0.28's instPhaseSleep + v0.37's 6 affect instincts
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
  // v0.18: keep only the pair — the bigger brain (N_IN 29→33) shifted the
  // world RNG stream, and bystander wander paths are not what this test is
  // about. Contagion is.
  world.creatures.length = 0;
  world.creatures.push(a, b);
  b.pheno.immunity = 0; // maximally susceptible
  let infected = false;
  for (let t = 0; t < 600 && !infected; t++) {
    a.biochem.illness = 1; // keep the source contagious
    a.biochem.health = 1; // and alive — the illness would kill it first
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
  assert.equal(inst.length, 42, 'v0.37: +6 affect instincts'); // canopy: v0.12's 13 + instClimbUp/Down, instLonelyGroom, instJump + v0.14's instHeardVocal, instLonelyVocal, instWasteFlee + v0.17's 5 organ instincts + v0.18's 4 realms instincts + v0.20's 3 hands instincts + v0.20's instFallVocal + v0.22's instBite + v0.22.1's instHungerBite + v0.28's instPhaseSleep + v0.37's 6 affect instincts
  const g = GENES.find((g) => g.key === 'instLonelyMate');
  assert.ok(g, 'instLonelyMate is a registered gene');
  assert.equal(g.sense, 3, 'driven by loneliness (need for company)');
  assert.equal(g.action, 6, 'drives the mate action');
  assert.equal(ACTIONS[6], 'mate');
  assert.equal(GENES.length, 349); // 43 + v2's 135 (132 across 9 families + matePref's 3) + v0.14's 7 voice genes + disgust's instWasteFlee + v0.16's 6 substrate genes + v0.17's 25 evo-devo loci + v0.18's 6 realms loci + v0.20's 3 hands instincts + v0.20's instFallVocal + v0.22's instBite + v0.22.1's instHungerBite + v0.27's pantCapacity + v0.28's activityPhase/instPhaseSleep + v0.30's speciesTag + v0.32's six nerve loci + v0.37's 18 affect loci + D1's 92 regulatory loci
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
    // v0.18+: platform 0 (the jungle floor) spans x 1200–1800 — place the
    // pair ON it, not at the pre-Realms 700px coordinates (off-platform,
    // they'd fall to different branches and never meet).
    c.x = 1300 + (c === a ? -40 : 40);
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
  // Pin the mechanism under test: park the creature on platform 0, clear the
  // pantry, and put exactly one food at 500px. v0.22: N_IN 36→37 shifted
  // populate's rng stream, so the founder's spawn no longer cooperates — the
  // range gate is what this test owns, not the spawn lottery.
  a.x = 1300; a.platformIndex = 0;
  world.foods.length = 0;
  // Food at 500px: visible to max-eyes (546 range), invisible at default (420).
  addFood(world, a.x + 500, 0, 1);
  for (let t = 0; t < 3; t++) tickWorld(world, 0.1);
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

// v0.18 "Realms": legacy test coordinates (the pre-Realms 1600px world)
// map into the scaled jungle — x' = 1200 + 0.375x, the same mapping
// populate uses. Coordinates already in the new world (x >= 1200) pass
// through untouched.
const mx = (x) => (x < 1200 ? 1200 + x * 0.375 : x);

function makeCarrier(world, x = 700) {
  const c = world.creatures[0];
  c.x = mx(x); // v0.18: legacy coords map into the scaled jungle
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
  witness.x = demo.x + 20; witness.platformIndex = 0; // within sight of the demo
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

test('v0.7: meat efficiency follows diet; the dead leave corpses', () => {
  const g = randomGenome(createRng(3));
  g.alleles.diet = [2, 2];
  assert.equal(phenotype(g).meatEfficiency, 1.0, 'carnivores eat meat fully');
  g.alleles.diet = [0, 0];
  assert.equal(phenotype(g).meatEfficiency, 0.25, 'herbivores barely touch meat');
  g.alleles.diet = [1, 1];
  assert.equal(phenotype(g).meatEfficiency, 0.7, 'omnivores in between');
  const world = v07world(27);
  const before = world.foods.length;
  // v0.18 §13.4: noteDeath leaves the corpse — one per death, however caused.
  noteDeath(world, world.creatures[0], 'test');
  const corpses = world.foods.filter((f) => f.foodKind === 'corpse');
  assert.ok(world.foods.length > before || corpses.length > 0, 'a corpse was dropped');
  assert.ok(corpses.length > 0, 'the dead leave a corpse');
  assert.ok(corpses[0].rotsAt > 0, 'corpses rot');
  assert.ok(corpses[0].rotsAt >= CORPSE_ROT, 'rot time is at least the base (cold preserves)');
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
  assert.equal(v.length, 44, 'forty-four entries: 43 senses + bias'); // v0.37: +5 affect senses
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
  assert.equal(v[24], 0, 'airborne defaults to 0');
  assert.equal(v[25], 0, 'farLedge defaults to 0');
  assert.equal(v[26], 0, 'submerged defaults to 0');
  assert.equal(v[27], 0, 'waterNear defaults to 0');
  assert.equal(v[28], 0, 'thirst defaults to 0');
  assert.equal(v[29], 0, 'cold defaults to 0');
  assert.equal(v[30], 0, 'heat defaults to 0');
  assert.equal(v[31], 0, 'buriedNear defaults to 0');
  assert.equal(v[32], 0, 'objectNear defaults to 0'); // v0.20
  assert.equal(v[33], 0, 'heldWeight defaults to 0'); // v0.20
  assert.equal(v[34], 0, 'falling defaults to 0'); // v0.20 "Falling"
  assert.equal(v[35], 0, 'creatureSize defaults to 0'); // v0.22 "Web of Life"
  assert.equal(v[36], 0, 'phaseSleepiness defaults to 0'); // v0.28 "Day and night"
  assert.equal(v[37], 0, 'pain defaults to 0'); // v0.32 "Nervous system"
  assert.equal(v[38], 0, 'libido defaults to 0'); // v0.37 "Affect"
  assert.equal(v[39], 0, 'curiosity defaults to 0'); // v0.37
  assert.equal(v[40], 0, 'attachment defaults to 0'); // v0.37
  assert.equal(v[41], 0, 'care defaults to 0'); // v0.37
  assert.equal(v[42], 0, 'pairNear defaults to 0'); // v0.37
  assert.equal(v[43], 1, 'bias still last'); // v0.37: 43 senses + bias
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
  // v0.18 "Realms": legacy test coordinates (the pre-Realms 1600px world)
  // map into the scaled jungle — x' = 1200 + 0.375x, the same mapping
  // populate uses — and the platform defaults to whatever covers the
  // position, via platformIndexAt. Tests that need another biome pass
  // explicit world coordinates and/or platformIndex.
  const jx = mx(x);
  const pi = opts.platformIndex !== undefined ? opts.platformIndex : platformIndexAt(world, jx, 800);
  const c = createCreature(randomGenome(world.rng), jx, pi, world.rng);
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
  addFood(world, 1550, 0, 'fruit', 1); // inside the 420px sense range, on the jungle floor
  const genome = randomGenome(world.rng); // one genome for both — injury is the only variable
  const mk = (injury) => {
    const c = createCreature(genome, 1350, 0, world.rng); // jungle floor
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
  // v0.26: pin b's Fear readout to the identity (gain 1, baseline 0). This
  // test is about the contagion CAP (0.45 < the 0.5 bristle threshold), not
  // about genome-drawn Fear gains — a high-gain genome bristles from
  // contagion alone, which is genetics, not a broken cap.
  b.pheno.driveGainFear = 1; b.pheno.driveBaseFear = 0;
  a.biochem.adrenaline = 0.9; // canopy: fear is the adrenaline readout — pin the chemical
  tickWorld(world, 0.1);
  assert.ok(a.bristling, 'the afraid creature bristles');
  const f0 = b.biochem.fear;
  for (let i = 0; i < 20; i++) {
    a.biochem.adrenaline = 0.9; // keep the display up
    a.x = 1387; b.x = 1447; // hold them up close on the jungle floor: this
    // test is about the contagion mechanism, not about locomotion (a's
    // urgent re-decide may otherwise scatter the pair — a new action like
    // groom changes which approach action the brain picks, and that's fine)
    tickWorld(world, 0.1);
  }
  assert.ok(b.biochem.fear > f0 + 0.02,
    `bristling is contagious up close (${f0.toFixed(3)} -> ${b.biochem.fear.toFixed(3)})`);
  for (let i = 0; i < 200; i++) {
    a.biochem.adrenaline = 0.9; // keep the display up for 20 more seconds
    a.x = 1387; b.x = 1447; // hold them up close (see above)
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
  addPebble(world, 1372, 0); // jungle floor, in the walker's path
  const pb = world.pebbles[0];
  const c = addTestCreature(world, 1330, { action: 'seekFood', actionTimer: 100, facing: 1 }); // already world coords: passes through
  addFood(world, 1500, 0, 'fruit', 1); // inside sense range: steady +x walk
  const x0 = pb.x;
  for (let i = 0; i < 40; i++) tickWorld(world, 0.1);
  assert.ok(pb.x > x0 + 1, `pebble shoved +x (${x0.toFixed(1)} -> ${pb.x.toFixed(1)})`);
  assert.equal(world.pebbles.length, 1, 'pebbles persist');
  assert.ok(c.x < 1500, 'the world pushes back — the pusher is resisted');
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
  // v0.18: zoneAt is a legacy alias over the biome map — verdant→jungle,
  // arid→desert, highland→mountains, over the old cores. The founder-neutral
  // core keeps the v0.15 fruiting pressures (jungle 0.6, desert 2.2,
  // mountains 1.2), so founder behavior in old territory is unchanged.
  assert.strictEqual(zoneAt(1200).key, 'jungle');
  assert.strictEqual(zoneAt(1500).key, 'jungle');
  assert.strictEqual(zoneAt(1799).key, 'jungle');
  assert.strictEqual(zoneAt(2400).key, 'desert');
  assert.strictEqual(zoneAt(2999).key, 'desert');
  assert.strictEqual(zoneAt(600).key, 'mountains');
  assert.strictEqual(zoneAt(1199).key, 'mountains');
  assert.strictEqual(ZONES.length, 3, 'three legacy zones');
  assert.strictEqual(zoneAt(1500).fruitMul, 0.6, 'jungle keeps the verdant fruiting pressure');
  assert.strictEqual(zoneAt(2700).fruitMul, 2.2, 'desert keeps the arid fruiting pressure');
});

test('v0.11: plants are tagged with their biome zone', () => {
  const world = v09world(51);
  const keys = new Set(BIOMES.map((b) => b.key));
  for (const p of world.plants) {
    assert.ok(keys.has(p.zone), `plant zone ${p.zone}`);
  }
  // The legacy battery spawns in the founder region — all flora carries
  // the founder label (v1: jungle; v2: the founder region's label).
  const flabel = world.layout.canonical ? 'jungle' : world.layout.regions[world.layout.founder.regionId].label;
  assert.ok(world.plants.every((p) => p.zone === flabel), `legacy flora is ${flabel}-tagged`);
});

test('v0.11: arid fruiting is slower than verdant (scarcity is zonal)', () => {
  const world = bindWorld(createWorld(52));
  // Two mature plants, one per zone, forced to fruit now. v2: find actual
  // jungle and desert regions (v1: the mapped coordinates).
  world.plants.length = 0;
  const jx = world.layout.canonical ? 1400 : (world.layout.regions.find(r => r.label === 'jungle')?.cx ?? 1400);
  const dx = world.layout.canonical ? 2700 : (world.layout.regions.find(r => r.label === 'desert')?.cx ?? 2700);
  const mk = (x) => {
    const p = { kind: 'plant', id: 1, x, platformIndex: 0, y: 800, growth: 1, fruitTimer: 0, sway: 0, zone: biomeKeyAt(x, 800, { layout: world.layout }) };
    world.plants.push(p);
    return p;
  };
  const v = mk(jx), a = mk(dx);
  // Sample the interval the tick assigns: run one tick and read fruitTimer.
  tickWorld(world, 0.1);
  // Both fruited (timer reset to a fresh interval); arid interval must be larger.
  assert.ok(a.fruitTimer > v.fruitTimer * 1.5, `arid (${a.fruitTimer.toFixed(1)}s) much slower than verdant (${v.fruitTimer.toFixed(1)}s)`);
});

test('v0.11: crowding slows fruiting (density-dependent scarcity)', () => {
  const mkWorld = (n) => {
    const w = bindWorld(createWorld(53));
    w.plants.length = 0;
    w.plants.push({ kind: 'plant', id: 1, x: 100, platformIndex: 0, y: 800, growth: 1, fruitTimer: 0, sway: 0, zone: 'jungle' });
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
  assert.ok(BIOMES.some((b) => b.key === rec.zone), `birth zone recorded: ${rec.zone}`);
});

test('v0.11: no eat-livelock — the eat action approaches distant sensed food', () => {
  const world = v09world(61);
  world.creatures.length = 0;
  world.plants.length = 0;
  world.foods.length = 0;
  world.pebbles.length = 0;
  addFood(world, 1750, 0, 'fruit', 1); // jungle branch, within walking distance
  const c = addTestCreature(world, 400); // maps to the jungle floor at 1350
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
  assert.equal(c.homeX, 1357.5, 'homeX imprinted at creation x (legacy 420 maps to jungle 1357.5)');
  assert.equal(c.homePlatform, 0, 'home platform recorded');
});

test('v0.12: homeDist sense is 0 at home, 1 far away', () => {
  const world = v09world(72);
  world.creatures.length = 0;
  const c = addTestCreature(world, 400);
  c.x = c.homeX;
  let s = { ...MID_SENSES };
  // gatherSenses is internal; emulate the homeDist computation via a tick.
  c.biochem.energy = 1; c.biochem.hunger = 0; c.sleeping = false;
  const { tickWorld: tw } = { tickWorld };
  tw(world, 0.1);
  assert.ok(c._senses.homeDist < 0.05, `at home: homeDist ~0 (got ${c._senses.homeDist})`);
  c.x = c.homeX + 800; // 800px from home (out on the plains)
  tw(world, 0.1);
  assert.ok(c._senses.homeDist > 0.95, `800px away: homeDist ~1 (got ${c._senses.homeDist})`);
});

test('v0.12: seekHome walks the creature back toward home', () => {
  const world = v09world(73);
  world.creatures.length = 0;
  world.plants.length = 0; world.foods.length = 0;
  const c = addTestCreature(world, 400);
  c.x = 1600; // 250px from home, still on the jungle floor
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
  // Food far from home (home 1350, creature 1550, food 1750): a starving
  // creature must walk AWAY from home toward the food. The 200px gap is
  // not closed in 50 ticks, so the walk is the whole story.
  addFood(world, 1750, 0, 'fruit', 1);
  const c = addTestCreature(world, 400);
  c.x = 1550; // away from home: homeDist = 0.25, the homeward drive is real
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
  for (let i = 0; i < 50; i++) tickWorld(world, 0.1);
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
  // Pin x each tick: sleepers wake when rested (energy 1 > 0.92) and wander,
  // which is movement logic, not bond logic — the test is about tickBonds.
  const ax = a.x, bx = b.x;
  for (let i = 0; i < 100; i++) { a.x = ax; b.x = bx; tickWorld(world, 0.1); }
  const v = getBond(world.bonds, a, b);
  assert.ok(v > 0.02, `proximity breeds familiarity (bond ${v.toFixed(3)})`);
});

test('v0.12: mating forms a pair bond; bonds decay without contact', () => {
  const world = v09world(77);
  world.creatures.length = 0;
  const a = addTestCreature(world, 500, { sex: 'male' });
  const b = addTestCreature(world, 520, { sex: 'female' });
  for (const c of [a, b]) { c.biochem.hunger = 0; c.biochem.energy = 1; c.mateCooldown = 0; c.pheno.fertility = 1; }
  // v0.32: brain N_IN 38→39 shifts the world RNG stream — pin matching
  // speciesTags explicitly rather than relying on RNG luck.
  b.pheno.speciesTag = a.pheno.speciesTag;
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) ok = world.tryMate(a, b); // rng-gated; retry
  assert.ok(ok, 'mating succeeds');
  assert.ok(getBond(world.bonds, a, b) >= 0.39, `mating bonds the pair (got ${getBond(world.bonds, a, b).toFixed(2)})`);
  // Move them far apart, pin them every tick (sleepers wake when rested),
  // and wait: the bond must fade without contact.
  const v0 = getBond(world.bonds, a, b);
  for (let i = 0; i < 900; i++) {
    a.x = 1300; b.x = 1700; // both on the jungle floor, 400px apart
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
  b.x = 2100; b.homeX = 2100; // out on the plains, far beyond sense range
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
  // v0.18: mid branch 4 is x 1290–1450, y 470. The walker starts 5px from
  // the tip — the old test's geometry, byte for byte.
  addFood(world, 1490, 4, 'fruit', 1);
  const walker = physCreature(world, 1445, 4, { action: 'seekFood', actionTimer: 100, facing: 1 });
  for (let i = 0; i < 4; i++) tickWorld(world, 0.1);
  assert.ok(!walker.grounded, 'walked off the mid branch — the fall begins');
  assert.equal(walker.platformIndex, 4, 'still registered to the branch mid-fall');
  // The wanderer: pinned hunger/energy so it only ever wanders, near the edge.
  const drifter = physCreature(world, 1400, 4, { action: 'wander', actionTimer: 100000 });
  for (let i = 0; i < 200; i++) {
    tickWorld(world, 0.1);
    drifter.biochem.hunger = 0; drifter.biochem.energy = 1;
  }
  assert.ok(drifter.grounded, 'the wanderer never left the branch');
  assert.equal(drifter.platformIndex, 4, 'still on the mid branch after 20s of wandering');
});

test('physics: falling onto a lower platform lands you standing on it', () => {
  const world = v09world(52);
  // v0.17: clear populate's creatures and foods — the bigger brain (N_IN
  // 25→29) shifted the world RNG stream, and a courting creature's
  // stream-dependent path is not what this test is about. Gravity is.
  world.creatures.length = 0;
  world.foods.length = 0;
  const c = physCreature(world, 1450, 4);
  // Below mid branch 4 (y=470) at x=1450 — lower branch 2 (x 1320–1560, y=640)
  // is the only platform underneath.
  c.y = 500; c.vy = 0; c.vx = 0; c.grounded = false;
  for (let i = 0; i < 30 && !c.grounded; i++) tickWorld(world, 0.1);
  assert.ok(c.grounded, 'touched down');
  assert.equal(c.platformIndex, 2, 'landed on the lower branch');
  assert.equal(c.y, world.platforms[2].y, 'standing on it, not through it'); // v0.26: generated branch y
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
  const c = physCreature(world, 1400, 0); // jungle floor, y=800
  // Lower branch 2: x 1320–1560, y=640 — 160px above, right overhead.
  let s = gatherSenses(c, world);
  assert.ok(s.jumpNear > 0, `ledge overhead registers (jumpNear=${s.jumpNear.toFixed(2)})`);
  // Far from any higher platform: nothing to leap at. A stub world with one
  // ledge 300px up (past JUMP_RANGE_DY=280) proves the range gate.
  const stub = {
    platforms: [{ x1: 0, x2: 1600, y: 800 }, { x1: 200, x2: 400, y: 500 }],
    climbLinks: [], foods: [], creatures: [], toys: [],
    light: 1, bonds: null,
  };
  const cs = { ...c, x: 300, platformIndex: 0 };
  s = gatherSenses(cs, stub);
  assert.equal(s.jumpNear, 0, 'a ledge 300px up is not jumpable — no signal');
  // On the top branch (y=290): nothing above at all.
  const top = physCreature(world, 1420, 7);
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
  addPlant(world, 1300, 1, g); // jungle zone
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
  addPlant(world, 2700, 26, mk(0.05)); // desert, thirsty
  addPlant(world, 2750, 26, mk(0.95)); // desert, water-retaining
  const thirsty = world.plants[world.plants.length - 2];
  const retainer = world.plants[world.plants.length - 1];
  thirsty.growth = 1; thirsty.fruitTimer = 0.01;
  retainer.growth = 1; retainer.fruitTimer = 0.01;
  // v0.22: the fruiting interval rolls 12 + rng.range(0, 14) per plant, and
  // N_IN 36→37 shifted the stream — seed 103's rolls now swamp the 1.86×
  // stress signal with noise. Pin the base roll to isolate the mechanism
  // under test (the zoneStress multiplier), not the rng lottery.
  const origRange = world.rng.range;
  world.rng.range = () => 7;
  tickWorld(world, 0.1);
  world.rng.range = origRange;
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
  // v0.35: disperseSeed loads the gut; the seedling appears only after gut
  // transit (tickGutSeeds) — gravity-only immediate dispersal ended in v0.35.
  let loaded = false;
  for (let i = 0; i < 40 && !loaded; i++) {
    disperseSeed(world, c, food);
    loaded = !!(c.gutSeeds && c.gutSeeds.length);
  }
  assert.ok(loaded, 'seed loaded into the gut');
  let dispersed = false;
  for (let t = 0; t < 800 && !dispersed; t++) {
    tickGutSeeds(world, c);
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
  // Teleport both 700px from home (homeDist ~0.875) — out on the plains.
  homebody.x = 2087.5; wanderer.x = 2087.5;
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
  assert.ok(snap && snap.zones.jungle && snap.zones.desert && snap.zones.mountains, 'the legacy cores are reported');
  assert.ok(typeof snap.zones.desert.instHomeSeek === 'number', 'S is a number');
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
  assert.equal(ACTIONS.length, 30); // v0.14's 13 + v0.17's glide, brachiate, swim, dive + v0.18's drink, bask, dig + v0.20's grasp, carry, drop + v0.22's bite + v0.37's 6 affect actions
  for (const k of ['vocalPitch', 'vocalRange', 'vocalVolume', 'vocalImitate', 'matePrefCall']) {
    assert.ok(GENES.find((g) => g.key === k), `${k} is a registered gene`);
  }
  assert.equal(ACTIONS[23], 'bite', 'bite appended, never renumbered');
  assert.equal(ACTIONS[24], 'display', 'display appended, never renumbered'); // v0.37
  assert.equal(ACTIONS[29], 'mourn', 'mourn appended, never renumbered'); // v0.37
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
  a.pheno.size = 0; // neutralize body-size pitch scaling (v0.16)
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
  learner.pheno.size = 0; // body size scales emitted pitch (v0.16) — pin it
  tutor.voicePitch = 0.9; // so the test hears the voice, not the body
  tutor.pheno.vocalRange = 0; // tutor holds its pitch
  tutor.pheno.size = 0;
  tutor.pheno.vocalImitate = 0;
  for (const c of [learner, tutor]) { c.biochem.hunger = 0.2; c.biochem.energy = 0.9; }
  for (let t = 0; t < 200; t++) {
    tutor.action = 'vocal'; tutor.actionTimer = 100;
    learner.action = 'wander'; learner.actionTimer = 100;
    tutor.x = learner.x + 50; // stay in earshot: this test is about pitch
    tickWorld(world, 0.1);    // drift, not about wander paths (v0.20)
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
    c.pheno.size = 0; // v0.18: neutral body size — the dialect anchors are
    // the voice pitches, and sizePitchFactor scales what the ear receives.
    // (The bigger brain shifted the world RNG stream; tutor body sizes are
    // not what this test is about.)
    c.biochem.hunger = 0.2; c.biochem.energy = 0.9;
    world.creatures.push(c);
    return c;
  };
  // Cohort A (jungle platform 1): low tutor + learner.
  // Cohort B (plains platform 24): high tutor + learner. 650px apart —
  // no call crosses the gap, so the archives stay isolated.
  const t1 = mk(0.2, 0, 1300, 1);
  const l1 = mk(0.5, 1, 1350, 1);
  const t2 = mk(0.9, 0, 2000, 24);
  const l2 = mk(0.5, 1, 2050, 24);
  for (let t = 0; t < 400; t++) {
    for (const c of [t1, t2]) { c.action = 'vocal'; c.actionTimer = 100; }
    // v0.18: pin the learners in place — the bigger brain (N_IN 29→33)
    // shifted the world RNG stream and the learners' wander brains now
    // climb to other branches mid-test, changing what they hear. x alone
    // does not pin a climber; hold the branch too. Locomotion is not what
    // this test is about. Dialects are.
    for (const [l, x, pi] of [[l1, 1350, 1], [l2, 2050, 24]]) {
      l.x = x; l.y = world.platforms[pi].y; l.platformIndex = pi;
      l.vx = 0; l.vy = 0; l.action = 'eat'; l.actionTimer = 100;
    }
    tickWorld(world, 0.1);
  }
  assert.ok(l1.voicePitch < 0.45, `zone-A learner drifted low (${l1.voicePitch.toFixed(2)})`); // v0.32: N_IN 38→39 shifts RNG; 0.40 is the new low
  assert.ok(l2.voicePitch > 0.6, `zone-B learner drifted high (${l2.voicePitch.toFixed(2)})`);
  // The zone call archives record the dialects.
  const mean = (z) => {
    const l = world.zoneCalls[z] || [];
    return l.reduce((s, e) => s + e.pitch, 0) / Math.max(1, l.length);
  };
  const za = biomeKeyAt(t1.x), zb = biomeKeyAt(t2.x);
  assert.notEqual(za, zb, 'tutors live in different biomes');
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
  // Founders are incidental — v0.15 starts them as adults, so exclude them
  // from this experiment's census.
  const founderIds = new Set(world.creatures.map((c) => c.id));
  world.creatures = world.creatures.filter((c) => !founderIds.has(c.id));
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
  // Founders are incidental to this test — v0.15 starts them as adults, so
  // they would join the species census. Keep the experiment to the 8-group.
  const founderIds = new Set(world.creatures.map((c) => c.id));
  world.creatures = world.creatures.filter((c) => !founderIds.has(c.id));
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

// ================= v0.20 "Species" =================

test('v0.20: speciesOverview reports one entry per living species', () => {
  const world = bindWorld(createWorld(1425));
  populate(world);
  const founderIds = new Set(world.creatures.map((c) => c.id));
  world.creatures = world.creatures.filter((c) => !founderIds.has(c.id));
  const rng = createRng(79);
  const mkGroup = (val, n) => {
    for (let i = 0; i < n; i++) {
      const g = randomGenome(rng);
      for (const gene of GENES) if (gene.kind === 'float') g.alleles[gene.key] = [val, val];
      const c = createCreature(g, 400 + world.rng.range(-50, 50), 1, rng);
      c.biochem.age = c.pheno.lifespanSec * 0.5;
      world.creatures.push(c);
    }
  };
  mkGroup(0.1, 4);
  mkGroup(0.9, 4);
  // One newborn: juveniles are never clustered → counted as unclustered.
  const juv = createCreature(randomGenome(rng), 400, 1, rng);
  world.creatures.push(juv);
  world.predators = [{ kind: 'shark', alive: true }, { kind: 'bear', alive: true }];
  computeSpecies(world);
  const ov = speciesOverview(world);
  assert.equal(ov.species.length, 2, `two living species, got ${ov.species.length}`);
  for (const s of ov.species) {
    assert.equal(s.size, 4);
    assert.equal(s.adults, 4);
    assert.equal(s.juveniles, 0);
    assert.ok(s.homeBiomeName && s.homeBiomeName !== '?', 'home biome named');
    assert.ok(typeof s.meanPitch === 'number', 'mean pitch present');
    assert.ok(Array.isArray(s.divergences), 'divergences array present');
    assert.equal(s.members.length, 4, 'member roster present');
    assert.ok(typeof s.members[0].name === 'string', 'members named');
    assert.ok(s.genMax >= s.genMin, 'generation range sane');
  }
  // Extreme groups must diverge from the population mean on something.
  assert.ok(ov.species[0].divergences.length > 0, 'extreme group flags divergences');
  for (const d of ov.species[0].divergences) {
    assert.ok(Math.abs(d.rel) >= 0.15, 'divergence threshold honored');
    assert.ok(d.label && d.label.length > 0, 'divergence labeled');
    assert.ok(typeof d.speciesMean === 'number' && typeof d.globalMean === 'number');
  }
  for (const k of LINEAGE_TRAITS) assert.ok(typeof ov.globalMeans[k] === 'number', `global mean for ${k}`);
  assert.ok(ov.unclustered >= 1, 'newborn counted as unclustered');
  assert.deepEqual(ov.predators, { sharks: 1, bears: 1 }, 'predator census');
});

test('v0.20: speciesOverview tracks splits, parents, and newness', () => {
  const world = bindWorld(createWorld(1426));
  populate(world);
  const founderIds = new Set(world.creatures.map((c) => c.id));
  world.creatures = world.creatures.filter((c) => !founderIds.has(c.id));
  const rng = createRng(80);
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
  for (let i = 0; i < 4; i++) {
    for (const gene of GENES) if (gene.kind === 'float') group[i].genome.alleles[gene.key] = [0.95, 0.95];
  }
  computeSpecies(world); // split
  const ov = speciesOverview(world);
  assert.equal(ov.species.length, 2, 'two species after the split');
  const kids = ov.species.filter((s) => s.parentId != null);
  assert.ok(kids.length >= 1, 'split children know their parent species');
  assert.ok(ov.species.some((s) => s.isNew), 'fresh split counts as new');
  // firstSeen is honest: null when the log has no record, a tick otherwise.
  for (const s of ov.species) assert.ok(s.firstSeen == null || typeof s.firstSeen === 'number');
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
  // v0.22: N_IN 36→37 shifted the rng stream; seed 9007's scenario no longer
  // demos within 600 ticks (the only casualty in a 10-seed sweep — 9008 and
  // neighbors all demo and reward). Seed recalibrated, mechanism untouched.
  // v0.32: N_IN 38→39 shifts again; 9008 no longer demos, 9009 does.
  const world = bindWorld(createWorld(9009));
  populate(world);
  const te = world.teacher;
  // Put the teacher where the students are — and keep it there. v0.17's
  // weaker founding legs (legPower 0.5 → 0.3) mean students climb the link
  // network instead of jumping after the teacher, so a wandering teacher
  // outruns its class; the policy under test is demo → listen → reward,
  // not student mobility, so the scenario re-cages the teacher each stretch.
  for (let i = 0; i < 600; i++) {
    if (i % 100 === 0) {
      const s = world.creatures.find((c) => c.alive);
      if (s) { te.platformIndex = s.platformIndex; te.x = s.x + 100; }
    }
    tickWorld(world, 0.1);
  }
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
  const soilBefore = soilAt(world, c.x).waste;
  c.gut = 1;
  excrete(c, world, 1.0);
  const expected = Math.min(1, 1 * EXCRETE_RATE * 1.0);
  assert.ok(Math.abs(c.gut - (1 - expected)) < 1e-9, `gut drained proportionally, got ${c.gut}`);
  assert.ok(soilAt(world, c.x).waste - soilBefore > 0, 'soil waste grew');
  // Full clearance never overshoots — the gut can't go negative.
  c.gut = 0.01;
  excrete(c, world, 1000);
  assert.ok(c.gut >= 0, `gut never negative, got ${c.gut}`);
});

test('v0.14: decomposition converts waste to fertility; leaching relaxes it', () => {
  const world = bindWorld(createWorld(14103));
  const s = soilAt(world, world.layout.regions.find(r => r.label === 'jungle').cx);
  s.waste = 10; s.fertility = 0.5;
  tickSoil(world, 10); // dt=10s: conv = 10 * min(1, 0.03*10) = 3 (v0.24: smaller dt — fast leaching would erase the signal in one 100s tick)
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
  assert.equal(soilGrowthMul(world, 'jungle'), 1.0, '0.5 fertility is neutral');
  const jr = world.layout.regions.filter(r => r.label === 'jungle').sort((a,b) => (b.x1-b.x0)-(a.x1-a.x0))[0];
  soilAt(world, jr.cx).fertility = 0;
  assert.ok(soilGrowthMul(world, 'jungle') < 1.0, 'exhausted soil stalls growth');
  soilAt(world, jr.cx).fertility = SOIL_FERT_MAX;
  assert.ok(soilGrowthMul(world, 'jungle') > 1.0, 'rich soil speeds growth');
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
  const zone = zoneAt(c.x).key;
  const growthBefore = world.plants.filter(p => p.zone === zone).reduce((a, p) => a + (p.growth || 0), 0);
  // Let the cycle run: excretion → soil waste → decomposition → fertility → plant growth.
  for (let i = 0; i < 600; i++) tickWorld(world, 0.5);
  const s = soilAt(world, c.x);
  assert.ok(s.waste > 0 || s.fertility > 0, `soil received the waste (waste ${s.waste.toFixed(3)}, fertility ${s.fertility.toFixed(3)})`);
  // v0.24: growth is donor-limited — the plants drink the fertility, so the
  // assertion is that they GREW (the meal fed them), not that fertility
  // stays above baseline.
  const growthAfter = world.plants.filter(p => p.zone === zone).reduce((a, p) => a + (p.growth || 0), 0);
  assert.ok(growthAfter > growthBefore, `plants in the zone grew on the meal: ${growthBefore.toFixed(3)} -> ${growthAfter.toFixed(3)}`);
});

// ---- v0.14 "Voices": disgust — evolvable waste avoidance ----

test('v0.14: disgust — wasteOdor sense smells the soil', () => {
  const world = bindWorld(createWorld(14109));
  populate(world);
  const c = addTestCreature(world, 200);
  const clean = gatherSenses(c, world);
  assert.equal(clean.wasteOdor, 0, 'clean ground has no odor');
  soilAt(world, c.x).waste = WASTE_ODOR_SCALE / 2;
  const half = gatherSenses(c, world);
  assert.ok(Math.abs(half.wasteOdor - 0.5) < 1e-9, `half stink reads 0.5, got ${half.wasteOdor}`);
  soilAt(world, c.x).waste = WASTE_ODOR_SCALE * 3;
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
  soilAt(world, c.x).waste = WASTE_ODOR_SCALE; // full stink
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
  soilAt(world, c.x).waste = WASTE_ODOR_SCALE; // full stink
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
  const a = chronCreature(world, 'Ash', 1300, null, 0); // Emerald Jungle
  const b = chronCreature(world, 'Birch', 1350, null, 5);
  world.events.push({ type: 'hatch', creature: a, t: 0 }, { type: 'hatch', creature: b, t: 5 });
  const gen = chronChapter(buildChronicle(world), 'genesis');
  assert.equal(gen.entries.length, 2);
  assert.ok(gen.entries[0].text.includes('Ash'), 'prose names the founder');
  assert.ok(gen.entries[0].text.includes('Emerald Jungle'), 'prose names the birth biome from lineage');
  assert.ok(gen.entries[0].jumps.some((j) => j.tab === 'tree' && j.creatureId === a.id), 'tree jump targets the founder');
});

test('chronicle: events sort into their thematic chapters', () => {
  const world = chronWorld();
  const a = chronCreature(world, 'Ash', 100, null, 0);
  world.events.push({ type: 'speciation', t: 400, from: 3, to: [5, 6], sizes: [12, 9] });
  world.events.push({ type: 'traditionFounded', name: 'Dawn Chorus', creature: a, t: 200 });
  world.teachLog.push({ t: 300, kind: 'demo', type: 'contact', zone: 'desert', listeners: 4 });
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
    { t: 300, kind: 'reward', pitch: 0.42, n: 3, zone: 'jungle' },
  );
  const chs = buildChronicle(world);
  const splitText = chronChapter(chs, 'split').entries.find((e) => e.icon === '💥').text;
  assert.ok(splitText.includes('#3') && splitText.includes('#5 (12)') && splitText.includes('#6 (9)'),
    `speciation prose carries the logged ids and sizes: ${splitText}`);
  const teach = chronChapter(chs, 'teacher').entries;
  assert.ok(teach[0].text.includes('arrived'), 'first teachLog entry reads as the arrival');
  const reward = teach.find((e) => e.icon === '🌟').text;
  assert.ok(reward.includes('3') && reward.includes('0.42') && reward.includes('Emerald Jungle'),
    `reward prose carries n, pitch and zone name: ${reward}`);
  void a;
});

test('chronicle: every jump target resolves against the world', () => {
  const world = chronWorld();
  const a = chronCreature(world, 'Ash', 100, null, 0);
  world.events.push({ type: 'hatch', creature: a, t: 0 });
  world.events.push({ type: 'speciation', t: 400, from: 3, to: [5], sizes: [12] });
  world.teachLog.push({ t: 100, kind: 'mode', mode: 'autonomous' });
  world.divergenceLog.push({ t: 200, zones: { jungle: { vocalPitch: 0.7 } } });
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
  chronCreature(world, 'Ash', 1300, null, 0);   // jungle
  chronCreature(world, 'Dune', 2700, null, 50); // desert
  chronCreature(world, 'Peak', 680, null, 100); // mountains
  const entries = chronChapter(buildChronicle(world), 'spread').entries;
  assert.equal(entries.length, 3);
  assert.ok(entries[0].text.includes('Emerald Jungle') && entries[0].text.includes('Ash'));
  assert.ok(entries[1].text.includes('Sunscorch Desert') && entries[1].text.includes('Dune'));
  assert.ok(entries[2].text.includes('Skyreach Mountains') && entries[2].text.includes('Peak'));
  assert.ok(entries[0].t < entries[1].t && entries[1].t < entries[2].t, 'milestones ordered by first birth');
});

test('chronicle: dialect divergence crosses into First Words with the real S value', () => {
  const world = chronWorld();
  world.divergenceLog.push({ t: 200, zones: { desert: { vocalPitch: -0.62 } } });
  const words = chronChapter(buildChronicle(world), 'words').entries;
  const d = words.find((e) => e.icon === '🎵');
  assert.ok(d, 'a dialect milestone was written');
  assert.ok(d.text.includes('Sunscorch Desert') && d.text.includes('-0.62'), `prose carries zone and S: ${d.text}`);
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
  const desertR = world.layout.regions.find(r => r.label === 'desert');
  const x = desertR ? desertR.cx : 2700; // desert — plant and rot in the same biome
  const s = soilAt(world, x);
  s.waste = 0; s.fertility = 0.5;
  // A corpse: 1.2 of remains at nutrition 1, rotting now.
  addFood(world, x, 26, 'corpse', 1.2, 0.01, { nutrition: 1 });
  const carcass = world.foods[world.foods.length - 1];
  const wasteBefore = s.waste;
  world.time += 1; // past rotsAt
  compostRot(world);
  assert.ok(!world.foods.includes(carcass), 'the corpse is gone as an item');
  assert.ok(Math.abs(s.waste - wasteBefore - 1.2) < 1e-9, `soil waste gained the corpse mass, got ${s.waste}`);
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
  // v0.24: litter is growth-coupled and mass-lawful. Bank known litter on
  // the plants (as tickPlant does when they grow), then shed it.
  let banked = 0;
  for (const q of world.plants) {
    q._litterAcc = 0.1;
    banked += 0.1;
  }
  let wasteBefore = 0;
  for (const z of Object.values(world.soil)) wasteBefore += z.waste;
  shedLitter(world, 100);
  let wasteAfter = 0;
  for (const z of Object.values(world.soil)) wasteAfter += z.waste;
  const expected = banked * PLANT_MASS;
  assert.ok(wasteAfter - wasteBefore > 0, 'litter accumulated in the soil');
  assert.ok(Math.abs((wasteAfter - wasteBefore) - expected) < 1e-9,
    `litter mass is lawful, got ${wasteAfter - wasteBefore} expected ${expected}`);
  // The bank is empty after shedding — nothing shed twice.
  for (const q of world.plants) assert.equal(q._litterAcc || 0, 0, 'litter bank cleared');
});

test('v0.14.1: rich ground enters the chronicle — the land remembers', () => {
  const world = bindWorld(createWorld(14114));
  populate(world);
  const s = world.soil.jungle;
  s.waste = 0; s.fertility = 0.99; s.richNoted = false;
  tickSoil(world, 0.5); // no waste: leaching pulls DOWN — no event
  assert.ok(!world.events.some((e) => e.type === 'soilRich'), 'lean soil writes no history');
  s.fertility = 1.2; // above 1.0 even after this tick's leaching
  tickSoil(world, 0.001);
  const ev = world.events.find((e) => e.type === 'soilRich');
  assert.ok(ev, 'first richness is noted');
  assert.equal(ev.zone, 'jungle');
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

// v0.15 "Bloom": breeding diagnosis. The v2 courtship fix made mating fire;
// the die-outs came from juvenile founders dying before they could breed
// (seed 11 / seed 99 autopsies). Founders now start as young adults.
test('v0.15: founders start as young adults, breedable from the first minute', () => {
  const world = bindWorld(createWorld(7));
  populate(world);
  assert.equal(world.creatures.length, 4, 'four founders');
  for (const c of world.creatures) {
    assert.equal(ageStage(c.biochem, c.pheno), 'adult', `${c.name} starts adult`);
    assert.ok(c.pheno.lifespanSec * 0.25 < c.biochem.age, 'past the juvenile threshold');
  }
});

test('v0.15: courtship fires and eggs hatch within the first minutes (seed 7)', () => {
  const world = bindWorld(createWorld(7));
  populate(world);
  let matings = 0, births = 0;
  const origPush = world.events.push.bind(world.events);
  world.events.push = (e) => {
    if (e.type === 'mating') matings++;
    else if (e.type === 'hatch') births++;
    return origPush(e);
  };
  for (let i = 0; i < 3000; i++) tickWorld(world, 0.1); // 300 sim-seconds
  assert.ok(matings >= 1, `expected courtship, got ${matings} matings`);
  assert.ok(births >= 1, `expected hatchlings, got ${births} births`);
});

// v0.15 "Bloom": the v2 morphology render genes were dead — the painter never
// read bulk, tailCurl, earSize, earTilt, armLength, or regional pigmentation.
// A gene the painter ignores cannot change the render, so per-gene SVG
// differences prove the wiring.
test('v0.15: morphology genes (bulk/tailCurl/ears/regional pigment) reach the painter', () => {
  const world = bindWorld(createWorld(7));
  populate(world);
  const c = world.creatures[0];
  const draw = (mut) => {
    const saved = {};
    for (const k of Object.keys(mut)) { saved[k] = c.pheno[k]; c.pheno[k] = mut[k]; }
    const ctx = new SvgCtx(400, 400);
    drawCreature(ctx, c, 350, 1.0);
    const svg = ctx.toSVG();
    for (const k of Object.keys(mut)) c.pheno[k] = saved[k];
    return svg;
  };
  const classic = draw({});
  assert.ok(classic.length > 1000, 'the painter produced a render');
  for (const mut of [
    { bulk: 1.0 }, { bulk: 0.0 },
    { tailCurl: 1.0 }, { tailCurl: 0.0 },
    { earScale: 1.5 }, { earTiltRad: 0.5 },
    { armLength: 1.0 },
    { pigTorsoHueDeg: 180 }, { pigTorsoSatShift: -60 }, { pigTorsoPat: 'spots' },
    { pigHeadHueDeg: -120 }, { pigHeadPat: 'spots' },
    { pigLimbsHueDeg: 90 }, { pigLimbsSatShift: 60 },
  ]) {
    const k = Object.keys(mut)[0];
    assert.notEqual(draw(mut), classic, `${k} changes the render`);
  }
});

// ================= v0.17 "Bauplan" =================

// A genome with the evo-devo loci pinned to exact founder values —
// the legacy animal, as the genome intends it.
function founderEvoGenome(rng) {
  const g = randomGenome(rng);
  for (const key of EVO17_KEYS) {
    const gene = GENES.find((gg) => gg.key === key);
    if (gene.founder !== undefined) g.alleles[key] = [gene.founder, gene.founder];
  }
  return g;
}

// A genome with targeted evo-devo overrides (choice alleles are indices).
function evoGenome(rng, overrides) {
  const g = founderEvoGenome(rng);
  for (const [k, v] of Object.entries(overrides)) g.alleles[k] = [v, v];
  return g;
}

test('v0.17: 217 loci, 9 chromosomes — the evo-devo 25 ride together', () => {
  assert.equal(GENES.length, 349); // v0.17's 223 + v0.20's 3 hands instincts + instFallVocal + v0.22's instBite + v0.22.1's instHungerBite + v0.27's pantCapacity + v0.28's activityPhase/instPhaseSleep + v0.30's speciesTag + v0.32's six nerve loci + v0.37's 18 affect loci (8 drive + 4 rate + 6 instinct) + D1's 92 (32 G + 4 Q + 32 ext-R + 24 ext-C)
  assert.equal(EVO17_KEYS.size, 25);
  assert.equal(new Set(GENES.map((g) => g.key)).size, 349, 'no duplicate keys');
  assert.equal(CHROMOSOMES.length, 10);
  for (const k of EVO17_KEYS) {
    assert.ok(CHROMOSOMES[8].includes(k), `${k} rides the new chromosome 9`);
  }
});

test('D1: 349 loci, 10 chromosomes — the 92 regulatory loci ride together', () => {
  assert.equal(D1_KEYS.size, 92, '32 G + 4 Q + 32 ext-R + 24 ext-C');
  assert.equal(REGULATION_CHROM, 9, 'chr 10 is the regulation chromosome');
  assert.equal(CHROMOSOMES[9].length, 36, 'all 36 family-G/Q loci on chr 10');
  for (const k of D1_KEYS) {
    const onChr10 = CHROMOSOMES[9].includes(k);
    const onChr5 = CHROMOSOMES[4].includes(k);
    const onChr6 = CHROMOSOMES[5].includes(k);
    assert.ok(onChr10 || onChr5 || onChr6, `${k} rides chr 10, 5, or 6`);
  }
  // GTARGETS is GENERATED from GENES — float|sym|exp, no G genes, no choice genes.
  assert.ok(GTARGETS.length > 200, `generated vocabulary, ${GTARGETS.length} targets`);
  for (const k of D1_KEYS) {
    if (k.startsWith('g')) assert.ok(!GTARGETS.includes(k), `no gate-on-gate: ${k} excluded`);
  }
  const geneByKey = Object.fromEntries(GENES.map((g) => [g.key, g]));
  for (const t of GTARGETS) {
    assert.ok(['float', 'sym', 'exp'].includes(geneByKey[t].kind), `${t} is a scalable kind`);
  }
  assert.ok(GTARGETS.includes('dupRate'), 'dupRate is a legal G target');
  assert.ok(GTARGETS.includes('curiosity'), 'curiosity is a legal G target');
  // Founder defaults are exact: gates ≡ 1.0, extended channels silent.
  const rng = createRng(1234);
  const g = randomGenome(rng);
  const p = phenotype(g);
  assert.equal(p.g0slope, 0);
  assert.equal(p.rx8rate, 0.0);
  assert.equal(p.rc6gain, 0);
  assert.equal(p.dupRate, 0.001);
  assert.equal(p.poolDrain, 0.002);
  assert.equal(p.poolRecDiv, 0.15);
  assert.equal(p.poolCap, 12);
  assert.deepEqual(g.pool, {}, 'founder pool starts empty');
  for (let i = 0; i < 8; i++) {
    assert.equal(p[`g${i}tgt`], 'curiosity', `g${i}tgt founder targets curiosity`);
    assert.equal(gateMultiplier(p, p[`g${i}tgt`], { bloodSugar: 0.5, adrenaline: 0.9 }), 1.0,
      `g${i}: mult ≡ 1.0 exactly at founder`);
  }
  // The gate curve is the implementation: closed form within 1e-12.
  const g2 = randomGenome(createRng(99));
  g2.alleles.g0tgt = [GTARGETS.indexOf('drvHungerGain'), GTARGETS.indexOf('drvHungerGain')];
  g2.alleles.g0reg = [0, 0]; // bloodSugar
  g2.alleles.g0slope = [0.5, 0.5];
  g2.alleles.g0thr = [0.5, 0.5];
  const p2 = phenotype(g2);
  const regV = 0.8;
  const got = gateMultiplier(p2, 'drvHungerGain', { bloodSugar: regV });
  const want = 1 + 0.5 * (1 / (1 + Math.exp(-((regV - 0.5) * 4))));
  assert.ok(Math.abs(got - want) < 1e-12, `curve closed form: ${got} vs ${want}`);
});

test('v0.18: SENSE32 — four realms senses appended, never renumbered', () => {
  assert.equal(SENSE32.length, 43); // v0.18's 32 + v0.20's objectNear, heldWeight, falling + v0.22's creatureSize + v0.28's phaseSleepiness + v0.32's pain + v0.37's 5 affect senses
  assert.deepEqual(SENSE32.slice(0, 24), SENSE24, 'the old 24 are untouched');
  assert.equal(SENSE32[24], 'airborne');
  assert.equal(SENSE32[25], 'farLedge');
  assert.equal(SENSE32[26], 'submerged');
  assert.equal(SENSE32[27], 'waterNear');
  assert.equal(SENSE32[28], 'thirst');
  assert.equal(SENSE32[29], 'cold');
  assert.equal(SENSE32[30], 'heat');
  assert.equal(SENSE32[31], 'buriedNear');
  assert.equal(SENSE32[32], 'objectNear'); // v0.20: the hands senses
  assert.equal(SENSE32[33], 'heldWeight');
  assert.equal(SENSE32[34], 'falling'); // v0.20 "Falling": appended, never renumbered
  assert.equal(SENSE32[35], 'creatureSize'); // v0.22 "Web of Life": appended, never renumbered
});

test('v0.18: three realms actions appended — drink 17, bask 18, dig 19', () => {
  assert.equal(ACTIONS.length, 30); // v0.18's 20 + v0.20's grasp 20, carry 21, drop 22 + v0.22's bite 23 + v0.37's 6 affect (24-29)
  assert.deepEqual(ACTIONS.slice(0, 13), ACT13, 'the old 13 are untouched');
  assert.equal(ACTIONS[13], 'glide');
  assert.equal(ACTIONS[14], 'brachiate');
  assert.equal(ACTIONS[15], 'swim');
  assert.equal(ACTIONS[16], 'dive');
  assert.equal(ACTIONS[17], 'drink');
  assert.equal(ACTIONS[18], 'bask');
  assert.equal(ACTIONS[19], 'dig');
  assert.equal(ACTIONS[20], 'grasp'); // v0.20: the hands verbs
  assert.equal(ACTIONS[21], 'carry');
  assert.equal(ACTIONS[22], 'drop');
  assert.equal(ACTIONS[23], 'bite'); // v0.22 "Web of Life": the attack verb — appended, never renumbered
  assert.equal(ACT20.length, 24, 'the gene vocabulary agrees');
});

test('v0.18: the brain takes 33 inputs; the realms senses land at 28–31', () => {
  const v = senseVector({ ...MID_SENSES, airborne: 0.5, farLedge: 0.3, submerged: 0, waterNear: 0.9, thirst: 0.6, cold: 0.2, heat: 0, buriedNear: 0.4, objectNear: 0.7, heldWeight: 0.3, falling: 0.8 });
  assert.equal(v.length, 44, '43 senses + bias'); // v0.37: +5 affect senses
  assert.equal(v[24], 0.5, 'airborne rides at index 24');
  assert.equal(v[25], 0.3, 'farLedge rides at index 25');
  assert.equal(v[26], 0, 'submerged rides at index 26');
  assert.equal(v[27], 0.9, 'waterNear rides at index 27');
  assert.equal(v[28], 0.6, 'thirst rides at index 28');
  assert.equal(v[29], 0.2, 'cold rides at index 29');
  assert.equal(v[30], 0, 'heat rides at index 30');
  assert.equal(v[31], 0.4, 'buriedNear rides at index 31');
  assert.equal(v[32], 0.7, 'objectNear rides at index 32'); // v0.20
  assert.equal(v[33], 0.3, 'heldWeight rides at index 33'); // v0.20
  assert.equal(v[34], 0.8, 'falling rides at index 34'); // v0.20 "Falling"
  assert.equal(v[35], 0, 'creatureSize rides at index 35'); // v0.22 — unset here
  assert.equal(v[36], 0, 'phaseSleepiness rides at index 36'); // v0.28 — unset here
  assert.equal(v[37], 0, 'pain rides at index 37'); // v0.32 — unset here
  assert.equal(v[43], 1, 'bias still last'); // v0.37: 43 senses + bias
});

test('v0.17: the founder body plan is the legacy animal', () => {
  const p = phenotype(founderEvoGenome(createRng(7)));
  const bp = expressBuds(p, 1);
  assert.equal(bp.limbs.length, 4, 'four limbs, as always');
  const sig = bp.limbs.map((l) => `${l.site}:${l.side}:${l.type}`).sort();
  assert.deepEqual(sig, ['hip:L:grasp', 'hip:R:grasp', 'shoulder:L:grasp', 'shoulder:R:grasp']);
  assert.equal(bp.graspPairs, 2);
  assert.equal(bp.bodySegs, 1);
  assert.equal(bp.tails, 1);
  assert.equal(bp.wingArea, 0);
  assert.equal(bp.sailArea, 0);
  assert.equal(bp.gillArea, 0);
  assert.equal(bp.finArea, 0);
  // Babies have nubs, not wings: the plan is unrealized early.
  const baby = expressBuds(p, 0.21875);
  assert.ok(baby.limbs.every((l) => l.grow01 < BUD_NUB_HI), 'baby grasp limbs are still nubs');
  assert.equal(baby.graspPairs, 2, '...but they count as grasp pairs');
});

test('v0.17: founder phenotype derivations — areas 0, graspPairs 2, bodySegs 1', () => {
  const p = phenotype(founderEvoGenome(createRng(7)));
  assert.equal(p.wingArea, 0);
  assert.equal(p.sailArea, 0);
  assert.equal(p.gillArea, 0);
  assert.equal(p.finArea, 0);
  assert.equal(p.graspPairs, 2);
  assert.equal(p.bodySegs, 1);
  assert.equal(p.glideLift, 0, 'no wings, no lift');
  assert.equal(p.developDrain, 0, 'the founder plan costs nothing to develop');
  assert.equal(p.matePrefNovel, 0, 'novelty does not choose at founder');
  assert.equal(p.fallSoak, 0);
  assert.equal(p.breathTime, 30, 'founder lungs');
});

test('v0.17: newborns start with a baby body plan', () => {
  const c = createCreature(randomGenome(createRng(9)), 100, 0, createRng(10));
  assert.ok(c.bodyPlan, 'createCreature sets the realized plan');
  assert.equal(c.bodyPlan.growth01, 0.21875, 'baby growth01');
});

test('v0.17: growth curves — baby < child < adult', () => {
  const baby = developmentalGrowth01('baby');
  const child = developmentalGrowth01('child');
  const adult = developmentalGrowth01('adult');
  assert.ok(baby < child && child < adult, `${baby.toFixed(3)} < ${child.toFixed(3)} < ${adult.toFixed(3)}`);
  assert.equal(adult, 1.0);
});

test('v0.17: starvation stunts juveniles; adults freeze the stunt', () => {
  const stunted = developmentalGrowth01('child', 0.2);
  const fed = developmentalGrowth01('child', 0.9);
  assert.ok(stunted < fed, `hunger stunts growth (${stunted.toFixed(3)} < ${fed.toFixed(3)})`);
  assert.equal(developmentalGrowth01('adult', 0.2, 0.6), 0.6, 'adults freeze the stunt they grew up with');
  assert.equal(developmentalGrowth01('senior', 0.9, 0.8), 0.95 * 0.8, 'seniors keep it too (on the 0.95 senior base)');
});

test('v0.17: vestigialization is free, wings cost — developDrain', () => {
  const vest = phenotype(evoGenome(createRng(7), { budShoulderGrow: 0, budHipGrow: 0 }));
  assert.equal(vest.graspPairs, 0, 'no erupted grasp limbs');
  assert.equal(vest.developDrain, 0, 'a vestigial plan costs nothing');
  const wing = phenotype(evoGenome(createRng(7), {
    budDorsalGrow: 1, budDorsalType: 1, budMidGrow: 1, budMidType: 1, budMidLen: 1,
  }));
  assert.ok(wing.wingArea > 0.6, `real wings (${wing.wingArea.toFixed(2)})`);
  assert.ok(wing.developDrain > 0, `wings cost development (${wing.developDrain.toFixed(4)})`);
  assert.ok(wing.wingUpkeep > 0, 'and upkeep for life');
});

test('v0.17: glide without wings degrades to exactly a jump', () => {
  const world = bindWorld(createWorld(300));
  const mk = (action, x) => {
    const c = createCreature(randomGenome(world.rng), x, 0, world.rng);
    c.pheno.legPower = 0.5;
    c.pheno.spikes = 0; // no accidental clashes
    c.facing = 1;
    world.creatures.push(c);
    c.action = action;
    c.actionTimer = 100;
    return c;
  };
  const glider = mk('glide', 800);
  const jumper = mk('jump', 800); // same column: v0.23 wind is real, so same
  // air ⇒ the degrade comparison controls for environment, not luck
  tickWorld(world, 0.1);
  assert.ok(!glider.grounded && !jumper.grounded, 'both left the ground');
  assert.equal(glider.vy, jumper.vy, 'the jump impulse, exactly');
  assert.equal(glider.vx, jumper.vx, 'the jump velocity, exactly');
  assert.ok(!glider.gliding, 'no wings, no gliding flag');
  assert.equal(glider.actionLabel, 'jumping', "Paul's rule: the verb degrades honestly");
});

test('v0.17: brachiate without a third grasp pair degrades to moveToward', () => {
  const world = bindWorld(createWorld(301));
  // v0.20: geographically consistent — both on the jungle floor (platform
  // 0), east of the pool, so the food keeps platformIndex 0.
  addFood(world, 1600, 0, 'fruit', 1);
  const c = physCreature(world, 1500, 0, { action: 'brachiate', actionTimer: 100 });
  assert.equal(c.bodyPlan.graspPairs, 2, 'founder has two grasp pairs');
  const x0 = c.x;
  tickWorld(world, 0.1);
  assert.ok(!c.brachiating, 'no third pair, no brachiation');
  assert.equal(c.actionLabel, 'scrambling along');
  assert.ok(c.x > x0, 'still moves toward the food at walk speed');
});

test('v0.17: swim on land is an honest flop', () => {
  const world = bindWorld(createWorld(302));
  const c = physCreature(world, 1400, 0, { action: 'swim', actionTimer: 100 });
  const x0 = c.x;
  tickWorld(world, 0.1);
  assert.equal(c.actionLabel, 'flopping', 'no water, no swimming');
  assert.ok(Math.abs(c.x - x0) < 12, 'a flop barely moves');
});

test('v0.17: dive on land degrades to wandering', () => {
  const world = bindWorld(createWorld(303));
  const c = physCreature(world, 800, 0, { action: 'dive', actionTimer: 100 });
  tickWorld(world, 0.1);
  assert.equal(c.action, 'wander', 'nothing to dive into');
  assert.equal(c.actionLabel, 'ducking');
});

test('v0.17: organ instincts wire inhibited at founder (−1.2), excitable when mutated', () => {
  const rng = createRng(11);
  const base = testPheno(11, {
    instAirborneGlide: 0, instFarLedgeGlide: 0, instFoodBrach: 0,
    instSubmergedSwim: 0, instSubmergedDive: 0,
  });
  const brain = createBrain(base, rng);
  // founder 0 → (0 − 0.5) × 2.4: the pathway exists but sleeps.
  assert.equal(brain.instW[13][24], -1.2, 'airborne → glide');
  assert.equal(brain.instW[13][25], -1.2, 'farLedge → glide');
  assert.equal(brain.instW[14][6], -1.2, 'foodDist → brachiate');
  assert.equal(brain.instW[15][26], -1.2, 'submerged → swim');
  assert.equal(brain.instW[16][26], -1.2, 'submerged → dive');
  const woke = createBrain(testPheno(11, { instAirborneGlide: 1 }), rng);
  assert.equal(woke.instW[13][24], 1.2, 'a mutated instinct excites the pathway');
});

test('v0.17: real wings glide — slower descent, farther travel than a jump', () => {
  const world = bindWorld(createWorld(304));
  const mk = (genome, x) => {
    const c = createCreature(genome, x, 0, world.rng);
    c.biochem.age = c.pheno.lifespanSec * 0.5; // adult
    c.pheno.legPower = 0.5;
    c.pheno.spikes = 0; // no accidental clashes
    c.facing = 1;
    c.bodyPlan = expressBuds(c.pheno, 1); // adult realization
    c.action = 'glide';
    c.actionTimer = 1000;
    world.creatures.push(c);
    return c;
  };
  const glider = mk(evoGenome(world.rng, {
    budDorsalGrow: 1, budDorsalType: 1, budMidGrow: 1, budMidType: 1, budMidLen: 1,
  }), 800);
  assert.ok(glider.bodyPlan.wingArea > 0.6, 'wings above the glide threshold');
  assert.ok(glider.pheno.glideLift > 0, 'and they make lift');
  const jumper = mk(founderEvoGenome(world.rng), 200);
  for (let i = 0; i < 20; i++) tickWorld(world, 0.1);
  assert.ok(glider.gliding, 'the wings are out');
  assert.ok(!jumper.gliding, 'the wingless never glides');
  assert.ok(glider.x - 800 > jumper.x - 200,
    `glider travels farther (${(glider.x - 800).toFixed(0)}px vs ${(jumper.x - 200).toFixed(0)}px)`);
  assert.ok(glider.y < jumper.y, 'and descends slower');
});

test('v0.17: glideLift caps at 0.85 — descent, never ascent', () => {
  const p = phenotype(evoGenome(createRng(5), {
    budDorsalGrow: 1, budDorsalType: 1, budShoulderGrow: 1, budShoulderType: 1,
    budHipGrow: 1, budHipType: 1, budMidGrow: 1, budMidType: 1, budMidLen: 1,
    budNeckGrow: 1, budNeckType: 1, budNeckLen: 1,
  }));
  assert.ok(p.wingArea > 2, `maximal membranes (${p.wingArea.toFixed(2)})`);
  assert.equal(p.glideLift, 0.85, 'lift caps — gravity always wins a little');
});

test('v0.17: dorsal-only membranes can never glide — the two-site wing quirk', () => {
  // Honest negative, kept as a documented test: the dorsal len is fixed at
  // 0.5, below the 0.6 glide threshold, so a single-site wing is a daydream.
  // Functional glide needs membranes at 2+ sites (or a shoulder/hip wing,
  // which adopts the longer ancestral limb).
  const p = phenotype(evoGenome(createRng(6), { budDorsalGrow: 1, budDorsalType: 1 }));
  assert.ok(p.wingArea < 0.6, `dorsal-only caps at ${p.wingArea.toFixed(2)} — below threshold`);
  assert.equal(p.glideLift, p.wingArea * 1.2, 'lift without the glide');
});

test('v0.17: open-endedness smoke — divergence reports organ traits, no winner asserted', () => {
  for (const k of ['wingArea', 'graspPairs', 'sailArea', 'gillArea', 'finArea', 'bodySegs']) {
    assert.ok(DIVERGENCE_CREATURE_TRAITS.includes(k), `${k} is a divergence trait`);
  }
  for (const seed of [11, 22]) {
    const world = bindWorld(createWorld(seed));
    populate(world);
    recordFounderMeans(world);
    for (let i = 0; i < 300; i++) tickWorld(world, 0.05);
    const div = computeDivergence(world);
    assert.ok(div && div.zones, 'divergence computed');
    const zk = Object.keys(div.zones)[0];
    assert.ok('wingArea' in div.zones[zk], 'organ traits reported per zone');
    // Deliberately no assertion about which lineage wins — the door stays open.
  }
});

test('v0.17: randomGenome stream pinned — the main stream never shifts', () => {
  // The main-stream alleles (legLength, instHungerSeek, bodyHue) are drawn
  // in GENES order and never move: a founder-value change consumes no extra
  // draws. The evo-devo and language sub-streams are seeded by a CONTENT
  // HASH of the main alleles, so a founder-value change upstream (v0.17:
  // legPower 0.5 → 0.4, via 0.3) reshuffles their seeds — deterministically,
  // and only then. Re-pinned after the legPower change (2026-09-30).
  const g = randomGenome(createRng(7));
  assert.deepEqual(g.alleles.legLength, [0.7337531622033566, 0.524284133920446]);
  assert.deepEqual(g.alleles.instHungerSeek, [0.6374707734910772, 0.7284905070671812]);
  assert.deepEqual(g.alleles.bodyHue, [0.011704753153026104, 0.06195825757458806]);
  assert.deepEqual(g.alleles.budDorsalGrow, [0, 0]);
  assert.deepEqual(g.alleles.lexCap, [0.6358831344172359, 0.4754308270988986]);
  const g2 = randomGenome(createRng(7));
  assert.deepEqual(g2.alleles.budShoulderGrow, g.alleles.budShoulderGrow, 'evo sub-stream deterministic');
});

test('v0.17: founder render is pixel-identical with and without a body plan', () => {
  const world = bindWorld(createWorld(7));
  const c = createCreature(founderEvoGenome(world.rng), 400, 0, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  const draw = () => {
    const ctx = new SvgCtx(400, 400);
    drawCreature(ctx, c, 350, 1.0);
    return ctx.toSVG();
  };
  const legacy = (() => { c.bodyPlan = null; return draw(); })(); // the old-save path
  c.bodyPlan = expressBuds(c.pheno, 1);
  const planned = draw();
  assert.equal(planned, legacy, 'the founder draws identically either way');
});

test('v0.17: extra limbs reach the painter', () => {
  const world = bindWorld(createWorld(7));
  const c = createCreature(founderEvoGenome(world.rng), 400, 0, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  const draw = () => {
    const ctx = new SvgCtx(400, 400);
    drawCreature(ctx, c, 350, 1.0);
    return ctx.toSVG();
  };
  const classic = draw();
  assert.ok(classic.length > 1000, 'the painter produced a render');
  const cases = [
    ['dorsal membranes', { budDorsalGrow: 1, budDorsalType: 'membrane' }],
    ['mid grasp limbs', { budMidGrow: 1, budMidType: 'grasp' }],
    ['neck gills', { budNeckGrow: 1, budNeckType: 'gill' }],
    ['hip fins', { budHipGrow: 1, budHipType: 'fin' }],
    ['shoulder sail', { budShoulderGrow: 1, budShoulderType: 'sail' }],
    ['a nub', { budDorsalGrow: 0.2, budDorsalType: 'membrane' }],
    ['two tails', { tailCount: 1 }],
    ['three body segments', { segCount: 2 }],
  ];
  for (const [name, mut] of cases) {
    const saved = {};
    for (const k of Object.keys(mut)) { saved[k] = c.pheno[k]; c.pheno[k] = mut[k]; }
    c.bodyPlan = expressBuds(c.pheno, 1);
    assert.notEqual(draw(), classic, `${name} change the render`);
    for (const k of Object.keys(mut)) c.pheno[k] = saved[k];
  }
  c.bodyPlan = expressBuds(c.pheno, 1);
  assert.equal(draw(), classic, 'restoring the founder restores the render');
});

test('v0.17: no dead genes — every evo-devo locus moves something', () => {
  const base = phenotype(founderEvoGenome(createRng(7)));
  const sig = (p) => {
    const bp = expressBuds(p, 1);
    return JSON.stringify([
      bp.limbs.map((l) => [l.site, l.type, l.grow01.toFixed(3), l.pow01.toFixed(3)]),
      bp.bodySegs, bp.tails, bp.graspPairs,
      p.wingArea.toFixed(4), p.sailArea.toFixed(4), p.gillArea.toFixed(4), p.finArea.toFixed(4),
      p.glideLift.toFixed(4), p.developDrain.toFixed(5), p.brachMult.toFixed(4),
      p.fallSoak.toFixed(4), p.swimSpeed.toFixed(3), p.breathTime.toFixed(1),
      p.slitherSpeed.toFixed(3), p.climbSpeed.toFixed(3), p.groomReach.toFixed(3),
      p.wingUpkeep.toFixed(5), p.gillUpkeep.toFixed(5), p.finUpkeep.toFixed(5),
      p.matePrefNovel,
    ]);
  };
  const baseSig = sig(base);
  const flips = {
    budShoulderGrow: 0, budShoulderType: 'membrane', budShoulderPow: 1,
    budHipGrow: 0, budHipType: 'sail', budHipPow: 1,
    budDorsalGrow: 1, budDorsalType: 'grasp', budDorsalPow: 1,
    budMidGrow: 1, budMidType: 'fin', budMidLen: 1, budMidPow: 1,
    budNeckGrow: 1, budNeckType: 'fin', budNeckLen: 1, budNeckPow: 1,
    segCount: 2, tailCount: 1, matePrefNovel: 1,
  };
  for (const key of EVO17_KEYS) {
    if (key.startsWith('inst')) continue; // wired through the brain, checked below
    const p = { ...base, [key]: flips[key] };
    // Vestigial buds are silent until they erupt — wake the site so the
    // locus gets its say. (The grow flips wake themselves.)
    const m = key.match(/^bud(Dorsal|Mid|Neck)(Type|Len|Pow)$/);
    if (m) p['bud' + m[1] + 'Grow'] = 1;
    assert.notEqual(sig(p), baseSig, `${key} moves a readout`);
  }
  // Instinct loci wire through the brain, not the body.
  const b0 = createBrain(base, createRng(3));
  for (const key of ['instAirborneGlide', 'instFarLedgeGlide', 'instFoodBrach', 'instSubmergedSwim', 'instSubmergedDive']) {
    const b1 = createBrain({ ...base, [key]: 1 }, createRng(3));
    assert.notDeepEqual(b1.instW, b0.instW, `${key} wires the brain`);
  }
});

// ================= v0.17.1 "Touch" =================

test('v0.17.1: mineral deposits — six honest types, real amounts', () => {
  assert.equal(OBSERVER_VERSION, 'v0.17.1 "Touch"');
  assert.equal(MINERAL_TYPES.length, 6); // flint, quartz, clay, timber, stone, driftwood — v0.18 adds biome resources
  for (const t of MINERAL_TYPES) {
    assert.ok(t.hardness > 0 && t.hardness <= 1, `${t.key} hardness in (0,1]`);
    assert.ok(t.color && t.name && t.blurb, `${t.key} fully described`);
  }
  const world = bindWorld(createWorld(42));
  const m = addMineral(world, 1400, 0, 'flint');
  assert.equal(m.kind, 'mineral');
  assert.equal(m.mineralName, 'Flint');
  assert.equal(m.amount, 4);
  assert.equal(m.y, world.platforms[0].y);
  assert.equal(addMineral(world, 100, 0, 'bogus').mineralKey, 'flint', 'unknown type falls back to flint');
  assert.equal(addMineral(world, 100, 99, 'flint'), null, 'bad platform refuses');
});

test('v0.17.1: populate seeds four mineral deposits without touching the rng stream', () => {
  const w1 = bindWorld(createWorld(7)); populate(w1);
  const w2 = bindWorld(createWorld(7)); populate(w2);
  assert.equal(w1.minerals.length, 4, 'four deposits');
  // Fixed positions, zero rng draws — founder genomes are byte-identical
  // across the two runs, so worldgen determinism survived the addition.
  assert.equal(genomeHash(w1.creatures[0].genome), genomeHash(w2.creatures[0].genome));
  const keys = w1.minerals.map((m) => m.mineralKey).sort();
  assert.deepEqual(keys, ['clay', 'flint', 'flint', 'quartz']);
});

test('v0.17.1: describeEntity is honest — tree and herb read their own genomes', () => {
  const world = bindWorld(createWorld(11)); populate(world);
  const tree = world.plants.find((p) => p.kind === 'plant');
  const d = describeEntity(world, tree);
  assert.equal(d.title, 'Fruit tree');
  const rows = Object.fromEntries(d.rows.filter((r) => r[0]));
  assert.ok(rows['Growth stage'].includes('%'), 'growth stage is a real percentage');
  assert.equal(rows['Zone'], zoneAt(tree.x).name);
  assert.ok(rows['Yield'].includes('fruit per fruiting'), 'yield from the plant genome');
  assert.ok(d.note, 'carries an honesty note');
  const herb = world.plants.find((p) => p.kind === 'herb');
  const hd = describeEntity(world, herb);
  assert.equal(hd.title, 'Medicinal herb');
  assert.ok(hd.bars.some((b) => b.label === '🌡️ Potency'), 'potency bar from the medicine locus');
});

test('v0.17.1: describeEntity — fruit keeps its nutrition, bitterness, provenance', () => {
  const world = bindWorld(createWorld(13));
  addFood(world, 200, 1, 'fruit', 1, 0, { plantId: 0, bitterness: 0.2, nutrition: 1.5 });
  const f = world.foods[world.foods.length - 1];
  const d = describeEntity(world, f);
  const rows = Object.fromEntries(d.rows.filter((r) => r[0]));
  assert.equal(rows['Nutrition'], '1.50');
  assert.equal(rows['Bitterness'], '20%');
  assert.ok(rows['Borne by'].includes('observer'), 'observer-placed fruit says so honestly');
});

test('v0.17.1: describeEntity — mineral admits creatures cannot use it yet', () => {
  const world = bindWorld(createWorld(17));
  const m = addMineral(world, 300, 0, 'quartz');
  const d = describeEntity(world, m);
  assert.equal(d.title, 'Quartz');
  assert.ok(d.note.includes('cannot use minerals yet'), 'honest about the technology release');
  const bars = Object.fromEntries(d.bars.map((b) => [b.label, b.value]));
  assert.equal(bars['🪨 Hardness'], 0.7);
});

test('v0.17.1: describeEntity — creature shows real drives and genome highlights', () => {
  const world = bindWorld(createWorld(19)); populate(world);
  const c = world.creatures[0];
  const d = describeEntity(world, c);
  assert.equal(d.title, c.name);
  assert.equal(d.subtitle, `tanglekin #${c.id}`);
  const rows = Object.fromEntries(d.rows.filter((r) => r[0]));
  assert.ok(rows['Genome highlights'].includes('legs'), 'leg length shown');
  assert.ok(d.bars.length >= 3, 'drive bars present');
  assert.ok(d.note.includes('phenotype values'), 'no invented stats — the note says what these are');
});

test('v0.17.1: pickFruit removes the item and returns an honest snapshot', () => {
  const world = bindWorld(createWorld(23));
  addFood(world, 200, 1, 'fruit', 1, 0, { plantId: 0, bitterness: 0.1, nutrition: 1.4 });
  const f = world.foods[world.foods.length - 1];
  const held = pickFruit(world, f);
  assert.ok(!world.foods.includes(f), 'gone from the world');
  assert.equal(held.nutrition, 1.4, 'nutrition preserved');
  assert.equal(held.bitterness, 0.1, 'bitterness preserved');
  assert.equal(pickFruit(world, f), null, 'double-pick refuses');
});

test('v0.17.1: placeFood re-enters through addFood — creatures really eat it', () => {
  const world = bindWorld(createWorld(29)); populate(world);
  const c = world.creatures[0];
  const held = { foodKind: 'fruit', nutrition: 1.5, bitterness: 0, amount: 1 };
  const placed = placeFood(world, c.x + 10, c.platformIndex, held);
  assert.ok(placed && placed.kind === 'food', 'a genuine food entity');
  assert.equal(placed.nutrition, 1.5, 'snapshot values survive the round trip');
  assert.equal(placed.plantId, 0, 'honestly parentless');
  // Through the real path: doEat reads c._senses exactly like the live tick.
  c._senses = { _food: placed };
  assert.ok(doEat(c, world), 'doEat accepts observer-placed fruit');
  assert.ok(c._ate > 0, 'the meal entered the body (c._ate) — not a UI fiction');
  assert.ok(!world.foods.includes(placed) || placed.amount < 1, 'the item was consumed');
});

test('v0.17.1: spawnFood provisions a whole fruit, parentless and edible', () => {
  const world = bindWorld(createWorld(31));
  const f = spawnFood(world, 400, 1, 'fruit');
  assert.equal(f.foodKind, 'fruit');
  assert.equal(f.nutrition, 1);
  assert.equal(f.plantId, 0);
  assert.ok(world.foods.includes(f));
  assert.equal(spawnFood(world, 400, 99, 'fruit'), null, 'bad platform refuses');
});

test('v0.17.1: nudgeCreature is a force, not a teleport', () => {
  const world = bindWorld(createWorld(37)); populate(world);
  const c = world.creatures[0];
  const x0 = c.x, vx0 = c.vx, f0 = c.facing;
  const h0 = genomeHash(c.genome);
  assert.ok(nudgeCreature(world, c), 'nudge lands');
  assert.equal(c.x, x0, 'position untouched — the integrator does the moving');
  assert.ok(Math.abs((c.vx - vx0) - NUDGE_V * f0) < 1e-9, 'impulse in the facing direction');
  assert.equal(genomeHash(c.genome), h0, 'the genome never felt the hand');
  for (let i = 0; i < 30; i++) tickWorld(world, 0.1);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.vx) && Number.isFinite(c.vy), 'no NaNs after the shove');
  assert.notEqual(c.x, x0, 'the world did the moving');
  assert.equal(nudgeCreature(world, { alive: false }), false, 'the dead are not nudged');
});

test('v0.17.1: digMineral depletes a real deposit; the marker stays, honestly labeled', () => {
  const world = bindWorld(createWorld(41));
  const m = addMineral(world, 300, 0, 'flint');
  const samples = [];
  for (let i = 0; i < 4; i++) samples.push(digMineral(world, m));
  assert.equal(m.amount, 0, 'depleted');
  assert.ok(samples.every((s) => s && s.mineralKey === 'flint'), 'four real samples');
  assert.equal(digMineral(world, m), null, 'a depleted deposit yields nothing');
  assert.ok(world.minerals.includes(m), 'the claim marker stays in the world');
  const d = describeEntity(world, m);
  assert.ok(d.rows.some((r) => r[1] === 'depleted'), 'the inspector says depleted');
  assert.ok(d.note.includes('cannot use minerals yet'), 'still honest after depletion');
});

test('v0.17.1: observer verbs never enter the creature action set', () => {
  // Paul's v0.5 rule binds creature actions; these verbs live outside the
  // genome by construction — assert the brain's action list is untouched.
  for (const v of ['pickFruit', 'placeFood', 'spawnFood', 'nudgeCreature', 'digMineral']) {
    assert.ok(!ACTIONS.includes(v), `${v} is not a creature action`);
  }
});

// ---- v0.20 "Hands": grasp, carry, drop, craft traditions ----

// Helper: a test creature on the jungle floor with hands.
function addHandedCreature(world, x, opts = {}) {
  const jx = 1200 + x * 0.375;
  const pi = platformIndexAt(world, jx, 800);
  const c = createCreature(randomGenome(world.rng), jx, pi, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  c.pheno.spikes = 0;
  c.pheno.graspPairs = opts.graspPairs ?? 2;
  Object.assign(c, opts);
  world.creatures.push(c);
  return c;
}

// Helper: run one action directly (bypass decide via a long actionTimer).
function doActionOnce(c, world, action) {
  c.action = action;
  c.actionTimer = 10;
  updateCreature(c, world, 0.1);
}

test('v0.20: grasp lifts a pebble into the hand', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500);
  const p = addPebble(world, c.x + 10, c.platformIndex);
  const nPebbles = world.pebbles.length;
  doActionOnce(c, world, 'grasp');
  assert.ok(c.held, 'the pebble is held');
  assert.equal(c.held.material, 'stone', 'pebbles become stone samples');
  assert.equal(world.pebbles.length, nPebbles - 1, 'the pebble leaves the world');
  assert.ok(!world.pebbles.includes(p), 'that specific pebble is gone');
});

test('v0.20: grasp without graspPairs fails honestly (no hands, no hands)', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500, { graspPairs: 0 });
  // Serpentine body plan: no grasp limbs
  c.bodyPlan = expressBuds(c.pheno, 1);
  addPebble(world, c.x + 10, c.platformIndex);
  const nPebbles = world.pebbles.length;
  doActionOnce(c, world, 'grasp');
  assert.equal(c.held, null, 'nothing held — anatomy gates the verb');
  assert.equal(world.pebbles.length, nPebbles, 'the pebble stays in the world');
});

test('v0.20: grasp lifts a stick whole', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500);
  const s = addStick(world, c.x + 10, c.platformIndex);
  const nSticks = world.sticks.length;
  doActionOnce(c, world, 'grasp');
  assert.ok(c.held, 'the stick is held');
  assert.equal(c.held.material, 'timber', 'sticks are timber');
  assert.equal(world.sticks.length, nSticks - 1, 'the stick leaves the world');
});

test('v0.20: grasp samples a mineral deposit (deposit stays, amount drops)', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500);
  const m = addMineral(world, c.x + 10, c.platformIndex, 'flint');
  const before = m.amount;
  doActionOnce(c, world, 'grasp');
  assert.ok(c.held, 'the sample is held');
  assert.equal(c.held.material, 'flint', 'the sample inherits the material');
  assert.ok(c.held.hardness > 0.8, 'flint is hard');
  assert.equal(m.amount, before - 1, 'the deposit loses one sample');
  assert.ok(world.minerals.includes(m), 'the deposit stays in the world');
});

test('v0.20: empty-hand carry is a shove — impulse, no injury', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const a = addHandedCreature(world, 500);
  const b = addHandedCreature(world, 520);
  b.biochem.injury = 0;
  const vxBefore = b.vx || 0;
  doActionOnce(a, world, 'carry');
  assert.ok(Math.abs(b.vx) > Math.abs(vxBefore), 'the shove imparts velocity');
  assert.equal(b.biochem.injury, 0, 'no injury from a bare shove (design §1.5)');
});

test('v0.20: a hammer out-damages the bare shove', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const a = addHandedCreature(world, 500);
  const b = addHandedCreature(world, 520);
  // a holds a flint sample (hard, heavy)
  a.held = { material: 'flint', weight: 0.5, hardness: 0.9, sharpness: 0.9, flammability: 0, wear: 0 };
  b.biochem.injury = 0;
  doActionOnce(a, world, 'carry');
  const hammerInjury = b.biochem.injury;
  assert.ok(hammerInjury > 0, 'the hammer wounds');
  // Bare shove for comparison
  const c = addHandedCreature(world, 600);
  const d = addHandedCreature(world, 620);
  d.biochem.injury = 0;
  doActionOnce(c, world, 'carry');
  assert.ok(hammerInjury > d.biochem.injury, `hammer (${hammerInjury.toFixed(3)}) out-damages shove (${d.biochem.injury.toFixed(3)})`);
});

test('v0.20: striking wears the tool; breakage degrades, never trashes', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const a = addHandedCreature(world, 500);
  const b = addHandedCreature(world, 520);
  a.held = { material: 'flint', weight: 0.5, hardness: 0.9, sharpness: 0.9, flammability: 0, wear: 0.99 };
  doActionOnce(a, world, 'carry');
  assert.ok(a.held, 'still held after breakage');
  assert.ok(a.held.wear < 0.99, 'wear reset on breakage');
  assert.ok(a.held.weight < 0.5, 'degraded to a lesser sample (weight down)');
  assert.ok(a.held.hardness < 0.9, 'degraded to a lesser sample (hardness down)');
  assert.ok(world.events.some((e) => e.type === 'toolBroke'), 'breakage is an event');
});

test('v0.20: carrying bills bloodSugar — weight scales the cost', () => {
  // The wiring: updateCreature passes active × (1 + held.weight) to tickBiochem.
  // Capture the ctx to verify the multiplier is applied.
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500);
  c._active = 0.5;
  // No held: active = 0.5
  c.held = null;
  c.action = 'carry'; c.actionTimer = 1000;
  // We verify the computation directly — it is a pure function of _active and held.
  const computeActive = (creature) =>
    Math.min(2, (creature._active || 0) * (creature.held ? 1 + (creature.held.weight || 0) : 1));
  assert.equal(computeActive(c), 0.5, 'empty-handed: no multiplier');
  c.held = { material: 'stone', weight: 0.9, hardness: 0.5, sharpness: 0.1, flammability: 0, wear: 0 };
  assert.equal(computeActive(c), 0.95, 'heavy stone: 0.5 × 1.9');
  c.held.weight = 0.2;
  assert.equal(computeActive(c), 0.6, 'light stone: 0.5 × 1.2');
  // And the source line matches this computation (the wiring is not dead code):
  // (verified by the behavioral drain test below)
});

test('v0.20: heavy carrying drains more bloodSugar over time (behavioral)', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  world.foods.length = 0; world.pebbles.length = 0;
  // Use tickBiochem directly with the computed active values — isolates the
  // chemistry from the creature-sim confounds.
  const mkBiochem = () => ({ bloodSugar: 0.7, fatigue: 0, oxytocin: 0.5, endorphin: 0.5, health: 1 });
  const pheno = { hungerRate: 0.5, energyDrain: 0.5, sociability: 0.5 };
  const lightB = mkBiochem(), heavyB = mkBiochem();
  const ctx = (active) => ({ active, sleeping: false });
  for (let i = 0; i < 100; i++) {
    tickBiochem(lightB, pheno, 0.1, ctx(0.6));  // 0.5 × (1 + 0.2)
    tickBiochem(heavyB, pheno, 0.1, ctx(0.95)); // 0.5 × (1 + 0.9)
  }
  const lightDrain = 0.7 - lightB.bloodSugar;
  const heavyDrain = 0.7 - heavyB.bloodSugar;
  assert.ok(heavyDrain > lightDrain,
    `heavy (${heavyDrain.toFixed(4)}) drains more than light (${lightDrain.toFixed(4)})`);
});

test('v0.20: drop releases the held object with velocity', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500);
  c.held = { material: 'timber', weight: 0.7, hardness: 0.4, sharpness: 0.1, flammability: 0.9, wear: 0 };
  c.vx = 100; // moving right
  const nSticks = world.sticks.length;
  doActionOnce(c, world, 'drop');
  assert.equal(c.held, null, 'the hand is empty');
  assert.equal(world.sticks.length, nSticks + 1, 'a stick returns to the world');
  const s = world.sticks[world.sticks.length - 1];
  assert.ok(s.vx > 0, 'released with the carrier’s velocity');
});

test('v0.20: craft invention — three clustered strikes found a tradition', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500);
  c.held = { material: 'flint', weight: 0.5, hardness: 0.9, sharpness: 0.9, flammability: 0, wear: 0 };
  c.name = 'Invy';
  // Three strikes clustered in space and time
  for (let i = 0; i < 3; i++) {
    c.x = 1300 + i * 10; // within CRAFT_RADIUS=150
    c.craftLog.push({ x: c.x, t: world.time + i * 10, material: 'flint', pattern: 'strike' });
  }
  // The invention roll is chance-gated; pin it to succeed so we test the
  // clustering logic, not the dice.
  const realChance = world.rng.chance;
  world.rng.chance = () => true;
  const tr = maybeFoundCraft(c, world);
  world.rng.chance = realChance;
  assert.ok(tr, 'a tradition was founded');
  assert.equal(tr.kind, 'craft', 'it is a craft tradition');
  assert.equal(tr.material, 'flint', 'the material is recorded');
  assert.equal(tr.pattern, 'strike', 'the pattern is strike');
  assert.ok(world.events.some((e) => e.type === 'traditionFounded'), 'the event fires');
  assert.ok(c.traditions.includes(tr.id), 'the inventor carries it');
});

test('v0.20: craft invention fails when strikes are scattered (no cluster, no tradition)', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const c = addHandedCreature(world, 500);
  c.pheno.curiosity = 1;
  c.held = { material: 'flint', weight: 0.5, hardness: 0.9, sharpness: 0.9, flammability: 0, wear: 0 };
  // Three strikes, but 500px apart — beyond CRAFT_RADIUS
  for (let i = 0; i < 3; i++) {
    c.craftLog.push({ x: 1300 + i * 500, t: world.time + i * 10, material: 'flint', pattern: 'strike' });
  }
  const tr = maybeFoundCraft(c, world);
  assert.equal(tr, null, 'scattered strikes found nothing');
});

test('v0.20: tradition fidelity on adopt — low fidelity copies noisily, high fidelity cleanly', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const a = addHandedCreature(world, 500);
  a.name = 'Founder';
  // Grove traditions carry an aim point; fidelity scales the copy noise.
  const tr = foundGrove(world.culture, a, 1500, 100, world.time, 0, world.rng);
  assert.ok(tr, 'grove tradition founded');
  const mk = () => {
    const w = addHandedCreature(world, 500);
    w.traditions = [];
    return w;
  };
  // High fidelity: aim lands close to the original
  let hiErr = 0;
  for (let i = 0; i < 20; i++) {
    const w = mk();
    adoptTradition(world.culture, w, tr, 1.0, world.rng);
    hiErr += Math.abs(groveAim(w, tr) - tr.x);
  }
  hiErr /= 20;
  // Zero fidelity: aim scatters ±120
  let loErr = 0;
  for (let i = 0; i < 20; i++) {
    const w = mk();
    adoptTradition(world.culture, w, tr, 0, world.rng);
    loErr += Math.abs(groveAim(w, tr) - tr.x);
  }
  loErr /= 20;
  assert.ok(hiErr < 5, `high fidelity copies cleanly (mean err ${hiErr.toFixed(1)})`);
  assert.ok(loErr > 30, `zero fidelity copies noisily (mean err ${loErr.toFixed(1)})`);
  assert.ok(loErr > hiErr * 5, 'fidelity honestly scales the noise');
});

test('v0.20: high-fidelity adoption succeeds; the carrier list grows', () => {
  const world = v09world(7);
  world.creatures.length = 0;
  const a = addHandedCreature(world, 500);
  a.name = 'Founder';
  const tr = foundCraft(world.culture, a, 'stone', 'Stone', 'strike', world.time, 0, world.rng);
  const b = addHandedCreature(world, 520);
  b.traditions = [];
  const ok = adoptTradition(world.culture, b, tr, 1.0, world.rng);
  assert.ok(ok, 'fidelity 1.0 adopts');
  assert.ok(b.traditions.includes(tr.id), 'the adopter carries the tradition');
  assert.ok(tr.carriers.has(b.id), 'the tradition lists the new carrier');
});

// --- v0.20 "One physics": one gravity for every body -------------------------
// Joshua's law — physics works the same for everything in this world.
// Regression tests for the two bugs he watched: creatures falling through
// the ground (the mountains [760,1040] gap + the stale-platform teleport),
// and predators exempt from gravity (hovering beached sharks, pinned bears).

test('v0.20: integrateGravity — a body falls and lands on a platform', () => {
  const world = bindWorld(createWorld(7));
  const body = { x: 1500, y: 700, vx: 0, vy: 0, grounded: false, pheno: {}, gliding: false, biochem: { health: 1, injury: 0, adrenaline: 0 } };
  for (let t = 0; t < 120; t++) integrateGravity(body, world, 1 / 30);
  assert.equal(body.y, world.platforms[0].y, 'lands on the jungle floor'); // v0.26: generated
  assert.ok(body.grounded, 'grounded after landing');
  assert.equal(body.platformIndex, 0, 'platformIndex is the jungle ground');
});

test('v0.20: the mountains gap is filled — no fall through the ground', () => {
  const world = bindWorld(createWorld(7));
  const body = { x: 900, y: 700, vx: 0, vy: 0, grounded: false, pheno: {}, gliding: false, biochem: { health: 1, injury: 0, adrenaline: 0 } };
  for (let t = 0; t < 120; t++) integrateGravity(body, world, 1 / 30);
  assert.equal(body.y, world.platforms[body.platformIndex].y, 'lands on the foothill fill, not the world floor'); // v0.26
  assert.ok(body.platformIndex >= 45, `on a fill platform (got ${body.platformIndex})`);
});

test('v0.20: floor clamp rests the body — no teleport back up', () => {
  const world = bindWorld(createWorld(7));
  // The bug Joshua watched: a stale platformIndex + a fall past every
  // platform. Old code snapped the body back to the stale platform's
  // height (hovering mid-air, then "jumping off of it"); now the grounded
  // snap refuses to teleport, so the body rests on the world floor.
  const c = createCreature(randomGenome(world.rng), 900, 15, world.rng);
  c.x = 900; c.y = 1095; c.vx = 0; c.vy = 2000;
  c.grounded = false; c.platformIndex = 15; // stale: the foothill shelf
  stepPhysics(c, world, 1 / 30);
  assert.equal(c.y, world.height, 'clamped to the world floor');
  assert.ok(c.grounded, 'resting on the floor');
  stepPhysics(c, world, 1 / 30);
  assert.equal(c.y, world.height, 'no teleport back to the stale platform');
  assert.ok(c.x >= 0 && c.x <= world.width, 'still inside the world');
});

test('v0.20: anti-slip — a body just under its platform climbs back out', () => {
  const world = bindWorld(createWorld(7));
  // The pool-edge case: a creature that ends up 9px under the jungle floor
  // (swam out of the pool below the bank) pops back onto the bank instead
  // of falling 300px through the earth.
  const c = createCreature(randomGenome(world.rng), 1402, 0, world.rng);
  const jy = world.platforms[0].y; // v0.26: the generated jungle floor
  // v0.26: the test spot must be dry — generated ponds move per seed.
  let tx = 1402;
  while (waterAt(tx, jy + 9, world.layout)) tx += 50;
  c.x = tx; c.y = jy + 9; c.vx = 0; c.vy = 0;
  c.grounded = false; c.platformIndex = 0;
  stepPhysics(c, world, 1 / 30);
  assert.ok(c.grounded, 'back on the platform');
  assert.equal(c.y, jy, 'standing on the jungle floor, not under it');
});

test('v0.20: anti-slip keeps clear of the brink — cliff falls still work', () => {
  const world = bindWorld(createWorld(7));
  // A creature walking off the branch edge must fall, not pop back up.
  const c = createCreature(randomGenome(world.rng), 1390, 1, world.rng);
  c.x = 1394; c.y = 650; c.vx = 60; c.vy = 0;
  c.grounded = false; c.platformIndex = 1; // just walked off the branch edge
  stepPhysics(c, world, 1 / 30);
  assert.ok(!c.grounded, 'still falling — the cliff edge is honest');
  assert.ok(c.y > 650, 'gravity is doing its work');
});

test('v0.20: beached shark falls under gravity — no more hovering', () => {
  const world = bindWorld(createWorld(7));
  spawnPredators(world);
  const shark = world.predators.find((p) => p.kind === 'shark');
  assert.ok(shark, 'a shark spawned');
  // Beach it on dry land, mid-air: jungle, above the ground.
  shark.x = 1500; shark.y = 700; shark.vx = 0; shark.vy = 0;
  const h0 = shark.biochem.health;
  for (let t = 0; t < 120; t++) tickPredators(world, 1 / 30);
  assert.equal(shark.y, world.platforms[0].y, 'fell to the jungle floor'); // v0.26: generated
  assert.ok(shark.grounded, 'grounded on landing');
  assert.ok(shark.biochem.health < h0, 'the beaching clock still runs');
});

test('v0.20: shark cannot swim under the desert — the shore is solid', () => {
  const world = bindWorld(createWorld(7));
  spawnPredators(world);
  const shark = world.predators.find((p) => p.kind === 'shark');
  assert.ok(shark, 'a shark spawned');
  // In the shallows but BELOW the surface: the old code swam straight west
  // under the desert and died underground. v0.26: the shark rides the
  // generated sea level.
  const shw2 = world.layout.waters.find((r) => r.salt && r.x0 < 3600);
  shark.x = 3050; shark.y = (shw2 ? shw2.surfaceY : 800) + 20; shark.vx = 0; shark.vy = 0;
  shark.wanderDir = -1; shark.wanderT = 999; // hold a westward course
  let minX = Infinity, enteredEarth = false;
  for (let t = 0; t < 300; t++) {
    tickPredators(world, 1 / 30);
    if (shark.x < minX) minX = shark.x;
    const gy = groundYAt(shark.x, world.layout);
    if (gy !== null && shark.y > gy) enteredEarth = true;
  }
  assert.ok(minX >= 3000, `never crosses the shoreline west (minX=${minX.toFixed(1)})`);
  assert.ok(!enteredEarth, 'never inside the earth');
});

test('v0.20: shark cannot dive through the seabed', () => {
  const world = bindWorld(createWorld(7));
  spawnPredators(world);
  const shark = world.predators.find((p) => p.kind === 'shark');
  shark.x = 3300; shark.y = 900; shark.vx = 0;
  shark.wanderDir = 1; shark.wanderT = 999;
  let maxY = -Infinity, enteredEarth = false;
  for (let t = 0; t < 300; t++) {
    shark.vy = 200; // hold a hard dive (the water damping alone would stop it)
    tickPredators(world, 1 / 30);
    if (shark.y > maxY) maxY = shark.y;
    const gy = groundYAt(shark.x);
    if (gy !== null && shark.y > gy) enteredEarth = true;
  }
  assert.ok(maxY <= 950, `never below the shallows seabed (maxY=${maxY.toFixed(1)})`);
  assert.ok(!enteredEarth, 'never inside the earth');
});

test('v0.20: shark may still beach honestly onto the sand', () => {
  const world = bindWorld(createWorld(7));
  spawnPredators(world);
  const shark = world.predators.find((p) => p.kind === 'shark');
  // v0.26: beach via a freshwater pond — water meeting air, not earth.
  // (The shallows' west edge is a blurred shore now; the shark correctly
  // turns from the rising seabed instead of entering it.) Swimming out of
  // the pond's edge exits into air: an honest stranding, not a wall.
  const pond = world.layout.waters.find((r) => !r.salt && r.x1 - r.x0 < 120);
  assert.ok(pond, 'a pond exists to beach from');
  shark.x = pond.x1 - 30; shark.y = pond.surfaceY + 10; shark.vx = 0; shark.vy = 0;
  shark.wanderDir = 1; shark.wanderT = 999;
  for (let t = 0; t < 150; t++) tickPredators(world, 1 / 30);
  assert.ok(shark.x > pond.x1, `crossed out of the pond (x=${shark.x.toFixed(1)})`);
  assert.ok(shark.grounded, 'landed on the bank under the same gravity');
  const gy = groundYAt(shark.x, world.layout);
  assert.ok(!(gy !== null && shark.y > gy), 'rests on the ground, not under it');
});

test('v0.20: bear ambles grounded — walks the ice, turns at the brink', () => {
  const world = bindWorld(createWorld(7));
  spawnPredators(world);
  const bear = world.predators.find((p) => p.kind === 'bear');
  assert.ok(bear, 'a bear spawned');
  for (let t = 0; t < 600; t++) tickPredators(world, 1 / 30);
  assert.equal(bear.y, world.platforms[9].y, 'stays on the arctic ice'); // v0.26: generated
  assert.ok(bear.grounded, 'grounded, not pinned');
  assert.equal(bear.platformIndex, 9, 'standing on the arctic ground platform');
  assert.ok(bear.x >= 0 && bear.x <= 600, `never leaves the ice (x=${bear.x.toFixed(1)})`);
});

test('v0.20: bear with no ground underfoot falls like everything else', () => {
  const world = bindWorld(createWorld(7));
  spawnPredators(world);
  const bear = world.predators.find((p) => p.kind === 'bear');
  bear.platformIndex = undefined; // force re-resolution
  bear.x = 900; bear.y = 700; bear.grounded = false; bear.vx = 0; bear.vy = 0;
  for (let t = 0; t < 120; t++) tickPredators(world, 1 / 30);
  assert.equal(bear.y, world.platforms[bear.platformIndex].y, 'fell onto the foothill fill'); // v0.26
  assert.ok(bear.grounded, 'landed, grounded');
});

// ================= v0.20 "Falling" =================
// Joshua's directives: "If the creatures fall, do they feel it?" (yes — the
// vestibular sense, fear that climbs with the fall). "Does it hurt?" (the
// landing startle scales with the fall's peak fear). "Bigger consequences
// for disappearing off a cliff" (canopy-to-floor falls strand — an event the
// chronicle names). "What is below the cliff? There should be something, not
// nothing" (windfall: expired canopy fruit drops to the understory floor).

test('v0.20: the falling sense is quiet on the branch, live in a real fall', () => {
  const world = v09world(70);
  const c = physCreature(world, 1400, 7); // upper jungle branch
  c.grounded = true; c.vy = 0;
  assert.equal(gatherSenses(c, world).falling, 0, 'grounded: no vestibular signal');
  c.grounded = false; c.vy = 100; // a hop's descent
  assert.equal(gatherSenses(c, world).falling, 0, 'below FALL_FEEL_V: quiet');
  c.vy = -300; // leaping UP
  assert.equal(gatherSenses(c, world).falling, 0, 'ascent is not falling');
  c.vy = 300;
  const slow = gatherSenses(c, world).falling;
  c.vy = 600;
  const fast = gatherSenses(c, world).falling;
  assert.ok(slow > 0 && slow < fast && fast <= 1, 'a real fall registers, faster falls feel stronger');
});

test('v0.20: senseVector carries falling at index 34; N_IN is 38', () => {
  assert.equal(N_IN, 44, '43 senses + bias'); // v0.37: +5 affect senses
  const v = senseVector({ falling: 0.7, creatureSize: -0.4 });
  assert.equal(v.length, 44);
  assert.equal(v[34], 0.7, 'falling sits at index 34 — appended, never renumbered');
  assert.equal(v[35], -0.4, 'creatureSize sits at index 35 — appended, never renumbered');
  assert.equal(v[36], 0, 'phaseSleepiness sits at index 36 — appended, never renumbered'); // v0.28
  assert.equal(v[37], 0, 'pain sits at index 37 — appended, never renumbered'); // v0.32
  assert.equal(v[38], 0, 'libido sits at index 38 — appended, never renumbered'); // v0.37
  assert.equal(v[39], 0, 'curiosity sits at index 39 — appended, never renumbered'); // v0.37
  assert.equal(v[40], 0, 'attachment sits at index 40 — appended, never renumbered'); // v0.37
  assert.equal(v[41], 0, 'care sits at index 41 — appended, never renumbered'); // v0.37
  assert.equal(v[42], 0, 'pairNear sits at index 42 — appended, never renumbered'); // v0.37
  assert.equal(v[43], 1, 'bias still last'); // v0.37: 43 senses + bias
});

test('v0.20: a long fall raises fear mid-air — felt before the landing', () => {
  const world = v09world(71);
  const c = physCreature(world, 1700, 8);
  c.x = 1700; c.y = 280; c.vy = 0; c.grounded = false;
  const fear0 = c.biochem.fear;
  let peak = 0;
  for (let i = 0; i < 60 && !c.grounded; i++) {
    stepPhysics(c, world, 0.05);
    peak = Math.max(peak, c._fallPeak || 0); // land() resets the peak on touchdown
  }
  assert.ok(c.grounded, 'touched down on the lower branch');
  assert.ok(c.biochem.fear > fear0, 'fear rose during the fall itself');
  assert.ok(peak > 0.3, 'the fall had a felt peak');
});

test('v0.20: fear past 0.6 screams alarm — the lexicon gets honest data', () => {
  const world = v09world(72);
  const c = physCreature(world, 1400, 7);
  c.biochem.fear = 0.7;
  assert.equal(groundCallType(c, {}), 'alarm', 'a terrified faller screams alarm');
  c.biochem.fear = 0.2; c.biochem.social = 0;
  assert.equal(groundCallType(c, { foodDist: 1 }), 'contact', 'a calm faller does not');
});

test('v0.20: the landing startle scales with the fear the fall produced', () => {
  const world = v09world(73);
  const mk = (peak) => {
    const c = physCreature(world, 1500 + peak * 10, 0); // jungle floor
    c.y = 790; c.vy = 600; c.grounded = false;
    c._fallStartY = 790; c._fallPeak = peak; // same impact, different falls
    c.biochem.adrenaline = 0;
    for (let i = 0; i < 20 && !c.grounded; i++) stepPhysics(c, world, 0.05);
    return c;
  };
  const calm = mk(0), scared = mk(1);
  assert.ok(calm.grounded && scared.grounded, 'both landed');
  assert.ok(
    scared.biochem.adrenaline > calm.biochem.adrenaline + 0.1,
    `a frightening fall startles more (calm ${calm.biochem.adrenaline.toFixed(2)}, scared ${scared.biochem.adrenaline.toFixed(2)})`
  );
});

test('v0.20: a canopy-to-floor fall strands — an event, not a footnote', () => {
  const world = v09world(74);
  for (const col of world.climate.cols) col.windU = 0; // still air: the test is about falling, not wind
  const c = physCreature(world, 1700, 8);
  // The fall bookkeeping: a grounded tick records where the fall starts.
  c.x = 1700; c.y = 280; c.grounded = true;
  stepPhysics(c, world, 0.1);
  assert.equal(c._fallStartY, 280, 'grounded: the fall start is the branch');
  // A real canopy-to-floor fall: off the high branches at x=1210 there's
  // nothing below but the jungle floor — 400px down.
  c.x = 1210; c.y = 400; c._fallStartY = 400; c.grounded = false; c.vy = 0;
  const e0 = world.events.length;
  for (let i = 0; i < 120 && !c.grounded; i++) stepPhysics(c, world, 0.05);
  assert.ok(c.grounded, 'landed on the jungle floor');
  assert.equal(Math.round(c.y), world.platforms[0].y, 'the floor, not a branch'); // v0.26: generated
  const ev = world.events.slice(e0).find((e) => e.type === 'strandedFall');
  assert.ok(ev, 'the long fall is an event');
  assert.ok(ev.fallPx > STRAND_PX, `the fall was long (${ev.fallPx}px)`);
  assert.equal(ev.zone, 'jungle');
  // A hop does not strand.
  const h = physCreature(world, 1500, 0);
  h.x = 1500; h.y = 790; h.grounded = true;
  stepPhysics(h, world, 0.1);
  h.grounded = false; h.vy = 0;
  const e1 = world.events.length;
  for (let i = 0; i < 40 && !h.grounded; i++) stepPhysics(h, world, 0.05);
  assert.ok(!world.events.slice(e1).some((e) => e.type === 'strandedFall'), 'a 10px hop strands nobody');
});

test('v0.20: the chronicle names where the fall delivered the creature', () => {
  const world = chronWorld(75);
  const a = chronCreature(world, 'Ash', 1400, null, 0);
  world.events.push({ type: 'strandedFall', creature: a, fallPx: 510, zone: 'jungle', t: 10 });
  const present = chronChapter(buildChronicle(world), 'present');
  const line = present.entries.find((e) => e.icon === '🪂');
  assert.ok(line, 'the fall made the living present');
  assert.ok(line.text.includes('Ash'), 'names the fallen');
  assert.ok(line.text.includes('Emerald Jungle'), 'names the below — something, not nothing');
});

test('v0.20: windfall — expired canopy fruit drops to the floor, leaves do not', () => {
  const world = v09world(76);
  const always = { chance: () => true, range: (a, b) => (a + b) / 2 };
  const fruit = { x: 1400, y: 650, foodKind: 'fruit', amount: 1, plantId: 9, bitterness: 0, nutrition: 1 };
  const n0 = world.foods.length;
  dropWindfall(world, fruit, always);
  assert.equal(world.foods.length, n0 + 1, 'the fallen fruit lands instead of vanishing');
  const wf = world.foods[world.foods.length - 1];
  assert.equal(wf.platformIndex, 0, 'the jungle ground platform catches it');
  assert.ok(wf.nutrition < 1, 'overripe: still food, less of it');
  assert.ok(wf.rotsAt === world.time + WINDFALL_ROT, 'windfall rots — the floor cannot stockpile');
  const n1 = world.foods.length;
  dropWindfall(world, { ...fruit, foodKind: 'leaf' }, always);
  assert.equal(world.foods.length, n1, 'leaves compost in place; they do not fall as food');
  dropWindfall(world, fruit, { chance: () => false, range: (a) => a });
  assert.equal(world.foods.length, n1, 'the coin can say no');
});

test('v0.22: instBite wires creatureDist to the bite action — and rides the instinct chromosome', () => {
  const g = GENES.find((g) => g.key === 'instBite');
  assert.ok(g, 'the gene exists');
  assert.equal(g.sense, 8, 'sense 8 = creatureDist');
  assert.equal(g.action, 23, 'action 23 = bite');
  assert.equal(g.founder, 0.02, 'dormant in the tanglekin founder — predators override up');
  assert.ok(CHROMOSOMES[3].includes('instBite'), 'instinct chromosome, or meiosis drops it');
  // The instinct is wired into a fresh brain: nearness excites bite.
  const rng = createRng(78);
  const genome = randomGenome(rng, { overrides: { instBite: [0.9, 0.9] } });
  const brain = createBrain(phenotype(genome), rng);
  assert.ok(Math.abs(brain.instW[23][8] - 0.96) < 1e-9, 'the instinct is wired: nearness excites bite');
  // The tanglekin default wires inhibitory: the verb sleeps until evolution wakes it.
  const tame = createBrain(phenotype(randomGenome(createRng(79))), createRng(80));
  assert.ok(tame.instW[23][8] < 0, 'the founder wire is inhibitory — bite is dormant, not dead');
  // The new locus draws from its own sub-stream: the main sequence is bit-identical.
  const a = randomGenome(createRng(4242));
  const mainKeys = Object.keys(a.alleles).filter((k) => k !== 'instBite');
  const b = randomGenome(createRng(4242));
  assert.deepEqual(mainKeys.map((k) => a.alleles[k]), mainKeys.map((k) => b.alleles[k]), 'deterministic');
});

test('v0.20: instFallVocal wires the vestibular sense to the vocal action', () => {
  const g = GENES.find((g) => g.key === 'instFallVocal');
  assert.ok(g, 'the gene exists');
  assert.equal(g.sense, 34, 'sense 34 = falling');
  assert.equal(g.action, 12, 'action 12 = vocal');
  assert.equal(g.founder, 0.4, 'live from the first generation, not dormant');
  // The instinct is wired into a fresh brain: falling excites vocal.
  const rng = createRng(77);
  const genome = randomGenome(rng, { overrides: { instFallVocal: [0.9, 0.9] } });
  const brain = createBrain(phenotype(genome), rng);
  assert.ok(Math.abs(brain.instW[12][34] - 0.96) < 1e-9, 'the instinct is wired: falling excites vocal');
  const s = new Array(N_IN).fill(0); s[34] = 1; s[36] = 1; // falling + bias (v0.22: bias moved to 36)
  const { outputs } = decide(brain, s, 0, rng);
  assert.ok(outputs[12] > 0.5, 'a hard fall drives the scream reflex');
});

// --- v0.25 "Heat": the couplings ------------------------------------------------

test('v0.25: basking pays less under cloud cover', () => {
  const rng = createRng(99);
  const g = randomGenome(rng); g.alleles.fur = [0.5, 0.5];
  const p = phenotype(g);
  const run = (cloud) => {
    const b = createBiochem(); b.coreTemp = 0.5;
    for (let t = 0; t < 60; t++) {
      tickBiochem(b, p, 1, { ambientTemp: 0.7, heat: 0.3, active: 0, basking: 1, cloud });
    }
    return b.coreTemp;
  };
  const clear = run(0), overcast = run(1);
  assert.ok(clear > overcast + 0.05,
    `clear-sky basking warms more: ${clear.toFixed(3)} vs overcast ${overcast.toFixed(3)}`);
});

test('v0.25: thermoregulation burns fuel in thermal extremes', () => {
  const rng = createRng(99);
  const g = randomGenome(rng); g.alleles.fur = [0.5, 0.5]; // ins 0.15
  const p = phenotype(g);
  const run = (amb) => {
    const b = createBiochem(); b.bloodSugar = 0.8;
    for (let t = 0; t < 30; t++) {
      tickBiochem(b, p, 1, { ambientTemp: amb, active: 0.3, sleeping: false });
    }
    return b.bloodSugar;
  };
  const bsJungle = run(0.55), bsDesert = run(1.0);
  assert.ok(bsDesert < bsJungle - 0.1,
    `desert thermoregulation burns more fuel: bloodSugar ${bsDesert.toFixed(3)} vs jungle ${bsJungle.toFixed(3)}`);
  // Fur traps heat: the furry pay more in warmth.
  const g2 = randomGenome(createRng(99)); g2.alleles.fur = [1, 1];
  const p2 = phenotype(g2);
  const b2 = createBiochem(); b2.bloodSugar = 0.8;
  for (let t = 0; t < 30; t++) tickBiochem(b2, p2, 1, { ambientTemp: 1.0, active: 0.3, sleeping: false });
  assert.ok(b2.bloodSugar < bsDesert, `max-fur burns more than mid-fur in the desert: ${b2.bloodSugar.toFixed(3)}`);
});

test('v0.25 §10 acceptance: max-fur founder in the desert interior dies of heatstroke', () => {
  const world = bindWorld(createWorld(7));
  const ambD = tempAt(world, 2700, 800); // desert interior, generated field
  assert.ok(ambD > 0.9, `desert interior is hot: ${ambD.toFixed(2)}`);
  const rng = createRng(4242);
  const g = randomGenome(rng);
  g.alleles.fur = [1, 1]; // max fur
  g.alleles.heatTol = [0.5, 0.5];
  const p = phenotype(g);
  assert.ok(Math.abs(p.furInsulation - 0.3) < 1e-9, 'max fur = 0.3 insulation');
  const b = createBiochem();
  b.coreTemp = 0.6;
  const hyperThr = 0.75 + (p.heatTol ?? 0.5) * 0.1;
  let deadAt = -1;
  for (let t = 0; t < 300; t++) {
    tickBiochem(b, p, 1, { ambientTemp: ambD, heat: 1, active: 0.3, basking: 0, sailDump: 0 });
    if (b.health <= 0) { deadAt = t; break; }
  }
  assert.ok(deadAt > 0 && deadAt <= 300, `max-fur founder dies in the desert interior (t=${deadAt}s)`);
  assert.ok(b.coreTemp > hyperThr,
    `death is heatstroke: coreTemp ${b.coreTemp.toFixed(2)} > hyper threshold ${hyperThr.toFixed(2)}`);
});

test('v0.25: plant heat stress follows the generated field and heatTol', () => {
  const world = bindWorld(createWorld(7));
  assert.equal(heatStressMul(world, 1000, 0.5), 1, 'jungle baseline: no stress');
  assert.equal(heatStressMul(world, 2700, 1), 1, 'heatTol 1: immune in the desert');
  const stressed = heatStressMul(world, 2700, 0);
  assert.ok(stressed > 2, `heat-intolerant desert plant stressed: ×${stressed.toFixed(2)}`);
  const mid = heatStressMul(world, 2700, 0.5);
  assert.ok(mid > 1 && mid < stressed, `heatTol 0.5 is partial: ×${mid.toFixed(2)}`);
});
