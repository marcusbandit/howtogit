/* main.ts: the page. Lesson card on one side, the world on the other.
 *
 * The world is the three places git lives in this story: GitHub (the shared
 * copy online), your computer, and Albert's computer. Every place shows its
 * folder(s) and its line of saved versions, with one column per commit across
 * all places, so you can see at a glance who has which version.
 *
 * The world is updated in place: only the parts that changed are replaced,
 * and the change itself gets the motion (files fly into a new commit, dots
 * travel between places on push and pull), never the whole panel.
 */
import * as G from "./model.js";
import type { World } from "./model.js";
import { chapters, MAIN_FILE, choices, choiceKey, valueFor, type Act, type Beat, type Who } from "./story.js";
import { exec, replayTo, finishBeat } from "./engine.js";
import { showIntro, introSeen, whyGithub } from "./intro.js";
import { explain } from "./explain.js";
import { circlePath, linePath, smooth, drawOn, el, prefersReduced, type Point } from "./sketch.js";

type Mode = "buttons" | "command" | "ai";
type Place = "github" | "you" | "albert";
interface LogLine { kind: "cmd" | "out" | "err" | "note" | "ai" | "me" | "coach"; text: string; who?: Who; cmds?: string[]; act?: number; ok?: boolean; good?: boolean }
interface Snap { ci: number; bi: number; w: string; log: string; beatDone: boolean }

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* a quiet "explain" next to a command. It opens one shared panel beside the
 * lesson (a sheet from the bottom on phones): the command written large with
 * each part underlined and labelled, then what each part means and other ways
 * to write it. */
