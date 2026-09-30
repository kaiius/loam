// UI overlay: top bar, selection panel, toasts, and the player's hand
// (select, drag, pet via double-click).

import { screenToWorld, zoomAt, panBy, recenterCamera, followPoint } from '../render/renderer.js';
import { petCreature, scoldCreature, creatureRadius } from '../sim/creature.js';
import { ageStage, mood } from '../sim/biochem.js';
import { layEgg, DAY_LENGTH, LINEAGE_TRAITS, zoneAt, CALL_REF_D } from '../sim/world.js';
import { strongestBond } from '../sim/social.js';
import { randomGenome } from '../sim/genome.js';
import { commandTeacher, setTeacherMode, teacherEat, petTeacher, teacherSenseLines, serializeTeacherSenses, TEACHER_MOTIF } from '../sim/teacher.js';
import { buildChronicle } from '../sim/chronicle.js';
import { wordName, entryStats } from '../sim/language.js';
// v0.17.1 "Touch": observer interactivity — inspect anything, touch the world.
import { describeEntity, pickFruit, placeFood, spawnFood, nudgeCreature, digMineral } from '../sim/observer.js';

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
    canvas, // v0.17.1 "Touch": panel actions need the cursor too
    // v0.14.2 "Wayfinding": camera state — drag-pan, pinch, follow.
    follow: false, // camera tracks the selected creature/teacher
    camPan: null, // drag on empty space
    pinch: null, // two-finger pinch zoom
    world,
    _panelAt: 0,
    treeOpen: false,
    evoOpen: false,
    chronOpen: false,
    evoFocusT: null, // chronicle jump: time marker on the evolution tracker
    treeFocus: null, // creature id the family tree centers on
    treeView: { x: 0, y: 0, w: 760, h: 480 }, // pan/zoom viewport
    treePan: null,
    _treeAt: 0,
    _evoAt: 0,
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
      <button id="dropFoodBtn" title="Place a fruit anywhere (observer)">🍎+ fruit</button>
      <button id="treeBtn" title="Family tree">🌳 Tree</button>
      <button id="evoBtn" title="Evolution tracker">📈 Evo</button>
      <button id="chronBtn" title="Chronicle — the world's story">📜 Chronicle</button>
      <button id="tongueBtn" title="Tongues — the emerging lexicon">📖 Tongues</button>
      <button id="soundBtn" title="Toggle sound">🔊</button>
      <button id="teacherBtn" title="Find the Teacher">🧑‍🏫</button>
    </div>
    <div id="panel" class="hidden"></div>
    <div id="treepanel" class="bigpanel hidden"></div>
    <div id="evopanel" class="bigpanel hidden"></div>
    <div id="chronpanel" class="bigpanel hidden"></div>
    <div id="tonguepanel" class="bigpanel hidden"></div>
    <div id="toasts"></div>
    <div id="hint">Click anything to inspect it · drag creatures & toys · double-click to pet · 🍎+ places fruit · drag background to pan · scroll to zoom · 🧑‍🏫 finds the Teacher</div>
    <div id="camctl">
      <button id="zoomIn" title="Zoom in">＋</button>
      <button id="zoomOut" title="Zoom out">－</button>
      <button id="nextCreature" title="Jump to the next creature">🐒</button>
      <button id="recenter" title="Recenter on the whole world">⌂</button>
    </div>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector('#panel');
  const treePanel = root.querySelector('#treepanel');
  const evoPanel = root.querySelector('#evopanel');
  const chronPanel = root.querySelector('#chronpanel');
  const tonguePanel = root.querySelector('#tonguepanel');
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
  // v0.17.1 "Touch": the observer's fruit hand — arm placement mode, the
  // next click on a branch puts a real fruit there (creatures eat it via
  // the normal doEat path; this is provisioning, not a state edit).
  root.querySelector('#dropFoodBtn').addEventListener('click', () => {
    ui.placeArm = true;
    ui.heldFood = null;
    canvas.style.cursor = 'crosshair';
    toast(toastsEl, '🍎 Click a branch or the ground to place a fruit. (Esc cancels)');
  });

  // ---- v0.14.2 "Wayfinding": camera controls ----
  // Selecting a creature (or the Teacher) re-arms camera-follow; selecting
  // anything else — or nothing — breaks it. Manual panning breaks it too.
  ui.setSelected = (obj) => {
    ui.selected = obj;
    ui.follow = !!(obj && (obj.kind === 'creature' || obj.kind === 'teacher'));
  };
  const zoomCenter = () => ({ x: renderer.canvas.width / 2, y: renderer.canvas.height / 2 });
  root.querySelector('#zoomIn').addEventListener('click', () => {
    const c = zoomCenter();
    zoomAt(renderer, world, 1.25, c.x, c.y);
  });
  root.querySelector('#zoomOut').addEventListener('click', () => {
    const c = zoomCenter();
    zoomAt(renderer, world, 1 / 1.25, c.x, c.y);
  });
  root.querySelector('#recenter').addEventListener('click', () => {
    recenterCamera(renderer, world);
    ui.follow = false;
  });
  // v0.15 "Bloom": cycle through every living creature — center + follow
  // each in turn. Answers "where are the creatures?" no matter where one
  // has wandered; also the repo-side twin of the hosted page's 🐒 button.
  ui._nextIdx = 0;
  root.querySelector('#nextCreature').addEventListener('click', () => {
    const alive = world.creatures.filter((c) => c.alive);
    if (!alive.length) return;
    const c = alive[ui._nextIdx % alive.length];
    ui._nextIdx = (ui._nextIdx + 1) % alive.length;
    ui.setSelected(c);
    refreshPanel(panel, ui);
    const plat = world.platforms[c.platformIndex];
    if (plat) followPoint(renderer, world, c.x, plat.y - 40);
  });

  // ---- v0.14: the Teacher — Sunny's in-sim avatar ----
  const teacherBtn = root.querySelector('#teacherBtn');
  teacherBtn.addEventListener('click', () => {
    ui.setSelected(world.teacher);
    ui.teacherMoveArm = false;
    refreshPanel(panel, ui);
    toast(toastsEl, `🧑‍🏫 ${world.teacher.mode === 'possessed' ? 'The Teacher is yours — possess it.' : 'The Teacher wanders on its own. Possess it from its panel.'}`);
  });
  // ---- v0.14: family tree + evolution tracker + chronicle panels ----
  const treeBtn = root.querySelector('#treeBtn');
  const evoBtn = root.querySelector('#evoBtn');
  const chronBtn = root.querySelector('#chronBtn');
  const tongueBtn = root.querySelector('#tongueBtn');
  const soundBtn = root.querySelector('#soundBtn');
  const closeBigPanels = () => {
    ui.treeOpen = ui.evoOpen = ui.chronOpen = ui.tonguesOpen = false;
    treePanel.classList.add('hidden');
    evoPanel.classList.add('hidden');
    chronPanel.classList.add('hidden');
    tonguePanel.classList.add('hidden');
    treeBtn.classList.remove('active');
    evoBtn.classList.remove('active');
    chronBtn.classList.remove('active');
    tongueBtn.classList.remove('active');
  };
  treeBtn.addEventListener('click', () => {
    ui.treeOpen = !ui.treeOpen;
    if (ui.treeOpen) {
      closeBigPanels(); ui.treeOpen = true;
      if (ui.selected && ui.selected.kind === 'creature') ui.treeFocus = ui.selected.id;
      else if (!ui.treeFocus && world.creatures.length) ui.treeFocus = world.creatures[0].id;
      renderTree(treePanel, ui);
      treeBtn.classList.add('active');
    } else closeBigPanels();
  });
  evoBtn.addEventListener('click', () => {
    ui.evoOpen = !ui.evoOpen;
    if (ui.evoOpen) {
      closeBigPanels(); ui.evoOpen = true;
      renderEvo(evoPanel, ui);
      evoBtn.classList.add('active');
    } else closeBigPanels();
  });
  chronBtn.addEventListener('click', () => {
    ui.chronOpen = !ui.chronOpen;
    if (ui.chronOpen) {
      closeBigPanels(); ui.chronOpen = true;
      renderChronicle(chronPanel, ui);
      chronBtn.classList.add('active');
    } else closeBigPanels();
  });
  // ---- v0.16 "Tongues": the field-linguist's notebook ----
  tongueBtn.addEventListener('click', () => {
    ui.tonguesOpen = !ui.tonguesOpen;
    if (ui.tonguesOpen) {
      closeBigPanels(); ui.tonguesOpen = true;
      renderTongues(tonguePanel, ui);
      tongueBtn.classList.add('active');
    } else closeBigPanels();
  });
  tonguePanel.addEventListener('click', (e) => {
    if (!e.target || !e.target.closest) return;
    if (e.target.id === 'g-close' || (e.target.closest && e.target.closest('#g-close'))) {
      ui.tonguesOpen = false; tonguePanel.classList.add('hidden'); tongueBtn.classList.remove('active');
    }
  });
  // ---- v0.16: audible calls. AudioContext starts on first user gesture
  // (autoplay policy); the toggle is on by default.
  ui.soundOn = true;
  ui._audioCursor = 0;
  const paintSoundBtn = () => { soundBtn.textContent = ui.soundOn ? '🔊' : '🔇'; };
  soundBtn.addEventListener('click', () => {
    ui.soundOn = !ui.soundOn;
    if (ui.soundOn) ensureAudio();
    paintSoundBtn();
  });
  root.addEventListener('pointerdown', () => { if (ui.soundOn) ensureAudio(); });
  treePanel.addEventListener('click', (e) => {
    if (!e.target || !e.target.closest) return;
    if (e.target.id === 't-close' || (e.target.closest && e.target.closest('#t-close'))) {
      ui.treeOpen = false; treePanel.classList.add('hidden'); treeBtn.classList.remove('active'); return;
    }
    const g = e.target.closest('[data-node]');
    if (g) {
      const id = Number(g.dataset.node);
      const live = world.creatures.find((c) => c.id === id);
      ui.treeFocus = id;
      if (live) ui.setSelected(live);
      renderTree(treePanel, ui);
      refreshPanel(panel, ui);
    }
  });
  evoPanel.addEventListener('click', (e) => {
    if (!e.target || !e.target.closest) return;
    if (e.target.id === 'e-close' || (e.target.closest && e.target.closest('#e-close'))) {
      ui.evoOpen = false; evoPanel.classList.add('hidden'); evoBtn.classList.remove('active');
    }
  });
  // Chronicle jumps: each entry offers the family tree, the evolution
  // tracker (with a time marker), and the world view.
  chronPanel.addEventListener('click', (e) => {
    if (!e.target || !e.target.closest) return;
    if (e.target.id === 'c-close' || (e.target.closest && e.target.closest('#c-close'))) {
      ui.chronOpen = false; chronPanel.classList.add('hidden'); chronBtn.classList.remove('active'); return;
    }
    const btn = e.target.closest('[data-jtab]');
    if (!btn) return;
    const tab = btn.dataset.jtab;
    ui.chronOpen = false; chronPanel.classList.add('hidden'); chronBtn.classList.remove('active');
    if (tab === 'tree') {
      const id = Number(btn.dataset.cid);
      if (world.lineage.has(id)) {
        ui.treeFocus = id;
        ui.treeOpen = true; treeBtn.classList.add('active');
        renderTree(treePanel, ui);
      } else toast(toastsEl, 'That lineage record has faded from memory.');
    } else if (tab === 'evo') {
      ui.evoFocusT = Number(btn.dataset.t);
      ui.evoOpen = true; evoBtn.classList.add('active');
      renderEvo(evoPanel, ui);
    } else if (tab === 'world') {
      if (btn.dataset.teacher) {
        ui.setSelected(world.teacher);
        refreshPanel(panel, ui);
      } else {
        const c = world.creatures.find((o) => o.id === Number(btn.dataset.cid));
        if (c) { ui.setSelected(c); refreshPanel(panel, ui); }
        else toast(toastsEl, 'That tanglekin is gone — its line lives on in the family tree.');
      }
    }
  });
  // Pan/zoom on the tree canvas (delegated; the svg re-renders on refresh).
  treePanel.addEventListener('wheel', (e) => {
    if (!ui.treeOpen) return;
    const v = ui.treeView;
    const f = (e.deltaY || 0) > 0 ? 1.15 : 1 / 1.15;
    const nw = Math.min(2400, Math.max(240, v.w * f));
    const nh = nw * (v.h / v.w);
    v.x += (v.w - nw) / 2; v.y += (v.h - nh) / 2; v.w = nw; v.h = nh;
    renderTree(treePanel, ui);
  });
  treePanel.addEventListener('mousedown', (e) => {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('[data-treebg]') && !e.target.closest('[data-node]')) {
      ui.treePan = { sx: e.clientX, sy: e.clientY, vx: ui.treeView.x, vy: ui.treeView.y };
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (ui.treePan && ui.treeOpen) {
      const v = ui.treeView;
      const rect = treePanel.getBoundingClientRect ? treePanel.getBoundingClientRect() : { width: 760, height: 480 };
      v.x = ui.treePan.vx - (e.clientX - ui.treePan.sx) * (v.w / (rect.width || 760));
      v.y = ui.treePan.vy - (e.clientY - ui.treePan.sy) * (v.h / (rect.height || 480));
      renderTree(treePanel, ui);
    }
  });
  window.addEventListener('mouseup', () => { ui.treePan = null; });

  // ---- Hand ----
  const toWorld = (e) => {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(renderer,
      (e.clientX - rect.left) * renderer.dpr,
      (e.clientY - rect.top) * renderer.dpr);
  };

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = toWorld(e);
    // v0.14: the Teacher's "move here" is armed — the click is a command, not a grab.
    if (ui.teacherMoveArm && world.teacher) {
      const te = world.teacher;
      ensurePossessed(world, te);
      const plat = dropPlatform(world, x, y);
      commandTeacher(te, { cmd: 'moveTo', x, platformIndex: plat >= 0 ? plat : te.platformIndex });
      ui.teacherMoveArm = false;
      ui.setSelected(te);
      canvas.style.cursor = 'default';
      refreshPanel(panel, ui);
      return;
    }
    // v0.17.1 "Touch": the observer's hands. Placing a held or fresh fruit
    // is a click, never a drag — it lands on the nearest sensible platform
    // through the same addFood path the trees use.
    if (ui.heldFood || ui.placeArm) {
      const plat = dropPlatform(world, x, y);
      if (plat >= 0) {
        if (ui.heldFood) {
          const placed = placeFood(world, x, plat, ui.heldFood);
          ui.heldFood = null;
          toast(toastsEl, '🍎 Placed — a real fruit now; the tanglekins can find it.');
          if (placed) ui.setSelected(placed);
        } else {
          const placed = spawnFood(world, x, plat, 'fruit');
          toast(toastsEl, '🍎 Fruit placed — it will be eaten, or it will rot, like any other.');
          if (placed) ui.setSelected(placed);
        }
      } else {
        toast(toastsEl, 'No branch or ground there — click closer to a platform.');
      }
      ui.placeArm = false;
      canvas.style.cursor = 'default';
      refreshPanel(panel, ui);
      return;
    }
    const hit = hitTest(world, x, y);
    if (hit && hit.type !== 'none') {
      // v0.17.1 "Touch": plants are rooted and mineral deposits are static —
      // they can be inspected but not dragged. Everything else (creatures,
      // eggs, toys, loose food, pebbles) the hand can move.
      const draggable = ['creature', 'teacher', 'egg', 'toy', 'food', 'pebble'].includes(hit.type);
      ui.dragging = { hit, moved: false, sx: e.clientX, sy: e.clientY, draggable };
      if (hit.obj.dragged !== undefined) hit.obj.dragged = true;
      // v0.14: grabbing the teacher is tactile contact — it feels the hand.
      if (hit.type === 'teacher') hit.obj.touchT = world.time;
      canvas.style.cursor = 'grabbing';
    } else {
      // v0.14.2 "Wayfinding": the press started on empty space — this is a
      // camera pan, never a creature grab. Positions in device px.
      ui.camPan = { sx: e.clientX * renderer.dpr, sy: e.clientY * renderer.dpr, moved: false };
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = toWorld(e);
    if (ui.dragging) {
      const d = ui.dragging;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
      if (d.moved && d.draggable) {
        // v0.17.2: the hand moves in two dimensions — held objects follow the
        // cursor in x AND y (the teacher is platform-bound: it has no y body,
        // so only x follows for it).
        d.hit.obj.x = Math.max(20, Math.min(world.width - 20, x));
        if (d.hit.type !== 'teacher') {
          d.hit.obj.y = Math.max(20, Math.min(world.height - 20, y));
        }
        if (d.hit.type === 'toy') d.hit.obj.vx = 0;
      }
      return;
    }
    // v0.14.2 "Wayfinding": drag-pan. Manual panning breaks follow.
    if (ui.camPan) {
      const p = ui.camPan;
      const cx = e.clientX * renderer.dpr, cy = e.clientY * renderer.dpr;
      if (p.px !== undefined) {
        if (Math.hypot(cx - p.sx, cy - p.sy) > 5 * renderer.dpr) p.moved = true;
        if (p.moved) {
          panBy(renderer, world, cx - p.px, cy - p.py);
          ui.follow = false;
        }
      }
      p.px = cx; p.py = cy;
      canvas.style.cursor = 'grabbing';
      return;
    }
    const hit = hitTest(world, x, y);
    ui.hover = hit && (hit.type === 'creature' || hit.type === 'teacher') ? hit.obj : null;
    canvas.style.cursor = 'grab'; // empty space is pannable too
  });

  window.addEventListener('mouseup', (e) => {
    // v0.14.2: a camera pan ends here. A pan that never moved is a no-op
    // click on empty space — selection is left alone.
    if (ui.camPan) {
      ui.camPan = null;
      canvas.style.cursor = 'default';
      return;
    }
    const d = ui.dragging;
    if (!d) return;
    const { x, y } = toWorld(e);
    if (d.hit.obj.dragged !== undefined) d.hit.obj.dragged = false;
    if (!d.moved) {
      ui.setSelected(d.hit.obj); // a click selects
    } else if (d.draggable) {
      // Drop onto the nearest sensible platform.
      const plat = dropPlatform(world, x, y);
      if (plat >= 0) d.hit.obj.platformIndex = plat;
      // v0.17.2: released in the sky, it falls — gravity is the world's own
      // law. A creature let go above its branch drops with real physics
      // (stepPhysics lands it, with fall damage as modeled); released at
      // branch level it stays grounded and stands.
      if (d.hit.type === 'creature') {
        const cp = world.platforms[d.hit.obj.platformIndex];
        if (cp && d.hit.obj.y < cp.y - 8) {
          d.hit.obj.grounded = false;
          d.hit.obj.vy = 0;
        }
      }
      // v0.14: dragging the Teacher re-targets it — otherwise it would walk back.
      if (d.hit.obj.kind === 'teacher') {
        d.hit.obj.targetX = d.hit.obj.x;
        d.hit.obj.targetPlatform = d.hit.obj.platformIndex;
      }
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
    } else if (hit && hit.type === 'teacher') {
      // v0.14: the teacher can be petted too — touch with consequences.
      const c = petTeacher(world, hit.obj);
      toast(toastsEl, `💕 You pet the Teacher. (comfort ${c.toFixed(1)})`);
    } else if (!hit || hit.type === 'none') {
      // v0.14.2 "Wayfinding": double-click on empty space recenters the
      // whole world. (Double-clicking a creature still pets it.)
      recenterCamera(renderer, world);
      ui.follow = false;
    }
  });

  // v0.14.2 "Wayfinding": wheel zooms centered on the cursor.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(renderer, world,
      (e.deltaY || 0) > 0 ? 1 / 1.15 : 1.15,
      (e.clientX - rect.left) * renderer.dpr,
      (e.clientY - rect.top) * renderer.dpr);
  }, { passive: false });

  // v0.14.2: two-finger pinch zoom + pan on touch. A single finger is left
  // alone — it rides the synthesized mouse path (tap/drag) above.
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      ui.dragging = null;
      ui.camPan = null;
      ui.pinch = pinchState(renderer, e.touches);
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (ui.pinch && e.touches.length === 2) {
      e.preventDefault();
      const prev = ui.pinch;
      const next = pinchState(renderer, e.touches);
      zoomAt(renderer, world, next.d / prev.d, next.mx, next.my);
      panBy(renderer, world, next.mx - prev.mx, next.my - prev.my);
      ui.follow = false; // manual panning breaks follow
      ui.pinch = next;
    }
  }, { passive: false });
  const endPinch = (e) => { if (e.touches.length < 2) ui.pinch = null; };
  canvas.addEventListener('touchend', endPinch);
  canvas.addEventListener('touchcancel', endPinch);

  // v0.14.2: arrow keys pan the camera (manual panning breaks follow).
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    // v0.17.1 "Touch": Esc lowers the observer's hand — cancels fruit
    // placement or drops a held fruit back into the void (it was taken
    // out of the world when picked up; the observer may waste it).
    if (e.key === 'Escape') {
      if (ui.heldFood || ui.placeArm) {
        ui.heldFood = null;
        ui.placeArm = false;
        canvas.style.cursor = 'default';
        toast(toastsEl, '✋ Hand lowered.');
      }
      return;
    }
    const step = 60 * renderer.dpr;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = step;
    else if (e.key === 'ArrowRight') dx = -step;
    else if (e.key === 'ArrowUp') dy = step;
    else if (e.key === 'ArrowDown') dy = -step;
    else return;
    e.preventDefault();
    panBy(renderer, world, dx, dy);
    ui.follow = false;
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
    const nTrad = world.culture.traditions.length;
    if (nTrad > 0) censusEl.textContent += ` · 📜 ${nTrad} tradition${nTrad > 1 ? 's' : ''}`;

    // Toasts from world events.
    for (const ev of world.events.splice(0)) {
      if (ev.type === 'hatch') toast(toastsEl, `🥚 ${ev.creature.name} hatched!`);
      else if (ev.type === 'death') toast(toastsEl, `💀 ${ev.creature.name} died (${ev.cause}).`);
      else if (ev.type === 'mating') toast(toastsEl, `💕 ${ev.a.name} & ${ev.b.name} are expecting!`);
      else if (ev.type === 'traditionFounded') toast(toastsEl, `📜 ${ev.creature.name} founded "${ev.name}"!`);
      else if (ev.type === 'traditionAdopted') toast(toastsEl, `📜 ${ev.creature.name} learned "${ev.name}".`);
      else if (ev.type === 'traditionLost') toast(toastsEl, `🌫️ "${ev.name}" is forgotten.`);
      else if (ev.type === 'speciation') toast(toastsEl, `💥 Speciation! Lineage ${ev.from} split into ${ev.to.length} species.`);
    }

    // Selection may have died.
    if (ui.selected && ui.selected.kind === 'creature' && !ui.selected.alive) ui.setSelected(null);
    if (ui.selected && ui.selected.kind === 'egg' && !world.eggs.includes(ui.selected)) ui.setSelected(null);
    // v0.17.1 "Touch": inspector selections can vanish too — eaten fruit,
    // culled seedlings. (Minerals and toys persist; pebbles are forever.)
    if (ui.selected && ui.selected.kind === 'food' && !world.foods.includes(ui.selected)) ui.setSelected(null);
    if (ui.selected && (ui.selected.kind === 'plant' || ui.selected.kind === 'herb') && !world.plants.includes(ui.selected)) ui.setSelected(null);

    // v0.14.2 "Wayfinding": follow — keep the selected creature or Teacher
    // centered, at the current zoom. Runs before render() each frame.
    if (ui.follow && ui.selected && (ui.selected.kind === 'creature' || ui.selected.kind === 'teacher')) {
      const s = ui.selected;
      const plat = world.platforms[s.platformIndex];
      if (plat) followPoint(renderer, world, s.x, plat.y - 40);
    } else if (ui.follow) {
      ui.follow = false;
    }

    // Throttled panel refresh.
    const now = performance.now();
    if (now - ui._panelAt > 250) {
      ui._panelAt = now;
      refreshPanel(panel, ui);
    }
    // v0.14: tree + tracker refresh while open (slower cadence — they re-render SVG).
    if (ui.treeOpen && now - ui._treeAt > 1200) {
      ui._treeAt = now;
      if (ui.selected && ui.selected.kind === 'creature') ui.treeFocus = ui.selected.id;
      renderTree(treePanel, ui);
    }
    if (ui.evoOpen && now - ui._evoAt > 2000) {
      ui._evoAt = now;
      renderEvo(evoPanel, ui);
    }
    // v0.16 "Tongues": audible calls + the notebook refresh.
    drainCallSounds(world, ui, renderer);
    if (ui.tonguesOpen && now - ui._tongueAt > 1500) {
      ui._tongueAt = now;
      renderTongues(tonguePanel, ui);
    }
  };

  return ui;
}

