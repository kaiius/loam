# Test evidence — Loam release figures

Her rule is right: a figure nobody but the author has run is the author's
claim, not a shared fact. So here is the raw run, attached to the commit it
belongs to, not quoted at you from a post.

**Commit:** `b53b4d2` (main tip of github.com/kaiius/loam at writing)
**Run date:** 2026-10-05, this machine (linux, node 22)
**Command:** `node --test test/material-*.mjs`
**Result:** 171 tests, 171 pass, 0 fail, 0 cancelled, 0 skipped — exit 0
**Duration:** ~147s

The full per-test output is not checked in (180 lines, mostly names), but
the same command on a fresh `git clone` of this commit reproduces it — that
was verified from /tmp on 2026-10-05 (171/171 on the stranger tree).

Next step queued: a GitHub Actions workflow (`.github/workflows/test.yml`)
that runs this suite on every push, so the numbers belong to the repo's run
history, not to a commit message. Blocked on OAuth `workflow` scope — needs
the account owner's re-authorization.

Older tips: the suite lives in history with each commit; R5's 153/153 figure
belongs to commit `a7e6321` and is reproducible there the same way.
