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
const goalEl = need("goal");
const whyEl = need("why");
const partsEl = need("parts");
const nudgeEl = need("nudge");
const brandRule = needSel(".brand__rule");
const cliRule = needSel(".cli__rule");
const model = { nodes: [], head: null, tagEls: null, pending: null };
const GAP = 150; // horizontal distance between commits (viewBox units)
const NODE_R = 28; // base node radius (viewBox units)
// viewBox dimensions: the drawing space, smaller than the screen by ZOOM
let viewW = window.innerWidth / ZOOM;
let viewH = window.innerHeight / ZOOM;
function boardCenter() {
    return { x: viewW / 2, y: viewH * 0.42 };
}
// column i sits to the right of the first node, which lives at board centre
function nodePos(col) {
    const c = boardCenter();
    return { x: c.x + col * GAP, y: c.y };
}
function headNode() {
    return model.nodes.find((n) => n.id === model.head);
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
// ---- ambient life: boil + a slow whole-sheet drift ------------------
function startAmbient() {
    const turb = graph.querySelector("#boil feTurbulence");
    S.startBoil(turb, { fps: 6, seeds: [1, 9, 17] });
    if (S.prefersReduced)
        return;
    const loop = (now) => {
        const t = now / 1000;
        const x = Math.sin(t * 0.16) * 6 + Math.sin(t * 0.07) * 3;
        const y = Math.cos(t * 0.13) * 4 + Math.sin(t * 0.05) * 2;
        graph.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
// ---- small animation helpers ---------------------------------------
function animateIn(node, delay = 0) {
    if (S.prefersReduced)
        return;
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
    if (S.prefersReduced) {
        node.remove();
        return;
    }
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
    if (model.tagEls)
        fadeOutRemove(model.tagEls, 220);
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
    if (faint)
        t.setAttribute("opacity", "0.6");
    t.textContent = text;
    gLabels.appendChild(t);
    animateIn(t, delay);
    return t;
}
// ---- step actions ---------------------------------------------------
async function doInit() {
    const p = nodePos(0);
    const node = {
        id: 0, col: 0, x: p.x, y: p.y, r: NODE_R,
        branch: "main", color: COLORS.main, shape: "circle",
    };
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
    if (!from)
        return;
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
async function doCommit(message = "first commit") {
    const from = headNode();
    if (!from)
        return;
    const p = model.pending ? model.pending.pos : nodePos(model.nodes.length);
    if (model.pending) {
        model.pending.els.forEach((e) => fadeOutRemove(e, 240));
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
let stepIndex = 0;
const steps = [
    {
        cmd: "git init",
        test: (s) => /^git\s+init$/i.test(s),
        hint: "Type  git init  to begin.",
        teach: {
            goal: "Start your repository",
            why: "Git begins watching this folder so it can remember every version of your work from here on.",
            parts: [
                { t: "init", tone: "cmd", why: "create a new, empty repository right here" },
            ],
        },
        run: doInit,
    },
    {
        cmd: "git add .",
        test: (s) => /^git\s+add(\s+\.|\s+-a|\s+--all)?$/i.test(s),
        hint: "Stage your files with  git add .",
        teach: {
            goal: "Pick what to save",
            why: "Before saving, you choose which files go into the next snapshot. This is called staging.",
            parts: [
                { t: "add", tone: "cmd", why: "stage files, marking them for the next save" },
                { t: ".", tone: "val", why: "“everything in this folder”. You could name one file instead, like  index.html" },
            ],
        },
        run: doAdd,
    },
    {
        cmd: 'git commit -m "first commit"',
        test: (s) => /^git\s+commit\s+-m\s+(["']).+?\1\s*$/i.test(s),
        extract: (s) => {
            const m = s.match(/-m\s+(["'])(.+?)\1/);
            return m ? m[2] : "first commit";
        },
        hint: 'Save it with a message:  git commit -m "first commit"',
        teach: {
            goal: "Save a snapshot",
            why: "A commit is a saved point in your history that you can always return to. Give it a short message so future-you knows what changed.",
            parts: [
                { t: "commit", tone: "cmd", why: "save the staged files as a snapshot" },
                { t: "-m", tone: "flag", why: "short for “message”, the note that comes next" },
                { t: '"first commit"', tone: "val", why: "your description, in quotes. Write anything you like" },
            ],
        },
        run: doCommit,
    },
];
const END = {
    teach: {
        goal: "That's your first commit",
        why: "You started a repository and saved your first snapshot. More git is on the way.",
        parts: [],
    },
    tease: "push is the next stroke. I'm drawing it now ✦",
};
function currentCmd() {
    return stepIndex < steps.length ? steps[stepIndex].cmd : "";
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
function updateInk() {
    const typed = cmd.value;
    const cur = currentCmd();
    const m = typed.match(/^(\s*)(\S*)([\s\S]*)$/);
    const lead = m ? m[1] : "";
    const word = m ? m[2] : "";
    const rest = m ? m[3] : "";
    // colour the first word blue while it is becoming "git"
    const isGit = word.length > 0 && "git".startsWith(word.toLowerCase());
    let html = esc(lead);
    html += `<span class="${isGit ? "hl-git" : "hl-rest"}">${esc(word)}</span>`;
    html += `<span class="hl-rest">${esc(rest)}</span>`;
    suggestActive =
        cur.length > 0 &&
            typed.length < cur.length &&
            cur.toLowerCase().startsWith(typed.toLowerCase());
    if (suggestActive)
        html += `<span class="hl-ghost">${esc(cur.slice(typed.length))}</span>`;
    ink.innerHTML = html;
}
function acceptSuggestion() {
    const cur = currentCmd();
    if (!cur || cmd.value.length >= cur.length)
        return;
    cmd.value = cur;
    const end = cmd.value.length;
    cmd.setSelectionRange(end, end);
    updateInk();
}
function caretAtEnd() {
    return cmd.selectionStart === cmd.value.length && cmd.selectionEnd === cmd.value.length;
}
// ---- command line behaviour ----------------------------------------
function showNudge(text) { nudgeEl.textContent = text; nudgeEl.classList.add("show"); }
function clearNudge() { nudgeEl.classList.remove("show"); }
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
    updateInk();
    stepIndex++;
    busy = true;
    await step.run(arg);
    busy = false;
    showStep(stepIndex);
});
cmd.addEventListener("input", () => { clearNudge(); updateInk(); });
cmd.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && suggestActive) {
        e.preventDefault();
        acceptSuggestion();
    }
    else if (e.key === "ArrowRight" && suggestActive && caretAtEnd()) {
        e.preventDefault();
        acceptSuggestion();
    }
});
// keep the only input focused: typing should always land, no clicking required
function keepFocus() {
    if (!document.hidden)
        cmd.focus();
}
cmd.addEventListener("blur", () => requestAnimationFrame(keepFocus));
document.addEventListener("click", keepFocus);
// ---- boot -----------------------------------------------------------
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
    if (stepIndex > 0)
        dockStage();
});
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
}
else {
    boot();
}
//# sourceMappingURL=app.js.map