/* ghpage.ts: GitHub's side of the world as a small repo page.
 *
 * In the tracks past "How git works", GitHub holds more than history: issues,
 * pull requests with reviews, Actions runs and rules for main. This draws that
 * as a page with tabs (Code, Issues, Pull requests, Actions, Settings) in the
 * site's paper and ink. It only reads the World.
 *
 * The page drawing code (main.ts) owns the history strip. The Code tab has a
 * slot for it; renderGhPage moves the strip in while the Code tab shows on a
 * wide screen, and back to where it came from otherwise (phones keep every
 * strip together in their overview). The slot is never rebuilt, so the strip
 * is not torn out of the page when anything else changes.
 *
 * A run that shows up for the first time plays queued, then in progress, then
 * done, on one clock (performance.now), with no transforms. */

import * as G from "./model.js";
import type { World, Issue, PR, Run, Review, Note, Ruleset } from "./model.js";
import { circlePath, prefersReduced } from "./sketch.js";

export type GhTab = "code" | "issues" | "pulls" | "actions" | "settings";
export const GH_TABS: GhTab[] = ["code", "issues", "pulls", "actions", "settings"];

export interface GhState {
  tab: GhTab;
  openIssue?: number | null;
  openPr?: number | null;
  openRun?: number | null;
  issueFilter?: "open" | "closed";
  prFilter?: "open" | "closed";
}

export interface GhOpts extends GhState {
  colorOf: (branch: string) => string;
  mergeBlockers?: (w: World, n: number) => string[];
  stripHtml?: string; // markup for the strip slot, for pages with no live strip
}

/* ------------------------------------------------------------ small bits */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const PEOPLE: Record<string, { name: string; color: string }> = {
  you: { name: "You", color: "var(--pen-blue)" },
  albert: { name: "Albert", color: "var(--friend)" },
  toby: { name: "Toby", color: "var(--toby)" },
};
/* logins are "you", "albert", "toby"; commits carry "You" and "Albert" */
function person(login: string) {
  const key = (login || "").toLowerCase();
  return { key, ...(PEOPLE[key] ?? { name: login || "someone", color: "var(--ink-soft)" }) };
}
const isYou = (login: string) => person(login).key === "you";
const verbS = (login: string, base: string) => (isYou(login) ? base : base + "s");

function av(login: string, big = false): string {
  const p = person(login);
  return `<span class="ghp-av${big ? " ghp-av--big" : ""}" style="--who:${p.color}" title="${esc(p.name)}" aria-hidden="true">${esc(p.name[0].toUpperCase())}</span>`;
}
function avStack(logins: string[], what: string): string {
  if (!logins.length) return "";
  const names = logins.map((l) => person(l).name).join(", ");
  return `<span class="ghp-avs" role="img" aria-label="${esc(what)} ${esc(names)}">${logins.map((l) => av(l)).join("")}</span>`;
}
const nameHtml = (login: string) => { const p = person(login); return `<b class="ghp-who" style="--who:${p.color}">${esc(p.name)}</b>`; };

/* label chips: the label's own colour, with whichever of near-black or white
 * reads better on it (light theme); the dark theme tints it in gh.css */
function hexRgb(c: string): [number, number, number] | null {
  const m = c.trim().replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
function labelHtml(w: World, name: string): string {
  const l = w.labels?.find((x) => x.name === name);
  const rgb = l ? hexRgb(l.color) : null;
  const style = rgb
    ? `--lc:rgb(${rgb.join(",")});--lt:${(lum(rgb) + 0.05) / 0.061 > 1.05 / (lum(rgb) + 0.05) ? "#1b1b1b" : "#fff"}`
    : `--lc:var(--ink-soft);--lt:var(--card)`;
  return `<span class="ghp-label" style="${style}"${l?.desc ? ` title="${esc(l.desc)}"` : ""}>${esc(name)}</span>`;
}
const labelsHtml = (w: World, names: string[] | undefined) =>
  names?.length ? `<span class="ghp-labels">${names.map((n) => labelHtml(w, n)).join("")}</span>` : "";

/* text people wrote: line breaks kept, `code` and #N links */
function textHtml(w: World, s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[\s(])#(\d+)\b/g, (all, pre: string, num: string) => {
      const n = Number(num);
      if (w.prs.some((p) => p.n === n)) return `${pre}<button type="button" class="ghp-ref" data-gh-pr="${n}">#${n}</button>`;
      if (w.issues?.some((i) => i.n === n)) return `${pre}<button type="button" class="ghp-ref" data-gh-issue="${n}">#${n}</button>`;
      return all;
    });
}

/* ------------------------------------------------------------ icons
 * Drawn on a 20 box with a slightly wobbly ring, like the rest of the board. */

