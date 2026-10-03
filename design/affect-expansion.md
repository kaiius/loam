# Affect expansion — the tanglekin inner life, v2

Design-only. No code, no commit. Target: the next affect build after v0.36.

## 0. Premise

Joshua's directive (2026-10-02): "all the emotions I mentioned and the ones I
didn't mention should be possible" — happiness, sadness, excitement,
depression, joy, interest, boredom, love (family, friend, romantic, sexual),
horniness, friendship, and the rest.

The current system (biochem.js) has seven chemicals, five drives computed from
chemistry (hunger, energy, social, fun, fear — plus comfort as a direct body
state), and a `mood()` label with eight states. What's missing:

- **No libido substrate.** Mating is the social drive expressing itself in
  adults plus a hardcoded backstop. There is no horniness as chemistry.
- **No novelty substrate.** Curiosity/interest has no chemical and no drive;
  the closest is the fun drive (boredom = endorphin deficit).
- **No chronic affective regimes.** `mood()` is a momentary readout.
  Depression, grief, and long-horizon mood have no substrate. (The epigenetic
  starvation mark is the only long-memory affect, and it only remembers
  famine.)
- **No relationship kinds.** `world.bonds` is a single scalar (−1..1).
  Mating nudges the same scalar as grooming (+0.4 vs +0.06·dt). Family,
  friend, romantic, sexual are indistinguishable to the brain.
- **No pair-bonding, no parental care.** Courtship exists; pair bonds and
  parenting do not.

The design principle stays the project's own: **chemicals in, drives out.**
Affect is a chemical network with genetic gain/baseline tuning, read by the
brain as drives and senses. New emotions arrive as new chemicals, new drives,
new chronic regimes — never as labels the brain is handed for free.

## 1. New chemicals

Every chemical is 0..1, clamp01'd, analytic (no per-tick RNG — see §7).
Mass-conservation accounting follows the ledger discipline (design §13.5,
v0.24): hormones are signals, not fuel, but their *synthesis* books a
labeled micro-flow from bloodSugar — reproduction and parenting are
metabolically expensive, and the cost is what keeps the emotions honest.

### 1.1 `sexHormone` — the libido substrate

Horniness as its own chemistry, distinct from the social drive.

- **Rises:** maturation into adult stage (analytic ramp over the juvenile→
  adult transition, ~+0.3); seasonal fertility window (analytic in
  world.time, rides the same seasonBreedMul curve tryMate already uses —
  spring peak); mate-sight priming (+0.1 when `s._mate` is sensed, the body
  noticing before the brain decides); grooming a bonded opposite-sex
  partner (+0.05/tick, the social→sexual bridge).
- **Decays:** slow baseline decay (~0.004/s); sharp refractory drop after
  mating (−0.6, the post-coital refractory period — real, and it spaces
  births without a hardcoded cooldown doing all the work; mateCooldown stays
  as the mechanical floor).
- **Read by:** the `libido` drive (§2). Also gates courtship-display
  intensity (§5).
- **Mass:** synthesis books to the ledger's labeled metabolic boundary —
  `ledgerOut('bloodSugar', ...)` is WRONG (bloodSugar is a chemical state,
  not a ledger pool; booking it there deletes mass into a signal — the
  v0.24 double-entry discipline forbids it). Correct booking:
  `ledgerOut(bloodSugarPool, 'out.metabolism', amount)` where the amount is
  drawn from the creature's tracked fuel mass (the same pool doEat feeds),
  NOT from the 0..1 chemical. bloodSugar (the chemical) is only a *gate*:
  synthesis rate × (1 − hunger) — a starving creature's hormone synthesis
  collapses because the gate closes, not because mass vanishes. Trace but
  nonzero; the 10k-tick ledger probe must show zero drift from this path.

### 1.2 `zest` — the reward-prediction chemical (excitement/joy substrate)

The existing `c.reward` is a learning signal; `zest` is the *felt*
counterpart — positive surprise made chemical.

- **Rises:** when the tick's reward exceeds a slow moving average of recent
  reward (+Δ, clamped). Play that goes well, food found when hungry, a
  bonded other approaching. Also rises on novelty events (§1.6).
