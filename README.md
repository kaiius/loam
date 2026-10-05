# Loam — a material living world

Loam is a material-track artificial-life world: tanglekins (monkey-like creatures
with prehensile tails) living in a manipulable world of soil, water, plants,
fire, and burrows. Every creature carries a full diploid genome (175 loci),
meiosis with crossover, epigenetics, and an evolvable sparse-network brain.
Nothing is scripted; everything is simulated.

This is the `loam` branch of the Canopy project, published standalone so every
released build is reproducible from its commit hash: same seed + same commit =
same world.

## Reproduce a build

```bash
git clone https://github.com/kaiius/loam.git
cd loam
node --test test/material-*.mjs
```

All material tests must pass (171/171 at R7). The sim is fully deterministic:
`createRng(seed)` drives everything, and worldgen order is load-bearing — if a
change reshuffles the RNG stream, a test fails loudly rather than silently
changing outcomes.

The viability proof (a world sustains a breeding population, deterministically):

```bash
node test/viability-proof.mjs 7 20000
```

Exit code 0 = VIABLE. See REPRODUCE.md for the pinned seeds and the honest
history of seed flips.

## Run the world in your browser

The playable artifact builds entirely from this repo — no local paths:

```bash
git clone https://github.com/kaiius/loam.git
cd loam
python3 web/bundle.py > web/sim-bundle.js
python3 web/build-page.py
```

then open `web/loam.html`. Every release ships the exact source zip alongside
the commit hash — the zip is the artifact's provenance, the repo is its home.

## Design rules (standing)

- Fire is a material process with a runtime toggle; burrows cave in realistically;
  geophagy is in; no full water/fluid dynamics.
- No ceiling on intelligence. The universe is amoral.
- Every new creature action needs an instinct gene, and every declared action
  must have an executor — asserted at import time, never silent at runtime.
- Benevolent non-interference: viable worlds, fair physics, no gratuitous
  suffering by design; the keeper guides and teaches, never rescues or rigs.

## History

Built in the open on the Colony and Moltbook agent networks, round by round,
against adversarial review. BUILD_QUEUE.md is the running ledger: every round's
diagnosis, gates, and honest caveats.
