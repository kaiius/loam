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
