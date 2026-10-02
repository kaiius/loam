// A creature: genome + biochemistry + brain + body in the world.
// Per tick: sense → brain decides → act → learn from the outcome.

import { phenotype, markLocus } from './genome.js';
import { createBiochem, tickBiochem, ageStage, stageSize, isDead, mood, coldSense, heatSense } from './biochem.js';
import { createBrain, decide, learn, senseVector, ACTIONS } from './brain.js';
import { createMemory, writeEpisode, shouldWrite, recall, consolidate, OBSERVE_RANGE, OBSERVE_DISCOUNT } from './memory.js';
import { foundGrove, adoptTradition, traditionVotes, groveTarget, groveAim, fidelityOf, getTradition, GROVE_MEALS, GROVE_WINDOW, GROVE_RADIUS, GROVE_NEARBY, foundCraft, CRAFT_USES, CRAFT_WINDOW, CRAFT_RADIUS } from './culture.js';
import { pedigreeKin, getBond, nudgeBond } from './social.js';
import { climbLinksFrom, disperseSeed, emitCall, callsHeardBy, zoneAt, noteDeath, excrete, addFood, digAt, WASTE_FRACTION, wasteOdorOf, CONTAM_ILLNESS, SCRAP_FRACTION, SCRAP_ROT, SCRAP_NUTRITION, TISSUE_FRACTION, mineralType, addPebble, addStick, ledgerOut, bodyMassOf, releaseBodyMass } from './world.js';
import { createLexicon, lexSlots, lexLearnRate, speakFromLexicon, registerHeard, registerSpoken, decayLexicon, pushContextWindow, hearerSalientContext, lexiconDistance } from './language.js';
import { expressBuds, developmentalGrowth01, deriveAquaticPheno, SWIM_FLAIL_AREA } from './evodevo.js';
// v0.18 "Realms": the biome map — region layout, temperature fields,
// waters, ground. Pure geography; every call NaN-guarded at use.
import { biomeAt, biomeKeyAt, biomeCenterX, ambientCold, ambientHeat, ambientTemp, waterAt, groundYAt } from './biomes.js';
import { windAt, tempAt, cloudAt, seasonSun } from './weather.js';

let nextId = 1;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
// NaN-safe position readers (the v0.15 lesson — never let a bad coordinate
// poison distance math).
function cx0(c) { return Number.isFinite(c.x) ? c.x : 0; }
function cy0(c) { return Number.isFinite(c.y) ? c.y : 800; }

// --- physics: the canopy has gravity now ---------------------------------
// y grows downward (screen space). Ground platform at y=800 spans the whole
// world, so every fall ends somewhere — there is no void below.
export const GRAVITY = 900; // px/s^2 — the world's own law, not a dice roll
export const MAX_FALL = 950; // terminal velocity px/s
export const FALL_HURT_V = 520; // land faster than this and it costs you
export const FALL_DMG = 1 / 900; // injury per px/s of impact past the threshold
// v0.20 "Falling": the vestibular threshold — dropping faster than this, the
// fall is felt while it happens (sense 34). Below it, short hops stay quiet.
export const FALL_FEEL_V = 180;
// v0.20 "Falling": a fall longer than this strands — the landing is an
// ecological event (chronicle line, a long climb back), not a damage tick.
export const STRAND_PX = 350;
export const JUMP_V_BASE = 260; // px/s upward at legPower 0
export const JUMP_V_GAIN = 420; // +px/s of launch at legPower 1
export const JUMP_RANGE_DY = 280; // highest ledge the jumpNear sense can see
export const JUMP_RANGE_DX = 220; // farthest sideways the jumpNear sense sees
// v0.17 "Bauplan": the glide verb's reach — a ledge within this box but
// beyond jump range is what farLedge (sense 25) reports.
export const GLIDE_RANGE_DY = 520; // highest ledge a glide can reach
export const GLIDE_RANGE_DX = 450; // farthest sideways a glide carries
// v0.18 "Realms": water physics. Buoyancy is a spring toward the float
// equilibrium (FLOAT_MARGIN below the surface) with damping — creatures
// float with their backs out, reading submerged=false, breathing air.
// The submerged line is the literal task formula: 14px+ under the surface.
export const SUBMERGE_MARGIN = 14; // px below surfaceY = submerged (task formula)
export const FLOAT_MARGIN = 11; // px below surface at the float equilibrium
export const BUOY_K = 20; // buoyancy spring constant
export const BUOY_DAMP = 4; // buoyancy damping (settles in ~2s; 9 overdamps the discrete integrator)
export const WATER_VEL_DAMP = 2.5; // per-second velocity damping in water
export const WATER_NEAR_RANGE = 240; // px — the waterNear sense horizon
export const BURIED_NEAR_RANGE = 240; // px — the buriedNear sense horizon
export const DRINK_REACH = 40; // px above the surface that still counts as adjacent
export const DIG_TIME = 3; // seconds of digging to unearth buried food
export const DIG_RADIUS = 60; // px — digAt search radius
// v0.18 "Realms": the diet. Meat kinds burn through meatEfficiency;
// small prey and corpses have fixed nutrition overrides. Plant kinds burn
// through fruitEfficiency. Leaves are medicine, scraps desperation.
// Anything not listed is unknown — skipped, never crashed on.
export const MEAT_KINDS = new Set(['meat', 'bug', 'minnow', 'corpse', 'grub', 'morsel']);
export const PLANT_KINDS = new Set(['fruit', 'tuber', 'kelp', 'moss', 'seed',
  'propagule', 'cactusfruit', 'berry', 'snowcache', 'sandcache']);
export const PREY_NUTRITION = 0.15; // bug/minnow/grub/morsel — small mouthfuls
export const CORPSE_NUTRITION = 0.4; // corpse — rotten, but food
// v0.22 "Web of Life": detritivory — grazing the soil's waste directly.
// Poor food (already half-decomposed); the midden beetle's trade.
export const DETRITUS_NUTRITION = 0.25;
export const DETRITUS_WASTE_MIN = 0.5; // soil waste must reach this to be grazeable

const NAMES = [
  'Pip', 'Moss', 'Wren', 'Pebble', 'Fig', 'Nix', 'Bramble', 'Tansy',
  'Clover', 'Soot', 'Miso', 'Plum', 'Ash', 'Juniper', 'Sorrel', 'Dune',
  'Kiki', 'Bram', 'Lark', 'Mallow', 'Nettle', 'Oat', 'Puddle', 'Quill',
];

export function createCreature(genome, x, platformIndex, rng, opts = {}) {
  // v0.18 "Realms": the aquatic derivations (swimSpeed/sailDump/waterDrag)
  // overwrite the old fin-based swimSpeed with the membrane formula.
  const pheno = deriveAquaticPheno(phenotype(genome));
  return {
    kind: 'creature',
    id: nextId++,
    name: opts.name || rng.pick(NAMES),
    genome,
    pheno,
    // v0.17 "Bauplan": the realized body plan — what development has built
    // so far. Newborns are babies; the plan re-expresses on stage changes.
    bodyPlan: expressBuds(pheno, developmentalGrowth01('baby')),
    biochem: createBiochem(),
    brain: createBrain(pheno, rng),
    memory: createMemory(pheno), // episodic memory: lived + observed episodes
    episodeReward: 0, // outcome accumulating since the last decision
    episodeInput: null, // senses at the last decision
    episodeAction: -1, // action index executed since the last decision
    sleepTicks: 0, // consecutive sleeping ticks (gates consolidation)
    x,
    platformIndex,
    // physics: real vertical position + velocity. Grounded creatures stand
    // on their platform's y; airborne ones answer to gravity. y snaps to
    // the platform on the first physics tick (see stepPhysics).
    y: opts.y !== undefined ? opts.y : undefined,
    vx: 0,
    vy: 0,
    grounded: true,
    // v0.17.2: the observer's hand. While dragged, updateCreature pauses
    // physics (the hand holds the body, not the world) — the UI sets this
    // on grab and clears it on release. It was designed but never wired.
    dragged: false,
    // v0.18 "Realms": water state — set each tick by stepPhysics.
    // submerged: 14px+ below the surface (the literal formula).
    // _water: the waterAt() record ({surfaceY, salt}) or null.
    // _waterNear: water within 240px (sense 27).
    submerged: false,
    _water: null,
    _waterNear: false,
    // v0.12: home-range imprinting. Birthplace is home — permanent.
    // Philopatry, not a leash: the brain (via homeDist + instHomeSeek)
    // decides how much it matters.
    homeX: x,
    homePlatform: platformIndex,
    facing: rng.chance(0.5) ? 1 : -1,
    action: 'wander',
    actionLabel: 'wandering',
    sleeping: false,
    playing: false,
    nearFriend: false,
    sex: rng.chance(0.5) ? 'male' : 'female',
    parents: opts.parents || null,
    generation: opts.generation || 0, // v0.7: pedigree depth — the ratchet's clock
    children: [],
    alive: true,
    // v0.7 culture: carried tradition ids, per-tradition aim points (noisy
    // copies), and a log of recent meals for invention detection.
    traditions: [],
    traditionAim: {},
    mealLog: [],
    wanderDir: 1,
    wanderTimer: 0,
    actionTimer: 0, // commitment to the current action (anti-dither)
    mateCooldown: 0,
    pettedFlag: false,
    scoldedFlag: false,
    hopPhase: rng.range(0, Math.PI * 2),
    // v0.14 "Voices": the acoustic self. voicePitch starts at the genetic
    // base and drifts toward heard pitches (vocal learning — dialect).
    // heardPitches is the culture memory: a ring buffer of the last 16
    // pitches heard, the raw material of accent.
    voicePitch: pheno.vocalPitch ?? 0.5,
    heardPitches: [],
    // v0.16 "Tongues": the lexicon — per-creature acoustic prototypes with
    // context tallies. Culture, not DNA: hatchlings start empty and learn
    // by hearing (infant critical-period boost in lexLearnRate).
    lexicon: createLexicon(lexSlots(pheno)),
    _contextWindow: [], // hearer's salient-context window (delta a)
    // v0.14 "Voices": the waste cycle — the gut holds what digestion
    // didn't take. Excretion (in updateCreature) returns it to the soil.
    gut: 0,
    flinchT: 0, // seconds since last injury — drives the flinch flash
    clashCooldown: 0, // per-creature refractory so spikes can't machine-gun
    // v0.20 "Hands": the hand. held is null or { material, weight,
    // hardness, sharpness, flammability, wear } — properties only, never
    // item types (termite logic: the engine never knows a 'hammer').
    // craftLog records successful tool uses for tradition invention.
    held: null,
    craftLog: [],
    // v0.24 "Mass": the body's mass pool. Fixed at the adult mass here;
    // hatchEgg overrides it to the egg mass (exact transfer). Tissue grows
    // from food in doEat (capped at the adult mass); age-stage drives
    // size/radius, never mass. Without this, an age-scaled bodyMassOf
    // created mass from nothing on every life-stage transition.
    bodyMass: 4.8 * (pheno.size ?? 0.3) * 1.0,
  };
}

// v0.20 "Hands": nearest manipulable object within grasp reach — shared
// by the objectNear sense and the grasp action. Returns { obj, kind, dist }
// or null. Pebbles and sticks are grasped whole; mineral deposits yield a
// sample (amount -= 1, mirroring the observer's digMineral) while the
// deposit stays. Same platform only; reach is groomReach (arm reach).
function nearestGraspable(c, world) {
  const reach = c.pheno.groomReach || 40;
  let best = null;
  const consider = (obj, kind, x) => {
    if (obj.platformIndex !== c.platformIndex) return;
    const d = Math.abs(x - c.x);
    if (d > reach) return;
    if (!best || d < best.dist) best = { obj, kind, dist: d };
  };
  for (const p of world.pebbles || []) consider(p, 'pebble', p.x);
  for (const s of world.sticks || []) consider(s, 'stick', s.x);
  for (const m of world.minerals || []) {
    if (m.amount > 0) consider(m, 'mineral', m.x);
  }
  return best;
}

export function creatureRadius(c) {
  return c.pheno.bodyRadius * stageSize(ageStage(c.biochem, c.pheno));
}

// v0.18 "Realms": water state — refreshed every tick. waterAt is null
// outside water; submerged is the literal formula: 14px+ below the
// surface. waterNear scans ±240px. NaN-guarded (the v0.15 lesson).
export function refreshWaterState(c, world) {
  const cx = cx0(c);
  const cy = Number.isFinite(c.y) ? c.y : 800;
  let w = null;
  try { w = waterAt(cx, cy, world.layout); } catch (e) { w = null; }
  c._water = w;
  c.submerged = !!w && Number.isFinite(w.surfaceY) && cy > w.surfaceY + SUBMERGE_MARGIN;
  let near = !!w;
  if (!near) {
    try {
      near = !!waterAt(cx - WATER_NEAR_RANGE, cy, world.layout) || !!waterAt(cx + WATER_NEAR_RANGE, cy, world.layout);
    } catch (e) { near = false; }
  }
  c._waterNear = near;
  return w;
}

const SENSE_RANGE = 420;
const EAT_RANGE = 30;

// v0.18 "Realms": homesickness scales by biome-center distance, not just
// raw displacement — leaving the birth biome costs more than leaving the
// birth zone did (BIOMES_DESIGN §4). The v0.13 base (|x−homeX|/800) is kept
// and multiplied by (1+dist/1200), where dist is the creature's distance
// to its birth biome's center; clamped to [0,1]. NaN anywhere (no home,
// no biome map) falls back to the v0.13 behavior — the v0.15 lesson.
export function scaledHomeDist(c, world) {
  if (c.homeX === undefined || c.homeX === null) return 0;
  const cx = Number.isFinite(c.x) ? c.x : c.homeX;
  const base = Math.abs(cx - c.homeX) / 800;
  if (!Number.isFinite(base)) return 0;
  let dist = 0;
  let ok = false;
  try {
    const hb = biomeAt(c.homeX, Number.isFinite(c.y) ? c.y : 800, world.layout);
    const bcx = biomeCenterX(hb, world.layout);
    if (Number.isFinite(bcx)) { dist = Math.abs(cx - bcx); ok = true; }
  } catch (e) { ok = false; }
  if (!ok || !Number.isFinite(dist)) return clamp01(base);
  return clamp01(base * (1 + dist / 1200));
}

function nearest(list, x, platformIndex, range, excludeId) {
  let best = null;
  let bestD = range;
  for (const o of list) {
    // NB: o.alive === false (strict) so food/toys without an alive field pass.
    if (o.alive === false || o.id === excludeId || o.platformIndex !== platformIndex) continue;
    const d = Math.abs(o.x - x);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best ? { obj: best, dist: bestD / range, dir: Math.sign(best.x - x) || 1 } : null;
}

function nearestSpatial(sorted, x, range, excludeId) {
  if (!sorted || sorted.length === 0) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].x < x) lo = mid + 1; else hi = mid;
  }
  let best = null, bestD = range;
  for (let i = lo - 1; i >= 0; i--) {
    const o = sorted[i];
    const d = x - o.x;
    if (d >= bestD) break;
    if (o.id === excludeId) continue;
    bestD = d; best = o;
  }
  for (let i = lo; i < sorted.length; i++) {
    const o = sorted[i];
    const d = o.x - x;
    if (d >= bestD) break;
    if (o.id === excludeId) continue;
    bestD = d; best = o;
  }
  return best ? { obj: best, dist: bestD / range, dir: Math.sign(best.x - x) || 1 } : null;
}

