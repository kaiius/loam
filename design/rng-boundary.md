# RNG boundary: the causal/non-causal discipline

Standing rule (adopted v0.33 from Colony feedback, hermes-on-foot on v0.31):

> **A draw is causal iff its output is read downstream by anything selection
> or physics can see.** Every point where a non-causal-stream value becomes
> a causal-stream input is a **crossing** and must be annotated here.

## Streams

- `world.rng` — the causal main stream. Sequential, per-version sub-streams
  with pinned salts (genome.js passes); causally load-bearing draws stay
  sequential.
- `world.decorRng` — the non-causal stream. For values NEVER read by
  selection or physics: sway phase, color jitter, cosmetic scatter positions.
  Draining it must never change a trajectory (probes/rng-boundary.mjs).
- `world.pebbleRng` (v0.33) — causal sub-stream for pebble radii (see below).
- `world.teacherRng`, `weather.rng` — independent generators (own closures,
  no shared entropy pool; cassini's question answered in the probe output).
- Stateless `hash(seed, tick, entityId, purpose)` — non-causal jitter/flavor.

## The canonical regression test

`probes/rng-boundary.mjs` (seed 42): baseline vs +10k decorRng drain vs
v0.30 morsel-burial draws vs morsel entities. The drain and draws arms must
be bit-identical to baseline; the entities arm may differ (world-state
effect via the `buriedNear` sense — legitimate, not a leak).

## Annotated crossings

### FIXED in v0.33 — pebble radius (hermes-on-foot's flip, confirmed)
`addPebble` drew `r` from `decorRng`. Pebbles block, pile, and are navigated
(world.js: "Not decoration") — physics-visible, therefore
selection-visible. Draining decorRng 10k draws flipped a seed-42 death
(starvation→illness) via a death-pebble's radius at tick 131
(`releaseBodyMass` → `addPebble`). Fix: dedicated causal sub-stream
`pebbleRng` (seed·7919+17); main sequence bit-identical (genome.js
precedent). Probe: PASS after fix.

### ACCEPTED — worldgen initial conditions on the decor stream
These draw from `decorRng` for stream hygiene (founder-genome pinning), but
their values ARE initial conditions that physics/selection see. Same seed →
same world; changing them changes the world (expected). They are annotated,
not fixed, because the "decor" label here means "must not shift the main
sequence," not "inconsequential":
- Plant genomes (`plantBiomeFlora`, world.js) — genome → yield → fruit → eaten → selection.
- Buried-food positions (`buryFood`) — positions → `buriedNear` sense → foraging → selection.
- Predator placement (`spawnPredators`, creature.js) — position → encounters → kills → selection.
- Pebble positions (worldgen scatter) — positions → collisions → navigation → selection.
  (Radii are causal-stream now; positions remain decor-stream: moving a
  pebble's spawn point is a worldgen choice, and the value is fixed per seed.)

### The rule for new code
If physics or selection can see the value — collision, blocking, eating,
mating, dying, sensing — the draw comes from `world.rng` (or a dedicated
causal sub-stream with a pinned salt). `decorRng` is for pixels and phases
only. When in doubt, run `probes/rng-boundary.mjs`: if the drain arm flips,
you built a crossing.
