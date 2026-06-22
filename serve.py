#!/usr/bin/env python3
"""Tiny static server for howtogit that disables caching.

The default `python -m http.server` lets phones cache app.js/style.css by
filename, so edits never show up on a refresh. This server sends no-store on
every response so a plain refresh always pulls the latest build.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # reload-probe.js is the one file we WANT cached: a normal reload then
        # serves it from cache while a hard refresh re-fetches it, which is how
        # app.ts tells the two apart. It never changes, so caching is safe.
        # Everything else stays no-store so edits always show on a plain refresh.
        if self.path.split("?")[0].rstrip("/").endswith("reload-probe.js"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep nohup.out quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    directory = sys.argv[2] if len(sys.argv) > 2 else "public"
    handler = lambda *a, **k: NoCacheHandler(*a, directory=directory, **k)
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"serving {directory} on 0.0.0.0:{port} (no-cache)")
    server.serve_forever()
