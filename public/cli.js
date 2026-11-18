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
/* every `-m value` in order, for options git lets you repeat */
function takeAll(args, ...names) {
    const out = [];
    for (let i = 0; i < args.length;) {
        if (names.includes(args[i]) && i + 1 < args.length) {
            out.push(args[i + 1]);
            args.splice(i, 2);
        }
        else
            i++;
    }
    return out;
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
    // after `git rm --cached` the file is both a staged deletion and, unless ignored, untracked
    const fresh = fs.filter((f) => f.state === "new" ||
        (f.state === "staged-deleted" && d.work[f.path] !== undefined && !G.isIgnored(d.work, f.path)));
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
    // the full message, every line indented, as git log prints it
    const body = (msg) => msg.split("\n").map((l) => (l ? `    ${l}` : "")).join("\n");
    return ids.map((c) => oneline
        ? `${G.short(c.id)}${tags(c.id)} ${G.subject(c.msg)}`
        : `commit ${G.short(c.id)}${tags(c.id)}\nAuthor: ${c.author}\n\n${body(c.msg)}\n`).join("\n");
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
            return { ok: true, out: G.cloneTo(w, ctx.repo, ctx.repo === "albert" ? "Albert's computer" : "Your computer", url, "~/my-report") };
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
            case "add": {
                const a = [...args];
                const force = flag(a, "-f", "--force");
                if (!a.length)
                    throw new G.GitError("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?");
                return { ok: true, out: G.add(w, r, d, a, force) };
            }
            case "rm": {
                const a = [...args];
                const cached = flag(a, "--cached");
                const rec = flag(a, "-r");
                const force = flag(a, "-f", "--force");
                flag(a, "--");
                if (!a.length)
                    throw new G.GitError("usage: git rm [--cached] [-r] <file>...");
                return { ok: true, out: G.rm(w, r, d, a, cached, rec, force) };
            }
            case "commit": {
                const a = [...args];
                const all = flag(a, "-a", "--all");
                const amend = flag(a, "--amend");
                flag(a, "--no-edit");
                // each -m is one paragraph: git commit -m "subject" -m "body"
                const ms = takeAll(a, "-m", "--message");
                const am = takeAll(a, "-am");
                const msg = [...am, ...ms].join("\n\n");
                if (!am.length && !ms.length) {
                    if (amend)
                        return { ok: true, out: G.commit(w, r, d, "", author, all, true) };
                    throw new G.GitError("Add a message with -m, like: git commit -m \"what you changed\"");
                }
                return { ok: true, out: G.commit(w, r, d, msg, author, all || am.length > 0, amend) };
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
                return { ok: true, out: "Commands in this lesson: init, status, add, rm, commit, log, diff, restore, switch, branch, remote, push, pull, fetch, merge, clone, worktree" };
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
/* ================================================================== gh
 * GitHub's command line. Output follows gh's own (a terminal, so the
 * human-readable tables, not the tab-separated script output). */
const KNOWS = [
    "  issue      create, list, view, edit, comment, close, reopen",
    "  pr         create, list, view, edit, ready, review, comment, checks, diff, checkout, merge, close, reopen",
    "  label      list, create",
    "  run        list, view",
    "  workflow   list",
    "  ruleset    list, view",
    "  api        repos/you/my-report/rulesets",
].join("\n");
const HELP = `Work seamlessly with GitHub from the command line.\n\nUSAGE\n  gh <command> <subcommand> [flags]\n\nCOMMANDS IN THIS LESSON\n${KNOWS}`;
const AGO = "about 1 minute ago";
const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;
/* gh's flags: --name value, --name=value, -n value, repeated or comma lists */
class Flags {
    constructor(a) {
        this.a = a;
    }
    all(...names) {
        const out = [];
        for (let i = 0; i < this.a.length;) {
            const x = this.a[i];
            const eq = names.find((n) => n.startsWith("--") && x.startsWith(n + "="));
            if (eq) {
                out.push(x.slice(eq.length + 1));
                this.a.splice(i, 1);
                continue;
            }
            if (names.includes(x)) {
                if (i + 1 >= this.a.length)
                    throw new G.GitError(`flag needs an argument: ${x.startsWith("--") ? x : `'${x.slice(1)}' in ${x}`}`);
                out.push(this.a[i + 1]);
                this.a.splice(i, 2);
                continue;
            }
            i++;
        }
        return out;
    }
    one(...names) {
        const v = this.all(...names);
        return v.length ? v[v.length - 1] : undefined;
    }
    list(...names) {
        return this.all(...names).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    }
    bool(...names) {
        let hit = false;
        for (let i = this.a.length - 1; i >= 0; i--)
            if (names.includes(this.a[i])) {
                this.a.splice(i, 1);
                hit = true;
            }
        return hit;
    }
    /* what is left: the positional arguments. Anything else is a flag gh does not have */
    rest() {
        const bad = this.a.find((x) => x.startsWith("-") && x !== "-");
        if (bad)
            throw new G.GitError(bad.startsWith("--") ? `unknown flag: ${bad.split("=")[0]}` : `unknown shorthand flag: '${bad[1]}' in ${bad}`);
        return this.a;
    }
}
function table(header, rows) {
    const all = [header, ...rows];
    const wd = header.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
    return all.map((r) => r.map((x, c) => (c === r.length - 1 ? x : x.padEnd(wd[c]))).join("  ").trimEnd()).join("\n");
}
function listHeader(item, shown, total, filters) {
    if (filters)
        return `Showing ${shown} of ${plural(total, item)} in ${G.FULL_NAME} that ${total === 1 ? "matches" : "match"} your search`;
    return `Showing ${shown} of ${plural(total, `open ${item}`)} in ${G.FULL_NAME}`;
}
/* "#3", "3" or a GitHub link */
function num(x) {
    if (!x)
        return undefined;
    const m = /^#?(\d+)$/.exec(x) ?? /\/(?:issues|pull)\/(\d+)(?:[/#?].*)?$/.exec(x);
    return m ? Number(m[1]) : undefined;
}
function issueNum(x) {
    if (x === undefined)
        throw new G.GitError("accepts 1 arg(s), received 0");
    const n = num(x);
    if (n === undefined)
        throw new G.GitError(`invalid issue format: "${x}"`);
    return n;
}
const deskOf = (w, ctx) => w.repos[ctx.repo]?.desks[ctx.desk] ?? w.repos[ctx.repo]?.desks[0];
/* the pull request a command means: a number, a branch name, or the one for
 * the branch you are on */
function whichPr(w, ctx, arg, lastOpen = false) {
    if (arg) {
        const n = num(arg);
        if (n !== undefined)
            return G.getPr(w, n);
        const p = [...w.prs].reverse().find((x) => x.head === arg);
        if (!p)
            throw new G.GitError(`no pull requests found for branch "${arg}"`);
        return p;
    }
    const d = deskOf(w, ctx);
    const mine = d?.branch ? [...w.prs].reverse().find((x) => x.head === d.branch && x.state === "open") : undefined;
    if (mine)
        return mine;
    const last = lastOpen ? w.prs.filter((x) => x.state === "open").at(-1) : undefined;
    if (last)
        return last;
    if (!d)
        throw new G.GitError("could not determine current branch: not a git repository (or any of the parent directories): .git");
    throw new G.GitError(`no pull requests found for branch "${d.branch ?? "HEAD"}"`);
}
function conversation(entries, all) {
    if (!entries.length)
        return [];
    const sorted = [...entries].sort((a, b) => a.at - b.at);
    const shown = all ? sorted : sorted.slice(-1);
    const hidden = sorted.length - shown.length;
    const out = [];
    // gh draws this rule with long dashes; plain hyphens here
    if (hidden)
        out.push(`-------- Not showing ${plural(hidden, "comment")} --------`, "", "");
    shown.forEach((c, k) => {
        const login = G.loginOf(c.who);
        const status = c.state === "approved" ? " approved" : c.state === "changes_requested" ? " requested changes" : c.state === "commented" ? " commented" : "";
        const role = login === "you" ? "Owner" : "Collaborator";
        out.push(`${login}${status} (${role}) • 1m${k === shown.length - 1 ? " • Newest comment" : ""}`, "");
        out.push(...(c.text ? c.text.split("\n").map((l) => (l ? `  ${l}` : "")) : ["  No body provided"]), "");
        if (c.link)
            out.push(`View the full review: ${c.link}`, "");
    });
    if (hidden)
        out.push("Use --comments to view the full conversation");
    return out;
}
const bodyLines = (body) => (body ? body.split("\n").map((l) => (l ? `  ${l}` : "")) : ["  No description provided"]);
function issueView(i, all) {
    const L = [`${i.title} ${G.FULL_NAME}#${i.n}`,
        `${i.state === "open" ? "Open" : "Closed"} • ${G.loginOf(i.author)} opened ${AGO} • ${plural(i.comments.length, "comment")}`];
    if (i.assignees.length)
        L.push(`Assignees: ${i.assignees.join(", ")}`);
    if (i.labels.length)
        L.push(`Labels: ${i.labels.join(", ")}`);
    L.push("", ...bodyLines(i.body), "");
    L.push(...conversation(i.comments.map((c) => ({ who: c.who, text: c.text, at: c.at ?? 0 })), all));
    L.push(`View this issue on GitHub: ${G.WEB_URL}/issues/${i.n}`);
    return L.join("\n");
}
function checkSummary(cs) {
    if (!cs.length)
        return "No checks";
    const failing = cs.filter((c) => !c.ok).length;
    if (failing)
        return failing === cs.length ? "× All checks failing" : `× ${failing}/${cs.length} checks failing`;
    return "✓ Checks passing";
}
function prView(w, pr, all) {
    const state = pr.state === "open" ? (pr.draft ? "Draft" : "Open") : pr.state === "merged" ? "Merged" : "Closed";
    const base = G.treeOf(w, G.prBase(w, pr) && G.prHead(w, pr) ? mergeBaseOf(w, pr) : undefined);
    const head = G.treeOf(w, G.prHead(w, pr));
    let add = 0, del = 0;
    for (const p of new Set([...Object.keys(base), ...Object.keys(head)])) {
        for (const l of G.lineDiff(base[p], head[p])) {
            if (l.t === "+")
                add++;
            if (l.t === "-")
                del++;
        }
    }
    const L = [`${pr.title} ${G.FULL_NAME}#${pr.n}`,
        `${state} • ${G.loginOf(pr.author)} wants to merge ${plural(G.prCommits(w, pr).length, "commit")} into ${pr.base} from ${pr.head} • ${AGO}`,
        `+${add} -${del} • ${checkSummary(G.prChecks(w, pr.n))}`];
    // reviewers: each one's latest review, then anyone still asked
    const states = new Map();
    for (const r of pr.reviews ?? []) {
        if (r.who === G.loginOf(pr.author))
            continue;
        states.set(r.who, r.state === "approved" ? "Approved" : r.state === "changes_requested" ? "Changes requested" : "Commented");
    }
    for (const r of pr.reviewers ?? [])
        states.set(r, "Requested");
    const rv = [...states].sort((a, b) => Number(a[1] === "Requested") - Number(b[1] === "Requested") || a[0].localeCompare(b[0]));
    if (rv.length)
        L.push(`Reviewers: ${rv.map(([who, s]) => `${who} (${s})`).join(", ")}`);
    if (pr.assignees?.length)
        L.push(`Assignees: ${pr.assignees.join(", ")}`);
    if (pr.labels?.length)
        L.push(`Labels: ${pr.labels.join(", ")}`);
    L.push("", ...bodyLines(pr.body), "");
    const entries = pr.comments.map((c) => ({ who: c.who, text: c.text, at: c.at ?? 0 }));
    // gh leaves out comment-only reviews that have no text of their own
    for (const r of pr.reviews ?? []) {
        if (r.state === "commented" && !r.text)
            continue;
        entries.push({ who: r.who, text: r.text, at: r.at ?? 0, state: r.state, link: `${G.WEB_URL}/pull/${pr.n}#pullrequestreview-${r.id ?? 0}` });
    }
    L.push(...conversation(entries, all));
    L.push(`View this pull request on GitHub: ${G.WEB_URL}/pull/${pr.n}`);
    return L.join("\n");
}
function mergeBaseOf(w, pr) {
    const head = G.ancestors(w, G.prHead(w, pr));
    return [...G.ancestors(w, G.prBase(w, pr))].filter((id) => head.has(id)).sort((a, b) => w.commits[b].n - w.commits[a].n)[0];
}
const mark = (ok, skipped) => (skipped ? "-" : ok ? "✓" : "X");
function runView(w, f) {
    const job = f.one("-j", "--job");
    const logAll = f.bool("--log"), logFailed = f.bool("--log-failed"), verbose = f.bool("-v", "--verbose");
    f.bool("--exit-status");
    const [a] = f.rest();
    const runs = w.runs ?? [];
    let run;
    let sel;
    if (job) {
        run = runs.find((r) => r.jobs.some((j) => String(j.id) === job));
        if (!run)
            throw new G.GitError(`HTTP 404: Not Found (https://api.github.com/repos/${G.FULL_NAME}/actions/jobs/${job})`);
        sel = run.jobs.find((j) => String(j.id) === job);
    }
    else if (a) {
        run = runs.find((r) => String(r.id) === a);
        if (!run)
            throw new G.GitError(`HTTP 404: Not Found (https://api.github.com/repos/${G.FULL_NAME}/actions/runs/${a})`);
    }
    else {
        // gh asks which run in a menu; the newest is first in it
        run = runs.at(-1);
        if (!run)
            throw new G.GitError("found no recent runs");
    }
    const url = `${G.WEB_URL}/actions/runs/${run.id}`;
    if (logAll || logFailed) {
        if (run.error)
            throw new G.GitError("failed to get run log: log not found");
        const out = [];
        for (const j of sel ? [sel] : run.jobs)
            for (const s of j.steps) {
                if (logFailed && (s.ok || s.skipped))
                    continue;
                for (const l of s.log)
                    out.push(`${j.name}\t${s.name}\t${l}`);
            }
        return { ok: true, out: out.join("\n") };
    }
    const failed = !run.ok;
    const L = [`${mark(run.ok)} ${run.branch} ${run.workflow}${run.pr ? ` #${run.pr}` : ""} · ${run.id}`, `Triggered via ${run.event} ${AGO}`, ""];
    if (run.error) {
        L.push("X This run likely failed because of a workflow file issue.", "", `For more information, see: ${url}`);
        return { ok: true, out: L.join("\n") };
    }
    if (!sel)
        L.push("JOBS");
    for (const j of sel ? [sel] : run.jobs) {
        L.push(`${mark(j.ok, j.skipped)} ${j.name} in ${j.secs ?? 0}s (ID ${j.id})`);
        if (sel || verbose || !j.ok)
            for (const s of j.steps)
                L.push(`  ${mark(s.ok, s.skipped)} ${s.name}`);
    }
    const notes = (run.annotations ?? []).filter((n) => !sel || n.job === sel.name);
    if (notes.length) {
        L.push("", "ANNOTATIONS");
        notes.forEach((n, k) => L.push(`X ${n.message}`, `${n.job}: ${n.path}#${n.line}`, ...(k < notes.length - 1 ? [""] : [])));
    }
    if (!sel) {
        if (run.artifacts?.length)
            L.push("", "ARTIFACTS", ...run.artifacts);
        L.push("");
        if (failed)
            L.push(`To see what failed, try: gh run view ${run.id} --log-failed`);
        else if (run.jobs.length === 1)
            L.push(`For more information about the job, try: gh run view --job=${run.jobs[0].id}`);
        else
            L.push("For more information about a job, try: gh run view --job=<job-id>");
    }
    else {
        L.push("", !sel.ok ? `To see the logs for the failed steps, try: gh run view --log-failed --job=${sel.id}` : `To see the full job log, try: gh run view --log --job=${sel.id}`);
    }
    L.push(`View this run on GitHub: ${url}`);
    return { ok: true, out: L.join("\n") };
}
/* Go's %v, which gh ruleset view uses for rule parameters */
function goFmt(v) {
    if (Array.isArray(v))
        return `[${v.map(goFmt).join(" ")}]`;
    if (v && typeof v === "object")
        return `map[${Object.keys(v).sort().map((k) => `${k}:${goFmt(v[k])}`).join(" ")}]`;
    return String(v);
}
function rulesetShow(r) {
    const enf = r.enforcement ?? "active";
    const L = ["", r.name, `ID: ${r.id}`, `Source: ${G.FULL_NAME} (Repository)`,
        `Enforcement: ${enf === "active" ? "Active" : enf === "evaluate" ? "Evaluate Mode (not enforced)" : "Disabled"}`,
        "You can bypass: never", "", "Bypass List", "This ruleset cannot be bypassed", "", "Conditions",
        `- ref_name: [exclude: ${goFmt(r.exclude ?? [])}] [include: ${goFmt(r.include ?? [`refs/heads/${r.branch}`])}]`, "", "Rules"];
    const rules = [...(r.rules ?? [])].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
    if (!rules.length)
        L.push("No rules configured");
    for (const x of rules) {
        const ps = x.parameters ? Object.keys(x.parameters).sort() : [];
        L.push(`- ${x.type}${ps.length ? ": " + ps.map((k) => `[${k}: ${goFmt(x.parameters[k])}]`).join(" ") : ""}`);
    }
    return L.join("\n").replace(/^\n/, "");
}
function api(w, ctx, f) {
    const method = (f.one("-X", "--method") ?? "").toUpperCase();
    const input = f.one("--input");
    const [raw] = f.rest();
    if (!raw)
        throw new G.GitError("accepts 1 arg(s), received 0");
    const path = raw.replace(/^\//, "").replace("{owner}", "you").replace("{repo}", "my-report").replace(/\/$/, "");
    const m = method || (input !== undefined ? "POST" : "GET");
    let body;
    if (input !== undefined) {
        const d = deskOf(w, ctx);
        body = d?.work[input.replace(/^\.\//, "")];
        if (body === undefined)
            throw new G.GitError(`open ${input}: no such file or directory`);
    }
    const notFound = () => {
        throw new G.GitError(`${JSON.stringify({ message: "Not Found", documentation_url: "https://docs.github.com/rest", status: "404" })}\ngh: Not Found (HTTP 404)`);
    };
    if (!w.repos.github)
        notFound();
    const one = /^repos\/you\/my-report\/rulesets\/(\d+)$/.exec(path);
    if (path === "repos/you/my-report/rulesets") {
        if (m === "POST")
            return { ok: true, out: G.rulesetCreate(w, body ?? "") };
        if (m === "GET") {
            const list = (w.rules ?? []).map((r) => {
                const v = G.rulesetView(r);
                return { id: v.id, name: v.name, target: v.target, source_type: v.source_type, source: v.source, enforcement: v.enforcement, _links: v._links };
            });
            return { ok: true, out: JSON.stringify(list, null, 2) };
        }
    }
    else if (one) {
        const id = Number(one[1]);
        const r = (w.rules ?? []).find((x) => x.id === id) ?? notFound();
        if (m === "GET")
            return { ok: true, out: JSON.stringify(G.rulesetView(r), null, 2) };
        if (m === "PUT")
            return { ok: true, out: G.rulesetCreate(w, body ?? "", id) };
        if (m === "DELETE") {
            w.rules = w.rules.filter((x) => x !== r);
            return { ok: true, out: "" };
        }
    }
    return notFound();
}
function gh(w, ctx, t) {
    try {
        const [cmd, sub, ...rest] = t;
        if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h")
            return { ok: true, out: HELP };
        const known = ["issue", "pr", "label", "run", "workflow", "ruleset", "api"];
        if (!known.includes(cmd))
            return { ok: false, out: `unknown command "${cmd}" for "gh"\n\nCommands in this lesson:\n${KNOWS}` };
        const f = new Flags(cmd === "api" ? [sub, ...rest].filter((x) => x !== undefined) : rest);
        // which repository: -R, or the one your folder's remote points at.
        // Toby has no folder, so his gh talks to you/my-report directly.
        const R = cmd === "api" ? undefined : f.one("-R", "--repo");
        if (R !== undefined && R.replace(/^(https:\/\/)?github\.com\//, "").replace(/\.git$/, "") !== G.FULL_NAME)
            throw new G.GitError(`GraphQL: Could not resolve to a Repository with the name '${R}'. (repository)`);
        const local = w.repos[ctx.repo];
        if (R === undefined && local && !local.remote)
            throw new G.GitError("no git remotes found");
        if (cmd === "api")
            return api(w, ctx, f);
        if (!w.repos.github)
            throw new G.GitError(`GraphQL: Could not resolve to a Repository with the name '${G.FULL_NAME}'. (repository)`);
        const me = G.loginOf(ctx.author);
        const who = (xs) => xs.map((x) => (x === "@me" ? me : x));
        const ok = (out) => ({ ok: true, out });
        const unknownSub = (list) => ({ ok: false, out: `${sub ? `unknown command "${sub}" for "gh ${cmd}"` : `gh ${cmd} needs a subcommand`}\n\nThis lesson knows: gh ${cmd} ${list}` });
        if (cmd === "issue") {
            switch (sub) {
                case "create": {
                    const title = f.one("-t", "--title"), body = f.one("-b", "--body") ?? "";
                    const labels = f.list("-l", "--label"), assignees = who(f.list("-a", "--assignee"));
                    f.rest();
                    if (title === undefined)
                        throw new G.GitError("must provide `--title` and `--body` when not running interactively");
                    return ok(`Creating issue in ${G.FULL_NAME}\n\n${G.issueCreate(w, ctx.author, title, body, labels, assignees)}`);
                }
                case "view": {
                    const all = f.bool("-c", "--comments");
                    return ok(issueView(G.getIssue(w, issueNum(f.rest()[0])), all));
                }
                case "list": {
                    const state = (f.one("-s", "--state") ?? "open").toLowerCase();
                    const labels = f.list("-l", "--label"), assignee = f.one("-a", "--assignee"), author = f.one("-A", "--author");
                    const limit = Number(f.one("-L", "--limit") ?? 30);
                    f.rest();
                    if (!["open", "closed", "all"].includes(state))
                        throw new G.GitError(`invalid argument "${state}" for "-s, --state" flag: valid values are {open|closed|all}`);
                    const as = assignee === "@me" ? me : assignee && G.loginOf(assignee), au = author === "@me" ? me : author && G.loginOf(author);
                    const hit = (w.issues ?? []).filter((i) => (state === "all" || i.state === state) &&
                        labels.every((l) => i.labels.some((x) => x.toLowerCase() === l.toLowerCase())) &&
                        (!as || i.assignees.includes(as)) && (!au || G.loginOf(i.author) === au)).sort((a, b) => b.n - a.n);
                    const filters = state !== "open" || labels.length > 0 || !!as || !!au;
                    if (!hit.length)
                        return ok(filters ? `no issues match your search in ${G.FULL_NAME}` : `no open issues in ${G.FULL_NAME}`);
                    const shown = hit.slice(0, limit);
                    return ok(`${listHeader("issue", shown.length, hit.length, filters)}\n\n${table(["ID", "TITLE", "LABELS", "UPDATED"], shown.map((i) => [`#${i.n}`, i.title, i.labels.join(", "), AGO]))}`);
                }
                case "edit": {
                    const ch = {
                        title: f.one("-t", "--title"), body: f.one("-b", "--body"),
                        addLabels: f.list("--add-label"), removeLabels: f.list("--remove-label"),
                        addAssignees: who(f.list("--add-assignee")), removeAssignees: who(f.list("--remove-assignee")),
                    };
                    const ns = f.rest();
                    if (!ns.length)
                        throw new G.GitError("accepts at least 1 arg(s), received 0");
                    if (ch.title === undefined && ch.body === undefined && ![ch.addLabels, ch.removeLabels, ch.addAssignees, ch.removeAssignees].some((x) => x.length))
                        throw new G.GitError("specify properties to edit when not running interactively");
                    return ok(ns.map((x) => G.issueEdit(w, issueNum(x), ch)).join("\n"));
                }
                case "comment": {
                    const body = f.one("-b", "--body");
                    const [x] = f.rest();
                    const n = issueNum(x);
                    if (body === undefined)
                        throw new G.GitError("`--body`, `--body-file` or `--web` required when not running interactively");
                    return ok(G.issueComment(w, n, ctx.author, body));
                }
                case "close": {
                    const reason = f.one("-r", "--reason"), comment = f.one("-c", "--comment");
                    return ok(G.issueClose(w, issueNum(f.rest()[0]), { reason, comment, who: ctx.author }));
                }
                case "reopen": {
                    const comment = f.one("-c", "--comment");
                    return ok(G.issueReopen(w, issueNum(f.rest()[0]), { comment, who: ctx.author }));
                }
                default: return unknownSub("create, list, view, edit, comment, close, reopen");
            }
        }
        if (cmd === "label") {
            switch (sub) {
                case "list": {
                    f.rest();
                    const ls = G.labelsOf(w);
                    if (!ls.length)
                        return ok(`no labels found in ${G.FULL_NAME}`);
                    return ok(`Showing ${ls.length} of ${plural(ls.length, "label")} in ${G.FULL_NAME}\n\n${table(["NAME", "DESCRIPTION", "COLOR"], ls.map((l) => [l.name, l.desc, l.color]))}`);
                }
                case "create": {
                    const color = f.one("-c", "--color"), desc = f.one("-d", "--description") ?? "";
                    const force = f.bool("-f", "--force");
                    const [name] = f.rest();
                    if (!name)
                        throw new G.GitError("accepts 1 arg(s), received 0");
                    return ok(G.labelCreate(w, name, color, desc, force));
                }
                default: return unknownSub("list, create");
            }
        }
        if (cmd === "pr") {
            switch (sub) {
                case "create": {
                    const title = f.one("-t", "--title"), body = f.one("-b", "--body");
                    const base = f.one("-B", "--base") ?? "main", headF = f.one("-H", "--head");
                    const reviewers = who(f.list("-r", "--reviewer")), labels = f.list("-l", "--label"), assignees = who(f.list("-a", "--assignee"));
                    const draft = f.bool("-d", "--draft"), fill = f.bool("-f", "--fill");
                    f.rest();
                    const d = deskOf(w, ctx);
                    const head = headF ?? d?.branch ?? undefined;
                    if (!head)
                        throw new G.GitError("could not determine the current branch: not on any branch");
                    let tt = title, bb = body;
                    if (fill) {
                        const filled = G.fillFrom(w, head, base);
                        tt ?? (tt = filled.title);
                        bb ?? (bb = filled.body);
                    }
                    const url = G.prCreate(w, head, base, tt ?? head, ctx.author, { body: bb, draft, reviewers, labels, assignees });
                    return ok(`Creating ${draft ? "draft " : ""}pull request for ${head} into ${base} in ${G.FULL_NAME}\n\n${url}`);
                }
                case "ready": {
                    const undo = f.bool("--undo");
                    return ok(G.prReady(w, whichPr(w, ctx, f.rest()[0]).n, undo));
                }
                case "edit": {
                    const ch = {
                        title: f.one("-t", "--title"), body: f.one("-b", "--body"),
                        addLabels: f.list("--add-label"), removeLabels: f.list("--remove-label"),
                        addAssignees: who(f.list("--add-assignee")), removeAssignees: who(f.list("--remove-assignee")),
                        addReviewers: who(f.list("--add-reviewer")), removeReviewers: who(f.list("--remove-reviewer")),
                    };
                    const pr = whichPr(w, ctx, f.rest()[0]);
                    if (ch.title === undefined && ch.body === undefined &&
                        ![ch.addLabels, ch.removeLabels, ch.addAssignees, ch.removeAssignees, ch.addReviewers, ch.removeReviewers].some((x) => x.length))
                        throw new G.GitError("specify properties to edit when not running interactively");
                    return ok(G.prEdit(w, pr.n, ch));
                }
                case "view": {
                    const all = f.bool("-c", "--comments");
                    return ok(prView(w, whichPr(w, ctx, f.rest()[0]), all));
                }
                case "list": {
                    const state = (f.one("-s", "--state") ?? "open").toLowerCase();
                    const labels = f.list("-l", "--label"), assignee = f.one("-a", "--assignee"), author = f.one("-A", "--author");
                    const head = f.one("-H", "--head"), base = f.one("-B", "--base"), limit = Number(f.one("-L", "--limit") ?? 30);
                    const draft = f.bool("-d", "--draft");
                    f.rest();
                    if (!["open", "closed", "merged", "all"].includes(state))
                        throw new G.GitError(`invalid argument "${state}" for "-s, --state" flag: valid values are {open|closed|merged|all}`);
                    const as = assignee === "@me" ? me : assignee && G.loginOf(assignee), au = author === "@me" ? me : author && G.loginOf(author);
                    const hit = w.prs.filter((p) => (state === "all" || p.state === state) &&
                        labels.every((l) => (p.labels ?? []).some((x) => x.toLowerCase() === l.toLowerCase())) &&
                        (!as || (p.assignees ?? []).includes(as)) && (!au || G.loginOf(p.author) === au) &&
                        (!head || p.head === head) && (!base || p.base === base) && (!draft || !!p.draft)).sort((a, b) => b.n - a.n);
                    const filters = state !== "open" || labels.length > 0 || !!as || !!au || !!head || !!base || draft;
                    if (!hit.length)
                        return ok(filters ? `no pull requests match your search in ${G.FULL_NAME}` : `no open pull requests in ${G.FULL_NAME}`);
                    const shown = hit.slice(0, limit);
                    return ok(`${listHeader("pull request", shown.length, hit.length, filters)}\n\n${table(["ID", "TITLE", "BRANCH", "CREATED AT"], shown.map((p) => [`#${p.n}`, p.title, p.head, AGO]))}`);
                }
                case "review": {
                    const body = f.one("-b", "--body") ?? "";
                    const ap = f.bool("-a", "--approve"), rc = f.bool("-r", "--request-changes"), cm = f.bool("-c", "--comment");
                    const [x] = f.rest();
                    if (rc && !body)
                        throw new G.GitError("body cannot be blank for request-changes review");
                    if (cm && !body)
                        throw new G.GitError("body cannot be blank for comment review");
                    const k = [ap, rc, cm].filter(Boolean).length;
                    if (!k && !body)
                        throw new G.GitError("--approve, --request-changes, or --comment required when not running interactively");
                    if (!k)
                        throw new G.GitError("--body unsupported without --approve, --request-changes, or --comment");
                    if (k > 1)
                        throw new G.GitError("need exactly one of --approve, --request-changes, or --comment");
                    const pr = whichPr(w, ctx, x);
                    return ok(G.prReview(w, pr.n, me, ap ? "approved" : rc ? "changes_requested" : "commented", body));
                }
                case "comment": {
                    const body = f.one("-b", "--body");
                    const pr = whichPr(w, ctx, f.rest()[0]);
                    if (body === undefined)
                        throw new G.GitError("`--body`, `--body-file` or `--web` required when not running interactively");
                    return ok(G.prComment(w, pr.n, ctx.author, body));
                }
                case "checks": {
                    const required = f.bool("--required");
                    const pr = whichPr(w, ctx, f.rest()[0]);
                    const need = new Set((w.rules ?? []).filter((r) => G.ruleCovers(r, pr.base)).flatMap((r) => r.checks));
                    let cs = G.prChecks(w, pr.n);
                    if (required)
                        cs = cs.filter((c) => need.has(c.name));
                    if (!cs.length)
                        throw new G.GitError(`no ${required ? "required " : ""}checks reported on the '${pr.head}' branch`);
                    const failing = cs.filter((c) => !c.ok).length, skipped = cs.filter((c) => c.skipped).length;
                    const passing = cs.length - failing - skipped;
                    cs.sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name));
                    const out = `${failing ? "Some checks were not successful" : "All checks were successful"}\n` +
                        `0 cancelled, ${failing} failing, ${passing} successful, ${skipped} skipped, and 0 pending checks\n\n` +
                        table(["", "NAME", "DESCRIPTION", "ELAPSED", "URL"], cs.map((c) => [mark(c.ok, c.skipped), `${c.workflow}/${c.name} (${c.event})`, "", `${c.secs}s`, c.url]));
                    // like gh, a failing check makes the command itself fail
                    return { ok: failing === 0, out };
                }
                case "diff": {
                    const pr = whichPr(w, ctx, f.rest()[0]);
                    const base = G.treeOf(w, mergeBaseOf(w, pr)), head = G.treeOf(w, G.prHead(w, pr));
                    const files = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort().filter((p) => base[p] !== head[p]);
                    return ok(files.map((p) => `diff --git a/${p} b/${p}\n--- ${base[p] === undefined ? "/dev/null" : `a/${p}`}\n+++ ${head[p] === undefined ? "/dev/null" : `b/${p}`}\n` +
                        G.lineDiff(base[p], head[p]).map((l) => l.t + l.s).join("\n")).join("\n"));
                }
                case "checkout": {
                    const pr = whichPr(w, ctx, f.rest()[0]);
                    const r = local;
                    const d = deskOf(w, ctx);
                    if (!r || !d)
                        throw new G.GitError("fatal: not a git repository (or any of the parent directories): .git");
                    const fetched = G.fetch(w, r);
                    const sw = d.branch === pr.head ? `Already on '${pr.head}'` : G.switchTo(w, r, d, pr.head);
                    return ok([fetched, sw].filter(Boolean).join("\n"));
                }
                case "merge": {
                    const sq = f.bool("-s", "--squash"), mg = f.bool("-m", "--merge"), rb = f.bool("-r", "--rebase");
                    const subject = f.one("-t", "--subject"), body = f.one("-b", "--body");
                    const del = f.bool("-d", "--delete-branch"), auto = f.bool("--auto"), admin = f.bool("--admin");
                    const pr = whichPr(w, ctx, f.rest()[0], true);
                    if ([sq, mg, rb].filter(Boolean).length > 1)
                        throw new G.GitError("only one of --merge, --rebase, or --squash can be enabled");
                    // auto-merge is a repository setting, and it starts switched off
                    if (auto)
                        throw new G.GitError("GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)");
                    return ok(G.prMerge(w, pr.n, ctx.author, { method: sq ? "squash" : rb ? "rebase" : "merge", deleteBranch: del, subject, body, admin,
                        local: local && R === undefined ? { r: local, d: deskOf(w, ctx) } : undefined }));
                }
                case "close": {
                    const comment = f.one("-c", "--comment");
                    const del = f.bool("-d", "--delete-branch");
                    const pr = whichPr(w, ctx, f.rest()[0]);
                    if (comment && pr.state === "open")
                        G.prComment(w, pr.n, ctx.author, comment);
                    return ok(G.prClose(w, pr.n, del));
                }
                case "reopen": return ok(G.prReopen(w, whichPr(w, ctx, f.rest()[0]).n));
                default: return unknownSub("create, list, view, edit, ready, review, comment, checks, diff, checkout, merge, close, reopen");
            }
        }
        if (cmd === "run") {
            if (sub === "view")
                return runView(w, f);
            if (sub !== "list")
                return unknownSub("list, view");
            const wf = f.one("-w", "--workflow"), br = f.one("-b", "--branch"), ev = f.one("-e", "--event");
            const limit = Number(f.one("-L", "--limit") ?? 20);
            f.rest();
            const runs = (w.runs ?? []).filter((r) => (!wf || r.workflow === wf || r.file.split("/").pop() === wf) &&
                (!br || r.branch === br) && (!ev || r.event === ev)).reverse().slice(0, limit);
            if (!runs.length)
                return ok("no runs found");
            const secs = (r) => Math.max(0, ...r.jobs.map((j) => j.secs ?? 0)) + 2;
            return ok(table(["STATUS", "TITLE", "WORKFLOW", "BRANCH", "EVENT", "ID", "ELAPSED", "AGE"], runs.map((r) => [mark(r.ok), r.title ?? "", r.workflow, r.branch, r.event, String(r.id), `${secs(r)}s`, AGO])));
        }
        if (cmd === "workflow") {
            if (sub !== "list")
                return unknownSub("list");
            f.rest();
            // workflows GitHub knows: files on main, and any that has run
            const tree = G.treeOf(w, w.repos.github.branches.main);
            const files = [...new Set([...G.workflowFiles(tree), ...(w.runs ?? []).map((r) => r.file)])].sort();
            if (!files.length)
                return ok("no workflows found");
            const name = (file) => {
                const text = tree[file];
                if (text !== undefined) {
                    try {
                        return G.readWorkflow(text, file).name;
                    }
                    catch {
                        return file;
                    }
                }
                return (w.runs ?? []).filter((r) => r.file === file).at(-1)?.workflow ?? file;
            };
            return ok(table(["NAME", "STATE", "ID"], files.map((p) => [name(p), "active", String(G.workflowId(p))])));
        }
        if (cmd === "ruleset") {
            const rules = w.rules ?? [];
            if (sub === "list") {
                f.rest();
                if (!rules.length)
                    return ok(`no rulesets found in ${G.FULL_NAME} or its parents`);
                return ok(`Showing ${rules.length} of ${rules.length} rulesets in ${G.FULL_NAME} and its parents\n\n` +
                    table(["ID", "NAME", "SOURCE", "STATUS", "RULES"], rules.map((r) => [String(r.id), r.name, `${G.FULL_NAME} (repo)`, r.enforcement ?? "active", String(r.rules?.length ?? 0)])));
            }
            if (sub === "view") {
                const [x] = f.rest();
                if (x !== undefined && !/^\d+$/.test(x))
                    throw new G.GitError(`invalid value for ruleset ID: ${x} is not an integer`);
                // gh asks which one in a menu when there is no ID; the first is picked here
                const r = x === undefined ? rules[0] : rules.find((y) => String(y.id) === x);
                if (!r)
                    throw new G.GitError(x === undefined ? `no rulesets found in ${G.FULL_NAME} or its parents` : "ruleset not found");
                return ok(rulesetShow(r));
            }
            return unknownSub("list, view");
        }
        return { ok: false, out: HELP };
    }
    catch (e) {
        if (e instanceof G.GitError)
            return { ok: false, out: e.message };
        throw e;
    }
}
//# sourceMappingURL=cli.js.map