// The world: terrain, plants, food, toys, eggs, creatures,
// and the day/night cycle. Owns the tick orchestration.

import { createRng } from './rng.js';
import { founderGenome } from './species.js';
import { randomGenome, inherit, genomeDistance, GENES, EVO17_KEYS, randomAllele, SPECIES_TAG_CHOICES } from './genome.js';
import { randomPlantGenome, plantPhenotype, inheritPlant } from './plantgenome.js';
import { createCreature, updateCreature, creatureRadius, GRAVITY, MAX_FALL, spawnPredators, tickPredators, resetCreatureIds } from './creature.js';
import { BIOMES, biomeAt, biomeKeyAt, biomeCenterX, regionAt, ambientCold, ambientHeat, ambientTemp, waterAt, waterDepthAt, waterRects, groundYAt, floraFor, WORLD_W, WORLD_H } from './biomes.js';
import { createClimate, initClimateFromPainted, initClimateFromPhysical, tickClimate, tempAt, droughtStressAt, windAt, cloudAt, placeVents, seasonBreedMul, WEATHER_COL_W, NC } from './weather.js';
import { rollLayout, canonicalLayout, computeClimbLinks, findRegion, ZONE_KEYS } from './worldgen.js';

// v0.18: the biome map is the world's geography now — re-export its API so
// world.js stays the sim's facade.
export { BIOMES, biomeAt, biomeKeyAt, biomeCenterX, ambientCold, ambientHeat, ambientTemp, waterAt, waterDepthAt, waterRects, groundYAt, floraFor, WORLD_W, WORLD_H };
import { ageStage } from './biochem.js';
import { createCulture, sampleCulture, pruneExtinct, adoptTradition, fidelityOf } from './culture.js';
import { createBonds, tickBonds, detectTribes, nudgeBond, createPairBonds, tickPairBonds, tickKindHistory, getPairBond, nudgePairBond, halvePairBond, getBond } from './social.js';
import { createTeacher, tickTeacher, teacherDemo } from './teacher.js';
import { sizePitchFactor, hearThresh, baseLoud, pushUtterance, acousticDistance, lexiconDistance, wordName, LEX_CONTEXTS, pushContextWindow } from './language.js';
import { tickMicrobes, decompMultiplier, sterilizeZone, bacteriaOf, BACT_FOUNDER } from './microbes.js';

// v0.22 "Web of Life": the decomposer layer is living — re-export its
// ledger API so world.js stays the sim's facade.
export { tickMicrobes, decompMultiplier, sterilizeZone, bacteriaOf };

// v0.24 "Mass conservation": the global ledger — re-exported so the sim's
// facade stays world.js (creature.js, teacher.js book their flows here).
import { initLedger, ledgerIn, ledgerOut, ledgerSeal, ledgerDrift, ledgerPools, ledgerTotal, bodyMassOf, eggMassForGenome, PLANT_MASS, MINERAL_FRAC, FRUIT_MINERAL, LITTER_FRAC } from './ledger.js';
export { ledgerIn, ledgerOut, ledgerSeal, ledgerDrift, ledgerPools, ledgerTotal, bodyMassOf, eggMassForGenome };

export const DAY_LENGTH = 300; // seconds per full day/night cycle (legacy; the live parameter is world.dayTicks)
export const DAY_TICKS_DEFAULT = 3000; // ticks per day at the canonical 10 ticks/s — the v0.28 world parameter

export function createWorld(seed = 1, opts = {}) {
  const rng = createRng(seed);
  resetCreatureIds(); // v0.36: ids are world-relative (see creature.js) — the
  // nth creature born always has the same id, so nerveHash and every other
  // id-derived draw are stable across sequential worlds in one process.
  resetObjectIds(); // v0.36 (Gemini P0 #1): plant/herb/food ids too.
  // v0.26 "Procedural worldgen": the layout is rolled (and viability-gated)
  // BEFORE anything else — every spawner below reads it. The worldgen
  // stream is its own (never world.rng), so founder genomes and the main
  // stream's sequence are untouched. opts.size scales the world (default
  // 1 = the painted 4800px); zone widths and cluster counts scale with it.
  // opts.canonical: use the v1 painted layout (for tests pinning v1 behavior).
  const size = opts.size || 1;
  const { layout } = opts.canonical
    ? { layout: canonicalLayout(size) }
    : rollLayout(seed, size);
  // v0.28 "Day and night": DAY length as a world parameter (ticks per day,
  // reported). Default 3000 = the historical 300s day at 10 ticks/s.
  const dayTicks = (opts.dayTicks > 0 ? opts.dayTicks : DAY_TICKS_DEFAULT) | 0;
  const world = {
    rng,
    time: DAY_LENGTH * 0.32, // start mid-morning
    // v0.28: the integer tick clock — the day phase derives from this, never
    // from float time (phase drift at millions of ticks breaks determinism).
    // Initialized to match time's mid-morning start.
    tick: Math.round(0.32 * dayTicks),
    dayTicks, // v0.28: the world parameter — ticks per full day/night cycle
    light: 1,
    layout, // v0.26: the generated geography — zones, terrain, waters, platforms
    width: layout.width, // v0.26: 4800 × size — the layout owns the extent
    height: WORLD_H,
    groundY: 800, // legacy field: the jungle floor (biome 2); groundYAt(x) is the real map
    seed, // v0.18: the world's seed, for pinned sub-streams (§13.7)
    stats: { jumps: 0, climbs: 0 }, // v0.18: action counters for the leg experiment
    buried: [], // v0.18 §13.1: buried food [{x, y, kind, amount, biome}] — the dig verb's pantry
    predators: [], // v0.18 §13.6: predator roster (spawned by the creature agent)
    noFouling: !!opts.noFouling, // v0.18 §13.7: the contamination-neutralize switch for the leg experiment (v0.33: honored from opts — the v0.18 script set it post-hoc, so the opt-in was silently ignored)
    // The canopy: jungle region (biome 2) holds the founder 9 platforms —
    // the v0.15 9 with x mapped into the jungle region, x' = 1200 + x×0.375,
    // y UNCHANGED. Honest deviation from "byte-identical": uniform x-scale
    // shrinks every overlap by 0.375, but every old climb link's overlap was
    // ≥200px (scaled ≥75px > the 60px link threshold), so the link topology
    // recomputes identically — and the viability battery is the real gate.
    platforms: layout.platforms, // v0.26: generated — the template lives in worldgen.js
    plants: [],
    foods: [],
    toys: [],
    eggs: [],
    creatures: [],
    pebbles: [], // v0.9: pushable stones — the world as material
    minerals: [], // v0.17.1 "Touch": static mineral deposits — creature-usable as of v0.20
    sticks: [], // v0.20 "Hands": fallen branches — loose graspable objects, timber by material
    events: [], // { type, creature?, t } — consumed by UI
    culture: createCulture(), // v0.7: the tradition registry — inheritance that isn't DNA
    lineage: new Map(), // v0.10: every creature ever born — { id: { id, name, parents, generation, bornAt, traits } }. Dead ancestors stay resolvable for the lineage view.
    bonds: createBonds(), // v0.12: pairwise social bonds — memory, not genetics
    pairBonds: createPairBonds(), // v0.37 "Affect": specific attachment (vasopressin) — the vole steal
    kindHistory: new Map(), // v0.37: tracked emergence (Joshua 2026-10-02) — per-dyad last-known kind + t
    tribes: [], // v0.12: detected bands (recomputed periodically, never assigned)
    exam: null, // v0.8: exam mode — { patches:[{x1,x2}], hot, hotInterval, coldInterval } | null
    onMeal: null, // v0.8: opt-in telemetry hooks for the exam harness (unset in play)
    onSpawn: null,
    // v0.9: dedicated RNG stream for material scatter (pebbles). Worldgen
    // order is load-bearing for determinism — cosmetic additions must never
    // shift the main stream's sequence (founder genomes, rolls, etc.).
    decorRng: createRng(seed * 31 + 7),
    // v0.33 (RNG-boundary fix, Colony: hermes-on-foot): pebbles are NOT
    // decor — they block, pile, and must be navigated (physics-visible, so
    // selection-visible). Their radius was drawn from decorRng, a crossing:
    // draining decorRng flipped a seed-42 death (starvation→illness) via a
    // death-pebble's size. Pebble radii now draw from their own CAUSAL
    // sub-stream — deterministic per seed, never the decor stream, and the
    // main sequence stays bit-identical (genome.js sub-stream precedent).
    pebbleRng: createRng((seed * 7919 + 17) >>> 0),
    // v0.35 "Seed vectors": dispersal draws are CAUSAL (a seedling's
    // location is selection-visible — where it grows determines its fate),
    // so they get their own pinned sub-stream (pebbleRng precedent). The
    // current field itself is pure geometry (no draws — worldgen order is
    // load-bearing).
    disperseRng: createRng((seed * 7919 + 35) >>> 0),
    // v0.37 "Affect": the new affect loci mutate on their own sub-stream
    // (salt 55 — 17 pebbles, 35 dispersal, 55 affect). Used ONLY for
    // mutation draws on AFFECT_LOCI (genome.js) — the main sequence never
    // sees these draws. The chemistry itself is analytic (zero per-tick
    // draws); the vasopressin-gated mate preference and display priming
    // are causal but draw-free.
    affectRng: createRng((seed * 7919 + 55) >>> 0),
    driftSeeds: [], // v0.35 hydrochory: seeds riding the water [{x, y, ...}]
    currents: buildCurrents(layout), // v0.35: per-water-body current field
    // v0.13 "Roots":
    seenGenomes: new Set(), // genome hashes ever born — the beautiful-mutant watch
    novelParents: new Set(), // ids of living creatures with novel genomes
    divergenceLog: [], // { t, zones: { key: { trait: S } } } — Eliza's S per biome
    founderMeans: null, // { trait: mean } recorded at populate — the S baseline
    dupEvents: [], // v0.14: gene duplication/deletion events { t, kind, key, parents }
    speciesPrev: [], // v0.14: previous species-clustering snapshot for overlap matching
    speciesLog: [], // v0.14: species snapshots + split events for the evolution tracker
    speciesSeq: 0, // v0.14: running species id counter
    lineageKids: new Map(), // v0.14: parent id → [child ids] for the family tree
    // v0.14 "Voices": the acoustic commons. calls is the live registry
    // (decays over ~2s); zoneCalls is the per-zone dialect archive
    // ({ t, pitch, type }[], capped per zone) — the divergence tooling
    // reads it for dialect drift.
    calls: [],
    zoneCalls: {},
    // v0.14 "Voices": the Teacher — Sunny's in-sim avatar. A visitor, not
    // a tanglekin: no hunger, no mating, no death. teachLog records teaching
    // events as cultural inflection points for the evolution tracker.
    // The teacher draws from its OWN rng stream (v0.9 decorRng lesson):
    // a visitor must never shift the main stream's sequence.
    teacher: null,
    teacherRng: createRng(seed * 101 + 13),
    teachLog: [],
    // v0.14 "Voices": the waste cycle — digestion's byproduct returns to
    // the soil. soil[biome] = { waste, fertility }. v0.18: keyed by the 8
    // biome keys — the detritus loop closes locally per biome.
    // v0.22 "Web of Life": each zone also carries bacterial biomass — the
    // living decomposer layer (see microbes.js).
    soil: {
      arctic: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
      mountains: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
      jungle: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
      plains: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
      desert: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
      shallows: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
      archipelago: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
      deep: { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER },
    },
    // v0.23 "Weather": the sky as physics. Per-column climate field —
    // temperature, vapor, cloud, soil moisture, wind — on its own RNG
    // sub-stream. Initialized from the painted biome map (the initial
    // condition only); the field then evolves by physics and biome labels
    // drift via the Whittaker lookup (biomeKeyAt with a world).
    climate: createClimate(seed, Math.round(layout.width / WEATHER_COL_W)),
  };
  // v2: soil pools keyed by REGION ID (mass-integrity: each region's
  // detritus loop closes locally). v1: keyed by the 8 biome keys.
  if (!layout.canonical && layout.regions) {
    world.soil = {};
    for (const r of layout.regions) {
      world.soil[r.id] = { waste: 0, fertility: 0.5, bacteria: BACT_FOUNDER };
    }
  }
  // v2: climate from the generated physical fields. v1: from the painted map.
  if (!layout.canonical && layout.Tinit) initClimateFromPhysical(world.climate, layout);
  else initClimateFromPainted(world.climate, (x, y) => BIOMES[biomeAt(x, y, layout)].key);
  // Per-column terrain elevation (ground/rock/ridge/shelf only — branches are
  // not terrain) for orographic lift, and open-water fraction for evaporation.
  // Computed once at worldgen — the land doesn't move.
  world.climate.terrainElev = [];
  world.climate.waterFrac = [];
  {
    const waters = waterRects(layout);
    const TERRAIN = new Set(['ground', 'rock', 'ridge', 'shelf']);
    for (let i = 0; i < NC(world.climate); i++) {
      const x0 = i * WEATHER_COL_W, x1 = x0 + WEATHER_COL_W;
      let elev = 0;
      for (const p of world.platforms) {
        if (!TERRAIN.has(p.kind)) continue;
        if (p.x2 > x0 && p.x1 < x1) elev = Math.max(elev, 830 - p.y);
      }
      world.climate.terrainElev.push(Math.max(0, elev));
      let w = 0;
      for (const r of waters) w += Math.max(0, Math.min(x1, r.x1) - Math.max(x0, r.x0));
      world.climate.waterFrac.push(Math.min(1, w / WEATHER_COL_W));
    }
  }
  world.climateGeo = {
    terrainElev: (x) => world.climate.terrainElev[Math.max(0, Math.min(NC(world.climate) - 1, Math.floor(x / WEATHER_COL_W)))],
    waterFrac: (x) => world.climate.waterFrac[Math.max(0, Math.min(NC(world.climate) - 1, Math.floor(x / WEATHER_COL_W)))],
  };
  // v0.25 "Heat": volcanic vents — explicit worldgen heat sources (the
  // climate's own sub-stream; after the painted-seed draws, so worldgen
  // order stays load-bearing). No volcanic biome: biomes stay emergent.
  placeVents(world);
  // Climb links: pairs of platforms whose x-ranges overlap and whose
  // vertical gap is climbable (60–240px). Computed once at worldgen —
  // the canopy's vertical roads.
  world.climbLinks = computeClimbLinks(world.platforms);
  // v2: the teacher stands on the founder canopy's ground (the ancestral
  // ground). v1: the painted jungle floor (cluster 0).
  let _teacherPi = null, _teacherX = 0;
  if (!layout.canonical && layout.founder && layout.founder.groundPis.length) {
    _teacherPi = layout.founder.groundPis[0];
    const _tp = layout.platforms[_teacherPi];
    _teacherX = (_tp.x1 + _tp.x2) / 2;
  } else {
    const _jf = layout.platformsByZone.jungle[0];
    _teacherPi = _jf.pi; _teacherX = (_jf.x1 + _jf.x2) / 2;
  }
  world.teacher = createTeacher(world, _teacherX, _teacherPi); // the ancestral ground
  initLedger(world); // v0.24: the mass ledger starts with the world
  return world;
}

// v0.26: climb-link computation lives in worldgen.js (the viability gate
// needs it); re-exported here so world.js stays the sim's facade.
export { computeClimbLinks };

// Platform indices reachable by climbing from platform pi.
// Platform indices reachable by climbing from platform pi.
export function climbLinksFrom(world, pi) {
  const out = [];
  for (const l of world.climbLinks || []) {
    if (l.a === pi) out.push({ to: l.b, link: l });
    else if (l.b === pi) out.push({ to: l.a, link: l });
  }
  return out;
}

export function timeOfDay(world) {
  // v0.28: integer-tick phase — (tick % dayTicks) / dayTicks. Floating-point
  // world.time accumulates rounding over millions of ticks; the integer
  // count never drifts, so same seed → same light forever.
  const d = (world.dayTicks > 0 ? world.dayTicks : DAY_TICKS_DEFAULT) | 0;
  const t = ((world.tick | 0) % d + d) % d;
  return t / d;
}

// The shared daylight curve: 0 at midnight, 1 at noon. One clock drives
// world.light AND the seasonal T forcing's daylight gate (weather.js) —
// light and heat can never disagree about what time it is.
export function daylightCurve(phase) {
  const a = (phase - 0.25) * Math.PI * 2;
  const s = Math.sin(a) * 0.5 + 0.5;
  return s * s * (3 - 2 * s); // smootherstep
}

// Smooth daylight: 1 at noon, ~0.02 at midnight (v0.28: true night — the
// old 0.12 floor was perpetual twilight, and vision needs real darkness).
export function updateLight(world) {
  world.light = 0.02 + 0.98 * daylightCurve(timeOfDay(world));
}

let nextObjId = 1;
function oid() {
  return nextObjId++;
}

// v0.36 QA (Gemini P0 #1): like creature ids, object ids (plants, herbs,
// foods) must be world-relative for "same seed → same world" to hold
// across sequential worlds in one process.
export function resetObjectIds() { nextObjId = 1; }

// v0.18 "Realms": ZONES/zoneAt are a legacy alias over the biome map.
// The old three zone keys became the biome cores: verdant→jungle,
// arid→desert, highland→mountains. zoneAt(x) returns {key} with key ∈
// {'jungle','desert','mountains'} — the core range containing x, or the
// nearest core. soil/divergence/zoneCalls are keyed by the 8 biome keys;
// this alias is for legacy consumers (chronicle prose, teacher zones,
// renderer tints).
export const ZONES = [
  { key: 'jungle', name: 'Emerald Jungle', x1: 1200, x2: 1800, fruitMul: 0.6, tint: 'rgba(60,140,70,0.10)' },
  { key: 'desert', name: 'Sunscorch Desert', x1: 2400, x2: 3000, fruitMul: 2.2, tint: 'rgba(190,150,80,0.12)' },
  { key: 'mountains', name: 'Skyreach Mountains', x1: 600, x2: 1200, fruitMul: 1.2, tint: 'rgba(120,140,170,0.10)' },
];

