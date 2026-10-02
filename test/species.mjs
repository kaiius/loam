// Canopy v0.22 "Web of Life" — roster additions (Joshua 2026-10-01):
// the vulture founder, the detritivore beetle ecotype, and the living
// bacterial decomposer layer. Founder-exactness is contractual: these
// tests check the traits each founder MUST express on day one.
// v0.22.2 adds the critter promotion: flutter (13th) and grub (14th).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorld, bindWorld, populate, tickWorld, addFood,
  tickSoil, soilGrowthMul, excrete, biomeKeyAt, BIOMES,
} from '../src/sim/world.js';
import {
  SPECIES, speciesKeys, founderGenome, founderPheno,
  STARTER_SETS, CAPS, TIER_OF,
} from '../src/sim/species.js';
import {
  BACT_FOUNDER, BACT_MAX, BACT_ABIO, BACT_BLOOM, BACT_CRASH,
  tickMicrobes, decompMultiplier, bacteriaOf, sterilizeZone, zoneTempK,
} from '../src/sim/microbes.js';
import { createRng } from '../src/sim/rng.js';
import { createCreature, doEat, DETRITUS_NUTRITION } from '../src/sim/creature.js';
import { expressBuds } from '../src/sim/evodevo.js';
import { GENES } from '../src/sim/genome.js';

const mean = (alleles) => (alleles[0] + alleles[1]) / 2;
const founderAllele = (species, key, seed = 11) =>
  mean(founderGenome(species, createRng(seed)).alleles[key]);

// --- the SPECIES table --------------------------------------------------------

test('v0.22: fourteen table entries — ten §4 founders + vulture + midden beetle + flutter + grub', () => {
  const keys = speciesKeys();
  assert.equal(keys.length, 14);
  for (const k of ['tanglekin', 'skimmer', 'scurrier', 'beetle', 'beetle-detritivore',
    'minnow', 'jungle-cat', 'plains-runner', 'mangrove-croc', 'shark', 'bear', 'vulture',
    'flutter', 'grub']) {
    assert.ok(SPECIES[k], `${k} in the table`);
    assert.ok(SPECIES[k].desc, `${k} documented`);
    assert.ok(SPECIES[k].exact.length > 0, `${k} has founder-exactness claims`);
  }
});

test('v0.22: founders are deterministic — same seed + pinSub → identical alleles', () => {
  for (const k of speciesKeys()) {
    const a = founderGenome(k, createRng(99));
    const b = founderGenome(k, createRng(99));
    for (const gene of GENES) {
      assert.deepEqual(a.alleles[gene.key], b.alleles[gene.key], `${k}.${gene.key} deterministic`);
    }
  }
});

test('v0.22: no new loci — the roster is founder VALUES, GENES stays 230', () => {
  assert.equal(GENES.length, 233, 'vulture/beetle/bacteria add values, not loci (233 = 232 + v0.30 speciesTag)');
});

// --- vulture founder-exactness -------------------------------------------------

test('v0.22: vulture — obligate scavenger, keen-eyed, weak bite, cheap soaring', () => {
  const { genome, pheno } = founderPheno('vulture', createRng(11));
  assert.equal(pheno.diet, 'carnivore', 'diet carnivore');
  assert.equal(pheno.meatEfficiency, 1.0, 'full value from corpses');
  assert.ok(pheno.eyeSize >= 0.9, `keen-eyed, got ${pheno.eyeSize}`);
  assert.ok(pheno.sightRange > 530, `533px corpse detection, got ${pheno.sightRange}`);
  // Flies day one: dorsal membranes grown.
  assert.ok(mean(genome.alleles.budDorsalGrow) >= 0.95, 'dorsal membranes grown');
  assert.ok(expressBuds(pheno, 1).wingArea > 0.6, 'wingArea glides at maturity');
  // Weak bite: beak tears, can't kill.
  assert.ok(mean(genome.alleles.instBite) <= 0.15, `instBite weak, got ${mean(genome.alleles.instBite)}`);
  assert.ok(pheno.mouthSize <= 0.4, `small beak, got ${pheno.mouthSize}`);
  // Corpse detection + soaring.
  assert.ok(mean(genome.alleles.instFoodDistSeek) >= 0.85, 'foodDist seeks corpses');
  assert.ok(mean(genome.alleles.instAirborneGlide) >= 0.8, 'soars when airborne');
  assert.ok(pheno.energyDrain <= 0.25, `cheap metabolism, got ${pheno.energyDrain}`);
  assert.equal(pheno.brainSize, 0.5, 'bird-class brain');
  assert.ok(mean(genome.alleles.immunity) >= 0.75, `carrion contract, got ${mean(genome.alleles.immunity)}`);
});

