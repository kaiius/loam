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

// v0.17 "Bauplan": draw one erupted non-founder bud limb. o carries the
// painter's local numbers (r, torsoY, headX, headY, colors, t, c). Each
// type gets its own honest shape; a nub (grow01 < 0.4) is a stub regardless
// of type — the half-built organ, drawn as what it is.
function drawBudLimb(ctx, limb, o) {
  const { r, torsoY, headX, headY, limbBase, limbDark, t, c } = o;
  const ax0 = { shoulder: r * 0.32, hip: -r * 0.32, dorsal: 0, mid: 0, neck: headX - r * 0.25 }[limb.site] ?? 0;
  const ay0 = { shoulder: torsoY - r * 0.42, hip: torsoY + r * 0.62, dorsal: torsoY - r * 0.85, mid: torsoY + r * 0.25, neck: headY + r * 0.45 }[limb.site] ?? torsoY;
  const ax = ax0 + (limb.side === 'L' ? -r * 0.15 : r * 0.15);
  const ay = ay0;
  const len = limb.lenPx;
  const sway = Math.sin(t * 1.7 + c.id + (limb.side === 'L' ? 0 : 2)) * r * 0.04;
  ctx.strokeStyle = limb.type === 'grasp' ? limbBase : limbDark;
  ctx.fillStyle = limbDark;
  ctx.lineCap = 'round';
  if (limb.grow01 < 0.4) {
    // A nub: the honest half-built organ — a stub, nothing more.
    const nl = len * 0.3 * (limb.grow01 / 0.4);
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + sway, ay + nl * 0.6);
    ctx.stroke();
    return;
  }
  if (limb.type === 'grasp') {
    // A working extra limb: tapered curve + hand.
    const dx = limb.site === 'dorsal' ? r * 0.3 : (limb.side === 'L' ? -r * 0.5 : r * 0.5);
    ctx.lineWidth = Math.max(3, r * 0.13);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax + dx * 0.4, ay + len * 0.5, ax + dx + sway, ay + len * 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ax + dx + sway, ay + len * 0.9, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (limb.type === 'membrane') {
    // A wing: folded against the body, or spread flat while gliding.
    const spread = c.gliding ? 1 : 0.35;
    const span = len * spread;
    const sxm = limb.side === 'L' ? -1 : 1;
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax + sxm * span, ay - len * 0.3,
      ax + sxm * span * 1.2, ay + len * 0.25 + sway);
    ctx.quadraticCurveTo(ax + sxm * span * 0.5, ay + len * 0.1, ax, ay);
    ctx.stroke();
    return;
  }
  if (limb.type === 'sail') {
    // A display frill: an arc behind the attach point.
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.beginPath();
    ctx.arc(ax, ay - len * 0.2, len * 0.55, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  if (limb.type === 'gill') {
    // Filament tuft: short breathing strokes.
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    for (let i = 0; i < 4; i++) {
      const gx = ax + (i - 1.5) * r * 0.12;
      ctx.beginPath();
      ctx.moveTo(gx, ay);
      ctx.quadraticCurveTo(gx + sway * 2, ay + len * 0.2, gx + sway * 3, ay + len * 0.4);
      ctx.stroke();
    }
    return;
  }
  // fin: a paddle — thick short limb with a flattened blade.
  ctx.lineWidth = Math.max(3, r * 0.14);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(ax + sway, ay + len * 0.4, ax + sway * 2, ay + len * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(ax + sway * 2, ay + len * 0.75, r * 0.22, r * 0.1, 0.4, 0, Math.PI * 2);
  ctx.fill();
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
  const brachiating = c.action === 'brachiate' && c.brachiating; // v0.17: arm-swinging under the branch
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

  // v0.15 "Bloom": regional pigmentation — head, torso, and limbs read
  // their own hue/sat genes, so selection can paint regions independently.
  // Founder values (0.5) → zero offset: the classic look is unchanged.
  const torsoHue = hueDeg + (p.pigTorsoHueDeg ?? 0);
  const torsoSat = 58 - satLoss + (p.pigTorsoSatShift ?? 0) / 2;
  const torsoBase = shade(torsoHue, torsoSat, 60);
  const torsoDark = shade(torsoHue, torsoSat - 6, 44);
  const headHue = hueDeg + (p.pigHeadHueDeg ?? 0);
  const headSat = 58 - satLoss + (p.pigHeadSatShift ?? 0) / 2;
  const headBase = shade(headHue, headSat, 60);
  const headDark = shade(headHue, headSat - 6, 44);
  const headMuzzle = shade(headHue, 40 - satLoss, 78);
  const headCrown = shade(headHue, 55 - satLoss, 38);
  const limbHue = hueDeg + (p.pigLimbsHueDeg ?? 0);
  const limbSat = 52 - satLoss + (p.pigLimbsSatShift ?? 0) / 2;
  const limbBase = shade(limbHue, limbSat + 6, 60);
  const limbDark = shade(limbHue, limbSat, 44);
  // Regional patterns: 'none' (the founder) falls back to the classic
  // whole-body pattern gene; an explicit regional pattern overrides it.
  const torsoPat = (p.pigTorsoPat && p.pigTorsoPat !== 'none') ? p.pigTorsoPat : p.pattern;
  const headPat = (p.pigHeadPat && p.pigHeadPat !== 'none') ? p.pigHeadPat : null;
  const limbPat = (p.pigLimbsPat && p.pigLimbsPat !== 'none') ? p.pigLimbsPat : null;

  // Limb lengths from the morphology genes.
  const legLen = r * (0.15 + p.legLength * 0.6); // hip → foot
  // v0.15: armLength replaces legLength in the arm formula (founder → same).
  const armLen = r * (0.45 + (p.armLength ?? p.legLength) * 0.65); // shoulder → hand
  const tailLen = r * (0.9 + p.tailLength * 1.6); // prehensile tail
  // v0.15: tailCurl scales how tightly the tail coils (founder → as before).
  const tailCurlK = 0.6 + (p.tailCurl ?? 0.5) * 0.8;
  // v0.15: bulk is body girth — the torso's width (founder → as before).
  const bulkK = 0.7 + (p.bulk ?? 0.5) * 0.36; // ×0.88 at founder

  // v0.17 "Bauplan": the realized body plan. Old saves (bodyPlan null)
  // draw the legacy animal — every gate below treats null as the founder.
  const bp = c.bodyPlan || null;
  const segK = 0.75 + 0.25 * (bp ? bp.bodySegs : 1); // serpentine elongation — ×1.0 at founder
  const nTails = bp ? bp.tails : 1;
  const hipGrasp = !bp || bp.limbs.some((l) => l.site === 'hip' && l.type === 'grasp');
  const shoulderGrasp = !bp || bp.limbs.some((l) => l.site === 'shoulder' && l.type === 'grasp');
  // Every erupted bud that isn't a founder grasp limb draws in the extra
  // loop — the founder's four grasp limbs are the legacy blocks above.
  const extraLimbs = bp ? bp.limbs.filter((l) => !(l.type === 'grasp' && (l.site === 'shoulder' || l.site === 'hip'))) : [];

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
  if (brachiating) ctx.translate(0, r * 0.55); // v0.17: the body hangs below the branch
  if (sleeping) {
    // Curled: the whole animal becomes a ball, tail over the nose.
    ctx.translate(0, r * 0.42);
    ctx.scale(1.12, 0.74);
  }

  const torsoY = -r * 1.15;
  const headX = r * 0.18, headY = -r * 2.12, headR = r * 0.6;

  // ---- Tail (behind everything). ----
  // v0.17: tailCount — extra tails fan out beside the first. Founder: one.
  for (let ti = 0; ti < nTails; ti++) {
    const sway = Math.sin(t * (c.mood === 'content' ? 3.4 : 1.8) + c.id * 2) * r * 0.16;
    ctx.strokeStyle = limbDark; // v0.15: limbs read the limb pigment genes
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.17 * (1 + (bristling ? 0.5 : 0)) * (1 - ti * 0.18)); // bristle puffs the tail
    ctx.beginPath();
    const bx = -r * 0.72 + ti * r * 0.24, by = torsoY + r * 0.35 + ti * r * 0.1; // rump
    if (climbing) {
      // Wrapped: the tail coils around the branch — the fifth limb.
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - tailLen * 0.5 * tailCurlK, by + r * 0.35,
        bx - tailLen * 0.25 * tailCurlK, by + r * 0.55);
      ctx.quadraticCurveTo(bx, by + r * 0.7, bx + tailLen * 0.2, by + r * 0.45);
    } else if (sleeping) {
      // Over the nose: curled right around to the face.
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - tailLen * 0.7 * tailCurlK, by - r * 0.4,
        headX + r * 0.3, headY + r * 0.42);
    } else {
      // The classic curl: up behind, tip swaying.
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - tailLen * 0.55 * tailCurlK, by - tailLen * 0.25 + sway,
        bx - tailLen * 0.35 * tailCurlK, by - tailLen * 0.75 + sway * 1.7);
      ctx.quadraticCurveTo(bx - tailLen * 0.2 * tailCurlK, by - tailLen * 1.0 + sway * 2,
        bx + tailLen * 0.05, by - tailLen * 0.92 + sway * 1.6);
    }
    ctx.stroke();
    // Tail rings — deterministic bands; the limb pattern gene can restyle them.
    if (p.pattern !== 'stripes' || true) {
      ctx.strokeStyle = limbPat === 'stripes' ? limbDark : crownC;
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
  // v0.17: drawn only while the hip bud erupts as grasp — vestigial hips
  // leave no legs; the founder always has them.
  if (hipGrasp) {
    ctx.strokeStyle = limbDark;
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
      ctx.fillStyle = limbDark;
      ctx.beginPath();
      ctx.ellipse(fx + r * 0.08, fy + r * 0.03, r * 0.3, r * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---- Torso. ----
  {
    ctx.fillStyle = torsoBase; // v0.15: torso reads the torso pigment genes
    ctx.beginPath();
    ctx.ellipse(0, torsoY, r * bulkK * sx * segK, r * 1.0 * sy, 0, 0, Math.PI * 2); // v0.17: serpentine plans elongate
    ctx.fill();
    // Belly patch — paler, and satiety shows: a full belly swells.
    const full = 1 - b.hunger;
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(r * 0.1 + bellyOff * 0.3, torsoY + r * 0.25,
      r * 0.55 * sx * segK * (1 + full * 0.18), r * 0.62 * sy * (1 + full * 0.2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Fur markings: spots or stripes, clipped to the torso.
    ctx.fillStyle = torsoDark;
    ctx.globalAlpha = 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, torsoY, r * bulkK * sx * segK, r * 1.0 * sy, 0, 0, Math.PI * 2);
    ctx.clip();
    if (torsoPat === 'stripes') {
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
  // v0.17: drawn only while the shoulder bud erupts as grasp — a shoulder
  // that became a membrane draws in the extra loop instead.
  if (shoulderGrasp) {
    const shX = r * 0.32, shY = torsoY - r * 0.42; // shoulder
    ctx.strokeStyle = limbBase;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.15);
    const drawArm = (x0, y0, x1, y1, bendX, bendY, handR) => {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2 + bendX, (y0 + y1) / 2 + bendY, x1, y1);
      ctx.stroke();
      ctx.fillStyle = limbDark; // hand
      ctx.beginPath();
      ctx.arc(x1, y1, handR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = limbBase;
    };
    if (climbing || brachiating) {
      // Reaching up, gripping the branch above — the brachiator hangs
      // from the same grip.
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

  // ---- v0.17 "Bauplan": extra limbs. ----
  // Every erupted bud that isn't a founder grasp limb draws here, from its
  // own site, in its own type's shape. The founder draws nothing here —
  // its four grasp limbs are the legacy blocks above.
  const budEnv = { r, torsoY, headX, headY, limbBase, limbDark, light, t, c };
  for (const limb of extraLimbs) drawBudLimb(ctx, limb, budEnv);

  // ---- Head. ----
  {
    // Far ear first (behind the head).
    const earFlat = b.fear * 0.8;
    // v0.15: earSize scales the ears, earTilt sets their jaunty angle.
    // Founder values (0.5) → scale 1.0, tilt 0: unchanged.
    const earK = p.earScale ?? 1;
    const earTilt = p.earTiltRad ?? 0;
    const drawEar = (ex, ey, s) => {
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(earTilt * s);
      s *= earK;
      if (p.earShape === 'pointy') {
        ctx.rotate(-earFlat * 0.4);
        ctx.fillStyle = headBase;
        ctx.strokeStyle = headDark;
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
        ctx.fillStyle = headBase;
        ctx.strokeStyle = headDark;
        ctx.lineWidth = Math.max(2, r * 0.05);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.2 * s, r * 0.16 * s, r * 0.36 * s, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      } else { // round monkey ear
        ctx.rotate(-earFlat * 0.5);
        ctx.fillStyle = headBase;
        ctx.strokeStyle = headDark;
        ctx.lineWidth = Math.max(2, r * 0.05);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.24 * s, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = headMuzzle;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.12 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    drawEar(headX + r * 0.1, headY - r * 0.32, 0.8); // far ear, smaller

    // Skull.
    ctx.fillStyle = headBase; // v0.15: head reads the head pigment genes
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    // Head markings from the head pattern gene (founder 'none' → plain skull).
    if (headPat === 'spots' || headPat === 'stripes') {
      ctx.fillStyle = headDark;
      ctx.globalAlpha = 0.45;
      const hspots = spots.slice(0, 5);
      for (const s of hspots) {
        const px = headX + Math.cos(s.a) * headR * 0.55 * s.rr;
        const py = headY + Math.sin(s.a) * headR * 0.55 * s.rr - headR * 0.15;
        ctx.beginPath();
        if (headPat === 'stripes') ctx.fillRect(px - headR * 0.05, py - headR * 0.25, headR * 0.1, headR * 0.5);
        else ctx.arc(px, py, headR * 0.09 * s.s * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Crown cap — a darker cap of fur, some tanglekins have it.
    if (crownDark) {
      ctx.fillStyle = headCrown;
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
    ctx.fillStyle = headMuzzle;
    ctx.beginPath();
    ctx.ellipse(mzX, mzY, r * 0.34, r * 0.26, 0.15, 0, Math.PI * 2);
    ctx.fill();
    // Nose.
    ctx.fillStyle = headDark;
    ctx.beginPath();
    ctx.ellipse(mzX + r * 0.2, mzY - r * 0.05, r * 0.07, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes.
    const eyeScale = 0.7 + p.eyeSize * 0.8;
    const eyeY = headY - r * 0.14;
    if (sleeping) {
      ctx.strokeStyle = headDark;
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
      ctx.strokeStyle = headDark;
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
// v0.18 "Realms": environment painting — biome ground, water, and predators.
//
// The biome data module (../sim/biomes.js) is landed by the sim agents;
// the renderer resolves it and passes it in here as plain data, so this
// file never imports it. All colors below are keyed off the 8 biome keys.

export const BIOME_KEYS = [
  'arctic', 'mountains', 'jungle', 'plains',
  'desert', 'shallows', 'archipelago', 'deep',
];

// Nominal palette per biome. The ground band is ambience, not physics —
// creatures stand on platforms, not on this paint. The band's TOP comes
// from the sim's own groundYAt(x) (null = open water, painted as abyss).
const BIOME_GROUND = {
  arctic:      { ground: [216, 230, 242], tint: 'rgba(190,215,235,0.15)', name: 'ARCTIC WASTES' },
  mountains:   { ground: [74, 78, 88],    tint: 'rgba(120,125,140,0.14)', name: 'SKYREACH MOUNTAINS' },
  jungle:      { ground: [86, 128, 74],    tint: 'rgba(110,170,100,0.12)', name: 'EMERALD JUNGLE' },
  plains:      { ground: [126, 168, 92],  tint: 'rgba(140,180,100,0.12)', name: 'WHISPERING PLAINS' },
  desert:      { ground: [216, 178, 120],  tint: 'rgba(225,190,130,0.15)', name: 'SUNSCORCH DESERT' },
  shallows:    { ground: [206, 186, 138],  tint: 'rgba(120,180,200,0.12)', name: 'MANGROVE SHALLOWS' },
  archipelago: { ground: [150, 170, 140],  tint: 'rgba(120,180,200,0.12)', name: 'THE ARCHIPELAGO' },
  deep:        { ground: null,              tint: 'rgba(40,90,150,0.16)',  name: 'AZURE DEEP' },
};

export function biomeGroundInfo(key) {
  return BIOME_GROUND[key] || null;
}

function groundRGB(c, light) {
  const k = 0.5 + 0.5 * light;
  return `rgb(${(c[0] * k) | 0},${(c[1] * k) | 0},${(c[2] * k) | 0})`;
}

// Ambient biome bands: a subtle wash over each biome's x-range, an opaque
// ground band below the sim's own groundYAt(x) (null = open water), arctic
// glare streaks, and a dark abyss gradient where the deep has no ground.
// B is the resolved biomes module — every number comes from the sim.
export function drawBiomeBands(ctx, world, B, light) {
  const H = world.height;
  const W = B.WORLD_W || world.width;
  const step = 60;
  const runs = [];
  let runKey = null, runX0 = 0;
  for (let x = 0; x <= W; x += step) {
    let k = null;
    try { k = B.biomeKeyAt(x, H * 0.5); } catch (e) { k = null; }
    if (k !== runKey) {
      if (runKey) runs.push({ key: runKey, x0: runX0, x1: x });
      runKey = k; runX0 = x;
    }
  }
  if (runKey) runs.push({ key: runKey, x0: runX0, x1: W });
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '600 22px system-ui, sans-serif';
  for (const r of runs) {
    const info = biomeGroundInfo(r.key);
    if (!info) continue;
    const w = r.x1 - r.x0;
    ctx.fillStyle = info.tint;
    ctx.fillRect(r.x0, 0, w, H);
    if (r.key === 'deep') {
      // No ground in the deep — the abyss darkens with depth.
      const g = ctx.createLinearGradient(0, 640, 0, H);
      g.addColorStop(0, 'rgba(28,64,110,0.55)');
      g.addColorStop(1, 'rgba(8,20,44,0.92)');
      ctx.fillStyle = g;
      ctx.fillRect(r.x0, 640, w, H - 640);
    }
    if (r.key === 'arctic') {
      // Glare streaks on the ice shelf — pale diagonal slashes.
      let top = 800;
      try { const gt = B.groundYAt((r.x0 + r.x1) / 2); if (gt != null) top = gt; } catch (e) { /* keep nominal */ }
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const gx = r.x0 + w * (0.12 + i * 0.19);
        const gy = top + 24 + (i % 2) * 30;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + 70, gy - 16);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(info.name, (r.x0 + r.x1) / 2, H - 24);
  }
  ctx.restore();
  // Ground: honest per-x groundYAt — the sim's own answer, including the
  // nulls (open water between islands, the deep, mountain mid-air).
  const gstep = 30;
  for (let x = 0; x < W; x += gstep) {
    let top = null, key = null;
    try { top = B.groundYAt(x); key = B.biomeKeyAt(x, H * 0.5); } catch (e) { top = null; }
    if (top === null || top === undefined || !isFinite(top)) continue;
    const info = biomeGroundInfo(key);
    if (!info || !info.ground) continue;
    ctx.fillStyle = groundRGB(info.ground, light);
    ctx.fillRect(x, top, gstep + 1, H - top);
  }
}

// One water body: a translucent rect from the surface down, salt water a
// deeper blue than fresh, plus a brighter surface line.
export function drawWater(ctx, wr, worldH, light) {
  const x0 = wr.x0, w = wr.x1 - wr.x0;
  if (!(w > 0) || !isFinite(x0) || !isFinite(wr.surfaceY)) return;
  const salt = !!wr.salt;
  const k = 0.6 + 0.4 * light;
  const body = salt ? [36, 108, 168] : [54, 148, 158];
  ctx.fillStyle = `rgba(${(body[0] * k) | 0},${(body[1] * k) | 0},${(body[2] * k) | 0},0.42)`;
  ctx.fillRect(x0, wr.surfaceY, w, worldH - wr.surfaceY);
  ctx.fillStyle = salt ? 'rgba(150,210,245,0.85)' : 'rgba(170,230,220,0.85)';
  ctx.fillRect(x0, wr.surfaceY - 2, w, 4);
}

// ---------------------------------------------------------------------------
// v0.18 "Realms": predators. Every agent of selection must be visible —
// Paul's v0.17-dev lesson: no phantom killers. Sharks and bears read as
// dangerous at a glance and nothing like a tanglekin.

export function drawPredator(ctx, pr, t, light) {
  const x = pr.x, y = pr.y;
  if (!isFinite(x) || !isFinite(y)) return;
  const r = Math.max(10, pr.r || 26);
  const facing = pr.facing || 1;
  const hunting = !!(pr.hunting || pr.target || /hunt/i.test(pr.state || ''));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  const sway = Math.sin(t * 2.2 + (pr.id || 0)) * r * 0.08;
  if (pr.kind === 'shark') {
    // Dark mantle: a long low torpedo, slate-blue and menacing.
    const k = 0.5 + 0.5 * light;
    const mantle = `rgb(${(38 * k) | 0},${(58 * k) | 0},${(86 * k) | 0})`;
    const belly = `rgb(${(120 * k) | 0},${(140 * k) | 0},${(165 * k) | 0})`;
    ctx.fillStyle = mantle;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.5, r * 0.52, sway * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.22, r * 1.1, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Dorsal fin.
    ctx.fillStyle = mantle;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.45);
    ctx.lineTo(r * 0.25, -r * 1.05);
    ctx.lineTo(r * 0.5, -r * 0.4);
    ctx.closePath();
    ctx.fill();
    // Tail fin.
    ctx.beginPath();
    ctx.moveTo(-r * 1.45, 0);
    ctx.lineTo(-r * 2.1, -r * 0.55 + sway);
    ctx.lineTo(-r * 1.9, 0);
    ctx.lineTo(-r * 2.1, r * 0.55 + sway);
    ctx.closePath();
    ctx.fill();
    // Trailing tentacles from the underside — the thing that says
    // "not a fish you know".
    ctx.strokeStyle = mantle;
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const tx = -r * 0.5 + i * r * 0.35;
      const tw = Math.sin(t * 3 + i * 1.7 + (pr.id || 0)) * r * 0.18;
      ctx.beginPath();
      ctx.moveTo(tx, r * 0.4);
      ctx.quadraticCurveTo(tx - r * 0.1 + tw, r * 0.9, tx - r * 0.25 + tw * 1.6, r * 1.25);
      ctx.stroke();
    }
    // Large eyes — red when hunting.
    for (const ex of [r * 0.75, r * 1.05]) {
      ctx.fillStyle = hunting ? '#e0342b' : '#dfe8f2';
      ctx.beginPath();
      ctx.arc(ex, -r * 0.12, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#101418';
      ctx.beginPath();
      ctx.arc(ex + r * 0.03, -r * 0.12, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
      if (hunting) {
        ctx.strokeStyle = 'rgba(224,52,43,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ex, -r * 0.12, r * 0.24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else {
    // Bear: a grey-brown quadruped — heavy body, snout, round ears,
    // bushy tail. Reads as dangerous, reads as land.
    const k = 0.5 + 0.5 * light;
    const coat = `rgb(${(122 * k) | 0},${(100 * k) | 0},${(76 * k) | 0})`;
    const dark = `rgb(${(88 * k) | 0},${(70 * k) | 0},${(52 * k) | 0})`;
    // Bushy tail (behind).
    ctx.strokeStyle = dark;
    ctx.lineWidth = r * 0.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 1.15, -r * 0.25);
    ctx.quadraticCurveTo(-r * 1.6, -r * 0.5 + sway, -r * 1.45, -r * 0.85);
    ctx.stroke();
    // Body.
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.45, r * 1.05, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    // Legs.
    ctx.fillStyle = dark;
    for (const lx of [-r * 0.6, r * 0.55]) {
      ctx.fillRect(lx - r * 0.16, -r * 0.6, r * 0.32, r * 0.62);
    }
    // Head + snout.
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.arc(r * 1.05, -r * 0.72, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(r * 1.38, -r * 0.6, r * 0.24, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1512'; // nose
    ctx.beginPath();
    ctx.arc(r * 1.55, -r * 0.64, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // Round ears.
    ctx.fillStyle = dark;
    for (const ex of [r * 0.82, r * 1.12]) {
      ctx.beginPath();
      ctx.arc(ex, -r * 1.08, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    // Eyes — small, forward, unimpressed.
    ctx.fillStyle = '#14100c';
    ctx.beginPath();
    ctx.arc(r * 1.12, -r * 0.78, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
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
