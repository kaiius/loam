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
import { spawnCorpse } from './corpses.js';
import { effectiveTemp, thermoStep, TORPOR_T } from './thermo.js';
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
  c.body.creatureId = c.id; // art-pass hash salt: the drawing is per-individual
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
    c.body.creatureId = c.id;
  }
  // R6: the courtship display fades — a brief state, not a permanent flag.
  if (c._courtingT > 0) { c._courtingT--; if (c._courtingT <= 0) c._courting = null; }

  // --- sense ---
  const s = gatherMaterialSenses(mw, c, { others: ctx.others || [], homeX: c.homeX, homeY: c.homeY });

  // --- decide (exploration noise: stateless hash, never a stream) ---
  const input = senseVector47(s);
  const erng = createRng(hash3(mw.seed || 1, mw.tick || 0, c.id * 7919));
  // D3: cold torpor — below TORPOR_T the brain's exploration noise halves.
  // Deterministic: the hash stream is unchanged, only the amplitude scales.
  const torpor = Number.isFinite(b.coreTemp) && b.coreTemp < TORPOR_T;
  const decision = decide(c.brain, input, torpor ? (c.exploration ?? 0.1) * 0.5 : c.exploration, erng);
  let action = decision.index;
  // Action-level proximity fallback (the starvation fix, part 3): the
  // instinct gate (instFoodDistEat) is evolvable and neural, hence noisy —
  // the argmax can still select EAT with food out of reach, or seekFood
  // when EAT would work. This fallback is infallible: EAT fires only when
  // food is within tryEat's reach; otherwise the creature seeks (food
  // sensed) or wanders (nothing sensed). And when food is in reach, a
  // seekFood decision is upgraded to EAT — the consummatory act takes
  // precedence over the appetitive one. Reach is kind-aware: fruit/buried
  // 120px, corpse 70px (matching tryEat). Deterministic, amoral.
  const sightRange = (c.pheno && c.pheno.sightRange) || 420; // must match senses.js
  const foodKind = c._foodTarget ? c._foodTarget.kind : null;
  const reachPx = foodKind === 'corpse' ? 70 : 119; // tryEat's reaches (strict <)
  const reachFd = reachPx / sightRange;
  // Carried food is always in reach (foodDist forced to 0 in senses).
  const hasCarried = c.carried && c.carried.edible;
  if (action === 1 /* eat */) {
    if (!hasCarried && s.foodDist > reachFd) {
      action = s.foodDist < 1 ? 0 /* seekFood */ : 7 /* wander */;
    }
  } else if (action === 0 /* seekFood */ && s.hunger > 0.3) {
    if (hasCarried || s.foodDist <= reachFd) {
      action = 1; // hungry and food in reach: eat, don't seek
    }
  }
  c.lastAction = action;

  // --- act ---
  // R4: snapshot minerals before the action — the chemistry tick's drive
  // snapshot needs the pre-action level for Grand's rule.
  const mineralsBefore = c.minerals ?? 0.6;
  const chemCtx = executeAction(mw, c, action, s, ctx);
  // D3: terrain texture + torpor answer through the activity the chemistry
  // bills. Both are x1.0 at founder (FRICTION_K = 0; no torpor) — today's
  // behavior exactly. Torpor x1.5 on movement energy: the cold makes every
  // step cost more (the exertion term scales; metabolic heat follows).
  if (c._terrainMult !== undefined) {
    chemCtx.active = Math.min(1.5, (chemCtx.active ?? 0.6) * c._terrainMult);
    c._terrainMult = undefined;
  }
  if (torpor) chemCtx.active = Math.min(1.5, (chemCtx.active ?? 0.6) * 1.5);
  // R6: the player's pet lands here — the chemistry hears it this tick
  // (tickBiochem soothes comfort on ctx.petted: a real small delta, then
  // it decays back like everything else).
  if (c._petted) { chemCtx.petted = true; c._petted = false; }

  // --- physics shared by every tick ---
  gravityPhysics(mw, c);

  // --- minerals drift down; geophagy restores ---
  // R4: moved BEFORE the chemistry tick (was after) so the drive snapshot
  // sees the net mineral change — action restore minus metabolic decay —
  // exactly like the metabolic drives tickBiochem handles internally.
  // Same rate (0.0004/tick), same determinism (no RNG): only ordering moved.
  c.minerals = Math.max(0, Math.min(1, (c.minerals ?? 0.6) - 0.0004));
  chemCtx.mineralsBefore = mineralsBefore;
  chemCtx.mineralsAfter = c.minerals;

  // --- chemistry + Grand's endogenous reward ---
  // D3: the experienced ambient — sky temperature (or 0.5) as the base,
  // plus cold snaps, fire-warmed ground, shelter buffering, huddle warmth
  // (effectiveTemp) — through the existing ctx.ambientTemp path. The
  // Newtonian exchange itself (k/C insulation/inertia + ACT_HEAT) runs in
  // the material track (thermoStep); biochem's own coreTemp drift is
  // neutralized by handing it the post-step coreTemp as ambient, so the
  // exchange is single-counted. Everything else in biochem (panting,
  // hypo/hyperthermia ledgers, metabolic heat, regFuel) runs untouched.
  // Heat illness runs through the existing hyperthermia ledger, not a
  // parallel drain — the universe is amoral, the ledger is single.
  const T_eff = effectiveTemp(mw, c, s, ctx.others || []);
  thermoStep(b, c, T_eff, chemCtx);
  chemCtx.ambientTemp = b.coreTemp;
  chemCtx.daySun = 1;
  const { reward } = tickChem(b, c.pheno, dt, chemCtx);
  c.lastReward = reward;

  // --- learn: the endogenous reward teaches, nothing else ---
  learn(c.brain, c.pheno, reward, b);

  // --- death ---
  // Death is material: the body becomes a corpse (corpses.js) — meat for
  // the scavengers, then rot. The amoral universe, honestly implemented.
  const wasAlive = c.alive;
  if (b.bloodSugar <= 0 && b.fatigue >= 1) c.alive = false; // starved + exhausted
  if ((b.illness || 0) >= 1) c.alive = false;
  if ((b.injury || 0) >= 1) c.alive = false;
  if (wasAlive && !c.alive) spawnCorpse(mw, c);

  return reward;
}

// The action name of the creature's last decision (for the inspect view).
export function lastActionName(c) {
  return c.lastAction >= 0 ? ACTIONS[c.lastAction] : '—';
}

// R6: player touch — real small deltas through the chemistry and the
// physics, never theater. petMaterialCreature flags the next chemistry
// tick to carry ctx.petted (+0.5 comfort in tickBiochem, which then decays
// back like every other comfort change); nudgeMaterialCreature applies a
// tiny hop-shove the physics integrator resolves — the world does the
// moving, never a teleport.
export function petMaterialCreature(c) {
  if (!c || !c.alive) return false;
  c._petted = true;
  return true;
}
export function nudgeMaterialCreature(c) {
  if (!c || !c.alive) return false;
  c.x += (c.facing || 1) * 10; // a gentle shove, about one paw-step
  c.vy = Math.min(c.vy || 0, 0) - 2; // a small startle-hop
  c.grounded = false;
  return true;
}
