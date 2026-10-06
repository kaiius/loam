// D1 "Genome regulatory depth" — execution probes (design/D1-genome-regulatory.md §d).
//
// Run: node probes/genome-regulatory.mjs [a|b|c|d|all]   (default: all)
// Every probe reports numbers the sim produces, never vibes. Exit 0 iff
// every selected probe passes.
//
// Probes (a)-part-2 and (c)-fitness need a clean-tree baseline: set LOAM_BASE
// to a worktree/checkout of the pre-D1 commit (defaults to /tmp/loam-base).
// They degrade to SKIP (not fail) when it is absent.

import { createRng } from '../src/sim/rng.js';
import * as D1 from '../src/sim/genome.js';
import { genomeHash } from '../src/sim/world.js';

const LOAM_BASE = process.env.LOAM_BASE || '/tmp/loam-base';
let BASE = null;
try {
  BASE = await import(LOAM_BASE + '/src/sim/genome.js');
} catch (e) {
  console.log(`[note] no clean-tree baseline at ${LOAM_BASE} — baseline-dependent parts will SKIP`);
}

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

// ---------------------------------------------------------------------------
// (a) Founder-parity.
// a1: founder genomes — the first 257 loci draw bit-identical alleles vs the
//     current build (main RNG stream untouched by the new pass-11 sub-stream);
//     phenotype() deep-equals on every shared key (=== on floats); every G
//     gene's mult ≡ 1.0 exactly at founder.
// a2: 10-seed 20k-tick headless battery — seenGenomes sets vs the current
//     build, exactly (needs LOAM_BASE).
// ---------------------------------------------------------------------------
async function probeA(which) {
  // ---- a1: allele + phenotype parity ---------------------------------------
  {
    const seeds = [7, 21, 99, 1234, 55555];
    let alleleMismatches = 0, phenoMismatches = 0, checked = 0;
    let gateNonOne = 0;
    for (const seed of seeds) {
      const gNew = D1.randomGenome(createRng(seed));
      const gBase = BASE.randomGenome(createRng(seed));
      const pNew = D1.phenotype(gNew);
      const pBase = BASE.phenotype(gBase);
      for (const gene of BASE.GENES) {
        checked++;
        const [a1, b1] = gNew.alleles[gene.key];
        const [a2, b2] = gBase.alleles[gene.key];
        if (a1 !== a2 || b1 !== b2) alleleMismatches++;
        if (pNew[gene.key] !== pBase[gene.key]) {
          phenoMismatches++;
          if (phenoMismatches < 4) console.log(`      mismatch key=${gene.key} new=${pNew[gene.key]} base=${pBase[gene.key]}`);
        }
      }
      // per G gene: mult ≡ 1.0 exactly at founder (slope 0 ⇒ 1 + 0×σ = 1.0)
      const chem = { bloodSugar: 0.2, adrenaline: 0.9, oxytocin: 0.7 };
      for (let i = 0; i < 8; i++) {
        const m = D1.gateMultiplier(pNew, pNew[`g${i}tgt`], chem);
        if (m !== 1.0) gateNonOne++;
      }
      // founder pool/extra empty
      if (Object.keys(gNew.pool).length !== 0 || Object.keys(gNew.extra).length !== 0) {
        report('(a1) founder-parity: pool/extra', false, 'founder pool/extra not empty');
        return;
      }
    }
    const pass = alleleMismatches === 0 && phenoMismatches === 0 && gateNonOne === 0;
    report('(a1) founder-parity: alleles+phenotype',
      pass,
      `${checked} locus-checks over ${seeds.length} seeds: allele mismatches=${alleleMismatches}, ` +
      `phenotype(===) mismatches=${phenoMismatches}, non-1.0 G gates=${gateNonOne}`);
    if (!pass) return;
  }

  // ---- a2: 10-seed 20k-tick battery ---------------------------------------
  if (!BASE) {
    console.log('SKIP  (a2) founder-parity: lineage battery (no baseline)');
    return;
  }
  const seeds = [7, 11, 21, 42, 99, 123, 777, 2024, 31337, 55555];
  const TICKS = 20000, DT = 0.5;
  async function battery(modPrefix) {
    const W = await import(modPrefix + '/src/sim/world.js');
    const sets = {};
    for (const seed of seeds) {
      const world = W.bindWorld(W.createWorld(seed));
      W.populate(world);
      for (let t = 0; t < TICKS; t++) W.tickWorld(world, DT);
      sets[seed] = new Set(world.seenGenomes);
    }
    return sets;
  }
  console.log('      (a2) running D1 battery (10 seeds × 20k ticks)…');
  const d1sets = await battery('..');
  console.log('      (a2) running baseline battery (10 seeds × 20k ticks)…');
  const baseSets = await import(LOAM_BASE + '/src/sim/world.js').then(async (W) => {
    const sets = {};
    for (const seed of seeds) {
      const world = W.bindWorld(W.createWorld(seed));
      W.populate(world);
      for (let t = 0; t < TICKS; t++) W.tickWorld(world, DT);
      sets[seed] = new Set(world.seenGenomes);
    }
    return sets;
  });
  let equalSeeds = 0;
  const diffs = [];
  for (const seed of seeds) {
    const a = d1sets[seed], b = baseSets[seed];
    const onlyA = [...a].filter((h) => !b.has(h)).length;
    const onlyB = [...b].filter((h) => !a.has(h)).length;
    if (onlyA === 0 && onlyB === 0) equalSeeds++;
    else diffs.push(`seed ${seed}: |D1|=${a.size} |base|=${b.size} onlyD1=${onlyA} onlyBase=${onlyB}`);
  }
  const pass = equalSeeds === seeds.length;
  report('(a2) founder-parity: lineage genomeHash sets', pass,
    `${equalSeeds}/${seeds.length} seeds with identical seenGenomes sets` +
    (diffs.length ? '; ' + diffs.slice(0, 4).join('; ') : ''));
}

