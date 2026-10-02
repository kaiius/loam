// Canopy v0.26 "Procedural worldgen": seeded tectonic-like geography.
//
// The 8-zone west→east layout is the INVARIANT structure — biomes are
// selection readers for the Bauplan, not scenery, and the zone order never
// changes. Everything WITHIN the structure is generated per seed:
//
//   - uplift noise: seeded value-noise fBm perturbs ground elevation per
//     zone (mountains gain real peaks, deserts gain dunes)
//   - sea level: drawn per world; terrain below it floods (salt in the water
//     zones, fresh in the land zones)
//   - erosion: box-blur smoothing passes over the elevation field
//   - platforms: instantiated from per-zone structural templates in relative
//     coordinates. X-spans are the invariant (climb-link topology is
//     preserved exactly); ground-kind platforms rest ON the generated
//     terrain, other kinds take small bounded y-jitter
//   - waters: flood rects from the terrain + explicit deep/archipelago water
//     + generated freshwater ponds (jungle ×2, desert oasis ×1)
//
// World size is a worldgen parameter: zone widths scale by `size` and each
// zone's structural motif repeats per cluster, so platform count scales with
// horizontal extent. Founder cohorts scale with size to hold encounter
// density near the baseline.
//
// The viability gate (fruit, water, traversable space, reachable platforms,
// unflooded founder spawns) rejects bad rolls; failures re-roll
// deterministically — the attempt counter is mixed into the worldgen stream
// seed, so the same (seed, size) always takes the same attempts and lands on
// the same layout. Bit-for-bit deterministic: same (seed, size) → identical
// layout. Worldgen draws ONLY from its own stream (never world.rng), so
// founder genomes and the main stream's sequence are untouched.

import { createRng } from './rng.js';

export const ZONE_KEYS = ['arctic', 'mountains', 'jungle', 'plains', 'desert', 'shallows', 'archipelago', 'deep'];
export const BASE_ZONE_W = 600;
export const BASE_WORLD_W = 4800;
const WG_WORLD_H = 1100; // bundle note: biomes.js owns the shared WORLD_H const — one declaration per scope
export const TERRAIN_COL = 20; // px per elevation column

// Emission order of the painted platform list (NOT west→east — the painted
// order keeps every platform index stable: jungle 0–8, arctic 9–14,
// mountains 15–23, plains 24–25, desert 26–29, shallows 30–35,
// archipelago 36–41, deep 42–44, fills 45–46).
const EMIT_ORDER = ['jungle', 'arctic', 'mountains', 'plains', 'desert', 'shallows', 'archipelago', 'deep'];

// --- deterministic value noise (pure: no rng draws, bit-stable) --------------

function hash01(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, seed) {
  const ix = Math.floor(x), fx = x - ix;
  const a = hash01(Math.imul(ix, 374761393) + Math.imul(seed, 668265263));
  const b = hash01(Math.imul(ix + 1, 374761393) + Math.imul(seed, 668265263));
  const u = fx * fx * (3 - 2 * fx);
  return a + (b - a) * u;
}

function fbm(x, seed, oct = 3) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x * f, seed + o * 101);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm; // [0,1)
}

// --- the tectonic template ---------------------------------------------------
// base: painted ground elevation; amp: uplift-noise amplitude (px).

const ZONE_GEO = {
  arctic:      { base: 800, amp: 8 },
  mountains:   { base: 800, amp: 55 },
  jungle:      { base: 800, amp: 12 },
  plains:      { base: 820, amp: 18 },
  desert:      { base: 830, amp: 25 },
  shallows:    { base: 950, amp: 10 },
  archipelago: { base: 780, amp: 12 },
  deep:        { base: null, amp: 0 }, // open water — no terrain
};

// Platform structural templates: [dx0, dx1, dy, kind, solid?] — dx as a
// fraction of zone width, dy as px offset from the zone ground base.
// Transcribed from the v0.20 painted layout; the relative coordinates ARE
// the invariant canopy structure.
const TEMPLATES = {
  jungle: [
    [0, 1, 0, 'ground'],
    [0.0375, 0.325, -150, 'branch'],
    [0.3, 0.6125, -160, 'branch'],
    [0.5875, 0.9625, -150, 'branch'],
    [0.125, 0.4375, -330, 'branch'],
    [0.4125, 0.7375, -340, 'branch'],
    [0.7, 0.975, -330, 'branch'],
    [0.2, 0.5375, -510, 'branch'],
    [0.5125, 0.8125, -520, 'branch'],
  ],
  arctic: [
    [0, 1, 0, 'ground'],
    [0.05, 0.55, -14, 'shelf'],
    [0.3833, 0.8833, -18, 'shelf'],
    [0.1833, 0.6833, -9, 'shelf'],
    [0.5833, 0.95, -13, 'shelf'],
    [0.1, 0.4333, -5, 'shelf'],
  ],
  mountains: [
    [0, 0.2667, 0, 'ground'],
    [0.7333, 1, 0, 'ground'],
    [0, 0.2667, -100, 'branch'],
    [0.1, 0.3667, -192, 'branch'],
    [0.2, 0.4667, -283, 'branch'],
    [0.3, 0.5667, -375, 'branch'],
    [0.4, 0.6667, -467, 'branch'],
    [0.5, 0.7667, -558, 'branch'],
    [0.6, 0.8667, -650, 'branch'],
  ],
  plains: [
    [0, 1, 0, 'ground'],
    [0.25, 0.75, -120, 'ridge', true],
  ],
  desert: [
    [0, 1, 0, 'ground'],
    [0.0833, 0.3333, -125, 'rock', true],
    [0.4167, 0.6667, -130, 'rock', true],
    [0.6667, 0.9167, -120, 'rock', true],
  ],
  shallows: [
    [0, 1, 0, 'ground'],
    [0.0333, 0.3333, -180, 'branch'],
    [0.3667, 0.6667, -185, 'branch'],
    [0.7, 0.9667, -180, 'branch'],
    [0.0833, 0.3667, -172, 'branch'],
    [0.4667, 0.7333, -178, 'branch'],
  ],
  archipelago: [
    [0, 0.2, 0, 'ground'],
    [0.0333, 0.1667, -80, 'branch'],
    [0.2333, 0.4333, 0, 'ground'],
    [0.2667, 0.4, -80, 'branch'],
    [0.7667, 0.9667, 0, 'ground'],
    [0.8, 0.9333, -80, 'branch'],
  ],
  deep: [
    [0.0833, 0.3333, -110, 'floe'],
    [0.2417, 0.4917, -110, 'floe'],
    [0.4083, 0.6083, -110, 'floe'],
  ],
};

// Ground-fill platforms, emitted AFTER all zones (keeps indices 45–46 at
// size 1): the mountains foothill fill and the archipelago seam fill.
const FILLS = [
  { zone: 'mountains', dx0: 0.2667, dx1: 0.7333, kind: 'ground' },
  { zone: 'archipelago', dx0: 0.2, dx1: 0.2333, kind: 'ground' },
];

