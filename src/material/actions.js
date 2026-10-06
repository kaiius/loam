// Loam M2 — action execution on the material substrate.
//
// The brain decides; this module does. Every action's physics reads the
// substrate (design §3.3/§3.4) — the tick never asks "what platform am I
// on", it asks the material.
//
// Ported core (intent unchanged from the platform track): seekFood, eat,
// sleep, wander, approach, flee, jump, drink, swim, groom, dig, seekHome.
// Redefined: climb (surface-following, no climb links).
// New (M2, each with an instinct gene — Paul's v0.5 rule): pile, instPile,
// geophagy.
//
// Anatomy gates (Joshua's rule): the body is the permission.
//   dig: digPower > 0 (graspPairs ≥ 1) — M1's DIG_POWER=1 at founder
//   pile: graspPairs ≥ 1 — placing takes hands
//   instPile, geophagy, climb: no gate — dropping, mouths, scrambling
//
// Work billing: digging/piling bill through ctx.active → the chemistry's
// hungerRate (the existing developDrain pattern, design §3.1).

import { MAT, CELL_PX, groundIndexBelow } from './grid.js';
import { sampleMat, isSolid, isClimbable, supportBelow } from './locomotion.js';
import { terrainMult, digWorkEff } from './thermo.js';
import { digTargetCell } from './creature.js';
import { nudgeBond } from '../sim/social.js';
import { nearestCorpse } from './corpses.js';
import { seedFromFeeding } from './plants.js';
import { ACTIONS } from './brain.js'; // R7: the declared action table — the
// executor registry below is asserted against it at import time
// (assert-on-unhandled). No cycle: brain.js never imports actions.js.

export const WALK_SPEED = 2.2; // px/tick — the M1 pace, kept
export const GRAVITY = 0.6;
export const MAX_FALL = 12;
export const JUMP_VY = -9;
export const CLIMB_SPEED = 1.6; // px/tick along the surface
export const DIG_DRAIN = 0.9; // ctx.active while digging — billed via hungerRate
export const PILE_DRAIN = 0.7;
export const PILE_WORK_TICKS = 4; // work to place a proper soil cell
// Geophagy payoff (R2): enriched soil pays more — eating near rotted
// corpses or rotted deadwood is worth up to 2x the base.
export const GEOPHAGY_BASE = 0.4;
export const GEOPHAGY_NUTRIENT_BONUS = 0.4;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Face a target x. Returns nothing; sets c.facing.
function faceToward(c, tx) {
  if (tx > c.x + 1) c.facing = 1;
  else if (tx < c.x - 1) c.facing = -1;
}

// Walk the facing direction when grounded; turn at cliffs/walls (M1's rule).
// A short flip cooldown keeps a walker committed to its new heading: on a
// support nub narrower than the 20px lookahead, both directions read as
// "blocked" and an unguarded flip vibrates the creature in place every tick.
// The cooldown turns the vibration into a natural pace.
export function walkPhysics(mw, c, speed = WALK_SPEED) {
  if (!c.grounded) return;
  if (c.flipCd > 0) { c.flipCd--; }
  else {
    const aheadX = c.x + c.facing * 20;
    const leg = c.body ? c.body.legLengthPx : 24;
    const bh = c.body ? c.body.heightPx : 60;
    const supportAhead = supportBelow(mw, aheadX, c.y, leg);
    const wallAhead = isSolid(sampleMat(mw, aheadX, c.y - bh / 2));
    if (!supportAhead || wallAhead) { c.facing = -c.facing; c.flipCd = 6; }
  }
  c.x += c.facing * speed;
  // D3: terrain texture — the ground answers through the hunger ledger.
  // The tick applies this to the action's activity (1.0 exactly at
  // founder FRICTION_K = 0).
  c._terrainMult = terrainMult(mw, c.x, c.y);
}

// Gravity + landing. Shared by every tick.
export function gravityPhysics(mw, c) {
  const bh = c.body ? c.body.heightPx : 60;
  const leg = c.body ? c.body.legLengthPx : 24;
  c.vy = Math.min((c.vy || 0) + GRAVITY, MAX_FALL);
  if (sampleMat(mw, c.x, c.y - bh / 2) === MAT.WATER) {
    c.vy = Math.min(c.vy * 0.92, 3); // sink slowly
  }
  c.y += c.vy;
  const sup = supportBelow(mw, c.x, c.y, leg);
  if (sup) {
    // D3: landing hook — the impact speed is recorded for the fall-damage
    // texture point (thermo.js fallDamageMult). No fall-damage mechanic
    // exists today, so the base damage is 0 and nothing changes.
    if (!c.grounded) c._impactSpeed = c.vy;
    c.y = sup.y; c.vy = 0; c.grounded = true;
  } else c.grounded = false;
}

