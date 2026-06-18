/* app.js — the tutorial controller.
 *
 * A small step machine drives a guided git lesson. Each step knows the command
 * it wants, the plain-language reason behind it, and how to draw its result on
 * the board. The graph model stays tiny so new commands slot in cleanly.
 *
 * Built so far: init, add, commit.
 */
(() => {
  const S = Sketch;
  const COLORS = {
    ink: "#2a2521",
    inkSoft: "#7a7060",
    main: "#2e5c9e",
    feature: "#c0492f",
    green: "#3f7a4e",
  };

  // ---- DOM ----------------------------------------------------------
  const graph = document.getElementById("graph");
  const gEdges = document.getElementById("edges");
  const gNodes = document.getElementById("nodes");
  const gNib = document.getElementById("ink-nib");
  const gLabels = document.getElementById("labels");
  const stage = document.getElementById("stage");
  const form = document.getElementById("cli");
  const cmd = document.getElementById("cmd");
  const cue = document.getElementById("cue");
  const ghost = document.getElementById("ghost");
  const brandRule = document.querySelector(".brand__rule");
  const cliRule = document.querySelector(".cli__rule");

  // ---- graph model --------------------------------------------------
  const model = { nodes: [], head: null, tagEls: null, pending: null };
  const GAP = 150;      // horizontal distance between commits
  const NODE_R = 28;    // base node radius

  function boardCenter() {
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.42 };
  }
  // column i sits to the right of the first node, which lives at board centre
  function nodePos(col) {
    const c = boardCenter();
    return { x: c.x + col * GAP, y: c.y };
  }
  const headNode = () => model.nodes.find((n) => n.id === model.head);

  // ---- board sizing -------------------------------------------------
  function sizeBoard() {
    const w = window.innerWidth, h = window.innerHeight;
    graph.setAttribute("width", w);
    graph.setAttribute("height", h);
    graph.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  // ---- the two underlines (brand + command line) --------------------
  function drawRule(svg, color, seed) {
    const vb = svg.viewBox.baseVal;
    const y = vb.height * 0.55;
    const d = S.linePath(vb.width * 0.03, y, vb.width * 0.97, y, seed, 0.8);
    const p = S.el("path", {
      d, class: "edge-stroke", stroke: color,
      "stroke-width": Math.max(1.6, vb.height * 0.18),
    });
    svg.appendChild(p);
  }

  // ---- ambient life: boil + a slow whole-sheet drift ----------------
  function startAmbient() {
    const turb = graph.querySelector("#boil feTurbulence");
    S.startBoil(turb, { fps: 6, seeds: [1, 9, 17] });
    if (S.prefersReduced) return;
    const loop = (now) => {
      const t = now / 1000;
      const x = Math.sin(t * 0.16) * 6 + Math.sin(t * 0.07) * 3;
      const y = Math.cos(t * 0.13) * 4 + Math.sin(t * 0.05) * 2;
      graph.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- small animation helpers -------------------------------------
  function animateIn(node, delay = 0) {
    if (S.prefersReduced) return;
    node.style.opacity = "0";
    node.style.transform = "translateY(6px) scale(0.9)";
    node.style.transformOrigin = "center";
    node.style.transition = "opacity .45s ease, transform .5s cubic-bezier(.16,1,.3,1)";
    requestAnimationFrame(() =>
      setTimeout(() => {
        node.style.opacity = "1";
        node.style.transform = "translateY(0) scale(1)";
      }, delay)
    );
  }
  function fadeOutRemove(node, dur = 300) {
    if (S.prefersReduced) { node.remove(); return; }
    node.style.transition = `opacity ${dur}ms ease`;
    node.style.opacity = "0";
    setTimeout(() => node.remove(), dur + 20);
  }

  // ---- shapes -------------------------------------------------------
  function shapePath(shape, x, y, r, seed) {
    if (shape === "square") return S.squarePath(x, y, r * 1.7, seed);
    return S.circlePath(x, y, r, seed);
  }

  // ---- drawing ------------------------------------------------------
  async function drawNode(node, seed) {
    const d1 = shapePath(node.shape, node.x, node.y, node.r, seed);
    const main = S.el("path", {
      d: d1, class: "node-stroke", stroke: node.color, "stroke-width": 2.8,
    });
    const d2 = shapePath(node.shape, node.x, node.y, node.r * 0.97, seed + 31);
    const second = S.el("path", {
      d: d2, class: "node-stroke", stroke: node.color, "stroke-width": 1.5, opacity: 0.5,
    });
    gNodes.appendChild(main);
    gNodes.appendChild(second);
    await S.drawOn(main, { duration: 720, nibGroup: gNib, color: node.color });
    S.drawOn(second, { duration: 360 });
  }

  // a stroke from one node's edge to another's, trimmed so it kisses the rims
  function connectorPath(from, to, seed) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const sx = from.x + ux * (from.r + 3), sy = from.y + uy * (from.r + 3);
    const ex = to.x - ux * (to.r + 3), ey = to.y - uy * (to.r + 3);
    return S.linePath(sx, sy, ex, ey, seed, 0.8);
  }
  async function drawConnector(from, to, color, seed) {
    const p = S.el("path", {
      d: connectorPath(from, to, seed), class: "edge-stroke",
      stroke: color, "stroke-width": 2.4,
    });
    gEdges.appendChild(p);
    await S.drawOn(p, { duration: 460, nibGroup: gNib, color });
    return p;
  }

  // a handwritten label inside a hand-drawn box
  function pill(parent, text, cx, midY, color, seed, delay) {
    const w = text.length * 12 + 22;
    const g = S.el("g");
    g.appendChild(S.el("path", {
      d: S.rectPath(cx, midY, w, 30, seed), class: "tag-box",
      stroke: color, "stroke-width": 1.8, fill: "#efe7d2",
    }));
    const t = S.el("text", {
      x: cx, y: midY + 7, "text-anchor": "middle", class: "tag", fill: color,
    });
    t.textContent = text;
    g.appendChild(t);
    parent.appendChild(g);
    animateIn(g, delay);
  }

  // HEAD over the branch name, joined to the node by a tick. Replaces any
  // tags already on the board, so the labels "travel" to the newest commit.
  function placeTags(node, branchName, color) {
    if (model.tagEls) fadeOutRemove(model.tagEls, 220);
    const g = S.el("g");
    gLabels.appendChild(g);
    g.appendChild(makeTick(node));
    pill(g, branchName, node.x, node.y - node.r - 42, color, 2, 120);
    pill(g, "HEAD", node.x, node.y - node.r - 84, COLORS.ink, 3, 240);
    model.tagEls = g;
  }
  function makeTick(node) {
    const tick = S.el("path", {
      d: S.linePath(node.x, node.y - node.r - 2, node.x, node.y - node.r - 22, 5, 0.6),
      class: "edge-stroke", stroke: COLORS.inkSoft, "stroke-width": 1.4,
    });
    animateIn(tick, 40);
    return tick;
  }

  function caption(text, cx, y, delay, faint = false) {
    const t = S.el("text", {
      x: cx, y, "text-anchor": "middle", class: "commit-msg",
    });
    if (faint) t.setAttribute("opacity", "0.6");
    t.textContent = text;
    gLabels.appendChild(t);
    animateIn(t, delay);
    return t;
  }

  // ---- step actions -------------------------------------------------
  async function doInit() {
    const p = nodePos(0);
    const node = { id: 0, col: 0, x: p.x, y: p.y, r: NODE_R, branch: "main", color: COLORS.main, shape: "circle" };
    model.nodes.push(node);
    model.head = 0;
    dockStage();
    await drawNode(node, 3);
    placeTags(node, "main", COLORS.main);
    caption("git init", node.x, node.y + node.r + 32, 360);
  }

  // staging: a faint, dashed preview of the commit that's about to exist
  async function doAdd() {
    const from = headNode();
    const p = nodePos(model.nodes.length);
    const conn = S.el("path", {
      d: connectorPath(from, { x: p.x, y: p.y, r: NODE_R }, 9),
      class: "edge-stroke", stroke: COLORS.main, "stroke-width": 2,
      "stroke-dasharray": "1 9", opacity: 0,
    });
    const ring = S.el("path", {
      d: S.circlePath(p.x, p.y, NODE_R, 9), class: "node-stroke",
      stroke: COLORS.main, "stroke-width": 2, "stroke-dasharray": "1 8", opacity: 0,
    });
    gEdges.appendChild(conn);
    gNodes.appendChild(ring);
    const tag = caption("staged", p.x, p.y + NODE_R + 30, 120, true);
    requestAnimationFrame(() => {
      conn.style.transition = "opacity .4s ease";
      ring.style.transition = "opacity .4s ease";
      conn.style.opacity = "0.5";
      ring.style.opacity = "0.55";
    });
    model.pending = { els: [conn, ring, tag], pos: p };
  }

  async function doCommit(message) {
    const from = headNode();
    const p = model.pending ? model.pending.pos : nodePos(model.nodes.length);
    if (model.pending) {
      model.pending.els.forEach((el) => fadeOutRemove(el, 240));
      model.pending = null;
    }
    const node = {
      id: model.nodes.length, col: model.nodes.length, x: p.x, y: p.y,
      r: NODE_R, branch: "main", color: COLORS.main, shape: "circle",
    };
    await drawConnector(from, node, COLORS.main, node.id * 7 + 4);
    await drawNode(node, node.id * 13 + 6);
    model.nodes.push(node);
    model.head = node.id;
    placeTags(node, "main", COLORS.main);
    caption(message, node.x, node.y + node.r + 32, 320);
  }

  // ---- step machine -------------------------------------------------
  let stepIndex = 0;
  const steps = [
    {
      cmd: "init",
      test: (s) => /^init$/i.test(s),
      cue: "Every project begins the same way. <b>Start your repository.</b>",
      hint: "Type  init  and press enter to begin.",
      run: doInit,
    },
    {
      cmd: "add .",
      test: (s) => /^add(\s+\.|\s+-a|\s+--all)?$/i.test(s),
      cue: "Choose what to save. <b>git add</b> stages your changes for the next snapshot.",
      hint: "Stage everything with:  add .",
      run: doAdd,
    },
    {
      cmd: 'commit -m "first commit"',
      test: (s) => /^commit\s+-m\s+(["']).+?\1\s*$/i.test(s),
      extract: (s) => {
        const m = s.match(/-m\s+(["'])(.+?)\1/);
        return m ? m[2] : "first commit";
      },
      cue: "Save the snapshot. <b>git commit</b> records it with a short message.",
      hint: 'Add a message:  commit -m "first commit"',
      run: doCommit,
    },
  ];
  const END = {
    cue: "That's a commit: a snapshot you can always return to. <b>More is on the way.</b>",
    tease: "push is the next stroke. I'm drawing it now ✦",
  };

  function showStep(i) {
    if (i < steps.length) {
      setCue(steps[i].cue);
      cmd.placeholder = steps[i].cmd;
    } else {
      setCue(END.cue);
      cmd.placeholder = "";
    }
  }

  // ---- command line behaviour --------------------------------------
  function setCue(html) {
    cue.style.opacity = "0";
    setTimeout(() => {
      cue.innerHTML = html;
      cue.style.opacity = "";
    }, 220);
  }
  function showGhost(text) { ghost.textContent = text; ghost.classList.add("show"); }
  function clearGhost() { ghost.classList.remove("show"); }
  function nudge() {
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
  }
  function dockStage() {
    stage.classList.remove("is-centered");
    stage.classList.add("is-docked");
    stage.style.setProperty("--stage-y", `${Math.round(window.innerHeight * 0.67)}px`);
  }
  function normalize(raw) {
    return raw.trim().replace(/\s+/g, " ").replace(/^git\s+/i, "");
  }

  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const input = normalize(cmd.value);
    if (!input) return;

    if (stepIndex >= steps.length) { showGhost(END.tease); return; }
    const step = steps[stepIndex];
    if (!step.test(input)) { showGhost(step.hint); nudge(); return; }

    clearGhost();
    cmd.value = "";
    const arg = step.extract ? step.extract(input) : undefined;
    stepIndex++;
    busy = true;
    await step.run(arg);
    busy = false;
    showStep(stepIndex);
  });
  cmd.addEventListener("input", clearGhost);

  // ---- boot ---------------------------------------------------------
  function boot() {
    sizeBoard();
    stage.style.setProperty("--stage-y", "50%");
    drawRule(brandRule, COLORS.main, 11);
    drawRule(cliRule, COLORS.ink, 4);
    startAmbient();
    showStep(0);
    cmd.focus();
  }

  window.addEventListener("resize", () => {
    sizeBoard();
    if (stepIndex > 0) dockStage();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
