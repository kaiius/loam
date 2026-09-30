// The world: terrain, plants, food, critters, toys, eggs, creatures,
// and the day/night cycle. Owns the tick orchestration.

import { createRng } from './rng.js';
import { randomGenome, inherit, genomeDistance, GENES, EVO17_KEYS, randomAllele } from './genome.js';
import { randomPlantGenome, plantPhenotype, inheritPlant } from './plantgenome.js';
import { createCreature, updateCreature, creatureRadius, GRAVITY, MAX_FALL, spawnPredators, tickPredators } from './creature.js';
import { BIOMES, biomeAt, biomeKeyAt, biomeCenterX, ambientCold, ambientHeat, ambientTemp, waterAt, waterDepthAt, waterRects, groundYAt, floraFor, WORLD_W, WORLD_H } from './biomes.js';

// v0.18: the biome map is the world's geography now — re-export its API so
// world.js stays the sim's facade.
export { BIOMES, biomeAt, biomeKeyAt, biomeCenterX, ambientCold, ambientHeat, ambientTemp, waterAt, waterDepthAt, waterRects, groundYAt, floraFor, WORLD_W, WORLD_H };
import { ageStage } from './biochem.js';
import { createCulture, sampleCulture, pruneExtinct, adoptTradition, fidelityOf } from './culture.js';
import { createBonds, tickBonds, detectTribes, nudgeBond } from './social.js';
import { createTeacher, tickTeacher, teacherDemo } from './teacher.js';
import { sizePitchFactor, hearThresh, baseLoud, pushUtterance, acousticDistance, lexiconDistance, wordName, LEX_CONTEXTS, pushContextWindow } from './language.js';

export const DAY_LENGTH = 300; // seconds per full day/night cycle

