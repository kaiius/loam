# Loam build round 2 — build brief (2026-10-04, coordinator draft)

Joshua's directive: "Don't wait on my verdict. Keep building. Also consider ui and ue in the process."
Standing: every Loam build ships to Colony + Moltbook for feedback.

## Scope (from molt's Colony feedback + Joshua)

### SIM-A — Soil moisture drives collapse + fire
Status: per-cell `moist` (0..1) already exists in the grid (seeded by worldgen,
infiltrated from water, drives germination/stress/rot). NOT yet wired to:
1. **Burrow-collapse**: slump/collapse in process.js uses MAT_PROPS integrity
   only. Wire moisture in DETERMINISTICALLY (no RNG in the tick — sweep-order
   tie-breaking only): saturated soil loses effective integrity, e.g.
   `effIntegrity = base * (1 - 0.5*moist)` for SOIL/SAND/CLAY, so wet spans
   collapse that dry ones hold. This is the deterministic analogue of
   "burrow-collapse probability".
2. **Fire spread**: tickFire spreads `heat[i] * flammability[n] * SPREAD_K`.
   Damp it by target moisture: `* (1 - moist[n])`. Wet cells don't carry fire.
   Keep IGNITION_HEAT/HEAT_DECAY semantics; don't retune the whole fire model.

### SIM-B — Decomposition → nutrient cycling → geophagy
Status: tickRot converts DEADWOOD→SOIL when moist>0.3 (mass-conserving).
Corpses (corpses.js) just vanish when meat hits 0 — no soil enrichment.
1. Add per-cell `nutrient: Float32Array` to createGrid; include in the
   process.js snapshot/restore field list.
2. When a corpse's meat rots away, deposit nutrients into the ground cell
   below (mass-conserving: nutrients come from the dead matter, don't invent).
   Nutrient decays slowly as plants use it.
3. Geophagy (actions.js tryGeophagy): flat +0.4 minerals today. Scale the
   payoff by the target cell's nutrient content — eating near rotted corpses /
   rotted deadwood pays more. This is molt's "gives geophagy something to do".
4. Germination may consider nutrient (plants.js tryGerminate already gates on
   fertility) — only if cheap and clean.

### SIM-C — Wind: one system (global vector + per-cell noise)
Status: per-column `windU` in the sky model; `windAt(mw,x)` feeds seed
dispersal (plants.js) AND leaf sway (render.js) — but per-tree lean is pure
hash randomness (worldgen.js:340), a second system.
1. Add a GLOBAL wind vector on the sky (e.g. `sky.windU`, `sky.windV`),
   evolved slowly via the sky's OWN pinned RNG sub-stream (never the main
   stream — founder genomes/brain rolls must not shift; same seed → same sky).
2. Column `windU` relaxes toward the global (it already relaxes toward 12 —
   change the target). Vapor advection keeps working.
3. `windAt(mw, x)` returns global U + deterministic per-cell noise
   (hash-based spatial noise + slow temporal modulation; NO per-tick RNG).
   Keep the function signature.
4. Tree lean: derive from the global wind at growth time (wind-shaped trees:
   lean downwind, magnitude scales with |wind|) + small hash variation.
   Kills the "two systems" problem molt named.

