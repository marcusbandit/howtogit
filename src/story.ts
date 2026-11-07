/* story.ts: the lesson, as data.
 *
 * The story is kept small on purpose: a short report you save, undo and
 * put on GitHub; a friend (Albert) joins, another (Toby) reviews a pull
 * request, you clash on one line, and you fix a typo from a second worktree.
 * Every idea is shown in plain words first; the git word comes after.
 *
 * A beat is one small thing to do. Its `acts` are what the buttons do; the
 * command mode and the AI mode run the very same command strings, and a beat
 * is finished when the world looks right (`done`), however you got there.
 */
import * as G from "./model.js";
import type { World } from "./model.js";

export type Who = "you" | "albert";
export type Step = string | ((w: World) => string | void);

export interface Act {
  label: string;
  steps: (w: World, v: Record<string, string>) => Step[];
  inputs?: { key: string; label: string; def: (w: World) => string }[];
  ai?: string; // what you'd ask an AI assistant to do; "" marks a happening, same in every mode
  who?: Who;
  look?: "github"; // drawn as a GitHub button rather than an app button
  pick?: "commit"; // buttons mode: you pick a commit from the history; its ID arrives as v.id
}

export interface EditTask {
  files: string[];
  ask: (w: World) => string;
  check: (w: World) => boolean;
  canon: (w: World) => void; // what a typical edit looks like, for replay
}

export interface Beat {
  id: string;
  kind: "next" | "act" | "edit" | "watch" | "resolve";
  say: (w: World) => string;
  desk?: number;
  acts?: Act[];
  edit?: EditTask;
  done: (w: World) => boolean;
  after?: (w: World) => string;
  term?: [string, string];
  more?: [string, string][];
  onDone?: (w: World) => void;
  live?: boolean; // done is re-checked after every action (you can wander off and back)
  status?: (w: World) => string; // a short line that changes as you act, in a fixed-height slot
}

export interface Chapter {
  title: string;
  short: string;
  goal: string; // what you can do after this chapter, shown up front and on the finish card
  beats: Beat[];
}

/* ------------------------------------------------------------- helpers */

export const MAIN_FILE = "report.md";
const you = (w: World) => w.repos.you;
const desk = (w: World, i = 0) => w.repos.you?.desks[i];
const head = (w: World, i = 0) => (you(w) ? G.headId(you(w), desk(w, i)) : undefined);
const headTree = (w: World, i = 0) => G.treeOf(w, head(w, i));
const work = (w: World, f: string, i = 0) => desk(w, i)?.work[f] ?? "";
const gh = (w: World) => w.repos.github;
const albert = (w: World) => w.repos.albert;
const br = (w: World) => w.vars.branch || "summary";
const q = (s: string | undefined) => (s ?? "").replace(/"/g, "'").trim() || "update";
const count = (w: World, id: string | undefined) => G.ancestors(w, id).size;
const clean = (w: World, i = 0) => !!you(w) && !G.isDirty(w, you(w), desk(w, i));
const synced = (w: World, b: string) => !!gh(w) && !!you(w)?.branches[b] && gh(w).branches[b] === you(w).branches[b];
const firstCommit = (w: World) => [...G.ancestors(w, you(w).branches.main)].map((id) => w.commits[id]).sort((a, b) => a.n - b.n)[0];
const changed = (w: World, f = MAIN_FILE, i = 0) => work(w, f, i) !== headTree(w, i)[f];

/* put a line into a file right after the first line matching `after` */
function insertAfter(text: string, after: RegExp, line: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => after.test(l));
  lines.splice(i >= 0 ? i + 1 : lines.length - 1, 0, line);
  return lines.join("\n");
}
const setWork = (w: World, f: string, text: string, i = 0) => { desk(w, i).work[f] = text; };
export const keyLine = (s: string) => s.split("\n").find((l) => /deadline/i.test(l)) ?? "";

const commitAct = (def: string, files = "-A"): Act => ({
  label: files === "-A" ? "Stage all and commit" : `Stage ${files} and commit`,
  inputs: [{ key: "msg", label: "Commit message", def: () => def }],
  steps: (_w, v) => [`git add ${files}`, `git commit -m "${q(v.msg)}"`],
  ai: "commit my changes with a short note",
});
const pushAct: Act = { label: "Push", steps: () => ["git push"], ai: "upload my versions to GitHub" };
const pullAct: Act = { label: "Pull", steps: () => ["git pull"], ai: "get the latest changes from GitHub" };

