// Canvas renderer: sky, parallax hills, platforms, plants, food, eggs,
// toys, creatures. Camera fits the whole terrarium.

import { drawCreature, drawTeacher, drawBiomeBands, drawWater, drawWaters, drawPredator } from './painter.js';
import { creatureRadius } from '../sim/creature.js';
import { ageStage } from '../sim/biochem.js';
import { timeOfDay, ZONES } from '../sim/world.js';

// v0.18 "Realms": the biome data module (../sim/biomes.js) is landed by the
// sim agents. Load it lazily and degrade gracefully — worlds without it keep
// the legacy ZONES washes. In the single-file dist bundle its exports live
// as top-level bindings, detected here without an import. Call biomesReady()
// and await it before asserting anything about water/biomes.
let _biomes = null;
let _biomesPromise = null;
function bundledBiomes() {
  try {
    if (typeof waterRects === 'function' && typeof biomeKeyAt === 'function') {
      return { waterRects, biomeKeyAt, WORLD_W, WORLD_H };
    }
  } catch (e) { /* names not in scope — not the bundle */ }
  return null;
}
export function biomesReady() {
  if (!_biomesPromise) {
    _biomesPromise = (async () => {
      const b = bundledBiomes();
      if (b) return (_biomes = b);
      try {
        _biomes = await import('../sim/biomes.js');
      } catch (e) {
        _biomes = null; // not landed yet — render the world without biomes
      }
      return _biomes;
    })();
  }
  return _biomesPromise;
}
biomesReady(); // warm the cache at module load; render() reads the result
function biomes() { return _biomes; }

export function createRenderer(canvas) {
  const r = {
    canvas,
    ctx: canvas.getContext('2d'),
    scale: 1, ox: 0, oy: 0, dpr: 1,
    stars: [],
    // v0.14.2 "Wayfinding": the camera. fitScale is the auto-fit zoom;
    // the user zoom is scale/fitScale, clamped. cam.manual false means the
    // camera auto-fits every frame (the v0.14 behavior); any manual move
    // flips it on and the render loop stops overriding it.
    fitScale: 0,
    cam: { manual: false },
  };
  // Deterministic starfield.
  let a = 1234567;
  const rnd = () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; };
  for (let i = 0; i < 140; i++) r.stars.push({ x: rnd(), y: rnd() * 0.6, s: rnd() });
  resize(r);
  window.addEventListener('resize', () => resize(r));
  return r;
}

function resize(r) {
  r.dpr = Math.min(2, window.devicePixelRatio || 1);
  r.canvas.width = r.canvas.clientWidth * r.dpr;
  r.canvas.height = r.canvas.clientHeight * r.dpr;
  // A resize re-fits the world — the stored manual framing no longer matches.
  r.cam.manual = false;
  r.fitScale = 0;
}

export function worldToScreen(r, world, x, y) {
  return { x: x * r.scale + r.ox, y: y * r.scale + r.oy };
}

export function screenToWorld(r, sx, sy) {
  return { x: (sx - r.ox) / r.scale, y: (sy - r.oy) / r.scale };
}

// v0.14.2 "Wayfinding": camera limits. Zoom is relative to the fitted
// scale; pan is clamped so at least CAM_PAN_MARGIN device px of the world
// stay visible — the world can never be lost off-screen.
export const CAM_MIN_ZOOM = 0.45;
export const CAM_MAX_ZOOM = 4.5;
export const CAM_PAN_MARGIN = 300;

export function fitCamera(r, world) {
  const w = r.canvas.width, h = r.canvas.height;
  r.scale = Math.min(w / world.width, h / (world.height * 0.92)) * r.dpr;
  r.ox = (w - world.width * r.scale) / 2;
  r.oy = h - world.groundY * r.scale - 8 * r.dpr;
  r.fitScale = r.scale;
}

// Keep the world findable: clamp the offset so the world rect always
// overlaps the viewport by at least CAM_PAN_MARGIN px on each axis.
export function clampPan(r, world) {
  const W = r.canvas.width, H = r.canvas.height;
  const ww = world.width * r.scale, wh = world.height * r.scale;
  const m = CAM_PAN_MARGIN;
  r.ox = Math.min(W - m, Math.max(m - ww, r.ox));
  r.oy = Math.min(H - m, Math.max(m - wh, r.oy));
}

