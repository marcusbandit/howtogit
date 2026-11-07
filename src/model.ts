/* model.ts: a small, faithful git.
 *
 * The lesson needs three repositories that talk to each other (your computer,
 * GitHub, Sam's computer), pull requests, conflicts and worktrees. Everything
 * here behaves the way real git does for the commands the lesson covers:
 * commits are immutable snapshots with parents, branches are names pointing at
 * commits, the index (staging area) sits between your files and the next
 * commit, push refuses to overwrite work you don't have, and merges are
 * three-way with real conflict markers.
 *
 * The whole world is plain JSON so it can be saved, restored and replayed.
 */

export type Files = Record<string, string>;

export interface Commit {
  id: string;
  msg: string;
  parents: string[];
  tree: Files;
  author: string;
  n: number; // creation order, used to lay commits out left to right
}

/* one folder on disk checked out from a repository. A repo normally has one;
 * `git worktree add` gives it more ("a second desk"). */
export interface Desk {
  path: string;
  branch: string | null;
  detached: string | null;
  work: Files; // the files as they are right now
  index: Files; // the staging area: what the next commit will contain
  merging: null | { theirs: string; msg: string; unmerged: string[] };
}

export interface Repo {
  id: string;
  label: string;
  bare: boolean; // GitHub's copy has no files you edit, only history
  branches: Record<string, string>;
  desks: Desk[];
  remote: null | { name: string; url: string };
  tracking: Record<string, string>; // what we last heard GitHub had: "origin/main" -> id
  upstream: Record<string, string>; // local branch -> "origin/main"
}

export interface PR {
  n: number;
  title: string;
  head: string;
  base: string;
  author: string;
  state: "open" | "merged";
  approved: boolean;
  comments: { who: string; text: string }[];
  mergeCommit?: string;
}

export interface World {
  commits: Record<string, Commit>;
  repos: Record<string, Repo>;
  folder: Files | null; // your folder before git was switched on
  prs: PR[];
  counter: number;
  vars: Record<string, string>;
}

export class GitError extends Error {}

export const REPO_URL = "https://github.com/you/my-recipe.git";
export const urlOk = (u: string) =>
  /^(https:\/\/)?github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/i.test(u) ||
  /^git@github\.com:[\w.-]+\/[\w.-]+?(\.git)?$/i.test(u);

export function freshWorld(): World {
  return {
    commits: {},
    repos: {},
    folder: {
      "recipe.md":
        "# Grandma's pancakes\n\n- 2 eggs\n- 1 cup flour\n- 1 cup milk\n\nMix everything, then fry in buter.\n",
      "shopping.txt": "eggs\nflour\n",
    },
    prs: [],
    counter: 0,
    vars: { branch: "blueberries" },
  };
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/* ---------------------------------------------------------------- basics */

function hash(s: string): string {
  // FNV-1a, twice with different seeds, as 7 hex chars. Stable per content.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return ((a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16)).slice(0, 7);
}

export const short = (id: string | undefined | null) => (id ? id.slice(0, 7) : "");

export function headId(r: Repo, d: Desk): string | undefined {
  return d.detached ?? (d.branch ? r.branches[d.branch] : undefined);
}
export function treeOf(w: World, id: string | undefined): Files {
  return id ? w.commits[id].tree : {};
}
export function ancestors(w: World, id: string | undefined): Set<string> {
  const seen = new Set<string>();
  const stack = id ? [id] : [];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...w.commits[c].parents);
  }
  return seen;
}
export const isAncestor = (w: World, a: string | undefined, b: string | undefined) =>
  !!a && !!b && ancestors(w, b).has(a);

function mergeBase(w: World, a: string, b: string): string | undefined {
  const A = ancestors(w, a);
  let best: Commit | undefined;
  for (const id of ancestors(w, b)) {
    if (A.has(id) && (!best || w.commits[id].n > best.n)) best = w.commits[id];
  }
  return best?.id;
}

