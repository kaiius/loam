// v0.32 "Nervous system" — unit tests for src/sim/nerves.js.
// The execution probes (probes/nervous-system.mjs) prove the mechanism in a
// live world; these pin the module's contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNerves, conductionVelocity, senseDelayTicks, motorDelayTicks,
  pushNerveSenses, nerveInput, deliverMotor, fireReflex, tickMotor,
  evalReflexes, tickPain, painInhibition, damageNerve, healNerve,
  nerveIntegrity, tickNerveHealing, PAIN_SENSE, FLEE_IDX, SLEEP_IDX,
  NERVE_MAX_DELAY,
} from '../src/sim/nerves.js';
import { N_IN, ACTIONS } from '../src/sim/brain.js';

assert.equal(ACTIONS[FLEE_IDX], 'flee');
assert.equal(ACTIONS[SLEEP_IDX], 'sleep');
assert.equal(PAIN_SENSE, N_IN - 2, 'pain rides before the bias');

// Minimal creature stub: nerves.js only reads _nerveRadiusPx, pheno,
// biochem, nerves, pain, reward.
function stubC(radiusPx = 20, pheno = {}) {
  const c = {
    _nerveRadiusPx: radiusPx,
    pheno: { nerveConduction: 0.5, painTolerance: 0.5, ...pheno },
    biochem: { injury: 0 },
    pain: 0, reward: 0, action: 'wander',
  };
  c.nerves = createNerves(c);
  return c;
}
const vec = (pain) => {
  const v = new Array(N_IN).fill(0.1);
  v[PAIN_SENSE] = pain; v[N_IN - 1] = 1;
  return v;
};

test('v0.32: delay scales with body size and conduction velocity', () => {
  const small = stubC(16); // grub-scale
  const big = stubC(60); // bear-scale
  assert.ok(big.nerves.delay > small.nerves.delay,
    `big delay ${big.nerves.delay} > small delay ${small.nerves.delay}`);
  assert.ok(small.nerves.delay >= 1, 'even small creatures feel delay');
  assert.ok(big.nerves.delay <= NERVE_MAX_DELAY, 'delay capped');
  const fast = stubC(40, { nerveConduction: 1.0 });
  const slow = stubC(40, { nerveConduction: 0.0 });
  assert.ok(fast.nerves.delay < slow.nerves.delay, 'conduction velocity matters');
  assert.equal(motorDelayTicks(small), senseDelayTicks(small), 'same trunk, same delay');
});

test('v0.32: sensory delay line delivers old news', () => {
  const c = stubC(40); // delay ~2-3 ticks
  const d = c.nerves.delay;
  assert.ok(d > 0, 'test needs a nonzero delay');
  for (let t = 0; t < 10; t++) pushNerveSenses(c, vec(0));
  pushNerveSenses(c, vec(1));
  // The fresh pain hasn't arrived yet.
  assert.ok(nerveInput(c, vec(1))[PAIN_SENSE] < 0.5, 'delayed, not instant');
  for (let t = 0; t < d; t++) pushNerveSenses(c, vec(1));
  assert.ok(nerveInput(c, vec(1))[PAIN_SENSE] > 0.9, 'arrives after the delay');
});

test('v0.32: sensory damage attenuates, bias untouched', () => {
  const c = stubC(20);
  for (let t = 0; t < 10; t++) pushNerveSenses(c, vec(0.8));
  damageNerve(c, 'sensory', 0.75);
  assert.equal(nerveIntegrity(c, 'sensory'), 0.25);
  const out = nerveInput(c, vec(0.8));
  assert.ok(Math.abs(out[PAIN_SENSE] - 0.2) < 0.01, `attenuated ${out[PAIN_SENSE]}`);
  assert.equal(out[N_IN - 1], 1, 'bias never attenuates');
  healNerve(c, 'sensory', 0.75);
  assert.equal(nerveIntegrity(c, 'sensory'), 1);
});

test('v0.32: motor delay line delivers a delayed stream', () => {
  const c = stubC(40);
  const d = c.nerves.motorDelay;
  deliverMotor(c, 'eat');
  tickMotor(c);
  assert.equal(c.action, 'wander', 'not yet arrived');
  for (let t = 1; t < d; t++) tickMotor(c);
  assert.equal(c.action, 'eat', 'arrives after the delay');
});

