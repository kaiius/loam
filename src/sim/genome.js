// Digital DNA for Canopy tanglekins: diploid genome, inheritance with
// CHROMOSOMAL meiosis + epigenetics, and phenotype expression.
//
// v0.12: 43 loci (Wildcode v0.12's 37 — incl. the sense→action instinct
// genes, morphology, tradition fidelity — plus 6 canopy genes:
// instClimbUp, instClimbDown, instLonelyGroom, instJump, legPower,
// brainSize).
//
// GENOME v2 (2026-09-29): 45 multi-parameter genes across 9 functional
// families, appended AFTER locus 43 — the original 43 keep their indices,
// append-only. 132 new loci → 175 total. Every new locus is wired into the
// tick or the render (no decorative genes):
//   R — reactions ×8: evolvable chemistry (substrate→product, mass-conserving)
//   C — receptors ×6: chemical levels modulate senses
//   E — emitters ×6: firing an action releases a chemical pulse
//   B — brain architecture ×4: layers, sparsity, Hebbian rate, inhibition,
//       attention gates, eligibility traces, neuromodulation of learning
//   L — life history ×4: longevity, maturation, fertility, senescence
//   M — morphology ×8: bulk, tail, regional pigmentation, ears, arms
//   S — stimulus valence ×4: evolvable valence for world events
//   D — drive tuning ×5: gain + baseline on the chemical→drive readout
// (the 9th family is the original 43: instincts, senses, metabolism, form.)
//
// New allele kind 'sym': signed [-1,1] for gains and valences.
//
// The machinery is Emberhollow's: chromosomes, meiosis with 1–3 crossovers
// per chromosome (linked genes travel together; distant genes assort),
// mutation at 0.008 per allele (5% large-effect re-roll, else small Gaussian
// step), and epigenetic marks that scale expression 0.5×–1.5× and fade
// across generations. Linked inheritance is what makes lineages legible:
// a chromosome is a story, not a bag of alleles.

import { createRng } from './rng.js';
import { budPotentials } from './evodevo.js';
import { gateMultiplier, hasActiveGates } from './gates.js';
// Re-export: genome.js was the historical home of the gate functions and
// test/sim.mjs (and any other consumer) imports them from here. The move
// to gates.js broke the export surface without breaking any import —
// the file-level sim.mjs failure masked 25 subtests. Keep the surface.
export { gateMultiplier, hasActiveGates };

export const GENES = [
  // appearance
  { key: 'bodyHue', kind: 'float' },
  { key: 'patternDensity', kind: 'float' },
  { key: 'size', kind: 'float' },
  { key: 'tailLength', kind: 'float' },
  { key: 'eyeSize', kind: 'float', founder: 0.6 }, // bigger eyes, farther sight
  { key: 'pattern', kind: 'choice', choices: ['plain', 'spots', 'stripes'] },
  { key: 'earShape', kind: 'choice', choices: ['round', 'pointy', 'floppy'] },
  // metabolism
  { key: 'hungerRate', kind: 'float' },
  { key: 'energyDrain', kind: 'float' },
  { key: 'lifespan', kind: 'float' },
  { key: 'growthRate', kind: 'float' },
  { key: 'fertility', kind: 'float' },
  { key: 'immunity', kind: 'float' }, // disease resistance + recovery speed
  // mind
  { key: 'learningRate', kind: 'float' },
  { key: 'curiosity', kind: 'float' },
  { key: 'sociability', kind: 'float' },
  { key: 'boldness', kind: 'float' },
  { key: 'memory', kind: 'float' }, // episodic memory capacity (16–64)
  // brainSize is an UNBOUNDED locus (kind 'exp'): a positive multiplier with
  // no ceiling. Associative-layer neurons = 100 × expressed value, so the
  // founder 8.0 gives ~800 — emberling scale — and mutation + selection can
  // drive it upward forever. There is deliberately no cap: brains may evolve
  // endlessly. (The practical cost is compute per tick, which grows linearly
  // with neuron count — a tradeoff the lineage itself will negotiate.)
  { key: 'brainSize', kind: 'exp', founder: 8.0 },
  // instincts — evolvable sense→action reflex weights. `sense`/`action` index
  // into the brain's sense vector / action list; `founder` biases gen-0.
  { key: 'instHungerSeek', kind: 'float', sense: 0, action: 0, founder: 0.8 },
  { key: 'instHungerEat', kind: 'float', sense: 0, action: 1, founder: 0.8 },
  { key: 'instTiredSleep', kind: 'float', sense: 1, action: 2, founder: 0.8 },
  { key: 'instBoredPlay', kind: 'float', sense: 2, action: 3, founder: 0.8 },
  { key: 'instLonelyApproach', kind: 'float', sense: 3, action: 4, founder: 0.8 },
  { key: 'instFearFlee', kind: 'float', sense: 4, action: 5, founder: 0.8 },
  { key: 'instLightSleep', kind: 'float', sense: 5, action: 2, founder: 0.15 },
  { key: 'instFoodDistSeek', kind: 'float', sense: 6, action: 0, founder: 0.8 },
  { key: 'instCreatureDistApproach', kind: 'float', sense: 8, action: 4, founder: 0.2 },
  { key: 'instToyDistPlay', kind: 'float', sense: 10, action: 3, founder: 0.8 },
  { key: 'instLonelyMate', kind: 'float', sense: 3, action: 6, founder: 0.8 },
  { key: 'instIllnessSeek', kind: 'float', sense: 13, action: 0, founder: 0.5 },
  { key: 'instHomeSeek', kind: 'float', sense: 14, action: 8, founder: 0.5 },
  // canopy instincts (new): climb links above/below (senses 17/18)
  // drive the climb action (9). Same v0.5 precedent: an action with no
  // instinct pathway is never tried and never learned.
  { key: 'instClimbUp', kind: 'float', sense: 17, action: 9, founder: 0.5 },
  { key: 'instClimbDown', kind: 'float', sense: 18, action: 9, founder: 0.5 },
  // social grooming (new): loneliness drives grooming (action 10), the
  // troop's bonding ritual. Grooming builds bonds and oxytocin.
  { key: 'instLonelyGroom', kind: 'float', sense: 3, action: 10, founder: 0.6 },
  // physics (new): a jumpable ledge nearby (sense 21) drives the jump
  // action (11). Same v0.5 precedent: an action with no instinct pathway
  // is never tried and never learned.
  { key: 'instJump', kind: 'float', sense: 20, action: 11, founder: 0.5 },
  // morphology — body parts with stat tradeoffs. What you see IS the DNA.
  { key: 'diet', kind: 'choice', choices: ['herbivore', 'omnivore', 'carnivore'], founder: 0 },
  { key: 'mouthSize', kind: 'float', founder: 0.5 },
  { key: 'legLength', kind: 'float', founder: 0.5 },
  { key: 'legPower', kind: 'float', founder: 0.4 }, // jump impulse — how hard the legs launch. v0.17: 0.5 → 0.4 (via 0.3 — 0.3 flipped seeds 4/7/99 through illness from floor-foraging; 0.4 is the middle path); selection re-strengthens them.
  { key: 'spikes', kind: 'float', founder: 0.2 },
  { key: 'fur', kind: 'float', founder: 0.5 },
  // tradition — fidelity of cultural transmission.
  { key: 'tradition', kind: 'float', founder: 0.5 },
];

// === GENOME v2 (2026-09-29): 45 multi-parameter genes, 132 loci =========
// Append-only: everything below is new. The original 43 loci keep their
// indices. Choice vocabularies shared by the families:
export const CHEM5 = ['bloodSugar', 'fatigue', 'oxytocin', 'endorphin', 'adrenaline'];
// v0.18 "Realms": oxygen (drowning) and hydration (thirst) join the
// chemistry. Old indices 0–4 keep their meaning — append-only.
export const CHEM7 = [...CHEM5, 'oxygen', 'hydration'];
// The 32 real senses (bias excluded) — mirrors brain.js senseVector order.
// Append-only: a new sense goes at the END, never renumbered, so old
// brains and old saved genomes keep their meaning.
// v0.17 "Bauplan": airborne 24 (off the branch — the glide verb's reader),
// farLedge 25 (a ledge within glide range but beyond jump range),
// submerged 26, waterNear 27. The water senses read 0 until v0.18 brings
// water — the sense exists and works; the world just lacks water.
// v0.18 "Realms": thirst 28 (1 − hydration — the felt sense of the new
// chemical), cold 29, heat 30 (body-state readers, not drives), buriedNear
// 31 (scent of buried food — the dig verb's reader).
// v0.20 "Hands": objectNear 32 (a manipulable object within grasp reach —
// the grasp verb's reader), heldWeight 33 (0 empty-handed, else the
// carried object's weight — the put-down reflex's reader).
export const SENSE32 = [
  'hunger', 'tiredness', 'boredom', 'loneliness', 'fear', 'light',
  'foodDist', 'foodDir', 'creatureDist', 'creatureDir', 'toyDist', 'toyDir',
  'isAdult', 'illness', 'homeDist', 'kinNear', 'bondNear',
  'climbUp', 'climbDown', 'groomNear', 'jumpNear',
  'callHeard', 'callPitch',
  'wasteOdor', // v0.14: disgust — the smell of fouled ground
  'airborne', 'farLedge', 'submerged', 'waterNear', // v0.17: the body-plan senses
  'thirst', 'cold', 'heat', 'buriedNear', // v0.18: the realms senses
  'objectNear', 'heldWeight', // v0.20: the hands senses
  'falling', // v0.20 "Falling": the vestibular sense — appended, never renumbered
  'creatureSize', // v0.22 "Web of Life": relative body mass of the nearest
  // creature (−1..1, no identity — the tick never tells anyone who's who)
  'phaseSleepiness', // v0.28 "Day and night": how strongly the body wants
  // sleep RIGHT NOW given the light and its own activityPhase — appended,
  // never renumbered
  'pain', // v0.32 "Nervous system": nociception — recent injury, decaying —
  // appended, never renumbered
  'libido', // v0.37 "Affect": the felt need for mating (sexHormone readout)
  'curiosity', // v0.37: the felt need for novelty (stimulus readout)
  'attachment', // v0.37: longing for the pair-bonded partner (vasopressin × absence)
  'care', // v0.37: the need to tend young (prolactin × offspring need)
  'pairNear', // v0.37: pair-bond strength with the nearest creature (0 if none)
];
// The pre-v0.17 vocabulary — family-C genes name senses against these
// indices, which are never renumbered.
export const SENSE24 = SENSE32.slice(0, 24);
export const ACT20 = [
  'seekFood', 'eat', 'sleep', 'play', 'approach', 'flee',
  'mate', 'wander', 'seekHome', 'climb', 'groom', 'jump', 'vocal',
  'glide', 'brachiate', 'swim', 'dive', // v0.17: the dormant verbs
  'drink', 'bask', 'dig', // v0.18: water, warmth, earth — wired by the realms pass
  'grasp', 'carry', 'drop', // v0.20: the hands verbs (name ACT20 is historical)
  'bite', // v0.22 "Web of Life": the attack verb — ordinary machinery, not a
  // predator system. Strike range, damage = f(mouthSize × mass) vs spikeArmor,
  // fatigue-billed, spike retaliation. Predators hunt on day one because their
  // founders say so; if a tanglekin lineage turns violent, that's their
  // evolution raising a dormant instinct — we built the door, both ways.
];
// The pre-v0.17 vocabulary — family-E genes name actions against these
// indices, which are never renumbered.
export const ACT13 = ACT20.slice(0, 13);
// Stimulus events that actually occur in the tick (rain/thunder were cut —
// Canopy has no weather; fed-by-other was cut — no food-sharing mechanic).
export const STIM4 = ['groomed', 'petted', 'scolded', 'hardLanding'];
export const PIGPAT = ['none', 'spots', 'stripes'];

