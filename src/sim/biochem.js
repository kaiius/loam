// Body chemistry: chemicals in, drives out, health, fear, age.
//
// Drives are needs in [0,1] (0 = fully satisfied, 1 = desperate) — but they
// are COMPUTED from a chemical network, not stored directly. Eating produces
// blood sugar; living burns it. Company produces oxytocin; solitude lets it
// decay. Gene-driven rates make each creature's temperament physically
// different. The drive fields keep their v0.12 names and pacing so the
// brain, UI, and QA baselines keep working — what's new is that they're
// readouts of chemistry, not the chemistry itself.
//
// v0.18 "Realms": seven chemicals (oxygen, hydration join the five).
// thirst/cold/heat are SENSES, not drives — the chemistry invariant holds:
// drives are readouts of chemicals; hazards are chemicals and body states.

import { gateMultiplier, hasActiveGates } from './gates.js';

// v0.27 "Seasons": panting constants — the evaporative-cooling reflex.
// PANT_COOL_K: coreTemp drop per second at full pant (pant01 = 1).
// PANT_WATER_K: hydration drain per second at full pant. Sized so a
// pantCapacity-0.8 vulture holds a plains summer (~0.75 eq, under the 0.83
// hyper threshold) while a pantCapacity-0 random founder barely notices
// (the v0.18 §13.6 heatstroke probe still crosses 0.80 in-window).
export const PANT_COOL_K = 0.006;
export const PANT_WATER_K = 0.02;

