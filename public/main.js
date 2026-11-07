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
import { chapters, MAIN_FILE } from "./story.js";
import { exec, replayTo } from "./engine.js";
import { showIntro, introSeen, whyGithub } from "./intro.js";
import { circlePath, linePath, smooth, drawOn, el, prefersReduced } from "./sketch.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* ------------------------------------------------------------------ state */
const KEY = "htg-story-2";
let w = G.freshWorld();
let ci = 0, bi = 0;
let mode = "buttons";
let log = [];
let beatDone = false;
let termDesk = 0;
let justDone = false;
let instant = true; // draw without animation (first paint, jumps)
let history = []; // where you've been, so Back can return there exactly
function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify({ w, ci, bi, mode, log, beatDone }));
    }
    catch { /* private mode */ }
}
function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return false;
        const s = JSON.parse(raw);
        if (!chapters[s.ci]?.beats[s.bi])
            return false;
        ({ w, ci, bi, log, beatDone } = s);
        mode = s.mode ?? "buttons";
        return true;
    }
    catch {
        return false;
    }
}
const beat = () => chapters[ci].beats[bi];
/* acts that look the same in every mode: Albert or Toby doing something, or a happening like the cat */
const isWatch = (a) => a.who === "albert" || a.ai === "";
const beatDesk = () => beat().desk ?? 0;
const flat = chapters.flatMap((c, i) => c.beats.map((b, j) => ({ c: i, b: j, beat: b })));
const flatIndex = (c, b) => flat.findIndex((x) => x.c === c && x.b === b);
/* ------------------------------------------------------------ running */
function runSteps(act, vals) {
    const who = act.who ?? "you";
    const deskI = who === "you" ? (mode === "command" ? termDesk : beatDesk()) : 0;
    const before = snapshotFx();
    let ok = true;
    for (const s of act.steps(w, vals)) {
        if (typeof s === "string") {
            log.push({ kind: "cmd", text: s, who });
            const r = exec(w, s, who, deskI);
            if (r.out)
                log.push({ kind: r.ok ? "out" : "err", text: r.out, who });
            focusPlace = placeFor(s, who);
            if (!r.ok) {
                ok = false;
                break;
            }
        }
        else {
            const note = s(w);
            if (note)
                log.push({ kind: "note", text: note, who });
        }
    }
    afterChange();
    celebrate(before, ok);
    return ok;
}
function runTyped(line) {
    if (!line.trim())
        return;
    const before = snapshotFx();
    log.push({ kind: "cmd", text: line.trim(), who: "you" });
    const r = exec(w, line, "you", termDesk);
    if (r.out === "\f") {
        log = [];
    }
    else if (r.out)
        log.push({ kind: r.ok ? "out" : "err", text: r.out, who: "you" });
    if (r.desk !== undefined)
        termDesk = r.desk;
    focusPlace = placeFor(line, "you");
    afterChange();
    celebrate(before, r.ok);
}
/* which place a command changes, so the page can bring it into view */
let focusPlace = null;
function placeFor(cmd, who) {
    if (who === "albert")
        return "albert";
    if (/^gh\s|^git\s+push\b/.test(cmd))
        return "github";
    return "you";
}
function showPlace(id) {
    if (!id)
        return;
    const p = document.querySelector(`.place--${id}`);
    if (!p)
        return;
    const r = p.getBoundingClientRect();
    const topH = $(".top").getBoundingClientRect().height;
    if (r.top >= topH && r.top + Math.min(r.height, 320) <= window.innerHeight)
        return;
    p.scrollIntoView({ block: "start", behavior: prefersReduced ? "auto" : "smooth" });
}
function afterChange() {
    if (!beatDone && beat().done(w)) {
        beatDone = true;
        justDone = true;
        beat().onDone?.(w);
    }
    renderWorld();
    renderLesson();
    renderDeck();
    save();
    if (window.innerWidth >= 860)
        showPlace(focusPlace);
    lastPlace = focusPlace ?? lastPlace;
    focusPlace = null;
}
let lastPlace = null;
/* ------------------------------------------------------------ navigation */
function arrive() {
    beatDone = false;
    lastPlace = null;
    delete w.vars.rejected; // a beat only counts a rejected push that happened during it
    termDesk = beatDesk();
    log = [];
    if (beat().kind === "next")
        beatDone = true;
    if (beat().done(w) && beat().kind !== "next")
        beatDone = true;
}
function goto(c, b, opts = {}) {
    if (opts.replay) {
        w = replayTo(c, b);
        history = [];
    }
    ci = c;
    bi = b;
    arrive();
    instant = !!opts.replay;
    renderAll();
    instant = false;
    save();
    $("#lesson").scrollTop = 0;
    if (opts.replay || window.innerWidth < 900)
        window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
}
const clearSelection = () => { try {
    getSelection()?.removeAllRanges();
}
catch { /* nothing selected */ } };
function next() {
    clearSelection();
    history.push({ ci, bi, w: JSON.stringify(w), log: JSON.stringify(log), beatDone });
    if (history.length > 80)
        history.shift();
    if (bi + 1 < chapters[ci].beats.length)
        goto(ci, bi + 1);
    else if (ci + 1 < chapters.length)
        goto(ci + 1, 0);
}
/* Back returns to the step before, exactly as you left it (finished, with
 * what you typed). After a reload or a chapter jump there is no record, so
 * the step before is rebuilt the typical way and shown finished. */