export function createWorld(seed = 1) {
  const rng = createRng(seed);
  const world = {
    rng,
    time: DAY_LENGTH * 0.32, // start mid-morning
    light: 1,
    width: WORLD_W, // v0.18 "Realms": 4800×1100 — eight biomes, west → east
    height: WORLD_H,
    groundY: 800, // legacy field: the jungle floor (biome 2); groundYAt(x) is the real map
    seed, // v0.18: the world's seed, for pinned sub-streams (§13.7)
    stats: { jumps: 0, climbs: 0 }, // v0.18: action counters for the leg experiment
    buried: [], // v0.18 §13.1: buried food [{x, y, kind, amount, biome}] — the dig verb's pantry
    predators: [], // v0.18 §13.6: predator roster (spawned by the creature agent)
    noFouling: false, // v0.18 §13.7: the contamination-neutralize switch for the leg experiment
    // The canopy: jungle region (biome 2) holds the founder 9 platforms —
    // the v0.15 9 with x mapped into the jungle region, x' = 1200 + x×0.375,
    // y UNCHANGED. Honest deviation from "byte-identical": uniform x-scale
    // shrinks every overlap by 0.375, but every old climb link's overlap was
    // ≥200px (scaled ≥75px > the 60px link threshold), so the link topology
    // recomputes identically — and the viability battery is the real gate.
    platforms: [
      // --- Emerald Jungle (indices 0–8): the founder 9, scaled ---
      { x1: 1200, x2: 1800, y: 800, kind: 'ground' }, // jungle floor
      { x1: 1222.5, x2: 1395, y: 650, kind: 'branch' },   // lower branches
      { x1: 1380, x2: 1567.5, y: 640, kind: 'branch' },
      { x1: 1552.5, x2: 1777.5, y: 650, kind: 'branch' },
      { x1: 1275, x2: 1462.5, y: 470, kind: 'branch' },   // mid branches
      { x1: 1447.5, x2: 1642.5, y: 460, kind: 'branch' },
      { x1: 1620, x2: 1785, y: 470, kind: 'branch' },
      { x1: 1320, x2: 1522.5, y: 290, kind: 'branch' },   // upper branches
      { x1: 1507.5, x2: 1687.5, y: 280, kind: 'branch' },
      // --- Arctic Wastes (9–14): full-width ice + 5 broad shelves ---
      { x1: 0, x2: 600, y: 800, kind: 'ground' },
      { x1: 30, x2: 330, y: 786, kind: 'shelf' },
      { x1: 230, x2: 530, y: 782, kind: 'shelf' },
      { x1: 110, x2: 410, y: 791, kind: 'shelf' },
      { x1: 350, x2: 570, y: 787, kind: 'shelf' },
      { x1: 60, x2: 260, y: 795, kind: 'shelf' },
      // --- Skyreach Mountains (15–23): partial ground + 7-shaft vertical chain ---
      { x1: 600, x2: 760, y: 800, kind: 'ground' },  // foothill shelf
      { x1: 1040, x2: 1200, y: 800, kind: 'ground' }, // east shelf
      { x1: 600, x2: 760, y: 700, kind: 'branch' },
      { x1: 660, x2: 820, y: 608, kind: 'branch' },
      { x1: 720, x2: 880, y: 517, kind: 'branch' },
      { x1: 780, x2: 940, y: 425, kind: 'branch' },
      { x1: 840, x2: 1000, y: 333, kind: 'branch' },
      { x1: 900, x2: 1060, y: 242, kind: 'branch' },
      { x1: 960, x2: 1120, y: 150, kind: 'branch' },
      // --- Whispering Plains (24–25): open ground + one low ridge ---
      { x1: 1800, x2: 2400, y: 820, kind: 'ground' },
      // v0.19 "Language": the ridge is a solid mass of earth (top y=700,
      // body down to the ground) — it casts a sound shadow. solid:true
      // marks acoustic mass; the slab band alone would leak sound through.
      { x1: 1950, x2: 2250, y: 700, kind: 'ridge', solid: true },
      // --- Sunscorch Desert (26–29): ground + 3 rock outcrops ---
      { x1: 2400, x2: 3000, y: 830, kind: 'ground' },
      { x1: 2450, x2: 2600, y: 705, kind: 'rock', solid: true },
      { x1: 2650, x2: 2800, y: 700, kind: 'rock', solid: true },
      { x1: 2800, x2: 2950, y: 710, kind: 'rock', solid: true },
      // --- Mangrove Shallows (30–35): walkable seabed + 5 root platforms over water ---
      { x1: 3000, x2: 3600, y: 950, kind: 'ground' },
      { x1: 3020, x2: 3200, y: 770, kind: 'branch' },
      { x1: 3220, x2: 3400, y: 765, kind: 'branch' },
      { x1: 3420, x2: 3580, y: 770, kind: 'branch' },
      { x1: 3050, x2: 3220, y: 778, kind: 'branch' },
      { x1: 3280, x2: 3440, y: 772, kind: 'branch' },
      // --- The Archipelago (36–41): 3 islands × 2 platforms.
      // Deviation from the design's "6 islands": a 600px span cannot hold
      // six islands with 200–400px water gaps (5×200 > 600). The selection
      // reader is preserved — a 200px channel (3860→4060) between island
      // groups that demands jump, glide, or swim.
      { x1: 3600, x2: 3720, y: 780, kind: 'ground' },
      { x1: 3620, x2: 3700, y: 700, kind: 'branch' },
      { x1: 3740, x2: 3860, y: 780, kind: 'ground' },
      { x1: 3760, x2: 3840, y: 700, kind: 'branch' },
      { x1: 4060, x2: 4180, y: 780, kind: 'ground' },
      { x1: 4080, x2: 4160, y: 700, kind: 'branch' },
      // --- Azure Deep (42–44): 3 driftwood floes, no ground ---
      { x1: 4250, x2: 4400, y: 690, kind: 'floe' },
      { x1: 4450, x2: 4600, y: 690, kind: 'floe' },
      { x1: 4650, x2: 4750, y: 690, kind: 'floe' },
    ],
    plants: [],
    foods: [],
    critters: [],
    toys: [],
    eggs: [],
    creatures: [],
    pebbles: [], // v0.9: pushable stones — the world as material
    minerals: [], // v0.17.1 "Touch": static mineral deposits — observer-only until the technology release
    events: [], // { type, creature?, t } — consumed by UI
    culture: createCulture(), // v0.7: the tradition registry — inheritance that isn't DNA
    lineage: new Map(), // v0.10: every creature ever born — { id: { id, name, parents, generation, bornAt, traits } }. Dead ancestors stay resolvable for the lineage view.
    bonds: createBonds(), // v0.12: pairwise social bonds — memory, not genetics
    tribes: [], // v0.12: detected bands (recomputed periodically, never assigned)
    exam: null, // v0.8: exam mode — { patches:[{x1,x2}], hot, hotInterval, coldInterval } | null
    onMeal: null, // v0.8: opt-in telemetry hooks for the exam harness (unset in play)
    onSpawn: null,
    // v0.9: dedicated RNG stream for material scatter (pebbles). Worldgen
    // order is load-bearing for determinism — cosmetic additions must never
    // shift the main stream's sequence (founder genomes, rolls, etc.).
    decorRng: createRng(seed * 31 + 7),
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
    soil: {
      arctic: { waste: 0, fertility: 0.5 },
      mountains: { waste: 0, fertility: 0.5 },
      jungle: { waste: 0, fertility: 0.5 },
      plains: { waste: 0, fertility: 0.5 },
      desert: { waste: 0, fertility: 0.5 },
      shallows: { waste: 0, fertility: 0.5 },
      archipelago: { waste: 0, fertility: 0.5 },
      deep: { waste: 0, fertility: 0.5 },
    },
  };
  // Climb links: pairs of platforms whose x-ranges overlap and whose
  // vertical gap is climbable (60–240px). Computed once at worldgen —
  // the canopy's vertical roads.
  world.climbLinks = computeClimbLinks(world.platforms);
  world.teacher = createTeacher(world, 1500, 0); // jungle floor — the ancestral ground
  return world;
}

