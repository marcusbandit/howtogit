# howtogit.dev

An interactive, visual guide to **git for total beginners**: from your first
commit to surviving a merge conflict. Hand-drawn, animated, and meant to make
git finally click.

🔗 Live: https://howtogit.dev (coming soon)

## Status

The interactive lesson is taking shape. You type real git commands and the
graph gets drawn for you, by hand, on an infinite sheet of paper. Working so
far: `git init`, `git add`, `git commit`.

## Stack

- TypeScript (no framework, no bundler), compiled to plain ES modules
- HTML + CSS for the page shell; all the ink is hand-generated SVG
- Hosted on **Cloudflare** (auto-deploys on push to `main`), serving `./public`

## Source layout

- `src/*.ts` is the source of truth. `tsc` compiles it to `public/*.js`.
- `public/` holds the page shell (`index.html`, `style.css`) plus the compiled
  JS, which is committed so Cloudflare can serve `public/` as-is.

## Develop

```sh
bun install        # one-time: installs typescript + wrangler
bun run typecheck  # type-check only, emits nothing
bun run watch      # recompile src -> public on every save
bun run dev        # compile, then run wrangler dev
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
