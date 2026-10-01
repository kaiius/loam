// v0.24 "Mass conservation" — the global mass ledger.
//
// Every material flow in the sim is either an INTERNAL TRANSFER between
// tracked pools (pool A down, pool B up, books balance by construction) or
// a LABELED BOUNDARY flow (in.* / out.*), recorded at the moment it
// crosses. The invariant the 10k-tick probe asserts:
//
//   Σ pools(t) − ( Σ in(t) − Σ out(t) ) = baseline   (drift ≡ 0)
//
// Pools are derived from live world state on demand (never incremented),
// so the ledger cannot drift out of sync with the world — the only thing
// that can move the invariant is an unrecorded boundary crossing, which is
// exactly what the probe hunts.
//
// Boundary inputs (labeled, honest about where mass enters):
//   in.sunlight    — photosynthate: the carbon/water/air share of new plant
//                    tissue, fruit, and nectar (sunlight = energy in; CO2/H2O
//                    are the mass). Paul's v0.17 changelog names this one.
//   in.weathering  — rock weathering into soil fertility (the leaching
//                    relaxation's upward half — was "created from nothing").
//   in.parental    — egg mass provisioned by the mother at laying.
//   in.provisioning— the 0.35 nest-cache fruit per hatch (was "created from
//                    nothing"; now a labeled subsidy, still founder-tuned).
// Boundary outputs (labeled):
//   out.metabolism — food mass burned as energy (the bite's unexcreted,
//                    unscrapped share; teacher tastings).
//   out.respired   — decomposition's inefficiency (waste→fertility runs at
//                    SOIL_CONV_EFF; the rest leaves as CO2 — Paul's 70/30
//                    compost split, generalized: the labeled share is exact).
//
// Deliberately OUT of the books: the teacher's body and toys (observer
// artifacts, not sim mass); predators (their bodies never enter the pools,
// so their arrival and death are mass-neutral — only the kills they cause
// are booked, via the corpse); chemical concentrations (bloodSugar etc. are
// energy/state, not mass — their mass was booked at the bite); call
// utterances and other information (no mass). The observer's hand crosses
// the boundary through labeled in./out.observer flows (see observer.js).
import { ageStage, stageSize } from './biochem.js';
import { phenotype } from './genome.js';

// ---- mass units ---------------------------------------------------------
// BODY_MASS_UNIT: founder-neutral — an adult founder tanglekin (size 0.25)
// masses 4.8 × 0.25 × 1.0 = 1.2, exactly the old fixed corpse amount, so the
// scavenging economy is unchanged at founder values while scaling honestly
// with body size afterwards (Paul's "fixed carcass" trap, avoided).
export const BODY_MASS_UNIT = 4.8;
export const PLANT_MASS = 1.0;   // tissue mass per unit of plant growth (0..1)
export const MINERAL_FRAC = 0.05; // soil-mineral share of new tissue (rest: sunlight)
export const FRUIT_MINERAL = 0.03; // soil-mineral share of fruit mass (rest: sunlight)
export const LITTER_FRAC = 0.5;   // shed litter = this fraction of grown tissue
export const PEBBLE_MASS = 0.9;   // matches the held 'stone' sample weight (exact grasp transfer)
export const STICK_MASS = 0.7;    // fallback when a stick carries no weight field

// Body mass of a creature — the pool unit for `bodies`, corpses, and eggs.
// v0.24: mass is a creature STATE (c.bodyMass), not a pure function of age.
// Age-stage drives size/radius (physics); mass changes only via explicit
// flows: birth (egg mass), food→tissue in doEat, death (corpse). An
// age-scaled mass function would create mass from nothing every time a
// creature aged up a life stage — the ledger caught exactly that (+0.82
// drift in the isolation probe). The fallback computes from size/stage for
// creatures created before the field existed (unit tests).
export function bodyMassOf(c) {
  if (c && typeof c.bodyMass === 'number' && c.bodyMass > 0) return c.bodyMass;
  const size = (c && c.pheno && c.pheno.size !== undefined) ? c.pheno.size : 0.3;
  let stage = 'adult';
  try {
    if (c && c.biochem && c.pheno) stage = ageStage(c.biochem, c.pheno);
  } catch { /* keep 'adult' */ }
  return BODY_MASS_UNIT * size * stageSize(stage);
}

// Egg mass, fixed at laying from the child's genome — hatching is then an
// exact transfer (egg pool → body pool), never a creation event.
export function eggMassForGenome(genome) {
  let size = 0.3;
  try { size = phenotype(genome).size ?? 0.3; } catch { /* keep default */ }
  return BODY_MASS_UNIT * size * stageSize('baby');
}