const svg = (inner: string, cls = "") => `<svg class="ghp-i ${cls}" viewBox="0 0 20 20" aria-hidden="true">${inner}</svg>`;
const ring = (seed: number, r = 7.2) => `<path d="${circlePath(10, 10, r, seed, 0.3)}"/>`;
const CHECK = `<path d="M6.6 10.3l2.4 2.5 4.6-5.2"/>`;
const CROSS = `<path d="M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4"/>`;
const PR_LEFT = `<circle cx="5.5" cy="4.5" r="2.1"/><circle cx="5.5" cy="15.5" r="2.1"/><path d="M5.5 6.6v6.8"/>`;
const ICON = {
  issueOpen: () => svg(ring(3) + `<circle class="ghp-i__fill" cx="10" cy="10" r="1.9"/>`, "is-open"),
  issueDone: () => svg(ring(5) + CHECK, "is-merged"),
  issueNot: () => svg(ring(7) + `<path d="M5.4 14.6l9.2-9.2"/>`, "is-soft"),
  prOpen: () => svg(PR_LEFT + `<circle cx="14.5" cy="15.5" r="2.1"/><path d="M14.5 13.4V8.3a2.6 2.6 0 0 0-2.6-2.6H8.6M10.6 3.4l-2.1 2.3 2.1 2.3"/>`, "is-open"),
  prDraft: () => svg(PR_LEFT + `<circle cx="14.5" cy="15.5" r="2.1"/><path d="M14.5 11.4v-.6M14.5 8.4v-.6M14.5 5.2v-.6"/>`, "is-soft"),
  prMerged: () => svg(PR_LEFT + `<circle cx="14.5" cy="11" r="2.1"/><path d="M5.5 6.6c0 3.2 3.4 4.4 6.9 4.4"/>`, "is-merged"),
  prClosed: () => svg(PR_LEFT + `<circle cx="14.5" cy="15.5" r="2.1"/><path d="M14.5 13.4V10M12.6 3.6l3.8 3.8M16.4 3.6l-3.8 3.8"/>`, "is-closed"),
  ok: () => svg(ring(11) + CHECK, "is-open"),
  bad: () => svg(ring(13) + CROSS, "is-closed"),
  queued: () => svg(`<path class="ghp-i__dots" pathLength="100" d="${circlePath(10, 10, 6.6, 17, 0.3)}"/>`, "is-wait"),
  spin: () => svg(`<path class="ghp-i__track" d="${circlePath(10, 10, 6.6, 19, 0.3)}"/><path class="ghp-i__arc" pathLength="100" d="${circlePath(10, 10, 6.6, 19, 0.3)}"/>`, "is-wait"),
  changes: () => svg(ring(23) + `<path d="M10 6.4v4.4M7.8 8.6h4.4M7.8 13.4h4.4"/>`, "is-closed"),
  comment: () => svg(`<path d="M4.2 4.4h11.6a1.4 1.4 0 0 1 1.4 1.4v6.6a1.4 1.4 0 0 1-1.4 1.4H9.6l-3.8 3.1v-3.1H4.2a1.4 1.4 0 0 1-1.4-1.4V5.8a1.4 1.4 0 0 1 1.4-1.4Z"/>`),
  code: () => svg(`<path d="M7.2 5.2L2.8 10l4.4 4.8M12.8 5.2l4.4 4.8-4.4 4.8"/>`),
  play: () => svg(ring(29) + `<path d="M8.5 6.9l4.6 3.1-4.6 3.1Z"/>`),
  gear: () => svg(`<path d="${circlePath(10, 10, 3.4, 31, 0.3)}"/><path d="${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    const a = (k * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    return `M${(10 + c * 5.6).toFixed(1)} ${(10 + s * 5.6).toFixed(1)}L${(10 + c * 7.8).toFixed(1)} ${(10 + s * 7.8).toFixed(1)}`;
  }).join("")}"/>`),
  file: () => svg(`<path d="M5.2 2.8h6.2l3.4 3.4v11H5.2Z M11.4 2.8v3.4h3.4"/>`, "is-soft"),
  shield: () => svg(`<path d="M10 2.6l6 2.2v4.6c0 3.8-2.6 6.4-6 7.8-3.4-1.4-6-4-6-7.8V4.8Z"/>`),
  live: () => svg(ring(37) + `<path d="M3 10h14M10 2.8c-2.4 2.2-2.4 12.2 0 14.4M10 2.8c2.4 2.2 2.4 12.2 0 14.4"/>`),
  skip: () => svg(ring(41) + `<path d="M6.4 13.6l7.2-7.2"/>`, "is-soft"),
};

function issueIcon(it: Issue) {
  if (it.state === "open") return ICON.issueOpen();
  return it.reason === "not_planned" || it.reason === "duplicate" ? ICON.issueNot() : ICON.issueDone();
}
function prIcon(p: PR) {
  if (p.state === "merged") return ICON.prMerged();
  if (p.state === "closed") return ICON.prClosed();
  return p.draft ? ICON.prDraft() : ICON.prOpen();
}
function pill(kind: "open" | "draft" | "merged" | "closed", text: string, icon: string) {
  return `<span class="ghp-pill ghp-pill--${kind}">${icon}${esc(text)}</span>`;
}

/* a run's status in one spot: the final mark, plus the queued and spinning
 * marks that the animation shows first. part "k/n" finishes k-th of n. */
function runMark(run: Run, ok: boolean, part = "", skipped = false): string {
  return `<span class="ghp-st" data-run-id="${run.id}"${part ? ` data-part="${part}"` : ""}><span class="ghp-st__q">${ICON.queued()}</span><span class="ghp-st__r">${ICON.spin()}</span><span class="ghp-st__f">${skipped ? ICON.skip() : ok ? ICON.ok() : ICON.bad()}</span></span>`;
}
function runWord(run: Run, done: string): string {
  return `<span class="ghp-ph" data-run-id="${run.id}"><span class="ghp-st__q">Queued</span><span class="ghp-st__r">In progress</span><span class="ghp-st__f">${esc(done)}</span></span>`;
}

/* ------------------------------------------------------------ world reads */

const issuesOf = (w: World) => w.issues ?? [];
const runsOf = (w: World) => [...(w.runs ?? [])].sort((a, b) => b.id - a.id);
const latestRunFor = (w: World, pr: number) => runsOf(w).find((r) => r.pr === pr);
const commitMsg = (w: World, id: string) => w.commits[id]?.msg.split("\n")[0] ?? "";
const runTitle = (w: World, r: Run) => r.title || commitMsg(w, r.commit) || r.workflow;
const runNum = (r: Run) => r.number ?? r.id;
const branchHtml = (o: GhOpts, b: string) => `<b class="ghp-br" style="--c:${o.colorOf(b)}">${esc(b)}</b>`;

function mergeBaseOf(w: World, a: string, b: string): string | undefined {
  const A = G.ancestors(w, a);
  return [...G.ancestors(w, b)].filter((id) => A.has(id)).map((id) => w.commits[id]).sort((x, y) => y.n - x.n)[0]?.id;
}

/* what a pull request changes: the commit it starts from and the one it ends at */
function prRange(w: World, p: PR): { from?: string; to?: string; tip?: string } {
  const gh = w.repos.github;
  if (p.state === "merged" && p.mergeCommit && w.commits[p.mergeCommit]) {
    const m = w.commits[p.mergeCommit];
    if (m.parents.length > 1) return { from: mergeBaseOf(w, m.parents[0], m.parents[1]), to: m.parents[1], tip: m.parents[1] };
    // squashed: one new commit on the base; reviews of the branch's last commit are the current ones
    return { from: m.parents[0], to: m.id, tip: p.headCommit };
  }
  const to = gh?.branches[p.head], base = gh?.branches[p.base];
  if (!to || !base) return {};
  return { from: mergeBaseOf(w, base, to), to, tip: to };
}

/* each person's latest word on a pull request: waiting, approved, changes or commented */
type RevState = "waiting" | Review["state"];
function reviewerStates(p: PR): { who: string; state: RevState }[] {
  const out = new Map<string, RevState>();
  for (const r of p.reviews ?? []) {
    const k = person(r.who).key;
    // a plain comment never undoes an approval or a request for changes
    if (r.state !== "commented" || !out.has(k) || out.get(k) === "commented") out.set(k, r.state);
  }
  for (const who of p.reviewers ?? []) out.set(person(who).key, "waiting");
  return [...out].map(([who, state]) => ({ who, state }));
}
const REV_WORD: Record<RevState, string> = { waiting: "waiting", approved: "approved", changes_requested: "changes requested", commented: "commented" };

/* why a pull request can't merge yet: a draft, files that clash, and what
 * the branch rules ask for (the model's mergeBlockers, in GitHub's words) */
function blockersOf(w: World, p: PR, o: GhOpts): string[] {
  const out: string[] = [];
  if (p.draft) out.push("It is still a draft");
  const clash = G.prConflicts(w, p.n);
  if (clash.length) out.push(`This branch has conflicts in ${clash.join(", ")}`);
  return [...out, ...(o.mergeBlockers ?? G.mergeBlockers)(w, p.n)];
}