// The painted waters — the canonical layout's water table, verbatim.
const PAINTED_WATERS = [
  { x0: 1300, x1: 1400, surfaceY: 790, depth: 35, salt: false },
  { x0: 1600, x1: 1700, surfaceY: 790, depth: 35, salt: false },
  { x0: 2680, x1: 2760, surfaceY: 820, depth: 40, salt: false },
  { x0: 3000, x1: 3600, surfaceY: 800, depth: 150, salt: true },
  { x0: 3600, x1: 4200, surfaceY: 800, depth: 120, salt: true },
  { x0: 4200, x1: 4800, surfaceY: 700, depth: 350, salt: true },
];

const SALT_ZONES = new Set(['shallows', 'archipelago', 'deep']);

// --- climb links (moved here from world.js: the gate needs them) -------------

export function computeClimbLinks(platforms) {
  const links = [];
  for (let a = 0; a < platforms.length; a++) {
    for (let b = a + 1; b < platforms.length; b++) {
      const pa = platforms[a]; const pb = platforms[b];
      const overlap = Math.min(pa.x2, pb.x2) - Math.max(pa.x1, pb.x1);
      const gap = Math.abs(pa.y - pb.y);
      if (overlap > 60 && gap >= 60 && gap <= 240) {
        links.push({ a, b, x1: Math.max(pa.x1, pb.x1), x2: Math.min(pa.x2, pb.x2) });
      }
    }
  }
  return links;
}

// --- layout construction -----------------------------------------------------

function zoneIndexAtX(zones, x) {
  for (let i = 0; i < zones.length; i++) if (x < zones[i].x1) return i;
  return zones.length - 1;
}

function terrainAt(layout, x) {
  const i = Math.max(0, Math.min(layout.ground.length - 1, Math.floor(x / TERRAIN_COL)));
  return layout.ground[i];
}

function waterAtLayout(layout, x, y) {
  for (const w of layout.waters) {
    if (x >= w.x0 && x < w.x1 && y >= w.surfaceY) return w;
  }
  return null;
}

function buildTerrain(seed, size, zones, canonical) {
  const width = BASE_WORLD_W * size;
  const n = Math.ceil(width / TERRAIN_COL);
  const ground = new Array(n).fill(null);
  // The archipelago channel (open water between the islands) is carved in
  // both branches — the painted map has null there, not 780.
  const chan = zones[6];
  const chanX0 = chan.x0 + 0.4333 * (chan.x1 - chan.x0);
  const chanX1 = chan.x0 + 0.7667 * (chan.x1 - chan.x0);
  if (canonical) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * TERRAIN_COL;
      const zi = zoneIndexAtX(zones, x);
      if (zi === 6 && x >= chanX0 && x < chanX1) { ground[i] = null; continue; }
      ground[i] = ZONE_GEO[ZONE_KEYS[zi]].base;
    }
    return ground;
  }
  const noiseSeed = ((seed * 31 + 7) >>> 0) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * TERRAIN_COL;
    const zi = zoneIndexAtX(zones, x);
    const g = ZONE_GEO[ZONE_KEYS[zi]];
    if (g.base === null) { ground[i] = null; continue; }
    if (zi === 6 && x >= chanX0 && x < chanX1) { ground[i] = null; continue; }
    ground[i] = g.base + g.amp * (fbm(x / 900, noiseSeed + zi * 1017, 3) * 2 - 1);
  }
  // Erosion: two box-blur passes (radius 2). Nulls are water — they neither
  // blur nor get blurred into. The field is rounded to integers afterwards:
  // platform y-values are rounded terrain, and groundYAt must agree with
  // them exactly (a 0.09px rounding gap once let a sound ray slip under a
  // ridge foot).
  for (let pass = 0; pass < 2; pass++) {
    const next = ground.slice();
    for (let i = 0; i < n; i++) {
      if (ground[i] === null) continue;
      let sum = 0, cnt = 0;
      for (let k = -2; k <= 2; k++) {
        const v = ground[i + k];
        if (v !== null && v !== undefined) { sum += v; cnt++; }
      }
      next[i] = sum / cnt;
    }
    for (let i = 0; i < n; i++) ground[i] = next[i];
  }
  for (let i = 0; i < n; i++) if (ground[i] !== null) ground[i] = Math.round(ground[i]);
  return ground;
}

function buildWaters(layout, gen, canonical) {
  if (canonical) return PAINTED_WATERS.map((w) => ({ ...w }));
  const waters = [];
  const { zones, ground, seaY } = layout;
  // Flood rects: contiguous terrain columns below sea level.
  let run = null;
  const flush = () => {
    if (!run) return;
    const zi = zoneIndexAtX(zones, (run.x0 + run.x1) / 2);
    waters.push({
      x0: run.x0, x1: run.x1, surfaceY: seaY,
      depth: Math.max(30, run.deep - seaY + 20),
      salt: SALT_ZONES.has(ZONE_KEYS[zi]),
    });
    run = null;
  };
  for (let i = 0; i < ground.length; i++) {
    const g = ground[i];
    if (g !== null && g > seaY) {
      const x0 = i * TERRAIN_COL, x1 = x0 + TERRAIN_COL;
      if (run) { run.x1 = x1; run.deep = Math.max(run.deep, g); }
      else run = { x0, x1, deep: g };
    } else flush();
  }
  flush();
  // The archipelago channel + the deep: explicit open water (terrain is null
  // there by construction, so flooding can't see them). The archipelago
  // shares the ocean surface; the deep is the abyssal zone (painted 700).
  waters.push({ x0: zones[6].x0, x1: zones[6].x1, surfaceY: seaY, depth: 120, salt: true });
  waters.push({ x0: zones[7].x0, x1: zones[7].x1, surfaceY: 700, depth: 350, salt: true });
  // Freshwater ponds: jungle ×2, desert oasis ×1 — the drinking water.
  const pond = (zoneKey, wdt, depth) => {
    const z = zones[ZONE_KEYS.indexOf(zoneKey)];
    const x = z.x0 + (z.x1 - z.x0) * (0.2 + 0.6 * gen.next());
    const g = terrainAt(layout, x);
    const surfaceY = (g === null ? 800 : g) - 10;
    waters.push({ x0: x - wdt / 2, x1: x + wdt / 2, surfaceY, depth, salt: false });
  };
  pond('jungle', 100, 35); pond('jungle', 100, 35); pond('desert', 80, 40);
  // Merge overlapping/touching rects with the same salinity AND a matching
  // water level (the archipelago ocean must not fuse with the abyssal deep).
  waters.sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const w of waters) {
    const m = merged[merged.length - 1];
    if (m && m.salt === w.salt && w.x0 <= m.x1 + 1 && Math.abs(m.surfaceY - w.surfaceY) <= 40) {
      m.x1 = Math.max(m.x1, w.x1);
      m.surfaceY = Math.min(m.surfaceY, w.surfaceY);
      m.depth = Math.max(m.depth, w.depth);
    } else merged.push({ ...w });
  }
  return merged;
}