// R6: mating — approach range and the eligible-partner scan.
export const MATE_APPROACH_PX = 40; // within this: court & reproduce
// (the authoritative mating gate is reproduceTanglekins in species.js, which
// re-checks range, stage, cooldown, and the population cap).

// The nearest eligible mate: alive, a tanglekin, adult or senior, not self.
function mateCandidate(mw, c, ctx) {
  const others = (ctx && ctx.others) || mw.m2creatures || [];
  let best = null, bestD = Infinity;
  for (const o of others) {
    if (o === c || !o.alive || o.species !== 'tanglekin') continue;
    if (o.stage !== 'adult' && o.stage !== 'senior') continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best ? { o: best, d: bestD } : null;
}

// --- the executor registry ------------------------------------------------
// R7 (arion): assert-on-unhandled — the action table can never declare what
// the executor can't do. ACTIONS (brain.js) is the declared table;
// EXECUTORS is the executor's, keyed by the same action indices. Every
// declared action has exactly one entry here, and executeAction dispatches
// through the registry: there is no `default:` fallthrough left. A new
// declared action without a case fails LOUDLY at import time (assertion
// below), not silently at runtime — caught by the test suite, the bundler,
// and the page's own load (createSim re-runs module bodies, so the
// adversarial review's loads_clean check covers it too).
//   The case-6 mate fallthrough — declared, dispatched without error,
//   sterile (the fourth cell of the declared/invocable/exercised grid) —
//   is impossible by construction now, not by inspection.
//   Declared-but-unported actions (vocal, brachiate, dive, bask, grasp,
//   carry, drop, display, inspect, cuddle, tend, seekBond, mourn) get
//   EXPLICIT honest-hold entries with their reason — registered, never
//   fallthrough; the inspector still reads c._unportedAction.
// Handler signature: (mw, c, s, ctx, chemCtx) => void. chemCtx is created
// by executeAction and returned to the caller for the chemistry tick.

// An honest hold: the action is declared and dispatched, but the material
// track has no machinery for it yet. Explicit, documented, and visible to
// the coverage report — the opposite of a silent fallthrough.
function honestHold(index, reason) {
  const fn = (mw, c, s, ctx, chemCtx) => {
    c._unportedAction = index;
    chemCtx.active = 0.4;
  };
  fn.unported = reason;
  return fn;
}

const EXECUTORS = {
  0: (mw, c, s, ctx, chemCtx) => { // seekFood — move toward the sensed food
      const f = c._foodTarget;
      if (f) { faceToward(c, c.x + f.dx); walkPhysics(mw, c); chemCtx.active = 0.75; }
      else walkPhysics(mw, c); // no food sensed — wander
  },
  1: (mw, c, s, ctx, chemCtx) => { // eat — fruit from the canopy, buried stores, or carried food
      const eaten = tryEat(mw, c, s);
      if (eaten > 0) chemCtx.ate = eaten;
      chemCtx.active = 0.3;
  },
  2: (mw, c, s, ctx, chemCtx) => { // sleep — lie down; the chemistry clears fatigue
      c.sleeping = true; chemCtx.sleeping = true; chemCtx.active = 0.2;
  },
  3: null, // play — shares wander's entry (set after the literal)
  7: (mw, c, s, ctx, chemCtx) => { // wander
      walkPhysics(mw, c); chemCtx.active = 0.65;
  },
  4: (mw, c, s, ctx, chemCtx) => { // approach — toward the nearest creature
      const o = c._nearestOther;
      if (o) { faceToward(c, o.x); walkPhysics(mw, c, WALK_SPEED * 1.1); }
      chemCtx.active = 0.75;
  },
  5: (mw, c, s, ctx, chemCtx) => { // flee — away from the nearest creature (the threat)
      const o = c._nearestOther;
      if (o) { faceToward(c, c.x + (c.x - o.x)); walkPhysics(mw, c, WALK_SPEED * 1.4); }
      else walkPhysics(mw, c, WALK_SPEED * 1.2);
      chemCtx.active = 1.0;
      chemCtx.threat = 0.5;
  },
  6: (mw, c, s, ctx, chemCtx) => { // mate — approach & court the nearest adult tanglekin
      // R6: sexless courtship — two hermaphroditic adults fuse gametes
      // through the real meiosis machinery (genome.js inherit, called via
      // ctx.reproduce). The brain's instinct genes already wire this action;
      // the case was missing and fell through to hold-position. The spawn
      // lives behind ctx.reproduce (wired by tickMaterialWorldM2) — the
      // bundler's topo-sort forbids actions.js from importing the spawner
      // directly (cycle via mcreature.js).
      chemCtx.active = 0.75;
      const cand = mateCandidate(mw, c, ctx);
      const selfAdult = c.stage === 'adult' || c.stage === 'senior';
      if (cand && selfAdult) {
        const o = cand.o;
        faceToward(c, o.x);
        if (cand.d > MATE_APPROACH_PX) {
          walkPhysics(mw, c, WALK_SPEED * 1.1); // approach
        } else if (ctx.reproduce && ctx.reproduce(c, o)) {
          chemCtx.active = 1.0; // reproduction is real work, billed honestly
        }
        // the courtship display — the page reads it as "courting <name>"
        c._courting = o.id; c._courtingT = 60;
      } else if (c._nearestOther) {
        faceToward(c, c._nearestOther.x); walkPhysics(mw, c, WALK_SPEED * 1.1);
      }
  },
  8: (mw, c, s, ctx, chemCtx) => { // seekHome — walk toward the imprinted range
      faceToward(c, c.homeX ?? c.x); walkPhysics(mw, c); chemCtx.active = 0.7;
  },
  9: (mw, c, s, ctx, chemCtx) => { // climb — surface-following (design §3.3). Trees are climbed
      // because they are WOOD, not because a link says so.
      const up = s.climbUp > 0.5, down = s.climbDown > 0.5;
      if (up || down) {
        c.climbing = true;
        c.y += (up ? -CLIMB_SPEED : CLIMB_SPEED);
        c.vy = 0; c.grounded = true; // held by the surface
        chemCtx.active = 0.85;
      } else { c.climbing = false; walkPhysics(mw, c); }
  },
  10: (mw, c, s, ctx, chemCtx) => { // groom — the troop's bonding ritual
      const o = c._nearestOther;
      const groomR = (c.body ? c.body.reachPx : 40) + 20;
      if (o && Math.hypot(o.x - c.x, o.y - c.y) < groomR) {
        faceToward(c, o.x);
        chemCtx.grooming = true;
        if (o.chemCtx) o.chemCtx.groomed = true; // the receiver's chemistry hears it
        c._groomedTarget = o;
        // The troop's ritual writes to the bond ledger (M2 social foundation).
        try { nudgeBond({ bonds: mw.bonds, time: mw.tick }, c, o, 0.02); } catch { /* bonds optional */ }
      } else if (o) { faceToward(c, o.x); walkPhysics(mw, c); }
      chemCtx.active = 0.4;
  },
  11: (mw, c, s, ctx, chemCtx) => { // jump — unchanged physics, support-agnostic landing
      if (c.grounded) { c.vy = JUMP_VY; c.grounded = false; }
      chemCtx.active = 0.9;
  },
  17: (mw, c, s, ctx, chemCtx) => { // drink — adjacent water restores hydration
      if (s.waterNear > 0.3) chemCtx.drank = 0.5;
      chemCtx.active = 0.3;
  },
  16: (mw, c, s, ctx, chemCtx) => { // swim — paddle; membranes help (M3), flailing works (M2)
      if (s.submerged > 0.5) {
        c.x += c.facing * 1.2; c.y -= 0.4;
        chemCtx.active = 1.0;
      }
  },
  19: (mw, c, s, ctx, chemCtx) => { // dig — M1's redefined dig (design §3.4), now brain-driven
      if ((c.body ? c.body.digPower : 1) > 0) {
        digWork(mw, c);
        chemCtx.active = DIG_DRAIN;
      }
  },
  30: (mw, c, s, ctx, chemCtx) => { // pile — place carried soil into the facing air cell
      if ((c.body ? c.body.graspPairs : 1) >= 1 && c.carried) {
        pileWork(mw, c);
        chemCtx.active = PILE_DRAIN;
      }
  },
  31: (mw, c, s, ctx, chemCtx) => { // instPile — dump carried soil at the feet, fast and loose
      if (c.carried) {
        dumpAtFeet(mw, c);
        chemCtx.active = 0.4;
      }
  },
  32: (mw, c, s, ctx, chemCtx) => { // geophagy — eat soil for minerals (ruling #4)
    const mineral = tryGeophagy(mw, c);
    if (mineral > 0) { c.minerals = clamp01((c.minerals ?? 0.5) + mineral); }
    else if (mw.stats && (c.minerals ?? 0.5) <= 0.6) {
      // R7: the starvation failure mode (arion) — the drive fired (the
      // brain selected geophagy and the gate re-check says the need is
      // real) but the consummatory act found nothing to eat. Count it,
      // and check whether ANY soil/clay lies within locomotion range:
      // drive firing while every reachable cell is barren is the
      // collapse signature, not a targeting quirk.
      mw.stats.geoDriveFailed = (mw.stats.geoDriveFailed || 0) + 1;
      if (!soilWithinRange(mw, c, GEO_LOCOMOTION_PX)) {
        mw.stats.geoDriveStarved = (mw.stats.geoDriveStarved || 0) + 1;
      }
    }
    chemCtx.active = 0.4;
  },
  13: (mw, c, s, ctx, chemCtx) => { // glide — needs real wings (dorsal membranes expressed).
      // Anatomy gate: wingArea > 0.3 or the bird falls like a stone.
      const wing = (c.pheno && c.pheno.wingArea) || 0;
      if (wing > 0.3 && !c.grounded) {
        c.vy = Math.min(c.vy + GRAVITY * 0.25, 1.4); // wings fight gravity
        c.x += c.facing * (1.6 + wing * 2.2);        // forward on the glide
        c.y += c.vy;
        chemCtx.active = 0.85;
      } else if (wing > 0.3 && c.grounded) {
        // Launch: a winged creature that chooses glide takes off.
        c.vy = -3.5; c.grounded = false;
        chemCtx.active = 1.0;
      } else {
        walkPhysics(mw, c); // no wings, no glide — honest fallback
        chemCtx.active = 0.65;
      }
  },
  23: (mw, c, s, ctx, chemCtx) => { // bite — strike the nearest creature in range. The attack
      // verb, ordinary machinery (platform v0.22): damage = mouthSize ×
      // mass vs spike armor; fatigue-billed; the wound is real (injury).
      const o = c._nearestOther;
      const reach = (c.body ? c.body.reachPx : 40) + 24;
      if (o && o.alive && Math.hypot(o.x - c.x, o.y - c.y) < reach) {
        const mouth = (c.pheno && c.pheno.mouthSize) || 0.3;
        const mass = c.bodyMass || 1;
        const armor = (o.pheno && o.pheno.spikes) || 0;
        const dmg = Math.max(0, mouth * mass * 0.55 - armor * 0.4);
        if (dmg > 0) {
          // Uncapped on application: biochem clamps and heals each tick, so
          // a capped 1.0 would heal to 0.994 and nothing could ever die of
          // wounds. Overkill stays lethal until the body heals below 1.
          o.chem.injury = (o.chem.injury || 0) + dmg;
          // The world marks the body — scars are how the world writes.
          if (o.body && o.body.marks) {
            o.body.marks.push({ tick: mw.tick || 0, kind: 'bite', limb: -1, severity: Math.min(1, dmg), note: c.species || 'predator' });
          }
          c._lastBiteDmg = dmg;
        }
        chemCtx.active = 1.0;
      }
  },
  12: honestHold(12, 'vocal — the call system lives on the platform track (unported in M3)'),
  14: honestHold(14, 'brachiate — wants a third grasp pair (v0.17 anatomy, unported in M3)'),
  15: honestHold(15, 'dive — needs real gills (v0.17 anatomy, unported in M3)'),
  18: honestHold(18, 'bask — stationary sunning (v0.18 Realms, unported in M3)'),
  20: honestHold(20, 'grasp — pick up the nearest manipulable object (v0.20 Hands, unported in M3)'),
  21: honestHold(21, 'carry — wield what is held (v0.20 Hands, unported in M3)'),
  22: honestHold(22, 'drop — release the held object (v0.20 Hands, unported in M3)'),
  24: honestHold(24, 'display — v0.37 Affect courtship display (declared, unported in the material executor)'),
  25: honestHold(25, 'inspect — v0.37 novelty approach (declared, unported in the material executor)'),
  26: honestHold(26, 'cuddle — v0.37 close body contact (declared, unported in the material executor)'),
  27: honestHold(27, 'tend — v0.37 offspring tending (declared, unported in the material executor)'),
  28: honestHold(28, 'seekBond — v0.37 go to the absent partner (declared, unported in the material executor)'),
  29: honestHold(29, 'mourn — v0.37 go to the death site (declared, unported in the material executor)'),
};
// play (3) was not in M2 (no toys) and falls through to wander, honestly —
// the registry has no fallthrough, so it shares wander's entry explicitly.
EXECUTORS[3] = EXECUTORS[7];

// --- assert-on-unhandled --------------------------------------------------
// The table can never declare what the executor can't do: every ACTIONS
// index must resolve to a registry entry. Runs at import time — a missing
// case is a loud import failure, not a silent runtime hold.
const _UNHANDLED = ACTIONS.map((_, i) => i).filter((i) => typeof EXECUTORS[i] !== 'function');
if (_UNHANDLED.length > 0) {
  throw new Error(
    'actions.js: declared actions without executor cases: ' +
    _UNHANDLED.map((i) => `${i}:${ACTIONS[i]}`).join(', ')
  );
}

// The coverage report: the same fact the assertion enforces, exposed for
// the adversarial review's in-page probe (adversarial-review.py's
// action_table check) and the test suite. `unported` lists the honest
// holds with their reasons — declared, dispatched, and documented as
// not-yet-machinery, so the exercised-ness grid stays explicit.
export function actionCoverage() {
  const missing = ACTIONS.map((_, i) => i).filter((i) => typeof EXECUTORS[i] !== 'function');
  const unported = [];
  for (let i = 0; i < ACTIONS.length; i++) {
    if (EXECUTORS[i] && EXECUTORS[i].unported) unported.push(`${i}:${ACTIONS[i]} — ${EXECUTORS[i].unported}`);
  }
  return { declared: ACTIONS.length, handled: ACTIONS.length - missing.length, missing, unported };
}

// executeAction(mw, c, action, s, ctx) → chemCtx additions.
// action: action index (material ACTIONS). s: senses. ctx: { others, ... }.
// Returns chemCtx — the chemistry tick's additions for this action.
export function executeAction(mw, c, action, s, ctx = {}) {
  const chemCtx = { active: 0.6 };
  const fn = EXECUTORS[action];
  // No silent default: an unregistered action is a bug, and bugs that
  // dispatch-as-hold are exactly what the registry exists to prevent.
  if (typeof fn !== 'function') {
    throw new Error(`executeAction: no executor for action ${action} — the action table declares what the executor can't do`);
  }
  fn(mw, c, s, ctx, chemCtx);
  if (action !== 2) c.sleeping = false;
  if (action !== 9) c.climbing = false;
  return chemCtx;
}

// --- eating ------------------------------------------------------------
// Fruit from fruiting canopies (preferred), corpse meat for the
// meat-eaters, buried stores, carried food. Diet gates: herbivores refuse
// meat; bitterness cuts fruit nutrition (the plant's defense is real).
function tryEat(mw, c, s) {
  const g = mw.grid;
  const diet = (c.pheno && c.pheno.diet) || 'omnivore';
  // 0. Corpses: the meat-eaters' food. Vultures and midden beetles live
  //    off this; herbivores walk past.
  if (diet !== 'herbivore') {
    const k = nearestCorpse(mw, c.x, c.y, 70);
    if (k && k.corpse.meat > 0) {
      const eff = { carnivore: 1.0, omnivore: 0.7 }[diet] || 0.5;
      k.corpse.meat = Math.max(0, k.corpse.meat - 0.25);
      return 0.45 * eff; // meat is dense
    }
  }
  // 1. Fruit: a fruiting plant with fruit left, canopy within reach.
  const f = c._foodTarget;
  // Fruit: the target plant, or a nearby backup if it was stripped by a
  // tick-mate (contention: 84% of EATs targeted empty plants). The backup
  // search is bounded (120px) and deterministic.
  let fruitPlant = (f && f.kind === 'fruit' && f.d < 120) ? f.plant : null;
  if (fruitPlant && (fruitPlant.fruit || 0) <= 0) {
    fruitPlant = null;
    if (mw.plants) {
      for (const p of mw.plants) {
        if (!p.fruiting || (p.fruit || 0) <= 0) continue;
        const dx = p.seedX * 10 - c.x, dy = p.seedY * 10 - c.y - 40;
        if (Math.hypot(dx, dy) < 120) { fruitPlant = p; break; }
      }
    }
  }
  if (fruitPlant && (fruitPlant.fruit || 0) > 0) {
    fruitPlant.fruit -= 1;
    const bitter = (fruitPlant.pheno && fruitPlant.pheno.bitterness) || 0;
    const size = (fruitPlant.pheno && fruitPlant.pheno.fruitSize) || 0.5;
    // A seed may ride along — endozoochory (plants.js).
    seedFromFeeding(mw, fruitPlant, c);
    // R3 (reactive biomes): fruit is built from the soil — its nutrition
    // scales with the plant's ground-cell nutrient. Enriched ground pays
    // up to ~1.2x; depleted ground ~0.85x. The nutrient front moves the
    // billed foraging yield on every bite.
    let nutF = 0.93; // ≈ worldgen mid-baseline (0.08+0.3·M, M≈0.42) → ~neutral
    if (g.nutrient) {
      const ni = groundIndexBelow(g, fruitPlant.seedX, fruitPlant.seedY);
      if (ni >= 0) nutF = 0.85 + 0.35 * clamp01(g.nutrient[ni]);
    }
    return 0.35 * (1 - 0.5 * bitter) * (0.7 + 0.6 * size) * nutF;
  }
  // 2. Buried: a food cell within a body length.
  if (g.food) {
    const cx = Math.floor(c.x / CELL_PX), cy = Math.floor(c.y / CELL_PX);
    const bh = c.body ? c.body.heightPx : 60;
    for (let dy = -2; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
        const i = ny * g.cols + nx;
        if (g.food[i] > 0) { g.food[i] = Math.max(0, g.food[i] - 1); return 0.3; }
      }
    }
  }
  // 3. Carried food (dug-up edibles).
  if (c.carried && c.carried.edible) { c.carried = null; return 0.3; }
  return 0;
}

