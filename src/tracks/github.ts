/* tracks/github.ts: Issues and pull requests.
 *
 * Starts with the team report already on GitHub: a few versions, pushed,
 * and Albert has a clone. Toby has no computer; he works on GitHub (his
 * acts run gh as Toby, `who: "toby"`).
 *
 * STUB: the chapters and a few working beats. Replace the beats freely;
 * keep beat ids unique within this track and end with the recap chapter.
 */
import * as G from "../model.js";
import type { World } from "../model.js";
import type { Track } from "../tracks.js";
import { MAIN_FILE, work, setWork, insertAfter, commitAct, pullAct, desk, synced, changed, chose } from "../story.js";

const REPORT = "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\nNext step: try it with real users.\n\nDeadline: Friday\nThanks to everyone who helped.\n";
const lastPr = (w: World) => w.prs[w.prs.length - 1];

export const github: Track = {
  id: "github",
  title: "Issues and pull requests",
  short: "GitHub",
  word: "GitHub",
  start: (w, run) => {
    w.folder!["report.md"] = REPORT;
    run("git init");
    run("git add -A");
    run(`git commit -m "First version"`);
    setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /worked best/, "Results: two of three ideas worked."));
    run(`git commit -am "Add results"`);
    setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /^# /, "Summary: idea two wins."));
    run(`git commit -am "Add a summary"`);
    run(`git remote add origin ${G.REPO_URL}`);
    run("git push -u origin main");
    run(`git clone ${G.REPO_URL}`, "albert");
  },
  chapters: [
    {
      title: "Write it down",
      short: "issue",
      goal: "turn an idea into an issue",
      beats: [
        {
          id: "where",
          kind: "choose",
          ghTab: "issues",
          say: () => `Toby thinks the report needs a chart. Where should that idea go so nobody forgets it?`,
          choose: {
            options: [
              { html: "A message in the team chat", right: false, why: "Chats scroll away. In a week nobody finds it." },
              { html: "An <b>issue</b> on GitHub", right: true, why: "An issue stays with the project until someone closes it, and everyone can see it." },
              { html: "A sticky note on his screen", right: false, why: "Only Toby can see it." },
            ],
          },
          done: (w) => chose(w, "where"),
          term: ["issue", "A note on GitHub about one thing to do or fix. It stays open until someone closes it."],
        },
        {
          id: "toby-issue",
          kind: "watch",
          ghTab: "issues",
          say: () => `Toby opens an issue on GitHub.`,
          acts: [{
            label: "Watch Toby open it",
            who: "toby",
            steps: () => [`gh issue create --title "Add a chart" --body "Readers will want to see the numbers."`],
          }],
          done: (w) => (w.issues?.length ?? 0) >= 1,
          after: () => `The issue is on GitHub with a number. Anyone on the team can pick it up.`,
        },
      ],
    },
    {
      title: "Branch and draft pull request",
      short: "draft PR",
      goal: "open a pull request for an issue",
      beats: [
        {
          id: "branch",
          kind: "act",
          say: () => `You take the issue. Start a branch for it.`,
          acts: [{ label: "New branch", steps: () => ["git checkout -b add-chart"], ai: "start a branch called add-chart" }],
          done: (w) => desk(w)?.branch === "add-chart",
        },
        {
          id: "chart",
          kind: "edit",
          say: () => `Add a line about the chart to <b>report.md</b>.`,
          edit: {
            files: [MAIN_FILE],
            ask: () => "Add a line about the chart",
            check: (w) => changed(w),
            canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /Results/, "See the chart below.")),
          },
          done: (w) => changed(w),
        },
        {
          id: "openpr",
          kind: "act",
          ghTab: "pulls",
          say: () => `Commit it, put the branch on GitHub and open a pull request.`,
          acts: [
            commitAct("Add a chart"),
            { label: "Publish branch", steps: () => ["git push -u origin add-chart"], ai: "put my branch on GitHub" },
            { label: "Create pull request", look: "github", steps: () => [`gh pr create --title "Add a chart" --base main --head add-chart`], ai: "open a pull request for my branch" },
          ],
          done: (w) => w.prs.some((p) => p.head === "add-chart"),
        },
      ],
    },
    {
      title: "Review both ways",
      short: "review",
      goal: "ask for a review and give one",
      beats: [
        {
          id: "toby-review",
          kind: "watch",
          ghTab: "pulls",
          say: () => `Toby reads your pull request.`,
          acts: [{
            label: "Watch Toby review it",
            who: "toby",
            steps: (w) => [`gh pr review ${lastPr(w).n} --approve --body "Looks good to me."`],
          }],
          done: (w) => !!lastPr(w)?.approved,
        },
      ],
    },
    {
      title: "Merge and close",
      short: "merge",
      goal: "merge a pull request and close its issue",
      beats: [
        {
          id: "merge",
          kind: "act",
          ghTab: "pulls",
          say: () => `Approved. Merge it.`,
          acts: [{ label: "Merge pull request", look: "github", steps: (w) => [`gh pr merge ${lastPr(w).n} --merge`], ai: "merge the approved pull request" }],
          done: (w) => lastPr(w)?.state === "merged",
        },
        {
          id: "sync",
          kind: "act",
          say: () => `Check out main and pull, so your laptop has it too.`,
          acts: [{ label: "Check out main", steps: () => ["git checkout main"], ai: "check out main" }, pullAct],
          done: (w) => desk(w)?.branch === "main" && synced(w, "main"),
        },
      ],
    },
    {
      title: "You did it",
      short: "recap",
      goal: "",
      beats: [{ id: "end", kind: "next", say: () => `That's how a team works on GitHub: write it down, branch, ask for a review, merge, close.`, done: () => false }],
    },
  ],
};