function buildPlatforms(layout, gen, canonical) {
  const { zones, size } = layout;
  const clusters = Math.max(1, Math.round(size));
  const platforms = [];
  const byZone = {};
  for (const k of ZONE_KEYS) byZone[k] = [];
  const zoneByKey = {};
  for (const z of zones) zoneByKey[z.key] = z;
  const jit = (amt) => canonical ? 0 : gen.range(-amt, amt);
  for (const key of EMIT_ORDER) {
    const z = zoneByKey[key];
    const zw = z.x1 - z.x0;
    const cw = zw / clusters;
    const base = ZONE_GEO[key].base === null ? 800 : ZONE_GEO[key].base;
    for (let c = 0; c < clusters; c++) {
      const cx0 = z.x0 + c * cw;
      const tmpl = TEMPLATES[key];
      for (let ti = 0; ti < tmpl.length; ti++) {
        const [dx0, dx1, dy, kind, solid] = tmpl[ti];
        const x1 = cx0 + dx0 * cw, x2 = cx0 + dx1 * cw;
        const cx = (x1 + x2) / 2;
        let y;
        if (kind === 'ground') {
          const g = terrainAt(layout, cx);
          y = g === null ? base : Math.round(g);
        } else {
          const j = kind === 'shelf' || kind === 'floe' ? 5 : 8;
          y = Math.round(base + dy + jit(j));
        }
        const p = { x1: Math.round(x1 * 10) / 10, x2: Math.round(x2 * 10) / 10, y, kind, zone: key };
        if (solid) p.solid = true;
        p.pi = platforms.length;
        p.ord = ti; // template ordinal — the gate's link-identity key
        platforms.push(p);
        byZone[key].push(p);
      }
    }
  }
  // Ground fills, emitted last (indices 45–46 at size 1).
  for (const f of FILLS) {
    const z = zoneByKey[f.zone];
    const zw = z.x1 - z.x0;
    const cw = zw / clusters;
    for (let c = 0; c < clusters; c++) {
      const cx0 = z.x0 + c * cw;
      const x1 = cx0 + f.dx0 * cw, x2 = cx0 + f.dx1 * cw;
      const g = terrainAt(layout, (x1 + x2) / 2);
      const base = ZONE_GEO[f.zone].base;
      const p = {
        x1: Math.round(x1 * 10) / 10, x2: Math.round(x2 * 10) / 10,
        y: g === null ? base : Math.round(g), kind: f.kind, zone: f.zone,
      };
      p.pi = platforms.length;
      p.ord = -1; // fills carry no template ordinal — never link-required
      platforms.push(p);
      byZone[f.zone].push(p);
    }
  }
  return { platforms, byZone };
}

// The canonical layout: the painted world as a layout — zero noise, painted
// waters/platforms. The pure geography functions in biomes.js default to
// this, so every coordinate-pinned test keeps its meaning.
export function canonicalLayout(size = 1) {
  const zones = ZONE_KEYS.map((key, i) => ({
    key, x0: i * BASE_ZONE_W * size, x1: (i + 1) * BASE_ZONE_W * size,
    cx: (i + 0.5) * BASE_ZONE_W * size,
  }));
  const layout = {
    seed: 0, size, attempt: -1, canonical: true,
    width: BASE_WORLD_W * size, height: WG_WORLD_H,
    zones, seaY: 800, ground: null, waters: null,
    platforms: null, platformsByZone: null,
  };
  layout.ground = buildTerrain(0, size, zones, true);
  layout.waters = buildWaters(layout, null, true);
  const { platforms, byZone } = buildPlatforms(layout, null, true);
  layout.platforms = platforms;
  layout.platformsByZone = byZone;
  return layout;
}

// Seeded procedural layout — v2 generative geography (design/worldgen-v2.md).
// Draw order on the worldgen stream is load-bearing (documented; never
// reorder): landFrac target → noise frequencies → ridge params → rift
// params → climate wave → founder canopy (west→east, bottom-up) →
// secondary canopies (west→east) → other-region platforms (west→east) →
// pond positions.
export function generateLayout(seed, size = 1, attempt = 0, gentle = false) {
  const gen = createRng(mixSeedV2(seed, size, attempt + (gentle ? 10000 : 0)));
  const width = BASE_WORLD_W * size;
  const layout = {
    seed, size, attempt, canonical: false, v: 2,
    width, height: WG_WORLD_H,
    zones: null, // retired in v2 — use regions
    platformsByZone: null, // retired in v2 — use regions[].platformPis + founder
    seaY: 0, ground: null, slope: null, waters: null, substrate: null,
    Tinit: null, thermalEquatorX: 1500, regions: null, colLabel: null,
    lakeCols: null, platforms: null, founder: null, log: [],
  };
  const landFracTarget = 0.55 + gen.range(0, 0.15);
  const { ground, slope } = buildElevationV2(gen, width, gentle);
  layout.ground = ground;
  layout.slope = slope; // pre-rounding slope (spec-review P2)
  layout.seaY = computeSeaLevelV2(ground, landFracTarget);
  layout.substrate = classifySubstrateV2(ground, slope, layout.seaY);
  buildTinitV2(gen, layout, gentle); // sets Tinit + thermalEquatorX
  buildRegionsV2(layout); // sets regions, colLabel, lakeCols
  buildCanopyV2(layout, gen); // sets platforms, founder, regions[].platformPis
  layout.waters = buildWatersV2(layout, gen);
  return layout;
}

// --- the viability gate v2 (§8) ---
// G1 fruit (founder canopy) · G2 water (fresh) · G3 traversable (founder
// BFS) · G4 reachable (ground-linked components, floes exempt) · G5 spawns
// · G6 terrain (Paul's) · G7 founder region. Reject-and-resample; the
// attempt counter is mixed into the stream seed.

