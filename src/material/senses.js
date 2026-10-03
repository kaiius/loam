// Loam M2 — material senses.
//
// The 43 platform senses (indices 0–42, never renumbered) re-implemented
// against the material substrate, plus the 3 appended material senses
// (43 digAhead, 44 soilBelow, 45 enclosed — M1's sense43_45, reused here).
//
// Honest zeros: toyDist/toyDir (no toys in Loam), callHeard/callPitch (no
// vocal system in M2), wasteOdor (no waste system), farLedge (no glide in
// M2). A zero with a reason beats a confabulated value.

import { MAT, CELL_PX } from './grid.js';
import { sampleMat, isSolid, isClimbable, supportBelow } from './locomotion.js';
import { sense43_45 } from './creature.js';
import { coldSense, heatSense } from '../sim/biochem.js';
import { nearestCorpse } from './corpses.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEFAULT_RANGE = 420;

// Diurnal cycle: the material world's day. M1 had none; M2 needs it for
// the light and phaseSleepiness senses. 2400 ticks = one day.
export const TICKS_PER_DAY = 2400;
export function timeOfDay(mw) {
  return ((mw.tick || 0) % TICKS_PER_DAY) / TICKS_PER_DAY;
}
// daySun: 0 at midnight, 1 at noon — smooth cosine.
export function daySun(mw) {
  const t = timeOfDay(mw);
  return clamp01(0.5 - 0.5 * Math.cos(t * Math.PI * 2));
}

// Light at the creature's head: daylight dying with burial depth.
// Cheap column scan — solid cells above within 12 damp it, like the
// renderer's AO.
export function lightAt(mw, x, y) {
  const g = mw.grid;
  const cx = Math.max(0, Math.min(g.cols - 1, Math.floor(x / 10)));
  const cy = Math.max(0, Math.min(g.rows - 1, Math.floor(y / 10)));
  let solid = 0;
  for (let r = cy - 1; r >= Math.max(0, cy - 12); r--) {
    const m = g.mat[r * g.cols + cx];
    if (m !== MAT.AIR && m !== MAT.WATER) solid++;
  }
  return daySun(mw) * clamp01(1 - solid / 12);
}

function nearestFood(mw, c, range) {
  // Fruiting canopies first (the honest food), buried stores second,
  // corpses third — but only for meat-eaters. The vulture's long-range
  // corpse detection rides this sense (platform: foodDist covers corpses).
  let best = null;
  const g = mw.grid;
  const diet = (c.pheno && c.pheno.diet) || 'omnivore';
  if (diet !== 'herbivore') {
    const k = nearestCorpse(mw, c.x, c.y, range * 1.5); // carrion smell carries
    if (k) best = { d: k.d, dx: k.dx, kind: 'corpse', corpse: k.corpse };
  }
  if (mw.plants) {
    for (const p of mw.plants) {
      if (!p.fruiting || (p.fruit || 0) <= 0) continue;
      // seedX/seedY are CELL coords; c.x/c.y are pixels — convert.
      const dx = p.seedX * CELL_PX - c.x, dy = p.seedY * CELL_PX - c.y - 40;
      const d = Math.hypot(dx, dy);
      if (d < range && (!best || d < best.d)) best = { d, dx, kind: 'fruit', plant: p };
    }
  }
  if (g.food) {
    const cx = Math.floor(c.x / 10), cy = Math.floor(c.y / 10);
    const rc = Math.ceil(range / 10);
    for (let dy = -rc; dy <= rc; dy++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
        const f = g.food[ny * g.cols + nx];
        if (f > 0) {
          const d = Math.hypot(dx * 10, dy * 10);
          if (d < range && (!best || d < best.d)) best = { d, dx: dx * 10, kind: 'buried', cell: ny * g.cols + nx };
        }
      }
    }
  }
  return best;
}

function nearestCreature(c, others, range) {
  let best = null;
  for (const o of others) {
    if (o === c || !o.alive) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < range && (!best || d < best.d)) best = { d, dx: o.x - c.x, obj: o };
  }
  return best;
}

