/**
 * run-tests.js — automated tests for the conversion algorithms.
 * Run with:  node tests/run-tests.js
 *
 * Expected values in the "manual" tests were worked out by hand
 * (see README.md, "Manually validated example").
 */
'use strict';

const A = require('../js/machine.js');
const EXAMPLES = require('../js/examples.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function eq(actual, expected, what = 'value') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}
const mealyOut = (m, w) => A.runMealy(m, w.split('')).output.join('');
const mooreOut = (m, w) => A.runMoore(m, w.split('')).output.join('');

console.log('\nManual (hand-solved) examples');

test('Classic Mealy → Moore produces q1, q2_0, q2_1, q3, q4_0, q4_1', () => {
  const { machine: m } = A.mealyToMoore(EXAMPLES[0].machine);
  eq(m.states, ['q1', 'q2_0', 'q2_1', 'q3', 'q4_0', 'q4_1'], 'states');
  eq(m.out, { q1: '1', q2_0: '0', q2_1: '1', q3: '0', q4_0: '0', q4_1: '1' }, 'outputs');
  eq(m.delta, {
    q1: { 0: 'q3', 1: 'q2_0' },
    q2_0: { 0: 'q1', 1: 'q4_0' },
    q2_1: { 0: 'q1', 1: 'q4_0' },
    q3: { 0: 'q2_1', 1: 'q1' },
    q4_0: { 0: 'q4_1', 1: 'q3' },
    q4_1: { 0: 'q4_1', 1: 'q3' },
  }, 'transitions');
  eq(m.start, 'q1', 'start');
});

test('Classic Moore → Mealy moves λ onto edges: λ\'(q,a) = λ(δ(q,a))', () => {
  const { machine: m } = A.mooreToMealy(EXAMPLES[3].machine);
  eq(m.delta, { q0: { 0: 'q3', 1: 'q1' }, q1: { 0: 'q1', 1: 'q2' }, q2: { 0: 'q2', 1: 'q3' }, q3: { 0: 'q3', 1: 'q0' } }, 'transitions');
  eq(m.out, { q0: { 0: '0', 1: '1' }, q1: { 0: '1', 1: '0' }, q2: { 0: '0', 1: '0' }, q3: { 0: '0', 1: '0' } }, 'outputs');
});

test('Hand-traced string 0011 on the classic Mealy machine → 0100', () => {
  const src = EXAMPLES[0].machine;
  eq(mealyOut(src, '0011'), '0100', 'Mealy output');
  const { machine: moore } = A.mealyToMoore(src);
  eq(mooreOut(moore, '0011'), '10100', 'Moore output (leading λ(q0) = 1)');
});

test('Binary mod 3: 110 (= 6) ends with residue 0, 101 (= 5) with residue 2', () => {
  const src = EXAMPLES[4].machine;
  eq(mooreOut(src, '110'), '0100', 'Moore 110');
  eq(mooreOut(src, '101'), '0122', 'Moore 101');
  const { machine: mealy } = A.mooreToMealy(src);
  eq(mealyOut(mealy, '101'), '122', 'Mealy 101');
});

console.log('\nEdge cases');

test('State with no incoming transitions keeps one copy with arbitrary output', () => {
  const { machine: m } = A.mealyToMoore(EXAMPLES[1].machine);
  eq(m.states, ['A', 'B_0', 'B_1', 'C_0', 'C_1'], 'states');
  eq(m.start, 'A', 'start');
});

test('Start state that is split: the first copy becomes start', () => {
  const { machine: m } = A.mealyToMoore(EXAMPLES[2].machine);
  eq(m.states, ['s0_x', 's0_y', 's1_x', 's1_y'], 'states');
  eq(m.start, 's0_x', 'start');
});

test('Multi-character symbols are tokenized greedily and by separators', () => {
  eq(A.tokenize('abba', ['a', 'b']).tokens, ['a', 'b', 'b', 'a']);
  eq(A.tokenize('on off on', ['on', 'off']).tokens, ['on', 'off', 'on']);
  eq(A.tokenize('onoff', ['on', 'off']).tokens, ['on', 'off']);
  eq(A.tokenize('ε', ['a']).tokens, []);
  if (!A.tokenize('abc', ['a', 'b']).error) throw new Error('expected an error for unknown symbol c');
});

test('Empty input: Mealy gives ε, Moore gives only λ(q0)', () => {
  const src = EXAMPLES[0].machine;
  eq(A.runMealy(src, []).output, [], 'Mealy');
  const { machine: moore } = A.mealyToMoore(src);
  eq(A.runMoore(moore, []).output, ['1'], 'Moore');
});

test('Validation catches incomplete and malformed machines', () => {
  const bad = { type: 'mealy', states: ['p', 'p'], inputs: ['a'], outputs: [], start: 'z', delta: { p: {} }, out: {} };
  const errs = A.validate(bad);
  ['Duplicate state', 'Δ (output alphabet) is empty', 'Start state "z"', 'δ(p, a) is undefined'].forEach((s) => {
    if (!errs.some((e) => e.includes(s))) throw new Error(`missing error "${s}" in ${JSON.stringify(errs)}`);
  });
  EXAMPLES.forEach((ex) => eq(A.validate(ex.machine), [], `${ex.name} should be valid`));
});

test('Minimization removes unreachable u and merges equivalent q ≡ r', () => {
  const { machine: m } = A.convert(EXAMPLES[5].machine, { minimize: true });
  eq(m.states, ['p', 'q'], 'states');
});

console.log('\nEquivalence (all strings up to length 10)');

EXAMPLES.forEach((ex) => {
  [false, true].forEach((minimize) => {
    test(`${ex.name}${minimize ? ' + minimize' : ''}`, () => {
      const { machine: res } = A.convert(ex.machine, { minimize });
      const mealy = ex.machine.type === 'mealy' ? ex.machine : res;
      const moore = ex.machine.type === 'mealy' ? res : ex.machine;
      const r = A.checkEquivalence(mealy, moore, 10);
      if (!r.ok) throw new Error(`counterexample ${JSON.stringify(r.mismatches[0])}`);
    });
  });
});

test('Round trip Mealy → Moore → Mealy (minimized) returns to the minimal size', () => {
  EXAMPLES.filter((e) => e.machine.type === 'mealy').forEach((ex) => {
    const moore = A.mealyToMoore(ex.machine).machine;
    const back = A.convert(moore, { minimize: true }).machine;
    const orig = A.minimize(ex.machine).machine;
    eq(back.states.length, orig.states.length, `${ex.name} state count`);
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
