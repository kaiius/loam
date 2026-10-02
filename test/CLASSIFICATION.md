# Failure classification — v0.35 baseline (60 pre-existing failures)
# v0.36; protocol: design/qa-rebaseline.md
# PLUMBING = test scaffolding broken, not the sim. BEHAVIOR = sim changed under the test.
# UNCLASSIFIED entries are treated as BEHAVIOR. Re-baselining a BEHAVIOR
# failure requires the canary rule (design/qa-rebaseline.md section 3).
#
# NOTE (v0.36): the vulture gate tests are RED in this baseline
# ("vulture persists 5k ticks on carrion alone": 0/3 alive; "scavenger gate":
# 1.15 vs 1.00 corpse mass). Per the canary rule these are BEHAVIOR, not
# plumbing — they may not be re-baselined without the both-wirings check.

- [PLUMBING] test/bite.mjs: v0.22.1: spikeArmor reduces damage
    TypeError in test scaffolding: TypeError: Cannot read properties of undefined (reading 'y')
- [PLUMBING] test/bite.mjs: v0.22.1: bite with no creature in range is a clean miss
    TypeError in test scaffolding: TypeError: Cannot read properties of undefined (reading 'y')
- [BEHAVIOR] test/language-proof.mjs: test/language-proof.mjs
    top-level proof fails; pre-existing (language-proof red since v0.22 per v0.23 entry)
- [PLUMBING] test/realms-creature.mjs: v0.18: refreshWaterState — submerged is 14px+ below the surface
    TypeError in test scaffolding: TypeError: Cannot read properties of null (reading '2')
- [PLUMBING] test/realms-creature.mjs: v0.18: buoyancy — a body floats to 11px below the surface and stays
    TypeError in test scaffolding: TypeError: Cannot read properties of null (reading '2')
- [PLUMBING] test/realms-creature.mjs: v0.18: swim in water with membranes — 2D steering at swimSpeed
    TypeError in test scaffolding: TypeError: Cannot read properties of null (reading '2')
- [PLUMBING] test/realms-creature.mjs: v0.18: swim without membranes — flailing at ~12px/s, 3× oxygen cost
    TypeError in test scaffolding: TypeError: Cannot read properties of null (reading '7')
- [BEHAVIOR] test/realms-creature.mjs: v0.18: swim on land is an honest flop
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: no water → flop
- [PLUMBING] test/realms-creature.mjs: v0.18: dive holds depth; oxygen gates the ascent
    TypeError in test scaffolding: TypeError: Cannot read properties of null (reading '2')
- [PLUMBING] test/realms-creature.mjs: v0.18: drink adjacent water restores hydration; far water does not
    TypeError in test scaffolding: TypeError: Cannot read properties of null (reading '2')
