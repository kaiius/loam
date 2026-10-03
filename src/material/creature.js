// Canopy material world — M1 creature (locomotion + digging).
//
// ONE creature, not the full port (that comes in M2): walk/turn/fall/sink
// physics on the material substrate plus the redefined dig action (design
// §3.4). No brain yet — digging intent is the probe flag `wantDig`, set by
// tests/probes; the sparse 3-layer net wires it in M2.
//
// Body: ~60px tall (6 cells), ~30px wide (3 cells). The reference point
// (c.x, c.y) is the FEET: x = body-center column, y = bottom of the body.
// Deterministic: zero RNG in this file.

import { CELL_PX, MAT, MAT_PROPS } from './grid.js';
import { sampleMat, isSolid, supportBelow } from './locomotion.js';

export const BODY_H = 60;        // px — 6 cells tall
export const BODY_W = 30;        // px — 3 cells wide
export const LEG_LENGTH = 24;    // px — support reach for walking/landing
export const WALK_SPEED = 2.2;   // px/tick
export const GRAVITY = 0.6;      // px/tick^2
export const MAX_FALL = 12;      // px/tick terminal velocity
export const WATER_SINK_MAX = 3; // px/tick — buoyancy caps the sink rate
export const DIG_POWER = 1;      // founder anatomy gate, M1 constant
// (design §3.4's full anatomy gate — digPower = graspPairs x ... — lands
// with the genome port in M2; M1 pins the founder value.)

// Sense indices appended per design §3.2 — never renumbered.
export const SENSE_DIG_AHEAD = 43;
export const SENSE_SOIL_BELOW = 44;
export const SENSE_ENCLOSED = 45;

// Design §3.2, exact: loose soil 1, bedrock/air/water 0, rock 0.3,
// clay 0.6, sand 0.9, wood/deadwood/leaf 0.5.
const DIGGABILITY = [0, 1.0, 0.9, 0.6, 0.3, 0.5, 0.5, 0.5, 0, 0];
// soilBelow: rock 0 -> loose soil 1; 0 in air/water.
const SOILNESS = [0, 1.0, 0.9, 0.6, 0, 0.3, 0.4, 0, 0, 0];

const MAT_NAME = {
  [MAT.SOIL]: 'soil',
  [MAT.SAND]: 'sand',
  [MAT.CLAY]: 'clay',
  [MAT.ROCK]: 'rock',
  [MAT.WOOD]: 'wood',
  [MAT.DEADWOOD]: 'deadwood',
  [MAT.LEAF]: 'leaf',
};

// The facing cell at body height: just past the body's leading edge.
const LOOK_AHEAD = 20; // px ahead of the body center

export function spawnCreature(mw, px, py) {
  return {
    x: px,
    y: py, // feet point (bottom of the 60px body)
    vx: 0,
    vy: 0,
    facing: 1, // 1 | -1
    grounded: false,
    digTicks: 0, // accumulated work on the current dig target
    digPower: DIG_POWER,
    carried: null, // { material, weight } once something is dug up
    wantDig: false, // probe flag — M1 has no brain; tests set this
    alive: true,
  };
}

// Cell coords of the dig/sense target: the facing cell at body height.
// Null when the target lies outside the grid. Exported for probes and the
// M2 action port (the pile action needs the same targeting).
export function digTargetCell(mw, c) {
  const g = mw.grid;
  const cx = Math.floor((c.x + c.facing * LOOK_AHEAD) / CELL_PX);
  const cy = Math.floor((c.y - BODY_H / 2) / CELL_PX);
  if (cx < 0 || cx >= g.cols || cy < 0 || cy >= g.rows) return null;
  return { cx, cy, idx: cy * g.cols + cx };
}

function senseDigAhead(mw, c) {
  const t = digTargetCell(mw, c);
  const m = t ? mw.grid.mat[t.idx] : MAT.AIR;
  return DIGGABILITY[m] ?? 0;
}

// Design §3.2 senses 43-45.
export function sense43_45(mw, c) {
  const digAhead = senseDigAhead(mw, c);
  const belowMat = sampleMat(mw, c.x, c.y + 1);
  const soilBelow = SOILNESS[belowMat] ?? 0;
  // enclosed: fraction of the 8 neighbors of the body-center cell that are
  // solid — the burrow/cave sense.
  const ccx = Math.floor(c.x / CELL_PX);
  const ccy = Math.floor((c.y - BODY_H / 2) / CELL_PX);
  let solid = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (ccx + dx) * CELL_PX + CELL_PX / 2;
      const ny = (ccy + dy) * CELL_PX + CELL_PX / 2;
      if (isSolid(sampleMat(mw, nx, ny))) solid++;
    }
  }
  return { digAhead, soilBelow, enclosed: solid / 8 };
}

export function tickCreature(mw, c) {
  if (!c.alive) return c;
  const g = mw.grid;

  // Digging intent: the probe flag (M1 has no brain) AND a diggable-enough
  // facing cell. A digging creature stands and works — it does not walk.
  const digging = c.wantDig === true && senseDigAhead(mw, c) > 0.5;

  // Horizontal: walk when grounded; turn at cliff edges (no support ahead
  // within leg length) or walls (solid at body height).
  if (!digging && c.grounded) {
    const aheadX = c.x + c.facing * LOOK_AHEAD;
    const supportAhead = supportBelow(mw, aheadX, c.y, LEG_LENGTH);
    const wallAhead = isSolid(sampleMat(mw, aheadX, c.y - BODY_H / 2));
    if (!supportAhead || wallAhead) c.facing = -c.facing;
    c.x += c.facing * WALK_SPEED;
  }

  // Vertical: gravity, buoyancy in water, then land on any support within
  // leg reach (walking downhill steps down; falling stops at the surface).
  c.vy = Math.min(c.vy + GRAVITY, MAX_FALL);
  if (sampleMat(mw, c.x, c.y - BODY_H / 2) === MAT.WATER) {
    c.vy = Math.min(c.vy * 0.92, WATER_SINK_MAX); // sink slowly
  }
  c.y += c.vy;
  const sup = supportBelow(mw, c.x, c.y, LEG_LENGTH);
  if (sup) {
    c.y = sup.y;
    c.vy = 0;
    c.grounded = true;
  } else {
    c.grounded = false;
  }

  // Digging: accumulate work-ticks; at work-ticks (ceil(digWork/digPower))
  // the cell is removed (mat=AIR, dug=1, root=0) and yields a carried item
  // (§3.4). Bedrock/water/air are never diggable — MAT_PROPS gives them
  // non-finite digWork, and the 0.5 digAhead gate excludes them anyway.
  if (digging) {
    const t = digTargetCell(mw, c);
    const diggable =
      t !== null &&
      c.digPower > 0 &&
      Number.isFinite(MAT_PROPS[g.mat[t.idx]].digWork);
    if (diggable) {
      c.digTicks += 1;
      const need = Math.ceil(MAT_PROPS[g.mat[t.idx]].digWork / c.digPower);
      if (c.digTicks >= need) {
        const dugMat = g.mat[t.idx];
        g.mat[t.idx] = MAT.AIR;
        g.dug[t.idx] = 1;
        g.root[t.idx] = 0;
        g.grownId[t.idx] = 0;
        c.digTicks = 0;
        c.carried = { material: MAT_NAME[dugMat] ?? 'matter', weight: 1 };
      }
    } else {
      c.digTicks = 0;
    }
  } else {
    c.digTicks = 0;
  }

  return c;
}
