# v0.35 — Seed dispersal vectors (design §6.2) + water current field (§13.6)

Gravity-only dispersal ends. Two vectors replace it.

## 1. Endozoochory — the gut as a dispersal vector

Fruit eaten → seed loads into `c.gutSeeds` (probability 0.15 + 0.3×yield,
unchanged; eat-time roll stays on `world.rng` at the unchanged call site) →
rides `GUT_TRANSIT_TICKS` (400) + jitter(0–200, disperseRng) while the
creature moves → deposits where the creature IS. The old immediate-deposit
at the eater's position is gone.

- No new action, no anatomical prerequisite: dispersal is passive (gut
  transit), not a verb. The mouth that ate the fruit is the only anatomy
  involved, and every creature has one. (Anatomy-gates-capability note,
  filed per the 2026-10-02 doctrine.)
- The dad rides the fruit (v0.34 stamping preserved): `inheritPlant(mom,
  dad)` at deposition, so outcrossing survives the gut.
- Flora cap (60) + oldest-seedling culling transfer unchanged (v0.13/v0.24).
- Seedling tissue = labeled parental input (`ledgerIn 'parental'`), as before.
- Gut capacity 6 — seeds are bulk.
- A creature that dies with a full gut takes its seeds with it (mass-neutral:
  parental input is only booked at planting).

## 2. Hydrochory — the water current field

One current per water body, derived PURELY from geometry at worldgen
(`buildCurrents`): flow runs downhill — toward the end whose neighboring
ground is lower, or toward open water (the sea). Salt water drifts slow
(12 px/s); rivers run 20–45 px/s by length. No RNG draws: worldgen order
is load-bearing.

- Entry: (a) windfall fruit landing in water (flesh composts to the
  lakebed as before — mass conserved; the seed joins the drift, p=0.5,
  flotsam capped at 40); (b) gut deposition over water (no platform).
- Drift: `world.driftSeeds`, advected by the rect's current each tick,
  ttl 1500–2500 ticks.
- Wash-ashore: at the rect's edge — ground at the exit point → germinate
  there (new ground colonized); neighboring water → keep drifting; ttl
  expiry or void → sinks (mass-neutral, event-labeled).
- RNG: every new draw (timer/ttl jitter, child genome, wash-ashore jitter)
  from `disperseRng` = `createRng((seed·7919+35) >>> 0)` — causal
  sub-stream, pebbleRng precedent. Leak-criterion annotation: deposition
  location is selection-visible ⇒ causal; the current field itself draws
  nothing.

## 3. Verification

- `test/dispersal.mjs`: 8 tests (gut loading vs immediate deposit,
  away-from-parent deposition, mom×dad inheritance, current determinism,
  drift→wash-ashore, windfall launch, stream hygiene, sterility-deadlock cull).
- `probes/seed-voyage.mjs`: the seed-voyage gate — live sim, both vectors,
  deposition distances + colonization.

## 4. Review notes (Gemini spec review, 2026-10-02 — adjudicated)

- **Accepted (P1, watch):** the cull-oldest-mature fallback weakly selects
  against longevity — a hard ceiling on lifespan that favors fast "weed"
  strategies. It only fires at the 60-plant cap with zero seedlings (a rare
  gap event), so the ratchet pressure is weak; permanent sterility was the
  worse alternative. Revisit if flora demographics skew short-lived.
- **Accepted (P2, ecological note):** 400–600 gut ticks is ~40–60 sim-seconds;
  territorial creatures (`instHomeSeek` high) may loop home before deposition,
  making endozoochory self-planting for them. Valid ecological outcome, not a bug.
- **Rejected:** (a) "poop-desync" determinism break — all streams are seeded,
  deposition order is a deterministic function of the seed; (b) "mass in
  transit" ledger leak — seeds are zero-mass information by design, parental
  input is booked only at planting (documented §1); (c) wash-ashore
  germinating mid-air — `depositSeed`/wash-ashore already requires
  `groundBelow` kind==='ground', neighbor water keeps drifting, void sinks;
  (d) mature-cull mass scaling — the transfer already scales with
  `victim.growth × PLANT_MASS`; (e) genome-object memory — dies with the
  creature object.

- `test/dispersal.mjs`: 7 tests (gut loading vs immediate deposit,
  away-from-parent deposition, mom×dad inheritance, current determinism,
  drift→wash-ashore, windfall launch, stream hygiene).
- `probes/seed-voyage.mjs`: the seed-voyage gate — live sim, both vectors,
  deposition distances + colonization.
