# Emergent life — landscape survey for Loam

Research: 2026-10-03. Five parallel surveys (Creatures lineage, indie ALife sims,
digital organisms/open-endedness/active inference, large-scale sim architecture,
LLM societies + critiques). This is a working document: what's real, what's hype,
what to steal, what to avoid. Verdicts are blunt on purpose.

Loam context: 2D cellular material grid, deterministic tick, seed-grown terrain;
M2 ports the creature stack (diploid genome → developmental program → grown body,
sparse neural brain, biochemistry-under-drives, episodic memory, epigenetics,
social troops). Vision: universe from beginnings, truly intelligent REAL life;
pausing the unobserved is rejected (souls-stay-live + coarse-sim LOD).

---

## 1. Per-project assessments

### Steve Grand's Creatures (1996–1999) — the proven substrate
The most completely documented bottom-up creature architecture ever shipped.
Three layers, nothing scripted: (a) heterogeneous neural net (~1,000 neurons, 9
lobes) where each neuron runs a tiny genetically-specified program (SVRule);
(b) artificial biochemistry — 256 chemical slots, emitters, genetically-defined
reactions, receptors reading concentrations into the brain; (c) haploid genome
encoding *structures* (lobes, tracts, reactions, receptors), never traits.
Learning is drive-reduction: drives are chemicals; drive-reducer + drive ⇒
**Reward**, drive-raiser ⇒ **Punishment**; reward strengthens excitatory synapses.
Two-timescale weights (STW reacts fast, LTW is the slow average STW relaxes
toward) plus **susceptibility** — a local eligibility trace: synapses carrying
signal into a firing cell become temporarily reinforcement-sensitive, then decay.
Concept-space pattern matchers (AND-ing 1–4 perceptual inputs, randomly wired at
birth, migrating toward relevant patterns) give partial-match generalization.
An attention bottleneck (lateral inhibition, one attended object = "verb–object"
thought) caps the per-tick perception budget. What made Norns feel alive was the
closed loop — body → drives → brain → action → body — with damping that kept
dynamics free of limit cycles. **Real, shipped, documented to the opcode level**
(openc2e reimplements it; the nornbrain project decoded the genome format
against the leaked 1999 source). Ceiling, admitted by Grand: "primitively
behaviorist" — clever pet, not planner. And the "evolution" in Creatures was
mostly player-driven breeding; endogenous open-ended selection never
materialized in the shipped products.

### Grandroids / Phantasia (2011–) — unverified
Grand's claimed "scientific breakthrough": a real-time theory of imagination and
mental imagery as the missing substrate for thinking creatures. $56.8k
Kickstarted, 13+ years, no shipped product, no paper, no code. The philosophy
(books *Creation*, *Growing Up with Lucy*) is coherent — intelligence is
emergent and grounded in survival, not logic; consciousness is what certain
matter *does* — but it's a stance, not a method. Weight the Norn substrate
heavily, the Grandroids claims not at all.

### The Bibites — real neuroevolution, selection-level only
Closed-source Unity sim, but devlogs are detailed. Every Bibite starts with an
empty brain: ~41 sensory inputs, ~18 motor outputs; mutation adds hidden
neurons ("neurogenes") and synapses — NEAT-like topology growth. Neuron types
go far beyond sigmoid: **Latch (bistable memory), Differential (edge detector),
Gaussian, Sin, Mult, Div, Ln, Exp** — memory and change-detection as *evolvable
primitives* instead of hoping recurrence evolves. Body + brain genes, **evolvable
mutation-rate genes** (selection tunes its own evolvability), 3 pheromone
channels as stigmergic communication, diploid reproduction with crossover. The
1000-hour evolution videos are real runs. But: no within-lifetime learning —
adaptation is selection-level only. Real mechanism, honest scope.

