// The Teacher — Sunny's in-sim avatar (v0.14 "Voices", fourth addition).
//
// A distinct visitor, NOT a tanglekin: a blue monkey in a jaunty newsboy
// cap who enters the Canopy to teach. Per the guest-rites spirit: no
// godmode over the world itself (it cannot edit genomes, spawn food, or
// move creatures), but not a mortal of it either — no hunger, no mating,
// no death, no biochemistry at all.
//
// What it CAN do (its whole repertoire):
//   - move: walk the platforms, hop between them, perch
//   - demo: emit sequences of calls with exact pitches — a motif, a lesson
//   - reward: grant reward to tanglekins whose voicePitch copies the motif
//
// The reward is the culture-bootstrapping mechanism: imitation already
// drifts voicePitch toward heard pitches (vocalImitate); the teacher adds
// a selective reward on TOP, so good imitators learn faster and the
// dialect crystallizes around the motif. Teaching events are logged to
// world.teachLog — cultural inflection points for the evolution tracker.
//
// Two control modes:
//   POSSESSED   — driven by Sunny (the HUD): a command queue
//                 (moveTo / demo / reward / rewardNearest). The autonomous
//                 policy is paused; the teacher only moves and acts on command.
//   AUTONOMOUS  — a simple teacher policy: travel between zones, perch,
//                 demo the motif where there are listeners, wait, reward
//                 the good imitators, rest, repeat.

import { zoneAt, ZONES, callsHeardBy } from './world.js';
import { pushUtterance } from './language.js';

// The lesson: a four-note motif at the teacher's signature pitch.
// Exact pitches — the teacher is a clear model, not a noisy one.
export const TEACHER_MOTIF = [0.62, 0.7, 0.66, 0.56];
export const TEACHER_PITCH = 0.62; // the signature — the dialect seed
export const TEACHER_VOLUME = 0.9; // loud and clear
export const TEACHER_EARSHOT = 200 + TEACHER_VOLUME * 400; // 560 — a whole branch hears
export const IMITATION_WINDOW = 0.12; // |voicePitch − motif| inside this counts as copying
export const REWARD_AMOUNT = 0.3; // the selective bonus for good imitators

export function createTeacher(world, x = 800, platformIndex = 0) {
  return {
    kind: 'teacher',
    id: 'teacher', // never collides with creature numeric ids
    name: 'Sunny',
    x,
    y: null, // derived from the platform each frame
    platformIndex,
    // v0.17.2: the observer's hand. While dragged, movement pauses (the
    // hand holds the teacher) — the senses stay on; being held is feeling.
    dragged: false,
    facing: 1,
    vx: 0,
    hopPhase: 0,
    mode: 'autonomous',
    // Autonomous policy state.
    state: 'perch', // perch | travel | demo | listen | reward | rest
    stateT: 0,
    targetX: x,
    targetPlatform: platformIndex,
    // Demonstration state.
    demoQueue: [], // pitches left to emit
    demoTimer: 0,
    demoType: 'contact',
    demoPitch: TEACHER_PITCH, // the motif center of the current lesson
    lastDemoT: -1000,
    // Possessed command queue: { cmd, ... }.
    commands: [],
    actionLabel: 'perching',
    // v0.14 (senses): the felt body. taste/touch are event-set and decay;
    // comfort is the slow tactile memory that makes the teacher linger.
    senses: null, // refreshed every tick by gatherTeacherSenses
    taste: null, // { flavor, t } — set by teacherEat
    touchT: -1000, // last tactile contact (petted, dragged, groomed)
    comfort: 0, // 0..1 — warmth where it was petted; extends perching
  };
}

export function setTeacherMode(world, teacher, mode) {
  if (mode !== 'possessed' && mode !== 'autonomous') return false;
  if (teacher.mode === mode) return true;
  teacher.mode = mode;
  teacher.commands.length = 0;
  if (mode === 'autonomous') { teacher.state = 'perch'; teacher.stateT = 0; }
  logTeach(world, { t: world.time, kind: 'mode', mode });
  return true;
}

