// Drives the model and the git/gh command line through every GitHub feature
// the tracks use and checks the results and the key lines of output.
// Run after tsc: node scripts/check-model.mjs
import * as G from "../public/model.js";
import { run } from "../public/cli.js";

let fails = 0, passes = 0;
const fail = (msg) => { fails++; console.log(`FAIL  ${msg}`); };
const ok = (cond, msg) => { if (cond) passes++; else fail(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n      got  ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`);

const CTX = {
  you: { repo: "you", desk: 0, author: "You" },
  albert: { repo: "albert", desk: 0, author: "Albert" },
  toby: { repo: "toby", desk: 0, author: "Toby" },
};
/* run a command and check it succeeded (or failed) and printed each needle */
function sh(w, who, cmd, { fails: bad = false, has = [], not = [] } = {}) {
  const r = run(w, CTX[who], cmd);
  ok(r.ok === !bad, `${who}$ ${cmd}\n      expected ${bad ? "failure" : "success"}, got:\n${indent(r.out)}`);
  for (const n of has) ok(r.out.includes(n), `${who}$ ${cmd}\n      missing: ${JSON.stringify(n)}\n${indent(r.out)}`);
  for (const n of not) ok(!r.out.includes(n), `${who}$ ${cmd}\n      should not print: ${JSON.stringify(n)}\n${indent(r.out)}`);
  return r.out;
}
const indent = (s) => s.split("\n").map((l) => `      | ${l}`).join("\n");
const you = (w) => w.repos.you.desks[0];
const albert = (w) => w.repos.albert.desks[0];
const gh = (w) => w.repos.github;
const edit = (desk, file, f) => { desk.work[file] = f(desk.work[file] ?? ""); };

/* the GitHub tracks' starting point: the report on GitHub, Albert has a clone */
function team() {
  const w = G.freshWorld();
  sh(w, "you", "git init");
  sh(w, "you", "git add .");
  sh(w, "you", 'git commit -m "First version of the report"');
  sh(w, "you", `git remote add origin ${G.REPO_URL}`);
  sh(w, "you", "git push -u origin main");
  G.ghInit(w);
  sh(w, "albert", `git clone ${G.REPO_URL}`);
  return w;
}

/* ------------------------------------------------ numbering, git track */
{
  const w = G.freshWorld();
  sh(w, "you", "git init");
  sh(w, "you", "git add .");
  sh(w, "you", 'git commit -m "First"');
  sh(w, "you", `git remote add origin ${G.REPO_URL}`);
  sh(w, "you", "git push -u origin main");
  sh(w, "you", "git switch -c summary");
  edit(you(w), "report.md", (s) => s + "Summary.\n");
  sh(w, "you", 'git commit -am "Add a summary"');
  sh(w, "you", "git push -u origin summary");
  sh(w, "you", 'gh pr create --title "Add a summary" --base main --head summary', { has: ["https://github.com/you/my-report/pull/1"] });
  ok(w.labels === undefined && w.issues === undefined && w.runs === undefined, "git track world gets no GitHub extras");
  w.prs[0].approved = true;
  sh(w, "you", "gh pr merge 1 --merge", { has: ["✓ Merged pull request you/my-report#1 (Add a summary)"] });
  eq(w.commits[gh(w).branches.main].parents.length, 2, "merge commit has two parents");
}

/* ------------------------------------------------------------ setup */
const w = team();
eq(w.labels.map((l) => l.name), ["bug", "documentation", "duplicate", "enhancement", "good first issue", "help wanted", "invalid", "question", "wontfix"], "nine default labels");
eq(w.labels[0], { name: "bug", color: "#d73a4a", desc: "Something isn't working" }, "bug label");
eq([w.issues, w.runs, w.rules], [[], [], []], "empty issues, runs, rules");
eq([G.loginOf("Albert"), G.loginOf("@toby"), G.nameOf("toby"), G.nameOf("You")], ["albert", "toby", "Toby", "You"], "loginOf and nameOf");

/* ------------------------------------------------------------ issues */
sh(w, "you", 'gh issue create --title "Typo" --label nope', { fails: true, has: ["could not add label: 'nope' not found"] });
sh(w, "you", 'gh issue create --title "Typo" --assignee bob', { fails: true, has: ["could not assign user: 'bob' not found"] });
eq(w.issues.length, 0, "a failed create makes no issue");
sh(w, "you", 'gh issue create --title "Fix the typo" --body "helpd should be helped" --label bug --assignee @me',
  { has: ["Creating issue in you/my-report", "https://github.com/you/my-report/issues/1"] });
eq([w.issues[0].author, w.issues[0].labels, w.issues[0].assignees], ["You", ["bug"], ["you"]], "issue 1 fields");
sh(w, "toby", 'gh issue create -t "Add a chart" -b "A chart of the three ideas" -l enhancement -a albert', { has: ["/issues/2"] });
eq([w.issues[1].author, w.issues[1].assignees], ["Toby", ["albert"]], "Toby, with no computer, files an issue");
sh(w, "you", "gh issue list", { has: ["Showing 2 of 2 open issues in you/my-report", "ID  TITLE         LABELS       UPDATED", "#2  Add a chart   enhancement  about 1 minute ago", "#1  Fix the typo  bug"] });
sh(w, "you", "gh issue list --label bug", { has: ["Showing 1 of 1 issue in you/my-report that matches your search", "#1"], not: ["#2"] });
sh(w, "you", "gh issue list --assignee albert", { has: ["#2"], not: ["#1 "] });
sh(w, "you", "gh issue list --assignee @me", { has: ["#1"], not: ["#2"] });
sh(w, "you", 'gh issue edit 1 --add-label documentation --add-assignee albert --remove-assignee you --title "Fix the typo in the report"', { has: ["https://github.com/you/my-report/issues/1"] });
eq([w.issues[0].title, w.issues[0].labels, w.issues[0].assignees], ["Fix the typo in the report", ["bug", "documentation"], ["albert"]], "issue edit");
sh(w, "you", "gh issue edit 1 --remove-label bug");
eq(w.issues[0].labels, ["documentation"], "remove label");
sh(w, "you", "gh issue edit 1 --add-label bug");
sh(w, "albert", 'gh issue comment 1 --body "On it"', { has: ["https://github.com/you/my-report/issues/1#issuecomment-"] });
eq(w.issues[0].comments.map((c) => [c.who, c.text]), [["Albert", "On it"]], "comment by display name");
sh(w, "you", "gh issue view 1", {
  has: ["Fix the typo in the report you/my-report#1", "Open • you opened about 1 minute ago • 1 comment", "Assignees: albert",
    "Labels: documentation, bug", "  helpd should be helped", "albert (Collaborator) • 1m • Newest comment", "  On it",
    "View this issue on GitHub: https://github.com/you/my-report/issues/1"],
});
sh(w, "you", 'gh issue comment 1 --body "Thanks"');
sh(w, "you", "gh issue view 1", { has: ["-------- Not showing 1 comment --------", "you (Owner) • 1m • Newest comment", "Use --comments to view the full conversation"] });
sh(w, "you", "gh issue view 1 --comments", { has: ["albert (Collaborator) • 1m", "you (Owner) • 1m • Newest comment"], not: ["Not showing"] });
sh(w, "you", 'gh issue close 2 --reason "not planned" --comment "Not this month"', { has: ["✓ Closed issue you/my-report#2 (Add a chart)"] });
eq([w.issues[1].state, w.issues[1].reason, w.issues[1].comments.length], ["closed", "not_planned", 1], "closed as not planned with a comment");
sh(w, "you", "gh issue close 2", { has: ["! Issue you/my-report#2 (Add a chart) is already closed"] });
sh(w, "you", "gh issue close 1 --reason later", { fails: true, has: ['invalid argument "later" for "-r, --reason" flag: valid values are {completed|not planned|duplicate}'] });
sh(w, "you", "gh issue list --state closed", { has: ["Showing 1 of 1 issue in you/my-report that matches your search", "#2"] });
sh(w, "you", "gh issue reopen 2", { has: ["✓ Reopened issue you/my-report#2 (Add a chart)"] });
eq([w.issues[1].state, w.issues[1].reason], ["open", undefined], "reopened");
sh(w, "you", "gh issue reopen 2", { has: ["! Issue you/my-report#2 (Add a chart) is already open"] });
sh(w, "you", 'gh issue close 2 -r "not planned"');
sh(w, "you", "gh issue view 99", { fails: true, has: ["GraphQL: Could not resolve to an issue or pull request with the number of 99. (repository.issue)"] });
sh(w, "you", "gh issue view abc", { fails: true, has: ['invalid issue format: "abc"'] });
sh(w, "you", "gh issue create --title x --wobble", { fails: true, has: ["unknown flag: --wobble"] });
sh(w, "you", "gh label list", { has: ["Showing 9 of 9 labels in you/my-report", "NAME              DESCRIPTION", "good first issue  Good for newcomers", "#7057ff"] });
sh(w, "you", 'gh label create urgent --color B60205 --description "Do this first"', { has: ['✓ Label "urgent" created in you/my-report'] });
eq(w.labels.at(-1), { name: "urgent", color: "#b60205", desc: "Do this first" }, "new label");
sh(w, "you", "gh label create Urgent", { fails: true, has: ['label with name "Urgent" already exists; use `--force` to update its color and description'] });
sh(w, "you", "gh label create later");
ok(/^#[0-9a-f]{6}$/.test(w.labels.at(-1).color), "a label without --color gets one of gh's colors");

/* ------------------------------------------------------- pull requests */
sh(w, "you", "git switch -c fix-typo");
edit(you(w), "report.md", (s) => s.replace("helpd", "helped"));
sh(w, "you", 'git commit -am "Fix typo in the thanks line"');
sh(w, "you", 'gh pr create --title "Fix the typo"', { fails: true, has: ["aborted: you must first push the branch 'fix-typo' to GitHub"] });
sh(w, "you", "git push -u origin fix-typo");
sh(w, "you", 'gh pr create --title "Fix the typo" --reviewer @me', { fails: true, has: ["could not request reviewer: GraphQL: Review cannot be requested from pull request author. (requestReviews)"] });
sh(w, "you", 'gh pr create --title "Fix the typo" --reviewer carol', { fails: true, has: ["could not request reviewer: 'carol' not found"] });
eq(w.prs.length, 0, "failed creates make no pull request");
sh(w, "you", 'gh pr create --title "Fix the typo" --body "Fixes #1. Also CLOSES #2 and resolves #77." --draft --reviewer toby --label bug --assignee @me',
  { has: ["Creating draft pull request for fix-typo into main in you/my-report", "https://github.com/you/my-report/pull/3"] });
const pr3 = w.prs[0];
eq([pr3.n, pr3.draft, pr3.reviewers, pr3.labels, pr3.assignees, pr3.closes], [3, true, ["toby"], ["bug"], ["you"], [1, 2]], "PR 3 fields (shares numbers with issues)");
sh(w, "you", 'gh pr create --title "Again"', { fails: true, has: ['a pull request for branch "fix-typo" into branch "main" already exists:\nhttps://github.com/you/my-report/pull/3'] });
sh(w, "you", "gh pr view", { has: ["Fix the typo you/my-report#3", "Draft • you wants to merge 1 commit into main from fix-typo • about 1 minute ago", "+1 -1 • No checks", "Reviewers: toby (Requested)", "Assignees: you", "Labels: bug", "  Fixes #1."] });
sh(w, "you", "gh pr merge 3 --squash", { fails: true, has: ["GraphQL: Pull Request is still a draft (mergePullRequest)"] });
sh(w, "you", "gh pr ready 3", { has: ['✓ Pull request you/my-report#3 is marked as "ready for review"'] });
sh(w, "you", "gh pr ready 3", { has: ['! Pull request you/my-report#3 is already "ready for review"'] });
sh(w, "you", "gh pr ready 3 --undo", { has: ['✓ Pull request you/my-report#3 is converted to "draft"'] });
sh(w, "you", "gh pr ready fix-typo");
sh(w, "you", 'gh pr edit 3 --add-reviewer albert --add-label documentation --title "Fix the typo in the report"', { has: ["https://github.com/you/my-report/pull/3"] });
eq([pr3.title, pr3.reviewers, pr3.labels], ["Fix the typo in the report", ["toby", "albert"], ["bug", "documentation"]], "pr edit");
sh(w, "you", "gh pr edit 3 --add-reviewer you", { fails: true, has: ["Review cannot be requested from pull request author"] });
sh(w, "you", "gh pr list", { has: ["Showing 1 of 1 open pull request in you/my-report", "ID  TITLE                       BRANCH    CREATED AT", "#3  Fix the typo in the report  fix-typo  about 1 minute ago"] });
sh(w, "toby", "gh pr list --state merged", { has: ["no pull requests match your search in you/my-report"] });
sh(w, "you", "gh pr review 3 --approve", { fails: true, has: ["failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)"] });
sh(w, "you", 'gh pr review 3 --request-changes -b "hm"', { fails: true, has: ["failed to create review: GraphQL: Can not request changes on your own pull request (addPullRequestReview)"] });
sh(w, "toby", "gh pr review 3 --comment", { fails: true, has: ["body cannot be blank for comment review"] });
sh(w, "toby", "gh pr review 3 --request-changes", { fails: true, has: ["body cannot be blank for request-changes review"] });
sh(w, "toby", "gh pr review 3 --approve --comment -b x", { fails: true, has: ["need exactly one of --approve, --request-changes, or --comment"] });
sh(w, "toby", "gh pr review 3", { fails: true, has: ["--approve, --request-changes, or --comment required when not running interactively"] });
sh(w, "you", 'gh pr review 3 --comment -b "Ready when you are"', { has: ["- Reviewed pull request you/my-report#3"] });
sh(w, "toby", 'gh pr review 3 --request-changes -b "Please say who to ask"', { has: ["+ Requested changes to pull request you/my-report#3"] });
eq([pr3.reviewers, pr3.approved, pr3.reviews.at(-1).who, pr3.reviews.at(-1).commit], [["albert"], false, "toby", gh(w).branches["fix-typo"]], "a review takes the reviewer off the waiting list");
// line notes: the story passes them in; line is 1-based in the file at review.commit
sh(w, "you", "gh pr checks 3", { fails: true, has: ["no checks reported on the 'fix-typo' branch"] });
eq(G.prReview(w, 3, "albert", "commented", "Two small notes", [{ who: "albert", text: "Say which month", file: "report.md", line: 3 }]),
  "- Reviewed pull request you/my-report#3", "prReview with a line note");
eq(pr3.reviews.at(-1).notes, [{ who: "Albert", text: "Say which month", file: "report.md", line: 3, at: pr3.reviews.at(-1).at }], "line note stored with a display name");
eq(pr3.reviewers, [], "albert's comment review answers his request too");
sh(w, "toby", 'gh pr review 3 --approve -b "Looks good"', { has: ["✓ Approved pull request you/my-report#3"] });
eq([pr3.approved, G.reviewState(pr3)], [true, { approvals: ["toby"], changes: [] }], "approved once the latest review approves");
sh(w, "albert", 'gh pr review 3 --request-changes -b "Wait, one more thing"');
eq(pr3.approved, false, "a later request for changes takes approval away");
sh(w, "albert", "gh pr review 3 --approve");
eq(pr3.approved, true, "approved again");
sh(w, "you", "gh pr view 3", { has: ["Open • you wants to merge", "Reviewers: albert (Approved), toby (Approved)", "albert approved (Collaborator)", "View the full review: https://github.com/you/my-report/pull/3#pullrequestreview-"] });
sh(w, "you", "gh pr view 3 --comments", { has: ["you commented (Owner)", "toby requested changes (Collaborator)", "  Please say who to ask"] });
sh(w, "you", "gh pr diff 3", { has: ["diff --git a/report.md b/report.md", "-Thanks to everyone who helpd.", "+Thanks to everyone who helped."] });
sh(w, "you", "gh pr merge 3 --rebase", { fails: true, has: ["Rebase merging is outside this lesson"] });
sh(w, "you", "gh pr merge 3 --auto --squash", { fails: true, has: ["Auto merge is not allowed for this repository"] });
const mainBefore = gh(w).branches.main;
sh(w, "you", "gh pr merge 3 --squash --delete-branch", { has: ["✓ Squashed and merged pull request you/my-report#3 (Fix the typo in the report)", "✓ Deleted local branch fix-typo and switched to branch main", "✓ Deleted remote branch fix-typo"] });
eq([you(w).branch, w.repos.you.branches["fix-typo"], w.repos.you.branches.main], ["main", undefined, gh(w).branches.main], "--delete-branch: local branch gone, on main, pulled");
const sq = w.commits[gh(w).branches.main];
eq([sq.parents, sq.msg, sq.author], [[mainBefore], "Fix the typo in the report (#3)", "You"], "squash: one commit, base as only parent");
eq([pr3.state, pr3.method, pr3.branchDeleted, gh(w).branches["fix-typo"], G.prHead(w, pr3) === pr3.headCommit], ["merged", "squash", true, undefined, true], "merged, branch deleted on GitHub");
eq([w.issues[0].state, w.issues[0].reason, w.issues[0].closedBy], ["closed", "completed", 3], "Fixes #1 closed issue 1");
eq([w.issues[1].state, w.issues[1].reason], ["closed", "not_planned"], "an issue closed as not planned stays that way");
sh(w, "you", "gh pr merge 3", { fails: true, has: ["! Pull request you/my-report#3 was already merged"] });
sh(w, "you", "gh pr view 3", { has: ["Merged • you wants to merge 1 commit into main from fix-typo"] });
sh(w, "you", "git pull", { has: ["Already up to date."] });

// Albert: a merge commit, merged by Toby; then close and reopen
sh(w, "albert", "git pull");
sh(w, "albert", "git switch -c add-date");
edit(albert(w), "report.md", (s) => s.replace("Deadline: Friday", "Deadline: Friday 21 November"));
sh(w, "albert", 'git commit -am "Add the date to the deadline"');
sh(w, "albert", "git push -u origin add-date");
sh(w, "albert", 'gh pr create --fill', { has: ["Creating pull request for add-date into main in you/my-report", "/pull/4"] });
eq(w.prs[1].title, "Add the date to the deadline", "--fill takes the commit subject");
sh(w, "albert", "gh pr close 4", { has: ["✓ Closed pull request you/my-report#4 (Add the date to the deadline)"] });
sh(w, "albert", "gh pr close 4", { has: ["! Pull request you/my-report#4 (Add the date to the deadline) is already closed"] });
sh(w, "albert", "gh pr reopen 4", { has: ["✓ Reopened pull request you/my-report#4 (Add the date to the deadline)"] });
sh(w, "toby", "gh pr merge 4 --merge", { has: ["✓ Merged pull request you/my-report#4 (Add the date to the deadline)"] });
const mc = w.commits[gh(w).branches.main];
eq([mc.parents.length, mc.msg, mc.author], [2, "Merge pull request #4 from you/add-date", "Toby"], "merge commit by whoever merged");
sh(w, "toby", "gh pr close 4", { fails: true, has: ["can't be closed because it was already merged"] });
sh(w, "toby", "gh pr view", { fails: true, has: ["could not determine current branch"] });
sh(w, "toby", "git status", { fails: true, has: ["fatal: not a git repository"] });
sh(w, "you", "git pull");

/* ------------------------------------------------------------ Actions */
sh(w, "you", "gh workflow list", { has: ["no workflows found"] });
sh(w, "you", "gh run list", { has: ["no runs found"] });
sh(w, "you", "git switch -c spell-check");
you(w).work[".github/workflows/checks.yml"] = G.WORKFLOWS.spelling;
edit(you(w), "report.md", (s) => s + "We recieved good feedback.\n");
sh(w, "you", "git add .");
sh(w, "you", 'git commit -m "Check spelling on every pull request"');
sh(w, "you", "git push -u origin spell-check");
eq(w.runs.length, 0, "push filter: only main runs on push");
sh(w, "you", 'gh pr create --title "Check spelling" --body "Adds a spell check."');
const prCi = w.prs.at(-1);
eq(w.runs.length, 1, "pull_request run starts when the PR opens");
const r1 = w.runs[0];
eq([r1.workflow, r1.event, r1.branch, r1.pr, r1.ok, r1.jobs.map((j) => j.name), r1.commit], ["Checks", "pull_request", "spell-check", prCi.n, false, ["spelling"], gh(w).branches["spell-check"]], "a failing spell check run");
eq(r1.jobs[0].steps.map((s) => [s.name, s.ok, !!s.skipped]),
  [["Set up job", true, false], ["Run actions/checkout@v7", true, false], ["Run codespell-project/actions-codespell@v2", false, false], ["Post Run actions/checkout@v7", true, false], ["Complete job", true, false]],
  "steps of the failing job");
const typoLine = you(w).work["report.md"].split("\n").indexOf("We recieved good feedback.") + 1;
ok(r1.jobs[0].steps[2].log.includes(`./report.md:${typoLine}: recieved ==> received`), "codespell prints the typo like codespell");
eq(r1.annotations.map((a) => a.message), ["recieved ==> received", "Process completed with exit code 65."], "annotations");
sh(w, "you", `gh pr checks ${prCi.n}`, { fails: true, has: ["Some checks were not successful", "0 cancelled, 1 failing, 0 successful, 0 skipped, and 0 pending checks", "X  Checks/spelling (pull_request)", `https://github.com/you/my-report/actions/runs/${r1.id}/job/`] });
sh(w, "you", "gh run list", { has: ["STATUS  TITLE           WORKFLOW  BRANCH       EVENT         ID", `X       Check spelling  Checks    spell-check  pull_request  ${r1.id}`] });
sh(w, "you", `gh run view ${r1.id}`, {
  has: [`X spell-check Checks #${prCi.n} · ${r1.id}`, "Triggered via pull_request about 1 minute ago", "JOBS", "X spelling in", "  X Run codespell-project/actions-codespell@v2",
    "ANNOTATIONS", "X recieved ==> received", `spelling: report.md#${typoLine}`, `To see what failed, try: gh run view ${r1.id} --log-failed`],
});
sh(w, "you", `gh run view ${r1.id} --log-failed`, { has: [`spelling\tRun codespell-project/actions-codespell@v2\t./report.md:${typoLine}: recieved ==> received`, "spelling\tRun codespell-project/actions-codespell@v2\tError: Process completed with exit code 65."], not: ["Set up job"] });
sh(w, "you", `gh run view ${r1.id} --log`, { has: ["spelling\tSet up job\tCurrent runner version", "spelling\tRun actions/checkout@v7\tSyncing repository: you/my-report"] });
sh(w, "you", "gh run view 123", { fails: true, has: ["HTTP 404: Not Found"] });
sh(w, "you", "gh workflow list", { has: ["NAME    STATE   ID", "Checks  active"] });
// fix it: the push to the PR's branch runs the check again
edit(you(w), "report.md", (s) => s.replace("recieved", "received"));
sh(w, "you", 'git commit -am "Fix spelling"');
sh(w, "you", "git push");
const r2 = w.runs.at(-1);
eq([w.runs.length, r2.event, r2.ok, prCi.headCommit], [2, "pull_request", true, gh(w).branches["spell-check"]], "a push to the PR branch runs the check again");
sh(w, "you", `gh pr checks ${prCi.n}`, { has: ["All checks were successful", "0 cancelled, 0 failing, 1 successful, 0 skipped, and 0 pending checks", "✓  Checks/spelling (pull_request)"] });
sh(w, "you", "gh run view", { has: [`✓ spell-check Checks #${prCi.n} · ${r2.id}`, "✓ spelling in", "For more information about the job, try: gh run view --job="], not: ["ANNOTATIONS"] });
const jobId = r2.jobs[0].id;
sh(w, "you", `gh run view --job=${jobId}`, { has: ["✓ spelling in", "  ✓ Set up job", `To see the full job log, try: gh run view --log --job=${jobId}`] });
sh(w, "you", `gh pr view ${prCi.n}`, { has: ["• ✓ Checks passing"] });
eq(G.checkState(w, r2.commit, "spelling"), "pass", "checkState");

/* ------------------------------------------------------------ codespell */
eq(G.codespell({ "a.md": "Thanks to everyone who helpd." }).found, [], "helpd is not a word codespell knows to flag");
eq(G.codespell({ "a.md": "Teh plan\nTEH END\nIt is realy good\nseperate it" }).lines,
  ["./a.md:1: Teh ==> The", "./a.md:2: TEH ==> THE", "./a.md:3: realy ==> really, relay", "./a.md:4: seperate ==> separate"], "codespell case and many fixes");
eq(G.codespell({ ".github/x.yml": "teh", ".gitignore": "teh", "docs/b.md": "untill", "c.md": "teh" }, { skip: "c.md" }).lines, ["./docs/b.md:1: untill ==> until"], "hidden files and --skip");
eq(G.codespell({ "a.md": "teh wich" }, { ignore: "teh" }).lines, ["./a.md:1: wich ==> which"], "ignore_words_list");
eq(G.codespell({ "a.md": "constructor toString" }).found, [], "no false hits from Object keys");

/* ------------------------------------------------------------ rulesets */
const rjson = G.rulesetJson({ checks: ["spelling"], approvals: 1 });
eq(JSON.parse(rjson), {
  name: "Protect main", target: "branch", enforcement: "active", conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
  rules: [{ type: "non_fast_forward" }, { type: "pull_request", parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "spelling" }] } }],
}, "rulesetJson is GitHub's shape");
sh(w, "you", "gh ruleset list", { has: ["no rulesets found in you/my-report or its parents"] });
you(w).work["bad.json"] = "{nope";
sh(w, "you", "gh api --method POST repos/you/my-report/rulesets --input bad.json", { fails: true, has: ["gh: Problems parsing JSON (HTTP 400)"] });
you(w).work["noname.json"] = '{"enforcement":"active"}';
sh(w, "you", "gh api -X POST repos/you/my-report/rulesets --input noname.json", { fails: true, has: ['"name" wasn\'t supplied.', "(HTTP 422)"] });
sh(w, "you", "gh api --method POST repos/you/my-report/rulesets --input missing.json", { fails: true, has: ["open missing.json: no such file or directory"] });
you(w).work["ruleset.json"] = rjson;
const created = sh(w, "you", "gh api --method POST repos/you/my-report/rulesets --input ruleset.json", { has: ['"name": "Protect main"', '"enforcement": "active"', '"source": "you/my-report"', '"current_user_can_bypass": "never"'] });
const rs = w.rules[0];
eq([rs.name, rs.branch, rs.requirePR, rs.approvals, rs.checks, rs.blockForcePush, JSON.parse(created).id], ["Protect main", "main", true, 1, ["spelling"], true, rs.id], "ruleset stored");
sh(w, "you", "gh api --method POST repos/{owner}/{repo}/rulesets --input ruleset.json", { fails: true, has: ["gh: Validation Failed (HTTP 422)", "Name must be unique"] });
sh(w, "you", "gh api repos/you/my-report/rulesets", { has: [`"id": ${rs.id}`] });
sh(w, "you", "gh api repos/you/my-report/hooks", { fails: true, has: ["gh: Not Found (HTTP 404)"] });
sh(w, "you", "gh ruleset list", { has: ["Showing 1 of 1 rulesets in you/my-report and its parents", "ID       NAME          SOURCE                STATUS  RULES", `${rs.id}  Protect main  you/my-report (repo)  active  3`] });
sh(w, "toby", `gh ruleset view ${rs.id}`, {
  has: ["Protect main", `ID: ${rs.id}`, "Source: you/my-report (Repository)", "Enforcement: Active", "This ruleset cannot be bypassed",
    "- ref_name: [exclude: []] [include: [refs/heads/main]]", "- non_fast_forward",
    "- pull_request: [dismiss_stale_reviews_on_push: false] [require_code_owner_review: false] [require_last_push_approval: false] [required_approving_review_count: 1] [required_review_thread_resolution: false]",
    "- required_status_checks: [required_status_checks: [map[context:spelling]]] [strict_required_status_checks_policy: false]"],
});
// a push straight to main is refused (on a copy, so the main story goes on)
{
  const w2 = G.clone(w);
  sh(w2, "you", "git switch main");
  edit(you(w2), "notes.txt", (s) => s + "- push straight to main\n");
  sh(w2, "you", 'git commit -am "Straight to main"');
  const before = gh(w2).branches.main;
  sh(w2, "you", "git push", {
    fails: true, has: ["remote: error: GH013: Repository rule violations found for refs/heads/main.",
      "remote: Review all repository rules at https://github.com/you/my-report/rules?ref=refs%2Fheads%2Fmain",
      "remote: - Changes must be made through a pull request.", 'remote: - Required status check "spelling" is expected.',
      " ! [remote rejected] main -> main (push declined due to repository rule violations)", "error: failed to push some refs to 'github.com/you/my-report.git'"],
  });
  eq(gh(w2).branches.main, before, "GitHub's main did not move");
  sh(w2, "you", "git push origin spell-check", { has: ["Everything up-to-date"] });
}
eq(G.mergeBlockers(w, prCi.n), ["At least 1 approving review is required by reviewers with write access."], "blocked: needs an approval");
sh(w, "you", `gh pr merge ${prCi.n} --squash`, {
  fails: true, has: [`X Pull request you/my-report#${prCi.n} is not mergeable: the base branch policy prohibits the merge.`,
    "To have the pull request merged after all the requirements have been met, add the `--auto` flag.",
    "- At least 1 approving review is required by reviewers with write access."],
});
sh(w, "toby", `gh pr review ${prCi.n} --request-changes -b "Name the step"`);
eq(G.mergeBlockers(w, prCi.n), ["1 review requesting changes by reviewers with write access."], "blocked: changes requested");
sh(w, "you", `gh pr checks ${prCi.n} --required`, { has: ["Checks/spelling"] });
// a failing required check blocks too (on a copy)
{
  const w2 = G.clone(w);
  sh(w2, "toby", `gh pr review ${prCi.n} --approve`);
  edit(you(w2), "report.md", (s) => s + "Untill next time.\n");
  sh(w2, "you", 'git commit -am "Sign off"');
  sh(w2, "you", "git push");
  eq(G.mergeBlockers(w2, prCi.n), ['Required status check "spelling" is failing.'], "blocked: the required check fails");
  w2.rules[0].checks.push("tests");
  eq(G.mergeBlockers(w2, prCi.n), ['Required status check "spelling" is failing.', 'Required status check "tests" is expected.'], "blocked: a check that never ran");
  w2.rules[0].enforcement = "disabled";
  eq(G.mergeBlockers(w2, prCi.n), [], "a disabled ruleset blocks nothing");
  eq(G.prConflicts(w2, prCi.n), [], "no conflicts");
  // main changes the same line the pull request changed: GitHub cannot merge it
  sh(w2, "albert", "git switch main");
  sh(w2, "albert", "git pull");
  edit(albert(w2), "report.md", (s) => s.replace(/^Deadline: .*$/m, "Deadline: never"));
  sh(w2, "albert", 'git commit -am "Move the deadline"');
  sh(w2, "albert", "git push"); // the ruleset is disabled on this copy
  const head2 = gh(w2).branches["spell-check"];
  edit(you(w2), "report.md", (s) => s.replace(/^Deadline: .*$/m, "Deadline: soon"));
  sh(w2, "you", 'git commit -am "Deadline soon"');
  sh(w2, "you", "git push");
  eq(G.prConflicts(w2, prCi.n), ["report.md"], "prConflicts names the file");
  sh(w2, "you", `gh pr merge ${prCi.n} --merge`, { fails: true, has: [`X Pull request you/my-report#${prCi.n} is not mergeable: the merge commit cannot be cleanly created.`, `gh pr checkout ${prCi.n} && git fetch origin main && git merge origin/main`] });
  ok(head2 !== gh(w2).branches["spell-check"], "the push moved the PR branch");
}
sh(w, "toby", `gh pr review ${prCi.n} --approve -b "Thanks"`);
eq(G.mergeBlockers(w, prCi.n), [], "nothing blocks once approved and green");
const runsBefore = w.runs.length;
sh(w, "you", `gh pr merge ${prCi.n} --squash --delete-branch`, { has: ["✓ Squashed and merged pull request"] });
const r3 = w.runs.at(-1);
eq([w.runs.length - runsBefore, r3.event, r3.branch, r3.ok, r3.commit, r3.title], [1, "push", "main", true, gh(w).branches.main, `Check spelling (#${prCi.n})`], "the merge pushes to main, which runs the check");
sh(w, "you", "git switch main");
sh(w, "you", "git pull");

