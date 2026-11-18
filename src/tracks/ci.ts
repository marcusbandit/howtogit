/* tracks/ci.ts: CI, GitHub Actions and rules for main.
 *
 * Starts with the team report already on GitHub, Albert has a clone, and
 * report.md carries a misspelling ("recieved") that nobody noticed. A spell
 * check (codespell) is the robot that catches it: you add the workflow, see
 * it fail on the old typo, read the log and fix it. Albert's next pull
 * request goes red too, and you review the meaning while the check reviews
 * the spelling. When Albert skips the pull request altogether, a ruleset
 * makes main take changes only through a green, approved pull request.
 * Last, a second workflow publishes the report with GitHub Pages.
 *
 * The model runs workflows itself whenever commits reach GitHub, so every
 * run here is the result of a real push, pull request or merge.
 */
import * as G from "../model.js";
import type { World, PR, Run } from "../model.js";
import type { Track } from "../tracks.js";
import type { Act } from "../story.js";
import { MAIN_FILE, work, setWork, insertAfter, commitAct, pushAct, pullAct, desk, gh, albert, synced, changed, chose, q } from "../story.js";

const REPORT = "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\nNext step: try it with real users.\n\nDeadline: Friday\nThanks to everyone who helped.\n";
const CHECKS = ".github/workflows/checks.yml";
const PAGES = ".github/workflows/pages.yml";
const RULE_FILE = "protect-main.json";
const RULESETS = "repos/you/my-report/rulesets";

/* ------------------------------------------------------------- helpers */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* the newest pull request from a branch, or by someone */
const prFrom = (w: World, head: string): PR | undefined => [...w.prs].reverse().find((p) => p.head === head);
const prBy = (w: World, author: string): PR | undefined => [...w.prs].reverse().find((p) => p.author === author);
const spellPr = (w: World) => prFrom(w, "spell-check");
const albertPr = (w: World) => prBy(w, "Albert");
const fixPr = (w: World) => prFrom(w, "fix-typo");
const pagesPr = (w: World) => prFrom(w, "publish");
const n = (p: PR | undefined) => p?.n ?? 1;

const runsOf = (w: World, p: PR | undefined): Run[] => (p ? (w.runs ?? []).filter((r) => r.pr === p.n) : []);
const lastRun = (w: World, p: PR | undefined) => runsOf(w, p).at(-1);
const redRun = (w: World, p: PR | undefined) => runsOf(w, p).filter((r) => !r.ok).at(-1);
/* what codespell said, as "word ==> fix" */
const found = (r: Run | undefined) => r?.annotations?.find((a) => a.message.includes("==>"))?.message ?? "";
const mainText = (w: World) => G.treeOf(w, gh(w)?.branches.main)[MAIN_FILE] ?? "";
const reviewed = (p: PR | undefined, who: string, state: string) => !!p?.reviews?.some((r) => r.who === who && r.state === state);

/* writing a file is not a git command: it happens the same way in every mode,
 * the way a file you saved in your editor would */
const addFile = (path: string, text: string, label: string): Act => ({
  label,
  ai: "",
  steps: () => [(w) => { setWork(w, path, text); return `(you add ${path})`; }],
});

/* a file shown part by part, each part with what it means in plain words.
 * parts: [how many lines, the meaning], top to bottom */
function fileNotes(path: string, text: string, parts: [number, string][]): string {
  const lines = text.replace(/\n$/, "").split("\n");
  let i = 0;
  const rows = parts.map(([k, note]) => {
    const code = lines.slice(i, i + k).join("\n");
    i += k;
    return `<div class="filenote__row"><code class="filenote__code">${esc(code)}</code><span class="filenote__note">${note}</span></div>`;
  });
  if (i < lines.length) rows.push(`<div class="filenote__row"><code class="filenote__code">${esc(lines.slice(i).join("\n"))}</code></div>`);
  return `<div class="filenote"><p class="filenote__name">${esc(path)}</p>${rows.join("")}</div>`;
}

