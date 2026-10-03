// A tanglekin brain: sparse associative network, shaped by reward.
// Senses in → hidden layer(s) → action-drives out. Instincts are
// MATERIAL-TRACK PORT (M2 Loam) of sim/brain.js (v0.37 lineage).
// Ported, not rewritten: the sparse 3-layer net, decide(), learn(), and the
// instinct-gene wiring are unchanged. What changed for the material world:
//   - N_IN 44 → 47 (three appended material senses: digAhead/soilBelow/enclosed)
//   - ACTIONS +3 (pile, instPile, geophagy — append-only, never renumbered)
//   - instinct wiring also reads M2_GENES (./genes.js)
// The platform track's sim/brain.js is untouched; its tests still pin N_IN=44.
// evolvable sense→action reflexes wired straight from instinct genes
// (nature); the sparse middle learns from experience (nurture).
//
// Machinery (from Emberhollow): sparse connectivity (adjacency lists),
// winner-take-all inhibition in the hidden layers, reward-modulated Hebbian
// plasticity (winner learns at full rate, sensory→associative at 1/3),
// attention gating (EMA of salience sharpens what the brain listens to),
// neurogenesis in juveniles + pruning in adults.
//
// GENOME v2 (B family): the brainPlan gene splits the brainSize neuron
// budget across 1–3 hidden layers; sparsity, Hebbian rate, lateral
// inhibition, attention gates, eligibility traces, and chemical
// neuromodulation of learning are all evolvable. Founder defaults reproduce
// the classic single-layer brain exactly.
//
// Contracts kept from Wildcode v0.12 (borrowed from paulthecat):
// ACTIONS, senseVector, decide(brain, input, exploration, rng, votes),
// learn(brain, pheno, reward, chems?), forward. The instinct genes wire
// sense→action directly, exactly as before.

import { GENES } from '../sim/genome.js';
import { M2_GENES } from './genes.js';

export const ACTIONS = [
  'seekFood', // move toward nearest food
  'eat', // consume adjacent food
  'sleep', // lie down, restore energy
  'play', // interact with toy/critter
  'approach', // move toward nearest creature
  'flee', // move away from threat/scary thing
  'mate', // approach & court nearest adult creature
  'wander', // explore randomly
  'seekHome', // walk back toward the imprinted home range
  'climb', // move up/down a climb link to another branch
  'groom', // groom the nearest creature — the troop's bonding ritual
  'jump', // leap: gravity's answer to the gap between branches (physics)
  'vocal', // call out: grounded call type, evolvable pitch (v0.14 Voices)
  'glide', // launch and ride the air — needs real wings (v0.17 Bauplan)
  'brachiate', // arm-swing along the branch — wants a third grasp pair (v0.17)
  'swim', // paddle — the water verb, dormant until v0.18 (v0.17)
  'dive', // hold depth — needs real gills (v0.17)
  'drink', // drink adjacent water — restores hydration (v0.18 Realms)
  'bask', // stationary sunning — restores coreTemp in warmth (v0.18 Realms)
  'dig', // dig at the ground — unearths buried food (v0.18 Realms)
  'grasp', // pick up the nearest manipulable object within reach (v0.20 Hands)
  'carry', // wield what is held — the strike-with-object lives here (v0.20 Hands)
  'drop', // release the held object with the carrier's velocity (v0.20 Hands)
  'bite', // strike the nearest creature in range — the attack verb, ordinary
  // machinery (v0.22 Web of Life). Damage = f(mouthSize × mass) vs
  // spikeArmor; fatigue-billed; spikes retaliate. No prey-finding cheats.
  'display', // v0.37 "Affect": courtship display — rhythmic movement + coloration
  // flashing; intensity scales with sexHormone. ANATOMY: displayAnatomy ≥ 1
  // (design §5.1 — derived from tail area + coloration; the founder has it).
  'inspect', // v0.37: slow approach to the novel object; the look satisfies.
  // ANATOMY: none — novelty-seeking is the anatomy (design §5.2).
  'cuddle', // v0.37: close body contact — juveniles with adults, adults with
  // juveniles or pair-bonded partners. ANATOMY: graspPairs ≥ 1 (design §5.3).
  'tend', // v0.37: stay near offspring, share food, stand ground.
  // ANATOMY: graspPairs ≥ 1 (design §5.4 — food-sharing needs hands or a mouth).
  'seekBond', // v0.37: go to the absent pair-bonded partner's last known position.
  // ANATOMY: locomotion — graspPairs ≥ 1 or slitherSpeed > 0 (design §5.5).
  'mourn', // v0.37: go to the death site; stay; the grief call.
  // ANATOMY: locomotion — graspPairs ≥ 1 or slitherSpeed > 0 (design §5.6).
  'pile', // M2 Loam: place carried soil into the facing air cell — construction.
  // ANATOMY: graspPairs ≥ 1 (hands to place with).
  'instPile', // M2 Loam: dump carried soil at the feet, fast and loose.
  // ANATOMY: none — dropping needs no hands.
  'geophagy', // M2 Loam: eat soil for minerals — the mineral drive's answer.
  // ANATOMY: none — a mouth is enough.
];

