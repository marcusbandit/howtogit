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
    const disp = graph.querySelector("#boil feDisplacementMap");
    if (turb)
        turb.setAttribute("seed", "4"); // one fixed noise field, no snapping
    if (S.prefersReduced) {
        if (disp)
            disp.setAttribute("scale", "0");
        return;
    }
    const loop = (now) => {
        const t = now / 1000;
        // the whole sheet floats, smoothly and continuously
        const x = Math.sin(t * 0.16) * 7 + Math.sin(t * 0.07) * 3;
        const y = Math.cos(t * 0.13) * 5 + Math.sin(t * 0.05) * 2;
        graph.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        // the ink warp breathes by degrees instead of clicking between frames
        if (disp)
            disp.setAttribute("scale", (1.8 + Math.sin(t * 0.85) * 0.8).toFixed(2));
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
// when true, drawing happens with no animation (used for timeline replay)
let instant = false;
// ---- small animation helpers ---------------------------------------
function animateIn(node, delay = 0) {
    if (instant || S.prefersReduced)
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
    if (instant || S.prefersReduced) {
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
    if (instant)
        return; // already rendered in full
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
    if (instant)
        return; // already rendered in full
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
    if (instant) {
        conn.style.opacity = "0.5";
        ring.style.opacity = "0.55";
    }
    else {
        requestAnimationFrame(() => {
            conn.style.transition = "opacity .4s ease";
            ring.style.transition = "opacity .4s ease";
            conn.style.opacity = "0.5";
            ring.style.opacity = "0.55";
        });
    }
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
// push: stamp origin/main onto the pushed commit; the remote panel then fills
async function doPush() {
    const head = headNode();
    if (!head)
        return;
    pill(gLabels, "origin/main", head.x, head.y + head.r + 66, COLORS.remote, 7, 120);
}
const atomText = (a) => (typeof a.text === "function" ? a.text() : a.text);
const atomSep = (atoms, i) => atoms[i].sep ?? (i === 0 ? "" : " ");
const A = (text, tone, opts = {}) => ({ text, tone, ...opts });
// what a fully-typed command looks like (for replay + width sizing)
function canonical(step) {
    return step.atoms.map((a, i) => atomSep(step.atoms, i) + atomText(a)).join("");
}
// one colour per whitespace-separated word (joined atoms share their first tone)
function tokenTones(atoms) {
    const tones = [];
    atoms.forEach((a, i) => { if (i === 0 || atomSep(atoms, i) === " ")
        tones.push(a.tone); });
    return tones;
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
            A('"first commit"', "val", { rest: true }),
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
// colour each whitespace word to match its part chip
function colorize(typed, tones) {
    let html = "";
    let ti = 0;
    for (const part of typed.split(/(\s+)/)) {
        if (part === "")
            continue;
        if (/^\s+$/.test(part)) {
            html += esc(part);
            continue;
        }
        let cls;
        if (ti === 0)
            cls = "git".startsWith(part.toLowerCase()) ? "hl-cmd" : "hl-rest";
        else
            cls = `hl-${tones[Math.min(ti, tones.length - 1)] ?? "rest"}`;
        html += `<span class="${cls}">${esc(part)}</span>`;
        ti++;
    }
    return html;
}
// the suggestion for atoms[start..], fully unfilled, with their separators
function suggestFrom(atoms, start, includeFirstSep) {
    let g = "";
    for (let j = start; j < atoms.length; j++) {
        const sep = j === start && !includeFirstSep ? "" : atomSep(atoms, j);
        g += sep + atomText(atoms[j]);
    }
    return g;
}
// walk the typed text against the atoms. `ghost` is everything still to type;
// `chunk` is just the next atom (what one Tab fills). Free atoms soft-suggest
// their text while it still matches, then yield to the following atoms.
function match(typed, atoms) {
    let pos = 0;
    for (let a = 0; a < atoms.length; a++) {
        const sep = atomSep(atoms, a);
        if (sep) {
            if (typed.startsWith(sep, pos))
                pos += sep.length;
            else if (pos >= typed.length)
                return { ghost: suggestFrom(atoms, a, true), chunk: sep + atomText(atoms[a]) };
            else
                return { ghost: "", chunk: "" };
        }
        const text = atomText(atoms[a]);
        const rem = typed.slice(pos);
        if (atoms[a].rest) {
            return rem.length === 0 ? { ghost: text, chunk: text } : { ghost: "", chunk: "" };
        }
        if (rem.length === 0)
            return { ghost: suggestFrom(atoms, a, false), chunk: text };
        if (atoms[a].free) {
            const next = atoms[a + 1];
            const stop = next ? (atomSep(atoms, a + 1) || atomText(next)[0] || " ") : " ";
            const stopIdx = rem.indexOf(stop);
            if (stopIdx === -1) {
                pos = typed.length;
                if (text.toLowerCase().startsWith(rem.toLowerCase())) {
                    return { ghost: text.slice(rem.length) + suggestFrom(atoms, a + 1, true), chunk: text.slice(rem.length) };
                }
                return {
                    ghost: suggestFrom(atoms, a + 1, true),
                    chunk: next ? atomSep(atoms, a + 1) + atomText(next) : "",
                };
            }
            pos += stopIdx;
            continue;
        }
        if (text.startsWith(rem))
            return { ghost: text.slice(rem.length) + suggestFrom(atoms, a + 1, true), chunk: text.slice(rem.length) };
        if (rem.startsWith(text)) {
            pos += text.length;
            continue;
        }
        return { ghost: "", chunk: "" };
    }
    return { ghost: "", chunk: "" };
}
function updateInk() {
    const typed = cmd.value;
    const atoms = currentAtoms();
    const ghost = atoms ? match(typed, atoms).ghost : "";
    suggestActive = ghost.length > 0;
    const tones = atoms ? tokenTones(atoms) : ["cmd"];
    let html = colorize(typed, tones);
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
    const { chunk } = match(cmd.value, atoms);
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
    updateInk();
    stepIndex++;
    busy = true;
    await step.run(arg);
    busy = false;
    showStep(stepIndex);
    updateTimeline();
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
const MARK = { plain: "", untracked: "·", staged: "+", committed: "✓" };
// stepIndex maps to disk state: 0 before init, 1 init, 2 add, 3 commit
function fileStateForStep(i) {
    if (i <= 0)
        return "plain";
    if (i === 1)
        return "untracked";
    if (i === 2)
        return "staged";
    return "committed";
}
let lastGitPresent = false;
function renderFileTree() {
    const state = fileStateForStep(stepIndex);
    const gitPresent = stepIndex >= 1;
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
        const li = document.createElement("li");
        li.className = state === "plain" ? "f" : `f f--${state}`;
        li.append(makeName(f));
        if (MARK[state]) {
            const m = document.createElement("span");
            m.className = "f__mark";
            m.textContent = MARK[state];
            li.appendChild(m);
        }
        treeList.appendChild(li);
    }
    lastGitPresent = gitPresent;
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
    const shown = stepIndex >= 4; // git remote add done
    const pushed = stepIndex >= 5; // git push done
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
    const paired = stepIndex >= 4;
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
        label.textContent = `git ${st.key}`;
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
    model.tagEls = null;
    model.pending = null;
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