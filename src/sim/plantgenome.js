// Plant genomes for Canopy v0.13 "Roots": every plant species carries its
// own diploid genome. Fruit trees and herbs evolve — yield, bitterness,
// drought tolerance, cold tolerance, medicinal potency. Coevolution with
// the tanglekins is real: seeds disperse where fruit is eaten, so heavy
// foraging spreads high-yield plants while bitterness deters.
//
// The machinery mirrors genome.js honestly but lighter: diploid, 2
// chromosomes with 1 crossover each, mutation 0.008/allele, no epigenetic
// marks (plants are simpler organisms). Phenotype = mean of alleles.

export const PLANT_GENES = [
  // Y — yield family
  { key: 'yield', kind: 'float', founder: 0.5 },      // fruits per cycle = 1 + round(2×yield)
  { key: 'fruitSize', kind: 'float', founder: 0.5 },  // nutrition per fruit = 0.5 + fruitSize
  // T — timing family
  { key: 'interval', kind: 'float', founder: 0.5 },   // fruiting interval × (0.7 + 0.6×interval)
  { key: 'growthRate', kind: 'float', founder: 0.5 }, // maturation speed
  // D — defense family
  { key: 'bitterness', kind: 'float', founder: 0.3 }, // deterrence: nutrition × (1 − 0.5×bitterness)
  // W — water family
  { key: 'waterRet', kind: 'float', founder: 0.5 },   // arid tolerance
  // H — hardiness family
  { key: 'coldTol', kind: 'float', founder: 0.5 },    // highland tolerance
  // v0.18 §5: appended per the additive discipline (existing indices never
  // shift). Selected by the biome fruiting stress: desert heat, shallow/
  // archipelago salt.
  { key: 'heatTol', kind: 'float', founder: 0.5 },    // desert heat tolerance
  { key: 'saltTol', kind: 'float', founder: 0.5 },    // saltwater tolerance
  // M — medicine family (herbs; fruit trees ignore it)
  { key: 'potency', kind: 'float', founder: 0.5 },    // medicinal strength
  // D4 "Deep time": the succession + coevolution axes (append-only —
  // existing indices 0–9 never shift; these are 10–12).
  { key: 'colonizer', kind: 'float', founder: 0.5 },  // pioneer axis: germination threshold × (1 − 0.75 × colonizer)
  { key: 'longevity', kind: 'float', founder: 0.5 },  // lifespan axis: maxAge × (0.4 + 1.6 × longevity)
  { key: 'tannin', kind: 'float', founder: 0.2 },     // defense axis: fruit nutrition × (1 − 0.5 × tannin)
];

// Two chromosomes: [yield, fruitSize, interval, growthRate],
// [bitterness, waterRet, coldTol, potency]. Linked genes travel together.
// v0.18: heatTol + saltTol join the second (climate) chromosome; append-only.
// D4: a third chromosome for the succession/coevolution axes —
// [colonizer, longevity, tannin]. plantMeiosis iterates the array, so
// appending a chromosome is safe (new draws at the end; earlier
// chromosomes' draws are untouched).
const PLANT_CHROMOSOMES = [
  ['yield', 'fruitSize', 'interval', 'growthRate'],
  ['bitterness', 'waterRet', 'coldTol', 'potency', 'heatTol', 'saltTol'],
  ['colonizer', 'longevity', 'tannin'],
];

const PLANT_MUTATION_RATE = 0.008;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function randomPlantAllele(gene, rng) {
  if (gene.founder !== undefined) {
    return clamp01(gene.founder + (rng.next() - 0.5) * 0.5);
  }
  return rng.next();
}

// A plant genome is { alleles: { key: [a, b] } } — diploid, no marks.
export function randomPlantGenome(rng) {
  const alleles = {};
  for (const gene of PLANT_GENES) {
    alleles[gene.key] = [randomPlantAllele(gene, rng), randomPlantAllele(gene, rng)];
  }
  return { alleles };
}

function mutatePlantAllele(value, rng, rate = PLANT_MUTATION_RATE) {
  if (!rng.chance(rate)) return value;
  // 5% large-effect re-roll, else a small Gaussian step.
  if (rng.chance(0.05)) return rng.next();
  const step = rng.gauss ? rng.gauss(0, 0.06) : (rng.next() + rng.next() + rng.next() - 1.5) * 0.08;
  return clamp01(value + step);
}

// Meiosis: one gamete. One crossover per chromosome, alternating homologs.
export function plantMeiosis(genome, rng) {
  const gamete = {};
  for (const chrom of PLANT_CHROMOSOMES) {
    const cut = 1 + rng.int(0, chrom.length - 2);
    let useFirst = rng.chance(0.5);
    for (let i = 0; i < chrom.length; i++) {
      if (i === cut) useFirst = !useFirst;
      const key = chrom[i];
      gamete[key] = genome.alleles[key][useFirst ? 0 : 1];
    }
  }
  return gamete;
}

// Inheritance: two gametes fuse. Plants self-pollinate here (mom == dad is
// the common case via seed dispersal) — a noted simplification; outcrossing
// via pollinators is a future pressure to add.
export function inheritPlant(momGenome, dadGenome, rng, mutationRate = PLANT_MUTATION_RATE) {
  const m = plantMeiosis(momGenome, rng);
  const d = plantMeiosis(dadGenome, rng);
  const alleles = {};
  for (const gene of PLANT_GENES) {
    alleles[gene.key] = [
      mutatePlantAllele(m[gene.key], rng, mutationRate),
      mutatePlantAllele(d[gene.key], rng, mutationRate),
    ];
  }
  return { alleles };
}

// Phenotype: mean of the two alleles per locus.
export function plantPhenotype(genome) {
  const pheno = {};
  for (const gene of PLANT_GENES) {
    const [a, b] = genome.alleles[gene.key];
    pheno[gene.key] = (a + b) / 2;
  }
  return pheno;
}

// Compact hash for the beautiful-mutant watch (novel genotype detection).
export function plantGenomeHash(genome) {
  const parts = [];
  for (const gene of PLANT_GENES) {
    const [a, b] = genome.alleles[gene.key];
    parts.push(a.toFixed(3) + '/' + b.toFixed(3));
  }
  return parts.join('|');
}