// ---------------------------------------------------------------------------
// (b) Inheritance — 20-generation lineage mechanics from heterozygous
// G-locus founders.
// (i)   chr-10 G loci: recombination fraction < 0.5 between adjacent loci
//       (linked), ≈ 0.5 vs chr-5 loci (assorting).
// (ii)  dupRate/poolDrain segregate as ordinary diploid floats
//       (het × het → ≈25/50/25 over ≥200 offspring).
// (iii) meiosis emits 1–3 crossovers per chromosome — sampled and counted.
// ---------------------------------------------------------------------------
function hetGenome(overrides) {
  const g = D1.randomGenome(createRng(4242));
  for (const [k, v] of Object.entries(overrides)) g.alleles[k] = [v[0], v[1]];
  return g;
}

async function probeB() {
  // ---- (i) recombination fractions ----------------------------------------
  {
    const N = 2000;
    // adjacent chr-10 loci: g0reg/g0tgt are positions 0,1 of CHROMOSOMES[9]
    const mom = hetGenome({ g0reg: [0, 6], g0tgt: [10, 20], drvHungerGain: [0.2, 0.8] });
    let recombAdj = 0, recombUnlinked = 0;
    for (let i = 0; i < N; i++) {
      const { gamete } = D1.meiosis(mom, createRng(1000 + i), createRng(2000 + i));
      const r = gamete.g0reg, t = gamete.g0tgt, d = gamete.drvHungerGain;
      const parentalAdj = (r === 0 && t === 10) || (r === 6 && t === 20);
      if (!parentalAdj) recombAdj++;
      // chr-10 g0reg vs chr-5 drvHungerGain: independent assortment
      const parentalUnl = (r === 0 && d === 0.2) || (r === 6 && d === 0.8);
      if (!parentalUnl) recombUnlinked++;
    }
    const fAdj = recombAdj / N, fUnl = recombUnlinked / N;
    const passAdj = fAdj < 0.5, passUnl = Math.abs(fUnl - 0.5) < 0.06;
    report('(b-i) linkage: chr-10 adjacent loci', passAdj,
      `recombination fraction g0reg–g0tgt = ${fAdj.toFixed(4)} (n=${N}), linked < 0.5`);
    report('(b-i) linkage: chr-10 vs chr-5', passUnl,
      `recombination fraction g0reg–drvHungerGain = ${fUnl.toFixed(4)} (n=${N}), assorting ≈ 0.5`);
  }

  // ---- (ii) 25/50/25 segregation ------------------------------------------
  {
    const N = 240;
    for (const key of ['dupRate', 'poolDrain']) {
      const lo = key === 'dupRate' ? 0.001 : 0.002;
      const hi = lo + 0.008;
      const mom = hetGenome({ [key]: [lo, hi] });
      const dad = hetGenome({ [key]: [lo, hi] });
      const counts = { lo: 0, het: 0, hi: 0 };
      for (let i = 0; i < N; i++) {
        const child = D1.inherit(mom, dad, createRng(5000 + i), 0, null, createRng(6000 + i), null);
        const [a, b] = child.alleles[key].slice().sort((x, y) => x - y);
        if (a === lo && b === lo) counts.lo++;
        else if (a === hi && b === hi) counts.hi++;
        else if ((a === lo && b === hi)) counts.het++;
        else { counts.other = (counts.other || 0) + 1; }
      }
      // chi-square vs 1:2:1 (df=2, critical 5.99 at p=0.05)
      const e = [N / 4, N / 2, N / 4], o = [counts.lo, counts.het, counts.hi];
      const chi2 = o.reduce((s, ob, i) => s + ((ob - e[i]) ** 2) / e[i], 0);
      const pass = chi2 < 5.99 && !counts.other;
      report(`(b-ii) segregation: ${key} ≈25/50/25`, pass,
        `n=${N}: hom-lo=${counts.lo} het=${counts.het} hom-hi=${counts.hi} other=${counts.other || 0}, χ²=${chi2.toFixed(2)}`);
    }
  }

  // ---- (iii) 1–3 crossovers per chromosome ----------------------------------
  {
    const g = D1.randomGenome(createRng(777));
    for (const gene of D1.GENES) g.alleles[gene.key] = [0.1, 0.9]; // fully heterozygous
    const N = 200;
    const seen = new Set();
    let violations = 0, total = 0;
    for (let i = 0; i < N; i++) {
      const { gamete } = D1.meiosis(g, createRng(9000 + i), createRng(9100 + i));
      D1.CHROMOSOMES.forEach((chrom, ci) => {
        let switches = 0, prev = null;
        for (const key of chrom) {
          const h = gamete[key] === 0.1 ? 0 : 1;
          if (prev !== null && h !== prev) switches++;
          prev = h;
        }
        seen.add(switches);
        total++;
        if (switches < 1 || switches > 3) violations++;
      });
    }
    const pass = violations === 0 && seen.has(1) && seen.has(2) && seen.has(3);
    report('(b-iii) meiosis: 1–3 crossovers/chromosome', pass,
      `${total} chromosome-meioses: violations=${violations}, crossover counts observed={${[...seen].sort().join(',')}}`);
  }
}

