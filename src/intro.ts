/* intro.ts: the first thing a visitor sees.
 *
 * No reading required: a short animation shows the whole idea. A pile of
 * report copies collapses into one file, a line of saved versions draws out
 * of it, and the line is copied up to GitHub. Then one big button, and a
 * choice of how you want to do things (buttons, commands or an AI).
 *
 * Shown on the first visit; the brand in the top bar brings it back.
 */
import { drawOn, el, linePath, circlePath, prefersReduced } from "./sketch.js";

export type Mode = "buttons" | "command" | "ai";

/* a quiet note for people who know there are other hosts: it only appears on
 * hover or focus, never in the way of someone who doesn't wonder */
export const whyGithub = (label = "GitHub") => `<span class="why" tabindex="0">${label}<span class="why__tip" role="tooltip"><b>Why GitHub?</b> It's the most used place to keep git projects online, so it's the one you'll meet most. GitLab, Bitbucket and Codeberg work the same way: same git, a different website. We show GitHub to keep things simple.</span></span>`;
const SEEN = "htg-intro-seen";

export const introSeen = (): boolean => {
  try { return localStorage.getItem(SEEN) === "1"; } catch { return false; }
};

const MESS = ["report.docx", "report_v2.docx", "report_final.docx", "report_final_REALLY.docx", "report (edited).docx", "report_USE_THIS.docx"];
const CAPTIONS = [
  "Six copies of one report. Which is the real one?",
  "With git, it's one file…",
  "…and every version you saved, on a line.",
  "GitHub keeps a copy online, so others can join.",
];

export function showIntro(mode: Mode, onStart: (mode: Mode) => void) {
  document.body.dataset.intro = "on";
  const root = document.getElementById("intro")!;
  root.hidden = false;
  root.innerHTML = `
    <div class="intro__inner">
      <h1 class="intro__title">Git, explained by doing it.</h1>
      <p class="intro__sub">How git and GitHub work, from zero. About ten minutes, nothing to install.</p>
      <div class="intro__stage" aria-hidden="true">
        <svg class="intro__svg" viewBox="0 0 560 230"></svg>
        <div class="intro__files"></div>
      </div>
      <p class="intro__caption" aria-live="polite"></p>
      <div class="intro__pick" role="radiogroup" aria-label="how you want to do things">
        <p class="intro__ask">How do you want to do things?</p>
        <div class="intro__opts">
          ${opt("buttons", "Buttons", "Click, like in VS Code or GitHub Desktop", mode)}
          ${opt("command", "Commands", "Type real git commands", mode)}
          ${opt("ai", "An AI", "Ask in plain words", mode)}
        </div>
        <div class="preview" data-show="${mode}" aria-hidden="true">
          <div class="preview__pane preview__pane--buttons">
            <div class="pv-app">
              <div class="pv-app__rail"><i></i><i class="is-on"></i><i></i></div>
              <div class="pv-app__side">
                <p class="pv-app__head">SOURCE CONTROL <span>⎇ main</span></p>
                <p class="pv-app__msg">First version</p>
                <span class="pv-app__btn">✓ Commit</span>
                <p class="pv-app__sec">Changes</p>
                <p class="pv-app__file">report.md <i>M</i></p>
              </div>
              <div class="pv-app__code"><p><b>1</b># Team report</p><p><b>2</b></p><p class="is-add"><b>3</b>We tested three ideas.</p><p><b>4</b>The second one worked.</p></div>
              <svg class="pv-cursor" viewBox="0 0 16 21"><path d="M2 1.5 L2 16.5 L5.8 12.8 L8.6 19.5 L11.4 18.3 L8.6 11.7 L13.8 11.7 Z"/></svg>
            </div>
          </div>
          <div class="preview__pane preview__pane--command">
            <div class="pv-term"><p><b>~/my-recipe $</b> <span class="pv-type">git commit -m "First version"</span><span class="pv-caret"></span></p>
              <p class="pv-out">[main 3fa9c21] First version</p></div>
          </div>
          <div class="preview__pane preview__pane--ai">
            <div class="pv-chat">
              <p class="pv-me">save my work with a short note</p>
              <p class="pv-bot"><small>Assistant</small>I'll run <code>git commit -m "First version"</code> <span class="pv-yes">Yes, run it</span></p>
            </div>
          </div>
        </div>
        <p class="intro__hint">Same git underneath. You can switch any time.</p>
      </div>
      <button type="button" class="btn btn--go btn--big intro__start">Start <span aria-hidden="true">→</span></button>
    </div>`;
  let picked = mode;
  root.querySelectorAll<HTMLButtonElement>("[data-pick-mode]").forEach((b) => b.addEventListener("click", () => {
    picked = b.dataset.pickMode as Mode;
    root.querySelectorAll("[data-pick-mode]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    const pv = root.querySelector<HTMLElement>(".preview")!;
    pv.dataset.from = pv.dataset.show;
    pv.dataset.show = picked;
    // restart the little demo in the pane that just came in
    const pane = pv.querySelector<HTMLElement>(`.preview__pane--${picked}`)!;
    pane.classList.remove("is-playing");
    void pane.offsetWidth;
    pane.classList.add("is-playing");
  }));
  root.querySelector(".intro__start")!.addEventListener("click", () => {
    try { localStorage.setItem(SEEN, "1"); } catch { /* private mode */ }
    root.classList.add("is-leaving");
    setTimeout(() => {
      root.hidden = true;
      root.classList.remove("is-leaving");
      delete document.body.dataset.intro;
      onStart(picked);
    }, prefersReduced ? 0 : 280);
  });
  play(root);
  root.querySelector(`.preview__pane--${mode}`)!.classList.add("is-playing");
  (root.querySelector(".intro__start") as HTMLButtonElement).focus({ preventScroll: true });
}

function opt(m: Mode, title: string, sub: string, cur: Mode) {
  return `<button type="button" class="intro__opt" role="radio" data-pick-mode="${m}" aria-checked="${m === cur}">
    <b>${title}</b><span>${sub}</span></button>`;
}

let run = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, prefersReduced ? 0 : ms));