export function viabilityGate(layout) {
  // v1 (canonical): the painted world is viable by construction.
  if (layout.canonical) return { ok: true, failures: [] };
  const failures = [];
  const F = layout.founder;
  const P = layout.platforms || [];
  // G1 — fruit: the founder canopy carries the founder economy.
  if (!F || F.branchPis.length < 6)
    failures.push(`fruit: founder canopy has ${F ? F.branchPis.length : 0} branches, need 6`);
  if (!F || F.fruitSlots < 8)
    failures.push(`fruit: founder canopy has ${F ? F.fruitSlots : 0} fruit slots, need 8`);
  // G2 — water: at least one freshwater body (drinking).
  const fresh = (layout.waters || []).filter((w) => !w.salt).length;
  if (fresh < 1) failures.push('water: no freshwater');
  // Climb-link adjacency for the BFS checks.
  const links = computeClimbLinks(P);
  const adj = new Map();
  for (const l of links) {
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a).push(l.b); adj.get(l.b).push(l.a);
  }
  const bfs = (root) => {
    const seen = new Set([root]);
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop();
      for (const m of adj.get(cur) || []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    return seen;
  };
  // G3 — traversable: BFS from the founder ground reaches every founder platform.
  if (F && F.groundPis.length) {
    const seen = bfs(F.groundPis[0]);
    const stranded = [...F.groundPis, ...F.branchPis].filter((pi) => !seen.has(pi));
    if (stranded.length) failures.push(`traversable: founder platforms stranded: ${stranded.join(',')}`);
  } else if (F) {
    failures.push('traversable: founder canopy has no ground platform');
  }
  // G4 — reachable: every platform belongs to a component containing a
  // ground segment — except floes, swum to by design.
  if (P.length) {
    const comp = new Map();
    let cid = 0;
    for (const p of P) {
      if (comp.has(p.pi)) continue;
      for (const m of bfs(p.pi)) comp.set(m, cid);
      cid++;
    }
    const compHasGround = new Set();
    for (const p of P) if (p.kind === 'ground') compHasGround.add(comp.get(p.pi));
    const bad = P.filter((p) => p.kind !== 'floe' && !compHasGround.has(comp.get(p.pi)));
    if (bad.length)
      failures.push(`reachable: ${bad.length} platforms lack ground-linked components: ${bad.slice(0, 8).map((p) => p.pi).join(',')}`);
  }
  // G5 — founder ground not deeply submerged; cohort finders resolve
  // (missing non-founder cohort → skip + log, not a failure).
  if (F && F.groundPis.length) {
    const gp = P[F.groundPis[0]];
    if (gp) {
      const w = waterAtLayout(layout, (gp.x1 + gp.x2) / 2, gp.y);
      if (w && gp.y > w.surfaceY + 30) failures.push('spawn: founder ground deeply submerged');
    }
  }
  for (const f of Object.keys(COHORT_FINDERS)) {
    if (f === 'founder') continue; // G7 covers the founder
    if (!findRegion(layout, f)) (layout.log = layout.log || []).push(`spawn: finder '${f}' found no region — cohort skipped`);
  }
  // G6 — terrain (Paul's): land fraction, largest landmass, max slope.
  const n = layout.ground.length;
  let land = 0;
  for (let i = 0; i < n; i++) if (layout.ground[i] <= layout.seaY) land++;
  const landFrac = land / n;
  if (landFrac < 0.40 || landFrac > 0.85)
    failures.push(`terrain: land fraction ${landFrac.toFixed(2)} outside 0.40–0.85`);
  let run = 0, best = 0;
  for (let i = 0; i < n; i++) {
    if (layout.ground[i] <= layout.seaY) { run++; best = Math.max(best, run); }
    else run = 0;
  }
  if (best < n * 0.25) failures.push(`terrain: fragmented land (best run ${(best / n).toFixed(2)})`);
  let maxSlope = 0;
  for (let i = 0; i < n; i++) maxSlope = Math.max(maxSlope, layout.slope[i]);
  if (maxSlope > 2.5) failures.push(`terrain: sheer cliff (slope ${maxSlope.toFixed(2)})`);
  // G7 — the founder region exists.
  if (!F) failures.push('founder: no founder region (no jungle-soil ≥700px, no soil ≥500px)');
  return { ok: failures.length === 0, failures };
}

export const MAX_ATTEMPTS = 100;

// Roll layouts until the gate passes. Deterministic: the attempt counter is
// part of the stream seed, so (seed, size) always lands on the same layout.
// v2 never throws on a bad seed: after MAX_ATTEMPTS the gentle fallback
// (damped terrain, uniform warm climate) takes over — also deterministic.
export function rollLayout(seed, size = 1) {
  let layout = null, gate = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    layout = generateLayout(seed, size, attempt);
    gate = viabilityGate(layout);
    if (gate.ok) return { layout, gate, attempts: attempt + 1 };
  }
  for (let k = 0; k < 50; k++) {
    layout = generateLayout(seed, size, k, true);
    gate = viabilityGate(layout);
    if (gate.ok) {
      layout.log.push(`fallback: gentle attempt ${k} accepted`);
      return { layout, gate, attempts: MAX_ATTEMPTS + k + 1, fallback: true };
    }
  }
  throw new Error(
    `v2 worldgen: even the gentle fallback failed after 50 attempts ` +
    `(seed ${seed}, size ${size}): ${gate.failures.join('; ')}`
  );
}

// ============ v2 generative worldgen (design/worldgen-v2.md) ============
// Paul-style: generate initial conditions (elevation, water, substrate),
// not biomes. Biome labels emerge from the climate afterward. The v1
// painted-template pipeline above is preserved verbatim for
// canonicalLayout (the byte-identical default world and test fixture).

// Substrate materials — physical properties the atmosphere reads.
// These are MATERIALS, not biomes.
export const SUBSTRATE = {
  DEEP_WATER: 0, SHALLOW_WATER: 1, SAND: 2, SOIL: 3, ROCK: 4, ALPINE: 5,
};
export const SUBSTRATE_PROPS = [
  { albedo: 0.08, heatcap: 3.0, retention: 1.0, fertility: 0.0 }, // DEEP_WATER
  { albedo: 0.10, heatcap: 2.2, retention: 1.0, fertility: 0.1 }, // SHALLOW_WATER
  { albedo: 0.32, heatcap: 0.8, retention: 0.25, fertility: 0.25 }, // SAND
  { albedo: 0.22, heatcap: 1.0, retention: 0.7, fertility: 1.0 }, // SOIL
  { albedo: 0.18, heatcap: 1.1, retention: 0.3, fertility: 0.15 }, // ROCK
  { albedo: 0.55, heatcap: 0.9, retention: 0.4, fertility: 0.05 }, // ALPINE
];
export const SUBSTRATE_NAMES = ['deep-water', 'shallow-water', 'sand', 'soil', 'rock', 'alpine'];

// v2 stream mixer — the 0x27 tag separates v2 streams from v0.26 (0x26).
function mixSeedV2(seed, size, attempt) {
  return ((((seed * 2654435761) ^ (Math.round(size * 1000) * 40503) ^ (attempt * 65599) ^ 0x27) >>> 0) || 1);
}

// --- elevation (§2): seeded noise octaves + tectonic ridges + rift basins ---
// Returns { ground: int[] (rounded, every column has an elevation — water is
// decided by sea level afterward), slope: Float32Array (pre-rounding),
// n }. No nulls: the field is free.

function buildElevationV2(gen, width, gentle = false) {
  const n = Math.ceil(width / TERRAIN_COL);
  // Draw order (load-bearing): frequencies + noise seed first.
  const o1 = 0.0016 + gen.range(0, 0.0008);
  const o2 = 0.006 + gen.range(0, 0.003);
  const o3 = 0.02 + gen.range(0, 0.01);
  const sN = gen.int(1, 1e9);
  const field = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * TERRAIN_COL;
    field[i] = 800
      + (fbm(x * o1, sN, 3) - 0.5) * 150
      + (fbm(x * o2 + 500, sN + 1, 3) - 0.5) * 60
      + (fbm(x * o3 + 900, sN + 2, 3) - 0.5) * 22;
  }
  if (!gentle) {
  // Tectonic ridges: 1–3 gaussian uplifts — mountains, not dunes.
  const ridges = 1 + gen.int(0, 2);
  for (let k = 0; k < ridges; k++) {
    const cx = gen.range(width * 0.15, width * 0.85);
    const wdt = gen.range(180, 420), hgt = gen.range(180, 340);
    for (let i = 0; i < n; i++) {
      const d = ((i + 0.5) * TERRAIN_COL - cx) / wdt;
      if (d > -3 && d < 3) field[i] -= hgt * Math.exp(-d * d);
    }
  }
  // Rift basins: 60% chance of one sunken basin (future lakebed/seaway).
  if (gen.next() < 0.6) {
    const cx = gen.range(width * 0.2, width * 0.8);
    const wdt = gen.range(120, 260), dep = gen.range(80, 160);
    for (let i = 0; i < n; i++) {
      const d = ((i + 0.5) * TERRAIN_COL - cx) / wdt;
      if (d > -3 && d < 3) field[i] += dep * Math.exp(-d * d);
    }
  }
  } // !gentle
  // Edge pinning: no sheer cliffs at the world boundary.
  for (let i = 0; i < 12; i++) {
    const t = i / 12, s = t * t * (3 - 2 * t);
    field[i] = field[12] + (field[i] - field[12]) * s;
    const j = n - 1 - i;
    field[j] = field[n - 13] + (field[j] - field[n - 13]) * s;
  }
  if (gentle) {
    // Fallback terrain: damp the relief toward the baseline — gentle,
    // rollable, all soil.
    for (let i = 0; i < n; i++) field[i] = 800 + (field[i] - 800) * 0.35;
  }
  // Erosion: two box-blur passes (radius 2), then round to integers
  // (the 0.09px rounding-gap lesson: platform y-values are rounded terrain).
  let cur = Array.from(field);
  for (let pass = 0; pass < 2; pass++) {
    const next = cur.slice();
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let k = -2; k <= 2; k++) {
        const v = cur[i + k];
        if (v !== undefined) { sum += v; cnt++; }
      }
      next[i] = sum / cnt;
    }
    cur = next;
  }
  // Slope on the PRE-ROUNDED field (spec-review P2: rounding first would
  // stairstep the rock/soil transitions).
  const slope = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e0 = cur[Math.max(0, i - 1)], e1 = cur[Math.min(n - 1, i + 1)];
    slope[i] = Math.abs(e1 - e0) / (2 * TERRAIN_COL);
  }
  const ground = cur.map((v) => Math.round(v));
  return { ground, slope, n };
}

