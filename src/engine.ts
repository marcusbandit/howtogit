/* engine.ts: runs commands and replays the story, with no DOM, so the same
 * code drives the page and the headless story check. */
import * as G from "./model.js";
import { run, type Result } from "./cli.js";
import { chapters, autoBeat } from "./story.js";

export const authorOf = (who: "you" | "albert") => (who === "albert" ? "Albert" : "You");

export function exec(w: G.World, cmd: string, who: "you" | "albert", desk: number): Result {
  const r = run(w, { repo: who, desk, author: authorOf(who) }, cmd);
  if (/\[rejected\]/.test(r.out)) w.vars.rejected = "1";
  if (r.ok && /^\s*git\s+log\b/.test(cmd)) w.vars.sawLog = "1";
  if (r.ok && /^\s*git\s+(switch|checkout)\b.*--detach|^\s*git\s+checkout\s+[0-9a-f]{5,}/.test(cmd)) w.vars.movedHead = "1";
  return r;
}

/* the world as it is at the start of beat (ci, bi), reached the typical way */
export function replayTo(ci: number, bi: number): G.World {
  const w = G.freshWorld();
  for (let c = 0; c < chapters.length; c++) {
    for (let b = 0; b < chapters[c].beats.length; b++) {
      if (c > ci || (c === ci && b >= bi)) return w;
      autoBeat(chapters[c].beats[b], w, (cmd, who, d) => {
        const r = exec(w, cmd, who, d);
        if (!r.ok && !/\[rejected\]/.test(r.out)) throw new Error(`replay ${chapters[c].beats[b].id}: ${cmd}\n${r.out}`);
      });
    }
  }
  return w;
}

export interface Ran { kind: "cmd" | "out" | "err" | "note"; text: string; who: "you" | "albert" }

/* beat (ci, bi) done the typical way: the world right after it, and the log of
 * what ran (commands and git's answers), so a step rebuilt after a reload
 * still shows what happened under the hood */
export function finishBeat(ci: number, bi: number): { w: G.World; log: Ran[] } {
  const w = replayTo(ci, bi);
  const log: Ran[] = [];
  autoBeat(chapters[ci].beats[bi], w, (cmd, who, d) => {
    log.push({ kind: "cmd", text: cmd, who });
    const r = exec(w, cmd, who, d);
    if (r.out) log.push({ kind: r.ok ? "out" : "err", text: r.out, who });
  }, (text, who) => log.push({ kind: "note", text, who }));
  return { w, log };
}
