// Body chemistry: chemicals in, drives out, health, fear, age.
//
// Drives are needs in [0,1] (0 = fully satisfied, 1 = desperate) — but they
// are COMPUTED from a chemical network, not stored directly. Eating produces
// blood sugar; living burns it. Company produces oxytocin; solitude lets it
// decay. Gene-driven rates make each creature's temperament physically
// different. The drive fields keep their v0.12 names and pacing so the
// brain, UI, and QA baselines keep working — what's new is that they're
// readouts of chemistry, not the chemistry itself.

export function createBiochem() {
  return {
    // chemicals — the actual body state
    bloodSugar: 0.75, // fuel; eating produces it, living burns it
    fatigue: 0.1, // accumulates while awake, clears while sleeping
    oxytocin: 0.5, // rises with grooming and bonded company, decays
    endorphin: 0.5, // rises with play, decays
    adrenaline: 0, // spikes on fear events, decays fast
    // drives — computed readouts (refreshed every tick)
    hunger: 0.25, // need for food
    energy: 0.9, // 1 = fully rested
    comfort: 0.8, // 1 = comfortable
    social: 0.5, // need for company
    fun: 0.5, // need for play
    fear: 0, // 0 = calm, 1 = terrified
    health: 1.0,
    illness: 0, // 0 = healthy, 1 = gravely ill
    injury: 0, // 0 = unhurt, 1 = badly wounded — the body records history
    age: 0, // seconds since birth
  };
}

export function ageStage(b, pheno) {
  // v2 (L): maturation stretches or compresses the juvenile stages.
  const m = 0.5 + (pheno.matTime ?? 0.5); // founder → ×1.0
  const t = b.age / pheno.lifespanSec;
  if (t < 0.07 * m) return 'baby';
  if (t < 0.25 * m) return 'child';
  if (t < 0.8) return 'adult';
  return 'senior';
}