// --- sea level (§3): elevation quantile for the land-fraction target ---
// NOTE (builder correction to the design): the design wrote the quantile
// as (1-landFrac), which yields (1-landFrac) LAND — inverted. For a land
// fraction L we need L of columns with ground ≤ seaY, i.e. the L quantile
// of the ascending-sorted field. (Paul's v0.18 has the same inversion;
// his gate just re-rolls through it.)
function computeSeaLevelV2(ground, landFracTarget) {
  const sorted = ground.slice().sort((a, b) => a - b);
  return sorted[Math.floor(landFracTarget * (sorted.length - 1))];
}

// --- substrate (§4): per-column material from elevation, slope, water ---
function classifySubstrateV2(ground, slope, seaY) {
  const n = ground.length;
  const sub = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const y = ground[i];
    const depth = y - seaY; // >0 = underwater (larger y = lower altitude)
    if (depth > 120) sub[i] = SUBSTRATE.DEEP_WATER;
    else if (depth > 0) sub[i] = SUBSTRATE.SHALLOW_WATER;
    else if (depth > -12) sub[i] = SUBSTRATE.SAND; // beach (narrow — builder)
    else if (slope[i] > 0.9) sub[i] = SUBSTRATE.ROCK; // cliff
    else if (y < 540) sub[i] = SUBSTRATE.ALPINE; // high cold
    else sub[i] = SUBSTRATE.SOIL;
  }
  return sub;
}

// Substrate id at x (for the climate init and spawn code).
export function substrateAt(layout, x) {
  const s = layout.substrate;
  if (!s) return SUBSTRATE.SOIL;
  const i = Math.max(0, Math.min(s.length - 1, Math.floor(x / TERRAIN_COL)));
  return s[i];
}

// --- initial climate (§5): Tinit from a bit-stable thermal gradient ---
// Spec-review P1: NO Math.sin — transcendental precision differs between JS
// engines and would break same-seed → same-world across headless/bundle.
// BUILDER CORRECTION to the design: the specified fbm "climate wave"
// (T = 0.52 ± A, A ≤ 0.30) was measured to peak at T 0.53–0.70 across
// seeds — it never reaches the 0.756 jungle threshold over sustained runs,
// so no founder region forms. Replaced with a plateau gradient that
// guarantees the design's intent ("distinct thermal character: hot-west or
// hot-east") AND a broad warm region: warm plateau → smoothstep transition
// → cool side, all with basic ops only (bit-stable).
function buildTinitV2(gen, layout, gentle = false) {
  const n = layout.ground.length;
  const Tinit = new Float32Array(n);
  if (gentle) {
    // Fallback climate: uniformly warm — the damped gentle terrain is all
    // soil, so this classifies as one giant jungle (the founder guarantee).
    for (let i = 0; i < n; i++) {
      const lapse = Math.max(0, 800 - layout.ground[i]) / 550;
      const T = 0.62 - lapse * 0.30;
      Tinit[i] = T < 0 ? 0 : T > 1 ? 1 : T;
    }
  } else {
    // Draw order: side, transition center, texture seed.
    const warmWest = gen.next() < 0.5;
    const tCenter = 0.50 + gen.range(0, 0.10);
    const tWidth = 0.30;
    const sT = gen.int(1, 1e9);
    const TW = 0.82, TC = 0.28;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * TERRAIN_COL;
      let t = x / layout.width;
      if (!warmWest) t = 1 - t;
      let s = (t - (tCenter - tWidth / 2)) / tWidth;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      s = s * s * (3 - 2 * s); // smoothstep warm → cool
      const tex = (fbm(x * 0.008, sT, 2) - 0.5) * 0.08; // texture ±0.04
      const lapse = Math.max(0, 800 - layout.ground[i]) / 550;
      const T = (TW + (TC - TW) * s) + tex - lapse * 0.30;
      Tinit[i] = T < 0 ? 0 : T > 1 ? 1 : T;
    }
  }
  // Thermal equator: argmax of the 5-column-smoothed Tinit — the wind
  // reversal tracks the thermal equator (spec-review P1: no fixed x=1500).
  let best = 0, bestV = -1;
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = -2; k <= 2; k++) {
      const v = Tinit[i + k];
      if (v !== undefined) { sum += v; cnt++; }
    }
    const v = sum / cnt;
    if (v > bestV) { bestV = v; best = i; }
  }
  layout.Tinit = Tinit;
  layout.thermalEquatorX = (best + 0.5) * TERRAIN_COL;
  return Tinit;
}

// Emergent label classifier (per column). M = moisture (substrate
// retention); depth > 0 = underwater.
export function classifyColumnV2(T, M, depth) {
  if (depth > 120) return 'deep';
  if (depth > 0) return 'shallows';
  const tempC = -10 + 45 * T;
  if (tempC < 2) return 'arctic';
  if (tempC < 10) return M < 0.32 ? 'plains' : 'mountains';
  if (tempC < 24) return M < 0.62 ? 'plains' : 'jungle';
  if (M < 0.30) return 'desert';
  if (M < 0.60) return 'plains';
  return 'jungle';
}

