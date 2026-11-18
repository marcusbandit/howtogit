/* tracks/habits.ts: Good habits.
 *
 * For someone who can commit, push and open a pull request, but was never
 * told how a team likes it done. Each habit is shown, practised, and its
 * reason given: the people reading your history later.
 *
 * The world: the report has been on GitHub a while. Its older history is
 * messy on purpose (wip, stuff, fix, asdf); Albert's two merged pull
 * requests on top show the better way. You start on a branch, tidy-up, for
 * the chapters on commits. Toby has opened an issue about the deadline.
 *
 * Numbers in the start: pull requests #1 and #2 (Albert's, merged), issue #3
 * (Toby's). The steps look numbers up in the world instead of assuming them.
 */
import * as G from "../model.js";
import type { World } from "../model.js";
import type { Track } from "../tracks.js";
import type { Act } from "../story.js";
import {
  MAIN_FILE, work, setWork, insertAfter, commitAct, pullAct, desk, you, gh, head, headTree, changed, clean, synced, chose, q,
} from "../story.js";

const REPORT = "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\nNext step: try it with real users.\n\nDeadline: Thursday\nThanks to everyone who helpd.\n";
const OLD_LINK = "Survey: https://survey.example.com/old";
const NEW_LINK = "Survey: https://survey.example.com/may";
const TIDY = "tidy-up";
const KEY = "SURVEY_KEY=example-key-not-real-1234\n";

/* ------------------------------------------------------------ lookups */

const deadlineIssue = (w: World) => (w.issues ?? []).find((i) => i.author === "Toby")?.n ?? 3;
const fixBr = (w: World) => w.vars.fixBranch || `fix/${deadlineIssue(w)}-deadline-at-top`;
const myPr = (w: World) => w.prs.find((p) => p.author === "You" && p.head === fixBr(w));
const myIssue = (w: World) => (w.issues ?? []).find((i) => i.author === "You");
const albertPr = (w: World) => { const i = myIssue(w); return w.prs.find((p) => p.author === "Albert" && !!i && (p.closes ?? []).includes(i.n)); };
const reviewedBy = (w: World, state?: G.Review["state"]) =>
  (albertPr(w)?.reviews ?? []).some((r) => r.who === "you" && (!state || r.state === state));
const commentedOn = (w: World) => (albertPr(w)?.reviews ?? []).some((r) => r.who === "you" && !!r.text.trim());

/* the files a commit changed, against its first parent */
function touched(w: World, id: string | undefined): string[] {
  const c = id ? w.commits[id] : undefined;
  if (!c) return [];
  const a = G.treeOf(w, c.parents[0]), b = c.tree;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]);
}
const lines = (s: string) => s.split("\n");

/* ------------------------------------------------------------ messages */

const VAGUE = /^(wip|stuff|fix(es|ed)?|asdf+|update[sd]?|changes?|misc|tweaks?|tests?|commit|save[sd]?|done|ok|more|[^a-z]*|[a-z]{1,3})$/i;
const subjectOk = (s: string) => { const t = s.trim(); return t.length >= 6 && t.length <= 72 && !VAGUE.test(t); };
const headMsg = (w: World) => { const id = head(w); return id ? w.commits[id].msg : ""; };
/* a commit you just made in this track: yours, and not on GitHub's main */
const mine = (w: World, id = head(w)) => !!id && w.commits[id].author === "You" && !G.ancestors(w, gh(w)?.branches.main).has(id);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/* what to say when your newest commit's subject wouldn't help anyone */
function msgStatus(w: World): string {
  if (!mine(w)) return "";
  const s = G.subject(headMsg(w)).trim();
  if (subjectOk(s)) return "";
  const fix = `Press <b>Undo</b> and write another, or rewrite it: <code>git commit --amend -m "..."</code>`;
  if (s.length > 72) return `That subject is ${s.length} characters, and lists cut it off. Keep it short and put the why in the body. ${fix}`;
  return `<code>${esc(s)}</code> doesn't say what changed. ${fix}`;
}

/* a commit act with a subject and a body: two -m, one paragraph each */
const commitWithBody = (subject: string, body: string): Act => ({
  label: "Stage all and commit",
  inputs: [
    { key: "msg", label: "Subject", def: () => subject, max: 80 },
    { key: "body", label: "Body: why", def: () => body, max: 160 },
  ],
  steps: (_w, v) => ["git add -A", `git commit -m "${q(v.msg)}"${v.body?.trim() ? ` -m "${q(v.body)}"` : ""}`],
  ai: "commit this with a short subject and a line saying why",
});

