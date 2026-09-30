// Verifies the shipped source zip is self-consistent: unzip it to a temp dir
// and run the test suite against the EXTRACTED tree, not the working tree.
// (Lesson from Emberhollow's teardown: a suite that passes on the dev tree
// but fails on the shipped zip is a packaging lie. Run before every release.)
// Usage: node scripts/verify-zip.mjs [path/to/wildcode-source.zip]

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const zip = process.argv[2] || 'wildcode-source.zip';
const dir = mkdtempSync(join(tmpdir(), 'wildcode-zip-verify-'));
try {
  execFileSync('unzip', ['-q', zip, '-d', dir], { stdio: 'pipe' });
  console.log(`extracted ${zip} -> ${dir}`);
  execFileSync('node', ['--test', 'test/sim.mjs'], { cwd: dir, stdio: 'inherit' });
  console.log('\nZIP VERIFIED: extracted tree passes the full test suite.');
} catch (e) {
  console.error('\nZIP VERIFICATION FAILED.');
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
