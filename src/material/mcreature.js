// Loam M2 — the material creature.
//
// The M1 placeholder (walk + probe-flag dig) is replaced by a real grown
// body with a working brain. Composition, not inheritance:
//
//   genome (sim/genome.js — untouched)
//     → body (body.js: phenotype → evodevo developmental program → grown body)
//     → brain (material/brain.js: 47-in/33-out sparse net + instinct genes)
//     → chemistry (sim/biochem.js via chem.js: drives + Grand's endogenous reward)
//
// One tick: sense → decide → act → chemistry → learn.
// Determinism: the only randomness is exploration noise in decide(), drawn
// from a stateless hash(seed, tick, creatureId) — never a stream (design
// §1.5). Same (seed, tick, creature) → bit-identical action.

import { createRng } from '../sim/rng.js';
import { randomGenome, phenotype } from '../sim/genome.js';
import { createBiochem, ageStage } from '../sim/biochem.js';
import { createBrain, decide, learn, senseVector47, ACTIONS } from './brain.js';
import { growBody } from './body.js';
import { m2PhenoDefaults } from './genes.js';
import { tickChem } from './chem.js';
import { gatherMaterialSenses } from './senses.js';
import { executeAction, gravityPhysics } from './actions.js';
import { MAT } from './grid.js';

export { ACTIONS };

let nextId = 1;

// Stateless exploration-noise seed: hash(worldSeed, tick, creatureId).
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x51ab, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

export function spawnMaterialCreature(mw, genome, px, py, opts = {}) {
  const pheno = { ...phenotype(genome), ...m2PhenoDefaults() };
  const body = growBody(genome, opts);
  const brainSeed = hash3(mw.seed || 1, 0x6d2, nextId);
  const brain = createBrain(pheno, createRng(brainSeed));
  const c = {
    id: nextId++,
    x: px, y: py, // feet point, like M1
    vx: 0, vy: 0,
    facing: opts.facing || 1,
    grounded: false,
    climbing: false,
    sleeping: false,
    alive: true,
    age: 0, // ticks since birth
    stage: 'baby',
    genome, pheno, body, brain,
    chem: createBiochem(),
    homeX: px, homeY: py, // imprinted home range
    minerals: 0.6, // the geophagy drive's substrate
    bodyMass: 1 + (pheno.size || 0.5), // relative mass for creatureSize sense
    carried: null,
    digTicks: 0, pileTicks: 0,
    piled: 0, dumped: 0,
    lastAction: -1,
    lastReward: 0,
    _foodTarget: null,
    _nearestOther: null,
    exploration: opts.exploration ?? 0.08,
  };
  return c;
}

// Convenience: a founder creature from a fresh random genome.
export function spawnFounder(mw, rng, px, py, opts = {}) {
  const genome = randomGenome(rng, {});
  return spawnMaterialCreature(mw, genome, px, py, opts);
}

// One creature tick. ctx: { others, bonds, socialApi }.
// Returns the endogenous reward (for the chronicle / probes).
export function tickMaterialCreature(mw, c, ctx = {}) {
  if (!c.alive) return 0;
  const dt = 1; // 1 tick

  // --- age + stage ---
  c.age += dt;
  const b = c.chem;
  const newStage = ageStage(b, c.pheno);
  if (newStage !== c.stage) {
    c.stage = newStage;
    // Development rebuilt at stage transitions — the body grows honestly.
    c.body = growBody(c.genome, { stage: newStage });
  }

  // --- sense ---
  const s = gatherMaterialSenses(mw, c, { others: ctx.others || [], homeX: c.homeX, homeY: c.homeY });

  // --- decide (exploration noise: stateless hash, never a stream) ---
  const input = senseVector47(s);
  const erng = createRng(hash3(mw.seed || 1, mw.tick || 0, c.id * 7919));
  const decision = decide(c.brain, input, c.exploration, erng);
  const action = decision.index;
  c.lastAction = action;

  // --- act ---
  const chemCtx = executeAction(mw, c, action, s, ctx);

  // --- physics shared by every tick ---
  gravityPhysics(mw, c);

  // --- chemistry + Grand's endogenous reward ---
  chemCtx.ambientTemp = 0.5;
  chemCtx.daySun = 1;
  const { reward } = tickChem(b, c.pheno, dt, chemCtx);
  c.lastReward = reward;

  // --- learn: the endogenous reward teaches, nothing else ---
  learn(c.brain, c.pheno, reward, b);

  // --- minerals drift down; geophagy restores ---
  c.minerals = Math.max(0, Math.min(1, (c.minerals ?? 0.6) - 0.0004));

  // --- death ---
  if (b.bloodSugar <= 0 && b.fatigue >= 1) c.alive = false; // starved + exhausted
  if ((b.illness || 0) >= 1) c.alive = false;
  if ((b.injury || 0) >= 1) c.alive = false;

  return reward;
}

// The action name of the creature's last decision (for the inspect view).
export function lastActionName(c) {
  return c.lastAction >= 0 ? ACTIONS[c.lastAction] : '—';
}
