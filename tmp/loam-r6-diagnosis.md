# Loam R6 — fresh-eyes diagnosis (presentation/interface layer only)

**Agent:** fresh-eyes diagnosis, never seen this artifact before. No fixes, no code changes, no metric-gating.
**Date:** 2026-10-05. **Player complaint:** the interface is still janky and the control panel needs work.
**Bar:** Paul's Canopy Sim ("Wildcode") panel — `~/workspace/your_files/canopy-sim/canopy-sim.html`, UI built in `createUI()` (line 8428). Phone-first: Joshua plays on his phone.

**How I looked:** read `~/workspace/loam-artifact/page-template.html` end to end (1136 lines — all UI chrome, camera, panel, and input handling live there); read the reference `createUI()`, `refreshPanel()` (line 9109), the speed buttons, camctl, `setSelected` follow rule, dblclick-pet, and toasts in the reference; viewed the R5-round real-browser screenshots of this exact build at `/tmp/loam-r5/` (r5-phone-4242.png, r5-phone-menu.png, r5-phone-4242-inspect.png, r5-desktop-90210-census.png — made 2026-10-05 13:11–13:13 by the R5-round worker; this is the R5 build, byte-identical to what's live). I did not re-run the page myself: my own headless-screenshot attempts in this environment produced no output (chrome `--screenshot`/`--dump-dom` hung; no file written), so eye-evidence below comes from those R5-round screenshots plus code-read. **Caveat carried from R5:** the repo SVG-shim renders the legacy terrain painter; the browser uses the round-3 painter — creature art is shared, terrain verdicts are code-read only.

R5 already fixed the sim-burst starvation, paused-camera rendering, pinch zoom, the overflow menu closing, Lab-view following selection, and species names. What's left is almost entirely interface, and it's real.

---

## TOP-3

### 1. The active speed is invisible on the phone — five tiers exist, but the phone UI can't show which one is running

**What the player feels:** you open ⋯, tap 24, close the menu — and there is no way to tell what speed the world is running at. The ⏩ LED is on for *both* 24 and 48; the ▶ LED is on for *all of* 3, 6, and 12. On the phone the only readout that ever names the tier (`12/s`) is hidden by CSS. So the phone — the device he plays on — has a speed control that answers "paused / not paused" and nothing else.

**Exact code location:**
- `~/workspace/loam-artifact/page-template.html` — `syncSpeed()` (lines 849–858): `bPlay.classList.toggle('on', state.playing && state.speedIdx <= 2)` and `bFast.classList.toggle('on', state.playing && state.speedIdx >= 3)` — the LEDs group tiers, they don't identify them.
- Lines 187–188 (phone `@media`): `#speedSeg #bSpeed { display: none; }` — the `N/s` readout is killed on the phone; the five one-tap tier buttons (`#speedRow`, lines 97–103, font-size 11px, padding 5px 8px — the smallest tap targets in the chrome) live inside the ⋯ menu.
- Line 875: `bSpeed.onclick = () => setSpeed(state.speedIdx + 1)` — the desktop cycler takes up to **four taps** to reach a specific tier (12→24→48→3→6), and it's hidden on the phone anyway.
- Line 873: `bPlay.onclick = () => { setSpeed(2); setPlaying(true); };` — ▶ doesn't resume, it *resets to 12/s*: pause at 48, tap ▶, and the world silently drops to 12 with no visible indication anything changed (on phone: none possible).

**Reference behavior that shows the better pattern:** `~/workspace/your_files/canopy-sim/canopy-sim.html` line 8451 — `⏸` / `▶` / `⏩` are three plain `data-speed` buttons, all visible at once, and the click handler (line 8499) toggles `active` on **exactly the current speed**: `b.classList.toggle('active', b === btn)`. One tap per speed, the current speed is always shown, no cycler, no hidden menu, no LED-sharing between tiers. The task's own bar says it: "(one tap, no cycler, no hidden menu)".

---

### 2. Tap-a-creature doesn't move the camera — selection and follow can disagree, and there's no jump-to-next-creature

**What the player feels:** you tap a creature; the panel opens and talks about it; the camera keeps following whoever it was following. The panel ("what am I looking at") and the camera-state chip ("📍 Twig" / "free view") can disagree indefinitely — the UI never resolves the split. Getting the camera *onto* the thing you just tapped costs a second tap on 📍 follow (or the chip), and there is no 🐒 "show me a creature" button at all: in the camera cluster, ⌂ means "recenter on the followed creature", not "recenter on the world", so a lost free-view camera has no one-tap recovery — you open 🐾 census (two taps to inspect) or drag blindly.

**Exact code location:**
- `~/workspace/loam-artifact/page-template.html` — `pointerup` tap handler, line 1066–1075: `state.selected = { kind: 'creature', id: hit.id }` — `followId` is never touched. (Census-row click, line 660: same — selection without follow.)
- Panel follow button `renderCreaturePanel()`, lines 582–600: `pFollow` toggles follow as a separate two-tap gesture.
- `#camctl` HTML, lines 231–235: ＋ / － / ⌂ only — no jump-to-next-creature; `bHome.onclick` (line 906) recenters on the *followed creature*.
- The camstate chip (line 236, updated ~line 900) does answer "what is the camera doing" and is legible in the phone screenshot — this part works. The failure is that the most natural gesture (tap the creature) doesn't drive it.

**Reference behavior that shows the better pattern:** `~/workspace/your_files/canopy-sim/canopy-sim.html` line 8525: `ui.setSelected = (obj) => { ui.selected = obj; ui.follow = !!(obj && (obj.kind === 'creature' || obj.kind === 'teacher')); }` — **selection ⇒ follow is automatic and legible**; manual drag-pan breaks follow (`ui.follow = false` on drag, line 8795). The panel then shows `📍 Following ✓` vs `📍 Follow` (line 9151). And the camera cluster (line 8486) is ＋ / － / 🐒 / ⌂, where 🐒 "Jump to the next creature" cycles the whole roster (lines 8547–8556) and ⌂ "Recenter on the whole world" (lines 8543–8546). One tap on a creature = camera on that creature, always.

---

### 3. The creature panel is read-only telemetry — no color swatch, no badges, no temperament, and nothing to *do* with the creature

**What the player feels:** you tap a creature to meet it and get a spec sheet: `stage / age "79 ticks" / doing / alive`, six deficit-framed drive bars (hunger, thirst, tiredness, fear, illness, injury), a minerals bar, then raw decimals — `reward (endogenous) -0.03`, `body size 0.53`, `leg length 0.26` — and a single 📍 follow button. There is no color swatch, no `stage · sex · mood` badges, no temperament in words, and no meaningful gesture: double-clicking a creature does nothing (the handler at line 1084 only acts on `hit.kind === 'cell'`), while double-clicking empty ground recenters the world. The panel answers "what are its numbers", not "who is it".

**Exact code location:**
- `~/workspace/loam-artifact/page-template.html` — `renderCreaturePanel()`, lines 648–606: header is `<h2>name</h2>` + species blurb + `stage/age/doing/alive` rows (lines 662–666); `DRIVE_META` (lines 455–462) frames everything as deficits; raw decimals lines 668–675 (`age ${c.age} ticks`, `reward (endogenous)`, `body size`, `leg length`); the only action is the follow button in `.p-actions` (lines 580–586).
- `dblclick` handler, lines 1084–1094: creature hits fall through silently; empty ground → `closePanel()` + `bHome` click.
- Contrast the phone screenshot (`/tmp/loam-r5/r5-phone-4242-inspect.png`): the panel fills the whole phone screen (width `calc(100vw - 28px)`, top 130px, line 243) yet its content is telemetry, and the follow button is the only interactive element.

**Reference behavior that shows the better pattern:** `~/workspace/your_files/canopy-sim/canopy-sim.html` `refreshPanel()`, lines 9118–9164: color swatch + NAME + ✕ close, `badges` line (`stage · sex · mood`), zone, labeled bars (🍽️ Satiation / ⚡ Energy / 🎾 Fun / 💕 Company / 🏥 Health — satiation-framed, not deficits), temperament **in words** (`temperament(c)`, line 9144), a `"Now: <doing>"` line (line 9147), and four actions: `💕 Pet / 😠 Scold / 👉 Nudge / 📍 Following ✓`. Double-click on a creature is pet (lines 8852–8858): `petCreature(hit.obj); toast('💕 You pet ${name}.')` — one meaningful gesture with toast feedback. The reference panel is a creature card; Loam's is a lab readout.

---

## Also noticed (below the top-3, concrete)

4. **The panel refreshes at 2.5Hz and rebuilds its entire DOM every cycle — taps on ✕/follow can land on a dead node.** `refreshPanel()` (lines 665–672): `lastPanelWall` gates at 400ms and every refresh replaces `panel.innerHTML` wholesale and rebinds every `onclick`. A touch tap lasts ~100–200ms between touchstart and touchend; with a rebuild every 400ms, a meaningful fraction of taps on the 📍 follow or ✕ button can start on a node that is detached before touchend, swallowing the tap with no feedback. (Honest note: the reference does the same `innerHTML` rebuild pattern, only at 4Hz — `ui._panelAt > 250`, reference line 8977. So the reference is *more* live but shares the hazard; Loam's slower cadence makes the drive bars visibly steppy — "drives are live" reads as 2.5 steps/second.) The census side already has the right guard (`lastCensusSig` roster-signature, line 627); the creature panel doesn't.

5. **On the phone, the topbar drops the "doing" word — the activity line the topbar promises exists only on desktop.** Lines 190–191: `#followLabel { display: none; }` and `#statusLabel { display: none; }` in the phone media query, even though the `#status` title attribute (line 350) advertises "day & time of day · creatures alive · what the followed creature is doing right now". On Joshua's phone the status is just "Day 1, midday · 33 alive" (visible in `r5-phone-4242.png`). The reference keeps clock + census glanceable and puts `"Now: <doing>"` in the always-visible creature panel. The camstate chip covers *who* is followed but not *what it's doing* — on the phone that information costs opening the full-screen panel.

6. **The hint line dies after 12 seconds; the reference's is persistent.** Line 1116: `setTimeout(() => { hint.style.opacity = '0'; }, 12000)`. The reference's `#hint` (line 8478: "Click anything to inspect it · drag creatures & toys · double-click to pet · …") has no fade. A returning player who missed the first twelve seconds gets no re-teaching — and the hint is the only place that documents the gestures.

---

## Point-by-point against the six checks

**(a) Speed control — every speed one tap and always visible, or hidden in a menu/cycler?**
Hidden on the phone, cycler on desktop — see complaint #1. Phone: ⏸/▶/⏩ visible (good), but tiers 3/6/12/24/48 and the active-tier indicator are two taps deep in ⋯; the ▶ LED covers three tiers and ⏩ covers two. Desktop: the `N/s` readout cycles with up to 4 taps per specific tier. Reference: all speeds one tap, `active` on exactly the current one.

**(b) Camera cluster — always-visible, glanceable?**
Partially. ＋/－/⌂ are always visible bottom-left at 40×40px (fine touch targets) and the camstate chip always answers "what is the camera doing" (legible in the phone screenshot: "📍 Twig"). Missing vs the reference: the 🐒 jump-to-next-creature button, and ⌂ means "recenter on followed creature" rather than "recenter on world" — a lost free camera has no one-tap recovery.

**(c) Selection→follow legibility — does the UI always answer "what is the camera doing right now"?**
The chip answers it, but selection can contradict it — see complaint #2. Reference: selection ⇒ follow automatically, so panel and camera can never disagree. Loam: tap selects without following; the panel talks about one creature while the camera follows another (or nothing). Drag-pan breaking follow is correctly implemented (`breakFollow()`, line ~937, toast "free view — drag to look"), matching the reference.

**(d) Panel interactions — responsive, first-try selection?**
Selection itself is generous: 48 world-px pick radius (line ~492) is ~120 CSS px on a following phone — first-try taps should land. Census rows are full-width buttons with good padding. The risk is the 400ms full-DOM rebuild swallowing taps on ✕/follow (noted in #4). No pet gesture exists at all (complaint #3).

**(e) Input latency — anything still queue behind sim work?**
From code-read, the input path looks clean: pointer handlers (`pointermove`, lines ~997–1030) do only pan math + `breakFollow()` + `renderIfPaused()`; the R5 time-slice is in place (`SIM_BUDGET_MS = 8`, `MAX_TICKS_PER_FRAME = 10`, tickAcc shed at 1.5×tps, lines ~790–810). DOM events dispatch between JS tasks, so input can't be starved by a bounded burst. Two residual notes, both code-read only: the 8ms budget is checked *between* ticks, never preempted *within* one — a single pathological tick still holds the thread for its full duration; and `render()` runs every rAF while playing even when nothing changed (line ~778: `render()` unconditional inside `frame()`), which is pure cost, not input latency, but feeds the general "janky" feel on a phone GPU.

**(f) Information hierarchy — glanceable vs one-tap vs two-taps?**
Glanceable on the phone: day/time, population count, camera-state chip, ＋/－/⌂, hint (first 12s). One tap: pause/play/fast, census, select-a-creature, chip toggle. Two taps: follow a creature, any specific speed tier, step/lab/fire/burrows/seed (behind ⋯), inspect-via-census. Reference comparison: reference's speed and follow-state are glanceable/one-tap where Loam's are two-taps; reference's "Now: doing" is one glance where Loam's costs the panel on the phone.

---

## What I could not verify without a real browser

- **Actual input latency / frame times.** The code-read says the input path is off the sim burst, but I can't measure tap-to-paint or frame pacing without driving the page in a real browser (my headless attempts in this environment hung without producing screenshots).
- **Whether the 400ms panel rebuild actually drops taps**, and at what rate — the hazard is structural (node detached mid-tap), the frequency needs a touch device.
- **The phone topbar at real widths** — the CSS math fits at 390px, but font rendering/emoji widths vary by device; the R5 screenshot (780px wide, DPR2) shows one clean row.
- **The round-3 terrain look** — carried caveat from R5: the SVG shim renders the legacy painter, not the browser's round-3 path; my stills say nothing about what the ground/trees/sky look like live.
- **The hint fade's felt effect** — 12s fade is in code; whether it reads as "gone too soon" needs eyes on the device.

## Bottom line for the builder

The remaining interface complaints are all about *legibility of state and one-tap reach*, and Paul's panel is the right bar because it answers three questions at all times: what speed am I running (active button, always visible), what is the camera doing (selection ⇒ follow, "📍 Following ✓"), and who is this creature (swatch, badges, temperament in words, "Now: doing", one meaningful gesture). Loam currently answers all three one layer deeper or not at all — on the phone, where Joshua plays.