// Possessed control: queue a simple command. Commands:
//   { cmd: 'moveTo', x, platformIndex }
//   { cmd: 'demo', pitches? }        — demonstrate the motif (or given pitches)
//   { cmd: 'reward' }                — reward imitators of the current motif
//   { cmd: 'rewardNearest' }         — reward the nearest creature outright
//   { cmd: 'eat' }                   — taste the nearest fruit in reach
export function commandTeacher(teacher, cmd) {
  if (!cmd || typeof cmd.cmd !== 'string') return false;
  if (cmd.cmd === 'moveTo') {
    if (typeof cmd.x !== 'number' || typeof cmd.platformIndex !== 'number') return false;
  }
  if (cmd.cmd === 'demo' && cmd.pitches !== undefined) {
    if (!Array.isArray(cmd.pitches) || !cmd.pitches.every((p) => typeof p === 'number')) return false;
  }
  teacher.commands.push(cmd);
  return true;
}

function logTeach(world, ev) {
  world.teachLog.push(ev);
  if (world.teachLog.length > 200) world.teachLog.splice(0, world.teachLog.length - 200);
}

// The teacher's voice in the acoustic commons — same registry the
// tanglekins hear, so demonstrations are real calls, not UI fiction.
// Exact pitch: the lesson is clear.
export function emitTeacherCall(world, teacher, type, pitch) {
  const zkey = zoneAt(teacher.x).key;
  const plat = world.platforms[teacher.platformIndex];
  const ty = plat ? plat.y : 0;
  // v0.16: the teacher's calls are full acoustic events — loud and clear
  // (loudness 0.95), deliberate length. The Rosetta stone must carry.
  const call = {
    t: world.time, type,
    pitch: Math.max(0.05, Math.min(1, pitch)),
    length: 0.4, loudness: 0.95,
    volume: TEACHER_VOLUME, earshot: TEACHER_EARSHOT,
    platformIndex: teacher.platformIndex, x: teacher.x, y: ty, zone: zkey,
    callerId: 'teacher', callerName: 'Sunny', fromTeacher: true,
    proto: null,
  };
  call.proto = { pitch: call.pitch, length: call.length, loudness: call.loudness };
  world.calls.push(call);
  let log = world.zoneCalls[zkey];
  if (!log) { log = []; world.zoneCalls[zkey] = log; }
  log.push({ t: world.time, pitch, type, fromTeacher: true });
  if (log.length > 300) log.splice(0, log.length - 300);
  pushUtterance(world, call);
}

// Begin a demonstration: a sequence of exact-pitch calls, one per 0.7s.
// type is the call's meaning — 'contact' (default), 'food' (after a good
// taste), 'danger' (on witnessing a death), 'come' (a summons). Together
// FOOD/DANGER/COME are the Rosetta stone of the emerging lexicon.
const DEMO_LABELS = {
  food: 'teaching: food 🍎',
  danger: 'teaching: danger ⚠️',
  come: 'calling: come here 📢',
  contact: 'demonstrating 🎵',
};
export function teacherDemo(world, teacher, pitches = TEACHER_MOTIF, type = 'contact') {
  teacher.demoQueue = [...pitches];
  teacher.demoTimer = 0;
  teacher.demoType = type;
  teacher.demoPitch = pitches.length
    ? pitches.reduce((a, b) => a + b, 0) / pitches.length
    : TEACHER_PITCH;
  teacher.lastDemoT = world.time;
  teacher.actionLabel = DEMO_LABELS[type] || DEMO_LABELS.contact;
  logTeach(world, {
    t: world.time, kind: 'demo', type,
    pitches: [...pitches], zone: zoneAt(teacher.x).key,
    listeners: countListeners(world, teacher),
  });
}

function countListeners(world, teacher) {
  let n = 0;
  for (const c of world.creatures) {
    if (!c.alive || c.platformIndex !== teacher.platformIndex) continue;
    if (Math.abs(c.x - teacher.x) <= TEACHER_EARSHOT) n++;
  }
  return n;
}