// ---- flow recording ------------------------------------------------------
export function initLedger(world) {
  if (!world.ledger) world.ledger = { in: {}, out: {}, baseline: null };
  return world.ledger;
}

export function ledgerIn(world, key, amount) {
  if (!(amount > 0)) return;
  initLedger(world);
  world.ledger.in[key] = (world.ledger.in[key] || 0) + amount;
}

export function ledgerOut(world, key, amount) {
  if (!(amount > 0)) return;
  initLedger(world);
  world.ledger.out[key] = (world.ledger.out[key] || 0) + amount;
}

// ---- pools (derived from live state) --------------------------------------
export function ledgerPools(world) {
  const pools = {};
  if (world.climate) {
    let sky = 0, soil = 0;
    for (const c of world.climate.cols) {
      // v0.24: count the ACTUAL cloud, not a capped version. The weather
      // allows cloud up to 1.2 (the 3b cap rains out the excess); capping
      // the pool at 1.0 undercounts cloud and fabricates mass when the
      // excess rains out — the ledger caught exactly that (+0.001/tick).
      sky += (c.vapor || 0) + (c.cloud || 0);
      soil += c.soil || 0;
    }
    pools.waterSky = sky;
    pools.waterSoil = soil;
    pools.waterTable = world.climate.waterTable || 0;
    pools.runoff = world.climate.runoff || 0;
    pools.drainage = world.climate.drainage || 0;
  }
  let fert = 0, waste = 0;
  if (world.soil) {
    for (const k of Object.keys(world.soil)) {
      fert += world.soil[k].fertility || 0;
      waste += world.soil[k].waste || 0;
    }
  }
  pools.soilFert = fert;
  pools.soilWaste = waste;
  let food = 0;
  for (const f of world.foods || []) food += f.amount || 0;
  pools.food = food;
  let buried = 0;
  for (const b of world.buried || []) buried += b.amount || 0;
  pools.buried = buried;
  let gut = 0, bodies = 0, held = 0;
  for (const c of world.creatures || []) {
    if (!c.alive) continue;
    gut += c.gut || 0;
    bodies += bodyMassOf(c);
    if (c.held) held += c.held.weight || 0;
  }
  pools.gut = gut;
  pools.bodies = bodies;
  pools.held = held;
  let plants = 0;
  for (const p of world.plants || []) {
    // v0.24: count banked litter too — it's sourced tissue (soil draw +
    // sunlight input) waiting to shed. Omitting it made the ledger blind
    // to mass between growth and shedding (−0.027/tick in the full probe).
    plants += (Math.max(0, p.growth || 0) + (p._litterAcc || 0)) * PLANT_MASS;
  }
  pools.plants = plants;
  let eggs = 0;
  for (const e of world.eggs || []) eggs += e.mass || 0;
  pools.eggs = eggs;
  let minerals = 0;
  for (const m of world.minerals || []) minerals += (m.amount || 0) * (m.weight ?? 0.5);
  for (const p of world.pebbles || []) minerals += p.weight ?? PEBBLE_MASS; // dropped samples keep their own weight
  for (const s of world.sticks || []) minerals += s.weight ?? STICK_MASS;
  pools.minerals = minerals;
  return pools;
}

export function ledgerTotal(world) {
  const pools = ledgerPools(world);
  let t = 0;
  for (const k of Object.keys(pools)) t += pools[k];
  return t;
}

export function ledgerNet(world) {
  initLedger(world);
  let inn = 0, out = 0;
  for (const k of Object.keys(world.ledger.in)) inn += world.ledger.in[k];
  for (const k of Object.keys(world.ledger.out)) out += world.ledger.out[k];
  return inn - out;
}

// Seal the baseline once the world is fully stocked (end of populate /
// populateGenesis). Everything after the seal must balance.
export function ledgerSeal(world) {
  initLedger(world);
  world.ledger.baseline = ledgerTotal(world) - ledgerNet(world);
  return world.ledger.baseline;
}

// Drift from the sealed baseline. Positive = mass created out of nothing;
// negative = mass deleted. Lazily seals on first call (unit-test worlds).
export function ledgerDrift(world) {
  initLedger(world);
  if (world.ledger.baseline == null) ledgerSeal(world);
  return (ledgerTotal(world) - ledgerNet(world)) - world.ledger.baseline;
}