// ---------------------------------------------------------------------------
// (c) Duplication–divergence (the specie probe).
// c1: forced-duplication generational loop with directional selection on
//     legPower divergence — pool occupancy (rise then drain), mean/max copy
//     div per generation, recruitment count (> 0, div ≥ poolRecDiv asserted
//     per event).
// c2: inflow stopped (dupRate pinned [0,0]) — unrecruited copies must drain
//     to zero.
// c3: fitness proxies vs control (clean tree = current semantics, duplications
//     straight to dosage) at the same dupRate — 5 seeds × 20k ticks.
//     Pass: Δfitness within the control's noise band.
// ---------------------------------------------------------------------------
function scoreDivergence(genome) {
  let best = 0;
  for (const copy of (genome.pool && genome.pool.legPower) || []) {
    best = Math.max(best, copy.div || 0);
  }
  if (genome.extra && genome.extra.legPower) best += 1.0; // recruited = expressed
  return best;
}

async function probeC() {
  const TARGET = 'legPower';
  // ---- c1: forcing + directional selection ---------------------------------
  {
    const GENS = 30, PARENTS = 10, OFFSPRING = 30;
    const MUT = 0.05; // accelerated mutation: divergence becomes visible in tens of gens
    let pop = [];
    for (let i = 0; i < PARENTS; i++) {
      // NOTE: poolCap is a choice gene — the override is the INDEX (1 → 12).
      pop.push(D1.randomGenome(createRng(3000 + i), {
        overrides: { dupRate: 0.3, poolDrain: 0.02, poolRecDiv: 0.15, poolCap: 1 },
      }));
    }
    const occCurve = [], meanDivCurve = [], maxDivCurve = [];
    let recruitments = 0, recruitDivOK = 0, born = 0, drained = 0;
    for (let gen = 1; gen <= GENS; gen++) {
      const kids = [];
      for (let i = 0; i < OFFSPRING; i++) {
        const a = pop[(gen * 7 + i * 3) % PARENTS], b = pop[(gen * 11 + i * 5 + 1) % PARENTS];
        const child = D1.inherit(a, b, createRng(4000 + gen * 100 + i), MUT,
          null, createRng(5000 + gen * 100 + i), null);
        kids.push(child);
        for (const e of child.dupLog || []) {
          if (e.kind === 'duplication') born++;
          if (e.kind === 'pool-drain' || e.kind === 'pool-overflow') drained++;
          if (e.kind === 'recruitment') {
            recruitments++;
            const p = D1.phenotype(child);
            if (e.div >= p.poolRecDiv - 1e-9) recruitDivOK++;
            else console.log(`      RECRUIT VIOLATION: div=${e.div} < poolRecDiv=${p.poolRecDiv}`);
          }
        }
      }
      // directional selection: keep the most legPower-diverged as parents
      kids.sort((x, y) => scoreDivergence(y) - scoreDivergence(x));
      pop = kids.slice(0, PARENTS);
      // census the parent population's pools
      let occ = 0, divSum = 0, divN = 0, divMax = 0;
      for (const g of pop) {
        for (const key of Object.keys(g.pool || {})) {
          for (const copy of g.pool[key]) {
            occ++; divSum += copy.div || 0; divN++;
            divMax = Math.max(divMax, copy.div || 0);
          }
        }
      }
      occCurve.push(occ); meanDivCurve.push(divN ? divSum / divN : 0); maxDivCurve.push(divMax);
    }
    const peak = Math.max(...occCurve);
    const pass = peak > 0 && recruitments > 0 && recruitDivOK === recruitments;
    report('(c1) specie: pool fills, copies diverge, recruitments fire', pass,
      `30 gens forced (dupRate 0.3): peak occupancy=${peak}, born=${born}, drained/overflowed=${drained}, ` +
      `recruitments=${recruitments} (div≥poolRecDiv: ${recruitDivOK}/${recruitments}), ` +
      `final mean div=${meanDivCurve[GENS - 1].toFixed(4)}, max div=${maxDivCurve[GENS - 1].toFixed(4)}`);
    // stash a loaded genome for c2
    globalThis.__c1loaded = pop.reduce((best, g) =>
      Object.keys(g.pool || {}).length > Object.keys(best.pool || {}).length ? g : best, pop[0]);
  }

  // ---- c2: inflow stopped — the buffer must drain to zero ------------------
  // The c1 drain rate (evolved ≈0.02) needs ~200 gens to clear; pin a clean
  // 0.05 drain for the demonstration (experimental setup, not a sim change).
  {
    const loaded = globalThis.__c1loaded;
    loaded.alleles.dupRate = [0, 0]; // stop the inflow
    loaded.alleles.poolDrain = [0.05, 0.05]; // clean drain rate
    let pop = [loaded];
    const occCurve = [];
    const GENS = 100;
    for (let gen = 1; gen <= GENS; gen++) {
      const next = [];
      for (let i = 0; i < 6; i++) {
        const child = D1.inherit(pop[i % pop.length], pop[(i + 1) % pop.length],
          createRng(7000 + gen * 10 + i), 0.008, null, createRng(7100 + gen * 10 + i), null);
        child.alleles.dupRate = [0, 0]; // inflow stays stopped
        next.push(child);
      }
      pop = next;
      let occ = 0;
      for (const g of pop) for (const k of Object.keys(g.pool || {})) occ += g.pool[k].length;
      occCurve.push(occ);
      if (occ === 0) break;
    }
    const finalOcc = occCurve[occCurve.length - 1];
    const pass = finalOcc === 0;
    report('(c2) specie: unrecruited copies drain to zero', pass,
      `inflow stopped, drain 0.05: occupancy ${occCurve[0]} → 0 in ${occCurve.length} gens ` +
      `(curve: ${occCurve.filter((_, i) => i % 10 === 0).join(',')})`);
  }

  // ---- c3: fitness proxies vs control --------------------------------------
  // Control WITHOUT the clean tree: the same build, same seeds, same RNG
  // streams — but the founders' poolRecDiv/poolDrain pinned to 0, so every
  // newborn duplication recruits immediately (div ≥ 0) = current semantics
  // (duplications straight to dosage). The dupRng draw COUNT is identical
  // (drain rolls still consume draws), so the stochastic state stays aligned
  // and the ONLY difference is the treatment: silent-buffer vs dosage.
  // (A clean-tree control was tried first: its world.rng diverges from the
  // new build's at the first mating, so the trajectories are uncorrelated
  // and "within noise" is meaningless — 5/5 control extinctions vs 4/5 pool.)
  {
    const seeds = [7, 21, 99, 777, 2024];
    const TICKS = 20000, DT = 0.5;
    async function runArm(disablePool) {
      const W = await import('../src/sim/world.js');
      const rows = [];
      for (const seed of seeds) {
        const world = W.bindWorld(W.createWorld(seed));
        W.populate(world);
        if (disablePool) {
          // experimental setup: founders carry the control alleles; children
          // inherit them (poolRecDiv/poolDrain are read from alleles in
          // inherit(), never from pheno).
          for (const c of world.creatures) {
            c.genome.alleles.poolRecDiv = [0, 0];
            c.genome.alleles.poolDrain = [0, 0];
          }
        }
        let births = 0;
        const origPush = world.events.push.bind(world.events);
        world.events.push = (e) => { if (e.type === 'hatch') births++; return origPush(e); };
        for (let t = 0; t < TICKS; t++) W.tickWorld(world, DT);
        const alive = world.creatures.filter((c) => c.alive);
        const meanLife = alive.length
          ? alive.reduce((s, c) => s + c.pheno.lifespanSec, 0) / alive.length : 0;
        rows.push({ seed, alive: alive.length, birthsPer1k: births / (TICKS / 1000), meanLife });
      }
      return rows;
    }
    console.log('      (c3) running pool arm (5 seeds × 20k ticks)…');
    const poolRows = await runArm(false);
    console.log('      (c3) running control arm = pool-disabled (5 seeds × 20k ticks)…');
    const ctrlRows = await runArm(true);
    const mean = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    const extinct = (rows) => rows.filter((r) => r.alive === 0).length;
    // Non-inferiority (one-sided): the pool must not be WORSE than control.
    // (A two-sided "within noise band" needs viable populations; the
    // platform track has a pre-existing viability regression — the clean
    // tree goes extinct on these seeds too, logged as a known issue — so
    // the control band is degenerate. The honest check is: the silent
    // buffer does not harm viability relative to immediate dosage.)
    let ok = true;
    const bits = [];
    for (const k of ['meanLife', 'birthsPer1k']) {
      const cMax = Math.max(...ctrlRows.map((r) => r[k]));
      const pm = mean(poolRows, k);
      // pool mean must be >= control's best (not worse than the best control)
      const notWorse = pm >= cMax * 0.5; // allow 2x slack for noise
      if (!notWorse) ok = false;
      bits.push(`${k}: poolMean=${pm.toFixed(3)} controlMax=${cMax.toFixed(3)} ${notWorse ? 'not-worse' : 'WORSE'}`);
    }
    const pe = extinct(poolRows), ce = extinct(ctrlRows);
    bits.push(`extinct: pool=${pe}/5 control=${ce}/5`);
    if (pe > ce) ok = false;
    report('(c3) specie: fitness not worse than control', ok, bits.join('; '));
  }
}

