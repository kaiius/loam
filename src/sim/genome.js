// Digital DNA for Canopy tanglekins: diploid genome, inheritance with
// CHROMOSOMAL meiosis + epigenetics, and phenotype expression.
//
// The 40 loci are Wildcode v0.12's (borrowed from paulthecat — 37 genes,
// incl. the sense→action instinct genes, morphology, tradition fidelity)
// plus 3 canopy genes (instClimbUp, instClimbDown, instLonelyGroom).
//
// The machinery is Emberhollow's: 8 chromosomes, meiosis with 1–3 crossovers
// per chromosome (linked genes travel together; distant genes assort),
// mutation at 0.008 per allele (5% large-effect re-roll, else small Gaussian
// step), and epigenetic marks that scale expression 0.5×–1.5× and fade
// across generations. Linked inheritance is what makes lineages legible:
// a chromosome is a story, not a bag of alleles.

export const GENES = [
  // appearance
  { key: 'bodyHue', kind: 'float' },
  { key: 'patternDensity', kind: 'float' },
  { key: 'size', kind: 'float' },
  { key: 'tailLength', kind: 'float' },
  { key: 'eyeSize', kind: 'float', founder: 0.6 }, // bigger eyes, farther sight
  { key: 'pattern', kind: 'choice', choices: ['plain', 'spots', 'stripes'] },
  { key: 'earShape', kind: 'choice', choices: ['round', 'pointy', 'floppy'] },
  // metabolism
  { key: 'hungerRate', kind: 'float' },
  { key: 'energyDrain', kind: 'float' },
  { key: 'lifespan', kind: 'float' },
  { key: 'growthRate', kind: 'float' },
  { key: 'fertility', kind: 'float' },
  { key: 'immunity', kind: 'float' }, // disease resistance + recovery speed
  // mind
  { key: 'learningRate', kind: 'float' },
  { key: 'curiosity', kind: 'float' },
  { key: 'sociability', kind: 'float' },
  { key: 'boldness', kind: 'float' },
  { key: 'memory', kind: 'float' }, // episodic memory capacity (16–64)
  // instincts — evolvable sense→action reflex weights. `sense`/`action` index
  // into the brain's sense vector / action list; `founder` biases gen-0.
  { key: 'instHungerSeek', kind: 'float', sense: 0, action: 0, founder: 0.8 },
  { key: 'instHungerEat', kind: 'float', sense: 0, action: 1, founder: 0.8 },
  { key: 'instTiredSleep', kind: 'float', sense: 1, action: 2, founder: 0.8 },
  { key: 'instBoredPlay', kind: 'float', sense: 2, action: 3, founder: 0.8 },
  { key: 'instLonelyApproach', kind: 'float', sense: 3, action: 4, founder: 0.8 },
  { key: 'instFearFlee', kind: 'float', sense: 4, action: 5, founder: 0.8 },
  { key: 'instLightSleep', kind: 'float', sense: 5, action: 2, founder: 0.15 },
  { key: 'instFoodDistSeek', kind: 'float', sense: 6, action: 0, founder: 0.8 },
  { key: 'instCreatureDistApproach', kind: 'float', sense: 8, action: 4, founder: 0.2 },
  { key: 'instToyDistPlay', kind: 'float', sense: 10, action: 3, founder: 0.8 },
  { key: 'instLonelyMate', kind: 'float', sense: 3, action: 6, founder: 0.8 },
  { key: 'instIllnessSeek', kind: 'float', sense: 13, action: 0, founder: 0.5 },
  { key: 'instHomeSeek', kind: 'float', sense: 14, action: 8, founder: 0.5 },
  // canopy instincts (new): climb links above/below (senses 17/18)
  // drive the climb action (9). Same v0.5 precedent: an action with no
  // instinct pathway is never tried and never learned.
  { key: 'instClimbUp', kind: 'float', sense: 17, action: 9, founder: 0.5 },
  { key: 'instClimbDown', kind: 'float', sense: 18, action: 9, founder: 0.5 },
  // social grooming (new): loneliness drives grooming (action 10), the
  // troop's bonding ritual. Grooming builds bonds and oxytocin.
  { key: 'instLonelyGroom', kind: 'float', sense: 3, action: 10, founder: 0.6 },
  // morphology — body parts with stat tradeoffs. What you see IS the DNA.
  { key: 'diet', kind: 'choice', choices: ['herbivore', 'omnivore', 'carnivore'], founder: 0 },
  { key: 'mouthSize', kind: 'float', founder: 0.5 },
  { key: 'legLength', kind: 'float', founder: 0.5 },
  { key: 'spikes', kind: 'float', founder: 0.2 },
  { key: 'fur', kind: 'float', founder: 0.5 },
  // tradition — fidelity of cultural transmission.
  { key: 'tradition', kind: 'float', founder: 0.5 },
];

