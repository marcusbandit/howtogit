# howtogit.dev

An interactive, visual guide to **git for total beginners** — from your first
commit to surviving a merge conflict. Bubbly, animated, and meant to make git
finally click.

🔗 Live: https://howtogit.dev (coming soon)

## Status

Early days — currently a placeholder landing page. The interactive lessons are
being built next, starting with **"make your first commit."**

## Stack

- Plain static site: HTML + CSS (+ JS as the interactive lessons land)
- Hosted on **Cloudflare Pages** (auto-deploys on push to `main`)
- No build step yet — `index.html` is served as-is

## Local preview

It's a static site, so just open `index.html` in a browser, or serve the folder:

```sh
python -m http.server 8000   # then visit http://localhost:8000
```

## Deploy

Every push to `main` triggers an automatic Cloudflare Pages deploy. No build
command; output directory is the repo root.
