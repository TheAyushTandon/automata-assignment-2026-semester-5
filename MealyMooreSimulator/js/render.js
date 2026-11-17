/**
 * render.js
 * SVG state-diagram renderer and transition-table renderer.
 *
 * A "view" holds node positions and a fixed viewBox for one diagram:
 *   { nodes: { q:{x,y} }, box: { x, y, w, h } }
 * Nodes can be dragged; positions persist in the view between redraws.
 * Preserves past lines and animates only new lines to their target states.
 */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const { esc } = root.Automata;

  function el(name, attrs = {}, text) {
    const e = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function nodeRadius(q) {
    return Math.max(26, String(q).length * 4.8 + 14);
  }

  function findByAttr(parent, attr, value) {
    if (!parent) return null;
    for (let i = 0; i < parent.children.length; i++) {
      if (parent.children[i].getAttribute(attr) === value) {
        return parent.children[i];
      }
    }
    return null;
  }

  /**
   * Places states on an ellipse (wider than tall, to fill the diagram panel),
   * starting at the left and going clockwise.
   */
  function layout(states) {
    const n = states.length;
    const ry = n <= 1 ? 0 : Math.max(95, n * 24);
    const rx = ry * 1.45;
    const nodes = {};
    states.forEach((q, i) => {
      const t = Math.PI + (2 * Math.PI * i) / Math.max(n, 1);
      nodes[q] = { x: rx * Math.cos(t), y: ry * Math.sin(t) };
    });
    const pad = 96;
    return { nodes, box: { x: -rx - pad, y: -ry - pad, w: 2 * (rx + pad), h: 2 * (ry + pad) } };
  }

  function centroid(view) {
    const pts = Object.values(view.nodes);
    if (!pts.length) return { x: 0, y: 0 };
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }

  function addMarkers(svg, id) {
    const defs = el('defs');
    [['n', 'arrowhead'], ['a', 'arrowhead active']].forEach(([suffix, cls]) => {
      const mk = el('marker', {
        id: `${id}-arrow-${suffix}`, viewBox: '0 0 10 10', refX: '9', refY: '5',
        markerWidth: '11', markerHeight: '11', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
      });
      mk.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }));
      defs.appendChild(mk);
    });
    svg.appendChild(defs);
  }

  function labelText(x, y, parts) {
    const t = el('text', { x, y, class: 'edge-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    parts.forEach((p, i) => {
      if (i) t.appendChild(el('tspan', {}, ', '));
      t.appendChild(el('tspan', { class: p.hl ? 'hl' : '' }, p.text));
    });
    return t;
  }

  function updateLabel(t, x, y, parts) {
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.innerHTML = '';
    parts.forEach((p, i) => {
      if (i) t.appendChild(el('tspan', {}, ', '));
      t.appendChild(el('tspan', { class: p.hl ? 'hl' : '' }, p.text));
    });
  }

  /**
   * Animates an SVG path being drawn smoothly from source to destination state.
   * Takes at least 3 seconds for active orange transitions.
   * Attaches arrowhead marker upon arrival at the destination state.
   */
  function animatePathDraw(path, markerUrl, duration = 2000) {
    if (!path) return;

    if (path._anim) {
      try { path._anim.cancel(); } catch (e) {}
      path._anim = null;
    }
    if (path._animTimer) {
      clearTimeout(path._animTimer);
      path._animTimer = null;
    }

    path.removeAttribute('marker-end');

    let len = 300;
    try {
      len = Math.ceil(path.getTotalLength()) || 300;
    } catch (err) {
      len = 300;
    }

    path.style.strokeDasharray = `${len} ${len}`;
    path.style.strokeDashoffset = `${len}`;

    try {
      const anim = path.animate([
        { strokeDashoffset: len },
        { strokeDashoffset: 0 }
      ], {
        duration: duration,
        easing: 'cubic-bezier(0.35, 0.05, 0.25, 1)',
        fill: 'forwards'
      });
      path._anim = anim;

      anim.onfinish = () => {
        path._anim = null;
        if (markerUrl) path.setAttribute('marker-end', markerUrl);
        path.style.strokeDasharray = '';
        path.style.strokeDashoffset = '';
      };
    } catch (err) {
      requestAnimationFrame(() => {
        path.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.35, 0.05, 0.25, 1)`;
        path.style.strokeDashoffset = '0';
        path._animTimer = setTimeout(() => {
          path._animTimer = null;
          if (markerUrl) path.setAttribute('marker-end', markerUrl);
          path.style.strokeDasharray = '';
          path.style.strokeDashoffset = '';
          path.style.transition = '';
        }, duration + 30);
      });
    }
  }

  /**
   * Draws machine `m` into `svg` using `view` for positions.
   * Retains existing nodes and past edges, animating only newly added edges.
   */
  function drawDiagram(svg, m, view, opts = {}) {
    const id = svg.id || 'svg';
    const isDragging = Boolean(opts.dragging);

    if (opts.reset) {
      svg.innerHTML = '';
    }

    if (!svg.querySelector('defs')) {
      addMarkers(svg, id);
    }

    let edgeLayer = svg.querySelector('.edge-layer');
    if (!edgeLayer) {
      edgeLayer = el('g', { class: 'edge-layer' });
      svg.appendChild(edgeLayer);
    }

    let startLayer = svg.querySelector('.start-layer');
    if (!startLayer) {
      startLayer = el('g', { class: 'start-layer' });
      svg.appendChild(startLayer);
    }

    let nodeLayer = svg.querySelector('.node-layer');
    if (!nodeLayer) {
      nodeLayer = el('g', { class: 'node-layer' });
      svg.appendChild(nodeLayer);
    }

    let labelLayer = svg.querySelector('.label-layer');
    if (!labelLayer) {
      labelLayer = el('g', { class: 'label-layer' });
      svg.appendChild(labelLayer);
    }

    if (!m || !m.states.length) {
      edgeLayer.innerHTML = '';
      startLayer.innerHTML = '';
      nodeLayer.innerHTML = '';
      labelLayer.innerHTML = '';
      return;
    }

    const { box } = view;
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    const hlStates = new Set(opts.states || []);
    const hlEdges = new Set((opts.edges || []).map(([q, a]) => `${q}\u0001${a}`));
    const c = centroid(view);
    const present = m.states.filter((q) => view.nodes[q]);

    // Group parallel transitions p → q into one arrow with a combined label.
    const groups = new Map();
    present.forEach((q) => m.inputs.forEach((a) => {
      const p = m.delta[q] && m.delta[q][a];
      if (p === undefined || !view.nodes[p] || !present.includes(p)) return;
      const key = `${q}->${p}`;
      if (!groups.has(key)) groups.set(key, { from: q, to: p, key, parts: [] });
      const o = m.type === 'mealy' ? (m.out[q] && m.out[q][a]) : null;
      groups.get(key).parts.push({ text: m.type === 'mealy' ? `${a}/${o === undefined ? '?' : o}` : a, hl: hlEdges.has(`${q}\u0001${a}`) });
    }));

    // 1. Process Edges: past edges stay unchanged; only brand new edges animate
    const activeKeys = new Set();
    let newEdgeCount = 0;

    groups.forEach((g) => {
      activeKeys.add(g.key);
      const A = view.nodes[g.from];
      const B = view.nodes[g.to];
      const rA = nodeRadius(g.from);
      const active = g.parts.some((p) => p.hl);
      const cls = `edge${active ? ' active' : ''}`;
      const marker = `url(#${id}-arrow-${active ? 'a' : 'n'})`;

      let pathD = '';
      let lx = 0;
      let ly = 0;

      if (g.from === g.to) {
        // Self-loop, pointing away from the centre of the diagram.
        let th = Math.atan2(A.y - c.y, A.x - c.x);
        if (Math.hypot(A.x - c.x, A.y - c.y) < 1) th = -Math.PI / 2;
        const p1 = { x: A.x + rA * Math.cos(th - 0.5), y: A.y + rA * Math.sin(th - 0.5) };
        const p2 = { x: A.x + rA * Math.cos(th + 0.5), y: A.y + rA * Math.sin(th + 0.5) };
        const d = rA + 58;
        const c1 = { x: A.x + d * Math.cos(th - 0.75), y: A.y + d * Math.sin(th - 0.75) };
        const c2 = { x: A.x + d * Math.cos(th + 0.75), y: A.y + d * Math.sin(th + 0.75) };
        pathD = `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
        const L = rA + 56;
        lx = A.x + L * Math.cos(th);
        ly = A.y + L * Math.sin(th);
      } else {
        const rB = nodeRadius(g.to);
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const off = groups.has(`${g.to}->${g.from}`) ? 26 : 0;
        const C = { x: (A.x + B.x) / 2 + nx * off * 2, y: (A.y + B.y) / 2 + ny * off * 2 };
        const dirA = Math.atan2(C.y - A.y, C.x - A.x);
        const dirB = Math.atan2(C.y - B.y, C.x - B.x);
        const s = { x: A.x + rA * Math.cos(dirA), y: A.y + rA * Math.sin(dirA) };
        const e = { x: B.x + rB * Math.cos(dirB), y: B.y + rB * Math.sin(dirB) };
        pathD = `M${s.x},${s.y} Q${C.x},${C.y} ${e.x},${e.y}`;
        const lo = off + 13;
        lx = (A.x + B.x) / 2 + nx * lo;
        ly = (A.y + B.y) / 2 + ny * lo;
      }

      let pathEl = findByAttr(edgeLayer, 'data-edge', g.key);
      if (!pathEl) {
        // Brand new edge
        pathEl = el('path', {
          d: pathD,
          class: cls,
          'data-edge': g.key,
        });
        edgeLayer.appendChild(pathEl);

        if (!isDragging) {
          if (active) {
            // New active orange line: transition smoothly to target state in 2 seconds
            animatePathDraw(pathEl, marker, 2000);
          } else {
            pathEl.setAttribute('marker-end', marker);
          }
        } else {
          pathEl.setAttribute('marker-end', marker);
        }
      } else {
        pathEl.setAttribute('d', pathD);
        const wasActive = pathEl.classList.contains('active');

        if (active && !wasActive) {
          // Edge just became active (orange) in this step: animate smoothly to target state
          pathEl.setAttribute('class', cls);
          if (!isDragging) {
            animatePathDraw(pathEl, marker, 2000);
          } else {
            pathEl.setAttribute('marker-end', marker);
          }
        } else if (!active && wasActive) {
          // Edge was active previously, now past/inactive: keep solid grey in place
          if (pathEl._anim) {
            try { pathEl._anim.cancel(); } catch (e) {}
            pathEl._anim = null;
          }
          pathEl.style.strokeDasharray = '';
          pathEl.style.strokeDashoffset = '';
          pathEl.style.transition = '';
          pathEl.setAttribute('class', cls);
          pathEl.setAttribute('marker-end', marker);
        } else {
          pathEl.setAttribute('class', cls);
          pathEl.setAttribute('marker-end', marker);
        }
      }

      // Edge label
      let labelEl = findByAttr(labelLayer, 'data-label', g.key);
      if (!labelEl) {
        labelEl = labelText(lx, ly, g.parts);
        labelEl.setAttribute('data-label', g.key);
        labelLayer.appendChild(labelEl);
        if (!isDragging && active) {
          labelEl.style.opacity = '0';
          setTimeout(() => {
            labelEl.style.transition = 'opacity 0.4s ease';
            labelEl.style.opacity = '1';
          }, 1500);
        }
      } else {
        updateLabel(labelEl, lx, ly, g.parts);
      }
    });

    // Remove obsolete edges & labels (e.g. stepping backward)
    Array.from(edgeLayer.children).forEach((pe) => {
      const k = pe.getAttribute('data-edge');
      if (k && !activeKeys.has(k)) pe.remove();
    });
    Array.from(labelLayer.children).forEach((le) => {
      const k = le.getAttribute('data-label');
      if (k && !activeKeys.has(k)) le.remove();
    });

    // 2. Start arrow
    if (m.start && view.nodes[m.start] && present.includes(m.start)) {
      const A = view.nodes[m.start];
      const r = nodeRadius(m.start);
      let th = Math.atan2(A.y - c.y, A.x - c.x) - 1.25;
      if (Math.hypot(A.x - c.x, A.y - c.y) < 1) th = Math.PI;
      const from = { x: A.x + (r + 40) * Math.cos(th), y: A.y + (r + 40) * Math.sin(th) };
      const to = { x: A.x + r * Math.cos(th), y: A.y + r * Math.sin(th) };
      const startMarker = `url(#${id}-arrow-n)`;
      const startD = `M${from.x},${from.y} L${to.x},${to.y}`;

      let startPath = startLayer.querySelector('.edge.start');
      let startLabel = startLayer.querySelector('.start-label');

      if (!startPath) {
        startPath = el('path', { d: startD, class: 'edge start', 'marker-end': startMarker });
        startLayer.appendChild(startPath);
        if (!isDragging) {
          animatePathDraw(startPath, startMarker, 0);
        }
        startLabel = el('text', { x: from.x, y: from.y - 8, class: 'start-label', 'text-anchor': 'middle' }, 'start');
        startLayer.appendChild(startLabel);
      } else {
        startPath.setAttribute('d', startD);
        if (startLabel) {
          startLabel.setAttribute('x', from.x);
          startLabel.setAttribute('y', from.y - 8);
        }
      }
    } else {
      startLayer.innerHTML = '';
    }

    // 3. Process Nodes: past nodes stay in place; only new nodes animate
    present.forEach((q) => {
      const p = view.nodes[q];
      const r = nodeRadius(q);
      const isNodeActive = hlStates.has(q);

      let nodeGroup = findByAttr(nodeLayer, 'data-q', q);
      if (!nodeGroup) {
        nodeGroup = el('g', {
          class: `node${isNodeActive ? ' active' : ''}${!isDragging ? ' draw-in' : ''}`,
          'data-q': q,
          transform: `translate(${p.x},${p.y})`,
        });
        const circle = el('circle', { r });
        nodeGroup.appendChild(circle);

        if (m.type === 'moore') {
          nodeGroup.appendChild(el('line', { x1: -r + 6, x2: r - 6, y1: 2, y2: 2, class: 'divider' }));
          nodeGroup.appendChild(el('text', { y: -8, class: 'node-name', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, q));
          const o = m.out[q];
          nodeGroup.appendChild(el('text', { y: 13, class: 'node-out', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, o === undefined ? '?' : o));
        } else {
          nodeGroup.appendChild(el('text', { class: 'node-name', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, q));
        }
        const title = el('title', {}, m.type === 'moore' ? `${q} — output ${m.out[q]}` : q);
        nodeGroup.appendChild(title);
        nodeLayer.appendChild(nodeGroup);
      } else {
        nodeGroup.setAttribute('transform', `translate(${p.x},${p.y})`);
        nodeGroup.classList.remove('draw-in');
        nodeGroup.classList.toggle('active', isNodeActive);

        if (m.type === 'moore') {
          const outEl = nodeGroup.querySelector('.node-out');
          const o = m.out[q];
          if (outEl) outEl.textContent = o === undefined ? '?' : o;
        }
      }
    });

    // Remove obsolete nodes
    Array.from(nodeLayer.children).forEach((ng) => {
      const q = ng.getAttribute('data-q');
      if (q && !present.includes(q)) ng.remove();
    });
  }

  /** Lets the user drag nodes. getView() returns the current view; redraw() repaints. */
  function enableDrag(svg, getView, redraw) {
    let dragging = null;
    const toSvg = (e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    };
    svg.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-q]');
      if (!g || !getView()) return;
      dragging = g.getAttribute('data-q');
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      const view = getView();
      if (!dragging || !view) return;
      const p = toSvg(e);
      const { box } = view;
      const m = 40;
      view.nodes[dragging] = {
        x: Math.min(box.x + box.w - m, Math.max(box.x + m, p.x)),
        y: Math.min(box.y + box.h - m, Math.max(box.y + m, p.y)),
      };
      redraw({ dragging: true });
    });
    const stop = () => {
      if (dragging) {
        dragging = null;
        svg.classList.remove('dragging');
        redraw({ dragging: true });
      }
    };
    svg.addEventListener('pointerup', stop);
    svg.addEventListener('pointercancel', stop);
  }

  /** Renders a transition table. opts.states highlights rows, opts.edges highlights cells. */
  function drawTable(container, m, opts = {}) {
    if (!m) { container.innerHTML = ''; return; }
    const hlStates = new Set(opts.states || []);
    const hlEdges = new Set((opts.edges || []).map(([q, a]) => `${q}\u0001${a}`));
    const val = (v) => (v === undefined ? '<span class="muted">—</span>' : esc(v));
    let head;
    if (m.type === 'mealy') {
      head = `<tr><th rowspan="2">State</th>${m.inputs.map((a) => `<th colspan="2">input ${esc(a)}</th>`).join('')}</tr>
        <tr>${m.inputs.map(() => '<th>next</th><th>out</th>').join('')}</tr>`;
    } else {
      head = `<tr><th>State</th>${m.inputs.map((a) => `<th>δ(·, ${esc(a)})</th>`).join('')}<th>Output λ</th></tr>`;
    }
    const rows = m.states.map((q) => {
      const cells = m.inputs.map((a) => {
        const cls = hlEdges.has(`${q}\u0001${a}`) ? ' class="hl"' : '';
        const next = m.delta[q] && m.delta[q][a];
        if (m.type === 'mealy') return `<td${cls}>${val(next)}</td><td${cls}>${val(m.out[q] && m.out[q][a])}</td>`;
        return `<td${cls}>${val(next)}</td>`;
      }).join('');
      const outCell = m.type === 'moore' ? `<td class="out">${val(m.out[q])}</td>` : '';
      return `<tr class="${hlStates.has(q) ? 'hl-row' : ''}"><th scope="row">${q === m.start ? '→ ' : ''}${esc(q)}</th>${cells}${outCell}</tr>`;
    }).join('');
    container.innerHTML = `<table class="tt">${head}${rows}</table>`;
  }

  root.Render = { layout, drawDiagram, enableDrag, drawTable };
}(window));
