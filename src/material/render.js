// Canopy material world — MATERIAL-FIELD RENDERER (M1).
//
// WORLD VIEW ONLY: pure scene, no UI — no text, no labels, no cards, no
// dashboard. This draws THE MATERIAL FIELD, not an entity list.
//
// Encodes Joshua's rejections from design/material-world.md §0:
//   - "floating things": plants are grown, connected cell sets; the renderer
//     reads cells, never places stickers. Nothing here can float — there is
//     no entity placement path at all.
//   - "sticker collage": one physical language, one visual language — soil,
//     rock, wood, water are cells of one substrate, drawn with one palette
//     family per material. No iconography, no glyphs, no dots-on-slabs.
//   - "clunky and busy": density comes from the worldgen processes, not the
//     renderer; this draws the field quietly, with light doing the work.
//
// Lighting: ONE light from top-left. Cheap ambient occlusion — for each
// cell, darkness ∝ the number of solid cells in the column above within
// ~12 cells. Tunnels and burrows read as shadowed; the surface glows.
//
// Determinism: ZERO RNG here. All variation is a stateless hash of
// (seed, x, y, purpose). Same world + same view → identical output.
//
// Only basic Canvas2D calls are used (fillRect, fillStyle, save/restore,
// paths for the creature overlay). No text calls — ever.

import { MAT, MAT_PROPS, CELL_PX } from './grid.js';
import { neutralPose } from './portrait.js';
import { drawSpeciesBody, artHelpers } from './fauna.js';
import { timeOfDay } from './senses.js';
import { seasonSin, windAt, SKY_COL_W } from './weather.js';

// Stateless per-individual hash for decorative placement (spots, scars).
// (seed, x, y, purpose) salt keeps it independent of worldgen hashes.
function h4(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x51ab, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// --- stateless hash -> [0,1) -------------------------------------------------
// Same mixer family as worldgen's hash2; the extra salt keeps render-space
// hashes independent of worldgen-space hashes.
function h3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x51ab, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const r1 = (v) => Math.round(v * 10) / 10; // keep emitted color strings tidy

// hsl() strings — the SVG shim converts top-level hsl fill strings to rgb
// for cairosvg, deterministically, so the emitted SVG is byte-identical
// across runs.
const hsl = (h, s, l) => `hsl(${r1(h)}, ${r1(s)}%, ${r1(l)}%)`;

// hsl -> 'rgb(r,g,b)'. Needed for gradient STOPS: the shim only converts
// top-level fillStyle strings, not colors nested inside a gradient def —
// cairosvg does not parse hsl(), so unconverted stops render black.
function hslRgb(h, s, l) {
  s = clamp01(s / 100); l = clamp01(l / 100);
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(f(0) * 255), g = Math.round(f(8) * 255), b = Math.round(f(4) * 255);
  return `rgb(${r},${g},${b})`;
}

// Multiply a lightness value by an occlusion factor (cheap AO, no layering).
const shade = (l, k) => Math.max(0, Math.min(100, l * k));

const hsla = (h, s, l, a) => `hsla(${r1(h)}, ${r1(s)}%, ${r1(l)}%, ${a.toFixed(3)})`;

// Deterministic 1D value noise in [0,1) — ridgelines, treelines, cloud systems.
function vnoise1(seed, x, salt) {
  const xi = Math.floor(x), xf = x - xi;
  const a = h3(seed, xi, salt), b = h3(seed, xi + 1, salt);
  const u = xf * xf * (3 - 2 * xf);
  return a + (b - a) * u;
}
// Deterministic 2D value noise in [0,1) — organic material grain. The old
// per-cell hash grain alternated light/dark on adjacent cells (the
// checkerboard dither); this interpolates over ~3 cells so shading reads
// as earth, not pixels.
function vnoise2(seed, x, y, salt) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const hh = (ix, iy) => h3(seed, ix + iy * 4096, salt);
  const a = hh(xi, yi), b = hh(xi + 1, yi), c = hh(xi, yi + 1), d = hh(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// numeric twin of hslRgb: [r, g, b] 0-255, for the albedo field.
function hsl2rgb(h, s, l) {
  s = clamp01(s / 100); l = clamp01(l / 100);
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * renderWorldView(ctx, mw, view, opts)
 *
 * ctx  — a Canvas2D-compatible context (e.g. SvgCtx) with .w/.h canvas size.
 * mw   — a generateMaterialWorld() result: { seed, cols, rows, grid, surf,
 *          seaRow, cellPx, ... }.
 * view — { x, y, w, h } pixel region of the world to draw. The region is
 *          fit into the canvas (uniform scale, centered); give a view with
 *          the canvas aspect ratio for a full-bleed frame.
 * opts — { creature?: { x, y, facing } } pixel coords; y = FEET. The creature
 *          is an optional overlay, drawn last, kept humble — the world is
 *          the subject. Skip it and the scene stands alone.
 *
 * No text, no UI, no RNG. Same (world, view, opts) → same pixels.
 */
// sun elevation: +1 at noon, -1 at midnight. Tick 1200 = noon (day = 2400) —
// the canonical clock: tick 0 = midnight, matching senses.daySun, the
// weather diurnal curve, the sim's daylightCurve, and the moon math below
// (which already assumed midnight at tick 0). Fixed 2026-10-04: the
// renderer ran a quarter-day early, so creatures sensed noon under a dusk sky.
export function sunElev(mw) {
  const t = timeOfDay(mw);
  return Math.cos((t - 0.5) * Math.PI * 2);
}

// sky palette stops, lerped by daylight. Returns [zenithHSL, midHSL, horHSL].
function skyPalette(e, season) {
  // day (grade 2026-10-04: deepened — the washed near-white horizon killed
  // the sky; horizon stays light for atmosphere but blue now, not white)
  const day = [[212, 66, 60], [206, 58, 70], [205, 55, 80]];
  // night
  const night = [[232, 42, 7], [230, 36, 12], [228, 30, 18]];
  // day arrives late: the low sun belongs to dawn/dusk, not to noon
  const k = clamp01((e - 0.05) / 0.38); // 0 night … 1 day
  // circular hue lerp (short path), so dusk doesn't swing through swamp-green
  const hueMix = (a, b) => {
    let d = b - a;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    return (a + d * k + 360) % 360;
  };
  const mix = (a, b) => [hueMix(a[0], b[0]), a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const pal = [mix(night[0], day[0]), mix(night[1], day[1]), mix(night[2], day[2])];
  // dawn/dusk fire: the horizon burns while the sun is near it
  const ae = Math.abs(e);
  if (ae < 0.45) {
    const wk = 1 - ae / 0.45;
    const warm = (c, tgt, kk) => {
      let d = tgt[0] - c[0];
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      return [(c[0] + d * kk + 360) % 360, c[1] + (tgt[1] - c[1]) * kk, c[2] + (tgt[2] - c[2]) * kk];
    };
    pal[2] = warm(pal[2], [14, 85, 58], Math.min(1, wk * 1.2));
    pal[1] = warm(pal[1], [10, 60, 45], wk * 0.55);
    pal[0] = warm(pal[0], [230, 42, 30], wk * 0.3);
  }
  // seasons breathe on the palette: winter cooler/desaturated, summer warmer
  const sh = season * 6;
  for (const c of pal) { c[0] += sh; c[1] = Math.max(8, c[1] - Math.abs(season) * 6); }
  return pal;
}

// analytic sky color at canvas-fraction f (0 top … 1 bottom)
function skyHSLAt(f, pal) {
  const seg = f < 0.55 ? [pal[0], pal[1], f / 0.55] : [pal[1], pal[2], (f - 0.55) / 0.45];
  const [a, b, t] = seg;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// --- terrain cache (browser only) --------------------------------------------------
// The albedo is expensive; the world changes slowly. Repaint every few
// ticks or when the view changes. The cache is eye-only: identical
// (world, view) always paints identical pixels, whenever it repaints.
let terrainCache = null;
const CACHE_TICKS = 48;   // terrain repaint cadence: the diurnal light moves
                        // slowly (48 ticks = 2% of the day) and fire/weather
                        // read fine a half-second behind; fewer repaints =
                        // fewer software-rasterizer hitches
const hasDocument = typeof document !== 'undefined' && typeof document.createElement === 'function';

function cacheKey(mw, view, W, H) {
  // view.x/view.y arrive pre-quantized to whole world-px (renderWorldView's
  // anti-shimmer snap); rounding again here is belt-and-suspenders so a
  // float key can never churn the cache on sub-pixel camera drift.
  return mw.seed + '|' + W + 'x' + H + '|' + Math.round(view.x) + ',' + Math.round(view.y) + ',' + view.w + ',' + view.h;
}

// numeric cell color — the albedo field. Returns [r, g, b] 0-255.
function cellRGB(m, cx, cy, i, grid, mw, lit, waterCell) {
  const [h, s, l] = cellHSL(m, cx, cy, i, grid, mw, lit, waterCell);
  return hsl2rgb(h, s, l);
}


// --- TREES, legibility rewrite (2026-10-04) ----------------------------------
// The botanical truth, drawn so a first-time viewer reads it: roots in soil,
// trunk in air, canopy in air. Three concrete fixes over the old strand pass:
//   1. Trees paint into their OWN canvas, composited AFTER the lightmap
//      multiply. The old pipeline baked trunks into the world canvas, where
//      the Terraria shadow grid darkened every trunk ~50% (its own wood
//      counted as occlusion above it) — trunks rendered as mud columns the
//      same brown as the soil. Trees now keep authored colors; the ground
//      keeps the moody light. Diurnal grading is explicit (lumK/moonK from
//      the ambient), so night still reads as night.
//   2. One trunk -> one crown. Leaf cells carry their tree's grownId, so each
//      tree gets a single merged canopy mass anchored at its trunk top, the
//      trunk visibly entering it — no more green puffs floating detached in
//      the sky. paintTrees returns the claimed leaf cells; the generic puff
//      pass skips them. Shrubs (trunk < 5 cells) keep the generic puffs.
//   3. Trunks read as wood: drawn wider than the 1-cell worldgen column (the
//      same tree, drawn readably), two-tone sun/shade fill, bark grain,
//      root flare + root strokes into the soil, and a contact shadow — the
//      cues that say "standing ON the ground".
// Determinism: every decorative choice is a stateless h3 of (seed, gid, salt).

// grade an authored-daylight [r,g,b] by the diurnal light for post-lightmap
// painting: full color by day, dim moon-blue by night. Mirrors the old dl().
function gradeTreeRGB(c, lumK, moonK) {
  const r = Math.max(0, Math.min(255, c[0] * lumK + (150 - c[0]) * moonK));
  const g = Math.max(0, Math.min(255, c[1] * lumK + (168 - c[1]) * moonK));
  const b = Math.max(0, Math.min(255, c[2] * lumK + (226 - c[2]) * moonK));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// grade an authored [h,s,l] the same way -> [r,g,b] 0-255.
function gradeTreeHSL(h, s, l, lumK, moonK) {
  const nl = Math.max(2, Math.min(96, l * lumK + 6 * moonK));
  let nh = h + (228 - h) * moonK * 0.7;
  nh = ((nh % 360) + 360) % 360;
  const ns = Math.max(4, Math.min(100, s * (1 - moonK * 0.45)));
  return hsl2rgb(nh, ns, nl);
}

// Walk every visible plant's wood cells into strands (the old greedy
// 8-neighborhood walk, fixed preference order — deterministic), group leaves
// by grownId. Returns { trees: [{ gid, dead, strands, set, leaves }] } sorted
// by gid for a deterministic paint order.
function collectTreeData(mw, G, seed) {
  const { grid, cols } = mw;
  const { cx0, cx1, cy0, cy1 } = G;
  const woodByGid = new Map(), leavesByGid = new Map();
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * cols + cx, m = grid.mat[i];
      if (m !== MAT.WOOD && m !== MAT.DEADWOOD && m !== MAT.LEAF) continue;
      const gid = grid.grownId[i] || 0;
      const bucket = m === MAT.LEAF ? leavesByGid : woodByGid;
      if (!bucket.has(gid)) bucket.set(gid, []);
      bucket.get(gid).push({ cx, cy, dead: m === MAT.DEADWOOD });
    }
  }
  const PREFS = [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]];
  const trees = [];
  for (const [gid, cells] of woodByGid) {
    const key = (cx, cy) => cy * 100000 + cx;
    const set = new Set(cells.map((c) => key(c.cx, c.cy)));
    const cellByKey = new Map(cells.map((c) => [key(c.cx, c.cy), c]));
    const used = new Set();
    const walk = (sx, sy) => {
      const pts = [];
      let cx = sx, cy = sy;
      for (let step = 0; step < 600; step++) {
        const k = key(cx, cy);
        if (!set.has(k) || used.has(k)) break;
        used.add(k);
        pts.push(cellByKey.get(k));
        let found = false;
        for (const [dx, dy] of PREFS) {
          const nk = key(cx + dx, cy + dy);
          if (set.has(nk) && !used.has(nk)) { cx += dx; cy += dy; found = true; break; }
        }
        if (!found) break;
      }
      return pts;
    };
    const strands = [];
    const sorted = cells.slice().sort((a, b) => b.cy - a.cy || a.cx - b.cx);
    if (sorted.length) strands.push({ pts: walk(sorted[0].cx, sorted[0].cy), trunk: true });
    for (const c of sorted) {
      if (used.has(key(c.cx, c.cy))) continue;
      strands.push({ pts: walk(c.cx, c.cy), trunk: false });
    }
    trees.push({ gid, dead: cells[0].dead, strands, set, leaves: leavesByGid.get(gid) || [] });
  }
  trees.sort((a, b) => a.gid - b.gid);
  return { trees };
}

// Paint every tree into tctx (a transparent canvas composited after the
// lightmap). Returns the claimed leaf cells ("cx,cy" keys) for the generic
// puff pass to skip.
function paintTrees(tctx, mw, G, seed, lumK, moonK) {
  const { px, py, cellPx } = G;
  const { trees } = collectTreeData(mw, G, seed);
  const claimed = new Set();
  const key = (cx, cy) => cy * 100000 + cx;
  const poly = (pts) => {
    tctx.beginPath();
    tctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) tctx.lineTo(pts[i][0], pts[i][1]);
    tctx.closePath();
  };

  for (const t of trees) {
    const gid = t.gid || 1;
    const brVar = 0.85 + 0.3 * h3(seed, gid, 6110);
    for (const s of t.strands) {
      const pts = s.pts;
      if (pts.length === 0) continue;
      const n = pts.length;
      if (n === 1) {
        // a lone wood cell: a bark dot, not a polygon (zero-area paths
        // and zero-length gradients render nothing).
        const sx = px((pts[0].cx + 0.5) * CELL_PX), sy = py((pts[0].cy + 0.5) * CELL_PX);
        tctx.fillStyle = gradeTreeRGB(barkRGBr3(seed, gid, t.dead, 0.5), lumK, moonK);
        tctx.beginPath(); tctx.arc(sx, sy, cellPx * 0.42, 0, Math.PI * 2); tctx.fill();
        continue;
      }
      const SX = [], SY = [], SW = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        SX.push(px((p.cx + 0.5) * CELL_PX));
        SY.push(py((p.cy + 0.5) * CELL_PX));
        let rowW = 0;
        for (let ox = -2; ox <= 2; ox++) {
          if (t.set.has(key(p.cx + ox, p.cy))) rowW++;
        }
        const tt = i / (n - 1);
        // trunks readably wider than the 1-cell worldgen column; branches thin.
        // Junction knots are capped (the old rowW*0.9 floor grew diamond
        // bulges that read as bamboo segments).
        let w = s.trunk ? (1.35 - 1.05 * tt) : (0.55 - 0.37 * tt) * brVar;
        if (rowW > 1) w = Math.max(w, Math.min(rowW * 0.55, w * 1.8));
        w = Math.max(w, 0.16);
        if (s.trunk && i < 3) w *= 1 + 0.55 * (1 - i / 3); // root flare
        SW.push(w * cellPx);
      }
      // contact shadow + roots: the trunk stands ON the ground
      if (s.trunk) {
        const bx = SX[0], by = SY[0];
        tctx.fillStyle = 'rgba(10, 7, 4, 0.30)';
        tctx.beginPath();
        tctx.ellipse(bx, by + cellPx * 0.25, cellPx * 2.4, cellPx * 0.8, 0, 0, Math.PI * 2);
        tctx.fill();
        if (n >= 3) {
          tctx.strokeStyle = gradeTreeRGB(barkRGBr3(seed, gid, t.dead, 0.30), lumK, moonK);
          tctx.lineCap = 'round';
          tctx.lineWidth = Math.max(1.5, SW[0] * 0.28);
          for (const [ang, len] of [[Math.PI / 2 - 0.55, 1.6], [Math.PI / 2, 1.9], [Math.PI / 2 + 0.55, 1.6]]) {
            tctx.beginPath();
            tctx.moveTo(bx, by - SW[0] * 0.2);
            tctx.quadraticCurveTo(
              bx + Math.cos(ang) * len * cellPx * 0.5, by + Math.sin(ang) * len * cellPx * 0.6,
              bx + Math.cos(ang) * len * cellPx, by + Math.sin(ang) * len * cellPx * 0.9);
            tctx.stroke();
          }
        }
      }
      // tapered polygon via offset curve
      const L = [], R = [];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        let dx = SX[b] - SX[a], dy = SY[b] - SY[a];
        const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const hw = SW[i] / 2;
        L.push([SX[i] - dy * hw, SY[i] + dx * hw]);
        R.push([SX[i] + dy * hw, SY[i] - dx * hw]);
      }
      // shade pass: full width, dark bark
      tctx.fillStyle = gradeTreeRGB(barkRGBr3(seed, gid, t.dead, 0.34), lumK, moonK);
      poly([...L, ...R.slice().reverse()]);
      tctx.fill();
      // lit pass: narrower, offset toward the top-left sun — roundness
      const HL = [], HR = [];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        let dx = SX[b] - SX[a], dy = SY[b] - SY[a];
        const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const cxp = SX[i] - SW[i] * 0.16, cyp = SY[i] - SW[i] * 0.16;
        const hw = SW[i] * 0.30;
        HL.push([cxp - dy * hw, cyp + dx * hw]);
        HR.push([cxp + dy * hw, cyp - dx * hw]);
      }
      tctx.fillStyle = gradeTreeRGB(barkRGBr3(seed, gid, t.dead, 0.62), lumK, moonK);
      poly([...HL, ...HR.slice().reverse()]);
      tctx.fill();
      // bark grain: two whisper-thin darker lines along the strand —
      // trunks only (grain on thin branches read as milled timber).
      if (s.trunk && n > 2 && cellPx > 7) {
        tctx.strokeStyle = gradeTreeRGB([26, 16, 10], lumK, moonK);
        tctx.globalAlpha = 0.35;
        tctx.lineWidth = Math.max(1, cellPx * 0.06);
        tctx.lineCap = 'round';
        for (const off of [-0.22, 0.22]) {
          tctx.beginPath();
          for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
            let dx = SX[b] - SX[a], dy = SY[b] - SY[a];
            const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
            const gx = SX[i] - dy * SW[i] * off, gy = SY[i] + dx * SW[i] * off;
            if (i === 0) tctx.moveTo(gx, gy); else tctx.lineTo(gx, gy);
          }
          tctx.stroke();
        }
        tctx.globalAlpha = 1;
      }
    }
    // one trunk -> one crown: a merged canopy mass anchored at the trunk top,
    // the trunk visibly entering it. Sleeve leaves lower on the trunk stay
    // in the albedo buffer as interior texture.
    const trunk = t.strands.length && t.strands[0].trunk ? t.strands[0] : null;
    if (trunk && trunk.pts.length >= 5 && t.leaves.length >= 3 && !t.dead) {
      const top = trunk.pts[trunk.pts.length - 1];
      let minY = Infinity, maxY = -Infinity;
      for (const lf of t.leaves) {
        if (lf.cy < minY) minY = lf.cy;
        if (lf.cy > maxY) maxY = lf.cy;
      }
      const cutY = minY + (maxY - minY) * 0.45; // the crown: the upper leaves
      let ccx = 0, ccy = 0, nn = 0;
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const lf of t.leaves) {
        if (lf.cy > cutY && t.leaves.length > 8) continue;
        ccx += lf.cx; ccy += lf.cy; nn++;
        if (lf.cx < bx0) bx0 = lf.cx; if (lf.cx > bx1) bx1 = lf.cx;
        if (lf.cy < by0) by0 = lf.cy; if (lf.cy > by1) by1 = lf.cy;
      }
      if (!nn) { ccx = top.cx; ccy = top.cy - 3; nn = 1; bx0 = bx1 = top.cx; by0 = by1 = top.cy - 3; }
      else { ccx /= nn; ccy /= nn; }
      // pull the crown toward the trunk top so the trunk always enters it
      ccx = ccx * 0.7 + top.cx * 0.3;
      ccy = ccy * 0.7 + (top.cy - 2) * 0.3;
      const R = Math.max(3.5, Math.max(bx1 - bx0 + 4, by1 - by0 + 4) * 0.5) * cellPx;
      const pxC = px((ccx + 0.5) * CELL_PX), pyC = py((ccy + 0.5) * CELL_PX);
      // The crown: a DENSE irregular mass, not smoke. A near-solid dark core
      // (interior shadow) first, then gradient volume, then a sun-struck top.
      // Core ellipses are seeded per tree so adjacent crowns never match.
      const coreK = [[0, 0.02, 0.62, 0.42], [-0.30, 0.12, 0.44, 0.34], [0.32, 0.10, 0.46, 0.32]];
      for (const [ox, oy, rx, ry] of coreK) {
        const jx = (h3(seed, gid, 6330 + (ox * 100 | 0)) - 0.5) * R * 0.24;
        const jy = (h3(seed, gid, 6340 + (oy * 100 | 0)) - 0.5) * R * 0.24;
        const [lr, lg, lb] = gradeTreeHSL(...r3SampleRamp(R3PAL.leaf, 0.16), lumK, moonK);
        tctx.fillStyle = `rgba(${lr},${lg},${lb},0.95)`;
        tctx.beginPath();
        tctx.ellipse(pxC + ox * R + jx, pyC + oy * R + jy, R * rx, R * ry, ox * 0.6, 0, Math.PI * 2);
        tctx.fill();
      }
      const puffs = [
        { dx: 0, dy: -0.10, r: 0.95, k: 0.34, a: 0.88 },
        { dx: -0.20, dy: -0.32, r: 0.66, k: 0.52, a: 0.85 },
        { dx: 0.22, dy: -0.28, r: 0.58, k: 0.48, a: 0.82 },
        { dx: 0.38, dy: 0.08, r: 0.48, k: 0.30, a: 0.80, salt: 1 },
        { dx: -0.40, dy: 0.06, r: 0.44, k: 0.32, a: 0.80, salt: 2 },
      ];
      for (const pf of puffs) {
        const jx = pf.salt != null ? (h3(seed, gid, 6310 + pf.salt) - 0.5) * R * 0.3 : 0;
        const jy = pf.salt != null ? (h3(seed, gid, 6320 + pf.salt) - 0.5) * R * 0.3 : 0;
        const pr = R * pf.r;
        const [lr, lg, lb] = gradeTreeHSL(...r3SampleRamp(R3PAL.leaf, pf.k), lumK, moonK);
        const gx = pxC + pf.dx * R + jx, gy = pyC + pf.dy * R + jy;
        const g = tctx.createRadialGradient(gx, gy, 0, gx, gy, pr);
        g.addColorStop(0, `rgba(${lr},${lg},${lb},${pf.a.toFixed(3)})`);
        g.addColorStop(0.7, `rgba(${lr},${lg},${lb},${(pf.a * 0.55).toFixed(3)})`);
        g.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
        tctx.fillStyle = g;
        tctx.beginPath(); tctx.arc(gx, gy, pr, 0, Math.PI * 2); tctx.fill();
      }
      for (const lf of t.leaves) claimed.add(key(lf.cx, lf.cy));
    }
  }
  return claimed;
}