// v0.14: taking the Teacher's hand — any direct command switches it to
// possessed mode first, so the autonomous policy never fights the driver.
function ensurePossessed(world, teacher) {
  if (teacher.mode !== 'possessed') setTeacherMode(world, teacher, 'possessed');
}

function hitTest(world, x, y) {
  // v0.14: the Teacher is drawn on top of the creatures, so it hit-tests first.
  if (world.teacher) {
    const te = world.teacher;
    const plat = world.platforms[te.platformIndex];
    if (Math.hypot(x - te.x, y - (plat.y - 20)) < 40) return { type: 'teacher', obj: te };
  }
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
  // v0.17.1 "Touch": everything is inspectable — minerals, pebbles, loose
  // food, then plants (fruit hit-tests before the tree it hangs in).
  for (const m of world.minerals || []) {
    if (Math.hypot(x - m.x, y - (m.y - 18)) < 30) return { type: 'mineral', obj: m };
  }
  for (const pb of world.pebbles || []) {
    if (Math.hypot(x - pb.x, y - (pb.y - pb.r * 0.45)) < pb.r + 12) return { type: 'pebble', obj: pb };
  }
  for (const f of world.foods) {
    if (Math.hypot(x - f.x, y - (f.y - 12)) < 20) return { type: 'food', obj: f };
  }
  for (const p of world.plants) {
    const h = 40 + p.growth * 70;
    if (Math.abs(x - p.x) < 34 && y < p.y + 6 && y > p.y - h - 20) {
      return { type: p.kind === 'herb' ? 'herb' : 'plant', obj: p };
    }
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

// v0.14.2 "Wayfinding": pinch geometry in device px — span and midpoint.
function pinchState(renderer, touches) {
  const rect = renderer.canvas.getBoundingClientRect();
  const ax = (touches[0].clientX - rect.left) * renderer.dpr;
  const ay = (touches[0].clientY - rect.top) * renderer.dpr;
  const bx = (touches[1].clientX - rect.left) * renderer.dpr;
  const by = (touches[1].clientY - rect.top) * renderer.dpr;
  return {
    d: Math.max(1, Math.hypot(ax - bx, ay - by)),
    mx: (ax + bx) / 2,
    my: (ay + by) / 2,
  };
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
  if (p.instFearFlee > 0.75) t.push('jumpy');
  if (p.instBoredPlay > 0.75) t.push('playful');
  if (p.immunity > 0.75) t.push('hardy');
  else if (p.immunity < 0.25) t.push('sickly');
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
    panel.innerHTML = `
      <div class="p-head">
        <span class="swatch" style="background:hsl(${hue},58%,60%)"></span>
        <h2>${escapeHtml(c.name)}</h2>
        <button id="p-close">✕</button>
      </div>
      <div class="badges">${stage} · ${c.sex} · ${MOOD_EMOJI[m] || ''} ${m}</div>
      <div class="zone">📍 ${zoneAt(c.x).name}</div>
      ${c.homeX !== undefined ? `<div class="zone">🏠 Home: ${zoneAt(c.homeX).name}</div>` : ''}
      ${c.speciesId ? `<div class="zone">🧬 Species #${c.speciesId}${c.hybrid ? ` · ⚠️ hybrid (viability ${c.hybrid.viability.toFixed(2)})` : ''}</div>` : ''}
      <div class="zone">🎵 Voice pitch: ${(c.voicePitch ?? 0.5).toFixed(2)}${(c.heardPitches || []).length ? ` · ${c.heardPitches.length} pitches learned` : ''}</div>
      ${tribeHtml(ui, c)}
      ${bondHtml(ui, c)}
      ${bar('🍽️ Satiation', 1 - b.hunger, '#e8a13c')}
      ${bar('⚡ Energy', b.energy, '#7ccf5f')}
      ${bar('🎾 Fun', 1 - b.fun, '#c77ce8')}
      ${bar('💕 Company', 1 - b.social, '#e87ca8')}
      ${bar('🏥 Health', b.health, '#e85c5c')}
      ${b.illness > 0.05 ? bar('🤒 Illness', b.illness, '#9db33c') : ''}
      <div class="traits">${temperament(c)}</div>
      ${lineageHtml(ui, c)}
      <div class="doing">Now: <i>${escapeHtml(c.actionLabel || c.action)}</i></div>
      <div class="doing">🧠 ${c.memory.episodes.length}/${c.memory.capacity} memories</div>
      ${c.traditions && c.traditions.length ? `<div class="doing">📜 ${c.traditions.map((id) => { const t = ui.world.culture.traditions.find((x) => x.id === id); return t ? escapeHtml(t.name) : null; }).filter(Boolean).join(' · ')}</div>` : ''}
      <div class="p-actions">
        <button id="p-pet">💕 Pet</button>
        <button id="p-scold">😠 Scold</button>
        <button id="p-nudge">👉 Nudge</button>
        <button id="p-follow">${ui.follow ? '📍 Following ✓' : '📍 Follow'}</button>
      </div>`;
    panel.querySelector('#p-close').onclick = () => { ui.setSelected(null); refreshPanel(panel, ui); };
    panel.querySelector('#p-pet').onclick = () => petCreature(c);
    panel.querySelector('#p-scold').onclick = () => scoldCreature(c);
    panel.querySelector('#p-nudge').onclick = () => {
      // v0.17.1 "Touch": a gentle shove — a velocity impulse through the
      // physics integrator, never a teleport. The world does the moving.
      nudgeCreature(ui.world, c);
      toast(toastsEl, `👉 You nudge ${escapeHtml(c.name)}.`);
      refreshPanel(panel, ui);
    };
    panel.querySelector('#p-follow').onclick = () => { ui.follow = !ui.follow; refreshPanel(panel, ui); };
    panel.querySelectorAll('.l-kid').forEach((btn) => {
      btn.onclick = () => {
        const kid = ui.world.creatures.find((o) => String(o.id) === btn.dataset.kid);
        if (kid) { ui.setSelected(kid); refreshPanel(panel, ui); }
      };
    });
  } else if (sel.kind === 'teacher') {
    // v0.14: the Teacher's panel — possession controls.
    const te = sel;
    const possessed = te.mode === 'possessed';
    panel.innerHTML = `
      <div class="p-head"><h2>🧑‍🏫 Sunny <span class="swatch" style="background:#2f6fd0"></span></h2><button id="p-close">✕</button></div>
      <div class="badges">${possessed ? '✋ POSSESSED — yours to drive' : '🤖 AUTONOMOUS — wandering teacher'}</div>
      <div class="zone">📍 ${zoneAt(te.x).name} · Now: <i>${escapeHtml(te.actionLabel || te.state)}</i></div>
      <div class="zone">🎵 Motif pitch: ${TEACHER_MOTIF.map((p) => p.toFixed(2)).join(' → ')}</div>
      <div class="p-actions">
        <button id="t-mode">${possessed ? '🤖 Release to autonomous' : '✋ Possess'}</button>
        <button id="t-demo">📢 Demo call</button>
        <button id="t-reward">🌟 Reward nearest</button>
        <button id="t-eat">👅 Taste fruit</button>
        <button id="t-move">📍 Move here…</button>
        <button id="t-follow">${ui.follow ? '📍 Following ✓' : '📍 Follow'}</button>
      </div>
      <div class="senses"><div class="l-title">👁️ Senses — what Sunny feels</div>
        ${teacherSenseLines(ui.world, te).map((l) => `<div class="sense">${escapeHtml(l)}</div>`).join('')}
        <div class="p-actions"><button id="t-copy">📋 Copy senses</button></div>
      </div>
      <div class="hint2">A visitor, not a tanglekin — no hunger, no mating, no death. Demos seed the zone dialect; rewards select for imitators.</div>`;
    panel.querySelector('#p-close').onclick = () => { ui.setSelected(null); refreshPanel(panel, ui); };
    panel.querySelector('#t-mode').onclick = () => {
      setTeacherMode(ui.world, te, possessed ? 'autonomous' : 'possessed');
      refreshPanel(panel, ui);
    };
    panel.querySelector('#t-demo').onclick = () => {
      ensurePossessed(ui.world, te);
      // v0.16: the demo cycles the Rosetta types — FOOD / CONTACT / COME / DANGER.
      const types = ['food', 'contact', 'come', 'danger'];
      const next = types[((types.indexOf(te.demoType) + 1) + types.length) % types.length] || 'food';
      const motif = next === 'danger' ? [0.85, 0.92, 0.85]
        : next === 'come' ? [0.5, 0.62, 0.5]
        : next === 'food' ? [0.55, 0.5] : TEACHER_MOTIF;
      commandTeacher(te, { cmd: 'demo', pitches: motif, type: next });
      toast(toastsEl, `📢 The Teacher demonstrates: ${next}.`);
      refreshPanel(panel, ui);
    };
    panel.querySelector('#t-reward').onclick = () => {
      ensurePossessed(ui.world, te);
      commandTeacher(te, { cmd: 'rewardNearest' });
      refreshPanel(panel, ui);
    };
    panel.querySelector('#t-move').onclick = () => {
      ensurePossessed(ui.world, te);
      ui.teacherMoveArm = true;
      toast(toastsEl, '📍 Click anywhere in the canopy to send the Teacher there.');
      refreshPanel(panel, ui);
    };
    panel.querySelector('#t-follow').onclick = () => { ui.follow = !ui.follow; refreshPanel(panel, ui); };
    panel.querySelector('#t-eat').onclick = () => {
      ensurePossessed(ui.world, te);
      commandTeacher(te, { cmd: 'eat' });
      refreshPanel(panel, ui);
    };
    panel.querySelector('#t-copy').onclick = () => {
      const text = serializeTeacherSenses(ui.world, te);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => toast(toastsEl, '📋 Senses copied — paste them to Sunny in chat.'),
          () => toast(toastsEl, '📋 Copy failed — the senses are in the panel above.'));
      } else {
        toast(toastsEl, '📋 Clipboard unavailable — the senses are in the panel above.');
      }
    };
  } else if (sel.kind === 'egg') {
    panel.innerHTML = `
      <div class="p-head"><h2>🥚 Egg</h2><button id="p-close">✕</button></div>
      <div class="badges">hatches in ~${Math.max(0, sel.timer).toFixed(0)}s</div>
      <div class="family">${sel.parents ? `Parents #${sel.parents[0]} × #${sel.parents[1]}` : 'Wild egg'}</div>
      <div class="hint2">Keep it safe. It wobbles when hatching is near.</div>`;
    panel.querySelector('#p-close').onclick = () => { ui.setSelected(null); refreshPanel(panel, ui); };
  } else if (sel.kind === 'plant' || sel.kind === 'herb' || sel.kind === 'food' ||
             sel.kind === 'mineral' || sel.kind === 'pebble' || sel.kind === 'toy') {
    // v0.17.1 "Touch": the inspector — every entity gets its honest details,
    // rendered from describeEntity (which only reports what the engine models).
    renderInspectPanel(panel, ui, sel);
  }
}

// v0.17.1 "Touch": the inspector panel. Rows and bars come from
// describeEntity; the action buttons are the observer's verbs.
function renderInspectPanel(panel, ui, sel) {
  const world = ui.world;
  const d = describeEntity(world, sel);
  if (!d) { panel.classList.add('hidden'); return; }
  const rows = d.rows.map(([label, value]) => label
    ? `<div class="zone"><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</div>`
    : `<div class="zone"><i>${escapeHtml(value)}</i></div>`).join('');
  const bars = d.bars.map((b) => bar(b.label, b.value, b.color)).join('');
  let actions = '';
  if (sel.kind === 'food') {
    actions = `<div class="p-actions"><button id="i-pick">🤏 Pick up</button></div>`;
  } else if (sel.kind === 'mineral') {
    actions = sel.amount > 0
      ? `<div class="p-actions"><button id="i-dig">⛏️ Collect sample</button></div>`
      : `<div class="hint2">Depleted — the claim marker stays, the stone is gone.</div>`;
  }
  panel.innerHTML = `
    <div class="p-head"><h2>${escapeHtml(d.title)}</h2><button id="p-close">✕</button></div>
    <div class="badges">${escapeHtml(d.subtitle)}</div>
    ${rows}${bars}
    ${d.note ? `<div class="hint2">${escapeHtml(d.note)}</div>` : ''}
    ${actions}`;
  panel.querySelector('#p-close').onclick = () => { ui.setSelected(null); refreshPanel(panel, ui); };
  const pickBtn = panel.querySelector('#i-pick');
  if (pickBtn) pickBtn.onclick = () => {
    const held = pickFruit(world, sel);
    if (held) {
      ui.heldFood = held;
      ui.setSelected(null);
      ui.canvas.style.cursor = 'crosshair';
      toast(toastsEl, '🤏 Holding fruit — click a branch to place it. (Esc lowers your hand)');
    }
    refreshPanel(panel, ui);
  };
  const digBtn = panel.querySelector('#i-dig');
  if (digBtn) digBtn.onclick = () => {
    const sample = digMineral(world, sel);
    if (sample) {
      ui.samples = (ui.samples || 0) + 1;
      toast(toastsEl, `⛏️ Collected a ${sample.mineralName} sample (${ui.samples} in hand). Creatures can't use it yet — the technology release will change that.`);
    }
    refreshPanel(panel, ui);
  };
}

