// A creature: genome + biochemistry + brain + body in the world.
// Per tick: sense → brain decides → act → learn from the outcome.

import { phenotype, markLocus } from './genome.js';
import { createBiochem, tickBiochem, ageStage, stageSize, isDead, mood } from './biochem.js';
import { createBrain, decide, learn, senseVector, ACTIONS } from './brain.js';
import { createMemory, writeEpisode, shouldWrite, recall, consolidate, OBSERVE_RANGE, OBSERVE_DISCOUNT } from './memory.js';
import { foundGrove, adoptTradition, traditionVotes, groveTarget, groveAim, fidelityOf, getTradition, GROVE_MEALS, GROVE_WINDOW, GROVE_RADIUS, GROVE_NEARBY } from './culture.js';
import { pedigreeKin, getBond, nudgeBond } from './social.js';
import { climbLinksFrom } from './world.js';

let nextId = 1;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// --- physics: the canopy has gravity now ---------------------------------
// y grows downward (screen space). Ground platform at y=800 spans the whole
// world, so every fall ends somewhere — there is no void below.
export const GRAVITY = 900; // px/s^2 — the world's own law, not a dice roll
export const MAX_FALL = 950; // terminal velocity px/s
export const FALL_HURT_V = 520; // land faster than this and it costs you
export const FALL_DMG = 1 / 900; // injury per px/s of impact past the threshold
export const JUMP_V_BASE = 260; // px/s upward at legPower 0
export const JUMP_V_GAIN = 420; // +px/s of launch at legPower 1
export const JUMP_RANGE_DY = 280; // highest ledge the jumpNear sense can see
export const JUMP_RANGE_DX = 220; // farthest sideways the jumpNear sense sees

const NAMES = [
  'Pip', 'Moss', 'Wren', 'Pebble', 'Fig', 'Nix', 'Bramble', 'Tansy',
  'Clover', 'Soot', 'Miso', 'Plum', 'Ash', 'Juniper', 'Sorrel', 'Dune',
  'Kiki', 'Bram', 'Lark', 'Mallow', 'Nettle', 'Oat', 'Puddle', 'Quill',
];

export function createCreature(genome, x, platformIndex, rng, opts = {}) {
  const pheno = phenotype(genome);
  return {
    kind: 'creature',
    id: nextId++,
    name: opts.name || rng.pick(NAMES),
    genome,
    pheno,
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
    // v0.9 embodiment: the body as honest display + record.
    bristling: false, // visible threat display (fear > 0.5) — bodies signal bodies
    flinchT: 0, // seconds since last injury — drives the flinch flash
    clashCooldown: 0, // per-creature refractory so spikes can't machine-gun
  };
}

export function creatureRadius(c) {
  return c.pheno.bodyRadius * stageSize(ageStage(c.biochem, c.pheno));
}

const SENSE_RANGE = 420;
const EAT_RANGE = 30;

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
  const toy = nearest([...world.toys, ...world.critters], c.x, c.platformIndex, range);
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
  return {
    _range: range, // px base for dist normalization (used by contagion/mating checks)
    hunger: b.hunger,
    tiredness: 1 - b.energy,
    boredom: b.fun,
    loneliness: b.social,
    fear: b.fear,
    illness: b.illness, // v0.8: the 15th sense — feeling sick is learnable
    light: world.light,
    homeDist: c.homeX !== undefined ? clamp01(Math.abs(c.x - c.homeX) / 800) : 0,
    kinNear: otherObj ? pedigreeKin(world, c, otherObj) : 0,
    bondNear: otherObj && world.bonds ? getBond(world.bonds, c, otherObj) : 0,
    climbUp, climbDown, jumpNear,
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
  };
}