const paths = (...fs: Files[]) =>
  [...new Set(fs.flatMap((f) => Object.keys(f)))].sort();

export const hasMarkers = (s: string | undefined) =>
  !!s && /^<<<<<<< /m.test(s) && /^>>>>>>> /m.test(s);

export type FileState = "saved" | "changed" | "staged" | "staged+changed" | "new" | "conflict" | "deleted" | "staged-deleted";

/* the plain-words state of each file in a desk */
export function fileStates(w: World, r: Repo, d: Desk): { path: string; state: FileState }[] {
  const head = treeOf(w, headId(r, d));
  return paths(d.work, d.index, head).map((p) => {
    const wk = d.work[p], ix = d.index[p], hd = head[p];
    let state: FileState = "saved";
    if (d.merging?.unmerged.includes(p)) state = "conflict";
    else if (wk === undefined) state = ix === undefined && hd !== undefined ? "staged-deleted" : "deleted";
    else if (ix === undefined && hd === undefined) state = "new";
    else if (ix !== hd && wk !== ix) state = "staged+changed";
    else if (ix !== hd) state = "staged";
    else if (wk !== ix) state = "changed";
    return { path: p, state };
  });
}
export const isDirty = (w: World, r: Repo, d: Desk) =>
  fileStates(w, r, d).some((f) => f.state !== "saved");

/* how many commits each side has that the other doesn't (by what we last heard) */
export function aheadBehind(w: World, r: Repo, d: Desk) {
  const up = d.branch ? r.upstream[d.branch] : undefined;
  const mine = headId(r, d);
  const theirs = up ? r.tracking[up] : undefined;
  if (!up || !mine) return null;
  const A = ancestors(w, mine), B = ancestors(w, theirs);
  let ahead = 0, behind = 0;
  A.forEach((id) => { if (!B.has(id)) ahead++; });
  B.forEach((id) => { if (!A.has(id)) behind++; });
  return { up, ahead, behind };
}

/* --------------------------------------------------------- line merging */

function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

const eq = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);

