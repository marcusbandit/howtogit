#!/usr/bin/env node
/* check-play.mjs: play every step in the real page, in each mode, the way a
 * visitor would (buttons, typed commands, the AI's messages, the editor), and
 * fail on a page error or a step that doesn't finish.
 *
 *   node scripts/check-play.mjs [--url http://localhost:8787] [--mode buttons|command|ai]
 */
import { spawn } from "node:child_process";
import net from "node:net";
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const URL_BASE = arg("--url", "http://localhost:8787");
const MODES = arg("--mode", "buttons,command,ai").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const chrome = spawn(process.env.CHROME_BIN || "google-chrome-stable", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
let ws, fails = 0;
try {
  let url;
  for (let i = 0; i < 100 && !url; i++) { try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* starting */ } await sleep(100); }
  ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: `(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));${x}})()`, returnByValue: true, awaitPromise: true })).result.result?.value;
  await send("Page.enable"); await send("Runtime.enable");
  const steps = JSON.parse(await (async () => { await send("Page.navigate", { url: `${URL_BASE}/?ch=1&b=1` }); await sleep(1500);
    return ev(`const m = await import("./story.js"); return JSON.stringify(m.chapters.flatMap((c, i) => c.beats.map((b, j) => ({ c: i + 1, b: j + 1, id: b.id, kind: b.kind })))) `); })());
  for (const mode of MODES) {
    let bad = 0;
    for (const s of steps) {
      if (s.kind === "next") continue;
      errors.length = 0;
      await send("Page.navigate", { url: `${URL_BASE}/?ch=${s.c}&b=${s.b}&mode=${mode}` });
      await sleep(900);
      // play the step the way a visitor would in this mode
      const how = await ev(`
        const L = document.querySelector('#lesson');
        const next = () => !L.querySelector('[data-next]')?.disabled || !!L.querySelector('[data-restart]');
        if (next()) return 'already';
        const open = L.querySelector('[data-open]');
        if (open) { // an edit or a conflict: change the file in the editor
          open.click(); await sleep(250);
          const pick = document.querySelector('[data-pick=mine]');
          const ta = document.querySelector('#editor-text');
          if (pick) pick.click(); else ta.value = ta.value + 'A line from the play check.\\n';
          document.querySelector('#editor-save').click(); await sleep(400);
          if (!next()) { // some edits need specific words: try the step's own hint by typing it
            open.click(); await sleep(200);
            const t = document.querySelector('#editor-text');
            t.value = t.value.replace(/helpd/, 'helped').replace(/^Deadline:.*$/m, 'Deadline: Monday');
            if (!/Deadline:/.test(t.value)) t.value += 'Deadline: Monday\\n';
            document.querySelector('#editor-save').click(); await sleep(400);
          }
          return next() ? 'edited' : 'edit did not finish';
        }
        for (let round = 0; round < 6 && !next(); round++) {
          const watch = L.querySelector('.btn--friend:not([disabled]), .btn--event:not([disabled])');
          if (watch) { watch.click(); await sleep(1200); continue; }
          if ('${mode}' === 'buttons') {
            const hist = [...L.querySelectorAll('.hist__open')];
            if (hist.length) { hist[hist.length - 1].click(); await sleep(1300); continue; }
            const b = L.querySelector('[data-run]:not([disabled])');
            if (!b) break; b.click(); await sleep(1300);
          } else if ('${mode}' === 'command') {
            const peek = [...L.querySelectorAll('.task li:not(.is-done) .cmd-hint')][0];
            const input = L.querySelector('[data-term] input');
            if (!peek || !input) break;
            input.value = peek.textContent.replace(/×\\d+$/, ''); input.form.requestSubmit(); await sleep(1300);
          } else {
            const say = L.querySelector('[data-say]'); const yes = L.querySelector('[data-ai-run]');
            if (yes) { yes.click(); await sleep(1500); continue; }
            if (!say) break; say.click(); await sleep(300);
          }
        }
        return next() ? 'played' : 'stuck: ' + (L.querySelector('.say')?.textContent ?? '').slice(0, 60);`);
      const ok = /already|played|edited/.test(how ?? "") && !errors.length;
      if (!ok) { bad++; fails++; console.log(`FAIL  ${mode.padEnd(8)} ${s.c}.${s.b} ${s.id}: ${how}${errors.length ? " | error: " + errors[0].split("\n")[0] : ""}`); }
    }
    console.log(`${mode}: ${bad ? bad + " step(s) failed" : "every step plays"}`);
  }
} catch (e) { fails++; console.error("check-play failed to run:", e.message); }
finally { try { ws?.close(); } catch { /* closed */ } chrome.kill("SIGKILL"); }
process.exitCode = fails ? 1 : 0;
