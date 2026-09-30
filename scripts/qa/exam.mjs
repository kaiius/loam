// v0.8 exam harness: the shifting-patch novel-foraging exam.
// Native-harness presentation of the shared Wildcode × Emberhollow benchmark
// (spec v0.2 draft, "the shifting patch").
//
// Only one of three ground patches is hot at a time: hot plants fruit fast,
// cold plants trickle (or go barren). A beacon — sensed through the existing
// toy channel, no new sense organs — marks the patch predicted to go hot
// NEXT, with configurable reliability. The hot patch relocates on a hidden
// iid schedule drawn from a dedicated exam RNG stream (never perturbs the
// sim RNG). Re-randomization is inherent: the schedule is iid uniform every
// switch, so there is nothing to memorize — only the cue to learn.
//
// Metrics:
//   founderIntake  intake[0] — lifetime learning + priors, reported separately
//   gtc            generations-to-criterion: last generation of the first run
//                  of K consecutive pedigree generations (g>=1) with intake>=T
//   persistence    post-criterion sustainability (arsonist rule, part 1):
//                  fraction of the next K' generations with intake>=T and
//                  population above floor
//   efficiency     total eaten / total spawned (arsonist rule, part 2)
//   hotFraction    fraction of meals taken from the currently-hot patch
//                  (cue-tracking check)
//
// Modes:
//   exam      the shifting patch as specified
//   control   reliability 1.0, static hot patch — the positive control: proves
//             the cue is perceivable and trackable before anything is scored
//   calibrate sweep difficulty knobs; report which settings are solvable
//
// Run: node scripts/qa/exam.mjs [seeds] [minutes] [mode]
//   e.g. node scripts/qa/exam.mjs "7,11,22" 120 exam
//        node scripts/qa/exam.mjs "7" 120 control
//        node scripts/qa/exam.mjs "7,11" 90 calibrate
// Env overrides: EXAM_RELIABILITY EXAM_SWITCH_MIN EXAM_HOT_INT EXAM_COLD_INT
//   EXAM_T EXAM_K EXAM_MIN_GEN_MINUTES EXAM_POP_FLOOR EXAM_SEED

import { createWorld, bindWorld, addPlant, tickWorld } from '../../src/sim/world.js';
import { createRng } from '../../src/sim/rng.js';
import { createCreature } from '../../src/sim/creature.js';
import { randomGenome } from '../../src/sim/genome.js';

const PATCHES = [
  { x1: 80, x2: 520 },    // west
  { x1: 580, x2: 1020 },  // central
  { x1: 1080, x2: 1520 }, // east
];
const patchCenter = (i) => (PATCHES[i].x1 + PATCHES[i].x2) / 2;
const patchOf = (x) => PATCHES.findIndex((p) => x >= p.x1 && x <= p.x2);
const drawDifferent = (rng, x) => {
  let y;
  do { y = rng.int(0, 2); } while (y === x);
  return y;
};

const env = (k, d) => (process.env[k] !== undefined ? Number(process.env[k]) : d);
function baseCfg(mode) {
  return {
    mode,
    reliability: mode === 'control' ? 1.0 : env('EXAM_RELIABILITY', 0.8),
    switchMinutes: mode === 'control' ? 0 : env('EXAM_SWITCH_MIN', 20),
    hotInterval: env('EXAM_HOT_INT', 7),
    coldInterval: env('EXAM_COLD_INT', 60),
    T: env('EXAM_T', 0.04),
    K: env('EXAM_K', 3),
    persistGens: env('EXAM_K', 3),
    minGenMinutes: env('EXAM_MIN_GEN_MINUTES', 30),
    popFloor: env('EXAM_POP_FLOOR', 8),
    examSeed: env('EXAM_SEED', 4242),
  };
}

