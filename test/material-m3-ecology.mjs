// Loam M3 — ecology execution probes: predation, grazing, plant heredity,
// weather coupling. Every test forces the mechanism in a live sim and
// watches the effect happen. Wiring tests are not proof (AGENTS.md lesson).
// Run: node --test test/material-m3-ecology.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAT, CELL_PX } from '../src/material/grid.js';
import { createRng } from '../src/sim/rng.js';
import { createMaterialWorld, tickMaterialWorldM2 } from '../src/material/index.js';
import { spawnSpecies } from '../src/material/species.js';
import { spawnCorpse, nearestCorpse, tickCorpses } from '../src/material/corpses.js';
import { tickSeeds, makeSeed, seedFromFeeding, tickPlants, attachPlantGenomes } from '../src/material/plants.js';
import { plantPhenotype, randomPlantGenome } from '../src/sim/plantgenome.js';
import { createSky, tickSky } from '../src/material/weather.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { executeAction } from '../src/material/actions.js';
import { tickMaterialCreature } from '../src/material/mcreature.js';

function ctxOf(mw) { return { others: mw.m2creatures, bonds: mw.bonds }; }

// --- predation -----------------------------------------------------------

test('probe: PREDATION — a jungle-cat kills, the grub becomes a corpse', () => {
  const mw = createMaterialWorld(11, 1);
  const rng = createRng(99);
  const cat = spawnSpecies(mw, rng, 'jungle-cat', 600, 200);
  const grub = spawnSpecies(mw, rng, 'grub', 615, 200);
  grub.exploration = 0; // hold still for the probe
  mw.m2creatures.push(cat, grub);
  assert.equal(mw.corpses.length, 0, 'no corpses yet');
  for (let i = 0; i < 5 && grub.alive; i++) {
    const s = gatherMaterialSenses(mw, cat, ctxOf(mw));
    executeAction(mw, cat, 23 /* bite */, s, ctxOf(mw));
    tickMaterialCreature(mw, grub, ctxOf(mw));
  }
  assert.ok(!grub.alive, 'the grub died of its wounds');
  assert.equal(mw.corpses.length, 1, 'death left a corpse');
  assert.ok(mw.corpses[0].meat > 0, 'the corpse has meat');
});

test('probe: SCAVENGING — a vulture finds and eats the corpse', () => {
  const mw = createMaterialWorld(11, 1);
  const rng = createRng(99);
  const grub = spawnSpecies(mw, rng, 'grub', 615, 200);
  mw.m2creatures.push(grub);
  grub.alive = false;
  spawnCorpse(mw, grub);
  const v = spawnSpecies(mw, rng, 'vulture', 625, 200);
  mw.m2creatures.push(v);
  gatherMaterialSenses(mw, v, ctxOf(mw));
  assert.equal(v._foodTarget && v._foodTarget.kind, 'corpse', 'the vulture smells carrion');
  const meat0 = mw.corpses[0].meat;
  const s = gatherMaterialSenses(mw, v, ctxOf(mw));
  executeAction(mw, v, 1 /* eat */, s, ctxOf(mw));
  assert.ok(mw.corpses[0].meat < meat0, 'meat decreased: scavenging is real');
});

test('probe: HERBIVORE REFUSAL — a grazer will not eat meat', () => {
  const mw = createMaterialWorld(11, 1);
  const rng = createRng(99);
  const grub = spawnSpecies(mw, rng, 'grub', 615, 200);
  mw.m2creatures.push(grub);
  grub.alive = false;
  spawnCorpse(mw, grub);
  const flutter = spawnSpecies(mw, rng, 'flutter', 625, 200);
  assert.equal(flutter.pheno.diet, 'herbivore');
  mw.m2creatures.push(flutter);
  gatherMaterialSenses(mw, flutter, ctxOf(mw));
  const isCorpse = flutter._foodTarget && flutter._foodTarget.kind === 'corpse';
  assert.ok(!isCorpse, 'the herbivore does not see meat as food');
});

// --- grazing + dispersal ---------------------------------------------------

test('probe: GRAZING — eating fruit disperses seeds (endozoochory)', () => {
  const mw = createMaterialWorld(21, 1);
  const rng = createRng(7);
  const fp = mw.plants.find((p) => p.fruiting);
  assert.ok(fp, 'a fruiting plant exists');
  fp.fruit = 5;
  const grazer = spawnSpecies(mw, rng, 'scurrier', fp.seedX * 10 + 40, fp.seedY * 10);
  mw.m2creatures.push(grazer);
  assert.equal(mw.seeds.length, 0);
  for (let i = 0; i < 20; i++) {
    const s = gatherMaterialSenses(mw, grazer, ctxOf(mw));
    executeAction(mw, grazer, 1 /* eat */, s, ctxOf(mw));
  }
  assert.ok(mw.seeds.length > 0, 'seeds were dispersed by feeding');
  assert.ok(fp.fruit < 5, 'fruit was consumed');
});

