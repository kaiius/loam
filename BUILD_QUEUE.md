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
- [ ] v0.25 — heat physics: T(x,t) living field; thermal mass (water slow,
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
- [ ] v0.27 — species-tag mating gate (ECOLOGY_DESIGN §13.2): inherited
      species-tag; gate mating on tag match; SPECIES-level not tribe-level
      (tanglekin × tanglekin across tribes must succeed); new loci from own
      sub-stream; default-neutral so viability battery passes unchanged.
      Probe: forced tanglekin×beetle fails, tanglekin×tanglekin succeeds.
- [ ] v0.28 — morsel retirement (design §5, §13.8: retired, not kept
      alongside): morsels no longer spawn/tick; drop 'morsel' from
      MEAT_KINDS. CHECK FIRST: scavenger guild food supply — carrion must
      cover it; if the guild starves, say so loudly. Probe: 10k ticks, zero
      morsel spawns, scavengers fed.
- [ ] v0.29 — leg-pressure experiment (BIOMES_DESIGN §13.7): isolate leg
      weakness from illness/contamination confound; fix sub-stream seeding
      confound; find the leg value where climb-pressure is readable
      independently of illness deaths. Measurement task — report number +
      method. Gets a verdict, not just code.
- [ ] v0.30 — pollination, properly (design §6.1): flower state, pollen tags
      (carrier + flora species id + viability timer), deposition on second
      flower of same species → fruit set; wind/selfing fallback per design.
      Probe: exclosure experiment — netted vs open flowers, fruit set differs.
- [ ] v0.31 — seed dispersal vectors (design §6.2) + water current field
      (§13.6): endozoochory (gut timer → deposition away from parent) +
      hydrochory (current field per water biome → wash-ashore zones).
      Gravity-only dispersal ends. Probe: seed-voyage gate — seeds deposited
      away from parents; new ground colonized.
- [ ] v0.32 — §14 ecological QA gates: pollinator-crash cascade, 50k-tick
      food-web persistence, seed voyage (≥2/10), predator–prey cycle,
      defense evolution, colonization both-outcomes, physiological-confinement
      grep. Pass/fail per gate with evidence; un-runnable gates get a named
      owner + trigger, never silence.
- [ ] v0.33 — three instruments: (a) generation-50 drift watch (teacher
      prototypes vs ridge sound shadows); (b) jump-weakening clean test
      (measured number replaces unprincipled one); (c) duplication-to-fixation
      demo (DUP_RATE, dupLog — show a fixation or report why not).

## Design queue (after lexicon v0.21) — design-first, not build stream
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
      proposed v0.34 'Scars'): the body becomes parts DERIVED FROM THE BAUPLAN —
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
