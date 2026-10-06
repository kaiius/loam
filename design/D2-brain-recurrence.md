# D2 — Brain recurrence + working memory

Design track D2 (BUILD_QUEUE.md, "Go all out" deepening tracks, 2026-10-06).
The founder brain (`src/material/brain.js`, M2 Loam port of `sim/brain.js`
v0.37 lineage) is feedforward + Hebbian: senses → 1–3 hidden layers →
action-drives, with eligibility traces that ship founder-off. This track adds
the two missing computational pieces the standing brief names — recurrent
loops and a short-term memory the brain itself owns — without changing the
computational class the brain already belongs to.

Invariants (bind every line below):

- Senses/actions append-only, never renumbered. N_IN stays 48 (brain.js:82);
  ACTIONS keeps its 33 entries in order (brain.js:36–81).
- The instinct/learned split survives untouched: `instW` (brain.js:198–210)
  stays the genetic sense→action pathway; recurrence and the buffer are
  plastic machinery in the learned middle. Nature wires the reflex; nurture
  wires the memory.
- New machinery is knobs on the existing class, per the bauplan argument in
  `design/cognitive-ascent.md`: the brain is and stays a sparse associative
  net. Recurrence is a density knob on a connection class the code already
  builds (`randSparse` adjacency lists); the buffer is a gated side-path into
  layer 0. Selection turns knobs, never invents classes.
- Determinism: every new random draw comes from the brain's seeded RNG
  (brain.js:266) — the same sub-stream that seeds `randSparse` today — and
  only when the corresponding density knob is > 0, so the draw sequence at
  founder defaults is byte-identical to today's. Never the affect sub-stream,
  never `Math.random`.
- Founder-parity: at founder defaults the new code paths are dead code
  guarded by zero — the forward pass must produce bit-identical outputs to
  the current brain on pinned seeds, including across `learn()` ticks.
- No consciousness-class claims. This is machinery: a stateful associative
  net with a gated buffer. The honest frame is cognitive-ascent.md's
  bauplan argument, and this doc stays inside it.

## (a) Current mechanism, precisely

`src/material/brain.js` (551 lines). Cited facts:

- Input: `senseVector` (brain.js:99–125) → N_IN = 48 entries, indices 0–46
  senses (46 = `s.mineral`, brain.js:122; 43/44/45 = digAhead/soilBelow/
  enclosed, brain.js:119–121), index 47 the bias sense. Never renumbered.
- Architecture: `createBrain` (brain.js:155) sizes the hidden budget by
  `assocSize` (100 × brainSize, floor 16); `bpLayers` (founder 1, max 3;
  brain.js:160) splits it evenly across layers, ≥ 4 neurons each.
  Layer 0 wiring density = 1 − `bpSparsity` (founder 0.65 → 0.35;
  brain.js:169); deeper layers 0.5. Sparse adjacency lists throughout.
- Motor readout: sparse a2m (density ~0.5), ZERO-init in Loam (brain.js:191),
  normalized by fan-in against REF_FANIN = 44 (brain.js:277) so learned-pathway
  magnitude is size-invariant. `instW` is the genetic pathway (brain.js:198–210),
  mapped from instinct genes to ±1.2; motor baselines `biasM` (brain.js:213–240).
- Forward pass (brain.js:315–388): sanitize NaN senses → attention (EMA
  salience, softmax sharpness 3.0; brain.js:284–313) → per layer: sparse
  matvec + tanh → winner-take-all (one winner keeps its activation, losers
  scaled by `latInhibScale` = 1 − `bpLatInhib`, founder → 0.15;
  brain.js:254, 342–355) → motor: learned sparse readout + instW·input +
  biasM, tanh to ±1 outputs. Attention gates (`agCount/agGain/agThresh`,
  brain.js:256–260) are founder-off (count 0).
- Learning (brain.js:438–491): reward-modulated Hebbian. `lr = (0.005 +
  learningRate×0.045) × (2×bpHebb)` (founder ×1.0; brain.js:462). Motor
  layer: full Hebbian on last-layer pattern; hidden layers: winner full
  rate, others 1/3. Weights clamped to ±1.5 (`clampW`; brain.js:395).
  Neuromodulation: `nmGain` (founder 0) scales lr by a chems level above
  `nmThresh` (brain.js:467–471).
