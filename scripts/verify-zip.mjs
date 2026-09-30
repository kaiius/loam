// Verifies the shipped source zip is self-consistent: unzip it to a temp dir
// and run the test suite against the EXTRACTED tree, not the working tree.
// (Lesson from Emberhollow's teardown: a suite that passes on the dev tree
// but fails on the shipped zip is a packaging lie. Run before every release.)
// Usage: node scripts/verify-zip.mjs [path/to/wildcode-source.zip]

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const zip = process.argv[2] || 'wildcode-source.zip';
const dir = mkdtempSync(join(tmpdir(), 'wildcode-zip-verify-'));
try {
  execFileSync('unzip', ['-q', zip, '-d', dir], { stdio: 'pipe' });
  // Prefixed zips (e.g. canopy-v0.17/...) extract under a single top-level
  // dir; unprefixed zips land files directly. Resolve the real tree root
  // before running the suite. (Fix 2026-09-30: the old code assumed
  // unprefixed and failed on prefixed zips.)
  const top = readdirSync(dir);
  let root = dir;
  if (top.length === 1 && statSync(join(dir, top[0])).isDirectory()) {
    root = join(dir, top[0]);
  }
  console.log(`extracted ${zip} -> ${root}`);
  execFileSync('node', ['--test', 'test/sim.mjs'], { cwd: root, stdio: 'inherit' });
  console.log('\nZIP VERIFIED: extracted tree passes the full test suite.');
  console.log('\nZIP VERIFIED: extracted tree passes the full test suite.');
} catch (e) {
  console.error('\nZIP VERIFICATION FAILED.');
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
