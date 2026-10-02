// v0.36 QA gate 7 — physiological-confinement grep.
// The §9.4 precedent: no species labels in sense vectors. The confinement
// extends one layer deeper: physiological state (hunger, thirst, bodyTemp,
// pain, illness, oxygen, fatigue) is computed from chemistry/physics/genome
// ONLY. The social/cultural/linguistic layers may READ body state (the
// keeper teaches when hunger says the lesson will land) but must never
// WRITE it — drives are computed FROM chemistry (biochem.js), not from
// who-likes-whom. Three static checks, all runnable in CI:
//   (a) no species labels in the sense path (senseVector + its input assembly);
//   (b) no physiological writes from culture.js / language.js / social.js;
//   (c) no social/cultural/linguistic inputs to the drive computation.
// A hit is FAIL with the offending lines. Run: node probes/qa-physio-confinement.mjs
import { execSync } from 'node:child_process';

const SRC = new URL('../src/sim/', import.meta.url).pathname;
const grep = (pat, files) => {
  try {
    return execSync(`grep -rnE '${pat}' ${files.map((f) => SRC + f).join(' ')} || true`,
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch (e) { return []; }
};
const results = {};
// (a) species labels must not reach the sense vector
results.sensePath = grep('speciesId|speciesName|speciesLabel', ['brain.js', 'creature.js'])
  .filter((l) => /senseVector|sense\.|s\.\w+ =/.test(l));
const senseClean = results.sensePath.length === 0;
// (b) social layers must not write physiological fields
const physWrite = '\\.(bloodSugar|hydration|bodyTemp|pain|hunger|thirst|illness|oxygen|fatigue)\\s*=[^=]';
results.socialWrites = grep(physWrite, ['culture.js', 'language.js', 'social.js']);
const writesClean = results.socialWrites.length === 0;
// (c) drive computation reads chemistry/physics, not the symbolic layers.
// biochem.js must not import or call into culture.js / language.js /
// social.js. (Social CHEMISTRY — oxytocin from grooming, loneliness from
// solitude — is legitimate: those are chemicals computed from physical
// events, per the module's own header. The boundary is the symbolic
// layer writing physiology, not the body feeling company.)
results.driveInputs = grep('from [\'"]\\./(culture|language|social)\\.js[\'"]', ['biochem.js']);
const drivesClean = results.driveInputs.length === 0;
// (d) no identity-derived values in the sense stream (Gemini v0.36: grep
// checks words, not provenance — an index-leak like `s.x = c.id % 2`
// would pass a word grep). c.id may only EXCLUDE self from neighbor
// search (nearestSpatial(..., c.id)); any other use near sense assembly
// is a leak.
results.identityLeak = grep('c\\.id|creature\\.id|\\.id\\s*%', ['brain.js'])
  .concat(grep('c\\.id|creature\\.id|\\.id\\s*%', ['creature.js'])
    .filter((l) => !/nearestSpatial|exclude self|not me|!== c\.id|!= c\.id/.test(l)
      && /gatherSenses|senseVector|s\.\w+\s*=/.test(l)));
const identityClean = results.identityLeak.length === 0;

const pass = senseClean && writesClean && drivesClean && identityClean;
console.log(JSON.stringify({ gate: 'physiological-confinement-grep',
  sensePathClean: senseClean, socialWritesClean: writesClean, drivesClean,
  identityClean,
  hits: { sensePath: results.sensePath, socialWrites: results.socialWrites,
          driveInputs: results.driveInputs, identityLeak: results.identityLeak },
  verdict: pass ? 'PASS — physiology is confined to the body modules'
                : 'FAIL — confinement violated (see hits)',
}, null, 2));
process.exit(pass ? 0 : 1);