// Two platforms are climb-linked if their spans overlap and the gap is
// within reach — close enough to scramble between, far enough to matter.
export function computeClimbLinks(platforms) {
  const links = [];
  for (let a = 0; a < platforms.length; a++) {
    for (let b = a + 1; b < platforms.length; b++) {
      const pa = platforms[a];
      const pb = platforms[b];
      const overlap = Math.min(pa.x2, pb.x2) - Math.max(pa.x1, pb.x1);
      const gap = Math.abs(pa.y - pb.y);
      if (overlap > 60 && gap >= 60 && gap <= 240) {
        links.push({ a, b, x1: Math.max(pa.x1, pb.x1), x2: Math.min(pa.x2, pb.x2) });
      }
    }
  }
  return links;
}

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
  return (world.time / DAY_LENGTH) % 1;
}

// Smooth daylight: 1 at noon, ~0.12 at midnight.
export function updateLight(world) {
  const a = (timeOfDay(world) - 0.25) * Math.PI * 2;
  const s = Math.sin(a) * 0.5 + 0.5;
  world.light = 0.12 + 0.88 * s * s * (3 - 2 * s);
}

let nextObjId = 1;
function oid() {
  return nextObjId++;
}

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
  const w = waterAt(x, 2000);
  return w ? w.surfaceY + 12 : 800;
}

export function addPlant(world, x, platformIndex, genome, opts = {}) {
  // v0.13: initial plant genomes come from the decor stream — worldgen order
  // is load-bearing for determinism, and plant genomes must never shift the
  // main stream's sequence (founder genomes, rolls, etc.).
  const g = genome || randomPlantGenome(world.decorRng || world.rng);
  const plat = platformIndex === -1 ? null : world.platforms[platformIndex];
  world.plants.push({
    kind: 'plant', id: oid(), x, platformIndex, y: plat ? plat.y : floatY(world, x),
    growth: world.rng.range(0.3, 0.8), fruitTimer: world.rng.range(5, 25),
    sway: world.rng.range(0, Math.PI * 2),
    zone: biomeKeyAt(x), // v0.18: biome key (8)
    morph: opts.morph || floraFor(biomeKeyAt(x)).morph, // v0.18: flora morph
    fruitKind: opts.fruitKind || floraFor(biomeKeyAt(x)).fruitKind,
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
    sway: world.rng.range(0, Math.PI * 2),
    zone: biomeKeyAt(x), // v0.18: biome key (8)
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
    // rotAfter: seconds until this fruit rots (0 = never). Nest-cache fruit
    // rots so it can't become a population-level food source — births must
    // increase food DEMAND, not supply, or the ecology explodes.
    rotsAt: rotAfter > 0 ? world.time + rotAfter : 0,
  });
  // v0.8 exam telemetry: opt-in spawn hook (intake-efficiency cost column).
  if (world.onSpawn) world.onSpawn(amount);
}

// v0.13 "Roots": seed dispersal — the coevolution loop. When a creature
// eats fruit, the parent plant's genes may ride along: a seed is deposited
// at the creature's position and sprouts into a seedling carrying a selfed
// child genome (crossover + mutation). High-yield plants get eaten more and
// spread; bitter plants are avoided and persist uneaten; arid selects for
// waterRet, highland for coldTol. Called from doEat.
export function disperseSeed(world, c, food) {
  if (!food.plantId) return;
  const parent = world.plants.find((p) => p.id === food.plantId);
  if (!parent || !parent.genome) return;
  const pYield = parent.pheno ? parent.pheno.yield : 0.5;
  if (!world.rng.chance(0.15 + 0.3 * pYield)) return;
  // Cap the flora: oldest seedlings are culled first.
  if (world.plants.length >= 60) {
    const seedlings = world.plants.filter((p) => p.growth < 1);
    if (seedlings.length > 0) {
      const oldest = seedlings[0];
      world.plants.splice(world.plants.indexOf(oldest), 1);
    } else return;
  }
  const plat = world.platforms[c.platformIndex];
  if (!plat) return;
  const x = Math.max(plat.x1 + 10, Math.min(plat.x2 - 10, c.x + world.rng.range(-40, 40)));
  const childGenome = inheritPlant(parent.genome, parent.genome, world.rng);
  if (parent.kind === 'herb') addHerb(world, x, c.platformIndex, childGenome);
  else addPlant(world, x, c.platformIndex, childGenome);
  const seedling = world.plants[world.plants.length - 1];
  seedling.growth = 0.05; // a true seedling — must mature before fruiting
  world.events.push({ type: 'seedDispersed', plant: seedling, parentId: parent.id, t: world.time });
}