const _f = (key, founder) => ({ key, kind: 'float', founder });
const _s = (key, founder) => ({ key, kind: 'sym', founder });
const _c = (key, choices, founder) => ({ key, kind: 'choice', choices, founder });

// --- Family R: chemical reactions ×8 (chr 6) ------------------------------
// Each gene converts substrate→product above a threshold at a rate.
// Founder rates are near-zero: quiet chemistry evolution can turn up.
// Mass-conserving by construction (see tickBiochem).
{
  const sub = [0, 1, 2, 3, 4, 0, 1, 2];
  const prod = [1, 2, 3, 4, 0, 2, 3, 4];
  for (let i = 0; i < 8; i++) {
    GENES.push(_c(`rx${i}sub`, CHEM7, sub[i]), _c(`rx${i}prod`, CHEM7, prod[i]),
      _f(`rx${i}rate`, 0.03), _f(`rx${i}thr`, 0.5));
  }
}
// --- Family C: receptors ×6 (chr 5) --------------------------------------
// Chemical levels modulate senses: sense += gain × max(0, chem − thr).
// Founder gains are 0: silent by default, evolvable.
{
  const senses = [0, 3, 1, 4, 13, 2]; // hunger, loneliness, tiredness, fear, illness, boredom
  for (let i = 0; i < 6; i++) {
    GENES.push(_c(`rc${i}chem`, CHEM7, i % 5), _c(`rc${i}sense`, SENSE24, senses[i]),
      _s(`rc${i}gain`, 0), _f(`rc${i}thr`, 0.5));
  }
}
// --- Family E: emitters ×6 (chr 6) ---------------------------------------
// Firing the trigger action releases a pulse of the chemical.
// Founder amounts are small nudges, not floods.
{
  const trig = [1, 2, 3, 10, 5, 6]; // eat, sleep, play, groom, flee, mate
  for (let i = 0; i < 6; i++) {
    GENES.push(_c(`em${i}trig`, ACT13, trig[i]), _c(`em${i}chem`, CHEM7, (i * 2) % 5),
      _f(`em${i}amt`, 0.05));
  }
}
// --- Family B: brain architecture ×4 (chr 3) ------------------------------
GENES.push(
  // brainPlan: how the brainSize neuron budget is organized.
  _c('bpLayers', [1, 2, 3], 0), // hidden layers splitting the budget (founder: 1 = classic)
  _f('bpSparsity', 0.65), // 1 − density of sensory→assoc wiring (founder → 0.35, as before)
  _f('bpHebb', 0.5), // Hebbian rate multiplier (founder → ×1.0)
  _f('bpLatInhib', 0.85), // lateral inhibition: loser scale = 1 − value (founder → 0.15, as before)
  // attenGate: evolvable attention gates on the salience EMA.
  _f('agCount', 0), // how many senses get gated (×5, founder → 0 = off)
  _f('agGain', 0), // gain boost on gated senses (founder → none)
  _f('agThresh', 0.5), // minimum salience to earn a gate
  // memoryTrace: eligibility traces for delayed credit assignment.
  _f('mtDecay', 0.9), // trace decay per learn
  _f('mtGain', 0), // trace contribution to weight updates (founder → off)
  // neuroMod: a chemical level modulates the learning rate.
  _c('nmChem', CHEM5, 4), // founder: adrenaline — stress tunes learning
  _f('nmGain', 0), // founder → no modulation
  _f('nmThresh', 0.5),
);
// --- Family L: life history ×4 (chr 7) ------------------------------------
// The viability family: founder defaults reproduce the old constants.
GENES.push(
  // longevity: scales the lifespan locus + lifelong frailty.
  _f('longScale', 0.5), // lifespanSec × (0.5 + value) (founder → ×1.0)
  _f('longAging', 0), // lifelong health decline (founder → none)
  // maturation: juvenile timing + the learning boost of youth.
  _f('matTime', 0.5), // stage thresholds × (0.5 + value) (founder → ×1.0)
  _f('matBoost', 0), // juvenile learning-rate boost (founder → none)
  // fertility: the reproductive window + litter + gestation.
  _f('ferPeak', 0.5), // age-fraction of peak fertility (window ±0.4)
  _c('ferLitter', [1, 2, 3], 1), // eggs per mating (founder → 2, as before)
  _f('ferGest', 0.5), // egg timer × (0.5 + value) (founder → ×1.0)
  // senescence: programmed late-life decline.
  _f('senOnset', 0.8), // age-fraction when decline starts
  _f('senRate', 0), // decline rate (founder → off)
);
// --- Family M: morphology ×8 (chr 1) --------------------------------------
// Bulk, tail, regional pigmentation, ears, arms. Mostly render; tailGrip
// and armLength touch the sim (climb speed, reach).
GENES.push(
  _f('bulk', 0.5), // body girth (render)
  _f('tailCurl', 0.5), // curl of the classic tail pose (render; founder → as before)
  _f('tailGrip', 0), // prehensile strength: climb-speed bonus (sim)
  _f('pigHeadHue', 0.5), _f('pigHeadSat', 0.5), _c('pigHeadPat', PIGPAT, 0),
  _f('pigTorsoHue', 0.5), _f('pigTorsoSat', 0.5), _c('pigTorsoPat', PIGPAT, 0),
  _f('pigLimbsHue', 0.5), _f('pigLimbsSat', 0.5), _c('pigLimbsPat', PIGPAT, 0),
  _f('earSize', 0.5), // (founder → 1.0 scale, as drawn before)
  _f('earTilt', 0.5), // (founder → upright, as drawn before)
  _f('armLength', 0.5), // replaces legLength in the arm formula (founder → same)
  // matePref: heritable beauty standards — the chooser's preferred coat color
  // (hue/sat) and choosiness. Wired into _mate selection in creature.js:
  // candidates are scored on proximity + color-match × choosiness. Founder
  // choosiness 0 → nearest wins, exactly as before; as the preference genes
  // evolve, beauty standards drift and sexual selection starts to bite.
  _f('matePrefHue', 0.5),
  _f('matePrefSat', 0.5),
  _f('matePrefChoosy', 0),
);
// --- Family S: stimulus valence ×4 (chr 4) --------------------------------
// World events carry evolvable valence → chemistry nudge + learnable reward.
for (let i = 0; i < 4; i++) {
  GENES.push(_c(`st${i}event`, STIM4, i % 4), _s(`st${i}val`, 0), _f(`st${i}int`, 0.5));
}
// --- Family D: drive tuning ×5 (chr 5) ------------------------------------
// Gain + baseline on the chemical→drive readout. The chemistry invariant
// stands: drives are still readouts of the seven chemicals; only the tuning
// is genetic. Founder defaults are the identity (gain 1.0, baseline 0).
for (const d of ['Hunger', 'Energy', 'Social', 'Fun', 'Fear']) {
  GENES.push(_f(`drv${d}Gain`, 0.5), _f(`drv${d}Base`, 0.5));
}
// === GENOME v0.37 "Affect": the affect family (append-only) =================
// design/affect-expansion.md — the tanglekin inner life, v2. Four new
// drives (libido, curiosity, attachment, care) with the same gain/baseline
// tuning as Family D: selection tunes the emotional volume. Plus the chronic-
// state loci: griefTime (grief-timer duration), pairBondRate (vasopressin
// gain), sexHormoneRate (libido chemistry gain), serotoninRate (long-horizon
// mood gain). All float, founder 0.5, identity mapping like v2 (D).
// === GENOME v0.14 "Voices": the voice family (append-only) ================
// Speech — Paul's v0.15, converged early. Tanglekins emit grounded calls
// (type from real state, never free choice) with an evolvable pitch.
// vocalImitate × tradition fidelity drives vocal learning: the young nudge
// their pitch toward heard pitches, so zones grow DIALECTS — the substrate
// Paul's v0.16 stories build on. matePrefCall is the prezygotic speciation
// gene: choosiness on call-pattern similarity, so divergent dialects
// reduce cross-mating (founder 0 → nearest/color wins, exactly as before).
GENES.push(
  _f('vocalPitch', 0.5), // base call pitch (0..1)
  _f('vocalRange', 0.3), // pitch variation around the base
  _f('vocalVolume', 0.5), // loudness — earshot radius
  _f('vocalImitate', 0.3), // pull of heard pitches on own pitch (dialect engine)
  _f('matePrefCall', 0), // prezygotic: choosiness on call similarity
  // Instincts (Paul's v0.5 rule: every new action needs one). sense 21 =
  // callHeard, sense 22 = callPitch, action 12 = vocal.
  { key: 'instHeardVocal', kind: 'float', sense: 21, action: 12, founder: 0.4 },
  { key: 'instLonelyVocal', kind: 'float', sense: 3, action: 12, founder: 0.3 },
);
// === end GENOME v0.14 =====================================================
// === GENOME v0.14 "Voices": disgust — the waste cycle's sense and instinct =
// wasteOdor (sense 23) smells fouled ground. instWasteFlee (→ flee, action 5)
// is the honest precursor to disease avoidance: food eaten on fouled ground
// carries contamination (see doEat), so lineages that flee the stink stay
// healthier — and the instinct evolves under real selection. Flee runs from
// the nearest creature; waste concentrates where creatures congregate, so
// fleeing the crowd is fleeing the foulest ground.
GENES.push(
  { key: 'instWasteFlee', kind: 'float', sense: 23, action: 5, founder: 0.7 },
);
// === end GENOME v0.14 disgust =============================================
// === GENOME v0.16 "Tongues": the language substrate ========================
// Evolvable parameters of the emergent lexicon. Append-only: new genes go
// at the end, on chromosome 8 (Culture). No new action, no new senses —
// the lexicon rides the existing vocal action (12) and the existing
// callHeard/callPitch senses (21/22), so no new instinct genes are needed
// under Paul's v0.5 rule.
//
// CHANNEL CO-EVOLUTION (Wang et al. 2026, via bart-the-hat): content
// evolution without channel co-evolution doesn't compound — the
// transmission channel must co-evolve with the lexicon. These substrate
// genes ARE the evolvable channel: capacity (lexCap), plasticity
// (lexLearn), fidelity (lexNoise), signal strength (lexLoud), receiver
// sensitivity (lexHear), and developmental window (lexCrit). Selection on
// communicative success tunes the channel alongside the content.
GENES.push(
  _f('lexCap', 0.65),   // lexicon slots: 4 + round(12*v) — founder ≈ 12
  _f('lexLearn', 0.5),  // lexicon learning rate
  _f('lexNoise', 0.3),  // production noise on emission
  _f('lexLoud', 0.5),   // base loudness
  _f('lexHear', 0.5),   // hearing threshold — lower is keener
  _f('lexCrit', 0.5),   // infant critical-period learning boost
);
// === end GENOME v0.16 =====================================================
// === GENOME v0.17 "Bauplan": the evo-devo family (append-only) ===========
// The body plan as a developmental program: five paired bud sites (see
// sim/evodevo.js), each with grow/type/pow loci (+len where no ancestral
// gene exists), plus body-plan regulators. Shoulder/hip buds ADOPT
// armLength/legLength as their len source — the founder's arms and legs
// are ancestral buds that simply always grew, so the founder phenotype is
// exactly the old one by construction. Dorsal has no ancestral len gene
// (founder proportion 0.5); mid-torso and neck carry their own len loci.
// 17 bud loci + segCount/tailCount regulators (family V = 19 loci on
// chromosome 9) + matePrefNovel + 5 dormant-action instincts (Paul's v0.5
// rule: every new action needs one) = 25 loci. Founder values reproduce
// the v0.15 body exactly.
const EVO17_START = GENES.length;
const BUD_TYPE_VOCAB = ['grasp', 'membrane', 'sail', 'gill', 'fin'];
GENES.push(
  // shoulder — adopts armLength
  _f('budShoulderGrow', 1), _c('budShoulderType', BUD_TYPE_VOCAB, 0), _f('budShoulderPow', 0.5),
  // hip — adopts legLength
  _f('budHipGrow', 1), _c('budHipType', BUD_TYPE_VOCAB, 0), _f('budHipPow', 0.5),
  // dorsal — membrane latent (one unrealized possibility among several)
  _f('budDorsalGrow', 0), _c('budDorsalType', BUD_TYPE_VOCAB, 1), _f('budDorsalPow', 0.5),
  // mid-torso — extra grasp-limb pair / serpentine segments
  _f('budMidGrow', 0), _c('budMidType', BUD_TYPE_VOCAB, 0), _f('budMidLen', 0.5), _f('budMidPow', 0.5),
  // neck — gill's natural home
  _f('budNeckGrow', 0), _c('budNeckType', BUD_TYPE_VOCAB, 3), _f('budNeckLen', 0.5), _f('budNeckPow', 0.5),
  // regulators
  _c('segCount', [0, 1, 2], 0), _c('tailCount', [0, 1], 0),
  // sexual selection on novelty — Fisherian runaway on wings/sails/gills/fins
  _f('matePrefNovel', 0),
  // dormant-action instincts (Paul's v0.5 rule). Founder 0 wires at
  // (0 − 0.5) × 2.4 = −1.2: the pathway exists but is inhibited — the
  // verbs sleep until organs (or evolution) wake them.
  { key: 'instAirborneGlide', kind: 'float', sense: 24, action: 13, founder: 0 },
  { key: 'instFarLedgeGlide', kind: 'float', sense: 25, action: 13, founder: 0 },
  { key: 'instFoodBrach', kind: 'float', sense: 6, action: 14, founder: 0 },
  { key: 'instSubmergedSwim', kind: 'float', sense: 26, action: 15, founder: 0 },
  { key: 'instSubmergedDive', kind: 'float', sense: 26, action: 16, founder: 0 },
);
// === end GENOME v0.17 =====================================================
// v0.17: the evo-devo loci draw from their own sub-stream in randomGenome
// (below) — new loci must never shift the main RNG sequence.
export const EVO17_KEYS = new Set(GENES.slice(EVO17_START).map((g) => g.key));
// v0.16: the language-substrate loci draw from a dedicated sub-stream in
// randomGenome (below) — new loci must never shift the main RNG sequence.
// Worldgen order is load-bearing for determinism: founder genomes and every
// existing test expectation sit on the main stream (v0.9 decorRng precedent).

