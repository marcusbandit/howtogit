/* repo.ts — the real git backend.
 *
 * The lesson's local repository is a real git repository, run by isomorphic-git
 * on a tiny in-memory filesystem entirely in the browser. `git init`, `git add`
 * and `git commit` genuinely execute and write real .git objects/refs/HEAD; the
 * file states the sidebar shows come from real `git.statusMatrix`, not a
 * hand-coded model. To move along the timeline we just replay the commands from
 * scratch (the repo is tiny, so this is effectively instant), with a fixed
 * author + timestamp so object hashes stay stable across replays.
 *
 * This module owns the repo and exposes a small surface: `replayTo(cmds)` and
 * `snapshot()`. app.ts renders whatever snapshot() returns; it no longer authors
 * file state itself for the init/add/commit flow.
 */
import * as git from "./vendor/isomorphic-git.mjs";

// ---- a minimal in-memory filesystem satisfying isomorphic-git -----------
// Stores each path as a node; binary content as Uint8Array. Paths are posix and
// normalised (so `/my-site/.` resolves to `/my-site`, which the git walker needs).
interface FsNode { type: "file" | "dir"; content?: Uint8Array; mode: number; mtimeMs: number }
class MemFs {
  private nodes = new Map<string, FsNode>([["/", { type: "dir", mode: 0o040000, mtimeMs: 1 }]]);
  private enc = new TextEncoder();
  private dec = new TextDecoder();
  promises = {
    readFile: async (path: string, opts?: unknown): Promise<Uint8Array | string> => {
      const n = this.nodes.get(norm(path));
      if (!n || n.type !== "file") throw enoent(path);
      const encoding = typeof opts === "string" ? opts : (opts as { encoding?: string } | undefined)?.encoding;
      return encoding ? this.dec.decode(n.content) : (n.content as Uint8Array);
    },
    writeFile: async (path: string, data: Uint8Array | string): Promise<void> => {
      const content = typeof data === "string" ? this.enc.encode(data) : new Uint8Array(data);
      this.ensureParents(path);
      this.nodes.set(norm(path), { type: "file", content, mode: 0o100644, mtimeMs: Date.now() });
    },
    unlink: async (path: string): Promise<void> => { this.nodes.delete(norm(path)); },
    readdir: async (path: string): Promise<string[]> => {
      const base = norm(path), pre = base === "/" ? "/" : base + "/";
      // honour the fs contract git depends on: missing -> ENOENT, a file -> ENOTDIR
      const node = this.nodes.get(base);
      if (base !== "/" && !node) throw enoent(path);
      if (node && node.type !== "dir") throw Object.assign(new Error(`ENOTDIR: ${path}`), { code: "ENOTDIR" });
      const set = new Set<string>();
      for (const k of this.nodes.keys()) {
        if (k !== base && k.startsWith(pre)) { const seg = k.slice(pre.length).split("/")[0]; if (seg) set.add(seg); }
      }
      return [...set];
    },
    mkdir: async (path: string): Promise<void> => {
      const k = norm(path);
      this.ensureParents(path);   // git mkdirs .git/hooks without first mkdir-ing .git
      if (!this.nodes.has(k)) this.nodes.set(k, { type: "dir", mode: 0o040000, mtimeMs: Date.now() });
    },
    rmdir: async (path: string): Promise<void> => { this.nodes.delete(norm(path)); },
    stat: async (path: string) => { const n = this.nodes.get(norm(path)); if (!n) throw enoent(path); return statOf(n); },
    lstat: async (path: string) => { const n = this.nodes.get(norm(path)); if (!n) throw enoent(path); return statOf(n); },
    readlink: async (): Promise<string> => { throw Object.assign(new Error("EINVAL"), { code: "EINVAL" }); },
    symlink: async (): Promise<void> => { throw Object.assign(new Error("ENOSYS"), { code: "ENOSYS" }); },
  };
  // create any missing ancestor directory nodes for a path
  private ensureParents(path: string): void {
    const parts = norm(path).split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur += "/" + parts[i];
      if (!this.nodes.has(cur)) this.nodes.set(cur, { type: "dir", mode: 0o040000, mtimeMs: Date.now() });
    }
  }
  // does a path exist (used to tell whether .git is present yet)
  async exists(path: string): Promise<boolean> { return this.nodes.has(norm(path)); }
  // list immediate children with their kind, for walking
  async list(path: string): Promise<Array<{ name: string; isDir: boolean }>> {
    const names = await this.promises.readdir(path);
    const base = norm(path);
    return Promise.all(names.map(async (name) => ({ name, isDir: (await this.promises.stat(`${base}/${name}`)).isDirectory() })));
  }
}
function norm(p: string): string {
  const out: string[] = [];
  for (const seg of String(p).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop(); else out.push(seg);
  }
  return "/" + out.join("/");
}
const enoent = (p: string): Error => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
function statOf(n: FsNode) {
  return {
    type: n.type, mode: n.mode, size: n.content ? n.content.length : 0,
    ino: 0, mtimeMs: n.mtimeMs, ctimeMs: n.mtimeMs, uid: 1, gid: 1, dev: 1,
    isFile: () => n.type === "file", isDirectory: () => n.type === "dir", isSymbolicLink: () => false,
  };
}

