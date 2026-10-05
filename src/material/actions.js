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

import { MAT, MAT_PROPS, CELL_PX, groundIndexBelow } from './grid.js';
import { sampleMat, isSolid, isClimbable, supportBelow } from './locomotion.js';
import { digTargetCell } from './creature.js';
import { nudgeBond } from '../sim/social.js';
import { nearestCorpse } from './corpses.js';
import { seedFromFeeding } from './plants.js';

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

// executeAction(mw, c, action, s, ctx) → chemCtx additions.
// action: action index (material ACTIONS). s: senses. ctx: { others, ... }.
// Returns { chemCtx, moved } — chemCtx feeds tickChem, moved tells the
// caller whether locomotion happened (for the activity billing).
export function executeAction(mw, c, action, s, ctx = {}) {
  const chemCtx = { active: 0.6 };
  const bh = c.body ? c.body.heightPx : 60;
  switch (action) {
    case 0: { // seekFood — move toward the sensed food
      const f = c._foodTarget;
      if (f) { faceToward(c, c.x + f.dx); walkPhysics(mw, c); chemCtx.active = 0.75; }
      else walkPhysics(mw, c); // no food sensed — wander
      break;
    }
    case 1: { // eat — fruit from the canopy, buried stores, or carried food
      const eaten = tryEat(mw, c, s);
      if (eaten > 0) chemCtx.ate = eaten;
      chemCtx.active = 0.3;
      break;
    }
    case 2: { // sleep — lie down; the chemistry clears fatigue
      c.sleeping = true; chemCtx.sleeping = true; chemCtx.active = 0.2;
      break;
    }
    case 3: // play — not in M2 (no toys). Falls through to wander, honestly.
    case 7: { // wander
      walkPhysics(mw, c); chemCtx.active = 0.65;
      break;
    }
    case 4: { // approach — toward the nearest creature
      const o = c._nearestOther;
      if (o) { faceToward(c, o.x); walkPhysics(mw, c, WALK_SPEED * 1.1); }
      chemCtx.active = 0.75;
      break;
    }
    case 5: { // flee — away from the nearest creature (the threat)
      const o = c._nearestOther;
      if (o) { faceToward(c, c.x + (c.x - o.x)); walkPhysics(mw, c, WALK_SPEED * 1.4); }
      else walkPhysics(mw, c, WALK_SPEED * 1.2);
      chemCtx.active = 1.0;
      chemCtx.threat = 0.5;
      break;
    }
    case 6: { // mate — approach & court the nearest adult tanglekin
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
      break;
    }
    case 8: { // seekHome — walk toward the imprinted range
      faceToward(c, c.homeX ?? c.x); walkPhysics(mw, c); chemCtx.active = 0.7;
      break;
    }
    case 9: { // climb — surface-following (design §3.3). Trees are climbed
      // because they are WOOD, not because a link says so.
      const up = s.climbUp > 0.5, down = s.climbDown > 0.5;
      if (up || down) {
        c.climbing = true;
        c.y += (up ? -CLIMB_SPEED : CLIMB_SPEED);
        c.vy = 0; c.grounded = true; // held by the surface
        chemCtx.active = 0.85;
      } else { c.climbing = false; walkPhysics(mw, c); }
      break;
    }
    case 10: { // groom — the troop's bonding ritual
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
      break;
    }
    case 11: { // jump — unchanged physics, support-agnostic landing
      if (c.grounded) { c.vy = JUMP_VY; c.grounded = false; }
      chemCtx.active = 0.9;
      break;
    }
    case 17: { // drink — adjacent water restores hydration
      if (s.waterNear > 0.3) chemCtx.drank = 0.5;
      chemCtx.active = 0.3;
      break;
    }
    case 16: { // swim — paddle; membranes help (M3), flailing works (M2)
      if (s.submerged > 0.5) {
        c.x += c.facing * 1.2; c.y -= 0.4;
        chemCtx.active = 1.0;
      }
      break;
    }
    case 19: { // dig — M1's redefined dig (design §3.4), now brain-driven
      if ((c.body ? c.body.digPower : 1) > 0) {
        digWork(mw, c);
        chemCtx.active = DIG_DRAIN;
      }
      break;
    }
    case 30: { // pile — place carried soil into the facing air cell
      if ((c.body ? c.body.graspPairs : 1) >= 1 && c.carried) {
        pileWork(mw, c);
        chemCtx.active = PILE_DRAIN;
      }
      break;
    }
    case 31: { // instPile — dump carried soil at the feet, fast and loose
      if (c.carried) {
        dumpAtFeet(mw, c);
        chemCtx.active = 0.4;
      }
      break;
    }
    case 32: { // geophagy — eat soil for minerals (ruling #4)
      const mineral = tryGeophagy(mw, c);
      if (mineral > 0) { c.minerals = clamp01((c.minerals ?? 0.5) + mineral); }
      chemCtx.active = 0.4;
      break;
    }
    case 13: { // glide — needs real wings (dorsal membranes expressed).
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
      break;
    }
    case 23: { // bite — strike the nearest creature in range. The attack
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
      break;
    }
    default: { // unported actions (M3): hold position, stay honest
      c._unportedAction = action;
      chemCtx.active = 0.4;
      break;
    }
  }
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
  const work = MAT_PROPS[m].digWork;
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
  return { 1: 'soil', 2: 'sand', 3: 'clay', 4: 'rock', 5: 'wood', 6: 'deadwood', 7: 'leaf' }[m] || 'matter';
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
function tryGeophagy(mw, c) {
  if ((c.minerals ?? 0.5) > 0.6) return 0; // not deficient — no need
  const g = mw.grid;
  const fx = Math.floor(c.x / CELL_PX), fy = Math.floor((c.y + 1) / CELL_PX);
  if (fx < 0 || fx >= g.cols || fy < 0 || fy >= g.rows) return 0;
  const idx = fy * g.cols + fx;
  const m = g.mat[idx];
  if (m === MAT.SOIL || m === MAT.CLAY) {
    const nut = g.nutrient ? g.nutrient[idx] : 0;
    const yield_ = GEOPHAGY_BASE + GEOPHAGY_NUTRIENT_BONUS * clamp01(nut);
    // R3: instrument geophagy for the reactive-gate A/B probe — billed
    // mineral yield per event, accumulated on the world.
    if (mw.stats) {
      mw.stats.geophagyEvents = (mw.stats.geophagyEvents || 0) + 1;
      mw.stats.geophagyYield = (mw.stats.geophagyYield || 0) + yield_;
    }
    return yield_;
  }
  return 0;
}
