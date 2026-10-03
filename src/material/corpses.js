// Loam M3 — corpses. Death is material.
//
// A dead creature becomes a corpse: meat on the ground, not a deleted
// object. Scavengers (vulture, midden beetle) and carnivores eat; the rest
// rots back into the soil. The vulture's whole niche depends on this —
// without corpses it starves, which is honest founder economics.
//
// Corpses tick at the slow rate (every 50 material ticks): meat decays,
// then the husk is gone. Deterministic — no RNG in the tick.

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
export function tickCorpses(mw) {
  if (!mw.corpses || !mw.corpses.length) return 0;
  let removed = 0;
  // Meat rots over ~2 days (4800 slow-ticks at 50/tick → keep it simple:
  // 0.02 per slow tick ≈ gone in 50 slow ticks ≈ 2500 ticks).
  for (let i = mw.corpses.length - 1; i >= 0; i--) {
    const k = mw.corpses[i];
    k.age++;
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