// Zoom centered on a screen point (device px): the world point under the
// cursor stays under the cursor. factor > 1 zooms in.
export function zoomAt(r, world, factor, cx, cy) {
  if (!(r.fitScale > 0)) fitCamera(r, world);
  const before = screenToWorld(r, cx, cy);
  const z = Math.min(CAM_MAX_ZOOM, Math.max(CAM_MIN_ZOOM, (r.scale / r.fitScale) * factor));
  r.scale = r.fitScale * z;
  r.ox = cx - before.x * r.scale;
  r.oy = cy - before.y * r.scale;
  r.cam.manual = true;
  clampPan(r, world);
}

// Pan by a screen delta (device px).
export function panBy(r, world, dx, dy) {
  if (!(r.fitScale > 0)) fitCamera(r, world);
  r.ox += dx;
  r.oy += dy;
  r.cam.manual = true;
  clampPan(r, world);
}

// Back to the full-world framing.
export function recenterCamera(r, world) {
  r.cam.manual = false;
  fitCamera(r, world);
}

// Center the camera on a world point, keeping the current zoom.
// Used by follow-the-selected-creature. The point is clamped to the world
// rect — v0.18's 4800×1100 world is followed the same way as the old one,
// via world.width/world.height, never hardcoded.
export function followPoint(r, world, x, y) {
  if (!(r.fitScale > 0)) fitCamera(r, world);
  x = Math.max(0, Math.min(world.width, x));
  y = Math.max(0, Math.min(world.height, y));
  r.ox = r.canvas.width / 2 - x * r.scale;
  r.oy = r.canvas.height / 2 - y * r.scale;
  r.cam.manual = true;
  clampPan(r, world);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0];
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

const SKY_DAY_TOP = [126, 199, 235], SKY_DAY_BOT = [236, 244, 220];
const SKY_NIGHT_TOP = [12, 16, 42], SKY_NIGHT_BOT = [38, 44, 84];

