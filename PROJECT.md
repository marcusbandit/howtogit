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

- Full sequence: `git init` → `add` → `commit` → `remote add` → `push` →
  `branch` → `checkout` → commit-on-branch → `checkout main` → `merge` →
  `push`. The remote is connected and first-pushed right after the first
  commit (before branching), then a bare `git push` sends the merge at the end.
- `git init` → first node, `.git/` appears in the file tree.
- `git add` → staged preview + files marked staged.
- `git commit -m` → new node, connector, HEAD/branch tags glide to the tip.
- `git branch` + `git checkout` → a second coloured lane (red, square nodes)
  that diverges from main; HEAD moves onto the branch and the next commit lands
  on its lane.
- `git checkout main` + `git merge feature` → the feature lane rejoins main as
  a merge commit with two parents (a diamond): one connector from main's tip,
  one from the feature tip drawn in the feature colour. HEAD/main glide to the
  merge commit; the feature branch stays put.
- `git remote add` → a second repo panel slides in (across the graph).
- `git push` → remote panel fills, `origin/main` stamped on main's tip.
- Guided command line: commands are token "atoms" (fixed words + free values).
  Type `git` yourself (turns blue), tokens colour-matched to the lesson chips,
  adaptive ghost (keeps your free values), per-word Tab, modular urls, strict
  words show typos in error red without wiping the ghost.
- Bottom timeline with instant seek. Left file tree with a focus state (leads
  while there's nothing to edit) and a compact corner state reserved for when a
  file editor exists.

## The collaboration loop arc ("The Basics 2") **[DONE]**

Two machines sharing a repo through a remote. Shipped as a second timeline
section ("The Basics 2") that opens once the first loop finishes; the first
section compacts into a single labelled square.

1. `git merge` — bring the feature branch back into main. **[DONE]**
2. A second machine (the laptop) appears. **[DONE]** Finishing the first loop
   auto-plays a move-to-laptop transition: a soft ink-tinted blob glides from
   the desktop to the laptop, the desktop grays + stows low-left with a small
   grayed mini-graph standing in for its full graph, and the board hands off to
   the laptop. The laptop's home `~/` (Documents, Pictures, Downloads) appears.
3. `git clone` on the laptop. **[DONE]** Mirrors the remote history down onto
   the laptop board and drops `my-site/` into `~/`, then auto-types `cd my-site/`.
4. Edit a file on the laptop. **[DONE]** The editor pops out of the laptop's
   `index.html` row and types an edit (the same sequence the desktop used), then
   `git add .` + `git commit -m`.
5. `git status` + `git push` from the laptop. **[DONE]** status reports the
   laptop is one commit ahead; push grows the remote (the new commit rises out of
   the laptop tip) and moves `origin/main` onto the laptop.
6. `git pull` on the desktop. **[DONE]** Moves back to the desktop (the hidden
   desktop graph reappears, the laptop recedes to a grayed corner) and pulls the
   laptop's commit down so the desktop matches the remote.

Architecture: a `Machine` record per computer (own model + id counter + SVG
layers + refs + pan), an `active` pointer rebound by `useMachine()`, and a
first-class remote hub (`remoteHistory`) that push appends to and pull reads
from. `CommitNode.parentId` keeps each machine's graph redrawable. Everything is
seek-safe (each run switches machine + draws final geometry under the `instant`
flag; `resetBoard` clears both machines + the hub).

## Backlog / future ideas (captured, not yet specced)

Ideas to keep so they aren't forgotten. Refine each before building.

### Remote mini-graph (when the remote is added) **[DONE]**

On the first `git push` (right after `git remote add`), a copy of the local
trunk lays itself over the real graph, then floats **up** and shrinks into a
smaller, simplified mini-graph above the local one: same colours and shapes, no
labels or text. It only ever shows what's actually on the remote (origin/main),
so it lags behind the local graph until you push again; the final `git push`
catches it up to the merge commit.

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

- **Center the graph in a box, follow HEAD on overflow. [DONE]** The graph
  lives in a central box (~66% of the width, `BOX_FRAC`); while the whole graph
  fits there it stays centred on its own midpoint. Only once it outgrows the box
  does HEAD get pinned to the centre, and the older commits slide out into the
  faded edges (a CSS mask on `#graph` dissolves the graph into the paper at the
  left/right edges). The pan is instant during timeline seeks and re-runs on
  resize.
- **A "complete" star on the timeline. [DONE]** The bottom timeline ends in a
  star that jumps straight to the finished end state when clicked; it fills with
  a warm glow the instant the last command is done.
- **Stop the idle drift. [DONE]** The whole-sheet float is gone and the board
  is completely still when idle. The boil now only runs while ink is actively
  being laid down: each stroke nudges it awake, it eases back to a fixed warp a
  beat after the last stroke, then the loop parks itself, so an idle board
  never wanders and costs nothing.
- **A "completed" end state. [DONE]** When the whole sequence finishes, a
  hand-written closing line ("that's the whole first loop — nothing left to do
  ✦") fades in under HEAD, so the end reads as done rather than a blank gap. It
  also appears when you seek to the final step on the timeline.

## Later (common commands to cover)

- `git status` **[DONE]** — a no-op informational step on the laptop (reports the
  working tree is clean but one commit ahead of the remote).
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