export const N_IN = 47; // 46 senses + bias... see senseVector47
const N_OUT = ACTIONS.length;

const ATTENTION_ALPHA = 0.15; // EMA rate for attention
const ATTENTION_SHARPNESS = 3.0; // softmax sharpness on attention
const PLASTICITY_CLAMP = 1.5; // Hebbian weights live in [-1.5, 1.5]
const MIN_ASSOC = 16; // pruning never goes below this

// senses: [hunger, tiredness, boredom, loneliness, fear, light,
//           foodDist, foodDir, creatureDist, creatureDir, toyDist, toyDir,
//           isAdult, illness, homeDist, kinNear, bondNear,
//           climbUp, climbDown, groomNear, jumpNear, callHeard, callPitch,
//           wasteOdor, airborne, farLedge, submerged, waterNear,
//           thirst, cold, heat, buriedNear, objectNear, heldWeight, falling,
//           creatureSize, phaseSleepiness, pain, libido, curiosity,
//           attachment, care, pairNear, bias]
// v0.12 rule kept: never renumber. New senses append before the bias.
export function senseVector(s) {
  return [
    s.hunger, s.tiredness, s.boredom, s.loneliness, s.fear, s.light,
    s.foodDist, s.foodDir, s.creatureDist, s.creatureDir,
    s.toyDist, s.toyDir, s.isAdult, s.illness,
    s.homeDist || 0, s.kinNear || 0, s.bondNear || 0,
    s.climbUp || 0, s.climbDown || 0, s.groomNear || 0, s.jumpNear || 0,
    s.callHeard || 0, s.callPitch || 0, s.wasteOdor || 0,
    s.airborne || 0, s.farLedge || 0, s.submerged || 0, s.waterNear || 0,
    s.thirst || 0, s.cold || 0, s.heat || 0, s.buriedNear || 0,
    s.objectNear || 0, s.heldWeight || 0, // v0.20: the hands senses
    s.falling || 0, // v0.20 "Falling": the vestibular sense — appended, never renumbered
    s.creatureSize || 0, // v0.22 "Web of Life": relative mass of nearest creature, no identity
    s.phaseSleepiness || 0, // v0.28 "Day and night": the phase-sleepiness sense — appended, never renumbered
    s.pain || 0, // v0.32 "Nervous system": nociception — appended, never renumbered
    s.libido || 0, // v0.37 "Affect": the felt need for mating — appended, never renumbered
    s.curiosity || 0, // v0.37: the felt need for novelty
    s.attachment || 0, // v0.37: longing for the pair-bonded partner
    s.care || 0, // v0.37: the need to tend young
    s.pairNear || 0, // v0.37: pair-bond strength with the nearest creature
    s.digAhead || 0, // M2 Loam: diggability of the facing cell (sense 43)
    s.soilBelow || 0, // M2 Loam: material under feet, rock 0 → soil 1 (sense 44)
    s.enclosed || 0, // M2 Loam: fraction of solid neighbors — the burrow sense (45)
    1,
  ];
}