function back() {
    clearSelection();
    const snap = history.pop();
    if (snap) {
        w = JSON.parse(snap.w);
        ci = snap.ci;
        bi = snap.bi;
        log = JSON.parse(snap.log);
        beatDone = snap.beatDone;
        termDesk = beatDesk();
    }
    else {
        const i = flatIndex(ci, bi);
        if (i <= 0)
            return;
        const prev = flat[i - 1];
        w = replayTo(ci, bi); // the world right after the previous step
        ci = prev.c;
        bi = prev.b;
        log = [];
        beatDone = true;
        termDesk = beatDesk();
    }
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
    document.querySelectorAll("#mode [data-mode]").forEach((b) => {
        b.setAttribute("aria-checked", String(b.dataset.mode === mode));
    });
    document.body.dataset.mode = mode;
}
const MODE_NOTE = {
    buttons: "Buttons, like VS Code or GitHub Desktop.",
    command: "Typed commands, like a developer's terminal.",
    ai: "An AI assistant that runs git for you.",
};
/* the git words you've earned so far: every term up to where you are */
function earned() {
    const now = flatIndex(ci, bi);
    const s = new Set();
    flat.forEach((x, i) => { if (x.beat.term && (i < now || (i === now && beatDone)))
        s.add(x.beat.term[0]); });
    return s;
}
const allTerms = flat.filter((x) => x.beat.term).map((x) => x.beat.term);
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
    $("#deck").showModal();
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
    box.innerHTML = `
    <p class="kicker"><span>Chapter ${ci + 1} of ${chapters.length}</span> <b>${esc(ch.title)}</b></p>
    ${ch.goal ? `<p class="goal">Goal: ${esc(ch.goal)}</p>` : ""}
    <div class="beats" aria-hidden="true">${ch.beats.map((_, i) => `<i class="${i < bi || (i === bi && beatDone) ? "done" : i === bi ? "now" : ""}"></i>`).join("")}</div>
    <div class="say">${b.say(w)}</div>
    ${isLast ? recapHtml() : ""}
    ${b.kind === "next" ? "" : `<div class="do">${b.acts?.some((a) => !isWatch(a)) ? `<p class="mode-note">${MODE_NOTE[mode]}</p>` : ""}${doHtml(b)}</div>`}
    ${after || (beatDone && b.term) ? `<div class="after ${fresh ? "is-new" : ""}">
        ${after ? `<p class="after__text"><span class="tick" aria-hidden="true">✓</span> ${after}</p>` : ""}
        ${lastPlace ? `<button type="button" class="see" data-see="${lastPlace}">See what changed ↓</button>` : ""}
        ${b.term ? `<div class="term"><span class="term__k">New git word</span><b class="term__w">${b.term[0]}</b><p>${b.term[1]}</p></div>` : ""}
      </div>` : ""}
    ${beatDone && b.more ? `<div class="more">${b.more.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join("")}</div>` : ""}
    ${beatDone && lastOfChapter && ch.goal ? `<div class="chapter-done ${fresh ? "is-new" : ""}"><span class="star" aria-hidden="true">★</span><div><b>Chapter ${ci + 1} done</b><p>You can now ${esc(ch.goal)}.</p></div></div>` : ""}
    <div class="lesson__nav">
      <button type="button" class="btn btn--ghost btn--back" data-back ${atStart ? "disabled" : ""}><span aria-hidden="true">←</span> Back</button>
      ${isLast ? `<button type="button" class="btn btn--next" data-restart>Start over</button>` : `
      <span class="step-of">${bi + 1} / ${total}</span>
      <button type="button" class="btn btn--next" data-next ${beatDone ? "" : "disabled"}>${bi + 1 < total ? "Next" : "Next chapter"} <span aria-hidden="true">→</span></button>`}
    </div>`;
    wireLesson();
    const term = box.querySelector(".term__out");
    if (term)
        term.scrollTop = term.scrollHeight;
    if (beatDone && justDone) {
        justDone = false;
        box.querySelector(".after")?.scrollIntoView({ block: "nearest", behavior: prefersReduced ? "auto" : "smooth" });
    }
    if (beatDone) {
        const nb = box.querySelector("[data-next]");
        if (nb && document.activeElement?.closest("#lesson") && !document.activeElement.matches("input"))
            nb.focus({ preventScroll: true });
    }
}
function inputsHtml(a, ai) {
    return (a.inputs ?? []).map((inp) => `
    <label class="field"><span>${esc(inp.label)}</span>
      <input type="text" data-act="${ai}" data-key="${inp.key}" value="${esc(inp.def(w))}" maxlength="60" /></label>`).join("");
}
/* the "do" area: what you press or type, depending on the mode */
function doHtml(b) {
    if (b.kind === "edit") {
        const files = b.edit.files;
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
        if (mode === "buttons")
            html += buttonsHtml(mine, acts);
        if (mode === "command")
            html += commandHtml(mine);
        if (mode === "ai")
            html += aiHtml(mine);
    }
    if (mode !== "command")
        html += hoodHtml();
    if (watch.length && mode === "command")
        html += termHtml(true);
    return html;
}
/* buttons mode looks like the tools people use: an editor's source control
 * panel for git actions, and a browser window for things done on GitHub */
