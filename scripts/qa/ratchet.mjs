// v0.7 ratchet QA: multi-seed survival + tradition metrics + the library test.
// Run: node scripts/qa/ratchet.mjs [seeds] [minutes]
// The library test: at the halfway mark, wipe every tradition (keep genomes
// and brains) and measure whether the repertoire re-emerges — culture is
// inheritance that isn't DNA, so wiping it should hurt and then recover.
import { createWorld, bindWorld, populate, tickWorld } from '../../src/sim/world.js';
import { ratchetIndex } from '../../src/sim/culture.js';

const seeds = (process.argv[2] || '7,11,22,33,42,55,66,77,88,99').split(',').map(Number);
const minutes = Number(process.argv[3] || 240);

function runSeed(seed, libraryTest) {
  const world = bindWorld(createWorld(seed));
  populate(world);
  const half = Math.floor(minutes / 2);
  let wiped = false;
  let foundedBeforeWipe = 0;
  for (let m = 0; m < minutes; m++) {
    for (let t = 0; t < 600; t++) tickWorld(world, 0.1);
    const alive = world.creatures.filter((c) => c.alive).length;
    if (!alive) return { seed, extinct: true, at: m };
    if (libraryTest && !wiped && m >= half) {
      foundedBeforeWipe = world.culture.founded;
      // Wipe every brain's culture: all traditions, all carried ids. Genomes
      // and learned weights survive — only the second inheritance channel dies.
      world.culture.traditions = [];
      world.culture.extinct += 0; // wiped, not extinct — they didn't die out
      for (const c of world.creatures) { c.traditions = []; c.traditionAim = {}; }
      wiped = true;
    }
  }
  const cu = world.culture;
  const maxGen = Math.max(0, ...world.creatures.map((c) => c.generation || 0));
  return {
    seed, extinct: false,
    pop: world.creatures.filter((c) => c.alive).length,
    maxGen,
    founded: cu.founded,
    liveNow: cu.traditions.length,
    extinctTrad: cu.extinct,
    cri: ratchetIndex(cu).toFixed(2),
    samples: cu.samples.length,
    libraryTest: libraryTest ? { foundedBeforeWipe, refounded: cu.founded - foundedBeforeWipe } : null,
  };
}

const mode = process.argv[4] || 'normal';
console.log(`mode=${mode} seeds=${seeds.length} minutes=${minutes}`);
let failures = 0;
for (const seed of seeds) {
  const r = runSeed(seed, mode === 'library');
  if (r.extinct) {
    console.log(`seed ${seed}: EXTINCT at t=${r.at}min`);
    failures++;
  } else if (mode === 'library') {
    console.log(`seed ${seed}: pop=${r.pop} maxGen=${r.maxGen} founded=${r.founded} live=${r.liveNow} wiped=${r.libraryTest.foundedBeforeWipe} refounded=${r.libraryTest.refounded}`);
  } else {
    console.log(`seed ${seed}: pop=${r.pop} maxGen=${r.maxGen} founded=${r.founded} live=${r.liveNow} extinctT=${r.extinctTrad} CRI=${r.cri}`);
    if (r.founded === 0) { console.log(`  WARN: no traditions invented on seed ${seed}`); }
  }
}
console.log(failures === 0 ? 'ALL SEEDS SURVIVED' : `${failures} EXTINCTIONS`);
process.exit(failures === 0 ? 0 : 1);
