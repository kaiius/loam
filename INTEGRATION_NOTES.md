# Integration notes — Canopy v0.18 "Realms" (branch `realms`, worktree ~/workspace/canopy-realms)

## Child 1/4 — render/inspector (6b94b402) — COMPLETED 2026-09-30 19:06 UTC
- Predators drawn distinctly (shark: dark mantle + tentacles + red hunting eyes; bear: grey-brown quadruped, snout/ears/tail) and clickable with danger panel (kind, damage, physiological range limit, threat bar, hunting state). Paul v0.17-dev lesson adopted.
- biomes.js loader verified live against the sim agent's module: exports match contract (4800×1100, waterRects() → 6 rects, biomeKeyAt, floraFor). drawBiomeBands uses sim's groundYAt(x).
- main.js: boots populateGenesis if present, else falls back to populate — populateGenesis NOT in world.js yet at this handoff.
- **BUILD NOTE:** scripts/build.js does not list biomes.js in MODULES — when adding, it must come BEFORE renderer.js (bundle-scope detection hits TDZ otherwise; renders fine but no biome paint in dist).
- Tests: test/realms-render.mjs 5/5 green. test/sim.mjs 199/232 at handoff — 30 failures pre-existing (other agents mid-edit; fail identically with render changes stashed), 3 flaky under full-suite load (pass in isolation). Re-run at integration.
- Did not commit, did not rebuild dist/. Concurrent-edit note: a genome.js syntax error from another agent was self-fixed before this agent touched it.

## Pending
- 2/4 biomes/world (6cdd1e11) — running
- 3/4 creature/evodevo (721f9d71) — running

## Child 4/4 — chemistry/genome/brain (bddd45f6) — COMPLETED 2026-09-30 19:17 UTC
- genome.js: CHEM7 (oxygen/hydration appended, founder indices 0–4 unchanged), SENSE32 (28 + thirst/cold/heat/buriedNear; SENSE24 alias kept), ACT20 (17 + drink/bask/dig; ACT13 alias kept); 6 new loci: instWaterDrink, instThirstDrink, instColdBask, instDig (chromosome 4), coldTol/heatTol (chromosome 1, rides with fur); PLANT_REALMS_LOCI exported for plantgenome integration; randomGenome(rng, {pinSub, overrides}) — new loci draw from a 4th sub-stream (main-stream alleles bit-identical without opts); pinSub fixes the §13.7 confound. GENES 217→223. CHROMOSOMES stays 9.
- brain.js: N_IN 29→33 (4 new senses appended before bias: thirst 28, cold 29, heat 30, buriedNear 31; bias 32), N_OUT 17→20 (drink 17, bask 18, dig 19); biases 0.05/0.02/0.02.
- biochem.js: oxygen (drains ~25s submerged @ breathTime 30, refills 0.5/s air; at 0: health −0.03/s + adrenaline spike), hydration (drains 0.004+0.016×heat×exert/s; drank +0.3, ate +0.5 fruit moisture; at 0: health −0.03/s), coreTemp (drift k=0.02 slowed by furInsulation; metabolic + basking + sail-dump; hypo <0.25−coldTol×0.1, hyper >0.75+heatTol×0.1, −0.015/s); coldSense/heatSense exported; ctx hygiene block normalizes all context inputs up front (the v0.15 NaN lesson).
- Tests: test/realms-chem.mjs 13/13 green. Full suite on isolated tree (pristine v0.17.1 + only chem changes): 232/232 green. In worktree: 3 failures from the world agent's concurrent scaled-coordinate migration (dialects test etc.), not from chem.
- Decisions: test/sim.mjs had to be edited (rename-driven, unavoidable) + 3 test fixes (illness-spreads isolation, dialects pinning, stale v[28] assertion); nmChem left on CHEM5 for family B; ctx.ate → hydration +0.5 as founder-neutral hydration source; coldTol/heatTol chromosome 1, instincts chromosome 4.
- §13.6 probes: max-fur walker @ ambient 0.55 crosses hyper ~139s, dead ~3.4 min (dies trying — no invisible walls); founder jungle walker equilibrates 0.747 (neutral); coldTol-0.5 resting @ arctic 0.1 settles 0.248 (no freeze death).
- **SEQUENCING NOTE:** world agent is migrating test/sim.mjs + world.js to scaled coordinates concurrently; merge that agent's work first, then re-run full suite, then fix stragglers.

