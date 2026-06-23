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
import {
  replayTo,
  snapshot,
  type Snapshot as RepoSnapshot,
  type GitNode as RepoGitNode,
  type RepoCmd,
} from "./repo.js";

const COLORS = {
  ink: "#2a2521",
  inkSoft: "#7a7060",
  main: "#2e5c9e",
  feature: "#c0492f",
  green: "#3f7a4e",
  remote: "#6b5ca5",
} as const;

// ---- session memory (survives a normal reload) ----------------------
// A session is two things: which step you're on, and every value you typed on
// the way there (commit messages, the remote's name + url, branch names), kept
// keyed by step. Replaying / seeking reuses YOUR words instead of the canned
// defaults, and a normal reload drops you back exactly where you left off.
// A hard refresh (Ctrl+Shift+R) is treated as "start me clean" — see
// isHardRefresh, which is the only reliable way to tell the two reloads apart.
const LS_SESSION = "htg-session-v1";
const LS_CACHE_OK = "htg-cache-ok"; // have we ever seen the probe served from cache?
const PROBE_NAME = "reload-probe.js";

interface Persisted {
  step: number;
  values: Record<string, string>;
}
let persisted: Persisted = { step: 0, values: {} };

function savePersisted(): void {
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify(persisted));
  } catch {
    /* private mode / full */
  }
}
function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Persisted>;
    if (
      !p ||
      typeof p.step !== "number" ||
      typeof p.values !== "object" ||
      !p.values
    )
      return null;
    return { step: p.step, values: p.values as Record<string, string> };
  } catch {
    return null;
  }
}
function clearPersisted(): void {
  persisted = { step: 0, values: {} };
  try {
    localStorage.removeItem(LS_SESSION);
  } catch {
    /* ignore */
  }
}

// The browser gives no direct "was this a hard refresh?" flag: a normal reload
// and a Ctrl+Shift+R both report navigation type "reload". The only thing a hard
// refresh changes is the HTTP cache — it re-downloads everything. So we watch a
// tiny cached-forever probe (reload-probe.js): on a normal reload it comes from
// cache (resource-timing transferSize === 0); a hard refresh re-fetches it (> 0).
// We only act on this once we've actually seen the probe cached at least once
// (LS_CACHE_OK), so a no-cache dev server, proxy, or misconfigured host can
// never make us forget by mistake — it just keeps remembering. And only a real
// reload counts (a fresh navigation with an evicted cache must NOT wipe state).
function isHardRefresh(): boolean {
  let navType = "";
  let probe: PerformanceResourceTiming | undefined;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    navType = nav?.type ?? "";
    probe = (
      performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    ).find((e) => e.name.includes(PROBE_NAME));
  } catch {
    return false;
  }
  if (!probe) return false; // can't tell -> keep remembering
  const fromCache = probe.transferSize === 0;
  let cacheOk = false;
  try {
    cacheOk = localStorage.getItem(LS_CACHE_OK) === "1";
  } catch {
    /* ignore */
  }
  if (fromCache && !cacheOk) {
    cacheOk = true; // self-calibrate: caching works here
    try {
      localStorage.setItem(LS_CACHE_OK, "1");
    } catch {
      /* ignore */
    }
  }
  return navType === "reload" && !fromCache && cacheOk;
}

// the board is drawn ~20% larger than 1:1 by shrinking the viewBox under the
// full-size <svg>. One knob zooms every node, label and stroke together.
// On a narrow phone we zoom OUT (smaller ZOOM = more board per screen) so the
// whole git graph — branch lanes and the merge diamond included — fits the
// width instead of crawling off the edges.
function computeZoom(): number {
  const w = window.innerWidth;
  if (w >= 760) return 1.2; // desktop / tablet: unchanged
  // phone: shrink so ~3 commit columns sit comfortably across the width
  return Math.max(0.5, Math.min(1.0, w / 470));
}
let ZOOM = computeZoom();

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
const gRemote = need<SVGGElement>("remote-graph");
const gRemoteInner = need<SVGGElement>("remote-graph-inner");
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
const noteEl = need<HTMLElement>("note");
const partsEl = need<HTMLElement>("parts");
const nudgeEl = need<HTMLElement>("nudge");
const treeEl = need<HTMLElement>("filetree");
const treeList = need<HTMLElement>("tree-list");
const remoteTreeEl = need<HTMLElement>("remotetree");
const remoteList = need<HTMLElement>("remote-list");
const timelineEl = need<HTMLElement>("timeline");
const companionEl = need<HTMLElement>("companion");
const companionList = need<HTMLElement>("companion-list");
const companionArrows = need<SVGSVGElement>("companion-arrows");
const remoteNoteEl = need<HTMLElement>("remote-note");
const brandRule = needSel<SVGSVGElement>(".brand__rule");
const cliRule = needSel<SVGSVGElement>(".cli__rule");

// ---- graph model ----------------------------------------------------
type Shape = "circle" | "square";
type Pt = { x: number; y: number };

interface CommitNode {
  id: number;
  col: number;
  lane: number; // 0 = main; negative lanes sit above
  x: number;
  y: number;
  r: number;
  branch: string;
  color: string;
  shape: Shape;
}
interface Branch {
  color: string;
  shape: Shape;
  lane: number;
  tip: number | null; // node id this branch points at
  staged?: boolean; // changes staged on a freshly-branched (projected) lane
}
interface Pending {
  els: SVGElement[];
  pos: Pt;
}
interface Model {
  nodes: CommitNode[];
  head: number | null; // node id at the tip of the current branch
  headBranch: string; // the branch HEAD is on
  branches: Record<string, Branch>;
  tagEls: SVGGElement | null;
  pending: Pending | null;
}

const model: Model = {
  nodes: [],
  head: null,
  headBranch: "main",
  branches: {},
  tagEls: null,
  pending: null,
};
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

function boardCenter(): Pt {
  return { x: viewW / 2, y: viewH * 0.5 }; // lowered so the local graph clears the remote
}
// column i sits to the right of the first node; lane shifts it onto a branch row
function nodePos(col: number, lane = 0): Pt {
  const c = boardCenter();
  return { x: c.x + col * GAP, y: c.y + lane * LANE_GAP };
}
function headNode(): CommitNode | undefined {
  return model.nodes.find((n) => n.id === model.head);
}
function nodeById(id: number | null): CommitNode | undefined {
  return id == null ? undefined : model.nodes.find((n) => n.id === id);
}

// ---- board sizing ---------------------------------------------------
function sizeBoard(): void {
  ZOOM = computeZoom(); // re-fit on every resize / orientation change
  const w = window.innerWidth,
    h = window.innerHeight;
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
  svg.appendChild(
    S.el("path", {
      d,
      class: "edge-stroke",
      stroke: color,
      "stroke-width": Math.max(1.6, vb.height * 0.18),
    }),
  );
}

// ---- ambient life: the ink "boils" only while it's being laid down --
// When nothing is drawing the board is completely still: a fixed warp and no
// sheet drift. Every stroke nudges `activeUntil` forward; the boil eases back
// to rest a beat after the last stroke, then the loop parks itself so an idle
// board costs nothing and never wanders.
const BOIL_REST = 1.6; // static warp scale held while idle
const BOIL_TAIL = 700; // keep boiling this long past the last stroke
let boilDisp: Element | null = null;
let activeUntil = 0;
let boilRunning = false;