/* diff3: merge two edits of the same base, line by line */
export function merge3(
  base: string,
  ours: string,
  theirs: string,
  labels: [string, string],
): { text: string; conflict: boolean } {
  const split = (s: string) => (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");
  const o = split(base), a = split(ours), b = split(theirs);
  const ma = new Map(lcs(o, a)), mb = new Map(lcs(o, b));
  const out: string[] = [];
  let conflict = false;
  let i = 0, j = 0, k = 0;
  const chunk = (oc: string[], ac: string[], bc: string[]) => {
    if (eq(ac, bc)) out.push(...ac);
    else if (eq(oc, ac)) out.push(...bc);
    else if (eq(oc, bc)) out.push(...ac);
    else {
      conflict = true;
      out.push(`<<<<<<< ${labels[0]}`, ...ac, "=======", ...bc, `>>>>>>> ${labels[1]}`);
    }
  };
  for (;;) {
    let i2 = i;
    while (i2 < o.length && !(ma.has(i2) && mb.has(i2) && ma.get(i2)! >= j && mb.get(i2)! >= k)) i2++;
    if (i2 >= o.length) {
      chunk(o.slice(i), a.slice(j), b.slice(k));
      break;
    }
    const j2 = ma.get(i2)!, k2 = mb.get(i2)!;
    if (i2 === i && j2 === j && k2 === k) {
      out.push(o[i]);
      i++; j++; k++;
      continue;
    }
    chunk(o.slice(i, i2), a.slice(j, j2), b.slice(k, k2));
    i = i2; j = j2; k = k2;
  }
  return { text: out.join("\n") + "\n", conflict };
}

function mergeTrees(w: World, baseId: string | undefined, ours: string, theirs: string, labels: [string, string]) {
  const B = treeOf(w, baseId), O = treeOf(w, ours), T = treeOf(w, theirs);
  const tree: Files = {};
  const conflicts: string[] = [];
  for (const p of paths(B, O, T)) {
    const b = B[p], o = O[p], t = T[p];
    let v: string | undefined;
    if (o === t) v = o;
    else if (b === o) v = t;
    else if (b === t) v = o;
    else if (o !== undefined && t !== undefined) {
      const m = merge3(b ?? "", o, t, labels);
      v = m.text;
      if (m.conflict) conflicts.push(p);
    } else {
      v = o ?? t;
      conflicts.push(p);
    }
    if (v !== undefined) tree[p] = v;
  }
  return { tree, conflicts };
}

/* ------------------------------------------------------------ commands */

function newCommit(w: World, msg: string, parents: string[], tree: Files, author: string): string {
  w.counter++;
  const id = hash(JSON.stringify([msg, parents, tree, author, w.counter]));
  w.commits[id] = { id, msg, parents, tree: { ...tree }, author, n: w.counter };
  return id;
}

export function init(w: World): string {
  if (w.repos.you) return "Reinitialized existing Git repository in ~/my-recipe/.git/";
  w.repos.you = {
    id: "you", label: "Your computer", bare: false, branches: {},
    desks: [{ path: "~/my-recipe", branch: "main", detached: null, work: { ...(w.folder ?? {}) }, index: {}, merging: null }],
    remote: null, tracking: {}, upstream: {},
  };
  w.folder = null;
  return "Initialized empty Git repository in ~/my-recipe/.git/";
}

export function add(_w: World, _r: Repo, d: Desk, specs: string[]): string {
  const all = specs.some((s) => s === "." || s === "-A" || s === "--all");
  const targets = all ? paths(d.work, d.index) : specs;
  for (const p of targets) {
    if (!all && d.work[p] === undefined && d.index[p] === undefined)
      throw new GitError(`fatal: pathspec '${p}' did not match any files`);
    if (d.work[p] === undefined) delete d.index[p];
    else d.index[p] = d.work[p];
    if (d.merging) d.merging.unmerged = d.merging.unmerged.filter((x) => x !== p);
  }
  return "";
}

export function commit(w: World, r: Repo, d: Desk, msg: string, author: string, all = false, amend = false): string {
  if (!msg.trim() && !amend) throw new GitError("Aborting commit due to empty commit message.");
  if (all) for (const p of Object.keys(d.index)) {
    if (d.work[p] === undefined) delete d.index[p];
    else d.index[p] = d.work[p];
    if (d.merging) d.merging.unmerged = d.merging.unmerged.filter((x) => x !== p);
  }
  // like real git: files still marked as conflicted block the commit until you `git add` them
  if (d.merging?.unmerged.length)
    throw new GitError(`error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, then use 'git add <file>'.\nU\t${d.merging.unmerged.join("\nU\t")}`);
  const head = headId(r, d);
  if (amend) {
    if (!head) throw new GitError("fatal: You have nothing to amend.");
    if (d.merging) throw new GitError("fatal: You are in the middle of a merge -- cannot amend.");
    const old = w.commits[head];
    const id = newCommit(w, msg.trim() || old.msg, old.parents, d.index, author);
    if (d.detached) d.detached = id; else r.branches[d.branch!] = id;
    return `[${d.branch ?? "detached HEAD"} ${short(id)}] ${w.commits[id].msg}\n (replaced ${short(head)})`;
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
  if (d.merging) parents.push(d.merging.theirs);
  const id = newCommit(w, msg, parents, d.index, author);
  if (d.detached) d.detached = id;
  else r.branches[d.branch!] = id;
  const changed = paths(d.index, headTree).filter((p) => d.index[p] !== headTree[p]).length;
  d.merging = null;
  return `[${d.branch ?? "detached HEAD"}${head ? "" : " (root-commit)"} ${short(id)}] ${msg}\n ${changed} file${changed === 1 ? "" : "s"} changed`;
}

export function restore(w: World, r: Repo, d: Desk, p: string, staged = false): string {
  const head = treeOf(w, headId(r, d));
  if (staged) {
    if (head[p] === undefined) delete d.index[p];
    else d.index[p] = head[p];
    return "";
  }
  if (d.index[p] === undefined && d.work[p] === undefined)
    throw new GitError(`error: pathspec '${p}' did not match any file(s) known to git`);
  if (d.index[p] === undefined) throw new GitError(`error: '${p}' was never saved, so there is nothing to go back to`);
  d.work[p] = d.index[p];
  return "";
}

/* move a desk onto another commit, keeping uncommitted edits git can carry */
function moveDesk(w: World, r: Repo, d: Desk, target: string | undefined) {
  const from = treeOf(w, headId(r, d)), to = treeOf(w, target);
  const dirty = paths(d.work, d.index, from).filter((p) => d.work[p] !== from[p] || d.index[p] !== from[p]);
  const blocked = dirty.filter((p) => from[p] !== to[p]);
  if (blocked.length)
    throw new GitError(`error: Your local changes to the following files would be overwritten:\n\t${blocked.join("\n\t")}\nPlease commit your changes or throw them away before you switch.`);
  const work: Files = { ...to }, index: Files = { ...to };
  for (const p of dirty) {
    if (d.work[p] === undefined) delete work[p]; else work[p] = d.work[p];
    if (d.index[p] === undefined) delete index[p]; else index[p] = d.index[p];
  }
  d.work = work;
  d.index = index;
}

function deskUsing(r: Repo, branch: string, except: Desk) {
  return r.desks.find((x) => x !== except && x.branch === branch && !x.detached);
}

export function switchTo(w: World, r: Repo, d: Desk, name: string, opts: { create?: boolean; detach?: boolean; start?: string } = {}): string {
  if (d.merging) throw new GitError("error: you need to finish the merge first (fix the conflict, then commit).");
  if (opts.detach) {
    const id = resolve(w, r, name);
    if (!id) throw new GitError(`fatal: invalid reference: ${name}`);
    moveDesk(w, r, d, id);
    d.detached = id;
    return `HEAD is now at ${short(id)} ${w.commits[id].msg}\nYou are looking at an old version. Switch back to a branch to keep working.`;
  }
  if (opts.create) {
    if (r.branches[name]) throw new GitError(`fatal: a branch named '${name}' already exists`);
    const at = opts.start ? resolve(w, r, opts.start) : headId(r, d);
    if (!at) throw new GitError("fatal: you need at least one commit before you can make a branch");
    if (!/^[\w./-]+$/.test(name)) throw new GitError(`fatal: '${name}' is not a valid branch name`);
    moveDesk(w, r, d, at);
    r.branches[name] = at;
    d.branch = name;
    d.detached = null;
    return `Switched to a new branch '${name}'`;
  }
  if (!r.branches[name]) {
    const remote = r.tracking[`origin/${name}`];
    if (!remote) throw new GitError(`fatal: invalid reference: ${name}`);
    r.branches[name] = remote;
    r.upstream[name] = `origin/${name}`;
  }
  const other = deskUsing(r, name, d);
  if (other) throw new GitError(`fatal: '${name}' is already checked out at '${other.path}'`);
  if (d.branch === name && !d.detached) return `Already on '${name}'`;
  moveDesk(w, r, d, r.branches[name]);
  d.branch = name;
  d.detached = null;
  return `Switched to branch '${name}'`;
}

export function resolve(w: World, r: Repo, ref: string): string | undefined {
  if (r.branches[ref]) return r.branches[ref];
  if (r.tracking[ref]) return r.tracking[ref];
  if (ref === "HEAD") return undefined;
  if (/^[0-9a-f]{4,}$/i.test(ref)) {
    const have = known_(w, r);
    const known = Object.keys(w.commits).filter((id) => id.startsWith(ref.toLowerCase()) && have.has(id));
    if (known.length === 1) return known[0];
  }
  return undefined;
}

/* every commit this repo has */
export function known_(w: World, r: Repo): Set<string> {
  const s = new Set<string>();
  const roots = [...Object.values(r.branches), ...Object.values(r.tracking), ...r.desks.map((d) => d.detached).filter(Boolean) as string[]];
  roots.forEach((id) => ancestors(w, id).forEach((x) => s.add(x)));
  return s;
}

export function branch(w: World, r: Repo, d: Desk, name?: string, del?: "-d" | "-D"): string {
  if (del) {
    if (!name) throw new GitError("fatal: branch name required");
    if (!r.branches[name]) throw new GitError(`error: branch '${name}' not found`);
    const using = r.desks.find((x) => x.branch === name && !x.detached);
    if (using) throw new GitError(`error: cannot delete branch '${name}' used by worktree at '${using.path}'`);
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
  if (r.branches[name]) throw new GitError(`fatal: a branch named '${name}' already exists`);
  const at = headId(r, d);
  if (!at) throw new GitError("fatal: you need at least one commit before you can make a branch");
  r.branches[name] = at;
  return "";
}

export function remoteAdd(w: World, r: Repo, name: string, url: string): string {
  if (r.remote) throw new GitError(`error: remote ${r.remote.name} already exists.`);
  if (!urlOk(url)) throw new GitError(`fatal: '${url}' does not look like a GitHub address (try ${REPO_URL})`);
  r.remote = { name, url };
  void w;
  return "";
}

function github(w: World): Repo {
  if (!w.repos.github) {
    w.repos.github = { id: "github", label: "GitHub", bare: true, branches: {}, desks: [], remote: null, tracking: {}, upstream: {} };
  }
  return w.repos.github;
}

export function push(w: World, r: Repo, d: Desk, remote?: string, br?: string, setUp = false): string {
  if (!r.remote) throw new GitError("fatal: No configured push destination.\nAdd GitHub as a remote first: git remote add origin <address>");
  if (remote && remote !== r.remote.name) throw new GitError(`fatal: '${remote}' does not appear to be a git repository (your remote is called '${r.remote.name}')`);
  const name = br ?? d.branch;
  if (!name) throw new GitError("fatal: You are not currently on a branch.");
  if (!br && !setUp && !r.upstream[name]) {
    throw new GitError(`fatal: The current branch ${name} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push -u ${r.remote.name} ${name}`);
  }
  const local = r.branches[name];
  if (!local) throw new GitError(`error: src refspec ${name} does not match any`);
  const gh = github(w);
  const there = gh.branches[name];
  const out = [`To ${r.remote.url.replace(/^https:\/\//, "")}`];
  if (there === local) {
    if (setUp) r.upstream[name] = `${r.remote.name}/${name}`;
    r.tracking[`${r.remote.name}/${name}`] = local;
    return "Everything up-to-date";
  }
  if (there && !isAncestor(w, there, local)) {
    throw new GitError(`${out[0]}\n ! [rejected]        ${name} -> ${name} (fetch first)\nerror: failed to push some refs\nhint: GitHub has work that you do not have on this computer.\nhint: Pull first (git pull), then push again.`);
  }
  gh.branches[name] = local;
  r.tracking[`${r.remote.name}/${name}`] = local;
  if (setUp) r.upstream[name] = `${r.remote.name}/${name}`;
  out.push(there ? `   ${short(there)}..${short(local)}  ${name} -> ${name}` : ` * [new branch]      ${name} -> ${name}`);
  if (setUp) out.push(`branch '${name}' set up to track '${r.remote.name}/${name}'.`);
  return out.join("\n");
}

export function fetch(w: World, r: Repo): string {
  if (!r.remote) throw new GitError("fatal: no remote to fetch from");
  const gh = github(w);
  const lines: string[] = [];
  for (const [b, id] of Object.entries(gh.branches)) {
    const key = `${r.remote.name}/${b}`;
    if (r.tracking[key] !== id) lines.push(`   ${short(r.tracking[key]) || "[new]"}..${short(id)}  ${b} -> ${key}`);
    r.tracking[key] = id;
  }
  return lines.length ? `From ${r.remote.url.replace(/^https:\/\//, "")}\n${lines.join("\n")}` : "";
}

export function merge(w: World, r: Repo, d: Desk, ref: string, author: string, label?: string): string {
  if (ref === "--abort") {
    if (!d.merging) throw new GitError("fatal: There is no merge to abort (MERGE_HEAD missing).");
    const tree = treeOf(w, headId(r, d));
    d.work = { ...tree };
    d.index = { ...tree };
    d.merging = null;
    return "";
  }
  if (d.merging) throw new GitError("error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, then commit, or use 'git merge --abort'.");
  const theirs = resolve(w, r, ref);
  if (!theirs) throw new GitError(`merge: ${ref} - not something we can merge`);
  const mine = headId(r, d);
  if (!mine || isAncestor(w, theirs, mine)) return "Already up to date.";
  if (isAncestor(w, mine, theirs)) {
    moveDesk(w, r, d, theirs);
    if (d.detached) d.detached = theirs; else r.branches[d.branch!] = theirs;
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
  if (blocked.length) throw new GitError(`error: Your local changes to the following files would be overwritten by merge:\n\t${blocked.join("\n\t")}\nPlease commit your changes or stash them before you merge.`);
  const keep = (into: Files, from: Files) => dirty.forEach((p) => { if (from[p] === undefined) delete into[p]; else into[p] = from[p]; });
  const msg = `Merge ${ref.includes("/") ? "remote-tracking branch" : "branch"} '${ref}'`;
  if (!conflicts.length) {
    const id = newCommit(w, msg, [mine, theirs], tree, author);
    r.branches[d.branch!] = id;
    const oldWork = d.work, oldIndex = d.index;
    d.work = { ...tree };
    d.index = { ...tree };
    keep(d.work, oldWork);
    keep(d.index, oldIndex);
    return `Merge made by the 'ort' strategy.\n[${d.branch} ${short(id)}] ${msg}`;
  }
  const ours = treeOf(w, mine);
  d.work = { ...tree };
  d.index = { ...tree };
  // the conflicted file sits in the work tree with markers; the index keeps ours
  // until you `git add` the fixed file
  for (const p of conflicts) d.index[p] = ours[p] ?? "";
  d.merging = { theirs, msg, unmerged: [...conflicts] };
  return conflicts.map((p) => `Auto-merging ${p}\nCONFLICT (content): Merge conflict in ${p}`).join("\n") +
    "\nAutomatic merge failed; fix conflicts and then commit the result.";
}

export function pull(w: World, r: Repo, d: Desk, author: string): string {
  if (!d.branch) throw new GitError("fatal: You are not currently on a branch.");
  const up = r.upstream[d.branch];
  if (!up) throw new GitError(`There is no tracking information for the current branch.\nTry: git pull ${r.remote?.name ?? "origin"} ${d.branch}`);
  const f = fetch(w, r);
  const m = merge(w, r, d, up, author, up);
  return [f, m].filter(Boolean).join("\n");
}

export function cloneTo(w: World, id: string, label: string, url: string, path: string): string {
  if (!urlOk(url)) throw new GitError(`fatal: repository '${url}' not found`);
  const gh = w.repos.github;
  if (!gh || !gh.branches.main) throw new GitError(`fatal: repository '${url}' not found`);
  if (w.repos[id]) throw new GitError(`fatal: destination path 'my-recipe' already exists and is not an empty directory.`);
  const tracking: Record<string, string> = {};
  for (const [b, c] of Object.entries(gh.branches)) tracking[`origin/${b}`] = c;
  const tree = treeOf(w, gh.branches.main);
  w.repos[id] = {
    id, label, bare: false,
    branches: { main: gh.branches.main },
    desks: [{ path, branch: "main", detached: null, work: { ...tree }, index: { ...tree }, merging: null }],
    remote: { name: "origin", url }, tracking, upstream: { main: "origin/main" },
  };
  return `Cloning into 'my-recipe'...\nReceiving objects: 100% (${ancestors(w, gh.branches.main).size} commits), done.`;
}

export function worktreeAdd(w: World, r: Repo, path: string, newBranch: string | undefined, start: string | undefined): string {
  if (r.desks.some((d) => d.path.endsWith(path.replace(/^\.\.\//, "")))) throw new GitError(`fatal: '${path}' already exists`);
  const base = start ? resolve(w, r, start) : headId(r, r.desks[0]);
  if (!base) throw new GitError(`fatal: invalid reference: ${start}`);
  let br = newBranch;
  if (br) {
    if (r.branches[br]) throw new GitError(`fatal: a branch named '${br}' already exists`);
    r.branches[br] = base;
  } else {
    br = start && r.branches[start] ? start : undefined;
    if (br && r.desks.some((x) => x.branch === br && !x.detached)) throw new GitError(`fatal: '${br}' is already checked out`);
  }
  const tree = treeOf(w, base);
  const full = "~/" + path.replace(/^\.\.\//, "").replace(/^~\//, "");
  r.desks.push({ path: full, branch: br ?? null, detached: br ? null : base, work: { ...tree }, index: { ...tree }, merging: null });
  return `Preparing worktree (new branch '${br}')\nHEAD is now at ${short(base)} ${w.commits[base].msg}`;
}

/* ------------------------------------------------------------ GitHub PRs */

export function prCreate(w: World, head: string, base: string, title: string, author: string): string {
  const gh = w.repos.github;
  if (!gh?.branches[head]) throw new GitError(`aborted: you must first push the branch '${head}' to GitHub`);
  if (!gh.branches[base]) throw new GitError(`base branch '${base}' not found on GitHub`);
  if (head === base) throw new GitError("a pull request needs two different branches");
  const open = w.prs.find((p) => p.head === head && p.state === "open");
  if (open) throw new GitError(`a pull request for branch "${head}" already exists: #${open.n}`);
  const n = w.prs.length + 1;
  w.prs.push({ n, title, head, base, author, state: "open", approved: false, comments: [] });
  return `https://github.com/you/my-recipe/pull/${n}`;
}

export function prMerge(w: World, n: number, author: string): string {
  const pr = w.prs.find((p) => p.n === n);
  if (!pr) throw new GitError(`no pull request found for #${n}`);
  if (pr.state === "merged") throw new GitError(`pull request #${n} was already merged`);
  const gh = w.repos.github;
  const base = gh.branches[pr.base], head = gh.branches[pr.head];
  const mb = mergeBase(w, base, head);
  const { tree, conflicts } = mergeTrees(w, mb, base, head, ["base", "head"]);
  if (conflicts.length) throw new GitError("Pull request is not mergeable: the branches have conflicts.");
  const id = newCommit(w, `Merge pull request #${n} from you/${pr.head}`, [base, head], tree, author);
  gh.branches[pr.base] = id;
  pr.state = "merged";
  pr.mergeCommit = id;
  return `✓ Merged pull request #${n} (${pr.title})`;
}

/* diff between two versions of a file, for the PR page and git diff */
export function lineDiff(a: string | undefined, b: string | undefined): { t: " " | "+" | "-"; s: string }[] {
  const lines = (s: string | undefined) => (s === undefined || s === "" ? [] : s.replace(/\n$/, "").split("\n"));
  const A = lines(a), B = lines(b);
  const m = lcs(A, B);
  const out: { t: " " | "+" | "-"; s: string }[] = [];
  let i = 0, j = 0;
  for (const [x, y] of [...m, [A.length, B.length] as [number, number]]) {
    while (i < x) out.push({ t: "-", s: A[i++] });
    while (j < y) out.push({ t: "+", s: B[j++] });
    if (x < A.length) out.push({ t: " ", s: A[x] });
    i = x + 1; j = y + 1;
  }
  return out;
}
