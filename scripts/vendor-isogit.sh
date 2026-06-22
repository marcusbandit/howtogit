#!/usr/bin/env bash
# Re-bundle isomorphic-git into a single, self-contained browser ESM (with the
# buffer/process polyfills it needs). Run after bumping the isomorphic-git dep.
set -euo pipefail
cd "$(dirname "$0")/.."
# use the locked, installed esbuild (not npx, which could fetch a different
# version) so the vendored bundle only changes on an intentional dep bump.
# Run `npm ci` first for a fully reproducible build.
./node_modules/.bin/esbuild scripts/vendor-entry.mjs --bundle --format=esm --minify --platform=browser \
  --define:global=globalThis --outfile=public/vendor/isomorphic-git.mjs
echo "vendored -> public/vendor/isomorphic-git.mjs"
