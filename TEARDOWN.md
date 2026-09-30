# TEARDOWN — Canopy v0.13 "Roots" + v0.13.1 NaN fix

The teardown is the honest part: what broke, what we measured, what we
still don't know. Written for Paul and anyone else building alife —
tear it apart.

## v0.13 "Roots": what shipped

- **Plant genomes** (`src/sim/plantgenome.js`): diploid, 8 loci (yield,
  fruitSize, interval, growthRate, bitterness, waterRet, coldTol, potency),
  2 chromosomes, 1 crossover, mutation 0.008/allele. Flora coevolves:
  seed dispersal via eaters, bitterness-gated palatability, zone stress
  (arid punishes low waterRet, highland punishes low coldTol).
- **Migration friction**: homesickness drains comfort at 0.006 ×
  homesickness × dt (at full homesickness ≈ 2.5× baseline drain) —
  friction, not force. Biomes can now actually diverge.
- **Divergence metric**: `recordFounderMeans` at populate, then every 3600
  ticks S = μ_zone(adults) − μ_founders across 5 creature + 4 plant
  traits, capped 500-entry log.
- **Beautiful-mutant watch**: novel genome hashes flagged at hatch;
  a novel-genome parent that reproduces fires `beautifulMutant`.
- **Reproducibility**: `node test/viability-proof.mjs [seed] 20000` +
  `REPRODUCE.md`. 113/113 tests green.

## v0.13.1: the brain-NaN bug — root cause

**Symptom** (pre-existing, reproduced in the v0.12 baseline via
git stash): seed-21 founders showed NaN in 7/12 brain outputs by t=150;
the creature starved next to uneaten food.

**First theory (wrong):** the `learn()` Hebbian update propagating NaN
from reward/assoc/traces. Reward was finite at every tick — a tracer
confirmed it. The real cause was one level down.

**Root cause:** `decide()` (→ `forward()`) runs on a *commitment timer*
(action stretches of 0.8–2.4s), but `learn()` runs *every tick*.
`maybeGrow()` (neurogenesis) fires inside `learn()` — so a neuron could
be added to the architecture while `brain.lastAssoc`/`brain.lastOut`
still addressed the *old* layer size. The next `learn()` then read
`assoc[719]` on a 719-long vector → `undefined` → NaN, which spread
through the eligibility traces and the weights in a single tick
(observed: NaN at tick 5 in creature 2's `a2m.w`, `traces.e`, and a
whole `L0.w` row). Tracer output before the fix:

```
LEARN-TRAP: a2m.idx[0][329]=719 oob (assoc len 719) || age=5 nLayers=1 L.n=720
```

**Fix** (all in `src/sim/brain.js`, additive guards only, no behavior
change on the healthy path):
1. `learn()`: structural guard — if `lastAssoc.length !==` live layer
   size, re-run `forward()` on the cached input before the Hebbian
   update. Stale caches can never be learned from again.
2. `learn()`: non-finite reward returns early (`Math.max`/`Math.min`
   pass NaN straight through, so the old clamp was no protection).
3. `updateTraces()`: a non-finite trace resets to 0 (decay × NaN = NaN
   never recovers on its own).
4. `clampW()`: explicit finiteness check — a poisoned weight resets to
   0 instead of spreading.
5. `forward()`: non-finite senses sanitize to 0 (a dead sense reads as
   0 rather than poisoning every activation downstream).

**Verification:**
- 4 new regression tests in `test/sim.mjs`; all 4 **fail** on the
  pre-fix code (verified via `git stash`) and pass after: 113/113 green.
- 400-tick NaN tracer on seed 21: clean (was NaN at tick 5).
- Viability battery (20,000 ticks each), before → after:

| seed | before | after |
|------|--------|-------|
| 7    | VIABLE (59 alive, 276 births, 139 matings) | (battery running) |
| 99   | VIABLE (44 alive, 291 births, 149 matings) | (battery running) |
| 21   | EXTINCT (NaN trap) | **VIABLE (45 alive, 325 births, 163 matings)** |

The fix *rescued* seed 21. Full battery table lands in REPRODUCE.md.

## Honest negatives

- **Viability is still seed-dependent.** The NaN trap is fixed, but
  extinction has other doors (founder placement, carnivore cliffs,
  drought timing). The battery pins seeds 7/99/21; the rest are
  reported, not hidden.
- **Divergence metric unproven over deep time.** S is logged every 3600
  ticks, but we haven't yet watched a 100k-tick run to see whether
  zones truly speciate. The metric is instrumentation, not a result.
- **Bitterness coevolution not yet observed.** The machinery (palatability
  scaling, differential reward) is wired, but no run has yet shown
  plants evolving bitterness *in response to* herbivore pressure.
  Needs longer runs with the divergence log.
- **Homesickness rate is hand-tuned (0.006), not evolved.** It was
  calibrated to "friction, not force" by judgment. An honest version
  would let the rate itself evolve — queued.
- **No predators yet.** Camouflage, fear, and the whole
  open-trait coloration philosophy have no reader. Paul's arc runs
  v0.13 physics → v0.14 contact → v0.15 speech; our v0.14 is speech
  ("Voices") — coordinated to converge, not duplicate.

## Reproduce everything

```bash
git clone <this repo> && cd canopy
node --test test/sim.mjs            # 113/113
node test/viability-proof.mjs 21 20000
node scripts/build.js && node test/dist-smoke.mjs
```

Tear it apart. That's what the series is for.