// LEGACY path (stills shim / tests): per-cell rects, day-only lighting.
// The browser paints with paintTerrain() below; this stays byte-stable for
// test/material-render.mjs, which asserts on the emitted rects.
// Paint sky + terrain into pctx (an offscreen canvas ctx in the browser,
// the real ctx in the shim). Returns dynamic lists for per-frame overlays:
// { leaves, fires, waterTop, sky } — screen-space.
function paintTerrainLegacy(pctx, mw, view, G, W, H) {
  const { grid, cols, rows, seed, surf, seaRow } = mw;
  const { px, py, scale, cellPx, cx0, cx1, cy0, cy1 } = G;
  const tick = mw.tick || 0;
  const e = sunElev(mw);
  const season = typeof seasonSin === 'function' ? seasonSin(mw) : 0;
  const pal = skyPalette(e, season);

  // --- sky: gradient mapped to the SKY REGION (not the full canvas) -----------------
  // so the warm horizon actually sits at the horizon instead of hiding
  // behind the terrain.
  const midCx = Math.max(cx0, Math.min(cx1, Math.round((cx0 + cx1) / 2)));
  const horizonY = clamp01(py(((surf[midCx] | 0) + 1) * CELL_PX) / H) * H;
  const skyGrad = pctx.createLinearGradient(0, 0, 0, Math.max(1, horizonY));
  const stops = [[0, pal[0]], [0.55, pal[1]], [1, pal[2]]];
  for (const [o, c] of stops) skyGrad.addColorStop(o, hslRgb(c[0], c[1], c[2]));
  pctx.fillStyle = skyGrad;
  pctx.fillRect(0, 0, W, H);

  // --- sun glow --------------------------------------------------------------------
  if (e > -0.08) {
    const t = timeOfDay(mw);
    const sx = W * (0.12 + 0.76 * t), sy = H * (0.72 - e * 0.62);
    const sr = Math.min(W, H) * 0.30;
    const sg = pctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    const warm = Math.max(0, 1 - Math.abs(e) * 2.2); // gold near horizon
    const sa = (0.10 + 0.30 * warm) * clamp01((e + 0.08) * 3);
    sg.addColorStop(0, `rgba(255, ${Math.round(244 - warm * 40)}, ${Math.round(220 - warm * 90)}, ${sa.toFixed(3)})`);
    sg.addColorStop(1, 'rgba(255, 240, 210, 0)');
    pctx.fillStyle = sg;
    pctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }

  // --- clouds: from the live weather columns, drifting with the wind -----------------
  if (mw.sky && mw.sky.cols) {
    const worldW = cols * CELL_PX;
    for (let i = 0; i < mw.sky.cols.length; i++) {
      const c = mw.sky.cols[i];
      if (c.cloud < 0.22) continue;
      const drift = ((tick * c.windU * 0.06 + h3(seed, i, 31) * 600) % (worldW + 900) + worldW + 900) % (worldW + 900) - 450;
      const wx = i * SKY_COL_W + drift * 0.3;
      const wy = H * (0.05 + h3(seed, i, 32) * 0.22); // screen-space band
      const sx = px(wx), sy = wy;
      if (sx < -400 || sx > W + 400) continue;
      const cr = cellPx * (2.2 + c.cloud * 4.5);
      const dark = clamp01(1 - (e + 0.25) / 0.6); // night clouds go dark
      // Subtle, wind-tied: calm skies keep clouds faint, gales make them read.
      // (Headless review 2026-10-03: the old flat alpha rendered as streak artifacts.)
      const windF = clamp01(Math.abs(c.windU || 0) / 50); // 0 calm → 1 gale
      const cc = `rgba(${Math.round(235 - dark * 190)}, ${Math.round(240 - dark * 195)}, ${Math.round(248 - dark * 190)}, ${((0.05 + c.cloud * 0.13) * (0.45 + 0.55 * windF)).toFixed(3)})`;
      pctx.fillStyle = cc;
      for (const [ox2, oy2, k] of [[0, 0, 1], [-0.9, 0.15, 0.7], [0.9, 0.18, 0.62]]) {
        pctx.beginPath();
        pctx.ellipse(sx + ox2 * cr, sy + oy2 * cr, cr * k, cr * k * 0.46, 0, 0, Math.PI * 2);
        pctx.fill();
      }
    }
  }

  // --- sky flood + AO prefix (as before, now cached) ----------------------------------
  const sky = floodSky(grid, cols, rows);
  const AO_RANGE = 12, SKYLIGHT_MIN_AO = 0.5;
  const gw = cx1 - cx0 + 1;
  const prefix = new Int32Array(gw * (rows + 1));
  const pw = rows + 1;
  for (let cx = cx0; cx <= cx1; cx++) {
    const base = (cx - cx0) * pw;
    for (let cy = 0; cy < rows; cy++) {
      const m = grid.mat[cy * cols + cx];
      prefix[base + cy + 1] = prefix[base + cy] + (MAT_PROPS[m].solid ? 1 : 0);
    }
  }
  const solidAbove = (cx, cy) => {
    const base = (cx - cx0) * pw;
    const lo = Math.max(0, cy - AO_RANGE);
    return prefix[base + cy] - prefix[base + lo];
  };

  // --- albedo field ----------------------------------------------------------------------
  // Per visible cell: rgb + material class + light. Sky-flagged air takes
  // the analytic sky color so boundaries melt into the sky, not into blue squares.
  const n = gw * rows;
  const alb = new Float32Array(n * 3);
  const cls = new Int16Array(n);   // material class (99 = water, 100 = sky air)
  const litA = new Float32Array(n);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const gi = cx - cx0;
      const i = cy * cols + cx;
      const m = grid.mat[i];
      const waterCell = isWaterCell(m, grid, i);
      const ao = solidAbove(cx, cy) / AO_RANGE;
      const lit = 1 - 0.62 * ao;
      const o = (cy * gw + gi) * 3;
      if (m === MAT.AIR && !waterCell && sky[i] && ao < SKYLIGHT_MIN_AO) {
        // open sky — the gradient shows through; albedo = sky color here
        const f = clamp01((py(cy * CELL_PX) + cellPx / 2) / H);
        const [r, g, b] = hsl2rgb(...skyHSLAt(f, pal));
        alb[o] = r; alb[o + 1] = g; alb[o + 2] = b;
        cls[cy * gw + gi] = 100; litA[cy * gw + gi] = lit;
        continue;
      }
      if (m === MAT.AIR && !waterCell) {
        if (sky[i]) {
          // shaft / burrow mouth: pale blue skylight dying with depth
          const depthF = 1 - ao;
          const [r, g, b] = hsl2rgb(206, 42 * depthF, shade(78, lit * depthF));
          alb[o] = r; alb[o + 1] = g; alb[o + 2] = b;
        } else {
          // sealed pocket: dark warm earth shadow, never sky
          const v = h3(seed, cx, cy);
          const [r, g, b] = hsl2rgb(20, 30, shade(11 + v * 4, lit));
          alb[o] = r; alb[o + 1] = g; alb[o + 2] = b;
        }
        cls[cy * gw + gi] = MAT.AIR; litA[cy * gw + gi] = lit;
        continue;
      }
      const [r, g, b] = cellRGB(m, cx, cy, i, grid, mw, lit, waterCell);
      alb[o] = r; alb[o + 1] = g; alb[o + 2] = b;
      cls[cy * gw + gi] = waterCell ? 99 : m; litA[cy * gw + gi] = lit;
    }
  }
  const albAt = (cx, cy) => { // clamped sample -> [r,g,b]
    const ccx = Math.max(cx0, Math.min(cx1, cx)), ccy = Math.max(0, Math.min(rows - 1, cy));
    const o = (ccy * gw + (ccx - cx0)) * 3;
    return [alb[o], alb[o + 1], alb[o + 2]];
  };

  // --- blended rects -------------------------------------------------------------------------
  // Each cell is drawn as 1 rect where the 3x3 neighborhood is uniform,
  // else 4 sub-rects colored by the corner blends. No hard cell edges.
  const leaves = [], fires = [], waterTop = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const gi = cx - cx0, ci = cy * gw + gi;
      const c0 = cls[ci];
      if (c0 === 100) continue; // open sky — gradient shows through
      const rx = px(cx * CELL_PX), ry = py(cy * CELL_PX);
      const s = cellPx + 0.6;
      // uniformity: same class + close light across the 3x3
      let uniform = true;
      const l0 = litA[ci];
      for (let oy = -1; oy <= 1 && uniform; oy++) {
        for (let ox = -1; ox <= 1 && uniform; ox++) {
          if (!ox && !oy) continue;
          const nx = Math.max(cx0, Math.min(cx1, cx + ox)), ny = Math.max(0, Math.min(rows - 1, cy + oy));
          const ni = ny * gw + (nx - cx0);
          if (cls[ni] !== c0 || Math.abs(litA[ni] - l0) > 0.05) uniform = false;
        }
      }
      const o = ci * 3;
      if (uniform) {
        pctx.fillStyle = `rgb(${alb[o] | 0},${alb[o + 1] | 0},${alb[o + 2] | 0})`;
        pctx.fillRect(rx, ry, s, s);
      } else {
        for (let qy = 0; qy < 2; qy++) {
          for (let qx = 0; qx < 2; qx++) {
            // corner (cx+qx, cy+qy): mean of the 4 meeting cells
            let r = 0, g = 0, b = 0;
            const cells = [[cx + qx - 1, cy + qy - 1], [cx + qx, cy + qy - 1], [cx + qx - 1, cy + qy], [cx + qx, cy + qy]];
            for (const [ax, ay] of cells) { const cc = albAt(ax, ay); r += cc[0]; g += cc[1]; b += cc[2]; }
            pctx.fillStyle = `rgb(${(r / 4) | 0},${(g / 4) | 0},${(b / 4) | 0})`;
            pctx.fillRect(rx + qx * s / 2, ry + qy * s / 2, s / 2 + 0.7, s / 2 + 0.7);
          }
        }
      }
      // dynamic lists (screen space)
      const i = cy * cols + cx;
      const m = grid.mat[i];
      if (m === MAT.LEAF) leaves.push({ x: rx, y: ry, s, cx, cy });
      if (grid.heat[i] > 0.5) fires.push({ x: rx + s / 2, y: ry + s / 2, s, heat: grid.heat[i], ph: h3(seed, cx, cy) });
      if (c0 === 99) {
        const above = cy > 0 ? grid.mat[i - cols] : MAT.AIR;
        if (!isWaterCell(above, grid, cy > 0 ? i - cols : -1)) waterTop.push({ x: rx, y: ry, s, cx });
      }
    }
  }
  return { leaves, fires, waterTop, sky, pal, sunE: e };
}


// --- per-frame life (never cached: shimmer, flicker, sway, rain) -------------------------------

function drawWaterShimmer(pctx, dyn, tick) {
  const amb = dyn.amb || [1, 1, 1];
  const r = Math.min(255, 235 * amb[0]) | 0, g = Math.min(255, 246 * amb[1]) | 0, b = Math.min(255, 252 * amb[2]) | 0;
  for (const w of dyn.waterTop) {
    const a = 0.30 + 0.18 * Math.sin(tick * 0.12 + w.cx * 0.7);
    pctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
    const yo = Math.sin(tick * 0.09 + w.cx * 0.5) * w.s * 0.06;
    pctx.fillRect(w.x, w.y + yo, w.s, Math.max(1.5, w.s * 0.26));
  }
}

