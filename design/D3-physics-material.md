# D3 — Physics and material depth — design v1

**Track:** design-only. No src/ changes. **Status:** awaiting Joshua's go.
**Scope:** deepen the material physics inside the standing no-fluids ruling
(Joshua, 2026-10-03): no Navier-Stokes, no flow fields, no liquid transport —
ever. Everything here is cell scalars + deterministic tick-time rules.

## 0. Invariants (up front — everything below is checked against these)

1. **No fluids, ever.** Erosion is dry granular creep; fire is scalar heat +
   state machines; body temperature is Newtonian exchange to scalar fields.
   Nothing flows like a liquid. The existing `water` depth field and
   `tickWater` are untouched by this design — erosion does not read them.
2. **Determinism:** zero RNG in the tick. Tie-breaking by sweep order
   (west→east, top→bottom), same as the existing processes. If a stochastic
   term is ever wanted, it is `hash2(seed, x, y, tick, purpose)` — stateless,
   never a stream (process.js:47–60).
3. **Mass conservation:** every new flux states its invariant. Relocation
   (not creation/destruction) wherever a material identity moves.
4. **Founder parity:** every new constant ships with a founder value that
   reproduces current behavior exactly — the 171/171 material tests must
   stay green with the new machinery on. New physics is *off or identity*
   at founder defaults, *live* at the tuned values the probes use.
5. **Append-only discipline:** senses append-only, never renumbered
   (material-world.md §3.2); MAT_PROPS rows may gain columns, never
   reorder; materials append-only (CHAR = id 10, after BEDROCK 9).
   No new action verbs — bask is already declared (§3.4 notes it
   unported); this design specifies its thermo effect, not a new verb.

---

## (a) Current mechanism (verified against the files)

- **tickDiffuse** (src/material/process.js:323): moist + nutrient relax via
  antisymmetric flux `(D/4)·(v_j − v_i)` over 4-neighbors, no-flux at
  boundaries and air interfaces, double-buffered, order-independent,
  zero RNG. AIR cells don't participate. (The R4 Cassini fix, process.js
  comments at :339–346: the old mean-relaxation leaked 8.9% moisture/200
  ticks at boundaries; the flux form conserves exactly.)
- **tickFire** (process.js:367): cells with `MAT_PROPS[m].flammability > 0`
  and `heat > IGNITION_HEAT·(1 + moist)` (0.5 base, process.js:16)
  ignite — moisture-gated; wet targets spread-damped by
  `(1 − moist[n])` in the spread term. Spread accumulates in the `spread`
  aux array and applies *after* the sweep (~1 cell/tick; the comment at
  :377–380 explains the old in-sweep chaining flash-burned half a canopy
  and let heat run to Infinity). Burning cells (`heat > BURNING_HEAT`,
  0.7, :17) accrue `burn[i]` and convert: LEAF→AIR after 3 ticks,
  DEADWOOD→SOIL after 30, WOOD→DEADWOOD after 60 (:20–22). Heat decays
  ×0.95/tick (HEAT_DECAY, :18), clamped at 1.5. `fireOn=false` → no
  ignition, no spread, no conversion.
- **Cell state** (src/material/grid.js:65–76): per cell — `mat` (Uint8 id),
  `moist`, `root`, `grownId`, `dug`, `heat`, `water`, `food`, `nutrient`.
  Material table (grid.js:35–53): AIR 0 … BEDROCK 9 with `digWork`,
  `integrity`, `fertility`, `flammability`, `permeability`, `solid`,
  `climbable`.
- **Burrow collapse** is moisture-damped: effective integrity for
  SOIL/SAND/CLAY is `base·(1 − 0.5·moist)` (process.js tickSlump, :136).
- **Wind** (src/material/weather.js:98): `windAt(mw, x)` = pinned global
  sky vector `sky.windU` + per-block hash noise (±6 px/s, weather.js:37);
  tree lean is fixed from wind at growth (WIND_LEAN_PER/MAX, :39–40).
  Wind is a 1-D scalar (side-view world) — direction is its sign.