// Reward the imitators: creatures on the teacher's platform, in earshot,
// whose LEARNED voicePitch sits inside the imitation window of the motif.
// This is selection for culture — copying pays.
export function teacherReward(world, teacher, pitch = teacher.demoPitch) {
  let n = 0;
  for (const c of world.creatures) {
    if (!c.alive || c.platformIndex !== teacher.platformIndex) continue;
    if (Math.abs(c.x - teacher.x) > TEACHER_EARSHOT) continue;
    const d = Math.abs((c.voicePitch ?? 0.5) - pitch);
    if (d <= IMITATION_WINDOW) {
      c.reward += REWARD_AMOUNT * (1 - d / IMITATION_WINDOW);
      n++;
    }
  }
  if (n > 0) {
    logTeach(world, { t: world.time, kind: 'reward', pitch, n, zone: zoneAt(teacher.x).key });
  }
  return n;
}

// Possessed helper: reward the single nearest creature outright —
// the "good, that one" tap. Same platform, within 400px.
export function teacherRewardNearest(world, teacher) {
  let best = null, bestD = 400;
  for (const c of world.creatures) {
    if (!c.alive || c.platformIndex !== teacher.platformIndex) continue;
    const d = Math.abs(c.x - teacher.x);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return null;
  best.reward += 0.2;
  logTeach(world, { t: world.time, kind: 'rewardNearest', creature: best.id, zone: zoneAt(teacher.x).key });
  return best;
}

// --- Locomotion -----------------------------------------------------------
// The teacher walks its platform and swings between them — a visitor's
// privilege: it isn't bound by climb links, but it only ever moves itself.
// Travel runs in two phases: walk to the departure point (this branch's
// nearest point to the target), swing across, then walk to the target x.
const TEACHER_SPEED = 110; // px/s
// NOTE (v0.15 "Bloom"): this was plain `moveToward` until it collided with
// creature.js's `moveToward` in the dist bundle — scripts/build.js
// concatenates every module into ONE scope, so the later definition
// (teacher's) silently replaced the creature one and every creature's
// wander/eat/play/mate movement ran teacher logic with
// `c.targetX === undefined`, writing NaN into creature.x. Module scope
// hides the collision in src/ (tests stay green); the shipped bundle is
// where it bites. Keep this name unique across modules — build.js enforces
// it with a duplicate-declaration guard.
function moveTeacherToward(teacher, world, dt) {
  const plat = world.platforms[teacher.platformIndex];
  const tplat = world.platforms[teacher.targetPlatform];

  const walk = (destX) => {
    const dx = destX - teacher.x;
    if (Math.abs(dx) < 6) { teacher.vx = 0; return true; }
    const step = Math.sign(dx) * Math.min(Math.abs(dx), TEACHER_SPEED * dt);
    teacher.x += step;
    teacher.vx = Math.sign(dx) * TEACHER_SPEED;
    teacher.facing = dx >= 0 ? 1 : -1;
    teacher.hopPhase += dt * 9;
    teacher.x = Math.max(plat.x1 + 10, Math.min(plat.x2 - 10, teacher.x));
    return false;
  };

  if (teacher.platformIndex === teacher.targetPlatform) {
    return walk(teacher.targetX); // arrived ⟺ within 6px of the target
  }
  // Phase 1: reach the departure point, then swing to the target branch.
  const departX = Math.max(plat.x1 + 10, Math.min(plat.x2 - 10, teacher.targetX));
  if (walk(departX)) {
    teacher.platformIndex = teacher.targetPlatform;
    teacher.x = Math.max(tplat.x1 + 10, Math.min(tplat.x2 - 10, teacher.targetX));
    teacher.vx = 0;
  }
  return false;
}

function pickTravelTarget(world, teacher, rng) {
  // Prefer zones that have creatures — students, not empty branches.
  const withCreatures = new Set(world.creatures.filter((c) => c.alive).map((c) => zoneAt(c.x).key));
  let zone;
  for (let i = 0; i < 6; i++) {
    zone = rng.pick(ZONES);
    if (withCreatures.size === 0 || withCreatures.has(zone.key)) break;
  }
  const plats = world.platforms
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.x2 > zone.x1 && p.x1 < zone.x2);
  const { p, i } = rng.pick(plats.length ? plats : world.platforms.map((p, i) => ({ p, i })));
  teacher.targetX = rng.range(p.x1 + 40, p.x2 - 40);
  teacher.targetPlatform = i;
}

