// v0.32 "Nervous system": the peripheral nerves between body and brain.
//
// The brain used to get senses instantly and act instantly. Now every
// creature carries two nerve trunks:
//
//   sensory: body → brain. Fresh sense vectors are pushed onto a delay line
//            each tick; the brain reads the vector from `senseDelay` ticks
//            ago. Delay = trunkLen / conductionVelocity, so big bodies feel
//            the world late.
//   motor:   brain → muscle. Commands queue on a motor delay line; each
//            arrives `motorDelay` ticks after it was sent (same trunk, same
//            physics as the sensory side). The creature acts on old news.
//
// Plus reflex arcs: hardwired sense→action loops evaluated every tick on
// FRESH senses, bypassing both delay lines — the withdrawal/startle answer
// before the cortex has heard the question. A firing reflex flushes the
// motor delay line and injects its command for immediate delivery. Reflexes use the instinct-gene
// pattern (nature) but are deliberately NOT wired into the brain's instW:
// the fast path and the cortical path stay experimentally separable.
//
// And pain: c.pain spikes on injury, decays, rides the sense vector at
// index 37, and (via painTolerance) narrows the action repertoire when it
// screams.
//
// Damage: sensory damage attenuates the delayed vector (numbness);
// motor damage drops commands (paralysis). Both heal slowly.
//
// v0.36 "Scars" interface (do not build Scars here):
//   damageNerve(c, trunk, amount) / healNerve(c, trunk, amount) /
//   nerveIntegrity(c, trunk), trunk ∈ {'sensory','motor'}. Scars will call
//   damageNerve per injured part; the string trunk is the extension point
//   for per-nerve granularity.

import { ACTIONS, N_IN } from './brain.js';

// --- constants ------------------------------------------------------------
export const NERVE_MAX_DELAY = 8; // ticks — caps the delay-line memory
export const NERVE_HEAL_RATE = 0.005; // damage/s — nerves heal slowly
export const PAIN_GAIN = 2.0; // injury Δ → pain spike multiplier
export const PAIN_REWARD = 2.0; // injury Δ → negative reward multiplier
export const PAIN_HALFLIFE_S = 20; // pain decay halflife, seconds
export const PAIN_RELIEF = 0.5; // pain decrease → positive reward multiplier.
// Negative reinforcement (what ends pain is learned), but STRICTLY less
// than the punishment gain: total relief over a full decay (0.5 × spike)
// never exceeds the injury punishment (2.0 × delta), so injury stays
// net-negative. (Gemini review caught PAIN_RELIEF=1.5 making injury
// net-positive — the "masochism trap": creatures would learn to SEEK
// injury for the relief tail.)
export const PAIN_INHIB_GAIN = 2.0; // pain→vote-nudge gain. Calibrated: brain
// outputs span ±0.85, so severe pain + zero tolerance (inhib 2.0) decisively
// narrows the repertoire to flee/sleep; the founder (tolerance 0.5) gets a
// strong but not saturating nudge (~0.9 at pain 0.9), leaving room for
// learning to strengthen the correlation over time.
export const REFLEX_FIRE_FLOOR = 0.15; // min drive to fire a reflex
export const FLEE_IDX = ACTIONS.indexOf('flee'); // 5
export const SLEEP_IDX = ACTIONS.indexOf('sleep'); // 2
export const PAIN_SENSE = N_IN - 2; // pain sits before the bias (index 37)

