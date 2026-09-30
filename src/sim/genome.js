// Digital DNA: diploid genome, inheritance with crossover + mutation,
// and phenotype expression. Alleles are normalized to [0,1] for float genes.

export const GENES = [
  // appearance
  { key: 'bodyHue', kind: 'float' },
  { key: 'patternDensity', kind: 'float' },
  { key: 'size', kind: 'float' },
  { key: 'tailLength', kind: 'float' },
  { key: 'eyeSize', kind: 'float' },
  { key: 'pattern', kind: 'choice', choices: ['plain', 'spots', 'stripes'] },
  { key: 'earShape', kind: 'choice', choices: ['round', 'pointy', 'floppy'] },
  // metabolism
  { key: 'hungerRate', kind: 'float' },
  { key: 'energyDrain', kind: 'float' },
  { key: 'lifespan', kind: 'float' },
  { key: 'growthRate', kind: 'float' },
  { key: 'fertility', kind: 'float' },
  // mind
  { key: 'learningRate', kind: 'float' },
  { key: 'curiosity', kind: 'float' },
  { key: 'sociability', kind: 'float' },
  { key: 'boldness', kind: 'float' },
];

const GENE_MAP = Object.fromEntries(GENES.map((g) => [g.key, g]));

export function randomAllele(gene, rng) {
  if (gene.kind === 'choice') return rng.int(0, gene.choices.length - 1);
  return rng.next();
}

// A genome is { alleles: { key: [a, b] } } — one allele from each parent.
export function randomGenome(rng) {
  const alleles = {};
  for (const gene of GENES) {
    alleles[gene.key] = [randomAllele(gene, rng), randomAllele(gene, rng)];
  }
  return { alleles };
}

function mutateAllele(gene, value, rng, rate) {
  if (!rng.chance(rate)) return value;
  if (gene.kind === 'choice') {
    const options = gene.choices.map((_, i) => i).filter((i) => i !== value);
    return rng.pick(options);
  }
  return Math.min(1, Math.max(0, value + rng.range(-0.2, 0.2)));
}

export function inherit(momGenome, dadGenome, rng, mutationRate = 0.03) {
  const alleles = {};
  for (const gene of GENES) {
    const m = rng.pick(momGenome.alleles[gene.key]);
    const d = rng.pick(dadGenome.alleles[gene.key]);
    alleles[gene.key] = [
      mutateAllele(gene, m, rng, mutationRate),
      mutateAllele(gene, d, rng, mutationRate),
    ];
  }
  return { alleles };
}

// Express the diploid genome as observable traits. Floats average;
// choice genes express the maternal allele (deterministic).
export function phenotype(genome) {
  const p = {};
  for (const gene of GENES) {
    const [a, b] = genome.alleles[gene.key];
    if (gene.kind === 'choice') {
      p[gene.key] = gene.choices[a];
    } else {
      p[gene.key] = (a + b) / 2;
    }
  }
  // Derived, game-ready values:
  p.hueDeg = p.bodyHue * 360;
  p.bodyRadius = 14 + p.size * 18; // px at adult size
  p.lifespanSec = 300 + p.lifespan * 1500; // 5–30 minutes
  p.walkSpeed = 28 + p.size * 26; // px/sec, bigger = slightly faster
  return p;
}

// Fraction of alleles shared with another genome (0..1) — for family UI.
export function relatedness(g1, g2) {
  let same = 0;
  let total = 0;
  for (const gene of GENES) {
    const [a1, b1] = g1.alleles[gene.key];
    const [a2, b2] = g2.alleles[gene.key];
    if (gene.kind === 'choice') {
      same += (a1 === a2 ? 0.5 : 0) + (b1 === b2 ? 0.5 : 0);
    } else {
      same += (1 - Math.abs(a1 - a2)) * 0.5 + (1 - Math.abs(b1 - b2)) * 0.5;
    }
    total += 1;
  }
  return same / total;
}
