// Language proof ("Tongues" verification): headless conventionalization proof
// plus the ALIFE-2026 / Open-Worlds-Challenge verification layer.
// Run: node test/language-proof.mjs [mode] [seed] [ticks]
//   mode: base | divergence | isolation | ratchet | ablation | all (default: all)
// A seed CONVENTIONALIZES if, at the end of the run, troops hold distinct
// prototype clusters and the top words show >60% single-context dominance.
// Same seed + same code = same result (deterministic RNG).
import { createWorld, bindWorld, populate, tickWorld, censusTroopWords } from '../src/sim/world.js';
import { createCreature } from '../src/sim/creature.js';
import { randomGenome } from '../src/sim/genome.js';
import { lexiconDistance, entryStats, wordName } from '../src/sim/language.js';
import { ageStage } from '../src/sim/biochem.js';

const DT = 0.5;
const SEEDS = [7, 33, 52, 42, 11]; // all viable at 4000 ticks; seed 99 extinct (data, not noise)

// ---- helpers ------------------------------------------------------------

// Top words of the first troop with members, with dominant-context stats.
function troopWords(world) {
  const census = censusTroopWords(world);
  const t = census.find((c) => c.memberCount > 0 && c.words.length > 0);
  return t || null;
}

// Mean pairwise lexiconDistance among a list of creatures.
function meanLexDist(creatures) {
  const cs = creatures.filter((c) => c.alive && c.lexicon);
  if (cs.length < 2) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      sum += lexiconDistance(cs[i].lexicon, cs[j].lexicon);
      n++;
    }
  }
  return n ? sum / n : null;
}

// The set of word names held by a troop census entry.
function wordSet(troop) {
  return new Set((troop ? troop.words : []).map((w) => w.name));
}

function runTicks(world, ticks) {
  for (let i = 0; i < ticks; i++) tickWorld(world, DT);
}

// ---- 1. base conventionalization proof ----------------------------------
function baseProof(seed, ticks) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  runTicks(world, ticks);
  const t = troopWords(world);
  if (!t) return { seed, verdict: 'NO-TROOP' };
  const top = t.words.slice(0, 5).map((w) => {
    // dominant context share across the word's member entries
    let best = 'contact', bestN = 0, total = 0;
    const agg = { food: 0, alarm: 0, mate: 0, contact: 0, come: 0 };
    for (const c of world.creatures) {
      if (!c.alive || !c.lexicon) continue;
      for (const e of c.lexicon.entries) {
        if (wordName(e.proto) !== w.name) continue;
        for (const k of Object.keys(agg)) { agg[k] += e.contexts[k] || 0; total += e.contexts[k] || 0; }
      }
    }
    for (const k of Object.keys(agg)) if (agg[k] > bestN) { bestN = agg[k]; best = k; }
    return { name: w.name, speakers: w.speakers, domCtx: best, domShare: total ? bestN / total : 0 };
  });
  const distinct = t.words.length;
  const dominant = top.filter((w) => w.domShare > 0.6).length;
  const verdict = distinct >= 2 && dominant >= 1 ? 'CONVENTIONALIZED' : 'WEAK';
  return { seed, ticks, words: distinct, top, dominant, verdict };
}

// ---- 2. per-seed lexicon divergence (Petak-style path dependence) --------
function divergence(ticks) {
  return SEEDS.map((seed) => {
    const r = baseProof(seed, ticks);
    return {
      seed,
      words: r.words,
      top: (r.top || []).slice(0, 5).map((w) => `${w.name}(${w.domCtx}:${Math.round(w.domShare * 100)}%)`),
      verdict: r.verdict,
    };
  });
}

// ---- 3. juvenile isolation (library-test analogue) -----------------------
function isolation(seed, ticks) {
  const mk = (withAdults, withTeacher) => {
    const world = bindWorld(createWorld(seed));
    populate(world);
    if (!withAdults) {
      // Juvenile isolation: remove adults — no adult contact.
      for (const c of world.creatures) {
        if (ageStage(c.biochem, c.pheno) === 'adult') c.alive = false;
      }
      world.creatures = world.creatures.filter((c) => c.alive);
      // Ensure a juvenile cohort even if the founders were all adult.
      while (world.creatures.length < 6) {
        const c = createCreature(randomGenome(world.rng), 400 + world.creatures.length * 60, 0, world.rng);
        c.biochem.age = 1; // baby
        world.creatures.push(c);
      }
    }
    // else: normal troop-reared cohort — full age structure kept.
    if (!withTeacher) world.teacher = null;
    return world;
  };
  const iso = mk(false, false);
  runTicks(iso, ticks);
  const rear = mk(true, true);
  runTicks(rear, ticks);
  const isoDist = meanLexDist(iso.creatures);
  const rearDist = meanLexDist(rear.creatures);
  const isoWords = (troopWords(iso) || { words: [] }).words.length;
  const rearWords = (troopWords(rear) || { words: [] }).words.length;
  return {
    seed, ticks,
    isolated: { n: iso.creatures.length, meanLexDist: isoDist, words: isoWords },
    reared: { n: rear.creatures.length, meanLexDist: rearDist, words: rearWords },
    verdict: isoDist !== null && rearDist !== null
      ? (isoDist < 0.35 ? 'RE-DERIVED (convergent)' : 'FAILED TO CONVENTIONALIZE')
      : 'INCONCLUSIVE',
  };
}