function moveAlong(c, world, dir, dt, mult = 1, edge = 'turn') {
  const stage = ageStage(c.biochem, c.pheno);
  const sickSlow = c.biochem.illness > 0.5 ? 0.7 : 1; // illness saps strength
  // v0.9: wounds slow the body — the body's history constrains the soul.
  const injurySlow = 1 - 0.35 * c.biochem.injury;
  // v0.6 morphology: long legs = fast but fur is heavy.
  const morphSpeed = c.pheno.legSpeedMult * (1 - c.pheno.furWeight);
  const speed = c.pheno.walkSpeed * stageSize(stage) * (stage === 'senior' ? 0.7 : 1) * sickSlow * injurySlow * mult * morphSpeed;
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
export function stepPhysics(c, world, dt) {
  const plat = world.platforms[c.platformIndex];
  if (c.y === undefined || c.y === null) {
    // First tick: snap to the platform. (createCreature can't see the world.)
    // Position only — a jump or walk-off that fired earlier this same tick
    // already set grounded=false and a velocity; don't stomp the launch.
    c.y = plat.y;
    if (c.grounded) { c.vx = 0; c.vy = 0; }
  }
  if (c.grounded) {
    c.y = plat.y; // stand on the branch
    c.vy = 0;
    return;
  }
  // Airborne: gravity integrates.
  const prevY = c.y;
  c.vy = Math.min(MAX_FALL, c.vy + GRAVITY * dt);
  c.x += c.vx * dt;
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
}

// Touchdown: hard landings cost injury, startle, and a flinch the painter
// shows. Soft landings are just Tuesday.
function land(c, world, impact) {
  if (impact <= FALL_HURT_V) return;
  const b = c.biochem;
  const excess = impact - FALL_HURT_V;
  b.injury = clamp01(b.injury + excess * FALL_DMG);
  b.adrenaline = clamp01(b.adrenaline + 0.35); // the landing startles
  c.flinchT = 0.45;
  c.reward -= 0.25;
  world.events.push({ type: 'hardLanding', creature: c, impact: Math.round(impact), t: world.time });
}

function moveToward(c, world, targetX, dt, mult = 1) {
  const dx = targetX - c.x;
  if (Math.abs(dx) < 4) return true; // arrived
  moveAlong(c, world, Math.sign(dx), dt, mult, 'fall'); // directed feet can walk off
  return false;
}

export function doEat(c, world) {
  const s = c._senses;
  const food = s._food && Math.abs(s._food.x - c.x) < EAT_RANGE ? s._food : null;
  if (!food) return false;
  // v0.6 morphology: bite size from mouthSize gene; fruit efficiency from diet.
  // v0.7: meat efficiency — carcasses feed carnivores at full value.
  const bite = Math.min(food.amount, c.pheno.biteSize);
  food.amount -= bite;
  const eff = food.foodKind === 'meat' ? c.pheno.meatEfficiency : c.pheno.fruitEfficiency;
  // v0.8: medicinal leaves. Bitter and barely nutritious, but they purge
  // illness — self-medication. The illness reward term (below) makes recovery
  // reinforcing, so the brain learns: sick → seek leaf → feel better.
  if (food.foodKind === 'leaf') {
    const wasSick = c.biochem.illness > 0.25;
    c.biochem.illness = Math.max(0, c.biochem.illness - 0.4);
    // Bitter medicine: barely nutritious (small ate), powerfully purging.
    c._ate = (c._ate || 0) + bite * 0.3 * eff;
    c.actionLabel = 'chewing bitter leaf';
    // Bitter when well, medicine when sick — the differential that teaches
    // self-medication. A healthy creature finds leaves meh; a sick one that
    // chews a leaf feels better, and the brain (which senses illness) learns
    // the conditional.
    c.reward += wasSick ? 0.6 : 0.15;
  } else {
    // Food becomes blood sugar via the chemistry tick (c._ate is consumed
    // by tickBiochem before the next action) — the body, not the action,
    // decides what a meal means.
    c._ate = (c._ate || 0) + bite * 1.1 * eff;
    c.actionLabel = `eating ${food.foodKind === 'meat' ? 'meat' : 'fruit'}`;
    c.reward += 0.6; // eating feels good — reinforce whatever led here
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

function executeAction(c, world, dt, s) {
  const rng = world.rng;
  c.playing = false;
  c.grooming = false; // set by the groom action — consumed by tickBiochem
  c._active = 0; // exertion this tick — consumed by tickBiochem
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
      const other = s._other;
      const otherStage = other ? ageStage(other.biochem, other.pheno) : null;
      const ok = other && (stage === 'adult') && (otherStage === 'adult') &&
        other.sex !== c.sex && c.mateCooldown <= 0 && other.mateCooldown <= 0;
      if (ok) {
        if (moveToward(c, world, other.x, dt, 0.9) && Math.abs(other.x - c.x) < 50) {
          world.tryMate(c, other);
        }
      } else if (other) {
        moveToward(c, world, other.x, dt, 0.8);
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
        world.events.push({ type: 'jumped', creature: c, t: world.time });
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
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

  // While held by the player's hand: body chemistry continues, mind pauses.
  if (c.dragged) {
    tickBiochem(b, pheno, dt, {});
    if (isDead(b, pheno)) {
      c.alive = false;
      const oldAge = b.age >= pheno.lifespanSec;
      world.events.push({
        type: 'death', creature: c, t: world.time,
        cause: oldAge ? 'old age' : b.illness > 0.6 ? 'illness' : b.hunger > 0.9 ? 'starvation' : 'ill health',
      });
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
  // Meals: doEat accumulated c._ate during last tick's action — the chemistry
  // converts it to blood sugar now.
  const ate = c._ate || 0;
  c._ate = 0;
  tickBiochem(b, pheno, dt, {
    sleeping: c.sleeping,
    playing: c.playing,
    nearFriend: wasNearFriend,
    petted: c.pettedFlag,
    scolded: c.scoldedFlag,
    grooming: wasGrooming,
    groomed: wasGroomed,
    ate,
    active: c._active || 0,
  });
  c.pettedFlag = false;
  c.scoldedFlag = false;
  c.mateCooldown = Math.max(0, c.mateCooldown - dt);

  if (isDead(b, pheno)) {
    c.alive = false;
    const oldAge = b.age >= pheno.lifespanSec;
    world.events.push({
      type: 'death', creature: c, t: world.time,
      cause: oldAge ? 'old age' : b.illness > 0.6 ? 'illness' : b.hunger > 0.9 ? 'starvation' : 'ill health',
    });
    return;
  }

  c.reward = 0;
  if (!c.sleeping) {
    c.sleepTicks = 0;
    const s = gatherSenses(c, world);
    c._senses = s;

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
      // Starving overrides: desperate hunger beats curiosity — and
      // homesickness (v0.12: seekHome joins the override list).
      if (b.hunger > 0.8 && (action === 'wander' || action === 'play' || action === 'approach' || action === 'seekHome')) {
        c.action = 'seekFood';
      }
      // Breeding opportunity (v0.5): a lonely adult that senses a nearby adult
      // of the opposite sex courts instead of dithering. Without this backstop
      // the mate drive lost to play/wander often enough that lineages went
      // extinct. Survival drives above still take precedence.
      const partner = s._other;
      const partnerAdult = partner && ageStage(partner.biochem, partner.pheno) === 'adult';
      if (
        stage === 'adult' && partnerAdult && partner.sex !== c.sex &&
        s.creatureDist * s._range < 240 &&
        c.mateCooldown <= 0 && partner.mateCooldown <= 0 &&
        (c.action === 'wander' || c.action === 'play' || c.action === 'approach' || c.action === 'seekHome')
      ) {
        c.action = 'mate';
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

  learn(c.brain, pheno, Math.max(-1, Math.min(1, c.reward)));
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
    c.pheno = phenotype(c.genome); // marks change expression — refresh
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
  learn(c.brain, c.pheno, 0.5);
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
  learn(c.brain, c.pheno, -0.7);
  // Being scolded is a salient social event — remember it.
  if (c.brain.lastInput) {
    writeEpisode(c.memory, {
      input: c.brain.lastInput, action: ACTIONS.indexOf(c.action),
      reward: -0.7, tick: 0, kind: 'lived', critical: false,
    });
  }
}
