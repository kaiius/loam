// A small neural brain: senses in, action-drives out, shaped by reward.
// Single hidden layer, tanh activations. Instincts (gene-based weight biases)
// give personality before any learning happens.

export const ACTIONS = [
  'seekFood', // move toward nearest food
  'eat', // consume adjacent food
  'sleep', // lie down, restore energy
  'play', // interact with toy/critter
  'approach', // move toward nearest creature
  'flee', // move away from threat/scary thing
  'mate', // approach & court nearest adult creature
  'wander', // explore randomly
];

const N_IN = 14;
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

  // Instincts: personality genes bias action drives from birth.
  const instinct = {
    seekFood: 0.3,
    eat: 0.2,
    sleep: 0.1,
    play: pheno.curiosity * 0.8,
    approach: pheno.sociability * 0.8,
    flee: (1 - pheno.boldness) * 0.5,
    mate: 0.1,
    wander: 0.2 + pheno.curiosity * 0.5,
  };
  ACTIONS.forEach((a, j) => {
    b2[j] = (instinct[a] || 0) * 0.8;
  });

  return { w1, b1, w2, b2, lastHidden: null, lastOut: null };
}

const tanh = (x) => Math.tanh(x);

// senses: [hunger, tiredness, boredom, loneliness, fear, light,
//           foodDist, foodDir, creatureDist, creatureDir, toyDist, toyDir,
//           isAdult, bias]
export function senseVector(s) {
  return [
    s.hunger, s.tiredness, s.boredom, s.loneliness, s.fear, s.light,
    s.foodDist, s.foodDir, s.creatureDist, s.creatureDir,
    s.toyDist, s.toyDir, s.isAdult, 1,
  ];
}

export function decide(brain, input, exploration, rng) {
  const h = brain.w1.map((row, i) =>
    tanh(row.reduce((sum, w, k) => sum + w * input[k], 0) + brain.b1[i])
  );
  const o = brain.w2.map((row, j) =>
    tanh(row.reduce((sum, w, k) => sum + w * h[k], 0) + brain.b2[j])
  );
  brain.lastHidden = h;
  brain.lastOut = o;

  let best = 0;
  let bestScore = -Infinity;
  for (let j = 0; j < N_OUT; j++) {
    const score = o[j] + rng.range(-exploration, exploration);
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return { action: ACTIONS[best], index: best, outputs: o };
}

// Reward-modulated Hebbian update. reward in [-1, 1].
// Reinforces whatever the brain just did, proportionally to the outcome.
export function learn(brain, pheno, reward) {
  if (!brain.lastHidden || !brain.lastOut || reward === 0) return;
  const lr = 0.02 + pheno.learningRate * 0.18;
  const h = brain.lastHidden;
  const o = brain.lastOut;
  for (let j = 0; j < N_OUT; j++) {
    const delta = lr * reward * o[j];
    for (let i = 0; i < N_HID; i++) {
      brain.w2[j][i] = clampW(brain.w2[j][i] + delta * h[i]);
    }
  }
  // Gentle backprop into the hidden layer for richer learning.
  for (let i = 0; i < N_HID; i++) {
    let err = 0;
    for (let j = 0; j < N_OUT; j++) err += brain.w2[j][i] * lr * reward * o[j];
    err *= 1 - h[i] * h[i]; // tanh derivative
    void err; // kept simple: hidden weights stay fixed (instincts + readout learn)
  }
}

function clampW(w) {
  return w < -3 ? -3 : w > 3 ? 3 : w;
}
