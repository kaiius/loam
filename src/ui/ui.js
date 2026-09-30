// UI overlay: top bar, selection panel, toasts, and the player's hand
// (select, drag, pet via double-click).

import { screenToWorld } from '../render/renderer.js';
import { petCreature, scoldCreature, creatureRadius } from '../sim/creature.js';
import { ageStage, mood } from '../sim/biochem.js';
import { layEgg, DAY_LENGTH } from '../sim/world.js';
import { randomGenome } from '../sim/genome.js';

const MOOD_EMOJI = {
  content: '😊', hungry: '🍽️', tired: '😴', bored: '😐',
  lonely: '🥺', afraid: '😨', sick: '🤒', uncomfortable: '😖',
};

export function createUI(canvas, renderer, world) {
  const ui = {
    speed: 1,
    selected: null,
    hover: null,
    dragging: null,
    world,
    _panelAt: 0,
  };

  const root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = `
    <div id="topbar">
      <span id="logo">🌱 Wildcode</span>
      <span id="clock"></span>
      <span id="census"></span>
      <span class="spacer"></span>
      <button data-speed="0" title="Pause">⏸</button>
      <button data-speed="1" title="Normal speed" class="active">▶</button>
      <button data-speed="4" title="Fast">⏩</button>
      <button id="addEgg" title="Add a wild egg">🥚+</button>
    </div>
    <div id="panel" class="hidden"></div>
    <div id="toasts"></div>
    <div id="hint">Click a creature to inspect · drag to move it · double-click to pet</div>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector('#panel');
  const clockEl = root.querySelector('#clock');
  const censusEl = root.querySelector('#census');
  const toastsEl = root.querySelector('#toasts');

  root.querySelectorAll('[data-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.speed = Number(btn.dataset.speed);
      root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  root.querySelector('#addEgg').addEventListener('click', () => {
    const x = world.rng.range(150, world.width - 150);
    layEgg(world, x, 0, randomGenome(world.rng), null);
    toast(toastsEl, '🥚 A wild egg appeared!');
  });

  // ---- Hand ----
  const toWorld = (e) => {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(renderer,
      (e.clientX - rect.left) * renderer.dpr,
      (e.clientY - rect.top) * renderer.dpr);
  };

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = toWorld(e);
    const hit = hitTest(world, x, y);
    if (hit && hit.type !== 'none') {
      ui.dragging = { hit, moved: false, sx: e.clientX, sy: e.clientY };
      if (hit.obj.dragged !== undefined) hit.obj.dragged = true;
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = toWorld(e);
    if (ui.dragging) {
      const d = ui.dragging;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
      if (d.moved) {
        d.hit.obj.x = Math.max(20, Math.min(world.width - 20, x));
        if (d.hit.type === 'toy') d.hit.obj.vx = 0;
      }
      return;
    }
    const hit = hitTest(world, x, y);
    ui.hover = hit && hit.type === 'creature' ? hit.obj : null;
    canvas.style.cursor = hit && hit.type !== 'none' ? 'grab' : 'default';
  });

  window.addEventListener('mouseup', (e) => {
    const d = ui.dragging;
    if (!d) return;
    const { x, y } = toWorld(e);
    if (d.hit.obj.dragged !== undefined) d.hit.obj.dragged = false;
    if (!d.moved) {
      ui.selected = d.hit.obj; // a click selects
    } else {
      // Drop onto the nearest sensible platform.
      const plat = dropPlatform(world, x, y);
      if (plat >= 0) d.hit.obj.platformIndex = plat;
    }
    ui.dragging = null;
    canvas.style.cursor = 'default';
    refreshPanel(panel, ui);
  });

  canvas.addEventListener('dblclick', (e) => {
    const { x, y } = toWorld(e);
    const hit = hitTest(world, x, y);
    if (hit && hit.type === 'creature') {
      petCreature(hit.obj);
      toast(toastsEl, `💕 You pet ${hit.obj.name}.`);
    }
  });

  // ---- Per-frame update ----
  ui.update = () => {
    // Clock.
    const day = Math.floor(world.time / DAY_LENGTH) + 1;
    const tod = (world.time / DAY_LENGTH) % 1;
    const icon = world.light > 0.6 ? '☀️' : world.light > 0.25 ? '🌤️' : '🌙';
    const part = tod < 0.2 ? 'dawn' : tod < 0.35 ? 'morning' : tod < 0.6 ? 'midday'
      : tod < 0.78 ? 'afternoon' : tod < 0.9 ? 'dusk' : 'night';
    clockEl.textContent = `${icon} Day ${day}, ${part}`;
    censusEl.textContent = `👥 ${world.creatures.length} creatures · 🥚 ${world.eggs.length} eggs`;

    // Toasts from world events.
    for (const ev of world.events.splice(0)) {
      if (ev.type === 'hatch') toast(toastsEl, `🥚 ${ev.creature.name} hatched!`);
      else if (ev.type === 'death') toast(toastsEl, `💀 ${ev.creature.name} died (${ev.cause}).`);
      else if (ev.type === 'mating') toast(toastsEl, `💕 ${ev.a.name} & ${ev.b.name} are expecting!`);
    }

    // Selection may have died.
    if (ui.selected && ui.selected.kind === 'creature' && !ui.selected.alive) ui.selected = null;
    if (ui.selected && ui.selected.kind === 'egg' && !world.eggs.includes(ui.selected)) ui.selected = null;

    // Throttled panel refresh.
    const now = performance.now();
    if (now - ui._panelAt > 250) {
      ui._panelAt = now;
      refreshPanel(panel, ui);
    }
  };

  return ui;
}

function hitTest(world, x, y) {
  for (let i = world.creatures.length - 1; i >= 0; i--) {
    const c = world.creatures[i];
    const plat = world.platforms[c.platformIndex];
    const r = creatureRadius(c);
    if (Math.hypot(x - c.x, y - (plat.y - r)) < r * 1.7) return { type: 'creature', obj: c };
  }
  for (const e of world.eggs) {
    if (Math.abs(x - e.x) < 28 && Math.abs(y - (e.y - 20)) < 36) return { type: 'egg', obj: e };
  }
  for (const t of world.toys) {
    if (Math.hypot(x - t.x, y - (t.y - t.r)) < t.r + 12) return { type: 'toy', obj: t };
  }
  return { type: 'none' };
}

function dropPlatform(world, x, y) {
  let best = -1, bestDy = Infinity;
  world.platforms.forEach((pl, i) => {
    if (x < pl.x1 - 30 || x > pl.x2 + 30) return;
    const dy = pl.y - y;
    if (dy > -70 && dy < bestDy) { bestDy = dy; best = i; }
  });
  return best;
}

function toast(box, msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 3600);
  while (box.children.length > 5) box.firstChild.remove();
}

function bar(label, value, color) {
  const pct = Math.round(value * 100);
  return `<div class="bar-row"><span>${label}</span><div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div></div>`;
}

function temperament(c) {
  const p = c.pheno;
  const t = [];
  t.push(p.pattern === 'plain' ? 'plain-coated' : p.pattern);
  t.push(p.earShape + ' ears');
  if (p.curiosity > 0.66) t.push('curious');
  else if (p.curiosity < 0.34) t.push('cautious');
  if (p.sociability > 0.66) t.push('social');
  else if (p.sociability < 0.34) t.push('solitary');
  if (p.boldness > 0.66) t.push('bold');
  else if (p.boldness < 0.34) t.push('timid');
  if (p.hungerRate > 0.66) t.push('big appetite');
  if (p.learningRate > 0.66) t.push('quick learner');
  return t.join(' · ');
}

function refreshPanel(panel, ui) {
  const sel = ui.selected;
  if (!sel) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  if (sel.kind === 'creature') {
    const c = sel;
    const b = c.biochem;
    const stage = ageStage(b, c.pheno);
    const m = c.mood || mood(b);
    const hue = c.pheno.hueDeg.toFixed(0);
    const dad = c.parents ? `Egg of #${c.parents[0]} × #${c.parents[1]}` : 'Wild founder';
    panel.innerHTML = `
      <div class="p-head">
        <span class="swatch" style="background:hsl(${hue},58%,60%)"></span>
        <h2>${escapeHtml(c.name)}</h2>
        <button id="p-close">✕</button>
      </div>
      <div class="badges">${stage} · ${c.sex} · ${MOOD_EMOJI[m] || ''} ${m}</div>
      ${bar('🍽️ Satiation', 1 - b.hunger, '#e8a13c')}
      ${bar('⚡ Energy', b.energy, '#7ccf5f')}
      ${bar('🎾 Fun', 1 - b.fun, '#c77ce8')}
      ${bar('💕 Company', 1 - b.social, '#e87ca8')}
      ${bar('🏥 Health', b.health, '#e85c5c')}
      <div class="traits">${temperament(c)}</div>
      <div class="family">🧬 ${dad}<br>👶 ${c.children.length} offspring</div>
      <div class="doing">Now: <i>${escapeHtml(c.actionLabel || c.action)}</i></div>
      <div class="p-actions">
        <button id="p-pet">💕 Pet</button>
        <button id="p-scold">😠 Scold</button>
      </div>`;
    panel.querySelector('#p-close').onclick = () => { ui.selected = null; refreshPanel(panel, ui); };
    panel.querySelector('#p-pet').onclick = () => petCreature(c);
    panel.querySelector('#p-scold').onclick = () => scoldCreature(c);
  } else if (sel.kind === 'egg') {
    panel.innerHTML = `
      <div class="p-head"><h2>🥚 Egg</h2><button id="p-close">✕</button></div>
      <div class="badges">hatches in ~${Math.max(0, sel.timer).toFixed(0)}s</div>
      <div class="family">${sel.parents ? `Parents #${sel.parents[0]} × #${sel.parents[1]}` : 'Wild egg'}</div>
      <div class="hint2">Keep it safe. It wobbles when hatching is near.</div>`;
    panel.querySelector('#p-close').onclick = () => { ui.selected = null; refreshPanel(panel, ui); };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
