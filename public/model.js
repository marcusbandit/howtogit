/* model.ts: a small, faithful git, plus the GitHub around it.
 *
 * The lesson needs three repositories that talk to each other (your computer,
 * GitHub, Albert's computer), pull requests, conflicts and worktrees. The
 * GitHub tracks add issues, labels, reviews, Actions runs and branch rules,
 * in the second half of this file. Everything
 * here behaves the way real git does for the commands the lesson covers:
 * commits are immutable snapshots with parents, branches are names pointing at
 * commits, the index (staging area) sits between your files and the next
 * commit, push refuses to overwrite work you don't have, and merges are
 * three-way with real conflict markers.
 *
 * The whole world is plain JSON so it can be saved, restored and replayed.
 */
export class GitError extends Error {
}
export const REPO_URL = "https://github.com/you/my-report.git";
export const urlOk = (u) => /^(https:\/\/)?github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/i.test(u) ||
    /^git@github\.com:[\w.-]+\/[\w.-]+?(\.git)?$/i.test(u);
export function freshWorld() {
    return {
        commits: {},
        repos: {},
        folder: {
            "report.md": "# Team report\n\nWe tested three ideas this month.\nThe second one worked best.\nNext step: try it with real users.\n\nDeadline: Friday\nThanks to everyone who helpd.\n",
            "notes.txt": "rough notes\n- check the numbers\n",
        },
        prs: [],
        counter: 0,
        vars: { branch: "summary" },
    };
}
export const clone = (x) => JSON.parse(JSON.stringify(x));
/* ---------------------------------------------------------------- basics */
function hash(s) {
    // FNV-1a as 7 hex chars: stable per content, short like the ids git shows
    let a = 0x811c9dc5;
    for (let i = 0; i < s.length; i++)
        a = Math.imul(a ^ s.charCodeAt(i), 0x01000193);
    return (a >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}
export const short = (id) => (id ? id.slice(0, 7) : "");
export function headId(r, d) {
    return d.detached ?? (d.branch ? r.branches[d.branch] : undefined);
}
export function treeOf(w, id) {
    return id ? w.commits[id].tree : {};
}
export function ancestors(w, id) {
    const seen = new Set();
    const stack = id ? [id] : [];
    while (stack.length) {
        const c = stack.pop();
        if (seen.has(c))
            continue;
        seen.add(c);
        stack.push(...w.commits[c].parents);
    }
    return seen;
}
export const isAncestor = (w, a, b) => !!a && !!b && ancestors(w, b).has(a);
function mergeBase(w, a, b) {
    const A = ancestors(w, a);
    let best;
    for (const id of ancestors(w, b)) {
        if (A.has(id) && (!best || w.commits[id].n > best.n))
            best = w.commits[id];
    }
    return best?.id;
}
const paths = (...fs) => [...new Set(fs.flatMap((f) => Object.keys(f)))].sort();
export const hasMarkers = (s) => !!s && /^<<<<<<< /m.test(s) && /^>>>>>>> /m.test(s);
function globRe(glob) {
    let s = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*" && glob[i + 1] === "*") {
            i++;
            if (glob[i + 1] === "/") {
                i++;
                s += "(?:.*/)?";
            }
            else
                s += ".*";
        }
        else if (c === "*")
            s += "[^/]*";
        else if (c === "?")
            s += "[^/]";
        else
            s += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${s}$`);
}
function ignoreRules(text) {
    if (!text)
        return [];
    const out = [];
    for (let line of text.split("\n")) {
        line = line.replace(/\s+$/, "");
        if (!line || line.startsWith("#"))
            continue;
        const neg = line.startsWith("!");
        if (neg)
            line = line.slice(1);
        const dirOnly = line.endsWith("/");
        if (dirOnly)
            line = line.replace(/\/+$/, "");
        const anchored = line.includes("/");
        line = line.replace(/^\//, "");
        if (line)
            out.push({ re: globRe(line), neg, dirOnly, anchored });
    }
    return out;
}
/* would git ignore this path if it were untracked? (reads .gitignore from the
 * same files, the way git reads it from your folder) */
export function isIgnored(work, path, isDir = false) {
    const rules = ignoreRules(work[".gitignore"]);
    if (!rules.length)
        return false;
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join("/");
        const dir = i < parts.length || isDir;
        let hit = false;
        for (const r of rules) {
            if (r.dirOnly && !dir)
                continue;
            if (r.re.test(r.anchored ? sub : parts[i - 1]))
                hit = !r.neg;
        }
        // a folder that is ignored hides everything in it; ! cannot bring a file back
        if (hit && dir)
            return true;
        if (i === parts.length)
            return hit;
    }
    return false;
}
/* untracked and ignored: git status and git add . leave it out */
const hidden = (d, p) => d.index[p] === undefined && d.work[p] !== undefined && isIgnored(d.work, p);
/* the plain-words state of each file in a desk */
export function fileStates(w, r, d) {
    const head = treeOf(w, headId(r, d));
    return paths(d.work, d.index, head).filter((p) => !(head[p] === undefined && hidden(d, p))).map((p) => {
        const wk = d.work[p], ix = d.index[p], hd = head[p];
        let state = "saved";
        if (d.merging?.unmerged.includes(p))
            state = "conflict";
        else if (wk === undefined)
            state = ix === undefined && hd !== undefined ? "staged-deleted" : "deleted";
        // git rm --cached: the next commit drops it, the file stays in your folder
        else if (ix === undefined && hd !== undefined)
            state = "staged-deleted";
        else if (ix === undefined && hd === undefined)
            state = "new";
        else if (ix !== hd && wk !== ix)
            state = "staged+changed";
        else if (ix !== hd)
            state = "staged";
        else if (wk !== ix)
            state = "changed";
        return { path: p, state };
    });
}
export const isDirty = (w, r, d) => fileStates(w, r, d).some((f) => f.state !== "saved");
/* how many commits each side has that the other doesn't (by what we last heard) */
export function aheadBehind(w, r, d) {
    const up = d.branch ? r.upstream[d.branch] : undefined;
    const mine = headId(r, d);
    const theirs = up ? r.tracking[up] : undefined;
    if (!up || !mine)
        return null;
    const A = ancestors(w, mine), B = ancestors(w, theirs);
    let ahead = 0, behind = 0;
    A.forEach((id) => { if (!B.has(id))
        ahead++; });
    B.forEach((id) => { if (!A.has(id))
        behind++; });
    return { up, ahead, behind };
}
/* --------------------------------------------------------- line merging */
function lcs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push([i, j]);
            i++;
            j++;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1])
            i++;
        else
            j++;
    }
    return out;
}
const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
/* diff3: merge two edits of the same base, line by line */
export function merge3(base, ours, theirs, labels) {
    const split = (s) => (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");
    const o = split(base), a = split(ours), b = split(theirs);
    const ma = new Map(lcs(o, a)), mb = new Map(lcs(o, b));
    const out = [];
    let conflict = false;
    let i = 0, j = 0, k = 0;
    const chunk = (oc, ac, bc) => {
        if (eq(ac, bc))
            out.push(...ac);
        else if (eq(oc, ac))
            out.push(...bc);
        else if (eq(oc, bc))
            out.push(...ac);
        else {
            // lines both sides changed the same way stay outside the markers, as in git
            let pre = 0, post = 0;
            while (pre < ac.length && pre < bc.length && ac[pre] === bc[pre])
                pre++;
            while (post < ac.length - pre && post < bc.length - pre && ac[ac.length - 1 - post] === bc[bc.length - 1 - post])
                post++;
            conflict = true;
            out.push(...ac.slice(0, pre), `<<<<<<< ${labels[0]}`, ...ac.slice(pre, ac.length - post), "=======", ...bc.slice(pre, bc.length - post), `>>>>>>> ${labels[1]}`, ...ac.slice(ac.length - post));
        }
    };
    for (;;) {
        let i2 = i;
        while (i2 < o.length && !(ma.has(i2) && mb.has(i2) && ma.get(i2) >= j && mb.get(i2) >= k))
            i2++;
        if (i2 >= o.length) {
            chunk(o.slice(i), a.slice(j), b.slice(k));
            break;
        }
        const j2 = ma.get(i2), k2 = mb.get(i2);
        if (i2 === i && j2 === j && k2 === k) {
            out.push(o[i]);
            i++;
            j++;
            k++;
            continue;
        }
        chunk(o.slice(i, i2), a.slice(j, j2), b.slice(k, k2));
        i = i2;
        j = j2;
        k = k2;
    }
    return { text: out.join("\n") + "\n", conflict };
}
function mergeTrees(w, baseId, ours, theirs, labels) {
    const B = treeOf(w, baseId), O = treeOf(w, ours), T = treeOf(w, theirs);
    const tree = {};
    const conflicts = [];
    for (const p of paths(B, O, T)) {
        const b = B[p], o = O[p], t = T[p];
        let v;
        if (o === t)
            v = o;
        else if (b === o)
            v = t;
        else if (b === t)
            v = o;
        else if (o !== undefined && t !== undefined) {
            const m = merge3(b ?? "", o, t, labels);
            v = m.text;
            if (m.conflict)
                conflicts.push(p);
        }
        else {
            v = o ?? t;
            conflicts.push(p);
        }
        if (v !== undefined)
            tree[p] = v;
    }
    return { tree, conflicts };
}
/* ------------------------------------------------------------ commands */
function newCommit(w, msg, parents, tree, author) {
    w.counter++;
    let id = hash(JSON.stringify([msg, parents, tree, author, w.counter]));
    for (let salt = 1; w.commits[id]; salt++)
        id = hash(JSON.stringify([msg, parents, tree, author, w.counter, salt]));
    w.commits[id] = { id, msg, parents, tree: { ...tree }, author, n: w.counter };
    return id;
}
export function init(w) {
    if (w.repos.you)
        return "Reinitialized existing Git repository in ~/my-report/.git/";
    w.repos.you = {
        id: "you", label: "Your computer", bare: false, branches: {},
        desks: [{ path: "~/my-report", branch: "main", detached: null, work: { ...(w.folder ?? {}) }, index: {}, merging: null }],
        remote: null, tracking: {}, upstream: {},
    };
    w.folder = null;
    return "Initialized empty Git repository in ~/my-report/.git/";
}
export function add(_w, _r, d, specs, force = false) {
    const all = specs.some((s) => s === "." || s === "-A" || s === "--all");
    const known = paths(d.work, d.index);
    const ignored = [];
    let targets = [];
    if (all)
        targets = known.filter((p) => force || !hidden(d, p));
    else
        for (const s of specs) {
            const p = s.replace(/^\.\//, "").replace(/\/+$/, "");
            if (d.work[p] !== undefined || d.index[p] !== undefined) {
                // naming an ignored file outright: git refuses it and says why
                if (hidden(d, p) && !force)
                    ignored.push(p);
                else
                    targets.push(p);
                continue;
            }
            const inside = known.filter((x) => x.startsWith(p + "/"));
            if (!inside.length)
                throw new GitError(`fatal: pathspec '${s}' did not match any files`);
            if (!force && inside.every((x) => d.index[x] === undefined) && isIgnored(d.work, p, true)) {
                ignored.push(p);
                continue;
            }
            targets.push(...inside.filter((x) => force || !hidden(d, x)));
        }
    for (const p of targets) {
        if (d.work[p] === undefined)
            delete d.index[p];
        else
            d.index[p] = d.work[p];
        if (d.merging)
            d.merging.unmerged = d.merging.unmerged.filter((x) => x !== p);
    }
    if (ignored.length)
        throw new GitError(`The following paths are ignored by one of your .gitignore files:\n${ignored.join("\n")}\nhint: Use -f if you really want to add them.\nhint: Disable this message with "git config set advice.addIgnoredFile false"`);
    return "";
}
/* git rm: stop tracking files. --cached keeps them in your folder */
export function rm(w, r, d, specs, cached = false, recursive = false, force = false) {
    const head = treeOf(w, headId(r, d));
    const files = [];
    for (const s of specs) {
        const p = s.replace(/^\.\//, "").replace(/\/+$/, "");
        if (d.index[p] !== undefined) {
            files.push(p);
            continue;
        }
        const inside = Object.keys(d.index).filter((x) => x.startsWith(p + "/")).sort();
        if (!inside.length)
            throw new GitError(`fatal: pathspec '${s}' did not match any files`);
        if (!recursive)
            throw new GitError(`fatal: not removing '${p}' recursively without -r`);
        files.push(...inside);
    }
    if (!force)
        for (const p of files) {
            const ix = d.index[p], wk = d.work[p], hd = head[p];
            if (cached && ix !== hd && ix !== wk)
                throw new GitError(`error: the following file has staged content different from both the\nfile and the HEAD:\n    ${p}\n(use -f to force removal)`);
            if (!cached && ix !== hd)
                throw new GitError(`error: the following file has changes staged in the index:\n    ${p}\n(use --cached to keep the file, or -f to force removal)`);
            if (!cached && wk !== undefined && wk !== ix)
                throw new GitError(`error: the following file has local modifications:\n    ${p}\n(use --cached to keep the file, or -f to force removal)`);
        }
    for (const p of files) {
        delete d.index[p];
        if (!cached)
            delete d.work[p];
    }
    return files.map((p) => `rm '${p}'`).join("\n");
}
export function commit(w, r, d, msg, author, all = false, amend = false) {
    if (!msg.trim() && !amend)
        throw new GitError("Aborting commit due to empty commit message.");
    if (all)
        for (const p of Object.keys(d.index)) {
            if (d.work[p] === undefined)
                delete d.index[p];
            else
                d.index[p] = d.work[p];
            if (d.merging)
                d.merging.unmerged = d.merging.unmerged.filter((x) => x !== p);
        }
    // like real git: files still marked as conflicted block the commit until you `git add` them
    if (d.merging?.unmerged.length)
        throw new GitError(`error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, then use 'git add <file>'.\nU\t${d.merging.unmerged.join("\nU\t")}`);
    const head = headId(r, d);
    if (amend) {
        if (!head)
            throw new GitError("fatal: You have nothing to amend.");
        if (d.merging)
            throw new GitError("fatal: You are in the middle of a merge -- cannot amend.");
        const old = w.commits[head];
        const id = newCommit(w, msg.trim() || old.msg, old.parents, d.index, author);
        if (d.detached)
            d.detached = id;
        else
            r.branches[d.branch] = id;
        return `[${d.branch ?? "detached HEAD"} ${short(id)}] ${subject(w.commits[id].msg)}\n (replaced ${short(head)})`;
    }
    const headTree = treeOf(w, head);
    const same = paths(d.index, headTree).every((p) => d.index[p] === headTree[p]);
    if (same && !d.merging) {
        const dirty = paths(d.work, d.index).some((p) => d.work[p] !== d.index[p]);
        throw new GitError(dirty
            ? `On branch ${d.branch ?? "(detached)"}\nno changes added to commit (use "git add" first)`
            : `On branch ${d.branch ?? "(detached)"}\nnothing to commit, working tree clean`);
    }
    const parents = head ? [head] : [];
    if (d.merging)
        parents.push(d.merging.theirs);
    const id = newCommit(w, msg, parents, d.index, author);
    if (d.detached)
        d.detached = id;
    else
        r.branches[d.branch] = id;
    const changed = paths(d.index, headTree).filter((p) => d.index[p] !== headTree[p]).length;
    d.merging = null;
    return `[${d.branch ?? "detached HEAD"}${head ? "" : " (root-commit)"} ${short(id)}] ${subject(msg)}\n ${changed} file${changed === 1 ? "" : "s"} changed`;
}
export function restore(w, r, d, p, staged = false) {
    const head = treeOf(w, headId(r, d));
    if (staged) {
        if (head[p] === undefined)
            delete d.index[p];
        else
            d.index[p] = head[p];
        return "";
    }
    if (d.index[p] === undefined && d.work[p] === undefined)
        throw new GitError(`error: pathspec '${p}' did not match any file(s) known to git`);
    if (d.index[p] === undefined)
        throw new GitError(`error: '${p}' was never saved, so there is nothing to go back to`);
    d.work[p] = d.index[p];
    return "";
}
/* move a desk onto another commit, keeping uncommitted edits git can carry */
function moveDesk(w, r, d, target) {
    const from = treeOf(w, headId(r, d)), to = treeOf(w, target);
    const dirty = paths(d.work, d.index, from).filter((p) => d.work[p] !== from[p] || d.index[p] !== from[p]);
    const blocked = dirty.filter((p) => from[p] !== to[p]);
    if (blocked.length)
        throw new GitError(`error: Your local changes to the following files would be overwritten:\n\t${blocked.join("\n\t")}\nPlease commit your changes or throw them away before you switch.`);
    const work = { ...to }, index = { ...to };
    for (const p of dirty) {
        if (d.work[p] === undefined)
            delete work[p];
        else
            work[p] = d.work[p];
        if (d.index[p] === undefined)
            delete index[p];
        else
            index[p] = d.index[p];
    }
    d.work = work;
    d.index = index;
}
function deskUsing(r, branch, except) {
    return r.desks.find((x) => x !== except && x.branch === branch && !x.detached);
}
export function switchTo(w, r, d, name, opts = {}) {
    if (d.merging)
        throw new GitError("error: you need to finish the merge first (fix the conflict, then commit).");
    if (opts.detach) {
        const id = resolve(w, r, name, d);
        if (!id)
            throw new GitError(`fatal: invalid reference: ${name}`);
        moveDesk(w, r, d, id);
        d.detached = id;
        d.branch = null;
        return `HEAD is now at ${short(id)} ${subject(w.commits[id].msg)}\nYou are looking at an old version. Switch back to a branch to keep working.`;
    }
    if (opts.create) {
        if (r.branches[name])
            throw new GitError(`fatal: a branch named '${name}' already exists`);
        const at = opts.start ? resolve(w, r, opts.start, d) : headId(r, d);
        if (!at)
            throw new GitError("fatal: you need at least one commit before you can make a branch");
        if (!/^[\w./-]+$/.test(name))
            throw new GitError(`fatal: '${name}' is not a valid branch name`);
        moveDesk(w, r, d, at);
        r.branches[name] = at;
        d.branch = name;
        d.detached = null;
        return `Switched to a new branch '${name}'`;
    }
    if (!r.branches[name]) {
        const remote = r.tracking[`origin/${name}`];
        if (!remote)
            throw new GitError(`fatal: invalid reference: ${name}`);
        r.branches[name] = remote;
        r.upstream[name] = `origin/${name}`;
    }
    const other = deskUsing(r, name, d);
    if (other)
        throw new GitError(`fatal: '${name}' is already checked out at '${other.path}'`);
    if (d.branch === name && !d.detached)
        return `Already on '${name}'`;
    moveDesk(w, r, d, r.branches[name]);
    d.branch = name;
    d.detached = null;
    return `Switched to branch '${name}'`;
}
export function resolve(w, r, ref, d) {
    if (ref === "HEAD" || ref === "@")
        return d ? headId(r, d) : undefined;
    if (r.branches[ref])
        return r.branches[ref];
    if (r.tracking[ref])
        return r.tracking[ref];
    if (/^[0-9a-f]{4,}$/i.test(ref)) {
        const have = known_(w, r);
        const known = Object.keys(w.commits).filter((id) => id.startsWith(ref.toLowerCase()) && have.has(id));
        if (known.length === 1)
            return known[0];
    }
    return undefined;
}
/* every commit this repo has */
export function known_(w, r) {
    const s = new Set();
    const roots = [...Object.values(r.branches), ...Object.values(r.tracking), ...r.desks.map((d) => d.detached).filter(Boolean)];
    roots.forEach((id) => ancestors(w, id).forEach((x) => s.add(x)));
    return s;
}
export function branch(w, r, d, name, del) {
    if (del) {
        if (!name)
            throw new GitError("fatal: branch name required");
        if (!r.branches[name])
            throw new GitError(`error: branch '${name}' not found`);
        const using = r.desks.find((x) => x.branch === name && !x.detached);
        if (using)
            throw new GitError(`error: cannot delete branch '${name}' used by worktree at '${using.path}'`);
        if (del === "-d" && !isAncestor(w, r.branches[name], headId(r, d))) {
            throw new GitError(`error: the branch '${name}' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D ${name}'`);
        }
        const id = r.branches[name];
        delete r.branches[name];
        delete r.upstream[name];
        return `Deleted branch ${name} (was ${short(id)}).`;
    }
    if (!name) {
        return Object.keys(r.branches).sort()
            .map((b) => (b === d.branch && !d.detached ? `* ${b}` : `  ${b}`)).join("\n") || "(no branches yet: make a commit first)";
    }
    if (r.branches[name])
        throw new GitError(`fatal: a branch named '${name}' already exists`);
    const at = headId(r, d);
    if (!at)
        throw new GitError("fatal: you need at least one commit before you can make a branch");
    r.branches[name] = at;
    return "";
}
export function remoteAdd(w, r, name, url) {
    if (r.remote)
        throw new GitError(`error: remote ${r.remote.name} already exists.`);
    if (!urlOk(url))
        throw new GitError(`fatal: '${url}' does not look like a GitHub address (try ${REPO_URL})`);
    r.remote = { name, url };
    void w;
    return "";
}
function github(w) {
    if (!w.repos.github) {
        w.repos.github = { id: "github", label: "GitHub", bare: true, branches: {}, desks: [], remote: null, tracking: {}, upstream: {} };
    }
    return w.repos.github;
}
export function push(w, r, d, remote, br, setUp = false) {
    if (!r.remote)
        throw new GitError("fatal: No configured push destination.\nAdd GitHub as a remote first: git remote add origin <address>");
    if (remote && remote !== r.remote.name)
        throw new GitError(`fatal: '${remote}' does not appear to be a git repository (your remote is called '${r.remote.name}')`);
    const name = br ?? d.branch;
    if (!name)
        throw new GitError("fatal: You are not currently on a branch.");
    if (!br && !setUp && !r.upstream[name]) {
        throw new GitError(`fatal: The current branch ${name} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push -u ${r.remote.name} ${name}`);
    }
    const local = r.branches[name];
    if (!local)
        throw new GitError(`error: src refspec ${name} does not match any`);
    const gh = github(w);
    const there = gh.branches[name];
    const out = [`To ${r.remote.url.replace(/^https:\/\//, "")}`];
    if (there === local) {
        if (setUp)
            r.upstream[name] = `${r.remote.name}/${name}`;
        r.tracking[`${r.remote.name}/${name}`] = local;
        return "Everything up-to-date";
    }
    if (there && !isAncestor(w, there, local)) {
        throw new GitError(`${out[0]}\n ! [rejected]        ${name} -> ${name} (fetch first)\nerror: failed to push some refs\nhint: GitHub has work that you do not have on this computer.\nhint: Pull first (git pull), then push again.`);
    }
    // GitHub's branch rules run on its side, after git has sent the commits
    const why = pushBlockers(w, name, local);
    if (why.length) {
        const ref = `refs/heads/${name}`;
        const url = r.remote.url.replace(/^https:\/\//, "");
        throw new GitError([
            `remote: error: GH013: Repository rule violations found for ${ref}.`,
            `remote: Review all repository rules at ${WEB_URL}/rules?ref=${encodeURIComponent(ref)}`,
            "remote:",
            ...why.flatMap((x) => [`remote: - ${x}`, "remote:"]),
            `To ${url}`,
            ` ! [remote rejected] ${name} -> ${name} (push declined due to repository rule violations)`,
            `error: failed to push some refs to '${url}'`,
        ].join("\n"));
    }
    gh.branches[name] = local;
    r.tracking[`${r.remote.name}/${name}`] = local;
    if (setUp)
        r.upstream[name] = `${r.remote.name}/${name}`;
    out.push(there ? `   ${short(there)}..${short(local)}  ${name} -> ${name}` : ` * [new branch]      ${name} -> ${name}`);
    if (setUp)
        out.push(`branch '${name}' set up to track '${r.remote.name}/${name}'.`);
    reachedGithub(w, name, there, local, loginOf(r.id));
    return out.join("\n");
}
export function fetch(w, r) {
    if (!r.remote)
        throw new GitError("fatal: no remote to fetch from");
    const gh = github(w);
    const lines = [];
    for (const [b, id] of Object.entries(gh.branches)) {
        const key = `${r.remote.name}/${b}`;
        if (r.tracking[key] !== id)
            lines.push(`   ${short(r.tracking[key]) || "[new]"}..${short(id)}  ${b} -> ${key}`);
        r.tracking[key] = id;
    }
    return lines.length ? `From ${r.remote.url.replace(/^https:\/\//, "")}\n${lines.join("\n")}` : "";
}
export function merge(w, r, d, ref, author, label) {
    if (ref === "--abort") {
        if (!d.merging)
            throw new GitError("fatal: There is no merge to abort (MERGE_HEAD missing).");
        d.work = { ...d.merging.before.work };
        d.index = { ...d.merging.before.index };
        d.merging = null;
        return "";
    }
    if (d.merging)
        throw new GitError("error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, then commit, or use 'git merge --abort'.");
    const theirs = resolve(w, r, ref, d);
    if (!theirs)
        throw new GitError(`merge: ${ref} - not something we can merge`);
    const mine = headId(r, d);
    if (!mine || isAncestor(w, theirs, mine))
        return "Already up to date.";
    if (isAncestor(w, mine, theirs)) {
        moveDesk(w, r, d, theirs);
        if (d.detached)
            d.detached = theirs;
        else
            r.branches[d.branch] = theirs;
        const a = treeOf(w, mine), b = treeOf(w, theirs);
        const changed = paths(a, b).filter((p) => a[p] !== b[p]);
        return `Updating ${short(mine)}..${short(theirs)}\nFast-forward\n ${changed.map((p) => `${p} | changed`).join("\n ")}`;
    }
    const base = mergeBase(w, mine, theirs);
    const lbl = label ?? ref;
    const { tree, conflicts } = mergeTrees(w, base, mine, theirs, ["HEAD", lbl]);
    // uncommitted edits only block a merge when the merge would change those files
    const ours0 = treeOf(w, mine);
    const dirty = paths(d.work, d.index, ours0).filter((p) => d.work[p] !== ours0[p] || d.index[p] !== ours0[p]);
    const blocked = dirty.filter((p) => tree[p] !== ours0[p] || conflicts.includes(p));
    if (blocked.length)
        throw new GitError(`error: Your local changes to the following files would be overwritten by merge:\n\t${blocked.join("\n\t")}\nPlease commit your changes or stash them before you merge.`);
    const keep = (into, from) => dirty.forEach((p) => { if (from[p] === undefined)
        delete into[p];
    else
        into[p] = from[p]; });
    const msg = `Merge ${ref.includes("/") ? "remote-tracking branch" : "branch"} '${ref}'`;
    if (!conflicts.length) {
        const id = newCommit(w, msg, [mine, theirs], tree, author);
        if (d.detached)
            d.detached = id;
        else
            r.branches[d.branch] = id;
        const oldWork = d.work, oldIndex = d.index;
        d.work = { ...tree };
        d.index = { ...tree };
        keep(d.work, oldWork);
        keep(d.index, oldIndex);
        return `Merge made by the 'ort' strategy.\n[${d.branch ?? "detached HEAD"} ${short(id)}] ${msg}`;
    }
    const ours = treeOf(w, mine);
    const before = { work: { ...d.work }, index: { ...d.index } };
    d.work = { ...tree };
    d.index = { ...tree };
    keep(d.work, before.work);
    keep(d.index, before.index);
    // the conflicted file sits in the work tree with markers; the index keeps ours
    // until you `git add` the fixed file
    for (const p of conflicts)
        d.index[p] = ours[p] ?? "";
    d.merging = { theirs, msg, unmerged: [...conflicts], before };
    return conflicts.map((p) => `Auto-merging ${p}\nCONFLICT (content): Merge conflict in ${p}`).join("\n") +
        "\nAutomatic merge failed; fix conflicts and then commit the result.";
}
export function pull(w, r, d, author) {
    if (!d.branch)
        throw new GitError("fatal: You are not currently on a branch.");
    const up = r.upstream[d.branch];
    if (!up)
        throw new GitError(`There is no tracking information for the current branch.\nTry: git pull ${r.remote?.name ?? "origin"} ${d.branch}`);
    const f = fetch(w, r);
    // git labels a pulled conflict with the other side's commit id
    const m = merge(w, r, d, up, author, r.tracking[up]);
    return [f, m].filter(Boolean).join("\n");
}
export function cloneTo(w, id, label, url, path) {
    if (!urlOk(url))
        throw new GitError(`fatal: repository '${url}' not found`);
    const gh = w.repos.github;
    if (!gh || !gh.branches.main)
        throw new GitError(`fatal: repository '${url}' not found`);
    if (w.repos[id])
        throw new GitError(`fatal: destination path 'my-report' already exists and is not an empty directory.`);
    const tracking = {};
    for (const [b, c] of Object.entries(gh.branches))
        tracking[`origin/${b}`] = c;
    const tree = treeOf(w, gh.branches.main);
    w.repos[id] = {
        id, label, bare: false,
        branches: { main: gh.branches.main },
        desks: [{ path, branch: "main", detached: null, work: { ...tree }, index: { ...tree }, merging: null }],
        remote: { name: "origin", url }, tracking, upstream: { main: "origin/main" },
    };
    return `Cloning into 'my-report'...\nReceiving objects: 100% (${ancestors(w, gh.branches.main).size} commits), done.`;
}
export function worktreeAdd(w, r, from, path, newBranch, start) {
    const full = "~/" + path.replace(/^\.\.\//, "").replace(/^~\//, "").replace(/\/$/, "");
    if (r.desks.some((d) => d.path === full))
        throw new GitError(`fatal: '${path}' already exists`);
    const base = start ? resolve(w, r, start, from) : headId(r, from);
    if (!base)
        throw new GitError(`fatal: invalid reference: ${start}`);
    let br = newBranch;
    if (br) {
        if (r.branches[br])
            throw new GitError(`fatal: a branch named '${br}' already exists`);
        r.branches[br] = base;
    }
    else {
        br = start && r.branches[start] ? start : undefined;
        if (br && r.desks.some((x) => x.branch === br && !x.detached))
            throw new GitError(`fatal: '${br}' is already checked out`);
    }
    const tree = treeOf(w, base);
    r.desks.push({ path: full, branch: br ?? null, detached: br ? null : base, work: { ...tree }, index: { ...tree }, merging: null });
    const how = newBranch ? `new branch '${br}'` : br ? `checking out '${br}'` : `detached HEAD ${short(base)}`;
    return `Preparing worktree (${how})\nHEAD is now at ${short(base)} ${subject(w.commits[base].msg)}`;
}
/* diff between two versions of a file, for the PR page and git diff */
export function lineDiff(a, b) {
    const lines = (s) => (s === undefined || s === "" ? [] : s.replace(/\n$/, "").split("\n"));
    const A = lines(a), B = lines(b);
    const m = lcs(A, B);
    const out = [];
    let i = 0, j = 0;
    for (const [x, y] of [...m, [A.length, B.length]]) {
        while (i < x)
            out.push({ t: "-", s: A[i++] });
        while (j < y)
            out.push({ t: "+", s: B[j++] });
        if (x < A.length)
            out.push({ t: " ", s: A[x] });
        i = x + 1;
        j = y + 1;
    }
    return out;
}
/* ================================================================ GitHub
 * Everything below lives on GitHub's side of the world: issues, labels, pull
 * requests and reviews, Actions runs and branch rules. Error and success
 * lines follow what the gh command line prints, so the lesson's terminal
 * reads like the real one. */
/* ------------------------------------------------------------ people */
export const LOGINS = ["you", "albert", "toby"];
/* "Albert" -> "albert", "@toby" -> "toby" */
export function loginOf(name) {
    return name.trim().replace(/^@/, "").toLowerCase();
}
/* "albert" -> "Albert" */
export function nameOf(login) {
    const l = loginOf(login);
    return l.charAt(0).toUpperCase() + l.slice(1);
}
/* the first line of a commit message */
export function subject(msg) {
    return msg.split("\n")[0];
}
export const FULL_NAME = "you/my-report";
export const WEB_URL = "https://github.com/you/my-report";
export const PAGES_URL = "https://you.github.io/my-report/";
const uniq = (xs) => [...new Set(xs)];
/* a lookup that never finds Object's own keys ("constructor") */
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const tick = (w) => (w.tick = (w.tick ?? 0) + 1);
/* the labels every new GitHub repository starts with */
export const DEFAULT_LABELS = [
    { name: "bug", color: "#d73a4a", desc: "Something isn't working" },
    { name: "documentation", color: "#0075ca", desc: "Improvements or additions to documentation" },
    { name: "duplicate", color: "#cfd3d7", desc: "This issue or pull request already exists" },
    { name: "enhancement", color: "#a2eeef", desc: "New feature or request" },
    { name: "good first issue", color: "#7057ff", desc: "Good for newcomers" },
    { name: "help wanted", color: "#008672", desc: "Extra attention is needed" },
    { name: "invalid", color: "#e4e669", desc: "This doesn't seem right" },
    { name: "question", color: "#d876e3", desc: "Further information is requested" },
    { name: "wontfix", color: "#ffffff", desc: "This will not be worked on" },
];
/* GitHub's side for the tracks that use it: the repository, no issues yet,
 * the nine default labels, no runs and no rules */
export function ghInit(w) {
    github(w);
    hub(w);
}
function hub(w) {
    w.issues ?? (w.issues = []);
    w.labels ?? (w.labels = DEFAULT_LABELS.map((l) => ({ ...l })));
    w.runs ?? (w.runs = []);
    w.rules ?? (w.rules = []);
}
export const labelsOf = (w) => w.labels ?? DEFAULT_LABELS;
/* issues and pull requests share one number sequence */
function nextNum(w) {
    w.num = (w.num ?? Math.max(0, ...w.prs.map((p) => p.n), ...(w.issues ?? []).map((i) => i.n))) + 1;
    return w.num;
}
export const issueOf = (w, n) => (w.issues ?? []).find((i) => i.n === n);
export const prOf = (w, n) => w.prs.find((p) => p.n === n);
/* like issueOf and prOf, but a missing number fails the way gh does */
export function getIssue(w, n) {
    const i = issueOf(w, n);
    if (!i)
        throw new GitError(`GraphQL: Could not resolve to an issue or pull request with the number of ${n}. (repository.issue)`);
    return i;
}
export function getPr(w, n) {
    const p = prOf(w, n);
    if (!p)
        throw new GitError(`GraphQL: Could not resolve to a PullRequest with the number of ${n}. (repository.pullRequest)`);
    return p;
}
function labelName(w, name) {
    const l = labelsOf(w).find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!l)
        throw new GitError(`could not add label: '${name}' not found`);
    return l.name;
}
function person(login, what) {
    const l = loginOf(login);
    if (!LOGINS.includes(l))
        throw new GitError(`could not ${what}: '${login}' not found`);
    return l;
}
function applyChanges(w, x, ch) {
    // everything is looked up first, as gh does, so one typo changes nothing
    const addA = (ch.addAssignees ?? []).map((a) => person(a, "assign user"));
    const remA = (ch.removeAssignees ?? []).map((a) => person(a, "assign user"));
    const addL = (ch.addLabels ?? []).map((l) => labelName(w, l));
    const remL = (ch.removeLabels ?? []).map((l) => labelName(w, l));
    if (ch.title !== undefined && !ch.title.trim())
        throw new GitError("title can't be blank");
    if (ch.title !== undefined)
        x.title = ch.title;
    if (ch.body !== undefined)
        x.body = ch.body;
    x.assignees = uniq([...(x.assignees ?? []), ...addA]).filter((a) => !remA.includes(a));
    x.labels = uniq([...(x.labels ?? []), ...addL]).filter((l) => !remL.includes(l));
}
/* "Closes #3", "fixes: #4", "Resolved you/my-report#5": the issues a pull
 * request body or a commit message will close once it lands on main */
export function closesIn(w, text) {
    const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:https:\/\/github\.com\/you\/my-report\/issues\/|you\/my-report#|#)(\d+)\b/gi;
    const out = [];
    let m;
    while ((m = re.exec(text)))
        out.push(Number(m[1]));
    return uniq(out).filter((n) => issueOf(w, n));
}
function autoClose(w, nums, by) {
    for (const n of nums) {
        const i = issueOf(w, n);
        if (!i || i.state === "closed")
            continue;
        i.state = "closed";
        i.reason = "completed";
        if (by.pr)
            i.closedBy = by.pr;
        if (by.commit)
            i.closedByCommit = by.commit;
    }
}
/* ------------------------------------------------------------ issues */
export function issueCreate(w, author, title, body = "", labels = [], assignees = []) {
    hub(w);
    if (!title.trim())
        throw new GitError("title can't be blank");
    const as = assignees.map((a) => person(a, "assign user"));
    const ls = labels.map((l) => labelName(w, l));
    const n = nextNum(w);
    w.issues.push({ n, title, body, author: nameOf(author), labels: uniq(ls), assignees: uniq(as), state: "open", comments: [], at: tick(w) });
    return `${WEB_URL}/issues/${n}`;
}
export function issueEdit(w, n, ch) {
    applyChanges(w, getIssue(w, n), ch);
    return `${WEB_URL}/issues/${n}`;
}
function addComment(w, list, who, text) {
    if (!text.trim())
        throw new GitError("body cannot be blank");
    const at = tick(w), id = 2400000000 + at * 7;
    list.push({ who: nameOf(who), text, at, id });
    return id;
}
/* a comment on an issue (or, as on GitHub, on a pull request by its number) */
export function issueComment(w, n, who, text) {
    const pr = prOf(w, n);
    if (pr)
        return prComment(w, n, who, text);
    return `${WEB_URL}/issues/${n}#issuecomment-${addComment(w, getIssue(w, n).comments, who, text)}`;
}
const REASONS = { completed: "completed", "not planned": "not_planned", not_planned: "not_planned", duplicate: "duplicate" };
export function issueClose(w, n, o = {}) {
    const reason = own(REASONS, (o.reason ?? "completed").toLowerCase());
    if (!reason)
        throw new GitError(`invalid argument "${o.reason}" for "-r, --reason" flag: valid values are {completed|not planned|duplicate}`);
    const i = getIssue(w, n);
    const ref = `${FULL_NAME}#${n} (${i.title})`;
    if (i.state === "closed")
        return `! Issue ${ref} is already closed`;
    if (o.comment)
        addComment(w, i.comments, o.who ?? "you", o.comment);
    i.state = "closed";
    i.reason = reason;
    return `✓ Closed issue ${ref}`;
}
export function issueReopen(w, n, o = {}) {
    const i = getIssue(w, n);
    const ref = `${FULL_NAME}#${n} (${i.title})`;
    if (i.state === "open")
        return `! Issue ${ref} is already open`;
    if (o.comment)
        addComment(w, i.comments, o.who ?? "you", o.comment);
    i.state = "open";
    delete i.reason;
    delete i.closedBy;
    delete i.closedByCommit;
    return `✓ Reopened issue ${ref}`;
}
const LABEL_COLORS = ["b60205", "d93f0b", "fbca04", "0e8a16", "006b75", "1d76db", "0052cc", "5319e7", "e99695", "f9d0c4", "fef2c0", "c2e0c6", "bfdadc", "c5def5", "bfd4f2", "d4c5f9"];
/* colors are stored with a leading # ("#d73a4a"), ready for CSS */
export function labelCreate(w, name, color, desc = "", force = false) {
    hub(w);
    if (!name.trim())
        throw new GitError("accepts 1 arg(s), received 0");
    const c = (color ?? LABEL_COLORS[parseInt(hash(name), 16) % LABEL_COLORS.length]).replace(/^#/, "").toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(c))
        throw new GitError(`HTTP 422: Validation Failed (https://api.github.com/repos/${FULL_NAME}/labels)\nLabel.color is invalid`);
    const have = w.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (have && !force)
        throw new GitError(`label with name "${name}" already exists; use \`--force\` to update its color and description`);
    if (have) {
        have.color = "#" + c;
        if (desc)
            have.desc = desc;
    }
    else
        w.labels.push({ name, color: "#" + c, desc });
    return `✓ Label "${name}" created in ${FULL_NAME}`;
}
/* ------------------------------------------------------- pull requests */
/* the commit a pull request proposes: the live branch while it is open,
 * the last one seen once it is merged, closed or its branch is gone */
export function prHead(w, pr) {
    const live = pr.state === "open" ? w.repos.github?.branches[pr.head] : undefined;
    return live ?? pr.headCommit ?? w.repos.github?.branches[pr.head];
}
/* where the base branch was: before the merge for a merged pull request */
export function prBase(w, pr) {
    return pr.mergeCommit ? w.commits[pr.mergeCommit].parents[0] : w.repos.github?.branches[pr.base];
}
/* the commits a pull request adds, oldest first */
export function prCommits(w, pr) {
    const base = ancestors(w, prBase(w, pr));
    return [...ancestors(w, prHead(w, pr))].filter((id) => !base.has(id)).sort((a, b) => w.commits[a].n - w.commits[b].n);
}
/* what `gh pr create --fill` writes: one commit gives its own message, more
 * give the branch name and a list */
export function fillFrom(w, head, base) {
    const gh = w.repos.github;
    const have = ancestors(w, gh?.branches[base]);
    const ids = [...ancestors(w, gh?.branches[head])].filter((id) => !have.has(id)).sort((a, b) => w.commits[a].n - w.commits[b].n);
    if (ids.length === 1) {
        const [t, ...rest] = w.commits[ids[0]].msg.split("\n");
        return { title: t, body: rest.join("\n").trim() };
    }
    return { title: head.replace(/[-_]/g, " "), body: ids.map((id) => `- ${subject(w.commits[id].msg)}\n`).join("") };
}
export function prCreate(w, head, base, title, author, o = {}) {
    const gh = w.repos.github;
    if (!gh?.branches[head])
        throw new GitError(`aborted: you must first push the branch '${head}' to GitHub`);
    if (!gh.branches[base])
        throw new GitError(`base branch '${base}' not found on GitHub`);
    if (head === base)
        throw new GitError(`head branch "${head}" is the same as base branch "${base}", cannot create a pull request`);
    const open = w.prs.find((p) => p.head === head && p.base === base && p.state === "open");
    if (open)
        throw new GitError(`a pull request for branch "${head}" into branch "${base}" already exists:\n${WEB_URL}/pull/${open.n}`);
    if (!title.trim())
        throw new GitError("title can't be blank");
    if (isAncestor(w, gh.branches[head], gh.branches[base]))
        throw new GitError(`pull request create failed: GraphQL: No commits between ${base} and ${head} (createPullRequest)`);
    const me = loginOf(author);
    const as = (o.assignees ?? []).map((a) => person(a, "assign user"));
    const ls = (o.labels ?? []).map((l) => labelName(w, l));
    const rs = (o.reviewers ?? []).map((r) => person(r, "request reviewer"));
    if (rs.includes(me))
        throw new GitError("could not request reviewer: GraphQL: Review cannot be requested from pull request author. (requestReviews)");
    const n = nextNum(w);
    const body = o.body ?? "";
    const pr = {
        n, title, head, base, author, state: "open", approved: false, comments: [],
        body, draft: !!o.draft, labels: uniq(ls), assignees: uniq(as), reviewers: uniq(rs), reviews: [],
        closes: closesIn(w, body), headCommit: gh.branches[head], at: tick(w),
    };
    w.prs.push(pr);
    prEvent(w, pr, "opened", me);
    return `${WEB_URL}/pull/${n}`;
}
export function prReady(w, n, undo = false) {
    const pr = getPr(w, n);
    const ref = `${FULL_NAME}#${n}`;
    if (pr.state !== "open")
        throw new GitError(`X Pull request ${ref} is closed. Only draft pull requests can be marked as "ready for review"`);
    if (undo) {
        if (pr.draft)
            return `! Pull request ${ref} is already "in draft"`;
        pr.draft = true;
        return `✓ Pull request ${ref} is converted to "draft"`;
    }
    if (!pr.draft)
        return `! Pull request ${ref} is already "ready for review"`;
    pr.draft = false;
    return `✓ Pull request ${ref} is marked as "ready for review"`;
}
export function prEdit(w, n, ch) {
    const pr = getPr(w, n);
    const add = (ch.addReviewers ?? []).map((r) => person(r, "request reviewer"));
    const rem = (ch.removeReviewers ?? []).map((r) => person(r, "request reviewer"));
    if (add.includes(loginOf(pr.author)))
        throw new GitError("GraphQL: Review cannot be requested from pull request author. (requestReviews)");
    applyChanges(w, pr, ch);
    pr.reviewers = uniq([...(pr.reviewers ?? []), ...add]).filter((r) => !rem.includes(r));
    if (ch.body !== undefined)
        pr.closes = closesIn(w, ch.body);
    return `${WEB_URL}/pull/${n}`;
}
export function prComment(w, n, who, text) {
    return `${WEB_URL}/pull/${n}#issuecomment-${addComment(w, getPr(w, n).comments, who, text)}`;
}
/* who approved and who asked for changes: each reviewer's latest approve or
 * request-changes review counts, as on GitHub. With `at`, only approvals of
 * that commit count (a ruleset that dismisses stale approvals) */
export function reviewState(pr, at) {
    const last = new Map();
    for (const r of pr.reviews ?? [])
        if (r.state !== "commented" && r.who !== loginOf(pr.author))
            last.set(r.who, r);
    const approvals = [], changes = [];
    last.forEach((r, who) => {
        if (r.state === "approved" && (!at || r.commit === at))
            approvals.push(who);
        if (r.state === "changes_requested")
            changes.push(who);
    });
    return { approvals, changes };
}
/* a review, the way `gh pr review` or the Files changed tab sends one.
 * `notes` are line comments (file and line set) that come with it. */
export function prReview(w, n, who, state, text = "", notes = []) {
    const pr = getPr(w, n);
    const me = loginOf(who);
    if (pr.state !== "open" && state !== "commented")
        throw new GitError("failed to create review: GraphQL: Pull request is closed (addPullRequestReview)");
    if (me === loginOf(pr.author)) {
        if (state === "approved")
            throw new GitError("failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)");
        if (state === "changes_requested")
            throw new GitError("failed to create review: GraphQL: Can not request changes on your own pull request (addPullRequestReview)");
    }
    const at = tick(w), id = 1800000000 + at * 13;
    pr.reviews ?? (pr.reviews = []);
    pr.reviews.push({
        who: me, state, text, commit: prHead(w, pr) ?? "", at, id,
        notes: notes.map((x) => ({ ...x, who: nameOf(x.who || me), at })),
    });
    // a review answers the request: the reviewer leaves the waiting list
    pr.reviewers = (pr.reviewers ?? []).filter((r) => r !== me);
    const s = reviewState(pr);
    pr.approved = s.approvals.length > 0 && s.changes.length === 0;
    const ref = `${FULL_NAME}#${n}`;
    if (state === "approved")
        return `✓ Approved pull request ${ref}`;
    if (state === "changes_requested")
        return `+ Requested changes to pull request ${ref}`;
    return `- Reviewed pull request ${ref}`;
}
export function prClose(w, n, deleteBranch = false) {
    const pr = getPr(w, n);
    const ref = `${FULL_NAME}#${n} (${pr.title})`;
    if (pr.state === "merged")
        throw new GitError(`X Pull request ${ref} can't be closed because it was already merged`);
    if (pr.state === "closed")
        return `! Pull request ${ref} is already closed`;
    pr.headCommit = prHead(w, pr);
    pr.state = "closed";
    const out = [`✓ Closed pull request ${ref}`];
    if (deleteBranch && w.repos.github.branches[pr.head]) {
        delete w.repos.github.branches[pr.head];
        pr.branchDeleted = true;
        out.push(`✓ Deleted branch ${pr.head}`);
    }
    return out.join("\n");
}
export function prReopen(w, n) {
    const pr = getPr(w, n);
    const ref = `${FULL_NAME}#${n} (${pr.title})`;
    if (pr.state === "merged")
        throw new GitError(`X Pull request ${ref} can't be reopened because it was already merged`);
    if (pr.state === "open")
        return `! Pull request ${ref} is already open`;
    if (!w.repos.github.branches[pr.head])
        throw new GitError("GraphQL: Could not open the pull request. (reopenPullRequest)");
    pr.state = "open";
    pr.headCommit = w.repos.github.branches[pr.head];
    prEvent(w, pr, "reopened", loginOf(pr.author));
    return `✓ Reopened pull request ${ref}`;
}
export function prMerge(w, n, author, o = {}) {
    const pr = getPr(w, n);
    const ref = `${FULL_NAME}#${n}`;
    if (pr.state === "merged")
        throw new GitError(`! Pull request ${ref} was already merged`);
    if (pr.state === "closed")
        throw new GitError("GraphQL: Pull Request is not mergeable (mergePullRequest)");
    const method = o.method ?? "merge";
    if (method === "rebase")
        throw new GitError("Rebase merging is outside this lesson. Use --merge or --squash.");
    const gh = w.repos.github;
    const base = gh.branches[pr.base], head = gh.branches[pr.head];
    if (!head)
        throw new GitError("GraphQL: Head branch is missing (mergePullRequest)");
    if (pr.draft)
        throw new GitError("GraphQL: Pull Request is still a draft (mergePullRequest)");
    const { tree, conflicts } = mergeTrees(w, mergeBase(w, base, head), base, head, ["base", "head"]);
    if (conflicts.length) {
        throw new GitError(`X Pull request ${ref} is not mergeable: the merge commit cannot be cleanly created.\n` +
            "To have the pull request merged after all the requirements have been met, add the `--auto` flag.\n" +
            `Run the following to resolve the merge conflicts locally:\n  gh pr checkout ${n} && git fetch origin ${pr.base} && git merge origin/${pr.base}`);
    }
    const why = mergeBlockers(w, n);
    if (why.length && o.admin)
        throw new GitError(`GraphQL: Repository rule violations found\n\n${why.join("\n")}\n (mergePullRequest)`);
    if (why.length) {
        throw new GitError(`X Pull request ${ref} is not mergeable: the base branch policy prohibits the merge.\n` +
            "To have the pull request merged after all the requirements have been met, add the `--auto` flag.\n" +
            "To use administrator privileges to immediately merge the pull request, add the `--admin` flag.\n\n" +
            why.map((x) => `- ${x}`).join("\n"));
    }
    const tail = o.body ? `\n\n${o.body}` : "";
    const id = method === "squash"
        ? newCommit(w, (o.subject ?? `${pr.title} (#${n})`) + tail, [base], tree, pr.author)
        : newCommit(w, (o.subject ?? `Merge pull request #${n} from you/${pr.head}`) + tail, [base, head], tree, author);
    gh.branches[pr.base] = id;
    pr.state = "merged";
    pr.mergeCommit = id;
    pr.method = method;
    pr.headCommit = head;
    const out = [`✓ ${method === "squash" ? "Squashed and merged" : "Merged"} pull request ${ref} (${pr.title})`];
    // GitHub finishes its side first; the clean up on your computer comes after
    // and only warns when it can't switch, as gh does
    // "Closes #N" only works for pull requests into the default branch
    if (pr.base === "main")
        autoClose(w, pr.closes ?? [], { pr: n });
    reachedGithub(w, pr.base, base, id, loginOf(author));
    if (o.deleteBranch && o.local?.r.branches[pr.head]) {
        try {
            out.push(deleteLocal(w, o.local.r, o.local.d, pr.head, pr.base, author));
        }
        catch (e) {
            if (!(e instanceof GitError))
                throw e;
            out.push(`${e.message}\n! warning: could not switch to branch ${pr.base}; local branch ${pr.head} was not deleted`);
        }
    }
    if (o.deleteBranch) {
        delete gh.branches[pr.head];
        pr.branchDeleted = true;
        out.push(`✓ Deleted remote branch ${pr.head}`);
    }
    return out.join("\n");
}
/* gh pr merge --delete-branch, on your computer: when you're on the branch,
 * gh switches to the base and pulls it (fast-forward only), then deletes the
 * branch with -D, since a squash leaves it looking unmerged */
function deleteLocal(w, r, d, head, base, author) {
    const warn = [];
    let switched = "";
    if (d.branch === head && !d.detached) {
        switchTo(w, r, d, base);
        fetch(w, r);
        const up = r.tracking[`origin/${base}`], at = r.branches[base];
        if (up && isAncestor(w, at, up))
            merge(w, r, d, `origin/${base}`, author);
        else if (up && !isAncestor(w, up, at))
            warn.push(`! warning: not possible to fast-forward to: "${base}"`);
        switched = ` and switched to branch ${base}`;
    }
    const using = deskUsing(r, head, d);
    if (using)
        return [...warn, `! Branch ${head} is checked out at ${using.path}; skipping local delete`].join("\n");
    delete r.branches[head];
    delete r.upstream[head];
    return [...warn, `✓ Deleted local branch ${head}${switched}`].join("\n");
}
/* ------------------------------------------------------- branch rules */
export function ruleCovers(r, branch) {
    if ((r.enforcement ?? "active") !== "active")
        return false;
    const hit = (p) => p === "~ALL" || (p === "~DEFAULT_BRANCH" ? branch === "main" : globRe(p.replace(/^refs\/heads\//, "")).test(branch));
    return (r.include ?? [`refs/heads/${r.branch}`]).some(hit) && !(r.exclude ?? []).some(hit);
}
const covering = (w, branch) => (w.rules ?? []).filter((r) => ruleCovers(r, branch));
/* a check (an Actions job, by name) on one commit: its latest result */
export function checkState(w, commit, name) {
    let s;
    for (const r of w.runs ?? [])
        if (r.commit === commit)
            for (const j of r.jobs)
                if (j.name === name)
                    s = j.ok ? "pass" : "fail";
    return s;
}
function checkReasons(w, r, commit) {
    const missing = r.checks.filter((c) => !checkState(w, commit, c));
    const failing = r.checks.filter((c) => checkState(w, commit, c) === "fail");
    const out = failing.map((c) => `Required status check "${c}" is failing.`);
    if (missing.length === 1)
        out.push(`Required status check "${missing[0]}" is expected.`);
    if (missing.length > 1)
        out.push(`${missing.length} of ${r.checks.length} required status checks are expected.`);
    return out;
}
/* why GitHub would refuse a push of `commit` to `branch` (GH013) */
export function pushBlockers(w, branch, commit) {
    const out = [];
    for (const r of covering(w, branch)) {
        if (r.requirePR)
            out.push("Changes must be made through a pull request.");
        out.push(...checkReasons(w, r, commit));
    }
    return uniq(out);
}
/* why pull request n cannot be merged yet, in GitHub's words; [] when the
 * rules allow it. Drafts and conflicts are not rules: see prMerge. */
export function mergeBlockers(w, n) {
    const pr = prOf(w, n);
    if (!pr || pr.state !== "open")
        return [];
    const head = prHead(w, pr);
    const out = [];
    for (const r of covering(w, pr.base)) {
        if (r.requirePR && r.approvals > 0) {
            const s = reviewState(pr, r.dismissStale ? head : undefined);
            if (s.changes.length)
                out.push(`${s.changes.length} review${s.changes.length > 1 ? "s" : ""} requesting changes by reviewers with write access.`);
            else if (s.approvals.length < r.approvals)
                out.push(`At least ${r.approvals} approving review${r.approvals > 1 ? "s are" : " is"} required by reviewers with write access.`);
        }
        if (head)
            out.push(...checkReasons(w, r, head));
    }
    return uniq(out);
}
/* the files GitHub cannot merge for pull request n ("This branch has
 * conflicts that must be resolved"); [] when it merges cleanly */
export function prConflicts(w, n) {
    const pr = prOf(w, n);
    const gh = w.repos.github;
    const base = gh?.branches[pr?.base ?? ""], head = gh?.branches[pr?.head ?? ""];
    if (!pr || pr.state !== "open" || !base || !head)
        return [];
    return mergeTrees(w, mergeBase(w, base, head), base, head, ["base", "head"]).conflicts;
}
/* the JSON GitHub's REST API takes for a branch ruleset: write it to a file
 * and send it with `gh api --method POST repos/you/my-report/rulesets --input FILE` */
export function rulesetJson(o = {}) {
    const rules = [];
    if (o.blockForcePush ?? true)
        rules.push({ type: "non_fast_forward" });
    if (o.requirePR ?? true) {
        rules.push({
            type: "pull_request",
            parameters: {
                required_approving_review_count: o.approvals ?? 1,
                dismiss_stale_reviews_on_push: !!o.dismissStale,
                require_code_owner_review: false,
                require_last_push_approval: false,
                required_review_thread_resolution: false,
            },
        });
    }
    if (o.checks?.length) {
        rules.push({
            type: "required_status_checks",
            parameters: {
                strict_required_status_checks_policy: false,
                required_status_checks: o.checks.map((context) => ({ context })),
            },
        });
    }
    return JSON.stringify({
        name: o.name ?? "Protect main",
        target: "branch",
        enforcement: "active",
        conditions: { ref_name: { include: [`refs/heads/${o.branch ?? "main"}`], exclude: [] } },
        rules,
    }, null, 2) + "\n";
}
const RULE_TYPES = ["creation", "update", "deletion", "required_linear_history", "required_signatures", "pull_request",
    "required_status_checks", "non_fast_forward", "required_deployments", "merge_queue", "commit_message_pattern",
    "commit_author_email_pattern", "committer_email_pattern", "branch_name_pattern", "tag_name_pattern"];
/* a failed REST call, printed the way `gh api` prints it */
function apiFail(status, message, extra = "") {
    const doc = "https://docs.github.com/rest/repos/rules#create-a-repository-ruleset";
    throw new GitError(`${JSON.stringify({ message, documentation_url: doc, status: String(status) })}\ngh: ${message} (HTTP ${status})${extra ? "\n" + extra : ""}`);
}
export function rulesetView(r) {
    return {
        id: r.id, name: r.name, target: "branch", source_type: "Repository", source: FULL_NAME,
        enforcement: r.enforcement ?? "active",
        conditions: { ref_name: { include: r.include ?? [`refs/heads/${r.branch}`], exclude: r.exclude ?? [] } },
        rules: r.rules ?? [], bypass_actors: [], current_user_can_bypass: "never",
        _links: { self: { href: `https://api.github.com/repos/${FULL_NAME}/rulesets/${r.id}` }, html: { href: `${WEB_URL}/rules/${r.id}` } },
    };
}
/* POST (or, with replace, PUT) a ruleset from its JSON text; returns the
 * JSON GitHub answers with */
export function rulesetCreate(w, text, replace) {
    hub(w);
    let j;
    try {
        j = JSON.parse(text);
    }
    catch {
        return apiFail(400, "Problems parsing JSON");
    }
    if (!j || typeof j !== "object" || Array.isArray(j))
        apiFail(400, "Problems parsing JSON");
    if (typeof j.name !== "string" || !j.name.trim())
        apiFail(422, "Invalid request.\n\n\"name\" wasn't supplied.");
    if (j.enforcement === undefined)
        apiFail(422, "Invalid request.\n\n\"enforcement\" wasn't supplied.");
    if (!["active", "evaluate", "disabled"].includes(j.enforcement))
        apiFail(422, `Invalid request.\n\nInvalid property /enforcement: \`${j.enforcement}\` is not a possible value. Must be one of the following: disabled, active, evaluate.`);
    const target = j.target ?? "branch";
    if (!["branch", "tag", "push"].includes(target))
        apiFail(422, `Invalid request.\n\nInvalid property /target: \`${target}\` is not a possible value. Must be one of the following: branch, tag, push.`);
    const ref = j.conditions?.ref_name ?? {};
    const include = ref.include ?? [], exclude = ref.exclude ?? [];
    if (!Array.isArray(include) || !Array.isArray(exclude) || [...include, ...exclude].some((x) => typeof x !== "string"))
        apiFail(422, "Invalid request.\n\nInvalid property /conditions/ref_name: data matches no possible input.");
    const rules = j.rules ?? [];
    if (!Array.isArray(rules))
        apiFail(422, "Invalid request.\n\nInvalid property /rules: data matches no possible input.");
    rules.forEach((r, k) => {
        if (!r || !RULE_TYPES.includes(r.type))
            apiFail(422, `Invalid request.\n\nInvalid property /rules/${k}: data matches no possible input.`);
    });
    const pr = rules.find((r) => r.type === "pull_request");
    const sc = rules.find((r) => r.type === "required_status_checks");
    const approvals = Number(pr?.parameters?.required_approving_review_count ?? 0);
    if (pr && (!Number.isInteger(approvals) || approvals < 0 || approvals > 10))
        apiFail(422, "Invalid request.\n\nInvalid property /rules/0/parameters/required_approving_review_count: must be between 0 and 10.");
    const checks = sc?.parameters?.required_status_checks ?? [];
    if (sc && (!Array.isArray(checks) || checks.some((c) => typeof c?.context !== "string")))
        apiFail(422, "Invalid request.\n\nInvalid property /rules/required_status_checks: each check needs a \"context\".");
    const list = w.rules;
    const old = replace === undefined ? undefined : list.find((r) => r.id === replace);
    if (replace !== undefined && !old)
        apiFail(404, "Not Found");
    if (list.some((r) => r !== old && r.name.toLowerCase() === j.name.toLowerCase()))
        apiFail(422, "Validation Failed", "Name must be unique");
    const first = String(include[0] ?? "refs/heads/main");
    const rule = {
        id: old?.id ?? 4800000 + (list.length + 1) * 1307,
        name: j.name,
        branch: first === "~DEFAULT_BRANCH" ? "main" : first === "~ALL" ? "*" : first.replace(/^refs\/heads\//, ""),
        requirePR: !!pr,
        approvals: pr ? approvals : 0,
        checks: checks.map((c) => c.context),
        blockForcePush: rules.some((r) => r.type === "non_fast_forward"),
        enforcement: j.enforcement,
        // a tag or push ruleset never covers a branch in this lesson
        include: target === "branch" ? include : [],
        exclude,
        dismissStale: !!pr?.parameters?.dismiss_stale_reviews_on_push,
        rules,
    };
    if (old)
        list[list.indexOf(old)] = rule;
    else
        list.push(rule);
    return JSON.stringify(rulesetView(rule), null, 2);
}
/* ------------------------------------------------------------ Actions
 * When commits reach GitHub, every workflow file in that commit whose on:
 * matches the event runs. Runs finish at once; the page animates them. */
/* where commits arrived on GitHub: a push, or a merge GitHub made */
function reachedGithub(w, branch, before, after, actor) {
    // a commit that says "Fixes #3" closes issue 3 once it lands on main
    if (branch === "main" && w.issues?.length) {
        const old = ancestors(w, before);
        [...ancestors(w, after)].filter((id) => !old.has(id)).sort((a, b) => w.commits[a].n - w.commits[b].n)
            .forEach((id) => autoClose(w, closesIn(w, w.commits[id].msg), { commit: id }));
    }
    triggerRuns(w, { event: "push", branch, commit: after, tree: treeOf(w, after), actor, title: subject(w.commits[after].msg) });
    for (const pr of w.prs) {
        if (pr.state !== "open" || pr.head !== branch)
            continue;
        pr.headCommit = after;
        prEvent(w, pr, "synchronize", actor);
    }
}
function prEvent(w, pr, action, actor) {
    const gh = w.repos.github;
    const head = gh.branches[pr.head], base = gh.branches[pr.base];
    if (!head || !base)
        return;
    // workflows check out the test merge of the pull request into its base;
    // when that merge has conflicts GitHub cannot make it, and nothing runs
    const { tree, conflicts } = mergeTrees(w, mergeBase(w, base, head), base, head, ["base", "head"]);
    if (conflicts.length)
        return;
    triggerRuns(w, { event: "pull_request", action, branch: pr.head, base: pr.base, commit: head, tree, pr: pr.n, actor, title: pr.title, merge: [head, base] });
}
export function workflowFiles(tree) {
    return Object.keys(tree).filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).sort();
}
/* the ID gh shows for a workflow file */
export const workflowId = (file) => 70000000 + (parseInt(hash(file), 16) % 9000000);
function triggerRuns(w, ev) {
    for (const file of workflowFiles(ev.tree)) {
        let wf;
        try {
            wf = readWorkflow(ev.tree[file], file);
        }
        catch (e) {
            if (!(e instanceof GitError))
                throw e;
            // GitHub cannot tell what a broken file wanted, so the push shows a failed run
            if (ev.event === "push")
                newRun(w, file, file, ev).error = e.message;
            continue;
        }
        if (wants(wf, ev))
            runWorkflow(w, file, wf, ev);
    }
}
function strs(v) {
    if (v === undefined || v === null)
        return undefined;
    return (Array.isArray(v) ? v : [v]).map(String);
}
function wants(wf, ev) {
    if (!(ev.event in wf.on))
        return false;
    const f = wf.on[ev.event] ?? {};
    const target = ev.event === "push" ? ev.branch : ev.base;
    const br = strs(f.branches), skip = strs(f["branches-ignore"]);
    if (ev.event === "push" && !br && !skip && strs(f.tags))
        return false;
    if (br && !br.some((p) => globRe(p).test(target)))
        return false;
    if (skip && skip.some((p) => globRe(p).test(target)))
        return false;
    if (ev.event === "pull_request" && !(strs(f.types) ?? ["opened", "synchronize", "reopened"]).includes(ev.action ?? "opened"))
        return false;
    return true;
}
function newRun(w, file, name, ev) {
    const runs = (w.runs ?? (w.runs = []));
    const k = runs.length + 1;
    const run = {
        id: 19000000000 + k * 104729, workflow: name, file, event: ev.event, branch: ev.branch, commit: ev.commit,
        jobs: [], ok: false, title: ev.title, number: runs.filter((r) => r.file === file).length + 1, actor: ev.actor, annotations: [],
    };
    if (ev.pr)
        run.pr = ev.pr;
    runs.push(run);
    tick(w);
    return run;
}
function runWorkflow(w, file, wf, ev) {
    const run = newRun(w, file, wf.name, ev);
    const done = new Map();
    const art = {};
    const todo = [...wf.jobs];
    while (todo.length) {
        let i = todo.findIndex((j) => j.needs.every((n) => done.has(n)));
        if (i < 0)
            i = 0;
        const job = todo.splice(i, 1)[0];
        const id = 53000000000 + (run.id % 100000000) * 3 + run.jobs.length * 7919;
        if (job.needs.some((n) => done.get(n) === false)) {
            run.jobs.push({ name: job.name, ok: true, skipped: true, id, steps: [], secs: 0 });
            done.set(job.id, false);
            continue;
        }
        const r = runJob(w, wf, job, ev, art, run);
        run.jobs.push({ name: job.name, ok: r.ok, id, steps: r.steps, secs: r.secs });
        done.set(job.id, r.ok);
    }
    run.ok = run.jobs.every((j) => j.ok);
    if (art.pages)
        run.artifacts = ["github-pages"];
}
function runJob(w, wf, job, ev, art, run) {
    const ws = { files: null };
    const steps = [];
    const note = (message) => run.annotations.push({ job: job.name, path: ".github", line: 1, message });
    // the github-pages environment only takes deployments from the default branch
    if (job.environment === "github-pages" && (ev.event !== "push" || ev.branch !== "main")) {
        note(`Branch "${ev.event === "push" ? ev.branch : `${ev.pr}/merge`}" is not allowed to deploy to github-pages due to environment protection rules.`);
        return { ok: false, steps, secs: 0 };
    }
    const actions = uniq(job.steps.map((s) => s.uses).filter((u) => !!u && !u.startsWith("./")));
    steps.push({
        name: "Set up job", ok: true, log: [
            "Current runner version: '2.329.0'", "Runner Image", `  Image: ${job.runsOn === "ubuntu-latest" ? "ubuntu-24.04" : job.runsOn}`,
            "Prepare workflow directory", "Prepare all required actions", "Getting action download info",
            ...actions.map((a) => `Download action repository '${a}'`), `Complete job name: ${job.name}`,
        ],
    });
    let failed = false;
    const posts = [];
    for (const s of job.steps) {
        const name = s.name ? expand(String(s.name), ev, wf, run) : `Run ${s.uses ?? firstLine(String(s.run ?? ""))}`;
        if (failed) {
            steps.push({ name, ok: true, skipped: true, log: [] });
            continue;
        }
        const r = runStep(w, wf, job, s, ws, ev, art, run);
        steps.push({ name, ok: r.ok, log: r.log });
        for (const a of r.notes ?? [])
            run.annotations.push({ job: job.name, ...a });
        if (r.post)
            posts.unshift({ name: `Post ${name}`, always: r.post === "always" });
        if (!r.ok)
            failed = true;
    }
    for (const p of posts)
        steps.push(p.always || !failed ? { name: p.name, ok: true, log: ["Post job cleanup."] } : { name: p.name, ok: true, skipped: true, log: [] });
    steps.push({ name: "Complete job", ok: true, log: ["Cleaning up orphan processes"] });
    return { ok: !failed, steps, secs: 2 + steps.filter((s) => !s.skipped).length * 2 };
}
const firstLine = (s) => s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
/* ${{ github.actor }} and friends */
function expand(s, ev, wf, run) {
    const pr = ev.event === "pull_request";
    const vals = {
        "github.actor": ev.actor, "github.event_name": ev.event, "github.repository": FULL_NAME, "github.repository_owner": "you",
        "github.sha": ev.commit, "github.ref_name": pr ? `${ev.pr}/merge` : ev.branch,
        "github.ref": pr ? `refs/pull/${ev.pr}/merge` : `refs/heads/${ev.branch}`,
        "github.head_ref": pr ? ev.branch : "", "github.base_ref": pr ? ev.base ?? "" : "",
        "github.workflow": wf.name, "github.run_number": String(run.number ?? 1), "github.run_id": String(run.id), "runner.os": "Linux",
    };
    return s.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, k) => own(vals, k) ?? "");
}
function shellWords(s) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(s)))
        out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] ?? m[3]);
    return out;
}
const NODE = { "18": "18.20.8", "20": "20.19.5", "22": "22.20.0", "24": "24.11.0" };
function runStep(w, wf, job, s, ws, ev, art, run) {
    const exit = (log, code) => {
        log.push(`Error: Process completed with exit code ${code}.`);
        return { ok: false, log, code, notes: [{ path: ".github", line: 1, message: `Process completed with exit code ${code}.` }] };
    };
    const input = (k) => (s.with?.[k] === undefined || s.with[k] === null ? "" : expand(String(s.with[k]), ev, wf, run));
    if (s.uses) {
        const uses = String(s.uses);
        const head = [`Run ${uses}`, ...(s.with ? ["with:", ...Object.keys(s.with).map((k) => `  ${k}: ${input(k)}`)] : [])];
        switch (uses.toLowerCase().split("@")[0]) {
            case "actions/checkout": {
                ws.files = { ...ev.tree };
                const log = [...head, `Syncing repository: ${FULL_NAME}`, "Getting Git version info", "Initializing the repository", "Fetching the repository", "Determining the checkout info"];
                if (ev.merge) {
                    const sha = hash(ev.merge.join("+"));
                    log.push(`/usr/bin/git checkout --progress --force refs/remotes/pull/${ev.pr}/merge`, `HEAD is now at ${sha} Merge ${short(ev.merge[0])} into ${short(ev.merge[1])}`);
                }
                else {
                    log.push(`/usr/bin/git checkout --progress --force -B ${ev.branch} refs/remotes/origin/${ev.branch}`, `Switched to a new branch '${ev.branch}'`, `branch '${ev.branch}' set up to track 'origin/${ev.branch}'.`);
                }
                return { ok: true, log, post: "always" };
            }
            case "codespell-project/actions-codespell": {
                const path = input("path"), skip = input("skip"), ignore = input("ignore_words_list");
                const r = codespell(ws.files ?? {}, { path, skip, ignore });
                const cli = `${ignore ? ` --ignore-words-list ${ignore}` : ""}${skip ? ` --skip ${skip}` : ""}`;
                const log = [...head, `Running codespell on '${path}' with the following options...`, `Resulting CLI options${cli}`, ...r.lines, String(r.found.length)];
                if (!r.found.length)
                    return { ok: true, log: [...log, "Codespell found no problems"] };
                log.push("Codespell found one or more problems");
                const notes = r.found.map((f) => ({ path: f.path, line: f.line, message: `${f.word} ==> ${f.fix}` }));
                if (input("only_warn"))
                    return { ok: true, log, notes };
                const out = exit(log, 65);
                return { ...out, notes: [...notes, ...out.notes] };
            }
            case "actions/setup-node": {
                const v = input("node-version") || "20";
                const full = own(NODE, v.replace(/\D.*$/, "")) ?? (/^\d+$/.test(v) ? `${v}.0.0` : v);
                return { ok: true, post: "success", log: [...head, `Attempting to download ${v}...`, `Acquiring ${full} - x64 from https://github.com/actions/node-versions/releases/download/${full}`, "Extracting ...", "Adding to the cache ...", "Environment details", `  node: v${full}`, "  npm: 10.8.2"] };
            }
            case "actions/configure-pages":
                return { ok: true, log: [...head, `Pages site is configured for ${FULL_NAME}`] };
            case "actions/upload-pages-artifact": {
                const raw = input("path") || "_site/";
                const dir = raw.replace(/^\.\/?/, "").replace(/\/+$/, "");
                const files = Object.keys(ws.files ?? {}).sort()
                    .filter((p) => (!dir || p.startsWith(dir + "/")) && !/^\.git(hub)?\//.test(dir ? p.slice(dir.length + 1) : p));
                if (dir && !files.length)
                    return exit([...head, `tar: ${raw}: Cannot open: No such file or directory`, "tar: Error is not recoverable: exiting now"], 2);
                art.pages = true;
                return { ok: true, log: [...head, ...files.map((p) => `./${dir ? p.slice(dir.length + 1) : p}`), "Run actions/upload-artifact@v7", "With the provided path, there will be 1 file uploaded", "Artifact github-pages has been successfully uploaded!"] };
            }
            case "actions/deploy-pages": {
                const perms = job.permissions ?? wf.permissions;
                const may = (k) => perms === "write-all" || (!!perms && typeof perms === "object" && perms[k] === "write");
                const fail = (lines, message) => ({ ok: false, log: [...head, ...lines], notes: [{ path: ".github", line: 1, message }] });
                if (!may("id-token")) {
                    return fail(["Error: Error message: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable", 'Error: Ensure GITHUB_TOKEN has permission "id-token: write".'], 'Ensure GITHUB_TOKEN has permission "id-token: write".');
                }
                if (!may("pages"))
                    return fail(['Error: Ensure GITHUB_TOKEN has permission "pages: write".'], 'Ensure GITHUB_TOKEN has permission "pages: write".');
                if (!job.environment) {
                    return fail(["Error: Missing environment. Ensure your workflow's deployment job has an environment. Example:", "jobs:", "  deploy:", "    environment:", "      name: github-pages", "      url: ${{ steps.deployment.outputs.page_url }}"], "Missing environment. Ensure your workflow's deployment job has an environment.");
                }
                const meta = `Fetching artifact metadata for "github-pages" in this workflow run`;
                if (!art.pages) {
                    return fail([meta, 'Error: No artifacts named "github-pages" were found for this workflow run. Ensure artifacts are uploaded with actions/upload-artifact@v4 or later.'], 'No artifacts named "github-pages" were found for this workflow run.');
                }
                w.pages = { url: PAGES_URL, commit: ev.commit };
                return { ok: true, log: [...head, meta, "Found 1 artifact(s)", `Created deployment for ${ev.commit}, ID: ${ev.commit}`, "Getting Pages deployment status...", "Reported success!", `Your site is live at ${PAGES_URL}`] };
            }
            default:
                return { ok: true, log: [...head, `This lesson does not run ${uses}. It passes.`] };
        }
    }
    const script = expand(String(s.run ?? ""), ev, wf, run);
    const lines = script.split("\n").filter((l) => l.trim());
    const log = [`Run ${firstLine(script)}`, ...lines];
    for (const raw of lines) {
        const line = raw.trim();
        let m;
        if (line.startsWith("#") || line === "true" || line === ":")
            continue;
        if ((m = /^echo(?:\s+(.*))?$/.exec(line))) {
            log.push(shellWords(m[1] ?? "").join(" "));
            continue;
        }
        if ((m = /^exit(?:\s+(\d+))?$/.exec(line)))
            return Number(m[1] ?? 0) ? exit(log, Number(m[1])) : { ok: true, log };
        if (line === "false")
            return exit(log, 1);
        if ((m = /^codespell(?:\s+(.*))?$/.exec(line))) {
            const a = shellWords(m[1] ?? "");
            const opt = (...k) => { const i = a.findIndex((x) => k.includes(x)); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
            const r = codespell(ws.files ?? {}, { skip: opt("--skip", "-S"), ignore: opt("--ignore-words-list", "-L"), path: a.find((x) => !x.startsWith("-")) });
            log.push(...r.lines);
            if (r.found.length)
                return exit(log, 65);
        }
    }
    return { ok: true, log };
}
/* ------------------------------------------------------------ codespell
 * The spell check the CI track runs. A small part of codespell's own
 * dictionary (codespell_lib/data/dictionary.txt): common misspellings only,
 * so it never flags a word codespell would let through. */
export const MISSPELLINGS = {
    absense: "absence", acceptible: "acceptable", accidently: "accidentally", accomodate: "accommodate",
    accross: "across", acheive: "achieve", acheived: "achieved", acommodate: "accommodate", acording: "according",
    adn: "and", adress: "address", adressed: "addressed", agressive: "aggressive", alot: "a lot, allot",
    apparant: "apparent", apparantly: "apparently", appearence: "appearance", arguement: "argument",
    arguements: "arguments", awfull: "awful, awfully", basicaly: "basically", basicly: "basically",
    beautifull: "beautiful, beautifully", becomming: "becoming", becuase: "because", beggining: "beginning",
    begining: "beginning", beleive: "believe", belive: "believe", benifit: "benefit", bizzare: "bizarre",
    buisness: "business", calandar: "calendar", catagory: "category", cemetary: "cemetery", cheif: "chief",
    collegue: "colleague", comittee: "committee", comming: "coming", commited: "committed", commitee: "committee",
    completly: "completely", concious: "conscious", curiousity: "curiosity", decieve: "deceive",
    definate: "definite", definately: "definitely", definitly: "definitely", disapear: "disappear",
    dissapear: "disappear", dissapoint: "disappoint", embarass: "embarrass",
    enviroment: "environment", enviromental: "environmental", equiptment: "equipment", everytime: "every time",
    exagerate: "exaggerate", excercise: "exercise", existance: "existence", existant: "existent",
    experiance: "experience", explaination: "explanation", facinating: "fascinating", familar: "familiar",
    finaly: "finally, finale", foriegn: "foreign", fourty: "forty", foward: "forward", freind: "friend",
    freinds: "friends", futher: "further", goverment: "government", grammer: "grammar", greatful: "grateful",
    guarentee: "guarantee", happend: "happened, happens, happen", harrass: "harass", heirarchy: "hierarchy",
    hte: "the", immediatly: "immediately", independance: "independence", independant: "independent",
    intresting: "interesting", irrelevent: "irrelevant", knowlegde: "knowledge",
    knowlege: "knowledge", lenght: "length", liason: "liaison", libary: "library", maintainance: "maintenance",
    managment: "management", millenium: "millennium", miniscule: "minuscule", mispell: "misspell",
    mispelled: "misspelled", neccesary: "necessary", neccessary: "necessary", noticable: "noticeable",
    occassion: "occasion", occassionally: "occasionally", occured: "occurred", occurence: "occurrence",
    occurrance: "occurrence", ocurred: "occurred", ommit: "omit", oportunity: "opportunity",
    oppurtunity: "opportunity", orignal: "original", paralel: "parallel", paralell: "parallel",
    particulary: "particularly", percieve: "perceive", perfomance: "performance", persistant: "persistent",
    posession: "possession", posible: "possible", potatos: "potatoes", preceeding: "preceding, proceeding",
    prefered: "preferred", presance: "presence", privelege: "privilege", priviledge: "privilege",
    probaly: "probably", profesional: "professional", publically: "publicly", publicaly: "publicly",
    questionaire: "questionnaire", realy: "really, relay", reccomend: "recommend", reccommend: "recommend",
    recepie: "recipe", recieve: "receive", recieved: "received", recieves: "receives", recieving: "receiving",
    recived: "received", recomend: "recommend", refered: "referred", refrence: "reference", relevent: "relevant",
    religous: "religious", remeber: "remember", repitition: "repetition", reponse: "response", reveiw: "review",
    rythm: "rhythm", secratary: "secretary", sentance: "sentence", seperate: "separate", seperately: "separately",
    similiar: "similar", sincerley: "sincerely", sincerly: "sincerely", speach: "speech", succes: "success",
    succesful: "successful", succesfully: "successfully", sucess: "success", sumary: "summary", supress: "suppress",
    suprise: "surprise", taht: "that", teh: "the", tendancy: "tendency", thier: "their",
    thnaks: "thanks", threshhold: "threshold", tihs: "this", tommorow: "tomorrow", tommorrow: "tomorrow",
    tounge: "tongue", truely: "truly", untill: "until", usefull: "useful", vaccuum: "vacuum", visable: "visible",
    wether: "weather, whether", wich: "which", wierd: "weird", writen: "written", writting: "writing",
    wroking: "working", yeild: "yield",
};
/* codespell's way of matching case: "Teh" gives "The", "TEH" gives "THE" */
function fixCase(word, fix) {
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (word === cap(word))
        return fix.split(",").map((x) => cap(x.trim())).join(", ");
    if (word === word.toUpperCase())
        return fix.toUpperCase();
    return fix;
}
/* run codespell over a folder: hidden files and folders (.github, .gitignore)
 * are skipped, as codespell does by default */
export function codespell(files, o = {}) {
    const root = (o.path ?? "").replace(/^\.\//, "").replace(/\/+$/, "");
    const whole = !root || root === ".";
    const skips = (o.skip ?? "").split(",").map((x) => x.trim()).filter(Boolean)
        .map((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`));
    const ignore = new Set((o.ignore ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));
    const lines = [], found = [];
    for (const p of Object.keys(files).sort()) {
        if (!whole && p !== root && !p.startsWith(root + "/"))
            continue;
        if (p.split("/").some((c) => c.startsWith(".")))
            continue;
        const shown = whole ? `./${p}` : p;
        if (skips.some((re) => re.test(shown) || re.test(p) || re.test(p.split("/").pop())))
            continue;
        const text = files[p];
        if (text.includes("\0"))
            continue;
        text.split("\n").forEach((ln, k) => {
            for (const m of ln.matchAll(/[\p{L}\p{N}_'’-]+/gu)) {
                const word = m[0], lw = word.toLowerCase();
                const fix = own(MISSPELLINGS, lw);
                if (!fix || ignore.has(lw))
                    continue;
                // "\nteh" in code is an escape before a word, not a typo
                const at = m.index ?? 0;
                if (at > 0 && ln[at - 1] === "\\" && /^[abfnrtv]/.test(lw) && !own(MISSPELLINGS, lw.slice(1)))
                    continue;
                const f = fixCase(word, fix);
                found.push({ path: p, line: k + 1, word, fix: f });
                lines.push(`${shown}:${k + 1}: ${word} ==> ${f}`);
            }
        });
    }
    return { lines, found };
}
/* --------------------------------------------------- workflow files (YAML)
 * A reader for the part of YAML that workflow files use: maps, lists,
 * "- key: value" items, [flow, lists], {flow: maps}, quoted strings,
 * | and > blocks, and # comments. */
export class YamlError extends Error {
    constructor(msg, line) {
        super(msg);
        this.line = line;
    }
}
export function parseYaml(src) {
    const L = src.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    const fail = (msg, at = i) => { throw new YamlError(msg, at + 1); };
    const ind = (s) => {
        const lead = /^[ \t]*/.exec(s)[0];
        if (lead.includes("\t") && s.trim())
            fail("tabs cannot be used to indent");
        return lead.length;
    };
    const blank = (s) => /^\s*(#.*)?$/.test(s);
    const skip = () => { while (i < L.length && blank(L[i]))
        i++; };
    const isItem = (t) => t === "-" || t.startsWith("- ");
    function uncomment(s) {
        let q = "";
        for (let k = 0; k < s.length; k++) {
            const c = s[k];
            if (q) {
                if (c === "\\" && q === '"')
                    k++;
                else if (c === "'" && q === "'" && s[k + 1] === "'")
                    k++; // '' is a quote inside '...'
                else if (c === q)
                    q = "";
            }
            else if ((c === '"' || c === "'") && (k === 0 || /[\s[{,:]/.test(s[k - 1])))
                q = c;
            else if (c === "#" && (k === 0 || /\s/.test(s[k - 1])))
                return s.slice(0, k);
        }
        return s;
    }
    function keyOf(t) {
        const q = /^"((?:[^"\\]|\\.)*)"\s*:(?:\s+(.*))?$/.exec(t) ?? /^'((?:[^']|'')*)'\s*:(?:\s+(.*))?$/.exec(t);
        if (q)
            return { key: q[1], rest: q[2] ?? "" };
        const m = /^([^\s"'#[\]{},][^]*?)\s*:(?:\s+([^]*))?$/.exec(t);
        return m && !m[1].includes(": ") ? { key: m[1], rest: m[2] ?? "" } : null;
    }
    function scalar(t) {
        if (t.startsWith('"')) {
            if (!/^"(?:[^"\\]|\\.)*"$/.test(t))
                fail("found unexpected end of stream while scanning a quoted scalar");
            const esc = { n: "\n", t: "\t", '"': '"', "\\": "\\", "/": "/", "0": "\0" };
            return t.slice(1, -1).replace(/\\(.)/g, (_, c) => esc[c] ?? c);
        }
        if (t.startsWith("'")) {
            if (!/^'(?:[^']|'')*'$/.test(t))
                fail("found unexpected end of stream while scanning a quoted scalar");
            return t.slice(1, -1).replace(/''/g, "'");
        }
        if (/^(true|True|TRUE)$/.test(t))
            return true;
        if (/^(false|False|FALSE)$/.test(t))
            return false;
        if (/^(null|Null|NULL|~)?$/.test(t))
            return null;
        if (/^[-+]?\d+$/.test(t))
            return Number(t);
        if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(t))
            return Number(t);
        return t;
    }
    function flow(s) {
        let k = 0;
        const sp = () => { while (s[k] === " ")
            k++; };
        function item(stop) {
            sp();
            if (s[k] === "[" || s[k] === "{")
                return coll();
            if (s[k] === '"' || s[k] === "'") {
                const q = s[k];
                let j = k + 1;
                while (j < s.length && s[j] !== q)
                    j += s[j] === "\\" && q === '"' ? 2 : 1;
                const t = s.slice(k, j + 1);
                k = j + 1;
                return scalar(t);
            }
            let j = k;
            while (j < s.length && !stop.includes(s[j]))
                j++;
            const t = s.slice(k, j).trim();
            k = j;
            return scalar(t);
        }
        function coll() {
            const open = s[k++];
            const close = open === "[" ? "]" : "}";
            const arr = [];
            const obj = {};
            for (;;) {
                sp();
                if (s[k] === close) {
                    k++;
                    break;
                }
                if (k >= s.length)
                    fail(`did not find the closing '${close}'`);
                if (open === "[")
                    arr.push(item(",]"));
                else {
                    const key = String(item(":,}"));
                    sp();
                    if (s[k] === ":") {
                        k++;
                        obj[key] = item(",}");
                    }
                    else
                        obj[key] = null;
                }
                sp();
                if (s[k] === ",") {
                    k++;
                    continue;
                }
                if (s[k] === close) {
                    k++;
                    break;
                }
                fail(`expected ',' or '${close}'`);
            }
            return open === "[" ? arr : obj;
        }
        const v = coll();
        sp();
        if (k < s.length)
            fail("unexpected characters after a flow collection");
        return v;
    }
    function value(v) {
        return v.startsWith("[") || v.startsWith("{") ? flow(v) : scalar(v);
    }
    function block(h, n) {
        const lines = [];
        let bi = -1;
        while (i < L.length) {
            const s = L[i];
            if (!s.trim()) {
                lines.push("");
                i++;
                continue;
            }
            const k = ind(s);
            if (k <= n || (bi >= 0 && k < bi))
                break;
            if (bi < 0)
                bi = k;
            lines.push(s.slice(bi));
            i++;
        }
        let end = lines.length;
        while (end > 0 && lines[end - 1] === "")
            end--;
        const body = lines.slice(0, end);
        let text = "";
        if (h[0] === "|")
            text = body.join("\n");
        else
            body.forEach((l, k) => { text += k === 0 ? l : l === "" ? "\n" : body[k - 1] === "" ? l : " " + l; });
        if (h[1] === "-" || !body.length)
            return text;
        if (h[1] === "+")
            return text + "\n".repeat(lines.length - end + 1);
        return text + "\n";
    }
    function node() {
        skip();
        if (i >= L.length)
            return null;
        const n = ind(L[i]);
        return isItem(L[i].slice(n)) ? seq(n) : map(n);
    }
    function seq(n) {
        const out = [];
        for (;;) {
            skip();
            if (i >= L.length || ind(L[i]) < n)
                return out;
            if (ind(L[i]) > n)
                fail("bad indentation of a sequence entry");
            const t = L[i].slice(n);
            if (!isItem(t))
                return out;
            const rest = t.slice(1);
            const body = rest.trimStart();
            const v = uncomment(body).trim();
            if (!v) {
                i++;
                out.push(node());
                continue;
            }
            if (keyOf(v)) {
                // "- key: value": a map that starts on the dash's line
                const col = n + 1 + (rest.length - body.length);
                L[i] = " ".repeat(col) + body;
                out.push(map(col));
                continue;
            }
            i++;
            out.push(/^[|>][-+]?$/.test(v) ? block(v, n) : value(v));
        }
    }
    function map(n) {
        const out = {};
        for (;;) {
            skip();
            if (i >= L.length || ind(L[i]) < n)
                return out;
            if (ind(L[i]) > n)
                fail("bad indentation of a mapping entry");
            const t = L[i].slice(n);
            if (isItem(t))
                return out;
            const k = keyOf(uncomment(t).trimEnd()) ?? fail("could not find expected ':'");
            if (k.key in out)
                fail(`duplicated mapping key '${k.key}'`);
            const v = uncomment(k.rest).trim();
            i++;
            if (!v) {
                skip();
                const deeper = i < L.length && (ind(L[i]) > n || (ind(L[i]) === n && isItem(L[i].slice(n))));
                out[k.key] = deeper ? node() : null;
            }
            else if (/^[|>][-+]?$/.test(v))
                out[k.key] = block(v, n);
            else
                out[k.key] = value(v);
        }
    }
    const doc = node();
    skip();
    if (i < L.length)
        fail("expected a key or a list item here");
    return doc;
}
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/* read a workflow file the way GitHub does, or fail with GitHub's words */
export function readWorkflow(text, file = ".github/workflows/workflow.yml") {
    const bad = (line, msg) => { throw new GitError(`Invalid workflow file: ${file}#L${line}\n${msg}`); };
    const lineOf = (key) => {
        const k = text.split("\n").findIndex((l) => new RegExp(`^\\s*-?\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).test(l));
        return k + 1 || 1;
    };
    let doc;
    try {
        doc = parseYaml(text);
    }
    catch (e) {
        if (e instanceof YamlError)
            bad(e.line, `You have an error in your yaml syntax on line ${e.line}`);
        throw e;
    }
    if (!isMap(doc))
        return bad(1, "(Line: 1, Col: 1): Unexpected value");
    if (doc.on === undefined || doc.on === null)
        bad(1, "No event triggers defined in `on`");
    const on = {};
    if (typeof doc.on === "string")
        on[doc.on] = null;
    else if (Array.isArray(doc.on))
        doc.on.forEach((e) => { on[String(e)] = null; });
    else if (isMap(doc.on))
        Object.entries(doc.on).forEach(([e, f]) => { on[e] = isMap(f) ? f : null; });
    else
        bad(lineOf("on"), `(Line: ${lineOf("on")}, Col: 5): Unexpected value '${doc.on}'`);
    if (!isMap(doc.jobs) || !Object.keys(doc.jobs).length)
        bad(1, "(Line: 1, Col: 1): Required property is missing: jobs");
    const ids = Object.keys(doc.jobs);
    const jobs = ids.map((id) => {
        const j = doc.jobs[id];
        const at = lineOf(id);
        if (!isMap(j))
            return bad(at, `(Line: ${at}, Col: 3): Unexpected value '${j ?? ""}'`);
        if (j["runs-on"] === undefined || j["runs-on"] === null)
            bad(at, `(Line: ${at}, Col: 3): Required property is missing: runs-on`);
        if (!Array.isArray(j.steps) || !j.steps.length)
            bad(at, `(Line: ${at}, Col: 3): Required property is missing: steps`);
        const needs = strs(j.needs) ?? [];
        for (const n of needs)
            if (!ids.includes(n))
                bad(at, `(Line: ${at}, Col: 3): Job '${id}' depends on unknown job '${n}'.`);
        const steps = j.steps.map((s) => {
            if (!isMap(s))
                return bad(at, `(Line: ${at}, Col: 9): A step must be a map with uses: or run:`);
            if ((s.uses == null) === (s.run == null))
                bad(lineOf(s.name ? "name" : "steps"), "Every step needs either uses: or run:, not both.");
            if (s.uses != null && !/^(\.\/|docker:\/\/)/.test(String(s.uses)) && !/^[^/@\s]+\/[^@\s]+@\S+$/.test(String(s.uses)))
                bad(lineOf("uses"), `(Line: ${lineOf("uses")}, Col: 15): Expected format {org}/{repo}[/path]@ref. Actual '${s.uses}'`);
            return {
                name: s.name == null ? undefined : String(s.name),
                uses: s.uses == null ? undefined : String(s.uses),
                run: s.run == null ? undefined : String(s.run),
                with: isMap(s.with) ? s.with : undefined,
                id: s.id == null ? undefined : String(s.id),
            };
        });
        const env = j.environment;
        return {
            id, name: j.name == null ? id : String(j.name), needs, runsOn: String(j["runs-on"]), steps,
            permissions: j.permissions, environment: isMap(env) ? (env.name == null ? undefined : String(env.name)) : env == null ? undefined : String(env),
        };
    });
    return { name: doc.name == null ? file : String(doc.name), on, jobs, permissions: doc.permissions };
}
/* workflow files the lesson's tracks can write as they are */
export const WORKFLOWS = {
    spelling: [
        "name: Checks",
        "on:",
        "  pull_request:",
        "  push:",
        "    branches: [main]",
        "jobs:",
        "  spelling:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v7",
        "      - uses: codespell-project/actions-codespell@v2",
        "",
    ].join("\n"),
    pages: [
        "name: Publish",
        "on:",
        "  push:",
        "    branches: [main]",
        "permissions:",
        "  contents: read",
        "  pages: write",
        "  id-token: write",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-latest",
        "    environment:",
        "      name: github-pages",
        "      url: ${{ steps.deployment.outputs.page_url }}",
        "    steps:",
        "      - uses: actions/checkout@v7",
        "      - uses: actions/upload-pages-artifact@v5",
        "        with:",
        "          path: .",
        "      - id: deployment",
        "        uses: actions/deploy-pages@v5",
        "",
    ].join("\n"),
};
export function checksFor(w, commit) {
    const latest = new Map();
    if (commit)
        for (const r of w.runs ?? []) {
            if (r.commit !== commit)
                continue;
            for (const j of r.jobs) {
                latest.set(`${r.file}|${r.event}|${j.name}`, {
                    workflow: r.workflow, name: j.name, event: r.event, ok: j.ok, skipped: !!j.skipped, runId: r.id, jobId: j.id,
                    secs: j.secs ?? 0, url: `${WEB_URL}/actions/runs/${r.id}/job/${j.id}`,
                });
            }
        }
    return [...latest.values()];
}
export const prChecks = (w, n) => {
    const pr = prOf(w, n);
    return pr ? checksFor(w, prHead(w, pr)) : [];
};
//# sourceMappingURL=model.js.map