// senseVector47 is the material track's sense vector. The platform track's
// senseVector (44 inputs) is untouched in sim/brain.js; this one carries
// the three appended material senses. Never renumber: 43/44/45 stay.
export { senseVector as senseVector47 };

function assocSize(pheno) {
  // The brainSize locus sizes the associative layer: 100 × expressed value,
  // with NO upper cap — founder 8.0 gives ~800 (emberling scale) and evolution
  // may drive it upward without bound. Floor of 16 keeps degenerate genomes alive.
  return Math.max(16, Math.round(100 * (pheno.brainSize ?? 8.0)));
}

function randSparse(rng, rows, cols, density, scale) {
  // Adjacency lists: for each row, [colIndices], [weights].
  const idx = [];
  const w = [];
  for (let r = 0; r < rows; r++) {
    // v0.14: clamp to cols — a density near 1 could otherwise ask for more
    // distinct inputs than exist, hanging the while loop forever.
    const n = Math.min(cols, Math.max(1, Math.round(cols * density * (0.5 + rng.next()))));
    const cols_ = new Set();
    while (cols_.size < n) cols_.add(rng.int(0, cols - 1));
    idx.push([...cols_]);
    w.push([...cols_].map(() => rng.range(-scale, scale)));
  }
  return { idx, w };
}