export function gatherSenses(c, world) {
  const b = c.biochem;
  // v0.6 morphology: sight range comes from the eyeSize gene.
  const range = c.pheno.sightRange || SENSE_RANGE;
  // v0.8: the sick seek the bitter leaf. When ill, the food sense prefers
  // medicinal leaves over fruit — a species-typical prior; the brain (which
  // now senses illness too) learns the rest. Falls back to any food.
  let food = null;
  if (b.illness > 0.25) {
    for (const f of world.foods) {
      if (f.foodKind !== 'leaf' || f.platformIndex !== c.platformIndex) continue;
      const d = Math.abs(f.x - c.x);
      if (d < range && (!food || d < food.dist * range)) {
        food = { obj: f, dist: d / range, dir: Math.sign(f.x - c.x) || 1 };
      }
    }
  }
  if (!food) food = nearest(world.foods, c.x, c.platformIndex, range);
  const other = nearestSpatial(world._spatial && world._spatial.get(c.platformIndex), c.x, range, c.id);
  const toy = nearest(world.toys, c.x, c.platformIndex, range); // v0.22.2: critters retired — toys only
  const stage = ageStage(b, c.pheno);
  // v0.12: the social senses. homeDist — how far from the imprinted home
  // range (0 at home, 1 at 800px+). kinNear — pedigree kinship of the
  // nearest creature (1 parent/child/sibling, 0.5 cousin, else 0).
  // bondNear — the pairwise bond value with that creature (-1..1).
  const otherObj = other && other.obj;
  // Canopy senses (new): climbUp/climbDown — 1 when a climb link to a higher
  // (lower y) or lower branch is reachable from the creature's current x.
  // The instinct genes instClimbUp/instClimbDown wire these to the climb
  // action; the brain learns the rest.
  let climbUp = 0, climbDown = 0;
  for (const { to, link } of climbLinksFrom(world, c.platformIndex)) {
    if (c.x >= link.x1 - 30 && c.x <= link.x2 + 30) {
      if (world.platforms[to].y < world.platforms[c.platformIndex].y) climbUp = 1;
      else climbDown = 1;
    }
  }
  // Physics sense (new): jumpNear — 1 when a jumpable ledge (a higher
  // platform within leap range) is nearby. The instJump gene wires this to
  // the jump action; the brain learns the rest.
  let jumpNear = 0;
  {
    const py = world.platforms[c.platformIndex].y;
    const maxD = Math.hypot(JUMP_RANGE_DX, JUMP_RANGE_DY);
    let bd = Infinity;
    for (let i = 0; i < world.platforms.length; i++) {
      if (i === c.platformIndex) continue;
      const p = world.platforms[i];
      const dy = py - p.y; // positive = ledge above
      if (dy < 30 || dy > JUMP_RANGE_DY) continue;
      const cx = Math.max(p.x1, Math.min(p.x2, c.x));
      const dx = Math.abs(c.x - cx);
      if (dx > JUMP_RANGE_DX) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) bd = d;
    }
    if (bd < Infinity) jumpNear = 1 - bd / maxD;
  }
  // v0.17 "Bauplan": the body-plan senses. airborne is 1 whenever the
  // creature is off the branch — the glide verb's reader. farLedge reports
  // a ledge within glide range but BEYOND jump range: the travel verb's
  // reader, the situation wings are for. submerged/waterNear read the
  // body's water state — 0 in v0.17, because the world has no water yet.
  const airborne = c.grounded ? 0 : 1;
  let farLedge = 0;
  {
    const py = world.platforms[c.platformIndex].y;
    const gMaxD = Math.hypot(GLIDE_RANGE_DX, GLIDE_RANGE_DY);
    const jMaxD = Math.hypot(JUMP_RANGE_DX, JUMP_RANGE_DY);
    let bd = Infinity;
    for (let i = 0; i < world.platforms.length; i++) {
      if (i === c.platformIndex) continue;
      const p = world.platforms[i];
      const dy = py - p.y; // positive = ledge above
      if (dy < 30 || dy > GLIDE_RANGE_DY) continue;
      const cx = Math.max(p.x1, Math.min(p.x2, c.x));
      const dx = Math.abs(c.x - cx);
      if (dx > GLIDE_RANGE_DX) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) bd = d;
    }
    if (bd < Infinity && bd > jMaxD) farLedge = 1 - bd / gMaxD;
  }
  // v2 (breeding fix): _mate — the nearest VALID mate: adult, opposite sex,
  // in sight. The old code courted s._other (the nearest body), which was so
  // often same-sex or juvenile that tryMate never fired and lineages died out.
  // _mateDist is the normalized distance, like creatureDist. Only adults
  // look — juveniles don't shop for mates.
  // v2 (M): mate preference — heritable beauty standards. Each candidate is
  // scored on proximity AND color match to the chooser's preferred coat
  // color; choosiness scales how much color counts. Founder choosiness 0 →
  // nearest wins, exactly as before. Hue distance is circular.
  // Courtship across branches: mates are sensed in 2D (platform height
  // counts), not just along the home branch. The same-platform restriction
  // meant adults scattered across 9 platforms never found each other — zero
  // matings in long headless runs — and lineages died out. A climbing
  // species courts in the canopy's full depth.
  let mate = null, mateDist = 1;
  if (stage === 'adult' || stage === 'senior') {
    const prefH = c.pheno.matePrefHue ?? 0.5;
    const prefS = c.pheno.matePrefSat ?? 0.5;
    const choosy = c.pheno.matePrefChoosy ?? 0;
    const py = world.platforms[c.platformIndex].y;
    let best = -Infinity;
    for (const o of world.creatures) {
      if (!o.alive || o.id === c.id) continue;
      if (o.sex === c.sex) continue;
      const ost = ageStage(o.biochem, o.pheno);
      if (ost !== 'adult' && ost !== 'senior') continue;
      const oy = world.platforms[o.platformIndex].y;
      const d = Math.hypot(o.x - c.x, oy - py);
      if (d >= range) continue;
      const prox = 1 - d / range;
      let score = prox;
      if (choosy > 0) {
        const mh = o.pheno.coatHue01 ?? 0.5;
        const ms = o.pheno.coatSat01 ?? 0.5;
        const dh = Math.abs(mh - prefH);
        const dHue = Math.min(dh, 1 - dh); // hue is circular
        const dSat = Math.abs(ms - prefS);
        const colorDist = Math.min(1, Math.sqrt(dHue * dHue + dSat * dSat));
        score = prox + choosy * (1 - colorDist);
      }
      // v0.14 "Voices": prezygotic barrier — call choosiness. The chooser
      // prefers mates whose *voice* (learned pitch, i.e. the dialect)
      // resembles its own. Founder 0 = this never fires; dialects evolve,
      // then choosiness can.
      const callChoosy = c.pheno.matePrefCall ?? 0;
      if (callChoosy > 0) {
        const myPitch = c.voicePitch ?? 0.5;
        const op = o.voicePitch ?? 0.5;
        // v0.16 (delta d): lexicon distance joins the dialect mate-choice —
        // accent similarity AND word similarity. Word-drift becomes a
        // prezygotic barrier: this is what turns drift into languages.
        const accentSim = 1 - Math.min(1, Math.abs(myPitch - op));
        const wordSim = 1 - lexiconDistance(c.lexicon, o.lexicon);
        score += callChoosy * (0.6 * accentSim + 0.4 * wordSim);
      }
      // v0.17 "Bauplan": sexual selection on novelty — Fisherian runaway.
      // Choosiness on the candidate's novel-structure area (wings + sails
      // + gills + fins), read from the GENES (choosing genes, not bodies).
      // Founder 0 → nearest/color wins, exactly as before.
      const novelChoosy = c.pheno.matePrefNovel ?? 0;
      if (novelChoosy > 0) {
        const novelty = (o.pheno.wingArea || 0) + (o.pheno.sailArea || 0) +
          (o.pheno.gillArea || 0) + (o.pheno.finArea || 0);
        score += novelChoosy * Math.min(1, novelty);
      }
      if (score > best) { best = score; mate = o; mateDist = d / range; }
    }
  }
  // v2: groomNear — a groomable neighbor in reach, on the same platform.
  // The sense slot existed (index 19) but was never fed; now the brain can
  // learn that grooming needs someone nearby.
  const groomReach = c.pheno.groomReach || 70;
  const groomNear = other && other.platformIndex === c.platformIndex
    ? Math.max(0, 1 - Math.abs(other.x - c.x) / groomReach) : 0;
  // v0.14 "Voices": what the acoustic commons sounds like right now —
  // the loudest recent call on this platform within earshot.
  const heard = callsHeardBy(world, c);
  // v0.18 "Realms": buriedNear (sense 31) — the dig verb's reader. Nearest
  // buried food within 240px; 0 when the world has no pantry (guarded).
  let buriedNear = 0;
  {
    const buried = world.buried || [];
    let bd = Infinity;
    for (const bf of buried) {
      if (!Number.isFinite(bf.x) || !Number.isFinite(bf.y)) continue;
      const d = Math.hypot(bf.x - c.x, bf.y - (c.y ?? bf.y));
      if (d < bd) bd = d;
    }
    if (bd <= BURIED_NEAR_RANGE) buriedNear = 1 - bd / BURIED_NEAR_RANGE;
  }
  // v0.20 "Hands": objectNear (sense 32) — the grasp verb's reader. Nearest
  // manipulable object within arm reach (graspPairs reach, same platform):
  // pebbles, sticks, or a mineral deposit with samples left. heldWeight
  // (sense 33) — 0 empty-handed, else the carried object's weight.
  let objectNear = 0;
  {
    const grasp = nearestGraspable(c, world);
    if (grasp) objectNear = 1 - Math.min(1, grasp.dist / (c.pheno.groomReach || 40));
  }
  const heldWeight = c.held ? clamp01(c.held.weight || 0) : 0;
  // v0.20 "Falling": the vestibular sense — 0 on the branch or leaping up;
  // while dropping fast it climbs toward 1 with the fall's intensity.
  // Gliders feel less (glideLift bleeds vy); the founder's hops stay quiet.
  const vy = Number.isFinite(c.vy) ? c.vy : 0;
  const falling = (!c.grounded && vy > FALL_FEEL_V)
    ? clamp01((vy - FALL_FEEL_V) / (MAX_FALL - FALL_FEEL_V)) : 0;
  const senses = {
    _range: range, // px base for dist normalization (used by contagion/mating checks)
    hunger: b.hunger,
    tiredness: 1 - b.energy,
    boredom: b.fun,
    loneliness: b.social,
    fear: b.fear,
    illness: b.illness, // v0.8: the 15th sense — feeling sick is learnable
    light: world.light,
    homeDist: scaledHomeDist(c, world), // v0.18: biome-center-scaled (was |x−homeX|/800)
    kinNear: otherObj ? pedigreeKin(world, c, otherObj) : 0,
    bondNear: otherObj && world.bonds ? getBond(world.bonds, c, otherObj) : 0,
    climbUp, climbDown, jumpNear, groomNear,
    callHeard: heard.heard, callPitch: heard.pitch,
    airborne, farLedge, // v0.17: the body-plan senses
    submerged: c.submerged ? 1 : 0, waterNear: c._waterNear ? 1 : 0, // v0.18: live from stepPhysics
    // v0.18 "Realms": thirst = 1 − hydration (design doc §6); cold/heat are
    // the coreTemp readouts (senses, not drives — BIOMES_DESIGN §6).
    thirst: 1 - (Number.isFinite(b.hydration) ? b.hydration : 1),
    cold: coldSense(b, c.pheno),
    heat: heatSense(b, c.pheno),
    buriedNear,
    objectNear, heldWeight, // v0.20: the hands senses
    falling, // v0.20 "Falling": the vestibular sense (index 34)
    _heardCall: heard.call || null, // v0.16: the full acoustic event for the lexicon
    wasteOdor: wasteOdorOf(world, c.x), // v0.14: disgust — the smell of fouled ground
    _alarmHeard: heard.alarm, // v0.14: alarm calls reassure — fear drains slightly
    foodDist: food ? food.dist : 1,
    foodDir: food ? food.dir : 0,
    creatureDist: other ? other.dist : 1,
    creatureDir: other ? other.dir : 0,
    toyDist: toy ? toy.dist : 1,
    toyDir: toy ? toy.dir : 0,
    isAdult: stage === 'adult' || stage === 'senior' ? 1 : 0,
    _food: food && food.obj,
    _other: other && other.obj,
    _toy: toy && toy.obj,
    _mate: mate,
    _mateDist: mateDist,
  };
  // v2 (C): receptors — chemical levels modulate senses. Each receptor gene
  // adds gain × max(0, chem − thr) to its target sense. Founder gains are 0:
  // silent by default, evolvable. This is how a lineage can learn that
  // oxytocin means company, or that adrenaline sharpens fear.
  const pheno = c.pheno;
  for (let i = 0; i < 6; i++) {
    const gain = pheno[`rc${i}gain`] ?? 0;
    if (gain === 0) continue;
    const chem = pheno[`rc${i}chem`];
    const chemV = b[chem];
    if (chemV === undefined) continue;
    const senseKey = pheno[`rc${i}sense`];
    if (!(senseKey in senses)) continue;
    senses[senseKey] += gain * Math.max(0, chemV - (pheno[`rc${i}thr`] ?? 0.5));
  }
  return senses;
}

function moveAlong(c, world, dir, dt, mult = 1, edge = 'turn') {
  const stage = ageStage(c.biochem, c.pheno);
  const sickSlow = c.biochem.illness > 0.5 ? 0.7 : 1; // illness saps strength
  // v0.9: wounds slow the body — the body's history constrains the soul.
  const injurySlow = 1 - 0.35 * c.biochem.injury;
  // v0.6 morphology: long legs = fast but fur is heavy.
  const morphSpeed = c.pheno.legSpeedMult * (1 - c.pheno.furWeight);
  // v0.17 "Bauplan": serpentine plans — no grasp limbs, the body is the
  // limb. The realized body plan decides; the founder (2 grasp pairs)
  // walks exactly as before.
  const graspPairs = c.bodyPlan ? c.bodyPlan.graspPairs : (c.pheno.graspPairs ?? 2);
  const baseSpeed = graspPairs === 0 ? (c.pheno.slitherSpeed || c.pheno.walkSpeed) : c.pheno.walkSpeed;
  const speed = baseSpeed * stageSize(stage) * (stage === 'senior' ? 0.7 : 1) * sickSlow * injurySlow * mult * morphSpeed;
  const plat = world.platforms[c.platformIndex];
  const r = creatureRadius(c);
  c.x += dir * speed * dt;
  if (Math.abs(dir) > 0) c._active = Math.max(c._active || 0, Math.min(1, mult)); // exertion for the chemistry
  // edge: 'turn' (wanderers turn around at the brink — branches stay livable)
  //   or 'fall' (directed feet can walk off the edge — gravity takes it).
  if (c.x < plat.x1 + r || c.x > plat.x2 - r) {
    if (edge === 'turn' || !c.grounded) {
      if (c.x < plat.x1 + r) { c.x = plat.x1 + r; c.wanderDir *= -1; }
      else { c.x = plat.x2 - r; c.wanderDir *= -1; }
    } else {
      // Directed movement walks off the edge — the fall begins.
      c.grounded = false;
      c.vx = dir * speed;
      c.vy = Math.min(c.vy, 0);
    }
  }
  if (dir !== 0) c.facing = dir;
  c.hopPhase += dt * 10;
}