function setupExam(seed, cfg) {
  const world = bindWorld(createWorld(seed));
  const examRng = createRng(cfg.examSeed + seed);
  // Exam flora: 2 plants per patch, all on the ground.
  for (let i = 0; i < 3; i++) {
    addPlant(world, patchCenter(i) - 120, 0);
    addPlant(world, patchCenter(i) + 120, 0);
  }
  // Four founders, same recipe as populate(): 180px spacing, 2M/2F.
  // Cold introduction: the initial hot patch is drawn, not hand-placed.
  const xs = [660, 840, 1020, 1200];
  for (let i = 0; i < 4; i++) {
    const c = createCreature(randomGenome(world.rng), xs[i], 0, world.rng, {});
    c.biochem.age = c.pheno.lifespanSec * 0.15;
    world.creatures.push(c);
  }
  const sexes = ['male', 'male', 'female', 'female'];
  for (let i = sexes.length - 1; i > 0; i--) {
    const j = world.rng.int(0, i);
    [sexes[i], sexes[j]] = [sexes[j], sexes[i]];
  }
  world.creatures.forEach((c, i) => { c.sex = sexes[i]; });
  // Starter food, scattered (as in populate) — cold introduction, not
  // hand-placed near any patch.
  for (let i = 0; i < 8; i++) {
    const x = world.rng.range(100, 1500);
    const pi = Math.max(0, patchOf(x));
    world.foods.push({
      kind: 'food', id: 900010 + i, x, platformIndex: 0,
      y: world.platforms[0].y, foodKind: 'fruit', amount: 1, rotsAt: 0,
    });
  }
  // Hidden schedule + exam mode.
  const st = { hot: examRng.int(0, 2), next: 0 };
  // Control mode (static hot patch): the beacon marks the CURRENT patch —
  // there is no "next", so next = hot. Otherwise it predicts the next patch.
  st.next = cfg.switchMinutes > 0 ? drawDifferent(examRng, st.hot) : st.hot;
  world.exam = {
    patches: PATCHES, hot: st.hot,
    hotInterval: cfg.hotInterval, coldInterval: cfg.coldInterval,
  };
  // The beacon: the cue. Sensed as a toy (existing channel). Marks the patch
  // predicted to go hot NEXT — reliability chance it's truthful.
  const beacon = {
    kind: 'beacon', id: 900001, x: patchCenter(st.hot),
    y: world.platforms[0].y, platformIndex: 0, r: 14,
  };
  world.toys.push(beacon);
  const placeBeacon = () => {
    const truthful = examRng.next() < cfg.reliability;
    const marked = truthful ? st.next : drawDifferent(examRng, st.next);
    beacon.x = patchCenter(marked);
  };
  placeBeacon();
  return { world, examRng, st, beacon, placeBeacon };
}

function runOne(seed, cfg) {
  const { world, examRng, st, placeBeacon } = setupExam(seed, cfg);
  const cohortMeals = {}, cohortMinutes = {}, cohortPeak = {};
  let spawned = 0, eaten = 0, hotMeals = 0;
  world.onMeal = (c, amount) => {
    const g = c.generation || 0;
    cohortMeals[g] = (cohortMeals[g] || 0) + amount;
    eaten += amount;
    if (patchOf(c.x) === st.hot) hotMeals += amount;
  };
  world.onSpawn = (amount) => { spawned += amount; };

  for (let m = 0; m < cfg.minutes; m++) {
    for (let t = 0; t < 600; t++) tickWorld(world, 0.1);
    const alive = world.creatures.filter((c) => c.alive);
    if (!alive.length) return { seed, extinct: true, atMin: m };
    const perGen = {};
    for (const c of alive) {
      const g = c.generation || 0;
      perGen[g] = (perGen[g] || 0) + 1;
    }
    for (const [g, n] of Object.entries(perGen)) {
      cohortMinutes[g] = (cohortMinutes[g] || 0) + n;
      cohortPeak[g] = Math.max(cohortPeak[g] || 0, n);
    }
    if (cfg.switchMinutes > 0 && (m + 1) % cfg.switchMinutes === 0) {
      st.hot = st.next;
      st.next = drawDifferent(examRng, st.hot);
      world.exam.hot = st.hot;
      placeBeacon();
    }
  }

  const intake = (g) => {
    const mins = cohortMinutes[g] || 0;
    if (mins < cfg.minGenMinutes) return null;
    return (cohortMeals[g] || 0) / mins;
  };
  const maxG = Math.max(0, ...Object.keys(cohortMinutes).map(Number));
  // Generations-to-criterion: last gen of the first K-run at/above T (g>=1).
  let gtc = null, run = 0;
  for (let g = 1; g <= maxG; g++) {
    const r = intake(g);
    if (r !== null && r >= cfg.T) {
      run++;
      if (run >= cfg.K && gtc === null) gtc = g;
    } else run = 0;
  }
  // Persistence (arsonist rule): the K' generations after gtc.
  let persistence = null;
  if (gtc !== null) {
    let ok = 0, n = 0;
    for (let g = gtc + 1; g <= gtc + cfg.persistGens && g <= maxG; g++) {
      const r = intake(g);
      if (r === null) continue;
      n++;
      if (r >= cfg.T && (cohortPeak[g] || 0) >= cfg.popFloor) ok++;
    }
    persistence = n > 0 ? ok / n : null;
  }
  const gens = [];
  for (let g = 0; g <= maxG; g++) {
    const r = intake(g);
    if (r !== null) gens.push(`${g}:${r.toFixed(3)}`);
  }
  return {
    seed, extinct: false,
    pop: world.creatures.filter((c) => c.alive).length,
    maxGen: maxG,
    founderIntake: intake(0) !== null ? intake(0).toFixed(3) : 'n/a',
    gtc: gtc !== null ? gtc : '—',
    persistence: persistence !== null ? persistence.toFixed(2) : 'n/a',
    efficiency: spawned > 0 ? (eaten / spawned).toFixed(2) : 'n/a',
    hotFraction: eaten > 0 ? (hotMeals / eaten).toFixed(2) : 'n/a',
    gens: gens.join(' '),
  };
}

