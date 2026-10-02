# Cognitive ascent — design track

The keeper's ruling (2026-10-02): tanglekin brains must reach human level or
beyond. The tweak that makes it a design instead of a wish: founders start
with rudimentary brains that already work like the target architecture —
memory systems, world models, planning present in miniature, on the path —
not associative nets hoping to become something else later.

## The bauplan argument

Selection cannot invent a computational class; it can only elaborate what is
developmentally present. The mammalian cortex did not evolve from nothing —
the pallium was already there in early vertebrates, and half a billion years
of selection scaled it. A bigger associative net never becomes a planner, no
matter how long you select: the class boundary is not crossed by scaling.

Therefore the founder brain ships the full cognitive bauplan at minimum
viable capacity, with evolvable capacity knobs. Evolution scales the knobs,
never the class. The acorn contains the oak's plan.

## The architecture: two layers from day one

**Reactive layer (fast).** The existing sparse associative net — 38 senses →
1–3 hidden layers → 24 action-drives, Hebbian plasticity, evolvable
brainPlan — becomes the reactive layer. Always on, cheap, handles reflexes,
habits, instincts. Everything already built is preserved; nothing is thrown
away.

**Deliberative layer (slow, rudimentary).** Three micro-components, present
at founder but tiny:

- *Micro world-model*: predicts the next-tick sense vector from (sense,
  action). Founder: a few dozen parameters, high error — barely better than
  guessing. Evolvable: capacity, horizon.
- *Episodic scratchpad*: the existing episodic memory with sleep
  consolidation becomes the deliberative layer's working memory — retrieved
  episodes condition the world-model rollout. Already built; re-homed.
- *Micro-planner*: rolls out 1–2 candidate action sequences through the
  world model, picks the one with the best predicted drive-state. Founder:
  1-step lookahead, 2 candidates — just enough for the mechanism to exist.
  Evolvable: depth, breadth.

**Arbitration.** An evolvable per-tick gate: the reactive layer controls by
default; the deliberative layer engages when reactive prediction error
exceeds an evolvable threshold. Founders pay almost nothing — the slow path
rarely fires. Evolution spends compute where it pays. Uncertainty-gating is
the honest answer to the compute problem.

## Evolvable capacity knobs (the ascent ladder)

New loci, own RNG sub-stream, all continuous:

- `wmCapacity` — world-model parameters (founder: ~32)
- `wmHorizon` — prediction steps (founder: 1)
- `planDepth` — rollout depth (founder: 1)
- `planBreadth` — candidate sequences (founder: 2)
- `epiRetrievalK` — episodes conditioning a rollout (founder: 1)
- `arbThreshold` — prediction error engaging deliberation (founder: high)

The ladder rule: no new mechanisms ever ship. Only bigger knobs, and the
selection to turn them. If a future version adds a cognitive mechanism that
is not a knob on this bauplan, the design has failed.

## Selection pressures that turn the knobs

The world must demand minds. Each pressure gets a probe — a task the
reactive layer provably cannot solve but deeper planning can:

- **Deception** (tribe divergence): cheaters vs detectors. Detecting
  deception requires modeling another's model — the world-model turned
  outward. Probe: a food-cache pilfering game; reactive agents lose.
- **Tool use** (Making arc): multi-step problems where 1-step planning
  fails by construction — the planner must deepen or the lineage starves.
  Probe: a two-stage extraction task (get the stick to get the fruit).
- **Teaching** (keeper + culture): the payoff for a world-model you can
  externalize. A creature whose demonstration improves another's planner
  success rate is practicing the oldest human technology. Probe: naive
  juveniles with vs without a demonstrator.

## Compute: pay only for what evolution uses

- The deliberative layer is capacity-gated AND uncertainty-gated; founder
  per-tick cost ≈ reactive cost + epsilon.
- A global deliberative budget per tick, with evolvable per-creature
  allocation — efficiency itself becomes a selection pressure. Brains that
  think cheap outcompete brains that think dear, at equal depth.

## Phase-transition gates (what convinces us)

- **Gate A**: planner depth > 1 evolves under tool-use pressure — grown,
  not installed.
- **Gate B**: world-model prediction error decreases across generations on
  held-out trajectories — it learns the world, not the training set.
- **Gate C**: teaching — a demonstrator measurably improves a naive
  creature's planner success rate. Culture, in the mechanism.
- **Gate D** (the big one): a novel multi-step problem solved within a
  lifetime that no ancestor solved — the first genuinely new idea.

## Relationship to the queue

- Requires: nervous system (v0.32 — sensorimotor delay makes planning
  meaningful; without delay there is nothing to model), Making arc (v0.24),
  tribe divergence (v0.38).
- New design track; build versions scheduled after v0.39 (Scars). The
  deliberative layer is a v0.40+ program, not a single version.

## What this is not

Not a bigger net. Not a language model bolted onto a monkey. Not the
keeper's own mind copied in. A bauplan, present at founder in miniature,
with the knobs evolution turns — and the world configured so that turning
them is how lineages survive.
