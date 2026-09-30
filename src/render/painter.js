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
  const b = c.biochem; // v0.9: the painter reads the soul — every visible
  // trait below is a sim variable. The painter never invents state.
  const r = creatureRadius(c);
  const rand = hashRand(c.id * 7919 + 13);
  const moving = !c.sleeping && Math.abs(c.wanderDir) > 0 &&
    (c.action === 'wander' || c.action === 'seekFood' || c.action === 'approach' || c.action === 'play' || c.action === 'mate' || c.action === 'flee');

  ctx.save();
  ctx.translate(c.x, groundY);
  ctx.scale(c.facing, 1);

  // v0.9: injury limps the gait — the body's history in how it moves.
  const limp = Math.min(1, b.injury || 0);
  const hop = moving ? Math.abs(Math.sin(c.hopPhase)) * r * 0.22 * (1 - limp * 0.45) : 0;
  const breathe = Math.sin(t * 2.2 + c.id) * 0.02;
  const sx = 1 + (moving ? Math.sin(c.hopPhase) * 0.07 : breathe);
  // Fear crouches the body — posture reads the soul.
  const sy = (1 - (moving ? Math.sin(c.hopPhase) * 0.07 : breathe)) * (1 - b.fear * 0.07);

  // Illness shows as a sickly yellow-green pallor.
  const ill = Math.min(1, b.illness);
  // v0.9: age shows — seniors gray and stoop. A life is visible across the body.
  const lifeT = b.age / (c.pheno.lifespanSec || 1);
  const senior = lifeT > 0.8 ? Math.min(1, (lifeT - 0.8) / 0.2) : 0;
  const hueDeg = p.hueDeg + (80 - p.hueDeg) * ill * 0.55;
  const satLoss = ill * 18 + senior * 16;
  const base = shade(hueDeg, 58 - satLoss, 60);
  const dark = shade(hueDeg, 52 - satLoss, 44);
  const light = shade(hueDeg, 65 - satLoss, 80);

  ctx.translate(0, -hop);
  // v0.9 embodiment: posture. Fear crouches, hunger leans the body forward
  // into a foraging stoop, exhaustion sags it, age stoops it, injury tilts
  // the stride. Standing tall is contentment made visible.
  ctx.translate(0, b.fear * r * 0.26 + (1 - b.energy) * r * 0.13);
  ctx.rotate(b.hunger * 0.10 + senior * 0.05);
  if (limp > 0.02) ctx.rotate(Math.sin(c.hopPhase) * 0.09 * limp);

  // Tail (behind body).
  const tailLen = r * (0.5 + p.tailLength * 1.3);
  const wagSpeed = 5 * (c.mood === 'content' ? 1.9 : 1); // joy wags faster
  const wag = Math.sin(t * wagSpeed + c.id * 2) * r * 0.18;
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
  // v0.9: the belly shows satiety — fullness is visible.
  const full = 1 - b.hunger;
  ctx.beginPath();
  ctx.ellipse(r * 0.12, -r * 0.8, r * 0.58 * sx * (1 + full * 0.2), r * 0.5 * sy * (1 + full * 0.22), 0, 0, Math.PI * 2);
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

  // Feet → legs (v0.6 morphology: legLength gene).
  // Short legs are stubby feet; long legs are visible limbs.
  const legLen = r * (0.1 + p.legLength * 0.55);
  ctx.strokeStyle = dark;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, r * 0.16);
  for (const fx of [-r * 0.45, r * 0.45]) {
    ctx.beginPath();
    ctx.moveTo(fx, -r * 0.25);
    ctx.lineTo(fx + (moving ? Math.sin(c.hopPhase + (fx > 0 ? Math.PI : 0)) * r * 0.15 : 0), -r * 0.25 + legLen);
    ctx.stroke();
  }
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(-r * 0.45, -r * 0.1 + legLen * 0.9, r * 0.32, r * 0.18, 0, 0, Math.PI * 2);
  ctx.ellipse(r * 0.45, -r * 0.1 + legLen * 0.9, r * 0.32, r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Back spikes (v0.6 morphology: spikes gene). Intimidating silhouette.
  // v0.9: fear bristles — the threat display raises the spikes taller.
  const bristle = c.bristling ? 1 : 0;
  if (p.spikes > 0.08) {
    const nSpikes = 2 + Math.round(p.spikes * 4);
    ctx.fillStyle = dark;
    for (let i = 0; i < nSpikes; i++) {
      const t = i / (nSpikes - 1);
      const sxp = -r * 0.7 + t * r * 1.1;
      // Ride along the body's top curve.
      const syp = -r * 0.95 - Math.sqrt(Math.max(0, 1 - Math.pow((sxp) / (r * 1.02), 2))) * r * 0.95;
      const h = r * (0.25 + p.spikes * 0.55) * (1 + bristle * 0.45);
      ctx.beginPath();
      ctx.moveTo(sxp - r * 0.12, syp + r * 0.05);
      ctx.lineTo(sxp, syp - h);
      ctx.lineTo(sxp + r * 0.12, syp + r * 0.05);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Fur (v0.6 morphology: fur gene). A fluffy halo around the body.
  // v0.9: fear puffs the halo thicker — piloerection, the honest signal.
  if (p.fur > 0.08) {
    ctx.strokeStyle = light;
    ctx.globalAlpha = Math.min(1, 0.5 + p.fur * 0.4 + bristle * 0.2);
    ctx.lineWidth = Math.max(2, r * 0.1 * p.fur * (1 + bristle * 0.6));
    const nTufts = 8 + Math.round(p.fur * 10);
    for (let i = 0; i < nTufts; i++) {
      const a = (i / nTufts) * Math.PI * 2 + c.id;
      const rr = rand();
      const fx = Math.cos(a) * r * (1.0 + rr * 0.15);
      const fy = -r * 0.95 + Math.sin(a) * r * (0.92 + rr * 0.15);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.95, -r * 0.95 + Math.sin(a) * r * 0.88);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Ears.
  const earY = -r * 1.75;
  // v0.9: ears flatten back when afraid, perk when alert — expression.
  const earFlat = b.fear * 0.8;
  ctx.fillStyle = base;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(2, r * 0.06);
  if (p.earShape === 'round') {
    for (const ex of [-r * 0.5, r * 0.5]) {
      ctx.save();
      ctx.translate(ex, earY);
      ctx.rotate(-earFlat * 0.7); // back = -x in facing space
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = base;
      ctx.restore();
    }
  } else if (p.earShape === 'pointy') {
    for (const ex of [-r * 0.5, r * 0.5]) {
      ctx.save();
      ctx.translate(ex, earY);
      ctx.rotate(-earFlat * 0.7);
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, r * 0.25);
      ctx.lineTo(0, -r * 0.35);
      ctx.lineTo(r * 0.28, r * 0.25);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  } else { // floppy
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * r * 0.55, earY + r * 0.2);
      ctx.rotate(s * (0.9 + earFlat * 0.5));
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
    // v0.9: gaze — the eyes track what the creature attends to, read from
    // the live sense vector. You see what they see. Idle wander when
    // nothing is sensed.
    let gaze = 0; // -1 = behind, +1 = ahead, in facing space
    const sv = c._senses;
    if (sv) {
      const dir = sv.creatureDist < 0.45 && sv._other ? sv.creatureDir
        : sv.foodDist < 0.55 && sv._food ? sv.foodDir
        : sv.toyDist < 0.5 && sv._toy ? sv.toyDir : 0;
      gaze = dir === 0 ? 0 : (dir === c.facing ? 1 : -1);
    }
    const lookX = gaze !== 0 ? gaze * r * 0.085 : Math.sin(t * 0.7 + c.id) * r * 0.05;
    for (const ex of [r * 0.3, r * 0.72]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex, eyeY, r * 0.24 * eyeScale, 0, Math.PI * 2);
      ctx.fill();
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

  // Mouth (v0.6 morphology): diet is visible. Herbivores get a round grazer
  // mouth, omnivores a beak, carnivores fangs. Size scales with mouthSize.
  {
    const mx = r * 0.55, my = -r * 0.62;
    const ms = (0.6 + p.mouthSize * 0.9) * r * 0.22;
    ctx.fillStyle = dark;
    if (p.diet === 'carnivore') {
      // Open jaw with fangs.
      ctx.beginPath();
      ctx.ellipse(mx, my, ms * 1.3, ms * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      for (const fx of [-ms * 0.55, ms * 0.55]) {
        ctx.beginPath();
        ctx.moveTo(mx + fx - ms * 0.22, my - ms * 0.35);
        ctx.lineTo(mx + fx, my + ms * 0.45);
        ctx.lineTo(mx + fx + ms * 0.22, my - ms * 0.35);
        ctx.closePath();
        ctx.fill();
      }
    } else if (p.diet === 'omnivore') {
      // Beak.
      ctx.beginPath();
      ctx.moveTo(mx - ms * 0.9, my - ms * 0.4);
      ctx.lineTo(mx + ms * 1.1, my + ms * 0.1);
      ctx.lineTo(mx - ms * 0.9, my + ms * 0.6);
      ctx.closePath();
      ctx.fill();
    } else {
      // Round grazer mouth.
      ctx.beginPath();
      ctx.ellipse(mx, my, ms, ms * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // v0.9: wounds show — a red tint riding the injury, a flash on the flinch.
  // The body keeps its history where everyone can see it.
  const woundAlpha = Math.min(0.32, (b.injury || 0) * 0.3 + (c.flinchT || 0) * 0.55);
  if (woundAlpha > 0.01) {
    ctx.fillStyle = `rgba(205,45,40,${woundAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.95, r * 1.02 * sx, r * 0.95 * sy, 0, 0, Math.PI * 2);
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
