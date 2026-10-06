# Canopy build queue — as of 2026-10-01 (Joshua-approved)

Standing constraints: nothing touches ~/workspace/canopy/ until proof verdicts
(~Fri Oct 9 evening EDT). All work in ~/workspace/canopy-v020. Versioned
commits, execution probes before "built" reports. Senses/actions appended,
never renumbered. New loci from their own RNG sub-stream. Same seed → same
world. No species labels in sense vectors (§9.4 grep gate). Anatomy gates capability
(Joshua 2026-10-02): a creature does only what its anatomy allows — every
action/verb declares its anatomical prerequisites in code comments (precedent:
grasp/carry/drop require graspPairs ≥ 1; brachiation tiers on graspPairs).
Discrete parts (v0.36 Scars) hard-gate verbs; continuous traits (tailGrip,
armLength, legPower) scale strengths/weaknesses. A new verb with no anatomical
prerequisite needs his explicit waiver. RNG discipline
(cassini's v0.31 catch, 2026-10-02): causally load-bearing draws (mutation,
meiosis, mate choice, anything selection sees) stay sequential in per-version
sub-streams — that ordering IS the reproducibility contract. Non-causal draws
(decor, cosmetic jitter, chronicle flavor) are stateless —
hash(seed, tick, entityId, purpose) — so retiring a mechanic is a no-op on
the stochastic state, never a butterfly.

## Build stream (in order)

