/* fixture.mjs: hand-made worlds for every state of the GitHub page.
 * Dev only. Nothing here ships: the page loads the compiled public/ghpage.js. */
import { renderGhPage, wireGhPage, resetGhRuns } from "../../public/ghpage.js";
import { circlePath, linePath } from "../../public/sketch.js";

const q = new URLSearchParams(location.search);
if (q.get("bare")) document.body.classList.add("is-bare");

/* ------------------------------------------------------------ the repo */

const R1 = "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\n";
const R2 = R1 + "Next step: try it with real users.\n\nDeadline: Friday\nThanks to everyone who helpd.\n";
const R3 = R2.replace("helpd", "helped");
const R4 = "# Team report\n\nSummary: idea two won.\n\n" + R2.slice("# Team report\n\n".length);
const R5 = R4.replace("Summary: idea two won.", "Summary: the second idea won, and it was the cheapest.");
const NOTES = "rough notes\n- check the numbers\n";
const CHECKS = "name: Checks\non: [pull_request]\njobs:\n  spelling:\n    name: Check spelling\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: codespell-project/actions-codespell@v2\n";
const DEPLOY = "name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    name: Publish the report\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/deploy-pages@v5\n";

function baseWorld() {
  let n = 0;
  const commits = {};
  const C = (id, msg, parents, tree, author) => { commits[id] = { id, msg, parents, tree, author, n: n++ }; return id; };
  C("a1b2c3d", "Start the report", [], { "report.md": R1, "notes.txt": NOTES }, "You");
  C("b2c3d4e", "Add the results", ["a1b2c3d"], { "report.md": R2, "notes.txt": NOTES }, "Albert");
  const wf = { "report.md": R2, "notes.txt": NOTES, ".github/workflows/checks.yml": CHECKS, ".github/workflows/deploy.yml": DEPLOY };
  C("c3d4e5f", "Spell check every pull request (#8)", ["b2c3d4e"], wf, "You");
  C("d4e5f6a", "Fix the typo in the thanks line", ["c3d4e5f"], { ...wf, "report.md": R3 }, "You");
  C("e4f5a6b", "Add a summary", ["c3d4e5f"], { ...wf, "report.md": R4 }, "Albert");
  C("e5f6a7b", "Say which idea won", ["e4f5a6b"], { ...wf, "report.md": R5 }, "Albert");
  C("f6a7b8c", "Fix the typo in the thanks line (#4)", ["c3d4e5f"], { ...wf, "report.md": R3 }, "You");
  const gh = { id: "github", label: "GitHub", bare: true, branches: { main: "c3d4e5f", "fix-typo": "d4e5f6a", summary: "e5f6a7b" }, desks: [], remote: null, tracking: {}, upstream: {} };
  return {
    commits, repos: { github: gh }, folder: null, counter: n, vars: {}, num: 9,
    labels: [
      { name: "bug", color: "d73a4a", desc: "Something is wrong" },
      { name: "documentation", color: "0075ca", desc: "Words, not code" },
      { name: "good first issue", color: "7057ff", desc: "Good for newcomers" },
      { name: "question", color: "d876e3", desc: "Needs an answer" },
      { name: "idea", color: "c5def5", desc: "Worth a try" },
      { name: "wontfix", color: "ffffff", desc: "Not going to happen" },
      { name: "needs review", color: "fbca04", desc: "Someone should look" },
      { name: "blocked", color: "1d1d1d", desc: "Waiting on something" },
    ],
    issues: [
      { n: 1, title: "Fix the typo in the thanks line", body: "The last line says \"helpd\". It should say \"helped\".", author: "toby", labels: ["bug", "good first issue"], assignees: ["you"], state: "open", comments: [] },
      { n: 2, title: "Add a summary at the top", body: "Readers want the result first. One line at the top would do.", author: "you", labels: ["documentation"], assignees: ["albert"], state: "open",
        comments: [{ who: "albert", text: "I can take this one." }, { who: "toby", text: "Keep it to one line, please. See #3 for the chart idea." }] },
      { n: 3, title: "Should we add a chart?", body: "A small chart of the three ideas might help.", author: "albert", labels: ["question", "idea"], assignees: [], state: "open", comments: [{ who: "you", text: "Maybe next month." }] },
      { n: 5, title: "Translate the report", body: "Could we have it in two languages?", author: "albert", labels: ["wontfix"], assignees: [], state: "closed", reason: "not_planned", comments: [{ who: "you", text: "Not this month, sorry." }] },
      { n: 6, title: "Write the deadline in bold", body: "It is easy to miss.", author: "toby", labels: ["needs review", "blocked"], assignees: ["toby", "albert", "you"], state: "open", comments: [] },
    ],
    prs: [
      { n: 4, title: "Fix the typo", head: "fix-typo", base: "main", author: "you", state: "open", approved: false, comments: [], body: "Closes #1", draft: false,
        labels: ["bug"], assignees: ["you"], reviewers: ["toby"], reviews: [], closes: [1] },
      { n: 7, title: "Add a summary", head: "summary", base: "main", author: "albert", state: "open", approved: false,
        body: "Adds one line at the top, so readers get the result first.\n\nCloses #2", labels: ["documentation"], assignees: ["albert"], reviewers: ["you"], closes: [2],
        reviews: [
          { who: "toby", state: "commented", text: "", commit: "e4f5a6b", notes: [{ who: "toby", text: "Which idea is \"idea two\"?", file: "report.md", line: 3 }] },
          { who: "toby", state: "changes_requested", text: "Nearly there. One thing before this goes in.", commit: "e5f6a7b",
            notes: [{ who: "toby", text: "Too long for a summary. Can you cut it to one short line?", file: "report.md", line: 3 }] },
        ],
        comments: [{ who: "albert", text: "Good point, fixing it now." }] },
      { n: 8, title: "Spell check every pull request", head: "add-checks", base: "main", author: "you", state: "merged", approved: true, comments: [],
        mergeCommit: "c3d4e5f", method: "squash", branchDeleted: true, labels: [], assignees: ["you"], reviewers: [],
        reviews: [{ who: "albert", state: "approved", text: "Good idea.", commit: "c3d4e5f", notes: [] }] },
      { n: 9, title: "Try a new title", head: "new-title", base: "main", author: "albert", state: "closed", approved: false, comments: [{ who: "albert", text: "Never mind, the old one is fine." }], branchDeleted: true },
    ],
    runs: [
      { id: 1, workflow: "Checks", file: ".github/workflows/checks.yml", event: "pull_request", branch: "add-checks", commit: "c3d4e5f", pr: 8, ok: true,
        jobs: [{ name: "Check spelling", ok: true, steps: [{ name: "Set up job", ok: true, log: ["Runner: ubuntu-latest"] }, { name: "Check out the code", ok: true, log: ["Fetched 1 commit"] }, { name: "Run codespell", ok: true, log: ["codespell .", "No spelling mistakes found"] }] }] },
      { id: 2, workflow: "Checks", file: ".github/workflows/checks.yml", event: "pull_request", branch: "summary", commit: "e5f6a7b", pr: 7, ok: false,
        jobs: [{ name: "Check spelling", ok: false, steps: [
          { name: "Set up job", ok: true, log: ["Runner: ubuntu-latest"] },
          { name: "Check out the code", ok: true, log: ["Fetched 2 commits"] },
          { name: "Run codespell", ok: false, log: ["codespell .", "report.md:10: helpd ==> helped", "Error: 1 spelling mistake found"] },
        ] }] },
      { id: 3, workflow: "Checks", file: ".github/workflows/checks.yml", event: "pull_request", branch: "fix-typo", commit: "d4e5f6a", pr: 4, ok: true,
        jobs: [{ name: "Check spelling", ok: true, steps: [{ name: "Set up job", ok: true, log: ["Runner: ubuntu-latest"] }, { name: "Check out the code", ok: true, log: ["Fetched 1 commit"] }, { name: "Run codespell", ok: true, log: ["codespell .", "No spelling mistakes found"] }] }] },
    ],
    rules: [],
  };
}