test('probe: GERMINATION — a dispersed seed becomes a generation-1 plant', () => {
  const mw = createMaterialWorld(21, 1);
  const rng = createRng(7);
  const fp = mw.plants.find((p) => p.fruiting);
  fp.fruit = 5;
  const grazer = spawnSpecies(mw, rng, 'scurrier', fp.seedX * 10 + 40, fp.seedY * 10);
  mw.m2creatures.push(grazer);
  const n0 = mw.plants.length;
  for (let i = 0; i < 20; i++) {
    const s = gatherMaterialSenses(mw, grazer, ctxOf(mw));
    executeAction(mw, grazer, 1, s, ctxOf(mw));
  }
  for (let t = 0; t < 400; t++) tickMaterialWorldM2(mw);
  const kids = mw.plants.filter((p) => p.generation >= 1);
  assert.ok(kids.length > 0, 'generation-1 plants grew from dispersed seeds');
  assert.ok(mw.plants.length >= n0, 'the forest did not shrink');
});

// --- heredity ---------------------------------------------------------------

test('probe: HEREDITY — two generations show heritable trait shifts', () => {
  const mw = createMaterialWorld(21, 1);
  const rng = createRng(7);
  const fp = mw.plants.find((p) => p.fruiting);
  fp.fruit = 5;
  const momPh = plantPhenotype(fp.genome);
  const grazer = spawnSpecies(mw, rng, 'scurrier', fp.seedX * 10 + 40, fp.seedY * 10);
  mw.m2creatures.push(grazer);
  for (let i = 0; i < 20; i++) {
    const s = gatherMaterialSenses(mw, grazer, ctxOf(mw));
    executeAction(mw, grazer, 1, s, ctxOf(mw));
  }
  for (let t = 0; t < 600; t++) tickMaterialWorldM2(mw);
  const kids = mw.plants.filter((p) => p.generation >= 1 && p.genome);
  assert.ok(kids.length > 0, 'children exist');
  // Heritable variation: at least one child differs from mom in a trait
  // beyond mutation noise — segregation + mutation move the lineage.
  let differed = 0;
  for (const k of kids) {
    const kp = plantPhenotype(k.genome);
    const dy = Math.abs(kp.yield - momPh.yield);
    const dg = Math.abs(kp.growthRate - momPh.growthRate);
    const db = Math.abs(kp.bitterness - momPh.bitterness);
    if (dy > 0.01 || dg > 0.01 || db > 0.01) differed++;
  }
  assert.ok(differed > 0, 'children differ heritably from the mother');
});

test('unit: plant genomes are diploid with meiosis + mutation', () => {
  const rng = createRng(1234);
  const a = randomPlantGenome(rng), b = randomPlantGenome(rng);
  assert.equal(Object.keys(a.alleles).length, 10, '10 loci');
  assert.equal(a.alleles.yield.length, 2, 'diploid');
  // Meiosis via seedFromFeeding path is covered above; check phenotype ranges.
  const ph = plantPhenotype(a);
  for (const k of Object.keys(ph)) {
    assert.ok(ph[k] >= 0 && ph[k] <= 1, `trait ${k} in [0,1]`);
  }
});

// --- weather ------------------------------------------------------------------

test('probe: RAIN — a saturated cloud adds water cells to the grid', () => {
  const mw = createMaterialWorld(31, 1);
  const sky = mw.sky, g = mw.grid;
  const col = 10;
  sky.cols[col].cloud = 0.9; sky.cols[col].T = 0.3; sky.cols[col].vapor = 0.8;
  const x0 = Math.floor((col * 100) / 10), x1 = Math.min(g.cols, Math.ceil(((col + 1) * 100) / 10));
  let w0 = 0;
  for (let cx = x0; cx < x1; cx++) for (let cy = 0; cy < g.rows; cy++) w0 += g.water[cy * g.cols + cx];
  for (let t = 0; t < 40; t++) tickSky(mw, 20);
  let w1 = 0;
  for (let cx = x0; cx < x1; cx++) for (let cy = 0; cy < g.rows; cy++) w1 += g.water[cy * g.cols + cx];
  assert.ok(w1 > w0, `rain added water: ${w0.toFixed(1)} -> ${w1.toFixed(1)}`);
});

