// Canopy material world — M1 assembly.
// The parallel track: material substrate + generative terrain + one creature.
// src/sim/ (the platform track) is untouched; everything here lives under
// src/material/.
import { generateMaterialWorld } from './worldgen.js';
import { tickMaterials } from './process.js';
import { spawnCreature, tickCreature, sense43_45, digTargetCell } from './creature.js';
import { renderWorldView } from './render.js';

export { generateMaterialWorld, tickMaterials };
export { spawnCreature, tickCreature, sense43_45, digTargetCell };
export { renderWorldView };

// A material world: the generated substrate plus runtime toggles.
// Joshua's rulings: fireOn (fire is a material process with a runtime
// on/off toggle) and permanentTunnels (realistic collapse vs
// permanent-once-dug). Both work from M1.
export function createMaterialWorld(seed, size = 1, opts = {}) {
  const mw = generateMaterialWorld(seed, size, opts);
  if (opts.fireOn !== undefined) mw.fireOn = opts.fireOn;
  if (opts.permanentTunnels !== undefined) mw.permanentTunnels = opts.permanentTunnels;
  return mw;
}

// One tick of the M1 core loop: material processes (zero RNG), then the
// creature. tickMaterials advances mw.tick itself.
export function tickMaterialWorld(mw, creatures = []) {
  tickMaterials(mw);
  for (const c of creatures) tickCreature(mw, c);
  return mw;
}
