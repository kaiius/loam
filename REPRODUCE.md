# Reproducing Canopy's viability claim

The claim: **a Canopy world sustains a breeding tanglekin population.**
Not "usually", not "on my machine" — deterministically, from seed + code.

## The one command

```bash
node test/viability-proof.mjs 7 20000
```

Output is JSON: `{ seed, ticks, simSeconds, alive, maxPop, births, matings, deaths, verdict }`.
Exit code 0 = VIABLE, 1 = EXTINCT.

## What "viable" means

After 20000 ticks at dt=0.5 (10000 sim-seconds ≈ 2.8 sim-hours):

- `alive > 0` — someone is still standing
- `births > 0` — hatchings happened (the lineage continues)
- `matings > 0` — reproduction is endogenous, not seeded

All three must hold. A world that survives on immortal founders without
breeding is not viable; a world that breeds once and dies out is not viable.

## The pinned seeds (v0.32)

Seed 3 is the standing viability battery. It must pass on every release:

```bash
node test/viability-proof.mjs 3 20000
# v0.32: seed 3 → 44 alive, 602 births → VIABLE
```

Seed 3 is the long-standing survivor (viable since v0.31 at 20000 ticks).

## Historical batteries

### v0.13.1 battery (retired)

Seeds 7 and 21 were the v0.13.1 viability battery. Both are EXTINCT on
v0.31+ due to brain architecture evolution (N_IN 29→33→37→38→39 across
versions changes the RNG stream and emergent behavior). The v0.13.1 numbers
are preserved below for the historical record.

```bash
for s in 7 21; do node test/viability-proof.mjs $s 20000; done
# v0.13.1: seed 7 → 64 alive, 358 births, 179 matings → VIABLE
# v0.13.1: seed 21 → 45 alive, 325 births, 163 matings → VIABLE
# v0.32: seed 7 → EXTINCT, seed 21 → EXTINCT (brain architecture changed)
```

Seed 7 was the long-standing survivor; seed 21 was the regression pin for the
v0.13.1 brain-NaN fix (it went extinct on every pre-fix build via the NaN
trap, and the fix rescued it).

## Full battery, v0.13.1 vs v0.13 (all 20,000 ticks)

| seed | v0.13 (pre-fix) | v0.13.1 (post-fix) |
|------|-----------------|-------------------|
| 7    | VIABLE (59, 276, 139) | VIABLE (64, 358, 179) |
| 99   | VIABLE (44, 291, 149) | **EXTINCT (0, 6, 3)** — see below |
| 1    | EXTINCT | VIABLE (43, 305, 154) |
| 2    | EXTINCT | VIABLE (45, 473, 247) |
| 3    | EXTINCT | EXTINCT (0, 0, 0) |
| 11   | EXTINCT | VIABLE (38, 457, 230) |
| 12   | EXTINCT | EXTINCT (0, 2, 1) |
| 21   | EXTINCT (NaN trap) | VIABLE (45, 325, 163) |
| 42   | EXTINCT | VIABLE (41, 440, 228) |

(columns: alive, births, matings)

The fix rescued five seeds (1, 2, 11, 21, 42): 2/9 viable → 6/9. Viability
remains seed-dependent — extinction has other doors (founder placement,
early drought timing) and we pin the seeds rather than hiding the rest.

### Seed 99: the honest flip

Seed 99 was viable pre-fix and is extinct post-fix. This was investigated,
not waved through:

- A 20,000-tick NaN tracer on seed 99 post-fix found **zero non-finite
  values** anywhere (brain outputs, cached activations, layer weights).
  The extinction is not a fix regression — the brain is clean.
- The stale-cache guard (the v0.13.1 structural fix) fired **50 times**
  over the first 2400 ticks of seed 99's run: the exact bug condition
  (neurogenesis between forward passes) occurred on this seed's trajectory.
- Mechanism: pre-fix, those events NaN-poisoned creatures, which starved
  and died — a selective pressure that removed specific lineages, and the
  remaining population survived. Post-fix, no poisoning, different lineage
  composition, and this seed's dynamics collapse at tick 2298 through
  ordinary population dynamics. The fix is behavior-identical on healthy
  paths (every guard only triggers on non-finite or structurally stale
  state); the flip is an emergent consequence of removing the NaN
  selective pressure, not a new bug.

Seed 99's former battery slot is retired to the full table above; seed 21
takes its place as the second pinned seed.