export function createBrain(pheno, rng) {
  const nAssoc = assocSize(pheno);
  // v2 (B): brainPlan splits the brainSize neuron budget across 1–3 hidden
  // layers (founder 1 = the classic single-layer brain). Layers get an
  // even split; every layer keeps ≥ 4 neurons.
  const nLayers = Math.min(3, Math.max(1, Math.round(pheno.bpLayers ?? 1)));
  const sizes = [];
  {
    const base = Math.floor(nAssoc / nLayers);
    let rem = nAssoc - base * nLayers;
    for (let l = 0; l < nLayers; l++) sizes.push(base + (rem-- > 0 ? 1 : 0));
  }
  // v2 (B): evolvable sparsity — density = 1 − sparsity. Founder → 0.35,
  // exactly the classic sensory→assoc wiring density.
  const s2aDensity = 1 - (pheno.bpSparsity ?? 0.65);
  const layers = [];
  let fanIn = N_IN - 1;
  for (let l = 0; l < nLayers; l++) {
    const m = randSparse(rng, sizes[l], fanIn, l === 0 ? s2aDensity : 0.5, 0.9);
    layers.push({
      n: sizes[l],
      idx: m.idx,
      w: m.w,
      bias: Array.from({ length: sizes[l] }, () => rng.range(-0.2, 0.2)),
    });
    fanIn = sizes[l];
  }
  // Associative → motor: sparse (density ~0.5), motor units map 1:1 to actions.
  // Loam M2: ZERO init (not the platform's 0.9). A newborn's learned
  // associations start blank; the instinct pathway is the prior and Hebbian
  // learning builds on it. At 0.9 the random readout noise (±1.5) drowns the
  // instincts (±1.2) — measured: a starving grub with food in reach outputs
  // cuddle 0.92 / dive 0.86 from pure noise while EAT sits at 0.12. Even at
  // 0.1 the fan-in norm (sqrt(44/cols) ≈ 2.3 for small brains) amplifies the
  // noise back to ±1.0. Zero is the only honest blank slate; learning (with
  // the tamed rate below) grows the weights it earns.
  const _a2mInit = randSparse(rng, N_OUT, sizes[nLayers - 1], 0.5, 0.9);
  const a2m = { idx: _a2mInit.idx, w: _a2mInit.w.map((row) => row.map(() => 0)) };
  const biasM = new Array(N_OUT).fill(0);

  // Instincts: evolvable sense→action reflexes, wired straight from the genome.
  // Each instinct gene's [0,1] phenotype maps to a weight in [-1.2, 1.2].
  // These weights are genetic — they change only via inheritance + mutation.
  const instW = Array.from({ length: N_OUT }, () => new Array(N_IN).fill(0));
  for (const gene of GENES) {
    if (gene.sense === undefined || gene.action >= N_OUT) continue;
    instW[gene.action][gene.sense] = (pheno[gene.key] - 0.5) * 2.4;
  }
  // M2 Loam: the new verbs get their instinct genes (Paul's v0.5 rule —
  // every new action needs an instinct gene). Same wiring, same scale.
  for (const gene of M2_GENES) {
    if (gene.sense === undefined || gene.action >= N_OUT) continue;
    // Founder-constant in M2 (no alleles yet — see genes.js): read the
    // founder default when the phenotype lacks the key. Never NaN.
    const v = pheno[gene.key] ?? gene.founder ?? 0.5;
    instW[gene.action][gene.sense] = (v - 0.5) * 2.4;
  }

  // Small personality baselines so newborns aren't blank slates.
  biasM[0] = 0.15; // seekFood
  biasM[1] = 0.1; // eat
  biasM[2] = 0.05; // sleep
  biasM[3] = pheno.curiosity * 0.4; // play
  biasM[4] = pheno.sociability * 0.4; // approach
  biasM[5] = (1 - pheno.boldness) * 0.25; // flee
  biasM[6] = 0.05; // mate
  biasM[7] = 0.1 + pheno.curiosity * 0.25; // wander
  biasM[8] = 0.05; // seekHome — the homeward pull starts as a whisper
  biasM[9] = 0.05; // climb — curiosity about the vertical
  biasM[10] = pheno.sociability * 0.4; // groom — the social instinct
  biasM[12] = 0.03; // vocal — answering calls starts as a whisper
  biasM[17] = 0.05; // drink — water is worth a nudge
  biasM[18] = 0.02; // bask — a whisper of sun-seeking
  biasM[19] = 0.02; // dig — scratching at dirt starts as a whisper
  biasM[20] = 0.02; // grasp — hands are curious (v0.20 Hands)
  biasM[21] = 0; // carry — wielding unheld nothing is silence
  biasM[22] = 0.02; // drop — the put-down whisper (v0.20 Hands)
  biasM[24] = 0.03; // display — courtship starts as a whisper (v0.37 Affect)
  biasM[25] = 0.03; // inspect — novelty deserves a look
  biasM[26] = pheno.sociability * 0.2; // cuddle — the intimate social instinct
  biasM[27] = 0.04; // tend — the young are worth a nudge
  biasM[28] = 0.03; // seekBond — longing starts as a whisper
  biasM[29] = 0.02; // mourn — grief's whisper is quiet
  biasM[30] = 0.02; // pile — building starts as a whisper (M2 Loam)
  biasM[31] = 0.01; // instPile — dumping is quieter than building (M2 Loam)
  biasM[32] = 0.02; // geophagy — the earth-eating whisper (M2 Loam)

  return {
    nAssoc,
    nLayers,
    layerSizes: sizes,
    layers,
    // Compat: the classic single-layer fields address layer 0. Tests and
    // old saves read brain.s2a / brain.biasA; they still work.
    s2a: layers[0],
    biasA: layers[0].bias,
    a2m, biasM, instW,
    // v2 (B): architecture readouts, fixed at construction — genes set the
    // plan, the brain builds it once.
    latInhibScale: Math.max(0.02, 1 - (pheno.bpLatInhib ?? 0.85)), // founder → 0.15
    s2aDensity,
    gate: {
      count: Math.round((pheno.agCount ?? 0) * 5),
      gain: pheno.agGain ?? 0,
      thresh: pheno.agThresh ?? 0.5,
    },
    // v2 (B): eligibility traces — one per motor synapse, for delayed credit.
    traces: { e: a2m.w.map((row) => new Array(row.length).fill(0)) },
    attention: new Array(N_IN - 1).fill(1 / (N_IN - 1)), // EMA of salience
    age: 0, // brain age in ticks (drives neurogenesis → pruning)
    neurogenesis: 0.3 + (pheno.neurogenesis ?? 0.5) * 0.7,
    rng, // seeded RNG — neurogenesis/pruning stay deterministic
    lastAssoc: null, lastActs: null, lastWinners: null,
    lastOut: null, lastInput: null, lastWinner: -1,
  };
}

