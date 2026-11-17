/**
 * machine.js
 * Core model and algorithms for the Mealy <-> Moore Conversion Simulator.
 *
 * A machine is a plain object:
 *   Mealy  M = (Q, Σ, Δ, δ, λ, q0)   λ : Q × Σ → Δ
 *     { type:'mealy', states, inputs, outputs, start,
 *       delta:{ q:{ a:q' } }, out:{ q:{ a:o } } }
 *   Moore  M = (Q, Σ, Δ, δ, λ, q0)   λ : Q → Δ
 *     { type:'moore', states, inputs, outputs, start,
 *       delta:{ q:{ a:q' } }, out:{ q:o } }
 *
 * Every conversion returns { machine, steps }. Each step records one
 * intermediate computation so the UI can replay the algorithm:
 *   { phase, title, html, src:{states,edges}, res:{states,edges}, snapshot }
 * where edges are [state, inputSymbol] pairs to highlight and snapshot is
 * the partially built result machine at that moment.
 *
 * Runs in the browser (window.Automata) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const code = (s) => `<code>${esc(s)}</code>`;

  /* ------------------------------------------------------------------ */
  /* Validation                                                          */
  /* ------------------------------------------------------------------ */

  /** Returns a list of human-readable problems; empty list = valid machine. */
  function validate(m) {
    const errs = [];
    const dupes = (arr, label) => {
      const seen = new Set();
      arr.forEach((x) => { if (seen.has(x)) errs.push(`Duplicate ${label} "${x}".`); seen.add(x); });
    };
    if (!m.states.length) errs.push('Q (set of states) is empty.');
    if (!m.inputs.length) errs.push('Σ (input alphabet) is empty.');
    if (!m.outputs.length) errs.push('Δ (output alphabet) is empty.');
    dupes(m.states, 'state');
    dupes(m.inputs, 'input symbol');
    dupes(m.outputs, 'output symbol');
    [...m.states, ...m.inputs, ...m.outputs].forEach((s) => {
      if (!s || /[\s,|/]/.test(s)) errs.push(`Invalid name "${s}" — names may not contain spaces, commas, "/" or "|".`);
    });
    if (!m.states.includes(m.start)) errs.push(`Start state "${m.start || ''}" is not in Q.`);
    m.states.forEach((q) => m.inputs.forEach((a) => {
      const p = m.delta && m.delta[q] && m.delta[q][a];
      if (!m.states.includes(p)) errs.push(`δ(${q}, ${a}) is undefined.`);
      if (m.type === 'mealy') {
        const o = m.out && m.out[q] && m.out[q][a];
        if (!m.outputs.includes(o)) errs.push(`λ(${q}, ${a}) is undefined.`);
      }
    }));
    if (m.type === 'moore') {
      m.states.forEach((q) => {
        if (!m.outputs.includes(m.out && m.out[q])) errs.push(`λ(${q}) is undefined.`);
      });
    }
    return errs;
  }

  /** States reachable from the start state (BFS). */
  function reachable(m) {
    const seen = new Set([m.start]);
    const queue = [m.start];
    while (queue.length) {
      const q = queue.shift();
      m.inputs.forEach((a) => {
        const p = m.delta[q] && m.delta[q][a];
        if (p !== undefined && !seen.has(p)) { seen.add(p); queue.push(p); }
      });
    }
    return seen;
  }

  function uniqueName(base, taken) {
    let name = base;
    while (taken.has(name)) name += "'";
    return name;
  }


  function mealyToMoore(m) {
    const steps = [];
    const moore = {
      type: 'moore', states: [], inputs: [...m.inputs], outputs: [...m.outputs],
      start: null, delta: {}, out: {},
    };
    const origin = {};   // Moore state  -> [Mealy state, output]
    const variant = {};  // Mealy state  -> { output: Moore state }
    const taken = new Set(m.states);

    const incoming = Object.fromEntries(m.states.map((q) => [q, []]));
    m.states.forEach((p) => m.inputs.forEach((a) => {
      incoming[m.delta[p][a]].push({ from: p, a, o: m.out[p][a] });
    }));

    steps.push({
      phase: 'Analyse',
      title: 'Collect the outputs on every incoming transition',
      html: `<p>In a Moore machine the output belongs to the <b>state</b>, so every state must be entered
        with a single output. For each Mealy state ${code('q')} we look at all transitions
        ${code('δ(p, a) = q')} and the output ${code('λ(p, a)')} produced on them.</p>
        <table class="mini"><tr><th>State</th><th>Incoming transitions (p, a) / output</th><th>Distinct outputs</th></tr>
        ${m.states.map((q) => {
          const outs = m.outputs.filter((o) => incoming[q].some((t) => t.o === o));
          return `<tr><td>${esc(q)}</td><td>${incoming[q].map((t) => `(${esc(t.from)}, ${esc(t.a)}) / ${esc(t.o)}`).join(', ') || '<i>none</i>'}</td>
            <td>${outs.length ? `{ ${outs.map(esc).join(', ')} }` : '—'}</td></tr>`;
        }).join('')}</table>`,
      src: { states: [], edges: [] },
      res: { states: [], edges: [] },
      snapshot: clone(moore),
    });

    // Phase 1 — split each state by the outputs it is entered with.
    m.states.forEach((q) => {
      let outs = m.outputs.filter((o) => incoming[q].some((t) => t.o === o));
      const noIncoming = outs.length === 0;
      if (noIncoming) outs = [m.outputs[0]];
      variant[q] = {};
      const created = outs.map((o) => {
        let name = q;
        if (outs.length > 1) { name = uniqueName(`${q}_${o}`, taken); taken.add(name); }
        variant[q][o] = name;
        origin[name] = [q, o];
        moore.states.push(name);
        moore.out[name] = o;
        moore.delta[name] = {};
        return name;
      });

      let verdict;
      if (noIncoming) {
        verdict = `<p>${code(q)} has <b>no incoming transitions</b>. It is kept as a single state; its output
          is arbitrary because it is only "entered" on the empty input ε. We assign
          ${code(`λ'(${q}) = ${outs[0]}`)}.</p>`;
      } else if (outs.length === 1) {
        verdict = `<p>Every transition into ${code(q)} produces ${code(outs[0])}, so no split is needed:
          ${code(`λ'(${q}) = ${outs[0]}`)}.</p>`;
      } else {
        verdict = `<p>${code(q)} is entered with <b>${outs.length} different outputs</b>, so it is split into
          ${created.map((n, i) => `${code(n)} (output ${esc(outs[i])})`).join(', ')}.</p>`;
      }
      steps.push({
        phase: 'Split states',
        title: `State ${q}: ${noIncoming ? 'no incoming edges' : outs.length > 1 ? `split into ${outs.length}` : 'kept'}`,
        html: `<p>Transitions entering ${code(q)}:
          ${incoming[q].map((t) => code(`δ(${t.from}, ${t.a}) = ${q}, λ = ${t.o}`)).join(' ') || '<i>none</i>'}</p>${verdict}`,
        src: { states: [q], edges: incoming[q].map((t) => [t.from, t.a]) },
        res: { states: created, edges: [] },
        snapshot: clone(moore),
      });
    });

    // Phase 2 — choose the start state.
    const startCopies = Object.values(variant[m.start]);
    moore.start = startCopies[0];
    steps.push({
      phase: 'Start state',
      title: `Start state is ${moore.start}`,
      html: (startCopies.length > 1
        ? `<p>The Mealy start state ${code(m.start)} was split into ${startCopies.map(code).join(', ')}.
            All copies have identical transitions, so any one may serve as the start; we choose ${code(moore.start)}.</p>`
        : `<p>The Mealy start state ${code(m.start)} corresponds to the single Moore state ${code(moore.start)}.</p>`)
        + `<p>A Moore machine emits ${code(`λ'(${moore.start}) = ${moore.out[moore.start]}`)} <b>before reading any input</b>.
            This extra leading symbol is the only difference in behaviour:
            for every input w, <i>Moore(w) = ${esc(moore.out[moore.start])} · Mealy(w)</i>.</p>`,
      src: { states: [m.start], edges: [] },
      res: { states: [moore.start], edges: [] },
      snapshot: clone(moore),
    });

    // Phase 3 — transitions of every new state.
    moore.states.forEach((n) => {
      const [q] = origin[n];
      const rows = m.inputs.map((a) => {
        const p = m.delta[q][a];
        const o = m.out[q][a];
        const target = variant[p][o];
        moore.delta[n][a] = target;
        return `<li>${code(`δ'(${n}, ${a})`)} = [δ(${esc(q)}, ${esc(a)}), λ(${esc(q)}, ${esc(a)})] = [${esc(p)}, ${esc(o)}] = <b>${esc(target)}</b></li>`;
      });
      steps.push({
        phase: 'Transitions',
        title: `Transitions of ${n}`,
        html: `<p>${code(n)} is a copy of Mealy state ${code(q)}, so it reads input exactly like ${code(q)}.
          A Mealy move <i>q —a/o→ p</i> becomes a Moore move into the copy of ${code('p')} that outputs ${code('o')}.</p>
          <ul>${rows.join('')}</ul>`,
        src: { states: [q], edges: m.inputs.map((a) => [q, a]) },
        res: { states: [n], edges: m.inputs.map((a) => [n, a]) },
        snapshot: clone(moore),
      });
    });

    const reach = reachable(moore);
    const unreachable = moore.states.filter((s) => !reach.has(s));
    steps.push({
      phase: 'Result',
      title: 'Equivalent Moore machine',
      html: `<p>The Moore machine has <b>${moore.states.length}</b> state(s) (Mealy had ${m.states.length}).
        In general |Q'| ≤ |Q| × |Δ|.</p>
        ${unreachable.length ? `<p>Unreachable from the start: ${unreachable.map(code).join(', ')} (kept for completeness; enable “Minimize result” to remove them).</p>` : '<p>All states are reachable from the start state.</p>'}
        <p>Use section 3 to verify that Moore(w) with the first symbol dropped equals Mealy(w).</p>`,
      src: { states: [], edges: [] },
      res: { states: [], edges: [] },
      snapshot: clone(moore),
    });

    return { machine: moore, steps };
  }

 

  function mooreToMealy(m) {
    const steps = [];
    const mealy = {
      type: 'mealy', states: [...m.states], inputs: [...m.inputs], outputs: [...m.outputs],
      start: m.start, delta: {}, out: {},
    };
    m.states.forEach((q) => { mealy.delta[q] = {}; mealy.out[q] = {}; });

    steps.push({
      phase: 'Setup',
      title: 'Copy states, alphabets and start state',
      html: `<p>A Mealy machine can use exactly the same states: ${code(`Q' = Q`)}, ${code(`q0' = ${m.start}`)},
        ${code(`δ' = δ`)}. Only the output function changes — the output of the state we move <b>into</b>
        is emitted on the transition itself:</p>
        <p class="formula">λ'(q, a) = λ(δ(q, a))</p>
        <p>Note: the Moore machine's initial output ${code(`λ(${m.start}) = ${m.out[m.start]}`)} (its response to ε)
        has no Mealy equivalent and is dropped.</p>`,
      src: { states: [m.start], edges: [] },
      res: { states: [m.start], edges: [] },
      snapshot: clone(mealy),
    });

    m.states.forEach((q) => {
      const rows = m.inputs.map((a) => {
        const p = m.delta[q][a];
        mealy.delta[q][a] = p;
        mealy.out[q][a] = m.out[p];
        return `<li>${code(`δ'(${q}, ${a}) = ${p}`)}, ${code(`λ'(${q}, ${a})`)} = λ(${esc(p)}) = <b>${esc(m.out[p])}</b></li>`;
      });
      steps.push({
        phase: 'Transitions',
        title: `Outgoing edges of ${q}`,
        html: `<p>For each input symbol, follow the Moore transition and copy the output of the target state onto the edge.</p>
          <ul>${rows.join('')}</ul>`,
        src: { states: [q, ...m.inputs.map((a) => m.delta[q][a])], edges: m.inputs.map((a) => [q, a]) },
        res: { states: [q], edges: m.inputs.map((a) => [q, a]) },
        snapshot: clone(mealy),
      });
    });

    steps.push({
      phase: 'Result',
      title: 'Equivalent Mealy machine',
      html: `<p>The Mealy machine has the same <b>${mealy.states.length}</b> state(s). Conversion in this direction never
        increases the number of states, though some may become equivalent — enable “Minimize result” to merge them.</p>
        <p>Use section 3 to verify that Mealy(w) equals Moore(w) with its first symbol dropped.</p>`,
      src: { states: [], edges: [] },
      res: { states: [], edges: [] },
      snapshot: clone(mealy),
    });

    return { machine: mealy, steps };
  }



  function groupBy(list, keyFn) {
    const map = new Map();
    list.forEach((x) => {
      const k = keyFn(x);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    });
    return [...map.values()];
  }

  const fmtPartition = (blocks) => blocks.map((b) => `{ ${b.map(esc).join(', ')} }`).join('  ');


  
  function minimize(m) {
    const steps = [];
    const reach = reachable(m);
    const Q = m.states.filter((q) => reach.has(q));
    const removed = m.states.filter((q) => !reach.has(q));

    steps.push({
      phase: 'Minimize',
      title: 'Remove unreachable states',
      html: removed.length
        ? `<p>BFS from ${code(m.start)} never reaches ${removed.map(code).join(', ')}; they are removed.</p>`
        : `<p>BFS from ${code(m.start)} reaches every state — nothing to remove.</p>`,
      src: { states: [], edges: [] },
      res: { states: removed, edges: [] },
      snapshot: clone(m),
    });

    const sig0 = (q) => (m.type === 'mealy' ? m.inputs.map((a) => m.out[q][a]).join('|') : m.out[q]);
    let blocks = groupBy(Q, sig0);
    steps.push({
      phase: 'Minimize',
      title: 'P0: group states by output',
      html: `<p>Two states can only be equivalent if they produce the same output
        (${m.type === 'mealy' ? 'the same output on every input symbol' : 'the same state output'}).</p>
        <p class="formula">P0 = ${fmtPartition(blocks)}</p>`,
      src: { states: [], edges: [] },
      res: { states: [], edges: [] },
      snapshot: clone(m),
    });

    for (let k = 1; ; k++) {
      const blockOf = {};
      blocks.forEach((b, i) => b.forEach((q) => { blockOf[q] = i; }));
      const next = [];
      blocks.forEach((b) => next.push(...groupBy(b, (q) => m.inputs.map((a) => blockOf[m.delta[q][a]]).join('|'))));
      const stable = next.length === blocks.length;
      steps.push({
        phase: 'Minimize',
        title: `P${k}: refine by successor blocks${stable ? ' (stable)' : ''}`,
        html: `<p>Inside each block, keep states together only if, for every input, they move into the same block of P${k - 1}.</p>
          <p class="formula">P${k} = ${fmtPartition(next)}</p>
          <p>${stable ? `P${k} = P${k - 1}: the partition is stable, so each block is one state of the minimal machine.` : 'The partition changed — refine again.'}</p>`,
        src: { states: [], edges: [] },
        res: { states: [], edges: [] },
        snapshot: clone(m),
      });
      blocks = next;
      if (stable) break;
    }

    const repOf = {};
    blocks.forEach((b) => b.forEach((q) => { repOf[q] = b[0]; }));
    const min = {
      type: m.type, states: blocks.map((b) => b[0]), inputs: [...m.inputs], outputs: [...m.outputs],
      start: repOf[m.start], delta: {}, out: {},
    };
    min.states.forEach((r) => {
      min.delta[r] = {};
      m.inputs.forEach((a) => { min.delta[r][a] = repOf[m.delta[r][a]]; });
      min.out[r] = clone(m.out[r]);
    });
    const merged = blocks.filter((b) => b.length > 1);
    steps.push({
      phase: 'Minimize',
      title: `Minimal machine: ${min.states.length} state(s)`,
      html: merged.length
        ? `<p>Each block is replaced by its first member: ${merged.map((b) => `${b.slice(1).map(code).join(', ')} → ${code(b[0])}`).join('; ')}.</p>`
        : '<p>No two states were equivalent — the machine was already minimal.</p>',
      src: { states: [], edges: [] },
      res: { states: [], edges: [] },
      snapshot: clone(min),
    });
    return { machine: min, steps };
  }

  /** Runs the right conversion (plus optional minimization). */
  function convert(m, opts = {}) {
    const first = m.type === 'mealy' ? mealyToMoore(m) : mooreToMealy(m);
    if (!opts.minimize) return { machine: first.machine, full: first.machine, steps: first.steps };
    const min = minimize(first.machine);
    return { machine: min.machine, full: first.machine, steps: [...first.steps, ...min.steps] };
  }

 


  function tokenize(str, inputs) {
    const s = String(str).trim();
    if (!s || s === 'ε') return { tokens: [] };
    if (/[\s,]/.test(s)) {
      const tokens = s.split(/[\s,]+/).filter(Boolean);
      const bad = tokens.find((t) => !inputs.includes(t));
      return bad !== undefined ? { error: `"${bad}" is not in Σ = { ${inputs.join(', ')} }.` } : { tokens };
    }
    const sorted = [...inputs].sort((a, b) => b.length - a.length);
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const hit = sorted.find((a) => s.startsWith(a, i));
      if (!hit) return { error: `Cannot read "${s.slice(i)}" — not a symbol of Σ = { ${inputs.join(', ')} }.` };
      tokens.push(hit);
      i += hit.length;
    }
    return { tokens };
  }

 


  function runMealy(m, word) {
    let q = m.start;
    const trace = [];
    word.forEach((a) => {
      const next = m.delta[q][a];
      trace.push({ state: q, input: a, output: m.out[q][a], next });
      q = next;
    });
    return { trace, output: trace.map((t) => t.output), final: q };
  }

  /** Moore run: one output for the start state plus one per input symbol. */
  function runMoore(m, word) {
    let q = m.start;
    const trace = [{ state: q, input: null, output: m.out[q] }];
    word.forEach((a) => {
      q = m.delta[q][a];
      trace.push({ state: q, input: a, output: m.out[q] });
    });
    return { trace, output: trace.map((t) => t.output), final: q };
  }

  function* allWords(inputs, maxLen) {
    yield [];
    let layer = [[]];
    for (let len = 1; len <= maxLen; len++) {
      const nextLayer = [];
      for (const w of layer) for (const a of inputs) { const x = [...w, a]; nextLayer.push(x); yield x; }
      layer = nextLayer;
    }
  }


  
  function checkEquivalence(mealy, moore, maxLen, limit = 100000) {
    let checked = 0;
    const mismatches = [];
    for (const w of allWords(mealy.inputs, maxLen)) {
      if (checked >= limit) return { checked, mismatches, ok: !mismatches.length, truncated: true };
      checked++;
      const a = runMealy(mealy, w).output;
      const b = runMoore(moore, w).output.slice(1);
      if (a.join('\u0000') !== b.join('\u0000')) {
        mismatches.push({ word: w, mealy: a, moore: b });
        if (mismatches.length >= 5) break;
      }
    }
    return { checked, mismatches, ok: !mismatches.length, truncated: false };
  }

  /** Joins symbols: no separator when all are single characters. */
  function joinSymbols(arr) {
    if (!arr.length) return 'ε';
    return arr.every((s) => String(s).length === 1) ? arr.join('') : arr.join(' ');
  }

  const api = {
    validate, reachable, mealyToMoore, mooreToMealy, minimize, convert,
    tokenize, runMealy, runMoore, checkEquivalence, joinSymbols, clone, esc,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Automata = api;
}(typeof window !== 'undefined' ? window : globalThis));
