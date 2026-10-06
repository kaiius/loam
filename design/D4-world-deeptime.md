# D4 — Deep time: geology, climate drift, trophic webs, succession, coevolution

**Status:** design only (2026-10-06). No src/ changes. The builder assigns the release number.

**The brief** (BUILD_QUEUE.md, Joshua): *"World: deep time + ecology. Geology, climate dynamics past the existing ITCZ, food webs with real trophic pressure, succession, coevolution with the plant genomes. The world the creatures adapt to gets as deep as the creatures."*

## 0. Invariants (read first)

1. **Determinism is the load-bearing wall.** Same `(seed, size)` → bit-identical world-state hash over 100k+ tick runs. New tick-time state advances by pure arithmetic + stateless `hash2(seed, x, y, tick, purpose)` (process.js:48) — never a stream. New worldgen draws come from the worldgen stream only, in documented order.
2. **Append-only genetics.** Plant loci append to `PLANT_GENES` (sim/plantgenome.js:17); chromosome membership appends; existing indices never shift. Creature loci append to their families the same way.
3. **Biomes stay emergent.** The 8 label names are kept; labels are computed from climate, never placed (worldgen.js:600–640, `classifyColumn`). Climate drift may move labels at runtime through the existing dynamic path — trees don't move, labels do (worldgen-v2 §5, the established pattern).
4. **No new action verbs; senses append-only.** Deep time is a property of the world, not a new thing creatures do.
5. **Every claim in this doc is instrumented.** §5 lists the probes; a mechanism that can't be measured by a population series, an allele frequency, a state hash, or a fruiting schedule is not in this design.

---

## 1. Current mechanism (what exists today — file + line)

**Worldgen** (`src/material/worldgen.js`): `generateMaterialWorld(seed, size)` (line 767) runs a 7-stage seeded pipeline — elevation (fbm + tectonic ridges + rift basins + lake carves + edge pinning + box-blur erosion) → rasterize to materials + climate wave (`buildClimate`, line ~560; `rasterize`, line ~600) → 40 worldgen-time erosion passes (`erode`, line ~645, pure geometry, no draws) → water-table flood-fill (`fillWater`, line ~672) → grown flora (`growFlora`, line ~490: seed gap 9 cells, germination threshold 0.30, 56/32/16-iteration L-system growth, anti-floating orphan assert) → emergent labels (`buildLabels`/`classifyColumn`, lines 600–640) → viability gate (`checkViability`, line 693: G1 ≥44·size fruiting plants, G2 ≥1 lake, G3 ≥80% traversable, G4 spawn on soil, G5 ≥3 land labels). Draw order is load-bearing and documented at the file head (lines 8–19). Soil is 3–8 cells deep per column, then ROCK, with seeded CLAY lenses where moisture is high; bottom 3 rows are BEDROCK.

**Climate** (`src/material/weather.js`): the sky is a per-column field (T, vapor, cloud, soil moisture, windU; `createSky`, line 70) ticked every 20 material ticks (`tickMaterialWorldM2`, index.js:101). Drivers: diurnal (`timeOfDay`/`daySun`, senses.js), seasonal target on `YEAR_TICKS = 9600` (4-day years; weather.js:31) with `SEASON_AMP_MAX = 0.25` (weather.js:32), evaporation/condensation/rain budgets, vapor advection, a seed-pinned global wind vector that walks on the sky's own sub-stream (never the main stream), and `coupleToGrid` (weather.js:306) pushing column moisture/heat/wind into the grid. Accessors: `tempAt`, `moistureAt`, `windAt` (weather.js:76–98). The sky's stochasticity is stream-pinned (`sky.rng`, never `world.rng`).

