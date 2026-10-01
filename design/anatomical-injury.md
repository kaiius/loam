# Anatomical injury — design v1 (Joshua-approved 2026-10-01)

## Premise
Injury today is a scalar (`biochem.injury` 0–1): bruises, shock, healed clean.
This design gives the body parts. A tanglekin can be wounded, maimed, or lose a
part outright — and the loss is functional, visible, and permanent. No mercy
rules: some injuries end lives, some change them.

## 1. The part model — derived from the bauplan, never hardcoded
The engine NEVER branches on species (a species IS a founder genome: same 228
loci, different founder values). So the part list is not a table — it is built
at birth by `partsFromMorphology(pheno)`, reading the same morphology loci for
every creature:

- limbs the bauplan grew (arms/legs/wings/fins — whatever the bud loci
  expressed; the bird founder's wings are parts, the bug's segments are parts)
- tail instances = tailCount (prehensile or not per tailGrip)
- hands/grasp organs where the bauplan puts them
- eyes, ears per the head plan

The 11-part tanglekin list (tail, 2 arms, 2 hands, 2 legs, 2 eyes, 2 ears) is
just what the function returns for the tanglekin founder. A bug founder gets
chitin segments; a skimmer gets wings. Each part instance carries `integrity`
0–1, with the same states: healthy > 0.6 / wounded 0.3–0.6 / maimed 0–0.3 /
lost at 0. Lost is permanent — no regen in adults, any species.

Cost: ~a dozen floats per creature. Trivial.

## 1b. Evolution acts on the system at two levels
Joshua's requirement (2026-10-01): this must adapt and evolve with natural
selection — not sit beside it.
- **Level 1 — the injury genes are ordinary diploid loci.** partToughness,
  clottingSpeed, painTolerance evolve like anything else. Lineages under heavy
  predation evolve tougher parts and faster clotting; pain tolerance trades off
  (too high → fights on with fatal wounds; too low → cowers at a scratch).
- **Level 2 — the bauplan itself evolves under injury pressure.** Because parts
  derive from morphology, selection reshapes the body: shorter tails where
  predators grab tails, heavier chitin where spikes are common, redundant
  limbs where falls maim. The world with maiming in it selects different
  bodies than the world without — that is the adaptation.
- **Evolved parts are injurable from birth.** If tailCount evolves upward, the
  new tails get integrity state automatically — the engine iterates instances,
  never a fixed list.
- **Symmetric machinery.** Predators are creatures too: spike retaliation can
  maim a predator's mouthparts; a hunter that loses an eye hunts worse.
  Scavengers (the vulture founder) eat the severed-part morsels — the food web
  closes the loop.

## 2. Damage sources & targeting
Scalar injury stays (bruises/shock). Anatomical damage rides on top, only from
events violent enough to break tissue:
- **bite**: targets one exposed part, weighted by context — predators going for
  a chase target hit legs/tail; social fights (rival bites) hit ears/hands.
  Damage = f(attacker mouthSize × mass, defender partToughness).
- **falls** past the damage threshold: legs take it.
- **spikes**: whatever part contacts.
- **thrown objects** (carry/strike): random exposed part.
- **fire / lightning** (v0.23/v0.24 tenants): whole-body + random parts.
- **predator kill bites**: can sever.

## 3. Functional consequences — the teeth
- **tail**: climbSpeed × (0.5 + 0.5·integrity); lost → no tail-wrap on climb
  links, fall risk up, balance penalty to brachiate.
- **arm**: one lost → climb at ~60%, no brachiate, carry capacity halved;
  both lost → cannot climb at all. A tanglekin that cannot climb lives on the
  ground or dies — the world's first disability stories.
- **hand**: grasp success = f(gripStrength × handIntegrity); below 0.5 the
  chronicle notes "missing fingers" and held objects get a drop chance.
- **leg**: walk speed and jump impulse scale with integrity; one lost → hopping
  gait (slow, no jump); both lost → crawling. Gait is automatic, not an action —
  the limp is visible before anything else.
- **eye**: vision senses (light, foodDist/Dir, creatureDist/Dir, creatureSize,
  toyDist/Dir, farLedge, objectNear) gain noise ∝ lost integrity; one eye →
  jump accuracy down (no depth perception — jumpNear/farLedge noisier);
  both → blind: vision senses read 0, navigates by hearing/touch.
- **ear**: callHeard/callPitch range shrinks with integrity; both lost → deaf:
  **no lexicon reception at all.** A deaf tanglekin cannot hear the teacher's
  FOOD/DANGER/COME — the language arc has casualties.

## 4. Healing, scarring, permanence
- Wounded parts heal with rest (fast asleep, slow awake) — same rhythm as
  scalar injury.
- Maimed parts heal only back up to wounded: the scar floor is permanent.
- Lost is lost. No regen, no prosthetics in the design (technology arc v0.24
  'Making' may revisit this — a tool-using culture could invent the crutch;
  that would be earned, not granted).
- **Infection hook**: wounds are the future entry point for the contagious
  disease tenant (design queue). Build scars now, infect them later —
  anatomical injury is a dependency of disease, not the reverse.

## 5. Pain — a new sense
`pain` appended to the sense vector (before bias; never renumber — N_IN 37→38):
pain = f(recent part damage, decaying). The brain learns what pain predicts:
flee, rest, self-medicate. Pain tolerance is genetic (§6).