// === GENOME v0.18 "Realms": water, heat, and earth (append-only) ==========
// Four new instinct genes (Paul's v0.5 rule: every new action needs one) —
// waterNear→drink and thirst→drink (both founder 0: the verbs sleep until
// water teaches them), cold→bask (founder 0), buriedNear→dig (founder 0.15:
// scratching at dirt is cheap to attempt, so the ramp starts nonzero but
// small). Plus family M's thermal-tolerance loci: coldTol and heatTol
// (floats, founder 0.5) — the creature-side analogues of the plants'
// coldTol/waterRet, shifting the hypo/hyperthermia thresholds in biochem.
// Like v0.16/v0.17, these loci draw from their own sub-stream in
// randomGenome — new loci never shift the main RNG sequence.
const REALMS18_START = GENES.length;
GENES.push(
  { key: 'instWaterDrink', kind: 'float', sense: 27, action: 17, founder: 0 },
  { key: 'instThirstDrink', kind: 'float', sense: 28, action: 17, founder: 0 },
  { key: 'instColdBask', kind: 'float', sense: 29, action: 18, founder: 0 },
  { key: 'instDig', kind: 'float', sense: 31, action: 19, founder: 0.15 },
  // family M (morphology — thermal morphology travels with fur on chr 1)
  _f('coldTol', 0.5),
  _f('heatTol', 0.5),
);
// === end GENOME v0.18 creature loci =======================================
// v0.18 "Realms": plant loci — heatTol and saltTol (floats, founder 0.5),
// the flora-side analogues of coldTol/waterRet. Defined here; the realms
// integration pass wires them into PLANT_GENES (plantgenome.js owns that
// list — append-only there too).
export const PLANT_REALMS_LOCI = [
  { key: 'heatTol', kind: 'float', founder: 0.5 },
  { key: 'saltTol', kind: 'float', founder: 0.5 },
];
// v0.18: the realms loci draw from their own sub-stream in randomGenome
// (below) — new loci must never shift the main RNG sequence.
export const REALMS18_KEYS = new Set(GENES.slice(REALMS18_START).map((g) => g.key));

// === GENOME v0.20 "Hands": the manipulation instincts (append-only) =======
// Three instinct genes (Paul's v0.5 rule: every new action needs one),
// all founder 0 — the dormant-action pattern. Founder 0 wires at
// (0 − 0.5) × 2.4 = −1.2: the pathway exists but is inhibited; the verbs
// sleep until selection wakes them.
//   instObjectGrasp: objectNear(32) → grasp(20) — pick up what's in reach
//   instCarryDrop: heldWeight(33) → drop(22) — the put-down reflex;
//     carrying forever is never selected for
//   instThreatStrike: fear(4) → carry(21) — threat sense → strike-with-
//     object. The 'carry' action executed under threat while holding IS
//     the strike (termite logic: no fourth verb); the hammer discovers
//     itself when a threatened carrier wields.
// Dexterity rides existing loci (graspPairs, groomReach, armLength) —
// no new dexterity gene. Like v0.16/v0.17/v0.18, these loci draw from
// their own sub-stream in randomGenome.
const HANDS20_START = GENES.length;
GENES.push(
  { key: 'instObjectGrasp', kind: 'float', sense: 32, action: 20, founder: 0 },
  { key: 'instCarryDrop', kind: 'float', sense: 33, action: 22, founder: 0 },
  { key: 'instThreatStrike', kind: 'float', sense: 4, action: 21, founder: 0 },
);
// === end GENOME v0.20 creature loci =======================================
export const HANDS20_KEYS = new Set(GENES.slice(HANDS20_START).map((g) => g.key));

// === v0.20 "Falling" loci ==================================================
// instFallVocal: falling(34) → vocal(12) — the fall-scream. Paul's v0.5 rule:
// every new action needs an instinct gene; the vestibular sense is new, the
// vocal action is old, and the wire between them is new. Fear past 0.6 makes
// groundCallType emit 'alarm', so the scream carries the alarm context
// honestly — the lexicon's alarm prototype gets its meaning from real falls.
// The gain is evolvable: lineages that scream on the way down can be heard.
// Founder 0.4 (not dormant): the reflex is live from the first generation.
// Drawn from the v0.20 hands sub-stream (same pass, own key set) so the main
// RNG sequence stays bit-identical.
const FALLING20_START = GENES.length;
GENES.push(
  { key: 'instFallVocal', kind: 'float', sense: 34, action: 12, founder: 0.4 },
);
// === end GENOME v0.20 "Falling" loci ======================================
export const FALLING20_KEYS = new Set(GENES.slice(FALLING20_START).map((g) => g.key));

// === GENOME v0.22 "Web of Life": the bite instinct (append-only) ===========
// instBite: creatureDist(8) → bite(23) — the attack verb's wire. Paul's v0.5
// rule: every new action needs an instinct gene, and it must ride the
// instinct chromosome or meiosis drops it. Founder 0.02 = the tanglekin
// default (dormant, the way swim shipped); the species table (species.js)
// overrides per founder — predators 0.75–0.9, low elsewhere. Drawn from its
// own sub-stream (pass 5) so the main RNG sequence stays bit-identical.
const WEB22_START = GENES.length;
GENES.push(
  { key: 'instBite', kind: 'float', sense: 8, action: 23, founder: 0.02 },
  // v0.22.1: the hunger gate. instBite fires on distance (the hunt-call);
  // instHungerBite fires on hunger (the strike drive). A hungry carnivore
  // near prey gets bite from hunger even when the distance wire goes quiet
  // at close range — satiation-gated predation, per ECOLOGY_DESIGN §9.
  // Founder 0.02 = dormant (the way swim shipped); predators override to 0.8.
  { key: 'instHungerBite', kind: 'float', sense: 0, action: 23, founder: 0.02 },
);
// === end GENOME v0.22 loci =================================================
export const WEB22_KEYS = new Set(GENES.slice(WEB22_START).map((g) => g.key));

// === GENOME v0.27 "Seasons": the panting locus (append-only) =================
// pantCapacity: evaporative-cooling capacity (panting / urohidrosis analog).
// A body-plan reflex, NOT an action: when coreTemp climbs toward the
// hyperthermia threshold, the creature pants — dumping heat at a water price.
// Founder 0 = dormant (the way the drink instincts shipped in v0.18); the
// vulture founder pins 0.8 (real vultures are the urohidrosis champions —
// they cool themselves by wetting their legs). Rides chromosome 1's thermal
// morphology block (with coldTol/heatTol) or meiosis drops it. Draws from its
// own sub-stream (pass 6) so every earlier RNG sequence stays bit-identical.
const SEASONS27_START = GENES.length;
GENES.push(
  _f('pantCapacity', 0),
);
// === end GENOME v0.27 loci ==================================================
export const SEASONS27_KEYS = new Set(GENES.slice(SEASONS27_START).map((g) => g.key));

// === GENOME v0.28 "Day and night": the activity-phase trait (append-only) ===
const DAYNIGHT28_START = GENES.length;
GENES.push(
  // activityPhase: the diurnal↔nocturnal axis. 0 = day-active (sleeps at
  // night), 1 = night-active (sleeps at day). Founder 0.5 ± 0.25 — the
  // founder population spans the axis, and selection sorts it. Read by the
  // phaseSleepiness sense (brain.js), weighted by instPhaseSleep.
  _f('activityPhase', 0.5),
  // instPhaseSleep: the phase-sleepiness sense (36) → sleep (2). Founder
  // 0.65: the reflex works on day one (the phase-divergence exit probe
  // needs it), and evolution tunes it both ways. Rides the instinct
  // chromosome or meiosis drops it.
  { key: 'instPhaseSleep', kind: 'float', sense: 36, action: 2, founder: 0.65 },
);
// === end GENOME v0.28 loci ==================================================
export const DAYNIGHT28_KEYS = new Set(GENES.slice(DAYNIGHT28_START).map((g) => g.key));

