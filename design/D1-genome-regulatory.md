# D1 — Genome regulatory depth: family G, the buffered duplication drain, extended R/C

*Design only (2026-10-06). No src/ changes. The genome becomes a program that
rewrites its own wiring — genes gating genes — and the duplication machinery
gains the neutral buffer that answers specie's stasis/collapse critique.*

## 0. Invariants up front

1. **Append-only, never renumbered.** All new loci append after the current
   228 (`GENES.length`); `SENSE32`, `ACT20`, `CHEM7` are untouched. A new
   chromosome 10 is additive — `meiosis` loops `for (const chrom of CHROMOSOMES)`
   (`src/sim/genome.js:982`), so a 10th entry keeps linked inheritance working
   with no code change to the loop. Builder note: `test/sim.mjs:3693–3699`
   asserts `CHROMOSOMES.length === 9` — that test must be updated to 10, and
   every chromosome-count hardcode grepped.
2. **Mass conservation for all R-family chemistry.** The transfer is
   `move = min(rate × (sub − thr) × dt, subV, 1 − b[prod])`
   (`src/sim/biochem.js:405–424`, rate read at :418, bounded move at :421).
   Gating an R rate only scales the `move` magnitude; the min-bounds hold
   regardless. Extended channels add no chemicals — `CHEM7` is closed.
3. **The chemistry invariant stands.** Drives are readouts of the seven
   chemicals — pin the chemical, never the readout (`src/sim/biochem.js:427+`,
   family D section). Family G may scale a drive's *gain* or *baseline* (both
   still readout-side), but the chemical→drive correspondence table is not a
   locus: no G gene can rename what hunger is, nor gate the table itself.
4. **Epigenetic fade preserved.** Marks still fade `1.0 + (m − 1.0) × 0.5` per
   generation (`src/sim/genome.js:~1001`, 0.5×–1.5× range). Gating multiplies
   *after* the mark: `p[key] = mean × mark × gateMult[key]`. The mark remains
   an independent heritable channel; gating is a parallel one.
5. **No new verbs, senses, or instincts — wiring, not actions.** This track
   adds regulation machinery only. Paul's v0.5 rule (every new action needs
   an instinct gene) is satisfied vacuously, exactly like v0.32
   (`design/nervous-system.md` — "no new actions → no new instinct genes").
6. **Determinism.** Gating at tick time is a pure function of live state —
   zero RNG draws. All duplication/pool randomness in `inherit()` runs on a
   dedicated causal sub-stream (pinned salt `0x47`), never the affect
   sub-stream (salt `0x55`, reserved for drive/verb loci —
   `src/sim/genome.js:1014–1031`). Founder alleles for all 92 new loci draw
   from a new `randomGenome` pass (pass 10, salt `0x47`) — the standing rule
   from `src/sim/genome.js:376–379` and `:764–785`: new loci never shift the
   main RNG sequence.

---

## (a) Current mechanism — precisely

**228 loci** (`GENES.length`), diploid, 8→9 chromosomes (v0.17 added chr 9),
1–3 crossovers per chromosome (`src/sim/genome.js:982`), mutation 0.008/allele
(`MUTATION_RATE`, genome.js:663), epigenetic marks scale float expression
0.5×–1.5× and fade toward 1 across generations (genome.js:~1001).

| family | loci | layout (genome.js) | founder behavior |
|---|---|---|---|
| R (reactions) | 8 genes × 4 | genome.js:178–186; read in `tickBiochem` biochem.js:405–424 | rate 0.03 (whisper) |
| C (receptors) | 6 × 4 | genome.js:188–195; read in `gatherSenses` creature.js:608–623 (`gain × max(0, chem − thr)`) | gain 0 (silent) |
| E (emitters) | 6 × 3 | genome.js:197–204; fired once per commitment creature.js:810–811, 2546–2549 | amount 0.05 (nudge) |
| B (brain plan) | 14 loci | genome.js:206–219 | identity / off |
| L (life history) | 9 loci | genome.js:221–234 | reproduce old constants |
| M (morphology) | 20 loci | genome.js:236–258 | founder animal |
| S (valence) | 4 × 3 | genome.js:260–263 | valence 0 (neutral) |
| D (drive tuning) | 5 × 2 | genome.js:265–269; readout in biochem.js drives section | gain 1, base 0 (identity) |
| + v0.14 voices/disgust, v0.16 tongues, v0.17 evo-devo (family V: 19 loci, genome.js:343–370, `segCount`/`tailCount` regulators + 5 bud sites), v0.18 realms, v0.20 hands/falling, v0.22 bite, v0.37 affect | — | appended per the never-renumber rule | founder-exact |