const GENE_MAP = Object.fromEntries(GENES.map((g) => [g.key, g]));

// --- chromosomes: linked inheritance --------------------------------------
// 8 chromosomes, thematic like Emberhollow's. Genes on the same chromosome
// cross over in segments; genes on different chromosomes assort freely.
// A chromosome is a story, not a bag of alleles.
export const CHROMOSOMES = [
  // 1 — Morphology
  ['bodyHue', 'patternDensity', 'size', 'tailLength', 'eyeSize', 'pattern', 'earShape',
   'diet', 'mouthSize', 'legLength', 'spikes', 'fur'],
  // 2 — Metabolism
  ['hungerRate', 'energyDrain', 'lifespan', 'growthRate', 'fertility', 'immunity'],
  // 3 — Neuroarchitecture
  ['learningRate', 'memory'],
  // 4 — Instincts
  ['curiosity', 'sociability', 'boldness',
   'instHungerSeek', 'instHungerEat', 'instTiredSleep', 'instBoredPlay',
   'instLonelyApproach', 'instFearFlee', 'instLightSleep', 'instFoodDistSeek',
   'instCreatureDistApproach', 'instToyDistPlay', 'instLonelyMate',
   'instIllnessSeek', 'instHomeSeek', 'instClimbUp', 'instClimbDown', 'instLonelyGroom'],
  // 5 — Drives (reserved: sensitivity loci for future chemistry work)
  [],
  // 6 — Immune (reserved)
  [],
  // 7 — Life history (reserved)
  [],
  // 8 — Culture
  ['tradition'],
];

const MUTATION_RATE = 0.008; // per allele

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function randomAllele(gene, rng) {
  if (gene.kind === 'choice') {
    if (gene.founder !== undefined) return gene.founder;
    return rng.int(0, gene.choices.length - 1);
  }
  if (gene.founder !== undefined) {
    return clamp01(gene.founder + (rng.next() - 0.5) * 0.5);
  }
  return rng.next();
}

// A genome is { alleles: { key: [a, b] }, marks: { key: 0.5..1.5 } }.
// Marks are epigenetic: they scale float-gene expression and fade toward 1
// each generation. Life writes them; time erases them.
export function randomGenome(rng) {
  const alleles = {};
  const marks = {};
  for (const gene of GENES) {
    alleles[gene.key] = [randomAllele(gene, rng), randomAllele(gene, rng)];
    marks[gene.key] = 1.0;
  }
  return { alleles, marks };
}

function mutateAllele(gene, value, rng, rate = MUTATION_RATE) {
  if (!rng.chance(rate)) return value;
  if (gene.kind === 'choice') {
    const options = gene.choices.map((_, i) => i).filter((i) => i !== value);
    return rng.pick(options);
  }
  // 5% large-effect re-roll, else a small Gaussian step.
  if (rng.chance(0.05)) return rng.next();
  const step = rng.gauss ? rng.gauss(0, 0.06) : (rng.next() + rng.next() + rng.next() - 1.5) * 0.08;
  return clamp01(value + step);
}