// v0.12 tribes & bonds: the band this creature's home range falls in
// (detected, never assigned), and its strongest pairwise bond.
function tribeHtml(ui, c) {
  const t = (ui.world.tribes || []).find((t) => t.members.includes(c.id));
  if (!t) return '';
  return `<div class="zone">🪶 Band: <span style="color:${t.color}">⬤</span> ${escapeHtml(t.name)} (${t.members.length})</div>`;
}

function bondHtml(ui, c) {
  if (!ui.world.bonds) return '';
  const sb = strongestBond(ui.world, c);
  if (!sb || Math.abs(sb.v) < 0.15) return '';
  const label = sb.v > 0 ? 'friend' : 'rival';
  return `<div class="zone">💞 Closest bond: ${escapeHtml(sb.other.name || '?')} <i>(${label} ${sb.v >= 0 ? '+' : ''}${sb.v.toFixed(2)})</i></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// v0.10 lineage view: ancestry chain + trait comparison across generations.
// Walks the world's lineage registry (dead ancestors stay resolvable).
function lineageHtml(ui, c) {
  const lin = ui.world.lineage;
  const rec = lin.get(c.id);
  if (!rec || !rec.parents) {
    return `<div class="lineage"><div class="l-title">🧬 Lineage</div>
      <div class="l-chain">Wild founder — no recorded parents.</div></div>`;
  }
  // Ancestor chain, up to 3 generations back: F(n): A × B → ...
  const chain = [];
  let current = [rec];
  for (let g = 0; g < 3 && current.length; g++) {
    const names = current.map((r) => `${escapeHtml(r.name)} <span class="l-gen">F${r.generation}</span>`);
    chain.unshift(names.join(' × '));
    const next = [];
    for (const r of current) {
      if (r.parents) for (const pid of r.parents) {
        const p = lin.get(pid);
        if (p && !next.includes(p)) next.push(p);
      }
    }
    current = next;
  }
  // Trait comparison: you vs parents' average vs grandparents' average.
  const avg = (recs, k) => {
    const vs = recs.map((r) => r.traits[k]).filter((v) => typeof v === 'number');
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const parents = rec.parents.map((pid) => lin.get(pid)).filter(Boolean);
  const grandparents = [];
  for (const p of parents) {
    if (p.parents) for (const gpid of p.parents) {
      const gp = lin.get(gpid);
      if (gp && !grandparents.includes(gp)) grandparents.push(gp);
    }
  }
  const TRAIT_LABEL = {
    size: 'Size', legLength: 'Legs', spikes: 'Spikes', fur: 'Fur',
    eyeSize: 'Eyes', mouthSize: 'Mouth', immunity: 'Immunity',
    learningRate: 'Learning', boldness: 'Boldness', lifespan: 'Lifespan',
  };
  const arrow = (mine, theirs) => {
    if (theirs === null) return '';
    const d = mine - theirs;
    if (Math.abs(d) < 0.02) return '<span class="l-same">=</span>';
    return d > 0 ? '<span class="l-up">▲</span>' : '<span class="l-dn">▼</span>';
  };
  const rows = LINEAGE_TRAITS.map((k) => {
    const mine = rec.traits[k];
    const pAvg = avg(parents, k), gAvg = avg(grandparents, k);
    const fmt = (v) => v === null ? '–' : v.toFixed(2);
    return `<tr><td>${TRAIT_LABEL[k] || k}</td><td class="l-you">${fmt(mine)} ${arrow(mine, pAvg)}</td><td>${fmt(pAvg)}</td><td>${fmt(gAvg)}</td></tr>`;
  }).join('');
  // Diet is a choice gene — show values, no arrows.
  const dietRow = (() => {
    const mine = rec.traits.diet;
    const pDiets = parents.map((p) => p.traits.diet).filter(Boolean);
    const gDiets = grandparents.map((p) => p.traits.diet).filter(Boolean);
    const uniq = (ds) => [...new Set(ds)].join('/');
    return `<tr><td>Diet</td><td class="l-you">${escapeHtml(mine || '–')}</td><td>${escapeHtml(uniq(pDiets) || '–')}</td><td>${escapeHtml(uniq(gDiets) || '–')}</td></tr>`;
  })();
  // Living children as clickable chips.
  const kids = ui.world.creatures.filter((o) => o.parents && o.parents.includes(c.id));
  const kidChips = kids.length
    ? kids.map((k) => `<button class="l-kid" data-kid="${k.id}">${escapeHtml(k.name)}</button>`).join('')
    : '<span class="l-none">none yet</span>';
  return `<div class="lineage"><div class="l-title">🧬 Lineage</div>
    <div class="l-chain">${chain.join(' → ')}</div>
    <table class="l-table"><tr><th></th><th>You</th><th>Parents</th><th>Grandparents</th></tr>${rows}${dietRow}</table>
    <div class="l-kids">👶 ${kidChips}</div></div>`;
}

// ---- v0.14 "Voices": family tree ----
// Focused on one creature: ancestors ≤3 generations up, descendants ≤3
// down. Dead ancestors stay resolvable through the lineage registry.
// SVG is built as innerHTML strings (never createElementNS — the
// dist-smoke DOM stub doesn't have it).
function buildTreeData(world, focusId) {
  const lin = world.lineage;
  const kids = world.lineageKids;
  const focus = lin.get(focusId);
  if (!focus) return null;
  const nodes = new Map(); // id → { rec, gen }
  nodes.set(focusId, { rec: focus, gen: 0 });
  let frontier = [focusId];
  for (let g = 1; g <= 3 && frontier.length; g++) {
    const next = [];
    for (const id of frontier) {
      const rec = lin.get(id);
      if (!rec || !rec.parents) continue;
      for (const pid of rec.parents) {
        if (typeof pid !== 'number' || nodes.has(pid)) continue;
        const pr = lin.get(pid);
        if (!pr) continue;
        nodes.set(pid, { rec: pr, gen: -g });
        next.push(pid);
      }
    }
    frontier = next;
  }
  frontier = [focusId];
  for (let g = 1; g <= 3 && frontier.length; g++) {
    const next = [];
    for (const id of frontier) {
      for (const kidId of kids.get(id) || []) {
        if (nodes.has(kidId)) continue;
        const kr = lin.get(kidId);
        if (!kr) continue;
        nodes.set(kidId, { rec: kr, gen: g });
        next.push(kidId);
      }
    }
    frontier = next;
  }
  return { nodes, focusId };
}

const TREE_CAP = 120; // node cap — the tree is windowed past this
function renderTree(treePanel, ui) {
  const world = ui.world;
  if (!ui.treeFocus && world.creatures.length) ui.treeFocus = world.creatures[0].id;
  const data = ui.treeFocus ? buildTreeData(world, ui.treeFocus) : null;
  if (!data) {
    treePanel.classList.remove('hidden');
    treePanel.innerHTML = `<div class="bp-head"><h2>🌳 Family tree</h2><button id="t-close">✕</button></div>
      <div class="tnote">No lineage record for the focused creature (old records are pruned past 5000).</div>`;
    return;
  }
  const liveIds = new Set(world.creatures.map((c) => c.id));
  // Layout: generations as columns, nodes stacked within.
  const colW = 150, rowH = 46;
  const cols = new Map();
  for (const [id, n] of data.nodes) {
    if (!cols.has(n.gen)) cols.set(n.gen, []);
    cols.get(n.gen).push(id);
  }
  const pos = new Map();
  let count = 0, truncated = false;
  for (const g of [...cols.keys()].sort((a, b) => a - b)) {
    cols.get(g).forEach((id, i) => {
      count++;
      if (count > TREE_CAP) { truncated = true; return; }
      pos.set(id, { x: (g + 3) * colW + 50, y: (i + 1) * rowH });
    });
  }
  let edges = '';
  for (const [id, n] of data.nodes) {
    if (!pos.has(id) || !n.rec.parents) continue;
    for (const pid of n.rec.parents) {
      if (typeof pid !== 'number' || !pos.has(pid)) continue;
      const a = pos.get(pid), b = pos.get(id);
      edges += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>`;
    }
  }
  let drawn = '';
  for (const [id, n] of data.nodes) {
    if (!pos.has(id)) continue;
    const p = pos.get(id);
    const rec = n.rec;
    const alive = liveIds.has(id);
    const hue = rec.speciesId ? (rec.speciesId * 137) % 360 : 210;
    const fill = alive ? `hsl(${hue},55%,55%)` : '#4a4a5a';
    const isFocus = id === data.focusId;
    drawn += `<g data-node="${id}" style="cursor:pointer">`
      + `<circle cx="${p.x}" cy="${p.y}" r="15" fill="${fill}" ${isFocus ? 'stroke="#fff" stroke-width="3"' : 'stroke="rgba(255,255,255,0.35)" stroke-width="1.5"'}/>`
      + `<text x="${p.x}" y="${p.y + 31}" text-anchor="middle" fill="#f2f0e8" font-size="10">${escapeHtml(rec.name)}${rec.diedAt != null ? ' †' : ''}</text>`
      + `<text x="${p.x}" y="${p.y + 42}" text-anchor="middle" fill="#999" font-size="9">F${rec.generation}${rec.speciesId ? ' · sp' + rec.speciesId : ''}</text>`
      + `</g>`;
  }
  const v = ui.treeView;
  const focus = data.nodes.get(data.focusId).rec;
  const focusLive = world.creatures.find((c) => c.id === data.focusId);
  const detail = focusLive
    ? `${escapeHtml(focusLive.name)} is alive — ${ageStage(focusLive.biochem, focusLive.pheno)}, ${focusLive.sex}.`
    : `${escapeHtml(focus.name)}${focus.diedAt != null ? ` † died day ${Math.floor(focus.diedAt / DAY_LENGTH) + 1} (${escapeHtml(focus.cause || 'unknown cause')})` : ' (record only)'}.`
      + ` Born day ${Math.floor(focus.bornAt / DAY_LENGTH) + 1} in ${escapeHtml(focus.zone)}.`
      + (focus.speciesId ? ` Species #${focus.speciesId}.` : '');
  treePanel.classList.remove('hidden');
  treePanel.innerHTML = `<div class="bp-head"><h2>🌳 Family tree</h2><button id="t-close">✕</button></div>
    <div class="tdetail">${detail}</div>
    <div class="tsvg" data-treebg="1"><svg viewBox="${v.x} ${v.y} ${v.w} ${v.h}" width="100%" height="420" data-treebg="1">${edges}${drawn}</svg></div>
    ${truncated ? `<div class="tnote">Showing ${TREE_CAP} of a larger family — the tree is windowed.</div>` : ''}
    <div class="tnote">Scroll to zoom · drag to pan · click a node to inspect · color = species</div>`;
}