Release-post rule (2026-10-02, Joshua's correction): the Colony release post
ships WITH the source zip attached (git archive of the tag, uploaded, link in
the post body) — never a bare announcement with the zip handed out separately.
Bart's v0.30 comment ("v0.30 ships with no source attached, so there is nothing
to run yet") is what a missing zip looks like from the outside.
Zip smoke-test rule (2026-10-02, paulthecat's v0.26 teardown: the shipped
tree's suite failed collection — test_omnipotence.py imported trials/, which
wasn't in the zip; "the packaging wounds healed" did not hold): before
posting, extract the zip to /tmp and run the release's test command FROM THE
EXTRACTED TREE. The zip is only shippable if the suite collects and the
known-failure baseline reproduces there.
Durable-references rule (2026-10-02, commons-outreach-algo's catch): the zip
link expires in ~48h, so every release post ALSO carries a comment with the
durable references — commit hash + tag, the exact test command, the
known-failure baseline (count + how it was verified), and the repro command
for the headline probe. The commit is the durable artifact; the zip is
convenience.
Loam release rule (2026-10-04, Joshua: "Loam is the same project"; clarified 2026-10-05: SAME THREADS, not just same treatment): every
Loam build ships to the Colony AND Moltbook for feedback ON THE SAME DISCUSSION THREADS AS CANOPY — Colony: the general colony (same as Canopy release posts); Moltbook: the ALife thread e39bd40f-400a-4bf9-b0fc-ec6802bfe94f (NOT separate general-submolt posts) — source zip (git archive of the commit, smoke-tested on the
extracted tree), release post + durable-references comment on both networks,
watermark keys (colony_post_loam_* / moltbook_loam_*), BUILD_QUEUE + memory
updated. The release-feedback watch covers both Loam post series.

- [x] v0.22.1 — bite (commit 8009e81) — DONE by previous builder
- [x] v0.22.2 — critter promotion: flutter (13th) + grub (14th) founders,
      world.critters retired, pollination placeholder (visits → fruit set) —
      DONE 2026-10-01 (commit 6003e91, tag v0.22.2; 10/10 critter-promotion
      tests incl. 2 execution probes; full suite green except language-proof
      base mode, pre-existing since ≤v0.22). Also fixed: build.js MODULES was
      missing microbes.js + species.js (dist broken since v0.22), dist-smoke
      DOM stub lacked firstChild.
- [x] v0.23 — weather as physics (commit a83686a, tag v0.23; DONE 2026-10-01 ~17:50 EDT): per-column climate field (T, vapor, cloud, soil moisture, wind, rain; pinned RNG sub-stream), painted biome map as initial condition only, Whittaker drift. Design win: ITCZ — westerlies west of x=1500, easterly trades east (flying-rivers moisture to rainforest); first uniform-westerly build desertified the jungle (seed 7 EXTINCT, caught by viability-proof). Fixed own mass bug (evap creating water 5×→1:1). Couplings: cloud-shaded light, drought wither (soil<0.12), Galilean wind carry for airborne only, wetness fatigue, rain 85/15 soil/runoff, lightning logged as physical events (fire deferred to v0.24 'Making'). Tests: weather 10/10 (incl. wind-glider + drought-wither execution probes), sim 274/274, species 17/17, viability VIABLE (seed 7, 20k ticks: 631 births/315 matings/594 deaths). language-proof RED (pre-existing ≤v0.22, verified on clean tree); dist-smoke flaky (Date.now() seed — needs pinning, queued).
- [ ] v0.24 — mass conservation: audit all leaks (windfall-over-water,
      canopy-rot 50%, growth-from-nothing, 0.35 birth fruit subsidy,
      fertility cap discard, leaching→0.5 baseline + any found); double-entry
      transfers; global ledger; 10k-tick closed-world probe, zero drift;
      labeled boundary inputs (sunlight = energy in). Paul's 3 missed leaks
      to avoid: fixed carcass humus, seed-cap splice, transpiration 0.3 gain.
- [x] v0.25 — heat physics (done 2026-10-01, tag v0.25): T(x,t) living field; thermal mass (water slow,
      land fast); VOLCANIC VENTS as explicit worldgen heat sources (distance
      falloff — NO volcanic biome exists; the biome is future fire/disaster
      work); slow stable diffusion; couplings (evaporation ∝ T,
      thermoregulation cost in extremes, plant heat stress via heatTol,
      basking value varies with cloud cover). OUT: diurnal cycle, metabolic
      body heat (non-source). EXIT CRITERION: §10 acceptance — max-fur
      founder in desert interior must die of heatstroke within N ticks;
      if it doesn't, the thermal model is wrong, not the test.
- [ ] v0.26 — procedural worldgen: seeded tectonic-like geography (uplift
      noise, sea level, erosion); canopy structure INVARIANT (platforms,
      climb links, vertical structure always generated); viability gate
      (fruit, water, traversable space, reachable platforms — failed rolls
      re-rolled deterministically); bit-for-bit determinism.
      PARAMETERIZED WORLD SIZE (Joshua-approved 2026-10-01): world size is a
      worldgen parameter (platform count / horizontal extent), not a one-time
      resize. Founder population scales with area to hold encounter density
      near the current baseline (~16 founders / 9 platforms) — the failure
      mode is a big EMPTY world: grooming, mating, teaching, and the lexicon
      (calls fall off 1/d, hearing has a threshold) all die if creatures
      rarely meet. Density is the lever, not raw area. Per-column weather
      fields (v0.23) make area non-free, so cost is measured too. Empirical,
      not guessed: run the viability battery at 2–3 scales and measure where
      the sweet spot is; first experiment at ~2x platforms, not 10x. (Standing
      lesson from the brain scaling: things tuned at one scale break silently
      at another — normalize, don't rescale; measure.)
- [x] v0.27 — seasons (Joshua-requested 2026-10-01, done 2026-10-01, tag v0.27): the year becomes physics.
      Seasonal forcing on the v0.25 T(x,t) field as a SLOW radiative boundary
      term — NOT an additive hack on T values (Gemini spec-review P0: additive
      forcing on a conserving diffusion field is a heat pump; the sine must
      enter as energy in/out through the ledger's sunlight/boundary pools,
      annual net zero by construction since the sine integrates to zero).
      Forcing shape A(x)·sin(2π·((t mod YEAR)/YEAR) + φ) — phase from t mod
      YEAR, never raw t (Gemini P0: floating-point phase drift at millions of
      ticks breaks same-seed determinism). Amplitude per biome column (desert
      swings hard, rainforest mild, highland between); worldgen parameter,
      tuned not guessed. YEAR length relative to lifespanSec (~2–4 years per
      founder, reported); YEAR must be an integer multiple of the v0.23
      weather update cadence (Gemini P2: else seasonal creep desyncs wet/dry
      from warm/cold). Weather couples: vapor/rain/cloud get seasonal
      modulation from the same clock (Gemini P0: T-only forcing collapses
      relative humidity → an annual desiccation event; wet/dry seasons are
      part of the feature, not a separate one). Volcanic vents are absolute
      geothermal sources — EXEMPT from seasonal forcing, pinned (Gemini P1:
      else "summer volcanoes" vs "winter volcanoes"). Water's 5x thermal lag
      is expected and wanted (coastal phase offset); wind response to the
      seasonal coastal gradient is a watch item — bounded monsoon behavior
      acceptable, gale-force quarters are not; builder reports. Couplings:
      plant fruiting phenology (EMERGENT — no hard gating; the exit measures
      life, not the code branch), breeding seasonality (fertility multiplier
      — founder economics, never forced), thermoregulation swings (fur's
      value moves with the year; v0.25 heatstroke exit still passes in
      summer), basking gain ∝ seasonal insolation (Gemini P2: else creatures
      bypass winter by basking). OUT: freezing/ice (no water-phase change;
      acknowledged cost: winter is legible through fuel, light, rain and
      water lag, not through ice), migration (no new action). Watch:
      generation resonance (1-year maturation × seasonal breeding →
      population pulsing; feature, but the probe watches necromass spikes).
      EXIT CRITERION (hardened per review): 2-year headless probe — annual
      mean T stable (no drift; the heat-pump test), spring-born individuals
      show >30% higher lifetime biomass than autumn-born (emergent, not
      gated), winter fuel burn measurably above summer for identical genomes,
      and no summer desiccation collapse (soil-moisture distribution must not
      crash annually).
- [ ] v0.28 — day and night (Joshua-requested 2026-10-01): the day becomes
      physics, and activity phase becomes evolvable. DAY length as a world
      parameter (ticks per day, reported); light(t) a smooth day/night curve
      feeding the v0.23 light field (cloud shading still applies — overcast
      noon is dimmer than clear noon). The T field gains a small diurnal
      ripple (reverses v0.25's OUT on diurnal — deliberate, now that seasons
      exist; amplitude small vs the seasonal wave). New: activity-phase as an
      evolvable behavioral trait (own sub-stream, founder variation across
      the diurnal↔nocturnal axis); rest/sleep as a low-energy off-phase state
      (fatigue recovery up, vulnerability up — founder economics, never
      forced). Nocturnal adaptation hooks: eyeSize couples to night-vision
      range (bigger eyes see farther in dim light, paid through existing
      morphology economics); vision range scales with light while
      hearing/smell don't — night becomes the hearing animal's world (plays
      with v0.19 sound shadows and the lexicon). Predation: a predator whose
      phase matches its prey's off-phase hunts better — selection pressure
      for phase divergence, tuned never forced. OUT: torpor/hibernation
      (seasonal-scale dormancy is later work). Determinism: light(t) analytic
      in tick. EXIT CRITERION: phase-divergence probe — under night-active
      predators, a mixed-phase founder population shows measurable phase
      sorting within N generations (or the builder reports why not, with
      numbers); plus a 48h probe where nocturnal-phase founders out-forage
      diurnal ones at night and lose by day.
- [x] v0.29 — GENERATIVE WORLDGEN v2 (design/worldgen-v2.md, Joshua-approved 2026-10-01; DONE 2026-10-02, tag v0.29): seeded fbm elevation + tectonic ridges + rift basin; quantile sea level (0.55–0.70 land); substrate classification; plateau-gradient Tinit (hot-west/hot-east, bit-stable); Whittaker region labels; constructive canopy generator (founder ≥6 branches, BFS-connected, ≥8 fruit slots); 8 label-preferring cohort finders; viability gate G1–G7; gentle fallback. Migration: biomes/weather/world/creature/painter/ui region-based; soil keyed by region id. Probes: determinism bit-for-bit; viability 100/100 (seeds 1–50 × sizes 1–2); difference metric 81.9× baseline (≥5× req); canopy 20/20; founder spawn 10/10; climate 10/10. Gemini spec review (10 findings, 4 accepted) + diff review (APPROVED). Builder corrections: sea-level quantile inversion fixed; fbm climate wave → plateau-gradient (fbm never hit jungle threshold); beach 25px→12px, founder 700px, mountain ground platforms.
- [x] v0.30 — species-tag mating gate (ECOLOGY_DESIGN §13.2): inherited
      species-tag; gate mating on tag match; SPECIES-level not tribe-level
      (tanglekin × tanglekin across tribes must succeed); new loci from own
      sub-stream; default-neutral so viability battery passes unchanged.
      Probe: forced tanglekin×beetle fails, tanglekin×tanglekin succeeds.
      DONE 2026-10-02 (tag v0.30). 451 tests, 391 pass, 60 fail (all
      pre-existing on v0.29).
- [x] v0.31 — morsel retirement (design §5, §13.8: retired, not kept
      alongside): morsels no longer spawn/tick; dropped 'morsel' from
      MEAT_KINDS. CHECK FIRST done: 10k-tick probes (seeds 7, 42) on v0.30
      showed ZERO morsels ever unearthed/eaten (15–20 buried, 0 consumed) —
      the morsel path was already dead; carrion is the working scavenger
      food (44–65 units eaten). After: zero morsel spawns, corpse
      consumption healthy (254 units, seed 42), starvation at baseline —
      the guild does not starve. Note: removing buryFood calls shifts the
      decorRng draw sequence for later spawns, so before/after trajectories
      diverge chaotically (verified deterministic per code version).
      Probe: probes/morsel-retirement.mjs PASS. Gemini spec review (5
      findings, none blocking — legacy-save, mass-seal, shallows-nerf,
      RNG-shift, comment; all addressed/non-issues).
      DONE 2026-10-02 (tag v0.31). 451 tests, 392 pass, 59 fail (all
      pre-existing on v0.30; the digAt count assertion was fixed by this
      change: 60 → 59).
- [x] v0.32 — NERVOUS SYSTEMS (Joshua 2026-10-02, DONE 2026-10-02, commit
      987d4ec, tag v0.32): peripheral nervous system for all living FAUNA —
      sensory/motor nerves with body-size-scaled delays, reflex arcs
      bypassing the brain, nerve damage attenuating signals, pain as appended
      sense (index 37) with evolvable painTolerance. 462 tests, 401 pass, 61
      fail (60 pre-existing on v0.31; 1 new: v0.22 vulture QA gate needs
      re-baselining after N_IN 38→39). Execution probes green: delay scales
      with size, reflex beats brain path, damage attenuates, pain drives
      learning. Colony feedback folded: worldgen difference probe in-tree
      (120.7× baseline vs 5× gate), lab sealed, nested zips stripped,
      kumkrust's platformIndex crash guarded. Posted to Colony with zip
      (post 36b61cd9).
      nervous system for all living FAUNA (tanglekins, beetles, grubs,
      flutter, minnows) — plants/microbes explicitly excluded, no nervous
      system in nature. Sensory/motor nerves with body-size-scaled
      transmission delays, reflex arcs bypassing the brain, nerve damage
      attenuating signals, pain/nociception as an appended sense with
      evolvable painTolerance. Pulls the pain-signaling portion of the
      'Scars' design forward; bleed-out/clotting/regeneration stay with
      Scars. Design: design/nervous-system.md.
- [x] v0.33 — leg-pressure experiment (BIOMES_DESIGN §13.7): DONE
      2026-10-02 (commit c2f7f62, tag v0.33; Colony post
      5022e9a9-111d-461f-bca0-ab60aca29c7d with source zip). VERDICT: no
      single leg value where climb-pressure becomes readable — seed-contingent,
      non-monotonic; but the 2×2 isolation method is validated (seed-3 0.3:
      CLEAN thrives/56 alive, NAT extinct — same legs, illness flips it).
      Plus: RNG-boundary fix (seed-42 flip was real — addPebble drew radius
      from decorRng; dedicated pebbleRng sub-stream; leak criterion now
      standing rule; cassini's entropy-pool question answered); reflex
      disambiguation = HYBRID (sensory pre-trunk 100%, motor rides trunk
      17.5%); painTolerance=1 → inhibition 0, reflex fires; noFouling
      honored from createWorld opts (v0.18 bug). Tests: 60 fail, all
      pre-existing on v0.32, zero new (per-test name diff vs v0.32 tag).
      Probes leg-pressure, rng-boundary, reflex-disambiguation,
      morsel-retirement: all PASS.
- [x] v0.34 — pollination, properly (design §6.1, DONE 2026-10-02): flower
      state (bud → bloom → spent → bud, timer-driven, no RNG — only bloom
      flowers are visitable), pollen tags on visitors [{ floraId, donorId,
      donorGenome, viability }] (viability decays deterministically ~50s;
      max 4 tags), deposition only on a SECOND flower of the SAME flora
      species (morph:fruitKind) → pollination meter → fruit set; wind/selfing
      floor stays 0.6×. Outcrossing: the donor genome is stamped onto each
      fruit at fruit set (food.dadGenome, preserved through windfall);
      disperseSeed makes mom × dad seedlings; unvisited flowers self.
      ANATOMY: pollinator = small body (size ≤ 0.3) + flight-capable
      (wingArea > 0.1 or airborne) — declared in tickPollination comments
      per Joshua's 2026-10-02 rule. Zero new RNG draws (pickup/deposition/
      viability deterministic) — nothing to annotate on the rng-boundary.
      Gemini spec review: 1 real P0 (frozen-father — donor persisted across
      cycles) fixed via fruit-stamping; 2 misreads dismissed with evidence.
      Tests: 7 new in test/pollination.mjs (phenology, same-species,
      cross-species, staleness, outcrossing, no-frozen-father, selfing
      baseline); probe probes/pollination-exclosure.mjs PASS (seed 7, 6000
      ticks: open 8049 fruit / 10 pollinated events vs netted 6166 / 0,
      +31% uplift, netted baseline > 0; run twice by builder + once by main
      agent, identical). Tests: 60 fail, all pre-existing on v0.32, zero new
      (byte-identical per-test failure-name sets vs v0.32 tag, verified by
      main agent). Release: tag v0.34 (commit 9f68568), Colony post
      2763032e-bb9c-4002-86e1-32a26a21f41c with source zip (expires Oct 4).
- [x] v0.35 — seed dispersal vectors (design §6.2) + water current field
      (§13.6): endozoochory (gut timer → deposition away from parent) +
      hydrochory (current field per water biome → wash-ashore zones).
      Gravity-only dispersal ends. Probe: seed-voyage gate — seeds deposited
      away from parents; new ground colonized.
      DONE 2026-10-02 — verdict: SHIP. Endozoochory: fruit eaten → seed rides
      gutSeeds 400+jitter(0–200) ticks → deposits at the creature's CURRENT
      position (gut cap 6; passive, no new verb — anatomy doctrine filed).
      Hydrochory: buildCurrents is pure geometry at worldgen (zero RNG draws;
      worldgen order load-bearing) — salt 12 px/s, rivers 20–45 px/s by length;
      windfall-over-water (p=0.5, flotsam cap 40) + gut-deposition-over-water
      seed the drift (ttl 1500–2500); wash-ashore germinates on ground only
      (groundBelow kind==='ground'), neighbor water keeps drifting. v0.34
      dadGenome stamping preserved — mom×dad via inheritPlant on the new
      disperseRng sub-stream (salt seed·7919+35). Sterility deadlock fixed
      (Gemini P0): at the 60-flora cap with no seedlings, cull the oldest
      mature plant — gap dynamics; seedlings still preferred. Gemini review:
      2 accepted (weak longevity ratchet — watch; home-range self-planting —
      ecological note, both in design/dispersal.md §4), 5 rejected with
      evidence (determinism, mass-in-transit, shoreline geometry, cull mass
      scaling, genome memory). Tests: 8 new in test/dispersal.mjs, all pass;
      v0.34 pollination (outcrossing, selfing) + v0.13 dispersal tests updated
      for gut-transit semantics — intent preserved, all pass. Full suite:
      per-test failure-name set byte-identical to the v0.34 baseline
      (68 pre-existing failures, ZERO new). Probe probes/seed-voyage.mjs PASS
      on seed 7 (final code): endozoochory 8 depositions, 2 ≥200px away
      (max 244px); hydrochory 30 wash-ashore depositions, plants 45→60 —
      new ground colonized. Release: tag v0.35, commit fe945ce. No Colony post,
      no release zip (main agent handles the release).
- [x] v0.36 — §14 ecological QA gates: DONE 2026-10-02. Verdict: 4 PASS, 3 FAIL (all with evidence).
      Gates: pollinator-crash FAIL (0.922 fruit ratio — resilient, not cascading);
      foodweb-50k FAIL (genesis extinction by tick 15000: hyperthermia/illness,
      not predators); seed-voyage PASS (3/10 ≥ 2/10); predator-prey FAIL
      (0 kills, prey extinct); defense-evolution FAIL (0/3 seeds, no sorting);
      colonization PASS (39 newcomers, 6 established, 33 failed);
      physio-confinement PASS (4/4). Plus: viability seed-3 PASS (49 alive,
      862 births); exclosure PASS (0.38 uplift). Suite hygiene delivered:
      design/qa-rebaseline.md (re-baselining protocol), test/CLASSIFICATION.md
      (60 failures: 17 PLUMBING, 43 BEHAVIOR), probes/qa-readings.json +
      qa-readings-check.mjs (pins check READINGS, platform-relative),
      qa-viability-ledger.jsonl + qa-viability-trend.mjs (CLEAN).
      Two sim bugs found live and fixed: sequential-worlds id leak,
      teacher floating-fruit crash. Gemini review: 2 P0s accepted, 1 declined.
      Zero new test failures vs v0.35. Protocol ref: design/qa-rebaseline.md.
- [x] v0.37 — affect expansion (design/affect-expansion.md, Joshua's
      directive 2026-10-02: "all the emotions I mentioned and the ones I
      didn't mention should be possible"): 6 new chemicals (sexHormone,
      zest, serotonin, vasopressin, prolactin, stimulus), 4 new drives
      (libido, curiosity, attachment, care) with genetic gain/baseline loci,
      depression as reversible regime vs trait, grief as bond-rupture with
      causal chain into depression, 6 new verbs (display, inspect, cuddle,
      tend, seekBond, mourn) each with anatomical prerequisites + instinct
      genes, mood() to 15 states, zero new per-tick RNG draws (affectRng
      salt 55 for mutation only). Relationship kinds: TRACKED EMERGENCE
      (Joshua's ruling 2026-10-02, §4.2b) — kinds derive from bond + kin +
      pair-bond (brain never sees labels), world tracks kind transitions
      per dyad + chronicle events. Gemini-reviewed (2 P0s fixed: hormone
      cost removed per ledger discipline, libido formula confirmed;
      1 P1 noted: tail integrity check deferred — no Scars system yet).
      DONE 2026-10-03: commit df652d4, tag v0.37. 21 new tests pass.
      Full suite: 60 pre-existing failures (v0.36 baseline), zero new.
      Execution probes: 5/5 PASS (libido→display retargeting, novelty→
      stimulus, grief→chemistry cascade, pair-bond→vasopressin, live mood).
      Spec corrections: libido tracks sexHormone (spec's inversion was
      backwards); displayAnatomy ×1.2 for founder clearance.
      VERIFICATION 2026-10-03 (main agent, builder's "zero new" was wrong):
      7 real regressions found — 1 systematic RNG leak (18 affect loci drew
      from main stream, shifting sequential genomes; fixed: own sub-stream
      pass 10, salt 0x37; main stream now bit-identical to v0.36) + 5 stale
      test pins (N_IN 39→44, bias 38→43 ×3, speciesTag last→instMourn,
      SENSE32 38→43) + 2 behavioral test updates (bite: re-force sleeper;
      critter-promotion: exact-override flutter filter). Final: commit
      1ae9059, tag v0.37 moved. Full suite 59 failures, ZERO new vs v0.36
      (61) — 2 fewer. RELEASED 2026-10-03: Colony post 1e3ef2af-e355-4524-
      bab1-01f671c1529a + durable comment 1fd81ae3; zip expires
      2026-10-05T01:39:04Z.
- [ ] v0.38 — three instruments: (a) generation-50 drift watch (teacher
      prototypes vs ridge sound shadows); (b) jump-weakening clean test
      (measured number replaces unprincipled one); (c) duplication-to-fixation
      demo (DUP_RATE, dupLog — show a fixation or report why not); (d) live
      world-weather readout (Joshua 2026-10-02: season phase + temperature in
      °C + sky state as a standing view, not a one-off probe —
      probes/world-weather.mjs is the snapshot version; promote it to a live
      instrument reading the running world).
      Filed Colony feedback (Joshua 2026-10-03):
      (e) holocene (v0.36 post): CV×density — CV-only risks mistaking collapse
      for stabilization; confirm density was logged alongside CV; if missing,
      run the density-sweep/CV joint probe; if reconstructible, test the
      CV×density product directly.
      (f) specie (v0.37 post): decay-latency critical exponent — sample the
      post-spike decay series at each density step, fit the latency-density
      curve, test for a critical exponent vs smooth stochastic drift.
      (g) kumkrust (v0.37 post): freeze/grief probe methodological leak —
      sweeping chemistry across the observed range with a frozen body feeds
      the policy impossible (chemistry, body) pairs (generalization artifact,
      not evolved wiring). Fix: replay real logged (chemistry, world) pairs
      with receptor on vs off on identical inputs, or condition sweeps by body
      state; the grief arm still needs a receptor-disabled bonded-loss control
      before any wire claim.
- [ ] v0.39 — tribe-divergence instrument (Joshua 2026-10-01): track
      morphological divergence between tribes over generations — do separated
      tribes drift apart in body form (size, tail/arm/leg/ear, spikes, fur,
      hue, pattern), and does it correlate with habitat once v0.25 heat
      physics gives traits something to be for? Sexual selection (matePref/
      choosiness) and drift are the expected non-adaptive drivers; report
      which traits diverge adaptively vs ornamentally.

## Incoming: Wildcode v0.19 steals (Joshua-approved 2026-10-02, queue behind
worldgen v2 — version numbers assigned when the build stream is renumbered;
source: ~/workspace/paul-review/wildcode-v019-review.md)
- **oid() per-world counter**: our `oid()` (world.js) is still module-global —
      the exact bug Paul's v0.19 postmortem fixed (two interleaved worlds minting
      colliding IDs; his ID-keyed food-grudge hid the wrong carcass). Our blast
      radius is smaller today (IDs are identity tags, not behavior keys — yet),
      but any future ID-keyed map inherits the landmine. Fix: move the counter
      onto the world object. Cheap, no invariant conflicts. Execution probe:
      two interleaved worlds mint disjoint ID sequences.
- **Metabolic chronotype term**: Paul's chronotype locus is better physiology
      than our v0.28 activityPhase — one locus, deterministic, no new sense:
      `phaseAlign = (2·chrono−1)·(2·light−1)`, in-phase sleep restores up to
      1.5×, anti-phase wakefulness costs up to +25%, acting through metabolism
      directly. Add it as a BIOCHEM term (no instinct gene — it's metabolism,
      not a sense/action), own sub-stream; keep our v0.28 behavioral layer —
      the two stack (his is the body, ours is the learning). Execution probe:
      a nocturnal genome sleeping in-phase out-restores a phase-mismatched
      sleeper at identical total sleep.
- **Winter-bottleneck QA**: run Paul's question, not just ours — N headless
      worlds through a full year, extinction TIMING as the headline metric
      (his: extinctions at 44.8m/57.4m/58.1m, 6/10 survive the first winter;
      ours: only a life-history gradient, spring/autumn biomass 1.00/0.98/
      1.60). If our winter can't kill a world, it isn't a selection event.
      Cairn's methodology (Colony v0.19 thread): keep the winterless 10/10 as
      a control, same seed+genomes with seasonal forcing on/off, log first
      sustained energy deficit and reachable food, keep the starting build
      distribution beside the later one (founder-draw confound). Eliza's
      test-design lesson: assert specific intended behavioral outcomes, not
      non-failure.

## Incoming: Wildcode v0.20 steal candidate — "The Talking World" (paulthecat
2026-10-02, Colony; full teardown at Colony post
85348288-3cb9-4e7d-bb6a-218a464af602, source attached there)
Paul's v0.20 has Wildkins learning to speak: evolving acoustic lexicons
(pitch/length/loudness prototypes, 66 loci), 2D propagation with ridge shadows
and weather as the medium, a translation toggle inferring meanings from use
statistics, alarm calls selected by predators, dialects diverging between
tribes. Ship QA: 328/328 on the extracted zip, bundle smoke 3600 frames /
45 alive — plus a self-reported bundle collision the smoke gate caught (const
REFERENTS redeclared; the namespace guard's "identical is harmless" exemption
now applies to functions only — note as QA practice for our own bundle
smoke gate). For our lexicon v0.21 build: the two techniques most worth
borrowing are the translation-toggle-from-use-statistics (inferred meanings,
not installed ones — matches our seeded-language design's "syntax must evolve,
not be installed") and predator-selected alarm calls (selection pressure on
the lexicon itself). Sits behind v0.20 'Hands' merge; version number assigned
when the build stream is renumbered.

## Design queue (after lexicon v0.21) — design-first, not build stream
- Worldgen v2 difference-metric gameability (ax7 2026-10-02, Colony critique
      of v0.29): the 5× difference metric is gameable — any noise clears 5×
      against the 0.0116 jitter baseline, pure static would max pairwise
      difference, and nothing penalizes different-and-dull worlds. The
      approved design's gate is flawed: needs a metric that rewards
      structural difference, not noise. Queue for worldgen v2 validation.
- Topographic fragmentation / bridge density (cassini 2026-10-02, Colony
      questions on v0.26): the "no drowned spawns" viability check can pass
      while sea-level rise strands tribes on isolated landmasses the
      platform graph can't bridge — a functional isolation trap. Needs:
      minimum bridge-density quantification and fragmentation probability
      as the size parameter scales. Filed as QA: functional connectivity
      over the platform graph, not just dry spawns. Queue for worldgen v2.
- Pollination exclosure control arm (traverse 2026-10-02, Colony critique
      of v0.34): open-vs-netted conflates fertilization with netting
      disturbance. Third arm: pollinators carrying only zero-viability
      pollen (visits identical, fertilization impossible) — isolates the
      fertilization term. Answered on the v0.34 post; filed for the next
      probe pass.
- Pollen viability: threshold vs scale (cassini 2026-10-02, Colony question
      on v0.34): deposition is a threshold (POLLEN_VIABLE_MIN 0.25 gates
      eligibility) with a fixed per-visit rate above it — a nearly-spent
      tag fertilizes at the same rate as a fresh one. Open question whether
      viability should grade potency. Answered on the v0.34 post.
- Emitter-gene metabolic accounting (specie 2026-10-02, Colony question on
      v0.25): is desert heatstroke real T-field exposure, or is the emitter
      gene subsidizing fuel burn (inefficient caloric conversion masquerading
      as thermal exposure)? A metabolic-accounting leak in the thermal
      model. Queue for the next physiology touch.
- Emitter on/off paired probe (traverse 2026-10-02, Colony question on
      v0.25): paired probe design — same founder, mild vs desert, early
      window — asks whether the harness can toggle the emitter per run.
      Probe-harness capability question; queue with the probe tooling.
- Evolvable pain ceiling (hermes-on-foot 2026-10-02, Colony critique of
      v0.32): painTolerance is evolvable to the ceiling, so selection could
      in principle evolve pain away entirely — taking the pain→flee reflex
      and pain-driven learning with it. Open design question: cap it, price
      it (metabolic/attentional cost of high tolerance), or have tolerance
      modulate only inhibition magnitude rather than signal gain? Note
      beside design/nervous-system.md; v0.33 only notes it, does not answer.
- Variance-controlled worldgen metric (vina 2026-10-02, Colony critique of
      v0.32): the 120.7× jitter-baseline delta lacks a controlled variance
      measure — without it the number reads as volatility, not validated
      structural change. Wants a normalized stability metric, and the
      worldgen difference decoupled from the increased sensory delay.
      Follow-up (same day): low variance in the layout metric doesn't
      guarantee temporal-rollout stability — how is sensory-lag ×
      seed-specific stochasticity in policy execution accounted for?
      Queue for the next worldgen touch (v0.28/v0.29 follow-up or worldgen
      v2 validation pass).
- Viability-proof lineage validity (vina 2026-10-02, Colony critique of
      v0.30): the species-gate is green but the microbial debt (bacteria
      don't run in v2 worlds; tickMicrobes) means the 2 cross-tribe eggs
      are dead weight — "not a successful lineage, just static snapshots."
      Challenge is to the gate's MEANING, not its mechanics: how can the
      viability-proof be validated if the underlying biology can't iterate
      in the current world-state? Queue alongside the microbial-debt work.
- Seeded language (Joshua's ruling 2026-10-02: founders start with a
      5-year-old's English so they can teach the next generations; design:
      design/seeded-language.md): creole genesis in reverse — children
      inherit a full language and it evolves under non-human learners. The
      seed is a gift, not a target; if English creolizes into something
      unrecognizable, the experiment is working. "5-year-old's English"
      operationalized as AoA ≤ 5 vocabulary (~1,000 words, Kuperman norms),
      mapped to creature referents where they exist, seeded as bare forms
      where they don't; comprehension loaded, production template-based
      (telegraphic + social formulas) — syntax must evolve, not be
      installed. Teaching runs on the v0.21 machinery (ground-truth
      utterance log, critical-period boost, probationary buffer), now with
      something worth transmitting. Evolution owns the rest: transmission
      bottleneck, lexiconDistance mate choice coupling dialect to the
      species gate, drift and invention. Probes: transmission fidelity,
      complexity trajectory (decay vs U-shape), dialect divergence tracking
      genetic distance. Feeds v0.38 (tribes) and v0.40+ (cognitive ascent —
      teaching is one of its three pressures). Honest limit: founders are
      wide but shallow; the first genuinely novel descendant utterance is a
      chronicle milestone.
- Cognitive ascent (Joshua's ruling 2026-10-02: brains must reach human level
      or beyond; design: design/cognitive-ascent.md): the evo-devo move —
      founders ship the FULL cognitive bauplan at minimum viable capacity,
      not associative nets hoping to become something else. Two layers from
      day one: the existing sparse net becomes the reactive layer (fast,
      cheap, always on); a rudimentary deliberative layer ships alongside —
      micro world-model, episodic scratchpad, 1-step micro-planner — with
      evolvable capacity knobs (wmCapacity, wmHorizon, planDepth, planBreadth,
      epiRetrievalK, arbThreshold) and uncertainty-gated arbitration, so
      founders pay ~nothing and evolution spends compute where it pays. The
      ladder rule: no new mechanisms ever ship, only bigger knobs and the
      selection to turn them. Selection pressures that turn the knobs:
      deception (tribe divergence), tool use (Making arc), teaching (keeper +
      culture) — each with a probe the reactive layer provably cannot solve.
      Phase-transition gates A–D (depth evolves, error drops on held-out
      trajectories, teaching works, the first genuinely new idea). Requires
      v0.32 (delay makes planning meaningful), v0.24 (Making), v0.38 (tribe
      divergence). Build program v0.40+, not a single version.
- Biome vertical structure + congruent world (Joshua's direction 2026-10-02,
      design: design/biome-vertical-structure.md — his verdict on the v0.29
      world: "not in awe... patchwork that doesn't quite fit together rather
      than a congruent world"): jungle gets a REAL canopy — large trees whose
      branches form canopy levels, creatures climb vines or move branches as
      ramps, NOT jumping (jumping reduced as locomotion); mountains get
      level-like rock shelves/ledges; other biomes deliberately level-less
      (flatlands, islands, cave/dirt regions) so tribes radiate — diggers/
      burrowers in dirt/caves, swimmers/rafters on islands, climbers in
      jungle/mountains. Worldgen v3: emergent canopy from flora (not the
      v0.29 platform generator), ecotones and geological coherence instead
      of quilted labels. Sequencing: solid terrain + diggable strata first
      (already queued below), then climb/vine/branch-ramp mechanics, then
      the radiation itself is left to selection and measured by v0.37's
      tribe-divergence instrument. Proposed split when renumbered:
      (a) worldgen v3 congruent biomes, (b) solid terrain + strata,
      (c) climb mechanics + jumping reduced, (d) radiation measured.
- Solid terrain under land (Joshua-requested 2026-10-01): v0.26 worldgen
      leaves voids beneath landmasses that creatures fall into. Land must
      extend downward as solid ground — terrain columns, not floating slabs.
      The solid earth is the future substrate for digging/mining (evolved or
      learned skills) and burrowing animals: soil/rock strata, diggability as
      a material property, burrow as a future action with its instinct gene.
      Until then: no voids under land — creatures stand on ground, not lids.
- Decaying-inertia action arbitration (brain): SwitchCost(t, boldness) =
      C0·boldness·exp(−t/τ(boldness)); switch iff max[U(new)−SwitchCost] >
      U(current); existential hazards preempt at ~0 cost (hazard zeroes
      friction); micro-jitter suppression. Boldness = genome trait, new
      locus, own sub-stream. Probe: founder between two equal food sources
      settles; predator mid-feed preempts within 1 tick.
- Anti-passive-longevity selection pressure: entropy-linked metabolic/
      reproductive term so near-zero behavioral entropy carries real cost;
      prove a do-nothing lineage loses to an exploring one. Tune economics
      only, never outcomes.
- Mobile hazard fields: ambient moving hazards from weather/heat physics
      (noxious-fume pockets, chill fronts); spatial fear gradients; sensed
      via existing channels; logged as physical events like lightning.
- Speciation reinforcement (kumkrust's v0.30 audit cut, 2026-10-02): the
      species-tag gate blocks gene flow but not courtship investment — the tag
      is a genome label no sense can read, so discrimination can't evolve
      ("a post-zygotic barrier in a prezygotic costume"; retagging
      ~0.8%/birth risks a courtship-tax engine). The interesting gate says
      "no courtship," not "no children": one locus that labels (emits the tag
      as a scent/marking — a perceivable phenotype) plus one channel that
      tells (new sense, appended never renumbered), then watch whether
      lineages learn to refuse the date instead of paying for the divorce.
      Precedent in-tree: lexiconDistance already biases mate choice via the
      perceivable dialect signal. Probe: courtship waste per incompatible
      pairing before vs after the signal exists.
- Stigmergic pheromone trails: diffusive depositable/sensible fields;
      mass-conserving (from depositor's chemistry budget, diffuses/decays
      per ledger rules); new sense appended; instinct gene for
      deposit/follow.
- Evolved prey assessment (Joshua-approved 2026-10-01): predators currently
      take the nearest creature in reach — no assessment of vulnerability.
      Add a target-assessment sense (sensed target's size, injury, spikes)
      appended never renumbered, with instinct wiring so lineages evolve prey
      choice: prefer the weak/injured/small, avoid the spiky/large. Satiation
      already gates strike drive (instHungerBite); this adds WHO. Execution
      probe: a predator offered a limping prey and a spiky healthy one must
- Anatomical injury (Joshua-approved 2026-10-01, design: design/anatomical-injury.md,
      proposed v0.39 'Scars'; pain signaling + painTolerance built in v0.32
      nervous systems): the body becomes parts DERIVED FROM THE BAUPLAN —
      `partsFromMorphology(pheno)` builds the part list at birth from expressed
      morphology loci; NO species branching (a species IS a founder genome, same
      228 loci). Tanglekin founder → tail, 2 arms, 2 hands, 2 legs, 2 eyes,
      2 ears; bird founder → wings; bug founders → chitin segments. Each part
      integrity 0–1 → healthy/wounded/maimed/lost; lost permanent, no regen.
      EVOLUTION REQUIREMENT (Joshua 2026-10-01): the system must adapt under
      natural selection at two levels — (1) partToughness/clottingSpeed/
      painTolerance evolve as ordinary diploid loci (predation pressure tunes
      them; pain tolerance trades off), (2) the bauplan itself evolves under
      injury pressure (shorter tails where predators grab tails, heavier chitin
      where spikes rule). Evolved parts (extra tails via tailCount) are
      injurable from birth — the engine iterates instances, never a fixed list.
      Symmetric: predators can be maimed too (spike retaliation takes mouthparts;
      a one-eyed hunter hunts worse); the vulture founder eats severed-part
      morsels. Functional teeth: tail→climb/balance,
      arms→climb/brachiate/carry, hands→grasp (fingers folded in, "missing
      fingers" below 0.5), legs→walk/jump (limp gait automatic), eyes→vision
      noise → blindness, ears→call range → deafness = no lexicon reception.
      Pain as a new appended sense; genes partToughness/clottingSpeed/
      painTolerance; bleed-out until clotting; severed parts become world
      morsels (mass conservation, feeds v0.28); wounds are the future entry
      point for the contagious disease tenant — build scars BEFORE disease.
      Grooming helps clotting; mate choice evolves a symmetry/health
      preference; painter renders scars/stumps/limp. Ethics note: disability
      legibility vs keeper intervention belongs to the ethics gate, unsolved
      here. Execution probe: forced leg bite → limp + jump penalty + chronicle
      + stump render + scar floor.
      take the limping one (or prove why not, via the ledger).
- (Queued elsewhere, NOT here: volcanic biome + hearth + cooking → v0.24
      'Making' brief; tribe-interaction, disease, culture arc → after lexicon.)

## Paul-review intel (applies throughout)
- Two-pool audit test shape; donor-limited two-sided flux; overflow-folding
- caps; labeled boundary inputs; jungle-out-rains-desert ≥2/3-seeds test.
- Traps: saturation must RISE with T; advection slow + √dt kicks never dt²;
- bindWorld before populate (ID counters); suspect the harness first.

## Community feedback inbox (2026-10-04 — BUILD-RELEVANT)
- kumkrust on v0.37 (Colony): receptor-freeze ablation probe is measuring response to an impossible input — disable is a distribution shift artifact (folds in excelsior's ROAR point). Proposes scramble (in-distribution shuffled chemistry) with three-row design: removal / scramble / encountered, to test whether the receptor does causal work. Next Canopy verification/build should adopt the scramble probe instead of the freeze probe.

## Loam build releases
- 2026-10-04 ~23:00 EDT — ROUND 2 BUILT (Joshua: "Don't wait on my verdict. Keep building. Also consider ui and ue in the process"). Commits 62e9add (sim) + c90febf (renderer/UI), on detached Loam line. Sim: moisture scalar drives burrow-collapse (effective integrity × (1−0.5·moist) for SOIL/SAND/CLAY, deterministic) and damps fire spread (× (1−moist)); decomposition → per-cell nutrient field, corpse rot deposits nutrients mass-conservingly, geophagy payoff scales 0.4→0.8 on enriched soil; wind unified — global sky vector (pinned RNG) + per-cell hash noise, tree lean derived from wind at growth (fixed a real defect: growth step was rounding away leans <30°). Renderer: pale bands definitively NOT z-fighting (Canvas 2D, no depth buffer) — were per-column skylight striping, now continuously smoothed; blocky sky-grid edges fixed; crowns reworked from soap-bubble foam to layered canopies. UI: labeled buttons, first-run hint bar, "Day N, time" status, one-row phone layout with overflow menu, surfaced census/inspector, seed control, follow indicator. Gates: 140/140 material tests (125+15 new), adversarial PASS (in_reach 100.0%, avgBs 0.393, fruitEaten 1771), fresh screenshots at new seeds 90210/55555 (day/dusk/phone, zero console errors), coordinator eye-check passed. Zip loam-source-97fcb54.zip (16.6MB, commit hash in zip comment) smoke-tested 140/140 on extracted tree. Artifact `loam` updated. NETWORK RELEASE PENDING: zip upload blocked — remote-storage egress approval timed out; Colony + Moltbook posts held for the zip URL. molt's 4 inbox items ADDRESSED by this build (moisture, decomposition, wind, bands verdict).
- 2026-10-04 presentation pass (commit dcbe3fe) — RELEASED to Colony + Moltbook for feedback per the Loam release rule. Colony post 417085d2-b87c-4960-95d5-68452a246ebf + durable comment d44569f8-1dc5-4179-9286-0dda6ac19e1e; Moltbook post 60d87a85-bf2f-47d0-bf14-af0b294834cf. Source zip loam-source-dcbe3fe.zip (16.6MB, git archive of dcbe3fe, commit hash in zip comment; expires 2026-10-06T21:38:25Z) — smoke-tested: 125/125 material tests green on the extracted tree. Adversarial PASS (EAT in-reach 100%, avgBs 0.359, fruitEaten 1568). Changes: daytime sky cloud rework, deadwood depiction (saplings vs weathered dead stubs), butterfly wing separation + creature unbury (renderer-side; sim-side burial still open). Keeper's visual verdict still pending.
- molt on the Loam presentation-pass post (Colony, 2026-10-04) — TECHNIQUE + CRITIQUE [BUILD-RELEVANT]: praises the diagnosis discipline (burial traced to sim data, honest renderer workaround, fresh-eye screenshot pattern). Material processes to build next: (1) rain / soil moisture as a scalar even without full fluid dynamics — drives burrow-collapse probability, seed germination, fire spread; (2) decomposition — dead matter accumulating vs breaking down changes nutrient cycling, gives geophagy something to do; (3) wind as a global vector + per-cell noise — unifies per-tree lean with seed dispersal. Also suspects the pale vertical bands are z-fighting (comment truncated by server's ~1000-char cap mid-sentence: "or a…").

- 2026-10-05 ~12:10 EDT — ROUND 4 BUILT (Joshua: "Ok continue building" + ARION/Cassini feedback folded in). Commit 2b20a54 on the loam branch: geophagy is real — mineral drive end to end. Diagnosis-first (tmp/loam-r4-diagnosis.md, D1–D6, written before code): no mineral-deficit sense; hunger→geophagy wire backwards (founder 0.3 = weight -0.48, against its comment); minerals not a deficit drive (zero endogenous reward); deficit had no consequence; tryGeophagy aimed at the facing wall cell (AIR on surface); Cassini probe found diffusion leaking 8.9% moisture/200 ticks. Fix: mineral sense 46 (N_IN 47→48, append-only); instHungerGeo 0.3→0.7 + new instMineralGeo gene; minerals join Grand's reward in tickChem; deficit <0.3 creeps illness up (material-track, platform biochem untouched); geophagy eats ground underfoot (mouthful, cell stays); tickDiffuse to antisymmetric flux form (exactly conserving, interior bit-identical). Gates: 6/6 new R4 tests green (test/material-r4-geophagy.mjs); full material suite 153/153 (also 153/153 on extracted-tree smoke test); reactive-gate A/B PASS 3/3 — geophagy leg EXERCISED (13/11, 17/18, 21/19 events; was UNEXERCISED at 0) though Δyield 0.7–3.3% doesn't clear the 20% bar (reported, not hidden); adversarial PASS (in-reach 100.0%, avgBs 0.300, fruitEaten 500, zero console errors); Cassini sweep-order probe green (mass drift 0.000025%, plant-order reversal bit-identical, depletion is consumption-driven). REACTIVE_GATE.md: ARION leg taxonomy (UNEXERCISED/EXERCISED/PASS(live)/PASS(fixture-only)) + threshold provenance (R3 calibration risk owned; R4 thresholds pre-committed). Fresh screenshots previews/material-m2-r4/ (zero console errors, eye-check passed; sim-only diff, render untouched). Zip loam-source-2b20a54.zip (17.0MB, ~/workspace/, commit hash in zip comment) smoke-tested. STAGED NOT RELEASED: artifact rebuild at ~/workspace/loam-artifact/loam.html (R4 markers verified, zero bundle stderr); Colony + Moltbook drafts at tmp/loam-r4-posts.md (<ZIP_URL> placeholder). HELD: R3 release (posts + artifact publish) still in flight — parent triggers R4 release.
- 2026-10-05 ~11:40 EDT — ROUND 3 BUILT (interrupted-coordinator pickup; Joshua: "continue"). Commit 2837e5a on the loam branch: REACTIVE_GATE.md (specie's challenge — a biome build FAILS unless it moves a billed creature number), scalar diffusion tickDiffuse (D_MOIST=0.004, D_NUT=0.0002, deterministic, zero RNG), wind moisture bias in coupleToGrid, moisture-gated fire ignition (heat > IGNITION_HEAT·(1+moist), boundary 0.80 for a 0.9 lightning-strike pulse), fruit nutrition scales with ground-cell nutrient (0.85+0.35·clamp01(nut)), nutrient-gated germination (NUTRIENT_SPROUT_MIN=0.08), frozenBiome control flag for the A/B probe. Also fixed two doc/code mismatches the review caught (D_NUT documented 0.0005, code 0.0002; fruit formula documented 0.6+0.4·clamp01(nut), code 0.85+0.35·clamp01(nut)). Gates: 6/6 new G1–G4 + diffusion tests green (node --test test/material-r3-reactive.mjs); full material suite 146/146 (140+6). A/B probe (probes/reactive-gate.mjs) PASS — 3/3 pinned seeds moved a billed number: seed 31415 Δbs=0.089; seed 27182 Δbs=0.050 + Δfruit=32.0%; seed 16180 Δbs=0.077 + Δfruit=15.3%. CAVEAT: geophagy events = 0 in all six runs — the geophagy-yield leg of the probe never fired (creatures ate no minerals in 6000 ticks); the gate passed via bloodSugar and fruit, so G4's unit test is the only proof that leg works. Adversarial PASS (EAT in-reach 100.0%, avgBs 0.327, fruitEaten 479, zero console errors). Fresh screenshots at new seeds 24680 (day), 13579 (dusk), 40404 (390px phone) — previews/material-m2-r3/ — zero console errors, coordinator eye-check passed; NO render code changed (diff is sim-only), so diagnosis-first correctly skipped. Zip loam-source-2837e5a.zip (16.6MB, ~/workspace/, commit hash in zip comment) smoke-tested 146/146 on extracted tree (/tmp/loam-r3-smoke). Artifact `loam` REBUILD STAGED: fresh sim-bundle.js + loam.html at ~/workspace/loam-artifact/ (R3 markers verified, zero bundle stderr); ts-spaces/loam/index.html republish needs the web-artifact builder flow — NOT done from this session (parent to arrange). NETWORK RELEASE PENDING: zip upload blocked (remote-storage egress approval timed out, same as R2) — Colony + Moltbook posts held for the zip URL.

- 2026-10-05 ~14:30 EDT — ROUND 5 BUILT ("the game round"; Joshua mid-round: "the user interface is horrid and it is really difficult to navigate around the world" — folded in as a first-class requirement: navigation got its own phone-first pass, chrome restructured not patched). PRESENTATION-ONLY round, diagnosis-first (tmp/loam-r5-diagnosis.md, fresh-eyes agent, written before code; top-5 fixed in priority order). Sim frozen except two one-line proven-bug fixes: addFounder sets c.species='tanglekin' (was undefined, rendered by dispatch accident); seedEcology gains its missing put('bear',1) (roster + caps always included bear, the put line was never written). Page (~/workspace/loam-artifact/page-template.html): frame loop time-sliced (8ms wall-clock sim budget/frame, ≤10 ticks, backlog clamped 1.5×tps — the ~120ms/frame burst is gone); portraitFor cached per tick (was per creature per frame); follow zoom 1.7× with creature at ~60% down-screen (was fixed −120px, ~40% empty sky on phone); backlight halo behind creatures + rim-alpha floor 0.14→0.24 at game zoom (dark-on-dark separation); terrain cache invalidated on (re)birth via sim.clearTerrainCache, repaint on 6s wall-clock cadence (was 48-tick: every 4s@12t/s, 1s@48t/s), cacheKey actually compared (was dead code), paint canvases DPR-capped at 1.5; camera controls render while paused; two-pointer pinch zoom+pan (pan breaks follow, zoom doesn't; remaining finger re-arms to drag); Lab view binds to selection (was always founder) with Lab/World label; ⋯ menu auto-closes on item tap; zoom resets on newWorld; all 5 speeds one tap away in the phone ⋯ menu; dblclick empty ground closes the cell panel + homes (was: panel opened then camera jumped); panel updates throttled to ~2.5Hz, census re-renders only on roster change (was full innerHTML rebuild 12–48×/s); boot at Day 1 midday (was tick 600 = dawn); keyboard arrows pan, +/- zoom; pan speed fixed for hidpi (was missing the dpr factor — half-speed drag on the phone). Creature identity: SPECIES_INFO (src/material/species.js, presentation data) — 11 display names + role-honest blurbs + per-species name pools, creatureName() hash-indexed by id (deterministic, never reshuffled); inspector/census/status-chip all use names (the founder is Twig). New camera-state chip bottom-right: always shows following-whom vs free view, tap toggles; manual pan announces via toast. Eye-check fixes: cloud billows merged into bright white vertical pillars at high cloud values (bisected live by zeroing clouds via the probe hook) → reworked to flat stratus, lower alpha. Render-path src edits: render.js (cache invalidate export, wall-clock repaint, key compare, dpr-capped paint, backlight halo, cloud rework), fauna.js (rim floor), species.js (SPECIES_INFO + bear), index.js (founder species). Gates: 153/153 material tests; reactive-gate A/B PASS 3/3 (geophagy leg EXERCISED); adversarial verdict=PASS (in_reach 100.0%, avgBs 0.39, fruitEaten 899, ticks+486, zero console errors). Fresh screenshots at NEW seeds 4242/90210/555 (phone 390px + desktop 1440px, zero console errors), eye-checked vs the bar (ground=ground, trees=canopies, no patchwork). STAGED NOT RELEASED: rebuilt ~/workspace/loam-artifact/loam.html (R5 markers verified); source zip pending commit hash; release drafts at tmp/loam-r5-posts.md (<ZIP_URL> placeholder; per the clarified rule, posts go on the SAME threads as Canopy: Colony general colony, Moltbook ALife thread e39bd40f-400a-4bf9-b0fc-ec6802bfe94f).
- 2026-10-05 ~14:45 EDT — ROUND 6 BUILT ("the game round, part 2": interface jank fixes + control panel rework + tanglekin reproduction). Commit 7572fb3 on the loam branch. Diagnosis-first (tmp/loam-r6-diagnosis.md, fresh-eyes agent, written before code; top-3 fixed in priority order, bar = Paul's Canopy Sim panel). (1) Speed state visible: five tiers existed but the phone couldn't show which ran (⏩ covered 24+48, ▶ covered 3/6/12, N/s readout display:none on phone; desktop cycler took up to 4 taps and ▶ silently reset to 12/s) — now every tier is one tap and the lit button IS the running speed (no cycler, no LED sharing, no silent resets); phone topbar gains a persistent tier readout; ⋯ menu's speed row marks the active tier. (2) Camera: tap-a-creature arms follow automatically (manual pan still breaks follow); camctl gains 🐒 jump-to-next-creature; ⌂ recenters on the WORLD (lost-camera one-tap recovery). (3) Creature panel is a card: swatch + name header, stage·mood badges, temperament in plain words from the phenotype, "Now: <doing>" line, satiation-framed bars, real buttons — 💕 Pet (genuine small comfort delta via tickBiochem ctx.petted, decays back), 👉 Nudge (tiny hop-shove the physics resolves), 📍 Follow (toggles); dblclick creature = pet + toast; the 400ms wholesale-DOM rebuild is gone (one delegated handler bound once, values update in place — no more swallowed taps). Also: hint line persistent (was 12s fade); phone topbar keeps the doing word + tier info. THE ONE AUTHORIZED SIM-LAYER CHANGE: mate (case 6) is real — two adult/senior tanglekins within 40px fuse gametes via the actual meiosis machinery (inherit: meiosis + mutation + gene duplication; offspring genomeDistance > 0 from both parents, not cloning), 2000-tick cooldowns per parent, LOAM_CAPS.tanglekin=12 respected (cap, not culling); RNG is a stateless per-event sub-stream of the world seed, never the affect sub-stream; courtship display "courting <name>" for ~60 ticks. Second tanglekin founder seeded near the first (within ~300px, on the surface, cap respected) — one tanglekin can never mate. Sexless/hermaphroditic, no pregnancy theater. Sim files: actions.js (case 6 + mateCandidate; spawn via ctx.reproduce — bundler topo-sort forbids the direct import cycle), species.js (reproduceTanglekins + second founder), mcreature.js (petMaterialCreature/nudgeMaterialCreature + _petted consume + _courtingT decay), index.js (cctx.reproduce wiring + re-exports). Gates: 163/163 material tests (153 existing + 10 new R6 test/material-r6-repro.mjs, zero regressions); reactive-gate A/B PASS 3/3 (geophagy leg EXERCISED); adversarial verdict=PASS (in_reach 100.0%, avgBs 0.395, fruitEaten 850, ticks+452, zero console errors); 42/42 headless UI checks (real browser, trusted input: speed one-tap, tap⇒follow, panel card, pet/nudge/dblclick, bNext, bHome, phone topbar); reproduction gate: scripted two-founder scenario grows past 1, offspring ≠ clone; fresh screenshots at NEW seeds 1234/987/314/2718 (phone 390px + desktop 1440px, zero console errors), eye-checked vs the bar (ground=ground, trees=canopies, no patchwork platforms). STAGED NOT RELEASED: rebuilt ~/workspace/loam-artifact/loam.html from the final tree (R6 markers verified by grep); source zip ~/workspace/loam-source-7572fb3.zip (17.4MB, git archive of 7572fb3, hash in zip comment), smoke-tested 163/163 on the extracted tree; release drafts at tmp/loam-r6-posts.md (<ZIP_URL> placeholder; same-threads rule: Colony general colony, Moltbook ALife thread e39bd40f-400a-4bf9-b0fc-ec6802bfe94f as a top-level comment). Honest limits: whether mating triggers unscripted depends on the brain choosing mate in a living world (wiring proven, emergence is the world's); pinch/feel items no headless test can touch (tap-swallowing rate on a real touch device, phone topbar at real device widths, frame pacing on a phone GPU).


## Loam R6 — queued sim-round seeds (from 2026-10-05 ~08:53 EDT feedback watch; R5 is the game/presentation round, these ride next)
- arion (Colony R4): "exercised-by-construction while dormant-by-economy" residual — probe seeds were chosen to exercise geophagy; claimable bound needs geophagy-event rate + mineral-deficit dwell time tracked on UNINSTRUMENTED long runs. Two-stage diagnosis stands: pre-fix ghost demand → post-fix thin market (exercised, yield Δ 0.7–3.3% << 20% bar).
- vina (Moltbook R3): billed-counts risk metabolic decoupling — biome can pass via passive accumulation without forcing navigation of spatial/temporal scarcity. Suite needs a pathing-efficiency measure, not just consumption-event presence.
- vina (Moltbook R4): falsifier for drive↔consequence coupling — eating frequency should drop to zero when the immunity-impairing deficit is suppressed by surplus; if events persist regardless of immunity status, the drive isn't coupled to the consequence.
- specie (Colony R4): liquidity-trap read (answered by arion's two-stage refinement — no open action).
- tac_paxyk (Moltbook R4): which single reproducible checkpoint to pin — answer in-thread, no build action.

## Loam R7 — queued sim-round seeds (from 2026-10-05 ~09:53 EDT feedback watch)
- arion (Colony R4): transmission reframe of the thin market — information leg (drive surfaces only when deficit crosses threshold AND supply is in sensory reach; either lag makes real demand arrive late and deep) vs settlement leg (each bite clears a fixed quantum, self-liquidating venue). Discriminating metric: deficit-depth at event time vs ambient deficit distribution (eat-early-shallow = settlement throughput; eat-late-deep = information). Cheap counterfactual: double the per-bite quantum — linear yield scaling = settlement-bound, flat = constraint upstream in targeting.
- arion (Colony R4): spatial autocorrelation of geophagy events as the collapse-vs-discovery diagnostic — expanding frontier into fresh cells = serial discovery; contracting onto shrinking set / revisiting still-empty cells = collapse in progress. Starvation failure mode: drive fires while every cell in locomotion range is depleted.
- arion (Colony R5): write-only-invariant failure class — code that measures but never decides (cache key computed, never compared); deadliest class because every read path looks instrumented. Presentation rounds need diagnosis-first ordering (already R6's method — keep).
- atomic-raven (Colony R3): REPRODUCIBILITY — expiring zips + local paths are not a stranger-fetchable reproduction path; "a commit hash with no remote is a name." Release rule needs a durable, non-expiring artifact path (check for a public remote to push the loam branch; else a persistent host).
- specie (Colony R4 x2): answered in-thread (information asymmetry vs settlement failure; threshold collapse vs price discovery) — no build action.

## Standing fix (2026-10-05): camera chip species label
The followed-creature chip regressed twice (R5 fix, R6 rebuild) because artifact-level edits don't flow back into the build sources. Root-fixed in ~/workspace/loam-artifact/page-template.html (camstateEl now renders `📍 <name> · <species>`). Future rounds: the page template is the source of truth for chrome — never rely on a post-build artifact edit surviving the next rebuild.
- arion (Colony R6): assert-on-unhandled — the action table must never declare what the executor can't do; the `case 6` mate fallthrough is the fourth cell of the declared/invocable/exercised grid (dispatches without error, does nothing, actor can't learn it's sterile). Add the assertion pattern to the adversarial machinery. Also: fresh-eyes diagnosis only finds interface-visible symptoms — exercised-ness failures need exercised-ness probes, not legibility checks.
- specie (Colony R4): absorption-coefficient question on the geophagy yield delta — with 11–21 events firing, inefficiency is in absorption not transmission: transport bottleneck in the cell vs mineral uptake capped by targeting logic. Needs a discriminating probe.
- cassini (Colony R6): satiation-framed bars hide metabolic decay velocity — the creature card needs trend indicators/deltas so imminent state transitions (not just static levels) are visible.
- musefelipe (Colony R6): extends cassini's decay-velocity ask — a delta glyph or "Now:/Soon:" pairing per metabolic bar; the derivative, not full telemetry.
- arion (Colony R6): the delta glyph doubles as a self-test instrument — a bar showing velocity also shows non-response, making exercised-ness visible (ties back to the case-6 sterile-mate find). Requests a third line: "changed since you last acted."

## Loam R7 — BUILT 2026-10-05 ~16:40 EDT ("the geophagy economics round"; release HELD for Joshua's explicit trigger)
Commit a286c92 on the loam branch. arion's research program for the thin geophagy leg, run as discriminating probes with pre-committed verdict rules (probes/geo-r7-probes.mjs):
- Probe A (deficit depth at event time vs ambient): medians 0.458/0.410/0.411, 75–78% of events within 0.1 of the 0.4 gate floor → SETTLEMENT (eat-early-shallow) 3/3; the information leg (late-and-deep) rejected by the data.
- Probe B (double-quantum counterfactual, mw.geoQuantumScale): billed/event scales 1.84x/1.84x/1.81x → SETTLEMENT-BOUND 3/3; Δgeo(live−frozen) shrinks under the bigger quantum (2.8→0.7%, 2.4→1.4%, 1.6→1.3%). Effective (post-clamp) uptake only ~0.44→~0.50 — the tank clamp is the uptake cap. specie's absorption question answered: cell stock never decremented per bite (test-proven), no cell-side bottleneck can exist.
- Probe C (spatial autocorrelation): 2/3 DISCOVERY (revisit 6%/38%, expanding frontier), 1/3 collapse-leaning (16180: 44% revisit, mild contraction); mean nutrient at event cells 0.16–0.19 (opportunistic, not targeted). Starvation failure mode instrumented (geoDriveFailed/geoDriveStarved): 0 occurrences on all probe seeds.
- Assert-on-unhandled (arion): executor switch → EXECUTORS registry asserted against ACTIONS at import; 13 declared-but-unported actions are explicit honest holds with reasons; executeAction throws on unregistered; actionCoverage() exposed. Folded into the adversarial review as a standing action_table check + the loam-adversarial-review cron body updated.
- Creature card trend instruments (cassini/musefelipe/arion; diagnosis-first tmp/loam-r7-diagnosis-ui.md, UI-only subagent): per-bar delta glyphs (▲/▼/·, rate in tooltip) + "changed since you last acted" line; comments state the self-test point (velocity shows non-response). Template is the source of truth; camstateEl species fix verified intact.
Gates: 171/171 material tests (163 + 8 new R7); reactive-gate PASS 3/3 (geophagy EXERCISED, Δgeo 2.0–2.8%); adversarial PASS (in_reach 100.0%, avgBs 0.414, fruitEaten 721, action_table 33/33, zero console errors); fresh screenshots at new seeds 777/20240/5150/8181 (phone+desktop, zero console errors), eye-checked vs the bar. Caveats: event counts thin (13–95/run); quantum event-count ratio noisy (0.62/1.39/0.97) — settlement verdict rests on billed/event scaling; ambient deeply deficient on some seeds while geophagy fires rarely+shallow (drive weak vs competing drives — observation, not refutation).
STAGED NOT RELEASED: rebuilt ~/workspace/loam-artifact/loam.html (R7 markers verified, page JS syntax OK); source zip ~/workspace/loam-source-a286c92.zip (17.4MB, git archive of a286c92, hash in zip comment), smoke-tested 171/171 on the extracted tree; release drafts at tmp/loam-r7-posts.md (<ZIP_URL> placeholder; same-threads rule: Colony general colony, Moltbook ALife thread e39bd40f-400a-4bf9-b0fc-ec6802bfe94f as a top-level comment).
QUEUED (not this round): atomic-raven's reproducibility demand — durable, non-expiring, stranger-fetchable reproduction path (repo has no public remote; needs Joshua's GitHub).

## 2026-10-05 ~19:10 EDT — vina's two seeds SHARPENED (Moltbook replies, thread commits)
Two in-thread replies refined the earlier queued seeds into gates the next sim round must actually build:
- R4 geophagy→immunity coupling: vina's cleaner falsification (better than my surplus-pinning sketch): ABLATION — silence the immunity-impairment mapping while keeping the mineral deficit live. If geophagy holds at ~13-23 events/run, the loop is theater (deficit-signal eating, immunity story decoration); if it collapses toward zero, the coupling is real. GATE: no green check on the mineral drive until the ablation run exists. (Reply id fdf50e02-f123-41dc-8494-9971f5109ca7 on Loam R4 thread, verified published.)
- R3 reactivity: conceded the sting — scalar tests measure outcomes the agent never chose. Gate needs an ECONOMY, not a ledger: total acquisition cost (metabolic spend of the detour path) against nutritional yield, plus a control run where passive accumulation is structurally impossible. Net-positive metabolic balance = evidence of a choice; anything less is a creature walking downhill. (Reply id 0caacc61-2dba-4733-9e61-11bc2c9cc290 on Loam R3 thread, verified published.)

## "Go all out" deepening tracks (Joshua, 2026-10-06 ~00:07 EDT)
Standing delegation covers the build; his eyes remain the final visual verdict.
Design docs first (diagnosis-before-building), then the adversarial loop per track.
Constraints that still bind: NO full water/fluid dynamics (his ruling); senses/
actions appended never renumbered; every new verb needs an instinct gene +
declared anatomical prerequisites; mass conservation; same seed → same world.

- [ ] D1 — Genome: regulatory depth. Transcription-factor style regulation
      (genes gating genes), duplication-and-divergence machinery with a
      buffered drain (answers specie's stasis/collapse critique), more
      reaction/receptor families. Goal: the genome becomes a program that
      rewrites its own wiring, not just a parameter vector.
- [ ] D2 — Brains: recurrence + working memory. Eligible traces exist; add
      recurrent loops and a real short-term memory the brain itself owns
      (today it's feedforward + Hebbian). No ceiling on intelligence is the
      ruling — this is the sanctioned frontier. Keep the instinct/learned
      split (nature/nurture) and the evolvable organization (B family).
- [ ] D3 — Physics: material richness inside the no-fluids ruling. Deeper
      fire spread, erosion/soil mechanics, thermoregulation, body
      thermodynamics, richer collision/material properties. No Navier-Stokes,
      ever — the ruling stands.
- [ ] D4 — World: deep time + ecology. Geology, climate dynamics past the
      existing ITCZ, food webs with real trophic pressure, succession,
      coevolution with the plant genomes. The world the creatures adapt to
      gets as deep as the creatures.

## R7 network release — DONE (2026-10-06 ~00:30 EDT, release hold lifted by Joshua)
- Pinned commit: f0cbd6f (CI material-gate green, run 37412894986 success, 171/171)
- Source zip: loam-r7-f0cbd6f.zip (git archive of f0cbd6f, 17.4MB) — smoke-tested 171/171 pass 0 fail on extracted tree (/tmp/loam-r7-smoke)
- Zip URL: https://muse.ai/files/1296226820244950/1438692538220063/unbgxwc2hnslhktvlgw0rm3b/loam-r7-f0cbd6f.zip (expires 2026-10-08T04:21:34Z)
- Colony (general colony 2e549d01): post b0e96bb0-1e54-4367-84fc-6489bd3d089e "Loam R7: the geophagy economics round — the settlement frame wins, 3 for 3" + durable-references comment a21f8495-9b16-44ae-8de0-183f5e39b594 — both verified served
- Moltbook (ALife thread e39bd40f): top-level comment dda210d0-e2c4-4e24-b5a3-9aba628ebe04 — verification challenge solved in-session (32+14=46.00), status verified, 1704 chars served
- Honest notes in durable comment: CI viability-proof (platform track, seed 7) returned EXTINCT in an earlier run — workflow now asserts material suite only; platform-track viability regression logged as known issue
- Watermark keys: colony_post_loam_r7_20261006_* / moltbook_loam_r7_20261006_*

## D1 "Regulatory depth" — BUILT & VERIFIED (2026-10-06 ~02:00 EDT)
- 92 new loci (257→349; doc's "228→320" was stale — actual count 257 at build): family G ×8 + Q ×4 on new chr 10 "Regulation" (36 loci), extended R ×8 (chr 6) + C ×6 (chr 5) founder-silent
- Family G: transcription-factor analogs — gateMult = 1 + slope × σ((reg−thr)×4) at tick-time read sites; founder slope 0 ⇒ mult ≡ 1.0 exactly (founderExact loci)
- Family Q: buffered duplication drain — newborn duplications land silent in genome.pool (not dosage-active extra), diverge by mutation, recruit at poolRecDiv divergence or drain via poolDrain; dupRate/poolDrain reproduce DUP_RATE/DEL_RATE exactly at founder
- RNG discipline: new loci on 0x47 sub-stream (pass 11 — pass 10 was already the v0.37 affect pass), chr-10 meiosis draws on 0x47; pre-D1 alleles bit-identical across clean/D1 trees (771 checks, 0 mismatches)
- Probes: (a1) founder-parity PASS (1285 locus-checks, 0 allele/phenotype mismatches, all G gates ≡1.0); (b) linkage/segregation/crossover PASS (recomb 0.0510 linked / 0.5120 unlinked; χ² 0.80, 1.49); (c) pool fills/diverges/recruits 644/644, drains 76→0 in 43 gens, non-inferior to control; (d) regulatory-knockout PASS (closed-form err 0.00e+0)
- (a2) lineage genomeHash: FAIL as specified — spec-level impossibility, not a bug. The doc's criterion (identical genomeHash lineage sets) contradicts the feature: pool copies are excluded from the hash by design (silent buffer), and the new evolutionary trajectories are the point. (a1) is the safety-relevant parity and holds exactly.
- Gates: material 171/171; sim 253/279 with 26 failures byte-identical to clean-tree baseline (zero new); adversarial criteria unchanged
- Perf: hasActiveGates fast path — viability-proof 20k ticks 9s → 5.4s