// Meiosis: build one gamete. For each chromosome, pick 1–3 crossover points;
// alternate between the two homologs between crossovers. Marks fade halfway
// toward 1 (imperfect epigenetic inheritance — the past attenuates).
export function meiosis(genome, rng) {
  const gamete = {};
  const gameteMarks = {};
  for (const chrom of CHROMOSOMES) {
    if (chrom.length === 0) continue;
    const nX = 1 + rng.int(0, 2);
    const points = new Set();
    while (points.size < nX && points.size < chrom.length - 1) {
      points.add(1 + rng.int(0, chrom.length - 2));
    }
    const cuts = [...points].sort((a, b) => a - b);
    let useFirst = rng.chance(0.5);
    let cutIdx = 0;
    for (let i = 0; i < chrom.length; i++) {
      if (cutIdx < cuts.length && i === cuts[cutIdx]) {
        useFirst = !useFirst;
        cutIdx++;
      }
      const key = chrom[i];
      const allele = genome.alleles[key][useFirst ? 0 : 1];
      gamete[key] = allele;
      const m = (genome.marks && genome.marks[key]) || 1.0;
      gameteMarks[key] = 1.0 + (m - 1.0) * 0.5;
    }
  }
  return { gamete, gameteMarks };
}

export function inherit(momGenome, dadGenome, rng, mutationRate = MUTATION_RATE) {
  const m = meiosis(momGenome, rng);
  const d = meiosis(dadGenome, rng);
  const alleles = {};
  const marks = {};
  for (const gene of GENES) {
    alleles[gene.key] = [mutateAllele(gene, m.gamete[gene.key], rng, mutationRate), mutateAllele(gene, d.gamete[gene.key], rng, mutationRate)];
    marks[gene.key] = 1.0 + (((m.gameteMarks[gene.key] || 1) + (d.gameteMarks[gene.key] || 1)) / 2 - 1.0);
  }
  return { alleles, marks };
}

// Nudge an epigenetic mark on one locus (0.5–1.5×). Called by life events:
// scarcity marks hungerRate up, isolation marks sociability, illness marks
// immunity. What life writes, time erodes.
export function markLocus(genome, key, delta) {
  if (!genome.marks || genome.marks[key] === undefined) return;
  genome.marks[key] = Math.max(0.5, Math.min(1.5, genome.marks[key] + delta));
}

// Express the diploid genome as observable traits. Floats average, then
// the epigenetic mark scales expression. Choice genes express the maternal
// allele (deterministic).
export function phenotype(genome) {
  const p = {};
  for (const gene of GENES) {
    const [a, b] = genome.alleles[gene.key];
    const mark = (genome.marks && genome.marks[gene.key]) || 1.0;
    if (gene.kind === 'choice') {
      p[gene.key] = gene.choices[a];
    } else {
      p[gene.key] = clamp01(((a + b) / 2) * mark);
    }
  }
  // Derived, game-ready values (kept from v0.12):
  p.hueDeg = p.bodyHue * 360;
  p.bodyRadius = 14 + p.size * 18; // px at adult size
  p.lifespanSec = 300 + p.lifespan * 1500; // 5–30 minutes
  p.walkSpeed = 28 + p.size * 26; // px/sec, bigger = slightly faster
  p.fruitEfficiency = { herbivore: 1.0, omnivore: 0.8, carnivore: 0.5 }[p.diet];
  p.meatEfficiency = { herbivore: 0.25, omnivore: 0.7, carnivore: 1.0 }[p.diet];
  p.biteSize = 0.2 + p.mouthSize * 0.3;
  p.sightRange = 420 * (0.7 + p.eyeSize * 0.6);
  p.legSpeedMult = 0.7 + p.legLength * 0.6;
  p.legDrainMult = 0.8 + p.legLength * 0.4;
  p.spikeFear = p.spikes * 0.25;
  p.spikeArmor = p.spikes * 0.3;
  p.furInsulation = p.fur * 0.3;
  p.furWeight = p.fur * 0.15;
  // canopy (new): climbing speed and grooming reach from morphology.
  p.climbSpeed = 40 + p.legLength * 40 + p.tailLength * 20; // px/sec vertical
  p.groomReach = 40 + p.size * 30;
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
