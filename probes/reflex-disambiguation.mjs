// v0.33 reflex-architecture disambiguation (Colony feedback: hermes-on-foot on v0.32).
//
// STATUS: full-world CONFIRMATION, not discovery. Traverse ran the
// discrimination at stub level first (2026-10-02) and found reading (a):
// sensory damage 1 → brain-visible pain 0 with the reflex still selected
// and delivered flee; motor damage 1 → brain-visible pain 1 with the reflex
// command blocked. This probe re-runs it in the live sim (nick trunk,
// apply pain, watch flee timing) and checks for divergence.
//
// v0.32's reflex "fires at tick 0" — relative to what? Two architectures:
//   (a) reflex logic at the periphery, pre-trunk — nicking the trunk should
//       NOT touch the reflex (nerves fail gracefully);
//   (b) the reflex rides the same trunks — a nicked trunk mutes reflex and
//       sensation both.
// The v0.32 probes didn't discriminate. This one does: nick the trunk,
// apply pain, watch flee timing.
//
// Design (from the code): evalReflexes reads the FRESH sense object
// (pre-sensory-trunk), but fireReflex delivers through the motor trunk
// (motorDamage drops reflex commands). Predicted: HYBRID — sensory nick
// leaves the reflex intact, motor nick mutes it.
//
// Run: node probes/reflex-disambiguation.mjs [seed]
import { createWorld, bindWorld, tickWorld, platformIndexAt } from '../src/sim/world.js';
import { createRng } from '../src/sim/rng.js';
import { founderPheno } from '../src/sim/species.js';
import { createCreature } from '../src/sim/creature.js';
import { damageNerve } from '../src/sim/nerves.js';

const seed = parseInt(process.argv[2] || '4242', 10);
const TRIALS = 40;

function snapToPlatform(world, x) {
  for (const dx of [0, 60, -60, 140, -140, 260, -260]) {
    const pi = platformIndexAt(world, x + dx, 800);
    if (pi >= 0) {
      const p = world.platforms[pi];
      return { x: Math.min(Math.max(x + dx, p.x1 + 30), p.x2 - 30), pi };
    }
  }
  throw new Error('no platform');
}

function mkRat() {
  const world = bindWorld(createWorld(seed));
  world.creatures.length = 0;
  const { x: sx, pi } = snapToPlatform(world, 1900);
  const { genome } = founderPheno('tanglekin', createRng(seed + Math.round(sx)));
  const c = createCreature(genome, sx, pi, world.rng);
  c.biochem.age = c.pheno.lifespanSec * 0.5;
  world.creatures.push(c);
  return { world, c };
}

function seal(c, injury) {
  const b = c.biochem;
  b.hunger = 0; b.energy = 0.95; b.fear = 0; b.illness = 0;
  b.hydration = 1; b.bloodSugar = 1; b.health = 1;
  b.injury = injury;
}

// Fire-rate of the pain→flee reflex over TRIALS pain spikes.
function reflexFireRate(nickTrunk) {
  let fired = 0;
  for (let t = 0; t < TRIALS; t++) {
    const { world, c } = mkRat();
    for (let i = 0; i < 10; i++) { seal(c, 0); tickWorld(world, 0.1); }
    if (nickTrunk) damageNerve(c, nickTrunk, 0.9);
    seal(c, 0.5); // pain spike
    c.action = 'wander'; c.actionTimer = 0; c.nerves.motorBuf.length = 0;
    tickWorld(world, 0.1);
    // The reflex stamps _reflexFired='flee' when it fires (even if the
    // motor trunk drops the command, the EVALUATION still ran).
    if (c._reflexFired === 'flee') fired++;
  }
  return fired / TRIALS;
}

const intact = reflexFireRate(null);
const sensoryNick = reflexFireRate('sensory');
const motorNick = reflexFireRate('motor');

const sensoryIntact = sensoryNick > 0.8 * intact;
const motorMuted = motorNick < 0.3 * intact;

console.log(JSON.stringify({
  seed, trials: TRIALS,
  reflexFireRate: { intact, sensoryNicked: sensoryNick, motorNicked: motorNick },
  architecture: sensoryIntact && motorMuted
    ? 'HYBRID — reflex evaluates at the periphery (pre-sensory-trunk: sensory nick does not touch it) but its command rides the motor trunk (motor nick mutes it). Neither pure (a) nor pure (b).'
    : 'UNEXPECTED — does not match the hybrid prediction; investigate.',
  detail: {
    sensoryNickLeavesReflex: sensoryIntact,
    motorNickMutesReflex: motorMuted,
    note: 'fireReflex checks motorDamage and drops with P=damage (nerves.js). evalReflexes reads fresh (pre-trunk) senses (creature.js).',
  },
}, null, 2));