function drawFireGlow(pctx, dyn, tick) {
  for (const f of dyn.fires) {
    const flick = 0.65 + 0.35 * Math.sin(tick * 0.8 + f.ph * 6.283);
    const r = f.s * 2.4;
    // solid ember core: the fire reads even at a glance
    pctx.fillStyle = `rgba(255, 118, 22, ${(0.5 * flick * f.heat).toFixed(3)})`;
    pctx.fillRect(f.x - f.s / 2, f.y - f.s / 2, f.s, f.s);
    const g = pctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    const hc = f.heat > 1 ? 1 : f.heat;
    g.addColorStop(0, `rgba(255, ${Math.round(140 + 80 * hc)}, 40, ${(0.55 * flick).toFixed(3)})`);
    g.addColorStop(0.55, `rgba(255, 110, 25, ${(0.28 * flick).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 90, 20, 0)');
    pctx.fillStyle = g;
    pctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
    if (f.heat > 0.82) { // white-hot core
      pctx.fillStyle = `rgba(255, 214, 120, ${(0.75 * flick).toFixed(3)})`;
      const ins = f.s * 0.28;
      pctx.fillRect(f.x - f.s / 2 + ins, f.y - f.s / 2 + ins, f.s - ins * 2, f.s - ins * 2);
    }
  }
}

function drawLeaves(pctx, dyn, mw, tick, amb) {
  if (!dyn.leaves.length) return;
  // one batched path: every leaf shares the same highlight fill, tinted by
  // the frame's ambient so the highlight doesn't glow at night.
  const r = Math.min(255, 255 * amb[0]) | 0, g = Math.min(255, 255 * amb[1]) | 0, b = Math.min(255, 255 * amb[2]) | 0;
  pctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.10)`;
  pctx.beginPath();
  let lastWq = -1e9, lastWind = 10;
  for (const L of dyn.leaves) {
    const wx = L.cx * 10 + 5, wq = wx - (wx % 200);
    if (wq !== lastWq) {
      lastWq = wq;
      lastWind = typeof windAt === 'function' ? windAt(mw, wq) : 10;
    }
    const sway = Math.sin(tick * 0.07 + L.cx * 0.35 + L.cy * 0.5) * lastWind * 0.12;
    // leaf color: lift the albedo toward the light.
    // NOTE: ellipse() continues the current subpath — without the moveTo,
    // the batched fill connects every leaf with straight lines (the old
    // "grey horizontal smear" artifact). Break the subpath per leaf.
    const ex = L.x + L.s / 2 + sway, ey = L.y + L.s / 2;
    pctx.moveTo(ex + L.s * 0.85, ey);
    pctx.ellipse(ex, ey, L.s * 0.85, L.s * 0.70, 0.2, 0, Math.PI * 2);
  }
  pctx.fill();
}

function drawRain(pctx, mw, G, W, H, tick, seed) {
  if (!mw.sky || !mw.sky.cols) return;
  const { py } = G;
  const topY = 0, botY = H * 0.85;
  // only the sky columns actually on screen
  const i0 = Math.max(0, Math.floor(G.vx / SKY_COL_W));
  const i1 = Math.min(mw.sky.cols.length - 1, Math.ceil((G.vx + G.vw) / SKY_COL_W));
  pctx.strokeStyle = 'rgba(200, 220, 240, 0.30)';
  pctx.lineWidth = 1.1;
  pctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const c = mw.sky.cols[i];
    if (c.rain < 0.04) continue;
    const nStreak = Math.min(26, Math.round(c.rain * 70));
    const slant = c.windU * 0.35;
    for (let k = 0; k < nStreak; k++) {
      const hx = h3(seed, i * 131 + k, 41);
      const x = (i * SKY_COL_W + hx * SKY_COL_W) % (G.worldW + 200);
      const fall = (h3(seed, i * 131 + k, 42) * (botY - topY) + tick * (2.2 + c.rain * 4)) % (botY - topY);
      const sx = G.px(x), sy = topY + fall;
      pctx.moveTo(sx, sy);
      pctx.lineTo(sx + slant, sy + 11);
    }
  }
  pctx.stroke();
}

function drawLightning(pctx, mw, G, W, H, tick, seed) {
  if (!mw.sky || !mw.sky.lightning) return;
  const { px, py } = G;
  for (const L of mw.sky.lightning) {
    const age = tick - L.t;
    if (age < 0 || age > 26) continue;
    const k = 1 - age / 26;
    const sx = px(L.x);
    const topY = H * 0.05, botY = H * 0.8;
    pctx.strokeStyle = `rgba(240, 244, 255, ${(0.9 * k).toFixed(3)})`;
    pctx.lineWidth = 2.2;
    pctx.beginPath();
    let x = sx, y = topY;
    pctx.moveTo(x, y);
    for (let sgm = 1; sgm <= 6; sgm++) {
      x = sx + (h3(seed, L.t | 0, sgm) - 0.5) * 46 * sgm / 3;
      y = topY + (botY - topY) * sgm / 6;
      pctx.lineTo(x, y);
    }
    pctx.stroke();
    // the flash washes the scene
    pctx.fillStyle = `rgba(235, 240, 255, ${(0.22 * k).toFixed(3)})`;
    pctx.fillRect(0, 0, W, H);
  }
}

// diurnal tint: dawn/dusk warmth, night blue. The lab-bench inspect view
// keeps the same scene — tint is honest light, not decoration.
function drawTint(pctx, e, W, H) {
  // Gentle final grade — the lightmap now carries the diurnal temperature,
  // so this is only a whisper on top (softened in round 3).
  if (e > 0.28) return;
  if (e >= 0) {
    const k = 1 - e / 0.28;
    pctx.fillStyle = `rgba(255, 148, 64, ${(0.07 * k).toFixed(3)})`;
  } else {
    const k = Math.min(1, -e * 1.4);
    pctx.fillStyle = `rgba(16, 24, 64, ${(0.16 * k).toFixed(3)})`;
  }
  pctx.fillRect(0, 0, W, H);
}

/**
 * renderWorldView(ctx, mw, view, opts) — the naturalistic painting.
 * (doc comment from M1 kept: world view only, no text, no UI.)
 */
export function renderWorldView(ctx, mw, view, opts = {}) {
  // ANTI-SHIMMER (jank profile 2026-10-04): the page's camera lerp never
  // settles — view.x/view.y drift sub-pixel every frame, which churned the
  // float cache key (99.4% miss → a full paintTerrain per frame, ~78ms at
  // dpr1). The paint view is snapped to whole world-px up front, so paint,
  // key, creatures, and overlays all agree exactly: micro-motion neither
  // invalidates the cache nor shifts the image. (The page-side deadband
  // settles the camera itself; this keeps every consumer consistent even
  // while it pans.)
  view = { x: Math.round(view.x), y: Math.round(view.y), w: view.w, h: view.h };
  const { grid, cols, rows, seed } = mw;
  const W = ctx.w, H = ctx.h;
  const scale = Math.min(W / view.w, H / view.h);
  const ox = (W - view.w * scale) / 2;
  const oy = (H - view.h * scale) / 2;
  const px = (wx) => ox + (wx - view.x) * scale;
  const py = (wy) => oy + (wy - view.y) * scale;
  const cellPx = CELL_PX * scale;
  const G = {
    px, py, scale, cellPx, ox, oy,
    vx: view.x, vw: view.w,
    cx0: Math.max(0, Math.floor(view.x / CELL_PX) - 1),
    cx1: Math.min(cols - 1, Math.ceil((view.x + view.w) / CELL_PX) + 1),
    cy0: Math.max(0, Math.floor(view.y / CELL_PX) - 1),
    cy1: Math.min(rows - 1, Math.ceil((view.y + view.h) / CELL_PX) + 1),
    worldW: cols * CELL_PX,
  };
  const tick = mw.tick || 0;

  // --- terrain: cached in the browser, painted direct in the stills shim -------
  // Round 3: the browser paints TWO cached canvases (sky + world); the
  // lightmap grades the world (and creatures) per frame while the sky keeps
  // its authored day/night gradient.
  let dyn;
  if (hasDocument) {
    const key = cacheKey(mw, view, W, H);
    if (!terrainCache || terrainCache.key !== key || (tick - terrainCache.tick) > CACHE_TICKS) {
      const d = paintTerrain(null, mw, view, G, W, H);
      terrainCache = { key, tick, dyn: d };
    }
    dyn = terrainCache.dyn;
    ctx.drawImage(dyn.canvas, 0, 0);
  } else {
    dyn = paintTerrainLegacy(ctx, mw, view, G, W, H);
  }

  // --- per-frame life ----------------------------------------------------------------------
  drawWaterShimmer(ctx, dyn, tick);
  if (hasDocument && dyn.blades) drawBlades(ctx, dyn.blades, tick, 2.2, dyn.amb || [1, 1, 1]);
  drawLeaves(ctx, dyn, mw, tick, dyn.amb || [1, 1, 1]);
  if (hasDocument) {
    drawFallingLeaves(ctx, dyn, tick, seed, dyn.amb || [1, 1, 1]);
    drawMotes(ctx, dyn, tick, W, H, seed);
    drawRipples(ctx, dyn, tick, dyn.amb || [1, 1, 1]);
  }
  drawRain(ctx, mw, G, W, H, tick, seed);
  if (hasDocument) drawLightningBolts(ctx, mw, G, W, H, tick, seed);
  else drawLightning(ctx, mw, G, W, H, tick, seed);

  // --- creatures: the fauna ------------------------------------------------------------------
  // opts.creatures draws the whole living roster (eye only). Non-tanglekin
  // species get their silhouettes from fauna.js; the tanglekin keeps its
  // grown-body renderer. oc.drawing is portraitFor() output — live pose.
  // In the browser, creatures go through the spring-joint wrapper (weight,
  // lean, squash, tail/head lag, spawn scale-in, blob shadow, rim light).
  const roster = opts.creatures || (opts.creature ? [opts.creature] : []);
  for (const oc of roster) {
    const sx = px(oc.x), sy = py(oc.y);
    if (sx < -300 || sx > ctx.w + 300 || sy < -300 || sy > ctx.h + 300) continue;
    const drawFn = (oc.drawing && oc.species && oc.species !== 'tanglekin')
      ? drawSpeciesBody
      : (oc.drawing ? drawGrownBody : drawCreature);
    if (hasDocument) springDraw(ctx, oc, drawFn, px, py, scale, tick, dyn);
    else drawFn(ctx, oc, px, py, scale);
  }

  if (hasDocument) {
    // additive glows sit on top of the lightmap-graded scene
    drawFireGlow(ctx, dyn, tick);
    drawFireflyDots(ctx, dyn, tick, W, seed);
    drawLightningFlash(ctx, mw, tick, W, H);
  } else {
    drawFireGlow(ctx, dyn, tick);
  }

  // diurnal tint last, over creatures too — moonlight grades the whole scene
  drawTint(ctx, dyn.sunE, W, H);

  // qx/qy: the quantized paint origin, so overlays (inspect view) agree
  // exactly with the snapped paint (anti-shimmer).
  return { scale, ox, oy, qx: view.x, qy: view.y };
}

// Flood-fill AIR from the top row across the whole grid. Returns a
// Uint8Array where 1 = this cell is open sky. Water cells are not air for
// sky purposes; a flooded tunnel mouth still reads as sky — it IS open.
function floodSky(grid, cols, rows) {
  const n = cols * rows;
  const sky = new Uint8Array(n);
  const stack = [];
  for (let cx = 0; cx < cols; cx++) {
    const i = cx; // row 0
    if (grid.mat[i] === MAT.AIR && grid.water[i] <= 0.5) { sky[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % cols, y = (i / cols) | 0;
    const tryPush = (j) => {
      if (!sky[j] && grid.mat[j] === MAT.AIR && grid.water[j] <= 0.5) { sky[j] = 1; stack.push(j); }
    };
    if (x > 0) tryPush(i - 1);
    if (x < cols - 1) tryPush(i + 1);
    if (y > 0) tryPush(i - cols);
    if (y < rows - 1) tryPush(i + cols);
  }
  return sky;
}

function isWaterCell(m, grid, i) {
  if (m === MAT.WATER) return true;
  return m === MAT.AIR && i >= 0 && grid.water[i] > 0.5;
}

// One material, one visual language. lit ∈ (0,1] is the AO factor — the
// single top-left light, dying with depth.
function cellHSL(m, cx, cy, i, grid, mw, lit) {
  const { seed, surf } = mw;
  const moist = grid.moist[i];

  switch (m) {
    case MAT.AIR: {
      // Underground air: the dark earth shadow. Never sky — the caller only
      // reaches here for non-sky air (tunnels, burrows, pockets).
      const v = h3(seed, cx, cy);
      return [20, 30, shade(11 + v * 4, lit)];
    }
    case MAT.SOIL: {
      // Layered umbers: darker with depth below the surface, darker when moist.
      // Grain is smooth 2D noise (~3 cells) — the old per-cell hash read as
      // a checkerboard; a whisper of per-cell tooth remains for texture.
      const depth = Math.max(0, cy - (surf[cx] | 0));
      const grain = vnoise2(seed, cx * 0.33, cy * 0.33, 11);
      const tooth = h3(seed, cx, cy);
      const strata = h3(seed, cx >> 2, cy >> 1);
      let l = 34 - Math.min(depth, 26) * 0.62 - moist * 7 + (grain - 0.5) * 5 + (tooth - 0.5) * 1.2 + (strata - 0.5) * 3;
      return [23 + (grain - 0.5) * 6, 36, shade(l, lit)];
    }
    case MAT.SAND: {
      const v = vnoise2(seed, cx * 0.33, cy * 0.33, 12);
      return [45 + (v - 0.5) * 8, 55, shade(63 + (v - 0.5) * 6 - moist * 4, lit)];
    }
    case MAT.CLAY: {
      const v = vnoise2(seed, cx * 0.33, cy * 0.33, 13);
      return [14 + (v - 0.5) * 8, 44, shade(37 + (v - 0.5) * 6 - moist * 3, lit)];
    }
    case MAT.ROCK: {
      // Cool greys, faint horizontal strata — bands run along cy.
      const band = h3(seed, cy >> 2, 7);
      const v = vnoise2(seed, cx * 0.33, cy * 0.33, 14);
      return [212 + (v - 0.5) * 10, 9, shade(37 + (band - 0.5) * 11 + (v - 0.5) * 5, lit)];
    }
    case MAT.WOOD: {
      // Bark browns with subtle vertical grain; vary by grownId so one tree
      // reads as one tree (same plant, same timber).
      const gid = grid.grownId[i] || 1;
      const treeTone = h3(seed, gid, 555);
      const grainStripe = h3(seed + gid, cx, 99);   // varies along x: vertical grain
      const v = h3(seed, cx, cy);
      let l = 33 + (treeTone - 0.5) * 10 + (v - 0.5) * 4;
      if (grainStripe < 0.22) l -= 6;               // a dark grain line
      return [24 + (treeTone - 0.5) * 12, 36, shade(l, lit)];
    }
    case MAT.DEADWOOD: {
      const v = h3(seed, cx, cy);
      return [30 + (v - 0.5) * 8, 13, shade(29 + (v - 0.5) * 6, lit)];
    }
    case MAT.LEAF: {
      // Greens varied per cell by stateless hash — canopy clusters, never
      // sticker dots. Interior leaves are dimmed by the AO so the crown has
      // depth.
      const hue = h3(seed, cx, cy);
      const val = h3(seed, cy, cx);
      return [96 + hue * 34, 42 + hue * 12, shade(24 + val * 13, lit)];
    }
    case MAT.BEDROCK: {
      const v = h3(seed, cx, cy);
      return [222, 12, shade(9 + v * 5, lit)];
    }
    default: {
      // MAT.WATER, or AIR with water depth > 0.5: blues graded by depth.
      const depth = m === MAT.AIR ? clamp01(grid.water[i]) : 0.65 + 0.3 * h3(seed, cx, cy);
      const v = h3(seed, cx, cy);
      return [206 + (v - 0.5) * 10, 62, shade(58 - depth * 30 + (v - 0.5) * 4, lit)];
    }
  }
}

// A small monkey-like silhouette, ~60px tall, dark-furred, tail curve.
// Humble by design: the world is the subject. c = { x, y, facing },
// pixel coords, y = FEET. facing >= 0 looks right.
function drawCreature(ctx, c, px, py, scale) {
  ctx.save();
  ctx.translate(px(c.x), py(c.y));
  ctx.scale(scale * (c.facing >= 0 ? 1 : -1), scale);
  const fur = 'rgb(58, 42, 28)';
  const furLight = 'rgb(96, 70, 46)';

  // tail: a back-swept curve
  ctx.strokeStyle = fur;
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-9, -18);
  ctx.quadraticCurveTo(-30, -22, -27, -50);
  ctx.stroke();

  // legs
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(-6, -20); ctx.lineTo(-9, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(7, -20); ctx.lineTo(10, 0); ctx.stroke();

  // body: rounded torso
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, -33, 12.5, 19, 0);
  ctx.fill();

  // head + muzzle
  ctx.beginPath();
  ctx.arc(5, -57, 10.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = furLight;
  ctx.beginPath();
  ctx.ellipse(9, -55, 5.5, 4.5, 0);
  ctx.fill();

  // arm reaching slightly forward
  ctx.strokeStyle = fur;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(8, -38); ctx.quadraticCurveTo(16, -30, 13, -20); ctx.stroke();

  ctx.restore();
}

// --- ART PASS (2026-10-03, "the tanglekin looks too simple") -------------------
// The grown body, drawn as the animal it is: articulated two-segment limbs
// with real joints (2-bone IK), a torso that breathes, a prehensile tail
// with curl, a face with eyes/brow/muzzle/ears that reads the affect system,
// and genome-driven individuality — coat coloration per body region,
// spots/stripes/plain patterning, fur, ear shape, scars that stay visible.
//
// d = portraitFor() output: static bodyDrawing + .pose + .affect.
// Callers passing a bare bodyDrawing() get the neutral pose.
// Pure function of (drawing, tick) — it never touches sim state.
function drawGrownBody(ctx, c, px, py, scale) {
  const d = c.drawing;
  const pose = d.pose || neutralPose();
  const id = d.creatureId || 0;
  ctx.save();
  ctx.translate(px(c.x), py(c.y));
  ctx.scale(scale * (c.facing >= 0 ? 1 : -1), scale);

  const H = d.heightPx, W = d.widthPx;
  const screenH = H * scale; // on-screen px: detail below ~85px is noise, not texture
  const coatH = d.coatHue01 * 360, coatS = d.coatSat01 * 100;
  const col = (pig, L, sMul = 1) =>
    `hsl(${(coatH + pig.hueDeg + 360) % 360}, ${Math.max(8, Math.min(90, coatS * sMul + pig.satShift))}%, ${L}%)`;
  const furTorso = col(d.pigTorso, 27), furLimb = col(d.pigLimbs, 23),
    furHead = col(d.pigHead, 30), furPale = col(d.pigTorso, 43, 0.8),
    furDark = col(d.pigTorso, 16), markDark = col(d.pigTorso, 15, 0.9),
    scarCol = `hsl(${coatH}, 22%, 64%)`, handCol = col(d.pigLimbs, 18);

  if (pose.curled > 0.5) { drawCurled(ctx, d, pose, id, H, W, furTorso, furPale, furHead, scarCol, coatH, screenH); ctx.restore(); return; }

  // --- skeleton ------------------------------------------------------------
  const crouch = pose.crouch;
  const hipY = -H * 0.32 + crouch * H * 0.20;
  const torsoLen = H * 0.34;
  const lean = pose.spineLean + pose.sway * 0.12;
  const shX = Math.sin(lean) * torsoLen, shY = hipY - Math.cos(lean) * torsoLen;
  const torsoW = W * 0.40 * (1 + pose.breath * 0.03); // slimmed from 0.42:
  // the 0.80-wide torso ellipse read as a ball; a waist reads as a body
  // Primate proportions (Joshua, 2026-10-04): the tanglekin reads monkey,
  // not frog-baby — smaller head relative to the torso, long forelimbs,
  // legs that reach the ground. The genome still drives H/W/coat/ears;
  // these fractions are the art's species read.
  const legLen = H * (0.32 + 0.14 * d.legLength01);
  const armLen = H * 0.40;
  const headR = W * 0.245; // up a touch from 0.22: the face needs room for
  // readable eyes + mask at game-view sizes, still well clear of frog-baby

  // two-bone IK: joint position for (root → target), bending to bendSign.
  const ik = (rx, ry, tx, ty, l1, l2, bendSign) => {
    let dx = tx - rx, dy = ty - ry, dist = Math.hypot(dx, dy) || 1e-6;
    const maxD = l1 + l2 - 0.01;
    if (dist > maxD) { const k = maxD / dist; dx *= k; dy *= k; dist = maxD; tx = rx + dx; ty = ry + dy; }
    const cosA = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
    const ang = Math.atan2(dy, dx) + bendSign * Math.acos(cosA);
    return { jx: rx + l1 * Math.cos(ang), jy: ry + l1 * Math.sin(ang), tx, ty };
  };
  const limb2 = (rx, ry, tx, ty, l1, l2, bendSign, w, color, scarred) => {
    const k = ik(rx, ry, tx, ty, l1, l2, bendSign);
    // two-pass limb: dark edge under, lit core over — cheap roundness
    ctx.lineCap = 'round';
    ctx.strokeStyle = furDark; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(k.jx, k.jy); ctx.lineTo(k.tx, k.ty); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, w * 0.55);
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(k.jx, k.jy); ctx.lineTo(k.tx, k.ty); ctx.stroke();
    if (scarred) { // pale slashes across the segment — the world stays visible
      ctx.strokeStyle = scarCol; ctx.lineWidth = Math.max(1.2, w * 0.35);
      const mx = (rx + k.jx) / 2, my = (ry + k.jy) / 2;
      ctx.beginPath(); ctx.moveTo(mx - w * 0.7, my - w * 0.4); ctx.lineTo(mx + w * 0.7, my + w * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx - w * 0.5, my + w * 0.5); ctx.lineTo(mx + w * 0.6, my - w * 0.5); ctx.stroke();
    }
    return k;
  };

  const graspArm = d.limbs.find((l) => l.site === 'shoulder' && l.type === 'grasp');
  const graspLeg = d.limbs.find((l) => l.site === 'hip' && l.type === 'grasp');
  const armScar = !!(graspArm && graspArm.scarred), legScar = !!(graspLeg && graspLeg.scarred);
  const armW = Math.max(3, W * 0.13), legW = Math.max(3.5, W * 0.15);

  // gait targets
  const sw = Math.sin(pose.gaitPhase), swF = Math.sin(pose.gaitPhase + Math.PI);
  const limpK = pose.limp ? 1 - 0.5 * pose.limp : 1;
  const nearFoot = { x: sw * pose.gaitAmp, y: -Math.max(0, Math.cos(pose.gaitPhase)) * pose.gaitAmp * 0.45 };
  const farFoot = { x: swF * pose.gaitAmp * limpK, y: -Math.max(0, Math.cos(pose.gaitPhase + Math.PI)) * pose.gaitAmp * 0.45 * limpK };

  // hand targets: reach forward + counter-swing + dig oscillation
  const reach = pose.armReach;
  const digY = Math.sin(pose.digPhase) * pose.digOsc * H * 0.06;
  const nearHand = {
    x: shX + W * 0.22 + reach * armLen * 0.75 - sw * pose.gaitAmp * 0.55,
    y: shY + armLen * 0.62 - reach * armLen * 0.35 + digY,
  };
  const farHand = {
    x: shX + W * 0.02 + reach * armLen * 0.7 - swF * pose.gaitAmp * 0.55,
    y: shY + armLen * 0.55 - reach * armLen * 0.25,
  };

  // --- far side (darker, behind) -------------------------------------------
  ctx.globalAlpha = 0.72;
  limb2(-W * 0.10, hipY, farFoot.x - W * 0.06, farFoot.y, legLen * 0.52, legLen * 0.52, -1, legW, furDark, false);
  limb2(shX - W * 0.14, shY, farHand.x, farHand.y, armLen * 0.5, armLen * 0.5, 1, armW, furDark, false);
  ctx.globalAlpha = 1;

  // --- tail: segmented, prehensile, curl + raise + sway ----------------------
  drawTail(ctx, d, pose, id, -W * 0.22, hipY + H * 0.03, furLimb);

  // --- fur halo (shaggy bodies read soft) ------------------------------------
  // gated by on-screen size: below ~85px the halo is blur, not fur
  if (d.fur > 0.35 && screenH > 85) {
    ctx.save();
    ctx.translate(shX / 2, (hipY + shY) / 2); ctx.rotate(lean);
    ctx.globalAlpha = 0.10 * d.fur; ctx.fillStyle = furPale;
    ctx.beginPath(); ctx.ellipse(0, 0, torsoW * 1.12, torsoLen * 0.68, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // --- torso -----------------------------------------------------------------
  // gradient shading: dark dorsal, warm mid, pale ventral — never a flat fill
  const torsoGrad = ctx.createLinearGradient(0, -torsoLen * 0.72, 0, torsoLen * 0.72);
  torsoGrad.addColorStop(0, artHelpers.hslRgb(d.coatHue01 * 360, 30, 16));
  torsoGrad.addColorStop(0.55, furTorso);
  torsoGrad.addColorStop(1, furPale);
  ctx.save();
  ctx.translate(shX / 2, (hipY + shY) / 2); ctx.rotate(lean);
  ctx.fillStyle = torsoGrad;
  ctx.beginPath(); ctx.ellipse(0, 0, torsoW * 0.80, torsoLen * 0.72, 0, 0, Math.PI * 2); ctx.fill();
  // belly: paler front
  ctx.fillStyle = furPale; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.ellipse(torsoW * 0.26, torsoLen * 0.06, torsoW * 0.36, torsoLen * 0.52, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  drawCoatPattern(ctx, d, id, torsoW, torsoLen, markDark, furPale, screenH);
  drawTorsoScars(ctx, d, id, torsoW, torsoLen, scarCol);
  // fur + rim light over the torso — both scaled back at game-view sizes,
  // where dense strokes turn to noise and hard rims to white scratches
  const furN = screenH > 130 ? 24 + Math.round(d.fur * 26) : screenH > 85 ? 12 : 0;
  if (furN > 0) artHelpers.furStrokes(ctx, id, 0, 0, torsoW * 0.78, torsoLen * 0.70, 0.1, furN, 4.5, furPale, furDark, 500);
  artHelpers.rimArc(ctx, 0, 0, torsoW * 0.78, torsoLen * 0.70, 0, furPale, screenH > 130 ? 0.30 : 0.16, 1.6);
  ctx.restore();

  // --- bud flaps (membrane / sail / fin / gill) -------------------------------
  // Small fins hugging the torso — anchored at the body surface, never
  // floating. They are real anatomy (the genome grew them), drawn honestly
  // but humbly.
  for (const l of d.limbs) {
    if (l.type === 'grasp') continue;
    const fw = Math.min(l.lenPx * 0.20, W * 0.16), fh = Math.min(l.lenPx * 0.30, H * 0.10);
    let fx, fy, rot;
    if (l.site === 'dorsal') { fx = shX / 2 - W * 0.05; fy = (hipY + shY) / 2 - torsoLen * 0.55; rot = -0.5; }
    else if (l.site === 'neck') { fx = shX + W * 0.05; fy = shY - torsoLen * 0.15; rot = 0.4; }
    else { fx = (l.side === 'L' ? -1 : 1) * torsoW * 0.72 + shX / 2; fy = (hipY + shY) / 2; rot = l.side === 'L' ? -1.1 : 1.1; }
    ctx.save();
    ctx.translate(fx, fy); ctx.rotate(rot);
    ctx.fillStyle = l.scarred ? scarCol : furTorso; ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.ellipse(fw * 0.5, 0, fw * 0.7, fh * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // --- near-side limbs ----------------------------------------------------------
  const nk = limb2(W * 0.10, hipY, nearFoot.x + W * 0.04, nearFoot.y, legLen * 0.52, legLen * 0.52, -1, legW, furLimb, legScar);
  limb2(shX + W * 0.16, shY, nearHand.x, nearHand.y, armLen * 0.5, armLen * 0.5, 1, armW, furLimb, armScar);
  // feet + hands: grasping extremities — a foot with toes, a hand with
  // fingers that curl. Primate, not nub.
  ctx.fillStyle = handCol;
  ctx.beginPath(); ctx.ellipse(nk.tx + 2, nk.ty - 1.5, legW * 0.75, legW * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = handCol; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.2, legW * 0.28);
  for (let t = 0; t < 3; t++) { // toes fan forward from the foot
    const tx = nk.tx + 2 + legW * 0.55, ty = nk.ty - 1.5 + (t - 1) * legW * 0.32;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + legW * 0.55, ty + legW * 0.12); ctx.stroke();
  }
  // the hand: palm + three curling fingers
  const hx2 = nearHand.x + 1.5, hy2 = nearHand.y;
  ctx.fillStyle = handCol;
  ctx.beginPath(); ctx.arc(hx2, hy2, armW * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = handCol; ctx.lineWidth = Math.max(1.2, armW * 0.30);
  for (let f = 0; f < 3; f++) {
    const fa = 0.5 + f * 0.5; // fan
    const fx = hx2 + Math.cos(fa) * armW * 0.5, fy = hy2 + Math.sin(fa) * armW * 0.5;
    ctx.beginPath(); ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx + armW * 0.35, fy + armW * 0.30, fx + armW * 0.28, fy + armW * 0.72);
    ctx.stroke();
  }

  // --- head + face: the affect readout ------------------------------------------
  // neck: a soft shadow where head meets torso, so the head sits ON the body
  ctx.fillStyle = 'rgba(10, 8, 5, 0.20)';
  ctx.beginPath(); ctx.ellipse(shX, shY - headR * 0.35, headR * 0.55, headR * 0.42, lean * 0.5, 0, Math.PI * 2); ctx.fill();
  drawHead(ctx, d, pose, id, shX, shY, lean, headR, furHead, furPale, furDark, scarCol, coatH, screenH);

  ctx.restore();
}

// The prehensile tail: chained segments, base angle steered by tailRaise,
// progressive curl (+ prehensile tip scaled by tailGrip), idle sway.
// Thick and muscular at the base — a fifth limb, not a rat-tail.
function drawTail(ctx, d, pose, id, bx, by, color) {
  const nTails = Math.max(1, Math.min(3, d.tails || 1));
  for (let t = 0; t < nTails; t++) {
    const segs = 6, segLen = d.tailLenPx / segs;
    let ang = Math.PI - 0.35 + pose.tailRaise * 1.05 + (t - (nTails - 1) / 2) * 0.22;
    let x = bx, y = by;
    ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (let s = 0; s < segs; s++) {
      const tipK = s >= segs - 2 ? 1 + d.tailGrip * 1.6 : 1; // prehensile tip
      ang += pose.tailCurl * 0.30 * tipK + pose.tailSway * 0.10 * Math.sin(s * 0.9);
      const nx = x + Math.cos(ang) * segLen, ny = y + Math.sin(ang) * segLen;
      ctx.lineWidth = Math.max(2.4, (1 - s / segs) * 7.5);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      x = nx; y = ny;
    }
  }
}

// Coat patterning in the torso's local frame (already translated+rotated).
// Spots / stripes / plain grain — density from the genome, placement from
// the individual's hash salt. Deterministic, decorative, never sim.
// Restraint is the design (appeal pass): stripes are soft broken dashes on
// the upper back only — never horizontal bands around the whole torso, which
// read as grub/watermelon. Below ~110px on screen, patterning is noise, so
// only the grain shows. screenH defaults large for callers without a scale.
function drawCoatPattern(ctx, d, id, torsoW, torsoLen, markDark, furPale, screenH = 999) {
  const dens = d.patternDensity;
  if (d.pattern === 'spots') {
    if (screenH < 110) return;
    const n = Math.round(dens * 12);
    ctx.fillStyle = markDark;
    for (let i = 0; i < n; i++) {
      const a = h4(id, 200 + i, 7) * Math.PI * 2, r = 0.15 + h4(id, 300 + i, 7) * 0.62;
      const sx = Math.cos(a) * torsoW * 0.80 * r, sy = Math.sin(a) * torsoLen * 0.72 * r;
      ctx.globalAlpha = 0.32;
      ctx.beginPath(); ctx.ellipse(sx, sy, 1.4 + h4(id, 400 + i, 7) * 2.0, 1.2 + h4(id, 500 + i, 7) * 1.6, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (d.pattern === 'stripes') {
    if (screenH < 110) return;
    const n = 2 + Math.round(dens * 3);
    ctx.fillStyle = markDark;
    for (let i = 0; i < n; i++) {
      // short soft dashes along the upper back, jittered — tabby spine, not bands
      const t = n === 1 ? 0.5 : i / (n - 1);
      const cx = (h4(id, 210 + i, 7) - 0.5) * torsoW * 0.9;
      const cy = -torsoLen * (0.30 + t * 0.35);
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.ellipse(cx, cy, torsoW * (0.16 + h4(id, 230 + i, 7) * 0.10), torsoLen * 0.035, (h4(id, 240 + i, 7) - 0.5) * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // plain: a whisper of grain so the coat isn't flat
    ctx.fillStyle = furPale;
    for (let i = 0; i < 8; i++) {
      const a = h4(id, 220 + i, 7) * Math.PI * 2, r = 0.2 + h4(id, 320 + i, 7) * 0.6;
      ctx.globalAlpha = 0.13;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * torsoW * 0.68 * r, Math.sin(a) * torsoLen * 0.62 * r, 2.2, 1.4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// Torso scars: pale slashes where the world wrote on the body.
function drawTorsoScars(ctx, d, id, torsoW, torsoLen, scarCol) {
  const n = d.torsoScarCount || 0;
  ctx.strokeStyle = scarCol; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = h4(id, 600 + i, 7) * Math.PI * 2, r = 0.25 + h4(id, 700 + i, 7) * 0.5;
    const sx = Math.cos(a) * torsoW * 0.62 * r, sy = Math.sin(a) * torsoLen * 0.60 * r;
    const len = 5 + h4(id, 800 + i, 7) * 7, rot = h4(id, 900 + i, 7) * Math.PI;
    ctx.globalAlpha = 0.8; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(rot) * len / 2, sy - Math.sin(rot) * len / 2);
    ctx.lineTo(sx + Math.cos(rot) * len / 2, sy + Math.sin(rot) * len / 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// The head: skull, ears per genome, and the face — eyes (openness = affect),
// brow (fear/pain), muzzle + mouth (eating/calling). Drawn in a head-local
// frame rotated by spine lean + head pitch, facing +x.
function drawHead(ctx, d, pose, id, shX, shY, lean, headR, furHead, furPale, furDark, scarCol, coatH, screenH = 999) {
  const pitch = lean + pose.headPitch;
  const hx = shX + Math.sin(pitch) * headR * 1.02;
  const hy = shY - Math.cos(pitch) * headR * 1.02;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(pitch);

  // skull: gradient, never flat
  const skullGrad = ctx.createLinearGradient(0, -headR, 0, headR);
  skullGrad.addColorStop(0, furDark);
  skullGrad.addColorStop(0.55, furHead);
  skullGrad.addColorStop(1, furPale);
  ctx.fillStyle = skullGrad;
  ctx.beginPath(); ctx.arc(0, 0, headR, 0, Math.PI * 2); ctx.fill();

  // ears: genome shape, set into the side of the skull, pinned back by fear
  const earBack = pose.earBack;
  const ex = -headR * (0.80 + earBack * 0.15), ey = -headR * (0.08 - earBack * 0.18);
  ctx.fillStyle = furHead;
  const es = d.earScale;
  if (d.earShape === 'pointy') {
    ctx.beginPath();
    ctx.moveTo(ex - headR * 0.22 * es, ey + headR * 0.16 * es);
    ctx.lineTo(ex - headR * 0.02 * es, ey - headR * 0.34 * es);
    ctx.lineTo(ex + headR * 0.20 * es, ey + headR * 0.10 * es);
    ctx.closePath(); ctx.fill();
  } else if (d.earShape === 'floppy') {
    ctx.beginPath();
    ctx.ellipse(ex - headR * 0.06 * es, ey + headR * 0.26 * es, headR * 0.17 * es, headR * 0.32 * es, 0.3 + earBack * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(ex, ey, headR * 0.22 * es, 0, Math.PI * 2); ctx.fill();
  }
  // inner ear
  ctx.fillStyle = furPale; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.arc(ex, ey, headR * 0.10 * es, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // fur + rim over the crown
  artHelpers.furStrokes(ctx, id, 0, -headR * 0.2, headR * 0.85, headR * 0.7, 0.5, 12, 3, furPale, furDark, 510);
  artHelpers.rimArc(ctx, 0, 0, headR * 0.94, headR * 0.94, 0, furPale, 0.32, 1.3);

  // face mask: a soft pale field behind eyes + muzzle — the readable
  // "monkey face" (capuchin-like: pale face, dark cap). This is what makes
  // the eye read at game-view sizes instead of sinking into the coat.
  ctx.fillStyle = furPale; ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.ellipse(headR * 0.30, headR * 0.10, headR * 0.58, headR * 0.52, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // eye: shaded orb, openness from the affect readout — a window, not a bead.
  // sized to read at distance: the old eye vanished below ~100px on screen.
  const erx = headR * (0.19 + 0.30 * d.eyeSize);
  const ery = Math.max(0.6, erx * pose.eyeOpenNow);
  const exx = headR * 0.40, eyy = -headR * 0.08;
  artHelpers.drawEye(ctx, exx, eyy, erx, pose.eyeOpenNow);

  // brow: a light ridge that lowers and angles with fear / pain — quiet
  // unless the affect is strong, so the resting face stays open
  const bd = pose.browDrop;
  if (bd > 0.2 || screenH > 130) {
    ctx.strokeStyle = furDark; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, headR * 0.05);
    ctx.globalAlpha = 0.30 + bd * 0.50;
    ctx.beginPath();
    ctx.moveTo(exx - erx * 0.85, eyy - ery - headR * 0.24);
    ctx.lineTo(exx + erx * 0.80, eyy - ery - headR * 0.24 + bd * headR * 0.30);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // muzzle: tucked under the eye, sized by the mouth gene — no beak
  const mzx = headR * 0.52, mzy = headR * 0.42;
  const mrx = headR * (0.34 + 0.26 * d.mouthSize), mry = headR * (0.28 + 0.20 * d.mouthSize);
  ctx.fillStyle = furPale;
  ctx.beginPath(); ctx.ellipse(mzx, mzy, mrx, mry, 0.1, 0, Math.PI * 2); ctx.fill();
  // nose
  ctx.fillStyle = '#241a12';
  ctx.beginPath(); ctx.arc(mzx + mrx * 0.62, mzy - mry * 0.30, Math.max(1, headR * 0.08), 0, Math.PI * 2); ctx.fill();
  // mouth: a line that opens with eating / calling / display
  const mo = pose.mouthOpen;
  ctx.strokeStyle = '#241a12'; ctx.lineWidth = Math.max(1.2, headR * 0.07);
  if (mo > 0.25) {
    ctx.fillStyle = '#3a1f16';
    ctx.beginPath(); ctx.ellipse(mzx + mrx * 0.2, mzy + mry * 0.55, mrx * 0.40 * mo, mry * 0.48 * mo, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(mzx - mrx * 0.30, mzy + mry * 0.42); ctx.lineTo(mzx + mrx * 0.38, mzy + mry * 0.36); ctx.stroke();
  }

  ctx.restore();
}

// Sleep: the curled ball. Head tucked, limbs folded, tail wrapped —
// recognizable at a glance, drawn from the same coat (same values as the
// awake body, so it reads as the same animal asleep, not a different one).
function drawCurled(ctx, d, pose, id, H, W, furTorso, furPale, furHead, scarCol, coatH, screenH = 999) {
  const R = H * 0.26;
  const breathe = 1 + pose.breath * 0.04;
  const ballGrad = ctx.createLinearGradient(0, -R * 2, 0, 0);
  ballGrad.addColorStop(0, artHelpers.hslRgb(coatH, 30, 16));
  ballGrad.addColorStop(1, furTorso);
  ctx.fillStyle = ballGrad;
  ctx.beginPath(); ctx.ellipse(0, -R * 0.9, R * 1.05 * breathe, R * 0.95, 0.2, 0, Math.PI * 2); ctx.fill();
  // tail wrapped around the ball
  ctx.strokeStyle = furTorso; ctx.lineCap = 'round'; ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.arc(0, -R * 0.9, R * 1.02, 0.4, 2.6); ctx.stroke();
  // tucked head: just the crown + closed eye line
  ctx.fillStyle = furHead;
  ctx.beginPath(); ctx.arc(R * 0.42, -R * 1.15, R * 0.52, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1c1410'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(R * 0.30, -R * 1.18); ctx.lineTo(R * 0.62, -R * 1.14); ctx.stroke();
  // folded limbs: short nubs
  ctx.strokeStyle = furTorso; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-R * 0.3, -R * 0.35); ctx.quadraticCurveTo(-R * 0.7, -R * 0.5, -R * 0.5, -R * 0.9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(R * 0.5, -R * 0.4); ctx.quadraticCurveTo(R * 0.9, -R * 0.55, R * 0.65, -R * 0.95); ctx.stroke();
  drawCoatPattern(ctx, d, id, R * 1.05, R * 0.95, `hsl(${coatH}, 30%, 15%)`, furPale, screenH);
}

// --- M2: INSPECT VIEW ----------------------------------------------------------
// The WORLD VIEW is the pure scene (no text, ever). The INSPECT VIEW is the
// same scene with the instruments on: a data overlay for the selected
// creature and cell. Two views, one world — the split Joshua asked for.
//
// renderInspectView(ctx, mw, view, opts)
//   opts: { creature, inspect: { cx, cy } (cell), tick, extra lines[] }
//   The overlay is drawn in canvas space (top-left panel + cell highlight).
export function renderInspectView(ctx, mw, view, opts = {}) {
  // The scene first — identical to the world view.
  const { scale, ox, oy, qx, qy } = renderWorldView(ctx, mw, view, opts);
  const W = ctx.w, H = ctx.h;
  // overlays use the quantized paint origin (anti-shimmer): the cell
  // highlight lands exactly on the snapped paint.
  const px = (wx) => ox + (wx - qx) * scale;
  const py = (wy) => oy + (wy - qy) * scale;

  // Cell highlight.
  if (opts.inspect) {
    const { cx, cy } = opts.inspect;
    const g = mw.grid;
    if (cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows) {
      const s = 10 * scale + 1;
      const rx = px(cx * 10), ry = py(cy * 10), lw = 2.5;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 240, 200, 0.9)';
      // outline via 4 bars (the SvgCtx shim has no strokeRect)
      ctx.fillRect(rx, ry, s, lw);
      ctx.fillRect(rx, ry + s - lw, s, lw);
      ctx.fillRect(rx, ry, lw, s);
      ctx.fillRect(rx + s - lw, ry, lw, s);
      ctx.restore();
    }
  }

  // Data panel — top-left, translucent dark, monospace-ish (canvas font).
  const c = opts.creature;
  const lines = [];
  lines.push(`tick ${mw.tick || 0}`);
  if (c) {
    const chem = c.chem || {};
    lines.push(`action: ${opts.actionName || '—'}`);
    lines.push(`hunger ${(1 - (chem.bloodSugar ?? 0.75)).toFixed(2)}  energy ${(chem.energy ?? 0.9).toFixed(2)}`);
    lines.push(`minerals ${(c.minerals ?? 0.6).toFixed(2)}  reward ${(c.lastReward ?? 0).toFixed(3)}`);
    lines.push(`body ${(c.body ? c.body.heightPx.toFixed(0) : '?')}px  grasp x${c.body ? c.body.graspPairs : '?'}`);
    lines.push(`carried ${c.carried ? c.carried.material : '—'}  piled ${c.piled || 0}`);
    if (c.body && c.body.marks.length) lines.push(`marks: ${c.body.marks.length}`);
  }
  if (opts.inspect) {
    const g = mw.grid;
    const i = opts.inspect.cy * g.cols + opts.inspect.cx;
    const names = ['AIR', 'SOIL', 'SAND', 'CLAY', 'ROCK', 'WOOD', 'DEADWOOD', 'LEAF', 'WATER', 'BEDROCK'];
    lines.push(`cell: ${names[g.mat[i]] || '?'}${g.dug[i] ? ' (dug)' : ''}${g.food && g.food[i] > 0 ? ' food:' + g.food[i].toFixed(0) : ''}`);
  }
  if (opts.extra) for (const l of opts.extra) lines.push(l);

  ctx.save();
  ctx.font = `${Math.max(11, H * 0.022)}px monospace`;
  const pad = 10, lh = Math.max(15, H * 0.03);
  // The HTML title badge floats over the canvas top-left; the page passes
  // panelTop (canvas px) so this panel starts below it and never clips.
  const padTop = opts.panelTop != null ? opts.panelTop : pad;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.fillStyle = 'rgba(12, 14, 18, 0.72)';
  ctx.fillRect(pad, padTop, tw + 20, lines.length * lh + 14);
  ctx.fillStyle = 'rgba(235, 240, 235, 0.95)';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, pad + 10, padTop + 8 + i * lh));
  ctx.restore();

  return { scale, ox, oy };
}

// ============================================================================
// ROUND 3 (2026-10-04) — palette-first renderer, real lightmap, parallax
// depth, spring-joint creatures, density-field detail, ambient juice.
//
// Research: game-world-beauty-research-20261004-0425/report.md
// Takeaways implemented:
//  #1 palette-first: R3PAL — one authored palette for the meadow/forest
//     (the Hollow Knight quality-bar biome), 5-stop hue-shifted ramps per
//     material. Darks shift hue and gain saturation; lights shift toward the
//     light hue. Saturation budget: backgrounds muted, actors (flowers,
//     fire, creatures) saturated. Day/night = authored RGB ambient variants
//     interpolated by sun elevation (temperature + value shifts, via the
//     lightmap), never a flat darkness multiply.
//  #5 real lightmap: Terraria-style coarse RGB multiply grid over the scene,
//     light bleeding into solid ground (blurred shadow grid), point lights
//     (fire, fireflies), ambient floor so night never goes pure black.
//  #4 parallax: 4 layers with atmospheric perspective baked in (deeper =
//     cooler, desaturated, lower contrast, softer) + fog/haze color keyframed
//     by time of day (#6).
//  #7 spring-joint creatures: render-layer spring secondary motion — root
//     lag + lean + squash/stretch, tail-curl lag, head-pitch lag. The pose
//     still comes from portraitFor (live sim state), so AI decisions visibly
//     become weighted motion. Full per-joint verlet would need rewriting the
//     IK bodies; this is the honest render-layer approximation.
//  #3 detail as density fields: grass tufts / pebbles / flowers / mushrooms /
//     ferns driven by low-frequency noise density fields masked to surface
//     cells, clump clustering, tag rules (shade plants under trees). Never
//     uniform scatter; seeded per-cell variation, never identical adjacent.
//  #8 archetype + variation: one blade/tuft/flower/mushroom archetype each,
//     parameterized by hash (proportion, lean, hue-within-palette).
//  #10 ambient juice: grass sway, dust motes, falling leaves, rain ripples,
//     fireflies, spawn scale-in over ~200ms, persistent fallen petals.
//  #12 silhouette-first creatures: directional rim light from the sun/moon
//     side + blob contact shadows; the round-2 primate tanglekin art is kept.
// The legacy SVG path (paintTerrainLegacy) is FROZEN for test stability —
// round 3 lives in the browser paint path only. Sim untouched: same seed →
// same verify.mjs digest. Determinism: zero Date.now, zero unseeded random;
// every decorative choice is a stateless h3/hash of (seed, x, y, purpose).
// ============================================================================

// --- the authored meadow/forest palette --------------------------------------
// One 5-stop [h, s, l] ramp per material, dark → light. Hue-shifts are
// authored, not computed: darks drift cooler and hold saturation, lights
// drift toward the sun. Hex equivalents (reference daylight):
//   grass  #2f5426 → #7a9c52 · soil #3d2716 → #a37c4e · bark #4a2413 → #b07a48
//   leaf   #2a521f → #8cba66 · water #0e3a66 → #6aa3d8 · rock #2a2f36 → #8b9098
// (legibility rewrite 2026-10-04: soil lifted and warmed — the old umber
// ramp rendered as flat mud under the lightmap; bark pushed red + saturated
// so trunks separate from soil at a glance; rock cooled and lifted so stone
// reads as stone, never as brown; day/night variants multiply on top, so
// they are unaffected)
export const R3PAL = {
  grass:    [[98,52,13],[102,50,22],[106,48,30],[100,44,38],[92,40,46]],
  dryGrass: [[64,46,16],[58,50,26],[52,52,36],[48,48,46],[46,42,56]],
  soil:     [[24,50,16],[26,48,24],[28,46,32],[30,42,40],[32,38,48]],
  sand:     [[38,52,26],[42,54,36],[46,54,46],[48,50,56],[50,46,66]],
  clay:     [[10,56,18],[13,54,26],[16,52,34],[18,48,42],[20,44,50]],
  rock:     [[215,12,16],[216,10,26],[217,9,36],[218,8,46],[219,8,56]],
  bark:     [[16,58,14],[18,56,22],[20,54,30],[23,52,38],[26,50,46]],
  deadwood: [[28,16,16],[30,14,24],[32,12,32],[34,10,40],[36,10,48]],
  leaf:     [[102,58,12],[107,56,20],[110,54,28],[104,50,36],[96,46,44]],
  water:    [[210,62,12],[208,60,22],[206,56,32],[203,50,42],[200,44,52]],
  bedrock:  [[222,14,6],[223,12,10],[224,10,14],[225,10,18],[226,10,22]],
  skyshadow:[[18,34,7],[20,32,11],[22,30,15],[24,28,19],[26,26,23]],
  // saturated accents — the saturation budget spent on small things
  petal:    [[48,88,66],[4,80,64],[318,50,70],[210,36,86]],
};

// short-path hue lerp (public for tests)
export function r3HueLerp(a, b, t) {
  let d = b - a;
  if (d > 180) d -= 360; else if (d < -180) d += 360;
  return (a + d * t + 360) % 360;
}

// sample a 5-stop ramp at k ∈ [0,1] (dark → light) → [h, s, l]
export function r3SampleRamp(stops, k) {
  const kk = clamp01(k) * (stops.length - 1);
  const i0 = Math.min(stops.length - 2, Math.floor(kk)), f = kk - i0;
  const a = stops[i0], b = stops[i0 + 1];
  return [r3HueLerp(a[0], b[0], f), a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// ramp → [r, g, b] 0-255
export function r3RampRGB(key, k) {
  const c = r3SampleRamp(R3PAL[key], k);
  return hsl2rgb(c[0], c[1], c[2]);
}

// grass color at meadow vigor (1 = lush, 0 = dry gold) — the region's
// personality, renderer-side only (worldgen layout untouched)
export function r3GrassRGB(vigor, k) {
  const g = r3SampleRamp(R3PAL.grass, k), d = r3SampleRamp(R3PAL.dryGrass, k);
  const t = clamp01(1 - vigor);
  return hsl2rgb(r3HueLerp(g[0], d[0], t), g[1] + (d[1] - g[1]) * t, g[2] + (d[2] - g[2]) * t);
}

// --- the authored day/night ambient (takeaway #1: temperature + value) --------
// The lightmap's RGB multiply per sun elevation: warm bright day, amber
// dusk, cool blue night with a floor (Terraria negLight analog) so night
// never goes pure black. This is the terrain's day/night palette variant.
export function r3LightAmbient(e) {
  const day = [1.05, 1.00, 0.93], dusk = [1.12, 0.80, 0.58], night = [0.17, 0.23, 0.37];
  const dk = clamp01((e + 0.10) / 0.45);              // 0 night … 1 day
  const ek = Math.max(0, 1 - Math.abs(e) / 0.42);     // warmth near the horizon
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let c = mix3(night, day, dk);
  if (e > -0.12) {
    const w = ek * clamp01((e + 0.12) * 4);
    c = mix3(c, dusk, Math.min(1, w * 1.4));
  }
  return c;
}

// --- density fields (takeaway #3: rules, not scatter) -------------------------
// Meadow vigor: large-scale regions of lush ↔ dry — personality per region.
export function r3Vigor(seed, wx) {
  return vnoise1(seed, wx * 0.0016, 601) * 0.65 + vnoise1(seed, wx * 0.006 + 40, 602) * 0.35;
}
// Grass-tuft clumping field: 0 … 1, clustered by smoothstepped noise.
export function r3TuftDensity(seed, wx) {
  const n = vnoise1(seed, wx * 0.008, 603) * 0.6 + vnoise1(seed, wx * 0.027 + 17, 604) * 0.4;
  return sstep(0.42, 0.72, n);
}

// --- fireflies: visual-only point lights (renderer state, never sim) ----------
// Continuous drift (no popping): pure function of (seed, i, tick).
export function r3Firefly(seed, i, tick, W, horizonY) {
  const x = (h3(seed, i, 901) * W + tick * 0.35 * (0.3 + h3(seed, i, 905))) % W;
  const y = horizonY * (0.55 + h3(seed, i, 902) * 0.40) + Math.sin(tick * 0.05 + i * 2.1) * 14;
  const blink = Math.max(0, Math.sin(tick * 0.11 + i * 2.4));
  return { x: x < 0 ? x + W : x, y, blink };
}

// bark color from the authored ramp (replaces the ad-hoc barkRGB in the
// round-3 path; the legacy path keeps barkRGB byte-identical)
function barkRGBr3(seed, gid, dead, k) {
  const tone = h3(seed, gid || 1, 555);
  return r3RampRGB(dead ? 'deadwood' : 'bark', clamp01(k + (tone - 0.5) * 0.25));
}

// fog/haze color for the current sky: the horizon stop, i.e. fog IS a
// palette entry, keyframed by time of day (takeaway #6)
function r3FogRGB(pal) {
  return hsl2rgb(pal[2][0], pal[2][1], Math.min(88, pal[2][2] + 6));
}
function r3FogRGBA(pal, a) {
  const c = r3FogRGB(pal);
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

// --- parallax, round 3: 4 layers, atmospheric perspective baked in ------------
// Deeper = cooler, desaturated, lower contrast, softer edges (takeaway #4).
// Each layer carries authored day + night bases; the fog color hazes them by
// depth. Parallax factors 0.10 → 0.60.
const R3_LAYERS = [
  { f: 0.10, salt: 71, ns: 0.0016, n2: 0.006, hBase: 0.030, hAmp: 0.30, haze: 0.62,
    day: [[150,18,62],[168,16,72]], night: [[232,20,10],[230,18,16]] },
  { f: 0.22, salt: 72, ns: 0.0040, n2: 0.014, hBase: 0.012, hAmp: 0.20, haze: 0.45,
    day: [[110,20,44],[124,18,56]], night: [[232,22,8],[230,20,13]] },
  { f: 0.40, salt: 73, ns: 0.0090, n2: 0.030, hBase: 0.004, hAmp: 0.12, haze: 0.28,
    day: [[105,26,32],[112,24,42]], night: [[230,24,7],[230,20,11]] },
  { f: 0.60, salt: 74, ns: 0.0200, n2: 0.060, hBase: 0.000, hAmp: 0.06, haze: 0.12,
    day: [[100,30,24],[106,28,33]], night: [[228,26,6],[228,22,10]], trees: true },
];

function drawParallaxR3(pctx, mw, view, G, W, H, horizonY, pal, dayK) {
  const seed = mw.seed;
  const fog = r3FogRGB(pal);
  const clipH = Math.max(0, horizonY + 2);
  if (clipH <= 0) return;
  pctx.save();
  pctx.beginPath();
  pctx.rect(0, 0, W, clipH);
  pctx.clip();
  const hazeMix = (c, k) => { // pull a color toward the fog by the layer's depth
    const [r, g, b] = hsl2rgb(c[0], c[1], c[2]);
    return [r + (fog[0] - r) * k, g + (fog[1] - g) * k, b + (fog[2] - b) * k];
  };
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  for (const L of R3_LAYERS) {
    const dn = (d, n) => [r3HueLerp(n[0], d[0], dayK), n[1] + (d[1] - n[1]) * dayK, n[2] + (d[2] - n[2]) * dayK];
    const top = hazeMix(dn(L.day[0], L.night[0]), Math.min(0.9, L.haze + 0.15));
    const bot = hazeMix(dn(L.day[1], L.night[1]), L.haze);
    const grad = pctx.createLinearGradient(0, horizonY - H * (L.hBase + L.hAmp), 0, horizonY + 2);
    grad.addColorStop(0, css(top));
    grad.addColorStop(1, css(bot));
    pctx.fillStyle = grad;
    // the ridge silhouette, in layer space
    const ridge = [];
    const step = 5;
    for (let sx = -10; sx <= W + 10; sx += step) {
      const lx = view.x * L.f + (sx - G.ox) / G.scale;
      const n = vnoise1(seed, lx * L.ns, L.salt) * 0.7 + vnoise1(seed, lx * L.n2, L.salt + 1) * 0.3;
      ridge.push([sx, horizonY - (L.hBase + Math.pow(n, 1.3) * L.hAmp) * H]);
    }
    pctx.beginPath();
    pctx.moveTo(ridge[0][0], ridge[0][1]);
    for (let i = 1; i < ridge.length; i++) pctx.lineTo(ridge[i][0], ridge[i][1]);
    pctx.lineTo(W + 10, horizonY + 2);
    pctx.lineTo(-10, horizonY + 2);
    pctx.closePath();
    pctx.fill();
    if (L.trees) {
      // background wall: soft canopy masses along the ridge — the near
      // hills read as forest, not a bare ridge
      for (let i = 0; i < ridge.length; i += 2) {
        const [rx, ry] = ridge[i];
        if (h3(seed, i, 721) < 0.35) continue;
        const pr = (10 + h3(seed, i, 722) * 26) * (W / 1440 + 0.5);
        const kk = 0.25 + h3(seed, i, 723) * 0.3;
        const leafC = r3SampleRamp(R3PAL.leaf, kk);
        const lc = hazeMix([leafC[0], leafC[1] * 0.7, leafC[2] * 0.8], L.haze + 0.1);
        const pg = pctx.createRadialGradient(rx, ry - pr * 0.3, 0, rx, ry - pr * 0.3, pr);
        pg.addColorStop(0, `rgba(${lc[0] | 0},${lc[1] | 0},${lc[2] | 0},0.85)`);
        pg.addColorStop(1, `rgba(${lc[0] | 0},${lc[1] | 0},${lc[2] | 0},0)`);
        pctx.fillStyle = pg;
        pctx.beginPath(); pctx.arc(rx, ry - pr * 0.3, pr, 0, Math.PI * 2); pctx.fill();
      }
    }
  }
  pctx.restore();
}

// --- sky canvas: gradient, stars, cirrus, sun/moon, clouds, parallax, haze ---
function paintSkyCache(pctx, mw, view, G, W, H, horizonY, pal, e, dayK) {
  const { cols, seed } = mw;
  const tick = mw.tick || 0;

  const skyGrad = pctx.createLinearGradient(0, 0, 0, Math.max(1, horizonY));
  for (const [o, c] of [[0, pal[0]], [0.55, pal[1]], [1, pal[2]]]) skyGrad.addColorStop(o, hslRgb(c[0], c[1], c[2]));
  pctx.fillStyle = skyGrad;
  pctx.fillRect(0, 0, W, H);

  // stars: the night's own depth
  const nightK = 1 - dayK;
  if (nightK > 0.25) {
    for (let i = 0; i < 110; i++) {
      const sx = h3(seed, i, 701) * W, sy = h3(seed, i, 702) * horizonY * 0.85;
      const a = (nightK - 0.25) * 0.9 * (0.5 + 0.5 * h3(seed, i, 703));
      pctx.fillStyle = `rgba(226, 232, 250, ${a.toFixed(3)})`;
      pctx.beginPath(); pctx.arc(sx, sy, 0.8 + h3(seed, i, 704) * 1.4, 0, Math.PI * 2); pctx.fill();
    }
  }

  // cirrus: high thin wisps, drifting slow — feathery clusters, never scratches
  for (let i = 0; i < 9; i++) {
    const drift = (((tick * 0.35 + h3(seed, i, 711) * 2400) % (W + 800)) + W + 800) % (W + 800) - 400;
    const cy = H * (0.04 + h3(seed, i, 712) * 0.22);
    const cw2 = W * (0.05 + h3(seed, i, 713) * 0.07);
    const baseA = 0.05 + 0.06 * h3(seed, i, 714); // grade: was 0.025+0.035h — invisible
    for (let w2 = 0; w2 < 3; w2++) {
      const ox = (h3(seed, i * 3 + w2, 715) - 0.5) * cw2 * 1.2;
      const oy = (h3(seed, i * 3 + w2, 716) - 0.5) * cw2 * 0.12;
      const ww = cw2 * (0.55 + h3(seed, i * 3 + w2, 717) * 0.45);
      pctx.fillStyle = `rgba(244, 247, 252, ${(baseA * (1 - w2 * 0.25)).toFixed(3)})`;
      pctx.beginPath();
      pctx.ellipse(drift + ox, cy + oy, ww, ww * 0.16, -0.06 + (w2 - 1) * 0.05, 0, Math.PI * 2);
      pctx.fill();
    }
  }

  // sun glow / moon
  if (e > -0.08) {
    const t = timeOfDay(mw);
    const sx = W * (0.12 + 0.76 * t), sy = H * (0.72 - e * 0.62);
    const sr = Math.min(W, H) * 0.30;
    const sg = pctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    const warm = Math.max(0, 1 - Math.abs(e) * 2.2);
    const sa = (0.10 + 0.30 * warm) * clamp01((e + 0.08) * 3);
    sg.addColorStop(0, `rgba(255, ${Math.round(244 - warm * 40)}, ${Math.round(220 - warm * 90)}, ${sa.toFixed(3)})`);
    sg.addColorStop(1, 'rgba(255, 240, 210, 0)');
    pctx.fillStyle = sg;
    pctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  } else {
    const t = timeOfDay(mw);
    const mang = (t - 0.75) * Math.PI * 2;
    const mx = W * 0.5 - Math.cos(mang) * W * 0.38;
    const my = H * 0.60 - Math.sin(mang) * H * 0.48;
    const mr = Math.min(W, H) * 0.032;
    const mg = pctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.5);
    mg.addColorStop(0, 'rgba(208, 218, 244, 0.12)');
    mg.addColorStop(1, 'rgba(208, 218, 244, 0)');
    pctx.fillStyle = mg;
    pctx.fillRect(mx - mr * 3.5, my - mr * 3.5, mr * 7, mr * 7);
    pctx.fillStyle = 'rgba(233, 239, 251, 0.95)';
    pctx.beginPath(); pctx.arc(mx, my, mr, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = 'rgba(160, 172, 205, 0.22)';
    pctx.beginPath(); pctx.arc(mx - mr * 0.35, my - mr * 0.2, mr * 0.85, 0, Math.PI * 2); pctx.fill();
  }

  // clouds: billow puffs from the live weather columns
  if (mw.sky && mw.sky.cols) {
    const worldW = cols * CELL_PX;
    for (let i = 0; i < mw.sky.cols.length; i++) {
      const c = mw.sky.cols[i];
      if (c.cloud < 0.22) continue;
      const drift = ((tick * c.windU * 0.06 + h3(seed, i, 31) * 600) % (worldW + 900) + worldW + 900) % (worldW + 900) - 450;
      const wx = i * SKY_COL_W + drift * 0.3;
      const sx = G.px(wx);
      if (sx < -500 || sx > W + 500) continue;
      const sysK = 0.25 + 0.75 * sstep(0.32, 0.72, vnoise1(seed, i * 0.33, 33));
      const sy = H * (0.05 + h3(seed, i, 32) * 0.30);
      const cr = G.cellPx * (2.0 + c.cloud * 4.0);
      const dark = clamp01(1 - (e + 0.25) / 0.6);
      const storm = clamp01((c.cloud - 0.5) / 0.4);
      // night clouds stay whisper-thin — dark smears kill the sky
      const nightDim = 0.25 + 0.75 * dayK;
      const baseA = (0.13 + c.cloud * 0.26) * sysK * nightDim; // grade: was 0.10+0.22c
      const nPuff = 4 + Math.round(c.cloud * 5);
      for (let k = 0; k < nPuff; k++) {
        const kk = i * 17 + k;
        const px2 = sx + (h3(seed, kk, 34) - 0.5) * 2.4 * cr;
        const py2 = sy + (h3(seed, kk, 35) - 0.5) * 1.1 * cr;
        const pr = cr * (0.45 + h3(seed, kk, 36) * 0.75);
        const tr = Math.round(255 - dark * 70 - storm * 30);
        const tg = Math.round(252 - dark * 70 - storm * 28);
        const tb = Math.round(248 - dark * 60 - storm * 22);
        const pa = (baseA * (0.75 + 0.25 * h3(seed, kk, 37))).toFixed(3);
        // elliptical puffs (natural stratus stretch), soft radial fade —
        // never soap-bubbles: edges always dissolve, never ring
        pctx.save();
        pctx.translate(px2, py2);
        pctx.scale(1.7, 0.62);
        const pg = pctx.createRadialGradient(0, 0, 0, 0, 0, pr);
        pg.addColorStop(0, `rgba(${tr},${tg},${tb},${pa})`);
        pg.addColorStop(1, `rgba(${tr},${tg},${tb},0)`);
        pctx.fillStyle = pg;
        pctx.beginPath(); pctx.arc(0, 0, pr, 0, Math.PI * 2); pctx.fill();
        pctx.restore();
      }
    }
  }

  // parallax depth: 4 layers, atmospheric perspective baked in
  drawParallaxR3(pctx, mw, view, G, W, H, horizonY, pal, dayK);

  // haze band: fog is a color tool — it separates the world from the sky
  const hz = pctx.createLinearGradient(0, horizonY - H * 0.09, 0, horizonY + H * 0.02);
  hz.addColorStop(0, r3FogRGBA(pal, 0));
  hz.addColorStop(0.75, r3FogRGBA(pal, 0.35));
  hz.addColorStop(1, r3FogRGBA(pal, 0));
  pctx.fillStyle = hz;
  pctx.fillRect(0, Math.max(0, horizonY - H * 0.09), W, H * 0.11);
}

// --- unlit albedo: one material, one hue-shifted ramp (takeaway #1) ----------
// Reference daylight; the lightmap carries ALL diurnal/occlusion grading.
function cellRGBr3(m, cx, cy, i, grid, mw) {
  const { seed, surf } = mw;
  const moist = grid.moist[i];
  const g = (salt) => vnoise2(seed, cx * 0.33, cy * 0.33, salt);
  switch (m) {
    case MAT.SOIL: {
      const depth = Math.max(0, cy - (surf[cx] | 0));
      const k = 0.55 + (g(11) - 0.5) * 0.28 + (h3(seed, cx >> 2, cy >> 1) - 0.5) * 0.14
        - moist * 0.12 - Math.min(depth, 26) * 0.012;
      return r3RampRGB('soil', k);
    }
    case MAT.SAND: return r3RampRGB('sand', 0.60 + (g(12) - 0.5) * 0.30 - moist * 0.08);
    case MAT.CLAY: return r3RampRGB('clay', 0.55 + (g(13) - 0.5) * 0.30 - moist * 0.06);
    case MAT.ROCK: {
      const band = h3(seed, cy >> 2, 7);
      return r3RampRGB('rock', 0.50 + (band - 0.5) * 0.35 + (g(14) - 0.5) * 0.20);
    }
    case MAT.LEAF: return r3RampRGB('leaf', 0.45 + (g(15) - 0.5) * 0.40);
    case MAT.BEDROCK: return r3RampRGB('bedrock', 0.40 + h3(seed, cx, cy) * 0.30);
    default: { // MAT.WATER, or AIR holding water: blues graded by depth
      const depth = m === MAT.AIR ? clamp01(grid.water[i]) : 0.65 + 0.3 * h3(seed, cx, cy);
      return r3RampRGB('water', 0.75 - depth * 0.55 + (h3(seed, cx, cy) - 0.5) * 0.08);
    }
  }
}

// --- detail stamps: density-field dressing (takeaway #3) ----------------------
// Surface-only, deterministic, clumped, tag-ruled. One archetype each with
// seeded proportion/lean/hue variation — never the identical stamp adjacent.
function drawDetailR3(pctx, mw, G, seed, surfYat, gw) {
  const { grid, cols, rows, surf } = mw;
  const { px, py, cellPx, cx0 } = G;
  for (let gx = 0; gx < gw; gx++) {
    const cx = cx0 + gx;
    if (cx < 0 || cx >= cols) continue;
    const sy = surf[cx] | 0;
    if (sy < 1 || sy >= rows) continue;
    const wx = (cx + 0.5) * CELL_PX;
    const sx = px(wx), syy = py((sy + 0.5) * CELL_PX);
    if (sx < -40 || sx > pctx.canvas.width + 40) continue;
    const vigor = r3Vigor(seed, wx);
    const tuft = r3TuftDensity(seed, wx);
    const h = (s) => h3(seed, cx, s);
    // shade tag: canopy above → shade plants; open → sun plants
    let canopy = false;
    for (let k = 1; k <= 25 && !canopy; k++) {
      const yy = sy - k;
      if (yy < 0) break;
      if (grid.mat[yy * cols + cx] === MAT.LEAF) canopy = true;
    }
    const gcol = (k2, a) => {
      const c = r3GrassRGB(vigor, k2);
      return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(2)})`;
    };
    // grass tuft root-mass (the blades sway per-frame from dyn.blades)
    if (h(821) < tuft * 0.92) {
      const n = 3 + Math.floor(h(822) * 4);
      pctx.strokeStyle = gcol(0.30, 0.9);
      pctx.lineCap = 'round';
      pctx.lineWidth = Math.max(1.2, cellPx * 0.10);
      for (let b = 0; b < n; b++) {
        const bx = sx + (h(823 + b) - 0.5) * cellPx * 1.1;
        const lean = (h(830 + b) - 0.5) * cellPx * 0.5;
        pctx.beginPath();
        pctx.moveTo(bx, syy + 1);
        pctx.quadraticCurveTo(bx + lean * 0.4, syy - cellPx * 0.35, bx + lean, syy - cellPx * (0.45 + h(840 + b) * 0.3));
        pctx.stroke();
      }
    }
    // flowers: only in lush open patches (tag rule), saturated accents
    if (!canopy && tuft > 0.55 && h(824) < (tuft - 0.55) * 1.4) {
      const n = 1 + Math.floor(h(825) * 2);
      for (let b = 0; b < n; b++) {
        const fx = sx + (h(826 + b) - 0.5) * cellPx * 1.6;
        const fy = syy - cellPx * (0.25 + h(827 + b) * 0.35);
        const pc = R3PAL.petal[Math.floor(h(828 + b) * R3PAL.petal.length)];
        const pr2 = Math.max(1.4, cellPx * (0.14 + h(829 + b) * 0.10));
        pctx.strokeStyle = gcol(0.35, 0.9);
        pctx.lineWidth = Math.max(1, cellPx * 0.07);
        pctx.beginPath(); pctx.moveTo(fx, syy + 1); pctx.lineTo(fx, fy); pctx.stroke();
        pctx.fillStyle = `hsl(${pc[0]},${pc[1]}%,${pc[2]}%)`;
        for (let p = 0; p < 5; p++) {
          const a = p / 5 * Math.PI * 2 + h(831 + b) * 3;
          pctx.beginPath();
          pctx.ellipse(fx + Math.cos(a) * pr2, fy + Math.sin(a) * pr2, pr2 * 0.75, pr2 * 0.5, a, 0, Math.PI * 2);
          pctx.fill();
        }
        pctx.fillStyle = 'rgba(250, 240, 200, 0.95)';
        pctx.beginPath(); pctx.arc(fx, fy, pr2 * 0.55, 0, Math.PI * 2); pctx.fill();
      }
    }
    // pebbles: grey clumps on the surface
    if (h(832) < 0.30) {
      const n = 2 + Math.floor(h(833) * 3);
      for (let b = 0; b < n; b++) {
        const c = r3RampRGB('rock', 0.45 + h(834 + b) * 0.3);
        pctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.95)`;
        pctx.beginPath();
        pctx.ellipse(sx + (h(835 + b) - 0.5) * cellPx * 1.8, syy + cellPx * 0.28,
          cellPx * (0.10 + h(836 + b) * 0.14), cellPx * (0.07 + h(837 + b) * 0.09),
          h(838 + b) * 3, 0, Math.PI * 2);
        pctx.fill();
      }
    }
    // shade plants under trees (tag rule): mushrooms + ferns
    if (canopy && h(839) < 0.38) {
      const n = 1 + Math.floor(h(840) * 2);
      for (let b = 0; b < n; b++) {
        const mx = sx + (h(841 + b) - 0.5) * cellPx * 2.0;
        const mh = cellPx * (0.28 + h(842 + b) * 0.30);
        pctx.strokeStyle = 'rgba(232, 224, 200, 0.9)';
        pctx.lineWidth = Math.max(1, cellPx * 0.08);
        pctx.beginPath(); pctx.moveTo(mx, syy + 1); pctx.lineTo(mx, syy - mh); pctx.stroke();
        const cap = r3RampRGB('clay', 0.42 + h(843 + b) * 0.25);
        pctx.fillStyle = `rgba(${cap[0]},${cap[1]},${cap[2]},0.95)`;
        pctx.beginPath();
        pctx.ellipse(mx, syy - mh, cellPx * (0.16 + h(844 + b) * 0.12), cellPx * 0.11, 0, Math.PI, 0);
        pctx.fill();
      }
    }
    if (canopy && h(845) < 0.50) {
      const n = 2 + Math.floor(h(846) * 3);
      pctx.strokeStyle = gcol(0.28, 0.85);
      pctx.lineWidth = Math.max(1, cellPx * 0.07);
      pctx.lineCap = 'round';
      for (let b = 0; b < n; b++) {
        const fx = sx + (h(847 + b) - 0.5) * cellPx * 2.2;
        const fl = cellPx * (0.5 + h(848 + b) * 0.5);
        const la = -0.9 + h(849 + b) * 1.8;
        pctx.beginPath();
        pctx.moveTo(fx, syy + 1);
        pctx.quadraticCurveTo(fx + Math.sin(la) * fl * 0.5, syy - fl * 0.6, fx + Math.sin(la) * fl, syy - fl);
        pctx.stroke();
      }
    }
    // fallen petals: permanence — the space remembers (takeaway #10)
    if (canopy && h(850) < 0.60) {
      const n = 3 + Math.floor(h(851) * 5);
      for (let b = 0; b < n; b++) {
        const pc = R3PAL.petal[Math.floor(h(852 + b) * R3PAL.petal.length)];
        pctx.fillStyle = `hsla(${pc[0]},${pc[1] * 0.7}%,${pc[2]}%,0.5)`;
        pctx.beginPath();
        pctx.ellipse(sx + (h(853 + b) - 0.5) * cellPx * 3.4, syy + cellPx * (0.1 + h(854 + b) * 0.3),
          Math.max(1, cellPx * 0.06), Math.max(0.8, cellPx * 0.045), h(855 + b) * 3, 0, Math.PI * 2);
        pctx.fill();
      }
    }
  }
}

// --- world canvas: the material field at reference light ---------------------
function paintWorldCache(pctx, mw, view, G, W, H, pal, e, dayK) {
  const { grid, cols, rows, seed, surf } = mw;
  const { px, py, scale, cellPx, cx0, cx1, cy0, cy1 } = G;
  const tick = mw.tick || 0;
  const sky = floodSky(grid, cols, rows);
  const gw = cx1 - cx0 + 1, gh = cy1 - cy0 + 1;

  // smooth terrain body: topmost-solid per column → Gaussian → one body.
  // TWO surfaces: surfH (everything solid, wood included — legacy) and gndH
  // (ground only: wood/deadwood excluded). The old body trace used the
  // wood-inclusive surface, so the soil body grew a collar ~11 cells up
  // every trunk — each tree read as a brown stalagmite. The body, the grass
  // cap, and the blades all follow gndH now: earth is earth, trees stand on it.
  const surfH = new Float32Array(gw);
  const gndH = new Float32Array(gw);
  for (let gx = 0; gx < gw; gx++) {
    const cx = cx0 + gx;
    let y = cy1 + 1, gy = cy1 + 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      const i = cy * cols + cx, m = grid.mat[i];
      if (y > cy1 && (MAT_PROPS[m].solid || isWaterCell(m, grid, i))) y = cy;
      if (gy > cy1 && m !== MAT.WOOD && m !== MAT.DEADWOOD &&
          (MAT_PROPS[m].solid || isWaterCell(m, grid, i))) gy = cy;
      if (y <= cy1 && gy <= cy1) break;
    }
    surfH[gx] = y;
    gndH[gx] = gy;
  }
  for (let it = 0; it < 2; it++) {
    const s = surfH.slice(), g = gndH.slice();
    for (let gx = 1; gx < gw - 1; gx++) {
      surfH[gx] = s[gx - 1] * 0.25 + s[gx] * 0.5 + s[gx + 1] * 0.25;
      gndH[gx] = g[gx - 1] * 0.25 + g[gx] * 0.5 + g[gx + 1] * 0.25;
    }
  }
  const surfYat = (gx) => {
    const g0 = Math.max(0, Math.min(gw - 1, Math.floor(gx)));
    const g1 = Math.min(gw - 1, g0 + 1), f = Math.max(0, Math.min(1, gx - g0));
    return surfH[g0] * (1 - f) + surfH[g1] * f;
  };
  const gndYat = (gx) => {
    const g0 = Math.max(0, Math.min(gw - 1, Math.floor(gx)));
    const g1 = Math.min(gw - 1, g0 + 1), f = Math.max(0, Math.min(1, gx - g0));
    return gndH[g0] * (1 - f) + gndH[g1] * f;
  };
  const traceGround = () => {
    pctx.beginPath();
    const step = 0.25;
    let first = true;
    for (let gx = 0; gx <= gw - 1; gx += step) {
      const sx = px((cx0 + gx + 0.5) * CELL_PX), syy = py(gndYat(gx) * CELL_PX);
      if (first) { pctx.moveTo(sx, syy); first = false; }
      else pctx.lineTo(sx, syy);
    }
    pctx.lineTo(px((cx1 + 1) * CELL_PX), H + 4);
    pctx.lineTo(px(cx0 * CELL_PX), H + 4);
    pctx.closePath();
  };
  const contourStroke = () => { // the skyline alone, for the grass cap
    pctx.beginPath();
    const step = 0.5;
    let first = true;
    for (let gx = 0; gx <= gw - 1; gx += step) {
      const sx = px((cx0 + gx + 0.5) * CELL_PX), syy = py(gndYat(gx) * CELL_PX);
      if (first) { pctx.moveTo(sx, syy); first = false; }
      else pctx.lineTo(sx, syy);
    }
  };

  // earth body: soil ramp gradient, reference light — the lightmap grades it
  {
    const gy0 = Math.max(0, Math.min(H, py(gndYat(gw / 2) * CELL_PX)));
    const bg = pctx.createLinearGradient(0, gy0, 0, H);
    const cTop = r3RampRGB('soil', 0.66), cMid = r3RampRGB('soil', 0.44), cBot = r3RampRGB('soil', 0.26);
    bg.addColorStop(0, `rgb(${cTop[0]},${cTop[1]},${cTop[2]})`);
    bg.addColorStop(0.35, `rgb(${cMid[0]},${cMid[1]},${cMid[2]})`);
    bg.addColorStop(1, `rgb(${cBot[0]},${cBot[1]},${cBot[2]})`);
    traceGround();
    pctx.fillStyle = bg;
    pctx.fill();
  }

  // albedo buffer: unlit material color, 2px/cell, smoothed upscale
  const BS = 2;
  const bw = gw * BS, bh = gh * BS;
  const img = new ImageData(bw, bh);
  const data = img.data;
  const leaves = [], fires = [], waterTop = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * cols + cx;
      const m = grid.mat[i];
      const waterCell = isWaterCell(m, grid, i);
      let r, g2, b, alpha = 255;
      if (m === MAT.AIR && !waterCell && sky[i]) {
        // open sky — transparent (gradient shows through), seeded with sky
        // color so the smoothed edge can't fringe dark
        const f = clamp01((py(cy * CELL_PX) + cellPx / 2) / H);
        [r, g2, b] = hsl2rgb(...skyHSLAt(f, pal));
        alpha = 0;
      } else if (m === MAT.AIR && !waterCell) {
        if (sky[i]) {
          // shaft / burrow mouth: sky color; the shadow grid darkens it with
          // depth (light dying as it travels down)
          const f = clamp01((py(cy * CELL_PX) + cellPx / 2) / H);
          [r, g2, b] = hsl2rgb(...skyHSLAt(f, pal));
          r *= 0.85; g2 *= 0.85; b *= 0.85;
        } else {
          // sealed pocket: dark warm earth shadow, never sky
          [r, g2, b] = r3RampRGB('skyshadow', 0.30 + h3(seed, cx, cy) * 0.25);
        }
      } else if (m === MAT.WOOD || m === MAT.DEADWOOD) {
        // strands are drawn post-lightmap on the tree canvas; the buffer
        // leaves a bark-seeded hole (alpha 0 — the strand covers it).
        [r, g2, b] = barkRGBr3(seed, grid.grownId[i] || 1, m === MAT.DEADWOOD, 0.5);
        alpha = 0;
      } else {
        [r, g2, b] = cellRGBr3(m, cx, cy, i, grid, mw);
        // grass sward: the top cells of exposed soil/sand/clay read as
        // meadow, not mud. Patchy by noise, gold where the vigor runs dry,
        // kept off cliffs by the slope gate. Presentation only — grid.mat
        // is untouched; the sim still sees soil.
        if (m === MAT.SOIL || m === MAT.SAND || m === MAT.CLAY) {
          const gx = cx - cx0;
          const depth = cy - gndYat(gx);
          if (depth >= -0.5 && depth <= 4.0) {
            const slope = Math.abs(gndH[Math.min(gw - 1, gx + 1)] - gndH[Math.max(0, gx - 1)]) / 2;
            const aboveM = cy > 0 ? grid.mat[i - cols] : MAT.AIR;
            const exposed = cy === 0 || aboveM === MAT.AIR || aboveM === MAT.LEAF || isWaterCell(aboveM, grid, i - cols);
            if (slope <= 1.6 && exposed) {
              const wx = (cx + 0.5) * CELL_PX;
              const vigor = r3Vigor(seed, wx);
              const patch = vnoise2(seed, cx * 0.5, cy * 0.5, 640);
              const kk = (1 - clamp01(depth / 4)) * sstep(0.30, 0.58, patch) * (0.45 + 0.55 * vigor);
              if (kk > 0.02) {
                const gc = r3GrassRGB(vigor, 0.45 + (vnoise2(seed, cx * 0.33, cy * 0.33, 641) - 0.5) * 0.25);
                r += (gc[0] - r) * kk; g2 += (gc[1] - g2) * kk; b += (gc[2] - b) * kk;
              }
            }
          }
        }
      }
      const bx0 = (cx - cx0) * BS, by0 = (cy - cy0) * BS;
      const rr = Math.max(0, Math.min(255, r)) | 0, gg = Math.max(0, Math.min(255, g2)) | 0, bb = Math.max(0, Math.min(255, b)) | 0;
      for (let qy = 0; qy < BS; qy++) {
        for (let qx = 0; qx < BS; qx++) {
          const o = ((by0 + qy) * bw + bx0 + qx) * 4;
          data[o] = rr; data[o + 1] = gg; data[o + 2] = bb; data[o + 3] = alpha;
        }
      }
      const rx = px(cx * CELL_PX), ry = py(cy * CELL_PX);
      const s = cellPx + 0.6;
      if (m === MAT.LEAF) leaves.push({ x: rx, y: ry, s, cx, cy });
      if (grid.heat[i] > 0.5) fires.push({ x: rx + s / 2, y: ry + s / 2, s, heat: grid.heat[i], ph: h3(seed, cx, cy) });
      if (waterCell) {
        const above = cy > 0 ? grid.mat[i - cols] : MAT.AIR;
        if (!isWaterCell(above, grid, cy > 0 ? i - cols : -1)) waterTop.push({ x: rx, y: ry, s, cx });
      }
    }
  }
  const buf = document.createElement('canvas');
  buf.width = bw; buf.height = bh;
  buf.getContext('2d').putImageData(img, 0, 0);
  pctx.save();
  traceGround();
  pctx.clip();
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(buf, 0, 0, bw, bh, px(cx0 * CELL_PX), py(cy0 * CELL_PX), gw * cellPx, gh * cellPx);
  pctx.restore();

  // TREES (legibility rewrite): the tree canvas is painted here but
  // composited AFTER the lightmap multiply in paintTerrain, so trunks and
  // crowns keep authored colors while the ground keeps the moody light.
  // Diurnal grading is explicit via lumK/moonK from the ambient.
  const amb = r3LightAmbient(e);
  const lumK = clamp01((amb[0] + amb[1] + amb[2]) / 3 / 0.99);
  const moonK = clamp01(1 - lumK) * 0.5;
  const treeCv = document.createElement('canvas');
  treeCv.width = W; treeCv.height = H;
  const claimed = paintTrees(treeCv.getContext('2d'), mw, G, seed, lumK, moonK);

  // canopy: foliage as merged soft masses in authored leaf greens.
  // A seeded SUBSET of leaf cells paints larger overlapping puffs — one
  // mass per cluster, not a balloon per cell. Leaves claimed by a tree
  // crown (paintTrees, above) are skipped: the crown is the read.
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * cols + cx;
      if (grid.mat[i] !== MAT.LEAF) continue;
      if (claimed.has(cy * 100000 + cx)) continue;
      if (h3(seed, cx * 7 + 1, cy) > 0.55) continue; // subset → masses merge (grade: 0.45→0.55, fewer puffs, clearer silhouettes)
      const sx = px(cx * CELL_PX + CELL_PX / 2), syy = py(cy * CELL_PX + CELL_PX / 2);
      if (sx < -60 || sx > W + 60 || syy < -60 || syy > H + 60) continue;
      const pr = cellPx * (1.6 + h3(seed, cx, cy) * 1.4);
      const lc = r3SampleRamp(R3PAL.leaf, 0.30 + h3(seed, cx * 3 + 1, cy) * 0.45);
      const pg = pctx.createRadialGradient(sx, syy - pr * 0.25, 0, sx, syy, pr);
      pg.addColorStop(0, hsla(lc[0], lc[1], lc[2] + 7, 0.62));
      pg.addColorStop(0.6, hsla(lc[0], lc[1], lc[2], 0.42));
      pg.addColorStop(1, hsla(lc[0], lc[1], Math.max(0, lc[2] - 9), 0));
      pctx.fillStyle = pg;
      pctx.beginPath(); pctx.arc(sx, syy, pr, 0, Math.PI * 2); pctx.fill();
      // satellite puffs: internal texture so the mass isn't a flat blob
      for (let st = 0; st < 2; st++) {
        const ox = (h3(seed, cx * 13 + st, cy * 7) - 0.5) * pr * 1.1;
        const oy = (h3(seed, cx * 7, cy * 13 + st) - 0.5) * pr * 0.9 - pr * 0.15;
        const sr2 = pr * (0.42 + h3(seed, cx * 3 + st, cy * 11) * 0.25);
        const dl2 = r3SampleRamp(R3PAL.leaf, 0.22 + h3(seed, cx * 5 + st, cy * 3) * 0.25);
        const sg2 = pctx.createRadialGradient(sx + ox, syy + oy, 0, sx + ox, syy + oy, sr2);
        sg2.addColorStop(0, hsla(dl2[0], dl2[1], dl2[2] + 4, 0.5));
        sg2.addColorStop(1, hsla(dl2[0], dl2[1], dl2[2], 0));
        pctx.fillStyle = sg2;
        pctx.beginPath(); pctx.arc(sx + ox, syy + oy, sr2, 0, Math.PI * 2); pctx.fill();
      }
      // leaf clusters (grade 2026-10-04): small high-contrast dots inside the
      // mass — darker cores read as interior shadow, lighter dots as lit leaf
      // tips. First step toward real canopy structure, not the final word.
      for (let lf = 0; lf < 4; lf++) {
        const lx = sx + (h3(seed, cx * 17 + lf, cy * 5 + 1) - 0.5) * pr * 1.5;
        const ly = syy + (h3(seed, cx * 5 + 1, cy * 17 + lf) - 0.5) * pr * 1.2;
        const lr = pr * (0.16 + h3(seed, cx * 11 + lf, cy * 3) * 0.12);
        const dl3 = r3SampleRamp(R3PAL.leaf, 0.30 + h3(seed, cx * 3 + lf, cy + 2) * 0.45);
        const dl3l = Math.max(4, Math.min(90, dl3[2] + (lf % 2 === 0 ? -12 : 10)));
        const lg3 = pctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
        lg3.addColorStop(0, hsla(dl3[0], dl3[1], dl3l, 0.55));
        lg3.addColorStop(1, hsla(dl3[0], dl3[1], dl3l, 0));
        pctx.fillStyle = lg3;
        pctx.beginPath(); pctx.arc(lx, ly, lr, 0, Math.PI * 2); pctx.fill();
      }
    }
  }

  // grass cap: the meadow's fringe along the skyline (takeaways #2, #3).
  // Clipped to the ground body so no paint can spill into the sky. Two
  // strokes — a body and a lighter top edge — so it reads as grass, not tube.
  pctx.save();
  traceGround();
  pctx.clip();
  pctx.lineCap = 'round';
  for (let gx = 0; gx < gw; gx++) {
    const cx = cx0 + gx;
    if (cx < 0 || cx >= cols) continue;
    const wx = (cx + 0.5) * CELL_PX;
    const vigor = r3Vigor(seed, wx);
    const sx = px(wx), syy = py(gndYat(gx) * CELL_PX);
    const wdt = Math.max(2.5, cellPx * 0.80);
    let c = r3GrassRGB(vigor, 0.45);
    pctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.95)`;
    pctx.lineWidth = wdt;
    pctx.beginPath();
    pctx.moveTo(sx - cellPx * 0.55, syy + cellPx * 0.1);
    pctx.lineTo(sx + cellPx * 0.55, syy + cellPx * 0.1);
    pctx.stroke();
    c = r3GrassRGB(vigor, 0.62); // lit top edge
    pctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.9)`;
    pctx.lineWidth = Math.max(1.2, wdt * 0.38);
    pctx.beginPath();
    pctx.moveTo(sx - cellPx * 0.55, syy - wdt * 0.18);
    pctx.lineTo(sx + cellPx * 0.55, syy - wdt * 0.18);
    pctx.stroke();
  }
  pctx.restore();

  // blades: per-frame sway pass reads these (drawn per-frame, not cached)
  const blades = [];
  for (let gx = 0; gx < gw; gx++) {
    const cx = cx0 + gx;
    if (cx < 0 || cx >= cols) continue;
    const wx = (cx + 0.5) * CELL_PX;
    const vigor = r3Vigor(seed, wx);
    const dens = r3TuftDensity(seed, wx) * (0.35 + 0.65 * vigor);
    if (h3(seed, cx, 801) > dens) continue;
    const nB = 2 + Math.floor(h3(seed, cx, 802) * 3);
    const bx = px(wx), by = py(gndYat(gx) * CELL_PX);
    for (let b = 0; b < nB; b++) {
      const hh = h3(seed, cx * 5 + b, 803);
      blades.push({
        x: bx + (hh - 0.5) * cellPx * 0.9, y: by + 1,
        len: (5 + h3(seed, cx * 5 + b, 804) * 9) * (cellPx / 10),
        lean: (h3(seed, cx * 5 + b, 805) - 0.5) * 0.9,
        k: 0.5 + (h3(seed, cx * 5 + b, 806) - 0.5) * 0.35,
        vigor, phase: h3(seed, cx * 5 + b, 807) * 6.283,
      });
    }
  }

  // detail stamps: density-field dressing on the surface
  drawDetailR3(pctx, mw, G, seed, surfYat, gw);

  // --- shadow grid: coarse light-occlusion for the lightmap (takeaway #5) ----
  // Terraria-style: light bleeds into solid ground via the blur below;
  // leaves and wood count as occluders so canopies shade what is under them.
  // Terraria-style: light bleeds into solid ground via the blur below.
  // Occlusion is weighted: solid rock/soil blocks light, wood partly, leaves
  // only dapple — so canopies shade the ground beneath them instead of
  // turning the forest floor into a cave.
  const LCELL = R3_LCELL;
  const cw = Math.ceil(W / LCELL), ch = Math.ceil(H / LCELL);
  const shadow = new Float32Array(cw * ch), skyK = new Float32Array(cw * ch);
  const occWeight = (m) => {
    if (MAT_PROPS[m].solid) return 1;
    if (m === MAT.WOOD || m === MAT.DEADWOOD) return 0.6;
    if (m === MAT.LEAF) return 0.35;
    return 0;
  };
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const o = j * cw + i;
      const wx = view.x + ((i + 0.5) * LCELL - G.ox) / scale;
      const wy = view.y + ((j + 0.5) * LCELL - G.oy) / scale;
      const cx = Math.floor(wx / CELL_PX), cy = Math.floor(wy / CELL_PX);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) { shadow[o] = 1; skyK[o] = 1; continue; }
      const gi = cy * cols + cx, m = grid.mat[gi];
      let occ = 0;
      for (let k = 1; k <= 12; k++) {
        const yy = cy - k;
        if (yy < 0) break;
        occ += occWeight(grid.mat[yy * cols + cx]);
      }
      if (m === MAT.AIR && sky[gi]) {
        if (occ < 1) { shadow[o] = 1; skyK[o] = 1; }        // open sky: neutral
        else { shadow[o] = Math.max(0.33, 1 - 0.80 * occ / 12); skyK[o] = 0; } // shaft: graded
      } else {
        shadow[o] = Math.max(0.33, 1 - 0.80 * Math.min(1, occ / 12));
        skyK[o] = 0;
      }
    }
  }
  // box-blur ×2: light bleeds a few cells into solid ground
  for (let pass = 0; pass < 2; pass++) {
    const src = shadow.slice();
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ch) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= cw) continue;
            s += src[jj * cw + ii]; n++;
          }
        }
        shadow[j * cw + i] = s / n;
      }
    }
  }
  { // feather the sky transition once
    const src = skyK.slice();
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ch) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= cw) continue;
            s += src[jj * cw + ii]; n++;
          }
        }
        skyK[j * cw + i] = s / n;
      }
    }
  }

  // rain state for the ripple pass (from the sky columns on screen)
  let raining = false;
  if (mw.sky && mw.sky.cols) {
    const i0 = Math.max(0, Math.floor(G.vx / SKY_COL_W));
    const i1 = Math.min(mw.sky.cols.length - 1, Math.ceil((G.vx + G.vw) / SKY_COL_W));
    for (let i = i0; i <= i1; i++) if (mw.sky.cols[i].rain > 0.2) { raining = true; break; }
  }

  const midCx = Math.max(cx0, Math.min(cx1, Math.round((cx0 + cx1) / 2)));
  const horizonY = clamp01(py(((surf[midCx] | 0) + 1) * CELL_PX) / H) * H;
  return { leaves, fires, waterTop, sky, pal, sunE: e, blades, shadow, skyK, cw, ch, horizonY, raining, treeCanvas: treeCv };
}