/* ------------------------------------------------------------ Pages */
sh(w, "you", "git switch -c publish");
you(w).work[".github/workflows/pages.yml"] = G.WORKFLOWS.pages;
sh(w, "you", "git add .github/workflows/pages.yml");
sh(w, "you", 'git commit -m "Publish the report with GitHub Pages"');
sh(w, "you", "git push -u origin publish");
sh(w, "you", 'gh pr create --title "Publish the report"');
const prPages = w.prs.at(-1);
eq(w.runs.filter((r) => r.pr === prPages.n).map((r) => r.workflow), ["Checks"], "the pages workflow does not run on pull requests");
sh(w, "albert", `gh pr review ${prPages.n} --approve`);
sh(w, "you", `gh pr merge ${prPages.n} --merge`);
const pub = w.runs.find((r) => r.workflow === "Publish");
eq([pub?.ok, pub?.event, pub?.artifacts, w.pages], [true, "push", ["github-pages"], { url: "https://you.github.io/my-report/", commit: gh(w).branches.main }], "deployed to Pages");
ok(pub.jobs[0].steps.some((s) => s.log.includes("Reported success!")), "deploy log");
sh(w, "you", `gh run view ${pub.id}`, { has: ["ARTIFACTS", "github-pages", "✓ main Publish · "] });
sh(w, "you", "gh workflow list", { has: ["Checks", "Publish", "active"] });

