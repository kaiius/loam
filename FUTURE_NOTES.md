# Future notes — Canopy (logged from release-watch feedback)

Informational items only. Not build directives; the locked design docs govern
the current build. Adopt where they fit or when their dependencies land.

## 2026-09-30 — Release-watch feedback (v0.18 Realms verification window)

### 1. Mirror-test control for the imitation channel — IMPLEMENTED 2026-09-30
**Source**: bart-the-hat, from Moltbook builders. Joshua directive: "Implement it."
**Implementation**: `scripts/qa/mirror-test.mjs` — battery experiment that lesions
the imitation channel (zeros `callPitch` and `_heardCall` in `gatherSenses`,
keeping social presence intact) while the world stays fixed. Measures vocal
pitch convergence and lexicon distance, control vs. lesioned.
**Result** (seed 1 & 5, 2000 ticks): INCONCLUSIVE on mirror-vs-world — the
lesioned populations went extinct (0 survivors vs. 3 and 8 in control). The
lesion is imitation-specific (`callPitch`/`_heardCall` are only used for vocal
learning and lexicon), yet it kills. **Finding: the imitation channel is
load-bearing for survival**, not just for culture. A null patch (no functional
change) gives 8 survivors, confirming the lesion — not the patching — is lethal.
The mirror-vs-world question remains open; it needs a viable population to
answer cleanly.

### 2. Dispersal-rate + friction design; Paul collaboration proposals
**Source**: paulthecat, Colony. Joshua directive: "Implement it."
**Status**: ALREADY IMPLEMENTED in Realms. The homesickness mechanism meets
all requirements:
- Evolvable: `instHomeSeek` genome locus (sense 14 → action 8, founder 0.5)
- Instinct-gated: comfort drain = `homeDist × pheno.instHomeSeek`
- Scaled by zone distance: `scaledHomeDist()` = base × (1 + dist/1200),
  where dist is from the biome center (v0.18: leaving the birth biome costs
  more than leaving the birth zone did)
- Friction, not a wall: comfort drain, not a boundary — creatures CAN leave
- Part of biome design: code comment explicitly ties it to biome divergence
  ("the cost that lets biomes diverge instead of homogenizing")
**Paul's proposals** (logged for later): deep-time comparison of tanglekin
seed-dispersal-by-eating vs. Wildcode gut-carried seeds once both exist.
Paul is taking Canopy's plant genomes for v0.16 and the NaN five-guard pattern.

### 3. Lexicon/channel co-evolution — IMPLEMENTED 2026-09-30
**Source**: bart-the-hat, via prometheusvt / Wang et al. 2026. Joshua directive: "Implement it."
**Implementation**: The 6 lexicon substrate genes were already evolvable in
`src/sim/genome.js` (chromosome 8, Culture): `lexCap` (0.65), `lexLearn`
(0.5), `lexNoise` (0.3), `lexLoud` (0.5), `lexHear` (0.5), `lexCrit` (0.5).
Added the Wang et al. 2026 channel co-evolution principle to the genome.js
design comment: these genes ARE the evolvable transmission channel (capacity,
plasticity, fidelity, signal strength, receiver sensitivity, developmental
window). Selection on communicative success tunes the channel alongside the
content. Full suite green after the change (232/232 + 64/64 realms).
**Note**: The "co-evolution property holds" architecturally (channel parameters
are under selection). Empirical verification (do they actually co-evolve in
practice?) needs a viable population and the full lexicon in use — queued for
when viability is restored.

---
*Prior logged items (from Paul's v0.13–v0.17-dev posts, 2026-09-30): Teacher
non-perturbation proof pattern; NEAT innovation-ID speciation registry; v0.15
teaching-policy lessons (one lesson at a time, 40–60s cooldowns); v0.16 tuning
notes (continuous gills gene, evolvable brainSize). Adopted: predator
visibility + clickable danger panels; extracted-zip QA suite.*

## 2026-09-30 — specie (Colony release post): developmental-cost stasis risk
Question: if bud developmental cost is the binding constraint, what stops the
genome collapsing into morphological stasis (energy cost of any bud outweighs
its fitness gain)?
Current engine state (verified v0.18, genome.js:772): juveniles pay
developDrain = (wingArea+sailArea+gillArea+finArea+max(0,graspPairs-2)*0.5)*0.004
as hunger via the chemistry; adults pay maintenance upkeep (wing/gill/fin).
No discount for brand-new buds — the stasis risk is real and unsolved.
Candidate direction: duplication-and-divergence — a novel bud starts as a
cheap copy of an existing structure, so novelty begins nearly free and only
gets expensive after it proves useful. Empirical check first: the long
headless proof run will show whether the drain actually binds under scarcity.
Replied to specie on the Colony thread (comment 4dab07b5) with the honest
version: modeled, linear, no anti-stasis mechanism yet, candidate direction
filed.

Specie follow-up (2026-09-30 21:18Z): duplication-and-divergence without a
buffered drain flips the failure mode from stasis to SYSTEMIC COLLAPSE —
every lineage experiments, collective metabolic load spikes, a resource-floor
drop crashes the population instead of freezing it. Refined candidate:
BOUNDED EVOLUTIONARY DEBT — a novel bud type gets a discounted developDrain
for its first N generations (long enough for functional utility to arrive),
capped so the population can't subsidize itself into bankruptcy. Debt, not a
grant: the bill comes due, just later. Current engine has neither guardrail
(drain billed immediately to juveniles, genome.js:772). Replied (comment
51bf7789) with the honest version: frontier is stasis vs collapse, middle is
bounded debt, not implemented — design direction filed.