- [BEHAVIOR] test/realms-creature.mjs: v0.18: bask warms in warmth, not in cold
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: basking in the arctic does n
- [BEHAVIOR] test/realms-creature.mjs: v0.18: spawnPredators — 5 sharks, 2 bears, in the right waters
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: shark in eastern waters: x=5
- [BEHAVIOR] test/realms-creature.mjs: v0.18: bears — jungle heat kills, arctic cold does not
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: arctic bear survives its hom
- [BEHAVIOR] test/realms-world.mjs: v0.18: the 12 old jungle climb links survive the x-scaling
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: old climb link 3-6 survives
- [BEHAVIOR] test/realms-world.mjs: v0.18: platformIndexAt finds the jungle floor
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: Expected values to be strict
- [BEHAVIOR] test/realms-world.mjs: v0.18: populateGenesis spawns 8 cohorts, 3–5 creatures each, both sexe
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: 8 cohorts of 3–5 (got 17)
- [BEHAVIOR] test/realms-world.mjs: v0.18: genesis allele shifts land on the biome-suited loci
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: arctic fur shifted up
- [BEHAVIOR] test/realms-world.mjs: v0.18: spawnBuriedFood caches per-biome provender
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: Expected values to be strict
- [BEHAVIOR] test/realms-world.mjs: v0.18: spawnMobileFood stocks bugs and minnows per biome
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: Expected values to be strict
- [BEHAVIOR] test/realms-world.mjs: v0.18: spawnResources lays timber, stone, driftwood, clay
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: Expected values to be strict
- [BEHAVIOR] test/realms-world.mjs: v0.18: spawnBiomeFlora plants all eight morphs
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: morph tree planted
- [BEHAVIOR] test/realms-world.mjs: v0.18: noFouling neutralizes waste — soil, odor, and the illness path
    asserts sim behavior; sim changed under it: TypeError: Cannot read properties of undefined (reading 'was
- [BEHAVIOR] test/realms-world.mjs: v0.18: noteDeath leaves a corpse; arctic cold slows the rot
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: arctic corpse: 150 × (1 + 2×
- [BEHAVIOR] test/render-svg.mjs: test/render-svg.mjs
    top-level proof fails; pre-existing (language-proof red since v0.22 per v0.23 entry)
- [PLUMBING] test/sim.mjs: v0.19: ridge shadow reaches the ear — callsHeardBy carries it
    TypeError in test scaffolding: TypeError: Cannot set properties of undefined (setting 'soli
- [BEHAVIOR] test/sim.mjs: v0.6: per-creature sight range is used for sensing
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: food at 500px should be sens
- [BEHAVIOR] test/sim.mjs: v0.11: no eat-livelock — the eat action approaches distant sensed food
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: eat approaches food (moved 1
- [BEHAVIOR] test/sim.mjs: v0.12: creatures imprint on their birthplace as home
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: home platform recorded
- [PLUMBING] test/sim.mjs: canopy: eating restores bloodSugar, company restores oxytocin
    TypeError in test scaffolding: TypeError: Cannot read properties of undefined (reading 'x1'
- [PLUMBING] test/sim.mjs: canopy: prolonged starvation writes an epigenetic mark
    TypeError in test scaffolding: TypeError: Cannot read properties of undefined (reading 'x1'
- [BEHAVIOR] test/sim.mjs: physics: directed feet walk off the edge; wanderers turn around
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: walked off the mid branch — 
- [BEHAVIOR] test/sim.mjs: physics: falling onto a lower platform lands you standing on it
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: landed on the lower branch
- [BEHAVIOR] test/sim.mjs: physics: jumpNear sees a leapable ledge, and only that
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: ledge overhead registers (ju
- [BEHAVIOR] test/sim.mjs: v0.13: arid zone stresses thirsty plants, spares water-retainers
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: retainer interval 12.1 < thi
- [BEHAVIOR] test/sim.mjs: v0.14.1: plants shed litter — the unused parts feed the ground
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: litter accumulated in the so
- [PLUMBING] test/sim.mjs: v0.14.1: rich ground enters the chronicle — the land remembers
    TypeError in test scaffolding: TypeError: Cannot set properties of undefined (setting 'wast
- [BEHAVIOR] test/sim.mjs: v0.17: swim on land is an honest flop
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: a flop barely moves
- [BEHAVIOR] test/sim.mjs: v0.17.1: placeFood re-enters through addFood — creatures really eat it
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: doEat accepts observer-place
- [BEHAVIOR] test/sim.mjs: v0.20: integrateGravity — a body falls and lands on a platform
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: lands on the jungle floor
- [BEHAVIOR] test/sim.mjs: v0.20: the mountains gap is filled — no fall through the ground
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: on a fill platform (got 14)
- [BEHAVIOR] test/sim.mjs: v0.20: anti-slip — a body just under its platform climbs back out
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: back on the platform
- [BEHAVIOR] test/sim.mjs: v0.20: beached shark falls under gravity — no more hovering
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: fell to the jungle floor
- [BEHAVIOR] test/sim.mjs: v0.20: shark cannot swim under the desert — the shore is solid
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: never inside the earth
- [BEHAVIOR] test/sim.mjs: v0.20: shark cannot dive through the seabed
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: never below the shallows sea
- [BEHAVIOR] test/sim.mjs: v0.20: shark may still beach honestly onto the sand
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: rests on the ground, not und
- [BEHAVIOR] test/sim.mjs: v0.20: bear ambles grounded — walks the ice, turns at the brink
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: stays on the arctic ice
- [BEHAVIOR] test/sim.mjs: v0.20: the landing startle scales with the fear the fall produced
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: a frightening fall startles 
- [BEHAVIOR] test/sim.mjs: v0.20: a canopy-to-floor fall strands — an event, not a footnote
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: landed on the jungle floor
- [BEHAVIOR] test/sim.mjs: v0.20: windfall — expired canopy fruit drops to the floor, leaves do n
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: the fallen fruit lands inste
- [BEHAVIOR] test/sim.mjs: v0.25 §10 acceptance: max-fur founder in the desert interior dies of h
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: desert interior is hot: 0.66
- [BEHAVIOR] test/sim.mjs: v0.25: plant heat stress follows the generated field and heatTol
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: heat-intolerant desert plant
- [PLUMBING] test/species.mjs: v0.22: detritivore grazes soil waste — dung becomes food
    TypeError in test scaffolding: TypeError: Cannot set properties of undefined (setting 'wast
- [PLUMBING] test/species.mjs: v0.22: founder biomass — multiplier exactly 1.0, old soil behavior pre
    TypeError in test scaffolding: TypeError: Cannot set properties of undefined (setting 'wast
- [PLUMBING] test/species.mjs: v0.22: bacteria grow on waste, then crash when it runs out
    TypeError in test scaffolding: TypeError: Cannot set properties of undefined (setting 'wast
- [PLUMBING] test/species.mjs: v0.22: temperature-sensitive — arctic slow, jungle fast
    TypeError in test scaffolding: TypeError: Cannot set properties of undefined (setting 'wast
- [BEHAVIOR] test/species.mjs: v0.22: sterilization probe — low-biomass soil decomposes measurably sl
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: Expected values to be strict
- [PLUMBING] test/species.mjs: v0.22: noFouling still neutralizes the living layer
    TypeError in test scaffolding: TypeError: Cannot set properties of undefined (setting 'wast
- [BEHAVIOR] test/species.mjs: v0.22 QA: scavenger gate — corpse clearance drops where vultures range
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: vultures clear faster: 1.15 
- [BEHAVIOR] test/species.mjs: v0.22 QA: vulture persists 5k ticks on carrion alone
    asserts sim behavior; sim changed under it: AssertionError [ERR_ASSERTION]: vulture population persists:
- [BEHAVIOR] test/viability-proof.mjs: test/viability-proof.mjs
    top-level proof fails; pre-existing (language-proof red since v0.22 per v0.23 entry)

Totals: 17 PLUMBING, 43 BEHAVIOR, 0 UNCLASSIFIED.