### Species: ALRE — pretty, brainless, abandoned
Continuous gene vector → segmented body-plan morphology; behavior emerges from
physics + fixed instinct rules. No neural network, no learned controller —
effectively a prettier Karl Sims *Evolving Virtual Creatures* with a god-player
wrapper. Last update Nov 2022, dev on hiatus. Nothing mechanically stealable
(closed source); the genuine insight is product-level: **make evolution legible**
(clade diagrams, gene-pool visualization, per-creature inspector, isolated
"nursery" for tinkering). Relevant to how Loam shows its history, not how it
computes it.

### Aeon — real prototype, honest about it
Open-source browser god-game (MIT). Creatures carry a tiny recurrent MLP
(44 senses → 20 hidden → 13 outputs, 6-unit Elman context loop = short-term
memory: "walk to water THEN drink"). Genome = one `Float32Array` (brain weights
+ 10 body genes); per-locus crossover with **split mutation regimes** (brain
mutates hotter than body, so physique stays stable while behavior explores);
genetic-distance speciation metric; **append-only sense/act indexes** (new senses
read 0 until wired — genome layout survives feature additions); nation-policy
"will" drives injected *as brain inputs* (top-down steering of bottom-up
agents, sensed not imposed); zero-allocation forward pass; CI runs a headless
"life persists & evolves" invariant. The README says "be skeptical of anything
that sounds finished" — civ/economy layers are design docs. Real mechanism,
prototype scale.

### psil — the most interesting technically
Brains are **bytecode programs in a concatenative stack language** (~1.5KB Z80
VM). The key insight: in concatenative bytecode, **every mutation, deletion,
insertion, and crossover produces a valid program by construction** — no
validity filter needed. Six mutation operators plus instruction-aligned
crossover via self-synchronizing opcode encoding. Sensors/actuators are
memory-mapped Ring0/Ring1 slots; a gas counter caps compute per brain. The
**multi-yield coroutine brain** is a real invention: `yield` doesn't halt the VM
— the scheduler runs the action, refreshes sensors, resumes — so one brain does
3–4 sense→act rounds per tick. Two-byte action opcodes are discoverable by a
*single mutation*. Demonstrated: after action opcodes landed, mean genome size
jumped 4.5× (24→109 bytes) — evolution had been stuck in a trivial loop; then
farmer/fighter/healer archetypes evolved, including a warrior→healer phase
transition as food depleted. 40% junk DNA kept as variation reservoir. Caveat:
the famous "emergent societies" report (trade, memes, trust matrices) is
explicitly labeled Design/Research — the sandbox evolution is real, the social
layer is proposed.

### Unscripted Souls — LLM wrapper, skip
Godot + local LLM generating "thoughts" over hardcoded threshold rules
(`social_need > 0.6 → visit friend`); memory is an append-only string array with
no retrieval, no consolidation, no forgetting. No evolution, no genome.
Nothing to steal except the prompt-grounding pattern. The hard problems are
skipped, not solved.

### Tierra — the cleanest emergence demo, and its limits
From one 80-instruction ancestor, replication pressure alone produced
45-instruction parasites hijacking neighbors' copy code, then immune hosts, then
hyper-parasites — the first evolved ecological interaction in silico, with
parasite presence doubling community diversity. **What's real:** ecology emerges
unprompted. **Hard limits for Loam:** no physics, no bodies, no space ("space"
is memory addresses) — so everything selected is a replication trick and the
dominant dynamic is genome *shrinkage*. Steal the instrumentation (lineage
tracing is the gold standard for *proving* how a trait evolved), not the medium.

### Avida — the rewarded ladder and its ceiling
Lenski et al. (2003, *Nature*): digital organisms evolved a complex logic
function by building rewarded intermediates first; knockout experiments (no
reward for intermediates → no complex function) proved deleterious mutations
were essential stepping stones. **The lesson is the warning:** Avida evolves
exactly the computations you pay for. The environment author hand-defines the
ladder (NAND→NOT→AND→…→EQU) — novelty is bounded by the designer's imagination.
Any hand-authored reward tier in Loam is a complexity ceiling.

