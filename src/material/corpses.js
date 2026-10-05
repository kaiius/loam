// Loam M3 — corpses. Death is material.
//
// A dead creature becomes a corpse: meat on the ground, not a deleted
// object. Scavengers (vulture, midden beetle) and carnivores eat; the rest
// rots back into the soil. The vulture's whole niche depends on this —
// without corpses it starves, which is honest founder economics.
//
// Corpses tick at the slow rate (every 50 material ticks): meat decays,
// then the husk is gone. Deterministic — no RNG in the tick.
//
// R2 (SIM-B): rotting meat enriches the soil. Each slow tick deposits the
// rotted fraction into the ground cell below as `nutrient` (1:1, from the
// dead matter — nothing invented; meat eaten by scavengers becomes their
// food instead, never double-counted). Nutrient decays slowly, and plants
// draw it down when they fruit (plants.js).

import { CELL_PX, groundIndexBelow } from './grid.js';
import { NUTRIENT_MAX, NUTRIENT_DECAY, NUTRIENT_PER_MEAT } from './process.js';

export function spawnCorpse(mw, c) {
  if (!mw.corpses) mw.corpses = [];
  const meat = Math.max(0.15, Math.min(1, 0.25 + (c.bodyMass || 1) * 0.25));
  mw.corpses.push({
    x: c.x, y: c.y,
    meat,
    age: 0,
    species: c.species || 'tanglekin',
  });
  return mw.corpses[mw.corpses.length - 1];
}

// One slow tick: rot sets in. Returns corpses removed.
// Frozen control (reactive gate): no deposit, no decay — the scalars
// are painted on and never move.
export function tickCorpses(mw) {
  const g = mw.grid;
  const frozen = !!mw.frozenBiome;
  // Nutrient decay runs even with no corpses: enrichment fades slowly on
  // its own (plants draw it down faster when they fruit — plants.js).
  if (g && g.nutrient && !frozen) {
    const n = g.nutrient;
    for (let i = 0; i < n.length; i++) {
      if (n[i] > 0) n[i] *= NUTRIENT_DECAY;
    }
  }
  if (!mw.corpses || !mw.corpses.length) return 0;
  let removed = 0;
  // Meat rots over ~2 days (4800 slow-ticks at 50/tick → keep it simple:
  // 0.02 per slow tick ≈ gone in 50 slow ticks ≈ 2500 ticks).
  for (let i = mw.corpses.length - 1; i >= 0; i--) {
    const k = mw.corpses[i];
    k.age++;
    // The rotted fraction settles into the ground below as nutrient —
    // mass-conserving: it comes from this corpse's meat, 1:1.
    const rotAmt = frozen ? 0 : Math.min(0.02, k.meat);
    if (rotAmt > 0 && g && g.nutrient) {
      const cx = Math.floor(k.x / CELL_PX);
      const cy = Math.floor(k.y / CELL_PX);
      const gi = groundIndexBelow(g, cx, cy);
      if (gi >= 0) {
        g.nutrient[gi] = Math.min(NUTRIENT_MAX, g.nutrient[gi] + rotAmt * NUTRIENT_PER_MEAT);
      }
    }
    k.meat = Math.max(0, k.meat - 0.02);
    if (k.meat <= 0 && k.age > 60) {
      mw.corpses.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

export function nearestCorpse(mw, x, y, range) {
  if (!mw.corpses || !mw.corpses.length) return null;
  let best = null;
  for (const k of mw.corpses) {
    if (k.meat <= 0) continue;
    const d = Math.hypot(k.x - x, k.y - y);
    if (d < range && (!best || d < best.d)) best = { d, dx: k.x - x, dy: k.y - y, corpse: k };
  }
  return best;
}
