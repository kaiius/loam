// The Chronicle — the world's official record.
//
// Event-sourced narrative: buildChronicle(world) reads the logs the sim
// already keeps (world.events, lineage birth zones, speciesLog splits,
// dupEvents, divergenceLog, teachLog) and organizes them into chapters of
// narrative prose. Every proper noun and number in the prose comes from a
// logged event — nothing is invented. Each entry carries jump targets so the
// UI can take the reader to the creature in the family tree, the moment in
// the evolution tracker, or the place in the world view.
//
// Pure and side-effect free: safe to rebuild on every panel open, which is
// what makes the final chapter "living".

import { zoneAt, ZONES, DAY_LENGTH } from './world.js';

export const CHAPTERS = [
  { id: 'genesis', title: 'Genesis', icon: '🌱', blurb: 'The founding — the first tanglekins to know this world.' },
  { id: 'spread', title: 'The Spread', icon: '🗺️', blurb: 'Migration — the first births in each biome.' },
  { id: 'words', title: 'First Words', icon: '🎵', blurb: 'Speech and culture — traditions, the Teacher’s motif, diverging dialects.' },
  { id: 'split', title: 'The Split', icon: '💥', blurb: 'Speciation and the genome’s own inventions — duplications, novel genomes.' },
  { id: 'teacher', title: 'The Teacher', icon: '🧑‍🏫', blurb: 'Sunny’s avatar among the tanglekins — arrival, demonstrations, rewards.' },
  { id: 'present', title: 'The Living Present', icon: '📖', blurb: 'Recent history, still being written.' },
];

const GENESIS_HATCHES = 8;
const CHAPTER_CAP = 24;
const PRESENT_CAP = 14;
// |Eliza's S| for vocalPitch at which a zone's voices count as diverging.
const DIALECT_S = 0.5;

// Event types worth a line in the living present (the noisy everyday —
// jumps, landings, infections — stays out of the official record).
const NOTABLE = new Set([
  'hatch', 'death', 'mating', 'speciation', 'traditionFounded',
  'traditionAdopted', 'epimark', 'novelGenome', 'beautifulMutant', 'seedDispersed',
]);

const dayOf = (t) => `Day ${Math.floor((t || 0) / DAY_LENGTH) + 1}`;
const zoneName = (key) => (ZONES.find((z) => z.key === key) || {}).name || key || 'the wilds';

function linRec(world, id) {
  return (id === undefined || id === null) ? null : (world.lineage.get(id) || null);
}

// A creature's display name from a live ref, a lineage record, or an id.
function cname(world, refOrId) {
  if (refOrId && typeof refOrId === 'object' && refOrId.name) return refOrId.name;
  const rec = linRec(world, typeof refOrId === 'object' ? refOrId && refOrId.id : refOrId);
  return (rec && rec.name) || 'a tanglekin';
}

function birthZoneName(world, creature) {
  const id = creature && typeof creature === 'object' ? creature.id : creature;
  const rec = linRec(world, id);
  return zoneName(rec && rec.zone);
}

// Jump targets for an entry. tree → family tree focused on the creature
// (lineage keeps the dead resolvable); evo → evolution tracker with a time
// marker; world → select the live creature / the Teacher in the world view.
function jumpsFor(world, { creatureId, teacher, t }) {
  const jumps = [];
  if (creatureId !== undefined && creatureId !== null && world.lineage.has(creatureId)) {
    jumps.push({ label: '🌳', title: 'Open in the family tree', tab: 'tree', creatureId });
  }
  if (typeof t === 'number' && isFinite(t)) {
    jumps.push({ label: '📈', title: 'Mark this moment in the evolution tracker', tab: 'evo', time: t });
  }
  if (teacher) {
    jumps.push({ label: '👁', title: 'See the Teacher in the world', tab: 'world', teacher: true });
  } else if (creatureId !== undefined && creatureId !== null &&
             world.creatures.some((c) => c.id === creatureId)) {
    jumps.push({ label: '👁', title: 'See in the world', tab: 'world', creatureId });
  }
  return jumps;
}

function entry(world, { t, icon, text, creatureId, teacher }) {
  return { t, day: dayOf(t), icon, text, jumps: jumpsFor(world, { creatureId, teacher, t }) };
}

const cid = (c) => (c && typeof c === 'object' ? c.id : c);

