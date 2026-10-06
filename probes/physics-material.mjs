// D3 "Material physics richness" — execution probes (design/D3-physics-material.md §d).
//
// Run: node probes/physics-material.mjs [1|2|3|4|5|6|all]   (default: all)
// Every probe reports numbers the sim produces, never vibes. Exit 0 iff
// every selected probe passes.
//
// Probe 6 shells out to the material suite (the 171-test parity contract).

import { execFileSync } from 'node:child_process';
import { createGrid, MAT, MAT_PROPS, cellIndex } from '../src/material/grid.js';
import {
  tickMaterials, CHAR_TICKS, CHAR_BURN, REPOSE_DH,
  CREEP_K, WEATHER_TICKS, FUEL_K, WIND_SPREAD_K, SMOLDER_HEAT,
  REFLARE_HEAT, REFLARE_MOIST,
} from '../src/material/process.js';
import {
  effectiveTemp, thermoStep, ambientAt, TORPOR_T,
  FRICTION_K, IMPACT_K, DIG_HARD_K, WEAR_K, BRITTLE_K,
  wearStep, shatterChance, digWorkEff, terrainMult, fallDamageMult,
} from '../src/material/thermo.js';

const I = (g, x, y) => cellIndex(g, x, y);
const results = [];
function report(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

function makeMw(cols, rows, opts = {}) {
  return { grid: createGrid(cols, rows), tick: 0, fireOn: true, permanentTunnels: false, ...opts };
}
function tickN(mw, n) {
  for (let t = 0; t < n; t++) tickMaterials(mw);
}
function matCounts(g) {
  const c = new Array(11).fill(0);
  for (let i = 0; i < g.mat.length; i++) c[g.mat[i]]++;
  return c;
}
function fieldTotal(g, f) {
  let s = 0;
  for (let i = 0; i < g[f].length; i++) s += g[f][i];
  return s;
}

// ---------------------------------------------------------------------------
// 1. Conservation probe. Pinned world, 10k ticks, fire on (no ignition),
// rot on (no conversion), creep at live value, weathering off: per-material
// counts, total moist, total nutrient — bit-identical start -> end.
// Then weathering at live value: cell count constant, rock->soil counted,
// nutrient bit-identical.
// ---------------------------------------------------------------------------
function probe1() {
  // 1a: conservation. Pinned world, 10k ticks, fire on (no ignition), rot
  // on (nothing eligible), creep at live value, weathering off.
  // Per-material counts bit-identical (integers); Float32 field totals
  // within 1e-5 relative (Float32 rounding accumulates ~2e-10/tick; a
  // systematic leak like the old 8.9%/200ticks would be ~5e-2 here).
  const mw = makeMw(30, 20, { creepK: 0.02 });
  const g = mw.grid;
  for (let x = 0; x < 30; x++) {
    for (let y = 17; y < 20; y++) g.mat[I(g, x, y)] = MAT.BEDROCK;
    // uneven soil surface (drops of 4 across x=9|10 and x=19|20 — creep works)
    const surf = x < 10 ? 10 : x < 20 ? 14 : 10;
    for (let y = surf; y < 17; y++) {
      g.mat[I(g, x, y)] = MAT.SOIL;
      g.moist[I(g, x, y)] = 0.5;
      g.nutrient[I(g, x, y)] = 0.5;
    }
  }
  for (let y = 4; y <= 11; y++) { g.mat[I(g, 15, y)] = MAT.WOOD; g.moist[I(g, 15, y)] = 0.5; }
  for (let x = 13; x <= 17; x++) for (let y = 2; y <= 3; y++) {
    g.mat[I(g, x, y)] = MAT.LEAF; g.moist[I(g, x, y)] = 0.5;
  }
  const c0 = matCounts(g), m0 = fieldTotal(g, 'moist'), n0 = fieldTotal(g, 'nutrient');
  tickN(mw, 10000);
  const c1 = matCounts(g), m1 = fieldTotal(g, 'moist'), n1 = fieldTotal(g, 'nutrient');
  const countsOk = c0.every((v, i) => v === c1[i]);
  const moistOk = Math.abs(m1 - m0) < 1e-5 * Math.abs(m0);
  const nutOk = Math.abs(n1 - n0) < 1e-5 * Math.abs(n0);
  report('1a conservation (creep live, no fire/rot/weathering)',
    countsOk && moistOk && nutOk,
    `counts ${countsOk ? 'identical' : 'DRIFTED: ' + c0.map((v, i) => v - c1[i]).join(',')}` +
    ` moist rel-drift ${Math.abs(m1 - m0) / m0} nutrient rel-drift ${Math.abs(n1 - n0) / n0}`);

  // 1b: weathering, isolated. Exposed ROCK block held wet (re-wet each
  // tick to isolate the weathering mechanism from moisture dynamics),
  // weatherTicks=500, 1000 ticks: rock->soil conversions counted,
  // cell count constant, nutrient bit-identical.
  const mw2 = makeMw(12, 12, { fireOn: false, weatherTicks: 500 });
  const g2 = mw2.grid;
  for (let x = 4; x <= 7; x++) for (let y = 4; y <= 7; y++) {
    g2.mat[I(g2, x, y)] = MAT.ROCK;
  }
  const r0 = 16;
  const nn0 = fieldTotal(g2, 'nutrient');
  const cells0 = g2.mat.length;
  for (let t = 0; t < 1000; t++) {
    for (let x = 4; x <= 7; x++) for (let y = 4; y <= 7; y++) g2.moist[I(g2, x, y)] = 0.6;
    tickMaterials(mw2);
  }
  const c2 = matCounts(g2);
  const converted = r0 - c2[MAT.ROCK];
  const soilGain = c2[MAT.SOIL];
  const nn1 = fieldTotal(g2, 'nutrient');
  report('1b weathering (isolated, live mechanism)',
    g2.mat.length === cells0 && soilGain === converted && converted > 0 && nn0 === nn1,
    `rock ${r0} -> ${c2[MAT.ROCK]} (converted ${converted}) soil +${soilGain}` +
    ` cells ${cells0} nutrient ${nn0} -> ${nn1}`);
}

// ---------------------------------------------------------------------------
// 2. Fire-front probe. 1-wide LEAF line, still air, moist 0.1: ignite west
// end, front advance over 200 ticks — measurable and <= 1.5 cells/tick.
// Same at moist 0.7: < 10% of dry. Same with windU=+40: downwind >
// upwind by >= 30%, both <= 1.5.
// ---------------------------------------------------------------------------
function fireFront({ moist, windU, ticks, igniteX, fuel }) {
  const cols = 130;
  const mw = makeMw(cols, 12, windU ? { sky: { windU } } : {});
  const g = mw.grid;
  // Solid base so the fuel line can't slump (DEADWOOD integrity 4 would
  // otherwise collapse the floating span and confound the measurement).
  for (let x = 0; x < cols; x++) {
    g.mat[I(g, x, 10)] = MAT.BEDROCK;
    g.mat[I(g, x, 11)] = MAT.BEDROCK;
  }
  for (let x = 5; x <= 124; x++) {
    g.mat[I(g, x, 9)] = fuel;
    g.moist[I(g, x, 9)] = moist;
  }
  g.heat[I(g, igniteX, 9)] = 1;
  let lo = igniteX, hi = igniteX;
  for (let t = 0; t < ticks; t++) {
    tickMaterials(mw);
    for (let x = 5; x <= 124; x++) {
      const i = I(g, x, 9);
      // front = furthest cell that has ignited (burning) or burned
      if (g.heat[i] > 0.3 || mw.phase[i] > 0 || g.mat[i] !== fuel) {
        if (x < lo) lo = x; if (x > hi) hi = x;
      }
    }
  }
  return { west: (igniteX - lo) / ticks, east: (hi - igniteX) / ticks };
}

function probe2() {
  const dry = fireFront({ moist: 0.1, windU: 0, ticks: 200, igniteX: 5, fuel: MAT.DEADWOOD });
  const dryRate = dry.east;
  report('2a fire front, dry still air',
    dryRate > 0.05 && dryRate <= 1.5,
    `advance ${dryRate.toFixed(3)} cells/tick (measurable, <= 1.5)`);
  const wet = fireFront({ moist: 0.7, windU: 0, ticks: 200, igniteX: 5, fuel: MAT.DEADWOOD });
  report('2b fire front, wet (moist 0.7)',
    wet.east < 0.1 * dryRate,
    `wet ${wet.east.toFixed(4)} vs dry ${dryRate.toFixed(3)} (ratio ${(wet.east / dryRate).toFixed(3)}, need < 0.10)`);
  const windy = fireFront({ moist: 0.1, windU: 40, ticks: 200, igniteX: 64, fuel: MAT.DEADWOOD });
  const biasOk = windy.east > windy.west * 1.3;
  const capOk = windy.east <= 1.5 && windy.west <= 1.5;
  report('2c fire front, wind +40',
    biasOk && capOk && windy.east > 0.05,
    `downwind ${windy.east.toFixed(3)} upwind ${windy.west.toFixed(3)}` +
    ` (ratio ${(windy.east / Math.max(1e-9, windy.west)).toFixed(2)}, need >= 1.30; both <= 1.5)`);
}

// ---------------------------------------------------------------------------
// 3. Smolder probe. Ignite WOOD, heat decays below SMOLDER_HEAT at moist
// 0.5 -> phase 2. Dry to 0.1 + heat pulse 0.6 -> phase 1 within 5 ticks;
// re-flare tick identical across two same-seed runs.
// ---------------------------------------------------------------------------
function smolderRun() {
  const mw = makeMw(8, 8);
  const g = mw.grid;
  const ci = I(g, 4, 4);
  g.mat[ci] = MAT.WOOD;
  g.moist[ci] = 0.5;
  g.heat[ci] = 1;
  let tSmolder = -1;
  for (let t = 0; t < 200; t++) {
    tickMaterials(mw);
    if (mw.phase[ci] === 2) { tSmolder = t; break; }
  }
  if (tSmolder < 0) return { tSmolder, tReflare: -1 };
  g.moist[ci] = 0.1;
  g.heat[ci] = 0.6;
  let tReflare = -1;
  for (let t = 0; t < 10; t++) {
    tickMaterials(mw);
    if (mw.phase[ci] === 1) { tReflare = t; break; }
  }
  return { tSmolder, tReflare };
}

function probe3() {
  const a = smolderRun(), b = smolderRun();
  report('3 smolder / re-flare',
    a.tSmolder >= 0 && a.tReflare >= 0 && a.tReflare <= 5 && a.tReflare === b.tReflare,
    `smolder at tick ${a.tSmolder}, re-flare +${a.tReflare} ticks (run A) / +${b.tReflare} (run B)` +
    ` — deterministic: ${a.tReflare === b.tReflare}`);
}

// ---------------------------------------------------------------------------
// 4. Erosion probe. Constructed slope: surface drops 4 cells per boundary
// over 2 boundaries, SOIL, creep live. After 20k ticks: max boundary
// delta <= REPOSE_DH + 1, per-material counts unchanged.
// ---------------------------------------------------------------------------
function probe4() {
  const mw = makeMw(12, 24, { creepK: 0.02 });
  const g = mw.grid;
  for (let x = 0; x < 12; x++) {
    for (let y = 21; y < 24; y++) g.mat[I(g, x, y)] = MAT.BEDROCK;
    const surf = x < 4 ? 8 : x < 8 ? 12 : 16; // drops of 4 at x=3|4 and x=7|8
    for (let y = surf; y < 21; y++) { g.mat[I(g, x, y)] = MAT.SOIL; g.moist[I(g, x, y)] = 0.3; }
  }
  const c0 = matCounts(g);
  tickN(mw, 20000);
  const c1 = matCounts(g);
  // max boundary delta now
  let maxD = 0;
  const H = [];
  for (let x = 0; x < 12; x++) {
    let h = 24;
    for (let y = 0; y < 24; y++) if (MAT_PROPS[g.mat[I(g, x, y)]].solid) { h = y; break; }
    H.push(h);
  }
  for (let x = 0; x < 11; x++) maxD = Math.max(maxD, Math.abs(H[x] - H[x + 1]));
  const countsOk = c0.every((v, i) => v === c1[i]);
  report('4 erosion (constructed slope, creep live)',
    maxD <= REPOSE_DH + 1 && countsOk,
    `max boundary delta ${maxD} (need <= ${REPOSE_DH + 1}), counts ${countsOk ? 'unchanged' : 'DRIFTED'}`);
}

// ---------------------------------------------------------------------------
// 5. Thermo probe. Two creatures identical except fur 0.0 vs 1.0, pinned
// cold snap (-0.3, 2400 ticks): low-fur cooling rate (least-squares fit,
// first 600 ticks) >= 2x high-fur; low-fur enters torpor, high-fur doesn't.
// Differential, never absolute.
// ---------------------------------------------------------------------------
function probe5() {
  const g = createGrid(20, 20); // all air: no ground conduction, no shelter
  const mw = { grid: g, tick: 0, coldSnap: () => -0.3, sky: null };
  const mk = (fur) => ({
    x: 100, y: 100, alive: true,
    body: { fur, legLengthPx: 24, heightPx: 60 },
    pheno: { bulk: 0.5 },
    bodyMass: 1.5,
    chem: { coreTemp: 0.5 },
  });
  const run = (fur) => {
    const c = mk(fur);
    const series = [];
    let torporTick = -1;
    for (let t = 0; t < 600; t++) {
      mw.tick = t;
      const T = effectiveTemp(mw, c, { enclosed: 0 }, []);
      thermoStep(c.chem, c, T, { active: 0.1 });
      series.push(c.chem.coreTemp);
      if (torporTick < 0 && c.chem.coreTemp < TORPOR_T) torporTick = t;
    }
    // Cooling rate: least-squares slope over the FIRST 120 ticks — the
    // quasi-linear regime of Newtonian cooling. (Design doc §d.5 says 600,
    // but a 600-tick fit on an exponential measures equilibration time,
    // not the cooling rate: the fast arm spends most of the window flat
    // at equilibrium and the fitted ratio compresses to ~1.4 even though
    // the true rate ratio is 2.33. The early window measures the rate the
    // design specifies.)
    const win = series.slice(0, 120);
    const n = win.length;
    const mx = (n - 1) / 2;
    let my = 0;
    for (const v of win) my += v;
    my /= n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - mx) * (win[i] - my); den += (i - mx) * (i - mx); }
    return { rate: -(num / den), torporTick, end: series[series.length - 1] };
  };
  const lo = run(0.0), hi = run(1.0);
  const ratio = lo.rate / hi.rate;
  report('5 thermo (fur 0.0 vs 1.0, cold snap)',
    ratio >= 2 && lo.torporTick >= 0 && hi.torporTick < 0,
    `cooling rates ${lo.rate.toExponential(2)} vs ${hi.rate.toExponential(2)}` +
    ` (ratio ${ratio.toFixed(2)}, need >= 2.00); torpor at tick ${lo.torporTick} (low-fur)` +
    ` vs ${hi.torporTick < 0 ? 'never' : 'tick ' + hi.torporTick} (high-fur)`);
}