- **Thermoregulation today:** creature biochem carries `b.coreTemp`
  (src/sim/biochem.js:524–531) and the thermal senses 29/30
  (`coldSense`/`heatSense`) read it as `clamp01((0.5 − t)·2)` /
  `clamp01((t − 0.5)·2)` — but nothing deep drives `coreTemp`; the
  thermodynamics is shallow. Bask is declared-but-unported
  (src/material/actions.js:310).

---

## (b) The concrete deepening

### 1. Deeper fire spread

**Per-cell state additions** (aux arrays via the existing `aux()` lazy
allocator, same pattern as `burn`/`spread`/`rot`):
- `phase` (Uint8): 0 unlit / 1 flaming / 2 smoldering. Replaces the
  implicit "heat > BURNING_HEAT" test as the burning predicate —
  *phase* carries the memory that heat alone cannot.
- `smolder` (Float32): accrued smolder-ticks on a smoldering cell.
- CHAR material, id 10 (appended after BEDROCK; table order untouched):
  `{ digWork: 6, integrity: 4, fertility: 0.3, flammability: 0.3,
  permeability: 0, solid: true, climbable: false }` — partially-burned
  wood between WOOD and DEADWOOD, still flammable but weakly.

**State machine (per cell, inside tickFire's sweep):**

```
if (!fireOn) → heat decays only (unchanged); phase cleared; spread drained.
Ignition (phase 0→1):  heat > IGNITION_HEAT·(1 + moist)  [unchanged gate]
Flaming (phase 1):
  burn[i] += 1
  if heat < SMOLDER_HEAT (= 0.35, below BURNING_HEAT 0.7) → phase = 2 (smolder)
  LEAF:  burn ≥ 3          → AIR        [unchanged]
  WOOD:  burn ≥ CHAR_TICKS → CHAR       [new: char layer, see below]
  CHAR:  burn ≥ CHAR_BURN  → DEADWOOD
  DEADWOOD: burn ≥ 30      → SOIL       [unchanged]
Smoldering (phase 2):
  smolder[i] += 0.25 per tick   (slow charring — quarter rate)
  heat decays ×0.95 as usual
  if heat > REFLARE_HEAT (0.55) AND moist < REFLARE_MOIST (0.25) → phase = 1 (re-flare)
  if smolder[i] ≥ SMOLDER_OUT (120) → phase = 0  (burned out to inert CHAR/DEADWOOD residue)
  spread deposits at EMBER_K (see below) — embers carry fire slowly
```

**Founder parity for the char layer** (the aggregate timing must be
bit-identical to today's WOOD→DEADWOOD at 60 ticks): `CHAR_TICKS = 30`,
`CHAR_BURN = 30`. A wood cell burns 30 ticks as WOOD → 30 as CHAR →
DEADWOOD: total 60, identical to current. The char layer is *visible*
(the renderer can draw CHAR) but costs nothing in the timing ledger.
Tuned/live values may thicken it (e.g. 45/45) — that is a content
decision, not a mechanism change.

**Spread, modulated** — replaces the current flat term, keeping the
post-sweep accumulation discipline (the `spread` aux, applied after the
sweep, clamped 1.5):

```
spread[n] += heat[i] · fl[n] · SPREAD_K
           · (1 − moist[n])                          [unchanged moisture damping]
           · windBias(dx, U)                          [new]
           · fuelLoad(i)                              [new]
windBias(dx, U) = clamp(1 + WIND_SPREAD_K · U · sign(dx), 0, 2)
fuelLoad(i)     = 1 − FUEL_K · (burn[i] / BURN_TICKS_m)   [m = material of i]
```

- `U = sky.windU` — the **pinned global** sky wind only (not the per-cell
  hash noise; the noise stays in the renderer/leaf-sway domain). At
  founder default `WIND_SPREAD_K = 0.12`, and in test worlds with
  `windU = 0` the bias is exactly 1 — deterministic either way since
  `sky.windU` is seeded world state.
- `FUEL_K` founder = 0 → fuelLoad ≡ 1 → today's term recovered exactly.
  Live value 0.5: a nearly-spent cell pushes the front weakly.
- Ember carryover: smoldering cells also deposit
  `spread[n] += EMBER_K · (1 − moist[n])` for flammable 8-neighbors,
  with `EMBER_K = 0.02` — slow enough that embers can't start a runaway
  (a dry LEAF needs ~25 smolder ticks of accumulation), fast enough that
  a smoldering log is a real ignition risk. Post-sweep discipline
  unchanged.

**Boundary conditions:** no-flux at world edges (spread loop already
bounds-checks); heat clamped 1.5 as today. Invariant: heat is a
*decaying* field — non-increasing except via post-sweep spread deposits,
which are bounded by the 1.5 clamp (same as today, no new leak path).

### 2. Erosion / soil mechanics (dry granular creep — no fluids)

**Mechanism:** sediment-ledger creep. One extra aux array,
`creepAcc` (Float32, length `cols−1` — one slot per interior column
boundary). Per tick, single column pass:

```
h[c] = surface height of column c (topmost solid cell; cached per tick in aux)
for each interior boundary c (between column c and c+1):
  Δ = h[c] − h[c+1]                                  (signed drop)
  excess = |Δ| − REPOSE_DH                            (cells of over-steepness)
  if excess > 0:
    donor = the higher column
    creepAcc[c] += CREEP_K · excess                    (scalar rate, cells/tick)
    if creepAcc[c] ≥ 1:
      move the top loose cell (SOIL/SAND/CLAY only; ROCK/BEDROCK/WOOD immune)
      from donor's surface to the lower column's surface top
      (relocate: AIR cell above lower surface ← donor top cell; donor top ← AIR;
       ALL per-cell fields travel — the swapCells discipline, process.js:107)
      creepAcc[c] −= 1
```

- `REPOSE_DH = 2` cells per column: a 2-cell drop across one column is
  the loosest stable angle; anything steeper creeps back toward it.
- `CREEP_K` founder = 0 → zero accumulation → today's behavior exactly
  (tick-time erosion did not exist; worldgen keeps its own 40 erosion
  passes, material-world.md §2.1). Live value 0.02.
- Determinism: boundaries processed west→east; when two boundaries
  compete for the same donor column in one tick, west wins (sweep order).
- **Conservation accounting:** creep relocates whole cells — the invariant
  is `Σ_c count(mat = m)` constant for every material m. No fractional
  mass exists anywhere; nothing is created or destroyed. Boundary
  condition: columns 0 and cols−1 have no outward creep (no boundary
  slots); the bottom rows are BEDROCK (immune); ROCK cells never move
  under creep (only weathering touches ROCK — below).
- **Weathering** (ROCK→SOIL, the slow complement): exposed ROCK surface
  cells with `moist > 0.4` accrue `weather[i]` (Float32 aux, quarter-rate
  like rot: +1/tick); at `WEATHER_TICKS` the cell becomes SOIL (fertility
  and moist stay in the cell — same mass-conserving discipline as rot,
  process.js:443). Founder `WEATHER_TICKS = Infinity` → no conversion,
  today's behavior exactly. Live value 50,000 ticks (~21 days at
  2400 ticks/day). Invariant: total cell count constant; the material
  *counts* shift (rock −1, soil +1) — the probe states the invariant
  accordingly.

**Cost:** one extra column-height pass + one boundary pass per tick —
O(cols), ~480 ops, negligible next to the O(n) cell sweeps.

### 3. Thermoregulation + body thermodynamics

`b.coreTemp` graduates from a shallow readout to a state variable with
real exchange. All terms are per-creature-tick scalars; no new senses,
no new verbs.

**Ambient field** — a pure function of `(tick, y)`, no storage:

```
T_amb(tick, y) = T_BASE + T_DIURNAL · sin(2π·tick / 2400)
               − T_LAPSE · (1 − y / rows)
               + weatherEvent(tick)            [pinned cold-snap stream, default 0]
T_BASE = 0.5, T_DIURNAL = 0.25, T_LAPSE = 0.15 (all 0..1 scale)
```

2400 ticks/day is the existing diurnal cycle (material-world.md §10).

**Exchange (Newtonian, insulated):**

```
T_eff = T_amb(tick, y_creature)
if grounded on cell with heat > 0.3:  T_eff = max(T_eff, heat·0.8)   [fire-warmed ground conducts]
k  = K_BASE / (1 + FUR_K·fur + BULK_K·bulk)      [insulation]
C  = 1 + MASS_K·mass                              [thermal inertia]
coreTemp += −(k / C) · (coreTemp − T_eff)          [Newtonian cooling/heating]
coreTemp += ACT_HEAT · activity                     [locomotion +0.002/tick, sleep −0.001]
```

- `fur` = the existing fur locus (sleek→shaggy, body.js); `bulk` =
  body-mass phenotype; `mass` likewise. `K_BASE = 0.01`,
  `FUR_K = 2.0`, `BULK_K = 1.0`, `MASS_K = 0.5` — founder values chosen
  so that at founder defaults the exchange exists but is *weak enough*
  that the existing cold/heat sense readouts stay in their current
  band (parity probe covers this; see §d).
- **Shelter:** `enclosed` sense (idx 45) > 0.6 → wind-chill term
  removed: `T_eff += SHELTER_K·(0.5 − T_amb)` with `SHELTER_K = 0.3` when
  ambient is cold (burrows/tunnels are thermally buffered — the burrow
  sense already exists, the thermo story rides it).
- **Huddle:** for each conspecific within HUDDLE_R (60px):
  `T_eff += HUDDLE_K` (`HUDDLE_K = 0.02`, capped at +0.1) — social
  thermoregulation through the existing creature-proximity senses.
- **Bask** (declared-unported, actions.js:310): when it lands, its
  thermo spec is: stationary + in light → `T_eff = max(T_eff, SUN_BASK)`
  (`SUN_BASK = 0.75`) during daylight diurnal phase. This design
  *specifies* the effect; the action port is the M-track's job.

**Consequences (material-track, reuse the existing drive/health
ledger — no new drives):**
- Heat illness: `coreTemp > 0.8` → health drains `−ILL_K·(coreTemp − 0.8)`
  per tick (`ILL_K = 0.005`) — through the existing health ledger.
- Cold torpor: `coreTemp < 0.25` → movement energy costs ×1.5 and the
  brain's exploration noise halved (deterministic: the hash-noise
  amplitude scales — same stream, smaller amplitude). Torpor is
  *experienced* through the existing cold sense (idx 29) reading
  `clamp01((0.5 − t)·2)` — the brain learns to seek warmth or shelter
  with machinery that already exists. No new need enters the drive
  economy (biochem.js:521–523 already frames cold/heat as senses,
  not drives — that framing is kept).

