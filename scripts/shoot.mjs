#!/usr/bin/env node
/* shoot.mjs — drive the app to any state and screenshot it, headless.
 *
 * Lets us verify how the page looks at any point without clicking by hand.
 * Launches its own headless Chrome, navigates to a given lesson step (via the
 * built-in ?step=N seek), optionally runs a snippet in the page (to open
 * folders, click files, open a companion question, …), then writes a PNG.
 *
 * Usage:
 *   node scripts/shoot.mjs --step 3 --out /tmp/commit.png
 *   node scripts/shoot.mjs --step 1 --out /tmp/git.png \
 *        --do "document.querySelector('[data-path=\".git\"]').click()" --wait 900
 *   node scripts/shoot.mjs --step 3 --out /tmp/head.png \
 *        --do "document.querySelector('[data-path=\".git\"]').click(); await sleep(700); document.querySelector('[data-path=\".git/HEAD\"]').click()"
 *
 * Flags: --step N | --out path | --do "<js, may await sleep(ms)>" | --wait ms
 *        --url http://localhost:8787 | --w 1280 | --h 900 | --port 0 (auto)
 *        --eval "<js returning a value to print, instead of/after screenshot>"
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import net from "node:net";

const args = (() => {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { a[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i]; }
  }
  return a;
})();

const STEP = args.step ?? "0";
const OUT = args.out ?? "/tmp/shoot.png";
const URL_BASE = args.url ?? "http://localhost:8787";
const W = Number(args.w ?? 1280), H = Number(args.h ?? 900);
const WAIT = Number(args.wait ?? 0);
const DO = args.do ?? null;
const EVAL = args.eval ?? null;

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = process.env.CHROME_BIN || "google-chrome-stable";
const port = Number(args.port && args.port !== "0" ? args.port : await freePort());

const url = `${URL_BASE}/?step=${STEP}`;
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, "--force-device-scale-factor=2",
  `--window-size=${W},${H}`, "about:blank",
], { stdio: "ignore" });

let ws;
async function cdp() {
  // wait for the devtools endpoint
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error("Chrome devtools never came up");
}

function rpc(socket) {
  let id = 0; const pending = new Map();
  socket.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  return (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); socket.send(JSON.stringify({ id: i, method, params })); });
}

try {
  const wsUrl = await cdp();
  ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  const send = rpc(ws);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  // wait for the app to settle (the landing intro + first render)
  await sleep(2500);
  if (DO) {
    const { result } = await send("Runtime.evaluate", { expression: `(async () => { const sleep = (ms) => new Promise(r=>setTimeout(r,ms)); ${DO} })()`, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("DO failed: " + JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
  }
  if (WAIT) await sleep(WAIT);
  if (EVAL) {
    const { result } = await send("Runtime.evaluate", { expression: EVAL, returnByValue: true, awaitPromise: true });
    const v = result.result?.value;
    console.log(typeof v === "string" ? v : JSON.stringify(v));
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
  console.log(`shot -> ${OUT} (step=${STEP})`);
} catch (e) {
  console.error("shoot failed:", e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill("SIGKILL");
}