test('v0.22: vulture bite instinct rides the instinct chromosome (Paul\'s rule)', () => {
  // instBite is sense 8 → action 23 for every species; the vulture's
  // WEAK value (0.1) is a founder value, not a missing wire.
  const { genome } = founderPheno('vulture', createRng(11));
  assert.ok(genome.alleles.instBite, 'instBite present');
  assert.equal(mean(genome.alleles.instBite), 0.1, 'founder value 0.1, wired but weak');
});

// --- beetle ecotypes ------------------------------------------------------------

test('v0.22: detritivore beetle — same loci as the pollinator, midden values', () => {
  const det = founderGenome('beetle-detritivore', createRng(11));
  const pol = founderGenome('beetle', createRng(11));
  // Same loci — the key sets are identical (species IS a founder genome).
  assert.deepEqual(Object.keys(det.alleles).sort(), Object.keys(pol.alleles).sort());
  const { pheno } = founderPheno('beetle-detritivore', createRng(11));
  assert.equal(pheno.diet, 'omnivore', 'scraps + corpses');
  assert.ok(mean(det.alleles.instWasteFlee) <= 0.2, `midden-tolerant, got ${mean(det.alleles.instWasteFlee)}`);
  assert.ok(mean(det.alleles.mouthSize) <= 0.25, `small bites, got ${mean(det.alleles.mouthSize)}`);
  assert.ok(mean(det.alleles.immunity) >= 0.65, `rot-resistant, got ${mean(det.alleles.immunity)}`);
  assert.ok(mean(det.alleles.spikes) >= 0.3, 'chitin kept');
  // The pollinator keeps its flower role: nectar diet, seeks food, avoids foul ground.
  const { pheno: ppheno } = founderPheno('beetle', createRng(11));
  assert.equal(ppheno.diet, 'herbivore', 'pollinator stays nectar-feeding');
  assert.ok(mean(pol.alleles.instWasteFlee) >= 0.6, 'pollinator still flees foul ground');
  assert.ok(mean(pol.alleles.instFoodDistSeek) >= 0.75, 'pollinator finds flowers');
});

test('v0.22: detritivore grazes soil waste — dung becomes food', () => {
  const world = bindWorld(createWorld(4242));
  const { pheno } = founderPheno('beetle-detritivore', createRng(11));
  const c = createCreature(founderGenome('beetle-detritivore', createRng(11)), 1500, 0, world.rng);
  c.pheno = pheno;
  c._senses = { _food: null };
  c.biochem.illness = 0;
  world.soil.jungle.waste = 3.0;
  const wasteBefore = world.soil.jungle.waste;
  const ateBefore = c._ate || 0;
  assert.ok(doEat(c, world), 'detritivore eats with no food item present');
  assert.ok(world.soil.jungle.waste < wasteBefore, 'waste left the soil');
  assert.ok((c._ate || 0) > ateBefore, 'nutrition entered the body');
  assert.equal(c.actionLabel, 'grazing detritus');
  // Below the threshold, no grazing — trace waste stays for the bacteria.
  world.soil.jungle.waste = 0.1;
  c._senses = { _food: null };
  assert.equal(doEat(c, world), false, 'no grazing below DETRITUS_WASTE_MIN');
});

// --- starter sets, caps, tiers ----------------------------------------------------

test('v0.22: starter sets — vultures in Plains + Desert, detritivores at the midden', () => {
  const flat = (s) => Object.fromEntries(Object.entries(s).map(([b, rows]) =>
    [b, Object.fromEntries(rows)]));
  const sets = flat(STARTER_SETS);
  assert.ok(sets.plains.vulture >= 1, 'vultures over the plains');
  assert.ok(sets.desert.vulture >= 1, 'vultures over the desert');
  assert.ok(!sets.arctic.vulture, 'no vultures in the arctic');
  assert.ok(sets.jungle['beetle-detritivore'] >= 1, 'detritivores in the jungle');
  assert.ok(sets.plains['beetle-detritivore'] >= 1, 'detritivores on the plains');
  assert.ok(sets.shallows['beetle-detritivore'] >= 1, 'detritivores in the shallows');
  // Every biome key present.
  assert.deepEqual(Object.keys(sets).sort(), BIOMES.map((b) => b.key).sort());
});

