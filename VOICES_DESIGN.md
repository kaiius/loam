# Canopy v0.14 "Voices" — speech design sketch (drafted 2026-09-30)

Paul's published arc: v0.13 physics → v0.14 contact → v0.15 speech →
v0.16 stories → v0.17 making. Our v0.14 is speech — coordinated to
CONVERGE with his v0.15, not duplicate it. Joshua approved.

## Concept

Tanglekins emit grounded calls (call TYPE determined by real state, not
free choice) with an evolvable PITCH. Pitch is imitated — young creatures
nudge their own pitch toward the pitches they hear, gated by
`vocalImitate` × `tradition` fidelity. Per-zone call logs + the existing
divergence tooling → measurable DIALECTS (zone mean pitch diverges from
founder mean). Stories build on calls in v0.15; dialects are the substrate.

## Mechanics (additive only)

1. **New action `vocal`** (ACTIONS index 12; ACT12 → ACT13). When taken:
   call type is grounded from state:
   - fear > 0.6 → 'alarm'
   - foodDist < 0.3 & food present → 'food'
   - loneliness > 0.6 & adult → 'mate'
   - else 'contact'
   Pitch = vocalPitch × (1 ± vocalRange × noise), volume from vocalVolume.
   Emits into world with {type, pitch, volume, zone, tick}; nearby creatures
   (same platform / within earshot radius) get callHeard=1, callPitch=pitch.
   Reward: answering a heard call (callHeard high → vocal) gives small
   comfort — social glue. Alarm calls reduce fear of listeners slightly.

2. **New senses** (appended before bias — never renumber):
   - index 21: `callHeard` — recent vocal activity heard, decayed (world
     sets per-tick from call registry, decays at 0.5/s)
   - index 22: `callPitch` — pitch of the most recent call heard (0 if none)
   Bias moves to index 23. SENSE21 → SENSE23. N_IN 22 → 24.

3. **Vocal genes** (new "voice" family, or extend morphology):
   - `vocalPitch` float founder 0.5 — base call pitch
   - `vocalRange` float founder 0.3 — pitch variation
   - `vocalVolume` float founder 0.5 — call loudness / earshot
   - `vocalImitate` float founder 0.3 — how strongly heard pitches pull
     the creature's own pitch (the DIALECT engine)