const tokClass = (kind: string, t: string) => kind === "program" ? "tk-prog" : kind === "command" ? "tk-sub" : kind === "flag" ? "tk-flag"
  : /^["']/.test(t) ? "tk-str" : /:\/\/|^\.\.?\/|github\.com/.test(t) ? "tk-url" : "tk-arg";
function explainHtml(cmd: string): string {
  const e = explain(cmd);
  if (!e || e.parts.length < 2) return "";
  return `<button type="button" class="explain" data-explain="${esc(cmd).replace(/"/g, "&quot;")}" aria-haspopup="dialog">explain</button>`;
}
function explainPanelHtml(cmd: string): string {
  const e = explain(cmd)!;
  return `
    <div class="xp__cmd" aria-label="${esc(cmd).replace(/"/g, "&quot;")}">${e.parts.map((p) =>
      `<span class="xp__part xp__part--${p.kind}"><code class="${tokClass(p.kind, p.t)}">${esc(p.t)}</code><i>${p.kind}</i></span>`).join("")}</div>
    <div class="xp__cols">
      <section class="xp__col">
        <h4>What each part means</h4>
        <dl class="xp__list">${e.parts.map((p) => `<div><dt><code class="${tokClass(p.kind, p.t)}">${esc(p.t)}</code></dt><dd>${esc(p.means)}</dd></div>`).join("")}</dl>
      </section>
      <section class="xp__col">
        ${e.also.length ? `<h4>Other ways to write it</h4>
        <dl class="xp__list xp__list--also">${e.also.map((a) => `<div><dt><code>${a.cmd.startsWith("git") || a.cmd.startsWith("gh") ? hl(a.cmd) : esc(a.cmd)}</code></dt><dd>${esc(a.means)}</dd></div>`).join("")}</dl>` : ""}
        ${e.flags ? `<p class="xp__note">A <b>flag</b> starts with a dash and changes how a command behaves. One dash is the short form (<code>-m</code>), two dashes the long one (<code>--message</code>). Some flags take a <b>value</b> right after them.</p>` : ""}
        ${e.docs ? `<a class="xp__more" href="${esc(e.docs)}" target="_blank" rel="noopener">Read the official manual for this command ↗</a>` : ""}
      </section>
    </div>`;
}

let xpTimer = 0;
let xpFor: HTMLElement | null = null;
function openExplain(trigger: HTMLElement, pinned: boolean) {
  const panel = $("#xp");
  window.clearTimeout(xpTimer);
  if (xpFor !== trigger) panel.querySelector(".xp__body")!.innerHTML = explainPanelHtml(trigger.dataset.explain!);
  xpFor = trigger;
  document.querySelectorAll(".explain.is-open").forEach((x) => x.classList.toggle("is-open", x === trigger));
  trigger.classList.add("is-open");
  panel.hidden = false;
  panel.classList.toggle("is-pinned", pinned);
  placeExplain(trigger);
  requestAnimationFrame(() => panel.classList.add("is-in"));
}
function closeExplain(soon = false) {
  const panel = $("#xp");
  window.clearTimeout(xpTimer);
  const go = () => { panel.classList.remove("is-in", "is-pinned"); panel.hidden = true; xpFor?.classList.remove("is-open"); xpFor = null; };
  if (soon) xpTimer = window.setTimeout(go, 160); else go();
}
/* desktop: beside the lesson card, level with the command, kept on screen.
 * phones: a sheet along the bottom (placed by CSS) */
function placeExplain(trigger: HTMLElement) {
  const panel = $("#xp");
  if (window.innerWidth < 900) { panel.style.left = panel.style.top = ""; return; }
  const card = $("#lesson").getBoundingClientRect(), row = trigger.closest(".cmd-row")!.getBoundingClientRect();
  const w = Math.min(640, window.innerWidth - card.right - 40);
  const roomRight = w >= 440;
  panel.style.width = `${roomRight ? w : card.width}px`;
  const left = roomRight ? card.right + 18 : card.left;
  const h = panel.offsetHeight;
  const top = roomRight ? Math.max(76, Math.min(row.top - 18, window.innerHeight - h - 16)) : Math.min(row.bottom + 8, window.innerHeight - h - 16);
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(76, top)}px`;
  panel.style.setProperty("--arrow-y", `${Math.max(18, Math.min(h - 18, row.top + row.height / 2 - Math.max(76, top)))}px`);
  panel.classList.toggle("is-below", !roomRight);
}

/* syntax colours for a command line: the program, what it should do, flags,
 * quoted text, addresses and paths, and everything else (names, ids) */
function hl(cmd: string): string {
  const parts = cmd.match(/"[^"]*"|'[^']*'|\S+|\s+/g) ?? [];
  let word = 0;
  return parts.map((t) => {
    if (/^\s+$/.test(t)) return t;
    word++;
    const cls = word === 1 ? "tk-prog"
      : word === 2 || (word === 3 && /^(remote|worktree|pr)$/.test(parts.filter((x) => !/^\s+$/.test(x))[1] ?? "")) ? "tk-sub"
      : /^["']/.test(t) ? "tk-str"
      : /^-/.test(t) ? "tk-flag"
      : /:\/\/|^\.\.?\/|\.git$|github\.com/.test(t) ? "tk-url"
      : "tk-arg";
    return `<span class="${cls}">${esc(t)}</span>`;
  }).join("");
}

/* ------------------------------------------------------------------ state */

const KEY = "htg-story-2";
let w: World = G.freshWorld();
let ci = 0, bi = 0;
let mode: Mode = "buttons";
let log: LogLine[] = [];
let beatDone = false;
let termDesk = 0;
let justDone = false;
let instant = true; // draw without animation (first paint, jumps)
let history: Snap[] = []; // where you've been, so Back can return there exactly

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ w, ci, bi, mode, log, beatDone, choices })); } catch { /* private mode */ }
}
function load(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!chapters[s.ci]?.beats[s.bi]) return false;
    ({ w, ci, bi, log, beatDone } = s);
    Object.assign(choices, s.choices ?? {});
    mode = s.mode ?? "buttons";
    return true;
  } catch { return false; }
}

const beat = (): Beat => chapters[ci].beats[bi];
/* acts that look the same in every mode: Albert or Toby doing something, or a happening like the cat */
const isWatch = (a: Act) => a.who === "albert" || a.ai === "";
const beatDesk = () => beat().desk ?? 0;
const PR_CHAPTER = chapters.findIndex((c) => c.short === "pull request");
const flat = chapters.flatMap((c, i) => c.beats.map((b, j) => ({ c: i, b: j, beat: b })));
const flatIndex = (c: number, b: number) => flat.findIndex((x) => x.c === c && x.b === b);

/* ------------------------------------------------------------ running */

/* Undo takes back the last thing you did in this step (a lesson rewind, not a
 * git command): before each action the step's state is kept, Undo restores it */
let undoStack: { w: string; log: string; beatDone: boolean }[] = [];
const canUndo = () => undoStack.length > 0 || (beatDone && beat().kind !== "next");
const keepForUndo = () => {
  undoStack.push({ w: JSON.stringify(w), log: JSON.stringify(log), beatDone });
  if (undoStack.length > 30) undoStack.shift();
};
function undo() {
  const snap = undoStack.pop();
  if (!snap && !canUndo()) return;
  clearSelection();
  if (snap) {
    w = JSON.parse(snap.w);
    log = JSON.parse(snap.log);
    beatDone = snap.beatDone;
  } else {
    // nothing remembered (after a reload): the step as it was when you arrived
    w = replayTo(ci, bi);
    log = [];
    beatDone = beat().kind === "next";
  }
  termDesk = beatDesk();
  renderWorld();
  renderLesson();
  renderDeck();
  save();
}

let actN = Date.now(); // numbers each action (a clock start keeps it unique across reloads), so the hood can show just the latest one
function runSteps(act: Act, vals: Record<string, string>): boolean {
  keepForUndo();
  actN++;
  const who = act.who ?? "you";
  const deskI = who === "you" ? (mode === "command" ? termDesk : beatDesk()) : 0;
  const before = snapshotFx();
  let ok = true;
  for (const s of act.steps(w, vals)) {
    if (typeof s === "string") {
      log.push({ kind: "cmd", text: s, who, act: actN });
      const r = exec(w, s, who, deskI);
      if (r.out) log.push({ kind: r.ok ? "out" : "err", text: r.out, who });
      focusPlace = placeFor(s, who);
      if (!r.ok) { ok = false; break; }
    } else {
      const note = s(w);
      if (note) log.push({ kind: "note", text: note, who });
    }
  }
  afterChange();
  celebrate(before, ok, who);
  return ok;
}

function runTyped(line: string) {
  if (!line.trim()) return;
  keepForUndo();
  actN++;
  const before = snapshotFx();
  const entry: LogLine = { kind: "cmd", text: line.trim(), who: "you", act: actN };
  log.push(entry);
  const steps = taskSteps();
  const r = exec(w, line, "you", termDesk);
  entry.ok = r.ok;
  if (r.out === "\f") { log = []; }
  else if (r.out) log.push({ kind: r.ok ? "out" : "err", text: r.out, who: "you" });
  const c = coach(line.trim(), r, steps);
  if (c) log.push({ kind: "coach", text: c.text, good: c.good, who: "you" });
  if (r.desk !== undefined) termDesk = r.desk;
  focusPlace = placeFor(line, "you");
  afterChange();
  celebrate(before, r.ok);
}

/* which place a command changes, so the page can bring it into view */
let focusPlace: string | null = null;
function placeFor(cmd: string, who: Who): string {
  if (who === "albert") return "albert";
  if (/^gh\s|^git\s+push\b/.test(cmd)) return "github";
  return "you";
}
function showPlace(id: string | null) {
  if (!id) return;
  const p = document.querySelector<HTMLElement>(`.place--${id}`);
  if (!p) return;
  const r = p.getBoundingClientRect();
  const topH = $(".top").getBoundingClientRect().height;
  if (r.top >= topH && r.top + Math.min(r.height, 320) <= window.innerHeight) return;
  p.scrollIntoView({ block: "start", behavior: prefersReduced ? "auto" : "smooth" });
}

function afterChange() {
  if (!beatDone && beat().done(w)) {
    beatDone = true;
    justDone = true;
    w.vars[`learned:${beat().id}`] = "1";
    beat().onDone?.(w);
  } else if (beatDone && beat().live && !beat().done(w)) beatDone = false;
  renderWorld();
  renderLesson();
  renderDeck();
  save();
  if (window.innerWidth >= 860) showPlace(focusPlace);
  lastPlace = focusPlace ?? lastPlace;
  focusPlace = null;
}
let lastPlace: string | null = null;

/* ------------------------------------------------------------ navigation */

function arrive() {
  undoStack = [];
  beatDone = false;
  lastPlace = null;
  delete w.vars.rejected; // a beat only counts a rejected push that happened during it
  delete w.vars.sawLog; // likewise a git log
  termDesk = beatDesk();
  log = [];
  if (beat().kind === "next") beatDone = true;
  if (beat().done(w) && beat().kind !== "next") beatDone = true;
}

function goto(c: number, b: number, opts: { replay?: boolean } = {}) {
  clearSelection();
  if (opts.replay) { w = replayTo(c, b); history = []; }
  ci = c; bi = b;
  arrive();
  instant = !!opts.replay;
  renderAll();
  instant = false;
  save();
  $("#lesson").scrollTop = 0;
  if (opts.replay || window.innerWidth < 900) window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
}

const clearSelection = () => { try { getSelection()?.removeAllRanges(); } catch { /* nothing selected */ } };

function next() {
  clearSelection();
  history.push({ ci, bi, w: JSON.stringify(w), log: JSON.stringify(log), beatDone });
  if (history.length > 80) history.shift();
  if (bi + 1 < chapters[ci].beats.length) goto(ci, bi + 1);
  else if (ci + 1 < chapters.length) goto(ci + 1, 0);
}

/* Back returns to the step before, exactly as you left it (finished, with
 * what you typed). After a reload or a chapter jump there is no record, so
 * the step before is rebuilt the typical way and shown finished. */
function back() {
  clearSelection();
  undoStack = [];
  const snap = history.pop();
  if (snap) {
    w = JSON.parse(snap.w);
    ci = snap.ci; bi = snap.bi;
    log = JSON.parse(snap.log);
    beatDone = snap.beatDone;
    termDesk = beatDesk();
  } else {
    const i = flatIndex(ci, bi);
    if (i <= 0) return;
    const prev = flat[i - 1];
    const done = finishBeat(prev.c, prev.b); // the previous step, done the typical way
    w = done.w;
    ci = prev.c; bi = prev.b;
    log = done.log;
    beatDone = true;
    termDesk = beatDesk();
  }
  instant = true;
  renderAll();
  instant = false;
  save();
}

/* jump to a step in this chapter from the progress bar. Going back restores it
 * exactly as you left it when there's a record; otherwise it's rebuilt the
 * typical way (finished when it's behind you, fresh when it's ahead). */
function jumpBeat(i: number) {
  clearSelection();
  undoStack = [];
  if (i === bi) return;
  if (i < bi) {
    const k = history.map((h) => h.ci === ci && h.bi === i).lastIndexOf(true);
    if (k >= 0) {
      const snap = history[k];
      history = history.slice(0, k);
      w = JSON.parse(snap.w);
      bi = i;
      log = JSON.parse(snap.log);
      beatDone = snap.beatDone;
      termDesk = beatDesk();
    } else {
      const done = finishBeat(ci, i);
      w = done.w;
      bi = i;
      log = done.log;
      beatDone = true;
      termDesk = beatDesk();
      history = [];
    }
    instant = true;
    renderAll();
    instant = false;
    save();
    return;
  }
  history.push({ ci, bi, w: JSON.stringify(w), log: JSON.stringify(log), beatDone });
  w = replayTo(ci, i);
  bi = i;
  arrive();
  instant = true;
  renderAll();
  instant = false;
  save();
}

/* ---------------------------------------------------------------- render */

function renderAll() {
  renderChapters();
  renderMode();
  renderWorld();
  renderLesson();
  renderDeck();
}

function renderChapters() {
  const nav = $("#chapters");
  nav.innerHTML = chapters.map((c, i) => `
    <button type="button" class="chap ${i === ci ? "is-now" : ""} ${i < ci ? "is-done" : ""}" data-ch="${i}" ${i === ci ? 'aria-current="step"' : ""} title="${esc(c.title)}">
      <span class="chap__n">${i < ci ? "✓" : i + 1}</span><span class="chap__t">${esc(c.short)}</span>
    </button>`).join("");
  nav.querySelector(".is-now")?.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderMode() {
  document.querySelectorAll<HTMLButtonElement>("#mode [data-mode]").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  });
  document.body.dataset.mode = mode;
}

/* the git words you've earned so far: every term up to where you are */
/* "you are here" becomes HEAD from the first time you move it yourself */
const headKnown = () => earned().has("HEAD") || w.vars.movedHead === "1";

function earned(): Set<string> {
  const now = flatIndex(ci, bi);
  const s = new Set<string>();
  // a word stays earned once its step was done, even if you wander off again
  flat.forEach((x, i) => { if (x.beat.term && (i < now || (i === now && (beatDone || w.vars[`learned:${x.beat.id}`] === "1")))) s.add(x.beat.term[0]); });
  return s;
}
const allTerms = flat.filter((x) => x.beat.term).map((x) => x.beat.term!);
let lastEarned = -1;

function renderDeck() {
  const n = earned().size;
  const btn = $("#deck-btn");
  btn.innerHTML = `<span class="deck__ico" aria-hidden="true"></span><span class="deck__n">${n}</span><span class="deck__of">/ ${allTerms.length}</span><span class="deck__label">git words</span>`;
  if (lastEarned >= 0 && n > lastEarned && !instant) {
    btn.classList.remove("pop");
    void btn.offsetWidth;
    btn.classList.add("pop");
  }
  lastEarned = n;
}

function openDeck() {
  const got = earned();
  $("#deck-list").innerHTML = allTerms.map(([k, v]) => got.has(k)
    ? `<li class="card-word"><b>${k}</b><p>${v}</p></li>`
    : `<li class="card-word is-locked"><b>?</b><p>Still ahead.</p></li>`).join("");
  ($("#deck") as unknown as HTMLDialogElement).showModal();
}

function renderLesson() {
  const b = beat(), ch = chapters[ci];
  const total = ch.beats.length;
  const isLast = ci === chapters.length - 1;
  const lastOfChapter = bi === total - 1 && !isLast;
  const after = beatDone && b.after ? b.after(w) : "";
  const fresh = justDone && !instant;
  const atStart = flatIndex(ci, bi) === 0;
  const box = $("#lesson");
  const oldH = box.getBoundingClientRect().height;
  box.innerHTML = `
    <p class="kicker"><span>Chapter ${ci + 1} of ${chapters.length}</span> <b>${esc(ch.title)}</b></p>
    ${ch.goal ? `<p class="goal">Goal: ${esc(ch.goal)}</p>` : ""}
    <nav class="beats" aria-label="steps in this chapter">${ch.beats.map((_, i) => `<button type="button" class="beat ${i < bi || (i === bi && beatDone) ? "done" : i === bi ? "now" : ""}" data-beat="${i}" aria-label="Step ${i + 1}" ${i === bi ? 'aria-current="step"' : ""}></button>`).join("")}</nav>
    <div class="say">${b.say(w)}</div>
    ${isLast ? recapHtml() : ""}
    ${b.kind === "next" ? "" : `<div class="do">${doHtml(b)}</div>`}
    ${after || (beatDone && b.term) ? `<div class="after ${fresh ? "is-new" : ""}">
        ${after ? `<p class="after__text"><span class="tick" aria-hidden="true">✓</span> ${after}</p>` : ""}
        ${lastPlace ? `<button type="button" class="see" data-see="${lastPlace}">See what changed ↓</button>` : ""}
        ${b.term ? `<div class="term"><span class="term__k">Git word</span><b class="term__w">${b.term[0]}</b><p>${b.term[1]}</p></div>` : ""}
      </div>` : ""}
    ${beatDone && b.more ? `<div class="more">${b.more.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join("")}</div>` : ""}
    ${beatDone && lastOfChapter && ch.goal ? `<div class="chapter-done ${fresh ? "is-new" : ""}"><span class="star" aria-hidden="true">★</span><div><b>Chapter ${ci + 1} done</b><p>You can now ${esc(ch.goal)}.</p></div></div>` : ""}
    <div class="lesson__nav">
      <button type="button" class="btn btn--ghost btn--back" data-back ${atStart ? "disabled" : ""}><span aria-hidden="true">←</span> Back</button>
      <button type="button" class="btn btn--ghost btn--undo" data-undo ${canUndo() ? "" : "disabled"} title="Take back what you just did in this step, to try it again. This rewinds the lesson; it isn't a git command."><span aria-hidden="true">↶</span> Undo</button>
      ${isLast ? `<button type="button" class="btn btn--next" data-restart>Start over</button>` : `
      <span class="step-of">${bi + 1} / ${total}</span>
      <button type="button" class="btn btn--next" data-next ${beatDone ? "" : "disabled"}>${bi + 1 < total ? "Next" : "Next chapter"} <span aria-hidden="true">→</span></button>`}
    </div>`;
  wireLesson();
  easeHeight(box, oldH);
  if (xpFor && !document.body.contains(xpFor)) closeExplain();
  const term = box.querySelector(".term__out");
  if (term) term.scrollTop = term.scrollHeight;
  if (beatDone && justDone) {
    justDone = false;
    // steps you click around in (live) keep still; others bring the result into view
    if (!b.live) box.querySelector(".after")?.scrollIntoView({ block: "nearest", behavior: prefersReduced ? "auto" : "smooth" });
  }
  if (beatDone) {
    const nb = box.querySelector<HTMLButtonElement>("[data-next]");
    if (nb && document.activeElement?.closest("#lesson") && !document.activeElement.matches("input")) nb.focus({ preventScroll: true });
  }
}

function inputsHtml(a: Act, ai: number) {
  return (a.inputs ?? []).map((inp) => `
    <label class="field"><span>${esc(inp.label)}</span>
      <input type="text" data-act="${ai}" data-key="${inp.key}" value="${esc(valueFor(beat(), ai, inp, w))}" maxlength="60" ${beatDone ? "disabled" : ""} /></label>`).join("");
}

/* the "do" area: what you press or type, depending on the mode */
function doHtml(b: Beat): string {
  if (b.kind === "edit") {
    const files = b.edit!.files;
    const d = w.repos.you?.desks[b.desk ?? 0];
    return `<div class="acts acts--row">${files.map((f) => `<button type="button" class="btn btn--file" data-open="${f}" data-desk="${b.desk ?? 0}">Open ${f}</button>`).join("")}</div>
      ${beatDone ? "" : `<p class="hint">Type your change, then <b>Save file</b>. Editing works the same in every tool${d && b.desk ? `. This is the copy in <b>${esc(d.path.replace("~/", ""))}</b>` : ""}.</p>`}`;
  }
  if (b.kind === "resolve") {
    return `<button type="button" class="btn btn--file" data-open="${MAIN_FILE}" data-desk="0">Open ${MAIN_FILE}</button>`;
  }
  const acts = b.acts ?? [];
  const watch = acts.filter(isWatch);
  const mine = acts.filter((a) => !watch.includes(a));
  let html = "";
  if (watch.length) {
    html += `<div class="acts acts--row">${watch.map((a) => `<button type="button" class="btn ${a.who === "albert" ? "btn--friend" : "btn--event"}" data-run="${acts.indexOf(a)}" ${beatDone ? "disabled" : ""}>${esc(a.label)}</button>`).join("")}</div>`;
  }
  if (mine.length) {
    if (mode === "buttons") html += buttonsHtml(mine, acts);
    if (mode === "command") html += commandHtml(mine);
    if (mode === "ai") html += aiHtml(mine);
  }
  const picks = (b.acts ?? []).some((a) => a.pick === "commit");
  if ((picks && mode !== "buttons") || (!picks && log.some((l) => l.kind === "cmd" && /^git\s+log\b/.test(l.text)))) html += historyHtml();
  if (mode !== "command") html += hoodHtml();
  if (watch.length && mode === "command") html += termHtml(true);
  return html;
}

/* buttons mode looks like the tools people use: an editor's source control
 * panel for git actions, and a browser window for things done on GitHub */
function buttonsHtml(mine: Act[], acts: Act[]): string {
  const act = (a: Act) => `<div class="act">
      ${inputsHtml(a, acts.indexOf(a))}
      <button type="button" class="btn ${a.look === "github" ? "btn--gh" : "btn--go btn--ide"} ${beatDone ? "is-done" : ""}" data-run="${acts.indexOf(a)}" ${beatDone ? "disabled" : ""}>${beatDone ? '<span aria-hidden="true">✓</span> Done' : `${a.look === "github" ? '<span class="gh-dot" aria-hidden="true"></span>' : ""}${esc(a.label)}`}</button>
    </div>`;
  const picker = mine.find((a) => a.pick === "commit");
  if (picker) return historyHtml(acts.indexOf(picker)) + statusHtml();
  const local = mine.filter((a) => a.look !== "github"), web = mine.filter((a) => a.look === "github");
  const d = w.repos.you?.desks[beatDesk()];
  const where = d ? (d.detached ? `old version ${G.short(d.detached)}` : d.branch ?? "") : "";
  return `${local.length ? `<div class="ide">
      <div class="ide__rail" aria-hidden="true"><i class="ide__ico ide__ico--files"></i><i class="ide__ico ide__ico--git is-on"></i><i class="ide__ico ide__ico--search"></i></div>
      <div class="ide__main">
        <p class="ide__head">Source control${where ? `<span class="ide__br">⎇ ${esc(where)}</span>` : ""}</p>
        <div class="acts">${local.map(act).join("")}</div>
      </div>
    </div>` : ""}
    ${web.length ? `<div class="webwin">
      <p class="webwin__bar"><span class="webwin__dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="webwin__url">github.com/you/my-report</span></p>
      <div class="webwin__body acts">${web.map(act).join("")}</div>
    </div>` : ""}`;
}

function hintCmds(mine: Act[]): string[] {
  return mine.flatMap((a) => {
    const v: Record<string, string> = {};
    a.inputs?.forEach((i) => (v[i.key] = valueFor(beat(), beat().acts!.indexOf(a), i, w)));
    return a.steps(w, v).filter((s): s is string => typeof s === "string");
  });
}

function prompt(): string {
  const r = w.repos.you;
  const d = r?.desks[termDesk] ?? r?.desks[0];
  const where = d ? d.path : "~/my-report";
  const br = d ? (d.detached ? G.short(d.detached) : d.branch) : null;
  return `${esc(where)}${r && br ? ` <span class="pr-br">(${esc(br)})</span>` : ""} $`;
}

function termHtml(readOnly = false): string {
  const lines = log.map((l) => {
    if (l.kind === "cmd") return `<div class="t-cmd ${l.who === "albert" ? "t-friend" : ""}">${l.who === "albert" ? "<span class=\"who\">albert's laptop $</span>" : "<span class=\"who\">$</span>"} ${hl(l.text)}</div>`;
    if (l.kind === "note") return `<div class="t-note">${esc(l.text)}</div>`;
    if (l.kind === "coach") return `<div class="t-coach ${l.good ? "is-good" : "is-hint"}">${l.text}</div>`;
    return `<div class="t-${l.kind}">${esc(l.text)}</div>`;
  }).join("");
  return `<div class="term-box">
    <div class="term__out">${lines || `<div class="t-note">Type a command and press Enter. <b>git status</b> always tells you where things stand.</div>`}</div>
    ${readOnly ? "" : `<form class="term__in" data-term><label><span class="term__prompt">${prompt()}</span>
      <input type="text" name="cmd" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="command" placeholder="type a git command, then Enter" /></label></form>`}
  </div>`;
}

/* the commands this step needs, in plain words, and which ones you've done */
const sameCmd = (a: string, b: string) => {
  const ta = a.trim().split(/\s+/), tb = b.trim().split(/\s+/);
  const deep = /^(remote|worktree|pr)$/.test(tb[1] ?? "");
  return ta[0] === tb[0] && ta[1] === tb[1] && (!deep || ta[2] === tb[2]);
};
function taskSteps(): { cmd: string; words: string; done: boolean }[] {
  const mine = (beat().acts ?? []).filter((a) => !isWatch(a));
  const typed = log.filter((l) => l.kind === "cmd" && l.who === "you" && l.ok);
  let from = 0;
  return hintCmds(mine).map((cmd) => {
    const e = explain(cmd);
    const words = e?.parts[1]?.means ?? "run it";
    const at = typed.findIndex((l, i) => i >= from && sameCmd(l.text, cmd));
    const done = beatDone || at >= 0;
    if (at >= 0) from = at + 1;
    return { cmd, words: words.charAt(0).toUpperCase() + words.slice(1), done };
  });
}
/* a plain-words reply to what you just typed: the step it counted as, or what
 * an error means and what to try instead */
function coach(line: string, r: { ok: boolean; out: string }, before: { cmd: string; words: string; done: boolean }[]): { text: string; good: boolean } | null {
  const next = before.find((s) => !s.done);
  const after = taskSteps();
  const nextAfter = after.find((s) => !s.done);
  if (r.ok) {
    if (beat().done(w)) return { text: "✓ That's the step done. Press Next when you're ready.", good: true };
    if (next && sameCmd(line, next.cmd)) {
      const n = before.indexOf(next) + 1;
      return { text: `✓ That's step ${n}.${nextAfter ? ` Next: ${esc(nextAfter.words.toLowerCase())}.` : ""}`, good: true };
    }
    return null; // a look around (git status, git log): no comment needed
  }
  const o = r.out;
  const why = /not a git repository/.test(o) ? "This folder isn't a repository yet. Run <code>git init</code> first."
    : /pathspec|did not match any/.test(o) ? "There's no file or name like that here. Check the spelling; <code>git status</code> lists your files."
    : /nothing to commit|no changes added/.test(o) ? "Nothing is staged yet. Stage your changes with <code>git add</code> first."
    : /Add a message with -m|empty commit message/.test(o) ? "A commit needs a message: <code>git commit -m \"what changed\"</code>."
    : /is not a git command|command not found/.test(o) ? "That command doesn't exist. A typo, maybe?"
    : /\[rejected\]/.test(o) ? "GitHub has commits you don't have yet. Pull them first."
    : /no upstream branch/.test(o) ? "This branch isn't paired with GitHub yet. Push it once with <code>-u origin &lt;branch&gt;</code>."
    : /would be overwritten/.test(o) ? "You have unsaved changes in the way. Commit them, or throw them away with <code>git restore</code>."
    : /already exists/.test(o) ? "That name is taken already."
    : "Git didn't accept that.";
  return { text: `✗ ${why}${next ? ` The step needs: ${esc(next.words.toLowerCase())}.` : ""}`, good: false };
}
function commandHtml(mine: Act[]): string {
  void mine;
  const steps = taskSteps();
  const nextI = steps.findIndex((s) => !s.done);
  return `<ol class="task">${steps.map((s, i) => `<li class="${s.done ? "is-done" : i === nextI ? "is-next" : ""}">
      <span class="task__box" aria-hidden="true">${s.done ? "✓" : i + 1}</span>
      <span class="task__words">${esc(s.words)}</span>
      <details class="task__peek"><summary>show the command</summary><div class="cmd-row"><code class="cmd-hint">${hl(s.cmd)}</code>${explainHtml(s.cmd)}</div></details>
    </li>`).join("")}</ol>
    ${termHtml()}`;
}

