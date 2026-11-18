/* tracks/ci.ts: CI, GitHub Actions and rules for main.
 *
 * Starts with the team report already on GitHub, Albert has a clone, and
 * report.md carries a misspelling ("recieved") that nobody noticed. A spell
 * check (codespell) is the robot that will catch it.
 *
 * STUB: the chapters and a few working beats. Replace the beats freely;
 * keep beat ids unique within this track and end with the recap chapter.
 */
import * as G from "../model.js";
import type { Track } from "../tracks.js";
import { MAIN_FILE, work, setWork, insertAfter, commitAct, pushAct, clean, synced, chose } from "../story.js";

const REPORT = "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\nNext step: try it with real users.\n\nDeadline: Friday\nThanks to everyone who helped.\n";
const WORKFLOW = ".github/workflows/checks.yml";
const YAML = `name: Checks
on: [pull_request]
jobs:
  spelling:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install codespell
      - run: codespell
`;

export const ci: Track = {
  id: "ci",
  title: "CI and GitHub Actions",
  short: "CI",
  word: "CI",
  start: (w, run) => {
    w.folder!["report.md"] = REPORT;
    run("git init");
    run("git add -A");
    run(`git commit -m "First version"`);
    // the typo nobody saw: it is in every version from here on
    setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /worked best/, "We recieved 40 answers from users."));
    run(`git commit -am "Add the survey answers"`);
    setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /^# /, "Summary: idea two wins."));
    run(`git commit -am "Add a summary"`);
    run(`git remote add origin ${G.REPO_URL}`);
    run("git push -u origin main");
    run(`git clone ${G.REPO_URL}`, "albert");
  },
  chapters: [
    {
      title: "What CI means",
      short: "CI",
      goal: "let a robot check every change",
      beats: [
        {
          id: "who-checks",
          kind: "choose",
          ghTab: "actions",
          say: () => `There's a spelling mistake in report.md that nobody noticed. Who should catch mistakes like that, every time?`,
          choose: {
            options: [
              { html: "You, by reading every line before each push", right: false, why: "You will miss one sooner or later. Everyone does." },
              { html: "A robot that checks every pull request", right: true, why: "A robot never gets tired. That's <b>CI</b>: every change is checked the same way." },
            ],
          },
          done: (w) => chose(w, "who-checks"),
          term: ["CI", "Short for continuous integration: every change gets checked automatically before it goes in."],
        },
        {
          id: "workflow",
          kind: "edit",
          say: () => `Add a <b>workflow</b> file: the robot's instructions. Open <b>${WORKFLOW}</b> and write them.`,
          edit: {
            files: [WORKFLOW],
            ask: () => "Write the workflow",
            check: (w) => !!work(w, WORKFLOW).trim(),
            canon: (w) => setWork(w, WORKFLOW, YAML),
          },
          done: (w) => !!work(w, WORKFLOW).trim(),
        },
        {
          id: "commit-workflow",
          kind: "act",
          say: () => `Commit the workflow and push it.`,
          acts: [commitAct("Add a spell check"), pushAct],
          done: (w) => clean(w) && synced(w, "main") && !!G.treeOf(w, w.repos.github.branches.main)[WORKFLOW],
        },
      ],
    },
    {
      title: "Red means stop",
      short: "red",
      goal: "read a failing check",
      beats: [
        {
          id: "albert-pr",
          kind: "watch",
          ghTab: "pulls",
          say: () => `Albert adds a line and opens a pull request.`,
          acts: [{
            label: "Watch Albert do it",
            who: "albert",
            steps: () => [
              "git pull",
              "git checkout -b outro",
              (w) => { const d = w.repos.albert.desks[0]; d.work[MAIN_FILE] += "Questions? Ask Albert.\n"; return "(Albert edits report.md)"; },
              `git commit -am "Say who to ask"`,
              "git push -u origin outro",
              `gh pr create --title "Say who to ask" --base main --head outro`,
            ],
          }],
          done: (w) => w.prs.some((p) => p.author === "Albert"),
        },
      ],
    },
    {
      title: "Rules for main",
      short: "rules",
      goal: "protect main with a rule",
      beats: [
        {
          id: "rule-why",
          kind: "choose",
          ghTab: "settings",
          say: () => `What should happen when someone pushes straight to main, skipping the check?`,
          choose: {
            options: [
              { html: "Nothing, they know what they're doing", right: false, why: "Then the check only helps when people remember to use it." },
              { html: "GitHub refuses the push", right: true, why: "A <b>rule</b> on main makes every change go through a pull request with a green check." },
            ],
          },
          done: (w) => chose(w, "rule-why"),
        },
      ],
    },
    {
      title: "Actions do more",
      short: "deploy",
      goal: "let a workflow publish the report",
      beats: [
        {
          id: "deploy-why",
          kind: "choose",
          ghTab: "actions",
          say: () => `A workflow can do more than check. What could one do each time a pull request is merged?`,
          choose: {
            options: [
              { html: "Put the report online as a web page", right: true, why: "That's a deploy. The robot does it the same way every time." },
              { html: "Write the report for you", right: false, why: "A workflow runs the steps you wrote down. It doesn't write your report." },
            ],
          },
          done: (w) => chose(w, "deploy-why"),
        },
      ],
    },
    {
      title: "You did it",
      short: "recap",
      goal: "",
      beats: [{ id: "end", kind: "next", say: () => `Robots check every change, rules keep main safe, and Actions can publish your work.`, done: () => false }],
    },
  ],
};