**Plants** (`src/material/plants.js`): every plant carries a diploid genome (`attachPlantGenomes`, line 31) drawn from `sim/plantgenome.js` — 10 loci in two chromosomes (yield, fruitSize, interval, growthRate | bitterness, waterRet, coldTol, potency, heatTol, saltTol; heatTol/saltTol appended v0.18, indices stable), mutation 0.008/allele, phenotype = allele mean. Lifecycle ticks at the slow rate: `tickSeeds` every 10 ticks (wind advection + landing + germination, gated on `nutrient ≥ NUTRIENT_SPROUT_MIN = 0.08`, plants.js:147); `tickPlants` every 50 ticks (index.js:107): growth via the resumed L-system, drought/cold/heat stress accumulation, fruit regrow every plant-tick (4–5 fruit, capped at the variety maximum, plants.js:350–365), death by stress/age/fire. Fruiting draws down the ground cell's nutrient stock (`NUTRIENT_PER_FRUIT = 0.01`, process.js:32; plants.js:361). Seeds disperse three ways: wind drift, and endozoochory — `seedFromFeeding` (plants.js:64): a 35% stateless roll per fruit eaten, pollinator (beetle/flutter) outcrossing to the nearest fruiting neighbor, meiosis on a `(seed, plant, tick)` sub-stream.

**Nutrient cycling** (`src/material/process.js`, `corpses.js`): corpses rot into the nutrient field 1:1 mass-conserving (`NUTRIENT_PER_MEAT = 1.0`, corpses.js:61); deadwood rots to SOIL over `ROT_THRESHOLD = 1000` wet ticks depositing `DEADWOOD_NUTRIENT = 0.2` (process.js:441–457); nutrient diffuses slowly (`D_NUT = 0.0002`, process.js:45) and decays (`NUTRIENT_DECAY = 0.999`); baseline seeded at worldgen from column moisture (worldgen.js:757–762). Geophagy eats enriched ground — the mineral supply today is the nutrient field, not geology.

**Minerals**: `MINERAL_TYPES` (flint, quartz, clay, timber, stone, driftwood) lives in the platform track (sim/world.js:669) as static deposits — the design comments say creatures cannot use them yet. Loam has no mineral deposits at all.

**Trophic structure**: the Loam roster (material/species.js:18–32) spans grazers, two predators (jungle-cat, plains-runner), an omnivore (bear), a scavenger (vulture), pollinators, and a prey base (grub). Predation runs through the `bite` verb (material/actions.js:283). There is **no population coupling**: `LOAM_CAPS` (species.js:34) are spawn-time ceilings, not feedbacks. Prey eaten do not become scarcer in any way that changes predator behavior; plants eaten regrow on a fixed schedule regardless of herbivore density.

**The steady-state problem**: worldgen is a one-shot event. The seasonal cycle is perfectly periodic (no drift, no trend), there is no geology (ROCK never becomes SOIL — the soil stock is fixed except by digging/piling), replacement is demographic rather than directional (no succession axis), and trophic levels don't press on each other. The world at tick 100,000 is the world at tick 0 plus noise. That is what this design ends.

Time anchors for the scales below: material tick = the base unit; plant-tick = 50 material ticks; sky-tick = 20; `TICKS_PER_DAY = 2400` (senses.js:22); year = 9600 ticks (4 days); plant lifespan = 1200–2000 plant-ticks = 60k–100k material ticks. Deep time in this design means 10⁴–10⁶ ticks (days to ~100 years).

---

## 2. The concrete deepening

### 2.1 Geology: strata, weathering, mineral veins

**Representation.** Two new world-owned per-cell arrays, sized with the grid, zero-cost when unused:

- `g.strata` (Uint8): assigned at worldgen for every subsoil cell (below the soil layer, above BEDROCK). Four types, drawn from the worldgen stream in the documented draw order (new draw block: after the clay-lens draws, before growth — growth is stateless-hash only, so insertion is safe):
  - `0` — undifferentiated sediment (the default)
  - `1` — granite basement: flint/quartz association
  - `2` — limestone: stone association
  - `3` — shale: clay association
  The draw is column-coherent: one strata type per column-depth band per column (2–4 bands deep), seeded by `(gen)` so strata form lens-like regions, not confetti. Erosion (worldgen-time) and the viability gate are untouched — strata ride on materials that already passed the gate.