/* AI mode: there is no real AI on this page (running one costs money and
 * isn't needed to learn), so the messages are written for you; pick one and
 * the assistant answers the way a real one would */
function aiHtml(mine: Act[]): string {
  const ask = mine.map((a) => a.ai).filter(Boolean).join(", then ");
  const chat = log.filter((l) => l.kind === "me" || l.kind === "ai");
  const waiting = chat.some((l) => l.kind === "ai" && l.cmds);
  return `<div class="chat">
    <p class="chat__note"><b>No real AI here.</b> Running one would cost money, and you don't need it to learn. Pick a message; the assistant answers the way a real one (ChatGPT, Claude, Copilot) would.</p>
    ${chat.map((l) => l.kind === "me"
      ? `<p class="bubble bubble--me">${esc(l.text)}</p>`
      : `<div class="bubble bubble--ai"><span class="ai-name">Assistant</span>${l.text}</div>`).join("")}
    ${beatDone || waiting ? "" : `<div class="chat__picks"><span class="chat__k">Send:</span>
      <button type="button" class="say-pick" data-say="${esc(ask)}">“${esc(ask)}” <span aria-hidden="true">↵</span></button></div>`}
  </div>`;
}

/* the history, the way a tool shows it: every commit on main, newest first */
/* pickAct: the act a row's Open button runs (buttons mode lets you choose a commit) */
function historyHtml(pickAct = -1): string {
  const r = w.repos.you;
  if (!r?.branches.main) return "";
  const d = r.desks[beatDesk()];
  const head = G.headId(r, d);
  const list = [...G.ancestors(w, r.branches.main)].map((id) => w.commits[id]).sort((a, b) => b.n - a.n);
  const marker = headKnown() ? "HEAD" : "you are here";
  return `<div class="hist ${pickAct >= 0 ? "hist--pick" : ""}">
    <p class="hist__k">History of main, newest first</p>
    <div class="hist__cols" aria-hidden="true"><span>ID</span><span>Commit message</span><span>By</span><span></span></div>
    <ol class="hist__list">${list.map((c) => `<li class="${c.id === head ? "is-head" : ""}">
      <code class="hist__id">${G.short(c.id)}</code><span class="hist__msg">${esc(c.msg)}</span>
      <span class="hist__who">${esc(c.author)}</span>${c.id === head ? `<span class="hist__head">${marker}</span>`
        : pickAct >= 0 ? `<button type="button" class="hist__open" data-run="${pickAct}" data-pick="${G.short(c.id)}">Open</button>` : "<span></span>"}
    </li>`).join("")}</ol>
  </div>`;
}

/* a beat's changing status line, in a slot that keeps its height */
function statusHtml(): string {
  const st = beat().status;
  return st ? `<p class="status" aria-live="polite">${st(w)}</p>` : "";
}