export function zoneAt(x) {
  for (const z of ZONES) if (x >= z.x1 && x < z.x2) return z;
  let best = ZONES[0], bd = Infinity;
  for (const z of ZONES) {
    const d = Math.abs(x - (z.x1 + z.x2) / 2);
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}

// The soil pool for a position. v2: keyed by region id (each region's
// detritus loop is local). v1: keyed by the 8 biome keys.
export function soilAt(world, x) {
  const layout = world.layout;
  if (layout && !layout.canonical && layout.regions) {
    const r = regionAt(x, layout);
    return r ? world.soil[r.id] : null;
  }
  return world.soil ? world.soil[biomeKeyAt(x)] : null;
}

// v0.18: per-biome fruiting pressure — the old zone fruitMul generalized.
// Founder-neutral core: jungle 0.6 / desert 2.2 / mountains 1.2 are the
// v0.15 values, so founder behavior in old territory is unchanged.
export const BIOME_FRUIT_MUL = {
  arctic: 2.8, mountains: 1.2, jungle: 0.6, plains: 1.0,
  desert: 2.2, shallows: 0.8, archipelago: 0.9, deep: 2.6,
};

// v0.18: platformIndex -1 = floating flora (kelp) — not rooted on any
// platform; the frond hangs just below the local water surface. This is the
// convention for all platform-less entities (kelp, minnows): platformIndex
// -1 means "in the water column", never "nowhere".
function floatY(world, x) {
  const w = waterAt(x, 2000, world.layout);
  return w ? w.surfaceY + 12 : 800;
}

export function addPlant(world, x, platformIndex, genome, opts = {}) {
  // v0.13: initial plant genomes come from the decor stream — worldgen order
  // is load-bearing for determinism, and plant genomes must never shift the
  // main stream's sequence (founder genomes, rolls, etc.).
  const g = genome || randomPlantGenome(world.decorRng || world.rng);
  const plat = platformIndex === -1 ? null : world.platforms[platformIndex];
  const bk = biomeKeyAt(x, plat ? plat.y : 800, { layout: world.layout });
  const flora = floraFor(bk);
  const morph = opts.morph || flora.morph;
  const fruitKind = opts.fruitKind || flora.fruitKind;
  world.plants.push({
    kind: 'plant', id: oid(), x, platformIndex, y: plat ? plat.y : floatY(world, x),
    growth: world.rng.range(0.3, 0.8), fruitTimer: world.rng.range(5, 25),
    pollination: 0, // v0.22.2: 0..1 — raised by pollinator visits; fruit set scales with it
    // v0.34 — flower state: bud → bloom → (fruit set) → spent → bud.
    // Only bloom flowers receive pollinator visits. floraId is the
    // pollination species key (morph:fruitKind) — deposition only
    // fertilizes a second flower of the SAME species. pollenDonorGenome
    // is recorded on deposition, stamped onto each fruit at fruit set,
    // then cleared — the dad rides the fruit, not the plant.
    flower: 'bud', bloomTimer: 2, spentTimer: 0,
    floraId: morph + ':' + fruitKind,
    pollenDonorGenome: null,
    netted: world._exclosure === true, // exclosure probe: mesh excludes insects, not wind
    sway: world.rng.range(0, Math.PI * 2),
    zone: bk, // v0.26: geographic zone key
    morph, fruitKind,
    genome: g, pheno: plantPhenotype(g), // v0.13: plant genomes
  });
}

// v0.8: medicinal herbs. Same growth mechanics as fruit plants, but they bear
// bitter leaves (foodKind 'leaf') that purge illness instead of feeding hunger.
export function addHerb(world, x, platformIndex, genome, opts = {}) {
  const g = genome || randomPlantGenome(world.decorRng || world.rng);
  const plat = platformIndex === -1 ? null : world.platforms[platformIndex];
  world.plants.push({
    kind: 'herb', id: oid(), x, platformIndex, y: plat ? plat.y : floatY(world, x),
    growth: world.rng.range(0.3, 0.8), fruitTimer: world.rng.range(5, 25),
    pollination: 0, // v0.22.2: inert on herbs (they bear leaves, not fruit)
    flower: null, // v0.34: herbs don't bloom — the pollination loop is fruit plants only
    sway: world.rng.range(0, Math.PI * 2),
    zone: biomeKeyAt(x, plat ? plat.y : 800, { layout: world.layout }), // v0.26: geographic zone key
    morph: opts.morph || 'herb',
    fruitKind: 'leaf',
    genome: g, pheno: plantPhenotype(g), // v0.13: plant genomes
  });
}

export function addFood(world, x, platformIndex, kind = 'fruit', amount = 1, rotAfter = 0, opts = {}) {
  const plat = platformIndex === -1 ? null : world.platforms[platformIndex];
  world.foods.push({
    kind: 'food', id: oid(), x, platformIndex, y: plat ? plat.y : floatY(world, x), foodKind: kind, amount,
    vx: 0, vy: 0, // v0.17.2: loose food obeys gravity when lifted and released
    dragged: false, // v0.17.2: the observer's hand — gravity pauses while held
    // v0.13: plant-genome provenance — which plant bore this fruit, its
    // bitterness, and its nutrition. Enables seed dispersal + learned
    // avoidance of bitter plants.
    plantId: opts.plantId || 0, bitterness: opts.bitterness || 0,
    nutrition: opts.nutrition || 1,
    dadGenome: opts.dadGenome || null, // v0.34: outcrossing dad — stamped at fruit set
    // rotAfter: seconds until this fruit rots (0 = never). Nest-cache fruit
    // rots so it can't become a population-level food source — births must
    // increase food DEMAND, not supply, or the ecology explodes.
    rotsAt: rotAfter > 0 ? world.time + rotAfter : 0,
  });
  // v0.8 exam telemetry: opt-in spawn hook (intake-efficiency cost column).
  if (world.onSpawn) world.onSpawn(amount);
}

// v0.20 "Falling": windfall constants — the share of expired canopy fruit
// that drops to the floor, and how long it lasts down there.
export const WINDFALL_P = 0.5;
export const WINDFALL_ROT = 300; // seconds before windfall composts

// The ground platform below a point — the understory floor that catches
// what falls. Null over open water and the groundless deep.
function groundBelow(world, x, y) {
  let best = -1, bestY = Infinity;
  for (let i = 0; i < world.platforms.length; i++) {
    const p = world.platforms[i];
    if (p.kind !== 'ground') continue;
    if (x < p.x1 || x > p.x2 || p.y <= y) continue;
    if (p.y < bestY) { bestY = p.y; best = i; }
  }
  return best;
}

// v0.35 "Seed vectors": the water current field — one current per water
// body, derived PURELY from geometry (no RNG draws; worldgen order is
// load-bearing). Flow runs downhill: toward the end whose neighboring
// ground is lower, or toward open water (the sea) when adjacent. Salt
// water drifts slow; rivers run faster with length.
function buildCurrents(layout) {
  if (!layout || !layout.waters) return [];
  return layout.waters.map((w) => {
    const eL = groundYAt(w.x0 - 60, layout); // null = open water
    const eR = groundYAt(w.x1 + 60, layout);
    let dir;
    if (eL == null && eR == null) dir = 1;
    else if (eL == null) dir = -1; // drains to the sea on the left
    else if (eR == null) dir = 1;  // drains to the sea on the right
    else dir = eL <= eR ? 1 : -1;  // downhill (larger y = lower ground)
    const len = w.x1 - w.x0;
    const speed = w.salt ? 12 : 20 + Math.min(25, len / 40);
    return { x0: w.x0, x1: w.x1, surfaceY: w.surfaceY, salt: !!w.salt, dir, speed };
  });
}

// v0.20 "Falling": an expired canopy fruit falls to the understory instead
// of vanishing. Leaves still compost in place (the detritus layer); fruit
// becomes floor food — the below is a place with an economy, not a plane.
// v0.24: mass-honest. The coin-fail case composts the fruit in place (it
// rots where it hangs — it does NOT vanish); over-water drops compost to
// the lakebed soil (all 8 biomes carry soil entries); over-cap drops
// force-rot to the zone's waste (Paul's force-rot-on-cap rule). Nothing
// is ever deleted.
export function dropWindfall(world, f, rng) {
  if (!f) return;
  const compost = (amt) => {
    if (!(amt > 0)) return;
    const s = (f.zone != null && world.soil) ? world.soil[f.zone] : soilAt(world, f.x);
    if (s) s.waste += amt;
    else ledgerOut(world, 'lost', amt); // no soil entry: labeled, never silent
  };
  if (f.foodKind === 'leaf') { compost(f.amount); return; } // the detritus layer
  if (!rng.chance(WINDFALL_P)) { compost(f.amount); return; } // rots where it hangs
  const gi = groundBelow(world, f.x, f.y || 0);
  // v0.35: landing in water — the flesh composts to the lakebed (mass
  // conserved, as before); a fruit's seed joins the drift (hydrochory).
  // Water presence is read from the current field, not from the lakebed:
  // a lakebed platform exists UNDER the water, so gi >= 0 even mid-lake.
  const wet = (world.currents || []).find((r) => f.x >= r.x0 && f.x <= r.x1);
  if (wet) {
    compost(f.amount);
    if (f.foodKind === 'fruit' && f.plantId) spawnDriftSeed(world, f.x, f);
    return;
  }
  if (gi < 0) { compost(f.amount); return; } // void: sinks out of the world
  if (world.foods.length > 80) { compost(f.amount); return; } // force-rot: the floor can't stockpile
  const jx = f.x + (rng ? rng.range(-24, 24) : 0);
  addFood(world, jx, gi, f.foodKind, f.amount, WINDFALL_ROT, {
    plantId: f.plantId, bitterness: f.bitterness || 0, dadGenome: f.dadGenome || null,
    nutrition: (f.nutrition || 1) * 0.8, // overripe: still food, less of it
  });
}

// v0.35 "Seed vectors": ENDOZOCHORY — the gut as a dispersal vector.
// Gravity-only dispersal ends here. When a creature eats fruit, the seed
// loads into the gut (probability as before) and rides for GUT_TRANSIT_TICKS
// while the creature moves — then deposits WHERE THE CREATURE IS, away from
// the parent. No new action, no anatomical prerequisite: dispersal is
// passive (gut transit), not a verb the creature performs. Called from doEat.
export const GUT_TRANSIT_TICKS = 400;
export const GUT_SEED_CAP = 6; // gut capacity — seeds are bulk
export function disperseSeed(world, c, food) {
  if (!food.plantId) return;
  const parent = world.plants.find((p) => p.id === food.plantId);
  if (!parent || !parent.genome) return;
  const pYield = parent.pheno ? parent.pheno.yield : 0.5;
  if (!world.rng.chance(0.15 + 0.3 * pYield)) return; // eat-time roll, main stream (unchanged)
  c.gutSeeds = c.gutSeeds || [];
  if (c.gutSeeds.length >= GUT_SEED_CAP) return;
  const drng = world.disperseRng || world.rng;
  c.gutSeeds.push({
    plantId: food.plantId,
    momGenome: parent.genome,
    dadGenome: food.dadGenome || parent.genome, // v0.34: the dad rides the fruit
    kind: parent.kind,
    timer: GUT_TRANSIT_TICKS + drng.range(0, 200),
    xEaten: c.x, tEaten: world.time,
  });
}

// v0.35: plant one seedling from mom×dad genomes at (x, platformIndex).
// Shared by endozoochory (gut deposition) and hydrochory (wash-ashore).
// The flora cap + seedling-culling transfer are the v0.13 rules, unchanged;
// the seedling's initial tissue is the parent's labeled investment
// (ledgerIn 'parental'), never mass from nothing.
function plantSeedling(world, x, platformIndex, seed, vector) {
  // Flora cap (v0.13): oldest seedlings are culled first — and their tissue
  // composts to the zone's soil (v0.24, Paul's seed-cap splice fix: culling
  // is a transfer, not a deletion). v0.35 (Gemini review): if NO seedlings
  // exist, the old code returned without planting — a permanent sterility
  // deadlock once 60 plants are all mature (mature plants never die).
  // Fallback: cull the oldest mature plant (lowest id = first born; gap
  // dynamics — an old tree falls, a seedling takes its place). Seedlings
  // are still always preferred.
  if (world.plants.length >= 60) {
    const seedlings = world.plants.filter((p) => p.growth < 1);
    const victim = seedlings.length > 0 ? seedlings[0]
      : world.plants.slice().sort((a, b) => a.id - b.id)[0];
    if (victim) {
      world.plants.splice(world.plants.indexOf(victim), 1);
      const s = world.soil && world.soil[victim.zone];
      const culled = (Math.max(0, victim.growth || 0) + (victim._litterAcc || 0)) * PLANT_MASS;
      if (s) s.waste += culled;
      else ledgerOut(world, 'lost', culled); // no soil entry: labeled, never silent
    } else return null;
  }
  const plat = platformIndex === -1 ? null : world.platforms[platformIndex];
  if (platformIndex !== -1 && !plat) return null;
  const px = plat ? Math.max(plat.x1 + 10, Math.min(plat.x2 - 10, x)) : x;
  // v0.34 outcrossing preserved: the dad rode the fruit (endozoochory) or
  // the drift (hydrochory) — a later bloom can't rewrite this seed's parentage.
  const drng = world.disperseRng || world.rng;
  const childGenome = inheritPlant(seed.momGenome, seed.dadGenome || seed.momGenome, drng);
  if (seed.kind === 'herb') addHerb(world, px, platformIndex, childGenome);
  else addPlant(world, px, platformIndex, childGenome);
  const seedling = world.plants[world.plants.length - 1];
  seedling.growth = 0.05; // a true seedling — must mature before fruiting
  ledgerIn(world, 'parental', 0.05 * PLANT_MASS);
  world.events.push({
    type: 'seedDispersed', vector, plant: seedling, parentId: seed.plantId,
    dist: Math.abs(px - (seed.xEaten != null ? seed.xEaten : px)), t: world.time,
  });
  return seedling;
}

// v0.35: the gut clock. Called beside excrete() in the creature tick —
// timers count ticks (dt-independent). On expiry the seed deposits at the
// creature's CURRENT position; over water (no platform) it joins the drift
// instead of being lost.
export function tickGutSeeds(world, c) {
  if (!c.gutSeeds || c.gutSeeds.length === 0) return;
  for (let i = c.gutSeeds.length - 1; i >= 0; i--) {
    const s = c.gutSeeds[i];
    s.timer -= 1;
    if (s.timer > 0) continue;
    c.gutSeeds.splice(i, 1);
    depositSeed(world, c.x, c.platformIndex, s, 'endozoochory');
  }
}

function depositSeed(world, x, platformIndex, seed, vector) {
  const plat = (platformIndex !== undefined && platformIndex >= 0) ? world.platforms[platformIndex] : null;
  if (plat) return plantSeedling(world, x, platformIndex, seed, vector);
  // Over open water (or void) — hydrochory takes the seed.
  const rect = (world.currents || []).find((r) => x >= r.x0 && x <= r.x1);
  if (!rect) {
    // Mass-neutral: parental input is only booked at planting, so an
    // unplantable seed simply ends. Labeled, never silent.
    world.events.push({ type: 'seedLost', vector, parentId: seed.plantId, t: world.time });
    return null;
  }
  const drng = world.disperseRng || world.rng;
  world.driftSeeds.push({
    x, y: rect.surfaceY,
    momGenome: seed.momGenome, dadGenome: seed.dadGenome, kind: seed.kind,
    plantId: seed.plantId, xEaten: seed.xEaten,
    ttl: 1500 + drng.range(0, 1000), rect,
  });
  world.events.push({ type: 'seedAdrift', parentId: seed.plantId, t: world.time });
  return null;
}

// v0.35: a windfall fruit over water launches its seed into the drift.
function spawnDriftSeed(world, x, food) {
  const parent = world.plants.find((p) => p.id === food.plantId);
  if (!parent || !parent.genome) return;
  if (world.driftSeeds.length >= 40) return; // bounded flotsam
  const drng = world.disperseRng || world.rng;
  if (!drng.chance(0.5)) return;
  const rect = (world.currents || []).find((r) => x >= r.x0 && x <= r.x1);
  if (!rect) return;
  world.driftSeeds.push({
    x, y: rect.surfaceY,
    momGenome: parent.genome, dadGenome: food.dadGenome || parent.genome,
    kind: parent.kind, plantId: food.plantId, xEaten: x,
    ttl: 1500 + drng.range(0, 1000), rect,
  });
  world.events.push({ type: 'seedAdrift', parentId: food.plantId, t: world.time });
}

// v0.35: HYDROCHORY — drift seeds ride their rect's current. At the rect's
// edge the seed washes ashore: ground at the exit point → germinate there
// (new ground colonized); neighboring water → keep drifting; ttl expiry →
// sinks (no mass was ever booked for a drifting seed, so the sinking is
// mass-neutral; the event keeps it labeled).
export function tickDriftSeeds(world, dt) {
  if (!world.driftSeeds || world.driftSeeds.length === 0) return;
  for (let i = world.driftSeeds.length - 1; i >= 0; i--) {
    const s = world.driftSeeds[i];
    s.ttl -= 1;
    if (s.ttl <= 0) {
      world.driftSeeds.splice(i, 1);
      world.events.push({ type: 'seedSunk', parentId: s.plantId, t: world.time });
      continue;
    }
    const cur = s.rect;
    s.x += cur.dir * cur.speed * dt;
    if (s.x < cur.x0 || s.x > cur.x1) {
      world.driftSeeds.splice(i, 1);
      const exitX = Math.max(0, Math.min(world.width, s.x));
      const gi = groundBelow(world, exitX, cur.surfaceY);
      const nrect = (world.currents || []).find((r) => r !== cur && exitX >= r.x0 && exitX <= r.x1);
      if (gi >= 0) {
        plantSeedling(world, exitX, gi, s, 'hydrochory'); // wash-ashore zone
      } else if (nrect) {
        s.rect = nrect; s.x = exitX;
        world.driftSeeds.push(s);
      } else {
        world.events.push({ type: 'seedSunk', parentId: s.plantId, t: world.time });
      }
    }
  }
}

// v0.22.2 — addCritter is retired. The butterfly and the bug were promoted
// to full founder creatures (flutter, grub in species.js) on the one
// engine; the scripted brainless-critter path is gone.

export function addToy(world, x, platformIndex) {
  const plat = world.platforms[platformIndex];
  world.toys.push({
    kind: 'ball', id: oid(), x, platformIndex, y: plat.y, vx: 0, vy: 0, r: 16,
    dragged: false, // v0.17.2: the observer's hand — gravity pauses while held
  });
}

// v0.9 embodiment: pushable pebbles. The world is material — bodies act on
// it and it pushes back. Stones persist; creatures shove them by collision;
// heavy stones resist the pusher. Not decoration: they block, pile, and
// must be navigated.
export function addPebble(world, x, platformIndex) {
  const plat = world.platforms[platformIndex];
  world.pebbles.push({
    kind: 'pebble', id: oid(), x, platformIndex, y: plat.y,
    vx: 0, vy: 0, r: (world.pebbleRng || world.rng).range(9, 17),
    dragged: false, // v0.17.2: the observer's hand — gravity pauses while held
  });
}

// v0.17.1 "Touch": minerals. Static deposits — they never move, grow, or
// tick. hardness 0..1 describes the stone (the technology release will
// make it matter for toolmaking; for now it is honest description, not a
// gate). amount = collectable samples remaining; depleted deposits stay
// in the world, labeled as such, rather than vanishing.
// CREATURES CANNOT USE MINERALS YET — see src/sim/observer.js.
export const MINERAL_TYPES = [
  // v0.20 "Hands": materials gain the full property set — hardness,
  // weight, sharpness, flammability (v0.21's fuel, laid down inert here),
  // malleability (clay — shaping waits for pottery, v+1). Materials don't
  // evolve; only their use does. A tool is never a coded item — it is a
  // carried object whose properties change what the carrier's verbs do.
  { key: 'flint', name: 'Flint', color: '#4a4a52', hardness: 0.9, weight: 0.5, sharpness: 0.9, flammability: 0.0, malleability: 0.0, blurb: 'Sharp-edged stone. The blade material — hands will want this.' },
  { key: 'quartz', name: 'Quartz', color: '#cfd8e6', hardness: 0.7, weight: 0.4, sharpness: 0.6, flammability: 0.0, malleability: 0.0, blurb: 'Glassy crystal. Catches the light — and holds an edge.' },
  { key: 'clay', name: 'Clay', color: '#a5715c', hardness: 0.3, weight: 0.5, sharpness: 0.0, flammability: 0.0, malleability: 1.0, blurb: 'Soft earth. Malleable — shaping waits for fire (pottery, v+1).' },
  // v0.18 §12.2: per-biome resource sets — timber stands, building stone,
  // driftwood currents. Creature-usable as of v0.20.
  { key: 'timber', name: 'Timber', color: '#6b4a2f', hardness: 0.4, weight: 0.7, sharpness: 0.1, flammability: 0.9, malleability: 0.0, blurb: 'Fallen wood. Haft material — and fuel, when fire comes.' },
  { key: 'stone', name: 'Stone', color: '#8a8a8a', hardness: 0.8, weight: 0.9, sharpness: 0.2, flammability: 0.0, malleability: 0.0, blurb: 'Building stone. Shelter waits inside the heavy stuff — and hammers.' },
  { key: 'driftwood', name: 'Driftwood', color: '#9c7a54', hardness: 0.35, weight: 0.3, sharpness: 0.0, flammability: 0.7, malleability: 0.0, blurb: 'Sea-smoothed wood. It floats — that is the whole affordance.' },
];

export function mineralType(key) {
  return MINERAL_TYPES.find((t) => t.key === key) || MINERAL_TYPES[0];
}

export function addMineral(world, x, platformIndex, typeKey) {
  const plat = world.platforms[platformIndex];
  if (!plat) return null;
  const type = mineralType(typeKey);
  const m = {
    kind: 'mineral', id: oid(), x, platformIndex, y: plat.y,
    mineralKey: type.key, mineralName: type.name,
    color: type.color, hardness: type.hardness, blurb: type.blurb,
    // v0.20 "Hands": the full property set rides the deposit — a grasped
    // sample inherits these. flammability is inert until v0.21 lights it.
    weight: type.weight, sharpness: type.sharpness,
    flammability: type.flammability, malleability: type.malleability,
    amount: 4, // samples per deposit
  };
  world.minerals.push(m);
  return m;
}

// v0.20 "Hands": sticks — fallen branches on the forest floor. Loose
// objects like pebbles (graspable whole), timber by material. Spawned by
// worldgen at fixed positions (determinism: no rng, like minerals);
// they rot back to litter after STICK_ROT_S if unused — nothing
// accumulates forever. (The dead-tree decay chain hooks in when plant
// mortality exists; until then, worldgen is the source.)
export const STICK_ROT_S = 5400; // 90 sim-minutes of lying around
export function addStick(world, x, platformIndex) {
  const plat = world.platforms[platformIndex];
  if (!plat) return null;
  const t = mineralType('timber');
  const s = {
    kind: 'stick', id: oid(), x, platformIndex, y: plat.y,
    vx: 0, vy: 0, r: 12,
    material: 'timber',
    hardness: t.hardness, weight: t.weight, sharpness: t.sharpness,
    flammability: t.flammability,
    born: world.time,
    dragged: false, // the observer's hand, like pebbles
  };
  world.sticks.push(s);
  return s;
}

// v0.14: postzygotic barrier — hybrid viability falls as the parents'
// genome distance exceeds the threshold. Within-population matings
// (distance ~0.1) are untouched; genuinely divergent lineages produce
// weaker offspring. Exported for tests.
export const HYBRID_THRESHOLD = 0.30;
export function hybridViability(dist) {
  if (dist <= HYBRID_THRESHOLD) return 1;
  return Math.max(0.3, 1 - Math.min(0.7, (dist - HYBRID_THRESHOLD) * 2));
}
export function layEgg(world, x, platformIndex, genome, parents = null, gen = 0, traditionIds = [], gestMult = 1, parentDist = 0) {
  const plat = world.platforms[platformIndex];
  // v0.24: the egg carries a fixed mass (from the child's genome — babies
  // are small), provisioned by the mother at laying: a LABELED boundary
  // input. Hatching is then an exact transfer (egg → body), never a
  // creation event (Paul's hatch trap, closed).
  const mass = eggMassForGenome(genome);
  ledgerIn(world, 'parental', mass);
  world.eggs.push({
    kind: 'egg', id: oid(), x, y: plat.y, platformIndex, genome, parents,
    vx: 0, vy: 0, // v0.17.2: eggs obey gravity when lifted and released
    dragged: false, // v0.17.2: the observer's hand — gravity pauses while held
    gen, traditionIds, // v0.7: pedigree depth + vertical cultural inheritance
    timer: (18 + world.rng.range(0, 10)) * gestMult, wobble: 0, // v2 (L): gestation scales
    parentDist, // v0.14: parental genome distance — the hybrid penalty input
    mass, // v0.24: the mass the hatch transfer moves
  });
}

export function tryMate(a, b) {
  // Called with world as `this` via world.tryMate — bound below.
  const world = this;
  const sa = ageStage(a.biochem, a.pheno);
  const sb = ageStage(b.biochem, b.pheno);
  if (sa !== 'adult' || sb !== 'adult') return false;
  if (a.sex === b.sex || a.mateCooldown > 0 || b.mateCooldown > 0) return false;
  // v0.30: species-tag mating gate (ECOLOGY_DESIGN §13.2) — prezygotic,
  // SPECIES-level not tribe-level. Only same-tag pairs breed; a tanglekin
  // never mates a beetle, but tanglekins from different tribes mate freely.
  // Default-neutral: within a species nothing changes.
  if (a.pheno.speciesTag !== b.pheno.speciesTag) return false;
  // Breeding takes energy: malnourished creatures don't reproduce. This is
  // the density-dependent brake — when food is scarce, hunger rises and
  // births stop before the population overshoots into a crash.
  // (Founders are exempt: a new world needs its first generation established
  // before regulation kicks in.)
  const founderPair = !a.parents && !b.parents;
  if (!founderPair && (a.biochem.hunger > 0.7 || b.biochem.hunger > 0.7)) return false;
  // Carrying capacity: hard safety net. The hunger gate regulates day-to-day,
  // but stochastic bursts can still run away — this guarantees boundedness.
  // (A soft ramp suppressed births too aggressively at low populations and
  // caused extinctions; the hunger gate already handles gentle regulation.)
  const pop = world.creatures.reduce((n, c) => n + (c.alive ? 1 : 0), 0);
  if (pop >= 40) return false;
  // v2 (L): fertility peaks at a genetic age-fraction (window ±0.4 of
  // lifespan). Inside the window fertility is full; outside it declines.
  // Founder peak 0.5 covers the whole adult stage — neutral by default,
  // evolvable into early or late bloomers.
  const fertAt = (p) => {
    const t = p.biochem.age / (p.pheno.lifespanSec || 1);
    const d = Math.abs(t - (p.pheno.ferPeak ?? 0.5));
    return d <= 0.4 ? 1 : Math.max(0.2, 1 - (d - 0.4) * 2);
  };
  if (world.rng.next() > seasonBreedMul(world) * (0.35 + 0.4 * Math.min(a.pheno.fertility * fertAt(a), b.pheno.fertility * fertAt(b)))) return false;
  // v0.27 "Seasons": breeding rides the year — 1.0 at the spring equinox,
  // 0.6 at autumn. A pull on the mating chance, never a gate (founder
  // economics, not forced outcomes). Analytic in world.time: no rng draws.
  const mom = a.sex === 'female' ? a : b;
  const dad = a.sex === 'female' ? b : a;
  // v0.5: clutches of two. One egg per mating kept the birth rate below the
  // death rate once drift and infant mortality took their cut; a pair of eggs
  // per mating gives lineages the demographic buffer to persist.
  // v2 (L): litter size is genetic (founder → 2, as before); gestation scales
  // the egg timer (founder → ×1.0, as before).
  const nEggs = mom.pheno.ferLitter ?? 2;
  const gestMult = 0.5 + (mom.pheno.ferGest ?? 0.5);
  // v0.7: pedigree depth for the ratchet metric, and vertical transmission —
  // hatchlings inherit their parents' traditions (the "N+1 contains N" half).
  const childGen = Math.max(a.generation || 0, b.generation || 0) + 1;
  const parentTraditions = [...new Set([...(mom.traditions || []), ...(dad.traditions || [])])];
  // v0.14: parental genome distance — the postzygotic barrier input.
  // v0.16 (delta d): lexicon distance joins the barrier — word-drift
  // becomes a reproductive barrier, which is what turns drift into
  // distinct languages. Additive, so language difference alone can push
  // a pairing over the hybrid threshold.
  const lexD = lexiconDistance(mom.lexicon, dad.lexicon);
  const parentDist = genomeDistance(mom.genome, dad.genome) + 0.35 * lexD;
  for (let i = 0; i < nEggs; i++) {
    // v0.37 "Affect": the new affect loci mutate on their own sub-stream
    // (world.affectRng, salt 55) — the main sequence never sees those draws.
    const eg = inherit(mom.genome, dad.genome, world.rng, undefined, world.affectRng);
    // v0.14: gene duplication/deletion events enter the world's record —
    // the evolution tracker marks them on the timeline.
    for (const e of eg.dupLog || []) {
      world.dupEvents.push({ t: world.time, kind: e.kind, key: e.key, parents: [mom.id, dad.id] });
    }
    if (world.dupEvents.length > 200) world.dupEvents.splice(0, world.dupEvents.length - 200);
    layEgg(world, (a.x + b.x) / 2 + world.rng.range(-30, 30), a.platformIndex, eg, [mom.id, dad.id], childGen, parentTraditions, gestMult, parentDist);
    mom.children.push('egg');
    dad.children.push('egg');
  }
  mom._gaveBirth = true; // v0.37 "Affect": the prolactin event — birth spikes parental care
  a.mateCooldown = 90;
  b.mateCooldown = 90;
  a.reward += 0.8;
  b.reward += 0.8;
  // v0.12: mating forms a pair bond — the strongest positive bond event.
  nudgeBond(world, a, b, 0.4);
  // v0.37 "Affect": the vasopressin pair-bond. Mating the SAME partner
  // strengthens the specific bond (+0.3); mating a DIFFERENT partner while
  // pair-bonded elsewhere halves the strongest existing pair bond
  // (infidelity's price — design §8d) and flags the chemistry for the
  // vasopressin penalty. The mated flags feed tickBiochem (sexHormone
  // refractory drop, vasopressin rise).
  for (const [self, other] of [[a, b], [b, a]]) {
    let bondedElsewhere = false;
    if (world.pairBonds) {
      for (const [k, e] of world.pairBonds) {
        const [ia, ib] = k.split('-').map(Number);
        const involves = ia === self.id || ib === self.id;
        const isThisPair = (ia === self.id && ib === other.id) || (ia === other.id && ib === self.id);
        if (involves && !isThisPair && e.v > 0.3) { bondedElsewhere = true; break; }
      }
    }
    if (bondedElsewhere) {
      halvePairBond(world, self);
      self._matedInfidelity = true;
    } else {
      self._matedInfidelity = false;
    }
    nudgePairBond(world, self, other, 0.3);
    self._mated = true; // consumed by tickBiochem (refractory), cleared in updateCreature
    self._matedPartner = other;
  }
  // v0.13: beautiful-mutant watch — a novel-genome parent that reproduces
  // proved its combination. Reproduction is the only fitness that counts.
  for (const p of [mom, dad]) {
    if (world.novelParents.has(p.id)) {
      world.novelParents.delete(p.id);
      world.events.push({ type: 'beautifulMutant', creature: p, mate: p === mom ? dad : mom, t: world.time });
    }
  }
  world.events.push({ type: 'mating', a, b, t: world.time });
  return true;
}

// v0.10 lineage: snapshot a newborn's heritable traits so the UI can show
// ancestry even after the parents die. Traits are the legible, evolvable
// phenotype values (0..1 floats, plus diet choice).
export const LINEAGE_TRAITS = ['size', 'legLength', 'spikes', 'fur', 'eyeSize', 'mouthSize', 'immunity', 'learningRate', 'boldness', 'lifespan'];

export function recordLineage(world, c) {
  const traits = {};
  for (const k of LINEAGE_TRAITS) traits[k] = c.pheno[k];
  traits.diet = c.pheno.diet;
  world.lineage.set(c.id, {
    id: c.id, name: c.name,
    parents: c.parents ? [...c.parents] : null,
    generation: c.generation || 0,
    bornAt: world.time,
    diedAt: null, // v0.14: closed by noteDeath
    cause: null,
    zone: biomeKeyAt(c.x), // v0.18: birth biome (8 keys)
    speciesId: c.speciesId ?? null, // v0.14: species at birth (may split later)
    traits,
  });
  // v0.14: children index — the family tree walks down without scanning.
  if (c.parents) {
    for (const pid of c.parents) {
      if (typeof pid !== 'number') continue;
      let kids = world.lineageKids.get(pid);
      if (!kids) { kids = []; world.lineageKids.set(pid, kids); }
      if (kids.length < 60) kids.push(c.id);
    }
  }
  // Soft cap: forget the oldest records beyond 5000 (ancestor chains for
  // living creatures are walked at view time, so pruning the deep past is safe).
  if (world.lineage.size > 5000) {
    const first = world.lineage.keys().next().value;
    world.lineage.delete(first);
  }
}

// v0.14: death bookkeeping — the event for toasts, and the lineage record
// for the family tree (diedAt + cause close the creature's arc).
// v0.18 §13.4: corpses — the door to each other, left ajar. Base rot time
// for a corpse; cold preserves (arctic rot time triples at full cold).
export const CORPSE_ROT = 150;
// v0.24: everything a body carried returns to the world at death — gut
// contents spill to the zone's soil (decomposition's honest start), held
// tools drop where the body fell. A transfer, never a deletion.
export function releaseBodyMass(world, c) {
  const s = soilAt(world, c.x);
  if (s && (c.gut || 0) > 0) s.waste += c.gut;
  c.gut = 0;
  if (c.held) {
    const held = c.held;
    c.held = null;
    const plat = world.platforms[c.platformIndex];
    if (plat) {
      const dropX = Math.max(plat.x1, Math.min(plat.x2, c.x));
      if (held.material === 'timber' || held.material === 'driftwood') {
        const st = addStick(world, dropX, c.platformIndex);
        if (st) {
          st.material = held.material; st.weight = held.weight;
          st.hardness = held.hardness; st.sharpness = held.sharpness;
          st.flammability = held.flammability; st.born = world.time;
        }
      } else {
        const p = addPebble(world, dropX, c.platformIndex);
        if (p) {
          p.material = held.material; p.weight = held.weight;
          p.hardness = held.hardness;
        }
      }
    } else if (s) {
      s.waste += held.weight || 0; // no ground to drop on: ground down, not gone
    }
  }
}

export function noteDeath(world, c, cause) {
  world.events.push({ type: 'death', creature: c, t: world.time, cause });
  const rec = world.lineage.get(c.id);
  if (rec) { rec.diedAt = world.time; rec.cause = cause; }
  // v0.37 "Affect": grief — bond rupture as sustained stress (design §3.2).
  // Every living creature with bond > 0.5 to the dead one (or a pair bond
  // of any strength) receives the grief event: adrenaline +0.8 (shock),
  // oxytocin −0.4 (the hole), serotonin −0.15 (the mark), and the grief
  // timer (griefTime locus, ~1 day). The dead are pruned from world.bonds
  // by tickBonds; grief reads the EVENT, not the map. Multiple losses
  // stack the serotonin marks — a creature that loses its whole troop can
  // slide into the depressed regime through grief alone (the honest causal
  // chain, not a scripted tragedy). No phenomenal claim: this is a stress
  // response with the dynamics of rupture, not felt loss (design §9).
  if (world.bonds || world.pairBonds) {
    for (const o of world.creatures) {
      if (!o.alive || o.id === c.id) continue;
      const bond = world.bonds ? getBond(world.bonds, o, c) : 0;
      const pair = getPairBond(world.pairBonds, o, c);
      if (bond > 0.5 || pair > 0.05) {
        const ob = o.biochem;
        ob.adrenaline = Math.max(0, Math.min(1, ob.adrenaline + 0.8));
        ob.oxytocin = Math.max(0, Math.min(1, ob.oxytocin - 0.4));
        ob.serotonin = Math.max(0, Math.min(1, ob.serotonin - 0.15));
        o.griefT = (0.5 + (o.pheno.griefTime ?? 0.5)) * 86400; // ~1 day of world time
        o.griefX = c.x; // the death site — the mourn verb goes here
        o.griefPlatform = c.platformIndex;
        world.events.push({ type: 'grieved', mourner: o.id, dead: c.id, t: world.time });
      }
    }
  }
  releaseBodyMass(world, c); // v0.24: gut spills, held tools drop — nothing vanishes with the body
  // v0.18 §13.4: the dead leave a corpse at the death position — edible via
  // eat (scavenging is possible from v0.18; predation is not scripted).
  // Corpses decay; ambient cold slows decay (the Arctic keeps its dead).
  // Replaces the v0.7 'meat' carcass previously spawned in the dead-splice
  // of tickWorld — one corpse per death, not two. TODO(creature-agent):
  // doEat's meatEfficiency branch should include 'corpse' (creature.js) so
  // scavenging rewards carnivores; until then corpses eat at fruitEfficiency.
  // v0.24: the corpse weighs what the body weighed (bodyMassOf — a transfer
  // from the bodies pool to the food pool, not a creation). At founder
  // values this is exactly 1.2, so the scavenging economy is unchanged.
  const plat = world.platforms[c.platformIndex];
  const cold = ambientCold(c.x, plat ? plat.y : 800, world.layout);
  addFood(world, c.x, c.platformIndex, 'corpse', bodyMassOf(c), CORPSE_ROT * (1 + 2 * cold), { nutrition: 1 });
}
// Two creatures share a hash only if every allele matches to 3 decimals.
export function genomeHash(genome) {
  const parts = [];
  for (const key of Object.keys(genome.alleles).sort()) {
    const [a, b] = genome.alleles[key];
    parts.push(a.toFixed(3) + '/' + b.toFixed(3));
  }
  // v0.14: duplicated copies are part of identity.
  for (const key of Object.keys(genome.extra || {}).sort()) {
    const [a, b] = genome.extra[key];
    parts.push('x' + key + ':' + a.toFixed(3) + '/' + b.toFixed(3));
  }
  let h = 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// v0.13: the beautiful-mutant watch. A birth whose genome hash was never
// seen before is flagged novel; if that individual later reproduces, the
// novel combination proved itself — a "beautiful mutant" (reproduction =
// fitness, the only fitness evolution recognizes).
export function checkNovelGenome(world, c) {
  const h = genomeHash(c.genome);
  if (world.seenGenomes.has(h)) return false;
  world.seenGenomes.add(h);
  // Soft cap: the deep past's genotypes are forgotten (10k cap).
  if (world.seenGenomes.size > 10000) {
    const first = world.seenGenomes.values().next().value;
    world.seenGenomes.delete(first);
  }
  world.novelParents.add(c.id);
  world.events.push({ type: 'novelGenome', creature: c, t: world.time });
  return true;
}

// v0.14 "Voices": emit a grounded call into the acoustic commons.
// Pitch = vocalPitch × (1 ± vocalRange × noise); earshot scales with
// vocalVolume. Calls live ~2 sim-seconds; the zone archive keeps the last
// 300 per zone for dialect measurement.
export function emitCall(world, c, type, proto = null) {
  const p = c.pheno;
  // The LEARNED pitch is what's heard: genetics sets the base voicePitch
  // at birth, imitation drifts it, and the accent is audible. This is what
  // makes dialects real — a zone's accent lives in ears, not just genes.
  // v0.16: body size sets base pitch (sizePitchFactor — big bodies rumble,
  // small bodies chirp; physics, not script). The optional proto carries
  // the lexicon's chosen prototype; without one the call is raw voice.
  const base = (c.voicePitch ?? p.vocalPitch ?? 0.5) * sizePitchFactor(p);
  const range = p.vocalRange ?? 0.3;
  const ap = proto || {};
  const pitch = ap.pitch !== undefined ? ap.pitch
    : Math.max(0.05, Math.min(1, base * (1 + (world.rng.next() * 2 - 1) * range)));
  const length = ap.length !== undefined ? ap.length : 0.15 + world.rng.next() * 0.5;
  const loudness = ap.loudness !== undefined ? ap.loudness : baseLoud(p);
  const volume = p.vocalVolume ?? 0.5;
  const earshot = 200 + volume * 400; // kept for compatibility
  const zkey = biomeKeyAt(c.x); // v0.18: zoneCalls keyed by the 8 biome keys
  const cplat = world.platforms[c.platformIndex];
  const call = {
    t: world.time, type,
    pitch: Math.max(0.05, Math.min(1, pitch)),
    length: Math.max(0.05, Math.min(1.2, length)),
    loudness: Math.max(0.05, Math.min(1, loudness)),
    volume, earshot,
    platformIndex: c.platformIndex, x: c.x, y: cplat ? cplat.y : 0,
    zone: zkey, callerId: c.id, callerName: c.name, fromTeacher: false,
    proto: null,
  };
  call.proto = { pitch: call.pitch, length: call.length, loudness: call.loudness };
  world.calls.push(call);
  let log = world.zoneCalls[zkey];
  if (!log) { log = []; world.zoneCalls[zkey] = log; }
  log.push({ t: world.time, pitch: call.pitch, type });
  if (log.length > 300) log.splice(0, log.length - 300);
  pushUtterance(world, call); // v0.16: the Tongues notebook's raw material
  return call;
}

// v0.16: what does creature c hear right now? Sound as physics — the
// recent call with the strongest amplitude at c's ear: 1/d cylindrical
// spreading, platform-slab + foliage occlusion along the ray, then the
// hearing-threshold gene gates reception. What arrives (pitch, length,
// loudness-at-ear, direction) is slightly noisy. Returns { heard: 0..1,
// pitch, alarm } for the old senses, plus the acoustic event for the
// lexicon.
export const CALL_REF_D = 400; // loudness 0.5 carries ~400px unoccluded
export function callsHeardBy(world, c) {
  const plat = world.platforms[c.platformIndex];
  const hearY = plat ? plat.y : 0;
  const thr = hearThresh(c.pheno || {});
  let best = null, bestAmp = 0;
  const calls = world.calls || [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (!call || call.callerId === c.id) continue;
    const dx = call.x - c.x;
    const dy = (call.y !== undefined ? call.y : hearY) - hearY;
    const d = Math.sqrt(dx * dx + dy * dy);
    let amp = (call.loudness !== undefined ? call.loudness : 0.5) * CALL_REF_D / Math.max(d, 1);
    if (amp < thr) continue; // inaudible even unoccluded
    amp *= soundOcclusion(world, call.x, call.y !== undefined ? call.y : hearY, c.x, hearY);
    if (amp < thr) continue;
    const age = world.time - call.t;
    const score = amp * Math.max(0, 1 - age / 2);
    if (score > bestAmp) { bestAmp = score; best = call; best._ampAtEar = amp; }
  }
  if (!best) return { heard: 0, pitch: 0, alarm: false, call: null };
  const heard = Math.max(0, Math.min(1, (bestAmp - thr) / Math.max(0.05, 1.5 - thr)));
  const nz = world.rng.next() * 2 - 1;
  return {
    heard,
    pitch: Math.max(0.05, Math.min(1, best.pitch * (1 + nz * 0.03))),
    alarm: best.type === 'alarm',
    call: best,
    length: best.length,
    loudnessAtEar: best._ampAtEar,
    direction: Math.abs(best.x - c.x) < 1 ? 0 : Math.sign(best.x - c.x),
  };
}

// v0.16: occlusion along the ray (delta e) — branch slabs and foliage
// puffs eat sound. Endpoints' own slabs don't count (the ray travels
// along the caller's / hearer's own branch, it doesn't punch through).
function segmentHitsSlab(x1, y1, x2, y2, pl) {
  const near1 = Math.abs(y1 - pl.y) < 14 && x1 >= pl.x1 - 4 && x1 <= pl.x2 + 4;
  const near2 = Math.abs(y2 - pl.y) < 14 && x2 >= pl.x1 - 4 && x2 <= pl.x2 + 4;
  if (near1 || near2) return false;
  const dy = y2 - y1;
  if (Math.abs(dy) < 1e-6) return false;
  for (const edge of [pl.y - 10, pl.y + 10]) {
    const t = (edge - y1) / dy;
    if (t > 0.02 && t < 0.98) {
      const x = x1 + (x2 - x1) * t;
      if (x >= pl.x1 && x <= pl.x2) return true;
    }
  }
  return false;
}

export function foliageDensityAt(world, x, y) {
  let d = 0;
  const plats = world.platforms;
  const plants = world.plants || [];
  for (let i = 0; i < plants.length; i++) {
    const pl = plants[i];
    const plat = plats[pl.platformIndex];
    if (!plat) continue;
    const dx = x - pl.x, dy = y - (plat.y - 70); // foliage puff above the branch
    const d2 = dx * dx + dy * dy;
    if (d2 < 1210000) d += Math.exp(-d2 / 24200); // σ=110
  }
  return d;
}

export function soundOcclusion(world, x1, y1, x2, y2) {
  let att = 1;
  const plats = world.platforms || [];
  for (let i = 0; i < plats.length; i++) {
    if (segmentHitsSlab(x1, y1, x2, y2, plats[i])) att *= 0.55;
    // v0.19 "Language": ridge sound shadows. A solid mass (ridge, rock)
    // is earth, not air — the ray that punches THROUGH the body loses
    // energy to diffraction. The slab band alone would leak sound under
    // the ridge top; the body test closes the leak.
    if (plats[i].solid && rayHitsSolid(x1, y1, x2, y2, plats[i], world.layout)) att *= RIDGE_SHADOW;
  }
  const N = 10;
  let fol = 0;
  for (let i = 1; i < N; i++) {
    const t = i / N;
    fol += foliageDensityAt(world, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  }
  fol /= (N - 1);
  att *= Math.max(0.25, 1 - 0.6 * Math.min(1, fol));
  return att;
}

// v0.19: the acoustic body of a solid platform — from its top down to the
// ground beneath (the ridge's foot). NaN-guarded: a bad platform yields a
// degenerate body that no ray can enter.
export const RIDGE_SHADOW = 0.45; // attenuation per solid-mass crossing
function solidBody(pl, layout = null) {
  const x1 = Number(pl.x1), x2 = Number(pl.x2), top = Number(pl.y);
  if (![x1, x2, top].every(Number.isFinite) || x2 <= x1) {
    return { x1: 0, x2: -1, top: 0, base: 0 };
  }
  let base = top + 160; // fallback foot if the ground map has no answer
  try {
    const g = groundYAt((x1 + x2) / 2, layout);
    if (Number.isFinite(g)) base = Math.max(g, top + 40);
  } catch (e) { /* keep the fallback */ }
  return { x1, x2, top, base };
}

// Does the ray pass through the solid body? Endpoints standing on the mass
// itself are excluded — the ray leaves along the surface, it doesn't punch
// through. Interior samples make the test robust to any angle. A true
// shadow needs the ray to spend real distance inside the earth: a single
// sample kissing the body's corner (a hearer standing at the ridge's foot,
// the ray clipping the cliff base) is diffraction around an edge, not a
// shadow — it takes >=3 of 20 samples to count.
function rayHitsSolid(x1, y1, x2, y2, pl, layout = null) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
  const near1 = Math.abs(y1 - pl.y) < 16 && x1 >= pl.x1 - 4 && x1 <= pl.x2 + 4;
  const near2 = Math.abs(y2 - pl.y) < 16 && x2 >= pl.x1 - 4 && x2 <= pl.x2 + 4;
  if (near1 || near2) return false;
  const b = solidBody(pl, layout);
  const N = 20;
  let inside = 0;
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    // The foot edge is inclusive: a ray running at ground level still meets
    // the ridge face and diffracts over it. The top edge stays strict —
    // grazing the crest is not punching through.
    if (x > b.x1 && x < b.x2 && y > b.top && y <= b.base && ++inside >= 3) return true;
  }
  return false;
}

// v0.16: troop-level word census (delta c — culture lives at the troop
// level). Greedy-clusters each tribe's lexicon entries by acoustic distance
// into shared words; tracks speaker counts and spread/die trends for the
// Tongues notebook. Writes entry.speakers back for the forget rule.
export function censusTroopWords(world) {
  const out = [];
  const tribes = world.tribes || [];
  const byId = new Map(world.creatures.map((c) => [c.id, c]));
  tribes.forEach((tribe, ti) => {
    const members = (tribe.members || [])
      .map((id) => byId.get(id))
      .filter((c) => c && c.alive && c.lexicon);
    if (!members.length) return;
    const clusters = [];
    for (const c of members) {
      for (const e of c.lexicon.entries) {
        if (e.confidence < 0.25) continue;
        let placed = null;
        for (const cl of clusters) {
          if (acousticDistance(cl.centroid, e.proto) < 0.18) { placed = cl; break; }
        }
        if (!placed) {
          placed = { members: [], centroid: { pitch: e.proto.pitch, length: e.proto.length, loudness: e.proto.loudness } };
          clusters.push(placed);
        }
        placed.members.push({ c, e });
      }
    }
    const words = clusters.map((cl) => {
      let sw = 0;
      const cent = { pitch: 0, length: 0, loudness: 0 };
      const contexts = { food: 0, alarm: 0, mate: 0, contact: 0, come: 0 };
      const speakers = new Set();
      let total = 0;
      for (const { c, e } of cl.members) {
        const w = 0.5 + e.confidence;
        sw += w;
        cent.pitch += e.proto.pitch * w;
        cent.length += e.proto.length * w;
        cent.loudness += e.proto.loudness * w;
        for (const k of LEX_CONTEXTS) contexts[k] += e.contexts[k] || 0;
        speakers.add(c.id);
        total += e.heard + e.used;
      }
      cent.pitch /= sw; cent.length /= sw; cent.loudness /= sw;
      for (const { e } of cl.members) e.speakers = speakers.size;
      return {
        name: wordName(cent), proto: cent,
        speakers: speakers.size, contexts, total, trend: '•',
      };
    });
    words.sort((a, b) => b.speakers - a.speakers || b.total - a.total);
    out.push({
      tribeIndex: ti, homeX: tribe.homeX,
      memberCount: members.length, words: words.slice(0, 12),
    });
  });
  // Spread-vs-die trend against the previous census.
  const prevMap = new Map();
  for (const t of world._prevTroopWords || []) {
    for (const w of t.words) prevMap.set(`${Math.round(t.homeX)}:${w.name}`, w.speakers);
  }
  for (const t of out) {
    for (const w of t.words) {
      const ps = prevMap.get(`${Math.round(t.homeX)}:${w.name}`);
      w.trend = ps === undefined ? '•' : w.speakers > ps ? '▲' : w.speakers < ps ? '▼' : '•';
    }
  }
  world._prevTroopWords = out;
  return out;
}

// ---- v0.14 "Voices": the waste cycle ----
// Digestion's byproduct, lawfully. A bite's mass splits: nutrition feeds
// blood sugar (doEat → _ate → tickBiochem), the rest becomes gut waste.
// Excretion is proportional clearance into the creature's current zone —
// no timers, no dice, and the gut can never go negative. Decomposition
// converts raw waste into fertility; fertility relaxes toward the 0.5
// baseline (leaching) so the soil is a dynamic equilibrium, not a battery.
// Fertility feeds plant growth: 0.5 → neutral ×1.0.
export const WASTE_FRACTION = 0.35; // of each bite's mass becomes gut waste
export const EXCRETE_RATE = 0.6; // per-second proportional gut clearance
// Soil dynamics (retuned v0.14-disgust): decomposition must OUTPACE fouling
// or odor pegs at 1.0 everywhere inhabited and the smell carries no
// information. SOIL_DECAY=0.1 → waste half-life ~7s; typical inhabited zones
// sit at waste 0.5–1.5 (odor 0.1–0.4, a gradient), only true crowding hits
// full stink. Fertility equilibrium: fert − 0.5 = 0.5 × waste — empty ground
// 0.5, typical ground 0.75–1.25, rich ground caps at 1.5.
export const SOIL_DECAY = 0.1; // per-second proportional waste→fertility
export const SOIL_CONV_EFF = 0.02; // fertility gained per unit waste decomposed
export const SOIL_LEACH = 0.04; // per-second relaxation of fertility to 0.5 (v0.24: raised 5x — donor-limited growth was out-drawing weathering, collapsing jungle/plains fertility to zero; the faster weathering holds the founder economy)
export const SOIL_FERT_MAX = 1.5;
export const WASTE_ODOR_SCALE = 4; // soil-waste units that read as full stink
export const CONTAM_ILLNESS = 0.15; // illness per unit bite at full contamination
// v0.14.1 "Detritus": nothing leaves the loop. Rot, scraps, shed leaves all
// compost into the zone soil — death feeds the ground that feeds the plants.
export const SCRAP_FRACTION = 0.12; // of each bite falls as litter
export const TISSUE_FRACTION = 0.10; // v0.24: of each bite becomes body tissue (capped at adult mass)
export const SCRAP_ROT = 45; // seconds before a scrap composts
export const SCRAP_NUTRITION = 0.35; // scraps are poor food
export const LITTER_RATE = 0.004; // soil-waste per second per plant at growthRate 0.5

// v0.14: disgust's information channel — how fouled the ground smells here,
// 0 (clean) to 1 (full stink). Tolerates stub worlds without soil (see the
// jumpNear range-gate test). The sense the instinct reads.
// v0.18 §13.7: under noFouling the world reads clean — this also neutralizes
// the illness-from-waste contraction in creature.js doEat, which multiplies
// by this odor (bite × 0 × CONTAM_ILLNESS = 0). The contraction site itself
// is the creature agent's file; the switch achieves the neutralization here.
export function wasteOdorOf(world, x) {
  if (world.noFouling) return 0;
  const s = soilAt(world, x);
  return s ? Math.min(1, s.waste / WASTE_ODOR_SCALE) : 0;
}

export function excrete(c, world, dt) {
  // v0.33: noFouling NO LONGER no-ops excretion. The illness path is
  // neutralized at wasteOdorOf (→ 0), and detritus grazing is already
  // gated on !noFouling in creature.js — so the nutrient cycle
  // (waste → fertility → plants) runs identically in both arms and the
  // CLEAN arm differs from NAT only by the illness contraction.
  if (!c.gut || c.gut <= 0 || !world.soil) return;
  const dep = Math.min(c.gut, c.gut * EXCRETE_RATE * dt);
  if (dep <= 0) return;
  c.gut -= dep;
  const s = soilAt(world, c.x);
  if (s) s.waste += dep;
}

export function tickSoil(world, dt) {
  // v0.33: noFouling NO LONGER freezes the soil. See excrete() above —
  // the CLEAN arm keeps the full nutrient cycle; only illness is held out.
  if (!world.soil) return;
  // v2: soil pools keyed by region id — iterate entries (key, pool).
  // v1: keyed by the 8 biome keys.
  const entries = (world.layout && !world.layout.canonical)
    ? Object.entries(world.soil)
    : BIOMES.map((b) => [b.key, world.soil[b.key]]).filter(([, s]) => s);
  for (const [key, s] of entries) {
    // Decomposition: raw waste becomes fertility — at the rate the
    // zone's bacteria set (v0.22 "Web of Life": the decomposer layer is
    // living; at founder biomass the multiplier is exactly 1.0, so all
    // pre-v0.22 soil behavior is preserved).
    // v0.24: the conversion is lossy (SOIL_CONV_EFF) — the remainder is
    // respired as CO2, a LABELED boundary loss (Paul's 70/30 compost split,
    // generalized). Nothing vanishes unlabeled.
    const conv = Math.min(s.waste, s.waste * SOIL_DECAY * decompMultiplier(world, key) * dt);
    s.waste -= conv;
    const fertAdd = conv * SOIL_CONV_EFF;
    const fertSpace = Math.max(0, SOIL_FERT_MAX - s.fertility);
    s.fertility += Math.min(fertSpace, fertAdd);
    // Fertility-cap overflow runs off to the water table (Paul's cap rule:
    // caps merge, never delete).
    const fertOver = fertAdd - Math.min(fertSpace, fertAdd);
    if (fertOver > 0) {
      if (world.climate) world.climate.waterTable += fertOver;
      else s.fertility += fertOver; // minimal test worlds: retain, don't delete
    }
    ledgerOut(world, 'respired', conv * (1 - SOIL_CONV_EFF));
    // Leaching, mass-conserving (v0.24): the old line relaxed fertility
    // toward 0.5 by creating/destroying it. Now the two halves are honest —
    // downward relaxation washes excess to the water table (transfer);
    // upward relaxation is rock weathering, a LABELED boundary input.
    const relax = (0.5 - s.fertility) * Math.min(1, SOIL_LEACH * dt);
    if (relax > 0) {
      s.fertility += relax;
      ledgerIn(world, 'weathering', relax);
    } else if (relax < 0) {
      s.fertility += relax;
      if (world.climate) world.climate.waterTable -= relax;
      else ledgerOut(world, 'leached', -relax); // minimal test worlds: labeled loss
    }
    // v0.14.1: the land remembers — first crossing into rich ground is
    // history, not just chemistry. Noted once per zone per enrichment.
    if (s.fertility >= 1.0 && !s.richNoted) {
      s.richNoted = true;
      if (world.events) world.events.push({ type: 'soilRich', zone: key, t: world.time });
    } else if (s.fertility < 0.8) {
      s.richNoted = false; // lean times reset the record; richness can return
    }
  }
}

// v0.14.1 "Detritus": rot is not deletion. When food expires uneaten, its
// remaining mass composts into the zone soil — corpse meat after the
// scavengers have had their 150s, nest fruit, fallen scraps, bitter leaves.
// What the eaters don't take, the ground does.
export function compostRot(world) {
  for (let i = world.foods.length - 1; i >= 0; i--) {
    const f = world.foods[i];
    if (f.rotsAt > 0 && world.time >= f.rotsAt) {
      const s = soilAt(world, f.x);
      // v0.24: the FULL amount composts — nutrition is an energy quality,
      // not a mass discount. Composting amount×nutrition deleted the
      // (1−nutrition) share (−2.5 drift in the rot isolation probe).
      if (s) s.waste += f.amount;
      else ledgerOut(world, 'lost', f.amount); // no soil entry: labeled, never silent
      world.foods.splice(i, 1);
    }
  }
}

// v0.14.1: leaf litter — the unused parts of plants.
// v0.24: litter is coupled to growth (a fraction of tissue actually grown
// this tick sheds as litter) instead of being created from nothing. No
// growth → no litter. Shed leaves are not an item (no render, no sense
// surface); they go straight to the ground.
export function shedLitter(world, dt) {
  if (!world.soil) return;
  for (const p of world.plants) {
    const acc = p._litterAcc || 0;
    if (acc <= 0) continue;
    const s = world.soil[p.regionId !== undefined ? p.regionId : p.zone];
    if (s) {
      s.waste += acc * PLANT_MASS;
      p._litterAcc = 0;
    }
    // No soil entry for this zone: the litter stays banked on the plant —
    // never deleted.
  }
}

// Plant growth multiplier from soil fertility. Exported for tests and UI.
export function soilGrowthMul(world, zoneKey) {
  const soil = world.soil || {};
  // v2: zoneKey may be a label ('jungle') — resolve to the largest region
  // with that label. v1: zoneKey is the biome key directly.
  let key = zoneKey;
  if (world.layout && !world.layout.canonical && typeof zoneKey === 'string') {
    let best = null, bestW = -1;
    for (const r of world.layout.regions) {
      if (r.label === zoneKey) {
        const w = r.x1 - r.x0;
        if (w > bestW) { bestW = w; best = r; }
      }
    }
    if (best) key = best.id;
  }
  const s = soil[key];
  const f = s ? s.fertility : 0.5;
  return 0.7 + 0.6 * f;
}
// S = μ_zone(adults now) − μ_founders. Positive S = the biome selected
// upward on that trait; negative = downward. Computed every 6 sim-minutes.
// v0.13: divergence metric (Eliza's S). Per biome, per tracked trait:
// S = μ_zone(adults now) − μ_founders. Positive S = the biome selected
// upward on that trait; negative = downward. Computed every 6 sim-minutes.
// v0.17 "Bauplan": the body plan joins the divergence census — wings,
// grasp pairs, sails, gills, fins, and segment counts are the traits the
// bauplan release exists to watch diverge.
export const DIVERGENCE_CREATURE_TRAITS = ['instHomeSeek', 'size', 'bulk', 'curiosity', 'boldness', 'vocalPitch',
  'wingArea', 'graspPairs', 'sailArea', 'gillArea', 'finArea', 'bodySegs'];
export const DIVERGENCE_PLANT_TRAITS = ['waterRet', 'coldTol', 'bitterness', 'yield'];

export function recordFounderMeans(world) {
  const means = {};
  const n = world.creatures.length;
  if (n === 0) return;
  for (const k of DIVERGENCE_CREATURE_TRAITS) {
    let sum = 0;
    for (const c of world.creatures) sum += c.pheno[k] !== undefined ? c.pheno[k] : 0.5;
    means[k] = sum / n;
  }
  for (const k of DIVERGENCE_PLANT_TRAITS) {
    let sum = 0, m = 0;
    for (const p of world.plants) {
      if (p.pheno && p.pheno[k] !== undefined) { sum += p.pheno[k]; m++; }
    }
    means['plant_' + k] = m > 0 ? sum / m : 0.5;
  }
  world.founderMeans = means;
}

export function computeDivergence(world) {
  if (!world.founderMeans) return null;
  const snap = { t: world.time, zones: {} };
  for (const b of BIOMES) { // v0.18: per-biome (8), not per-zone (3)
    const zs = { key: b.key };
    // Creatures: adults currently in this biome.
    const adults = world.creatures.filter((c) => c.alive && biomeKeyAt(c.x) === b.key);
    for (const k of DIVERGENCE_CREATURE_TRAITS) {
      if (adults.length === 0) { zs[k] = 0; continue; }
      let sum = 0;
      for (const c of adults) sum += c.pheno[k] !== undefined ? c.pheno[k] : 0.5;
      zs[k] = sum / adults.length - world.founderMeans[k];
    }
    // Plants: all plants rooted in this zone.
    const plants = world.plants.filter((p) => p.zone === b.key && p.pheno);
    for (const k of DIVERGENCE_PLANT_TRAITS) {
      const pk = 'plant_' + k;
      if (plants.length === 0) { zs[pk] = 0; continue; }
      let sum = 0;
      for (const p of plants) sum += p.pheno[k] !== undefined ? p.pheno[k] : 0.5;
      zs[pk] = sum / plants.length - world.founderMeans[pk];
    }
    snap.zones[b.key] = zs;
  }
  world.divergenceLog.push(snap);
  // Keep the log bounded: one snapshot per 6 sim-minutes, cap at 500.
  if (world.divergenceLog.length > 500) world.divergenceLog.splice(0, world.divergenceLog.length - 500);
  return snap;
}

// ---- v0.14 "Voices": speciation ----
// Species are detected, never assigned — single-linkage clustering of
// adults by genome distance. Cluster ids persist across snapshots by member
// overlap; a cluster whose members split into two viable groups is a
// speciation event, logged for the evolution tracker and announced.
export const SPECIES_DIST = 0.25; // below this distance: same species
export function computeSpecies(world) {
  const adults = world.creatures.filter((c) => {
    if (!c.alive || !c.genome) return false;
    const st = ageStage(c.biochem, c.pheno);
    return st === 'adult' || st === 'senior';
  });
  const clusters = [];
  outer: for (const c of adults) {
    for (const cl of clusters) {
      // Single linkage: close to ANY member — sample 8 for speed.
      const n = Math.min(cl.length, 8);
      for (let i = 0; i < n; i++) {
        if (genomeDistance(c.genome, cl[i].genome) < SPECIES_DIST) { cl.push(c); continue outer; }
      }
    }
    clusters.push([c]);
  }
  // Match clusters to the previous snapshot by member overlap → stable ids.
  const prev = world.speciesPrev || [];
  const used = new Set();
  const idOf = new Map();
  for (let i = 0; i < clusters.length; i++) {
    const ids = clusters[i].map((c) => c.id);
    let best = -1, bestOv = 0;
    for (let j = 0; j < prev.length; j++) {
      if (used.has(j)) continue;
      let ov = 0;
      for (const id of ids) if (prev[j].ids.has(id)) ov++;
      if (ov > bestOv) { bestOv = ov; best = j; }
    }
    if (best >= 0 && bestOv >= 2) { used.add(best); idOf.set(i, prev[best].id); }
    else idOf.set(i, ++world.speciesSeq);
  }
  for (let i = 0; i < clusters.length; i++) {
    const id = idOf.get(i);
    for (const c of clusters[i]) c.speciesId = id;
  }
  // Speciation: a previous cluster (≥6 members) whose members now live in
  // ≥2 current clusters of ≥3 each has split.
  for (const p of prev) {
    if (p.ids.size < 6) continue;
    const dist = new Map(); // current species id → member count from p
    for (let i = 0; i < clusters.length; i++) {
      let n = 0;
      for (const c of clusters[i]) if (p.ids.has(c.id)) n++;
      if (n >= 3) dist.set(idOf.get(i), n);
    }
    if (dist.size >= 2) {
      const ev = { type: 'speciation', t: world.time, from: p.id, to: [...dist.keys()], sizes: [...dist.values()] };
      world.events.push(ev);
      world.speciesLog.push({ t: world.time, kind: 'split', ...ev });
    }
  }
  // The snapshot the evolution tracker draws: per-cluster size, mean voice
  // pitch (the dialect signature), and home zone.
  const snap = {
    t: world.time,
    kind: 'snapshot',
    clusters: clusters.map((cl, i) => {
      let pitch = 0;
      const zones = {};
      for (const c of cl) {
        pitch += c.voicePitch ?? 0.5;
        const zk = biomeKeyAt(c.x); // v0.18: home biome (8 keys)
        zones[zk] = (zones[zk] || 0) + 1;
      }
      const home = Object.keys(zones).sort((a, b) => zones[b] - zones[a])[0] || '?';
      return { id: idOf.get(i), size: cl.length, meanPitch: cl.length ? pitch / cl.length : 0.5, zone: home };
    }),
  };
  world.speciesLog.push(snap);
  if (world.speciesLog.length > 500) world.speciesLog.splice(0, world.speciesLog.length - 500);
  world.speciesPrev = clusters.map((cl, i) => ({ id: idOf.get(i), ids: new Set(cl.map((c) => c.id)) }));
  return snap;
}

// ---- v0.20 "Species": the living taxonomy ----
// speciesOverview() turns the clustering snapshots into panel-ready data:
// one entry per living species with population, range, mean traits, and
// divergences from the population mean (the "adaptations" view). Pure read
// of world state — no sim writes, safe to call on every UI refresh.
export const SPECIES_NEW_WINDOW = 1800; // sim-seconds a species counts as "new"
export const TRAIT_LABELS = {
  size: 'Body size', legLength: 'Leg length', spikes: 'Spikes', fur: 'Fur thickness',
  eyeSize: 'Eye size', mouthSize: 'Mouth size', immunity: 'Immunity',
  learningRate: 'Learning rate', boldness: 'Boldness', lifespan: 'Lifespan',
};
export function speciesOverview(world) {
  const adults = [];
  const byId = new Map();
  let unclustered = 0;
  const isAdult = (c) => { const st = ageStage(c.biochem, c.pheno); return st === 'adult' || st === 'senior'; };
  for (const c of world.creatures) {
    if (!c.alive) continue;
    if (isAdult(c)) adults.push(c);
    const sid = c.speciesId;
    if (sid == null) { unclustered++; continue; }
    if (!byId.has(sid)) byId.set(sid, []);
    byId.get(sid).push(c);
  }
  // Global adult means — the baseline divergences are measured against.
  const gMeans = {};
  for (const k of LINEAGE_TRAITS) {
    let s = 0, n = 0;
    for (const c of adults) { const v = c.pheno[k]; if (typeof v === 'number') { s += v; n++; } }
    gMeans[k] = n ? s / n : 0;
  }
  // History: first-seen tick + parent species from split events.
  const firstSeen = new Map(), parentOf = new Map();
  for (const e of world.speciesLog || []) {
    if (e.kind === 'split') {
      for (const id of e.to || []) if (!parentOf.has(id)) parentOf.set(id, e.from);
    } else if (e.kind === 'snapshot') {
      for (const cl of e.clusters || []) if (!firstSeen.has(cl.id)) firstSeen.set(cl.id, e.t);
    }
  }
  const biomeName = (k) => { const b = BIOMES.find((x) => x.key === k); return b ? b.name : k; };
  const species = [];
  for (const [id, members] of byId) {
    const ad = members.filter(isAdult);
    const basis = ad.length ? ad : members; // trait means over adults when any exist
    const means = {};
    for (const k of LINEAGE_TRAITS) {
      let s = 0, n = 0;
      for (const c of basis) { const v = c.pheno[k]; if (typeof v === 'number') { s += v; n++; } }
      means[k] = n ? s / n : 0;
    }
    const diets = {};
    let pitch = 0, pn = 0;
    const zones = {};
    let genMin = Infinity, genMax = -Infinity;
    for (const c of members) {
      if (typeof c.voicePitch === 'number') { pitch += c.voicePitch; pn++; }
      const zk = biomeKeyAt(c.x);
      zones[zk] = (zones[zk] || 0) + 1;
      const d = c.pheno.diet; if (d) diets[d] = (diets[d] || 0) + 1;
      const g = c.generation || 0; if (g < genMin) genMin = g; if (g > genMax) genMax = g;
    }
    const divergences = [];
    for (const k of LINEAGE_TRAITS) {
      const gm = gMeans[k];
      if (gm !== 0) {
        const rel = (means[k] - gm) / Math.abs(gm);
        if (Math.abs(rel) >= 0.15) divergences.push({ trait: k, label: TRAIT_LABELS[k] || k, rel, speciesMean: means[k], globalMean: gm });
      }
    }
    divergences.sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
    const home = Object.keys(zones).sort((a, b) => zones[b] - zones[a])[0] || '?';
    const diet = Object.keys(diets).sort((a, b) => diets[b] - diets[a])[0] || '?';
    const fs = firstSeen.has(id) ? firstSeen.get(id) : null;
    species.push({
      id, size: members.length, adults: ad.length, juveniles: members.length - ad.length,
      homeBiome: home, homeBiomeName: biomeName(home), biomes: zones,
      meanPitch: pn ? pitch / pn : 0.5, meanTraits: means, diet, divergences,
      genMin: genMin === Infinity ? 0 : genMin, genMax: genMax < 0 ? 0 : genMax,
      firstSeen: fs, parentId: parentOf.has(id) ? parentOf.get(id) : null,
      isNew: fs != null && (world.time - fs) < SPECIES_NEW_WINDOW,
      members: members.slice(0, 12).map((c) => ({ id: c.id, name: c.name })),
      memberTotal: members.length,
    });
  }
  species.sort((a, b) => b.size - a.size);
  let sharks = 0, bears = 0;
  for (const p of world.predators || []) {
    if (!p.alive && p.alive !== undefined) continue;
    if (p.kind === 'shark') sharks++;
    else if (p.kind === 'bear') bears++;
  }
  return { t: world.time, species, unclustered, globalMeans: gMeans, predators: { sharks, bears } };
}

function hatchEgg(world, egg) {  const c = createCreature(egg.genome, egg.x, egg.platformIndex, world.rng, {
    parents: egg.parents,
    generation: egg.gen || 0,
  });
  // v0.24: exact mass transfer — the hatchling's body mass IS the egg mass.
  // Tissue grows from food afterward (doEat), capped at the adult mass.
  c.bodyMass = egg.mass;
  c.name = uniqueName(world, c.name);
  // v0.14: postzygotic barrier. A hatchling of divergent parents carries
  // the cost in its body — shorter life, less time to breed. The record
  // goes on the creature for the family tree.
  const hv = hybridViability(egg.parentDist || 0);
  if (hv < 1) {
    c.pheno.lifespanSec *= hv;
    c.hybrid = { dist: egg.parentDist, viability: hv };
  }
  // v0.7 vertical transmission: the hatchling inherits its parents'
  // traditions with fidelity-scaled loyalty — knowledge, not DNA.
  const fid = fidelityOf(c.pheno);
  for (const tid of egg.traditionIds || []) {
    const t = world.culture.traditions.find((x) => x.id === tid);
    if (t && world.rng.chance(fid * 0.85)) adoptTradition(world.culture, c, t, fid, world.rng);
  }
  // Newborns start hungry-ish and sleepy, like real babies. Set the
  // chemicals, not the readouts — the drives compute themselves.
  c.biochem.bloodSugar = 0.55;
  c.biochem.fatigue = 0.3;
  // Rooting reflex (v0.5): a newborn's first commitment is to eat. Combined
  // with the nest cache below, the first meal is near-guaranteed, and its
  // reward bootstraps the seekFood/eat learning loop.
  c.action = 'eat';
  c.actionTimer = 3;
  world.creatures.push(c);
  recordLineage(world, c);
  checkNovelGenome(world, c); // v0.13: beautiful-mutant watch
  world.events.push({ type: 'hatch', creature: c, t: world.time });
  // v0.5: nest cache. Hatchlings used to starve when the egg landed far from
  // food; now every nest is stocked with a first bite. That first meal's
  // reward bootstraps the seekFood/eat learning loop. One bite (not a full
  // fruit) + rots after 90s: it feeds the baby's first meal, not the
  // population — a full fruit per birth was a runaway feedback loop.
  // v0.24: the cache is a LABELED boundary subsidy (was created from
  // nothing). Founder-tuned, still one bite.
  ledgerIn(world, 'provisioning', 0.35);
  addFood(world, egg.x + world.rng.range(-14, 14), egg.platformIndex, 'fruit', 0.35, 90);
  const i = world.eggs.indexOf(egg);
  if (i >= 0) world.eggs.splice(i, 1);
}

// v0.34 — pollination, properly. The v0.22.2 placeholder (any other-flower
// visit raises a meter) is replaced by the real loop:
//   flower state: only 'bloom' flowers are visited;
//   pollen tags: the visitor carries [{ floraId, donorId, donorGenome,
//     viability }] — viability decays deterministically, no RNG;
//   deposition: a viable tag on a SECOND flower of the SAME flora species
//     fertilizes it (pollination meter up, donor genome recorded for
//     outcrossing); self-pollen and cross-species pollen don't;
//   fruit set scales with the meter in the fruiting block; wind, selfing and
//     gravity hold the 0.6 baseline floor there — the fallback per design.
// ANATOMY (Joshua 2026-10-02 — every verb declares its prerequisites):
//   pollinator = small body (pheno.size ≤ 0.3) AND flight-capable
//   (bodyPlan.wingArea > 0.1, or airborne and not grounded). Phenotypic —
//   never a species label. A grub that never flies never pollinates.
// No RNG draws anywhere in this path: pickup, deposition and viability are
// deterministic; the world's own stochasticity (who visits what, when)
// supplies the variance. Nothing to annotate on the rng-boundary.
const POLLINATION_VISIT_R = 80;   // px, horizontal
const POLLINATION_VISIT_DY = 140; // px, vertical
const POLLEN_TAGS_MAX = 4;        // a visitor's pollen load — oldest drops off
const POLLEN_VIABLE_MIN = 0.25;   // below this a tag can't fertilize
const POLLEN_STALE_RATE = 0.02;   // viability/s — ~50s of foraging life

export function tickPollination(world, dt) {
  for (const c of world.creatures) {
    if (!c.alive) continue;
    const ph = c.pheno || {};
    if ((ph.size === undefined ? 1 : ph.size) > 0.3) continue; // small bodies only
    const wingArea = (c.bodyPlan && c.bodyPlan.wingArea) || 0;
    if (wingArea <= 0.1 && !c.gliding && c.grounded) continue; // must fly to visit
    let best = null, bd = Infinity;
    for (const p of world.plants) {
      if (p.kind !== 'plant' || p.growth < 1 || p.flower !== 'bloom') continue;
      if (p.netted) continue; // exclosure probe: netted flowers are unvisitable
      const dx = Math.abs(p.x - c.x);
      if (dx > POLLINATION_VISIT_R) continue;
      const dy = Math.abs(p.y - (c.y === undefined ? p.y : c.y));
      if (dy > POLLINATION_VISIT_DY) continue;
      const d = dx + dy * 0.5;
      if (d < bd) { bd = d; best = p; }
    }
    // Pollen goes stale whether or not a flower is in reach.
    const tags = (c.pollen = c.pollen || []);
    for (let i = tags.length - 1; i >= 0; i--) {
      tags[i].viability -= dt * POLLEN_STALE_RATE;
      if (tags[i].viability <= 0) tags.splice(i, 1);
    }
    if (!best) continue;
    // PICKUP: every bloom visit dusts the visitor with this flower's pollen.
    const existing = tags.find((t) => t.donorId === best.id);
    if (existing) existing.viability = 1;
    else {
      tags.push({ floraId: best.floraId, donorId: best.id, donorGenome: best.genome, viability: 1 });
      while (tags.length > POLLEN_TAGS_MAX) tags.shift();
    }
    // DEPOSITION: a viable tag from a SECOND flower of the SAME species
    // fertilizes — the meter rises and the donor genome is recorded for
    // outcrossing (disperseSeed reads it).
    for (const t of tags) {
      if (t.viability < POLLEN_VIABLE_MIN || t.donorId === best.id || t.floraId !== best.floraId) continue;
      best.pollination = Math.min(1, (best.pollination || 0) + 0.25 * Math.min(1, dt * 4));
      best.pollenDonorGenome = t.donorGenome;
      if (world.time - (world._lastPollenLog === undefined ? -1e9 : world._lastPollenLog) > 60) {
        world.events.push({ type: 'pollinated', plant: best.id, by: c.id, donor: t.donorId, t: world.time });
        world._lastPollenLog = world.time;
      }
      break; // one deposition per visit — the first viable tag wins
    }
    // Nectar: a sip — the flower's sugar is photosynthate, sunlight's
    // labeled boundary input (v0.24). The sugar's MASS enters the gut
    // (a ledger pool); the _ate is the energy from digesting it, tracked
    // separately from mass. Gut → soil via excrete closes the loop.
    ledgerIn(world, 'sunlight', 0.12 * dt);
    c.gut = (c.gut || 0) + 0.12 * dt;
    c._ate = (c._ate || 0) + 0.12 * dt;
  }
  // Pollen washes off / goes stale.
  for (const p of world.plants) {
    if (p.pollination > 0) p.pollination = Math.max(0, p.pollination - dt * 0.004);
  }
}

export function tickWorld(world, dt) {
  world.time += dt;
  world.tick = (world.tick | 0) + 1; // v0.28: the integer clock — day phase derives from this
  // v0.23 "Weather": the sky ticks FIRST — clouds shade the light below.
  if (world.climate) tickClimate(world, dt, world.climateGeo);
  updateLight(world);
  if (world.climate) world.light *= 1 - 0.55 * world.climate.meanCloud; // cloud-shading feedback
  const rng = world.rng;

  // Plants grow fruit.
  for (const p of world.plants) {
    // v0.13: growth rate from the plant genome.
    // v0.14: the waste cycle closes the loop — soil fertility (fed by
    // excretion, built by decomposition) scales growth. Fertile ground
    // grows faster; exhausted ground stalls.
    // v0.24: growth is donor-limited and double-entry. The plant synthesizes
    // tissue from soil minerals (fertility first, then waste — Paul's order)
    // plus sunlight's labeled boundary input (the carbon/water share).
    // Total tissue = retained growth + shed litter: litter is grown tissue,
    // honestly sourced — not created from nothing. The rate formula is
    // unchanged; the donor limit only binds on exhausted ground, where
    // growth honestly stalls. The headroom cap binds BEFORE the draw, so
    // overflow is never taken.
    const rawDg = (dt / 150) * (0.5 + (p.pheno ? p.pheno.growthRate : 0.5)) * soilGrowthMul(world, p.zone);
    let dg = Math.min(Math.max(0, 1 - p.growth), rawDg);
    if (dg > 0) {
      let tissue = dg * (1 + LITTER_FRAC);
      const need = tissue * MINERAL_FRAC;
      let draw = 0;
      const gs = world.soil && world.soil[p.regionId !== undefined ? p.regionId : p.zone];
      if (gs) {
        const avail = (gs.fertility || 0) + (gs.waste || 0);
        if (Math.min(need, avail) < need) {
          // Exhausted ground: the whole synthesis scales down — retained
          // growth and litter together, honestly.
          dg *= Math.min(need, avail) / need;
          tissue = dg * (1 + LITTER_FRAC);
        }
        draw = tissue * MINERAL_FRAC;
        let d = draw;
        const fromFert = Math.min(gs.fertility || 0, d);
        gs.fertility -= fromFert; d -= fromFert;
        gs.waste = Math.max(0, (gs.waste || 0) - d);
      }
      p.growth += dg;
      p._litterAcc = (p._litterAcc || 0) + dg * LITTER_FRAC; // shed with growth
      ledgerIn(world, 'sunlight', tissue * PLANT_MASS - draw);
    }
    // v0.23 "Weather": drought withers like cold. Soil moisture below 0.12
    // stresses the plant; prolonged drought kills it back to a sprout.
    if (world.climate) {
      const ds = droughtStressAt(world, p.x);
      if (ds > 0) {
        const loss = Math.min(p.growth, ds * dt * 0.015);
        p.growth -= loss;
        // v0.24: withered tissue returns to the soil (Paul's wither rule) —
        // rot, not deletion.
        const ws = world.soil && world.soil[p.regionId !== undefined ? p.regionId : p.zone];
        if (ws) ws.waste += loss * PLANT_MASS;
        else ledgerOut(world, 'withered', loss * PLANT_MASS);
      }
    }
    p.sway += dt;
    // v0.34 — flower phenology: bud → bloom → (fruit set) → spent → bud.
    // Bloom is the only visitable state; the cycle is timer-driven, no RNG.
    // Seedlings don't flower — phenology starts at maturity.
    if (p.flower && p.growth >= 1) {
      if (p.flower === 'spent') {
        p.spentTimer -= dt;
        if (p.spentTimer <= 0) p.flower = 'bud';
      } else if (p.flower === 'bud') {
        p.bloomTimer -= dt;
        if (p.bloomTimer <= 0) p.flower = 'bloom';
      }
    }
    if (p.growth >= 1) {
      p.fruitTimer -= dt;
      if (p.fruitTimer <= 0) {
        // v0.8 exam mode: only the hot patch fruits at the exam rate; cold
        // patches fruit at the trickle rate (Infinity = barren). Null exam =
        // the normal ~19s world.
        let interval = 12 + rng.range(0, 14);
        const ex = world.exam;
        if (ex) {
          const hp = ex.patches[ex.hot];
          interval = (p.x >= hp.x1 && p.x <= hp.x2) ? ex.hotInterval : ex.coldInterval;
        } else {
          // v0.13 plant genomes: the fruiting interval, yield, and zone
          // stress all read the plant's own genome now.
          // v0.11 biomes + scarcity: zone sets the base rate; crowding slows
          // everything (density-dependent scarcity — more mouths, less fruit).
          // Herbs are counter-cyclical: medicine thrives where food is scarce.
          // v0.18 "Realms": biome stress. p.zone is a biome key (8).
          // Founder-neutral core: jungle 0.6 / desert 2.2 / mountains 1.2
          // are the v0.15 fruitMul values, so founder behavior in old
          // territory is unchanged — new pressures bite only in the
          // new frontiers.
          const ph = p.pheno || {};
          const intervalGene = 0.7 + 0.6 * (ph.interval !== undefined ? ph.interval : 0.5);
          // v0.23 "Weather": the stress biome is EMERGENT — the Whittaker
          // lookup on the generated T/M field, not the painted zone. At
          // worldgen the two agree (pinned); they drift apart as the climate
          // evolves, and selection follows the weather, not the map.
          const bk = world.climate ? biomeKeyAt(p.x, p.y || 800, world) : p.zone;
          const fruitMul = BIOME_FRUIT_MUL[bk] !== undefined ? BIOME_FRUIT_MUL[bk] : 1;
          let zoneStress;
          if (p.kind === 'herb') {
            // Herbs are counter-cyclical: medicine thrives where food is scarce.
            zoneStress = (bk === 'desert' || bk === 'arctic') ? 0.9 : 1.1;
          } else if (bk === 'desert') {
            // Drought: thirsty plants stall; water-retainers keep fruiting.
            zoneStress = fruitMul * (2 - (ph.waterRet !== undefined ? ph.waterRet : 0.5));
          } else if (bk === 'mountains' || bk === 'arctic') {
            // Cold: the tender stall; the hardy keep fruiting. Arctic is harsher.
            const harsh = bk === 'arctic' ? 1.8 - 0.8 * (ph.coldTol !== undefined ? ph.coldTol : 0.5)
                                          : 1.6 - 0.6 * (ph.coldTol !== undefined ? ph.coldTol : 0.5);
            zoneStress = fruitMul * harsh;
          } else if (bk === 'shallows' || bk === 'archipelago' || bk === 'deep') {
            // Salt: the intolerant stall; salt-tolerators keep fruiting.
            zoneStress = fruitMul * (1.6 - 0.6 * (ph.saltTol !== undefined ? ph.saltTol : 0.5));
          } else {
            zoneStress = fruitMul;
          }
          // v0.25 "Heat": heat stress reads the GENERATED temperature, not
          // the biome key — a warming jungle stresses its plants before the
          // Whittaker lookup flips. heatTol is the adaptation: 1 → immune,
          // 0 → full stress. Desert natives (heatTolBias +0.6) barely feel
          // it; jungle transplants under a vent do.
          zoneStress *= heatStressMul(world, p.x, ph.heatTol);
          const densityMul = 1 + (world.creatures.length / 40) * 0.6;
          interval = interval * intervalGene * zoneStress * densityMul;
        }
        p.fruitTimer = interval;
        // v0.34: the bloom is spent making fruit — phenology resets for the
        // next cycle (bud → bloom). The donor genome recorded on deposition
        // during bloom stays on the plant: the next seed dispersal outcrosses
        // with it (disperseSeed). _fruitSetTotal is the exclosure probe's
        // instrument (cumulative fruit set by the fruiting block).
        p.flower = 'spent'; p.spentTimer = 3; p.bloomTimer = interval * 0.4;
        // Fruit hangs in the tree: it appears on the plant's own branch,
        // within reach of branch-dwellers. (The old world dropped it to
        // the ground; the canopy keeps its fruit where it grows.)
        // v0.8: herbs bear medicinal leaves instead of fruit.
        // v0.13: yield + fruitSize + bitterness from the plant genome; the
        // fruit remembers which plant bore it (seed dispersal).
        // v0.18: the drop kind follows the biome flora table (kelp, seed,
        // cactusfruit, berry, moss, propagule) — all eat at fruitEfficiency.
        const dropKind = p.kind === 'herb' ? 'leaf' : (p.fruitKind || 'fruit');
        const ph = p.pheno || {};
        // v0.22.2 — pollination sets fruit. Wind and gravity pollinate a
      // baseline (0.6×); a flower visited by pollinators sets up to 1.4×.
      // The flutter's whole niche is moving this number.
      const polMul = p.kind === 'herb' ? 1 : 0.6 + 0.8 * (p.pollination || 0);
      const fruits = p.kind === 'herb' ? 1 : Math.max(1, Math.round((1 + Math.round(2 * (ph.yield !== undefined ? ph.yield : 0.5))) * polMul));
        const nutrition = p.kind === 'herb'
          ? 0.3 * (0.5 + (ph.potency !== undefined ? ph.potency : 0.5))
          : 0.5 + (ph.fruitSize !== undefined ? ph.fruitSize : 0.5);
        // v0.24: fruiting draws soil minerals (donor-limited, fertility first);
        // the bulk of each fruit is water + carbon — sunlight's labeled
        // boundary input. Shortfall on exhausted ground is labeled, not
        // hidden: the book always balances.
        const fruitNeed = fruits * FRUIT_MINERAL;
        let fruitDraw = 0;
        const fs = world.soil && world.soil[p.regionId !== undefined ? p.regionId : p.zone];
        if (fs) {
          fruitDraw = Math.min(fruitNeed, (fs.fertility || 0) + (fs.waste || 0));
          let fd = fruitDraw;
          const fromFert = Math.min(fs.fertility || 0, fd);
          fs.fertility -= fromFert; fd -= fromFert;
          fs.waste = Math.max(0, (fs.waste || 0) - fd);
        }
        ledgerIn(world, 'sunlight', fruits * 1 - fruitDraw);
        // v0.34: the fruit carries its dad — the donor genome deposited
        // during this bloom (or null → selfing). Stamped per fruit set, so
        // a later bloom's visits can't rewrite this fruit's parentage.
        const dadGenome = p.pollenDonorGenome || null;
        for (let f = 0; f < fruits; f++) {
          addFood(world, p.x + rng.range(-30, 30), p.platformIndex, dropKind, 1, 0, {
            plantId: p.id, bitterness: ph.bitterness || 0, nutrition, dadGenome,
          });
        }
        p.pollenDonorGenome = null; // the bloom's pollen is spent with its fruit
        world._fruitSetTotal = (world._fruitSetTotal || 0) + fruits; // v0.34: exclosure probe instrument
        // v0.20 "Falling": windfall — the oldest uneaten fruit doesn't vanish,
        // it falls. Overripe fruit drops to the ground platform below and
        // becomes floor food (slightly less nutritious, and it rots within
        // minutes so the floor can't stockpile). The canopy keeps its fresh
        // fruit where it grows; what nobody wanted becomes the understory's
        // economy — a reason to descend, where the bears are.
        if (world.foods.length > 60) {
          const fallen = world.foods.splice(0, world.foods.length - 60);
          for (const f of fallen) dropWindfall(world, f, rng);
        }
      }
    }
  }

  // v0.22.2: pollinators visit flowers (pollen exchange + nectar sips).
  tickPollination(world, dt);

  // v0.14: the waste cycle — decomposition and leaching run on the soil,
  // once per tick, after the plants have eaten from it.
  // v0.14.1: leaf litter sheds before decomposition runs, so shed mass
  // composts the same tick it falls.
  // v0.22: the bacterial population ticks first — it sets the
  // decomposition rate tickSoil then uses.
  shedLitter(world, dt);
  tickMicrobes(world, dt);
  tickSoil(world, dt);

  // v0.35: hydrochory — drift seeds ride the water current field.
  tickDriftSeeds(world, dt);

  // v0.14.1: rot composts — see compostRot. (Only nest-cache fruit, scraps,
  // and carcass meat carry timers; plant fruit is eaten or it hangs.)
  compostRot(world);

  // v0.22.2: the retired critters' wander draws. Each of the 8 scripted
  // critters drew one rng.chance() per tick as it wandered; the per-tick
  // stream is load-bearing (the brain decides from this same stream, and
  // pinned behavioral trajectories depend on it), so burn the same 8 draws
  // here, where the wander loop ran, to keep the stream bit-identical.
  for (let i = 0; i < 8; i++) rng.chance(dt * 0.2);

  function stepLightBody(o, dt) {
    if (o.dragged) return;
    const prevY = o.y;
    o.vy = Math.min(MAX_FALL, (o.vy || 0) + GRAVITY * dt);
    o.y += o.vy * dt;
    if (o.vy > 0) {
      for (let i = 0; i < world.platforms.length; i++) {
        const p = world.platforms[i];
        if (o.x >= p.x1 && o.x <= p.x2 && prevY <= p.y && o.y >= p.y) {
          o.y = p.y; o.vy = 0; o.platformIndex = i;
          break;
        }
      }
    }
    if (o.y > world.height - 10) { o.y = world.height - 10; o.vy = 0; }
  }

  // v0.18 §13.3: mobile food — one system, two media. Bugs random-walk
  // their platform; minnows random-walk their water (constrained: a minnow
  // that would leave the water stays put). Edible via the existing eat
  // verb. (v0.31: the brainless morsel path is retired per design §5.)
  // v0.17.2: other loose food obeys gravity — lifted into the sky and
  // released, it falls (stepLightBody hangs it still while dragged).
  for (const f of world.foods) {
    if (f.foodKind === 'bug') {
      if (!Number.isFinite(f.vx)) f.vx = 0;
      const plat = world.platforms[f.platformIndex];
      if (!plat) continue;
      if (rng.chance(dt * 1.5)) f.vx = rng.range(-25, 25);
      f.x += f.vx * dt;
      if (f.x < plat.x1 + 8) { f.x = plat.x1 + 8; f.vx = Math.abs(f.vx); }
      if (f.x > plat.x2 - 8) { f.x = plat.x2 - 8; f.vx = -Math.abs(f.vx); }
      f.y = plat.y;
    } else if (f.foodKind === 'minnow') {
      if (!Number.isFinite(f.vx)) f.vx = 0;
      if (!Number.isFinite(f.vy)) f.vy = 0;
      if (rng.chance(dt * 2)) { f.vx = rng.range(-40, 40); f.vy = rng.range(-25, 25); }
      const nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
      if (waterAt(nx, ny, world.layout)) { f.x = nx; f.y = ny; }
      else { f.vx = -f.vx * 0.5; f.vy = -f.vy * 0.5; } // the water is the constraint
    } else {
      stepLightBody(f, dt);
    }
  }

  // Toys: friction.
  for (const t of world.toys) {
    if (t.dragged) continue;
    stepLightBody(t, dt);
    const plat = world.platforms[t.platformIndex];
    t.x += t.vx * dt;
    t.vx *= 1 - Math.min(1, 2.5 * dt);
    if (Math.abs(t.vx) < 2) t.vx = 0;
    if (t.x < plat.x1 + t.r) { t.x = plat.x1 + t.r; t.vx = Math.abs(t.vx) * 0.5; }
    if (t.x > plat.x2 - t.r) { t.x = plat.x2 - t.r; t.vx = -Math.abs(t.vx) * 0.5; }
  }

  // v0.9: pebbles — friction, bounds, and one-way coupling with creatures.
  // Creatures shove pebbles (impulse + overlap separation, scaled by the
  // creature's size — babies kick weakly); pebbles NEVER push creatures
  // back. Two-way collision pinches a pebble between two approaching
  // creatures into a permanent 55px spacer, sterilizing the world — in a
  // 1D world there is no "around". Stones are kickable clutter, not walls.
  for (const p of world.pebbles) {
    if (p.dragged) continue;
    stepLightBody(p, dt);
    const plat = world.platforms[p.platformIndex];
    p.x += p.vx * dt;
    p.vx *= 1 - Math.min(1, 3 * dt);
    if (Math.abs(p.vx) < 2) p.vx = 0;
    if (p.x < plat.x1 + p.r) { p.x = plat.x1 + p.r; p.vx = Math.abs(p.vx) * 0.4; }
    if (p.x > plat.x2 - p.r) { p.x = plat.x2 - p.r; p.vx = -Math.abs(p.vx) * 0.4; }
  }
  // v0.20 "Hands": sticks — same light-body physics as pebbles (friction,
  // bounds, one-way creature coupling via the shared kick loop below), plus
  // rot: an unused stick becomes litter after STICK_ROT_S. Carried sticks
  // leave the array (they're in a hand, not on the ground); dropped ones
  // come back with a fresh born stamp.
  for (const s of world.sticks) {
    if (s.dragged) continue;
    stepLightBody(s, dt);
    const plat = world.platforms[s.platformIndex];
    s.x += s.vx * dt;
    s.vx *= 1 - Math.min(1, 3 * dt);
    if (Math.abs(s.vx) < 2) s.vx = 0;
    if (s.x < plat.x1 + s.r) { s.x = plat.x1 + s.r; s.vx = Math.abs(s.vx) * 0.4; }
    if (s.x > plat.x2 - s.r) { s.x = plat.x2 - s.r; s.vx = -Math.abs(s.vx) * 0.4; }
  }
  const before = world.sticks.length;
  if (before > 0) {
    const rotted = [];
    world.sticks = world.sticks.filter((s) => {
      if (world.time - s.born < STICK_ROT_S) return true;
      rotted.push(s);
      return false;
    });
    // Rotten sticks become litter — their full weight goes to the zone's
    // soil waste, the decay chain's honest end (v0.24: no cap — the 1-cap
    // was silently deleting mass; wasteOdorOf clamps internally for smell).
    // Nothing accumulates forever.
    if (world.soil && rotted.length > 0) {
      for (const s of rotted) {
        const soil = soilAt(world, s.x);
        if (soil) soil.waste = (soil.waste || 0) + (s.weight ?? 0.7);
      }
    }
  }
  for (const c of world.creatures) {
    if (!c.alive) continue;
    const cr = creatureRadius(c);
    const kick = 90 * (cr / 16); // bigger bodies kick harder
    for (const p of world.pebbles) {
      if (p.platformIndex !== c.platformIndex) continue;
      const dx = p.x - c.x;
      const overlap = cr + p.r - Math.abs(dx);
      if (overlap > 0) {
        const dir = dx === 0 ? c.facing : Math.sign(dx);
        // Heavier stones (bigger r) take less velocity.
        const heaviness = p.r / 17;
        p.vx += dir * kick * dt / heaviness;
        p.x += dir * overlap;
      }
    }
    // v0.20 "Hands": sticks kick like pebbles — same one-way coupling.
    for (const s of world.sticks) {
      if (s.platformIndex !== c.platformIndex) continue;
      const dx = s.x - c.x;
      const overlap = cr + s.r - Math.abs(dx);
      if (overlap > 0) {
        const dir = dx === 0 ? c.facing : Math.sign(dx);
        s.vx += dir * kick * dt / (s.r / 17);
        s.x += dir * overlap;
      }
    }
  }

  // Eggs hatch (and fall, if lifted into the sky and released).
  for (const egg of [...world.eggs]) {
    stepLightBody(egg, dt);
    egg.timer -= dt;
    egg.wobble = Math.max(0, egg.wobble - dt);
    if (egg.timer < 3) egg.wobble = 0.3; // wobbling before hatch
    if (egg.timer <= 0) hatchEgg(world, egg);
  }

  // Creatures.
  rebuildSpatialIndex(world);
  // v0.14: calls older than 2 sim-seconds fade from the acoustic commons.
  if (world.calls.length) {
    const cutoff = world.time - 2;
    let w = 0;
    for (let i = 0; i < world.calls.length; i++) {
      if (world.calls[i].t >= cutoff) world.calls[w++] = world.calls[i];
    }
    world.calls.length = w;
  }
  for (const c of world.creatures) {
    updateCreature(c, world, dt);
  }
  // v0.18 §13.6: predators (bears, sharks — the roster is the ecology
  // design's; the two decided entries are arctic bears and deep sharks).
  // No-op on worlds without predators (legacy populate() stays predator-free).
  tickPredators(world, dt);
  // v0.14 "Voices": the Teacher — Sunny's visitor avatar. Ticks after the
  // creatures; its calls land in the 2s acoustic registry and are heard on
  // the next tick. A visitor, never interleaved with creature update order.
  if (world.teacher) tickTeacher(world, world.teacher, dt);
  // v0.12: bond dynamics run on the fresh positions — familiarity,
  // play-together, decay, and pruning of the dead.
  tickBonds(world, dt);
  // v0.37 "Affect": pair-bond dynamics (vasopressin map) and tracked
  // emergence — kind transitions per dyad, chronicle events on change.
  tickPairBonds(world, dt);
  tickKindHistory(world);
  // v0.12: tribe detection every 60 sim-seconds — bands are detected,
  // never assigned.
  if (Math.floor(world.time / 60) !== Math.floor((world.time - dt) / 60)) {
    world.tribes = detectTribes(world);
  }
  // v0.16 "Tongues": the troop lexicon census every 30 sim-seconds —
  // cluster each tribe's entries into shared words (culture lives at the
  // troop level, delta c). Also feeds the forget rule and the notebook.
  if (Math.floor(world.time / 30) !== Math.floor((world.time - dt) / 30)) {
    world.troopWords = censusTroopWords(world);
  }
  // v0.16: death is salient — witnesses within 400px on the same branch
  // get 'alarm' pushed into their context window (delta a, hearer half:
  // the most salient observable context, weighted by recency).
  for (const ev of world.events) {
    if (ev.type !== 'death' || !ev.creature) continue;
    if (world.time - ev.t > dt + 0.001) continue; // only this tick's deaths
    const dc = ev.creature;
    for (const c of world.creatures) {
      if (!c.alive || c === dc || c.platformIndex !== dc.platformIndex) continue;
      if (Math.abs(c.x - dc.x) < 400) pushContextWindow(c, 'alarm', 1.0, world.time);
    }
    // v0.16: the teacher names the danger — the Rosetta stone's DANGER.
    // A sharp high motif, exact pitch, where the students can hear it.
    const te = world.teacher;
    if (te && te.platformIndex === dc.platformIndex &&
        Math.abs(te.x - dc.x) < 500 &&
        !te.demoQueue.length && world.time - (te.lastDemoT || 0) > 20) {
      teacherDemo(world, te, [0.85, 0.92, 0.85], 'danger');
    }
  }
  // v0.13: divergence snapshot every 6 sim-minutes — Eliza's S per biome.
  // v0.14: species clustering rides the same snapshot.
  if (Math.floor(world.time / 360) !== Math.floor((world.time - dt) / 360)) {
    computeDivergence(world);
    computeSpecies(world);
  }
  // Remove the dead (UI reads events first).
  // v0.18 §13.4: noteDeath already left a corpse at the death position —
  // the splice only removes the body. (The v0.7 'meat' carcass spawn lived
  // here; it moved to noteDeath as foodKind 'corpse' so every death,
  // however it happens, leaves exactly one corpse.)
  const dead = [];
  for (let i = world.creatures.length - 1; i >= 0; i--) {
    if (!world.creatures[i].alive) dead.push(...world.creatures.splice(i, 1));
  }
  void dead;
  // v0.7: traditions whose last carrier died go extinct here — the library
  // test, running continuously.
  const extinct = pruneExtinct(world.culture, world.creatures);
  for (const t of extinct) {
    world.events.push({ type: 'traditionLost', name: t.name, t: world.time });
  }
  // Ratchet census every 5 sim-minutes.
  if (Math.floor(world.time / 300) !== Math.floor((world.time - dt) / 300)) {
    sampleCulture(world);
  }

  if (world.events.length > 60) world.events.splice(0, world.events.length - 60);
}

// Per-tick spatial index: platformIndex -> creatures sorted by x.
// Turns the O(n^2) all-pairs neighbor sense scan into O(n log n).
// Positions are at most one tick stale (creatures move after sensing).
function rebuildSpatialIndex(world) {
  const idx = new Map();
  for (const c of world.creatures) {
    if (!c.alive) continue;
    let arr = idx.get(c.platformIndex);
    if (!arr) { arr = []; idx.set(c.platformIndex, arr); }
    arr.push(c);
  }
  for (const arr of idx.values()) arr.sort((a, b) => a.x - b.x);
  world._spatial = idx;
}

// Bind tryMate so creature code can call world.tryMate(a, b).
export function bindWorld(world) {
  world.tryMate = tryMate.bind(world);
  world.digAt = (x, y, radius) => digAt(world, x, y, radius); // v0.18 §13.2: the dig verb
  return world;
}

// Creature names must be unique within a world (the pool is small).
export function uniqueName(world, name) {
  const used = new Set(world.creatures.map((c) => c.name));
  if (!used.has(name)) return name;
  let i = 2;
  while (used.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

export function populate(world) {
  const rng = world.rng;
  // v2: founder-canopy-relative. The v1 ordinals (0=ground, 1-8=branches)
  // map onto the founder canopy's ground/branch platforms; x maps into the
  // founder region bounds.
  const layout = world.layout;
  let jz, mx, JP;
  if (!layout.canonical && layout.founder) {
    const f = layout.founder;
    const fr = layout.regions[f.regionId];
    jz = { x0: fr.x0, x1: fr.x1 };
    mx = (x) => fr.x0 + (x / 1600) * (fr.x1 - fr.x0);
    const plats = [f.groundPis[0], ...f.branchPis];
    JP = (ord) => plats[ord % plats.length];
  } else {
    // v0.18 "Realms": the legacy jungle-only battery spawner. The founder 9
    // platforms are indices 0–8 (the scaled jungle), so platform indices are
    // unchanged; x-coordinates are mapped into the jungle region,
    // x' = 1200 + x×(600/1600). The rng draw ORDER is identical to v0.17.1
    // (same calls, same counts — bounds don't consume draws), so founder
    // genomes are bit-identical; only positions moved. Four founders, plain
    // founder stock, no shifts.
    // v0.26: positions are jungle-zone-relative (cluster 0); platform
    // indices are jungle ordinals — identical values at size 1.
    jz = layout.zones[2];
    mx = (x) => jz.x0 + x * 0.375;
    JP = (ord) => layout.platformsByZone.jungle[ord].pi;
  }
  // The canopy's ecology: fruit trees grow ON the branches (plants are
  // indexed by platform — a tree on branch 4 fruits on branch 4); medicinal
  // herbs are undergrowth on the forest floor.
  // v0.11 biomes: verdant valley is lush, the arid stretch is harsh (one
  // fruit tree, but extra medicinal herbs), the highland is moderate.
  addPlant(world, mx(200), JP(1)); addPlant(world, mx(420), JP(1)); // lower-left branch trees
  addPlant(world, mx(700), JP(2)); // lower-mid
  addPlant(world, mx(1150), JP(3)); addPlant(world, mx(1400), JP(3)); // lower-right
  addPlant(world, mx(450), JP(4)); addPlant(world, mx(900), JP(5)); // mid branches
  addPlant(world, mx(1250), JP(6));
  addPlant(world, mx(600), JP(7)); addPlant(world, mx(1050), JP(8)); // upper branches
  // v0.8: medicinal herbs, on the forest floor where the sick descend.
  // v0.11: they thrive where food is scarcest.
  addHerb(world, mx(650), JP(0)); addHerb(world, mx(950), JP(0)); addHerb(world, mx(1300), JP(0));
  // Starter food: hang fruit in the branches so the first tanglekins don't
  // starve immediately.
  const branchIdx = [JP(1), JP(2), JP(3), JP(4), JP(5), JP(6)];
  for (let i = 0; i < 8; i++) {
    const pi = branchIdx[i % branchIdx.length];
    const plat = world.platforms[pi];
    addFood(world, rng.range(plat.x1 + 40, plat.x2 - 40), pi, 'fruit', 1);
  }
  // v0.22.2: the scripted critters are retired — no bugs, no butterflies.
  // (Their lineages live on as the flutter and grub founder creatures,
  // spawned in populateGenesis on the one engine.)
  // The rng stream is load-bearing for worldgen determinism: the old
  // addCritter spawns consumed 5 draws each (x, platform, direction, speed,
  // phase) × 8 critters. Burn the same 40 draws so every downstream roll —
  // founders included — stays bit-identical.
  for (let i = 0; i < 5; i++) {
    rng.range(mx(100), mx(1500)); rng.int(0, 5);
    rng.pick([-1, 1]); rng.range(15, 40); rng.range(0, 100);
  }
  for (let i = 0; i < 3; i++) {
    rng.range(mx(200), mx(1400)); rng.int(0, 2);
    rng.pick([-1, 1]); rng.range(15, 40); rng.range(0, 100);
  }
  addToy(world, mx(800), JP(0));
  // v0.9: pebbles scattered on the forest floor — the world as material.
  for (let i = 0; i < 8; i++) addPebble(world, rng.range(mx(80), mx(1520)), JP(0));
  // v0.17.1 "Touch": mineral deposits. Fixed positions (no rng — worldgen
  // order is load-bearing for determinism, and these must never shift the
  // main stream's sequence). Observer-only until the technology release.
  addMineral(world, mx(300), JP(0), 'flint');   // jungle floor, west side
  addMineral(world, mx(800), JP(0), 'clay');    // jungle floor, middle
  addMineral(world, mx(1300), JP(0), 'flint');  // jungle floor, east side
  addMineral(world, mx(600), JP(7), 'quartz');  // upper branch — the climb is the price
  // v0.20 "Hands": fallen branches on the jungle floor — graspable timber.
  // Fixed positions (determinism, like minerals). They rot if unused.
  addStick(world, mx(450), JP(0));
  addStick(world, mx(950), JP(0));
  addStick(world, mx(1150), JP(0));
  // Four founder tanglekins with fresh random genomes, born in the lower
  // branches. (v0.5: was two. Two founders made every lineage a coin flip —
  // four founders (two breeding pairs) give the population the demographic
  // buffer it needs to survive drift.)
  const founders = [];
  const names = ['Pip', 'Moss'];
  // Founders start on adjacent lower branches where the climb links are —
  // 180px spacing keeps adjacent founders inside the 240px breeding-backstop
  // range but outside the 150px contagion range.
  const starts = [[mx(400), JP(1)], [mx(580), JP(1)], [mx(760), JP(2)], [mx(940), JP(2)]];
  for (let i = 0; i < 4; i++) {
    const [fx, fpi] = starts[i];
    const c = createCreature(randomGenome(rng, { overrides: { speciesTag: SPECIES_TAG_CHOICES.indexOf('tanglekin') } }), fx, fpi, rng,
      i < 2 ? { name: names[i] } : {});
    c.name = uniqueName(world, c.name);
    // Start them as young adults, not juveniles. The breeding window is
    // 25%–80% of lifespan, and juvenile founders kept dying (starvation,
    // illness, short lifespans) before they could ever mate — the seed-11 /
    // seed-99 extinction pattern: "aren't breeding and keep dying out".
    // 0.4 clears even the slowest maturation (matTime stretches childhood
    // to 37.5% of lifespan), so every founder is breedable from the first
    // minute the player watches.
    c.biochem.age = c.pheno.lifespanSec * 0.4;
    recordLineage(world, c);
    founders.push(c);
  }
  // Guarantee two males and two females so every new world is breedable.
  // (Shuffled, so Pip and Moss aren't always the same sexes.)
  const sexes = ['male', 'male', 'female', 'female'];
  for (let i = sexes.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [sexes[i], sexes[j]] = [sexes[j], sexes[i]];
  }
  founders.forEach((c, i) => { c.sex = sexes[i]; });
  world.creatures.push(...founders);
  // Every founder gets a fruit within sight of its start — the starter
  // fruit above is randomly placed and can land out of a newborn's range,
  // starving juveniles before they learn to forage.
  for (const c of founders) {
    const plat = world.platforms[c.platformIndex];
    const fx = Math.max(plat.x1 + 20, Math.min(plat.x2 - 20, c.x + rng.range(-60, 60)));
    addFood(world, fx, c.platformIndex, 'fruit', 1);
  }
  // v0.13: founders are the genomic baseline — register their hashes so the
  // beautiful-mutant watch only fires on genuinely new combinations. Record
  // founder trait means for the divergence metric (Eliza's S).
  for (const c of founders) world.seenGenomes.add(genomeHash(c.genome));
  recordFounderMeans(world);
  ledgerSeal(world); // v0.24: the world is stocked — seal the mass baseline
  return world;
}

// ==================== v0.18 "Realms" ====================

// Best platform index for a position: the platform covering x whose y is
// closest to y. Returns -1 when no platform covers x (open water / air).
export function platformIndexAt(world, x, y = Infinity) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < world.platforms.length; i++) {
    const p = world.platforms[i];
    if (x < p.x1 || x > p.x2) continue;
    const d = y === Infinity ? 0 : Math.abs(p.y - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---- v0.18 §13.1/13.2: buried food + dig ----

function buryFood(world, biome, kind, amount, x0, x1, y, n) {
  const dr = world.decorRng || world.rng;
  for (let i = 0; i < n; i++) {
    world.buried.push({ x: dr.range(x0, x1), y, kind, amount, biome });
  }
}

export function spawnBuriedFood(world) {
  const L = world.layout;
  // v2: region-based — buried food by region label.
  if (!L.canonical && L.regions) {
    const gy = (x) => { const g = groundYAt(x, L); return g === null ? 800 : g; };
    for (const r of L.regions) {
      const x0 = r.x0 + 50, x1 = r.x1 - 50;
      if (x1 <= x0) continue;
      const midY = gy((x0 + x1) / 2);
      if (r.label === 'plains') buryFood(world, r.id, 'tuber', 1.6, x0, x1, midY, 8);
      else if (r.label === 'desert') buryFood(world, r.id, 'tuber', 1.8, x0, x1, midY, 6);
      else if (r.label === 'jungle') buryFood(world, r.id, 'grub', 1.2, x0, x1, midY, 6);
      else if (r.label === 'arctic') buryFood(world, r.id, 'snowcache', 1.4, x0, x1, midY, 4);
      // v0.31: morsels retired (design §5) — shallows bury nothing; the
      // water column's food is the minnow schools (spawnMobileFood).
      else if (r.label === 'archipelago') {
        const plats = L.platforms.filter((p) => p.regionId === r.id && p.kind === 'ground');
        if (plats.length) {
          const p = plats[0];
          buryFood(world, r.id, 'sandcache', 1.3, p.x1 + 10, p.x2 - 10, p.y, 4);
        }
      }
    }
    return;
  }
  // v1: the painted zones (verbatim).
  // v0.26: bounds from the generated zones (50px insets, verbatim at
  // size 1); y from the generated terrain. Draw counts unchanged.
  const zb = (key, inset = 50) => { const z = L.zones[ZONE_KEYS.indexOf(key)]; return [z.x0 + inset, z.x1 - inset]; };
  const gy = (x) => { const g = groundYAt(x, L); return g === null ? 800 : g; };
  const [plx0, plx1] = zb('plains');
  buryFood(world, 'plains', 'tuber', 1.6, plx0, plx1, gy((plx0 + plx1) / 2), 8); // tubers/roots
  const [dex0, dex1] = zb('desert');
  buryFood(world, 'desert', 'tuber', 1.8, dex0, dex1, gy((dex0 + dex1) / 2), 6); // deep tubers
  const [jux0, jux1] = zb('jungle');
  buryFood(world, 'jungle', 'grub', 1.2, jux0, jux1, gy((jux0 + jux1) / 2), 6); // grubs under leaf litter
  const [arx0, arx1] = zb('arctic');
  buryFood(world, 'arctic', 'snowcache', 1.4, arx0, arx1, gy((arx0 + arx1) / 2), 4); // snow caches
  // v0.31: morsels retired (design §5) — shallows bury nothing in v1 either.
  const ia = L.platformsByZone.archipelago[0]; // island A ground — the sand flat
  buryFood(world, 'archipelago', 'sandcache', 1.3, ia.x1 + 10, ia.x2 - 10, ia.y, 4);
}

// digAt(world, x, y, radius): unearth buried food in a radius — the dig
// verb's world side. Removes the buried entries, drops them as food
// entities, returns the count unearthed. Buried food is the richest
// per-bite in its biome: the effort must be worth learning.
export function digAt(world, x, y, radius = 60) {
  let n = 0;
  for (let i = world.buried.length - 1; i >= 0; i--) {
    const b = world.buried[i];
    const dx = b.x - x, dy = b.y - y;
    if (dx * dx + dy * dy <= radius * radius) {
      world.buried.splice(i, 1);
      addFood(world, b.x, platformIndexAt(world, b.x, b.y), b.kind, b.amount, 120, { nutrition: b.amount });
      n++;
    }
  }
  return n;
}

// ---- v0.18 §13.3: mobile food ----

function addMobileFood(world, foodKind, x, platformIndex, y) {
  addFood(world, x, platformIndex, foodKind, foodKind === 'minnow' ? 0.6 : 0.4, 0, { nutrition: 0.5 });
  const f = world.foods[world.foods.length - 1];
  const dr = world.decorRng || world.rng;
  f.vx = dr.range(-25, 25);
  f.vy = foodKind === 'minnow' ? dr.range(-15, 15) : 0;
  if (y !== undefined) f.y = y;
  return f;
}

export function spawnMobileFood(world) {
  const dr = world.decorRng || world.rng;
  const L = world.layout;
  // v2: region-based — bugs over land regions, minnows in water regions.
  if (!L.canonical && L.regions) {
    const bug = (x0, x1, pi, n) => {
      for (let i = 0; i < n; i++) addMobileFood(world, 'bug', dr.range(x0, x1), pi);
    };
    const minnow = (x0, x1, y0, y1, n) => {
      for (let i = 0; i < n; i++) addMobileFood(world, 'minnow', dr.range(x0, x1), -1, dr.range(y0, y1));
    };
    for (const r of L.regions) {
      const w = r.x1 - r.x0;
      const n = Math.max(1, Math.round(w / 600));
      if (r.label === 'jungle' || r.label === 'plains' || r.label === 'desert') {
        const plats = L.platforms.filter((p) => p.regionId === r.id && p.kind === 'ground');
        if (plats.length) {
          const p = plats[0];
          bug(p.x1 + 20, p.x2 - 20, p.pi, n * 2);
        }
      } else if (r.label === 'mountains' || r.label === 'arctic') {
        const plats = L.platforms.filter((p) => p.regionId === r.id && p.kind === 'shelf');
        for (const p of plats.slice(0, 3)) bug(p.x1 + 20, p.x2 - 20, p.pi, 1);
      } else if (r.label === 'shallows' || r.label === 'archipelago' || r.label === 'deep') {
        const wtr = waterAt((r.x0 + r.x1) / 2, 2000, L);
        if (wtr) minnow(r.x0 + 50, r.x1 - 50, wtr.surfaceY + 40, wtr.surfaceY + 120, n);
      }
    }
    return;
  }
  // v1: the painted template (verbatim).
  // v0.26: bounds from the generated layout — platform x-ranges, zone
  // insets, and the generated water surfaces. Draw counts unchanged.
  const P = (key, ord) => L.platformsByZone[key][ord];
  const Z = (key) => L.zones[ZONE_KEYS.indexOf(key)];
  const bug = (x0, x1, pi, n) => {
    for (let i = 0; i < n; i++) addMobileFood(world, 'bug', dr.range(x0, x1), pi);
  };
  const jz = Z('jungle');
  const J = (a, b) => [jz.x0 + a, jz.x0 + b]; // jungle-zone-relative, cluster 0
  bug(...J(50, 540), P('jungle', 1).pi, 3); bug(...J(190, 360), P('jungle', 2).pi, 3); bug(...J(360, 570), P('jungle', 3).pi, 2);
  const plz = Z('plains');
  bug(plz.x0 + 50, plz.x1 - 50, P('plains', 0).pi, 6);   // plains grasshoppers
  const dz = Z('desert');
  bug(dz.x0 + 50, dz.x1 - 50, P('desert', 0).pi, 4);     // desert nocturnal insects
  for (const ord of [2, 4, 6]) {                          // mountains cliff insects
    const mp = P('mountains', ord);
    bug(mp.x1 + 20, mp.x2 - 20, mp.pi, 1);
  }
  const minnow = (x0, x1, y0, y1, n) => {
    for (let i = 0; i < n; i++) addMobileFood(world, 'minnow', dr.range(x0, x1), -1, dr.range(y0, y1));
  };
  // Minnow bands hang below the generated surface, off the bottom.
  const mzone = (key, x0, x1) => {
    const w = waterAt((x0 + x1) / 2, 2000, L);
    const sy = w ? w.surfaceY : 800;
    const depth = w && w.depth ? w.depth : 100;
    return [x0, x1, sy + 15, sy + Math.max(30, depth - 20)];
  };
  const shz = Z('shallows');
  minnow(...mzone('shallows', shz.x0 + 50, shz.x1 - 50), 8);            // shallows
  const iaA = P('archipelago', 0), iaB = P('archipelago', 2), iaC = P('archipelago', 4);
  minnow(...mzone('archipelago', iaA.x1 + 50, iaB.x2 - 60), 3);         // island group A
  minnow(...mzone('archipelago', iaC.x1 + 10, iaC.x2 - 10), 3);         // island B
  const dpz = Z('deep');
  minnow(...mzone('deep', dpz.x0 + 50, dpz.x1 - 50), 6);                // deep — the only meat
}

// ---- v0.18 §12.2: per-biome resource sets ----

export function spawnResources(world) {
  // v2: region-based — resources on region platforms by label.
  const L = world.layout;
  if (!L.canonical && L.regions) {
    const addOn = (label, kinds, mineral, n = 1) => {
      for (const r of L.regions) {
        if (r.label !== label) continue;
        const plats = L.platforms.filter((p) => p.regionId === r.id && kinds.includes(p.kind));
        for (let i = 0; i < Math.min(n, plats.length); i++) {
          const p = plats[i];
          addMineral(world, (p.x1 + p.x2) / 2, p.pi, mineral);
        }
      }
    };
    addOn('archipelago', ['ground'], 'timber', 3);
    addOn('shallows', ['ground', 'branch'], 'timber', 1);
    addOn('deep', ['floe'], 'timber', 1);
    addOn('mountains', ['ground', 'shelf'], 'stone', 2);
    addOn('arctic', ['ground'], 'stone', 1);
    addOn('archipelago', ['ground'], 'driftwood', 1);
    addOn('deep', ['floe'], 'driftwood', 1);
    addOn('desert', ['ground'], 'clay', 1);
    return;
  }
  // v1: the painted template (verbatim).
  // Fixed positions, no rng draws (the decorRng precedent: worldgen order
  // is load-bearing, and resources must never shift the main stream).
  // Observer-only until the technology release — the materials are there,
  // the using is theirs to invent.
  // v0.26: platform centers from the generated layout (ordinals, not indices).
  const P = (key, ord) => world.layout.platformsByZone[key][ord];
  const pcx = (key, ord) => { const p = P(key, ord); return [(p.x1 + p.x2) / 2, p.pi]; };
  let x, pi;
  [x, pi] = pcx('archipelago', 0); addMineral(world, x, pi, 'timber'); // island 1 — the shipwright's biome
  [x, pi] = pcx('archipelago', 2); addMineral(world, x, pi, 'timber'); // island 2
  [x, pi] = pcx('archipelago', 4); addMineral(world, x, pi, 'timber'); // island 3
  [x, pi] = pcx('shallows', 1); addMineral(world, x, pi, 'timber');    // mangrove stand — abundant timber
  [x, pi] = pcx('deep', 0); addMineral(world, x, pi, 'timber');       // deep floe timber
  [x, pi] = pcx('mountains', 2); addMineral(world, x, pi, 'stone');   // shaft base — sparse timber, stone instead
  [x, pi] = pcx('mountains', 6); addMineral(world, x, pi, 'stone');   // mid shaft
  [x, pi] = pcx('arctic', 0); addMineral(world, x, pi, 'stone');      // arctic shelter stone
  [x, pi] = pcx('archipelago', 4); addMineral(world, x + 30, pi, 'driftwood'); // archipelago drift line
  [x, pi] = pcx('deep', 1); addMineral(world, x + 75, pi, 'driftwood');        // deep drift current
  [x, pi] = pcx('desert', 0); addMineral(world, x, pi, 'clay');       // desert sun-baked clay
}

// ---- v0.18 §5: per-biome flora ----

function biasPlantGenomeFor(genome, flora) {
  const pairs = [
    ['heatTol', flora.heatTolBias],
    ['coldTol', flora.coldTolBias],
    ['saltTol', flora.saltTolBias],
  ];
  for (const [locus, bias] of pairs) {
    const al = genome.alleles[locus];
    if (!al || !bias) continue;
    for (let i = 0; i < 2; i++) al[i] = Math.max(0, Math.min(1, al[i] + bias));
  }
}

// v0.25 "Heat": plant heat-stress multiplier from the GENERATED temperature
// field. Below T=0.65 no stress; at T=1.0 a heatTol-0 plant fruits 2.5×
// slower, a heatTol-1 plant is untouched. Exported for the test pin.
export function heatStressMul(world, x, heatTol) {
  if (!world.climate) return 1;
  const t = tempAt(world, x);
  const heat01 = t <= 0.65 ? 0 : Math.min(1, (t - 0.65) / 0.35);
  if (heat01 <= 0) return 1;
  const tol = heatTol === undefined ? 0.5 : Math.max(0, Math.min(1, heatTol));
  return 1 + heat01 * (1 - tol) * 1.5;
}

export function plantBiomeFlora(world, x, platformIndex, biomeKey, herb = false) {
  const flora = floraFor(biomeKey);
  const g = randomPlantGenome(world.decorRng || world.rng);
  biasPlantGenomeFor(g, flora);
  const opts = herb ? { morph: 'herb' } : { morph: flora.morph, fruitKind: flora.fruitKind };
  if (herb) addHerb(world, x, platformIndex, g, opts);
  else addPlant(world, x, platformIndex, g, opts);
}

export function spawnBiomeFlora(world) {
  const layout = world.layout;
  // v2: region-based — each region gets label-appropriate flora on its
  // platforms, counts scaled by region width.
  if (!layout.canonical && layout.regions) {
    const dr = world.decorRng || world.rng;
    for (const r of layout.regions) {
      const plats = layout.platforms.filter((p) => p.regionId === r.id);
      const w = r.x1 - r.x0;
      const n = Math.max(1, Math.round(w / 400)); // density per 400px
      const plantOn = (kinds, count, herb = false) => {
        const cands = plats.filter((p) => kinds.includes(p.kind));
        for (let i = 0; i < count && cands.length; i++) {
          const p = cands[i % cands.length];
          plantBiomeFlora(world, dr.range(p.x1 + 10, p.x2 - 10), p.pi, r.label, herb);
        }
      };
      if (r.label === 'jungle') {
        plantOn(['branch'], n * 2); plantOn(['ground'], Math.max(1, n >> 1), true);
      } else if (r.label === 'arctic') {
        plantOn(['ground', 'shelf'], n);
      } else if (r.label === 'mountains') {
        plantOn(['ground', 'shelf'], n); plantOn(['ground'], 1, true);
      } else if (r.label === 'plains') {
        plantOn(['ground'], n * 3);
      } else if (r.label === 'desert') {
        plantOn(['ground'], Math.max(1, n >> 1)); plantOn(['ground'], 1, true);
      } else if (r.label === 'shallows') {
        plantOn(['branch', 'ground'], n);
      } else if (r.label === 'archipelago') {
        plantOn(['ground', 'branch'], n); plantOn(['ground'], 1, true);
      } else if (r.label === 'deep') {
        for (let i = 0; i < n; i++) plantBiomeFlora(world, dr.range(r.x0 + 50, r.x1 - 50), -1, 'deep');
      }
    }
    return;
  }
  // v1: the painted template ordinals (verbatim).
  // v0.26: trees plant on platform x-ranges from the generated layout
  // (ordinals, not indices); the kelp band from the generated deep zone.
  // Draw counts and per-platform counts unchanged.
  const dr = world.decorRng || world.rng;
  const P = (key, ord) => world.layout.platformsByZone[key][ord];
  const tree = (key, ord, n, herb = false) => {
    const p = P(key, ord);
    for (let i = 0; i < n; i++) plantBiomeFlora(world, dr.range(p.x1 + 10, p.x2 - 10), p.pi, key, herb);
  };
  // Emerald Jungle: dense fruit trees on the branches + floor herbs (the ancestral economy)
  tree('jungle', 1, 2); tree('jungle', 2, 2); tree('jungle', 3, 2);
  tree('jungle', 4, 2); tree('jungle', 5, 1); tree('jungle', 6, 1);
  tree('jungle', 7, 1); tree('jungle', 8, 1);
  tree('jungle', 0, 3, true); // medicinal herbs on the floor
  // Arctic Wastes: sparse ice-moss
  tree('arctic', 0, 6);
  // Skyreach Mountains: alpine shrubs — coldTol selects; the prize altitude taxes
  tree('mountains', 2, 1); tree('mountains', 4, 1);
  tree('mountains', 6, 1); tree('mountains', 8, 1);
  tree('mountains', 0, 2, true); // foothill herbs
  // Whispering Plains: grasses — ALL food on the ground, no branches
  tree('plains', 0, 12);
  // Sunscorch Desert: sparse cacti + one oasis herb
  tree('desert', 0, 5);
  tree('desert', 0, 1, true);
  // Mangrove Shallows: mangroves over water
  tree('shallows', 1, 1); tree('shallows', 2, 1);
  tree('shallows', 3, 1); tree('shallows', 4, 1);
  tree('shallows', 5, 2);
  // The Archipelago: palms on the islands + island herbs
  tree('archipelago', 0, 2); tree('archipelago', 2, 2);
  tree('archipelago', 4, 1);
  tree('archipelago', 1, 1); tree('archipelago', 3, 1);
  tree('archipelago', 0, 1, true); tree('archipelago', 2, 1, true);
  // Azure Deep: floating kelp — platformIndex -1, the floating convention
  const dpz = world.layout.zones[ZONE_KEYS.indexOf('deep')];
  for (let i = 0; i < 7; i++) plantBiomeFlora(world, dr.range(dpz.x0 + 50, dpz.x1 - 50), -1, 'deep');
}

// ---- v0.18 §12/§12.1/§13.7: genesis spawns ----

// §13.7: sub-stream pinning. RETIRED as the live path — genome.js now takes
// {pinSub} natively (the v0.17 confound fix), and populateGenesis uses it.
// Kept exported for its unit test and as documentation of the draw order:
// language loci from one stream, evo-devo from another, same GENES order
// per stream as genome.js passes 2–3.
export function pinSubStreams(genome, pin) {
  const p = pin | 0;
  const lexRng = createRng((p ^ 0x1e154d) >>> 0);
  const evoRng = createRng((p ^ 0x3a11ce) >>> 0);
  for (const gene of GENES) {
    const isLex = gene.key.startsWith('lex');
    const isEvo = EVO17_KEYS.has(gene.key);
    if (!isLex && !isEvo) continue;
    const r = isLex ? lexRng : evoRng;
    genome.alleles[gene.key] = [randomAllele(gene, r), randomAllele(gene, r)];
  }
  return genome;
}

// Standing variation (§12.1): shift both alleles partway toward the target:
// a' = a + (target − a) × 0.5. NO organ/bud changes; instincts stay at
// founder values. Loci absent from this genome build are skipped, never
// invented — the shift list below documents which targets have no locus.
export function shiftAlleles(genome, key, target) {
  const al = genome.alleles[key];
  if (!al) return false;
  for (let i = 0; i < 2; i++) al[i] = Math.max(0, Math.min(1, al[i] + (target - al[i]) * 0.5));
  return true;
}

export const GENESIS_COHORTS = [
  // v0.26: cohorts spawn by { key, ord } — the zone and the template
  // ordinal. Spawn x is the platform center (the old x values were the
  // painted platform centers, clamped on-platform). Cluster 0: the founder
  // cluster at every size. Biome-suited quantitative shifts (§12.1); the
  // loci all exist (genome.js family-M thermal block + armLength);
  // shiftAlleles still skips any locus that doesn't, so this table is
  // forward-compatible with genome changes.
  // v2: { label, finder } — the region label and the COHORT_FINDERS key.
  // The shifts are shared.
  { key: 'arctic', ord: 0, label: 'arctic', finder: 'coldest-land', shifts: [['fur', 1], ['coldTol', 1]] },
  { key: 'mountains', ord: 2, label: 'mountains', finder: 'highest-land', shifts: [['armLength', 1], ['coldTol', 0.8]] },
  { key: 'jungle', ord: 1, label: 'jungle', finder: 'founder', shifts: [] }, // the control — always plain founder stock
  { key: 'plains', ord: 0, label: 'plains', finder: 'largest-plains', shifts: [['legLength', 0.8]] },
  { key: 'desert', ord: 0, label: 'desert', finder: 'hottest-dry', shifts: [['fur', 0.2], ['heatTol', 1]] },
  { key: 'shallows', ord: 1, label: 'shallows', finder: 'largest-shallows', shifts: [['coldTol', 0.7]] },
  { key: 'archipelago', ord: 0, label: 'archipelago', finder: 'largest-islands', shifts: [['armLength', 0.8]] },
  { key: 'deep', ord: 0, label: 'deep', finder: 'deep-water', shifts: [['coldTol', 0.8]] },
];

// v0.22.2 — the promoted critters. The legacy scripted bugs and butterflies
// are retired; their lineages enter genesis as founder creatures on the one
// engine — genomes, brains, bodies. Flutters take the branches (flowers),
// grubs take the forest floor (detritus). Pinned founder sub-streams
// (PIN 13/14) keep worldgen deterministic: same seed → same flutter.
function spawnPromotedCohorts(world) {
  const rng = world.rng;
  const branchPis = [];
  const groundPis = [];
  // v2: the founder canopy's platforms. v1: the jungle's cluster-0 platforms,
  // in emission order — the same 9 platforms (ordinals 0–8) the painted
  // [1100,1900] filter found.
  const layout = world.layout;
  let plats = [];
  if (!layout.canonical && layout.founder) {
    const f = layout.founder;
    plats = [...f.groundPis, ...f.branchPis].map((pi) => layout.platforms[pi]);
  } else {
    plats = layout.platformsByZone.jungle.slice(0, 9);
  }
  for (const p of plats) {
    if (p.kind === 'branch') branchPis.push(p.pi);
    if (p.kind === 'ground') groundPis.push(p.pi);
  }
  const spawn = (speciesKey, n, pis) => {
    for (let i = 0; i < n && pis.length > 0; i++) {
      const pi = pis[i % pis.length];
      const plat = world.platforms[pi];
      const c = createCreature(
        founderGenome(speciesKey, rng),
        rng.range(plat.x1 + 20, plat.x2 - 20), pi, rng);
      c.biochem.age = c.pheno.lifespanSec * 0.3; // young adults — breedable soon
      c.sex = i % 2 === 0 ? 'female' : 'male'; // every cohort breeds
      c.name = uniqueName(world, c.name);
      recordLineage(world, c);
      world.seenGenomes.add(genomeHash(c.genome));
      world.creatures.push(c);
    }
  };
  spawn('flutter', 6, branchPis);
  spawn('grub', 8, groundPis);
}

export function populateGenesis(world) {
  const rng = world.rng;
  const seed = world.seed === undefined ? 1 : world.seed;
  // Worldgen west → east in fixed order; cosmetics from decorRng so the
  // main stream's draw sequence stays clean.
  spawnBiomeFlora(world);
  spawnBuriedFood(world);
  spawnMobileFood(world);
  spawnResources(world);
  // v0.18 §13.6: the decided predator roster (arctic bears, deep sharks) —
  // drawn visibly and clickable per the v0.17-dev phantom-killer lesson.
  // Legacy populate() does NOT call this: the jungle battery stays predator-free.
  spawnPredators(world);
  const founders = [];
  // v0.26: one cohort per zone per cluster — at size 1 this is exactly the
  // old 8 cohorts; at size 2 each cluster gets its own 8, holding encounter
  // density constant across the wider world. The draw order is identical at
  // size 1 (single cluster), so founder genomes are untouched there.
  const clusters = Math.max(1, Math.round(world.layout.size));
  for (let cl = 0; cl < clusters; cl++) {
  GENESIS_COHORTS.forEach((g, bi) => {
    const n = 3 + rng.int(0, 2); // 3–5 creatures per biome (§12)
    // v2: cohort platform from the region finder. v1: from platformsByZone.
    let plat = null;
    const layout = world.layout;
    if (!layout.canonical && layout.regions) {
      const region = findRegion(layout, g.finder);
      if (!region) return; // finder found nothing — cohort skipped (gate logs)
      // Prefer a ground platform in the region; else the first platform.
      const rplats = layout.platforms.filter((p) => p.regionId === region.id);
      plat = rplats.find((p) => p.kind === 'ground') || rplats[0];
      if (!plat) return;
    } else {
      // v0.26: cohort platform from the layout (cluster c); spawn x is the
      // platform center, spread ±130px per founder as before.
      const zonePlats = layout.platformsByZone[g.key];
      const perCluster = zonePlats.length / clusters;
      plat = zonePlats[cl * perCluster + g.ord];
    }
    const gxc = (plat.x1 + plat.x2) / 2;
    // Sexes: at least one male and one female per cohort, the rest a coin flip.
    const sexes = [];
    for (let i = 0; i < n; i++) sexes.push(rng.chance(0.5) ? 'male' : 'female');
    if (!sexes.includes('male')) sexes[rng.int(0, n - 1)] = 'male';
    if (!sexes.includes('female')) sexes[rng.int(0, n - 1)] = 'female';
    for (let i = 0; i < n; i++) {
      // §13.7: pin sub-streams per founder via genome.js's native pinSub —
      // same (seed, biome, index) ⇒ same language/evo-devo/realms alleles,
      // independent of founder content (the v0.17 confound fix). The pin is
      // per-founder, not per-biome, so a cohort keeps its sub-stream
      // diversity ("starting variation, never destiny"); the 50% §12.1
      // shifts apply on top.
      const genome = randomGenome(rng, { pinSub: (seed * 31 + (cl * 8 + bi) * 101 + i * 17) | 0, overrides: { speciesTag: SPECIES_TAG_CHOICES.indexOf('tanglekin') } });
      // §12.1: ~50% of each non-control cohort gets biome-suited shifts.
      // Jungle is the control: 100% plain founder stock.
      if (g.key !== 'jungle' && rng.chance(0.5)) {
        for (const [key, target] of g.shifts) shiftAlleles(genome, key, target);
      }
      const x = Math.max(plat.x1 + 20, Math.min(plat.x2 - 20, gxc + (i - (n - 1) / 2) * 130));
      const c = createCreature(genome, x, plat.pi, rng, { name: `${g.key}-${i + 1}` });
      c.name = uniqueName(world, c.name);
      c.sex = sexes[i];
      c.biochem.age = c.pheno.lifespanSec * 0.4; // young adults — breedable from the first minute
      recordLineage(world, c);
      world.seenGenomes.add(genomeHash(c.genome));
      founders.push(c);
    }
  });
  } // clusters
  world.creatures.push(...founders);
  // Starter fruit near each founder — the first meal bootstraps foraging.
  for (const c of founders) {
    const plat = world.platforms[c.platformIndex];
    const fx = Math.max(plat.x1 + 20, Math.min(plat.x2 - 20, c.x + rng.range(-60, 60)));
    addFood(world, fx, c.platformIndex, 'fruit', 1);
  }
  // v0.22.2: the promoted critters join genesis — flutters on the branches
  // (flowers), grubs on the forest floor (detritus).
  spawnPromotedCohorts(world);
  recordFounderMeans(world); // the divergence baseline across all cohorts
  ledgerSeal(world); // v0.24: the world is stocked — seal the mass baseline
  return world;
}
