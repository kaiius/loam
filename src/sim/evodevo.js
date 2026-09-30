// Evo-devo: the body plan as a developmental program (v0.17 "Bauplan").
//
// The genome no longer describes a fixed body with knobs — it describes a
// developmental program: five paired bud sites (shoulder, hip, dorsal,
// mid-torso, neck), each with grow/type/pow loci (+len where no ancestral
// gene exists), that unfold baby → child → adult. Shoulder and hip buds
// ADOPT the existing armLength/legLength genes as their len source — the
// founder's arms and legs are ancestral buds that simply always grew, so
// the founder phenotype is exactly the old one by construction.
//
// Bud types are an APPENDABLE string registry (like the senses): a future
// version appends new types and old genomes keep parsing. Never ordinals.
//
// The rules the tick lives by:
// - Gene-level potentials (budPotentials) are stage-independent: what the
//   genome wants. Mate choice and divergence read these.
// - The realized body plan (expressBuds) multiplies by growth01: what
//   development has built SO FAR. Physics gates read the realized values —
//   a baby with wing genes cannot glide, an undergrown membrane is a nub.
//   This is the honest developmental story, not a special case.
// - Growth is nutrition-scaled and permanent: starved juveniles stunt and
//   the stunt factor freezes at maturation (canalization is a v+1 question).

// Paired (bilaterally symmetric) limb sites. Append-only — a future version
// may add e.g. 'crown' or 'flank' without breaking old genomes.
export const BUD_SITES = ['shoulder', 'hip', 'dorsal', 'mid', 'neck'];
// Bud-type registry. 'grasp' is the ancestral type (every founder limb).
// Append-only strings — never reordered, never renumbered.
export const BUD_TYPES = ['grasp', 'membrane', 'sail', 'gill', 'fin'];

// A bud erupts once its grown grow01 reaches this; between BUD_ERUPT and
// BUD_NUB_HI it is a nub (costs development, does nothing) — the honest
// half-built organ, and the reason membranes are a liability before wings.
export const BUD_ERUPT = 0.15;
export const BUD_NUB_HI = 0.4;

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Founder defaults, so a genome missing evo-devo loci reads as the founder.
function growDefault(site) { return site === 'shoulder' || site === 'hip' ? 1 : 0; }
function typeDefault(site) {
  return site === 'dorsal' ? 1 : site === 'neck' ? 3 : 0; // membrane / gill latent
}

function budGrow01(site, p) { return clamp01(p['bud' + cap(site) + 'Grow'] ?? growDefault(site)); }
function budType(site, p) {
  const v = p['bud' + cap(site) + 'Type'];
  // phenotype() maps choice genes to their string; accept a raw index too.
  if (typeof v === 'string' && BUD_TYPES.includes(v)) return v;
  return BUD_TYPES[v] ?? BUD_TYPES[typeDefault(site)];
}
function budPow01(site, p) { return clamp01(p['bud' + cap(site) + 'Pow'] ?? 0.5); }

// Len source per site: shoulder/hip adopt the ancestral genes (armLength,
// legLength) — zero dead genes, founder-exact by construction. Dorsal has
// no ancestral len gene: the founder proportion 0.5. Mid/neck read their own.
function budLen01(site, p) {
  if (site === 'shoulder') return clamp01(p.armLength ?? 0.5);
  if (site === 'hip') return clamp01(p.legLength ?? 0.5);
  if (site === 'mid') return clamp01(p.budMidLen ?? 0.5);
  if (site === 'neck') return clamp01(p.budNeckLen ?? 0.5);
  return 0.5; // dorsal — the founder proportion
}

// px length of a bud's limb — mirrors the founder limb formulas for the
// adopted sites so the founder draws pixel-identically.
export function budLenPx(site, p) {
  const r = p.bodyRadius || 30;
  const len01 = budLen01(site, p);
  if (site === 'shoulder') return r * (0.45 + len01 * 0.65); // = painter armLen
  if (site === 'hip') return r * (0.15 + len01 * 0.6);       // = painter legLen
  return r * (0.3 + len01 * 0.7);
}

// Gene-level bud potentials — stage-independent, what the genome WANTS.
// Mate choice and divergence read these (choosing genes, not bodies).
export function budPotentials(p) {
  let wingArea = 0, sailArea = 0, gillArea = 0, finArea = 0;
  let graspSites = 0, reachPx = 0;
  for (const site of BUD_SITES) {
    const grow01 = budGrow01(site, p);
    const type = budType(site, p);
    // Organ power: a strong bud does more with the same size — a big
    // membrane with no muscle is a sail, not a wing. ×1.0 at founder
    // (pow 0.5), so the founder plan is untouched by construction.
    const powK = 0.5 + budPow01(site, p);
    const area = grow01 * budLen01(site, p) * powK;
    if (type === 'membrane') wingArea += area;
    else if (type === 'sail') sailArea += area;
    else if (type === 'gill') gillArea += area;
    else if (type === 'fin') finArea += area;
    if (type === 'grasp' && grow01 >= BUD_ERUPT) {
      graspSites++;
      const lp = budLenPx(site, p) * powK;
      if (lp > reachPx) reachPx = lp;
    }
  }
  // Founder reach baseline: the shoulder at armLength 0.5. The bonus is
  // exactly 0 for the founder; longer grasp limbs extend it.
  const baseline = (p.bodyRadius || 30) * (0.45 + 0.5 * 0.65);
  return {
    wingArea, sailArea, gillArea, finArea,
    graspPairs: graspSites,
    bodySegs: 1 + (p.segCount || 0),
    tails: 1 + (p.tailCount || 0),
    reachPx, reachBonus: reachPx - baseline,
  };
}

// The realized body plan: potentials × growth01, with the limb list a
// creature actually has. Physics reads THIS, never the genes.
export function expressBuds(p, growth01) {
  const g = clamp01(growth01 ?? 1);
  const pot = budPotentials(p);
  const limbs = [];
  let graspPairs = 0;
  for (const site of BUD_SITES) {
    const grown = budGrow01(site, p) * g;
    if (grown < BUD_ERUPT) continue;
    const type = budType(site, p);
    if (type === 'grasp') graspPairs++;
    const lenPx = budLenPx(site, p);
    const pow01 = budPow01(site, p);
    for (const side of ['L', 'R']) {
      limbs.push({ site, side, type, grow01: grown, lenPx, pow01 });
    }
  }
  return {
    limbs, tails: pot.tails, bodySegs: pot.bodySegs, graspPairs,
    wingArea: pot.wingArea * g, sailArea: pot.sailArea * g,
    gillArea: pot.gillArea * g, finArea: pot.finArea * g,
    growth01: g,
  };
}

// The developmental clock. base by stage; juveniles scale by their own
// mean bloodSugar (starvation stunts); adults freeze the stunt factor they
// grew up with. No canalization yet — a v+1 question.
export function developmentalGrowth01(stage, juvSugarMean, stuntFactor) {
  const base = stage === 'baby' ? 0.25 : stage === 'child' ? 0.6
    : stage === 'adult' ? 1.0 : 0.95;
  if (stage === 'adult' || stage === 'senior') return base * (stuntFactor ?? 1);
  const mean = juvSugarMean ?? 0.75;
  return base * (0.5 + 0.5 * mean);
}