// --- per-frame juice (takeaway #10: the world is never static) ----------------

// grass blades with per-instance phase sway — batched into 4 vigor buckets
// so hundreds of blades cost a handful of stroke calls. Graded by the
// frame's ambient (the blades are drawn per-frame, after the baked lightmap,
// so they carry the light explicitly — otherwise they'd glow at night).
function drawBlades(pctx, blades, tick, swayAmp, amb) {
  pctx.lineCap = 'round';
  pctx.lineWidth = 1.6;
  const buckets = [[], [], [], []];
  for (const b of blades) buckets[Math.min(3, (b.vigor * 4) | 0)].push(b);
  for (let bi = 0; bi < 4; bi++) {
    const bl = buckets[bi];
    if (!bl.length) continue;
    const c = r3GrassRGB((bi + 0.5) / 4, 0.55);
    const r = Math.min(255, c[0] * amb[0]) | 0, g = Math.min(255, c[1] * amb[1]) | 0, bb = Math.min(255, c[2] * amb[2]) | 0;
    pctx.strokeStyle = `rgba(${r},${g},${bb},0.95)`;
    pctx.beginPath();
    for (const b of bl) {
      const sway = Math.sin(tick * 0.09 + b.phase) * swayAmp;
      const tx = b.x + b.lean * b.len * 0.5 + sway, ty = b.y - b.len;
      pctx.moveTo(b.x, b.y);
      pctx.quadraticCurveTo(b.x + b.lean * b.len * 0.25 + sway * 0.4, b.y - b.len * 0.6, tx, ty);
    }
    pctx.stroke();
  }
}

