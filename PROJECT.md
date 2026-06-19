# howtogit.dev — project roadmap

A living plan for the interactive, hand-drawn git tutorial. Update as we go.

## What it is

A single page that teaches git by having the user type real commands. As they
type, the commit graph, a file tree, and (later) a remote repo get drawn for
them, by hand, on a paper-like infinite board. Guided and constrained, so a
total beginner is never lost.

## Architecture (today)

- TypeScript, no framework, no bundler. `src/*.ts` compiles to `public/*.js`
  (ES modules) via `tsc`. Compiled JS is committed; Cloudflare serves
  `public/` as-is.
- `src/sketch.ts` — the ink engine: roughened SVG geometry, draw-on with a
  tracing nib, smooth turbulence "boil".
- `src/app.ts` — the controller: a step machine, the graph model, the command
  line (live token colouring + ghost suggestion + Tab complete), the file
  tree, the remote panel, and the clickable timeline (instant replay/seek).

## Done

- Full sequence: `git init` → `add` → `commit` → `branch` → `checkout` →
  commit-on-branch → `remote add` → `push`.
- `git init` → first node, `.git/` appears in the file tree.
- `git add` → staged preview + files marked staged.
- `git commit -m` → new node, connector, HEAD/branch tags glide to the tip.
- `git branch` + `git checkout` → a second coloured lane (red, square nodes)
  that diverges from main; HEAD moves onto the branch and the next commit lands
  on its lane.
- `git remote add` → a second repo panel slides in (across the graph).
- `git push` → remote panel fills, `origin/main` stamped on main's tip.
- Guided command line: commands are token "atoms" (fixed words + free values).
  Type `git` yourself (turns blue), tokens colour-matched to the lesson chips,
  adaptive ghost (keeps your free values), per-word Tab, modular urls, strict
  words show typos in error red without wiping the ghost.
- Bottom timeline with instant seek. Left file tree with a focus state (leads
  while there's nothing to edit) and a compact corner state reserved for when a
  file editor exists.

## Next up (the "collaboration loop" arc)

Build toward two machines sharing a repo through a remote. Rough order:

1. (optional) `git merge` — bring the feature branch back into main.
2. A second machine appears (e.g. a laptop) — a fresh, empty computer beside
   the desktop.
3. `git clone` on the laptop — copies the remote down into the laptop.
4. Edit a fake file on the laptop (needs the **file editor** — when it lands,
   it takes the main spot and the file tree drops to its compact corner).
5. `git push` from the laptop → the remote updates.
6. `git pull` on the desktop → the desktop catches up to the remote.

This is the target experience, not a committed spec yet. Refine before building.

## Backlog / future ideas (captured, not yet specced)

Ideas to keep so they aren't forgotten. Refine each before building.

### Remote mini-graph (when the remote is added)

When `git remote add` lands, draw a second, smaller, simplified graph **above**
the current (local) graph. It's a stripped-down copy of the remote: no labels,
no text, just the colours and shapes of the tree, simplified.

Purpose: it represents the remote as the shared source of truth. When other
people or other machines change things in the future, that mini-graph changes
**first**, then those changes flow down into the local graph on this computer.
This is how we'll illustrate multiple machines: right now there's just this
desktop, but later there's a laptop and a desktop, and the remote sits above
both as the common copy everyone syncs through.

### Simplified timeline (by task, not by command)

Separate task. Today the bottom timeline has one stop per command. That won't
fit the page once there are many commands; it isn't viable long-term.

Switch the timeline to one stop per **task** (a meaningful unit) instead of per
command. E.g. one stop for "init", one for "make a branch", one for "add the
remote and push", rather than a stop for every single command. A simplified
view of the major milestones.

### State persistence / memory across reloads and seeks

Handle saving so progress isn't lost.

- Cache where the user is on reload so it isn't forgotten.
- Clicking a point in the timeline that is **later** than where you are now
  should remember what you've already done. Example: if you named the origin
  something custom further ahead, seeking back and forward should still
  remember that name.
- Clicking **before** the point where you made a change: it still remembers the
  change for later, but if you redo that step differently, it updates to the
  new value.
- If you seek back to the start and walk forward again to the point where you
  create `git remote add origin`, and you type a name there again, you create a
  fresh origin and from then on the app remembers that name. So: a way for the
  user's choices (names, etc.) to persist from the moment they're made onward.

### OS + tool switcher (top-right of the page)

Top-right corner controls:

- Switch between operating systems.
- Switch between tools: IntelliJ, VS Code, command line.

Each would have its own interface (different UI per tool). Design those later,
not now. Just reserving the feature.

### Donate button

A way to donate to the creator, somewhere on the page. Present and noticeable
but not pushy or attention-grabbing. The vibe: "oh, you can donate, that'd be
nice." Visible, not subtle, not loud.

### Dark mode (big undertaking)

Worth doing eventually, but a large job because the whole thing leans on a lot
of colour. Plan for it as its own effort.

### Polish / fixes

- **Center the graph on HEAD.** Horizontally center the view on wherever HEAD
  is, not on the `git init` node. Right now it just sits where it is; it should
  follow HEAD.
- **Stop the idle drift.** The graph slightly moves around when nothing is
  happening (the boil/turbulence). It should be completely stationary when
  idle. The constant drift is distracting and not as neat as hoped. Boil only
  while something is actively being drawn, settle to still when done.
- **A "completed" end state.** When the whole sequence is finished the board is
  just empty with nothing there. Instead it should read as done: a message like
  "completed, nothing more to do" (or a fun line) so it's clearly the end, not a
  blank.

## Later (common commands to cover)

- `git status`
- `git switch` (modern alternative to checkout)
- `git stash`
- `git tag`
- `git diff`
- `git reset --hard`
- ...and the other everyday ones.

## Conventions / preferences

- Hand-drawn aesthetic everywhere; new animations match the inked-in language.
- No em dashes anywhere (hard rule).
- Keep copy short and beginner-first: assume the user knows nothing, never be
  vague about what a word refers to.
- Auto-commit coherent units; push only when asked.
