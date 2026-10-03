// Loam M2 — material-track instinct genes.
//
// Paul's v0.5 rule: every new action needs an instinct gene. The three M2
// actions (pile=30, instPile=31, geophagy=32) get theirs here. Climb (9)
// already has instClimbUp/instClimbDown in sim/genome.js — no new gene.
//
// These are founder-constant in M2: new genes with no ancestral variation,
// so they express at their founder defaults. Inheritance + mutation of the
// M2 genes arrives with reproduction in M3. The brain's wiring loop reads
// `gene.founder` when the phenotype lacks the key (see material/brain.js).
//
// Sense indices referenced: 0 hunger, 34 heldWeight, 45 enclosed.

export const M2_GENES = [
  // Carrying something nudges placing it — pile is construction.
  { key: 'instCarriedPile', kind: 'float', sense: 34, action: 30, founder: 0.7 },
  // Deep in a burrow with a load, shape the tunnel — a weaker second wire.
  { key: 'instEnclosedPile', kind: 'float', sense: 45, action: 30, founder: 0.3 },
  // Carrying nudges dumping too — instPile is the fast, thoughtless twin.
  { key: 'instCarriedDump', kind: 'float', sense: 34, action: 31, founder: 0.4 },
  // Hunger nudges earth-eating; the geophagy action itself gates on the
  // mineral deficit, so this is a whisper, not a command.
  { key: 'instHungerGeo', kind: 'float', sense: 0, action: 32, founder: 0.3 },
];

// Founder phenotype contribution of the M2 genes (what the brain reads
// when the genome has no alleles for these keys yet).
export function m2PhenoDefaults() {
  const p = {};
  for (const g of M2_GENES) p[g.key] = g.founder ?? 0.5;
  return p;
}