// --- digging (M1's logic, brain-driven) ---------------------------------
function digWork(mw, c) {
  const g = mw.grid;
  const t = digTargetCell(mw, c);
  if (!t) { c.digTicks = 0; return; }
  const m = g.mat[t.idx];
  // D3: digging resistance — the material's hardness answers back.
  // 1.0x exactly at founder DIG_HARD_K = 0 (today's digWork behavior).
  const work = digWorkEff(m);
  const power = c.body ? c.body.digPower : 1;
  if (!Number.isFinite(work) || power <= 0) { c.digTicks = 0; return; }
  c.digTicks = (c.digTicks || 0) + 1;
  if (c.digTicks >= Math.ceil(work / power)) {
    c.digTicks = 0;
    g.mat[t.idx] = MAT.AIR;
    g.dug[t.idx] = 1;
    g.root[t.idx] = 0;
    g.grownId[t.idx] = 0;
    // Buried food in the dug cell comes out with the soil.
    let edible = false;
    if (g.food && g.food[t.idx] > 0) { g.food[t.idx] = 0; edible = true; }
    c.carried = { material: matName(m), weight: 1, edible };
  }
}

function matName(m) {
  return { 1: 'soil', 2: 'sand', 3: 'clay', 4: 'rock', 5: 'wood', 6: 'deadwood', 7: 'leaf', 10: 'char' }[m] || 'matter';
}

