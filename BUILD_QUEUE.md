# Canopy build queue — as of 2026-10-01 (Joshua-approved)

Standing constraints: nothing touches ~/workspace/canopy/ until proof verdicts
(~Fri Oct 9 evening EDT). All work in ~/workspace/canopy-v020. Versioned
commits, execution probes before "built" reports. Senses/actions appended,
never renumbered. New loci from their own RNG sub-stream. Same seed → same
world. No species labels in sense vectors (§9.4 grep gate).

## Build stream (in order)
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
- [ ] v0.30 — species-tag mating gate (ECOLOGY_DESIGN §13.2): inherited
      species-tag; gate mating on tag match; SPECIES-level not tribe-level
      (tanglekin × tanglekin across tribes must succeed); new loci from own
      sub-stream; default-neutral so viability battery passes unchanged.
      Probe: forced tanglekin×beetle fails, tanglekin×tanglekin succeeds.
- [ ] v0.31 — morsel retirement (design §5, §13.8: retired, not kept
      alongside): morsels no longer spawn/tick; drop 'morsel' from
      MEAT_KINDS. CHECK FIRST: scavenger guild food supply — carrion must
      cover it; if the guild starves, say so loudly. Probe: 10k ticks, zero
      morsel spawns, scavengers fed.
- [ ] v0.32 — leg-pressure experiment (BIOMES_DESIGN §13.7): isolate leg
      weakness from illness/contamination confound; fix sub-stream seeding
      confound; find the leg value where climb-pressure is readable
      independently of illness deaths. Measurement task — report number +
      method. Gets a verdict, not just code.
- [ ] v0.33 — pollination, properly (design §6.1): flower state, pollen tags
      (carrier + flora species id + viability timer), deposition on second
      flower of same species → fruit set; wind/selfing fallback per design.
      Probe: exclosure experiment — netted vs open flowers, fruit set differs.
- [ ] v0.34 — seed dispersal vectors (design §6.2) + water current field
      (§13.6): endozoochory (gut timer → deposition away from parent) +
      hydrochory (current field per water biome → wash-ashore zones).
      Gravity-only dispersal ends. Probe: seed-voyage gate — seeds deposited
      away from parents; new ground colonized.
- [ ] v0.35 — §14 ecological QA gates: pollinator-crash cascade, 50k-tick
      food-web persistence, seed voyage (≥2/10), predator–prey cycle,
      defense evolution, colonization both-outcomes, physiological-confinement
      grep. Pass/fail per gate with evidence; un-runnable gates get a named
      owner + trigger, never silence.
- [ ] v0.36 — three instruments: (a) generation-50 drift watch (teacher
      prototypes vs ridge sound shadows); (b) jump-weakening clean test
      (measured number replaces unprincipled one); (c) duplication-to-fixation
      demo (DUP_RATE, dupLog — show a fixation or report why not).
- [ ] v0.37 — tribe-divergence instrument (Joshua 2026-10-01): track
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

## Design queue (after lexicon v0.21) — design-first, not build stream
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
      proposed v0.36 'Scars'): the body becomes parts DERIVED FROM THE BAUPLAN —
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