// === GENOME v0.30 "Species gate": the species tag (append-only) ==============
// speciesTag: the inherited species identity. kind 'choice' over the species
// key list — phenotype() expresses it as the species string. Every species
// founder pins its own tag via species.js overrides (both homologs); the
// sub-stream draw only matters for unpinned random genomes. Meiosis carries
// it like any locus, so the tag is genuinely inherited — and a rare
// choice-mutation can retag a lineage (speciation, not a bug).
// Rides chromosome 1's morphology block: species is a body-plan fact, and the
// tag travels with the body plan or meiosis drops it. Draws from its own
// sub-stream (pass 8) so every earlier RNG sequence stays bit-identical.
// Read by the v0.30 mating gate (world.tryMate).
export const SPECIES_TAG_CHOICES = [
  'tanglekin', 'skimmer', 'scurrier', 'beetle', 'beetle-detritivore', 'minnow',
  'jungle-cat', 'plains-runner', 'mangrove-croc', 'shark', 'bear', 'vulture',
  'flutter', 'grub',
];
const SPECIES30_START = GENES.length;
GENES.push(
  { key: 'speciesTag', kind: 'choice', choices: SPECIES_TAG_CHOICES },
);
// === end GENOME v0.30 loci ==================================================
export const SPECIES30_KEYS = new Set(GENES.slice(SPECIES30_START).map((g) => g.key));

// === GENOME v0.32 "Nervous system": the peripheral nerves (append-only) =====
// nerveConduction: conduction velocity of both trunks (px/tick = 4+26*v).
// painTolerance: how much pain narrows the action repertoire (vote nudge).
// reflPainFlee/reflPainFleeThr: withdrawal reflex gain + threshold.
// reflFearFlee/reflFearFleeThr: startle reflex gain + threshold.
// Reflex genes use the instinct-gene value scale but are NOT wired into the
// brain's instW — nerves.js reads them directly, keeping the fast reflex
// path experimentally separable from the cortical path. No new actions, so
// Paul's v0.5 rule needs no new instinct genes. Draw from their own
// sub-stream (pass 9) so every earlier RNG sequence stays bit-identical.
const NERVES32_START = GENES.length;
GENES.push(
  { key: 'nerveConduction', kind: 'float', founder: 0.5 },
  { key: 'painTolerance', kind: 'float', founder: 0.5 },
  { key: 'reflPainFlee', kind: 'float', founder: 0.7 },
  { key: 'reflPainFleeThr', kind: 'float', founder: 0.45 },
  { key: 'reflFearFlee', kind: 'float', founder: 0.5 },
  { key: 'reflFearFleeThr', kind: 'float', founder: 0.65 },
);
// === end GENOME v0.32 loci ==================================================
// === GENOME v0.37 "Affect": the emotion loci (append-only) ==================
// These loci mutate through the affectRng sub-stream (salt 55) — see
// AFFECT_LOCI and inherit() below. Joshua's directive 2026-10-02: "all the
// emotions I mentioned and the ones I didn't mention should be possible."
// Appended at the END so all earlier RNG sequences stay bit-identical.
for (const d of ['Libido', 'Curiosity', 'Attachment', 'Care']) {
  GENES.push(_f(`drv${d}Gain`, 0.5), _f(`drv${d}Base`, 0.5));
}
GENES.push(
  _f('griefTime', 0.5), // grief-timer duration × (0.5 + value) (founder → ×1.0 ≈ 1 day)
  _f('pairBondRate', 0.5), // vasopressin rise rate × (0.5 + value)
  _f('sexHormoneRate', 0.5), // sexHormone synthesis × (0.5 + value)
  _f('serotoninRate', 0.5), // serotonin rise/fall × (0.5 + value)
);
// v0.37 "Affect": the six new verbs each get an instinct gene (Paul's v0.5
// rule: every new action needs one). Senses 38–42 are the new affect senses
// (libido, curiosity, attachment, care, pairNear); actions 24–29 are the new
// verbs (display, inspect, cuddle, tend, seekBond, mourn). instMourn wires
// from loneliness (sense 3): grief spikes the social drive (§3.2), so the
// bereaved seek company — and if a death site is known, they go there.
GENES.push(
  { key: 'instDisplay', kind: 'float', sense: 38, action: 24, founder: 0.5 },
  { key: 'instInspect', kind: 'float', sense: 39, action: 25, founder: 0.5 },
  { key: 'instCuddle', kind: 'float', sense: 40, action: 26, founder: 0.5 },
  { key: 'instTend', kind: 'float', sense: 41, action: 27, founder: 0.5 },
  { key: 'instSeekBond', kind: 'float', sense: 40, action: 28, founder: 0.5 },
  { key: 'instMourn', kind: 'float', sense: 3, action: 29, founder: 0.5 },
);
// === end GENOME v0.37 =====================================================
export const NERVES32_KEYS = new Set(GENES.slice(NERVES32_START).map((g) => g.key));

// === GENOME D1 "Regulatory depth" (append-only) ==============================
// design/D1-genome-regulatory.md — the genome becomes a program that rewrites
// its own wiring: genes gating genes (family G, chr 10 "Regulation"), the
// duplication machinery gains a neutral buffer (family Q + genome.pool,
// chr 10), and the reaction/receptor channels extend founder-silent
// (extended R on chr 6, extended C on chr 5).
// Locus count: 257 → 349 (+92: 32 G + 4 Q + 32 ext-R + 24 ext-C). All
// appended after the previous GENES.length — indices 0–256 are untouched.
// (The design doc says "228 → 320"; the actual count at build time was 257 —
// the doc's 228 was stale. The +92 is exact.)
// Placed BEFORE GENE_MAP so the map covers the new loci.
const D1_START = GENES.length;
// D1 founder-exact helpers: these loci draw their founder default EXACTLY
// (see randomAllele) — the design's founder model is exact defaults, with
// variation entering via mutation.
const _fx = (key, founder) => ({ key, kind: 'float', founder, founderExact: true });
const _sx = (key, founder) => ({ key, kind: 'sym', founder, founderExact: true });
// --- Extended R ×8 (chr 6): rx8–rx15 ----------------------------------------
// Founder-silent: rate 0.0 (dead-silent — stricter than the rx0–7 whisper
// 0.03 — truly off until selection turns them on), thr 0.5. Substrate and
// product choices cycle the founder chain.
{
  const sub = [0, 1, 2, 3, 4, 0, 1, 2];
  const prod = [1, 2, 3, 4, 0, 2, 3, 4];
  for (let i = 8; i < 16; i++) {
    GENES.push(_c(`rx${i}sub`, CHEM7, sub[i - 8]), _c(`rx${i}prod`, CHEM7, prod[i - 8]),
      _fx(`rx${i}rate`, 0.0), _fx(`rx${i}thr`, 0.5));
  }
}
// --- Extended C ×6 (chr 5): rc6–rc11 ----------------------------------------
// Founder-silent: gain 0. Chem/sense choices cycle the rc0–5 founders.
{
  const senses = [0, 3, 1, 4, 13, 2]; // hunger, loneliness, tiredness, fear, illness, boredom
  for (let i = 6; i < 12; i++) {
    GENES.push(_c(`rc${i}chem`, CHEM7, i % 5), _c(`rc${i}sense`, SENSE24, senses[i - 6]),
      _sx(`rc${i}gain`, 0), _fx(`rc${i}thr`, 0.5));
  }
}
// --- Family Q: the buffered duplication drain (chr 10) ----------------------
// dupRate/poolDrain reproduce DUP_RATE/DEL_RATE exactly at founder; poolCap
// and poolRecDiv are new machinery, inert at founder (empty pool).
GENES.push(
  _fx('dupRate', 0.001),
  _fx('poolDrain', 0.002),
  _c('poolCap', [8, 12, 16], 1), // founder index 1 → 12
  _fx('poolRecDiv', 0.15), // the recruitment divergence threshold
);
// --- Family G: transcription-factor analogs ×8 (chr 10) ---------------------
// Each G gene: a regulator (chemical), a target (gene), a response curve
// (threshold, signed slope). gateMult = 1 + slope × σ((reg − thr) × 4).
// Founder slope 0 ⇒ mult ≡ 1.0 exactly — the neutralizer.
const G_GENE_KEYS = new Set();
const _gTgtGenes = [];
for (let i = 0; i < 8; i++) {
  const reg = _c(`g${i}reg`, CHEM7, i % 7);
  const tgt = _c(`g${i}tgt`, [], 0); // choices wired from GTARGETS below
  const thr = _fx(`g${i}thr`, 0.5);
  const slope = _sx(`g${i}slope`, 0);
  GENES.push(reg, tgt, thr, slope);
  for (const g of [reg, tgt, thr, slope]) G_GENE_KEYS.add(g.key);
  _gTgtGenes.push(tgt);
}
export const D1_KEYS = new Set(GENES.slice(D1_START).map((g) => g.key));
// GTARGETS: GENERATED at load time from GENES — every float|sym|exp locus,
// excluding family G itself (no gate-on-gate chains — evaluation is
// single-pass) and excluding choice genes (a categorical can't be scaled).
// Because GENES is append-only, target indices are stable forever.
// KEEP THIS AFTER ALL GENES PUSHES: a future family appended below this line
// must move this block down with it, or its loci won't become legal targets.
export const GTARGETS = GENES
  .filter((g) => (g.kind === 'float' || g.kind === 'sym' || g.kind === 'exp') && !G_GENE_KEYS.has(g.key))
  .map((g) => g.key);
{
  // g{i}tgt founder: the index of 'curiosity' in the generated vocabulary.
  const ci = GTARGETS.indexOf('curiosity');
  for (const t of _gTgtGenes) { t.choices = GTARGETS; t.founder = ci; }
}
// === end GENOME D1 loci =====================================================

const GENE_MAP = Object.fromEntries(GENES.map((g) => [g.key, g]));

