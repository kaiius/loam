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

// Seeded procedural layout. Draw order on the worldgen stream is load-bearing
// (documented; never reorder): seaY, then per-platform y-jitter in emission
// order, then pond positions.
export function generateLayout(seed, size = 1, attempt = 0) {
  const gen = createRng((((seed * 2654435761) ^ (Math.round(size * 1000) * 40503) ^ (attempt * 65599) ^ 0x26) >>> 0) || 1);
  const zones = ZONE_KEYS.map((key, i) => ({
    key, x0: i * BASE_ZONE_W * size, x1: (i + 1) * BASE_ZONE_W * size,
    cx: (i + 0.5) * BASE_ZONE_W * size,
  }));
  const layout = {
    seed, size, attempt, canonical: false,
    width: BASE_WORLD_W * size, height: WG_WORLD_H,
    zones, seaY: 0, ground: null, waters: null,
    platforms: null, platformsByZone: null,
  };
  layout.seaY = 890 + gen.range(-10, 10);
  // The ocean surface sits BELOW the land (larger y = lower altitude):
  // land zones peak at y≈855, the shallows seabed at y≈950. Land never
  // floods by construction; the sea sets the shallows/archipelago water
  // level per seed.
  layout.ground = buildTerrain(seed, size, zones, false);
  layout.waters = buildWaters(layout, gen, false);
  const { platforms, byZone } = buildPlatforms(layout, gen, false);
  layout.platforms = platforms;
  layout.platformsByZone = byZone;
  return layout;
}

// --- the viability gate ------------------------------------------------------
// A generated world must offer: fruit (jungle canopy slots), water
// (freshwater), traversable space (the founder zone's platforms connected by
// climb links), reachable platforms (nothing stranded but the deep floes,
// which are swum to by design), and unflooded founder spawns. Failed rolls
// re-roll deterministically via the attempt counter.

// The canonical layout's linked platforms, as "zone:ordinal" — the painted
// world has unlinked shelves/isolated fills by design (the gate must accept
// the canonical layout), so G4 guards only against NEW stranding: every
// platform the template links must stay linked in the generated world.
let _canonLinked = null;
function canonicalLinkedSet() {
  if (!_canonLinked) {
    const c = canonicalLayout(1);
    const links = computeClimbLinks(c.platforms);
    _canonLinked = new Set();
    for (const l of links) {
      for (const pi of [l.a, l.b]) {
        const p = c.platforms[pi];
        if (p.ord >= 0) _canonLinked.add(p.zone + ':' + p.ord);
      }
    }
  }
  return _canonLinked;
}

export function viabilityGate(layout) {
  const failures = [];
  const byZone = layout.platformsByZone;
  // G1 — fruit: the jungle canopy carries the founder economy.
  const jungleBranches = byZone.jungle.filter((p) => p.kind === 'branch').length;
  if (jungleBranches < 8) failures.push(`fruit: jungle has ${jungleBranches} branch slots, need 8`);
  const plainsGround = byZone.plains.filter((p) => p.kind === 'ground').length;
  if (plainsGround < 1) failures.push('fruit: plains has no ground for grasses');
  // G2 — water: at least one freshwater body (drinking).
  const fresh = layout.waters.filter((w) => !w.salt).length;
  if (fresh < 1) failures.push('water: no freshwater');
  // G3 — traversable space: the founder zone's first cluster is one
  // climb-linked component.
  const links = computeClimbLinks(layout.platforms);
  const adj = new Map();
  for (const l of links) {
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a).push(l.b); adj.get(l.b).push(l.a);
  }
  const jungle0 = byZone.jungle.filter((p) => p.zone === 'jungle').slice(0, 9).map((p) => p.pi);
  const seen = new Set([jungle0[0]]);
  const stack = [jungle0[0]];
  while (stack.length) {
    const n = stack.pop();
    for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  const strandedJungle = jungle0.filter((pi) => !seen.has(pi));
  if (strandedJungle.length) failures.push(`traversable: jungle platforms stranded: ${strandedJungle.join(',')}`);
  // G4 — reachable platforms: no NEW stranding. Every (zone, ordinal) the
  // template links must keep at least one link in every generated cluster.
  const linked = new Set();
  for (const l of links) { linked.add(l.a); linked.add(l.b); }
  const mustLink = canonicalLinkedSet();
  const newly = [];
  for (const p of layout.platforms) {
    if (p.ord >= 0 && mustLink.has(p.zone + ':' + p.ord) && !linked.has(p.pi)) newly.push(p.pi);
  }
  if (newly.length) failures.push(`reachable: newly stranded platforms: ${newly.join(',')}`);
  // G5 — founder spawns: cohort platforms exist and aren't deeply submerged
  // (wading in a pond ≤30px is fine; ocean flooding is not).
  const cohorts = [
    ['arctic', 0], ['mountains', 2], ['jungle', 1], ['plains', 0],
    ['desert', 0], ['shallows', 1], ['archipelago', 0], ['deep', 0],
  ];
  for (const [key, ord] of cohorts) {
    const p = byZone[key][ord];
    if (!p) { failures.push(`spawn: ${key}[${ord}] missing`); continue; }
    const cx = (p.x1 + p.x2) / 2;
    const w = waterAtLayout(layout, cx, p.y);
    if (w && p.y > w.surfaceY + 30) failures.push(`spawn: ${key} cohort platform ${p.pi} deeply submerged`);
  }
  return { ok: failures.length === 0, failures };
}

export const MAX_ATTEMPTS = 100;

// Roll layouts until the gate passes. Deterministic: the attempt counter is
// part of the stream seed, so (seed, size) always lands on the same layout.
export function rollLayout(seed, size = 1) {
  let layout = null, gate = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    layout = generateLayout(seed, size, attempt);
    gate = viabilityGate(layout);
    if (gate.ok) return { layout, gate, attempts: attempt + 1 };
  }
  throw new Error(
    `v0.26 worldgen: viability gate failed after ${MAX_ATTEMPTS} attempts ` +
    `(seed ${seed}, size ${size}): ${gate.failures.join('; ')}`
  );
}
