// The world: terrain, plants, food, critters, toys, eggs, creatures,
// and the day/night cycle. Owns the tick orchestration.

import { createRng } from './rng.js';
import { randomGenome, inherit } from './genome.js';
import { randomPlantGenome, plantPhenotype, inheritPlant } from './plantgenome.js';
import { createCreature, updateCreature, creatureRadius } from './creature.js';
import { ageStage } from './biochem.js';
import { createCulture, sampleCulture, pruneExtinct, adoptTradition, fidelityOf } from './culture.js';
import { createBonds, tickBonds, detectTribes, nudgeBond } from './social.js';

export const DAY_LENGTH = 300; // seconds per full day/night cycle

export function createWorld(seed = 1) {
  const rng = createRng(seed);
  const world = {
    rng,
    time: DAY_LENGTH * 0.32, // start mid-morning
    light: 1,
    width: 1600,
    height: 900,
    groundY: 800,
    // The canopy: the forest floor plus three tiers of branches. Branches
    // are platforms with a kind; overlapping branches in adjacent tiers are
    // linked by climbable gaps (computed below). Tanglekins are arboreal —
    // the vertical is the world, not a backdrop.
    platforms: [
      { x1: 0, x2: 1600, y: 800, kind: 'ground' }, // forest floor
      // lower branches
      { x1: 60, x2: 520, y: 650, kind: 'branch' },
      { x1: 480, x2: 980, y: 640, kind: 'branch' },
      { x1: 940, x2: 1540, y: 650, kind: 'branch' },
      // mid branches
      { x1: 200, x2: 700, y: 470, kind: 'branch' },
      { x1: 660, x2: 1180, y: 460, kind: 'branch' },
      { x1: 1120, x2: 1560, y: 470, kind: 'branch' },
      // upper branches
      { x1: 320, x2: 860, y: 290, kind: 'branch' },
      { x1: 820, x2: 1300, y: 280, kind: 'branch' },
    ],
    plants: [],
    foods: [],
    critters: [],
    toys: [],
    eggs: [],
    creatures: [],
    pebbles: [], // v0.9: pushable stones — the world as material
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
  };
  // Climb links: pairs of platforms whose x-ranges overlap and whose
  // vertical gap is climbable (60–240px). Computed once at worldgen —
  // the canopy's vertical roads.
  world.climbLinks = computeClimbLinks(world.platforms);
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

// v0.11 biomes: the world is three ecological zones by x-slice. Different
// fruiting rates create different selection pressures — local adaptation.
export const ZONES = [
  { key: 'verdant', name: 'Verdant Valley', x1: 0, x2: 533, fruitMul: 0.6, tint: 'rgba(60,140,70,0.10)' },
  { key: 'arid', name: 'Arid Stretch', x1: 533, x2: 1066, fruitMul: 2.2, tint: 'rgba(190,150,80,0.12)' },
  { key: 'highland', name: 'Highland', x1: 1066, x2: 1601, fruitMul: 1.2, tint: 'rgba(120,140,170,0.10)' },
];

export function zoneAt(x) {
  for (const z of ZONES) if (x >= z.x1 && x < z.x2) return z;
  return ZONES[2];
}

export function addPlant(world, x, platformIndex, genome) {
  const plat = world.platforms[platformIndex];
  // v0.13: initial plant genomes come from the decor stream — worldgen order
  // is load-bearing for determinism, and plant genomes must never shift the
  // main stream's sequence (founder genomes, rolls, etc.).
  const g = genome || randomPlantGenome(world.decorRng || world.rng);
  world.plants.push({
    kind: 'plant', id: oid(), x, platformIndex, y: plat.y,
    growth: world.rng.range(0.3, 0.8), fruitTimer: world.rng.range(5, 25),
    sway: world.rng.range(0, Math.PI * 2),
    zone: zoneAt(x).key, // v0.11: biomes
    genome: g, pheno: plantPhenotype(g), // v0.13: plant genomes
  });
}

// v0.8: medicinal herbs. Same growth mechanics as fruit plants, but they bear
// bitter leaves (foodKind 'leaf') that purge illness instead of feeding hunger.
export function addHerb(world, x, platformIndex, genome) {
  const plat = world.platforms[platformIndex];
  const g = genome || randomPlantGenome(world.decorRng || world.rng);
  world.plants.push({
    kind: 'herb', id: oid(), x, platformIndex, y: plat.y,
    growth: world.rng.range(0.3, 0.8), fruitTimer: world.rng.range(5, 25),
    sway: world.rng.range(0, Math.PI * 2),
    zone: zoneAt(x).key, // v0.11: biomes
    genome: g, pheno: plantPhenotype(g), // v0.13: plant genomes
  });
}

export function addFood(world, x, platformIndex, kind = 'fruit', amount = 1, rotAfter = 0, opts = {}) {
  const plat = world.platforms[platformIndex];
  world.foods.push({
    kind: 'food', id: oid(), x, platformIndex, y: plat.y, foodKind: kind, amount,
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
    kind: 'ball', id: oid(), x, platformIndex, y: plat.y, vx: 0, r: 16,
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
    vx: 0, r: (world.decorRng || world.rng).range(9, 17),
  });
}

export function layEgg(world, x, platformIndex, genome, parents = null, gen = 0, traditionIds = [], gestMult = 1) {
  const plat = world.platforms[platformIndex];
  world.eggs.push({
    kind: 'egg', id: oid(), x, y: plat.y, platformIndex, genome, parents,
    gen, traditionIds, // v0.7: pedigree depth + vertical cultural inheritance
    timer: (18 + world.rng.range(0, 10)) * gestMult, wobble: 0, // v2 (L): gestation scales
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
  for (let i = 0; i < nEggs; i++) {
    const eg = inherit(mom.genome, dad.genome, world.rng);
    layEgg(world, (a.x + b.x) / 2 + world.rng.range(-30, 30), a.platformIndex, eg, [mom.id, dad.id], childGen, parentTraditions, gestMult);
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
    zone: zoneAt(c.x).key, // v0.11: birth biome
    traits,
  });
  // Soft cap: forget the oldest records beyond 5000 (ancestor chains for
  // living creatures are walked at view time, so pruning the deep past is safe).
  if (world.lineage.size > 5000) {
    const first = world.lineage.keys().next().value;
    world.lineage.delete(first);
  }
}

// v0.13: compact genome hash for the beautiful-mutant watch (iggy's idea).
// Two creatures share a hash only if every allele matches to 3 decimals.
export function genomeHash(genome) {
  const parts = [];
  for (const key of Object.keys(genome.alleles).sort()) {
    const [a, b] = genome.alleles[key];
    parts.push(a.toFixed(3) + '/' + b.toFixed(3));
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

// v0.13: divergence metric (Eliza's S). Per biome, per tracked trait:
// S = μ_zone(adults now) − μ_founders. Positive S = the biome selected
// upward on that trait; negative = downward. Computed every 6 sim-minutes.
export const DIVERGENCE_CREATURE_TRAITS = ['instHomeSeek', 'size', 'bulk', 'curiosity', 'boldness'];
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
  for (const z of ZONES) {
    const zs = { key: z.key };
    // Creatures: adults currently in this zone.
    const adults = world.creatures.filter((c) => c.alive && zoneAt(c.x).key === z.key);
    for (const k of DIVERGENCE_CREATURE_TRAITS) {
      if (adults.length === 0) { zs[k] = 0; continue; }
      let sum = 0;
      for (const c of adults) sum += c.pheno[k] !== undefined ? c.pheno[k] : 0.5;
      zs[k] = sum / adults.length - world.founderMeans[k];
    }
    // Plants: all plants rooted in this zone.
    const plants = world.plants.filter((p) => p.zone === z.key && p.pheno);
    for (const k of DIVERGENCE_PLANT_TRAITS) {
      const pk = 'plant_' + k;
      if (plants.length === 0) { zs[pk] = 0; continue; }
      let sum = 0;
      for (const p of plants) sum += p.pheno[k] !== undefined ? p.pheno[k] : 0.5;
      zs[pk] = sum / plants.length - world.founderMeans[pk];
    }
    snap.zones[z.key] = zs;
  }
  world.divergenceLog.push(snap);
  // Keep the log bounded: one snapshot per 6 sim-minutes, cap at 500.
  if (world.divergenceLog.length > 500) world.divergenceLog.splice(0, world.divergenceLog.length - 500);
  return snap;
}

function hatchEgg(world, egg) {  const c = createCreature(egg.genome, egg.x, egg.platformIndex, world.rng, {
    parents: egg.parents,
    generation: egg.gen || 0,
  });
  c.name = uniqueName(world, c.name);
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
    p.growth = Math.min(1, p.growth + (dt / 150) * (0.5 + (p.pheno ? p.pheno.growthRate : 0.5)));
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
          const ph = p.pheno || {};
          const intervalGene = 0.7 + 0.6 * (ph.interval !== undefined ? ph.interval : 0.5);
          let zoneStress;
          if (p.kind === 'herb') {
            zoneStress = p.zone === 'arid' ? 0.9 : 1.1;
          } else if (p.zone === 'arid') {
            // Drought: thirsty plants stall; water-retainers keep fruiting.
            zoneStress = zoneAt(p.x).fruitMul * (2 - (ph.waterRet !== undefined ? ph.waterRet : 0.5));
          } else if (p.zone === 'highland') {
            // Cold: the tender stall; the hardy keep fruiting.
            zoneStress = zoneAt(p.x).fruitMul * (1.6 - 0.6 * (ph.coldTol !== undefined ? ph.coldTol : 0.5));
          } else {
            zoneStress = zoneAt(p.x).fruitMul;
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
        const dropKind = p.kind === 'herb' ? 'leaf' : 'fruit';
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

  // Food rots (only nest-cache fruit has a timer; plant fruit lasts).
  for (let i = world.foods.length - 1; i >= 0; i--) {
    if (world.foods[i].rotsAt > 0 && world.time >= world.foods[i].rotsAt) {
      world.foods.splice(i, 1);
    }
  }

  // Critters wander.
  for (const cr of world.critters) {
    const plat = world.platforms[cr.platformIndex];
    cr.t += dt;
    cr.x += cr.vx * dt;
    if (cr.x < plat.x1 + 10) { cr.x = plat.x1 + 10; cr.vx = Math.abs(cr.vx); }
    if (cr.x > plat.x2 - 10) { cr.x = plat.x2 - 10; cr.vx = -Math.abs(cr.vx); }
    if (rng.chance(dt * 0.2)) cr.vx = -cr.vx;
  }

  // Toys: friction.
  for (const t of world.toys) {
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

  // Eggs hatch.
  for (const egg of [...world.eggs]) {
    egg.timer -= dt;
    egg.wobble = Math.max(0, egg.wobble - dt);
    if (egg.timer < 3) egg.wobble = 0.3; // wobbling before hatch
    if (egg.timer <= 0) hatchEgg(world, egg);
  }

  // Creatures.
  rebuildSpatialIndex(world);
  for (const c of world.creatures) {
    updateCreature(c, world, dt);
  }
  // v0.12: bond dynamics run on the fresh positions — familiarity,
  // play-together, decay, and pruning of the dead.
  tickBonds(world, dt);
  // v0.12: tribe detection every 60 sim-seconds — bands are detected,
  // never assigned.
  if (Math.floor(world.time / 60) !== Math.floor((world.time - dt) / 60)) {
    world.tribes = detectTribes(world);
  }
  // v0.13: divergence snapshot every 6 sim-minutes — Eliza's S per biome.
  if (Math.floor(world.time / 360) !== Math.floor((world.time - dt) / 360)) {
    computeDivergence(world);
  }
  // Remove the dead (UI reads events first).
  // v0.7: the dead leave carcasses — meat for the diet gene's new niche.
  // Scavenging, not predation: nobody hunts, but carnivores finally eat
  // at full value. Carcasses rot in 150s; they feed individuals, not the
  // population (the v0.5 nest-cache lesson, applied).
  const dead = [];
  for (let i = world.creatures.length - 1; i >= 0; i--) {
    if (!world.creatures[i].alive) dead.push(...world.creatures.splice(i, 1));
  }
  for (const d of dead) {
    addFood(world, d.x, d.platformIndex, 'meat', 1.2, 150);
  }
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
  // The canopy's ecology: fruit trees grow ON the branches (plants are
  // indexed by platform — a tree on branch 4 fruits on branch 4); medicinal
  // herbs are undergrowth on the forest floor.
  // v0.11 biomes: verdant valley is lush, the arid stretch is harsh (one
  // fruit tree, but extra medicinal herbs), the highland is moderate.
  addPlant(world, 200, 1); addPlant(world, 420, 1); // lower-left branch trees
  addPlant(world, 700, 2); // lower-mid
  addPlant(world, 1150, 3); addPlant(world, 1400, 3); // lower-right
  addPlant(world, 450, 4); addPlant(world, 900, 5); // mid branches
  addPlant(world, 1250, 6);
  addPlant(world, 600, 7); addPlant(world, 1050, 8); // upper branches
  // v0.8: medicinal herbs, on the forest floor where the sick descend.
  // v0.11: they thrive where food is scarcest.
  addHerb(world, 650, 0); addHerb(world, 950, 0); addHerb(world, 1300, 0);
  // Starter food: hang fruit in the branches so the first tanglekins don't
  // starve immediately.
  const branchIdx = [1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 8; i++) {
    const pi = branchIdx[i % branchIdx.length];
    const plat = world.platforms[pi];
    addFood(world, rng.range(plat.x1 + 40, plat.x2 - 40), pi, 'fruit', 1);
  }
  // Critters in the branches, a ball on the forest floor.
  for (let i = 0; i < 5; i++) addCritter(world, rng.range(100, 1500), 1 + rng.int(0, 5), 'bug');
  for (let i = 0; i < 3; i++) addCritter(world, rng.range(200, 1400), 4 + rng.int(0, 2), 'butterfly');
  addToy(world, 800, 0);
  // v0.9: pebbles scattered on the forest floor — the world as material.
  for (let i = 0; i < 8; i++) addPebble(world, rng.range(80, 1520), 0);
  // Four founder tanglekins with fresh random genomes, born in the lower
  // branches. (v0.5: was two. Two founders made every lineage a coin flip —
  // four founders (two breeding pairs) give the population the demographic
  // buffer it needs to survive drift.)
  const founders = [];
  const names = ['Pip', 'Moss'];
  // Founders start on adjacent lower branches where the climb links are —
  // 180px spacing keeps adjacent founders inside the 240px breeding-backstop
  // range but outside the 150px contagion range.
  const starts = [[400, 1], [580, 1], [760, 2], [940, 2]];
  for (let i = 0; i < 4; i++) {
    const [fx, fpi] = starts[i];
    const c = createCreature(randomGenome(rng), fx, fpi, rng,
      i < 2 ? { name: names[i] } : {});
    c.name = uniqueName(world, c.name);
    // Start them as juveniles so the player gets to know them.
    c.biochem.age = c.pheno.lifespanSec * 0.15;
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