async function play(root: HTMLElement) {
  const me = ++run;
  const svg = root.querySelector<SVGSVGElement>(".intro__svg")!;
  const files = root.querySelector<HTMLElement>(".intro__files")!;
  const cap = root.querySelector<HTMLElement>(".intro__caption")!;
  const say = (i: number) => {
    cap.classList.remove("is-in");
    void cap.offsetWidth;
    cap.textContent = CAPTIONS[i];
    cap.classList.add("is-in");
  };
  svg.innerHTML = "";
  files.innerHTML = "";
  root.querySelector(".intro__start")!.classList.remove("is-ready");
  // positions are in the 560x230 stage, as percentages so the stage can scale
  const P = (x: number, y: number) => `left:${(x / 560) * 100}%;top:${(y / 230) * 100}%`;
  const spots: [number, number, number][] = [[160, 40, -6], [380, 38, 5], [270, 92, 3], [140, 145, -4], [400, 140, 6], [280, 195, -3]];

  // 1. the mess
  say(0);
  const chips = MESS.map((name, i) => {
    const c = document.createElement("span");
    c.className = "intro__file";
    c.textContent = name;
    c.setAttribute("style", `${P(spots[i][0], spots[i][1])};--r:${spots[i][2]}deg`);
    files.append(c);
    c.animate([{ opacity: 0, transform: `translate(-50%,-80%) rotate(${spots[i][2] * 3}deg) scale(.7)` }, { opacity: 1, transform: `translate(-50%,-50%) rotate(${spots[i][2]}deg)` }],
      { duration: 420, delay: i * 110, easing: "cubic-bezier(.2,1.4,.4,1)", fill: "both" });
    return c;
  });
  await wait(2200);
  if (me !== run) return;

  // 2. they collapse into one file
  say(1);
  const tx = 80, ty = 150;
  chips.forEach((c, i) => {
    const r = c.getBoundingClientRect(), s = files.getBoundingClientRect();
    const dx = ((tx / 560) * s.width) - (r.left - s.left + r.width / 2);
    const dy = ((ty / 230) * s.height) - (r.top - s.top + r.height / 2);
    c.animate([{ transform: `translate(-50%,-50%) rotate(var(--r))` }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(0deg) scale(.6)`, opacity: 0 }],
      { duration: 520, delay: i * 50, easing: "cubic-bezier(.6,0,.4,1)", fill: "forwards" });
  });
  await wait(620);
  if (me !== run) return;
  const one = document.createElement("span");
  one.className = "intro__file intro__file--one";
  one.textContent = "report.md";
  one.setAttribute("style", P(tx, ty));
  files.append(one);
  one.animate([{ transform: "translate(-50%,-50%) scale(.4)", opacity: 0 }, { transform: "translate(-50%,-50%) scale(1.15)", opacity: 1, offset: 0.6 }, { transform: "translate(-50%,-50%) scale(1)" }],
    { duration: 480, easing: "ease-out", fill: "both" });
  await wait(1100);
  if (me !== run) return;

  // 3. a line of saved versions draws out of it
  say(2);
  const xs = [215, 300, 385, 470];
  const line = el("path", { d: linePath(160, ty, 480, ty, 3), class: "intro__line" }) as SVGPathElement;
  svg.append(line);
  void drawOn(line, { duration: 900 });
  for (let i = 0; i < xs.length; i++) {
    await wait(200);
    if (me !== run) return;
    const dot = el("path", { d: circlePath(xs[i], ty, 13, i + 2), class: "intro__dot" }) as SVGPathElement;
    svg.append(dot);
    void drawOn(dot, { duration: 260 });
    const lab = el("text", { x: xs[i], y: ty + 36, class: "intro__lab" });
    lab.textContent = i === xs.length - 1 ? "now" : `v${i + 1}`;
    svg.append(lab);
  }
  await wait(1300);
  if (me !== run) return;

  // 4. the same line, copied up to GitHub
  say(3);
  const cloud = document.createElement("span");
  cloud.className = "intro__cloud";
  cloud.innerHTML = whyGithub();
  cloud.setAttribute("style", P(505, 34));
  files.append(cloud);
  cloud.animate([{ opacity: 0, transform: "translate(-50%,-30%)" }, { opacity: 1, transform: "translate(-50%,-50%)" }], { duration: 380, fill: "both", easing: "ease-out" });
  const upY = 34;
  const up = el("path", { d: linePath(215, upY, 425, upY, 9), class: "intro__line intro__line--gh" }) as SVGPathElement;
  svg.append(up);
  for (let i = 0; i < xs.length; i++) {
    const g = el("circle", { cx: xs[i], cy: ty, r: 7, class: "intro__fly" });
    svg.append(g);
    const nx = 215 + i * 70;
    g.animate([{ transform: "translate(0,0)" }, { transform: `translate(${nx - xs[i]}px, ${upY - ty}px)` }],
      { duration: 620, delay: i * 120, easing: "cubic-bezier(.45,0,.35,1)", fill: "forwards" });
  }
  void drawOn(up, { duration: 900 });
  await wait(1100);
  if (me !== run) return;
  root.querySelector(".intro__start")!.classList.add("is-ready");
  // hold the finished picture for a while, then play it again for anyone who
  // missed it. While someone is reading the GitHub note, the clock stops.
  const cl = root.querySelector<HTMLElement>(".intro__cloud");
  for (let held = 0; held < 7000; held += 200) {
    await wait(200);
    if (me !== run || root.hidden) return;
    if (cl && (cl.matches(":hover") || cl.querySelector(".why.is-open") || cl.contains(document.activeElement))) held = Math.min(held, 4000);
  }
  if (me !== run || root.hidden || prefersReduced) return;
  root.querySelector<HTMLElement>(".intro__stage")!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: "forwards" }).finished.then(() => {
    if (me !== run || root.hidden) return;
    root.querySelector<HTMLElement>(".intro__stage")!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: "forwards" });
    play(root);
  });
}
