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

import { MAT, MAT_PROPS, CELL_PX } from './grid.js';
import { sampleMat, isSolid, isClimbable, supportBelow } from './locomotion.js';
import { digTargetCell } from './creature.js';
import { nudgeBond } from '../sim/social.js';

export const WALK_SPEED = 2.2; // px/tick — the M1 pace, kept
export const GRAVITY = 0.6;
export const MAX_FALL = 12;
export const JUMP_VY = -9;
export const CLIMB_SPEED = 1.6; // px/tick along the surface
export const DIG_DRAIN = 0.9; // ctx.active while digging — billed via hungerRate
export const PILE_DRAIN = 0.7;
export const PILE_WORK_TICKS = 4; // work to place a proper soil cell

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Face a target x. Returns nothing; sets c.facing.
function faceToward(c, tx) {
  if (tx > c.x + 1) c.facing = 1;
  else if (tx < c.x - 1) c.facing = -1;
}

// Walk the facing direction when grounded; turn at cliffs/walls (M1's rule).
export function walkPhysics(mw, c, speed = WALK_SPEED) {
  if (!c.grounded) return;
  const aheadX = c.x + c.facing * 20;
  const leg = c.body ? c.body.legLengthPx : 24;
  const bh = c.body ? c.body.heightPx : 60;
  const supportAhead = supportBelow(mw, aheadX, c.y, leg);
  const wallAhead = isSolid(sampleMat(mw, aheadX, c.y - bh / 2));
  if (!supportAhead || wallAhead) c.facing = -c.facing;
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
// Fruit from fruiting canopies (preferred), buried stores, carried food.
function tryEat(mw, c, s) {
  const g = mw.grid;
  // 1. Fruit: a fruiting plant with fruit left, canopy within reach.
  const f = c._foodTarget;
  if (f && f.kind === 'fruit' && f.d < 120 && f.plant && (f.plant.fruit || 0) > 0) {
    f.plant.fruit -= 1;
    return 0.35; // ate → bloodSugar (ctx.ate scale: see biochem)
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
function tryGeophagy(mw, c) {
  if ((c.minerals ?? 0.5) > 0.6) return 0; // not deficient — no need
  const g = mw.grid;
  const t = digTargetCell(mw, c);
  if (!t) return 0;
  const m = g.mat[t.idx];
  if (m === MAT.SOIL || m === MAT.CLAY) {
    g.mat[t.idx] = MAT.AIR;
    g.dug[t.idx] = 1;
    return 0.4; // mineral gain
  }
  return 0;
}