### RENDER-A — Pale vertical bands: NOT z-fighting (diagnosis verdict, 2026-10-04)
DEFINITIVE: z-fighting is IMPOSSIBLE here — the page renders exclusively with
Canvas 2D (zero WebGL calls, no depth buffer). Three lines of evidence:
mechanically impossible; bands byte-identical across frames 3s apart (no
shimmer — z-fighting shimmers); bands scale with world zoom (world-space, not
screen-space).
What they ACTUALLY are: per-world-column skylight "shaft" shading — each
background air cell's color is graded by a per-column occlusion value
(solid cells counted above that column; `lit = 1 − 0.62·ao`), changing
discretely column-to-column with smoothing that doesn't hide the steps, so
adjacent columns read as venetian-blind stripes. They cluster "behind the
trunks" because trunks grow under canopy. Related defect in the same layer:
where occlusion drops below the open-sky threshold, the true sky shows
through in COARSE BLOCKY SQUARES — the sky grid's cell edges are visible as
hard rectangles.
Fix: smooth the occlusion shading CONTINUOUSLY across columns (interpolate the
lit value, don't step it per column); fix the blocky sky-grid cell edges where
open sky shows through. Evidence: /tmp/loam-diag/bands-crop.png,
loam-zoomed.png, flicker-compare.png.

### RENDER-B — Tree crowns read as soap-bubble foam (diagnosis #2)
Every crown is translucent overlapping circles with pale bokeh dots — no branch
structure, no leaf texture. Joshua's bar: "trees as real canopies." Rework the
crown rendering toward real canopy mass: layered foliage with depth, visible
branch structure feeding the leaf masses, leaf texture instead of bokeh dots.
This was a known owned FAIL (square canopies / soap-bubble clouds) — now it's
the #2 visual wrong; fix it properly.
Evidence: /tmp/loam-diag/canopy-crop.png.

### UI/UX — Control panel overhaul (diagnosis #3 + 7 concrete gaps)
The panel is a cryptic icon strip: every control unlabeled except hover
tooltips (nonexistent on touch), so a first-time viewer — Joshua on his phone
— can't tell what anything does. On 390px the bar wraps to THREE ROWS eating
~15% of the screen. Reference (the good panel):
~/workspace/your_files/canopy-sim/canopy-sim.html — labeled buttons, hint bar.
Concrete gaps to fix:
1. Label the buttons (emoji+text like the old panel, or persistent label row).
2. Restore a first-run hint bar (pan / zoom / click-to-inspect).
3. Humanize the status line: "Day N, midday" not "tick 702"; explain or legend
   the trailing activity word ("sleep"/"eat"/"seekFood").
4. Phone layout: ONE ROW — overflow menu for lesser-used controls.
5. Surface census / inspector / instruments (the differentiators, currently
   undiscoverable behind unlabeled icons).
6. The "7" seed pill: make it a real seed control or remove it from the row.
7. Camera follow indicator (the ⌂ recenters on a followed creature — show it).
Secondary: creature legibility is inconsistent — green tanglekins read well,
pink/blue ones are featureless blobs (/tmp/loam-diag/creatures-crop.png).
Fix what's broken; don't restyle for its own sake.
Evidence: /tmp/loam-diag/panel-compare.png, loam-phone.png, phone-panel-crop.png,
canopy-old.png, loam-census.png.

## Invariants (non-negotiable)
- Determinism: no RNG in the material tick; sky uses its own pinned sub-stream;
  same seed → same world, bit-identical. worldgen order is load-bearing.
- Mass conservation per ledger rules (nutrients/water donor-limited).
- Senses/actions appended, never renumbered (if any new sense is needed).
- Test suite: `node --test test/material-*.mjs` must stay 125/125+ (add tests
  for every new mechanic: moisture-collapse, moisture-fire-damping,
  corpse-nutrient deposit, geophagy-nutrient scaling, wind-lean correlation).
- Adversarial gates: clean load, EAT in-reach ≥80%, avg bloodSugar ≥0.20,
  fruit eaten ≥50 (review/adversarial-review.py in ~/workspace/loam-artifact).
- Build pipeline: `cd ~/workspace/loam-artifact && python3 bundle.py > sim-bundle.js`
  (stdout redirect is CORRECT — bundle.py writes the bundle to stdout; never
  pipe through tail) then `python3 build-page.py` → loam.html.
- Execution probes: force-select each new mechanic in a live sim and watch the
  effect happen before reporting "built". Report the run, never the claim.
- Never declare a visual fix verified on the builder's word — coordinator
  eye-checks with fresh screenshots at NEW seeds (not the build's seeds),
  day + dusk + phone viewport, zero console errors.

## Release (coordinator handles)
Commit → source zip (git archive, hash in zip comment, smoke-test extracted
tree) → remote-storage upload → Colony post + durable-references comment →
Moltbook post → watermarks → BUILD_QUEUE.md + daily log.
