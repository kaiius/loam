// Loam M2 — grown bodies.
//
// Joshua's question, answered in code: are bodies individual and unique,
// based on genome and world interaction? Three shapers:
//   1. genes — budPotentials(): what the genome wants (shoulder/hip/dorsal/
//      mid/neck bud sites, grasp/membrane/sail/gill/fin types)
//   2. development + nutrition — expressBuds(p, growth01): what has actually
//      grown so far; growth01 scales with the juvenile's mean blood sugar
//      (starved young stunt, and the stunt freezes at maturation)
//   3. world marks — c.marks[]: injuries, scars, wear accumulate here as the
//      world touches the body. (M3 ports the full v0.36 scars system; the
//      hook is live now — marks already affect the drawn body.)
//
// The M1 fixed silhouette (60×30px) is replaced: height, width, limb count,
// tail length all derive from the grown body. A founder genome grows the
// familiar ~60px monkey; other genomes grow other bodies.

import { phenotype } from '../sim/genome.js';
import {
  expressBuds, developmentalGrowth01, budLenPx, BUD_ERUPT,
} from '../sim/evodevo.js';

// Founder-calibrated: size 0.5 → bodyRadius 23 → ~60px tall, ~30px wide,
// matching the M1 silhouette the probes were built against.
const HEIGHT_K = 2.6;
const WIDTH_K = 1.3;

export function growBody(genome, opts = {}) {
  const pheno = phenotype(genome);
  // M2 genes are founder-constant (see genes.js) — merge their defaults so
  // the brain's instinct wiring never sees a missing key.
  const growth01 = developmentalGrowth01(
    opts.stage || 'adult',
    opts.juvSugarMean,
    opts.stuntFactor,
  );
  const plan = expressBuds(pheno, growth01);
  const r = pheno.bodyRadius || 23;
  const sizeK = 0.35 + 0.65 * growth01; // babies are smaller, honestly
  return {
    pheno,
    plan,
    growth01,
    heightPx: r * HEIGHT_K * sizeK,
    widthPx: r * WIDTH_K * sizeK,
    bodyRadius: r,
    // Locomotion reads these, never the genes.
    legLengthPx: legLengthPx(plan, r),
    reachPx: plan.reachPx || r * 1.1,
    graspPairs: plan.graspPairs,
    // Digging anatomy gate (design §3.4): digPower scales with grasp pairs —
    // the body is the permission. Founder: 2 grasp pairs × 0.5 = 1.0, exactly
    // the M1 DIG_POWER, so founder pacing is unchanged by construction.
    digPower: Math.max(0, plan.graspPairs * 0.5),
    // World marks accumulate here (M3: the scars port reads this).
    marks: [],
  };
}

function legLengthPx(plan, r) {
  const hip = plan.limbs.find((l) => l.site === 'hip' && l.type === 'grasp');
  if (hip) return budLenPx('hip', { bodyRadius: r, armLength: 0.5, legLength: 0.5 });
  return 24; // the M1 LEG_LENGTH — no hip buds, founder fallback
}

// The body's visual description for the renderer: torso + per-limb segments
// + tail. Marks shift the drawing (a scarred limb draws thinner/paler).
//
// ART PASS (2026-10-03, Joshua's verdict "the tanglekin looks too simple"):
// the drawing now carries the full visual vocabulary the genome already
// decided — coat coloration (regional pigmentation), pattern, fur, ears,
// eyes, mouth, tail. Everything here is a pure function of the grown body;
// the dynamic half (affect, action, tick) lives in portrait.js. Additive
// only — the M2 test contract (limbs, tails, hueDeg) is untouched.
export function bodyDrawing(body) {
  const limbs = body.plan.limbs.map((l, i) => {
    const mark = body.marks.find((m) => m.limb === i);
    return {
      site: l.site,
      side: l.side,
      type: l.type,
      lenPx: l.lenPx * (mark && mark.severity > 0.5 ? 0.7 : 1),
      scarred: !!(mark && mark.severity > 0.3),
    };
  });
  const ph = body.pheno || {};
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return {
    heightPx: body.heightPx,
    widthPx: body.widthPx,
    limbs,
    tails: body.plan.tails,
    tailLenPx: body.bodyRadius * (0.8 + (ph.tailLength ?? 0.5) * 2.2),
    tailGrip: ph.tailGrip ?? 0.5,
    hueDeg: body.pheno.hueDeg ?? 30,
    scarCount: body.marks.length,
    torsoScarCount: body.marks.filter((m) => m.limb === -1).length,
    // --- coat: the expressed coloration, per body region ---
    coatHue01: ph.coatHue01 ?? (body.pheno.hueDeg ?? 30) / 360,
    coatSat01: ph.coatSat01 ?? 0.55,
    pigHead: { hueDeg: ph.pigHeadHueDeg ?? 0, satShift: ph.pigHeadSatShift ?? 0 },
    pigTorso: { hueDeg: ph.pigTorsoHueDeg ?? 0, satShift: ph.pigTorsoSatShift ?? 0 },
    pigLimbs: { hueDeg: ph.pigLimbsHueDeg ?? 0, satShift: ph.pigLimbsSatShift ?? 0 },
    // --- pattern: plain | spots | stripes, with density ---
    pattern: ph.pattern || 'plain',
    patternDensity: clamp01(ph.patternDensity ?? 0.3),
    // --- fur: 0 sleek … 1 shaggy (drives edge fluff, not color) ---
    fur: clamp01(ph.fur ?? 0.5),
    // --- head furniture ---
    earShape: ph.earShape || 'round', // round | pointy | floppy
    earScale: ph.earScale ?? 1,
    earTiltRad: ph.earTiltRad ?? 0,
    eyeSize: clamp01(ph.eyeSize ?? 0.5),
    mouthSize: clamp01(ph.mouthSize ?? 0.5),
    // --- proportions the art reads ---
    legLength01: clamp01(ph.legLength ?? 0.5),
    size01: clamp01(ph.size ?? 0.5),
    creatureId: body.creatureId ?? 0, // set by mcreature at spawn; hash salt
  };
}

// Record a world mark on the body (injury, scar, wear). M3's scars port
// will read severity/type; M2 records honestly.
export function addMark(body, mark) {
  body.marks.push({
    tick: mark.tick ?? 0,
    kind: mark.kind || 'scar',
    limb: mark.limb ?? -1, // -1 = torso
    severity: Math.max(0, Math.min(1, mark.severity ?? 0.5)),
    note: mark.note || '',
  });
  return body.marks.length;
}
