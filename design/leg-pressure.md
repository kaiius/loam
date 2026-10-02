# v0.33 — leg-pressure experiment (BIOMES_DESIGN §13.7)

A measurement version. It gets a verdict, not just code.

## The question

Previous measurements couldn't tell whether creatures failed to climb
because of weak legs or because illness/contamination killed them first.
Weak legs → floor-dwelling → contaminated floor food → illness → death:
the leg signal and the illness signal arrive through the same door.

## The method (2×2 factorial + sweep)

- **Sweep** legPower ∈ {0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6} by
  post-populate allele override: every founder's legPower homologs set to
  [X, X], phenotype re-derived. Same world seed → same founders, same
  worldgen, same initial RNG state; the ONLY difference across treatments
  is legPower. (The established §13.7 confound fix — cf. genome.js
  `randomGenome(rng, {pinSub, overrides})` — applied at the founder level
  so `populate()` itself is untouched.)
- **Cross** with `noFouling` ∈ {off, on}. OFF = natural (illness confound
  present). ON = contamination neutralized at the source
  (`wasteOdorOf → 0`, fouling gates) → illness-death rate ≈ 0; any
  remaining leg-dependent signal is pure leg effect.
- **Seeds** {3, 42, 99} — viable on v0.32 (seed 7 is EXTINCT on v0.31+;
  retired from the battery, see REPRODUCE.md).
- **20,000 ticks** per cell (the viability standard), DT=0.5.
  (v0.33 as run: 12,000 ticks — the regime shift shows by tick 2000 and
  12k covers multiple generations; 20k was computationally out of reach
  on the contended VM. The probe takes ticks as an argument.)

## Metrics per cell

- Leg-driven: jumps/1k creature-ticks, climbs/1k creature-ticks,
  hardLanding/1k, strandedFall/1k, wounds-deaths/1k creature-ticks,
  floor-time fraction.
- Confound: illness-deaths/1k creature-ticks.
- Controls: births/1k, starvation/1k, old-age/1k (should NOT track leg).
- Treatment integrity: end-mean legPower of the living population
  (does selection + mutation hold the override, or drift off-target?).
- Viability: alive at end, time-to-extinction for crashed runs.

Normalization lesson (caught mid-build): wall-tick rates are meaningless
for extinct runs — a population that crashes at tick 2000 dilutes its
rates across 18000 empty ticks. All rates normalize by creature-ticks
(lived ticks), approximated from 1-in-10 sampling.

## The verdict rule (revised after Gemini spec review)

Single thresholds are dead — the landscape is zoned. Report the zone
boundaries, measured separately in the noFouling=ON arm (pure leg effect)
vs OFF arm (illness amplifier):

- **Safe Zone** (low legPower): ballistic ceiling below useful heights —
  obligate ground-dwellers; the ground ecology supports them.
- **Lethal Incompetence Zone**: enough power to leave the ground, not
  enough to return reliably — the tombstone range.
- **Viable Canopy Zone**: jumps clear typical platform gaps.

Plus the analytic capacity bound (vy²/2g vs measured platform gaps):
what the legs CAN do vs what the population DOES (brain-mediated).

## Adversarial checklist (from spec review — adjudicate when numbers land)

1. If noFouling=ON and 0.25 still dies: check the cause. `wounds` →
   the Safe Zone is an impact-velocity shield (ballistic ceiling below
   the 520 px/s injury threshold); `starvation` → stranding/metabolic.
2. If the 0.6 arm shows higher energy than 0.2: the experiment measured
   caloric efficiency (flat jump cost × variable impulse), not
   climb-pressure. (Jump bills _active=1 flat — impulse is free.)
3. Stranding-recovery time is censored by instant fatalities — weigh it
   against per-fall fatality rate (survivorship bias otherwise).
4. jumps-vs-climb-links ratio: high jumps + low link use at 0.6 →
   proprioceptive mismatch (body outruns learned timing), not a
   physical limit.
5. Seed bias (N=3 viable seeds): measures tolerance of established
   populations, not de-novo evolvability — stated limitation.

## RNG discipline

No new RNG draws in the sweep mechanism (allele override is a pure
assignment; `phenotype()` is deterministic). Treatment assignment cannot
perturb any sub-stream. Behavior-driven divergence downstream is the
causal path being measured, not a confound.

## The clean arm (v0.33 surgical fix)

The v0.18 `noFouling` froze the WHOLE soil cycle (`excrete` and
`tickSoil` no-ops) — which would have starved the CLEAN arm via
fertility depletion (plants draw minerals from fertility; no composting
= declining growth multiplier). Caught mid-build when 0.6 CLN went
extinct of starvation while 0.6 NAT thrived.

The illness path is neutralized at ONE point: `wasteOdorOf → 0` (this
is what the creature.js illness contraction multiplies by:
bite × odor × CONTAM_ILLNESS = 0). Detritus grazing was already gated
on `!noFouling` in creature.js. So the CLEAN arm keeps the full nutrient
cycle (waste → fertility → plants) and differs from NAT only by the
illness contraction (+ the detritus fallback, a starvation-only path).

## Reproduce

`node probes/leg-pressure.mjs [seed] [ticks]` — full sweep for one seed;
aggregate across seeds by hand. Prints the per-cell table and the
verdict.