const branchName = (v: Record<string, string>, def: string) => (v.name ?? "").trim().replace(/\s+/g, "-") || def;

/* ------------------------------------------------------------ the track */

export const habits: Track = {
  id: "habits",
  title: "Good habits",
  short: "habits",
  word: "team",
  start: (w, run) => {
    const edit = (who: "you" | "albert", f: (t: string) => string, file = MAIN_FILE) => {
      const d = w.repos[who].desks[0];
      d.work[file] = f(d.work[file]);
    };
    w.folder![MAIN_FILE] = REPORT;
    run("git init");
    run("git add -A");
    run(`git commit -m "First version"`);
    // the messy stretch: every one of these is a real change nobody can find again
    edit("you", (t) => insertAfter(t, /worked best/, "Results: two of three ideas worked."));
    run(`git commit -am "wip"`);
    edit("you", (t) => insertAfter(t, /^# /, "Summary: idea two wins."));
    run(`git commit -am "stuff"`);
    edit("you", (t) => t.replace("Deadline: Thursday", "Deadline: Friday"));
    run(`git commit -am "fix"`);
    edit("you", () => "rough notes\n- numbers checked, all fine\n", "notes.txt");
    run(`git commit -am "asdf"`);
    run(`git remote add origin ${G.REPO_URL}`);
    run("git push -u origin main");
    // Albert joins and does it the way the team agreed: branch, pull request, review
    run(`git clone ${G.REPO_URL}`, "albert");
    run("git switch -c docs/interview-count", "albert");
    edit("albert", (t) => insertAfter(t, /We tested/, "We interviewed 12 people."));
    run(`git commit -am "Add how many people we interviewed" -m "Toby asked where the results came from."`, "albert");
    run("git push -u origin docs/interview-count", "albert");
    run(`gh pr create --title "Add how many people we interviewed" --body "Toby asked where the results came from. Checked the number against the notes."`, "albert");
    run("gh pr review 1 --approve", "toby");
    run("gh pr merge 1 --squash --delete-branch", "toby");
    run("git switch main", "albert");
    run("git pull", "albert");
    run("git branch -D docs/interview-count", "albert");
    // you pull that, and start a branch for today's tidying
    run("git pull");
    run(`git switch -c ${TIDY}`);
    // meanwhile Albert gets one more change merged, which you haven't pulled
    run("git switch -c docs/survey-link", "albert");
    edit("albert", (t) => insertAfter(t, /^Results/, OLD_LINK));
    run(`git commit -am "Add a link to the survey"`, "albert");
    run("git push -u origin docs/survey-link", "albert");
    run(`gh pr create --title "Add a link to the survey" --body "Readers asked what the questions were."`, "albert");
    run("gh pr review 2 --approve", "toby");
    run("gh pr merge 2 --squash --delete-branch", "toby");
    run("git switch main", "albert");
    run("git pull", "albert");
    run("git branch -D docs/survey-link", "albert");
    run(`gh issue create --title "The deadline is hard to find" --body "Two people asked me when the report is due. The deadline is near the bottom, after everything else." --label documentation`, "toby");
  },
  chapters: [
    {
      title: "Commit messages",
      short: "messages",
      goal: "write commit messages people can use later",
      beats: [
        {
          id: "read-log",
          kind: "act",
          say: () => `Today you're tidying up the report, on a branch called <b>${TIDY}</b>. Before you add anything, read the history the way a teammate would: one line per commit.`,
          acts: [{ label: "Show history", steps: () => ["git log --oneline"], ai: "show me the history, one line per commit" }],
          done: (w) => w.vars.sawLog === "1",
          after: () => `Albert's commit on top says what it did. The four under it don't: <code>wip</code>, <code>stuff</code>, <code>fix</code>, <code>asdf</code>. One of them moved the deadline to Friday. Which one? You'd have to open each to find out.`,
          more: [["Can I fix old messages?", "Only by rewriting those commits, which gives them new IDs and trips up everyone who has a copy. On a shared branch, leave them be and write the next ones well."]],
        },
        {
          id: "pick",
          kind: "choose",
          say: () => `You're about to add the date the survey ran. Which commit message will help most a month from now?`,
          choose: {
            options: [
              { html: "<code>fix</code>", right: false, why: "Fix what? It says something changed, not what." },
              { html: "<code>Update report.md</code>", right: false, why: "The history already shows which file changed. The message is there to say what changed in it." },
              { html: "<code>Add the survey date</code>", right: true, why: "It says what the commit does, in a few words. Anyone reading the history finds it without opening a thing." },
            ],
          },
          done: (w) => chose(w, "pick"),
          term: ["subject line", "The first line of a commit message: what the commit does, in about 50 characters. It's all the one-line history and GitHub's lists show."],
        },
        {
          id: "mood",
          kind: "choose",
          say: () => `Most teams write that line as an instruction, so it finishes the sentence <i>If applied, this commit will...</i> Which one does?`,
          choose: {
            options: [
              { html: "<code>Added the survey date</code>", right: false, why: "Plenty of projects write it this way, but it doesn't finish the sentence." },
              { html: "<code>Adding the survey date</code>", right: false, why: "It doesn't finish the sentence either." },
              { html: "<code>Add the survey date</code>", right: true, why: "<i>If applied, this commit will add the survey date.</i> Git writes its own messages this way: <code>Merge branch 'main'</code>." },
            ],
          },
          done: (w) => chose(w, "mood"),
          term: ["imperative", "Written as an instruction: <i>Add</i>, <i>Fix</i>, <i>Remove</i>. The usual way to write a commit subject."],
        },
        {
          id: "shape",
          kind: "choose",
          say: () => `Sometimes the reason for a change isn't clear from the change. Readers kept asking when the survey ran, and that's worth keeping. Where does it go?`,
          choose: {
            options: [
              { html: "<code>Add the survey date because readers kept asking when the survey ran and Toby said it belongs in the report</code>", right: false, why: "One long line. Lists cut it off, and the what gets lost in the why." },
              { html: "<code>Add the survey date</code>, and the why in the team chat", right: false, why: "Chats scroll away. The commit stays next to the change for as long as the project lives." },
              { html: "<code>Add the survey date</code><br><br><code>Readers kept asking when the survey ran.</code>", right: true, why: "A short subject, an empty line, then a <b>body</b> with the why. Lists show the subject; the body is there when someone opens the commit." },
            ],
          },
          done: (w) => chose(w, "shape"),
          term: ["commit body", "Everything after the subject line and one empty line: why the change was made, when the change alone doesn't say."],
          more: [
            ["How do I write a body on the command line?", "Give <code>-m</code> twice: <code>git commit -m \"Add the survey date\" -m \"Readers kept asking when it ran.\"</code> Each <code>-m</code> becomes its own paragraph. A plain <code>git commit</code> opens an editor where you write both."],
            ["What are fix: and feat: at the start of some messages?", "<b>Conventional Commits</b>, a convention some teams use: each subject starts with its kind, like <code>fix: correct the deadline</code>, <code>feat: add a chart</code> or <code>docs: add the survey date</code>, so tools can sort the history and write release notes. If a project's history looks like that, write yours the same way."],
          ],
        },
        {
          id: "survey-edit",
          kind: "edit",
          say: () => `Now write one for real. Add the survey date to <b>report.md</b>, something like <i>The survey ran in May.</i>`,
          edit: {
            files: [MAIN_FILE],
            ask: () => "Add the survey date",
            check: (w) => changed(w),
            canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /this month/, "The survey ran in May.")),
          },
          done: (w) => changed(w),
        },
        {
          id: "survey-commit",
          kind: "act",
          say: () => `Commit it with a short subject that says what it does, and a body that says why.`,
          acts: [commitWithBody("Add the survey date", "Readers kept asking when the survey ran.")],
          done: (w) => clean(w) && mine(w) && subjectOk(G.subject(headMsg(w))),
          status: msgStatus,
          after: (w) => {
            const [subject, ...rest] = headMsg(w).split("\n");
            const body = rest.join(" ").trim();
            return `The one-line history will show <code>${esc(subject)}</code>, and that's enough to find it. ${body ? "Open the commit and the why is right under it." : "No body this time, which is fine when the subject says it all."}`;
          },
        },
      ],
    },

    {
      title: "Small, focused commits",
      short: "small commits",
      goal: "keep one change per commit",
      beats: [
        {
          id: "two-edits",
          kind: "edit",
          say: () => `Two more things to tidy. In <b>report.md</b>, fix the typo: <b>helpd</b> should be <b>helped</b>. In <b>notes.txt</b>, add a to-do, like <i>- ask about the budget</i>.`,
          edit: {
            files: [MAIN_FILE, "notes.txt"],
            ask: () => "Fix the typo and add a to-do",
            check: (w) => !/helpd\b/.test(work(w, MAIN_FILE)) && changed(w, "notes.txt"),
            canon: (w) => {
              setWork(w, MAIN_FILE, work(w, MAIN_FILE).replace(/helpd\b/, "helped"));
              setWork(w, "notes.txt", work(w, "notes.txt") + "- ask about the budget\n");
            },
          },
          done: (w) => !/helpd\b/.test(work(w, MAIN_FILE)) && changed(w, "notes.txt"),
          after: () => `Two changes, side by side. They have nothing to do with each other.`,
        },
        {
          id: "how-many",
          kind: "choose",
          say: () => `How many commits should those two changes be?`,
          choose: {
            options: [
              { html: "One: <code>Fix a typo and add a to-do</code>", right: false, why: "An <i>and</i> in a subject is a hint: that's two commits. Undo one later and you undo both." },
              { html: "Two: one for the typo, one for the to-do", right: true, why: "Each commit does one thing, so each can be read, reviewed or undone on its own." },
            ],
          },
          done: (w) => chose(w, "how-many"),
          term: ["atomic commit", "A commit that does one thing, completely. Small enough to read at a glance, whole enough to undo on its own."],
        },
        {
          id: "commit-typo",
          kind: "act",
          say: () => `Stage only <b>report.md</b> and commit the typo fix.`,
          acts: [commitAct("Fix a typo in the thanks line", MAIN_FILE)],
          done: (w) => {
            const t = touched(w, head(w));
            return mine(w) && t.length === 1 && t[0] === MAIN_FILE && !/helpd\b/.test(headTree(w)[MAIN_FILE] ?? "") &&
              changed(w, "notes.txt") && subjectOk(G.subject(headMsg(w)));
          },
          status: (w) => mine(w) && touched(w, head(w)).length > 1
            ? `That commit holds both changes. Press <b>Undo</b>, and stage only <b>report.md</b> this time.`
            : msgStatus(w),
          after: () => `One commit, one change. notes.txt is still waiting, untouched.`,
        },
        {
          id: "commit-todo",
          kind: "act",
          say: () => `Now stage <b>notes.txt</b> and commit the to-do.`,
          acts: [commitAct("Add a to-do about the budget", "notes.txt")],
          done: (w) => {
            const t = touched(w, head(w));
            return clean(w) && mine(w) && t.length === 1 && t[0] === "notes.txt" && subjectOk(G.subject(headMsg(w)));
          },
          status: msgStatus,
          after: () => `Two commits, one change each. Each line of the history tells you exactly one thing.`,
        },
        {
          id: "why-small",
          kind: "choose",
          say: () => `A week later, Toby says the budget to-do is wrong: that question was settled long ago. What can you do now that one commit for both wouldn't allow?`,
          choose: {
            options: [
              { html: "Nothing different. Undoing works the same either way", right: false, why: "Git undoes whole commits. With both changes in one, undoing the to-do undoes the typo fix too." },
              { html: "Undo just the to-do commit, and keep the typo fix", right: true, why: "<code>git revert</code> makes a new commit that undoes one old commit, and only that one." },
            ],
          },
          done: (w) => chose(w, "why-small"),
          more: [["Two changes in the same file?", "<code>git add -p</code> goes through a file piece by piece and asks which pieces to stage. Editors like VS Code let you select lines and stage just those."]],
        },
      ],
    },

    {
      title: "Branches and pull requests",
      short: "branch, PR",
      goal: "take a task from issue to pull request the way teams like it",
      beats: [
        {
          id: "where-fix",
          kind: "choose",
          ghTab: "issues",
          say: (w) => `Toby opened issue #${deadlineIssue(w)} on GitHub: the deadline is hard to find. You'll move it to the top of the report. Where do you make that change?`,
          choose: {
            options: [
              { html: "Straight on main. It's one line", right: false, why: "main is the copy everyone pulls. A change there reaches everyone before anyone has looked at it, and many teams' rules refuse it." },
              { html: `On ${TIDY}, with today's other work`, right: false, why: "Then the fix waits for the tidy-up, and the reviewer gets two jobs in one. One task, one branch." },
              { html: "On a new branch, just for this", right: true, why: "Its own branch, then its own pull request: looked at on its own, merged when it's ready." },
            ],
          },
          done: (w) => chose(w, "where-fix"),
        },
        {
          id: "name-pick",
          kind: "choose",
          say: () => `What should the new branch be called?`,
          choose: {
            options: [
              { html: "<code>stuff</code>", right: false, why: "It could be anything." },
              { html: "<code>toby</code>", right: false, why: "It says who asked, not what's on it." },
              { html: "<code>fix/3-deadline-at-top</code>", right: true, why: "The kind of change, the issue number and a few words. Anyone can tell what's on it and find the issue." },
            ],
          },
          done: (w) => chose(w, "name-pick"),
          more: [["Do I have to use fix/ and docs/?", "No. Teams pick a pattern and stick to it: <code>fix/</code>, <code>docs/</code> and <code>feat/</code> are common, and so is the issue number. Look at a project's other branches and do the same."]],
        },
        {
          id: "start-branch",
          kind: "act",
          say: () => `Start from the newest main, so you don't build on an old copy. Switch to main, pull, then make the branch.`,
          acts: [
            { label: "Switch to main", steps: () => ["git switch main"], ai: "switch to main" },
            pullAct,
            {
              label: "New branch",
              inputs: [{ key: "name", label: "Branch name", def: (w) => `fix/${deadlineIssue(w)}-deadline-at-top` }],
              steps: (w, v) => [`git switch -c ${branchName(v, `fix/${deadlineIssue(w)}-deadline-at-top`)}`],
              ai: "start a branch for the deadline fix",
            },
          ],
          done: (w) => {
            const b = desk(w)?.branch;
            return !!b && b !== "main" && b !== TIDY && you(w).branches[b] === gh(w).branches.main;
          },
          status: (w) => {
            const b = desk(w)?.branch;
            return b && b !== "main" && b !== TIDY && you(w).branches[b] !== gh(w).branches.main
              ? `<b>${esc(b)}</b> starts from an old copy of main: GitHub has a newer commit. Press <b>Undo</b>, then switch to main and pull before you branch.`
              : "";
          },
          onDone: (w) => { w.vars.fixBranch = desk(w).branch!; },
          after: () => `The pull brought down a change Albert got merged while you were tidying: <i>Add a link to the survey</i>. Your branch starts from it. Branch from an old main and you get conflicts nobody needed.`,
        },
        {
          id: "move-deadline",
          kind: "edit",
          say: () => `In <b>report.md</b>, move the line <b>Deadline: Friday</b> up to just under the title.`,
          edit: {
            files: [MAIN_FILE],
            ask: () => "Move the deadline under the title",
            check: (w) => deadlineOnTop(work(w, MAIN_FILE)),
            canon: (w) => {
              const ls = lines(work(w, MAIN_FILE));
              const i = ls.findIndex((l) => /^deadline/i.test(l));
              const [d] = ls.splice(i, 1);
              ls.splice(1, 0, d);
              setWork(w, MAIN_FILE, ls.join("\n"));
            },
          },
          done: (w) => deadlineOnTop(work(w, MAIN_FILE)),
        },
        {
          id: "push-fix",
          kind: "act",
          say: (w) => `Commit it, and put <b>${fixBr(w)}</b> on GitHub.`,
          acts: [
            commitAct("Move the deadline to the top"),
            { label: "Publish branch", steps: (w) => [`git push -u origin ${fixBr(w)}`], ai: "put my branch on GitHub" },
          ],
          done: (w) => synced(w, fixBr(w)) && you(w).branches[fixBr(w)] !== you(w).branches.main && subjectOk(G.subject(headMsg(w))),
          status: msgStatus,
          after: () => `GitHub has the branch. Next, the pull request.`,
        },
        {
          id: "pr-text",
          kind: "choose",
          ghTab: "pulls",
          say: () => `Toby will read the pull request's description before the change itself. Which one helps him most?`,
          choose: {
            options: [
              { html: "<i>No description</i>", right: false, why: "Toby has to open the change and guess why you moved the line, and whether you checked anything." },
              { html: "So on Monday Toby said two people had asked him about the deadline, and I thought about where people look first, and then I tried a few places and...", right: false, why: "It's all in there somewhere, but Toby has to dig for it. Short parts beat a story." },
              { html: "Readers missed the deadline at the bottom, so it now sits under the title. Checked the preview on GitHub. <code>Closes #3</code>", right: true, why: "What changed, why, how you checked it, and the issue it closes. Toby knows what he's looking at before he opens the diff." },
            ],
          },
          done: (w) => chose(w, "pr-text"),
          term: ["Closes #N", "Words in a pull request's description that link it to an issue. When the pull request is merged, GitHub closes the issue for you. <i>Fixes #N</i> works too."],
        },
        {
          id: "open-pr",
          kind: "act",
          ghTab: "pulls",
          say: () => `Open the pull request, and ask Toby to review it. The title reads like a commit subject. The description says what, why, how you checked, and which issue it closes.`,
          acts: [{
            label: "Create pull request",
            look: "github",
            inputs: [
              { key: "title", label: "Title", def: () => "Move the deadline to the top", max: 80 },
              { key: "body", label: "Description", def: (w) => `Readers missed the deadline at the bottom, so it now sits under the title. Checked the preview on GitHub. Closes #${deadlineIssue(w)}`, max: 240 },
            ],
            steps: (_w, v) => [`gh pr create --title "${q(v.title)}" --body "${q(v.body)}" --reviewer toby`],
            ai: "open a pull request for this branch that closes the deadline issue, and ask Toby to review it",
          }],
          done: (w) => (myPr(w)?.closes ?? []).includes(deadlineIssue(w)),
          status: (w) => {
            const p = myPr(w);
            return p && !(p.closes ?? []).includes(deadlineIssue(w))
              ? `Pull request #${p.n} is up, but its description doesn't say <code>Closes #${deadlineIssue(w)}</code>, so the issue would stay open. Press <b>Undo</b> and add it, or fix the description: <code>gh pr edit ${p.n} --body "... Closes #${deadlineIssue(w)}"</code>`
              : "";
          },
          after: (w) => `Pull request #${myPr(w)?.n} is up, linked to issue #${deadlineIssue(w)}, with Toby asked to review it: one task, one small change, and a description he can read in a few seconds.`,
          more: [
            ["How small is small?", "Small enough to review in one sitting. If the description needs an <i>and also</i>, it's probably two pull requests."],
            ["Not ready for review yet?", "<code>gh pr create --draft</code> opens it as a <b>draft</b>: people can see it, and it says it isn't ready. <code>gh pr ready</code> marks it ready later."],
          ],
        },
      ],
    },

    {
      title: "Keep secrets out",
      short: "secrets",
      goal: "keep keys and passwords out of git",
      beats: [
        {
          id: "env-file",
          kind: "act",
          say: () => `The survey tool gives you a key, a kind of password, so it can download the answers. You save it in a file called <b>.env</b> in the project folder, where the tool looks for it.`,
          acts: [{
            label: "Save the key in .env",
            ai: "",
            steps: () => [(w) => { setWork(w, ".env", KEY); return "(.env is saved in the folder)"; }],
          }],
          done: (w) => !!work(w, ".env"),
          after: () => `git sees a <b>new</b> file. One <code>git add -A</code> and the key goes to GitHub with your next push.`,
        },
        {
          id: "env-ok",
          kind: "choose",
          say: () => `The repository is private. Is it all right to commit the key?`,
          choose: {
            options: [
              { html: "Yes: only the team can see it", right: false, why: "Every clone, every new teammate and every tool with access gets a copy, and the history keeps it for good. Private repositories get made public one day, too." },
              { html: "No: keys stay out of git", right: true, why: "A key lives on each machine that needs it. git only needs to know to leave the file alone." },
            ],
          },
          done: (w) => chose(w, "env-ok"),
        },
        {
          id: "ignore",
          kind: "edit",
          say: () => `Tell git to leave it alone. Open <b>.gitignore</b>, the list of files git should ignore, and write <b>.env</b> on a line of its own.`,
          edit: {
            files: [".gitignore"],
            ask: () => "Write .env on a line of its own",
            check: (w) => G.isIgnored(desk(w).work, ".env"),
            canon: (w) => setWork(w, ".gitignore", ".env\n"),
          },
          done: (w) => G.isIgnored(desk(w).work, ".env"),
          after: () => `.env now says <b>ignored</b>. It's still in the folder for the survey tool, but <code>git status</code> won't list it and <code>git add</code> skips it. .gitignore itself is a <b>new</b> file.`,
          term: [".gitignore", "A file of names and patterns git should leave alone, one per line: <code>.env</code>, <code>*.log</code>, <code>build/</code>."],
          more: [["What else goes in it?", "Anything private, and anything a tool makes from your files: <code>build/</code>, <code>dist/</code>, <code>node_modules/</code>, logs, big exports. If a command can make it again, it doesn't belong in git, and huge files slow down every clone for everyone."]],
        },
        {
          id: "commit-ignore",
          kind: "act",
          say: () => `Commit .gitignore so everyone on the team gets it. It's tidying, not the deadline fix: switch to <b>${TIDY}</b> first, then stage all and commit.`,
          acts: [
            { label: `Switch to ${TIDY}`, steps: () => [`git switch ${TIDY}`], ai: `switch to my ${TIDY} branch` },
            commitAct("Keep .env out of git"),
          ],
          done: (w) => desk(w)?.branch === TIDY && !!headTree(w)[".gitignore"] && headTree(w)[".env"] === undefined && clean(w) && subjectOk(G.subject(headMsg(w))),
          status: (w) => {
            const b = desk(w)?.branch;
            if (b && b !== TIDY && mine(w) && touched(w, head(w)).includes(".gitignore"))
              return `That commit went onto <b>${esc(b)}</b>. Press <b>Undo</b>, and switch to ${TIDY} first.`;
            return b === TIDY ? msgStatus(w) : "";
          },
          after: () => `Stage all, and still no .env: git skips ignored files, even with <code>git add -A</code>. Only .gitignore went into the commit.`,
        },
        {
          id: "leaked",
          kind: "choose",
          say: () => `Now say the key had already gone to GitHub. What do you do first?`,
          choose: {
            options: [
              { html: "Delete .env and commit", right: false, why: "The old commit still has the key, and every clone has that commit. Deleting the file only hides it from the newest version." },
              { html: "Rewrite the history so the key is gone", right: false, why: "Worth doing later, with a tool like <code>git filter-repo</code>. But every clone made before still has the key, and it rewrites every commit after it, so everyone has to clone again." },
              { html: "Cancel the key on the survey site, then get a new one", right: true, why: "Once a key has been pushed, treat it as stolen. A cancelled key is useless to whoever has it. Then clean up." },
            ],
          },
          done: (w) => chose(w, "leaked"),
          term: ["revoke", "Cancel a key or password so it stops working. The first thing to do when one leaks."],
          more: [
            ["Does GitHub help?", "GitHub's <b>secret scanning</b> knows many kinds of keys and can block a push that contains one. Don't count on it: it doesn't know every kind."],
          ],
        },
      ],
    },

    {
      title: "Good issues and kind reviews",
      short: "issues, reviews",
      goal: "write issues and reviews people are glad to get",
      beats: [
        {
          id: "good-issue",
          kind: "choose",
          ghTab: "issues",
          say: () => `You click the survey link in the report on GitHub and get <i>Page not found</i>. Albert added that link. If you were him, which issue would you rather get?`,
          choose: {
            options: [
              { html: "<b>link broken</b><br>doesnt work pls fix", right: false, why: "Which link? Broken how? Albert has to come back and ask before he can start." },
              { html: "<b>Survey link shows Page not found</b><br>Clicked the survey link on GitHub. Expected the May survey, got Page not found.", right: true, why: "What you did, what you expected, what happened. Albert can see the problem for himself without asking a thing." },
            ],
          },
          done: (w) => chose(w, "good-issue"),
        },
        {
          id: "file-issue",
          kind: "act",
          ghTab: "issues",
          say: () => `File it. Give it a <b>label</b> for the kind of problem, <b>bug</b>, and one person to fix it: Albert.`,
          acts: [{
            label: "Submit new issue",
            look: "github",
            inputs: [
              { key: "title", label: "Title", def: () => "Survey link shows Page not found", max: 80 },
              { key: "body", label: "Description", def: () => "Clicked the survey link on GitHub. Expected the May survey, got Page not found.", max: 240 },
            ],
            steps: (_w, v) => [`gh issue create --title "${q(v.title)}" --body "${q(v.body)}" --label bug --assignee albert`],
            ai: "file an issue about the broken survey link, label it bug and assign it to Albert",
          }],
          done: (w) => { const i = myIssue(w); return !!i && i.labels.includes("bug") && i.assignees.includes("albert"); },
          status: (w) => {
            const i = myIssue(w);
            return i && !(i.labels.includes("bug") && i.assignees.includes("albert"))
              ? `Issue #${i.n} still needs the <b>bug</b> label and Albert: <code>gh issue edit ${i.n} --add-label bug --add-assignee albert</code>`
              : "";
          },
          after: (w) => `Issue #${myIssue(w)?.n} is on GitHub, labelled <b>bug</b>, with Albert as its one <b>assignee</b>. Put two names on it and each thinks the other has it.`,
          term: ["label", "A coloured tag on an issue or pull request saying what kind it is, like <b>bug</b> or <b>documentation</b>, so people can sort and filter."],
        },
        {
          id: "albert-pr",
          kind: "watch",
          ghTab: "pulls",
          say: () => `Albert picks it up: the newest main, a branch, the fix, and a pull request with a review request for you.`,
          acts: [{
            label: "Watch Albert fix it",
            who: "albert",
            steps: (w) => {
              const n = myIssue(w)?.n ?? 5;
              const b = `fix/${n}-survey-link`;
              return [
                "git pull",
                `git switch -c ${b}`,
                (x) => { const d = x.repos.albert.desks[0]; d.work[MAIN_FILE] = d.work[MAIN_FILE].replace(OLD_LINK, NEW_LINK); return "(Albert fixes the link in report.md)"; },
                `git commit -am "Fix the survey link" -m "It pointed at an old survey that was taken down."`,
                `git push -u origin ${b}`,
                `gh pr create --title "Fix the survey link" --body "The link pointed at an old survey. Clicked it on GitHub: the May survey opens now. Closes #${n}" --reviewer you`,
              ];
            },
          }],
          done: (w) => !!albertPr(w),
          after: (w) => `Pull request #${albertPr(w)?.n} waits for your review. Its description says what, why and how he checked, and <code>Closes #${myIssue(w)?.n}</code>.`,
        },
        {
          id: "kind-review",
          kind: "choose",
          ghTab: "pulls",
          say: () => `The link works now. You'd also name the survey in the link text, but that's taste. Which comment do you leave?`,
          choose: {
            options: [
              { html: "\"Wrong link text.\"", right: false, why: "Short, vague, and it reads like a telling-off. Albert can't tell what you want, or whether it matters." },
              { html: "\"Why didn't you click the link the first time?\"", right: false, why: "That's about Albert, not the change. Review the change, not the person." },
              { html: "\"Works now, thanks! Small idea: call it the May survey in the link text? Fine to merge either way.\"", right: true, why: "It says what's good, makes one clear suggestion, and says plainly it doesn't hold up the merge." },
            ],
          },
          done: (w) => chose(w, "kind-review"),
          term: ["code review", "Reading a teammate's change before it goes in: what's good, what's unclear, what must change. About the change, never the person."],
        },
        {
          id: "review-comment",
          kind: "act",
          ghTab: "pulls",
          say: (w) => `Leave it as a review comment on pull request #${albertPr(w)?.n}.`,
          acts: [{
            label: "Comment",
            look: "github",
            inputs: [{ key: "body", label: "Comment", def: () => "Works now, thanks! Small idea: call it the May survey in the link text?", max: 240 }],
            steps: (w, v) => [`gh pr review ${albertPr(w)?.n} --comment --body "${q(v.body)}"`],
            ai: "leave a friendly review comment on Albert's pull request",
          }],
          done: (w) => commentedOn(w),
          status: (w) => reviewedBy(w) && !commentedOn(w)
            ? `That review has no words in it. Leave the comment too: <code>gh pr review ${albertPr(w)?.n} --comment --body "..."</code>`
            : "",
          after: () => `Your comment is on the pull request, under Albert's change.`,
        },
        {
          id: "approve",
          kind: "act",
          ghTab: "pulls",
          say: () => `The fix is right, and your idea is a nice-to-have. Approve it. A review asks <i>is this good enough to go in?</i>, not <i>is this how I'd have written it?</i>`,
          acts: [{
            label: "Approve",
            look: "github",
            steps: (w) => [`gh pr review ${albertPr(w)?.n} --approve`],
            ai: "approve Albert's pull request",
          }],
          done: (w) => reviewedBy(w, "approved"),
          after: (w) => `Approved. Albert can merge it, and issue #${myIssue(w)?.n} closes itself when he does.`,
          more: [["Comment, approve or request changes?", "<b>Comment</b>: thoughts, no verdict. <b>Approve</b>: good to go in. <b>Request changes</b>: something must change before it merges, so say exactly what."]],
        },
      ],
    },

    {
      title: "You did it",
      short: "recap",
      goal: "",
      beats: [{
        id: "end",
        kind: "next",
        say: (w) => `The habits, as one list:<ul>
          <li>A commit subject says what the commit does, in about 50 characters: <i>Add the survey date</i>. A body says why.</li>
          <li>One change per commit.</li>
          <li>Pull, then one branch per task, named for it: <code>${esc(fixBr(w))}</code>.</li>
          <li>Small pull requests that say what, why, how you checked, and <code>Closes #${deadlineIssue(w)}</code>.</li>
          <li>Keys, passwords and files a tool can make again go in .gitignore, never in git. A leaked key gets revoked first.</li>
          <li>An issue says what you did, what you expected and what happened, with one assignee.</li>
          <li>A review is about the change, says what's good, and approves when it's good enough.</li>
        </ul>`,
        done: () => false,
      }],
    },
  ],
};

/* the deadline line is there once, and above the first paragraph */
function deadlineOnTop(text: string): boolean {
  const ls = lines(text);
  const d = ls.filter((l) => /^deadline/i.test(l.trim()));
  const at = ls.findIndex((l) => /^deadline/i.test(l.trim()));
  const body = ls.findIndex((l) => /We tested/.test(l));
  return d.length === 1 && at >= 0 && body >= 0 && at < body;
}
