// Tanglekin art: procedural monkey-like beings. Every visual trait is read
// from the genome's phenotype, so what you see IS the DNA. Deterministic per
// creature (markings don't swim between frames).
//
// The rig: feet at groundY, facing +x (caller mirrors via ctx.scale).
// Torso ~ (0, -1.15r), head ~ (0.18r, -2.15r), prehensile tail from the rump,
// arms and legs scaled by the legLength gene, fur halo by the fur gene.
// Poses: climb (limbs spread, tail wrapped), groom (lean + arm extended),
// sleep (curled, tail over nose), eat (hands to mouth), bristle (threat
// display), plus the honest-body postures — fear crouch, hunger stoop,
// exhaustion sag, injury limp, illness pallor, senior gray.

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
  const b = c.biochem; // the painter reads the soul — every visible trait
  // below is a sim variable. The painter never invents state.
  const r = creatureRadius(c);
  const rand = hashRand(c.id * 7919 + 13);

  const sleeping = !!c.sleeping;
  const climbing = c.action === 'climb';
  const grooming = c.action === 'groom';
  const eating = c.action === 'eat';
  const bristling = !!c.bristling;
  const moving = !sleeping && !climbing && Math.abs(c.wanderDir) > 0 &&
    (c.action === 'wander' || c.action === 'seekFood' || c.action === 'approach' ||
     c.action === 'play' || c.action === 'mate' || c.action === 'flee' || c.action === 'seekHome');

  // Deterministic markings (fixed draw order — spots never swim).
  const bellyOff = (rand() - 0.5) * r * 0.3;
  const nSpots = Math.round(2 + p.patternDensity * 9);
  const spots = [];
  for (let i = 0; i < nSpots; i++) {
    spots.push({ a: rand() * Math.PI * 2, rr: 0.35 + rand() * 0.5, s: 0.08 + rand() * 0.1 });
  }
  const nRings = 2 + Math.round(p.patternDensity * 4);
  const ringPhase = rand() * Math.PI * 2;
  const crownDark = rand() < 0.6; // darker cap of fur on the crown
  const earTuft = rand() < 0.5 + p.fur * 0.4;

  // Posture numbers.
  const limp = Math.min(1, b.injury || 0);
  const hop = moving ? Math.abs(Math.sin(c.hopPhase)) * r * 0.22 * (1 - limp * 0.45) : 0;
  const breathe = Math.sin(t * 2.2 + c.id) * 0.02;
  const sx = 1 + (moving ? Math.sin(c.hopPhase) * 0.07 : breathe);
  // Fear crouches the body; the bristle display arches it tall.
  const sy = (1 - (moving ? Math.sin(c.hopPhase) * 0.07 : breathe)) *
    (1 - b.fear * 0.07) * (1 + (bristling ? 0.1 : 0));

  // Illness shows as a sickly yellow-green pallor; age grays the coat.
  const ill = Math.min(1, b.illness);
  const lifeT = b.age / (p.lifespanSec || 1);
  const senior = lifeT > 0.8 ? Math.min(1, (lifeT - 0.8) / 0.2) : 0;
  const hueDeg = p.hueDeg + (80 - p.hueDeg) * ill * 0.55;
  const satLoss = ill * 18 + senior * 16;
  const base = shade(hueDeg, 58 - satLoss, 60);
  const dark = shade(hueDeg, 52 - satLoss, 44);
  const light = shade(hueDeg, 65 - satLoss, 80);
  const muzzleC = shade(hueDeg, 40 - satLoss, 78);
  const crownC = shade(hueDeg, 55 - satLoss, 38);

  // Limb lengths from the morphology genes.
  const legLen = r * (0.15 + p.legLength * 0.6); // hip → foot
  const armLen = r * (0.45 + p.legLength * 0.65); // shoulder → hand
  const tailLen = r * (0.9 + p.tailLength * 1.6); // prehensile tail

  ctx.save();
  ctx.translate(c.x, groundY);
  ctx.scale(c.facing, 1);

  ctx.translate(0, -hop);
  // Posture: fear crouches, hunger leans into a foraging stoop, exhaustion
  // sags, age stoops, injury tilts the stride. Grooming leans toward the
  // partner. Standing tall is contentment made visible.
  ctx.translate(0, b.fear * r * 0.26 + (1 - b.energy) * r * 0.13);
  ctx.rotate(b.hunger * 0.1 + senior * 0.05 + (grooming ? 0.14 : 0) + (climbing ? -0.06 : 0));
  if (limp > 0.02) ctx.rotate(Math.sin(c.hopPhase) * 0.09 * limp);
  if (sleeping) {
    // Curled: the whole animal becomes a ball, tail over the nose.
    ctx.translate(0, r * 0.42);
    ctx.scale(1.12, 0.74);
  }

  const torsoY = -r * 1.15;
  const headX = r * 0.18, headY = -r * 2.12, headR = r * 0.6;

  // ---- Tail (behind everything). ----
  {
    const sway = Math.sin(t * (c.mood === 'content' ? 3.4 : 1.8) + c.id * 2) * r * 0.16;
    ctx.strokeStyle = dark;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.17 * (1 + (bristling ? 0.5 : 0))); // bristle puffs the tail
    ctx.beginPath();
    const bx = -r * 0.72, by = torsoY + r * 0.35; // rump
    if (climbing) {
      // Wrapped: the tail coils around the branch — the fifth limb.
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - tailLen * 0.5, by + r * 0.35,
        bx - tailLen * 0.25, by + r * 0.55);
      ctx.quadraticCurveTo(bx, by + r * 0.7, bx + tailLen * 0.2, by + r * 0.45);
    } else if (sleeping) {
      // Over the nose: curled right around to the face.
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - tailLen * 0.7, by - r * 0.4,
        headX + r * 0.3, headY + r * 0.42);
    } else {
      // The classic curl: up behind, tip swaying.
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - tailLen * 0.55, by - tailLen * 0.25 + sway,
        bx - tailLen * 0.35, by - tailLen * 0.75 + sway * 1.7);
      ctx.quadraticCurveTo(bx - tailLen * 0.2, by - tailLen * 1.0 + sway * 2,
        bx + tailLen * 0.05, by - tailLen * 0.92 + sway * 1.6);
    }
    ctx.stroke();
    // Tail rings — deterministic bands from the pattern gene.
    if (p.pattern !== 'stripes' || true) {
      ctx.strokeStyle = crownC;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(2, r * 0.06);
      for (let i = 1; i <= nRings; i++) {
        const tt = i / (nRings + 1);
        const rx = bx - tailLen * 0.35 * tt - tailLen * 0.1 * Math.sin(ringPhase + tt * 5);
        const ry = by - tailLen * 0.75 * tt + sway * tt;
        ctx.beginPath();
        ctx.moveTo(rx - r * 0.09, ry);
        ctx.lineTo(rx + r * 0.09, ry);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Tail tip tuft.
    ctx.fillStyle = light;
    const tipX = climbing ? bx + tailLen * 0.2 : sleeping ? headX + r * 0.3 : bx + tailLen * 0.05;
    const tipY = climbing ? by + r * 0.45 : sleeping ? headY + r * 0.42 : by - tailLen * 0.92 + sway * 1.6;
    ctx.beginPath();
    ctx.arc(tipX, tipY, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Legs + feet. ----
  {
    ctx.strokeStyle = dark;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.17);
    const hips = [[-r * 0.32, torsoY + r * 0.62], [r * 0.32, torsoY + r * 0.62]];
    hips.forEach(([hx, hy], i) => {
      let fx, fy, bend;
      if (climbing) {
        // Knees bent, gripping — feet planted wide.
        fx = hx + (i === 0 ? -r * 0.35 : r * 0.45);
        fy = -r * 0.32;
        bend = r * 0.3;
      } else if (sleeping) {
        fx = hx * 0.7; fy = -r * 0.28; bend = -r * 0.1; // tucked
      } else {
        const swing = moving ? Math.sin(c.hopPhase + (i === 0 ? 0 : Math.PI)) * r * 0.18 : 0;
        fx = hx + swing;
        fy = -legLen * 0.2;
        bend = r * 0.08;
      }
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo((hx + fx) / 2 + bend, (hy + fy) / 2, fx, fy);
      ctx.stroke();
      // Foot.
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(fx + r * 0.08, fy + r * 0.03, r * 0.3, r * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---- Torso. ----
  {
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.ellipse(0, torsoY, r * 0.88 * sx, r * 1.0 * sy, 0, 0, Math.PI * 2);
    ctx.fill();
    // Belly patch — paler, and satiety shows: a full belly swells.
    const full = 1 - b.hunger;
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(r * 0.1 + bellyOff * 0.3, torsoY + r * 0.25,
      r * 0.55 * sx * (1 + full * 0.18), r * 0.62 * sy * (1 + full * 0.2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Fur markings: spots or stripes, clipped to the torso.
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, torsoY, r * 0.88 * sx, r * 1.0 * sy, 0, 0, Math.PI * 2);
    ctx.clip();
    if (p.pattern === 'stripes') {
      const n = 3 + Math.round(p.patternDensity * 3);
      for (let i = 0; i < n; i++) {
        const px = -r * 0.7 + (i / (n - 1)) * r * 1.4;
        ctx.fillRect(px - r * 0.06, torsoY - r * 1.2, r * 0.12, r * 2.4);
      }
    } else {
      for (const s of spots) {
        const px = Math.cos(s.a) * r * 0.6 * s.rr;
        const py = torsoY + Math.sin(s.a) * r * 0.75 * s.rr;
        ctx.beginPath();
        ctx.arc(px, py, r * s.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---- Fur halo (around torso). ----
  // Fear puffs it; the bristle display spikes it out — piloerection, honest.
  if (p.fur > 0.08 || bristling) {
    const halo = Math.max(p.fur, bristling ? 0.45 : 0);
    ctx.strokeStyle = light;
    ctx.globalAlpha = Math.min(1, 0.45 + halo * 0.45);
    ctx.lineCap = 'round';
    const nTufts = 10 + Math.round(halo * 12);
    for (let i = 0; i < nTufts; i++) {
      const a = (i / nTufts) * Math.PI * 2 + c.id;
      const len = r * (0.12 + halo * 0.3) * (bristling ? 1.7 : 1);
      const x0 = Math.cos(a) * r * 0.85, y0 = torsoY + Math.sin(a) * r * 0.95;
      ctx.lineWidth = Math.max(2, r * 0.07 * (bristling ? 1.6 : 1));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Arms. ----
  {
    const shX = r * 0.32, shY = torsoY - r * 0.42; // shoulder
    ctx.strokeStyle = base;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.15);
    const drawArm = (x0, y0, x1, y1, bendX, bendY, handR) => {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2 + bendX, (y0 + y1) / 2 + bendY, x1, y1);
      ctx.stroke();
      ctx.fillStyle = dark; // hand
      ctx.beginPath();
      ctx.arc(x1, y1, handR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = base;
    };
    if (climbing) {
      // Reaching up, gripping the branch above.
      drawArm(shX, shY, shX + r * 0.35, shY - armLen * 0.95, r * 0.15, 0, r * 0.14);
      drawArm(shX - r * 0.5, shY, shX - r * 0.15, shY - armLen * 0.85, -r * 0.1, 0, r * 0.14);
    } else if (sleeping) {
      // Tucked — arms folded, barely visible.
      drawArm(shX, shY, shX - r * 0.15, shY + armLen * 0.4, r * 0.2, 0, r * 0.12);
    } else if (grooming) {
      // One arm extended toward the partner, the other at the chest.
      const reach = Math.sin(t * 3 + c.id) * r * 0.06; // working the fur
      drawArm(shX, shY, shX + r * 1.25, shY + r * 0.15 + reach, 0, -r * 0.1, r * 0.13);
      drawArm(shX - r * 0.4, shY, shX - r * 0.1, shY + armLen * 0.45, -r * 0.15, 0, r * 0.12);
    } else if (eating) {
      // Hands to the mouth, alternating.
      const m = Math.sin(t * 6 + c.id) > 0 ? 1 : -1;
      drawArm(shX, shY, headX + r * 0.42, headY + r * 0.3, r * 0.2, r * 0.1, r * 0.12);
      drawArm(shX - r * 0.4, shY, headX + r * 0.3 + m * r * 0.12, headY + r * 0.42, -r * 0.1, r * 0.15, r * 0.12);
    } else {
      // Hanging arms, swinging with the gait; knuckle-drag when moving.
      const swing = moving ? Math.sin(c.hopPhase) * r * 0.22 : Math.sin(t * 1.4 + c.id) * r * 0.03;
      const drop = moving ? -r * 0.1 : 0;
      drawArm(shX, shY, shX + swing, shY + armLen * 0.85 + drop, r * 0.08, 0, r * 0.13);
      drawArm(shX - r * 0.45, shY + r * 0.1, shX - r * 0.45 - swing * 0.8, shY + armLen * 0.8 + drop, -r * 0.08, 0, r * 0.13);
    }
  }

  // ---- Head. ----
  {
    // Far ear first (behind the head).
    const earFlat = b.fear * 0.8;
    const drawEar = (ex, ey, s) => {
      ctx.save();
      ctx.translate(ex, ey);
      if (p.earShape === 'pointy') {
        ctx.rotate(-earFlat * 0.4);
        ctx.fillStyle = base;
        ctx.strokeStyle = dark;
        ctx.lineWidth = Math.max(2, r * 0.05);
        ctx.beginPath();
        ctx.moveTo(-r * 0.2 * s, r * 0.14 * s);
        ctx.lineTo(0, -r * 0.3 * s);
        ctx.lineTo(r * 0.2 * s, r * 0.14 * s);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        if (earTuft) { // tuft on the tip
          ctx.strokeStyle = light;
          ctx.lineWidth = Math.max(2, r * 0.05);
          ctx.beginPath();
          ctx.moveTo(0, -r * 0.3 * s);
          ctx.lineTo(0, -r * 0.44 * s);
          ctx.stroke();
        }
      } else if (p.earShape === 'floppy') {
        ctx.rotate(s * (0.7 + earFlat * 0.4));
        ctx.fillStyle = base;
        ctx.strokeStyle = dark;
        ctx.lineWidth = Math.max(2, r * 0.05);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.2 * s, r * 0.16 * s, r * 0.36 * s, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      } else { // round monkey ear
        ctx.rotate(-earFlat * 0.5);
        ctx.fillStyle = base;
        ctx.strokeStyle = dark;
        ctx.lineWidth = Math.max(2, r * 0.05);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.24 * s, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = muzzleC;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.12 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    drawEar(headX + r * 0.1, headY - r * 0.32, 0.8); // far ear, smaller

    // Skull.
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    // Crown cap — a darker cap of fur, some tanglekins have it.
    if (crownDark) {
      ctx.fillStyle = crownC;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(headX - r * 0.05, headY - r * 0.12, headR * 0.92, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Near ear.
    drawEar(headX - r * 0.42, headY - r * 0.18, 1.0);

    // Muzzle — the monkey's face.
    const mzX = headX + r * 0.38, mzY = headY + r * 0.22;
    ctx.fillStyle = muzzleC;
    ctx.beginPath();
    ctx.ellipse(mzX, mzY, r * 0.34, r * 0.26, 0.15, 0, Math.PI * 2);
    ctx.fill();
    // Nose.
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(mzX + r * 0.2, mzY - r * 0.05, r * 0.07, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes.
    const eyeScale = 0.7 + p.eyeSize * 0.8;
    const eyeY = headY - r * 0.14;
    if (sleeping) {
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(2, r * 0.06);
      for (const ex of [headX + r * 0.12, headX + r * 0.48]) {
        ctx.beginPath();
        ctx.arc(ex, eyeY, r * 0.14 * eyeScale, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
    } else {
      // Gaze tracks what the creature attends to — you see what they see.
      let gaze = 0;
      const sv = c._senses;
      if (sv) {
        const dir = sv.creatureDist < 0.45 && sv._other ? sv.creatureDir
          : sv.foodDist < 0.55 && sv._food ? sv.foodDir
          : sv.toyDist < 0.5 && sv._toy ? sv.toyDir : 0;
        gaze = dir === 0 ? 0 : (dir === c.facing ? 1 : -1);
      }
      const lookX = gaze !== 0 ? gaze * r * 0.07 : Math.sin(t * 0.7 + c.id) * r * 0.04;
      const wide = 1 + b.fear * 0.35; // fear widens the eyes
      for (const ex of [headX + r * 0.12, headX + r * 0.48]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, r * 0.2 * eyeScale * wide, r * 0.23 * eyeScale * wide, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2a2438';
        ctx.beginPath();
        ctx.arc(ex + r * 0.05 + lookX, eyeY + r * 0.03, r * 0.11 * eyeScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex + r * 0.08 + lookX, eyeY - r * 0.01, r * 0.04 * eyeScale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Mouth on the muzzle — the diet gene stays honest, monkey-style:
    // carnivores show a hint of fang, omnivores a wide mouth, herbivores
    // flat grazer lips. Opens with eating and mouthSize.
    {
      const open = eating ? (0.5 + 0.5 * Math.abs(Math.sin(t * 6 + c.id))) : 0;
      const ms = (0.5 + p.mouthSize * 0.8) * r * 0.2;
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.fillStyle = '#5a2f35';
      if (open > 0.05) {
        ctx.beginPath();
        ctx.ellipse(mzX + r * 0.1, mzY + r * 0.14, ms * (0.7 + open * 0.5), ms * 0.45 * open + r * 0.02, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(mzX - r * 0.12, mzY + r * 0.12);
      ctx.quadraticCurveTo(mzX + r * 0.1, mzY + r * (0.16 + open * 0.1), mzX + r * 0.3, mzY + r * 0.1);
      ctx.stroke();
      if (p.diet === 'carnivore') {
        ctx.fillStyle = '#fff';
        for (const fx of [-r * 0.05, r * 0.12]) {
          ctx.beginPath();
          ctx.moveTo(mzX + fx - r * 0.04, mzY + r * 0.1);
          ctx.lineTo(mzX + fx, mzY + r * (0.2 + open * 0.12));
          ctx.lineTo(mzX + fx + r * 0.04, mzY + r * 0.1);
          ctx.closePath();
          ctx.fill();
        }
      } else if (p.diet === 'omnivore') {
        ctx.lineWidth = Math.max(2, r * 0.06);
        ctx.beginPath();
        ctx.moveTo(mzX - r * 0.14, mzY + r * 0.12);
        ctx.quadraticCurveTo(mzX + r * 0.1, mzY + r * 0.22, mzX + r * 0.34, mzY + r * 0.08);
        ctx.stroke();
      }
    }
  }

  // Head fur halo — cheek ruffs, thicker with the fur gene.
  if (p.fur > 0.15 || bristling) {
    const halo = Math.max(p.fur, bristling ? 0.4 : 0);
    ctx.strokeStyle = light;
    ctx.globalAlpha = 0.5 + halo * 0.4;
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.6 + (i / 6) * 1.3); // around the cheeks/back of head
      const len = r * (0.1 + halo * 0.25) * (bristling ? 1.6 : 1);
      const x0 = headX + Math.cos(a) * headR * 0.95;
      const y0 = headY + Math.sin(a) * headR * 0.95;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Wounds show — a red tint riding the injury, a flash on the flinch.
  // The body keeps its history where everyone can see it.
  const woundAlpha = Math.min(0.32, (b.injury || 0) * 0.3 + (c.flinchT || 0) * 0.55);
  if (woundAlpha > 0.01) {
    ctx.fillStyle = `rgba(205,45,40,${woundAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, torsoY, r * 0.88 * sx, r * 1.0 * sy, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sleeping Z's.
  if (sleeping) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.max(12, r * 0.5)}px sans-serif`;
    const zoff = (t * 20) % 40;
    ctx.fillText('z', r * 0.9, -r * 2.0 - zoff * 0.5);
    ctx.globalAlpha = 0.6;
    ctx.fillText('z', r * 1.15, -r * 2.2 - zoff * 0.35);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// The Teacher — Sunny's in-sim avatar (v0.14 "Voices"). A blue monkey in a
// jaunty newsboy cap: visually NOT a tanglekin (tanglekins never wear caps,
// and their fur hue comes from the genome — the Teacher is always this
// blue). Feet at groundY, facing +x (caller mirrors via ctx.scale).
// Poses: perching (sitting, tail curled), traveling (bob), demonstrating
// (sound arcs from the mouth), rewarding (a lifted hand + sparkle).
export function drawTeacher(ctx, teacher, groundY, t) {
  const r = 20; // the Teacher is a fixed presence — not genome-sized
  const moving = Math.abs(teacher.vx) > 1;
  const demonstrating = (teacher.demoQueue || []).length > 0;
  const rewarding = /reward/.test(teacher.actionLabel || '');

  const hop = moving ? Math.abs(Math.sin(teacher.hopPhase)) * r * 0.2 : 0;
  const breathe = moving ? 0 : Math.sin(t * 2.2) * 0.015;

  // Sunny blue.
  const fur = '#2f6fd0';
  const furDark = '#1e4f9e';
  const furLight = '#5b93e8';
  const muzzleC = '#bcd2f5';
  const capC = '#2b2f3a';   // charcoal newsboy cap
  const capBand = '#171a22';

  ctx.save();
  ctx.translate(teacher.x, groundY);
  ctx.scale(teacher.facing || 1, 1);
  ctx.translate(0, -hop);
  ctx.scale(1, 1 + breathe);

  const sit = !moving ? r * 0.28 : 0; // perching settles the body down
  const torsoY = -r * 1.05 + sit;
  const headX = r * 0.22, headY = -r * 1.98 + sit * 0.6, headR = r * 0.58;

  // ---- Tail (behind): a curling monkey tail. ----
  {
    ctx.strokeStyle = furDark;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    const sway = Math.sin(t * 1.8) * r * 0.12;
    ctx.moveTo(-r * 0.6, torsoY + r * 0.4);
    ctx.quadraticCurveTo(-r * 1.5, torsoY + r * 0.9 + sway,
      -r * 1.15, torsoY - r * 0.15 + sway);
    ctx.quadraticCurveTo(-r * 0.95, torsoY - r * 0.5, -r * 0.7, torsoY - r * 0.35);
    ctx.stroke();
  }

  // ---- Legs / feet. ----
  ctx.fillStyle = furDark;
  const legSpread = moving ? Math.sin(teacher.hopPhase) * r * 0.22 : r * 0.1;
  ctx.beginPath();
  ctx.ellipse(-r * 0.25 - legSpread * 0.3, -r * 0.12 + sit * 0.4, r * 0.3, r * 0.2, 0, 0, Math.PI * 2);
  ctx.ellipse(r * 0.25 + legSpread * 0.3, -r * 0.12 + sit * 0.4, r * 0.3, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- Torso. ----
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, torsoY, r * 0.62, r * 0.78, 0, 0, Math.PI * 2);
  ctx.fill();
  // lighter chest
  ctx.fillStyle = furLight;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(r * 0.1, torsoY + r * 0.05, r * 0.34, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // ---- Arms. ----
  ctx.strokeStyle = fur;
  ctx.lineWidth = r * 0.2;
  const armSwing = moving ? Math.sin(teacher.hopPhase + Math.PI) * r * 0.3 : 0;
  ctx.beginPath();
  ctx.moveTo(-r * 0.4, torsoY - r * 0.3);
  ctx.lineTo(-r * 0.55 + armSwing * 0.4, torsoY + r * 0.45);
  ctx.stroke();
  // Right arm lifts when rewarding — the "good, that one" gesture.
  ctx.beginPath();
  ctx.moveTo(r * 0.4, torsoY - r * 0.3);
  if (rewarding) ctx.lineTo(r * 0.9, torsoY - r * 1.0);
  else ctx.lineTo(r * 0.55 - armSwing * 0.4, torsoY + r * 0.45);
  ctx.stroke();
  if (rewarding) {
    // sparkle at the lifted hand
    const sx = r * 0.9, sy = torsoY - r * 1.05 + Math.sin(t * 6) * 2;
    ctx.strokeStyle = 'rgba(255,215,110,0.95)';
    ctx.lineWidth = 2;
    for (const a of [0, Math.PI / 2]) {
      ctx.beginPath();
      ctx.moveTo(sx - Math.cos(a) * 7, sy - Math.sin(a) * 7);
      ctx.lineTo(sx + Math.cos(a) * 7, sy + Math.sin(a) * 7);
      ctx.stroke();
    }
  }

  // ---- Head. ----
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.fillStyle = furDark;
  ctx.beginPath();
  ctx.arc(headX - headR * 0.85, headY - headR * 0.1, headR * 0.28, 0, Math.PI * 2);
  ctx.fill();
  // muzzle
  ctx.fillStyle = muzzleC;
  ctx.beginPath();
  ctx.ellipse(headX + headR * 0.35, headY + headR * 0.28, headR * 0.42, headR * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // eyes — bright, forward
  ctx.fillStyle = '#101418';
  ctx.beginPath();
  ctx.arc(headX + headR * 0.12, headY - headR * 0.12, headR * 0.11, 0, Math.PI * 2);
  ctx.arc(headX + headR * 0.52, headY - headR * 0.12, headR * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(headX + headR * 0.15, headY - headR * 0.15, headR * 0.035, 0, Math.PI * 2);
  ctx.arc(headX + headR * 0.55, headY - headR * 0.15, headR * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // ---- The newsboy cap, worn jaunty. ----
  ctx.save();
  ctx.translate(headX + headR * 0.05, headY - headR * 0.62);
  ctx.rotate(-0.22); // the jaunty tilt — never straightened
  // dome
  ctx.fillStyle = capC;
  ctx.beginPath();
  ctx.ellipse(0, 0, headR * 0.78, headR * 0.42, 0, Math.PI, 0);
  ctx.fill();
  // band
  ctx.fillStyle = capBand;
  ctx.fillRect(-headR * 0.78, -headR * 0.08, headR * 1.56, headR * 0.14);
  // brim
  ctx.fillStyle = capC;
  ctx.beginPath();
  ctx.ellipse(headR * 0.62, headR * 0.02, headR * 0.42, headR * 0.13, 0.12, 0, Math.PI * 2);
  ctx.fill();
  // button
  ctx.fillStyle = '#0d0f14';
  ctx.beginPath();
  ctx.arc(0, -headR * 0.42, headR * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ---- Demonstration: sound arcs from the mouth. ----
  if (demonstrating) {
    const mx = headX + headR * 0.75, my = headY + headR * 0.3;
    ctx.strokeStyle = 'rgba(255,220,130,0.9)';
    for (let i = 0; i < 3; i++) {
      const ph = ((t * 1.6 + i / 3) % 1);
      ctx.globalAlpha = 0.85 * (1 - ph);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(mx, my, headR * (0.6 + ph * 1.6), -0.7, 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