test('v0.32: motor damage drops commands', () => {
  const c = stubC(20);
  damageNerve(c, 'motor', 1.0);
  let delivered = 0;
  for (let t = 0; t < 20; t++) {
    if (deliverMotor(c, 'eat', { next: () => 0.5 })) delivered++;
    tickMotor(c);
  }
  assert.equal(delivered, 0, 'severed trunk silences the muscle');
  assert.equal(c.action, 'wander');
});

test('v0.32: reflex preempts the motor line', () => {
  const c = stubC(40);
  deliverMotor(c, 'eat');
  deliverMotor(c, 'sleep');
  assert.equal(c.nerves.motorBuf.length, 2);
  fireReflex(c, 'flee');
  assert.equal(c.nerves.motorBuf.length, 1, 'in-flight commands flushed');
  tickMotor(c);
  assert.equal(c.action, 'flee', 'reflex delivers immediately');
});

test('v0.32: withdrawal reflex fires on pain, not without it', () => {
  const c = stubC(20, { reflPainFlee: 0.7, reflPainFleeThr: 0.45 });
  assert.equal(evalReflexes(c, { pain: 1.0, fear: 0 }), 'flee');
  assert.equal(c.nerves.motorBuf.length, 1, 'reflex command queued for immediate delivery');
  tickMotor(c);
  assert.equal(c.action, 'flee', 'delivers on the next motor tick');
  const calm = stubC(20, { reflPainFlee: 0.7, reflPainFleeThr: 0.45 });
  assert.equal(evalReflexes(calm, { pain: 0.1, fear: 0 }), null);
  const pinned = stubC(20, { reflPainFlee: 0, reflPainFleeThr: 0.45 });
  assert.equal(evalReflexes(pinned, { pain: 1.0, fear: 0 }), null, 'pinned gain never fires');
});

test('v0.32: startle reflex fires on fear', () => {
  const c = stubC(20, { reflFearFlee: 0.8, reflFearFleeThr: 0.65 });
  assert.equal(evalReflexes(c, { pain: 0, fear: 0.9 }), 'flee');
});

test('v0.32: pain spikes on injury, decays, relief rewards', () => {
  const c = stubC(20);
  c.biochem.injury = 0.5;
  tickPain(c, 0.1);
  assert.ok(c.pain > 0.9, `spike ${c.pain}`);
  assert.ok(c.reward < -0.5, `negative reward ${c.reward}`);
  c.biochem.injury = 0.5; // held — no new delta
  const p1 = c.pain;
  const r1 = c.reward;
  for (let t = 0; t < 300; t++) tickPain(c, 0.1);
  assert.ok(c.pain < p1 * 0.4, `decays ${p1.toFixed(2)} → ${c.pain.toFixed(2)}`);
  // Gemini review (masochism trap): relief must PARTIALLY offset the
  // punishment but never exceed it — injury stays net-negative.
  assert.ok(c.reward > r1, `relief softens ${r1.toFixed(2)} → ${c.reward.toFixed(2)}`);
  assert.ok(c.reward < 0, `injury net-negative ${c.reward.toFixed(2)}`);
});

test('v0.32: pain inhibition scales with tolerance', () => {
  const stoic = stubC(20, { painTolerance: 1.0 });
  stoic.pain = 1.0;
  assert.equal(painInhibition(stoic), 0, 'full tolerance: no narrowing');
  const sensitive = stubC(20, { painTolerance: 0.0 });
  sensitive.pain = 1.0;
  assert.ok(painInhibition(sensitive) > 1.5, 'zero tolerance + agony: decisive');
  const founder = stubC(20);
  founder.pain = 0.9;
  const f = painInhibition(founder);
  assert.ok(f > 0.5 && f < 1.5, `founder nudge strong but not saturating: ${f.toFixed(2)}`);
});

test('v0.32: nerves heal slowly', () => {
  const c = stubC(20);
  damageNerve(c, 'sensory', 0.5);
  damageNerve(c, 'motor', 0.5);
  tickNerveHealing(c, 10);
  assert.ok(c.nerves.senseDamage < 0.5 && c.nerves.senseDamage > 0.4, 'slow heal');
  tickNerveHealing(c, 1000);
  assert.equal(c.nerves.senseDamage, 0);
  assert.equal(c.nerves.motorDamage, 0);
});
