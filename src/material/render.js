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
// sun elevation: +1 at noon, -1 at midnight. Tick 600 = noon (day = 2400).
function sunElev(mw) {
  const t = timeOfDay(mw);
  return Math.cos((t - 0.25) * Math.PI * 2);
}

// sky palette stops, lerped by daylight. Returns [zenithHSL, midHSL, horHSL].
function skyPalette(e, season) {
  // day
  const day = [[209, 58, 70], [204, 45, 79], [48, 42, 89]];
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
const CACHE_TICKS = 32;   // terrain repaint cadence; the diurnal light moves
                        // slowly and water/fire read fine a half-second behind
const hasDocument = typeof document !== 'undefined' && typeof document.createElement === 'function';

function cacheKey(mw, view, W, H) {
  return mw.seed + '|' + W + 'x' + H + '|' + view.x + ',' + view.y + ',' + view.w + ',' + view.h;
}

// numeric cell color — the albedo field. Returns [r, g, b] 0-255.
function cellRGB(m, cx, cy, i, grid, mw, lit, waterCell) {
  const [h, s, l] = cellHSL(m, cx, cy, i, grid, mw, lit, waterCell);
  return hsl2rgb(h, s, l);
}

// Paint sky + terrain into pctx (an offscreen canvas ctx in the browser,
// the real ctx in the shim). Returns dynamic lists for per-frame overlays:
// { leaves, fires, waterTop, sky } — screen-space.
function paintTerrain(pctx, mw, view, G, W, H) {
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
  for (const w of dyn.waterTop) {
    const a = 0.30 + 0.18 * Math.sin(tick * 0.12 + w.cx * 0.7);
    pctx.fillStyle = `rgba(235, 246, 252, ${a.toFixed(3)})`;
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

function drawLeaves(pctx, dyn, mw, tick) {
  if (!dyn.leaves.length) return;
  // one batched path: every leaf shares the same highlight fill.
  pctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  pctx.beginPath();
  let lastWq = -1e9, lastWind = 10;
  for (const L of dyn.leaves) {
    const wx = L.cx * 10 + 5, wq = wx - (wx % 200);
    if (wq !== lastWq) {
      lastWq = wq;
      lastWind = typeof windAt === 'function' ? windAt(mw, wq) : 10;
    }
    const sway = Math.sin(tick * 0.07 + L.cx * 0.35 + L.cy * 0.5) * lastWind * 0.12;
    // leaf color: lift the albedo toward the light
    pctx.ellipse(L.x + L.s / 2 + sway, L.y + L.s / 2, L.s * 0.85, L.s * 0.70, 0.2, 0, Math.PI * 2);
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
  if (e > 0.28) return;
  if (e >= 0) {
    const k = 1 - e / 0.28;
    pctx.fillStyle = `rgba(255, 148, 64, ${(0.10 * k).toFixed(3)})`;
  } else {
    const k = Math.min(1, -e * 1.4);
    pctx.fillStyle = `rgba(10, 18, 52, ${(0.52 * k).toFixed(3)})`;
  }
  pctx.fillRect(0, 0, W, H);
}

/**
 * renderWorldView(ctx, mw, view, opts) — the naturalistic painting.
 * (doc comment from M1 kept: world view only, no text, no UI.)
 */
export function renderWorldView(ctx, mw, view, opts = {}) {
  const { grid, cols, rows, seed } = mw;
  const W = ctx.w, H = ctx.h;
  const scale = Math.min(W / view.w, H / view.h);
  const ox = (W - view.w * scale) / 2;
  const oy = (H - view.h * scale) / 2;
  const px = (wx) => ox + (wx - view.x) * scale;
  const py = (wy) => oy + (wy - view.y) * scale;
  const cellPx = CELL_PX * scale;
  const G = {
    px, py, scale, cellPx,
    vx: view.x, vw: view.w,
    cx0: Math.max(0, Math.floor(view.x / CELL_PX) - 1),
    cx1: Math.min(cols - 1, Math.ceil((view.x + view.w) / CELL_PX) + 1),
    cy0: Math.max(0, Math.floor(view.y / CELL_PX) - 1),
    cy1: Math.min(rows - 1, Math.ceil((view.y + view.h) / CELL_PX) + 1),
    worldW: cols * CELL_PX,
  };
  const tick = mw.tick || 0;

  // --- terrain: cached in the browser, painted direct in the stills shim -------
  let dyn;
  if (hasDocument) {
    const key = cacheKey(mw, view, W, H);
    if (!terrainCache || terrainCache.key !== key || (tick - terrainCache.tick) > CACHE_TICKS) {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const cctx = cv.getContext('2d');
      const d = paintTerrain(cctx, mw, view, G, W, H);
      terrainCache = { key, tick, canvas: cv, dyn: d };
    }
    dyn = terrainCache.dyn;
    ctx.drawImage(terrainCache.canvas, 0, 0);
  } else {
    dyn = paintTerrain(ctx, mw, view, G, W, H);
  }

  // --- per-frame life ----------------------------------------------------------------------
  drawWaterShimmer(ctx, dyn, tick);
  drawFireGlow(ctx, dyn, tick);
  drawLeaves(ctx, dyn, mw, tick);
  drawRain(ctx, mw, G, W, H, tick, seed);
  drawLightning(ctx, mw, G, W, H, tick, seed);
  drawTint(ctx, dyn.sunE, W, H);

  // --- creatures: the fauna ------------------------------------------------------------------
  // opts.creatures draws the whole living roster (eye only). Non-tanglekin
  // species get their silhouettes from fauna.js; the tanglekin keeps its
  // grown-body renderer. oc.drawing is portraitFor() output — live pose.
  const roster = opts.creatures || (opts.creature ? [opts.creature] : []);
  for (const oc of roster) {
    const sx = px(oc.x), sy = py(oc.y);
    if (sx < -300 || sx > ctx.w + 300 || sy < -300 || sy > ctx.h + 300) continue;
    if (oc.drawing && oc.species && oc.species !== 'tanglekin') drawSpeciesBody(ctx, oc, px, py, scale);
    else if (oc.drawing) drawGrownBody(ctx, oc, px, py, scale);
    else drawCreature(ctx, oc, px, py, scale);
  }

  return { scale, ox, oy };
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
      const depth = Math.max(0, cy - (surf[cx] | 0));
      const grain = h3(seed, cx, cy);
      const strata = h3(seed, cx >> 2, cy >> 1);
      let l = 34 - Math.min(depth, 26) * 0.62 - moist * 7 + (grain - 0.5) * 5 + (strata - 0.5) * 3;
      return [23 + (grain - 0.5) * 6, 36, shade(l, lit)];
    }
    case MAT.SAND: {
      const v = h3(seed, cx, cy);
      return [45 + (v - 0.5) * 8, 55, shade(63 + (v - 0.5) * 6 - moist * 4, lit)];
    }
    case MAT.CLAY: {
      const v = h3(seed, cx, cy);
      return [14 + (v - 0.5) * 8, 44, shade(37 + (v - 0.5) * 6 - moist * 3, lit)];
    }
    case MAT.ROCK: {
      // Cool greys, faint horizontal strata — bands run along cy.
      const band = h3(seed, cy >> 2, 7);
      const v = h3(seed, cx, cy);
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
  const coatH = d.coatHue01 * 360, coatS = d.coatSat01 * 100;
  const col = (pig, L, sMul = 1) =>
    `hsl(${(coatH + pig.hueDeg + 360) % 360}, ${Math.max(8, Math.min(90, coatS * sMul + pig.satShift))}%, ${L}%)`;
  const furTorso = col(d.pigTorso, 27), furLimb = col(d.pigLimbs, 23),
    furHead = col(d.pigHead, 30), furPale = col(d.pigTorso, 43, 0.8),
    furDark = col(d.pigTorso, 16), markDark = col(d.pigTorso, 15, 0.9),
    scarCol = `hsl(${coatH}, 22%, 64%)`, handCol = col(d.pigLimbs, 18);

  if (pose.curled > 0.5) { drawCurled(ctx, d, pose, id, H, W, furTorso, furPale, furHead, scarCol, coatH); ctx.restore(); return; }

  // --- skeleton ------------------------------------------------------------
  const crouch = pose.crouch;
  const hipY = -H * 0.32 + crouch * H * 0.20;
  const torsoLen = H * 0.34;
  const lean = pose.spineLean + pose.sway * 0.12;
  const shX = Math.sin(lean) * torsoLen, shY = hipY - Math.cos(lean) * torsoLen;
  const torsoW = W * 0.42 * (1 + pose.breath * 0.03);
  const legLen = H * (0.26 + 0.14 * d.legLength01);
  const armLen = H * 0.30;
  const headR = W * 0.30;

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
  if (d.fur > 0.35) {
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
  drawCoatPattern(ctx, d, id, torsoW, torsoLen, markDark, furPale);
  drawTorsoScars(ctx, d, id, torsoW, torsoLen, scarCol);
  // fur + rim light over the torso
  artHelpers.furStrokes(ctx, id, 0, 0, torsoW * 0.78, torsoLen * 0.70, 0.1, 24 + Math.round(d.fur * 26), 4.5, furPale, furDark, 500);
  artHelpers.rimArc(ctx, 0, 0, torsoW * 0.78, torsoLen * 0.70, 0, furPale, 0.38, 1.6);
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
  // feet + hands: grasping pads
  ctx.fillStyle = handCol;
  ctx.beginPath(); ctx.ellipse(nk.tx + 2, nk.ty - 1.5, legW * 0.75, legW * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(nearHand.x + 1.5, nearHand.y, armW * 0.62, 0, Math.PI * 2); ctx.fill();

  // --- head + face: the affect readout ------------------------------------------
  drawHead(ctx, d, pose, id, shX, shY, lean, headR, furHead, furPale, furDark, scarCol, coatH);

  ctx.restore();
}

// The prehensile tail: chained segments, base angle steered by tailRaise,
// progressive curl (+ prehensile tip scaled by tailGrip), idle sway.
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
      ctx.lineWidth = Math.max(1.6, (1 - s / segs) * 5);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      x = nx; y = ny;
    }
  }
}

// Coat patterning in the torso's local frame (already translated+rotated).
// Spots / stripes / plain grain — density from the genome, placement from
// the individual's hash salt. Deterministic, decorative, never sim.
function drawCoatPattern(ctx, d, id, torsoW, torsoLen, markDark, furPale) {
  const dens = d.patternDensity;
  if (d.pattern === 'spots') {
    const n = Math.round(dens * 16);
    ctx.fillStyle = markDark;
    for (let i = 0; i < n; i++) {
      const a = h4(id, 200 + i, 7) * Math.PI * 2, r = 0.15 + h4(id, 300 + i, 7) * 0.62;
      const sx = Math.cos(a) * torsoW * 0.80 * r, sy = Math.sin(a) * torsoLen * 0.72 * r;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, sy, 1.6 + h4(id, 400 + i, 7) * 2.6, 1.4 + h4(id, 500 + i, 7) * 2.0, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (d.pattern === 'stripes') {
    const n = 3 + Math.round(dens * 6);
    ctx.fillStyle = markDark;
    for (let i = 0; i < n; i++) {
      const fy = -0.75 + (i + h4(id, 210 + i, 7) * 0.6) / n * 1.5;
      const sy = fy * torsoLen * 0.72, wdt = torsoW * 0.80 * Math.sqrt(Math.max(0.1, 1 - fy * fy));
      ctx.globalAlpha = 0.42;
      ctx.beginPath(); ctx.ellipse(0, sy, wdt, torsoLen * 0.05, 0, 0, Math.PI * 2); ctx.fill();
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
function drawHead(ctx, d, pose, id, shX, shY, lean, headR, furHead, furPale, furDark, scarCol, coatH) {
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

  // eye: shaded orb, openness from the affect readout — a window, not a bead
  const erx = headR * (0.15 + 0.24 * d.eyeSize);
  const ery = Math.max(0.6, erx * pose.eyeOpenNow);
  const exx = headR * 0.40, eyy = -headR * 0.08;
  artHelpers.drawEye(ctx, exx, eyy, erx, pose.eyeOpenNow);

  // brow: a light ridge that lowers and angles with fear / pain
  const bd = pose.browDrop;
  ctx.strokeStyle = furDark; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, headR * 0.07);
  ctx.globalAlpha = 0.55 + bd * 0.45;
  ctx.beginPath();
  ctx.moveTo(exx - erx * 0.85, eyy - ery - headR * 0.24);
  ctx.lineTo(exx + erx * 0.80, eyy - ery - headR * 0.24 + bd * headR * 0.30);
  ctx.stroke();
  ctx.globalAlpha = 1;

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
// recognizable at a glance, drawn from the same coat.
function drawCurled(ctx, d, pose, id, H, W, furTorso, furPale, furHead, scarCol, coatH) {
  const R = H * 0.26;
  const breathe = 1 + pose.breath * 0.04;
  const ballGrad = ctx.createLinearGradient(0, -R * 2, 0, 0);
  ballGrad.addColorStop(0, artHelpers.hslRgb(coatH, 30, 16));
  ballGrad.addColorStop(1, furPale);
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
  drawCoatPattern(ctx, d, id, R * 1.05, R * 0.95, `hsl(${coatH}, 30%, 15%)`, furPale);
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
  const { scale, ox, oy } = renderWorldView(ctx, mw, view, opts);
  const W = ctx.w, H = ctx.h;
  const px = (wx) => ox + (wx - view.x) * scale;
  const py = (wy) => oy + (wy - view.y) * scale;

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
