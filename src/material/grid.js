// Canopy material world — cellular substrate (M1).
//
// The world as manipulable material: a 2D side-view cellular grid, the sim's
// native view. CELL_PX = 10: a cell is smaller than a creature (~6 cells
// tall), bigger than noise — digging one cell is a meaningful mouthful.
//
// Parallel track: this directory does not touch src/sim/, src/render/, or
// any existing test. Tick-time processes live in process.js and are
// deterministic by construction (no RNG in the tick; ties break by sweep
// order, west->east, top->bottom).

export const CELL_PX = 10;

// Material ids. The WATER id marks water-filled rendering; the actual fluid
// dynamics run on the grid's `water` depth field (see process.js).
export const MAT = {
  AIR: 0,
  SOIL: 1,
  SAND: 2,
  CLAY: 3,
  ROCK: 4,
  WOOD: 5,
  DEADWOOD: 6,
  LEAF: 7,
  WATER: 8,
  BEDROCK: 9,
};

// Per-material properties. integrity = max unsupported horizontal span
// before slump (Infinity = never slumps); digWork = work-ticks to remove one
// cell at digPower 1 (Infinity = undiggable). solid lists what counts as
// ground; climbable flags WOOD here — the steep-ROCK slope check lives in
// locomotion (M2), not in this table.
export const MAT_PROPS = [
  // AIR
  { digWork: 0,        integrity: 0,        fertility: 0,    flammability: 0,   permeability: 0,    solid: false, climbable: false },
  // SOIL — the living earth
  { digWork: 3,        integrity: 3,        fertility: 1.0,  flammability: 0.1, permeability: 0.7,  solid: true,  climbable: false },
  // SAND — collapses always
  { digWork: 2,        integrity: 0,        fertility: 0.25, flammability: 0.0, permeability: 0.9,  solid: true,  climbable: false },
  // CLAY — piled soil compacts toward this
  { digWork: 5,        integrity: 5,        fertility: 0.5,  flammability: 0.0, permeability: 0.2,  solid: true,  climbable: false },
  // ROCK — needs claw/digPower
  { digWork: 12,       integrity: 8,        fertility: 0.05, flammability: 0.0, permeability: 0.05, solid: true,  climbable: false },
  // WOOD — living trunks/limbs
  { digWork: 8,        integrity: 6,        fertility: 0.0,  flammability: 0.6, permeability: 0.0,  solid: true,  climbable: true  },
  // DEADWOOD — fallen, rots -> soil
  { digWork: 6,        integrity: 4,        fertility: 0.3,  flammability: 0.9, permeability: 0.0,  solid: true,  climbable: false },
  // LEAF — canopy cells
  { digWork: 1,        integrity: 0,        fertility: 0.4,  flammability: 0.8, permeability: 0.0,  solid: false, climbable: false },
  // WATER
  { digWork: Infinity, integrity: 0,        fertility: 0,    flammability: 0.0, permeability: 0.0,  solid: false, climbable: false },
  // BEDROCK — world floor, undiggable
  { digWork: Infinity, integrity: Infinity, fertility: 0,    flammability: 0.0, permeability: 0.0,  solid: true,  climbable: false },
];

// Create an empty grid. All fields zeroed: mat starts as AIR everywhere.
// Fields: mat (Uint8 material id), moist (0..1 water content), root (1 if
// part of a grown structure), grownId (Uint16 plant instance id),
// dug (1 if this cell was dug out — tunnel plumbing), heat (fire),
// water (0..1 fluid depth; the WATER id is rendering, this is dynamics).
export function createGrid(cols, rows) {
  const n = cols * rows;
  return {
    cols,
    rows,
    mat: new Uint8Array(n),
    moist: new Float32Array(n),
    root: new Uint8Array(n),
    grownId: new Uint16Array(n),
    dug: new Uint8Array(n),
    heat: new Float32Array(n),
    water: new Float32Array(n),
  };
}

export function cellIndex(g, cx, cy) {
  return cy * g.cols + cx;
}

export function inBounds(g, cx, cy) {
  return cx >= 0 && cx < g.cols && cy >= 0 && cy < g.rows;
}

// Pixel coords -> material id. Out of bounds: below the grid is BEDROCK
// (the world floor), sides and top are AIR.
export function matAtPx(g, x, y) {
  const cx = Math.floor(x / CELL_PX);
  const cy = Math.floor(y / CELL_PX);
  if (cy >= g.rows) return MAT.BEDROCK;
  if (cx < 0 || cx >= g.cols || cy < 0) return MAT.AIR;
  return g.mat[cellIndex(g, cx, cy)];
}
