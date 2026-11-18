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
    const noun = t[1], verb = t[2];
    const NOUN: Record<string, string> = { pr: "work with pull requests", issue: "work with issues", label: "work with labels" };
    if (noun && NOUN[noun]) P(noun, NOUN[noun], "command");
    const VERB: Record<string, Record<string, string>> = {
      pr: {
        create: "open a new pull request", merge: "merge a pull request on GitHub", ready: "mark a draft as ready for review",
        edit: "change a pull request: its reviewers, labels, title or text", review: "send a review: approve, comment, or ask for changes",
        diff: "show what a pull request changes", view: "show one pull request", list: "list the open pull requests",
        checkout: "put a pull request's branch on your computer", comment: "add a comment to a pull request",
        close: "close a pull request without merging it", reopen: "open a closed pull request again",
      },
      issue: {
        create: "open a new issue", edit: "change an issue: its labels, assignees, title or text", comment: "add a comment to an issue",
        close: "close an issue", reopen: "open a closed issue again", view: "show one issue", list: "list the open issues",
        develop: "make a branch for an issue, linked to it",
      },
      label: { create: "make a new label", list: "list the labels this repository has" },
    };
    if (noun && verb && VERB[noun]?.[verb]) P(verb, VERB[noun][verb], "command");
    // flags: what each one does, and what its value is (none for a plain switch)
    const FLAG: Record<string, [string, string?]> = {
      "--title": ["a flag: the value after it is the title people see on GitHub", "the title"],
      "--body": [verb === "review" || verb === "comment" ? "a flag: the value after it is what you write" : "a flag: the value after it is the text under the title", "the text"],
      "--base": ["a flag: the value after it is the branch the change should go into", "that branch"],
      "--head": ["a flag: the value after it is the branch that has your change", "that branch"],
      "--draft": ["a flag: open it as a draft, not ready for review and not mergeable yet"],
      "--label": [noun === "issue" && verb === "list" ? "a flag: only the ones with this label" : "a flag: put this label on it", "the label"],
      "--add-label": ["a flag: put this label on it", "the label"],
      "--remove-label": ["a flag: take this label off", "the label"],
      "--assignee": [verb === "list" ? "a flag: only the ones assigned to this person" : "a flag: who does it", "who (@me means you)"],
      "--add-assignee": ["a flag: add this person as an assignee, the one doing it", "who (@me means you)"],
      "--reviewer": ["a flag: ask this person to review it", "who"],
      "--add-reviewer": ["a flag: ask this person to review it", "who"],
      "--approve": ["a flag: the review approves the change"],
      "--request-changes": ["a flag: the review asks for changes before it can go in"],
      "--comment": noun === "pr" && verb === "review" ? ["a flag: the review only comments, without approving or asking for changes"] : ["a flag: the value after it is a comment to leave as well", "the comment"],
      "--reason": ["a flag: why it's closed", "completed, or not planned"],
      "--squash": ["a flag choosing how to merge: pack every commit of the branch into one new commit"],
      "--merge": ["a flag choosing how to merge: keep every commit and add a merge commit (squash and rebase are the other styles)"],
      "--delete-branch": ["a flag: delete the branch afterwards, its work is in main now"],
      "--checkout": ["a flag: switch to the new branch right away"],
    };
    for (let i = 3; i < t.length; i++) {
      const f = FLAG[t[i]];
      if (f) { P(t[i], f[0]); if (f[1] !== undefined) { P(t[i + 1] ?? "", f[1], "value"); i++; } }
      else if (/^#?\d+$/.test(t[i])) P(t[i], noun === "issue" ? "which issue, by its number" : "which pull request, by its number");
      else if (noun === "label" && verb === "create" && !/^-/.test(t[i])) P(t[i], "the new label's name");
    }
    if (noun === "pr" && verb === "create") A("the Create pull request button on github.com", "the same thing, in the browser");
    if (noun === "pr" && verb === "merge") A("the Merge pull request button on github.com", "the same thing, in the browser");
    if (noun === "pr" && verb === "review") A("Files changed, then Review changes, on github.com", "the same thing, in the browser, where you can also leave notes on single lines");
    if (noun === "issue" && verb === "create") A("New issue on the Issues tab of github.com", "the same thing, in the browser");
    const docs = noun && verb && VERB[noun]?.[verb] ? `https://cli.github.com/manual/gh_${noun}_${verb}` : noun && NOUN[noun] ? `https://cli.github.com/manual/gh_${noun}` : "https://cli.github.com/manual/";
    return { parts, also, flags: parts.some((p) => p.kind === "flag"), docs };
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
      const am = rest.indexOf("-am");
      if (am >= 0) {
        P("-am", "two short flags written together: -a stages every changed file git already knows, -m takes the message.");
        if (rest[am + 1]) P(rest[am + 1], "the commit message itself", "value");
      }
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
      rest.forEach((x) => P(x, x === "-d" ? "a flag: delete the branch, only if its work is merged" : x === "-D" ? "a flag: delete the branch even if git thinks its work isn't merged" : "the branch name"));
      if (rest.includes("-D")) A("git branch -d <name>", "the careful delete: it refuses while the branch has work main doesn't");
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
      A("git worktree remove ../my-report-fix", "put a desk away when you're done");
      break;
    case "status":
      P("status", "say what's changed, what's staged, and which branch you're on");
      break;
    default:
      if (sub) P(sub, "a git command");
  }
  const known = ["init", "add", "commit", "restore", "log", "switch", "checkout", "branch", "remote", "push", "pull", "fetch", "merge", "clone", "worktree", "status", "diff"];
  return { parts, also, flags: parts.some((p) => p.kind === "flag"), docs: sub && known.includes(sub) ? `https://git-scm.com/docs/git-${sub}` : undefined };
}
