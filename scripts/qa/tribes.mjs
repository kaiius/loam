// v0.12 tribes & bonds QA: survival + band persistence + kin assortment +
// home fidelity + bond health + zone divergence re-run.
// Run: node scripts/qa/tribes.mjs [seeds] [minutes]
import { createWorld, bindWorld, populate, tickWorld } from '../../src/sim/world.js';
import { ratchetIndex } from '../../src/sim/culture.js';
import { detectTribes, socialStats, pedigreeKin } from '../../src/sim/social.js';

const seeds = (process.argv[2] || '7,11,22,33,42,55,66,77,88,99').split(',').map(Number);
const minutes = Number(process.argv[3] || 240);

function kinAssortment(world, tribes) {
  // Fraction of within-band pairs that are kin (kinship >= 0.5).
  const byId = new Map(world.creatures.map((c) => [c.id, c]));
  let pairs = 0, kinPairs = 0;
  for (const t of tribes) {
    const mems = t.members.map((id) => byId.get(id)).filter(Boolean);
    for (let i = 0; i < mems.length; i++) {
      for (let j = i + 1; j < mems.length; j++) {
        pairs++;
        if (pedigreeKin(world, mems[i], mems[j]) >= 0.5) kinPairs++;
      }
    }
  }
  return pairs ? kinPairs / pairs : 0;
}

function zoneDivergence(world) {
  // Mean absolute trait deviation by birth zone (established lineages only).
  const byZone = {};
  for (const rec of world.lineage.values()) {
    if (rec.generation < 3 || !rec.zone) continue;
    (byZone[rec.zone] = byZone[rec.zone] || []).push(rec);
  }
  const zones = Object.keys(byZone);
  if (zones.length < 2) return 'n/a';
  const traits = ['size', 'legLength', 'fur', 'spikes', 'boldness'];
  const means = {};
  for (const z of zones) {
    means[z] = {};
    for (const tr of traits) {
      const vals = byZone[z].map((r) => r.traits[tr]).filter((v) => v !== undefined);
      means[z][tr] = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    }
  }
  let d = 0, n = 0;
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      for (const tr of traits) { d += Math.abs(means[zones[i]][tr] - means[zones[j]][tr]); n++; }
    }
  }
  return (d / n).toFixed(3);
}

function runSeed(seed) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  const bandHistory = [];
  for (let m = 0; m < minutes; m++) {
    for (let t = 0; t < 600; t++) tickWorld(world, 0.1);
    const alive = world.creatures.filter((c) => c.alive).length;
    if (!alive) return { seed, extinct: true, at: m };
    if (m % 60 === 0) bandHistory.push(world.tribes.length);
  }
  const tribes = detectTribes(world);
  const st = socialStats(world);
  const maxGen = Math.max(0, ...world.creatures.map((c) => c.generation || 0));
  return {
    seed, extinct: false,
    pop: world.creatures.filter((c) => c.alive).length,
    maxGen,
    cri: ratchetIndex(world.culture).toFixed(2),
    bands: tribes.length,
    bandSizes: tribes.map((t) => t.members.length).join('/'),
    bandHistory: bandHistory.join(','),
    kinAssort: kinAssortment(world, tribes).toFixed(2),
    fidelity: st.homeFidelity.toFixed(2),
    bonds: st.bonds,
    meanBond: st.meanBond.toFixed(2),
    friends: st.friendPairs,
    zoneDiv: zoneDivergence(world),
  };
}

console.log(`v0.12 tribes QA: seeds=${seeds.length} minutes=${minutes}`);
let failures = 0;
const rows = [];
for (const seed of seeds) {
  const r = runSeed(seed);
  rows.push(r);
  if (r.extinct) { failures++; console.log(`seed ${seed}: EXTINCT at minute ${r.at}`); continue; }
  console.log(
    `seed ${seed}: pop=${r.pop} gen=${r.maxGen} cri=${r.cri} bands=${r.bands}[${r.bandSizes}] ` +
    `bandHist=[${r.bandHistory}] kinAssort=${r.kinAssort} fidelity=${r.fidelity} ` +
    `bonds=${r.bonds} meanBond=${r.meanBond} friends=${r.friends} zoneDiv=${r.zoneDiv}`
  );
}
console.log(failures ? `FAIL: ${failures} extinctions` : 'ALL SEEDS SURVIVED');