// ---- v0.14 "Voices": evolution tracker ----
// Three strips on a shared time axis: species sizes, species mean voice
// pitch (the dialect signature), and Eliza's vocalPitch S per zone —
// plus event markers for speciation 💥 and gene duplications 🧬.
function renderEvo(evoPanel, ui) {
  const world = ui.world;
  const snaps = world.speciesLog.filter((e) => e.kind === 'snapshot');
  evoPanel.classList.remove('hidden');
  if (snaps.length < 2) {
    evoPanel.innerHTML = `<div class="bp-head"><h2>📈 Evolution tracker</h2><button id="e-close">✕</button></div>
      <div class="tnote">Not enough history yet — the tracker wakes after the first species snapshots (every 6 sim-minutes).</div>`;
    return;
  }
  const W = 680, pad = 36, stripH = 108;
  const tMax = Math.max(world.time, 1);
  const X = (t) => pad + (t / tMax) * (W - pad - 10);
  const dayTick = (t) => `D${Math.floor(t / DAY_LENGTH) + 1}`;
  const ids = [...new Set(snaps.flatMap((s) => s.clusters.map((c) => c.id)))].sort((a, b) => a - b);
  const spColor = (id) => `hsl(${(id * 137) % 360},60%,62%)`;
  // One polyline per species, broken into segments where the species is absent.
  const segments = (valOf, yOf) => {
    let out = '';
    for (const id of ids) {
      let seg = [];
      const flush = () => {
        if (seg.length > 1) out += `<polyline points="${seg.join(' ')}" fill="none" stroke="${spColor(id)}" stroke-width="2"/>`;
        seg = [];
      };
      for (const s of snaps) {
        const cl = s.clusters.find((c) => c.id === id);
        if (!cl) { flush(); continue; }
        seg.push(`${X(s.t).toFixed(1)},${yOf(valOf(cl)).toFixed(1)}`);
      }
      flush();
    }
    return out;
  };
  const maxSize = Math.max(1, ...snaps.flatMap((s) => s.clusters.map((c) => c.size)));
  const ySize = (v) => stripH - 10 - (v / maxSize) * (stripH - 34);
  const yPitch = (v) => stripH - 10 - v * (stripH - 34);
  const stripA = segments((cl) => cl.size, ySize);
  const stripB = segments((cl) => cl.meanPitch, yPitch);
  // Strip C: vocalPitch S per zone from the divergence log.
  const divs = world.divergenceLog || [];
  const zoneKeys = divs.length ? Object.keys(divs[0].zones) : [];
  let maxAbs = 0.01;
  for (const d of divs) for (const zk of zoneKeys) maxAbs = Math.max(maxAbs, Math.abs(d.zones[zk].vocalPitch || 0));
  const yS = (v) => stripH / 2 - (v / maxAbs) * (stripH / 2 - 14);
  const zColor = ['#7ccf5f', '#e8a13c', '#7cc8e8', '#c77ce8', '#e87ca8', '#9db33c', '#e85c5c'];
  let stripC = `<line x1="${pad}" y1="${stripH / 2}" x2="${W - 10}" y2="${stripH / 2}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;
  zoneKeys.forEach((zk, zi) => {
    const pts = divs.map((d) => `${X(d.t).toFixed(1)},${yS(d.zones[zk].vocalPitch || 0).toFixed(1)}`).join(' ');
    if (pts) stripC += `<polyline points="${pts}" fill="none" stroke="${zColor[zi % zColor.length]}" stroke-width="1.5"/>`;
  });
  // Event markers on the shared axis.
  let marks = '';
  // Chronicle jump: a bookmark flag at the moment the entry points to.
  if (ui.evoFocusT != null && ui.evoFocusT >= 0 && ui.evoFocusT <= tMax) {
    const fx = X(ui.evoFocusT).toFixed(1);
    marks += `<line x1="${fx}" y1="0" x2="${fx}" y2="20" stroke="#ffd97c" stroke-width="2" stroke-dasharray="3,2"/>`
      + `<text x="${fx}" y="10" font-size="10" text-anchor="middle">🔖</text>`;
  }
  for (const e of world.speciesLog.filter((e) => e.kind === 'split')) {
    marks += `<text x="${X(e.t).toFixed(1)}" y="14" font-size="13" text-anchor="middle">💥</text>`;
  }
  for (const e of (world.dupEvents || []).slice(-40)) {
    marks += `<text x="${X(e.t).toFixed(1)}" y="14" font-size="11" text-anchor="middle" opacity="0.85">${e.kind === 'duplication' ? '🧬' : '✂️'}</text>`;
  }
  // v0.14: teaching events — cultural inflection points on the shared axis.
  for (const e of (world.teachLog || []).slice(-60)) {
    if (e.kind === 'demo') marks += `<text x="${X(e.t).toFixed(1)}" y="14" font-size="11" text-anchor="middle" opacity="0.9">🎓</text>`;
    else if (e.kind === 'reward') marks += `<text x="${X(e.t).toFixed(1)}" y="14" font-size="9" text-anchor="middle" opacity="0.8">🌟</text>`;
    else if (e.kind === 'mode') marks += `<text x="${X(e.t).toFixed(1)}" y="14" font-size="9" text-anchor="middle" opacity="0.8">${e.mode === 'possessed' ? '✋' : '🤖'}</text>`;
  }
  const axis = [0, tMax / 2, tMax].map((t) => `<text x="${X(t).toFixed(1)}" y="${stripH + 12}" font-size="9" fill="#999" text-anchor="middle">${dayTick(t)}</text>`).join('');
  const legend = ids.slice(0, 8).map((id) => `<span style="color:${spColor(id)}">⬤ sp${id}</span>`).join(' ')
    + (ids.length > 8 ? ` <span class="tnote">+${ids.length - 8} more</span>` : '');
  const zoneLegend = zoneKeys.map((zk, zi) => `<span style="color:${zColor[zi % zColor.length]}">⬤ ${escapeHtml(zk)}</span>`).join(' ');
  const evoSvg = (inner, title) => `<div class="estrip"><div class="etitle">${title}</div>`
    + `<svg viewBox="0 0 ${W} ${stripH + 18}" width="100%" height="${stripH + 18}">${inner}${axis}</svg></div>`;
  evoPanel.innerHTML = `<div class="bp-head"><h2>📈 Evolution tracker</h2><button id="e-close">✕</button></div>
    <div class="emarkers"><svg viewBox="0 0 ${W} 20" width="100%" height="20">${marks}</svg>
      <div class="tnote">💥 speciation · 🧬 duplication · ✂️ deletion · 🎓 teaching demo · 🌟 imitation reward · ✋🤖 possession change</div></div>
    ${evoSvg(stripA, 'Species sizes over time')}
    ${evoSvg(stripB, 'Mean voice pitch per species — the dialect signature')}
    ${evoSvg(stripC, "Eliza's S for vocalPitch per zone — selection on voice")}
    <div class="elegend">${legend}</div>
    <div class="elegend">${zoneLegend}</div>`;
}

// ---- Chronicle: the world's official record ----
// Event-sourced narrative chapters; each entry jumps to the family tree,
// the evolution tracker (with a time marker), or the world view.
function renderChronicle(chronPanel, ui) {
  const world = ui.world;
  const chapters = buildChronicle(world);
  chronPanel.classList.remove('hidden');
  let html = `<div class="bp-head"><h2>📜 Chronicle</h2><button id="c-close">✕</button></div>
    <div class="tnote">The official record of this world — every line is drawn from the sim's own logs. Entries open the family tree 🌳, the evolution tracker 📈, or the world view 👁.</div>`;
  for (const ch of chapters) {
    html += `<div class="ch-chapter"><div class="ch-title">${ch.icon} ${escapeHtml(ch.title)}</div>
      <div class="ch-blurb">${escapeHtml(ch.blurb)}</div>`;
    if (!ch.entries.length) {
      html += `<div class="ch-empty">Nothing written yet — the world is still young.</div>`;
    }
    for (const e of ch.entries) {
      const jumps = (e.jumps || []).map((j) => {
        const attrs = j.tab === 'tree' ? `data-cid="${j.creatureId}"`
          : j.tab === 'evo' ? `data-t="${j.time}"`
          : j.teacher ? `data-teacher="1"` : `data-cid="${j.creatureId}"`;
        return `<button data-jtab="${j.tab}" ${attrs} title="${escapeHtml(j.title)}">${j.label}</button>`;
      }).join('');
      html += `<div class="ch-entry"><div class="ch-day">${escapeHtml(e.day)}</div>`
        + `<div class="ch-icon">${e.icon}</div>`
        + `<div class="ch-text">${escapeHtml(e.text)}</div>`
        + (jumps ? `<div class="ch-jumps">${jumps}</div>` : '') + `</div>`;
    }
    html += `</div>`;
  }
  chronPanel.innerHTML = html;
}

