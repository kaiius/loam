# Loam — the Canopy material world (design v1, "new stage, same actors")

**Status:** design only (2026-10-03). No src/ changes. **Approved direction** (Joshua,
2026-10-03): a Minecraft-principled world — everything made of manipulable
material (smooth and organic, not blocky), everything procedurally generated:
the physics and logic of the world seed it, and it grows organically.
Tanglekins dig, pile, burrow, and build. Full design/style change authorized.

**The decision** (Joshua-approved): fresh world track, port the creatures. The
37 versions of creature systems — diploid genome + meiosis + epigenetics,
sparse 3-layer brain, chemistry-under-drives, senses, social systems, affect —
are the treasure and get **ported, not rewritten**. The world geometry
(platforms → material substrate) is what's replaced. This runs **parallel**
to the current track: `~/workspace/canopy/` stays frozen (proof run), current
releases continue, the v0.37 tag is untouched.

**Convergence note:** this design absorbs three queued items rather than
competing with them — "Solid terrain under land" (diggable strata, burrow
action), "Biome vertical structure" (canopy emergent from flora, not
generated), and worldgen-v2 §7 (solid terrain columns as the future digging
substrate). The material world is where all three were already headed.

## 0. Why this unties the knot

Joshua's verdicts on the renderer passes (2026-10-02/03): floating plants,
sticker collage, clunky and busy, dashboard UI fighting the nature scene.
Every patch round failed because the renderer was disguising a world of
placed entities on slabs. The material world removes the disguise's *need*:

- **Floating things become structurally impossible.** A plant is a connected
  set of cells *grown* from a soil cell by a branching rule. Growth requires
  attachment; a disconnected cluster is a bug, and the renderer asserts
  connectivity in debug builds.
- **One physical language → one visual language.** Soil, rock, wood, water
  are cells of one substrate. The renderer draws the material field, not an
  entity list — the sticker collage has nothing to collage from.
- **Busyness is a density problem the processes solve.** Plants grow where
  fertility and moisture put them, spaced by competition — not scattered by
  a placement loop drawing everything everywhere.

## 1. Material substrate

### 1.1 The grid