## 6. New genes (appended, own RNG sub-stream, worldgen order untouched)
- `partToughness` — damage resistance per part
- `clottingSpeed` — how fast bleed-out stops (§7)
- `painTolerance` — how much pain inhibits action selection
No new action is strictly required (limping/gait is automatic). Optional:
`tendWound` (clean a wound — infection-risk reduction when disease lands)
would need its instinct gene per Paul's rule; deferred to the disease build.

## 7. Bleed-out
Maimed/lost parts bleed: health drains until `clottingSpeed` stops it. This is
the urgency mechanic — a severed tail unfought is survivable; a mauled leg
alone in the canopy is not. Grooming a wounded creature helps clotting stop
sooner (small, real, social).

## 8. Mass conservation — nothing disappears
A severed part becomes a world object: a morsel on the ground/branch.
Scavengers (some predator founders are omnivorous) may eat it. Grim, honest,
and it ties directly into the queued morsel-retirement work (v0.28).

## 9. Rendering (painter.js)
Damage states per part: wounded (scar lines, inflammation tint), maimed (held
wrong — arm tucked, head tilted for ear), lost (stump rendering, scarred-shut
eye, notched ear). Gait: limp cycle for leg damage, tail-drag. Posture: pain
crouch joins the honest-body set (fear crouch, hunger stoop already exist).
Scars persist — old warriors look it.

## 10. Chronicle, social, sexual selection
- Chronicle logs maimings and losses ("…lost her tail to a fall").
- Mate choice: slight evolvable preference for symmetry/health — scars as
  honest signals. A survived maiming reads both ways (damaged goods vs proven
  survivor); the preference itself evolves, we don't script the verdict.
- Predator interplay: the queued **evolved prey assessment** sense reads
  injury — a limping gait is visible vulnerability. Predators will evolve to
  pick the limping over the spiky. This design feeds that queue item directly.

## 11. UI
Creature select panel gains a body-condition diagram: small silhouette, parts
colored healthy/wounded/maimed/lost. Hover names the part and its penalty.

## 12. Ethics note (not solved here)
Disability in a watched world raises keeper questions — do we intervene for a
creature that can't climb? The ethics gate (before keepers v0.23) owns this.
This design takes no position; it only makes the suffering legible.

## 13. Execution probe (before any "built" report)
Force a severe bite to a founder's leg in a live sim and verify: limp gait
renders, jump impulse penalized, chronicle line logged, painter shows the
maimed leg, clotting stops the bleed, scar floor holds after healing. Then the
same for an eye (vision noise) and an ear (call range).

## 14. Version slot
Proposed **v0.34 'Scars'** — after instruments (v0.33), before the contagious
disease tenant (wounds are its entry point). Design-first like the rest of the
queue; build only after Joshua's go.

## 15. Reference: Paul's Wildcode v0.18 'The Body Remembers' (2026-10-01)
Source: ~/workspace/paul-review/wildcode-v018/ — anatomy.js (329 lines) +
DESIGN-anatomy.md. Evaluated in full. Steal list for the v0.34 build:
1. **Dependency-free anatomy module** — imports nothing; creature/fauna/world/
   chronicle share it without cycles. Copy the architecture.
2. **Cached-per-tick mods** — `computeAnatMods` runs once per tick into
   `c._anat`; a frozen NEUTRAL_MODS default. The brain is never told — senses
   go silent, the animal experiences a changed world. Copy the pattern.
3. **partEfficiency curve** — scarred (≤50%) → 0.4, bruised → 0.7–1.0,
   lost → 0. Copy the shape.
4. **Regen tradeoff math** — smooth gradient above a 0.3 threshold (no cliff):
   hunger rises, quick-patch slows. Regrown parts return scarred (capped 50%).
   Copy the math IF regen is approved (Joshua's call — see below).
5. **Geometry-routed bites** — angle + size ratio (engulf/hamstring rules).
   Copy the structure.
6. **Fatal parts** — torso/head loss = death. Copy.
7. **maimedVisible** — body read socially (20% mate rejection). Copy the idea.
8. **Damage never inherited** — offspring born whole; only genes pass. Adopt
   explicitly (already implied here).
Rejected: BODY_PLANS keyed by named species (quadruped/wolf/squid/prey/critter)
— violates the no-species-branching rule; ours derives parts from morphology
via partsFromMorphology. Also rejected: prey/critter hard-coded 1hp fragile
with no toughness scaling — our injury genes evolve as ordinary loci in
everything. Ours goes further: bleed-out until clotting, pain as an appended
sense, severed parts as world morsels (mass conservation), bauplan itself
evolving under injury pressure.
Open question for Joshua: Paul's regen gene (axolotl strategy, metabolically
priced). Ours currently says lost is permanent. Keep permanent, or make regen
an evolvable strategy with the metabolic price?
**Decided 2026-10-01 (Joshua):** regen is an evolvable adaptation, not a
starting trait. New locus `regenCapacity` (0–1), metabolically priced per
Paul's smooth-gradient math (hunger rises, quick-patch slows). Tanglekin
founder genomes start at 0 — no regrowth. One prey founder genome is seeded
with nonzero capacity so **tail regrowth manifests in that prey lineage**
(tails are cheap to regrow; regrow cost scales with part size, so low capacity
means tails first, limbs later, torso never). No species-specific code —
species IS a founder genome, and this is just founder values. Evolution can
take it anywhere from there: tanglekins could discover it, prey could lose it.