- **Decays:** fast (~0.05/s) — excitement is brief by design; a creature
  that stays excited forever is a creature that can't learn.
- **Read by:** `mood()` ('excited' above threshold, §6); modulates play
  bout length and exploration speed (arousal → movement vigor, ≤1.15×).
  The feedback loop is explicitly bounded: zest rises only on reward
  *delta vs a slow moving average* (the governor — as the average catches
  up, the delta dies even if play continues), its effect on bout length
  is sub-linear (√zest, never linear), and the vigor multiplier is hard-
  capped. A creature cannot excite itself into permanent railed zest;
  the chemistry forbids it.
- **Mass:** pure signal, no ledger flow (like adrenaline — the precedent is
  that fast transmitters don't book mass; only synthesis-heavy steroids
  and parental investment do).

### 1.3 `serotonin` — the long-horizon mood chemical (depression substrate)

The slow variable. Everything else in biochem.js moves in seconds;
serotonin moves in *hours* (tens of thousands of ticks).

- **Rises:** sustained contentment — all five classic drives below 0.4 for
  a rolling window (+0.0001/s while content; at 10 ticks/s this is ~0.36/hr
  of genuine peace).
- **Falls:** sustained distress — fear > 0.6, hunger > 0.8, or illness >
  0.5 for the window (−0.0003/s while distressed; bad times write faster
  than good times, which is the empirical asymmetry).
- **Read by:** nothing directly — it is a *modulator*, not a drive source.
  Below 0.35 the creature enters the **depressed regime** (§3): all drive
  gains ×1.3 (everything hurts more), reward sensitivity ×0.5 (anhedonia —
  play and grooming yield half their endorphin/oxytocin), energy recovery
  ×0.5, action-initiation thresholds raised (withdrawal, §5).
- **Mass:** signal, no flow.

This is the state-vs-trait distinction (§3): serotonin level is *state*
(reversible — sustained good times rebuild it); the genetic
`driveGain`/`driveBase` loci are *trait* (temperament — some lineages are
born with the volume up).

### 1.4 `vasopressin` — the pair-bond chemical (romantic love substrate)

Oxytocin is general sociability; vasopressin is *specific* attachment —
the vole literature's pair-bond molecule, and the design steals it openly.

- **Rises:** mating with the same partner (+0.3 per mating with partner P,
  tracked per-pair); grooming the same partner repeatedly (+0.02/tick,
  capped by pair, not global); proximity to the bonded partner while
  content (+0.01/tick — quiet time together counts).
- **Decays:** very slowly (0.0002/s — days, not minutes); mating a
  *different* partner halves the strongest pair bond (exclusivity has a
  price; see open question §8e).
- **Read by:** the `attachment` drive (§2); gates libido *targeting* —
  above 0.6 vasopressin for partner P, the `mate` action prefers P over
  nearer valid mates (the brain's `s._mate` selection gets a
  pair-bonus; the mechanism is a preference weight, not a hard gate —
  founder economics, not forced monogamy).
- **Mass:** signal, no flow.

### 1.5 `prolactin` — the parental chemical (family love substrate)

