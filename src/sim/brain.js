// A tanglekin brain: sparse 3-layer associative network, shaped by reward.
// Senses in → associative layer → action-drives out. Instincts are
// evolvable sense→action reflexes wired straight from instinct genes
// (nature); the sparse middle learns from experience (nurture).
//
// Machinery (from Emberhollow): sparse connectivity (adjacency lists),
// winner-take-all inhibition in the middle layer, reward-modulated Hebbian
// plasticity (winner learns at full rate, sensory→associative at 1/3),
// attention gating (EMA of salience sharpens what the brain listens to),
// neurogenesis in juveniles + pruning in adults (the middle layer grows
// then trims, never below 16 neurons).
//
// Contracts kept from Wildcode v0.12 (borrowed from paulthecat):
// ACTIONS, senseVector, decide(brain, input, exploration, rng, votes),
// learn(brain, pheno, reward), forward. The instinct genes wire
// sense→action directly, exactly as before.

import { GENES } from './genome.js';

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
];

export const N_IN = 22; // 20 senses + jumpNear + bias... see senseVector
const N_OUT = ACTIONS.length;

const ATTENTION_ALPHA = 0.15; // EMA rate for attention
const ATTENTION_SHARPNESS = 3.0; // softmax sharpness on attention
const PLASTICITY_CLAMP = 1.5; // Hebbian weights live in [-1.5, 1.5]
const MIN_ASSOC = 16; // pruning never goes below this

// senses: [hunger, tiredness, boredom, loneliness, fear, light,
//           foodDist, foodDir, creatureDist, creatureDir, toyDist, toyDir,
//           isAdult, illness, homeDist, kinNear, bondNear,
//           climbUp, climbDown, groomNear, jumpNear, bias]
// v0.12 rule kept: never renumber. New senses append before the bias.
export function senseVector(s) {
  return [
    s.hunger, s.tiredness, s.boredom, s.loneliness, s.fear, s.light,
    s.foodDist, s.foodDir, s.creatureDist, s.creatureDir,
    s.toyDist, s.toyDir, s.isAdult, s.illness,
    s.homeDist || 0, s.kinNear || 0, s.bondNear || 0,
    s.climbUp || 0, s.climbDown || 0, s.groomNear || 0, s.jumpNear || 0, 1,
  ];
}

function assocSize(pheno) {
  // Evolvable: the memory gene sizes the associative layer (48–128).
  return 48 + Math.round((pheno.memory ?? 0.5) * 80);
}

function randSparse(rng, rows, cols, density, scale) {
  // Adjacency lists: for each row, [colIndices], [weights].
  const idx = [];
  const w = [];
  for (let r = 0; r < rows; r++) {
    const n = Math.max(1, Math.round(cols * density * (0.5 + rng.next())));
    const cols_ = new Set();
    while (cols_.size < n) cols_.add(rng.int(0, cols - 1));
    idx.push([...cols_]);
    w.push([...cols_].map(() => rng.range(-scale, scale)));
  }
  return { idx, w };
}

export function createBrain(pheno, rng) {
  const nAssoc = assocSize(pheno);
  // Sensory → associative: sparse (density ~0.35).
  const s2a = randSparse(rng, nAssoc, N_IN - 1, 0.35, 0.9); // bias handled separately
  const biasA = Array.from({ length: nAssoc }, () => rng.range(-0.2, 0.2));
  // Associative → motor: sparse (density ~0.5), motor units map 1:1 to actions.
  const a2m = randSparse(rng, N_OUT, nAssoc, 0.5, 0.9);
  const biasM = new Array(N_OUT).fill(0);

  // Instincts: evolvable sense→action reflexes, wired straight from the genome.
  // Each instinct gene's [0,1] phenotype maps to a weight in [-1.2, 1.2].
  // These weights are genetic — they change only via inheritance + mutation.
  const instW = Array.from({ length: N_OUT }, () => new Array(N_IN).fill(0));
  for (const gene of GENES) {
    if (gene.sense === undefined || gene.action >= N_OUT) continue;
    instW[gene.action][gene.sense] = (pheno[gene.key] - 0.5) * 2.4;
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

  return {
    nAssoc, s2a, biasA, a2m, biasM, instW,
    attention: new Array(N_IN - 1).fill(1 / (N_IN - 1)), // EMA of salience
    age: 0, // brain age in ticks (drives neurogenesis → pruning)
    neurogenesis: 0.3 + (pheno.neurogenesis ?? 0.5) * 0.7,
    rng, // seeded RNG — neurogenesis/pruning stay deterministic
    lastAssoc: null, lastOut: null, lastInput: null, lastWinner: -1,
  };
}

const tanh = (x) => Math.tanh(x);

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
  return gated;
}

export function forward(brain, input) {
  const gated = applyAttention(brain, input);
  const { idx: sIdx, w: sW } = brain.s2a;
  const nA = brain.nAssoc;
  const assoc = new Array(nA);
  for (let i = 0; i < nA; i++) {
    let pre = brain.biasA[i];
    const cols = sIdx[i];
    const ws = sW[i];
    for (let n = 0; n < cols.length; n++) pre += ws[n] * gated[cols[n]];
    pre += input[N_IN - 1]; // bias sense
    assoc[i] = tanh(pre);
  }
  // Winner-take-all: the strongest associative neuron inhibits the rest.
  // One thought at a time — the middle layer commits.
  let winner = 0;
  let best = -Infinity;
  for (let i = 0; i < nA; i++) {
    if (assoc[i] > best) { best = assoc[i]; winner = i; }
  }
  for (let i = 0; i < nA; i++) {
    if (i !== winner) assoc[i] *= 0.15;
  }
  // Motor: sparse readout, 1:1 with actions.
  const { idx: mIdx, w: mW } = brain.a2m;
  const o = new Array(N_OUT);
  for (let j = 0; j < N_OUT; j++) {
    let pre = brain.biasM[j];
    const cols = mIdx[j];
    const ws = mW[j];
    for (let n = 0; n < cols.length; n++) pre += ws[n] * assoc[cols[n]];
    const iw = brain.instW[j];
    for (let k = 0; k < N_IN; k++) pre += iw[k] * input[k];
    o[j] = tanh(pre);
  }
  brain.lastAssoc = assoc;
  brain.lastOut = o;
  brain.lastInput = input;
  brain.lastWinner = winner;
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
  return w < -PLASTICITY_CLAMP ? -PLASTICITY_CLAMP : w > PLASTICITY_CLAMP ? PLASTICITY_CLAMP : w;
}

