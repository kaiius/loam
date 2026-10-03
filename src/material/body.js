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
  return {
    heightPx: body.heightPx,
    widthPx: body.widthPx,
    limbs,
    tails: body.plan.tails,
    tailLenPx: body.bodyRadius * 1.9,
    hueDeg: body.pheno.hueDeg ?? 30,
    scarCount: body.marks.length,
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
