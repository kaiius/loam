// language.js — v0.16 "Tongues": the emergent lexicon.
//
// Every tanglekin carries a small lexicon of acoustic prototypes
// (pitch, length, loudness), each with a context tally and a confidence.
// No meaning is ever assigned: a word's "meaning" is only the statistics
// of where it gets used — a field linguist's notebook, not a dictionary.
//
// The update rules (from the v0.16 review):
//   (a) ASYMMETRIC updates — the speaker reinforces toward its OWN salient
//       state (it knows why it called); the hearer updates toward the most
//       salient observable context in a short recency-weighted window.
//   (b) PROBATIONARY buffer — a novel call births a candidate; it graduates
//       into the lexicon only after LEX_PROBATION_HEARINGS hearings. The
//       novelty threshold adapts to local prototype density so babble
//       can't flood the slots.
//   (c) SLOW decay — confidence fades over minutes; an entry is forgotten
//       only when confidence is low AND few troop-mates speak it. Culture
//       lives at the troop level.
//   (f) INFANT critical-period boost — lexLearnRate() scales up while young,
//       gene-modulated (lexCrit). Vertical transmission stabilizes the
//       lexicon across generations.
//
// This module is dependency-free on purpose: the sim (creature.js, world.js)
// calls in; nothing here imports the sim. All acoustic math is NaN-guarded.

export const LEX_CONTEXTS = ['food', 'alarm', 'mate', 'contact', 'come'];
export const LEX_PROBATION_HEARINGS = 3;
export const LEX_MAX_PROBATION = 6;
export const LEX_DECAY_TAU = 300;      // sim-seconds for confidence to decay by 1/e
export const LEX_FORGET_CONF = 0.22;   // below this, an entry may be forgotten...
export const LEX_FORGET_SPEAKERS = 2;  // ...but only if fewer troop-mates speak it
export const LEX_MIN_ENTRIES = 3;      // never wipe a lexicon below this

function clamp01f(x) {
  if (!Number.isFinite(x)) return 0.5;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function cleanProto(proto) {
  return {
    pitch: clamp01f(proto && proto.pitch),
    length: clamp01f(proto && proto.length),
    loudness: clamp01f(proto && proto.loudness),
  };
}

function emptyTallies() {
  const t = {};
  for (const k of LEX_CONTEXTS) t[k] = 0;
  return t;
}

// --- Substrate genes (expressed on the phenotype; see genome.js chr 8) ---

// Lexicon slot count: 4 + round(12 * lexCap). Founder lexCap 0.65 → ~12.
export function lexSlots(pheno) {
  return 4 + Math.round(12 * clamp01f(pheno.lexCap ?? 0.65));
}
// Hearing threshold: a call is heard only if its amplitude at the ear beats
// this. Lower gene value → keener ears.
export function hearThresh(pheno) {
  return 0.12 + 0.66 * clamp01f(pheno.lexHear ?? 0.5);
}
// Base loudness: the lexLoud gene blended with the old vocalVolume accent.
export function baseLoud(pheno) {
  return clamp01f(0.65 * clamp01f(pheno.lexLoud ?? 0.5) + 0.35 * clamp01f(pheno.vocalVolume ?? 0.5));
}
// Body size sets base pitch — physics, not script. Big bodies rumble,
// small bodies chirp. size 0..1 → factor 1.0..0.5.
export function sizePitchFactor(pheno) {
  return 1 - 0.5 * clamp01f(pheno.size ?? 0.5);
}
// Learning rate with the infant critical-period boost (delta f),
// gene-modulated by lexCrit.
export function lexLearnRate(pheno, isYoung) {
  const base = 0.25 + 0.75 * clamp01f(pheno.lexLearn ?? 0.5);
  if (!isYoung) return base;
  return base * (1 + 2 * clamp01f(pheno.lexCrit ?? 0.5));
}

// --- The lexicon ---------------------------------------------------------

export function createLexicon(slots) {
  return { entries: [], probation: [], slots: Math.max(4, slots | 0 || 12) };
}

function makeEntry(proto, ctx, learn, t) {
  const e = {
    proto: cleanProto(proto),
    contexts: emptyTallies(),
    confidence: 0.5,
    heard: 0,
    used: 0,
    bornAt: t,
    lastHeard: t,
    speakers: 0, // refreshed by the troop census (world.js)
  };
  if (ctx && LEX_CONTEXTS.includes(ctx)) e.contexts[ctx] = learn;
  return e;
}

// Distance in acoustic space, 0 (identical) to ~1 (opposite corners).
// Pitch weighted most — ears track pitch best.
export function acousticDistance(a, b) {
  const dp = (clamp01f(a.pitch) - clamp01f(b.pitch)) * 1.0;
  const dl = (clamp01f(a.length) - clamp01f(b.length)) * 0.8;
  const dv = (clamp01f(a.loudness) - clamp01f(b.loudness)) * 0.8;
  return Math.min(1, Math.sqrt(dp * dp + dl * dl + dv * dv) / 1.51);
}

function nearestIn(list, proto) {
  let best = null, bestD = Infinity;
  for (const e of list) {
    const d = acousticDistance(e.proto, proto);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best ? { entry: best, dist: bestD } : null;
}

// The novelty threshold adapts to local prototype density (delta b): with
// few entries, almost anything births a candidate; as the lexicon fills,
// only genuinely novel sounds do. Babble can't flood the slots.
export function noveltyThreshold(lex) {
  const n = lex.entries.length;
  if (n < 2) return 0.32;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = acousticDistance(lex.entries[i].proto, lex.entries[j].proto);
      if (d < m) m = d;
    }
    sum += m;
  }
  const meanNN = sum / n;
  return Math.min(0.35, Math.max(0.10, meanNN * 0.6));
}