/* --------------------------------------------- workflow files that fail */
{
  const runOn = (text, files = {}) => {
    const w2 = G.clone(w);
    w2.rules = [];
    sh(w2, "you", "git switch main");
    sh(w2, "you", "git pull");
    you(w2).work[".github/workflows/try.yml"] = text;
    Object.assign(you(w2).work, files);
    sh(w2, "you", "git add .");
    sh(w2, "you", 'git commit -m "Try a workflow"');
    sh(w2, "you", "git push");
    return { w2, run: w2.runs.filter((r) => r.file === ".github/workflows/try.yml").at(-1) };
  };
  const pages = G.WORKFLOWS.pages.replace("name: Publish", "name: Try");
  let t = runOn(pages.replace(/permissions:\n(  .*\n)+/, ""));
  eq([t.run.ok, t.run.annotations.map((a) => a.message)], [false, ['Ensure GITHUB_TOKEN has permission "id-token: write".']], "deploy-pages needs id-token: write");
  t = runOn(pages.replace("          path: .\n", "").replace("        with:\n", ""));
  ok(!t.run.ok && t.run.jobs[0].steps.some((s) => s.log.includes("tar: _site/: Cannot open: No such file or directory")), "upload-pages-artifact defaults to _site/");
  t = runOn(pages.replace(/    environment:\n(      .*\n)+/, ""));
  ok(!t.run.ok && t.run.annotations.some((a) => a.message.startsWith("Missing environment")), "deploy-pages needs an environment");
  t = runOn([
    "name: Hello", "on: [push]", "jobs:", "  hi:", "    name: Say hi", "    runs-on: ubuntu-latest", "    steps:",
    '      - run: echo "Hello ${{ github.actor }} on ${{ github.ref_name }}"', "      - uses: some/thing@v1", "      - name: Two lines",
    "        run: |", "          echo one", "          echo 'two  words'", "  after:", "    needs: hi", "    runs-on: ubuntu-latest",
    "    steps:", "      - run: exit 3", "  last:", "    needs: [after]", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo never", "",
  ].join("\n"));
  const [hi, after, last] = t.run.jobs;
  eq([hi.name, hi.ok, after.ok, last.skipped, t.run.ok], ["Say hi", true, false, true, false], "needs: order, a failing job, a skipped job");
  ok(hi.steps[1].log.includes("Hello you on main"), "run: echo with ${{ }}");
  ok(hi.steps[2].log.includes("This lesson does not run some/thing@v1. It passes."), "unknown actions pass");
  eq(hi.steps[3].log, ["Run echo one", "echo one", "echo 'two  words'", "one", "two  words"], "a multi-line run block");
  ok(after.steps[1].log.includes("Error: Process completed with exit code 3."), "exit 3 fails the step");
  t = runOn("name: Broken\non: push\njobs:\n  a:\n    steps:\n      - run: echo hi\n");
  ok(t.run.error?.includes("Required property is missing: runs-on"), "missing runs-on is a workflow error");
  sh(t.w2, "you", `gh run view ${t.run.id}`, { has: ["X This run likely failed because of a workflow file issue."] });
  t = runOn("name: Bad\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout\n");
  ok(t.run.error?.includes("Expected format {org}/{repo}[/path]@ref. Actual 'actions/checkout'"), "uses needs @ref");
  t = runOn("name: Bad\non: push\njobs:\n  a:\n    runs-on: [ubuntu\n");
  ok(t.run.error?.includes("You have an error in your yaml syntax"), "a YAML error");
  t = runOn("name: Spell\non: push\njobs:\n  spell:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: codespell\n", { "notes.txt": "teh notes\n" });
  ok(!t.run.ok && t.run.jobs[0].steps[2].log.includes("./notes.txt:1: teh ==> the"), "run: codespell");
}

