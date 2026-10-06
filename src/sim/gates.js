// Loam D1 "Regulatory depth" — gate multiplier functions.
// Moved from sim/genome.js to break the genome<->evodevo import cycle
// (genome imports budPotentials from evodevo; evodevo needs gateMultiplier).
// Pure functions, zero dependencies — safe to import from anywhere.

function sigma(x) { return 1 / (1 + Math.exp(-x)); }
const _gatePlanCache = new WeakMap();
function gatePlan(pheno) {
  let plan = _gatePlanCache.get(pheno);
  if (!plan) {
    plan = [];
    for (let i = 0; i < 8; i++) {
      const slope = pheno[`g${i}slope`] ?? 0;
      if (slope === 0) continue;
      plan.push({
        tgt: pheno[`g${i}tgt`],
        reg: pheno[`g${i}reg`],
        slope,
        thr: pheno[`g${i}thr`] ?? 0.5,
      });
    }
    _gatePlanCache.set(pheno, plan);
  }
  return plan;
}

export function gateMultiplier(pheno, targetKey, chem) {
  if (!chem) return 1.0;
  const plan = gatePlan(pheno);
  if (plan.length === 0) return 1.0;
  let mult = 1.0;
  for (const g of plan) {
    if (g.tgt !== targetKey) continue;
    const regV = chem[g.reg];
    if (regV === undefined) continue;
    mult *= 1 + g.slope * sigma((regV - g.thr) * 4);
  }
  return Math.max(0, mult);
}

export function hasActiveGates(pheno) {
  return gatePlan(pheno).length > 0;
}
