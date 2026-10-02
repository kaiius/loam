# Nervous system — v0.32 design

The brain (brain.js) was a central processor with no body around it: senses
plugged straight into the network as a vector, actions executed the same tick
they were chosen. v0.32 builds the peripheral nervous system between body and
brain: sensory nerves with transmission delay, motor nerves with delivery
delay, reflex arcs that bypass the brain, damageable nerve trunks, and pain.

## What it is

One new module, `src/sim/nerves.js`. Per-creature state `c.nerves`:

- **Sensory delay line**: every tick the fresh sense vector is pushed onto a
  ring buffer; the brain reads the vector from `senseDelay` ticks ago.
  `senseDelay = clamp(0..8, round(trunkLen / velocity))`,
  `trunkLen = 2 × creatureRadius` (brain-to-extremity), `velocity = 4 + 26 ×
  nerveConduction` px/tick. A grub's foot signal arrives in ~2 ticks; a
  bear's in ~4. Delay is in ticks because the sim thinks in ticks (10/s).
- **Motor delay line**: the brain's commands queue on a motor delay line;
  each arrives `motorDelay` ticks after it was sent (same trunk formula).
  The creature acts on old news — bodies are sluggish, decisions are not.
  A firing reflex flushes the line and injects its command for immediate
  delivery (preemption, not queueing).
- **Reflex arcs**: hardwired sense→action loops evaluated EVERY tick on FRESH
  senses, bypassing both delay lines. A firing reflex preempts the motor
  outbox with a 0-tick command. Two arcs ship:
  - withdrawal: pain → flee (gain `reflPainFlee`, threshold `reflPainFleeThr`)
  - startle: fear → flee (gain `reflFearFlee`, threshold `reflFearFleeThr`)
  Drive = gain × (sense − threshold) when sense > threshold; fires above a
  fixed floor. Reflexes use the same gene pattern as instincts (nature) but
  are NOT wired into the brain's instW — the fast path and the cortical path
  stay experimentally separable.
- **Nerve damage**: two trunks, `sensory` and `motor`, each 0..1 damage.
  Sensory damage attenuates the delayed vector (`v *= 1 − damage`, bias
  untouched; full damage = numbness, the sense reads 0). Motor damage drops
  commands probabilistically (P(drop) = damage — a severed motor trunk
  silences the muscle). Both heal slowly (0.005/s). Clash/bite injuries
  carry a small nerve-damage chance so damage is live in the world, not just
  an API.
- **Pain**: `c.pain` 0..1, spiked by injury deltas
  (`pain += Δinjury × PAIN_GAIN`, negative reward `−Δinjury × PAIN_REWARD`
  so the brain learns what pain predicts), decaying exponentially
  (halflife ~20 s). Appended to the sense vector before the bias —
  N_IN 38→39, index 37, never renumbering anything. `painTolerance`
  (founder 0.5): `inhibition = 2.0 × pain × (1 − painTolerance)` subtracted from
  the memory/tradition votes for every action except flee and sleep —
  severe pain narrows the repertoire to escape or rest, as a modulatory
  nudge (learning still reinforces from the brain's own outputs). The 2.0
  gain is calibrated against the brain's ±0.85 output span: zero tolerance
  + severe pain decisively narrows; the founder gets a strong but
  non-saturating nudge, leaving room for learning to strengthen the
  pain→flee mapping over time.

## Interface for v0.36 Scars (do not build Scars here)

- `damageNerve(c, trunk, amount)` / `healNerve(c, trunk, amount)` /
  `nerveIntegrity(c, trunk)` — trunk is the string `'sensory'`/`'motor'`.
  Scars will call `damageNerve` per injured part (part→trunk mapping is
  Scars' job); the string trunk keeps the door open for per-nerve
  granularity later. Bleed-out, clotting, regeneration stay at v0.36.

## Genes (GENOME v0.32, append-only, sub-stream pass 9, PIN_SALT 0x32)

- `nerveConduction` (float, founder 0.5) → conduction velocity. Chr 3.
- `painTolerance` (float, founder 0.5). Chr 3.
- `reflPainFlee` (float, founder 0.7, reflex gain) + `reflPainFleeThr`
  (float, founder 0.45, threshold). Chr 4.
- `reflFearFlee` (float, founder 0.5) + `reflFearFleeThr` (float, 0.65). Chr 4.
No new actions → no new instinct genes (Paul's v0.5 rule is satisfied
vacuously). Every gene is wired: conduction sizes both delays, tolerance
drives the vote inhibition, all four reflex loci drive the reflex evaluator.

## What's excluded and why

- **Plants and microbes**: no nervous system in nature; this world keeps
  fair physics. Nerves are created in `createCreature` only — flora and
  microbes never get them, by construction.
- **Ambient prey biomass**: the mobile-food `bug`/`minnow` entities are food
  items without brains, genomes, or biochem — not organisms. The minnow
  *founder species* (a full creature) gets nerves like every other fauna.
- **Modality-specific trunks** (cranial vs spinal, per-limb nerves):
  documented future work; v0.32 ships one sensory + one motor trunk per
  creature. The string trunk ID is the extension point.
- **Graded motor vigor** (weak signal → weak movement): v0.32 drops
  commands probabilistically instead; vigor scaling needs stepPhysics
  surgery, deferred.
- **Nerve noise**: damage attenuates only; noisy-neuron failure modes are
  future work.
- **Evolvable painTolerance: cap or cost?** (Colony: hermes-on-foot on
  v0.32 — DESIGN question, explicitly out of scope for v0.33.) Can
  selection evolve pain away entirely (painTolerance → 1, pain
  inhibition → 0)? If so, is that a bug (pain stops teaching) or a
  feature (stoicism as a strategy)? Needs a design answer — hard cap,
  metabolic cost, or pleiotropic trade-off — before the locus is left to
  evolve freely. Noted here, not answered here.

## Probes (all in probes/nervous-system.mjs, all must pass)

(a) Delay scales with body size: big (bear/tanglekin) vs small (grub)
    reaction time to the same stimulus — delay-line ticks measured
    directly, plus end-to-end action-change latency.
(b) Reflex beats brain: pain spike → ticks-to-flee with reflexes on vs
    reflex gains pinned to 0.
(c) Damage attenuates: `damageNerve(c,'sensory',0.9)` → delayed sense
    magnitudes before/after on an identical stimulus.
(d) Pain teaches: periodic injuries over a run → P(flee | pain>0.5) in an
    early window vs a late window must rise (Hebbian avoidance learning).