// ---- v0.16 "Tongues": audible calls (WebAudio) ----
// Headless-safe: everything gates on `typeof AudioContext !== 'undefined'`
// — node (test/headless/dist-smoke) never has one. The context is created
// lazily on the first user gesture (autoplay policy).
let _tongueAudio = null;
function ensureAudio() {
  if (typeof AudioContext === 'undefined') return null;
  if (!_tongueAudio) {
    try { _tongueAudio = new AudioContext(); } catch (e) { return null; }
  }
  if (_tongueAudio.state === 'suspended') _tongueAudio.resume().catch(() => {});
  return _tongueAudio;
}
function playCallSound(world, renderer, call) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  // Camera-relative volume + stereo pan — calls first, other sounds later.
  const cc = screenToWorld(renderer, renderer.canvas.width / 2, renderer.canvas.height / 2);
  const d = Math.hypot(call.x - cc.x, (call.y || 0) - cc.y);
  const vol = Math.min(1, (call.loudness || 0.5) * CALL_REF_D / Math.max(d, 40)) * 0.4;
  if (vol <= 0.01) return;
  const panV = Math.max(-1, Math.min(1, (call.x - cc.x) / 600));
  const freq = 160 + (call.pitch || 0.5) * 700;
  const dur = Math.max(0.08, Math.min(1.2, call.length || 0.3));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.85), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain);
  if (ctx.createStereoPanner) {
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(panV, t0);
    gain.connect(pan);
    pan.connect(ctx.destination);
  } else {
    gain.connect(ctx.destination);
  }
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function drainCallSounds(world, ui, renderer) {
  if (!ui.soundOn) { ui._audioCursor = world.time; return; }
  if (typeof AudioContext === 'undefined') return; // never in headless
  let played = 0;
  for (const call of world.calls) {
    if (call.t > ui._audioCursor && call.t <= world.time && played < 8) {
      playCallSound(world, renderer, call);
      played++;
    }
  }
  ui._audioCursor = world.time;
}

