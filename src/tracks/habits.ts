/* tracks/habits.ts: Good habits.
 *
 * Starts with the team report already on GitHub, a few versions in, and
 * Albert has a clone. Most steps here are choices ("choose" beats): which
 * message, which commit, which name, which review comment.
 *
 * STUB: the chapters and a few working beats. Replace the beats freely;
 * keep beat ids unique within this track and end with the recap chapter.
 */
import * as G from "../model.js";
import type { Track } from "../tracks.js";
import { MAIN_FILE, work, setWork, insertAfter, commitAct, changed, clean, chose } from "../story.js";

const REPORT = "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\nNext step: try it with real users.\n\nDeadline: Friday\nThanks to everyone who helped.\n";

export const habits: Track = {
  id: "habits",
  title: "Good habits",
  short: "habits",
  word: "git",
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
      title: "Commit messages",
      short: "messages",
      goal: "write a commit message that helps later",
      beats: [
        {
          id: "msg-pick",
          kind: "choose",
          say: () => `You added the survey date to the report. Which commit message will help most a month from now?`,
          choose: {
            options: [
              { html: "<code>fix</code>", right: false, why: "It says something changed, not what." },
              { html: "<code>Add the survey date to the report</code>", right: true, why: "It says what changed, in a few words, starting with a verb." },
              { html: "<code>asdf</code>", right: false, why: "Nobody, you included, will know what this was." },
            ],
          },
          done: (w) => chose(w, "msg-pick"),
          term: ["commit message", "The short note on a commit. Say what changed, starting with a verb: <i>Add</i>, <i>Fix</i>, <i>Remove</i>."],
        },
        {
          id: "msg-edit",
          kind: "edit",
          say: () => `Add the survey date to <b>report.md</b>.`,
          edit: {
            files: [MAIN_FILE],
            ask: () => "Add the survey date",
            check: (w) => changed(w),
            canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /this month/, "The survey ran in May.")),
          },
          done: (w) => changed(w),
        },
        {
          id: "msg-commit",
          kind: "act",
          say: () => `Commit it with a message like the good one.`,
          acts: [commitAct("Add the survey date to the report")],
          done: (w) => clean(w) && w.commits[w.repos.you.branches.main]?.msg !== "Add a summary",
        },
      ],
    },
    {
      title: "Small focused commits",
      short: "small commits",
      goal: "keep one change per commit",
      beats: [
        {
          id: "how-many",
          kind: "choose",
          say: () => `You fixed a typo and rewrote the summary. How many commits should that be?`,
          choose: {
            options: [
              { html: "One commit with both", right: false, why: "Then you can't undo the summary without undoing the typo fix too." },
              { html: "Two: one for each change", right: true, why: "Each commit does one thing, so each can be read, reviewed or undone on its own." },
            ],
          },
          done: (w) => chose(w, "how-many"),
        },
      ],
    },
    {
      title: "Branch names and PR descriptions",
      short: "names",
      goal: "name branches and describe pull requests",
      beats: [
        {
          id: "branch-name",
          kind: "choose",
          say: () => `You're about to fix the deadline. Which branch name is best?`,
          choose: {
            options: [
              { html: "<code>stuff</code>", right: false, why: "It could be anything." },
              { html: "<code>fix-deadline</code>", right: true, why: "Short, and anyone can tell what's on it." },
              { html: "<code>my-branch-2</code>", right: false, why: "It says whose it is, not what's on it." },
            ],
          },
          done: (w) => chose(w, "branch-name"),
        },
      ],
    },
    {
      title: "Keep secrets out",
      short: "secrets",
      goal: "keep passwords and keys out of git",
      beats: [
        {
          id: "secret-file",
          kind: "act",
          say: () => `You saved the survey tool's password in <b>secrets.txt</b>, inside the project folder.`,
          acts: [{
            label: "Save secrets.txt",
            ai: "",
            steps: () => [(w) => { setWork(w, "secrets.txt", "survey password: example-only\n"); return "(secrets.txt is saved in the folder)"; }],
          }],
          done: (w) => !!work(w, "secrets.txt"),
          after: () => `git sees a <b>new</b> file. One <code>git add -A</code> and it would be on GitHub for anyone with access.`,
        },
        {
          id: "ignore",
          kind: "edit",
          say: () => `Tell git to leave it alone: open <b>.gitignore</b> and write <b>secrets.txt</b> in it.`,
          edit: {
            files: [".gitignore"],
            ask: () => "Write secrets.txt",
            check: (w) => /secrets\.txt/.test(work(w, ".gitignore")),
            canon: (w) => setWork(w, ".gitignore", "secrets.txt\n"),
          },
          done: (w) => /secrets\.txt/.test(work(w, ".gitignore")),
          term: [".gitignore", "A file listing what git should never track, like passwords, keys and big build files."],
        },
      ],
    },
    {
      title: "Good issues and kind reviews",
      short: "reviews",
      goal: "write issues and reviews people like to get",
      beats: [
        {
          id: "kind-review",
          kind: "choose",
          say: () => `Albert's pull request puts the deadline at the bottom. Which review comment helps most?`,
          choose: {
            options: [
              { html: "\"This is wrong.\"", right: false, why: "It doesn't say what's wrong or what would be better." },
              { html: "\"Could the deadline go at the top? People look for it first.\"", right: true, why: "It asks for one clear change and says why." },
              { html: "\"Rewrite the whole thing.\"", right: false, why: "Too big to act on, and not kind." },
            ],
          },
          done: (w) => chose(w, "kind-review"),
        },
      ],
    },
    {
      title: "You did it",
      short: "recap",
      goal: "",
      beats: [{ id: "end", kind: "next", say: () => `Clear messages, small commits, good names, no secrets in git, and reviews that say what would be better and why.`, done: () => false }],
    },
  ],
};