- Eligibility traces: one per motor synapse (`traces.e`, brain.js:263),
  updated in `updateTraces` (brain.js:420–436) with `mtDecay` (founder 0.9)
  / `mtGain` (founder 0; brain.js:421–422) — **founder-off**, so delayed
  credit assignment exists in code but not in founders. Traces feed the
  motor update as `err × (assoc + traceGain × e)` (brain.js:473–480).
- Structural plasticity: neurogenesis in juveniles, pruning in adults, on
  the last hidden layer (brain.js:493–549); floors 16 (single layer) / 8.
- `decide` (brain.js:390–403): argmax over outputs + votes + rng-range
  exploration noise. No memory anywhere in this path: given the same
  (input, attention EMA, weights), the brain answers identically. The
  attention EMA is the only state that crosses ticks, and it is a slow
  salience average, not a representation the brain can read or write.

What is missing: no signal flows backward or sideways in time. A stimulus
that disappears from the sense vector is gone from the brain on the next
tick. There is no mechanism by which an action at tick *t* can be credited
by reward at tick *t+N* except traces — which are founder-off and motor-only.

## (b) The deepening

### B1 — Recurrent loops (knob, not class)

A sparse recurrent adjacency list per hidden layer: layer *l* reads its own
previous-tick post-WTA activations. Built with the same `randSparse` the
code already uses — a new connection class is not invented; a density knob
is turned on an existing one.

New B-family loci (all continuous, append-only genome growth, own
sub-stream — the D-genome pass will assign; names provisional but the
semantics are the contract):

- `bpRecur` — recurrent density per hidden layer (founder 0 → no recurrent
  synapses are built, no draws consumed).
- `bpRecurGain` — scale of the recurrent contribution to pre-activation
  (founder 0 → even if synapses existed, they contribute nothing).

Tick-time semantics (one-step unfolding, never in-tick iteration):

