# QA re-baselining protocol (v0.36; ax7's suite-hygiene challenge, 2026-10-02)

## The problem

The suite carries 60 pre-existing failures. A bare count ("60 fail, zero new")
is meaningless: new breaks surface only via a hand-maintained per-test
failure-name diff. Worse, re-baselining a gate after an input-vector change
(N_IN shift) risks misclassifying a behavior change as plumbing — the vulture
gate's v0.28 recalibration (test/species.mjs: "N_IN 37→38 shifted the
brain-weight stream; seed 42424's vulture brains foraged 28% less") is the
standing example of a re-baseline done right: the mechanism was pinned by
unit tests first, and the end-to-end roll was recalibrated with the reason
written down.

Three holes, three closures:

## 1. The failure-name diff is load-bearing (not the count)

Every release runs the full suite on the tagged commit AND on the previous
tag, then diffs per-test failure names (strip timings, sort -u, comm —
normalize the `file: ✖ name` vs `✖ name` extraction formats before
comparing). Zero new failure names or the version doesn't ship. The count
alone is never the evidence.

## 2. Classify every delta: PLUMBING vs BEHAVIOR vs UNCLASSIFIED

Each failure name in the baseline carries a classification:

- **PLUMBING** — the test harness or scaffolding is broken, not the sim
  (DOM stub gaps, `Date.now()` seeds, TypeError in test setup). Evidence:
  the failure is in test scaffolding code, and the sim behavior it was
  meant to check is covered elsewhere or by an execution probe.
- **BEHAVIOR** — the test asserts sim behavior and the sim changed.
  Re-baselining a BEHAVIOR failure requires the canary rule below.
- **UNCLASSIFIED** — neither verified. Treated as BEHAVIOR until classified.
  New UNCLASSIFIED entries may not be added at re-baseline time; the
  classifier must do the work or the gate doesn't move.

## 3. The canary rule (answers ax7's vulture question directly)

"How to distinguish input-vector widening from actual vulture worsening?"

When N_IN (or any sense/action vector) changes:

1. **Name the canary set first.** Before touching the gate, list the tests
   asserting behavior that must NOT change (e.g. "canopy: eating restores
   bloodSugar", "v0.6: per-creature sight range is used for sensing", the
   physics tests). The canary set is committed in the re-baseline note.
2. **Run canaries on both wirings, same seeds.** Old wiring (from the
   previous tag: `git show <tag>:src/sim/brain.js`) vs new wiring. Any
   canary flip = behavior change, not plumbing — investigate, don't
   re-baseline.
3. **The vulture-gate rule.** After an N_IN shift, the vulture gate (or any
   gate whose mechanism touches the widened vector) runs against BOTH
   wirings on identical seeds before re-baselining. Outcome difference =
   behavior change. Only when both wirings agree on the mechanism (and any
   recalibration is a threshold/seed change with the reason written down,
   as the v0.28 vulture note does) may the baseline move.
4. **The re-baseline note.** Every baseline change writes to BUILD_QUEUE:
   what moved, why the old baseline is stale, the canary set and its
   result on both wirings. A re-baseline without the note is not a
   re-baseline — it's drift.

## 4. Readings pins (ax7's "pins check readings, not just outcomes")

The hole: seed-pinned probes asserted pass/fail, but an emitter change
quietly doubled a measured number without tripping anything — the pins
never recorded the numbers.

Closure: `probes/qa-readings.json` pins the quantitative readings of the
key probes at the tagged commit (viability seed 3, pollination-exclosure,
seed-voyage, pollinator-crash, colonization). `probes/qa-readings-check.mjs`
re-runs them and diffs EXACTLY — same seed + same code + same platform =
same numbers, so any delta is a real behavior change, not noise. A delta
FAILs with expected-vs-got. A legitimate intended change updates the
manifest with a dated note explaining why. Run at every release tag
(~10 min); it is release-time tooling, not per-commit CI.

Platform relativity (Gemini P0, v0.36): exact-match is sound ONLY on the
same CPU architecture and JS engine — floating-point transcendentals
aren't guaranteed bit-identical across platforms. The manifest records
{arch, node}; on a different platform the check exits NON-COMPARABLE
instead of failing. A cross-platform fail would be a lie about the sim.