- 2D side-view cellular grid (the sim's native view; matches the current
  renderer's cross-section). `CELL_PX = 10`.
- World dims kept: `WORLD_H = 1100` → 110 rows; width 4800 (size-scaled) →
  480 columns at 1×. **52,800 cells at 1×** — `Uint8Array` per field, trivial.
- A tanglekin is ~6 cells tall (body ~60px). A cell is smaller than a
  creature, bigger than noise: digging one cell is a meaningful mouthful,
  piling one cell is a meaningful handful.

### 1.2 Materials

`cell.mat` is a `Uint8` material id. The table extends worldgen-v2 §4's
substrate classification into true cells:

| id | material | digWork | integrity | fertility | flamm. | permeab. | notes |
|----|----------|---------|-----------|-----------|--------|----------|-------|
| 0 | AIR | — | — | — | — | — | empty |
| 1 | SOIL | 3 | low | 1.0 | 0.1 | 0.7 | the living earth |
| 2 | SAND | 2 | none | 0.25 | 0.0 | 0.9 | collapses always |
| 3 | CLAY | 5 | med | 0.5 | 0.0 | 0.2 | piled soil compacts toward clay |
| 4 | ROCK | 12 | high | 0.05 | 0.0 | 0.05 | needs claw/digPower |
| 5 | WOOD | 8 | high | 0.0 | 0.6 | 0.0 | living trunks/limbs |
| 6 | DEADWOOD | 6 | med | 0.3 | 0.9 | 0.0 | fallen, rots → soil |
| 7 | LEAF | 1 | none | 0.4 | 0.8 | 0.0 | canopy cells |
| 8 | WATER | — | — | — | — | — | flows (§1.4) |
| 9 | BEDROCK | ∞ | ∞ | 0.0 | 0.0 | 0.0 | world floor, undiggable |

- `digWork` = work-ticks to remove one cell (scales with the digger's
  `digPower`; bedrock never).
- `integrity` = structural: SOIL spans ≤ 3 cells unsupported before
  slump; ROCK spans ≤ 8; WOOD spans ≤ 6 (branches); SAND never spans.
  Exceed it and the cells above slump (deterministic, §1.4).
- Fertility feeds plant growth (§2.3); flammability is inert until the
  fire question is decided (§8 Q1).

### 1.3 Cell state

Per cell (all `Uint8`/`Float32` arrays, world-owned):
- `mat` — material id.
- `moist` — 0..1 water content (feeds fertility, erosion, growth).
- `root` — 1 if this cell is part of a grown structure (plant/tree);
  grown cells are never "placed" — the growth algorithm sets this.
- `grown_id` — `Uint16` plant instance id for WOOD/LEAF cells (lets the
  renderer draw one tree as one tree, and lets fire/disease travel plant-wise
  later).

### 1.4 Material processes (tick-time, deterministic)

All processes are pure functions of cell state + fixed sweep order. **No RNG
in the tick** — tie-breaking by sweep order (west→east, top→bottom), which
is deterministic by construction. (If stochasticity is ever wanted, it uses
`hash(seed, tick, x, y, purpose)` — stateless, never a stream.)

- **Slump** (every tick, cheap local check): for each solid cell, count
  unsupported span; exceed integrity → the cell becomes "falling" (moves
  down one cell per tick until supported; SAND always falls). Piled soil is
  loose (integrity none) until compacted by trampling (creature steps →
  `compact` counter → becomes CLAY-like after N passes).
- **Water flow** (every 10 ticks): WATER cells move down, then sideways
  into AIR; infiltrate SOIL/SAND slowly (`moist += k·permeab`). Evaporation
  from surface water by the v0.23 weather field (already exists — reads
  `moist` now instead of painted wetness).
- **Erosion** (worldgen-time only, §2.2): soil creep on steep slopes.
- **Rot** (slow): DEADWOOD → SOIL over long timescales (mass-conserving:
  the ledger tracks it; fertility transfers, nothing vanishes).

### 1.5 Determinism

Same `(seed, size)` → bit-identical substrate. Worldgen draws ONLY from the
worldgen stream (never `world.rng`) — the v0.29 discipline, unchanged. The
tick-time processes are RNG-free by §1.4.

## 2. Generative worldgen: seed → processes, not placements

`generateMaterialWorld(seed, size)` — new pipeline in `src/material/`.
Signature mirrors `generateLayout`; internals replaced.

### 2.1 Pipeline

1. **Stream**: `gen = createRng(mix(seed, size, attempt, 0x38))` — own
   stream, new version tag `0x38` (worldgen-v2 used `0x27`; no collision).
2. **Elevation**: reuse worldgen-v2 §2 verbatim (seeded fbm octaves +
   tectonic ridges + rift basins + edge pinning + 2-pass box-blur erosion).
   The field is free — no zone anchors.
3. **Rasterize to materials**: for each column, from surface down:
   - surface → `soilDepth` cells of SOIL (`soilDepth` from fertility/moisture:
     3–8 cells; thin on rock/sand).
   - below soil → ROCK, with CLAY lenses where moisture high (seeded).
   - slope > 0.9 → surface ROCK (cliffs); within 25px above sea level →
     SAND (beaches); below sea level → WATER fill + SAND/SOIL bed.
   - bottom 3 rows → BEDROCK.
4. **Erosion passes** (worldgen-time, fixed count 40): soil creep —
   where the surface slope exceeds the angle of repose, move the top SOIL
   cell downhill. Rounds the world; kills floating-column artifacts.
   Deterministic, no draws (pure geometry).
5. **Water table**: flood-fill WATER from sea level into connected AIR
   below it; inland basins below the water table become lakes (fresh).
6. **Grow the flora** (§2.3): seeds on fertile soil → L-system growth.
7. **Emergent labels** (§2.4): the 8 biome keys computed from climate,
   kept as UI/physics conveniences (worldgen-v2 §5 philosophy: names are
   a UI convenience — the physics never reads them).
8. **Viability gate** (§2.5): reject-and-resample with deterministic
   fallback.

### 2.2 Draw order (load-bearing, never reorder)

`landFrac target → noise frequencies → ridge params → rift params →
climate wave → soilDepth params → seed positions (west→east) → growth
iterations → lake detection`. Documented here; the builder never reorders.

### 2.3 Plant growth (the anti-floating guarantee)

A plant is **grown, never placed**:

- **Seed**: worldgen picks seed cells — SOIL surface cells with
  `fertility × moisture` above threshold, spaced ≥ 120px apart (competition;
  seeded order west→east). Seed count ∝ fertile area.
- **Growth**: deterministic L-system, fixed 24 iterations per plant
  (no RNG inside — branching angles from `hash(seed, plantId, iter)`):
  - axiom: upward shoot from the seed cell.
  - rules: apex extends (WOOD cell above); every 4th iteration, branch
    buds at ±(30–50°); buds grow 6–10 cells then terminate in LEAF
    clusters (3×3 LEAF block around the tip).
  - growth stops early if: no adjacent AIR/soil (crowded), or iterations
    exhausted. Height ∝ iterations × cell size — big trees are just more
    iterations (jungle gets 40; scrub gets 12).
- **Attachment invariant**: every WOOD/LEAF cell is 8-connected through
  WOOD back to the seed cell. **Debug assert** after growth: flood-fill
  from the seed; any WOOD/LEAF cell unreachable is deleted (and logged —
  it means the growth rule has a bug, not that the world is wrong).
- **What this replaces**: `spawnBiomeFlora`'s scattered placement, the
  branch-platform templates, and the "plants 100–400px off their branch"
  bug class that caused the floating berry puffs. There are no branches
  to be off of anymore — there is only the grown tree.

### 2.4 Biome labels: emergent, kept

The 8 keys (`arctic, mountains, jungle, plains, desert, shallows,
archipelago, deep`) are **kept** — the sim reads them everywhere
(`floraFor`, cohorts, `zoneStress`). They are computed from the emergent
climate classifier (worldgen-v2 §5), never painted. Vertical structure
falls out of the processes, per the biome-vertical-structure spec:
- **Jungle**: high fertility × moisture → big trees (40-iteration growth)
  → multi-tier canopy, grown not generated.
- **Mountains**: high slope → ROCK surface → cliff shelves (climbable,
  §3.3).
- **Plains/desert**: flat, low growth iterations → deliberately level-less.
- **Archipelago**: small landmasses → palms (12-iteration, water-adjacent).
- **Caves/dirt**: deep SOIL columns → the digging/burrowing country.

### 2.5 Viability gate

- **G1 food**: ≥ N grown fruit-bearing plants (N scales with size).
- **G2 water**: ≥ 1 freshwater lake/pond.
- **G3 traversable**: flood-fill over walkable surface cells from the
  founder spawn — ≥ 80% of land surface reachable (tunnels count; they
  connect).
- **G4 spawns**: founder spawn cells are SOIL surface, not submerged.
- **G5 biome spread**: ≥ 3 distinct land labels present (labels genuinely
  emerge).
- Reject-and-resample, attempt mixed into the stream; gentle fallback
  (flattened terrain + fixed growth params), never throws. Every rejection
  logged with reason.

## 3. Creature port: the mapping

Everything in this section ports. Nothing is rewritten except the
locomotion interface (§3.3), which is the one place the stage change
touches the actors.

### 3.1 Unchanged systems

- **Genome**: diploid, meiosis, epigenetics, families A–V, chromosome 9
  bud program — untouched. Loci indices stable.
- **Brain**: sparse 3-layer net, `decide()`, instinct-gene wiring —
  untouched. `ACTIONS` append-only (§3.4).
- **Chemistry/drives**: mass-conserving ledger, drives as chemical
  readouts — untouched. Digging/piling bill energy through `hungerRate`
  (work terms, like the existing `developDrain` pattern).
- **Senses**: existing 43 indices **never renumbered**. Three appended
  (§3.2).
- **Social/affect**: bonds, grooming, grief, lexicon — proximity-based,
  geometry-agnostic. Untouched.
- **Nerves/pain/injury**: the Scars part system reads the body plan —
  untouched.

### 3.2 New senses (appended, never renumbered)

| idx | sense | reads |
|-----|-------|-------|
| 43 | `digAhead` | diggability 0..1 of the cell in facing direction at body height (1 = loose soil, 0 = bedrock/air) |
| 44 | `soilBelow` | material under feet mapped 0..1 (rock 0 → loose soil 1); 0 in air/water |
| 45 | `enclosed` | fraction of the 8 neighboring cells solid 0..1 — the burrow/cave sense |

`N_IN` 44 → 47 (43 senses + 3 new + bias). `SENSE44` export added;
`SENSE32` retained as alias (same pattern as the v0.17 migration).

### 3.3 Locomotion: the new interface (the one rewrite)

The platform model (`c.grounded`, `platformIndex`, climb links) is
**retired** and replaced by a material-query interface in
`src/material/locomotion.js`:

```
sampleMat(world, x, y) → material id          // the substrate answers
isSolid(mat)          → bool                   // SOIL/SAND/CLAY/ROCK/WOOD/DEADWOOD/BEDROCK
isClimbable(mat)      → bool                   // WOOD, steep ROCK (slope > 0.7)
supportBelow(world, x, y, reach) → { y, mat } | null   // topmost solid cell within reach below
surfaceNormal(world, x, y) → { nx, ny }        // from the local solid gradient
headroom(world, x, y) → int                    // air cells above (burrow sense plumbing)
```

- **Walking**: `supportBelow` within `legLength` → grounded at that
  surface; move along the surface tangent. No platforms — the ground is
  the ground.
- **Climbing**: `climb` moves along `surfaceNormal`-defined surfaces
  where `isClimbable`. Trees are climbed because they are WOOD, not
  because a link says so. Vines (grown thin WOOD strands) climb the
  same way — the biome-vertical-structure spec's vine-climbing falls
  out free.
- **Jumping**: kept, physics unchanged, already weakened per the
  jump-weakening direction. Launch from any support; land on any
  support found by `supportBelow` along the arc.
- **Swimming**: unchanged (water is water); `dive`/`swim` read the
  WATER cells.
- **Burrowing**: a creature inside a dug tunnel is "grounded" by the
  tunnel walls — `supportBelow` + `enclosed` handle it; no special case.
- **Falling**: no support within reach → ballistic, as now.

The tick never asks "what platform am I on" — it asks the substrate.
`platformIndex`, `platformsByZone`, climb-link tables: retired with the
old worldgen. (The old track keeps them; this is a parallel track.)

### 3.4 Actions: ported + two new

All 30 existing actions port unchanged in *intent*; their physics reads
the substrate:

- `climb` (9): surface-following per §3.3 (replaces climb-link hops).
- `jump` (11): unchanged physics, support-agnostic landing.
- `dig` (19): **redefined**. Removes ONE `digAhead` cell after
  `digWork` work-ticks (3 for soil at founder digPower). Yields a
  carried soil item (`c.held = { material:'soil', weight, ... }` —
  the existing `held` machinery, termite logic: the hand knows
  properties, not types). Digging a cell that contains buried food
  yields the food instead (buried food is stored per-cell now, not in
  a separate list). Digging is work: `hungerRate += DIG_DRAIN`.
  **Anatomy gate** (Joshua's rule): `digPower = graspPairs ×
...[truncated 10805 chars]
## 8. Joshua's rulings (2026-10-03)

1. **Fire**: material process, WITH a runtime on/off toggle for now.
2. **Burrow collapse**: realistic — tunnels cave in without support. WITH a runtime toggle switching to permanent-once-dug mode.
3. **Endgame**: yes — retire the platform track at parity (seal, not delete; a ceremony, not a deletion).
4. **Geophagy**: yes — in.
5. **Water**: full physics and fluid dynamics (not the simple version).
6. **World size**: yes — parity with current, designed to scale.
7. **Biome labels**: yes — emergent from process parameters, keep the names as descriptive labels.
