// Canopy v0.22 "Web of Life": the SPECIES table.
//
// A species IS a founder genome: the same 228 loci as every tanglekin,
// different founder values. The engine never branches on species — no
// species labels in any sense vector (the §9.4 grep gate), no scripted
// behavior, no physics exemptions. Ranges are physiological, never
// geographical: a vulture ranges widely because its wings and eyes let
// it, not because a tag says it may.
//
// Ten founders follow ECOLOGY_DESIGN.md §4 (tanglekins + four prey classes
// + five predators). Joshua's roster additions:
//   - vulture ("soarer"), the 11th founder: obligate scavenger
//   - beetle-detritivore ("midden beetle"): the beetle's second ecotype —
//     same loci, different founder values; the pollinator keeps flowers,
//     the detritivore gets the waste.
//   - v0.22.2: flutter (13th) and grub (14th) — the legacy scripted
//     critters (butterfly, bug) promoted to full founder creatures on the
//     one engine. The old critter path is retired entirely.
//
// Founder-exactness is contractual: each entry documents the traits the
// founder MUST express on day one (wings grown, fur maxed, gills grown),
// and test/species.mjs checks them. A founder that can't fly on day one
// is a broken promise, not a tuning issue.

import { randomGenome, phenotype } from './genome.js';

// pinSub salts: distinct per species so the pinned sub-stream alleles
// (language, evo-devo, realms, hands, web-of-life) differ per founder
// while staying deterministic per species.
const PIN = {
  tanglekin: 1, skimmer: 2, scurrier: 3, beetle: 4, 'beetle-detritivore': 5,
  minnow: 6, 'jungle-cat': 7, 'plains-runner': 8, 'mangrove-croc': 9,
  shark: 10, bear: 11, vulture: 12,
  flutter: 13, grub: 14, // v0.22.2 — the promoted critters
};

// Diet choice indices: ['herbivore', 'omnivore', 'carnivore'].
// Bud types: ['grasp', 'membrane', 'sail', 'gill', 'fin'].
const HERB = 0, OMNI = 1, CARN = 2;
const GRASP = 0, MEMBRANE = 1, GILL = 3, FIN = 4;

