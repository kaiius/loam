# Canopy v0.17 "Bauplan" — evo-devo body plan: design

*Status: design only (2026-09-30). No src/ changes. Builds on v0.15 "Bloom"
(commit 87a3fda); v0.16 "Tongues" (commit 8d5b349) is committed on a
separate branch — this design does not assume its code, and the build
rebases onto it.*

*Open-endedness correction (2026-09-30, Joshua): wings were one example
trajectory, never the destination. Gills, fins, serpentine plans,
quadrupedalism, bigger brains, plain stasis, and outcomes no one has
named are all first-class citizens here — see §6. Nothing about the
destination is predetermined, and the design must not read as "the wing
update."*

*("Bauplan" — German for body plan. The genome stops tuning the instrument
and starts redesigning it.)*

## 1. The idea in one paragraph

Today morphology is quantitative knobs on a fixed monkey-like plan: the
genome can lengthen an arm but cannot grow a new organ, add a limb pair,
or lose one. v0.17 replaces the fixed plan with a **developmental
program**: the genome encodes limb *buds* (paired shoulder, hip, dorsal,
mid-torso, and neck sites, plus tail count), each bud carrying
grow/type/length/power loci, with the type registry appendable like the
senses (§2.1). Buds unfold over the juvenile stages (baby → child →
adult) into a variable body plan — 4 grasp limbs and 1 tail at founder
(exactly today's animal), with wings, gills, fins, extra grasp-limb
pairs, display sails, serpentine limblessness, and plain stasis all
reachable or retainable by mutation and selection. New verbs arrive via
the **dormant-action pattern**: `glide`, `brachiate`, `swim`, and `dive`
are pre-wired in code with instinct genes at founder 0, gated by
actually growing the organ — the genome unlocks verbs by growing organs,
and the builder never invents behavior per lineage. **No trajectory is
privileged**: wings were one example among many, never the destination.

## 2. Developmental encoding — family V (chr 9)

### 2.1 The bud model

A bud is a *paired* (bilaterally symmetric — L/R together, halving the loci
and matching real development) limb site. Five sites:

| site | founder grow | founder type | founder len source | founder pow |
|------|--------------|--------------|--------------------|-------------|
| shoulder | 1 (full) | grasp | `armLength` (existing gene) | 0.5 |
| hip | 1 (full) | grasp | `legLength` (existing gene) | 0.5 |
| dorsal | 0 (vestigial) | membrane | 0.5 | 0.5 |
| mid-torso | 0 (vestigial) | grasp | 0.5 | 0.5 |
| neck | 0 (vestigial) | gill | 0.5 | 0.5 |

The key decision: **the ancestral buds' length loci ARE the existing genes**
(`armLength`, `legLength`, `tailLength`). The bud program does not duplicate
them — it *adopts* them. This gives founder-exactness by construction, not
by coincidence, and no dead genes: every old morphology gene keeps its
expression path.

New loci (family V, new chromosome 9 — `meiosis` already loops over
`CHROMOSOMES`, so a 9th chromosome is additive):

```
// per-site program (shoulder, hip, dorsal); mid-torso and neck have no ancestral len gene
_bud{Site}Grow  float  founder 1 (shoulder/hip), 0 (dorsal/mid/neck)
_bud{Site}Type  choice ['grasp','membrane','sail','gill','fin']  founder grasp (shoulder/hip/mid), membrane (dorsal), gill (neck)
_bud{Site}Pow   float  founder 0.5
_budMidLen      float  founder 0.5
_budNeckLen     float  founder 0.5
// body-plan regulators
_segCount       choice [0,1,2]  founder 0 (→ 1 segment; each extra segment activates the mid-torso bud pair; at max with limb buds →0: serpentine plan)
_tailCount      choice [0,1]    founder 0 (→ 1 tail)
```

Locus count: 3 sites × 3 + 4 (mid: grow/type/len/pow) + 4 (neck: grow/type/len/pow) + 2 = **19 new loci**.
`tailCurl`/`tailGrip` (existing) modify all tails; `tailCount: 2` draws the
second tail offset from the first.

Type semantics:
- **grasp**: a gripping limb. Contributes to climb speed, reach, and —
  when functional grasp pairs ≥ 3 — unlocks `brachiate`.
- **membrane**: a flight surface. Contributes `wingArea`; unlocks `glide`
  above threshold. (Dorsal founder type is membrane while vestigial —
  latent surface, one unrealized possibility among several, not a
  promise of wings.)
- **sail**: a display frill. No locomotor verb; contributes `sailArea`,
  read by sexual selection (Fisherian runaway — the peacock's tail) and by
  fall physics (a big sail drags — one instance of the exaptation pattern
  in §6).
- **gill**: filament tufts for aquatic respiration. Contributes `gillArea`;
  extends `breathTime`, gates `dive`. The type is legal at any site; the
  neck site is its natural home.
- **fin**: a paddle limb. Contributes `finArea`; unlocks real `swim`
  above threshold (mirroring `glide`'s 0.6).

**The type list is appendable, like the senses registry.** Types are
strings, never ordinals — a future version appends `'spinneret'`,
`'electric'`, or whatever selection invents, and old genomes keep parsing.
Nothing in the tick switches on a closed type set; each type contributes
named phenotype channels (areas, pairs) that verbs read.

`sensor` is deliberately **not** a v1 type (see §9.2).

### 2.2 Development: buds unfold over life stages

`expressBuds(pheno)` (new, `src/sim/evodevo.js`) runs at birth and on stage
change, producing a cached `c.bodyPlan`:

```
bodyPlan = {
  limbs: [ { site, side: 'L'|'R', type, grow01, lenPx, pow01 } ... ],  // only buds with grow01 ≥ 0.15 erupt
  tails: 1 | 2,
  wingArea:   Σ grow×len over membrane buds,      // 0 at founder
  sailArea:   Σ grow×len over sail buds,          // 0 at founder
  gillArea:   Σ grow×len over gill buds,          // 0 at founder
  finArea:    Σ grow×len over fin buds,           // 0 at founder
  graspPairs: functional grasp buds / 2,          // 2 at founder
  bodySegs:   1 + segCount,                       // 1 at founder
  growth01,                                       // developmental clock 0→1
}
```

The growth curve (founder behavior = today's instant adult size, since
`stageSize` already scales the whole animal — buds scale *within* it):

- baby: buds erupt (`growth01` 0.25 — nubs visible in render)
- child: elongate (0.6)
- adult: full expression (1.0); senior 0.95

**Developmental plasticity (honest biology):** growth rate is scaled by
juvenile nutrition — `growth01` advances × (0.5 + 0.5 × mean juvenile
bloodSugar). Starved juveniles grow stunted; the stunting persists
(developmental canalization is a v+1 question — §9.5). This is the first
gene×environment interaction in the body plan.

**Loss is evolvable, not just gain:** `budShoulderGrow` → 0 vestigializes
an arm (cave-fish eyes, flightless birds). Vestigial buds below 0.15 draw
nothing and cost nothing — and *save* the developmental cost (§2.3), so
scarcity selects for loss. This falls out free from the encoding.

### 2.3 Developmental cost — through the chemistry invariant

Growing and keeping novel structures costs fuel, billed through existing
channels only (no new chemicals, no new drives):

- `p.developDrain` = (wingArea + sailArea + gillArea + finArea + max(0, graspPairs − 2) × 0.5) × 0.004
  — added to juvenile `hungerRate`. Big-bud babies are hungrier babies.
- `p.wingUpkeep` = wingArea × 0.002; `p.gillUpkeep` = gillArea × 0.0015;
  `p.finUpkeep` = finArea × 0.001 — passive adult bloodSugar drain.
  Novel structures are expensive to maintain; the tradeoff is honest.

### 2.4 Phenotype derivations (all in `phenotype()`, additive)

```
p.wingArea, p.sailArea, p.gillArea, p.finArea, p.graspPairs, p.bodySegs  // from §2.2
p.climbSpeed += 20 × max(0, p.graspPairs − 2)    // extra grip limbs climb faster (stacks with tailGrip)
p.groomReach += (reachPx − reachBaseline)       // reach = longest grasp limb px; founder → +0
p.glideLift  = min(0.85, p.wingArea × 1.2)      // founder → 0
p.brachMult  = 1 + 0.35 × max(0, p.graspPairs − 2)
p.fallSoak   = min(0.6, p.sailArea × 0.3 + p.wingArea × 0.5)  // read by the hard-landing path
p.swimSpeed  = p.walkSpeed × (0.3 + min(1.0, p.finArea × 1.2))  // dog-paddle → finned; founder → 0.3× (no water yet)
p.breathTime = 30 + p.gillArea × 150            // ticks before drowning risk; founder → 30
p.slitherSpeed = p.walkSpeed × (0.35 + 0.2 × p.bodySegs)  // read by moveAlong when graspPairs == 0
```

Founder values reproduce v0.15 exactly: wingArea/sailArea/gillArea/finArea 0,
graspPairs 2, bodySegs 1, all bonuses +0. **This is asserted by test, not
by hope** (§8).

## 3. The dormant-action pattern (Paul's v0.5 rule)

Paul's rule: *every new action needs an instinct gene.* The evo-devo
corollary: **the instinct gene ships at founder 0, and the action's
physics degrades gracefully without the organ.** The builder writes the
verb once; lineages unlock it by growing the organ; selection tunes the
instinct up afterward. No per-lineage behavior is ever invented.
**No trajectory is privileged** — `swim`/`dive` are as first-class as
`glide`; wings, gills, fins, snakes, quadrupedalism, bigger brains,
stasis, and unnamed outcomes are all live possibilities. These verbs
are doors, not directions.

### 3.1 `glide` (ACT13)

- **Senses:** 24 `airborne` (1 when `!c.grounded`), 25 `farLedge`
  (1 when a platform is within glide range but beyond jump range —
  computed by extending the existing `jumpNear` scan with a wider radius).
- **Instincts:** `instAirborneGlide` (sense 24 → action 13, founder 0) —
  the rescue reflex: *falling → spread wings*; `instFarLedgeGlide`
  (sense 25 → action 13, founder 0) — the travel verb.
- **Physics:** launch like `jump`; while airborne with
  `wingArea > 0.6`: `vy += g × (1 − glideLift) × dt` (glideLift ≤ 0.85 —
  always descends, never powered flight; *flight* is a v+1), `vx`
  preserved with slight facing steer; on platform/ground contact:
  grounded, small reward, else the existing hard-landing path
  (reduced by `fallSoak`). **Without wings: behaves exactly as `jump`**
  — the action always does something; the organ makes it *better*.
- **Why the threshold 0.6:** a half-grown membrane is a liability
  (cost without lift) — the honest valley selection must cross, and
  the sail's fall-drag (§2.1) is the bridge across it.

### 3.2 `brachiate` (ACT14)

- **Sense:** 6 `foodDist` (existing).
- **Instinct:** `instFoodBrach` (sense 6 → action 14, founder 0).
- **Physics:** requires `graspPairs ≥ 3`: move along x at
  `walkSpeed × brachMult` with a swing render (body hangs below the
  branch). **Without the extra pair: degrades to a normal
  `moveAlong` at walk speed** — still locomotion, never a no-op.
- **Why it matters before predators exist:** brachiation is *faster*
  than walking the same branch — the reader is foraging competition
  (first to the fruit), which already exists.

### 3.3 `swim` (ACT15)

- **Senses:** 26 `submerged` (1 when below the waterline), 27
  `waterNear` (1 when water within ~200px).
- **Instinct:** `instSubmergedSwim` (sense 26 → action 15, founder 0).
- **Physics:** in water, move at `p.swimSpeed` — a slow dog-paddle at
  0.3× walk speed without fins, full speed once `finArea > 0.6`
  (mirroring `glide`'s threshold). **Without fins: still swims, just
  badly** — the organ makes it better, never possible-vs-impossible.
  On land degrades to `moveAlong` at 0.5× walk (an honest flop).
  **Drowning is the honest cost:** a `breathTimer` ticks down while
  submerged; at 0 without gills, `drownDrain` bills bloodSugar through
  the existing chemistry channels; `gillArea` extends `breathTime`,
  and past threshold the timer does not run.
- **Dormant until Realms:** water arrives with v0.18 — in v0.17 these
  senses read 0 and the verb sleeps. Useless-now-useful-later is the
  design (§9.3).

### 3.4 `dive` (ACT16)

- **Sense:** 26 `submerged` (existing).
- **Instinct:** `instSubmergedDive` (sense 26 → action 16, founder 0).
- **Physics:** while submerged, descend and hold depth; requires
  `gillArea > 0.4` to stay down — **without gills degrades to a brief
  duck under the surface, forced up after `breathTime`**. The verb
  exists before the organ; the organ makes it a lifestyle.

### 3.5 What the pattern guarantees

- No dead genes: every instinct is wired from birth (the `createBrain`
  instinct loop is already generic over `GENES` — new instinct genes
  with `sense`/`action` fields wire automatically). They are *useless*
  until organs evolve — exactly like family C receptor gains at
  founder 0. Useless-now-useful-later is the design, not a violation.
- No behavior change at founder: all five instincts at 0, all
  physics bonuses +0 → the v0.15 viability battery must pass
  unchanged (10/10 seeds). This is the migration's load-bearing test.

## 4. Invariants respected

**Senses appended, never renumbered.** `airborne` → 24, `farLedge` → 25,
`submerged` → 26, `waterNear` → 27, bias moves 24 → 28, `N_IN` 25 → 29.
In `genome.js`: new export `SENSE28` (the 28 names); `SENSE24` retained
as an alias for the first 24 (saved genomes, old receptor choice arrays).
Indices 0–23 are untouched — no instinct gene's `sense` field changes
meaning.

**Chemistry invariant.** Drives remain readouts of the five chemicals;
family D still only tunes gain/baseline. Developmental and upkeep costs
(§2.3) enter as `hungerRate`/`bloodSugar` terms — fuel, not feelings.
Evo-devo never rewires what hunger *is*.

**Append-only genome.** 19 loci appended after the v0.14 disgust gene;
chromosome 9 appended to `CHROMOSOMES`. Original 43 + v2 + v0.14 indices
all stable.

**No cap on body-plan evolution.** Like `brainSize` (kind `exp`,
uncapped): `budGrow`/`budLen`/`budPow` are unbounded-above floats in
effect (clamped 0..1 for expression, but mutation may push the
underlying value — canalized expression, evolvable liability).

**Stasis is a result, not a failure.** Founder-exactness (§7 QA) means a
lineage that holds the founder plan for a million ticks is stabilizing
selection working — reported as a result, never penalized. No part of
this design is disappointed by "stay the same."

## 5. Render + physics for variable body plans

**Renderer** (`painter.js`): replace the fixed arm/leg/tail blocks with a
limb loop over `c.bodyPlan.limbs`:

- grasp → tapered limb curve (the current arm/leg stroke code,
  parameterized by attach point: shoulder/hip/mid-torso);
- membrane → two quadratic wing membranes from the dorsal site, flap
  phase from action (`glide` → spread flat; else folded against the back);
- sail → frill arc behind the head/dorsal line;
- gill → filament tuft strokes at the neck site (read `pigLimbs*`);
- fin → paddle curve: broadened limb stroke at any limb site;
- serpentine: when `graspPairs == 0`, the torso draws elongated by
  `bodySegs` (founder `bodySegs` 1 → pixel-identical);
- tails → the existing tail stroke × `tailCount` (second tail offset
  laterally, slightly smaller);
- buds with 0.15 ≤ grow < 0.4 → nub (short stub) — juveniles and
  vestigializing lineages read honestly.

All limbs read the existing pigment genes (membranes/sails take
`pigLimbs*`; patterns apply). **Founder-equivalence:** when the body
plan is founder-identical (2 grasp pairs, 1 tail, no membranes/sails),
the loop must call the *existing* draw routines — pixel-identical output,
asserted by the `render-svg.mjs` founder snapshot test.

**Physics reads** (all via `pheno`, §2.4 — no per-lineage branches in
the tick): climb speed, groom reach, glide lift, brachiate multiplier,
fall soak. The tick never asks "what species is this"; it asks the
phenotype.

## 6. Selection pressures — novelty needs readers

| organ class | verb / trait | concrete reader |
|---|---|---|
| wings (dorsal membrane, grow↑) | `glide` | upper-tier fruit (y≈280–290, unreachable by jump across tier gaps ~180px) + fall safety: `hardLanding` already carries negative valence via family S — fear of falling selects for wings |
| extra grasp limbs (mid-torso, segCount↑) | `brachiate` | foraging competition: faster along-branch travel → first to fruit |
| sails + incipient wings | display | **sexual selection**: new gene `matePrefNovel` (founder 0) — choosiness on (wingArea + sailArea + gillArea + finArea), scored in `_mate` exactly like `matePrefCall`. Fisherian runaway |
| any novel structure | divergence | `computeDivergence` gains traits `wingArea`, `graspPairs`, `sailArea`, `gillArea`, `finArea`, `bodySegs`; the beautiful-mutant watch already flags diverged bud programs |
| loss (grow→0) | economy | `developDrain`: arid-zone scarcity selects for vestigialization — loss has a reader too |
| gills + fins (neck gill buds, fin limbs) | `swim` / `dive` | water (v0.18 "Realms"): underwater food, refuge from surface threats — the reader arrives with deep water; until then the organs are dormant, not dead (§9.3) |
| limb loss + segCount↑ (all buds →0) | serpentine locomotion | burrow/crevice economy (future biomes) + developmental economy now: fewer limbs = cheaper — the snake is a first-class outcome, not a degenerate case |
| stasis (founder plan retained) | — | stabilizing selection: founder-exactness means staying the same is a result, never a failure |

The exaptation *pattern* — a structure arising under one pressure gets
co-opted for another — with three throwaway illustrations. These are
non-exhaustive: the trajectory space is unbounded by construction
(appendable types, phenotype-driven physics, per-biome readers), and no
list of sanctioned outcomes exists anywhere in this design.

- *E.g.* **wings:** sails evolve for display (sexual selection) → their
  drag softens falls (`fallSoak`) → the valley toward functional wings
  narrows → `glide` pays.
- *E.g.* **gills/fins:** shoreline wading pays (food at the waterline) →
  filament tufts extend `breathTime` → fins make staying pay → the
  return to water.
- *E.g.* **snakes:** scarcity punishes limb cost (`developDrain`) → buds
  vestigialize → `segCount` climbs → serpentine locomotion pays in
   burrows and crevices.

Each is literal and testable; none is privileged. If this design ever
reads as "the wing update," it has failed §1.

## 7. Migration plan — additive modules, in the version style

1. `src/sim/evodevo.js` (new): `expressBuds(pheno) → bodyPlan`,
   `growthCurve(stage, nutrition)`, wing/sail/grasp aggregations.
   New file, no existing behavior touched.
2. `src/sim/genome.js`: append 19 family-V loci + chromosome 9;
   `phenotype()` derives §2.4 values; old limb genes untouched
   (their expression paths are now *read through* the bud program —
   budShoulderLen *is* `armLength`).
3. `src/sim/brain.js`: `ACTIONS` + `glide`, `brachiate`, `swim`, `dive`;
   `senseVector` + `airborne`, `farLedge`, `submerged`, `waterNear`;
   `N_IN` → 29. The instinct-wiring loop needs no change (generic over
   `GENES`).
4. `src/sim/creature.js`: `gatherSenses` computes
   `airborne`/`farLedge`/`submerged`/`waterNear`; `executeAction` gains
   `case 'glide'` / `case 'brachiate'` / `case 'swim'` / `case 'dive'`
   with organ gating + graceful degradation (§3); `moveAlong` reads
   `slitherSpeed` when `graspPairs == 0`.
5. `src/render/painter.js`: the limb loop (§5); founder path calls
   existing routines.
6. `test/sim.mjs`: new tests (§8). `REPRODUCE.md`: evo-devo proof
   commands. `ROOTS.md`-style design doc → this file is it.

### QA gates (same bar as every version)

- Full suite green: 197 + new tests (target ~220).
- **Founder-exactness**: (a) founder `bodyPlan` ≡ legacy phenotype reads
  (`climbSpeed`, `groomReach`, arm/leg/tail lengths); (b) founder
  render snapshot pixel-identical via `render-svg.mjs`.
- **Viability battery**: 10/10 seeds at 20k ticks — founder behavior
  must be v0.15-identical (all five instincts 0, all bonuses +0).
- **New-physics tests**: winged crosses glide farther than jump range;
  finned crosses out-swim dog-paddlers; gilled crosses stay down past
  `breathTime`; limbless high-`segCount` crosses slither; every verb
  degrades gracefully without its organ (§3).
- **Stasis is a result**: a seed that holds the founder plan reports
  stabilizing selection — never a failure (§4).

## 8. Test plan

- Founder `bodyPlan` ≡ legacy phenotype reads (`climbSpeed`,
  `groomReach`, limb lengths); render snapshot pixel-identical
  (`render-svg.mjs`).
- Bud growth curves: eruption at grow ≥ 0.15, nub band 0.15–0.4, full
  at adult; starved juveniles stunt via nutrition scaling, and the
  stunting persists.
- Vestigialization economy: grow→0 lowers `developDrain`; vestigial
  buds draw nothing and cost nothing.
- Degradation tests (Paul's rule, §3): `glide` ≡ `jump` without wings;
  `brachiate` ≡ `moveAlong` without the third grasp pair; `swim`
  dog-paddles at 0.3× without fins with the drowning timer running
  without gills; `dive` surfaces after `breathTime` without gills.
- Constructed-trajectory physics: hand-set bud programs for e.g. winged /
  finned / gilled / serpentine morphs — assert each verb's payoff and
  each cost channel (`developDrain`, upkeeps). The listed morphs are test
  fixtures, not a menu of expected outcomes.
- Open-endedness smoke: multi-seed runs report body-plan divergence.
  No assertion that any particular trajectory wins — asserting a winner
  would contradict §1.

## 9. Deferred and future

### 9.1 Powered flight

`glideLift` caps at 0.85 — descent only, never powered flight. True flap
thrust is a v+1 with its own instinct genes and its own valley to cross.

### 9.2 `sensor` bud type

Deliberately not a v1 type: antennae, lateral lines, electroreceptors.
The type registry is appendable (§2.1) — `sensor` slots in later without
touching existing loci.

### 9.3 Water biomes — v0.18 "Realms"

Gills and fins are forward-looking: their readers (deep water,
underwater food, surface threats) arrive with the biome release. In
v0.17 `submerged`/`waterNear` read 0 and `swim`/`dive` sleep — dormant,
not dead, exactly the pattern §3 describes.

### 9.4 Developmental canalization

v1: stunting from starved juveniles persists into adulthood. Whether
later nutrition can partially recover it is a v+1 question.

### 9.5 Future: technology

Tool use → advanced technology is the stated mountain of the Canopy
vision ("tools from properties × verbs down to the molecular level").
It is **not** built in v0.17. What v0.17 leaves in place: grasp-type
buds (manipulators in the encoding), a general reach affordance
(`groomReach` → manipulation reach), the uncapped brain, and the
dormant-action pattern itself — a future `useTool` verb would ship
exactly the way §3 ships verbs: instinct gene at founder 0, gated by
grasp + object. No new genes for this in v0.17. The door is open; the
room is not built.
...[truncated 3716 chars]
### 9.6 Decided direction: manipulation primitives, not verbs (2026-09-30, Joshua)

Supersedes the `useTool`-verb sketch in §9.5. Technology will NOT arrive
as a pre-wired verb. The design: **generic manipulation primitives**
(grasp, carry, drop) + **compositional physics** (wood near wood, held
together, floats; stacked stone breaks wind; properties × arrangement,
down to the molecular level per the vision). "Raft-building" is never an
action in the code — it is what the field notebook calls it when a
lineage's grasp-and-drop instincts produce something that floats.
Termite logic: no termite has a build-mound verb, just pick-up/put-down
rules plus mud physics. Verbs are observed, not issued.

Enabling steps (post-biomes): the verb registry becomes data —
appendable strings like senses and bud types, nothing downstream
assuming a fixed list. The genome side (instinct loci keyed by name,
not fixed slots) is GENOME-v3 territory. v0.17's contribution stands:
grasp buds and the reach affordance are the manipulators-in-waiting.

### 9.7 Weak founding legs (2026-09-30, Joshua — SHIPPED at 0.4)

Founder `legPower` 0.5 → **0.4**. Weaker starting legs on purpose:
early jumps become short hops, so founders must climb the link network,
forage the floor, and eventually invent — rather than jumping everywhere
from day one. Selection can re-strengthen legs over generations; the gene
is untouched, only its founder value moved.

Deliberately UNCHANGED: `JUMP_V_BASE`/`JUMP_V_GAIN` (the physics),
`jumpNear` sense range (the sense-overreach — seeing ledges you cannot
yet reach — is intentional pressure), and the brain's airtime reward.

**What shipped and why (the honest verdict):** Joshua's directive was
0.5 → 0.3 ("make it a bit harder"). The 12-seed viability battery at 0.3
gave **8/12 viable** — but the failures were not the predicted starvation.
Weak-legged founders foraged the floor instead of jumping for tree fruit,
and the v0.14 contamination mechanic bit harder: three previously-viable
seeds (4, 7, 99) flipped to extinct through *illness from fouled ground*,
not hunger. The middle path 0.4 was tried: **9/12 viable** — it recovered
all three 0.3 flips plus the hard seed 8, but flipped three *different*
seeds (6, 9, 10) through a different mechanism (early founder fragility,
mixed starvation/illness). The 0.3→0.4 move **relocated failures rather
than converging**, and a confound applies: sub-stream alleles are seeded
by a content hash of the main alleles, so any founder-value change
reshuffles them deterministically — the comparisons were never
legPower-pure. Joshua's decision: **ship 0.4** (least-bad sampled point,
original intent preserved) and run the proper leg-pressure experiment in
v0.18 Realms, where selection pressure is the subject: isolate leg
weakness from the contamination mechanic, fix the sub-stream seeding
confound, and find a leg value where climb-over-jump pressure reads
independently of illness deaths. The battery is the arbiter; this round
it arbitrated honestly, not cleanly.