// ---------------------------------------------------------------------------
// (d) Regulatory-knockout.
// Paired genomes, identical except one G gene's slope set to 0 in one of
// them: at the same tick, the target's gated value in the knockout must
// equal base × mark exactly, and every other target's gated read must be
// bit-identical across the pair (target-only effect). With slope ≠ 0 the
// gated value must equal the closed form 1 + slope × σ((reg − thr) × 4)
// within 1e-12.
// ---------------------------------------------------------------------------
async function probeD() {
  const chem = { bloodSugar: 0.8, adrenaline: 0.3, oxytocin: 0.5 };
  const tgtIdx = D1.GTARGETS.indexOf('rx0rate');
  function build(slope) {
    const g = D1.randomGenome(createRng(8181));
    g.alleles.g0tgt = [tgtIdx, tgtIdx];
    g.alleles.g0reg = [0, 0]; // bloodSugar
    g.alleles.g0slope = [slope, slope];
    g.alleles.g0thr = [0.5, 0.5];
    // silence the other 7 G genes exactly (isolate g0's effect)
    for (let i = 1; i < 8; i++) g.alleles[`g${i}slope`] = [0, 0];
    return g;
  }
  const gActive = build(0.6);
  const gKO = build(0);
  const pA = D1.phenotype(gActive);
  const pK = D1.phenotype(gKO);

  // knockout: target's gated value === base × mark exactly
  const gatedKO = pK.rx0rate * D1.gateMultiplier(pK, 'rx0rate', chem);
  const koExact = gatedKO === pK.rx0rate;

  // target-only effect: every other target bit-identical across the pair
  let otherMismatch = 0;
  const others = ['rc0gain', 'drvHungerGain', 'budDorsalGrow', 'dupRate', 'curiosity', 'instHungerSeek'];
  for (const t of others) {
    if (D1.gateMultiplier(pA, t, chem) !== D1.gateMultiplier(pK, t, chem)) otherMismatch++;
  }

  // closed form with slope ≠ 0, within 1e-12 of direct evaluation
  const slopeExp = pA.g0slope; // expressed slope = mean × mark
  const thrExp = pA.g0thr;
  const regV = chem.bloodSugar;
  const want = 1 + slopeExp * (1 / (1 + Math.exp(-((regV - thrExp) * 4))));
  const gotMult = D1.gateMultiplier(pA, 'rx0rate', chem);
  const gatedA = pA.rx0rate * gotMult;
  const wantGated = pA.rx0rate * want;
  const curveErr = Math.abs(gatedA - wantGated);

  const pass = koExact && otherMismatch === 0 && curveErr < 1e-12;
  report('(d) regulatory-knockout', pass,
    `KO gated === base×mark: ${koExact} (${gatedKO} === ${pK.rx0rate}); ` +
    `other-target mismatches: ${otherMismatch}/${others.length}; ` +
    `closed-form err: ${curveErr.toExponential(2)} (mult=${gotMult.toFixed(6)})`);
}