Known limitation: readings that are not exactly reproducible (wall-clock
dependent, e.g. tick-timing metrics) cannot be pinned — they are excluded
from the manifest by rule, and their exclusion is noted, not silent.

## 6. Gemini review responses (v0.36 spec review, pre-tag)

- **Gate 4 false-pass (collision math):** accepted in part. Kill-rate ∝
  prey-density is geometric; the Pearson part alone would false-pass. The
  gate now requires the CAUSAL direction (kills must LEAD prey declines,
  bestLag ≥ 1) plus crash-recovery — correlation at lag 0 is not a cycle.
- **Gate 5 drift (0.05 shift in ~25 generations):** accepted. Single-seed
  shifts are drift-indistinguishable; the gate now requires replication
  (≥2/3 seeds show the directional shift). Drift doesn't replicate
  directionally.
- **Gate 5 refuge objection:** accepted as an open mechanism question.
  Shark targeting has no sleep check — a sleeping creature in water is
  equally vulnerable. If phase doesn't change where creatures are during
  shark hours, the gate FAILS honestly, which is itself a finding about
  the v0.28 design note's claim. Documented in the probe header.
- **Gate 1 re-spawn leak:** investigated; Gemini's specific claim is wrong
  (pollinators are creatures, not spawned food — spawnMobileFood can't
  respawn them), but the re-breeding leak is real and instrumented
  (pollinatorsLeft). Handled on evidence from the probe run.
- **UNCLASSIFIED-as-BEHAVIOR trap:** the failure-name diff catches
  pass/fail changes; the readings pins catch quantitative drift within
  still-failing tests. The two jointly close the "plumbing fix changes
  behavior silently" hole — documented here so the closure is explicit.
- **Gate 7 index-leaks:** accepted in part. Added check (d): no
  identity-derived values in the sense stream (c.id may only exclude self
  from neighbor search). Full semantic provenance audit remains a
  known limitation with a named owner (the QA keeper) and trigger (any
  new sense added to the vector).

## 5. Sustained-viability tracking (ax7's "slow degradation" item)

The tick-zero viability gate (seed 3 must be VIABLE) guards a failure that
isn't happening — it only detects NEW breakage. Slow degradation across
versions needs a different instrument:

- `probes/qa-viability-ledger.jsonl` — one row per release: version,
  commit, date, seed-3 {alive, births, matings, deaths, verdict}, plus the
  full 12-seed battery when run.
- `probes/qa-viability-trend.mjs` — flags seed-3 births or alive-count
  dropping >30% vs the rolling mean of previous releases, or a
  VIABLE→EXTINCT flip. A flag blocks the release pending investigation.
- Procedure: the release builder appends the ledger row at every tag
  (seed 3 minimum; the 12-seed battery is the release-time procedure).
  Named owner: the release builder. Trigger: every version tag.

## 6. The sequential-worlds lesson (found live, 2026-10-02)

The pollinator-crash gate FAILED on its first run — and the failure was the
instrument, not the world. The crash arm (second world created in the
process) had 0 creatures alive at tick 4000 while the control arm (first
world) had 27. Root cause: creature ids came from a module-level
`nextId` counter, and `nerveHash(c.id, seq)` — the deterministic motor-drop
hash — used them. The second world's creatures got different ids, different
hashes, different reflex behavior: 27 vs 0 at tick 4000, same seed.

The fix (v0.36): `resetCreatureIds()` in creature.js, called from
`createWorld` — ids are world-relative, so the nth creature born always
has the same id and the v0.33 `hash(seed, tick, entityId, purpose)`
doctrine holds with a STABLE entityId.

Methodological consequences, now standing rules:
- Every two-arm probe must be validated for arm-comparability: run the
  control arm twice (same seed, sequential) and confirm identical
  readings before trusting any treatment effect. The exclosure,
  pollinator-crash, and defense-evolution probes' first runs are VOID
  (second arm tainted); they were re-run after the fix.
- "Same seed → same world" now means: same seed, same world, in ANY
  position in the process's world-creation order. The readings-check
  (`qa-readings-check.mjs`) re-runs probes in fresh processes; the
  sequential-arm pattern inside one probe file is covered by the
  control-twice validation.