export function createBiochem() {
  return {
    // chemicals — the actual body state
    bloodSugar: 0.75, // fuel; eating produces it, living burns it
    fatigue: 0.1, // accumulates while awake, clears while sleeping
    oxytocin: 0.5, // rises with grooming and bonded company, decays
    endorphin: 0.5, // rises with play, decays
    adrenaline: 0, // spikes on fear events, decays fast
    oxygen: 1, // v0.18: breath — drains while submerged (~25s of air at founder)
    hydration: 0.8, // v0.18: body water — drains with heat × exertion
    // v0.37 "Affect": the emotion chemicals — design/affect-expansion.md.
    // Chemicals in, drives out: each is analytic (no per-tick RNG), 0..1,
    // clamp01'd. Founder rates reproduce the old inner life exactly (all
    // new drives read ~0 at founder defaults) — the expansion adds rooms,
    // it doesn't renovate the foundation.
    sexHormone: 0, // libido substrate — rises at maturation, seasonal, mate-primed
    zest: 0, // reward-prediction — excitement/joy, brief by design
    serotonin: 0.5, // long-horizon mood — the depression substrate (hours, not seconds)
    vasopressin: 0, // pair-bond specificity — the vole steal (romantic love substrate)
    prolactin: 0, // parental care — family love substrate
    stimulus: 0, // novelty — the interest/curiosity substrate
    // body states — not chemicals, not drives
    coreTemp: 0.5, // v0.18: 0..1, 0.5 neutral — drifts toward ambient
    // drives — computed readouts (refreshed every tick)
    hunger: 0.25, // need for food
    energy: 0.9, // 1 = fully rested
    comfort: 0.8, // 1 = comfortable
    social: 0.5, // need for company
    fun: 0.5, // need for play
    fear: 0, // 0 = calm, 1 = terrified
    libido: 0, // v0.37: need for sexual release/mating (0 for juveniles)
    curiosity: 0.5, // v0.37: need for novelty
    attachment: 0, // v0.37: longing for the pair-bonded partner (0 without one)
    care: 0, // v0.37: need to tend young
    health: 1.0,
    healthDrainCause: null, // v0.32: last source that drained health — the death ledger reads this instead of 'ill health'
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

// v0.32 "Nervous system" fold-in (Bart's lab-hygiene finding): every health
// drain stamps its source, so the death ledger names a real cause instead
// of the 'ill health' confession of ignorance. The ledger reads
// b.healthDrainCause when no specific threshold (illness/hunger/injury)
// tripped — it names the last thing that was actually killing the creature.
function drainHealth(b, amount, cause) {
  if (amount > 0) {
    b.health = clamp01(b.health - amount);
    b.healthDrainCause = cause;
  }
}
// v0.18: context hygiene — a non-finite ctx value falls back to its default
// instead of poisoning the body (the v0.15 NaN lesson).
function cf(v, dflt) {
  return Number.isFinite(v) ? v : dflt;
}
function cf01(v, dflt) {
  const x = Number.isFinite(v) ? v : dflt;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ctx: { sleeping, playing, nearFriend, petted, scolded,
//        grooming, groomed, ate (0..1 food value this tick),
//        active (0..1 exertion), threat (0..1) } — set by creature.
export function tickBiochem(b, pheno, dt, ctx = {}) {
  // --- ctx hygiene ---------------------------------------------------------
  // v0.18 (the v0.15 NaN lesson): normalize every context input once, up
  // front. A non-finite value falls back to its default instead of
  // poisoning the body — Math.max/Math.min-style clamps pass NaN straight
  // through, so the guard has to happen here, before any arithmetic.
  ctx = {
    sleeping: !!ctx.sleeping,
    playing: !!ctx.playing,
    nearFriend: !!ctx.nearFriend,
    petted: !!ctx.petted,
    scolded: !!ctx.scolded,
    grooming: !!ctx.grooming,
    groomed: !!ctx.groomed,
    ate: cf(ctx.ate, 0),
    active: cf(ctx.active, 0.6),
    threat: cf(ctx.threat, 0),
    homesick: cf(ctx.homesick, 0),
    develop: cf(ctx.develop, 0),
    submerged: cf01(ctx.submerged, 0),
    heat: cf01(ctx.heat, 0),
    drank: cf01(ctx.drank, 0),
    ambientTemp: cf(ctx.ambientTemp, 0.5),
    basking: cf01(ctx.basking, 0),
    sailDump: cf01(ctx.sailDump, 0),
    cloud: cf01(ctx.cloud, 0), // v0.25 "Heat": overcast shades the basker
    seasonSun: cf(ctx.seasonSun, 1), // v0.27 "Seasons": seasonal insolation 0.2..1
    daySun: cf(ctx.daySun, 1), // v0.28 "Day and night": diurnal insolation 0..1
    // v0.37 "Affect": the emotion context — design/affect-expansion.md §1.
    mated: !!ctx.mated, // mating concluded this tick (refractory drop)
    mateNear: !!ctx.mateNear, // a valid mate sensed (priming)
    groomBondedMate: !!ctx.groomBondedMate, // grooming a bonded opposite-sex partner
    groomPair: !!ctx.groomPair, // grooming the pair-bonded partner
    nearPairContent: !!ctx.nearPairContent, // near pair-bonded partner while content
    matedInfidelity: !!ctx.matedInfidelity, // mated a different partner (bond price)
    offspringNear: cf01(ctx.offspringNear, 0), // own young (baby/child kin) in sense range
    gaveBirth: !!ctx.gaveBirth, // birth event this tick
    grieving: !!ctx.grieving, // grief timer active (prolactin decay ×4)
    novelty: !!ctx.novelty, // novelty event this tick (sense-delta/dt over threshold)
    rewardDelta: cf(ctx.rewardDelta, 0), // this tick's reward minus slow moving average
    partnerAbsent: cf01(ctx.partnerAbsent, 0), // pair-bonded but partner not near
    offspringNeed: cf01(ctx.offspringNeed, 0), // nearby own young's need (hunger/distress)
    seasonBreed: cf(ctx.seasonBreed, 1), // seasonal fertility curve (same as tryMate's)
    displayWatched: !!ctx.displayWatched, // watching a display primes sexHormone
  };
  // --- chemistry ---------------------------------------------------------
  // Fuel: eating fills the tank, living drains it. A full belly lasts a
  // few minutes — the same pacing as v0.12, now as a chemical.
  // v0.17 "Bauplan": ctx.develop — juveniles growing novel structures burn
  // extra fuel. It enters as a hungerRate term, not a new chemical: drives
  // stay readouts of the seven chemicals.
  // v0.25 "Heat": thermoregulation burns fuel — far from thermal neutral
  // the body works to hold its temperature, billed through hungerRate
  // (blood sugar), NOT fatigue: a hot vulture eats more corpse, it doesn't
  // forget how to sleep. (Fatigue billing created a death spiral:
  // tired → low energy → less sleep → more flapping → metabolic heat →
  // hyperthermia.) Comfort band [0.35, 0.65]; beyond it the fuel burn
  // rises linearly. In warmth, fur traps heat and the furry pay more; in
  // cold, fur IS the adaptation (no surcharge) — selection's handle on fur.
  const ambT = clamp01(ctx.ambientTemp);
  const dev = Math.abs(ambT - 0.5);
  const furTrap = ambT > 0.5 ? 1 + (pheno.furInsulation || 0) / 0.3 : 1;
  const regFuel = dev > 0.15 ? (dev - 0.15) * 0.02 * furTrap : 0;
  const hungerRate = 0.004 + pheno.hungerRate * 0.014 + (ctx.develop || 0) + regFuel; // per second
  const exert = ctx.sleeping ? 0.6 : (0.5 + (ctx.active ?? 0.6) * 0.5);
  b.bloodSugar = clamp01(b.bloodSugar + (ctx.ate ?? 0) * 0.9 - hungerRate * dt * exert);

  // Fatigue: sleep clears it, waking life accumulates it. Fur insulates
  // (slower drain), long legs burn more — the v0.6 morphology tradeoffs.
  // v0.37 "Affect": the depressed regime halves energy recovery — the
  // tiredness that sleep doesn't fix (design §3.1).
  const drainRate = (0.003 + pheno.energyDrain * 0.009)
    * (1 - (pheno.furInsulation || 0)) * (pheno.legDrainMult || 1);
  if (ctx.sleeping) {
    b.fatigue = clamp01(b.fatigue - 0.09 * (b.serotonin < 0.35 ? 0.5 : 1) * dt);
  } else {
    // v0.18: hypothermia doubles fatigue gain — the cold exhausts.
    const hypoGain = b.coreTemp < (0.25 - (pheno.coldTol ?? 0.5) * 0.1) ? 2 : 1;
    // v0.23 "Weather": wet fur costs heat — drying is metabolic work, billed
    // through fatigue so shelter-seeking has a real price.
    const wetDrain = (ctx.wet01 || 0) * 0.006;
    b.fatigue = clamp01(b.fatigue + (drainRate * hypoGain + wetDrain) * dt);
  }

  // Oxytocin: the bonding chemical. Grooming is the troop's ritual —
  // giving and receiving both bond. Mere company helps; solitude starves it.
  // v0.37 "Affect": anhedonia — the depressed regime halves the yield
  // (design §3.1). The chemistry, not the behavior, goes quiet.
  const anhed = b.serotonin < 0.35 ? 0.5 : 1;
  const bondRate = 0.05 + (pheno.sociability ?? 0.5) * 0.04;
  b.oxytocin = clamp01(b.oxytocin
    + (ctx.grooming ? 0.25 * anhed * dt : 0)
    + (ctx.groomed ? 0.35 * anhed * dt : 0)
    + (ctx.nearFriend ? bondRate * dt : 0)
    - 0.006 * dt);

  // Endorphin: play is its own reward, chemically. v0.37: anhedonia halves
  // the play yield in the depressed regime.
  b.endorphin = clamp01(b.endorphin + (ctx.playing ? 0.12 * anhed * dt : 0) - 0.008 * dt);

  // Adrenaline: fear spikes, then fades fast.
  if (ctx.scolded) b.adrenaline = clamp01(b.adrenaline + 0.6);
  if (ctx.threat) b.adrenaline = clamp01(b.adrenaline + ctx.threat * 0.8);
  b.adrenaline = clamp01(b.adrenaline - 0.25 * dt);

  // --- v0.37 "Affect": the emotion chemistry --------------------------------
  // design/affect-expansion.md §1. All analytic (no per-tick RNG — the
  // rng-boundary probe's affect arm asserts the chemistry never touches
  // decorRng). Every rate is clamp01'd. Founder rates reproduce the old
  // inner life: the new drives read ~0 until events move the chemicals.
  const shr = 0.5 + (pheno.sexHormoneRate ?? 0.5); // synthesis gain locus
  const srr = 0.5 + (pheno.serotoninRate ?? 0.5); // long-horizon gain locus
  const pbr = 0.5 + (pheno.pairBondRate ?? 0.5); // pair-bond gain locus
  // sexHormone: the libido substrate. Rises at maturation (analytic ramp
  // over the juvenile→adult transition), with the seasonal fertility curve,
  // mate-sight priming, and the social→sexual bridge (grooming a bonded
  // opposite-sex partner). Refractory drop after mating spaces births.
  // MASS: synthesis is a trace metabolic cost billed through hungerRate
  // (below) — the ledger's own discipline says chemical concentrations are
  // energy/state, not mass ("their mass was booked at the bite"), so no
  // ledger flow. bloodSugar is the GATE (synthesis × (1 − hunger)): a
  // starving creature's hormone synthesis collapses because the gate
  // closes, not because mass vanishes. The 10k-tick ledger probe must show
  // zero drift from this path (Gemini P0, fixed in the spec).
  const adultFrac = b.age / (pheno.lifespanSec || 1);
  const matured = adultFrac >= 0.25 ? 1 : adultFrac / 0.25; // juvenile→adult ramp
  const shGate = 1 - b.hunger; // starving bodies don't synthesize
  b.sexHormone = clamp01(b.sexHormone
    + 0.008 * matured * ctx.seasonBreed * shr * shGate * dt // the slow ramp
    + (ctx.mateNear ? 0.1 * dt : 0) // the body noticing before the brain decides
    + (ctx.groomBondedMate ? 0.05 * dt : 0)
    + (ctx.displayWatched ? 0.05 * dt : 0) // priming — the honest-signal tax, paid by the watcher
    - 0.004 * dt
    - (ctx.mated ? 0.6 : 0)); // refractory — the post-coital spacing
  // zest: positive surprise made chemical. Rises only on reward DELTA vs a
  // slow moving average (the governor — as the average catches up the delta
  // dies even if play continues), so a creature cannot excite itself into
  // permanent railed zest. Fast decay: excitement is brief by design.
  // Pure signal, no ledger flow (adrenaline precedent).
  if (ctx.rewardDelta > 0) b.zest = clamp01(b.zest + ctx.rewardDelta);
  b.zest = clamp01(b.zest - 0.05 * dt);
  // serotonin: the slow variable (hours, not seconds). Sustained
  // contentment builds it; sustained distress erodes it — bad times write
  // faster than good times (the empirical asymmetry). Below 0.35 the
  // creature enters the depressed regime (§3.1, in the drives section).
  // Pure signal, no ledger flow.
  const contentNow = b.hunger < 0.4 && (1 - b.fatigue) > 0.6 && b.social < 0.4 && b.fun < 0.4 && b.fear < 0.4;
  const distressNow = b.fear > 0.6 || b.hunger > 0.8 || b.illness > 0.5;
  if (contentNow) b.serotonin = clamp01(b.serotonin + 0.0001 * srr * dt);
  if (distressNow) b.serotonin = clamp01(b.serotonin - 0.0003 * srr * dt);
  // vasopressin: specific attachment (the vole steal). Rises on mating
  // with the same partner and quiet time together; infidelity halves the
  // strongest pair bond (the price of exclusivity — design §8d). Decays
  // over days. Pure signal, no ledger flow.
  b.vasopressin = clamp01(b.vasopressin
    + (ctx.mated && !ctx.matedInfidelity ? 0.3 * pbr : 0)
    + (ctx.groomPair ? 0.02 * pbr * dt : 0)
    + (ctx.nearPairContent ? 0.01 * pbr * dt : 0)
    - 0.0002 * dt
    - (ctx.matedInfidelity ? b.vasopressin * 0.5 : 0));
  // prolactin: parental care. Rises on contact with own young and at birth;
  // decays continuously (no global "are any offspring alive" scan — without
  // contact the decay does the letting-go by itself). Offspring death
  // accelerates the decay (×4 while grieving) rather than collapsing the
  // value (Gemini P1, fixed in the spec). Pure signal; the tend food
  // transfer books mass via the existing doEat/ledger path.
  b.prolactin = clamp01(b.prolactin
    + ctx.offspringNear * 0.05 * dt
    + (ctx.gaveBirth ? 0.4 : 0)
    - 0.002 * (ctx.grieving ? 4 : 1) * dt);
  // stimulus: novelty made chemical. Rises on novelty events (the sense
  // vector's frame-to-frame delta normalized by dt — Paul §5.4 — over
  // threshold, computed in creature.js from the nerve delay buffer).
  // Decays in ~100s: the world goes stale without new input.
  // Pure signal, no ledger flow.
  if (ctx.novelty) b.stimulus = clamp01(b.stimulus + 0.3);
  b.stimulus = clamp01(b.stimulus - 0.01 * dt);
  // NOTE (Gemini P0, v0.37 review): the hormone synthesis cost is REMOVED.
  // The spec §1.1 asked for a metabolic cost, but the ledger's discipline
  // says chemical concentrations are out of the books ("their mass was
  // booked at the bite"). A bloodSugar drain here would dissolve a parent
  // standing near its young (0.54 mass over a lifespan). The honest cost
  // of emotion is in BEHAVIOR: display burns fuel via _active, tending
  // transfers food via doEat, grief slows via the regime. No ledger flow.

  // --- v0.18 "Realms": the survival chemistry --------------------------------
  // Every ctx term below was normalized up front (see ctx hygiene) — all
  // are finite here. Every new term is clamp01'd.
  const sub01 = ctx.submerged; // 1 = fully submerged
  const heat01 = ctx.heat; // ambientHeat 0..1 (desert interior)
  const drank01 = ctx.drank; // 0..1 drinking this tick
  const active01 = ctx.active; // exertion 0..1
  const ambient = clamp01(ctx.ambientTemp); // 0..1, 0.5 neutral
  const basking01 = ctx.basking; // basking in warmth this tick
  const sailDump01 = ctx.sailDump; // sail as heat radiator

  // Oxygen: drains while submerged (~25s of air at founder breathTime 30),
  // refills fast in air. Gills (breathTime) stretch the dive honestly —
  // founder ×1.0, so the control group is untouched. At 0: health drains
  // and adrenaline spikes — drowning is terrifying, and fear already knows
  // what to do with it.
  const breathTime = Math.max(1, pheno.breathTime ?? 30);
  if (sub01 > 0) {
    b.oxygen = clamp01(b.oxygen - 0.04 * (30 / breathTime) * sub01 * dt);
  } else {
    b.oxygen = clamp01(b.oxygen + 0.5 * dt);
  }
  const drowning = b.oxygen <= 0.001;
  if (drowning) {
    drainHealth(b, 0.03 * dt, 'drowning');
    b.adrenaline = clamp01(b.adrenaline + 0.9 * dt);
  }

  // Hypo/hyperthermia thresholds shift with the thermal-tolerance loci —
  // hoisted above hydration and coreTemp because the panting reflex reads
  // the hyperthermia threshold.
  const hypoThr = 0.25 - (pheno.coldTol ?? 0.5) * 0.1;
  const hyperThr = 0.75 + (pheno.heatTol ?? 0.5) * 0.1;
  // v0.27 "Seasons": panting — the evaporative-cooling reflex (urohidrosis /
  // panting analog). Active, not passive: it fires only as coreTemp climbs
  // toward the hyperthermia threshold, ramping over the top 0.15 below it,
  // gated by the pantCapacity body-plan locus. It bills WATER (hydration),
  // not fuel — and no water means no panting (a dehydrated animal cannot
  // evaporate what it doesn't have). The economics: water-for-cooling, paid
  // at the waterhole by creatures that drink.
  const pantCap = clamp01(pheno.pantCapacity ?? 0);
  const pantStress = clamp01((b.coreTemp - (hyperThr - 0.15)) / 0.15);
  const pant01 = pantCap * pantStress * (b.hydration > 0.001 ? 1 : 0);

  // Hydration: drains with heat × exertion — base ~0.004/s, up to ~0.02/s
  // hot and sprinting. ctx.drank restores it; fruit is mostly water, so
  // eating (ctx.ate) restores a little too — the founder-neutral hydration
  // source that keeps the jungle control group viable without teaching it
  // to drink in four minutes. Panting evaporates body water on top.
  // At 0: dehydration drains health.
  const hydroRate = 0.004 + 0.016 * heat01 * exert + pant01 * PANT_WATER_K;
  b.hydration = clamp01(b.hydration - hydroRate * dt + drank01 * 0.3 + (ctx.ate ?? 0) * 0.5);
  const dehydrated = b.hydration <= 0.001;
  if (dehydrated) drainHealth(b, 0.03 * dt, 'dehydration');

  // Core temperature: drifts toward ambient; fur insulation slows the drift
  // BOTH ways (a parka in the desert is a liability); metabolic heat rises
  // with exertion; basking in warmth pushes up; sails dump heat.
  // TUNING (BIOMES_DESIGN §13.6): k = 0.02/s with metabolic 0.00228 +
  // 0.0024×active puts the equilibria exactly where the probes need them:
  //   max-fur (ins 0.3) walking (active 0.8) at ambient 0.55 → eq 0.85,
  //     crosses the hyper threshold (0.80 at heatTol 0.5) at ~139s
  //     (inside the 60–180s window), dead ~67s later — ~3.4 min total.
  //   founder (ins 0.15) walking in the jungle (ambient 0.5) → eq 0.747
  //     < 0.80: the ancestral territory stays thermally neutral.
  //   founder resting in arctic ambient 0.1 (active 0.1) → eq 0.248
  //     > hypo threshold 0.20: cold but alive — no hypothermia death.
  // A bear (max fur) walking south equilibrates AT ~0.80 in the jungle —
  // it can cross only by evolving thinner fur or better heatTol. Ranges
  // are physiological, not geographical.
  const subCold = sub01 * 0.35; // water chill — submerged is cold
  const ambientEff = clamp01(ambient - subCold);
  // v0.27: driftK floor — at furInsulation = 1.0 the old formula hit exactly
  // zero (zero ambient coupling; metabolic heat railed coreTemp in ANY
  // biome). Unreachable via the genome (fur ≤ 1 → insulation ≤ 0.3, pinned
  // by test) and no fixed body plan uses 1.0 anymore (bears moved to 0.3) —
  // this floor is defense-in-depth so the chemistry can never degenerate.
  const driftK = 0.02 * Math.max(0.05, 1 - (pheno.furInsulation ?? 0));
  const metabolic = 0.00228 + 0.0024 * active01;
  const warmthFrac = clamp01((ambientEff - 0.4) / 0.5); // basking only pays in warmth
  // v0.25 "Heat": basking value varies with cloud cover — sunbathing under
  // full overcast pays 30%. The brain can learn to bask when the sky is clear.
  const sunFrac = 1 - 0.7 * ctx.cloud;
  // v0.27 "Seasons": basking gain follows seasonal insolation — 1.0 at the
  // summer solstice, 0.2 at winter (else creatures bypass winter by basking).
  // Defaults to 1 when the caller passes no season (unit probes).
  const seasonSunFrac = ctx.seasonSun ?? 1;
  // v0.28 "Day and night": basking gain follows the diurnal sun — 1.0 at noon,
  // ~0 at midnight (else creatures bypass night by basking). Defaults to 1.
  const daySunFrac = ctx.daySun ?? 1;
  b.coreTemp = clamp01(b.coreTemp
    + driftK * (ambientEff - b.coreTemp) * dt
    + metabolic * dt
    + basking01 * 0.008 * warmthFrac * sunFrac * seasonSunFrac * daySunFrac * dt
    - sailDump01 * 0.01 * dt
    - pant01 * PANT_COOL_K * dt);
  // Hypothermia: health drains, fatigue accumulates 2×. Hyperthermia:
  // health drains.
  const hypothermic = b.coreTemp < hypoThr;
  const hyperthermic = b.coreTemp > hyperThr;
  if (hypothermic) drainHealth(b, 0.015 * dt, 'hypothermia');
  if (hyperthermic) drainHealth(b, 0.015 * dt, 'hyperthermia');

  // Comfort stays direct: touch soothes, scolding wounds.
  // v0.13: homesickness — being far from the imprinted home range wears
  // on homebodies (ctx.homesick = homeDist × instHomeSeek). Gentle: at full
  // homesickness the drain is ~2.5× baseline, a pull not a shove. (0.03 was
  // tried first — it crashed comfort in under a minute 229px from home and
  // starved seed 21's founders next to uneaten food. Friction, not force.)
  b.comfort = clamp01(b.comfort - 0.004 * dt - (ctx.homesick || 0) * 0.006 * dt + (ctx.petted ? 0.5 : 0));
  if (ctx.scolded) b.comfort = clamp01(b.comfort - 0.3);

  // --- v2 (R): evolvable chemical reactions --------------------------------
  // Each reaction gene converts substrate→product above its threshold at
  // its rate. MASS-CONSERVING: the transfer is bounded by both what the
  // substrate holds and what the product can take — chemistry rearranges,
  // never creates or destroys. Founder rates are near-zero: quiet
  // chemistry that evolution can turn up.
  // D1 "Regulatory depth": the loop extends 8→16 (rx8–rx15 founder-silent:
  // rate 0 → the continue path, behavior-identical at founder). Rate and
  // threshold are G-gateable — live TF dynamics: the gate is evaluated at
  // the target's own read site, from live chemistry. Gating scales only the
  // move magnitude; the min-bounds hold regardless.
  const _gated = hasActiveGates(pheno); // one cached lookup per tick
  for (let i = 0; i < 16; i++) {
    const sub = pheno[`rx${i}sub`];
    const thr = (pheno[`rx${i}thr`] ?? 0.5) * (_gated ? gateMultiplier(pheno, `rx${i}thr`, b) : 1.0);
    const subV = b[sub];
    if (subV === undefined || subV <= thr) continue;
    const prod = pheno[`rx${i}prod`];
    const rate = (pheno[`rx${i}rate`] ?? 0) * (_gated ? gateMultiplier(pheno, `rx${i}rate`, b) : 1.0);
    if (rate <= 0 || sub === prod) continue;
    const move = Math.min(rate * (subV - thr) * dt, subV, 1 - b[prod]);
    if (move > 0) {
      b[sub] = subV - move;
      b[prod] = b[prod] + move; // bounded by (1 − prod) above: no clamp needed
    }
  }

  // --- drives computed from chemistry ------------------------------------
  // v2 (D): gain + baseline tune the readout. The chemistry invariant
  // stands — drives are still readouts of the seven chemicals; the tuning
  // is genetic. Founder defaults are the identity (gain 1, baseline 0).
  // v0.37 "Affect": the depressed regime (serotonin < 0.35, design §3.1) —
  // all drive gains ×1.3 (everything hurts more), on top of the genetic
  // gain. State, not trait: the genetic loci are temperament; the regime
  // is history. The regime must read above the drives it modulates
  // (mood() §6), or the label lies about what's driving behavior.
  const depressed = b.serotonin < 0.35;
  const depGain = depressed ? 1.3 : 1.0;
  // D1 "Regulatory depth": drive gain/baseline are G-gateable — the gate is
  // evaluated here, at the readout, from live chemistry. The chemical→drive
  // correspondence itself is never gated (the chemistry invariant stands).
  const _gatedD = hasActiveGates(pheno); // one cached lookup per tick
  const dg = (d) => (pheno['driveGain' + d] ?? 1) * (_gatedD ? gateMultiplier(pheno, 'drv' + d + 'Gain', b) : 1.0) * depGain;
  const db = (d) => (pheno['driveBase' + d] ?? 0) * (_gatedD ? gateMultiplier(pheno, 'drv' + d + 'Base', b) : 1.0);
  b.hunger = clamp01((1 - b.bloodSugar) * dg('Hunger') + db('Hunger'));
  b.energy = clamp01((1 - b.fatigue) * dg('Energy') + db('Energy'));
  b.social = clamp01((1 - b.oxytocin) * dg('Social') + db('Social'));
  b.fun = clamp01((1 - b.endorphin) * dg('Fun') + db('Fun'));
  b.fear = clamp01(b.adrenaline * dg('Fear') + db('Fear'));
  // v0.37 "Affect": the four new drives — design §2. Same pattern:
  // chemicals in, drives out, genetic gain/baseline. No drive is
  // privileged in the architecture; priority emerges from gains, which
  // evolve.
  // NOTE (spec correction): libido TRACKS sexHormone (high hormone → high
  // drive), it does not invert it. The (1 - x) pattern is for homeostatic
  // needs (hunger = lack of fuel); sexHormone is a motivational substrate,
  // not a fuel. Inverting it would make creatures hornier AFTER mating
  // (the refractory drop would spike the drive) — backwards.
  const _stageNow = ageStage(b, pheno);
  // libido is gated by life stage in the readout: juveniles compute 0
  // regardless of chemistry (the chemical still tracks — puberty is the
  // ramp — but the brain never sees a need it can't act on).
  b.libido = (_stageNow === 'adult' || _stageNow === 'senior')
    ? clamp01(b.sexHormone * dg('Libido') + db('Libido'))
    : 0;
  b.curiosity = clamp01((1 - b.stimulus) * dg('Curiosity') + db('Curiosity'));
  // attachment is zero without a pair bond — you can't miss someone you
  // never bonded with. partnerAbsent comes from the world (pair-bonded
  // partner not in sense range).
  b.attachment = clamp01(b.vasopressin * ctx.partnerAbsent * dg('Attachment') + db('Attachment'));
  // care multiplies prolactin by the offspring's need — a content baby near
  // a high-prolactin parent yields a low drive. Presence, not fussing,
  // satisfies it.
  b.care = clamp01(b.prolactin * ctx.offspringNeed * dg('Care') + db('Care'));
  b.depressed = depressed ? 1 : 0; // the regime flag — creature.js reads it for psychomotor slowing (numeric, not boolean, for the NaN-guard invariant)

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
    drainHealth(b, (b.illness - 0.25) * 0.06 * dt, 'illness');
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

// v0.18 "Realms": the thermal senses — 0..1 readouts of coreTemp for the
// brain (senses 29/30), wired by the realms pass in creature.js. Cold and
// heat are SENSES, not drives: the brain can learn to seek warmth or shade,
// but no new need enters the drive economy.
export function coldSense(b, pheno) {
  void pheno;
  const t = Number.isFinite(b.coreTemp) ? b.coreTemp : 0.5;
  return clamp01((0.5 - t) * 2);
}
export function heatSense(b, pheno) {
  void pheno;
  const t = Number.isFinite(b.coreTemp) ? b.coreTemp : 0.5;
  return clamp01((t - 0.5) * 2);
}

// Dominant readable state for UI / behavior priority.
// v0.37 "Affect": 15 states — design/affect-expansion.md §6. The order
// encodes the argued hierarchy: death-nearest first (survival), then the
// genes' agenda (reproduction), then acute rupture (grief), then the
// chronic regime (depression — it modulates the drives below it, so it
// must read above them), then social needs, then the luxury needs
// (curiosity, excitement), then joy as the flavor of satisfied drives,
// then comfort, then content. Joy is contentment + endorphin + zest, not
// a separate channel; 'tender' and 'curious' sit low because they never
// outrank fear, hunger, or grief — the order says so.
export function mood(b) {
  if (b.fear > 0.5) return 'afraid';
  if (b.illness > 0.5) return 'sick';
  if (b.health < 0.4) return 'sick';
  if (b.hunger > 0.75) return 'hungry';
  if (b.energy < 0.25) return 'tired';
  if (b.libido > 0.7) return 'horny'; // the genes' agenda outranks comfort, not survival
  if (b.griefT > 0) return 'grieving'; // acute rupture; outranks chronic, not acute needs
  if (b.serotonin < 0.35) return 'depressed'; // the regime; colors everything below
  if (b.fun > 0.75) return 'bored';
  if (b.social > 0.75) return 'lonely';
  if (b.attachment > 0.6) return 'longing'; // specific, not general
  if (b.care > 0.6) return 'tender'; // parental; gentle, so low priority is honest
  if (b.curiosity > 0.7) return 'curious'; // the luxury need
  if (b.zest > 0.6) return 'excited'; // brief by chemistry
  if (b.endorphin > 0.75 && b.zest > 0.3) return 'joyful'; // joy = contentment + endorphin + zest
  if (b.comfort < 0.4) return 'uncomfortable';
  return 'content';
}
