// Social substrate: pairwise bonds, pedigree kinship, and detected tribes.
// v0.12. Bonds are memory, not genetics — no genes here. Tribes are never
// assigned, only detected: clusters of creatures whose imprinted home ranges
// overlap. Family/friend/stranger become distinguishable brain inputs.

import { zoneAt } from './world.js';

// Unordered pair key — (a,b) and (b,a) are the same bond.
export function bondKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function createBonds() {
  return new Map(); // key -> { v: -1..1, t: last update time }
}

export function getBond(bonds, a, b) {
  const e = bonds.get(bondKey(a.id ?? a, b.id ?? b));
  return e ? e.v : 0;
}

// Nudge a bond, clamped to [-1, 1]. Returns the new value.
export function nudgeBond(world, a, b, delta) {
  if (!a || !b || a === b) return 0;
  const k = bondKey(a.id, b.id);
  let e = world.bonds.get(k);
  if (!e) {
    e = { v: 0, t: world.time };
    world.bonds.set(k, e);
  }
  e.v = Math.max(-1, Math.min(1, e.v + delta));
  e.t = world.time;
  return e.v;
}

// Per-tick bond dynamics: familiarity from peaceful proximity, play
// together, slow decay toward strangers, pruning of the dead.
export function tickBonds(world, dt) {
  const bonds = world.bonds;
  if (!bonds) return;
  const FAMILIAR_RANGE = 120;
  const PLAY_RANGE = 100;
  // Familiarity: pairs close together on the same platform grow fonder.
  // Use the spatial index — O(n log n), same as the neighbor sense.
  const idx = world._spatial;
  if (idx) {
    for (const arr of idx.values()) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          const dx = b.x - a.x;
          if (dx > FAMILIAR_RANGE) break;
          nudgeBond(world, a, b, 0.004 * dt); // mere exposure
          if (a.playing && b.playing && dx < PLAY_RANGE) {
            nudgeBond(world, a, b, 0.03 * dt); // play together, stay together
          }
        }
      }
    }
  }
  // Decay toward 0 and prune dead pairs. Iterate a snapshot: deletion during
  // iteration is safe on Maps, but the alive-set lookup needs the list.
  const alive = new Set(world.creatures.map((c) => c.id));
  for (const [k, e] of bonds) {
    const [ia, ib] = k.split('-').map(Number);
    if (!alive.has(ia) || !alive.has(ib)) {
      bonds.delete(k);
      continue;
    }
    e.v -= e.v * 0.01 * dt; // bonds fade without contact — ~100s half-life
    if (Math.abs(e.v) < 0.01 && world.time - e.t > 120) bonds.delete(k);
  }
}

// Pedigree kinship from the v0.10 lineage registry: 1.0 for parent/child or
// siblings, 0.5 for shared grandparent, else 0. Exact, cheap, honest.
export function pedigreeKin(world, a, b) {
  if (!a || !b || a === b) return 0;
  const la = world.lineage.get(a.id);
  const lb = world.lineage.get(b.id);
  if (!la || !lb) return 0;
  const pa = la.parents || [];
  const pb = lb.parents || [];
  // Parent/child either direction.
  if (pa.includes(b.id) || pb.includes(a.id)) return 1;
  // Siblings: share a parent.
  if (pa.some((p) => pb.includes(p))) return 1;
  // Cousins: share a grandparent.
  const gpa = new Set();
  for (const p of pa) {
    const lp = world.lineage.get(p);
    if (lp && lp.parents) for (const g of lp.parents) gpa.add(g);
  }
  for (const p of pb) {
    const lp = world.lineage.get(p);
    if (lp && lp.parents) for (const g of lp.parents) if (gpa.has(g)) return 0.5;
  }
  return 0;
}

// Pair bonds — v0.37 "Affect" (design/affect-expansion.md §1.4, §4).
// Oxytocin is general sociability; vasopressin is SPECIFIC attachment —
// the vole steal. pairBonds is a Map like bonds, storing { v: 0..1, t }
// per pair: strengthened by mating (+0.3) and repeated exclusive grooming,
// weakened by mating others (×0.5 — the price of exclusivity), decaying
// over days. It is NOT exposed as a sense label; the brain receives only
// pairNear (strength with the nearest creature). Relationship KIND is a
// derived observer readout (kindOf, below) — never the brain's input.
export function createPairBonds() {
  return new Map(); // key -> { v: 0..1, t: last update time }
}