**Cost:** per creature O(1) — a handful of float ops. No grid pass.

### 4. Richer collision / material properties

`MAT_PROPS` gains four columns (append-only; existing columns
untouched). Founder values make every new term an identity (×1.0 / +0),
so locomotion, digging, and carried objects behave exactly as today:

| material | friction | hardness | brittleness | durability |
|----------|----------|----------|-------------|------------|
| AIR | — | 0 | 0 | — |
| SOIL | 0.5 | 0.2 | 0.1 | — |
| SAND | 0.7 | 0.1 | 0.0 | — |
| CLAY | 0.4 | 0.4 | 0.2 | — |
| ROCK | 0.3 | 0.9 | 0.6 | — |
| WOOD | 0.5 | 0.6 | 0.3 | 0.8 |
| DEADWOOD | 0.6 | 0.4 | 0.7 | 0.5 |
| LEAF | 0.8 | 0.0 | 0.0 | — |
| WATER | — | 0 | 0 | — |
| BEDROCK | 0.3 | 1.0 | 0.0 | — |
| CHAR | 0.6 | 0.3 | 0.8 | 0.3 |

**How they feed existing systems (formulas, all with founder-zero
coefficients):**

- **Locomotion cost:** `cost × (1 + FRICTION_K·(friction − 0.5))`.
  Founder `FRICTION_K = 0` → today's uniform costs. Live 1.0: sand
  is expensive to walk, clay cheap — terrain you can feel in the
  hunger ledger.