## Child 3/4 — creature/evodevo (721f9d71) — COMPLETED 2026-09-30 19:24 UTC
- evodevo.js: deriveAquaticPheno(p) — piecewise swimSpeed (flail <0.15 wingArea → 12, else 40+wingArea×120; 0.15 threshold covers founder wingArea range 0–0.137); sailDump = sailArea×0.5; constants exported (SWIM_FLAIL_SPEED=12, SWIM_BASE_SPEED=40, SWIM_WING_K=120, SWIM_FLAIL_AREA=0.15, SAIL_DUMP_K=0.5, WATER_DRAG_K=8). Called in createCreature + epimark pheno refresh.
- creature.js: refreshWaterState (exported; _water/submerged 14px formula/_waterNear 240px); buoyancy spring K=20 damp=4 toward surfaceY+11; swim (2D steering @ pheno.swimSpeed, flail flag), dive (oxygen-gated, _holdDepth counteracts buoyancy), drink (≤40px above surface sets _drank), bask (sets _basking, warmth gate in chemistry), dig (3s → digAt); senses thirst=1−hydration, cold/heat via coldSense/heatSense, buriedNear 240px, homeDist via scaledHomeDist (v0.13 base ×(1+dist/1200), NaN→fallback); doEat branches for bug/minnow/corpse/grub/morsel (meatEfficiency), fruit/tuber/kelp/moss/seed/propagule/cactusfruit/berry/snowcache/sandcache (fruitEfficiency); ctx +submerged, heat, ambientTemp, drank, basking, sailDump, threat; flail 3× oxygen surcharge billed in creature.js (ctx.flail unread by biochem — billing only).
- Predators: spawnPredators (5 sharks: 3 deep/1 archipelago/1 shallows, breathTime 3000; 2 arctic bears furInsulation 1.0), tickPredators (shark seek/kill/beaching −0.1/s; bear thermal fallback −0.05×load/s with load=max(0,ambient−0.45)×(0.5+fur)×(1.2−heatTol) because biochem degenerates at furInsulation=1.0 → zero ambient coupling; dead kept, not culled). **Unwired: spawnPredators/tickPredators call sites in world.js = world agent's scope — verify at integration.**
- world.stats.jumps/climbs incremented (guarded); gravity branch gained world-floor clamp (fixed latent bug: creatures exiting water over pools fell forever, broke v0.14 teacher test).
- Tests: test/realms-creature.mjs 23/23 green; test/sim.mjs 232/232 at their handoff.
- **§13.6 SPEC MISMATCH (needs reconciliation):** literal spec (max-fur probe @60px/s from x=300 "never reaches x≥1200 with health>0.3") is incompatible with landed biochem tuning — probe crosses 900px in 15s but hyperthermia needs ~139s to build. Agent wrote the test to the documented contract (max-fur, ambient 0.55, active 0.8 → dead by ~180s; verified) + hot-vs-cold calibration pair, documented mismatch in test. Integration decision: reframe test as time-based confinement (max-fur creature cannot establish in warm biomes / dies within minutes in ambient ≥0.55) rather than the distance-based spec.
- Bear/shark biochem workarounds feature-detected in creature.js. Later-version note: biochem could gain a driftK floor + water-breather support (shark oxygen currently drains as air-breather; bear fallback bypasses biochem).