/* ------------------------------------------------------------- chapters */

export const chapters: Chapter[] = [
  {
    title: "Save versions",
    short: "commit",
    goal: "save versions of your work",
    beats: [
      {
        id: "init",
        kind: "act",
        say: () => `This is your project folder: a report and some notes. For now they're plain files.<br><br>To give the folder a version history, you turn it into a <b>repository</b> (<b>repo</b> for short): a folder where git keeps every version of your files.`,
        acts: [{ label: "Create repository", steps: () => ["git init"], ai: "turn this folder into a git repository" }],
        done: (w) => !!you(w),
        after: () => `The folder is a repository now. Both files say <b>new</b>: git can see them, but it hasn't kept a version of them yet.`,
        term: ["repository", "A folder with version history switched on. People say <b>repo</b>."],
        more: [["Do I do this for every project?", "Once per project. Often not even that: you copy an existing project from GitHub instead, which you'll do in chapter 4."]],
      },
      {
        id: "stage-all",
        kind: "act",
        say: () => `A brand new repository starts out as if the folder were empty: git hasn't kept anything yet. So both files count as a change. They're <b>new</b> files.<br><br>Keeping a version takes two moves. First you <b>stage</b> the changes you want in it, like packing a box. Stage both files.`,
        acts: [{ label: "Stage all changes", steps: () => ["git add -A"], ai: "stage all my files" }],
        done: (w) => !!you(w) && Object.keys(desk(w).work).every((f) => desk(w).index[f] === desk(w).work[f]),
        after: () => `Both files say <b>staged</b>. Nothing is kept yet: the box is packed, not taped shut.`,
        term: ["staging", "Choosing what goes into the next version. The command is <code>git add</code>."],
      },
      {
        id: "commit1",
        kind: "act",
        say: () => `Now <b>commit</b>: tape the box shut and keep it as a version.<br><br>Every commit carries a short note saying what changed, called the <b>commit message</b>, so you know later what each version changed.`,
        acts: [{
          label: "Commit",
          inputs: [{ key: "msg", label: "Commit message", def: () => "First version" }],
          steps: (_w, v) => [`git commit -m "${q(v.msg)}"`],
          ai: "commit this as the first version",
        }],
        done: (w) => !!you(w)?.branches.main,
        after: () => `See the dot next to the folder? That's your first version: both files exactly as they are now, with your commit message, your name and the time. The files now say <b>no changes</b>: they match that version.`,
        term: ["commit", "One kept version of the whole project, with a commit message saying what changed. The line of dots is the <b>history</b>."],
        more: [["Does a commit copy every file?", "It works like a full snapshot you can always go back to. Git avoids storing the same content twice, so it stays small."]],
      },
      {
        id: "edit1",
        kind: "edit",
        say: () => `Now change something. Open <b>report.md</b>, fix a word or add a sentence, and press <b>Save file</b>.`,
        edit: {
          files: [MAIN_FILE],
          ask: () => "Fix a word or add a sentence",
          check: (w) => changed(w),
          canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /worked best/i, "It was also the cheapest.")),
        },
        done: (w) => changed(w),
        after: () => `report.md now says <b>changed</b>. Saving the file only changed the file; your version from before is untouched. The preview under the folder shows the <b>diff</b> (short for <i>difference</i>): what's different since that version. Green lines are new, red crossed-out lines are gone.`,
        term: ["diff", "Short for <i>difference</i>: what's different between your files now and the last version. Green was added, red was removed."],
      },
      {
        id: "edit2",
        kind: "edit",
        say: () => `Add a line to <b>notes.txt</b> too.`,
        edit: {
          files: ["notes.txt"],
          ask: () => "Add a line",
          check: (w) => changed(w, "notes.txt") && changed(w),
          canon: (w) => setWork(w, "notes.txt", work(w, "notes.txt") + "- ask about the budget\n"),
        },
        done: (w) => changed(w, "notes.txt") && changed(w),
        after: () => `Both files say <b>changed</b> now.`,
      },
      {
        id: "stage-one",
        kind: "act",
        say: () => `The report is finished, the notes aren't. Stage <b>only report.md</b>.`,
        acts: [{ label: "Stage report.md", steps: () => [`git add ${MAIN_FILE}`], ai: "stage only report.md, not the notes" }],
        done: (w) => {
          const d = desk(w), h = headTree(w);
          return d.index[MAIN_FILE] === d.work[MAIN_FILE] && d.index[MAIN_FILE] !== h[MAIN_FILE] &&
            d.index["notes.txt"] === h["notes.txt"] && d.work["notes.txt"] !== h["notes.txt"];
        },
        after: () => `report.md is <b>staged</b>, notes.txt stays out. That's what staging is for: you choose exactly what goes into each version.`,
      },
      {
        id: "commit2",
        kind: "act",
        say: () => `Commit the staged report change.`,
        acts: [{
          label: "Commit",
          inputs: [{ key: "msg", label: "Commit message", def: () => "Improve the report" }],
          steps: (_w, v) => [`git commit -m "${q(v.msg)}"`],
          ai: "commit the staged report change with a note",
        }],
        done: (w) => count(w, you(w)?.branches.main) >= 2,
        after: () => `Two commits now. notes.txt still says <b>changed</b>: it wasn't staged, so it isn't in that version.`,
      },
    ],
  },

  {
    title: "Undo and look back",
    short: "undo",
    goal: "undo mistakes and open old versions",
    beats: [
      {
        id: "spill",
        kind: "act",
        say: () => `A cat walks across your keyboard.`,
        acts: [{
          label: "Let the cat walk over report.md",
          steps: () => [(w) => { setWork(w, MAIN_FILE, "# Team rep🐾rt\n\nfffffffffff\nWe te🐾ted\n;;;;;;;;;;;;\n"); return "🐾 the cat walked over report.md"; }],
          ai: "",
        }],
        done: (w) => work(w, MAIN_FILE).includes("🐾"),
        after: () => `The report is mostly gone. Open it if you want to see the damage.`,
      },
      {
        id: "restore",
        kind: "act",
        say: () => `Git still has your last version. Throw away what the cat did.`,
        acts: [{ label: "Discard changes to report.md", steps: () => [`git restore ${MAIN_FILE}`], ai: "undo my changes to report.md since the last version" }],
        done: (w) => !work(w, MAIN_FILE).includes("🐾"),
        after: () => `Back exactly as it was in your last version. Changes you haven't committed can be thrown away; versions you committed stay safe.`,
      },
      {
        id: "save-shop",
        kind: "act",
        say: () => `One loose end first. <b>notes.txt</b> still says <b>changed</b>: you left it out of your last commit.<br><br>Stage it and commit it. This button does both moves at once, the way most tools offer it: first it stages notes.txt, then it commits.`,
        acts: [commitAct("Add a note about the budget", "notes.txt")],
        done: (w) => clean(w) && count(w, you(w).branches.main) >= 3,
        after: () => `notes.txt says <b>no changes</b> again, and there are three commits on the line. Under the hood you can see both moves: <code>git add</code>, then <code>git commit</code>.`,
      },
      {
        id: "history",
        kind: "act",
        say: () => `Every commit you made is kept in the <b>history</b>. Have a look at it.`,
        acts: [{ label: "Show history", steps: () => ["git log --oneline"], ai: "show me the history of this project" }],
        done: (w) => w.vars.sawLog === "1",
        after: () => `That's your history: every commit, newest at the top, each with its ID and commit message. It's the same as the line of commits in the picture, read from right to left.`,
        more: [["What's a code like 3fa9c21?", "Every commit gets a unique ID made from its contents. Tools show it so you can point at an exact version."]],
      },
      {
        id: "travel",
        kind: "act",
        say: (w) => `The <b>you are here</b> marker has a git name: <b>HEAD</b>, the commit your files match right now. You can move HEAD to any commit.<br><br>`
          + `To point at one commit, git uses its <b>ID</b>: the short code in front of each commit, like <code>${G.short(firstCommit(w).id)}</code>. It's made from the commit's contents, so no two are alike.<br><br>`
          + `Open your very first commit. Feel free to open the others too.`,
        live: true,
        status: (w) => {
          const d = desk(w);
          if (!d?.detached) return "";
          const c = w.commits[d.detached];
          return c.id === firstCommit(w).id ? `Opened <code>${G.short(c.id)}</code>: your first commit. From now on we'll call the marker <b>HEAD</b>.`
            : `Opened <code>${G.short(c.id)}</code>, "${c.msg.replace(/</g, "&lt;")}". The oldest one is at the bottom.`;
        },
        acts: [{
          label: "Open",
          pick: "commit",
          steps: (w, v) => [`git checkout ${v.id || G.short(firstCommit(w).id)}`],
          ai: "show me the very first version of the report",
        }],
        done: (w) => !!desk(w)?.detached && desk(w).detached === firstCommit(w).id,
        after: (w) => `Your files now match <code>${G.short(firstCommit(w).id)}</code>, your first commit, and HEAD moved there. The newer commits are still on the line: nothing is lost.`,
        term: ["HEAD", "Git's name for <b>you are here</b>: the commit your files match right now."],
      },
      {
        id: "return",
        kind: "act",
        say: () => `Go back to the newest version on the <b>main</b> line.`,
        acts: [{ label: "Check out main", steps: () => ["git checkout main"], ai: "go back to the newest version on main" }],
        done: (w) => desk(w)?.branch === "main" && !desk(w).detached,
        after: () => `Back at the newest commit, and HEAD with it. <b>main</b> is the name of this line of commits. More lines are coming.`,
      },
    ],
  },

  {
    title: "Put it online",
    short: "push",
    goal: "keep a copy on GitHub",
    beats: [
      {
        id: "publish",
        kind: "act",
        say: () => `Everything is on your laptop only. If it breaks, the report is gone, and nobody else can see it.<br><br>Put a copy on GitHub. A copy of your repository somewhere else is called a <b>remote</b>, and sending your versions to it is a <b>push</b>.`,
        acts: [{
          label: "Publish to GitHub",
          steps: () => [`git remote add origin ${G.REPO_URL}`, "git push -u origin main"],
          ai: "put this project on GitHub",
        }],
        done: (w) => synced(w, "main"),
        after: () => `GitHub has the same three versions now. Your laptop is the <b>local</b> copy, GitHub is the <b>remote</b> one. <code>origin</code> is the nickname for its address.`,
        term: ["push", "Upload your saved versions to GitHub."],
        more: [
          ["Is this a backup?", "It works like one, and it's also the shared copy everyone works from. Your laptop and GitHub each hold the full history."],
          ["Do I make the GitHub page first?", "With commands, yes: New repository on github.com. Buttons like Publish in VS Code or GitHub Desktop do it for you."],
        ],
      },
      {
        id: "edit3",
        kind: "edit",
        say: () => `Add a line to <b>report.md</b>: a result, a number, anything.`,
        edit: {
          files: [MAIN_FILE],
          ask: () => "Add a line",
          check: (w) => changed(w),
          canon: (w) => setWork(w, MAIN_FILE, work(w, MAIN_FILE) + "Results: two of three ideas worked.\n"),
        },
        done: (w) => changed(w),
      },
      {
        id: "commit3",
        kind: "act",
        say: () => `Save it as a new version.`,
        acts: [commitAct("Add results")],
        done: (w) => clean(w) && !!gh(w) && you(w).branches.main !== gh(w).branches.main,
        after: () => `GitHub doesn't have this commit. Saving only happens on your laptop. It says <b>1 version not uploaded</b>.`,
      },
      {
        id: "push",
        kind: "act",
        say: () => `Send it up.`,
        acts: [pushAct],
        done: (w) => synced(w, "main"),
        after: () => `The two lines match again. That's the rhythm: save versions as often as you like, push when you want them online.`,
      },
    ],
  },

  {
    title: "Working together",
    short: "clone, pull",
    goal: "work with a friend through GitHub",
    beats: [
      {
        id: "albert-clone",
        kind: "watch",
        say: () => `A friend, Albert, wants to help. He makes a <b>clone</b>: a full copy of the project from GitHub onto his laptop, history and all.`,
        acts: [{ label: "Watch Albert clone it", who: "albert", steps: () => [`git clone ${G.REPO_URL}`] }],
        done: (w) => !!albert(w),
        after: () => `Albert has his clone: the files and every version.`,
        term: ["clone", "Copy a project from GitHub to your computer, history and all. Usually the first git thing anyone does."],
      },
      {
        id: "albert-push",
        kind: "watch",
        say: () => `Albert adds his idea, saves a version and pushes it.`,
        acts: [{
          label: "Watch Albert do it",
          who: "albert",
          steps: () => [
            (w) => { const d = albert(w).desks[0]; d.work[MAIN_FILE] = insertAfter(d.work[MAIN_FILE], /next step/i, "See the chart in the appendix."); return "(Albert edits report.md)"; },
            `git commit -am "Point to the chart"`,
            "git push",
          ],
        }],
        done: (w) => !!gh(w) && w.commits[gh(w).branches.main]?.author === "Albert",
        after: () => `GitHub has Albert's commit. Your laptop doesn't. Nothing on your laptop changes until you ask.`,
      },
      {
        id: "pull",
        kind: "act",
        say: () => `Bring Albert's version down to your laptop. Getting new versions from GitHub is a <b>pull</b>.`,
        acts: [pullAct],
        done: (w) => synced(w, "main") && desk(w).branch === "main",
        after: () => `report.md has Albert's line now, and his commit is on your line with his name on it. <b>Push</b> sends up, <b>pull</b> brings down.`,
        term: ["pull", "Download new versions from GitHub and update your files to match."],
      },
    ],
  },

  {
    title: "Try an idea safely",
    short: "branch",
    goal: "try ideas without breaking main",
    beats: [
      {
        id: "mkbranch",
        kind: "act",
        say: () => `You want to try a summary at the top, but main is the version everyone reads. Don't break it with a half-finished idea.<br><br>Start a <b>branch</b>: a separate line of versions for the experiment.`,
        acts: [{
          label: "New branch",
          inputs: [{ key: "name", label: "Branch name", def: () => "summary" }],
          steps: (_w, v) => [`git checkout -b ${(v.name ?? "").trim().replace(/\s+/g, "-") || "summary"}`],
          ai: "start a new branch for trying a summary",
        }],
        done: (w) => !!desk(w)?.branch && desk(w).branch !== "main",
        onDone: (w) => { w.vars.branch = desk(w).branch!; },
        after: (w) => `<b>${br(w)}</b> sits on the same commit as main. You're on it now, so your next version goes there.`,
        term: ["branch", "A named line of versions. <b>main</b> is the one everyone treats as the real version."],
      },
      {
        id: "edit4",
        kind: "edit",
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
        id: "commit4",
        kind: "act",
        say: (w) => `Save it on ${br(w)}.`,
        acts: [commitAct("Add a summary")],
        done: (w) => clean(w) && you(w).branches[br(w)] !== you(w).branches.main,
        after: () => `Your new commit sits on its own lane. main didn't move.`,
      },
      {
        id: "peek",
        kind: "act",
        say: () => `Peek at main.`,
        acts: [{ label: "Check out main", steps: () => ["git checkout main"], ai: "check out the main branch" }],
        done: (w) => desk(w)?.branch === "main",
        after: () => `No summary! Checking out a branch swaps the files in your folder to match. The experiment waits on its own line.`,
      },
      {
        id: "back",
        kind: "act",
        say: (w) => `Check out ${br(w)} again.`,
        acts: [{ label: "Check out the branch again", steps: (w) => [`git checkout ${br(w)}`], ai: "go back to my summary branch" }],
        done: (w) => desk(w)?.branch === br(w),
        after: () => `The summary is back.`,
      },
    ],
  },

  {
    title: "Ask before it goes in",
    short: "pull request",
    goal: "get your change reviewed and merged",
    beats: [
      {
        id: "pubbranch",
        kind: "act",
        say: (w) => `The summary is ready. Before it goes into main, you want someone to check it. Start by putting <b>${br(w)}</b> on GitHub.`,
        acts: [{ label: "Publish branch", steps: (w) => [`git push -u origin ${br(w)}`], ai: "put my branch on GitHub" }],
        done: (w) => synced(w, br(w)),
        after: (w) => `GitHub has two lines now: main and ${br(w)}.`,
      },
      {
        id: "openpr",
        kind: "act",
        say: () => `Open a <b>pull request</b>: a page on GitHub that says "here's my change, can it go into main?"`,
        acts: [{
          label: "Create pull request",
          look: "github",
          inputs: [{ key: "title", label: "Title", def: () => "Add a summary" }],
          steps: (w, v) => [`gh pr create --title "${q(v.title)}" --base main --head ${br(w)}`],
          ai: "open a pull request for my branch",
        }],
        done: (w) => w.prs.length >= 1,
        after: () => `The pull request shows what changed, line by line, with room to talk about it. This is how nearly every team works: nobody changes main directly.`,
        term: ["pull request (PR)", "A request on GitHub to bring one branch into another. It's a GitHub feature, not part of git."],
      },
      {
        id: "review",
        kind: "watch",
        say: () => `Toby, who also works on the report, gets a notification and reviews it.`,
        acts: [{
          label: "Watch Toby review it",
          ai: "",
          steps: () => [(w) => { w.prs[0].comments.push({ who: "Toby", text: "Nice. Can you mark it as a draft, so nobody quotes it yet?" }); return "(Toby comments on the pull request)"; }],
        }],
        done: (w) => (w.prs[0]?.comments.length ?? 0) >= 1,
        after: () => `Toby's comment is on the pull request. Reviews happen there, before anything reaches main.`,
      },
      {
        id: "draft",
        kind: "edit",
        say: () => `Fair. Add the word <b>draft</b> to the summary in <b>report.md</b>.`,
        edit: {
          files: [MAIN_FILE],
          ask: () => "Mark it as a draft",
          check: (w) => /draft/i.test(work(w, MAIN_FILE)) && changed(w),
          canon: (w) => setWork(w, MAIN_FILE, work(w, MAIN_FILE).replace(/^Summary:/m, "Summary (draft):")),
        },
        done: (w) => /draft/i.test(work(w, MAIN_FILE)) && changed(w),
      },
      {
        id: "pushfix",
        kind: "act",
        say: (w) => `Save and push. No new pull request needed: it follows ${br(w)} and updates itself.`,
        acts: [commitAct("Mark the summary as a draft"), pushAct],
        done: (w) => synced(w, br(w)) && /draft/i.test(G.treeOf(w, gh(w).branches[br(w)])[MAIN_FILE] ?? ""),
        after: () => `The pull request shows the change too.`,
      },
      {
        id: "approve",
        kind: "watch",
        say: () => `Toby takes another look.`,
        acts: [{
          label: "Watch Toby approve it",
          ai: "",
          steps: () => [(w) => { w.prs[0].approved = true; w.prs[0].comments.push({ who: "Toby", text: "Perfect. Approved ✓" }); return "(Toby approves the pull request)"; }],
        }],
        done: (w) => !!w.prs[0]?.approved,
      },
      {
        id: "mergepr",
        kind: "act",
        say: () => `Approved. Press merge: it <b>merges</b> your branch into main.`,
        acts: [{ label: "Merge pull request", look: "github", steps: () => ["gh pr merge 1 --merge"], ai: "merge the approved pull request" }],
        done: (w) => w.prs[0]?.state === "merged",
        after: (w) => `main on GitHub has your summary. A merge commit with two parents joins ${br(w)} back into main.`,
        term: ["merge", "Combine the versions from one branch into another."],
      },
      {
        id: "sync",
        kind: "act",
        say: () => `GitHub changed; your laptop doesn't know yet. Check out main and pull.`,
        acts: [{ label: "Check out main", steps: () => ["git checkout main"], ai: "check out main" }, pullAct],
        done: (w) => desk(w)?.branch === "main" && synced(w, "main"),
        after: () => `Everyone is in sync. That's the loop most people run every day:<br><b>branch</b> → <b>commit</b> → <b>push</b> → <b>pull request</b> → <b>review</b> → <b>merge</b> → <b>pull</b>.`,
      },
    ],
  },

  {
    title: "Same line, two changes",
    short: "conflict",
    goal: "settle a clash between two changes",
    beats: [
      {
        id: "albert-deadline",
        kind: "watch",
        say: () => `Albert hears the deadline moved. He changes the deadline line and pushes straight to main.`,
        acts: [{
          label: "Watch Albert do it",
          who: "albert",
          steps: () => [
            "git pull",
            (w) => { const d = albert(w).desks[0]; d.work[MAIN_FILE] = d.work[MAIN_FILE].replace(keyLine(d.work[MAIN_FILE]), "Deadline: Thursday"); return "(Albert changes the deadline to Thursday)"; },
            `git commit -am "Deadline is Thursday"`,
            "git push",
          ],
        }],
        done: (w) => !!gh(w) && keyLine(G.treeOf(w, gh(w).branches.main)[MAIN_FILE] ?? "") === "Deadline: Thursday",
        after: () => `main on GitHub says Thursday. You haven't pulled, so your laptop still has the old line.`,
      },
      {
        id: "my-deadline",
        kind: "edit",
        say: () => `You heard something else. In <b>report.md</b>, change the deadline to <b>Monday</b>.`,
        edit: {
          files: [MAIN_FILE],
          ask: () => "Change the deadline",
          check: (w) => { const e = keyLine(work(w, MAIN_FILE)); return !!e && e !== keyLine(headTree(w)[MAIN_FILE] ?? "") && e !== "Deadline: Thursday"; },
          canon: (w) => setWork(w, MAIN_FILE, work(w, MAIN_FILE).replace(keyLine(work(w, MAIN_FILE)), "Deadline: Monday")),
        },
        done: (w) => { const e = keyLine(work(w, MAIN_FILE)); return !!e && e !== keyLine(headTree(w)[MAIN_FILE] ?? "") && e !== "Deadline: Thursday"; },
      },
      {
        id: "commit5",
        kind: "act",
        say: () => `Save it.`,
        acts: [commitAct("Deadline is Monday")],
        done: (w) => clean(w) && !G.isAncestor(w, you(w).branches.main, gh(w).branches.main) && you(w).branches.main !== gh(w).branches.main,
      },
      {
        id: "pushfail",
        kind: "act",
        say: () => `Push it.`,
        acts: [pushAct],
        done: (w) => w.vars.rejected === "1",
        after: () => `GitHub refused. It has a version from Albert that you don't, and git never quietly overwrites someone's work. Get his version first.`,
      },
      {
        id: "pullconf",
        kind: "act",
        say: () => `Pull Albert's version.`,
        acts: [pullAct],
        done: (w) => !!desk(w)?.merging,
        after: () => `Git combined what it could. But you both changed the <b>same line</b>, and git won't guess who's right. It's a question for you, not an error.`,
        term: ["merge conflict", "Two changes to the same lines that git can't combine, so a person chooses."],
      },
      {
        id: "resolve",
        kind: "resolve",
        say: () => `Open <b>report.md</b>. Git marked both versions of the line. Pick which one stays.`,
        done: (w) => !G.hasMarkers(work(w, MAIN_FILE)),
        after: () => `The marks are gone and the line says what you chose.`,
        more: [["What are the <<<<<<< lines?", "Git's conflict marks inside the file: your version sits between <<<<<<< and =======, the other between ======= and >>>>>>>. Editors turn them into buttons like the ones you used."]],
      },
      {
        id: "finish",
        kind: "act",
        say: () => `Save the result and push.`,
        acts: [commitAct("Settle the deadline"), pushAct],
        done: (w) => !desk(w)?.merging && synced(w, "main"),
        after: () => `Both changes are in the history, and so is your decision. Albert gets it on his next pull.`,
      },
    ],
  },

  {
    title: "Two desks at once",
    short: "worktree",
    goal: "work on two things without mixing them",
    beats: [
      {
        id: "choc",
        kind: "act",
        say: () => `New idea: a chart. Start a branch for it.`,
        acts: [{ label: "New branch", steps: () => ["git checkout -b chart"], ai: "start a branch called chart" }],
        done: (w) => !!you(w)?.branches.chart,
        after: () => `You're on <b>chart</b>.`,
      },
      {
        id: "choc-edit",
        kind: "edit",
        say: () => `Add a line about the chart to <b>report.md</b>. Don't save it yet; you're not sure.`,
        edit: {
          files: [MAIN_FILE],
          ask: () => "Add a chart idea",
          check: (w) => changed(w),
          canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /next step/i, "Maybe a chart here? (unsure)")),
        },
        done: (w) => desk(w)?.branch === "chart" && changed(w),
        after: () => `Albert messages you: "There's a typo on main, can you fix it right now?"<br><br>Your chart work is half done. Switching now means saving a half idea or throwing it away.`,
      },
      {
        id: "wt",
        kind: "act",
        say: () => `Open a <b>second desk</b> instead: another folder on your laptop, on its own branch, sharing the same history. Git calls it a <b>worktree</b>.`,
        acts: [{ label: "Open a second desk", steps: () => ["git worktree add ../my-report-fix -b fix-typo main"], ai: "give me a separate folder to fix a typo on main without touching my current work" }],
        done: (w) => (you(w)?.desks.length ?? 0) >= 2,
        after: () => `A second folder, <b>my-report-fix</b>, on a new branch fix-typo. The chart work sits untouched on desk one.`,
        term: ["worktree", "An extra folder for the same project, each on its own branch. People and AI coding tools use them to work on several things at once."],
        more: [["Why do AI tools care?", "An AI agent in your folder would trip over your half-done changes. Giving each agent its own worktree lets several work at once, each on its own branch, and you review each as a pull request."]],
      },
      {
        id: "typo",
        kind: "edit",
        desk: 1,
        say: (w) => /helpd\b/.test(G.treeOf(w, head(w, 1))[MAIN_FILE] ?? "")
          ? `On the second desk, open <b>report.md</b> and fix the typo: <b>helpd</b> should be <b>helped</b>.`
          : `You already fixed the typo earlier. On the second desk, open <b>report.md</b> and fix something small.`,
        edit: {
          files: [MAIN_FILE],
          ask: () => "Fix the typo",
          check: (w) => changed(w, MAIN_FILE, 1) && !/helpd\b/.test(work(w, MAIN_FILE, 1)),
          canon: (w) => {
            const t = work(w, MAIN_FILE, 1);
            setWork(w, MAIN_FILE, /helpd\b/.test(t) ? t.replace(/helpd\b/, "helped") : t + "Fry on medium heat.\n", 1);
          },
        },
        done: (w) => changed(w, MAIN_FILE, 1) && !/helpd\b/.test(work(w, MAIN_FILE, 1)),
      },
      {
        id: "fixpush",
        kind: "act",
        desk: 1,
        say: () => `Save it on the second desk and push fix-typo.`,
        acts: [commitAct("Fix typo"), { label: "Publish branch", steps: () => ["git push -u origin fix-typo"], ai: "put the fix-typo branch on GitHub" }],
        done: (w) => synced(w, "fix-typo") && you(w).branches["fix-typo"] !== you(w).branches.main,
        after: () => `The fix is on GitHub, ready for a pull request. Desk one still has the chart work, exactly as you left it.`,
      },
    ],
  },

  {
    title: "You did it",
    short: "recap",
    goal: "",
    beats: [
      {
        id: "end",
        kind: "next",
        say: () => `That's git and GitHub, start to finish.<br><br>The command line, the buttons in VS Code or GitHub Desktop, an AI assistant: they all do these same few things. Now you know what they mean.`,
        done: () => false,
      },
    ],
  },
];