export function getPairBond(pairBonds, a, b) {
  if (!pairBonds) return 0;
  const e = pairBonds.get(bondKey(a.id ?? a, b.id ?? b));
  return e ? e.v : 0;
}

// Nudge a pair bond, clamped to [0, 1]. Returns the new value.
export function nudgePairBond(world, a, b, delta) {
  if (!a || !b || a === b || !world.pairBonds) return 0;
  const k = bondKey(a.id, b.id);
  let e = world.pairBonds.get(k);
  if (!e) {
    e = { v: 0, t: world.time };
    world.pairBonds.set(k, e);
  }
  e.v = Math.max(0, Math.min(1, e.v + delta));
  e.t = world.time;
  return e.v;
}

// Halve a creature's strongest pair bond (infidelity's price — design §8d).
export function halvePairBond(world, c) {
  if (!world.pairBonds) return;
  let bestK = null, bestV = 0;
  for (const [k, e] of world.pairBonds) {
    const [ia, ib] = k.split('-').map(Number);
    if (ia !== c.id && ib !== c.id) continue;
    if (e.v > bestV) { bestV = e.v; bestK = k; }
  }
  if (bestK) {
    const e = world.pairBonds.get(bestK);
    e.v *= 0.5;
    e.t = world.time;
  }
}

// Per-tick pair-bond dynamics: very slow decay (days, not minutes),
// pruning of the dead. Mirrors tickBonds.
export function tickPairBonds(world, dt) {
  const pb = world.pairBonds;
  if (!pb) return;
  const alive = new Set(world.creatures.map((c) => c.id));
  for (const [k, e] of pb) {
    const [ia, ib] = k.split('-').map(Number);
    if (!alive.has(ia) || !alive.has(ib)) {
      pb.delete(k);
      continue;
    }
    e.v -= e.v * 0.0002 * dt; // days-long decay — bonds outlive moods
    if (e.v < 0.01 && world.time - e.t > 3600) pb.delete(k);
  }
}

// Relationship kind — the derived observer readout (design §4.2).
// 'romantic' | 'family' | 'friend' | 'rival' | 'stranger'.
// The brain NEVER receives this: it gets bondNear, kinNear, pairNear
// (the three primitives). The kind is what an observer calls the pattern;
// the creature lives the pattern. Pure function — safe to call anywhere.
export function kindOf(world, a, b) {
  if (!a || !b || a === b) return 'stranger';
  const pair = getPairBond(world.pairBonds, a, b);
  if (pair > 0.5) return 'romantic';
  const kin = pedigreeKin(world, a, b);
  if (kin >= 0.5) return 'family';
  const bond = world.bonds ? getBond(world.bonds, a, b) : 0;
  if (bond > 0.3) return 'friend';
  if (bond < -0.3) return 'rival';
  return 'stranger';
}

// Tracked emergence — Joshua's ruling 2026-10-02 (design §4.2b).
// Kinds EMERGE (kindOf derives them; the brain never sees labels), but the
// world TRACKS them: world.kindHistory holds per-dyad last-known kind +
// timestamp, and a kind transition writes a chronicle event ("X and Y
// became mates", "the bond between X and Y soured into rivalry") — the
// stories get their first-class facts without the brain getting labels it
// didn't earn. A friend becomes a rival when the bond goes negative —
// and now the world NOTICES.
export function tickKindHistory(world) {
  if (!world.kindHistory) return;
  const seen = new Set(); // dyads checked this tick
  const check = (aId, bId) => {
    const k = bondKey(aId, bId);
    if (seen.has(k)) return;
    seen.add(k);
    const a = world.creatures.find((c) => c.id === aId);
    const b = world.creatures.find((c) => c.id === bId);
    if (!a || !b || !a.alive || !b.alive) return;
    const kind = kindOf(world, a, b);
    const prev = world.kindHistory.get(k);
    if (!prev) {
      // First sighting: record silently unless it's already meaningful.
      world.kindHistory.set(k, { kind, t: world.time });
      return;
    }
    if (prev.kind !== kind) {
      world.kindHistory.set(k, { kind, t: world.time });
      world.events.push({ type: 'kindChanged', a: aId, b: bId, from: prev.kind, to: kind, t: world.time });
    }
  };
  if (world.bonds) {
    for (const k of world.bonds.keys()) {
      const [ia, ib] = k.split('-').map(Number);
      check(ia, ib);
    }
  }
  if (world.pairBonds) {
    for (const k of world.pairBonds.keys()) {
      const [ia, ib] = k.split('-').map(Number);
      check(ia, ib);
    }
  }
}
// Returns [{ id, name, color, homeX, members }]. Identity is analytical —
// recomputed from scratch, so bands can form, merge, and dissolve.
// Tribe detection: greedy clustering of living creatures by homeX.
// Returns [{ id, name, color, homeX, members }]. Identity is analytical —
// recomputed from scratch, so bands can form, merge, and dissolve.
const TRIBE_RADIUS = 350;
const TRIBE_COLORS = [
  '#e08a3c', '#4ca3e0', '#9d6ce0', '#4ce0a3',
  '#e04c6e', '#c9d14a', '#6ee0d8', '#e0e0e0',
];

