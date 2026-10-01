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

export function biomeAt(x, y) {
  const xc = Math.max(0, Math.min(WORLD_W - 1, x));
  return Math.min(7, Math.floor(xc / 600));
}

export function biomeKeyAt(x, y) {
  return BIOMES[biomeAt(x, y)].key;
}

export function biomeCenterX(i) {
  return BIOMES[Math.max(0, Math.min(7, i))].cx;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Altitude cold + biome cold. Arctic: the honest cold, base 1.0.
// Mountains: altitude lapse — 0 at foothills (y≥700) → 1 above y≤250.
// Deep: water chill 0.3. Everywhere else: 0.
export function ambientCold(x, y) {
  const b = biomeAt(x, y);
  if (b === 0) return 1.0;
  if (b === 1) return clamp01((700 - y) / (700 - 250));
  if (b === 7) return 0.3;
  return 0;
}

// Desert interior (x2550–2850) → 1.0, ramping from 0.3 at the biome edges.
// Jungle 0.1, plains 0.2, everywhere else 0.
export function ambientHeat(x, y) {
  const b = biomeAt(x, y);
  if (b === 4) {
    if (x >= 2550 && x <= 2850) return 1.0;
    const d = x < 2550 ? (x - 2400) / 150 : (3000 - x) / 150;
    return clamp01(0.3 + 0.7 * Math.max(0, Math.min(1, d)));
  }
  if (b === 2) return 0.1;
  if (b === 3) return 0.2;
  return 0;
}

export function ambientTemp(x, y) {
  return clamp01(0.5 + ambientHeat(x, y) * 0.5 - ambientCold(x, y) * 0.5);
}

// Waters: point-in-water test. Returns null outside water, or
// { surfaceY, salt } when the point (x, y) is at/below the surface.
// depth is internal (used for minnow movement bounds).
const WATERS = [
  { x0: 1300, x1: 1400, surfaceY: 790, depth: 35, salt: false },  // jungle pool, west
  { x0: 1600, x1: 1700, surfaceY: 790, depth: 35, salt: false },  // jungle pool, east
  { x0: 2680, x1: 2760, surfaceY: 820, depth: 40, salt: false },  // desert oasis
  { x0: 3000, x1: 3600, surfaceY: 800, depth: 150, salt: true },  // shallows (seabed 950)
  { x0: 3600, x1: 4200, surfaceY: 800, depth: 120, salt: true },  // archipelago channels
  { x0: 4200, x1: 4800, surfaceY: 700, depth: 350, salt: true },   // deep (bottom 1050)
];

export function waterAt(x, y) {
  for (const w of WATERS) {
    if (x >= w.x0 && x < w.x1 && y >= w.surfaceY) return { surfaceY: w.surfaceY, salt: w.salt };
  }
  return null;
}

export function waterDepthAt(x, y) {
  for (const w of WATERS) {
    if (x >= w.x0 && x < w.x1 && y >= w.surfaceY) return w.depth;
  }
  return 0;
}

// Renderer-facing water list (world.waters-compatible shape).
export function waterRects() {
  return WATERS.map((w) => ({ x0: w.x0, x1: w.x1, surfaceY: w.surfaceY, salt: w.salt }));
}

// Ground level at x, or null for open water (archipelago gaps, deep).
// Mountains have partial ground — the foothill shelf and the east shelf.
const ARCHIPELAGO_ISLANDS = [[3600, 3860], [4060, 4180]]; // v0.20: the [3720,3740] seam is filled — one island
export function groundYAt(x) {
  const b = biomeAt(x, 0);
  switch (b) {
    case 0: return 800;                                            // arctic ice
    // v0.20: the [760,1040] gap is filled ground now — mountains are
    // continuous foothills, no holes.
    case 1: return 800;
    case 2: return 800;                                            // jungle floor
    case 3: return 820;                                            // plains
    case 4: return 830;                                            // desert
    case 5: return 950;                                            // shallows seabed (walkable, wading)
    case 6:
      for (const [a, z] of ARCHIPELAGO_ISLANDS) if (x >= a && x < z) return 780;
      return null;                                                 // open water between islands
    default: return null;                                          // deep: open water
  }
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
