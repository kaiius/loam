// Render v0.29 worldgen layouts to SVG side-view cross-sections for the eye verdict.
import { rollLayout, canonicalLayout, SUBSTRATE_NAMES } from './src/sim/worldgen.js';
import { writeFileSync, mkdirSync } from 'fs';

const LABEL_COLORS = {
  jungle: '#2d7a3a', desert: '#d9b25f', mountains: '#8a8d94', arctic: '#cfe8f2',
  plains: '#7fbf5f', shallows: '#5fb3d9', archipelago: '#3fa08a', deep: '#1e4f8a',
  highland: '#9a9d7a', rainforest: '#1f6e2e', steppe: '#b5a86b', tundra: '#a8c8b8',
  beach: '#e8d8a0', river: '#4fa8d0', lake: '#6fc3e8', marsh: '#5a8a6a',
};
const SUB_COLORS = { 0: '#1e4f8a', 1: '#5fb3d9', 2: '#e8d8a0', 3: '#7a5c3a', 4: '#6e6e6e', 5: '#dfe8ee' };

function renderLayout(layout, title, attemptInfo) {
  const W = layout.width, H = layout.height, COL = 20;
  const scale = 1; // keep 1:1, SVG will be scaled by viewBox in HTML
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 60}" viewBox="0 0 ${W} ${H + 60}">`;
  // sky
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#eef4f8"/>`;
  // region bands at top
  if (layout.regions) {
    for (const r of layout.regions) {
      const c = LABEL_COLORS[r.label] || '#cccccc';
      s += `<rect x="${r.x0}" y="0" width="${r.x1 - r.x0}" height="34" fill="${c}" opacity="0.85"/>`;
      if (r.x1 - r.x0 > 120) s += `<text x="${(r.x0 + r.x1) / 2}" y="22" font-size="20" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${r.label}</text>`;
    }
  }
  // terrain: per-column rects from ground y down to H, colored by substrate
  const n = layout.ground.length;
  for (let i = 0; i < n; i++) {
    const g = layout.ground[i];
    const sub = layout.substrate ? layout.substrate[i] : 3;
    const c = SUB_COLORS[sub] || '#7a5c3a';
    s += `<rect x="${i * COL}" y="${g}" width="${COL}" height="${H - g}" fill="${c}"/>`;
  }
  // sea
  const seaY = layout.seaY;
  s += `<rect x="0" y="${seaY}" width="${W}" height="${H - seaY}" fill="#2e7fc2" opacity="0.45"/>`;
  s += `<line x1="0" y1="${seaY}" x2="${W}" y2="${seaY}" stroke="#1e5f9a" stroke-width="3"/>`;
  s += `<text x="${W - 10}" y="${seaY - 8}" font-size="18" text-anchor="end" fill="#1e5f9a" font-family="sans-serif">sea level ${seaY}</text>`;
  // canopy platforms
  for (const p of layout.platforms || []) {
    const isFounder = layout.founder && layout.founder.branchPis && layout.founder.branchPis.includes(p.pi);
    const isGround = p.kind === 'ground';
    const col = isFounder ? '#c9a227' : isGround ? '#5a4a2f' : '#3e6b2f';
    const wdt = isFounder ? 6 : isGround ? 4 : 3;
    s += `<line x1="${p.x1}" y1="${p.y}" x2="${p.x2}" y2="${p.y}" stroke="${col}" stroke-width="${wdt}" stroke-linecap="round"/>`;
  }
  // founder canopy highlight box
  if (layout.founder) {
    const f = layout.founder;
    s += `<rect x="${f.x0}" y="40" width="${f.x1 - f.x0}" height="${H - 40}" fill="none" stroke="#c9a227" stroke-width="4" stroke-dasharray="14,8"/>`;
    s += `<text x="${f.x0 + 8}" y="58" font-size="20" fill="#8a6d1a" font-family="sans-serif">founder canopy (${f.fruitSlots} fruit slots)</text>`;
  }
  // title bar
  s += `<rect x="0" y="${H}" width="${W}" height="60" fill="#1a1a1a"/>`;
  s += `<text x="16" y="${H + 38}" font-size="28" fill="#ffffff" font-family="sans-serif">${title}${attemptInfo ? ' — ' + attemptInfo : ''}</text>`;
  s += `</svg>`;
  return s;
}

mkdirSync('./worldgen-renders', { recursive: true });
const out = [];
for (const seed of [7, 42, 99]) {
  const { layout, attempts, fallback } = rollLayout(seed, 1);
  const svg = renderLayout(layout, `seed ${seed}`, `attempts: ${attempts}${fallback ? ' (fallback)' : ''}`);
  const name = `worldgen-renders/seed-${seed}.svg`;
  writeFileSync(name, svg);
  out.push(name);
  console.log('wrote', name, 'regions:', layout.regions.length, 'platforms:', layout.platforms.length);
}
// canonical (v0.26 painted baseline) for the eye comparison
const canon = canonicalLayout(1);
const svgC = renderLayout(canon, 'v0.26 canonical (painted baseline)', '');
writeFileSync('worldgen-renders/canonical.svg', svgC);
console.log('wrote worldgen-renders/canonical.svg');
