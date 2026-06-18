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
} as const;

// the board is drawn ~20% larger than 1:1 by shrinking the viewBox under the
// full-size <svg>. One knob zooms every node, label and stroke together.
const ZOOM = 1.2;

// ---- DOM ------------------------------------------------------------
function need<T extends Element>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`howtogit: missing #${id}`);
  return e as unknown as T;
}
function needSel<T extends Element>(sel: string): T {
  const e = document.querySelector(sel);
  if (!e) throw new Error(`howtogit: missing ${sel}`);
  return e as unknown as T;
}

const graph = need<SVGSVGElement>("graph");
const gEdges = need<SVGGElement>("edges");
const gNodes = need<SVGGElement>("nodes");
const gNib = need<SVGGElement>("ink-nib");
const gLabels = need<SVGGElement>("labels");
const stage = need<HTMLElement>("stage");
const form = need<HTMLFormElement>("cli");
const cmd = need<HTMLInputElement>("cmd");
const ink = need<HTMLElement>("ink");
const tabhint = need<HTMLElement>("tabhint");
const goalEl = need<HTMLElement>("goal");
const whyEl = need<HTMLElement>("why");
const partsEl = need<HTMLElement>("parts");
const nudgeEl = need<HTMLElement>("nudge");
const treeEl = need<HTMLElement>("filetree");
const treeList = need<HTMLElement>("tree-list");
const remoteTreeEl = need<HTMLElement>("remotetree");
const remoteList = need<HTMLElement>("remote-list");
const timelineEl = need<HTMLElement>("timeline");
const brandRule = needSel<SVGSVGElement>(".brand__rule");
const cliRule = needSel<SVGSVGElement>(".cli__rule");

// ---- graph model ----------------------------------------------------
type Shape = "circle" | "square";
type Pt = { x: number; y: number };

interface CommitNode {
  id: number;
  col: number;
  x: number;
  y: number;
  r: number;
  branch: string;
  color: string;
  shape: Shape;
}
interface Pending {
  els: SVGElement[];
  pos: Pt;
}
interface Model {
  nodes: CommitNode[];
  head: number | null;
  tagEls: SVGGElement | null;
  pending: Pending | null;
}

const model: Model = { nodes: [], head: null, tagEls: null, pending: null };
const GAP = 150;   // horizontal distance between commits (viewBox units)
const NODE_R = 28; // base node radius (viewBox units)

// viewBox dimensions: the drawing space, smaller than the screen by ZOOM
let viewW = window.innerWidth / ZOOM;
let viewH = window.innerHeight / ZOOM;

function boardCenter(): Pt {
  return { x: viewW / 2, y: viewH * 0.42 };
}
// column i sits to the right of the first node, which lives at board centre
function nodePos(col: number): Pt {
  const c = boardCenter();
  return { x: c.x + col * GAP, y: c.y };
}
function headNode(): CommitNode | undefined {
  return model.nodes.find((n) => n.id === model.head);
}

// ---- board sizing ---------------------------------------------------
function sizeBoard(): void {
  const w = window.innerWidth, h = window.innerHeight;
  viewW = w / ZOOM;
  viewH = h / ZOOM;
  graph.setAttribute("width", String(w));
  graph.setAttribute("height", String(h));
  graph.setAttribute("viewBox", `0 0 ${viewW} ${viewH}`);
}

// ---- the two underlines (brand + command line) ----------------------
function drawRule(svg: SVGSVGElement, color: string, seed: number): void {
  const vb = svg.viewBox.baseVal;
  const y = vb.height * 0.55;
  const d = S.linePath(vb.width * 0.03, y, vb.width * 0.97, y, seed, 0.8);
  svg.appendChild(S.el("path", {
    d, class: "edge-stroke", stroke: color,
    "stroke-width": Math.max(1.6, vb.height * 0.18),
  }));
}

