// Loam beauty pass — FAUNA.
//
// Species-specific silhouettes for the 11 M3 land species, drawn in one
// visual language: coat from the genome, gradient shading (never flat
// fills), rim light, fur/feather texture, affect-read faces. The tanglekin
// keeps its grown-body renderer (render.js); every other species gets a
// body plan here.
//
// drawSpeciesBody(ctx, oc, px, py, scale):
//   oc = { x, y, facing, species, drawing } — drawing is portraitFor()
//   output (static body + .pose + .affect). Pure function of (oc).
//   Canonical frame: feet at origin, facing +x, lengths in px.
//
// The pose is the primate-centric poseFor() output; each plan reads the
// generic fields (crouch, gaitPhase/gaitAmp, eyeOpenNow, mouthOpen,
// browDrop, earBack, tailRaise/tailCurl, breath) through its own anatomy.
// Affect stays wired to the real biochemistry — fear still widens the eye,
// exhaustion still slumps the body — made subtler, more lifelike.

import { neutralPose } from './portrait.js';

// --- deterministic salt ------------------------------------------------------
function h4(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x51ab, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// hsl -> 'rgb(r,g,b)' — gradient stops must be rgb for the SVG shim
// (cairosvg does not parse hsl()).
function hslRgb(h, s, l) {
  s = clamp01(s / 100); l = clamp01(l / 100);
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(f(0) * 255), g = Math.round(f(8) * 255), b = Math.round(f(4) * 255);
  return `rgb(${r},${g},${b})`;
}

// --- palette: the genome's coat, as working colors ---------------------------
function palette(d) {
  const coatH = d.coatHue01 * 360, coatS = d.coatSat01 * 100;
  const col = (pig, L, sMul = 1) =>
    hslRgb(((coatH + pig.hueDeg) % 360 + 360) % 360, clamp(coatS * sMul + pig.satShift, 8, 90), L);
  return {
    top: col(d.pigTorso, 18), mid: col(d.pigTorso, 30), belly: col(d.pigTorso, 46, 0.8),
    dark: col(d.pigTorso, 13), mark: col(d.pigTorso, 15, 0.9),
    head: col(d.pigHead, 33), limb: col(d.pigLimbs, 24),
    pale: col(d.pigTorso, 60, 0.7), scar: hslRgb(coatH, 22, 64),
    coatH,
  };
}

// vertical gradient, dorsal (top) to ventral (bottom)
function vgrad(ctx, y0, y1, cTop, cBot) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, cTop);
  g.addColorStop(1, cBot);
  return g;
}

// two-bone IK: joint position for (root -> target), bending to bendSign.
function ik2(rx, ry, tx, ty, l1, l2, bendSign) {
  let dx = tx - rx, dy = ty - ry, dist = Math.hypot(dx, dy) || 1e-6;
  const maxD = l1 + l2 - 0.01;
  if (dist > maxD) { const k = maxD / dist; dx *= k; dy *= k; dist = maxD; tx = rx + dx; ty = ry + dy; }
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const ang = Math.atan2(dy, dx) + bendSign * Math.acos(cosA);
  return { jx: rx + l1 * Math.cos(ang), jy: ry + l1 * Math.sin(ang), tx, ty };
}

// a limb as two strokes: dark edge under, lit core over — cheap roundness.
function limbSeg(ctx, rx, ry, tx, ty, l1, l2, bendSign, w, dark, lit) {
  const k = ik2(rx, ry, tx, ty, l1, l2, bendSign);
  ctx.lineCap = 'round';
  ctx.strokeStyle = dark; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(k.jx, k.jy); ctx.lineTo(k.tx, k.ty); ctx.stroke();
  ctx.strokeStyle = lit; ctx.lineWidth = Math.max(1, w * 0.55);
  ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(k.jx, k.jy); ctx.lineTo(k.tx, k.ty); ctx.stroke();
  return k;
}