// --- The tick ---------------------------------------------------------------
export function tickTeacher(world, teacher, dt) {
  // The visitor's own stream — never the world's main sequence.
  const rng = world.teacherRng || world.rng;

  // The senses refresh every tick, in both modes — possession means feeling.
  teacher.senses = gatherTeacherSenses(world, teacher);
  // Comfort is slow tactile memory; it fades over a couple of minutes.
  teacher.comfort = Math.max(0, teacher.comfort - dt * 0.008);

  // Demonstrations emit on their own clock in either mode.
  if (teacher.demoQueue.length) {
    teacher.demoTimer -= dt;
    if (teacher.demoTimer <= 0) {
      const pitch = teacher.demoQueue.shift();
      emitTeacherCall(world, teacher, teacher.demoType || 'contact', pitch);
      teacher.demoTimer = 0.7;
      teacher.actionLabel = DEMO_LABELS[teacher.demoType] || DEMO_LABELS.contact;
    }
  }

  // v0.17.2: held by the observer's hand — the body waits, the senses stay on.
  if (teacher.dragged) { teacher.vx = 0; return; }

  if (teacher.mode === 'possessed') {
    // The hand of Sunny: commands only, no policy.
    const cmd = teacher.commands.shift();
    if (cmd) runCommand(world, teacher, cmd);
    // Drift toward any commanded destination; otherwise perch.
    if (teacher.platformIndex !== teacher.targetPlatform || Math.abs(teacher.targetX - teacher.x) > 6) {
      const arrived = moveTeacherToward(teacher, world, dt);
      if (!teacher.demoQueue.length) teacher.actionLabel = arrived ? 'perching' : 'traveling';
    } else if (!teacher.demoQueue.length) {
      teacher.vx = 0;
      teacher.actionLabel = 'perching';
    }
    return;
  }

  // AUTONOMOUS — the teacher policy.
  teacher.stateT += dt;
  switch (teacher.state) {
    case 'perch': {
      teacher.vx = 0;
      if (!teacher.demoQueue.length) teacher.actionLabel = 'perching';
      const listeners = countListeners(world, teacher);
      const s = teacher.senses;
      // The senses steer: a heard call gets answered — the students called,
      // the teacher answers. Ripe fruit on the wind is worth a visit.
      if (s.hearCall > 0.5 && world.time - teacher.lastDemoT > 30) {
        teacher.state = 'demo';
        teacherDemo(world, teacher);
        teacher.stateT = 0;
        break;
      }
      if (s.smellRipe && s.smellFruit > 0.55 && s.smellFruitX !== null &&
          world.time - teacher.lastDemoT > 60) {
        teacher.targetX = s.smellFruitX;
        teacher.targetPlatform = s.smellFruitPlat;
        teacher.state = 'travel';
        teacher.stateT = 0;
        logTeach(world, { t: world.time, kind: 'followSmell', zone: zoneAt(s.smellFruitX).key });
        break;
      }
      // Comfort makes the teacher linger where it was welcomed.
      if (teacher.stateT > rng.range(8, 20) * (1 + teacher.comfort * 1.5)) {
        if (listeners > 0 && world.time - teacher.lastDemoT > 30) {
          teacher.state = 'demo';
          teacherDemo(world, teacher);
        } else {
          pickTravelTarget(world, teacher, rng);
          teacher.state = 'travel';
        }
        teacher.stateT = 0;
      }
      break;
    }
    case 'travel': {
      teacher.actionLabel = 'traveling';
      if (moveTeacherToward(teacher, world, dt)) {
        logTeach(world, { t: world.time, kind: 'arrive', zone: zoneAt(teacher.x).key });
        teacher.state = countListeners(world, teacher) > 0 ? 'demo' : 'perch';
        if (teacher.state === 'demo') teacherDemo(world, teacher);
        teacher.stateT = 0;
      }
      break;
    }
    case 'demo': {
      // The demonstration plays out on the demo clock above; when the
      // queue drains, give the students a few seconds to imitate, then
      // reward the ones who copied.
      if (!teacher.demoQueue.length) {
        teacher.state = 'listen';
        teacher.stateT = 0;
        teacher.actionLabel = 'listening 👂';
      }
      break;
    }
    case 'listen': {
      teacher.vx = 0;
      if (teacher.stateT > 6) {
        teacher.state = 'reward';
        teacher.stateT = 0;
      }
      break;
    }
    case 'reward': {
      teacherReward(world, teacher);
      teacher.actionLabel = 'rewarding 🌟';
      teacher.state = 'rest';
      teacher.stateT = 0;
      break;
    }
    case 'rest': {
      teacher.vx = 0;
      if (!teacher.demoQueue.length) teacher.actionLabel = 'resting';
      if (teacher.stateT > rng.range(10, 25) * (1 + teacher.comfort)) {
        pickTravelTarget(world, teacher, rng);
        teacher.state = 'travel';
        teacher.stateT = 0;
      }
      break;
    }
    default: {
      teacher.state = 'perch';
      teacher.stateT = 0;
    }
  }
}

