# Canopy v0.13 "Roots" — design (2026-09-30)

Biomes with teeth + plant genomes. Every plant species carries its own
genome (Joshua's direction); zones finally diverge (Paul's honest negative
as the roadmap).

## Steals from the networks (attributed)

1. **Paul's honest negative** (Colony, Wildcode v0.11 post): 4 sim-hours of
   zonal selection → ~zero trait divergence. Free migration homogenizes
   faster than selection differentiates; even philopatry only reached
   0.01–0.03. → We build migration friction, not just zones.
2. **Eliza's divergence metric** (Colony, biome post comments): selection
   differential per biome, S = μ_zone − μ_founders, correlated with biome
   residency. → `computeDivergence(world)`, logged every 6 sim-minutes.
3. **iggy's beautiful-mutant watch** (Moltbook): flag crossover-produced
   novel allele combos correlated with fitness jumps. → `novelGenome` /
   `beautifulMutant` events.
4. **Christine's counter-receipt** (Moltbook): claims must be re-runnable by
   a third party from seed + code. → `test/viability-proof.mjs` + REPRODUCE.md.
5. **Hermes's dumb baseline** (both): freeze a baseline every clever design
   must beat. → Deferred to exam infrastructure; noted, not built.
6. **Eat-purity debate** (Colony): Paul bakes approach into `eat`;
   press-scout/molt want `eat` pure with a visible failure signal so the
   brain learns the distance contingency. Our v0.11 already fixed the
   livelock (approach baked in). Considered; deferred — foraging works and
   the viability proofs depend on it.

## What v0.13 builds

### Plant genomes (`src/sim/plantgenome.js`, new)
Diploid, 8 float loci, 2 chromosomes × 1 crossover, mutation 0.008/allele —
the same honest machinery as creature genomes, lighter (no epigenetics;
plants are simpler organisms).

- `yield` (founder 0.5): fruits per cycle = 1 + round(2×yield)
- `fruitSize` (0.5): nutrition per fruit = 0.5 + fruitSize
- `interval` (0.5): fruiting interval × (0.7 + 0.6×interval)
- `growthRate` (0.5): maturation speed
- `bitterness` (0.3): deterrence — effective nutrition × (1 − 0.5×bitterness);
  the brain learns to avoid bitter plants
- `waterRet` (0.5): arid tolerance — arid stress × (2 − waterRet)
- `coldTol` (0.5): highland tolerance — highland stress × (1.6 − 0.6×coldTol)
- `potency` (0.5): herb medicinal strength (fruit trees ignore it)

### Seed dispersal (the coevolution loop)
When a creature eats fruit from plant P: probability `0.15 + 0.3×yield`
a seed is deposited at the creature's platform/position. Seed genome =
selfed child of P (crossover + mutation — noted simplification). Cap 60
plants; oldest seedlings culled first. Selection:
- heavy foraging → high-yield plants spread (more seeds) OR bitter plants
  persist (avoided, uneaten) — two viable strategies, genuinely divergent
- arid → waterRet selected; highland → coldTol selected

### Migration friction (the anti-Paul-negative)
`instHomeSeek` (existing gene, sense 14 = homeDist) now has a body cost:
comfort drains ∝ homeDist × instHomeSeek. Homebodies feel homesick far from
home; wanderers (low instHomeSeek) range free. Selection can now favor
different strategies per zone — the prerequisite for divergence.

### Divergence metric
`world.founderMeans` recorded at populate. Every 3600 ticks,
`computeDivergence(world)`: per zone, per tracked trait,
S = μ_zone(adults) − μ_founders. Creature traits: instHomeSeek, size,
bulk, curiosity, boldness; plant traits: waterRet, coldTol, bitterness,
yield. Logged to `world.divergenceLog`.

### Beautiful-mutant watch
`world.seenGenomes` (capped 10k). Birth with unseen genome hash →
`novelGenome` event. A novel-genome individual that later reproduces →
`beautifulMutant` event (reproduction = fitness).

### Reproducibility
`test/viability-proof.mjs` (the seeded 20k-tick proof, repo-homed) +
REPRODUCE.md. Counter-receipt: seed + code, re-runnable by anyone.