**Current duplication machinery** (genome.js:721–723, 1038–1070): `DUP_RATE`
0.001/gene/generation, `DEL_RATE` 0.002/active-copy/generation,
`MAX_EXTRA` 6. Newborn copies land **directly in `genome.extra` and average
into expression by dosage immediately** (genome.js:1086–1099), mutate
independently, and segregate 50% per copy through meiosis
(genome.js:1004–1011). Choice genes are excluded from duplication
(genome.js:1040–1043) — a second choice pair has no expression path.

**The specie stasis/collapse critique, stated mechanically:** because every
duplication is *immediately dosage-contributing*, there is no neutral
reservoir. A duplicated gene either decays (deleted at 0.002/gen) before it
can diverge, or its immediate dosage shift is selected against —
redundancy collapse. Nothing can sit silently, accumulate neutral mutations
for hundreds of generations, and then be recruited. The genome has
duplication without divergence machinery.

---

## (b) The concrete deepening

**Locus count: 228 → 320** (+92). All appended after current `GENES.length`.

### Family G — transcription-factor analog ×8 (chr 10 "Regulation")

Each G gene is 4 loci: a regulator (chemical), a target (gene), a response
curve (threshold, signed slope).

```
// g{i}reg   choice CHEM7          — regulator: which chemical level gates
// g{i}tgt   choice GTARGETS       — target: which gene's expression is gated
// g{i}thr   float                 — curve threshold
// g{i}slope sym  ([−1,1])         — signed curve amplitude
```

`GTARGETS` is built at load time: all `GENES` keys of kind
`float | sym | exp`, **excluding family G itself** (no gate-on-gate chains —
evaluation is single-pass, no recursion) and **excluding choice genes** (a
categorical can't be scaled; `segCount`/`tailCount` stay outside the
regulatory layer by construction). Because `GENES` is append-only, target
indices are stable forever.

**Response curve:** `gateMult = 1 + slope × σ((reg − thr) × 4)`, σ the
logistic. Steepness fixed at 4; evolution tunes threshold and signed
amplitude. `|slope| ≤ 1` and `σ ∈ (0,1)` ⇒ mult ∈ (0, 2) — never negative,
expression stays non-negative.

**Tick-time semantics — the key decision:** the gate is evaluated **at the
target's own read site**, not folded into `phenotype()` once at birth. The
regulator value is the *live* chemical level at the moment the target is
read:

| target family | read site | gating moment |
|---|---|---|
| R rate/thr | `tickBiochem` per tick (biochem.js:413–421) | live chemistry — true TF dynamics |
| C gain | `gatherSenses` per tick (creature.js:614–622) | live |
| E amount | `fireEmitters`, once per commitment (creature.js:2546–2549) | event-time |
| D gain/base | drives readout per tick (biochem.js drives section) | live |
| V bud floats (grow/pow/len) | `expressBuds` at birth/stage change | developmental window — stress-hormone-gated organ growth (pairs with EVODEVO §2.2's nutrition scaling) |
| instinct weights | `createBrain` wiring at birth | birth-time |
| `dupRate` / `poolDrain` | `inherit()` per generation | generational — chemistry-gated evolvability |

`phenotype()` still computes base expressions (`mean × mark`) exactly as
today (genome.js:1080–1103); each read site wraps its read as
`read × gateMult(target)`. The G genes' own loci carry epigenetic marks
like any loci — a mark on `g{i}slope` scales the amplitude before the
curve is evaluated.

**Evo-devo interaction:** family V's float bud loci (`budShoulderGrow`,
`budDorsalPow`, `budMidLen`, `matePrefNovel`, …) are legal G targets, so the
developmental program gains state-dependent regulation for free —
e.g. adrenaline-gated dorsal-bud growth is one selection step away from a
gene that reads `g0reg = adrenaline`. The bud *type* vocabulary stays choice
and ungateable (§c); the *program* (grow/pow/len) becomes regulable. `segCount`
and `tailCount` are choice — excluded, documented.

### The buffered duplication drain — family Q machinery ×4 (chr 10)

New loci: `dupRate` (float, founder 0.001 — reproduces `DUP_RATE` exactly),
`poolDrain` (float, founder 0.002 — reproduces `DEL_RATE` exactly),
`poolCap` (choice `[8,12,16]`, founder index 1 → 12), `poolRecDiv` (float,
founder 0.15 — the recruitment divergence threshold). `dupRate` is itself a
legal G target: chemistry-gated evolvability is in the vocabulary from day
one.

New genome field **`genome.pool`**: silent duplicated pairs, *not* in the
expression path. `genome.extra` keeps its current meaning — active,
dosage-averaging copies (cap 6, unchanged) — but newborn duplications no
longer land there.

`inherit()` becomes (per generation, on the causal `0x47` sub-stream):

1. Newborn duplications (P = expressed `dupRate` per non-choice gene) land
   in `pool`, carrying a snapshot of the gene's epigenetic mark (fades
   ×0.5/gen toward 1, same rule as gamete marks).
