/* explain.ts: what each part of a command means, and other ways to write it.
 *
 * Shown on demand under "Under the hood" (hover or tap "explain"), never in
 * the way: the lesson runs the command for you, this is for the curious.
 */

export type Kind = "program" | "command" | "flag" | "value";
export interface Explained {
  parts: { t: string; means: string; kind: Kind }[];
  also: { cmd: string; means: string }[];
  flags: boolean; // any flags in it, so the note on flags is shown
  docs?: string; // the official manual page for the command
}

/* short flags and the long names they stand for */
const LONG: Record<string, string> = {
  "-m": "--message", "-u": "--set-upstream", "-c": "--create", "-A": "--all", "-a": "--all",
  "-p": "--patch", "-b": "--branch", "-v": "--verbose", "-S": "--staged",
};

const tokens = (cmd: string): string[] => cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

export function explain(cmd: string): Explained | null {
  const t = tokens(cmd);
  if (!t.length) return null;
  const parts: Explained["parts"] = [];
  const also: Explained["also"] = [];
  const P = (tok: string, means: string, kind?: Kind) => {
    const k: Kind = kind ?? (parts.length === 0 ? "program" : /^-/.test(tok) ? "flag" : parts.length === 1 || (parts.length === 2 && /^(remote|worktree|pr)$/.test(parts[1].t)) ? "command" : "value");
    const long = k === "flag" && LONG[tok] ? ` Short for ${LONG[tok]}.` : "";
    // the kind tag already says flag or value, so the text doesn't repeat it
    const text = means.replace(/^a (flag|value)( that tells| meaning|:)?\s*/i, (_m, _k, how) => (how && /tells/.test(how) ? "tells " : ""));
    parts.push({ t: tok, means: text + long, kind: k });
  };
  const A = (c: string, means: string) => also.push({ cmd: c, means });

  if (t[0] === "gh") {
    P("gh", "GitHub's own command line tool (git itself knows nothing about pull requests)");
    if (t[1] === "pr") P("pr", "work with pull requests");
    if (t[2] === "create") {
      P("create", "open a new pull request");
      for (let i = 3; i < t.length; i++) {
        if (t[i] === "--title") { P("--title", "a flag: the value after it is the title people see on GitHub"); P(t[i + 1] ?? "", "the title", "value"); i++; }
        else if (t[i] === "--base") { P("--base", "a flag: the value after it is the branch the change should go into"); P(t[i + 1] ?? "", "that branch", "value"); i++; }
        else if (t[i] === "--head") { P("--head", "a flag: the value after it is the branch that has your change"); P(t[i + 1] ?? "", "that branch", "value"); i++; }
      }
      A("the Create pull request button on github.com", "the same thing, in the browser");
    }
    if (t[2] === "merge") {
      P("merge", "merge a pull request on GitHub");
      if (t[3]) P(t[3], "which pull request, by its number");
      if (t.includes("--merge")) P("--merge", "a flag choosing how to merge: keep every commit and add a merge commit (squash and rebase are the other styles)");
      A("the Merge pull request button on github.com", "the same thing, in the browser");
    }
    return { parts, also, flags: parts.some((p) => p.kind === "flag"), docs: "https://cli.github.com/manual/gh_pr" };
  }
  if (t[0] !== "git") return null;
  P("git", "the git program");
  const sub = t[1];
  const rest = t.slice(2);
  switch (sub) {
    case "init":
      P("init", "turn this folder into a repository (it adds a hidden .git folder)");
      break;
    case "add":
      P("add", "stage changes: choose what goes into the next commit");
      rest.forEach((x) => P(x, x === "." ? "everything that changed, but only in the folder you're in and the folders below it" : x === "-A" ? "every change in the whole repository, no matter which folder you're in: new files, edits and deleted files." : `just this file`));
      if (rest.includes("-A")) {
        A("git add .", "only the folder you're in and below. From a subfolder, changes elsewhere get left out, a common surprise");
        A("git add report.md", "just one file");
      } else if (rest.includes(".")) {
        A("git add -A", "every change in the whole repository, wherever you are (the safer habit)");
        A("git add report.md", "just one file");
      } else { A("git add -A", "every change in the repository"); A("git add -p", "go through the changes piece by piece and pick"); }
      break;
    case "commit": {
      P("commit", "keep what's staged as a new version");
      const m = rest.indexOf("-m");
      if (m >= 0) {
        P("-m", "a flag that tells commit the value right after it is the commit message, so git doesn't open an editor to ask you for one.");
        if (rest[m + 1]) P(rest[m + 1], "the commit message itself (the quotes keep the words together as one value)", "value");
      }
      if (rest.includes("-am")) P("-am", "two short flags written together: -a stages every changed file git already knows, -m takes the message.");
      A("git commit", "without -m, git opens an editor for you to write the message");
      A('git commit -am "message"', "stage all changed files and commit in one go (new files still need git add)");
      break;
    }
    case "restore":
      P("restore", "put a file back the way it was in the last version");
      rest.forEach((x) => P(x, x === "--staged" ? "a flag: un-stage instead, taking it out of the box but keeping the change" : x === "." ? "every file" : "the file to put back"));
      A("git restore .", "put back every changed file");
      A("git restore --staged report.md", "un-stage a file but keep your change");
      break;
    case "log":
      P("log", "show the history: the list of commits");
      if (rest.includes("--oneline")) P("--oneline", "a flag: one short line per commit instead of the full details");
      A("git log", "the full history, with author and date");
      A("git log --graph --oneline", "draw the branches as lines, like the picture here");
      break;
    case "switch":
      P("switch", "move to another branch or version (your files change to match)");
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "-c") { P("-c", "a flag: create the branch first, then switch to it."); P(rest[i + 1] ?? "", "the new branch's name", "value"); i++; }
        else if (rest[i] === "--detach") { P("--detach", "a flag: look at an old version without being on any branch"); P(rest[i + 1] ?? "", "the version's ID (the short code on each commit)", "value"); i++; }
        else P(rest[i], "the branch to move to");
      }
      A("git checkout main", "the older command that does the same");
      A("git switch -c new-idea", "make a new branch and move onto it");
      break;
    case "checkout":
      P("checkout", "move to another branch or commit; your files change to match it");
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "-b") { P("-b", "create the branch first, then move onto it."); P(rest[i + 1] ?? "", "the new branch's name", "value"); i++; }
        else if (/^[0-9a-f]{5,}$/.test(rest[i])) P(rest[i], "a commit ID: look at that old version (git calls this a detached HEAD: you're not on any branch)", "value");
        else P(rest[i], "the branch to move to");
      }
      if (rest.includes("-b")) { A("git switch -c new-idea", "the newer command for the same thing"); A("git branch new-idea", "make the branch but stay where you are"); }
      else if (rest.some((x) => /^[0-9a-f]{5,}$/.test(x))) { A("git switch --detach <id>", "the newer command for the same thing"); A("git checkout main", "go back to the newest commit on main"); }
      else { A("git switch main", "the newer command for the same thing"); A("git checkout -b new-idea", "make a new branch and move onto it"); }
      break;
    case "branch":
      P("branch", "list, make or delete branches");
      rest.forEach((x) => P(x, "the branch name"));
      break;
    case "remote":
      P("remote", "manage the remote copies this repository knows about");
      if (rest[0] === "add") { P("add", "remember a new one"); if (rest[1]) P(rest[1], "its nickname (origin is the usual one)"); if (rest[2]) P(rest[2], "its address on GitHub"); }
      A("git remote -v", "list the remotes and their addresses");
      break;
    case "push":
      P("push", "upload your new commits to GitHub");
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "-u") P("-u", "remembers this pairing (your main goes to origin's main), so next time a plain git push is enough.");
        else if (i === rest.indexOf(rest[i]) && /^origin$/.test(rest[i])) P(rest[i], "which remote: the nickname for GitHub");
        else P(rest[i], "which branch to send");
      }
      if (!rest.length) P("(nothing else)", "uses the pairing you set up with -u");
      A("git push", "once -u is set, this is all you type");
      break;
    case "pull":
      P("pull", "download new commits from GitHub and update your files");
      A("git fetch", "download only; look before you change your files");
      A("git fetch, then git merge", "what pull does, in two steps");
      break;
    case "fetch":
      P("fetch", "download new commits from GitHub without touching your files");
      break;
    case "merge":
      P("merge", "bring another branch's commits into the one you're on");
      rest.forEach((x) => P(x, x === "--abort" ? "give up and go back to before the merge" : "the branch to bring in"));
      A("git merge --abort", "stop a merge that hit a conflict and go back");
      break;
    case "clone":
      P("clone", "copy a whole repository from GitHub onto this computer");
      if (rest[0]) P(rest[0], "the repository's address");
      A("git clone <address> my-folder", "choose the folder name");
      break;
    case "worktree":
      P("worktree", "manage extra folders (desks) for the same repository");
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "add") P("add", "make a new one");
        else if (rest[i] === "-b") { P("-b", "a flag: make a new branch for the new folder"); P(rest[i + 1] ?? "", "the new branch's name", "value"); i++; }
        else if (/^\.\.?\//.test(rest[i])) P(rest[i], "where the new folder goes (.. means next to this one)");
        else P(rest[i], "the version to start from");
      }
      A("git worktree list", "see every desk and its branch");
      A("git worktree remove ../my-recipe-fix", "put a desk away when you're done");
      break;
    case "status":
      P("status", "say what's changed, what's staged, and which branch you're on");
      break;
    default:
      if (sub) P(sub, "a git command");
  }
  return { parts, also, flags: parts.some((p) => p.kind === "flag"), docs: sub ? `https://git-scm.com/docs/git-${sub}` : undefined };
}