test('probe: WIND — seeds drift downwind', () => {
  const mw = createMaterialWorld(31, 1);
  const rng = createRng(3);
  mw.sky.cols.forEach((c) => { c.windU = 60; });
  const s = makeSeed(mw, 500, 300, randomPlantGenome(rng), {});
  s.vx = 0; s.vy = 0;
  mw.seeds.push(s);
  const x0 = s.x;
  for (let t = 0; t < 20 && mw.seeds.length; t++) tickSeeds(mw);
  assert.ok(s.x > x0, `seed drifted east: ${x0.toFixed(0)} -> ${s.x.toFixed(0)}`);
});

test('probe: LIGHTNING — a held storm ignites flammable cells', () => {
  const mw = createMaterialWorld(31, 1);
  const sky = mw.sky, g = mw.grid;
  const n0 = sky.lightning.length;
  for (let t = 0; t < 100; t++) {
    sky.cols[5].cloud = 0.95; sky.cols[5].T = 0.9; sky.cols[5].vapor = 0.8;
    tickSky(mw, 20);
  }
  assert.ok(sky.lightning.length > n0, 'the storm discharged');
  const st = sky.lightning[sky.lightning.length - 1];
  const cx = Math.max(0, Math.min(g.cols - 1, Math.floor(st.x / 10)));
  let maxHeat = 0;
  for (let cy = 0; cy < g.rows; cy++) maxHeat = Math.max(maxHeat, g.heat[cy * g.cols + cx]);
  assert.ok(maxHeat > 0.5, `ignition heat landed: ${maxHeat.toFixed(2)}`);
});

test('probe: TEMPERATURE — freezing sky quenches pre-ignition heat', () => {
  const mw = createMaterialWorld(41, 1);
  const sky = mw.sky, g = mw.grid;
  const col = 3;
  // A genuinely cold region: set the climate memory, not just the moment.
  sky.baseT[col] = 0.05;
  sky.cols[col].T = 0.05;
  const x0 = Math.floor((col * 100) / 10), x1 = Math.min(g.cols, Math.ceil(((col + 1) * 100) / 10));
  const cx = x0 + 1, cy = Math.floor(g.rows / 2);
  g.mat[cy * g.cols + cx] = MAT.WOOD;
  g.heat[cy * g.cols + cx] = 0.4; // below ignition
  const h0 = g.heat[cy * g.cols + cx];
  for (let t = 0; t < 10; t++) tickSky(mw, 20);
  const h1 = g.heat[cy * g.cols + cx];
  assert.ok(h1 < h0 * 0.9, `freezing air quenched the heat: ${h0.toFixed(2)} -> ${h1.toFixed(2)}`);
});

test('probe: SEASONS — the sky carries a 9600-tick year', () => {
  const mw = createMaterialWorld(51, 1);
  // Seasonal forcing is daylight-gated: measure at midday (+600 ticks).
  // Summer solstice: phase 0.25 → tick 2400; winter: phase 0.75 → 7200.
  mw.tick = 3000; // summer midday
  for (let t = 0; t < 60; t++) tickSky(mw, 20);
  const tSummer = mw.sky.cols[5].T;
  mw.tick = 7800; // winter midday
  for (let t = 0; t < 60; t++) tickSky(mw, 20);
  const tWinter = mw.sky.cols[5].T;
  assert.ok(tSummer > tWinter + 0.02, `summer warmer than winter: ${tSummer.toFixed(2)} > ${tWinter.toFixed(2)}`);
});

test('probe: DETERMINISM — same seed, same sky', () => {
  const run = (seed) => {
    const mw = createMaterialWorld(seed, 1);
    for (let t = 0; t < 200; t++) tickMaterialWorldM2(mw);
    return mw.sky.cols.map((c) => [c.T, c.vapor, c.cloud, c.soil, c.windU].map((v) => v.toFixed(6)).join(',')).join('|');
  };
  assert.equal(run(77), run(77), 'identical weather for identical seeds');
  assert.notEqual(run(77), run(78), 'different seeds diverge');
});

test('probe: SKY DECOUPLING — weather ticks every 20, not every tick', () => {
  const mw = createMaterialWorld(61, 1);
  const t0 = mw.sky.tick;
  for (let t = 0; t < 39; t++) tickMaterialWorldM2(mw);
  assert.equal(mw.sky.tick - t0, 1, 'one sky tick per 20 material ticks (39 ticks → 1)');
});
