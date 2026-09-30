// The morph tournament — committed to hermes-on-foot in the v0.6 Colony thread
// (accepted in Paul's reply there; natural-defaults founders vs one unbiased
// control run per release, 4+ sim-hours each).
//
// Scientific question: does morphology evolve under selection, or do the
// v0.6 natural-defaults founders freeze the morph distribution so every
// lineage converges to the same body?
//
// Arms per seed:
//   natural  — founders as shipped: morphology alleles biased to viable
//              defaults (diet=herbivore, mouth/leg/fur 0.5, spikes 0.2,
//              eyeSize 0.6), jittered ±0.25. This is the release config.
//   unbiased — same seeds, same world, but the 4 founders' morphology
//              alleles re-rolled uniform-random BEFORE ticking (the v0.5
//              pre-fix regime that produced the seed-99 extinction).
//
// Metrics per run: survival, final diet mix, morphology trait means and
// variances at start (founders) vs end (living population), and the
// selection differential per trait (final mean − founder mean). An unbiased
// extinction is a finding, not a failure — a natural-arm extinction IS a
// regression flag (the shipped config must persist).
//
// Run: node scripts/qa/morph-tournament.mjs [seeds] [minutes]
// Wall cost (measured 2026-09-29): ~24s per 4-sim-hour run;
// 10 seeds × 2 arms ≈ 8 wall-minutes.
import { createWorld, bindWorld, populate, tickWorld } from '../../src/sim/world.js';
import { GENES, phenotype } from '../../src/sim/genome.js';

const MORPH_FLOAT = ['mouthSize', 'legLength', 'spikes', 'fur', 'eyeSize'];
const MORPH_CHOICE = ['diet'];

// Re-roll only the morphology alleles, uniform-random, then re-express the
// phenotype. Called on founders before the first tick, so behavior is exactly
// as if they had been born with the unbiased genome (morphology is read live
// from c.pheno; brain/memory construction at birth does not consume
// morphology genes).
function rerollMorphologyFounder(creature, rng) {
  const g = creature.genome;
  for (const key of MORPH_CHOICE) {
    const gene = GENES.find((x) => x.key === key);
    g.alleles[key] = [rng.int(0, gene.choices.length - 1), rng.int(0, gene.choices.length - 1)];
  }
  for (const key of MORPH_FLOAT) {
    g.alleles[key] = [rng.next(), rng.next()];
  }
  creature.pheno = phenotype(g);
}

function morphStats(creatures) {
  const alive = creatures.filter((c) => c.alive);
  const diet = { herbivore: 0, omnivore: 0, carnivore: 0 };
  const acc = Object.fromEntries(MORPH_FLOAT.map((k) => [k, []]));
  for (const c of alive) {
    diet[c.pheno.diet] = (diet[c.pheno.diet] || 0) + 1;
    for (const k of MORPH_FLOAT) acc[k].push(c.pheno[k]);
  }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const variance = (a) => {
    if (!a.length) return NaN;
    const m = mean(a);
    return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length;
  };
  const out = { n: alive.length, diet };
  for (const k of MORPH_FLOAT) { out[`${k}_mean`] = mean(acc[k]); out[`${k}_var`] = variance(acc[k]); }
  return out;
}

function runSeed(seed, arm, minutes) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  const rng = world.rng;
  const founders = world.creatures.filter((c) => c.generation === 0);
  if (arm === 'unbiased') {
    for (const c of founders) rerollMorphologyFounder(c, rng);
  }
  const founderStats = morphStats(founders);
  for (let m = 0; m < minutes; m++) {
    for (let t = 0; t < 600; t++) tickWorld(world, 0.1);
    if (!world.creatures.some((c) => c.alive)) return { seed, arm, extinct: true, at: m, founderStats };
  }
  const finalStats = morphStats(world.creatures);
  const maxGen = Math.max(0, ...world.creatures.map((c) => c.generation || 0));
  // Selection differential: how far did selection move each trait from the founders?
  const diff = {};
  for (const k of MORPH_FLOAT) diff[k] = finalStats[`${k}_mean`] - founderStats[`${k}_mean`];
  return { seed, arm, extinct: false, pop: finalStats.n, maxGen, founderStats, finalStats, diff };
}

const seeds = (process.argv[2] || '7,11,22,33,42,55,66,77,88,99').split(',').map(Number);
const minutes = Number(process.argv[3] || 240);
console.log(`morph-tournament: seeds=${seeds.length} minutes=${minutes} arms=natural,unbiased`);

let naturalExtinctions = 0;
const rows = [];
for (const seed of seeds) {
  for (const arm of ['natural', 'unbiased']) {
    const r = runSeed(seed, arm, minutes);
    rows.push(r);
    if (r.extinct) {
      if (arm === 'natural') naturalExtinctions++;
      console.log(`seed ${seed} [${arm}]: EXTINCT at t=${r.at}min (founder diet: ${JSON.stringify(r.founderStats.diet)})`);
    } else {
      const d = Object.entries(r.finalStats.diet).map(([k, v]) => `${k[0]}:${v}`).join(' ');
      const dl = Object.entries(r.diff).map(([k, v]) => `${k}=${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join(' ');
      console.log(`seed ${seed} [${arm}]: pop=${r.pop} maxGen=${r.maxGen} diet(${d}) selDiff(${dl})`);
    }
  }
}

// Summary: did the unbiased arm diverge more (real evolution) or just die?
const survived = (arm) => rows.filter((r) => r.arm === arm && !r.extinct);
console.log(`\nnatural:  ${survived('natural').length}/${seeds.length} survived`);
console.log(`unbiased: ${survived('unbiased').length}/${seeds.length} survived`);
for (const arm of ['natural', 'unbiased']) {
  const s = survived(arm);
  if (!s.length) continue;
  const meanAbsDiff = (k) => s.reduce((sum, r) => sum + Math.abs(r.diff[k]), 0) / s.length;
  const meanVar = (k) => s.reduce((sum, r) => sum + r.finalStats[`${k}_var`], 0) / s.length;
  console.log(`[${arm}] mean|selDiff|: ${MORPH_FLOAT.map((k) => `${k}=${meanAbsDiff(k).toFixed(3)}`).join(' ')}`);
  console.log(`[${arm}] mean trait variance: ${MORPH_FLOAT.map((k) => `${k}=${meanVar(k).toFixed(3)}`).join(' ')}`);
}
process.exit(naturalExtinctions === 0 ? 0 : 1);
