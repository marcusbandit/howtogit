# howtogit.dev

Learn how git and GitHub work by doing it, from zero. You write down a pancake
recipe, save versions, go back in time, put it on GitHub, work on it with your
sister Sam, open a pull request, settle a conflict and open a second worktree.
Every idea is shown in plain words before its git name.

Every action can be done three ways, switched in the top bar: **buttons** (like
VS Code or GitHub Desktop), **commands** typed in a terminal, or **asking an AI**
(a scripted assistant that proposes the commands and waits for a yes). All three
run the same git commands, and the picture shows the result: GitHub, your
computer and Sam's computer, each with its files and its line of saved versions.

Live: https://howtogit.dev

## Stack

- TypeScript (no framework, no bundler), compiled to plain ES modules
- HTML + CSS; the history lines are hand-drawn SVG from `src/sketch.ts`
- Hosted on Cloudflare Workers static assets, deployed on push to `main`

## Source layout

- `src/model.ts`: a small, faithful git (commits, index, branches, push/pull,
  three-way merge with real conflict markers, worktrees, GitHub pull requests).
  Plain JSON, so it saves to localStorage and replays.
- `src/cli.ts`: the `git` and `gh` command line on top of the model.
- `src/story.ts`: the lesson as data: chapters, beats, what each button runs,
  and when a beat counts as done.
- `src/engine.ts`: runs commands and replays the story to any beat (no DOM).
- `src/main.ts`: the page: lesson card, the three modes, the world, the editor.
- `tsc` compiles `src/` to `public/`, which is committed and served as-is.

Dev links: `/?ch=7&b=3` opens chapter 7, step 3 (replayed the typical way),
`&mode=command|ai|buttons` picks the mode, `&done=1` shows that step finished.

## Develop

```sh
bun install        # one-time: installs typescript + wrangler
bun run typecheck  # type-check only, emits nothing
bun run watch      # recompile src -> public on every save
bun run dev        # compile, then run wrangler dev
bun run check      # compile, replay every beat, and check the right-click menu stays normal
                   # (the last one needs the dev server: python3 serve.py)
```

For a quick look without wrangler, serve the folder:

```sh
bun run build
python -m http.server 8000 --directory public   # then visit http://localhost:8000
```

## Deploy

Every push to `main` triggers an automatic Cloudflare deploy of `./public`.
The compiled JS is committed, so no build runs on their side; rebuild locally
with `bun run build` (or `bun run deploy`) before pushing.