## 7. The genesis-extinction finding (found live, 2026-10-02)

The foodweb-50k gate FAILED: seed 7/genesis goes 36 → 24 → 7 → 0 alive
by tick 15000. Death-cause audit: 351 predator kills. The 7 genesis
predators (sharks/bears) eat the entire prey base. Not seed-specific:
seeds 3, 7, 8 all extinct by tick 20000 under genesis. The legacy
(predator-free) spawner sustains seed 3 to 20000 ticks (49 alive).

This is a DESIGN finding, not a v0.36 code bug: v0.18 §13.6 added
predators as pure mortality (sharks "kill on contact but don't eat" —
no predator-side starvation oscillator). The roster is too lethal for
the prey's reproductive rate. Per the doctrine (tune founder economics
only, never outcomes), v0.36 does NOT retune predators to pass the gate.
The gate verdict is FAIL with the mechanism documented; predator
lethality vs prey fecundity goes to the design queue as a balancing item.
The viability gate (legacy spawner, seed 3) remains the release's
persistence proof.

## 8. Gemini v0.36 review dispositions (2026-10-02)

Three P0s raised; two accepted, one declined with rationale.

**P0 #1 (ACCEPTED): the `oid()` leak.** The `resetCreatureIds` fix was
incomplete — `world.js` has its own module-level `nextObjId` counter for
plant/herb/food ids via `oid()`. Fixed: `resetObjectIds()` exported and
called from `createWorld`. All id counters are now world-relative.

**P0 #2 (ACCEPTED): teacher "arrived" hallucination.** Returning `true`
from `moveTeacherToward` on invalid platform was wrong — it signals "task
complete" and freezes the teacher. Fixed: clear `targetPlatform` and
return `false`, so the next tick re-evaluates targets.

**P0 #3 (DECLINED): "must tune until Gate 2 passes".** Gemini argues
shipping with failing gates means zero QA coverage, and demands founder
pheno tuning (hungerRate/heatTol) until the foodweb gate passes. Declined:
the v0.36 brief is to BUILD the gates ("pass/fail with evidence"), not
to make them pass. Tuning economics specifically to pass a gate is
outcome-driven tuning — exactly what Joshua's "tune founder economics
only, never outcomes" doctrine forbids. The extinction is a real finding
(hyperthermia 73, illness 47 — not predators); it goes to the design
queue as a balancing item. An honest FAIL with a documented mechanism
is more valuable than a tuned PASS that teaches the sim to the test.
The gates are measuring, not just passing — that IS the QA coverage.

## What v0.36 did under this protocol

- Failure-name diff vs v0.35 tag: 60 failures in v0.36, 63 in v0.35
  regen (3 diff are timeout artifacts in the baseline extraction).
  **Zero new failures.** Method: `node --test test/*.mjs` in both trees,
  strip timings, sort -u, comm.
- Readings manifest created at the v0.36 tag; all 7 readings filled
  (viability-seed3, pollination-exclosure, qa-colonization, seed-voyage,
  pollinator-crash, defense-evolution, seed-voyage-10).
- Viability ledger opened; v0.32 row backfilled from REPRODUCE.md
  (44 alive, 602 births — matings/deaths not-recorded); v0.36 row added
  (49 alive, 862 births, 422 matings, 817 deaths). Trend check: CLEAN.
- The 60 pre-existing failures are classified in test/CLASSIFICATION.md
  (17 PLUMBING, 43 BEHAVIOR, 0 UNCLASSIFIED).
- Two sim bugs found LIVE by the gates and fixed: sequential-worlds
  id leak (creature + object ids now world-relative), teacher crash on
  floating-fruit smell (guard + fail-clean). Gemini P0 #1 and #2
  accepted; P0 #3 (tune-to-pass) declined per the economics doctrine.
- Gate verdicts: 4 PASS (viability, exclosure, colonization,
  physio-confinement, seed-voyage), 3 FAIL with mechanisms (pollinator-
  crash: resilient not cascading; foodweb-50k: environmental extinction;
  predator-prey: no kills, prey extinct; defense-evolution: no sorting).
  FAILs are reported, not tuned away.