function buttonsHtml(mine, acts) {
    const act = (a) => `<div class="act">
      ${inputsHtml(a, acts.indexOf(a))}
      <button type="button" class="btn ${a.look === "github" ? "btn--gh" : "btn--go btn--ide"}" data-run="${acts.indexOf(a)}">${a.look === "github" ? '<span class="gh-dot" aria-hidden="true"></span>' : ""}${esc(a.label)}</button>
    </div>`;
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
      <p class="webwin__bar"><span class="webwin__dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="webwin__url">github.com/you/my-recipe</span></p>
      <div class="webwin__body acts">${web.map(act).join("")}</div>
    </div>` : ""}`;
}
function hintCmds(mine) {
    return mine.flatMap((a) => {
        const v = {};
        a.inputs?.forEach((i) => (v[i.key] = i.def(w)));
        return a.steps(w, v).filter((s) => typeof s === "string");
    });
}
function prompt() {
    const r = w.repos.you;
    const d = r?.desks[termDesk] ?? r?.desks[0];
    const where = d ? d.path : "~/my-recipe";
    const br = d ? (d.detached ? G.short(d.detached) : d.branch) : null;
    return `${esc(where)}${r && br ? ` <span class="pr-br">(${esc(br)})</span>` : ""} $`;
}
function termHtml(readOnly = false) {
    const lines = log.map((l) => {
        if (l.kind === "cmd")
            return `<div class="t-cmd ${l.who === "albert" ? "t-friend" : ""}">${l.who === "albert" ? "<span class=\"who\">albert's laptop $</span>" : "<span class=\"who\">$</span>"} ${esc(l.text)}</div>`;
        if (l.kind === "note")
            return `<div class="t-note">${esc(l.text)}</div>`;
        return `<div class="t-${l.kind}">${esc(l.text)}</div>`;
    }).join("");
    return `<div class="term-box">
    <div class="term__out">${lines || `<div class="t-note">Type a command and press Enter. <b>git status</b> always tells you where things stand.</div>`}</div>
    ${readOnly ? "" : `<form class="term__in" data-term><label><span class="term__prompt">${prompt()}</span>
      <input type="text" name="cmd" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="command" /></label></form>`}
  </div>`;
}
function commandHtml(mine) {
    const cmds = hintCmds(mine);
    return `${termHtml()}
    <details class="hint-cmds"><summary>Not sure what to type?</summary>
      <p>Type ${cmds.length > 1 ? "these, one at a time" : "this"}:</p>
      ${cmds.map((c) => `<code class="cmd-hint">${esc(c)}</code>`).join("")}
    </details>`;
}
/* AI mode: there is no real AI on this page (running one costs money and
 * isn't needed to learn), so the messages are written for you; pick one and
 * the assistant answers the way a real one would */
function aiHtml(mine) {
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
/* in buttons and AI mode, show which git commands actually ran */
function hoodHtml() {
    const cmds = log.filter((l) => l.kind === "cmd");
    if (!cmds.length)
        return "";
    const errs = log.filter((l) => l.kind === "err");
    return `<div class="hood">
    <p class="hood__k">Under the hood, that ran:</p>
    ${cmds.map((l) => `<code class="cmd-hint ${l.who === "albert" ? "is-friend" : ""}">${l.who === "albert" ? "Albert: " : ""}${esc(l.text)}</code>`).join("")}
    ${errs.length ? `<pre class="hood__err">${esc(errs[errs.length - 1].text)}</pre>` : ""}
    <details><summary>Show git's full answer</summary><pre>${esc(log.filter((l) => l.kind === "out" || l.kind === "err").map((l) => l.text).join("\n\n")) || "(nothing printed)"}</pre></details>
  </div>`;
}
function recapHtml() {
    return `<div class="recap">
    <h3>Every git word you earned</h3>
    <dl>${allTerms.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
  </div>`;
}
function wireLesson() {
    const root = $("#lesson");
    root.querySelectorAll("[data-run]").forEach((btn) => btn.addEventListener("click", () => {
        const a = beat().acts[Number(btn.dataset.run)];
        const vals = {};
        a.inputs?.forEach((inp) => {
            const field = root.querySelector(`input[data-act="${btn.dataset.run}"][data-key="${inp.key}"]`);
            vals[inp.key] = field?.value || inp.def(w);
        });
        runSteps(a, vals);
    }));
    root.querySelector("[data-next]")?.addEventListener("click", next);
    root.querySelector("[data-back]")?.addEventListener("click", back);
    root.querySelector("[data-see]")?.addEventListener("click", (e) => document.querySelector(`.place--${e.currentTarget.dataset.see}`)?.scrollIntoView({ block: "start", behavior: prefersReduced ? "auto" : "smooth" }));
    root.querySelector("[data-restart]")?.addEventListener("click", () => goto(0, 0, { replay: true }));
    root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openEditor("you", Number(b.dataset.desk ?? 0), b.dataset.open)));
    const term = root.querySelector("[data-term]");
    if (term) {
        const input = term.querySelector("input");
        term.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; input.value = ""; runTyped(v); focusTerm(); });
        input.addEventListener("keydown", (e) => {
            const past = log.filter((l) => l.kind === "cmd" && l.who === "you").map((l) => l.text);
            if (e.key === "ArrowUp" && past.length) {
                e.preventDefault();
                histI = Math.max(0, (histI < 0 ? past.length : histI) - 1);
                input.value = past[histI];
            }
            if (e.key === "ArrowDown" && histI >= 0) {
                e.preventDefault();
                histI++;
                input.value = past[histI] ?? "";
                if (histI >= past.length)
                    histI = -1;
            }
        });
    }
    root.querySelectorAll("[data-say]").forEach((b) => b.addEventListener("click", () => askAi(b.dataset.say)));
    root.querySelectorAll("[data-ai-run]").forEach((b) => b.addEventListener("click", aiRun));
}
let histI = -1;
function focusTerm() { $("#lesson").querySelector("[data-term] input")?.focus({ preventScroll: true }); }
/* the pretend assistant: it proposes the same commands the buttons run, and
 * waits for you to say yes, the way real coding assistants ask first */
