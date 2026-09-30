# Genome v2 — the tanglekin genome

*43 → 178 loci, 46 genes across 9 families. Every gene is wired into the sim —
no dead genes. Structure = Paul (Wildcode v0.12), depth = Emberhollow (diploid
meiosis, epigenetics, chemistry-under-drives).*

## Gene count

- v0.12 + canopy: 43 loci.
- v2: **178 loci, 46 genes** across 9 families (R/C/E/B/L/M/S/D + the original
  morphology/neurochemistry/instinct core).
- Inheritance: true diploid — parental genomes fuse, chromosomes align and
  cross over (duplications/deletions/mutations), then one genome is randomly
  destroyed (the Creatures/norn scheme). 8 chromosomes, thematic; linked genes
  cross over in segments, unlinked genes assort freely. Epigenetic marks ride
  alongside alleles.

## Design invariants (carried from v0.12 + Paul's rules)

- **Every new action needs an instinct gene** (Paul's v0.5 rule). No behavior
  without a heritable vote for it.
- **Senses are appended, never renumbered.** The sense indices are a contract.
- **Chemistry invariant:** drives are readouts of chemicals — pin the chemical,
  never the readout. Family D tunes the readout gain/baseline; it cannot
  rewire what hunger *is*.
- **No cap on brain evolution.** The `brainSize` gene sets the neuron budget;
  family B decides how it's organized.

---

## Family R: chemical reactions ×8 (chr 6)

The deep chemistry: 8 evolvable reaction channels converting substrate→product
above a threshold at a rate. Each gene is 4 loci: substrate (choice of 5
chemicals), product (choice of 5), rate (float), threshold (float).

| gene | substrate→product (founder) | founder rate |
|---|---|---|
| rx0–rx7 | chained 0→1→2→3→4→0 with cross-links | 0.03 (near-zero) |

Founder rates are whisper-quiet — the chemistry is present but silent.
Evolution can turn any channel up. Mass-conserving by construction
(`tickBiochem` enforces it): reactions transform, never create.

*Why it matters:* this is the substrate everything else reads. A mutation here
can invent a new hormone — a chemical that rises with age, spikes on mating,
or accumulates with crowding — and families C/D/E give evolution the tools to
wire it into senses, drives, and behavior.

## Family C: receptors ×6 (chr 5)

Chemical levels modulate senses: `sense += gain × max(0, chem − thr)`.
Each gene: chemical (choice), sense (choice of 21), gain (signed), threshold.

| gene | chemical → sense (founder) |
|---|---|
| rc0 | chem0 → hunger (sense 0) |
| rc1 | chem1 → loneliness (sense 3) |
| rc2 | chem2 → tiredness (sense 1) |
| rc3 | chem3 → fear (sense 4) |
| rc4 | chem4 → illness (sense 13) |
| rc5 | chem0 → boredom (sense 2) |

Founder gains are **0: silent by default, evolvable.** A receptor with positive
gain makes a chemical *feel* like hunger; negative gain makes it suppress
hunger. This is how interoception evolves — the body learning to read itself.

## Family E: emitters ×6 (chr 6)

Committing to an action releases a chemical pulse (once per commitment, not
per tick). Each gene: trigger action (choice of 12), chemical (choice of 5),
amount (float).

| gene | trigger → chemical (founder) | founder amount |
|---|---|---|
| em0 | eat → chem0 | 0.05 |
| em1 | sleep → chem2 | 0.05 |
| em2 | play → chem4 | 0.05 |
| em3 | groom → chem1 | 0.05 |
| em4 | flee → chem3 | 0.05 |
| em5 | mate → chem2 | 0.05 |

Founder amounts are small nudges, not floods. Combined with family C, this
closes the loop: *do X → release chemical → feel Y.* Mating releases a pulse
that a receptor could learn to read as bonding. Fleeing spikes a chemical
that could become the substrate of anxiety.

## Family B: brain architecture ×4 (chr 3)

Not what the brain thinks — *how it's built.* Four genes, multiple loci each:

**bpLayers / bpSparsity / bpHebb / bpLatInhib** — the brain plan:
- `bpLayers` (choice 1–3): how the `brainSize` neuron budget splits into
  hidden layers. Founder: 1 (the classic sparse layer).
- `bpSparsity` (0.65): 1 − density of sensory→assoc wiring. Founder → 0.35
  density, as before.
- `bpHebb` (0.5): Hebbian rate multiplier. Founder → ×1.0.
- `bpLatInhib` (0.85): lateral inhibition; loser scale = 1 − value.
  Founder → 0.15, as before.

**agCount / agGain / agThresh** — evolvable attention gates on the salience
EMA: how many senses get gated (×5, founder 0 = off), the gain boost on gated
senses, and the minimum salience to earn a gate.

**mtDecay / mtGain** — memory traces for delayed credit assignment: trace
decay per learn (0.9), and the trace's contribution to weight updates
(founder 0 = off).

**nmChem / nmGain / nmThresh** — neuromodulation: a chemical level modulates
the learning rate. Founder: chem4 (adrenaline) with gain 0 — stress *could*
tune learning, but doesn't yet.

*Why it matters:* the brain itself is now evolvable. Lineages can invent
attention, credit assignment, and stress-gated learning — or lose them.

## Family L: life history ×4 (chr 7)

The viability family — the genes Joshua asked for when the tanglekins
wouldn't sustain. Founder defaults reproduce the old constants exactly.

- **longScale** (0.5): `lifespanSec × (0.5 + value)`. Founder → ×1.0.
- **longAging** (0): lifelong health decline. Founder → none.
- **matTime** (0.5): stage thresholds × (0.5 + value). Founder → ×1.0.
  Controls when juveniles become adults — the breeding window's opening.
- **matBoost** (0): juvenile learning-rate boost. Founder → none.
- **ferPeak** (0.5): age-fraction of peak fertility (window ±0.4 of lifespan).
  Inside the window fertility is full; outside it declines. Founder 0.5 covers
  the whole adult stage — neutral, evolvable into early or late bloomers.
- **ferLitter** (choice 1–3, founder → 2): eggs per mating. The v0.5 "clutches
  of two" — one egg per mating kept the birth rate below the death rate once
  drift and infant mortality took their cut.
- **ferGest** (0.5): egg timer × (0.5 + value). Founder → ×1.0.
- **senOnset** (0.8): age-fraction when senescent decline starts.
- **senRate** (0): decline rate. Founder → off.

## Family M: morphology ×8 (chr 1)

Bulk, tail, regional pigmentation, ears, arms — plus heritable beauty
standards. Mostly render; `tailGrip` and `armLength` touch the sim.

- `bulk`, `tailCurl` — body girth, tail pose (render).
- `tailGrip` (0): prehensile strength → climb-speed bonus. **Touches the sim.**
- `pigHeadHue/Sat/Pat`, `pigTorsoHue/Sat/Pat`, `pigLimbsHue/Sat/Pat` —
  per-region coloration. Hue/sat are open traits (any value viable —
  camouflage is only selected *if* there's something to hide from, per
  Joshua's correction); pattern is a choice.
- `earSize`, `earTilt` — render.
- `armLength` (0.5): replaces `legLength` in the arm formula. Founder → same
  reach as before.

### matePref — heritable beauty standards (family M, chr 1)

One gene, three float loci:

| locus | range | founder | meaning |
|---|---|---|---|
| `matePrefHue` | 0..1 | 0.5 | preferred coat hue (circular) |
| `matePrefSat` | 0..1 | 0.5 | preferred coat saturation |
| `matePrefChoosy` | 0..1 | 0 (off) | how much color counts in mate choice |

**Wiring** (`gatherSenses`): when an adult/senior scores mate candidates:

```
score = proximity + choosiness × (1 − colorDistance)
```

- `proximity` = 1 − dist/sightRange (the old nearest-wins behavior).
- `colorDistance` = Euclidean distance in (hue, sat) between the candidate's
  expressed coat color and the chooser's preference; hue distance is circular.
- Founder `choosiness 0` → nearest wins, exactly the pre-v2 behavior. As
  `matePrefChoosy` evolves upward, color match beats proximity — sexual
  selection with drifting beauty standards.

The preference genes ride chromosome 1 through normal diploid meiosis, so
beauty standards are heritable and evolvable. Readable coloration (the
`pig*` loci above) gives those standards something to select *on* — the
open-trait principle: color is free to vary until a pressure (mate choice,
camouflage, signaling) grabs it.

## Family S: stimulus valence ×4 (chr 4)

World events carry evolvable valence → chemistry nudge + learnable reward.
Each gene: event (choice of 4), valence (signed), intensity.

| gene | event (founder) |
|---|---|
| st0–st3 | birth, death-nearby, mating-nearby, food-found (cycled) |

Founder valences are 0 — events are neutral until evolution assigns them
meaning. A lineage could evolve to find nearby matings rewarding (social
learning) or nearby deaths aversive (fear culture). This is where *culture*
gets its chemical foothold.

## Family D: drive tuning ×5 (chr 5)

Gain + baseline on the chemical→drive readout, one gene per drive:

| gene | drive | founder |
|---|---|---|
| `drvHungerGain/Base` | Hunger | gain 1.0, base 0 |
| `drvEnergyGain/Base` | Energy | gain 1.0, base 0 |
| `drvSocialGain/Base` | Social | gain 1.0, base 0 |
| `drvFunGain/Base` | Fun | gain 1.0, base 0 |
| `drvFearGain/Base` | Fear | gain 1.0, base 0 |

Founder defaults are the identity (gain 1, baseline 0) — the drives read
exactly as before. **The chemistry invariant stands:** drives are still
readouts of the five chemicals; D only tunes the readout. Evolution can make
a lineage hungrier, bolder, or lonelier — but it can't rewire what hunger is.

---

## The breeding fix (2026-09-30)

*Why this section exists: the v2 genome shipped with a mating loop that never
fired. Long headless runs (8 founders, 20000 ticks) went extinct with zero
matings on every seed. The genome was fine; the courtship mechanics were
broken. This is the diagnosis and fix.*

### What was wrong

Three compounding failures, found by instrumenting the sim:

1. **Same-platform mate sensing.** `_mate` (the valid-mate sense) required
   `o.platformIndex === c.platformIndex`. Adults diffuse across 9 platforms
   foraging; in a 4-founder probe, **zero** mixed-sex adult pairs ever shared
   a platform across 16 samples. The sense never fired, so neither the mate
   instinct nor the breeding backstop could run. (Inherited from Paul's v0.12
   rebase — not a Canopy regression.)

2. **The 240px backstop gate.** The breeding backstop only fired within 240px,
   but mates were sensed (once fix 1 landed) at up to 448px sight range.
   Mates were visible 61.5% of adult time; the backstop fired 0 times.

3. **Hunger starved courtship of decision slots.** Adults spend ~90% of ticks
   in `seekFood`. The backstop only overrode wander/play/approach/seekHome —
   so even with fixes 1–2, courtship never got a slot. Instrumented: 4,487 of
   4,497 backstop failures were `seekFood`.

### What changed (`src/sim/creature.js`, `src/sim/world.js`)

- **`_mate` sensing is 2D cross-platform.** Distance uses
  `Math.hypot(dx, platformY-delta)` — a mate on a nearby branch is visible.
  Mate-preference scoring (`proximity + choosiness × (1 − colorDistance)`)
  now operates on 2D proximity.
- **New `stepTowardPlatform` helper.** The `mate` action climbs toward the
  mate's platform via climb links (greedy: link whose destination is nearest
  the mate's height), then closes distance and calls `tryMate` under 50px.
  Courtship works in the canopy's full depth.
- **Backstop: sight-gated, hunger-aware.** Fires whenever a valid mate is
  sensed (the 240px gate was redundant with sight range) and hunger < 0.7 —
  matching `tryMate`'s own hunger gate, so courtship that starts can conclude.
  A mildly-hungry tanglekin courts; a starving one forages. The 0.7 threshold
  is self-limiting: courtship raises hunger, which re-enables foraging.
- **Starter fruit near founders** (`populate`): each founder gets a fruit
  within ±60px of its start, so juveniles don't starve before learning to
  forage.

### Proof

Viability probe (8 founders, 20000 ticks = 2000 sim-seconds, seeds 7/21/99):

| seed | alive | births | matings | verdict |
|---|---|---|---|---|
| 7 | 40 (cap) | 93 | 53 | VIABLE |
| 21 | 40 (cap) | 124 | 62 | VIABLE |
| 99 | 49 | 82 | 41 | VIABLE |

Before the fix: 0 matings on seeds 7/21, 1 on seed 99 — all extinct by
~15000 ticks. After: self-sustaining populations at carrying capacity on all
three seeds. Suite stays 100/100; `headless.mjs` and `dist-smoke.mjs` pass.