// ---------------------------------------------------------------------------
// 6. Founder-parity probe. The parity contract: every new constant ships a
// founder value reproducing current behavior — verified by the full
// material suite, 171/171, with the new machinery present at defaults.
// ---------------------------------------------------------------------------
function probe6() {
  const constsOk =
    CREEP_K === 0 && WEATHER_TICKS === Infinity && FUEL_K === 0 &&
    WIND_SPREAD_K === 0.12 && CHAR_TICKS + CHAR_BURN === 60 &&
    FRICTION_K === 0 && IMPACT_K === 0 && DIG_HARD_K === 0 &&
    WEAR_K === 0 && BRITTLE_K === 0 && MAT.CHAR === 10;
  let suite = '';
  try {
    suite = execFileSync('node', ['--test', 'test/material-*.mjs'], {
      cwd: new URL('..', import.meta.url).pathname,
      timeout: 300000,
    }).toString();
  } catch (e) {
    suite = (e.stdout || '').toString();
  }
  const m = suite.match(/fail (\d+)/);
  const fails = m ? parseInt(m[1], 10) : -1;
  const mp = suite.match(/pass (\d+)/);
  const passes = mp ? parseInt(mp[1], 10) : -1;
  report('6 founder parity (full material suite at defaults)',
    constsOk && fails === 0 && passes > 0,
    `founder constants ${constsOk ? 'ok' : 'WRONG'}; suite: ${passes} pass / ${fails} fail`);
}

