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
  // M3 refresh: opts.creatures draws the whole living roster (eye only —
  // the sim never sees render positions).
  const roster = opts.creatures || (opts.creature ? [opts.creature] : []);
  for (const oc of roster) {
    // Cull far-off-view creatures (eye only — the sim never sees this).
    const sx = px(oc.x), sy = py(oc.y);
    if (sx < -300 || sx > ctx.w + 300 || sy < -300 || sy > ctx.h + 300) continue;
    if (oc.drawing) drawGrownBody(ctx, oc, px, py, scale);
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
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = w;
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
  ctx.save();
  ctx.translate(shX / 2, (hipY + shY) / 2); ctx.rotate(lean);
  ctx.fillStyle = furTorso;
  ctx.beginPath(); ctx.ellipse(0, 0, torsoW * 0.80, torsoLen * 0.72, 0, 0, Math.PI * 2); ctx.fill();
  // belly: paler front
  ctx.fillStyle = furPale; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.ellipse(torsoW * 0.26, torsoLen * 0.06, torsoW * 0.36, torsoLen * 0.52, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  drawCoatPattern(ctx, d, id, torsoW, torsoLen, markDark, furPale);
  drawTorsoScars(ctx, d, id, torsoW, torsoLen, scarCol);
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

  // skull
  ctx.fillStyle = furHead;
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

  // eye: size from the genome, openness from the affect readout
  const erx = headR * (0.15 + 0.24 * d.eyeSize), ery = Math.max(0.6, erx * pose.eyeOpenNow);
  const exx = headR * 0.40, eyy = -headR * 0.08;
  ctx.fillStyle = '#1c1410';
  ctx.beginPath(); ctx.ellipse(exx, eyy, erx, ery, 0, 0, Math.PI * 2); ctx.fill();
  if (pose.eyeOpenNow > 0.25) { // catchlight — the eye is a window, not a bead
    ctx.fillStyle = 'rgba(240, 235, 225, 0.9)';
    ctx.beginPath(); ctx.arc(exx + erx * 0.3, eyy - ery * 0.3, Math.max(0.8, erx * 0.22), 0, Math.PI * 2); ctx.fill();
  }

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
  ctx.fillStyle = furTorso;
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
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.fillStyle = 'rgba(12, 14, 18, 0.72)';
  ctx.fillRect(pad, pad, tw + 20, lines.length * lh + 14);
  ctx.fillStyle = 'rgba(235, 240, 235, 0.95)';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, pad + 10, pad + 8 + i * lh));
  ctx.restore();

  return { scale, ox, oy };
}