/* ------------------------------------------------------------ tabs */

const TAB_LABEL: Record<GhTab, string> = { code: "Code", issues: "Issues", pulls: "Pull requests", actions: "Actions", settings: "Settings" };
const TAB_ICON: Record<GhTab, () => string> = { code: ICON.code, issues: ICON.issueOpen, pulls: ICON.prOpen, actions: ICON.play, settings: ICON.gear };

function tabsHtml(w: World, tab: GhTab): string {
  const count: Partial<Record<GhTab, number>> = {
    issues: issuesOf(w).filter((i) => i.state === "open").length,
    pulls: w.prs.filter((p) => p.state === "open").length,
  };
  return GH_TABS.map((t) => {
    const n = count[t] ?? 0;
    return `<button type="button" class="ghp-tab" role="tab" data-gh-tab="${t}" aria-selected="${t === tab}" tabindex="${t === tab ? 0 : -1}">${TAB_ICON[t]().replace(/ is-[a-z]+"/, '"')}<span>${TAB_LABEL[t]}</span>${n ? `<span class="ghp-count">${n}</span>` : ""}</button>`;
  }).join("");
}

const backHtml = (tab: GhTab) => `<button type="button" class="ghp-back" data-gh-tab="${tab}"><span aria-hidden="true">←</span> ${TAB_LABEL[tab]}</button>`;
const empty = (text: string) => `<p class="ghp-empty">${esc(text)}</p>`;

/* ------------------------------------------------------------ Code */

type Dir = { dirs: Map<string, Dir>; files: string[] };
function treeOfPaths(paths: string[]): Dir {
  const root: Dir = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let d = root;
    for (const seg of parts.slice(0, -1)) {
      if (!d.dirs.has(seg)) d.dirs.set(seg, { dirs: new Map(), files: [] });
      d = d.dirs.get(seg)!;
    }
    d.files.push(p);
  }
  return root;
}
function dirHtml(d: Dir): string {
  const rows: string[] = [];
  for (const [name0, sub0] of [...d.dirs].sort(([a], [b]) => a.localeCompare(b))) {
    // a folder holding just one folder reads as one path, the way GitHub shows .github/workflows
    let name = name0, sub = sub0;
    while (!sub.files.length && sub.dirs.size === 1) { const [n, s] = [...sub.dirs][0]; name += "/" + n; sub = s; }
    rows.push(`<li class="ghp-tree__dir"><span class="ghp-tree__name"><span class="folder" aria-hidden="true"></span>${esc(name)}</span><ul class="ghp-tree">${dirHtml(sub)}</ul></li>`);
  }
  for (const p of [...d.files].sort()) {
    rows.push(`<li class="ghp-tree__file">${ICON.file()}<button type="button" class="fname" data-file="${esc(p)}" data-place="github" data-desk="0">${esc(p.split("/").pop()!)}</button></li>`);
  }
  return rows.join("");
}