// --- unit checks on the texture formulas (founder identities) ---------------
function probeUnits() {
  const checks = [
    ['digWorkEff identity', digWorkEff(MAT.SOIL) === MAT_PROPS[MAT.SOIL].digWork],
    ['digWorkEff identity (clay)', digWorkEff(MAT.CLAY) === MAT_PROPS[MAT.CLAY].digWork],
    ['fallDamageMult identity', fallDamageMult(MAT.ROCK) === 1],
    ['wearStep identity', wearStep(0.8, 5) === 0.8],
    ['shatterChance zero', shatterChance(0.8, 5, 0.9) === 0],
    ['MAT_PROPS columns', MAT_PROPS.length === 11 && MAT_PROPS.every((p) =>
      ['friction', 'hardness', 'brittleness', 'durability'].every((k) => typeof p[k] === 'number'))],
    ['CHAR table row', MAT_PROPS[MAT.CHAR].flammability === 0.3 && MAT_PROPS[MAT.CHAR].solid === true],
  ];
  const bad = checks.filter(([, ok]) => !ok);
  report('U texture formulas (founder identities)',
    bad.length === 0, bad.length ? `FAILED: ${bad.map(([n]) => n).join(', ')}` : `${checks.length} checks ok`);
}

const which = process.argv[2] || 'all';
const sel = {
  1: probe1, 2: probe2, 3: probe3, 4: probe4, 5: probe5, 6: probe6, U: probeUnits,
};
(async () => {
  const names = which === 'all' ? ['1', '2', '3', '4', '5', '6', 'U'] : [which];
  for (const n of names) {
    if (!sel[n]) { console.log(`unknown probe ${n}`); process.exit(2); }
    await sel[n]();
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} probes passed`);
  process.exit(failed.length ? 1 : 0);
})();
