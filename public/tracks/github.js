/* tracks/github.ts: Issues and pull requests.
 *
 * For someone who knows git, maybe gh too, but never worked in a team. It
 * starts with the team report already on GitHub: a few versions, pushed,
 * Albert has a clone, and an old question of his is open as issue #1. Toby
 * has no computer; he works on GitHub (his acts run gh as Toby).
 *
 * The loop it teaches: write it down (issue, label, assignee), work on a
 * branch named after the issue with a draft pull request that says
 * "Closes #N", review both ways, squash and merge, the issue closes itself.
 *
 * The report starts with a mistake for Toby to find: the results line says
 * "two of four ideas" when the team tested three.
 */
import * as G from "../model.js";
import { MAIN_FILE, work, setWork, insertAfter, commitAct, pushAct, pullAct, desk, synced, changed, chose, you, gh, albert, br, q } from "../story.js";
const REPORT = "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\nNext step: try it with real users.\n\nDeadline: Friday\nThanks to everyone who helped.\n";
/* who is who on GitHub: found by author, so a reader who opens an extra
 * issue in command mode doesn't shift anything */
const issueBy = (w, author) => (w.issues ?? []).find((i) => i.author === author);
const question = (w) => issueBy(w, "Albert"); // #1, from before the lesson
const bug = (w) => issueBy(w, "Toby"); // #2, Toby's
const idea = (w) => issueBy(w, "You"); // #3, yours
const prBy = (w, author) => w.prs.find((p) => p.author === author);
const myPr = (w) => prBy(w, "You");
const hisPr = (w) => prBy(w, "Albert");
/* numbers for the copy, with what a typical run gives when there is none yet */
const nQ = (w) => question(w)?.n ?? 1;
const nBug = (w) => bug(w)?.n ?? 2;
const nIdea = (w) => idea(w)?.n ?? 3;
const nMine = (w) => myPr(w)?.n ?? 4;
const nHis = (w) => hisPr(w)?.n ?? 5;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const tobyAsked = (w) => (myPr(w)?.reviews ?? []).some((r) => r.who === "toby" && r.state === "changes_requested");
/* the first line a pull request adds to report.md, as a line number in the
 * new file, and its text: where Toby leaves his note */