function codeHtml(w: World, o: GhOpts): string {
  const gh = w.repos.github;
  const mainId = gh?.branches.main;
  if (!gh || !mainId) return `<div class="ghp-card">${empty("Nothing here yet")}</div>`;
  const head = w.commits[mainId];
  const run = runsOf(w).find((r) => r.commit === mainId);
  const bs = Object.keys(gh.branches).sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)));
  return `<div class="ghp-card ghp-code">
    ${w.pages ? `<p class="ghp-live">${ICON.live()}<span><span>Live at</span> <code>${esc(w.pages.url.replace(/^https?:\/\//, ""))}</code></span></p>` : ""}
    <p class="ghp-commit">${av(head.author)}<span class="ghp-commit__msg">${esc(commitMsg(w, mainId))}</span><code>${G.short(mainId)}</code>${run ? runMark(run, run.ok) : ""}</p>
    <p class="ghp-h5">${bs.length > 1 ? `${bs.length} branches` : "1 branch"}</p>
    <ul class="branches">${bs.map((b) => `<li><span class="dot" style="background:${o.colorOf(b)}"></span>${esc(b)}</li>`).join("")}</ul>
    <p class="ghp-h5">Files</p>
    <ul class="ghp-tree ghp-tree--top">${dirHtml(treeOfPaths(Object.keys(G.treeOf(w, mainId))))}</ul>
  </div>`;
}

/* ------------------------------------------------------------ Issues */

function listHead(kind: "issues" | "pulls", openN: number, closedN: number, filter: "open" | "closed"): string {
  const btn = (f: "open" | "closed", n: number, icon: string, word: string) =>
    `<button type="button" class="ghp-filter" data-gh-filter="${kind}:${f}" aria-pressed="${filter === f}">${icon}${n} ${word}</button>`;
  const closedIcon = kind === "issues" ? ICON.issueDone() : ICON.prMerged();
  return `<div class="ghp-list__head">${btn("open", openN, kind === "issues" ? ICON.issueOpen() : ICON.prOpen(), "Open")}${btn("closed", closedN, closedIcon, "Closed")}</div>`;
}

function closedHow(it: Issue): string {
  if (it.reason === "not_planned") return "closed as not planned";
  if (it.reason === "duplicate") return "closed as a duplicate";
  if (it.closedBy) return `closed by #${it.closedBy}`;
  return "closed";
}

function commentCount(n: number): string {
  return n ? `<span class="ghp-cc" aria-label="${plural(n, "comment")}">${ICON.comment()}${n}</span>` : "";
}

function issueRow(w: World, it: Issue): string {
  const meta = it.state === "open"
    ? `#${it.n} opened by ${esc(person(it.author).name)}`
    : `#${it.n} by ${esc(person(it.author).name)}, ${closedHow(it)}`;
  return `<li><button type="button" class="ghp-row" data-gh-issue="${it.n}">
    <span class="ghp-row__ico">${issueIcon(it)}</span>
    <span class="ghp-row__main"><span class="ghp-row__title">${esc(it.title)}</span>${labelsHtml(w, it.labels)}</span>
    <span class="ghp-row__meta">${meta}</span>
    <span class="ghp-row__side">${avStack(it.assignees, "Assigned to")}${commentCount(it.comments.length)}</span>
  </button></li>`;
}

function issuesHtml(w: World, o: GhOpts): string {
  const all = issuesOf(w);
  const open = o.openIssue != null ? all.find((i) => i.n === o.openIssue) : undefined;
  if (open) return issueDetail(w, open);
  if (!all.length) return `<div class="ghp-list">${empty("No issues yet")}</div>`;
  const filter = o.issueFilter ?? "open";
  const shown = all.filter((i) => i.state === filter).sort((a, b) => b.n - a.n);
  return `<div class="ghp-list">${listHead("issues", all.filter((i) => i.state === "open").length, all.filter((i) => i.state === "closed").length, filter)}
    ${shown.length ? `<ul class="ghp-rows">${shown.map((i) => issueRow(w, i)).join("")}</ul>` : empty(filter === "open" ? "No open issues" : "No closed issues")}</div>`;
}

function noteHtml(w: World, n: Note, verb = "commented"): string {
  return `<div class="ghp-note">${av(n.who, true)}<div class="ghp-note__box" style="--who:${person(n.who).color}">
    <p class="ghp-note__head">${nameHtml(n.who)} ${esc(verb)}</p><p class="ghp-note__text">${textHtml(w, n.text)}</p></div></div>`;
}

function sideBox(title: string, body: string): string {
  return `<div class="ghp-side__box"><p class="ghp-h5">${esc(title)}</p>${body}</div>`;
}
function peopleList(logins: string[]): string {
  return logins.length
    ? `<ul class="ghp-people">${logins.map((l) => `<li>${av(l)}${esc(person(l).name)}</li>`).join("")}</ul>`
    : `<p class="ghp-none">No one</p>`;
}
const labelsBox = (w: World, names: string[] | undefined) =>
  sideBox("Labels", names?.length ? labelsHtml(w, names) : `<p class="ghp-none">None</p>`);

function issueDetail(w: World, it: Issue): string {
  const prs = w.prs.filter((p) => p.closes?.includes(it.n));
  const state = it.state === "open"
    ? pill("open", "Open", ICON.issueOpen())
    : it.reason === "not_planned" || it.reason === "duplicate" ? pill("draft", "Closed", ICON.issueNot()) : pill("merged", "Closed", ICON.issueDone());
  let closing = "";
  if (it.state === "closed") {
    const by = it.closedBy ? w.prs.find((p) => p.n === it.closedBy) : undefined;
    closing = `<p class="ghp-event">${issueIcon(it)}<span>${
      it.reason === "not_planned" ? "Closed as not planned"
      : it.reason === "duplicate" ? "Closed as a duplicate"
      : by ? `Closed by <button type="button" class="ghp-ref" data-gh-pr="${by.n}">#${by.n}</button> ${esc(by.title)}`
      : it.closedBy ? `Closed by #${it.closedBy}` : "Closed"}</span></p>`;
  }
  return `<article class="ghp-detail">
    ${backHtml("issues")}
    <h4 class="ghp-detail__title">${esc(it.title)} <span>#${it.n}</span></h4>
    <p class="ghp-detail__state">${state}<span>${nameHtml(it.author)} opened this${it.comments.length ? ` · ${plural(it.comments.length, "comment")}` : ""}</span></p>
    <div class="ghp-detail__grid">
      <div class="ghp-thread">
        ${noteHtml(w, { who: it.author, text: it.body || "No description." }, "wrote")}
        ${it.comments.map((c) => noteHtml(w, c)).join("")}
        ${closing}
      </div>
      <aside class="ghp-side">
        ${sideBox("Assignees", peopleList(it.assignees))}
        ${labelsBox(w, it.labels)}
        ${prs.length ? sideBox("Pull requests", `<ul class="ghp-links">${prs.map((p) => `<li><button type="button" class="ghp-ref ghp-ref--row" data-gh-pr="${p.n}">${prIcon(p)}#${p.n} ${esc(p.title)}</button></li>`).join("")}</ul>`) : ""}
      </aside>
    </div>
  </article>`;
}

/* ------------------------------------------------------------ Pull requests */

function prStatus(p: PR): string {
  if (p.state !== "open") return "";
  const s = reviewerStates(p);
  if (s.some((x) => x.state === "changes_requested")) return `<span class="ghp-tag ghp-tag--bad">Changes requested</span>`;
  if (s.some((x) => x.state === "waiting")) return `<span class="ghp-tag">Review requested</span>`;
  if (s.some((x) => x.state === "approved")) return `<span class="ghp-tag ghp-tag--ok">Approved</span>`;
  return "";
}

function prRow(w: World, p: PR): string {
  const run = latestRunFor(w, p.n);
  const who = esc(person(p.author).name);
  const meta = p.state === "open" ? `#${p.n} opened by ${who}` : `#${p.n} by ${who}, ${p.state === "merged" ? "merged" : "closed"}`;
  const talk = p.comments.length + (p.reviews ?? []).reduce((k, r) => k + (r.text ? 1 : 0) + r.notes.length, 0);
  return `<li><button type="button" class="ghp-row" data-gh-pr="${p.n}">
    <span class="ghp-row__ico">${prIcon(p)}</span>
    <span class="ghp-row__main"><span class="ghp-row__title">${esc(p.title)}</span>${run ? runMark(run, run.ok) : ""}${p.draft && p.state === "open" ? `<span class="ghp-tag">Draft</span>` : ""}${labelsHtml(w, p.labels)}</span>
    <span class="ghp-row__meta">${meta}${prStatus(p)}</span>
    <span class="ghp-row__side">${avStack(p.assignees ?? [], "Assigned to")}${commentCount(talk)}</span>
  </button></li>`;
}

function pullsHtml(w: World, o: GhOpts): string {
  const open = o.openPr != null ? w.prs.find((p) => p.n === o.openPr) : undefined;
  if (open) return prDetail(w, open, o);
  if (!w.prs.length) return `<div class="ghp-list">${empty("No pull requests yet")}</div>`;
  const filter = o.prFilter ?? "open";
  const shown = w.prs.filter((p) => (filter === "open") === (p.state === "open")).sort((a, b) => b.n - a.n);
  return `<div class="ghp-list">${listHead("pulls", w.prs.filter((p) => p.state === "open").length, w.prs.filter((p) => p.state !== "open").length, filter)}
    ${shown.length ? `<ul class="ghp-rows">${shown.map((p) => prRow(w, p)).join("")}</ul>` : empty(filter === "open" ? "No open pull requests" : "No closed pull requests")}</div>`;
}

/* the diff, a few lines of context around each change, with review notes
 * under the line they are about. A note's line is its line number in the
 * file as the reviewer saw it (the new side). */
type Placed = { note: Note; verb?: string };
function diffHtml(w: World, from: string | undefined, to: string | undefined, notes: Placed[], placed: Set<Note>): string {
  const a = G.treeOf(w, from), b = G.treeOf(w, to);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]).sort();
  if (!paths.length) return `<div class="pr__diff"><div class="dl dl--ctx">No changes</div></div>`;
  return paths.map((path) => {
    const rows = G.lineDiff(a[path], b[path]);
    const lineOf: (number | null)[] = [];
    let k = 0;
    for (const r of rows) lineOf.push(r.t === "-" ? null : ++k);
    const here = notes.filter((x) => x.note.file === path && x.note.line != null && x.note.line >= 1 && x.note.line <= k);
    const show = new Set<number>();
    rows.forEach((r, i) => { if (r.t !== " ") for (let j = i - 2; j <= i + 2; j++) show.add(j); });
    here.forEach((x) => show.add(lineOf.indexOf(x.note.line!)));
    // a blank context line at the edge of a hunk is only air
    for (let pass = 0; pass < 2; pass++) rows.forEach((r, i) => {
      if (r.t === " " && !r.s.trim() && show.has(i) && (!show.has(i - 1) || !show.has(i + 1))) show.delete(i);
    });
    let out = "", gap = false;
    rows.forEach((r, i) => {
      if (!show.has(i)) { gap = true; return; }
      if (gap && out) out += `<div class="dl dl--gap" aria-hidden="true">⋯</div>`;
      gap = false;
      const cls = r.t === "+" ? "dl--add" : r.t === "-" ? "dl--del" : "dl--ctx";
      out += `<div class="dl ${cls}">${r.t === " " ? " " : r.t} ${esc(r.s) || " "}</div>`;
      if (lineOf[i] != null) for (const x of here.filter((y) => y.note.line === lineOf[i])) {
        placed.add(x.note);
        out += `<div class="ghp-lnote" style="--who:${person(x.note.who).color}">${av(x.note.who)}<p>${nameHtml(x.note.who)} ${textHtml(w, x.note.text)}</p></div>`;
      }
    });
    return `<div class="pr__diff"><p class="pr__file">${esc(path)}</p>${out}</div>`;
  }).join("");
}

const REVIEW_VERB: Record<Review["state"], string> = { approved: "approved these changes", changes_requested: "asked for changes", commented: "left a review" };
function reviewHtml(w: World, r: Review, placed: Set<Note>, outdated: boolean): string {
  const icon = r.state === "approved" ? ICON.ok() : r.state === "changes_requested" ? ICON.changes() : ICON.comment();
  const loose = r.notes.filter((n) => !placed.has(n));
  return `<div class="ghp-review ghp-review--${r.state}">
    <p class="ghp-review__head">${icon}${av(r.who)}<span>${nameHtml(r.who)} ${REVIEW_VERB[r.state]}</span></p>
    ${r.text ? `<p class="ghp-note__text">${textHtml(w, r.text)}</p>` : ""}
    ${loose.map((n) => `<div class="ghp-lnote ghp-lnote--loose" style="--who:${person(n.who).color}"><p><span class="ghp-where">${esc(n.file ?? "")}${n.line ? `, line ${n.line}` : ""}</span>${outdated ? `<span class="ghp-tag">Outdated</span>` : ""}</p><p>${textHtml(w, n.text)}</p></div>`).join("")}
  </div>`;
}

function checksHtml(w: World, p: PR): string {
  const run = latestRunFor(w, p.n);
  if (!run) return "";
  const bad = run.jobs.filter((j) => !j.ok && !j.skipped).length;
  return `<section class="ghp-box">
    <p class="ghp-box__head">${runMark(run, run.ok)}<b>Checks</b>${runWord(run, bad ? `${bad} failed` : "All passed")}</p>
    <ul class="ghp-jobs">${run.jobs.map((j) => `<li><button type="button" class="ghp-job-link" data-gh-run="${run.id}">${runMark(run, j.ok, "", j.skipped)}<span><b>${esc(j.name)}</b> <span class="ghp-soft">· ${esc(run.workflow)}</span></span></button></li>`).join("")}</ul>
  </section>`;
}

const METHOD_WORD = { merge: "Merged", squash: "Squashed and merged", rebase: "Rebased and merged" } as const;
function mergeBoxHtml(w: World, p: PR, o: GhOpts): string {
  if (p.state === "merged") {
    return `<section class="ghp-merge ghp-merge--merged">${ICON.prMerged()}<div><b>${METHOD_WORD[p.method ?? "merge"]}</b>
      ${p.branchDeleted ? `<p>Branch ${branchHtml(o, p.head)} deleted</p>` : ""}</div></section>`;
  }
  if (p.state === "closed") {
    return `<section class="ghp-merge ghp-merge--closed">${ICON.prClosed()}<div><b>Closed without merging</b>
      ${p.branchDeleted ? `<p>Branch ${branchHtml(o, p.head)} deleted</p>` : ""}</div></section>`;
  }
  const blockers = blockersOf(w, p, o);
  if (blockers.length) {
    return `<section class="ghp-merge ghp-merge--blocked">${ICON.bad()}<div><b>Merging is blocked</b>
      <ul class="ghp-reasons">${blockers.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div></section>`;
  }
  // like GitHub: a review asking for changes shows first; merging still works
  const asked = reviewerStates(p).filter((s) => s.state === "changes_requested").map((s) => person(s.who).name);
  if (asked.length) {
    return `<section class="ghp-merge ghp-merge--blocked">${ICON.bad()}<div><b>Changes requested</b>
      <ul class="ghp-reasons"><li>${esc(asked.join(" and "))} requested changes</li></ul></div></section>`;
  }
  const ok: string[] = [];
  const approvers = reviewerStates(p).filter((s) => s.state === "approved").map((s) => person(s.who).name);
  if (approvers.length) ok.push(`Approved by ${approvers.join(" and ")}`);
  const okList = ok.length ? `<ul class="ghp-reasons ghp-reasons--ok">${ok.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "";
  // like GitHub: a red check that no rule requires still leaves merging open
  const run = latestRunFor(w, p.n);
  const bad = run && !run.ok ? run.jobs.filter((j) => !j.ok && !j.skipped).length : 0;
  if (bad) {
    ok.push("No conflicts with the base branch");
    return `<section class="ghp-merge ghp-merge--blocked">${ICON.bad()}<div><b>Some checks were not successful</b>
      <ul class="ghp-reasons"><li>${bad} failing check${bad > 1 ? "s" : ""}</li></ul>
      <ul class="ghp-reasons ghp-reasons--ok">${ok.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div></section>`;
  }
  return `<section class="ghp-merge ghp-merge--ok">${ICON.ok()}<div><b>${run?.ok ? "All checks have passed" : "Ready to merge"}</b>
    ${okList}</div></section>`;
}

function prDetail(w: World, p: PR, o: GhOpts): string {
  const { from, to, tip } = prRange(w, p);
  const reviews = p.reviews ?? [];
  // notes from reviews of the newest commit, and line comments, sit on the diff
  const current = (r: Review) => !tip || r.commit === tip;
  const onDiff: Placed[] = [
    ...reviews.filter(current).flatMap((r) => r.notes.map((note) => ({ note }))),
    ...p.comments.filter((c) => c.file).map((note) => ({ note })),
  ];
  const placed = new Set<Note>();
  const diff = to ? diffHtml(w, from, to, onDiff, placed) : `<div class="pr__diff"><div class="dl dl--ctx">The branch is gone</div></div>`;
  const state = p.state === "merged" ? pill("merged", "Merged", ICON.prMerged())
    : p.state === "closed" ? pill("closed", "Closed", ICON.prClosed())
    : p.draft ? pill("draft", "Draft", ICON.prDraft()) : pill("open", "Open", ICON.prOpen());
  const line = p.state === "merged"
    ? `${branchHtml(o, p.head)} went into ${branchHtml(o, p.base)}`
    : p.state === "closed"
      ? `${nameHtml(p.author)} wanted to merge ${branchHtml(o, p.head)} into ${branchHtml(o, p.base)}`
      : `${nameHtml(p.author)} ${verbS(p.author, "want")} to merge ${branchHtml(o, p.head)} into ${branchHtml(o, p.base)}`;
  const revs = reviewerStates(p);
  return `<article class="ghp-detail">
    ${backHtml("pulls")}
    <h4 class="ghp-detail__title">${esc(p.title)} <span>#${p.n}</span></h4>
    <p class="ghp-detail__state">${state}<span>${line}</span></p>
    <div class="ghp-detail__grid">
      <div class="ghp-thread">
        ${p.body ? noteHtml(w, { who: p.author, text: p.body }, "wrote") : ""}
        ${diff}
        ${reviews.map((r) => reviewHtml(w, r, placed, !current(r))).join("")}
        ${p.comments.filter((c) => !c.file || !placed.has(c)).map((c) => noteHtml(w, c)).join("")}
        ${checksHtml(w, p)}
        ${mergeBoxHtml(w, p, o)}
      </div>
      <aside class="ghp-side">
        ${sideBox("Reviewers", revs.length
          ? `<ul class="ghp-people">${revs.map((r) => `<li>${av(r.who)}${esc(person(r.who).name)}<span class="ghp-rev ghp-rev--${r.state}">${REV_WORD[r.state]}</span></li>`).join("")}</ul>`
          : `<p class="ghp-none">No one</p>`)}
        ${sideBox("Assignees", peopleList(p.assignees ?? []))}
        ${labelsBox(w, p.labels)}
        ${p.closes?.length ? sideBox("Closes", `<ul class="ghp-links">${p.closes.map((n) => {
          const it = issuesOf(w).find((i) => i.n === n);
          return `<li><button type="button" class="ghp-ref ghp-ref--row" data-gh-issue="${n}">${it ? issueIcon(it) : ""}#${n}${it ? ` ${esc(it.title)}` : ""}</button></li>`;
        }).join("")}</ul>`) : ""}
      </aside>
    </div>
  </article>`;
}

/* ------------------------------------------------------------ Actions */

const eventWords = (r: Run) => (r.event === "pull_request" ? (r.pr ? `pull request #${r.pr}` : "pull request") : "push");

function runRow(w: World, r: Run, o: GhOpts): string {
  return `<li><button type="button" class="ghp-row" data-gh-run="${r.id}">
    <span class="ghp-row__ico">${runMark(r, r.ok)}</span>
    <span class="ghp-row__main"><span class="ghp-row__title">${esc(runTitle(w, r))}</span></span>
    <span class="ghp-row__meta"><b>${esc(r.workflow)}</b> #${runNum(r)} · ${eventWords(r)} · ${branchHtml(o, r.branch)} · <code>${G.short(r.commit)}</code></span>
    <span class="ghp-row__side">${runWord(r, r.ok ? "Passed" : "Failed")}</span>
  </button></li>`;
}

function actionsHtml(w: World, o: GhOpts): string {
  const runs = runsOf(w);
  const open = o.openRun != null ? runs.find((r) => r.id === o.openRun) : undefined;
  if (open) return runDetail(w, open, o);
  if (!runs.length) return `<div class="ghp-list">${empty("No runs yet")}</div>`;
  return `<div class="ghp-list"><div class="ghp-list__head"><span class="ghp-list__title">All runs</span></div>
    <ul class="ghp-rows">${runs.map((r) => runRow(w, r, o)).join("")}</ul></div>`;
}

const ERR = /error|failed|misspell|==>|✗/i;
function runDetail(w: World, r: Run, o: GhOpts): string {
  return `<article class="ghp-detail">
    ${backHtml("actions")}
    <h4 class="ghp-detail__title ghp-detail__title--run">${runMark(r, r.ok)}<span>${esc(runTitle(w, r))} <span>#${runNum(r)}</span></span></h4>
    <p class="ghp-detail__state"><span><b>${esc(r.workflow)}</b> · ${eventWords(r)}${r.actor ? ` by ${esc(person(r.actor).name)}` : ""} · ${branchHtml(o, r.branch)} · <code>${G.short(r.commit)}</code> · <code class="ghp-path">${esc(r.file)}</code></span>${runWord(r, r.ok ? "Passed" : "Failed")}</p>
    ${r.error ? `<p class="ghp-run-err">${ICON.bad()}<span>${esc(r.error)}</span></p>` : ""}
    ${r.annotations?.length ? `<section class="ghp-box ghp-notes"><p class="ghp-box__head"><b>Annotations</b></p><ul>${r.annotations.map((a) =>
      `<li>${ICON.bad()}<span><code>${esc(a.path)}${a.line ? `:${a.line}` : ""}</code> ${esc(a.message)}</span></li>`).join("")}</ul></section>` : ""}
    ${r.jobs.map((j) => `<section class="ghp-job${j.skipped ? " is-skipped" : ""}">
      <p class="ghp-job__head">${runMark(r, j.ok, "", j.skipped)}<b>${esc(j.name)}</b>${j.skipped ? `<span class="ghp-soft">skipped</span>` : ""}</p>
      ${j.steps.length ? `<ol class="ghp-steps">${j.steps.map((s, i) => `<li><details class="ghp-step" data-run-id="${r.id}" data-part="${i}/${j.steps.length}"${s.ok ? "" : " open"}>
        <summary>${runMark(r, s.ok, `${i}/${j.steps.length}`, s.skipped)}<span${s.ok ? "" : ` class="is-bad"`}>${esc(s.name)}</span></summary>
        ${s.log.length ? `<div class="ghp-log">${s.log.map((l) => `<div${!s.ok && ERR.test(l) ? ` class="is-err"` : ""}>${esc(l) || " "}</div>`).join("")}</div>` : ""}
      </details></li>`).join("")}</ol>` : ""}
    </section>`).join("")}
    ${r.artifacts?.length ? `<p class="ghp-soft ghp-artifacts">Uploaded: ${r.artifacts.map((a) => `<code>${esc(a)}</code>`).join(", ")}</p>` : ""}
  </article>`;
}

/* ------------------------------------------------------------ Settings */

function ruleLines(r: Ruleset): string[] {
  const out: string[] = [];
  if (r.requirePR) out.push("Changes go through a pull request");
  if (r.approvals) out.push(`Needs ${plural(r.approvals, "approval")}`);
  for (const c of r.checks) out.push(`${c} must pass`);
  if (r.blockForcePush) out.push("No force pushes");
  return out;
}

function settingsHtml(w: World, o: GhOpts): string {
  const rules = w.rules ?? [];
  return `<div class="ghp-card ghp-set">
    <p class="ghp-set__title">${ICON.shield()}Rules</p>
    ${rules.length ? rules.map((r) => `<section class="ghp-rule">
      <p class="ghp-rule__head"><b>${esc(r.name)}</b><span class="ghp-soft">for</span>${branchHtml(o, r.branch)}</p>
      <ul class="ghp-rule__lines">${ruleLines(r).map((l) => `<li>${ICON.ok().replace("is-open", "is-ink")}${esc(l)}</li>`).join("")}</ul>
    </section>`).join("") : `<p class="ghp-empty ghp-empty--left">No rules yet. Anyone can push straight to main.</p>`}
  </div>`;
}

/* ------------------------------------------------------------ the page */

function panelHtml(w: World, o: GhOpts): string {
  switch (o.tab) {
    case "issues": return issuesHtml(w, o);
    case "pulls": return pullsHtml(w, o);
    case "actions": return actionsHtml(w, o);
    case "settings": return settingsHtml(w, o);
    default: return codeHtml(w, o);
  }
}

/* the whole page as one string (the fixture and static pictures use this) */
export function ghPageHtml(w: World, o: GhOpts): string {
  return `<div class="ghp" data-gh-page="${o.tab}">
    <div class="ghp__tabs" role="tablist" aria-label="GitHub">${tabsHtml(w, o.tab)}</div>
    <div class="ghp__body"><div class="ghp__panel" role="tabpanel">${panelHtml(w, o)}</div><div class="ghp__slot" data-gh-slot>${o.stripHtml ?? ""}</div></div>
  </div>`;
}

/* draw the page into host, keeping the slot (and the strip in it) alive.
 * strip: the live history strip element; it goes into the Code tab's slot on
 * wide screens and back home otherwise. instant: a first paint or a jump, so
 * runs already there count as seen and don't play. Returns true if anything
 * was redrawn. */
const lastParts = new WeakMap<HTMLElement, { tabs: string; panel: string }>();
const homes = new WeakMap<HTMLElement, HTMLElement>();
const mounted = new Map<HTMLElement, HTMLElement>(); // host -> strip, so a resize can move it
const phone = window.matchMedia("(max-width: 860px)");

export function renderGhPage(host: HTMLElement, w: World, o: GhOpts, strip?: HTMLElement | null, opts: { instant?: boolean } = {}): boolean {
  let page = host.querySelector<HTMLElement>(":scope > .ghp");
  if (!page) {
    host.innerHTML = `<div class="ghp"><div class="ghp__tabs" role="tablist" aria-label="GitHub"></div><div class="ghp__body"><div class="ghp__panel" role="tabpanel"></div><div class="ghp__slot" data-gh-slot></div></div></div>`;
    page = host.querySelector<HTMLElement>(".ghp")!;
    lastParts.delete(host);
  }
  // a run that is gone (Undo) is forgotten: run ids count up from the list's
  // length, so the run that comes back in its place plays again
  const live = new Set((w.runs ?? []).map((r) => r.id));
  for (const id of seenRuns) if (!live.has(id)) seenRuns.delete(id);
  if (opts.instant) for (const id of live) seenRuns.add(id);
  for (const h of mounted.keys()) if (!h.isConnected) mounted.delete(h);
  const tabs = tabsHtml(w, o.tab), panel = panelHtml(w, o);
  const was = lastParts.get(host);
  let changed = false;
  if (page.dataset.ghPage !== o.tab) { page.dataset.ghPage = o.tab; changed = true; }
  if (was?.tabs !== tabs) { page.querySelector(".ghp__tabs")!.innerHTML = tabs; changed = true; }
  if (was?.panel !== panel) { page.querySelector(".ghp__panel")!.innerHTML = panel; changed = true; }
  lastParts.set(host, { tabs, panel });
  const slot = page.querySelector<HTMLElement>("[data-gh-slot]")!;
  if (strip) {
    if (!homes.has(strip) && strip.parentElement && !page.contains(strip)) homes.set(strip, strip.parentElement);
    mounted.set(host, strip);
    placeStrip(host, strip);
  } else if (o.stripHtml !== undefined && slot.innerHTML !== o.stripHtml) slot.innerHTML = o.stripHtml;
  playRuns(page);
  return changed;
}

function placeStrip(host: HTMLElement, strip: HTMLElement) {
  const page = host.querySelector<HTMLElement>(":scope > .ghp");
  const slot = page?.querySelector<HTMLElement>("[data-gh-slot]");
  const into = slot && page!.dataset.ghPage === "code" && !phone.matches ? slot : homes.get(strip);
  if (into && strip.parentElement !== into) into.append(strip);
}
phone.addEventListener("change", () => mounted.forEach((strip, host) => host.isConnected && placeStrip(host, strip)));

/* leaving a GitHub track: the strip goes home and the page is cleared.
 * Safe to call on every draw; returns true only when there was a page. */
export function unmountGhPage(host: HTMLElement): boolean {
  if (!host.querySelector(":scope > .ghp")) return false;
  const strip = mounted.get(host);
  const home = strip && homes.get(strip);
  if (strip && home && strip.parentElement !== home) home.append(strip);
  mounted.delete(host);
  lastParts.delete(host);
  host.innerHTML = "";
  return true;
}

/* one listener for the whole page, on an element that is never replaced
 * (main.ts: #world). onState gets what changed; merge it into the state and
 * draw again. */
export function wireGhPage(root: HTMLElement, onState: (patch: Partial<GhState>) => void) {
  const shut = { openIssue: null, openPr: null, openRun: null };
  let turned = -1e9; // when the page last changed under the pointer
  // a double click opens on the first click; the second lands on the new
  // view (or past it, when the page got shorter) and must not select a word
  document.addEventListener("mousedown", (e) => {
    if (e.detail > 1 && performance.now() - turned < 700) { e.preventDefault(); try { getSelection()?.removeAllRanges(); } catch { /* none */ } }
  });
  root.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-gh-tab],[data-gh-issue],[data-gh-pr],[data-gh-run],[data-gh-filter]");
    if (!t || !root.contains(t)) return;
    turned = performance.now();
    const d = t.dataset;
    if (d.ghTab) onState({ tab: d.ghTab as GhTab, ...shut });
    else if (d.ghIssue) onState({ tab: "issues", ...shut, openIssue: Number(d.ghIssue) });
    else if (d.ghPr) onState({ tab: "pulls", ...shut, openPr: Number(d.ghPr) });
    else if (d.ghRun) onState({ tab: "actions", ...shut, openRun: Number(d.ghRun) });
    else if (d.ghFilter) {
      const [k, v] = d.ghFilter.split(":") as ["issues" | "pulls", "open" | "closed"];
      onState(k === "issues" ? { issueFilter: v } : { prFilter: v });
    }
    // opening something long from far down a list: bring its top into view
    const page = t.closest(".ghp") ?? root.querySelector(".ghp");
    if (page && !d.ghFilter) requestAnimationFrame(() => {
      const bar = document.querySelector(".top")?.getBoundingClientRect().bottom ?? 0;
      if (page.getBoundingClientRect().top < bar) page.scrollIntoView({ block: "start", behavior: prefersReduced ? "auto" : "smooth" });
    });
  });
  // arrow keys move along the tabs, as in any tab list
  root.addEventListener("keydown", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".ghp-tab");
    if (!t || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const i = GH_TABS.indexOf(t.dataset.ghTab as GhTab);
    const next = GH_TABS[(i + (e.key === "ArrowRight" ? 1 : GH_TABS.length - 1)) % GH_TABS.length];
    e.preventDefault();
    onState({ tab: next, ...shut });
    requestAnimationFrame(() => root.querySelector<HTMLElement>(`.ghp-tab[data-gh-tab="${next}"]`)?.focus());
  });
}