function boilLoop(now: number): void {
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
function nudgeBoil(): void {
  if (S.prefersReduced || !boilDisp) return;
  activeUntil = performance.now() + BOIL_TAIL;
  if (!boilRunning) {
    boilRunning = true;
    requestAnimationFrame(boilLoop);
  }
}

function startAmbient(): void {
  const turb = graph.querySelector("#boil feTurbulence");
  boilDisp = graph.querySelector("#boil feDisplacementMap");
  if (turb) turb.setAttribute("seed", "4"); // one fixed noise field, no snapping
  graph.style.transform = "none"; // the sheet stays put: no idle drift
  if (S.prefersReduced) {
    if (boilDisp) boilDisp.setAttribute("scale", "0");
    return;
  }
  // rest still until the first stroke nudges the boil awake
  if (boilDisp) boilDisp.setAttribute("scale", BOIL_REST.toFixed(2));
}

// every on-board stroke keeps the boil alive for its draw (plus a short tail)
function drawOn(
  pathEl: SVGPathElement,
  opts: S.DrawOnOptions = {},
): Promise<void> {
  nudgeBoil();
  const done = S.drawOn(pathEl, opts);
  void done.then(() => nudgeBoil());
  return done;
}

// when true, drawing happens with no animation (used for timeline replay)
let instant = false;

// ---- tempo: one rhythm for the whole experience --------------------
// The overwhelm was never the amount of content, it was every piece of a step
// landing on the same beat. So reveals are spaced by a shared BEAT, and each
// step carries a "weight": a brand-new idea breathes (full beat), a familiar
// repeat moves quicker (half a beat). Tune the whole feel with one number.
// Timeline seeks (instant) and reduced motion skip pacing entirely.
const BEAT = 520; // ms — the base unit of breathing room
const FAMILIAR = new Set(["add2", "commit2", "checkout-main", "push2"]);
function stepWeight(key: string): number {
  return FAMILIAR.has(key) ? 0.5 : 1;
}
// a paced pause of `beats` BEATs, scaled by `weight`. Resolves immediately
// during a seek or under reduced motion, so neither waits on the clock.
function beat(beats = 1, weight = 1): Promise<void> {
  if (instant || S.prefersReduced) return Promise.resolve();
  return new Promise((r) => setTimeout(r, Math.round(BEAT * beats * weight)));
}

// ---- small animation helpers ---------------------------------------
function animateIn(node: SVGElement | HTMLElement, delay = 0): void {
  if (instant || S.prefersReduced) return;
  nudgeBoil();
  node.style.opacity = "0";
  node.style.transform = "translateY(6px) scale(0.9)";
  node.style.transformOrigin = "center";
  node.style.transition =
    "opacity .45s ease, transform .5s cubic-bezier(.16,1,.3,1)";
  requestAnimationFrame(() =>
    setTimeout(() => {
      node.style.opacity = "1";
      node.style.transform = "translateY(0) scale(1)";
    }, delay),
  );
}
function fadeOutRemove(node: SVGElement | HTMLElement, dur = 300): void {
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
function shapePath(
  shape: Shape,
  x: number,
  y: number,
  r: number,
  seed: number,
): string {
  if (shape === "square") return S.squarePath(x, y, r * 1.7, seed);
  return S.circlePath(x, y, r, seed);
}

// ---- drawing --------------------------------------------------------
async function drawNode(node: CommitNode, seed: number): Promise<void> {
  const main = S.el("path", {
    d: shapePath(node.shape, node.x, node.y, node.r, seed),
    class: "node-stroke",
    stroke: node.color,
    "stroke-width": NODE_W,
  }) as SVGPathElement;
  const second = S.el("path", {
    d: shapePath(node.shape, node.x, node.y, node.r * 0.97, seed + 31),
    class: "node-stroke",
    stroke: node.color,
    "stroke-width": 1.5,
    opacity: 0.5,
  }) as SVGPathElement;
  gNodes.appendChild(main);
  gNodes.appendChild(second);
  if (instant) return; // already rendered in full
  await drawOn(main, { duration: 720, nibGroup: gNib, color: node.color });
  drawOn(second, { duration: 360 });
}

// a stroke from one node's edge to another's, trimmed so it kisses the rims
function connectorPath(
  from: { x: number; y: number; r: number },
  to: { x: number; y: number; r: number },
  seed: number,
): string {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const sx = from.x + ux * (from.r + 3),
    sy = from.y + uy * (from.r + 3);
  const ex = to.x - ux * (to.r + 3),
    ey = to.y - uy * (to.r + 3);
  return S.linePath(sx, sy, ex, ey, seed, 0.8);
}
async function drawConnector(
  from: CommitNode,
  to: CommitNode,
  color: string,
  seed: number,
): Promise<void> {
  const p = S.el("path", {
    d: connectorPath(from, to, seed),
    class: "edge-stroke",
    stroke: color,
    "stroke-width": EDGE_W,
  }) as SVGPathElement;
  gEdges.appendChild(p);
  if (instant) return; // already rendered in full
  await drawOn(p, { duration: 460, nibGroup: gNib, color });
}

// a pill centred on its own origin, so it can be translated into place
function makePill(text: string, color: string, seed: number): SVGGElement {
  const g = S.el("g") as SVGGElement;
  const w = text.length * 12 + 22;
  g.appendChild(
    S.el("path", {
      d: S.rectPath(0, 0, w, 30, seed),
      class: "tag-box",
      stroke: color,
      "stroke-width": 1.8,
      fill: "#efe7d2",
    }),
  );
  const t = S.el("text", {
    x: 0,
    y: 7,
    "text-anchor": "middle",
    class: "tag",
    fill: color,
  });
  t.textContent = text;
  g.appendChild(t);
  return g;
}

// Refs (branch names + HEAD) are persistent pills that MOVE to follow commits,
// rather than fading out and redrawing. Recompute every ref's target and glide
// each pill there; create new ones, drop gone ones.
const refPills = new Map<string, SVGGElement>();
let refTicks: SVGGElement | null = null;

function refPosition(cx: number, cy: number, level: number): Pt {
  return { x: cx, y: cy - NODE_R - 36 - level * 36 };
}
function ensurePill(
  key: string,
  label: string,
  color: string,
  seed: number,
): { g: SVGGElement; isNew: boolean } {
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
function placePill(g: SVGGElement, p: Pt, animateNew: boolean): void {
  // during instant replay (timeline seek) never schedule a deferred rAF: it
  // would fire after the seek finished and snap the pill back to a stale spot
  if (animateNew && !S.prefersReduced && !instant) {
    g.style.opacity = "0";
    g.style.transform = `translate(${p.x}px, ${p.y + 8}px) scale(0.9)`;
    requestAnimationFrame(() => {
      g.style.transform = `translate(${p.x}px, ${p.y}px) scale(1)`;
      g.style.opacity = "1";
    });
  } else {
    g.style.transform = `translate(${p.x}px, ${p.y}px) scale(1)`;
    g.style.opacity = "1";
  }
}

// is this branch still pointing at a commit on someone else's lane (i.e. it has
// no commit of its own yet)? Then we "project" it onto its own lane.
function isProjected(b: Branch): boolean {
  const tip = nodeById(b.tip);
  return !!tip && tip.lane !== b.lane;
}
function branchAnchor(b: Branch): Pt | null {
  const tip = nodeById(b.tip);
  if (!tip) return null;
  return isProjected(b) ? nodePos(tip.col + 1, b.lane) : { x: tip.x, y: tip.y };
}

// the freshly-branched lane traces on, then settles to its dashed "ghost" look.
// doBranch awaits projectedDrawDone so the step's busy lock covers the trace.
let projectedDrawDone: Promise<void> = Promise.resolve();
async function traceProjected(t: {
  stub: SVGPathElement;
  ghost: SVGPathElement;
  color: string;
  dash: string;
}): Promise<void> {
  // trace the stub up to where the first commit will land, then the ghost node
  // outline, like every other drawn thing. drawOn leaves a path solid, so put
  // the dashes back afterward to keep the "not real yet" look.
  await drawOn(t.stub, { duration: 380, nibGroup: gNib, color: t.color });
  t.stub.style.strokeDasharray = t.dash;
  await drawOn(t.ghost, { duration: 520, nibGroup: gNib, color: t.color });
  t.ghost.style.strokeDasharray = t.dash;
}

// drawRefs(animateBranch) traces the named branch's freshly-projected lane on;
// every other caller passes nothing and the lane just appears (already drawn).
function drawRefs(animateBranch?: string): void {
  // ticks + dashed branch stubs: cheap, redraw each time
  if (refTicks) refTicks.remove();
  refTicks = S.el("g") as SVGGElement;
  gLabels.appendChild(refTicks);

  let toTrace: {
    stub: SVGPathElement;
    ghost: SVGPathElement;
    color: string;
    dash: string;
  } | null = null;
  const wanted = new Set<string>();
  for (const [name, b] of Object.entries(model.branches)) {
    const tip = nodeById(b.tip);
    const a = branchAnchor(b);
    if (!tip || !a) continue;

    // a freshly created branch diverges onto its lane right away: a dashed stub
    // shoots from the commit up to a ghost node outline where its first commit
    // will land, with the label floating above that
    if (isProjected(b)) {
      // two looks along the way to a real commit, from the shared ladder:
      //   branched, nothing staged -> loose dashes (LINE.ghost)
      //   staged on the branch      -> tighter dashes (LINE.staged)
      const st = b.staged ? LINE.staged : LINE.ghost;
      const stub = S.el("path", {
        d: connectorPath(tip, { x: a.x, y: a.y, r: NODE_R }, 21),
        class: "edge-stroke",
        stroke: b.color,
        "stroke-width": EDGE_W,
        "stroke-dasharray": st.dash,
        opacity: st.opacity,
      }) as SVGPathElement;
      refTicks.appendChild(stub);
      const ghostD =
        b.shape === "square"
          ? S.squarePath(a.x, a.y, NODE_R * 1.7, 23)
          : S.circlePath(a.x, a.y, NODE_R, 23);
      const ghost = S.el("path", {
        d: ghostD,
        class: "node-stroke",
        stroke: b.color,
        "stroke-width": NODE_W,
        "stroke-dasharray": st.dash,
        opacity: st.opacity,
      }) as SVGPathElement;
      refTicks.appendChild(ghost);
      if (animateBranch === name && !instant && !S.prefersReduced) {
        toTrace = { stub, ghost, color: b.color, dash: st.dash };
      }
    }
    refTicks.appendChild(
      S.el("path", {
        d: S.linePath(a.x, a.y - NODE_R - 2, a.x, a.y - NODE_R - 22, 5, 0.6),
        class: "edge-stroke",
        stroke: COLORS.inkSoft,
        "stroke-width": 1.4,
      }),
    );

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
  // only doBranch passes animateBranch; kick off the trace it will await
  if (animateBranch !== undefined) {
    projectedDrawDone = toTrace ? traceProjected(toTrace) : Promise.resolve();
  }
}

function caption(
  text: string,
  cx: number,
  y: number,
  delay: number,
  faint = false,
): SVGTextElement {
  const t = S.el("text", {
    x: cx,
    y,
    "text-anchor": "middle",
    class: "commit-msg",
  }) as SVGTextElement;
  if (faint) t.setAttribute("opacity", "0.6");
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
const boardGroups: SVGGElement[] = [gEdges, gNodes, gNib, gLabels];
// the graph lives in a central box this fraction of the view wide. While the
// whole graph fits inside it we centre the graph on its own midpoint; only once
// it outgrows the box do we pin HEAD to the centre and let the older commits
// slide out into the faded edges. Keep in sync with --box-fade in style.css,
// which fades the outer (1 - BOX_FRAC) / 2 on each side.
const BOX_FRAC = 0.66;
function centerOnHead(): void {
  const xs = model.nodes.map((n) => n.x);
  let targetX: number;
  if (xs.length) {
    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const margin = NODE_R * 2.4;
    if (maxX - minX + margin * 2 <= viewW * BOX_FRAC) {
      targetX = (minX + maxX) / 2; // fits the box: centre the graph
    } else {
      const h = headNode();
      targetX = h ? h.x : boardCenter().x; // outgrew the box: follow HEAD
    }
  } else {
    targetX = boardCenter().x;
  }
  const panX = viewW / 2 - targetX;
  boardPanX = panX; // the remote layer isn't panned, so it needs this to map a
  // local node's on-screen x into its own coordinate space
  for (const g of boardGroups) {
    g.style.transition =
      instant || S.prefersReduced
        ? "none"
        : "transform .6s cubic-bezier(.16,1,.3,1)";
    g.style.transform = `translateX(${panX}px)`;
  }
}
let boardPanX = 0;

// ---- step actions ---------------------------------------------------
async function doInit(): Promise<void> {
  const p = nodePos(0, 0);
  const node: CommitNode = {
    id: 0,
    col: 0,
    lane: 0,
    x: p.x,
    y: p.y,
    r: NODE_R,
    branch: "main",
    color: COLORS.main,
    shape: "circle",
  };
  model.nodes.push(node);
  model.head = 0;
  model.headBranch = "main";
  model.branches = {
    main: { color: COLORS.main, shape: "circle", lane: 0, tip: 0 },
  };
  dockStage();
  await drawNode(node, 3);
  drawRefs();
  caption("git init", node.x, node.y + node.r + 32, 360);
}

// where the current branch's next commit would land
function nextCommitPos(): {
  parent: CommitNode;
  pos: Pt;
  branch: Branch;
} | null {
  const branch = model.branches[model.headBranch];
  if (!branch) return null;
  const parent = nodeById(branch.tip) ?? headNode();
  if (!parent) return null;
  return { parent, branch, pos: nodePos(parent.col + 1, branch.lane) };
}

// staging: a faint, dashed preview of the commit that's about to exist
async function doAdd(): Promise<void> {
  const next = nextCommitPos();
  if (!next) return;
  const { parent, pos, branch } = next;
  const els: SVGElement[] = [];
  // on a projected branch the dashed stub + ghost are already on screen: restyle
  // them in place (loose dashes -> tighter staged dashes) so staging visibly
  // changes the look instead of drawing nothing. On the trunk we draw the
  // preview here, in the same staged style the branch case lands on.
  if (isProjected(branch)) {
    branch.staged = true;
    drawRefs();
  } else {
    const conn = S.el("path", {
      d: connectorPath(parent, { x: pos.x, y: pos.y, r: NODE_R }, 9),
      class: "edge-stroke",
      stroke: branch.color,
      "stroke-width": EDGE_W,
      "stroke-dasharray": LINE.staged.dash,
      opacity: 0,
    });
    const shape =
      branch.shape === "square"
        ? S.squarePath(pos.x, pos.y, NODE_R * 1.7, 9)
        : S.circlePath(pos.x, pos.y, NODE_R, 9);
    const ring = S.el("path", {
      d: shape,
      class: "node-stroke",
      stroke: branch.color,
      "stroke-width": NODE_W,
      "stroke-dasharray": LINE.staged.dash,
      opacity: 0,
    });
    gEdges.appendChild(conn);
    gNodes.appendChild(ring);
    els.push(conn, ring);
  }
  const tag = caption("staged", pos.x, pos.y + NODE_R + 30, 120, true);
  els.push(tag);
  const stagedOpacity = String(LINE.staged.opacity); // match the branch-staged look
  if (instant) {
    els.forEach((e) => {
      e.style.opacity = e === tag ? "0.6" : stagedOpacity;
    });
  } else {
    requestAnimationFrame(() => {
      els.forEach((e) => {
        e.style.transition = "opacity .4s ease";
        e.style.opacity = e === tag ? "0.6" : stagedOpacity;
      });
    });
  }
  model.pending = { els, pos };
}

async function doCommit(message = "first commit"): Promise<void> {
  const next = nextCommitPos();
  if (!next) return;
  const { parent, branch } = next;
  const pos = model.pending ? model.pending.pos : next.pos;
  if (model.pending) {
    model.pending.els.forEach((e) => fadeOutRemove(e, 240));
    model.pending = null;
  }
  const node: CommitNode = {
    id: model.nodes.length,
    col: parent.col + 1,
    lane: branch.lane,
    x: pos.x,
    y: pos.y,
    r: NODE_R,
    branch: model.headBranch,
    color: branch.color,
    shape: branch.shape,
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
async function doBranch(arg?: string): Promise<void> {
  const name = (arg ?? "feature").trim() || "feature";
  if (model.branches[name]) return;
  const idx = Object.keys(model.branches).length - 1; // existing non-main count
  model.branches[name] = {
    color: BRANCH_PALETTE[idx % BRANCH_PALETTE.length],
    shape: "square",
    lane: -(idx + 1),
    tip: model.head,
  };
  drawRefs(name); // trace the new lane on (the nib draws the stub + ghost node)
  await projectedDrawDone;
}

// switch HEAD onto a branch; new commits will land on its lane
async function doCheckout(arg?: string): Promise<void> {
  const name = (arg ?? "").trim();
  const b = model.branches[name];
  if (!b) return;
  model.headBranch = name;
  model.head = b.tip;
  drawRefs();
}

// merge a branch into the one HEAD is on: a new commit on the current lane with
// two parents (the current tip and the merged branch's tip), so the diverged
// lanes visibly rejoin into a diamond.
async function doMerge(arg?: string): Promise<void> {
  const name = (arg ?? "feature").trim() || "feature";
  const other = model.branches[name];
  const into = model.branches[model.headBranch];
  if (!other || !into) return;
  const intoTip = nodeById(into.tip);
  const otherTip = nodeById(other.tip);
  if (!intoTip || !otherTip) return;
  // land the merge commit one column past whichever parent is furthest right
  const col = Math.max(intoTip.col, otherTip.col) + 1;
  const pos = nodePos(col, into.lane);
  const node: CommitNode = {
    id: model.nodes.length,
    col,
    lane: into.lane,
    x: pos.x,
    y: pos.y,
    r: NODE_R,
    branch: model.headBranch,
    color: into.color,
    shape: into.shape,
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
async function doRemoteAdd(arg?: string): Promise<void> {
  const m = (arg ?? "").match(/^git\s+remote\s+add\s+(\S+)\s+(\S+)/i);
  if (m) {
    remoteName = m[1];
    remoteUrl = m[2];
  }
}

// push: origin/main catches up to main's tip. The first push also kicks off the
// float-up that copies the trunk into the remote mini-graph (see
// renderRemoteGraph). origin/main is one pill that glides to each pushed tip.
let originMain: number | null = null; // node id origin/main points at
let originPill: SVGGElement | null = null;
async function doPush(): Promise<void> {
  const mainTip = nodeById(model.branches.main?.tip ?? null) ?? headNode();
  if (!mainTip) return;
  const firstPush = originMain === null;
  originMain = mainTip.id;
  if (!originPill) {
    originPill = makePill("origin/main", COLORS.remote, 7);
    originPill.classList.add("ref-pill");
    gLabels.appendChild(originPill);
  }
  placePill(
    originPill,
    { x: mainTip.x, y: mainTip.y + mainTip.r + 66 },
    firstPush,
  );
}

// when the whole sequence is finished, the board shouldn't read as blank: a
// hand-written closing line sits under HEAD so it's clearly the end, not a gap.
function showEndState(): void {
  const h = headNode();
  if (!h) return;
  caption(
    "that's the whole first loop — nothing left to do ✦",
    h.x,
    h.y + h.r + 100,
    420,
    true,
  );
}

// ---- step machine ---------------------------------------------------
type Tone = "cmd" | "flag" | "val";
interface Part {
  t: string;
  tone: Tone;
  why: string;
  span?: number;
}
interface Teach {
  goal: string;
  why: string;
  parts: Part[];
  note?: string;
}

// a command is a sequence of atoms. Fixed atoms are typed verbatim; free atoms
// are user values with a soft suggestion (a nickname, a username, a message).
// `sep` is what precedes the atom: " " by default, "" keeps it joined to the
// previous atom, so a url can be several atoms inside one word.
interface Atom {
  text: string | (() => string);
  tone: Tone;
  sep?: string;
  free?: boolean; // user value; soft-suggests `text` while it still matches
  rest?: boolean; // consumes the remainder (a quoted message)
}
const atomText = (a: Atom): string =>
  typeof a.text === "function" ? a.text() : a.text;
const atomSep = (atoms: Atom[], i: number): string =>
  atoms[i].sep ?? (i === 0 ? "" : " ");
const A = (
  text: string | (() => string),
  tone: Tone,
  opts: Partial<Atom> = {},
): Atom => ({ text, tone, ...opts });

// a quoted message is three atoms: opening quote, the free text, closing quote,
// so typing the quote doesn't look like a wrong word and the text can have spaces
const msgAtoms = (suggest: string): Atom[] => [
  A('"', "val"),
  A(suggest, "val", { sep: "", free: true }),
  A('"', "val", { sep: "" }),
];

// the curiosity companion's data: per step, the questions a beginner actually
// asks, split by tense. `pre` shows before the command runs (forward-looking,
// "what's about to happen"); `post` shows after it runs ("what just happened"),
// when the thing being described actually exists on the board. `points` names a
// board target the answer's arrow should reach (resolved by companionTarget).
interface Curio {
  q: string; // the question, in the user's inner voice (may use <b>)
  a: string; // the answer, mentor voice (may use <b>)
  points?: string; // optional board-target key, e.g. "dotgit"
}
interface CuriositySet {
  cmd?: string; // command label shown above the questions (defaults to the typed command)
  pre?: Curio[];
  post?: Curio[];
}
interface Step {
  key: string;
  atoms: Atom[];
  test: (s: string) => boolean;
  hint: string;
  teach: Teach;
  run: (arg?: string) => Promise<void>;
  extract?: (s: string) => string;
  curiosity?: CuriositySet;
  // when set, arriving at this step starts with the file tree collapsed to just
  // my-site/ (for tasks where we deliberately tidy the tree before moving on).
  // Off by default: the tree otherwise keeps whatever the user left open.
  collapseTree?: boolean;
}

// what a fully-typed command looks like (for replay + width sizing)
function canonical(step: Step): string {
  return step.atoms
    .map((a, i) => atomSep(step.atoms, i) + atomText(a))
    .join("");
}
const isUrl = (s: string): boolean =>
  /^https?:\/\/[^\s/]+\.[^\s/]+\/\S+$/i.test(s) || /^git@[^\s:]+:\S+$/i.test(s);

let stepIndex = 0;
const steps: Step[] = [
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
          a: "Git keeps a history of your project. <br>Every version you commit is saved, so you can look back, undo a mistake, and try things without fear of losing your work.<br><br>You can think of it as quicksaves in a game where you can choose which one to go back to.",
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
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("add", "cmd"),
      A(".", "val", { free: true }),
    ],
    test: (s) => /^git\s+add\s+(\.|-a|-A|--all)$/i.test(s),
    hint: "Stage everything with  git add .  (or  git add -A )",
    teach: {
      goal: "Pick what to save",
      why: "Choose which files go in the next snapshot.",
      parts: [
        { t: "add", tone: "cmd", why: "stage your changes" },
        {
          t: ".  /  -A",
          tone: "val",
          why: "the . means everything (so does -A)",
        },
      ],
    },
    run: doAdd,
  },
  {
    key: "commit",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("commit", "cmd"),
      A("-m", "flag"),
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
        {
          t: '"message"',
          tone: "val",
          why: "a short note describing what this snapshot changed",
        },
      ],
    },
    run: doCommit,
  },
  {
    key: "remote",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("remote", "cmd"),
      A("add", "cmd"),
      A("origin", "val", { free: true }),
      A("https://", "flag"),
      A("github.com/", "flag", { sep: "" }),
      A("user", "flag", { sep: "", free: true }),
      A("/my-site.git", "flag", { sep: "" }),
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
        {
          t: "remote add",
          tone: "cmd",
          span: 2,
          why: "save a link to a copy of your repo kept elsewhere",
        },
        {
          t: "origin",
          tone: "val",
          why: "the nickname we give the url, so you can type it instead of the full address next time",
        },
        {
          t: "the url",
          tone: "flag",
          why: "the address where the remote copy lives, usually in the cloud",
        },
      ],
    },
    run: doRemoteAdd,
  },
  {
    key: "push",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("push", "cmd"),
      A("-u", "flag"),
      A(() => remoteName, "val", { free: true }),
      A("main", "val"),
    ],
    test: (s) => /^git\s+push\s+-u\s+\S+\s+main$/i.test(s),
    hint: "Send your commit up:  git push -u origin main",
    teach: {
      goal: "Send it to the remote",
      why: "Upload your commit so the remote has it too. This is the first time your work leaves your computer. The remote now holds a copy of your tree.",
      parts: [
        { t: "push", tone: "cmd", why: "upload your commits to the remote" },
        {
          t: "-u",
          tone: "flag",
          why: "upstream: tie this branch to the remote so next time you can just type git push",
        },
        {
          t: "origin",
          tone: "val",
          why: "which remote to send to (the nickname you chose)",
        },
        {
          t: "main",
          tone: "val",
          why: "which branch to send (main is your default branch)",
        },
      ],
    },
    run: doPush,
  },
  {
    key: "branch",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("branch", "cmd"),
      A("feature", "val", { free: true }),
    ],
    test: (s) => /^git\s+branch\s+\S+$/i.test(s),
    extract: (s) => s.split(/\s+/)[2] ?? "feature",
    hint: "Name a branch:  git branch feature",
    teach: {
      goal: "Start a branch",
      why: "A branch is a separate line of work, so you can try things without touching main.",
      parts: [
        {
          t: "branch",
          tone: "cmd",
          why: "make a new branch at the current commit",
        },
        {
          t: "feature",
          tone: "val",
          why: "its name, yours to choose (here: feature)",
        },
      ],
    },
    run: doBranch,
  },
  {
    key: "checkout",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("switch", "cmd"),
      A("feature", "val", { free: true }),
    ],
    test: (s) => /^git\s+switch\s+\S+$/i.test(s),
    extract: (s) => s.split(/\s+/)[2] ?? "feature",
    hint: "Switch to it:  git switch feature",
    teach: {
      goal: "Switch to the branch",
      why: "Move onto the branch. A branch only becomes its own line of history once you make a commit on it.",
      parts: [
        { t: "switch", tone: "cmd", why: "move HEAD onto another branch" },
        { t: "feature", tone: "val", why: "the branch to switch to" },
      ],
    },
    curiosity: {
      cmd: "git switch feature",
      // the question a beginner has the instant they meet switch: they've seen
      // checkout everywhere. Answer it here instead of cluttering the lesson.
      post: [
        {
          q: "wait, what about <b>git checkout</b>? i've seen that everywhere",
          a: "you'll see <b>git checkout</b> a lot, it's older and still works. git split its jobs into two clearer commands: <b>git switch</b> for changing branches (what you just did) and <b>git restore</b> for files. for switching, they do the same thing.",
        },
      ],
    },
    run: doCheckout,
  },
  {
    key: "add2",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("add", "cmd"),
      A(".", "val", { free: true }),
    ],
    test: (s) => /^git\s+add\s+(\.|-a|-A|--all)$/i.test(s),
    hint: "Stage your changes with  git add .",
    teach: {
      goal: "Stage your changes",
      why: "Staging picks what goes into the next commit. You're on the feature branch now. Go ahead and try it.",
      parts: [
        { t: "add", tone: "cmd", why: "stage your changes for the next commit" },
        {
          t: ".  /  -A",
          tone: "val",
          why: "the . means everything you changed",
        },
      ],
    },
    run: doAdd,
  },
  {
    key: "commit2",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("commit", "cmd"),
      A("-m", "flag"),
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
        {
          t: '"message"',
          tone: "val",
          why: "describe the change (here: add feature)",
        },
      ],
    },
    run: doCommit,
  },
  {
    key: "checkout-main",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("switch", "cmd"),
      A("main", "val", { free: true }),
    ],
    test: (s) => /^git\s+switch\s+main$/i.test(s),
    extract: (s) => s.split(/\s+/)[2] ?? "main",
    hint: "Go back to main first:  git switch main",
    teach: {
      goal: "Switch back to main",
      why: "You merge into the branch you're standing on, so move onto main before bringing the feature in.",
      parts: [
        { t: "switch", tone: "cmd", why: "move HEAD back onto main" },
        {
          t: "main",
          tone: "val",
          why: "the branch you want the feature merged into",
        },
      ],
    },
    run: doCheckout,
  },
  {
    key: "merge",
    atoms: [
      A("git", "cmd", { sep: "" }),
      A("merge", "cmd"),
      A("feature", "val", { free: true }),
    ],
    test: (s) => /^git\s+merge\s+\S+$/i.test(s),
    extract: (s) => s.split(/\s+/)[2] ?? "feature",
    hint: "Bring the branch in:  git merge feature",
    teach: {
      goal: "Merge the branch back",
      why: "Combine the feature branch's commit into main, so main has all the work. The two lanes rejoin.",
      parts: [
        {
          t: "merge",
          tone: "cmd",
          why: "join another branch's commits into this one",
        },
        {
          t: "feature",
          tone: "val",
          why: "the branch whose work you're bringing in",
        },
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
        {
          t: "push",
          tone: "cmd",
          why: "upload the new commits to the remote you already linked",
        },
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

function currentAtoms(): Atom[] | null {
  return stepIndex < steps.length ? steps[stepIndex].atoms : null;
}

// the lesson now reveals one part at a time: the part the text cursor is
// currently sitting in. `activeParts` is the current step's list; `activePart`
// is which one is on screen, so we only re-render (and re-animate) on a change.
let activeParts: Part[] = [];
let activePart = -2;
// true during a step's lesson cross-fade. While set, the caption is swapped
// instantly (under the fade) instead of scroll-animating, so a step change
// never looks like the caption rewinding through its parts.
let lessonSwapping = false;

function renderTeach(teach: Teach): void {
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
function caretWordIndex(typed: string, caret: number): number {
  const before = typed.slice(0, caret);
  const words = before.match(/\S+/g);
  if (!words) return 0;
  if (caret > 0 && /\s/.test(typed[caret - 1])) return words.length;
  return words.length - 1;
}

// map the caret's word onto a part. Word 0 (git itself) shows the first part;
// each part then claims `span` words (default 1); trailing words (a long commit
// message) stay on the last part.
function activePartIndex(): number {
  if (activeParts.length === 0) return -1;
  const word = caretWordIndex(
    cmd.value,
    cmd.selectionStart ?? cmd.value.length,
  );
  if (word <= 1) return 0;
  let w = 1;
  for (let pi = 0; pi < activeParts.length; pi++) {
    const span = activeParts[pi].span ?? 1;
    if (word >= w && word < w + span) return pi;
    w += span;
  }
  return activeParts.length - 1;
}

function buildPartRow(p: Part): HTMLElement {
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

function renderActivePart(force = false, instant = false): void {
  // mid step cross-fade: leave the caption alone (the step swap renders it once,
  // instantly). Without this, the immediate updateInk() after a step advance
  // would scroll the old step's caption back to its first part.
  if (lessonSwapping && !force) return;
  const idx = activePartIndex();
  const prev = activePart;
  if (!force && idx === prev) return;
  activePart = idx;

  // instant swap (step change) or reduced motion: no scroll
  if (
    instant ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    partsEl.replaceChildren();
    if (idx >= 0) partsEl.appendChild(buildPartRow(activeParts[idx]));
    return;
  }

  // vertical push: the strip scrolls so the new caption replaces the old one.
  // Advancing through the command (or a step change) scrolls up: the old line
  // exits the top while the new one rises in from below. Moving the caret back
  // scrolls down. The old row goes absolute so the incoming row owns the height,
  // then removes itself once it has scrolled out.
  const back = !force && prev >= 0 && idx < prev;
  for (const el of Array.from(
    partsEl.querySelectorAll<HTMLElement>(".part:not(.part--out)"),
  )) {
    el.classList.remove("part--in-up", "part--in-down");
    el.classList.add("part--out", back ? "part--out-down" : "part--out-up");
    window.setTimeout(() => el.remove(), 380);
  }
  if (idx < 0) return;
  const row = buildPartRow(activeParts[idx]);
  row.classList.add(back ? "part--in-down" : "part--in-up");
  partsEl.appendChild(row);
}

function showStep(i: number): void {
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
  } else {
    renderTeach(teach);
    positionStage(false);
  }
  updateInk();
  updateRemoteNote();
}

// the remote callout rides in with the remote panel on the push stage (right
// after git remote add slides the panel in), then leaves as you move on, so the
// panel that appeared far across the board reads as connected to your command
function updateRemoteNote(): void {
  remoteNoteEl.classList.toggle("is-shown", stepIndex === stepIdx("push"));
}

// ---- command line: live highlight + ghost suggestion ----------------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
let suggestActive = false;

// the suggestion for atoms[start..], fully unfilled, with their separators
function suggestFrom(
  atoms: Atom[],
  start: number,
  includeFirstSep: boolean,
): string {
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
function analyze(
  typed: string,
  atoms: Atom[],
): { html: string; ghost: string; chunk: string; invalid: boolean } {
  let pos = 0,
    html = "",
    ghost = "",
    chunk = "",
    invalid = false,
    chunkSet = false;
  const setChunk = (s: string) => {
    if (!chunkSet) {
      chunk = s;
      chunkSet = true;
    }
  };
  const span = (tone: Tone, s: string) =>
    `<span class="hl-${tone}">${esc(s)}</span>`;

  for (let a = 0; a < atoms.length; a++) {
    const sep = atomSep(atoms, a);
    if (sep) {
      if (typed.startsWith(sep, pos)) {
        html += esc(sep);
        pos += sep.length;
      } else if (pos >= typed.length) {
        ghost = suggestFrom(atoms, a, true);
        setChunk(sep + atomText(atoms[a]));
        return { html, ghost, chunk, invalid };
      } else {
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
      } else html += span(atoms[a].tone, rem);
      return { html, ghost, chunk, invalid };
    }
    if (rem.length === 0) {
      ghost = suggestFrom(atoms, a, false);
      setChunk(text);
      return { html, ghost, chunk, invalid };
    }
    if (atoms[a].free) {
      const next = atoms[a + 1];
      const stop = next
        ? atomSep(atoms, a + 1) || atomText(next)[0] || " "
        : " ";
      const stopIdx = rem.indexOf(stop);
      if (stopIdx === -1) {
        html += span(atoms[a].tone, rem);
        pos = typed.length;
        if (
          rem.length < text.length &&
          text.toLowerCase().startsWith(rem.toLowerCase())
        ) {
          // still completing this slot's suggestion
          ghost = text.slice(rem.length) + suggestFrom(atoms, a + 1, true);
          setChunk(text.slice(rem.length));
        } else {
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
    while (
      cp < word.length &&
      cp < text.length &&
      word[cp].toLowerCase() === text[cp].toLowerCase()
    )
      cp++;
    html += `<span class="hl-invalid">${cp ? span(atoms[a].tone, word.slice(0, cp)) : ""}<span class="hl-err">${esc(word.slice(cp))}</span></span>`;
    pos += word.length;
    invalid = true;
    continue;
  }
  return { html, ghost, chunk, invalid };
}

function updateInk(): void {
  if (cliMorphing) return; // a field morph owns the underline + width right now
  const typed = cmd.value;
  const atoms = currentAtoms();
  const a = atoms
    ? analyze(typed, atoms)
    : { html: esc(typed), ghost: "", chunk: "", invalid: false };
  const ghost = a.ghost;
  suggestActive = ghost.length > 0;

  let html = a.html;
  if (suggestActive) html += `<span class="hl-ghost">${esc(ghost)}</span>`;
  ink.innerHTML = html;

  // size the field to the whole line so it stays centred and never gets cut
  const full = typed.length + ghost.length;
  cmd.style.width = `${Math.max(full, 6) + 1}ch`;
  syncCliRule();
  ink.style.transform = `translateX(${-cmd.scrollLeft}px)`;

  // state 3 -> 4: a transition cleared the field, now fade the new command in
  if (cliAwaitingTextIn) {
    cliAwaitingTextIn = false;
    ink.style.transition = "none";
    ink.style.opacity = "0";
    void ink.offsetWidth;
    requestAnimationFrame(() => {
      ink.style.transition = "opacity .22s ease";
      ink.style.opacity = "1";
    });
  }

  tabhint.classList.toggle("show", suggestActive && typed.trim().length > 0);
  renderActivePart();

  // live tip: flag a non-origin remote nickname the moment it diverges
  if (atoms && steps[stepIndex]?.key === "remote") {
    const name = typed.trim().split(/\s+/)[3];
    if (name && !"origin".startsWith(name.toLowerCase())) {
      showInfo("origin is the standard name. most tools expect it.");
    } else {
      clearNudge();
    }
  }
}

// redraw the underline as a fresh hand-drawn line at the field's real width,
// so it never gets stretched out of shape when the command is long
// ---- the command-line underline: one fixed-point hand-drawn rule ----------
// A FIXED number of points with constant vertical wobble, so the same line can
// be drawn at any width and morphed between widths by just spreading the points
// horizontally. No horizontal stretch (the old linePath rescaled its wobble and
// looked squashed), and no points popping in/out as the width changes.
const CLI_RULE_N = 18;
const CLI_RULE_AMP = 3.4;
const cliRuleOffsets: number[] = (() => {
  // a tiny deterministic PRNG so the wobble is identical every load
  let s = 0x9e3779b9 | 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const offs: number[] = [];
  for (let i = 0; i <= CLI_RULE_N; i++) {
    const t = i / CLI_RULE_N;
    const env = Math.sin(t * Math.PI); // no wander at the two ends
    offs.push((rand() * 2 - 1) * CLI_RULE_AMP * env + env * CLI_RULE_AMP * 0.4);
  }
  return offs;
})();
function cliRulePath(w: number): string {
  const x1 = 3,
    x2 = Math.max(x1 + 1, w - 3),
    y = 7;
  const pts: [number, number][] = [];
  for (let i = 0; i <= CLI_RULE_N; i++) {
    const t = i / CLI_RULE_N;
    pts.push([x1 + (x2 - x1) * t, y + cliRuleOffsets[i]]);
  }
  return S.smooth(pts, false);
}
function drawCliRuleAt(w: number): void {
  cliRule.setAttribute("viewBox", `0 0 ${w} 12`);
  cliRule.replaceChildren(
    S.el("path", {
      d: cliRulePath(w),
      class: "edge-stroke",
      stroke: COLORS.ink,
      "stroke-width": 2,
    }),
  );
}
function syncCliRule(): void {
  const field = cmd.parentElement;
  if (!field) return;
  drawCliRuleAt(Math.max(40, Math.round(field.clientWidth)));
}

// ---- the 4-state field transition on Enter --------------------------------
// 1 before-filled -> animate just the text away -> 2 before-empty -> morph the
// underline into the next command's width -> 3 after-empty -> the new text fades
// in later (via updateInk) -> 4 after-filled. Morphing the underline while the
// field is empty avoids the squashed/stretched look of rescaling a drawn line.
let cliMorphing = false; // the underline is mid-morph: updateInk must not fight it
let cliAwaitingTextIn = false; // text was animated out; next updateInk fades it in

// the px width the field will have once it holds a command of `chars` characters
function fieldWidthForChars(chars: number): number {
  const prev = cmd.style.width;
  cmd.style.width = `${Math.max(chars, 6) + 1}ch`;
  const w = cmd.parentElement?.clientWidth ?? cmd.clientWidth;
  cmd.style.width = prev; // revert before any paint happens
  return Math.max(40, Math.round(w));
}
function morphField(fromW: number, toW: number, dur: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3); // ease-out
      const w = fromW + (toW - fromW) * e;
      cmd.style.width = `${w}px`;
      drawCliRuleAt(Math.round(w));
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}
async function advanceCli(nextChars: number): Promise<void> {
  if (S.prefersReduced || instant) {
    ink.innerHTML = "";
    cmd.style.width = `${Math.max(nextChars, 6) + 1}ch`;
    syncCliRule();
    return;
  }
  const startW = Math.max(40, Math.round(cmd.parentElement?.clientWidth ?? 0));
  const endW = fieldWidthForChars(nextChars);
  cliMorphing = true;
  cliAwaitingTextIn = true;
  tabhint.classList.remove("show");
  // 1 -> 2: animate just the text away, quickly (the underline stays put)
  ink.style.transition = "opacity .14s ease, transform .16s ease";
  ink.style.opacity = "0";
  ink.style.transform = "translateY(-5px)";
  await sleep(150);
  ink.innerHTML = "";
  ink.style.transform = "none";
  // 2 -> 3: morph the underline (and the field) into the next command's width
  await morphField(startW, endW, 320);
  cliMorphing = false;
  // 3 -> 4: handled the next time updateInk runs (showStep, a beat later), which
  // sets the new command and fades the ink back in (see cliAwaitingTextIn there)
}

// Tab completes only the next atom (one word, or one url segment)
function acceptNextWord(): void {
  const atoms = currentAtoms();
  if (!atoms) return;
  const { chunk } = analyze(cmd.value, atoms);
  if (!chunk) return;
  const newVal = cmd.value + chunk;
  cmd.value = newVal;
  cmd.setSelectionRange(newVal.length, newVal.length);
  updateInk();
}
function caretAtEnd(): boolean {
  return (
    cmd.selectionStart === cmd.value.length &&
    cmd.selectionEnd === cmd.value.length
  );
}

// ---- command line behaviour ----------------------------------------
function showNudge(text: string): void {
  nudgeEl.textContent = text;
  nudgeEl.classList.remove("info");
  nudgeEl.classList.add("show");
}
function showInfo(text: string): void {
  nudgeEl.textContent = text;
  nudgeEl.classList.add("show", "info");
}
function clearNudge(): void {
  nudgeEl.classList.remove("show", "info");
}
function shake(): void {
  form.classList.remove("shake");
  void form.offsetWidth;
  form.classList.add("shake");
}
// true only while the stage is gliding off the landing into its docked spot, so
// the lesson-height re-measure at the end of the swap glides too, instead of
// snapping mid-glide and making the command line jump.
let docking = false;
function dockStage(): void {
  stage.classList.remove("is-centered");
  stage.classList.add("is-docked");
  docking = true;
  positionStage(true);
}
// Bottom-align the docked stage: pin its lower edge a fixed gap above the
// timeline so the lesson + command line sit at the bottom of the screen and
// never ride up into the graph, whatever the lesson's height. Recomputed
// whenever the lesson swaps (its height changes) or the window resizes.
function positionStage(animate: boolean): void {
  if (!stage.classList.contains("is-docked")) return;
  const gap = Math.max(104, Math.round(window.innerHeight * 0.11)); // clears the timeline
  const y = Math.round(window.innerHeight - gap - stage.offsetHeight / 2);
  if (animate) {
    stage.style.setProperty("--stage-y", `${y}px`);
  } else {
    // move without gliding when it's just the lesson height changing
    stage.style.transition = "none";
    stage.style.setProperty("--stage-y", `${y}px`);
    void stage.offsetWidth;
    stage.style.transition = "";
  }
}
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

// ---- the "you can't stage nothing" demonstration (feature-branch flow) -----
// After checkout, index.html has NOT changed yet. The first time the user tries
// to stage, we reject it ("nothing to stage"), let them dismiss it with anything
// (key or click), then say we'll demonstrate, play the index.html edit, and
// re-prompt the stage so the second attempt goes through.
let editDemoPending = false; // at add2, before the demonstration edit has run
let awaitingDismiss = false; // the "nothing to stage" note is up, awaiting any input
let dismissDemoHandler: ((e: Event) => void) | null = null;

function clearDismissDemo(): void {
  if (!dismissDemoHandler) return;
  document.removeEventListener("keydown", dismissDemoHandler, true);
  document.removeEventListener("click", dismissDemoHandler, true);
  dismissDemoHandler = null;
}
// reject a premature stage, then arm: the next key OR click runs the demo edit
function rejectStaging(): void {
  awaitingDismiss = true;
  cmd.value = "";
  ink.innerHTML = "";
  tabhint.classList.remove("show");
  showInfo("Nothing has changed yet, so there's nothing to stage. (press anything)");
  if (dismissDemoHandler) return;
  dismissDemoHandler = (e: Event) => {
    if (e instanceof KeyboardEvent) e.preventDefault(); // swallow Enter/Esc so it doesn't also act
    clearDismissDemo();
    awaitingDismiss = false;
    void runEditDemo();
  };
  document.addEventListener("keydown", dismissDemoHandler, true);
  document.addEventListener("click", dismissDemoHandler, true);
}
// "for the demo I'll do it for you": play the index.html edit, then re-prompt
async function runEditDemo(): Promise<void> {
  clearNudge();
  showInfo("No worries. For the demo, I'll make a small change to index.html for you.");
  await sleep(1100); // a beat to read
  busy = true;
  try {
    await playEditSequence();
    editDemoPending = false; // index.html is genuinely changed now
    await refreshRepo();
    renderRemoteTree();
    updateLayout();
  } finally {
    busy = false;
  }
  showInfo("Now stage it for real:  git add .");
  updateInk(); // bring the git add ghost back
  if (!isPhone) cmd.focus();
}

let busy = false;
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  if (awaitingDismiss) return; // the dismiss handler drives what happens next
  const input = normalize(cmd.value);
  if (!input) return;

  if (stepIndex >= steps.length) {
    showNudge(END.tease);
    return;
  }
  const step = steps[stepIndex];
  if (!step.test(input)) {
    showNudge(
      /^git\b/i.test(input) ? step.hint : "Every git command starts with  git",
    );
    shake();
    return;
  }

  // add2, before the demonstration: you can't stage when nothing has changed.
  // Reject it; dismissing (anything) triggers the demo edit, then re-prompts.
  if (step.key === "add2" && editDemoPending) {
    rejectStaging();
    return;
  }

  clearNudge();
  closeFileViewer(); // a new command changes the board: dismiss any open file
  const arg = step.extract ? step.extract(input) : undefined;
  if (arg !== undefined) persisted.values[step.key] = arg; // remember YOUR value for this step
  cmd.value = "";
  stepIndex++;
  persisted.step = stepIndex;
  savePersisted(); // a normal reload resumes right here, with your words
  // arriving at add2 (checkout just finished): the file hasn't changed yet, so it
  // stays put until the demonstration edit runs after the first git add attempt
  if (stepIndex === stepIdx("add2")) editDemoPending = true;
  // the 4-state field transition: animate the typed command away, morph the
  // underline into the next command's width while empty, then the new command's
  // ghost fades in a beat later (when showStep -> updateInk runs)
  const nextChars =
    stepIndex < steps.length ? canonical(steps[stepIndex]).length : 6;
  void advanceCli(nextChars);
  // the companion steps back while the action happens; it returns at the end of
  // the paced sequence to explain what just appeared
  setCompanion(null, "post");
  // Pace the reveal so the pieces of a step arrive one after another instead of
  // all on the same beat. A brand-new concept breathes; a familiar repeat moves
  // quicker. `busy` is held across the WHOLE sequence — drawing, the real-git
  // replay, AND the beats — so a second Enter or a timeline click can't run a
  // concurrent replay on the shared in-memory fs. finally guarantees the lock is
  // released even if a step throws (otherwise the UI would freeze).
  const w = stepWeight(step.key);
  busy = true;
  try {
    // 1) the board draws the action: the ink is the star, you watch it happen.
    //    The current lesson stays put through the draw rather than jumping ahead.
    await step.run(arg);
    centerOnHead();
    if (stepIndex >= steps.length) showEndState();
    if (step.key === "commit") lastCommitMsg = arg ?? lastCommitMsg; // replay with the real message
    // 2) a beat, then the file tree catches up to the new repo state
    await beat(0.6, w);
    await refreshRepo(); // real git -> tree + states
    renderRemoteTree();
    renderRemoteGraph();
    updateLayout();
    // 3) a beat, then the next lesson + timeline settle in, no longer competing
    //    with the drawing
    await beat(0.9, w);
    showStep(stepIndex);
    updateTimeline();
    // 4) a final beat, then the companion offers "what just happened"
    await beat(0.7, w);
    syncCompanion();
  } finally {
    busy = false;
  }
});

cmd.addEventListener("input", () => {
  clearNudge();
  updateInk();
});
cmd.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && suggestActive) {
    e.preventDefault();
    acceptNextWord();
  } else if (e.key === "ArrowRight" && suggestActive && caretAtEnd()) {
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
const isPhone =
  window.matchMedia("(max-width: 760px)").matches || "ontouchstart" in window;
// ...but never fight the user while they're selecting text. A learner should be
// able to drag across a label (to copy it, or paste it into a chatbot) without
// the input yanking focus back and collapsing the selection. So while the mouse
// is down (a drag in progress) or any text is selected, we leave focus alone.
let pointerDown = false;
document.addEventListener("mousedown", () => {
  pointerDown = true;
});
document.addEventListener("mouseup", () => {
  pointerDown = false;
});
// in learn mode, a click anywhere outside the companion means "I'm done looking,
// take me back to continuing" — let the focused question go
document.addEventListener("click", (e) => {
  if (!openBtn) return;
  if (!companionEl.contains(e.target as Node)) closeCurio(openBtn);
});
function hasSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}
function keepFocus(): void {
  if (isPhone) return;
  if (pointerDown || hasSelection()) return; // mid-drag or text selected: leave it be
  if (!document.hidden) cmd.focus();
}
cmd.addEventListener("blur", () => requestAnimationFrame(keepFocus));
document.addEventListener("click", keepFocus);

// ---- file tree (left) ----------------------------------------------
const PROJECT = {
  root: "my-site",
  files: ["index.html", "style.css", "app.js"],
};
const EDIT_FILE = PROJECT.files[0]; // the file we "edit" on the feature branch
type FileState =
  | "plain"
  | "untracked"
  | "modified"
  | "staged"
  | "committed"
  | "pushed";
// one check = saved in a local commit; two checks = delivered to the remote
const MARK: Record<FileState, string> = {
  plain: "",
  untracked: "·",
  modified: "M",
  staged: "+",
  committed: "✓",
  pushed: "✓✓",
};

// step index of a step by key (so inserting steps doesn't break thresholds)
function stepIdx(key: string): number {
  return steps.findIndex((s) => s.key === key);
}
// has this committed file actually reached the remote? The first push sends
// every file; index.html is re-committed on the branch (commit2), so it falls
// behind the remote again until that work is pushed with the merge (push2).
// (The remote is still simulated; this overlays "pushed" on top of real state.)
function isPushed(file: string): boolean {
  if (stepIndex <= stepIdx("push")) return false; // first push not done
  if (
    file === EDIT_FILE &&
    stepIndex > stepIdx("commit2") &&
    stepIndex <= stepIdx("push2")
  )
    return false; // edited again, awaiting push2
  return true;
}

let lastGitPresent = false;
let wasEditing = false;
let pushedBefore = new Set<string>(); // files already on the remote last render
// the file's state: the BASE (untracked/modified/staged/committed) comes from
// real git via the snapshot; the still-simulated branch edit + remote add the
// "modified on the branch" / "pushed" overlays on top, until those are real too.
function overlaidState(file: string, base: FileState): FileState {
  // index.html only reads as "modified" once the demonstration edit has run; until
  // then (right after checkout) it's unchanged, so it keeps its real pushed state.
  if (file === EDIT_FILE && stepIndex === stepIdx("add2") && !editDemoPending)
    return "modified";
  if (file === EDIT_FILE && stepIndex === stepIdx("commit2")) return "staged";
  if (base === "committed" && isPushed(file)) return "pushed";
  return base;
}

// ---- the shared tree renderer ---------------------------------------
// The local working tree and the remote panel are BOTH drawn by renderTree from
// a RepoModel. The whole visual treatment (recursive folders, hover notes, the
// write-on reveal, the note-card editor) lives in the shared .tree__list CSS, so
// giving the remote the same look + behaviour is just a matter of feeding it a
// model — no second renderer.
interface FileRow {
  name: string;
  file: string; // PROJECT.files key (drives the editor + state)
  state: FileState;
  note?: string; // committed-not-pushed / pushed / just-edited
  flash?: "edited" | "pushed"; // a one-time entrance highlight
}
interface RepoModel {
  root: string; // the working folder, e.g. "my-site"
  url?: string; // remote only: the URL header line
  git: RepoGitNode[] | null; // .git contents (null => no .git folder at all)
  gitNote: string; // the .git/ row's hover note
  gitNew?: boolean; // .git/ just appeared (write-on flash)
  files: FileRow[];
  emptyMsg?: string; // shown when files is empty (e.g. "nothing pushed yet")
}

function noteSpan(text: string): HTMLElement {
  const n = document.createElement("span");
  n.className = "f__note";
  n.textContent = text;
  return n;
}

// a folder row + its (collapsed/animatable) contents wrapper
function buildFolder(
  name: string,
  path: string,
  open: boolean,
  cls: string,
  opts: { note?: string; isNew?: boolean; rootWrap?: boolean } = {},
): { row: HTMLElement; sub: HTMLElement; wrap: HTMLElement } {
  const row = document.createElement("li");
  row.className =
    `${cls} is-expandable is-folder` +
    (open ? " is-open" : "") +
    (opts.isNew ? " is-new" : "");
  row.dataset.path = path;
  row.append(open ? folderIconOpen() : folderIcon(), makeNameUnderlined(name));
  if (opts.note) row.appendChild(noteSpan(opts.note));
  const wrap = document.createElement("li");
  wrap.className =
    "tree__subwrap" +
    (opts.rootWrap ? " tree__subwrap--root" : "") +
    (open ? " is-open" : "");
  const sub = document.createElement("ul");
  sub.className = "tree__sub";
  wrap.appendChild(sub);
  return { row, sub, wrap };
}

// a project/remote file row: state colour + mark + hover note, opens in the editor
function buildFileRow(fr: FileRow): HTMLElement {
  const li = document.createElement("li");
  li.className =
    fr.state === "plain" ? "f is-openable" : `f f--${fr.state} is-openable`;
  li.dataset.file = fr.file;
  if (fr.flash === "edited") li.classList.add("is-edited");
  if (fr.flash === "pushed") li.classList.add("is-pushed-now");
  li.append(fileIcon(fr.file), makeNameUnderlined(fr.name));
  if (MARK[fr.state]) {
    const m = document.createElement("span");
    m.className = "f__mark";
    m.textContent = MARK[fr.state];
    li.appendChild(m);
  }
  if (fr.note) li.appendChild(noteSpan(fr.note));
  return li;
}

// render a whole repo (local or remote) into its tree container
function renderTree(tree: TreeView, model: RepoModel): void {
  tree.el.replaceChildren();
  underlineSeed = 0;
  if (model.url) {
    const u = document.createElement("li");
    u.className = "remote-url";
    u.textContent = model.url;
    tree.el.appendChild(u);
  }
  // <root>/ is the collapsible project folder; everything lives inside it
  const rootF = buildFolder(
    `${model.root}/`,
    "root",
    tree.open.has("root"),
    "d",
    { rootWrap: true },
  );
  tree.el.append(rootF.row, rootF.wrap);

  if (model.git) {
    const gitF = buildFolder(
      ".git/",
      ".git",
      tree.open.has(".git"),
      "f d--git",
      { note: model.gitNote, isNew: model.gitNew },
    );
    rootF.sub.append(gitF.row, gitF.wrap);
    if (model.git.length)
      model.git.forEach((n, i) => appendGitNode(tree, gitF.sub, n, i));
    else gitF.sub.appendChild(emptyRow());
  }
  for (const fr of model.files) rootF.sub.appendChild(buildFileRow(fr));
  if (!model.files.length && model.emptyMsg) {
    const e = document.createElement("li");
    e.className = "remote-empty";
    e.textContent = model.emptyMsg;
    rootF.sub.appendChild(e);
  }
}

// render one real .git node into a tree. Folders nest recursively (a subwrap
// that opens); files are openable rows that show their contents in the editor.
function appendGitNode(
  tree: TreeView,
  ul: HTMLElement,
  node: RepoGitNode,
  idx: number,
): void {
  const open = tree.open.has(node.path);
  const row = document.createElement("li");
  row.className = "tree__subitem";
  row.dataset.path = node.path;
  row.style.setProperty("--i", String(idx));
  if (node.isDir) {
    row.classList.add("is-expandable", "is-folder");
    if (open) row.classList.add("is-open");
    row.append(
      open ? folderIconOpen() : folderIcon(),
      makeNameUnderlined(node.name),
      noteSpan(node.note),
    );
    ul.appendChild(row);
    const wrap = document.createElement("li");
    wrap.className = "tree__subwrap" + (open ? " is-open" : "");
    const sub = document.createElement("ul");
    sub.className = "tree__sub";
    const kids = node.children ?? [];
    if (kids.length) kids.forEach((c, i) => appendGitNode(tree, sub, c, i));
    else sub.appendChild(emptyRow()); // an opened-but-empty folder still says so
    wrap.appendChild(sub);
    ul.appendChild(wrap);
  } else {
    row.classList.add("is-openable", "is-gitfile");
    row.append(
      fileIcon(node.name),
      makeNameUnderlined(node.name),
      noteSpan(node.note),
    );
    ul.appendChild(row);
  }
}

// ---- the local working tree's model + render ------------------------
function localModel(): RepoModel {
  const remoteExists = stepIndex > stepIdx("remote");
  const states = new Map(
    (snap?.files ?? []).map((f) => [f.name, f.state] as const),
  );
  const files: FileRow[] = PROJECT.files.map((f) => {
    const st = overlaidState(f, states.get(f) ?? "plain");
    let note = "";
    if (f === EDIT_FILE && st === "modified") note = "just edited";
    else if (st === "pushed") note = "pushed";
    else if (st === "committed" && remoteExists) note = "committed, not pushed";
    const flash: FileRow["flash"] =
      f === EDIT_FILE && st === "modified" && !wasEditing
        ? "edited"
        : st === "pushed" && !pushedBefore.has(f)
          ? "pushed"
          : undefined;
    return { name: f, file: f, state: st, note, flash };
  });
  return {
    root: PROJECT.root,
    git: snap?.inited ? snap.git : null,
    gitNote: "git lives here",
    gitNew: !!snap?.inited && !lastGitPresent,
    files,
  };
}

function renderFileTree(): void {
  const model = localModel();
  renderTree(localTree, model);
  lastGitPresent = !!snap?.inited;
  wasEditing = stepIndex === stepIdx("add2") && !editDemoPending;
  pushedBefore = new Set(
    model.files.filter((f) => f.state === "pushed").map((f) => f.name),
  );
}

function emptyRow(): HTMLElement {
  const li = document.createElement("li");
  li.className = "tree__subitem tree__empty";
  li.style.setProperty("--i", "0");
  const n = document.createElement("span");
  n.className = "f__note";
  n.textContent = "(empty for now)";
  li.appendChild(n);
  return li;
}
function makeName(text: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "f__name";
  s.textContent = text;
  return s;
}
// a name that grows the sketched hover underline, the shared "this row is
// interactive" cue used on every clickable row (folder or file)
let underlineSeed = 0;
function makeNameUnderlined(text: string): HTMLElement {
  const name = makeName(text);
  name.appendChild(makeUnderline(underlineSeed++ * 9 + 5));
  return name;
}

// ---- hand-drawn icons (same inked language as the board) ------------
// Built from the sketch helpers so the wobble matches everything else. Each is
// a 24x24 viewBox; colour comes from currentColor (set per type in CSS).
function mkIcon(kind: string): SVGSVGElement {
  const svg = S.el("svg", {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
  }) as SVGSVGElement;
  svg.setAttribute("class", `ic ic--${kind}`);
  return svg;
}
function icStroke(svg: SVGSVGElement, d: string): void {
  svg.appendChild(S.el("path", { d, class: "ic-stroke" }));
}
// a sheet of paper with a folded corner and a couple of text lines
function fileIcon(file: string): SVGSVGElement {
  const svg = mkIcon(langOf(file)); // html / css / js -> colour
  icStroke(
    svg,
    S.smooth(
      [
        [6.4, 3.6],
        [13.6, 3.3],
        [18.6, 8.2],
        [18.3, 20.4],
        [5.8, 20.6],
        [6.1, 3.7],
      ],
      true,
    ),
  );
  icStroke(
    svg,
    S.smooth([
      [13.4, 3.6],
      [13.9, 8.1],
      [18.4, 7.9],
    ]),
  ); // the fold
  icStroke(
    svg,
    S.smooth([
      [8.6, 12.4],
      [15.2, 12.0],
    ]),
  ); // text line
  icStroke(
    svg,
    S.smooth([
      [8.5, 15.4],
      [14.4, 15.1],
    ]),
  ); // text line
  return svg;
}
function folderIcon(): SVGSVGElement {
  const svg = mkIcon("folder");
  icStroke(
    svg,
    S.smooth(
      [
        [3.4, 7.2],
        [8.8, 7.0],
        [10.7, 9.0],
        [20.4, 9.0],
        [20.6, 18.6],
        [3.6, 18.8],
        [3.3, 7.3],
      ],
      true,
    ),
  );
  return svg;
}
// the open-folder variant: the same folder with its lid swung up, so an opened
// folder reads differently from a closed one (no chevron needed)
function folderIconOpen(): SVGSVGElement {
  const svg = mkIcon("folder");
  // back wall of the folder
  icStroke(
    svg,
    S.smooth(
      [
        [3.4, 7.4],
        [8.7, 7.2],
        [10.6, 9.1],
        [20.4, 9.1],
        [20.5, 11.6],
      ],
      false,
    ),
  );
  // the open front: a flap fanned out toward the viewer
  icStroke(
    svg,
    S.smooth(
      [
        [3.5, 18.7],
        [6.4, 12.0],
        [22.6, 11.8],
        [19.8, 18.6],
        [3.5, 18.7],
      ],
      true,
    ),
  );
  return svg;
}
function computerIcon(): SVGSVGElement {
  const svg = mkIcon("computer");
  icStroke(
    svg,
    S.smooth(
      [
        [3.3, 5.4],
        [20.7, 4.8],
        [20.4, 15.2],
        [3.6, 15.5],
        [3.4, 5.5],
      ],
      true,
    ),
  );
  icStroke(
    svg,
    S.smooth([
      [11.9, 15.4],
      [12.1, 18.4],
    ]),
  ); // stand
  icStroke(
    svg,
    S.smooth([
      [8.4, 18.8],
      [15.6, 18.5],
    ]),
  ); // base
  return svg;
}
function cloudIcon(): SVGSVGElement {
  const svg = mkIcon("cloud");
  icStroke(
    svg,
    S.smooth(
      [
        [7.5, 16.4],
        [5.0, 16.2],
        [3.5, 14.0],
        [4.6, 11.6],
        [7.0, 11.2],
        [7.8, 8.2],
        [11.0, 7.2],
        [13.8, 8.4],
        [14.8, 10.8],
        [17.6, 10.6],
        [19.2, 13.0],
        [18.0, 16.0],
        [14.5, 16.4],
        [7.5, 16.4],
      ],
      true,
    ),
  );
  return svg;
}
// a sketched underline that draws on left->right (hover) and erases
// right->left (unhover). The reveal is a CSS clip-path inset, not a dash trick:
// because the line is stretched to the name's width (preserveAspectRatio=none)
// with a non-scaling stroke, dash lengths land in screen pixels and stop
// matching the line — clipping is purely geometric, so it works at any text size.
function makeUnderline(seed: number): SVGSVGElement {
  const svg = S.el("svg", {
    class: "f__underline",
    viewBox: "0 0 100 8",
    preserveAspectRatio: "none",
    "aria-hidden": "true",
  }) as SVGSVGElement;
  svg.appendChild(
    S.el("path", {
      d: S.linePath(3, 5, 97, 5, seed, 1.1),
      class: "f__underline-stroke",
      "stroke-width": 1.8,
    }),
  );
  return svg;
}

// ---- the make-believe file editor ----------------------------------
// When you land on the feature branch the story is "you edited index.html".
// Rather than just flip a flag in the tree, we play it out: an editor window
// opens over the board, a new line types itself into the file, then it saves
// and tucks away. Nothing here is a real editor; it's a visual beat.
const editorEl = need<HTMLElement>("editor");
const editorCode = need<HTMLElement>("editor-code");
const editorName = need<HTMLElement>("editor-name");
const editorUnsaved = need<HTMLElement>("editor-unsaved");
const editorSave = need<HTMLElement>("editor-save");

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
const FILE_TEXT: Record<string, string[]> = {
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
    'const btn = document.querySelector("button");',
    "",
    'btn.addEventListener("click", () => {',
    '  alert("hello from my site");',
    "});",
  ],
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// the contents to show for a file, plus which line indices read as a local
// change (green, like a diff insertion). index.html gains the feature line; on
// the LOCAL side that line is a pending change while modified/staged (before
// commit2). The remote only gains the line at all on the final push, and never
// shows it as a pending change.
function fileLines(
  file: string,
  side: "local" | "remote",
): { lines: string[]; changed: number[] } {
  if (file === EDIT_FILE) {
    const hasEdit =
      side === "local"
        ? stepIndex >= stepIdx("add2") && !editDemoPending
        : stepIndex > stepIdx("push2");
    if (hasEdit) {
      const lines = EDIT_LINES.slice();
      lines.splice(EDIT_AT, 0, EDIT_NEW);
      const pending =
        side === "local" &&
        stepIndex >= stepIdx("add2") &&
        stepIndex <= stepIdx("commit2");
      return { lines, changed: pending ? [EDIT_AT] : [] };
    }
  }
  return { lines: FILE_TEXT[file] ?? ["(empty)"], changed: [] };
}

// ---- tiny syntax highlighter (per language) ------------------------
// A small ordered-rule tokenizer: at each position the first sticky rule that
// matches wins and its text is wrapped in a coloured span; anything no rule
// claims is emitted as plain (escaped) text. Enough for the short snippets here.
type Lang = "html" | "css" | "js" | "txt" | "ini";
interface SxRule {
  re: RegExp;
  cls: string;
}
const sxWrap = (cls: string, s: string): string =>
  `<span class="sx-${cls}">${esc(s)}</span>`;

const HTML_RULES: SxRule[] = [
  { re: /<!--[\s\S]*?-->/y, cls: "comment" },
  { re: /<!?\/?[\w-]+/y, cls: "tag" }, // <tag  </tag  <!DOCTYPE
  { re: /\/?>/y, cls: "punct" }, // >  or  />
  { re: /"[^"]*"|'[^']*'/y, cls: "str" },
  { re: /[\w-]+(?==)/y, cls: "attr" }, // attribute name before =
  { re: /=/y, cls: "punct" },
];
const CSS_RULES: SxRule[] = [
  { re: /\/\*[\s\S]*?\*\//y, cls: "comment" },
  { re: /"[^"]*"|'[^']*'/y, cls: "str" },
  { re: /#[0-9a-fA-F]{3,8}\b/y, cls: "num" },
  { re: /\b\d+(?:px|rem|em|%|vh|vw|s|ms)?\b/y, cls: "num" },
  { re: /[.#][\w-]+/y, cls: "tag" }, // .class / #id selectors
  { re: /[\w-]+(?=\s*:)/y, cls: "attr" }, // property before the colon
  { re: /[{}();:,]/y, cls: "punct" },
  { re: /[A-Za-z][\w-]*/y, cls: "val" }, // keywords / element selectors / values
];
const JS_RULES: SxRule[] = [
  { re: /\/\/.*/y, cls: "comment" },
  { re: /"[^"]*"|'[^']*'|`[^`]*`/y, cls: "str" },
  {
    re: /\b(?:const|let|var|function|return|if|else|for|while|new|import|export|from|class)\b/y,
    cls: "kw",
  },
  { re: /=>/y, cls: "kw" },
  {
    re: /\b(?:document|window|console|alert|querySelector|addEventListener)\b/y,
    cls: "fn",
  },
  { re: /\b\d+\b/y, cls: "num" },
  { re: /[A-Za-z_$][\w$]*/y, cls: "val" },
];
// git's config / HEAD / refs are INI-ish: [sections], key = value, the odd
// ref: path. Light colour so it reads as structured, not a wall of grey.
const INI_RULES: SxRule[] = [
  { re: /[#;].*/y, cls: "comment" },
  { re: /\[[^\]]*\]/y, cls: "tag" }, // [core], [remote "origin"]
  { re: /"[^"]*"/y, cls: "str" }, // quoted values / subsection names
  { re: /\bref\b/y, cls: "kw" }, // HEAD's "ref:"
  { re: /[\w-]+(?=\s*=)/y, cls: "attr" }, // key before =
  { re: /[=:]/y, cls: "punct" },
  { re: /\b(?:true|false)\b/y, cls: "kw" },
  { re: /\b\d+\b/y, cls: "num" },
  { re: /https?:\/\/\S+|\S+\.git\b/y, cls: "str" }, // urls
];
const RULES: Record<Lang, SxRule[]> = {
  html: HTML_RULES,
  css: CSS_RULES,
  js: JS_RULES,
  txt: [],
  ini: INI_RULES,
};

function highlight(line: string, lang: Lang): string {
  const rules = RULES[lang];
  let out = "",
    i = 0;
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
function langOf(file: string): Lang {
  if (file.endsWith(".css")) return "css";
  if (file.endsWith(".js")) return "js";
  return "html";
}
// the language the editor is currently showing (drives highlighting)
let editorLang: Lang = "html";

// turn a tiny *highlight* markup into HTML: `*word*` becomes a marker-pen swipe,
// everything else is escaped. Used for the short .git note copy.
function inlineHL(s: string): string {
  return s
    .split(/(\*[^*]+\*)/)
    .map((seg) => {
      const esc = seg.replace(
        /[&<>]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!,
      );
      return /^\*[^*]+\*$/.test(seg)
        ? `<span class="hl">${esc.slice(1, -1)}</span>`
        : esc;
    })
    .join("");
}

interface LineOpts {
  changed?: number[];
  caret?: number;
  markLine?: number;
}
// render the file as `lines`, syntax-highlighted for `editorLang`. `changed`
// line indices read as a local change; `caret` parks a blinking caret on the
// line being typed (-1 = none).
function renderEditorLines(lines: string[], opts: LineOpts = {}): void {
  const changed = new Set(opts.changed ?? []);
  const caret = opts.caret ?? -1;
  editorCode.replaceChildren();
  lines.forEach((line, i) => {
    const row = document.createElement("div");
    row.className = "editor__line";
    if (changed.has(i)) row.classList.add("is-changed");
    if (i === caret) row.classList.add("is-active");
    if (i === opts.markLine) row.classList.add("is-key"); // the line worth looking at
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
function editorAnchor(): Pt {
  return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4 };
}
// the on-screen box of a row in a tree, if it's there. `key` is a project
// file's name (data-file) or a .git node's path (data-path).
function fileRowRect(key: string, side: "local" | "remote"): DOMRect | null {
  const listEl = side === "remote" ? remoteList : treeList;
  const li =
    listEl.querySelector<HTMLElement>(`li[data-file="${key}"]`) ??
    listEl.querySelector<HTMLElement>(`li[data-path="${key}"]`);
  return li ? li.getBoundingClientRect() : null;
}
// the transform that shrinks the centred editor down onto a tree row, so
// growing from / folding into it reads as the popup coming out of that file.
// Kept structurally identical to OPEN_TRANSFORM (same function list) so the
// browser interpolates them component-wise rather than via a matrix fallback.
function tuckedTransformFor(r: DOMRect | null): string {
  const a = editorAnchor();
  if (!r) return "translate(-50%, -50%) translate(0px, 0px) scale(0.55)"; // row gone: shrink in place
  const lx = r.left + r.width / 2,
    ly = r.top + r.height / 2;
  const natH = editorEl.offsetHeight || 240; // unscaled height (ignores transform)
  const s = Math.max(0.05, Math.min(0.22, r.height / natH));
  return `translate(-50%, -50%) translate(${(lx - a.x).toFixed(1)}px, ${(ly - a.y).toFixed(1)}px) scale(${s.toFixed(3)})`;
}
const OPEN_TRANSFORM = "translate(-50%, -50%) translate(0px, 0px) scale(1)";

// a generation token: seeking, a new view, or a new run bumps it so an in-flight
// sequence bails at its next checkpoint instead of fighting the new state.
let editSeqGen = 0;
// which file (if any) is currently held open by a click-to-view
let viewerFile: string | null = null;
let viewerSide: "local" | "remote" = "local";

let editorOpen = false; // is the note currently shown (vs hidden)?
function closeEditor(): void {
  editSeqGen++;
  viewerFile = null;
  editorOpen = false;
  editorEl.style.transition = "none";
  editorEl.style.opacity = "0";
  editorEl.style.pointerEvents = "none";
  editorSave.classList.remove("show");
}

// grow the editor out of `row`, so the popup reads as coming from that file.
// The caller has already set the content and bumped editSeqGen.
function growEditorFrom(row: HTMLElement): void {
  const gen = editSeqGen;
  if (S.prefersReduced) {
    editorEl.style.transition = "none";
    editorEl.style.transform = OPEN_TRANSFORM;
    editorEl.style.opacity = "1";
    editorEl.style.pointerEvents = "auto";
    editorOpen = true;
    return;
  }
  if (editorOpen) {
    // already showing a note (e.g. switching to a same-named file in the other
    // tree): glide to the new contents with a small settle, never blink to 0.
    editorEl.style.transition = "none";
    editorEl.style.transform =
      "translate(-50%, -50%) translate(0px, 0px) scale(0.96)";
    editorEl.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (gen !== editSeqGen) return;
      editorEl.style.transition = `transform ${GROW_MS}ms var(--ease-settle)`;
      editorEl.style.transform = OPEN_TRANSFORM;
    });
    return;
  }
  editorEl.style.transition = "none";
  editorEl.style.transform = tuckedTransformFor(row.getBoundingClientRect());
  editorEl.style.opacity = "0";
  editorEl.getBoundingClientRect(); // commit the tucked start state
  requestAnimationFrame(() => {
    if (gen !== editSeqGen) return;
    editorEl.style.transition = `opacity ${GROW_MS}ms var(--ease-settle), transform ${GROW_MS}ms var(--ease-settle)`;
    editorEl.style.transform = OPEN_TRANSFORM;
    editorEl.style.opacity = "1";
    editorEl.style.pointerEvents = "auto";
    editorOpen = true;
  });
}

// render a plain explanatory note in the editor body (for files that aren't
// meant to be read by hand, e.g. packed objects), instead of code lines
function renderEditorNote(text: string, later?: string): void {
  editorCode.replaceChildren();
  const p = document.createElement("p");
  p.className = "editor__note";
  p.innerHTML = inlineHL(text);
  editorCode.appendChild(p);
  if (later) editorCode.appendChild(editorLater(later));
}

// the muted "we'll get to this later" footnote under a .git note's body
function editorLater(text: string): HTMLElement {
  const l = document.createElement("p");
  l.className = "editor__later";
  l.innerHTML = inlineHL(text);
  return l;
}
function prependExplain(text?: string): void {
  if (!text) return;
  const p = document.createElement("p");
  p.className = "editor__explain";
  p.innerHTML = inlineHL(text);
  editorCode.prepend(p);
}

// the index isn't text, so we render its real entries as a small git-status-like
// list, each filename coloured by its actual state (staged vs committed). It
// updates from step to step even though the file list itself doesn't change.
function renderEditorIndexRows(rows: Array<{ name: string; state: string }>): void {
  editorCode.replaceChildren();
  for (const r of rows) {
    const div = document.createElement("div");
    div.className = `editor__idx editor__idx--${r.state}`;
    const name = document.createElement("span");
    name.className = "editor__idx-name";
    name.textContent = r.name;
    const tag = document.createElement("span");
    tag.className = "editor__idx-tag";
    tag.textContent = r.state;
    div.append(name, tag);
    editorCode.appendChild(div);
  }
}

// ---- click any file to open it in the editor (view only) ------------
function openFileViewer(
  file: string,
  side: "local" | "remote",
  row: HTMLElement,
): void {
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
function openGitFile(
  path: string,
  row: HTMLElement,
  side: "local" | "remote" = "local",
): void {
  const node = gitNodeByPath.get(path);
  if (!node) return;
  ++editSeqGen;
  viewerFile = path;
  viewerSide = side;
  editorName.textContent = node.name;
  editorUnsaved.style.opacity = "0";
  editorSave.classList.remove("show");
  if (node.indexRows) {
    // the staging area: a live list of what the index holds + each file's state
    editorLang = "txt";
    renderEditorIndexRows(node.indexRows);
    prependExplain(node.explain);
    if (node.later) editorCode.appendChild(editorLater(node.later));
  } else if (node.content != null) {
    // readable file: one short line, the real contents (key line highlighted),
    // then a "we'll get to it" footnote. Let the lines do most of the talking.
    editorLang = "ini"; // [sections], key = value, ref: paths — light colour
    renderEditorLines(node.content.split("\n"), { markLine: node.markLine });
    prependExplain(node.explain);
    if (node.later) editorCode.appendChild(editorLater(node.later));
  } else {
    // not meant to be read: a short note about what it's for
    renderEditorNote(
      node.desc ?? "This file isn't meant to be read by hand.",
      node.later,
    );
  }
  growEditorFrom(row);
}

// fold the open viewer back into its file row
function closeFileViewer(): void {
  if (viewerFile == null) return;
  const rect = fileRowRect(viewerFile, viewerSide);
  viewerFile = null;
  editorOpen = false;
  editSeqGen++;
  editorEl.style.pointerEvents = "none";
  if (S.prefersReduced) {
    editorEl.style.opacity = "0";
    return;
  }
  editorEl.style.transition = `opacity ${SHRINK_MS}ms var(--ease-settle), transform ${SHRINK_MS}ms var(--ease-settle)`;
  editorEl.style.transform = tuckedTransformFor(rect);
  editorEl.style.opacity = "0";
}

async function playEditSequence(): Promise<void> {
  if (instant || S.prefersReduced) return; // timeline seeks just show the result
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
  editorEl.style.transform = tuckedTransformFor(
    fileRowRect(EDIT_FILE, "local"),
  );
  editorEl.style.opacity = "0";
  editorEl.getBoundingClientRect(); // commit the tucked start state

  // 1) grow: the popup rises out of the index.html line to full size, centred
  requestAnimationFrame(() => {
    if (gen !== editSeqGen) return;
    editorEl.style.transition = `opacity ${GROW_MS}ms var(--ease-settle), transform ${GROW_MS}ms var(--ease-settle)`;
    editorEl.style.transform = OPEN_TRANSFORM;
    editorEl.style.opacity = "1";
    editorOpen = true;
  });
  await sleep(GROW_MS + 320);
  if (!alive()) return; // grow, then a beat to take it in

  // 2) edit: open a fresh line and type the new markup into it, char by char
  lines.splice(EDIT_AT, 0, "");
  editorUnsaved.style.opacity = "1"; // the file is now dirty
  for (let n = 1; n <= EDIT_NEW.length; n++) {
    lines[EDIT_AT] = EDIT_NEW.slice(0, n);
    renderEditorLines(lines, { changed: [EDIT_AT], caret: EDIT_AT });
    await sleep(44);
    if (!alive()) return;
  }
  await sleep(650);
  if (!alive()) return; // sit on the finished edit a moment

  // 3) save: the unsaved dot clears and a "saved" note flashes, then it lingers.
  // the new line stays green: a saved-but-uncommitted local change.
  renderEditorLines(lines, { changed: [EDIT_AT] });
  editorUnsaved.style.opacity = "0";
  editorSave.classList.add("show");
  await sleep(1600);
  if (!alive()) return; // longer hold so the save registers

  // 4) fold back into the tree line, then leave index.html marked modified
  editorEl.style.transition = `opacity ${SHRINK_MS}ms var(--ease-settle), transform ${SHRINK_MS}ms var(--ease-settle)`;
  editorEl.style.transform = tuckedTransformFor(
    fileRowRect(EDIT_FILE, "local"),
  );
  editorEl.style.opacity = "0";
  editorOpen = false;
  await sleep(SHRINK_MS + 60);
  if (!alive()) return;
  editorSave.classList.remove("show");
}

// clicking a file row opens it; clicking the open file again, its bar, outside,
// or Escape folds it away. Delegated so re-rendered rows keep working.
// one click handler for ANY tree (local or remote): a folder toggles open, a
// .git file or a project file opens in the note editor. stopPropagation keeps a
// tree click from also tripping the companion's outside-click dismissal.
function wireTree(tree: TreeView): void {
  tree.el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const folder = t.closest<HTMLElement>(".is-folder[data-path]");
    if (folder) {
      e.stopPropagation();
      const path = folder.dataset.path!;
      const willOpen = !tree.open.has(path);
      setNodeOpen(tree, path, willOpen);
      // toggling .git by hand while a companion question is peeking into it makes
      // that the state the peek restores when it closes (don't undo the user)
      if (
        path === ".git" &&
        tree.side === "local" &&
        openBtn?.dataset.points === "dotgit"
      )
        gitOpenBeforePeek = willOpen;
      return;
    }
    const gitFile = t.closest<HTMLElement>(".is-gitfile[data-path]");
    if (gitFile) {
      e.stopPropagation();
      const path = gitFile.dataset.path!;
      if (viewerFile === path && viewerSide === tree.side) closeFileViewer();
      else openGitFile(path, gitFile, tree.side);
      return;
    }
    const projFile = t.closest<HTMLElement>("li[data-file]");
    if (projFile) {
      e.stopPropagation();
      const file = projFile.dataset.file!;
      if (viewerFile === file && viewerSide === tree.side) closeFileViewer();
      else openFileViewer(file, tree.side, projFile);
    }
  });
}

function wireFileViewer(): void {
  wireTree(localTree);
  wireTree(remoteTree);

  editorEl.addEventListener("click", (e) => {
    if (viewerFile == null) return; // the auto-edit ignores clicks
    if ((e.target as HTMLElement).closest(".editor__bar")) closeFileViewer();
  });
  document.addEventListener("click", (e) => {
    if (viewerFile == null) return;
    const t = e.target as HTMLElement;
    if (editorEl.contains(t) || treeEl.contains(t) || remoteTreeEl.contains(t))
      return;
    closeFileViewer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && viewerFile != null) closeFileViewer();
  });
}

// ---- the remote panel: the SAME tree, fed a remote model ------------
// The remote is a copy of your repo online. Once pushed, its .git mirrors the
// local one exactly (same objects/refs/HEAD), so we reuse the local snapshot's
// .git for it — clicking the remote's HEAD shows the same real file.
let lastRemoteShown = false;
let lastRemotePushed = false;
function remoteModel(): RepoModel | null {
  if (stepIndex <= stepIdx("remote")) return null; // no remote added yet
  const pushed = stepIndex > stepIdx("push");
  const files: FileRow[] = pushed
    ? PROJECT.files.map((f) => ({
        name: f,
        file: f,
        state: "committed" as FileState,
        flash: lastRemotePushed ? undefined : ("pushed" as const),
      }))
    : [];
  return {
    root: PROJECT.root,
    url: remoteUrl.replace(/^https?:\/\//, "").replace(/\.git$/, ""),
    git: pushed && snap?.inited ? snap.git : null, // no .git until something is actually pushed
    gitNote: "the remote repo",
    gitNew: !lastRemoteShown,
    files,
    emptyMsg: pushed ? undefined : "nothing pushed yet",
  };
}
function renderRemoteTree(): void {
  const model = remoteModel();
  remoteTreeEl.classList.toggle("is-shown", !!model);
  if (!model) {
    remoteList.replaceChildren();
    lastRemoteShown = false;
    lastRemotePushed = false;
    return;
  }
  renderTree(remoteTree, model);
  lastRemoteShown = true;
  lastRemotePushed = stepIndex > stepIdx("push");
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
const shownRemoteIds = new Set<number>(); // commits already drawn on the mini-graph

// the commits that live on the remote: the main-lane trunk up to origin/main's
// tip (everything reachable from what you pushed).
function remoteTrunk(): CommitNode[] {
  const tip = nodeById(originMain);
  if (!tip) return [];
  return model.nodes
    .filter((n) => n.lane === 0 && n.col <= tip.col)
    .sort((a, b) => a.col - b.col);
}
function renderRemoteGraph(allowAnim = true): void {
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
  const xAt = (i: number, c: number) => cx + (i - (c - 1) / 2) * REMOTE_GAP;
  const animate = allowAnim && !instant && !S.prefersReduced;
  const firstShow = oldCount === 0;

  // caption so it's clearly the remote, not a second local graph
  const label = S.el("text", {
    x: cx,
    y: restY - 52,
    "text-anchor": "middle",
    class: "remote-graph-label",
  }) as SVGTextElement;
  label.textContent = "the remote";
  gRemoteInner.appendChild(label);

  const parts: {
    g: SVGGElement;
    conn: SVGPathElement | null;
    finalX: number;
    isNew: boolean;
  }[] = [];
  trunk.forEach((node, i) => {
    const finalX = xAt(i, count);
    const isNew = !shownRemoteIds.has(node.id);
    const g = S.el("g") as SVGGElement;
    let conn: SVGPathElement | null = null;
    if (i > 0) {
      conn = S.el("path", {
        d: connectorPath(
          { x: -REMOTE_GAP, y: 0, r: REMOTE_NODE_R },
          { x: 0, y: 0, r: REMOTE_NODE_R },
          node.id * 5 + 2,
        ),
        class: "edge-stroke",
        stroke: COLORS.main,
        "stroke-width": 2,
      }) as SVGPathElement;
      g.appendChild(conn);
    }
    g.appendChild(
      S.el("path", {
        d: shapePath(node.shape, 0, 0, REMOTE_NODE_R, node.id * 7 + 1),
        fill: node.color,
        stroke: node.color,
        "stroke-width": 2,
        "stroke-linejoin": "round",
      }),
    );
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
      label.style.transition =
        "transform 1.15s cubic-bezier(.4,0,.2,1), opacity .7s ease";
      label.style.transform = "translateY(0)";
      label.style.opacity = "1";
    }
    for (const p of parts) {
      p.g.style.transition = p.isNew
        ? "transform 1.15s cubic-bezier(.4,0,.2,1), opacity .5s ease" // rise from the local lane
        : "transform .8s cubic-bezier(.4,0,.2,1)"; // glide to re-centre
      p.g.style.transform = `translate(${p.finalX}px, ${restY}px)`;
      p.g.style.opacity = "1";
      if (p.conn) {
        // draw the new connector in after the node arrives
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
function updateLayout(): void {
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
const TIMELINE_TASKS: { label: string; keys: string[] }[] = [
  { label: "Initialize repo", keys: ["init", "add", "commit"] },
  { label: "Add a remote", keys: ["remote", "push"] },
  { label: "Branch HEAD", keys: ["branch", "checkout", "add2", "commit2"] },
  { label: "Merge to HEAD", keys: ["checkout-main", "merge", "push2"] },
];
// a command label for a sub-step, e.g. "commit2" -> "git commit". The checkout*
// keys are kept internally but now teach (and label) the modern "git switch".
function cmdLabel(key: string): string {
  const sub = key.replace(/[-\d].*$/, "");
  return `git ${sub === "checkout" ? "switch" : sub}`;
}
interface TLStop {
  group: HTMLElement;
  taskBtn: HTMLButtonElement;
  first: number;
  last: number;
  subs: { btn: HTMLButtonElement; si: number }[];
}
const tlStops: TLStop[] = [];
let tlComplete: HTMLButtonElement | null = null;

function buildTimeline(): void {
  timelineEl.replaceChildren();
  tlStops.length = 0;

  const linkInto = (parent: HTMLElement, sub = false, order = -1) => {
    const l = document.createElement("span");
    l.className = sub ? "tl-link tl-link--sub" : "tl-link";
    if (order >= 0) l.style.setProperty("--i", String(order));
    parent.appendChild(l);
  };
  const makeStop = (
    cls: string,
    dotCls: string,
    text: string,
    onClick: () => void,
  ): HTMLButtonElement => {
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
    const idx = t.keys
      .map(stepIdx)
      .filter((s) => s >= 0)
      .sort((a, b) => a - b);
    const first = idx[0],
      last = idx[idx.length - 1];
    if (i > 0) linkInto(timelineEl);

    // the whole task: its milestone stop plus a sub-row that expands when current
    const group = document.createElement("div");
    group.className = "tl-group";
    // clicking a stop goes TO that point (it becomes the current step), it does
    // not run the task. The milestone lands you at the start of its task.
    const taskBtn = makeStop("tl-item", "tl-dot", t.label, () => {
      void seekTo(first);
    });
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
    const subs: { btn: HTMLButtonElement; si: number }[] = [];
    let order = 0;
    idx.forEach((si) => {
      linkInto(inner, true, order++); // connector from the milestone / previous sub-step
      const sBtn = makeStop(
        "tl-substep",
        "tl-dot tl-dot--sub",
        cmdLabel(steps[si].key),
        () => {
          void seekTo(si);
        },
      );
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
  done.addEventListener("click", () => {
    void seekTo(steps.length);
  });
  timelineEl.appendChild(done);
  tlComplete = done;

  updateTimeline();
}
function updateTimeline(): void {
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
function resetBoard(): void {
  [gEdges, gNodes, gNib, gLabels, gRemoteInner].forEach((g) =>
    g.replaceChildren(),
  );
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
// the value to replay a step with: YOUR saved value if you set one, otherwise
// the step's own canonical default — so a custom origin name / commit message /
// branch name survives a seek (and a reload) instead of snapping back to a canned
// default, while steps you never customised still replay correctly.
function argFor(st: Step): string | undefined {
  if (!st.extract) return undefined;
  const saved = persisted.values[st.key];
  return saved != null ? saved : st.extract(canonical(st));
}

async function seekTo(target: number): Promise<void> {
  if (busy || target === stepIndex) return;
  busy = true;
  // try/finally so a thrown replay (real git on the shared fs) can never leave
  // `busy` or `instant` stuck true and freeze every future command + seek.
  try {
    closeEditor(); // a seek cancels any in-flight edit and hides the editor
    // a seek shows resolved states: drop any pending edit-demo + its dismiss arming
    editDemoPending = false;
    awaitingDismiss = false;
    clearDismissDemo();
    clearNudge();
    // cancel any in-flight field morph so the underline/ink land at the seek state
    cliMorphing = false;
    cliAwaitingTextIn = false;
    ink.style.opacity = "1";
    ink.style.transform = "none";
    resetBoard();
    if (target <= 0) {
      stage.classList.remove("is-docked");
      stage.classList.add("is-centered");
      stage.style.setProperty("--stage-y", "50%");
    }
    instant = true;
    try {
      for (let k = 0; k < target; k++) {
        await steps[k].run(argFor(steps[k]));
      }
      centerOnHead(); // pan instantly while still in replay mode (no glide)
      if (target >= steps.length) showEndState();
    } finally {
      instant = false;
    }
    stepIndex = target;
    persisted.step = target;
    savePersisted(); // remember where a seek left you, too
    cmd.value = "";
    showStep(stepIndex);
    updateTimeline();
    await refreshRepo();
    renderRemoteTree();
    renderRemoteGraph(false); // seek: the remote tree is just there, no float
    updateLayout();
    syncCompanion();
    if (!isPhone) cmd.focus();
  } finally {
    busy = false;
  }
}

// ---- boot -----------------------------------------------------------
// landing intro: type the file-tree callout in, character by character, in step
// with the CSS draw-on of the tree, its arrow, the clone note and the roadmap.
// (reduced motion / phones just get the finished text.)
function typeLandingCallout(): void {
  const label = document.querySelector<HTMLElement>(".note--tree .note__label");
  if (!label) return;
  const text = label.getAttribute("data-text") ?? "";
  if (S.prefersReduced || isPhone) {
    label.textContent = text;
    return;
  }
  label.textContent = "";
  let i = 0;
  const step = (): void => {
    label.textContent = text.slice(0, i);
    if (i < text.length) {
      i++;
      window.setTimeout(step, 24);
    }
  };
  // hold off until the command line has had a beat to itself, then type the
  // callout in step with the tree's arrow drawing on (see the landing CSS)
  window.setTimeout(step, 1500);
}

// ---- the curiosity companion -----------------------------------------
// A persistent bottom-right voice. It renders the current step's questions for
// the right tense (pre/post), each a tap-to-open button. Opening a question
// whose answer is about a real thing on the board inks an arrow to it.

const CARET_PATH = "M5 3 C 9 6, 11 7, 12 8 C 11 9, 9 10, 5 13"; // the hand-drawn ">"
// arrows currently drawn, keyed by the question button that opened them, so we
// can retract one on close and redraw them all on resize
const openArrows = new Map<HTMLButtonElement, SVGGElement>();
// the one question currently in focus (only one is ever open at a time)
let openBtn: HTMLButtonElement | null = null;
let gitOpenBeforePeek = false; // .git open-state before a companion question peeked into it

// the live snapshot from the REAL git repo (repo.ts) drives the tree + states.
let snap: RepoSnapshot | null = null;
let lastCommitMsg = "first commit";

// A tree view: a container <ul>, its own set of open paths, and which side it
// is. The local working tree and the remote panel are two instances of the SAME
// renderer (renderTree) — they only differ in the model fed to them.
interface TreeView {
  el: HTMLElement;
  open: Set<string>;
  side: "local" | "remote";
}
const localTree: TreeView = {
  el: treeList,
  open: new Set(["root"]),
  side: "local",
};
const remoteTree: TreeView = {
  el: remoteList,
  open: new Set(["root"]),
  side: "remote",
};

// flat index of every .git *file* by path, so a click can open it in the
// editor. The remote mirrors the local's .git after push, so one index serves
// both. Rebuilt from each snapshot.
let gitNodeByPath = new Map<string, RepoGitNode>();
function indexGitNodes(nodes: RepoGitNode[]): void {
  for (const n of nodes) {
    if (n.isDir) indexGitNodes(n.children ?? []);
    else gitNodeByPath.set(n.path, n);
  }
}

// the real-git commands that should have run by a given step (init/add/commit).
// Replaying these from scratch reproduces the exact repo state for that step.
function repoCommandsFor(i: number): RepoCmd[] {
  const cmds: RepoCmd[] = [];
  if (i > stepIdx("init")) cmds.push({ kind: "init" });
  if (i > stepIdx("add")) cmds.push({ kind: "add" });
  if (i > stepIdx("commit"))
    cmds.push({
      kind: "commit",
      message: persisted.values["commit"] ?? lastCommitMsg,
    });
  // git remote add really runs (writes .git/config), so the config file shows it
  if (i > stepIdx("remote")) cmds.push({ kind: "remoteAdd", url: remoteUrl });
  return cmds;
}
// replay real git to the current step, take a fresh snapshot, redraw the tree.
// The tree's open/closed state persists across steps by default; a step can opt
// into a tidy (collapsed) tree on arrival with `collapseTree`.
async function refreshRepo(): Promise<void> {
  await replayTo(repoCommandsFor(stepIndex));
  snap = await snapshot();
  gitNodeByPath = new Map();
  indexGitNodes(snap.git);
  if (steps[stepIndex]?.collapseTree) {
    localTree.open.clear();
    localTree.open.add("root");
  }
  renderFileTree();
}

// open/close a tree node by path: flips its row + the subwrap that follows it,
// and (for folders) swaps the closed folder icon for an open one. Animations
// ride the class change, so we never re-render to toggle.
function setNodeOpen(tree: TreeView, path: string, open: boolean): void {
  if (open) tree.open.add(path);
  else tree.open.delete(path);
  const row = tree.el.querySelector<HTMLElement>(`[data-path="${path}"]`);
  if (!row) return;
  row.classList.toggle("is-open", open);
  const sub = row.nextElementSibling;
  if (sub && sub.classList.contains("tree__subwrap")) {
    sub.classList.toggle("is-open", open);
    // opening a folder cascades a staggered write-on over EVERYTHING it reveals,
    // recursively (nested open folders included) — nothing just blinks in.
    if (open) revealSubtree(sub as HTMLElement);
  }
  if (row.classList.contains("is-folder")) {
    row
      .querySelector(".ic")
      ?.replaceWith(open ? folderIconOpen() : folderIcon());
  }
}

// collect a subwrap's currently-visible rows in top-to-bottom order, descending
// only into nested folders that are themselves open (so hidden rows don't count)
function collectVisibleRows(sub: Element, acc: HTMLElement[]): void {
  for (const child of Array.from(sub.children)) {
    if (child.classList.contains("tree__subwrap")) {
      if (child.classList.contains("is-open")) {
        const inner = child.querySelector(":scope > .tree__sub");
        if (inner) collectVisibleRows(inner, acc);
      }
    } else {
      acc.push(child as HTMLElement); // a file/folder/placeholder row
    }
  }
}

// re-run the write-on entrance on every row a just-opened folder reveals,
// staggered by visual order, so the whole subtree animates in (not a blink)
function revealSubtree(wrap: HTMLElement): void {
  if (S.prefersReduced) return;
  const sub = wrap.querySelector(":scope > .tree__sub");
  if (!sub) return;
  const rows: HTMLElement[] = [];
  collectVisibleRows(sub, rows);
  rows.forEach((r) => r.classList.remove("is-revealing"));
  void wrap.offsetWidth; // reflow so removing + re-adding restarts the animation
  rows.forEach((r, i) => {
    r.style.setProperty("--ri", String(i));
    r.classList.add("is-revealing");
  });
}
// the companion's .git/ question drives the same folder open as a manual click
function setGitOpen(open: boolean): void {
  if (open) setNodeOpen(localTree, "root", true); // make sure the root is open so .git/ is visible
  setNodeOpen(localTree, ".git", open);
}

// resolve a `points` key to the live board element its arrow should reach
function companionTarget(points: string): Element | null {
  switch (points) {
    case "dotgit":
      return treeList.querySelector(".d--git");
    case "node:tip":
      return gNodes.lastElementChild;
    case "tag:HEAD":
      return refPills.get("HEAD") ?? null;
    default:
      return null;
  }
}

// draw a hand-drawn arrow from the open answer to its board target, in pixel
// space (the overlay is a full-viewport SVG with no viewBox)
function drawCompanionArrow(
  fromEl: Element,
  points: string,
): SVGGElement | null {
  const target = companionTarget(points);
  if (!target) return null;
  const a = fromEl.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!a.width || !b.width) return null;
  // start just left of the answer's first line, end just right of the target
  const x1 = a.left - 6,
    y1 = a.top + Math.min(16, a.height / 2);
  const x2 = b.right + 8,
    y2 = b.top + b.height / 2;
  // a curve that LEAVES the answer heading left and ARRIVES at .git/ travelling
  // horizontally, so the arrowhead points straight at it rather than tipping up
  const dx = x2 - x1;
  const cx1 = x1 + dx * 0.4,
    cy1 = y1 + (y2 - y1) * 0.1;
  const cx2 = x2 + Math.max(70, Math.abs(dx) * 0.32),
    cy2 = y2; // control sits level, to the right
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  const shaft = document.createElementNS(ns, "path");
  shaft.setAttribute(
    "d",
    `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
  );
  shaft.setAttribute("pathLength", "1");
  // arrowhead: two short barbs off the tip, angled back toward the shaft
  const head = document.createElementNS(ns, "path");
  const ang = Math.atan2(y2 - cy2, x2 - cx2);
  const len = 11;
  const hx1 = x2 - len * Math.cos(ang - 0.42),
    hy1 = y2 - len * Math.sin(ang - 0.42);
  const hx2 = x2 - len * Math.cos(ang + 0.42),
    hy2 = y2 - len * Math.sin(ang + 0.42);
  head.setAttribute(
    "d",
    `M ${hx1.toFixed(1)} ${hy1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} L ${hx2.toFixed(1)} ${hy2.toFixed(1)}`,
  );
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
function removeCompanionArrow(q: HTMLButtonElement): void {
  const g = openArrows.get(q);
  if (!g) return;
  openArrows.delete(q);
  if (S.prefersReduced) {
    g.remove();
    return;
  }
  g.querySelectorAll<SVGPathElement>("path").forEach((p, i) => {
    p.classList.remove("is-drawing");
    p.style.animationDelay = i === 1 ? "0.3s" : ""; // the head erases just after the shaft
    p.classList.add("is-erasing");
  });
  window.setTimeout(() => g.remove(), 850);
}

// re-aim every open arrow (after a resize or relayout moved its endpoints)
function redrawCompanionArrows(): void {
  openArrows.forEach((g, q) => {
    const points = q.dataset.points;
    g.remove();
    openArrows.delete(q);
    if (points && q.getAttribute("aria-expanded") === "true") {
      const wrap = q.nextElementSibling;
      const answer = wrap?.firstElementChild ?? q;
      const fresh = drawCompanionArrow(answer, points);
      if (fresh) openArrows.set(q, fresh);
    }
  });
}

// entering "learn mode": the user has decided that understanding, not
// continuing, is what matters now, so the command line and its scaffolding
// recede. You're either continuing or learning, never both at once.
function enterLearnMode(): void {
  document.body.classList.add("is-learning");
  companionEl.classList.add("is-focus");
  if (!isPhone) cmd.blur();
}
function exitLearnMode(): void {
  document.body.classList.remove("is-learning");
  companionEl.classList.remove("is-focus");
  if (!isPhone && !pointerDown) cmd.focus();
}

// bring a question into focus: it grows, the others step back, the page dims,
// and (if it points somewhere) an arrow inks out to the real thing
function openCurio(
  btn: HTMLButtonElement,
  ans: HTMLElement,
  points?: string,
): void {
  if (openBtn && openBtn !== btn) closeCurio(openBtn);
  btn.setAttribute("aria-expanded", "true");
  btn.parentElement?.classList.add("is-open");
  openBtn = btn;
  enterLearnMode();
  // peek inside .git for the answer, remembering the prior state so closing the
  // question restores it (rather than force-collapsing a folder the user opened)
  if (points === "dotgit") {
    gitOpenBeforePeek = localTree.open.has(".git");
    setGitOpen(true);
  }
  if (points) {
    // let the answer enlarge first, so the arrow leaves from its settled spot
    window.setTimeout(
      () => {
        if (btn.getAttribute("aria-expanded") !== "true") return;
        const g = drawCompanionArrow(ans, points);
        if (g) openArrows.set(btn, g);
      },
      S.prefersReduced ? 0 : 380,
    );
  }
}

// let a question go: retract its arrow + .git/ peek, and if it was the focused
// one, hand attention back to continuing
function closeCurio(btn: HTMLButtonElement): void {
  btn.setAttribute("aria-expanded", "false");
  btn.parentElement?.classList.remove("is-open");
  removeCompanionArrow(btn);
  if (btn.dataset.points === "dotgit") setGitOpen(gitOpenBeforePeek); // restore prior state
  if (openBtn === btn) {
    openBtn = null;
    exitLearnMode();
  }
}

// build one question + answer block; clicking it pulls it into focus (or, if
// it's already the focused one, lets it go)
function curioBlock(c: Curio): HTMLElement {
  const qa = document.createElement("div");
  qa.className = "companion__qa";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "companion__q";
  btn.setAttribute("aria-expanded", "false");
  if (c.points) btn.dataset.points = c.points;
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
    if (btn.getAttribute("aria-expanded") === "true") closeCurio(btn);
    else openCurio(btn, ans, c.points);
  });

  qa.append(btn, wrap);
  return qa;
}

// tear down any focus state + arrows when the question set is about to change.
// It deliberately does NOT touch the tree's open/closed state: advancing a
// command respects whatever the user (or a prior peek) left open.
function resetCompanion(): void {
  openBtn = null;
  companionEl.classList.remove("is-focus");
  document.body.classList.remove("is-learning");
  openArrows.clear();
  companionArrows.replaceChildren();
}

// show (or hide) the companion for a given step + tense
function setCompanion(key: string | null, phase: "pre" | "post"): void {
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
function syncCompanion(): void {
  companionEl.classList.toggle("is-landing", stepIndex === 0);
  if (stepIndex === 0) {
    // first load: the companion is the LAST thing to arrive, well after the
    // command line, the file tree and the welcome line have each had their beat
    if (!companionPrimed && !S.prefersReduced) {
      companionEl.style.transitionDelay = "3.8s";
      window.setTimeout(() => {
        companionEl.style.transitionDelay = "";
      }, 4800);
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
function applyStepParam(): void {
  let v: string | null = null;
  try {
    v = new URLSearchParams(window.location.search).get("step");
  } catch {
    return;
  }
  if (!v) return;
  const target = /^\d+$/.test(v)
    ? parseInt(v, 10)
    : steps.findIndex((s) => s.key === v);
  if (target > 0) void seekTo(target);
}

// ---- brand logo: click once to arm, again to restart ----------------
// Clicking "howtogit.dev" the first time reveals a "click again to restart"
// hint under it; clicking again wipes the saved session and drops you back on
// the centred start page. Clicking elsewhere (or waiting) cancels the arming.
function wireBrand(): void {
  const brand = needSel<HTMLElement>(".brand");
  const word = needSel<HTMLElement>(".brand__word");
  let armed = false;
  let disarmTimer = 0;
  const disarm = (): void => {
    armed = false;
    brand.classList.remove("is-armed");
    if (disarmTimer) {
      window.clearTimeout(disarmTimer);
      disarmTimer = 0;
    }
  };
  const restart = (): void => {
    disarm();
    clearPersisted(); // forget the saved session
    remoteName = "origin"; // seekTo(0) runs no steps,
    remoteUrl = "https://github.com/you/site.git"; // so reset these by hand
    lastCommitMsg = "first commit";
    void seekTo(0); // back to the centred landing
  };
  const activate = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation(); // don't let this same click immediately disarm
    if (armed) {
      restart();
      return;
    }
    armed = true;
    brand.classList.add("is-armed");
    disarmTimer = window.setTimeout(disarm, 5000); // forget the arming if ignored
  };
  word.addEventListener("click", activate);
  word.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === "Enter" || k === " ") activate(e);
  });
  document.addEventListener("click", (e) => {
    // a click elsewhere cancels it
    if (armed && !brand.contains(e.target as Node)) disarm();
  });
}

// On load: a hard refresh (Ctrl+Shift+R) starts clean; a normal reload restores
// the saved step and your typed values, replaying the lesson straight to where
// you left off (custom origin name, commit messages, branch names and all).
async function restoreSession(): Promise<void> {
  if (isHardRefresh()) {
    clearPersisted();
    return;
  }
  const p = loadPersisted();
  if (!p) return;
  persisted = p;
  lastCommitMsg = persisted.values["commit"] ?? lastCommitMsg;
  const target = Math.max(0, Math.min(persisted.step, steps.length));
  if (target > 0) await seekTo(target);
}

async function boot(): Promise<void> {
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
  needSel<HTMLElement>("#filetree .tree__title").prepend(computerIcon());
  needSel<HTMLElement>("#remotetree .tree__title").prepend(cloudIcon());
  wireFileViewer(); // click any file in either tree to open it
  wireBrand(); // click the logo once to arm, again to restart
  typeLandingCallout(); // landing intro: type the file-tree callout in
  syncCompanion(); // landing: the curiosity companion's forward-looking questions
  await restoreSession(); // normal reload resumes where you left off; hard refresh starts clean
  if (!isPhone) cmd.focus();
  applyStepParam(); // dev: ?step=N jumps straight to a state for screenshots
}

window.addEventListener("resize", () => {
  sizeBoard();
  if (stepIndex > 0) positionStage(false); // keep the stage pinned to the bottom
  centerOnHead(); // viewW changed: keep HEAD centred
  renderRemoteGraph(false); // recompute the mini-graph's float-up transform
  updateInk(); // recompute field width + redraw the underline
  redrawCompanionArrows(); // re-aim any open answer arrows at their moved targets
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}