function askAi(text) {
    const mine = (beat().acts ?? []).filter((a) => !isWatch(a));
    log.push({ kind: "me", text: text.trim() || "do the next step" });
    const cmds = hintCmds(mine);
    const msgs = mine.flatMap((a) => (a.inputs ?? []).map((i) => i.key === "msg" ? `with the note <b>"${esc(i.def(w))}"</b>` : i.key === "name" ? `called <b>${esc(i.def(w))}</b>` : i.key === "title" ? `titled <b>"${esc(i.def(w))}"</b>` : ""));
    log.push({
        kind: "ai",
        text: `Sure${msgs.filter(Boolean).length ? `, ${msgs.filter(Boolean).join(" and ")}` : ""}. I'll run ${cmds.length > 1 ? "these git commands" : "this git command"}:
      ${cmds.map((c) => `<code class="cmd-hint">${esc(c)}</code>`).join("")}
      <button type="button" class="btn btn--small btn--go" data-ai-run>Yes, run ${cmds.length > 1 ? "them" : "it"}</button>`,
        cmds,
    });
    renderLesson();
}
function aiRun() {
    const mine = (beat().acts ?? []).filter((a) => !isWatch(a));
    const last = [...log].reverse().find((l) => l.kind === "ai" && l.cmds);
    if (last) {
        last.text = last.text.replace(/<button[^>]*data-ai-run[^>]*>[^<]*<\/button>/, "");
        delete last.cmds;
    }
    let ok = true;
    for (const a of mine) {
        const v = {};
        a.inputs?.forEach((i) => (v[i.key] = i.def(w)));
        if (ok)
            ok = runSteps(a, v);
    }
    const err = [...log].reverse().find((l) => l.kind === "err");
    log.push({ kind: "ai", text: ok ? "Done. The picture shows what changed." : `Git stopped with a message: <i>${esc((err?.text ?? "").split("\n")[0])}</i>` });
    renderLesson();
    save();
}
/* ------------------------------------------------------------------ world */
const COLORS = ["var(--pen-red)", "var(--pen-green)", "var(--pen-amber)", "var(--pen-remote)"];
const branchColor = new Map([["main", "var(--pen-blue)"]]);
function colorOf(b) {
    if (b === "?")
        return "var(--pen-blue)";
    if (!branchColor.has(b))
        branchColor.set(b, COLORS[(branchColor.size - 1) % COLORS.length]);
    return branchColor.get(b);
}
const drawn = new Map();
const COL = 100, X0 = 56;
const STATE_WORDS = {
    saved: "saved", changed: "changed", staged: "ready to save", "staged+changed": "ready, then changed again",
    new: "new", conflict: "conflict!", deleted: "deleted", "staged-deleted": "deletion ready to save",
};
/* parts of the world are only replaced when their markup changed */
const parts = new Map();
function setPart(node, html) {
    if (!node || parts.get(node) === html)
        return false;
    node.innerHTML = html;
    parts.set(node, html);
    return true;
}
const fileStateSeen = new Map();
function renderWorld() {
    const root = $("#world");
    const view = "places";
    if (root.dataset.view !== view) {
        root.innerHTML = view === "places" ? `<div class="world__recap"></div>` : "";
        root.dataset.view = view;
        parts.clear(); // everything cached for the old view is gone from the page
    }
    setPart(root.querySelector(".world__recap"), ci === chapters.length - 1 ? mapHtml(true) : "");
    const cols = columns();
    const order = ["github", "you", "albert"];
    let prev = root.querySelector(".world__recap");
    for (const id of order) {
        let sec = root.querySelector(`[data-place="${id}"]`);
        const present = id === "you" || !!w.repos[id];
        if (!present) {
            sec?.remove();
            continue;
        }
        if (!sec) {
            sec = document.createElement("section");
            sec.className = `place place--${id}${instant ? "" : " is-new"}`;
            sec.dataset.place = id;
            sec.innerHTML = `<header class="place__head"></header><div class="place__grid"><div class="place__left"></div><div class="strip" data-strip="${id}"></div></div><div class="place__prs"></div>`;
            sec.addEventListener("animationend", () => sec.classList.remove("is-new"), { once: true });
            prev.after(sec);
        }
        prev = sec;
        setPart(sec.querySelector(".place__head"), headHtml(id));
        setPart(sec.querySelector(".place__left"), leftHtml(id));
        const strip = sec.querySelector(".strip");
        if (w.repos[id]) {
            if (!strip.querySelector("svg")) {
                strip.innerHTML = `<svg class="strip__svg"></svg>`;
                parts.delete(strip);
            }
        }
        else
            setPart(strip, `<p class="strip__empty">No version history yet.<br>Just files.</p>`);
        setPart(sec.querySelector(".place__prs"), id === "github" ? prsHtml() : "");
        drawStrip(id, cols);
    }
    // file state chips that changed get a little pop, so you see what moved
    root.querySelectorAll("[data-state-key]").forEach((chip) => {
        const k = chip.dataset.stateKey, s = chip.dataset.state;
        const was = fileStateSeen.get(k);
        if (was !== undefined && was !== s && !instant)
            chip.classList.add("pop");
        fileStateSeen.set(k, s);
    });
    syncScroll();
}
/* the idea in one picture: two computers, one shared copy online */
function mapHtml(recap = false) {
    return `<div class="map ${recap ? "map--recap" : ""}">
    <div class="map__gh"><span class="ico ico--cloud"></span><b>GitHub</b><span>the shared copy, online</span>
      ${recap ? `<em>pull request → review → merge</em>` : ""}</div>
    <div class="map__arrows">
      <span class="up">push ↑</span><span class="down">↓ pull, clone</span>
      <span class="up">push ↑</span><span class="down">↓ pull, clone</span>
    </div>
    <div class="map__pcs">
      <div><span class="ico ico--laptop"></span><b>Your computer</b><span>your files and every saved version</span>${recap ? `<em>edit → stage → commit, on any branch</em>` : ""}</div>
      <div class="map__friend"><span class="ico ico--laptop"></span><b>${recap ? "Albert's computer" : "A friend's computer"}</b><span>their copy: the same history</span>${recap ? `<em>clone once, then pull and push</em>` : ""}</div>
    </div>
    ${recap ? "" : `<p class="map__note">Everyone has the <b>whole</b> history on their own computer. GitHub is the copy everyone agrees to share through.</p>`}
  </div>`;
}
function headHtml(id) {
    const r = w.repos[id];
    const title = id === "github" ? "GitHub" : id === "you" ? "Your computer" : "Albert's computer";
    const sub = id === "github" ? "github.com/you/my-recipe · the shared copy" : id === "you" ? "your laptop" : "Albert's laptop, at his place";
    let badge = "";
    if (r && id !== "github") {
        const ab = G.aheadBehind(w, r, r.desks[0]);
        if (ab) {
            if (ab.ahead && ab.behind)
                badge = `<span class="badge badge--warn">different from GitHub</span>`;
            else if (ab.ahead)
                badge = `<span class="badge badge--warn">${ab.ahead} version${ab.ahead > 1 ? "s" : ""} not uploaded</span>`;
            else if (ab.behind)
                badge = `<span class="badge badge--warn">GitHub has ${ab.behind} newer</span>`;
            else
                badge = `<span class="badge badge--ok">same as GitHub</span>`;
        }
    }
    return `<span class="ico ${id === "github" ? "ico--cloud" : "ico--laptop"}"></span><h3>${id === "github" ? whyGithub() : title}</h3><span class="place__sub">${sub}</span>${badge}`;
}
function leftHtml(id) {
    if (id === "github")
        return ghLeftHtml();
    const r = w.repos[id];
    if (!r)
        return deskHtml("you", null, 0);
    return r.desks.map((_, i) => deskHtml(id, r, i)).join("");
}
/* the main file as it is in this folder right now; lines you changed since the
 * last saved version are marked, so you can see what a commit will hold */
