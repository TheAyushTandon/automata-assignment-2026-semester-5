/**
 * app.js
 * UI controller: machine editor (section 1), step-by-step conversion
 * playback (section 2), simulation and validation (section 3).
 * Enhanced with custom fluid dropdowns and theme management.
 */
(function () {
  'use strict';

  const A = window.Automata;
  const R = window.Render;
  const { esc } = A;
  const $ = (id) => document.getElementById(id);

  const S = {
    draft: emptyMachine('mealy'), // machine being edited in section 1
    src: null,                    // machine that was converted
    result: null,                 // final converted (maybe minimized) machine
    steps: [],
    idx: 0,
    vSrc: null,                   // diagram views (positions + viewBox)
    vRes: null,
    fullStates: [],               // result states before minimization (for layout)
    timer: null,
    sim: null,                    // { tokens, a:run, b:run, pos }
  };

  function emptyMachine(type) {
    return { type, states: [], inputs: [], outputs: [], start: '', delta: {}, out: {} };
  }

  const parseList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const other = (t) => (t === 'mealy' ? 'moore' : 'mealy');
  const title = (t) => (t === 'mealy' ? 'Mealy' : 'Moore');

  /* ================================================================== */
  /* Theme Management — Dark Mode Only                                   */
  /* ================================================================== */

  function initTheme() {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('automata-theme', 'dark'); } catch (_) {}
  }

  /* ================================================================== */
  /* Custom Fluid Dropdown Component                                    */
  /* ================================================================== */

  function createCustomSelect(select) {
    if (!select || select.dataset.hasCustom) return;
    select.dataset.hasCustom = 'true';
    select.classList.add('custom-select-hidden');

    const container = document.createElement('div');
    container.className = 'custom-select-container';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    const textSpan = document.createElement('span');
    textSpan.className = 'custom-select-text';

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'custom-select-chevron');
    chevron.setAttribute('viewBox', '0 0 20 20');
    chevron.setAttribute('fill', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('d', 'M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z');
    path.setAttribute('clip-rule', 'evenodd');
    chevron.appendChild(path);

    btn.appendChild(textSpan);
    btn.appendChild(chevron);

    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';
    dropdown.setAttribute('role', 'listbox');

    container.appendChild(btn);
    container.appendChild(dropdown);
    select.parentNode.insertBefore(container, select.nextSibling);

    let activeIndex = -1;

    function buildOptions() {
      dropdown.innerHTML = '';
      const opts = Array.from(select.options);
      opts.forEach((o, idx) => {
        const item = document.createElement('div');
        const isSelected = o.value === select.value;
        item.className = `custom-select-item${isSelected ? ' selected' : ''}`;
        item.setAttribute('role', 'option');
        item.dataset.value = o.value;
        item.dataset.idx = String(idx);
        item.textContent = o.textContent || o.value;

        if (isSelected) {
          const check = document.createElement('span');
          check.className = 'custom-select-check';
          check.textContent = '✓';
          item.appendChild(check);
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          select.value = o.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          closeMenu();
          btn.focus();
        });

        dropdown.appendChild(item);
      });
      syncDisplay();
    }

    function syncDisplay() {
      const selectedOpt = select.options[select.selectedIndex];
      textSpan.textContent = selectedOpt ? (selectedOpt.textContent || selectedOpt.value) : (select.value || '—');
      Array.from(dropdown.children).forEach((item) => {
        const isSel = item.dataset.value === select.value;
        item.classList.toggle('selected', isSel);
        const existingCheck = item.querySelector('.custom-select-check');
        if (isSel && !existingCheck) {
          const check = document.createElement('span');
          check.className = 'custom-select-check';
          check.textContent = '✓';
          item.appendChild(check);
        } else if (!isSel && existingCheck) {
          existingCheck.remove();
        }
      });
    }

    function openMenu() {
      syncDisplay();
      document.querySelectorAll('.custom-select-container.open').forEach((c) => {
        if (c !== container) {
          c.classList.remove('open');
          const otherBtn = c.querySelector('.custom-select-btn');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });
      container.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');

      // Check if button is near bottom of viewport to open upward
      const rect = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 220 && rect.top > 220) {
        dropdown.classList.add('open-up');
      } else {
        dropdown.classList.remove('open-up');
      }

      // Check if dropdown is near right edge of viewport
      if (rect.right > window.innerWidth - 180 || rect.left > window.innerWidth * 0.65) {
        dropdown.classList.add('align-right');
      } else {
        dropdown.classList.remove('align-right');
      }

      const sel = dropdown.querySelector('.custom-select-item.selected');
      if (sel) {
        sel.scrollIntoView({ block: 'nearest' });
      }
    }

    function closeMenu() {
      container.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      dropdown.classList.remove('open-up', 'align-right');
      dropdown.querySelectorAll('.custom-select-item.focused').forEach((el) => el.classList.remove('focused'));
      activeIndex = -1;
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (container.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    btn.addEventListener('keydown', (e) => {
      const items = Array.from(dropdown.children);
      if (!items.length) return;

      if (e.key === 'ArrowDown' || e.key === 'Down') {
        e.preventDefault();
        if (!container.classList.contains('open')) openMenu();
        activeIndex = Math.min(items.length - 1, activeIndex + 1);
        highlightItem(items);
      } else if (e.key === 'ArrowUp' || e.key === 'Up') {
        e.preventDefault();
        if (!container.classList.contains('open')) openMenu();
        activeIndex = Math.max(0, activeIndex - 1);
        highlightItem(items);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (container.classList.contains('open')) {
          if (activeIndex >= 0 && activeIndex < items.length) {
            items[activeIndex].click();
          } else {
            closeMenu();
          }
        } else {
          openMenu();
        }
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        closeMenu();
      }
    });

    function highlightItem(items) {
      items.forEach((it, i) => {
        it.classList.toggle('focused', i === activeIndex);
        if (i === activeIndex) it.scrollIntoView({ block: 'nearest' });
      });
    }

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) closeMenu();
    });

    document.addEventListener('scroll', (e) => {
      if (container.classList.contains('open') && !dropdown.contains(e.target)) {
        closeMenu();
      }
    }, true);

    select.addEventListener('change', syncDisplay);

    const observer = new MutationObserver(() => {
      buildOptions();
    });
    observer.observe(select, { childList: true, subtree: true, characterData: true });

    const origDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (origDescriptor && origDescriptor.set) {
      Object.defineProperty(select, 'value', {
        get() {
          return origDescriptor.get.call(this);
        },
        set(val) {
          origDescriptor.set.call(this, val);
          syncDisplay();
        },
      });
    }

    buildOptions();
  }

  /* ================================================================== */
  /* Section 1 — editor                                                  */
  /* ================================================================== */

  function loadDraft(m) {
    S.draft = A.clone(m);
    $('f-states').value = m.states.join(', ');
    $('f-inputs').value = m.inputs.join(', ');
    $('f-outputs').value = m.outputs.join(', ');
    renderEditor();
  }

  function renderEditor() {
    const m = S.draft;
    document.querySelectorAll('.seg button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.type === m.type));
    });
    $('table-hint').textContent = m.type === 'mealy'
      ? 'for every state and input choose the next state δ(q, a) and the output λ(q, a)'
      : 'for every state and input choose the next state δ(q, a); give every state its output λ(q)';

    // Start-state select.
    const start = $('f-start');
    start.innerHTML = m.states.map((q) => `<option${q === m.start ? ' selected' : ''}>${esc(q)}</option>`).join('');
    if (!m.states.includes(m.start)) m.start = m.states[0] || '';
    start.value = m.start;

    const opt = (list, v) => `<option value="">—</option>${list.map((x) => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}`;
    const t = $('editor');
    if (!m.states.length || !m.inputs.length) {
      t.innerHTML = '<tr><td class="muted">Enter states and an input alphabet to get a transition table.</td></tr>';
    } else if (m.type === 'mealy') {
      t.innerHTML = `<tr><th rowspan="2">State</th>${m.inputs.map((a) => `<th colspan="2">input ${esc(a)}</th>`).join('')}</tr>
        <tr>${m.inputs.map(() => '<th>next δ</th><th>output λ</th>').join('')}</tr>
        ${m.states.map((q) => `<tr><th scope="row">${q === m.start ? '→ ' : ''}${esc(q)}</th>${m.inputs.map((a) => `
          <td><select data-k="delta" data-q="${esc(q)}" data-a="${esc(a)}">${opt(m.states, m.delta[q] && m.delta[q][a])}</select></td>
          <td><select data-k="out" data-q="${esc(q)}" data-a="${esc(a)}">${opt(m.outputs, m.out[q] && m.out[q][a])}</select></td>`).join('')}</tr>`).join('')}`;
    } else {
      t.innerHTML = `<tr><th>State</th>${m.inputs.map((a) => `<th>next δ(·, ${esc(a)})</th>`).join('')}<th>output λ</th></tr>
        ${m.states.map((q) => `<tr><th scope="row">${q === m.start ? '→ ' : ''}${esc(q)}</th>${m.inputs.map((a) => `
          <td><select data-k="delta" data-q="${esc(q)}" data-a="${esc(a)}">${opt(m.states, m.delta[q] && m.delta[q][a])}</select></td>`).join('')}
          <td><select data-k="out" data-q="${esc(q)}">${opt(m.outputs, m.out[q])}</select></td></tr>`).join('')}`;
    }
    t.querySelectorAll('select[data-k]').forEach(createCustomSelect);
    renderFormal();
  }

  function renderFormal() {
    const m = S.draft;
    const set = (xs) => `{ ${xs.map(esc).join(', ')} }`;
    $('formal').innerHTML = `<b>${title(m.type)} machine</b> M = (Q, Σ, Δ, δ, λ, q₀) with
      Q = ${set(m.states)}, Σ = ${set(m.inputs)}, Δ = ${set(m.outputs)}, q₀ = ${esc(m.start || '—')},
      δ : Q × Σ → Q, λ : ${m.type === 'mealy' ? 'Q × Σ → Δ' : 'Q → Δ'}.`;
  }

  function onFieldsChanged() {
    const m = S.draft;
    m.states = parseList($('f-states').value);
    m.inputs = parseList($('f-inputs').value);
    m.outputs = parseList($('f-outputs').value);
    renderEditor();
  }

  function onCellChanged(e) {
    const s = e.target.closest('select[data-k]');
    if (!s) return;
    const m = S.draft;
    const { k, q, a } = s.dataset;
    const v = s.value || undefined;
    if (k === 'delta') { m.delta[q] = m.delta[q] || {}; m.delta[q][a] = v; }
    else if (m.type === 'mealy') { m.out[q] = m.out[q] || {}; m.out[q][a] = v; }
    else m.out[q] = v;
  }

  function setType(type) {
    if (S.draft.type === type) return;
    S.draft.type = type;
    S.draft.out = {}; // outputs have a different shape in the other model
    renderEditor();
  }

  function showErrors(box, errs) {
    box.hidden = !errs.length;
    box.innerHTML = errs.length ? `<b>Please fix:</b><ul>${errs.slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join('')}${errs.length > 12 ? `<li>… and ${errs.length - 12} more</li>` : ''}</ul>` : '';
  }

  /* ================================================================== */
  /* Section 2 — conversion playback                                     */
  /* ================================================================== */

  function convert() {
    stopPlay();
    const errs = A.validate(S.draft);
    showErrors($('errors'), errs);
    if (errs.length) return;

    S.src = A.clone(S.draft);
    const res = A.convert(S.src, { minimize: $('opt-min').checked });
    S.result = res.machine;
    S.steps = res.steps;
    S.vSrc = R.layout(S.src.states);
    S.fullStates = res.full.states;
    S.vRes = R.layout(S.fullStates);
    S.sim = null;

    $('direction').textContent = `${title(S.src.type)} → ${title(S.result.type)}`;
    $('cap-src').textContent = `Source — ${title(S.src.type)} machine (${S.src.states.length} states)`;
    $('st-range').max = S.steps.length - 1;
    $('st-total').textContent = S.steps.length;
    $('step-list').innerHTML = S.steps.map((s, i) => `<li><button type="button" data-i="${i}"><span class="tag">${esc(s.phase)}</span> ${esc(s.title)}</button></li>`).join('');
    $('convert-card').hidden = false;
    $('sim-card').hidden = false;
    $('sim-out').hidden = true;
    $('tests-out').innerHTML = '';
    $('ex-out').innerHTML = '';
    if (!$('tests').value.trim()) $('tests').value = defaultTests(S.src).join('\n');
    $('svg-src').innerHTML = '';
    $('svg-res').innerHTML = '';
    goStep(0);
  }

  function defaultTests(m) {
    const words = ['ε', ...m.inputs];
    const sep = m.inputs.every((a) => a.length === 1) ? '' : ' ';
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed; };
    for (let n = 3; n <= 7; n++) {
      words.push(Array.from({ length: n }, () => m.inputs[rnd() % m.inputs.length]).join(sep));
    }
    return words;
  }

  function goStep(i) {
    S.idx = Math.max(0, Math.min(S.steps.length - 1, i));
    S.sim && (S.sim.view = false);
    const st = S.steps[S.idx];
    $('st-num').textContent = S.idx + 1;
    $('st-range').value = S.idx;
    $('st-phase').textContent = st.phase;
    $('st-title').textContent = st.title;
    $('st-html').innerHTML = st.html;
    document.querySelectorAll('#step-list button').forEach((b) => b.classList.toggle('current', Number(b.dataset.i) === S.idx));
    $('st-prev').disabled = $('st-first').disabled = S.idx === 0;
    $('st-next').disabled = $('st-last').disabled = S.idx === S.steps.length - 1;
    paint();
  }

  /** Redraws both diagrams and the result table for the current step or simulation position. */
  function paint(opts = {}) {
    if (!S.steps.length) return;
    const st = S.steps[S.idx];
    let resM = st.snapshot;
    let hlSrc = { ...st.src, ...opts };
    let hlRes = { ...st.res, ...opts };
    if (S.sim && S.sim.view) {
      resM = S.result;
      hlSrc = { ...simHighlight(S.src, S.sim.a, S.sim.pos), ...opts };
      hlRes = { ...simHighlight(S.result, S.sim.b, S.sim.pos), ...opts };
    }
    $('cap-res').textContent = `Result — ${title(resM.type)} machine (${resM.states.length} states${S.idx < S.steps.length - 1 && !(S.sim && S.sim.view) ? ', in progress' : ''})`;
    R.drawDiagram($('svg-src'), S.src, S.vSrc, hlSrc);
    R.drawDiagram($('svg-res'), resM, S.vRes, hlRes);
    R.drawTable($('res-table'), resM, hlRes);
  }

  function stopPlay() {
    if (S.timer) clearInterval(S.timer);
    S.timer = null;
    $('st-play').textContent = '▶ Play';
  }

  function togglePlay() {
    if (S.timer) { stopPlay(); return; }
    if (S.idx === S.steps.length - 1) goStep(0);
    $('st-play').textContent = '⏸ Pause';
    S.timer = setInterval(() => {
      if (S.idx >= S.steps.length - 1) { stopPlay(); return; }
      goStep(S.idx + 1);
    }, 2400);
  }

  function useResult() {
    if (!S.result) return;
    loadDraft(S.result);
    $('example').value = '';
    $('tests').value = defaultTests(S.result).join('\n');
    convert();
    $('input-card').scrollIntoView({ behavior: 'smooth' });
  }

  /* ================================================================== */
  /* Section 3 — simulation & validation                                 */
  /* ================================================================== */

  const run = (m, w) => (m.type === 'mealy' ? A.runMealy(m, w) : A.runMoore(m, w));
  // Output compared across models: Moore's leading λ(q0) is dropped.
  const comparable = (m, r) => (m.type === 'mealy' ? r.output : r.output.slice(1));

  function fmtOutput(m, r) {
    if (m.type === 'mealy') return esc(A.joinSymbols(r.output));
    const rest = r.output.slice(1);
    return `<span class="lead" title="λ(q₀): output before any input">${esc(r.output[0])}</span>${rest.length ? (rest.every((s) => s.length === 1) && r.output[0].length === 1 ? '' : ' ') + esc(A.joinSymbols(rest)) : ''}`;
  }

  function simHighlight(m, r, pos) {
    const t = r.trace;
    if (m.type === 'mealy') {
      const state = pos < t.length ? t[pos].state : r.final;
      return { states: [state], edges: pos > 0 ? [[t[pos - 1].state, t[pos - 1].input]] : [] };
    }
    return { states: [t[pos].state], edges: pos > 0 ? [[t[pos - 1].state, t[pos].input]] : [] };
  }

  function runSim() {
    if (!S.result) return;
    const tk = A.tokenize($('sim-word').value, S.src.inputs);
    showErrors($('sim-error'), tk.error ? [tk.error] : []);
    if (tk.error) return;
    stopPlay();
    if (S.idx !== S.steps.length - 1) goStep(S.steps.length - 1);
    S.sim = { tokens: tk.tokens, a: run(S.src, tk.tokens), b: run(S.result, tk.tokens), pos: 0, view: true };
    $('sim-range').max = tk.tokens.length;
    $('sim-out').hidden = false;
    $('tr-a-title').textContent = `Source (${title(S.src.type)}) trace`;
    $('tr-b-title').textContent = `Converted (${title(S.result.type)}) trace`;

    const a = comparable(S.src, S.sim.a);
    const b = comparable(S.result, S.sim.b);
    const ok = a.join('\u0000') === b.join('\u0000');
    const mealyM = S.src.type === 'mealy' ? S.src : S.result;
    const mooreM = S.src.type === 'mealy' ? S.result : S.src;
    const mealyR = S.src.type === 'mealy' ? S.sim.a : S.sim.b;
    const mooreR = S.src.type === 'mealy' ? S.sim.b : S.sim.a;
    $('sim-verdict').className = `verdict ${ok ? 'ok' : 'bad'}`;
    $('sim-verdict').innerHTML = `
      <div>w = <code>${esc(A.joinSymbols(tk.tokens))}</code> (|w| = ${tk.tokens.length})</div>
      <div>Mealy output: <code>${fmtOutput(mealyM, mealyR)}</code> (|w| = ${mealyR.output.length} symbols)</div>
      <div>Moore output: <code>${fmtOutput(mooreM, mooreR)}</code> (|w| + 1 = ${mooreR.output.length} symbols; first one is λ(q₀))</div>
      <div class="big">${ok ? '✓ Equivalent on this input: Moore output without its first symbol = Mealy output'
        : '✗ Outputs differ — the machines are not equivalent on this input'}</div>`;
    setSimPos(tk.tokens.length);
  }

  function setSimPos(p) {
    if (!S.sim) return;
    S.sim.pos = Math.max(0, Math.min(S.sim.tokens.length, p));
    S.sim.view = true;
    $('sim-range').value = S.sim.pos;
    $('sim-pos').textContent = `${S.sim.pos} of ${S.sim.tokens.length} symbol(s) read`;
    $('tr-a').innerHTML = traceTable(S.src, S.sim.a, S.sim.pos);
    $('tr-b').innerHTML = traceTable(S.result, S.sim.b, S.sim.pos);
    paint();
  }

  function traceTable(m, r, pos) {
    if (m.type === 'mealy') {
      const rows = r.trace.map((t, i) => `<tr class="${i + 1 === pos ? 'hl-row' : ''}"><td>${i + 1}</td><td>${esc(t.state)}</td><td>${esc(t.input)}</td><td>${esc(t.next)}</td><td class="out">${esc(t.output)}</td></tr>`).join('');
      return `<table class="tt"><tr><th>#</th><th>state</th><th>read</th><th>next</th><th>output</th></tr>
        ${rows || '<tr><td colspan="5" class="muted">ε — no transitions, no output</td></tr>'}</table>`;
    }
    const rows = r.trace.map((t, i) => `<tr class="${i === pos ? 'hl-row' : ''}"><td>${i}</td><td>${i === 0 ? '<span class="muted">start</span>' : esc(t.input)}</td><td>${esc(t.state)}</td><td class="out">${esc(t.output)}</td></tr>`).join('');
    return `<table class="tt"><tr><th>#</th><th>read</th><th>enter state</th><th>output</th></tr>${rows}</table>`;
  }

  function runTests() {
    if (!S.result) return;
    const lines = $('tests').value.split('\n').map((l) => l.trim()).filter((l) => l.length);
    let pass = 0;
    const rows = lines.map((line, i) => {
      const tk = A.tokenize(line, S.src.inputs);
      if (tk.error) return `<tr class="fail"><td>${i + 1}</td><td><code>${esc(line)}</code></td><td colspan="3">${esc(tk.error)}</td><td>error</td></tr>`;
      const ra = run(S.src, tk.tokens);
      const rb = run(S.result, tk.tokens);
      const exp = comparable(S.src, ra);
      const gen = comparable(S.result, rb);
      const ok = exp.join('\u0000') === gen.join('\u0000');
      if (ok) pass++;
      return `<tr class="${ok ? 'pass' : 'fail'}"><td>${i + 1}</td><td><code>${esc(A.joinSymbols(tk.tokens))}</code></td>
        <td><code>${fmtOutput(S.src, ra)}</code></td><td><code>${fmtOutput(S.result, rb)}</code></td>
        <td><code>${esc(A.joinSymbols(exp))}</code> / <code>${esc(A.joinSymbols(gen))}</code></td><td>${ok ? '✓ pass' : '✗ fail'}</td></tr>`;
    }).join('');
    $('tests-out').innerHTML = `<p class="summary ${pass === lines.length ? 'ok' : 'bad'}">${pass} / ${lines.length} test cases passed</p>
      <table class="tt tests-table"><tr><th>#</th><th>Input w</th><th>Source (${title(S.src.type)}) output</th>
      <th>Converted (${title(S.result.type)}) output</th><th>Expected / generated</th><th>Result</th></tr>${rows}</table>
      <p class="hint">Shaded leading symbol = Moore output λ(q₀) before any input; it is ignored in the comparison.</p>`;
  }

  function runExhaustive() {
    if (!S.result) return;
    const len = Math.max(0, Math.min(16, Number($('ex-len').value) || 0));
    const mealyM = S.src.type === 'mealy' ? S.src : S.result;
    const mooreM = S.src.type === 'mealy' ? S.result : S.src;
    const t0 = performance.now();
    const r = A.checkEquivalence(mealyM, mooreM, len);
    const ms = Math.round(performance.now() - t0);
    const box = $('ex-out');
    box.className = `verdict ${r.ok ? 'ok' : 'bad'}`;
    box.innerHTML = r.ok
      ? `<div class="big">✓ All ${r.checked.toLocaleString()} input strings ${r.truncated ? `(capped at ${r.checked.toLocaleString()})` : `of length ≤ ${len}`} produce identical output.</div>
         <div class="muted">Checked Mealy(w) = tail(Moore(w)) in ${ms} ms.</div>`
      : `<div class="big">✗ Found ${r.mismatches.length} counterexample(s):</div><ul>${r.mismatches.map((x) =>
        `<li><code>${esc(A.joinSymbols(x.word))}</code>: Mealy ${esc(A.joinSymbols(x.mealy))} vs Moore ${esc(A.joinSymbols(x.moore))}</li>`).join('')}</ul>`;
  }

  /* ================================================================== */
  /* Import / export                                                     */
  /* ================================================================== */

  function exportJson() {
    const blob = new Blob([JSON.stringify(S.draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${S.draft.type}-machine.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const m = JSON.parse(reader.result);
        if (!['mealy', 'moore'].includes(m.type) || !Array.isArray(m.states) || !Array.isArray(m.inputs) || !Array.isArray(m.outputs)) {
          throw new Error('expected { type: "mealy" | "moore", states, inputs, outputs, start, delta, out }');
        }
        m.delta = m.delta || {};
        m.out = m.out || {};
        loadDraft(m);
        $('example').value = '';
        showErrors($('errors'), []);
      } catch (err) {
        showErrors($('errors'), [`Could not import file: ${err.message}`]);
      }
    };
    reader.readAsText(file);
  }

  /* ================================================================== */
  /* Wiring                                                              */
  /* ================================================================== */

  function init() {
    initTheme();

    $('example').innerHTML += window.EXAMPLES.map((ex, i) => `<option value="${i}">${esc(ex.name)}</option>`).join('');

    // Enhance native selects with rounded fluid custom dropdowns
    createCustomSelect($('example'));
    createCustomSelect($('f-start'));

    $('example').addEventListener('change', (e) => {
      const ex = window.EXAMPLES[e.target.value];
      if (!ex) return;
      loadDraft(ex.machine);
      $('tests').value = ex.tests.map((t) => t || 'ε').join('\n');
      $('sim-word').value = ex.tests[ex.tests.length - 1];
      convert();
    });

    document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
    ['f-states', 'f-inputs', 'f-outputs'].forEach((id) => $(id).addEventListener('input', onFieldsChanged));
    $('f-start').addEventListener('change', (e) => { S.draft.start = e.target.value; renderEditor(); });
    $('editor').addEventListener('change', onCellChanged);

    $('btn-convert').addEventListener('click', convert);
    $('btn-export').addEventListener('click', exportJson);
    $('btn-import').addEventListener('click', () => $('file-import').click());
    $('file-import').addEventListener('change', (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });

    $('st-first').addEventListener('click', () => { stopPlay(); goStep(0); });
    $('st-prev').addEventListener('click', () => { stopPlay(); goStep(S.idx - 1); });
    $('st-next').addEventListener('click', () => { stopPlay(); goStep(S.idx + 1); });
    $('st-last').addEventListener('click', () => { stopPlay(); goStep(S.steps.length - 1); });
    $('st-play').addEventListener('click', togglePlay);
    $('st-range').addEventListener('input', (e) => { stopPlay(); goStep(Number(e.target.value)); });
    $('step-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) { stopPlay(); goStep(Number(b.dataset.i)); }
    });
    $('btn-relayout').addEventListener('click', () => {
      if (!S.src) return;
      S.vSrc = R.layout(S.src.states);
      S.vRes = R.layout(S.fullStates);
      $('svg-src').innerHTML = '';
      $('svg-res').innerHTML = '';
      paint();
    });
    $('btn-use-result').addEventListener('click', useResult);

    R.enableDrag($('svg-src'), () => S.vSrc, (opts) => paint(opts));
    R.enableDrag($('svg-res'), () => S.vRes, (opts) => paint(opts));

    $('btn-run').addEventListener('click', runSim);
    $('sim-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSim(); });
    $('sim-range').addEventListener('input', (e) => setSimPos(Number(e.target.value)));
    $('sim-prev').addEventListener('click', () => S.sim && setSimPos(S.sim.pos - 1));
    $('sim-next').addEventListener('click', () => S.sim && setSimPos(S.sim.pos + 1));
    $('btn-tests').addEventListener('click', runTests);
    $('btn-exhaustive').addEventListener('click', runExhaustive);

    const exLen = $('ex-len');
    const exLenUp = $('ex-len-up');
    const exLenDown = $('ex-len-down');
    if (exLen && exLenUp && exLenDown) {
      exLenUp.addEventListener('click', (e) => {
        e.preventDefault();
        const cur = Number(exLen.value) || 0;
        if (cur < 16) {
          exLen.value = String(cur + 1);
          exLen.dispatchEvent(new Event('input', { bubbles: true }));
          exLen.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      exLenDown.addEventListener('click', (e) => {
        e.preventDefault();
        const cur = Number(exLen.value) || 0;
        if (cur > 0) {
          exLen.value = String(cur - 1);
          exLen.dispatchEvent(new Event('input', { bubbles: true }));
          exLen.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (!S.steps.length || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowRight') { stopPlay(); goStep(S.idx + 1); }
      if (e.key === 'ArrowLeft') { stopPlay(); goStep(S.idx - 1); }
    });

    // Start with the first example so the page is never empty.
    $('example').value = '0';
    $('example').dispatchEvent(new Event('change'));
  }

  init();
}());
