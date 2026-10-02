// Canopy v0.18 "Realms": the biome map.
//
// Eight contiguous regions, west → east, on a 4800×1100 canvas. Biomes are
// selection readers for the Bauplan body plan — not scenery. This module is
// pure geography: region layout, ambient temperature fields, waters, ground,
// and the per-biome flora table. No rng, no state, no behavior — the same
// inputs always give the same outputs.

export const WORLD_W = 4800;
export const WORLD_H = 1100;

// West → east: arctic, mountains, jungle, plains, desert, shallows,
// archipelago, deep. cx = region center x.
export const BIOMES = [
  { key: 'arctic', name: 'Arctic Wastes', x0: 0, x1: 600, cx: 300 },
  { key: 'mountains', name: 'Skyreach Mountains', x0: 600, x1: 1200, cx: 900 },
  { key: 'jungle', name: 'Emerald Jungle', x0: 1200, x1: 1800, cx: 1500 },
  { key: 'plains', name: 'Whispering Plains', x0: 1800, x1: 2400, cx: 2100 },
  { key: 'desert', name: 'Sunscorch Desert', x0: 2400, x1: 3000, cx: 2700 },
  { key: 'shallows', name: 'Mangrove Shallows', x0: 3000, x1: 3600, cx: 3300 },
  { key: 'archipelago', name: 'The Archipelago', x0: 3600, x1: 4200, cx: 3900 },
  { key: 'deep', name: 'Azure Deep', x0: 4200, x1: 4800, cx: 4500 },
];

// PAINTED_BIOMES: alias for the v1 painted world (name lookup).
export const PAINTED_BIOMES = BIOMES;

export function biomeAt(x, y, layout = null) {
  const l = L(layout);
  // v2: regions carry labels — return the region KEY.
  if (!l.canonical && l.regions) {
    const r = regionAt(x, l);
    return r ? r.label : 'plains';
  }
  // v1 (canonical): index into the painted zones.
  const xc = Math.max(0, Math.min(l.width - 1, x));
  for (let i = 0; i < l.zones.length; i++) if (xc < l.zones[i].x1) return i;
  return l.zones.length - 1;
}

// The region containing x. v2: from layout.regions; v1: synthetic region
// from the painted zones (label = biome key).
export function regionAt(x, layout = null) {
  const l = L(layout);
  const xc = Math.max(0, Math.min(l.width - 1, x));
  if (!l.canonical && l.regions) {
    for (const r of l.regions) if (xc >= r.x0 && xc < r.x1) return r;
    return l.regions[l.regions.length - 1];
  }
  for (let i = 0; i < l.zones.length; i++) {
    const z = l.zones[i];
    if (xc < z.x1) return { id: i, label: BIOMES[i].key, x0: z.x0, x1: z.x1, cx: (z.x0 + z.x1) / 2 };
  }
  const z = l.zones[l.zones.length - 1];
  return { id: 7, label: BIOMES[7].key, x0: z.x0, x1: z.x1, cx: (z.x0 + z.x1) / 2 };
}

import { createRng } from './rng.js';
import { whittakerKey, colAt } from './weather.js';
import { canonicalLayout } from './worldgen.js';

// v0.26 "Procedural worldgen": geography is layout-aware. Every function
// below takes an optional trailing `layout`; without one it answers from
// the canonical layout (the painted world, verbatim), so all existing
// coordinate-pinned behavior is unchanged. Worlds carry their generated
// layout at world.layout; sim call sites pass it through.

let _canon = null;
function canon() {
  if (!_canon) _canon = canonicalLayout(1);
  return _canon;
}
const L = (layout) => layout || canon();