1. At tick *t*, layer *l*'s pre-activation is
   `pre = bias + W·src + biasSense + bpRecurGain × tanh(Wrec · a_l(t−1))`,
   where `a_l(t−1)` is the stored post-WTA activation vector of layer *l*
   from the previous tick (zero vector on the brain's first tick).
2. The recurrent term is added BEFORE tanh and BEFORE winner-take-all.
   WTA then commits exactly as today (brain.js:342–355): one winner keeps
   its activation, losers scale by `latInhibScale`. Effect: memory can make
   a neuron win again (persistence) or tip a close race, but the layer still
   commits to one thought per tick. WTA is the sparsity guard; recurrence
   is a vote, not a veto.
3. Recurrent weights are plastic under the same Hebbian rule as the hidden
   layers (winner full rate, others 1/3, same lr, same neuromodulation,
   same ±1.5 clamp), with eligibility traces through the tick boundary:
   `updateTraces` gains one trace per recurrent synapse, updated as
   `e = mtDecay × e + mtGain × a_l(t−1)[pre] × a_l(t)[post]` and entering
   the recurrent update exactly as motor traces do (brain.js:473–480).
   Founder `mtGain = 0` → this path is dead at founder, same as today.
4. Recurrent weight init: `rng.range(-scale, scale)` with
   `scale = 0.9 / sqrt(recurrentFanIn)` — drawn only when `bpRecur > 0`.
   Hebbian plasticity may later move them within the ±1.5 clamp.

Stability guarantee (bounded by construction):

- Every neuron output is `tanh` of a finite sum (brain.js:272). The
  recurrent state `a_l(t)` therefore lives in (−1, 1)^n_l for all *t*, all
  inputs, all genomes. Runaway to infinity is impossible by construction —
  the state space is compact. Oscillation is possible; oscillation is
  behavior (a persisting pattern is the memory mechanism working), not
  instability. WTA per tick additionally keeps each layer's effective
  state sparse. NaN cannot enter: the existing input sanitizer
  (brain.js:316–321) and finite-reward/finite-trace guards (brain.js:443,
  431) cover the recurrent path because it uses the same guarded
  primitives.

Compute cost: per layer *l*, recurrence adds `n_l × (bpRecur × n_l)`
multiply-accumulates — the recurrent fan-in. At founder defaults
(`bpRecur = 0`, `bpRecurGain = 0`) the term is skipped, not computed:
founder per-tick cost is exactly today's cost. Trace bookkeeping adds one
multiply-accumulate per recurrent synapse per tick, again zero at founder
(`mtGain = 0` returns early, brain.js:423).

### B2 — Working memory the brain owns (gated buffer)

This is the reactive layer's short-term store — owned by the brain, read
and written by the brain every tick. It is NOT the episodic system:
cognitive-ascent.md re-homes episodic memory to the deliberative layer;
this buffer never leaves the reactive forward pass. Name the loci with an
`swm` prefix (short-term/working memory of the reactive layer) to avoid
colliding with cognitive-ascent's deliberative `wmCapacity`/`wmHorizon`.

New loci (all evolvable, founder values reproduce today's behavior):

- `swmSlots` — buffer capacity, integer 1..8 (founder 1).
- `swmWriteGain` — write-gate gain (founder 0 → writes never fire).
- `swmWriteThr` — surprise threshold for writes (founder 1.0, i.e. high).
- `swmReadGain` — read-projection scale into layer 0 (founder 0 → the
  read path contributes nothing).
- `swmReadDens` — density of the sparse read-projection (founder 0.1;
  harmless while read gain is 0).
- `swmDecay` — per-tick slot decay toward zero (founder 0 → slots persist
  until overwritten).

Buffer semantics at tick time:

1. Each slot holds one stored vector: the gated sense vector
   (`gated`, brain.js:324 — the N_IN−1 attention-sharpened senses) at the
   tick it was written. Writing a slot is a memcpy; reading never mutates.
2. WRITE: once per tick, after the forward pass, compute surprise =
   L2 distance between the current gated sense vector and the most-recent
   slot's content (against zeros if the buffer is unwritten). If
   `swmWriteGain × (surprise − swmWriteThr) > 0`, write the current gated
   vector into the oldest slot (ring overwrite). Founder (`swmWriteGain =
   0`): never writes — the buffer stays zeros forever.
3. READ: during the forward pass, before layer 0's matvec, each slot's
   content passes through a sparse read-projection (adjacency list per
   slot, density `swmReadDens`, weights zero-init and Hebbian-plastic
   under the same lr/neuromodulation/clamp as hidden weights) into layer
   0's pre-activation, scaled by `swmReadGain`. Founder
   (`swmReadGain = 0`): the entire read pass is skipped — cost and
   behavior identical to today.
4. DECAY: each tick, every slot scales by (1 − `swmDecay`). Founder
   `swmDecay = 0`: perfect persistence until ring-overwrite. This is the
   evolvable forgetting knob — selection can buy recency for free or pay
   for persistence.

What the brain can do with this that it cannot do today: hold a stimulus
across a distractor gap (sense A at *t*, noise for *M* ticks, act on A at
*t+M+1*), and learn the read-projection so that "what I saw two seconds
ago" steers "what I do now" — credit assigned through the same
Hebbian+trace machinery as everything else.

### B3 — Interaction with existing machinery

- Eligibility traces + recurrence: traces now cover three synapse classes
  (motor, hidden feedforward unchanged, recurrent) under the same
  `mtDecay`/`mtGain` loci. Read-projection synapses get traces too (same
  loci). One knob family, four substrates. Founder-off everywhere.
- Neuromodulation: the recurrent and read-projection weights learn with
  the same `lr` that `nmGain`/`nmChem`/`nmThresh` already scale
  (brain.js:467–471) — stress (or whatever chem selection picks) tunes
  memory plasticity for free. Write-gate threshold is additionally
  modulatable: `swmWriteThr_eff = swmWriteThr × (1 + nmGain × max(0, chem −
  nmThresh))`, reusing the same loci, so arousal can open or close the
  write gate without new machinery.
- Attention gating over the buffer: the existing attention gates
  (`agCount/agGain/agThresh`, brain.js:256–260) operate on the sense
  vector before the buffer write (the buffer stores the gated vector),
  so what the brain attends to is what it remembers. The read path adds
  the remembered content back into layer 0 pre-activation before WTA —
  a remembered salient sense can re-win a neuron that the live senses
  alone would not have won. No new attention machinery; the buffer sits
  downstream of the existing gates.
- Neurogenesis/pruning (brain.js:493–549): recurrent synapses belong to
  their layer's neurons — added neurons get recurrent fan-in/fan-out
  drawn at `bpRecur` density; pruned neurons drop theirs. Read-projection
  adjacency lists index layer-0 neurons, so they shift on prune exactly
  as `a2m` indices do (brain.js:537–543). Buffer slots are neuron-count
  independent (they store sense vectors), so structural changes never
  corrupt the buffer.

### Cost analysis (per-tick, legible)

Let `n_l` = layer-*l* size, `F_l` = its feedforward fan-in,
`S` = swmSlots. Today's forward cost ≈ Σ_l n_l·F_l + N_OUT·(a2m fan-in).
New terms:

- Recurrence: Σ_l n_l·(bpRecur·n_l) MACs + equal trace updates. At
  `bpRecur = 0`: 0.
- Buffer read: S × n_0 × swmReadDens MACs + trace updates. At
  `swmReadGain = 0`: the pass is skipped: 0.
- Buffer write: O(S × (N_IN−1)) for the surprise distance + one memcpy —
  only evaluated; at `swmWriteGain = 0` the write branch is a single
  comparison: ~0.

Concrete scale (founder: brainSize 8.0 → ~800 neurons, 1 layer,
F_0 ≈ 0.35×47 ≈ 16): today ≈ 800×16 + 33×400 ≈ 26k MACs/tick/creature.
A deep-memory descendant (3 layers, bpRecur 0.1, S = 4, readDens 0.1)
pays ≈ +3×(267×27) ≈ +22k recurrence + 4×267×0.1 ≈ +100 read — roughly
2× the founder brain per tick. This is the lineage's real tradeoff and
the probe (e) measures it: the design's position is that selection should
feel this cost, consistent with cognitive-ascent.md's "brains that think
cheap outcompete brains that think dear, at equal depth."

## (c) NOT-do list

- **No new action verbs.** This track adds machinery, not verbs. ACTIONS
  (brain.js:36–81) is untouched; N_OUT stays 33.
- **No new senses.** senseVector (brain.js:99–125) is untouched; N_IN
  stays 48. (Paul's v0.5 rule is satisfied vacuously — no verb, no gene.)
- **Senses/actions append-only, never renumbered.** Restated because the
  whole lineage depends on it; nothing here reorders indices.
- **Instinct/learned split preserved.** `instW` (brain.js:198–210) is not
  read by, written by, or routed through any new path. The recurrent
  matrix and read-projection are plastic (nurture); instW stays genetic
  (nature). A genome that zeroes its memory knobs gets exactly today's
  brain — nurture is optional per lineage, nature is not.
- **Determinism.** New draws come from `brain.rng` (brain.js:266), guarded
  by `density > 0` so founder brains consume the identical draw sequence
  as today. Same seed → same world, same brain, same actions. The affect
  sub-stream is never touched.
- **No in-tick settling.** One-step unfolding only. No iterative
  relaxation, no fixed-point iteration, no variable-cost per tick — cost
  stays legible and deterministic.
- **No episodic-system changes.** The buffer is the brain's; the episodic
  memory with sleep consolidation stays where cognitive-ascent.md puts it
  (deliberative layer). The two must not share state or loci names.
- **No deliberative-layer machinery.** No world model, no planner, no
  arbitration here — that is cognitive-ascent.md's v0.40+ program. This
  track deepens the reactive layer only.
- **No consciousness-class claims.** A stateful associative net with a
  gated buffer is still an associative net. The bauplan argument
  (selection elaborates a present class, never invents one) is the
  ceiling on what this design claims: the class was present the day the
  sparse net shipped; these are capacity knobs on it.
- **Founder-parity guarantee.** At founder defaults (`bpLayers 1`,
  `bpSparsity 0.65`, `bpLatInhib 0.85`, `bpHebb 0.5`, `agCount 0`,
  `mtGain 0`, `nmGain 0`, plus `bpRecur 0`, `bpRecurGain 0`,
  `swmWriteGain 0`, `swmReadGain 0`): no recurrent synapses are built, no
  recurrent draws are consumed, the recurrent term is skipped, the read
  pass is skipped, the buffer stays zeros, writes never fire, and the
  trace extension is dead code behind `mtGain = 0`. The forward path is
  then instruction-identical to today's. Probe (a) verifies it
  empirically; the guards above are why it must hold.

## (d) Execution probes (all must pass before any "built" claim)

All probes live in `probes/` next to the existing suites (cf.
`probes/nervous-system.mjs` conventions). Every probe states its metric in
units the sim actually produces. No vibes.

(a) **Founder-parity probe.** New brain code at founder defaults vs the
    pre-D2 brain on pinned world seeds: run 5,000 ticks with a fixed
    deterministic reward schedule and fixed exploration stream. Metric:
    the two action-index sequences must be bit-identical (array equality,
    not statistical similarity), and final weight vectors must match to
    float exactness. If one bit differs, the build is wrong — the guards
    in (c) exist precisely so this holds.

(b) **Delayed-reward probe.** Fixture: action A at tick *t* earns reward
    only at tick *t+N* (N = 30, then N = 100), with distractor senses
    between. Two genomes: founder (`mtGain = 0`) vs `mtGain = 0.5`
    (recurrence and buffer both enabled at modest values). Metric:
    reward-per-episode (mean over 200 episodes, pinned seeds) for the
    trace-enabled lineage must exceed the founder-off baseline by a
    pre-registered margin (≥ 20% at N = 30) — measurable proof the traces
    bridge the gap, not a story about them.

(c) **Working-memory probe.** Fixture: stimulus vector A or B presented
    for 5 ticks, then M = 50 ticks of distractor senses, then a probe
    sense; the correct action depends on whether A or B was shown.
    Metric: success rate over 300 trials (pinned seeds) for a
    memory-enabled genome (`swmSlots ≥ 2`, gates open) vs chance.
    Chance is defined as 1/N_OUT for a uniform-random policy AND as the
    measured success rate of the founder genome on the same fixture
    (memoryless control) — the claim requires beating both, with the
    founder control expected near 1/33 and the memory genome
    pre-registered at ≥ 70%.

(d) **Recurrence-stability probe.** Adversarial fixtures: all senses
    pinned to max, alternating max/min square waves, and the NaN-injection
    fixture (the sanitizer at brain.js:316–321 must still hold). Genomes:
    `bpRecur` and `bpRecurGain` at their maximum evolvable values,
    `swmSlots = 8`. Run 10,000 ticks. Metrics: every activation in every
    layer within (−1, 1) on every tick; zero NaN/Infinity in activations,
    weights, traces, and buffer slots (counted, not eyeballed); recurrent
    weight norms bounded by the ±1.5 clamp (max abs reported). Any
    violation fails the build.

(e) **Compute probe.** Instrument `forward()` + `learn()` with a MAC
    counter. Metrics: per-tick MACs at founder defaults must equal the
    pre-D2 count exactly (parity extends to cost); at the maxed
    configuration (3 layers, max bpRecur, 8 slots) per-tick MACs must be
    within the bound stated in (b) — ≤ 3× the founder count — and wall
    time per tick measured in µs (not estimated) must stay under the
    lineage's per-creature tick budget. Numbers reported, never adjectives.

## (e) Honest numbers only

Every metric above is a sim output: action-index arrays (exact),
reward-per-episode means (floats), success rates over counted trials,
activation min/max ranges per tick, MAC counts, wall-clock µs per tick.
The doc claims nothing that cannot be printed by a probe. If a future
result cannot be reduced to one of these — a sequence, a delta, a range,
a timing — it does not count as evidence for this track.

## What's excluded and why

- **Multi-step in-tick settling / attractor relaxation:** cost becomes
  data-dependent and non-legible; the lineage negotiates compute
  explicitly, so per-tick cost must be a closed-form function of the
  genome. One-step unfolding is the whole recurrence story.
- **Cross-layer recurrence (layer 2 → layer 0):** adds a second delay
  scale with no probe demanding it. Within-layer recurrence plus the
  existing feedforward depth already gives multi-timescale state.
  Revisit only if probe (c) fails at within-layer recurrence alone.
- **Writing actions or rewards into the buffer:** the buffer stores
  sensory state (the gated sense vector). Action/reward history is the
  traces' job. Two memory systems with clean jurisdictions beat one
  muddy one.
- **Evolvable buffer addressing (content-based read heads, key/value
  indirection):** a new mechanism class, not a knob. The read-projection
  is a fixed sparse projection whose weights learn — elaboration of the
  present class, per the bauplan argument.
- **Growing the buffer by neurogenesis:** slots are a genome-set integer
  (1..8), not grown by the juvenile plasticity window. Keeps the capacity
  knob cleanly genetic.
- **Deliberative-layer integration:** arbitration, world-model rollout,
  planning — explicitly cognitive-ascent.md's program (v0.40+), not this
  track. D2 must be buildable and probeable with the reactive layer
  alone.
