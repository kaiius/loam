// Loam M3 — the living roster.
//
// The platform track's 14 founders (sim/species.js) are same-loci genomes —
// no species labels in any sense vector, no scripted behavior, ranges are
// physiological. Loam takes the LAND roster; the engine stays identical.
//
// Deliberately left behind: minnow, mangrove-croc, shark (aquatic). Loam
// has water but no aquatic bodies, gill locomotion, or underwater senses
// yet — porting them now would be labels without physiology. When the
// swim/dive verbs grow real bodies, the three genomes are waiting in
// sim/species.js, founder-exact.

import { founderGenome } from '../sim/species.js';
import { spawnMaterialCreature } from './mcreature.js';

// The land roster: grazers, hunters, scavengers, pollinators, prey base.
export const LOAM_ROSTER = [
  'tanglekin',          // the original founder — omnivore, already in M2
  'skimmer',            // bird — flies day one, frugivore
  'scurrier',           // small mammal — burrower
  'beetle',             // pollinator ecotype — nectar, finds flowers
  'beetle-detritivore', // midden beetle — eats scraps, dung, corpses
  'jungle-cat',         // big cat — stalk predator
  'plains-runner',      // pack hunter — cursorial, social
  'bear',               // omnivore — big, furred, digs
  'vulture',            // soarer — obligate scavenger, cannot kill
  'flutter',            // butterfly — pollinator, soft prey
  'grub',               // bug — the prey base, detritus grazer
];

// Loam population caps (carrying capacity, not culling — enforced at spawn).
export const LOAM_CAPS = {
  tanglekin: 12,
  'jungle-cat': 2,
  'plains-runner': 2,
  bear: 1,
  vulture: 2,
  skimmer: 8,
  scurrier: 10,
  beetle: 40,
  'beetle-detritivore': 20,
  flutter: 16,
  grub: 24,
};

// Spawn one creature of a species: founder genome → grown body → brain.
// The genome carries the founder overrides; the body and brain are generic.
export function spawnSpecies(mw, rng, speciesKey, px, py, opts = {}) {
  if (!LOAM_ROSTER.includes(speciesKey)) {
    throw new Error(`unknown Loam species: ${speciesKey}`);
  }
  const genome = founderGenome(speciesKey, rng);
  const c = spawnMaterialCreature(mw, genome, px, py, opts);
  c.species = speciesKey;
  return c;
}

export function countSpecies(mw, speciesKey) {
  let n = 0;
  for (const c of mw.m2creatures || []) {
    if (c.alive && c.species === speciesKey) n++;
  }
  return n;
}

// Seed the world's ecology: grazers and prey base first, a hunter or two,
// the cleaners last. Spawns on the surface near given x-range. Deterministic
// given rng. Caps respected — never overstock.
export function seedEcology(mw, rng, opts = {}) {
  const g = mw.grid;
  const spawned = [];
  const surfY = (px) => {
    const cx = Math.max(0, Math.min(g.cols - 1, Math.floor(px / 10)));
    return (mw.surf[cx] || 0) * 10 - 4;
  };
  const put = (speciesKey, n, x0, x1) => {
    const cap = LOAM_CAPS[speciesKey] || 10;
    for (let i = 0; i < n && countSpecies(mw, speciesKey) < cap; i++) {
      const px = x0 + rng.next() * (x1 - x0);
      const c = spawnSpecies(mw, rng, speciesKey, px, surfY(px), opts);
      c.homeX = px; c.homeY = c.y;
      mw.m2creatures.push(c);
      spawned.push(c);
    }
  };
  const W = g.cols * 10;
  const third = W / 3;
  // Spawn near the food: the fruiting grove anchors the herbivore base.
  // (The starvation fix: scattering grazers uniformly across a 4800px world
  // with a single 840px grove strands half the ecology beyond sense range.)
  // Herbivores spawn within the grove's x-band; hunters and cleaners keep
  // wider ranges (they track prey/corpses, not plants).
  let gx0 = third, gx1 = 2 * third;
  if (mw.plants) {
    const fxs = mw.plants.filter((p) => p.fruiting).map((p) => p.seedX * 10);
    if (fxs.length) {
      gx0 = Math.max(0, Math.min(...fxs) - 200);
      gx1 = Math.min(W, Math.max(...fxs) + 200);
    }
  }
  // The prey base and grazers — the world needs something to eat first.
  put('grub', 6, gx0, gx1);
  put('beetle', 8, gx0, gx1);
  put('flutter', 4, gx0, gx1);
  put('scurrier', 4, gx0, gx1);
  put('skimmer', 3, gx0, gx1);
  // The hunters — few, or there is nothing left to hunt.
  put('jungle-cat', 1, third, 2 * third);
  put('plains-runner', 2, 2 * third, W);
  // The cleaners — corpses come later; they arrive hungry and wait.
  put('vulture', 1, 0, third);
  put('beetle-detritivore', 4, gx0, gx1);
  return spawned;
}