// ---- the repo --------------------------------------------------------
const DIR = "/my-site";
const GITDIR = `${DIR}/.git`;
// fixed so commits (and therefore object hashes) are identical every replay
const AUTHOR = { name: "you", email: "you@my-site.dev", timestamp: 1700000000, timezoneOffset: 0 };

// the working files that exist before any git, kept here so the repo is the one
// place that seeds the project on disk
export const PROJECT_FILES: Record<string, string> = {
  "index.html": "<!DOCTYPE html>\n<html>\n  <body>\n    <h1>my site</h1>\n  </body>\n</html>\n",
  "style.css": "body {\n  font-family: sans-serif;\n  margin: 0;\n}\nh1 {\n  color: #2e5c9e;\n}\n",
  "app.js": "const btn = document.querySelector(\"button\");\n\nbtn.addEventListener(\"click\", () => {\n  alert(\"hello from my site\");\n});\n",
};

// the git-changing commands the lesson can replay
export type RepoCmd =
  | { kind: "init" }
  | { kind: "add"; filepath?: string }
  | { kind: "commit"; message: string };

let fs = new MemFs();

async function reset(): Promise<void> {
  fs = new MemFs();
  await fs.promises.mkdir(DIR);
  for (const [name, content] of Object.entries(PROJECT_FILES)) {
    await fs.promises.writeFile(`${DIR}/${name}`, content);
  }
}

async function runOne(cmd: RepoCmd): Promise<void> {
  switch (cmd.kind) {
    case "init": await git.init({ fs, dir: DIR, defaultBranch: "main" }); break;
    case "add": await git.add({ fs, dir: DIR, filepath: cmd.filepath ?? "." }); break;
    case "commit": await git.commit({ fs, dir: DIR, message: cmd.message, author: AUTHOR }); break;
  }
}

// wipe and replay the given commands from scratch; the repo is the source of truth
export async function replayTo(cmds: RepoCmd[]): Promise<void> {
  await reset();
  for (const c of cmds) await runOne(c);
}

// ---- snapshot: what the renderer needs -------------------------------
export type FileBase = "plain" | "untracked" | "modified" | "staged" | "committed";
export interface ProjFile { name: string; state: FileBase }
export interface GitNode {
  name: string;
  path: string;          // a stable key for open-state + the editor
  isDir: boolean;
  note: string;          // brief label shown on hover
  readable?: boolean;    // file: show real content vs a description
  content?: string;      // a readable file's real contents
  explain?: string;      // a readable file: what it does + why (shown with its content)
  desc?: string;         // a not-meant-to-be-read file's purpose
  children?: GitNode[];
}
export interface Snapshot { inited: boolean; files: ProjFile[]; git: GitNode[] }

// derive a friendly state from a statusMatrix row [filepath, head, work, stage]
function baseState(row: [string, number, number, number] | undefined): FileBase {
  if (!row) return "untracked";
  const [, head, work, stage] = row;
  if (head === 0 && stage === 0) return "untracked";       // not tracked at all
  if (head === 0 && stage > 0) return "staged";            // newly added
  if (work === 1) return "committed";                      // matches HEAD, clean
  if (stage >= 2) return "staged";                         // modified AND staged
  return "modified";                                        // changed, not staged
}

