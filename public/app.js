/* app.ts — the tutorial controller.
 *
 * A small step machine drives a guided git lesson. Each step carries the full
 * command it wants, a plain-language explanation of what it does and why each
 * part matters, and a routine that draws its result on the board. The command
 * line highlights `git` as you type it and shows a ghost of the rest, which you
 * can complete with Tab. The graph model stays tiny so new commands slot in.
 *
 * Built so far: init, add, commit.
 */
import * as S from "./sketch.js";
const COLORS = {
    ink: "#2a2521",
    inkSoft: "#7a7060",
    main: "#2e5c9e",
    feature: "#c0492f",
    green: "#3f7a4e",
    remote: "#6b5ca5",
};
// the board is drawn ~20% larger than 1:1 by shrinking the viewBox under the
// full-size <svg>. One knob zooms every node, label and stroke together.
const ZOOM = 1.2;
// ---- DOM ------------------------------------------------------------
function need(id) {
    const e = document.getElementById(id);
    if (!e)
        throw new Error(`howtogit: missing #${id}`);
    return e;
}
function needSel(sel) {
    const e = document.querySelector(sel);
    if (!e)
        throw new Error(`howtogit: missing ${sel}`);
    return e;
}
const graph = need("graph");
const gEdges = need("edges");
const gNodes = need("nodes");
const gNib = need("ink-nib");
const gLabels = need("labels");
const stage = need("stage");
const form = need("cli");
const cmd = need("cmd");
const ink = need("ink");
const tabhint = need("tabhint");
const goalEl = need("goal");
const whyEl = need("why");
const partsEl = need("parts");
const nudgeEl = need("nudge");
const treeEl = need("filetree");
const treeList = need("tree-list");
const remoteTreeEl = need("remotetree");
const remoteList = need("remote-list");
const timelineEl = need("timeline");
const brandRule = needSel(".brand__rule");
const cliRule = needSel(".cli__rule");
const model = { nodes: [], head: null, headBranch: "main", branches: {}, tagEls: null, pending: null };
const GAP = 150; // horizontal distance between commits (viewBox units)
const LANE_GAP = 118; // vertical distance between branch lanes
const NODE_R = 28; // base node radius (viewBox units)
const BRANCH_PALETTE = ["#c0492f", "#3f7a4e", "#6b5ca5"]; // feature, then more
// viewBox dimensions: the drawing space, smaller than the screen by ZOOM
let viewW = window.innerWidth / ZOOM;
let viewH = window.innerHeight / ZOOM;
function boardCenter() {
    return { x: viewW / 2, y: viewH * 0.42 };
}
// column i sits to the right of the first node; lane shifts it onto a branch row
function nodePos(col, lane = 0) {
    const c = boardCenter();
    return { x: c.x + col * GAP, y: c.y + lane * LANE_GAP };
}
function headNode() {
    return model.nodes.find((n) => n.id === model.head);
}
function nodeById(id) {
    return id == null ? undefined : model.nodes.find((n) => n.id === id);
}
// ---- board sizing ---------------------------------------------------
function sizeBoard() {
    const w = window.innerWidth, h = window.innerHeight;
    viewW = w / ZOOM;
    viewH = h / ZOOM;
    graph.setAttribute("width", String(w));
    graph.setAttribute("height", String(h));
    graph.setAttribute("viewBox", `0 0 ${viewW} ${viewH}`);
}
// ---- the two underlines (brand + command line) ----------------------
function drawRule(svg, color, seed) {
    const vb = svg.viewBox.baseVal;
    const y = vb.height * 0.55;
    const d = S.linePath(vb.width * 0.03, y, vb.width * 0.97, y, seed, 0.8);
    svg.appendChild(S.el("path", {
        d, class: "edge-stroke", stroke: color,
        "stroke-width": Math.max(1.6, vb.height * 0.18),
    }));
}
// ---- ambient life: the ink "boils" only while it's being laid down --
// When nothing is drawing the board is completely still: a fixed warp and no
// sheet drift. Every stroke nudges `activeUntil` forward; the boil eases back
// to rest a beat after the last stroke, then the loop parks itself so an idle
// board costs nothing and never wanders.
const BOIL_REST = 1.6; // static warp scale held while idle
const BOIL_TAIL = 700; // keep boiling this long past the last stroke
let boilDisp = null;
let activeUntil = 0;
let boilRunning = false;
function boilLoop(now) {
    if (!boilDisp) {
        boilRunning = false;
        return;
    }
    if (now >= activeUntil) {
        // settle to a still, fixed warp and park until the next stroke
        boilDisp.setAttribute("scale", BOIL_REST.toFixed(2));
        boilRunning = false;
        return;
    }
    const t = now / 1000;
    // the ink warp breathes by degrees instead of clicking between frames
    boilDisp.setAttribute("scale", (1.8 + Math.sin(t * 0.85) * 0.8).toFixed(2));
    requestAnimationFrame(boilLoop);
}
// keep (or kick off) the boil because ink is moving right now
function nudgeBoil() {
    if (S.prefersReduced || !boilDisp)
        return;
    activeUntil = performance.now() + BOIL_TAIL;
    if (!boilRunning) {
        boilRunning = true;
        requestAnimationFrame(boilLoop);
    }
}
function startAmbient() {
    const turb = graph.querySelector("#boil feTurbulence");
    boilDisp = graph.querySelector("#boil feDisplacementMap");
    if (turb)
        turb.setAttribute("seed", "4"); // one fixed noise field, no snapping
    graph.style.transform = "none"; // the sheet stays put: no idle drift
    if (S.prefersReduced) {
        if (boilDisp)
            boilDisp.setAttribute("scale", "0");
        return;
    }
    // rest still until the first stroke nudges the boil awake
    if (boilDisp)
        boilDisp.setAttribute("scale", BOIL_REST.toFixed(2));
}
// every on-board stroke keeps the boil alive for its draw (plus a short tail)
function drawOn(pathEl, opts = {}) {
    nudgeBoil();
    const done = S.drawOn(pathEl, opts);
    void done.then(() => nudgeBoil());
    return done;
}
// when true, drawing happens with no animation (used for timeline replay)
let instant = false;
// ---- small animation helpers ---------------------------------------
function animateIn(node, delay = 0) {
    if (instant || S.prefersReduced)
        return;
    nudgeBoil();
    node.style.opacity = "0";
    node.style.transform = "translateY(6px) scale(0.9)";
    node.style.transformOrigin = "center";
    node.style.transition = "opacity .45s ease, transform .5s cubic-bezier(.16,1,.3,1)";
    requestAnimationFrame(() => setTimeout(() => {
        node.style.opacity = "1";
        node.style.transform = "translateY(0) scale(1)";
    }, delay));
}
function fadeOutRemove(node, dur = 300) {
    if (instant || S.prefersReduced) {
        node.remove();
        return;
    }
    nudgeBoil();
    node.style.transition = `opacity ${dur}ms ease`;
    node.style.opacity = "0";
    setTimeout(() => node.remove(), dur + 20);
}
// ---- shapes ---------------------------------------------------------
function shapePath(shape, x, y, r, seed) {
    if (shape === "square")
        return S.squarePath(x, y, r * 1.7, seed);
    return S.circlePath(x, y, r, seed);
}
// ---- drawing --------------------------------------------------------
async function drawNode(node, seed) {
    const main = S.el("path", {
        d: shapePath(node.shape, node.x, node.y, node.r, seed),
        class: "node-stroke", stroke: node.color, "stroke-width": 2.8,
    });
    const second = S.el("path", {
        d: shapePath(node.shape, node.x, node.y, node.r * 0.97, seed + 31),
        class: "node-stroke", stroke: node.color, "stroke-width": 1.5, opacity: 0.5,
    });
    gNodes.appendChild(main);
    gNodes.appendChild(second);
    if (instant)
        return; // already rendered in full
    await drawOn(main, { duration: 720, nibGroup: gNib, color: node.color });
    drawOn(second, { duration: 360 });
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
    if (instant)
        return; // already rendered in full
    await drawOn(p, { duration: 460, nibGroup: gNib, color });
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
// a pill centred on its own origin, so it can be translated into place
function makePill(text, color, seed) {
    const g = S.el("g");
    const w = text.length * 12 + 22;
    g.appendChild(S.el("path", {
        d: S.rectPath(0, 0, w, 30, seed), class: "tag-box",
        stroke: color, "stroke-width": 1.8, fill: "#efe7d2",
    }));
    const t = S.el("text", { x: 0, y: 7, "text-anchor": "middle", class: "tag", fill: color });
    t.textContent = text;
    g.appendChild(t);
    return g;
}
// Refs (branch names + HEAD) are persistent pills that MOVE to follow commits,
// rather than fading out and redrawing. Recompute every ref's target and glide
// each pill there; create new ones, drop gone ones.
const refPills = new Map();
let refTicks = null;
function refPosition(cx, cy, level) {
    return { x: cx, y: cy - NODE_R - 36 - level * 36 };
}
function ensurePill(key, label, color, seed) {
    let g = refPills.get(key);
    const isNew = !g;
    if (!g) {
        g = makePill(label, color, seed);
        g.classList.add("ref-pill");
        gLabels.appendChild(g);
        refPills.set(key, g);
    }
    return { g, isNew };
}
function placePill(g, p, animateNew) {
    // during instant replay (timeline seek) never schedule a deferred rAF: it
    // would fire after the seek finished and snap the pill back to a stale spot
    if (animateNew && !S.prefersReduced && !instant) {
        g.style.opacity = "0";
        g.style.transform = `translate(${p.x}px, ${p.y + 8}px) scale(0.9)`;
        requestAnimationFrame(() => {
            g.style.transform = `translate(${p.x}px, ${p.y}px) scale(1)`;
            g.style.opacity = "1";
        });
    }
    else {
        g.style.transform = `translate(${p.x}px, ${p.y}px) scale(1)`;
        g.style.opacity = "1";
    }
}
// is this branch still pointing at a commit on someone else's lane (i.e. it has
// no commit of its own yet)? Then we "project" it onto its own lane.
function isProjected(b) {
    const tip = nodeById(b.tip);
    return !!tip && tip.lane !== b.lane;
}
function branchAnchor(b) {
    const tip = nodeById(b.tip);
    if (!tip)
        return null;
    return isProjected(b) ? nodePos(tip.col + 1, b.lane) : { x: tip.x, y: tip.y };
}
function drawRefs() {
    // ticks + dashed branch stubs: cheap, redraw each time
    if (refTicks)
        refTicks.remove();
    refTicks = S.el("g");
    gLabels.appendChild(refTicks);
    const wanted = new Set();
    for (const [name, b] of Object.entries(model.branches)) {
        const tip = nodeById(b.tip);
        const a = branchAnchor(b);
        if (!tip || !a)
            continue;
        // a freshly created branch diverges onto its lane right away: a dashed stub
        // shoots from the commit up to a ghost node outline where its first commit
        // will land, with the label floating above that
        if (isProjected(b)) {
            refTicks.appendChild(S.el("path", {
                d: connectorPath(tip, { x: a.x, y: a.y, r: NODE_R }, 21),
                class: "edge-stroke", stroke: b.color, "stroke-width": 2,
                "stroke-dasharray": "1 8", opacity: 0.5,
            }));
            const ghost = b.shape === "square"
                ? S.squarePath(a.x, a.y, NODE_R * 1.7, 23)
                : S.circlePath(a.x, a.y, NODE_R, 23);
            refTicks.appendChild(S.el("path", {
                d: ghost, class: "node-stroke", stroke: b.color, "stroke-width": 2,
                "stroke-dasharray": "1 8", opacity: 0.5,
            }));
        }
        refTicks.appendChild(S.el("path", {
            d: S.linePath(a.x, a.y - NODE_R - 2, a.x, a.y - NODE_R - 22, 5, 0.6),
            class: "edge-stroke", stroke: COLORS.inkSoft, "stroke-width": 1.4,
        }));
        wanted.add(name);
        const bp = ensurePill(name, name, b.color, 2);
        placePill(bp.g, refPosition(a.x, a.y, 0), bp.isNew);
        if (model.headBranch === name) {
            wanted.add("HEAD");
            const hp = ensurePill("HEAD", "HEAD", COLORS.ink, 3);
            placePill(hp.g, refPosition(a.x, a.y, 1), hp.isNew);
        }
    }
    // drop refs that no longer exist
    for (const [name, g] of refPills) {
        if (!wanted.has(name)) {
            fadeOutRemove(g, 200);
            refPills.delete(name);
        }
    }
}
function caption(text, cx, y, delay, faint = false) {
    const t = S.el("text", {
        x: cx, y, "text-anchor": "middle", class: "commit-msg",
    });
    if (faint)
        t.setAttribute("opacity", "0.6");
    t.textContent = text;
    gLabels.appendChild(t);
    animateIn(t, delay);
    return t;
}
// ---- step actions ---------------------------------------------------
async function doInit() {
    const p = nodePos(0, 0);
    const node = {
        id: 0, col: 0, lane: 0, x: p.x, y: p.y, r: NODE_R,
        branch: "main", color: COLORS.main, shape: "circle",
    };
    model.nodes.push(node);
    model.head = 0;
    model.headBranch = "main";
    model.branches = { main: { color: COLORS.main, shape: "circle", lane: 0, tip: 0 } };
    dockStage();
    await drawNode(node, 3);
    drawRefs();
    caption("git init", node.x, node.y + node.r + 32, 360);
}
// where the current branch's next commit would land
function nextCommitPos() {
    const branch = model.branches[model.headBranch];
    if (!branch)
        return null;
    const parent = nodeById(branch.tip) ?? headNode();
    if (!parent)
        return null;
    return { parent, branch, pos: nodePos(parent.col + 1, branch.lane) };
}
// staging: a faint, dashed preview of the commit that's about to exist
async function doAdd() {
    const next = nextCommitPos();
    if (!next)
        return;
    const { parent, pos, branch } = next;
    const els = [];
    // on a projected branch the dashed stub + ghost node already show the spot;
    // on the trunk we draw a dashed connector and ring preview here
    if (!isProjected(branch)) {
        const conn = S.el("path", {
            d: connectorPath(parent, { x: pos.x, y: pos.y, r: NODE_R }, 9),
            class: "edge-stroke", stroke: branch.color, "stroke-width": 2,
            "stroke-dasharray": "1 9", opacity: 0,
        });
        const shape = branch.shape === "square" ? S.squarePath(pos.x, pos.y, NODE_R * 1.7, 9) : S.circlePath(pos.x, pos.y, NODE_R, 9);
        const ring = S.el("path", {
            d: shape, class: "node-stroke",
            stroke: branch.color, "stroke-width": 2, "stroke-dasharray": "1 8", opacity: 0,
        });
        gEdges.appendChild(conn);
        gNodes.appendChild(ring);
        els.push(conn, ring);
    }
    const tag = caption("staged", pos.x, pos.y + NODE_R + 30, 120, true);
    els.push(tag);
    if (instant) {
        els.forEach((e) => { e.style.opacity = e === tag ? "0.6" : "0.55"; });
    }
    else {
        requestAnimationFrame(() => {
            els.forEach((e) => {
                e.style.transition = "opacity .4s ease";
                e.style.opacity = e === tag ? "0.6" : "0.55";
            });
        });
    }
    model.pending = { els, pos };
}
async function doCommit(message = "first commit") {
    const next = nextCommitPos();
    if (!next)
        return;
    const { parent, branch } = next;
    const pos = model.pending ? model.pending.pos : next.pos;
    if (model.pending) {
        model.pending.els.forEach((e) => fadeOutRemove(e, 240));
        model.pending = null;
    }
    const node = {
        id: model.nodes.length, col: parent.col + 1, lane: branch.lane, x: pos.x, y: pos.y,
        r: NODE_R, branch: model.headBranch, color: branch.color, shape: branch.shape,
    };
    await drawConnector(parent, node, branch.color, node.id * 7 + 4);
    await drawNode(node, node.id * 13 + 6);
    model.nodes.push(node);
    model.head = node.id;
    branch.tip = node.id;
    drawRefs();
    caption(message, node.x, node.y + node.r + 32, 320);
}
// create a branch at the current commit: a new coloured ref, no new node yet
async function doBranch(arg) {
    const name = (arg ?? "feature").trim() || "feature";
    if (model.branches[name])
        return;
    const idx = Object.keys(model.branches).length - 1; // existing non-main count
    model.branches[name] = {
        color: BRANCH_PALETTE[idx % BRANCH_PALETTE.length],
        shape: "square",
        lane: -(idx + 1),
        tip: model.head,
    };
    drawRefs();
}
// switch HEAD onto a branch; new commits will land on its lane
async function doCheckout(arg) {
    const name = (arg ?? "").trim();
    const b = model.branches[name];
    if (!b)
        return;
    model.headBranch = name;
    model.head = b.tip;
    drawRefs();
}
// the remote's nickname and address, captured from `git remote add`
let remoteName = "origin";
let remoteUrl = "https://github.com/you/site.git";
// connecting a remote changes no graph; the remote panel slides in afterwards
async function doRemoteAdd(arg) {
    const m = (arg ?? "").match(/^git\s+remote\s+add\s+(\S+)\s+(\S+)/i);
    if (m) {
        remoteName = m[1];
        remoteUrl = m[2];
    }
}
// push: stamp origin/main onto main's tip commit; the remote panel then fills
async function doPush() {
    const mainTip = nodeById(model.branches.main?.tip ?? null) ?? headNode();
    if (!mainTip)
        return;
    pill(gLabels, "origin/main", mainTip.x, mainTip.y + mainTip.r + 66, COLORS.remote, 7, 120);
}
const atomText = (a) => (typeof a.text === "function" ? a.text() : a.text);
const atomSep = (atoms, i) => atoms[i].sep ?? (i === 0 ? "" : " ");
const A = (text, tone, opts = {}) => ({ text, tone, ...opts });
// a quoted message is three atoms: opening quote, the free text, closing quote,
// so typing the quote doesn't look like a wrong word and the text can have spaces
const msgAtoms = (suggest) => [
    A('"', "val"),
    A(suggest, "val", { sep: "", free: true }),
    A('"', "val", { sep: "" }),
];
// what a fully-typed command looks like (for replay + width sizing)
function canonical(step) {
    return step.atoms.map((a, i) => atomSep(step.atoms, i) + atomText(a)).join("");
}
const isUrl = (s) => /^https?:\/\/[^\s/]+\.[^\s/]+\/\S+$/i.test(s) || /^git@[^\s:]+:\S+$/i.test(s);
let stepIndex = 0;
const steps = [
    {
        key: "init",
        atoms: [A("git", "cmd", { sep: "" }), A("init", "cmd")],
        test: (s) => /^git\s+init$/i.test(s),
        hint: "Type  git init  to begin.",
        teach: {
            goal: "Start your repository",
            why: "Sets up a new, empty repository in the folder where it runs.",
            parts: [
                { t: "init", tone: "cmd", why: "create the empty repo (the .git folder)" },
            ],
        },
        run: doInit,
    },
    {
        key: "add",
        atoms: [A("git", "cmd", { sep: "" }), A("add", "cmd"), A(".", "val", { free: true })],
        test: (s) => /^git\s+add\s+(\.|-a|-A|--all)$/i.test(s),
        hint: "Stage everything with  git add .  (or  git add -A )",
        teach: {
            goal: "Pick what to save",
            why: "Choose which files go in the next snapshot.",
            parts: [
                { t: "add", tone: "cmd", why: "stage your changes" },
                { t: ".  /  -A", tone: "val", why: "the . means everything (so does -A)" },
            ],
        },
        run: doAdd,
    },
    {
        key: "commit",
        atoms: [
            A("git", "cmd", { sep: "" }), A("commit", "cmd"), A("-m", "flag"),
            ...msgAtoms("first commit"),
        ],
        test: (s) => /^git\s+commit\s+-m\s+(["']).+?\1\s*$/i.test(s),
        extract: (s) => {
            const m = s.match(/-m\s+(["'])(.+?)\1/);
            return m ? m[2] : "first commit";
        },
        hint: 'Save it with  git commit -m "your message"',
        teach: {
            goal: "Save a snapshot",
            why: "Records the staged files into history.",
            parts: [
                { t: "commit", tone: "cmd", why: "save that snapshot to history" },
                { t: "-m", tone: "flag", why: "attach a short message" },
            ],
        },
        run: doCommit,
    },
    {
        key: "branch",
        atoms: [A("git", "cmd", { sep: "" }), A("branch", "cmd"), A("feature", "val", { free: true })],
        test: (s) => /^git\s+branch\s+\S+$/i.test(s),
        extract: (s) => s.split(/\s+/)[2] ?? "feature",
        hint: "Name a branch:  git branch feature",
        teach: {
            goal: "Start a branch",
            why: "A branch is a separate line of work, so you can try things without touching main.",
            parts: [
                { t: "branch", tone: "cmd", why: "make a new branch at the current commit" },
                { t: "feature", tone: "val", why: "its name, yours to choose (here: feature)" },
            ],
        },
        run: doBranch,
    },
    {
        key: "checkout",
        atoms: [A("git", "cmd", { sep: "" }), A("checkout", "cmd"), A("feature", "val", { free: true })],
        test: (s) => /^git\s+checkout\s+\S+$/i.test(s),
        extract: (s) => s.split(/\s+/)[2] ?? "feature",
        hint: "Switch to it:  git checkout feature",
        teach: {
            goal: "Switch to the branch",
            why: "Move onto the branch. A branch only becomes its own line of history once you make a commit on it.",
            parts: [
                { t: "checkout", tone: "cmd", why: "move HEAD onto another branch" },
                { t: "feature", tone: "val", why: "the branch to switch to" },
            ],
        },
        run: doCheckout,
    },
    {
        key: "add2",
        atoms: [A("git", "cmd", { sep: "" }), A("add", "cmd"), A(".", "val", { free: true })],
        test: (s) => /^git\s+add\s+(\.|-a|-A|--all)$/i.test(s),
        hint: "Stage your change with  git add .",
        teach: {
            goal: "Stage your change",
            why: "You edited index.html on the feature branch. Stage it so it goes in the next commit.",
            parts: [
                { t: "add", tone: "cmd", why: "stage the change you just made" },
                { t: ".  /  -A", tone: "val", why: "the . means everything you changed" },
            ],
        },
        run: doAdd,
    },
    {
        key: "commit2",
        atoms: [
            A("git", "cmd", { sep: "" }), A("commit", "cmd"), A("-m", "flag"),
            ...msgAtoms("add feature"),
        ],
        test: (s) => /^git\s+commit\s+-m\s+(["']).+?\1\s*$/i.test(s),
        extract: (s) => {
            const m = s.match(/-m\s+(["'])(.+?)\1/);
            return m ? m[2] : "add feature";
        },
        hint: 'Commit on the branch:  git commit -m "add feature"',
        teach: {
            goal: "Commit on the branch",
            why: "Now feature splits off from main with its own commit.",
            parts: [
                { t: "commit", tone: "cmd", why: "save the snapshot on feature" },
                { t: "-m", tone: "flag", why: "attach a short message" },
            ],
        },
        run: doCommit,
    },
    {
        key: "remote",
        atoms: [
            A("git", "cmd", { sep: "" }), A("remote", "cmd"), A("add", "cmd"),
            A("origin", "val", { free: true }),
            A("https://", "flag"), A("github.com/", "flag", { sep: "" }),
            A("user", "flag", { sep: "", free: true }), A("/my-site.git", "flag", { sep: "" }),
        ],
        test: (s) => {
            const m = s.match(/^git\s+remote\s+add\s+(\S+)\s+(\S+)$/i);
            return !!m && isUrl(m[2]);
        },
        extract: (s) => s,
        hint: "The last part must be a url, e.g.  https://github.com/user/my-site.git",
        teach: {
            goal: "Connect a remote",
            why: "Optional, but it backs up your work and makes collaborating possible. Git works fine with no remote at all.",
            parts: [
                { t: "remote add", tone: "cmd", why: "save a link to a copy of your repo kept elsewhere" },
                { t: "origin", tone: "val", why: "the nickname we give the url, so you can type it instead of the full address next time" },
                { t: "the url", tone: "flag", why: "the address where the remote copy lives, usually in the cloud" },
            ],
        },
        run: doRemoteAdd,
    },
    {
        key: "push",
        atoms: [
            A("git", "cmd", { sep: "" }), A("push", "cmd"), A("-u", "flag"),
            A(() => remoteName, "val", { free: true }), A("main", "val"),
        ],
        test: (s) => /^git\s+push(\s+-u\s+\S+\s+main)?$/i.test(s),
        hint: "Send your commits:  git push -u origin main",
        teach: {
            goal: "Send it to the remote",
            why: "Upload your commits so the remote copy has them too.",
            parts: [
                { t: "push", tone: "cmd", why: "upload your commits to the remote" },
                { t: "-u", tone: "flag", why: "upstream: tie this branch to the remote so next time you can just type git push" },
                { t: "origin", tone: "val", why: "which remote to send to (the nickname you chose)" },
                { t: "main", tone: "val", why: "which branch to send (main is your default branch)" },
            ],
        },
        run: doPush,
    },
];
const END = {
    teach: {
        goal: "It's on the remote",
        why: "Your local repo and the remote now share the same history.",
        parts: [],
    },
    tease: "That's the whole first loop. More git is on the way ✦",
};
function currentAtoms() {
    return stepIndex < steps.length ? steps[stepIndex].atoms : null;
}
function renderTeach(teach) {
    goalEl.textContent = teach.goal;
    whyEl.textContent = teach.why;
    partsEl.replaceChildren();
    for (const p of teach.parts) {
        const row = document.createElement("div");
        row.className = "part";
        const tok = document.createElement("span");
        tok.className = `tok tok--${p.tone}`;
        tok.textContent = p.t;
        const why = document.createElement("span");
        why.className = "why";
        why.textContent = p.why;
        row.append(tok, why);
        partsEl.appendChild(row);
    }
}
function showStep(i) {
    const teach = i < steps.length ? steps[i].teach : END.teach;
    const lesson = goalEl.parentElement;
    if (lesson && !S.prefersReduced) {
        lesson.style.opacity = "0";
        setTimeout(() => { renderTeach(teach); lesson.style.opacity = ""; }, 200);
    }
    else {
        renderTeach(teach);
    }
    updateInk();
}
// ---- command line: live highlight + ghost suggestion ----------------
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
let suggestActive = false;
// the suggestion for atoms[start..], fully unfilled, with their separators
function suggestFrom(atoms, start, includeFirstSep) {
    let g = "";
    for (let j = start; j < atoms.length; j++) {
        const sep = j === start && !includeFirstSep ? "" : atomSep(atoms, j);
        g += sep + atomText(atoms[j]);
    }
    return g;
}
// walk typed against the atoms and return: the coloured html of what's typed
// (with wrong chars in a fixed word marked as errors), the ghost still to type,
// and the chunk one Tab would add. A typo in a fixed word does NOT erase the
// ghost: the rest of the command keeps previewing.
function analyze(typed, atoms) {
    let pos = 0, html = "", ghost = "", chunk = "", invalid = false, chunkSet = false;
    const setChunk = (s) => { if (!chunkSet) {
        chunk = s;
        chunkSet = true;
    } };
    const span = (tone, s) => `<span class="hl-${tone}">${esc(s)}</span>`;
    for (let a = 0; a < atoms.length; a++) {
        const sep = atomSep(atoms, a);
        if (sep) {
            if (typed.startsWith(sep, pos)) {
                html += esc(sep);
                pos += sep.length;
            }
            else if (pos >= typed.length) {
                ghost = suggestFrom(atoms, a, true);
                setChunk(sep + atomText(atoms[a]));
                return { html, ghost, chunk, invalid };
            }
            else {
                html += `<span class="hl-invalid hl-err">${esc(typed.slice(pos))}</span>`;
                return { html, ghost, chunk, invalid: true };
            }
        }
        const text = atomText(atoms[a]);
        const rem = typed.slice(pos);
        if (atoms[a].rest) {
            if (rem.length === 0) {
                ghost = text;
                setChunk(text);
            }
            else
                html += span(atoms[a].tone, rem);
            return { html, ghost, chunk, invalid };
        }
        if (rem.length === 0) {
            ghost = suggestFrom(atoms, a, false);
            setChunk(text);
            return { html, ghost, chunk, invalid };
        }
        if (atoms[a].free) {
            const next = atoms[a + 1];
            const stop = next ? (atomSep(atoms, a + 1) || atomText(next)[0] || " ") : " ";
            const stopIdx = rem.indexOf(stop);
            if (stopIdx === -1) {
                html += span(atoms[a].tone, rem);
                pos = typed.length;
                if (rem.length < text.length && text.toLowerCase().startsWith(rem.toLowerCase())) {
                    // still completing this slot's suggestion
                    ghost = text.slice(rem.length) + suggestFrom(atoms, a + 1, true);
                    setChunk(text.slice(rem.length));
                }
                else {
                    // fully matched the suggestion, or a custom value: Tab moves to next atom
                    ghost = suggestFrom(atoms, a + 1, true);
                    setChunk(next ? atomSep(atoms, a + 1) + atomText(next) : "");
                }
                return { html, ghost, chunk, invalid };
            }
            html += span(atoms[a].tone, rem.slice(0, stopIdx));
            pos += stopIdx;
            continue;
        }
        if (rem.startsWith(text)) {
            html += span(atoms[a].tone, text);
            pos += text.length;
            continue;
        }
        if (text.startsWith(rem)) {
            html += span(atoms[a].tone, rem);
            pos = typed.length;
            ghost = text.slice(rem.length) + suggestFrom(atoms, a + 1, true);
            setChunk(text.slice(rem.length));
            return { html, ghost, chunk, invalid };
        }
        // diverged inside a fixed word: keep the good prefix, error the bad chars,
        // underline the word, and keep ghosting whatever comes after it
        const spaceIdx = rem.indexOf(" ");
        const word = spaceIdx === -1 ? rem : rem.slice(0, spaceIdx);
        let cp = 0;
        while (cp < word.length && cp < text.length && word[cp].toLowerCase() === text[cp].toLowerCase())
            cp++;
        html += `<span class="hl-invalid">${cp ? span(atoms[a].tone, word.slice(0, cp)) : ""}<span class="hl-err">${esc(word.slice(cp))}</span></span>`;
        pos += word.length;
        invalid = true;
        continue;
    }
    return { html, ghost, chunk, invalid };
}
function updateInk() {
    const typed = cmd.value;
    const atoms = currentAtoms();
    const a = atoms ? analyze(typed, atoms) : { html: esc(typed), ghost: "", chunk: "", invalid: false };
    const ghost = a.ghost;
    suggestActive = ghost.length > 0;
    let html = a.html;
    if (suggestActive)
        html += `<span class="hl-ghost">${esc(ghost)}</span>`;
    ink.innerHTML = html;
    // size the field to the whole line so it stays centred and never gets cut
    const full = typed.length + ghost.length;
    cmd.style.width = `${Math.max(full, 6) + 1}ch`;
    syncCliRule();
    ink.style.transform = `translateX(${-cmd.scrollLeft}px)`;
    tabhint.classList.toggle("show", suggestActive && typed.trim().length > 0);
    // live tip: flag a non-origin remote nickname the moment it diverges
    if (atoms && steps[stepIndex]?.key === "remote") {
        const name = typed.trim().split(/\s+/)[3];
        if (name && !"origin".startsWith(name.toLowerCase())) {
            showInfo("origin is the standard name. most tools expect it.");
        }
        else {
            clearNudge();
        }
    }
}
// redraw the underline as a fresh hand-drawn line at the field's real width,
// so it never gets stretched out of shape when the command is long
function syncCliRule() {
    const field = cmd.parentElement;
    if (!field)
        return;
    const w = Math.max(40, Math.round(field.clientWidth));
    cliRule.setAttribute("viewBox", `0 0 ${w} 12`);
    cliRule.replaceChildren(S.el("path", {
        d: S.linePath(3, 7, w - 3, 7, 4, 0.7),
        class: "edge-stroke", stroke: COLORS.ink, "stroke-width": 2,
    }));
}
// Tab completes only the next atom (one word, or one url segment)
function acceptNextWord() {
    const atoms = currentAtoms();
    if (!atoms)
        return;
    const { chunk } = analyze(cmd.value, atoms);
    if (!chunk)
        return;
    const newVal = cmd.value + chunk;
    cmd.value = newVal;
    cmd.setSelectionRange(newVal.length, newVal.length);
    updateInk();
}
function caretAtEnd() {
    return cmd.selectionStart === cmd.value.length && cmd.selectionEnd === cmd.value.length;
}
// ---- command line behaviour ----------------------------------------
function showNudge(text) {
    nudgeEl.textContent = text;
    nudgeEl.classList.remove("info");
    nudgeEl.classList.add("show");
}
function showInfo(text) {
    nudgeEl.textContent = text;
    nudgeEl.classList.add("show", "info");
}
function clearNudge() { nudgeEl.classList.remove("show", "info"); }
function shake() {
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
    return raw.trim().replace(/\s+/g, " ");
}
let busy = false;
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy)
        return;
    const input = normalize(cmd.value);
    if (!input)
        return;
    if (stepIndex >= steps.length) {
        showNudge(END.tease);
        return;
    }
    const step = steps[stepIndex];
    if (!step.test(input)) {
        showNudge(/^git\b/i.test(input) ? step.hint : "Every git command starts with  git");
        shake();
        return;
    }
    clearNudge();
    const arg = step.extract ? step.extract(input) : undefined;
    cmd.value = "";
    stepIndex++;
    // advance the lesson + ghost immediately, before the drawing animates
    showStep(stepIndex);
    updateTimeline();
    busy = true;
    await step.run(arg);
    busy = false;
    renderFileTree();
    renderRemoteTree();
    updateLayout();
});
cmd.addEventListener("input", () => { clearNudge(); updateInk(); });
cmd.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && suggestActive) {
        e.preventDefault();
        acceptNextWord();
    }
    else if (e.key === "ArrowRight" && suggestActive && caretAtEnd()) {
        e.preventDefault();
        acceptNextWord();
    }
});
// keep the coloured overlay aligned when a long command scrolls the input
cmd.addEventListener("scroll", () => {
    ink.style.transform = `translateX(${-cmd.scrollLeft}px)`;
});
// keep the only input focused: typing should always land, no clicking required
function keepFocus() {
    if (!document.hidden)
        cmd.focus();
}
cmd.addEventListener("blur", () => requestAnimationFrame(keepFocus));
document.addEventListener("click", keepFocus);
// ---- file tree (left) ----------------------------------------------
const PROJECT = { root: "my-site", files: ["index.html", "style.css", "app.js"] };
const EDIT_FILE = PROJECT.files[0]; // the file we "edit" on the feature branch
const MARK = { plain: "", untracked: "·", modified: "M", staged: "+", committed: "✓" };
// step index of a step by key (so inserting steps doesn't break thresholds)
function stepIdx(key) {
    return steps.findIndex((s) => s.key === key);
}
// the baseline disk state for the project (stepIndex is the next step to do)
function fileStateForStep(i) {
    if (i <= stepIdx("init"))
        return "plain";
    if (i <= stepIdx("add"))
        return "untracked";
    if (i <= stepIdx("commit"))
        return "staged";
    return "committed";
}
// per-file state: index.html gets edited on the branch, so it diverges from the
// baseline between checkout and the feature commit
function fileState(file) {
    if (file === EDIT_FILE) {
        if (stepIndex === stepIdx("add2"))
            return "modified"; // edited, not staged
        if (stepIndex === stepIdx("commit2"))
            return "staged"; // staged the edit
    }
    return fileStateForStep(stepIndex);
}
let lastGitPresent = false;
let wasEditing = false;
function renderFileTree() {
    const gitPresent = stepIndex > stepIdx("init");
    const editing = stepIndex === stepIdx("add2");
    treeList.replaceChildren();
    const root = document.createElement("li");
    root.className = "d";
    root.append(makeName(`${PROJECT.root}/`));
    treeList.appendChild(root);
    if (gitPresent) {
        const git = document.createElement("li");
        git.className = "f d--git";
        if (!lastGitPresent)
            git.classList.add("is-new");
        const note = document.createElement("span");
        note.className = "f__note";
        note.textContent = "git lives here";
        git.append(makeName(".git/"), note);
        treeList.appendChild(git);
    }
    for (const f of PROJECT.files) {
        const st = fileState(f);
        const li = document.createElement("li");
        li.className = st === "plain" ? "f" : `f f--${st}`;
        if (f === EDIT_FILE && st === "modified" && !wasEditing)
            li.classList.add("is-edited");
        li.append(makeName(f));
        if (MARK[st]) {
            const m = document.createElement("span");
            m.className = "f__mark";
            m.textContent = MARK[st];
            li.appendChild(m);
        }
        if (f === EDIT_FILE && st === "modified") {
            const note = document.createElement("span");
            note.className = "f__note";
            note.textContent = "just edited";
            li.appendChild(note);
        }
        treeList.appendChild(li);
    }
    lastGitPresent = gitPresent;
    wasEditing = editing;
}
function makeName(text) {
    const s = document.createElement("span");
    s.className = "f__name";
    s.textContent = text;
    return s;
}
// ---- remote tree (right) -------------------------------------------
let lastRemoteShown = false;
let lastRemotePushed = false;
function renderRemoteTree() {
    const shown = stepIndex > stepIdx("remote"); // git remote add done
    const pushed = stepIndex > stepIdx("push"); // git push done
    remoteTreeEl.classList.toggle("is-shown", shown);
    remoteList.replaceChildren();
    if (!shown) {
        lastRemoteShown = false;
        lastRemotePushed = false;
        return;
    }
    const url = document.createElement("li");
    url.className = "remote-url";
    url.textContent = remoteUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
    remoteList.appendChild(url);
    const root = document.createElement("li");
    root.className = "d";
    root.append(makeName(`${PROJECT.root}/`));
    remoteList.appendChild(root);
    const git = document.createElement("li");
    git.className = "f d--git";
    if (!lastRemoteShown)
        git.classList.add("is-new");
    const note = document.createElement("span");
    note.className = "f__note";
    note.textContent = "the remote repo";
    git.append(makeName(".git/"), note);
    remoteList.appendChild(git);
    if (pushed) {
        for (const f of PROJECT.files) {
            const li = document.createElement("li");
            li.className = "f f--committed";
            if (!lastRemotePushed)
                li.classList.add("is-new");
            li.append(makeName(f));
            const m = document.createElement("span");
            m.className = "f__mark";
            m.textContent = MARK.committed;
            li.appendChild(m);
            remoteList.appendChild(li);
        }
    }
    else {
        const empty = document.createElement("li");
        empty.className = "remote-empty";
        empty.textContent = "nothing pushed yet";
        remoteList.appendChild(empty);
    }
    lastRemoteShown = shown;
    lastRemotePushed = pushed;
}
// once a remote exists the local tree shares the stage; before that it leads
function updateLayout() {
    const paired = stepIndex > stepIdx("remote");
    treeEl.classList.toggle("is-focus", !paired);
    treeEl.classList.toggle("is-paired", paired);
}
// ---- timeline (bottom, clickable) ----------------------------------
const tlItems = [];
function buildTimeline() {
    timelineEl.replaceChildren();
    steps.forEach((st, i) => {
        if (i > 0) {
            const link = document.createElement("span");
            link.className = "tl-link";
            timelineEl.appendChild(link);
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tl-item";
        const dot = document.createElement("span");
        dot.className = "tl-dot";
        const label = document.createElement("span");
        label.className = "tl-label";
        label.textContent = `git ${st.key.replace(/\d+$/, "")}`;
        btn.append(dot, label);
        btn.title = `Jump to: git ${st.key}`;
        btn.addEventListener("click", () => { void seekTo(i); });
        timelineEl.appendChild(btn);
        tlItems.push(btn);
    });
    updateTimeline();
}
function updateTimeline() {
    tlItems.forEach((btn, i) => {
        btn.classList.toggle("is-done", i < stepIndex);
        btn.classList.toggle("is-current", i === stepIndex);
    });
}
// ---- seek: rebuild instantly to a chosen step ----------------------
function resetBoard() {
    [gEdges, gNodes, gNib, gLabels].forEach((g) => g.replaceChildren());
    model.nodes = [];
    model.head = null;
    model.headBranch = "main";
    model.branches = {};
    model.tagEls = null;
    model.pending = null;
    refPills.clear();
    refTicks = null;
}
async function seekTo(target) {
    if (busy || target === stepIndex)
        return;
    busy = true;
    resetBoard();
    if (target <= 0) {
        stage.classList.remove("is-docked");
        stage.classList.add("is-centered");
        stage.style.setProperty("--stage-y", "50%");
    }
    instant = true;
    for (let k = 0; k < target; k++) {
        const st = steps[k];
        await st.run(st.extract ? st.extract(canonical(st)) : undefined);
    }
    instant = false;
    stepIndex = target;
    cmd.value = "";
    showStep(stepIndex);
    updateTimeline();
    renderFileTree();
    renderRemoteTree();
    updateLayout();
    busy = false;
    cmd.focus();
}
// ---- boot -----------------------------------------------------------
function boot() {
    sizeBoard();
    stage.style.setProperty("--stage-y", "50%");
    drawRule(brandRule, COLORS.main, 11);
    startAmbient();
    showStep(0); // draws the command underline at the right width via updateInk
    buildTimeline();
    renderFileTree();
    renderRemoteTree();
    // No file editor exists yet, so the local tree leads (is-focus) until a remote
    // appears. When the editor lands, the compact corner state takes over instead.
    updateLayout();
    cmd.focus();
}
window.addEventListener("resize", () => {
    sizeBoard();
    if (stepIndex > 0)
        dockStage();
    updateInk(); // recompute field width + redraw the underline
});
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
}
else {
    boot();
}
//# sourceMappingURL=app.js.map