const RULE = { name: "Protect main", branch: "main", requirePR: true, approvals: 1, checks: ["Check spelling"], blockForcePush: true };

/* after #4 merged: main moved, the typo issue closed itself, the site went live */
function merged4(w) {
  const p = w.prs.find((x) => x.n === 4);
  Object.assign(p, { state: "merged", mergeCommit: "f6a7b8c", method: "squash", branchDeleted: true, approved: true, reviewers: [],
    reviews: [{ who: "toby", state: "approved", text: "Thanks!", commit: "d4e5f6a", notes: [] }] });
  w.repos.github.branches.main = "f6a7b8c";
  delete w.repos.github.branches["fix-typo"];
  Object.assign(w.issues.find((i) => i.n === 1), { state: "closed", reason: "completed", closedBy: 4 });
  w.runs.push({ id: 4, workflow: "Deploy", file: ".github/workflows/deploy.yml", event: "push", branch: "main", commit: "f6a7b8c", ok: true,
    jobs: [{ name: "Publish the report", ok: true, steps: [{ name: "Check out the code", ok: true, log: ["Fetched 1 commit"] }, { name: "Publish", ok: true, log: ["Uploaded 3 files", "Live at https://you.github.io/my-report"] }] }] });
  w.pages = { url: "https://you.github.io/my-report", commit: "f6a7b8c" };
  w.rules = [RULE];
  return w;
}

/* ------------------------------------------------------------ scenes */

