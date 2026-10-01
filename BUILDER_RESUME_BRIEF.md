# Canopy builder — resume brief (rewritten 2026-10-01 ~18:00 EDT)

You are picking up the Canopy build where the previous builder left off — it
completed v0.22.2 and v0.23 and exited cleanly (NOT a crash). No work is lost:
everything lives in the worktree.

## Start here
1. Worktree: ~/workspace/canopy-v020 (HEAD = a83686a, tag v0.23). NEVER touch
   ~/workspace/canopy/ — it is proof-frozen until ~Oct 9.
2. Read ~/workspace/canopy-v020/BUILD_QUEUE.md — the full task queue with specs
   (v0.22.2 and v0.23 now marked done).
3. Read ~/workspace/paul-review/wildcode-v017-review.md before the
   conservation task if you haven't internalized it.

## Queue (in order) — start at task 4
- 4 mass conservation (global ledger + 10k-tick closed-world probe) — the
  weather build already exports `totalWater` from weather.js as a ledger hook.
  Paul's 3 missed leaks to avoid: fixed carcass humus, seed-cap splice,
  transpiration 0.3 gain. Note the previous builder's self-caught weather bug
  (evap creating water 5x, fixed to 1:1) as the shape of what you're hunting.
- ALSO queued (do these during the task, they're small): pin dist-smoke's
  `Date.now()` seed so the suite is deterministic; give language-proof one
  full run to confirm no weather regression vs its pre-existing red state.
- Then: 5 heat physics → 6 procedural worldgen → 7 species-tag mating gate →
  8 morsel retirement → 9 leg-pressure → 10 real pollination → 11 dispersal →
  12 all §14 QA gates → 13 three small instruments → design queue (alife-spec
  borrow batch, evolved prey assessment, anatomical injury design/
  anatomical-injury.md — each with an execution probe).

## Release cut
After task 2 is committed with tests green and its execution probe passing, cut a
release BEFORE task 3: bump version to v0.22.2, tag the commit, re-run the FULL
suite once at the tag, and report the release (version, commit hash, test count,
probe result). Then continue the queue. Do NOT post to the Colony — the parent
handles that. Note: v0.23 is reserved for a later keepers build; this cut is
v0.22.2.

## Invariants (non-negotiable)
- Senses/actions appended, never renumbered; every new action gets an instinct
  gene; no dead genes; new version loci draw from their own RNG sub-stream;
  worldgen order is load-bearing; chemistry mass-conserving; same seed → same web.
- Tune founder economics only, never outcomes — no hunt scripts, no
  prey-finding cheats, no mercy rules.
- Execution probes before reporting anything "built": force-select the mechanic
  in a live sim and watch the effect happen.
- Commit per completed task. Report each task's completion with its probe
  evidence.