// ---- Genesis: founders, the first pairing, the first loss ----
function genesis(world) {
  const out = [];
  // Founders are created, not hatched — no hatch event exists for them.
  // The lineage records with no parents ARE the founding, honestly sourced.
  const founders = [...world.lineage.values()]
    .filter((r) => r && (!r.parents || !r.parents.length))
    .sort((a, b) => (a.bornAt || 0) - (b.bornAt || 0))
    .slice(0, GENESIS_HATCHES);
  for (const rec of founders) {
    out.push(entry(world, {
      t: rec.bornAt, icon: '🌱',
      text: `${rec.name || 'a tanglekin'} arrived in ${zoneName(rec.zone)} — one of the first tanglekins to know this world.`,
      creatureId: rec.id,
    }));
  }
  const firstMating = world.events.find((e) => e.type === 'mating');
  if (firstMating) {
    out.push(entry(world, {
      t: firstMating.t, icon: '💞',
      text: `${cname(world, firstMating.a)} and ${cname(world, firstMating.b)} mated — the world's first pairing.`,
      creatureId: cid(firstMating.a),
    }));
  }
  const firstDeath = world.events.find((e) => e.type === 'death');
  if (firstDeath) {
    out.push(entry(world, {
      t: firstDeath.t, icon: '🕯️',
      text: `The world's first loss: ${cname(world, firstDeath.creature)} died (${firstDeath.cause || 'unknown causes'}).`,
      creatureId: cid(firstDeath.creature),
    }));
  }
  return out.sort((a, b) => a.t - b.t).slice(0, CHAPTER_CAP);
}

// ---- The Spread: first birth in each biome, from lineage birth zones ----
function spread(world) {
  const firstByZone = new Map(); // zoneKey → lineage rec
  for (const rec of world.lineage.values()) {
    if (!rec || !rec.zone) continue;
    const cur = firstByZone.get(rec.zone);
    if (!cur || (rec.bornAt || 0) < (cur.bornAt || 0)) firstByZone.set(rec.zone, rec);
  }
  return [...firstByZone.entries()]
    .sort((a, b) => (a[1].bornAt || 0) - (b[1].bornAt || 0))
    .slice(0, ZONES.length)
    .map(([zkey, rec]) => entry(world, {
      t: rec.bornAt, icon: '🗺️',
      text: `Tanglekins reached ${zoneName(zkey)} on ${dayOf(rec.bornAt)} — ${rec.name || 'a tanglekin'} was the first born there.`,
      creatureId: rec.id,
    }));
}

// ---- First Words: traditions, the Teacher's motif, diverging dialects ----
function words(world) {
  const out = [];
  for (const e of world.events.filter((e) => e.type === 'traditionFounded').slice(0, 10)) {
    out.push(entry(world, {
      t: e.t, icon: '📜',
      text: `${cname(world, e.creature)} founded a new tradition: “${e.name || 'an unnamed way'}”.`,
      creatureId: cid(e.creature),
    }));
  }
  for (const e of (world.teachLog || []).filter((e) => e.kind === 'demo' || e.kind === 'reward').slice(0, 8)) {
    if (e.kind === 'demo') {
      out.push(entry(world, {
        t: e.t, icon: '🎓',
        text: `The Teacher demonstrated its motif in ${zoneName(e.zone)}${e.listeners ? ` — ${e.listeners} tanglekin${e.listeners === 1 ? '' : 's'} listened` : ''}. Exact pitches, a clear model.`,
        teacher: true,
      }));
    } else {
      out.push(entry(world, {
        t: e.t, icon: '🌟',
        text: `The Teacher rewarded ${e.n || 'several'} imitator${e.n === 1 ? '' : 's'} near pitch ${(e.pitch ?? 0).toFixed(2)} in ${zoneName(e.zone)} — selection for the motif.`,
        teacher: true,
      }));
    }
  }
  // Dialect emergence: first crossing of |Eliza's S| for vocalPitch per zone.
  const crossed = new Set();
  for (const d of world.divergenceLog || []) {
    for (const [zkey, zs] of Object.entries(d.zones || {})) {
      if (crossed.has(zkey)) continue;
      const s = zs && zs.vocalPitch;
      if (typeof s === 'number' && Math.abs(s) >= DIALECT_S) {
        crossed.add(zkey);
        out.push(entry(world, {
          t: d.t, icon: '🎵',
          text: `In ${zoneName(zkey)}, voices diverged — Eliza's S for voice pitch reached ${s.toFixed(2)}: a dialect is taking shape.`,
        }));
      }
    }
  }
  return out.sort((a, b) => a.t - b.t).slice(0, CHAPTER_CAP);
}

