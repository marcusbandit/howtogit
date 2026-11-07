/* cli.ts: the git (and gh) command line, on top of model.ts.
 *
 * Every way of acting in the lesson ends up here. Buttons and the pretend AI
 * assistant run the exact same command strings you could type yourself, so
 * the three modes never disagree about what happened.
 */
import * as G from "./model.js";
export function tokenize(line) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(line)))
        out.push(m[1] ?? m[2] ?? m[3]);
    return out;
}
/* flag helper: pulls `-m value` style options out of an argument list */
function take(args, ...names) {
    for (const n of names) {
        const i = args.indexOf(n);
        if (i >= 0) {
            const v = args[i + 1];
            args.splice(i, 2);
            return v;
        }
    }
    return undefined;
}
function flag(args, ...names) {
    let hit = false;
    for (const n of names) {
        const i = args.indexOf(n);
        if (i >= 0) {
            args.splice(i, 1);
            hit = true;
        }
    }
    return hit;
}
function status(w, r, d) {
    const lines = [d.detached ? `HEAD detached at ${G.short(d.detached)}` : `On branch ${d.branch}`];
    const ab = G.aheadBehind(w, r, d);
    if (ab) {
        if (ab.ahead && ab.behind)
            lines.push(`Your branch and '${ab.up}' have diverged.`);
        else if (ab.ahead)
            lines.push(`Your branch is ahead of '${ab.up}' by ${ab.ahead} commit${ab.ahead > 1 ? "s" : ""}.\n  (use "git push" to publish your local commits)`);
        else if (ab.behind)
            lines.push(`Your branch is behind '${ab.up}' by ${ab.behind} commit${ab.behind > 1 ? "s" : ""}.\n  (use "git pull" to update)`);
        else
            lines.push(`Your branch is up to date with '${ab.up}'.`);
    }
    if (!G.headId(r, d))
        lines.push("\nNo commits yet");
    const fs = G.fileStates(w, r, d);
    const staged = fs.filter((f) => f.state === "staged" || f.state === "staged+changed" || f.state === "staged-deleted");
    const changed = fs.filter((f) => f.state === "changed" || f.state === "staged+changed" || f.state === "deleted");
    const fresh = fs.filter((f) => f.state === "new");
    const conf = fs.filter((f) => f.state === "conflict");
    if (conf.length)
        lines.push(`\nYou have unmerged paths.\n  (fix conflicts and run "git commit")\nUnmerged paths:\n${conf.map((f) => `\tboth modified:   ${f.path}`).join("\n")}`);
    const how = (f) => (f.state.includes("deleted") ? "deleted: " : "modified:");
    if (staged.length)
        lines.push(`\nChanges to be committed:\n${staged.map((f) => `\t${how(f)}   ${f.path}`).join("\n")}`);
    if (changed.length)
        lines.push(`\nChanges not staged for commit:\n${changed.map((f) => `\t${how(f)}   ${f.path}`).join("\n")}`);
    if (fresh.length)
        lines.push(`\nUntracked files:\n${fresh.map((f) => `\t${f.path}`).join("\n")}`);
    if (!staged.length && !changed.length && !fresh.length && !conf.length)
        lines.push("\nnothing to commit, working tree clean");
    return lines.join("\n");
}
function log(w, r, d, oneline) {
    const head = G.headId(r, d);
    if (!head)
        throw new G.GitError(`fatal: your current branch '${d.branch}' does not have any commits yet`);
    const ids = [...G.ancestors(w, head)].map((id) => w.commits[id]).sort((a, b) => b.n - a.n);
    const tags = (id) => {
        const t = [];
        if (id === head)
            t.push(d.detached ? "HEAD" : `HEAD -> ${d.branch}`);
        Object.entries(r.branches).forEach(([b, c]) => { if (c === id && b !== d.branch)
            t.push(b); });
        Object.entries(r.tracking).forEach(([b, c]) => { if (c === id)
            t.push(b); });
        return t.length ? ` (${t.join(", ")})` : "";
    };
    return ids.map((c) => oneline
        ? `${G.short(c.id)}${tags(c.id)} ${c.msg}`
        : `commit ${G.short(c.id)}${tags(c.id)}\nAuthor: ${c.author}\n\n    ${c.msg}\n`).join("\n");
}
function diff(w, r, d, staged) {
    const head = G.treeOf(w, G.headId(r, d));
    const [A, B] = staged ? [head, d.index] : [d.index, d.work];
    // like git diff: untracked files (not in the index) never show up
    const files = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((p) => A[p] !== B[p] && (staged || d.index[p] !== undefined));
    return files.map((p) => `--- a/${p}\n+++ b/${p}\n` +
        G.lineDiff(A[p], B[p]).filter((l) => l.t !== " ").map((l) => l.t + l.s).join("\n")).join("\n");
}
export function run(w, ctx, line) {
    const t = tokenize(line.trim());
    if (!t.length)
        return { ok: true, out: "" };
    try {
        if (t[0] === "cd")
            return cd(w, ctx, t[1] ?? "");
        if (t[0] === "clear")
            return { ok: true, out: "\f" };
        if (t[0] === "gh")
            return gh(w, ctx, t.slice(1));
        if (t[0] !== "git") {
            return { ok: false, out: `${t[0]}: command not found. Commands here start with git (or gh, for GitHub).` };
        }
        const sub = t[1];
        const args = t.slice(2);
        if (!sub)
            return { ok: true, out: "usage: git <command>\nTry: git status" };
        if (sub === "clone") {
            const url = args.filter((a) => !a.startsWith("-"))[0];
            if (!url)
                throw new G.GitError("fatal: You must specify a repository to clone.");
            return { ok: true, out: G.cloneTo(w, ctx.repo, ctx.repo === "albert" ? "Albert's computer" : "Your computer", url, "~/my-recipe") };
        }
        if (sub === "init")
            return { ok: true, out: G.init(w) };
        const r = w.repos[ctx.repo];
        if (!r)
            throw new G.GitError("fatal: not a git repository (or any of the parent directories): .git\nSwitch on version history first: git init");
        const d = r.desks[ctx.desk] ?? r.desks[0];
        const author = ctx.author;
        switch (sub) {
            case "status": return { ok: true, out: status(w, r, d) };
            case "add":
                if (!args.length)
                    throw new G.GitError("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?");
                return { ok: true, out: G.add(w, r, d, args) };
            case "commit": {
                const a = [...args];
                const all = flag(a, "-a", "--all");
                const amend = flag(a, "--amend");
                flag(a, "--no-edit");
                let msg = take(a, "-m", "--message");
                if (msg === undefined && amend)
                    return { ok: true, out: G.commit(w, r, d, "", author, all, true) };
                if (msg === undefined) {
                    const am = take(a, "-am");
                    if (am !== undefined)
                        return { ok: true, out: G.commit(w, r, d, am, author, true, amend) };
                    throw new G.GitError("Add a message with -m, like: git commit -m \"what you changed\"");
                }
                return { ok: true, out: G.commit(w, r, d, msg, author, all, amend) };
            }
            case "log": return { ok: true, out: log(w, r, d, args.includes("--oneline")) };
            case "diff": return { ok: true, out: diff(w, r, d, args.includes("--staged") || args.includes("--cached")) };
            case "restore": {
                const a = [...args];
                const staged = flag(a, "--staged", "-S");
                if (!a.length)
                    throw new G.GitError("fatal: you must specify path(s) to restore");
                // "." means every file git knows about; untracked files are left alone
                const files = a.includes(".") ? Object.keys({ ...d.work, ...d.index }).filter((p) => d.index[p] !== undefined || G.treeOf(w, G.headId(r, d))[p] !== undefined) : a;
                files.forEach((p) => G.restore(w, r, d, p, staged));
                return { ok: true, out: "" };
            }
            case "switch": {
                const a = [...args];
                const create = take(a, "-c", "--create");
                if (create)
                    return { ok: true, out: G.switchTo(w, r, d, create, { create: true, start: a[0] }) };
                if (flag(a, "--detach", "-d"))
                    return { ok: true, out: G.switchTo(w, r, d, a[0] ?? "", { detach: true }) };
                if (!a[0])
                    throw new G.GitError("fatal: missing branch name; try: git switch main");
                if (!r.branches[a[0]] && !r.tracking[`origin/${a[0]}`] && G.resolve(w, r, a[0], d))
                    throw new G.GitError(`fatal: a branch is expected, got commit '${a[0]}'\nhint: to look at an old commit use: git switch --detach ${a[0]}`);
                return { ok: true, out: G.switchTo(w, r, d, a[0]) };
            }
            case "checkout": {
                const a = [...args];
                const dd = a.indexOf("--");
                if (dd >= 0) {
                    a.slice(dd + 1).forEach((p) => G.restore(w, r, d, p));
                    return { ok: true, out: "" };
                }
                const create = take(a, "-b");
                if (create)
                    return { ok: true, out: G.switchTo(w, r, d, create, { create: true, start: a[0] }) };
                if (!a[0])
                    throw new G.GitError("fatal: missing branch name");
                if (r.branches[a[0]] || r.tracking[`origin/${a[0]}`])
                    return { ok: true, out: G.switchTo(w, r, d, a[0]) };
                if (G.resolve(w, r, a[0], d))
                    return { ok: true, out: G.switchTo(w, r, d, a[0], { detach: true }) };
                if (d.work[a[0]] !== undefined) {
                    G.restore(w, r, d, a[0]);
                    return { ok: true, out: "" };
                }
                throw new G.GitError(`error: pathspec '${a[0]}' did not match any file(s) known to git`);
            }
            case "branch": {
                const name = args.filter((x) => !x.startsWith("-"))[0];
                const del = args.includes("-D") ? "-D" : args.includes("-d") || args.includes("--delete") ? "-d" : undefined;
                return { ok: true, out: G.branch(w, r, d, name, del) };
            }
            case "remote": {
                if (args[0] === "add") {
                    if (args.length < 3)
                        throw new G.GitError("usage: git remote add <name> <address>");
                    return { ok: true, out: G.remoteAdd(w, r, args[1], args[2]) };
                }
                if (!r.remote)
                    return { ok: true, out: "" };
                if (args[0] === "-v")
                    return { ok: true, out: `${r.remote.name}\t${r.remote.url} (fetch)\n${r.remote.name}\t${r.remote.url} (push)` };
                return { ok: true, out: r.remote.name };
            }
            case "push": {
                const a = [...args];
                const up = flag(a, "-u", "--set-upstream");
                return { ok: true, out: G.push(w, r, d, a[0], a[1], up) };
            }
            case "fetch": return { ok: true, out: G.fetch(w, r) || "(nothing new on GitHub)" };
            case "pull": return { ok: true, out: G.pull(w, r, d, author) };
            case "merge":
                if (!args[0])
                    throw new G.GitError("usage: git merge <branch>");
                return { ok: true, out: G.merge(w, r, d, args[0], author) };
            case "worktree": {
                const a = [...args];
                const op = a.shift();
                if (op === "list")
                    return { ok: true, out: r.desks.map((x) => `${x.path}  ${G.short(G.headId(r, x))} [${x.branch ?? "detached"}]`).join("\n") };
                if (op !== "add")
                    throw new G.GitError("usage: git worktree add <folder> -b <new-branch>");
                const nb = take(a, "-b");
                if (!a[0])
                    throw new G.GitError("usage: git worktree add <folder> -b <new-branch>");
                return { ok: true, out: G.worktreeAdd(w, r, d, a[0], nb, a[1]) };
            }
            case "help":
            case "--help":
                return { ok: true, out: "Commands in this lesson: init, status, add, commit, log, diff, restore, switch, branch, remote, push, pull, fetch, merge, clone, worktree" };
            default:
                return { ok: false, out: `git: '${sub}' is not a git command this lesson knows. See 'git help'.` };
        }
    }
    catch (e) {
        if (e instanceof G.GitError)
            return { ok: false, out: e.message };
        throw e;
    }
}
function cd(w, ctx, to) {
    const r = w.repos[ctx.repo];
    if (!r)
        return { ok: true, out: "" };
    const name = to.replace(/^\.\.\//, "").replace(/^~\//, "").replace(/\/$/, "");
    const i = r.desks.findIndex((d) => d.path.replace(/^~\//, "") === name);
    if (i < 0)
        return { ok: false, out: `cd: no such folder: ${to}` };
    return { ok: true, out: "", desk: i };
}
function gh(w, ctx, t) {
    try {
        if (t[0] !== "pr")
            return { ok: false, out: "This lesson knows gh pr create, gh pr list and gh pr merge." };
        const a = t.slice(2);
        const r = w.repos[ctx.repo];
        const d = r?.desks[ctx.desk] ?? r?.desks[0];
        if (t[1] === "create") {
            const title = take(a, "--title", "-t") ?? (d?.branch ?? "my change");
            const base = take(a, "--base", "-B") ?? "main";
            const head = take(a, "--head", "-H") ?? d?.branch ?? "";
            take(a, "--body", "-b");
            return { ok: true, out: G.prCreate(w, head, base, title, ctx.author) };
        }
        if (t[1] === "merge") {
            const n = Number(a.find((x) => /^#?\d+$/.test(x))?.replace("#", "") ?? w.prs.filter((p) => p.state === "open").at(-1)?.n);
            return { ok: true, out: G.prMerge(w, n, ctx.author) };
        }
        if (t[1] === "list") {
            const open = w.prs.filter((p) => p.state === "open");
            return { ok: true, out: open.map((p) => `#${p.n}  ${p.title}  ${p.head}`).join("\n") || "no open pull requests" };
        }
        return { ok: false, out: "Try: gh pr create --title \"...\"" };
    }
    catch (e) {
        if (e instanceof G.GitError)
            return { ok: false, out: e.message };
        throw e;
    }
}
//# sourceMappingURL=cli.js.map