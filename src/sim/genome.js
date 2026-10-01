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
);
// === end GENOME v0.22 loci =================================================
export const WEB22_KEYS = new Set(GENES.slice(WEB22_START).map((g) => g.key));

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
for (let i = 0; i < 4; i++) _chrS.push(`st${i}event`, `st${i}val`, `st${i}int`);
const _chrD = [];
for (const d of ['Hunger', 'Energy', 'Social', 'Fun', 'Fear']) _chrD.push(`drv${d}Gain`, `drv${d}Base`);
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
   'coldTol', 'heatTol'],
  // 2 — Metabolism
  ['hungerRate', 'energyDrain', 'lifespan', 'growthRate', 'fertility', 'immunity'],
  // 3 — Neuroarchitecture (+ v2 family B: brain plan, attention gates,
  // memory traces, neuromodulation)
  ['learningRate', 'memory', 'brainSize',
   'bpLayers', 'bpSparsity', 'bpHebb', 'bpLatInhib',
   'agCount', 'agGain', 'agThresh', 'mtDecay', 'mtGain',
   'nmChem', 'nmGain', 'nmThresh'],
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
];

const MUTATION_RATE = 0.008; // per allele

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function randomAllele(gene, rng) {
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
export function randomGenome(rng, opts = {}) {
  // opts.pinSub (number): when set, the language (v0.16), evo-devo (v0.17),
  // realms (v0.18), hands/falling (v0.20) and web-of-life (v0.22)
  // sub-stream passes seed from hash(pin, passSalt) instead of the content
  // hash — identical sub-stream alleles across founders with different
  // main-stream content.
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
  const isNew17 = (k) => EVO17_KEYS.has(k);
  const isNew18 = (k) => REALMS18_KEYS.has(k);
  const isNew20 = (k) => HANDS20_KEYS.has(k);
  const isNewFalling = (k) => FALLING20_KEYS.has(k);
  const isNewWeb22 = (k) => WEB22_KEYS.has(k);
  const isNewer = (k) => isNew17(k) || isNew18(k) || isNew20(k) || isNewFalling(k) || isNewWeb22(k);
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
    if (isNew18(gene.key) || isNew20(gene.key) || isNewFalling(gene.key) || isNewWeb22(gene.key)) continue;
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
    if (isNew20(gene.key) || isNewFalling(gene.key) || isNewWeb22(gene.key)) continue;
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
    if (isNewWeb22(gene.key)) continue;
    for (const a of alleles[gene.key]) h5 = (Math.imul(h5, 31) + Math.floor(a * 1e9)) | 0;
  }
  const web22Rng = createRng(pinned ? hashPin(pinSub, PIN_SALT_WEB22) : h5 >>> 0);
  for (const gene of GENES) {
    if (!isNewWeb22(gene.key)) continue;
    alleles[gene.key] = [randomAllele(gene, web22Rng), randomAllele(gene, web22Rng)];
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
  return { alleles, marks, extra: {} };
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
export function meiosis(genome, rng) {
  const gamete = {};
  const gameteMarks = {};
  for (const chrom of CHROMOSOMES) {
    if (chrom.length === 0) continue;
    const nX = 1 + rng.int(0, 2);
    const points = new Set();
    while (points.size < nX && points.size < chrom.length - 1) {
      points.add(1 + rng.int(0, chrom.length - 2));
    }
    const cuts = [...points].sort((a, b) => a - b);
    let useFirst = rng.chance(0.5);
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
  const gameteExtra = {};
  for (const key of Object.keys(genome.extra || {})) {
    if (rng.chance(0.5)) gameteExtra[key] = genome.extra[key].slice();
  }
  return { gamete, gameteMarks, gameteExtra };
}

export function inherit(momGenome, dadGenome, rng, mutationRate = MUTATION_RATE) {
  const m = meiosis(momGenome, rng);
  const d = meiosis(dadGenome, rng);
  const alleles = {};
  const marks = {};
  for (const gene of GENES) {
    alleles[gene.key] = [mutateAllele(gene, m.gamete[gene.key], rng, mutationRate), mutateAllele(gene, d.gamete[gene.key], rng, mutationRate)];
    marks[gene.key] = 1.0 + (((m.gameteMarks[gene.key] || 1) + (d.gameteMarks[gene.key] || 1)) / 2 - 1.0);
  }
  // v0.14: gene duplication — the evolvable-complexity machinery.
  // Extra copies from both gametes combine (at most one per gene: two
  // incoming copies resolve to one by drift). Deletion prunes copies;
  // duplication copies the child's own fresh base pair. Choice genes are
  // excluded — a second choice allele pair has no expression path, which
  // would be a dead gene by construction.
  const extra = {};
  for (const key of Object.keys(m.gameteExtra || {})) extra[key] = m.gameteExtra[key].slice();
  for (const key of Object.keys(d.gameteExtra || {})) {
    if (!extra[key] || rng.chance(0.5)) extra[key] = d.gameteExtra[key].slice();
  }
  const dupLog = [];
  for (const key of Object.keys(extra)) {
    if (rng.chance(DEL_RATE)) { delete extra[key]; dupLog.push({ kind: 'deletion', key }); }
  }
  if (Object.keys(extra).length < MAX_EXTRA) {
    for (const gene of GENES) {
      if (gene.kind === 'choice' || extra[gene.key]) continue;
      if (rng.chance(DUP_RATE)) {
        extra[gene.key] = alleles[gene.key].slice(); // the newborn copy
        dupLog.push({ kind: 'duplication', key: gene.key });
        if (Object.keys(extra).length >= MAX_EXTRA) break;
      }
    }
  }
  // The copies mutate independently from birth — divergence starts now.
  for (const key of Object.keys(extra)) {
    const gene = GENE_MAP[key];
    if (!gene) { delete extra[key]; continue; }
    extra[key] = extra[key].map((a) => mutateAllele(gene, a, rng, mutationRate));
  }
  return { alleles, marks, extra, dupLog };
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
  // v2 (D): drive tuning — gain + baseline on the chemical→drive readout.
  // Founder defaults are the identity: gain 1.0, baseline 0.
  for (const d of ['Hunger', 'Energy', 'Social', 'Fun', 'Fear']) {
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