// ---- The Split: speciation, novel genomes, duplications ----
function split(world) {
  const out = [];
  // Speciation is logged twice by the sim (world.events + speciesLog);
  // merge, deduped on (t, from).
  const seen = new Set();
  const splits = [];
  for (const e of (world.speciesLog || []).filter((e) => e.kind === 'split')) {
    seen.add(`${e.t}:${e.from}`);
    splits.push(e);
  }
  for (const e of world.events.filter((e) => e.type === 'speciation')) {
    if (!seen.has(`${e.t}:${e.from}`)) splits.push(e);
  }
  for (const e of splits) {
    const kinds = (e.to || []).map((id, i) => `#${id}${e.sizes && e.sizes[i] !== undefined ? ` (${e.sizes[i]})` : ''}`).join(', ');
    const total = (e.sizes || []).reduce((a, b) => a + b, 0);
    out.push(entry(world, {
      t: e.t, icon: '💥',
      text: `The lineage split: species #${e.from} gave rise to ${kinds}${total ? ` — ${total} individuals between the new kinds` : ''}.`,
    }));
  }
  for (const e of world.events.filter((e) => e.type === 'novelGenome').slice(0, 6)) {
    out.push(entry(world, {
      t: e.t, icon: '🧬',
      text: `${cname(world, e.creature)} was born with a genome never seen before in this world.`,
      creatureId: cid(e.creature),
    }));
  }
  for (const e of world.events.filter((e) => e.type === 'beautifulMutant').slice(0, 6)) {
    out.push(entry(world, {
      t: e.t, icon: '✨',
      text: `${cname(world, e.creature)} and ${cname(world, e.mate)} produced a strikingly beautiful child — the eye of selection is on this bloodline.`,
      creatureId: cid(e.creature),
    }));
  }
  for (const e of (world.dupEvents || []).slice(0, 10)) {
    const who = (e.parents || []).map((id) => cname(world, id)).join(' and ') || 'unknown parents';
    out.push(entry(world, {
      t: e.t, icon: e.kind === 'duplication' ? '🧬' : '✂️',
      text: e.kind === 'duplication'
        ? `In the line of ${who}, the ${e.key} gene duplicated — evolution's rough draft.`
        : `In the line of ${who}, a copy of the ${e.key} gene was lost.`,
      creatureId: e.parents && e.parents[0],
    }));
  }
  return out.sort((a, b) => a.t - b.t).slice(0, CHAPTER_CAP);
}

// ---- The Teacher: Sunny's avatar among the tanglekins ----
function teacherCh(world) {
  const log = world.teachLog || [];
  const out = [];
  if (log.length) {
    // The Teacher's first recorded act is proof of presence — the arrival
    // entry is dated to it, honestly.
    out.push(entry(world, {
      t: log[0].t, icon: '🧑‍🏫', teacher: true,
      text: `Sunny arrived in the canopy — the Teacher walks among the tanglekins.`,
    }));
  }
  for (const e of log.slice(0, 20)) {
    const base = { t: e.t, teacher: true };
    switch (e.kind) {
      case 'mode':
        out.push(entry(world, { ...base, icon: e.mode === 'possessed' ? '✋' : '🤖',
          text: e.mode === 'possessed'
            ? `Sunny took the Teacher's hand — possessed, moving at will.`
            : `The Teacher was released to wander on its own.` }));
            break;
      case 'demo':
        out.push(entry(world, { ...base, icon: '🎓',
          text: `The Teacher demonstrated its ${e.type || 'contact'} motif in ${zoneName(e.zone)}${e.listeners ? ` for ${e.listeners} listener${e.listeners === 1 ? '' : 's'}` : ''}.` }));
          break;
      case 'reward':
        out.push(entry(world, { ...base, icon: '🌟',
          text: `The Teacher rewarded ${e.n || 'several'} imitator${e.n === 1 ? '' : 's'} near pitch ${(e.pitch ?? 0).toFixed(2)} in ${zoneName(e.zone)}.` }));
          break;
      case 'rewardNearest':
        out.push(entry(world, { ...base, icon: '🌟',
          text: `The Teacher singled out ${cname(world, e.creature)} for reward in ${zoneName(e.zone)}.` }));
          break;
      case 'arrive':
        out.push(entry(world, { ...base, icon: '📍', text: `The Teacher arrived in ${zoneName(e.zone)}.` }));
        break;
      case 'taste':
        out.push(entry(world, { ...base, icon: '👅', text: `The Teacher tasted ${e.flavor || 'fruit'} in ${zoneName(e.zone)}.` }));
        break;
      case 'petted':
        out.push(entry(world, { ...base, icon: '💕', text: `Someone petted the Teacher — comfort ${(e.comfort ?? 0).toFixed(2)}.` }));
        break;
      case 'command':
        out.push(entry(world, { ...base, icon: '📣', text: `The Teacher was commanded onward toward ${zoneName(e.zone)}.` }));
        break;
      case 'followSmell':
        out.push(entry(world, { ...base, icon: '👃', text: `The Teacher followed the smell of fruit into ${zoneName(e.zone)}.` }));
        break;
      default:
        out.push(entry(world, { ...base, icon: '🧑‍🏫', text: `The Teacher: ${e.kind}.` }));
        break;
    }
  }
  return out;
}