const tanh = (x) => Math.tanh(x);

// Expected a2m fan-in at the original ~88-neuron scale (density 0.5).
// The motor readout normalizes against this so learned-pathway magnitude
// is invariant to brain size.
const REF_FANIN = 44;

// Attention: sharpen the sense vector by the EMA of recent salience.
// What the brain has been attending to shapes what it hears now.
function applyAttention(brain, input) {
  const att = brain.attention;
  const gated = new Array(N_IN - 1);
  let sum = 0;
  const sharp = [];
  for (let k = 0; k < N_IN - 1; k++) {
    const e = Math.exp(att[k] * ATTENTION_SHARPNESS);
    sharp.push(e);
    sum += e;
  }
  for (let k = 0; k < N_IN - 1; k++) {
    gated[k] = input[k] * (sharp[k] / sum) * (N_IN - 1);
  }
  // v2 (B): attention gates — the most-salient senses (above thresh, up to
  // count of them) get a gain boost. Founder count 0 → off: the classic
  // attention behavior above, exactly as before.
  const gate = brain.gate;
  if (gate && gate.count > 0 && gate.gain !== 0) {
    const top = [];
    for (let k = 0; k < N_IN - 1; k++) {
      if (att[k] < gate.thresh) continue;
      if (top.length < gate.count) {
        top.push(k);
      } else {
        let minI = 0;
        for (let i = 1; i < top.length; i++) if (att[top[i]] < att[top[minI]]) minI = i;
        if (att[k] > att[top[minI]]) top[minI] = k;
      }
    }
    for (const k of top) gated[k] *= (1 + gate.gain);
  }
  return gated;
}

