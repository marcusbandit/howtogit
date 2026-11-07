/* main.ts: the page. Lesson card on one side, the world on the other.
 *
 * The world is the three places git lives in this story: GitHub (the shared
 * copy online), your computer, and Sam's computer. Every place shows its
 * folder(s) and its line of saved versions, with one column per commit across
 * all places, so you can see at a glance who has which version.
 */
import * as G from "./model.js";
import { chapters } from "./story.js";
import { exec, replayTo } from "./engine.js";
import { circlePath, linePath, smooth, drawOn, el, prefersReduced } from "./sketch.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* ------------------------------------------------------------------ state */
const KEY = "htg-story-1";
let w = G.freshWorld();
let ci = 0, bi = 0;
let mode = "buttons";
let log = [];
let beatDone = false;
let termDesk = 0;
let maxReached = 0; // furthest chapter you've been to, for the chapter strip
let justDone = false;
let instant = true; // draw without animation (first paint, jumps)
function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify({ w, ci, bi, mode, log, beatDone, maxReached }));
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
        maxReached = s.maxReached ?? s.ci;
        return true;
    }
    catch {
        return false;
    }
}
const beat = () => chapters[ci].beats[bi];
/* acts that look the same in every mode: Sam doing something, or a happening like spilled coffee */
const isWatch = (a) => a.who === "sam" || a.ai === "";
const beatDesk = () => beat().desk ?? 0;
/* ------------------------------------------------------------ running */
function runSteps(act, vals) {
    const who = act.who ?? "you";
    const deskI = who === "you" ? (mode === "command" ? termDesk : beatDesk()) : 0;
    const ran = [];
    let ok = true;
    for (const s of act.steps(w, vals)) {
        if (typeof s === "string") {
            ran.push(s);
            log.push({ kind: "cmd", text: s, who });
            const r = exec(w, s, who, deskI);
            if (r.out)
                log.push({ kind: r.ok ? "out" : "err", text: r.out, who });
            animateFlow(s, who);
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
    return ok;
}
function runTyped(line) {
    if (!line.trim())
        return;
    log.push({ kind: "cmd", text: line.trim(), who: "you" });
    const r = exec(w, line, "you", termDesk);
    if (r.out === "\f") {
        log = [];
    }
    else if (r.out)
        log.push({ kind: r.ok ? "out" : "err", text: r.out, who: "you" });
    if (r.desk !== undefined)
        termDesk = r.desk;
    animateFlow(line, "you");
    focusPlace = placeFor(line, "you");
    afterChange();
}
/* which place a command changes, so the page can bring it into view */
let focusPlace = null;
function placeFor(cmd, who) {
    if (who === "sam")
        return "sam";
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
    save();
    if (window.innerWidth >= 860)
        showPlace(focusPlace);
    lastPlace = focusPlace ?? lastPlace;
    focusPlace = null;
}
let lastPlace = null;
/* ------------------------------------------------------------ navigation */
function goto(c, b, opts = {}) {
    if (opts.replay)
        w = replayTo(c, b);
    ci = c;
    bi = b;
    maxReached = Math.max(maxReached, c);
    beatDone = false;
    lastPlace = null;
    delete w.vars.rejected; // a beat only counts a rejected push that happened during it
    termDesk = beatDesk();
    log = [];
    if (beat().kind === "next")
        beatDone = true;
    if (beat().done(w) && beat().kind !== "next")
        beatDone = true;
    instant = !!opts.replay;
    renderAll();
    instant = false;
    save();
    const lesson = $("#lesson");
    lesson.scrollTop = 0;
    if (opts.replay || window.innerWidth < 900)
        window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
}
function next() {
    if (bi + 1 < chapters[ci].beats.length)
        goto(ci, bi + 1);
    else if (ci + 1 < chapters.length)
        goto(ci + 1, 0);
}
/* ---------------------------------------------------------------- render */
function renderAll() {
    renderChapters();
    renderMode();
    renderWorld();
    renderLesson();
}
function renderChapters() {
    const nav = $("#chapters");
    nav.innerHTML = chapters.map((c, i) => `
    <button type="button" class="chap ${i === ci ? "is-now" : ""} ${i < ci ? "is-done" : ""}" data-ch="${i}" ${i === ci ? 'aria-current="step"' : ""} title="${esc(c.title)}">
      <span class="chap__n">${i + 1}</span><span class="chap__t">${esc(c.short)}</span>
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
    buttons: "You're using buttons, like the ones in VS Code or GitHub Desktop.",
    command: "You're typing git commands, like a developer in a terminal.",
    ai: "You're asking an AI assistant, which runs the git commands for you.",
};
function renderLesson() {
    const b = beat(), ch = chapters[ci];
    const total = ch.beats.length;
    const isLast = ci === chapters.length - 1;
    const after = beatDone && b.after ? b.after(w) : "";
    const box = $("#lesson");
    box.innerHTML = `
    <p class="kicker"><span>Chapter ${ci + 1} of ${chapters.length}</span> <b>${esc(ch.title)}</b></p>
    <div class="beats" aria-hidden="true">${ch.beats.map((_, i) => `<i class="${i < bi ? "done" : i === bi ? "now" : ""}"></i>`).join("")}</div>
    <div class="say">${b.say(w)}</div>
    ${isLast ? recapHtml() : ""}
    ${b.kind === "next" ? "" : `<div class="do">${b.acts?.some((a) => !isWatch(a)) ? `<p class="mode-note">${MODE_NOTE[mode]}</p>` : ""}${doHtml(b)}</div>`}
    ${after || (beatDone && b.term) ? `<div class="after">
        ${after ? `<p class="after__text"><span class="tick" aria-hidden="true">✓</span> ${after}</p>` : ""}
        ${lastPlace ? `<button type="button" class="see" data-see="${lastPlace}">See what changed ↓</button>` : ""}
        ${b.term ? `<div class="term"><span class="term__k">The git word</span><b class="term__w">${b.term[0]}</b><p>${b.term[1]}</p></div>` : ""}
      </div>` : ""}
    ${beatDone && b.more ? `<div class="more">${b.more.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join("")}</div>` : ""}
    <div class="lesson__nav">
      ${isLast ? `<button type="button" class="btn btn--ghost" data-restart>Start over</button>` : `
      <span class="step-of">step ${bi + 1} of ${total}</span>
      <button type="button" class="btn btn--next" data-next ${beatDone ? "" : "disabled"}>${bi + 1 < total ? "Next" : `Next chapter: ${esc(chapters[ci + 1].title)}`} <span aria-hidden="true">→</span></button>`}
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
        return `${files.map((f) => `<button type="button" class="btn btn--file" data-open="${f}" data-desk="${b.desk ?? 0}">Open ${f}</button>`).join(" ")}
      ${beatDone ? "" : `<p class="hint">Change it in the editor, then press <b>Save file</b>. Editing files works the same in every tool${d && b.desk ? `. This opens the copy in <b>${esc(d.path.replace("~/", ""))}</b>` : ""}.</p>`}`;
    }
    if (b.kind === "resolve") {
        return `<button type="button" class="btn btn--file" data-open="recipe.md" data-desk="0">Open recipe.md</button>`;
    }
    const acts = b.acts ?? [];
    const watch = acts.filter(isWatch);
    const mine = acts.filter((a) => !watch.includes(a));
    let html = "";
    if (watch.length) {
        html += watch.map((a) => `<button type="button" class="btn ${a.who === "sam" ? "btn--sam" : ""}" data-run="${acts.indexOf(a)}" ${beatDone ? "disabled" : ""}>${esc(a.label)}</button>`).join(" ");
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
function buttonsHtml(mine, acts) {
    return `<div class="acts">${mine.map((a) => `
    <div class="act ${a.look === "github" ? "act--github" : ""}">
      ${inputsHtml(a, acts.indexOf(a))}
      <button type="button" class="btn ${a.look === "github" ? "btn--gh" : ""}" data-run="${acts.indexOf(a)}">${a.look === "github" ? '<span class="gh-dot" aria-hidden="true"></span>' : ""}${esc(a.label)}</button>
    </div>`).join("")}</div>`;
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
            return `<div class="t-cmd ${l.who === "sam" ? "t-sam" : ""}">${l.who === "sam" ? "<span class=\"who\">sam's laptop $</span>" : "<span class=\"who\">$</span>"} ${esc(l.text)}</div>`;
        if (l.kind === "note")
            return `<div class="t-note">${esc(l.text)}</div>`;
        return `<div class="t-${l.kind}">${esc(l.text)}</div>`;
    }).join("");
    return `<div class="term-box">
    <div class="term__out">${lines || `<div class="t-note">Type a command and press Enter. Try <b>git status</b> any time to see where things stand.</div>`}</div>
    ${readOnly ? "" : `<form class="term__in" data-term><label><span class="term__prompt">${prompt()}</span>
      <input type="text" name="cmd" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="command" /></label></form>`}
  </div>`;
}
function commandHtml(mine) {
    const cmds = hintCmds(mine);
    return `${termHtml()}
    <details class="hint-cmds"${beatDone ? "" : ""}><summary>Not sure what to type?</summary>
      <p>Type ${cmds.length > 1 ? "these, one at a time" : "this"}:</p>
      ${cmds.map((c) => `<code class="cmd-hint">${esc(c)}</code>`).join("")}
    </details>`;
}
function aiHtml(mine) {
    const ask = mine.map((a) => a.ai).filter(Boolean).join(", then ");
    const chat = log.filter((l) => l.kind === "me" || l.kind === "ai");
    return `<div class="chat">
    ${chat.map((l) => l.kind === "me"
        ? `<p class="bubble bubble--me">${esc(l.text)}</p>`
        : `<div class="bubble bubble--ai"><span class="ai-name">Assistant</span>${l.text}</div>`).join("")}
    ${chat.length ? "" : `<p class="chat__empty">Tell the assistant what you want in your own words.</p>`}
    ${beatDone ? "" : `<form class="chat__in" data-chat>
      <input type="text" name="ask" value="${esc(ask)}" aria-label="message to the assistant" autocomplete="off" />
      <button class="btn" type="submit">Send</button>
    </form>`}
    <p class="chat__fine">This assistant is part of the lesson, not a real AI. Real ones (ChatGPT, Claude, Copilot) work the same way: they run git commands like these for you.</p>
  </div>`;
}
/* in buttons and AI mode, show which git commands actually ran */
function hoodHtml() {
    const cmds = log.filter((l) => l.kind === "cmd" || l.kind === "err");
    if (!cmds.length)
        return "";
    const errs = log.filter((l) => l.kind === "err");
    return `<div class="hood">
    <p class="hood__k">Under the hood, that ran:</p>
    ${log.filter((l) => l.kind === "cmd").map((l) => `<code class="cmd-hint ${l.who === "sam" ? "is-sam" : ""}">${l.who === "sam" ? "Sam: " : ""}${esc(l.text)}</code>`).join("")}
    ${errs.length ? `<pre class="hood__err">${esc(errs[errs.length - 1].text)}</pre>` : ""}
    <details><summary>Show git's full answer</summary><pre>${esc(log.filter((l) => l.kind === "out" || l.kind === "err").map((l) => l.text).join("\n\n")) || "(nothing printed)"}</pre></details>
  </div>`;
}
function recapHtml() {
    const terms = chapters.flatMap((c) => c.beats).filter((b) => b.term).map((b) => b.term);
    return `<div class="recap">
    <h3>Everything you just did, on one page</h3>
    <dl>${terms.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
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
    root.querySelector("[data-see]")?.addEventListener("click", (e) => document.querySelector(`.place--${e.currentTarget.dataset.see}`)?.scrollIntoView({ block: "start", behavior: prefersReduced ? "auto" : "smooth" }));
    root.querySelector("[data-restart]")?.addEventListener("click", () => { maxReached = 0; goto(0, 0, { replay: true }); });
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
    const chat = root.querySelector("[data-chat]");
    chat?.addEventListener("submit", (e) => { e.preventDefault(); askAi(chat.querySelector("input").value); });
    root.querySelectorAll("[data-ai-run]").forEach((b) => b.addEventListener("click", aiRun));
}
let histI = -1;
function focusTerm() { $("#lesson").querySelector("[data-term] input")?.focus({ preventScroll: true }); }
/* the pretend assistant: it proposes the same commands the buttons run, and
 * waits for you to say yes, the way real coding assistants ask first */
function askAi(text) {
    const b = beat();
    const mine = (b.acts ?? []).filter((a) => !isWatch(a));
    log.push({ kind: "me", text: text.trim() || "do the next step" });
    const cmds = hintCmds(mine);
    const msgs = mine.flatMap((a) => (a.inputs ?? []).map((i) => i.key === "msg" ? `with the note <b>"${esc(i.def(w))}"</b>` : i.key === "name" ? `called <b>${esc(i.def(w))}</b>` : i.key === "title" ? `titled <b>"${esc(i.def(w))}"</b>` : ""));
    log.push({
        kind: "ai",
        text: `Sure${msgs.filter(Boolean).length ? `, ${msgs.filter(Boolean).join(" and ")}` : ""}. I'll run ${cmds.length > 1 ? "these git commands" : "this git command"}:
      ${cmds.map((c) => `<code class="cmd-hint">${esc(c)}</code>`).join("")}
      <button type="button" class="btn btn--small" data-ai-run>Yes, run ${cmds.length > 1 ? "them" : "it"}</button>`,
        cmds,
    });
    renderLesson();
}
function aiRun() {
    const b = beat();
    const mine = (b.acts ?? []).filter((a) => !isWatch(a));
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
    log.push({ kind: "ai", text: ok ? "Done. You can see what changed in the picture." : `Git stopped with a message: <i>${esc((err?.text ?? "").split("\n")[0])}</i>` });
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
const COL = 74, X0 = 46;
const STATE_WORDS = {
    saved: "saved", changed: "changed", staged: "ready to save", "staged+changed": "ready, then changed again",
    new: "new", conflict: "conflict!", deleted: "deleted", "staged-deleted": "deletion ready to save",
};
function renderWorld() {
    const root = $("#world");
    if (ci === 0) {
        root.innerHTML = bi === 0 ? messHtml() : mapHtml();
        return;
    }
    const cols = columns();
    const rows = [];
    if (w.repos.github)
        rows.push(placeHtml("github"));
    rows.push(placeHtml("you"));
    if (w.repos.sam)
        rows.push(placeHtml("sam"));
    root.innerHTML = (ci === chapters.length - 1 ? mapHtml(true) : "") + rows.join("");
    for (const id of ["github", "you", "sam"])
        if (w.repos[id] || id === "you")
            drawStrip(id, cols);
    root.querySelectorAll("[data-file]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.place, Number(b.dataset.desk), b.dataset.file)));
    syncScroll();
}
function messHtml() {
    const files = ["pancakes.doc", "pancakes_v2.doc", "pancakes_final.doc", "pancakes_final_REALLY.doc", "pancakes_final_REALLY_2.doc", "pancakes (Sam's edits).doc", "pancakes_final_USE_THIS.doc"];
    return `<div class="mess">
    <div class="place place--you"><header class="place__head"><span class="ico ico--laptop"></span><h3>Your computer</h3></header>
      <div class="desk"><p class="desk__title"><span class="folder"></span> recipes</p>
        <ul class="files">${files.map((f, i) => `<li class="file-row" style="--tilt:${(i % 3) - 1}deg"><span class="fname">${esc(f)}</span></li>`).join("")}</ul>
      </div>
    </div>
    <p class="mess__q">Which one is the real one?</p>
  </div>`;
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
      <div><span class="ico ico--laptop"></span><b>Your computer</b><span>your copy: files + every saved version</span>${recap ? `<em>edit → stage → commit, on any branch</em>` : ""}</div>
      <div><span class="ico ico--laptop"></span><b>Sam's computer</b><span>her copy: the same history</span>${recap ? `<em>clone once, then pull and push</em>` : ""}</div>
    </div>
    ${recap ? "" : `<p class="map__note">Everyone has the <b>whole</b> history on their own computer. GitHub is just the copy everyone agrees to share through.</p>`}
  </div>`;
}
function placeHtml(id) {
    const r = w.repos[id];
    const title = id === "github" ? "GitHub" : id === "you" ? "Your computer" : "Sam's computer";
    const sub = id === "github" ? "github.com/you/my-recipe · the shared copy" : id === "you" ? "on your desk" : "Sam's laptop, at her place";
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
    let left = "";
    if (id === "github")
        left = ghLeftHtml();
    else if (!r)
        left = deskHtml("you", null, 0);
    else
        left = r.desks.map((_, i) => deskHtml(id, r, i)).join("");
    return `<section class="place place--${id}" data-place="${id}">
    <header class="place__head"><span class="ico ${id === "github" ? "ico--cloud" : "ico--laptop"}"></span><h3>${title}</h3><span class="place__sub">${sub}</span>${badge}</header>
    <div class="place__grid">
      <div class="place__left">${left}</div>
      <div class="strip" data-strip="${id}">${r ? `<svg class="strip__svg"></svg>` : `<p class="strip__empty">No version history yet.<br>Just files.</p>`}</div>
    </div>
    ${id === "github" ? prsHtml() : ""}
  </section>`;
}
function deskHtml(place, r, i) {
    const d = r?.desks[i];
    const files = r && d ? G.fileStates(w, r, d) : Object.keys(w.folder ?? {}).sort().map((p) => ({ path: p, state: "plain" }));
    const name = d ? d.path.replace("~/", "") : "my-recipe";
    const on = d ? (d.detached ? `<span class="desk__on">looking at an old version</span>` : `<span class="desk__on">on <b style="color:${colorOf(d.branch)}">${esc(d.branch)}</b></span>`) : "";
    const label = r && r.desks.length > 1 ? `<span class="desk__n">desk ${i + 1}</span>` : "";
    return `<div class="desk">
    <p class="desk__title"><span class="folder"></span>${esc(name)}${label} ${on}</p>
    <ul class="files">${files.map((f) => `<li class="file-row">
      <button type="button" class="fname" data-file="${f.path}" data-place="${place}" data-desk="${i}">${esc(f.path)}</button>
      ${f.state === "plain" ? "" : `<span class="state state--${f.state.replace("+", "-")}">${STATE_WORDS[f.state]}</span>`}
    </li>`).join("")}</ul>
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
        const diff = G.lineDiff(G.treeOf(w, base?.id)["recipe.md"], G.treeOf(w, headId)["recipe.md"]).filter((l) => l.t !== " ");
        const state = p.state === "merged" ? `<span class="pr__state pr__state--merged">Merged</span>` : `<span class="pr__state">Open</span>`;
        if (p.state === "merged" && ci !== 6) {
            return `<p class="pr pr--line">${state} <b>Pull request #${p.n}, ${esc(p.title)}</b> <span class="pr__meta">${esc(p.head)} → ${esc(p.base)}</span></p>`;
        }
        return `<article class="pr">
      <header class="pr__head">${state}<h4>${esc(p.title)} <span>#${p.n}</span></h4>
        <p class="pr__meta">You want to merge <b style="color:${colorOf(p.head)}">${esc(p.head)}</b> into <b style="color:${colorOf(p.base)}">${esc(p.base)}</b></p></header>
      <div class="pr__diff"><p class="pr__file">recipe.md</p>${diff.map((l) => `<div class="dl dl--${l.t === "+" ? "add" : "del"}">${l.t} ${esc(l.s)}</div>`).join("") || `<div class="dl">(no changes)</div>`}</div>
      ${p.comments.map((c) => `<div class="pr__comment"><b>${esc(c.who)}</b> ${esc(c.text)}</div>`).join("")}
      ${p.approved ? `<p class="pr__ok">✓ Sam approved these changes</p>` : ""}
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
                push(h, { text: r.desks.length > 1 ? `desk ${i + 1} is here` : id === "sam" ? "Sam is here" : "you are here", color: "var(--ink)", here: true });
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
    const anim = [];
    const ink = (p, key, dur = 520) => {
        if (instant || seen.has(key))
            return;
        seen.add(key);
        anim.push(drawOn(p, { duration: dur }));
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
        const node = el("path", { d: circlePath(cx, cy, 12, seed(cid)), class: "node", stroke: col });
        const t = el("title");
        t.textContent = `${c.msg}\nby ${c.author} · ${G.short(cid)}`;
        node.append(t);
        gNodes.append(node);
        if (c.author === "Sam") {
            const s = el("text", { x: cx, y: cy + 4.5, class: "node__who" });
            s.textContent = "S";
            gNodes.append(s);
        }
        if (c.parents.length > 1)
            gNodes.append(el("path", { d: circlePath(cx, cy, 5, seed(cid) + 3), class: "node__merge", stroke: col }));
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
            if (!instant && !seen.has(`l:${cid}:${lb.text}`)) {
                seen.add(`l:${cid}:${lb.text}`);
                tx.classList.add("is-new");
            }
            else
                seen.add(`l:${cid}:${lb.text}`);
        });
    }
    for (const cid of cols)
        if (have.has(cid))
            seen.add(`n:${cid}`);
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
/* a hand-drawn arrow between places when something travels: push, pull, clone */
function animateFlow(cmd, who) {
    const m = cmd.match(/^git\s+(push|pull|clone|fetch)\b/);
    if (!m || prefersReduced)
        return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const gh = document.querySelector(".place--github");
        const pc = document.querySelector(`.place--${who}`);
        if (!gh || !pc)
            return;
        const a = gh.getBoundingClientRect(), b = pc.getBoundingClientRect();
        const up = m[1] === "push";
        const xx = Math.min(window.innerWidth - 40, a.right - 40);
        const y1 = up ? b.top + 20 : a.bottom - 10, y2 = up ? a.bottom - 10 : b.top + 20;
        if (Math.abs(y2 - y1) < 20)
            return;
        const svg = $("#flows");
        const g = el("g", { class: "flow" });
        const shaft = el("path", { d: linePath(xx, y1, xx, y2, 7, 2) });
        const dir = up ? -1 : 1;
        const head = el("path", { d: `M ${xx - 9} ${y2 - 12 * dir} L ${xx} ${y2} L ${xx + 9} ${y2 - 12 * dir}` });
        const label = el("text", { x: xx - 14, y: (y1 + y2) / 2, "text-anchor": "end" });
        label.textContent = m[1] === "clone" ? "clone ↓" : up ? "push ↑" : `${m[1]} ↓`;
        g.append(shaft, head, label);
        svg.append(g);
        drawOn(shaft, { duration: 600 }).then(() => drawOn(head, { duration: 200 }));
        setTimeout(() => { g.classList.add("is-gone"); setTimeout(() => g.remove(), 600); }, 1500);
    }));
}
/* ----------------------------------------------------------------- editor */
let edit = null;
function openEditor(place, deskI, file) {
    const dlg = $("#editor");
    const ta = $("#editor-text");
    const r = w.repos[place];
    const readOnly = place !== "you" || !r;
    let text;
    if (place === "github")
        text = G.treeOf(w, r.branches.main)[file] ?? "";
    else if (!r)
        text = w.folder?.[file] ?? "";
    else
        text = r.desks[deskI].work[file] ?? "";
    edit = { place, desk: deskI, file };
    const d = r?.desks[deskI];
    $("#editor-where").textContent = place === "github" ? "On GitHub, branch main (read only)" : place === "sam" ? "On Sam's computer (read only)"
        : d ? `On your computer, in ${d.path.replace("~/", "")}${d.branch ? `, branch ${d.branch}` : ""}` : "On your computer";
    $("#editor-title").textContent = file;
    ta.value = text;
    ta.readOnly = readOnly;
    $("#editor-save").hidden = readOnly;
    // other files in the same folder, as tabs
    const files = place === "github" ? Object.keys(G.treeOf(w, r.branches.main)) : r ? Object.keys(r.desks[deskI].work) : Object.keys(w.folder ?? {});
    const beatFiles = beat().edit?.files;
    $("#editor-tabs").innerHTML = files.length > 1 && !readOnly
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
    if (!readOnly && !G.hasMarkers(text)) {
        ta.focus();
        const end = text.indexOf("\n\n", text.indexOf("- "));
        ta.setSelectionRange(end > 0 ? end : text.length, end > 0 ? end : text.length);
    }
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
      <button type="button" class="pick pick--sam" data-pick="theirs"><span>Sam's version</span><code>${esc(m[2].trim())}</code></button>
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
    if (q.has("ch")) {
        const c = Math.max(0, Math.min(chapters.length - 1, Number(q.get("ch")) - 1));
        const b = Math.max(0, Math.min(chapters[c].beats.length - 1, Number(q.get("b") ?? 1) - 1));
        if (qm)
            mode = qm;
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
        if (qm)
            mode = qm;
        goto(0, 0, { replay: true });
    }
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
    const dlg = $("#editor");
    dlg.addEventListener("close", () => {
        if (dlg.returnValue === "save")
            saveEditor(false);
        edit = null;
    });
    window.addEventListener("resize", () => syncScroll());
}
boot();
//# sourceMappingURL=main.js.map