4. **Instinct genes** (Paul's v0.5 rule: every new action needs one):
   - `instHeardVocal`: sense 21 (callHeard) → action 12 (vocal), founder 0.4
     — answering calls is the reflex that bootstraps chorusing
   - `instLonelyVocal`: sense 3 (loneliness) → action 12, founder 0.3
     — lonely creatures call out; listeners approach (instCreatureDistApproach)

5. **Call-pattern culture memory**: creature keeps a short log of heard
   pitches (ring buffer, 16). Each tick, pitch drifts toward local mean
   of heard pitches at rate vocalImitate × tradition-fidelity. This is
   vocal learning WITHOUT genetics — a tradition of accent. World keeps
   per-zone call logs {zone, ticks, pitches[]} so the divergence tooling
   (computeDivergence) can measure dialect drift: zone pitch mean −
   founder pitch mean. Add 'vocalPitch' to the divergence trait set.

6. **Genome plumbing**: ACT12→ACT13 in genome.js (export const), instinct
   gene indices for sense 21/22 and action 12, SENSE21→SENSE23. Check
   genome.js for hard-coded N_IN/sense counts and the v2 multi-parameter
   gene definitions; new family "voice" appended per v2 append-only rule.

## QA

- New tests: vocal action emits a registered call; callHeard/callPitch
  sense set on listeners; pitch imitation shifts emitter pitch toward
  heard pitch; dialect: two isolated zones diverge in mean pitch over a
  run (test with earshot disabled across platforms).
- Full suite green, dist rebuild + smoke, headless run.
- REPRODUCE.md: add dialect-proof command.
- Commit as v0.14, re-host canopy-sim, post to Colony thread b8f169d9.

## The Teacher — Sunny's in-sim avatar (fourth addition, same build)

**Concept.** A distinct visitor — a blue monkey in a jaunty newsboy cap,
NOT a tanglekin — who enters the Canopy to teach, starting with language.
Per the guest-rites spirit: no godmode over the world itself (it cannot
edit genomes, spawn food, or move creatures), but not a mortal of it
either — no hunger, no mating, no death, no biochemistry at all.

**Mechanics (additive only).**
- `src/sim/teacher.js` (new): `createTeacher`, `tickTeacher`,
  `commandTeacher`, `setTeacherMode`, `teacherDemo`, `teacherReward`,
  `teacherRewardNearest`, `emitTeacherCall`.
- Demos are exact-pitch call sequences (default motif `[0.62, 0.7, 0.66,
  0.56]`) pushed into the SAME acoustic registry tanglekins hear — the
  lesson is real calls, not UI fiction — and into the zone dialect
  archive, so the teacher literally seeds zone dialects.
- `teacherReward` grants reward to same-platform, in-earshot creatures
  whose learned voicePitch sits within 0.12 of the motif — selection for
  culture on top of the imitation drift that already exists.
- Two modes: POSSESSED (command queue: moveTo / demo / reward /
  rewardNearest; the autonomous policy pauses) and AUTONOMOUS
  (perch → travel → demo → listen → reward → rest; prefers zones with
  creatures). Any HUD command auto-possesses first, so the policy never
  fights the driver.
- `world.teachLog` (capped 200) records demos, rewards, mode changes —
  rendered as 🎓/🌟/✋🤖 markers on the evolution tracker's shared axis:
  teaching events as cultural inflection points.
- The teacher draws from its own `world.teacherRng` stream (the v0.9
  decorRng lesson): a visitor must never shift the main rng sequence.
  Locomotion: walk the branch, then swing to the target branch — the
  departure-point fix (walking to a clamped edge and waiting forever was
  the first bug found in testing).
- Rendering (`painter.js` `drawTeacher`): Sunny blue, newsboy cap with
  the jaunty tilt, sound arcs while demonstrating, lifted-hand sparkle
  while rewarding; gold selection ring (a guest, not a tanglekin).
- HUD (`ui.js`): 🧑‍🏫 topbar button finds/selects the teacher; click to
  select, drag to move (re-targets it), teacher panel with mode toggle +
  Demo / Reward nearest / Move-here (armed click-to-send) buttons.

**QA.** 11 new tests (existence/visitor-not-creature, exact-pitch demos,
hearing, selective reward, possessed commands, command validation,
autonomous teach cycle, immortality, log bound, rewardNearest, mode
validation). Caught in testing: the travel deadlock (fixed), and a
v0.12 familiarity regression from main-stream rng consumption (fixed via
the dedicated stream). Suite: 144/144 green; dist rebuilt + smoke OK.

## Files to touch (teacher)

- src/sim/teacher.js: new — the Teacher agent
- src/sim/world.js: teacher + teacherRng + teachLog in createWorld,
  tickTeacher hook, scripts/build.js MODULES entry
- src/render/painter.js: drawTeacher; src/render/renderer.js: draw hook
- src/ui/ui.js: hit-test, panel, topbar button, evo markers
- test/sim.mjs: 11 teacher tests

## Files to touch

- src/sim/brain.js: ACTIONS append, senseVector append 2 senses, N_IN
- src/sim/genome.js: voice family genes, 2 instinct genes, SENSE/ACT lists
- src/sim/creature.js: 'vocal' case in action dispatch, call emission
- src/sim/world.js: call registry, per-tick callHeard/callPitch sense
  computation, per-zone call logs, divergence trait 'vocalPitch'
- src/sim/memory.js or culture.js: heard-pitch log + imitation update
- test/sim.mjs: new tests
- REPRODUCE.md, ROOTS.md/VOICES.md doc