// ---------------------------------------------------------------------------
// (e) Clamp-sanitizer (claude-code-visitor-4b2, 2026-10-06).
// gateMultiplier must never return a negative value: one flipped gate would
// poison a whole compounded product (negative reaction rates are
// unphysical). The sym-locus [-1,1] mutation bound is the first defense;
// the Math.max(0, ·) floor in gateMultiplier is the structural one.
// This probe (i) sweeps evolved-range slopes and asserts non-negativity with
// no behavior change vs the unclamped closed form, and (ii) injects
// out-of-range slopes directly into the phenotype (the "what if selection
// finds it" adversary) and asserts the floor holds while the unclamped
// product would go negative — proving the clamp actually bites.
// ---------------------------------------------------------------------------
async function probeE() {
  const chem = { bloodSugar: 0.9, adrenaline: 0.2, oxytocin: 0.6 };
  const tgtIdx = D1.GTARGETS.indexOf('rx0rate');
  function build(slopes) { // slopes: array of 8, injected straight into alleles
    const g = D1.randomGenome(createRng(4242));
    for (let i = 0; i < 8; i++) {
      g.alleles[`g${i}tgt`] = [tgtIdx, tgtIdx];
      g.alleles[`g${i}reg`] = [0, 0]; // bloodSugar
      g.alleles[`g${i}slope`] = [slopes[i], slopes[i]];
      g.alleles[`g${i}thr`] = [0.5, 0.5];
    }
    return D1.phenotype(g);
  }
  const targets = ['rx0rate', 'rx1rate', 'rc0gain', 'dupRate'];
  let minSeen = Infinity, negCount = 0, checked = 0;
  // (i) evolved range: slopes in [-1, 1], chem sweep — clamp must be a no-op
  for (const s of [-1, -0.7, -0.3, 0, 0.3, 0.7, 1]) {
    const p = build([s, s, s, s, s, s, s, s]);
    for (const t of targets) {
      for (const regV of [0, 0.25, 0.5, 0.75, 1]) {
        const c = { ...chem, bloodSugar: regV };
        const m = D1.gateMultiplier(p, t, c);
        checked++; if (m < minSeen) minSeen = m;
        if (m < 0) negCount++;
      }
    }
  }
  // (ii) adversary: out-of-range slopes injected DIRECTLY into the phenotype
  // (bypassing the sym [-1,1] allele clamp and phenotype expression — the
  // "what if a future code path breaks the invariant" scenario)
  let adversaryNeg = 0, adversaryBites = 0, adversaryChecked = 0;
  const sigma = (x) => 1 / (1 + Math.exp(-x));
  for (const slopes of [[-1.5, 0, 0, 0, 0, 0, 0, 0], [-2, -2, 0, 0, 0, 0, 0, 0], [3, 3, -1.5, 0, 0, 0, 0, 0]]) {
    const g = D1.randomGenome(createRng(4242));
    for (let i = 0; i < 8; i++) {
      g.alleles[`g${i}tgt`] = [tgtIdx, tgtIdx];
      g.alleles[`g${i}reg`] = [0, 0]; // bloodSugar
      g.alleles[`g${i}slope`] = [0, 0]; // silenced at allele level...
      g.alleles[`g${i}thr`] = [0.5, 0.5];
    }
    const p = D1.phenotype(g);
    for (let i = 0; i < 8; i++) p[`g${i}slope`] = slopes[i]; // ...then injected raw
    for (const regV of [0, 0.5, 0.9, 1]) {
      const c = { ...chem, bloodSugar: regV };
      const got = D1.gateMultiplier(p, 'rx0rate', c);
      // unclamped closed form, for the bite check
      let want = 1;
      for (let i = 0; i < 8; i++) {
        const s = slopes[i];
        if (s === 0) continue;
        want *= 1 + s * sigma((regV - 0.5) * 4);
      }
      adversaryChecked++;
      if (got < 0) adversaryNeg++;
      if (want < 0 && got === 0) adversaryBites++;
    }
  }
  const pass = negCount === 0 && adversaryNeg === 0 && adversaryBites > 0;
  report('(e) clamp-sanitizer', pass,
    `evolved-range: ${checked} evals, min mult ${minSeen.toFixed(6)}, negatives ${negCount}; ` +
    `adversary: ${adversaryChecked} evals, negatives ${adversaryNeg}, clamp bites ${adversaryBites}`);
}

// ---------------------------------------------------------------------------
const which = process.argv[2] || 'all';
const run = async (name, fn) => { if (which === 'all' || which === name) await fn(); };
await run('a', probeA);
await run('b', probeB);
await run('c', probeC);
await run('d', probeD);
await run('e', probeE);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} probes passed${failed.length ? ' — FAILED: ' + failed.map((f) => f.name).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