/* ------------------------------------------------------------ which tab
 * A beat can name its tab (ghTab). Otherwise the page turns to where the
 * newest change happened, and opens the thing that changed. */

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* prefer: the beat's tab. One action can change a pull request and an issue
 * at once (a merge that closes an issue); the beat's tab says which to open. */
export function changedTab(before: World, after: World, prefer?: GhTab): Partial<GhState> | null {
  if (!same(before.rules, after.rules)) return { tab: "settings" };
  const oldRuns = new Set((before.runs ?? []).map((r) => r.id));
  const fresh = (after.runs ?? []).filter((r) => !oldRuns.has(r.id)).sort((a, b) => b.id - a.id);
  if (fresh.length) return { tab: "actions", openRun: fresh[0].id };
  const pr = [...after.prs].sort((a, b) => b.n - a.n).find((p) => !same(p, before.prs.find((q) => q.n === p.n)));
  const it = [...issuesOf(after)].sort((a, b) => b.n - a.n).find((i) => !same(i, issuesOf(before).find((q) => q.n === i.n)));
  if (it && prefer === "issues") return { tab: "issues", openIssue: it.n };
  if (pr) return { tab: "pulls", openPr: pr.n };
  if (it) return { tab: "issues", openIssue: it.n };
  if (issuesOf(after).length < issuesOf(before).length) return { tab: "issues", openIssue: null };
  if (!same(before.labels, after.labels)) return { tab: "issues", openIssue: null };
  if (!same(before.pages, after.pages) || !same(before.repos.github?.branches, after.repos.github?.branches)) return { tab: "code" };
  return null;
}