// gatherMaterialSenses(mw, c, ctx) → sense object with fields hunger..enclosed.
// ctx: { others, bonds, pairBonds, homeX, homeY }
export function gatherMaterialSenses(mw, c, ctx = {}) {
  const b = c.chem;
  const pheno = c.body ? c.body.pheno : {};
  const range = pheno.sightRange || DEFAULT_RANGE;
  const others = ctx.others || [];
  const s = {};

  // --- interoceptive: the chemistry read out ---
  s.hunger = clamp01(1 - b.bloodSugar);
  s.tiredness = clamp01(b.fatigue);
  s.boredom = clamp01(0.6 - (b.stimulus || 0));
  s.loneliness = clamp01(1 - (b.oxytocin || 0));
  s.fear = clamp01(b.fear ?? b.adrenaline ?? 0);
  s.illness = clamp01(b.illness || 0);
  s.thirst = clamp01(1 - (b.hydration ?? 0.8));
  try { s.cold = clamp01(coldSense(b, pheno)); } catch { s.cold = 0; }
  try { s.heat = clamp01(heatSense(b, pheno)); } catch { s.heat = 0; }
  s.pain = clamp01(b.injury || 0);
  s.libido = clamp01(b.libido || 0);
  s.curiosity = clamp01(b.curiosity ?? 0.5);
  s.attachment = clamp01(b.attachment || 0);
  s.care = clamp01(b.care || 0);
  s.isAdult = c.stage === 'adult' ? 1 : 0;

  // --- light + day ---
  s.light = lightAt(mw, c.x, c.y - (c.body ? c.body.heightPx / 2 : 30));
  // phaseSleepiness: the body wants sleep NOW when its phase says night.
  // Diurnal founder (activityPhase ~0.5): sleepy when dark, alert when lit.
  const phase = pheno.activityPhase ?? 0.5;
  const nightness = 1 - s.light;
  s.phaseSleepiness = clamp01(s.tiredness * 0.6 + Math.abs(nightness - (1 - phase)) * 0.4);

  // --- food ---
  const food = nearestFood(mw, c, range);
  s.foodDist = food ? clamp01(food.d / range) : 1;
  s.foodDir = food ? (food.dx >= 0 ? 1 : -1) : 0;
  c._foodTarget = food || null;
  // Food in hand is food at distance zero. Without this, the proximity
  // gate on EAT (instFoodDistEat) would veto eating a carried meal the
  // creature just dug up — starving a successful forager.
  if (c.carried && c.carried.edible) s.foodDist = 0;

  // --- creatures ---
  const other = nearestCreature(c, others, range);
  s.creatureDist = other ? clamp01(other.d / range) : 1;
  s.creatureDir = other ? (other.dx >= 0 ? 1 : -1) : 0;
  // relative mass, -1..1, no identity — the tick never tells anyone who's who
  s.creatureSize = 0;
  if (other) {
    const m1 = other.bodyMass || 1, m0 = c.bodyMass || 1;
    s.creatureSize = Math.max(-1, Math.min(1, (m1 - m0) / (m1 + m0)));
  }
  const groomR = (c.body ? c.body.reachPx : 40) + 20;
  s.groomNear = other && other.d < groomR ? 1 - other.d / groomR : 0;
  c._nearestOther = other ? other.obj : null;

  // --- toys: none in Loam. Honest zero. ---
  s.toyDist = 1; s.toyDir = 0;

  // --- home + social ---
  const hx = ctx.homeX ?? c.homeX ?? c.x, hy = ctx.homeY ?? c.homeY ?? c.y;
  s.homeDist = clamp01(Math.hypot(c.x - hx, c.y - hy) / 800);
  s.kinNear = 0; // no reproduction in M2 — no kin yet (M3)
  s.bondNear = 0; s.pairNear = 0;
  if (other && ctx.bonds) {
    try {
      const { getBond } = ctx.socialApi || {};
      if (getBond) s.bondNear = getBond(ctx.bonds, c.id, other.obj.id) || 0;
    } catch { /* bonds optional in M2 */ }
  }

  // --- climb: climbable surface above/below within reach ---
  // A trunk is a column; the creature stands beside it, not inside it —
  // so the sense scans a small neighborhood, not a single column.
  const bh = c.body ? c.body.heightPx : 60;
  const climbAt = (py) => {
    for (let dx = -14; dx <= 14; dx += 7) {
      if (isClimbable(sampleMat(mw, c.x + dx, py))) return 1;
    }
    return 0;
  };
  s.climbUp = climbAt(c.y - bh - 8);
  s.climbDown = climbAt(c.y + 8);

  // --- jump: a gap ahead — no support ahead, solid beyond leap range ---
  const aheadX = c.x + c.facing * 30;
  const leg = c.body ? c.body.legLengthPx : 24;
  const supAhead = supportBelow(mw, aheadX, c.y, leg);
  s.jumpNear = (!supAhead && c.grounded) ? 1 : 0;

  // --- calls, waste: not in M2. Honest zeros. ---
  s.callHeard = 0; s.callPitch = 0; s.wasteOdor = 0;

  // --- body-in-world ---
  s.airborne = c.grounded ? 0 : 1;
  s.farLedge = 0; // no glide in M2
  s.submerged = sampleMat(mw, c.x, c.y - (c.body ? c.body.heightPx / 2 : 30)) === MAT.WATER ? 1 : 0;
  s.waterNear = waterNear(mw, c, range);
  s.falling = (c.vy || 0) < -3 ? 1 : 0;

  // --- buried food near ---
  s.buriedNear = buriedNear(mw, c, range);

  // --- held ---
  s.objectNear = c.carried ? 1 : 0;
  s.heldWeight = c.carried ? clamp01(c.carried.weight || 0) : 0;

  // --- the three material senses (M1's sense43_45) ---
  const m3 = sense43_45(mw, { x: c.x, y: c.y, facing: c.facing });
  s.digAhead = m3.digAhead;
  s.soilBelow = m3.soilBelow;
  s.enclosed = m3.enclosed;

  return s;
}

function waterNear(mw, c, range) {
  const g = mw.grid;
  const cx = Math.floor(c.x / 10), cy = Math.floor(c.y / 10);
  const rc = Math.min(12, Math.ceil(range / 10));
  let bd = Infinity;
  for (let dy = -rc; dy <= rc; dy++) {
    for (let dx = -rc; dx <= rc; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const i = ny * g.cols + nx;
      if (g.mat[i] === MAT.WATER || g.water[i] > 0.5) {
        const d = Math.hypot(dx, dy);
        if (d < bd) bd = d;
      }
    }
  }
  return bd === Infinity ? 0 : clamp01(1 - bd / rc);
}

function buriedNear(mw, c, range) {
  const g = mw.grid;
  if (!g.food) return 0;
  const cx = Math.floor(c.x / 10), cy = Math.floor(c.y / 10);
  const rc = Math.min(12, Math.ceil(range / 10));
  let bd = Infinity;
  for (let dy = -rc; dy <= rc; dy++) {
    for (let dx = -rc; dx <= rc; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      if (g.food[ny * g.cols + nx] > 0) {
        const d = Math.hypot(dx, dy);
        if (d < bd) bd = d;
      }
    }
  }
  return bd === Infinity ? 0 : clamp01(1 - bd / rc);
}
