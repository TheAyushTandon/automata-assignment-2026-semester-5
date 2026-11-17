/**
 * examples.js
 * Preset machines (textbook-style problems and edge cases) plus suggested
 * test strings for each. Shared by the UI and the Node test runner.
 */
(function (root) {
  'use strict';

  /** Builds a machine from a compact row table: { q: [[next, out], ...] } or { q: { out, next:[...] } }. */
  function mealy(name, inputs, outputs, start, rows, tests) {
    const m = { type: 'mealy', states: Object.keys(rows), inputs, outputs, start, delta: {}, out: {} };
    m.states.forEach((q) => {
      m.delta[q] = {}; m.out[q] = {};
      inputs.forEach((a, i) => { [m.delta[q][a], m.out[q][a]] = rows[q][i]; });
    });
    return { name, machine: m, tests };
  }

  function moore(name, inputs, outputs, start, rows, tests) {
    const m = { type: 'moore', states: Object.keys(rows), inputs, outputs, start, delta: {}, out: {} };
    m.states.forEach((q) => {
      m.delta[q] = {};
      m.out[q] = rows[q].out;
      inputs.forEach((a, i) => { m.delta[q][a] = rows[q].next[i]; });
    });
    return { name, machine: m, tests };
  }

  const EXAMPLES = [
    // Classic textbook problem (4 states → 6 Moore states).
    mealy('Mealy → Moore: classic 4-state problem', ['0', '1'], ['0', '1'], 'q1', {
      q1: [['q3', '0'], ['q2', '0']],
      q2: [['q1', '1'], ['q4', '0']],
      q3: [['q2', '1'], ['q1', '1']],
      q4: [['q4', '1'], ['q3', '0']],
    }, ['', '0', '1', '0011', '1010', '111000', '0110100']),

    // Outputs 1 whenever the last two inputs are equal.
    mealy('Mealy → Moore: detect two equal symbols in a row', ['0', '1'], ['0', '1'], 'A', {
      A: [['B', '0'], ['C', '0']],
      B: [['B', '1'], ['C', '0']],
      C: [['B', '0'], ['C', '1']],
    }, ['', '00', '01', '0110', '1100110', '000111']),

    // Edge case: start state is split; symbols are words, not characters.
    mealy('Mealy → Moore: start state gets split (multi-char symbols)', ['a', 'b'], ['x', 'y'], 's0', {
      s0: [['s0', 'x'], ['s1', 'y']],
      s1: [['s0', 'y'], ['s1', 'x']],
    }, ['', 'a', 'b', 'ab', 'ba', 'abba', 'bbbaa']),

    // Classic Moore → Mealy problem.
    moore('Moore → Mealy: classic 4-state problem', ['0', '1'], ['0', '1'], 'q0', {
      q0: { out: '0', next: ['q3', 'q1'] },
      q1: { out: '1', next: ['q1', 'q2'] },
      q2: { out: '0', next: ['q2', 'q3'] },
      q3: { out: '0', next: ['q3', 'q0'] },
    }, ['', '0', '1', '011', '0111', '1101', '10101']),

    // Residue of a binary number mod 3 (outputs 0, 1, 2).
    moore('Moore → Mealy: binary number mod 3', ['0', '1'], ['0', '1', '2'], 'r0', {
      r0: { out: '0', next: ['r0', 'r1'] },
      r1: { out: '1', next: ['r2', 'r0'] },
      r2: { out: '2', next: ['r1', 'r2'] },
    }, ['', '1', '10', '11', '101', '110', '1001', '11111']),

    // Edge case: unreachable state + equivalent states (try "Minimize result").
    moore('Moore → Mealy: unreachable & equivalent states', ['a', 'b'], ['0', '1'], 'p', {
      p: { out: '0', next: ['q', 'r'] },
      q: { out: '1', next: ['p', 'r'] },
      r: { out: '1', next: ['p', 'q'] },
      u: { out: '0', next: ['u', 'p'] },
    }, ['', 'a', 'b', 'ab', 'bb', 'abab', 'bbba']),
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;
  else root.EXAMPLES = EXAMPLES;
}(typeof window !== 'undefined' ? window : globalThis));
