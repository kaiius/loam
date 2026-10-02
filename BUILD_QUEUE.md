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
      baseline); probe probes/pollination-exclosure.mjs PASS (seed 7:
      open 8754 fruit vs netted 6145, +42% uplift, netted baseline > 0).
- [ ] v0.35 — seed dispersal vectors (design §6.2) + water current field
      (§13.6): endozoochory (gut timer → deposition away from parent) +
      hydrochory (current field per water biome → wash-ashore zones).
      Gravity-only dispersal ends. Probe: seed-voyage gate — seeds deposited
      away from parents; new ground colonized.
- [ ] v0.36 — §14 ecological QA gates: pollinator-crash cascade, 50k-tick
      food-web persistence, seed voyage (≥2/10), predator–prey cycle,
      defense evolution, colonization both-outcomes, physiological-confinement
      grep. Pass/fail per gate with evidence; un-runnable gates get a named
      owner + trigger, never silence.
- [ ] v0.37 — three instruments: (a) generation-50 drift watch (teacher
      prototypes vs ridge sound shadows); (b) jump-weakening clean test
      (measured number replaces unprincipled one); (c) duplication-to-fixation
      demo (DUP_RATE, dupLog — show a fixation or report why not); (d) live
      world-weather readout (Joshua 2026-10-02: season phase + temperature in
      °C + sky state as a standing view, not a one-off probe —
      probes/world-weather.mjs is the snapshot version; promote it to a live
      instrument reading the running world).
- [ ] v0.38 — tribe-divergence instrument (Joshua 2026-10-01): track
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