// Reward-modulated Hebbian learning. reward in [-1, 1]. The winning
// associative neuron learns at full rate; sensory→associative synapses at
// 1/3 (the world model changes slower than the action model).
export function learn(brain, pheno, reward) {
  if (!brain.lastAssoc || !brain.lastOut || !brain.lastInput || reward === 0) return;
  const lr = 0.02 + (pheno.learningRate ?? 0.5) * 0.18;
  const assoc = brain.lastAssoc;
  const o = brain.lastOut;
  const x = brain.lastInput;
  const winner = brain.lastWinner;
  // Motor layer: Hebbian on the associative pattern.
  for (let j = 0; j < N_OUT; j++) {
    const err = lr * reward * o[j];
    const cols = brain.a2m.idx[j];
    const ws = brain.a2m.w[j];
    for (let n = 0; n < cols.length; n++) {
      ws[n] = clampW(ws[n] + err * assoc[cols[n]]);
    }
    brain.biasM[j] = clampW(brain.biasM[j] + err * 0.3);
  }
  // Sensory→associative: winner at full rate, others at 1/3.
  const cols = brain.s2a.idx[winner];
  const ws = brain.s2a.w[winner];
  for (let n = 0; n < cols.length; n++) {
    ws[n] = clampW(ws[n] + lr * reward * x[cols[n]] * assoc[winner]);
  }
  for (let i = 0; i < brain.nAssoc; i++) {
    if (i === winner) continue;
    const c2 = brain.s2a.idx[i];
    const w2 = brain.s2a.w[i];
    for (let n = 0; n < c2.length; n++) {
      w2[n] = clampW(w2[n] + (lr / 3) * reward * x[c2[n]] * assoc[i]);
    }
  }
  brain.age++;
  maybeGrow(brain, pheno);
}

// Neurogenesis in juveniles, pruning in adults. The brain grows while the
// body is young (plasticity ×2 effect via higher addition rate), then trims
// the least-used neurons — but never below 16.
function maybeGrow(brain, pheno) {
  const rng = brain.rng;
  const p = brain.neurogenesis * 0.01;
  const juvenile = brain.age < 3000; // ~first minutes of life at 10Hz
  if (juvenile && rng.chance(p * 2) && brain.nAssoc < 128) {
    addAssocNeuron(brain);
  } else if (!juvenile && rng.chance(p * 0.5) && brain.nAssoc > MIN_ASSOC) {
    pruneAssocNeuron(brain);
  }
}

function addAssocNeuron(brain) {
  const rng = brain.rng;
  const nA = brain.nAssoc;
  // New neuron: sparse sensory inputs, sparse motor outputs.
  const nIn = Math.max(1, Math.round((N_IN - 1) * 0.35 * (0.5 + rng.next())));
  const cols = new Set();
  while (cols.size < nIn) cols.add(rng.int(0, N_IN - 2));
  brain.s2a.idx.push([...cols]);
  brain.s2a.w.push([...cols].map(() => rng.range(-0.9, 0.9)));
  brain.biasA.push(rng.range(-0.2, 0.2));
  // Wire into motor readout sparsely.
  for (let j = 0; j < N_OUT; j++) {
    if (rng.chance(0.5)) {
      brain.a2m.idx[j].push(nA);
      brain.a2m.w[j].push(rng.range(-0.9, 0.9));
    }
  }
  brain.nAssoc = nA + 1;
}

function pruneAssocNeuron(brain) {
  // Prune the neuron with the weakest total motor weight (least useful).
  let weakest = 0;
  let weakScore = Infinity;
  for (let i = 0; i < brain.nAssoc; i++) {
    let s = 0;
    for (let j = 0; j < N_OUT; j++) {
      const idx = brain.a2m.idx[j].indexOf(i);
      if (idx >= 0) s += Math.abs(brain.a2m.w[j][idx]);
    }
    s += Math.abs(brain.biasA[i]);
    if (s < weakScore) { weakScore = s; weakest = i; }
  }
  const nA = brain.nAssoc - 1;
  brain.s2a.idx.splice(weakest, 1);
  brain.s2a.w.splice(weakest, 1);
  brain.biasA.splice(weakest, 1);
  for (let j = 0; j < N_OUT; j++) {
    const idx = brain.a2m.idx[j].indexOf(weakest);
    if (idx >= 0) {
      brain.a2m.idx[j].splice(idx, 1);
      brain.a2m.w[j].splice(idx, 1);
    }
    // Shift indices above the removed neuron down.
    for (let n = 0; n < brain.a2m.idx[j].length; n++) {
      if (brain.a2m.idx[j][n] > weakest) brain.a2m.idx[j][n]--;
    }
  }
  brain.nAssoc = nA;
}

// A newborn's brain inherits structure from its parents: sparse topology is
// resampled, but the instinct wiring (genetic) is fresh and the attention
// prior starts uniform. Kept for API parity with the Emberhollow design.
export function inheritStructure(pheno, rng) {
  return createBrain(pheno, rng);
}
