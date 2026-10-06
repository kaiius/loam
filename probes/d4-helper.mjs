// D4 probes — shared helper: build a standard probe world (founder +
// ecology), run it, sample allele means.
// Usage: import { probeWorld, meanAllele } from './d4-helper.mjs';
import { createMaterialWorld, tickMaterialWorldM2, addFounder } from '../src/material/index.js';
import { seedEcology, spawnSpecies } from '../src/material/species.js';
import { createRng } from '../src/sim/rng.js';
import { worldStateHash } from '../src/material/hash.js';
import { plantPhenotype } from '../src/sim/plantgenome.js';

// A standard D4 probe world: seed → world + founder + ecology.
// Deterministic given seed. opts passed to createMaterialWorld.
// opts.light: if true, spawn a reduced ecology (founder + 2 grubs +
// 1 beetle + 1 flutter) instead of the full 36-creature roster — the D4
// machinery is world-side, and the full roster makes 100k-tick probes
// computationally infeasible (51ms/tick → 85 min per 100k). The adaptation
// is documented here, not hidden; the mechanisms under test are unchanged.
export function probeWorld(seed, opts = {}) {
  const mw = createMaterialWorld(seed, 1, opts);
  const rng = createRng((seed * 7919 + 17) >>> 0 || 1);
  addFounder(mw, rng);
  if (opts.light) {
    const g = mw.grid;
    const surfY = (px) => {
      const cx = Math.max(0, Math.min(g.cols - 1, Math.floor(px / 10)));
      return (mw.surf[cx] || 0) * 10 - 4;
    };
    const W = g.cols * 10;
    for (const [sp, n] of [['grub', 2], ['beetle', 1], ['flutter', 1]]) {
      for (let i = 0; i < n; i++) {
        const px = W * (0.4 + 0.2 * rng.next());
        const c = spawnSpecies(mw, rng, sp, px, surfY(px), {});
        c.homeX = px; c.homeY = c.y;
        mw.m2creatures.push(c);
      }
    }
  } else {
    seedEcology(mw, rng);
  }
  return mw;
}

// Mean phenotype value for a locus across a plant list.
export function meanPlantAllele(plants, locus) {
  let sum = 0, n = 0;
  for (const p of plants) {
    const ph = p.pheno || (p.genome ? plantPhenotype(p.genome) : null);
    if (!ph || ph[locus] === undefined) continue;
    sum += ph[locus]; n++;
  }
  return n ? sum / n : 0;
}

// Mean phenotype value for a locus across creatures of given species.
export function meanCreatureAllele(creatures, species, locus) {
  let sum = 0, n = 0;
  for (const c of creatures) {
    if (!c.alive) continue;
    if (species && c.species !== species) continue;
    const v = c.pheno && c.pheno[locus];
    if (v === undefined) continue;
    sum += v; n++;
  }
  return n ? sum / n : 0;
}

// Run a world for `ticks` material ticks, calling `sample(mw, tick)` every
// `every` ticks. Returns the samples.
export function runSampled(mw, ticks, every, sample) {
  const out = [];
  for (let t = 0; t < ticks; t++) {
    tickMaterialWorldM2(mw);
    if ((t + 1) % every === 0) out.push(sample(mw, t + 1));
  }
  return out;
}

export { worldStateHash };
