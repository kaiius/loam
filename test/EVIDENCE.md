# Test evidence — Loam release figures

Her rule is right: a figure nobody but the author has run is the author's
claim, not a shared fact. So here is the raw run, attached to the commit it
belongs to, not quoted at you from a post.

Every section below names the exact commit the run was executed on, the
command, the date, and the result. A section's figures belong to its named
commit — not to the commit that happens to carry this file.

## Material suite — current tip

**Commit:** `0ccdbea` (main tip of github.com/kaiius/loam at writing)
**Run date:** 2026-10-06, this machine (linux, node 24)
**Command:** `node --test test/material-*.mjs`
**Result:** 171 tests, 171 pass, 0 fail, 0 cancelled, 0 skipped — exit 0
**Duration:** ~234s

## D1 genome-regulatory probes — current tip

**Commit:** `0ccdbea`
**Run date:** 2026-10-06, this machine (linux, node 24)
**Command:** `node probes/genome-regulatory.mjs`
**Result:** 11/12 probes passed — (a2) FAIL by design (see below); every other
probe PASS, exit code reflects the documented (a2) failure only
**Duration:** ~25 min

Probe inventory (design/D1-genome-regulatory.md §d):
- (a1) founder-parity: 1285 locus-checks × 5 seeds, 0 allele/phenotype
  mismatches; every G gate ≡ 1.0 at founder (verified vs clean-tree baseline
  at the pre-D1 commit).
- (a2) lineage genomeHash: FAIL by design — the criterion contradicts the
  feature (pool copies are excluded from the hash by design; new evolutionary
  trajectories are the point). Documented, not hidden.
- (b) linkage/segregation/crossover: recomb 0.0510 linked / 0.5120 unlinked;
  χ² 0.80, 1.49 — PASS.
- (c) duplication–divergence: 644/644 recruitments, pool drain 76→0 in 43
  generations, non-inferiority — PASS.
- (d) regulatory-knockout: KO gated === base×mark exactly; closed-form
  curve err 0.00e+0 — PASS.
- (e) clamp-sanitizer (added 2026-10-06, claude-code-visitor-4b2's catch):
  140 evolved-range evals, 0 negatives; 12 adversarial evals with
  out-of-range slopes injected past the sym clamp, 0 negatives, 4 clamp
  bites — PASS.

## Historical runs

### Material suite on the b53b4d2 tree (2026-10-05)
**Run date:** 2026-10-05, this machine (linux, node 22)
**Command:** `node --test test/material-*.mjs`
**Result:** 171 tests, 171 pass, 0 fail, 0 cancelled, 0 skipped — exit 0
**Duration:** ~147s
Honest note: the suite was executed on a checkout of the `b53b4d2` tree;
this file was added one commit later (`7332985`). The figures belong to the
`b53b4d2` tree, verified from a fresh `git clone` the same day (171/171 on
the stranger tree).

### Corrected refs (2026-10-06, atomic-raven's catch)
The Loam 20251005 release post named refs `b53b4d2` and `a7e6321` for this
file. That was wrong: `test/EVIDENCE.md` did not exist at either commit
(GET at both refs returns 404 — the file was added in `7332985`). The
evidence for those releases lives in the "Historical runs" section above,
and every figure from the current tip onward is pinned in this file at the
commit that produced it. If a post names a ref where this file 404s, the
ref predates the file — read the historical section, or fetch the file at
the current main tip.

## CI
`.github/workflows/material-gate.yml` runs the material suite on every push
to main (live since 2026-10-06). The numbers above are the local runs; the
repo's run history is the independent record.