function fmt(r) {
  if (r.extinct) return `seed ${r.seed}: EXTINCT at t=${r.atMin}min`;
  return `seed ${r.seed}: pop=${r.pop} maxGen=${r.maxGen} founder=${r.founderIntake} gtc=${r.gtc} persist=${r.persistence} eff=${r.efficiency} hotFrac=${r.hotFraction}\n  gens: ${r.gens}`;
}

const seeds = (process.argv[2] || '7,11,22').split(',').map(Number);
const minutes = Number(process.argv[3] || 120);
const mode = process.argv[4] || 'exam';

if (mode === 'calibrate') {
  // Difficulty calibration (hermes's requirement): find settings where at
  // least one lineage solves within a bounded number of generations.
  console.log(`calibrate: ${seeds.length} seeds x ${minutes}min per cell (T=${env('EXAM_T', 0.04)})`);
  for (const rel of [1.0, 0.8]) {
    for (const sw of [12, 16, 20]) {
      const cfg = { ...baseCfg('exam'), reliability: rel, switchMinutes: sw, minutes };
      const rs = seeds.map((s) => runOne(s, cfg));
      const solved = rs.filter((r) => !r.extinct && r.gtc !== '—').length;
      const ext = rs.filter((r) => r.extinct).length;
      console.log(`rel=${rel} switch=${sw}min: solved ${solved}/${rs.length}` +
        (ext ? ` EXTINCT ${ext}` : '') +
        rs.map((r) => ` [${r.seed} gtc=${r.extinct ? 'EXT' : r.gtc} maxGen=${r.extinct ? 'EXT' : r.maxGen}]`).join(''));
    }
  }
} else {
  const cfg = { ...baseCfg(mode), minutes };
  console.log(`mode=${mode} seeds=${seeds.length} minutes=${minutes} ` +
    `rel=${cfg.reliability} switch=${cfg.switchMinutes}min hotInt=${cfg.hotInterval}s coldInt=${cfg.coldInterval}s T=${cfg.T} K=${cfg.K}`);
  let fails = 0;
  for (const s of seeds) {
    const r = runOne(s, cfg);
    console.log(fmt(r));
    if (mode === 'control' && !r.extinct) {
      const hf = Number(r.hotFraction);
      if (hf < 0.6) { console.log(`  CONTROL FAIL: hotFraction ${hf} < 0.6 — cue not trackable`); fails++; }
      else console.log(`  CONTROL PASS: cue perceivable and trackable`);
    }
    if (r.extinct) fails++;
  }
  if (mode !== 'calibrate') console.log(fails === 0 ? 'DONE' : `${fails} FAILURES`);
  process.exit(mode === 'control' ? (fails === 0 ? 0 : 1) : 0);
}