/* in buttons and AI mode, show which git commands actually ran */
function hoodHtml(): string {
  const cmds = log.filter((l) => l.kind === "cmd");
  if (!cmds.length) return "";
  const errs = log.filter((l) => l.kind === "err");
  // the latest action's commands are shown; anything before folds away
  const lastAct = Math.max(...cmds.map((l) => l.act ?? 0));
  const now = cmds.filter((l) => (l.act ?? 0) === lastAct), earlier = cmds.filter((l) => (l.act ?? 0) !== lastAct);
  const rows = (list: LogLine[]) => list.reduce((acc: { l: LogLine; n: number }[], l) => {
      const last = acc[acc.length - 1];
      if (last && last.l.text === l.text && last.l.who === l.who) last.n++; else acc.push({ l, n: 1 });
      return acc;
    }, []).map(({ l, n }) => `<div class="cmd-row"><code class="cmd-hint ${l.who === "albert" ? "is-friend" : ""}">${l.who === "albert" ? "Albert: " : ""}${hl(l.text)}${n > 1 ? `<span class="cmd-n">×${n}</span>` : ""}</code>${explainHtml(l.text)}</div>`).join("");
  return `<div class="hood">
    <p class="hood__k">Under the hood, that ran:</p>
    ${earlier.length ? `<details class="hood__earlier"><summary>Show ${earlier.length} earlier command${earlier.length > 1 ? "s" : ""}</summary>${rows(earlier)}</details>` : ""}
    ${rows(now)}
    ${errs.length ? `<pre class="hood__err">${esc(errs[errs.length - 1].text)}</pre>` : ""}
    <details><summary>Show git's full answer</summary><pre>${esc(log.filter((l) => l.kind === "out" || l.kind === "err").map((l) => l.text).join("\n\n")) || "(nothing printed)"}</pre></details>
  </div>`;
}

function recapHtml(): string {
  return `<div class="recap">
    <h3>Every git word you earned</h3>
    <dl>${allTerms.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
  </div>`;
}

function wireLesson() {
  const root = $("#lesson");
  root.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((btn) => btn.addEventListener("click", () => {
    const a = beat().acts![Number(btn.dataset.run)];
    const vals: Record<string, string> = btn.dataset.pick ? { id: btn.dataset.pick } : {};
    a.inputs?.forEach((inp) => {
      const field = root.querySelector<HTMLInputElement>(`input[data-act="${btn.dataset.run}"][data-key="${inp.key}"]`);
      vals[inp.key] = field?.value.trim() || inp.def(w);
      choices[choiceKey(beat(), Number(btn.dataset.run), inp.key)] = vals[inp.key];
    });
    runSteps(a, vals);
  }));
  root.querySelector("[data-next]")?.addEventListener("click", next);
  root.querySelector("[data-back]")?.addEventListener("click", back);
  root.querySelector("[data-undo]")?.addEventListener("click", undo);
  root.querySelectorAll<HTMLButtonElement>("[data-beat]").forEach((b) => b.addEventListener("click", () => jumpBeat(Number(b.dataset.beat))));
  root.querySelector<HTMLButtonElement>("[data-see]")?.addEventListener("click", (e) =>
    document.querySelector(`.place--${(e.currentTarget as HTMLElement).dataset.see}`)?.scrollIntoView({ block: "start", behavior: prefersReduced ? "auto" : "smooth" }));
  root.querySelector("[data-restart]")?.addEventListener("click", () => {
    for (const k of Object.keys(choices)) delete choices[k];
    goto(0, 0, { replay: true });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((b) => b.addEventListener("click", () => openEditor("you", Number(b.dataset.desk ?? 0), b.dataset.open!)));
  const term = root.querySelector<HTMLFormElement>("[data-term]");
  if (term) {
    const input = term.querySelector("input")!;
    term.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; input.value = ""; runTyped(v); focusTerm(); });
    input.addEventListener("keydown", (e) => {
      const past = log.filter((l) => l.kind === "cmd" && l.who === "you").map((l) => l.text);
      if (e.key === "ArrowUp" && past.length) { e.preventDefault(); histI = Math.max(0, (histI < 0 ? past.length : histI) - 1); input.value = past[histI]; }
      if (e.key === "ArrowDown" && histI >= 0) { e.preventDefault(); histI++; input.value = past[histI] ?? ""; if (histI >= past.length) histI = -1; }
    });
  }
  root.querySelectorAll<HTMLButtonElement>("[data-say]").forEach((b) => b.addEventListener("click", () => askAi(b.dataset.say!)));
  root.querySelectorAll<HTMLButtonElement>("[data-ai-run]").forEach((b) => b.addEventListener("click", aiRun));
}
let histI = -1;
function focusTerm() { $("#lesson").querySelector<HTMLInputElement>("[data-term] input")?.focus({ preventScroll: true }); }

/* the pretend assistant: it proposes the same commands the buttons run, and
 * waits for you to say yes, the way real coding assistants ask first */
function askAi(text: string) {
  const mine = (beat().acts ?? []).filter((a) => !isWatch(a));
  log.push({ kind: "me", text: text.trim() || "do the next step" });
  const cmds = hintCmds(mine);
  const val = (a: Act, i: { key: string; def: (w: World) => string }) => esc(valueFor(beat(), beat().acts!.indexOf(a), i, w));
  const msgs = mine.flatMap((a) => (a.inputs ?? []).map((i) => i.key === "msg" ? `with the commit message <b>"${val(a, i)}"</b>` : i.key === "name" ? `called <b>${val(a, i)}</b>` : i.key === "title" ? `titled <b>"${val(a, i)}"</b>` : ""));
  log.push({
    kind: "ai",
    text: `Sure${msgs.filter(Boolean).length ? `, ${msgs.filter(Boolean).join(" and ")}` : ""}. I'll run ${cmds.length > 1 ? "these git commands" : "this git command"}:
      ${cmds.map((c) => `<code class="cmd-hint">${hl(c)}</code>`).join("")}
      <button type="button" class="btn btn--small btn--go" data-ai-run>Yes, run ${cmds.length > 1 ? "them" : "it"}</button>`,
    cmds,
  });
  renderLesson();
}
function aiRun() {
  const mine = (beat().acts ?? []).filter((a) => !isWatch(a));
  const last = [...log].reverse().find((l) => l.kind === "ai" && l.cmds);
  if (last) { last.text = last.text.replace(/<button[^>]*data-ai-run[^>]*>[^<]*<\/button>/, ""); delete last.cmds; }
  let ok = true;
  for (const a of mine) {
    const v: Record<string, string> = {};
    a.inputs?.forEach((i) => (v[i.key] = valueFor(beat(), beat().acts!.indexOf(a), i, w)));
    if (ok) ok = runSteps(a, v);
  }
  const err = [...log].reverse().find((l) => l.kind === "err");
  log.push({ kind: "ai", text: ok ? "Done. The picture shows what changed." : `Git stopped with a message: <i>${esc((err?.text ?? "").split("\n")[0])}</i>` });
  renderLesson();
  save();
}

/* ------------------------------------------------------------------ world */

const COLORS = ["var(--pen-red)", "var(--pen-green)", "var(--pen-amber)", "var(--pen-remote)"];
const branchColor = new Map<string, string>([["main", "var(--pen-blue)"]]);
function colorOf(b: string) {
  if (b === "?") return "var(--ink-soft)";
  if (!branchColor.has(b)) branchColor.set(b, COLORS[(branchColor.size - 1) % COLORS.length]);
  return branchColor.get(b)!;
}
const drawn = new Map<string, Set<string>>();
const COL = 100, X0 = 56;

const STATE_WORDS: Record<G.FileState, string> = {
  saved: "no changes", changed: "changed", staged: "staged", "staged+changed": "staged, then changed",
  new: "new", conflict: "conflict!", deleted: "deleted", "staged-deleted": "deletion staged",
};

/* parts of the world are only replaced when their markup changed */
const parts = new Map<Element, string>();
function setPart(node: Element | null, html: string): boolean {
  if (!node || parts.get(node) === html) return false;
  node.innerHTML = html;
  parts.set(node, html);
  return true;
}
const fileStateSeen = new Map<string, string>();

/* retype a label: backspace the old words, then type the new ones, with a caret.
 */
function typeOver(t: SVGTextElement, from: string, to: string, ms: number) {
  const keep = "";
  const a = from.slice(keep.length), b = to.slice(keep.length);
  const steps = a.length + b.length;
  const tick = Math.max(18, ms / Math.max(1, steps));
  let i = 0;
  t.textContent = from;
  const timer = window.setInterval(() => {
    i++;
    const shown = i <= a.length ? a.slice(0, a.length - i) : b.slice(0, i - a.length);
    t.textContent = keep + shown + (i < steps ? "|" : "");
    if (i >= steps) window.clearInterval(timer);
  }, tick);
}

/* where each HEAD marker sat before a change: screen position and commit */
function hereSpots(): Map<string, { x: number; y: number; at: string; text: string }> {
  const m = new Map<string, { x: number; y: number; at: string; text: string }>();
  document.querySelectorAll<SVGGraphicsElement>("[data-lab]").forEach((t) => {
    const r = t.getBoundingClientRect();
    const text = t.tagName === "text" ? t.textContent : t.querySelector("text")?.textContent;
    m.set(t.dataset.lab!, { x: r.left + r.width / 2, y: r.top + r.height / 2, at: t.dataset.at!, text: text ?? "" });
  });
  return m;
}
/* a HEAD marker that moved to another commit slides there from where it was
 * (and if it was still "you are here", the new word appears as it lands) */
/* labels (HEAD and branch names) that moved to another commit step there
 * together from where they were; `wait` holds them in place first, e.g. until
 * a new commit has been drawn */
function slideHere(before: Map<string, { x: number; y: number; at: string; text: string }>, place: string, wait = 0) {
  if (prefersReduced) return;
  document.querySelectorAll<SVGGraphicsElement>(`[data-strip="${place}"] [data-lab]`).forEach((t) => {
    const was = before.get(t.dataset.lab!);
    if (!was || was.at === t.dataset.at) return;
    const r = t.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(t.closest(".strip")!).getPropertyValue("--strip-scale")) || 1;
    const dx = (was.x - (r.left + r.width / 2)) / scale, dy = (was.y - (r.top + r.height / 2)) / scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const label = (t.tagName === "text" ? t : t.querySelector("text")!) as SVGTextElement;
    label.classList.remove("is-new", "is-swap");
    const word = label.textContent ?? "";
    const tie = t.parentElement?.querySelector<SVGPathElement>(`[data-tie="${t.dataset.at}"]`);
    tie?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], { duration: 650 + wait });
    // a straight, even glide along the line to the commit it now points at
    t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: 480, delay: wait, fill: "backwards", easing: "cubic-bezier(.4,0,.2,1)" });
    // and on the way, the old words are backspaced and the new ones typed in
    if (was.text !== word) { label.textContent = was.text; setTimeout(() => typeOver(label, was.text, word, 900), wait); }
  });
}

/* content that grows or shrinks eases to its new height instead of snapping
 * (fast: 240 ms); the element clips while it moves */
function easeHeight(node: HTMLElement, from: number) {
  if (instant || prefersReduced || !from) return;
  const to = node.getBoundingClientRect().height;
  if (Math.abs(to - from) < 2) return;
  node.getAnimations().filter((a) => (a as Animation & { id?: string }).id === "ease-h").forEach((a) => a.cancel());
  node.classList.add("is-easing");
  const a = node.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
  (a as Animation & { id?: string }).id = "ease-h";
  a.finished.then(() => node.classList.remove("is-easing"), () => node.classList.remove("is-easing"));
}