// --- regions (§5): contiguous label runs + island/lake post-passes ---
function buildRegionsV2(layout) {
  const n = layout.ground.length;
  const colLabel = new Array(n);
  for (let i = 0; i < n; i++) {
    const M = SUBSTRATE_PROPS[layout.substrate[i]].retention;
    colLabel[i] = classifyColumnV2(layout.Tinit[i], M, layout.ground[i] - layout.seaY);
  }
  layout.colLabel = colLabel;
  const isWaterCol = (i) => layout.ground[i] > layout.seaY;
  // Lakes: water columns not reachable from the world edges = inland.
  const reached = new Uint8Array(n);
  const stack = [];
  for (const e of [0, n - 1]) if (isWaterCol(e)) { reached[e] = 1; stack.push(e); }
  while (stack.length) {
    const i = stack.pop();
    for (const j of [i - 1, i + 1]) {
      if (j >= 0 && j < n && !reached[j] && isWaterCol(j)) { reached[j] = 1; stack.push(j); }
    }
  }
  const lakeCols = new Set();
  for (let i = 0; i < n; i++) if (isWaterCol(i) && !reached[i]) lakeCols.add(i);
  layout.lakeCols = lakeCols;
  // Merge into contiguous runs.
  const regions = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || colLabel[i] !== colLabel[start]) {
      regions.push({
        id: regions.length, label: colLabel[start],
        x0: start * TERRAIN_COL, x1: i * TERRAIN_COL,
        cx: ((start + i) / 2) * TERRAIN_COL, platformPis: [],
      });
      start = i;
    }
  }
  // Post-pass: land runs < 400px flanked by water on both sides → archipelago.
  for (const r of regions) {
    if (r.label === 'deep' || r.label === 'shallows') continue;
    if (r.x1 - r.x0 >= 400) continue;
    const wi = Math.max(0, Math.floor(r.x0 / TERRAIN_COL) - 1);
    const ei = Math.min(n - 1, Math.ceil(r.x1 / TERRAIN_COL));
    if (isWaterCol(wi) && isWaterCol(ei)) r.label = 'archipelago';
  }
  // Mark lake regions (fresh water, not salt).
  for (const r of regions) {
    if (r.label !== 'shallows' && r.label !== 'deep') continue;
    const i0 = Math.floor(r.x0 / TERRAIN_COL), i1 = Math.ceil(r.x1 / TERRAIN_COL);
    let allLake = true;
    for (let i = i0; i < i1 && allLake; i++) if (!lakeCols.has(i)) allLake = false;
    if (allLake && i1 > i0) r.isLake = true;
  }
  layout.regions = regions;
  return regions;
}

// Region lookup helpers (used by the gate, spawns, and the climate init).
export function regionAt(layout, x) {
  const rs = layout.regions;
  if (!rs || !rs.length) return null;
  const xc = Math.max(0, Math.min(layout.width - 1, x));
  for (const r of rs) if (xc < r.x1) return r;
  return rs[rs.length - 1];
}

// Cohort/region finders (§10). Deterministic westmost tiebreak throughout.
function landRegions(layout) {
  return layout.regions.filter((r) => r.label !== 'deep' && r.label !== 'shallows');
}
export const COHORT_FINDERS = {
  // Label-preferring: the cohort wants its biome; the physical criterion
  // is the fallback when the label is absent. Null = cohort skipped (G5).
  'coldest-land': (rs) => largestWithLabel(rs, 'arctic') || coldestLand(rs),
  'highest-land': (rs) => largestWithLabel(rs, 'mountains') || highestLand(rs),
  'founder': (rs, layout) => rs.find((r) => r.id === layout.founder.regionId) || null,
  'largest-plains': (rs) => largestWithLabel(rs, 'plains'),
  'hottest-dry': (rs) => largestWithLabel(rs, 'desert') || hottestDry(rs),
  'largest-shallows': (rs) => largestWithLabel(rs, 'shallows'),
  'largest-islands': (rs) => largestWithLabel(rs, 'archipelago'),
  'deep-water': (rs) => largestWithLabel(rs, 'deep'),
};
function coldestLand(rs) {
  let best = null, bestT = Infinity;
  for (const r of rs) {
    if (r.label === 'shallows' || r.label === 'archipelago' || r.label === 'deep') continue;
    const T = sampleTinit(r);
    if (T < bestT || (T === bestT && best && r.x0 < best.x0)) { bestT = T; best = r; }
  }
  return best;
}
function highestLand(rs) {
  let best = null, bestY = Infinity;
  for (const r of rs) {
    if (r.label === 'shallows' || r.label === 'archipelago' || r.label === 'deep') continue;
    const y = regionGroundY(r);
    if (y < bestY || (y === bestY && best && r.x0 < best.x0)) { bestY = y; best = r; }
  }
  return best;
}
function hottestDry(rs) {
  let best = null, bestT = -Infinity;
  for (const r of rs) {
    if (r.label === 'shallows' || r.label === 'archipelago' || r.label === 'deep') continue;
    const T = sampleTinit(r);
    if (T > bestT || (T === bestT && best && r.x0 < best.x0)) { bestT = T; best = r; }
  }
  return best;
}
function largestWithLabel(rs, label) {
  let best = null;
  for (const r of rs) {
    if (r.label !== label) continue;
    const w = r.x1 - r.x0;
    if (!best || w > best.x1 - best.x0 || (w === best.x1 - best.x0 && r.x0 < best.x0)) best = r;
  }
  return best;
}
// Mean Tinit over a region's columns. Needs the layout — bound at call time.
let _tinitCtx = null;
function sampleTinit(r) {
  const layout = _tinitCtx;
  const i0 = Math.floor(r.x0 / TERRAIN_COL), i1 = Math.ceil(r.x1 / TERRAIN_COL);
  let sum = 0, cnt = 0;
  for (let i = i0; i < i1; i++) {
    const v = layout.Tinit[i];
    if (v !== undefined) { sum += v; cnt++; }
  }
  return cnt ? sum / cnt : 0.5;
}
function regionGroundY(r) {
  const layout = _tinitCtx;
  const i0 = Math.floor(r.x0 / TERRAIN_COL), i1 = Math.ceil(r.x1 / TERRAIN_COL);
  let best = Infinity;
  for (let i = i0; i < i1; i++) {
    const v = layout.ground[i];
    if (v !== undefined && v < best) best = v;
  }
  return best;
}
// findRegion(layout, finder, x0, x1): the region matching finder, optionally
// restricted to the x-range (for size>1 segments). Null if the finder has
// no match — the caller skips the cohort (G5 logs it); no nearest-fallback
// (a shark in a plains region is worse than no shark).
export function findRegion(layout, finder, x0 = 0, x1 = Infinity) {
  const fn = COHORT_FINDERS[finder];
  if (!fn) return null;
  if (finder === 'founder' && !layout.founder) return null;
  _tinitCtx = layout;
  try {
    const inRange = layout.regions.filter((r) => r.x1 > x0 && r.x0 < x1);
    const pool = inRange.length ? inRange : layout.regions;
    // 'founder' ignores the range (there is one founder region).
    return fn(finder === 'founder' ? layout.regions : pool, layout) || null;
  } finally {
    _tinitCtx = null;
  }
}

// --- canopy generator (§6): platforms CONSTRUCTED from the geography ---
// Every new platform is placed relative to an existing one (x-overlap ≥
// 80px, vertical gap 120–200px), so climb-link connectivity holds by
// construction and computeClimbLinks verifies rather than hopes.

function largestRunV2(n, pred, minW) {
  let best = null, rs = -1;
  for (let i = 0; i <= n; i++) {
    const ok = i < n && pred(i);
    if (ok && rs < 0) rs = i;
    if (!ok && rs >= 0) {
      const w = (i - rs) * TERRAIN_COL;
      if (w >= minW && (!best || w > best.w)) best = { x0: rs * TERRAIN_COL, x1: i * TERRAIN_COL, w };
      rs = -1;
    }
  }
  return best;
}

