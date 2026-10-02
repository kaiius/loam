# Generative worldgen v2 — design v1 — APPROVED BY JOSHUA 2026-10-01
("Perfect, proceed with all of these ideas"). Builds after v0.28 tags.

## Premise
v0.26 worldgen paints 8 fixed biome zones west→east (arctic, mountains, jungle,
plains, desert, shallows, archipelago, deep) and jitters the painting per seed.
Every world is the same world with different noise: same biome order, same
platform skeleton, same 9-platform jungle canopy. Joshua has ruled this
inadequate and pointed at Paul's Wildcode v0.18 worldgen as the bar.

Paul's philosophy (wildcode v0.18 `worldgen.js`): **generate initial
conditions, not biomes.** Elevation from seeded noise + tectonic ridges +
rift valleys → sea level from the elevation distribution → substrate as
physical materials → biome labels computed afterward from rolling climate
measurements ("Names are a UI convenience — the physics never reads them").
Every world is genuinely a different world.

This design ports that philosophy to Canopy, with one problem Paul never had:
our canopy platform layer — the tanglekins' arboreal habitat — is currently a
fixed template, and the fixed 9-platform jungle canopy is load-bearing for
founder spawning, climb links, and teaching. §6 solves it with a constructive
canopy generator that guarantees a viable founder canopy in every world.

Design only. No code changes. The builder assigns the release number.

## 1. Pipeline overview
`generateLayout(seed, size, attempt)` keeps its signature. Internals replaced:

1. **Stream**: `gen = createRng(mix(seed, size, attempt))` — worldgen's own
   stream, never `world.rng`. Version tag bumped `0x26` → `0x27` so v2 streams
   don't collide with v0.26 streams.
2. **Elevation** (§2): per-world seeded noise octaves + 1–3 tectonic gaussian
   ridges + 0–1 rift basins + edge pinning + 2-pass box-blur erosion.
3. **Sea level** (§3): from the elevation distribution, targeting land fraction
   0.55–0.70.
4. **Substrate** (§4): per-column material classification (water/sand/soil/
   rock/alpine) with physical properties.
5. **Initial climate** (§5): per-column T from a seeded climate wave minus
   elevation lapse; moisture from substrate retention + noise.
6. **Regions** (§5): contiguous label runs from the emergent classifier;
   islands detected geometrically.
7. **Canopy** (§6): founder canopy constructed in the best jungle region,
   secondary canopies in other forest regions, characteristic platforms for
   other region types — all placed constructively so climb links form.
8. **Waters** (§3): flood rects + ponds.
9. **Viability gate** (§8): reject-and-resample, attempt mixed into the
   stream, gentle fallback that never throws.

Draw order on the stream is load-bearing (documented here, never reordered):
landFrac target → noise frequencies (o1,o2,o3) → ridge count/params →
rift params → climate-wave (A, λ, φ) → founder canopy params (west→east,
bottom-up) → secondary canopies (west→east) → other-region platforms
(west→east) → pond positions.

## 2. Elevation
Keeps `TERRAIN_COL = 20`, ground baseline `Y0 = 800`, `WORLD_H = 1100`.
Reuses the existing bit-stable `hash01/vnoise/fbm` (no need for Paul's
`makeNoise1D` — ours is already deterministic and tested).

Per attempt, from `gen`:
- **Noise octaves** with per-world seeded frequencies (this is what makes
  broad rolling worlds vs rugged ones — v0.26 fixed the frequencies):
  `o1 = 0.0016 + gen.range(0, 0.0008)` (±75px),
  `o2 = 0.006 + gen.range(0, 0.003)` (±30px),
  `o3 = 0.02 + gen.range(0, 0.01)` (±11px). Total relief ≈ ±116px.
