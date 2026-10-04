// Loam creature-art pass — PORTRAIT.
//
// The dynamic half of the drawing. body.js describes the grown body (static:
// coat, pattern, ears, eyes, proportions). This module reads the creature's
// LIVE state — chemistry drives, last action, locomotion flags — and computes
// how the body holds itself this tick: posture, face, tail, gait.
//
// The contract, and it is absolute:
//   portrait = pure function of (creature, tick).
// It NEVER writes to the creature, the grid, or anything else. Same
// (creature, tick) → identical portrait → identical pixels. The expression
// is a READOUT of real internal state (driveLevels off the actual
// biochemistry), never a mood ring.
//
// portraitFor(c, tick) → { ...bodyDrawing(c.body), affect, pose }
// The renderer spreads the static drawing and reads .affect / .pose.
// Callers that still pass a bare bodyDrawing() get the neutral pose.

import { bodyDrawing } from './body.js';
import { driveLevels } from './chem.js';
import { ACTIONS } from './brain.js';

// The action name behind the creature's last decision — the pose's verb.
// Reads the brain's own action index; never a display string from elsewhere.
function actionName(c) {
  return (c.lastAction >= 0 && c.lastAction < ACTIONS.length) ? ACTIONS[c.lastAction] : 'wander';
}

// --- deterministic salt ------------------------------------------------------
// Stateless hash → [0,1). Per-creature phase offsets so two founders never
// blink or sway in sync. Same family as the renderer's h3.
function h3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x51ab, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

// --- affect: whose face is this? ----------------------------------------------
// The dominant deficit drive names the affect; when nothing presses, the
// recent reward and the current action decide between content and curious.
// Every field below is read off real state — never invented.
export function affectReadout(c) {
  const chem = c.chem || {};
  const lv = driveLevels(chem);
  let dominant = 'content';
  let strength = 0;
  for (const k of ['fear', 'injury', 'illness', 'hunger', 'thirst', 'tiredness']) {
    if (lv[k] > strength) { strength = lv[k]; dominant = k; }
  }
  const act = actionName(c);
  if (strength < 0.35) {
    dominant = (act === 'inspect' || act === 'play' || act === 'vocal') ? 'curious' : 'content';
    strength = 1 - strength; // ease, not urgency
  }
  return { dominant, strength: clamp01(strength), levels: lv };
}

// Locomotion-ish actions: the legs are working.
const GAIT_ACTIONS = new Set([
  'seekFood', 'wander', 'approach', 'flee', 'seekHome', 'seekBond',
  'carry', 'grasp', 'tend', 'mourn', 'mate',
]);

