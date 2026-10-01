// Canopy v0.22 'Web of Life' preview — staging + capture.
// Stages a small jungle scene with the real sim, runs it headless, and
// captures frames (creature positions/states, corpses, soil bacteria)
// for the animated preview page. Staged geometry, real mechanics:
// nothing here scripts a kill, a meal, or a bloom — the sim does all of it.
import { writeFileSync } from 'fs';
import { createWorld, bindWorld, populate, tickWorld } from '../src/sim/world.js';
import { createCreature } from '../src/sim/creature.js';
import { founderGenome } from '../src/sim/species.js';
import { bacteriaOf } from '../src/sim/microbes.js';
import { createRng } from '../src/sim/rng.js';

export const SEED = 20261001;
export const TICKS = 3500;
export const DT = 0.1;
export const EVERY = 10; // capture every 10 ticks

export function stageWorld() {
  const world = bindWorld(createWorld(SEED));
  populate(world); // real flora: fruit trees on branches, herbs on the floor
  world.creatures.length = 0; // the four founder tanglekins leave; our cast enters
  const cast = [];
  const add = (speciesKey, x, platIdx, seed, opts = {}) => {
    const g = founderGenome(speciesKey, createRng(seed));
    const c = createCreature(g, x, platIdx, world.rng, { name: opts.name });
    c.speciesKey = speciesKey;
    if (opts.age) c.biochem.age = opts.age;
    // Hunger is derived from blood sugar each tick (biochem.js) — pin the
    // sugar, not the hunger, or the "hungry cat" stages as a fed one.
    if (opts.bloodSugar !== undefined) c.biochem.bloodSugar = opts.bloodSugar;
    world.creatures.push(c);
    cast.push(c);
    return c;
  };
  // Foragers on the mid branches — background life.
  add('tanglekin', 1320, 4, 101, { name: 'Bramble' });
  add('tanglekin', 1520, 5, 102, { name: 'Wren' });
  add('tanglekin', 1420, 2, 103, { name: 'Moss' });
  // Staged abundance so the foragers visibly forage (QA tests stage food too).
  for (const [fx, fpi] of [[1350, 4], [1500, 4], [1450, 5], [1550, 5], [1400, 2], [1500, 2]]) {
    world.foods.push({ foodKind: 'fruit', x: fx, y: 640, amount: 2, nutrition: 1, platformIndex: fpi, rot: 300 });
  }
  // The elder is gone from this staging — its free corpse used to satiate
  // the cat before the hunt began. Now the only meat on the ground will be
  // what the cat kills: kill → corpse → vultures → bloom, one chain.
  // The prey: a healthy adult tanglekin foraging on the ground, ~250px
  // from the cat — mid-range, where the bite instinct (creatureDist→bite)
  // fires strongest. Nobody scripts the meeting — the geometry is staged,
  // the hunt is the brain's.
  // The hunter: a jungle cat on the ground, 250px from Pip. Normally fed —
  // a starving cat only seeks food and dies; a fed cat's bite instinct
  // (creatureDist→bite) fires on proximity, and that is the hunt drive.
  // It stalks via approach+hunger (real); the strike is its own business.
  const catSeed = parseInt(process.env.CATSEED || '117', 10);
  const catBlood = process.env.CATBLOOD ? parseFloat(process.env.CATBLOOD) : 0.5;
  const catOpts = { name: 'the cat' };
  if (catBlood !== null) catOpts.bloodSugar = catBlood;
  const cat = add('jungle-cat', 1300, 0, catSeed, catOpts);
  cat.pheno.immunity = 0.9; // staged: keep the background cough off the kill narrative
  // The prey: a healthy adult tanglekin foraging on the ground, ~250px
  // from the cat — mid-range, where the bite instinct (creatureDist→bite)
  // fires strongest. Nobody scripts the meeting — the geometry is staged,
  // the hunt is the brain's.
  const pip = add('tanglekin', 1550, 0, 112, { name: 'Pip' });
  pip.biochem.age = pip.pheno.lifespanSec * 0.5;
  pip.pheno.immunity = 0.9; // keep the background cough off the kill narrative
  const elder = null;
  // Vultures waiting on the ground nearby — within corpse sight (533px).
  add('vulture', 1600, 0, 107, { name: 'soarer 1' });
  add('vulture', 1700, 0, 108, { name: 'soarer 2' });
  // The midden crew on the forest floor, waste seeded beneath them.
  add('beetle-detritivore', 1250, 0, 109, { name: 'midden 1' });
  add('beetle-detritivore', 1350, 0, 110, { name: 'midden 2' });
  add('beetle-detritivore', 1450, 0, 111, { name: 'midden 3' });
  world.soil.jungle.waste = 1.0; // a staged midden for the detritivores + bacteria (was 5.0 — the odor was sickening the cast)
  // Demo hygiene: the background illness kept eating the cast (and the kill
  // narrative). Everyone staged gets max immunity — this is a hunt demo,
  // not an epidemiology trial.
  for (const c of cast) c.pheno.immunity = 1.0;
  return { world, cast, pip, cat };
}