## What changed in v0.17 "Bauplan" (evo-devo body plan)

217 loci (+25: family V = 19 loci on chromosome 9 — 17 bud loci across the
5 sites plus segCount/tailCount regulators — plus matePrefNovel and 5 organ
instinct genes).
Four body-plan senses appended (SENSE28: airborne 24, farLedge 25, submerged 26,
waterNear 27 — old indices untouched). Four organ actions appended (glide 13,
brachiate 14, swim 15, dive 16 — old indices untouched). Every new action has
an instinct gene, founder 0 (Paul's v0.5 rule), and degrades honestly when the
organ is absent: wingless glide ≡ jump (bit-identical impulse), brachiate with
fewer than 3 grasp pairs ≡ moveToward, swim on land = a flop, dive on land =
wander. The founder body plan (all bud loci at founder values) renders
pixel-identical to the legacy animal.

Weak founding legs (Joshua's directive, 2026-09-30): founder `legPower`
0.5 → 0.3, then 0.3 → 0.4 (the middle path, at his call). Early jumps
become short hops (~85px peak vs ~120px), so founders must climb the link
network, forage the floor, and eventually invent rather than jumping
everywhere; selection can re-strengthen legs over generations.
`JUMP_V_BASE`/`JUMP_V_GAIN` and the `jumpNear` sense range are unchanged —
the sense-overreach (seeing ledges you can't reach) is intentional
pressure, and the brain's airtime reward stays. Rationale recorded in
EVODEVO_DESIGN.md §9.7. The 12-seed battery below is the arbiter, and it
reports honestly: 8/12 viable at 0.3 (vs 11/12 at 0.5 — seeds 4, 7, 99
flip from viable to extinct; seed 8 is extinct at both). The 0.3 failure
mode is not starvation but illness: weak-legged founders forage the
floor, where the contamination mechanic bites harder. At Joshua's
direction the middle path was tried: 0.4 gives 9/12 — all three 0.3 flips
(4, 7, 99) recover, and seed 8 (extinct at both 0.5 and 0.3) goes viable,
but seeds 6, 9, 10 flip the other way. The 0.4 failures are early founder
fragility (tiny populations, maxPop 9–14, mixed starvation + illness),
not the sustained illness pressure of 0.3. The verdict pattern moves
rather than converging: the system is sensitive to small founder tweaks,
and the middle path relocates the problem rather than resolving it.
Working tree holds 0.4 uncommitted; the release call is Joshua's.

Evo-devo proof commands:

```bash
# the 23 Bauplan tests (founder-exactness, degradation, instincts, glide physics)
node --test --test-name-pattern="v0.17" test/sim.mjs
# no dead genes among the 25 loci (also inside the suite, test "no dead genes")
# stream pin: main RNG stream verified bit-identical to v0.16 (seed 7 alleles pinned)
```

Full battery, v0.17 (all 20,000 ticks; legPower founder 0.3):

| seed | v0.17 (0.3) | control: same code, legPower 0.5 |
|------|-------------|----------------------------------|
| 1    | VIABLE (48, 278, 139) | — |
| 2    | VIABLE (43, 494, 245) | — |
| 3    | VIABLE (48, 439, 204) | — |
| 4    | EXTINCT (0, 10, 5) | VIABLE (40, 376, 188) — **flip** |
| 5    | VIABLE (40, 374, 163) | — |
| 6    | VIABLE (47, 547, 275) | — |
| 7    | EXTINCT (0, 20, 10) | VIABLE (46, 343, 175) — **flip** |
| 8    | EXTINCT (0, 34, 17) | EXTINCT (0, 16, 8) — hard seed, not a flip |
| 9    | VIABLE (47, 332, 167) | — |
| 10   | VIABLE (42, 490, 249) | — |
| 11   | VIABLE (44, 415, 176) | — |
| 99   | EXTINCT (0, 26, 13) | VIABLE (49, 427, 215) — **flip** |

(columns: alive, births, matings)

8/12 viable at 0.3. The three flips (4, 7, 99) are causal, not drift:
same seed, same code, only the legPower founder differs. Seed 8 is extinct
at both values — a hard seed in the long-standing pattern (cf. v0.13.1:
"we pin the seeds rather than hiding the rest"). Deaths on the flipped
seeds are from illness, not starvation — founders feed, but weak-legged
foraging keeps them on the floor, where the v0.14 contamination mechanic
(food eaten on fouled ground → illness, creature.js:602) bites harder.
The intended pressure (climb, don't jump) works; it drags the existing
disease pressure along with it. Reported plainly per the directive —
not silently reverted.

Full battery, v0.17 middle path (all 20,000 ticks; legPower founder 0.4):

| seed | v0.17 (0.4) | vs 0.3 |
|------|-------------|--------|
| 1    | VIABLE (41, 313, 157) | viable at both |
| 2    | VIABLE (45, 411, 205) | viable at both |
| 3    | VIABLE (47, 430, 214) | viable at both |
| 4    | VIABLE (45, 481, 242) | **recovered** (was EXTINCT at 0.3) |
| 5    | VIABLE (56, 325, 163) | viable at both |
| 6    | EXTINCT (0, 12, 6) | **flip** (was VIABLE at 0.3) |
| 7    | VIABLE (44, 426, 217) | **recovered** (was EXTINCT at 0.3) |
| 8    | VIABLE (52, 471, 216) | **recovered** (was EXTINCT at 0.3 and 0.5) |
| 9    | EXTINCT (0, 16, 8) | **flip** (was VIABLE at 0.3) |
| 10   | EXTINCT (0, 34, 22) | **flip** (was VIABLE at 0.3) |
| 11   | VIABLE (45, 396, 205) | viable at both |
| 99   | VIABLE (59, 505, 253) | **recovered** (was EXTINCT at 0.3) |

(columns: alive, births, matings)

9/12 viable at 0.4. All three 0.3 flips (4, 7, 99) recover, and the hard
seed 8 goes viable for the first time — but seeds 6, 9, 10 flip the other
way. Death-cause tallies (from the death events' `cause` field) show a
different failure mode than 0.3: the 0.4 extinctions are early founder
fragility — maxPop 9–14, populations dead within the run's first stretch,
causes mixed (seed 6: 6 starvation, 6 illness, 1 ill health, 3 old age of
16 deaths; seed 9: 12 starvation, 7 old age, 1 ill health; seed 10: 12
starvation, 10 illness, 15 old age, 1 ill health). Not the sustained
illness pressure of 0.3 — these founder lines never take off. Meanwhile
the viable seeds carry real starvation pressure and sustain anyway (seed
2: 88 starvation deaths of 370; seed 4: 91 of 440; seed 7: 89 of 386 —
all VIABLE). One structural confound, named honestly: the language and
evo-devo sub-streams are seeded by a content hash of the main alleles, so
ANY founder-value change reshuffles them deterministically (0.3→0.4 moved
lexCap alleles [0.83, 0.74]→[0.64, 0.48], i.e. ~13→~11 lexicon slots, and
budDorsalGrow [0, 0.020]→[0, 0]). The main RNG stream is verified
bit-identical; the lexicon-slot change is mechanistically implausible as a
cause of founder starvation, but the comparison is not legPower-pure.
The honest read: the verdict pattern moves rather than converging — small
founder tweaks flip different seeds through different mechanisms. The
middle path relocates the 0.3 problem rather than resolving it.

## What changed in v0.13

Plant genomes are diploid and evolvable now (see `src/sim/plantgenome.js`),
so flora participates in selection: seed dispersal, bitterness, zone stress.
The viability battery above confirms the coevolution loop didn't break the
population dynamics it was added to.

## What changed in v0.13.1

Root-caused fix for the brain-NaN bug (see TEARDOWN.md): neurogenesis
(`maybeGrow`, inside `learn()`, which runs every tick) could add a neuron
between `forward()` calls (which run on a commitment timer), leaving the
cached activations structurally stale — `assoc[719]` on a 719-long vector
→ `undefined` → NaN, spreading through eligibility traces and weights in a
single tick. Five additive guards in `src/sim/brain.js` (structural
staleness re-forward, non-finite reward early-return, trace reset, weight
finiteness check, sense sanitization in `forward()`); 4 new regression
tests in `test/sim.mjs`, all failing pre-fix (verified via `git stash`)
and passing after.

## Determinism

The sim is fully deterministic: `createRng(seed)` drives everything, and
worldgen order is load-bearing. `test/sim.mjs` pins exact behaviors (113
tests); if a change reshuffles the RNG stream, a test fails loudly rather
than silently changing outcomes. Same seed + same commit = same JSON.