// --- pose --------------------------------------------------------------------
// Every field is a small number the renderer turns into joint angles.
// Canonical frame: feet at origin, facing +x, lengths in px.
export function poseFor(c, tick) {
  const id = (c.body && c.body.creatureId) || c.id || 0;
  const H = (c.body && c.body.heightPx) || 60;
  const act = actionName(c);
  const aff = affectReadout(c);
  const lv = aff.levels;
  const ph = h3(id, 7, 1) * Math.PI * 2; // per-creature phase

  // base pose from the action
  const p = {
    crouch: 0,        // 0 stand … 1 full crouch (lowers body)
    spineLean: 0,     // radians, +forward
    headPitch: 0,     // radians, +down
    eyeOpen: 0.85,
    browDrop: 0,
    mouthOpen: 0,
    earBack: 0,
    tailCurl: 0.45,   // resting curl
    tailRaise: 0,     // -1 tucked … +1 raised
    armReach: 0,      // 0 at sides … 1 extended forward
    gaitAmp: 0,       // walk-cycle amplitude (px at the foot)
    gaitFreq: 0.35,   // radians per tick
    swayAmp: 0,       // rhythmic side sway (display)
    breathAmp: 1,
    digOsc: 0,        // digging-arm oscillation amplitude
    curled: 0,        // sleep curl
  };

  switch (act) {
    case 'sleep': p.curled = 1; p.eyeOpen = 0; p.breathAmp = 1.6; p.crouch = 0.85; break;
    case 'dig': p.spineLean = 0.55; p.armReach = 0.9; p.crouch = 0.35; p.digOsc = 1; p.headPitch = 0.4; break;
    case 'climb':
      p.spineLean = -0.12; p.armReach = 1; p.crouch = -0.15; p.gaitAmp = H * 0.10; p.gaitFreq = 0.5;
      p.tailCurl = Math.max(p.tailCurl, 0.75); // the tail grips while climbing
      p.tailRaise = Math.max(p.tailRaise, 0.3);
      break;
    case 'eat': p.headPitch = 0.55; p.mouthOpen = 0.8; p.armReach = 0.7; p.crouch = 0.15; break;
    case 'drink': p.headPitch = 0.7; p.crouch = 0.3; break;
    case 'groom': case 'cuddle': p.spineLean = 0.3; p.armReach = 0.85; p.headPitch = 0.25; break;
    case 'flee': p.crouch = 0.35; p.gaitAmp = H * 0.22; p.gaitFreq = 0.62; p.earBack = 0.8; p.tailRaise = -0.8; p.eyeOpen = 1; break;
    case 'display': p.crouch = -0.25; p.tailRaise = 1; p.swayAmp = 1; p.mouthOpen = 0.35; p.spineLean = -0.15; p.eyeOpen = 1; break;
    case 'vocal': p.headPitch = -0.5; p.mouthOpen = 1; p.tailRaise = 0.5; break;
    case 'mourn': p.headPitch = 0.5; p.eyeOpen = 0.55; p.crouch = 0.25; p.swayAmp = 0; break;
    case 'inspect': p.headPitch = -0.15; p.eyeOpen = 1; p.spineLean = 0.18; p.armReach = 0.3; break;
    case 'play': p.tailRaise = 0.6; p.gaitAmp = H * 0.14; p.gaitFreq = 0.55; p.eyeOpen = 1; break;
    case 'bask': p.crouch = 0.45; p.armReach = 0.5; p.eyeOpen = 0.5; p.spineLean = 0.2; break;
    case 'pile': case 'instPile': p.spineLean = 0.4; p.armReach = 0.8; p.crouch = 0.25; p.headPitch = 0.35; break;
    case 'bite': p.spineLean = 0.45; p.mouthOpen = 1; p.browDrop = 0.7; p.crouch = 0.2; break;
    case 'geophagy': p.headPitch = 0.6; p.mouthOpen = 0.5; p.crouch = 0.4; break;
    default:
      if (GAIT_ACTIONS.has(act)) {
        p.gaitAmp = H * 0.15;
        // the tail works while walking: raised for balance, swaying against
        // the stride — a monkey's tail is never idle in motion.
        p.tailRaise = Math.max(p.tailRaise, 0.35);
      }
      break;
  }
  if (c.climbing) { p.spineLean = -0.12; p.armReach = 1; p.crouch = -0.1; p.gaitAmp = Math.max(p.gaitAmp, H * 0.08); }

  // --- affect modulation: the face and posture answer the drives ---
  if (lv.fear > 0.45) {
    const f = clamp01((lv.fear - 0.45) * 2);
    p.crouch += 0.3 * f; p.eyeOpen = Math.max(p.eyeOpen, 0.6 + 0.4 * f);
    p.earBack = Math.max(p.earBack, f); p.tailRaise = Math.min(p.tailRaise, -0.6 * f);
    p.browDrop = Math.max(p.browDrop, 0.5 * f);
  }
  if (lv.tiredness > 0.55) {
    const t = clamp01((lv.tiredness - 0.55) * 2.2);
    p.crouch += 0.25 * t; p.eyeOpen = Math.min(p.eyeOpen, 0.75 - 0.45 * t);
    p.breathAmp *= 1 + 0.5 * t; p.swayAmp *= 1 - 0.7 * t; p.gaitAmp *= 1 - 0.4 * t;
  }
  if (lv.injury > 0.35 || lv.illness > 0.35) {
    const w = clamp01(Math.max(lv.injury, lv.illness));
    p.browDrop = Math.max(p.browDrop, 0.6 * w); p.eyeOpen = Math.min(p.eyeOpen, 0.7);
    p.limp = w; // asymmetric gait — the renderer shortens one leg swing
  }
  if (aff.dominant === 'content') {
    p.tailRaise = Math.max(p.tailRaise, 0.25 * aff.strength);
    p.eyeOpen = clamp01(p.eyeOpen + 0.05);
  }
  if (aff.dominant === 'curious') {
    p.eyeOpen = 1; p.headPitch -= 0.15; p.tailRaise = Math.max(p.tailRaise, 0.4);
  }

  // --- periodic life: blink, breath, sway, gait — all f(tick), all salted ---
  const blinkPeriod = 90 + Math.floor(h3(id, 11, 2) * 120);
  const blinking = ((tick + Math.floor(h3(id, 13, 3) * blinkPeriod)) % blinkPeriod) < 3;
  p.eyeOpenNow = blinking ? 0 : clamp01(p.eyeOpen);
  p.breath = Math.sin(tick * 0.11 + ph) * p.breathAmp;
  p.sway = Math.sin(tick * 0.23 + ph) * p.swayAmp;
  p.gaitPhase = tick * p.gaitFreq + ph;
  p.digPhase = tick * 0.9 + ph;
  // tail sway: idle life, stronger when the tail is raised
  p.tailSway = Math.sin(tick * 0.17 + ph * 1.7) * (0.3 + 0.7 * Math.abs(p.tailRaise));

  p.dominant = aff.dominant;
  p.affectStrength = aff.strength;
  p.action = act;              // the verb behind the pose — species plans read it
  p.glide = (act === 'glide'); // wings spread, not flapping
  return p;
}

// The full visual descriptor: static body + live affect + pose.
// This is what the renderer draws. Pure in, pure out.
export function portraitFor(c, tick) {
  const drawing = bodyDrawing(c.body);
  const affect = affectReadout(c);
  const pose = poseFor(c, tick);
  return { ...drawing, affect, pose };
}

// Neutral pose for callers that still hand the renderer a bare bodyDrawing().
export function neutralPose() {
  return {
    crouch: 0, spineLean: 0, headPitch: 0, eyeOpen: 0.85, eyeOpenNow: 0.85,
    browDrop: 0, mouthOpen: 0, earBack: 0, tailCurl: 0.45, tailRaise: 0,
    armReach: 0, gaitAmp: 0, gaitFreq: 0.35, swayAmp: 0, breathAmp: 1,
    digOsc: 0, curled: 0, breath: 0, sway: 0, gaitPhase: 0, digPhase: 0,
    tailSway: 0, dominant: 'content', affectStrength: 0.5,
    action: 'wander', glide: false,
  };
}
