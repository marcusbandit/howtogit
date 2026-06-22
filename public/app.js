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
import { replayTo, snapshot, } from "./repo.js";
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
// On a narrow phone we zoom OUT (smaller ZOOM = more board per screen) so the
// whole git graph — branch lanes and the merge diamond included — fits the
// width instead of crawling off the edges.
function computeZoom() {
    const w = window.innerWidth;
    if (w >= 760)
        return 1.2; // desktop / tablet: unchanged
    // phone: shrink so ~3 commit columns sit comfortably across the width
    return Math.max(0.5, Math.min(1.0, w / 470));
}
let ZOOM = computeZoom();
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
const gRemote = need("remote-graph");
const gRemoteInner = need("remote-graph-inner");
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
const noteEl = need("note");
const partsEl = need("parts");
const nudgeEl = need("nudge");
const treeEl = need("filetree");
const treeList = need("tree-list");
const remoteTreeEl = need("remotetree");
const remoteList = need("remote-list");
const timelineEl = need("timeline");
const companionEl = need("companion");
const companionList = need("companion-list");
const companionArrows = need("companion-arrows");
const brandRule = needSel(".brand__rule");
const cliRule = needSel(".cli__rule");
const model = { nodes: [], head: null, headBranch: "main", branches: {}, tagEls: null, pending: null };
const GAP = 150; // horizontal distance between commits (viewBox units)
const LANE_GAP = 118; // vertical distance between branch lanes
const NODE_R = 28; // base node radius (viewBox units)
const BRANCH_PALETTE = ["#c0492f", "#3f7a4e", "#6b5ca5"]; // feature, then more
// One graph line system, so every node ring + connector reads the same.
// Stroke weights match between a preview and the real commit it becomes, so
// solidifying never makes the line jump in thickness.
const EDGE_W = 2.4; // every connector (preview or committed)
const NODE_W = 2.8; // every node ring's main stroke
// The dash ladder runs least-real -> real: a branched lane is loose dashes, a
// staged commit tightens to denser dashes, a real commit is solid (no entry).
// "staged" is one look whether it lands on the trunk or a freshly branched lane.
const LINE = {
    ghost: { dash: "7 6", opacity: 0.5 }, // branched, nothing staged yet
    staged: { dash: "4 3", opacity: 0.65 }, // about to commit (trunk or branch)
};
// viewBox dimensions: the drawing space, smaller than the screen by ZOOM
let viewW = window.innerWidth / ZOOM;
let viewH = window.innerHeight / ZOOM;
function boardCenter() {
    return { x: viewW / 2, y: viewH * 0.5 }; // lowered so the local graph clears the remote
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
    ZOOM = computeZoom(); // re-fit on every resize / orientation change
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
        class: "node-stroke", stroke: node.color, "stroke-width": NODE_W,
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
        stroke: color, "stroke-width": EDGE_W,
    });
    gEdges.appendChild(p);
    if (instant)
        return; // already rendered in full
    await drawOn(p, { duration: 460, nibGroup: gNib, color });
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
            // two looks along the way to a real commit, from the shared ladder:
            //   branched, nothing staged -> loose dashes (LINE.ghost)
            //   staged on the branch      -> tighter dashes (LINE.staged)
            const st = b.staged ? LINE.staged : LINE.ghost;
            refTicks.appendChild(S.el("path", {
                d: connectorPath(tip, { x: a.x, y: a.y, r: NODE_R }, 21),
                class: "edge-stroke", stroke: b.color, "stroke-width": EDGE_W,
                "stroke-dasharray": st.dash, opacity: st.opacity,
            }));
            const ghost = b.shape === "square"
                ? S.squarePath(a.x, a.y, NODE_R * 1.7, 23)
                : S.circlePath(a.x, a.y, NODE_R, 23);
            refTicks.appendChild(S.el("path", {
                d: ghost, class: "node-stroke", stroke: b.color, "stroke-width": NODE_W,
                "stroke-dasharray": st.dash, opacity: st.opacity,
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
            // HEAD's ink colour is theme-driven in CSS (.pill--head) so it lightens
            // in dark mode instead of staying near-black; classList.add is idempotent.
            hp.g.classList.add("pill--head");
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
// ---- follow HEAD: glide the board so HEAD sits at the horizontal centre -----
// The graph grows rightward; rather than let it crawl off-screen, every step
// pans the whole board (all four layers move as one) so wherever HEAD landed is
// centred. Pills keep their own per-element transforms; this is the parent.
// The remote mini-graph (gRemote) is deliberately NOT panned: it stays centred
// on the screen's horizontal regardless of where the local graph has scrolled.
const boardGroups = [gEdges, gNodes, gNib, gLabels];
// the graph lives in a central box this fraction of the view wide. While the
// whole graph fits inside it we centre the graph on its own midpoint; only once
// it outgrows the box do we pin HEAD to the centre and let the older commits
// slide out into the faded edges. Keep in sync with --box-fade in style.css,
// which fades the outer (1 - BOX_FRAC) / 2 on each side.
const BOX_FRAC = 0.66;
function centerOnHead() {
    const xs = model.nodes.map((n) => n.x);
    let targetX;
    if (xs.length) {
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const margin = NODE_R * 2.4;
        if ((maxX - minX) + margin * 2 <= viewW * BOX_FRAC) {
            targetX = (minX + maxX) / 2; // fits the box: centre the graph
        }
        else {
            const h = headNode();
            targetX = h ? h.x : boardCenter().x; // outgrew the box: follow HEAD
        }
    }
    else {
        targetX = boardCenter().x;
    }
    const panX = viewW / 2 - targetX;
    boardPanX = panX; // the remote layer isn't panned, so it needs this to map a
    // local node's on-screen x into its own coordinate space
    for (const g of boardGroups) {
        g.style.transition = instant || S.prefersReduced
            ? "none"
            : "transform .6s cubic-bezier(.16,1,.3,1)";
        g.style.transform = `translateX(${panX}px)`;
    }
}
let boardPanX = 0;
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
    // on a projected branch the dashed stub + ghost are already on screen: restyle
    // them in place (loose dashes -> tighter staged dashes) so staging visibly
    // changes the look instead of drawing nothing. On the trunk we draw the
    // preview here, in the same staged style the branch case lands on.
    if (isProjected(branch)) {
        branch.staged = true;
        drawRefs();
    }
    else {
        const conn = S.el("path", {
            d: connectorPath(parent, { x: pos.x, y: pos.y, r: NODE_R }, 9),
            class: "edge-stroke", stroke: branch.color, "stroke-width": EDGE_W,
            "stroke-dasharray": LINE.staged.dash, opacity: 0,
        });
        const shape = branch.shape === "square" ? S.squarePath(pos.x, pos.y, NODE_R * 1.7, 9) : S.circlePath(pos.x, pos.y, NODE_R, 9);
        const ring = S.el("path", {
            d: shape, class: "node-stroke",
            stroke: branch.color, "stroke-width": NODE_W, "stroke-dasharray": LINE.staged.dash, opacity: 0,
        });
        gEdges.appendChild(conn);
        gNodes.appendChild(ring);
        els.push(conn, ring);
    }
    const tag = caption("staged", pos.x, pos.y + NODE_R + 30, 120, true);
    els.push(tag);
    const stagedOpacity = String(LINE.staged.opacity); // match the branch-staged look
    if (instant) {
        els.forEach((e) => { e.style.opacity = e === tag ? "0.6" : stagedOpacity; });
    }
    else {
        requestAnimationFrame(() => {
            els.forEach((e) => {
                e.style.transition = "opacity .4s ease";
                e.style.opacity = e === tag ? "0.6" : stagedOpacity;
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
    branch.staged = false; // the staged preview just became a real commit
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
// merge a branch into the one HEAD is on: a new commit on the current lane with
// two parents (the current tip and the merged branch's tip), so the diverged
// lanes visibly rejoin into a diamond.
async function doMerge(arg) {
    const name = (arg ?? "feature").trim() || "feature";
    const other = model.branches[name];
    const into = model.branches[model.headBranch];
    if (!other || !into)
        return;
    const intoTip = nodeById(into.tip);
    const otherTip = nodeById(other.tip);
    if (!intoTip || !otherTip)
        return;
    // land the merge commit one column past whichever parent is furthest right
    const col = Math.max(intoTip.col, otherTip.col) + 1;
    const pos = nodePos(col, into.lane);
    const node = {
        id: model.nodes.length, col, lane: into.lane, x: pos.x, y: pos.y,
        r: NODE_R, branch: model.headBranch, color: into.color, shape: into.shape,
    };
    // two connectors converge: one from the current tip, one from the branch tip
    // (drawn in the branch's colour so you can see where the work came from)
    await drawConnector(intoTip, node, into.color, node.id * 7 + 4);
    await drawConnector(otherTip, node, other.color, node.id * 7 + 9);
    await drawNode(node, node.id * 13 + 6);
    model.nodes.push(node);
    model.head = node.id;
    into.tip = node.id;
    drawRefs();
    caption(`merge ${name}`, node.x, node.y + node.r + 32, 320);
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
// push: origin/main catches up to main's tip. The first push also kicks off the
// float-up that copies the trunk into the remote mini-graph (see
// renderRemoteGraph). origin/main is one pill that glides to each pushed tip.
let originMain = null; // node id origin/main points at
let originPill = null;
async function doPush() {
    const mainTip = nodeById(model.branches.main?.tip ?? null) ?? headNode();
    if (!mainTip)
        return;
    const firstPush = originMain === null;
    originMain = mainTip.id;
    if (!originPill) {
        originPill = makePill("origin/main", COLORS.remote, 7);
        originPill.classList.add("ref-pill");
        gLabels.appendChild(originPill);
    }
    placePill(originPill, { x: mainTip.x, y: mainTip.y + mainTip.r + 66 }, firstPush);
}
// when the whole sequence is finished, the board shouldn't read as blank: a
// hand-written closing line sits under HEAD so it's clearly the end, not a gap.
function showEndState() {
    const h = headNode();
    if (!h)
        return;
    caption("that's the whole first loop — nothing left to do ✦", h.x, h.y + h.r + 100, 420, true);
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
            // the landing's lesson is just the hook; why/parts stay empty so the swap
            // into "git add" grows the lesson cleanly instead of flashing stale copy
            goal: "Your first repository starts here.",
            why: "",
            parts: [],
        },
        curiosity: {
            cmd: "git init",
            // before you run it: nothing exists yet, so the questions look forward
            pre: [
                {
                    q: "what even is git?",
                    a: "git keeps a history of your project: every version you save, so you can look back, undo a mistake, and try things without fear of losing your work.",
                },
                {
                    q: "what's <b>git init</b> about to do?",
                    a: "it turns this plain folder into a git repository, so git can start keeping track of it. you only ever do this once per project.",
                },
            ],
            // after it runs: .git/ now exists, so the questions look back at what happened
            post: [
                {
                    q: "wait, what just happened?",
                    a: "your folder is now a git repository. nothing about your own files changed, git just added a place to keep track of them.",
                },
                {
                    q: "what's this <b>.git/</b> that showed up?",
                    a: "that's where git stores everything it remembers: every snapshot you save, the branches you make, and a pointer called HEAD that marks where you are. delete <b>.git/</b> and it's an ordinary folder again.",
                    points: "dotgit",
                },
                {
                    q: "why do we even need it?",
                    a: "without it, your files are just files. with it, you get history, undo, branches, and a way to share, everything the rest of this page teaches.",
                },
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
                { t: '"message"', tone: "val", why: "a short note describing what this snapshot changed" },
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
            why: "A remote is a copy of your project that lives online, so your work stays safe even if something happens to your computer. This points your repo at one.",
            note: "Optional, and easiest to set up now, before you start branching. Git works fine with no remote at all.",
            parts: [
                { t: "remote add", tone: "cmd", span: 2, why: "save a link to a copy of your repo kept elsewhere" },
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
        test: (s) => /^git\s+push\s+-u\s+\S+\s+main$/i.test(s),
        hint: "Send your commit up:  git push -u origin main",
        teach: {
            goal: "Send it to the remote",
            why: "Upload your commit so the remote has it too. This is the first time your work leaves your computer — the remote now holds a copy of your tree.",
            parts: [
                { t: "push", tone: "cmd", why: "upload your commits to the remote" },
                { t: "-u", tone: "flag", why: "upstream: tie this branch to the remote so next time you can just type git push" },
                { t: "origin", tone: "val", why: "which remote to send to (the nickname you chose)" },
                { t: "main", tone: "val", why: "which branch to send (main is your default branch)" },
            ],
        },
        run: doPush,
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
                { t: '"message"', tone: "val", why: "describe the change (here: add feature)" },
            ],
        },
        run: doCommit,
    },
    {
        key: "checkout-main",
        atoms: [A("git", "cmd", { sep: "" }), A("checkout", "cmd"), A("main", "val", { free: true })],
        test: (s) => /^git\s+checkout\s+main$/i.test(s),
        extract: (s) => s.split(/\s+/)[2] ?? "main",
        hint: "Go back to main first:  git checkout main",
        teach: {
            goal: "Switch back to main",
            why: "You merge into the branch you're standing on, so move onto main before bringing the feature in.",
            parts: [
                { t: "checkout", tone: "cmd", why: "move HEAD back onto main" },
                { t: "main", tone: "val", why: "the branch you want the feature merged into" },
            ],
        },
        run: doCheckout,
    },
    {
        key: "merge",
        atoms: [A("git", "cmd", { sep: "" }), A("merge", "cmd"), A("feature", "val", { free: true })],
        test: (s) => /^git\s+merge\s+\S+$/i.test(s),
        extract: (s) => s.split(/\s+/)[2] ?? "feature",
        hint: "Bring the branch in:  git merge feature",
        teach: {
            goal: "Merge the branch back",
            why: "Combine the feature branch's commit into main, so main has all the work. The two lanes rejoin.",
            parts: [
                { t: "merge", tone: "cmd", why: "join another branch's commits into this one" },
                { t: "feature", tone: "val", why: "the branch whose work you're bringing in" },
            ],
        },
        run: doMerge,
    },
    {
        key: "push2",
        atoms: [A("git", "cmd", { sep: "" }), A("push", "cmd")],
        test: (s) => /^git\s+push$/i.test(s),
        hint: "Send the merge up:  git push",
        teach: {
            goal: "Send the merge up",
            why: "You already set the upstream with -u, so a bare git push sends main — merge and all — to the remote. The remote tree catches up to yours.",
            parts: [
                { t: "push", tone: "cmd", why: "upload the new commits to the remote you already linked" },
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
// the lesson now reveals one part at a time: the part the text cursor is
// currently sitting in. `activeParts` is the current step's list; `activePart`
// is which one is on screen, so we only re-render (and re-animate) on a change.
let activeParts = [];
let activePart = -2;
// true during a step's lesson cross-fade. While set, the caption is swapped
// instantly (under the fade) instead of scroll-animating, so a step change
// never looks like the caption rewinding through its parts.
let lessonSwapping = false;
function renderTeach(teach) {
    goalEl.textContent = teach.goal;
    whyEl.textContent = teach.why;
    whyEl.hidden = !teach.why;
    noteEl.textContent = teach.note ?? "";
    noteEl.hidden = !teach.note;
    activeParts = teach.parts;
    renderActivePart(true, true); // step change: swap instantly, no scroll
}
// which word the caret is in: word 0 is the command name, then one word per
// token. A caret resting just after a space belongs to the upcoming word.
function caretWordIndex(typed, caret) {
    const before = typed.slice(0, caret);
    const words = before.match(/\S+/g);
    if (!words)
        return 0;
    if (caret > 0 && /\s/.test(typed[caret - 1]))
        return words.length;
    return words.length - 1;
}
// map the caret's word onto a part. Word 0 (git itself) shows the first part;
// each part then claims `span` words (default 1); trailing words (a long commit
// message) stay on the last part.
function activePartIndex() {
    if (activeParts.length === 0)
        return -1;
    const word = caretWordIndex(cmd.value, cmd.selectionStart ?? cmd.value.length);
    if (word <= 1)
        return 0;
    let w = 1;
    for (let pi = 0; pi < activeParts.length; pi++) {
        const span = activeParts[pi].span ?? 1;
        if (word >= w && word < w + span)
            return pi;
        w += span;
    }
    return activeParts.length - 1;
}
function buildPartRow(p) {
    const row = document.createElement("div");
    row.className = "part";
    const tok = document.createElement("span");
    tok.className = `tok tok--${p.tone}`;
    tok.textContent = p.t;
    const why = document.createElement("span");
    why.className = "why";
    why.textContent = p.why;
    row.append(tok, why);
    return row;
}
function renderActivePart(force = false, instant = false) {
    // mid step cross-fade: leave the caption alone (the step swap renders it once,
    // instantly). Without this, the immediate updateInk() after a step advance
    // would scroll the old step's caption back to its first part.
    if (lessonSwapping && !force)
        return;
    const idx = activePartIndex();
    const prev = activePart;
    if (!force && idx === prev)
        return;
    activePart = idx;
    // instant swap (step change) or reduced motion: no scroll
    if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        partsEl.replaceChildren();
        if (idx >= 0)
            partsEl.appendChild(buildPartRow(activeParts[idx]));
        return;
    }
    // vertical push: the strip scrolls so the new caption replaces the old one.
    // Advancing through the command (or a step change) scrolls up: the old line
    // exits the top while the new one rises in from below. Moving the caret back
    // scrolls down. The old row goes absolute so the incoming row owns the height,
    // then removes itself once it has scrolled out.
    const back = !force && prev >= 0 && idx < prev;
    for (const el of Array.from(partsEl.querySelectorAll(".part:not(.part--out)"))) {
        el.classList.remove("part--in-up", "part--in-down");
        el.classList.add("part--out", back ? "part--out-down" : "part--out-up");
        window.setTimeout(() => el.remove(), 380);
    }
    if (idx < 0)
        return;
    const row = buildPartRow(activeParts[idx]);
    row.classList.add(back ? "part--in-down" : "part--in-up");
    partsEl.appendChild(row);
}
function showStep(i) {
    const teach = i < steps.length ? steps[i].teach : END.teach;
    const lesson = goalEl.parentElement;
    if (lesson && !S.prefersReduced) {
        lessonSwapping = true;
        lesson.style.opacity = "0";
        setTimeout(() => {
            renderTeach(teach);
            lesson.style.opacity = "";
            // glide while docking off the landing (so the command line rides the dock
            // smoothly); snap for in-place lesson swaps between docked steps
            positionStage(docking);
            docking = false;
            lessonSwapping = false;
        }, 200);
    }
    else {
        renderTeach(teach);
        positionStage(false);
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
    renderActivePart();
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
// true only while the stage is gliding off the landing into its docked spot, so
// the lesson-height re-measure at the end of the swap glides too, instead of
// snapping mid-glide and making the command line jump.
let docking = false;
function dockStage() {
    stage.classList.remove("is-centered");
    stage.classList.add("is-docked");
    docking = true;
    positionStage(true);
}
// Bottom-align the docked stage: pin its lower edge a fixed gap above the
// timeline so the lesson + command line sit at the bottom of the screen and
// never ride up into the graph, whatever the lesson's height. Recomputed
// whenever the lesson swaps (its height changes) or the window resizes.
function positionStage(animate) {
    if (!stage.classList.contains("is-docked"))
        return;
    const gap = Math.max(104, Math.round(window.innerHeight * 0.11)); // clears the timeline
    const y = Math.round(window.innerHeight - gap - stage.offsetHeight / 2);
    if (animate) {
        stage.style.setProperty("--stage-y", `${y}px`);
    }
    else {
        // move without gliding when it's just the lesson height changing
        stage.style.transition = "none";
        stage.style.setProperty("--stage-y", `${y}px`);
        void stage.offsetWidth;
        stage.style.transition = "";
    }
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
    closeFileViewer(); // a new command changes the board: dismiss any open file
    const arg = step.extract ? step.extract(input) : undefined;
    cmd.value = "";
    stepIndex++;
    // advance the lesson + ghost immediately, before the drawing animates
    showStep(stepIndex);
    updateTimeline();
    // the companion steps back while the action happens, then returns to explain
    // what just appeared (its "post" set points at the now-real thing)
    setCompanion(null, "post");
    // hold `busy` across the WHOLE step — drawing AND the real-git replay — so a
    // second Enter or a timeline click can't run a concurrent replay on the
    // shared in-memory fs. finally guarantees the lock is released even if the
    // replay throws (otherwise the UI would freeze).
    busy = true;
    try {
        await step.run(arg);
        centerOnHead();
        if (stepIndex >= steps.length)
            showEndState();
        if (step.key === "commit")
            lastCommitMsg = arg ?? lastCommitMsg; // replay with the real message
        await refreshRepo(); // real git -> tree + states
        renderRemoteTree();
        renderRemoteGraph();
        updateLayout();
        syncCompanion();
    }
    finally {
        busy = false;
    }
    // landing on the feature branch means "you edited index.html": play it out
    if (stepIndex === stepIdx("add2"))
        void playEditSequence();
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
// caret moves (arrows, clicking into the line) change which part is shown.
// Wrap so the Event object is never passed as the `force` flag.
cmd.addEventListener("keyup", () => renderActivePart());
cmd.addEventListener("click", () => renderActivePart());
cmd.addEventListener("select", () => renderActivePart());
// keep the coloured overlay aligned when a long command scrolls the input
cmd.addEventListener("scroll", () => {
    ink.style.transform = `translateX(${-cmd.scrollLeft}px)`;
});
// On a phone, force-focusing the input means the soft keyboard can never be
// dismissed — it permanently eats half the screen. So there we let the user
// tap the command line when they want to type. On desktop we keep the input
// focused so typing always lands without clicking.
const isPhone = window.matchMedia("(max-width: 760px)").matches
    || ("ontouchstart" in window);
// ...but never fight the user while they're selecting text. A learner should be
// able to drag across a label (to copy it, or paste it into a chatbot) without
// the input yanking focus back and collapsing the selection. So while the mouse
// is down (a drag in progress) or any text is selected, we leave focus alone.
let pointerDown = false;
document.addEventListener("mousedown", () => { pointerDown = true; });
document.addEventListener("mouseup", () => { pointerDown = false; });
// in learn mode, a click anywhere outside the companion means "I'm done looking,
// take me back to continuing" — let the focused question go
document.addEventListener("click", (e) => {
    if (!openBtn)
        return;
    if (!companionEl.contains(e.target))
        closeCurio(openBtn);
});
function hasSelection() {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}
function keepFocus() {
    if (isPhone)
        return;
    if (pointerDown || hasSelection())
        return; // mid-drag or text selected: leave it be
    if (!document.hidden)
        cmd.focus();
}
cmd.addEventListener("blur", () => requestAnimationFrame(keepFocus));
document.addEventListener("click", keepFocus);
// ---- file tree (left) ----------------------------------------------
const PROJECT = { root: "my-site", files: ["index.html", "style.css", "app.js"] };
const EDIT_FILE = PROJECT.files[0]; // the file we "edit" on the feature branch
// one check = saved in a local commit; two checks = delivered to the remote
const MARK = { plain: "", untracked: "·", modified: "M", staged: "+", committed: "✓", pushed: "✓✓" };
// step index of a step by key (so inserting steps doesn't break thresholds)
function stepIdx(key) {
    return steps.findIndex((s) => s.key === key);
}
// has this committed file actually reached the remote? The first push sends
// every file; index.html is re-committed on the branch (commit2), so it falls
// behind the remote again until that work is pushed with the merge (push2).
// (The remote is still simulated; this overlays "pushed" on top of real state.)
function isPushed(file) {
    if (stepIndex <= stepIdx("push"))
        return false; // first push not done
    if (file === EDIT_FILE && stepIndex > stepIdx("commit2") && stepIndex <= stepIdx("push2"))
        return false; // edited again, awaiting push2
    return true;
}
let lastGitPresent = false;
let wasEditing = false;
let pushedBefore = new Set(); // files already on the remote last render
// the file's state: the BASE (untracked/modified/staged/committed) comes from
// real git via the snapshot; the still-simulated branch edit + remote add the
// "modified on the branch" / "pushed" overlays on top, until those are real too.
function overlaidState(file, base) {
    if (file === EDIT_FILE && stepIndex === stepIdx("add2"))
        return "modified";
    if (file === EDIT_FILE && stepIndex === stepIdx("commit2"))
        return "staged";
    if (base === "committed" && isPushed(file))
        return "pushed";
    return base;
}
function renderFileTree() {
    const gitPresent = !!snap?.inited;
    const editing = stepIndex === stepIdx("add2");
    const remoteExists = stepIndex > stepIdx("remote"); // is there anywhere to push to yet?
    const pushedNow = new Set();
    const fileStates = new Map((snap?.files ?? []).map((f) => [f.name, f.state]));
    treeList.replaceChildren();
    underlineSeed = 0;
    // my-site/ is the (collapsible) project root; everything else lives inside it
    const root = document.createElement("li");
    root.className = "d is-expandable is-folder";
    root.dataset.path = "root";
    const rootOpen = treeOpen.has("root");
    if (rootOpen)
        root.classList.add("is-open");
    root.append(rootOpen ? folderIconOpen() : folderIcon(), makeNameUnderlined(`${PROJECT.root}/`));
    treeList.appendChild(root);
    const rootWrap = document.createElement("li");
    rootWrap.className = "tree__subwrap tree__subwrap--root" + (rootOpen ? " is-open" : "");
    const rootSub = document.createElement("ul");
    rootSub.className = "tree__sub";
    rootWrap.appendChild(rootSub);
    treeList.appendChild(rootWrap);
    if (gitPresent && snap) {
        // .git/ is a real, openable folder; its contents are the REAL repo's .git
        const git = document.createElement("li");
        git.className = "f d--git is-expandable is-folder";
        git.dataset.path = ".git";
        const gitOpen = treeOpen.has(".git");
        if (gitOpen)
            git.classList.add("is-open");
        if (!lastGitPresent)
            git.classList.add("is-new");
        const note = document.createElement("span");
        note.className = "f__note";
        note.textContent = "git lives here";
        git.append(gitOpen ? folderIconOpen() : folderIcon(), makeNameUnderlined(".git/"), note);
        rootSub.appendChild(git);
        const gitWrap = document.createElement("li");
        gitWrap.className = "tree__subwrap" + (gitOpen ? " is-open" : "");
        const gitSub = document.createElement("ul");
        gitSub.className = "tree__sub";
        snap.git.forEach((n, i) => appendGitNode(gitSub, n, i));
        gitWrap.appendChild(gitSub);
        rootSub.appendChild(gitWrap);
    }
    PROJECT.files.forEach((f) => {
        const st = overlaidState(f, fileStates.get(f) ?? "plain");
        const li = document.createElement("li");
        li.className = st === "plain" ? "f is-openable" : `f f--${st} is-openable`;
        li.dataset.file = f; // click to open it in the editor
        if (f === EDIT_FILE && st === "modified" && !wasEditing)
            li.classList.add("is-edited");
        if (st === "pushed")
            pushedNow.add(f);
        // the moment a file lands on the remote, give it a quick purple flash
        if (st === "pushed" && !pushedBefore.has(f))
            li.classList.add("is-pushed-now");
        li.append(fileIcon(f), makeNameUnderlined(f));
        if (MARK[st]) {
            const m = document.createElement("span");
            m.className = "f__mark";
            m.textContent = MARK[st];
            li.appendChild(m);
        }
        // spell out the commit-vs-push distinction next to the file
        let note = "";
        if (f === EDIT_FILE && st === "modified")
            note = "just edited";
        else if (st === "pushed")
            note = "pushed";
        else if (st === "committed" && remoteExists)
            note = "committed, not pushed";
        if (note) {
            const n = document.createElement("span");
            n.className = "f__note";
            n.textContent = note;
            li.appendChild(n);
        }
        rootSub.appendChild(li);
    });
    lastGitPresent = gitPresent;
    wasEditing = editing;
    pushedBefore = pushedNow;
}
// render one real .git node into a list. Folders nest recursively (a subwrap
// that opens); files are openable rows that show their contents in the editor.
function appendGitNode(ul, node, idx) {
    const open = treeOpen.has(node.path);
    const row = document.createElement("li");
    row.className = "tree__subitem";
    row.dataset.path = node.path;
    row.style.setProperty("--i", String(idx));
    const noteEl = document.createElement("span");
    noteEl.className = "f__note";
    noteEl.textContent = node.note;
    if (node.isDir) {
        row.classList.add("is-expandable", "is-folder");
        if (open)
            row.classList.add("is-open");
        row.append(open ? folderIconOpen() : folderIcon(), makeNameUnderlined(node.name), noteEl);
        ul.appendChild(row);
        const wrap = document.createElement("li");
        wrap.className = "tree__subwrap" + (open ? " is-open" : "");
        const sub = document.createElement("ul");
        sub.className = "tree__sub";
        const kids = node.children ?? [];
        if (kids.length)
            kids.forEach((c, i) => appendGitNode(sub, c, i));
        else
            sub.appendChild(emptyRow()); // an opened-but-empty folder still says so
        wrap.appendChild(sub);
        ul.appendChild(wrap);
    }
    else {
        // a file: clicking opens it in the editor (same as a project file)
        row.classList.add("is-openable", "is-gitfile");
        row.append(fileIcon(node.name), makeNameUnderlined(node.name), noteEl);
        ul.appendChild(row);
    }
}
function emptyRow() {
    const li = document.createElement("li");
    li.className = "tree__subitem tree__empty";
    li.style.setProperty("--i", "0");
    const n = document.createElement("span");
    n.className = "f__note";
    n.textContent = "(empty for now)";
    li.appendChild(n);
    return li;
}
function makeName(text) {
    const s = document.createElement("span");
    s.className = "f__name";
    s.textContent = text;
    return s;
}
// a name that grows the sketched hover underline, the shared "this row is
// interactive" cue used on every clickable row (folder or file)
let underlineSeed = 0;
function makeNameUnderlined(text) {
    const name = makeName(text);
    name.appendChild(makeUnderline((underlineSeed++) * 9 + 5));
    return name;
}
// ---- hand-drawn icons (same inked language as the board) ------------
// Built from the sketch helpers so the wobble matches everything else. Each is
// a 24x24 viewBox; colour comes from currentColor (set per type in CSS).
function mkIcon(kind) {
    const svg = S.el("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    svg.setAttribute("class", `ic ic--${kind}`);
    return svg;
}
function icStroke(svg, d) {
    svg.appendChild(S.el("path", { d, class: "ic-stroke" }));
}
// a sheet of paper with a folded corner and a couple of text lines
function fileIcon(file) {
    const svg = mkIcon(langOf(file)); // html / css / js -> colour
    icStroke(svg, S.smooth([[6.4, 3.6], [13.6, 3.3], [18.6, 8.2], [18.3, 20.4], [5.8, 20.6], [6.1, 3.7]], true));
    icStroke(svg, S.smooth([[13.4, 3.6], [13.9, 8.1], [18.4, 7.9]])); // the fold
    icStroke(svg, S.smooth([[8.6, 12.4], [15.2, 12.0]])); // text line
    icStroke(svg, S.smooth([[8.5, 15.4], [14.4, 15.1]])); // text line
    return svg;
}
function folderIcon() {
    const svg = mkIcon("folder");
    icStroke(svg, S.smooth([[3.4, 7.2], [8.8, 7.0], [10.7, 9.0], [20.4, 9.0], [20.6, 18.6], [3.6, 18.8], [3.3, 7.3]], true));
    return svg;
}
// the open-folder variant: the same folder with its lid swung up, so an opened
// folder reads differently from a closed one (no chevron needed)
function folderIconOpen() {
    const svg = mkIcon("folder");
    // back wall of the folder
    icStroke(svg, S.smooth([[3.4, 7.4], [8.7, 7.2], [10.6, 9.1], [20.4, 9.1], [20.5, 11.6]], false));
    // the open front: a flap fanned out toward the viewer
    icStroke(svg, S.smooth([[3.5, 18.7], [6.4, 12.0], [22.6, 11.8], [19.8, 18.6], [3.5, 18.7]], true));
    return svg;
}
function computerIcon() {
    const svg = mkIcon("computer");
    icStroke(svg, S.smooth([[3.3, 5.4], [20.7, 4.8], [20.4, 15.2], [3.6, 15.5], [3.4, 5.5]], true));
    icStroke(svg, S.smooth([[11.9, 15.4], [12.1, 18.4]])); // stand
    icStroke(svg, S.smooth([[8.4, 18.8], [15.6, 18.5]])); // base
    return svg;
}
function cloudIcon() {
    const svg = mkIcon("cloud");
    icStroke(svg, S.smooth([
        [7.5, 16.4], [5.0, 16.2], [3.5, 14.0], [4.6, 11.6], [7.0, 11.2],
        [7.8, 8.2], [11.0, 7.2], [13.8, 8.4], [14.8, 10.8],
        [17.6, 10.6], [19.2, 13.0], [18.0, 16.0], [14.5, 16.4], [7.5, 16.4],
    ], true));
    return svg;
}
// a sketched underline that draws on left->right (hover) and erases
// right->left (unhover). The reveal is a CSS clip-path inset, not a dash trick:
// because the line is stretched to the name's width (preserveAspectRatio=none)
// with a non-scaling stroke, dash lengths land in screen pixels and stop
// matching the line — clipping is purely geometric, so it works at any text size.
function makeUnderline(seed) {
    const svg = S.el("svg", {
        class: "f__underline", viewBox: "0 0 100 8",
        preserveAspectRatio: "none", "aria-hidden": "true",
    });
    svg.appendChild(S.el("path", {
        d: S.linePath(3, 5, 97, 5, seed, 1.1),
        class: "f__underline-stroke", "stroke-width": 1.8,
    }));
    return svg;
}
// ---- the make-believe file editor ----------------------------------
// When you land on the feature branch the story is "you edited index.html".
// Rather than just flip a flag in the tree, we play it out: an editor window
// opens over the board, a new line types itself into the file, then it saves
// and tucks away. Nothing here is a real editor; it's a visual beat.
const editorEl = need("editor");
const editorCode = need("editor-code");
const editorName = need("editor-name");
const editorUnsaved = need("editor-unsaved");
const editorSave = need("editor-save");
const EDIT_LINES = [
    "<!DOCTYPE html>",
    "<html>",
    "  <body>",
    "    <h1>my site</h1>",
    "  </body>",
    "</html>",
];
const EDIT_AT = 4; // insert just before </body>
const EDIT_NEW = "    <p>now with a feature!</p>";
// what each file holds when you open it. index.html is handled specially (it
// gains the feature line once edited); the others are static stand-ins.
const FILE_TEXT = {
    "index.html": EDIT_LINES,
    "style.css": [
        "body {",
        "  font-family: sans-serif;",
        "  margin: 0;",
        "}",
        "h1 {",
        "  color: #2e5c9e;",
        "}",
    ],
    "app.js": [
        "const btn = document.querySelector(\"button\");",
        "",
        "btn.addEventListener(\"click\", () => {",
        "  alert(\"hello from my site\");",
        "});",
    ],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the contents to show for a file, plus which line indices read as a local
// change (green, like a diff insertion). index.html gains the feature line; on
// the LOCAL side that line is a pending change while modified/staged (before
// commit2). The remote only gains the line at all on the final push, and never
// shows it as a pending change.
function fileLines(file, side) {
    if (file === EDIT_FILE) {
        const hasEdit = side === "local"
            ? stepIndex >= stepIdx("add2")
            : stepIndex > stepIdx("push2");
        if (hasEdit) {
            const lines = EDIT_LINES.slice();
            lines.splice(EDIT_AT, 0, EDIT_NEW);
            const pending = side === "local"
                && stepIndex >= stepIdx("add2") && stepIndex <= stepIdx("commit2");
            return { lines, changed: pending ? [EDIT_AT] : [] };
        }
    }
    return { lines: FILE_TEXT[file] ?? ["(empty)"], changed: [] };
}
const sxWrap = (cls, s) => `<span class="sx-${cls}">${esc(s)}</span>`;
const HTML_RULES = [
    { re: /<!--[\s\S]*?-->/y, cls: "comment" },
    { re: /<!?\/?[\w-]+/y, cls: "tag" }, // <tag  </tag  <!DOCTYPE
    { re: /\/?>/y, cls: "punct" }, // >  or  />
    { re: /"[^"]*"|'[^']*'/y, cls: "str" },
    { re: /[\w-]+(?==)/y, cls: "attr" }, // attribute name before =
    { re: /=/y, cls: "punct" },
];
const CSS_RULES = [
    { re: /\/\*[\s\S]*?\*\//y, cls: "comment" },
    { re: /"[^"]*"|'[^']*'/y, cls: "str" },
    { re: /#[0-9a-fA-F]{3,8}\b/y, cls: "num" },
    { re: /\b\d+(?:px|rem|em|%|vh|vw|s|ms)?\b/y, cls: "num" },
    { re: /[.#][\w-]+/y, cls: "tag" }, // .class / #id selectors
    { re: /[\w-]+(?=\s*:)/y, cls: "attr" }, // property before the colon
    { re: /[{}();:,]/y, cls: "punct" },
    { re: /[A-Za-z][\w-]*/y, cls: "val" }, // keywords / element selectors / values
];
const JS_RULES = [
    { re: /\/\/.*/y, cls: "comment" },
    { re: /"[^"]*"|'[^']*'|`[^`]*`/y, cls: "str" },
    { re: /\b(?:const|let|var|function|return|if|else|for|while|new|import|export|from|class)\b/y, cls: "kw" },
    { re: /=>/y, cls: "kw" },
    { re: /\b(?:document|window|console|alert|querySelector|addEventListener)\b/y, cls: "fn" },
    { re: /\b\d+\b/y, cls: "num" },
    { re: /[A-Za-z_$][\w$]*/y, cls: "val" },
];
const RULES = { html: HTML_RULES, css: CSS_RULES, js: JS_RULES, txt: [] };
function highlight(line, lang) {
    const rules = RULES[lang];
    let out = "", i = 0;
    while (i < line.length) {
        let matched = false;
        for (const r of rules) {
            r.re.lastIndex = i;
            const m = r.re.exec(line);
            if (m && m.index === i && m[0].length > 0) {
                out += sxWrap(r.cls, m[0]);
                i += m[0].length;
                matched = true;
                break;
            }
        }
        if (!matched) {
            out += esc(line[i]);
            i++;
        }
    }
    return out;
}
function langOf(file) {
    if (file.endsWith(".css"))
        return "css";
    if (file.endsWith(".js"))
        return "js";
    return "html";
}
// the language the editor is currently showing (drives highlighting)
let editorLang = "html";
// render the file as `lines`, syntax-highlighted for `editorLang`. `changed`
// line indices read as a local change; `caret` parks a blinking caret on the
// line being typed (-1 = none).
function renderEditorLines(lines, opts = {}) {
    const changed = new Set(opts.changed ?? []);
    const caret = opts.caret ?? -1;
    editorCode.replaceChildren();
    lines.forEach((line, i) => {
        const row = document.createElement("div");
        row.className = "editor__line";
        if (changed.has(i))
            row.classList.add("is-changed");
        if (i === caret)
            row.classList.add("is-active");
        const num = document.createElement("span");
        num.className = "editor__num";
        num.textContent = String(i + 1);
        const txt = document.createElement("span");
        txt.className = "editor__txt";
        txt.innerHTML = highlight(line, editorLang);
        row.append(num, txt);
        if (i === caret) {
            const c = document.createElement("span");
            c.className = "editor__caret";
            row.appendChild(c);
        }
        editorCode.appendChild(row);
    });
}
// the editor grows out of (and folds back into) the file's row in a tree, so
// the popup clearly belongs to that file. We FLIP it: measure the row, then
// transform the centred editor down onto it as its closed state.
const GROW_MS = 620; // tree row -> full size in the centre
const SHRINK_MS = 560; // full size -> back into the tree row
// the centre the editor sits at when open (left:50% / top:40% in the stylesheet)
function editorAnchor() {
    return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4 };
}
// the on-screen box of a row in a tree, if it's there. `key` is a project
// file's name (data-file) or a .git node's path (data-path).
function fileRowRect(key, side) {
    const listEl = side === "remote" ? remoteList : treeList;
    const li = listEl.querySelector(`li[data-file="${key}"]`)
        ?? listEl.querySelector(`li[data-path="${key}"]`);
    return li ? li.getBoundingClientRect() : null;
}
// the transform that shrinks the centred editor down onto a tree row, so
// growing from / folding into it reads as the popup coming out of that file.
// Kept structurally identical to OPEN_TRANSFORM (same function list) so the
// browser interpolates them component-wise rather than via a matrix fallback.
function tuckedTransformFor(r) {
    const a = editorAnchor();
    if (!r)
        return "translate(-50%, -50%) translate(0px, 0px) scale(0.55)"; // row gone: shrink in place
    const lx = r.left + r.width / 2, ly = r.top + r.height / 2;
    const natH = editorEl.offsetHeight || 240; // unscaled height (ignores transform)
    const s = Math.max(0.05, Math.min(0.22, r.height / natH));
    return `translate(-50%, -50%) translate(${(lx - a.x).toFixed(1)}px, ${(ly - a.y).toFixed(1)}px) scale(${s.toFixed(3)})`;
}
const OPEN_TRANSFORM = "translate(-50%, -50%) translate(0px, 0px) scale(1)";
// a generation token: seeking, a new view, or a new run bumps it so an in-flight
// sequence bails at its next checkpoint instead of fighting the new state.
let editSeqGen = 0;
// which file (if any) is currently held open by a click-to-view
let viewerFile = null;
let viewerSide = "local";
function closeEditor() {
    editSeqGen++;
    viewerFile = null;
    editorEl.style.transition = "none";
    editorEl.style.opacity = "0";
    editorEl.style.pointerEvents = "none";
    editorSave.classList.remove("show");
}
// grow the editor out of `row`, so the popup reads as coming from that file.
// The caller has already set the content and bumped editSeqGen.
function growEditorFrom(row) {
    const gen = editSeqGen;
    if (S.prefersReduced) {
        editorEl.style.transition = "none";
        editorEl.style.transform = OPEN_TRANSFORM;
        editorEl.style.opacity = "1";
        editorEl.style.pointerEvents = "auto";
        return;
    }
    editorEl.style.transition = "none";
    editorEl.style.transform = tuckedTransformFor(row.getBoundingClientRect());
    editorEl.style.opacity = "0";
    editorEl.getBoundingClientRect(); // commit the tucked start state
    requestAnimationFrame(() => {
        if (gen !== editSeqGen)
            return;
        editorEl.style.transition =
            `opacity ${GROW_MS}ms var(--ease-settle), transform ${GROW_MS}ms var(--ease-settle)`;
        editorEl.style.transform = OPEN_TRANSFORM;
        editorEl.style.opacity = "1";
        editorEl.style.pointerEvents = "auto";
    });
}
// render a plain explanatory note in the editor body (for files that aren't
// meant to be read by hand, e.g. packed objects), instead of code lines
function renderEditorNote(text) {
    editorCode.replaceChildren();
    const p = document.createElement("p");
    p.className = "editor__note";
    p.textContent = text;
    editorCode.appendChild(p);
}
// ---- click any file to open it in the editor (view only) ------------
function openFileViewer(file, side, row) {
    ++editSeqGen; // cancel the auto-edit or a prior view
    viewerFile = file;
    viewerSide = side;
    editorLang = langOf(file);
    const { lines, changed } = fileLines(file, side);
    editorName.textContent = file;
    editorUnsaved.style.opacity = "0"; // viewing, nothing unsaved
    editorSave.classList.remove("show");
    renderEditorLines(lines, { changed });
    growEditorFrom(row);
}
// open a .git internal file in the same editor: readable ones (HEAD, config)
// show their contents; the rest show a note describing what they're for
function openGitFile(path, row) {
    const node = gitNodeByPath.get(path);
    if (!node)
        return;
    ++editSeqGen;
    viewerFile = path;
    viewerSide = "local";
    editorName.textContent = node.name;
    editorUnsaved.style.opacity = "0";
    editorSave.classList.remove("show");
    if (node.content != null) {
        // readable file: explain what it does + why, then show its real contents
        editorLang = "txt";
        renderEditorLines(node.content.split("\n"));
        if (node.explain) {
            const p = document.createElement("p");
            p.className = "editor__explain";
            p.textContent = node.explain;
            editorCode.prepend(p);
        }
    }
    else {
        // not meant to be read: just describe what it's for
        renderEditorNote(node.desc ?? "This file isn't meant to be read by hand.");
    }
    growEditorFrom(row);
}
// fold the open viewer back into its file row
function closeFileViewer() {
    if (viewerFile == null)
        return;
    const rect = fileRowRect(viewerFile, viewerSide);
    viewerFile = null;
    editSeqGen++;
    editorEl.style.pointerEvents = "none";
    if (S.prefersReduced) {
        editorEl.style.opacity = "0";
        return;
    }
    editorEl.style.transition =
        `opacity ${SHRINK_MS}ms var(--ease-settle), transform ${SHRINK_MS}ms var(--ease-settle)`;
    editorEl.style.transform = tuckedTransformFor(rect);
    editorEl.style.opacity = "0";
}
async function playEditSequence() {
    if (instant || S.prefersReduced)
        return; // timeline seeks just show the result
    const gen = ++editSeqGen;
    viewerFile = null; // this is the auto-edit, not a click view
    const alive = () => gen === editSeqGen;
    // prime: render the file, park the editor tucked into the index.html row
    const lines = EDIT_LINES.slice();
    editorLang = "html";
    editorName.textContent = EDIT_FILE;
    editorUnsaved.style.opacity = "0";
    editorSave.classList.remove("show");
    editorEl.style.pointerEvents = "none"; // the auto-edit isn't interactive
    renderEditorLines(lines);
    editorEl.style.transition = "none";
    editorEl.style.transform = tuckedTransformFor(fileRowRect(EDIT_FILE, "local"));
    editorEl.style.opacity = "0";
    editorEl.getBoundingClientRect(); // commit the tucked start state
    // 1) grow: the popup rises out of the index.html line to full size, centred
    requestAnimationFrame(() => {
        if (gen !== editSeqGen)
            return;
        editorEl.style.transition =
            `opacity ${GROW_MS}ms var(--ease-settle), transform ${GROW_MS}ms var(--ease-settle)`;
        editorEl.style.transform = OPEN_TRANSFORM;
        editorEl.style.opacity = "1";
    });
    await sleep(GROW_MS + 320);
    if (!alive())
        return; // grow, then a beat to take it in
    // 2) edit: open a fresh line and type the new markup into it, char by char
    lines.splice(EDIT_AT, 0, "");
    editorUnsaved.style.opacity = "1"; // the file is now dirty
    for (let n = 1; n <= EDIT_NEW.length; n++) {
        lines[EDIT_AT] = EDIT_NEW.slice(0, n);
        renderEditorLines(lines, { changed: [EDIT_AT], caret: EDIT_AT });
        await sleep(44);
        if (!alive())
            return;
    }
    await sleep(650);
    if (!alive())
        return; // sit on the finished edit a moment
    // 3) save: the unsaved dot clears and a "saved" note flashes, then it lingers.
    // the new line stays green: a saved-but-uncommitted local change.
    renderEditorLines(lines, { changed: [EDIT_AT] });
    editorUnsaved.style.opacity = "0";
    editorSave.classList.add("show");
    await sleep(1600);
    if (!alive())
        return; // longer hold so the save registers
    // 4) fold back into the tree line, then leave index.html marked modified
    editorEl.style.transition =
        `opacity ${SHRINK_MS}ms var(--ease-settle), transform ${SHRINK_MS}ms var(--ease-settle)`;
    editorEl.style.transform = tuckedTransformFor(fileRowRect(EDIT_FILE, "local"));
    editorEl.style.opacity = "0";
    await sleep(SHRINK_MS + 60);
    if (!alive())
        return;
    editorSave.classList.remove("show");
}
// clicking a file row opens it; clicking the open file again, its bar, outside,
// or Escape folds it away. Delegated so re-rendered rows keep working.
function wireFileViewer() {
    const onList = (listEl, side) => {
        listEl.addEventListener("click", (e) => {
            const li = e.target.closest("li[data-file]");
            const file = li?.dataset.file;
            if (!file || !li)
                return;
            if (viewerFile === file && viewerSide === side)
                closeFileViewer();
            else
                openFileViewer(file, side, li);
        });
    };
    onList(treeList, "local");
    onList(remoteList, "remote");
    // a folder click toggles it open/closed; a .git file click opens it in the
    // editor. stopPropagation keeps either from also tripping the companion's
    // outside-click dismissal, so the tree is interactive on its own terms.
    // (project files carry data-file and are handled by onList above.)
    treeList.addEventListener("click", (e) => {
        const t = e.target;
        const folder = t.closest(".is-folder[data-path]");
        if (folder) {
            e.stopPropagation();
            const path = folder.dataset.path;
            setNodeOpen(path, !treeOpen.has(path));
            return;
        }
        const gitFile = t.closest(".is-gitfile[data-path]");
        if (gitFile) {
            e.stopPropagation();
            const path = gitFile.dataset.path;
            if (viewerFile === path)
                closeFileViewer();
            else
                openGitFile(path, gitFile);
        }
    });
    editorEl.addEventListener("click", (e) => {
        if (viewerFile == null)
            return; // the auto-edit ignores clicks
        if (e.target.closest(".editor__bar"))
            closeFileViewer();
    });
    document.addEventListener("click", (e) => {
        if (viewerFile == null)
            return;
        const t = e.target;
        if (editorEl.contains(t) || treeEl.contains(t) || remoteTreeEl.contains(t))
            return;
        closeFileViewer();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && viewerFile != null)
            closeFileViewer();
    });
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
    root.append(folderIcon(), makeName(`${PROJECT.root}/`));
    remoteList.appendChild(root);
    const git = document.createElement("li");
    git.className = "f d--git";
    if (!lastRemoteShown)
        git.classList.add("is-new");
    const note = document.createElement("span");
    note.className = "f__note";
    note.textContent = "the remote repo";
    git.append(folderIcon(), makeName(".git/"), note);
    remoteList.appendChild(git);
    if (pushed) {
        PROJECT.files.forEach((f, fi) => {
            const li = document.createElement("li");
            li.className = "f f--committed is-openable";
            li.dataset.file = f; // remote files open too
            if (!lastRemotePushed)
                li.classList.add("is-new");
            const name = makeName(f);
            name.appendChild(makeUnderline(fi * 9 + 31));
            li.append(fileIcon(f), name);
            const m = document.createElement("span");
            m.className = "f__mark";
            m.textContent = MARK.committed;
            li.appendChild(m);
            remoteList.appendChild(li);
        });
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
// ---- remote mini-graph (the remote's own tree, drawn above the local one) ---
// The remote is the shared source of truth. On the FIRST push a small copy of
// the trunk slides straight up out of the local graph and parks near the top,
// labelled so it reads as the remote. Unlike the local graph it never pans: it
// stays centred on the screen's horizontal. It only shows what's actually been
// pushed (origin/main), so it lags behind the local graph until you push again.
const REMOTE_NODE_R = NODE_R * 0.36; // small solid remote nodes
const REMOTE_GAP = GAP * 0.82; // compact spacing between them
const REMOTE_TOP_FRAC = 0.13; // rests this far down from the top (its own anchor)
const shownRemoteIds = new Set(); // commits already drawn on the mini-graph
// the commits that live on the remote: the main-lane trunk up to origin/main's
// tip (everything reachable from what you pushed).
function remoteTrunk() {
    const tip = nodeById(originMain);
    if (!tip)
        return [];
    return model.nodes
        .filter((n) => n.lane === 0 && n.col <= tip.col)
        .sort((a, b) => a.col - b.col);
}
function renderRemoteGraph(allowAnim = true) {
    const trunk = remoteTrunk();
    gRemoteInner.replaceChildren();
    if (!trunk.length) {
        gRemote.style.opacity = "0";
        shownRemoteIds.clear();
        return;
    }
    gRemote.style.opacity = "1";
    // centred on the screen, small solid nodes, parked near the top of the view.
    // Each commit is its OWN group holding the node plus its incoming
    // connector (a fixed line one REMOTE_GAP to the left). Because spacing is
    // constant, that connector stays glued to its node as groups slide or glide.
    const cx = boardCenter().x;
    // the remote graph has its OWN anchor near the top, independent of the local
    // graph, so lowering the local graph genuinely opens a gap between them.
    const restY = viewH * REMOTE_TOP_FRAC;
    const rise = boardCenter().y - restY; // distance a node travels up from the local lane
    const count = trunk.length;
    const oldCount = shownRemoteIds.size;
    const xAt = (i, c) => cx + (i - (c - 1) / 2) * REMOTE_GAP;
    const animate = allowAnim && !instant && !S.prefersReduced;
    const firstShow = oldCount === 0;
    // caption so it's clearly the remote, not a second local graph
    const label = S.el("text", {
        x: cx, y: restY - 52, "text-anchor": "middle", class: "remote-graph-label",
    });
    label.textContent = "the remote";
    gRemoteInner.appendChild(label);
    const parts = [];
    trunk.forEach((node, i) => {
        const finalX = xAt(i, count);
        const isNew = !shownRemoteIds.has(node.id);
        const g = S.el("g");
        let conn = null;
        if (i > 0) {
            conn = S.el("path", {
                d: connectorPath({ x: -REMOTE_GAP, y: 0, r: REMOTE_NODE_R }, { x: 0, y: 0, r: REMOTE_NODE_R }, node.id * 5 + 2),
                class: "edge-stroke", stroke: COLORS.main, "stroke-width": 2,
            });
            g.appendChild(conn);
        }
        g.appendChild(S.el("path", {
            d: shapePath(node.shape, 0, 0, REMOTE_NODE_R, node.id * 7 + 1),
            fill: node.color, stroke: node.color, "stroke-width": 2, "stroke-linejoin": "round",
        }));
        gRemoteInner.appendChild(g);
        if (!animate) {
            g.style.transform = `translate(${finalX}px, ${restY}px)`;
            return;
        }
        // start state: a new commit starts exactly on its local-graph node (which is
        // panned, so add boardPanX), then travels to its centred remote slot;
        // existing ones sit in their old, less-centred slot ready to glide over
        g.style.transition = "none";
        g.style.transform = isNew
            ? `translate(${node.x + boardPanX}px, ${node.y}px)`
            : `translate(${xAt(i, oldCount)}px, ${restY}px)`;
        g.style.opacity = isNew ? "0" : "1";
        parts.push({ g, conn: isNew ? conn : null, finalX, isNew });
    });
    if (!animate) {
        shownRemoteIds.clear();
        trunk.forEach((nn) => shownRemoteIds.add(nn.id));
        return;
    }
    if (firstShow) {
        label.style.transition = "none";
        label.style.transform = `translateY(${rise}px)`;
        label.style.opacity = "0";
    }
    // hide each new connector so it can draw in only after its node has landed
    for (const p of parts) {
        if (p.conn) {
            const L = p.conn.getTotalLength();
            p.conn.style.strokeDasharray = String(L);
            p.conn.style.strokeDashoffset = String(L);
        }
    }
    gRemoteInner.getBoundingClientRect(); // commit the start states
    requestAnimationFrame(() => {
        if (firstShow) {
            label.style.transition = "transform 1.15s cubic-bezier(.4,0,.2,1), opacity .7s ease";
            label.style.transform = "translateY(0)";
            label.style.opacity = "1";
        }
        for (const p of parts) {
            p.g.style.transition = p.isNew
                ? "transform 1.15s cubic-bezier(.4,0,.2,1), opacity .5s ease" // rise from the local lane
                : "transform .8s cubic-bezier(.4,0,.2,1)"; // glide to re-centre
            p.g.style.transform = `translate(${p.finalX}px, ${restY}px)`;
            p.g.style.opacity = "1";
            if (p.conn) { // draw the new connector in after the node arrives
                p.conn.style.transition = "stroke-dashoffset .55s ease 1s";
                p.conn.style.strokeDashoffset = "0";
            }
        }
    });
    shownRemoteIds.clear();
    trunk.forEach((nn) => shownRemoteIds.add(nn.id));
}
// the trees stay large (is-focus) for now — they never pair off / shrink yet.
// Flip `paired` back to a step threshold once we decide where the shrink belongs.
function updateLayout() {
    const paired = false;
    treeEl.classList.toggle("is-focus", !paired);
    treeEl.classList.toggle("is-paired", paired);
    // the remote tree mirrors the local one: large while it first appears, then
    // it shrinks into its side slot in step with the local tree
    remoteTreeEl.classList.toggle("is-focus", !paired);
    remoteTreeEl.classList.toggle("is-paired", paired);
}
// ---- timeline (bottom, clickable) ----------------------------------
// The timeline reads as milestones, not single commands: each stop groups the
// commands that make up one task. A stop is done once all its commands are, and
// clicking it jumps to the moment that task is finished.
const TIMELINE_TASKS = [
    { label: "Initialize repo", keys: ["init", "add", "commit"] },
    { label: "Add a remote", keys: ["remote", "push"] },
    { label: "Branch HEAD", keys: ["branch", "checkout", "add2", "commit2"] },
    { label: "Merge to HEAD", keys: ["checkout-main", "merge", "push2"] },
];
// a command label for a sub-step, e.g. "checkout-main" -> "git checkout"
function cmdLabel(key) {
    return `git ${key.replace(/[-\d].*$/, "")}`;
}
const tlStops = [];
let tlComplete = null;
function buildTimeline() {
    timelineEl.replaceChildren();
    tlStops.length = 0;
    const linkInto = (parent, sub = false, order = -1) => {
        const l = document.createElement("span");
        l.className = sub ? "tl-link tl-link--sub" : "tl-link";
        if (order >= 0)
            l.style.setProperty("--i", String(order));
        parent.appendChild(l);
    };
    const makeStop = (cls, dotCls, text, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = cls;
        const dot = document.createElement("span");
        dot.className = dotCls;
        const label = document.createElement("span");
        label.className = "tl-label";
        label.textContent = text;
        btn.append(dot, label);
        btn.addEventListener("click", onClick);
        return btn;
    };
    TIMELINE_TASKS.forEach((t, i) => {
        const idx = t.keys.map(stepIdx).filter((s) => s >= 0).sort((a, b) => a - b);
        const first = idx[0], last = idx[idx.length - 1];
        if (i > 0)
            linkInto(timelineEl);
        // the whole task: its milestone stop plus a sub-row that expands when current
        const group = document.createElement("div");
        group.className = "tl-group";
        // clicking a stop goes TO that point (it becomes the current step), it does
        // not run the task. The milestone lands you at the start of its task.
        const taskBtn = makeStop("tl-item", "tl-dot", t.label, () => { void seekTo(first); });
        taskBtn.title = `Go to: ${t.label}`;
        group.appendChild(taskBtn);
        // .tl-sub is a 0fr<->1fr grid that animates to the exact content width; the
        // inner layer clips it so the sub-steps reveal left-to-right. Each child
        // carries its order (--i) so they stagger in as the section expands.
        const sub = document.createElement("div");
        sub.className = "tl-sub";
        const inner = document.createElement("div");
        inner.className = "tl-sub-inner";
        sub.appendChild(inner);
        const subs = [];
        let order = 0;
        idx.forEach((si) => {
            linkInto(inner, true, order++); // connector from the milestone / previous sub-step
            const sBtn = makeStop("tl-substep", "tl-dot tl-dot--sub", cmdLabel(steps[si].key), () => { void seekTo(si); });
            sBtn.title = `Go to: ${cmdLabel(steps[si].key)}`;
            sBtn.style.setProperty("--i", String(order++));
            inner.appendChild(sBtn);
            subs.push({ btn: sBtn, si });
        });
        group.appendChild(sub);
        timelineEl.appendChild(group);
        tlStops.push({ group, taskBtn, first, last, subs });
    });
    // a final star stands for the finished loop: click it to jump straight to the
    // completed end state. It lights up the moment the last command is done.
    linkInto(timelineEl);
    const done = document.createElement("button");
    done.type = "button";
    done.className = "tl-item tl-item--complete";
    const star = document.createElement("span");
    star.className = "tl-star";
    star.textContent = "✦";
    const label = document.createElement("span");
    label.className = "tl-label";
    label.textContent = "complete";
    done.append(star, label);
    done.title = "Jump to the finished loop";
    done.addEventListener("click", () => { void seekTo(steps.length); });
    timelineEl.appendChild(done);
    tlComplete = done;
    updateTimeline();
}
function updateTimeline() {
    for (const s of tlStops) {
        const current = stepIndex >= s.first && stepIndex <= s.last;
        s.taskBtn.classList.toggle("is-done", stepIndex > s.last);
        s.taskBtn.classList.toggle("is-current", current);
        // only the task you're working through expands into its sub-commands
        s.group.classList.toggle("is-expanded", current);
        for (const { btn, si } of s.subs) {
            btn.classList.toggle("is-done", stepIndex > si);
            btn.classList.toggle("is-current", stepIndex === si);
        }
    }
    // the star fills as soon as every command is done
    const finished = stepIndex >= steps.length;
    tlComplete?.classList.toggle("is-done", finished);
    tlComplete?.classList.toggle("is-current", finished);
}
// ---- seek: rebuild instantly to a chosen step ----------------------
function resetBoard() {
    [gEdges, gNodes, gNib, gLabels, gRemoteInner].forEach((g) => g.replaceChildren());
    model.nodes = [];
    model.head = null;
    model.headBranch = "main";
    model.branches = {};
    model.tagEls = null;
    model.pending = null;
    refPills.clear();
    refTicks = null;
    originMain = null;
    originPill = null;
    shownRemoteIds.clear();
    gRemote.style.opacity = "0";
}
async function seekTo(target) {
    if (busy || target === stepIndex)
        return;
    busy = true;
    // try/finally so a thrown replay (real git on the shared fs) can never leave
    // `busy` or `instant` stuck true and freeze every future command + seek.
    try {
        closeEditor(); // a seek cancels any in-flight edit and hides the editor
        resetBoard();
        if (target <= 0) {
            stage.classList.remove("is-docked");
            stage.classList.add("is-centered");
            stage.style.setProperty("--stage-y", "50%");
        }
        instant = true;
        try {
            for (let k = 0; k < target; k++) {
                const st = steps[k];
                await st.run(st.extract ? st.extract(canonical(st)) : undefined);
            }
            centerOnHead(); // pan instantly while still in replay mode (no glide)
            if (target >= steps.length)
                showEndState();
        }
        finally {
            instant = false;
        }
        stepIndex = target;
        cmd.value = "";
        showStep(stepIndex);
        updateTimeline();
        await refreshRepo();
        renderRemoteTree();
        renderRemoteGraph(false); // seek: the remote tree is just there, no float
        updateLayout();
        syncCompanion();
        if (!isPhone)
            cmd.focus();
    }
    finally {
        busy = false;
    }
}
// ---- boot -----------------------------------------------------------
// landing intro: type the file-tree callout in, character by character, in step
// with the CSS draw-on of the tree, its arrow, the clone note and the roadmap.
// (reduced motion / phones just get the finished text.)
function typeLandingCallout() {
    const label = document.querySelector(".note--tree .note__label");
    if (!label)
        return;
    const text = label.getAttribute("data-text") ?? "";
    if (S.prefersReduced || isPhone) {
        label.textContent = text;
        return;
    }
    label.textContent = "";
    let i = 0;
    const step = () => {
        label.textContent = text.slice(0, i);
        if (i < text.length) {
            i++;
            window.setTimeout(step, 24);
        }
    };
    window.setTimeout(step, 800);
}
// ---- the curiosity companion -----------------------------------------
// A persistent bottom-right voice. It renders the current step's questions for
// the right tense (pre/post), each a tap-to-open button. Opening a question
// whose answer is about a real thing on the board inks an arrow to it.
const CARET_PATH = "M5 3 C 9 6, 11 7, 12 8 C 11 9, 9 10, 5 13"; // the hand-drawn ">"
// arrows currently drawn, keyed by the question button that opened them, so we
// can retract one on close and redraw them all on resize
const openArrows = new Map();
// the one question currently in focus (only one is ever open at a time)
let openBtn = null;
let gitOpenBeforePeek = false; // .git open-state before a companion question peeked into it
// the live snapshot from the REAL git repo (repo.ts) drives the tree + states.
let snap = null;
let lastCommitMsg = "first commit";
// which tree folders/files are open, by path. The project root starts open.
const treeOpen = new Set(["root"]);
// flat index of every .git *file* by path, so a click can open it in the
// editor. Rebuilt from each snapshot.
let gitNodeByPath = new Map();
function indexGitNodes(nodes) {
    for (const n of nodes) {
        if (n.isDir)
            indexGitNodes(n.children ?? []);
        else
            gitNodeByPath.set(n.path, n);
    }
}
// the real-git commands that should have run by a given step (init/add/commit).
// Replaying these from scratch reproduces the exact repo state for that step.
function repoCommandsFor(i) {
    const cmds = [];
    if (i > stepIdx("init"))
        cmds.push({ kind: "init" });
    if (i > stepIdx("add"))
        cmds.push({ kind: "add" });
    if (i > stepIdx("commit"))
        cmds.push({ kind: "commit", message: lastCommitMsg });
    return cmds;
}
// replay real git to the current step, take a fresh snapshot, redraw the tree.
// The tree's open/closed state persists across steps by default; a step can opt
// into a tidy (collapsed) tree on arrival with `collapseTree`.
async function refreshRepo() {
    await replayTo(repoCommandsFor(stepIndex));
    snap = await snapshot();
    gitNodeByPath = new Map();
    indexGitNodes(snap.git);
    if (steps[stepIndex]?.collapseTree) {
        treeOpen.clear();
        treeOpen.add("root");
    }
    renderFileTree();
}
// open/close a tree node by path: flips its row + the subwrap that follows it,
// and (for folders) swaps the closed folder icon for an open one. Animations
// ride the class change, so we never re-render to toggle.
function setNodeOpen(path, open) {
    if (open)
        treeOpen.add(path);
    else
        treeOpen.delete(path);
    const row = treeList.querySelector(`[data-path="${path}"]`);
    if (!row)
        return;
    row.classList.toggle("is-open", open);
    const sub = row.nextElementSibling;
    if (sub && sub.classList.contains("tree__subwrap")) {
        sub.classList.toggle("is-open", open);
        // opening a folder cascades a staggered write-on over EVERYTHING it reveals,
        // recursively (nested open folders included) — nothing just blinks in.
        if (open)
            revealSubtree(sub);
    }
    if (row.classList.contains("is-folder")) {
        row.querySelector(".ic")?.replaceWith(open ? folderIconOpen() : folderIcon());
    }
}
// collect a subwrap's currently-visible rows in top-to-bottom order, descending
// only into nested folders that are themselves open (so hidden rows don't count)
function collectVisibleRows(sub, acc) {
    for (const child of Array.from(sub.children)) {
        if (child.classList.contains("tree__subwrap")) {
            if (child.classList.contains("is-open")) {
                const inner = child.querySelector(":scope > .tree__sub");
                if (inner)
                    collectVisibleRows(inner, acc);
            }
        }
        else {
            acc.push(child); // a file/folder/placeholder row
        }
    }
}
// re-run the write-on entrance on every row a just-opened folder reveals,
// staggered by visual order, so the whole subtree animates in (not a blink)
function revealSubtree(wrap) {
    if (S.prefersReduced)
        return;
    const sub = wrap.querySelector(":scope > .tree__sub");
    if (!sub)
        return;
    const rows = [];
    collectVisibleRows(sub, rows);
    rows.forEach((r) => r.classList.remove("is-revealing"));
    void wrap.offsetWidth; // reflow so removing + re-adding restarts the animation
    rows.forEach((r, i) => { r.style.setProperty("--ri", String(i)); r.classList.add("is-revealing"); });
}
// the companion's .git/ question drives the same folder open as a manual click
function setGitOpen(open) {
    if (open)
        setNodeOpen("root", true); // make sure the root is open so .git/ is visible
    setNodeOpen(".git", open);
}
// resolve a `points` key to the live board element its arrow should reach
function companionTarget(points) {
    switch (points) {
        case "dotgit": return treeList.querySelector(".d--git");
        case "node:tip": return gNodes.lastElementChild;
        case "tag:HEAD": return refPills.get("HEAD") ?? null;
        default: return null;
    }
}
// draw a hand-drawn arrow from the open answer to its board target, in pixel
// space (the overlay is a full-viewport SVG with no viewBox)
function drawCompanionArrow(fromEl, points) {
    const target = companionTarget(points);
    if (!target)
        return null;
    const a = fromEl.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    if (!a.width || !b.width)
        return null;
    // start just left of the answer's first line, end just right of the target
    const x1 = a.left - 6, y1 = a.top + Math.min(16, a.height / 2);
    const x2 = b.right + 8, y2 = b.top + b.height / 2;
    // a curve that LEAVES the answer heading left and ARRIVES at .git/ travelling
    // horizontally, so the arrowhead points straight at it rather than tipping up
    const dx = x2 - x1;
    const cx1 = x1 + dx * 0.4, cy1 = y1 + (y2 - y1) * 0.1;
    const cx2 = x2 + Math.max(70, Math.abs(dx) * 0.32), cy2 = y2; // control sits level, to the right
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    const shaft = document.createElementNS(ns, "path");
    shaft.setAttribute("d", `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    shaft.setAttribute("pathLength", "1");
    // arrowhead: two short barbs off the tip, angled back toward the shaft
    const head = document.createElementNS(ns, "path");
    const ang = Math.atan2(y2 - cy2, x2 - cx2);
    const len = 11;
    const hx1 = x2 - len * Math.cos(ang - 0.42), hy1 = y2 - len * Math.sin(ang - 0.42);
    const hx2 = x2 - len * Math.cos(ang + 0.42), hy2 = y2 - len * Math.sin(ang + 0.42);
    head.setAttribute("d", `M ${hx1.toFixed(1)} ${hy1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} L ${hx2.toFixed(1)} ${hy2.toFixed(1)}`);
    head.setAttribute("pathLength", "1");
    if (!S.prefersReduced) {
        shaft.classList.add("is-drawing");
        head.classList.add("is-drawing");
        head.style.animationDelay = "0.4s"; // the head lands after the shaft is drawn
    }
    g.append(shaft, head);
    companionArrows.appendChild(g);
    return g;
}
// retract an arrow by un-drawing it in the SAME direction it was drawn (the
// stroke keeps travelling toward the target, erasing from the tail), then drop it
function removeCompanionArrow(q) {
    const g = openArrows.get(q);
    if (!g)
        return;
    openArrows.delete(q);
    if (S.prefersReduced) {
        g.remove();
        return;
    }
    g.querySelectorAll("path").forEach((p, i) => {
        p.classList.remove("is-drawing");
        p.style.animationDelay = i === 1 ? "0.3s" : ""; // the head erases just after the shaft
        p.classList.add("is-erasing");
    });
    window.setTimeout(() => g.remove(), 850);
}
// re-aim every open arrow (after a resize or relayout moved its endpoints)
function redrawCompanionArrows() {
    openArrows.forEach((g, q) => {
        const points = q.dataset.points;
        g.remove();
        openArrows.delete(q);
        if (points && q.getAttribute("aria-expanded") === "true") {
            const wrap = q.nextElementSibling;
            const answer = wrap?.firstElementChild ?? q;
            const fresh = drawCompanionArrow(answer, points);
            if (fresh)
                openArrows.set(q, fresh);
        }
    });
}
// entering "learn mode": the user has decided that understanding, not
// continuing, is what matters now, so the command line and its scaffolding
// recede. You're either continuing or learning, never both at once.
function enterLearnMode() {
    document.body.classList.add("is-learning");
    companionEl.classList.add("is-focus");
    if (!isPhone)
        cmd.blur();
}
function exitLearnMode() {
    document.body.classList.remove("is-learning");
    companionEl.classList.remove("is-focus");
    if (!isPhone && !pointerDown)
        cmd.focus();
}
// bring a question into focus: it grows, the others step back, the page dims,
// and (if it points somewhere) an arrow inks out to the real thing
function openCurio(btn, ans, points) {
    if (openBtn && openBtn !== btn)
        closeCurio(openBtn);
    btn.setAttribute("aria-expanded", "true");
    btn.parentElement?.classList.add("is-open");
    openBtn = btn;
    enterLearnMode();
    // peek inside .git for the answer, remembering the prior state so closing the
    // question restores it (rather than force-collapsing a folder the user opened)
    if (points === "dotgit") {
        gitOpenBeforePeek = treeOpen.has(".git");
        setGitOpen(true);
    }
    if (points) {
        // let the answer enlarge first, so the arrow leaves from its settled spot
        window.setTimeout(() => {
            if (btn.getAttribute("aria-expanded") !== "true")
                return;
            const g = drawCompanionArrow(ans, points);
            if (g)
                openArrows.set(btn, g);
        }, S.prefersReduced ? 0 : 380);
    }
}
// let a question go: retract its arrow + .git/ peek, and if it was the focused
// one, hand attention back to continuing
function closeCurio(btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.parentElement?.classList.remove("is-open");
    removeCompanionArrow(btn);
    if (btn.dataset.points === "dotgit")
        setGitOpen(gitOpenBeforePeek); // restore prior state
    if (openBtn === btn) {
        openBtn = null;
        exitLearnMode();
    }
}
// build one question + answer block; clicking it pulls it into focus (or, if
// it's already the focused one, lets it go)
function curioBlock(c) {
    const qa = document.createElement("div");
    qa.className = "companion__qa";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "companion__q";
    btn.setAttribute("aria-expanded", "false");
    if (c.points)
        btn.dataset.points = c.points;
    btn.innerHTML =
        `<svg class="companion__caret" viewBox="0 0 16 16" aria-hidden="true">` +
            `<path class="note-stroke" pathLength="1" d="${CARET_PATH}" /></svg><span>${c.q}</span>`;
    const wrap = document.createElement("div");
    wrap.className = "companion__a-wrap";
    const ans = document.createElement("p");
    ans.className = "companion__a";
    ans.innerHTML = c.a;
    wrap.appendChild(ans);
    btn.addEventListener("click", () => {
        if (btn.getAttribute("aria-expanded") === "true")
            closeCurio(btn);
        else
            openCurio(btn, ans, c.points);
    });
    qa.append(btn, wrap);
    return qa;
}
// tear down any focus state + arrows when the question set is about to change.
// It deliberately does NOT touch the tree's open/closed state: advancing a
// command respects whatever the user (or a prior peek) left open.
function resetCompanion() {
    openBtn = null;
    companionEl.classList.remove("is-focus");
    document.body.classList.remove("is-learning");
    openArrows.clear();
    companionArrows.replaceChildren();
}
// show (or hide) the companion for a given step + tense
function setCompanion(key, phase) {
    resetCompanion();
    const step = key ? steps.find((s) => s.key === key) : null;
    const list = step?.curiosity?.[phase] ?? [];
    if (!step || !list.length) {
        companionEl.classList.remove("is-visible");
        companionList.replaceChildren();
        return;
    }
    companionList.replaceChildren(...list.map(curioBlock));
    companionEl.classList.add("is-visible");
}
// pick what the companion should show for the current machine state: the
// landing shows init's forward-looking questions; after a command runs we show
// that command's "what just happened" set (only init has one for now).
let companionPrimed = false; // has the first landing reveal happened yet?
function syncCompanion() {
    companionEl.classList.toggle("is-landing", stepIndex === 0);
    if (stepIndex === 0) {
        // first load: let the area fade in in step with the rest of the intro
        if (!companionPrimed && !S.prefersReduced) {
            companionEl.style.transitionDelay = "2.4s";
            window.setTimeout(() => { companionEl.style.transitionDelay = ""; }, 3200);
        }
        companionPrimed = true;
        setCompanion("init", "pre");
        return;
    }
    const prev = steps[stepIndex - 1];
    setCompanion(prev?.curiosity?.post ? prev.key : null, "post");
}
// dev helper: ?step=N (index) or ?step=<key> seeks straight to that state on
// load, so any screen can be screenshotted without typing the whole sequence.
function applyStepParam() {
    let v = null;
    try {
        v = new URLSearchParams(window.location.search).get("step");
    }
    catch {
        return;
    }
    if (!v)
        return;
    const target = /^\d+$/.test(v) ? parseInt(v, 10) : steps.findIndex((s) => s.key === v);
    if (target > 0)
        void seekTo(target);
}
async function boot() {
    sizeBoard();
    stage.style.setProperty("--stage-y", "50%");
    drawRule(brandRule, COLORS.main, 11);
    startAmbient();
    showStep(0); // draws the command underline at the right width via updateInk
    buildTimeline();
    await refreshRepo(); // seed the real repo + draw the initial tree
    renderRemoteTree();
    renderRemoteGraph(false);
    // No file editor exists yet, so the local tree leads (is-focus) until a remote
    // appears. When the editor lands, the compact corner state takes over instead.
    updateLayout();
    // sketched icons on the two tree headings: a computer for the local copy, a
    // cloud for the remote
    needSel("#filetree .tree__title").prepend(computerIcon());
    needSel("#remotetree .tree__title").prepend(cloudIcon());
    wireFileViewer(); // click any file in either tree to open it
    typeLandingCallout(); // landing intro: type the file-tree callout in
    syncCompanion(); // landing: the curiosity companion's forward-looking questions
    if (!isPhone)
        cmd.focus();
    applyStepParam(); // dev: ?step=N jumps straight to a state for screenshots
}
window.addEventListener("resize", () => {
    sizeBoard();
    if (stepIndex > 0)
        positionStage(false); // keep the stage pinned to the bottom
    centerOnHead(); // viewW changed: keep HEAD centred
    renderRemoteGraph(false); // recompute the mini-graph's float-up transform
    updateInk(); // recompute field width + redraw the underline
    redrawCompanionArrows(); // re-aim any open answer arrows at their moved targets
});
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot());
}
else {
    void boot();
}
//# sourceMappingURL=app.js.map