// --- chromosomes: linked inheritance --------------------------------------
// 9 chromosomes, thematic like Emberhollow's. Genes on the same chromosome
// cross over in segments; genes on different chromosomes assort freely.
// A chromosome is a story, not a bag of alleles.
// v2: the reserved chromosomes 5–7 are now populated (drives, chemistry,
// life history); morphology/neuroarchitecture/instincts absorb their families.
const _chrR = []; // reactions ×8
const _chrC = []; // receptors ×6
const _chrE = []; // emitters ×6
const _chrS = []; // stimulus valence ×4
for (let i = 0; i < 8; i++) _chrR.push(`rx${i}sub`, `rx${i}prod`, `rx${i}rate`, `rx${i}thr`);
for (let i = 0; i < 6; i++) {
  _chrC.push(`rc${i}chem`, `rc${i}sense`, `rc${i}gain`, `rc${i}thr`);
  _chrE.push(`em${i}trig`, `em${i}chem`, `em${i}amt`);
}
// D1 "Regulatory depth": the extended channels join their family's
// chromosome — same story (chemistry; the chemistry/sense interface).
for (let i = 8; i < 16; i++) _chrR.push(`rx${i}sub`, `rx${i}prod`, `rx${i}rate`, `rx${i}thr`);
for (let i = 6; i < 12; i++) _chrC.push(`rc${i}chem`, `rc${i}sense`, `rc${i}gain`, `rc${i}thr`);
// D1: chr 10 "Regulation" — the 36 family-G/Q loci travel together: the
// machinery that rewrites the wiring.
const _chrG = [];
for (let i = 0; i < 8; i++) _chrG.push(`g${i}reg`, `g${i}tgt`, `g${i}thr`, `g${i}slope`);
_chrG.push('dupRate', 'poolDrain', 'poolCap', 'poolRecDiv');
for (let i = 0; i < 4; i++) _chrS.push(`st${i}event`, `st${i}val`, `st${i}int`);
const _chrD = [];
for (const d of ['Hunger', 'Energy', 'Social', 'Fun', 'Fear']) _chrD.push(`drv${d}Gain`, `drv${d}Base`);
// v0.37 "Affect": the four new drives' tuning loci ride the drives chromosome.
for (const d of ['Libido', 'Curiosity', 'Attachment', 'Care']) _chrD.push(`drv${d}Gain`, `drv${d}Base`);
_chrD.push('griefTime', 'pairBondRate', 'sexHormoneRate', 'serotoninRate');
export const CHROMOSOMES = [
  // 1 — Morphology (+ v2 family M: bulk, tail, regional pigment, ears, arms)
  ['bodyHue', 'patternDensity', 'size', 'tailLength', 'eyeSize', 'pattern', 'earShape',
   'diet', 'mouthSize', 'legLength', 'legPower', 'spikes', 'fur',
   'bulk', 'tailCurl', 'tailGrip',
   'pigHeadHue', 'pigHeadSat', 'pigHeadPat',
   'pigTorsoHue', 'pigTorsoSat', 'pigTorsoPat',
   'pigLimbsHue', 'pigLimbsSat', 'pigLimbsPat',
   'earSize', 'earTilt', 'armLength',
   'matePrefHue', 'matePrefSat', 'matePrefChoosy',
   // v0.18: thermal morphology — coldTol/heatTol travel with fur (the
   // thermal reader's own loci ride the thermal morphology's chromosome)
   // v0.27: pantCapacity rides the same block — the evaporative-cooling
   // reflex is thermal morphology (or meiosis drops it)
   'coldTol', 'heatTol', 'pantCapacity',
   // v0.30: speciesTag rides the morphology block — species is a body-plan
   // fact, and the tag travels with the body plan or meiosis drops it.
   'speciesTag'],
  // 2 — Metabolism
  ['hungerRate', 'energyDrain', 'lifespan', 'growthRate', 'fertility', 'immunity'],
  // 3 — Neuroarchitecture (+ v2 family B: brain plan, attention gates,
  // memory traces, neuromodulation)
  ['learningRate', 'memory', 'brainSize',
   'bpLayers', 'bpSparsity', 'bpHebb', 'bpLatInhib',
   'agCount', 'agGain', 'agThresh', 'mtDecay', 'mtGain',
   'nmChem', 'nmGain', 'nmThresh',
   // v0.32 "Nervous system": conduction velocity + pain tolerance ride the
   // neuroarchitecture chromosome — the peripheral nerves are the brain's
   // body, or meiosis drops them.
   'nerveConduction', 'painTolerance'],
  // 4 — Instincts (+ v2 family S: stimulus valence)
  ['curiosity', 'sociability', 'boldness',
   'instHungerSeek', 'instHungerEat', 'instTiredSleep', 'instBoredPlay',
   'instLonelyApproach', 'instFearFlee', 'instLightSleep', 'instFoodDistSeek',
   'instCreatureDistApproach', 'instToyDistPlay', 'instLonelyMate',
   'instIllnessSeek', 'instHomeSeek', 'instClimbUp', 'instClimbDown', 'instLonelyGroom',
   'instJump',
   'instWasteFlee', // v0.14: disgust — waste-odor → flee
   // v0.18 "Realms": the water/heat/earth instincts ride the instinct chromosome
   'instWaterDrink', 'instThirstDrink', 'instColdBask', 'instDig',
   // v0.20 "Hands": the manipulation instincts — grasp, wield, put down
   'instObjectGrasp', 'instCarryDrop', 'instThreatStrike',
   // v0.20 "Falling": the fall-scream rides the instinct chromosome
   'instFallVocal',
   // v0.22 "Web of Life": the bite instinct rides the instinct chromosome
   'instBite',
   // v0.22.1: the hunger gate for the strike — hunger → bite
   'instHungerBite',
   // v0.28 "Day and night": the activity-phase trait + its sleep instinct
   'activityPhase', 'instPhaseSleep',
   // v0.32 "Nervous system": the reflex arcs ride the instinct chromosome —
   // withdrawal and startle are nature, not nurture, or meiosis drops them.
   'reflPainFlee', 'reflPainFleeThr', 'reflFearFlee', 'reflFearFleeThr',
   // v0.37 "Affect": the six new verbs' instincts ride the instinct
   // chromosome — display, inspect, cuddle, tend, seekBond, mourn.
   'instDisplay', 'instInspect', 'instCuddle', 'instTend', 'instSeekBond', 'instMourn',
   ..._chrS],
  // 5 — Drives (v2: drive tuning + receptors — the chemistry/sense interface)
  [..._chrD, ..._chrC],
  // 6 — Chemistry (v2: reactions + emitters — the evolvable reaction network)
  [..._chrR, ..._chrE],
  // 7 — Life history (v2: longevity, maturation, fertility, senescence)
  ['longScale', 'longAging', 'matTime', 'matBoost', 'ferPeak', 'ferLitter',
   'ferGest', 'senOnset', 'senRate'],
  // 8 — Culture (+ v0.14 voice: speech is learned culture's acoustic half;
  // v0.16 Tongues: the language substrate)
  ['tradition',
   'vocalPitch', 'vocalRange', 'vocalVolume', 'vocalImitate', 'matePrefCall',
   'instHeardVocal', 'instLonelyVocal',
   'lexCap', 'lexLearn', 'lexNoise', 'lexLoud', 'lexHear', 'lexCrit'],
  // 9 — EvoDevo (v0.17: the body plan as a developmental program — the bud
  // sites, their regulators, the novelty preference, and the dormant-action
  // instincts travel together)
  [...EVO17_KEYS],
  // 10 — Regulation (D1: the machinery that rewrites the wiring — family G
  // transcription-factor analogs + family Q buffered-duplication machinery)
  [..._chrG],
];
// D1: index of the regulation chromosome. Its crossover draws run on the
// dedicated 0x47 sub-stream in meiosis() — new loci never shift the main RNG
// sequence. Append-only: future chromosomes go after this one.
export const REGULATION_CHROM = CHROMOSOMES.length - 1;

const MUTATION_RATE = 0.008; // per allele

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function randomAllele(gene, rng) {
  // D1 "Regulatory depth": founderExact loci draw their founder default
  // EXACTLY — no ±0.25 spread. For loci whose founder default must reproduce
  // a current constant or an exact neutral (dupRate = DUP_RATE, poolDrain =
  // DEL_RATE, rx8–15 rate = 0.0 dead-silent, g slope = 0 ⇒ mult ≡ 1.0 in
  // float). Variation enters via mutation, the standard evolutionary story.
  // No pre-D1 gene sets this flag, so all existing draws are untouched.
  if (gene.founderExact && gene.founder !== undefined) return gene.founder;
  if (gene.kind === 'choice') {
    if (gene.founder !== undefined) return gene.founder;
    return rng.int(0, gene.choices.length - 1);
  }
  if (gene.kind === 'sym') {
    // Signed locus: founder ± 0.25, clamped to [-1, 1].
    if (gene.founder !== undefined) {
      return Math.max(-1, Math.min(1, gene.founder + (rng.next() - 0.5) * 0.5));
    }
    return rng.next() * 2 - 1;
  }
  if (gene.founder !== undefined) {
    if (gene.kind === 'exp') {
      // Unbounded locus: founder × ±25%, never clamped above.
      return Math.max(0.05, gene.founder * (1 + (rng.next() - 0.5) * 0.5));
    }
    return clamp01(gene.founder + (rng.next() - 0.5) * 0.5);
  }
  return rng.next();
}

