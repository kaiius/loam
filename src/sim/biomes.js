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

export function biomeAt(x, y, layout = null) {
  const l = L(layout);
  const xc = Math.max(0, Math.min(l.width - 1, x));
  for (let i = 0; i < l.zones.length; i++) if (xc < l.zones[i].x1) return i;
  return l.zones.length - 1;
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
// the painted map is the answer. Altitude cools the reading via the lapse,
// so high peaks emerge as alpine without any painted "mountain = cold" rule.
export function biomeKeyAt(x, y, world = null) {
  const layout = world ? world.layout : null;
  if (world && world.climate) {
    const c = colAt(world.climate, x);
    const bi = biomeAt(x, y, layout);
    const waterKey = bi >= 5 ? BIOMES[bi].key : null; // water bodies are geography
    const lapse = Math.max(0, 800 - y) / 550;
    const Teff = Math.max(0, Math.min(1, c.T - lapse * 0.30));
    return whittakerKey(Teff, c.soil, waterKey);
  }
  return BIOMES[biomeAt(x, y, layout)].key;
}

export function biomeCenterX(i, layout = null) {
  const z = L(layout).zones[Math.max(0, Math.min(7, i))];
  return (z.x0 + z.x1) / 2;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Altitude cold + biome cold. Arctic: the honest cold, base 1.0.
// Mountains: altitude lapse — 0 at foothills (y≥700) → 1 above y≤250.
// Deep: water chill 0.3. Everywhere else: 0.
export function ambientCold(x, y, layout = null) {
  const b = biomeAt(x, y, layout);
  if (b === 0) return 1.0;
  if (b === 1) return clamp01((700 - y) / (700 - 250));
  if (b === 7) return 0.3;
  return 0;
}

// Desert interior → 1.0, ramping from 0.3 at the biome edges.
// Jungle 0.1, plains 0.2, everywhere else 0. The interior band scales with
// the generated desert zone (150px margins at size 1, verbatim).
export function ambientHeat(x, y, layout = null) {
  const b = biomeAt(x, y, layout);
  if (b === 4) {
    const l = L(layout);
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