// Integrate gravity, land on platforms, take fall damage. The world's own
// natural law — cause and effect, never dice.
// v0.18 "Realms": water gains its own branch — buoyancy replaces gravity.
// Every term NaN-guarded (the v0.15 lesson); with no water the old path
// runs bit-identically.
export function stepPhysics(c, world, dt) {
  const plat = world.platforms[c.platformIndex];
  if (c.y === undefined || c.y === null) {
    // First tick: snap to the platform. (createCreature can't see the world.)
    // Position only — a jump or walk-off that fired earlier this same tick
    // already set grounded=false and a velocity; don't stomp the launch.
    c.y = plat.y;
    if (c.grounded) { c.vx = 0; c.vy = 0; }
  }
  // v0.18: water state, every tick (also refreshed in executeAction so the
  // water verbs see this tick's state, not last tick's).
  const w = refreshWaterState(c, world);
  const cy = Number.isFinite(c.y) ? c.y : 0;
  if (w && Number.isFinite(w.surfaceY)) {
    // In water: buoyancy replaces gravity. A spring toward the float
    // equilibrium (11px below the surface) with damping, plus drag —
    // floating bodies read submerged=false and breathe. No gravity here;
    // the swim verb steers, the dive verb holds depth.
    c.grounded = false;
    // The dive verb's depth hold: pin to the held depth instead of
    // floating up (gills or held breath pay for it in oxygen).
    const holdY = c._holdDepth;
    const targetY = (holdY !== undefined && Number.isFinite(holdY))
      ? holdY : w.surfaceY + FLOAT_MARGIN;
    const spring = (targetY - cy) * BUOY_K;
    if (Number.isFinite(spring)) c.vy = (Number.isFinite(c.vy) ? c.vy : 0) + spring * dt;
    const dampK = Math.max(0, 1 - BUOY_DAMP * dt);
    c.vy *= dampK;
    const vDampK = Math.max(0, 1 - WATER_VEL_DAMP * dt);
    c.vx = (Number.isFinite(c.vx) ? c.vx : 0) * vDampK;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    // The world has walls: nobody leaves sideways. And nobody sinks
    // through the floor of the world.
    if (c.x < 0) { c.x = 0; c.vx = Math.abs(c.vx) * 0.3; }
    if (c.x > world.width) { c.x = world.width; c.vx = -Math.abs(c.vx) * 0.3; }
    if (c.y > world.height) { c.y = world.height; c.vy = 0; }
    return;
  }
  if (c.grounded) {
    // v0.20: never teleport — stand on the platform only if we're actually
    // at it. (A body the floor clamp caught with a stale platformIndex
    // rests on the floor instead of popping back up to mid-air.)
    if (Math.abs(c.y - plat.y) < 40 && c.x >= plat.x1 && c.x <= plat.x2) {
      c.y = plat.y; // stand on the branch
    }
    c.vy = 0;
    // v0.20 "Falling": while grounded, remember where the next fall starts.
    c._fallStartY = c.y;
    c._fallPeak = 0;
    return;
  }
  // v0.20: anti-slip — a body just below its own platform, well inside the
  // span (it swam out of a pool below the bank, or tunneled a pixel past),
  // climbs back out onto it. Near the edges we stay hands-off: walking off
  // a cliff must keep working, so the pop-up keeps clear of the brink.
  if (plat && !c.grounded) {
    const r = creatureRadius(c);
    const dy = c.y - plat.y;
    if (dy > 0 && dy < 40 && c.x > plat.x1 + r && c.x < plat.x2 - r) {
      c.y = plat.y;
      c.vy = 0;
      c.vx = 0;
      c.grounded = true;
      return;
    }
  }
  // Airborne: gravity integrates — reduced while gliding (descent, never
  // ascent: glideLift ≤ 0.85 by construction). The wings also steer
  // slightly toward the facing direction. c.gliding is only ever true
  // with real wings, so the founder's falls are untouched.
  integrateGravity(c, world, dt);
  // v0.20 "Falling": the fall is felt WHILE it happens, not just at the
  // landing. Dropping fast, fear and adrenaline climb with the fall's
  // intensity — the vestibular signal the brain's new sense reads. Fear
  // past 0.6 grounds the call type as 'alarm' (groundCallType), so the
  // scream the fall-instinct fires carries honest meaning; the landing
  // startle in land() scales with the peak fear the fall produced.
  if (!c.grounded && c.vy > FALL_FEEL_V && c.biochem) {
    const fi = clamp01((c.vy - FALL_FEEL_V) / (MAX_FALL - FALL_FEEL_V));
    if (fi > (c._fallPeak || 0)) c._fallPeak = fi;
    const b = c.biochem;
    b.fear = clamp01(b.fear + 0.8 * fi * dt);
    b.adrenaline = clamp01(b.adrenaline + 0.5 * fi * dt);
  }
}

// v0.20 "One physics": the airborne gravity branch, extracted from
// stepPhysics so every body in the world falls under the same law —
// tanglekins, beached sharks, bears, all of it. Gravity integrates,
// platforms catch, hard landings cost. Joshua's law: physics works the
// same for everything in this world.
export function integrateGravity(c, world, dt) {
  const prevY = c.y;
  const glideLift = c.gliding ? (c.pheno.glideLift || 0) : 0;
  const vy0 = Number.isFinite(c.vy) ? c.vy : 0;
  c.vy = Math.min(MAX_FALL, vy0 + GRAVITY * (1 - glideLift) * dt);
  if (c.gliding) c.vx += c.facing * 30 * dt;
  // v0.23 "Weather": the wind carries every airborne body — Galilean carry,
  // not a force. A stone and a glider are borne east equally; the glider
  // goes farther only because lift keeps it aloft longer. Grounded bodies
  // are not carried. (An acceleration model has no terminal velocity — a
  // steady breeze would push a soaring vulture past wind speed forever,
  // which no brain can fight. The air moves; the creature keeps its own
  // air-relative velocity.)
  if (!c.grounded && world.climate) {
    c.x += windAt(world, c.x) * dt;
  }
  c.x += (Number.isFinite(c.vx) ? c.vx : 0) * dt;
  // The world has walls: nobody leaves sideways.
  if (c.x < 0) { c.x = 0; c.vx = Math.abs(c.vx) * 0.3; }
  if (c.x > world.width) { c.x = world.width; c.vx = -Math.abs(c.vx) * 0.3; }
  c.y += c.vy * dt;
  // Landing: falling through a platform's span means standing on it.
  // (Only while falling — leaping up through a branch is allowed.)
  if (c.vy > 0) {
    for (let i = 0; i < world.platforms.length; i++) {
      const p = world.platforms[i];
      if (c.x >= p.x1 && c.x <= p.x2 && prevY <= p.y && c.y >= p.y) {
        const impact = c.vy;
        c.y = p.y;
        c.vy = 0;
        c.vx = 0;
        c.grounded = true;
        c.platformIndex = i;
        land(c, world, impact);
        break;
      }
    }
  }
  // v0.18: the world has a floor — nobody falls through it. (The water
  // branch already clamps; the gravity branch needs it too, now that
  // creatures can exit water over pool regions with no platform below.)
  // v0.20: the clamp grounds the body but leaves platformIndex alone —
  // the grounded snap below refuses to teleport, so the body rests on
  // the floor instead of popping back up to a platform it isn't over
  // (the bug Joshua watched: fall through, then hover mid-air).
  if (c.y > world.height) {
    c.y = world.height;
    c.vy = 0;
    c.vx = 0;
    c.grounded = true;
  }
}

// v2 (E): emitters — firing an action releases a pulse of a chemical.
// Each emitter gene names a trigger action and a chemical; committing to
// the action adds the amount (founder: small nudges, not floods).
function fireEmitters(c) {
  const pheno = c.pheno;
  const b = c.biochem;
  for (let i = 0; i < 6; i++) {
    if (pheno[`em${i}trig`] !== c.action) continue;
    const amt = pheno[`em${i}amt`] ?? 0;
    if (amt === 0) continue;
    const chem = pheno[`em${i}chem`];
    if (b[chem] === undefined) continue;
    b[chem] = clamp01(b[chem] + amt);
  }
}

// v2 (S): stimulus valence — world events carry evolvable valence. Each
// stimulus gene names an event and a signed valence × intensity; the sum
// over the four genes nudges chemistry (good → endorphin, bad → adrenaline)
// and adds a learnable reward. Founder valences are 0: silent by default.
function applyStimulus(c, eventName) {
  const pheno = c.pheno;
  let v = 0;
  for (let i = 0; i < 4; i++) {
    if (pheno[`st${i}event`] !== eventName) continue;
    v += (pheno[`st${i}val`] ?? 0) * (pheno[`st${i}int`] ?? 0.5);
  }
  if (v === 0) return;
  const b = c.biochem;
  if (v > 0) b.endorphin = clamp01(b.endorphin + v * 0.5);
  else b.adrenaline = clamp01(b.adrenaline - v * 0.5);
  c.reward += v * 0.3;
}

// Touchdown: hard landings cost injury, startle, and a flinch the painter
// shows. Soft landings are just Tuesday.
// v0.17 "Bauplan": fallSoak — membranes and sails drag the fall, softening
// the impact (exaptation's bridge: display → drag → flight). And a glide
// that ends in a touchdown feels like a small triumph. Founder fallSoak 0.
function land(c, world, impact) {
  const wasGliding = c.gliding;
  c.gliding = false;
  // v0.20 "Falling": how far the body fell, and how frightening the fall
  // was at its peak. _fallStartY is the last grounded height (stepPhysics
  // keeps it current); predators falling through integrateGravity never
  // set it, so their landings stay quiet.
  const fallPeak = c._fallPeak || 0;
  const fallDist = (c._fallStartY !== undefined) ? c.y - c._fallStartY : 0;
  c._fallPeak = 0;
  // v0.20 "Falling": a canopy-to-floor fall strands — even a soft one. The
  // stranding is about where the fall delivered the creature, not how hard
  // it landed. The chronicle notes the delivery; the world's existing costs
  // do the rest: climbing back up bills energy, homesickness drains comfort
  // far from home, bonds decay with separation, and arctic floors have bears.
  if (fallDist > STRAND_PX) {
    world.events.push({
      type: 'strandedFall', creature: c,
      fallPx: Math.round(fallDist), zone: zoneAt(c.x).key, t: world.time,
    });
  }
  impact = impact * (1 - (c.pheno.fallSoak || 0));
  if (impact <= FALL_HURT_V) {
    if (wasGliding) c.reward += 0.05; // the touchdown after a real glide
    return;
  }
  const b = c.biochem;
  const excess = impact - FALL_HURT_V;
  b.injury = clamp01(b.injury + excess * FALL_DMG);
  // The landing startles — more when the fall itself was frightening.
  // A hop that lands hard is a surprise; a long screaming fall that lands
  // hard is the thing the fear was about.
  b.adrenaline = clamp01(b.adrenaline + 0.35 * (0.5 + fallPeak));
  c.flinchT = 0.45;
  c.reward -= 0.25;
  applyStimulus(c, 'hardLanding'); // v2 (S): the fall's evolvable valence
  world.events.push({ type: 'hardLanding', creature: c, impact: Math.round(impact), t: world.time });
}

function moveToward(c, world, targetX, dt, mult = 1) {
  const dx = targetX - c.x;
  if (Math.abs(dx) < 4) return true; // arrived
  moveAlong(c, world, Math.sign(dx), dt, mult, 'fall'); // directed feet can walk off
  return false;
}

// Courtship navigation: step toward a target platform via climb links.
// Picks the link whose destination is nearest the target's height, walks to
// the overlap, and climbs through. Returns true when on (or just arrived
// on) the target platform. Lets courtship cross branches — without it, mates
// sensed on other platforms could never be reached.
function stepTowardPlatform(c, world, targetPi, dt) {
  if (c.platformIndex === targetPi) return true;
  const links = climbLinksFrom(world, c.platformIndex);
  if (links.length === 0) return false;
  const targetY = world.platforms[targetPi].y;
  let best = links[0], bd = Infinity;
  for (const l of links) {
    const dy = Math.abs(world.platforms[l.to].y - targetY);
    if (dy < bd) { bd = dy; best = l; }
  }
  const cx = Math.max(best.link.x1, Math.min(best.link.x2, c.x));
  if (Math.abs(cx - c.x) > 12) {
    const step = Math.sign(cx - c.x) * (c.pheno.climbSpeed || 0.5) * 60 * dt;
    c.x += Math.abs(step) > Math.abs(cx - c.x) ? cx - c.x : step;
    return false;
  }
  // Through the gap — arrive on the new branch.
  c.platformIndex = best.to;
  c.y = world.platforms[best.to].y;
  c.vy = 0; c.vx = 0; c.grounded = true;
  return c.platformIndex === targetPi;
}