// A genome is { alleles: { key: [a, b] }, marks: { key: 0.5..1.5 },
//   extra: { key: [a, b] } }.
// Marks are epigenetic: they scale float-gene expression and fade toward 1
// each generation. Life writes them; time erases them.
// v0.14 "Voices": extra holds DUPLICATED gene copies — at most one extra
// pair per gene, MAX_EXTRA per genome. Copies express by dosage-averaging
// with the base pair and mutate independently, so genome *complexity* is
// evolvable, not just allele values. Speech is the first selection pressure
// for new loci (vocal learning, dialect memory).
export const DUP_RATE = 0.001; // per gene per generation: whole-gene duplication
export const DEL_RATE = 0.002; // per extra copy per generation: deletion (prunes the neutral)
export const MAX_EXTRA = 6; // cap on duplicated copies per genome
// Express one non-choice locus as mean × mark (no gates, no phenotype
// derivations) — for read-site gating inside inherit(), where no phenotype
// exists yet. Mirrors phenotype()'s base expression, including extra-dosage
// averaging. GENE_MAP must cover the key (D1 loci are registered before it).
function expressBase(genome, key) {
  const gene = GENE_MAP[key];
  const [a, b] = genome.alleles[key];
  const mark = (genome.marks && genome.marks[key]) || 1.0;
  let mean = (a + b) / 2;
  const xc = genome.extra && genome.extra[key];
  if (xc) mean = (mean + (xc[0] + xc[1]) / 2) / 2;
  if (gene.kind === 'exp') return Math.max(0.05, mean * mark);
  if (gene.kind === 'sym') return Math.max(-1, Math.min(1, mean * mark));
  return clamp01(mean * mark);
}
// v0.18 "Realms": pin a sub-stream seed from an experiment pin instead of
// the genome's content hash. Distinct per-pass salts keep the passes
// independent: the same pin gives the same language alleles, the same
// evo-devo alleles, and the same realms alleles, whatever the founder's
// main-stream content. A legPower sweep with a pinned sub-stream changes
// ONLY legPower — the §13.7 confound fix.
function hashPin(pin, salt) {
  let h = salt | 0;
  h = (Math.imul(h, 31) + (pin | 0)) | 0;
  h = (Math.imul(h, 31) + 0x9e3779b9) | 0;
  h ^= h >>> 13;
  return h >>> 0;
}
const PIN_SALT_LANG = 0x16; // v0.16 language pass
const PIN_SALT_EVO = 0x17; // v0.17 evo-devo pass
const PIN_SALT_REALMS = 0x18; // v0.18 realms pass
const PIN_SALT_HANDS = 0x20; // v0.20 hands pass
const PIN_SALT_WEB22 = 0x22; // v0.22 web-of-life pass (instBite)
const PIN_SALT_SEASONS = 0x27; // v0.27 seasons pass (pantCapacity)
const PIN_SALT_DAYNIGHT = 0x28; // v0.28 day/night pass (activityPhase, instPhaseSleep)
const PIN_SALT_SPECIES30 = 0x30; // v0.30 species pass (speciesTag)
const PIN_SALT_NERVES32 = 0x32; // v0.32 nervous-system pass
const PIN_SALT_AFFECT37 = 0x37; // v0.37 affect pass
const PIN_SALT_D1 = 0x47; // D1 regulatory-depth pass (founder alleles)
export function randomGenome(rng, opts = {}) {
  // opts.pinSub (number): when set, the language (v0.16), evo-devo (v0.17),
  // realms (v0.18), hands/falling (v0.20), web-of-life (v0.22) and seasons
  // (v0.27) sub-stream passes seed from hash(pin, passSalt) instead of the
  // content hash — identical sub-stream alleles across founders with
  // different main-stream content.
  // opts.overrides ({ key: value | [a, b] }): pin specific alleles after
  // the draws (e.g. { legPower: 0.3 } sets both homologs). The legPower
  // sweep is: same rng seed + same pinSub + different legPower override →
  // every allele except legPower bit-identical.
  // When opts is absent (or pinSub unset): EXACT current behavior — main
  // stream bit-identical to v0.15, content-hash sub-streams.
  const { pinSub, overrides } = opts;
  const pinned = pinSub !== undefined && pinSub !== null;
  const alleles = {};
  const marks = {};
  // v0.16: the language-substrate loci (lexCap…lexCrit) draw from a
  // dedicated sub-stream, not the main rng. Pass 1 draws the 186 pre-v0.16
  // loci in GENES order — the main stream's sequence is bit-identical to
  // v0.15, so founder genomes and all existing test expectations are
  // untouched. Pass 2 seeds the language sub-stream from a hash of the
  // main alleles: the language alleles are a deterministic function of the
  // genome's main content, so identical genomes (same seed, different runs)
  // get identical language alleles. (v0.9 decorRng precedent: new loci must
  // never shift the main RNG sequence.)
  // v0.17: the evo-devo loci (family V, chromosome 9) draw from their own
  // sub-stream in pass 3, seeded by a hash of the full pre-v0.17 genome —
  // deterministic, and the main + language streams stay bit-identical
  // to v0.16.
  // v0.18: the realms loci (4 instincts + coldTol/heatTol) draw from their
  // own sub-stream in pass 4, seeded by a hash of the full pre-v0.18 genome
  // — deterministic, and the main + language + evo-devo streams stay
  // bit-identical to v0.17. With opts.pinSub, passes 2–4 seed from the pin
  // instead of the content hashes.
  // v0.22: the web-of-life loci (instBite) draw from their own sub-stream in
  // pass 5, seeded by a hash of the full pre-v0.22 genome — deterministic,
  // and every earlier stream stays bit-identical to v0.20. With opts.pinSub,
  // passes 2–5 seed from the pin instead of the content hashes.
  // v0.27: the panting locus draws from its own sub-stream in pass 6,
  // seeded by a hash of the full pre-v0.27 genome — deterministic, and every
  // earlier stream stays bit-identical to v0.22. With opts.pinSub, passes
  // 2–6 seed from the pin instead of the content hashes.
  // v0.32: the nervous-system loci draw from their own sub-stream in
  // pass 9 — deterministic, every earlier pass bit-identical to v0.31.
  const isNew17 = (k) => EVO17_KEYS.has(k);
  const isNew18 = (k) => REALMS18_KEYS.has(k);
  const isNew20 = (k) => HANDS20_KEYS.has(k);
  const isNewFalling = (k) => FALLING20_KEYS.has(k);
  const isNewWeb22 = (k) => WEB22_KEYS.has(k);
  const isNew27 = (k) => SEASONS27_KEYS.has(k);
  const isNew28 = (k) => DAYNIGHT28_KEYS.has(k);
  const isNew30 = (k) => SPECIES30_KEYS.has(k);
  const isNew32 = (k) => NERVES32_KEYS.has(k);
  const isNew37 = (k) => AFFECT_LOCI.has(k);
  const isNewD1 = (k) => D1_KEYS.has(k);

  const isNewer = (k) => isNew17(k) || isNew18(k) || isNew20(k) || isNewFalling(k) || isNewWeb22(k) || isNew27(k) || isNew28(k) || isNew30(k) || isNew32(k) || isNew37(k) || isNewD1(k);
  for (const gene of GENES) {
    if (gene.key.startsWith('lex') || isNewer(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, rng), randomAllele(gene, rng)];
    marks[gene.key] = 1.0;
  }
  let h = 0x1a6c0de;
  for (const gene of GENES) {
    if (gene.key.startsWith('lex') || isNewer(gene.key)) continue;
    for (const a of alleles[gene.key]) h = (Math.imul(h, 31) + Math.floor(a * 1e9)) | 0;
  }
  const langRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_LANG) : h >>> 0);
  for (const gene of GENES) {
    if (!gene.key.startsWith('lex')) continue;
    alleles[gene.key] = [randomAllele(gene, langRng), randomAllele(gene, langRng)];
    marks[gene.key] = 1.0;
  }
  let h2 = 0x5eed17;
  for (const gene of GENES) {
    if (isNewer(gene.key)) continue;
    for (const a of alleles[gene.key]) h2 = (Math.imul(h2, 31) + Math.floor(a * 1e9)) | 0;
  }
  const evoRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_EVO) : h2 >>> 0);
  for (const gene of GENES) {
    if (!isNew17(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, evoRng), randomAllele(gene, evoRng)];
    marks[gene.key] = 1.0;
  }
  let h3 = 0x18ea1d;
  for (const gene of GENES) {
    if (isNew18(gene.key) || isNew20(gene.key) || isNewFalling(gene.key) || isNewWeb22(gene.key) || isNew27(gene.key) || isNew28(gene.key) || isNew30(gene.key) || isNew32(gene.key) || isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h3 = (Math.imul(h3, 31) + Math.floor(a * 1e9)) | 0;
  }
  const realmsRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_REALMS) : h3 >>> 0);
  for (const gene of GENES) {
    if (!isNew18(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, realmsRng), randomAllele(gene, realmsRng)];
    marks[gene.key] = 1.0;
  }
  // v0.20 "Hands": the manipulation instincts draw from their own
  // sub-stream — new loci never shift the main RNG sequence.
  // v0.20 "Falling": instFallVocal rides this same pass (own key set) —
  // the h4 seed stays bit-identical to the hands-only v0.20, and the
  // falling gene draws after the hands genes, deterministically.
  let h4 = 0x20a05;
  for (const gene of GENES) {
    if (isNew20(gene.key) || isNewFalling(gene.key) || isNewWeb22(gene.key) || isNew27(gene.key) || isNew28(gene.key) || isNew30(gene.key) || isNew32(gene.key) || isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h4 = (Math.imul(h4, 31) + Math.floor(a * 1e9)) | 0;
  }
  const handsRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_HANDS) : h4 >>> 0);
  for (const gene of GENES) {
    if (!isNew20(gene.key) && !isNewFalling(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, handsRng), randomAllele(gene, handsRng)];
    marks[gene.key] = 1.0;
  }
  // v0.22 "Web of Life": instBite draws from its own sub-stream — new loci
  // never shift the main RNG sequence.
  let h5 = 0x22022;
  for (const gene of GENES) {
    if (isNewWeb22(gene.key) || isNew27(gene.key) || isNew28(gene.key) || isNew30(gene.key) || isNew32(gene.key) || isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h5 = (Math.imul(h5, 31) + Math.floor(a * 1e9)) | 0;
  }
  const web22Rng = createRng(pinned ? hashPin(pinSub, PIN_SALT_WEB22) : h5 >>> 0);
  for (const gene of GENES) {
    if (!isNewWeb22(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, web22Rng), randomAllele(gene, web22Rng)];
    marks[gene.key] = 1.0;
  }
  // v0.27 "Seasons": pantCapacity draws from its own sub-stream — new loci
  // never shift the main RNG sequence.
  let h6 = 0x27027;
  for (const gene of GENES) {
    if (isNew27(gene.key) || isNew28(gene.key) || isNew30(gene.key) || isNew32(gene.key) || isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h6 = (Math.imul(h6, 31) + Math.floor(a * 1e9)) | 0;
  }
  const seasonsRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_SEASONS) : h6 >>> 0);
  for (const gene of GENES) {
    if (!isNew27(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, seasonsRng), randomAllele(gene, seasonsRng)];
    marks[gene.key] = 1.0;
  }
  // v0.28 "Day and night": activityPhase + instPhaseSleep draw from their
  // own sub-stream in pass 7 — new loci never shift the main RNG sequence.
  let h7 = 0x28028;
  for (const gene of GENES) {
    if (isNew28(gene.key) || isNew30(gene.key) || isNew32(gene.key) || isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h7 = (Math.imul(h7, 31) + Math.floor(a * 1e9)) | 0;
  }
  const daynightRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_DAYNIGHT) : h7 >>> 0);
  for (const gene of GENES) {
    if (!isNew28(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, daynightRng), randomAllele(gene, daynightRng)];
    marks[gene.key] = 1.0;
  }
  // v0.30 "Species gate": speciesTag draws from its own sub-stream in
  // pass 8 — new loci never shift the main RNG sequence. Every earlier
  // pass stays bit-identical to v0.29.
  let h8 = 0x30030;
  for (const gene of GENES) {
    if (isNew30(gene.key) || isNew32(gene.key) || isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h8 = (Math.imul(h8, 31) + Math.floor(a * 1e9)) | 0;
  }
  const speciesRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_SPECIES30) : h8 >>> 0);
  for (const gene of GENES) {
    if (!isNew30(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, speciesRng), randomAllele(gene, speciesRng)];
    marks[gene.key] = 1.0;
  }
  // v0.32 "Nervous system": the nerve loci draw from their own sub-stream
  // in pass 9 — new loci never shift the main RNG sequence. Every earlier
  // pass stays bit-identical to v0.31.
  let h9 = 0x32032;
  for (const gene of GENES) {
    if (isNew32(gene.key) || isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h9 = (Math.imul(h9, 31) + Math.floor(a * 1e9)) | 0;
  }
  const nervesRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_NERVES32) : h9 >>> 0);
  for (const gene of GENES) {
    if (!isNew32(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, nervesRng), randomAllele(gene, nervesRng)];
    marks[gene.key] = 1.0;
  }
  // v0.37 "Affect": the emotion loci (drives, rates, 6 verb instincts) draw
  // from their own sub-stream in pass 10 — new loci never shift the main
  // RNG sequence. Every earlier pass stays bit-identical to v0.36.
  let h10 = 0x37037;
  for (const gene of GENES) {
    if (isNew37(gene.key) || isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h10 = (Math.imul(h10, 31) + Math.floor(a * 1e9)) | 0;
  }
  const affectInitRng = createRng(pinned ? hashPin(pinSub, PIN_SALT_AFFECT37) : h10 >>> 0);
  for (const gene of GENES) {
    if (!isNew37(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, affectInitRng), randomAllele(gene, affectInitRng)];
    marks[gene.key] = 1.0;
  }
  // D1 "Regulatory depth": the 92 new loci draw from their own sub-stream in
  // pass 11 (salt 0x47) — new loci never shift the main RNG sequence. Every
  // earlier pass stays bit-identical.
  // (The design doc says "pass 10, salt 0x47" — but pass 10 is already the
  // v0.37 affect pass in this file, so D1 takes the next slot. The salt is
  // what the doc pins, and 0x47 is unused by every earlier pass.)
  let h11 = 0x47047;
  for (const gene of GENES) {
    if (isNewD1(gene.key)) continue;
    for (const a of alleles[gene.key]) h11 = (Math.imul(h11, 31) + Math.floor(a * 1e9)) | 0;
  }
  const d1Rng = createRng(pinned ? hashPin(pinSub, PIN_SALT_D1) : h11 >>> 0);
  for (const gene of GENES) {
    if (!isNewD1(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, d1Rng), randomAllele(gene, d1Rng)];
    marks[gene.key] = 1.0;
  }
  // v0.18: allele overrides — applied after the draws, so a sweep can pin
  // one locus (e.g. legPower) while the pinned sub-streams hold everything
  // else constant. A single number sets both homologs.
  if (overrides) {
    for (const [key, v] of Object.entries(overrides)) {
      if (!alleles[key]) continue;
      alleles[key] = Array.isArray(v) ? [v[0], v[1]] : [v, v];
    }
  }
  return { alleles, marks, extra: {}, pool: {} };
}