export function detectTribes(world) {
  const living = world.creatures.filter((c) => c.alive && c.homeX !== undefined);
  const unassigned = new Set(living.map((c) => c.id));
  const byId = new Map(living.map((c) => [c.id, c]));
  const tribes = [];
  // Seed each band from the leftmost unassigned home; absorb neighbors.
  while (unassigned.size > 0) {
    let seedId = null;
    let seedX = Infinity;
    for (const id of unassigned) {
      const c = byId.get(id);
      if (c.homeX < seedX) { seedX = c.homeX; seedId = id; }
    }
    const members = [];
    for (const id of [...unassigned]) {
      const c = byId.get(id);
      if (Math.abs(c.homeX - seedX) <= TRIBE_RADIUS) {
        members.push(c);
        unassigned.delete(id);
      }
    }
    let cx = 0;
    for (const m of members) cx += m.homeX;
    cx /= members.length;
    tribes.push({ members: members.map((m) => m.id), homeX: cx });
  }
  // Name bands by zone, disambiguated within the zone.
  const zoneCount = {};
  for (const t of tribes) {
    const z = zoneAt(t.homeX).key;
    zoneCount[z] = (zoneCount[z] || 0) + 1;
    const zoneName = zoneAt(t.homeX).name;
    t.name = `${zoneName} band ${zoneCount[z]}`;
    t.zone = z;
  }
  tribes.sort((a, b) => a.homeX - b.homeX);
  tribes.forEach((t, i) => {
    t.id = `band-${i}`;
    t.color = TRIBE_COLORS[i % TRIBE_COLORS.length];
  });
  return tribes;
}

// The creature's strongest bond (by absolute value): { other, v } | null.
// Used by the creature panel — friendship, made visible.
export function strongestBond(world, c) {
  let best = null;
  for (const [k, e] of world.bonds) {
    const d = k.indexOf('-');
    const ia = Number(k.slice(0, d));
    const ib = Number(k.slice(d + 1));
    let otherId = -1;
    if (ia === c.id) otherId = ib;
    else if (ib === c.id) otherId = ia;
    else continue;
    if (!best || Math.abs(e.v) > Math.abs(best.v)) {
      best = { otherId, v: e.v };
    }
  }
  if (!best) return null;
  const other = world.creatures.find((o) => o.id === best.otherId);
  return { other: other || { name: `#${best.otherId}` }, v: best.v };
}

// QA/telemetry snapshot: band count, sizes, home fidelity, bond health.
export function socialStats(world) {
  const living = world.creatures.filter((c) => c.alive);
  let homeDistSum = 0;
  let homeN = 0;
  for (const c of living) {
    if (c.homeX !== undefined && c._senses && c._senses.homeDist !== undefined) {
      homeDistSum += c._senses.homeDist;
      homeN++;
    }
  }
  let bondSum = 0;
  let bondN = 0;
  let friendPairs = 0; // pairs with bond > 0.3
  for (const e of world.bonds.values()) {
    bondSum += e.v;
    bondN++;
    if (e.v > 0.3) friendPairs++;
  }
  const tribes = world.tribes || [];
  return {
    tribes: tribes.length,
    meanTribeSize: tribes.length ? living.length / tribes.length : 0,
    homeFidelity: homeN ? 1 - homeDistSum / homeN : 0, // 1 = never leaves home
    bonds: bondN,
    meanBond: bondN ? bondSum / bondN : 0,
    friendPairs,
  };
}
