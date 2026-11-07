#!/usr/bin/env node
/* check-selection.mjs: the right-click menu must stay the browser's normal one.
 *
 * Firefox shows a "Copy / Select All" menu instead of the normal one (back,
 * forward, reload) whenever anything on the page is selected. So: after any
 * ordinary use of the page, a right-click on an empty spot must find nothing
 * selected. This plays the lesson with real mouse input (clicks, fast double
 * clicks, clicks that drift while held, drags on text) and fails if a stray
 * selection would reach the context menu.
 *
 *   node scripts/check-selection.mjs [--url http://localhost:8787]
 */
import { spawn } from "node:child_process";
import net from "node:net";

const URL_BASE = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : "http://localhost:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const chrome = spawn(process.env.CHROME_BIN || "google-chrome-stable",
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });

let ws, fails = 0;
try {
  let url;
  for (let i = 0; i < 100 && !url; i++) { try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* starting */ } await sleep(100); }
  ws = new WebSocket(url);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.result?.value;
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const centre = async (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const click = async (sel, { count = 1, drift = 0 } = {}) => {
    const p = await centre(sel);
    if (!p) return false;
    for (let c = 1; c <= count; c++) {
      await mouse("mousePressed", p.x, p.y, { clickCount: c });
      if (drift) await mouse("mouseMoved", p.x + drift, p.y + 1, { buttons: 1 });
      await mouse("mouseReleased", p.x + drift, p.y + (drift ? 1 : 0), { clickCount: c });
    }
    await sleep(120);
    return true;
  };
  // what the context menu would see: right-click an empty spot, then read the selection
  // Chrome clears a selection on right mouse down by itself; Firefox does not,
  // and builds its menu from whatever is selected when "contextmenu" fires.
  // So fire just that event, the way Firefox sees it, and read the selection.
  const contextMenuAt = (x, y) => ev(`(()=>{const t=document.elementFromPoint(${x},${y})||document.body; t.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:${x},clientY:${y},button:2})); return 1;})()`);
  const rightClickEmpty = async (label) => {
    await contextMenuAt(1300, 860);
    await sleep(30);
    const sel = await ev(`String(getSelection())`);
    if (sel) { fails++; console.log(`FAIL  ${label}: "${sel.slice(0, 50)}" still selected at right-click`); }
    else console.log(`ok    ${label}`);
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: `${URL_BASE}/?ch=1&b=1` });
  await sleep(2200);

  // 1. a fast double click on the action button, then on Next, over and over
  await click(".btn--go", { count: 2 });
  await rightClickEmpty("double click on an action button");
  for (let i = 0; i < 4; i++) { await click("[data-next]:not([disabled])", { count: 2 }); await click(".btn--go:not([disabled])"); await sleep(300); }
  await rightClickEmpty("double clicks on Next while the text changes");
  // 2. clicks that drift a few pixels while held (a tiny drag)
  await click("[data-back]", { drift: 6 });
  await click("[data-next]:not([disabled])", { drift: 8 });
  await rightClickEmpty("clicks that drift while held");
  // 3. spam Back and the step bar
  for (let i = 0; i < 3; i++) await click("[data-back]", { count: 2 });
  await click('[data-beat="0"]', { count: 2 });
  await click('[data-beat="2"]', { drift: 5 });
  await rightClickEmpty("Back and step bar spam");
  // 4. someone selects lesson text on purpose, then right-clicks elsewhere
  // drag along the first line of the lesson text (its middle can be a blank line)
  const t = await ev(`(()=>{const r=document.querySelector(".say").getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+12};})()`);
  await mouse("mousePressed", t.x - 120, t.y, { clickCount: 1 });
  await mouse("mouseMoved", t.x + 60, t.y, { buttons: 1 });
  await mouse("mouseReleased", t.x + 60, t.y, { clickCount: 1 });
  await rightClickEmpty("text selected on purpose, right-click somewhere else");
  // 5. selecting on purpose and right-clicking ON it keeps it (Copy should be offered)
  await mouse("mousePressed", t.x - 120, t.y, { clickCount: 1 });
  await mouse("mouseMoved", t.x + 60, t.y, { buttons: 1 });
  await mouse("mouseReleased", t.x + 60, t.y, { clickCount: 1 });
  // aim at the middle of what actually got selected, not a guessed spot
  const on = await ev(`(()=>{const r=getSelection().getRangeAt(0).getClientRects()[0]; return r ? {x:r.left+r.width/2,y:r.top+r.height/2} : null;})()`);
  if (on) await contextMenuAt(on.x, on.y);
  await sleep(30);
  if (!(await ev(`String(getSelection())`))) { fails++; console.log("FAIL  right-click on selected text should keep it for Copy"); }
  else console.log("ok    right-click on selected text keeps it");
  // 6. the mode switch and the intro
  await click('#mode [data-mode="command"]', { count: 2 });
  await click('#mode [data-mode="buttons"]', { count: 2 });
  await rightClickEmpty("double clicks on the mode switch");
} catch (e) {
  fails++;
  console.error("check-selection failed to run:", e.message);
} finally {
  try { ws?.close(); } catch { /* closed */ }
  chrome.kill("SIGKILL");
}
console.log(fails ? `${fails} selection problem(s)` : "right-click menu stays normal");
process.exitCode = fails ? 1 : 0;
