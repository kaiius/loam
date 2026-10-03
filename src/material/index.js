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
import { spawnMaterialCreature, spawnFounder, tickMaterialCreature, lastActionName } from './mcreature.js';
import { createBonds, tickBonds } from '../sim/social.js';

export { generateMaterialWorld, tickMaterials };
// M1 creature API — kept for the M1 tests and probes.
export { spawnCreature, tickCreature, sense43_45, digTargetCell };
export { renderWorldView, renderInspectView };
// M2 creature API
export { spawnMaterialCreature, spawnFounder, tickMaterialCreature, lastActionName };

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
export function tickMaterialWorldM2(mw, ctx = {}) {
  tickMaterials(mw);
  const creatures = mw.m2creatures;
  const cctx = { others: creatures, bonds: mw.bonds, ...ctx };
  for (const c of creatures) {
    if (c.alive) tickMaterialCreature(mw, c, cctx);
  }
  // Fruit regrows slowly on fruiting plants (the food economy breathes).
  if (mw.plants && mw.tick % 50 === 0) {
    for (const p of mw.plants) {
      if (p.fruiting && (p.fruit || 0) < 5) p.fruit = Math.min(5, (p.fruit || 0) + 1);
    }
  }
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
  // Drop onto the surface near the world center.
  const cx = Math.floor(mw.grid.cols / 2);
  const sy = mw.surf[cx] || 0;
  c.x = cx * 10;
  c.y = sy * 10 - 2;
  c.homeX = c.x; c.homeY = c.y;
  mw.m2creatures.push(c);
  return c;
}