/* places that move because something above them changed float to their new
 * spot, and places that grew or shrank ease to their new height */
function floatPlaces(before: Map<string, DOMRect>) {
  if (instant || prefersReduced) return;
  document.querySelectorAll<HTMLElement>("#world .place[data-place]").forEach((p) => {
    const was = before.get(p.dataset.place!);
    if (!was || p.classList.contains("is-new")) return;
    const now = p.getBoundingClientRect();
    const dy = was.top - now.top;
    if (Math.abs(dy) > 1) p.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
    easeHeight(p, was.height);
  });
}

function renderWorld() {
  const heres = hereSpots();
  const placeRects = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>("#world .place[data-place]").forEach((p) => placeRects.set(p.dataset.place!, p.getBoundingClientRect()));
  const root = $("#world");
  const view = "places";
  if (root.dataset.view !== view) {
    root.innerHTML = view === "places" ? `<div class="world__recap"></div>` : "";
    root.dataset.view = view;
    parts.clear(); // everything cached for the old view is gone from the page
  }
  setPart(root.querySelector(".world__recap"), ci === chapters.length - 1 ? mapHtml(true) : "");
  const cols = columns();
  const order: Place[] = ["github", "you", "albert"];
  let prev: Element = root.querySelector(".world__recap")!;
  for (const id of order) {
    let sec = root.querySelector<HTMLElement>(`[data-place="${id}"]`);
    const present = id === "you" || !!w.repos[id];
    if (!present) { sec?.remove(); continue; }
    if (!sec) {
      sec = document.createElement("section");
      sec.className = `place place--${id}${instant ? "" : " is-new"}`;
      sec.dataset.place = id;
      sec.innerHTML = `<header class="place__head"></header><div class="place__rows"></div><div class="place__prs"></div>`;
      sec.addEventListener("animationend", () => sec!.classList.remove("is-new"), { once: true });
      prev.after(sec);
    }
    prev = sec;
    setPart(sec.querySelector(".place__head"), headHtml(id));
    // one row per desk (a worktree adds a desk): its folder, and its own graph
    // with that desk's HEAD; the history itself is shared
    const r = w.repos[id];
    const n = id === "github" ? 1 : Math.max(1, r?.desks.length ?? 1);
    const rowsBox = sec.querySelector<HTMLElement>(".place__rows")!;
    while (rowsBox.children.length > n) rowsBox.lastElementChild!.remove();
    while (rowsBox.children.length < n) {
      const i = rowsBox.children.length;
      const row = document.createElement("div");
      row.className = `place__grid${instant || i === 0 ? "" : " is-new"}`;
      row.innerHTML = `<div class="place__left"></div><div class="strip" data-strip="${i ? `${id}:${i}` : id}"></div>`;
      row.addEventListener("animationend", () => row.classList.remove("is-new"), { once: true });
      rowsBox.append(row);
    }
    [...rowsBox.children].forEach((row, i) => {
      const key = i ? `${id}:${i}` : id;
      setPart(row.querySelector(".place__left"), id === "github" ? ghLeftHtml() : r ? deskHtml(id as "you" | "albert", r, i) : deskHtml("you", null, 0));
      const strip = row.querySelector<HTMLElement>(".strip")!;
      if (r) { if (!strip.querySelector("svg")) { strip.innerHTML = `<svg class="strip__svg"></svg>`; parts.delete(strip); } }
      else setPart(strip, `<p class="strip__empty">No version history yet.<br>Just files.</p>`);
      glideStrip(key, cols, heres);
    });
    setPart(sec.querySelector(".place__prs"), id === "github" ? prsHtml() : "");
  }
  // file state chips that changed get a little pop, so you see what moved
  root.querySelectorAll<HTMLElement>("[data-state-key]").forEach((chip) => {
    const k = chip.dataset.stateKey!, s = chip.dataset.state!;
    const was = fileStateSeen.get(k);
    if (was !== undefined && was !== s && !instant) chip.classList.add("pop");
    fileStateSeen.set(k, s);
  });
  syncScroll();
  floatPlaces(placeRects);
}

/* the idea in one picture: two computers, one shared copy online */
function mapHtml(recap = false): string {
  return `<div class="map ${recap ? "map--recap" : ""}">
    <div class="map__gh"><span class="ico ico--cloud"></span><b>GitHub</b><span>the shared copy, online</span>
      ${recap ? `<em>pull request → review → merge</em>` : ""}</div>
    <div class="map__arrows">
      <span class="up">push ↑</span><span class="down">↓ pull, clone</span>
      <span class="up">push ↑</span><span class="down">↓ pull, clone</span>
    </div>
    <div class="map__pcs">
      <div><span class="ico ico--laptop"></span><b>Your computer</b><span>your files and every version</span>${recap ? `<em>edit → stage → commit, on any branch</em>` : ""}</div>
      <div class="map__friend"><span class="ico ico--laptop"></span><b>${recap ? "Albert's computer" : "A friend's computer"}</b><span>their copy: the same history</span>${recap ? `<em>clone once, then pull and push</em>` : ""}</div>
    </div>
    ${recap ? "" : `<p class="map__note">Everyone has the <b>whole</b> history on their own computer. GitHub is the copy everyone agrees to share through.</p>`}
  </div>`;
}

function headHtml(id: Place): string {
  const r = w.repos[id];
  const title = id === "github" ? "GitHub" : id === "you" ? "Your computer" : "Albert's computer";
  const sub = id === "github" ? "github.com/you/my-report · the shared copy" : id === "you" ? "your laptop" : "Albert's laptop, at his place";
  let badge = "";
  if (r && id !== "github") {
    const ab = G.aheadBehind(w, r, r.desks[0]);
    if (ab) {
      if (ab.ahead && ab.behind) badge = `<span class="badge badge--warn">different from GitHub</span>`;
      else if (ab.ahead) badge = `<span class="badge badge--warn">${ab.ahead} version${ab.ahead > 1 ? "s" : ""} not uploaded</span>`;
      else if (ab.behind) badge = `<span class="badge badge--warn">GitHub has ${ab.behind} newer</span>`;
      else badge = `<span class="badge badge--ok">same as GitHub</span>`;
    }
  }
  return `<span class="ico ${id === "github" ? "ico--cloud" : "ico--laptop"}"></span><h3>${id === "github" ? whyGithub() : title}</h3><span class="place__sub">${sub}</span>${badge}`;
}


/* the main file as it is in this folder right now; lines you changed since the
 * last saved version are marked, so you can see what a commit will hold */
function peekHtml(d: G.Desk | null, r: G.Repo | null): string {
  const text = d ? d.work[MAIN_FILE] : w.folder?.[MAIN_FILE];
  if (text === undefined) return "";
  const base = d && r ? G.treeOf(w, G.headId(r, d))[MAIN_FILE] : text;
  const diff = base === undefined ? text.replace(/\n$/, "").split("\n").map((s) => ({ t: "+" as const, s })) : G.lineDiff(base, text);
  const fresh = base === undefined; // never committed: nothing to compare with yet
  const lines = diff.filter((l) => l.s.trim() !== "").slice(0, 14);
  return `<div class="peek" aria-label="${MAIN_FILE} right now"><p class="peek__name">${MAIN_FILE}</p>${lines.map((l) =>
    `<div class="peek__l ${!fresh && l.t === "+" ? "is-new" : ""} ${!fresh && l.t === "-" ? "is-gone" : ""} ${/^(<<<<<<<|=======|>>>>>>>)/.test(l.s) ? "is-mark" : ""}">${typos(esc(l.s))}</div>`).join("")}</div>`;
}

/* the lesson's planted typo (and a few classics) get the familiar red squiggle,
 * the way a word processor marks them, so it's obvious something needs fixing */
const TYPOS = /\b(helpd|teh|recieve|seperate|wich|untill|definately)\b/gi;
const typos = (html: string) => html.replace(TYPOS, '<span class="typo" title="spelling">$1</span>');

function deskHtml(place: "you" | "albert", r: G.Repo | null, i: number): string {
  const d = r?.desks[i] ?? null;
  const files = r && d ? G.fileStates(w, r, d) : Object.keys(w.folder ?? {}).sort().map((p) => ({ path: p, state: "plain" as const }));
  const name = d ? d.path.replace("~/", "") : "my-report";
  const on = d ? (d.detached ? `<span class="desk__on">looking at an old version</span>` : `<span class="desk__on">on <b style="color:${colorOf(d.branch!)}">${esc(d.branch!)}</b></span>`) : "";
  const label = r && r.desks.length > 1 ? `<span class="desk__n">desk ${i + 1}</span>` : "";
  return `<div class="desk">
    <p class="desk__title"><span class="folder"></span>${esc(name)}${label} ${on}</p>
    <ul class="files">${files.map((f) => `<li class="file-row">
      <button type="button" class="fname" data-file="${f.path}" data-place="${place}" data-desk="${i}">${esc(f.path)}</button>
      ${f.state === "plain" ? "" : `<span class="state state--${f.state.replace("+", "-")}" data-state-key="${place}:${i}:${f.path}" data-state="${f.state}" data-path="${f.path}">${STATE_WORDS[f.state]}</span>`}
    </li>`).join("")}</ul>
    ${place === "you" ? peekHtml(d, r) : ""}
  </div>`;
}

function ghLeftHtml(): string {
  const gh = w.repos.github;
  const bs = Object.keys(gh.branches).sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)));
  const tree = G.treeOf(w, gh.branches.main);
  return `<div class="desk desk--gh">
    <p class="desk__title">${bs.length > 1 ? "Branches" : "Branch"}</p>
    <ul class="branches">${bs.map((b) => `<li><span class="dot" style="background:${colorOf(b)}"></span>${esc(b)}</li>`).join("")}</ul>
    <p class="gh-files">Files: ${Object.keys(tree).sort().map((p) => `<button type="button" class="fname" data-file="${p}" data-place="github" data-desk="0">${esc(p)}</button>`).join(" ")}</p>
  </div>`;
}

function prsHtml(): string {
  if (!w.prs.length) return "";
  const gh = w.repos.github;
  return w.prs.map((p) => {
    const headId = p.state === "merged" ? w.commits[p.mergeCommit!].parents[1] : gh.branches[p.head];
    const baseId = p.state === "merged" ? w.commits[p.mergeCommit!].parents[0] : gh.branches[p.base];
    // what the PR changes: from where the branch split off to its tip
    const base = [...G.ancestors(w, baseId)].filter((id) => G.ancestors(w, headId).has(id)).map((id) => w.commits[id]).sort((a, b) => b.n - a.n)[0];
    const diff = G.lineDiff(G.treeOf(w, base?.id)[MAIN_FILE], G.treeOf(w, headId)[MAIN_FILE]).filter((l) => l.t !== " ");
    const state = p.state === "merged" ? `<span class="pr__state pr__state--merged">Merged</span>` : `<span class="pr__state">Open</span>`;
    if (p.state === "merged" && ci !== PR_CHAPTER) {
      return `<p class="pr pr--line">${state} <b>Pull request #${p.n}, ${esc(p.title)}</b> <span class="pr__meta">${esc(p.head)} → ${esc(p.base)}</span></p>`;
    }
    return `<article class="pr">
      <header class="pr__head">${state}<h4>${esc(p.title)} <span>#${p.n}</span></h4>
        <p class="pr__meta">You want to merge <b style="color:${colorOf(p.head)}">${esc(p.head)}</b> into <b style="color:${colorOf(p.base)}">${esc(p.base)}</b></p></header>
      <div class="pr__diff"><p class="pr__file">${MAIN_FILE}</p>${diff.map((l) => `<div class="dl dl--${l.t === "+" ? "add" : "del"}">${l.t} ${esc(l.s)}</div>`).join("") || `<div class="dl">(no changes)</div>`}</div>
      ${p.comments.map((c) => `<div class="pr__comment"><b>${esc(c.who)}</b> ${esc(c.text)}</div>`).join("")}
      ${p.approved ? `<p class="pr__ok">✓ Toby approved these changes</p>` : ""}
    </article>`;
  }).join("");
}