// --- piling --------------------------------------------------------------
// pile: careful construction — after PILE_WORK_TICKS, the facing air cell
// becomes SOIL (dug=1, compactable by trampling per §1.4).
function pileWork(mw, c) {
  const g = mw.grid;
  const t = digTargetCell(mw, c); // same targeting as dig — the hands' cell
  if (!t || g.mat[t.idx] !== MAT.AIR) { c.pileTicks = 0; return; }
  c.pileTicks = (c.pileTicks || 0) + 1;
  if (c.pileTicks >= PILE_WORK_TICKS) {
    c.pileTicks = 0;
    g.mat[t.idx] = MAT.SOIL;
    g.dug[t.idx] = 1;
    g.moist[t.idx] = 0.3;
    c.carried = null;
    c.piled = (c.piled || 0) + 1;
  }
}

// instPile: the fast twin — soil dumped at the feet, loose (it will slump
// per the material processes; construction it is not).
function dumpAtFeet(mw, c) {
  const g = mw.grid;
  const cx = Math.floor(c.x / CELL_PX);
  const cy = Math.floor((c.y - 4) / CELL_PX);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return;
  const i = cy * g.cols + cx;
  if (g.mat[i] === MAT.AIR) {
    g.mat[i] = MAT.SAND; // loose — sand never spans, it slumps honestly
    g.dug[i] = 1;
    c.carried = null;
    c.dumped = (c.dumped || 0) + 1;
  }
}

