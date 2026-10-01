// Observer interactivity for Canopy v0.17.1 "Touch".
//
// Two doors, one module:
//   (1) INSPECT — describeEntity(world, obj) returns honest, engine-modeled
//       facts about any clickable entity (plant, herb, fruit, creature,
//       mineral, pebble, toy, egg). It never invents a stat: every row
//       traces to a field the simulation actually ticks.
//   (2) TOUCH — observer verbs: pickFruit, placeFood, spawnFood,
//       nudgeCreature, digMineral.
//
// Paul's v0.5 rule ("every new action needs an instinct gene") does NOT
// apply here, deliberately: these are OBSERVER verbs, not creature actions.
// No tanglekin can trigger them, no genome encodes them, and they never
// enter the brain's action set. The observer is outside the evolutionary
// loop — a hand reaching into the terrarium, not a gene.
//
// The verbs respect the world's own laws: picked fruit becomes a real food
// item again when placed (creatures eat it through the normal doEat path);
// a nudge is a velocity impulse through the physics integrator (never a
// teleport); digging depletes a real deposit amount. No godmode state
// edits that bypass the sim's rules.
//
// Minerals are new in v0.17.1. The v0.17 world has no minerals; they arrive
// here as static deposits because Joshua asked to touch "everything".
// The deposit primitives (MINERAL_TYPES, addMineral) live in world.js next
// to addPebble — this module only digs and describes.
// CREATURES CANNOT USE MINERALS YET — tool use is the future technology
// release's job (see EVODEVO_DESIGN.md §9.5 "Future: technology"). For now
// minerals are observer-only: inspectable, collectable as samples, and
// otherwise inert. The deposit is real state (it depletes), not decoration.

import { addFood, zoneAt, ledgerIn, ledgerOut } from './world.js';

export const OBSERVER_VERSION = 'v0.17.1 "Touch"';

// A nudge is a shove, not a relocation: 160 px/s is a firm push by
// tanglekin standards (walk speed is ~40-90 px/s) but it decays through
// friction and gravity like any other velocity.
export const NUDGE_V = 160;
export const NUDGE_HOP = 140; // px/s upward — the startled hop

// --- Inspector --------------------------------------------------------------
// describeEntity returns { title, subtitle, rows, bars, note }.
// rows: [[label, value]] — plain facts. bars: [{label, value (0..1),
// color}] — metered facts. note: an honest caveat string or null.
// Everything shown must exist on the object or be computable from the
// engine's own fields. When the engine doesn't model something, the
// panel says so instead of inventing it.

function pct(v) {
  return Math.round(Math.max(0, Math.min(1, v)) * 100) + '%';
}

function shortHash(s) {
  return String(s).slice(0, 12);
}

