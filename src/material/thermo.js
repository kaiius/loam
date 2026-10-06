// Loam D3 "Material physics" — body thermodynamics + material texture.
//
// The material track's half of thermoregulation. The chemistry itself
// (coreTemp integration, panting, hypo/hyperthermia ledgers) lives in
// the shared sim/biochem.js — untouched. This module computes the
// *ambient the creature actually experiences* and feeds it through the
// existing ctx.ambientTemp path, plus the texture terms (friction,
// hardness, brittleness, durability) whose founder coefficients are all
// zero — machinery present, effect dormant, until tuned live.
//
// Design: design/D3-physics-material.md §(b).3–4. Deterministic: no RNG
// anywhere in this file; ties break by sweep/probe order.

import { CELL_PX, MAT, MAT_PROPS } from './grid.js';
import { supportBelow } from './locomotion.js';
// NOTE: no weather.js import — weather imports senses which imports
// creature; thermo is imported by actions/mcreature, so a weather edge
// would close an import cycle. Sky temp is read inline below.

// --- ambient field: a pure function of (tick, y), no storage ---------------
export const T_BASE = 0.5;      // 0..1 scale, 0.5 neutral
export const T_DIURNAL = 0.25;  // day/night swing (2400 ticks/day)
export const T_LAPSE = 0.15;    // altitude lapse — the canopy top runs cooler

// Pinned cold-snap stream. Default 0 (no snaps in live worlds yet — a
// future design can pin the stream); probes inject via mw.coldSnap(tick).
function coldSnapAt(mw, tick) {
  if (typeof mw.coldSnap === 'function') return mw.coldSnap(tick);
  return 0;
}

export function ambientAt(mw, xPx, yPx) {
  const rows = mw.grid.rows;
  const cy = Math.max(0, Math.min(rows, yPx / CELL_PX));
  const tick = mw.tick || 0;
  return (
    T_BASE +
    T_DIURNAL * Math.sin((2 * Math.PI * tick) / 2400) -
    T_LAPSE * (1 - cy / rows) +
    coldSnapAt(mw, tick)
  );
}

// --- the experienced temperature -------------------------------------------
export const SHELTER_K = 0.3;   // burrow buffering toward neutral
export const HUDDLE_K = 0.02;   // per-conspecific warmth within HUDDLE_R
export const HUDDLE_R = 60;     // px — social thermoregulation radius
export const HUDDLE_CAP = 0.1;  // huddle bonus caps here
export const SUN_BASK = 0.75;   // bask target: stationary + in light, daylight
export const TORPOR_T = 0.25;   // coreTemp below this: cold torpor

// Bask thermo spec (design §(b).3): stationary + in light -> the basking
// creature's effective ambient is at least SUN_BASK during the daylight
// diurnal phase. The bask ACTION is declared-but-unported (actions.js);
// this specifies the effect so the port has a target. Dormant until set.
export function baskTarget(isBasking, daylight01) {
  if (!isBasking || daylight01 <= 0) return null;
  return SUN_BASK * daylight01;
}

// The full experienced ambient for one creature. Base is the sky's
// temperature field (or 0.5 with no sky — today's behavior), plus the D3
// terms: pinned cold snaps, fire-warmed ground conduction, shelter
// buffering, huddle warmth. `s` is the sense object (needs s.enclosed);
// `others` the creature list.
export function effectiveTemp(mw, c, s, others) {
  // Sky column temperature, read inline (see import note above).
  let skyT = 0.5;
  if (mw.sky) {
    const sky = mw.sky;
    const i = Math.max(0, Math.min(sky.ncols - 1, Math.floor(c.x / 100)));
    skyT = sky.cols[i].T;
  }
  let T = skyT + coldSnapAt(mw, mw.tick || 0);
  const g = mw.grid;
  // Fire-warmed ground conducts: grounded on a cell with heat > 0.3.
  const leg = c.body ? c.body.legLengthPx : 24;
  const sup = supportBelow(mw, c.x, c.y, leg);
  if (sup) {
    const cx = Math.floor(c.x / CELL_PX);
    const cy = Math.floor(sup.y / CELL_PX);
    if (cx >= 0 && cx < g.cols && cy >= 0 && cy < g.rows) {
      const h = g.heat[cy * g.cols + cx];
      if (h > 0.3) T = Math.max(T, h * 0.8);
    }
  }
  // Shelter: the enclosed sense (idx 45) reads burrows/tunnels — buffered
  // toward neutral when ambient is off-neutral.
  const enclosed = s && typeof s.enclosed === 'number' ? s.enclosed : 0;
  if (enclosed > 0.6) T += SHELTER_K * (0.5 - T);
  // Huddle: conspecifics within HUDDLE_R share warmth, capped.
  let n = 0;
  for (const o of others || []) {
    if (o === c || !o.alive) continue;
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    if (dx * dx + dy * dy < HUDDLE_R * HUDDLE_R) n++;
  }
  T += Math.min(HUDDLE_CAP, n * HUDDLE_K);
  return T;
}