- **Tectonic ridges**: `1 + gen.int(0, 2)` gaussian ridges;
  `cx ∈ [0.15w, 0.85w]`, width 180–420px, height 180–340px (upward = smaller
  y). Noise alone makes dunes; ridges make mountains. A 340px ridge on the
  800 baseline peaks near y≈350 — above the alpine line (§4), so real
  snowcaps emerge.
- **Rift basins**: 60% chance of one basin; width 120–260px, depth 80–160px.
  Future lakebeds and seaways.
- **Edge pinning**: Paul's 12-column smooth pin at both world edges — no
  sheer cliffs at the boundary.
- **Erosion**: the existing 2-pass box blur (radius 2), nulls excluded,
  rounded to integers afterward (the 0.09px rounding-gap lesson stands).

No zone anchors, no fixed zone order. The field is free.

## 3. Sea level & hydrology
- Land-fraction target: `0.55 + gen.range(0, 0.15)` (Paul's range).
- `seaY` = the elevation quantile for `(1 - landFrac)` — computed from the
  sorted field, no draws.
- `layout.seaY` keeps its name (waters and the renderer read it).
- **Flood rects**: contiguous terrain columns below seaY become water rects
  (existing `buildWaters` flood logic, minus the painted rects).
- **Lakes**: inland water not connected to the sea (detected by flood-fill
  from the world edges over water columns) is fresh water — the drinking
  supply. Label §5.
- **Ponds**: `2 + floor(width / 2400)` freshwater ponds, seeded x positions
  in the largest soil regions, `surfaceY = terrain - 10` (existing pond
  shape). Replaces the fixed jungle×2/desert×1 scheme.

## 4. Substrate as materials
Per-column classification from elevation, slope, and water — Paul's
`SUBSTRATE`/`SUBSTRATE_PROPS`, y-values adapted to our 800 baseline:

| substrate | rule | albedo | heatcap | retention | fertility |
|---|---|---|---|---|---|
| DEEP_WATER | depth > 120 | 0.08 | 3.0 | 1.0 | 0.0 |
| SHALLOW_WATER | depth > 0 | 0.10 | 2.2 | 1.0 | 0.1 |
| SAND | depth > −25 (beach) | 0.32 | 0.8 | 0.25 | 0.25 |
| ROCK | slope > 0.9 | 0.18 | 1.1 | 0.3 | 0.15 |
| ALPINE | y < 540 | 0.55 | 0.9 | 0.4 | 0.05 |
| SOIL | else | 0.22 | 1.0 | 0.7 | 1.0 |

Slope = `|e[i+1] − e[i−1]| / (2 × TERRAIN_COL)`.

These properties feed the physics **directly** (Paul's rule: the atmosphere
reads materials, never biome names):
- **v0.23 weather**: per-column soil-moisture retention = substrate
  retention (replaces the painted `climate.wet[i] = 0.5 + s.M`); evaporation
  ∝ T already; runoff vs infiltration splits by retention.
- **v0.25 heat**: per-column thermal mass = substrate heatcap — water slow,
  land fast, rock slightly slower than soil. (This also closes the bug class
  Gemini caught twice: every term that moves T must respect thermal mass;
  now the mass itself is generated, not painted.)
- **v0.27 seasons**: per-column seasonal amplitude from heatcap —
  deep water 0.20, shallow 0.25, sand 0.65, soil 0.55, rock 0.60, alpine 0.50.
  v0.27's "desert swings hard, rainforest mild" becomes an emergent
  consequence (deserts are sand → high amplitude; wet forest soil → low),
  not a painted table. `SEASON_AMP_BY_BIOME` is retired.
- **Flora**: plant growth reads substrate fertility alongside `floraFor`
  yield.

`layout.substrate` = Uint8Array per column; `layout.Tinit` = Float32Array per
column (§5).

## 5. Emergent biome labels
The 8 label keys are **kept** (`arctic, mountains, jungle, plains, desert,
shallows, archipelago, deep`) — the whole sim reads them (`floraFor`,
`GENESIS_COHORTS`, `world.soil` keys, `zoneStress`, fruit multipliers). What
changes is where they come from: computed from climate, not painted.

**Initial temperature** (worldgen-time, before the climate field exists):
`Tinit(x) = clamp01(0.52 + A·sin(2π·x/λ + φ) − lapse(y)·0.30)`,
with per-world seeded `A = 0.12 + gen.range(0, 0.18)`,
`λ = width × gen.range(1.0, 2.0)`, `φ = gen.range(0, 2π)`,
`lapse(y) = max(0, 800 − y)/550` (the existing lapse factor).
Every world gets a distinct thermal character: hot-west, hot-east, or
flat — plus elevation-driven cold. Cached on `layout.Tinit`.

**Classifier** (per column, then merged into contiguous runs):
```
classify(T, M, depth):
  if depth > 120:            return 'deep'
  if depth > 0:              return 'shallows'   # sea-connected; lakes relabeled below
  tempC = -10 + 45*T
  if tempC < 2:              return 'arctic'
  if tempC < 10:             return 'plains' if M < 0.32 else 'mountains'
  if tempC < 24:             return 'plains' if M < 0.62 else 'jungle'
  if M < 0.30:               return 'desert'
  if M < 0.60:               return 'plains'
  return 'jungle'
```
Post-pass: land runs < 400px flanked by water on both sides → `'archipelago'`
(islands get palms — emergent and cute). Inland enclosed water (flood-fill
from edges never reaches it) → `'shallows'` water columns = lakes.
`layout.regions = [{ id, label, x0, x1, cx, platformPis: [] }]` west→east.

**Label consumers — migration table:**

| consumer | today | v2 |
|---|---|---|
| `initClimateFromPainted` | seeds T/soil/vapor/cloud from painted key | renamed `initClimateFromPhysical`: T from `Tinit` + noise, soil moisture from substrate retention, vapor/cloud as now (functions of M). The `keyAt` callback runs the §5 classifier on the seeded fields. |
| `biomeKeyAt(x,y,world)` | Whittaker on live climate, else painted key | unchanged with climate; without, returns emergent label from `layout.regions`. Water-ness from `waterAt`, not zone index ≥ 5. |
| `ambientCold/Heat/Temp` | painted rules (arctic=1, desert interior ramp…) | physical: `ambientTemp = clamp01(colT(x) − lapse(y)×0.30)`; `ambientHeat = clamp01((tempC−24)/11)`; `ambientCold = clamp01((2−tempC)/12)`. Same signatures, optional `world` param; pure-geography calls read `layout.Tinit`. |
| `floraFor(key)` | per-biome table | UNCHANGED — keyed by emergent labels. |
| `world.soil[key]` | 8 painted-zone slots | kept, keyed by the 8 labels. Two jungle regions share the `'jungle'` soil community — documented as habitat-type microbiome, not a bug. |
| `zoneStress`, fruit multipliers | fixed x-ranges/keys | label lookup at x (replaces fixed ranges). |
| `biomeCenterX(i)` | painted zone center | center of the largest region with label i; absent → world center, neutral T. |
| `microbes.zoneTempK` | via `biomeCenterX` | unchanged (rides the migration above). |
| `creature.homeBiome` | `biomeAt` index | emergent label at homeX. |
| Wind regimes (ITCZ) | westerlies west of x=1500 | KEPT x-pinned for v2 — see open question §14.1. |

**biomes.js fate:** the painted `BIOMES` array is retired as the source of
truth, kept as `PAINTED_BIOMES` for `canonicalLayout` only. `biomeAt` keeps
its name/signature and returns the emergent label. `canonicalLayout` stays
byte-identical — the painted world remains the default view and the
coordinate-pinned test fixture.

## 6. The canopy generator (the heart)
Platforms are no longer instantiated from per-zone templates. They are
**constructed** from the generated geography, with climb-link feasibility
built into the placement — every new platform is placed relative to an
existing one (x-overlap ≥ 80px, vertical gap 120–200px), so connectivity
holds by construction and `computeClimbLinks` (overlap > 60, gap 60–240)
verifies rather than hopes.

**Founder canopy** (replaces the fixed jungle 9-platform template):
1. Founder region = largest contiguous run of `jungle`-labeled SOIL columns
   with width ≥ 900px. Fallback: largest SOIL run ≥ 700px. (Gate §8 rejects
   worlds where even the fallback fails.)
2. Ground tier: terrain-following ground segments across the region, split
   where slope changes by > 0.5; segments < 200px dropped.
3. Branch tiers: 3 tiers (the painted canopy's count). Branches per tier =
   `min(4, 2 + floor(regionWidth / 600))` — a 900px region yields 3/tier,
   9 branches, matching the painted density.
4. Placement per branch: anchor = seeded pick from the tier below (tier 0 =
   ground segments); `cx = anchor.cx + gen.range(−120, 120)`;
   `width = gen.range(150, 350)`; `y = anchor.y − gen.range(120, 200)`;
   x clamped to region inset 40px. Overlap ≥ 80px and gap 120–200px hold by
   construction → climb links form.
5. `layout.founder = { regionId, x0, x1, groundPis, branchPis, fruitSlots }`
   — explicit, replacing the `platformsByZone.jungle[0..8]` convention.
   Fruit slots per branch = `ceil(width / 120)`.

**Secondary canopies**: every other `jungle` region ≥ 500px gets the same
generator with 2 tiers × 2 branches — the dispersal targets (v0.33 needs
them). Deterministic west→east order.

**Other region types** (characteristic platforms, generated not templated):
- rock/alpine regions ≥ 300px: 3 shelves on the steepest columns,
  `y = terrain − 80 − 40k`, then one deterministic repair pass nudging any
  unlinked shelf's y toward the nearest platform (links verified, not
  hoped).
- plains/desert soil/sand regions: terrain-following ground segments +
  0–2 ridge/rock features (seeded, 150–250px wide, `y = terrain − 120`).
- shallows: 2–4 mangrove branch platforms at `y = seaY − 180`, x spread
  across the region.
- archipelago islands: per island run, 1 ground segment + 1–2 branches
  (constructive from ground, gap 120–180).
- deep water: 2–4 floes at `y = seaY − 110` (as now; swum to by design).

**Emission order** (index stability): west→east by region; within a region,
ground segments first, then tiers bottom-up. `platformsByZone` is retired;
replaced by `layout.regions[].platformPis` + `layout.founder`. All call
sites migrate per §10.

## 7. Solid terrain (absorbs the queue item)
`layout.ground[i]` is already a per-column elevation array. v2 declares the
column **solid from the surface down to WORLD_H**: `terrainSolidAt(x, y) =
(y ≥ groundYAt(x))` for land columns. No voids under land — land IS the
column. Ground platforms rest on the surface as now; the "gap underneath
land that creatures fall into" disappears because there is no underneath.
This is the future substrate for digging/burrowing (not this design): the
dig verb will remove column segments, the burrow action will move through
them. The data model is the deliverable.

## 8. Viability gate
Old checks map onto the new pipeline; Paul's terrain checks are added:

- **G1 fruit** (was: jungle ≥ 8 branch slots): founder canopy
  `branchPis.length ≥ 6` AND `fruitSlots ≥ 8`.
- **G2 water** (was: ≥ 1 freshwater): ≥ 1 lake or pond (fresh, not salt).
- **G3 traversable** (was: jungle cluster-0 one component): BFS from the
  founder ground platform over climb links reaches every founder platform.
- **G4 reachable** (was: no NEW stranding vs template): every generated
  platform belongs to a component containing a ground segment — except
  floes, swum to by design. (The template-ordinal machinery
  `canonicalLinkedSet` is retired with the templates.)
- **G5 spawns** (was: cohort platforms unflooded): founder ground not
  submerged > 30px; each cohort's target region exists (missing non-founder
  cohort → skip + log to `layout.log`, not a failure).