// Size multiplier by life stage (babies are small, seniors slightly shrunken).
export function stageSize(stage) {
  return { baby: 0.45, child: 0.7, adult: 1.0, senior: 0.92 }[stage];
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ctx: { sleeping, playing, nearFriend, petted, scolded,
//        grooming, groomed, ate (0..1 food value this tick),
//        active (0..1 exertion), threat (0..1) } — set by creature.
export function tickBiochem(b, pheno, dt, ctx = {}) {
  // --- chemistry ---------------------------------------------------------
  // Fuel: eating fills the tank, living drains it. A full belly lasts a
  // few minutes — the same pacing as v0.12, now as a chemical.
  const hungerRate = 0.004 + pheno.hungerRate * 0.014; // per second
  const exert = ctx.sleeping ? 0.6 : (0.5 + (ctx.active ?? 0.6) * 0.5);
  b.bloodSugar = clamp01(b.bloodSugar + (ctx.ate ?? 0) * 0.9 - hungerRate * dt * exert);

  // Fatigue: sleep clears it, waking life accumulates it. Fur insulates
  // (slower drain), long legs burn more — the v0.6 morphology tradeoffs.
  const drainRate = (0.003 + pheno.energyDrain * 0.009)
    * (1 - (pheno.furInsulation || 0)) * (pheno.legDrainMult || 1);
  if (ctx.sleeping) {
    b.fatigue = clamp01(b.fatigue - 0.09 * dt);
  } else {
    b.fatigue = clamp01(b.fatigue + drainRate * dt);
  }

  // Oxytocin: the bonding chemical. Grooming is the troop's ritual —
  // giving and receiving both bond. Mere company helps; solitude starves it.
  const bondRate = 0.05 + (pheno.sociability ?? 0.5) * 0.04;
  b.oxytocin = clamp01(b.oxytocin
    + (ctx.grooming ? 0.25 * dt : 0)
    + (ctx.groomed ? 0.35 * dt : 0)
    + (ctx.nearFriend ? bondRate * dt : 0)
    - 0.006 * dt);

  // Endorphin: play is its own reward, chemically.
  b.endorphin = clamp01(b.endorphin + (ctx.playing ? 0.12 * dt : 0) - 0.008 * dt);

  // Adrenaline: fear spikes, then fades fast.
  if (ctx.scolded) b.adrenaline = clamp01(b.adrenaline + 0.6);
  if (ctx.threat) b.adrenaline = clamp01(b.adrenaline + ctx.threat * 0.8);
  b.adrenaline = clamp01(b.adrenaline - 0.25 * dt);

  // Comfort stays direct: touch soothes, scolding wounds.
  b.comfort = clamp01(b.comfort - 0.004 * dt + (ctx.petted ? 0.5 : 0));
  if (ctx.scolded) b.comfort = clamp01(b.comfort - 0.3);

  // --- v2 (R): evolvable chemical reactions --------------------------------
  // Each reaction gene converts substrate→product above its threshold at
  // its rate. MASS-CONSERVING: the transfer is bounded by both what the
  // substrate holds and what the product can take — chemistry rearranges,
  // never creates or destroys. Founder rates are near-zero: quiet
  // chemistry that evolution can turn up.
  for (let i = 0; i < 8; i++) {
    const sub = pheno[`rx${i}sub`];
    const thr = pheno[`rx${i}thr`] ?? 0.5;
    const subV = b[sub];
    if (subV === undefined || subV <= thr) continue;
    const prod = pheno[`rx${i}prod`];
    const rate = pheno[`rx${i}rate`] ?? 0;
    if (rate <= 0 || sub === prod) continue;
    const move = Math.min(rate * (subV - thr) * dt, subV, 1 - b[prod]);
    if (move > 0) {
      b[sub] = subV - move;
      b[prod] = b[prod] + move; // bounded by (1 − prod) above: no clamp needed
    }
  }

  // --- drives computed from chemistry ------------------------------------
  // v2 (D): gain + baseline tune the readout. The chemistry invariant
  // stands — drives are still readouts of the five chemicals; the tuning
  // is genetic. Founder defaults are the identity (gain 1, baseline 0).
  const dg = (d) => pheno['driveGain' + d] ?? 1;
  const db = (d) => pheno['driveBase' + d] ?? 0;
  b.hunger = clamp01((1 - b.bloodSugar) * dg('Hunger') + db('Hunger'));
  b.energy = clamp01((1 - b.fatigue) * dg('Energy') + db('Energy'));
  b.social = clamp01((1 - b.oxytocin) * dg('Social') + db('Social'));
  b.fun = clamp01((1 - b.endorphin) * dg('Fun') + db('Fun'));
  b.fear = clamp01(b.adrenaline * dg('Fear') + db('Fear'));

  // --- health --------------------------------------------------------------
  // Health: starvation and exhaustion hurt; contentment heals.
  let dh = 0;
  if (b.hunger > 0.9) dh -= 0.03;
  if (b.energy <= 0.01) dh -= 0.02;
  if (b.fear > 0.7) dh -= 0.01;
  if (b.injury > 0.6) dh -= (b.injury - 0.6) * 0.05; // severe wounds bleed health
  // v2 (L): life history writes on health — lifelong frailty (longAging)
  // plus programmed senescence after senOnset. Both off at founder defaults.
  const longAging = pheno.longAging ?? 0;
  if (longAging > 0) dh -= longAging * 0.002;
  const senRate = pheno.senRate ?? 0;
  if (senRate > 0) {
    const ageFrac = b.age / (pheno.lifespanSec || 1);
    const onset = pheno.senOnset ?? 0.8;
    if (ageFrac > onset) dh -= senRate * 0.03 * (ageFrac - onset);
  }
  if (dh === 0 && b.hunger < 0.6 && b.energy > 0.3) dh += 0.008;
  b.health = clamp01(b.health + dh * dt);

  // Illness: a tug-of-war. The disease worsens on its own, fastest in the
  // frail; immunity fights it off — faster when rested and fed.
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
    b.fatigue = clamp01(b.fatigue + b.illness * 0.004 * dt); // sickness exhausts
  }

  // Injuries: the body records its history. Wounds heal with rest —
  // fast asleep, slow awake.
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