/* every commit any visible place has, oldest first: one column each */
function columns(): string[] {
  const all = new Set<string>();
  for (const r of Object.values(w.repos)) placeCommits(r).forEach((id) => all.add(id));
  return [...all].sort((a, b) => w.commits[a].n - w.commits[b].n);
}
function placeCommits(r: G.Repo): Set<string> {
  const s = new Set<string>();
  [...Object.values(r.branches), ...r.desks.map((d) => d.detached).filter(Boolean) as string[]]
    .forEach((id) => G.ancestors(w, id).forEach((x) => s.add(x)));
  return s;
}

/* which lane (row of the strip) each commit sits on: main's line at the
 * bottom, every other branch's own commits on a lane above it */
function lanes(r: G.Repo): Map<string, { lane: number; br: string }> {
  const m = new Map<string, { lane: number; br: string }>();
  const walk = (id: string | undefined, lane: number, br: string) => {
    while (id && !m.has(id)) { m.set(id, { lane, br }); id = w.commits[id].parents[0]; }
  };
  walk(r.branches.main, 0, "main");
  let k = 0;
  const others = Object.keys(r.branches).filter((b) => b !== "main")
    .sort((a, b) => w.commits[r.branches[a]].n - w.commits[r.branches[b]].n);
  for (const b of others) if (!m.has(r.branches[b])) walk(r.branches[b], 1 + (k++ % 2), b);
  // commits only reachable through merges (a merged branch that was deleted)
  for (const id of placeCommits(r)) if (!m.has(id)) m.set(id, { lane: 1, br: "?" });
  r.desks.forEach((d) => { if (d.detached && !m.has(d.detached)) walk(d.detached, 1, "?"); });
  return m;
}

/* how big a strip is drawn and how far apart its commits sit: a short history
 * is drawn big and spread out to fill the space beside the folder; as it grows
 * it shrinks back to normal and only then scrolls */
function layoutOf(host: HTMLElement, cols: string[]) {
  const n = Math.max(1, cols.length - 1);
  const avail = Math.max(0, host.clientWidth - 16); // a little slack so rounding never adds a scrollbar
  const scale = Math.max(1, Math.min(1.6, avail / (X0 * 2 + 30 + n * COL)));
  const col = cols.length > 1 ? Math.max(COL, Math.min(COL * 2.4, (avail / scale - X0 * 2 - 30) / n)) : COL;
  return { scale, col };
}

/* frame: an in-between drawing while the layout glides from the old spacing
 * to the new one; it draws only commits that were already there, inks nothing */
function drawStrip(id: string, cols: string[], frame?: { scale: number; col: number; only: Set<string>; k: number }) {
  const [rid, dk] = id.split(":");
  const r = w.repos[rid];
  // a strip with a desk number shows that desk's HEAD; a repo with several desks
  // gives each its own strip, so the plain id is desk 1
  const deskOnly = dk !== undefined ? Number(dk) : (r && r.desks.length > 1 ? 0 : undefined);
  const host = document.querySelector<HTMLElement>(`[data-strip="${id}"]`);
  const svg = host?.querySelector<SVGSVGElement>("svg");
  if (!r || !svg) return;
  const all = placeCommits(r);
  const have = frame ? new Set([...all].filter((c) => frame.only.has(c))) : all;
  const L = lanes(r);
  const maxLane = Math.max(0, ...[...L.values()].map((v) => v.lane));
  let topPad = 0; // room above the top lane for labels of branch commits
  const laneY = (l: number) => 26 + topPad + (maxLane - l) * 44;
  const { scale, col } = frame ?? layoutOf(host!, cols);
  if (!frame) { lastLayout.set(id, { scale, col }); lastHave.set(id, all); }
  const x = (cid: string) => X0 + cols.indexOf(cid) * col;
  // labels under each column: you-are-here markers, then branch names
  const labels = new Map<string, { text: string; color: string; here?: boolean; desk?: number }[]>();
  const push = (cid: string, v: { text: string; color: string; here?: boolean; desk?: number }) => { const a = labels.get(cid) ?? []; a.push(v); labels.set(cid, a); };
  if (!r.bare) r.desks.forEach((d, i) => {
    if (deskOnly !== undefined && i !== deskOnly) return;
    const h = G.headId(r, d);
    const learned = headKnown();
    if (h) push(h, { text: learned ? (rid === "albert" ? "Albert's HEAD" : "HEAD") : (rid === "albert" ? "Albert is here" : "you are here"), color: "var(--ink)", here: true, desk: i });
  });
  Object.entries(r.branches).sort(([a], [b]) => (a === "main" ? -1 : b === "main" ? 1 : 0)).forEach(([b, cid]) => push(cid, { text: b, color: colorOf(b) }));
  // mid-glide, labels stay where they were before the change and move with
  // their commit; they reach their new spots once the glide lands
  if (frame) {
    // each label keeps riding its old commit; if that commit is gone (Undo),
    // it shows at its new one instead, so a marker never vanishes mid-glide
    const now = new Map(labels), old = lastLabels.get(id) ?? new Map();
    const key = (lb: { here?: boolean; desk?: number; text: string }) => (lb.here ? `here:${lb.desk}` : `br:${lb.text}`);
    const placed = new Set<string>();
    labels.clear();
    const add = (cid: string, lb: { text: string; color: string; here?: boolean; desk?: number }) => {
      if (placed.has(key(lb))) return;
      placed.add(key(lb));
      labels.set(cid, [...(labels.get(cid) ?? []), lb]);
    };
    old.forEach((arr: { text: string; color: string; here?: boolean; desk?: number }[], cid: string) => { if (have.has(cid)) arr.forEach((lb) => add(cid, lb)); });
    now.forEach((arr, cid) => arr.forEach((lb) => add(cid, lb)));
  }
  else lastLabels.set(id, new Map(labels));
  // labels of commits on main hang below the line; labels of commits on a
  // branch lane sit right above them, so a branch name is next to its branch
  const above = (cid: string) => (L.get(cid)?.lane ?? 0) > 0;
  topPad = Math.max(0, ...[...labels].filter(([c]) => above(c)).map(([, a]) => a.length * 21 + 8));
  const baseY = laneY(0);
  const maxLabels = Math.max(1, ...[...labels].filter(([c]) => !above(c)).map(([, a]) => a.length));
  const H = baseY + 34 + maxLabels * 21;
  const W = X0 * 2 + 30 + Math.max(0, cols.length - 1) * col;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  host!.style.setProperty("--strip-scale", String(scale));
  svg.setAttribute("width", String(Math.floor(W * scale)));
  svg.setAttribute("height", String(Math.floor(H * scale)));
  svg.innerHTML = "";
  const seen = drawn.get(id) ?? new Set<string>();
  drawn.set(id, seen);
  const gEdges = el("g", { class: "edges" }), gNodes = el("g", { class: "nodes" }), gLabels = el("g", { class: "labels" });
  svg.append(gEdges, gNodes, gLabels);
  const ink = (p: SVGPathElement, key: string, dur = 400) => {
    if (frame) return;
    if (instant || seen.has(key)) { seen.add(key); return; }
    seen.add(key);
    void drawOn(p, { duration: dur });
  };
  const seed = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  for (const cid of cols) {
    if (!have.has(cid)) continue;
    const c = w.commits[cid];
    const me = L.get(cid)!;
    const cx = x(cid), cy = laneY(me.lane);
    c.parents.forEach((p, pi) => {
      if (!have.has(p)) return;
      const pl = L.get(p)!;
      const px = x(p), py = laneY(pl.lane);
      const d = py === cy ? linePath(px + 13, py, cx - 13, cy, seed(cid) + pi)
        : smooth([[px + 10, py] as Point, [px + (cx - px) * 0.55, py + (cy - py) * 0.15], [cx - 12, cy]]);
      const col = colorOf(pi === 1 ? L.get(p)!.br : me.br);
      const path = el("path", { d, class: "edge", stroke: col, "data-to": cid }) as SVGPathElement;
      gEdges.append(path);
      ink(path, `e:${p}>${cid}`);
    });
    const col = colorOf(me.br);
    const g = el("g", { class: "commit", "data-c": cid, style: `transform-origin:${cx}px ${cy}px` });
    const node = el("path", { d: circlePath(cx, cy, 12, seed(cid)), class: "node", stroke: col }) as SVGPathElement;
    const t = el("title");
    t.textContent = `${c.msg}\nby ${c.author} · ${G.short(cid)}`;
    g.append(t, node);
    if (c.author !== "You") {
      const s = el("text", { x: cx, y: cy + 4.5, class: "node__who" });
      s.textContent = c.author[0];
      g.append(s);
    }
    if (c.parents.length > 1) g.append(el("path", { d: circlePath(cx, cy, 5, seed(cid) + 3), class: "node__merge", stroke: col }));
    gNodes.append(g);
    ink(node, `n:${cid}`, 340);
  }
  for (const [cid, arr] of labels) {
    if (!have.has(cid)) continue;
    const cx = x(cid);
    const top = laneY(L.get(cid)?.lane ?? 0);
    const up = above(cid);
    gLabels.append(el("path", { d: up ? linePath(cx, top - 14, cx, top - 17, seed(cid)) : linePath(cx, top + 14, cx, baseY + 26, seed(cid)), class: "label__tie", "data-tie": cid }));
    arr.forEach((lb, i) => {
      const y = up ? top - 24 - i * 21 : baseY + 42 + i * 21;
      // mid-glide a HEAD marker moves from its old column toward its new one
      const lx = cx; // mid-glide, labels ride along with their commit
      const tx = el("text", { x: lx, y, class: `label ${lb.here ? "label--here" : ""}`, fill: lb.color });
      tx.textContent = lb.text;
      if (lb.here) {
        // HEAD (or "you are here") travels as one piece: a little hand-drawn
        // ink arrowhead pointing up at the commit, with the word under it
        const g = el("g", { class: "here", "data-here": `${id}:${lb.desk}`, "data-lab": `${id}:here:${lb.desk}`, "data-at": cid });
        const s = seed(cid) % 7;
        g.append(el("path", {
          class: "here__arrow",
          // straight sides like a pen stroke, the base sagging a hair
          // under the commit it points up at it; above a branch commit it points down
          d: up ? `M ${lx - 4.6} ${y + 3.6} L ${lx + 0.2 + s * 0.05} ${y + 11.4} L ${lx + 4.7} ${y + 3.3} Q ${lx} ${y + 2.6} ${lx - 4.6} ${y + 3.6} Z`
            : `M ${lx - 4.6} ${y - 12.6} L ${lx + 0.2 + s * 0.05} ${y - 20.6} L ${lx + 4.7} ${y - 12.3} Q ${lx} ${y - 11.5} ${lx - 4.6} ${y - 12.6} Z`,
        }), tx);
        gLabels.append(g);
      } else {
        tx.setAttribute("data-lab", `${id}:br:${lb.text}`);
        tx.setAttribute("data-at", cid);
        gLabels.append(tx);
      }
      if (frame) return;
      const k = `l:${cid}:${lb.text}`;
      // the plain label turning into the git word gets a little bounce
      const swapped = lb.here && /HEAD/.test(lb.text) && !seen.has(k) && [...seen].some((x) => x.startsWith(`l:${cid}:`) && /is here$/.test(x));
      if (!instant && !seen.has(k)) tx.classList.add(swapped ? "is-swap" : "is-new");
      seen.add(k);
    });
  }
}