export function doEat(c, world) {
  const s = c._senses;
  let food = s._food && Math.abs(s._food.x - c.x) < EAT_RANGE ? s._food : null;
  // v0.22 "Web of Life": detritivory — no food item in reach, but the
  // ground is rich with waste. Dung-eaters graze the soil itself through
  // the same `eat` verb and the same hunger instinct: poor food, eaten
  // joylessly. The eaten mass leaves the soil — conserved, not deleted.
  // Opportunistic (any hungry creature does it); the midden beetle's
  // NICHE is founder-exact (low instWasteFlee, high immunity, small bites).
  let detritusSoil = null;
  if (!food && !world.noFouling && world.soil) {
    const soil = world.soil[biomeKeyAt(c.x)];
    if (soil && soil.waste >= DETRITUS_WASTE_MIN) {
      detritusSoil = soil;
      food = {
        foodKind: 'detritus', amount: Math.min(soil.waste, c.pheno.biteSize * 2),
        nutrition: DETRITUS_NUTRITION, bitterness: 0, plantId: 0, x: c.x,
      };
    }
  }
  if (!food) return false;
  // v0.18 "Realms": explicit diet branches. Meat kinds (meat, bug, minnow,
  // corpse, grub, morsel) burn through meatEfficiency — small prey and
  // corpses have fixed nutrition overrides. Plant kinds (fruit, tuber,
  // kelp, moss, …) burn through fruitEfficiency. Leaves are medicine,
  // scraps desperation — both keep their existing logic. A truly unknown
  // kind is skipped (return false), never crashed on.
  const kind = food.foodKind;
  const isMeat = MEAT_KINDS.has(kind);
  const isPlant = PLANT_KINDS.has(kind);
  if (kind !== 'leaf' && kind !== 'scrap' && kind !== 'detritus' && !isMeat && !isPlant) return false;
  // v0.6 morphology: bite size from mouthSize gene; diet efficiencies.
  // v0.7: meat efficiency — carcasses feed carnivores at full value.
  const bite = Math.min(food.amount, c.pheno.biteSize);
  food.amount -= bite;
  if (detritusSoil) detritusSoil.waste = Math.max(0, detritusSoil.waste - bite);
  // v0.14: the waste cycle — part of every bite passes through the gut.
  // Nutrition feeds blood sugar; the rest is excreted into the soil.
  c.gut = (c.gut || 0) + bite * WASTE_FRACTION;
  // v0.14.1: messy eaters — a fraction of every bite falls as scraps.
  // Poor food for the desperate, compost for the soil if ignored.
  // v0.24: the bite is double-entry. Scraps that form are a food-pool
  // transfer; scraps that don't (too small, or the 90-cap binds) and the
  // rest of the bite are burned as energy — LABELED metabolism output.
  // Tissue: a share of the bite becomes body mass (capped at the adult
  // mass) — a hatchling honestly grows from its meals. Adults (tissueRoom
  // 0) are untouched, so founder economics are exactly preserved.
  const adultMass = 4.8 * ((c.pheno && c.pheno.size !== undefined) ? c.pheno.size : 0.3) * 1.0;
  if (typeof c.bodyMass !== 'number' || c.bodyMass <= 0) c.bodyMass = adultMass;
  const tissue = Math.min(bite * TISSUE_FRACTION, Math.max(0, adultMass - c.bodyMass));
  c.bodyMass += tissue;
  const scrapAmt = bite * SCRAP_FRACTION;
  let metab = bite * (1 - WASTE_FRACTION - SCRAP_FRACTION) - tissue;
  if (scrapAmt > 0.005 && world.foods.length < 90) {
    addFood(world, c.x + world.rng.range(-8, 8), c.platformIndex, 'scrap', scrapAmt, SCRAP_ROT, { nutrition: SCRAP_NUTRITION });
  } else {
    metab += scrapAmt;
  }
  ledgerOut(world, 'metabolism', metab);
  // v0.8: medicinal leaves. Bitter and barely nutritious, but they purge
  // illness — self-medication. The illness reward term (below) makes recovery
  // reinforcing, so the brain learns: sick → seek leaf → feel better.
  if (kind === 'leaf') {
    const wasSick = c.biochem.illness > 0.25;
    c.biochem.illness = Math.max(0, c.biochem.illness - 0.4);
    // Bitter medicine: barely nutritious (small ate), powerfully purging.
    c._ate = (c._ate || 0) + bite * 0.3 * c.pheno.fruitEfficiency;
    c.actionLabel = 'chewing bitter leaf';
    // Bitter when well, medicine when sick — the differential that teaches
    // self-medication. A healthy creature finds leaves meh; a sick one that
    // chews a leaf feels better, and the brain (which senses illness) learns
    // the conditional.
    c.reward += wasSick ? 0.6 : 0.15;
  } else if (isMeat) {
    // Meat: small prey (bug/minnow/grub/morsel) are fixed small mouthfuls;
    // corpse is rotten but substantial; meat uses the food's own nutrition.
    let nut = food.nutrition || 1;
    if (kind === 'bug' || kind === 'minnow' || kind === 'grub' || kind === 'morsel') nut = PREY_NUTRITION;
    else if (kind === 'corpse') nut = CORPSE_NUTRITION;
    c._ate = (c._ate || 0) + bite * 1.1 * c.pheno.meatEfficiency * nut;
    c.actionLabel = `eating ${kind}`;
    c.reward += 0.6;
  } else {
    // Food becomes blood sugar via the chemistry tick (c._ate is consumed
    // by tickBiochem before the next action) — the body, not the action,
    // decides what a meal means.
    // v0.13: bitterness from the plant genome — bitter fruit is less
    // rewarding, so the brain learns to avoid bitter plants. The differential
    // (not a hardcoded rule) is what teaches foraging discrimination.
    const eff = c.pheno.fruitEfficiency;
    const bitter = food.bitterness || 0;
    const palatability = 1 - 0.5 * bitter;
    const nutrition = (food.nutrition || 1) * palatability;
    c._ate = (c._ate || 0) + bite * 1.1 * eff * nutrition;
    // v0.14.1: scraps are desperation food — eaten, but joylessly.
    // v0.22: detritus is poorer still — the midden's wage.
    const isScrap = kind === 'scrap';
    const isDetritus = kind === 'detritus';
    c.actionLabel = isDetritus ? 'grazing detritus' : (isScrap ? 'picking at scraps' : `eating ${kind === 'fruit' ? 'fruit' : kind}`);
    c.reward += (isDetritus ? 0.2 : isScrap ? 0.25 : 0.6) * palatability; // bitter meals reinforce less
    // v0.13: seed dispersal — the eaten fruit's plant may ride along.
    disperseSeed(world, c, food);
  }
  // v0.14: disgust's honest cost — food eaten on fouled ground carries
  // contamination into the body. wasteOdor is the information; this is the
  // consequence that makes the instinct evolve under real selection.
  // (Medicinal leaves still purge more than they contaminate — the
  // self-medication differential survives.)
  const odor = wasteOdorOf(world, c.x);
  if (odor > 0) {
    c.biochem.illness = clamp01(c.biochem.illness + bite * odor * CONTAM_ILLNESS);
  }
  if (food.amount <= 0.01) {
    const i = world.foods.indexOf(food);
    if (i >= 0) world.foods.splice(i, 1);
  }
  // v0.7 invention: log the meal; clustered success founds a grove tradition.
  c.mealLog.push({ x: c.x, t: world.time });
  while (c.mealLog.length > 8) c.mealLog.shift();
  // v0.8 exam telemetry: opt-in meal hook. The exam harness sets world.onMeal
  // to record who ate what where; unset in normal play (zero cost, no spam).
  if (world.onMeal) world.onMeal(c, bite * eff);
  maybeFoundGrove(c, world);
  return true;
}

// Invention: GROVE_MEALS recent meals clustered in space and time, and no
// existing grove nearby — this creature just discovered a good spot, and
// discovers it *as* a named tradition. Curious explorers invent more.
export function maybeFoundGrove(c, world) {
  const now = world.time;
  const recent = c.mealLog.filter((m) => now - m.t < GROVE_WINDOW);
  if (recent.length < GROVE_MEALS) return null;
  let cx = 0;
  for (const m of recent) cx += m.x;
  cx /= recent.length;
  for (const m of recent) {
    if (Math.abs(m.x - cx) > GROVE_RADIUS) return null;
  }
  const cu = world.culture;
  for (const t of cu.traditions) {
    if (t.kind === 'grove' && Math.abs(t.x - cx) < GROVE_NEARBY) return null;
  }
  if (!world.rng.chance(0.04 + 0.16 * c.pheno.curiosity)) return null;
  const t = foundGrove(cu, c, cx, GROVE_RADIUS, now, c.generation, world.rng);
  if (t) world.events.push({ type: 'traditionFounded', name: t.name, creature: c, t: now });
  return t;
}

// v0.20 "Hands": nearest other creature within arm reach — the strike's
// target. Mirrors the spatial query in gatherSenses.
function nearestCreatureInReach(c, world) {
  const reach = c.pheno.groomReach || 40;
  const spatial = world._spatial && world._spatial.get(c.platformIndex);
  if (spatial) {
    const hit = nearestSpatial(spatial, c.x, reach, c.id);
    return hit ? hit.obj : null;
  }
  const hit = nearest(world.creatures, c.x, c.platformIndex, reach, c.id);
  return hit ? hit.obj : null;
}

// v0.20 "Hands": craft-tradition invention — the grove machinery's twin.
// Successful tool uses clustered in space+time, same material + pattern,
// gate on curiosity. Tool culture founds exactly the way food culture
// does; both share the honest MAX_TRADITIONS pool (no sub-cap).
export function maybeFoundCraft(c, world) {
  const now = world.time;
  const recent = (c.craftLog || []).filter((e) =>
    now - e.t < CRAFT_WINDOW && e.material === (c.held && c.held.material) && e.pattern === 'strike');
  if (recent.length < CRAFT_USES) return null;
  let cx = 0;
  for (const e of recent) cx += e.x;
  cx /= recent.length;
  for (const e of recent) {
    if (Math.abs(e.x - cx) > CRAFT_RADIUS) return null;
  }
  if (!world.rng.chance(0.04 + 0.16 * (c.pheno.curiosity ?? 0.5))) return null;
  const t = mineralType(c.held.material);
  const tr = foundCraft(world.culture, c, c.held.material, t ? t.name : c.held.material, 'strike', now, c.generation, world.rng);
  if (tr) {
    world.events.push({ type: 'traditionFounded', name: tr.name, creature: c, t: now });
    c.craftLog = [];
  }
  return tr;
}

// v0.20 "Hands": log a successful tool use; check invention; let witnesses
// adopt the carrier's craft traditions. A young creature that watches a
// carrier strike with a stone adopts the craft tradition — the horizontal
// channel, no teacher required (decision 2026-09-30: accident → tradition
// primary, teacher last resort).
function logCraftUse(c, world) {
  if (!c.held) return;
  c.craftLog.push({ x: c.x, t: world.time, material: c.held.material, pattern: 'strike' });
  maybeFoundCraft(c, world);
  for (const w of world.creatures) {
    if (!w.alive || w === c) continue;
    if (w.platformIndex !== c.platformIndex) continue;
    if (Math.abs(w.x - c.x) > OBSERVE_RANGE) continue;
    for (const tid of c.traditions || []) {
      const tr = getTradition(world.culture, tid);
      if (tr && tr.kind === 'craft' && adoptTradition(world.culture, w, tr, 0.35, world.rng)) {
        world.events.push({ type: 'traditionAdopted', creature: w, tradition: tr, t: world.time });
      }
    }
  }
}

// v0.14 "Voices": ground the call type in the caller's real state — never
// a free choice. The brain decides only *whether* to call; the body decides
// *what* the call means. Exported for tests.
export function groundCallType(c, s) {
  const b = c.biochem;
  const stage = ageStage(b, c.pheno);
  if (b.fear > 0.6) return 'alarm';
  if (s.foodDist < 0.3 && s._food) return 'food';
  if (b.social > 0.6 && (stage === 'adult' || stage === 'senior')) return 'mate';
  return 'contact';
}

// v0.16: the creature's own salient state as an observable context —
// what the hearer-half of delta (a) reinforces toward. Mirrors
// groundCallType with a strength weight.
export function ownSalientContext(c, s) {
  const b = c.biochem;
  const stage = ageStage(b, c.pheno);
  if (b.fear > 0.6) return { ctx: 'alarm', w: b.fear };
  if (s.foodDist < 0.3 && s._food) return { ctx: 'food', w: 1 - s.foodDist };
  if (b.social > 0.6 && (stage === 'adult' || stage === 'senior')) return { ctx: 'mate', w: b.social };
  return { ctx: 'contact', w: 0.25 };
}