// ---- ambient life: boil + a slow whole-sheet drift ------------------
function startAmbient(): void {
  const turb = graph.querySelector("#boil feTurbulence");
  const disp = graph.querySelector("#boil feDisplacementMap");
  if (turb) turb.setAttribute("seed", "4"); // one fixed noise field, no snapping
  if (S.prefersReduced) {
    if (disp) disp.setAttribute("scale", "0");
    return;
  }
  const loop = (now: number) => {
    const t = now / 1000;
    // the whole sheet floats, smoothly and continuously
    const x = Math.sin(t * 0.16) * 7 + Math.sin(t * 0.07) * 3;
    const y = Math.cos(t * 0.13) * 5 + Math.sin(t * 0.05) * 2;
    graph.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    // the ink warp breathes by degrees instead of clicking between frames
    if (disp) disp.setAttribute("scale", (1.8 + Math.sin(t * 0.85) * 0.8).toFixed(2));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// when true, drawing happens with no animation (used for timeline replay)
let instant = false;

// ---- small animation helpers ---------------------------------------
function animateIn(node: SVGElement | HTMLElement, delay = 0): void {
  if (instant || S.prefersReduced) return;
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
function fadeOutRemove(node: SVGElement | HTMLElement, dur = 300): void {
  if (instant || S.prefersReduced) { node.remove(); return; }
  node.style.transition = `opacity ${dur}ms ease`;
  node.style.opacity = "0";
  setTimeout(() => node.remove(), dur + 20);
}

// ---- shapes ---------------------------------------------------------
function shapePath(shape: Shape, x: number, y: number, r: number, seed: number): string {
  if (shape === "square") return S.squarePath(x, y, r * 1.7, seed);
  return S.circlePath(x, y, r, seed);
}

// ---- drawing --------------------------------------------------------
async function drawNode(node: CommitNode, seed: number): Promise<void> {
  const main = S.el("path", {
    d: shapePath(node.shape, node.x, node.y, node.r, seed),
    class: "node-stroke", stroke: node.color, "stroke-width": 2.8,
  }) as SVGPathElement;
  const second = S.el("path", {
    d: shapePath(node.shape, node.x, node.y, node.r * 0.97, seed + 31),
    class: "node-stroke", stroke: node.color, "stroke-width": 1.5, opacity: 0.5,
  }) as SVGPathElement;
  gNodes.appendChild(main);
  gNodes.appendChild(second);
  if (instant) return;            // already rendered in full
  await S.drawOn(main, { duration: 720, nibGroup: gNib, color: node.color });
  S.drawOn(second, { duration: 360 });
}

// a stroke from one node's edge to another's, trimmed so it kisses the rims
function connectorPath(from: { x: number; y: number; r: number }, to: { x: number; y: number; r: number }, seed: number): string {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sx = from.x + ux * (from.r + 3), sy = from.y + uy * (from.r + 3);
  const ex = to.x - ux * (to.r + 3), ey = to.y - uy * (to.r + 3);
  return S.linePath(sx, sy, ex, ey, seed, 0.8);
}
async function drawConnector(from: CommitNode, to: CommitNode, color: string, seed: number): Promise<void> {
  const p = S.el("path", {
    d: connectorPath(from, to, seed), class: "edge-stroke",
    stroke: color, "stroke-width": 2.4,
  }) as SVGPathElement;
  gEdges.appendChild(p);
  if (instant) return;            // already rendered in full
  await S.drawOn(p, { duration: 460, nibGroup: gNib, color });
}

// a handwritten label inside a hand-drawn box
function pill(parent: SVGElement, text: string, cx: number, midY: number, color: string, seed: number, delay: number): void {
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
function placeTags(node: CommitNode, branchName: string, color: string): void {
  if (model.tagEls) fadeOutRemove(model.tagEls, 220);
  const g = S.el("g") as SVGGElement;
  gLabels.appendChild(g);
  g.appendChild(makeTick(node));
  pill(g, branchName, node.x, node.y - node.r - 42, color, 2, 120);
  pill(g, "HEAD", node.x, node.y - node.r - 84, COLORS.ink, 3, 240);
  model.tagEls = g;
}
function makeTick(node: CommitNode): SVGElement {
  const tick = S.el("path", {
    d: S.linePath(node.x, node.y - node.r - 2, node.x, node.y - node.r - 22, 5, 0.6),
    class: "edge-stroke", stroke: COLORS.inkSoft, "stroke-width": 1.4,
  });
  animateIn(tick, 40);
  return tick;
}

function caption(text: string, cx: number, y: number, delay: number, faint = false): SVGTextElement {
  const t = S.el("text", {
    x: cx, y, "text-anchor": "middle", class: "commit-msg",
  }) as SVGTextElement;
  if (faint) t.setAttribute("opacity", "0.6");
  t.textContent = text;
  gLabels.appendChild(t);
  animateIn(t, delay);
  return t;
}

// ---- step actions ---------------------------------------------------
async function doInit(): Promise<void> {
  const p = nodePos(0);
  const node: CommitNode = {
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
async function doAdd(): Promise<void> {
  const from = headNode();
  if (!from) return;
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
  } else {
    requestAnimationFrame(() => {
      conn.style.transition = "opacity .4s ease";
      ring.style.transition = "opacity .4s ease";
      conn.style.opacity = "0.5";
      ring.style.opacity = "0.55";
    });
  }
  model.pending = { els: [conn, ring, tag], pos: p };
}

async function doCommit(message = "first commit"): Promise<void> {
  const from = headNode();
  if (!from) return;
  const p = model.pending ? model.pending.pos : nodePos(model.nodes.length);
  if (model.pending) {
    model.pending.els.forEach((e) => fadeOutRemove(e, 240));
    model.pending = null;
  }
  const node: CommitNode = {
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

// the address of the remote, captured from `git remote add`
let remoteUrl = "https://github.com/you/my-site.git";

// connecting a remote changes no graph; the remote panel slides in afterwards
async function doRemoteAdd(arg?: string): Promise<void> {
  if (arg) remoteUrl = arg;
}

// push: stamp origin/main onto the pushed commit; the remote panel then fills
async function doPush(): Promise<void> {
  const head = headNode();
  if (!head) return;
  pill(gLabels, "origin/main", head.x, head.y + head.r + 66, COLORS.remote, 7, 120);
}

// ---- step machine ---------------------------------------------------
type Tone = "cmd" | "flag" | "val";
interface Part { t: string; tone: Tone; why: string; }
interface Teach { goal: string; why: string; parts: Part[]; }
interface Step {
  key: string;                       // short label for the timeline
  cmd: string;                       // full command, including "git"
  test: (s: string) => boolean;
  hint: string;
  teach: Teach;
  run: (arg?: string) => Promise<void>;
  extract?: (s: string) => string;
}

let stepIndex = 0;
const steps: Step[] = [
  {
    key: "init",
    cmd: "git init",
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
    cmd: "git add .",
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
    cmd: 'git commit -m "first commit"',
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
    cmd: "git remote add origin https://github.com/you/my-site.git",
    test: (s) => /^git\s+remote\s+add\s+origin\s+\S+$/i.test(s),
    extract: (s) => {
      const m = s.match(/add\s+origin\s+(\S+)/i);
      return m ? m[1] : remoteUrl;
    },
    hint: "Connect a remote:  git remote add origin <url>",
    teach: {
      goal: "Connect a remote",
      why: "Point your repo at a copy hosted elsewhere, like GitHub.",
      parts: [
        { t: "remote add", tone: "cmd", why: "register a remote copy of the repo" },
        { t: "origin", tone: "val", why: "a nickname for it (origin is the usual one)" },
        { t: "…url", tone: "flag", why: "where the remote lives" },
      ],
    },
    run: doRemoteAdd,
  },
  {
    key: "push",
    cmd: "git push -u origin main",
    test: (s) => /^git\s+push(\s+-u\s+origin\s+main)?$/i.test(s),
    hint: "Send your commits:  git push -u origin main",
    teach: {
      goal: "Send it to the remote",
      why: "Upload your commits so the remote has them too.",
      parts: [
        { t: "push", tone: "cmd", why: "upload your commits to the remote" },
        { t: "-u origin main", tone: "flag", why: "send your main branch to origin" },
      ],
    },
    run: doPush,
  },
];
const END = {
  teach: {
    goal: "It's on the remote",
    why: "Your local repo and the remote now share the same history.",
    parts: [] as Part[],
  },
  tease: "That's the whole first loop. More git is on the way ✦",
};

function currentCmd(): string {
  return stepIndex < steps.length ? steps[stepIndex].cmd : "";
}

function renderTeach(teach: Teach): void {
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

function showStep(i: number): void {
  const teach = i < steps.length ? steps[i].teach : END.teach;
  const lesson = goalEl.parentElement;
  if (lesson && !S.prefersReduced) {
    lesson.style.opacity = "0";
    setTimeout(() => { renderTeach(teach); lesson.style.opacity = ""; }, 200);
  } else {
    renderTeach(teach);
  }
  updateInk();
}

// ---- command line: live highlight + ghost suggestion ----------------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
let suggestActive = false;

function updateInk(): void {
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
  if (suggestActive) html += `<span class="hl-ghost">${esc(cur.slice(typed.length))}</span>`;

  ink.innerHTML = html;

  // size the field to the command so the whole line stays centred, never cut
  const chars = Math.max(cur.length, typed.length, 6) + 1;
  cmd.style.width = `${chars}ch`;

  // only nudge about Tab once there's something to complete and they've started
  tabhint.classList.toggle("show", suggestActive && typed.length > 0);
}

function acceptSuggestion(): void {
  const cur = currentCmd();
  if (!cur || cmd.value.length >= cur.length) return;
  cmd.value = cur;
  const end = cmd.value.length;
  cmd.setSelectionRange(end, end);
  updateInk();
}
function caretAtEnd(): boolean {
  return cmd.selectionStart === cmd.value.length && cmd.selectionEnd === cmd.value.length;
}

// ---- command line behaviour ----------------------------------------
function showNudge(text: string): void { nudgeEl.textContent = text; nudgeEl.classList.add("show"); }
function clearNudge(): void { nudgeEl.classList.remove("show"); }
function shake(): void {
  form.classList.remove("shake");
  void form.offsetWidth;
  form.classList.add("shake");
}
function dockStage(): void {
  stage.classList.remove("is-centered");
  stage.classList.add("is-docked");
  stage.style.setProperty("--stage-y", `${Math.round(window.innerHeight * 0.67)}px`);
}
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

let busy = false;
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const input = normalize(cmd.value);
  if (!input) return;

  if (stepIndex >= steps.length) { showNudge(END.tease); return; }
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
  if (e.key === "Tab" && suggestActive) { e.preventDefault(); acceptSuggestion(); }
  else if (e.key === "ArrowRight" && suggestActive && caretAtEnd()) { e.preventDefault(); acceptSuggestion(); }
});

// keep the only input focused: typing should always land, no clicking required
function keepFocus(): void {
  if (!document.hidden) cmd.focus();
}
cmd.addEventListener("blur", () => requestAnimationFrame(keepFocus));
document.addEventListener("click", keepFocus);

// ---- file tree (left) ----------------------------------------------
const PROJECT = { root: "my-site", files: ["index.html", "style.css", "app.js"] };
type FileState = "plain" | "untracked" | "staged" | "committed";
const MARK: Record<FileState, string> = { plain: "", untracked: "·", staged: "+", committed: "✓" };

// stepIndex maps to disk state: 0 before init, 1 init, 2 add, 3 commit
function fileStateForStep(i: number): FileState {
  if (i <= 0) return "plain";
  if (i === 1) return "untracked";
  if (i === 2) return "staged";
  return "committed";
}

let lastGitPresent = false;
function renderFileTree(): void {
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
    if (!lastGitPresent) git.classList.add("is-new");
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
function makeName(text: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "f__name";
  s.textContent = text;
  return s;
}

// ---- remote tree (right) -------------------------------------------
let lastRemoteShown = false;
let lastRemotePushed = false;
function renderRemoteTree(): void {
  const shown = stepIndex >= 4;    // git remote add done
  const pushed = stepIndex >= 5;   // git push done
  remoteTreeEl.classList.toggle("is-shown", shown);
  remoteList.replaceChildren();
  if (!shown) { lastRemoteShown = false; lastRemotePushed = false; return; }

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
  if (!lastRemoteShown) git.classList.add("is-new");
  const note = document.createElement("span");
  note.className = "f__note";
  note.textContent = "the remote repo";
  git.append(makeName(".git/"), note);
  remoteList.appendChild(git);

  if (pushed) {
    for (const f of PROJECT.files) {
      const li = document.createElement("li");
      li.className = "f f--committed";
      if (!lastRemotePushed) li.classList.add("is-new");
      li.append(makeName(f));
      const m = document.createElement("span");
      m.className = "f__mark";
      m.textContent = MARK.committed;
      li.appendChild(m);
      remoteList.appendChild(li);
    }
  } else {
    const empty = document.createElement("li");
    empty.className = "remote-empty";
    empty.textContent = "nothing pushed yet";
    remoteList.appendChild(empty);
  }
  lastRemoteShown = shown;
  lastRemotePushed = pushed;
}

// once a remote exists the local tree shares the stage; before that it leads
function updateLayout(): void {
  const paired = stepIndex >= 4;
  treeEl.classList.toggle("is-focus", !paired);
  treeEl.classList.toggle("is-paired", paired);
}

// ---- timeline (bottom, clickable) ----------------------------------
const tlItems: HTMLButtonElement[] = [];
function buildTimeline(): void {
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
function updateTimeline(): void {
  tlItems.forEach((btn, i) => {
    btn.classList.toggle("is-done", i < stepIndex);
    btn.classList.toggle("is-current", i === stepIndex);
  });
}

// ---- seek: rebuild instantly to a chosen step ----------------------
function resetBoard(): void {
  [gEdges, gNodes, gNib, gLabels].forEach((g) => g.replaceChildren());
  model.nodes = [];
  model.head = null;
  model.tagEls = null;
  model.pending = null;
}
async function seekTo(target: number): Promise<void> {
  if (busy || target === stepIndex) return;
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
    await st.run(st.extract ? st.extract(st.cmd) : undefined);
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
function boot(): void {
  sizeBoard();
  stage.style.setProperty("--stage-y", "50%");
  drawRule(brandRule, COLORS.main, 11);
  drawRule(cliRule, COLORS.ink, 4);
  startAmbient();
  showStep(0);
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
  if (stepIndex > 0) dockStage();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