export function forward(brain, input) {
  // v0.13.1: sanitize the sense vector — a single NaN sense would poison
  // every activation downstream (tanh(NaN) = NaN, and NaN comparisons in
  // winner-take-all silently misbehave). A dead sense reads as 0.
  for (let k = 0; k < input.length; k++) {
    if (!Number.isFinite(input[k])) input[k] = 0;
  }
  const gated = applyAttention(brain, input);
  // v2 (B): the neuron budget may be split across hidden layers. Layer 0
  // reads the gated senses (+ bias sense); each deeper layer reads the
  // layer before; the motor readout reads the last layer. At founder
  // defaults (1 layer) this is the classic forward pass exactly.
  const nL = brain.nLayers ?? 1;
  const acts = new Array(nL);
  const winners = new Array(nL);
  let src = gated;
  for (let l = 0; l < nL; l++) {
    const L = brain.layers[l];
    const a = new Array(L.n);
    for (let i = 0; i < L.n; i++) {
      let pre = L.bias[i];
      const cols = L.idx[i];
      const ws = L.w[i];
      for (let n = 0; n < cols.length; n++) pre += ws[n] * src[cols[n]];
      if (l === 0) pre += input[N_IN - 1]; // the bias sense
      a[i] = tanh(pre);
    }
    // Winner-take-all: the strongest neuron inhibits the rest. One thought
    // at a time — every layer commits. Inhibition is evolvable (founder:
    // losers scaled to 0.15, exactly as before).
    let winner = 0;
    let best = -Infinity;
    for (let i = 0; i < L.n; i++) {
      if (a[i] > best) { best = a[i]; winner = i; }
    }
    const loserScale = brain.latInhibScale ?? 0.15;
    for (let i = 0; i < L.n; i++) {
      if (i !== winner) a[i] *= loserScale;
    }
    acts[l] = a;
    winners[l] = winner;
    src = a;
  }
  const assoc = acts[nL - 1];
  // Motor: sparse readout, 1:1 with actions. The learned sum is normalized
  // by fan-in so its magnitude stays size-invariant: without this, a large
  // brain's random readout noise drowns the instinct pathway. REF_FANIN is
  // the expected fan-in at the original ~88-neuron scale, so behavior there
  // is unchanged and bigger brains keep the same signal balance.
  const { idx: mIdx, w: mW } = brain.a2m;
  const o = new Array(N_OUT);
  for (let j = 0; j < N_OUT; j++) {
    let pre = brain.biasM[j];
    const cols = mIdx[j];
    const ws = mW[j];
    const norm = Math.sqrt(REF_FANIN / Math.max(1, cols.length));
    for (let n = 0; n < cols.length; n++) pre += ws[n] * assoc[cols[n]] * norm;
    const iw = brain.instW[j];
    for (let k = 0; k < N_IN; k++) pre += iw[k] * input[k];
    o[j] = tanh(pre);
  }
  brain.lastAssoc = assoc;
  brain.lastActs = acts;
  brain.lastWinners = winners;
  brain.lastOut = o;
  brain.lastInput = input;
  brain.lastWinner = winners[0];
  // Attention EMA: salience = |sense value|.
  for (let k = 0; k < N_IN - 1; k++) {
    brain.attention[k] = (1 - ATTENTION_ALPHA) * brain.attention[k] +
      ATTENTION_ALPHA * Math.abs(input[k]);
  }
  return o;
}

