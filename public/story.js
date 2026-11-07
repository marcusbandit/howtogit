/* story.ts: the lesson, as data.
 *
 * The story is kept small on purpose: a pancake recipe you save, undo and
 * put on GitHub; a friend (Albert) joins, another (Toby) reviews a pull
 * request, you clash on one line, and you fix a typo from a second worktree.
 * Every idea is shown in plain words first; the git word comes after.
 *
 * A beat is one small thing to do. Its `acts` are what the buttons do; the
 * command mode and the AI mode run the very same command strings, and a beat
 * is finished when the world looks right (`done`), however you got there.
 */
import * as G from "./model.js";
/* ------------------------------------------------------------- helpers */
export const MAIN_FILE = "pancakes.md";
const you = (w) => w.repos.you;
const desk = (w, i = 0) => w.repos.you?.desks[i];
const head = (w, i = 0) => (you(w) ? G.headId(you(w), desk(w, i)) : undefined);
const headTree = (w, i = 0) => G.treeOf(w, head(w, i));
const work = (w, f, i = 0) => desk(w, i)?.work[f] ?? "";
const gh = (w) => w.repos.github;
const albert = (w) => w.repos.albert;
const br = (w) => w.vars.branch || "blueberries";
const q = (s) => (s ?? "").replace(/"/g, "'").trim() || "update";
const count = (w, id) => G.ancestors(w, id).size;
const clean = (w, i = 0) => !!you(w) && !G.isDirty(w, you(w), desk(w, i));
const synced = (w, b) => !!gh(w) && !!you(w)?.branches[b] && gh(w).branches[b] === you(w).branches[b];
const changed = (w, f = MAIN_FILE, i = 0) => work(w, f, i) !== headTree(w, i)[f];
/* put a line into a file right after the first line matching `after` */
function insertAfter(text, after, line) {
    const lines = text.split("\n");
    const i = lines.findIndex((l) => after.test(l));
    lines.splice(i >= 0 ? i + 1 : lines.length - 1, 0, line);
    return lines.join("\n");
}
const setWork = (w, f, text, i = 0) => { desk(w, i).work[f] = text; };
export const eggLine = (s) => s.split("\n").find((l) => /egg/i.test(l)) ?? "";
const commitAct = (def, files = ".") => ({
    label: "Stage and commit",
    inputs: [{ key: "msg", label: "Note for this version", def: () => def }],
    steps: (_w, v) => [`git add ${files}`, `git commit -m "${q(v.msg)}"`],
    ai: "save my changes with a short note",
});
const pushAct = { label: "Push", steps: () => ["git push"], ai: "upload my saved versions to GitHub" };
const pullAct = { label: "Pull", steps: () => ["git pull"], ai: "get the latest changes from GitHub" };
/* ------------------------------------------------------------- chapters */
export const chapters = [
    {
        title: "Why git exists",
        short: "why",
        goal: "",
        beats: [
            {
                id: "mess",
                kind: "next",
                say: () => `You're writing a pancake recipe, and every time you change it you keep a copy, just in case.<br><br>A few weeks in, the folder looks like this. Which file is the newest? What changed between them? If someone else edited one, which do you cook from?`,
                done: () => true,
            },
            {
                id: "promise",
                kind: "next",
                say: () => `<b>Git</b> fixes this. You keep one file, and whenever you like, you tell git: remember this version. Git keeps every version, who made it and why, and can bring any of them back.<br><br><b>GitHub</b> keeps a copy online, so other people can work on the same files from their own computers.<br><br>You'll do every part yourself. About ten minutes, no experience needed.`,
                done: () => true,
            },
        ],
    },
    {
        title: "Save versions",
        short: "commit",
        goal: "save versions of your work",
        beats: [
            {
                id: "init",
                kind: "act",
                say: () => `This is your project folder: a recipe and a shopping list. Right now they're plain files.<br><br>Switch on version history for the folder.`,
                acts: [{ label: "Turn on version history", steps: () => ["git init"], ai: "set up git for this folder" }],
                done: (w) => !!you(w),
                after: () => `Git made a hidden <code>.git</code> folder inside my-recipe. Every version you save will live there. Your files didn't change.`,
                term: ["repository", "A folder with version history switched on. People say <b>repo</b>."],
                more: [["Do I do this for every project?", "Once per project. Often not even that: you copy an existing project from GitHub instead, which you'll do in chapter 5."]],
            },
            {
                id: "edit1",
                kind: "edit",
                say: () => `Open <b>pancakes.md</b> and add an ingredient. A spoon of sugar, maybe.`,
                edit: {
                    files: [MAIN_FILE],
                    ask: () => "Add an ingredient",
                    check: (w) => work(w, MAIN_FILE) !== G.freshWorld().folder[MAIN_FILE],
                    canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /milk/i, "- a spoon of sugar")),
                },
                done: (w) => work(w, MAIN_FILE) !== G.freshWorld().folder[MAIN_FILE],
                after: () => `pancakes.md now says <b>changed</b>. Git noticed, but hasn't stored anything yet.`,
                term: ["working tree", "Your files as they are right now, saved or not."],
            },
            {
                id: "stage-all",
                kind: "act",
                say: () => `Saving takes two moves. First you pick what goes into the version, like packing a box. This first time, pack everything.`,
                acts: [{ label: "Stage all changes", steps: () => ["git add ."], ai: "get all my files ready to save" }],
                done: (w) => !!you(w) && Object.keys(desk(w).work).every((f) => desk(w).index[f] === desk(w).work[f]),
                after: () => `Everything says <b>ready to save</b>. Packed, not taped shut yet.`,
                term: ["staging", "Picking what goes into the next version. The command is <code>git add</code>."],
            },
            {
                id: "commit1",
                kind: "act",
                say: () => `Now tape the box shut: save the version. Add a short note so you'll know later what it was.`,
                acts: [{
                        label: "Commit",
                        inputs: [{ key: "msg", label: "Note for this version", def: () => "First version" }],
                        steps: (_w, v) => [`git commit -m "${q(v.msg)}"`],
                        ai: "save this version with a note saying it's the first one",
                    }],
                done: (w) => !!you(w)?.branches.main,
                after: () => `That dot is your first saved version: every file exactly as it was, plus your note, your name and the time. <b>You are here</b> marks the version your files match.`,
                term: ["commit", "One saved version of the whole project, with a note. The line of dots is the <b>history</b>."],
                more: [["Does a commit copy every file?", "It works like a full snapshot you can always go back to. Git avoids storing the same content twice, so it stays small."]],
            },
            {
                id: "edit2",
                kind: "edit",
                say: () => `Change two files: add a spoon of oil to <b>pancakes.md</b>, and butter to <b>shopping.txt</b>.`,
                edit: {
                    files: [MAIN_FILE, "shopping.txt"],
                    ask: () => "Change both files",
                    check: (w) => [MAIN_FILE, "shopping.txt"].every((f) => changed(w, f)),
                    canon: (w) => {
                        setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /flour/i, "- a spoon of oil"));
                        setWork(w, "shopping.txt", work(w, "shopping.txt") + "butter\n");
                    },
                },
                done: (w) => [MAIN_FILE, "shopping.txt"].every((f) => changed(w, f)),
            },
            {
                id: "stage-one",
                kind: "act",
                say: () => `The recipe is done, the shopping list isn't. Pack <b>only pancakes.md</b>.`,
                acts: [{ label: "Stage pancakes.md", steps: () => [`git add ${MAIN_FILE}`], ai: "get only pancakes.md ready to save, not the shopping list" }],
                done: (w) => {
                    const d = desk(w), h = headTree(w);
                    return d.index[MAIN_FILE] === d.work[MAIN_FILE] && d.index[MAIN_FILE] !== h[MAIN_FILE] &&
                        d.index["shopping.txt"] === h["shopping.txt"] && d.work["shopping.txt"] !== h["shopping.txt"];
                },
                after: () => `pancakes.md is packed. shopping.txt stays out. That's what staging is for: you choose exactly what goes into each version.`,
            },
            {
                id: "commit2",
                kind: "act",
                say: () => `Save the version with just the recipe in it.`,
                acts: [{
                        label: "Commit",
                        inputs: [{ key: "msg", label: "Note for this version", def: () => "Add oil" }],
                        steps: (_w, v) => [`git commit -m "${q(v.msg)}"`],
                        ai: "save the staged recipe change with a note",
                    }],
                done: (w) => count(w, you(w)?.branches.main) >= 2,
                after: () => `Two versions. shopping.txt is still <b>changed</b>: it wasn't packed.`,
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
                        label: "Let the cat walk over pancakes.md",
                        steps: () => [(w) => { setWork(w, MAIN_FILE, "# Panc🐾kes\n\nfffffffffff\n- 2 e🐾gs\n;;;;;;;;;;;;\n"); return "🐾 the cat walked over pancakes.md"; }],
                        ai: "",
                    }],
                done: (w) => work(w, MAIN_FILE).includes("🐾"),
                after: () => `The recipe is mostly gone. Open it if you want to see the damage.`,
            },
            {
                id: "restore",
                kind: "act",
                say: () => `Git still has your last saved version. Throw away what the cat did.`,
                acts: [{ label: "Discard changes to pancakes.md", steps: () => [`git restore ${MAIN_FILE}`], ai: "undo my unsaved changes to pancakes.md" }],
                done: (w) => !work(w, MAIN_FILE).includes("🐾"),
                after: () => `Back exactly as you last saved it. Unsaved changes can be thrown away. Saved versions stay safe.`,
            },
            {
                id: "travel",
                kind: "act",
                say: () => `You can open any older version too. Open the very first one.`,
                acts: [
                    { label: "Show history", steps: () => ["git log --oneline"], ai: "show me the history of this project" },
                    {
                        label: "Open the first version",
                        steps: (w) => [`git switch --detach ${G.short([...G.ancestors(w, you(w).branches.main)].map((id) => w.commits[id]).sort((a, b) => a.n - b.n)[0].id)}`],
                        ai: "show me the very first version of the recipe",
                    },
                ],
                done: (w) => !!desk(w)?.detached && w.commits[desk(w).detached].parents.length === 0,
                after: () => `Your files now match the first version: no oil. <b>You are here</b> moved back a dot. The newer version is still on the line.`,
                term: ["HEAD", "Git's name for <b>you are here</b>: the version your files currently match."],
                more: [["What's a code like 3fa9c21?", "Every version gets a unique ID made from its contents. Tools show it so you can point at an exact version."]],
            },
            {
                id: "return",
                kind: "act",
                say: () => `Go back to the newest version.`,
                acts: [{ label: "Back to main", steps: () => ["git switch main"], ai: "go back to the latest version" }],
                done: (w) => desk(w)?.branch === "main" && !desk(w).detached,
                after: () => `Back at the newest dot. <b>main</b> is the name of this line of versions. More lines are coming.`,
            },
            {
                id: "save-shop",
                kind: "act",
                say: () => `Save the shopping list too, so nothing is left unsaved.`,
                acts: [commitAct("Add butter to the shopping list", "shopping.txt")],
                done: (w) => clean(w) && count(w, you(w).branches.main) >= 3,
                after: () => `Three versions, nothing unsaved.`,
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
                say: () => `Everything is on your laptop only. If it breaks, the recipe is gone, and nobody else can see it.<br><br>Put a copy on GitHub.`,
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
                say: () => `Change something: add a topping to <b>pancakes.md</b>. Maple syrup?`,
                edit: {
                    files: [MAIN_FILE],
                    ask: () => "Add a topping",
                    check: (w) => changed(w),
                    canon: (w) => setWork(w, MAIN_FILE, work(w, MAIN_FILE) + "Serve with maple syrup.\n"),
                },
                done: (w) => changed(w),
            },
            {
                id: "commit3",
                kind: "act",
                say: () => `Save it as a new version.`,
                acts: [commitAct("Serve with maple syrup")],
                done: (w) => clean(w) && !!gh(w) && you(w).branches.main !== gh(w).branches.main,
                after: () => `GitHub doesn't have this dot. Saving only happens on your laptop. It says <b>1 version not uploaded</b>.`,
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
                say: () => `A friend, Albert, wants to help. He copies the project from GitHub onto his laptop.`,
                acts: [{ label: "Watch Albert copy it", who: "albert", steps: () => [`git clone ${G.REPO_URL}`] }],
                done: (w) => !!albert(w),
                after: () => `Albert has the whole project: the files and every version.`,
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
                            (w) => { const d = albert(w).desks[0]; d.work[MAIN_FILE] = insertAfter(d.work[MAIN_FILE], /milk/i, "- 1 tsp vanilla (Albert's idea)"); return "(Albert edits pancakes.md)"; },
                            `git commit -am "Add vanilla"`,
                            "git push",
                        ],
                    }],
                done: (w) => !!gh(w) && w.commits[gh(w).branches.main]?.author === "Albert",
                after: () => `GitHub has Albert's dot. Your laptop doesn't. Nothing on your laptop changes until you ask.`,
            },
            {
                id: "pull",
                kind: "act",
                say: () => `Bring Albert's version down to your laptop.`,
                acts: [pullAct],
                done: (w) => synced(w, "main") && desk(w).branch === "main",
                after: () => `pancakes.md has the vanilla now, and Albert's dot is on your line with his name on it. <b>Push</b> sends up, <b>pull</b> brings down.`,
                term: ["pull", "Download new versions from GitHub and update your files to match."],
            },
        ],
    },
    {
        title: "Try an idea safely",
        short: "branch",
        goal: "try ideas without breaking the main recipe",
        beats: [
            {
                id: "mkbranch",
                kind: "act",
                say: () => `You want to try blueberries, but main is the version everyone cooks from. Don't break it with a half-tested idea.<br><br>Start a <b>branch</b>: a separate line of versions for the experiment.`,
                acts: [{
                        label: "New branch",
                        inputs: [{ key: "name", label: "Branch name", def: () => "blueberries" }],
                        steps: (_w, v) => [`git switch -c ${(v.name ?? "").trim().replace(/\s+/g, "-") || "blueberries"}`],
                        ai: "start a new branch for trying blueberries",
                    }],
                done: (w) => !!desk(w)?.branch && desk(w).branch !== "main",
                onDone: (w) => { w.vars.branch = desk(w).branch; },
                after: (w) => `<b>${br(w)}</b> sits on the same dot as main. You're on it now, so your next version goes there.`,
                term: ["branch", "A named line of versions. <b>main</b> is the one everyone treats as the real recipe."],
            },
            {
                id: "edit4",
                kind: "edit",
                say: () => `Add blueberries to <b>pancakes.md</b>.`,
                edit: {
                    files: [MAIN_FILE],
                    ask: () => "Add blueberries",
                    check: (w) => changed(w),
                    canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /milk/i, "- a handful of blueberries")),
                },
                done: (w) => changed(w),
            },
            {
                id: "commit4",
                kind: "act",
                say: (w) => `Save it on ${br(w)}.`,
                acts: [commitAct("Add blueberries")],
                done: (w) => clean(w) && you(w).branches[br(w)] !== you(w).branches.main,
                after: () => `Your dot sits on its own lane. main didn't move.`,
            },
            {
                id: "peek",
                kind: "act",
                say: () => `Peek at main.`,
                acts: [{ label: "Switch to main", steps: () => ["git switch main"], ai: "switch to the main branch" }],
                done: (w) => desk(w)?.branch === "main",
                after: () => `No blueberries! Switching branches swaps the files in your folder to match. The experiment waits on its own line.`,
            },
            {
                id: "back",
                kind: "act",
                say: (w) => `Switch back to ${br(w)}.`,
                acts: [{ label: "Switch back", steps: (w) => [`git switch ${br(w)}`], ai: "go back to my blueberry branch" }],
                done: (w) => desk(w)?.branch === br(w),
                after: () => `Blueberries are back.`,
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
                say: (w) => `The blueberries are ready. Before they go into main, you want someone to check them. Start by putting <b>${br(w)}</b> on GitHub.`,
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
                        inputs: [{ key: "title", label: "Title", def: () => "Add blueberries" }],
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
                say: () => `Toby, who also works on the recipe, gets a notification and reviews it.`,
                acts: [{
                        label: "Watch Toby review it",
                        ai: "",
                        steps: () => [(w) => { w.prs[0].comments.push({ who: "Toby", text: "Tasty! Add a squeeze of lemon? It makes the berries pop." }); return "(Toby comments on the pull request)"; }],
                    }],
                done: (w) => (w.prs[0]?.comments.length ?? 0) >= 1,
                after: () => `Toby's comment is on the pull request. Reviews happen there, before anything reaches main.`,
            },
            {
                id: "lemon",
                kind: "edit",
                say: () => `Fair. Add a squeeze of lemon to <b>pancakes.md</b>.`,
                edit: {
                    files: [MAIN_FILE],
                    ask: () => "Add lemon",
                    check: (w) => /lemon/i.test(work(w, MAIN_FILE)) && changed(w),
                    canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /blueberr/i, "- a squeeze of lemon")),
                },
                done: (w) => /lemon/i.test(work(w, MAIN_FILE)) && changed(w),
            },
            {
                id: "pushfix",
                kind: "act",
                say: (w) => `Save and push. No new pull request needed: it follows ${br(w)} and updates itself.`,
                acts: [commitAct("Add lemon"), pushAct],
                done: (w) => synced(w, br(w)) && /lemon/i.test(G.treeOf(w, gh(w).branches[br(w)])[MAIN_FILE] ?? ""),
                after: () => `The pull request shows the lemon too.`,
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
                say: () => `Approved. Press merge.`,
                acts: [{ label: "Merge pull request", look: "github", steps: () => ["gh pr merge 1 --merge"], ai: "merge the approved pull request" }],
                done: (w) => w.prs[0]?.state === "merged",
                after: (w) => `main on GitHub has your blueberries. A dot with two parents joins ${br(w)} back into main.`,
                term: ["merge", "Combine the versions from one branch into another."],
            },
            {
                id: "sync",
                kind: "act",
                say: () => `GitHub changed; your laptop doesn't know yet. Switch to main and pull.`,
                acts: [{ label: "Switch to main", steps: () => ["git switch main"], ai: "switch to main" }, pullAct],
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
                id: "albert-eggs",
                kind: "watch",
                say: () => `Albert thinks the batter is too thin. He changes the eggs line and pushes straight to main.`,
                acts: [{
                        label: "Watch Albert do it",
                        who: "albert",
                        steps: () => [
                            "git pull",
                            (w) => { const d = albert(w).desks[0]; d.work[MAIN_FILE] = d.work[MAIN_FILE].replace(eggLine(d.work[MAIN_FILE]), "- 3 eggs"); return "(Albert changes the eggs to 3)"; },
                            `git commit -am "Use 3 eggs"`,
                            "git push",
                        ],
                    }],
                done: (w) => !!gh(w) && eggLine(G.treeOf(w, gh(w).branches.main)[MAIN_FILE] ?? "") === "- 3 eggs",
                after: () => `main on GitHub says 3 eggs. You haven't pulled, so your laptop still has the old line.`,
            },
            {
                id: "my-eggs",
                kind: "edit",
                say: () => `You decide the eggs are wrong too. In <b>pancakes.md</b>, change the eggs line to <b>1 egg</b>.`,
                edit: {
                    files: [MAIN_FILE],
                    ask: () => "Change the eggs line",
                    check: (w) => { const e = eggLine(work(w, MAIN_FILE)); return !!e && e !== eggLine(headTree(w)[MAIN_FILE] ?? "") && e !== "- 3 eggs"; },
                    canon: (w) => setWork(w, MAIN_FILE, work(w, MAIN_FILE).replace(eggLine(work(w, MAIN_FILE)), "- 1 egg")),
                },
                done: (w) => { const e = eggLine(work(w, MAIN_FILE)); return !!e && e !== eggLine(headTree(w)[MAIN_FILE] ?? "") && e !== "- 3 eggs"; },
            },
            {
                id: "commit5",
                kind: "act",
                say: () => `Save it.`,
                acts: [commitAct("Use 1 egg")],
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
                say: () => `Open <b>pancakes.md</b>. Git marked both versions of the line. Pick which one stays.`,
                done: (w) => !G.hasMarkers(work(w, MAIN_FILE)),
                after: () => `The marks are gone and the line says what you chose.`,
                more: [["What are the <<<<<<< lines?", "Git's conflict marks inside the file: your version sits between <<<<<<< and =======, the other between ======= and >>>>>>>. Editors turn them into buttons like the ones you used."]],
            },
            {
                id: "finish",
                kind: "act",
                say: () => `Save the result and push.`,
                acts: [commitAct("Settle the eggs"), pushAct],
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
                say: () => `New idea: chocolate chips. Start a branch for it.`,
                acts: [{ label: "New branch", steps: () => ["git switch -c chocolate"], ai: "start a branch called chocolate" }],
                done: (w) => !!you(w)?.branches.chocolate,
                after: () => `You're on <b>chocolate</b>.`,
            },
            {
                id: "choc-edit",
                kind: "edit",
                say: () => `Add a line for chocolate chips to <b>pancakes.md</b>. Don't save it yet; you're not sure.`,
                edit: {
                    files: [MAIN_FILE],
                    ask: () => "Add chocolate chips",
                    check: (w) => changed(w),
                    canon: (w) => setWork(w, MAIN_FILE, insertAfter(work(w, MAIN_FILE), /milk/i, "- chocolate chips (how many??)")),
                },
                done: (w) => desk(w)?.branch === "chocolate" && changed(w),
                after: () => `Albert messages you: "There's a typo on main, can you fix it right now?"<br><br>Your chocolate work is half done. Switching now means saving a half idea or throwing it away.`,
            },
            {
                id: "wt",
                kind: "act",
                say: () => `Open a <b>second desk</b> instead: another folder on your laptop, on its own branch, sharing the same history.`,
                acts: [{ label: "Open a second desk", steps: () => ["git worktree add ../my-recipe-fix -b fix-typo main"], ai: "give me a separate folder to fix a typo on main without touching my current work" }],
                done: (w) => (you(w)?.desks.length ?? 0) >= 2,
                after: () => `A second folder, <b>my-recipe-fix</b>, on a new branch fix-typo. The chocolate work sits untouched on desk one.`,
                term: ["worktree", "An extra folder for the same project, each on its own branch. People and AI coding tools use them to work on several things at once."],
                more: [["Why do AI tools care?", "An AI agent in your folder would trip over your half-done changes. Giving each agent its own worktree lets several work at once, each on its own branch, and you review each as a pull request."]],
            },
            {
                id: "typo",
                kind: "edit",
                desk: 1,
                say: (w) => /buter\b/.test(G.treeOf(w, head(w, 1))[MAIN_FILE] ?? "")
                    ? `On the second desk, open <b>pancakes.md</b> and fix the typo: <b>buter</b> should be <b>butter</b>.`
                    : `You already fixed the butter typo earlier. On the second desk, open <b>pancakes.md</b> and fix something small.`,
                edit: {
                    files: [MAIN_FILE],
                    ask: () => "Fix the typo",
                    check: (w) => changed(w, MAIN_FILE, 1) && !/buter\b/.test(work(w, MAIN_FILE, 1)),
                    canon: (w) => {
                        const t = work(w, MAIN_FILE, 1);
                        setWork(w, MAIN_FILE, /buter\b/.test(t) ? t.replace(/buter\b/, "butter") : t + "Fry on medium heat.\n", 1);
                    },
                },
                done: (w) => changed(w, MAIN_FILE, 1) && !/buter\b/.test(work(w, MAIN_FILE, 1)),
            },
            {
                id: "fixpush",
                kind: "act",
                desk: 1,
                say: () => `Save it on the second desk and push fix-typo.`,
                acts: [commitAct("Fix typo"), { label: "Publish branch", steps: () => ["git push -u origin fix-typo"], ai: "put the fix-typo branch on GitHub" }],
                done: (w) => synced(w, "fix-typo") && you(w).branches["fix-typo"] !== you(w).branches.main,
                after: () => `The fix is on GitHub, ready for a pull request. Desk one still has the chocolate work, exactly as you left it.`,
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
/* what the beat looks like when someone "just does it", for replays */
export function autoBeat(b, w, runCmd) {
    if (b.kind === "edit")
        b.edit.canon(w);
    else if (b.kind === "resolve") {
        const f = work(w, MAIN_FILE);
        setWork(w, MAIN_FILE, f.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n[\s\S]*?>>>>>>> [^\n]*\n/g, "$1"));
    }
    else if (b.acts) {
        for (const a of b.acts) {
            if (b.id === "travel" && a.label === "Show history")
                continue;
            const v = {};
            a.inputs?.forEach((i) => (v[i.key] = i.def(w)));
            for (const s of a.steps(w, v)) {
                if (typeof s === "string")
                    runCmd(s, a.who ?? "you", b.desk ?? 0);
                else
                    s(w);
            }
        }
    }
    b.onDone?.(w);
}
//# sourceMappingURL=story.js.map