export function describeEntity(world, obj) {
  if (!obj) return null;
  switch (obj.kind) {
    case 'plant':
    case 'herb': {
      const herb = obj.kind === 'herb';
      const ph = obj.pheno || {};
      const stage = obj.growth >= 1 ? 'mature' : obj.growth >= 0.5 ? 'growing' : 'seedling';
      const rows = [
        ['Kind', herb ? '🌿 Medicinal herb' : '🌳 Fruit tree'],
        ['Growth stage', `${stage} (${pct(obj.growth)})`],
        ['Zone', observerZoneName(world, obj.x)],
      ];
      const bars = [];
      if (herb) {
        rows.push(['Medicine', `bitter leaves purge illness (potency ${pct(ph.potency ?? 0.5)})`]);
        bars.push({ label: '🌡️ Potency', value: ph.potency ?? 0.5, color: '#9a6ee8' });
        bars.push({ label: '😖 Bitterness', value: ph.bitterness ?? 0.3, color: '#6b5b3e' });
      } else {
        rows.push(['Yield', `${1 + Math.round(2 * (ph.yield ?? 0.5))} fruit per fruiting`]);
        rows.push(['Nutrition per fruit', (0.5 + (ph.fruitSize ?? 0.5)).toFixed(2)]);
        bars.push({ label: '😖 Bitterness', value: ph.bitterness ?? 0.3, color: '#6b5b3e' });
        bars.push({ label: '💧 Drought tolerance', value: ph.waterRet ?? 0.5, color: '#5aa3d0' });
        bars.push({ label: '❄️ Cold tolerance', value: ph.coldTol ?? 0.5, color: '#9fc3e8' });
      }
      if (obj.growth >= 1) {
        rows.push(['Next fruiting in', `~${Math.max(0, obj.fruitTimer).toFixed(0)}s`]);
      } else {
        rows.push(['Fruiting', 'not until mature']);
      }
      if (obj.genome) rows.push(['Genome', shortHash(plantHash(obj.genome)) + '…']);
      return {
        title: herb ? 'Medicinal herb' : 'Fruit tree',
        subtitle: `plant #${obj.id}`,
        rows, bars,
        note: 'Fruit count shown is per fruiting cycle from the plant genome — hanging fruit are separate items; click one.',
      };
    }
    case 'food': {
      const kindLabel = { fruit: '🍎 Fruit', leaf: '🌿 Medicinal leaf', meat: '🍖 Meat', scrap: '🍂 Scrap', bug: '🪲 Bug', minnow: '🐟 Minnow', corpse: '💀 Corpse' }[obj.foodKind] || obj.foodKind;
      const rows = [
        ['Kind', kindLabel],
        ['Nutrition', Number(obj.nutrition ?? 1).toFixed(2)],
        ['Amount', Number(obj.amount ?? 1).toFixed(2)],
        ['Bitterness', pct(obj.bitterness ?? 0)],
        ['Zone', observerZoneName(world, obj.x)],
      ];
      if (obj.plantId) {
        const parent = (world.plants || []).find((p) => p.id === obj.plantId);
        rows.push(['Borne by', parent ? `plant #${parent.id}` : `plant #${obj.plantId} (gone)`]);
      } else {
        rows.push(['Borne by', 'placed by the observer — no parent plant']);
      }
      if (obj.rotsAt > 0) rows.push(['Rots in', `~${Math.max(0, obj.rotsAt - world.time).toFixed(0)}s`]);
      const note = obj.foodKind === 'leaf'
        ? 'Bitter and barely nutritious — but purges illness. Sick tanglekins self-medicate with these.'
        : obj.foodKind === 'meat' ? 'A carcass. Carnivore-leaning tanglekins eat these at full value.'
        : null;
      return { title: kindLabel, subtitle: `food #${obj.id}`, rows, bars: [], note };
    }
    case 'creature': {
      const c = obj;
      const b = c.biochem;
      const rows = [
        ['Name', `${c.name} (#${c.id})`],
        ['Sex', c.sex],
        ['Stage', stageLabel(c)],
        ['Zone', observerZoneName(world, c.x)],
        ['Doing', c.actionLabel || c.action],
      ];
      if (c.speciesId) rows.push(['Species', `#${c.speciesId}`]);
      rows.push(['Genome highlights',
        `size ${pct(c.pheno.size)} · legs ${pct(c.pheno.legLength)} · immunity ${pct(c.pheno.immunity)} · boldness ${pct(c.pheno.boldness)}`]);
      const bars = [
        { label: '🍽️ Satiation', value: 1 - b.hunger, color: '#e8a13c' },
        { label: '⚡ Energy', value: b.energy, color: '#7ccf5f' },
        { label: '🏥 Health', value: b.health, color: '#e85c5c' },
      ];
      if (b.illness > 0.05) bars.push({ label: '🤒 Illness', value: b.illness, color: '#9db33c' });
      return {
        title: c.name, subtitle: `tanglekin #${c.id}`,
        rows, bars,
        note: 'Genome highlights are phenotype values (0..1) the engine actually expresses — leg length moves jump physics, immunity gates illness.',
      };
    }
    case 'mineral': {
      const rows = [
        ['Type', `⛏️ ${obj.mineralName}`],
        ['Samples left', obj.amount > 0 ? String(obj.amount) : 'depleted'],
        ['Zone', observerZoneName(world, obj.x)],
        [null, obj.blurb],
      ];
      return {
        title: obj.mineralName, subtitle: `mineral deposit #${obj.id}`,
        rows,
        bars: [{ label: '🪨 Hardness', value: obj.hardness, color: '#8d8b96' }],
        note: 'Tanglekins cannot use minerals yet — tool use belongs to the future technology release. For now they are observer-only: inspect and collect samples.',
      };
    }
    case 'pebble': {
      return {
        title: 'Pebble', subtitle: `stone #${obj.id}`,
        rows: [['Kind', '🪨 Pushable stone'], ['Radius', `${obj.r.toFixed(0)}px`], ['Zone', observerZoneName(world, obj.x)]],
        bars: [],
        note: 'The world as material: creatures shove pebbles by collision; heavy stones resist. Not decoration.',
      };
    }
    case 'stick': {
      return {
        title: 'Stick', subtitle: `fallen branch #${obj.id}`,
        rows: [['Kind', '🪵 Graspable timber'], ['Weight', Number(obj.weight ?? 0.7).toFixed(2)], ['Hardness', Number(obj.hardness ?? 0.4).toFixed(2)], ['Zone', observerZoneName(world, obj.x)]],
        bars: [],
        note: 'A tanglekin with graspPairs ≥ 1 can pick this up (grasp), wield it (carry), and drop it. Timber is light but soft — a poor hammer, an honest start.',
      };
    }
    case 'toy': {
      return {
        title: obj.kind === 'beacon' ? 'Exam beacon' : 'Ball',
        subtitle: `toy #${obj.id}`,
        rows: [['Kind', obj.kind === 'beacon' ? '📡 cue marker (exam mode)' : '⚽ plaything'], ['Zone', observerZoneName(world, obj.x)]],
        bars: [], note: null,
      };
    }
    case 'egg': {
      return {
        title: 'Egg', subtitle: `egg #${obj.id}`,
        rows: [
          ['Hatches in', `~${Math.max(0, obj.timer).toFixed(0)}s`],
          ['Parents', obj.parents ? `#${obj.parents[0]} × #${obj.parents[1]}` : 'wild'],
        ],
        bars: [], note: null,
      };
    }
    case 'shark':
    case 'bear': {
      // v0.18 "Realms": the danger panel — every agent of selection is
      // visible. Kind, damage, and the physiological range that confines
      // it (§13.6): the shark is bounded by water depth, the bear by heat.
      const shark = obj.kind === 'shark';
      const dmg = typeof obj.damage === 'number' ? obj.damage : null;
      const rows = [
        ['Kind', shark ? '🦈 Shark' : '🐻 Bear'],
        ['Damage', dmg !== null ? dmg.toFixed(2) : 'not modeled by the sim'],
        ['Range limit', shark
          ? 'needs ≥90px water depth — suffocates in the shallows'
          : 'overheats above ambient heat ~0.35 — confined by heat, not by walls'],
        ['Zone', observerZoneName(world, obj.x)],
      ];
      if (obj.hunting || obj.target) rows.push(['State', '🔴 hunting']);
      const bars = dmg !== null
        ? [{ label: '☠️ Threat', value: Math.max(0, Math.min(1, dmg)), color: '#c0392b' }]
        : [];
      return {
        title: shark ? 'Shark' : 'Bear',
        subtitle: `predator #${obj.id}`,
        rows, bars,
        note: 'A real agent of selection, not scenery — it kills tanglekins. Watch it hunt.',
      };
    }
    default:
      return null;
  }
}

