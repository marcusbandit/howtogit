#!/usr/bin/env bash
# Re-bundle isomorphic-git into a single, self-contained browser ESM (with the
# buffer/process polyfills it needs). Run after bumping the isomorphic-git dep.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild scripts/vendor-entry.mjs --bundle --format=esm --minify --platform=browser \
  --define:global=globalThis --outfile=public/vendor/isomorphic-git.mjs
echo "vendored -> public/vendor/isomorphic-git.mjs"