// Terrain-following ground segments across [x0,x1): split where the slope
// kinks by > 0.5; segments < 200px dropped.
function groundSegmentsV2(layout, x0, x1) {
  const n = layout.ground.length;
  const i0 = Math.max(0, Math.floor(x0 / TERRAIN_COL)), i1 = Math.min(n, Math.ceil(x1 / TERRAIN_COL));
  const segs = [];
  let s = i0;
  for (let i = i0 + 1; i <= i1; i++) {
    const sl = layout.slope[i], sp = layout.slope[i - 1];
    if (sl !== undefined && sp !== undefined && Math.abs(sl - sp) > 0.5) { segs.push([s, i]); s = i; }
  }
  segs.push([s, i1]);
  return segs
    .filter(([a, b]) => (b - a) * TERRAIN_COL >= 200)
    .map(([a, b]) => {
      const cx = ((a + b) / 2) * TERRAIN_COL;
      return { x1: a * TERRAIN_COL, x2: b * TERRAIN_COL, cx, y: layout.ground[Math.floor((a + b) / 2)] };
    });
}

function buildCanopyV2(layout, gen) {
  const platforms = [];
  const ground = layout.ground;
  const emit = (x1, x2, y, kind, regionId) => {
    const r = layout.regions[regionId];
    const p = {
      x1: Math.round(x1 * 10) / 10, x2: Math.round(x2 * 10) / 10, y: Math.round(y),
      kind, zone: r.label, regionId, pi: platforms.length,
    };
    platforms.push(p);
    r.platformPis.push(p.pi);
    return p;
  };
  // Constructive branch placement: anchor = seeded pick from the tier
  // below; overlap ≥ 80px and gap 120–200px hold by construction.
  const placeBranch = (anchor, rx0, rx1, gapLo, gapHi) => {
    const w = gen.range(150, 350);
    let cx = anchor.cx + gen.range(-120, 120);
    cx = Math.max(rx0 + 40 + w / 2, Math.min(rx1 - 40 - w / 2, cx));
    let x1 = cx - w / 2, x2 = cx + w / 2;
    const ov = Math.min(x2, anchor.x2) - Math.max(x1, anchor.x1);
    if (ov < 80) { // corrective: sit on the anchor (max overlap), re-clamp
      cx = Math.max(rx0 + 40 + w / 2, Math.min(rx1 - 40 - w / 2, anchor.cx));
      x1 = cx - w / 2; x2 = cx + w / 2;
    }
    return { x1, x2, cx, y: anchor.y - gen.range(gapLo, gapHi), w };
  };

  const n = ground.length;
  const colLabel = layout.colLabel;
  const isSoilCol = (i) => layout.substrate[i] === SUBSTRATE.SOIL;

  // --- founder canopy: largest jungle-SOIL run ≥ 700px, else SOIL ≥ 500px ---
  // (Builder: 900px was aspirational — median run is 640px. 700px fits the
  // 6-branch founder canopy the gate requires.)
  let frun = largestRunV2(n, (i) => colLabel[i] === 'jungle' && isSoilCol(i), 700);
  if (!frun) frun = largestRunV2(n, isSoilCol, 500);
  // frun is checked by G7; build defensively if absent (gate will reject).
  const founderRegionId = frun ? regionAt(layout, (frun.x0 + frun.x1) / 2).id : -1;
  const groundPis = [], branchPis = [];
  let fruitSlots = 0;
  if (frun) {
    const rx0 = frun.x0, rx1 = frun.x1;
    // Tier 0: terrain-following ground segments.
    const gsegs = groundSegmentsV2(layout, rx0, rx1);
    let anchors = [];
    for (const s of gsegs) {
      const p = emit(s.x1, s.x2, s.y, 'ground', founderRegionId);
      groundPis.push(p.pi);
      anchors.push({ cx: (s.x1 + s.x2) / 2, x1: s.x1, x2: s.x2, y: s.y });
    }
    // 3 branch tiers; density matches the painted canopy.
    const perTier = Math.min(4, 2 + Math.floor(frun.w / 600));
    for (let tier = 0; tier < 3 && anchors.length; tier++) {
      const next = [];
      for (let b = 0; b < perTier; b++) {
        const anchor = anchors[gen.int(0, anchors.length - 1)];
        const br = placeBranch(anchor, rx0, rx1, 120, 200);
        const p = emit(br.x1, br.x2, br.y, 'branch', founderRegionId);
        branchPis.push(p.pi);
        fruitSlots += Math.ceil((br.x2 - br.x1) / 120);
        next.push({ cx: br.cx, x1: br.x1, x2: br.x2, y: br.y });
      }
      anchors = next;
    }
  }
  layout.founder = founderRegionId >= 0
    ? { regionId: founderRegionId, x0: frun.x0, x1: frun.x1, groundPis, branchPis, fruitSlots }
    : null;

  // --- secondary canopies: other jungle regions ≥ 500px, 2 tiers × 2 ---
  for (const r of layout.regions) {
    if (r.label !== 'jungle' || r.id === founderRegionId) continue;
    if (r.x1 - r.x0 < 500) continue;
    const gsegs = groundSegmentsV2(layout, r.x0, r.x1);
    let anchors = [];
    for (const s of gsegs) {
      const p = emit(s.x1, s.x2, s.y, 'ground', r.id);
      anchors.push({ cx: (s.x1 + s.x2) / 2, x1: s.x1, x2: s.x2, y: s.y });
    }
    for (let tier = 0; tier < 2 && anchors.length; tier++) {
      const next = [];
      for (let b = 0; b < 2; b++) {
        const anchor = anchors[gen.int(0, anchors.length - 1)];
        const br = placeBranch(anchor, r.x0, r.x1, 120, 200);
        const p = emit(br.x1, br.x2, br.y, 'branch', r.id);
        next.push({ cx: br.cx, x1: br.x1, x2: br.x2, y: br.y });
      }
      anchors = next;
    }
  }

  // --- characteristic vertical structure per region type (§15: adaptive
  // radiation — vertical structure is a biome property, INCLUDING the
  // absence of levels where the biome is flat) ---
  for (const r of layout.regions) {
    if (r.id === founderRegionId) continue;
    if (r.label === 'jungle') continue; // secondary canopies done above
    const w = r.x1 - r.x0;
    if (r.label === 'mountains' || r.label === 'arctic') {
      // Cliff/ledge levels — verticality without trees. Ground at the foot
      // (tanglekins need ground access; shelves alone strand the component).
      const gsegs = groundSegmentsV2(layout, r.x0, r.x1);
      for (const s of gsegs) emit(s.x1, s.x2, s.y, 'ground', r.id);
      if (w < 300 && gsegs.length === 0) {
        // Too steep for natural ground: a talus platform at the mountain foot.
        const i0 = Math.floor(r.x0 / TERRAIN_COL), i1 = Math.ceil(r.x1 / TERRAIN_COL);
        let bi = i0;
        for (let i = i0; i < i1; i++) if (layout.ground[i] > layout.ground[bi]) bi = i;
        const x = (bi + 0.5) * TERRAIN_COL;
        emit(x - 100, x + 100, layout.ground[bi], 'ground', r.id);
      }
      if (w < 300) continue;
      // 3 shelves on the steepest columns.
      const cols = [];
      const i0 = Math.floor(r.x0 / TERRAIN_COL), i1 = Math.ceil(r.x1 / TERRAIN_COL);
      for (let i = i0; i < i1; i++) cols.push(i);
      cols.sort((a, b) => layout.slope[b] - layout.slope[a]);
      const shelfPis = [];
      for (let k = 0; k < 3 && k < cols.length; k++) {
        const i = cols[k];
        const x = (i + 0.5) * TERRAIN_COL;
        const p = emit(x - 90, x + 90, ground[i] - 80 - 40 * k, 'shelf', r.id);
        shelfPis.push(p.pi);
      }
      // Deterministic repair pass: nudge any unlinked shelf's y toward the
      // nearest platform (links verified, not hoped).
      const links = computeClimbLinks(platforms);
      const linked = new Set();
      for (const l of links) { linked.add(l.a); linked.add(l.b); }
      for (const pi of shelfPis) {
        if (linked.has(pi)) continue;
        const p = platforms[pi];
        let near = null, nearD = Infinity;
        for (const q of platforms) {
          if (q.pi === pi) continue;
          const d = Math.abs((q.x1 + q.x2) / 2 - (p.x1 + p.x2) / 2);
          if (d < nearD) { nearD = d; near = q; }
        }
        if (near) {
          // Move into link range: overlap via x, gap 120 from the neighbor.
          const cx = Math.max(r.x0 + 100, Math.min(r.x1 - 100, (near.x1 + near.x2) / 2));
          p.x1 = Math.round((cx - 90) * 10) / 10; p.x2 = Math.round((cx + 90) * 10) / 10;
          p.y = Math.round(near.y - 150);
        }
      }
    } else if (r.label === 'plains' || r.label === 'desert') {
      // Flat ground — NO levels (no climbing selection pressure here).
      const gsegs = groundSegmentsV2(layout, r.x0, r.x1);
      const anchors = [];
      for (const s of gsegs) {
        const p = emit(s.x1, s.x2, s.y, 'ground', r.id);
        anchors.push({ cx: (s.x1 + s.x2) / 2, x1: s.x1, x2: s.x2, y: s.y });
      }
      // 0–2 ridge/rock features (seeded).
      const nf = gen.int(0, 2);
      for (let k = 0; k < nf && anchors.length; k++) {
        const anchor = anchors[gen.int(0, anchors.length - 1)];
        const wdt = gen.range(150, 250);
        const cx = Math.max(r.x0 + 40 + wdt / 2, Math.min(r.x1 - 40 - wdt / 2, anchor.cx + gen.range(-60, 60)));
        const kind = r.label === 'desert' ? 'rock' : 'ridge';
        const p = emit(cx - wdt / 2, cx + wdt / 2, anchor.y - 120, kind, r.id);
        p.solid = true;
      }
    } else if (r.label === 'shallows') {
      // Mangroves: seabed ground + branches constructed upward.
      const gsegs = groundSegmentsV2(layout, r.x0, r.x1);
      const anchors = [];
      for (const s of gsegs) {
        const p = emit(s.x1, s.x2, s.y, 'ground', r.id);
        anchors.push({ cx: (s.x1 + s.x2) / 2, x1: s.x1, x2: s.x2, y: s.y });
      }
      const nb = 2 + gen.int(0, 2);
      for (let k = 0; k < nb && anchors.length; k++) {
        const anchor = anchors[gen.int(0, anchors.length - 1)];
        const br = placeBranch(anchor, r.x0, r.x1, 120, 200);
        emit(br.x1, br.x2, br.y, 'branch', r.id);
      }
    } else if (r.label === 'archipelago') {
      // Islands: 1 ground segment + 1–2 branches, constructive.
      const gsegs = groundSegmentsV2(layout, r.x0, r.x1);
      for (const s of gsegs.slice(0, 1)) {
        const gp = emit(s.x1, s.x2, s.y, 'ground', r.id);
        const anchor = { cx: (s.x1 + s.x2) / 2, x1: s.x1, x2: s.x2, y: s.y };
        const nb = 1 + gen.int(0, 1);
        for (let k = 0; k < nb; k++) {
          const br = placeBranch(anchor, r.x0, r.x1, 120, 180);
          emit(br.x1, br.x2, br.y, 'branch', r.id);
        }
      }
    } else if (r.label === 'deep') {
      // Floes — swum to by design (G4-exempt).
      const nf = 2 + gen.int(0, 2);
      for (let k = 0; k < nf; k++) {
        const cx = r.x0 + ((k + 0.5) / nf) * (r.x1 - r.x0) + gen.range(-40, 40);
        const wdt = gen.range(120, 220);
        emit(cx - wdt / 2, cx + wdt / 2, layout.seaY - 110, 'floe', r.id);
      }
    }
    // 'arctic' handled with mountains above. Water regions too small for
    // shelves get nothing — the gate verifies reachability.
  }

  layout.platforms = platforms;
  return platforms;
}