2. Pooled copies mutate independently (same `MUTATION_RATE`, pool
   sub-stream) and their divergence from the gene's *current* base pair is
   tracked: `div = |a − baseA| + |b − baseB|`.
3. Drain: each pooled copy is deleted with P = expressed `poolDrain`.
   Drain is the default fate — the drain, not selection, clears the buffer.
4. Recruitment: a copy with `div ≥ poolRecDiv` is promoted to an active
   dosage copy in `extra` (if active slots remain under the 6-cap;
   otherwise it waits in the pool). Promoted copies express exactly as
   today's duplicates do (genome.js:1086–1099).
5. Overflow: if the pool exceeds `poolCap`, the oldest copies drain first
   (age-ordered, no RNG needed).

Meiosis: pool copies segregate 50% like presence/absence alleles, same as
current `extra` copies (genome.js:1004–1011).

**The specie answer, mechanically:** duplication is now neutral-from-birth
(no dosage shock — no immediate fitness cost for selection to purge), the
buffer drains by default (no redundancy-collapse load on expression), and
only copies that have *demonstrated divergence* (`div ≥ 0.15`) ever touch
expression. Stasis — the pool sitting silent for a thousand generations —
is a result, never a failure (same stance as EVODEVO §4).

### Extended R ×8 and C ×6 — founder-silent (chr 6, chr 5)

- `rx8`–`rx15` (32 loci): substrate/product choices cycle the founder
  chain, **`rx{i}rate` founder 0.0** (dead-silent, stricter than the
  whisper 0.03 — truly off until selection turns them on), thr 0.5.
  The `tickBiochem` loop extends 8→16; rate ≤ 0 → `continue`
  (biochem.js:419), so the extension is behavior-identical at founder.
- `rc6`–`rc11` (24 loci): chem/sense cycle the rc0–5 founders,
  **gain founder 0**; the `gatherSenses` loop extends 6→12, gain 0 →
  `continue` (creature.js:615).

Mass conservation is untouched: no new chemicals, and the min-bounded
transfer (biochem.js:421) holds per channel regardless of count.

### Chromosome placement

- **Chr 10 "Regulation" (new):** all 36 family-G/Q loci. Regulators and the
  duplication machinery travel together — the chromosome is a story:
  *the machinery that rewrites the wiring.*
- **Chr 6:** extended R loci join `_chrR`'s list (same story: chemistry).
- **Chr 5:** extended C loci join `_chrC`'s list (same story: the
  chemistry/sense interface).

Founder allele draws: `randomGenome` pass 10, salt `0x47` — main sequence
bit-identical (genome.js standing rule, :764–785).

### Founder defaults — current behavior reproduced exactly

| locus | founder | why behavior is unchanged |
|---|---|---|
| `g{i}reg` | `i % 7` | irrelevant — see next line |
| `g{i}tgt` | index of `curiosity` | arbitrary; `g{i}slope` 0 ⇒ mult ≡ 1.0 exactly (`1 + 0 × σ(·) = 1.0` in float) |
| `g{i}thr` | 0.5 | — |
| `g{i}slope` | 0 | the neutralizer |
| `rx{8..15}rate` | 0.0 | biochem `continue` path |
| `rx{8..15}thr` | 0.5 | — |
| `rc{6..11}gain` | 0 | `gatherSenses` `continue` path |
| `dupRate` | 0.001 | = current `DUP_RATE` |
| `poolDrain` | 0.002 | = current `DEL_RATE` |
| `poolCap` | idx 1 → 12 | new machinery, inert at founder |
| `poolRecDiv` | 0.15 | new machinery, inert at founder |

Founder genomes have empty `pool` and empty `extra` ⇒ `phenotype()` output
is bit-identical to the current build, field by field.

---

## (c) Explicit NOT-do list

- **Never renumber.** No changes to `GENES` indices 0–227, `SENSE32`,
  `ACT20`, `CHEM7`. New loci append; target vocabularies index by stable
  position.
- **Mass conservation is structural, not probed-into-existence.** No R
  channel may add a chemical; no G target may change a reaction's
  substrate/product *identity* in a way that breaks the min-bound (choice
  targets are excluded from G anyway). The transfer bound
  (biochem.js:421) is never gated — only the rate is.
- **Determinism.** Gating draws zero RNG at tick time — it is a pure
  function of expressed values and live chemical levels. Pool machinery
  draws from the dedicated causal sub-stream (salt `0x47`); it never
  touches the affect sub-stream (salt `0x55`). New-loci founder alleles
  draw from `randomGenome` pass 10; the main sequence stays bit-identical.
- **Epigenetic fade is untouched.** Marks fade toward 1 at ×0.5/generation
  (genome.js:~1001); gating multiplies after marks and does not change
  mark dynamics, ranges (0.5–1.5), or `markLocus` behavior.