// ---- v0.16 "Tongues": the field-linguist's notebook ----
// Per-creature lexicon when one is selected, troop-level population view
// otherwise, plus the recent-utterance log with true contexts.
const TONGUE_CTX_ICON = { food: '🍎', alarm: '⚠️', mate: '💕', contact: '📢', come: '👉' };
function tongueWordRow(name, trend, speakers, topCtx, topPct, used, heard, conf) {
  const icon = TONGUE_CTX_ICON[topCtx] || '❔';
  return `<div class="g-row"><span class="g-word">${escapeHtml(name)}</span>`
    + `<span class="g-trend">${trend}</span>`
    + `<span class="g-spk">${speakers} 🐒</span>`
    + `<span class="g-ctx">${icon} ${Math.round(topPct * 100)}%</span>`
    + `<span class="g-n">×${used + heard}</span>`
    + `<span class="g-conf"><span class="g-confbar" style="width:${Math.round(conf * 100)}%"></span></span></div>`;
}
function tongueCreatureHtml(c) {
  const lex = c.lexicon;
  const entries = [...lex.entries].sort((a, b) => b.confidence - a.confidence);
  let html = `<div class="l-title">🗣️ ${escapeHtml(c.name)}'s lexicon — ${entries.length}/${lex.slots} words`
    + (lex.probation.length ? ` · ${lex.probation.length} candidate${lex.probation.length > 1 ? 's' : ''} on probation` : '') + `</div>`;
  if (!entries.length && !lex.probation.length) {
    return html + `<div class="ch-empty">No words yet — this one hasn't learned to talk.</div>`;
  }
  for (const e of entries.slice(0, 12)) {
    const st = entryStats(e);
    html += tongueWordRow(wordName(e.proto), '•', e.speakers || 0, st.top, st.topPct, e.used, e.heard, e.confidence);
  }
  if (lex.probation.length) {
    html += `<div class="l-title">🥚 Probation — heard ${lex.probation.map((p) => p.hearings).join(', ')}×</div>`;
    for (const p of lex.probation) {
      html += `<div class="g-row g-prob"><span class="g-word">${escapeHtml(wordName(p.proto))}</span>`
        + `<span class="g-n">heard ${p.hearings}×</span></div>`;
    }
  }
  return html;
}
function tonguePopulationHtml(world) {
  const census = world.troopWords || [];
  if (!census.length) {
    return `<div class="l-title">🌍 Troops</div><div class="ch-empty">Listening… the troop census runs every 30 seconds.</div>`;
  }
  let html = '';
  for (const t of census) {
    html += `<div class="l-title">🌍 Troop · ${t.memberCount} members ${t.words.length ? `· ${t.words.length} shared words` : '· no shared words yet'}</div>`;
    for (const w of t.words) {
      let total = 0, top = 'contact', topP = 0;
      for (const k of Object.keys(w.contexts)) {
        total += w.contexts[k];
        if (w.contexts[k] > (w.contexts[top] || 0)) top = k;
      }
      topP = total > 0 ? (w.contexts[top] || 0) / total : 0;
      html += tongueWordRow(w.name, w.trend, w.speakers, top, topP, w.total, 0, Math.min(1, w.speakers / Math.max(1, t.memberCount)));
    }
  }
  return html;
}
function tongueUtterHtml(world) {
  const log = (world.utterLog || []).slice(-12).reverse();
  if (!log.length) return `<div class="l-title">👂 Recent utterances</div><div class="ch-empty">Silence so far.</div>`;
  let html = `<div class="l-title">👂 Recent utterances — true context, straight from the sim</div>`;
  for (const u of log) {
    const icon = TONGUE_CTX_ICON[u.ctx] || '❔';
    html += `<div class="g-row"><span class="g-t">t=${Math.round(u.t)}</span>`
      + `<span class="g-word">${escapeHtml(u.name)}</span>`
      + `<span class="g-spk">${escapeHtml(u.speaker)}${u.fromTeacher ? ' 🧑‍🏫' : ''}</span>`
      + `<span class="g-ctx">${icon} ${escapeHtml(u.ctx)}</span></div>`;
  }
  return html;
}
function renderTongues(tonguePanel, ui) {
  const world = ui.world;
  const sel = ui.selected;
  tonguePanel.classList.remove('hidden');
  let html = `<div class="bp-head"><h2>📖 Tongues — the emerging lexicon</h2><button id="g-close">✕</button></div>
    <div class="tnote">No meaning is ever assigned. Each word shows inferred statistics —
    where it gets used, by whom, whether it spreads or dies — like a field linguist's notebook.
    Teacher calls 🧑‍🏫 are the Rosetta stone.</div>`;
  if (sel && sel.kind === 'creature' && sel.lexicon) html += tongueCreatureHtml(sel);
  else html += tonguePopulationHtml(world);
  html += tongueUtterHtml(world);
  tonguePanel.innerHTML = html;
}