export function addCritter(world, x, platformIndex, kind) {
  const plat = world.platforms[platformIndex];
  world.critters.push({
    kind, id: oid(), x, platformIndex, y: plat.y,
    vx: world.rng.pick([-1, 1]) * world.rng.range(15, 40),
    t: world.rng.range(0, 100),
  });
}

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
    vx: 0, vy: 0, r: (world.decorRng || world.rng).range(9, 17),
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
  { key: 'flint', name: 'Flint', color: '#4a4a52', hardness: 0.9, blurb: 'Sharp-edged stone. Future toolheads will want this.' },
  { key: 'quartz', name: 'Quartz', color: '#cfd8e6', hardness: 0.7, blurb: 'Glassy crystal. Catches the light; good for nothing yet.' },
  { key: 'clay', name: 'Clay', color: '#a5715c', hardness: 0.3, blurb: 'Soft earth. Malleable — future hands could shape it.' },
  // v0.18 §12.2: per-biome resource sets — timber stands, building stone,
  // driftwood currents. Same deposit entity shape as v0.17.1 minerals;
  // observer-only until the technology release, same as the rest.
  { key: 'timber', name: 'Timber', color: '#6b4a2f', hardness: 0.4, blurb: 'Fallen wood. The shipwright\u2019s material, if anyone ever becomes one.' },
  { key: 'stone', name: 'Stone', color: '#8a8a8a', hardness: 0.8, blurb: 'Building stone. Shelter waits inside the heavy stuff.' },
  { key: 'driftwood', name: 'Driftwood', color: '#9c7a54', hardness: 0.35, blurb: 'Sea-smoothed wood. It floats — that is the whole affordance.' },
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
    amount: 4, // samples per deposit
  };
  world.minerals.push(m);
  return m;
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
  world.eggs.push({
    kind: 'egg', id: oid(), x, y: plat.y, platformIndex, genome, parents,
    vx: 0, vy: 0, // v0.17.2: eggs obey gravity when lifted and released
    dragged: false, // v0.17.2: the observer's hand — gravity pauses while held
    gen, traditionIds, // v0.7: pedigree depth + vertical cultural inheritance
    timer: (18 + world.rng.range(0, 10)) * gestMult, wobble: 0, // v2 (L): gestation scales
    parentDist, // v0.14: parental genome distance — the hybrid penalty input
  });
}

