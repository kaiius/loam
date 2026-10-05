// Loam M2 — chemistry under drives, with Grand's endogenous reward.
//
// The body is sim/biochem.js (untouched — the v0.37 chemistry with its
// drive readouts). This module adds the one thing M2 changes: the LEARNING
// RULE.
//
// Grand's endogenous reinforcement (research finding 1, the steal): a
// drive-reducer reacting with its drive PRODUCES Reward; drive-raisers
// produce Punishment. Zero reward shaping, zero hand-tuned fitness function
// — the chemistry reports what it did, and the brain learns from that.
//
// Concretely: snapshot the deficit drives before the chemistry tick, run
// tickBiochem, snapshot after. Every unit of drive reduced this tick is
// reward; every unit of drive raised is punishment (half weight — Grand's
// asymmetry: relief teaches louder than harm, and the platform's own
// "relief reward still teaches" note agrees).
//
// All drives weight 1.0 — no ranking of which need matters more. That
// normalization is a v+1 question, not a shaping decision.

import { tickBiochem } from '../sim/biochem.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Deficit drives: genuine needs, read straight off the chemicals.
// (Mirrors the platform's drive readouts; the formulas are the port's own
// where the platform computed them inline.)
// R4: mineral deficit joins as a drive — c.minerals lives on the creature,
// not in chem, so it rides in on ctx (mineralsBefore/mineralsAfter, set by
// the material tick around the action). Same Grand's-rule treatment as every
// other drive: restoring it is reward, deepening it is punishment.
export function driveLevels(b, ctx = {}) {
  return {
    hunger: clamp01(1 - b.bloodSugar),
    thirst: clamp01(1 - b.hydration),
    tiredness: clamp01(b.fatigue),
    fear: clamp01(b.fear || 0),
    illness: clamp01(b.illness || 0),
    injury: clamp01(b.injury || 0),
  };
}

export function mineralDrive(ctx = {}) {
  // Snapshot AFTER the tick's mineral dynamics: the caller sets
  // ctx.mineralsAfter to the post-action, post-decay level.
  return clamp01(1 - (ctx.mineralsAfter ?? 0.6));
}

export const REWARD_DRIVE_KEYS = ['hunger', 'thirst', 'tiredness', 'fear', 'illness', 'injury'];

// One chemistry tick + the endogenous reward it produced.
// Returns { reward } — the brain's learn() eats this, nothing else.
export function tickChem(chem, pheno, dt, ctx = {}) {
  const before = driveLevels(chem);
  const minBefore = clamp01(1 - (ctx.mineralsBefore ?? 0.6));
  tickBiochem(chem, pheno, dt, ctx);
  // R4: mineral deficiency impairs immunity — the consequence that makes the
  // drive real. Below 0.3 minerals, illness creeps up (slow: 0.0006/tick at
  // full depletion — a vulnerability, not a death sentence; the existing
  // recovery tug-of-war usually holds it). Platform biochem untouched; this
  // is material-track coupling, applied between the snapshots so the
  // punishment leg of Grand's rule sees it honestly.
  const minLevel = clamp01(ctx.mineralsAfter ?? 0.6);
  if (minLevel < 0.3) {
    chem.illness = clamp01((chem.illness || 0) + (0.3 - minLevel) * 0.002 * dt);
  }
  const after = driveLevels(chem);
  const minAfter = 1 - minLevel;
  let reward = 0;
  for (const k of REWARD_DRIVE_KEYS) {
    const delta = before[k] - after[k]; // >0 = drive reduced
    if (delta > 0) reward += delta; // reducer + drive → Reward
    else reward += delta * 0.5; // drive-raiser → Punishment (half weight)
  }
  // R4: the mineral leg of Grand's rule — restoring minerals rewards,
  // deepening the deficit punishes, same asymmetry as every other drive.
  const dMin = minBefore - minAfter;
  if (dMin > 0) reward += dMin;
  else reward += dMin * 0.5;
  // Clamp to the learn() contract ([-1, 1] after its own clamp, but keep
  // the raw signal honest and bounded here).
  return { reward: Math.max(-1, Math.min(1, reward)) };
}
