// A small neural brain: senses in, action-drives out, shaped by reward.
// Single hidden layer, tanh activations. Instincts are evolvable
// sense→action reflexes wired straight from instinct genes (nature);
// the hidden layer and readout learn from experience (nurture).

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
  'seekHome', // v0.12: walk back toward the imprinted home range
];

const N_IN = 18;
const N_HID = 10;
const N_OUT = ACTIONS.length;

function randWeights(rng, rows, cols, scale) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => rng.range(-scale, scale))
  );
}

export function createBrain(pheno, rng) {
  const w1 = randWeights(rng, N_HID, N_IN, 0.6);
  const b1 = Array.from({ length: N_HID }, () => rng.range(-0.2, 0.2));
  const w2 = randWeights(rng, N_OUT, N_HID, 0.6);
  const b2 = new Array(N_OUT).fill(0);

  // Instincts: evolvable sense→action reflexes, wired straight from the genome.
  // Each instinct gene's [0,1] phenotype maps to a weight in [-1.2, 1.2].
  // These weights are genetic — they change only via inheritance + mutation.
  const instW = Array.from({ length: N_OUT }, () => new Array(N_IN).fill(0));
  for (const gene of GENES) {
    if (gene.sense === undefined) continue;
    instW[gene.action][gene.sense] = (pheno[gene.key] - 0.5) * 2.4;
  }

  // Small personality baselines so newborns aren't blank slates.
  b2[0] = 0.15; // seekFood
  b2[1] = 0.1; // eat
  b2[2] = 0.05; // sleep
  b2[3] = pheno.curiosity * 0.4; // play
  b2[4] = pheno.sociability * 0.4; // approach
  b2[5] = (1 - pheno.boldness) * 0.25; // flee
  b2[6] = 0.05; // mate
  b2[7] = 0.1 + pheno.curiosity * 0.25; // wander
  b2[8] = 0.05; // seekHome — v0.12: the homeward pull starts as a whisper

  return { w1, b1, w2, b2, instW, lastHidden: null, lastOut: null, lastInput: null };
}

const tanh = (x) => Math.tanh(x);

// senses: [hunger, tiredness, boredom, loneliness, fear, light,
//           foodDist, foodDir, creatureDist, creatureDir, toyDist, toyDir,
//           isAdult, illness, homeDist, kinNear, bondNear, bias]
// v0.8: illness is index 13, appended so existing sense indices don't
// shift. A creature that can feel its sickness can learn what cures it.
// v0.12: the social senses append after it — homeDist (14), kinNear (15),
// bondNear (16). Same rule: never renumber.
export function senseVector(s) {
  return [
    s.hunger, s.tiredness, s.boredom, s.loneliness, s.fear, s.light,
    s.foodDist, s.foodDir, s.creatureDist, s.creatureDir,
    s.toyDist, s.toyDir, s.isAdult, s.illness,
    s.homeDist || 0, s.kinNear || 0, s.bondNear || 0, 1,
  ];
}

export function forward(brain, input) {
  const h = brain.w1.map((row, i) =>
    tanh(row.reduce((sum, w, k) => sum + w * input[k], 0) + brain.b1[i])
  );
  const o = brain.w2.map((row, j) => {
    let pre = brain.b2[j];
    for (let i = 0; i < N_HID; i++) pre += row[i] * h[i];
    const iw = brain.instW[j];
    for (let k = 0; k < N_IN; k++) pre += iw[k] * input[k];
    return tanh(pre);
  });
  brain.lastHidden = h;
  brain.lastOut = o;
  brain.lastInput = input;
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

// Reward-modulated learning through the whole network. reward in [-1, 1].
// Reinforces whatever the brain just did, proportionally to the outcome.
// The hidden layer learns too (backprop through tanh) — not just the readout.
export function learn(brain, pheno, reward) {
  if (!brain.lastHidden || !brain.lastOut || !brain.lastInput || reward === 0) return;
  const lr = 0.02 + pheno.learningRate * 0.18;
  const h = brain.lastHidden;
  const o = brain.lastOut;
  const x = brain.lastInput;
  // Output layer: reward-modulated Hebbian update.
  const outErr = new Array(N_OUT);
  for (let j = 0; j < N_OUT; j++) {
    outErr[j] = lr * reward * o[j];
    for (let i = 0; i < N_HID; i++) {
      brain.w2[j][i] = clampW(brain.w2[j][i] + outErr[j] * h[i]);
    }
    brain.b2[j] = clampW(brain.b2[j] + outErr[j] * 0.3);
  }
  // Hidden layer: backpropagate the reward signal (gentler step for stability).
  for (let i = 0; i < N_HID; i++) {
    let err = 0;
    for (let j = 0; j < N_OUT; j++) err += brain.w2[j][i] * outErr[j];
    err *= 1 - h[i] * h[i]; // tanh derivative
    for (let k = 0; k < N_IN; k++) {
      brain.w1[i][k] = clampW(brain.w1[i][k] + 0.5 * err * x[k]);
    }
    brain.b1[i] = clampW(brain.b1[i] + 0.15 * err);
  }
}

function clampW(w) {
  return w < -3 ? -3 : w > 3 ? 3 : w;
}