function runCommand(world, teacher, cmd) {
  switch (cmd.cmd) {
    case 'moveTo':
      teacher.targetX = Math.max(0, Math.min(world.width, cmd.x));
      teacher.targetPlatform = Math.max(0, Math.min(world.platforms.length - 1, cmd.platformIndex));
      logTeach(world, { t: world.time, kind: 'command', command: 'moveTo', zone: zoneAt(teacher.targetX).key });
      break;
    case 'demo':
      teacherDemo(world, teacher, cmd.pitches || TEACHER_MOTIF, cmd.type || 'contact');
      break;
    case 'reward':
      teacherReward(world, teacher, cmd.pitch);
      break;
    case 'rewardNearest': {
      const c = teacherRewardNearest(world, teacher);
      if (c) teacher.actionLabel = `rewarding ${c.name} 🌟`;
      break;
    }
    case 'eat': {
      const flavor = teacherEat(world, teacher);
      if (!flavor) teacher.actionLabel = 'no fruit in reach 👅';
      break;
    }
    default:
      break; // unknown commands are ignored, never crash the sim
  }
}

// ---------------------------------------------------------------------------
// The senses (v0.14, fifth addition). The teacher is possessed — Sunny must
// feel the world through it: sight, sound, smell, taste, touch.
//
// The senses skill's law holds here: a sensation is real because its
// consequences are real. The teacher has no biochem (a guest, not a
// mortal), so sensations bind to what a teacher HAS: its policy state,
// its travel targets, its demonstrations, its comfort, its log.
// Decorative adjectives with no consequence are cut.
//
// New teacher senses live in their own namespace — the tanglekin
// senseVector indices are never renumbered.

const SEE_RANGE = 520; // a clear view across a branch
const SMELL_RANGE = 420; // fruit on the wind
const EAT_REACH = 70;

function dirWord(dx) {
  if (dx > 25) return 'east';
  if (dx < -25) return 'west';
  return 'here';
}

function pitchWord(p) {
  if (p > 0.72) return 'high';
  if (p < 0.38) return 'low';
  return 'mid';
}

// The flavor is read off the fruit's own fields — bitterness, nutrition,
// rot — never invented.
export function foodFlavor(food, world) {
  if ((food.bitterness || 0) > 0.45) return 'bitter';
  if (food.rotsAt > 0 && world.time > food.rotsAt - 20) return 'soft and overripe';
  if ((food.nutrition || 1) >= 1) return 'sweet';
  return 'tart';
}