- **No behavior without an instinct gene.** No new verbs, no new senses, no
  new instinct loci, no new action indices. Gating an instinct weight
  changes an existing wire's strength at birth — it never invents a verb.
- **No gate-on-gate.** Family G loci are excluded from `GTARGETS`;
  evaluation is single-pass. If a future version wants cascades, that's a
  new design doc.
- **Choice genes are outside the regulatory layer.** Type choices, diet,
  `segCount`/`tailCount`, litter size — categorical, ungateable. Gating
  scales quantities; it never flips categories.

---

## (d) Execution probes — all must pass before any "built" claim

All in `probes/genome-regulatory.mjs`. Every probe reports numbers the sim
produces, never vibes.

**(a) Founder-parity.** Build founder genomes with all 92 new loci at
founder defaults: `phenotype()` must deep-equal the current build's
`phenotype()` on every key (`===` on floats — mult ≡ 1.0 exactly, asserted
per G gene). Then run the 10-seed 20k-tick headless battery: the set of
`genomeHash` values (`src/sim/world.js:998`) across lineages must equal
the current build's set exactly.

**(b) Inheritance.** 20-generation lineage from heterozygous G-locus
founders: per-locus allele frequencies tracked via `genomeHash` +
direct allele sampling. Pass criteria: (i) chr-10 G loci show
recombination fraction < 0.5 between adjacent loci (linked) and ≈ 0.5
vs chr-5 loci (assorting); (ii) `dupRate`/`poolDrain` segregate as
ordinary diploid floats (heterozygote × heterozygote → ≈25/50/25 over
≥200 offspring); (iii) meiosis still emits 1–3 crossovers per
chromosome — sampled and counted.

**(c) Duplication–divergence (the specie probe).** Pinned-pin run:
force duplications on one target gene, apply directional selection on it.
Report: pool occupancy per generation (must rise then drain), mean and max
copy `div`, count of recruitments (must be > 0 with `div ≥ poolRecDiv`
at promotion, asserted per event), fitness proxies — mean `lifespanSec`,
births per 1k ticks, extinction rate — vs a control run with the pool
disabled (duplications go straight to dosage, current semantics) at the
same `dupRate`. Pass: the pool arm shows unrecruited copies draining to
zero with Δfitness within the control's noise band, while recruited
copies are the only expression-visible duplication events.

**(d) Regulatory-knockout.** Paired genomes, identical except one G gene's
`slope` set to 0 in one of them: at the same tick, the target's gated
value in the knockout genome must equal `base × mark` exactly, and every
other target's gated read must be bit-identical across the pair
(target-only effect). With `slope ≠ 0`: assert the gated value equals the
closed form `1 + slope × σ((reg − thr) × 4)` within 1e-12 of direct
evaluation — the curve is the implementation, not an aspiration.

---

## (e) Honest numbers only

Every metric below is produced by the sim, not asserted:

- Allele frequencies per locus per generation (from sampled genomes).
- Expression levels `p[key]` sampled from `phenotype()`; `gateMult` per
  G gene per read site.
- Chemical mass totals Σb per tick (conservation check — the min-bound
  makes it structural, the number makes it visible).
- Pool occupancy, per-generation drain count, recruitment count, mean/max
  copy divergence `div`.
- Recombination fractions between locus pairs (linkage).
- `genomeHash` lineage sets (world.js:998) for parity.
- Fitness proxies: mean `lifespanSec`, births per 1k ticks, extinction
  rate per seed.
- Probe pass/fail with the exact assertion values (1e-12 on the curve,
  `===` on founder phenotypes).

---

## What's excluded and why

- **Gate-on-gate cascades** (G targeting G): single-pass keeps evaluation
  order-independent and the knockout probe exact. Cascades are a v+1 with
  their own fixed-point semantics.
- **Gating choice genes**: a categorical can't be scaled. `segCount`
  stays outside regulation — body-plan *count* regulators are
  deliberately dumber than *growth* regulators.
- **Transcription-factor identity / protein synthesis**: there is no
  protein layer; the chemical level *is* the TF concentration. Adding a
  protein abstraction would duplicate the chemistry without a reader.
- **Pool marks on choice genes**: choice genes can't duplicate today
  (genome.js:1040–1043) — the pool inherits that exclusion.
- **Adaptive drain rates**: `poolDrain` is a locus, not a feedback
  controller. Selection tunes it; the tick doesn't.
- **RNA-style silencing of active copies**: active dosage copies express
  or are deleted — there is no third state. The pool is the silent
  state; one silent state is enough.

---

*Sharpest open question for the builder:* the `g{i}tgt` vocabulary is
built from `GENES` at load time — future appended genes automatically
become legal targets (indices stay stable). Confirm the builder wires
`GTARGETS` as a generated set, not a hardcoded list.