// dust motes drifting through the air — one batched path per frame
function drawMotes(pctx, dyn, tick, W, H, seed) {
  const n = 34;
  const nightK = 1 - clamp01((dyn.sunE + 0.12) / 0.5);
  pctx.fillStyle = nightK > 0.5 ? 'rgba(200, 214, 240, 0.07)' : 'rgba(255, 246, 224, 0.07)';
  pctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (h3(seed, i, 861) * W + tick * 0.45 * (0.3 + h3(seed, i, 862))) % W;
    const y = h3(seed, i, 863) * (dyn.horizonY * 0.9 + 40) + Math.sin(tick * 0.02 + i * 1.7) * 9;
    const r = 0.8 + h3(seed, i, 865) * 1.3;
    const xx = x < 0 ? x + W : x;
    pctx.moveTo(xx + r, y);
    pctx.arc(xx, y, r, 0, Math.PI * 2);
  }
  pctx.fill();
}

// leaves detach occasionally and flutter down — seeded per tick window
function drawFallingLeaves(pctx, dyn, tick, seed, amb) {
  if (!dyn.leaves.length) return;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const L = dyn.leaves[Math.floor(h3(seed, i, 871) * dyn.leaves.length) % dyn.leaves.length];
    const lt = (tick * 0.9 + h3(seed, i, 872) * 260) % 260;
    if (lt > 120) continue; // only some windows have a falling leaf
    const k = lt / 120;
    const x = L.x + L.s / 2 + Math.sin(lt * 0.09 + i * 2.2) * 22 + lt * 0.25;
    const y = L.y + L.s / 2 + lt * 1.15;
    const lc = r3SampleRamp(R3PAL.leaf, 0.45 + h3(seed, i, 873) * 0.3);
    const c = hsl2rgb(lc[0], lc[1], lc[2]);
    pctx.fillStyle = `rgba(${(c[0] * amb[0]) | 0},${(c[1] * amb[1]) | 0},${(c[2] * amb[2]) | 0},${(0.85 * (1 - k)).toFixed(3)})`;
    pctx.save();
    pctx.translate(x, y);
    pctx.rotate(lt * 0.06 + i);
    pctx.beginPath(); pctx.ellipse(0, 0, L.s * 0.28, L.s * 0.18, 0, 0, Math.PI * 2); pctx.fill();
    pctx.restore();
  }
}