/* when a change re-spaces a strip (a new commit makes room), everything that
 * was already there glides to its new spot; new commits are inked once it lands */
const lastLayout = new Map<string, { scale: number; col: number }>();
const lastHave = new Map<string, Set<string>>();
const lastLabels = new Map<string, Map<string, { text: string; color: string; here?: boolean; desk?: number }[]>>();
const tweens = new Map<string, number>();
let settleUntil = 0;
function glideStrip(id: string, cols: string[], heres: ReturnType<typeof hereSpots>) {
  const host = document.querySelector<HTMLElement>(`[data-strip="${id}"]`);
  const prev = lastLayout.get(id), had = lastHave.get(id);
  window.cancelAnimationFrame(tweens.get(id) ?? 0);
  const finish = (glided = false) => {
    // labels start from where the glide left them; if a new commit appeared,
    // they hold still while it is drawn and connected, then step onto it
    const from = glided ? hereSpots() : heres;
    const grew = !!had && [...placeCommits(w.repos[id.split(":")[0]])].some((c) => !had.has(c));
    host?.classList.remove("is-gliding");
    drawStrip(id, cols);
    if (!instant) slideHere(from, id, grew ? 380 : 0);
    syncScroll();
  };
  if (instant || prefersReduced || !host || !prev || !had || !w.repos[id.split(":")[0]]) return finish();
  const next = layoutOf(host, cols);
  if (Math.abs(next.scale - prev.scale) < 0.01 && Math.abs(next.col - prev.col) < 0.5) return finish();
  const dur = 320, t0 = performance.now();
  host.classList.add("is-gliding"); // no scrollbar flashing while it moves
  settleUntil = Math.max(settleUntil, t0 + dur);
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    const k = ease(Math.min(1, (now - t0) / dur));
    if (k >= 1) return finish(true);
    drawStrip(id, cols, { scale: prev.scale + (next.scale - prev.scale) * k, col: prev.col + (next.col - prev.col) * k, only: had, k });
    tweens.set(id, window.requestAnimationFrame(step));
  };
  tweens.set(id, window.requestAnimationFrame(step));
}

/* keep every strip scrolled together, and pinned to the newest versions */
function syncScroll() {
  const strips = [...document.querySelectorAll<HTMLElement>(".strip")];
  strips.forEach((s) => {
    s.scrollLeft = s.scrollWidth;
    s.onscroll = () => strips.forEach((o) => { if (o !== s && Math.abs(o.scrollLeft - s.scrollLeft) > 1) o.scrollLeft = s.scrollLeft; });
  });
}

/* --------------------------------------------------------------- feedback */

/* what each place held before an action, and where its staged files sat on
 * screen, so the change can be animated from the old picture to the new */
interface FxSnap { have: Record<string, Set<string>>; staged: { path: string; place: string; rect: DOMRect }[] }
function snapshotFx(): FxSnap {
  const have: Record<string, Set<string>> = {};
  for (const [id, r] of Object.entries(w.repos)) have[id] = placeCommits(r);
  const staged = [...document.querySelectorAll<HTMLElement>("[data-state-key]")]
    .filter((c) => /^staged/.test(c.dataset.state!) && c.dataset.state !== "staged-deleted")
    .map((c) => ({ path: c.dataset.path!, place: c.dataset.stateKey!.split(":")[0], rect: c.closest(".file-row")!.getBoundingClientRect() }));
  return { have, staged };
}

const nodeEl = (place: string, cid: string) =>
  document.querySelector<SVGGElement>(`[data-strip="${place}"] [data-c="${cid}"]`);
const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function celebrate(before: FxSnap, ok: boolean, who: Who = "you") {
  if (!ok) {
    const box = $("#lesson").querySelector<HTMLElement>(".do");
    box?.classList.add("shake");
    return;
  }
  if (prefersReduced) return;
  const wait = Math.max(0, settleUntil - performance.now());
  if (wait > 0) { setTimeout(() => celebrate(before, ok, who), wait + 20); return; }
  requestAnimationFrame(() => {
    let delay = 0;
    for (const [id, r] of Object.entries(w.repos)) {
      const was = before.have[id] ?? new Set<string>();
      const fresh = [...placeCommits(r)].filter((c) => !was.has(c)).sort((a, b) => w.commits[a].n - w.commits[b].n);
      for (const cid of fresh) {
        const target = nodeEl(id, cid);
        if (!target) continue;
        // came from another place: a dot travels from there to here
        // what lands on a laptop (clone, pull) always comes from GitHub; what
        // lands on GitHub comes from whoever pushed it
        const order = id === "github" ? [who, ...Object.keys(before.have)] : ["github"];
        const from = order.find((o) => o !== id && before.have[o]?.has(cid) && nodeEl(o, cid));
        // a place that just appeared slides in first; wait for it to settle
        if (target.closest(".place.is-new")) delay = Math.max(delay, 480);
        if (from) travel(nodeEl(from, cid)!, target, id === "github" ? "push" : "pull", delay);
        else saved(target, w.commits[cid], before.staged.filter((s) => s.place === id), delay);
        delay += 110;
      }
    }
  });
}

function fx(): HTMLElement { return $("#fx"); }

/* a new commit: the packed files fly into the dot, the dot pops, the note floats up */
function saved(target: SVGGElement, c: G.Commit, files: { path: string; rect: DOMRect }[], delay: number) {
  const to = centre(target.getBoundingClientRect());
  const fly = files.length ? 420 : 0;
  files.slice(0, 4).forEach((f, i) => {
    const chip = document.createElement("span");
    chip.className = "fx-file";
    chip.textContent = f.path;
    chip.style.left = `${f.rect.left}px`;
    chip.style.top = `${f.rect.top}px`;
    fx().append(chip);
    const dx = to.x - f.rect.left - 30, dy = to.y - f.rect.top - 10;
    chip.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(.8)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0 },
    ], { duration: fly, delay: delay + i * 60, easing: "cubic-bezier(.5,0,.6,1)" }).finished.then(() => chip.remove());
  });
  setTimeout(() => {
    pop(target);
    ring(to, "var(--accent)");
    const note = document.createElement("span");
    note.className = "fx-note";
    note.innerHTML = `✓ new version: <b>${esc(c.msg)}</b>`;
    note.style.left = `${to.x}px`;
    note.style.top = `${to.y - 44}px`;
    fx().append(note);
    note.animate([
      { transform: "translate(-50%, 6px) scale(.9)", opacity: 0 },
      { transform: "translate(-50%, -6px) scale(1)", opacity: 1, offset: 0.2 },
      { transform: "translate(-50%, -10px)", opacity: 1, offset: 0.8 },
      { transform: "translate(-50%, -22px)", opacity: 0 },
    ], { duration: 1600, easing: "ease-out" }).finished.then(() => note.remove());
  }, delay + fly + files.length * 40);
}

/* a commit travels between places: a dot flies from one row to the other */
function travel(from: SVGGElement, to: SVGGElement, kind: "push" | "pull", delay: number) {
  to.style.opacity = "0";
  // the line into this commit waits for it too, and is drawn as the dot lands
  const lines = [...(to.ownerSVGElement?.querySelectorAll<SVGPathElement>(`.edge[data-to="${to.dataset.c}"]`) ?? [])];
  lines.forEach((l) => { l.style.opacity = "0"; void drawOn(l, { duration: 1 }); });
  setTimeout(() => fly(from, to, kind, lines), delay);
}
function fly(from: SVGGElement, to: SVGGElement, kind: "push" | "pull", lines: SVGPathElement[] = []) {
  const delay = 0;
  const a = centre(from.getBoundingClientRect()), b = centre(to.getBoundingClientRect());
  const dot = document.createElement("span");
  dot.className = `fx-dot fx-dot--${kind}`;
  dot.style.left = `${a.x}px`;
  dot.style.top = `${a.y}px`;
  fx().append(dot);
  to.style.opacity = "0";
  const lift = Math.min(60, Math.abs(b.y - a.y) * 0.25);
  dot.animate([
    { transform: "translate(-50%,-50%) scale(.6)" },
    { transform: `translate(calc(-50% + ${(b.x - a.x) * 0.5 + 18}px), calc(-50% + ${(b.y - a.y) * 0.5 - lift}px)) scale(1.15)`, offset: 0.5 },
    { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.9)` },
  ], { duration: 460, delay, easing: "cubic-bezier(.45,0,.35,1)" }).finished.then(() => {
    dot.remove();
    lines.forEach((l) => { l.style.opacity = ""; void drawOn(l, { duration: 240 }); });
    to.style.opacity = "";
    pop(to);
    ring(b, kind === "push" ? "var(--pen-remote)" : "var(--pen-blue)");
  });
}

function pop(g: SVGGElement) {
  g.classList.remove("is-pop");
  void g.getBoundingClientRect();
  g.classList.add("is-pop");
}
function ring(p: { x: number; y: number }, color: string) {
  const r = document.createElement("span");
  r.className = "fx-ring";
  r.style.left = `${p.x}px`;
  r.style.top = `${p.y}px`;
  r.style.borderColor = color;
  fx().append(r);
  r.animate([{ transform: "translate(-50%,-50%) scale(.4)", opacity: 0.9 }, { transform: "translate(-50%,-50%) scale(2.6)", opacity: 0 }],
    { duration: 620, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(() => r.remove());
}

/* ----------------------------------------------------------------- editor */

let edit: { place: Place; desk: number; file: string } | null = null;

function openEditor(place: Place, deskI: number, file: string) {
  const dlg = $("#editor") as unknown as HTMLDialogElement;
  const ta = $<HTMLTextAreaElement>("#editor-text");
  const r = w.repos[place];
  const readOnly = place !== "you";
  let text: string;
  if (place === "github") text = G.treeOf(w, r.branches.main)[file] ?? "";
  else if (!r) text = w.folder?.[file] ?? "";
  else text = r.desks[deskI].work[file] ?? "";
  edit = { place, desk: deskI, file };
  const d = r?.desks[deskI];
  $("#editor-where").textContent = place === "github" ? "On GitHub, branch main (read only)" : place === "albert" ? "On Albert's laptop (read only)"
    : d ? `On your laptop, in ${d.path.replace("~/", "")}${d.branch ? `, branch ${d.branch}` : ""}` : "On your laptop";
  $("#editor-title").textContent = file;
  ta.value = text;
  ta.readOnly = readOnly;
  $("#editor-save").hidden = readOnly;
  // other files in the same folder, as tabs
  const files = place === "github" ? Object.keys(G.treeOf(w, r.branches.main)) : r ? Object.keys(r.desks[deskI].work) : Object.keys(w.folder ?? {});
  const beatFiles = beat().edit?.files;
  $("#editor-tabs").innerHTML = files.length > 1 && place === "you"
    ? files.sort().map((f) => `<button type="button" class="tab ${f === file ? "is-on" : ""}" data-tab="${f}">${esc(f)}${beatFiles?.includes(f) ? " ✎" : ""}</button>`).join("") : "";
  $("#editor-tabs").querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    saveEditor(false);
    openEditor(place, deskI, b.dataset.tab!);
  }));
  $("#editor-note").innerHTML = readOnly ? "" : beat().kind === "edit" && beat().edit?.files.includes(file) && !beatDone
      ? `Your task: <b>${esc(beat().edit!.ask(w))}</b>. Type anywhere in the file.` : "";
  renderResolver(text, readOnly);
  if (!dlg.open) dlg.showModal();
  fitEditor();
  if (!readOnly && !G.hasMarkers(text)) {
    ta.focus();
    const end = text.indexOf("\n\n", text.indexOf("- "));
    ta.setSelectionRange(end > 0 ? end : text.length, end > 0 ? end : text.length);
  }
}

/* the editor is as tall as its text plus one empty line, and grows as you type */
function fitEditor() {
  const ta = $<HTMLTextAreaElement>("#editor-text");
  const line = parseFloat(getComputedStyle(ta).lineHeight) || 22;
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight + line}px`;
}

/* the conflict picker: choosing a side only previews it in the file below;
 * nothing is kept until Save file, and Start over brings the conflict back */
function renderResolver(text: string, readOnly: boolean, picked = "") {
  const box = $("#resolver");
  const m = text.match(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n?/);
  if (!m || readOnly) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const opt = (key: string, cls: string, label: string, code: string) =>
    `<button type="button" class="pick ${cls} ${picked === key ? "is-picked" : ""}" data-pick="${key}" aria-pressed="${picked === key}"><span>${label}</span><code>${code}</code></button>`;
  box.innerHTML = `<p class="resolver__k">The same line, changed two ways. Which should the report say?</p>
    <div class="resolver__opts">
      ${opt("mine", "", "Your version", esc(m[1].trim()))}
      ${opt("theirs", "pick--friend", "Albert's version", esc(m[2].trim()))}
      ${opt("both", "pick--both", "Keep both lines", `${esc(m[1].trim())}<br>${esc(m[2].trim())}`)}
    </div>
    <p class="resolver__raw">${picked ? `Previewing your pick in the file below. Happy with it? Press <b>Save file</b>. <button type="button" class="resolver__reset" data-reset>Start over</button>`
      : "The file below is how git left it: your version between <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> and <code>=======</code>, Albert's between <code>=======</code> and <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>. Pick above, or fix it by hand."}</p>`;
  box.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    const keep = b.dataset.pick === "mine" ? m[1] : b.dataset.pick === "theirs" ? m[2] : m[1] + m[2];
    $<HTMLTextAreaElement>("#editor-text").value = text.replace(m[0], () => keep);
    fitEditor();
    renderResolver(text, readOnly, b.dataset.pick);
  }));
  box.querySelector("[data-reset]")?.addEventListener("click", () => {
    $<HTMLTextAreaElement>("#editor-text").value = text;
    fitEditor();
    renderResolver(text, readOnly);
  });
}

