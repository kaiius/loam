// Procedural creature art: every visual trait is read from the genome's
// phenotype, so what you see IS the DNA. Deterministic per creature
// (spots don't swim between frames).

import { creatureRadius } from '../sim/creature.js';

function hashRand(seed) {
  let a = (seed * 16807) % 2147483647;
  if (a <= 0) a += 2147483646;
  return () => {
    a = (a * 16807) % 2147483647;
    return (a - 1) / 2147483646;
  };
}

function shade(hue, sat, light) {
  return `hsl(${hue.toFixed(0)},${sat.toFixed(0)}%,${light.toFixed(0)}%)`;
}

// Draws the creature standing on groundY (feet at groundY). t = seconds.
export function drawCreature(ctx, c, groundY, t) {
  const p = c.pheno;
  const r = creatureRadius(c);
  const rand = hashRand(c.id * 7919 + 13);
  const moving = !c.sleeping && Math.abs(c.wanderDir) > 0 &&
    (c.action === 'wander' || c.action === 'seekFood' || c.action === 'approach' || c.action === 'play' || c.action === 'mate' || c.action === 'flee');

  ctx.save();
  ctx.translate(c.x, groundY);
  ctx.scale(c.facing, 1);

  const hop = moving ? Math.abs(Math.sin(c.hopPhase)) * r * 0.22 : 0;
  const breathe = Math.sin(t * 2.2 + c.id) * 0.02;
  const sx = 1 + (moving ? Math.sin(c.hopPhase) * 0.07 : breathe);
  const sy = 1 - (moving ? Math.sin(c.hopPhase) * 0.07 : breathe);

  const base = shade(p.hueDeg, 58, 60);
  const dark = shade(p.hueDeg, 52, 44);
  const light = shade(p.hueDeg, 65, 80);

  ctx.translate(0, -hop);

  // Tail (behind body).
  const tailLen = r * (0.5 + p.tailLength * 1.3);
  const wag = Math.sin(t * 5 + c.id * 2) * r * 0.18;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(3, r * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.85, -r * 0.5);
  ctx.quadraticCurveTo(-r * 0.85 - tailLen * 0.6, -r * 0.5 - tailLen * 0.3 + wag,
    -r * 0.85 - tailLen, -r * 0.5 - tailLen * 0.7 + wag * 1.6);
  ctx.stroke();
  // Tail tuft.
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(-r * 0.85 - tailLen, -r * 0.5 - tailLen * 0.7 + wag * 1.6, r * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Body.
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.95, r * 1.02 * sx, r * 0.95 * sy, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly.
  ctx.fillStyle = light;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(r * 0.12, -r * 0.8, r * 0.58 * sx, r * 0.5 * sy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Pattern.
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.55;
  const nSpots = Math.round(2 + p.patternDensity * 9);
  if (p.pattern === 'spots') {
    for (let i = 0; i < nSpots; i++) {
      const a = rand() * Math.PI * 2;
      const rr = 0.35 + rand() * 0.5;
      const px = Math.cos(a) * r * 0.75 * rr * 1.2 - r * 0.1;
      const py = -r * 0.95 + Math.sin(a) * r * 0.6 * rr;
      ctx.beginPath();
      ctx.arc(px, py, r * (0.08 + rand() * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.pattern === 'stripes') {
    const n = 3 + Math.round(p.patternDensity * 3);
    for (let i = 0; i < n; i++) {
      const px = -r * 0.7 + (i / (n - 1)) * r * 1.4;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.95, r * 1.02 * sx, r * 0.95 * sy, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillRect(px - r * 0.07, -r * 2, r * 0.14, r * 2);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;

  // Feet.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(-r * 0.45, -r * 0.1, r * 0.32, r * 0.18, 0, 0, Math.PI * 2);
  ctx.ellipse(r * 0.45, -r * 0.1, r * 0.32, r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears.
  const earY = -r * 1.75;
  ctx.fillStyle = base;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(2, r * 0.06);
  if (p.earShape === 'round') {
    for (const ex of [-r * 0.5, r * 0.5]) {
      ctx.beginPath();
      ctx.arc(ex, earY, r * 0.3, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(ex, earY, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = base;
    }
  } else if (p.earShape === 'pointy') {
    for (const ex of [-r * 0.5, r * 0.5]) {
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.28, earY + r * 0.25);
      ctx.lineTo(ex, earY - r * 0.35);
      ctx.lineTo(ex + r * 0.28, earY + r * 0.25);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  } else { // floppy
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * r * 0.55, earY + r * 0.2);
      ctx.rotate(s * 0.9);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.25, r * 0.2, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // Eyes.
  const eyeScale = 0.7 + p.eyeSize * 0.8;
  const eyeY = -r * 1.25;
  if (c.sleeping) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(2, r * 0.07);
    for (const ex of [r * 0.3, r * 0.72]) {
      ctx.beginPath();
      ctx.arc(ex, eyeY, r * 0.16 * eyeScale, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  } else {
    for (const ex of [r * 0.3, r * 0.72]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex, eyeY, r * 0.24 * eyeScale, 0, Math.PI * 2);
      ctx.fill();
      const lookX = Math.sin(t * 0.7 + c.id) * r * 0.05;
      ctx.fillStyle = '#2a2438';
      ctx.beginPath();
      ctx.arc(ex + r * 0.05 + lookX, eyeY + r * 0.03, r * 0.12 * eyeScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + r * 0.09 + lookX, eyeY - r * 0.01, r * 0.045 * eyeScale, 0, Math.PI * 2);
      ctx.fill();
    }
    // Cheeks.
    ctx.fillStyle = 'rgba(255,130,150,0.45)';
    ctx.beginPath();
    ctx.arc(r * 0.08, eyeY + r * 0.32, r * 0.13, 0, Math.PI * 2);
    ctx.arc(r * 0.95, eyeY + r * 0.32, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sleeping Z's.
  if (c.sleeping) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.max(12, r * 0.5)}px sans-serif`;
    const zoff = (t * 20) % 40;
    ctx.fillText('z', r * 0.9, -r * 1.9 - zoff * 0.5);
    ctx.globalAlpha = 0.6;
    ctx.fillText('z', r * 1.15, -r * 2.1 - zoff * 0.35);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