function peekHtml(d, r) {
    const text = d ? d.work[MAIN_FILE] : w.folder?.[MAIN_FILE];
    if (text === undefined)
        return "";
    const base = d && r ? G.treeOf(w, G.headId(r, d))[MAIN_FILE] : text;
    const diff = base === undefined ? text.replace(/\n$/, "").split("\n").map((s) => ({ t: "+", s })) : G.lineDiff(base, text);
    const lines = diff.filter((l) => l.t !== "-").filter((l) => l.s.trim() !== "").slice(0, 12);
    return `<div class="peek" aria-label="${MAIN_FILE} right now"><p class="peek__name">${MAIN_FILE}</p>${lines.map((l) => `<div class="peek__l ${l.t === "+" && base !== undefined ? "is-new" : ""} ${/^(<<<<<<<|=======|>>>>>>>)/.test(l.s) ? "is-mark" : ""}">${typos(esc(l.s))}</div>`).join("")}</div>`;
}
/* the lesson's planted typo (and a few classics) get the familiar red squiggle,
 * the way a word processor marks them, so it's obvious something needs fixing */
const TYPOS = /\b(helpd|teh|recieve|seperate|wich|untill|definately)\b/gi;
const typos = (html) => html.replace(TYPOS, '<span class="typo" title="spelling">$1</span>');
function deskHtml(place, r, i) {
    const d = r?.desks[i] ?? null;
    const files = r && d ? G.fileStates(w, r, d) : Object.keys(w.folder ?? {}).sort().map((p) => ({ path: p, state: "plain" }));
    const name = d ? d.path.replace("~/", "") : "my-recipe";
    const on = d ? (d.detached ? `<span class="desk__on">looking at an old version</span>` : `<span class="desk__on">on <b style="color:${colorOf(d.branch)}">${esc(d.branch)}</b></span>`) : "";
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
function ghLeftHtml() {
    const gh = w.repos.github;
    const bs = Object.keys(gh.branches).sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)));
    const tree = G.treeOf(w, gh.branches.main);
    return `<div class="desk desk--gh">
    <p class="desk__title">${bs.length > 1 ? "Branches" : "Branch"}</p>
    <ul class="branches">${bs.map((b) => `<li><span class="dot" style="background:${colorOf(b)}"></span>${esc(b)}</li>`).join("")}</ul>
    <p class="gh-files">Files: ${Object.keys(tree).sort().map((p) => `<button type="button" class="fname" data-file="${p}" data-place="github" data-desk="0">${esc(p)}</button>`).join(" ")}</p>
  </div>`;
}
function prsHtml() {
    if (!w.prs.length)
        return "";
    const gh = w.repos.github;
    return w.prs.map((p) => {
        const headId = p.state === "merged" ? w.commits[p.mergeCommit].parents[1] : gh.branches[p.head];
        const baseId = p.state === "merged" ? w.commits[p.mergeCommit].parents[0] : gh.branches[p.base];
        // what the PR changes: from where the branch split off to its tip
        const base = [...G.ancestors(w, baseId)].filter((id) => G.ancestors(w, headId).has(id)).map((id) => w.commits[id]).sort((a, b) => b.n - a.n)[0];
        const diff = G.lineDiff(G.treeOf(w, base?.id)[MAIN_FILE], G.treeOf(w, headId)[MAIN_FILE]).filter((l) => l.t !== " ");
        const state = p.state === "merged" ? `<span class="pr__state pr__state--merged">Merged</span>` : `<span class="pr__state">Open</span>`;
        if (p.state === "merged" && ci !== 6) {
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
function columns() {
    const all = new Set();
    for (const r of Object.values(w.repos))
        placeCommits(r).forEach((id) => all.add(id));
    return [...all].sort((a, b) => w.commits[a].n - w.commits[b].n);
}
function placeCommits(r) {
    const s = new Set();
    [...Object.values(r.branches), ...r.desks.map((d) => d.detached).filter(Boolean)]
        .forEach((id) => G.ancestors(w, id).forEach((x) => s.add(x)));
    return s;
}
/* which lane (row of the strip) each commit sits on: main's line at the
 * bottom, every other branch's own commits on a lane above it */
function lanes(r) {
    const m = new Map();
    const walk = (id, lane, br) => {
        while (id && !m.has(id)) {
            m.set(id, { lane, br });
            id = w.commits[id].parents[0];
        }
    };
    walk(r.branches.main, 0, "main");
    let k = 0;
    const others = Object.keys(r.branches).filter((b) => b !== "main")
        .sort((a, b) => w.commits[r.branches[a]].n - w.commits[r.branches[b]].n);
    for (const b of others)
        if (!m.has(r.branches[b]))
            walk(r.branches[b], 1 + (k++ % 2), b);
    // commits only reachable through merges (a merged branch that was deleted)
    for (const id of placeCommits(r))
        if (!m.has(id))
            m.set(id, { lane: 1, br: "?" });
    r.desks.forEach((d) => { if (d.detached && !m.has(d.detached))
        walk(d.detached, 1, "?"); });
    return m;
}
function drawStrip(id, cols) {
    const r = w.repos[id];
    const host = document.querySelector(`[data-strip="${id}"]`);
    const svg = host?.querySelector("svg");
    if (!r || !svg)
        return;
    const have = placeCommits(r);
    const L = lanes(r);
    const maxLane = Math.max(0, ...[...L.values()].map((v) => v.lane));
    const laneY = (l) => 26 + (maxLane - l) * 44;
    const baseY = laneY(0);
    const x = (cid) => X0 + cols.indexOf(cid) * COL;
    // labels under each column: you-are-here markers, then branch names
    const labels = new Map();
    const push = (cid, v) => { const a = labels.get(cid) ?? []; a.push(v); labels.set(cid, a); };
    if (!r.bare)
        r.desks.forEach((d, i) => {
            const h = G.headId(r, d);
            if (h)
                push(h, { text: r.desks.length > 1 ? `desk ${i + 1} is here` : id === "albert" ? "Albert is here" : "you are here", color: "var(--ink)", here: true });
        });
    Object.entries(r.branches).sort(([a], [b]) => (a === "main" ? -1 : b === "main" ? 1 : 0)).forEach(([b, cid]) => push(cid, { text: b, color: colorOf(b) }));
    const maxLabels = Math.max(1, ...[...labels.values()].map((a) => a.length));
    const H = baseY + 34 + maxLabels * 21;
    const W = X0 * 2 + 30 + Math.max(0, cols.length - 1) * COL;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.innerHTML = "";
    const seen = drawn.get(id) ?? new Set();
    drawn.set(id, seen);
    const gEdges = el("g", { class: "edges" }), gNodes = el("g", { class: "nodes" }), gLabels = el("g", { class: "labels" });
    svg.append(gEdges, gNodes, gLabels);
    const ink = (p, key, dur = 520) => {
        if (instant || seen.has(key)) {
            seen.add(key);
            return;
        }
        seen.add(key);
        void drawOn(p, { duration: dur });
    };
    const seed = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
    for (const cid of cols) {
        if (!have.has(cid))
            continue;
        const c = w.commits[cid];
        const me = L.get(cid);
        const cx = x(cid), cy = laneY(me.lane);
        c.parents.forEach((p, pi) => {
            if (!have.has(p))
                return;
            const pl = L.get(p);
            const px = x(p), py = laneY(pl.lane);
            const d = py === cy ? linePath(px + 13, py, cx - 13, cy, seed(cid) + pi)
                : smooth([[px + 10, py], [px + (cx - px) * 0.55, py + (cy - py) * 0.15], [cx - 12, cy]]);
            const col = colorOf(pi === 1 ? L.get(p).br : me.br === "?" ? "main" : me.br);
            const path = el("path", { d, class: "edge", stroke: col });
            gEdges.append(path);
            ink(path, `e:${p}>${cid}`);
        });
        const col = colorOf(me.br === "?" ? "main" : me.br);
        const g = el("g", { class: "commit", "data-c": cid, style: `transform-origin:${cx}px ${cy}px` });
        const node = el("path", { d: circlePath(cx, cy, 12, seed(cid)), class: "node", stroke: col });
        const t = el("title");
        t.textContent = `${c.msg}\nby ${c.author} · ${G.short(cid)}`;
        g.append(t, node);
        if (c.author !== "You") {
            const s = el("text", { x: cx, y: cy + 4.5, class: "node__who" });
            s.textContent = c.author[0];
            g.append(s);
        }
        if (c.parents.length > 1)
            g.append(el("path", { d: circlePath(cx, cy, 5, seed(cid) + 3), class: "node__merge", stroke: col }));
        gNodes.append(g);
        ink(node, `n:${cid}`, 420);
    }
    for (const [cid, arr] of labels) {
        const cx = x(cid);
        const top = laneY(L.get(cid)?.lane ?? 0);
        gLabels.append(el("path", { d: linePath(cx, top + 14, cx, baseY + 26, seed(cid)), class: "label__tie" }));
        arr.forEach((lb, i) => {
            const y = baseY + 42 + i * 21;
            const tx = el("text", { x: cx, y, class: `label ${lb.here ? "label--here" : ""}`, fill: lb.color });
            tx.textContent = lb.here ? `▲ ${lb.text}` : lb.text;
            gLabels.append(tx);
            const k = `l:${cid}:${lb.text}`;
            if (!instant && !seen.has(k))
                tx.classList.add("is-new");
            seen.add(k);
        });
    }
}
/* keep every strip scrolled together, and pinned to the newest versions */
function syncScroll() {
    const strips = [...document.querySelectorAll(".strip")];
    strips.forEach((s) => {
        s.scrollLeft = s.scrollWidth;
        s.onscroll = () => strips.forEach((o) => { if (o !== s && Math.abs(o.scrollLeft - s.scrollLeft) > 1)
            o.scrollLeft = s.scrollLeft; });
    });
}
function snapshotFx() {
    const have = {};
    for (const [id, r] of Object.entries(w.repos))
        have[id] = placeCommits(r);
    const staged = [...document.querySelectorAll("[data-state-key]")]
        .filter((c) => /staged|changed|new/.test(c.dataset.state))
        .map((c) => ({ path: c.dataset.path, place: c.dataset.stateKey.split(":")[0], rect: c.closest(".file-row").getBoundingClientRect() }));
    return { have, staged };
}
const nodeEl = (place, cid) => document.querySelector(`[data-strip="${place}"] [data-c="${cid}"]`);
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
function celebrate(before, ok) {
    if (!ok) {
        const box = $("#lesson").querySelector(".do");
        box?.classList.add("shake");
        return;
    }
    if (prefersReduced)
        return;
    requestAnimationFrame(() => {
        let delay = 0;
        for (const [id, r] of Object.entries(w.repos)) {
            const was = before.have[id] ?? new Set();
            const fresh = [...placeCommits(r)].filter((c) => !was.has(c)).sort((a, b) => w.commits[a].n - w.commits[b].n);
            for (const cid of fresh) {
                const target = nodeEl(id, cid);
                if (!target)
                    continue;
                // came from another place: a dot travels from there to here
                const from = Object.keys(before.have).find((o) => o !== id && before.have[o].has(cid) && nodeEl(o, cid));
                // a place that just appeared slides in first; wait for it to settle
                if (target.closest(".place.is-new"))
                    delay = Math.max(delay, 480);
                if (from)
                    travel(nodeEl(from, cid), target, id === "github" ? "push" : "pull", delay);
                else
                    saved(target, w.commits[cid], before.staged.filter((s) => s.place === id), delay);
                delay += 110;
            }
        }
    });
}
function fx() { return $("#fx"); }
/* a new commit: the packed files fly into the dot, the dot pops, the note floats up */
function saved(target, c, files, delay) {
    const to = centre(target.getBoundingClientRect());
    const fly = files.length ? 520 : 0;
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
        note.innerHTML = `✓ saved <b>${esc(c.msg)}</b>`;
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
function travel(from, to, kind, delay) {
    to.style.opacity = "0";
    setTimeout(() => fly(from, to, kind), delay);
}
function fly(from, to, kind) {
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
    ], { duration: 560, delay, easing: "cubic-bezier(.45,0,.35,1)" }).finished.then(() => {
        dot.remove();
        to.style.opacity = "";
        pop(to);
        ring(b, kind === "push" ? "var(--pen-remote)" : "var(--pen-blue)");
    });
}
function pop(g) {
    g.classList.remove("is-pop");
    void g.getBoundingClientRect();
    g.classList.add("is-pop");
}
function ring(p, color) {
    const r = document.createElement("span");
    r.className = "fx-ring";
    r.style.left = `${p.x}px`;
    r.style.top = `${p.y}px`;
    r.style.borderColor = color;
    fx().append(r);
    r.animate([{ transform: "translate(-50%,-50%) scale(.4)", opacity: 0.9 }, { transform: "translate(-50%,-50%) scale(2.6)", opacity: 0 }], { duration: 620, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(() => r.remove());
}
/* ----------------------------------------------------------------- editor */
let edit = null;
function openEditor(place, deskI, file) {
    const dlg = $("#editor");
    const ta = $("#editor-text");
    const r = w.repos[place];
    const readOnly = place !== "you";
    let text;
    if (place === "github")
        text = G.treeOf(w, r.branches.main)[file] ?? "";
    else if (!r)
        text = w.folder?.[file] ?? "";
    else
        text = r.desks[deskI].work[file] ?? "";
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
    $("#editor-tabs").querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        saveEditor(false);
        openEditor(place, deskI, b.dataset.tab);
    }));
    $("#editor-note").innerHTML = readOnly ? "" : beat().kind === "edit" && beat().edit?.files.includes(file) && !beatDone
        ? `Your task: <b>${esc(beat().edit.ask(w))}</b>. Type anywhere in the file.` : "";
    renderResolver(text, readOnly);
    if (!dlg.open)
        dlg.showModal();
    fitEditor();
    if (!readOnly && !G.hasMarkers(text)) {
        ta.focus();
        const end = text.indexOf("\n\n", text.indexOf("- "));
        ta.setSelectionRange(end > 0 ? end : text.length, end > 0 ? end : text.length);
    }
}
/* the editor is as tall as its text plus one empty line, and grows as you type */
function fitEditor() {
    const ta = $("#editor-text");
    const line = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight + line}px`;
}
function renderResolver(text, readOnly) {
    const box = $("#resolver");
    const m = text.match(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n?/);
    if (!m || readOnly) {
        box.hidden = true;
        box.innerHTML = "";
        return;
    }
    box.hidden = false;
    box.innerHTML = `<p class="resolver__k">Git found two versions of the same line. Which one stays?</p>
    <div class="resolver__opts">
      <button type="button" class="pick" data-pick="mine"><span>Your version</span><code>${esc(m[1].trim())}</code></button>
      <button type="button" class="pick pick--friend" data-pick="theirs"><span>Albert's version</span><code>${esc(m[2].trim())}</code></button>
      <button type="button" class="pick pick--both" data-pick="both"><span>Keep both</span><code>${esc(m[1].trim())}<br>${esc(m[2].trim())}</code></button>
    </div>
    <p class="resolver__raw">Below is the file as git left it. The <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> and <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> lines are git's marks; you can also fix it by hand.</p>`;
    box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
        const ta = $("#editor-text");
        const keep = b.dataset.pick === "mine" ? m[1] : b.dataset.pick === "theirs" ? m[2] : m[1] + m[2];
        ta.value = ta.value.replace(m[0], () => keep);
        saveEditor(true);
    }));
}
function saveEditor(close) {
    if (!edit || edit.place !== "you")
        return;
    const r = w.repos.you;
    const text = $("#editor-text").value.replace(/\r/g, "");
    const fixed = text.endsWith("\n") ? text : text + "\n";
    if (r)
        r.desks[edit.desk].work[edit.file] = fixed;
    else if (w.folder)
        w.folder[edit.file] = fixed;
    if (close)
        $("#editor").close();
    afterChange();
}
/* ------------------------------------------------------------------- boot */
function boot() {
    const q = new URLSearchParams(location.search);
    const qm = q.get("mode");
    if (qm)
        mode = qm;
    if (q.has("ch")) {
        const c = Math.max(0, Math.min(chapters.length - 1, Number(q.get("ch")) - 1));
        const b = Math.max(0, Math.min(chapters[c].beats.length - 1, Number(q.get("b") ?? 1) - 1));
        goto(c, b, { replay: true });
    }
    else if (load()) {
        if (qm)
            mode = qm;
        instant = true;
        renderAll();
        instant = false;
    }
    else {
        goto(0, 0, { replay: true });
    }
    const intro = (first) => showIntro(mode, (m) => {
        mode = m;
        renderMode();
        if (first)
            goto(0, 0, { replay: true });
        else {
            renderLesson();
            save();
        }
    });
    if (q.has("intro") || (!introSeen() && !q.has("ch")))
        intro(true);
    $(".brand").addEventListener("click", (e) => { e.preventDefault(); intro(false); });
    if (q.has("done")) {
        // dev: finish the current beat the typical way, to screenshot its after state
        w = replayTo(ci, bi + 1);
        beatDone = true;
        instant = true;
        renderAll();
        instant = false;
    }
    $("#chapters").addEventListener("click", (e) => {
        const b = e.target.closest("[data-ch]");
        if (!b)
            return;
        const c = Number(b.dataset.ch);
        if (c === ci)
            return;
        goto(c, 0, { replay: true });
    });
    document.querySelectorAll("#mode [data-mode]").forEach((b) => b.addEventListener("click", () => {
        mode = b.dataset.mode;
        log = log.filter((l) => l.kind !== "me" && l.kind !== "ai");
        renderMode();
        renderLesson();
        save();
        if (mode === "command")
            focusTerm();
    }));
    // files in the world open the editor (one listener, since parts are replaced)
    $("#world").addEventListener("click", (e) => {
        const b = e.target.closest("[data-file]");
        if (b)
            openEditor(b.dataset.place, Number(b.dataset.desk), b.dataset.file);
    });
    $("#lesson").addEventListener("animationend", (e) => e.target.classList.remove("shake"));
    $("#deck-btn").addEventListener("click", openDeck);
    $("#editor-text").addEventListener("input", fitEditor);
    // the pressing hand stays while the mouse button is held, wherever it is,
    // and each click drops a little ink ring
    document.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest?.("input, textarea"))
            return;
        const target = e.target.closest?.("button:not(:disabled), a, summary, label, [role=radio], [data-file], .why");
        // clicking a control twice fast is not a request to select a word
        if (e.detail > 1 && e.target.closest?.("button, [role=radio], .chap, .say-pick"))
            e.preventDefault();
        if (target)
            document.documentElement.classList.add("is-pressing");
        if (prefersReduced)
            return;
        const r = document.createElement("span");
        r.className = "fx-click";
        r.style.left = `${e.clientX}px`;
        r.style.top = `${e.clientY}px`;
        $("#fx").append(r);
        r.animate([{ transform: "translate(-50%,-50%) scale(.3)", opacity: 0.9 }, { transform: "translate(-50%,-50%) scale(1.5)", opacity: 0 }], { duration: 380, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(() => r.remove());
    });
    const release = () => document.documentElement.classList.remove("is-pressing");
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    document.addEventListener("contextmenu", release);
    window.addEventListener("blur", release);
    // the "why GitHub?" note opens on tap too (phones have no hover), and closes on the next tap anywhere
    document.addEventListener("click", (e) => {
        const why = e.target.closest(".why");
        document.querySelectorAll(".why.is-open").forEach((x) => { if (x !== why)
            x.classList.remove("is-open"); });
        why?.classList.toggle("is-open");
    });
    const dlg = $("#editor");
    dlg.addEventListener("close", () => {
        if (dlg.returnValue === "save")
            saveEditor(false);
        edit = null;
    });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || dlg.open || e.target.matches("input, textarea, button, summary"))
            return;
        if (beatDone)
            $("#lesson").querySelector("[data-next]")?.click();
    });
    window.addEventListener("resize", () => syncScroll());
}
boot();
//# sourceMappingURL=main.js.map