// firefly dots (their light is stamped into the lightmap below)
function drawFireflyDots(pctx, dyn, tick, W, seed) {
  if (dyn.sunE > 0.05) return;
  const nightK = clamp01(1 - (dyn.sunE + 0.12) / 0.5);
  for (let i = 0; i < 12; i++) {
    const f = r3Firefly(seed, i, tick, W, dyn.horizonY);
    if (f.blink < 0.15) continue;
    const a = f.blink * 0.75 * nightK;
    const g = pctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 7);
    g.addColorStop(0, `rgba(190, 255, 150, ${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(190, 255, 150, 0)');
    pctx.fillStyle = g;
    pctx.beginPath(); pctx.arc(f.x, f.y, 7, 0, Math.PI * 2); pctx.fill();
  }
}

// water ripples when it rains (takeaway #10: weather as a visual state)
function drawRipples(pctx, dyn, tick, amb) {
  if (!dyn.raining) return;
  const r = Math.min(255, 235 * amb[0]) | 0, g = Math.min(255, 246 * amb[1]) | 0, b = Math.min(255, 252 * amb[2]) | 0;
  pctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.30)`;
  pctx.lineWidth = 1;
  for (const w of dyn.waterTop) {
    const ph = (tick * 0.5 + w.cx * 1.7) % 10;
    const rr = 2 + ph * 1.1;
    pctx.globalAlpha = 0.30 * (1 - ph / 10);
    pctx.beginPath();
    pctx.ellipse(w.x + w.s / 2, w.y + w.s * 0.2, rr * 1.8, rr * 0.55, 0, 0, Math.PI * 2);
    pctx.stroke();
  }
  pctx.globalAlpha = 1;
}

// --- the lightmap (takeaway #5: Terraria-style, coarse RGB multiply) ---------
// BAKED at cache time (every 32 ticks / view change), not per frame: the
// ambient moves slowly, and baking keeps the per-frame cost to one canvas
// blit. Fire flicker stays per-frame via the additive drawFireGlow.
//   bakeLightIntoWorld: builds the coarse RGB light grid (ambient × shadow,
//     sky band neutral, static fire stamps), masks it to the world's alpha
//     (destination-in), and multiplies it into the world canvas.
//   r3LightAt: samples the baked light at a screen point — creatures get a
//     cheap bbox multiply per frame so they sit in the same light.
const R3_LCELL = 18;
let lightCanvas = null, lightImg = null, lightCtx2d = null, lightCW = 0, lightCH = 0;

function buildLightGrid(dyn) {
  const { cw, ch, shadow, skyK, fires, amb } = dyn;
  if (!lightCanvas || lightCW !== cw || lightCH !== ch) {
    lightCanvas = document.createElement('canvas');
    lightCanvas.width = cw; lightCanvas.height = ch;
    lightCtx2d = lightCanvas.getContext('2d');
    lightImg = lightCtx2d.createImageData(cw, ch);
    lightCW = cw; lightCH = ch;
  }
  const data = lightImg.data;
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const o = j * cw + i, sk = skyK[o], sh = shadow[o];
      let r = amb[0] * sh, g = amb[1] * sh, b = amb[2] * sh;
      r += (1 - r) * sk; g += (1 - g) * sk; b += (1 - b) * sk; // sky stays neutral
      const oo = o * 4;
      data[oo] = Math.min(255, r * 255);
      data[oo + 1] = Math.min(255, g * 255);
      data[oo + 2] = Math.min(255, b * 255);
      // the sky band masks itself out: no destination-in resample needed,
      // and the feathered skyK gives a soft edge for free
      data[oo + 3] = sk > 0.5 ? 0 : 255;
    }
  }
  // static fire stamps (flicker is the per-frame additive glow)
  for (const f of fires) {
    const ci = Math.round(f.x / R3_LCELL), cj = Math.round(f.y / R3_LCELL);
    const rad = 5, a0 = Math.min(1, f.heat) * 0.8;
    for (let dj = -rad; dj <= rad; dj++) {
      for (let di = -rad; di <= rad; di++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= cw || jj >= ch) continue;
        const d = Math.hypot(di, dj) / rad;
        if (d > 1) continue;
        const fall = (1 - d) * (1 - d);
        const oo = (jj * cw + ii) * 4;
        const aa = Math.min(1, a0 * fall);
        data[oo] = Math.min(255, data[oo] + (255 - data[oo]) * aa);
        data[oo + 1] = Math.min(255, data[oo + 1] + (174 - data[oo + 1]) * aa);
        data[oo + 2] = Math.min(255, data[oo + 2] + (97 - data[oo + 2]) * aa);
      }
    }
  }
  lightCtx2d.putImageData(lightImg, 0, 0);
}

