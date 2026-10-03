// Canvas renderer: sky, parallax hills, platforms, plants, food, eggs,
// toys, creatures. Camera fits the whole terrarium.

import { drawCreature, drawTeacher, drawBiomeBands, drawWater, drawWaters, drawPredator } from './painter.js';
import { creatureRadius } from '../sim/creature.js';
import { ageStage, mood } from '../sim/biochem.js';
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

  // Combo pass: layered atmosphere — gradient depth, sun bloom, god rays,
  // mist bands. The sky is no longer a flat wash.
  drawAtmosphere(ctx, r, W, H, light, t);

  // Stars.
  if (light < 0.5) {
    ctx.fillStyle = '#fff';
    for (const s of r.stars) {
      ctx.globalAlpha = (0.5 - light) * 2 * (0.3 + s.s * 0.7);
      ctx.fillRect(s.x * W, s.y * H, s.s * 2.2 * r.dpr, s.s * 2.2 * r.dpr);
    }
    ctx.globalAlpha = 1;
  }

  // Sun / moon arc, with a soft bloom halo.
  const sunA = tod * Math.PI * 2 - Math.PI / 2; // noon at top
  const sunX = W / 2 - Math.cos(sunA) * W * 0.42;
  const sunY = H * 0.62 - Math.sin(sunA) * H * 0.5;
  const isDay = light > 0.45;
  const sunR = (isDay ? 34 : 26) * r.dpr;
  ctx.fillStyle = isDay ? 'rgba(255,236,170,0.16)' : 'rgba(235,240,255,0.10)';
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = isDay ? 'rgba(255,236,170,0.95)' : 'rgba(235,240,255,0.9)';
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();
  if (!isDay) { // moon shadow bite
    ctx.fillStyle = rgb(mix(SKY_NIGHT_TOP, SKY_DAY_TOP, light));
    ctx.beginPath();
    ctx.arc(sunX - 10 * r.dpr, sunY - 6 * r.dpr, 22 * r.dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(r.ox, r.oy);
  ctx.scale(r.scale, r.scale);

  const B = biomes();

  // v0.18 "Realms": biome ground + water from the biomes module. Older
  // worlds (no biomes module yet) keep the legacy zone washes.
  const waters = (B && typeof B.waterRects === 'function') ? B.waterRects(world.layout) : [];
  if (B && typeof B.biomeKeyAt === 'function') {
    drawBiomeBands(ctx, world, B, light);
    drawWaters(ctx, B, world.height, light, world); // v0.20: one flowing sea, not three rects
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

  // Structural rethink (v0.38): the congruent world. Ground is ONE
  // continuous silhouette (not platform rectangles); trees are trunks with
  // branch limbs; cliffs are rock faces with ledges. The sim's platform
  // geometry is untouched — this is all presentation.
  const layout = world.layout;
  if (layout) {
    drawContinuousGround(ctx, r, world, B, light, t);
    // Trees behind branches; cliffs behind shelves.
    for (const tree of (layout.trees || [])) drawTreeTrunk(ctx, r, world, tree, t, light);
    for (const cliff of (layout.cliffs || [])) drawCliffFace(ctx, r, world, cliff, t, light);
  }
  // Platforms: 'ground' kind is covered by the continuous silhouette —
  // creatures still walk on its geometry, but we don't paint it twice.
  // 'rock'/'ridge' are solid masses: draw as grounded formations, not slabs.
  for (const pl of world.platforms) {
    if (pl.kind === 'floe') {
      drawDriftwood(ctx, pl, light);
      continue;
    }
    if (pl.kind === 'ground') continue;
    if (pl.kind === 'rock' || pl.kind === 'ridge') {
      drawRockFormation(ctx, r, world, pl, t, light);
      continue;
    }
    drawBranch(ctx, pl, t, light);
  }

  // Plants.
  for (const p of world.plants) { drawPlant(ctx, p, t, light, B, world); if (ui.selected === p) drawInspectRing(ctx, p.x, p.y - 40, 44, 52, t); }

  // Foods.
  for (const f of world.foods) { drawFood(ctx, f, t); if (ui.selected === f) drawInspectRing(ctx, f.x, f.y - 12, 20, 20, t); }

  // 👁: the creature layer — one guard for everything the animals are or
  // make: grove rings, home ticks, eggs, predators, bodies, the Teacher.
  const showCreatures = !ui || ui.showCreatures !== false;

  // v0.7/v0.12 culture + home-range overlays removed 2026-10-03 at Joshua's
  // direction ("I don't like the lines showing what the creatures are
  // doing"). The sim state (traditions, homeX) is untouched — only the
  // drawing is gone.

  // Eggs.
  if (showCreatures) for (const e of world.eggs) drawEgg(ctx, e, t, ui);

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
  if (showCreatures) for (const pr of world.predators || []) {
    drawPredator(ctx, pr, t, light);
    if (ui.selected === pr) drawInspectRing(ctx, pr.x, (pr.y || 0) - 20, 46, 36, t);
  }

  // Creatures (selected last, with ring).
  const sorted = showCreatures ? [...world.creatures].sort((a, b) =>
    (ui.selected === a ? 1 : 0) - (ui.selected === b ? 1 : 0)) : [];
  for (const c of sorted) {
    const plat = world.platforms[c.platformIndex];
    // Physics: creatures have their own y now — the airborne draw mid-air.
    const cy = (c.y !== undefined && c.y !== null) ? c.y : plat.y;
    if (ui.selected === c) drawSelectionRing(ctx, c, cy, t);
    drawCreatureShadow(ctx, c, cy);
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
    // Combo pass: the readout card is drawn in screen space after the world
    // transform is restored, so it stays a constant size at any zoom.
    if (ui.selected === c || ui.hover === c) {
      r._cardTarget = { c, cy, sx: c.x * r.scale + r.ox, sy: cy * r.scale + r.oy };
    }
  }

  // (Motion trails removed 2026-10-03 at Joshua's direction.)

  // The Teacher — Sunny's visitor avatar (v0.14 "Voices"). Drawn after the
  // tanglekins: blue monkey, jaunty newsboy cap, unmistakably not one of them.
  if (showCreatures && world.teacher) {
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

  // Combo pass: the readout card lives in screen space — constant size at
  // any zoom, the diagrammatic layer floating over the painting.
  if (r._cardTarget) {
    drawReadoutCardScreen(ctx, r, r._cardTarget);
    r._cardTarget = null;
  }

  // Night tint.
  if (light < 0.6) {
    ctx.fillStyle = `rgba(8,10,38,${((0.6 - light) * 0.55).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Combo pass: instrument frame — corner brackets and honest micro-labels,
  // drawn last in screen space, above everything.
  drawHUD(ctx, r, world, W, H);
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

// ---------------------------------------------------------------------------
// Combo visual pass: atmosphere, foliage, branches, and the diagrammatic
// overlay. All presentation — the sim is never touched. Deterministic where
// it matters (foliage, branches) via seeded PRNGs; animated where it's cheap
// (light shafts, mist drift, water shimmer).

function hashSeed(s) {
  let a = (s * 16807) % 2147483647;
  if (a <= 0) a += 2147483646;
  return () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; };
}

// Three-stop sky keyed to light, warmer at the horizon than the old flat wash.
const ATMOS_DAY = { top: [118, 184, 214], mid: [178, 204, 178], bot: [244, 226, 182] };
const ATMOS_NIGHT = { top: [8, 12, 34], mid: [22, 28, 60], bot: [42, 50, 90] };

function drawAtmosphere(ctx, r, W, H, light, t) {
  const top = mix(ATMOS_NIGHT.top, ATMOS_DAY.top, light);
  const mid = mix(ATMOS_NIGHT.mid, ATMOS_DAY.mid, light);
  const bot = mix(ATMOS_NIGHT.bot, ATMOS_DAY.bot, light);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(top));
  g.addColorStop(0.55, rgb(mid));
  g.addColorStop(1, rgb(bot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Warm bloom low on the horizon — the light the canopy drinks.
  ctx.fillStyle = `rgba(255,224,160,${(0.10 * light).toFixed(3)})`;
  const bg = ctx.createLinearGradient(0, H * 0.55, 0, H);
  bg.addColorStop(0, 'rgba(255,224,160,0)');
  bg.addColorStop(1, `rgba(255,224,160,${(0.22 * light).toFixed(3)})`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // God rays: slanted translucent shafts drifting slowly. Kept whisper-thin
  // — they suggest light, not searchlights.
  ctx.save();
  ctx.fillStyle = '#fff6d8';
  ctx.globalAlpha = 0.016 + 0.022 * light;
  for (let i = 0; i < 3; i++) {
    const sx = W * (0.22 + i * 0.28) + Math.sin(t * 0.08 + i * 2.1) * 24 * r.dpr;
    const wTop = 34 * r.dpr, spread = 70 * r.dpr;
    ctx.beginPath();
    ctx.moveTo(sx, -60);
    ctx.lineTo(sx + wTop, -60);
    ctx.lineTo(sx + wTop + spread, H * 0.78);
    ctx.lineTo(sx + spread, H * 0.78);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Mist bands in the lower third — two soft horizontal washes.
  for (const [yFrac, aMax] of [[0.66, 0.09], [0.80, 0.13]]) {
    const y0 = H * yFrac;
    const mg = ctx.createLinearGradient(0, y0 - 46 * r.dpr, 0, y0 + 46 * r.dpr);
    const c = `rgba(222,232,238,${(aMax * (0.4 + 0.6 * light)).toFixed(3)})`;
    mg.addColorStop(0, 'rgba(222,232,238,0)');
    mg.addColorStop(0.5, c);
    mg.addColorStop(1, 'rgba(222,232,238,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, y0 - 46 * r.dpr, W, 92 * r.dpr);
  }
}

// Per-biome foliage tint — the background reads the biome map.
const FOLIAGE_TINT = {
  arctic: [176, 198, 214], mountains: [96, 104, 116], jungle: [44, 108, 60],
  plains: [94, 148, 78], desert: [188, 158, 98], shallows: [58, 128, 118],
  archipelago: [68, 138, 108], deep: [28, 58, 88],
};

// Floating background foliage removed 2026-10-03 at Joshua's direction
// ("The plants are floating in the sky") — every leaf cluster now belongs
// to a tree limb, trunk, or the ground; nothing green floats.

function drawBranch(ctx, pl, t, light) {
  const pw = pl.x2 - pl.x1;
  const rnd = hashSeed((((pl.x1 | 0) * 73 + (pl.y | 0) * 149) | 0) || 1);
  const thick = 30 + rnd() * 12;
  const sag = 6 + rnd() * 10;
  const mx = pl.x1 + pw * 0.5;
  const barkD = rgb(mix([34, 28, 42], [92, 70, 50], light));
  const barkL = rgb(mix([48, 40, 54], [124, 98, 68], light));
  const moss = rgb(mix([38, 64, 42], [106, 158, 94], light));

  // Body.
  ctx.fillStyle = barkD;
  ctx.beginPath();
  ctx.moveTo(pl.x1, pl.y - 3);
  ctx.quadraticCurveTo(mx, pl.y - 6 + sag * 0.4, pl.x2, pl.y - 2);
  ctx.lineTo(pl.x2, pl.y + thick * 0.55);
  ctx.quadraticCurveTo(mx, pl.y + thick * 0.75 + sag, pl.x1, pl.y + thick * 0.5);
  ctx.closePath();
  ctx.fill();
  // Lit upper edge.
  ctx.fillStyle = barkL;
  ctx.beginPath();
  ctx.moveTo(pl.x1, pl.y - 3);
  ctx.quadraticCurveTo(mx, pl.y - 6 + sag * 0.4, pl.x2, pl.y - 2);
  ctx.lineTo(pl.x2, pl.y + 5);
  ctx.quadraticCurveTo(mx, pl.y + 2 + sag * 0.4, pl.x1, pl.y + 4);
  ctx.closePath();
  ctx.fill();
  // Moss: a low irregular nap along the walk surface, not separate pads.
  ctx.fillStyle = moss;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(pl.x1, pl.y - 2);
  ctx.quadraticCurveTo(mx, pl.y - 5 + sag * 0.4, pl.x2, pl.y - 1);
  ctx.lineTo(pl.x2, pl.y + 3);
  ctx.quadraticCurveTo(mx, pl.y + 1 + sag * 0.4, pl.x1, pl.y + 2);
  ctx.closePath();
  ctx.fill();
  // Moss texture: tiny darker flecks.
  ctx.fillStyle = rgb(mix([30, 52, 34], [84, 128, 76], light));
  const nFleck = Math.max(4, Math.round(pw / 60));
  for (let i = 0; i <= nFleck; i++) {
    const fx = pl.x1 + (i / nFleck) * pw;
    ctx.beginPath();
    ctx.arc(fx, pl.y - 1 + Math.sin(fx * 0.08) * 1.5, 2.2 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Bark grain.
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const yy = pl.y + thick * (0.25 + i * 0.14);
    ctx.beginPath();
    ctx.moveTo(pl.x1 + pw * 0.08, yy);
    ctx.quadraticCurveTo(mx, yy + (rnd() - 0.5) * 9, pl.x2 - pw * 0.08, yy + (rnd() - 0.5) * 5);
    ctx.stroke();
  }
  // Twigs with leaf tufts.
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const tx = pl.x1 + pw * (0.22 + rnd() * 0.56);
    const ty = pl.y - 6;
    const tl = 22 + rnd() * 30;
    const ta = -Math.PI / 2 + (rnd() - 0.5) * 1.4;
    const ex = tx + Math.cos(ta) * tl, ey = ty + Math.sin(ta) * tl;
    ctx.strokeStyle = barkD;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + Math.cos(ta) * tl * 0.5, ty + Math.sin(ta) * tl * 0.6, ex, ey);
    ctx.stroke();
    ctx.fillStyle = rgb(mix([40, 68, 46], [88, 148, 86], light));
    ctx.beginPath();
    ctx.ellipse(ex, ey, 11 + rnd() * 5, 6.5, ta, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Driftwood raft (floe kind): weathered timber, plank seams — restyled, same role.
function drawDriftwood(ctx, pl, light) {
  const pw = pl.x2 - pl.x1;
  ctx.fillStyle = rgb(mix([52, 40, 30], [142, 108, 72], light));
  ctx.beginPath();
  ctx.moveTo(pl.x1, pl.y);
  ctx.quadraticCurveTo(pl.x1 + pw * 0.5, pl.y + 6, pl.x2, pl.y + 1);
  ctx.lineTo(pl.x2, pl.y + 30);
  ctx.quadraticCurveTo(pl.x1 + pw * 0.5, pl.y + 36, pl.x1, pl.y + 28);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgb(mix([36, 28, 22], [104, 78, 52], light));
  ctx.lineWidth = 2;
  for (const fx of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(pl.x1 + pw * fx, pl.y + 4);
    ctx.lineTo(pl.x1 + pw * fx, pl.y + 30);
    ctx.stroke();
  }
  // Pale sun-bleached top edge.
  ctx.strokeStyle = rgb(mix([70, 56, 42], [178, 146, 104], light));
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pl.x1, pl.y + 1);
  ctx.quadraticCurveTo(pl.x1 + pw * 0.5, pl.y + 7, pl.x2, pl.y + 2);
  ctx.stroke();
}

// --- Structural rethink (v0.38): the congruent world ---
// Ground is ONE continuous terrain silhouette (not platform rectangles).
// Trees are trunks rising from the ground through their branch tiers.
// Cliffs are rock faces with ledges. All drawn from layout metadata;
// the sim's platform interface is untouched.

// Continuous ground: filled silhouette from the terrain elevation field,
// tinted per biome column. Null columns (open water) are skipped — water
// is drawn separately. NOTE: the ctx is already translated+scaled to WORLD
// coordinates by the caller — draw in world units, not screen units.
function drawContinuousGround(ctx, r, world, B, light, t) {
  const layout = world.layout;
  if (!layout || !layout.ground) return;
  const ground = layout.ground;
  const TERRAIN_COL = 20;
  const H = world.height;
  const W = world.width;
  // Per-biome ground tints (dark soil tones that read as earth, not wash).
  const TINTS = {
    jungle: [46, 72, 44], mountains: [88, 86, 92], arctic: [210, 225, 235],
    plains: [104, 128, 72], desert: [198, 168, 112], shallows: [64, 96, 92],
    archipelago: [168, 148, 104], deep: [20, 40, 70],
  };
  ctx.save();
  // Build runs of contiguous non-null columns.
  let run = null;
  const flush = () => {
    if (!run || run.pts.length < 2) { run = null; return; }
    // Biome tint from the run's midpoint.
    let key = 'plains';
    try { key = B.biomeKeyAt((run.x0 + run.x1) / 2, H * 0.6, world) || 'plains'; } catch (e) {}
    const tint = TINTS[key] || TINTS.plains;
    ctx.beginPath();
    ctx.moveTo(run.pts[0][0], run.pts[0][1]);
    for (let i = 1; i < run.pts.length; i++) ctx.lineTo(run.pts[i][0], run.pts[i][1]);
    // Down to the bottom and back.
    ctx.lineTo(run.x1, H + 100);
    ctx.lineTo(run.x0, H + 100);
    ctx.closePath();
    // Vertical gradient: lit surface → dark depth.
    const g = ctx.createLinearGradient(0, run.topY, 0, H);
    g.addColorStop(0, rgb(mix(tint, [255, 255, 255], 0.25 * light)));
    g.addColorStop(0.3, rgb(tint));
    g.addColorStop(1, rgb(mix(tint, [0, 0, 0], 0.55)));
    ctx.fillStyle = g;
    ctx.fill();
    // Lit top edge — the ground line reads crisply.
    ctx.strokeStyle = rgb(mix(tint, [255, 255, 255], 0.45 * light));
    ctx.lineWidth = 2.5 / r.scale;
    ctx.beginPath();
    ctx.moveTo(run.pts[0][0], run.pts[0][1]);
    for (let i = 1; i < run.pts.length; i++) ctx.lineTo(run.pts[i][0], run.pts[i][1]);
    ctx.stroke();
    run = null;
  };
  for (let i = 0; i < ground.length; i++) {
    const gv = ground[i];
    if (gv === null || gv === undefined) { flush(); continue; }
    const x = (i + 0.5) * TERRAIN_COL;
    if (x > W) { flush(); continue; }
    if (!run) run = { x0: x - TERRAIN_COL / 2, x1: x + TERRAIN_COL / 2, pts: [], topY: gv };
    run.x1 = x + TERRAIN_COL / 2;
    if (gv < run.topY) run.topY = gv;
    run.pts.push([x, gv]);
  }
  flush();
  ctx.restore();
}

// A tree: tapered trunk from baseY to topY at tree.x, with root flare.
// Branches (drawn separately as limbs) belong to it via branchPis.
// World coordinates (ctx already transformed).
function drawTreeTrunk(ctx, r, world, tree, t, light) {
  const label = tree.label || 'jungle';
  const isPalm = label === 'palm';
  const isMangrove = label === 'mangrove';
  const x0 = tree.x, y0 = tree.baseY;
  const x1 = tree.x, y1 = tree.topY;
  const h = y0 - y1;
  if (h < 4) return;
  const baseW = isPalm ? 10 : 16;
  const topW = baseW * 0.35;
  // Slight organic lean (deterministic from tree x).
  const lean = Math.sin(tree.x * 0.013) * h * 0.06;
  const barkD = isMangrove ? rgb(mix([40, 34, 30], [96, 78, 60], light))
    : isPalm ? rgb(mix([58, 48, 36], [134, 112, 80], light))
    : rgb(mix([34, 28, 42], [92, 70, 50], light));
  const barkL = isMangrove ? rgb(mix([52, 44, 38], [120, 100, 78], light))
    : isPalm ? rgb(mix([72, 60, 46], [158, 134, 98], light))
    : rgb(mix([48, 40, 54], [124, 98, 68], light));
  ctx.save();
  // Trunk body (tapered).
  ctx.fillStyle = barkD;
  ctx.beginPath();
  ctx.moveTo(x0 - baseW, y0);
  ctx.quadraticCurveTo(x0 - baseW * 0.7 + lean * 0.4, (y0 + y1) / 2, x1 - topW + lean, y1);
  ctx.lineTo(x1 + topW + lean, y1);
  ctx.quadraticCurveTo(x0 + baseW * 0.7 + lean * 0.4, (y0 + y1) / 2, x0 + baseW, y0);
  ctx.closePath();
  ctx.fill();
  // Lit edge.
  ctx.fillStyle = barkL;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(x0 - baseW, y0);
  ctx.quadraticCurveTo(x0 - baseW * 0.7 + lean * 0.4, (y0 + y1) / 2, x1 - topW + lean, y1);
  ctx.lineTo(x1 - topW * 0.2 + lean, y1);
  ctx.quadraticCurveTo(x0 - baseW * 0.35 + lean * 0.4, (y0 + y1) / 2, x0 - baseW * 0.45, y0);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // Root flare.
  ctx.fillStyle = barkD;
  ctx.beginPath();
  ctx.ellipse(x0, y0 + 2, baseW * 1.5, baseW * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Mangrove prop roots.
  if (isMangrove) {
    ctx.strokeStyle = barkD;
    ctx.lineWidth = 3 / r.scale;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x0 + s * baseW * 0.5, y0 - h * 0.25);
      ctx.quadraticCurveTo(x0 + s * baseW * 2.2, y0 - h * 0.08, x0 + s * baseW * 2.6, y0 + 4);
      ctx.stroke();
    }
  }
  // Limbs: connect the trunk to each branch platform. Branches drift from
  // the trunk x (seeded placement), so draw the limb explicitly — the
  // canopy reads as one organism, not floating slabs.
  const plats = world.platforms;
  if (plats && tree.branchPis) {
    ctx.strokeStyle = barkD;
    ctx.lineCap = 'round';
    for (const pi of tree.branchPis) {
      const pl = plats[pi];
      if (!pl) continue;
      const bx = (pl.x1 + pl.x2) / 2;
      const by = pl.y + 8; // branch underside
      // Limb from trunk (at branch height) to branch center.
      const tx = x0 + lean * ((y0 - by) / h);
      const lw = 7 * (1 - (y0 - by) / (h * 1.4));
      ctx.lineWidth = Math.max(3 / r.scale, lw);
      ctx.beginPath();
      ctx.moveTo(tx, by - 4);
      ctx.quadraticCurveTo((tx + bx) / 2, by - 2, bx, by);
      ctx.stroke();
      // Canopy foliage: leaf clusters along the branch so it reads as a
      // tree crown, not a slab. Deterministic from branch position.
      const frnd = hashSeed(((pl.x1 | 0) * 31 + (pl.y | 0) * 57) | 0 || 1);
      const leafD = rgb(mix([36, 72, 40], [74, 138, 70], light));
      const leafL = rgb(mix([52, 96, 54], [104, 176, 96], light));
      const nLeaf = Math.max(3, Math.floor((pl.x2 - pl.x1) / 90));
      for (let li = 0; li < nLeaf; li++) {
        const lx = pl.x1 + (li + 0.5) / nLeaf * (pl.x2 - pl.x1) + (frnd() - 0.5) * 30;
        const ly = pl.y - 14 - frnd() * 26;
        const lr = 13 + frnd() * 10;
        ctx.fillStyle = frnd() > 0.5 ? leafD : leafL;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.ellipse(lx, ly, lr, lr * 0.72, (frnd() - 0.5) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// A rock/ridge: solid mass from its top surface down to the terrain.
// The sim treats it as solid for acoustics; visually it's a grounded
// formation, not a floating slab. World coordinates.
function drawRockFormation(ctx, r, world, pl, t, light) {
  const layout = world.layout;
  const x1 = pl.x1, x2 = pl.x2, yTop = pl.y;
  // Find terrain below the rock's center.
  let yBot = yTop + 120;
  if (layout && layout.ground) {
    const TERRAIN_COL = 20;
    const cx = (x1 + x2) / 2;
    const gi = Math.max(0, Math.min(layout.ground.length - 1, Math.floor(cx / TERRAIN_COL)));
    const g = layout.ground[gi];
    if (g !== null && g !== undefined && g > yTop) yBot = g;
  }
  const isDesert = (pl.zone || '') === 'desert';
  const rockD = isDesert ? rgb(mix([150, 120, 84], [210, 180, 130], light))
    : rgb(mix([88, 86, 92], [140, 136, 132], light));
  const rockL = isDesert ? rgb(mix([170, 140, 100], [228, 200, 150], light))
    : rgb(mix([110, 108, 114], [164, 160, 156], light));
  const jag = (f) => Math.sin(x1 * 0.07 + f * 1.7) * 10;
  ctx.save();
  // Mass: top surface at pl.y, tapering down to the terrain.
  const wTop = (x2 - x1) / 2;
  const wBot = wTop * 1.35;
  const cx = (x1 + x2) / 2;
  ctx.fillStyle = rockD;
  ctx.beginPath();
  ctx.moveTo(x1 + jag(0), yTop);
  ctx.lineTo(x2 + jag(1), yTop);
  ctx.lineTo(cx + wBot + jag(2), yBot);
  ctx.lineTo(cx - wBot + jag(3), yBot);
  ctx.closePath();
  ctx.fill();
  // Lit top.
  ctx.fillStyle = rockL;
  ctx.beginPath();
  ctx.moveTo(x1 + jag(0), yTop);
  ctx.lineTo(x2 + jag(1), yTop);
  ctx.lineTo(x2 - 8 + jag(1), yTop + 10);
  ctx.lineTo(x1 + 8 + jag(0), yTop + 10);
  ctx.closePath();
  ctx.fill();
  // Strata.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1.5 / r.scale;
  const h = yBot - yTop;
  const nS = Math.max(1, Math.floor(h / 50));
  for (let i = 1; i <= nS; i++) {
    const yy = yTop + (h * i) / (nS + 1);
    const ww = wTop + (wBot - wTop) * (i / (nS + 1));
    ctx.beginPath();
    ctx.moveTo(cx - ww + jag(i + 4), yy);
    ctx.quadraticCurveTo(cx, yy + 5, cx + ww + jag(i + 7), yy);
    ctx.stroke();
  }
  ctx.restore();
}

// A cliff: rock face from baseY to topY spanning its shelves' x-range,
// shelves drawn as ledges jutting from it. World coordinates.
function drawCliffFace(ctx, r, world, cliff, t, light) {
  const plats = world.platforms;
  // X-range: cover all shelves in this cliff.
  let x0 = cliff.x - 26, x1 = cliff.x + 26;
  if (plats && cliff.shelfPis) {
    for (const pi of cliff.shelfPis) {
      const pl = plats[pi];
      if (!pl) continue;
      if (pl.x1 < x0) x0 = pl.x1;
      if (pl.x2 > x1) x1 = pl.x2;
    }
  }
  const y0 = cliff.baseY, y1 = cliff.topY;
  const h = y0 - y1;
  if (h < 8) return;
  const cx = (x0 + x1) / 2;
  const wTop = (x1 - x0) / 2;
  const wBase = wTop * 1.25;
  const rocky = (cliff.label || '') === 'arctic';
  const rockD = rocky ? rgb(mix([140, 150, 165], [200, 210, 225], light))
    : rgb(mix([70, 66, 72], [130, 124, 118], light));
  const rockL = rocky ? rgb(mix([170, 180, 195], [225, 232, 240], light))
    : rgb(mix([92, 88, 94], [158, 150, 142], light));
  const jag = (f) => Math.sin(cx * 0.05 + f * 2.1) * 10;
  ctx.save();
  ctx.fillStyle = rockD;
  ctx.beginPath();
  ctx.moveTo(cx - wBase + jag(0), y0);
  ctx.lineTo(cx - wTop + jag(3), y1);
  ctx.lineTo(cx + wTop + jag(4), y1);
  ctx.lineTo(cx + wBase + jag(1), y0);
  ctx.closePath();
  ctx.fill();
  // Lit face.
  ctx.fillStyle = rockL;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - wTop + jag(3), y1);
  ctx.lineTo(cx - wTop * 0.3 + jag(5), y1);
  ctx.lineTo(cx - wBase * 0.2 + jag(6), y0);
  ctx.lineTo(cx - wBase + jag(0), y0);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // Strata lines.
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 1.5 / r.scale;
  const nStrata = Math.max(2, Math.floor(h / 60));
  for (let i = 1; i < nStrata; i++) {
    const yy = y1 + (h * i) / nStrata;
    const ww = wTop + (wBase - wTop) * (i / nStrata);
    ctx.beginPath();
    ctx.moveTo(cx - ww + jag(i), yy);
    ctx.quadraticCurveTo(cx + jag(i + 9), yy + 4, cx + ww + jag(i + 3), yy);
    ctx.stroke();
  }
  ctx.restore();
}


// Soft contact shadow under a creature — grounds it on the branch.
function drawCreatureShadow(ctx, c, cy) {
  const r = creatureRadius(c);
  ctx.fillStyle = 'rgba(8, 12, 8, 0.20)';
  ctx.beginPath();
  ctx.ellipse(c.x, cy + 5, r * 1.05, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
}

// The readout card: a mockup-style instrument readout for the
// selected/hovered creature — leader line, ID, action + mood, energy bar.
// Every value is sim state; the painter invents nothing.
// Readout card — screen space, constant size at any zoom. A small
// instrument readout: leader line from the creature, name, action · mood,
// energy bar. The diagrammatic overlay on the living painting.
function drawReadoutCardScreen(ctx, r, target) {
  const { c, sx, sy } = target;
  const b = c.biochem;
  const m = mood(b);
  const action = (c.actionLabel || c.action || '').toString();
  const dpr = r.dpr || 1;
  const W = r.canvas.width, H = r.canvas.height;

  ctx.save();
  ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
  const l1 = `${c.name}`;
  const l2 = `${action.toUpperCase()} \u00B7 ${m.toUpperCase()}`;
  // The SVG shim's measureText is a stub; estimate from the monospace advance.
  const charW = 6.7 * dpr;
  const cw = Math.max(l1.length, l2.length, 18) * charW + 20 * dpr;
  const ch = 52 * dpr;
  // Card sits up-right of the creature's screen position, clamped on-screen.
  let cx = sx + 26 * dpr, cyy = sy - 90 * dpr - ch;
  cx = Math.max(8 * dpr, Math.min(cx, W - cw - 8 * dpr));
  cyy = Math.max(8 * dpr, Math.min(cyy, H - ch - 8 * dpr));

  // Leader line: creature -> card. Kept whisper-thin (2026-10-03).
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 14 * dpr);
  ctx.lineTo(cx + 8 * dpr, cyy + ch);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(sx, sy - 14 * dpr, 2.2 * dpr, 0, Math.PI * 2);
  ctx.fill();

  // Card body.
  ctx.fillStyle = 'rgba(10,14,22,0.55)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx, cyy);
  ctx.lineTo(cx + cw, cyy);
  ctx.lineTo(cx + cw, cyy + ch);
  ctx.lineTo(cx, cyy + ch);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(l1, cx + 10 * dpr, cyy + 17 * dpr);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(l2, cx + 10 * dpr, cyy + 32 * dpr);
  // Energy bar.
  const bw = cw - 20 * dpr, bx = cx + 10 * dpr, by = cyy + 40 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(bx, by, bw, 4 * dpr);
  const e = Math.max(0, Math.min(1, b.energy || 0));
  ctx.fillStyle = e > 0.5 ? 'rgba(140,220,150,0.9)' : e > 0.25 ? 'rgba(240,200,110,0.9)' : 'rgba(235,110,100,0.9)';
  ctx.fillRect(bx, by, bw * e, 4 * dpr);
  ctx.restore();
}

// Instrument frame: corner brackets + honest micro-labels, screen space, last.
function drawHUD(ctx, r, world, W, H) {
  const dpr = r.dpr || 1;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1.5 * dpr;
  const m = 16 * dpr, L = 24 * dpr;
  const corners = [
    [m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * L, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * L);
    ctx.stroke();
  }
  ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'left';
  ctx.fillText('CANOPY // v0.37', m + 6 * dpr, m + 18 * dpr);
  const dayNum = Math.floor(world.tick / (world.dayTicks || 3000)) + 1;
  ctx.fillText(`TICK ${world.tick} · DAY ${dayNum}`, m + 6 * dpr, H - m - 10 * dpr);
  ctx.textAlign = 'right';
  let n = 0;
  for (const c of world.creatures) if (c.alive) n++;
  ctx.fillText(`${n} ALIVE`, W - m - 6 * dpr, H - m - 10 * dpr);
  ctx.restore();
}

function drawPlant(ctx, p, t, light, B, world) {
  // 2026-10-03: plants are indexed to a platform but populate() scatters
  // their x across the zone — many land hundreds of px off their branch and
  // read as floating. Presentation reconciliation: paint the plant at the
  // nearest point on its own platform. Sim position (foraging, etc.) is
  // untouched.
  let px = p.x;
  const pplat = world && p.platformIndex >= 0 ? world.platforms[p.platformIndex] : null;
  if (pplat) px = Math.max(pplat.x1 + 24, Math.min(px, pplat.x2 - 24));
  // v0.18 "Realms": flora morphs from floraFor(biomeKey) — plants carry a
  // morph field. Unknown morphs fall through to the classic tree: the
  // painter never draws nothing.
  const morph = p.morph || 'tree';
  if (PLANT_MORPHS.has(morph)) { drawPlantMorph(ctx, p, t, light, morph, px); return; }
  // Combo pass: the tree is a layered canopy now, not a lollipop — a tapered
  // trunk with three tiers of leaf clusters and fruit nestled inside.
  // Foliage tinted per biome so arctic pines read pale, desert scrub sandy.
  let leafBase = [84, 168, 100];
  if (B && world && typeof B.biomeKeyAt === 'function') {
    try {
      const bk = B.biomeKeyAt(px, p.y, world);
      if (FOLIAGE_TINT[bk]) leafBase = FOLIAGE_TINT[bk].map((v) => Math.round(v * 1.35));
    } catch (e) { /* keep default */ }
  }
  const h = 40 + p.growth * 70;
  const sway = Math.sin(p.sway + t * 0.8) * 7 * p.growth;
  const herb = p.kind === 'herb';
  const rnd = hashSeed(((p.id | 0) * 31 + 7) | 0);
  const stem = herb
    ? rgb(mix([52, 40, 78], [96, 72, 148], light))
    : rgb(mix([38, 62, 44], [88, 128, 70], light));
  if (herb) leafBase = [128, 96, 190];
  const leafDark = [14, 20, 32];

  // Trunk: tapered, gently curving.
  ctx.strokeStyle = stem;
  ctx.lineCap = 'round';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(px, p.y - 4);
  ctx.quadraticCurveTo(px + sway * 0.3, p.y - h * 0.55, px + sway, p.y - h);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(px, p.y - h * 0.35);
  ctx.quadraticCurveTo(px - 18 + sway * 0.2, p.y - h * 0.6, px - 26 + sway * 0.4, p.y - h * 0.78);
  ctx.stroke();

  // Canopy: three tiers of leaf clusters, denser at the top.
  for (let layer = 0; layer < 3; layer++) {
    const ly = p.y - h * (0.52 + layer * 0.24);
    const spread = (34 - layer * 8) * (0.6 + p.growth * 0.4);
    const nLeaf = 6 + layer * 2;
    for (let i = 0; i < nLeaf; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * spread;
      const lx = px + sway * (0.4 + layer * 0.25) + Math.cos(a) * rr;
      const ly2 = ly + Math.sin(a) * rr * 0.55;
      const v = rnd();
      const col = [0, 1, 2].map((k) => Math.round(leafBase[k] * (0.75 + v * 0.35)));
      ctx.fillStyle = rgb(mix(leafDark, col, light));
      ctx.beginPath();
      ctx.ellipse(lx, ly2, 9 + v * 9, 5.5 + v * 5, a * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Fruit (or medicinal buds on herbs), nestled in the lower canopy.
  if (p.growth >= 1) {
    const fc = herb ? '#9a6ee8' : '#e4574f';
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const fx = px + sway * 0.6 + Math.cos(a) * 26;
      const fy = p.y - h * 0.72 + Math.sin(a) * 16;
      ctx.fillStyle = fc;
      ctx.beginPath();
      ctx.arc(fx, fy, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(fx - 2.5, fy - 2.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// v0.18 "Realms": per-morph plant bodies. p.x/p.y is the base (on the
// platform, or on the seabed for kelp); growth scales, sway moves.
const PLANT_MORPHS = new Set(['grass', 'cactus', 'shrub', 'moss', 'mangrove', 'palm', 'kelp']);

function drawPlantMorph(ctx, p, t, light, morph, px) {
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
  const x = (px !== undefined ? px : p.x), y = p.y;
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

// v0.7/v0.12 overlays (grove rings, home ticks) removed 2026-10-03 at
// Joshua's direction — see the render() note above.

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

