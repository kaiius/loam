// Canopy v0.22 "Web of Life": the bacterial decomposer layer.
//
// Decomposition used to be an abiotic constant (SOIL_DECAY): waste became
// fertility at a fixed rate, as if the soil were a machine. It isn't —
// it's alive. Each zone carries a bacterial biomass (0..BACT_MAX), a real
// population with growth dynamics:
//
//   - grows on waste/corpse/scrap mass (Monod kinetics: fast when waste
//     is abundant, saturating),
//   - pays temperature-scaled maintenance (arctic slow, jungle fast —
//     ambientTemp at the zone center sets the pace),
//   - blooms on windfalls, crashes when the waste runs out.
//
// The decomposition rate is proportional to biomass: at founder biomass
// (1.0) the multiplier is EXACTLY 1.0, so all pre-v0.22 soil behavior is
// preserved. A sterilized zone (biomass 0) decomposes at the 5% abiotic
// floor — measurably slower, and the ledger shows it.
//
// Zone-level, not individual agents: individual bacteria at this scale
// would be absurd. The population is the honest unit.

import { BIOMES, biomeCenterX, ambientTemp } from './biomes.js';

export const BACT_FOUNDER = 1.0; // founder biomass — the reference point
export const BACT_MAX = 3.0; // bloom ceiling
export const BACT_REF = 1.0; // multiplier is 1.0 at this biomass
export const BACT_ABIO = 0.05; // abiotic floor: sterilized soil still decays, barely
export const BACT_GROWTH = 0.02; // per-second max specific growth rate
export const BACT_HALF = 2.0; // Monod half-saturation (waste units)
export const BACT_MAINT = 0.004; // per-second maintenance loss (temperature-scaled)
export const BACT_IMMIG = 0.0005; // per-second spore immigration — sterilized
// soil recolonizes from the wind, slowly (no spontaneous generation:
// growth still needs extant biomass, immigration supplies the seed)
export const BACT_BLOOM = 2.0; // ledger threshold: bloom noted crossing upward
export const BACT_CRASH = 0.25; // ledger threshold: crash noted crossing downward

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Temperature pace per zone: 0.15 (arctic) → 1.0 (desert interior).
// Uses the zone center at y=500, where the soil lives.
export function zoneTempK(zoneKey) {
  const i = BIOMES.findIndex((b) => b.key === zoneKey);
  if (i < 0) return 0.5;
  const T = ambientTemp(biomeCenterX(i), 500); // 0..1
  return 0.15 + 0.85 * T;
}

// Decomposition-rate multiplier for a zone: 1.0 at founder biomass,
// 0.05 sterilized, ~2.9 at full bloom. The ledger-observable number.
export function decompMultiplier(world, zoneKey) {
  const s = world.soil && world.soil[zoneKey];
  const b = s && s.bacteria !== undefined ? s.bacteria : BACT_FOUNDER;
  return BACT_ABIO + (1 - BACT_ABIO) * Math.min(3, b / BACT_REF);
}

export function bacteriaOf(world, zoneKey) {
  const s = world.soil && world.soil[zoneKey];
  return s && s.bacteria !== undefined ? s.bacteria : BACT_FOUNDER;
}

// The sterilization probe's instrument: zero a zone's biomass.
export function sterilizeZone(world, zoneKey) {
  const s = world.soil && world.soil[zoneKey];
  if (s) s.bacteria = 0;
}

export function tickMicrobes(world, dt) {
  if (world.noFouling) return; // §13.7: the contamination-neutralize switch
  if (!world.soil) return;
  for (const b of BIOMES) {
    const s = world.soil[b.key];
    if (!s) continue;
    if (s.bacteria === undefined) s.bacteria = BACT_FOUNDER; // old saves / stub worlds
    const T = zoneTempK(b.key);
    const waste = s.waste || 0;
    // Monod growth on waste, temperature-scaled maintenance, and a slow
    // rain of immigrant spores — sterilized soil recolonizes, eventually.
    const growth = BACT_GROWTH * T * s.bacteria * (waste / (waste + BACT_HALF));
    const loss = BACT_MAINT * T * s.bacteria;
    const immig = BACT_IMMIG * T;
    const before = s.bacteria;
    s.bacteria = clamp(before + (growth - loss + immig) * dt, 0, BACT_MAX);
    // The ledger sees blooms and crashes — decomposition you can watch.
    if (world.events) {
      if (before < BACT_BLOOM && s.bacteria >= BACT_BLOOM) {
        world.events.push({ type: 'bacteriaBloom', zone: b.key, biomass: s.bacteria, t: world.time });
      } else if (before >= BACT_CRASH && s.bacteria < BACT_CRASH) {
        world.events.push({ type: 'bacteriaCrash', zone: b.key, biomass: s.bacteria, t: world.time });
      }
    }
  }
}