- `g.vein` (Uint8): assigned on a subset of ROCK cells at strata *boundaries* (where `strata[c][r] ≠ strata[c][r+1]`) — the geological story is "minerals concentrate at contacts." Tags: `1` = flint, `2` = quartz, `3` = stone (the keys already exist in `MINERAL_TYPES`, sim/world.js:669). Vein cells keep `MAT.ROCK` — the renderer and physics don't change; the tag is read by digging/geophagy only.
- `g.weather` (Uint8): the weathering scalar, zeroed at worldgen. Lives on ROCK cells adjacent (4-neighborhood) to SOIL, SAND, CLAY, or AIR.

**Weathering rule (tick-time, deep time).** Every 200 material ticks, the weathering pass runs over ROCK cells with a weatherable neighbor (amortized: all columns each pass — 480 column checks at 1×, trivial):

```
weather[i] += WEATHER_STEP        // WEATHER_STEP = 1
if weather[i] >= 255:
    mat[i] = MAT.SOIL             // the rock becomes soil, in place
    moist[i] = neighbor moisture mean
    nutrient[i] = 0               // fresh soil is poor — it must be earned
    weather[i] = 0
    // mass-conserving: the cell above (AIR) is unchanged; no teleportation.
```

At 1 step per 200 ticks, one conversion takes **51,200 ticks (~21 days)** per cell — honest deep time, visible in the 100k-tick probe as a slow soil-deepening front, never as a visible event. Fresh-weathered soil starts nutrient-poor (0 < 0.08 germination gate), so weathering opens *future* growing ground rather than instant farmland — the geology→ecology handshake.

**Mineral veins → geophagy's geological story.** Today geophagy pays on the nutrient field (process.js:441). New: when a creature digs a `vein[i] > 0` cell, the carried soil item gains a mineral tag (flint/quartz/stone per the vein), and the geophagy payout on that cell reads the vein's mineral type — flint/quartz pay in the existing mineral ledger, stone pays as grit. The vein tag is consumed on dig (set to 0) — deposits deplete, matching the platform track's "depleted deposits stay labeled" honesty. No new verbs: `dig` and `geophagy` already exist.