/* what you typed into a step's fields (commit messages, branch names), kept so
 * a step rebuilt later (after a reload, Back or the step bar) uses your words,
 * not the suggestions. Keyed "beatId:actIndex:field". */
export const choices: Record<string, string> = {};
export const choiceKey = (b: Beat, ai: number, key: string) => `${b.id}:${ai}:${key}`;
export function valueFor(b: Beat, ai: number, inp: { key: string; def: (w: World) => string }, w: World): string {
  return choices[choiceKey(b, ai, inp.key)] ?? inp.def(w);
}

/* what the beat looks like when someone "just does it", for replays */
export function autoBeat(b: Beat, w: World, runCmd: (cmd: string, who: Who, deskI: number) => void, note?: (text: string, who: Who) => void): void {
  if (b.kind === "edit") b.edit!.canon(w);
  else if (b.kind === "resolve") {
    const f = work(w, MAIN_FILE);
    setWork(w, MAIN_FILE, f.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n[\s\S]*?>>>>>>> [^\n]*\n/g, "$1"));
  } else if (b.acts) {
    for (const [ai, a] of b.acts.entries()) {
      const v: Record<string, string> = {};
      a.inputs?.forEach((i) => (v[i.key] = valueFor(b, ai, i, w)));
      for (const s of a.steps(w, v)) {
        if (typeof s === "string") runCmd(s, a.who ?? "you", b.desk ?? 0);
        else { const n = s(w); if (n && note) note(n, a.who ?? "you"); }
      }
    }
  }
  b.onDone?.(w);
}