// Reflex arcs: sense→action loops on fresh senses. gainKey/threshKey are
// phenotype keys; sense/action are senseVector/action indices.
export const REFLEXES = [
  { gainKey: 'reflPainFlee', threshKey: 'reflPainFleeThr', sense: PAIN_SENSE, action: FLEE_IDX, name: 'withdrawal' },
  { gainKey: 'reflFearFlee', threshKey: 'reflFearFleeThr', sense: 4, action: FLEE_IDX, name: 'startle' },
];

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Deterministic 0..1 from (creature id, sequence). Nerve-drop checks use
// this instead of world.rng, so a damaged nerve never perturbs the global
// RNG stream — same seed → same world, with no action-at-a-distance.
// (Gemini review: conditional world.rng draws on damaged nerves would make
// the stream depend on who got bitten.)
function nerveHash(id, seq) {
  let h = (Math.imul(id | 0, 0x9e3779b9) ^ Math.imul(seq | 0, 0x85ebca6b)) | 0;
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// --- construction ---------------------------------------------------------
export function conductionVelocity(pheno) {
  // nerveConduction [0,1] → 4..30 px/tick. Founder 0.5 → 17 px/tick.
  return 4 + 26 * (pheno.nerveConduction ?? 0.5);
}

export function trunkLength(c) {
  // Brain-to-extremity, one way. creatureRadius is in creature.js to avoid
  // a circular import — pass the radius in.
  return 2 * c._nerveRadiusPx;
}

export function senseDelayTicks(c) {
  const v = conductionVelocity(c.pheno);
  if (!(v > 0)) return NERVE_MAX_DELAY;
  return Math.max(0, Math.min(NERVE_MAX_DELAY, Math.round(trunkLength(c) / v)));
}

export function motorDelayTicks(c) {
  return senseDelayTicks(c); // same trunk, same physics
}

export function createNerves(c) {
  // c._nerveRadiusPx must be set before this call (createCreature sets it
  // from the phenotype; stageSize changes are re-derived per tick — see
  // refreshNerves).
  return {
    senseBuf: [], // ring buffer of past sense vectors (numbers, incl. bias)
    delay: senseDelayTicks(c),
    motorDelay: motorDelayTicks(c),
    motorBuf: [], // delay line of { action, ticksLeft } — brain commands in flight
    dropSeq: 0, // sequence for deterministic nerve-drop hashes (no RNG stream)
    senseDamage: 0, // 0..1 — attenuates the delayed vector
    motorDamage: 0, // 0..1 — P(command drop)
  };
}

// Body size changes with developmental stage; re-derive delays cheaply.
export function refreshNerves(c) {
  c.nerves.delay = senseDelayTicks(c);
  c.nerves.motorDelay = motorDelayTicks(c);
}

// --- sensory path ---------------------------------------------------------
export function pushNerveSenses(c, vec) {
  // vec: the fresh senseVector (numbers). Stored by value.
  const n = c.nerves;
  if (n.senseBuf.length === 0 && n.delay > 0) {
    // Pre-fill: founders spawn as young adults, not newborns — the line
    // already carries the current state, so the delay is effective from
    // tick 0 instead of leaking fresh senses through a startup transient.
    for (let i = 0; i < n.delay; i++) n.senseBuf.push(vec.slice());
  }
  n.senseBuf.push(vec.slice());
  const cap = NERVE_MAX_DELAY + 1;
  if (n.senseBuf.length > cap) n.senseBuf.shift();
}

export function nerveInput(c, freshVec) {
  // What the brain gets: the delayed vector, attenuated by sensory damage.
  // Falls back to the fresh vector before the buffer fills.
  const n = c.nerves;
  const d = Math.min(n.delay, n.senseBuf.length - 1);
  const base = d >= 0 ? n.senseBuf[n.senseBuf.length - 1 - d] : freshVec;
  const atten = 1 - clamp01(n.senseDamage);
  if (atten >= 1) return base;
  const out = base.slice();
  for (let i = 0; i < out.length - 1; i++) out[i] *= atten; // bias untouched
  return out;
}

// --- motor path -----------------------------------------------------------
// The motor path is a DELAY LINE, mirroring the sensory one: the brain's
// commands queue up and each arrives `motorDelay` ticks after it was sent.
// (An earlier one-slot-outbox design thrashed: executeAction zeroes the
// actionTimer on completion, so the brain re-decides faster than the delay
// and every command was overwritten before delivery — the creature froze.
// The delay line delivers a delayed stream instead; nothing is lost.)
export function deliverMotor(c, action) {
  // Brain-path command: queued, arrives `motorDelay` ticks late. A damaged
  // motor trunk may drop the command outright — the drop check is a
  // deterministic hash of (creature id, sequence), never a world.rng draw.
  const n = c.nerves;
  if (n.motorDamage > 0) {
    n.dropSeq++;
    if (nerveHash(c.id, n.dropSeq) < n.motorDamage) return false; // dropped
  }
  n.motorBuf.push({ action, ticksLeft: n.motorDelay });
  if (n.motorBuf.length > NERVE_MAX_DELAY + 1) n.motorBuf.shift(); // drop stalest
  return true;
}

export function fireReflex(c, action) {
  // Reflex-path command: PREEMPTS. The in-flight brain commands are
  // flushed and the reflex delivers immediately — the muscle answers the
  // emergency, not the cortex's old news. Still subject to motor-nerve
  // damage: a severed trunk silences reflexes too (same deterministic hash).
  const n = c.nerves;
  if (n.motorDamage > 0) {
    n.dropSeq++;
    if (nerveHash(c.id, n.dropSeq) < n.motorDamage) return false;
  }
  n.motorBuf.length = 0;
  n.motorBuf.push({ action, ticksLeft: 0 });
  return true;
}

export function tickMotor(c) {
  const n = c.nerves;
  const buf = n.motorBuf;
  if (!buf.length) return;
  for (const cmd of buf) cmd.ticksLeft--;
  // FIFO: the last command delivered this tick wins.
  while (buf.length && buf[0].ticksLeft <= 0) {
    c.action = buf.shift().action;
  }
}

// --- reflex arcs ----------------------------------------------------------
export function evalReflexes(c, senses) {
  // senses: the FRESH sense object (s.pain, s.fear, ...). Returns the fired
  // action name or null. Evaluated every tick — reflexes interrupt
  // commitments; that is their job.
  const pheno = c.pheno;
  for (const r of REFLEXES) {
    const gain = ((pheno[r.gainKey] ?? 0.5) - 0.5) * 2.4; // instinct-gene scale
    if (gain <= 0) continue;
    const thresh = pheno[r.threshKey] ?? 0.5;
    const name = REFLEX_SENSE_NAMES[r.sense];
    const val = name !== undefined ? senses[name] : undefined;
    if (val === undefined || !Number.isFinite(val)) continue;
    const drive = gain * (val - thresh);
    if (drive > REFLEX_FIRE_FLOOR) {
      if (fireReflex(c, ACTIONS[r.action])) return ACTIONS[r.action];
      return null;
    }
  }
  return null;
}

// The sense object is keyed by name; the reflex table by vector index.
// Names are stable; indices are documented in brain.js.
const REFLEX_SENSE_NAMES = { [PAIN_SENSE]: 'pain', 4: 'fear' };

// --- pain -----------------------------------------------------------------
export function tickPain(c, dt) {
  // Injury deltas become pain spikes (+ negative reward, so the brain
  // learns what pain predicts); pain decays exponentially between hits.
  // Relief is rewarding (negative reinforcement): when pain FALLS, the
  // current action gets credit — the brain learns that flee/rest END pain.
  const b = c.biochem;
  const inj = b.injury || 0;
  const d = inj - (c._lastInjury || 0);
  const before = c.pain || 0;
  if (d > 0) {
    c.pain = clamp01(before + d * PAIN_GAIN);
    c.reward = (c.reward || 0) - d * PAIN_REWARD;
  }
  c._lastInjury = inj;
  const decay = Math.pow(0.5, dt / PAIN_HALFLIFE_S);
  c.pain = (c.pain || 0) * decay;
  const relief = before - c.pain;
  if (relief > 0) c.reward = (c.reward || 0) + relief * PAIN_RELIEF;
}

export function painInhibition(c) {
  // How much pain narrows the repertoire: severe pain + low tolerance →
  // only flee or sleep remain choosable. Applied as a vote nudge (like
  // memory/tradition votes), so learning still reinforces the brain's own
  // outputs, not the nudge.
  const tol = c.pheno.painTolerance ?? 0.5;
  return PAIN_INHIB_GAIN * (c.pain || 0) * (1 - tol);
}

// --- damage: the v0.36 Scars interface ------------------------------------
export function damageNerve(c, trunk, amount) {
  const n = c.nerves;
  if (!n) return;
  if (trunk === 'sensory') n.senseDamage = clamp01(n.senseDamage + amount);
  else if (trunk === 'motor') n.motorDamage = clamp01(n.motorDamage + amount);
}

export function healNerve(c, trunk, amount) {
  const n = c.nerves;
  if (!n) return;
  if (trunk === 'sensory') n.senseDamage = clamp01(n.senseDamage - amount);
  else if (trunk === 'motor') n.motorDamage = clamp01(n.motorDamage - amount);
}

export function nerveIntegrity(c, trunk) {
  const n = c.nerves;
  if (!n) return 1;
  if (trunk === 'sensory') return 1 - n.senseDamage;
  if (trunk === 'motor') return 1 - n.motorDamage;
  return 1;
}

export function tickNerveHealing(c, dt) {
  const n = c.nerves;
  if (!n) return;
  if (n.senseDamage > 0) n.senseDamage = Math.max(0, n.senseDamage - NERVE_HEAL_RATE * dt);
  if (n.motorDamage > 0) n.motorDamage = Math.max(0, n.motorDamage - NERVE_HEAL_RATE * dt);
}