/* ------------------------------------------------------------ YAML */
eq(G.parseYaml([
  "name: 'It''s # not a comment'  # a comment",
  "on:",
  "  push:",
  "    branches: [ main, 'release/*' ]",
  "  pull_request:",
  "env: { A: 1, B: \"two\" }",
  "list:",
  "- a",
  "- key: v",
  "  other: true",
  "text: >-",
  "  folded",
  "  line",
  "",
].join("\n")), {
  name: "It's # not a comment", on: { push: { branches: ["main", "release/*"] }, pull_request: null },
  env: { A: 1, B: "two" }, list: ["a", { key: "v", other: true }], text: "folded line",
}, "parseYaml");
ok((() => { try { G.readWorkflow("jobs:\n  a:\n    runs-on: x\n    steps:\n      - run: hi\n"); } catch (e) { return e.message.includes("No event triggers defined in `on`"); } return false; })(), "missing on:");

/* ------------------------------------------------ closing from commits */
{
  const w2 = G.clone(w);
  w2.rules = [];
  sh(w2, "you", 'gh issue create --title "Spell out the month"');
  const n = w2.num;
  sh(w2, "you", "git switch main");
  sh(w2, "you", "git pull");
  edit(you(w2), "report.md", (s) => s.replace("21 November", "21st of November"));
  sh(w2, "you", `git commit -am "Spell out the date" -m "Fixes #${n}"`);
  sh(w2, "you", "git push");
  eq([G.issueOf(w2, n).state, G.issueOf(w2, n).closedByCommit], ["closed", gh(w2).branches.main], "a commit on main that says Fixes #N closes the issue");
}