export const SPECIES = {
  // -- the tanglekin: the existing founder, untouched -----------------------
  tanglekin: {
    name: 'tanglekin', tier: 0, cap: 24,
    desc: 'The original founder. Monkey-like, prehensile tail, genome-driven art.',
    overrides: { instBite: 0.02 }, // dormant — the way swim shipped
    exact: ['instBite dormant at 0.02'],
  },

  // -- prey classes ----------------------------------------------------------
  skimmer: {
    name: 'skimmer', tier: 2, cap: 12,
    desc: 'Bird founder ("skimmer"). Dorsal membranes grown — flies day one. Frugivore learner, insect opportunist.',
    overrides: {
      brainSize: 0.5, size: 0.25, eyeSize: 0.7,
      budDorsalGrow: 1, budDorsalType: MEMBRANE, budDorsalPow: 0.7,
      budShoulderGrow: 0.6, budShoulderType: GRASP, // grasp feet
      diet: OMNI, instBite: 0.05, mouthSize: 0.3,
      instFoodDistSeek: 0.7, instAirborneGlide: 0.7,
      energyDrain: 0.35, curiosity: 0.6,
    },
    exact: ['dorsal membranes grown (wingArea > 0.6 at maturity)', 'diet omnivore', 'instBite 0.05'],
  },
  scurrier: {
    name: 'scurrier', tier: 2, cap: 16,
    desc: 'Small-mammal founder ("scurrier"). Tanglekin-like, small, no tail-grip; burrower.',
    overrides: {
      brainSize: 0.4, size: 0.3, fur: 0.6,
      instDig: 0.4, instBite: 0.03, diet: OMNI,
      legPower: 0.5, eyeSize: 0.55,
    },
    exact: ['instDig 0.4 (burrower)', 'diet omnivore'],
  },
  beetle: {
    name: 'beetle', tier: 3, cap: 80,
    desc: 'Bug founder — the POLLINATOR ecotype. Tiny, chitin-armored, nectar-feeding; finds flowers by foodDist.',
    overrides: {
      brainSize: 0.15, size: 0.12, spikes: 0.3,
      diet: HERB, mouthSize: 0.2, eyeSize: 0.4,
      instFoodDistSeek: 0.8, curiosity: 0.65,
      // eat/mate/flee only: the social/vocal instincts stay at default-dormant.
    },
    exact: ['diet herbivore (nectar)', 'size ≤ 0.15', 'spikes 0.3 (chitin)', 'instFoodDistSeek 0.8 (finds flowers)'],
  },
  'beetle-detritivore': {
    name: 'midden beetle', tier: 3, cap: 40,
    desc: 'Bug founder — the DETRITIVORE ecotype (v0.22 roster addition). Same 228 loci as the pollinator, different founder values: eats scraps, dung (soil-waste grazing), and corpses in small bites. Tolerates foul ground (instWasteFlee low), armored against rot (immunity up).',
    overrides: {
      brainSize: 0.15, size: 0.13, spikes: 0.35,
      diet: OMNI, mouthSize: 0.18, eyeSize: 0.4,
      instFoodDistSeek: 0.75, curiosity: 0.5,
      instWasteFlee: 0.15, // does NOT flee the midden — it lives there
      immunity: 0.7, // eats rot; needs the resistance
    },
    exact: ['diet omnivore (scraps + corpses)', 'instWasteFlee 0.15 (midden-tolerant)', 'mouthSize 0.18 (small bites)', 'immunity 0.7'],
  },
  minnow: {
    name: 'minnow', tier: 3, cap: 40,
    desc: 'Fish founder. Fin buds grown, gill buds grown at the neck; plankton eater.',
    overrides: {
      brainSize: 0.15, size: 0.15,
      budNeckGrow: 1, budNeckType: GILL,
      budMidGrow: 1, budMidType: FIN,
      diet: HERB, instBite: 0.0, mouthSize: 0.15,
      instSubmergedSwim: 0.8,
    },
    exact: ['gillArea > 0 (neck gills)', 'finArea > 0', 'instBite 0.0 (plankton)'],
  },

  // -- predators --------------------------------------------------------------
  'jungle-cat': {
    name: 'jungle cat', tier: 1, cap: 2,
    desc: 'Big-cat founder. Large mass, grasp limbs, high mouthSize; stalks via approach+hunger.',
    overrides: {
      brainSize: 0.7, size: 0.8, mouthSize: 0.9,
      budShoulderGrow: 0.8, budShoulderType: GRASP,
      diet: CARN, instBite: 0.8, instHungerBite: 1.0, eyeSize: 0.75, legPower: 0.6,
    },
    exact: ['diet carnivore', 'instBite 0.8', 'mouthSize 0.9'],
  },
  'plains-runner': {
    name: 'plains runner', tier: 1, cap: 3,
    desc: 'Pack-hunter founder. Large, cursorial (leg bias), social instincts up — pack = bonds.',
    overrides: {
      brainSize: 0.75, size: 0.75, legLength: 0.85, legPower: 0.8,
      diet: CARN, instBite: 0.85, instHungerBite: 1.0, mouthSize: 0.8,
      sociability: 0.8, curiosity: 0.5,
    },
    exact: ['diet carnivore', 'instBite 0.85', 'sociability 0.8 (pack)'],
  },
  'mangrove-croc': {
    name: 'mangrove croc', tier: 1, cap: 1,
    desc: 'Ambush-wader founder. Large; fin/grasp mix; gill buds partial (holds breath long); stillness — low wander.',
    overrides: {
      brainSize: 0.6, size: 0.85, mouthSize: 0.9,
      budNeckGrow: 0.5, budNeckType: GILL,
      budMidGrow: 0.7, budMidType: FIN,
      budShoulderGrow: 0.6, budShoulderType: GRASP,
      diet: CARN, instBite: 0.9, instHungerBite: 1.0, curiosity: 0.1,
    },
    exact: ['diet carnivore', 'instBite 0.9', 'curiosity 0.1 (stillness)'],
  },
  shark: {
    name: 'shark', tier: 1, cap: 3,
    desc: 'Shark founder. Fin buds grown, gill buds grown, bodySegs 2; obligate aquatic (§10). Promoted from the scripted tickPredators path — now a founder genome like everything else.',
    overrides: {
      brainSize: 0.65, size: 0.8, mouthSize: 0.9,
      budNeckGrow: 1, budNeckType: GILL,
      budMidGrow: 1, budMidType: FIN,
      segCount: 1, // bodySegs = 1 + segCount = 2
      diet: CARN, instBite: 0.9, instHungerBite: 1.0, eyeSize: 0.7,
    },
    exact: ['gillArea > 0', 'finArea > 0', 'bodySegs 2', 'instBite 0.9'],
  },
  bear: {
    name: 'bear', tier: 1, cap: 2,
    desc: 'Bear founder. Large mass; FUR MAXED (the §10 physiological extreme); high mouthSize. Promoted from the scripted tickPredators path.',
    overrides: {
      brainSize: 0.6, size: 0.9, fur: 1.0,
      mouthSize: 0.85, diet: OMNI,
      instBite: 0.8, instHungerBite: 1.0, instDig: 0.3, legPower: 0.55,
    },
    exact: ['fur 1.0 (maxed)', 'instBite 0.8', 'diet omnivore'],
  },

  // -- Joshua's 2026-10-01 roster addition ------------------------------------
  vulture: {
    name: 'soarer', tier: 2, cap: 3,
    desc: 'Vulture founder ("soarer") — the 11th founder. Obligate scavenger: bird body plan (dorsal membranes, flies day one), large, keen-eyed (eyeSize 0.95 → 533px sight). Corpses are food and foodDist covers them; instFoodDistSeek 0.9 is the long-range corpse detection. diet carnivore → meatEfficiency 1.0 on corpses. Weak bite (instBite 0.1, beak mouthSize 0.35 — tears, can\'t kill). Soaring: instAirborneGlide 0.85 + energyDrain 0.2 (cheap metabolism = cheap flight). Lives off corpses alone.',
    overrides: {
      brainSize: 0.5, size: 0.65, eyeSize: 0.95,
      budDorsalGrow: 1, budDorsalType: MEMBRANE, budDorsalPow: 0.8,
      budShoulderGrow: 0.5, budShoulderType: GRASP, // feet
      diet: CARN, mouthSize: 0.35, instBite: 0.1,
      instFoodDistSeek: 0.9, instAirborneGlide: 0.85,
      energyDrain: 0.2, curiosity: 0.7, legPower: 0.3,
      fur: 0.2, lifespan: 0.7,
      // Thermal: a desert/plains scavenger needs the scurrier's heat
      // tolerance or better (real vultures are desert birds — urohidrosis,
      // soaring in thermals). The random draw gave 0.31; the niche needs it
      // pinned high, like the midden beetle's pinned immunity.
      heatTol: 0.8,
      // The carrion contract: stomach acid like battery acid (real vultures
      // shrug off anthrax and botulism) — high immunity is the specialist's
      // license to eat rot. Same logic as the midden beetle's 0.7.
      immunity: 0.8,
      // Water: a desert carnivore can't get hydration from fruit (the
      // jungle founders' free water source). The drink instincts exist but
      // ship dormant (founder 0); the vulture's niche requires them live —
      // thirst (sense 28) and water in sight (sense 27) both drive drink.
      instThirstDrink: 0.85, instWaterDrink: 0.7,
    },
    exact: [
      'diet carnivore (meatEfficiency 1.0 on corpses)',
      'eyeSize 0.95 → sightRange ≈ 533',
      'dorsal membranes grown (flies day one)',
      'instBite 0.1 (weak — cannot kill)',
      'instFoodDistSeek 0.9 (corpse detection)',
      'energyDrain 0.2 (cheap soaring)',
      'immunity 0.8 (the carrion contract)',
      'instThirstDrink 0.85 + instWaterDrink 0.7 (a desert carnivore drinks)',
      'heatTol 0.8 (desert bird — the scurrier\'s tolerance or better)',
    ],
  },
  flutter: { // v0.22.2 — the butterfly, promoted to a full creature.
    name: 'flutter', tier: 3, cap: 30,
    desc: 'Butterfly lineage, promoted off the scripted critter path. ' +
      'Day-one flyer; pollinates the canopy — visits carry pollen between ' +
      'flowers, and fruit set rises with pollination. Soft-bodied: the ' +
      'prey of small hunters, the way the old bug-critter was prey of nothing.',
    overrides: {
      brainSize: 0.15, size: 0.12, bodyHue: 0.92, // pink — the legacy butterfly's wings
      budDorsalGrow: 1, budDorsalType: MEMBRANE, budDorsalPow: 0.85, // wings on day one; adults clear the glide gate
      diet: HERB, // nectar
      mouthSize: 0.15, eyeSize: 0.5, // sips, doesn't bite
      instFoodDistSeek: 0.85, // finds flowers
      instAirborneGlide: 0.6, // fluttery flight, not soaring
      instFearFlee: 0.9, // the prey strategy: leave
      spikes: 0, // soft — no armor
      energyDrain: 0.3, curiosity: 0.7,
    },
    exact: ['dorsal membranes grown day one (budDorsalGrow 1)',
      'diet herbivore (nectar-feeding)',
      'pink hue (bodyHue ~0.92) — the old butterfly, recognizable',
      'instFearFlee 0.9, spikes 0 (soft-bodied prey)',
      'pollinates: winged + tiny, carries pollen flower to flower'],
  },
  grub: { // v0.22.2 — the bug, promoted to a full creature.
    name: 'grub', tier: 3, cap: 40,
    desc: 'Bug lineage, promoted off the scripted critter path. The prey ' +
      'base: soft, fearful, everywhere — grazes detritus on the forest ' +
      'floor and feeds everything that bites.',
    overrides: {
      brainSize: 0.12, size: 0.1, bodyHue: 0.05, // dark — the legacy bug's shell
      diet: OMNI, // detritus + scraps
      mouthSize: 0.12, eyeSize: 0.3,
      instFoodDistSeek: 0.6,
      instFearFlee: 1.0, // the whole strategy is fleeing
      spikes: 0, // soft — edible
      legPower: 0.4, energyDrain: 0.25, curiosity: 0.3, immunity: 0.3,
    },
    exact: ['diet omnivore (detritus grazer)',
      'instFearFlee 1.0 — the prey strategy',
      'spikes 0, size ≤ 0.12 (soft and edible)',
      'dark hue (bodyHue ~0.05) — the old bug, recognizable'],
  },
};