function observerZoneName(world, x) {
  return zoneAt(x).name;
}

function stageLabel(c) {
  // ageStage lives in biochem.js; the UI already computes stages for its
  // own panel. Here we do the cheap honest thing: read what the engine
  // stamped on the creature if present, else report by age fraction.
  if (c._stageLabel) return c._stageLabel;
  const b = c.biochem, p = c.pheno;
  const t = b.age / (p.lifespanSec || 1);
  if (t < 0.25) return 'juvenile';
  if (t < 0.8) return 'adult';
  return 'elder';
}

function plantHash(genome) {
  const parts = [];
  for (const key of Object.keys(genome.alleles || {}).sort()) {
    const [a, b] = genome.alleles[key];
    parts.push(a.toFixed(3) + '/' + b.toFixed(3));
  }
  return parts.join('|');
}

// --- Observer verbs ---------------------------------------------------------

// Pick up a food item: it leaves the world's foods array and comes back as
// a plain snapshot the observer's hand can carry. Nothing about the item
// changes — placing it later re-enters it through addFood, so creatures
// meet it through the exact same path as tree-borne fruit.
export function pickFruit(world, food) {
  const i = world.foods.indexOf(food);
  if (i < 0) return null;
  world.foods.splice(i, 1);
  // v0.24: the observer's hand is outside the sim's pools — the lifted
  // mass leaves as a LABELED boundary flow, and returns the same way on
  // placeFood. The books stay balanced in interactive sessions too.
  ledgerOut(world, 'observer', food.amount || 0);
  return {
    foodKind: food.foodKind, nutrition: food.nutrition,
    bitterness: food.bitterness, amount: food.amount,
  };
}

