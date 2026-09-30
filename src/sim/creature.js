// A creature: genome + biochemistry + brain + body in the world.
// Per tick: sense → brain decides → act → learn from the outcome.

import { phenotype } from './genome.js';
import { createBiochem, tickBiochem, ageStage, stageSize, isDead, mood } from './biochem.js';
import { createBrain, decide, learn, senseVector } from './brain.js';

let nextId = 1;

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
    x,
    platformIndex,
    facing: rng.chance(0.5) ? 1 : -1,
    action: 'wander',
    actionLabel: 'wandering',
    sleeping: false,
    playing: false,
    nearFriend: false,
    sex: rng.chance(0.5) ? 'male' : 'female',
    parents: opts.parents || null,
    children: [],
    alive: true,
    wanderDir: 1,
    wanderTimer: 0,
    actionTimer: 0, // commitment to the current action (anti-dither)
    mateCooldown: 0,
    pettedFlag: false,
    scoldedFlag: false,
    hopPhase: rng.range(0, Math.PI * 2),
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
    if (o.id === excludeId || o.platformIndex !== platformIndex) continue;
    const d = Math.abs(o.x - x);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best ? { obj: best, dist: bestD / range, dir: Math.sign(best.x - x) || 1 } : null;
}

function gatherSenses(c, world) {
  const b = c.biochem;
  const food = nearest(world.foods, c.x, c.platformIndex, SENSE_RANGE);
  const other = nearest(world.creatures.filter((o) => o.alive), c.x, c.platformIndex, SENSE_RANGE, c.id);
  const toy = nearest([...world.toys, ...world.critters], c.x, c.platformIndex, SENSE_RANGE);
  const stage = ageStage(b, c.pheno);
  return {
    hunger: b.hunger,
    tiredness: 1 - b.energy,
    boredom: b.fun,
    loneliness: b.social,
    fear: b.fear,
    light: world.light,
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

function moveAlong(c, world, dir, dt, mult = 1) {
  const stage = ageStage(c.biochem, c.pheno);
  const speed = c.pheno.walkSpeed * stageSize(stage) * (stage === 'senior' ? 0.7 : 1) * mult;
  const plat = world.platforms[c.platformIndex];
  const r = creatureRadius(c);
  c.x += dir * speed * dt;
  if (c.x < plat.x1 + r) {
    c.x = plat.x1 + r;
    c.wanderDir *= -1;
  } else if (c.x > plat.x2 - r) {
    c.x = plat.x2 - r;
    c.wanderDir *= -1;
  }
  if (dir !== 0) c.facing = dir;
  c.hopPhase += dt * 10;
}

function moveToward(c, world, targetX, dt, mult = 1) {
  const dx = targetX - c.x;
  if (Math.abs(dx) < 4) return true; // arrived
  moveAlong(c, world, Math.sign(dx), dt, mult);
  return false;
}

function doEat(c, world) {
  const s = c._senses;
  const food = s._food && Math.abs(s._food.x - c.x) < EAT_RANGE ? s._food : null;
  if (!food) return false;
  const bite = Math.min(food.amount, 0.35);
  food.amount -= bite;
  c.biochem.hunger = Math.max(0, c.biochem.hunger - bite * 1.1);
  c.reward += 0.6; // eating feels good — reinforce whatever led here
  c.actionLabel = `eating ${food.kind}`;
  if (food.amount <= 0.01) {
    const i = world.foods.indexOf(food);
    if (i >= 0) world.foods.splice(i, 1);
  }
  return true;
}

function executeAction(c, world, dt, s) {
  const rng = world.rng;
  c.playing = false;
  switch (c.action) {
    case 'seekFood':
      c.actionLabel = 'looking for food';
      if (s._food) {
        if (moveToward(c, world, s._food.x, dt)) {
          c.actionTimer = 0; // arrived — choose what to do next
          doEat(c, world);
        }
      } else {
        c.action = 'wander';
        c.actionTimer = 0;
      }
      break;
    case 'eat':
      c.actionLabel = 'eating';
      if (!doEat(c, world)) {
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

export function updateCreature(c, world, dt) {
  if (!c.alive) return;
  const b = c.biochem;
  const pheno = c.pheno;
  const rng = world.rng;

  // While held by the player's hand: body chemistry continues, mind pauses.
  if (c.dragged) {
    tickBiochem(b, pheno, dt, {});
    if (isDead(b, pheno)) {
      c.alive = false;
      const oldAge = b.age >= pheno.lifespanSec;
      world.events.push({
        type: 'death', creature: c, t: world.time,
        cause: oldAge ? 'old age' : b.hunger > 0.9 ? 'starvation' : 'ill health',
      });
    }
    return;
  }

  // Waking: rested, or hunger overrides.
  if (c.sleeping && (b.energy > 0.92 || b.hunger > 0.85 || b.fear > 0.5)) {
    c.sleeping = false;
    c.actionTimer = 0; // choose something new on waking
  }

  c.nearFriend = false;
  tickBiochem(b, pheno, dt, {
    sleeping: c.sleeping,
    playing: c.playing,
    nearFriend: c.nearFriend,
    petted: c.pettedFlag,
    scolded: c.scoldedFlag,
  });
  c.pettedFlag = false;
  c.scoldedFlag = false;
  c.mateCooldown = Math.max(0, c.mateCooldown - dt);

  if (isDead(b, pheno)) {
    c.alive = false;
    const oldAge = b.age >= pheno.lifespanSec;
    world.events.push({
      type: 'death', creature: c, t: world.time,
      cause: oldAge ? 'old age' : b.hunger > 0.9 ? 'starvation' : 'ill health',
    });
    return;
  }

  c.reward = 0;
  if (!c.sleeping) {
    const s = gatherSenses(c, world);
    c._senses = s;
    const stage = ageStage(b, pheno);
    // Commit to an action for a stretch; only urgent needs interrupt.
    // (Re-deciding every tick causes jitter — the creature can never
    // actually walk to the food it wants.)
    c.actionTimer -= dt;
    const urgent = b.hunger > 0.8 || b.energy < 0.1 || b.fear > 0.55;
    if (c.actionTimer <= 0 || urgent) {
      const exploration = 0.22 * (stage === 'baby' ? 1.6 : 1) * (0.35 + pheno.boldness);
      const { action } = decide(c.brain, senseVector(s), exploration, rng);
      // Exhaustion overrides: a depleted creature should sleep.
      c.action = b.energy < 0.1 && action !== 'flee' ? 'sleep' : action;
      // Starving overrides: desperate hunger beats curiosity.
      if (b.hunger > 0.8 && (action === 'wander' || action === 'play' || action === 'approach')) {
        c.action = 'seekFood';
      }
      c.actionTimer = rng.range(0.8, 2.4) * (0.6 + pheno.boldness * 0.8);
    }
    executeAction(c, world, dt, s);
  } else {
    c.action = 'sleep';
    c.actionLabel = 'sleeping';
  }

  // Continuous shaping: satiety and rest feel good, suffering feels bad.
  c.reward += (0.5 - b.hunger) * 0.06 * dt;
  c.reward += (b.energy - 0.5) * 0.04 * dt;
  c.reward -= b.fear * 0.15 * dt;
  if (b.hunger > 0.9 || b.energy < 0.05) c.reward -= 0.1 * dt;

  learn(c.brain, pheno, Math.max(-1, Math.min(1, c.reward)));
  c.mood = mood(b);
}

// Player interactions.
export function petCreature(c) {
  if (!c.alive) return;
  c.pettedFlag = true;
  c.reward += 0.5;
  learn(c.brain, c.pheno, 0.5);
}

export function scoldCreature(c) {
  if (!c.alive) return;
  c.scoldedFlag = true;
  c.reward -= 0.7;
  learn(c.brain, c.pheno, -0.7);
}