function weakestEntry(lex) {
  let w = null;
  for (const e of lex.entries) {
    if (!w || e.confidence < w.confidence ||
        (e.confidence === w.confidence && e.lastHeard < w.lastHeard)) w = e;
  }
  return w;
}

function graduateCandidate(lex, cand, t) {
  const i = lex.probation.indexOf(cand);
  if (i >= 0) lex.probation.splice(i, 1);
  const e = makeEntry(cand.proto, null, 0, t);
  e.contexts = { ...cand.contexts };
  e.confidence = 0.55;
  e.heard = cand.hearings;
  e.lastHeard = t;
  if (lex.entries.length >= lex.slots) {
    const w = weakestEntry(lex);
    if (w) lex.entries.splice(lex.entries.indexOf(w), 1);
  }
  lex.entries.push(e);
  return e;
}

// The hearer's path (delta a, second half): a heard call either reinforces
// the nearest prototype (toward the hearer's own salient context) or, if
// novel, births a probationary candidate.
export function registerHeard(lex, proto, ctx, weight, learn, t) {
  proto = cleanProto(proto);
  weight = clamp01f(weight);
  learn = Math.max(0, learn);
  const nearE = nearestIn(lex.entries, proto);
  const nearC = nearestIn(lex.probation, proto);
  const thr = noveltyThreshold(lex);
  let near = null, isCand = false;
  if (nearE && (!nearC || nearE.dist <= nearC.dist)) near = nearE;
  else if (nearC) { near = nearC; isCand = true; }

  if (near && near.dist <= thr) {
    const e = near.entry;
    if (LEX_CONTEXTS.includes(ctx)) e.contexts[ctx] += learn * weight;
    if (isCand) {
      e.hearings = (e.hearings || 1) + 1;
      e.lastHeard = t;
      if (e.hearings >= LEX_PROBATION_HEARINGS) return graduateCandidate(lex, e, t);
      return e;
    }
    e.confidence = Math.min(1, e.confidence + 0.15 * learn * weight);
    e.heard += 1;
    e.lastHeard = t;
    return e;
  }
  // Novel: birth a candidate (delta b). Probation is capped; the oldest
  // unheard candidate is dropped to make room.
  const cand = {
    proto, contexts: emptyTallies(), hearings: 1, bornAt: t, lastHeard: t,
  };
  if (LEX_CONTEXTS.includes(ctx)) cand.contexts[ctx] = learn * weight;
  lex.probation.push(cand);
  if (lex.probation.length > LEX_MAX_PROBATION) {
    let oi = 0;
    for (let i = 1; i < lex.probation.length; i++) {
      if (lex.probation[i].bornAt < lex.probation[oi].bornAt) oi = i;
    }
    lex.probation.splice(oi, 1);
  }
  return cand;
}