- **G6 terrain** (new, Paul's): land fraction 0.40–0.85; largest landmass ≥
  25% of columns; max slope ≤ 2.5 px/px.
- **G7 founder region** (new): the §6 region exists (≥ 900px jungle-soil or
  ≥ 700px soil fallback).

Reject-and-resample, attempt mixed into the stream (existing pattern),
`MAX_ATTEMPTS = 100`. **The fallback changes**: v0.26 throws after 100
attempts — v2 never throws. Fallback = gentle terrain (field × 0.4, Paul's
pattern) + the constructive canopy generator with fixed parameters in the
largest soil region. Every rejection logged with its reason on
`layout.log`.

## 9. Size parameterization
v0.26: `size` scales zone widths and cluster counts. v2: `size` scales world
width (`width = BASE_WORLD_W × size`); ridge/basin counts and region sizes
scale naturally with width. Founder cohorts: `clusters = max(1, round(size))`
segments; per segment, the 8 cohorts spawn in the segment's intersecting
regions (nearest region if the label is absent in-segment), holding
encounter density near baseline — the failure mode v0.26 named (a big EMPTY
world) is guarded because canopy-region count grows with width. The
viability battery runs at 1× and 2× to confirm, per the standing lesson
(normalize, don't rescale; measure).

## 10. Spawn migration (world.js call sites)
- Teacher: `layout.platformsByZone.jungle[0]` → `layout.founder.groundPis[0]`.
- flutter/grub cohorts: `jungle.slice(0, 9)` → `layout.founder.branchPis` /
  ground segments.
- `GENESIS_COHORTS`: `{ key, ord }` → `{ label, finder, shifts }` where
  finder ∈ {coldest-land, highest-land, founder, largest-plains,
  hottest-dry, largest-shallows, largest-islands, deep-water}, deterministic
  westmost tiebreak. Allele shifts unchanged (selection presets, still
  meaningful). Missing non-founder region → skip + log.
- `spawnBiomeFlora`: per region by emergent label — trees on branch
  platforms (`min(fruitSlots, seeded)` per region), grasses on plains
  ground, cacti on desert, moss on arctic, shrubs on mountains, mangroves
  on shallows branches, palms on archipelago, kelp in deep (platformIndex
  −1 convention kept). Counts scale with region width.
- `spawnBuriedFood` / `spawnMobileFood` / `spawnResources`: same label
  mapping (tubers→plains/desert, grubs→jungle floor, snowcache→arctic…).
- `spawnPredators`: bears → coldest land region; sharks → deep water.
- The artifact bundle (`canopy-sim`) reads `layout` for rendering:
  background tints by region label (replaces zone tints); the v2 builder
  rebuilds the bundle from the new worldgen.

## 11. Determinism & stream discipline (unchanged rules)
- Worldgen draws ONLY from its own stream, never `world.rng` — founder
  genomes and the main stream are untouched.
- Same `(seed, size)` → bit-identical layout. The attempt counter mixes
  into the stream seed; the version tag `0x27` separates v2 streams.
- Draw order §1 is load-bearing and documented; never reorder.
- `canonicalLayout` is untouched — byte-identical painted world.

## 12. Execution-probe plan (for the builder)
1. **Determinism**: `generateLayout(s, size, 0)` twice → deep-equal.
   5 seeds × sizes 1, 2.
2. **Viability**: `rollLayout` for seeds 1–50 at sizes 1, 2 → all `ok`;
   log attempts; fallback triggered < 10% or the parameters are wrong.
3. **Difference metric** (the Joshua test): pairwise world distance
   `D(A,B)` = normalized |zone-width-vector| diff + |seaY diff|/1100 +
   |platform count| diff + mean platform displacement. Measure the v0.26
   baseline first; require median pairwise D over 20 seeds ≥ **5× baseline**.
   Worlds must look different, not just be different.
4. **Canopy guarantee**: every rolled world has `layout.founder` with ≥ 6
   branches, one connected component (BFS), ≥ 8 fruit slots.
5. **Founder spawn probe**: `createWorld(seed)` for 10 seeds → founders
   exist, all on platforms, none submerged > 30px, teacher placed.
6. **Climate sanity**: init climate + 1000 ticks → ≥ 3 distinct land labels
   present in ≥ 90% of worlds (labels genuinely emerge).
7. **Visual**: render 3 seeds side by side — human eye check. Joshua's
   verdict is the real gate; the metric is the proxy.

## 13. Suggested build order
1. Elevation + sea level + substrate (§2–§4) with unit tests.
2. Tinit + classifier + regions (§5); retire `SEASON_AMP_BY_BIOME`.
3. Canopy generator (§6) + solid terrain (§7).
4. Viability gate (§8) + fallback.
5. `biomes.js` migration (§5 table) + spawn migration (§10).
6. Probes §12; Gemini spec review before tagging (standing practice).

## 14. Open questions (unresolved, with recommendations)
1. **Wind regimes.** v0.23 pins westerlies west of x=1500, easterly trades
   east (the ITCZ design win). A generative world has no fixed x=1500.
   *Recommendation:* keep x-pinned for v2 (it's an initial condition; the
   field evolves and same-seed determinism holds). Derive regimes from the
   climate wave's thermal equator as a follow-up.
2. **Ocean at the world edge.** v0.26 always put deep water east. Should v2
   require it? *Recommendation:* no — inland seas are fine and interesting;
   the land-fraction + landmass gates handle playability. `deep` labels any
   big water body.
3. **Two founder-grade canopies.** Largest jungle region wins; the other
   becomes a secondary canopy (dispersal target). Tiebreak: westmost.
   *Recommendation:* as stated — deterministic, no gate involvement.
4. **Paul's extra labels** (tundra, taiga, steppe, forest, ocean, pack-ice).
   *Recommendation:* keep our 8 keys (the sim reads them everywhere); map
   forest→jungle, tundra/taiga→arctic, steppe→plains, ocean→deep in the
   classifier documentation.
5. **Beach vs desert sand.** Both are SAND substrate; the classifier
   separates them by moisture/temperature. A hot dry beach classifies
   `desert` — cacti on a beach. *Recommendation:* accept it (it reads as a
   dune coast); revisit only if probes show it often.
6. **The `0x27` stream tag vs the v0.28 day/night work in flight.**
   *Recommendation:* v2 lands after v0.28 tags; the tag bump keeps streams
   disjoint regardless of merge order.

## 15. Amendment 2026-10-01 — adaptive radiation by biome structure (Joshua)
The world is not all canopy. Vertical structure is a biome property, and
tribes diverge by it:
- **Jungle**: multi-tier canopy. Branches + **vines** as climb links (a new
  link type — slower and safer than jumping, usable where no branch
  reaches); fallen branches **movable as ramps** (niche construction).
  Jumping is de-emphasized here; climbing dominates the movement economy.
- **Mountains**: cliff/ledge levels — verticality without trees.
- **Plains/desert**: flat ground, no levels. No climbing selection pressure
  at all.
- **Archipelago**: islands + water — swimming and raft-building country.
- **Caves/dirt areas**: digging and burrowing (rides the solid-terrain
  columns of §7).

Consequences for this design: §6's "characteristic platforms per region
type" becomes "characteristic **vertical structure** per region type" —
the generator must produce not just platforms but the *absence* of levels
where the biome is flat. §10's spawn migration already spreads cohorts
across regions (GENESIS_COHORTS); the radiation happens when the genome
can evolve biome-specialist traits, so climbing/digging/swimming affinities
must be evolvable loci. The implied mechanics (vine links, branch ramps,
swimming, rafts) are separate build items in the design queue — v2
provides the selective pressures, not the verbs.