function mutateAllele(gene, value, rng, rate = MUTATION_RATE) {
  if (!rng.chance(rate)) return value;
  if (gene.kind === 'choice') {
    const options = gene.choices.map((_, i) => i).filter((i) => i !== value);
    return rng.pick(options);
  }
  if (gene.kind === 'exp') {
    // Unbounded locus: multiplicative mutation, no ceiling. 5% large-effect
    // re-roll around the founder, else a small proportional step — brains
    // can ratchet up (or down) without bound across generations.
    if (rng.chance(0.05)) return gene.founder * (0.5 + rng.next() * 1.5);
    const step = rng.gauss ? rng.gauss(0, 0.06) : (rng.next() - 0.5) * 0.12;
    return Math.max(0.05, value * (1 + step));
  }
  if (gene.kind === 'sym') {
    // Signed locus: 5% full re-roll, else a small Gaussian step, clamped.
    if (rng.chance(0.05)) return rng.next() * 2 - 1;
    const step = rng.gauss ? rng.gauss(0, 0.06) : (rng.next() + rng.next() + rng.next() - 1.5) * 0.08;
    return Math.max(-1, Math.min(1, value + step));
  }
  // 5% large-effect re-roll, else a small Gaussian step.
  if (rng.chance(0.05)) return rng.next();
  const step = rng.gauss ? rng.gauss(0, 0.06) : (rng.next() + rng.next() + rng.next() - 1.5) * 0.08;
  return clamp01(value + step);
}

// Meiosis: build one gamete. For each chromosome, pick 1–3 crossover points;
// alternate between the two homologs between crossovers. Marks fade halfway
// toward 1 (imperfect epigenetic inheritance — the past attenuates).
// subRng (optional): the dedicated duplication/pool sub-stream (D1, salt
// 0x47). When provided, the regulation chromosome's crossover draws AND all
// copy-number segregation draws run on it — new loci never shift the main
// RNG sequence. (The v0.37 "meiosis stays on the caller's rng" contract
// predates chr 10; within-version reproducibility is preserved.)
export function meiosis(genome, rng, subRng = null) {
  const gamete = {};
  const gameteMarks = {};
  for (let ci = 0; ci < CHROMOSOMES.length; ci++) {
    const chrom = CHROMOSOMES[ci];
    if (chrom.length === 0) continue;
    // D1: the regulation chromosome's crossover draws run on the 0x47
    // sub-stream (BUILD_QUEUE standing rule: new loci from their own RNG
    // sub-stream). REGULATION_CHROM is chr 10, append-only.
    const crng = (subRng && ci === REGULATION_CHROM) ? subRng : rng;
    const nX = 1 + crng.int(0, 2);
    const points = new Set();
    while (points.size < nX && points.size < chrom.length - 1) {
      points.add(1 + crng.int(0, chrom.length - 2));
    }
    const cuts = [...points].sort((a, b) => a - b);
    let useFirst = crng.chance(0.5);
    let cutIdx = 0;
    for (let i = 0; i < chrom.length; i++) {
      if (cutIdx < cuts.length && i === cuts[cutIdx]) {
        useFirst = !useFirst;
        cutIdx++;
      }
      const key = chrom[i];
      const allele = genome.alleles[key][useFirst ? 0 : 1];
      gamete[key] = allele;
      const m = (genome.marks && genome.marks[key]) || 1.0;
      gameteMarks[key] = 1.0 + (m - 1.0) * 0.5;
    }
  }
  // v0.14: duplicated copies segregate like presence/absence alleles linked
  // to the base locus — each copy passes to the gamete with 50% chance.
  // D1: copy-number segregation is duplication randomness → the 0x47
  // sub-stream when provided (falls back to rng for old callers).
  const srng = subRng || rng;
  const gameteExtra = {};
  for (const key of Object.keys(genome.extra || {})) {
    if (srng.chance(0.5)) gameteExtra[key] = genome.extra[key].slice();
  }
  // D1: pool copies segregate 50% like presence/absence alleles, same as
  // extra copies. Carried as {a, b, mark, age, div} records.
  const gametePool = {};
  for (const key of Object.keys(genome.pool || {})) {
    const kept = [];
    for (const copy of genome.pool[key]) {
      if (srng.chance(0.5)) kept.push({ ...copy });
    }
    if (kept.length) gametePool[key] = kept;
  }
  return { gamete, gameteMarks, gameteExtra, gametePool };
}

// v0.37 "Affect": the loci whose mutation draws come from the dedicated
// affectRng sub-stream (salt 55), never the caller's rng. Per the standing
// rule (new-version loci own RNG sub-stream) and the rng-boundary leak
// criterion: these draws are causal (drive gains steer behavior → selection
// sees them), so they live on their own sequential stream.
export const AFFECT_LOCI = new Set([
  'drvLibidoGain', 'drvLibidoBase', 'drvCuriosityGain', 'drvCuriosityBase',
  'drvAttachmentGain', 'drvAttachmentBase', 'drvCareGain', 'drvCareBase',
  'griefTime', 'pairBondRate', 'sexHormoneRate', 'serotoninRate',
  'instDisplay', 'instInspect', 'instCuddle', 'instTend', 'instSeekBond', 'instMourn',
]);
export function inherit(momGenome, dadGenome, rng, mutationRate = MUTATION_RATE, affectRng = null, dupRng = null, chem = null) {
  // dupRng: the dedicated duplication/pool sub-stream (D1, salt 0x47) — all
  // duplication/pool randomness runs on it, never the affect 0x55 sub-stream.
  // chem: live chemical levels (the mother's biochem at mating) — dupRate and
  // poolDrain are legal G targets, so evolvability itself can be
  // chemistry-gated (generational gating). Null → gates ≡ 1.0.
  const prng = dupRng || rng;
  const m = meiosis(momGenome, rng, dupRng);
  const d = meiosis(dadGenome, rng, dupRng);
  const alleles = {};
  const marks = {};
  for (const gene of GENES) {
    // v0.37: the affect loci mutate on their own sub-stream — the main
    // sequence never sees these draws (the rng-boundary probe's affect arm
    // asserts this). Meiosis stays on the caller's rng for all loci: the
    // crossover ordering IS the per-version reproducibility contract.
    // D1: the 92 new loci likewise mutate on the 0x47 sub-stream — new loci
    // never shift the main RNG sequence (BUILD_QUEUE standing rule).
    let mrng = rng;
    if (affectRng && AFFECT_LOCI.has(gene.key)) mrng = affectRng;
    else if (dupRng && D1_KEYS.has(gene.key)) mrng = dupRng;
    alleles[gene.key] = [mutateAllele(gene, m.gamete[gene.key], mrng, mutationRate), mutateAllele(gene, d.gamete[gene.key], mrng, mutationRate)];
    marks[gene.key] = 1.0 + (((m.gameteMarks[gene.key] || 1) + (d.gameteMarks[gene.key] || 1)) / 2 - 1.0);
  }
  // v0.14: gene duplication — the evolvable-complexity machinery.
  // D1: newborn duplications no longer land dosage-active in extra. They land
  // SILENT in pool (the neutral buffer); only copies that demonstrate
  // divergence (div ≥ poolRecDiv) are recruited to expression. Drain — not
  // selection — is the default fate. This is the specie answer, mechanically:
  // duplication without immediate dosage shock, divergence before recruitment.
  // Extra copies from both gametes combine (at most one per gene: two
  // incoming copies resolve to one by drift). Deletion prunes active copies
  // at DEL_RATE (unchanged semantics); pool copies drain at the expressed
  // poolDrain locus. Choice genes are excluded — a second choice allele pair
  // has no expression path, which would be a dead gene by construction.
  const extra = {};
  for (const key of Object.keys(m.gameteExtra || {})) extra[key] = m.gameteExtra[key].slice();
  for (const key of Object.keys(d.gameteExtra || {})) {
    if (!extra[key] || prng.chance(0.5)) extra[key] = d.gameteExtra[key].slice();
  }
  const dupLog = [];
  for (const key of Object.keys(extra)) {
    if (prng.chance(DEL_RATE)) { delete extra[key]; dupLog.push({ kind: 'deletion', key }); }
  }
  // D1: the child's Q machinery, expressed (dupRate/poolDrain are legal G
  // targets — chemistry-gated evolvability from day one). Gating reads the
  // child's own fresh alleles/marks; chem is the mother's live chemistry.
  const childView = { alleles, marks, extra };
  const _gph = {};
  for (let i = 0; i < 8; i++) {
    _gph[`g${i}reg`] = GENE_MAP[`g${i}reg`].choices[alleles[`g${i}reg`][0]];
    _gph[`g${i}tgt`] = GENE_MAP[`g${i}tgt`].choices[alleles[`g${i}tgt`][0]];
    _gph[`g${i}thr`] = expressBase(childView, `g${i}thr`);
    _gph[`g${i}slope`] = expressBase(childView, `g${i}slope`);
  }
  const dupRate = expressBase(childView, 'dupRate') * gateMultiplier(_gph, 'dupRate', chem);
  const poolDrain = expressBase(childView, 'poolDrain') * gateMultiplier(_gph, 'poolDrain', chem);
  const poolRecDiv = expressBase(childView, 'poolRecDiv');
  const poolCap = GENE_MAP['poolCap'].choices[alleles['poolCap'][0]];
  // D1: the pool — silent duplicated pairs. Parental copies arrive via the
  // gametes (50% segregation); newborn duplications land here, never in extra.
  const pool = {};
  for (const key of Object.keys(m.gametePool || {})) {
    pool[key] = m.gametePool[key].map((c) => ({ ...c }));
  }
  for (const key of Object.keys(d.gametePool || {})) {
    const arr = d.gametePool[key].map((c) => ({ ...c }));
    if (pool[key]) pool[key].push(...arr); else pool[key] = arr;
  }
  const poolSize = () => Object.values(pool).reduce((n, arr) => n + arr.length, 0);
  // 1. Newborn duplications (P = expressed dupRate per non-choice gene) land
  //    in pool, carrying a snapshot of the gene's epigenetic mark.
  for (const gene of GENES) {
    if (gene.kind === 'choice') continue;
    if (prng.chance(dupRate)) {
      const [a, b] = alleles[gene.key];
      (pool[gene.key] || (pool[gene.key] = [])).push({ a, b, mark: marks[gene.key] ?? 1.0, age: 0, div: 0 });
      dupLog.push({ kind: 'duplication', key: gene.key });
    }
  }
  // 2. Pooled copies mutate independently (same MUTATION_RATE, pool
  //    sub-stream); divergence from the gene's CURRENT base pair tracked:
  //    div = |a − baseA| + |b − baseB|. Marks fade ×0.5/gen toward 1.
  for (const key of Object.keys(pool)) {
    const gene = GENE_MAP[key];
    if (!gene) { delete pool[key]; continue; }
    const [baseA, baseB] = alleles[key];
    for (const copy of pool[key]) {
      copy.a = mutateAllele(gene, copy.a, prng, mutationRate);
      copy.b = mutateAllele(gene, copy.b, prng, mutationRate);
      copy.age += 1;
      copy.mark = 1.0 + (copy.mark - 1.0) * 0.5;
      copy.div = Math.abs(copy.a - baseA) + Math.abs(copy.b - baseB);
    }
  }
  // 3. Drain: each pooled copy deleted with P = expressed poolDrain.
  //    Drain is the default fate.
  for (const key of Object.keys(pool)) {
    pool[key] = pool[key].filter((copy) => {
      if (prng.chance(poolDrain)) { dupLog.push({ kind: 'pool-drain', key }); return false; }
      return true;
    });
    if (pool[key].length === 0) delete pool[key];
  }
  // 4. Recruitment: a copy with div ≥ poolRecDiv is promoted to an active
  //    dosage copy in extra (if active slots remain under the 6-cap and the
  //    gene has no active copy — at most one extra pair per gene, as before;
  //    otherwise it waits in the pool). Promoted copies express exactly as
  //    today's duplicates do (phenotype() dosage-averaging).
  for (const key of Object.keys(pool)) {
    const kept = [];
    for (const copy of pool[key]) {
      if ((copy.div ?? 0) >= poolRecDiv && !extra[key] && Object.keys(extra).length < MAX_EXTRA) {
        extra[key] = [copy.a, copy.b];
        dupLog.push({ kind: 'recruitment', key, div: copy.div });
      } else {
        kept.push(copy);
      }
    }
    if (kept.length) pool[key] = kept; else delete pool[key];
  }
  // 5. Overflow: if the pool exceeds poolCap, the oldest copies drain first
  //    (age-ordered, no RNG needed).
  {
    const total = poolSize();
    if (total > poolCap) {
      const all = [];
      for (const key of Object.keys(pool)) for (const copy of pool[key]) all.push({ key, copy });
      all.sort((x, y) => y.copy.age - x.copy.age);
      for (let i = 0; i < total - poolCap; i++) {
        const { key, copy } = all[i];
        const arr = pool[key];
        arr.splice(arr.indexOf(copy), 1);
        dupLog.push({ kind: 'pool-overflow', key });
        if (arr.length === 0) delete pool[key];
      }
    }
  }
  // The copies mutate independently from birth — divergence starts now.
  for (const key of Object.keys(extra)) {
    const gene = GENE_MAP[key];
    if (!gene) { delete extra[key]; continue; }
    extra[key] = extra[key].map((a) => mutateAllele(gene, a, prng, mutationRate));
  }
  return { alleles, marks, extra, pool, dupLog };
}