// --- geophagy ---------------------------------------------------------------
// Eat soil for minerals. Gates on the mineral deficit — the instinct is a
// whisper, the chemistry decides.
// R2: the payoff scales with the target cell's nutrient content — soil
// enriched by rotted corpses or rotted deadwood pays up to 2x.
// R4: eat the ground UNDERFOOT, not the facing wall. The old code targeted
// digTargetCell (the facing cell at body height, built for digging walls) —
// on the open surface that's AIR, so even a selected geophagy failed
// silently. Grazing the earth you stand on is the honest consummatory act;
// from a branch (no soil below) it fails honestly. A mouthful, not a cubic
// meter: the cell stays, no digging side-effects.
// R7: soil within locomotion range (grid scan) — the starvation failure
// mode's denominator: drive firing while no reachable cell can pay.
export const GEO_LOCOMOTION_PX = 240;
export function soilWithinRange(mw, c, rangePx = GEO_LOCOMOTION_PX) {
  const g = mw.grid;
  const ccx = Math.floor(c.x / CELL_PX), ccy = Math.floor(c.y / CELL_PX);
  const r = Math.ceil(rangePx / CELL_PX);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = ccx + dx, ny = ccy + dy;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const m = g.mat[ny * g.cols + nx];
      if (m === MAT.SOIL || m === MAT.CLAY) return true;
    }
  }
  return false;
}