// the curated, described view of .git (real entries). `note` is the brief
// hover label; readable files carry `explain` (what they do + why, shown with
// their contents on click), non-readable ones carry `desc`. We hide the
// plumbing nobody needs (hooks/, info/, the empty objects subdirs). description
// is intentionally absent: isomorphic-git's init never creates it.
const TOP_SHOW = new Set(["HEAD", "config", "objects", "refs", "index"]);
const READABLE = new Set(["HEAD", "config"]);
interface Described { note: string; readable: boolean; explain?: string; desc?: string }
function describe(name: string, rel: string, isDir: boolean): Described {
  if (rel === "HEAD") return {
    note: "where you're working right now", readable: true,
    explain: "Think of HEAD as a bookmark that says “you are here.” Right now it's on main, so everything you save gets added to main. If you move to a different part of your project later, the bookmark just comes along with you.",
  };
  if (rel === "config") return {
    note: "your project's settings", readable: true,
    explain: "This is your project's settings page. git filled in some sensible defaults to start you off; later, things like your name or where to back the project up online get saved here too. You rarely touch it by hand.",
  };
  if (rel === "index") return {
    note: "what's packed for your next save", readable: false,
    desc: "Think of this as a packing box for your next save. “git add” drops your changes into the box, then “git commit” seals it into a snapshot. It's just a checklist git keeps for itself, not something you read.",
  };
  if (rel === "objects") return { note: "every version of your work, kept safe", readable: false };
  if (rel === "refs") return { note: "names that point at your saves", readable: false };
  if (rel === "refs/heads") return { note: "your branches", readable: false };
  if (rel === "refs/tags") return { note: "your tags", readable: false };
  if (/^objects\/[0-9a-f]{2}$/.test(rel)) return { note: "saves whose id starts with these two characters", readable: false };
  if (/^objects\/[0-9a-f]{2}\/[0-9a-f]+$/.test(rel)) return {
    note: "one stored snapshot", readable: false,
    desc: "This is one of your saved snapshots, squished down so it takes less room and locked so it can never change. git keeps every version of your work in here and pulls them back out for you, you never open these yourself.",
  };
  if (/^refs\/heads\//.test(rel)) return {
    note: "this branch → its latest save", readable: true,
    explain: "A branch like main is really just a sticky note with the id of your latest save written on it. Every time you save, git updates the note to point at the new one. That's the whole trick.",
  };
  if (/^refs\/tags\//.test(rel)) return {
    note: "a tag → a fixed save", readable: true,
    explain: "A tag is a sticky note pinned to one exact save and left there, a permanent name for a moment in your project (like a release). Unlike a branch, it never moves.",
  };
  return { note: "", readable: !isDir && READABLE.has(name) };
}

// walk a .git directory into the curated GitNode tree
async function walkGit(absPath: string, rel: string): Promise<GitNode[]> {
  const entries = await fs.list(absPath);
  // hide the empty/plumbing object subdirs and keep a sensible order
  const visible = entries.filter((e) => {
    if (rel === "" && !TOP_SHOW.has(e.name)) return false;          // top of .git: only the curated set
    if (rel === "objects" && (e.name === "info" || e.name === "pack")) return false;
    return true;
  });
  const order = ["HEAD", "config", "description", "index", "objects", "refs", "heads", "tags"];
  visible.sort((a, b) => {
    const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
  });
  const nodes: GitNode[] = [];
  for (const e of visible) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const d = describe(e.name, childRel, e.isDir);
    // object ids are 38-hex names that aren't worth reading; show a short stub
    // (the full name stays in `path` for the editor + uniqueness)
    const display = e.isDir ? `${e.name}/`
      : (/^[0-9a-f]{16,}$/i.test(e.name) ? `${e.name.slice(0, 7)}…` : e.name);
    const node: GitNode = { name: display, path: `.git/${childRel}`, isDir: e.isDir, note: d.note };
    if (e.isDir) {
      node.children = await walkGit(`${absPath}/${e.name}`, childRel);
    } else if (d.readable) {
      node.readable = true;
      node.content = (await fs.promises.readFile(`${absPath}/${e.name}`, "utf8") as string).replace(/\n+$/, "");
      if (d.explain) node.explain = d.explain;
    } else {
      node.desc = d.desc ?? "This file isn't meant to be read by hand.";
    }
    nodes.push(node);
  }
  return nodes;
}

// the full picture for the renderer: are we a repo yet, the project files with
// their real states, and the curated .git tree
export async function snapshot(): Promise<Snapshot> {
  const inited = await fs.exists(GITDIR);
  const names = Object.keys(PROJECT_FILES);
  let files: ProjFile[];
  if (!inited) {
    files = names.map((name) => ({ name, state: "plain" as FileBase }));
  } else {
    const matrix = await git.statusMatrix({ fs, dir: DIR, filepaths: ["."] });
    const byName = new Map(matrix.map((r) => [r[0], r] as const));
    files = names.map((name) => ({ name, state: baseState(byName.get(name)) }));
  }
  const gitTree = inited ? await walkGit(GITDIR, "") : [];
  return { inited, files, git: gitTree };
}