// v0.23 "Weather": emergent biomes. With a world (climate state), the key
// comes from the Whittaker lookup on the generated T/M field — biomes drift
// as the climate evolves. Without one (pure geography: tests, renderers),
// the painted map (v1) or region label (v2) is the answer. Altitude cools
// the reading via the lapse, so high peaks emerge as alpine without any
// painted "mountain = cold" rule.
export function biomeKeyAt(x, y, world = null) {
  const layout = world ? world.layout : null;
  if (world && world.climate) {
    const c = colAt(world.climate, x);
    const lapse = Math.max(0, 800 - y) / 550;
    const Teff = Math.max(0, Math.min(1, c.T - lapse * 0.30));
    // Water-ness from the water table (v2: waterAt; v1: painted index ≥5).
    let waterKey = null;
    const w = waterAt(x, y, layout);
    if (w) {
      const l = L(layout);
      if (!l.canonical && l.regions) {
        const r = regionAt(x, l);
        waterKey = r && (r.label === 'shallows' || r.label === 'archipelago' || r.label === 'deep')
          ? r.label : 'shallows';
      } else {
        const bi = biomeAt(x, y, layout);
        waterKey = bi >= 5 ? BIOMES[bi].key : null;
      }
    }
    return whittakerKey(Teff, c.soil, waterKey);
  }
  const l = L(layout);
  if (!l.canonical && l.regions) {
    const r = regionAt(x, l);
    return r ? r.label : 'plains';
  }
  return BIOMES[biomeAt(x, y, layout)].key;
}