// The founder genome: same loci, pinned sub-streams, overridden values.
// rng supplies the main-stream draws; pinSub fixes the sub-stream passes
// per species (deterministic founders, distinct across species).
export function founderGenome(speciesKey, rng, pinSub) {
  const sp = SPECIES[speciesKey];
  if (!sp) throw new Error(`unknown species: ${speciesKey}`);
  return randomGenome(rng, {
    pinSub: pinSub !== undefined ? pinSub : PIN[speciesKey],
    overrides: sp.overrides,
  });
}

// Convenience for founder-exactness checks: genome + phenotype together.
export function founderPheno(speciesKey, rng, pinSub) {
  const genome = founderGenome(speciesKey, rng, pinSub);
  return { genome, pheno: phenotype(genome) };
}

export function speciesKeys() {
  return Object.keys(SPECIES);
}

// v0.22.2 — phenotypic signature of the promoted critter lineages (flutter,
// grub): tiny + pink, or tinier + dark. Size and hue, never a species label —
// the engine doesn't branch on species, and neither do the tests. Used to
// separate the 14 promoted founders from the 8 GENESIS_COHORTS.
export function isPromotedLineage(c) {
  const ph = c.pheno || {};
  return (ph.size <= 0.15 && (ph.bodyHue || 0) > 0.85) ||
    (ph.size <= 0.12 && (ph.bodyHue || 0) < 0.15);
}