// ---- 4. linguistic ratchet index (cumulative vs churning) ----------------
function ratchet(seed, ticks, samples = 4) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  const per = Math.floor(ticks / samples);
  const sets = [];
  for (let s = 0; s < samples; s++) {
    runTicks(world, per);
    const t = troopWords(world);
    sets.push(wordSet(t));
  }
  const steps = [];
  for (let s = 1; s < sets.length; s++) {
    const prev = sets[s - 1], cur = sets[s];
    const retained = [...prev].filter((w) => cur.has(w)).length;
    const added = [...cur].filter((w) => !prev.has(w)).length;
    const lost = [...prev].filter((w) => !cur.has(w)).length;
    steps.push({
      retention: prev.size ? retained / prev.size : 0,
      added, lost, prevSize: prev.size, curSize: cur.size,
    });
  }
  const meanRetention = steps.reduce((a, s) => a + s.retention, 0) / steps.length;
  const totalAdded = steps.reduce((a, s) => a + s.added, 0);
  const verdict = meanRetention > 0.6 && totalAdded > 0 ? 'CUMULATIVE RATCHET'
    : meanRetention > 0.6 ? 'STABLE (no growth)'
    : 'CHURNING';
  return { seed, ticks, steps, meanRetention, totalAdded, verdict };
}

// ---- 5. teacher ablation (Rosetta stone removed) -------------------------
function ablation(seed, ticks) {
  const mk = (withTeacher) => {
    const world = bindWorld(createWorld(seed));
    populate(world);
    if (!withTeacher) world.teacher = null;
    runTicks(world, ticks);
    const t = troopWords(world);
    const cs = world.creatures.filter((c) => c.alive);
    return {
      words: t ? t.words.length : 0,
      meanLexDist: meanLexDist(cs),
      topShare: t && t.words.length
        ? Math.max(...t.words.slice(0, 3).map((w) => {
            let best = 0, total = 0;
            const agg = { food: 0, alarm: 0, mate: 0, contact: 0, come: 0 };
            for (const c of cs) {
              for (const e of (c.lexicon ? c.lexicon.entries : [])) {
                if (wordName(e.proto) !== w.name) continue;
                for (const k of Object.keys(agg)) { agg[k] += e.contexts[k] || 0; total += e.contexts[k] || 0; }
              }
            }
            for (const k of Object.keys(agg)) if (agg[k] > best) best = agg[k];
            return total ? best / total : 0;
          }))
        : 0,
    };
  };
  const withT = mk(true);
  const withoutT = mk(false);
  return {
    seed, ticks,
    withTeacher: withT,
    withoutTeacher: withoutT,
    verdict: withoutT.words >= withT.words * 0.7 ? 'CONVENTIONALIZES WITHOUT TEACHER'
      : withoutT.words > 0 ? 'SLOWER WITHOUT TEACHER'
      : 'TEACHER REQUIRED',
  };
}

// ---- driver ---------------------------------------------------------------
const mode = process.argv[2] || 'all';
const seed = parseInt(process.argv[3] || '33', 10);
const ticks = parseInt(process.argv[4] || '8000', 10);

const out = {};
if (mode === 'base' || mode === 'all') out.base = baseProof(seed, ticks);
if (mode === 'divergence' || mode === 'all') out.divergence = divergence(ticks);
if (mode === 'isolation' || mode === 'all') out.isolation = isolation(seed, ticks);
if (mode === 'ratchet' || mode === 'all') out.ratchet = ratchet(seed, ticks);
if (mode === 'ablation' || mode === 'all') out.ablation = ablation(seed, ticks);

// Per-seed divergence table (Petak-style: same setup, different accidents).
if (out.divergence) {
  console.log('PER-SEED LEXICON DIVERGENCE (path dependence as data)');
  console.log('seed | words | top-5 words (dominant context:share) | verdict');
  for (const d of out.divergence) {
    console.log(`${d.seed} | ${d.words} | ${(d.top || []).join(' ')} | ${d.verdict}`);
  }
  console.log('');
}

console.log(JSON.stringify(out, null, 2));

// Exit code: 0 iff the base proof conventionalizes.
const ok = !out.base || out.base.verdict === 'CONVENTIONALIZED';
process.exit(ok ? 0 : 1);
