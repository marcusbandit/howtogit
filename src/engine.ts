/* engine.ts: runs commands and replays the story, with no DOM, so the same
 * code drives the page and the headless story check. */
import * as G from "./model.js";
import { run, type Result } from "./cli.js";
import { chapters, autoBeat } from "./story.js";

export const authorOf = (who: "you" | "albert") => (who === "albert" ? "Albert" : "You");

export function exec(w: G.World, cmd: string, who: "you" | "albert", desk: number): Result {
  const r = run(w, { repo: who, desk, author: authorOf(who) }, cmd);
  if (/\[rejected\]/.test(r.out)) w.vars.rejected = "1";
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
