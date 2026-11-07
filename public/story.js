/* story.ts: the lesson, as data.
 *
 * One story: you write down Grandma's pancake recipe, put it online, and work
 * on it with your sister Sam. Every chapter shows the idea in plain words
 * first, lets you do it yourself, and only then names the git word for it.
 *
 * A beat is one small thing to do. Its `acts` are what the buttons do; the
 * command mode and the AI mode run the very same command strings, and a beat
 * is finished when the world looks right (`done`), however you got there.
 */
import * as G from "./model.js";
/* ------------------------------------------------------------- helpers */
const you = (w) => w.repos.you;
const desk = (w, i = 0) => w.repos.you?.desks[i];
const head = (w, i = 0) => (you(w) ? G.headId(you(w), desk(w, i)) : undefined);
const headTree = (w, i = 0) => G.treeOf(w, head(w, i));
const work = (w, f, i = 0) => desk(w, i)?.work[f] ?? "";
const gh = (w) => w.repos.github;
const sam = (w) => w.repos.sam;
const br = (w) => w.vars.branch || "blueberries";
const q = (s) => s.replace(/"/g, "'").trim() || "update";
const count = (w, id) => G.ancestors(w, id).size;
const clean = (w, i = 0) => !!you(w) && !G.isDirty(w, you(w), desk(w, i));
const synced = (w, b) => !!gh(w) && !!you(w)?.branches[b] && gh(w).branches[b] === you(w).branches[b];
/* put a line into recipe.md right after the first line matching `after` */
function insertAfter(text, after, line) {
    const lines = text.split("\n");
    const i = lines.findIndex((l) => after.test(l));
    lines.splice(i >= 0 ? i + 1 : lines.length - 1, 0, line);
    return lines.join("\n");
}
const setWork = (w, f, text, i = 0) => { desk(w, i).work[f] = text; };
const eggLine = (s) => s.split("\n").find((l) => /egg/i.test(l)) ?? "";
const commitAct = (def, files = ".") => ({
    label: "Stage and commit",
    inputs: [{ key: "msg", label: "Note for this version", def: () => def }],
    steps: (_w, v) => [`git add ${files}`, `git commit -m "${q(v.msg)}"`],
    ai: `save my changes with a short note`,
});
const pushAct = { label: "Push", steps: () => ["git push"], ai: "upload my saved versions to GitHub" };
const pullAct = { label: "Pull", steps: () => ["git pull"], ai: "get the latest changes from GitHub" };
/* ------------------------------------------------------------- chapters */
export const chapters = [
    {
        title: "The problem",
        short: "why",
        beats: [
            {
                id: "mess",
                kind: "next",
                say: () => `You're writing down Grandma's pancake recipe. Over a few weeks you change it, and to be safe you keep copies. Maybe your folder looks like the one on the right.<br><br>Which one is the newest? What changed between <i>final</i> and <i>final_REALLY</i>? And if your sister edits her own copy, how do you put the two together?`,
                done: () => true,
            },
            {
                id: "promise",
                kind: "next",
                say: () => `<b>Git</b> fixes this. You keep <b>one</b> recipe file. Whenever you like, you tell git "remember this version", with a short note. Git keeps every version you saved, who saved it and why, and can bring any of them back.<br><br><b>GitHub</b> is a website that keeps a copy of all of that online, so your sister can work on the same recipe from her own computer.<br><br>You'll do all of it yourself in the next few minutes. No experience needed.`,
                done: () => true,
            },
        ],
    },
    {
        title: "Save versions",
        short: "commit",
        beats: [
            {
                id: "init",
                kind: "act",
                say: () => `This is your recipe folder, on your computer. Right now it's just two ordinary files.<br><br>First, switch on version history for this folder.`,
                acts: [{ label: "Turn on version history", steps: () => ["git init"], ai: "set up git for this folder" }],
                done: (w) => !!you(w),
                after: () => `Done. Git added a hidden <code>.git</code> folder inside <b>my-recipe</b>. That's where it will keep every version. Your own files didn't change at all.`,
                term: ["repository", "A folder with version history switched on. People say <b>repo</b> for short."],
                more: [["Do I do this for every project?", "Once per project, at the start. Or you never do it at all, because you copy an existing project from GitHub, which you'll see in chapter 5."]],
            },
            {
                id: "edit1",
                kind: "edit",
                say: () => `Let's change something. Open <b>recipe.md</b> and add an ingredient. A pinch of salt, maybe.`,
                edit: {
                    files: ["recipe.md"],
                    ask: () => "Add an ingredient",
                    check: (w) => work(w, "recipe.md") !== G.freshWorld().folder["recipe.md"],
                    canon: (w) => setWork(w, "recipe.md", insertAfter(work(w, "recipe.md"), /milk/i, "- a pinch of salt")),
                },
                done: (w) => work(w, "recipe.md") !== G.freshWorld().folder["recipe.md"],
                after: () => `The files on your computer are exactly how you left them, saved or not. Git only watches; it hasn't stored anything yet.`,
                term: ["working tree", "Your files as they are right now, in the folder on your computer."],
            },
            {
                id: "stage-all",
                kind: "act",
                say: () => `Before git saves a version, you pick which files go into it. Think of packing a box before you tape it shut.<br><br>This first time, put both files in the box.`,
                acts: [{ label: "Stage all changes", steps: () => ["git add ."], ai: "get all my files ready to save" }],
                done: (w) => !!you(w) && ["recipe.md", "shopping.txt"].every((f) => desk(w).index[f] === desk(w).work[f]),
                after: () => `Both files now say <b>ready to save</b>. Nothing is saved yet. You've only chosen what goes in.`,
                term: ["staging", "Picking what goes into the next saved version. The command is <code>git add</code>."],
            },
            {
                id: "commit1",
                kind: "act",
                say: () => `Now tape the box shut: save this version. Give it a short note, so future you knows what it was.`,
                acts: [{
                        label: "Commit",
                        inputs: [{ key: "msg", label: "Note for this version", def: () => "First version of the recipe" }],
                        steps: (_w, v) => [`git commit -m "${q(v.msg)}"`],
                        ai: "save this version with a note saying it's the first version",
                    }],
                done: (w) => !!you(w)?.branches.main,
                after: () => `A dot appeared on the line next to your folder. That dot is a saved version. It holds both files exactly as they were, your note, your name and the time.<br><br>The <b>you are here</b> marker shows which version your files match right now.`,
                term: ["commit", "One saved version of the whole project, with a note. The line of dots is the project's <b>history</b>."],
                more: [["Does a commit copy every file?", "In effect, yes: each commit is a full snapshot you can go back to. Git is clever about not storing the same content twice, so it stays small."]],
            },
            {
                id: "edit2",
                kind: "edit",
                say: () => `Change both files this time. Add sugar to <b>recipe.md</b>, and add milk to <b>shopping.txt</b>.`,
                edit: {
                    files: ["recipe.md", "shopping.txt"],
                    ask: () => "Change both files",
                    check: (w) => ["recipe.md", "shopping.txt"].every((f) => work(w, f) !== headTree(w)[f]),
                    canon: (w) => {
                        setWork(w, "recipe.md", insertAfter(work(w, "recipe.md"), /flour/i, "- 1 tbsp sugar"));
                        setWork(w, "shopping.txt", work(w, "shopping.txt") + "milk\n");
                    },
                },
                done: (w) => ["recipe.md", "shopping.txt"].every((f) => work(w, f) !== headTree(w)[f]),
                after: () => `Both files say <b>changed</b>: they're different from the last version you saved.`,
            },
            {
                id: "stage-one",
                kind: "act",
                say: () => `The recipe change is finished, but the shopping list isn't. Put <b>only recipe.md</b> in the box and leave the shopping list out for now.`,
                acts: [{ label: "Stage recipe.md", steps: () => ["git add recipe.md"], ai: "get only recipe.md ready to save, not the shopping list" }],
                done: (w) => {
                    const d = desk(w), h = headTree(w);
                    return d.index["recipe.md"] === d.work["recipe.md"] && d.index["recipe.md"] !== h["recipe.md"] &&
                        d.index["shopping.txt"] === h["shopping.txt"] && d.work["shopping.txt"] !== h["shopping.txt"];
                },
                after: () => `recipe.md is <b>ready to save</b>. shopping.txt is still <b>changed</b>, but it stays out of this version. This is the whole reason staging exists: you decide exactly what goes into each version.`,
            },
            {
                id: "commit2",
                kind: "act",
                say: () => `Save the version with just the recipe in it.`,
                acts: [{
                        label: "Commit",
                        inputs: [{ key: "msg", label: "Note for this version", def: () => "Add sugar" }],
                        steps: (_w, v) => [`git commit -m "${q(v.msg)}"`],
                        ai: "save the staged recipe change with a note",
                    }],
                done: (w) => count(w, you(w)?.branches.main) >= 2,
                after: () => `Two dots now, and the marker moved to the newest one. shopping.txt still says <b>changed</b>, because it wasn't in this version.`,
            },
        ],
    },
    {
        title: "Go back in time",
        short: "undo",
        beats: [
            {
                id: "spill",
                kind: "act",
                say: () => `Accidents happen. Spill some coffee on the recipe: it'll scramble the file.`,
                acts: [{
                        label: "Spill coffee on recipe.md",
                        steps: () => [(w) => { setWork(w, "recipe.md", "# Grandma's pa☕☕kes\n\n- 2 e☕s\n☕☕☕☕\n"); return "☕ splash"; }],
                        ai: "",
                    }],
                done: (w) => work(w, "recipe.md").includes("☕"),
                after: () => `Half the recipe is gone. Open it if you dare.`,
            },
            {
                id: "restore",
                kind: "act",
                say: () => `No panic. Git still has the last version you saved. Throw the coffee away.`,
                acts: [{ label: "Discard changes to recipe.md", steps: () => ["git restore recipe.md"], ai: "undo my unsaved changes to recipe.md" }],
                done: (w) => !work(w, "recipe.md").includes("☕"),
                after: () => `recipe.md is back exactly as it was in your last saved version. Changes you haven't saved can be thrown away. Saved versions stay safe.`,
            },
            {
                id: "travel",
                kind: "act",
                say: () => `You can also look at any older version. Open the very first one you saved.`,
                acts: [
                    { label: "Show history", steps: () => ["git log --oneline"], ai: "show me the history of this project" },
                    {
                        label: "Open the first version",
                        steps: (w) => [`git switch --detach ${G.short([...G.ancestors(w, you(w).branches.main)].map((id) => w.commits[id]).sort((a, b) => a.n - b.n)[0].id)}`],
                        ai: "show me the very first version of the recipe",
                    },
                ],
                done: (w) => !!desk(w)?.detached && w.commits[desk(w).detached].parents.length === 0,
                after: () => `Your files now look exactly like the first version: no sugar. The <b>you are here</b> marker moved back to the first dot. The newer version is still there on the line. Nothing is lost.`,
                term: ["HEAD", "Git's name for the <b>you are here</b> marker: the version your files currently match."],
                more: [["What's that code like 3fa9c21?", "Every commit gets a unique ID made from its contents. You rarely type it; tools show it so you can point at an exact version."]],
            },
            {
                id: "return",
                kind: "act",
                say: () => `Go back to the newest version.`,
                acts: [{ label: "Back to main", steps: () => ["git switch main"], ai: "go back to the latest version" }],
                done: (w) => desk(w)?.branch === "main" && !desk(w).detached,
                after: () => `Back at the newest dot. <b>main</b> is the name of that line of versions. You'll meet more lines soon.`,
            },
            {
                id: "save-shop",
                kind: "act",
                say: () => `Before moving on, save the shopping list too.`,
                acts: [commitAct("Add milk to the shopping list", "shopping.txt")],
                done: (w) => clean(w) && count(w, you(w).branches.main) >= 3,
                after: () => `Three versions, and nothing left unsaved.`,
            },
        ],
    },
    {
        title: "Put it online",
        short: "push",
        beats: [
            {
                id: "publish",
                kind: "act",
                say: () => `So far everything lives on your computer only. If your laptop dies, the recipe dies with it, and nobody else can see it.<br><br>Put a copy on GitHub.`,
                acts: [{
                        label: "Publish to GitHub",
                        steps: () => [`git remote add origin ${G.REPO_URL}`, "git push -u origin main"],
                        ai: "put this project on GitHub",
                    }],
                done: (w) => synced(w, "main"),
                after: () => `GitHub now has the same three versions: same dots, same notes, same order.<br><br>Your computer is the <b>local</b> copy. GitHub is the <b>remote</b> copy. <code>origin</code> is just the nickname for its address.`,
                term: ["push", "Upload your saved versions to GitHub."],
                more: [
                    ["Is this a backup?", "It works like one, but it's more: it's the shared copy everyone works from. Your computer and GitHub each have the full history."],
                    ["Do I need to make the GitHub page first?", "With the command line, yes: you click New repository on github.com first. Buttons like Publish in GitHub Desktop or VS Code do that for you."],
                ],
            },
            {
                id: "edit3",
                kind: "edit",
                say: () => `Make another change: add a topping to <b>recipe.md</b>. Maple syrup?`,
                edit: {
                    files: ["recipe.md"],
                    ask: () => "Add a topping",
                    check: (w) => work(w, "recipe.md") !== headTree(w)["recipe.md"],
                    canon: (w) => setWork(w, "recipe.md", work(w, "recipe.md") + "Serve with maple syrup.\n"),
                },
                done: (w) => work(w, "recipe.md") !== headTree(w)["recipe.md"],
            },
            {
                id: "commit3",
                kind: "act",
                say: () => `Save it as a new version.`,
                acts: [commitAct("Serve with maple syrup")],
                done: (w) => clean(w) && !!gh(w) && you(w).branches.main !== gh(w).branches.main,
                after: () => `Look at the GitHub line: it doesn't have your new dot. Saving only ever happens on your own computer. Your computer says it has <b>1 version not uploaded</b>.`,
            },
            {
                id: "push",
                kind: "act",
                say: () => `Send it up.`,
                acts: [pushAct],
                done: (w) => synced(w, "main"),
                after: () => `The two lines match again. That's the rhythm of git: save versions on your computer as often as you like, and push when you want them online.`,
            },
        ],
    },
    {
        title: "A friend joins",
        short: "clone, pull",
        beats: [
            {
                id: "sam-clone",
                kind: "watch",
                say: () => `Your sister Sam wants to help with the recipe. She copies the project from GitHub onto her own computer.`,
                acts: [{ label: "Watch Sam copy it", who: "sam", steps: () => [`git clone ${G.REPO_URL}`] }],
                done: (w) => !!sam(w),
                after: () => `Sam now has the whole project on her computer: the files and the full history, every version.`,
                term: ["clone", "Copy a project from GitHub to your computer, history and all. It's usually the first git thing anyone does."],
            },
            {
                id: "sam-push",
                kind: "watch",
                say: () => `Sam adds her secret ingredient, saves a version and pushes it to GitHub.`,
                acts: [{
                        label: "Watch Sam do it",
                        who: "sam",
                        steps: () => [
                            (w) => { const d = sam(w).desks[0]; d.work["recipe.md"] = insertAfter(d.work["recipe.md"], /milk/i, "- 1 tsp vanilla (Sam's secret)"); return "(Sam edits recipe.md)"; },
                            `git commit -am "Add Sam's secret vanilla"`,
                            "git push",
                        ],
                    }],
                done: (w) => !!gh(w) && w.commits[gh(w).branches.main]?.author === "Sam",
                after: () => `GitHub has Sam's new dot. Your computer doesn't. Nothing on your computer changes until you ask for it.`,
            },
            {
                id: "pull",
                kind: "act",
                say: () => `Bring Sam's work down to your computer.`,
                acts: [pullAct],
                done: (w) => synced(w, "main") && desk(w).branch === "main",
                after: () => `Open recipe.md: the vanilla is there. Sam's dot is on your line too, with her name on it.<br><br><b>Push</b> sends your versions up. <b>Pull</b> brings other people's down.`,
                term: ["pull", "Download new versions from GitHub and update your files to match."],
            },
        ],
    },
    {
        title: "Try an idea safely",
        short: "branch",
        beats: [
            {
                id: "mkbranch",
                kind: "act",
                say: () => `You want to try blueberry pancakes. But Sam is cooking from the main recipe, and you don't want to break it with a half-tested idea.<br><br>Start a <b>branch</b>: a separate line of versions just for this experiment.`,
                acts: [{
                        label: "New branch",
                        inputs: [{ key: "name", label: "Branch name", def: () => "blueberries" }],
                        steps: (_w, v) => [`git switch -c ${v.name.trim().replace(/\s+/g, "-") || "blueberries"}`],
                        ai: "start a new branch for trying blueberries",
                    }],
                done: (w) => !!desk(w)?.branch && desk(w).branch !== "main",
                onDone: (w) => { w.vars.branch = desk(w).branch; },
                after: (w) => `A new label, <b>${br(w)}</b>, sits on the same dot as main. The marker now follows ${br(w)}, so your next saved version goes there.`,
                term: ["branch", "A named line of versions. <b>main</b> is the branch everyone agrees is the real one."],
            },
            {
                id: "edit4",
                kind: "edit",
                say: () => `Add blueberries to <b>recipe.md</b>.`,
                edit: {
                    files: ["recipe.md"],
                    ask: () => "Add blueberries",
                    check: (w) => work(w, "recipe.md") !== headTree(w)["recipe.md"],
                    canon: (w) => setWork(w, "recipe.md", insertAfter(work(w, "recipe.md"), /milk/i, "- a handful of blueberries")),
                },
                done: (w) => work(w, "recipe.md") !== headTree(w)["recipe.md"],
            },
            {
                id: "commit4",
                kind: "act",
                say: (w) => `Save it on ${br(w)}.`,
                acts: [commitAct("Add blueberries")],
                done: (w) => clean(w) && you(w).branches[br(w)] !== you(w).branches.main,
                after: () => `Your new dot sits on its own lane, above main. main didn't move: Sam's recipe is untouched.`,
            },
            {
                id: "peek",
                kind: "act",
                say: () => `Peek at main.`,
                acts: [{ label: "Switch to main", steps: () => ["git switch main"], ai: "switch to the main branch" }],
                done: (w) => desk(w)?.branch === "main",
                after: () => `Open recipe.md: no blueberries! When you switch branches, git changes the files in your folder to match that branch. Your experiment is safe on its own line.`,
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
        title: "Ask to add it",
        short: "pull request",
        beats: [
            {
                id: "pubbranch",
                kind: "act",
                say: (w) => `The blueberries are ready. Before they go into the real recipe, you'd like Sam to check them. Start by putting <b>${br(w)}</b> on GitHub.`,
                acts: [{ label: "Publish branch", steps: (w) => [`git push -u origin ${br(w)}`], ai: "put my branch on GitHub" }],
                done: (w) => synced(w, br(w)),
                after: (w) => `GitHub now has two lines: main and ${br(w)}.`,
            },
            {
                id: "openpr",
                kind: "act",
                say: () => `Now open a <b>pull request</b> on GitHub. It's a page that says: "here's my change, can it go into main?"`,
                acts: [{
                        label: "Create pull request",
                        look: "github",
                        inputs: [{ key: "title", label: "Title", def: () => "Add blueberries" }],
                        steps: (w, v) => [`gh pr create --title "${q(v.title)}" --base main --head ${br(w)}`],
                        ai: "open a pull request for my branch",
                    }],
                done: (w) => w.prs.length >= 1,
                after: () => `The pull request is on GitHub: what changed, line by line, and a place to talk about it.<br><br>This is how almost every team works today. Nobody changes main directly: they open a pull request, someone looks at it, then it goes in.`,
                term: ["pull request (PR)", "A request on GitHub to bring one branch's changes into another. It's a GitHub feature, not part of git itself."],
            },
            {
                id: "review",
                kind: "watch",
                say: () => `Sam gets a notification and reviews your pull request.`,
                acts: [{
                        label: "Watch Sam review it",
                        who: "sam",
                        steps: () => [(w) => { w.prs[0].comments.push({ who: "Sam", text: "Looks tasty! Could you add a squeeze of lemon? It makes berries pop." }); return "(Sam comments on the pull request)"; }],
                    }],
                done: (w) => (w.prs[0]?.comments.length ?? 0) >= 1,
                after: () => `Sam's comment is on the pull request. Reviews happen right there, before anything reaches main.`,
            },
            {
                id: "lemon",
                kind: "edit",
                say: () => `Fair point. Add a squeeze of lemon to <b>recipe.md</b>.`,
                edit: {
                    files: ["recipe.md"],
                    ask: () => "Add lemon",
                    check: (w) => /lemon/i.test(work(w, "recipe.md")) && work(w, "recipe.md") !== headTree(w)["recipe.md"],
                    canon: (w) => setWork(w, "recipe.md", insertAfter(work(w, "recipe.md"), /blueberr/i, "- a squeeze of lemon")),
                },
                done: (w) => /lemon/i.test(work(w, "recipe.md")) && work(w, "recipe.md") !== headTree(w)["recipe.md"],
            },
            {
                id: "pushfix",
                kind: "act",
                say: (w) => `Save it and push. You don't need a new pull request: it follows the ${br(w)} branch and updates by itself.`,
                acts: [commitAct("Add lemon"), pushAct],
                done: (w) => synced(w, br(w)) && /lemon/i.test(G.treeOf(w, gh(w).branches[br(w)])["recipe.md"] ?? ""),
                after: () => `The pull request now shows the lemon too.`,
            },
            {
                id: "approve",
                kind: "watch",
                say: () => `Sam takes another look.`,
                acts: [{
                        label: "Watch Sam approve it",
                        who: "sam",
                        steps: () => [(w) => { w.prs[0].approved = true; w.prs[0].comments.push({ who: "Sam", text: "Perfect. Approved ✓" }); return "(Sam approves the pull request)"; }],
                    }],
                done: (w) => !!w.prs[0]?.approved,
            },
            {
                id: "mergepr",
                kind: "act",
                say: () => `Sam approved. Press merge.`,
                acts: [{ label: "Merge pull request", look: "github", steps: () => ["gh pr merge 1 --merge"], ai: "merge the approved pull request" }],
                done: (w) => w.prs[0]?.state === "merged",
                after: (w) => `On GitHub, main now has your blueberries. A new dot with two parents joins the ${br(w)} line back into main.`,
                term: ["merge", "Combine the versions from one branch into another."],
            },
            {
                id: "sync",
                kind: "act",
                say: () => `GitHub changed, but your computer doesn't know yet. Switch to main and pull.`,
                acts: [{ label: "Switch to main", steps: () => ["git switch main"], ai: "switch to main" }, pullAct],
                done: (w) => desk(w)?.branch === "main" && synced(w, "main"),
                after: () => `Everyone is in sync. That's the full loop most people use every day:<br><b>branch</b> → <b>commit</b> → <b>push</b> → <b>pull request</b> → <b>review</b> → <b>merge</b> → <b>pull</b>.`,
            },
        ],
    },
    {
        title: "Same line, two changes",
        short: "conflict",
        beats: [
            {
                id: "sam-eggs",
                kind: "watch",
                say: () => `Sam thinks the batter is too thin. She changes the eggs line and pushes straight to main.`,
                acts: [{
                        label: "Watch Sam do it",
                        who: "sam",
                        steps: () => [
                            "git pull",
                            (w) => { const d = sam(w).desks[0]; d.work["recipe.md"] = d.work["recipe.md"].replace(eggLine(d.work["recipe.md"]), "- 3 eggs"); return "(Sam changes the eggs to 3)"; },
                            `git commit -am "Use 3 eggs"`,
                            "git push",
                        ],
                    }],
                done: (w) => !!gh(w) && eggLine(G.treeOf(w, gh(w).branches.main)["recipe.md"] ?? "") === "- 3 eggs",
                after: () => `GitHub's main now says 3 eggs. You haven't pulled, so your computer still says the old amount.`,
            },
            {
                id: "my-eggs",
                kind: "edit",
                say: () => `Meanwhile you, not knowing, decide the eggs are wrong too. In <b>recipe.md</b>, change the eggs line to <b>1 egg</b>.`,
                edit: {
                    files: ["recipe.md"],
                    ask: () => "Change the eggs line",
                    check: (w) => { const e = eggLine(work(w, "recipe.md")); return !!e && e !== eggLine(headTree(w)["recipe.md"] ?? "") && e !== "- 3 eggs"; },
                    canon: (w) => setWork(w, "recipe.md", work(w, "recipe.md").replace(eggLine(work(w, "recipe.md")), "- 1 egg")),
                },
                done: (w) => { const e = eggLine(work(w, "recipe.md")); return !!e && e !== eggLine(headTree(w)["recipe.md"] ?? "") && e !== "- 3 eggs"; },
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
                say: () => `Now try to push.`,
                acts: [pushAct],
                done: (w) => w.vars.rejected === "1",
                after: () => `GitHub said no. It has a version from Sam that you don't have, and git will never quietly overwrite someone else's work. You need Sam's version first.`,
            },
            {
                id: "pullconf",
                kind: "act",
                say: () => `Pull Sam's version.`,
                acts: [pullAct],
                done: (w) => !!desk(w)?.merging,
                after: () => `Git combined everything it could on its own. But you and Sam changed the <b>same line</b> differently, and git won't guess who's right. That's a <b>conflict</b>. It isn't an error, just a question for you.`,
                term: ["merge conflict", "Two changes to the same lines that git can't combine by itself, so it asks a person to choose."],
            },
            {
                id: "resolve",
                kind: "resolve",
                say: () => `Open <b>recipe.md</b>. Git marked both versions of the line inside the file. Pick which one stays.`,
                done: (w) => !G.hasMarkers(work(w, "recipe.md")),
                after: () => `The marks are gone and the line says what you chose.`,
                more: [["What do the <<<<<<< lines mean?", "That's how git marks a conflict inside the file: your version is between <<<<<<< and =======, the other version between ======= and >>>>>>>. Editors turn them into buttons like the ones you just used."]],
            },
            {
                id: "finish",
                kind: "act",
                say: () => `Save the result and push.`,
                acts: [commitAct("Settle the eggs"), pushAct],
                done: (w) => !desk(w)?.merging && synced(w, "main"),
                after: () => `Done. Both of your changes are in the history, and so is your decision. Sam will get it next time she pulls.`,
            },
        ],
    },
    {
        title: "Two desks at once",
        short: "worktree",
        beats: [
            {
                id: "choc",
                kind: "act",
                say: () => `You start a new idea, chocolate chips, on a new branch.`,
                acts: [{ label: "New branch", steps: () => ["git switch -c chocolate"], ai: "start a branch called chocolate" }],
                done: (w) => !!you(w)?.branches.chocolate,
                after: () => `You're on <b>chocolate</b> now.`,
            },
            {
                id: "choc-edit",
                kind: "edit",
                say: () => `Add a line for chocolate chips to <b>recipe.md</b>. Don't save a version: you're not sure about it yet.`,
                edit: {
                    files: ["recipe.md"],
                    ask: () => "Add chocolate chips",
                    check: (w) => work(w, "recipe.md") !== headTree(w)["recipe.md"],
                    canon: (w) => setWork(w, "recipe.md", insertAfter(work(w, "recipe.md"), /milk/i, "- chocolate chips (how many??)")),
                },
                done: (w) => desk(w)?.branch === "chocolate" && work(w, "recipe.md") !== headTree(w)["recipe.md"],
                after: () => `Right then Sam calls: "There's a typo in the recipe on main. Can you fix it right now?"<br><br>Your chocolate work is half done and not saved. Switching branches now would mean saving a half idea or throwing it away.`,
            },
            {
                id: "wt",
                kind: "act",
                say: () => `There's a better way: open a <b>second desk</b>. It's a second folder on your computer with its own branch, sharing the same history.`,
                acts: [{ label: "Open a second desk", steps: () => ["git worktree add ../my-recipe-fix -b fix-typo main"], ai: "give me a separate folder to fix a typo on main without touching my current work" }],
                done: (w) => (you(w)?.desks.length ?? 0) >= 2,
                after: () => `A second folder, <b>my-recipe-fix</b>, appeared on your computer, on a new branch called fix-typo. The chocolate mess sits untouched on desk one.`,
                term: ["worktree", "An extra folder for the same project, each on its own branch. People and AI coding tools use them to work on several things at once."],
                more: [["Why do AI tools care?", "An AI agent working in your folder would trip over your half-done changes. Giving each agent its own worktree lets several of them work in parallel, each on its own branch, and you review each one as a pull request."]],
            },
            {
                id: "typo",
                kind: "edit",
                desk: 1,
                say: (w) => /buter\b/.test(G.treeOf(w, head(w, 1))["recipe.md"] ?? "")
                    ? `On the second desk, open <b>recipe.md</b> and fix the typo: <b>buter</b> should be <b>butter</b>.`
                    : `You already fixed the butter typo earlier! On the second desk, open <b>recipe.md</b> and fix something else small.`,
                edit: {
                    files: ["recipe.md"],
                    ask: () => "Fix the typo",
                    check: (w) => work(w, "recipe.md", 1) !== headTree(w, 1)["recipe.md"] && !/buter\b/.test(work(w, "recipe.md", 1)),
                    canon: (w) => {
                        const t = work(w, "recipe.md", 1);
                        setWork(w, "recipe.md", /buter\b/.test(t) ? t.replace(/buter\b/, "butter") : t + "Fry on medium heat.\n", 1);
                    },
                },
                done: (w) => work(w, "recipe.md", 1) !== headTree(w, 1)["recipe.md"] && !/buter\b/.test(work(w, "recipe.md", 1)),
            },
            {
                id: "fixpush",
                kind: "act",
                desk: 1,
                say: () => `Save it on the second desk and push the fix-typo branch.`,
                acts: [commitAct("Fix typo"), { label: "Publish branch", steps: () => ["git push -u origin fix-typo"], ai: "put the fix-typo branch on GitHub" }],
                done: (w) => synced(w, "fix-typo") && you(w).branches["fix-typo"] !== you(w).branches.main,
                after: () => `The fix is on GitHub, ready for a pull request like before. And your chocolate work never moved: desk one still has it, half done, exactly as you left it.`,
            },
        ],
    },
    {
        title: "You did it",
        short: "recap",
        beats: [
            {
                id: "end",
                kind: "next",
                say: () => `That's how git and GitHub work, start to finish.<br><br>Every tool you'll meet, the command line, the buttons in VS Code or GitHub Desktop, or an AI assistant, is doing these same few things for you. Now you know what they mean.`,
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
        const f = work(w, "recipe.md");
        setWork(w, "recipe.md", f.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n[\s\S]*?>>>>>>> [^\n]*\n/g, "$1"));
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