// Body chemistry: drives, health, fear, age. Drives are needs in [0,1]
// (0 = fully satisfied, 1 = desperate). Gene-driven decay rates make each
// creature's temperament physically different.

export function createBiochem() {
  return {
    hunger: 0.25, // need for food
    energy: 0.9, // 1 = fully rested
    comfort: 0.8, // 1 = comfortable
    social: 0.5, // need for company
    fun: 0.5, // need for play
    fear: 0, // 0 = calm, 1 = terrified
    health: 1.0,
    age: 0, // seconds since hatching
  };
}

export function ageStage(b, pheno) {
  const t = b.age / pheno.lifespanSec;
  if (t < 0.07) return 'baby';
  if (t < 0.25) return 'child';
  if (t < 0.8) return 'adult';
  return 'senior';
}

// Size multiplier by life stage (babies are small, seniors slightly shrunken).
export function stageSize(stage) {
  return { baby: 0.45, child: 0.7, adult: 1.0, senior: 0.92 }[stage];
}

// ctx: { sleeping, playing, nearFriend, petted, scolded } — set by creature.
export function tickBiochem(b, pheno, dt, ctx = {}) {
  // Rates tuned for game feel: a full belly lasts a few minutes,
  // a full night's rest takes ~2 minutes of game time.
  const hungerRate = 0.004 + pheno.hungerRate * 0.014; // per second
  const drainRate = 0.003 + pheno.energyDrain * 0.009;

  b.hunger = clamp01(b.hunger + hungerRate * dt * (ctx.sleeping ? 0.6 : 1));
  if (ctx.sleeping) {
    b.energy = clamp01(b.energy + 0.09 * dt);
  } else {
    b.energy = clamp01(b.energy - drainRate * dt);
  }
  b.comfort = clamp01(b.comfort - 0.004 * dt + (ctx.petted ? 0.5 : 0));
  b.social = clamp01(b.social + 0.006 * dt - (ctx.nearFriend ? 0.05 * dt : 0));
  b.fun = clamp01(b.fun + 0.008 * dt - (ctx.playing ? 0.12 * dt : 0));

  if (ctx.scolded) {
    b.fear = clamp01(b.fear + 0.6);
    b.comfort = clamp01(b.comfort - 0.3);
  }
  b.fear = clamp01(b.fear - 0.25 * dt); // fear fades

  // Health: starvation and exhaustion hurt; contentment heals.
  let dh = 0;
  if (b.hunger > 0.9) dh -= 0.03;
  if (b.energy <= 0.01) dh -= 0.02;
  if (b.fear > 0.7) dh -= 0.01;
  if (dh === 0 && b.hunger < 0.6 && b.energy > 0.3) dh += 0.008;
  b.health = clamp01(b.health + dh * dt);

  b.age += dt;
}

export function isDead(b, pheno) {
  return b.health <= 0 || b.age >= pheno.lifespanSec;
}

// Dominant readable state for UI / behavior priority.
export function mood(b) {
  if (b.fear > 0.5) return 'afraid';
  if (b.health < 0.4) return 'sick';
  if (b.hunger > 0.75) return 'hungry';
  if (b.energy < 0.25) return 'tired';
  if (b.fun > 0.75) return 'bored';
  if (b.social > 0.75) return 'lonely';
  if (b.comfort < 0.4) return 'uncomfortable';
  return 'content';
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