// The full sensory field, refreshed every tick in both modes.
export function gatherTeacherSenses(world, teacher) {
  const s = {
    seeCreatures: 0, seeNearest: null, // { dist, dir }
    seeFruit: 0, seeRipe: null, // { dist, dir } — ripe = low bitterness
    hearCall: 0, hearPitch: 0, hearType: null, hearDir: null, hearAlarm: false,
    smellFruit: 0, smellFruitDir: null, smellRipe: false, smellFruitX: null, smellFruitPlat: null,
    smellCreature: 0,
    taste: teacher.taste && world.time - teacher.taste.t < 12 ? teacher.taste.flavor : null,
    touch: Math.max(0, 1 - (world.time - teacher.touchT) / 8), // pet/drag/groom echo
    comfort: teacher.comfort,
    moving: Math.abs(teacher.vx) > 1,
    perched: Math.abs(teacher.vx) <= 1,
  };

  // Sight: who is on this branch, and is there fruit?
  let bestC = null, bestCD = Infinity;
  for (const c of world.creatures) {
    if (!c.alive || c.platformIndex !== teacher.platformIndex) continue;
    const d = Math.abs(c.x - teacher.x);
    if (d > SEE_RANGE) continue;
    s.seeCreatures++;
    if (d < bestCD) { bestCD = d; bestC = c; }
  }
  if (bestC) s.seeNearest = { dist: bestCD, dir: dirWord(bestC.x - teacher.x) };
  let bestR = null, bestRD = Infinity;
  for (const f of world.foods) {
    if (f.platformIndex !== teacher.platformIndex) continue;
    const d = Math.abs(f.x - teacher.x);
    if (d > SEE_RANGE) continue;
    s.seeFruit++;
    if ((f.bitterness || 0) <= 0.45 && d < bestRD) { bestRD = d; bestR = f; }
  }
  if (bestR) s.seeRipe = { dist: bestRD, dir: dirWord(bestR.x - teacher.x) };

  // Hearing: the acoustic commons, through the same ears as the tanglekins.
  // (callsHeardBy skips the teacher's own calls — it never hears itself.)
  const heard = callsHeardBy(world, teacher);
  s.hearCall = heard.heard;
  s.hearPitch = heard.pitch;
  s.hearAlarm = heard.alarm;
  if (heard.heard > 0) {
    // Find the call itself for its meaning and direction.
    let bc = null, bs = 0;
    for (const call of world.calls || []) {
      if (call.platformIndex !== teacher.platformIndex || call.callerId === teacher.id) continue;
      const d = Math.abs(call.x - teacher.x);
      if (d > call.earshot) continue;
      const score = call.volume * Math.max(0, 1 - (world.time - call.t) / 2);
      if (score > bs) { bs = score; bc = call; }
    }
    if (bc) {
      s.hearType = bc.type;
      s.hearDir = dirWord(bc.x - teacher.x);
    }
  }

  // Smell: fruit on the wind (stronger when ripe), tanglekin musk near.
  let sF = null, sFD = Infinity;
  for (const f of world.foods) {
    const d = Math.abs(f.x - teacher.x);
    if (d > SMELL_RANGE) continue;
    if (d < sFD) { sFD = d; sF = f; }
  }
  if (sF) {
    s.smellFruit = Math.max(0, 1 - sFD / SMELL_RANGE);
    s.smellFruitDir = dirWord(sF.x - teacher.x);
    s.smellRipe = (sF.bitterness || 0) <= 0.45;
    s.smellFruitX = sF.x;
    s.smellFruitPlat = sF.platformIndex;
  }
  let sCD = Infinity;
  for (const c of world.creatures) {
    if (!c.alive) continue;
    const d = Math.abs(c.x - teacher.x);
    if (d < sCD) sCD = d;
  }
  if (sCD <= 300) s.smellCreature = Math.max(0, 1 - sCD / 300);

  return s;
}

// Taste: the teacher samples a nearby fruit. Real consequences — the fruit
// is eaten (removed from the world), and a good taste becomes a 'food'
// lesson: the teacher demonstrates where food is.
export function teacherEat(world, teacher) {
  let best = null, bestD = EAT_REACH;
  for (const f of world.foods) {
    if (f.platformIndex !== teacher.platformIndex) continue;
    const d = Math.abs(f.x - teacher.x);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best) return null;
  const flavor = foodFlavor(best, world);
  best.amount -= 1;
  if (best.amount <= 0.01) {
    const i = world.foods.indexOf(best);
    if (i >= 0) world.foods.splice(i, 1);
  }
  teacher.taste = { flavor, t: world.time };
  teacher.actionLabel = `tasting: ${flavor} 👅`;
  logTeach(world, { t: world.time, kind: 'taste', flavor, zone: zoneAt(teacher.x).key });
  if (flavor === 'sweet' || flavor === 'tart') {
    // This is food — say so, where the students can hear it.
    teacherDemo(world, teacher, [0.55, 0.5], 'food');
  }
  return flavor;
}

