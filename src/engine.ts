/* engine.ts: runs commands and replays a track, with no DOM, so the same
 * code drives the page and the headless story check. */
import * as G from "./model.js";
import { run, type Ctx, type Result } from "./cli.js";
import { autoBeat, type Who } from "./story.js";
import type { Track } from "./tracks.js";

export const authorOf = (who: Who) => (who === "albert" ? "Albert" : who === "toby" ? "Toby" : "You");

export function exec(w: G.World, cmd: string, who: Who, desk: number): Result {
  // Toby has no computer: his repo is never there, so only gh works for him
  const r = run(w, { repo: who as Ctx["repo"], desk, author: authorOf(who) }, cmd);
  if (/\[rejected\]/.test(r.out)) w.vars.rejected = "1";
  if (/\[remote rejected\]/.test(r.out)) w.vars.ruleRejected = "1";
  if (r.ok && /^\s*git\s+log\b/.test(cmd)) w.vars.sawLog = "1";
  if (r.ok && /^\s*git\s+(switch|checkout)\b.*--detach|^\s*git\s+checkout\s+[0-9a-f]{5,}\s*$/.test(cmd)) w.vars.movedHead = "1";
  return r;
}

const refused = (out: string) => /\[(remote )?rejected\]/.test(out);

/* the world a track begins in: an empty folder, or what its start builds */
export function startWorld(t: Track): G.World {
  const w = G.freshWorld();
  if (!t.start) return w;
  // GitHub's side (issues, labels, runs, rules) starts empty, or as the model sets it up
  const init = (G as unknown as { ghInit?: (w: G.World) => void }).ghInit;
  if (typeof init === "function") init(w);
  else { w.issues ??= []; w.labels ??= []; w.runs ??= []; w.rules ??= []; w.num ??= w.prs.length; }
  t.start(w, (cmd, who = "you", desk = 0) => {
    const r = exec(w, cmd, who, desk);
    if (!r.ok) throw new Error(`start of ${t.id}: ${cmd}\n${r.out}`);
  });
  // what the start did is not something you did in a step
  for (const k of ["rejected", "ruleRejected", "sawLog", "movedHead"]) delete w.vars[k];
  return w;
}

/* the world as it is at the start of beat (ci, bi), reached the typical way */
export function replayTo(t: Track, ci: number, bi: number): G.World {
  const w = startWorld(t);
  const chapters = t.chapters;
  for (let c = 0; c < chapters.length; c++) {
    for (let b = 0; b < chapters[c].beats.length; b++) {
      if (c > ci || (c === ci && b >= bi)) return w;
      autoBeat(chapters[c].beats[b], w, (cmd, who, d) => {
        const r = exec(w, cmd, who, d);
        if (!r.ok && !refused(r.out)) throw new Error(`replay ${t.id} ${chapters[c].beats[b].id}: ${cmd}\n${r.out}`);
      });
    }
  }
  return w;
}

export interface Ran { kind: "cmd" | "out" | "err" | "note"; text: string; who: Who }

/* beat (ci, bi) done the typical way: the world right after it, and the log of
 * what ran (commands and git's answers), so a step rebuilt after a reload
 * still shows what happened under the hood */
export function finishBeat(t: Track, ci: number, bi: number): { w: G.World; log: Ran[] } {
  const w = replayTo(t, ci, bi);
  const log: Ran[] = [];
  autoBeat(t.chapters[ci].beats[bi], w, (cmd, who, d) => {
    log.push({ kind: "cmd", text: cmd, who });
    const r = exec(w, cmd, who, d);
    if (r.out) log.push({ kind: r.ok ? "out" : "err", text: r.out, who });
  }, (text, who) => log.push({ kind: "note", text, who }));
  return { w, log };
}