function tryGeophagy(mw, c) {
  const pre = c.minerals ?? 0.5;
  if (pre > 0.6) return 0; // not deficient — no need
  const g = mw.grid;
  const fx = Math.floor(c.x / CELL_PX), fy = Math.floor((c.y + 1) / CELL_PX);
  if (fx < 0 || fx >= g.cols || fy < 0 || fy >= g.rows) return 0;
  const idx = fy * g.cols + fx;
  const m = g.mat[idx];
  if (m === MAT.SOIL || m === MAT.CLAY) {
    const nut = g.nutrient ? g.nutrient[idx] : 0;
    // R7: the quantum counterfactual lever (arion) — mw.geoQuantumScale
    // multiplies ONLY the fixed base, never the nutrient bonus, so the
    // probe asks exactly "what if each bite cleared twice the quantum".
    // The nutrient fraction then drowns by construction: if the billed
    // yield moves with the scale and not with cell state, the cap is the
    // quantum (settlement), not the cell. No cell-side bottleneck can
    // exist — the stock is never decremented per bite, by design — and
    // the probe confirms the billed number follows the quantum, not the
    // cell (specie's absorption-coefficient question, answered by data).
    const yield_ = GEOPHAGY_BASE * (mw.geoQuantumScale ?? 1) + GEOPHAGY_NUTRIENT_BONUS * clamp01(nut);
    // R3: instrument geophagy for the reactive-gate A/B probe — billed
    // mineral yield per event, accumulated on the world.
    // R7: deficit depth at firing time (arion's discriminating metric),
    // the effective (post-clamp) uptake, and the cell — for the spatial
    // autocorrelation probe. Arrays stay small: events are rare
    // (~dozens per 10k ticks).
    if (mw.stats) {
      mw.stats.geophagyEvents = (mw.stats.geophagyEvents || 0) + 1;
      mw.stats.geophagyYield = (mw.stats.geophagyYield || 0) + yield_;
      mw.stats.geophagyYieldEff = (mw.stats.geophagyYieldEff || 0) + Math.min(yield_, 1 - pre);
      (mw.stats.geophagyDeficit = mw.stats.geophagyDeficit || []).push(+(1 - pre).toFixed(3));
      (mw.stats.geophagyCells = mw.stats.geophagyCells || []).push({ t: mw.tick || 0, cx: fx, cy: fy, nut: +clamp01(nut).toFixed(3) });
    }
    return yield_;
  }
  return 0;
}