// Nudge an epigenetic mark on one locus (0.5–1.5×). Called by life events:
// scarcity marks hungerRate up, isolation marks sociability, illness marks
// immunity. What life writes, time erodes.
export function markLocus(genome, key, delta) {
  if (!genome.marks || genome.marks[key] === undefined) return;
  genome.marks[key] = Math.max(0.5, Math.min(1.5, genome.marks[key] + delta));
}

// Express the diploid genome as observable traits. Floats average, then
// the epigenetic mark scales expression. Choice genes express the maternal
// allele (deterministic).
export function phenotype(genome) {
  const p = {};
  for (const gene of GENES) {
    const [a, b] = genome.alleles[gene.key];
    const mark = (genome.marks && genome.marks[gene.key]) || 1.0;
    if (gene.kind === 'choice') {
      p[gene.key] = gene.choices[a];
      continue;
    }
    // v0.14: duplicated copies average in by dosage — a newborn copy is an
    // identical twin of the base pair, then diverges by independent
    // mutation. Every copy is wired into expression from birth: no dead genes.
    let mean = (a + b) / 2;
    const xc = genome.extra && genome.extra[gene.key];
    if (xc) mean = (mean + (xc[0] + xc[1]) / 2) / 2;
    if (gene.kind === 'exp') {
      p[gene.key] = Math.max(0.05, mean * mark); // never capped above
    } else if (gene.kind === 'sym') {
      p[gene.key] = Math.max(-1, Math.min(1, mean * mark));
    } else {
      p[gene.key] = clamp01(mean * mark);
    }
  }
  // Derived, game-ready values (kept from v0.12):
  p.hueDeg = p.bodyHue * 360;
  p.bodyRadius = 14 + p.size * 18; // px at adult size
  // v2 (L): longevity scales the lifespan locus (founder ×1.0).
  p.lifespanSec = (300 + p.lifespan * 1500) * (0.5 + p.longScale); // 5–30 minutes
  p.walkSpeed = 28 + p.size * 26; // px/sec, bigger = slightly faster
  p.fruitEfficiency = { herbivore: 1.0, omnivore: 0.8, carnivore: 0.5 }[p.diet];
  p.meatEfficiency = { herbivore: 0.25, omnivore: 0.7, carnivore: 1.0 }[p.diet];
  p.biteSize = 0.2 + p.mouthSize * 0.3;
  p.sightRange = 420 * (0.7 + p.eyeSize * 0.6);
  p.legSpeedMult = 0.7 + p.legLength * 0.6;
  p.legDrainMult = 0.8 + p.legLength * 0.4;
  p.spikeFear = p.spikes * 0.25;
  p.spikeArmor = p.spikes * 0.3;
  p.furInsulation = p.fur * 0.3;
  p.furWeight = p.fur * 0.15;
  // canopy (new): climbing speed and grooming reach from morphology.
  // v2 (M): tailGrip adds a prehensile-strength bonus to climb speed.
  // v0.17 "Bauplan": evo-devo derivations — the developmental program's
  // gene-level potentials (budPotentials in sim/evodevo.js). All founder
  // values reproduce v0.15 exactly (asserted by test): areas 0,
  // graspPairs 2, bodySegs 1, every bonus +0.
  const _bp = budPotentials(p);
  p.wingArea = _bp.wingArea; p.sailArea = _bp.sailArea;
  p.gillArea = _bp.gillArea; p.finArea = _bp.finArea;
  p.graspPairs = _bp.graspPairs; p.bodySegs = _bp.bodySegs;
  // Always descends, never powered flight.
  p.glideLift = Math.min(0.85, _bp.wingArea * 1.2);
  p.brachMult = 1 + 0.35 * Math.max(0, _bp.graspPairs - 2);
  p.fallSoak = Math.min(0.9, (_bp.wingArea + _bp.sailArea) * 0.9);
  p.swimSpeed = p.walkSpeed * (0.3 + Math.min(1, _bp.finArea * 1.2));
  p.breathTime = 30 + _bp.gillArea * 300;
  p.slitherSpeed = p.walkSpeed * (0.9 + 0.1 * _bp.bodySegs);
  p.developDrain = (_bp.wingArea + _bp.sailArea + _bp.gillArea + _bp.finArea +
    Math.max(0, _bp.graspPairs - 2) * 0.5) * 0.004;
  p.wingUpkeep = _bp.wingArea * 0.0015;
  p.gillUpkeep = _bp.gillArea * 0.002;
  p.finUpkeep = _bp.finArea * 0.0012;
  // The limb economy: extra grasp pairs climb better; longer grasp limbs
  // extend grooming reach (the general manipulation affordance);
  // serpentine plans trade reach away.
  p.climbSpeed = 40 + p.legLength * 40 + p.tailLength * 20 + p.tailGrip * 30
    + Math.max(0, _bp.graspPairs - 2) * 15; // px/sec vertical
  p.groomReach = 40 + p.size * 30 + _bp.reachBonus - Math.max(0, _bp.bodySegs - 1) * 10;
  // v0.37 "Affect": displayAnatomy — the display prerequisite (design §5.1).
  // Derived from tail area + coloration: tails are for waving. The founder
  // has it (tailLength ~0.6 + patternDensity ~0.3, scaled to clear 1.0).
  // Not a genetic locus — it's what the anatomy affords, computed from
  // what the genes built.
  p.displayAnatomy = ((p.tailLength || 0) + (p.patternDensity || 0)) * 1.2;
  // v2 (D): drive tuning — gain + baseline on the chemical→drive readout.
  // Founder defaults are the identity: gain 1.0, baseline 0.
  // v0.37 "Affect": the four new drives tune the same way — selection sets
  // the emotional volume.
  for (const d of ['Hunger', 'Energy', 'Social', 'Fun', 'Fear', 'Libido', 'Curiosity', 'Attachment', 'Care']) {
    p['driveGain' + d] = 2 * p['drv' + d + 'Gain'];
    p['driveBase' + d] = (p['drv' + d + 'Base'] - 0.5) * 0.4;
  }
  // v2 (M): regional pigmentation — hue/sat offsets around the body base.
  for (const region of ['Head', 'Torso', 'Limbs']) {
    p['pig' + region + 'HueDeg'] = (p['pig' + region + 'Hue'] - 0.5) * 120;
    p['pig' + region + 'SatShift'] = (p['pig' + region + 'Sat'] - 0.5) * 40;
  }
  // v2 (M): the expressed coat color — the canonical readable coloration.
  // Torso is the largest region; mate preference matches against this, and
  // the later biomes phase can read it for camouflage selection. Per-region
  // values (pigHead/Torso/LimbsHueDeg/SatShift) are on the phenotype too.
  p.coatHue01 = ((((p.hueDeg + (p.pigTorsoHueDeg ?? 0)) % 360) + 360) % 360) / 360;
  p.coatSat01 = clamp01((58 + (p.pigTorsoSatShift ?? 0)) / 100);
  p.earScale = 0.7 + p.earSize * 0.6; // founder 0.5 → 1.0
  p.earTiltRad = (p.earTilt - 0.5) * 0.8; // founder 0.5 → upright
  return p;
}

// Fraction of alleles shared with another genome (0..1) — for family UI.
// v0.14: duplicated copies count — two genomes sharing a diverged copy are
// closer than two where one side carries a copy the other lacks.
export function relatedness(g1, g2) {
  let same = 0;
  let total = 0;
  for (const gene of GENES) {
    const [a1, b1] = g1.alleles[gene.key];
    const [a2, b2] = g2.alleles[gene.key];
    let s0;
    if (gene.kind === 'choice') {
      s0 = (a1 === a2 ? 0.5 : 0) + (b1 === b2 ? 0.5 : 0);
    } else if (gene.kind === 'sym') {
      // Signed alleles span [-1, 1]: normalize the distance by the range.
      s0 = (1 - Math.abs(a1 - a2) / 2) * 0.5 + (1 - Math.abs(b1 - b2) / 2) * 0.5;
    } else if (gene.kind === 'exp') {
      // Unbounded loci compare relatively — absolute distance is meaningless.
      const rel = (x, y) => 1 - Math.min(1, Math.abs(x - y) / Math.max(x, y, 1e-6));
      s0 = rel(a1, a2) * 0.5 + rel(b1, b2) * 0.5;
    } else {
      s0 = (1 - Math.abs(a1 - a2)) * 0.5 + (1 - Math.abs(b1 - b2)) * 0.5;
    }
    // v0.14: copy-number-aware. Shared copies compare allele-by-allele and
    // average with the base; a copy only one side carries discounts similarity.
    const x1 = g1.extra && g1.extra[gene.key];
    const x2 = g2.extra && g2.extra[gene.key];
    if (x1 && x2) {
      let se;
      if (gene.kind === 'sym') {
        se = (1 - Math.abs(x1[0] - x2[0]) / 2) * 0.5 + (1 - Math.abs(x1[1] - x2[1]) / 2) * 0.5;
      } else if (gene.kind === 'exp') {
        const rel = (x, y) => 1 - Math.min(1, Math.abs(x - y) / Math.max(x, y, 1e-6));
        se = rel(x1[0], x2[0]) * 0.5 + rel(x1[1], x2[1]) * 0.5;
      } else {
        se = (1 - Math.abs(x1[0] - x2[0])) * 0.5 + (1 - Math.abs(x1[1] - x2[1])) * 0.5;
      }
      same += (s0 + se) / 2;
    } else if (x1 || x2) {
      same += s0 * 0.75;
    } else {
      same += s0;
    }
    total += 1;
  }
  return same / total;
}

// v0.14: genome distance — the speciation metric. 0 = identical, 1 = nothing shared.
export function genomeDistance(g1, g2) {
  return 1 - relatedness(g1, g2);
}