function firstAdded(w, pr) {
    const rows = G.lineDiff(G.treeOf(w, G.prBase(w, pr))[MAIN_FILE], G.treeOf(w, G.prHead(w, pr))[MAIN_FILE]);
    let k = 0;
    for (const r of rows) {
        if (r.t === "-")
            continue;
        k++;
        if (r.t === "+" && r.s.trim())
            return { line: k, text: r.s };
    }
    return { line: 1, text: "" };
}
/* a pull request's changes to report.md, the changed lines only, for the lesson text */
function diffBox(w, pr) {
    if (!pr)
        return "";
    const rows = G.lineDiff(G.treeOf(w, G.prBase(w, pr))[MAIN_FILE], G.treeOf(w, G.prHead(w, pr))[MAIN_FILE]).filter((r) => r.t !== " ");
    return `<div class="pr__diff"><p class="pr__file">${MAIN_FILE}</p>${rows.map((r) => `<div class="dl dl--${r.t === "+" ? "add" : "del"}">${r.t} ${esc(r.s)}</div>`).join("")}</div>`;
}
/* the loop, drawn as a ring for the recap */
const LOOP = ["Issue", "Branch", "Draft PR", "Review", "Merge", "Issue closed"];
const loopHtml = () => `<ol class="loop" aria-label="the team loop">${LOOP.map((s) => `<li><b>${s}</b></li>`).join("")}</ol>`;
export const github = {
    id: "github",
    title: "Issues and pull requests",
    short: "GitHub",
    word: "GitHub",
    start: (w, run) => {
        w.folder["report.md"] = REPORT;
        run("git init");
        run("git add -A");
        run(`git commit -m "First version"`);
        // the mistake Toby will find: the team tested three ideas, not four
        setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /worked best/, "Results: two of four ideas worked."));
        run(`git commit -am "Add results"`);
        setWork(w, "notes.txt", work(w, "notes.txt") + "- ask five users\n");
        run(`git commit -am "Plan the user tests"`);
        run(`git remote add origin ${G.REPO_URL}`);
        run("git push -u origin main");
        run(`git clone ${G.REPO_URL}`, "albert");
        run(`gh issue create --title "Should we make slides too?" --body "Some readers might like slides better than a report." --label question`, "albert");
    },
    chapters: [
        {
            title: "Write it down",
            short: "issue",
            goal: "turn bugs and ideas into issues the team can see",
            beats: [
                {
                    id: "where",
                    kind: "choose",
                    ghTab: "issues",
                    say: () => `Toby spots a mistake in the report: it says two of <b>four</b> ideas worked, but the team tested three.<br><br>Where should he put that, so it gets fixed and nobody forgets?`,
                    choose: {
                        options: [
                            { html: "A message in the team chat", right: false, why: "Chats scroll away. In a week nobody can find it, and nobody knows if it got fixed." },
                            { html: "An <b>issue</b> on GitHub", right: true, why: "An issue stays with the project until someone closes it, and everyone on the team can see it." },
                            { html: "A sticky note on his screen", right: false, why: "Only Toby can see it." },
                        ],
                    },
                    done: (w) => chose(w, "where"),
                    after: () => `The Issues tab already has one: Albert's question about slides, from last week.`,
                    term: ["issue", "A note on GitHub about one thing: a bug, an idea, a question. It stays open until someone closes it."],
                },
                {
                    id: "toby-issue",
                    kind: "watch",
                    ghTab: "issues",
                    say: () => `Toby opens an issue. A good one says what's wrong and where, so anyone could fix it without asking him.`,
                    acts: [{
                            label: "Watch Toby open it",
                            who: "toby",
                            steps: () => [`gh issue create --title "Results line says four ideas" --body "We tested three ideas, but the results line says two of four worked."`],
                        }],
                    done: (w) => !!bug(w),
                    after: (w) => `It's issue <b>#${nBug(w)}</b>. Every issue gets a number, so people can point at it: "that's fixed in #${nBug(w)}".`,
                    more: [["Why #2 and not #1?", "#1 is Albert's question. Issues and pull requests share one count, so a number always means one thing."]],
                },
                {
                    id: "my-issue",
                    kind: "act",
                    ghTab: "issues",
                    say: () => `You have an idea too: a one-line summary at the top, so a busy reader gets the result first.<br><br>Ideas get written down the same way as bugs. Open an issue for it.`,
                    acts: [{
                            label: "Submit new issue",
                            look: "github",
                            inputs: [
                                { key: "title", label: "Title", def: () => "Add a summary at the top" },
                                { key: "body", label: "Description", def: () => "Busy readers should get the result in one line." },
                            ],
                            steps: (_w, v) => [`gh issue create --title "${q(v.title)}" --body "${q(v.body)}"`],
                            ai: "open an issue on GitHub: add a one-line summary at the top of the report",
                        }],
                    done: (w) => !!idea(w),
                    after: (w) => `Issue <b>#${nIdea(w)}</b> is yours. Now the team can see the idea and talk about it, and nobody starts the same thing twice.`,
                },
                {
                    id: "labels",
                    kind: "act",
                    ghTab: "issues",
                    say: (w) => `Three open issues, and more will come. To sort them, teams use <b>labels</b>: small colored tags. Every new repository starts with a few, like <b>bug</b>, <b>enhancement</b> and <b>question</b>.<br><br>Put <b>bug</b> on Toby's issue, #${nBug(w)}, and <b>enhancement</b> on yours, #${nIdea(w)}.`,
                    acts: [
                        { label: "Label as bug", look: "github", steps: (w) => [`gh issue edit ${nBug(w)} --add-label bug`], ai: "label Toby's issue as a bug" },
                        { label: "Label as enhancement", look: "github", steps: (w) => [`gh issue edit ${nIdea(w)} --add-label enhancement`], ai: "label my issue as an enhancement" },
                    ],
                    done: (w) => !!bug(w)?.labels.includes("bug") && !!idea(w)?.labels.includes("enhancement"),
                    after: () => `Each issue carries its color now. With a long list, the Labels filter on GitHub, or <code>gh issue list --label bug</code>, shows all the bugs at once.`,
                    term: ["label", "A colored tag on an issue or pull request, like <b>bug</b> or <b>enhancement</b>. Teams use labels to sort and find work."],
                    more: [
                        ["Can I make my own?", "Yes: <code>gh label create</code>, or Issues, then Labels on github.com. Teams add ones like <code>urgent</code> or <code>design</code>."],
                        ["Could I label it while opening it?", "Yes: <code>gh issue create --label enhancement</code> does both at once."],
                    ],
                },
                {
                    id: "assign",
                    kind: "act",
                    ghTab: "issues",
                    say: (w) => `Who does what? Albert offered to fix the bug, and the summary is your idea.<br><br>The person doing an issue is its <b>assignee</b>. Assign #${nIdea(w)} to yourself and #${nBug(w)} to Albert.`,
                    acts: [
                        { label: "Assign yourself", look: "github", steps: (w) => [`gh issue edit ${nIdea(w)} --add-assignee @me`], ai: "assign my issue to me" },
                        { label: "Assign Albert", look: "github", steps: (w) => [`gh issue edit ${nBug(w)} --add-assignee albert`], ai: "assign Toby's bug to Albert" },
                    ],
                    done: (w) => !!idea(w)?.assignees.includes("you") && !!bug(w)?.assignees.includes("albert"),
                    after: () => `Each issue shows who has it. Before anyone starts on something, they check: nobody assigned means it's free.`,
                    term: ["assignee", "The person doing an issue. It tells the team the work is taken, so nobody does it twice."],
                    more: [["How do I find mine later?", "<code>gh issue list --assignee @me</code>, or the Assignee filter on the Issues tab. <code>@me</code> always means you."]],
                },
                {
                    id: "albert-on-it",
                    kind: "watch",
                    ghTab: "issues",
                    say: () => `Albert gets a notification that he's assigned. He answers on the issue.`,
                    acts: [{ label: "Watch Albert answer", who: "albert", steps: (w) => [`gh issue comment ${nBug(w)} --body "On it. I'll fix the number today."`] }],
                    done: (w) => !!bug(w)?.comments.some((c) => c.who === "Albert"),
                    after: () => `The talk about the bug stays with the bug. Months from now, anyone can read what was wrong, who fixed it and why.`,
                },
            ],
        },
        {
            title: "Work on it",
            short: "draft PR",
            goal: "start a pull request for an issue",
            beats: [
                {
                    id: "branch",
                    kind: "act",
                    ghTab: "code",
                    say: (w) => `Time for your issue, #${nIdea(w)}. Start a branch for it, named after the issue: its number, then a few words. Anyone who sees the branch knows what it's for.`,
                    acts: [{
                            label: "New branch",
                            inputs: [{ key: "name", label: "Branch name", def: (w) => `${nIdea(w)}-add-summary` }],
                            steps: (w, v) => [`git checkout -b ${(v.name ?? "").trim().replace(/\s+/g, "-") || `${nIdea(w)}-add-summary`}`],
                            ai: "start a branch for my summary issue",
                        }],
                    done: (w) => !!desk(w)?.branch && desk(w).branch !== "main",
                    onDone: (w) => { w.vars.branch = desk(w).branch; },
                    after: (w) => `You're on <b>${esc(br(w))}</b>, a new line next to main.`,
                    more: [["Is there a shortcut?", "<code>gh issue develop 3 --checkout</code> makes a branch named after issue #3, links it to the issue on GitHub, and checks it out."]],
                },
                {
                    id: "summary",
                    kind: "edit",
                    ghTab: "code",
                    say: () => `Add a one-line summary under the title in <b>report.md</b>.`,
                    edit: {
                        files: [MAIN_FILE],
                        ask: () => "Add a summary",
                        check: (w) => changed(w),
                        canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /^# /, "Summary: idea two wins.")),
                    },
                    done: (w) => changed(w),
                },
                {
                    id: "publish",
                    kind: "act",
                    ghTab: "code",
                    say: (w) => `Commit it and put <b>${esc(br(w))}</b> on GitHub.`,
                    acts: [
                        commitAct("Add a summary"),
                        { label: "Publish branch", steps: (w) => [`git push -u origin ${br(w)}`], ai: "put my branch on GitHub" },
                    ],
                    done: (w) => synced(w, br(w)) && you(w).branches[br(w)] !== you(w).branches.main,
                    after: (w) => `GitHub has <b>${esc(br(w))}</b> now, next to main.`,
                },
                {
                    id: "draft",
                    kind: "act",
                    ghTab: "pulls",
                    say: (w) => `Open a pull request now, before you're sure it's finished. Mark it as a <b>draft</b>: the team can see what you're working on, and nobody merges it by accident.<br><br>Its description says <code>Closes #${nIdea(w)}</code>. That links it to your issue.`,
                    acts: [{
                            label: "Create draft pull request",
                            look: "github",
                            inputs: [{ key: "title", label: "Title", def: () => "Add a summary" }],
                            steps: (w, v) => [`gh pr create --draft --title "${q(v.title)}" --body "Closes #${nIdea(w)}"`],
                            ai: "open a draft pull request for my branch that closes my issue",
                        }],
                    done: (w) => !!myPr(w),
                    after: (w) => `Pull request <b>#${nMine(w)}</b> is up, marked <b>Draft</b>. Its sidebar lists issue #${nIdea(w)}, and the issue lists the pull request. When it merges into main, GitHub closes the issue by itself.`,
                    term: ["draft", "A pull request marked as not finished. Everyone can see it, but nobody can merge it until you mark it ready for review."],
                    more: [["Which words close an issue?", "<code>Closes</code>, <code>Fixes</code> or <code>Resolves</code>, then the number, like <code>Fixes #3</code>. It works when the pull request merges into the main branch."]],
                },
                {
                    id: "ready",
                    kind: "act",
                    ghTab: "pulls",
                    say: () => `It reads well. Mark it <b>ready for review</b>, and ask Toby to review it.<br><br>A <b>reviewer</b> is different from an assignee: you do the work, Toby checks it.`,
                    acts: [
                        { label: "Ready for review", look: "github", steps: (w) => [`gh pr ready ${nMine(w)}`], ai: "mark my pull request ready for review" },
                        { label: "Request review from Toby", look: "github", steps: (w) => [`gh pr edit ${nMine(w)} --add-reviewer toby`], ai: "ask Toby to review it" },
                    ],
                    done: (w) => !!myPr(w) && !myPr(w).draft && ((myPr(w).reviewers ?? []).includes("toby") || (myPr(w).reviews ?? []).some((r) => r.who === "toby")),
                    after: () => `The Draft mark is gone, and Toby is listed under Reviewers as <b>waiting</b>. GitHub lets him know.`,
                    term: ["reviewer", "Someone asked to read a pull request and approve it or ask for changes. The assignee does the work; the reviewer checks it."],
                    more: [["Could I ask while opening it?", "Yes: <code>gh pr create --reviewer toby</code>."]],
                },
            ],
        },
        {
            title: "Review, both ways",
            short: "review",
            goal: "get a review and give one",
            beats: [
                {
                    id: "toby-changes",
                    kind: "watch",
                    ghTab: "pulls",
                    say: () => `Toby reads your change line by line. He leaves a note on one line, then sends his review: <b>changes requested</b>.`,
                    acts: [{
                            label: "Watch Toby review it",
                            who: "toby",
                            steps: () => [(w) => {
                                    const p = myPr(w);
                                    const at = firstAdded(w, p);
                                    G.prReview(w, p.n, "toby", "changes_requested", "Short and clear. One thing before it goes in.", [
                                        { who: "Toby", text: "Which idea won? Say it on this line, so someone who reads only this line still knows.", file: MAIN_FILE, line: at.line },
                                    ]);
                                    w.vars.reviewAt = G.prHead(w, p) ?? "";
                                    w.vars.noteLine = at.text;
                                    return `(Toby asks for changes, with a note on line ${at.line} of ${MAIN_FILE})`;
                                }],
                        }],
                    done: tobyAsked,
                    after: () => `Toby's note sits right under the line it's about. <b>Changes requested</b> isn't a no: it means almost, fix this first.`,
                    term: ["review", "A teammate reads a pull request before it goes into main, then approves it or asks for changes. Notes can sit on single lines."],
                },
                {
                    id: "fix",
                    kind: "edit",
                    ghTab: "pulls",
                    say: () => `Fair point. Open <b>report.md</b> and say on that line which idea won. Make one up: it's your report.`,
                    edit: {
                        files: [MAIN_FILE],
                        ask: () => "Say which idea won",
                        check: (w) => changed(w),
                        canon: (w) => {
                            const t = work(w, MAIN_FILE), l = w.vars.noteLine ?? "";
                            const fixed = /idea two/i.test(l) ? l.replace(/idea two/i, "idea two, the shorter survey,") : l.replace(/\.?\s*$/, ". The winner: the shorter survey.");
                            setWork(w, MAIN_FILE, l && t.includes(l) ? t.replace(l, fixed) : insertAfter(t, /^# /, "The winner: the shorter survey."));
                        },
                    },
                    done: (w) => changed(w),
                },
                {
                    id: "fix-push",
                    kind: "act",
                    ghTab: "pulls",
                    say: (w) => `Commit it and push. No new pull request: this one follows <b>${esc(br(w))}</b>, so it picks up the new commit by itself. Then ask Toby to look again.`,
                    acts: [
                        commitAct("Name the winning idea"),
                        pushAct,
                        { label: "Ask Toby again", look: "github", steps: (w) => [`gh pr edit ${nMine(w)} --add-reviewer toby`], ai: "ask Toby to review it again" },
                    ],
                    done: (w) => synced(w, br(w)) && !!w.vars.reviewAt && gh(w).branches[br(w)] !== w.vars.reviewAt && (myPr(w)?.reviewers ?? []).includes("toby"),
                    after: () => `The new commit is in the pull request. Toby's note is marked <b>Outdated</b>, because the line changed after he wrote it, and he's waiting to look again.`,
                },
                {
                    id: "toby-approves",
                    kind: "watch",
                    ghTab: "pulls",
                    say: () => `Toby takes another look.`,
                    acts: [{ label: "Watch Toby approve it", who: "toby", steps: (w) => [`gh pr review ${nMine(w)} --approve --body "Now it says what won. Approved."`] }],
                    done: (w) => !!myPr(w)?.approved,
                    after: () => `Approved. Each reviewer's latest review is the one that counts, so the pull request is ready to merge.`,
                },
                {
                    id: "albert-pr",
                    kind: "watch",
                    ghTab: "pulls",
                    say: (w) => `Meanwhile Albert fixes Toby's bug, #${nBug(w)}, on his own branch. His pull request says <code>Closes #${nBug(w)}</code>, and he asks <b>you</b> to review it.`,
                    acts: [{
                            label: "Watch Albert open it",
                            who: "albert",
                            steps: (w) => [
                                `git checkout -b ${nBug(w)}-fix-count`,
                                (x) => {
                                    const d = albert(x).desks[0], t = d.work[MAIN_FILE];
                                    d.work[MAIN_FILE] = /of four/.test(t) ? t.replace(/of four/, "of three") : insertAfter(t, /worked best/i, "Results: two of three ideas worked.");
                                    return "(Albert changes four to three in report.md)";
                                },
                                `git commit -am "Fix the number of ideas"`,
                                `git push -u origin ${nBug(w)}-fix-count`,
                                `gh pr create --title "Fix the number of ideas" --body "Closes #${nBug(w)}" --reviewer you`,
                            ],
                        }],
                    done: (w) => !!hisPr(w),
                    after: (w) => `Pull request #${nHis(w)} is waiting, with your name under Reviewers.`,
                },
                {
                    id: "good-review",
                    kind: "choose",
                    ghTab: "pulls",
                    say: (w) => `Here's Albert's change:${diffBox(w, hisPr(w))}Which comment makes a good review?`,
                    choose: {
                        options: [
                            { html: "“Looks fine.”", right: false, why: "Albert can't tell what you checked, or if you opened it at all." },
                            { html: "“Three is right, it matches the first line now. Thanks for the quick fix.”", right: true, why: "About the change, specific, and kind. Albert knows exactly what you checked." },
                            { html: "“Why didn't you count before you pushed?”", right: false, why: "That's about Albert, not the change, and it stings. People stop asking for reviews from someone who writes like that." },
                        ],
                    },
                    done: (w) => chose(w, "good-review"),
                },
                {
                    id: "my-review",
                    kind: "act",
                    ghTab: "pulls",
                    say: (w) => `Approve #${nHis(w)}, with a comment like that one.`,
                    acts: [{
                            label: "Approve",
                            look: "github",
                            inputs: [{ key: "body", label: "Comment", def: () => "Three is right, it matches the first line now. Thanks for the quick fix." }],
                            steps: (w, v) => [`gh pr review ${nHis(w)} --approve --body "${q(v.body)}"`],
                            ai: "approve Albert's pull request with a short, specific comment",
                        }],
                    done: (w) => !!hisPr(w)?.approved,
                    after: () => `Albert's pull request is approved, with your words on it. On a team, everyone asks for reviews and everyone gives them.`,
                    more: [["Can I read it in the terminal?", "<code>gh pr diff 5</code> prints the change. <code>gh pr checkout 5</code> puts the branch on your laptop, so you can try it."]],
                },
            ],
        },
        {
            title: "Merge and close",
            short: "merge",
            goal: "merge pull requests and close issues",
            beats: [
                {
                    id: "how-merge",
                    kind: "choose",
                    ghTab: "pulls",
                    say: () => `Your pull request has two commits, and the second only fixes the first. Your team wants main to read like a list of finished changes, one per pull request.<br><br>Which merge button?`,
                    choose: {
                        options: [
                            { html: "<b>Create a merge commit</b>: both commits go into main, plus a merge commit joining them", right: false, why: "That keeps every step, the fix-up too. Plenty of teams work that way, but yours wants one commit per pull request." },
                            { html: "<b>Squash and merge</b>: GitHub packs both into one new commit on main", right: true, why: "One pull request, one commit on main. The small steps stay readable on the pull request page." },
                        ],
                    },
                    done: (w) => chose(w, "how-merge"),
                    term: ["squash and merge", "Merging a pull request as one new commit that holds all its changes. Main gets one commit per pull request."],
                },
                {
                    id: "merge",
                    kind: "act",
                    ghTab: "pulls",
                    say: () => `Squash and merge it, and delete the branch on GitHub: its work is in main now.`,
                    acts: [{ label: "Squash and merge", look: "github", steps: (w) => [`gh pr merge ${nMine(w)} --squash --delete-branch`], ai: "squash and merge my pull request, then delete its branch" }],
                    done: (w) => myPr(w)?.state === "merged",
                    after: (w) => {
                        const p = myPr(w), msg = esc(G.subject(w.commits[p.mergeCommit]?.msg ?? ""));
                        const closed = idea(w)?.state === "closed";
                        return `Main on GitHub got one new commit, <b>${msg}</b>, holding both of yours. ` +
                            (closed ? `And issue #${nIdea(w)} closed by itself: the pull request said <code>Closes #${nIdea(w)}</code>.`
                                : `Issue #${nIdea(w)} is still open: the description didn't say <code>Closes #${nIdea(w)}</code>.`);
                    },
                    more: [["Why delete the branch?", "Its work is in main now. Old branches pile up, and soon nobody knows which ones are finished. GitHub can do it after every merge: Settings, General, Automatically delete head branches."]],
                },
                {
                    id: "albert-merge",
                    kind: "watch",
                    ghTab: "issues",
                    say: (w) => `Albert merges his pull request, #${nHis(w)}, the same way.`,
                    acts: [{ label: "Watch Albert merge it", who: "albert", steps: (w) => [`gh pr merge ${nHis(w)} --squash --delete-branch`] }],
                    done: (w) => hisPr(w)?.state === "merged",
                    after: (w) => `Toby's issue, #${nBug(w)}, is closed too, by #${nHis(w)}. Nobody had to remember to close it.`,
                },
                {
                    id: "not-planned",
                    kind: "act",
                    ghTab: "issues",
                    say: (w) => `One issue is still open: Albert's question about slides, #${nQ(w)}. The team talked it over, and the answer is no.<br><br>Close it as <b>not planned</b>, with a comment that says why.`,
                    acts: [{
                            label: "Close as not planned",
                            look: "github",
                            inputs: [{ key: "c", label: "Comment", def: () => "Not this month: the report is short, and nobody has asked for slides." }],
                            steps: (w, v) => [`gh issue close ${nQ(w)} --reason "not planned" --comment "${q(v.c)}"`],
                            ai: "close Albert's slides question as not planned, and say why",
                        }],
                    done: (w) => question(w)?.state === "closed" && question(w)?.reason === "not_planned",
                    after: () => `No open issues left. Under <b>Closed</b>, each one keeps its story: two finished by pull requests, one not planned, with your reason. When someone asks about slides next spring, the answer is there.`,
                    more: [["Why not delete it?", "The answer is worth keeping: someone will ask again. Only admins can delete an issue, and teams rarely do."]],
                },
                {
                    id: "sync",
                    kind: "act",
                    ghTab: "code",
                    say: (w) => `GitHub's main has both changes; your laptop doesn't yet. Check out main, pull, and delete your old branch, <b>${esc(br(w))}</b>.`,
                    acts: [
                        { label: "Check out main", steps: () => ["git checkout main"], ai: "check out main" },
                        pullAct,
                        { label: "Delete old branch", steps: (w) => [`git branch -D ${br(w)}`], ai: "delete my old summary branch" },
                    ],
                    done: (w) => desk(w)?.branch === "main" && synced(w, "main") && !you(w).branches[br(w)],
                    after: () => `Your laptop matches GitHub: main has one commit per pull request, and the finished branch is gone.`,
                    more: [["Why -D and not -d?", "<code>-d</code> only deletes a branch that's merged. After a squash, main has a new commit with the same change, and git can't tell they match, so <code>-d</code> refuses. <code>-D</code> deletes it anyway."]],
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
                    ghTab: "issues",
                    say: () => `That's how a team works on GitHub, every day:${loopHtml()}Write it down, work on a branch, ask for a review, merge. The issue closes itself, and the next one starts the loop again.`,
                    done: () => false,
                }],
        },
    ],
};
//# sourceMappingURL=github.js.map