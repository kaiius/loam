# Loam R7 — creature card trend instruments: fresh-eyes UI diagnosis

Target: `~/workspace/loam-artifact/page-template.html` (only this file; `loam.html` is rebuilt from it by the parent).

## What the card's bars currently show (2026-10-05, before R7)

`buildCreaturePanel` (template ~line 652) builds the panel once; `updateCreaturePanel` (~line 674)
refreshes in place. Five bars via `bar(label, v, color)` (~line 592):

- 🍽️ Satiation = 1 − hunger, 💧 Hydration = 1 − thirst, ⚡ Energy = 1 − tiredness,
  🏥 Health = chem.health or 1 − max(illness, injury), ⛏️ minerals = c.minerals.

Each bar renders **a level only**: a label and a fill percentage. There is no notion of
velocity anywhere in the card — no delta glyphs, no rate, no history. `bar()` takes no
trend argument. The panel already updates in place via `pv-bars` innerHTML (divs, never
interactive), and the one delegated click handler (`panel.addEventListener('click', …)`
bound once, ~line 614) handles `close / census / follow / pet / nudge`. The camera-chip
fix at ~line 848 (`camstateEl.textContent = \`📍 ${creatureName(fc2)} · ${speciesLabel(fc2).display}\``)
is adjacent but untouched by this work — verified as the do-not-regress constraint.

## What's missing for each ask

**Ask 1 — trend instrument per bar (cassini's decay-velocity + musefelipe's Now:/Soon: in one glyph).**
Missing: any per-bar derivative. Concretely: no history store (nothing keeps past samples
of the five values, and the code must not touch the sim — so the history has to live in
page scope), no Δvalue/Δtick computation, no ▲/▼/· glyph on the label, no numeric-rate
tooltip. The glyph thresholds don't exist anywhere; they need to be picked and documented
in a comment.

**Ask 2 — arion's "changed since you last acted".**
Missing: no act snapshot. The pet/nudge branches of the delegated handler call
`sim.petMaterialCreature(c)` / `sim.nudgeMaterialCreature(c)` and show a toast, but store
nothing about the bar values at act time. There is no `pv-since`-style line under the bars,
and no "you haven't acted on `<name>` yet" empty state. Needs hooking the snapshot into
the existing pet/nudge handler branches using the same creature id, plus a cap on stored ids.

**Ask 3 — the self-test comment (velocity shows non-response).**
Missing: no comment states arion's point. The sterile-mate connection (an action that does
nothing shows nothing moving — and that silence is the readout) exists nowhere in the
template. Needs a comment block on the trend code and one on the since-line tying it back
explicitly: exercised-ness made visible.

## Implementation shape (planned)

- Page-scope `barHist` Map: id → `{ hist: [{tick, vals:[5]}], act: {tick, vals, kind} | null }`;
  ring of last 12 samples, one sample per tick, id cap 64 with oldest-first eviction.
- `barValues(c)` helper (shared by the updater and the snapshot so the five values are
  computed in one place); `recordBarSample`, `trendGlyph(c, i)` → `[glyph, tooltip]`;
  velocity = Δvalue/Δticks scaled per 100 ticks; flat band |v| < 0.005 renders ·;
  single sample / Δticks = 0 renders ·.
- `bar(label, v, color, trend?)` — optional 4th arg keeps cell-panel call sites unchanged.
- New `pv-since` div under the bars in `buildCreaturePanel`; `renderSinceLine` updated in place.
- Snapshot call added inside the existing pet/nudge branches (same delegated handler, same id).
- Small CSS for `.trend` and `#pv-since` matching panel conventions; phone-safe sizes.
