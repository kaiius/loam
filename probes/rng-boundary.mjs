// v0.33 RNG-boundary regression probe (Colony feedback: hermes-on-foot v0.31, cassini v0.31).
//
// The canonical regression test for the causal/non-causal RNG boundary, built
// on the v0.31 morsel-retirement episode.
//
// Leak criterion (hermes-on-foot, adopted as the standing rule):
//   A draw is CAUSAL iff its output is read downstream by anything selection
//   or physics can see. Every point where a non-causal-stream value becomes
//   a causal-stream input is a CROSSING and must be annotated (see
//   design/rng-boundary.md).
//
// What this probe tests (seed 42, 5000 ticks each):
//   (a) BASELINE: the causal trajectory (alive/births/deaths per 1k ticks).
//   (b) DECOR-DRAIN: +10,000 extra decorRng draws at genesis, discarded.
//       If the trajectory differs from baseline, decor entropy consumption
//       leaks into the causal stream — FAIL.
//   (c) MORSEL-SHIM: re-insert the exact v0.30 morsel-burial code (5 morsels
//       per shallows region, positions from decorRng) — the retirement
//       reversed. If the trajectory differs, EITHER the draws leak OR the
//       entities matter (senses: buriedNear reads world.buried).
//   (d) DRAWS-ONLY: the same decorRng draws as (c) but WITHOUT creating the
//       entities. (c)-(d) isolates the entity effect; (d)-(a) isolates the
//       draw effect.
//
// Cassini's question (entropy-pool vs generator-state), answered in the
// output: the sim uses INDEPENDENT mulberry32 instances per stream
// (world.rng, world.decorRng, world.teacherRng, weather.rng — separate
// closures, separate state; there is NO shared entropy pool). A decorRng
// draw cannot shift world.rng's sequence by construction. The only leak
// vector is code drawing from the wrong stream. This probe verifies that
// empirically: (b) must equal (a).
//
// Run: node probes/rng-boundary.mjs [seed] [ticks]
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';

const seed = parseInt(process.argv[2] || '42', 10);
const TICKS = parseInt(process.argv[3] || '5000', 10);
const DT = 0.5;

function trajectory(variant) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  if (variant === 'decor-drain') {
    for (let i = 0; i < 10000; i++) world.decorRng.next(); // pure entropy burn
  } else if (variant === 'morsel-draws' || variant === 'morsel-shim') {
    // v0.30 buryFood, verbatim logic: positions from decorRng.
    const dr = world.decorRng;
    const spots = [];
    for (let i = 0; i < 25; i++) spots.push(dr.range(0, 4000));
    if (variant === 'morsel-shim') {
      for (const x of spots) {
        world.buried.push({ x, y: 800, kind: 'morsel', amount: 1.0, biome: 'shallows' });
      }
    }
  }
  const deaths = {};
  let births = 0;
  const origPush = world.events.push.bind(world.events);
  world.events.push = (e) => {
    if (e.type === 'death') deaths[e.cause] = (deaths[e.cause] || 0) + 1;
    else if (e.type === 'hatch') births++;
    return origPush(e);
  };
  const aliveTrack = [];
  for (let i = 0; i < TICKS; i++) {
    tickWorld(world, DT);
    if (i % 1000 === 999) aliveTrack.push(world.creatures.filter((c) => c.alive).length);
  }
  return {
    aliveTrack: aliveTrack.join(','),
    aliveEnd: world.creatures.filter((c) => c.alive).length,
    births,
    deaths: Object.entries(deaths).sort().map(([k, v]) => `${k}:${v}`).join(','),
  };
}

const base = trajectory('baseline');
const drain = trajectory('decor-drain');
const draws = trajectory('morsel-draws');
const shim = trajectory('morsel-shim');

const same = (a, b) => a.aliveTrack === b.aliveTrack && a.births === b.births && a.deaths === b.deaths;

const drainLeak = !same(base, drain);
const drawsLeak = !same(base, draws);
const entityEffect = !same(draws, shim);

console.log(JSON.stringify({
  seed, ticks: TICKS,
  baseline: base,
  // Cassini: independent generator instances — no shared entropy pool.
  // world.rng, world.decorRng, teacherRng, weather.rng are separate
  // mulberry32 closures (src/sim/rng.js, world.js:94, world.js:teacherRng,
  // weather.js:62). A decorRng draw cannot touch world.rng's state.
  cassini_answer: {
    architecture: 'independent-generator-instances',
    sharedEntropyPool: false,
    leakVector: 'code drawing from the wrong stream (world.rng in a decor path, or vice versa)',
    empirical: drainLeak
      ? 'FAIL — decorRng drain shifted the causal trajectory: generator-state leak'
      : 'PASS — 10k decorRng draws left the causal trajectory bit-identical: streams are independent',
  },
  boundary: {
    decorDrainFlips: drainLeak,
    morselDrawsFlip: drawsLeak,
    morselEntitiesFlip: entityEffect,
    verdict: !drainLeak && !drawsLeak
      ? 'PASS — the causal/non-causal RNG boundary holds on seed 42'
      : 'FAIL — something labeled decor feeds a causal input (see which flip fired)',
  },
  detail: {
    note: 'morsel-shim entities CAN legitimately shift the trajectory via the buriedNear sense (world-state effect, not an RNG leak) — the (d) draws-only arm isolates this.',
    drawsOnly: draws,
    shimWithEntities: shim,
  },
}, null, 2));

process.exit(!drainLeak && !drawsLeak ? 0 : 1);
