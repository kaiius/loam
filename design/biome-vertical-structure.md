# Biome vertical structure + congruent world (Joshua's direction, 2026-10-02)

His words: "I am still not in awe regarding the world and its biomes. It seems
jaunty, and not in the good sense. Like patchwork that doesn't quite fit
together rather than a congruent world."

This is the spec. The worldgen v2 biomes read as patches sewn together; the
goal is a world that feels like one place.

## The direction (his spec, verbatim-derived)

1. **Jungle gets a real canopy.** Large trees whose branches form different
   levels of canopy. Creatures move up and down by **climbing vines** or by
   **moving branches around as ramps** — not by jumping. Jumping is being
   reduced as a locomotion mode (consistent with v0.36b jump-weakening).
2. **Mountains get level-like structure too** — rock shelves, ledges, and
   formations that function as canopy-like levels.
3. **Other biomes deliberately have no levels.** Flatlands, islands,
   cave/dirt regions are vertically flat — and that absence is the selection
   pressure.
4. **Tribes radiate by biome.** His examples: some learn to **dig and burrow**
   in areas with caves or lots of dirt; some learn to **swim or build rafts**
   if stuck on islands. Climbers in jungle/mountains, diggers in dirt/caves,
   swimmers/rafters on islands — the biome demands the trait.

This is the adaptive-radiation vision made concrete: biomes with
characteristic vertical structure — or its deliberate absence — and tribes
radiating into climbers, diggers, swimmers, rafters as the world demands.

## Design implications (derived, not his words)

- **Canopy becomes emergent, not generated.** The v0.29 constructive canopy
  generator (platforms + climb links) is the patchwork he sees. The jungle
  canopy should grow out of the flora: big trees with branch architecture,
  vines as climbable links, branches as movable ramps. Platforms become what
  branches are, not a separate structure laid over the world.
- **Vertical movement actions.** Climb exists; vine-climbing and
  branch-moving (ramps) need mechanics. Branch-moving implies object
  manipulation of world geometry — a heavier lift than a new action; it may
  belong with the 'Making'/technology arc (v0.24) rather than pure worldgen.
- **Jumping reduction.** v0.36b already plans to replace the unprincipled
  jump number with a measured one; this direction says the measured answer
  should come out small — jumping is the exception, climbing the rule.
- **Digging needs the solid-terrain work first.** The design queue already
  holds "Solid terrain under land" (soil/rock strata, diggability as a
  material property, burrow as a future action with its instinct gene).
  Diggers/burrowers cannot evolve until that substrate exists — sequencing
  matters: solid terrain → diggable strata → burrow action → selection.
- **Swimming/rafts need water as a real medium.** Islands must be surrounded
  by swimmable water (not void), and raft-building is technology — again a
  'Making'-arc neighbor.
- **Congruence.** The patchwork feel is partly biome transitions: ecotones
  between regions, geological coherence (mountains where tectonics put them,
  jungle where the rain falls — v0.23's flying-rivers already couples this).
  The world should read as one climate system, not a quilt of labels.
- **Tribe-habitat correlation becomes measurable.** v0.37's tribe-divergence
  instrument (morphological divergence vs habitat) is the natural verifier:
  once biomes differ vertically, do separated tribes actually diverge into
  climbers/diggers/swimmers?

## Sequencing note

This is a worldgen revision (v3) PLUS new mechanics (vine-climb,
branch-ramps) PLUS dependencies (solid terrain, water medium, Making arc).
It should not be one version. Proposed split when the stream is renumbered:
(a) worldgen v3 — congruent biomes, emergent tree/mountain vertical
structure, deliberate level-less biomes; (b) solid terrain + diggable
strata (already queued); (c) climb/vine/branch-ramp mechanics with jumping
reduced; (d) the radiation itself — left to selection, measured by v0.37's
instrument. The keeper does not assign tribes their traits; the biomes do.

## Open questions for Joshua (not now — when this reaches the front)

- Should the v0.29 platform/climb-link generator be retired outright, or
  kept as the mountain/rock-shelf path while trees take the jungle?
- How far does "reducing jumping" go — rare fallback, or gone entirely?
- Island size: how isolated must an island be before raft-building is the
  answer rather than swimming?