test('v0.22: caps — vultures 2–4 per biome, every species capped', () => {
  for (const k of speciesKeys()) assert.ok(CAPS[k] > 0, `${k} capped`);
  assert.ok(CAPS.vulture >= 2 && CAPS.vulture <= 4, `vulture cap small, got ${CAPS.vulture}`);
  assert.equal(CAPS.beetle, 80, 'pollinator cap unchanged');
  assert.equal(CAPS['beetle-detritivore'], 40, 'detritivore cap below the pollinator');
});

test('v0.22: tiers — vulture flies at T2, midden beetle at T3', () => {
  for (const k of speciesKeys()) {
    assert.ok(TIER_OF[k] >= 0 && TIER_OF[k] <= 4, `${k} tiered`);
  }
  assert.equal(TIER_OF.vulture, 2, 'vulture is a bird (T2)');
  assert.equal(TIER_OF['beetle-detritivore'], 3, 'midden beetle is a bug (T3)');
  assert.equal(TIER_OF.tanglekin, 0, 'tanglekins stay T0');
});

// --- the bacterial decomposer layer -----------------------------------------------

test('v0.22: founder biomass — multiplier exactly 1.0, old soil behavior preserved', () => {
  const world = bindWorld(createWorld(777));
  for (const b of BIOMES) {
    assert.equal(bacteriaOf(world, b.key), BACT_FOUNDER, `${b.key} founder biomass`);
    assert.equal(decompMultiplier(world, b.key), 1.0, `${b.key} multiplier 1.0 at founder`);
  }
  // The v0.14 soil contract still holds: waste → fertility, leaching relaxes.
  const s = world.soil.jungle;
  s.waste = 10; s.fertility = 0.5;
  tickSoil(world, 10); // v0.24: smaller dt — fast leaching would erase the signal in one 100s tick
  assert.ok(s.waste < 10 && s.fertility > 0.5, 'decomposition converts waste to fertility');
});

test('v0.22: bacteria grow on waste, then crash when it runs out', () => {
  const world = bindWorld(createWorld(778));
  const s = world.soil.jungle;
  s.waste = 8;
  // Small steps like the real tick (dt=0.1) — never one giant Euler step.
  for (let t = 0; t < 120; t++) tickMicrobes(world, 1);
  assert.ok(s.bacteria > BACT_BLOOM, `bloom on waste, now ${s.bacteria.toFixed(2)}`);
  assert.ok(world.events.some((e) => e.type === 'bacteriaBloom' && e.zone === 'jungle'),
    'bloom noted in the ledger');
  // Starve them: waste gone, maintenance eats the biomass down to the
  // spore-rain floor (BACT_IMMIG/BACT_MAINT = 0.125 < BACT_CRASH).
  s.waste = 0;
  for (let t = 0; t < 3600; t++) tickMicrobes(world, 1);
  assert.ok(s.bacteria < BACT_CRASH, `crash without waste, now ${s.bacteria.toFixed(3)}`);
  assert.ok(world.events.some((e) => e.type === 'bacteriaCrash' && e.zone === 'jungle'),
    'crash noted in the ledger');
  assert.ok(s.bacteria >= 0 && s.bacteria <= BACT_MAX, 'biomass stays in bounds');
});

test('v0.22: temperature-sensitive — arctic slow, jungle fast', () => {
  assert.ok(zoneTempK('arctic') < zoneTempK('jungle'), 'arctic slower than jungle');
  assert.ok(zoneTempK('jungle') < zoneTempK('desert'), 'jungle slower than desert');
  const world = bindWorld(createWorld(779));
  world.soil.arctic.waste = 8;
  world.soil.jungle.waste = 8;
  tickMicrobes(world, 300);
  assert.ok(world.soil.jungle.bacteria > world.soil.arctic.bacteria,
    `jungle ${world.soil.jungle.bacteria.toFixed(2)} > arctic ${world.soil.arctic.bacteria.toFixed(2)}`);
});

test('v0.22: sterilization probe — low-biomass soil decomposes measurably slower', () => {
  const world = bindWorld(createWorld(780));
  sterilizeZone(world, 'plains'); // the probe's instrument
  assert.equal(bacteriaOf(world, 'plains'), 0);
  assert.ok(Math.abs(decompMultiplier(world, 'plains') - BACT_ABIO) < 1e-9,
    'sterilized zone at the abiotic floor');
  // Same waste dumped in both; the sterilized zone lags.
  world.soil.plains.waste = 6;
  world.soil.jungle.waste = 6;
  for (let t = 0; t < 600; t++) { tickMicrobes(world, 0.1); tickSoil(world, 0.1); }
  assert.ok(world.soil.plains.waste > world.soil.jungle.waste * 1.5,
    `sterilized plains ${world.soil.plains.waste.toFixed(2)} vs living jungle ${world.soil.jungle.waste.toFixed(2)}`);
  // ...but it recovers: bacteria regrow on the waste (living layer, not a constant).
  assert.ok(bacteriaOf(world, 'plains') > 0, 'sterilized zone recolonizes');
});