export function decide(brain, input, exploration, rng, votes = null) {
  const o = forward(brain, input);
  let best = 0;
  let bestScore = -Infinity;
  for (let j = 0; j < N_OUT; j++) {
    // Recall votes nudge the choice but are NOT stored in lastOut —
    // learning reinforces what the brain itself computed, not the nudge.
    const score = o[j] + (votes ? votes[j] : 0) + rng.range(-exploration, exploration);
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return { action: ACTIONS[best], index: best, outputs: o };
}

function clampW(w) {
  // v0.13.1: NaN passes straight through the comparisons below, so check
  // finiteness first — a poisoned weight resets to 0 instead of spreading.
  if (!Number.isFinite(w)) return 0;
  return w < -PLASTICITY_CLAMP ? -PLASTICITY_CLAMP : w > PLASTICITY_CLAMP ? PLASTICITY_CLAMP : w;
}

// Reward-modulated Hebbian learning. reward in [-1, 1]. The winning
// associative neuron learns at full rate; sensory→associative synapses at
// 1/3 (the world model changes slower than the action model).
// v2 (B): eligibility traces for delayed credit assignment. Each motor
// synapse carries a trace of recent pre×post co-activity; when reward
// arrives late, the trace says who was responsible. Decay and gain are
// genetic (founder gain 0 → off).
function updateTraces(brain, pheno) {
  const decay = pheno.mtDecay ?? 0.9;
  const gain = pheno.mtGain ?? 0;
  if (gain === 0) return;
  const assoc = brain.lastAssoc;
  const o = brain.lastOut;
  for (let j = 0; j < N_OUT; j++) {
    const cols = brain.a2m.idx[j];
    const es = brain.traces.e[j];
    for (let n = 0; n < cols.length; n++) {
      // v0.13.1: a non-finite trace never recovers (decay × NaN = NaN),
      // so reset it instead of propagating it.
      const e = decay * es[n] + gain * assoc[cols[n]] * o[j];
      es[n] = Number.isFinite(e) ? e : 0;
    }
  }
}

export function learn(brain, pheno, reward, chems = null) {
  if (!brain.lastAssoc || !brain.lastOut || !brain.lastInput || reward === 0) return;
  // NaN guard (v0.13.1): a non-finite reward poisons every weight it
  // touches — Math.max/Math.min pass NaN straight through, so the old
  // clamp was no protection. Skip the update; the next tick brings a
  // fresh reward.
  if (!Number.isFinite(reward)) return;
  // Structural guard (v0.13.1): neurogenesis/pruning can change the layer
  // sizes AFTER the last forward() — decide() runs on a commitment timer
  // while learn() runs every tick, so the cached activations may address a
  // stale architecture (assoc[719] on a 719-long vector = undefined = NaN,
  // which then spread through traces and weights and starved seed-21
  // lineages next to uneaten food). Refresh the caches when they no
  // longer match the live architecture.
  const lastLayer = brain.layers[brain.nLayers - 1];
  if (brain.lastAssoc.length !== lastLayer.n) {
    forward(brain, brain.lastInput);
  }
  updateTraces(brain, pheno);
  // v2 (B): the Hebbian rate is evolvable — founder → ×1.0, the classic rate.
  // Loam M2: tamed base (0.005, not 0.02). At 0.02 a single reward event
  // moves weights by ~0.1/tick — enough to rebuild the readout noise (±1.5)
  // from a zero init within 30 ticks, re-drowning the instincts. Learning
  // must be slow refinement on top of a working prior, not rapid overwriting.
  let lr = (0.005 + (pheno.learningRate ?? 0.5) * 0.045) * (2 * (pheno.bpHebb ?? 0.5));
  // v2 (B): neuromodulation — a chemical level scales the learning rate.
  // Founder gain 0 → no modulation, exactly as before. When evolved, the
  // modulator gene picks the chemical (founder: adrenaline — stress tunes
  // learning) and the threshold above which it bites.
  const nmGain = pheno.nmGain ?? 0;
  if (chems && nmGain !== 0) {
    const chemVal = chems[pheno.nmChem ?? 'adrenaline'] ?? 0;
    lr *= 1 + nmGain * Math.max(0, chemVal - (pheno.nmThresh ?? 0.5));
  }
  const r = Math.max(-1, Math.min(1, reward));
  const traceGain = pheno.mtGain ?? 0;
  const assoc = brain.lastAssoc;
  const o = brain.lastOut;
  // Motor layer: Hebbian on the last hidden layer's pattern, plus
  // eligibility traces for delayed credit.
  for (let j = 0; j < N_OUT; j++) {
    const err = lr * r * o[j];
    const cols = brain.a2m.idx[j];
    const ws = brain.a2m.w[j];
    const es = brain.traces.e[j];
    for (let n = 0; n < cols.length; n++) {
      ws[n] = clampW(ws[n] + err * (assoc[cols[n]] + traceGain * es[n]));
    }
    brain.biasM[j] = clampW(brain.biasM[j] + err * 0.3);
  }
  // Hidden layers: winner at full rate, others at 1/3. The same rule runs
  // on every layer — layer 0 sees the senses, deeper layers see the layer
  // before. (Classic behavior at founder defaults: one layer, ×1.0.)
  const acts = brain.lastActs ?? [assoc];
  const winners = brain.lastWinners ?? [brain.lastWinner];
  const x = brain.lastInput;
  for (let l = 0; l < (brain.nLayers ?? 1); l++) {
    const L = brain.layers[l];
    const src = l === 0 ? x : acts[l - 1];
    const winner = winners[l];
    const a = acts[l];
    for (let i = 0; i < L.n; i++) {
      const rate = (i === winner ? lr : lr / 3) * r;
      if (rate === 0) continue;
      const cols = L.idx[i];
      const ws = L.w[i];
      for (let n = 0; n < cols.length; n++) {
        ws[n] = clampW(ws[n] + rate * src[cols[n]] * a[i]);
      }
    }
  }
  brain.age++;
  maybeGrow(brain, pheno);
}

// Neurogenesis in juveniles, pruning in adults. Growth happens on the LAST
// hidden layer (the motor-adjacent one) \u2014 for the classic single-layer
// brain this is the associative layer, exactly as before. The brain grows
// while the body is young, then trims the least-used neurons \u2014 but the
// classic brain never drops below 16, and a deeper brain never drops a
// layer below 8.
function maybeGrow(brain, pheno) {
  const rng = brain.rng;
  const p = brain.neurogenesis * 0.01;
  const juvenile = brain.age < 3000; // ~first minutes of life at 10Hz
  // No cap on growth: the juvenile window (~+40 neurons typical) bounds it.
  // Adult brains trim dead weight but the genetic scale survives aging.
  const last = brain.layers[brain.nLayers - 1];
  const floor = brain.nLayers === 1 ? MIN_ASSOC : 8;
  if (juvenile && rng.chance(p * 2)) {
    addAssocNeuron(brain);
  } else if (!juvenile && rng.chance(p * 0.5) && last.n > floor && brain.nAssoc > MIN_ASSOC) {
    pruneAssocNeuron(brain);
  }
}

function addAssocNeuron(brain) {
  const rng = brain.rng;
  const li = brain.nLayers - 1;
  const L = brain.layers[li];
  // New neuron: sparse inputs from the previous layer (senses for layer 0),
  // sparse outputs into the motor readout.
  const prevN = li === 0 ? N_IN - 1 : brain.layers[li - 1].n;
  const density = li === 0 ? (brain.s2aDensity ?? 0.35) : 0.5;
  const nIn = Math.max(1, Math.round(prevN * density * (0.5 + rng.next())));
  const cols = new Set();
  while (cols.size < nIn) cols.add(rng.int(0, prevN - 1));
  L.idx.push([...cols]);
  L.w.push([...cols].map(() => rng.range(-0.9, 0.9)));
  L.bias.push(rng.range(-0.2, 0.2));
  const newIdx = L.n;
  L.n++;
  // Wire into motor readout sparsely.
  for (let j = 0; j < N_OUT; j++) {
    if (rng.chance(0.5)) {
      brain.a2m.idx[j].push(newIdx);
      brain.a2m.w[j].push(rng.range(-0.9, 0.9));
      brain.traces.e[j].push(0);
    }
  }
  brain.nAssoc++;
}

function pruneAssocNeuron(brain) {
  // Prune the neuron with the weakest total motor weight (least useful).
  const li = brain.nLayers - 1;
  const L = brain.layers[li];
  let weakest = 0;
  let weakScore = Infinity;
  for (let i = 0; i < L.n; i++) {
    let s = 0;
    for (let j = 0; j < N_OUT; j++) {
      const idx = brain.a2m.idx[j].indexOf(i);
      if (idx >= 0) s += Math.abs(brain.a2m.w[j][idx]);
    }
    s += Math.abs(L.bias[i]);
    if (s < weakScore) { weakScore = s; weakest = i; }
  }
  L.idx.splice(weakest, 1);
  L.w.splice(weakest, 1);
  L.bias.splice(weakest, 1);
  L.n--;
  for (let j = 0; j < N_OUT; j++) {
    const idx = brain.a2m.idx[j].indexOf(weakest);
    if (idx >= 0) {
      brain.a2m.idx[j].splice(idx, 1);
      brain.a2m.w[j].splice(idx, 1);
      brain.traces.e[j].splice(idx, 1);
    }
    // Shift indices above the removed neuron down.
    for (let n = 0; n < brain.a2m.idx[j].length; n++) {
      if (brain.a2m.idx[j][n] > weakest) brain.a2m.idx[j][n]--;
    }
  }
  brain.nAssoc--;
}

// A newborn's brain inherits structure from its parents: sparse topology is
// resampled, but the instinct wiring (genetic) is fresh and the attention
// prior starts uniform. Kept for API parity with the Emberhollow design.
export function inheritStructure(pheno, rng) {
  return createBrain(pheno, rng);
}
