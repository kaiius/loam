// Loam R4 — geophagy is real: the mineral drive end to end.
// D1: mineral-deficit sense (46) — the brain feels minerals.
// D2: instHungerGeo founder 0.3 → 0.7 (was backwards); instMineralGeo added.
// D3: minerals join Grand's endogenous reward (drive reducer → reward).
// D4: mineral deficit < 0.3 creeps illness up (the consequence).
// D5: tryGeophagy eats the ground underfoot, not the facing wall cell.
// Run: node --test test/material-r4-geophagy.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMaterialWorld, tickMaterialWorldM2, addFounder } from '../src/material/index.js';
import { gatherMaterialSenses } from '../src/material/senses.js';
import { createBrain, decide, senseVector47, N_IN } from '../src/material/brain.js';
import { tickChem } from '../src/material/chem.js';
import { M2_GENES } from '../src/material/genes.js';
import { createRng } from '../src/sim/rng.js';
import { phenotype, randomGenome } from '../src/sim/genome.js';
import { m2PhenoDefaults } from '../src/material/genes.js';

function founderPheno(seed = 7) {
  return { ...phenotype(randomGenome(createRng(seed), {})), ...m2PhenoDefaults() };
}

// --- D1: the mineral sense exists and reads the deficit ---
test('r4: mineral sense (46) tracks 1 - minerals', () => {
  const mw = createMaterialWorld(7, 1);
  const c = addFounder(mw, createRng(21));
  c.minerals = 0.2;
  const s = gatherMaterialSenses(mw, c, { others: [] });
  assert.ok(Math.abs(s.mineral - 0.8) < 1e-9, `mineral sense reads 0.8, got ${s.mineral}`);
  const v = senseVector47(s);
  assert.equal(v.length, N_IN, 'vector length matches N_IN');
  assert.ok(Math.abs(v[46] - 0.8) < 1e-9, 'sense 46 carries the deficit');
  assert.equal(v[47], 1, 'bias still last');
});

// --- D2: the wires point the right way ---
test('r4: instHungerGeo founder is positive now; instMineralGeo exists', () => {
  const hungerGeo = M2_GENES.find((g) => g.key === 'instHungerGeo');
  assert.ok(hungerGeo, 'instHungerGeo exists');
  assert.ok(hungerGeo.founder > 0.5, `founder ${hungerGeo.founder} gives a positive weight`);
  const mineralGeo = M2_GENES.find((g) => g.key === 'instMineralGeo');
  assert.ok(mineralGeo, 'instMineralGeo exists');
  assert.equal(mineralGeo.sense, 46, 'wired from the mineral sense');
  assert.equal(mineralGeo.action, 32, 'wired to geophagy');
  assert.ok(mineralGeo.founder > 0.5, 'positive weight');
});

// --- D2+D1: the brain actually selects geophagy when starved of minerals ---
test('r4: a mineral-starved, sated creature chooses geophagy', () => {
  const brain = createBrain(founderPheno(7), createRng(99));
  // Sated (hunger 0), fully mineral-deficient: geophagy should win outright.
  const s = { hunger: 0, mineral: 1 };
  const v = senseVector47(s);
  const d = decide(brain, v, 0, createRng(1)); // exploration 0 — pure drive
  assert.equal(d.index, 32, `expected geophagy (32), got ${d.index} (${d.action})`);
});

// --- D3: restoring minerals is endogenous reward ---
test('r4: tickChem rewards mineral restoration (Grand\'s rule)', () => {
  // Use a real creature's chem — hand-built objects miss fields tickBiochem needs.
  const mw = createMaterialWorld(7, 1);
  const mk = () => {
    const c = addFounder(mw, createRng(21));
    return { ...c.chem };
  };
  const pheno = founderPheno(7);
  const r1 = tickChem(mk(), pheno, 1, { mineralsBefore: 0.1, mineralsAfter: 0.9 });
  assert.ok(Number.isFinite(r1.reward), `reward finite, got ${r1.reward}`);
  // Mineral leg alone: Δdrive = 0.8 restored → strongly positive.
  assert.ok(r1.reward > 0.5, `mineral restoration rewards, got ${r1.reward}`);
  // Deepening the deficit punishes at half weight.
  const r2 = tickChem(mk(), pheno, 1, { mineralsBefore: 0.9, mineralsAfter: 0.1 });
  assert.ok(r2.reward < -0.2, `mineral deepening punishes, got ${r2.reward}`);
});

// --- D4: deficiency has a consequence ---
test('r4: mineral deficit below 0.3 creeps illness up', () => {
  const mw = createMaterialWorld(7, 1);
  const mk = () => {
    const c = addFounder(mw, createRng(21));
    return { ...c.chem };
  };
  const pheno = founderPheno(7);
  const chem = mk();
  tickChem(chem, pheno, 1, { mineralsBefore: 0.0, mineralsAfter: 0.0 });
  assert.ok(chem.illness > 0, `illness seeds from full depletion, got ${chem.illness}`);
  const chem2 = mk();
  tickChem(chem2, pheno, 1, { mineralsBefore: 0.8, mineralsAfter: 0.8 });
  assert.equal(chem2.illness, 0, 'replete minerals: no illness creep');
});

// --- D5 + the whole chain: creatures actually eat minerals in a real run ---
test('r4: geophagy events fire in normal runs on pinned seeds', () => {
  for (const seed of [31415, 7]) {
    const mw = createMaterialWorld(seed, 1, { fireOn: false });
    const rng = createRng(((seed * 7919 + 13) >>> 0) || 1);
    for (let i = 0; i < 4; i++) addFounder(mw, rng);
    for (let t = 0; t < 6000; t++) tickMaterialWorldM2(mw);
    const ev = mw.stats.geophagyEvents || 0;
    assert.ok(ev >= 5, `seed ${seed}: expected ≥5 geophagy events, got ${ev}`);
    assert.ok((mw.stats.geophagyYield || 0) > 0, 'yield accumulated');
  }
});