// Place a held item back into the world at a real location. The item is a
// genuine food entity afterwards — doEat finds it, seed dispersal can read
// its plantId (0 = observer-placed, honestly parentless).
export function placeFood(world, x, platformIndex, held) {
  if (!held) return null;
  const plat = world.platforms[platformIndex];
  if (!plat) return null;
  x = Math.max(plat.x1 + 10, Math.min(plat.x2 - 10, x));
  ledgerIn(world, 'observer', held.amount || 1); // v0.24: the hand gives back what it took
  addFood(world, x, platformIndex, held.foodKind || 'fruit', held.amount || 1, 0, {
    plantId: 0, bitterness: held.bitterness || 0, nutrition: held.nutrition ?? 1,
  });
  return world.foods[world.foods.length - 1];
}

// Provision fresh food out of the observer's hand — a whole fruit, the way
// the starter fruit is provisioned at worldgen (addFood defaults).
// v0.24: pure creation — LABELED as an observer boundary input.
export function spawnFood(world, x, platformIndex, foodKind = 'fruit') {
  const plat = world.platforms[platformIndex];
  if (!plat) return null;
  x = Math.max(plat.x1 + 10, Math.min(plat.x2 - 10, x));
  ledgerIn(world, 'observer', 1);
  addFood(world, x, platformIndex, foodKind, 1, 0, { plantId: 0, bitterness: 0, nutrition: 1 });
  return world.foods[world.foods.length - 1];
}

// A gentle shove: velocity impulse in the facing direction plus a small
// startled hop if grounded. Position is untouched — the physics integrator
// does the moving from here, through friction, gravity, and landings.
// This is a force, not a teleport.
export function nudgeCreature(world, c, dir = 0) {
  if (!c || !c.alive) return false;
  const d = dir === 0 ? (c.facing || 1) : Math.sign(dir);
  c.vx += d * NUDGE_V;
  c.facing = d;
  if (c.grounded) {
    c.vy = -NUDGE_HOP;
    c.grounded = false;
  }
  world.events.push({ type: 'nudge', creature: c, t: world.time });
  return true;
}

// Collect one sample from a mineral deposit. The deposit is real state —
// it depletes, and depleted deposits stay inspectable (labeled as such)
// rather than silently vanishing.
export function digMineral(world, m) {
  if (!m || m.amount <= 0) return null;
  m.amount -= 1;
  // v0.24: the sample leaves the deposit for the observer's hand — labeled
  // boundary outflow (the hand is outside the sim's pools).
  ledgerOut(world, 'observer', m.weight ?? 0.5);
  const sample = { mineralKey: m.mineralKey, mineralName: m.mineralName, color: m.color };
  world.events.push({ type: 'digMineral', mineral: m, t: world.time });
  return sample;
}