// ---- The Living Present: recent notable history ----
function present(world) {
  const els = [];
  let seeds = 0; // seedlings are scenery — at most two lines in the record
  for (const e of world.events) {
    if (!NOTABLE.has(e.type)) continue;
    const c = e.creature || e.a;
    if (e.type === 'hatch') {
      const rec = linRec(world, cid(c));
      if (rec && rec.parents && rec.parents.length) {
        els.push(entry(world, { t: e.t, icon: '🐣', text: `${cname(world, c)} was born in ${birthZoneName(world, c)} — generation ${rec.generation || 0}.`, creatureId: cid(c) }));
      }
      continue;
    }
    if (e.type === 'death') {
      const age = c && c.biochem ? c.biochem.age : 0;
      const span = c && c.pheno ? c.pheno.lifespanSec : 1;
      if (age > span * 0.6) {
        const daysOld = Math.max(1, Math.floor(age / DAY_LENGTH));
        els.push(entry(world, { t: e.t, icon: '🕯️', text: `Elder ${cname(world, c)} died ${daysOld} day${daysOld === 1 ? '' : 's'} old (${e.cause || 'unknown causes'}).`, creatureId: cid(c) }));
      }
      continue;
    }
    if (e.type === 'mating') {
      els.push(entry(world, { t: e.t, icon: '💞', text: `${cname(world, e.a)} and ${cname(world, e.b)} mated.`, creatureId: cid(e.a) }));
      continue;
    }
    if (e.type === 'speciation') {
      els.push(entry(world, { t: e.t, icon: '💥', text: `A speciation: species #${e.from} split into ${(e.to || []).length} new kinds.`, }));
      continue;
    }
    if (e.type === 'traditionFounded') {
      els.push(entry(world, { t: e.t, icon: '📜', text: `${cname(world, c)} founded the tradition “${e.name || 'an unnamed way'}”.`, creatureId: cid(c) }));
      continue;
    }
    if (e.type === 'traditionAdopted') {
      els.push(entry(world, { t: e.t, icon: '🤝', text: `${cname(world, c)} adopted the tradition “${e.name || 'an unnamed way'}”.`, creatureId: cid(c) }));
      continue;
    }
    if (e.type === 'epimark') {
      els.push(entry(world, { t: e.t, icon: '🧪', text: `Experience marked ${cname(world, c)}: ${e.note || 'an epigenetic mark'}.`, creatureId: cid(c) }));
      continue;
    }
    if (e.type === 'novelGenome') {
      els.push(entry(world, { t: e.t, icon: '🧬', text: `${cname(world, c)} carries a genome never seen before.`, creatureId: cid(c) }));
      continue;
    }
    if (e.type === 'beautifulMutant') {
      els.push(entry(world, { t: e.t, icon: '✨', text: `A strikingly beautiful child was born to ${cname(world, c)}.`, creatureId: cid(c) }));
      continue;
    }
    if (e.type === 'seedDispersed') {
      if (seeds >= 2) continue;
      seeds++;
      els.push(entry(world, { t: e.t, icon: '🌰', text: `A seedling took root, far from its parent.` }));
      continue;
    }
  }
  return els.sort((a, b) => b.t - a.t).slice(0, PRESENT_CAP).sort((a, b) => a.t - b.t);
}

export function buildChronicle(world) {
  const w = world || {};
  const builders = { genesis, spread, words, split, teacher: teacherCh, present };
  return CHAPTERS.map((ch) => {
    let entries = [];
    try {
      entries = builders[ch.id]({
        events: w.events || [],
        lineage: w.lineage || new Map(),
        creatures: w.creatures || [],
        speciesLog: w.speciesLog || [],
        dupEvents: w.dupEvents || [],
        divergenceLog: w.divergenceLog || [],
        teachLog: w.teachLog || [],
      });
    } catch (err) {
      entries = [];
    }
    return { ...ch, entries };
  });
}