**Must not break:** the erosion worldgen pass (strata assigned after it), the orphan assert (weathering never touches WOOD/LEAF), `MAT` ids (untouched), the frozenBiome control (the weathering pass skips its conversions' *scalar* side-effects under `mw.frozenBiome`, same pattern as tickRot, process.js:455).

### 2.2 Climate dynamics past the ITCZ

Three additions, all entering `tickSky` as modifiers on the existing `target` (step 1) and `rain` (step 3) — the machinery (advection, evaporation, coupleToGrid) is untouched.

**(a) Thermal-position seasonal amplitude.** Replace the flat `seasonAmp = 0.4` default (weather.js:70, 84) with a deterministic function of the worldgen climate field:

```
seasonAmp[i] = clamp(0.15 + 1.4 * |baseT[i] - 0.5|, 0.15, 0.85)
```

Mid-latitude-equivalent columns swing hardest; the thermal equator and the cold pole swing least — the Earth pattern, derived from generated fields, not painted. `baseT` is pinned at worldgen (already stored, weather.js:83).

**(b) Long-period drift (the millennial scalar).** A whole-world baseline drift, period ~1M ticks (~104 years), plus a weaker 4M-tick component:

```
Tdrift(tick) = 0.06 * S(2π * tick / 1_000_000)
             + 0.03 * S(2π * tick / 4_000_000 + φ(seed))
Mdrift(tick) = -0.5 * Tdrift(tick)          // warm phases run drier
```

`S` is the same sine the sky already uses (`seasonSin`, weather.js:134 — tick-time use is established; the no-transcendentals rule is worldgen-specific, for cross-engine bundle parity). `φ(seed) = hash2(seed,0,0,0,P_DRIFT) * 2π` pins the phase. Applied as `target += Tdrift` in step 1 and `soil` relaxation target `+= Mdrift` in step 3. Amplitude 0.06 T-units ≈ 2.7°C — enough to move biome-label boundaries over deep time (the classifier bands are ~0.13 T-units wide, worldgen.js:606), not enough to flip the world. This is the mechanism by which labels genuinely migrate over a long run — the "trees don't move, labels do" pattern made temporal.

**(c) Extreme pulses — scheduled, not random.** Each year `y = floor(tick / 9600)` gets a deterministic schedule from stateless hashes — no stream, no RNG, fully testable:

```
r = hash2(seed, y, P_PULSE_YEAR)          // in [0,1)
if r < 0.15:                              // ~15% of years carry a pulse
    type  = hash2(seed, y, P_PULSE_TYPE) < 0.5 ? DROUGHT : FROST
    start = floor(hash2(seed, y, P_PULSE_START) * (9600 - 1200))
    len   = 600 + floor(hash2(seed, y, P_PULSE_LEN) * 600)   // 600–1200 ticks
    while tick in [y*9600 + start, +len):
        DROUGHT: rain *= 0.2, evap *= 1.5
        FROST:   target -= 0.15 (≈ −6.75°C)
```

A pulse year is knowable in advance from `(seed, y)` — the probe can *predict* it, not just observe it. Droughts stress plants (`moist < 0.12` stress gate, plants.js:319), frosts stress cold-intolerant ones; both feed the succession engine (§2.4) by clearing patches.

**Must not break:** the annual-mean-T stability the v0.27 exit probe verified — drift and pulses integrate to ~zero over the 4M-tick cycle by construction (symmetric S, symmetric pulse-type coin); the builder re-runs that probe. The `frozenBiome` control pins all three additions at zero.

### 2.3 Food webs with real trophic pressure

The verbs exist (bite, eat, forage); what's missing is **coupling made measurable**. This design does not impose Lotka–Volterra equations — it builds the instruments that let the coupling *emerge from the verbs* and be verified:

**The census.** `mw.ecology = { day, series: { speciesKey: [n0, n1, …] }, kills: { predKey: { preyKey: n } } }`, appended every 2400 ticks (one "day"). Population counts come from the existing `countSpecies` (species.js:52). The kill ledger increments in the `bite` verb's kill path (actions.js:283) — two lines, no behavior change. This is the primary-production-to-apex data series: fruit regrow rates (plants.js:350) → herbivore counts → predator kills → predator counts.

**Density-dependent gates (the actual pressure):**

1. **Plant release (bottom-up).** Already half-present: fruit regrow draws down cell nutrient (`NUTRIENT_PER_FRUIT`, plants.js:361), so heavy foraging depletes the ground cell and the plant stops fruiting — a real carrying capacity at the plant level. New: the plant *stress* accumulator (plants.js:315) gains a foraging-pressure term — if a plant's crop is stripped to zero twice in one plant-tick, `stress += 1`. Overgrazed plants die younger; the plant population feels the herbivores.
2. **Predator recruitment (top-down).** When the reproduction port lands (M3-deferred), predator recruitment rate reads the prey census: `recruit_p ∝ kills_prey / (prey_census + 1)` — predators breed on success, starve on failure, through the existing chemistry (hunger drives already exist; this only gates *births*). Until reproduction lands, the census + kill ledger are the shipped instruments — the coupling is observable before it is closed.
3. **Herbivore pressure on plants (the cascade link).** Fruit-per-plant caps (plants.js:352) mean a fixed primary-production ceiling; herbivore irruption (grub caps are 24, beetle 40 — species.js:34) can hold every plant at zero crop. The measurable cascade: remove predators → grub series rises → mean crop-per-plant falls → plant stress deaths rise. All four series exist in the census + plant records; no new state.

**The classic cascade, stated as equations the probe checks** (not as imposed dynamics):

```
predator_removal  →  d(grub)/dt > 0   (census series, grub)
                  →  mean_crop_per_plant ↓  (plant records)
                  →  plant_stress_deaths ↑  (killPlant causes, plants.js:388)
```

The design's job is that these four quantities are recorded on the same clock. The sim's job is the rest.

**Must not break:** `LOAM_CAPS` semantics (ceilings, not targets — unchanged), the bite verb's damage path (ledger is additive), the carrying-capacity fruit math the 2026-10-03 fix established (~2.5/tick effective for the roster).

### 2.4 Succession: pioneer → climax on the plant genome

**New loci (append-only).** Appended to `PLANT_GENES` (sim/plantgenome.js:17) as indices 11–13 — existing ten never shift — and to a **third chromosome** `['colonizer', 'longevity', 'tannin']` in `PLANT_CHROMOSOMES` (plantMeiosis iterates the array, so appending a chromosome is safe):

| # | key | founder | phenotype effect |
|---|-----|---------|------------------|
| 11 | `colonizer` | 0.5 | **pioneer axis.** Germination threshold becomes `NUTRIENT_SPROUT_MIN · (1 − 0.75 · colonizer_pheno)` — high-colonizer seeds sprout on bare, poor, freshly-weathered ground (threshold → 0.02); low-colonizer seeds need enriched ground. |
| 12 | `longevity` | 0.5 | **lifespan axis.** `maxAge = (1200 + growthRate·800) · (0.4 + 1.6 · longevity_pheno)` plant-ticks (plants.js:373). Pioneers live ~40% of baseline; climax live ~2×. |
| 13 | `tannin` | 0.2 | **defense axis** (§2.5). |

**The succession engine (no new processes — the existing ones compose):**

1. **Disturbance clears a patch.** Fire (`strikeIgnite`, weather.js:288; drought years raise ignition odds via the T>0.8 priming, weather.js:370), digging (the `dug` flag, grid.js), or a corpse pulse (nutrient spike, corpses.js:61). `killPlant` converts wood → DEADWOOD, leaves → AIR (plants.js:388).
2. **Pioneers colonize.** High-`colonizer` seeds germinate on the cleared, nutrient-poor ground where climax seeds can't (their effective threshold is up to 4× lower). Fire-cleared ground is the textbook case: ash + bare soil.
3. **Pioneers enrich.** Pioneers live short (low `longevity`) and die; their deadwood rots to SOIL + 0.2 nutrient (process.js:456). Each pioneer generation ratchets the patch's nutrient upward — the enrichment is mass-conserving and recorded.
4. **Climax displaces.** As nutrient crosses the climax germination threshold, low-`colonizer`/high-`longevity` seeds establish. They live ~5× longer than pioneers, so over deep ticks their seed rain dominates the patch's germination sites. The patch's `colonizer` allele mean falls, `longevity` rises — **the measurable succession signal**, per patch-age cohort, from allele frequencies alone. No patch bookkeeping needed: cohort = plants germinated within a window on cells in the burned/dug region.

The trade-off that makes displacement real (not just asserted): pioneers pay for fast colonization with short lives and poor competitive nutrient economy — the `NUTRIENT_PER_FRUIT` drawdown (plants.js:361) is flat per fruit, so a long-lived climax plant amortizes its establishment cost over 2× the fruiting lifetime. Selection does the rest; the design only guarantees the axes exist and the disturbances happen.

**Must not break:** germination gating for existing plants (founder `colonizer = 0.5` → threshold × 0.625 = 0.05 — the founder-parity probe, §5.6, verifies the 171/171 suite stays green at founder means; if it shifts germination materially, the founder value is tuned, not the formula), `maxAge` bounds (founder `longevity = 0.5` → ×1.2 — inside the current 1200–2000 band).

### 2.5 Coevolution: the arms race made allelic

**Plant side.** The `tannin` locus (new, founder 0.2) plus the existing `bitterness` locus (plantgenome.js:26, founder 0.3):

```
fruit_nutrition ×= (1 − 0.5 · tannin_pheno)        // parallels bitterness exactly
gut_seed_survival = 0.35 · (1 − 0.3 · tannin_pheno) // seedFromFeeding's 0.35 roll (plants.js:76)
```

Tannin is the plant's move: defended fruit is worth less to the eater, and fewer of its seeds survive the gut. High foraging pressure selects for it — the seeds that survive are disproportionately the defended ones.

**Herbivore side.** One appended creature locus — `detoxTol` (detoxification tolerance), founder 0.2, appended to the metabolic family of the creature genome (append-only; indices stable). Phenotype effect: the herbivore's realized loss from plant defenses is multiplied by `(1 − detoxTol_pheno)`:

```
effective_defense_loss = (tannin_loss + bitterness_loss) · (1 − detoxTol_pheno)
```

Under sustained high-tannin forage, herbivores with higher `detoxTol` extract more net nutrition per bite → the locus climbs. The plant's counter-counter: `tannin` keeps climbing while foraging pressure persists — the Red Queen, as two allele trajectories.

**The measurable coevolutionary signal** (the only honest one): per-generation census of mean `tannin` (plants, by patch) and mean `detoxTol` (herbivore species) over ≥100k ticks. The probe (§5.5) checks that both series move significantly off founder with a positive cross-correlation at a lag — the plant leads, the herbivore follows. The design does **not** assert the outcome; it asserts the loci, the couplings, and the instruments. If the trajectories don't move, that's a finding about the selection pressures, reported honestly.

**Must not break:** `seedFromFeeding`'s outcrossing logic (the survival multiplier applies after the roll), the fruit nutrition math the carrying-capacity fix depends on (founder `tannin = 0.2` → 10% nutrition haircut at founder means — inside the existing bitterness variance), creature genome indices.

### 2.6 Timescale honesty (what runs when)

| Scale | Ticks | Processes | Must not break |
|-------|-------|-----------|----------------|
| Tick | 1 | slump, fire spread, rot counters, water | existing material processes (process.js) — untouched |
| Sky-tick | 20 | climate target/rain/pulses/drift, coupleToGrid | annual-mean-T stability (v0.27 exit probe) |
| Plant-tick | 50 | growth, stress, fruit regrow, corpses | fruit provisioning math (2026-10-03 carrying-capacity fix) |
| Day | 2,400 | census append, diurnal | — |
| Season | 9,600 | fruiting-schedule shifts, pulse schedule | seasonal fruiting gates |
| Generation | 60k–100k | plant turnover, succession steps | viability gate G1 (fruiting count) |
| Deep time | 200k–1M+ | weathering front, climate drift, label migration, coevolution | determinism hash (§4), 171/171 suite |

Weathering (51k ticks/conversion) and drift (1M-tick period) are the slowest processes in the sim by 2–3 orders of magnitude — that separation is what makes them *deep* time rather than slow weather.

---

## 3. What's excluded and why

- **No fluid-dynamics climate.** Climate is scalar fields + deterministic functions of `(seed, tick)`, never an advective flow solver. (Note: material-world.md §8 ruling 5 ordered "full physics and fluid dynamics" for *water* — the grid's existing water-depth process in process.js stands; this exclusion is about the *climate model*, which stays scalar. If the water ruling ever grows a flow solver, these climate functions feed it as boundary conditions, they don't become it.)
- **No hand-placed biomes, ever.** Strata are drawn per column from the stream; labels are computed. A designer never decides "granite goes here."
- **No new action verbs, no new senses for this.** Deep time is world-side. (If later work needs a `strataSense`, it appends — not this design.)
- **No imposed population equations.** The trophic web is verbs + instruments, not Lotka–Volterra with tuned coefficients. Imposed cycles would be theater; emergent ones are the experiment.
- **No cross-engine transcendental guarantees beyond the existing ones.** Tick-time uses sine exactly where the sky already does (`seasonSin`); worldgen keeps the no-transcendentals discipline (worldgen-v2 §5). The determinism probe is same-seed/same-code — the honest scope.
- **No weathering of WOOD/LEAF, no touching BEDROCK.** Geology works on ROCK at soil interfaces. The anti-floating assert and the world floor are sacred.
- **No creature-genome rewrite.** One appended locus (`detoxTol`). The creature treasure (37 versions of systems) is not reopened for this.

---

## 4. Determinism contract

Same `(seed, size)` → identical `worldStateHash(mw)` at any tick, across runs:

- **Worldgen additions** (strata, veins) draw from the worldgen stream in one documented new draw block (after clay lenses, before growth). Draw order documented in worldgen.js's header comment, never reordered. `mixSeed` salt unchanged.
- **Tick-time additions** use no stream and no `Math.random`: weathering advances by fixed increments; drift/pulses are pure functions of `(seed, tick)` via `hash2` (process.js:48); the census appends on `tick % 2400 === 0`.
- **The hash** (builder implements, probe uses): FNV-1a fold over `g.mat` (full), `g.moist`/`g.nutrient`/`g.strata`/`g.vein`/`g.weather` (full — 52,800 cells × 6 arrays at 1× is a millisecond-scale fold), sky columns (T, vapor, cloud, soil, windU as Float32 bits), plant allele means quantized to 1e-6, census series lengths + last values, `mw.tick`. Rendered as 16 hex chars in logs.
- **The frozenBiome control** stays meaningful: under `mw.frozenBiome`, drift/pulses/weathering conversions' scalar side-effects are skipped (same pattern as tickRot, process.js:455) — the control world is the old steady state, and the parity probe compares against it.

---

## 5. Execution probes (must pass before any "built" claim)

All probes run headless (node), all metrics are sim-produced. **No vibes.**

**P1 — Deep-time determinism.** Same seed, 100k-tick run, twice → identical `worldStateHash` at every 10k-tick checkpoint. 3 seeds. *Fails if:* any checkpoint hash differs. (Catches stream leaks, per-tick RNG, unordered iteration.)

**P2 — Succession.** Ignite a fire-cleared plot (or use a scheduled drought-pulse year, predicted from `(seed, y)` per §2.2c). Track the `colonizer` and `longevity` allele means among plants germinated on the cleared cells, in 10k-tick cohorts, over 100k ticks. *Passes if:* cohort `colonizer` mean rises ≥0.15 above the pre-fire baseline in the first 20k ticks, then falls back toward/below baseline by 80k ticks while `longevity` mean rises ≥0.1 — the pioneer→climax sequence, measured in allele frequencies, not asserted.

**P3 — Trophic cascade.** Control run vs predator-removal run (predator spawn caps zeroed, everything else identical seed): 60k ticks. *Passes if:* grub census series diverges upward (≥2× control by tick 40k), mean crop-per-plant falls (≥30% below control), and plant stress-death count rises — the classic cascade in four recorded series. *Fails if:* the series don't move — which would mean the verbs don't actually couple, an honest finding that kills the "real trophic pressure" claim.

**P4 — Climate.** Compare fruiting schedules (fruit regrown per plant-tick, binned by season phase) between a run with drift+pulses on and the `frozenBiome` control, same seed, 40k ticks. *Passes if:* seasonal amplitude of fruiting differs measurably AND the drift run's annual-mean fruiting shows a nonzero slope over the run (the millennial scalar is doing work), while the control's doesn't.

**P5 — Coevolution.** 150k-tick run under sustained foraging pressure. *Passes if:* mean plant `tannin` moves ≥0.1 off founder AND mean herbivore `detoxTol` moves ≥0.1 off founder, with positive cross-correlation (plant leads, lag > 0). *Honest failure mode:* if only one moves, the design reports which selection pressure is missing — it does not tune coefficients until both move.

**P6 — Founder parity.** All new machinery at neutral settings (drift amplitude 0, pulses off, weathering step 0, new loci at founder means) → the full material test suite (171/171) green, viability gate G1–G5 green on 10 seeds, and `worldStateHash` at tick 0 identical to the pre-change build. *This is the gate that protects the proof.*

**P7 — Geology visibility.** 100k-tick run: count ROCK→SOIL weathering conversions (must be >0 and <5% of subsoil cells — deep time, not terraforming), count vein cells at worldgen (>0 per world), and verify at least one dug vein cell yields a mineral-tagged carry in a scripted dig probe. Soil depth per column (surface-to-first-ROCK) must be non-decreasing vs tick 0.

---

*Design-track note: this doc specifies mechanisms, formulas, state, and instruments. The builder owns: release number, exact constant tuning (P6 constrains it), the `worldStateHash` implementation, and the honest reporting when a probe fails.*