// fur: deterministic short strokes over a region, following `ang`.
function furStrokes(ctx, id, cx, cy, rx, ry, ang, n, len, colA, colB, salt) {
  for (let i = 0; i < n; i++) {
    const a = h4(id, salt + i, 7) * Math.PI * 2;
    const rr = 0.25 + h4(id, salt + 100 + i, 7) * 0.7;
    const sx = cx + Math.cos(a) * rx * rr, sy = cy + Math.sin(a) * ry * rr;
    const l = len * (0.6 + h4(id, salt + 200 + i, 7) * 0.8);
    ctx.strokeStyle = h4(id, salt + 300 + i, 7) < 0.5 ? colA : colB;
    ctx.globalAlpha = 0.08 + h4(id, salt + 400 + i, 7) * 0.10;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * l, sy + Math.sin(ang) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// rim light: a pale arc along the sun side of a body mass.
function rimArc(ctx, cx, cy, rx, ry, rot, color, alpha, width) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(0, 0, rx * 0.96, ry * 0.96, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

// the eye: shaded orb, openness from the affect readout, catchlight.
function drawEye(ctx, x, y, r, open01) {
  const ry = Math.max(0.5, r * open01);
  const g = ctx.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r * 1.1);
  g.addColorStop(0, '#100c08');
  g.addColorStop(1, '#332619');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2); ctx.fill();
  if (open01 > 0.25) {
    ctx.fillStyle = 'rgba(240, 235, 225, 0.9)';
    ctx.beginPath(); ctx.arc(x + r * 0.3, y - ry * 0.3, Math.max(0.7, r * 0.22), 0, Math.PI * 2); ctx.fill();
  }
}

// --- QUADRUPED -----------------------------------------------------------------
// jungle-cat (stalk predator), plains-runner (cursorial pack hunter),
// bear (heavy omnivore), scurrier (small burrower). One plan, species params.
const QUAD = {
  'jungle-cat':   { bodyLen: 0.52, bodyH: 0.20, legLen: 0.30, headR: 0.150, ear: 'feline', tail: 0.55, neck: 0.15, bulk: 1.00, snout: 'cat' },
  'plains-runner':{ bodyLen: 0.56, bodyH: 0.15, legLen: 0.40, headR: 0.125, ear: 'feline', tail: 0.35, neck: 0.22, bulk: 0.85, snout: 'narrow' },
  'bear':         { bodyLen: 0.52, bodyH: 0.30, legLen: 0.26, headR: 0.165, ear: 'round',  tail: 0.08, neck: 0.10, bulk: 1.28, snout: 'bear', hump: true },
  'scurrier':     { bodyLen: 0.50, bodyH: 0.15, legLen: 0.22, headR: 0.125, ear: 'round',  tail: 0.50, neck: 0.14, bulk: 0.90, snout: 'point' },
};

function drawQuadruped(ctx, d, pose, id, q) {
  const H = d.heightPx, W = d.widthPx;
  const P = palette(d);
  const crouch = pose.crouch;
  const legL = H * q.legLen, bodyL = H * q.bodyLen, bodyH = H * q.bodyH * q.bulk;
  const bodyY = -legL - bodyH * 0.35 + crouch * H * 0.14;
  const breathe = 1 + pose.breath * 0.03;

  // --- far-side legs (darker, behind) ---------------------------------------
  const hipFX = bodyL * 0.30, hipBX = -bodyL * 0.30;
  const hipY = bodyY + bodyH * 0.25;
  const amp = pose.gaitAmp * 0.9, ph = pose.gaitPhase;
  const limpK = pose.limp ? 1 - 0.5 * pose.limp : 1;
  ctx.globalAlpha = 0.7;
  const f1 = { x: hipFX + Math.sin(ph) * amp, y: -Math.max(0, Math.cos(ph)) * amp * 0.4 };
  const b1 = { x: hipBX + Math.sin(ph + Math.PI) * amp * limpK, y: -Math.max(0, Math.cos(ph + Math.PI)) * amp * 0.4 * limpK };
  limbSeg(ctx, hipFX, hipY, f1.x, f1.y, legL * 0.52, legL * 0.52, -1, W * 0.11, P.dark, P.limb);
  limbSeg(ctx, hipBX, hipY, b1.x, b1.y, legL * 0.52, legL * 0.52, 1, W * 0.12, P.dark, P.limb);
  ctx.globalAlpha = 1;

  // --- tail ------------------------------------------------------------------
  if (q.tail > 0.1) {
    const segs = 5, segL = (H * q.tail) / segs;
    let ang = Math.PI + 0.5 - pose.tailRaise * 0.9;
    let x = -bodyL * 0.5, y = bodyY - bodyH * 0.1;
    ctx.strokeStyle = P.mid; ctx.lineCap = 'round';
    for (let s = 0; s < segs; s++) {
      ang += pose.tailCurl * 0.22 + pose.tailSway * 0.08 * Math.sin(s);
      const nx = x + Math.cos(ang) * segL, ny = y + Math.sin(ang) * segL;
      ctx.lineWidth = Math.max(1.5, (1 - s / segs) * W * 0.10);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      x = nx; y = ny;
    }
  }

  // --- torso -------------------------------------------------------------------
  ctx.fillStyle = vgrad(ctx, bodyY - bodyH * 0.6, bodyY + bodyH * 0.6, P.top, P.belly);
  ctx.beginPath();
  ctx.ellipse(0, bodyY, (bodyL / 2) * breathe, bodyH * 0.62, pose.spineLean * 0.4, 0, Math.PI * 2);
  ctx.fill();
  if (q.hump) { // bear shoulders
    ctx.fillStyle = vgrad(ctx, bodyY - bodyH, bodyY, P.top, P.mid);
    ctx.beginPath(); ctx.ellipse(bodyL * 0.22, bodyY - bodyH * 0.42, bodyL * 0.20, bodyH * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  }
  // coat pattern whisper + fur + rim
  furStrokes(ctx, id, 0, bodyY, bodyL * 0.45, bodyH * 0.5, Math.PI + pose.spineLean * 0.4, 26 + Math.round(d.fur * 30), 4.5, P.pale, P.dark, 900);
  rimArc(ctx, 0, bodyY, bodyL * 0.48, bodyH * 0.60, pose.spineLean * 0.4, P.pale, 0.4, 1.6);

  // --- near-side legs ------------------------------------------------------------
  const f2 = { x: hipFX + Math.sin(ph + Math.PI) * amp * limpK, y: -Math.max(0, Math.cos(ph + Math.PI)) * amp * 0.4 * limpK };
  const b2 = { x: hipBX + Math.sin(ph) * amp, y: -Math.max(0, Math.cos(ph)) * amp * 0.4 };
  limbSeg(ctx, hipFX + W * 0.03, hipY, f2.x, f2.y, legL * 0.52, legL * 0.52, -1, W * 0.12, P.dark, P.limb);
  limbSeg(ctx, hipBX - W * 0.03, hipY, b2.x, b2.y, legL * 0.52, legL * 0.52, 1, W * 0.13, P.dark, P.limb);
  // paws
  ctx.fillStyle = P.dark;
  for (const f of [f2, b2]) {
    ctx.beginPath(); ctx.ellipse(f.x + 1.5, f.y - 1, W * 0.09, W * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  }

  // --- head ----------------------------------------------------------------------
  const headR = H * q.headR;
  const hx = bodyL * 0.5 + H * q.neck, hy = bodyY - bodyH * 0.35 + pose.headPitch * headR * 0.9 - crouch * H * 0.05;
  ctx.fillStyle = vgrad(ctx, hy - headR, hy + headR, P.head, P.belly);
  ctx.beginPath(); ctx.arc(hx, hy, headR, 0, Math.PI * 2); ctx.fill();
  // ears
  const earBack = pose.earBack;
  ctx.fillStyle = P.head;
  if (q.ear === 'feline') {
    const es = headR * (0.9 + 0.3 * d.earScale);
    for (const s of [-1, 1]) {
      ctx.save(); ctx.translate(hx - headR * 0.25, hy - headR * 0.72); ctx.rotate(s * 0.5 - earBack * 0.9);
      ctx.beginPath();
      ctx.moveTo(-es * 0.42, 0); ctx.lineTo(0, -es * 0.95); ctx.lineTo(es * 0.42, 0);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
  } else {
    ctx.beginPath(); ctx.arc(hx - headR * 0.55, hy - headR * 0.75 + earBack * headR * 0.3, headR * 0.34 * d.earScale, 0, Math.PI * 2); ctx.fill();
  }
  furStrokes(ctx, id, hx, hy, headR * 0.8, headR * 0.8, 0.4, 10, 3, P.pale, P.dark, 950);
  // muzzle + nose
  const mzx = hx + headR * (q.snout === 'point' ? 0.72 : 0.55), mzy = hy + headR * 0.30;
  const mrx = headR * (q.snout === 'point' ? 0.55 : 0.42) * (0.7 + 0.5 * d.mouthSize);
  ctx.fillStyle = P.belly; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.ellipse(mzx, mzy, mrx, headR * 0.30, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1e150e';
  ctx.beginPath(); ctx.arc(mzx + mrx * 0.55, mzy - headR * 0.12, Math.max(0.9, headR * 0.10), 0, Math.PI * 2); ctx.fill();
  // eye + brow (fear flattens ears, widens eye — same readout, feline face)
  drawEye(ctx, hx + headR * 0.30, hy - headR * 0.12, headR * (0.20 + 0.10 * d.eyeSize), pose.eyeOpenNow);
  if (pose.browDrop > 0.15) {
    ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, headR * 0.08); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx + headR * 0.05, hy - headR * 0.42);
    ctx.lineTo(hx + headR * 0.55, hy - headR * 0.42 + pose.browDrop * headR * 0.25);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // mouth
  const mo = pose.mouthOpen;
  ctx.strokeStyle = '#1e150e'; ctx.lineWidth = Math.max(1, headR * 0.07); ctx.lineCap = 'round';
  if (mo > 0.25) {
    ctx.fillStyle = '#3a1f16';
    ctx.beginPath(); ctx.ellipse(mzx + mrx * 0.1, mzy + headR * 0.22, mrx * 0.45 * mo, headR * 0.20 * mo, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(mzx - mrx * 0.4, mzy + headR * 0.18); ctx.lineTo(mzx + mrx * 0.4, mzy + headR * 0.16); ctx.stroke();
  }
  rimArc(ctx, hx, hy, headR * 0.96, headR * 0.96, 0, P.pale, 0.35, 1.4);
}

// --- BIRD ----------------------------------------------------------------------
// skimmer (frugivore flyer), vulture (obligate soarer). Wings fold when
// perched, spread in glide/flight; the vulture's head is bare, its beak hooked.
const BIRD = {
  'skimmer': { wing: 1.05, beak: 'straight', bare: false, tailFan: 0.5, bulk: 0.9 },
  'vulture': { wing: 1.45, beak: 'hooked', bare: true, tailFan: 0.85, bulk: 1.15 },
};

function drawBird(ctx, d, pose, id, b) {
  const H = d.heightPx, W = d.widthPx;
  const P = palette(d);
  const flying = pose.glide || pose.gaitAmp > H * 0.02;
  const bodyL = H * 0.30 * b.bulk, bodyH = H * 0.13 * b.bulk;
  const bodyY = -H * 0.16 + pose.crouch * H * 0.06;
  const flap = Math.sin(pose.gaitPhase);

  // --- tail fan: filled feather quads ------------------------------------------------
  const tx = -bodyL * 0.5, ty = bodyY + bodyH * 0.1;
  const fan = 3 + Math.round(b.tailFan * 3);
  ctx.fillStyle = P.dark;
  for (let i = 0; i < fan; i++) {
    const a = Math.PI + 0.22 + (i / (fan - 1) - 0.5) * b.tailFan * 1.0 + pose.tailSway * 0.05;
    const tl = H * 0.15 * (0.8 + 0.4 * b.tailFan);
    const ex = tx + Math.cos(a) * tl, ey = ty + Math.sin(a) * tl;
    const px2 = -Math.sin(a), py2 = Math.cos(a); // perpendicular
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(ex + px2 * H * 0.018, ey + py2 * H * 0.018);
    ctx.lineTo(ex - px2 * H * 0.018, ey - py2 * H * 0.018);
    ctx.closePath(); ctx.fill();
  }

  // --- body ----------------------------------------------------------------------------
  ctx.fillStyle = vgrad(ctx, bodyY - bodyH, bodyY + bodyH, P.top, P.belly);
  ctx.beginPath(); ctx.ellipse(0, bodyY, bodyL * 0.5, bodyH * 0.62, -0.12, 0, Math.PI * 2); ctx.fill();
  furStrokes(ctx, id, 0, bodyY, bodyL * 0.45, bodyH * 0.5, Math.PI * 0.9, 20, 4, P.pale, P.dark, 960);

  // --- wings: FILLED, broad, fingered primaries -------------------------------------------
  const shX = 0, shY = bodyY - bodyH * 0.5;
  const wingL = H * 0.34 * b.wing;
  const wingShape = (alpha, flapA) => {
    // local frame: shoulder at origin, wing extends +x; rotate by flapA
    ctx.save();
    ctx.translate(shX, shY); ctx.rotate(flapA);
    ctx.globalAlpha = alpha;
    const wg = ctx.createLinearGradient(0, -wingL * 0.2, 0, wingL * 0.25);
    wg.addColorStop(0, P.mid); wg.addColorStop(1, P.dark);
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(wingL * 0.92, -wingL * 0.10); // leading edge to the tip
    for (let f = 0; f < 4; f++) {           // primary notches
      const t0 = 0.92 - f * 0.20, t1 = 0.92 - (f + 0.55) * 0.20;
      ctx.lineTo(wingL * t0, wingL * (0.14 - f * 0.012));
      ctx.lineTo(wingL * t1, wingL * 0.075);
    }
    ctx.lineTo(wingL * 0.08, wingL * 0.13);  // trailing edge home
    ctx.closePath(); ctx.fill();
    // covert seams
    ctx.strokeStyle = P.dark; ctx.globalAlpha = alpha * 0.6; ctx.lineWidth = Math.max(1, W * 0.03);
    for (let f = 0; f < 3; f++) {
      const t = 0.30 + f * 0.22;
      ctx.beginPath(); ctx.moveTo(wingL * t, -wingL * 0.05); ctx.lineTo(wingL * t, wingL * 0.11); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  if (flying) {
    const beat = pose.glide ? -0.10 + Math.sin(pose.gaitPhase * 0.3) * 0.06 : -0.15 + flap * 0.55;
    wingShape(0.6, beat + 0.12);   // far wing, slightly lagged
    // head below, then near wing over
    const headR = H * 0.085;
    const hx = bodyL * 0.5 + headR * 0.7, hy = bodyY - bodyH * 0.9 + pose.headPitch * headR;
    const headCol = b.bare ? hslRgb(P.coatH, 16, 60) : P.head;
    ctx.fillStyle = headCol;
    ctx.beginPath(); ctx.arc(hx, hy, headR, 0, Math.PI * 2); ctx.fill();
    drawBeak(ctx, b, hx, hy, headR, pose);
    drawEye(ctx, hx + headR * 0.15, hy - headR * 0.15, headR * 0.30, pose.eyeOpenNow);
    wingShape(1, beat);            // near wing
  } else {
    // folded: a layered teardrop lying along the body
    const fx = shX + wingL * 0.12, fy = shY + wingL * 0.10;
    const fg = ctx.createLinearGradient(fx - wingL * 0.3, fy - wingL * 0.15, fx + wingL * 0.3, fy + wingL * 0.1);
    fg.addColorStop(0, P.top); fg.addColorStop(1, P.dark);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(shX + wingL * 0.05, shY - wingL * 0.02);
    ctx.quadraticCurveTo(shX + wingL * 0.55, shY - wingL * 0.10, shX + wingL * 0.92, shY + wingL * 0.10);
    ctx.quadraticCurveTo(shX + wingL * 0.50, shY + wingL * 0.22, shX + wingL * 0.05, shY + wingL * 0.10);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, W * 0.03);
    for (let f = 0; f < 3; f++) {
      const t = 0.3 + f * 0.22;
      ctx.beginPath();
      ctx.moveTo(shX + wingL * t, shY - wingL * 0.06 + f * wingL * 0.02);
      ctx.lineTo(shX + wingL * t, shY + wingL * 0.14 - f * wingL * 0.01);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const headR = H * 0.085;
    const hx = bodyL * 0.5 + headR * 0.7, hy = bodyY - bodyH * 0.9 + pose.headPitch * headR;
    const headCol = b.bare ? hslRgb(P.coatH, 16, 60) : P.head;
    ctx.fillStyle = headCol;
    ctx.beginPath(); ctx.arc(hx, hy, headR, 0, Math.PI * 2); ctx.fill();
    drawBeak(ctx, b, hx, hy, headR, pose);
    drawEye(ctx, hx + headR * 0.15, hy - headR * 0.15, headR * 0.30, pose.eyeOpenNow);
    // legs: thin nubs
    ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(1.5, W * 0.06); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-W * 0.02, bodyY + bodyH * 0.4); ctx.lineTo(-W * 0.02, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.08, bodyY + bodyH * 0.4); ctx.lineTo(W * 0.08, 0); ctx.stroke();
  }
  rimArc(ctx, 0, bodyY, bodyL * 0.48, bodyH * 0.60, -0.12, P.pale, 0.35, 1.4);
}

// the beak: straight (skimmer) or hooked (vulture), gape with mouthOpen
function drawBeak(ctx, b, hx, hy, headR, pose) {
  ctx.fillStyle = b.bare ? '#3a2c1c' : '#241c12';
  const bl = headR * 1.25;
  ctx.beginPath();
  if (b.beak === 'hooked') {
    ctx.moveTo(hx + headR * 0.65, hy - headR * 0.30);
    ctx.quadraticCurveTo(hx + headR * 0.65 + bl, hy - headR * 0.05, hx + headR * 0.55 + bl * 0.52, hy + headR * 0.62);
    ctx.quadraticCurveTo(hx + headR * 0.75, hy + headR * 0.12, hx + headR * 0.65, hy - headR * 0.30);
  } else {
    ctx.moveTo(hx + headR * 0.65, hy - headR * 0.32);
    ctx.lineTo(hx + headR * 0.65 + bl, hy + headR * 0.02);
    ctx.lineTo(hx + headR * 0.65, hy + headR * 0.36);
  }
  ctx.closePath(); ctx.fill();
  if (pose.mouthOpen > 0.3) {
    ctx.strokeStyle = '#140e08'; ctx.lineWidth = Math.max(1, headR * 0.09); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx + headR * 0.70, hy + headR * 0.08);
    ctx.lineTo(hx + headR * 0.65 + bl * 0.72, hy + headR * (b.beak === 'hooked' ? 0.55 : 0.30));
    ctx.stroke();
  }
}

// --- BEETLE ----------------------------------------------------------------------
// beetle (pollinator), beetle-detritivore (midden cleaner). Elytra with a
// center split, six legs in tripod gait, questing antennae.
function drawBeetle(ctx, d, pose, id, detrit) {
  const H = d.heightPx, W = d.widthPx;
  const P = palette(d);
  const bulk = detrit ? 1.22 : 1.0;
  const bodyL = H * 0.30 * bulk, bodyH = H * 0.17 * bulk;
  const bodyY = -H * 0.10 + pose.crouch * H * 0.05;

  // legs: 3 pairs, tripod gait
  const amp = pose.gaitAmp * 0.8, ph = pose.gaitPhase;
  ctx.lineCap = 'round';
  for (const side of [0.65, 1]) {
    for (let p = 0; p < 3; p++) {
      const lx = (p - 1) * bodyL * 0.28;
      const tripod = (p % 2 === 0) ? 0 : Math.PI;
      const fx = lx + Math.sin(ph + tripod) * amp, fy = -Math.max(0, Math.cos(ph + tripod)) * amp * 0.5;
      ctx.globalAlpha = side;
      ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(1.2, W * 0.045);
      const kx = (lx + fx) / 2, ky = Math.min(bodyY, fy) - H * 0.03;
      ctx.beginPath(); ctx.moveTo(lx, bodyY + bodyH * 0.2); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // elytra: domed wing-cases with the center split
  const dome = vgrad(ctx, bodyY - bodyH, bodyY + bodyH * 0.6, detrit ? P.dark : P.mid, P.dark);
  ctx.fillStyle = dome;
  ctx.beginPath(); ctx.ellipse(0, bodyY, bodyL * 0.5, bodyH * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0d0a06'; ctx.lineWidth = Math.max(1, W * 0.03);
  ctx.beginPath(); ctx.moveTo(0, bodyY - bodyH * 0.58); ctx.lineTo(0, bodyY + bodyH * 0.55); ctx.stroke();
  // dome highlight
  ctx.fillStyle = P.pale; ctx.globalAlpha = 0.28;
  ctx.beginPath(); ctx.ellipse(-bodyL * 0.12, bodyY - bodyH * 0.28, bodyL * 0.16, bodyH * 0.20, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // speckle from the genome pattern
  if (d.pattern === 'spots') {
    ctx.fillStyle = P.mark; ctx.globalAlpha = 0.5;
    const n = 3 + Math.round(d.patternDensity * 5);
    for (let i = 0; i < n; i++) {
      const sx = (h4(id, 700 + i, 7) - 0.5) * bodyL * 0.7;
      const sy = bodyY + (h4(id, 710 + i, 7) - 0.5) * bodyH * 0.7;
      ctx.beginPath(); ctx.arc(sx, sy, 1 + h4(id, 720 + i, 7) * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // head + antennae
  const hr = H * 0.055;
  const hx = bodyL * 0.52, hy = bodyY + bodyH * 0.05;
  ctx.fillStyle = P.dark;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(1, W * 0.03);
  for (const s of [-1, 1]) {
    const wave = Math.sin(pose.gaitPhase * 0.7 + s * 2 + id) * H * 0.012;
    ctx.beginPath();
    ctx.moveTo(hx + hr * 0.6, hy + s * hr * 0.4);
    ctx.quadraticCurveTo(hx + hr * 1.8, hy + s * hr * 1.2 + wave, hx + hr * 2.6, hy + s * hr * 0.6 + wave * 2);
    ctx.stroke();
  }
  drawEye(ctx, hx + hr * 0.3, hy - hr * 0.25, hr * 0.42, pose.eyeOpenNow);
}

// --- FLUTTER (butterfly) -----------------------------------------------------------
// Soft prey, pollinator. Two big wing pairs held up like a resting
// butterfly, flapping — always readable from the side.
function drawFlutter(ctx, d, pose, id) {
  const H = d.heightPx;
  const P = palette(d);
  const flap = Math.sin(pose.gaitPhase * 2.5 + id); // -1..1
  const bodyY = -H * 0.10;
  // wings stay up: 0.35 (low) … 1.15 (straight up)
  const wingAng = 0.35 + (flap * 0.5 + 0.5) * 0.80;

  const rootX = 0, rootY = bodyY - H * 0.03;
  // body FIRST: a readable thorax + segmented abdomen + head, so the wings
  // have something to attach to — the old draw order and oversized wings
  // left a pink blob with floating spots.
  ctx.fillStyle = vgrad(ctx, bodyY - H * 0.05, bodyY + H * 0.05, P.dark, P.mid);
  ctx.beginPath(); ctx.ellipse(H * 0.02, bodyY, H * 0.11, H * 0.048, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, H * 0.008); ctx.lineCap = 'round';
  for (let sgm = 0; sgm < 3; sgm++) { // abdomen segments
    const ax = H * (0.02 - 0.055 - sgm * 0.05);
    ctx.beginPath(); ctx.moveTo(ax, bodyY - H * 0.038); ctx.lineTo(ax, bodyY + H * 0.038); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // head + feathery antennae
  ctx.fillStyle = P.dark;
  ctx.beginPath(); ctx.arc(H * 0.125, bodyY - H * 0.012, H * 0.030, 0, Math.PI * 2); ctx.fill();
  drawEye(ctx, H * 0.135, bodyY - H * 0.020, H * 0.016, pose.eyeOpenNow);
  ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(1, H * 0.007); ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(H * 0.14, bodyY - H * 0.02);
    ctx.quadraticCurveTo(H * 0.18, bodyY - H * 0.08, H * 0.21, bodyY - H * 0.11 + s * H * 0.014);
    ctx.stroke();
    ctx.fillStyle = P.dark; // antennal club
    ctx.beginPath(); ctx.arc(H * 0.21, bodyY - H * 0.11 + s * H * 0.014, H * 0.010, 0, Math.PI * 2); ctx.fill();
  }
  // wings: dainty, rooted AT the thorax (inner edge overlaps the body),
  // spots well inside the wing — never floating beyond it. A thin dark
  // rim separates wing from sky.
  for (const s of [0.5, 1]) { // far pair, near pair
    ctx.globalAlpha = s;
    const pairs = [
      { wr: H * 0.20, off: 0.00 },  // forewing
      { wr: H * 0.13, off: 0.55 },  // hindwing
    ];
    for (const { wr, off } of pairs) {
      const wa = wingAng + off;
      const dx = Math.cos(wa), dy = -Math.sin(wa);
      const cx = rootX + dx * wr * 0.55, cy = rootY + dy * wr * 0.55;
      const wg = ctx.createLinearGradient(rootX, rootY, cx + dx * wr * 0.4, cy + dy * wr * 0.4);
      wg.addColorStop(0, P.mid); wg.addColorStop(0.6, P.pale); wg.addColorStop(1, P.pale);
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, wr, wr * 0.62, -wa, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = P.dark; ctx.globalAlpha = s * 0.45; ctx.lineWidth = Math.max(1, H * 0.008);
      ctx.beginPath(); ctx.ellipse(cx, cy, wr, wr * 0.62, -wa, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = s;
      ctx.fillStyle = P.mark; ctx.globalAlpha = s * 0.8; // wing spot, inside the wing
      ctx.beginPath();
      ctx.arc(rootX + dx * wr * 0.95, rootY + dy * wr * 0.95, wr * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = s;
    }
  }
  ctx.globalAlpha = 1;
}

function drawGrub(ctx, d, pose, id) {
  const H = d.heightPx, W = d.widthPx;
  const P = palette(d);
  const n = 6;
  const segL = H * 0.075;
  const curve = 0.25 + pose.crouch * 0.3;
  let x = -segL * n * 0.42, y = -H * 0.06;
  let ang = curve * 0.5;
  for (let s = 0; s < n; s++) {
    const peri = 1 + Math.sin(pose.gaitPhase - s * 0.9) * 0.10; // peristalsis
    const r = H * (0.075 - s * 0.006) * peri;
    ang += curve * 0.16;
    x += Math.cos(ang) * segL; y += Math.sin(ang) * segL * 0.6 - H * 0.004;
    ctx.fillStyle = vgrad(ctx, y - r, y + r, P.mid, P.dark);
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.25, r, ang * 0.3, 0, Math.PI * 2); ctx.fill();
    if (s > 0 && s < 4) { // segment creases
      ctx.strokeStyle = P.dark; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - r * 0.4, y - r * 0.8); ctx.lineTo(x - r * 0.2, y + r * 0.8); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // head capsule
  const hx = x + Math.cos(ang) * segL * 0.9, hy = y + Math.sin(ang) * segL * 0.4;
  ctx.fillStyle = P.dark;
  ctx.beginPath(); ctx.arc(hx, hy, H * 0.045, 0, Math.PI * 2); ctx.fill();
  drawEye(ctx, hx + H * 0.015, hy - H * 0.015, H * 0.022, pose.eyeOpenNow);
  // nub legs
  ctx.strokeStyle = P.dark; ctx.lineWidth = Math.max(1, W * 0.04); ctx.lineCap = 'round';
  for (let p = 0; p < 3; p++) {
    const lx = -segL * n * 0.42 + segL * (1.5 + p * 1.2);
    ctx.beginPath(); ctx.moveTo(lx, -H * 0.045); ctx.lineTo(lx + H * 0.008, 0); ctx.stroke();
  }
  furStrokes(ctx, id, 0, -H * 0.06, segL * n * 0.4, H * 0.06, 0.2, 12, 2.5, P.pale, P.dark, 970);
}

// --- sleep: the curled rest, per body plan ------------------------------------------
function sleepBlob(ctx, d, P, H, W, kind) {
  const R = H * (kind === 'bird' ? 0.20 : kind === 'insect' ? 0.16 : 0.22);
  const breathe = 1 + (d.pose ? d.pose.breath * 0.04 : 0);
  ctx.fillStyle = vgrad(ctx, -R * 2.2, -R * 0.4, P.top, P.belly);
  ctx.beginPath(); ctx.ellipse(0, -R * 1.2, R * 1.05 * breathe, R * 0.85, 0.15, 0, Math.PI * 2); ctx.fill();
  if (kind === 'bird') { // head tucked under the wing hint
    ctx.fillStyle = P.dark; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(-R * 0.3, -R * 1.35, R * 0.55, R * 0.35, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = P.head;
    ctx.beginPath(); ctx.arc(R * 0.45, -R * 1.5, R * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  furStrokes(ctx, d.creatureId || 0, 0, -R * 1.2, R, R * 0.8, 0.3, 16, 3.5, P.pale, P.dark, 980);
  rimArc(ctx, 0, -R * 1.2, R * 1.0, R * 0.82, 0.15, P.pale, 0.3, 1.4);
}

// --- dispatcher ------------------------------------------------------------------------
export function drawSpeciesBody(ctx, oc, px, py, scale) {
  const d = oc.drawing;
  const pose = d.pose || neutralPose();
  const id = d.creatureId || 0;
  const H = d.heightPx, W = d.widthPx;
  ctx.save();
  ctx.translate(px(oc.x), py(oc.y));
  ctx.scale(scale * (oc.facing >= 0 ? 1 : -1), scale);

  const sp = oc.species;
  const kind =
    sp === 'skimmer' || sp === 'vulture' ? 'bird' :
    sp === 'beetle' || sp === 'beetle-detritivore' ? 'insect' :
    sp === 'flutter' ? 'flutter' : sp === 'grub' ? 'grub' : 'quad';

  if (pose.curled > 0.5) {
    sleepBlob(ctx, { ...d, pose }, palette(d), H, W, kind);
    ctx.restore();
    return;
  }

  if (sp === 'skimmer' || sp === 'vulture') drawBird(ctx, d, pose, id, BIRD[sp]);
  else if (sp === 'beetle') drawBeetle(ctx, d, pose, id, false);
  else if (sp === 'beetle-detritivore') drawBeetle(ctx, d, pose, id, true);
  else if (sp === 'flutter') drawFlutter(ctx, d, pose, id);
  else if (sp === 'grub') drawGrub(ctx, d, pose, id);
  else drawQuadruped(ctx, d, pose, id, QUAD[sp] || QUAD['scurrier']);

  ctx.restore();
}

// Shared art helpers, exported for the tanglekin's shading upgrade in render.js.
export const artHelpers = { palette, vgrad, limbSeg, furStrokes, rimArc, drawEye, ik2, h4, hslRgb, clamp01 };
