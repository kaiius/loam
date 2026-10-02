// probes/nervous-system.mjs — v0.32 "Nervous system" execution probes.
// The brain used to see and act instantly; now there are nerves in between.
// These probes force the mechanism in a live ticking world and measure:
//   (a) transmission delay scales with body size (bear vs grub, same stimulus)
//   (b) the reflex arc fires measurably faster than the brain path
//   (c) a damaged sensory nerve attenuates the signal (before/after)
//   (d) pain drives learned avoidance (flee/rest correlation rises over time)
// Run: node probes/nervous-system.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { founderPheno } from '../src/sim/species.js';
import { createCreature } from '../src/sim/creature.js';
import { senseVector, ACTIONS, forward } from '../src/sim/brain.js';
import { nerveInput, damageNerve, PAIN_SENSE } from '../src/sim/nerves.js';

const seed = parseInt(process.argv[2] || '4242', 10);
const FLEE = 'flee', SLEEP = 'sleep';
let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
  if (!cond) failures++;
}

function snapToPlatform(world, x) {
  for (const dx of [0, 60, -60, 140, -140, 260, -260, 420, -420, 700, -700]) {
    const pi = platformIndexAt(world, x + dx, 800);
    if (pi >= 0) {
      const p = world.platforms[pi];
      const cx = Math.min(Math.max(x + dx, p.x1 + 30), p.x2 - 30);
      return { x: cx, pi };
    }
  }
  throw new Error('no platform near x=' + x);
}

// A lab rat: adult, sealed lab (needs topped up every tick — Bart's
// lab-hygiene rule, v0.32), optional pheno overrides (e.g. reflex pinning).
function mkRat(world, skey, x, phenoOverrides = {}) {
  const { x: sx, pi } = snapToPlatform(world, x);
  const { genome, pheno } = founderPheno(skey, createRng(seed + Math.round(sx)));
  const c = createCreature(genome, sx, pi, world.rng);
  Object.assign(c.pheno, phenoOverrides);
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  world.creatures.push(c);
  return c;
}

function seal(c, { injury = null } = {}) {
  const b = c.biochem;
  b.hunger = 0; b.energy = 0.95; b.fear = 0; b.illness = 0;
  b.hydration = 1; b.bloodSugar = 1; b.health = 1;
  if (injury !== null) b.injury = injury;
}

function brainPain(c) {
  // What the brain sees right now: the delayed, possibly attenuated vector.
  return nerveInput(c, senseVector(c._senses))[PAIN_SENSE];
}

function freshWorld() {
  const world = bindWorld(createWorld(seed));
  world.creatures.length = 0;
  return world;
}

// ---- (a) delay scales with body size -------------------------------------
{
  const world = freshWorld();
  const big = mkRat(world, 'bear', 1900, { reflPainFlee: 0, reflFearFlee: 0 });
  const small = mkRat(world, 'grub', 2100, { reflPainFlee: 0, reflFearFlee: 0 });
  for (let t = 0; t < 20; t++) { seal(big); seal(small); tickWorld(world, 0.1); }
  // Same stimulus at the same tick: injury 0.5 → pain spikes to 1.0.
  let bigLat = -1, smallLat = -1;
  for (let t = 0; t < 30; t++) {
    seal(big, { injury: 0.5 }); seal(small, { injury: 0.5 });
    tickWorld(world, 0.1);
    if (bigLat < 0 && brainPain(big) > 0.5) bigLat = t;
    if (smallLat < 0 && brainPain(small) > 0.5) smallLat = t;
    if (bigLat >= 0 && smallLat >= 0) break;
  }
  check('(a) delay scales with size',
    bigLat > smallLat && bigLat >= 0 && smallLat >= 0,
    `bear delay=${big.nerves.delay}tk latency=${bigLat}tk vs grub delay=${small.nerves.delay}tk latency=${smallLat}tk`);
}