/* a tab and the thing to open on it when you arrive at a step (story.ts) */
export interface GhView { tab: GhTab; pr?: number; issue?: number; run?: number }

/* the state to draw next. cur: the state now; before: the world before the
 * last action (null when arriving at a beat); beatTab: the beat's ghTab, a
 * tab or a view worked out from the world (a pull request to open, a run). */
export function nextGhState(cur: GhState, before: World | null, after: World, beatTab?: GhTab | ((w: World) => GhView)): GhState {
  const view = typeof beatTab === "function" ? beatTab(after) : beatTab ? { tab: beatTab } as GhView : undefined;
  const tab = view?.tab;
  const ch = before ? changedTab(before, after, tab) : null;
  const shut = { openIssue: null, openPr: null, openRun: null };
  // arriving at a step that names what to open: open it, whatever was open before
  const opens = !before && !!view && (view.pr != null || view.issue != null || view.run != null);
  let next: GhState = cur;
  if (tab) {
    next = ch?.tab === tab ? { ...cur, ...shut, ...ch }
      : opens ? { ...cur, tab, openPr: view!.pr ?? null, openIssue: view!.issue ?? null, openRun: view!.run ?? null }
      : cur.tab === tab ? cur : { ...cur, ...shut, tab };
  }
  else if (ch) next = { ...cur, ...shut, ...ch };
  // something that was open and is gone now (an undo) shows its list instead
  if (next.openIssue != null && !issuesOf(after).some((i) => i.n === next.openIssue)) next = { ...next, openIssue: null };
  if (next.openPr != null && !after.prs.some((p) => p.n === next.openPr)) next = { ...next, openPr: null };
  if (next.openRun != null && !(after.runs ?? []).some((r) => r.id === next.openRun)) next = { ...next, openRun: null };
  // an opened issue or pull request shows even if the filter hid it
  if (next.openIssue != null) { const st = issuesOf(after).find((i) => i.n === next.openIssue)!.state; if (st !== (next.issueFilter ?? "open")) next = { ...next, issueFilter: st }; }
  if (next.openPr != null) { const st = after.prs.find((p) => p.n === next.openPr)!.state === "open" ? "open" : "closed"; if (st !== (next.prFilter ?? "open")) next = { ...next, prFilter: st }; }
  return next;
}