export function tierOf(speciesKey) {
  return SPECIES[speciesKey].tier;
}

// --- per-biome starter sets (§4.1 + the v0.22 roster additions) ---------------
// Vultures join Plains (2) and Desert (1): open sky, thermals, carcasses.
// Detritivore beetles seed everywhere waste concentrates (jungle, plains,
// shallows) — small numbers; the midden fills in.
export const STARTER_SETS = {
  arctic: [['scurrier', 6], ['bear', 1]],
  mountains: [['beetle', 8], ['scurrier', 4], ['skimmer', 4]],
  jungle: [['beetle', 10], ['beetle-detritivore', 5], ['scurrier', 6], ['skimmer', 4], ['jungle-cat', 1], ['flutter', 6], ['grub', 6]],
  plains: [['beetle', 10], ['beetle-detritivore', 5], ['scurrier', 6], ['skimmer', 6], ['plains-runner', 2], ['vulture', 2], ['grub', 8], ['flutter', 4]],
  desert: [['beetle', 6], ['scurrier', 4], ['skimmer', 4], ['vulture', 1]],
  shallows: [['beetle', 6], ['beetle-detritivore', 4], ['minnow', 10], ['skimmer', 4], ['scurrier', 4], ['mangrove-croc', 1]],
  archipelago: [['beetle', 6], ['minnow', 8], ['skimmer', 6], ['scurrier', 4]],
  deep: [['minnow', 12], ['shark', 2]],
};

// --- population caps per species per biome (§12.3 + vulture 2–4) --------------
// Enforced by carrying capacity, not culling (the conservation law polices).
export const CAPS = {
  tanglekin: 24,
  'jungle-cat': 2, 'plains-runner': 3, 'mangrove-croc': 1, shark: 3, bear: 2,
  vulture: 3,
  skimmer: 12, scurrier: 16,
  beetle: 80, 'beetle-detritivore': 40, minnow: 40,
  flutter: 30, grub: 40, // v0.22.2 — the promoted critters
};

// --- brain tiers (§12.2) ------------------------------------------------------
// T0 tanglekins full rate; T1 predators full-when-motivated/half idle;
// T2 birds + small mammals half; T3 bugs + minnows quarter; T4 flora 1/10.
// The vulture is a bird (T2) despite its size — soaring search is cheap;
// the midden beetle is a bug (T3).
export const TIER_OF = Object.fromEntries(
  Object.entries(SPECIES).map(([k, sp]) => [k, sp.tier]),
);
