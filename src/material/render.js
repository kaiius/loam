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
export function renderWorldView(ctx, mw, view, opts = {}) {
  const { grid, cols, rows, seed, surf, seaRow } = mw;
  const W = ctx.w, H = ctx.h;
  const scale = Math.min(W / view.w, H / view.h);
  const ox = (W - view.w * scale) / 2;
  const oy = (H - view.h * scale) / 2;
  const px = (wx) => ox + (wx - view.x) * scale;
  const py = (wy) => oy + (wy - view.y) * scale;
  const cellPx = CELL_PX * scale;

  // --- cell range covered by the view (1-cell margin) -----------------------
  const cx0 = Math.max(0, Math.floor(view.x / CELL_PX) - 1);
  const cx1 = Math.min(cols - 1, Math.ceil((view.x + view.w) / CELL_PX) + 1);
  const cy0 = Math.max(0, Math.floor(view.y / CELL_PX) - 1);
  const cy1 = Math.min(rows - 1, Math.ceil((view.y + view.h) / CELL_PX) + 1);

  // --- sky: AIR connected to the top row (flood from the top) ---------------
  // Underground AIR (tunnels, burrows, sealed pockets) is NOT sky — it gets
  // the dark earth shadow, never the sky gradient.
  const sky = floodSky(grid, cols, rows);

  // --- per-column solidity prefix sums for the cheap AO --------------------
  // darkness(cy) ∝ solid cells in the column above, within ~12 cells.
  const AO_RANGE = 12;
  // Sky-connected air needs at least this much solid above it before it
  // stops being "open sky" and starts catching dimmed skylight (shafts and
  // burrow mouths — not the air under a lone branch).
  const SKYLIGHT_MIN_AO = 0.5;
  const prefix = new Int32Array((cx1 - cx0 + 1) * (rows + 1));
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
    return prefix[base + cy] - prefix[base + lo]; // cells in [lo, cy)
  };

  // --- sky background: one vertical gradient, top-left light ---------------
  // Sky-connected AIR cells are simply never drawn — the gradient shows
  // through. Everything else (tunnel air included) paints over it.
  const horizonPy = clamp01((oy + (seaRow * CELL_PX - view.y) * scale) / H);
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, hslRgb(209, 58, 70));            // soft blue, zenith
  skyGrad.addColorStop(Math.max(0.05, horizonPy * 0.8), hslRgb(204, 45, 79));
  skyGrad.addColorStop(Math.min(1, horizonPy + 0.06), hslRgb(48, 42, 89)); // pale horizon
  skyGrad.addColorStop(1, hslRgb(36, 34, 82));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // --- the material field ---------------------------------------------------
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * cols + cx;
      const m = grid.mat[i];
      const waterCell = isWaterCell(m, grid, i);
      const ao = solidAbove(cx, cy) / AO_RANGE; // 0 = lit, 1 = deep shadow
      const lit = 1 - 0.62 * ao;                // light dies with depth
      const rx = px(cx * CELL_PX), ry = py(cy * CELL_PX);
      const s = cellPx + 0.5;                   // slight overlap: no seams

      if (m === MAT.AIR && !waterCell && sky[i]) {
        // A lone branch overhead is still open sky — only genuinely capped
        // air (a shaft, a burrow mouth) gets the dimmed skylight treatment.
        if (ao < SKYLIGHT_MIN_AO) continue; // true open sky — the gradient shows through
        // Skylight down a shaft or burrow mouth: pale blue dying FAST with
        // depth. The open column above a shaft stays bright (a light well);
        // the burrow beyond it falls into dark blue-grey shadow, never a
        // flat blue bar.
        const depthF = 1 - ao; // 1 at the surface, 0 in the deep
        ctx.fillStyle = hsl(206, 42 * depthF, shade(78, lit * depthF));
        ctx.fillRect(rx, ry, s, s);
        continue;
      }

      ctx.fillStyle = cellColor(m, cx, cy, i, grid, mw, lit);
      ctx.fillRect(rx, ry, s, s);

      // water surface highlight: the top row of a water body catches light
      if (isWaterCell(m, grid, i)) {
        const above = cy > 0 ? grid.mat[i - cols] : MAT.AIR;
        const aboveWater = isWaterCell(above, grid, cy > 0 ? i - cols : -1);
        if (!aboveWater) {
          ctx.fillStyle = 'rgba(235, 246, 252, 0.55)';
          ctx.fillRect(rx, ry, s, Math.max(1.5, s * 0.28));
        }
      }

      // fire: ember-orange overlay glow on hot cells
      const heat = grid.heat[i];
      if (heat > 0.5) {
        const hc = clamp01(heat);
        ctx.save();
        ctx.globalAlpha = 0.30 + 0.45 * hc;
        ctx.fillStyle = 'rgb(255, 118, 22)';
        ctx.fillRect(rx, ry, s, s);
        if (hc > 0.82) {
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = 'rgb(255, 205, 110)';
          const inset = s * 0.28;
          ctx.fillRect(rx + inset, ry + inset, s - 2 * inset, s - 2 * inset);
        }
        ctx.restore();
      }
    }
  }

  // --- creature overlay (optional, humble) ---------------------------------
  // M2: opts.creature may carry a `drawing` (bodyDrawing() output) — the
  // grown body. Without it, the M1 fixed silhouette (kept for old callers).
  if (opts.creature) {
    if (opts.creature.drawing) drawGrownBody(ctx, opts.creature, px, py, scale);
    else drawCreature(ctx, opts.creature, px, py, scale);
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
function cellColor(m, cx, cy, i, grid, mw, lit) {
  const { seed, surf } = mw;
  const moist = grid.moist[i];

  switch (m) {
    case MAT.AIR: {
      // Underground air: the dark earth shadow. Never sky — the caller only
      // reaches here for non-sky air (tunnels, burrows, pockets).
      const v = h3(seed, cx, cy);
      return hsl(20, 30, shade(11 + v * 4, lit));
    }
    case MAT.SOIL: {
      // Layered umbers: darker with depth below the surface, darker when moist.
      const depth = Math.max(0, cy - (surf[cx] | 0));
      const grain = h3(seed, cx, cy);
      const strata = h3(seed, cx >> 2, cy >> 1);
      let l = 34 - Math.min(depth, 26) * 0.62 - moist * 7 + (grain - 0.5) * 5 + (strata - 0.5) * 3;
      return hsl(23 + (grain - 0.5) * 6, 36, shade(l, lit));
    }
    case MAT.SAND: {
      const v = h3(seed, cx, cy);
      return hsl(45 + (v - 0.5) * 8, 55, shade(63 + (v - 0.5) * 6 - moist * 4, lit));
    }
    case MAT.CLAY: {
      const v = h3(seed, cx, cy);
      return hsl(14 + (v - 0.5) * 8, 44, shade(37 + (v - 0.5) * 6 - moist * 3, lit));
    }
    case MAT.ROCK: {
      // Cool greys, faint horizontal strata — bands run along cy.
      const band = h3(seed, cy >> 2, 7);
      const v = h3(seed, cx, cy);
      return hsl(212 + (v - 0.5) * 10, 9, shade(37 + (band - 0.5) * 11 + (v - 0.5) * 5, lit));
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
      return hsl(24 + (treeTone - 0.5) * 12, 36, shade(l, lit));
    }
    case MAT.DEADWOOD: {
      const v = h3(seed, cx, cy);
      return hsl(30 + (v - 0.5) * 8, 13, shade(29 + (v - 0.5) * 6, lit));
    }
    case MAT.LEAF: {
      // Greens varied per cell by stateless hash — canopy clusters, never
      // sticker dots. Interior leaves are dimmed by the AO so the crown has
      // depth.
      const hue = h3(seed, cx, cy);
      const val = h3(seed, cy, cx);
      return hsl(96 + hue * 34, 42 + hue * 12, shade(24 + val * 13, lit));
    }
    case MAT.BEDROCK: {
      const v = h3(seed, cx, cy);
      return hsl(222, 12, shade(9 + v * 5, lit));
    }
    default: {
      // MAT.WATER, or AIR with water depth > 0.5: blues graded by depth.
      const depth = m === MAT.AIR ? clamp01(grid.water[i]) : 0.65 + 0.3 * h3(seed, cx, cy);
      const v = h3(seed, cx, cy);
      return hsl(206 + (v - 0.5) * 10, 62, shade(58 - depth * 30 + (v - 0.5) * 4, lit));
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

// --- M2: the grown body ------------------------------------------------------
// Draws bodyDrawing() output: torso + per-limb segments + tail, in the
// genome's hue. Scarred limbs draw thinner and paler — the world writes on
// the body and the renderer doesn't look away.
function drawGrownBody(ctx, c, px, py, scale) {
  const d = c.drawing;
  ctx.save();
  ctx.translate(px(c.x), py(c.y));
  ctx.scale(scale * (c.facing >= 0 ? 1 : -1), scale);
  const H = d.heightPx, W = d.widthPx;
  const fur = `hsl(${d.hueDeg}, 32%, 26%)`;
  const furLight = `hsl(${d.hueDeg}, 30%, 40%)`;
  const scarCol = `hsl(${d.hueDeg}, 18%, 52%)`;

  // tail: back-swept curve, length from the genome
  const tailLen = d.tailLenPx || 40;
  ctx.strokeStyle = fur;
  ctx.lineWidth = Math.max(2.5, W * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-W * 0.3, -H * 0.3);
  ctx.quadraticCurveTo(-W * 0.3 - tailLen * 0.6, -H * 0.35, -W * 0.3 - tailLen * 0.35, -H * 0.75);
  ctx.stroke();

  // limbs: shoulder/hip arms + legs, dorsal/mid/neck buds as smaller nubs.
  // Grasp limbs reach; membrane/sail/fin/gill buds draw as short flaps.
  for (const l of d.limbs) {
    const isLeg = l.site === 'hip';
    const baseX = l.side === 'L' ? -W * 0.18 : W * 0.18;
    const baseY = l.site === 'shoulder' ? -H * 0.62 : l.site === 'hip' ? -H * 0.3 : -H * 0.75;
    ctx.strokeStyle = l.scarred ? scarCol : fur;
    if (l.type === 'grasp') {
      ctx.lineWidth = l.scarred ? 3 : 5.5;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      const reachX = baseX + (l.side === 'L' ? -1 : 1) * l.lenPx * 0.5;
      const reachY = isLeg ? 0 : baseY + l.lenPx * 0.45;
      ctx.quadraticCurveTo(reachX, (baseY + reachY) / 2, l.side === 'L' ? reachX - 3 : reachX + 3, reachY);
      ctx.stroke();
    } else {
      // bud flap: membrane / sail / fin / gill
      ctx.fillStyle = l.scarred ? scarCol : furLight;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(baseX, baseY - l.lenPx * 0.3, l.lenPx * 0.32, l.lenPx * 0.5, l.side === 'L' ? 0.5 : -0.5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // torso
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.45, W * 0.42, H * 0.32, 0);
  ctx.fill();

  // head + muzzle
  const headR = W * 0.36;
  ctx.beginPath();
  ctx.arc(W * 0.12, -H * 0.88, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = furLight;
  ctx.beginPath();
  ctx.ellipse(W * 0.12 + headR * 0.45, -H * 0.86, headR * 0.5, headR * 0.42, 0);
  ctx.fill();

  ctx.restore();
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
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.fillStyle = 'rgba(12, 14, 18, 0.72)';
  ctx.fillRect(pad, pad, tw + 20, lines.length * lh + 14);
  ctx.fillStyle = 'rgba(235, 240, 235, 0.95)';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, pad + 10, pad + 8 + i * lh));
  ctx.restore();

  return { scale, ox, oy };
}
