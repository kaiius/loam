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
    illness: 0, // 0 = healthy, 1 = gravely ill
    injury: 0, // v0.9: 0 = unhurt, 1 = badly wounded — the body records history
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
  // v0.6 morphology: fur insulates (slower drain), long legs burn more.
  const drainRate = (0.003 + pheno.energyDrain * 0.009)
    * (1 - (pheno.furInsulation || 0)) * (pheno.legDrainMult || 1);

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
  if (b.injury > 0.6) dh -= (b.injury - 0.6) * 0.05; // v0.9: severe wounds bleed health
  if (dh === 0 && b.hunger < 0.6 && b.energy > 0.3) dh += 0.008;
  b.health = clamp01(b.health + dh * dt);

  // Illness: a tug-of-war. The disease worsens on its own, fastest in the
  // frail; immunity fights it off — faster when rested and fed. A mild case
  // (0.35) in a low-immunity creature can therefore turn contagious (> 0.5)
  // and even lethal, while hardy creatures shake it off.
  // Serious illness damages health and saps energy.
  if (b.illness > 0) {
    const worsen = 0.008 * (1 - pheno.immunity);
    const recovery =
      (0.002 + pheno.immunity * 0.012) *
      (b.energy > 0.5 ? 1.4 : 1) *
      (b.hunger < 0.5 ? 1.3 : 1);
    b.illness = clamp01(b.illness + (worsen - recovery) * dt);
  }
  if (b.illness > 0.25) {
    b.health = clamp01(b.health - (b.illness - 0.25) * 0.06 * dt);
    b.energy = clamp01(b.energy - b.illness * 0.004 * dt);
  }

  // v0.9 injuries: the body records its history. Wounds heal with rest —
  // fast asleep, slow awake. Severe injury (> 0.6) drains health until
  // tended by sleep.
  if (b.injury > 0) {
    b.injury = clamp01(b.injury - (ctx.sleeping ? 0.03 : 0.006) * dt);
  }

  b.age += dt;
}

export function isDead(b, pheno) {
  return b.health <= 0 || b.age >= pheno.lifespanSec;
}

// Dominant readable state for UI / behavior priority.
export function mood(b) {
  if (b.fear > 0.5) return 'afraid';
  if (b.illness > 0.5) return 'sick';
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