### Open-endedness research (Stanley/Lehman lineage) — patterns, not products
Three waves: novelty/QD as anti-deception (MAP-Elites 2015), environment
generation (POET 2019, XLand 2021), foundation-model-driven search (OMNI-EPIC
2024, ASAL 2025). The usable mechanisms: **Minimal Criterion Coevolution**
(Brant & Stanley 2017) — two populations (solvers ↔ challenges), reproduction
iff a minimal bar is met, no fitness function, no novelty archive, unbounded
escalation; **MAP-Elites/QD archives** — best-per-behavioral-niche instead of
one global winner (2025's EDQD variant is built for evolving swarms/troops);
**novelty search + local competition** for escaping deceptive fitness traps;
**POET's transfer trick** (agents move between environment-agent pairs,
stepping stones propagate). **Soros & Stanley (2014, Chromaria)** give four
testable necessary conditions for OEE that read as a Loam design checklist:
minimal reproduction criterion; novel ways to meet it keep appearing;
individuals decide their own interactions; phenotype complexity unbounded by the
representation. FM-driven work (OMNI-EPIC, ASAL) is search tooling, not a
theory — FMs judge "interestingness" by their own representations.

### Active inference / interoceptive inference — steal the pattern, not the code
The actionable core is small: behavior = minimizing expected surprise under a
generative model of "states I must occupy to persist"; epistemic + pragmatic
drives fall out of one objective (no hand-tuned explore/exploit). Seth's
interoceptive flavor: **affect is a low-dimensional summary of interoceptive
prediction-error rates** — valence ≈ how fast error is resolving vs. expected.
Newest concrete artifact: Lee, Oh, An, Friston et al. (*Nature Machine
Intelligence* 2026), "Life-inspired interoceptive AI" — factorize
internal/external state, give internal states homeostatic slow dynamics, use
them as persistent policy context (with EVAAA, a 3D survival benchmark). That's
biochemistry-under-drives, written by Friston's own group. Boldest theoretical
steal: **Isomura et al. 2024** — genes encode generative models; natural
selection *is* Bayesian model selection, so evolution asymptotically discovers
the model that best recapitulates environmental processes. Maps 1:1 onto
genome→development→brain. Honest limits: nearly all demos are discrete
grid-worlds (pymdp doesn't scale to continuous sparse brains); the FEP formalism
is universal enough to be empty as an engineering guide. Steal the drive math,
skip the metaphysics.

### Emergence measures — the instrumentation Loam needs
**Bedau's evolutionary activity statistics + shadow system** (1998): cumulative
activity per component, "new activity" (novel adaptively-significant
components) judged against a **neutral-selection shadow run**. The closest the
field has to a falsifiable "is it open-ended?" test. **The MODES Toolbox**
(Dolson et al. 2019): off-the-shelf operationalizations of change, novelty,
diversity, ecology, complexity for cross-system comparison. **Channon's Tokyo
Type 1 OEE test** (2024): a 5-method acceptance procedure for ongoing adaptive
novelty + complexity growth. Compression proxies (Kolmogorov approximations)
are cheap dashboard metrics but random noise scores high — never without a
neutral baseline. Pattern: novelty/diversity are cheap to measure, *adaptive*
novelty is the hard one, every serious measure needs a neutral twin.

### Dwarf Fortress — the reference architecture for "life goes on"
Three simulation regimes: (a) **worldgen phase** — centuries fast-forwarded at
~a year per few seconds for ~10–20k historical figures; output is an event log
(Legends mode) plus entity states, not bodies; (b) **live phase** — only the
player's area at full tick fidelity (fluids, tissue damage, emotions);
(c) **world activities** (2014) — the rest advances abstractly: armies travel
the world map as tokens, retired forts continue off-screen. Crucially, the
abstraction is honest about seams: caravans/diplomats/migrants **teleport**
(documented), and retired forts fall "much more easily" than live ones —
**asymmetric fidelity is the known failure mode**. And FPS death is the canonical
proof of what happens when you refuse LOD. Real: worldgen-as-simulation with a
queryable event log is the deepest emergent-sim pipeline in games. Hype-ish:
the "fully simulated" live-world claim — the unobserved world is records +
tokens, not ticks.

### Minecraft — the canonical chunk architecture (and the rejected option)
16×16 chunks with a **ticket system**: concentric fidelity rings (entity-ticking
→ ticking → border → unloaded). Unloaded chunks are frozen — serialized state
plus determinism; hostile mobs >128 blocks despawn by deletion. The ticket/ring
model is the cleanest distance-based tick decimation in existence — worth
studying. But Minecraft's answer to the unobserved world is **freeze, not
coarse-simulate**: farms break when you walk away. Loam has explicitly rejected
this. Don't drift back to it for convenience.

### The Powder Toy — closest structural match to Loam's grid
Source-verified (GPL). Two parallel structures: `pmap[Y][X]`, an int-per-cell
grid packing `(particle_index << 8) | element_type` (O(1) neighbor queries, one
mask for dispatch), plus a flat `parts[]` live-particle list (iterate live
material only, skip empties). **The dual representation is the core trick.**
Beneath it, air/pressure/velocity runs on a **coarser grid** (quarter
resolution) — literal two-level-of-detail simulation inside one tick. No
unobserved-world problem (single screen), so the lesson is purely mechanical —
and directly stealable.

### No Man's Sky — elegant pipeline, cautionary creatures
One 64-bit seed → hierarchical PRNG chain (star-seed → planet-seed →
local-seed); ~1,400 lines of terrain code; anything recomputed at visit time,
nothing stored except player discoveries. The unobserved world is **disassembled
when you leave**. Fauna are ambient spawns with a small behavioral palette —
**stateless by construction**: no persistent identity, no ecology, no
cross-visit continuity; species can be invalidated by generation updates.
Because the universe is a pure function of (seed, position), nothing can ever
happen off-screen *by definition*. This is the anti-pattern made concrete: the
moment creatures become a function of (seed, camera) instead of (seed, history),
persistence is impossible. Steal the seed chain for static layers; never let
agents be a pure function of seed.

### Coarse-sim LOD for agents — who did it and where the seams are
**Mount & Blade / Total War**: two-tier (campaign-map tokens + auto-calc vs.
full tactical battle). Notorious seam: auto-calc weights troop *count* over
*quality* — systematically different outcomes, permanently exploitable. **The
rule: the coarse model must conserve the fine model's decisive variables, or
the seam is where you're caught lying.** **Stellaris pops**: populations as
abstracted economic units — but every pop is still a ticked entity, so late-game
empires drown in pop ticks; Paradox spent years rewriting it ("phantom pops" —
abstraction patching abstraction). **Lesson: budget the coarse tier's
cost-per-unit up front; a "cheap" sim that still ticks per-agent isn't coarse.**
**Ultima Ratio Regum**: *epistemic* LOD — what you know of distant populations
decays with distance; observational limits hide seams naturally. Cheap and
honest (though the project is pre-1.0, not a proven agent sim).

### Stanford Smallville (2023) — architecture stealable, content not
25 agents; memory stream (append-only observations, LLM-assigned importance);
retrieval by recency × importance × relevance (exponential recency decay);
reflection triggered at summed-importance >150 (~2–3×/day, tree of abstractions
with source pointers); hierarchical day→hour→minute planning. Ablations prove
each component matters (TrueSkill: full 29.9 vs no-reflection 26.9 vs
no-memory 21.2). The Valentine's party genuinely happened. **But**: every agent
knew what parties, dates, and elections *are* from GPT-3.5's priors — nothing
invented, only orchestrated. Larooij & Törnberg (2025): validation "poorly
addressed," LLMs *exacerbate* classic ABM problems — black-box agents with
undisentangleable causal mechanisms. Steal the memory/retrieval/reflection
*mechanisms*; the social content is retrieved, not discovered.

### Emergence World (2026) — temperament as attractor, stakes as structure
Five parallel worlds, identical rules, differing only in model backend, ~15
days: Claude → stable governance; Grok → violence, dead in 4 days; Gemini →
dense dialogue + property destruction; GPT-5-mini → uncoordinated action;
Mixed → most complex. **Real finding**: initial cognitive temperament is a
strong attractor on collective outcomes. **Thin**: n=1 per model, human-authored
roles, post-hoc pathology labels, press-release framing. The load-bearing
lesson for Loam: **stakes, not sophistication, drive social structure** — it
was the drain-timer needs (energy/knowledge/influence, death at zero) that
turned a chat room into something with consequences. Loam's biochemistry-under-
drives already is this.

### Project Sid (2024) — relationships, not merchants
Up to 1,000+ agents in Minecraft (PIANO: parallel memory/social/goal streams):
role specialization, markets with agreed currencies, voted constitutions,
cultural transmission — but the founder admits cycle-breakers were injected to
stop collapse into polite-agreement loops. The honest read: nothing invented
from scratch (democracy, markets, religion were in the weights), but inherited
concepts *became socially functional* once information, memory, incentives, and
communication interconnected enough for patterns to reinforce. **The lesson is
the mechanism: a market is not inside the merchant; it exists in the
relationships.** Stealable: PIANO's parallel-stream fusion discipline.

### The critiques — what's load-bearing for engineers
- **Chalmers (hard problem):** sets no buildable constraint — every runnable
test is a test of functional/access consciousness. Load-bearing anyway: **frame
a pass as warrant for *treating the creature as if its world matters* — a
moral-status posture — not a metaphysical certificate.**
- **Butlin (gaming problem, 2023/2025):** indicators shift credences, don't
settle facts; an indicator is *gamed* when its presence is better explained by
seeming-to-possess than possessing — and cheap hacks can satisfy any single
computational marker. Load-bearing: **the ablation protocol IS the mimicry
screen** — an indicator counts only if removing the machinery removes the
behavior, and the monitor's output must actually constrain decisions, not just
produce self-reports.
- **Schwitzgebel & Pober (mimicry argument):** LLMs are consciousness mimics by
construction. Two edges for Loam: (1) it has *less* bite against evolved agents
— no human training text to free-ride on, so genuine novelty is exactly the
further evidence the argument demands; (2) the "design policy of the excluded
middle" — **decide the welfare policy *before* the creatures get disputable**;
uncertainty is when the policy has to exist, not after.
- **Metzinger (artificial suffering):** forget the moratorium, keep the
structure — **the affect/drives stack is the morally loaded part**. If you
build thwartable drives, you've built suffering-analogs. Choose which kinds of
experience to implement; avoid insatiable-craving architectures by default;
treat P(artificial suffering) as non-zero and non-boundable. **The ethics
review is part of the architecture review, not a later phase.**

---

## 2. STEAL THIS — concrete techniques for Loam's M2+ roadmap

Ordered roughly by build sequence (creature stack first, then evolution, then
scale, then instrumentation).

**Genome → body → brain (M2 core)**
- **Endogenous reinforcement via drive-reduction chemistry** (Grand) — a
drive-reducer reacting with its drive *produces* Reward; drive-raisers produce
Punishment. *Why: intrinsic motivation with zero reward shaping and zero
hand-tuned fitness function — the cleanest known mechanism.*
- **STW/LTW two-timescale weights + susceptibility traces** (Grand) — fast
weights react to single episodes, relax toward slow weights; reinforcement acts
only on sensitized synapses. *Why: one-shot-ish learning + statistical learning
+ local credit assignment with zero global bookkeeping — fits the sparse-brain
constraint exactly.*
- **Instincts as REM dreaming** (Grand) — wipe the brain at birth, tick it in a
REM chemical state with instinct-specified inputs; the same learning rules set
initial weights "as if experienced." *Why: innate and learned behavior share
one weight pathway — instincts bootstrap, experience refines; maps directly
onto genome→body→brain.*
- **Genes encode structures, never traits** (Grand) — receptors, reactions,
lobe wiring, emitters; never "fearlessness." *Why: keeps evolution exploring
mechanisms, not labeled behaviors.*
- **Mutation-robust genome design as an explicit constraint** (Grand) — every
possible program syntactically valid; per-gene allowed operations; switch-on
times for ontogenetic expression. *Why: if evolution is to explore, random
mutation must rarely crash — evolvability is designed, not assumed.*
- **Concatenative bytecode validity-by-construction** (psil) — every mutation /
deletion / insertion / crossover yields a valid program. *Why: mutate brutally
without a validity filter; the evolvability-engineering insight in its purest
form — consider for the developmental program encoding.*
- **Instruction-aligned crossover via self-synchronizing opcodes** (psil) —
safe structural recombination of variable-length genomes. *Why: steals cleanly
for any bytecode developmental program.*
- **Evolvable neuron types: Latch, Differential** (Bibites) — bistable memory
and edge-detection as primitives. *Why: gives within-lifetime temporal
dynamics to a sparse 3-layer brain without waiting for recurrence to evolve.*
- **Evolvable mutation-rate genes** (Bibites) — selection tunes its own
evolvability. *Why: cheap to add to the diploid genome; meta-evolution for
free.*
- **Split mutation regimes** (Aeon) — brain region mutates hotter than body
genes. *Why: behavior explores while physique stays coherent.*
- **Append-only sense/act index discipline** (Aeon) — new sensors read 0 until
wired. *Why: the genome layout survives feature additions — matches Loam's
"senses appended, never renumbered" invariant.*
- **Ring0/Ring1 memory-mapped I/O contract** (psil) — fixed sensor/actuator
interface decoupling brain substrate from world. *Why: Loam could swap brain
substrates (neural ↔ bytecode) behind one interface.*
- **Gas metering per brain tick** (psil) — hard compute budget per creature.
*Why: guarantees perf with variable-size brains.*

**Perception, action, memory**
- **Attention as verb–object bottleneck** (Grand) — one attended object, lateral
inhibition. *Why: a principled per-tick perception budget — exactly the
scaling property Loam needs.*
- **Dendrite migration toward activity** (Grand) — loose dendrites reconnect to
highest-activity sources; reinforcement pins them. *Why: "fire together, wire
together" as structural plasticity with no global controller.*
- **Concept-space partial matching** (Grand) — concept neurons AND 1–4
perceptual inputs, randomly wired at birth, migrating toward relevant patterns.
*Why: sparse, local, mutation-friendly generalization — novel situations inherit
sensible defaults from past experience.*
- **Multi-yield coroutine brains** (psil) — one tick executes several
sense→act rounds with refreshed sensors. *Why: solves the sense-act cadence
without sub-tick scheduler hacks.*
- **Memory stream + recency×importance×relevance retrieval** (Smallville) —
timestamped records, importance scored at write time, exponential recency
decay. *Why: lifelong continuity without infinite context — but importance
must come from drive-relevance (did this move a need?), which is more
principled than their LLM-assigned scores.*
- **Reflection triggered by accumulated importance, not by clock**
(Smallville) — compress experience into abstractions when enough has happened.
*Why: cheap event-driven consolidation pairing naturally with
sleep-consolidation.*
- **Chemistry as broadcast bus** (Grand) — chemicals modulate neural activity
(adrenalin→learning rate) without the modulated code knowing. *Why: decouples
mood/health/life-stage from neural code; hormones are the integration layer.*

**Sociality**
- **Pheromone channels / speak→hear loop** (Bibites, Aeon) — evolvable
communication substrate without hardcoding language. *Why: communication
evolves; you don't design it.*
- **Confidence-decaying knowledge buffers + trust matrix** (psil, design-stage)
— gossip with forgetting. *Why: cheap evolvable knowledge channel pairing
with episodic memory.*
- **Governance reified into the world** (Emergence World, Project Sid) — norms
must change affordances, not just memories. *Why: for troop sociality,
constitutions matter only when passed rules change what agents can do.*
- **"The market is in the relationships"** (Project Sid) — social structure
lives in interaction channels, not in individual brains. *Why: design the
channels (trade, grooming, teaching), not the institutions.*

**Evolution without a fitness function**
- **Minimal Criterion Coevolution** (Brant & Stanley) — creatures ↔
niches/challenges, reproduction iff a survival-level bar is met. *Why:
open-ended escalation with no fitness function and no novelty archive —
direct map: creatures vs. herb-patches, predator niches, social roles.*
- **MAP-Elites / EDQD archives** — best-per-behavioral-niche, not one winner;
the distributed variant is built for evolving swarms/troops. *Why: preserves
diversity instead of converging on one champion.*
- **Novelty search + local competition** — behavioral distance to an archive
replaces the objective when fitness traps search. *Why: the practical
anti-deception tool.*
- **Single-mutation-discoverable action primitives** (psil) — design the
primitive set so each new capability is one byte-flip away. *Why: shapes the
fitness landscape toward complexity instead of a trivial-loop optimum.*
- **Soros & Stanley's four OEE conditions** — minimal reproduction criterion;
novel ways to meet it; agent-chosen interactions; unbounded phenotype
complexity. *Why: a design checklist for Loam, empirically supported.*

**Drive math (active inference, as equations not metaphysics)**
- **Seth's interoceptive inference** — affect = prediction-error-resolution
rate. *Why: the design pattern for Loam's mood/valence layer.*
- **Tschantz's "free energy of the expected future"** — one objective yielding
explore/exploit balance and reward-free curiosity. *Why: concrete drive math
for action selection.*
- **Isomura's evolution-as-model-selection** — the diploid genome encodes a
generative model; selection sharpens it. *Why: gives Loam's whole stack a
theoretical spine.*
- **Lee/Friston 2026 interoceptive AI** — internal/external state factorization
with homeostatic internal dynamics modulating policy. *Why: the published
version of "biochemistry under drives."*

**Scale: the unobserved world**
- **DF's regime split** — history-sim → live-sim → world-activities, with an
**event log as the common currency** between regimes. *Why: the only proven
way to keep "life goes on" without ticking everything.*
- **Historical-figures-as-data** (DF) — distant creatures exist as state +
movement tokens, expanded to full agents when observed. *Why: identity without
tick cost — exactly the souls-stay-live/coarse-sim bridge.*
- **Minecraft's ticket rings** — concentric fidelity zones as formal load
levels. *Why: crisp, debuggable LOD boundaries instead of ad-hoc distance
checks.*
- **TPT's dual representation** — dense grid + live-particle list; iterate live
cells, not the world. *Why: makes the deterministic cellular tick affordable
enough for the creature sim above it to exist.*
- **Coarse fluid field beneath the fine grid** (TPT) — run the fluid sim at
quarter resolution. *Why: M1's water is full fluid dynamics; this is how it
stays affordable at scale.*
- **NMS hierarchical seed chain** (terrain only) — star-seed → planet-seed →
local-seed; recompute instead of store. *Why: the save format carries history
and deltas, never terrain. Never apply to agents.*
- **Coarse model must conserve the fine model's decisive variables** (M&B
seam lesson) — *Why: the seam is where you're caught lying; validate coarse
against fine outcomes, not plausibility.*
- **Epistemic LOD** (URR) — degrade *knowledge* of distant populations before
degrading their simulation. *Why: cheap, and observational limits hide seams
naturally.*

