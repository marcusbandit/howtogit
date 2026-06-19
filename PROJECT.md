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
