// Episodic memory: a creature's past, kept honestly.
// Episodes are written only from lived or genuinely observed experience —
// never synthesized. The past votes on decisions (recall); it doesn't rule.
// Sustained sleep replays the most salient episodes back through the brain.
//
// Adapted for Wildcode's scale from the Emberhollow design (shared with
// permission): bounded salience-based forgetting, transient recall votes,
// discounted observational learning, sleep consolidation. Pruned away:
// spiking neurons, epigenetics, call vocabularies, tradition censuses —
// all real, all wrong for a 10Hz browser sim.

import { ACTIONS, forward, learn } from './brain.js';

export const RECALL_K = 3; // episodes voting on a decision
export const RECALL_BUDGET = 0.2; // shared vote budget (+/-)
export const REPLAY_COUNT = 5; // episodes replayed per consolidation
export const REPLAY_SCALE = 0.3; // consolidation learns at a fraction of life
export const WRITE_REWARD = 0.3; // |reward| above this writes an episode
export const OBSERVE_RANGE = 220; // px: witnesses must be this close
export const OBSERVE_DISCOUNT = 0.5; // watching is worth half of doing

// Memory capacity is evolvable: the `memory` gene sets it (16–64 episodes).
export function memoryCapacity(pheno) {
  return 16 + Math.round(pheno.memory * 48);
}

export function createMemory(pheno) {
  return { episodes: [], capacity: memoryCapacity(pheno) };
}

function salienceOf(ep) {
  return Math.abs(ep.reward) + (ep.critical ? 0.5 : 0) + (ep.kind === 'observed' ? 0.1 : 0);
}

// The write rule: salient outcomes, critical drive states, social events.
// Everything else is weather — it passes through without a trace.
export function shouldWrite({ reward, critical, kind }) {
  if (kind === 'observed') return Math.abs(reward) > 0.12;
  return Math.abs(reward) > WRITE_REWARD || !!critical;
}

export function writeEpisode(mem, ep) {
  ep.salience = salienceOf(ep);
  if (mem.episodes.length >= mem.capacity) {
    // Forgetting kills the dimmest first.
    let dim = 0;
    for (let i = 1; i < mem.episodes.length; i++) {
      if (mem.episodes[i].salience < mem.episodes[dim].salience) dim = i;
    }
    if (ep.salience <= mem.episodes[dim].salience) return false;
    mem.episodes[dim] = ep;
  } else {
    mem.episodes.push(ep);
  }
  return true;
}

function cosine(a, b) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Recall: the k most similar episodes vote on the motor decision with a
// shared budget. Returns transient action votes (not written to the brain).
export function recall(mem, input, k = RECALL_K) {
  const votes = new Array(ACTIONS.length).fill(0);
  if (mem.episodes.length === 0) return votes;
  const scored = [];
  for (const ep of mem.episodes) {
    const sim = cosine(input, ep.input);
    if (sim > 0.01) scored.push({ ep, sim });
  }
  scored.sort((a, b) => b.sim - a.sim);
  let total = 0;
  for (let n = 0; n < Math.min(k, scored.length); n++) {
    const { ep, sim } = scored[n];
    const v = Math.sign(ep.reward) * sim;
    votes[ep.action] += v;
    total += Math.abs(v);
  }
  if (total > 0) {
    const scale = Math.min(1, RECALL_BUDGET / total);
    for (let j = 0; j < votes.length; j++) votes[j] *= scale;
  }
  return votes;
}

// Sleep consolidation: replay the most salient episodes through the brain
// at a fraction of live learning strength. With no lived episodes, changes
// nothing.
export function consolidate(mem, brain, pheno) {
  if (mem.episodes.length === 0) return 0;
  const top = [...mem.episodes]
    .sort((a, b) => b.salience - a.salience)
    .slice(0, REPLAY_COUNT);
  for (const ep of top) {
    forward(brain, ep.input);
    learn(brain, pheno, Math.max(-1, Math.min(1, ep.reward * REPLAY_SCALE)));
  }
  return top.length;
}