export function biomeCenterX(keyOrIndex, layout = null) {
  const l = L(layout);
  // v2: key (label string) → center of the LARGEST region with that label.
  // Number → region index (backward compat for migrated callers).
  if (!l.canonical && l.regions) {
    if (typeof keyOrIndex === 'string') {
      let best = null;
      for (const r of l.regions) {
        if (r.label !== keyOrIndex) continue;
        if (!best || (r.x1 - r.x0) > (best.x1 - best.x0)) best = r;
      }
      if (best) return (best.x0 + best.x1) / 2;
      return l.width / 2; // label absent: world center
    }
    const r = l.regions[Math.max(0, Math.min(l.regions.length - 1, keyOrIndex | 0))];
    return r ? (r.x0 + r.x1) / 2 : l.width / 2;
  }
  // v1: index into the painted zones.
  const z = l.zones[Math.max(0, Math.min(7, keyOrIndex | 0))];
  return (z.x0 + z.x1) / 2;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Altitude cold + biome cold. v1 (canonical): the painted rules — Arctic:
// the honest cold, base 1.0. Mountains: altitude lapse — 0 at foothills
// (y≥700) → 1 above y≤250. Deep: water chill 0.3. Everywhere else: 0.
// v2: physical — from the generated Tinit field (tempC = -10 + 45·T).
export function ambientCold(x, y, layout = null) {
  const l = L(layout);
  if (!l.canonical && l.regions) {
    const T = tinitAt(x, l);
    const tempC = -10 + 45 * T;
    return clamp01((10 - tempC) / 20); // 1.0 at ≤-10°C, 0 at ≥10°C
  }
  const b = biomeAt(x, y, layout);
  if (b === 0) return 1.0;
  if (b === 1) return clamp01((700 - y) / (700 - 250));
  if (b === 7) return 0.3;
  return 0;
}

// v1: Desert interior → 1.0, ramping from 0.3 at the biome edges.
// Jungle 0.1, plains 0.2, everywhere else 0. The interior band scales with
// the generated desert zone (150px margins at size 1, verbatim).
// v2: physical — from the generated Tinit field.
export function ambientHeat(x, y, layout = null) {
  const l = L(layout);
  if (!l.canonical && l.regions) {
    const T = tinitAt(x, l);
    const tempC = -10 + 45 * T;
    return clamp01((tempC - 22) / 13); // 1.0 at ≥35°C, 0 at ≤22°C
  }
  const b = biomeAt(x, y, layout);
  if (b === 4) {
    const dz = l.zones[4];
    const m = 150 * l.size;
    const lo = dz.x0 + m, hi = dz.x1 - m;
    if (x >= lo && x <= hi) return 1.0;
    const d = x < lo ? (x - dz.x0) / m : (dz.x1 - x) / m;
    return clamp01(0.3 + 0.7 * Math.max(0, Math.min(1, d)));
  }
  if (b === 2) return 0.1;
  if (b === 3) return 0.2;
  return 0;
}

// Tinit at x (v2). v1 layouts don't have it — return 0.5 (neutral).
function tinitAt(x, layout) {
  const l = L(layout);
  if (!l.Tinit) return 0.5;
  const i = Math.max(0, Math.min(l.Tinit.length - 1, Math.floor(x / 20)));
  return l.Tinit[i];
}

export function ambientTemp(x, y, layout = null) {
  return clamp01(0.5 + ambientHeat(x, y, layout) * 0.5 - ambientCold(x, y, layout) * 0.5);
}

// Waters: point-in-water test, read from the layout's generated water table
// (canonical default = the six painted rects, verbatim).
export function waterAt(x, y, layout = null) {
  for (const w of L(layout).waters) {
    if (x >= w.x0 && x < w.x1 && y >= w.surfaceY) return { surfaceY: w.surfaceY, salt: w.salt };
  }
  return null;
}

export function waterDepthAt(x, y, layout = null) {
  for (const w of L(layout).waters) {
    if (x >= w.x0 && x < w.x1 && y >= w.surfaceY) return w.depth;
  }
  return 0;
}

// Renderer-facing water list (world.waters-compatible shape).
export function waterRects(layout = null) {
  return L(layout).waters.map((w) => ({ x0: w.x0, x1: w.x1, surfaceY: w.surfaceY, salt: w.salt }));
}

// Ground level at x from the generated elevation field (null = open water).
// Canonical default reproduces the painted groundYAt exactly.
export function groundYAt(x, layout = null) {
  const l = L(layout);
  const i = Math.max(0, Math.min(l.ground.length - 1, Math.floor(x / 20)));
  return l.ground[i];
}

// Per-biome flora table (§5). morph selects the render path; the three
// *TolBias fields are added to the plant genome's heatTol/coldTol/saltTol
// alleles at spawn; fruitKind is the food entity kind; yield scales fruiting.
export function floraFor(biomeKey) {
  const t = {
    arctic:      { morph: 'moss',     heatTolBias: -0.4, coldTolBias:  0.7, saltTolBias: 0,   fruitKind: 'moss',        yield: 0.2 },
    mountains:   { morph: 'shrub',    heatTolBias: -0.2, coldTolBias:  0.6, saltTolBias: 0,   fruitKind: 'berry',       yield: 0.6 },
    jungle:      { morph: 'tree',     heatTolBias:  0,   coldTolBias:  0,   saltTolBias: 0,   fruitKind: 'fruit',       yield: 0.7 },
    plains:      { morph: 'grass',    heatTolBias:  0.1, coldTolBias:  0,   saltTolBias: 0,   fruitKind: 'seed',        yield: 0.4 },
    desert:      { morph: 'cactus',   heatTolBias:  0.6, coldTolBias: -0.2, saltTolBias: 0,   fruitKind: 'cactusfruit', yield: 0.5 },
    shallows:    { morph: 'mangrove', heatTolBias:  0.1, coldTolBias:  0,   saltTolBias: 0.6, fruitKind: 'propagule',   yield: 0.5 },
    archipelago: { morph: 'palm',     heatTolBias:  0.2, coldTolBias: -0.1, saltTolBias: 0.4, fruitKind: 'fruit',       yield: 0.6 },
    deep:        { morph: 'kelp',      heatTolBias:  0,   coldTolBias:  0.2, saltTolBias: 0.7, fruitKind: 'kelp',        yield: 0.5 },
  }[biomeKey];
  return t ? { ...t }
    : { morph: 'tree', heatTolBias: 0, coldTolBias: 0, saltTolBias: 0, fruitKind: 'fruit', yield: 0.5 };
}
