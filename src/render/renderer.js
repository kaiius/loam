// Canvas renderer: sky, parallax hills, platforms, plants, food, eggs,
// toys, critters, creatures. Camera fits the whole terrarium.

import { drawCreature } from './painter.js';
import { creatureRadius } from '../sim/creature.js';
import { ageStage } from '../sim/biochem.js';
import { timeOfDay, ZONES } from '../sim/world.js';

export function createRenderer(canvas) {
  const r = {
    canvas,
    ctx: canvas.getContext('2d'),
    scale: 1, ox: 0, oy: 0, dpr: 1,
    stars: [],
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
}

export function worldToScreen(r, world, x, y) {
  return { x: x * r.scale + r.ox, y: y * r.scale + r.oy };
}

export function screenToWorld(r, sx, sy) {
  return { x: (sx - r.ox) / r.scale, y: (sy - r.oy) / r.scale };
}

function fitCamera(r, world) {
  const w = r.canvas.width, h = r.canvas.height;
  r.scale = Math.min(w / world.width, h / (world.height * 0.92)) * r.dpr;
  r.ox = (w - world.width * r.scale) / 2;
  r.oy = h - world.groundY * r.scale - 8 * r.dpr;
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
  fitCamera(r, world);
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

  // Platforms.
  for (const pl of world.platforms) {
    const pw = pl.x2 - pl.x1;
    ctx.fillStyle = rgb(mix([52, 44, 70], [139, 117, 82], light));
    roundRect(ctx, pl.x1, pl.y, pw, 60, 10);
    ctx.fill();
    ctx.fillStyle = rgb(mix([50, 80, 60], [106, 176, 105], light));
    roundRect(ctx, pl.x1 - 4, pl.y - 14, pw + 8, 22, 10);
    ctx.fill();
  }

  // Plants.
  for (const p of world.plants) drawPlant(ctx, p, t, light);

  // Foods.
  for (const f of world.foods) drawFood(ctx, f, t);

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
  for (const pb of world.pebbles || []) drawPebble(ctx, pb);

  // Critters.
  for (const cr of world.critters) drawCritter(ctx, cr, t, light);

  // Creatures (selected last, with ring).
  const sorted = [...world.creatures].sort((a, b) =>
    (ui.selected === a ? 1 : 0) - (ui.selected === b ? 1 : 0));
  for (const c of sorted) {
    const plat = world.platforms[c.platformIndex];
    // Physics: creatures have their own y now — the airborne draw mid-air.
    const cy = (c.y !== undefined && c.y !== null) ? c.y : plat.y;
    if (ui.selected === c) drawSelectionRing(ctx, c, cy, t);
    drawCreature(ctx, c, cy, t);
    drawLabel(ctx, c, cy, ui);
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

function drawCritter(ctx, cr, t, light) {
  const y = cr.y - 8 + (cr.kind === 'butterfly' ? Math.sin(cr.t * 3) * 14 - 26 : 0);
  if (cr.kind === 'bug') {
    ctx.fillStyle = rgb(mix([40, 36, 50], [74, 63, 90], light));
    ctx.beginPath();
    ctx.ellipse(cr.x, y, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(mix([40, 36, 50], [74, 63, 90], light));
    ctx.lineWidth = 1.6;
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cr.x - 4 + i * 4, y + 4);
      ctx.lineTo(cr.x - 6 + i * 4, y + 11 + s * 2);
      ctx.stroke();
    }
  } else {
    const flap = Math.sin(cr.t * 18) * 0.9;
    ctx.fillStyle = 'rgba(240,180,220,0.9)';
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(cr.x, y);
      ctx.rotate(s * (0.5 + flap * 0.5));
      ctx.beginPath();
      ctx.ellipse(s * 9, 0, 9, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#5a4a6a';
    ctx.beginPath();
    ctx.ellipse(cr.x, y, 3, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

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
