// Culture: traditions — behaviors that outlive their inventors.
//
// Episodic memory dies with the creature. Traditions don't. They're a
// world-level registry of invented, named, transmissible behavioral
// variants: each has an inventor, a birth generation, and a carrier set.
// When the last carrier dies, the tradition goes extinct. That's the
// library test made mechanical — culture is inheritance that isn't DNA,
// and it can be lost.
//
// v0.7 ships one tradition kind: `grove`, a foraging-site preference.
// Fruit spawns near fixed plant positions, so "the east grove is rich" is
// genuinely useful knowledge with a real fitness gradient: carriers find
// food faster, eat more, breed more, and the tradition spreads. A grove
// tradition in a bad spot is genuinely harmful — selection weeds it out.
// No cargo-cult: every tradition must earn its carriers.
//
// Transmission is two-channel:
//   horizontal — witnesses of a carrier's successful meals adopt (fidelity
//     from the `tradition` gene; copying is near-lossless, not the 0.5
//     discount of episodic observation)
//   vertical — hatchlings inherit parents' traditions at birth
// The ratchet metric is the time series in culture.samples: repertoire
// size, cumulative founded/extinct, carrier count. A turning ratchet
// grows its repertoire; a stalled one founds and forgets at equal rates.

import { ACTIONS } from './brain.js';

export const MAX_TRADITIONS = 12; // per world — the repertoire is bounded
export const MAX_CARRY = 4; // per creature — nobody holds everything
export const GROVE_MEALS = 3; // meals clustered in space+time to invent
export const GROVE_WINDOW = 180; // seconds the meals must fall inside
export const GROVE_RADIUS = 150; // px clustering radius for invention
export const GROVE_NEARBY = 200; // px: don't found a duplicate grove here
export const TRADITION_VOTE_BUDGET = 0.3; // shared vote budget (cf recall 0.2)

const GROVE_NAMES = ['Grove', 'Run', 'Patch', 'Hollow', 'Thicket', 'Meadow'];

export function createCulture() {
  return {
    traditions: [], // live traditions
    founded: 0, // cumulative inventions
    extinct: 0, // cumulative extinctions
    nextId: 1,
    samples: [], // ratchet time series: {t, live, founded, extinct, carriers, maxGen}
  };
}

// Fidelity of cultural copying, from the `tradition` gene: 0.5–1.
// High fidelity = faithful copies and loyal retention.
export function fidelityOf(pheno) {
  const t = pheno.tradition ?? 0.5; // ?? not || — a 0 gene is real data
  return 0.5 + 0.5 * t;
}

export function getTradition(culture, id) {
  return culture.traditions.find((t) => t.id === id) || null;
}

export function liveTraditions(c, culture) {
  return (c.traditions || [])
    .map((id) => getTradition(culture, id))
    .filter(Boolean);
}

function traditionName(kind, inventorName, rng) {
  if (kind === 'grove') return `${inventorName}'s ${rng.pick(GROVE_NAMES)}`;
  return `${inventorName}'s Way`;
}

// Invent a grove tradition at x. Returns the tradition or null (cap reached).
export function foundGrove(culture, inventor, x, r, tick, gen, rng) {
  if (culture.traditions.length >= MAX_TRADITIONS) return null;
  const t = {
    id: culture.nextId++,
    kind: 'grove',
    name: traditionName('grove', inventor.name, rng),
    x: Math.round(x),
    r,
    inventor: inventor.name,
    birthTick: tick,
    birthGen: gen,
    carriers: new Set([inventor.id]),
    uses: 0, // times a carrier acted on it
  };
  culture.traditions.push(t);
  culture.founded++;
  if (!inventor.traditions) inventor.traditions = [];
  if (!inventor.traditions.includes(t.id)) inventor.traditions.push(t.id);
  return t;
}

// Copy a tradition to a new carrier, with fidelity-scaled noise.
// Returns true if adopted.
export function adoptTradition(culture, creature, trad, fidelity, rng) {
  if (!creature.traditions) creature.traditions = [];
  if (creature.traditions.includes(trad.id)) return false;
  if (creature.traditions.length >= MAX_CARRY) return false;
  // High-fidelity copy with a whisper of noise — the ratchet needs
  // near-lossless transmission, not perfect cloning. The tradition keeps
  // one shared identity (and carrier set); each holder just aims a little
  // off, scaled by (1 - fidelity).
  if (trad.kind === 'grove') {
    const noise = (1 - fidelity) * 120;
    creature.traditionAim = creature.traditionAim || {};
    creature.traditionAim[trad.id] = Math.round(trad.x + rng.range(-noise, noise));
  }
  creature.traditions.push(trad.id);
  trad.carriers.add(creature.id);
  return true;
}

// A creature's aimed point for a grove tradition (its noisy copy).
export function groveAim(c, trad) {
  if (c.traditionAim && c.traditionAim[trad.id] !== undefined) return c.traditionAim[trad.id];
  return trad.x;
}

// Tradition votes on the motor decision — like recall votes, they nudge
// without ruling, and they never touch learned weights.
export function traditionVotes(c, culture, senses) {
  const votes = new Array(ACTIONS.length).fill(0);
  const SEEK = ACTIONS.indexOf('seekFood');
  let total = 0;
  for (const t of liveTraditions(c, culture)) {
    if (t.kind === 'grove' && senses.hunger > 0.35) {
      votes[SEEK] += 0.3;
      total += 0.3;
    }
  }
  if (total > 0) {
    const scale = Math.min(1, TRADITION_VOTE_BUDGET / total);
    for (let j = 0; j < votes.length; j++) votes[j] *= scale;
  }
  return votes;
}

// Where should a hungry carrier go when no food is in sight? The grove.
export function groveTarget(c, culture, senses) {
  if (senses.hunger < 0.3) return null;
  let best = null;
  for (const t of liveTraditions(c, culture)) {
    if (t.kind !== 'grove') continue;
    const gx = groveAim(c, t);
    if (!best || Math.abs(gx - c.x) < Math.abs(best - c.x)) best = gx;
  }
  return best;
}

// Drop traditions whose last carrier is gone. Returns the extinct ones.
export function pruneExtinct(culture, creatures) {
  const alive = new Set();
  for (const c of creatures) if (c.alive) alive.add(c.id);
  const gone = [];
  culture.traditions = culture.traditions.filter((t) => {
    for (const id of [...t.carriers]) if (!alive.has(id)) t.carriers.delete(id);
    if (t.carriers.size === 0) {
      gone.push(t);
      culture.extinct++;
      return false;
    }
    return true;
  });
  return gone;
}

// Ratchet census: sample the repertoire. Call every few sim-minutes.
export function sampleCulture(world) {
  const cu = world.culture;
  let carriers = 0;
  let maxGen = 0;
  for (const t of cu.traditions) {
    carriers += t.carriers.size;
    if (t.birthGen > maxGen) maxGen = t.birthGen;
  }
  cu.samples.push({
    t: Math.round(world.time),
    live: cu.traditions.length,
    founded: cu.founded,
    extinct: cu.extinct,
    carriers,
    maxGen,
  });
}

// Cumulative Ratchet Index: fraction of all invented traditions still alive.
// 1 = nothing ever lost; 0 = the repertoire is a sieve.
export function ratchetIndex(culture) {
  if (culture.founded === 0) return 0;
  return culture.traditions.length / culture.founded;
}
