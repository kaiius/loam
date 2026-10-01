# Canopy v0.20 "Hands" + v0.21 "Ember" — design (technology + fire)

*Status: design only (2026-09-30). No src/ changes. Builds on v0.19
"Language" (commit 6970ed5); the v0.18+v0.19 release is published.*

*Governing lines: Joshua's vision — "tools from properties × verbs down
to the molecular level"; fire as the first disaster, from the world's own
natural laws. And Joshua's decided direction (EVODEVO_DESIGN.md §9.6,
2026-09-30, supersedes the `useTool`-verb sketch): technology does NOT
arrive as a pre-wired verb. Generic manipulation primitives (grasp,
carry, drop) + compositional physics. "Raft-building" is never an action
in the code — it is what the field notebook calls it when a lineage's
grasp-and-drop instincts produce something that floats. Termite logic:
no termite has a build-mound verb, just pick-up/put-down rules plus mud
physics. Verbs are observed, not issued.*

*Standing promise being kept: v0.17.1 introduced minerals as
observer-only entities ("CREATURES CANNOT USE MINERALS YET — tool use is
the future technology release's job"). This is that release.*

## 0. The idea in two paragraphs

**v0.20 "Hands":** tanglekins gain grasp, carry, and drop as real
creature actions (instinct genes at founder 0, dormant-action pattern —
the verbs sleep until selection wakes them). Minerals and timber stop
being observer-only: they are world objects with properties (hardness,
weight, sharpness, flammability), and a "tool" is never a coded item —
it is a carried object whose properties change what the carrier's
existing verbs do. A heavy hard stone in hand makes a strike hit harder;
a sharp flint edge makes a carried cut possible. Discovery runs
accident → repeat → tradition through the existing culture machinery;
the teacher's second lesson is tool use.

**v0.21 "Ember":** combustion enters as chemistry, not as an event
type. Fuel (dry vegetation, dead wood — read from the plant genome) +
heat + air ignites, spreads, and dies by the world's laws; ignition
comes only from lightning and from creature friction (two sticks need
hands — v0.20 is the prerequisite, which is why fire is second). Burns
bill through the existing injury channel; cleared land succeeds back
through the plant genome. Fire is built as the first *disaster*: a
lifecycle (start / propagate / end) that later disasters — disease,
storm — plug into unchanged.

## 1. v0.20 "Hands" — technology

### 1.1 What a tool is

A tool is a world object with properties, carried by a creature. There
is no `tool` entity kind and no `useTool` action. The engine models
three things; everything else is the field notebook's vocabulary:

1. **Objects** — minerals (flint, quartz, clay, timber, stone,
   driftwood — `MINERAL_TYPES` in world.js, already carrying `hardness`
   and blurbs that foreshadow this release), pebbles (already pushable),
   sticks (new: fallen-branch objects — see §1.2).
2. **Properties** — per material: `hardness` (exists), `weight`,
   `sharpness`, `flammability` (v0.21 fuel), `malleability` (clay).
   Properties are data on the material type, never special cases.
3. **Primitives** — grasp, carry, drop (§1.3). What the carrier *does*
   with the object is read through the object's properties by the
   existing verbs: a strike while carrying something heavy and hard
   lands harder; a groom/shove while carrying something sharp cuts.

Illustrations only (the engine never names these): heavy hard stone +
strike = hammer; sharp flint + carried = blade; long stick + thrust =
digging stick; driftwood + drop in water = raft (the driftwood blurb
already says "It floats — that is the whole affordance"). If the design
ever needs a `TOOL_NAMES` list in code, it has failed §9.6.

### 1.2 Materials

`MINERAL_TYPES` gains the missing properties (all floats 0..1,
founder-world values fixed — materials don't evolve, only their use
does):

| material | hardness | weight | sharpness | flammability | note |
|----------|----------|--------|-----------|--------------|------|
| flint | 0.9 | 0.5 | 0.9 | 0.0 | the blade material |
| quartz | 0.7 | 0.4 | 0.6 | 0.0 | |
| clay | 0.3 | 0.5 | 0.0 | 0.0 | malleable 1.0 — shaping is v+1 (pottery needs fire) |
| timber | 0.4 | 0.7 | 0.1 | 0.9 | fallen wood — fuel and hafts |
| stone | 0.8 | 0.9 | 0.2 | 0.0 | the hammer material |
| driftwood | 0.35 | 0.3 | 0.0 | 0.7 | floats (buoyancy reads weight) |

New object kind `stick`: fallen branches on the forest floor, spawned
by worldgen and by tree-fall events (dead trees become sticks — the
first decay chain; amount-limited, they rot back to litter after N
ticks if unused — nothing accumulates forever).

**Wear:** carried objects accrue `wear` 0→1 with use (each strike adds
`hardness(target)/hardness(tool)`-scaled wear — stone on stone wears
fast, stone on fruit barely). At wear 1 the object breaks: removed,
its material returns as one lower-grade sample (a broken hammer is
still a stone — conservation of matter, no vanishing). Wear is a
property, not a durability stat with a UI bar — the inspector shows it
because the engine models it.

### 1.3 The three primitives (Paul's v0.5 rule)

Each is a creature action in the brain's action set, each with an
instinct gene at **founder 0** (dormant-action pattern — the verbs
exist before any lineage wants them):

- **grasp** — pick up the nearest manipulable object within
  `groomReach` (the reach affordance EVODEVO §9.5 left in place).
  Requires a functional grasp pair (graspPairs ≥ 1 — founder 2, so
  anatomy is not the gate; instinct is). One object at a time;
  grasping while carrying drops nothing — the hands are full, the
  action fails honestly and the brain learns the contingency.
- **carry** — not a separate motion verb: carrying is a *state*.
  While carrying, `moveAlong`/`climb` cost ×(1 + weight) bloodSugar
  through the existing chemistry (heavy things are honest work) and
  the object's properties modify the carrier's verbs (§1.1).
- **drop** — release at the current position with the carrier's
  velocity (a throw is a drop with momentum — no separate throw
  verb; the physics does the rest).

New senses (appended, never renumbered — verify indices against
genome.js at build time; SENSE32 era):
- `objectNear` — manipulable object within reach (1/0)
- `heldWeight` — 0 when empty, else the carried object's weight

Instinct genes (founder 0, chromosome placement per the append-only
rule):
- `instObjectGrasp`: `objectNear` → grasp
- `instCarryDrop`: `heldWeight` high × no target → drop (the
  put-down reflex; carrying forever is never selected for)
- `instThreatStrike`: threat sense → strike-with-object (the hammer
  discovers itself: a creature holding a stone when threatened
  strikes harder — accident, then repeat)

**Strike** needs a note: there is no strike verb today. The design
adds no `attack` action either — a "strike" is the existing shove
impulse (cf. observer's `nudgeCreature`: a force, not a teleport)
with damage scaled by carried weight × hardness, billed through the
existing `injury` channel. Predators already read `injury`; the
machinery exists. This keeps the action set at three new verbs, not
four.

### 1.4 Discovery: accident → repeat → tradition

No scripted invention. The loop:

1. **Accident** — a creature with `instObjectGrasp > 0` picks up a
   stone; later, threatened, `instThreatStrike` fires; the stone
   lands harder than a bare shove. The brain's reward channel
   (existing) reinforces the sequence — this is ordinary learning,
   not a eureka flag.
2. **Repeat** — the individual's brain now selects grasp-then-strike
   under threat. Observable in the behavior log as a policy, not as
   an event type.
3. **Tradition** — the culture system (`culture.js`) gains a second
   tradition kind, `craft`, alongside `grove`: `{ kind: 'craft',
   material, verbPattern, inventor, carriers }`. Invention is
   detected the way groves are — clustered successful uses in
   space+time (cf. GROVE_MEALS/WINDOW/RADIUS) — and transmitted by
   `adoptTradition` with the existing fidelity machinery. A young
   creature that watches a carrier strike with a stone adopts the
   *craft tradition*, which votes (cf. `traditionVotes`) for the
   grasp instinct when objects are near.

Tradition pool: `MAX_TRADITIONS` (12) is shared. If craft traditions
crowd out grove traditions, that is selection among cultures — but
cap the blast radius: at build time, decide whether craft gets its
own sub-cap (open question, §9).

### 1.5 The teacher's second lesson

The teacher (v0.14/v0.17) taught language first. Tool use is the
natural second lesson — and the experiment is cleaner: language
needed the Rosetta stone; tools need a demonstration.

- `teacherDemo('carry'|'grasp'|'drop', targetObject)` — the teacher
  (which can already move objects? — no: the teacher has no
  godmode over the world. The teacher *carries* like a creature:
  grasp/carry/drop through the same primitives, no body, no
  biochemistry) performs the sequence where creatures can see it.
- `teacherReward` extends to tool use: reward creatures whose
  recent behavior log contains grasp→strike within the window —
  selection for culture on top of the accident loop.
- The v0.15 teaching-policy lessons (one lesson at a time, 40–60s
  cooldowns — FUTURE_NOTES) apply unchanged.

Whether the teacher is *required* (as with language's TEACHER
REQUIRED verdict) or merely accelerates is an empirical question
for the build's QA — and a Decision for Joshua (§9): teacher-gated
vs emergent.

### 1.6 Genome hooks — every gene live, no dead genes

- `instObjectGrasp`, `instCarryDrop`, `instThreatStrike` — the three
  instinct genes (§1.3). Live from birth (wired, founder 0).
- Dexterity reads through **existing** genes: `graspPairs` (more
  manipulators), `groomReach` (reach), `armLength` (via the bud
  program). No new dexterity gene — the manipulators-in-waiting
  from EVODEVO §9.5 are sufficient, and a redundant gene would be
  a dead gene wearing a costume.
- `heatTol` (existing, chromosome 1) becomes load-bearing in v0.21
  — fire tolerance is already in the genome, waiting for its reader.
  This is the dormant-gene mirror of the dormant-action pattern.

## 2. v0.21 "Ember" — fire

### 2.1 Combustion as chemistry

Fire is not an event type and not a creature. It is a reaction in an
extended reaction network:

```
fuel(dryness) + heat ≥ ignitionTemp + air → fire → heat + smoke + ash
```

- **Fuel** — read from the plant genome: `waterRet` inverts to
  dryness; dead wood (sticks, timber — §1.2) is fuel with dryness 1.
  Living wet vegetation (high waterRet, mangrove) does not catch —
  the biome map already knows what's wet.
- **Heat** — an environmental field on the world (per-region,
  0..1), raised by ignition and by burning fuel, decaying by
  dissipation. Not a chemical, not a drive — a world state, like
  water.
- **Air** — ambient constant per biome (oxygen is plentiful
  everywhere above water; underwater, fire cannot exist — the
  buoyancy branch already owns that region).
- **Smoke** — particulates: breathers inside smoke drain `oxygen`
  faster (the existing drowning/breath machinery reads it — no new
  chemical). Rendered, and honestly harmful.
- **Ash** — residue: boosts the plant `growthRate` locus locally
  (succession — §2.4). Fire feeds the forest that replaces it.

The chemistry invariant holds: no new drives; burns are hazards,
and hazards are chemicals and body states. A burn spikes `coreTemp`
and bills `injury` — the same channel a hard landing uses.

### 2.2 Ignition — from natural laws only

Two sources. Both lawful, neither dice:

1. **Lightning** — dry-season storms in arid/highland biomes.
   Requires a dry-season clock (world time already exists; if no
   seasonal cycle is modeled, the build adds one — a slow sine over
   the existing `world.time`, not a new subsystem). Lightning
   strikes the tallest fuel in a region when (dryness × storm) passes
   threshold — seeded rng, re-runnable, the counter-receipt holds.
2. **Friction** — a creature carrying two sticks (or stick + flint)
   that repeats a rub motion (grasp + rapid alternating drops? —
   build-time detail) generates heat at the contact point. This is
   why fire is v0.21 and not v0.20: ignition-by-friction needs
   hands. The first fire a lineage ever sees is lightning's; the
   first fire it ever *makes* is friction's.

Explicitly excluded: spontaneous combustion, volcanoes-as-ignition
(unless Joshua wants the volcanic biome — §9), godmode sparks.

### 2.3 Spread

Fire is an entity with `{ x, y, radius, intensity }`. Each tick:
for vegetation/objects within radius, ignite if
`dryness × intensity × windFactor > ignitionThreshold`, where
`windFactor` reads the biome's wind (new per-biome scalar, or reuse
ambientTemp gradients — build-time choice, documented either way).
Intensity grows with fuel consumed, dies as fuel exhausts. Water
biomes are absolute firebreaks; wet vegetation (high waterRet) is a
soft break. Spread is bounded by fuel and moisture — a wildfire
cannot cross the mangrove, by law.

### 2.4 Effects and succession

- **Burns**: creatures inside the radius take `injury` ∝ intensity
  × dt and `coreTemp` spikes; `heatTol` (existing gene) gates the
  damage — the dormant gene wakes.
- **Cleared land**: burned plants die (their genome is gone — no
  resurrection), sticks/timber consumed.
- **Succession**: ash boosts local `growthRate`; seeds (the existing
  dispersal loop) recolonize. The burn scar becomes the most fertile
  ground in the biome within a season — the ecology vision's
  cause-and-effect, and the reason fire is a *disaster* rather than
  an ending.

### 2.5 Creature responses — fear first, use later

1. **Fear/flee** — fire registers on the threat sense (existing);
   `adrenaline` spikes, flight follows. No new instinct needed for
   terror — the old ones work.
2. **Warmth** — near a dying fire (intensity low, heat moderate),
   `coreTemp` recovers in cold biomes. The first *use* of fire is
   standing near one — no technology required, just tolerance.
3. **Cooking** — open question (§9): a nutrition multiplier on food
   heated near fire. If yes, fire use becomes strongly selected —
   the fitness landscape tilts hard. The design can carry it either
   way; the decision changes the selection story.
4. **Land management** — a craft tradition (`fireStick`): carry a
   burning stick, drop it on dry grass. Fire-stick farming as
   *culture*, transmitted by the §1.4 machinery. This is the
   endgame of the release: the disaster, domesticated.

### 2.6 Fire as the first disaster — the lifecycle

Built so later disasters plug in unchanged:

```
disaster = { kind: 'wildfire', region, intensity, startedTick,
             propagate(world, dt), end(world) }
world.events: { type: 'disasterStart' | 'disasterEnd', disaster, t }
chronicle: entries on start, peak, end — the history remembers
observer: the danger panel (§13.6 pattern) shows 🔥 with kind,
          intensity, and the confinement law ("bounded by water and
          wet vegetation, not by walls")
```

Disease (v+1) reuses the lifecycle with `kind: 'blight'`,
region = biome, propagate = infection through the existing illness
channel. Storm reuses it with wind. The machinery is the disaster;
wildfire is its first tenant.

## 3. Phasing — why Hands then Ember

v0.20 first, v0.21 second, for three load-bearing reasons:

1. **Friction needs hands.** Ignition-by-friction — the only
   creature-controlled ignition source — requires grasp/carry/drop.
   Fire *use* (carrying brands, fire-stick farming) is manipulation.
   Building Ember first would leave half its verbs unwired.
2. **Materials before combustion.** Timber and driftwood gain
   `flammability` in v0.20 as inert properties; v0.21 lights them.
   Properties exist before their readers — the dormant pattern again.
3. **Risk ordering.** Technology perturbs foraging efficiency;
   fire can erase habitat. Ship the safer release first, re-prove
   viability, then introduce the disaster — each release gets its
   own long headless run, and the bar ("nothing ships as done
   until a long headless run proves a self-sustaining population")
   applies per release, not once.

## 4. Invariants respected

- **Paul's v0.5 rule:** grasp, carry, drop each get an instinct
  gene (§1.3). No `useTool`, no `makeFire` — there is nothing to
  attach a gene to, by §9.6's design.
- **Senses appended, never renumbered:** `objectNear`,
  `heldWeight` go after the current last sense (SENSE32 era —
  verify indices in genome.js at build time).
- **Chemistry invariant:** combustion extends the reaction network
  (fuel + heat + air → heat + smoke + ash); drives stay readouts;
  burns bill through `injury`/`coreTemp`, existing channels.
- **No dead genes:** the three instincts are wired at founder 0;
  dexterity rides existing loci; `heatTol` is pre-existing and
  wakes in v0.21.
- **Append-only genome:** new loci appended; new chromosome only if
  the family structure demands it (three instinct genes fit the
  existing instinct-gene pattern — no new chromosome expected).
- **Cause and effect, never dice:** ignition thresholds, spread,
  and discovery all run on seeded world rng and modeled state.
  Lightning is a law with a threshold, not a random event.
- **Founder-exactness:** all new instincts at 0, all new physics
  bonuses +0 → the v0.19 viability battery must pass unchanged.
  This is the migration's load-bearing test, as in every version.

## 5. Risks to the self-sustaining bar

1. **Tool-amplified over-extraction.** A hammer lineage cracks
   everything: fruit, eggs, minerals — extraction outruns
   regrowth. Mitigations: wear/breakage (§1.2) caps per-tool
   yield; deposits are already depleting real state; the viability
   battery runs *with* tools enabled. Honest note: if tools crash
   a seed, that is a finding about the invention, not a bug to
   patch away — report it, then decide (cf. the 0.3 legPower
   verdict: the battery arbitrates honestly, not cleanly).
2. **Wildfire habitat loss.** A dry-season lightning strike in the
   wrong biome at the wrong tick could clear a founder grove.
   Mitigations: spread bounded by fuel/moisture/water (§2.3);
   succession refertilizes (§2.4). The battery must include
   dry-season seeds — fire-off control vs fire-on, same seeds.
3. **Tradition pool saturation.** Craft traditions compete with
   grove traditions for 12 slots. If tool culture crowds out food
   culture, lineages starve *culturally*. Watch the ratio in the
   long run; the sub-cap question is §9.
4. **Cooking dominates.** If the nutrition multiplier ships (§9),
   fire-users outcompete everyone within generations — the
   release becomes "the cooking update" the way §1 of EVODEVO
   refused to be "the wing update." The multiplier's size is a
   tuning decision with a runaway mode; default it small or off
   until the battery says otherwise.

## 6. QA gates (same bar as every version)

- Full suite green (current 237 + new tests).
- **Founder-exactness**: new instincts 0, new bonuses +0 →
  v0.19 viability battery passes unchanged.
- **Primitive tests**: grasp lifts a pebble; carry adds
  weight-scaled bloodSugar cost; drop releases with velocity;
  hammer (heavy+hard carried) out-damages bare shove through the
  injury channel; wear breaks the tool and returns material.
- **Degradation**: grasp with no grasp pairs fails honestly;
  carry with empty hands is a no-op the brain learns.
- **Tradition tests**: clustered successful uses found a craft
  tradition; a juvenile adopter's grasp instinct votes under
  `objectNear`; fidelity noise present but bounded.
- **Fire tests**: lightning ignites a dry stand, not a wet one;
  spread stops at water; burns bill `injury`/`coreTemp`;
  `heatTol` gates damage; succession: ash region regrows faster
  (growthRate boost measurable); smoke drains `oxygen` faster.
- **Disaster lifecycle**: start/propagate/end events fire;
  chronicle records all three; observer danger panel shows the
  confinement law.
- **Long headless run per release** — the bar. v0.20's run proves
  tools don't crash the population; v0.21's proves fire doesn't.

## 7. Deferred (v+1 and beyond)

- **Pottery**: clay (malleable 1.0) + fire = fired vessels. Needs
  the hearth decision (§9) — sustained heat, not wildfire.
- **Metallurgy/smelting**: sustained high heat + ore (no ore
  mineral exists yet — the material table is appendable).
- **Controlled burns as agriculture**: the `fireStick` tradition
  maturing into planned succession management — culture, not code.
- **Hafting/composite tools**: binding stone to stick (lashing
  material? sinew?) — compositional physics already covers it
  once the materials exist; no new verbs.
- **Disease and storm**: the disaster lifecycle's next tenants
  (§2.6).

## 8. Open questions (not Joshua's — the build's)

- Craft tradition sub-cap vs shared pool (§1.4): decide at build
  time, document the choice.
- Wind: new per-biome scalar or reuse of ambient gradients (§2.3).
- Friction-ignition gesture: exact primitive sequence (build-time
  detail, must be discoverable by accident — if the sequence is
  too precise, no lineage ever stumbles into it).
- Seasonal clock: does `world.time` already carry a usable dry
  season, or does the build add the slow sine (§2.2)?
- `heldWeight` sense resolution: continuous 0..1 or thresholded —
  the brain learns either; pick at build time.

## 9. Decisions for Joshua

1. **Fire control: hearth or found-fire only?** Can creatures tend
   a persistent fire (a hearth entity — carried embers, fed fuel),
   or only use fire they find (warmth near dying burns, cooking at
   the edge)? A hearth is a bigger build and the road to pottery
   and smelting; found-fire-only keeps v0.21 tight.
2. **Teacher-gated or emergent tools?** Does tool use require the
   teacher's second lesson, or can accident → tradition do it
   alone (teacher merely accelerates)? Language needed the teacher;
   tools might not.
3. **Ignition sources: lightning alone, or a volcanic biome too?**
   Lightning is the smaller build; a volcanic biome is new
   geography with its own readers — but it would make fire
   permanent somewhere, which changes the selection story.
4. **Cooking: nutrition multiplier or not?** Heated food worth more
   would strongly select for fire use — possibly *too* strongly
   (§5.4). Ship it small, ship it off-until-proven, or ship it
   full?
5. **Tradition pool: shared 12 or a craft sub-cap?** Tool
   traditions competing with grove traditions for the same 12
   slots is honest cultural selection — but risks starving food
   culture. Your call before the build.

## 10. Joshua's decisions (2026-09-30)

1. **Fire control: hearth, and emergent.** Creatures can learn to
   tend fire — it is a behavior and a skill they can come up with
   on their own, not a teacher-gated trick. Hearth entity ships;
   the invention pathway is discovery, not instruction.
2. **Tools: accident → tradition first.** Accident and tradition
   are the main pathways; the teacher is last resort, or for
   specific reasons. Build the emergent path as the real one —
   the teacher merely accelerates or rescues.
3. **Volcanic biome: yes — with full physics.** Fire gets a
   permanent home. But if the volcano erupts, the build must
   include ALL the physics: eruption mechanics, ash fallout,
   ecological aftermath, succession. No decorative volcano.
4. **Cooking multiplier: yes, as recommended.** Ships per §5.4's
   caution — default small or off until the battery says
   otherwise. Selection pressure is real but must not make this
   "the cooking update."
5. **Tradition pool: honest selection.** Tool traditions compete
   with grove traditions for the same 12 slots. If tool culture
   starves food culture, that is a finding, not a bug — watch
   the ratio in the long run.
