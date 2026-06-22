/* reload-probe.js — a deliberately cached-forever, never-changing file.
 *
 * It does nothing on its own. It exists so the app can tell a normal reload
 * apart from a hard refresh (Ctrl+Shift+R), which the browser otherwise hides:
 * both report navigation type "reload". The one thing a hard refresh does is
 * bypass the HTTP cache and re-download everything. So on a normal reload this
 * file is served from cache (resource timing transferSize === 0); on a hard
 * refresh it gets re-fetched (transferSize > 0). app.ts reads that to decide
 * whether to restore the saved session or start clean.
 *
 * Keep it static and keep it cached: see serve.py (dev) and public/_headers
 * (Cloudflare) for the long, immutable Cache-Control that makes this work.
 */
void 0;