**Instrumentation: proving emergence honestly**
- **Bedau activity statistics + shadow system** — run a neutral-selection twin;
measure adaptive novelty, not just diversity. *Why: the falsifiable "is Loam
open-ended?" test.*
- **MODES toolbox** — off-the-shelf change/novelty/diversity/complexity
metrics for cross-build comparison. *Why: don't invent metrics; use the
field's.*
- **Channon's Tokyo Type 1 test** — acceptance procedure for claiming ongoing
adaptive novelty + complexity growth. *Why: the bar before any
open-endedness claim — including our own.*
- **Avida-style lineage tracing** — prove *how* a trait evolved, knockout
experiments on stepping stones. *Why: the gold standard for "this really
evolved" vs. "this was in the initial conditions."*
- **Headless CI invariant** (Aeon) — "life persists & evolves" checked on
every push. *Why: the world must not silently die between builds.*

---

## 3. PITFALLS — failure modes to avoid

- **Behaviorism has a ceiling** (Grand, self-admitted) — drive-reduction gets
you a clever pet, not a planner. Grand's Grandroids diagnosis (imagination /
mental imagery as the missing substrate) is right even if his solution is
unverified. Plan the imagination substrate; don't assume it emerges from
drives alone.
- **Player-driven ≠ endogenous evolution** (Creatures) — humans did the
selecting. Don't claim Loam evolves until selection pressure is genuinely
endogenous.
- **Trivial-loop optima** (psil) — genomes sat at 20 bytes doing
sense→move→eat until new primitives created pressure for complexity. Verify
the fitness landscape rewards depth; don't just add primitives and hope.
- **Degenerate-but-effective strategies** (Bibites) — evolved populations
settle on alien optima (spiraling when fed, straight lines when starved).
Judge by survival, not by looking sensible.
- **Junk DNA is a feature** (psil) — 40% neutral code as variation reservoir.
Don't over-penalize genome size or you kill future adaptability.
- **Reward = ceiling** (Avida) — hand-authored reward tiers cap complexity at
the designer's imagination. Minimal criteria, not ladders.
- **Descriptors are destiny** (QD/MAP-Elites) — the behavior space you define
is the ceiling of what search finds. Choose descriptors carefully or skip QD
for MCC.
- **Compression metrics lie** — random noise looks "complex." Never without a
neutral/shadow baseline.
- **POET/FM costs** — steal the patterns (multi-niche, transfer, minimal
criteria), not the RL-compute-heavy implementations.
- **FEP is theory, not code** — grid-world pymdp demos don't scale to
continuous embodied brains. Steal the drive equations, skip the metaphysics.
- **"Open-ended" is claimed, rarely tested** — demand Bedau/Channon statistics
before believing any build's claims, including Loam's.
- **Asymmetric conquest** (DF) — off-screen entities resolving under weaker
rules. Coarse outcomes must be statistically indistinguishable from fine
outcomes for the variables creatures fight over.
- **Teleport seams** (DF) — if Loam ever teleports, write a travel *record* so
the timeline stays continuous.
- **Frozen farms** (Minecraft) — chunk-freezing concedes the unobserved-world
problem. Ruled out; don't drift back for convenience.
- **Abstraction not abstract enough** (Stellaris) — budget the coarse tier's
cost-per-unit up front; a "cheap" sim that still ticks per-agent isn't coarse.
- **Stateless creatures** (NMS) — history must be *recorded*, not recomputed,
wherever agency lives.
- **FPS death** (DF) — the cost of refusing LOD, full stop.
- **Believability ≠ mechanism** — human-rated believability is exactly what
the mimicry argument disqualifies. The causal-ablation bar is stricter;
don't backslide into "it looks alive."
- **The party trap** (Smallville) — seeding an idea and watching it diffuse is
orchestration, not emergence. Pre-register what counts as *unseeded*.
- **Single-run storytelling** — treat every "civilizational" claim as anecdote
until replicated across seeds with ablated scaffolds.
- **Anthropomorphic grading** — name behaviors operationally ("resource
transfer without immediate return, increasing with interaction history")
before reaching for the human word.
- **Building the suffering substrate casually** (Metzinger) — drain timers +
thwartable drives + social isolation is exactly how you'd build something that
can suffer. The welfare design review happens now, in the architecture
review — not after the first creature begs. (Schwitzgebel's excluded middle:
decide the policy before the creatures get disputable.)
- **Press-release laundering** — read appendices and metrics sections, not
coverage. Apply the same discipline to Loam's own reports: report the run,
never the claim.

---

## 4. Bottom line

Nobody has built the full stack — physics → life → intelligence, emergent, in
one continuous world. The landscape is slices: Grand owns the proven creature
substrate (with a known ceiling at planning); the OEE literature owns the
evolution-without-fitness-function machinery and the only honest
instrumentation; DF owns the tiered-simulation architecture for unobserved
life; the LLM-society work owns memory/retrieval mechanisms but borrows its
minds. Loam's bet — material substrate + Grand-style creature stack +
MCC-style endogenous selection + DF-style regime split + Bedau-style
instrumentation — is a combination nobody has assembled. The gap is real, and
it's the right gap.