export function render(r, world, ui, t) {
  const { ctx, canvas } = r;
  // v0.14.2 "Wayfinding": auto-fit only until the player moves the camera.
  if (!r.cam.manual) fitCamera(r, world);
  const W = canvas.width, H = canvas.height;
  const light = world.light;
  const tod = timeOfDay(world);

  // Sky.
  const top = mix(SKY_NIGHT_TOP, SKY_DAY_TOP, light);
  const bot = mix(SKY_NIGHT_BOT, SKY_DAY_BOT, light);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(top));
  g.addColorStop(1, rgb(bot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Stars.
  if (light < 0.5) {
    ctx.fillStyle = '#fff';
    for (const s of r.stars) {
      ctx.globalAlpha = (0.5 - light) * 2 * (0.3 + s.s * 0.7);
      ctx.fillRect(s.x * W, s.y * H, s.s * 2.2 * r.dpr, s.s * 2.2 * r.dpr);
    }
    ctx.globalAlpha = 1;
  }

  // Sun / moon arc.
  const sunA = tod * Math.PI * 2 - Math.PI / 2; // noon at top
  const sunX = W / 2 - Math.cos(sunA) * W * 0.42;
  const sunY = H * 0.62 - Math.sin(sunA) * H * 0.5;
  const isDay = light > 0.45;
  ctx.fillStyle = isDay ? 'rgba(255,236,170,0.95)' : 'rgba(235,240,255,0.9)';
  ctx.beginPath();
  ctx.arc(sunX, sunY, (isDay ? 34 : 26) * r.dpr, 0, Math.PI * 2);
  ctx.fill();
  if (!isDay) { // moon shadow bite
    ctx.fillStyle = rgb(top);
    ctx.beginPath();
    ctx.arc(sunX - 10 * r.dpr, sunY - 6 * r.dpr, 22 * r.dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(r.ox, r.oy);
  ctx.scale(r.scale, r.scale);

  // Parallax hills (drawn in world space, behind platforms).
  drawHills(ctx, world, light, 0.35, [mix([60,70,110],[150,190,150],light), 560]);
  drawHills(ctx, world, light, 0.6, [mix([45,55,90],[120,175,130],light), 660]);

  // v0.18 "Realms": biome ground + water from the biomes module. Older
  // worlds (no biomes module yet) keep the legacy zone washes.
  const B = biomes();
  const waters = (B && typeof B.waterRects === 'function') ? B.waterRects() : [];
  if (B && typeof B.biomeKeyAt === 'function') {
    drawBiomeBands(ctx, world, B, light);
    drawWaters(ctx, B, world.height, light); // v0.20: one flowing sea, not three rects
  } else {
    // v0.11 biome tints: the zones are sim state (they set fruiting rates),
    // so painting them is honest. Subtle vertical washes + a name label.
    ctx.save();
    for (const z of ZONES) {
      ctx.fillStyle = z.tint;
      ctx.fillRect(z.x1, 0, z.x2 - z.x1, world.groundY + 80);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const z of ZONES) {
      ctx.fillText(z.name.toUpperCase(), (z.x1 + z.x2) / 2, world.groundY + 52);
    }
    ctx.restore();
  }

  // Platforms.
  for (const pl of world.platforms) {
    const pw = pl.x2 - pl.x1;
    if (pl.kind === 'floe') {
      // v0.18 "Realms": ice floes render as driftwood — weathered timber,
      // plank seams, no grass cap. A raft, not a branch.
      ctx.fillStyle = rgb(mix([58, 44, 32], [148, 112, 74], light));
      roundRect(ctx, pl.x1, pl.y, pw, 34, 10);
      ctx.fill();
      ctx.strokeStyle = rgb(mix([40, 30, 22], [110, 82, 54], light));
      ctx.lineWidth = 2;
      for (const fx of [0.25, 0.5, 0.75]) {
        ctx.beginPath();
        ctx.moveTo(pl.x1 + pw * fx, pl.y + 5);
        ctx.lineTo(pl.x1 + pw * fx, pl.y + 29);
        ctx.stroke();
      }
      continue;
    }
    ctx.fillStyle = rgb(mix([52, 44, 70], [139, 117, 82], light));
    roundRect(ctx, pl.x1, pl.y, pw, 60, 10);
    ctx.fill();
    ctx.fillStyle = rgb(mix([50, 80, 60], [106, 176, 105], light));
    roundRect(ctx, pl.x1 - 4, pl.y - 14, pw + 8, 22, 10);
    ctx.fill();
  }

  // Plants.
  for (const p of world.plants) { drawPlant(ctx, p, t, light); if (ui.selected === p) drawInspectRing(ctx, p.x, p.y - 40, 44, 52, t); }

  // Foods.
  for (const f of world.foods) { drawFood(ctx, f, t); if (ui.selected === f) drawInspectRing(ctx, f.x, f.y - 12, 20, 20, t); }

  // v0.7: visible culture — grove tradition rings on the ground.
  drawGroves(ctx, world, t);

  // v0.12: home-range ticks — each living creature's imprinted homeX, drawn
  // in its band's color. Honest: homeX is sim state, bands are detected.
  drawHomeTicks(ctx, world);

  // Eggs.
  for (const e of world.eggs) drawEgg(ctx, e, t, ui);

  // Toys.
  for (const toy of world.toys) drawBall(ctx, toy, t);

  // v0.9: pebbles — the world as material, not decoration.
  for (const pb of world.pebbles || []) {
    drawPebble(ctx, pb);
    if (ui.selected === pb) drawInspectRing(ctx, pb.x, pb.y - pb.r * 0.45, pb.r + 8, pb.r + 6, t);
  }

  // v0.20 "Hands": sticks — fallen branches, graspable timber.
  for (const st of world.sticks || []) {
    drawStick(ctx, st);
    if (ui.selected === st) drawInspectRing(ctx, st.x, st.y - 6, 20, 14, t);
  }

  // v0.17.1 "Touch": mineral deposits — crystals and clay seams, drawn from
  // the deposit's own color. Depleted deposits draw hollow (honest).
  for (const m of world.minerals || []) {
    drawMineral(ctx, m, t);
    if (ui.selected === m) drawInspectRing(ctx, m.x, m.y - 18, 30, 26, t);
  }

  // v0.22.2: the scripted critters are retired — their lineages are
  // creatures now (flutter, grub), drawn by the genome-driven painter.

  // v0.18 "Realms": predators — every agent of selection is visible.
  // Paul's v0.17-dev lesson: no phantom killers.
  for (const pr of world.predators || []) {
    drawPredator(ctx, pr, t, light);
    if (ui.selected === pr) drawInspectRing(ctx, pr.x, (pr.y || 0) - 20, 46, 36, t);
  }

  // Creatures (selected last, with ring).
  const sorted = [...world.creatures].sort((a, b) =>
    (ui.selected === a ? 1 : 0) - (ui.selected === b ? 1 : 0));
  for (const c of sorted) {
    const plat = world.platforms[c.platformIndex];
    // Physics: creatures have their own y now — the airborne draw mid-air.
    const cy = (c.y !== undefined && c.y !== null) ? c.y : plat.y;
    if (ui.selected === c) drawSelectionRing(ctx, c, cy, t);
    drawCreature(ctx, c, cy, t);
    // v0.18: underwater creatures get a blue tint overlay — you can see
    // at a glance who is swimming and who is drowning.
    if (waters.length && submergedRect(waters, c.x, cy)) {
      const cr2 = creatureRadius(c);
      ctx.fillStyle = 'rgba(50,120,190,0.28)';
      ctx.beginPath();
      ctx.ellipse(c.x, cy - cr2 * 0.9, cr2 * 1.15, cr2 * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawLabel(ctx, c, cy, ui);
  }

  // The Teacher — Sunny's visitor avatar (v0.14 "Voices"). Drawn after the
  // tanglekins: blue monkey, jaunty newsboy cap, unmistakably not one of them.
  if (world.teacher) {
    const te = world.teacher;
    const tplat = world.platforms[te.platformIndex];
    const ty = (te.y !== undefined && te.y !== null) ? te.y : tplat.y;
    if (ui.selected === te) {
      // the visitor's ring is gold, not white — a guest, not a tanglekin
      ctx.strokeStyle = 'rgba(255,215,110,0.95)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -t * 20;
      ctx.beginPath();
      ctx.ellipse(te.x, ty - 24, 34, 27, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawTeacher(ctx, te, ty, t);
    drawTeacherLabel(ctx, te, ty, ui);
  }

  // Hand-dragged ghost handled by UI overlay (DOM), skip here.

  ctx.restore();

  // Night tint.
  if (light < 0.6) {
    ctx.fillStyle = `rgba(8,10,38,${((0.6 - light) * 0.55).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function roundRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// v0.18 "Realms": which water body (if any) covers the point (x, y).
function submergedRect(waters, x, y) {
  for (const wr of waters) {
    if (x >= wr.x0 && x <= wr.x1 && y > wr.surfaceY) return wr;
  }
  return null;
}

function drawHills(ctx, world, light, parallax, [color, baseY]) {
  ctx.fillStyle = rgb(color);
  ctx.globalAlpha = parallax;
  ctx.beginPath();
  ctx.moveTo(-100, world.height);
  for (let x = -100; x <= world.width + 100; x += 40) {
    const y = baseY + Math.sin(x * 0.004 + parallax * 9) * 60 + Math.sin(x * 0.013) * 25;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(world.width + 100, world.height);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPlant(ctx, p, t, light) {
  // v0.18 "Realms": flora morphs from floraFor(biomeKey) — plants carry a
  // morph field. Unknown morphs fall through to the classic tree: the
  // painter never draws nothing.
  const morph = p.morph || 'tree';
  if (PLANT_MORPHS.has(morph)) { drawPlantMorph(ctx, p, t, light, morph); return; }
  const h = 40 + p.growth * 70;
  const sway = Math.sin(p.sway) * 8 * p.growth;
  // v0.8: herbs are violet where fruit plants are green — unmistakable.
  const herb = p.kind === 'herb';
  ctx.strokeStyle = herb
    ? rgb(mix([52, 40, 78], [96, 72, 148], light))
    : rgb(mix([40, 70, 50], [62, 140, 78], light));
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 6);
  ctx.quadraticCurveTo(p.x + sway * 0.4, p.y - h * 0.6, p.x + sway, p.y - h);
  ctx.stroke();
  // Leaves.
  ctx.fillStyle = herb
    ? rgb(mix([58, 44, 96], [128, 96, 190], light))
    : rgb(mix([45, 80, 55], [84, 168, 100], light));
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(p.x + s * 20 + sway * 0.5, p.y - h * 0.55, 20, 9, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fruits (or medicinal buds on herbs).
  if (p.growth >= 1) {
    ctx.fillStyle = herb ? '#9a6ee8' : '#e4574f';
    const fruits = 3;
    for (let i = 0; i < fruits; i++) {
      const fx = p.x + sway + Math.sin(i * 2.4 + p.sway) * 26;
      const fy = p.y - h + Math.cos(i * 1.7) * 14 - 6;
      ctx.beginPath();
      ctx.arc(fx, fy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(fx - 3, fy - 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = herb ? '#9a6ee8' : '#e4574f';
    }
  }
}

// v0.18 "Realms": per-morph plant bodies. p.x/p.y is the base (on the
// platform, or on the seabed for kelp); growth scales, sway moves.
const PLANT_MORPHS = new Set(['grass', 'cactus', 'shrub', 'moss', 'mangrove', 'palm', 'kelp']);

function drawPlantMorph(ctx, p, t, light, morph) {
  const herb = p.kind === 'herb';
  const s = 0.5 + 0.5 * (p.growth || 0);
  const sw = p.sway || 0;
  const sway = Math.sin(sw + t * 0.7) * 6 * s;
  const leaf = herb
    ? rgb(mix([58, 44, 96], [128, 96, 190], light))
    : rgb(mix([45, 80, 55], [84, 168, 100], light));
  const stem = herb
    ? rgb(mix([52, 40, 78], [96, 72, 148], light))
    : rgb(mix([40, 70, 50], [62, 140, 78], light));
  const x = p.x, y = p.y;
  ctx.lineCap = 'round';
  if (morph === 'grass') {
    // Tufts: a few curved blades.
    ctx.strokeStyle = leaf;
    ctx.lineWidth = 4;
    for (let i = -2; i <= 2; i++) {
      const bx = x + i * 7 * s;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.quadraticCurveTo(bx + sway * 0.5, y - 24 * s, bx + sway + i * 4, y - 40 * s);
      ctx.stroke();
    }
  } else if (morph === 'cactus') {
    // Ribbed column with small arms — the desert's water tower.
    const w = 26 * s, h = 96 * s;
    ctx.fillStyle = leaf;
    roundRect(ctx, x - w / 2, y - h, w, h, w / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (const fx of [-0.25, 0, 0.25]) {
      ctx.beginPath();
      ctx.moveTo(x + w * fx, y - 6);
      ctx.lineTo(x + w * fx, y - h + 10);
      ctx.stroke();
    }
    ctx.fillStyle = leaf;
    roundRect(ctx, x - w / 2 - 13 * s, y - h * 0.62, 13 * s, 30 * s, 6 * s);
    ctx.fill();
    roundRect(ctx, x + w / 2, y - h * 0.52, 13 * s, 26 * s, 6 * s);
    ctx.fill();
  } else if (morph === 'shrub') {
    // Low bush: a cluster of overlapping ellipses.
    ctx.fillStyle = leaf;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + sw;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 16 * s, y - 16 * s + Math.sin(a) * 8 * s,
        16 * s, 12 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (morph === 'moss') {
    // Low ground haze: a wide flat translucent smudge.
    ctx.fillStyle = leaf;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(x, y - 6 * s, 44 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (morph === 'mangrove') {
    // Prop roots arch down into the water; the canopy floats above it.
    ctx.strokeStyle = stem;
    ctx.lineWidth = 6;
    for (const sgn of [-1, 1]) for (const k of [0.4, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 44 * s);
      ctx.quadraticCurveTo(x + sgn * 18 * s * k, y - 18 * s, x + sgn * 34 * s * k, y + 6);
      ctx.stroke();
    }
    ctx.fillStyle = leaf;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + sw;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 26 * s + sway * 0.4, y - 92 * s + Math.sin(a) * 12 * s,
        24 * s, 16 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (morph === 'palm') {
    // Trunk + fronds.
    ctx.strokeStyle = rgb(mix([60, 48, 36], [130, 100, 66], light));
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + sway * 0.5, y - 70 * s, x + sway, y - 130 * s);
    ctx.stroke();
    const tx = x + sway, ty = y - 130 * s;
    ctx.strokeStyle = leaf;
    ctx.lineWidth = 5;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.15 - (i / 4) * Math.PI * 0.7;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 34 * s, ty + Math.sin(a) * 20 * s - 10,
        tx + Math.cos(a) * 58 * s, ty + Math.sin(a) * 34 * s + 8);
      ctx.stroke();
    }
  } else if (morph === 'kelp') {
    // Vertical wavy fronds rising from the seabed.
    ctx.strokeStyle = leaf;
    ctx.lineWidth = 7;
    for (let i = -1; i <= 1; i++) {
      const bx = x + i * 12 * s;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      for (let k = 1; k <= 4; k++) {
        const yy = y - k * 34 * s;
        const xx = bx + Math.sin(t * 1.3 + sw + k * 1.2 + i) * 10 * s;
        ctx.quadraticCurveTo(
          bx + Math.sin(t * 1.3 + sw + (k - 0.5) * 1.2 + i) * 10 * s,
          y - (k - 0.5) * 34 * s, xx, yy);
      }
      ctx.stroke();
    }
  }
}

function drawFood(ctx, f, t) {
  const bob = Math.sin(t * 3 + f.id) * 2;
  if (f.foodKind === 'fruit') {
    ctx.fillStyle = '#e4574f';
    ctx.beginPath();
    ctx.arc(f.x, f.y - 12 + bob, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4d8f5f';
    ctx.beginPath();
    ctx.ellipse(f.x + 4, f.y - 22 + bob, 6, 3, 0.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (f.foodKind === 'leaf') {
    // v0.8: medicinal leaves — violet, bitter, unmistakable.
    ctx.fillStyle = '#9a6ee8';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 10 + bob, 9, 6, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c4aef2';
    ctx.beginPath();
    ctx.ellipse(f.x - 2, f.y - 12 + bob, 4, 2.5, 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (f.foodKind === 'meat') {
    // v0.7: carcasses — dark red, unmistakable.
    ctx.fillStyle = '#8f2f2a';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 8 + bob * 0.5, 13, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c05a4a';
    ctx.beginPath();
    ctx.ellipse(f.x - 3, f.y - 10 + bob * 0.5, 6, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (f.foodKind === 'scrap') {
    // v0.14.1: scraps — fallen crumbs, brown and scattered.
    ctx.fillStyle = '#8a6f4d';
    ctx.beginPath();
    ctx.arc(f.x - 4, f.y - 6 + bob, 3.5, 0, Math.PI * 2);
    ctx.arc(f.x + 3, f.y - 4 + bob * 0.7, 2.8, 0, Math.PI * 2);
    ctx.arc(f.x, f.y - 9 + bob * 1.2, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (f.foodKind === 'minnow') {
    // v0.18: a small silver fish — washed up or provisioned.
    ctx.fillStyle = '#b9c8d4';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 10 + bob, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(f.x - 10, f.y - 10 + bob);
    ctx.lineTo(f.x - 16, f.y - 15 + bob);
    ctx.lineTo(f.x - 16, f.y - 5 + bob);
    ctx.closePath();
    ctx.fill();
  } else if (f.foodKind === 'bug') {
    // v0.18: a dark little beetle with legs.
    ctx.fillStyle = '#4a3f5a';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 8 + bob, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a3f5a';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(f.x - 3 + i * 3, f.y - 4 + bob);
      ctx.lineTo(f.x - 4 + i * 3, f.y + 2);
      ctx.stroke();
    }
  } else if (f.foodKind === 'corpse') {
    // v0.18: the small dead — a grey-brown lump.
    ctx.fillStyle = '#6e6259';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 7 + bob * 0.5, 12, 7, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8d8177';
    ctx.beginPath();
    ctx.ellipse(f.x - 3, f.y - 9 + bob * 0.5, 5, 3.5, 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#c9a86a';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 6 + bob, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// v0.7: grove traditions are visible — a faint ring where the culture says
// the eating is good. What the creatures know, the player can see.
function drawHomeTicks(ctx, world) {
  const tribes = world.tribes;
  if (!tribes || tribes.length === 0) return;
  const plat = world.platforms[0];
  const colorOf = new Map();
  for (const t of tribes) for (const id of t.members) colorOf.set(id, t.color);
  ctx.save();
  ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  for (const c of world.creatures) {
    if (!c.alive || c.homeX === undefined) continue;
    const col = colorOf.get(c.id) || '#ffffff';
    ctx.strokeStyle = hexA(col, 0.35);
    ctx.beginPath();
    ctx.moveTo(c.homeX, plat.y - 2);
    ctx.lineTo(c.homeX, plat.y - 14);
    ctx.stroke();
  }
  // Band labels at each band's home center.
  ctx.font = '600 13px system-ui, sans-serif';
  for (const t of tribes) {
    ctx.fillStyle = hexA(t.color, 0.55);
    ctx.fillText(`🪶 ${t.name}`, t.homeX, plat.y + 34);
  }
  ctx.restore();
}

// #rrggbb + alpha -> rgba() string.
function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawGroves(ctx, world, t) {
  const cu = world.culture;
  if (!cu || cu.traditions.length === 0) return;
  const plat = world.platforms[0];
  ctx.save();
  for (const tr of cu.traditions) {
    if (tr.kind !== 'grove') continue;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2 + tr.id);
    ctx.strokeStyle = `rgba(212,175,55,${0.25 + pulse * 0.2})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.ellipse(tr.x, plat.y - 30, tr.r, 26, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(212,175,55,${0.5 + pulse * 0.3})`;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`📜 ${tr.name} · ${tr.carriers.size}`, tr.x, plat.y - 62);
  }
  ctx.restore();
}

function drawEgg(ctx, e, t, ui) {
  ctx.save();
  ctx.translate(e.x, e.y);
  if (e.wobble > 0) ctx.rotate(Math.sin(t * 30) * 0.18 * e.wobble * 3);
  const hue = ((e.genome.alleles.bodyHue[0] + e.genome.alleles.bodyHue[1]) / 2) * 360;
  ctx.fillStyle = `hsl(${hue.toFixed(0)},55%,88%)`;
  ctx.beginPath();
  ctx.ellipse(0, -20, 17, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `hsl(${hue.toFixed(0)},45%,65%)`;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // Speckles from DNA.
  ctx.fillStyle = `hsl(${hue.toFixed(0)},60%,70%)`;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + e.id;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 8, -20 + Math.sin(a) * 11, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cracks when close to hatching.
  if (e.timer < 3) {
    ctx.strokeStyle = 'rgba(90,70,60,0.8)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, -34);
    ctx.lineTo(-2, -28); ctx.lineTo(-7, -22); ctx.lineTo(0, -16);
    ctx.stroke();
  }
  ctx.restore();
  if (ui.selected === e) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 20, 26, 30, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawBeacon(ctx, toy, t) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 4);
  ctx.save();
  ctx.translate(toy.x, toy.y - 30);
  ctx.rotate(Math.PI / 4);
  const s = 14 + 4 * pulse;
  ctx.fillStyle = `rgba(255, 200, 60, ${0.55 + 0.35 * pulse})`;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.strokeStyle = '#fff3c4';
  ctx.lineWidth = 2;
  ctx.strokeRect(-s / 2, -s / 2, s, s);
  ctx.restore();
}

function drawBall(ctx, toy, t) {
  // v0.8: the exam beacon renders as a pulsing diamond, not a ball — it's a
  // cue marker, not a plaything (though creatures may still investigate it).
  if (toy.kind === 'beacon') return drawBeacon(ctx, toy, t);
  ctx.save();
  ctx.translate(toy.x, toy.y - toy.r);
  ctx.rotate(toy.x * 0.05);
  ctx.fillStyle = '#f2f0e8';
  ctx.beginPath();
  ctx.arc(0, 0, toy.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d94f4f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, toy.r - 3, 0.3, Math.PI - 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, toy.r - 3, Math.PI + 0.3, Math.PI * 2 - 0.3);
  ctx.stroke();
  ctx.restore();
}

// v0.9: pebbles — irregular gray stones, deterministic per pebble.
function drawPebble(ctx, pb) {
  ctx.save();
  ctx.translate(pb.x, pb.y - pb.r * 0.45);
  const wob = Math.sin(pb.id * 3.7) * 0.16;
  ctx.rotate(wob);
  ctx.fillStyle = '#8d8b96';
  ctx.beginPath();
  ctx.ellipse(0, 0, pb.r, pb.r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a9a7b2';
  ctx.beginPath();
  ctx.ellipse(-pb.r * 0.2, -pb.r * 0.18, pb.r * 0.55, pb.r * 0.34, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// v0.20 "Hands": sticks — a fallen branch, drawn as a tapered timber segment.
// Deterministic angle from the stick id; the butt end is thicker.
function drawStick(ctx, st) {
  ctx.save();
  ctx.translate(st.x, st.y - 6);
  ctx.rotate(Math.sin(st.id * 5.3) * 0.5 - 0.2);
  const len = st.len || 34;
  ctx.fillStyle = '#6b4a2f';
  ctx.beginPath();
  ctx.moveTo(-len / 2, -3);
  ctx.lineTo(len / 2, -1.5);
  ctx.lineTo(len / 2, 1.5);
  ctx.lineTo(-len / 2, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7d5a3a';
  ctx.fillRect(-len / 2, -3, 4, 6); // cut end
  ctx.restore();
}

// v0.17.1 "Touch": mineral deposits. Three crystals (deterministic facets
// from the deposit id) in the deposit's own color; a depleted deposit draws
// as a hollow outline — the stone is gone, the claim marker remains.
function drawMineral(ctx, m, t) {
  const depleted = m.amount <= 0;
  ctx.save();
  ctx.translate(m.x, m.y);
  for (let i = 0; i < 3; i++) {
    const fx = (i - 1) * 13 + Math.sin(m.id * 2.1 + i) * 3;
    const fh = 26 + Math.sin(m.id * 3.3 + i * 1.7) * 6 - i * 3;
    const fw = 9 - i;
    ctx.beginPath();
    ctx.moveTo(fx - fw, 0);
    ctx.lineTo(fx - fw * 0.4, -fh);
    ctx.lineTo(fx + fw * 0.4, -fh);
    ctx.lineTo(fx + fw, 0);
    ctx.closePath();
    if (depleted) {
      ctx.strokeStyle = 'rgba(160,160,170,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.moveTo(fx - fw * 0.4, -fh);
      ctx.lineTo(fx, -fh - 4);
      ctx.lineTo(fx + fw * 0.1, -fh + 6);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// v0.17.1 "Touch": the observer's selection ring for non-creature entities
// (plants, foods, pebbles, minerals). Same dashed-white language as the
// creature ring, smaller — selection, not emphasis.
function drawInspectRing(ctx, x, y, rx, ry, t) {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.lineDashOffset = -t * 20;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// v0.22.2 — drawCritter retired with the scripted critters. The flutter and
// grub are full creatures now, drawn by the genome-driven painter (bodyHue
// 0.92 pink / 0.05 dark carry the old butterfly/bug's look).

function drawSelectionRing(ctx, c, groundY, t) {
  const r = creatureRadius(c) * 1.7;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 6]);
  ctx.lineDashOffset = -t * 20;
  ctx.beginPath();
  ctx.ellipse(c.x, groundY - r * 0.75, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTeacherLabel(ctx, te, groundY, ui) {
  if (ui.selected !== te && ui.hover !== te) return;
  const label = `🧑‍🏫 Sunny ${te.mode === 'possessed' ? '✋' : '🤖'} ${te.actionLabel ? '· ' + te.actionLabel : ''}`;
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(label).width + 18;
  const y = groundY - 20 * 2.35;
  ctx.fillStyle = 'rgba(20,28,60,0.78)';
  roundRect(ctx, te.x - w / 2, y - 20, w, 26, 13);
  ctx.fill();
  ctx.fillStyle = '#cfe3ff';
  ctx.fillText(label, te.x, y);
}

function drawLabel(ctx, c, groundY, ui) {
  if (ui.selected !== c && ui.hover !== c) return;
  const r = creatureRadius(c);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const label = `${c.name} ${c.actionLabel ? '· ' + c.actionLabel : ''}`;
  const w = ctx.measureText(label).width + 18;
  const y = groundY - r * 2.35;
  ctx.fillStyle = 'rgba(20,18,30,0.72)';
  roundRect(ctx, c.x - w / 2, y - 20, w, 26, 13);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, c.x, y);
}