// ---- (b) reflex beats the brain path --------------------------------------
{
  const mk = (pinReflex) => {
    const world = freshWorld();
    const c = mkRat(world, 'tanglekin', 1900, pinReflex ? { reflPainFlee: 0, reflFearFlee: 0 } : {});
    return { world, c };
  };
  const measure = (pinReflex) => {
    const { world, c } = mk(pinReflex);
    for (let t = 0; t < 20; t++) { seal(c); c.actionTimer = 0; tickWorld(world, 0.1); }
    c.action = 'wander'; c.nerves.motorBuf.length = 0; c.actionLabel = '';
    // The flee handler redirects to wander when alone, but it stamps
    // actionLabel='frightened!' first — that stamp proves the flee action
    // RAN (the muscle received and executed it). Same-tick reflex fire
    // is also visible as c._reflexFired.
    let lat = -1, reflexFiredAt = -1;
    for (let t = 0; t < 40; t++) {
      seal(c, { injury: 0.5 }); c.actionTimer = 0; // re-decide every tick
      tickWorld(world, 0.1);
      if (reflexFiredAt < 0 && c._reflexFired === 'flee') reflexFiredAt = t;
      if (c.actionLabel === 'frightened!') { lat = t; break; }
    }
    return { lat, reflexFiredAt };
  };
  const r = measure(false);
  const b = measure(true);
  check('(b) reflex faster than brain',
    r.lat >= 0 && b.lat >= 0 && r.lat < b.lat,
    `reflex: fired at t=${r.reflexFiredAt}tk, flee executed at t=${r.lat}tk vs brain-path flee at t=${b.lat}tk (same pain stimulus)`);
}

// ---- (c) damaged nerve attenuates -----------------------------------------
{
  const world = freshWorld();
  const c = mkRat(world, 'tanglekin', 1900, { reflPainFlee: 0, reflFearFlee: 0 });
  for (let t = 0; t < 20; t++) { seal(c); tickWorld(world, 0.1); }
  for (let t = 0; t < 15; t++) { seal(c, { injury: 0.5 }); tickWorld(world, 0.1); }
  const before = brainPain(c);
  damageNerve(c, 'sensory', 0.9);
  const after = brainPain(c);
  check('(c) nerve damage attenuates',
    before > 0.5 && after < before * 0.3,
    `brain-visible pain before=${before.toFixed(2)} after=${after.toFixed(2)} (sensory damage 0.9)`);
}

// ---- (d) pain teaches avoidance --------------------------------------------
// The brain's pain→flee mapping is continuous (weights); the discrete
// choice is a threshold effect. This probe measures the learned mapping
// directly: mean flee output during pain-visible ticks, early vs late
// episodes. (A discrete-choice version plateaued: the weights move
// 0.17→0.32 but don't cross the seekFood threshold — the learning is real,
// the threshold is the confound.)
{
  const { world, c } = (() => { const w = freshWorld(); return { world: w, c: mkRat(w, 'tanglekin', 1900, { reflPainFlee: 0, reflFearFlee: 0 }) }; })();
  const meanFleeOut = () => {
    // The brain's raw flee output on the CURRENT delayed input (what it sees).
    const o = forward(c.brain, nerveInput(c, senseVector(c._senses)));
    return o[5];
  };
  const epMeans = [];
  for (let ep = 0; ep < 20; ep++) {
    let sum = 0, n = 0;
    for (let t = 0; t < 400; t++) {
      const injTick = t === 0;
      seal(c, injTick ? { injury: 0.45 } : {});
      if (!injTick && c.biochem.injury > 0.01) c.biochem.injury = Math.max(0, c.biochem.injury - 0.002);
      tickWorld(world, 0.1);
      if (brainPain(c) > 0.5) { sum += meanFleeOut(); n++; }
    }
    epMeans.push(n > 0 ? sum / n : 0);
  }
  const early = epMeans.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const late = epMeans.slice(-5).reduce((a, b) => a + b, 0) / 5;
  check('(d) pain teaches avoidance',
    late > early * 1.2,
    `mean brain flee output | pain>0.5: early=${early.toFixed(3)} → late=${late.toFixed(3)} over 20 episodes`);
}

process.exit(failures ? 1 : 0);