const newBranch = (name: string, ai: string): Act => ({ label: "New branch", steps: () => [`git checkout -b ${name}`], ai });
const publish = (name: string): Act => ({ label: "Publish branch", steps: () => [`git push -u origin ${name}`], ai: "put my branch on GitHub" });
const openPr = (title: string, head: string): Act => ({
  label: "Create pull request",
  look: "github",
  steps: () => [`gh pr create --title "${title}" --base main --head ${head}`],
  ai: "open a pull request for it",
});
const mergePr = (pr: (w: World) => PR | undefined, ai: string): Act => ({
  label: "Merge pull request", look: "github", steps: (w) => [`gh pr merge ${n(pr(w))} --merge`], ai,
});
const toMain: Act = { label: "Check out main", steps: () => ["git checkout main"], ai: "check out main" };

/* Albert's lines: a plan with a typo and a number that's too big, then the fix */
const PLAN = "Next month we will definately ask 1000 people.";
const PLAN_FIXED = "Next month we will definitely ask 100 people.";
const MEETING = "Team meeting tommorow at 10.";

/* ------------------------------------------------------------- the track */

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
          ghTab: "code",
          say: () => `report.md has had a spelling mistake in it for a while. You, Albert and Toby have all read the report since. Nobody noticed.<br><br>Who should catch mistakes like that, every time?`,
          choose: {
            options: [
              { html: "You, by reading every line before each push", right: false, why: "You'll miss one sooner or later. Everyone does, and it gets slower as the report grows." },
              { html: "Toby, when he reviews", right: false, why: "Reviewers read for meaning. Small slips get past them, as this one did." },
              { html: "A computer that checks every change on its own", right: true, why: "That's the idea behind <b>CI</b>. A computer never gets tired, and it checks every change the same way." },
            ],
          },
          done: (w) => chose(w, "who-checks"),
          term: ["CI", "Short for <b>continuous integration</b>: everyone's changes join main often, and a computer checks each one automatically, so a broken change is caught before it lands, not weeks later."],
          more: [
            ["Why that name?", "<i>Integration</i> is joining everyone's work into main. <i>Continuous</i> means doing it often, in small pieces, with a check each time, instead of one big merge at the end."],
            ["Is CI only for code?", "It started with code: there the computer builds the program and runs its tests. Here it checks the spelling of a report. The idea is the same."],
          ],
        },
        {
          id: "workflow",
          kind: "act",
          ghTab: "code",
          say: () => `The computer needs instructions: what to check, and when. On GitHub they go in a <b>workflow</b> file, in the folder <code>.github/workflows</code>.<br><br>This one runs a spell checker called codespell. Each part, in plain words:`
            + fileNotes(CHECKS, G.WORKFLOWS.spelling, [
              [1, "The name GitHub shows for it."],
              [4, "When it runs: on every pull request, and on every push to main."],
              [2, "The work, as jobs. One job here, called <b>spelling</b>."],
              [1, "Where: on a fresh Linux computer that GitHub lends you."],
              [2, "First step: copy the project onto that computer."],
              [1, "Then run codespell over every file."],
            ]),
          acts: [addFile(CHECKS, G.WORKFLOWS.spelling, "Add the workflow file")],
          done: (w) => !!work(w, CHECKS).trim(),
          after: () => `<b>checks.yml</b> is on your laptop, new. It does nothing there: GitHub only runs workflows it has received.`,
          term: ["workflow", "A file in <code>.github/workflows</code> that tells GitHub what to run and when. It's written in YAML: names, colons and indentation."],
          more: [
            ["Do I write these from memory?", "Nobody does. The Actions tab on GitHub offers ready-made workflows, and most people copy one and change a line or two."],
            ["What does uses: mean?", "It runs an <b>action</b>: a ready-made step someone published. <code>actions/checkout</code> is GitHub's own. The part after <code>@</code> picks its version."],
          ],
        },
        {
          id: "open-pr",
          kind: "act",
          ghTab: "actions",
          say: () => `The workflow is a change like any other, so it goes in through a pull request. Put it on a branch, commit, push, and open the pull request.`,
          acts: [
            newBranch("spell-check", "start a branch called spell-check"),
            commitAct("Add a spell check"),
            publish("spell-check"),
            openPr("Add a spell check", "spell-check"),
          ],
          done: (w) => !!spellPr(w) && !!G.treeOf(w, gh(w).branches["spell-check"])[CHECKS],
          after: () => `GitHub found the workflow in your pull request and started it at once: queued while it waits for a computer, then running. The part of GitHub that does this is <b>GitHub Actions</b>.`,
          term: ["GitHub Actions", "The part of GitHub that runs workflows. Each run gets a fresh computer for a few minutes, called a <b>runner</b>."],
        },
        {
          id: "red-why",
          kind: "choose",
          ghTab: "pulls",
          say: () => `The run failed, and the pull request shows it as a red <b>check</b>.<br><br>Your pull request only adds the workflow file. So why is it red?`,
          choose: {
            options: [
              { html: "The workflow file has a mistake in it", right: false, why: "A broken workflow wouldn't run at all. This one ran, and its spell check failed." },
              { html: "It found the old typo in report.md", right: true, why: "The check reads every file in the project, not only what you changed. The typo nobody noticed counts too." },
            ],
          },
          done: (w) => chose(w, "red-why"),
          term: ["check", "The result of one workflow job on a commit: a green tick when it passed, a red X when it failed. Pull requests list their checks."],
        },
      ],
    },

    {
      title: "Read the log, fix it",
      short: "log",
      goal: "read a failed check and turn it green",
      beats: [
        {
          id: "read-log",
          kind: "act",
          ghTab: "actions",
          say: () => `To find out what failed, read the run's <b>log</b>: everything the computer printed while it worked. The failed step is the part that matters.`,
          acts: [{
            label: "Show the failed step's log",
            look: "github",
            steps: (w) => { const r = redRun(w, spellPr(w)); return [r ? `gh run view ${r.id} --log-failed` : "gh run view --log-failed"]; },
            ai: "show me why the check failed",
          }],
          done: (w) => !!redRun(w, spellPr(w)) && w.vars.sawRunLog === String(redRun(w, spellPr(w))!.id),
          after: (w) => `There it is: <code>${esc(found(redRun(w, spellPr(w))) || "recieved ==> received")}</code>, in report.md. The word, and what it should be.`,
          term: ["runner", "The computer a workflow runs on. GitHub lends a fresh one for each run and wipes it afterwards. What it prints is the run's log."],
          more: [
            ["Where is this on github.com?", "Open the pull request and click the red check. Or go to the Actions tab, open the run, then the job."],
            ["What's exit code 65?", "Every program ends with a number. 0 means it went fine; anything else means it failed. codespell ends with 65 when it finds a typo, and that turns the check red."],
          ],
        },
        {
          id: "fix",
          kind: "edit",
          ghTab: "pulls",
          say: () => `Fix it in <b>report.md</b>: <b>recieved</b> should be <b>received</b>. You're still on the spell-check branch, so the fix joins the same pull request.`,
          edit: {
            files: [MAIN_FILE],
            ask: () => "Fix the typo",
            check: (w) => changed(w) && !/recieved/i.test(work(w, MAIN_FILE)),
            canon: (w) => setWork(w, MAIN_FILE, work(w, MAIN_FILE).replace(/recieved/g, "received")),
          },
          done: (w) => changed(w) && !/recieved/i.test(work(w, MAIN_FILE)),
        },
        {
          id: "push-fix",
          kind: "act",
          ghTab: "pulls",
          say: () => `Commit it and push. The pull request picks up the new commit, and the check runs again.`,
          acts: [commitAct("Fix a typo"), pushAct],
          done: (w) => synced(w, "spell-check") && !!lastRun(w, spellPr(w))?.ok,
          after: () => `Green this time. The same check on the new commit, and it passes because the typo is gone.`,
        },
        {
          id: "merge-checks",
          kind: "act",
          ghTab: "code",
          say: () => `Green, so merge it.`,
          acts: [mergePr(spellPr, "merge the pull request")],
          done: (w) => spellPr(w)?.state === "merged",
          after: () => `The workflow is on main, so every pull request from now on gets checked. A merge is also a push to main, and the check ran there too: see the green tick next to main's newest commit.`,
        },
      ],
    },

    {
      title: "Red means stop",
      short: "red",
      goal: "let the check catch slips while people judge the idea",
      beats: [
        {
          id: "albert-pr",
          kind: "watch",
          ghTab: "pulls",
          say: () => `Albert has a plan for next month. He writes it on a branch and opens a pull request.`,
          acts: [{
            label: "Watch Albert do it",
            who: "albert",
            steps: () => [
              "git pull",
              "git checkout -b next-month",
              (w) => { const d = albert(w).desks[0]; d.work[MAIN_FILE] = insertAfter(d.work[MAIN_FILE], /^Next step/, PLAN); return "(Albert edits report.md)"; },
              `git commit -am "Plan next month"`,
              "git push -u origin next-month",
              `gh pr create --title "Plan next month" --base main --head next-month`,
            ],
          }],
          done: (w) => !!albertPr(w),
          after: () => `His check went red before anyone opened the file.`,
        },
        {
          id: "checks",
          kind: "act",
          ghTab: "pulls",
          say: (w) => `Every pull request lists its checks. Look at the ones on Albert's, #${n(albertPr(w))}.`,
          acts: [{
            label: "Show the checks",
            look: "github",
            steps: (w) => [`gh pr checks ${n(albertPr(w))}`],
            ai: "show me the checks on Albert's pull request",
          }],
          done: (w) => !!lastRun(w, albertPr(w)) && (w.vars.sawChecks ?? "").split(" ").includes(String(lastRun(w, albertPr(w))!.id)),
          after: (w) => `One check, <b>spelling</b>, failing. Its log says <code>${esc(found(lastRun(w, albertPr(w))) || "definately ==> definitely")}</code>. gh itself ends with an error when a check is red, so a script that runs it stops there too.`,
          more: [["How do I read the log from here?", "<code>gh run view</code> with the run's number and <code>--log-failed</code>, as before. The number is in the link that <code>gh pr checks</code> prints."]],
        },
        {
          id: "review",
          kind: "act",
          ghTab: "pulls",
          say: () => `Red means stop: this doesn't go into main yet. Ask Albert for changes.<br><br>The check found the typo. Your part is what a computer can't judge: does the plan make sense? <b>1000 people</b> in one month is a lot.`,
          acts: [{
            label: "Request changes",
            look: "github",
            inputs: [{ key: "body", label: "Your review", def: () => "Typo: definately. And 1000 in a month is a lot. Maybe 100?" }],
            steps: (w, v) => [`gh pr review ${n(albertPr(w))} --request-changes --body "${q(v.body)}"`],
            ai: "ask Albert to fix the typo and rethink the number",
          }],
          done: (w) => reviewed(albertPr(w), "you", "changes_requested"),
          after: () => `Albert sees your review on his pull request. The check caught the spelling; you caught the number. That's the split: a computer checks what has one right answer, people review the meaning.`,
        },
        {
          id: "albert-fix",
          kind: "watch",
          ghTab: "pulls",
          say: () => `Albert fixes both and pushes to his branch.`,
          acts: [{
            label: "Watch Albert fix it",
            who: "albert",
            steps: () => [
              (w) => { const d = albert(w).desks[0]; d.work[MAIN_FILE] = d.work[MAIN_FILE].replace(PLAN, PLAN_FIXED); return "(Albert edits report.md)"; },
              `git commit -am "Fix the typo, ask 100 people"`,
              "git push",
            ],
          }],
          done: (w) => runsOf(w, albertPr(w)).length > 1 && !!lastRun(w, albertPr(w))?.ok,
          after: () => `The pull request picked up his commit, and the check ran again: green.`,
        },
        {
          id: "approve",
          kind: "act",
          ghTab: "pulls",
          say: () => `Green, and the plan makes sense now. Approve it.`,
          acts: [{ label: "Approve", look: "github", steps: (w) => [`gh pr review ${n(albertPr(w))} --approve`], ai: "approve Albert's pull request" }],
          done: (w) => reviewed(albertPr(w), "you", "approved"),
          after: () => `Approved. Your review says yes to the meaning, the check says yes to the spelling.`,
        },
        {
          id: "merge-albert",
          kind: "act",
          ghTab: "pulls",
          say: () => `Merge it.`,
          acts: [mergePr(albertPr, "merge Albert's pull request")],
          done: (w) => albertPr(w)?.state === "merged",
          after: () => `Merged, with a green check and your approval. Red would have meant: not yet.`,
        },
      ],
    },

    {
      title: "Rules for main",
      short: "rules",
      goal: "make GitHub refuse changes that skip the check",
      beats: [
        {
          id: "albert-direct",
          kind: "watch",
          ghTab: "code",
          say: () => `Albert is in a hurry. He adds a line on main and pushes straight to it. No branch, no pull request.`,
          acts: [{
            label: "Watch Albert do it",
            who: "albert",
            steps: () => [
              "git checkout main",
              "git pull",
              (w) => { const d = albert(w).desks[0]; d.work[MAIN_FILE] = insertAfter(d.work[MAIN_FILE], /^Deadline/, MEETING); return "(Albert edits report.md)"; },
              `git commit -am "Add the meeting time"`,
              "git push",
            ],
          }],
          done: (w) => mainText(w).includes(MEETING),
          after: () => `Nothing stopped him. The check did run, on main, after the push: see the red X next to main's newest commit. Too late, though: the typo is on main for everyone.`,
        },
        {
          id: "rule-why",
          kind: "choose",
          ghTab: "settings",
          say: () => `The check only helps if nobody can skip it. What would have stopped Albert?`,
          choose: {
            options: [
              { html: "Asking everyone to always open a pull request", right: false, why: "People forget, or they're in a hurry, like Albert just now." },
              { html: "A rule on GitHub that refuses pushes to main", right: true, why: "GitHub applies it to everyone, every time. A set of rules like that is a <b>ruleset</b>." },
            ],
          },
          done: (w) => chose(w, "rule-why"),
          term: ["ruleset", "Rules GitHub enforces on a branch: for example, changes only through a pull request, with an approval and green checks. The older name is <b>branch protection</b>."],
          more: [["Can't we just trust each other?", "You can, and still use rules. They aren't about trust: they catch the day someone is in a hurry, you included."]],
        },
        {
          id: "rule-file",
          kind: "act",
          ghTab: "settings",
          say: () => `Here's the rule for main, in plain words:<ul><li>changes come in through a pull request</li><li>with at least 1 approval</li><li>and a green <b>spelling</b> check</li><li>no force pushes, which overwrite main's history</li></ul>GitHub takes rules as a JSON file. Write it down.`,
          acts: [addFile(RULE_FILE, G.rulesetJson({ checks: ["spelling"] }), `Write ${RULE_FILE}`)],
          done: (w) => !!work(w, RULE_FILE).trim(),
          after: () => `<b>${RULE_FILE}</b> is on your laptop. Open it to see the same four rules as JSON. It isn't part of the report, so you won't commit it.`,
          more: [["What's a force push?", "<code>git push --force</code> replaces what's on GitHub with your version, even if that throws away commits others pushed. On main, that's how work gets lost."]],
        },
        {
          id: "add-rule",
          kind: "act",
          ghTab: "settings",
          say: () => `Send the rule to GitHub. On github.com that's <b>Settings, Rules, New ruleset</b>. gh has no command for creating one, so from the terminal you call GitHub's API with <code>gh api</code>.`,
          acts: [{
            label: "Create ruleset",
            look: "github",
            steps: () => [`gh api --method POST ${RULESETS} --input ${RULE_FILE}`],
            ai: `add a ruleset for main from ${RULE_FILE}`,
          }],
          done: (w) => (w.rules?.length ?? 0) > 0,
          after: () => `The Settings tab lists the rule. From now on GitHub checks every change to main against it, and <b>spelling</b> is a <b>required check</b>.`,
          term: ["required check", "A check a ruleset insists on: GitHub lets no change into the branch until that check is green."],
          more: [
            ["What's gh api?", "A way to call any part of GitHub's API from the terminal, for the things gh has no command of its own for."],
            ["Does this cost money?", "Rules are free on public repositories. Private ones need a paid plan for them."],
          ],
        },
        {
          id: "pull-main",
          kind: "act",
          ghTab: "code",
          say: () => `Albert's typo is still on main. Check out main and pull, so you can fix it.`,
          acts: [toMain, pullAct],
          done: (w) => desk(w)?.branch === "main" && synced(w, "main"),
          after: () => `report.md has Albert's line now: <code>${MEETING}</code>`,
        },
        {
          id: "fix-direct",
          kind: "edit",
          ghTab: "code",
          say: () => `Fix it: <b>tommorow</b> should be <b>tomorrow</b>.`,
          edit: {
            files: [MAIN_FILE],
            ask: () => "Fix the typo",
            check: (w) => changed(w) && !/tommorow/i.test(work(w, MAIN_FILE)),
            canon: (w) => setWork(w, MAIN_FILE, work(w, MAIN_FILE).replace(/tommorow/g, "tomorrow")),
          },
          done: (w) => changed(w) && !/tommorow/i.test(work(w, MAIN_FILE)),
        },
        {
          id: "push-direct",
          kind: "act",
          ghTab: "settings",
          say: () => `Commit it on main and push straight to main, the way Albert did.`,
          acts: [commitAct("Fix a typo", MAIN_FILE), pushAct],
          done: (w) => w.vars.ruleRejected === "1",
          after: () => `Refused. <code>GH013</code> means a rule said no: changes to main must come through a pull request, and the spelling check hasn't run on this commit. Your commit is safe on your laptop; only the push was turned away.`,
          more: [["Even for me? I own the repository.", "Even for you. This ruleset lets nobody skip it. You can name people who may, but then it only holds when they choose to follow it."]],
        },
      ],
    },

    {
      title: "Through a pull request",
      short: "approve",
      goal: "get a change into a protected main",
      beats: [
        {
          id: "fix-pr",
          kind: "act",
          ghTab: "pulls",
          say: () => `Your fix is stuck on your laptop's main. Put it on a branch of its own and open a pull request: that's the only way in now.`,
          acts: [newBranch("fix-typo", "start a branch called fix-typo from here"), publish("fix-typo"), openPr("Fix a typo", "fix-typo")],
          done: (w) => fixPr(w)?.state === "open",
          after: () => `The check runs on the pull request: green, the typo is gone.`,
        },
        {
          id: "try-merge",
          kind: "act",
          ghTab: "pulls",
          say: () => `Green. Try to merge it.`,
          acts: [mergePr(fixPr, "merge my pull request")],
          done: (w) => !!fixPr(w) && w.vars.mergeBlocked === String(fixPr(w)!.n),
          after: () => `Blocked. The pull request says why: it needs an approving review. You can't approve your own pull request, so someone else has to look at it.`,
          more: [["What about --admin?", "Admins can merge past some rules. Your ruleset lets nobody skip it, so GitHub refuses that too."]],
        },
        {
          id: "toby-approve",
          kind: "watch",
          ghTab: "pulls",
          say: () => `Toby reviews it.`,
          acts: [{ label: "Watch Toby review it", who: "toby", steps: (w) => [`gh pr review ${n(fixPr(w))} --approve --body "Good catch, thanks."`] }],
          done: (w) => reviewed(fixPr(w), "toby", "approved"),
          after: () => `Approved, and green: the pull request is ready to merge.`,
        },
        {
          id: "merge-fix",
          kind: "act",
          ghTab: "pulls",
          say: () => `Merge it.`,
          acts: [mergePr(fixPr, "merge my pull request")],
          done: (w) => fixPr(w)?.state === "merged",
          after: () => `In. Every change to main now takes the same road: a pull request, a green check, an approval.`,
        },
        {
          id: "sync-fix",
          kind: "act",
          ghTab: "code",
          say: () => `Check out main and pull, so your laptop has what GitHub has.`,
          acts: [toMain, pullAct],
          done: (w) => fixPr(w)?.state === "merged" && desk(w)?.branch === "main" && synced(w, "main"),
          after: () => `Your laptop's main matches GitHub's again.`,
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
          say: () => `Workflows can do more than check. What could one do every time a change lands on main?`,
          choose: {
            options: [
              { html: "Put the report online as a web page", right: true, why: "That's a <b>deploy</b>: putting the new version where people use it. The workflow does it the same way every time." },
              { html: "Write the report for you", right: false, why: "A workflow only runs the steps you wrote down. The writing is still yours." },
            ],
          },
          done: (w) => chose(w, "deploy-why"),
          term: ["deploy", "Putting a new version where people use it: a website, an app, a server. A workflow can deploy after every merge to main."],
        },
        {
          id: "pages-file",
          kind: "act",
          ghTab: "code",
          say: () => `GitHub can host a small website for a repository, called <b>GitHub Pages</b>. This workflow publishes the project there after every push to main:`
            + fileNotes(PAGES, G.WORKFLOWS.pages, [
              [1, "The name."],
              [3, "When: every push to main. Merging a pull request is one."],
              [4, "What the run may do: read the files and publish them."],
              [6, "One job, <b>deploy</b>, on a fresh Linux computer. It publishes to <b>github-pages</b>, where GitHub serves websites from."],
              [5, "Copy the project, then pack its files up as the website."],
              [2, "Put it online."],
            ]),
          acts: [addFile(PAGES, G.WORKFLOWS.pages, "Add the workflow file")],
          done: (w) => !!work(w, PAGES).trim(),
          after: () => `<b>pages.yml</b> is on your laptop. main takes changes only through a pull request now, so this goes the same way.`,
          more: [["Do I need to switch Pages on?", "On a real repository, once: <b>Settings, Pages</b>, and under Source pick <b>GitHub Actions</b>."]],
        },
        {
          id: "pages-pr",
          kind: "act",
          ghTab: "pulls",
          say: () => `Branch, commit, push, pull request. The rules apply to workflows too.`,
          acts: [
            newBranch("publish", "start a branch called publish"),
            commitAct("Publish the report", ".github"),
            publish("publish"),
            openPr("Publish the report", "publish"),
          ],
          done: (w) => pagesPr(w)?.state === "open" && !!G.treeOf(w, gh(w).branches.publish)[PAGES],
          after: () => `The spelling check ran and passed. Publish didn't run: it only runs on pushes to main.`,
        },
        {
          id: "toby-approve-pages",
          kind: "watch",
          ghTab: "pulls",
          say: () => `Toby takes a look.`,
          acts: [{ label: "Watch Toby review it", who: "toby", steps: (w) => [`gh pr review ${n(pagesPr(w))} --approve --body "Nice, a link I can send people."`] }],
          done: (w) => reviewed(pagesPr(w), "toby", "approved"),
          after: () => `Approved, and the check is green.`,
        },
        {
          id: "merge-pages",
          kind: "act",
          ghTab: "actions",
          say: () => `Merge it. A merge is a push to main, so keep an eye on the Actions tab.`,
          acts: [mergePr(pagesPr, "merge the pull request")],
          done: (w) => pagesPr(w)?.state === "merged" && !!w.pages,
          after: () => `Two runs started: the spell check, and <b>Publish</b>, which put the report online.`,
          more: [
            ["What else do teams automate?", "Runs on a timer (<code>on: schedule</code>), labels on new pull requests, a release with files attached each time a version is tagged. Anything you'd otherwise do by hand the same way every time."],
            ["Is it free?", "On public repositories, yes. Private ones get a monthly allowance of minutes, and runs past it cost money."],
          ],
        },
        {
          id: "live",
          kind: "next",
          ghTab: "code",
          say: (w) => `Open the Code tab: the report is live at <b>${esc((w.pages?.url ?? G.PAGES_URL).replace(/^https?:\/\//, "").replace(/\/$/, ""))}</b>. Every merge to main updates it, and nobody has to remember to.`,
          done: () => true,
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
        ghTab: "code",
        say: () => `That's CI. One picture:<br><b>push</b> → <b>the check runs</b> → <b>a person reviews</b> → <b>the rules guard main</b> → <b>merge</b> → <b>deploy</b><br><br>The computer checks what has one right answer, people review the meaning, and the rules make sure nobody skips either.`,
        done: () => false,
      }],
    },
  ],
};
