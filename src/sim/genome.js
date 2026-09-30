// Digital DNA: diploid genome, inheritance with crossover + mutation,
// and phenotype expression. Alleles are normalized to [0,1] for float genes.

export const GENES = [
  // appearance
  { key: 'bodyHue', kind: 'float' },
  { key: 'patternDensity', kind: 'float' },
  { key: 'size', kind: 'float' },
  { key: 'tailLength', kind: 'float' },
  { key: 'eyeSize', kind: 'float', founder: 0.6 }, // v0.6: functional — bigger eyes, farther sight
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
  // v0.5: mating finally has an instinct pathway. Before this, no gene pointed
  // at the mate action, so it was never tried, never reinforced, and lineages
  // went extinct. Loneliness (need for company) drives courtship; the +0.8
  // mating reward then takes over through learning.
  { key: 'instLonelyMate', kind: 'float', sense: 3, action: 6, founder: 0.8 },
  // v0.8: the sick seek the bitter leaf. Illness (sense 13) drives
  // food-seeking (action 0); the food sensor points sick creatures at herbs,
  // so this evolvable prior bootstraps self-medication and learning refines it.
  { key: 'instIllnessSeek', kind: 'float', sense: 13, action: 0, founder: 0.5 },
  // v0.12: the homeward prior. homeDist (sense 14) drives seekHome
  // (action 8). Justified by the v0.5 precedent: an action with no instinct
  // pathway is never tried and never learned. Founder 0.5 — moderate;
  // evolution and learning tune the strength from there.
  { key: 'instHomeSeek', kind: 'float', sense: 14, action: 8, founder: 0.5 },
  // morphology — v0.6: body parts with stat tradeoffs (Spore-inspired).
  // What you see IS the DNA: each gene changes both looks and function,
  // so lineages visibly diverge instead of 40 identical blobs.
  // Founders start near viable defaults (like the instinct genes); evolution
  // drifts from there. Uniform-random founders could roll small mouths +
  // short legs + poor eyes and starve before generation 2 (seed 99).
  { key: 'diet', kind: 'choice', choices: ['herbivore', 'omnivore', 'carnivore'], founder: 0 },
  { key: 'mouthSize', kind: 'float', founder: 0.5 },
  { key: 'legLength', kind: 'float', founder: 0.5 },
  { key: 'spikes', kind: 'float', founder: 0.2 },
  { key: 'fur', kind: 'float', founder: 0.5 },
  // eyeSize (above, appearance) is now functional too: bigger eyes, farther sight.
  // v0.7: tradition — fidelity of cultural transmission. High-fidelity copying
  // is what makes the ratchet turn instead of slipping: traditions copied
  // faithfully persist across generations; sloppy copying lets them decay.
  // (The ratchet is selection on a second inheritance channel, and this gene
  // tunes that channel.)
  { key: 'tradition', kind: 'float', founder: 0.5 },
];

const GENE_MAP = Object.fromEntries(GENES.map((g) => [g.key, g]));

export function randomAllele(gene, rng) {
  if (gene.kind === 'choice') {
    // Founders start with a sensible default (e.g. herbivore diet);
    // later generations drift via mutation.
    if (gene.founder !== undefined) return gene.founder;
    return rng.int(0, gene.choices.length - 1);
  }
  if (gene.founder !== undefined) {
    // Founders start near a sensible default; evolution drifts from there.
    return clamp01(gene.founder + (rng.next() - 0.5) * 0.5);
  }
  return rng.next();
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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
  // v0.6 morphology: functional body parts with tradeoffs.
  p.fruitEfficiency = { herbivore: 1.0, omnivore: 0.8, carnivore: 0.5 }[p.diet];
  // v0.7: meat efficiency — the carnivore gene's niche arrives. The dead
  // leave carcasses; carnivores eat meat at full value, herbivores barely
  // touch it. Scavenging, not predation — nobody hunts yet.
  p.meatEfficiency = { herbivore: 0.25, omnivore: 0.7, carnivore: 1.0 }[p.diet];
  p.biteSize = 0.2 + p.mouthSize * 0.3; // was a fixed 0.35 for everyone
  p.sightRange = 420 * (0.7 + p.eyeSize * 0.6); // big eyes see farther
  p.legSpeedMult = 0.7 + p.legLength * 0.6; // long legs = fast...
  p.legDrainMult = 0.8 + p.legLength * 0.4; // ...but hungry legs
  p.spikeFear = p.spikes * 0.25; // intimidation aura on nearby creatures
  p.spikeArmor = p.spikes * 0.3; // thicker skin: illness resistance bonus
  p.furInsulation = p.fur * 0.3; // slower energy drain...
  p.furWeight = p.fur * 0.15; // ...but heavier
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