const S = (tab, extra = {}, edit = (w) => w) => ({ state: { tab, ...extra }, world: () => edit(baseWorld()) });
const scenes = {
  "code": S("code", {}, merged4),
  "code-fresh": S("code", {}, (w) => { w.runs = []; w.prs = []; w.issues = []; delete w.repos.github.branches.summary; delete w.repos.github.branches["fix-typo"]; return w; }),
  "issues": S("issues"),
  "issues-closed": S("issues", { issueFilter: "closed" }, merged4),
  "issues-empty": S("issues", {}, (w) => { w.issues = []; return w; }),
  "issue": S("issues", { openIssue: 2 }),
  "issue-closed": S("issues", { openIssue: 1 }, merged4),
  "issue-notplanned": S("issues", { openIssue: 5 }),
  "pulls": S("pulls", {}, (w) => { w.prs.find((p) => p.n === 4).draft = true; return w; }),
  "pulls-closed": S("pulls", { prFilter: "closed" }),
  "pr-draft": S("pulls", { openPr: 4 }, (w) => { w.prs.find((p) => p.n === 4).draft = true; w.rules = [RULE]; return w; }),
  "pr-changes": S("pulls", { openPr: 7 }, (w) => { w.rules = [RULE]; return w; }),
  "pr-ready": S("pulls", { openPr: 4 }, (w) => {
    w.rules = [RULE];
    Object.assign(w.prs.find((p) => p.n === 4), { reviewers: [], reviews: [{ who: "toby", state: "approved", text: "Looks good to me.", commit: "d4e5f6a", notes: [] }] });
    return w;
  }),
  "pr-merged": S("pulls", { openPr: 4 }, merged4),
  "pr-merged8": S("pulls", { openPr: 8 }),
  "actions": S("actions", {}, merged4),
  "run": S("actions", { openRun: 2 }),
  "run-live": { ...S("actions", { openRun: 10 }, (w) => { w.runs.find((r) => r.id === 2).id = 10; return w; }), live: true },
  "actions-live": { ...S("actions", {}, merged4), live: true },
  "settings": S("settings", {}, merged4),
  "settings-empty": S("settings"),
};

const name = scenes[q.get("s")] ? q.get("s") : "code";
const scene = scenes[name];
document.getElementById("scenes").innerHTML = Object.keys(scenes).map((k) =>
  `<li><a href="?s=${k}${q.get("theme") ? `&theme=${q.get("theme")}` : ""}"${k === name ? ' aria-current="page"' : ""}>${k}</a></li>`).join("");

/* ------------------------------------------------------------ a stand-in strip */

const COLORS = ["var(--pen-red)", "var(--pen-green)", "var(--pen-amber)", "var(--pen-remote)"];
const branchColor = new Map([["main", "var(--pen-blue)"]]);
const colorOf = (b) => { if (!branchColor.has(b)) branchColor.set(b, COLORS[(branchColor.size - 1) % COLORS.length]); return branchColor.get(b); };
["fix-typo", "summary", "add-checks", "new-title"].forEach(colorOf);

const strip = document.querySelector('[data-strip="github"]');
{
  const xs = [56, 156, 256, 356, 456];
  let d = "";
  xs.forEach((x, i) => { d += `<path class="node" stroke="var(--pen-blue)" d="${circlePath(x, 90, 12, i + 3, 0.8)}"/>`; if (i) d += `<path class="edge" stroke="var(--pen-blue)" d="${linePath(xs[i - 1] + 13, 90, x - 13, 90, i)}"/>`; });
  d += `<path class="edge" stroke="var(--pen-red)" d="${linePath(456, 77, 520, 40, 9)}"/><path class="node" stroke="var(--pen-red)" d="${circlePath(540, 40, 12, 11, 0.8)}"/>`;
  d += `<text class="label" x="456" y="126" fill="var(--pen-blue)">main</text><text class="label" x="540" y="76" fill="var(--pen-red)">fix-typo</text>`;
  strip.innerHTML = `<svg class="strip__svg" width="600" height="140" viewBox="0 0 600 140">${d}</svg>`;
}

/* ------------------------------------------------------------ draw */

const world = scene.world();
let state = scene.state;
const host = document.querySelector(".place__prs");
const draw = (instant) => renderGhPage(host, world, { ...state, colorOf }, strip, { instant });
/* live scenes: every run is old news except the newest, which plays */
function playNewest() {
  const newest = world.runs.reduce((a, b) => (a.id > b.id ? a : b));
  world.runs = world.runs.filter((r) => r !== newest);
  draw(true);
  world.runs.push(newest);
  draw(false);
}
if (scene.live) playNewest(); else draw(true);
wireGhPage(document.getElementById("world"), (patch) => { state = { ...state, ...patch }; draw(false); });
/* play the newest run again, for a picture mid-way */
window.replay = () => { resetGhRuns(); host.innerHTML = ""; playNewest(); };
/* for checks run from the console or scripts */
window.fx = { baseWorld, merged4, RULE };