- **Rises:** contact with own offspring (kinNear ≥ 0.5 via the pedigree
  registry, offspring in baby/child stage) +0.05/tick while near;
  birth event +0.4 (the parent's body marks the occasion).
- **Decays:** 0.002/s always; no global "are any offspring alive" scan —
  without contact the decay does the letting-go by itself (a mathematical
  continuity, not a discontinuity). Offspring death *accelerates* the
  decay (×4 while the grief timer runs) rather than collapsing the value.
- **Read by:** the `care` drive (§2); suppresses the fear→flee override
  near young (a parent stands its ground — the override in creature.js
  that forces flee at fear > 0.55 is softened by prolactin × kinProximity;
  the exact softening is a tuning constant, default 50%).
- **Mass:** parental investment books real mass — food-sharing (§5, `tend`
  action) transfers from the parent's gut to the offspring via the ledger
  (the existing doEat/ledger path, no new mass primitive).

### 1.6 `stimulus` — the novelty chemical (interest/curiosity substrate)

- **Rises:** novelty events — the sense vector's frame-to-frame delta,
  *normalized by dt* (Paul §5.4: different tick sizes must agree — an
  unnormalized delta would make slow machines perceive more novelty),
  exceeds a threshold (analytic, computed from the delayed sense buffer
  nerves.js already keeps; a new object in range, a new call type heard,
  a branch never visited). +0.3 per event, capped.
- **Decays:** 0.01/s — the world goes stale in ~100s without new input.
- **Read by:** the `curiosity` drive (§2) as (1 − stimulus).
- **Mass:** signal, no flow.

### 1.7 What the existing chemicals already cover (no new chemical needed)

- **Boredom** — endorphin deficit, already labeled. Stays.
- **Loneliness** — oxytocin deficit, already labeled. Stays; now shares
  the social economy with vasopressin (general vs specific).
- **Fear** — adrenaline, already. Grief (§3) routes through it.
- **Contentment** — all drives low, already 'content'. **Joy** is
  distinguished from contentment in §6 by endorphin + zest, not by a new
  chemical.
- **Anger** — not in Joshua's list, but the design should say: the
  current system has no anger substrate. Adrenaline + low fear + a
  blocked goal is the closest functional shape; a `testosterone`-adjacent
  aggression chemical is *explicitly deferred* (§8) — aggression already
  exists behaviorally (bite, clash) and the design doesn't need a new
  chemical to explain it.

## 2. New drives (chemicals in, drives out)

Same pattern as biochem.js: `drive = clamp01((1 − chem) × dg(Drive) +
db(Drive))`, with new `drv*Gain`/`drv*Base` loci in genome.js (founder
defaults identity: gain 1.0, baseline 0 — selection tunes the emotional
volume, per the v2 (D) precedent).

| Drive | Chemistry | Meaning (0=satisfied, 1=desperate) |
|---|---|---|
| `libido` | sexHormone | need for sexual release/mating |
| `curiosity` | (1 − stimulus) | need for novelty |
| `attachment` | vasopressin × partner-absent | need for the *specific* bonded partner |
| `care` | prolactin × offspring-need | need to tend young |

Notes:

- `libido` is gated by life stage in the readout: juveniles compute it as
  0 regardless of chemistry (the chemical still tracks — puberty is the
  ramp — but the drive stays silent until adulthood; the brain never sees
  a need it can't act on).
- `attachment` is zero without a pair bond (no vasopressin, no longing —
  you can't miss someone you never bonded with).
- `care` multiplies prolactin by the offspring's need (baby hunger or
  distress within sense range); a content baby near a high-prolactin
  parent yields a low drive — presence, not fussing, satisfies it.
- All four join the brain's drive economy: they appear in the sense
  vector as new appended senses (never renumbering — §9.4 discipline),
  get instinct genes (§5), and compete in action selection by the same
  weights the existing five use. No drive is privileged in the
  architecture; priority emerges from gains, which evolve.

## 3. Chronic states

### 3.1 Depression — a regime, not a label

When `serotonin < 0.35` sustained over the rolling window, the creature
enters the depressed regime:

- All drive gains ×1.3 (multiplicative, on top of genetic gain —
  everything hurts more).
- Reward sensitivity ×0.5: play yields half endorphin, grooming half
  oxytocin (anhedonia, chemically).
- Energy (fatigue clearance) ×0.5 — the tiredness that sleep doesn't fix.
- Action-initiation thresholds raised: the brain's commitment timer runs
  ~2× longer between re-decisions (psychomotor slowing, honestly
  implemented as a timer scalar, not a fudge). **Exempt: the survival
  overrides** (hunger > 0.8 → seekFood, fear > 0.55 → flee) bypass the
  slowing entirely — the body keeps its emergency exits. A depressed
  creature is slow, not trapped; depression must never be a death spiral
  by architecture.
- `mood()` returns 'depressed' (§6).

Exit: serotonin rebuilt above 0.45 by sustained contentment. The regime
is fully reversible — state, not trait. Trait is the genetic baseline:
a lineage with high `drvFearBase` is *anxious by temperament*; a creature
in the depressed regime is *depressed by history*. The design keeps both
because confusing them is the oldest error in the book.

### 3.2 Grief — bond rupture as sustained stress

When a creature dies, every living creature with `bond > 0.5` to the dead
one (or a pair bond of any strength) receives a grief event:

- Immediate: adrenaline +0.8 (the shock), oxytocin −0.4 (the hole),
  serotonin −0.15 (the mark).
- Sustained: a `grieving` timer (default ~1 day of world time, genetic
  `griefTime` locus): fear baseline +0.2, social drive +0.3 (the need for
  company spikes — the bereaved seek the troop), initiation of play
  suppressed.
- The dead are pruned from `world.bonds` by tickBonds already; grief
  reads the *event*, not the map — no resurrection of pruned entries.
- `mood()` returns 'grieving' while the timer runs and no acute drive
  outranks it (§6).
- Chronicle: a `grieved` line (the death ledger already names causes;
  grief names the mourners — the world's memory, not just its body count).

Multiple losses stack the serotonin marks. A creature that loses its
whole troop can slide into the depressed regime through grief alone —
which is the honest causal chain, not a scripted tragedy.

## 4. Relationship kinds

### 4.1 The current state (what's already true)

- `world.bonds`: pairwise scalar −1..1 (mere exposure, play, grooming up;
  decay and pruning down).
- `pedigreeKin(world, a, b)`: exact kinship from the lineage registry
  (1.0 parent/child/sibling, 0.5 cousin, else 0) — already exposed to the
  brain as the `kinNear` sense. The creature "knows kin" the way it knows
  anything: the world tells it, via pedigree, not perception. No species
  labels are involved (§9.4 safe); kinship is per-individual registry
  data, already shipped in v0.12.
- Mating currently nudges the generic bond (+0.4) — the same scalar as
  friendship. This is the gap.

### 4.2 The design: kinds emerge from strength + context

New structure: `world.pairBonds`, a Map keyed like bonds, storing
`{ v: 0..1, t }` per pair — strengthened by mating (+0.3) and repeated
exclusive grooming, weakened by mating others (×0.5), decaying over days.
It is *not* exposed as a sense label. Instead, relationship KIND is a
derived readout, computed where needed (UI, chronicle, teacher
observation — never the brain's sense vector):

```
kind(a, b):
  kin = pedigreeKin(world, a, b)
  bond = getBond(world.bonds, a, b)
  pair = getPairBond(world.pairBonds, a, b)
  if pair > 0.5:      'romantic'   (pair-bonded; sexual history implied)
  elif kin >= 0.5:    'family'     (kinship is registry fact, not feeling)
  elif bond > 0.3:    'friend'
  elif bond < -0.3:   'rival'
  else:               'stranger'
```

Why emergence over explicit tracking: the brain already receives the
three primitives (bondNear, kinNear, and — new — pairNear as an appended
sense). The *kind* is what an observer calls the pattern; the creature
lives the pattern. Explicit kind-tracking would add a label the brain
didn't earn and a state the world must keep consistent. The derived
readout is cheaper, honest, and lets kinds *change* without bookkeeping
(a friend becomes a rival when the bond goes negative — no reclassification
event needed).

The fork is real and is Joshua's call (§8a): explicit kinds would let the
chronicle, rituals, and the teacher speak of "mates" and "kin" as
first-class facts. The design recommends emergence but implements the
readout so thoroughly that promoting it later is a small change.

### 4.2b Joshua's ruling (2026-10-02): tracked emergence

The fork is resolved as a hybrid. Kinds EMERGE (the derived readout above;
the brain never receives a kind label — the sense-vector constraint
holds), but the world TRACKS them:

- `world.kindHistory`: per-dyad last-known kind + timestamp, updated when
  the derived kind changes.
- A kind transition writes a chronicle event ("X and Y became mates",
  "the bond between X and Y soured into rivalry") — the stories get their
  first-class facts without the brain getting labels it didn't earn.
- Rituals, the teacher's observation, and probes read the tracked kinds;
  the brain reads only the three primitives (bondNear, kinNear, pairNear).

Emergence keeps the architecture honest; tracking keeps the stories
tellable. A friend becomes a rival when the bond goes negative — and now
the world *notices*.

### 4.3 Pair-bonding as a distinct state

Covered in §1.4/§2: vasopressin + pairBonds map + libido targeting
preference + `attachment` drive + separation → longing → `seekBond`
behavior (§5) + partner death → grief (§3.2). Monogamy is a preference
weight, not a gate — a lineage can evolve it away (founder economics:
the preference weight default is mild, 1.2×; selection decides what
romance is worth).

### 4.4 Parental care — family love as behavior

Prolactin (§1.5) + `care` drive (§2) + the `tend` action (§5):
stay near offspring, share food (ledger-booked gut→offspring transfer),
fear-override softening near young (defense). Family love is not a label
the parent carries — it is what the parent *does* when prolactin is high
and a baby is near. The kind readout calls it 'family'; the behavior is
the love.

## 5. Behaviors

Every new verb declares its anatomical prerequisites (Joshua's 2026-10-02
rule) and gets an instinct gene where the architecture requires one
(Paul's v0.5 rule: every new action needs an instinct gene).

| Action | Emotion | What it does | Anatomical prerequisite | Instinct gene |
|---|---|---|---|---|
| `display` | horniness | courtship display: rhythmic movement + coloration flashing; intensity scales with sexHormone; raises nearby valid mates' sexHormone (+0.05/tick priming) | adult stage; display surface — `patternDensity > 0.2` or tailLength > 0.3 (something to wave); no waiver needed — most founders qualify | `instDisplay` (sense: libido, action: display) |
| `inspect` | curiosity | slow approach to the novel object; stops at 60px; `stimulus` refreshes on arrival (the look, not the walk, satisfies) | sensory organs — eyes or nose (existing `sightRange > 0` or `smellRange > 0`); a blind, anosmic creature cannot inspect — it wanders | `instInspect` (sense: curiosity, action: inspect) |
| `cuddle` | love (romantic/friend) | close body contact with the pair-bonded partner or highest-bond other; oxytocin +0.5/tick (both), vasopressin +0.02/tick (pair only); stronger and slower than grooming | body contact — `size` within 2× of partner (a bear can't cuddle a grub); same platform | `instCuddle` (sense: attachment, action: cuddle) |
| `tend` | love (family) | stay near offspring; transfer food gut→offspring (ledger-booked); fear-override softened 50% while tending | food-sharing needs `graspPairs ≥ 1` (carry) OR mouth regurgitation (`mouthSize > 0.2` — the anatomy declares which; founders regurgitate, tool-users carry) | `instTend` (sense: care, action: tend) |
| `seekBond` | longing | like `approach` but targeted at the absent pair-bonded partner's last known position (memory, not sensing — uses `homeX`-style imprint of partner); arrival without partner → stimulus refresh fails, attachment stays high (the ache is honest) | locomotion (legs/wings/fins — whatever `approach` needs); memory of partner position (the imprint the bond already keeps via `t`) | `instSeekBond` (sense: attachment, action: seekBond) |
| `mourn` | grief | go to the death site; stay; activity halved; `groundCallType` gains a 'grief' branch (low, long call — the lexicon can learn it like any call type) | none for staying; vocal anatomy (`vocalRange > 0`, existing) for the grief call | `instMourn` (sense: grief-timer active, action: mourn) |
| `withdraw` | depression | not chosen — *imposed*: the depressed regime lengthens the commitment timer and raises initiation thresholds (§3.1). Listed here so the regime's behavioral face is explicit. | — (regime, not verb) | — |

Notes:

- `mate` (courtship) is retargeted, not replaced: the existing action
  keeps its anatomy (adult, opposite sex, reachable) and gains the
  pair-preference weight from vasopressin. `display` is the new
  expressive layer on top.
- `groom` keeps its role (general friendship, oxytocin for all);
  `cuddle` is the pair-bonded/friend-intimate variant. The distinction
  is chemical (vasopressin only moves in cuddle-with-pair), not just
  flavor.
- Joy and excitement get no new verb: joy lengthens and socializes
  `play` (zest scales bout duration); excitement speeds exploration.
  Positive affect modulates existing behavior — it doesn't need new
  verbs, and inventing some would be theater.
- Every new action is appended to ACTIONS (never renumbering), gets its
  `case` in executeAction (the v0.22 lesson: wiring tests are not proof —
  each new verb ships with an execution probe), and its instinct gene
  follows the genome.js pattern (`{ key, kind: 'float', sense, action,
  founder }`).

## 6. Mood expansion

Current priority: afraid > sick > hungry > tired > bored > lonely >
uncomfortable > content. The order encodes a survival hierarchy: things
that kill outrank things that hurt.

New states and their argued placement:

```
if (b.fear > 0.5) return 'afraid';            // death is nearest — stays first
if (b.illness > 0.5) return 'sick';           // body failing — stays second
if (b.health < 0.4) return 'sick';
if (b.hunger > 0.75) return 'hungry';         // starvation kills in hours
if (b.energy < 0.25) return 'tired';          // exhaustion kills judgment
if (b.libido > 0.7) return 'horny';           // NEW — the genes' agenda outranks
                                              // comfort but not survival
if (grieving) return 'grieving';              // NEW — acute rupture; outranks
                                              // chronic states, not acute needs
if (b.serotonin < 0.35) return 'depressed';   // NEW — the regime; colors
                                              // everything below it
if (b.fun > 0.75) return 'bored';
if (b.social > 0.75) return 'lonely';
if (b.attachmentDrive > 0.6) return 'longing';// NEW — specific, not general
if (b.care > 0.6) return 'tender';            // NEW — parental; gentle, so low
                                              // priority is honest (it never
                                              // shouts over fear)
if (b.curiosity > 0.7) return 'curious';      // NEW — the luxury need; low
if (b.zest > 0.6) return 'excited';           // NEW — brief by chemistry
if (b.endorphin > 0.75 && drivesLow) return 'joyful'; // NEW — joy is contentment
                                              // + endorphin + zest, not a
                                              // separate channel
if (b.comfort < 0.4) return 'uncomfortable';
return 'content';
```

Argued placements:

- **'horny' above grieving/depressed but below tired:** reproduction is
  the genes' loudest non-survival demand, but a starving creature that
  courts is a dead creature. Survival first, genes second, heart third.
- **'grieving' above 'depressed':** grief is acute (a timer, ~1 day);
  depression is chronic (a regime). The acute rupture reads louder while
  it lasts; if it doesn't lift, it *becomes* the regime through the
  serotonin marks (§3.2) — the priority order encodes the causal chain.
- **'depressed' above bored/lonely:** the regime modulates all drives
  (×1.3 gains), so it must read above the drives it modulates — otherwise
  the label lies about what's driving behavior.
- **'tender' and 'curious' low:** parental care and curiosity are
  genuine needs but they never outrank fear, hunger, or grief. A curious
  creature in danger is a dead creature; the order says so.
- **'joyful' near the bottom, just above 'content':** joy is the
  *flavor* of satisfied drives, not a competitor to them. It reads only
  when nothing else is loud — which is exactly when joy happens.

## 7. RNG + determinism

The leak criterion (design/rng-boundary.md): *a draw is causal iff its
output is read downstream by anything selection or physics can see.*

- **Zero new per-tick draws.** Every chemical in §1 is analytic:
  deterministic functions of events (mating, grooming, death, novelty
  detection via sense-vector delta), time (seasonal curves in world.time),
  and decay constants. Like oxytocin before them, they need no dice.
- **Novelty detection is analytic**, not sampled: the sense-vector delta
  threshold is a pure function of the delayed buffer nerves.js keeps.
  No draw, no crossing, no annotation needed.
- **New loci need their own mutation sub-stream.** Per the standing rule
  (new-version loci own RNG sub-stream, new salt): `world.affectRng =
  createRng((seed * 7919 + 55) >>> 0)` — used ONLY for mutation draws on
  the new loci (`drvLibidoGain/Base`, `drvCuriosityGain/Base`,
  `drvAttachmentGain/Base`, `drvCareGain/Base`, `griefTime`,
  `pairStrength`, hormone synthesis rates). Genome.js precedent (the
  per-version sub-stream pattern). Salt 55 is unused (17 pebbles, 35
  dispersal — checked).
- **Causal annotation:** every new drive gain is causal (it steers
  behavior → selection sees it) — the gains live on the causal stream via
  affectRng, never decorRng. The vasopressin-gated mate preference is
  causal (mate choice is explicitly listed as causally load-bearing).
  The `display` priming (+0.05/tick to nearby mates' sexHormone) is
  causal — no stateless hash, no cosmetic exemption.
- **Probe:** extend `probes/rng-boundary.mjs` with an affect arm — drain
  decorRng 10k and require bit-identity (the chemistry must not touch
  decorRng at all), plus a mutation-seeding check that affectRng draws
  don't shift the main sequence.

## 8. Open questions (genuine forks)

a. **Relationship kinds: explicit or emergent?** (§4.2) The design
   recommends emergence (kinds derived from bond + kin + pair-bond
   strength), with the readout thorough enough to promote later. The
   fork: explicit kinds would make "mate", "kin", "friend" first-class
   facts for the chronicle, rituals, and teaching — at the cost of a
   label the brain didn't earn. **This is the one for Joshua's ruling.**

b. **Serotonin: modulate gains or baselines?** The design modulates
   gains (×1.3 — the world hits harder). The alternative is baselines
   (+0.2 — the world starts worse). Gains preserve the shape of
   individual differences; baselines flatten them. Not obvious which is
   truer.

c. **Sex-differentiated hormone curves?** Real biology runs different
   sexHormone dynamics per sex. The design keeps one curve (simpler,
   founder-neutral). The fork costs complexity for dimorphism selection
   could actually use.

d. **Pair-bond exclusivity: does infidelity decay the bond?** The design
   says yes (×0.5 — the vole literature). The alternative is no decay
   (bonds are additive history). This is a values choice disguised as a
   tuning constant.

e. **Aggression chemical: deferred, but for how long?** §1.7 defers a
   testosterone-adjacent chemical. If the tribe-divergence build (v0.38)
   needs dominance hierarchies, the deferral expires.

f. **Novelty: sense-delta (cheap, analytic) vs a dedicated novelty sense
   in the vector?** The design uses the delay buffer's delta (no N_IN
   cost). A dedicated sense would cost a vector slot and an instinct
   wiring but give the brain cleaner input. Cheap now, slot later if the
   brain proves it needs it.

g. **New verbs vs modulation:** `display`, `inspect`, `cuddle`, `tend`,
   `seekBond`, `mourn` are new verbs (each: instinct gene, anatomical
   prereq, execution probe). The alternative is fewer verbs with
   parameters (play-with-zest, groom-with-vasopressin). More verbs =
   legible behavior and chronicle; fewer = less surface for bugs. The
   design picks legibility, following the project's own lesson that
   execution probes beat wiring tests.

h. **Should grief be contagious?** The design has the bereaved seek
   company (social drive +0.3) and a 'grief' call type the lexicon can
   learn. It does NOT have grief transmission (hearing the grief call
   doesn't grieve the hearer). Real troops co-regulate; the fork is
   whether to add it.

## 9. Explicitly out of scope (the honest boundary)

- **No phenomenal-consciousness claim.** This design builds functional
  affect: chemistry with the right dynamics, drives with the right
  competition, behaviors with the right shape, all evolvable. Whether any
  of it *feels like something* from the inside is not claimed, not
  denied, and not testable from here — the same boundary the current
  docs hold.
- **No grief as felt loss.** Grief here is a stress response with the
  dynamics of rupture: shock, seeking, slow return. The design does not
  claim the creature *misses* anyone.
- **No love as a brain label.** 'Romantic', 'family', 'friend' are
  observer readouts (§4.2), never sense-vector contents. The §9.4 grep
  gate (no species labels in sense vectors) extends by analogy: no
  relationship labels either.
- **No new claim about the existing drives.** Hunger, fear, and the rest
  keep their chemistry, their loci, and their priority. The expansion
  adds rooms; it doesn't renovate the foundation.
- **No moral patienthood claim.** Richer affect does not, by itself,
  promote the creatures anywhere. The ethics gate (benevolent
  non-interference, Joshua's 2026-10-01 ruling) is unchanged by this
  design.

## 10. Build notes (for the future builder, not this design)

- New loci list (genome.js): `drvLibidoGain/Base`, `drvCuriosityGain/Base`,
  `drvAttachmentGain/Base`, `drvCareGain/Base`, `griefTime`,
  `pairBondRate`, `sexHormoneRate`, `serotoninRate` — all float, founder
  0.5, identity mapping like the v2 (D) drives.
- New chemicals in createBiochem/tickBiochem: sexHormone, zest,
  serotonin, vasopressin, prolactin, stimulus — with ctx additions
  (`mated`, `mateNear`, `offspringNear`, `noveltyEvent`, `bereaved`).
- New senses appended (never renumbered — the v0.32 pain precedent:
  senses are inserted *before* the bias term, which moves to the new
  N_IN−1; pain took N_IN 38→39 at index 37, these take 39→44 at indices
  38–42, bias to 43; no existing sense index changes): libido,
  curiosity, attachment, care, pairNear.
- New actions appended: display, inspect, cuddle, tend, seekBond, mourn.
- New maps: `world.pairBonds` (with tickPairBonds decay/pruning, mirroring
  tickBonds).
- Execution probes required: libido-separation (libido high + social low
  → courts without company-seeking), novelty (inspect fires on new object,
  not on familiar), grief (bonded death → mourn + serotonin mark),
  pair-bond (exclusive mating → libido targeting preference), depression
  (sustained distress → regime → anhedonia measurable in halved
  endorphin yields).
- Gemini spec review before tagging, per standing practice.

## 11. Review record (Gemini spec review, 2026-10-02, two passes)

Real P0s found and fixed in this document:
- **Mass-ledger leak** (§1.1): synthesis booked from the bloodSugar
  chemical — fixed to book from the tracked fuel mass pool to the
  labeled metabolic boundary; bloodSugar is a gate, not a source.
- **Tick-rate-dependent novelty** (§1.6): sense delta now normalized by
  dt (Paul §5.4).
- **Zest runaway** (§1.2): bounded explicitly — moving-average governor,
  sub-linear (√) bout effect, hard 1.15× vigor cap.
- **Depression death spiral** (§3.1): survival overrides bypass the
  psychomotor slowing.
- **Prolactin discontinuity** (§1.5): continuous decay, no global scan;
  death accelerates decay instead of collapsing the value.

Dismissed misreads (with evidence, so no future builder "fixes" them):
- **Bias renumbering** (claimed twice): the codebase's own convention
  (brain.js:69 — "never renumber. New senses append before the bias";
  the v0.32 pain precedent, N_IN 38→39) is exactly what §10 follows. No
  gene addresses the bias by index (no `sense: 37/38` in genome.js); the
  bias is the programmatic last column. Brains are created fresh per
  world — no cross-version weight persistence exists to corrupt.
- **Survival jitter** (claimed): hunger moves at ~0.004/s — threshold
  crossings take minutes per direction; tick-frequency stutter is
  physically impossible. The snap-override pattern is the existing
  architecture (hunger>0.8, fear>0.55), not a new discontinuity.
- **Parental mass anomaly** (claimed): the design never books prolactin
  synthesis mass — prolactin is a pure signal like oxytocin (zero ledger
  flow in shipped code). Only the tend food transfer books mass, via the
  existing doEat/ledger path.

Kept open questions: §8b (gains vs baselines), §8h (contagious grief).
(§8a resolved 2026-10-02 by Joshua's ruling: tracked emergence, §4.2b.)
