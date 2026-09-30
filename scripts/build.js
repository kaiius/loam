// Bundles the game into a single self-contained dist/index.html.
// The source uses only single-line imports and `export function/const`,
// so a small deterministic transform is enough — no dependencies.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODULES = [
  'src/sim/rng.js',
  'src/sim/biomes.js', // v0.18 "Realms": pure geography — before creature.js/world.js/renderer.js (TDZ)
  'src/sim/genome.js',
  'src/sim/evodevo.js', // v0.17 "Bauplan": the developmental program
  'src/sim/plantgenome.js',
  'src/sim/biochem.js',
  'src/sim/brain.js',
  'src/sim/memory.js',
  'src/sim/culture.js',
  'src/sim/language.js',
  'src/sim/social.js',
  'src/sim/creature.js',
  'src/sim/world.js',
  'src/sim/observer.js', // v0.17.1 "Touch": the observer's hands (imports addFood, zoneAt from world.js)
  'src/sim/teacher.js',
  'src/sim/chronicle.js',
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
    if (t.startsWith('export {')) continue; // re-export facade — names are bundle-global anyway
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

// v0.15 "Bloom": namespace-safety guard. The bundle concatenates every
// module into ONE top-level scope, so two modules declaring the same
// top-level name silently collide — JS hoisting lets the LATER definition
// win. That shipped the invisibility bug: teacher.js's `moveToward`
// replaced creature.js's, and every creature's movement wrote NaN into
// x (module scope hid it from all src/ tests). Duplicates with byte-
// identical declarations (e.g. the shared clamp01 helper) are provably
// harmless; anything else fails the build loudly.
assertNoCollisions();

function topLevelDecls(src) {
  // Capture top-level `function name(`, `const/let name =`, `class name`
  // declarations with their FULL normalized text, so identity comparison
  // sees the body, not just the signature line.
  const decls = [];
  const lines = src.split('\n');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:export\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    const name = m[1];
    let text = lines[i];
    if (/^\s*(?:export\s+)?function/.test(lines[i]) || /^\s*(?:export\s+)?class/.test(lines[i])) {
      // Brace-balance through the whole body.
      let depth = 0, started = false, j = i;
      for (; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; started = true; }
          else if (ch === '}') depth--;
        }
        if (started && depth === 0) break;
      }
      text = lines.slice(i, j + 1).join('\n');
      i = j;
    } else {
      // const/let: through the terminating semicolon at paren/brace depth 0.
      let depth = 0, j = i, done = false;
      const buf = [];
      for (; j < lines.length && !done; j++) {
        buf.push(lines[j]);
        for (const ch of lines[j]) {
          if ('({['.includes(ch)) depth++;
          else if (')}]'.includes(ch)) depth--;
          else if (ch === ';' && depth === 0) done = true;
        }
      }
      text = buf.join('\n');
      i = j - 1; // j already advanced past the last consumed line; the for-loop's i++ lands on the next unconsumed line
    }
    decls.push({ name, text: norm(text) });
  }
  return decls;
}

function assertNoCollisions() {
  const byName = new Map();
  for (const mod of MODULES) {
    const src = readFileSync(join(root, mod), 'utf8');
    for (const d of topLevelDecls(src)) {
      if (!byName.has(d.name)) byName.set(d.name, []);
      byName.get(d.name).push({ mod, text: d.text });
    }
  }
  for (const [name, defs] of byName) {
    if (defs.length < 2) continue;
    const bodies = new Set(defs.map((d) => d.text));
    if (bodies.size > 1) {
      const where = defs.map((d) => `  ${d.mod}: ${d.text}`).join('\n');
      throw new Error(
        `Bundle namespace collision: top-level "${name}" declared in ${defs.length} modules ` +
        `with DIFFERENT definitions (later module wins by hoisting — this shipped the ` +
        `moveToward/NaN invisibility bug). Rename one copy.\n${where}`
      );
    }
    console.log(`note: "${name}" declared identically in ${defs.map((d) => d.mod).join(', ')} — harmless`);
  }
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