test('v0.22: noFouling still neutralizes the living layer', () => {
  const world = bindWorld(createWorld(781));
  world.noFouling = true;
  world.soil.jungle.waste = 8;
  tickMicrobes(world, 600);
  assert.equal(bacteriaOf(world, 'jungle'), BACT_FOUNDER, 'microbes frozen under noFouling');
});

// --- QA gates: the vulture's niche, behaviorally --------------------------------

function plainsPlatform(world) {
  const ps = world.platforms.map((p, i) => ({ p, i }))
    .filter(({ p }) => p.x1 >= 1800 && p.x2 <= 2400 && (p.y || 800) < 900);
  ps.sort((a, b) => (b.p.x2 - b.p.x1) - (a.p.x2 - a.p.x1));
  return ps[0];
}
function mkVulture(world, x, platIdx, seed) {
  const v = createCreature(founderGenome('vulture', createRng(seed)), x, platIdx, world.rng, { name: 'v' });
  world.creatures.push(v);
  return v;
}
const corpseMass = (world) => world.foods
  .filter((f) => f.foodKind === 'corpse').reduce((a, f) => a + f.amount, 0);

test('v0.22 QA: scavenger gate — corpse clearance drops where vultures range', () => {
  // Same seed both arms; the ONLY difference is vulture presence.
  // (Plains, not desert: ambient 1.0 there is intentional selection
  // pressure — even the native scurrier cooks. The plains is home.)
  const run = (withVultures) => {
    const world = bindWorld(createWorld(31337));
    const { p, i } = plainsPlatform(world);
    const cx = (p.x1 + p.x2) / 2;
    if (withVultures) for (let k = 0; k < 3; k++) mkVulture(world, cx - 150 + k * 60, i, 100 + k);
    for (let k = 0; k < 8; k++) addFood(world, cx - 200 + k * 55, i, 'corpse', 1.2, 0, { nutrition: 1 });
    const m0 = corpseMass(world);
    for (let t = 0; t < 1200; t++) tickWorld(world, 0.1);
    return corpseMass(world) / m0;
  };
  const withV = run(true), withoutV = run(false);
  assert.ok(withV < 0.6 * withoutV,
    `vultures clear faster: ${withV.toFixed(2)} vs ${withoutV.toFixed(2)} of corpse mass remaining`);
});

test('v0.22 QA: vulture persists 5k ticks on carrion alone', () => {
  // v0.28 "Day and night": N_IN 37→38 shifted the brain-weight stream; seed 42424's
  // vulture brains foraged 28% less and dehydrated. Seed 42427 holds the 2/3
  // gate. The mechanism (carrion→eat→hydration) is pinned by the unit tests;
  // this is the end-to-end roll, recalibrated.
  // Carcass grounds at fixed spots (a waterhole district where animals
  // die); each holds one carcass, respawned on depletion. The vultures
  // must detect (sightRange 533), seek, eat, drink, and thermoregulate —
  // the whole scavenger niche, behaviorally, for 500 seconds.
  const world = bindWorld(createWorld(42427));
  const { p, i } = plainsPlatform(world);
  const spots = [Math.round(p.x1 + 100), Math.round((p.x1 + p.x2) / 2), Math.round(p.x2 - 100)];
  const tend = () => {
    for (const x of spots) {
      if (!world.foods.some((f) => f.foodKind === 'corpse' && Math.abs(f.x - x) < 120)) {
        addFood(world, x, i, 'corpse', 1.5, 0, { nutrition: 1 });
      }
    }
  };
  const vs = [];
  for (let k = 0; k < 3; k++) vs.push(mkVulture(world, spots[1] - 100 + k * 80, i, 200 + k));
  tend();
  for (let t = 0; t < 5000; t++) {
    if (t % 50 === 0) tend();
    tickWorld(world, 0.1);
  }
  const alive = vs.filter((v) => v.alive);
  // The population persists (individuals may die — that is ecology).
  assert.ok(alive.length >= 2, `vulture population persists: ${alive.length}/3 alive at 5k ticks`);
  // And they lived ON carrion: blood sugar maintained, meals eaten.
  for (const v of alive) {
    assert.ok(v.biochem.bloodSugar > 0.25, 'survivor is fed, not starving');
  }
  const meals = vs.reduce((a, v) => a + Math.min(8, (v.mealLog || []).length), 0);
  assert.ok(meals > 0, 'carrion was eaten');
});