/* ------------------------------------------------------------ runs, live
 * Queued for a moment, then in progress (steps finish one by one), then the
 * result. One rAF loop, one clock. Each run plays once, the first time any
 * part of it is drawn. */

const seenRuns = new Set<number>();
const playing = new Map<number, number>(); // run id -> start time
const QUEUED = 650, RUNNING = 1850;
let raf = 0;

function phaseOf(t0: number, now: number, part?: string): "queued" | "running" | "done" {
  const e = now - t0;
  if (e < QUEUED) return "queued";
  if (!part) return e < QUEUED + RUNNING ? "running" : "done";
  const [k, n] = part.split("/").map(Number);
  if (e < QUEUED + (RUNNING * k) / n) return "queued";
  return e < QUEUED + (RUNNING * (k + 1)) / n ? "running" : "done";
}

function apply(now: number) {
  for (const [id, t0] of playing) {
    document.querySelectorAll<HTMLElement>(`[data-run-id="${id}"]`).forEach((el) => {
      const ph = phaseOf(t0, now, el.dataset.part);
      if (el.dataset.phase !== ph) el.dataset.phase = ph;
    });
    if (now - t0 >= QUEUED + RUNNING) playing.delete(id);
  }
}
function loop() {
  apply(performance.now());
  raf = playing.size ? requestAnimationFrame(loop) : 0;
}

function playRuns(page: HTMLElement) {
  const now = performance.now();
  page.querySelectorAll<HTMLElement>("[data-run-id]").forEach((el) => {
    const id = Number(el.dataset.runId);
    if (seenRuns.has(id)) return;
    seenRuns.add(id);
    if (!prefersReduced) playing.set(id, now);
  });
  if (!playing.size) return;
  apply(now); // the first phase goes on now, so the result never flashes first
  if (!raf) raf = requestAnimationFrame(loop);
}

/* forget which runs played (a full restart of the lesson) */
export function resetGhRuns() { seenRuns.clear(); playing.clear(); cancelAnimationFrame(raf); raf = 0; }