// The speaker's path (delta a, first half): the speaker knows why it called,
// so its own production goes straight into the lexicon — no probation.
// Returns the entry the emitted prototype was registered against.
export function registerSpoken(lex, proto, ctx, learn, t) {
  proto = cleanProto(proto);
  learn = Math.max(0, learn);
  const near = nearestIn(lex.entries, proto);
  const thr = noveltyThreshold(lex);
  if (near && near.dist <= thr) {
    const e = near.entry;
    if (LEX_CONTEXTS.includes(ctx)) e.contexts[ctx] += learn;
    e.confidence = Math.min(1, e.confidence + 0.12 * learn);
    e.used += 1;
    e.lastHeard = t;
    return e;
  }
  const e = makeEntry(proto, ctx, learn, t);
  e.used = 1;
  if (lex.entries.length >= lex.slots) {
    const w = weakestEntry(lex);
    if (w) lex.entries.splice(lex.entries.indexOf(w), 1);
  }
  lex.entries.push(e);
  return e;
}

// Speaking: in a salient state, emit the prototype most tied to it, with a
// little production noise (delta: lexNoise). If nothing is tied to the
// state yet, babble around the creature's own voice — troops whose accents
// have converged babble similar pitches, which is how shared clusters form.
export function speakFromLexicon(c, ctx, rng) {
  const lex = c.lexicon;
  const pheno = c.pheno || {};
  let best = null, bestScore = 0;
  for (const e of lex.entries) {
    const s = (e.contexts[ctx] || 0) * (0.5 + e.confidence);
    if (s > bestScore) { bestScore = s; best = e; }
  }
  const noiseAmp = 0.10 * clamp01f(pheno.lexNoise ?? 0.3);
  const nz = (amp) => (rng.next() * 2 - 1) * amp;
  if (best && bestScore > 0.05) {
    return {
      entry: best,
      proto: {
        pitch: clamp01f(best.proto.pitch + nz(noiseAmp)),
        length: clamp01f(best.proto.length + nz(noiseAmp)),
        loudness: clamp01f(best.proto.loudness + nz(noiseAmp)),
      },
    };
  }
  // Babble: centered on the creature's own accent × body size.
  const accent = clamp01f(c.voicePitch ?? 0.5) * sizePitchFactor(pheno);
  return {
    entry: null,
    proto: {
      pitch: clamp01f(accent + nz(0.25)),
      length: clamp01f(0.2 + rng.next() * 0.5),
      loudness: clamp01f(baseLoud(pheno) + nz(0.2)),
    },
  };
}

// Slow decay (delta c): confidence fades over minutes of disuse. An entry
// is forgotten only when confidence is low AND few troop-mates speak it —
// culture lives at the troop level, not in one head.
export function decayLexicon(lex, dt, t) {
  if (dt <= 0) return;
  const f = Math.exp(-dt / LEX_DECAY_TAU);
  for (const e of lex.entries) e.confidence *= f;
  for (let i = lex.entries.length - 1; i >= 0; i--) {
    const e = lex.entries[i];
    if (lex.entries.length <= LEX_MIN_ENTRIES) break;
    if (e.confidence < LEX_FORGET_CONF && (e.speakers || 0) < LEX_FORGET_SPEAKERS) {
      lex.entries.splice(i, 1);
    }
  }
  const now = t || 0;
  for (let i = lex.probation.length - 1; i >= 0; i--) {
    if (now - lex.probation[i].bornAt > 120) lex.probation.splice(i, 1);
  }
}