function bakeLightIntoWorld(worldCtx, dyn, W, H) {
  buildLightGrid(dyn);
  // the light grid's alpha already masks the sky band (see buildLightGrid),
  // so the multiply lands only on the world — no extra resample pass
  worldCtx.save();
  worldCtx.globalCompositeOperation = 'multiply';
  worldCtx.imageSmoothingEnabled = true;
  worldCtx.imageSmoothingQuality = 'low'; // smooth gradient: low is plenty, high is 10x slower in software
  worldCtx.drawImage(lightCanvas, 0, 0, W, H);
  worldCtx.restore();
}

// sample the baked light at a screen point (for creature bbox grading)
function r3LightAt(dyn, sx, sy) {
  const { cw, ch, shadow, skyK, amb, fires } = dyn;
  const i = Math.max(0, Math.min(cw - 1, Math.round(sx / R3_LCELL)));
  const j = Math.max(0, Math.min(ch - 1, Math.round(sy / R3_LCELL)));
  const o = j * cw + i, sk = skyK[o], sh = shadow[o];
  let r = amb[0] * sh, g = amb[1] * sh, b = amb[2] * sh;
  r += (1 - r) * sk; g += (1 - g) * sk; b += (1 - b) * sk;
  for (const f of fires) {
    const d = Math.hypot(f.x - sx, f.y - sy);
    if (d < 110) {
      const a = Math.min(1, f.heat) * 0.6 * (1 - d / 110);
      r += (1.0 - r) * a; g += (0.68 - g) * a; b += (0.38 - b) * a;
    }
  }
  return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
}

