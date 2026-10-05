# Loam R4 — Diagnosis: why creatures never eat minerals
(Phase 1, fresh eyes, written 2026-10-05 before any code change)

## The symptom
Zero geophagy events in 36,000 ticks across 6 A/B probe runs (probes/reactive-gate.mjs).
The reactive gate's third leg (geophagy yield ≥ 20%) passed only via bloodSugar + fruit;
the geophagy leg rests on the G4 unit test, which tests soil chemistry, not behavior.

## Four stacked failures — each sufficient alone

### D1. No mineral-deficit sense (deepest)
The brain's 46-sense vector (src/material/brain.js senseVector47, N_IN=47) has
hunger, thirst, tiredness, pain, libido... but NO mineral sense. `c.minerals`
decays on the creature object (mcreature.js:150, 0.0004/tick from 0.6) and is
never read into any sense. The geophagy action comment calls it "the mineral
drive's answer" — but there is no mineral drive the brain can feel. In a
winner-take-all argmax, action 32 can only ever fire via its 0.02 bias or
exploration noise.

### D2. The hunger→geophagy wire is backwards (real bug — R2-lean class)
genes.js: `instHungerGeo` founder 0.3 → weight (0.3−0.5)×2.4 = **−0.48**.
The comment says "Hunger nudges earth-eating; the geophagy action itself gates
on the mineral deficit, so this is a whisper, not a command" — but the number
INHIBITS it. Hungrier creatures actively avoid soil-eating. Comment says one
thing, arithmetic does another. Same defect species as the R2 lean-rounding bug.

### D3. No endogenous reward (learning can never find it)
chem.js tickChem builds reward from deficit-drive deltas in chem: hunger,
thirst, tiredness, fear, illness, injury. Minerals are not a drive — restoring
them changes no chem value → reward contribution 0 → learn() early-returns
(reward===0). Even if exploration noise fired geophagy once, the brain could
never learn to repeat it. The action is unlearnable by construction.

### D4. No consequence (the number is decorative)
`c.minerals` affects NOTHING — not bloodSugar, not illness, not injury, not
fatigue. A mineral deficit costs the creature nothing. Only readers: the
action gate itself and the render debug line. Fair physics requires the number
to DO something, or the drive is theater.

## Checked, NOT broken
- Action gate: minerals decay 0.0004/tick from 0.6 → `minerals ≤ 0.6` opens on
  tick 1. The gate is fine.
- biasM[32] = 0.02: a whisper, correctly drowned by the pinned survival drives
  (hunger→eat weight 1.2 after the starvation fix) — the bias is not the bug.
- G4 unit test: measures corpse→soil nutrient enrichment. Passes. It never
  tested creature behavior — the R3 report said so, and it was right.

### D5. The consummatory act targeted the wrong cell (found during the fix)
tryGeophagy aimed at digTargetCell — the FACING cell at body height, built for
digging walls. On the open surface that's AIR: even when the brain selected
geophagy (rare, per D1–D3), it failed silently. First behavioral check after
D1–D4 alone: 3 events on seed 31415, 0 on seed 7 in 6000 ticks. Retargeting to
the ground underfoot (the soil the creature stands on — grazing, not wall-
biting) took it to 13–18 events/run across all seeds. From a branch with no
soil below it fails honestly.

### D6. The diffusion operator leaked mass (found by the Cassini probe, R4)
tickDiffuse relaxed toward the neighbour MEAN, dividing by the per-cell
neighbour count n_i. Pairwise exchange (i,j) then contributes
(moist[j]−moist[i])·(1/n_i − 1/n_j) ≠ 0 at boundaries/air-interfaces —
measured 8.9% moisture drift over 200 ticks on a closed grid. Not a
sweep-order artifact (the operator is Jacobi/double-buffered, order-free by
construction) but a genuine conservation defect. Fixed to antisymmetric
flux (D/4)·(v_j − v_i): exactly conserving, bit-identical at interior cells.

## Fix shape (Phase 2 — fair physics, creature must choose it, deterministic)
1. Append a mineral-deficit sense (sense 46, before the bias; N_IN 47→48,
   append-only rule honored). The brain must FEEL minerals.
2. Fix instHungerGeo: founder 0.3 → 0.7 per its own comment ("hunger nudges
   earth-eating"), and add a mineral-sense→geophagy instinct gene (Paul's v0.5
   rule — the new sense needs its wire).
3. Make minerals a deficit drive in tickChem (thread through ctx): restoring
   minerals then produces endogenous reward via Grand's rule — learning can
   reinforce it. Not reward shaping; a genuine deficit drive.
4. Give minerals a consequence: mineral deficit below ~0.3 raises illness
   susceptibility (micronutrient deficiency impairs immunity — honest coupling
   into the existing illness chemistry).
5. Retarget the consummatory act: eat the ground underfoot (mouthful, cell
   stays), not the facing wall cell. From a branch it fails honestly.
6. No new RNG. No fluid dynamics. Determinism preserved.