// --- The hearer's salient context (delta a, hearer half) ------------------
// Each creature keeps a short window of salient contexts it has observed
// (its own states + witnessed salient events). On hearing a call, the most
// salient context in the window — weighted by recency — is what the heard
// prototype gets reinforced toward. The hearer never knows the speaker's
// state; it only knows what was salient to IT when the call arrived.
export const CTX_WINDOW = 24;   // entries
export const CTX_WINDOW_SECS = 3; // recency horizon
export function pushContextWindow(c, ctx, w, t) {
  if (!LEX_CONTEXTS.includes(ctx)) return;
  if (!c._contextWindow) c._contextWindow = [];
  c._contextWindow.push({ t, ctx, w: Math.max(0, Math.min(1, w || 0)) });
  if (c._contextWindow.length > CTX_WINDOW) {
    c._contextWindow.splice(0, c._contextWindow.length - CTX_WINDOW);
  }
}
export function hearerSalientContext(c, t) {
  let best = null, bestScore = 0;
  const win = c._contextWindow || [];
  for (const e of win) {
    const age = t - e.t;
    if (age < 0 || age > CTX_WINDOW_SECS) continue;
    const s = e.w * (1 - age / CTX_WINDOW_SECS);
    if (s > bestScore) { bestScore = s; best = e.ctx; }
  }
  if (!best) return { ctx: 'contact', weight: 0.2 };
  return { ctx: best, weight: Math.min(1, 0.3 + bestScore) };
}

// --- The field-linguist's notebook ----------------------------------------
// wordName is a pure, deterministic function of acoustics: the same
// prototype gets the same pronounceable name every session. No meaning is
// assigned — the name is just a handle for the statistics.
const WN_ON = [['w', 'm'], ['n', 'k'], ['t', 'k']];   // by pitch: low, mid, high
const WN_VW = [['uh', 'oo'], ['eh', 'ah'], ['i', 'ay']];
const WN_CODA = ['m', 'p', 't'];                       // short + loud only
export function wordName(proto) {
  const p = cleanProto(proto);
  const pb = p.pitch < 0.34 ? 0 : p.pitch < 0.67 ? 1 : 2;
  const lb = p.length < 0.5 ? 0 : 1;
  const vb = p.loudness < 0.5 ? 0 : 1;
  const on = WN_ON[pb][(lb + vb) % 2];
  const vw = WN_VW[pb][lb];
  let w = on + vw;
  if (lb === 1) w += vw[0];              // lengthened: mooo
  if (vb === 1 && lb === 0) w += WN_CODA[pb]; // clipped + loud: KIT!
  if (vb === 1) w = w.toUpperCase() + '!';
  return w;
}

// Context statistics for one entry: the inferred-meaning view.
export function entryStats(e) {
  let total = 0;
  for (const k of LEX_CONTEXTS) total += e.contexts[k] || 0;
  const pct = {};
  for (const k of LEX_CONTEXTS) pct[k] = total > 0 ? (e.contexts[k] || 0) / total : 0;
  let top = 'contact', topP = 0;
  for (const k of LEX_CONTEXTS) if (pct[k] > topP) { topP = pct[k]; top = k; }
  return { total, pct, top, topPct: topP };
}

// v0.16: the recent-utterance log — the Tongues notebook's raw material.
// Every utterance is recorded with its TRUE context (the speaker's real
// salient state at emission). The notebook shows inferred statistics, never
// assigned meanings; the log is the ground truth underneath.
export function pushUtterance(world, call) {
  if (!world.utterLog) world.utterLog = [];
  world.utterLog.push({
    t: world.time,
    name: wordName(call.proto || call),
    speaker: call.callerName || '—',
    ctx: call.type,
    pitch: call.pitch,
    fromTeacher: !!call.fromTeacher,
  });
  if (world.utterLog.length > 80) world.utterLog.splice(0, world.utterLog.length - 80);
}

// Lexicon distance 0..1: mean nearest-neighbor acoustic distance, symmetric.
// Wired into v0.14's dialect mate-choice and the hybrid penalty (delta d) —
// this is what turns word-drift into distinct languages.
export function lexiconDistance(lexA, lexB) {
  const A = (lexA && lexA.entries) || [];
  const B = (lexB && lexB.entries) || [];
  if (!A.length && !B.length) return 0;  // no words yet: nothing to differ about
  if (!A.length || !B.length) return 0.5; // one side silent: neutral, not hostile
  const oneWay = (X, Y) => {
    let s = 0;
    for (const e of X) {
      let m = Infinity;
      for (const o of Y) {
        const d = acousticDistance(e.proto, o.proto);
        if (d < m) m = d;
      }
      s += m;
    }
    return s / X.length;
  };
  return clamp01f((oneWay(A, B) + oneWay(B, A)) / 2);
}