export function captureFrame(world, cast, t0 = 0) {
  return {
    t: +(world.time - t0).toFixed(1),
    creatures: cast.map((c) => ({
      id: c.id, sp: c.speciesKey, x: +c.x.toFixed(1), y: +(c.y ?? 0).toFixed(1),
      pi: c.platformIndex, alive: c.alive, label: c.actionLabel || '', grounded: !!c.grounded,
    })),
    corpses: world.foods
      .filter((f) => f.foodKind === 'corpse')
      .map((f) => ({ x: +f.x.toFixed(1), y: +((f.y ?? 800)).toFixed(1), amt: +f.amount.toFixed(2), pi: f.platformIndex })),
    bacteria: +bacteriaOf(world, 'jungle').toFixed(3),
    waste: +((world.soil.jungle.waste || 0)).toFixed(2),
  };
}

export function runCapture() {
  const { world, cast, pip, cat } = stageWorld();
  const t0 = world.time;
  const frames = [captureFrame(world, cast, t0)];
  const beats = { catApproach: 0, beetleGraze: 0 };
  const deaths = [];
  const catHist = {};
  let bloomT = null;
  for (let t = 1; t <= TICKS; t++) {
    tickWorld(world, DT);
    if (cat.action === 'approach') beats.catApproach++;
    catHist[cat.action] = (catHist[cat.action] || 0) + 1;
    for (const c of cast) {
      if (c.speciesKey === 'beetle-detritivore' && c.actionLabel === 'grazing detritus') beats.beetleGraze++;
    }
    for (const e of world.events) {
      if (e.type === 'death' && !e._noted) {
        e._noted = true;
        deaths.push({ t: +(world.time - t0).toFixed(1), name: e.creature.name, cause: e.cause });
      }
      if (e.type === 'bacteriaBloom' && e.zone === 'jungle' && bloomT === null) bloomT = +(world.time - t0).toFixed(1);
    }
    if (t % EVERY === 0) frames.push(captureFrame(world, cast, t0));
  }
  // vulture meals: count eat actions on corpses via mealLog
  let vultureMeals = 0;
  for (const c of cast) {
    if (c.speciesKey === 'vulture') vultureMeals += (c.mealLog || []).length;
  }
  const corpse0 = frames.find((f) => f.corpses.length > 0);
  const corpseEnd = frames[frames.length - 1].corpses.reduce((a, f) => a + f.amt, 0);
  return {
    world, frames, beats, deaths, catHist, bloomT, vultureMeals,
    corpseAppearedAt: corpse0 ? corpse0.t : null,
    corpseRemaining: +corpseEnd.toFixed(2),
    finalBacteria: frames[frames.length - 1].bacteria,
    finalWaste: frames[frames.length - 1].waste,
    pipAlive: pip.alive, t0,
  };
}

// Pilot mode: node capture-weboflife.mjs --pilot
if (process.argv.includes('--pilot')) {
  const r = runCapture();
  console.log('frames:', r.frames.length);
  console.log('deaths:', JSON.stringify(r.deaths));
  console.log('corpse appeared t=' + r.corpseAppearedAt + 's, remaining at end: ' + r.corpseRemaining);
  console.log('cat approach ticks:', r.beats.catApproach + '/' + TICKS);
  console.log('cat actions:', JSON.stringify(r.catHist));
  console.log('beetle grazing ticks:', r.beats.beetleGraze);
  console.log('vulture meals:', r.vultureMeals);
  console.log('bacteria bloom at t=' + r.bloomT + 's, final biomass:', r.finalBacteria, 'waste:', r.finalWaste);
}

// Final capture: node capture-weboflife.mjs --capture
if (process.argv.includes('--capture')) {
  const r = runCapture();
  const out = {
    meta: {
      seed: SEED, ticks: TICKS, dt: DT, every: EVERY,
      frames: r.frames.length,
      generated: '2026-10-01',
      build: 'v0.22 Web of Life (56f754a)',
      staged: 'cast hand-placed, fruit + waste seeded; all behavior from the sim',
      platforms: r.world.platforms.map((p, i) => ({ i, x1: Math.round(p.x1), x2: Math.round(p.x2), y: Math.round(p.y || 800), kind: p.kind })),
      beats: {
        deaths: r.deaths,
        corpseAppearedAt: r.corpseAppearedAt,
        corpseRemaining: r.corpseRemaining,
        catApproach: r.beats.catApproach,
        beetleGraze: r.beats.beetleGraze,
        vultureMeals: r.vultureMeals,
        bloomT: r.bloomT,
        finalBacteria: r.finalBacteria,
        finalWaste: r.finalWaste,
      },
    },
    frames: r.frames,
  };
  writeFileSync('/tmp/weboflife-frames.json', JSON.stringify(out));
  console.log('wrote /tmp/weboflife-frames.json', r.frames.length, 'frames');
  console.log('deaths:', JSON.stringify(r.deaths));
  console.log('bloom:', r.bloomT, 'finalBacteria:', r.finalBacteria);
}
