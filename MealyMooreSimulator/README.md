# Mealy ⇄ Moore Conversion Simulator

CSET302 Automata Theory & Computability — Simulator topic 14.

A browser-based simulator that converts a user-defined **Mealy machine into an equivalent Moore machine** (and
**Moore into Mealy**), shows every intermediate step, and **validates** that the output behaviour is preserved.

## How to run

No installation needed. Open `index.html` in any modern browser (Chrome, Edge, Firefox).

Run the automated tests (needs Node.js):

```
node tests/run-tests.js
```

## Features

| Pipeline stage (course standard) | What the simulator does |
|---|---|
| **User input** | Choose Mealy or Moore; enter Q, Σ, Δ, q₀ and fill a transition table. Six preset examples. Import/export JSON. Input is validated (missing transitions, duplicates, bad names). |
| **Algorithm** | Mealy → Moore state splitting; Moore → Mealy output shifting; optional minimization (unreachable removal + partition refinement). |
| **Step-by-step** | Play/Prev/Next through every step. Each step explains the rule applied and highlights the states/edges involved in both diagrams and in the result table. |
| **Visualization** | Side-by-side state diagrams (draggable nodes), formal 6-tuple, transition tables. |
| **Result** | Final converted machine. "Use result as input" converts it back (round-trip demo). |
| **Validation** | Run a string through both machines with synchronized traces; a test-case table (expected vs generated, pass/fail); exhaustive check of every string up to length n. |

## Formal model

Both machines are 6-tuples **M = (Q, Σ, Δ, δ, λ, q₀)** with δ : Q × Σ → Q.

- **Mealy:** λ : Q × Σ → Δ — output on transitions; |output| = |w|.
- **Moore:** λ : Q → Δ — output on states; |output| = |w| + 1 (λ(q₀) is emitted before any input).

**Equivalence:** a Mealy machine M₁ and Moore machine M₂ are equivalent if for every input w,
Moore(w) = b · Mealy(w), where b = λ(q₀) of the Moore machine. The simulator checks exactly this.

## Algorithms

### Mealy → Moore

```
for each state q in Q:
    O(q) = { λ(p, a) : δ(p, a) = q }          // outputs on incoming edges
    if O(q) is empty: O(q) = { any symbol of Δ }
    for each o in O(q): create Moore state [q, o] with λ'([q, o]) = o
q0' = any copy [q0, o]
for each new state [q, o] and each a in Σ:
    δ'([q, o], a) = [δ(q, a), λ(q, a)]
```
At most |Q| × |Δ| states.

### Moore → Mealy

```
Q' = Q,  q0' = q0,  δ' = δ
for each q in Q, a in Σ:
    λ'(q, a) = λ(δ(q, a))                     // output of the state we move into
```
Same number of states; the Moore output λ(q₀) for ε is dropped.

### Minimization (optional)

1. Remove states unreachable from q₀ (BFS).
2. P₀ = group states by output (Moore: λ(q); Mealy: row λ(q, ·)).
3. Refine: split a block if its members move to different blocks on some input. Repeat until stable.
4. Each block becomes one state.

## Manually validated example

Mealy machine, Σ = Δ = {0, 1}, start q1:

| State | 0: next / out | 1: next / out |
|---|---|---|
| → q1 | q3 / 0 | q2 / 0 |
| q2 | q1 / 1 | q4 / 0 |
| q3 | q2 / 1 | q1 / 1 |
| q4 | q4 / 1 | q3 / 0 |

**Step 1: incoming outputs.**
q1 ← (q2,0)/1, (q3,1)/1 → {1} · q2 ← (q1,1)/0, (q3,0)/1 → {0,1} · q3 ← (q1,0)/0, (q4,1)/0 → {0} ·
q4 ← (q2,1)/0, (q4,0)/1 → {0,1}.

**Step 2: split.** q1(1), q2_0(0), q2_1(1), q3(0), q4_0(0), q4_1(1): six Moore states.

**Step 3: transitions** δ'([q,o], a) = [δ(q,a), λ(q,a)]:

| State | 0 | 1 | λ |
|---|---|---|---|
| → q1 | q3 | q2_0 | 1 |
| q2_0 | q1 | q4_0 | 0 |
| q2_1 | q1 | q4_0 | 1 |
| q3 | q2_1 | q1 | 0 |
| q4_0 | q4_1 | q3 | 0 |
| q4_1 | q4_1 | q3 | 1 |

**Check with w = 0011:**
Mealy: q1 →0/0→ q3 →0/1→ q2 →1/0→ q4 →1/0→ q3 gives output **0100**.
Moore: q1(1) →0→ q3(0) →0→ q2_1(1) →1→ q4_0(0) →1→ q3(0) gives **1 0100**; dropping the first symbol gives **0100**. ✓

The same values are asserted in `tests/run-tests.js` and can be reproduced in the simulator (load the first example and run `0011`).

## Edge cases handled

- State with no incoming transitions (kept with an arbitrary output).
- Start state that must be split (first copy becomes the start).
- Empty input ε (Mealy: no output; Moore: only λ(q₀)).
- Multi-character symbols (e.g. `on`, `off`), read greedily or separated by spaces.
- Unreachable and equivalent states (removed/merged with "Minimize result").
- Incomplete or malformed machines are rejected with specific messages.

## Project structure

```
index.html          UI layout (three sections: define, convert, simulate & validate)
css/style.css       Styles (light/dark, responsive)
js/machine.js       Model, validation, conversion & minimization algorithms, simulation
js/examples.js      Preset machines and suggested test strings
js/render.js        SVG state-diagram and table rendering, node dragging
js/app.js           UI controller
tests/run-tests.js  Automated tests (hand-solved examples, edge cases, exhaustive equivalence)
```

## Limitations

- Deterministic, complete machines only (every δ(q, a) must be defined).
- Automatic layout is circular; large machines (> ~15 states) may need nodes dragged apart.
- Exhaustive validation is capped at 100,000 strings.