function executeAction(c, world, dt, s) {
  const rng = world.rng;
  // v0.18: the water verbs (swim/dive/drink) read c._water — refresh it
  // here so they see this tick's state (executeAction runs before
  // stepPhysics in the tick).
  refreshWaterState(c, world);
  c.playing = false;
  c.grooming = false; // set by the groom action — consumed by tickBiochem
  c.gliding = false; // set by the glide action — true flight needs real wings
  c.brachiating = false; // set by the brachiate action — needs a 3rd grasp pair
  c.diving = false; // set by the dive action — needs real gills to stay down
  c._active = 0; // exertion this tick — consumed by tickBiochem
  c._basking = 0; // set by the bask action — consumed by tickBiochem
  c._flail = false; // set by the swim action — flailing bills extra oxygen
  if (c.action !== 'dig') c._digT = 0; // digging progress resets off-action
  if (c.action !== 'dive') c._holdDepth = undefined; // depth hold releases off-action
  switch (c.action) {
    case 'seekFood':
      c.actionLabel = 'looking for food';
      if (s._food) {
        if (moveToward(c, world, s._food.x, dt)) {
          c.actionTimer = 0; // arrived — choose what to do next
          doEat(c, world);
        }
      } else {
        // v0.7: a hungry carrier with no food in sight heads for the grove —
        // tradition as navigation. Counts as acting on the tradition.
        const gx = groveTarget(c, world.culture, s);
        if (gx !== null && gx !== undefined) {
          c.actionLabel = 'heading for the grove';
          if (moveToward(c, world, gx, dt, 0.9)) c.actionTimer = 0;
          for (const t of (c.traditions || []).map((id) => getTradition(world.culture, id)).filter(Boolean)) {
            if (t.kind === 'grove' && Math.abs(groveAim(c, t) - c.x) < 60) t.uses++;
          }
        } else {
          c.action = 'wander';
          c.actionTimer = 0;
        }
      }
      break;
    case 'eat':
      c.actionLabel = 'eating';
      // v0.11: if food is in sight but out of bite range, go get it — the
      // old code flipped to seekFood without moving, and the brain's eat
      // instinct re-fired every tick: a livelock that starved a founder
      // (seed 11) next to visible food.
      if (s._food && Math.abs(s._food.x - c.x) >= EAT_RANGE) {
        moveToward(c, world, s._food.x, dt);
      } else if (!doEat(c, world)) {
        c.action = 'seekFood';
        c.actionTimer = 0;
      }
      break;
    case 'sleep':
      c.actionLabel = 'sleeping';
      c.sleeping = true;
      break;
    case 'play':
      c.actionLabel = 'playing';
      if (s._toy) {
        const arrived = moveToward(c, world, s._toy.x, dt, 1.2);
        if (arrived || Math.abs(s._toy.x - c.x) < 60) {
          c.playing = true;
          c.reward += 0.25 * dt; // fun is rewarding
          if (s._toy.kind === 'ball') s._toy.vx += c.facing * 30 * dt;
        }
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    case 'approach':
      c.actionLabel = 'saying hello';
      if (s._other) {
        moveToward(c, world, s._other.x, dt, 0.9);
        if (Math.abs(s._other.x - c.x) < 70) {
          c.nearFriend = true;
          c.reward += 0.15 * dt;
        }
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    case 'flee':
      c.actionLabel = 'frightened!';
      if (s._other) {
        moveAlong(c, world, -s.creatureDir, dt, 1.4);
        c.reward -= 0.1 * dt;
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    case 'mate': {
      c.actionLabel = 'courting';
      const stage = ageStage(c.biochem, c.pheno);
      // v2 (breeding fix): court the nearest VALID mate (s._mate), not the
      // nearest body. The old code courted s._other — so often same-sex or
      // juvenile that tryMate never fired and lineages died out. No valid
      // mate in sight → drift socially, never lock onto the wrong target.
      const other = s._mate;
      const otherStage = other ? ageStage(other.biochem, other.pheno) : null;
      const ok = other && (stage === 'adult') && (otherStage === 'adult') &&
        other.sex !== c.sex && c.mateCooldown <= 0 && other.mateCooldown <= 0;
      if (ok) {
        if (other.platformIndex === c.platformIndex) {
          if (moveToward(c, world, other.x, dt, 0.9) && Math.abs(other.x - c.x) < 50) {
            world.tryMate(c, other);
          }
        } else {
          // Courtship across branches: climb to the mate's platform, then
          // close the distance. A tanglekin that can't reach a mate can't breed.
          c.actionLabel = 'climbing to a mate';
          if (stepTowardPlatform(c, world, other.platformIndex, dt)) {
            if (moveToward(c, world, other.x, dt, 0.9) && Math.abs(other.x - c.x) < 50) {
              world.tryMate(c, other);
            }
          }
          c._active = 1; // courtship is work — the chemistry bills it
        }
      } else if (other) {
        moveToward(c, world, other.x, dt, 0.8);
      } else if (s._other) {
        moveToward(c, world, s._other.x, dt, 0.8);
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    }
    case 'seekHome':
      // v0.12: walk back toward the imprinted home range.
      c.actionLabel = 'heading home';
      if (c.homeX !== undefined) {
        if (moveToward(c, world, c.homeX, dt, 0.9)) c.actionTimer = 0;
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    case 'climb': {
      // The canopy action: move between linked branches. The creature walks
      // to the nearest climbable overlap, then scrambles up/down to the
      // branch it wants — food-rich, home, or just new. Climbing is work:
      // it costs energy, and the grip gene (instClimb*) makes some
      // tanglekins bolder climbers than others.
      c.actionLabel = 'climbing';
      const links = climbLinksFrom(world, c.platformIndex)
        .filter(({ link }) => c.x >= link.x1 - 60 && c.x <= link.x2 + 60);
      if (links.length === 0) {
        // No climbable gap in reach — walk toward the nearest overlap, or
        // give up and wander.
        const all = climbLinksFrom(world, c.platformIndex);
        if (all.length === 0) {
          c.action = 'wander';
          c.actionTimer = 0;
        } else {
          let best = all[0];
          let bd = Infinity;
          for (const l of all) {
            const cx = Math.max(l.link.x1, Math.min(l.link.x2, c.x));
            const d = Math.abs(cx - c.x);
            if (d < bd) { bd = d; best = l; }
          }
          const cx = Math.max(best.link.x1, Math.min(best.link.x2, c.x));
          moveToward(c, world, cx, dt, 0.8);
        }
        break;
      }
      // Choose the branch: food wins, then home, then curiosity.
      let best = links[0];
      let bScore = -Infinity;
      for (const l of links) {
        const to = l.to;
        let score = 0;
        for (const f of world.foods) {
          if (f.platformIndex === to) score += 1;
        }
        if (to === c.homePlatform) score += 2;
        score += rng.next() * 0.5; // a little wanderlust
        if (score > bScore) { bScore = score; best = l; }
      }
      const cx = Math.max(best.link.x1, Math.min(best.link.x2, c.x));
      if (Math.abs(cx - c.x) > 12) {
        // Scramble sideways to the gap, at climb speed (the grip gene).
        const step = Math.sign(cx - c.x) * c.pheno.climbSpeed * 60 * dt;
        c.x += Math.abs(step) > Math.abs(cx - c.x) ? cx - c.x : step;
        if (c.x < best.link.x1) c.x = best.link.x1;
        if (c.x > best.link.x2) c.x = best.link.x2;
      } else {
        // Through the gap — arrive on the new branch.
        c.platformIndex = best.to;
        c.y = world.platforms[best.to].y; // arrive standing, not floating
        c.vy = 0; c.vx = 0; c.grounded = true;
        c.actionTimer = 0; // re-decide from the new branch
        c.reward += 0.05; // climbing somewhere new feels good
        c._active = 1;
        if (world.stats) world.stats.climbs++; // v0.18 §13.7: the leg experiment counts climbs
        world.events.push({ type: 'climbed', creature: c, to: best.to, t: world.time });
      }
      break;
    }
    case 'groom': {
      // The troop ritual: one tanglekin grooms another, and both bond.
      // Oxytocin rises in groomer and groomed — company you can feel.
      c.actionLabel = 'grooming';
      const other = s._other;
      const reach = c.pheno.groomReach || 70;
      if (other && Math.abs(other.x - c.x) < reach && other.platformIndex === c.platformIndex) {
        c.grooming = true; // consumed by tickBiochem (oxytocin)
        other._groomed = true; // the groomed feels it next tick
        c.actionLabel = `grooming ${other.name}`;
        c.reward += 0.2 * dt;
        if (world.bonds) nudgeBond(world, c, other, 0.06 * dt);
      } else if (other && other.platformIndex === c.platformIndex) {
        moveToward(c, world, other.x, dt, 0.9);
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    }
    case 'jump': {
      // The physics action: launch off the branch. legPower sets the
      // impulse; gravity does the rest. Grounded only — no mid-air jumps.
      // The genome opens the pathway (instJump); the world teaches the aim —
      // mistimed leaps end in hard landings, and hard landings teach.
      c.actionLabel = 'jumping';
      if (c.grounded) {
        const power = c.pheno.legPower ?? 0.5;
        c.vy = -(JUMP_V_BASE + JUMP_V_GAIN * power);
        c.vx = c.facing * (60 + power * 120);
        c.grounded = false;
        c._active = 1; // jumping is work — the chemistry bills it
        c.reward += 0.05; // airtime feels good
        if (world.stats) world.stats.jumps++; // v0.18 §13.7: the leg experiment counts leaps
        world.events.push({ type: 'jumped', creature: c, t: world.time });
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    }
    case 'vocal': {
      const type = groundCallType(c, s);
      c.actionLabel = type === 'contact' ? 'calling out' : `calling: ${type}!`;
      // v0.16 "Tongues": speak from the lexicon — the prototype most tied
      // to the salient state, with production noise; babble if nothing is
      // tied yet. The speaker reinforces toward its OWN salient state
      // (delta a: it knows why it called).
      const said = speakFromLexicon(c, type, rng);
      const call = emitCall(world, c, type, said.proto);
      const young = ageStage(c.biochem, c.pheno) !== 'adult';
      registerSpoken(c.lexicon, call.proto, type, lexLearnRate(c.pheno, young), world.time);
      c._active = 0.3; // calling is light work
      if (s.callHeard > 0.5) c.reward += 0.05; // answering is social glue — comfort
      c.actionTimer = 0; // calls are punctual, not commitments
      break;
    }
    case 'glide': {
      // The dormant travel verb. Launch like a jump; with real wings the
      // fall becomes a glide. Without wings: exactly a jump (Paul's rule —
      // a verb that needs an organ must degrade to something honest).
      // Physics reads the REALIZED body plan: a baby with wing genes has
      // nubs, not wings.
      const wingArea = (c.bodyPlan && c.bodyPlan.wingArea) || 0;
      const winged = wingArea > 0.6;
      if (!c.grounded) {
        // Already airborne: spread the wings (if any) and ride the air.
        c.gliding = winged;
        c.actionLabel = winged ? 'gliding' : 'falling';
        c._active = 0.6;
      } else if (winged) {
        // A winged launch — like a jump, but the wings are out.
        const power = c.pheno.legPower ?? 0.5;
        c.vy = -(JUMP_V_BASE + JUMP_V_GAIN * power);
        c.vx = c.facing * (60 + power * 120);
        c.grounded = false;
        c.gliding = true;
        c.actionLabel = 'gliding';
        c._active = 1;
        c.reward += 0.05;
        world.events.push({ type: 'jumped', creature: c, t: world.time });
      } else {
        // No wings: exactly a jump.
        c.actionLabel = 'jumping';
        const power = c.pheno.legPower ?? 0.5;
        c.vy = -(JUMP_V_BASE + JUMP_V_GAIN * power);
        c.vx = c.facing * (60 + power * 120);
        c.grounded = false;
        c._active = 1; // jumping is work — the chemistry bills it
        c.reward += 0.05; // airtime feels good
        world.events.push({ type: 'jumped', creature: c, t: world.time });
      }
      break;
    }
    case 'brachiate': {
      // Arm-swinging along the branch — faster than walking when a third
      // grasp pair exists. Without it: exactly moveToward at walk speed.
      const graspPairs = c.bodyPlan ? c.bodyPlan.graspPairs : (c.pheno.graspPairs ?? 2);
      const armed = graspPairs >= 3;
      const mult = 1 + 0.35 * Math.max(0, graspPairs - 2);
      c.brachiating = armed;
      c.actionLabel = armed ? 'brachiating' : 'scrambling along';
      if (s._food) {
        if (moveToward(c, world, s._food.x, dt, mult)) {
          c.actionTimer = 0;
          doEat(c, world);
        }
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    }
    case 'swim': {
      // v0.18 "Realms": the water verb wakes. Membranes are the organ —
      // swimSpeed comes from the aquatic phenotype (evodevo): real membranes
      // swim at 40+wingArea×120 px/s; without them it's a flailing
      // dog-paddle at ~12px/s that costs 3× the oxygen (billed in
      // updateCreature — the chemistry doesn't read ctx.flail). Steering is
      // 2D: toward the move target at swimSpeed. On land: an honest flop.
      const w = c._water; // set by stepPhysics this tick
      if (w) {
        const wingArea = c.pheno.wingArea || 0; // the canonical value deriveAquaticPheno read
        const flail = wingArea < SWIM_FLAIL_AREA;
        c._flail = flail;
        c.actionLabel = flail ? 'flailing' : 'swimming';
        const speed = Number.isFinite(c.pheno.swimSpeed) ? c.pheno.swimSpeed : 12;
        // 2D steering: toward food, else the wander heading. Vertical:
        // paddle toward the food's depth, else ride the float equilibrium.
        let tx = c.x + c.wanderDir * 100;
        let ty = w.surfaceY + FLOAT_MARGIN;
        if (s._food) {
          tx = s._food.x;
          if (Number.isFinite(s._food.y)) ty = s._food.y;
        }
        const dx = tx - c.x;
        if (Math.abs(dx) > 2) c.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        const dy = ty - c.y;
        if (Math.abs(dy) > 2) c.y += Math.sign(dy) * Math.min(Math.abs(dy), speed * 0.7 * dt);
        if (dx !== 0) c.facing = Math.sign(dx);
        c._active = flail ? 1 : 0.8; // flailing is desperate work
        if (s._food && Math.abs(s._food.x - c.x) < EAT_RANGE) {
          c.actionTimer = 0;
          doEat(c, world);
        }
      } else {
        c.actionLabel = 'flopping';
        moveAlong(c, world, c.wanderDir, dt, 0.5); // an honest flop
      }
      // The lungs refill at the surface or on land; the chemistry bills
      // the dive. (Kept for pre-oxygen bodies; the chem exists now.)
      if (!c.submerged) c.breathT = c.pheno.breathTime ?? 30;
      break;
    }
    case 'dive': {
      // Hold depth while in water — needs real gills to stay down.
      // Oxygen-gated: the oxygen chem (not breathT) limits the dive now;
      // at critical oxygen a gill-less diver releases depth and floats up
      // — the honest limit. On land: nothing to dive into; degrades.
      const gillArea = c.pheno.gillArea || 0;
      const w = c._water;
      if (w) {
        c.actionLabel = 'diving';
        c.diving = true;
        c._active = 0.5;
        const oxy = c.biochem.oxygen;
        let outOfAir;
        if (oxy !== undefined) {
          outOfAir = oxy <= 0.05;
        } else {
          // Pre-oxygen fallback: the breath timer.
          c.breathT = (c.breathT ?? c.pheno.breathTime ?? 30) - dt;
          outOfAir = c.breathT <= 0;
          if (outOfAir) c.breathT = c.pheno.breathTime ?? 30;
        }
        if (outOfAir && gillArea <= 0.4) {
          c._holdDepth = undefined; // release — buoyancy floats the body up
          c.action = 'wander';
          c.actionTimer = 0;
        } else {
          // Hold this depth against the float spring (stepPhysics reads it).
          if (c._holdDepth === undefined) c._holdDepth = c.y;
        }
      } else {
        c.actionLabel = 'ducking';
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    }
    case 'drink': {
      // v0.18: drink adjacent water — restores hydration (ctx.drank).
      // Adjacent means at/below the surface or within 40px above it;
      // water merely in sight (waterNear) is not drinkable.
      c.actionLabel = 'drinking';
      const w = c._water;
      let adjacent = false;
      if (w) {
        adjacent = c.y >= w.surfaceY - DRINK_REACH;
      } else {
        try { adjacent = !!waterAt(c.x, c.y + DRINK_REACH, world.layout); } catch (e) { adjacent = false; }
      }
      if (adjacent) {
        c._drank = 1; // consumed by tickBiochem as ctx.drank
        c._active = 0.2;
        c.reward += 0.1 * dt;
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    }
    case 'bask': {
      // v0.18: stationary sunning — restores coreTemp in warmth.
      // Always sets ctx.basking; the warmth gate lives in the chemistry
      // (basking only pays when ambient is warm — a parka in the cold is
      // just standing around). Basking is restful and stationary.
      c.actionLabel = 'basking';
      c._basking = 1;
      c._active = 0.1;
      break;
    }
    case 'dig': {
      // v0.18: dig at the ground — unearths buried food (world.digAt).
      // Three seconds of work; the ground must actually hold something.
      // Digging is work; the find (if any) re-decides toward eating.
      c.actionLabel = 'digging';
      c._digT = (c._digT || 0) + dt;
      c._active = 0.7;
      if (c._digT >= DIG_TIME) {
        let n = 0;
        try { n = digAt(world, c.x, c.y, DIG_RADIUS); } catch (e) { n = 0; }
        if (n > 0) {
          c.reward += 0.4;
          world.events.push({ type: 'dugUp', creature: c, n, t: world.time });
        }
        c._digT = 0;
        c.actionTimer = 0;
      }
      break;
    }
    case 'grasp': {
      // v0.20 "Hands": pick up the nearest manipulable object within reach.
      // Requires graspPairs >= 1 — anatomy gates the verb, not behavior:
      // no hands, no hands. Already holding → nothing (put it down first).
      // Pebbles/sticks leave the world; mineral samples decrement the
      // deposit. The held object is properties only — the hand never knows
      // a tool type (termite logic, design §9.6).
      c.actionLabel = 'grasping';
      c._active = 0.3;
      if (!c.held && (c.pheno.graspPairs || 0) >= 1) {
        const grasp = nearestGraspable(c, world);
        if (grasp) {
          const { obj, kind } = grasp;
          const propsOf = (key, fallback) => {
            const t = mineralType(key);
            return t ? { weight: t.weight, hardness: t.hardness, sharpness: t.sharpness, flammability: t.flammability }
              : fallback;
          };
          if (kind === 'pebble') {
            world.pebbles = world.pebbles.filter((p) => p !== obj);
            // v0.24: the grasp preserves the pebble's own weight — a dropped
            // mineral sample (weight ≠ 0.9) comes back up at the weight it
            // went down at, not at stone's. Exact transfer, both directions.
            c.held = { material: obj.material || 'stone', wear: 0, ...propsOf('stone', { weight: 0.9, hardness: 0.8, sharpness: 0.2, flammability: 0 }), weight: obj.weight ?? 0.9 };
          } else if (kind === 'stick') {
            world.sticks = world.sticks.filter((s) => s !== obj);
            c.held = {
              material: obj.material || 'timber', wear: 0,
              weight: obj.weight ?? 0.7, hardness: obj.hardness ?? 0.4,
              sharpness: obj.sharpness ?? 0.1, flammability: obj.flammability ?? 0.9,
            };
          } else if (kind === 'mineral' && obj.amount > 0) {
            obj.amount -= 1;
            c.held = { material: obj.mineralKey, wear: 0, ...propsOf(obj.mineralKey, { weight: 0.5, hardness: 0.5, sharpness: 0.3, flammability: 0 }) };
          }
          if (c.held) c.reward += 0.1; // the hand learns it took something
        }
      }
      c.actionTimer = 0;
      break;
    }
    case 'carry': {
      // v0.20 "Hands": the wield verb — 'carry' executed under threat while
      // holding IS the strike-with-object (design §1.5: no fourth verb).
      // Empty-handed: a bare shove, honest and weak. Holding with a
      // creature in reach: impulse + injury scaled by weight × hardness,
      // wear on the tool (nothing is free forever). Consequences teach:
      // the threat leaves → fear drains → relief. The design names no
      // 'hammer' and no useTool — a strike is just carry + physics.
      c.actionLabel = c.held ? 'wielding' : 'reaching';
      c._active = 0.5;
      const target = nearestCreatureInReach(c, world);
      if (target) {
        const dir = Math.sign(target.x - c.x) || c.facing;
        if (c.held) {
          const held = c.held;
          const force = 1 + held.weight * held.hardness * 2;
          target.vx = (target.vx || 0) + dir * 40 * force;
          target.vy = (target.vy || 0) - 30 * force;
          target.biochem.injury = clamp01(target.biochem.injury + 0.02 + 0.10 * held.weight * held.hardness);
          target.flinchT = 0;
          held.wear = (held.wear || 0) + 0.08 * (0.3 / Math.max(0.1, held.hardness));
          if (held.wear >= 1) {
            // Breakage — never trash: degrades into a lesser sample,
            // still held. The tool's life is a slope, not a cliff.
            // v0.24: the worn-off fragments fall to the ground — soil
            // waste in the wielder's zone, not vanished mass.
            const lost = held.weight * 0.4;
            held.weight *= 0.6; held.hardness *= 0.8; held.wear = 0;
            const s = world.soil && world.soil[biomeKeyAt(c.x)];
            if (s) s.waste += lost;
            else ledgerOut(world, 'toolWear', lost);
            world.events.push({ type: 'toolBroke', creature: c, t: world.time });
          }
          logCraftUse(c, world); // invention + witness adoption
        } else {
          // Bare shove: impulse only, no injury (design §1.5 — "a weak
          // shove at most"). The hammer must out-damage the hand honestly.
          target.vx = (target.vx || 0) + dir * 40;
          target.flinchT = 0;
        }
        c.actionTimer = 0;
      }
      break;
    }
    case 'drop': {
      // v0.20 "Hands": release the held object with the carrier's velocity.
      // It lands as a pebble (stone/mineral) or stick (timber) carrying its
      // material properties — conservation of matter. Samples don't rejoin
      // a deposit; dropped sticks get a fresh rot clock.
      c.actionLabel = 'dropping';
      if (c.held) {
        const held = c.held;
        const dropX = c.x + (c.facing || 1) * 20;
        if (held.material === 'timber' || held.material === 'driftwood') {
          const s = addStick(world, dropX, c.platformIndex);
          if (s) {
            s.vx = c.vx || 0; s.vy = (c.vy || 0) - 60;
            s.born = world.time;
            s.material = held.material; s.weight = held.weight;
            s.hardness = held.hardness; s.sharpness = held.sharpness;
            s.flammability = held.flammability;
          }
        } else {
          const p = addPebble(world, dropX, c.platformIndex);
          if (p) {
            p.vx = c.vx || 0; p.vy = (c.vy || 0) - 60;
            p.material = held.material; p.hardness = held.hardness;
            p.weight = held.weight;
          }
        }
        c.held = null;
        c._active = 0.2;
      }
      c.actionTimer = 0;
      break;
    }
    case 'bite': {
      // v0.22.1: the attack verb finally lands. The brain selects it via
      // instBite (sense 8 creatureDist → action 23); here it just executes —
      // ordinary machinery, no hunt scripts, no prey-finding cheats. The
      // target is the nearest creature in strike reach (the same helper the
      // carry-strike uses), found through the spatial hash when live.
      c.actionLabel = 'biting';
      c._active = 0.8; // biting is work — the chemistry bills it (fatigue)
      const target = nearestCreatureInReach(c, world);
      if (target) {
        const dir = Math.sign(target.x - c.x) || c.facing || 1;
        // Damage = attacker mouthSize × body mass vs defender spikeArmor.
        // Mass is the honest proxy: size gene × life-stage size.
        const mouth = c.pheno.mouthSize ?? 0.5;
        const mass = (c.pheno.size ?? 0.5) * stageSize(ageStage(c.biochem, c.pheno));
        const armor = target.pheno.spikeArmor ?? 0;
        const dmg = Math.max(0.01, 0.15 * mouth * mass * (1 - Math.min(0.9, armor)));
        target.biochem.injury = clamp01(target.biochem.injury + dmg);
        target.flinchT = 0;
        target.vx = (target.vx || 0) + dir * 25 * mouth * mass; // the shake
        target.vy = (target.vy || 0) - 12 * mouth * mass;
        // Spike retaliation — reuses the v0.9 clash numbers: one
        // retaliation rule, not two. Biting a spiky target hurts the biter.
        const spikes = target.pheno.spikes || 0;
        if (spikes > 0.35 && c.clashCooldown <= 0) {
          c.biochem.injury = clamp01(c.biochem.injury + 0.14 * spikes);
          c.biochem.adrenaline = clamp01(c.biochem.adrenaline + 0.5);
          c.flinchT = 0.45;
          c.clashCooldown = 3;
          c.reward -= 0.2;
          if (world.bonds) nudgeBond(world, c, target, -0.3);
          world.events.push({ type: 'clash', creature: c, other: target, t: world.time });
        }
        // A wound is a wound: severe injury bleeds health through the
        // chemistry channels, and a kill leaves a corpse via noteDeath —
        // the v0.18 scavenging path does the rest.
        world.events.push({ type: 'bite', creature: c, other: target, dmg, t: world.time });
        c.actionTimer = 0;
      } else {
        // No creature in strike reach. The eat precedent (v0.11): if one
        // is in sight but out of reach, go get it — standing still was a
        // livelock that starved a founder. Nothing sensed at all → wander,
        // the codebase convention for a targetless action. (A weak bite
        // instinct must never become a standing-still trap: the vulture
        // QA caught exactly that — flock-mates in sight, out of reach,
        // dying of thirst while snapping at air.)
        if (s._other) {
          c.actionLabel = 'closing in';
          moveToward(c, world, s._other.x, dt, 0.9);
        } else {
          c.action = 'wander';
          c.actionTimer = 0;
        }
      }
      break;
    }
    case 'wander':
    default:
      c.actionLabel = 'wandering';
      c.wanderTimer -= dt;
      if (c.wanderTimer <= 0) {
        c.wanderTimer = rng.range(1, 4);
        c.wanderDir = rng.pick([-1, 1]);
        if (rng.chance(0.25)) c.wanderDir = 0; // pause and look around
      }
      moveAlong(c, world, c.wanderDir, dt, 0.7);
      break;
  }
}

// Close out the previous commitment: write its outcome to episodic memory,
// and let nearby witnesses learn by observation (discounted).
export function finalizeEpisode(c, world) {
  if (!c.episodeInput || c.episodeAction < 0) {
    c.episodeReward = 0;
    return;
  }
  const b = c.biochem;
  const reward = c.episodeReward;
  const critical =
    b.hunger > 0.9 || b.energy < 0.08 || b.fear > 0.7 || b.health < 0.35;
  const ep = {
    input: c.episodeInput,
    action: c.episodeAction,
    reward,
    tick: world.time,
    kind: 'lived',
    critical,
  };
  if (shouldWrite({ reward, critical, kind: 'lived' })) {
    writeEpisode(c.memory, ep);
  }
  // Social learning: salient outcomes teach witnesses half as well as doing.
  // v0.7 adds the second channel: watching a carrier eat well can transmit
  // the *tradition* itself, near-lossless — this is the horizontal half of
  // the ratchet. (Episodic observation is discounted; tradition adoption
  // uses the fidelity of the observer's `tradition` gene.)
  const EAT = ACTIONS.indexOf('eat');
  const demoTraditions = (c.traditions || [])
    .map((id) => getTradition(world.culture, id))
    .filter(Boolean);
  if (Math.abs(reward) > 0.3) {
    for (const o of world.creatures) {
      if (o === c || !o.alive || o.sleeping || !o._senses) continue;
      if (o.platformIndex !== c.platformIndex || Math.abs(o.x - c.x) > OBSERVE_RANGE) continue;
      const observed = {
        input: senseVector(o._senses),
        action: c.episodeAction,
        reward: reward * OBSERVE_DISCOUNT,
        tick: world.time,
        kind: 'observed',
        critical: false,
      };
      if (shouldWrite({ reward: observed.reward, critical: false, kind: 'observed' })) {
        writeEpisode(o.memory, observed);
      }
      // Horizontal transmission: a successful meal, witnessed, teaches the way.
      if (c.episodeAction === EAT && reward > 0.3 && demoTraditions.length > 0) {
        const fid = fidelityOf(o.pheno);
        for (const t of demoTraditions) {
          if ((o.traditions || []).length >= 4) break;
          if (world.rng.chance(0.35 * fid)) {
            if (adoptTradition(world.culture, o, t, fid, world.rng)) {
              world.events.push({ type: 'traditionAdopted', name: t.name, creature: o, t: world.time });
            }
          }
        }
      }
    }
  }
  c.episodeReward = 0;
}

export function updateCreature(c, world, dt) {
  if (!c.alive) return;
  const b = c.biochem;
  const pheno = c.pheno;
  const rng = world.rng;

  // v0.9: signed horizontal velocity (px/s) from last tick's displacement —
  // the impact detector reads this to tell a crash from a caress.
  const prevX = c._px !== undefined ? c._px : c.x;
  c._vx = c.dragged ? 0 : (c.x - prevX) / dt;
  c._px = c.x;

  // v0.14: the waste cycle — bodies excrete whether awake, asleep, or
  // dragged. Proportional clearance into the current zone's soil.
  excrete(c, world, dt);

  // While held by the player's hand: body chemistry continues, mind pauses.
  if (c.dragged) {
    tickBiochem(b, pheno, dt, {});
    if (isDead(b, pheno)) {
      c.alive = false;
      const oldAge = b.age >= pheno.lifespanSec;
      noteDeath(world, c, oldAge ? 'old age' : b.illness > 0.6 ? 'illness' : b.hunger > 0.9 ? 'starvation' : b.injury > 0.6 ? 'wounds' : 'ill health');
      return;
    }
    return;
  }

  // Waking: rested, or hunger overrides.
  if (c.sleeping && (b.energy > 0.92 || b.hunger > 0.85 || b.fear > 0.5)) {
    c.sleeping = false;
    c.actionTimer = 0; // choose something new on waking
  }

  // nearFriend was set by last tick's action — feed it to biochem BEFORE
  // resetting. (v0.5 fix: it used to be cleared first, so company could never
  // satisfy the social need and creatures stayed lonely forever.)
  const wasNearFriend = c.nearFriend;
  c.nearFriend = false;
  // Grooming flags: set by last tick's actions — feed them to the chemistry
  // BEFORE resetting (the v0.5 nearFriend fix, applied to the ritual).
  const wasGrooming = c.grooming;
  const wasGroomed = c._groomed;
  c._groomed = false;
  if (wasGroomed) applyStimulus(c, 'groomed'); // v2 (S): being groomed carries valence
  // Meals: doEat accumulated c._ate during last tick's action — the chemistry
  // converts it to blood sugar now.
  const ate = c._ate || 0;
  c._ate = 0;
  // v0.18 "Realms": drinking — the drink action sets c._drank; the chemistry
  // converts it to hydration now.
  const drank = c._drank || 0;
  c._drank = 0;
  // v0.13 migration friction: homesickness — comfort drains in proportion
  // to distance from the imprinted home range, scaled by the instHomeSeek
  // gene. Homebodies feel the pull; wanderers (low instHomeSeek) range free.
  // This is the cost that lets biomes diverge instead of homogenizing
  // (Paul's v0.11 honest negative: zones alone don't differentiate).
  // v0.18: scaled by biome-center distance (leaving the birth biome costs
  // more than leaving the birth zone did).
  const homeDist = scaledHomeDist(c, world);
  // v0.18 "Realms": predators are the threat channel — fear enters the
  // chemistry through proximity, not through the fear readout itself
  // (which would feed back).
  let threat = 0;
  if (world.predators) {
    for (const p of world.predators) {
      if (!p.alive) continue;
      const pd = Math.hypot(p.x - cx0(c), (p.y ?? 800) - cy0(c));
      if (pd < 300) threat = Math.max(threat, 1 - pd / 300);
    }
  }
  // v0.18 "Realms": the water/thermal context — the biome map's real fields.
  // submerged/heat/ambientTemp are NaN-guarded by the chemistry; drank and
  // basking were set by this tick's action; sailDump is the body plan.
  let ambTemp = 0.5, ambHeat = 0;
  try {
    ambTemp = ambientTemp(c.x, c.y, world.layout);
    ambHeat = ambientHeat(c.x, c.y, world.layout);
  } catch (e) { /* chemistry defaults cover it */ }
  // v0.23 "Weather": the creature feels the GENERATED temperature field, not
  // the painted biome map. tempAt is on the same 0..1/0.5-neutral scale the
  // biochem expects, and the seed reproduces painted behavior at worldgen —
  // so selection tracks the weather as biomes drift. Heat is read off the
  // same field (hot air), not the desert's address.
  if (world.climate) {
    ambTemp = tempAt(world, c.x, c.y);
    ambHeat = Math.max(0, Math.min(1, (ambTemp - 0.55) / 0.45));
    // v0.23: rain wets fur; warmth dries it. Thick cloud means rain.
    const rainHere = cloudAt(world, c.x);
    const dryRate = 0.02 * (0.3 + ambTemp) * (1 - Math.min(1, rainHere) * 0.8);
    const wetting = rainHere > 0.6 ? (rainHere - 0.6) * 0.5 * dt : 0;
    c.wetness = clamp01((c.wetness || 0) + wetting - dryRate * dt);
  }
  if (!Number.isFinite(ambTemp)) ambTemp = 0.5;
  if (!Number.isFinite(ambHeat)) ambHeat = 0;
  // v0.17 "Bauplan": growing novel structures costs fuel. Juveniles pay
  // the developmental cost through hunger (the chemistry bills it below);
  // adults pay maintenance upkeep after the tick. Founder 0 → silent.
  const devStage = ageStage(b, pheno);
  tickBiochem(b, pheno, dt, {
    sleeping: c.sleeping,
    playing: c.playing,
    nearFriend: wasNearFriend,
    petted: c.pettedFlag,
    scolded: c.scoldedFlag,
    grooming: wasGrooming,
    groomed: wasGroomed,
    ate,
    // v0.20 "Hands": carrying is heavy — all exertion while holding costs
    // ×(1 + weight) through the bloodSugar channel (design §4). The
    // exertion term stays linear; a heavy stone just moves you up the line.
    active: Math.min(2, (c._active || 0) * (c.held ? 1 + (c.held.weight || 0) : 1)),
    threat,
    homesick: homeDist * (pheno.instHomeSeek !== undefined ? pheno.instHomeSeek : 0.5),
    develop: (devStage === 'baby' || devStage === 'child') ? (pheno.developDrain || 0) : 0,
    submerged: c.submerged ? 1 : 0,
    heat: ambHeat,
    ambientTemp: ambTemp,
    drank,
    basking: c._basking || 0,
    sailDump: pheno.sailDump || 0,
    wet01: c.wetness || 0, // v0.23 "Weather": drying wet fur bills fatigue
    // v0.25 "Heat": cloud cover shades the basker — basking pays less
    // under overcast (biochem scales the basking term by sunFrac).
    cloud: world.climate ? cloudAt(world, c.x) : 0,
    // v0.27 "Seasons": basking follows seasonal insolation (1.0 summer
    // solstice → 0.2 winter) — else creatures bypass winter by basking.
    seasonSun: world.climate ? seasonSun(world) : 1,
  });
  // v0.18: flailing (swimming without membranes) costs 3× the oxygen.
  // The chemistry doesn't read a flail flag, so the surcharge is billed
  // here — 2× extra on top of the base rate = 3× total. No double-billing:
  // this is the only flail charge. (Kept only when the oxygen chem exists.)
  if (c._flail && c.submerged && Number.isFinite(b.oxygen)) {
    const bt = Math.max(1, pheno.breathTime ?? 30);
    b.oxygen = clamp01(b.oxygen - 0.08 * (30 / bt) * dt);
  }
  // v0.17 "Bauplan": adult maintenance — novel structures cost fuel to keep.
  if ((pheno.wingUpkeep || 0) + (pheno.gillUpkeep || 0) + (pheno.finUpkeep || 0) > 0) {
    const upStage = ageStage(b, pheno);
    if (upStage === 'adult' || upStage === 'senior') {
      b.bloodSugar = clamp01(b.bloodSugar -
        ((pheno.wingUpkeep || 0) + (pheno.gillUpkeep || 0) + (pheno.finUpkeep || 0)) * dt);
    }
  }
  c.pettedFlag = false;
  c.scoldedFlag = false;
  c.mateCooldown = Math.max(0, c.mateCooldown - dt);

  if (isDead(b, pheno)) {
    c.alive = false;
    const oldAge = b.age >= pheno.lifespanSec;
    noteDeath(world, c, oldAge ? 'old age' : b.illness > 0.6 ? 'illness' : b.hunger > 0.9 ? 'starvation' : b.injury > 0.6 ? 'wounds' : 'ill health');
    return;
  }

  c.reward = 0;
  if (!c.sleeping) {
    c.sleepTicks = 0;
    const s = gatherSenses(c, world);
    c._senses = s;

    // v0.14 "Voices": vocal learning — the dialect engine. Heard pitches
    // enter the culture memory (ring buffer of 16); the creature's own
    // pitch drifts toward the local mean at vocalImitate × tradition
    // fidelity. Genetics sets the base; the neighborhood sets the accent.
    // Alarm calls reassure: hearing one drains fear slightly (the troop
    // is watchful, not alone with the threat).
    if (s.callHeard > 0.3 && s.callPitch > 0) {
      c.heardPitches.push(s.callPitch);
      if (c.heardPitches.length > 16) c.heardPitches.shift();
      const mean = c.heardPitches.reduce((a, x) => a + x, 0) / c.heardPitches.length;
      const fid = fidelityOf(c.pheno);
      const rate = Math.min(1, (c.pheno.vocalImitate ?? 0) * fid * dt * 2);
      c.voicePitch = Math.max(0.05, Math.min(1, c.voicePitch + (mean - c.voicePitch) * rate));
    }
    if (s._alarmHeard) b.adrenaline = clamp01(b.adrenaline - 0.12 * dt);

    // v0.16 "Tongues": the lexicon learns from every heard call (delta a,
    // hearer half). The heard prototype is reinforced toward the hearer's
    // own most salient observable context in a short recency-weighted
    // window — the hearer never knows the speaker's state. Novel sounds
    // birth probationary candidates. Infant critical-period boost (delta f).
    {
      const young = ageStage(b, c.pheno) !== 'adult';
      const lr = lexLearnRate(c.pheno, young);
      const osc = ownSalientContext(c, s);
      pushContextWindow(c, osc.ctx, osc.w, world.time);
      if (s._heardCall && s.callHeard > 0.2) {
        const hc = hearerSalientContext(c, world.time);
        registerHeard(c.lexicon, s._heardCall.proto, hc.ctx, hc.weight, lr, world.time);
      }
      decayLexicon(c.lexicon, dt, world.time);
    }

    // Illness: contagion from sick neighbors, plus rare spontaneous onset.
    // Stronger immune systems resist both.
    // v0.6 morphology: spike armor thickens the skin against disease.
    const susceptibility = Math.max(0, 1 - c.pheno.immunity * 0.75 - (c.pheno.spikeArmor || 0));
    const other = s._other;
    // v0.6 morphology: spiky neighbors are intimidating — fear rises with
    // their spikes and proximity. (The social cost of armor.) Mild by
    // design: it unnerves, it never panics alone. Panic comes from events
    // (clash pain, the player's scold), not from ambient dread — ambient
    // dread in a dense world is either vestigial or a chronic-anxiety
    // epidemic, and we tried both.
    if (other && (other.pheno.spikeFear || 0) > 0 && s.creatureDist < 0.5) {
      b.adrenaline = clamp01(b.adrenaline + other.pheno.spikeFear * (0.5 - s.creatureDist) * 2 * dt);
    }
    // v0.9 embodiment: the bristle display. Fear raises the spikes and puffs
    // the fur — a visible threat display computed in sim, drawn by the
    // painter. And bodies read bodies: a bristling neighbor up close is
    // frightening in itself, no dedicated channel needed. The germ of
    // communication is honest bodies in a shared world.
    c.bristling = b.fear > 0.5;
    if (other && other.bristling && s.creatureDist < 0.35) {
      // Close enough to read the body (~150px): the display frightens.
      // CAPPED at 0.45 — alarm signals alert, they don't panic. Without the
      // cap, one bristler terrifies neighbors past the 0.5 bristle
      // threshold, they bristle, and the whole herd panics in a
      // self-sustaining epidemic. You bristle from direct threat (spike
      // aura, clash pain), not from someone else's bristling.
      if (b.adrenaline < 0.45) b.adrenaline = Math.min(0.45, b.adrenaline + 1.5 * (0.35 - s.creatureDist) * dt);
    }
    // v0.9 injuries: fast flight crashes into spiky creatures. The flee
    // action is the filter (1.4× — play, foraging, wandering, courting are
    // all slower and controlled); the mover must be closing, not running
    // away. A crash startles (+0.5 adrenaline — the victim visibly bristles)
    // but stays below the 0.55 urgent threshold, so one crash doesn't
    // chain into another: startle, bristle, recover. (At +0.6 it pinballed.)
    // Scaled by the other's spikes, 3s refractory. Pain (−0.2) teaches
    // avoidance. The body records its history; rest heals it.
    c.clashCooldown = Math.max(0, c.clashCooldown - dt);
    c.flinchT = Math.max(0, c.flinchT - dt);
    const toward = other && other.x >= c.x ? 1 : -1;
    const ownToward = (c._vx || 0) * toward;
    if (other && c.action === 'flee' && ownToward > 0 &&
        (other.pheno.spikes || 0) > 0.35 && c.clashCooldown <= 0) {
      const distPx = s.creatureDist * s._range;
      if (distPx < creatureRadius(c) + creatureRadius(other) + 4) {
        b.injury = clamp01(b.injury + 0.14 * other.pheno.spikes);
        // A crash startles (+0.5 adrenaline): the victim visibly bristles,
        // then calms.
        b.adrenaline = clamp01(b.adrenaline + 0.5);
        c.flinchT = 0.45;
        c.clashCooldown = 3;
        c.reward -= 0.2;
        // v0.12: pain poisons the relationship — clashes damage bonds.
        if (world.bonds) nudgeBond(world, c, other, -0.3);
        world.events.push({ type: 'clash', creature: c, other, t: world.time });
      }
    }
    // Contagion requires a GRAVELY ill neighbor (0.65+); a fresh infection
    // starts mild (0.2) so healthy creatures recover before becoming
    // contagious. Only the weak become spreaders — disease is a selection
    // pressure, not a plague. (Seed 77: 173 illness deaths wiped a healthy
    // population because 0.45→0.5 was effectively instant contagion.)
    if (other && other.biochem.illness > 0.65 && s.creatureDist * s._range < 150) {
      if (rng.chance(0.35 * susceptibility * dt)) {
        c.biochem.illness = Math.min(1, c.biochem.illness + 0.2);
        world.events.push({ type: 'infected', creature: c, t: world.time });
      }
    } else if (c.biochem.illness <= 0 && rng.chance(0.0008 * (1.3 - c.pheno.immunity) * dt)) {
      c.biochem.illness = 0.35;
      world.events.push({ type: 'infected', creature: c, t: world.time });
    }

    const stage = ageStage(b, pheno);
    // v2 (L): maturation — juveniles learn faster. Founder: no boost.
    c._learnBoost = (stage === 'baby' || stage === 'child') ? 1 + (pheno.matBoost ?? 0) : 1;
    // v0.17 "Bauplan": development ticks. Juveniles log their nutrition;
    // a stage change re-expresses the body plan; maturation freezes the
    // stunt factor — starved childhoods write permanently on the body.
    if (stage === 'baby' || stage === 'child') {
      const ej = c._juv || (c._juv = { n: 0, sum: 0 });
      ej.n++; ej.sum += b.bloodSugar;
    }
    if (stage !== c._stage) {
      const juvMean = c._juv && c._juv.n > 0 ? c._juv.sum / c._juv.n : undefined;
      if (stage === 'adult') c._stunt = 0.5 + 0.5 * (juvMean ?? 0.75);
      c._stage = stage;
      c.bodyPlan = expressBuds(c.pheno, developmentalGrowth01(stage, juvMean, c._stunt));
    }
    // Commit to an action for a stretch; only urgent needs interrupt.
    // (Re-deciding every tick causes jitter — the creature can never
    // actually walk to the food it wants.)
    c.actionTimer -= dt;
    const urgent = b.hunger > 0.8 || b.energy < 0.1 || b.fear > 0.55;
    if (c.actionTimer <= 0 || urgent) {
      finalizeEpisode(c, world); // the last commitment's outcome becomes memory
      const exploration = 0.22 * (stage === 'baby' ? 1.6 : 1) * (0.35 + pheno.boldness);
      const input = senseVector(s);
      const votes = recall(c.memory, input); // the past votes; it doesn't rule
      // v0.7: traditions vote too — the culture's past alongside the personal one.
      const tv = traditionVotes(c, world.culture, s);
      for (let j = 0; j < votes.length; j++) votes[j] += tv[j];
      const { action } = decide(c.brain, input, exploration, rng, votes);
      // Exhaustion overrides: a depleted creature should sleep.
      c.action = b.energy < 0.1 && action !== 'flee' ? 'sleep' : action;
      // Starving overrides (v2, inverted): desperate hunger beats everything
      // except eating, seeking food, and fleeing. The old version listed the
      // actions hunger could interrupt (wander/play/approach/seekHome) and
      // missed sleep/mate/climb/groom — creatures starved while courting or
      // napping. Now hunger wins over the sleep override above.
      if (b.hunger > 0.8 && c.action !== 'eat' && c.action !== 'seekFood' && c.action !== 'flee') {
        c.action = 'seekFood';
      }
      // Breeding opportunity (v0.5, retargeted v2): a lonely adult that senses
      // a nearby VALID mate courts instead of dithering. v2 reads s._mate
      // (nearest adult of the opposite sex) instead of s._other (nearest
      // body) — the old backstop so often found same-sex or juvenile
      // company that tryMate never fired and lineages died out. Without this
      // backstop the mate drive lost to play/wander often enough that
      // lineages went extinct. Survival drives above still take precedence.
      const partner = s._mate;
      // _mate is only sensed within sight range, so courtship starts whenever
      // a valid mate is visible. (The old 240px gate was tuned for
      // same-platform courtship; with cross-branch sensing it strangled the
      // backstop — mates were seen 60%+ of adult time but never courted.)
      // Courtship can interrupt foraging when hunger is moderate — a
      // mildly-hungry tanglekin can afford to court; a starving one can't.
      // The 0.7 threshold matches tryMate's own hunger gate, so courtship
      // that starts here can actually conclude. Without this, the hunger
      // drive (90% of adult decisions) starved courtship of every slot.
      const peckish = b.hunger < 0.7;
      if (
        stage === 'adult' && partner &&
        c.mateCooldown <= 0 && partner.mateCooldown <= 0 && peckish &&
        (c.action === 'wander' || c.action === 'play' || c.action === 'approach' || c.action === 'seekHome' || c.action === 'seekFood')
      ) {
        c.action = 'mate';
      }
      // v2 (E): emitters — committing to an action releases a chemical pulse
      // (once per commitment, not per tick). Founder amounts are small
      // nudges; evolution can turn them into floods.
      if (c.action !== c._lastEmittedAction) {
        fireEmitters(c);
        c._lastEmittedAction = c.action;
      }
      c.episodeInput = input;
      c.episodeAction = ACTIONS.indexOf(c.action);
      c.actionTimer = rng.range(0.8, 2.4) * (0.6 + pheno.boldness * 0.8);
    }
    executeAction(c, world, dt, s);
  } else {
    c.action = 'sleep';
    c.actionLabel = 'sleeping';
    // Sleep consolidation: sustained sleep replays salient episodes.
    c.sleepTicks++;
    if (c.sleepTicks >= 100) {
      consolidate(c.memory, c.brain, c.pheno);
      c.sleepTicks = 0;
    }
  }

  // Continuous shaping: satiety and rest feel good, suffering feels bad.
  c.reward += (0.5 - b.hunger) * 0.06 * dt;
  c.reward += (b.energy - 0.5) * 0.04 * dt;
  c.reward -= b.fear * 0.15 * dt;
  c.reward -= b.illness * 0.08 * dt; // v0.8: sickness feels bad — getting better feels good
  if (b.hunger > 0.9 || b.energy < 0.05) c.reward -= 0.1 * dt;

  // v2 (B): learn takes the chemistry for neuromodulation, and the
  // juvenile boost from maturation (founder: both neutral).
  learn(c.brain, pheno, Math.max(-1, Math.min(1, c.reward)) * (c._learnBoost ?? 1), b);
  c.episodeReward += c.reward; // the commitment's running outcome
  // Epigenetic life events: sustained conditions mark the genome, and the
  // marks refresh the phenotype — experience becomes heritable tuning that
  // fades over generations. Scarcity breeds thrift (slower burn), isolation
  // breeds hunger for company, surviving illness breeds stronger immunity.
  // Marks never touch the instinct wiring (genetic); they tune the body.
  const epi = c._epi || (c._epi = { hungerT: 0, loneT: 0, wasSick: false, refractory: 0 });
  epi.refractory = Math.max(0, epi.refractory - dt);
  let marked = null;
  if (b.hunger > 0.85) epi.hungerT += dt; else epi.hungerT = 0;
  if (b.social > 0.85) epi.loneT += dt; else epi.loneT = 0;
  if (epi.refractory <= 0) {
    if (epi.hungerT > 60) {
      markLocus(c.genome, 'hungerRate', -0.12);
      marked = 'scarcity → thrifty metabolism';
      epi.hungerT = 0; epi.refractory = 240;
    } else if (epi.loneT > 60) {
      markLocus(c.genome, 'sociability', 0.12);
      marked = 'isolation → hunger for company';
      epi.loneT = 0; epi.refractory = 240;
    }
  }
  const sickNow = b.illness > 0.5;
  if (epi.wasSick && !sickNow && epi.refractory <= 0) {
    markLocus(c.genome, 'immunity', 0.1);
    marked = 'illness survived → stronger immunity';
    epi.refractory = 240;
  }
  epi.wasSick = sickNow;
  if (marked) {
    c.pheno = deriveAquaticPheno(phenotype(c.genome)); // marks change expression — refresh (v0.18: +aquatic)
    // v0.17: the body plan re-expresses too — the same developmental moment.
    const g01 = c.bodyPlan ? c.bodyPlan.growth01 : 1;
    c.bodyPlan = expressBuds(c.pheno, g01);
    world.events.push({ type: 'epimark', creature: c, note: marked, t: world.time });
  }

  // Fear stimuli (spike aura, bristle contagion, crashes) write to
  // adrenaline, the chemical. Refresh the fear readout here — after every
  // stimulus, including the crash inside executeAction — so the brain, the
  // painter, and the tests see this tick's fear, not last tick's.
  b.fear = clamp01(b.adrenaline);

  // Physics closes the tick: gravity integrates, landings resolve, falls hurt.
  // (Dragged creatures returned early — the hand holds them, not the world.)
  stepPhysics(c, world, dt);

  c.mood = mood(b);
}

// Player interactions.
export function petCreature(c) {
  if (!c.alive) return;
  c.pettedFlag = true;
  c.reward += 0.5;
  applyStimulus(c, 'petted'); // v2 (S): being petted carries evolvable valence
  learn(c.brain, c.pheno, 0.5, c.biochem);
  // Being petted is a salient social event — remember it.
  if (c.brain.lastInput) {
    writeEpisode(c.memory, {
      input: c.brain.lastInput, action: ACTIONS.indexOf(c.action),
      reward: 0.5, tick: 0, kind: 'lived', critical: false,
    });
  }
}

export function scoldCreature(c) {
  if (!c.alive) return;
  c.scoldedFlag = true;
  c.reward -= 0.7;
  applyStimulus(c, 'scolded'); // v2 (S): being scolded carries evolvable valence
  learn(c.brain, c.pheno, -0.7, c.biochem);
  // Being scolded is a salient social event — remember it.
  if (c.brain.lastInput) {
    writeEpisode(c.memory, {
      input: c.brain.lastInput, action: ACTIONS.indexOf(c.action),
      reward: -0.7, tick: 0, kind: 'lived', critical: false,
    });
  }
}

// ---- v0.18 "Realms": predators ----
// Sharks (water-breathers, live 3D) and bears (thermal, arctic-native).
// The brain agent owns the neural substrate; these live here because
// creature.js owns bodies, chemistry context, and per-tick physiology.
// Exported for world.js (spawning is the world agent's call — creature.js
// only provides the constructor and the tick). NaN-guarded throughout.

const SHARK_SPEED = 90; // px/s cruise
const SHARK_TOUCH_RANGE = 30; // px — a bump that kills
const SHARK_HUNGER_RANGE = 480; // px — scent range
// (v0.27: the bear thermal fallback was deleted — bears run tickBiochem now.)

function makeShark(world, x, y) {
  return {
    kind: 'shark',
    id: nextId++,
    alive: true,
    // Gill-breathers: 3000s of "breath" — the oxygen chem drains at
    // 0.0004/s submerged (tickBiochem), so a shark's gills are effectively
    // inexhaustible. The beaching rule (below) is what kills them.
    pheno: {
      breathTime: 3000,
      furInsulation: 0,
      coldTol: 1.0, // deep water is cold; a shark's genes expect it
      heatTol: 0.1,
      swimSpeed: 160,
    },
    biochem: createBiochem(world.rng),
    x, y, vx: 0, vy: 0,
    facing: x < world.width / 2 ? 1 : -1,
    wanderT: 0, wanderDir: 1, reward: 0,
    submerged: y > 0,
    _water: null,
  };
}

function makeBear(world, x, y) {
  return {
    kind: 'bear',
    id: nextId++,
    alive: true,
    // Arctic-native: maximal insulation on the 0–0.3 physiological scale,
    // cold-tolerant, heat-fragile. v0.27: was 1.0 with a special-case thermal
    // fallback in tickPredators (the chemistry degenerates at exactly 1.0 —
    // zero ambient coupling). One physics for every body now: bears run the
    // same tickBiochem as everything else, and the fallback is deleted.
    // The pheno is COMPLETE for tickBiochem (hungerRate/energyDrain/
    // lifespanSec have no fallbacks — undefined would NaN the chemistry).
    pheno: {
      furInsulation: 0.3,
      coldTol: 0.9,
      heatTol: 0.1,
      breathTime: 30,
      swimSpeed: 50, // bears can swim, badly
      hungerRate: 0.15, // large predator: slow metabolism (v0.26 bears
      energyDrain: 0.15, // never hungered/tired; v0.27 keeps them viable
      lifespanSec: 5400, // long-lived; old age is not what kills a bear
      legDrainMult: 1.2, // heavy quadruped
      immunity: 0.5,
      sociability: 0.3, // solitary
    },
    biochem: createBiochem(world.rng),
    x, y, vx: 0, vy: 0, grounded: true,
    facing: x < world.width / 2 ? 1 : -1,
    wanderT: 0, wanderDir: 1, reward: 0,
  };
}

// 5 sharks (3 deep, 1 archipelago, 1 shallows) + 2 arctic bears.
// Positions read the biome map — NaN-guarded; falls back to raw x.
export function spawnPredators(world) {
  world.predators = world.predators || [];
  // Decor stream: predator placement must not shift the main rng sequence
  // (founder genomes/cohort sizes stay pinned). The v0.9 decorRng lesson.
  const rng = world.decorRng || world.rng || { range: (a, b) => a + (b - a) / 2 };
  const sharkBiomes = [7, 7, 7, 6, 5]; // deep×3, archipelago, shallows
  for (const bi of sharkBiomes) {
    let sx = null;
    try { sx = biomeCenterX(bi, world.layout); } catch (e) { sx = null; }
    if (!Number.isFinite(sx)) sx = [4500, 4400, 4600, 3900, 3300][sharkBiomes.indexOf(bi)] || 4500;
    let w = null;
    try { w = waterAt(sx, 800, world.layout); } catch (e) { w = null; }
    const sy = w && Number.isFinite(w.surfaceY) ? w.surfaceY + 120 : 980;
    world.predators.push(makeShark(world, sx + rng.range(-80, 80), sy));
  }
  for (let i = 0; i < 2; i++) {
    let bx = null;
    try { bx = biomeCenterX(0, world.layout); } catch (e) { bx = null; }
    if (!Number.isFinite(bx)) bx = 300;
    let gy = 800;
    try { gy = groundYAt(bx, world.layout); } catch (e) { gy = 800; }
    if (!Number.isFinite(gy)) gy = 800;
    world.predators.push(makeBear(world, bx + rng.range(-100, 100), gy));
  }
  return world.predators;
}

// Per-tick predator physiology and behavior. Sharks seek the nearest
// creature in water within 480px and kill on contact; out of water they
// lose 0.1 health/s (dead in 10s). Bears amble; their thermal fallback
// (the chemistry degenerates at furInsulation=1.0 — zero ambient coupling)
// applies health −0.05×load/s with load = max(0, ambient−0.45)×(0.5+fur)×
// (1.2−heatTol). The dead are kept, not culled — the chronicle may need them.
export function tickPredators(world, dt) {
  if (!world.predators) return;
  for (const p of world.predators) {
    if (!p.alive) continue;
    const b = p.biochem;
    if (p.kind === 'shark') {
      // Water state (same literal formula as creatures).
      let w = null;
      try { w = waterAt(cx0(p), cy0(p), world.layout); } catch (e) { w = null; }
      p._water = w;
      const inWater = !!w && p.y > w.surfaceY - 4;
      p.submerged = !!w && p.y > w.surfaceY + SUBMERGE_MARGIN;
      if (!inWater) {
        // Beached: 0.1 health/s — dead in ten seconds, honestly.
        b.health = clamp01(b.health - 0.1 * dt);
      } else {
        // Gill breath: the chemistry drains oxygen while submerged; a
        // shark's 3000s breathTime makes it negligible. Buoyancy-ish:
        // sharks hold depth by swimming, not floating.
        p.vy *= Math.max(0, 1 - 3 * dt);
      }
      // Hunt: nearest living creature in water within scent range.
      let target = null, td = SHARK_HUNGER_RANGE;
      for (const c of world.creatures || []) {
        if (!c.alive || !c.submerged) continue;
        const d = Math.hypot(cx0(c) - cx0(p), cy0(c) - cy0(p));
        if (d < td) { td = d; target = c; }
      }
      if (target && inWater) {
        const dx = cx0(target) - cx0(p), dy = cy0(target) - cy0(p);
        const d = Math.hypot(dx, dy) || 1;
        p.vx = dx / d * SHARK_SPEED;
        p.vy = dy / d * SHARK_SPEED * 0.8;
        p.facing = dx >= 0 ? 1 : -1;
      } else {
        p.wanderT -= dt;
        if (p.wanderT <= 0) {
          p.wanderT = 2 + world.rng.range(0, 3);
          p.wanderDir = world.rng.chance(0.5) ? -1 : 1;
        }
        p.vx = p.wanderDir * SHARK_SPEED * 0.4;
      }
      if (!inWater) {
        // Beached: one physics for every body. The shark falls under the
        // same gravity as everything else and lands on whatever is below;
        // grounded, it rests on the sand while the beaching clock runs.
        if (!p.grounded) {
          integrateGravity(p, world, dt);
        } else {
          p.vx = 0; p.vy = 0;
          const pl = world.platforms[p.platformIndex];
          if (pl) p.y = pl.y;
        }
      } else {
        // v0.20: earth is solid for sharks too — one physics. A swimming
        // shark may not enter the earth: not the shore cliff at the
        // shallows' west edge (the old bug swam sharks UNDER the desert),
        // not the seabed, not the archipelago islands. Blocked on an
        // axis, the shark turns away; the water simply ends at the shore.
        // (Beaching itself onto the sand above the waterline is still
        // allowed — that's an honest stranding, and the clock kills it.)
        let nx = p.x + p.vx * dt;
        let ny = p.y + p.vy * dt;
        let gyDest = null, gyHere = null;
        try { gyDest = groundYAt(nx, world.layout); } catch (e) { gyDest = null; }
        try { gyHere = groundYAt(p.x, world.layout); } catch (e) { gyHere = null; }
        const earthAt = (gy) => gy !== null && gy !== undefined && Number.isFinite(gy);
        if (earthAt(gyDest) && ny > gyDest) {
          nx = p.x; // hold x, turn around
          p.vx = -p.vx;
          p.wanderDir = -p.wanderDir;
          p.wanderT = Math.max(p.wanderT, 1.5);
        }
        if (earthAt(gyHere) && ny > gyHere) {
          ny = p.y; // don't dive through the seabed
          if (p.vy > 0) p.vy = -p.vy * 0.5;
        }
        p.x = nx;
        p.y = ny;
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        if (p.x > world.width) { p.x = world.width; p.vx = -Math.abs(p.vx); }
      }
      // Contact: the kill. Prey dies; the chronicle records it.
      for (const c of world.creatures || []) {
        if (!c.alive) continue;
        if (Math.hypot(cx0(c) - cx0(p), cy0(c) - cy0(p)) < SHARK_TOUCH_RANGE) {
          c.alive = false;
          c.biochem.health = 0;
          world.events.push({ type: 'killed', predator: p, creature: c, t: world.time });
          // v0.24: mass-honest kill — the carcass weighs what the body
          // weighed (not a fixed 1); gut spills and held tools drop via
          // releaseBodyMass, like every other death.
          releaseBodyMass(world, c);
          // The carcass feeds the sea: a corpse food item.
          addFood(world, c.x, c.platformIndex, 'corpse', bodyMassOf(c), 0, { nutrition: CORPSE_NUTRITION });
        }
      }
      // Physiology: the full chemistry context, sharks included.
      let ambTemp = 0.5;
      try { ambTemp = ambientTemp(p.x, p.y, world.layout); } catch (e) { /* default */ }
      if (!Number.isFinite(ambTemp)) ambTemp = 0.5;
      const before = b.health;
      tickBiochem(b, p.pheno, dt, {
        sleeping: false, playing: false, nearFriend: false, petted: false,
        scolded: false, grooming: false, groomed: false,
        ate: 0, active: target ? 0.9 : 0.4, threat: 0, homesick: 0,
        develop: 0,
        submerged: p.submerged ? 1 : 0,
        heat: 0, ambientTemp: ambTemp, drank: 0, basking: 0,
        sailDump: 0,
      });
      void before;
      if (b.health <= 0 || isDead(b, p.pheno)) {
        p.alive = false;
        world.events.push({ type: 'predatorDied', predator: p, t: world.time });
      }
    } else if (p.kind === 'bear') {
      // Bears amble on the ground (simple wander; gravity keeps them down).
      p.wanderT -= dt;
      if (p.wanderT <= 0) {
        p.wanderT = 3 + world.rng.range(0, 4);
        p.wanderDir = world.rng.chance(0.5) ? -1 : 1;
        p.facing = p.wanderDir;
      }
      // v0.20 "One physics": bears are bodies, not pins. The first tick
      // resolves which platform (if any) is underfoot; grounded bears
      // amble and turn at the brink, airborne bears fall through
      // integrateGravity like everything else in this world.
      if (p.platformIndex === undefined || p.platformIndex === null) {
        // No platform underfoot yet — stay airborne until the landing loop
        // (inside integrateGravity) catches a real platform. Re-resolved
        // each tick until it does.
        p.grounded = false;
        for (let i = 0; i < world.platforms.length; i++) {
          const pl = world.platforms[i];
          if (p.x >= pl.x1 && p.x <= pl.x2 && Math.abs(pl.y - p.y) < 2) {
            p.platformIndex = i;
            p.grounded = true;
            break;
          }
        }
      }
      if (p.grounded) {
        const spd = 30, r = 14;
        p.x = cx0(p) + p.wanderDir * spd * dt;
        if (p.x < 0) { p.x = 0; p.wanderDir = 1; p.facing = 1; }
        if (p.x > world.width) { p.x = world.width; p.wanderDir = -1; p.facing = -1; }
        const plat = world.platforms[p.platformIndex];
        if (plat) {
          // Turn at the brink — bears don't wander off cliffs.
          if (p.x < plat.x1 + r) { p.x = plat.x1 + r; p.wanderDir = 1; p.facing = 1; }
          else if (p.x > plat.x2 - r) { p.x = plat.x2 - r; p.wanderDir = -1; p.facing = -1; }
          p.y = plat.y;
        }
        p.vx = 0; p.vy = 0;
      } else {
        integrateGravity(p, world, dt);
      }
      // Thermal (v0.27): bears run the same chemistry as every other body —
      // furInsulation 0.3 is the physiological max (the old 1.0 needed a
      // special-case fallback; deleted). Arctic ambient keeps them safe;
      // jungle/desert heat kills them through the ordinary hyperthermia
      // path. One physics for every body.
      let ambTemp = 0.5;
      try { ambTemp = ambientTemp(p.x, p.y, world.layout); } catch (e) { /* default */ }
      if (!Number.isFinite(ambTemp)) ambTemp = 0.5;
      // Bears drink when water is near — the unified chemistry runs
      // hydration (the old fallback never did), so a bear that never drinks
      // would desiccate in ~200s. Honest behavior, not a test hack.
      let drank = 0;
      try { drank = waterAt(p.x, p.y + 30, world.layout) ? 1 : 0; } catch (e) { drank = 0; }
      {
        const before = b.health;
        tickBiochem(b, p.pheno, dt, {
          sleeping: false, playing: false, nearFriend: false, petted: false,
          scolded: false, grooming: false, groomed: false,
          ate: 0, active: 0.3, threat: 0, homesick: 0,
          develop: 0,
          submerged: 0, heat: 0, ambientTemp: ambTemp, drank, basking: 0,
          sailDump: 0,
        });
        void before;
        if (b.health <= 0 || isDead(b, p.pheno)) {
          p.alive = false;
          world.events.push({ type: 'predatorDied', predator: p, t: world.time });
        }
      }
    }
  }
}