// --- the Newtonian exchange (material-track side) --------------------------
// Exchange constants (design §(b).3): weak enough at founder defaults that
// the existing cold/heat sense readouts stay in their current band.
export const K_BASE = 0.01; // base exchange rate
export const FUR_K = 2.0;   // fur insulation slows the exchange
export const BULK_K = 1.0;  // bulk insulation slows the exchange
export const MASS_K = 0.5;  // body mass adds thermal inertia
// k = K_BASE/(1 + FUR_K·fur + BULK_K·bulk) — insulation slows the exchange
// both ways (a parka in the desert is a liability); C = 1 + MASS_K·mass —
// thermal inertia. ACT_HEAT: locomotion warms (+0.002·activity), sleep
// cools (−0.001). Runs in the material track; the shared biochem's own
// coreTemp drift is neutralized by handing it the post-step coreTemp as
// ambient (see mcreature.js), so the exchange is single-counted —
// everything else in biochem (panting, hypo/hyper ledgers, metabolic
// heat) runs untouched.
export function thermoStep(b, c, T_eff, chemCtx) {
  const fur = c.body ? (c.body.fur ?? 0.5) : 0.5;
  const bulk = c.pheno ? (c.pheno.bulk ?? 0.5) : 0.5;
  const mass01 = Math.max(0, Math.min(1, (c.bodyMass ?? 1.5) - 1));
  const k = K_BASE / (1 + FUR_K * fur + BULK_K * bulk);
  const C = 1 + MASS_K * mass01;
  const t = Number.isFinite(b.coreTemp) ? b.coreTemp : 0.5;
  const sleeping = chemCtx && chemCtx.sleeping;
  const actHeat = sleeping ? -0.001 : 0.002 * ((chemCtx && chemCtx.active) ?? 0.6);
  const nt = t - (k / C) * (t - T_eff) + actHeat;
  b.coreTemp = nt < 0 ? 0 : nt > 1 ? 1 : nt;
  return b.coreTemp;
}

// --- material texture: founder-zero coefficients ----------------------------
// Every term below is an identity (x1.0 / +0) at founder defaults — the
// properties exist in the table, the formulas exist in code, and nothing
// moves until the coefficients go live.
export const FRICTION_K = 0; // locomotion cost x (1 + FRICTION_K*(friction-0.5))
export const IMPACT_K = 0;   // fall damage x (1 + IMPACT_K*(hardness-0.5))
export const DIG_HARD_K = 0; // digWork x (1 + DIG_HARD_K*(hardness-0.5))
export const WEAR_K = 0;      // object wear per strike; 0 = objects never break
export const BRITTLE_K = 0;   // shatter chance; 0 = never shatters

// Locomotion cost multiplier for the ground under (x, y): 1.0 at founder.
export function terrainMult(mw, x, y) {
  const sup = supportBelow(mw, x, y, 30);
  const fr = sup ? (MAT_PROPS[sup.mat]?.friction ?? 0.5) : 0.5;
  return 1 + FRICTION_K * (fr - 0.5);
}

// Digging resistance: effective digWork for a material. 1.0x at founder.
export function digWorkEff(m) {
  const p = MAT_PROPS[m];
  return p.digWork * (1 + DIG_HARD_K * ((p.hardness ?? 0.5) - 0.5));
}

// Fall impact: damage multiplier for landing on a surface material.
// NOTE: the material track has no fall-damage mechanic today (falls just
// land) — the base damage is 0 and this hook is dormant. When a damage
// source lands, the texture point is specified: rock landings hurt,
// leaf-litter landings cushion.
export function fallDamageMult(surfaceMat) {
  const h = MAT_PROPS[surfaceMat]?.hardness ?? 0.5;
  return 1 + IMPACT_K * (h - 0.5);
}
export function fallBaseDamage(impactSpeed) {
  void impactSpeed;
  return 0; // no fall-damage mechanic exists today; the hook is specified
}

// Object wear: durability after one strike/use at impactSpeed.
// No strike/use call sites exist in the material track yet (carried
// objects are eaten/piled, never struck) — the formula is specified for
// the action work that will call it. 0 wear at founder.
export function wearStep(durability, impactSpeed) {
  return durability - WEAR_K * (1 - durability) * impactSpeed;
}

// Thrown-object shatter chance on hard impact. 0 at founder.
export function shatterChance(brittleness, impactSpeed, surfaceHardness) {
  return BRITTLE_K * brittleness * impactSpeed * surfaceHardness;
}
