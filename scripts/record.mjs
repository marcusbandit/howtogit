#!/usr/bin/env node
/* record.mjs: run a snippet in the page and capture frames for a few seconds,
 * so an action can be checked frame by frame. Also lists which elements were
 * animating right after the snippet ran.
 *
 *   node scripts/record.mjs --q "ch=2&b=4" --do "document.querySelector('[data-run]').click()" --ms 1600 --out dir
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
const a = {}; const v = process.argv.slice(2);
for (let i = 0; i < v.length; i++) if (v[i].startsWith("--")) a[v[i].slice(2)] = v[i + 1]?.startsWith("--") || v[i + 1] === undefined ? true : v[++i];
const W = Number(a.w ?? 1440), H = Number(a.h ?? 900), MS = Number(a.ms ?? 1600), OUT = a.out ?? "/tmp/rec";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const chrome = spawn(process.env.CHROME_BIN || "google-chrome-stable", ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
let ws;
try {
  let url;
  for (let i = 0; i < 100 && !url; i++) { try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {} await sleep(100); }
  ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const frames = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === "Page.screencastFrame") { frames.push({ t: performance.now(), d: m.params.data }); send("Page.screencastFrameAck", { sessionId: m.params.sessionId }); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
  await send("Page.navigate", { url: `${a.url ?? "http://localhost:8787"}/?${a.q ?? ""}` });
  await sleep(2200);
  if (a.pre) await send("Runtime.evaluate", { expression: `(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));${a.pre}})()`, awaitPromise: true });
  await sleep(300);
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await sleep(150);
  const t0 = performance.now();
  await send("Runtime.evaluate", { expression: `(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));${a.do ?? ""}})()`, awaitPromise: true });
  const anim = await send("Runtime.evaluate", { expression: `JSON.stringify(document.getAnimations().map(x=>{const t=x.effect?.target;return (t?.className?.baseVal??t?.className??t?.tagName)+':'+(x.animationName||x.transitionProperty||'js')}).reduce((m,k)=>(m[k]=(m[k]||0)+1,m),{}))`, returnByValue: true });
  await sleep(MS);
  await send("Page.stopScreencast");
  const keep = frames.filter((f) => f.t >= t0);
  const step = Math.max(1, Math.floor(keep.length / 12));
  keep.filter((_, i) => i % step === 0).slice(0, 12).forEach((f, i) => writeFileSync(`${OUT}/f${String(i).padStart(2, "0")}_${Math.round(f.t - t0)}ms.png`, Buffer.from(f.d, "base64")));
  console.log(`frames=${keep.length} animating right after: ${anim.result.result.value}`);
} catch (e) { console.error("record failed:", e.message); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} chrome.kill("SIGKILL"); }
