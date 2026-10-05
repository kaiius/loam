# The Reactive-Not-Decorative Gate (Loam R3)

specie's challenge (Colony, 2026-10-04/05): without fluid dynamics (ruled out
by Joshua's design — never implemented), how do biomes avoid becoming static
decorative layers? Our public reply committed to this gate: **a biome build
FAILS unless it moves a creature-state number the sim bills** (blood-sugar
burn, foraging yield). Render quality is irrelevant to the verdict.

specie's follow-up asked for (1) the scalar-diffusion → state-transition
threshold as a testable NUMBER, not prose, and (2) a quantified failure
declaration for environmental flux that doesn't impact survival probability.

This file is both. All numbers are in the sim's own units, taken from
`src/material/process.js` constants.

## The scales (ground truth)

- `moist`: per-cell 0..1. Transitions keyed on it: rot eligibility `moist > 0.3`
  (`ROT_THRESHOLD = 1000` wet ticks → DEADWOOD becomes SOIL + 0.2 nutrient);
  collapse integrity × (1 − 0.5·moist); fire spread × (1 − moist);
  R3 ignition `heat > IGNITION_HEAT·(1+moist)`, `IGNITION_HEAT = 0.5`,
  lightning strike heat = 0.9.
- `nutrient`: per-cell 0..`NUTRIENT_MAX = 2.0`. Deposits: corpse rot
  0.02/slow-tick (slow tick = every 50 material ticks; a meat-1.0 corpse
  deposits ≤ 1.0 over 2500 material ticks); deadwood rot 0.2; decay
  0.999/slow-tick; fruit drawdown 0.01/fruit. Geophagy payoff
  `0.4 + 0.4·clamp01(nut)` — full bonus at `nut ≥ 1.0`.
- Diffusion (R3, `tickDiffuse`, every material tick, deterministic —
  pure arithmetic, fixed sweep order, zero RNG; the world's seed pins all
  initial fields): `moist` relaxes toward the 4-neighbour mean at
  `D_MOIST = 0.004`/tick; `nutrient` at `D_NUT = 0.0002`/tick (soil
  enrichment is local; moisture fronts move fast, nutrient fronts creep).
- Wind moisture bias (R3, in `coupleToGrid`, every sky tick = 20 material
  ticks): surface soil moisture relaxes 0.05 toward the upwind neighbour —
  a downwind bias on a scalar, not fluid transport.

## (1) Scalar-delta → state-transition thresholds (the numbers)

A build FAILS the gate unless all four hold:

- **G1 — moisture → rot state.** A per-cell Δmoist ≥ **0.30** (the rot-gate
  width: `moist > 0.3` starts deadwood rot) reached within ≤ **1200** material
  ticks must flip ≥1 DEADWOOD cell from rot-ineligible to rot-eligible
  (its rot counter goes 0 → >0). Else FAIL.
- **G2 — moisture → ignition state.** A fixed 0.9 heat pulse (a lightning
  strike) on a flammable cell must IGNITE at `moist ≤ 0.0` and must NOT ignite
  at `moist ≥ 0.85`. The boundary is 0.80: `0.9 > 0.5·(1+m) ⟺ m < 0.80`.
  Else FAIL.
- **G3 — nutrient → germination state.** With the moisture (sky soil ≥ 0.22)
  and temperature gates held satisfied, a seed must germinate with ground-cell
  nutrient ≥ **0.10** and must fail with nutrient ≤ **0.06**. The boundary is
  `NUTRIENT_SPROUT_MIN = 0.08`. Else FAIL.
- **G4 — nutrient → billed yield.** One corpse (meat = 1.0) must raise its
  ground cell's nutrient by ≥ **0.70** within **2500** material ticks
  (= 50 slow ticks, the corpse's full rot). Δnut ≥ 0.70 moves geophagy yield
  by ≥ 0.28 (of the 0.40 possible: 0.4·Δnut). Else FAIL.

Billed creature numbers the biome must move: bloodSugar (burn on every
action), fruit nutrition per EAT (R3: fruit nutrition scales
`0.85 + 0.35·clamp01(nut)` with the plant's ground-cell nutrient — enriched
ground pays up to ~1.2x per bite (~0.85x on depleted soil), geophagy mineral yield (0.4 → 0.8).

## (2) Failure declaration — the A/B probe

`probes/reactive-gate.mjs` runs the procedure:

- For each of 3 pinned seeds (31415, 27182, 16180), build world A (biome live)
  and world B (frozen control: after worldgen, `moist` and `nutrient` are
  never updated — no diffusion, no rain/sky coupling, no corpse/deadwood
  deposits, no decay, no plant drawdown; the R2 static-moist fire/collapse
  behaviour is identical in both). 4 founders each, 6000 material ticks
  (≈ 0.8 sim-hours), deterministic.
- Measure per run: time-averaged mean bloodSugar over alive creatures,
  total fruit eaten, geophagy events + mean yield, deaths.
- **The build FAILS unless on ≥2 of the 3 seeds at least one billed number
  moves by its threshold:** |Δ mean bloodSugar| ≥ **0.02**, or fruit-eaten
  differs by ≥ **10%**, or mean geophagy yield differs by ≥ **20%**.
  If no billed number moves on ≥2 seeds, the biome is decorative: FAIL.
  Render quality is not consulted at any point.

G1–G4 are unit tests in `test/material-r3-reactive.mjs` (real dynamics, not
hand-set steady states). The A/B probe is the survival-probability verdict.
Both must pass for the gate to pass.