// --- waters v2 (§3): flood rects + ponds ---
function buildWatersV2(layout, gen) {
  const waters = [];
  const { ground, seaY } = layout;
  const n = ground.length;
  let run = null;
  const flush = () => {
    if (!run) return;
    // A rect is fresh only if every column is lake water.
    let lake = true;
    for (let i = run.i0; i < run.i1 && lake; i++) if (!layout.lakeCols.has(i)) lake = false;
    waters.push({
      x0: run.x0, x1: run.x1, surfaceY: seaY,
      depth: Math.max(30, run.deep - seaY + 20), salt: !lake,
    });
    run = null;
  };
  for (let i = 0; i < n; i++) {
    if (ground[i] > seaY) {
      const x0 = i * TERRAIN_COL, x1 = x0 + TERRAIN_COL;
      if (run) { run.x1 = x1; run.i1 = i + 1; run.deep = Math.max(run.deep, ground[i]); }
      else run = { x0, x1, i0: i, i1: i + 1, deep: ground[i] };
    } else flush();
  }
  flush();
  // Freshwater ponds: 2 + floor(width/2400), seeded x in the largest land
  // regions with soil.
  const landRs = layout.regions
    .filter((r) => r.label !== 'deep' && r.label !== 'shallows')
    .sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0));
  const np = 2 + Math.floor(layout.width / 2400);
  for (let k = 0; k < np && landRs.length; k++) {
    const r = landRs[k % landRs.length];
    const x = r.x0 + (r.x1 - r.x0) * gen.range(0.2, 0.8);
    const gi = Math.max(0, Math.min(n - 1, Math.floor(x / TERRAIN_COL)));
    const surfaceY = ground[gi] - 10;
    const wdt = gen.range(80, 100);
    waters.push({ x0: x - wdt / 2, x1: x + wdt / 2, surfaceY, depth: 35, salt: false });
  }
  waters.sort((a, b) => a.x0 - b.x0);
  return waters;
}

// --- solid terrain (§7): the column is solid surface-to-bottom ---
// No voids under land — land IS the column. The future substrate for
// digging/burrowing (the dig verb will remove column segments).
export function terrainSolidAt(layout, x, y) {
  const g = layout.ground[Math.max(0, Math.min(layout.ground.length - 1, Math.floor(x / TERRAIN_COL)))];
  return y >= g;
}