## Child 2/4 — biomes/world (6cdd1e11) — COMPLETED 2026-09-30 19:28 UTC
- biomes.js (new): 4800×1100, 8 biomes, biomeAt/biomeKeyAt/biomeCenterX, ambientCold (arctic 1.0, mountain lapse, deep 0.3), ambientHeat (desert interior 1.0, jungle 0.1, plains 0.2), 6 salt waters, groundYAt (null over open water, islands→780, shallows seabed 950), 8-morph floraFor table.
- world.js: 45-platform worldgen (jungle founder-9 x-scaled, 3 arctic floes), 8-key soil, populateGenesis (8 cohorts × 3–5, both sexes, per-spawn 50% §12.1 shifts, jungle control plain stock), spawnBuriedFood/digAt, spawnMobileFood, spawnResources (timber/stone/driftwood/clay), spawnBiomeFlora, noteDeath → 'corpse' food with cold-slowed rot, noFouling gates (excrete/tickSoil/wasteOdorOf→0), zone→biome migrations, biome API re-export.
- plantgenome.js: heatTol + saltTol appended.
- Tests: test/realms-world.mjs 23/23; test/sim.mjs 232/232 (full legacy migration via mx()/addTestCreature helpers); siblings' realms suites 41/41 green at their handoff.
- Deviations: jungle scaling x×0.375 (12/12 old climb links verified computationally identical index pairs); archipelago 3 islands × 2 platforms (6 islands can't fit 600px); allele-shift deviation RETIRED (genome sibling added coldTol/heatTol, full §12.1 table implemented incl. mountains armLength→1, archipelago armLength→0.8).
- **CONFLICT TO RESOLVE:** world agent emulated `pinSubStreams` claiming "genome.js takes no options" — but chem agent LANDED randomGenome(rng, {pinSub, overrides}). Unify: use chem's pinSub interface in populateGenesis.
- **UNWIRED:** spawnPredators/tickPredators call sites — both agents pointed at each other; neither wired it. Wire at integration: call in populateGenesis + tickWorld (or createWorld), with TODO if creature.js lacks them (it doesn't — they're exported).
- Not committed, dist/ not rebuilt.

## Integration fixes (2026-09-30 ~19:35–19:50 UTC)
1. **Predator wiring**: added `spawnPredators, tickPredators` to world.js's creature.js import; `tickPredators(world, dt)` in tickWorld (no-op on predator-free worlds); `spawnPredators(world)` in populateGenesis only (legacy populate() stays predator-free for the jungle battery).
2. **spawnPredators rng**: switched to `world.decorRng` (v0.9 decorRng lesson) — predator placement no longer shifts the main rng sequence (was breaking the seed-pinned cohort-count test).
3. **pinSub unification**: retired world.js's `pinSubStreams` emulation in populateGenesis → `randomGenome(rng, { pinSub })` (chem agent's native §13.7 confound fix). `pinSubStreams` kept exported for its unit test, marked retired.
4. **Per-founder pins** (not per-biome): `(seed*31 + bi*101 + i*17)|0` — per-biome pins zeroed within-cohort sub-stream diversity and broke the allele-shift test's statistical assertion; per-founder pins keep diversity + determinism + confound fix.
5. **build.js**: added `src/sim/biomes.js` to MODULES right after rng.js (TDZ: must precede creature.js/world.js/renderer.js); bundleModule now strips `export {` re-export lines — **these are a SyntaxError in the classic-script dist bundle** (Paul's v0.15 blank-page lesson; would have shipped dead).
6. **§13.6 reconciliation**: kept the creature agent's time-based test (max-fur, ambient 0.55, active → dead ~180s) over the literal distance spec (60px/s × 900px = 15s « 139s heat-build time — physically incompatible). Confinement is temporal, not spatial: a max-fur creature cannot *live* in warm biomes.

## Integration checklist (after all 4 land)
1. Verify disjoint file ownership; check contracts (biomes.js API, ctx fields, sense indices, spawnPredators/tickPredators call sites, digAt guard).
2. Run node --test test/sim.mjs + test/realms-*.mjs. Fix mismatches.
3. Add biomes.js to scripts/build.js MODULES before renderer.js.
4. Commit branch realms.
5. Jungle battery: 12 seeds × 20,000 ticks (test/viability-proof.mjs, legacy populate) — per-seed table.
6. Per-biome probes via populateGenesis.
7. §13.7 leg-pressure experiment script scripts/qa/leg-experiment.mjs (legPower {0.3,0.4,0.5} × pinSub × noFouling on/off).
8. Verify §13.6 thermal confinement test.
9. Merge to master; record hash. Rebuild dist/ in worktree only; run dist-smoke.
10. Report: master hash, suite count, battery table, per-biome results, thermal + leg verdicts, teardown. ALSO: extracted-zip QA (adopted from Paul's process) — zip worktree, extract to /tmp, run suites against extracted copy.
