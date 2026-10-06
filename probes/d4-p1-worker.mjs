// D4 P1 worker: run one seed for TICKS, emit checkpoint hashes as JSON.
// (Spawned by d4-p1-determinism.mjs in a separate process per run — see
// the determinism note there.)
import { probeWorld, runSampled, worldStateHash } from './d4-helper.mjs';

const seed = parseInt(process.argv[2], 10);
const TICKS = parseInt(process.argv[3], 10);
const EVERY = parseInt(process.argv[4], 10);

const mw = probeWorld(seed, { light: true });
const hs = runSampled(mw, TICKS, EVERY, (w, t) => ({ tick: t, hash: worldStateHash(w) }));
console.log(JSON.stringify(hs));
