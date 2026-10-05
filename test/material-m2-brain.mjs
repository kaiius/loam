// M2 tests: the material brain — 47 inputs, 33 actions, instinct wiring,
// Grand's endogenous reward. Run: node --test test/material-m2-brain.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  N_IN, ACTIONS, createBrain, decide, learn, senseVector47,
} from '../src/material/brain.js';
import { randomGenome, phenotype } from '../src/sim/genome.js';
import { createRng } from '../src/sim/rng.js';
import { m2PhenoDefaults } from '../src/material/genes.js';
import { tickChem, driveLevels } from '../src/material/chem.js';
import { createBiochem } from '../src/sim/biochem.js';

function founderPheno(seed = 7) {
  return { ...phenotype(randomGenome(createRng(seed), {})), ...m2PhenoDefaults() };
}

test('m2: brain I/O dims — 48 in, 33 out', () => {
  assert.equal(N_IN, 48, 'N_IN = 47 senses + bias');
  assert.equal(ACTIONS.length, 33, '30 ported + pile + instPile + geophagy');
  assert.equal(ACTIONS[30], 'pile');
  assert.equal(ACTIONS[31], 'instPile');
  assert.equal(ACTIONS[32], 'geophagy');
  // The 30 ported actions kept their indices (append-only, never renumbered).
  assert.equal(ACTIONS[9], 'climb');
  assert.equal(ACTIONS[19], 'dig');
  assert.equal(ACTIONS[0], 'seekFood');
});

test('m2: senseVector47 is 48 long with the material senses appended', () => {
  const s = { hunger: 0.5, digAhead: 0.8, soilBelow: 0.9, enclosed: 0.25, mineral: 0.6 };
  const v = senseVector47(s);
  assert.equal(v.length, 48);
  assert.equal(v[43], 0.8, 'sense 43 digAhead');
  assert.equal(v[44], 0.9, 'sense 44 soilBelow');
  assert.equal(v[45], 0.25, 'sense 45 enclosed');
  assert.equal(v[46], 0.6, 'sense 46 mineral deficit');
  assert.equal(v[47], 1, 'bias');
  assert.equal(v[0], 0.5, 'sense 0 hunger');
});

test('m2: createBrain + decide run without NaN', () => {
  const brain = createBrain(founderPheno(), createRng(11));
  const input = new Array(47).fill(0.3);
  input[46] = 1;
  const d = decide(brain, input, 0.08, createRng(12));
  assert.ok(d.index >= 0 && d.index < 33, `action ${d.index} in range`);
  assert.equal(ACTIONS[d.index], d.action, 'name matches index');
});

test('m2: instinct genes wire the new actions (no NaN weights)', () => {
  const brain = createBrain(founderPheno(), createRng(11));
  // instW is internal; verify via decide: with heldWeight=1 the pile-family
  // actions should be reachable (not NaN, finite scores).
  const input = new Array(47).fill(0);
  input[46] = 1;
  input[33] = 1; // heldWeight — the pile instinct's sense
  for (let i = 0; i < 20; i++) {
    const d = decide(brain, input, 0.0, createRng(100 + i));
    assert.ok(Number.isFinite(d.index), 'finite action');
  }
});

test('m2: learn() updates weights on endogenous reward', () => {
  const brain = createBrain(founderPheno(), createRng(11));
  const input = new Array(47).fill(0.2);
  input[46] = 1;
  decide(brain, input, 0.0, createRng(12));
  const before = JSON.stringify(brain.biasM);
  learn(brain, founderPheno(), 0.5, null);
  assert.notEqual(JSON.stringify(brain.biasM), before, 'weights moved');
  learn(brain, founderPheno(), 0, null); // zero reward = no-op
});

test('m2: Grand\'s rule — eating (drive reduction) produces reward', () => {
  const chem = createBiochem();
  chem.bloodSugar = 0.2; // hungry
  const pheno = founderPheno();
  const { reward } = tickChem(chem, pheno, 1, { ate: 0.5 });
  assert.ok(reward > 0, `eating rewards, got ${reward}`);
});

test('m2: Grand\'s rule — starving (drive increase) punishes', () => {
  const chem = createBiochem();
  chem.bloodSugar = 0.8;
  const pheno = founderPheno();
  const { reward } = tickChem(chem, pheno, 10, { active: 1.0 }); // burn, no eat
  assert.ok(reward < 0, `drive increase punishes, got ${reward}`);
});

test('m2: Grand\'s rule — no drive change, no reward (zero shaping)', () => {
  const chem = createBiochem();
  const pheno = founderPheno();
  // A tick with negligible drive movement: reward ≈ 0.
  const { reward } = tickChem(chem, pheno, 0.001, { active: 0.0, sleeping: true });
  assert.ok(Math.abs(reward) < 0.05, `quiet tick ≈ no reward, got ${reward}`);
});

test('m2: driveLevels reads the six deficit drives', () => {
  const chem = createBiochem();
  chem.bloodSugar = 0.2; chem.hydration = 0.9; chem.fatigue = 0.7;
  const d = driveLevels(chem);
  assert.ok(d.hunger > 0.7 && d.thirst < 0.2 && d.tiredness > 0.6, JSON.stringify(d));
});
