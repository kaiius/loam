// Canopy material world — M2 assembly.
//
// M1: substrate + generative terrain + placeholder creature (kept, untouched).
// M2: the creature-systems port — genome → grown body → brain → chemistry,
//     with the material senses, the new verbs, and the inspect view.
//
// src/sim/ (the platform track) is imported but never modified: genome,
// rng, biochem, evodevo are pure modules. The brain is a material-track
// port (./brain.js — N_IN 47, 33 actions); the platform's sim/brain.js
// keeps N_IN 44 for its own tests.

import { generateMaterialWorld } from './worldgen.js';
import { tickMaterials } from './process.js';
import { spawnCreature, tickCreature, sense43_45, digTargetCell } from './creature.js';
import { renderWorldView, renderInspectView } from './render.js';

// M2: the living creature
import { spawnMaterialCreature, spawnFounder, tickMaterialCreature, lastActionName, petMaterialCreature, nudgeMaterialCreature } from './mcreature.js';
import { reproduceTanglekins } from './species.js';
import { createBonds, tickBonds } from '../sim/social.js';
// M3: the living world — sky, plants with genomes, corpses, the roster
import { createSky, tickSky, SKY_EVERY } from './weather.js';
import { attachPlantGenomes, tickPlants, tickSeeds } from './plants.js';
import { tickCorpses } from './corpses.js';
import { createRng } from '../sim/rng.js';

export { generateMaterialWorld, tickMaterials };
// M1 creature API — kept for the M1 tests and probes.
export { spawnCreature, tickCreature, sense43_45, digTargetCell };
export { renderWorldView, renderInspectView };
// M2 creature API
export { spawnMaterialCreature, spawnFounder, tickMaterialCreature, lastActionName, petMaterialCreature, nudgeMaterialCreature };

// A material world: the generated substrate plus runtime toggles.
// Joshua's rulings: fireOn (fire is a material process with a runtime
// on/off toggle) and permanentTunnels (realistic collapse vs
// permanent-once-dug). Both work from M1.
export function createMaterialWorld(seed, size = 1, opts = {}) {
  const mw = generateMaterialWorld(seed, size, opts);
  if (opts.fireOn !== undefined) mw.fireOn = opts.fireOn;
  if (opts.permanentTunnels !== undefined) mw.permanentTunnels = opts.permanentTunnels;
  // M2: the social substrate — bonds live on the world, creatures reference it.
  mw.bonds = createBonds();
  mw.m2creatures = [];
  // R3: per-run stats (geophagy instrumentation for the reactive-gate A/B
  // probe) and the frozen-biome control flag (default: biome live).
  mw.stats = {};
  mw.frozenBiome = false;
  // M3: the sky — initialized from the world's climate fields (T/M per
  // column), so the first sky matches the painted biomes. Own sub-stream.
  const widthPx = mw.grid.cols * 10;
  mw.sky = createSky(seed, widthPx, {
    T: (i) => {
      const t = mw.Tclim;
      if (!t || !t.length) return 0.5;
      const ti = Math.max(0, Math.min(t.length - 1, Math.floor(((i + 0.5) * 100) / 20)));
      return t[ti];
    },
    soil: (i) => {
      const m = mw.Mclim;
      if (!m || !m.length) return 0.4;
      const mi = Math.max(0, Math.min(m.length - 1, Math.floor(((i + 0.5) * 100) / 20)));
      return m[mi];
    },
  });
  // M3: the dead have bodies — corpses, seeds, and plant genomes.
  mw.corpses = [];
  mw.seeds = [];
  attachPlantGenomes(mw.plants, createRng(((seed * 31 + 0x5eed) >>> 0) || 1));
  return mw;
}

// One tick of the M1 core loop: material processes (zero RNG), then the
// creature. tickMaterials advances mw.tick itself. Kept for M1 callers.
export function tickMaterialWorld(mw, creatures = []) {
  tickMaterials(mw);
  for (const c of creatures) tickCreature(mw, c);
  return mw;
}

// One tick of the M2 loop: materials, then every living creature
// (sense → decide → act → chemistry → learn), then the social substrate.
// ctx is forwarded to each creature (shared perception context).
//
// M3: the slow systems tick at decoupled rates — the sky every 20 ticks,
// seeds every 10, plants and corpses every 50. Like a real sky, weather
// moves slower than paws.
export function tickMaterialWorldM2(mw, ctx = {}) {
  tickMaterials(mw);
  const creatures = mw.m2creatures;
  // R6: the mate action's spawn seam — executeAction (case 6) calls
  // ctx.reproduce(mom, dad); the real gate lives in reproduceTanglekins.
  // (actions.js can't import the spawner directly — the bundler's
  // topo-sort forbids the cycle via mcreature.js.)
  const cctx = { others: creatures, bonds: mw.bonds, ...ctx, reproduce: (mom, dad) => reproduceTanglekins(mw, mom, dad) };
  for (const c of creatures) {
    if (c.alive) tickMaterialCreature(mw, c, cctx);
  }
  // M3: the sky.
  if ((mw.tick % SKY_EVERY) === 0) tickSky(mw, SKY_EVERY);
  // M3: seeds drift on the wind.
  if ((mw.tick % 10) === 0) tickSeeds(mw);
  // M3: the plant slow tick — growth, stress, death, generations, and
  // fruit regrowth (the food economy breathes; the refill lives in
  // plants.js, yield-scaled and climate-gated).
  if (mw.tick % 50 === 0) tickPlants(mw);
  // M3: corpses rot.
  if (mw.tick % 50 === 0) tickCorpses(mw);
  // Social substrate: bonds decay/drift. The adapter maps the material
  // world onto social.js's expected interface (M2 foundation — full troops
  // and tribe detection in M3).
  try {
    tickBonds({ bonds: mw.bonds, creatures, time: mw.tick, _spatial: null }, 1);
  } catch { /* bonds optional */ }
  return mw;
}

// Add a founder creature to the world (spawns on the surface).
export function addFounder(mw, rng, opts = {}) {
  const c = spawnFounder(mw, rng, 0, 0, opts);
  c.species = 'tanglekin'; // the founder IS a tanglekin — spawnSpecies sets
                           // it for every other creature; the founder got
                           // undefined and rendered by dispatch accident.
  // Drop onto the world's designated spawn: pickSpawn chose it for open
  // sky (6 cells of AIR headroom) near the fruiting grove. The old blind
  // world-center drop could land inside a grown canopy once the grove
  // grew dense enough — a founder spawning in leaves, in the dark
  // (caught by the m2 senses test when seed 7 resampled).
  const sp = mw.spawn || { x: (mw.grid.cols / 2) * 10 };
  const cx = Math.max(0, Math.min(mw.grid.cols - 1, Math.floor(sp.x / 10)));
  const sy = mw.surf[cx] || 0;
  c.x = cx * 10;
  c.y = sy * 10 - 2;
  c.homeX = c.x; c.homeY = c.y;
  mw.m2creatures.push(c);
  return c;
}