// --- spring-joint creatures (takeaway #7, render-layer approximation) ---------
// Per-creature visual state: the root lags behind the sim position on a
// spring (weight), leans into velocity, squash-and-stretches on speed, and
// the tail curl + head pitch lag as secondary joints. The pose itself still
// comes from portraitFor — AI decisions become weighted motion. Browser only;
// the SVG stills path draws the direct pose (tests stay byte-stable).
const springById = new Map();

function springDraw(ctx, oc, drawFn, px, py, scale, tick, dyn) {
  const sunE = dyn.sunE;
  const id = (oc.drawing && oc.drawing.creatureId) || -1;
  const tx = px(oc.x), ty = py(oc.y);
  if (id < 0) { drawFn(ctx, oc, px, py, scale); return; }
  let s = springById.get(id);
  if (!s || Math.abs(s.tx - tx) > 500 || Math.abs(s.ty - ty) > 500) {
    s = { sx: tx, sy: ty, vx: 0, vy: 0, rot: 0, vrot: 0, sq: 0, tailLag: 0, headLag: 0, born: tick, tx, ty, seen: tick };
    if (springById.size > 400) {
      for (const [k, v] of springById) if (tick - v.seen > 900) springById.delete(k);
    }
    springById.set(id, s);
  }
  s.tx = tx; s.ty = ty; s.seen = tick;
  // root spring: critically-damped-ish lag gives the body weight
  s.vx += (tx - s.sx) * 0.16; s.vx *= 0.70; s.sx += s.vx;
  s.vy += (ty - s.sy) * 0.16; s.vy *= 0.70; s.sy += s.vy;
  // lean into the velocity
  const leanT = Math.max(-0.22, Math.min(0.22, s.vx * 0.006));
  s.vrot += (leanT - s.rot) * 0.10; s.vrot *= 0.80; s.rot += s.vrot;
  // squash & stretch on speed (Disney, via takeaway #7)
  const sp = Math.hypot(s.vx, s.vy);
  const sqT = Math.min(0.16, sp * 0.010);
  s.sq += (sqT - s.sq) * 0.25;
  // secondary joints: the tail drags behind, the head counter-pitches
  const tailT = Math.max(-0.6, Math.min(0.6, -s.vx * 0.030));
  s.tailLag += (tailT - s.tailLag) * 0.10;
  const headT = Math.max(-0.35, Math.min(0.35, -s.vy * 0.020 - s.vx * 0.008));
  s.headLag += (headT - s.headLag) * 0.08;
  // spawn scale-in over ~200ms (takeaway #10: nothing pops)
  const age = tick - s.born;
  let sc = age >= 12 ? 1 : age <= 0 ? 0.01 : age / 12;
  sc = 1 - Math.pow(1 - sc, 2);

  // blob contact shadow (takeaway #9): grounds the creature
  const shW = ((oc.drawing && oc.drawing.widthPx) || 40) * scale * 0.55;
  ctx.fillStyle = 'rgba(8, 6, 4, 0.30)';
  ctx.beginPath();
  ctx.ellipse(tx, ty + 2 * scale, shW, Math.max(2, 5 * scale), 0, 0, Math.PI * 2);
  ctx.fill();

  // the body, drawn at the spring position with lean + squash
  let oc2 = oc;
  if (oc.drawing && oc.drawing.pose) {
    const p = oc.drawing.pose;
    oc2 = { ...oc, drawing: { ...oc.drawing, pose: { ...p, tailCurl: (p.tailCurl || 0) + s.tailLag * 0.5, headPitch: (p.headPitch || 0) + s.headLag } } };
  }
  ctx.save();
  ctx.translate(s.sx, s.sy);
  ctx.rotate(s.rot);
  ctx.scale(sc * (1 + s.sq), sc * (1 - s.sq * 0.85));
  ctx.translate(-tx, -ty);
  drawFn(ctx, oc2, px, py, scale);
  ctx.restore();

  // light-grade the creature into the baked world light (takeaway #5):
  // a feathered radial multiply over the body — no hard edges, so it never
  // reads as a dark square against the sky at night
  const hgt = ((oc.drawing && oc.drawing.heightPx) || 60) * scale;
  const lc = r3LightAt(dyn, s.sx, s.sy - hgt * 0.4);
  if (Math.abs(lc[0] - 1) > 0.03 || Math.abs(lc[1] - 1) > 0.03 || Math.abs(lc[2] - 1) > 0.03) {
    const gr = hgt * 0.62;
    const lr = (lc[0] * 255) | 0, lg2 = (lc[1] * 255) | 0, lb = (lc[2] * 255) | 0;
    const grad = ctx.createRadialGradient(s.sx, s.sy - hgt * 0.42, 0, s.sx, s.sy - hgt * 0.42, gr);
    grad.addColorStop(0, `rgba(${lr},${lg2},${lb},0.95)`);
    grad.addColorStop(1, `rgba(${lr},${lg2},${lb},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(s.sx, s.sy - hgt * 0.42, gr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // (The directional rim light used to live here, but it assumed a
  // tanglekin-like body plan: on squat fauna — beetles, grubs — heightPx
  // overstates the visual body and the arc floated detached above them.
  // Every species already draws its own correctly-fitted rim via
  // artHelpers.rimArc in its draw function, so this one is removed.)
}

// lightning, split: bolts before the lightmap, flash wash after
function drawLightningBolts(pctx, mw, G, W, H, tick, seed) {
  if (!mw.sky || !mw.sky.lightning) return;
  const { px } = G;
  for (const L of mw.sky.lightning) {
    const age = tick - L.t;
    if (age < 0 || age > 26) continue;
    const k = 1 - age / 26;
    const sx = px(L.x);
    const topY = H * 0.05, botY = H * 0.8;
    pctx.strokeStyle = `rgba(240, 244, 255, ${(0.9 * k).toFixed(3)})`;
    pctx.lineWidth = 2.2;
    pctx.beginPath();
    let x = sx, y = topY;
    pctx.moveTo(x, y);
    for (let sgm = 1; sgm <= 6; sgm++) {
      x = sx + (h3(seed, L.t | 0, sgm) - 0.5) * 46 * sgm / 3;
      y = topY + (botY - topY) * sgm / 6;
      pctx.lineTo(x, y);
    }
    pctx.stroke();
  }
}
function drawLightningFlash(pctx, mw, tick, W, H) {
  if (!mw.sky || !mw.sky.lightning) return;
  for (const L of mw.sky.lightning) {
    const age = tick - L.t;
    if (age < 0 || age > 26) continue;
    const k = 1 - age / 26;
    pctx.fillStyle = `rgba(235, 240, 255, ${(0.22 * k).toFixed(3)})`;
    pctx.fillRect(0, 0, W, H);
  }
}

// --- paintTerrain, round 3: the dispatcher ------------------------------------
// Sky and world paint into SEPARATE cached canvases: the lightmap grades the
// world (and creatures) but the sky keeps its authored day/night gradient.
function paintTerrain(pctx, mw, view, G, W, H) {
  const { surf, seed } = mw;
  const { px, py, cx0, cx1 } = G;
  const e = sunElev(mw);
  const season = typeof seasonSin === 'function' ? seasonSin(mw) : 0;
  const pal = skyPalette(e, season);
  const dayK = clamp01((e + 0.12) / 0.5);
  const midCx = Math.max(cx0, Math.min(cx1, Math.round((cx0 + cx1) / 2)));
  const horizonY = clamp01(py(((surf[midCx] | 0) + 1) * CELL_PX) / H) * H;
  const amb = r3LightAmbient(e);

  const skyCv = document.createElement('canvas');
  skyCv.width = W; skyCv.height = H;
  paintSkyCache(skyCv.getContext('2d'), mw, view, G, W, H, horizonY, pal, e, dayK);

  const worldCv = document.createElement('canvas');
  worldCv.width = W; worldCv.height = H;
  const worldCtx = worldCv.getContext('2d');
  const wdyn = paintWorldCache(worldCtx, mw, view, G, W, H, pal, e, dayK);
  wdyn.amb = amb;
  // the lightmap is baked into the world canvas (cache cadence); the sky
  // keeps its authored gradient untouched. Trees composite AFTER the bake:
  // trunks and crowns keep authored colors (they carry their own diurnal
  // grade) while the ground keeps the moody multiply light.
  bakeLightIntoWorld(worldCtx, wdyn, W, H);
  if (wdyn.treeCanvas) worldCtx.drawImage(wdyn.treeCanvas, 0, 0);

  // one composited canvas per frame: sky + graded world
  const finalCv = document.createElement('canvas');
  finalCv.width = W; finalCv.height = H;
  const fctx = finalCv.getContext('2d');
  fctx.drawImage(skyCv, 0, 0);
  fctx.drawImage(worldCv, 0, 0);
  // vignette lives in the cache (static): a per-frame radial gradient is
  // 20ms of software blending we don't need to pay 60x/sec
  const vg = fctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(8, 10, 18, 0)');
  vg.addColorStop(1, 'rgba(8, 10, 18, 0.20)');
  fctx.fillStyle = vg;
  fctx.fillRect(0, 0, W, H);

  return { canvas: finalCv, seed, pal, sunE: e, ...wdyn };
}
