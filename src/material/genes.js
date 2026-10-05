// Loam M2 — material-track instinct genes.
//
// Paul's v0.5 rule: every new action needs an instinct gene. The three M2
// actions (pile=30, instPile=31, geophagy=32) get theirs here, plus
// instFoodDistEat — the proximity gate on the existing eat action (the
// starvation fix). Climb (9) already has instClimbUp/instClimbDown in
// sim/genome.js — no new gene.
//
// These are founder-constant in M2: new genes with no ancestral variation,
// so they express at their founder defaults. Inheritance + mutation of the
// M2 genes arrives with reproduction in M3. The brain's wiring loop reads
// `gene.founder` when the phenotype lacks the key (see material/brain.js).
//
// Sense indices referenced: 0 hunger, 6 foodDist, 33 heldWeight, 45 enclosed,
// 46 mineral (R4).
// (2026-10-03 fix): instCarriedPile was wired to sense 34 (falling) — a
// latent M2 miswire; the intent "carrying nudges placing" is heldWeight (33).
// pile is rarely selected while falling, so the miswire was dormant.
// (2026-10-05 R4 fix): instHungerGeo's founder was 0.3 — weight −0.48, hunger
// INHIBITED earth-eating against its own comment. Founder 0.7 now, a whisper
// in the comment's direction. The mineral sense (46) carries the real drive.

export const M2_GENES = [
  // Carrying something nudges placing it — pile is construction.
  { key: 'instCarriedPile', kind: 'float', sense: 33, action: 30, founder: 0.7 },
  // Deep in a burrow with a load, shape the tunnel — a weaker second wire.
  { key: 'instEnclosedPile', kind: 'float', sense: 45, action: 30, founder: 0.3 },
  // Carrying nudges dumping too — instPile is the fast, thoughtless twin.
  { key: 'instCarriedDump', kind: 'float', sense: 34, action: 31, founder: 0.4 },
  // Hunger nudges earth-eating; the geophagy action itself gates on the
  // mineral deficit, so this is a whisper, not a command. (R4: founder was
  // 0.3 — a negative weight that inhibited earth-eating against this very
  // comment. Now 0.7, the whisper the comment always meant.)
  { key: 'instHungerGeo', kind: 'float', sense: 0, action: 32, founder: 0.7 },
  // Mineral deficit IS the geophagy drive's wire — the sense the action was
  // always meant to answer (R4: sense 46, new with the mineral sense). Strong
  // but not pinned: at full deficit it outranks idleness, not a starving
  // creature's hunger→eat (1.2). The creature chooses; the physics is fair.
  { key: 'instMineralGeo', kind: 'float', sense: 46, action: 32, founder: 0.8 },
  // Distance vetoes the consummatory act (the starvation fix, 2026-10-03):
  // hunger may cry for food, but EAT only fires when food is within reach.
  // foodDist 0 (adjacent) → no veto; foodDist 1 (far/none) → full veto, so
  // the appetitive phase (seekFood) wins at range and the consummatory
  // phase (eat) wins up close. Founder 0.0 → the strongest veto the gene
  // range allows (weight -1.2); the crossover lands at foodDist ~0.25-0.3,
  // just inside tryEat's 120px fruit reach. Lineages can soften it.
  { key: 'instFoodDistEat', kind: 'float', sense: 6, action: 1, founder: 0.0 },
  // Loam has no toys (senses.js: honest toyDist=1, "none far away"), but the
  // platform gene instToyDistPlay (sense 10 → play, founder 0.8) reads that
  // constant 1 as a permanent play subsidy — up to +0.96 drive for high
  // alleles, enough to beat a starving creature's EAT. There is no toy to
  // seek, so the reflex is unlearned here: weight exactly zero. This
  // OVERWRITES the platform wire (the M2 loop assigns, not adds).
  { key: 'instToyDistPlayLoam', kind: 'float', sense: 10, action: 3, founder: 0.5 },
  // ── Drive priority: survival overrides social (the starvation fix, part 2)
  // Loam M3 has no in-world reproduction yet, so founder instinct variance
  // cannot be selected away. A founder that rolls a weak hunger→eat allele
  // (0.58 → weight 0.18) will groom and socialize while starving to death —
  // measured: play/approach outrank eat 8-to-1 at bloodSugar 0.0. These genes
  // pin the survival drives and inhibit the social drives in proportion to
  // hunger, giving every founder a working appetitive→consummatory chain.
  // All OVERWRITE the platform wires (the M2 loop assigns, not adds). When
  // Loam gains reproduction, relax these and let selection tune them.
  // Survival floors: hunger→eat and hunger→seekFood pinned strong.
  { key: 'instHungerEatFloor', kind: 'float', sense: 0, action: 1, founder: 1.0 },
  { key: 'instHungerSeekFloor', kind: 'float', sense: 0, action: 0, founder: 0.9 },
  // Hunger inhibits the social drives (negative weights scale with hunger):
  // a starving creature eats; a merely peckish one may still socialize.
  { key: 'instHungerNoApproach', kind: 'float', sense: 0, action: 4, founder: 0.15 },
  { key: 'instHungerNoPlay', kind: 'float', sense: 0, action: 3, founder: 0.15 },
  { key: 'instHungerNoGroom', kind: 'float', sense: 0, action: 10, founder: 0.15 },
  { key: 'instHungerNoMate', kind: 'float', sense: 0, action: 6, founder: 0.15 },
];

// Founder phenotype contribution of the M2 genes (what the brain reads
// when the genome has no alleles for these keys yet).
export function m2PhenoDefaults() {
  const p = {};
  for (const g of M2_GENES) p[g.key] = g.founder ?? 0.5;
  return p;
}