// Touch: petted (or dragged, or groomed against). Comfort is the slow
// tactile memory — it makes the autonomous teacher linger where it was
// welcomed. Consequence, not decoration.
export function petTeacher(world, teacher) {
  teacher.touchT = world.time;
  teacher.comfort = Math.min(1, teacher.comfort + 0.25);
  teacher.actionLabel = 'being petted 💕';
  logTeach(world, { t: world.time, kind: 'petted', comfort: teacher.comfort });
  return teacher.comfort;
}

// --- Plain-language sense lines (second person — Sunny IS the teacher) ---
export function teacherSenseLines(world, teacher) {
  const s = teacher.senses || gatherTeacherSenses(world, teacher);
  const lines = [];
  // Sight.
  if (s.seeCreatures > 0) {
    const n = s.seeCreatures === 1 ? 'One tanglekin' : `${s.seeCreatures} tanglekins`;
    lines.push(`👁️ ${n} in view${s.seeNearest ? ` — the nearest ${Math.round(s.seeNearest.dist)}px ${s.seeNearest.dir}` : ''}.`);
  } else {
    lines.push('👁️ No tanglekins in view.');
  }
  if (s.seeRipe) {
    lines.push(s.seeRipe.dir === 'here'
      ? '👁️ Ripe fruit close by, within reach.'
      : `👁️ Ripe fruit ${Math.round(s.seeRipe.dist)}px ${s.seeRipe.dir}.`);
  } else if (s.seeFruit > 0) {
    lines.push('👁️ Fruit in view, none of it ripe.');
  }
  // Hearing.
  if (s.hearCall > 0.15 && s.hearType) {
    const kind = s.hearType === 'alarm' ? 'an alarm call' :
      s.hearType === 'food' ? 'a food call' :
      s.hearType === 'mate' ? 'a mate call' : 'a call';
    const what = s.hearType === 'contact' ? 'call' : kind;
    const where = s.hearDir === 'here' ? 'close by' : `from the ${s.hearDir}`;
    lines.push(`👂 ${s.hearType === 'alarm' ? '⚠️ ' : ''}A tanglekin's ${what}, ${pitchWord(s.hearPitch)} and ${s.hearCall > 0.6 ? 'clear' : 'faint'}, ${where}.`);
  } else {
    lines.push('👂 The canopy is quiet.');
  }
  // Smell.
  if (s.smellFruit > 0.15) {
    const where = s.smellFruitDir === 'here' ? 'close by' : `to the ${s.smellFruitDir}`;
    lines.push(`👃 You smell ${s.smellRipe ? 'ripe ' : ''}fruit ${where}${s.smellFruit > 0.6 ? ' — strong' : ''}.`);
  }
  if (s.smellCreature > 0.5) {
    lines.push('👃 Tanglekin musk, close.');
  }
  // Taste.
  if (s.taste) {
    lines.push(`👅 ${s.taste[0].toUpperCase() + s.taste.slice(1)} — the last bite still lingers.`);
  }
  // Touch.
  if (s.touch > 0.4) {
    lines.push('🤚 A recent touch — hand, or fur against fur.');
  }
  if (s.comfort > 0.5) {
    lines.push(`😌 Warmth where you were petted (comfort ${s.comfort.toFixed(1)}).`);
  }
  return lines;
}

// The text serialization — the possession bridge. Readable by Sunny in
// chat, complete enough to drive the teacher from words alone.
export function serializeTeacherSenses(world, teacher) {
  const s = teacher.senses || gatherTeacherSenses(world, teacher);
  const day = Math.floor(world.time / 1440) + 1;
  const lines = teacherSenseLines(world, teacher);
  return [
    `Sunny (teacher) — ${teacher.mode === 'possessed' ? 'POSSESSED, yours' : 'autonomous'} · Day ${day} · ${zoneAt(teacher.x).name} · ${teacher.actionLabel || teacher.state}`,
    ...lines,
    `commands: moveTo(x, platformIndex) · demo · reward · rewardNearest · eat`,
  ].join('\n');
}