function saveEditor(close: boolean) {
  if (!edit || edit.place !== "you") return;
  keepForUndo();
  const r = w.repos.you;
  const text = $<HTMLTextAreaElement>("#editor-text").value.replace(/\r/g, "");
  const fixed = text.endsWith("\n") ? text : text + "\n";
  if (r) r.desks[edit.desk].work[edit.file] = fixed;
  else if (w.folder) w.folder[edit.file] = fixed;
  if (close) ($("#editor") as unknown as HTMLDialogElement).close();
  afterChange();
}

/* ------------------------------------------------------------------- boot */

/* Ctrl+Shift+R starts fresh. A hard refresh skips the browser cache, so the
 * forever-cached reload-probe.js comes over the network (transferSize > 0);
 * on a normal reload it comes from cache (0). Only then is progress wiped. */
function hardRefresh(): boolean {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== "reload") return false;
  const probe = performance.getEntriesByType("resource").find((e) => e.name.includes("reload-probe.js")) as PerformanceResourceTiming | undefined;
  // a full download carries headers plus body; a revalidated copy (304) only headers
  return !!probe && probe.transferSize > 0 && probe.transferSize > probe.encodedBodySize;
}

function boot() {
  if (hardRefresh()) {
    try { localStorage.removeItem(KEY); localStorage.removeItem("htg-intro-seen"); } catch { /* private mode */ }
  }
  const q = new URLSearchParams(location.search);
  const qm = q.get("mode") as Mode | null;
  // your typed choices apply to every rebuilt step, whichever way you arrive
  try { Object.assign(choices, JSON.parse(localStorage.getItem(KEY) ?? "{}").choices ?? {}); } catch { /* none saved */ }
  if (qm) mode = qm;
  if (q.has("ch")) {
    const c = Math.max(0, Math.min(chapters.length - 1, Number(q.get("ch")) - 1));
    const b = Math.max(0, Math.min(chapters[c].beats.length - 1, Number(q.get("b") ?? 1) - 1));
    goto(c, b, { replay: true });
  } else if (load()) {
    if (qm) mode = qm;
    instant = true; renderAll(); instant = false;
  } else {
    goto(0, 0, { replay: true });
  }
  // the intro never resets progress: Start just carries on where you are
  // (on a first visit that is the beginning anyway)
  const intro = () => showIntro(mode, (m) => {
    mode = m;
    renderMode();
    renderLesson();
    save();
  });
  if (q.has("intro") || (!introSeen() && !q.has("ch"))) intro();
  $(".brand").addEventListener("click", (e) => { e.preventDefault(); intro(); });
  if (q.has("done")) {
    // dev: finish the current beat the typical way, to screenshot its after state
    const done = finishBeat(ci, bi);
    w = done.w;
    log = done.log;
    beatDone = true;
    instant = true; renderAll(); instant = false;
  }
  // links like ?ch=3 or ?intro=1 apply once; take them off the address bar so
  // a normal reload resumes your saved place instead of applying them again
  if ([...q.keys()].length) window.history.replaceState(null, "", location.pathname + location.hash);

  $("#chapters").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ch]");
    if (!b) return;
    const c = Number(b.dataset.ch);
    if (c === ci) return;
    goto(c, 0, { replay: true });
  });
  document.querySelectorAll<HTMLButtonElement>("#mode [data-mode]").forEach((b) => b.addEventListener("click", () => {
    mode = b.dataset.mode as Mode;
    log = log.filter((l) => l.kind !== "me" && l.kind !== "ai");
    renderMode();
    renderLesson();
    save();
    if (mode === "command") focusTerm();
  }));
  // files in the world open the editor (one listener, since parts are replaced)
  $("#world").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-file]");
    if (b) openEditor(b.dataset.place as Place, Number(b.dataset.desk), b.dataset.file!);
  });
  $("#lesson").addEventListener("animationend", (e) => (e.target as HTMLElement).classList.remove("shake"));
  $("#deck-btn").addEventListener("click", openDeck);
  // fold-outs (more info, under the hood) open and close smoothly, no jumps
  document.addEventListener("click", (e) => {
    const sum = (e.target as HTMLElement).closest("summary");
    const det = sum?.parentElement as HTMLDetailsElement | null;
    if (!sum || !det || det.tagName !== "DETAILS" || prefersReduced) return;
    e.preventDefault();
    const from = det.getBoundingClientRect().height;
    const closing = det.open;
    if (!closing) det.open = true;
    const to = closing ? sum.getBoundingClientRect().height : det.getBoundingClientRect().height;
    det.style.overflow = "hidden";
    det.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }).finished.then(() => {
      if (closing) det.open = false;
      det.style.overflow = "";
    });
  });
  // explain: hover opens it (and it stays while the pointer is on the panel),
  // a click or tap pins it open, Escape or a click elsewhere closes it
  const xp = $("#xp");
  document.addEventListener("pointerover", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".explain");
    if (t && (e as PointerEvent).pointerType === "mouse" && !xp.classList.contains("is-pinned")) openExplain(t, false);
  });
  document.addEventListener("pointerout", (e) => {
    const from = (e.target as HTMLElement).closest(".explain, #xp"), to = (e.relatedTarget as HTMLElement | null)?.closest(".explain, #xp");
    if (from && !to && !xp.classList.contains("is-pinned")) closeExplain(true);
  });
  xp.addEventListener("pointerenter", () => window.clearTimeout(xpTimer));
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".explain");
    if (t) { if (xpFor === t && xp.classList.contains("is-pinned")) closeExplain(); else openExplain(t, true); return; }
    if (!(e.target as HTMLElement).closest("#xp") && !xp.hidden) closeExplain();
  });
  xp.querySelector(".xp__x")!.addEventListener("click", () => closeExplain());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !xp.hidden) closeExplain(); });
  $("#lesson").addEventListener("scroll", () => { if (!xp.hidden && xpFor) placeExplain(xpFor); });
  window.addEventListener("resize", () => { if (!xp.hidden && xpFor) placeExplain(xpFor); });
  $("#editor-text").addEventListener("input", fitEditor);
  // the pressing hand stays while the mouse button is held, wherever it is,
  // and each click drops a little ink ring
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || (e.target as HTMLElement).closest?.("input, textarea")) return;
    const target = (e.target as HTMLElement).closest?.("button:not(:disabled), a, summary, label, [role=radio], [data-file], .why");
    // pressing a control never starts or keeps a text selection
    if (target) clearSelection();
    // clicking a control twice fast is not a request to select a word
    if (e.detail > 1 && (e.target as HTMLElement).closest?.("button, [role=radio], .chap, .say-pick")) e.preventDefault();
    if (target) document.documentElement.classList.add("is-pressing");
    if (prefersReduced) return;
    const r = document.createElement("span");
    r.className = "fx-click";
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    $("#fx").append(r);
    r.animate([{ transform: "translate(-50%,-50%) scale(.3)", opacity: 0.9 }, { transform: "translate(-50%,-50%) scale(1.5)", opacity: 0 }],
      { duration: 380, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(() => r.remove());
  });
  const release = () => document.documentElement.classList.remove("is-pressing");
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
  document.addEventListener("contextmenu", release);
  // Firefox swaps the normal right-click menu (back, forward, reload) for the
  // copy menu whenever anything on the page is selected, wherever you click.
  // So a right-click outside the selected text clears the selection first;
  // right-clicking on text you selected on purpose still offers Copy.
  document.addEventListener("contextmenu", (e) => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || (e.target as HTMLElement).closest?.("input, textarea")) return;
    const onIt = [...Array(sel.rangeCount).keys()].some((i) =>
      [...sel.getRangeAt(i).getClientRects()].some((r) => e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2));
    if (!onIt) sel.removeAllRanges();
  }, true);
  window.addEventListener("blur", release);
  // the "why GitHub?" note opens on tap too (phones have no hover), and closes on the next tap anywhere
  document.addEventListener("click", (e) => {
    const why = (e.target as HTMLElement).closest(".why");
    if (why && (e.target as HTMLElement).closest(".why__tip")) return; // clicks inside an open note keep it open
    document.querySelectorAll(".why.is-open").forEach((x) => { if (x !== why) x.classList.remove("is-open"); });
    why?.classList.toggle("is-open");
  });
  const dlg = $("#editor") as unknown as HTMLDialogElement;
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "save") saveEditor(false);
    edit = null;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || dlg.open || (e.target as HTMLElement).matches("input, textarea, button, summary")) return;
    if (beatDone) $("#lesson").querySelector<HTMLButtonElement>("[data-next]")?.click();
  });
  window.addEventListener("resize", () => syncScroll());
}

boot();