/* ------------------------------------------------ git: .gitignore, rm, messages */
{
  const w2 = team();
  const d = you(w2);
  d.work[".gitignore"] = "# things that stay on this computer\nsecret.env\n*.log\nbuild/\n";
  d.work["secret.env"] = "TOKEN=example-not-real\n";
  d.work["debug.log"] = "log\n";
  d.work["build/out.txt"] = "built\n";
  d.work["docs/guide.md"] = "guide\n";
  sh(w2, "you", "git status", { has: ["Untracked files:\n\t.gitignore\n\tdocs/guide.md"], not: ["secret.env", "debug.log", "build/out.txt"] });
  eq(G.fileStates(w2, w2.repos.you, d).filter((f) => f.state === "new").map((f) => f.path), [".gitignore", "docs/guide.md"], "fileStates leaves ignored files out");
  eq([G.isIgnored(d.work, "secret.env"), G.isIgnored(d.work, "sub/debug.log"), G.isIgnored(d.work, "build/out.txt"), G.isIgnored(d.work, "report.md")], [true, true, true, false], "isIgnored");
  sh(w2, "you", "git add -A");
  eq(Object.keys(d.index).sort(), [".gitignore", "docs/guide.md", "notes.txt", "report.md"], "git add -A skips ignored files");
  sh(w2, "you", "git add secret.env", { fails: true, has: ["The following paths are ignored by one of your .gitignore files:\nsecret.env\nhint: Use -f if you really want to add them.\nhint: Disable this message with \"git config set advice.addIgnoredFile false\""] });
  sh(w2, "you", "git add build", { fails: true, has: ["ignored by one of your .gitignore files:\nbuild"] });
  ok(d.index["secret.env"] === undefined, "an ignored file is not added");
  sh(w2, "you", "git add -f secret.env");
  ok(d.index["secret.env"] !== undefined, "git add -f adds it anyway");
  sh(w2, "you", 'git commit -m "Ignore local files" -m "Secrets and build output stay on this computer."', { has: ["] Ignore local files\n"] });
  eq(w2.commits[w2.repos.you.branches.main].msg, "Ignore local files\n\nSecrets and build output stay on this computer.", "two -m make subject and body");
  sh(w2, "you", "git log", { has: ["    Ignore local files\n\n    Secrets and build output stay on this computer."] });
  ok(sh(w2, "you", "git log --oneline").split("\n")[0].endsWith(" Ignore local files"), "log --oneline shows the subject");
  // tracked files are never ignored
  edit(d, "secret.env", (s) => s + "MORE=1\n");
  sh(w2, "you", "git status", { has: ["modified:   secret.env"] });
  sh(w2, "you", "git add secret.env");
  edit(d, "secret.env", (s) => s + "EVEN=MORE\n");
  sh(w2, "you", "git rm --cached secret.env", { fails: true, has: ["error: the following file has staged content different from both the\nfile and the HEAD:\n    secret.env\n(use -f to force removal)"] });
  d.work["secret.env"] = d.index["secret.env"];
  sh(w2, "you", "git rm --cached secret.env", { has: ["rm 'secret.env'"] });
  ok(d.work["secret.env"] !== undefined && d.index["secret.env"] === undefined, "rm --cached keeps the file in the folder");
  sh(w2, "you", "git status", { has: ["Changes to be committed:\n\tdeleted:    secret.env"], not: ["Untracked files"] });
  sh(w2, "you", 'git commit -m "Stop tracking secret.env"');
  ok(G.treeOf(w2, w2.repos.you.branches.main)["secret.env"] === undefined, "the commit drops it");
  sh(w2, "you", "git status", { has: ["nothing to commit, working tree clean"] });
  sh(w2, "you", "git rm nothing.txt", { fails: true, has: ["fatal: pathspec 'nothing.txt' did not match any files"] });
  sh(w2, "you", "git rm docs", { fails: true, has: ["fatal: not removing 'docs' recursively without -r"] });
  sh(w2, "you", "git rm -r docs", { has: ["rm 'docs/guide.md'"] });
  ok(d.work["docs/guide.md"] === undefined, "git rm deletes the file too");
  edit(d, "notes.txt", (s) => s + "x\n");
  sh(w2, "you", "git rm notes.txt", { fails: true, has: ["error: the following file has local modifications:\n    notes.txt"] });
  d.work[".gitignore"] += "!keep.log\n";
  d.work["keep.log"] = "kept\n";
  ok(!G.isIgnored(d.work, "keep.log") && G.isIgnored(d.work, "other.log"), "! takes a file back");
}

/* ------------------------------------------------------------ gh itself */
sh(w, "you", "gh foo", { fails: true, has: ['unknown command "foo" for "gh"', "issue", "pr ", "ruleset"] });
sh(w, "you", "gh issue foo", { fails: true, has: ['unknown command "foo" for "gh issue"', "gh issue create, list"] });
sh(w, "you", "gh", { has: ["COMMANDS IN THIS LESSON"] });
sh(w, "toby", "gh issue list --state all", { has: ["#1"] });
sh(w, "you", "gh issue list -R someone/else", { fails: true, has: ["GraphQL: Could not resolve to a Repository with the name 'someone/else'. (repository)"] });
sh(w, "toby", 'gh pr create --title "x"', { fails: true, has: ["could not determine the current branch"] });

console.log(fails ? `${fails} model check(s) failed, ${passes} passed` : `model: all ${passes} checks pass`);
process.exitCode = fails ? 1 : 0;