- **Climb cost** on WOOD/steep-ROCK: same friction term via the
  surface material (locomotion.js `surfaceNormal` already returns the
  material context).
- **Fall impact:** `damage × (1 + IMPACT_K·(hardness_surface − 0.5))`.
  Founder `IMPACT_K = 0` → today's fall damage unchanged. Live 1.0:
  rock landings hurt, leaf-litter landings cushion.
- **Digging resistance** (connects to burrow integrity, process.js:136):
  `effectiveDigWork = digWork · (1 + DIG_HARD_K·(hardness − 0.5))`.
  Founder `DIG_HARD_K = 0` → current `digWork`/digPower behavior
  exactly. Live 1.0: clay fights back more than its digWork 5 suggests,
  sand less.
- **Object durability** (the existing `held` machinery): each carried
  object's material carries `durability`; on strike/use,
  `durability −= WEAR_K·(1 − durability)·impactSpeed`. At 0 the object
  breaks into a ground morsel (mass-conserving — the morsel exists in
  the world, same as the anatomical-injury §8 severed-part rule).
  Founder `WEAR_K = 0` → objects never break (today's behavior).
- **Brittleness:** thrown-object shatter chance on hard impact =
  `BRITTLE_K·brittleness·impactSpeed·hardness_surface`; founder
  `BRITTLE_K = 0` → never shatters (today). Shatter yields 2–3
  fragments (morsels — mass-conserving).

**No new verbs.** This track adds properties, not actions: digging,
climbing, carrying, throwing keep their verbs; the world just answers
with more texture.

---

## (c) Explicit NOT-do list

1. **NO water/fluid dynamics of any kind.** No Navier-Stokes, no flow
   fields, no liquid transport, no pressure solver, no water table
   coupling to erosion. Erosion here is *dry granular creep* — cells
   relocate downhill, nothing pours. The existing `tickWater`
   (process.js:235) is not read, not modified, not extended by this
   design. If a future design wants wet erosion, it is a separate
   proposal that must survive the standing ruling first.
2. **No RNG in the tick.** All new rules are pure functions of cell
   state + fixed sweep order. The one tie-break rule: west wins
   competing boundaries in creep; sweep order breaks all other ties.
   Pinned stateless sub-streams (`hash2`) are permitted for future
   stochasticity only — this design needs none.
3. **Mass conservation on every new flux** — the invariants:
   - Creep: `Σ count(mat=m)` constant ∀m (relocation only).
   - Weathering: total cell count constant (rock−1, soil+1 — stated).
   - Fire: heat is decaying, not conserved (stated, unchanged from
     today); spread deposits bounded by the 1.5 clamp.
   - Thermo: no mass involved; coreTemp is a 0..1 state, clamped.
   - Shatter/break: object mass → morsel mass, 1:1.
4. **Senses append-only, never renumbered.** This design adds zero
   senses (cold/heat 29/30, enclosed 45, creature proximity — all exist).
5. **No new action verbs.** Bask is already declared; its thermo effect
   is specified here, its port belongs to the M-track. Huddle and
   shelter are emergent from existing actions + senses, not verbs.
6. **Performance:** per-cell cost class unchanged — fire stays one
   8-neighborhood sweep + post-sweep apply; creep adds one O(cols)
   boundary pass; weathering piggybacks the rot sweep's cell visit;
   thermo is per-creature O(1); property lookups are table reads.
   No new O(n) grid passes beyond the single column-height pass.
7. **No welfare policy in the universe.** Heat illness and cold torpor
   run through natural selection like everything else (material-world.md
   §9: the universe is amoral; the keeper's benevolence is personal,
   not architectural). This design makes suffering legible; it does
   not intervene.

---

## (d) Execution probes (must pass before any "built" claim)

1. **Conservation probe.** Pinned seeds, 10k ticks, fire on, rot on,
   creep at live value, weathering off: `Σ count(mat=m)` per material,
   total `moist`, total `nutrient` — all bit-identical start→end.
   Then weathering on (50k ticks): total cell count bit-identical;
   rock→soil conversions counted and reported, nutrient total
   bit-identical. *Metric: field totals, integer counts, zero drift.*
2. **Fire-front probe.** Pinned seed, 1-wide line of DEADWOOD/LEAF in
   still air (`windU = 0`), uniform moist 0.1: ignite west end, measure
   front advance in cells/tick over 200 ticks — must be measurable and
   ≤ 1.5 (no flash-burn-across-the-world regression). Then: same
   setup at moist 0.7 → front advance < 10% of the dry run
   (moisture-gated). Then: `windU = +40` → downwind advance >
   upwind advance by ≥ 30% (wind-biased), both still ≤ 1.5 cells/tick.
   *Metric: advance rates in cells/tick, dry vs wet vs windy.*
3. **Smolder probe.** Ignite a WOOD cell, let heat decay below
   `SMOLDER_HEAT` with moist held 0.5 → assert `phase = 2`
   (smoldering). Dry to moist 0.1, add a heat pulse to 0.6 → assert
   `phase = 1` (re-flare) within 5 ticks; assert the re-flare tick is
   identical across two same-seed runs (deterministic). *Metric: phase
   transitions + re-flare tick, seed-pinned.*
4. **Erosion probe.** Constructed slope: surface drops 6 cells over 2
   column boundaries, SOIL, creep at live value. After 20k ticks:
   max boundary Δ ≤ `REPOSE_DH + 1`, and `Σ count(mat=m)` unchanged
   for every m. *Metric: max Δh in cells, material counts, zero net
   mass change.*
5. **Thermo probe.** Two creatures, identical except `fur` 0.0 vs 1.0,
   pinned cold snap (`weatherEvent = −0.3` for 2400 ticks): record
   `coreTemp` series each tick. Assert the low-fur creature's cooling
   rate (linear fit over the first 600 ticks) is ≥ 2× the high-fur
   rate, and survival differs (low-fur enters torpor, high-fur does
   not). Differential, not absolute — the probe passes on the *gap*,
   never on a magic temperature. *Metric: coreTemp series, fitted
   cooling rates, torpor entry ticks.*
6. **Founder-parity probe.** Full material suite 171/171 green with
   the new machinery present at founder defaults
   (`CREEP_K = 0`, `WEATHER_TICKS = Infinity`, `FUEL_K = 0`,
   `WIND_SPREAD_K` with `windU = 0` in test worlds, all `_K`
   property coefficients 0, char timing 30/30). Any red test = the
   design's parity claim is false — fix the constants, not the tests.
   *Metric: test count, 171/171.*

---

## (e) Honest numbers only

Every metric above is something the sim actually produces: integer
material counts, Float32 field totals, cells/tick advance rates, phase
integers, re-flare tick numbers, coreTemp float series, fitted cooling
rates, torpor entry ticks, test pass counts. No vibes, no "feels more
realistic" — if it can't be read off a probe, it isn't a claim.

---

## What's excluded and why

- **Wet erosion / sediment-laden flow:** would need the water field to
  push grains — that's liquid transport, and the standing ruling says
  no. Dry creep is the whole erosion story until the ruling changes.
- **Full char-combustion chemistry:** CHAR is a material id with a
  flammability number, not a pyrolysis model. The sim trades in
  behaviors, not molecules.
- **Radiative heat transfer between cells:** heat already spreads via
  the spread term; a separate radiation pass would double-count it.
- **New senses for thermo:** cold/heat (29/30), enclosed (45), and
  creature-proximity senses already cover bask/shelter/huddle. A new
  sense would be bookkeeping, not perception.
- **Fire as a creature damage source beyond the existing health
  ledger:** heat illness runs through health like everything else;
  no parallel damage track.

## Sharpest design decision

The char layer is *timing-neutral at founder defaults* (WOOD 30 + CHAR 30 = today's 60-tick WOOD burn): the new state is visible to the renderer and to evolution, but the parity ledger doesn't move — depth without breaking the 171-test contract.

## Biggest risk

Smolder re-flare + ember spread is a new positive-feedback path next to the old flash-burn bug (process.js:377–380): if EMBER_K or REFLARE_MOIST is tuned hot, a "dead" fire can resurrect across a whole forest — the fire-front probe's ≤ 1.5 cells/tick ceiling and the wet-front < 10% gate are the guardrails, and they must be run, not eyeballed.
