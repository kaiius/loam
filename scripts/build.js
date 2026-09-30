// Bundles the game into a single self-contained dist/index.html.
// The source uses only single-line imports and `export function/const`,
// so a small deterministic transform is enough — no dependencies.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODULES = [
  'src/sim/rng.js',
  'src/sim/genome.js',
  'src/sim/biochem.js',
  'src/sim/brain.js',
  'src/sim/memory.js',
  'src/sim/culture.js',
  'src/sim/creature.js',
  'src/sim/world.js',
  'src/render/painter.js',
  'src/render/renderer.js',
  'src/ui/ui.js',
  'src/main.js',
];

function bundleModule(path) {
  let src = readFileSync(join(root, path), 'utf8');
  const lines = src.split('\n');
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('import ') && (t.includes(' from ') || t.endsWith(';'))) continue;
    kept.push(line);
  }
  return kept.join('\n')
    .replace(/^export function /gm, 'function ')
    .replace(/^export const /gm, 'const ');
}

const js = MODULES.map((m) => `\n// ---- ${m} ----\n` + bundleModule(m)).join('\n');

if (/^\s*import[\s(]/m.test(js)) {
  throw new Error('Bundle still contains import statements — check the transform.');
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wildcode — a tiny artificial-life terrarium</title>
<style>${css}</style>
</head>
<body>
<canvas id="game"></canvas>
<script>
${js}
</script>
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), out);
console.log('Wrote dist/index.html (' + (out.length / 1024).toFixed(1) + ' KB)');