export function tryMate(a, b) {
  // Called with world as `this` via world.tryMate — bound below.
  const world = this;
  const sa = ageStage(a.biochem, a.pheno);
  const sb = ageStage(b.biochem, b.pheno);
  if (sa !== 'adult' || sb !== 'adult') return false;
  if (a.sex === b.sex || a.mateCooldown > 0 || b.mateCooldown > 0) return false;
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
  if (world.rng.next() > 0.35 + 0.4 * Math.min(a.pheno.fertility * fertAt(a), b.pheno.fertility * fertAt(b))) return false;
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
    const eg = inherit(mom.genome, dad.genome, world.rng);
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
  a.mateCooldown = 90;
  b.mateCooldown = 90;
  a.reward += 0.8;
  b.reward += 0.8;
  // v0.12: mating forms a pair bond — the strongest positive bond event.
  nudgeBond(world, a, b, 0.4);
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
export function noteDeath(world, c, cause) {
  world.events.push({ type: 'death', creature: c, t: world.time, cause });
  const rec = world.lineage.get(c.id);
  if (rec) { rec.diedAt = world.time; rec.cause = cause; }
  // v0.18 §13.4: the dead leave a corpse at the death position — edible via
  // eat (scavenging is possible from v0.18; predation is not scripted).
  // Corpses decay; ambient cold slows decay (the Arctic keeps its dead).
  // Replaces the v0.7 'meat' carcass previously spawned in the dead-splice
  // of tickWorld — one corpse per death, not two. TODO(creature-agent):
  // doEat's meatEfficiency branch should include 'corpse' (creature.js) so
  // scavenging rewards carnivores; until then corpses eat at fruitEfficiency.
  const plat = world.platforms[c.platformIndex];
  const cold = ambientCold(c.x, plat ? plat.y : 800);
  addFood(world, c.x, c.platformIndex, 'corpse', 1.2, CORPSE_ROT * (1 + 2 * cold), { nutrition: 1 });
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
    if (plats[i].solid && rayHitsSolid(x1, y1, x2, y2, plats[i])) att *= RIDGE_SHADOW;
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
function solidBody(pl) {
  const x1 = Number(pl.x1), x2 = Number(pl.x2), top = Number(pl.y);
  if (![x1, x2, top].every(Number.isFinite) || x2 <= x1) {
    return { x1: 0, x2: -1, top: 0, base: 0 };
  }
  let base = top + 160; // fallback foot if the ground map has no answer
  try {
    const g = groundYAt((x1 + x2) / 2);
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
function rayHitsSolid(x1, y1, x2, y2, pl) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
  const near1 = Math.abs(y1 - pl.y) < 16 && x1 >= pl.x1 - 4 && x1 <= pl.x2 + 4;
  const near2 = Math.abs(y2 - pl.y) < 16 && x2 >= pl.x1 - 4 && x2 <= pl.x2 + 4;
  if (near1 || near2) return false;
  const b = solidBody(pl);
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
export const SOIL_LEACH = 0.004; // per-second relaxation of fertility to 0.5
export const SOIL_FERT_MAX = 1.5;
export const WASTE_ODOR_SCALE = 4; // soil-waste units that read as full stink
export const CONTAM_ILLNESS = 0.15; // illness per unit bite at full contamination
// v0.14.1 "Detritus": nothing leaves the loop. Rot, scraps, shed leaves all
// compost into the zone soil — death feeds the ground that feeds the plants.
export const SCRAP_FRACTION = 0.12; // of each bite falls as litter
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
  const soil = world.soil;
  const s = soil && soil[biomeKeyAt(x)];
  return s ? Math.min(1, s.waste / WASTE_ODOR_SCALE) : 0;
}

export function excrete(c, world, dt) {
  if (world.noFouling) return; // §13.7: the contamination-neutralize switch
  if (!c.gut || c.gut <= 0 || !world.soil) return;
  const dep = Math.min(c.gut, c.gut * EXCRETE_RATE * dt);
  if (dep <= 0) return;
  c.gut -= dep;
  const s = world.soil[biomeKeyAt(c.x)];
  if (s) s.waste += dep;
}

export function tickSoil(world, dt) {
  if (world.noFouling) return; // §13.7: the contamination-neutralize switch
  if (!world.soil) return;
  for (const b of BIOMES) {
    const s = world.soil[b.key];
    if (!s) continue;
    // Decomposition: raw waste becomes fertility.
    const conv = Math.min(s.waste, s.waste * SOIL_DECAY * dt);
    s.waste -= conv;
    s.fertility = Math.min(SOIL_FERT_MAX, s.fertility + conv * SOIL_CONV_EFF);
    // Leaching: unused fertility washes out toward the baseline.
    s.fertility += (0.5 - s.fertility) * Math.min(1, SOIL_LEACH * dt);
    // v0.14.1: the land remembers — first crossing into rich ground is
    // history, not just chemistry. Noted once per zone per enrichment.
    if (s.fertility >= 1.0 && !s.richNoted) {
      s.richNoted = true;
      if (world.events) world.events.push({ type: 'soilRich', zone: b.key, t: world.time });
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
      const s = world.soil && world.soil[biomeKeyAt(f.x)];
      if (s) s.waste += f.amount * (f.nutrition || 1);
      world.foods.splice(i, 1);
    }
  }
}

// v0.14.1: leaf litter — the unused parts of plants. Every plant sheds mass
// into its zone's soil as it grows; fast growers shed more. Shed leaves are
// not an item (no render, no sense surface); they go straight to the ground.
export function shedLitter(world, dt) {
  if (!world.soil) return;
  for (const p of world.plants) {
    const s = world.soil[p.zone];
    if (!s) continue;
    const gr = (p.pheno && p.pheno.growthRate !== undefined) ? p.pheno.growthRate : 0.5;
    s.waste += LITTER_RATE * (0.5 + gr) * dt;
  }
}

// Plant growth multiplier from soil fertility. Exported for tests and UI.
export function soilGrowthMul(world, zoneKey) {
  const soil = world.soil || {};
  const s = soil[zoneKey];
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

function hatchEgg(world, egg) {  const c = createCreature(egg.genome, egg.x, egg.platformIndex, world.rng, {
    parents: egg.parents,
    generation: egg.gen || 0,
  });
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
  addFood(world, egg.x + world.rng.range(-14, 14), egg.platformIndex, 'fruit', 0.35, 90);
  const i = world.eggs.indexOf(egg);
  if (i >= 0) world.eggs.splice(i, 1);
}

export function tickWorld(world, dt) {
  world.time += dt;
  updateLight(world);
  const rng = world.rng;

  // Plants grow fruit.
  for (const p of world.plants) {
    // v0.13: growth rate from the plant genome.
    // v0.14: the waste cycle closes the loop — soil fertility (fed by
    // excretion, built by decomposition) scales growth. Fertile ground
    // grows faster; exhausted ground stalls.
    p.growth = Math.min(1, p.growth + (dt / 150) * (0.5 + (p.pheno ? p.pheno.growthRate : 0.5)) * soilGrowthMul(world, p.zone));
    p.sway += dt;
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
          const bk = p.zone;
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
          const densityMul = 1 + (world.creatures.length / 40) * 0.6;
          interval = interval * intervalGene * zoneStress * densityMul;
        }
        p.fruitTimer = interval;
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
        const fruits = p.kind === 'herb' ? 1 : 1 + Math.round(2 * (ph.yield !== undefined ? ph.yield : 0.5));
        const nutrition = p.kind === 'herb'
          ? 0.3 * (0.5 + (ph.potency !== undefined ? ph.potency : 0.5))
          : 0.5 + (ph.fruitSize !== undefined ? ph.fruitSize : 0.5);
        for (let f = 0; f < fruits; f++) {
          addFood(world, p.x + rng.range(-30, 30), p.platformIndex, dropKind, 1, 0, {
            plantId: p.id, bitterness: ph.bitterness || 0, nutrition,
          });
        }
        if (world.foods.length > 60) world.foods.splice(0, world.foods.length - 60);
      }
    }
  }

  // v0.14: the waste cycle — decomposition and leaching run on the soil,
  // once per tick, after the plants have eaten from it.
  // v0.14.1: leaf litter sheds before decomposition runs, so shed mass
  // composts the same tick it falls.
  shedLitter(world, dt);
  tickSoil(world, dt);

  // v0.14.1: rot composts — see compostRot. (Only nest-cache fruit, scraps,
  // and carcass meat carry timers; plant fruit is eaten or it hangs.)
  compostRot(world);

  // Critters wander.
  for (const cr of world.critters) {
    const plat = world.platforms[cr.platformIndex];
    cr.t += dt;
    cr.x += cr.vx * dt;
    if (cr.x < plat.x1 + 10) { cr.x = plat.x1 + 10; cr.vx = Math.abs(cr.vx); }
    if (cr.x > plat.x2 - 10) { cr.x = plat.x2 - 10; cr.vx = -Math.abs(cr.vx); }
    if (rng.chance(dt * 0.2)) cr.vx = -cr.vx;
  }

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
  // that would leave the water stays put). No brains, no instincts — slow
  // random-walk morsels, the first meat. Edible via the existing eat verb.
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
      if (waterAt(nx, ny)) { f.x = nx; f.y = ny; }
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
  // v0.18 "Realms": the legacy jungle-only battery spawner. The founder 9
  // platforms are indices 0–8 (the scaled jungle), so platform indices are
  // unchanged; x-coordinates are mapped into the jungle region,
  // x' = 1200 + x×(600/1600). The rng draw ORDER is identical to v0.17.1
  // (same calls, same counts — bounds don't consume draws), so founder
  // genomes are bit-identical; only positions moved. Four founders, plain
  // founder stock, no shifts.
  const mx = (x) => 1200 + x * 0.375;
  // The canopy's ecology: fruit trees grow ON the branches (plants are
  // indexed by platform — a tree on branch 4 fruits on branch 4); medicinal
  // herbs are undergrowth on the forest floor.
  // v0.11 biomes: verdant valley is lush, the arid stretch is harsh (one
  // fruit tree, but extra medicinal herbs), the highland is moderate.
  addPlant(world, mx(200), 1); addPlant(world, mx(420), 1); // lower-left branch trees
  addPlant(world, mx(700), 2); // lower-mid
  addPlant(world, mx(1150), 3); addPlant(world, mx(1400), 3); // lower-right
  addPlant(world, mx(450), 4); addPlant(world, mx(900), 5); // mid branches
  addPlant(world, mx(1250), 6);
  addPlant(world, mx(600), 7); addPlant(world, mx(1050), 8); // upper branches
  // v0.8: medicinal herbs, on the forest floor where the sick descend.
  // v0.11: they thrive where food is scarcest.
  addHerb(world, mx(650), 0); addHerb(world, mx(950), 0); addHerb(world, mx(1300), 0);
  // Starter food: hang fruit in the branches so the first tanglekins don't
  // starve immediately.
  const branchIdx = [1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 8; i++) {
    const pi = branchIdx[i % branchIdx.length];
    const plat = world.platforms[pi];
    addFood(world, rng.range(plat.x1 + 40, plat.x2 - 40), pi, 'fruit', 1);
  }
  // Critters in the branches, a ball on the forest floor.
  for (let i = 0; i < 5; i++) addCritter(world, rng.range(mx(100), mx(1500)), 1 + rng.int(0, 5), 'bug');
  for (let i = 0; i < 3; i++) addCritter(world, rng.range(mx(200), mx(1400)), 4 + rng.int(0, 2), 'butterfly');
  addToy(world, mx(800), 0);
  // v0.9: pebbles scattered on the forest floor — the world as material.
  for (let i = 0; i < 8; i++) addPebble(world, rng.range(mx(80), mx(1520)), 0);
  // v0.17.1 "Touch": mineral deposits. Fixed positions (no rng — worldgen
  // order is load-bearing for determinism, and these must never shift the
  // main stream's sequence). Observer-only until the technology release.
  addMineral(world, mx(300), 0, 'flint');   // jungle floor, west side
  addMineral(world, mx(800), 0, 'clay');    // jungle floor, middle
  addMineral(world, mx(1300), 0, 'flint');  // jungle floor, east side
  addMineral(world, mx(600), 7, 'quartz');  // upper branch — the climb is the price
  // Four founder tanglekins with fresh random genomes, born in the lower
  // branches. (v0.5: was two. Two founders made every lineage a coin flip —
  // four founders (two breeding pairs) give the population the demographic
  // buffer it needs to survive drift.)
  const founders = [];
  const names = ['Pip', 'Moss'];
  // Founders start on adjacent lower branches where the climb links are —
  // 180px spacing keeps adjacent founders inside the 240px breeding-backstop
  // range but outside the 150px contagion range.
  const starts = [[mx(400), 1], [mx(580), 1], [mx(760), 2], [mx(940), 2]];
  for (let i = 0; i < 4; i++) {
    const [fx, fpi] = starts[i];
    const c = createCreature(randomGenome(rng), fx, fpi, rng,
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
  buryFood(world, 'plains', 'tuber', 1.6, 1850, 2350, 820, 8);       // tubers/roots — plains keep it all underground
  buryFood(world, 'desert', 'tuber', 1.8, 2450, 2950, 830, 6);        // deep tubers — the desert classic
  buryFood(world, 'jungle', 'grub', 1.2, 1250, 1750, 800, 6);         // grubs under leaf litter
  buryFood(world, 'arctic', 'snowcache', 1.4, 50, 550, 800, 4);       // snow caches: roots/tubers
  buryFood(world, 'shallows', 'morsel', 1.0, 3050, 3550, 950, 5);     // seabed morsels (wading dig)
  buryFood(world, 'archipelago', 'sandcache', 1.3, 3610, 3710, 780, 4); // shallow sand caches
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
  const bug = (x0, x1, pi, n) => {
    for (let i = 0; i < n; i++) addMobileFood(world, 'bug', dr.range(x0, x1), pi);
  };
  bug(1250, 1740, 1, 3); bug(1390, 1560, 2, 3); bug(1560, 1770, 3, 2); // jungle beetles (abundant)
  bug(1850, 2350, 24, 6);   // plains grasshoppers
  bug(2450, 2950, 26, 4);   // desert nocturnal insects
  bug(620, 740, 17, 1); bug(740, 860, 19, 1); bug(860, 980, 21, 1); // mountains cliff insects
  const minnow = (x0, x1, y0, y1, n) => {
    for (let i = 0; i < n; i++) addMobileFood(world, 'minnow', dr.range(x0, x1), -1, dr.range(y0, y1));
  };
  minnow(3050, 3550, 815, 900, 8);  // shallows
  minnow(3650, 3800, 815, 880, 3); minnow(4070, 4170, 815, 880, 3); // archipelago
  minnow(4250, 4750, 715, 950, 6);  // deep — the only meat
}

// ---- v0.18 §12.2: per-biome resource sets ----

export function spawnResources(world) {
  // Fixed positions, no rng draws (the decorRng precedent: worldgen order
  // is load-bearing, and resources must never shift the main stream).
  // Observer-only until the technology release — the materials are there,
  // the using is theirs to invent.
  addMineral(world, 3660, 36, 'timber');    // archipelago island 1 — the shipwright's biome
  addMineral(world, 3800, 38, 'timber');    // archipelago island 2
  addMineral(world, 4120, 40, 'timber');    // archipelago island 3
  addMineral(world, 3300, 31, 'timber');    // shallows mangrove stand — abundant timber
  addMineral(world, 4325, 42, 'timber');    // deep floe timber
  addMineral(world, 680, 17, 'stone');      // mountains shaft base — sparse timber, stone instead
  addMineral(world, 920, 21, 'stone');      // mountains mid shaft
  addMineral(world, 300, 9, 'stone');       // arctic shelter stone — little to build with
  addMineral(world, 4150, 40, 'driftwood'); // archipelago drift line
  addMineral(world, 4525, 43, 'driftwood'); // deep drift current
  addMineral(world, 2700, 26, 'clay');      // desert sun-baked clay
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

export function plantBiomeFlora(world, x, platformIndex, biomeKey, herb = false) {
  const flora = floraFor(biomeKey);
  const g = randomPlantGenome(world.decorRng || world.rng);
  biasPlantGenomeFor(g, flora);
  const opts = herb ? { morph: 'herb' } : { morph: flora.morph, fruitKind: flora.fruitKind };
  if (herb) addHerb(world, x, platformIndex, g, opts);
  else addPlant(world, x, platformIndex, g, opts);
}

export function spawnBiomeFlora(world) {
  const dr = world.decorRng || world.rng;
  const tree = (biome, x0, x1, pi, n, herb = false) => {
    for (let i = 0; i < n; i++) plantBiomeFlora(world, dr.range(x0, x1), pi, biome, herb);
  };
  // Emerald Jungle: dense fruit trees on the branches + floor herbs (the ancestral economy)
  tree('jungle', 1230, 1390, 1, 2); tree('jungle', 1390, 1560, 2, 2); tree('jungle', 1560, 1770, 3, 2);
  tree('jungle', 1290, 1450, 4, 2); tree('jungle', 1460, 1630, 5, 1); tree('jungle', 1630, 1780, 6, 1);
  tree('jungle', 1330, 1510, 7, 1); tree('jungle', 1520, 1680, 8, 1);
  tree('jungle', 1250, 1750, 0, 3, true); // medicinal herbs on the floor
  // Arctic Wastes: sparse ice-moss
  tree('arctic', 50, 550, 9, 6);
  // Skyreach Mountains: alpine shrubs — coldTol selects; the prize altitude taxes
  tree('mountains', 610, 750, 17, 1); tree('mountains', 730, 870, 19, 1);
  tree('mountains', 850, 990, 21, 1); tree('mountains', 970, 1110, 23, 1);
  tree('mountains', 620, 740, 15, 2, true); // foothill herbs
  // Whispering Plains: grasses — ALL food on the ground, no branches
  tree('plains', 1850, 2350, 24, 12);
  // Sunscorch Desert: sparse cacti + one oasis herb
  tree('desert', 2450, 2950, 26, 5);
  tree('desert', 2690, 2750, 26, 1, true);
  // Mangrove Shallows: mangroves over water
  tree('shallows', 3030, 3190, 31, 1); tree('shallows', 3230, 3390, 32, 1);
  tree('shallows', 3430, 3570, 33, 1); tree('shallows', 3060, 3210, 34, 1);
  tree('shallows', 3290, 3430, 35, 2);
  // The Archipelago: palms on the islands + island herbs
  tree('archipelago', 3610, 3710, 36, 2); tree('archipelago', 3750, 3850, 38, 2);
  tree('archipelago', 4070, 4170, 40, 1);
  tree('archipelago', 3630, 3690, 37, 1); tree('archipelago', 3770, 3830, 39, 1);
  tree('archipelago', 3610, 3710, 36, 1, true); tree('archipelago', 3750, 3850, 38, 1, true);
  // Azure Deep: floating kelp — platformIndex -1, the floating convention
  for (let i = 0; i < 7; i++) plantBiomeFlora(world, dr.range(4250, 4750), -1, 'deep');
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
  // biome, spawn x, platform, biome-suited quantitative shifts (§12.1).
  // The loci all exist (genome.js family-M thermal block + armLength);
  // shiftAlleles still skips any locus that doesn't, so this table is
  // forward-compatible with genome changes.
  { biome: 0, key: 'arctic', x: 300, pi: 9, shifts: [['fur', 1], ['coldTol', 1]] },
  { biome: 1, key: 'mountains', x: 680, pi: 17, shifts: [['armLength', 1], ['coldTol', 0.8]] },
  { biome: 2, key: 'jungle', x: 1400, pi: 1, shifts: [] }, // the control — always plain founder stock
  { biome: 3, key: 'plains', x: 2100, pi: 24, shifts: [['legLength', 0.8]] },
  { biome: 4, key: 'desert', x: 2700, pi: 26, shifts: [['fur', 0.2], ['heatTol', 1]] },
  { biome: 5, key: 'shallows', x: 3300, pi: 31, shifts: [['coldTol', 0.7]] },
  { biome: 6, key: 'archipelago', x: 3660, pi: 36, shifts: [['armLength', 0.8]] },
  { biome: 7, key: 'deep', x: 4325, pi: 42, shifts: [['coldTol', 0.8]] },
];

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
  GENESIS_COHORTS.forEach((g, bi) => {
    const n = 3 + rng.int(0, 2); // 3–5 creatures per biome (§12)
    const plat = world.platforms[g.pi];
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
      const genome = randomGenome(rng, { pinSub: (seed * 31 + bi * 101 + i * 17) | 0 });
      // §12.1: ~50% of each non-control cohort gets biome-suited shifts.
      // Jungle is the control: 100% plain founder stock.
      if (g.biome !== 2 && rng.chance(0.5)) {
        for (const [key, target] of g.shifts) shiftAlleles(genome, key, target);
      }
      const x = Math.max(plat.x1 + 20, Math.min(plat.x2 - 20, g.x + (i - (n - 1) / 2) * 130));
      const c = createCreature(genome, x, g.pi, rng, { name: `${g.key}-${i + 1}` });
      c.name = uniqueName(world, c.name);
      c.sex = sexes[i];
      c.biochem.age = c.pheno.lifespanSec * 0.4; // young adults — breedable from the first minute
      recordLineage(world, c);
      world.seenGenomes.add(genomeHash(c.genome));
      founders.push(c);
    }
  });
  world.creatures.push(...founders);
  // Starter fruit near each founder — the first meal bootstraps foraging.
  for (const c of founders) {
    const plat = world.platforms[c.platformIndex];
    const fx = Math.max(plat.x1 + 20, Math.min(plat.x2 - 20, c.x + rng.range(-60, 60)));
    addFood(world, fx, c.platformIndex, 'fruit', 1);
  }
  recordFounderMeans(world); // the divergence baseline across all cohorts
  return world;
}
