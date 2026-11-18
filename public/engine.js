/* engine.ts: runs commands and replays a track, with no DOM, so the same
 * code drives the page and the headless story check. */
import * as G from "./model.js";
import { run } from "./cli.js";
import { autoBeat } from "./story.js";
export const authorOf = (who) => (who === "albert" ? "Albert" : who === "toby" ? "Toby" : "You");
export function exec(w, cmd, who, desk) {
    // Toby has no computer: his repo is never there, so only gh works for him
    const r = run(w, { repo: who, desk, author: authorOf(who) }, cmd);
    if (/\[rejected\]/.test(r.out))
        w.vars.rejected = "1";
    if (/\[remote rejected\]/.test(r.out))
        w.vars.ruleRejected = "1";
    if (r.ok && /^\s*git\s+log\b/.test(cmd))
        w.vars.sawLog = "1";
    if (r.ok && /^\s*git\s+(switch|checkout)\b.*--detach|^\s*git\s+checkout\s+[0-9a-f]{5,}\s*$/.test(cmd))
        w.vars.movedHead = "1";
    // looks that change nothing on GitHub, kept so a step can ask whether you looked:
    // the runs whose checks gh pr checks listed (it fails when one is red), and the
    // run whose log gh run view printed
    if (/^\s*gh\s+pr\s+checks\b/.test(cmd) && /checks were/.test(r.out))
        w.vars.sawChecks = [...r.out.matchAll(/actions\/runs\/(\d+)/g)].map((m) => m[1]).join(" ");
    if (r.ok && /^\s*gh\s+run\s+view\b.*--log/.test(cmd))
        w.vars.sawRunLog = runViewed(w, cmd);
    const blocked = /#(\d+) is not mergeable: the base branch policy/.exec(r.out);
    if (blocked)
        w.vars.mergeBlocked = blocked[1];
    return r;
}
/* the run gh run view showed: the one its job belongs to, the ID given, or the newest */
function runViewed(w, cmd) {
    const runs = w.runs ?? [];
    const job = /(?:--job[= ]|-j\s+)(\d+)/.exec(cmd)?.[1];
    if (job)
        return String(runs.find((r) => r.jobs.some((j) => String(j.id) === job))?.id ?? "");
    return /\s(\d+)(?=\s|$)/.exec(cmd)?.[1] ?? String(runs.at(-1)?.id ?? "");
}
/* GitHub saying no on purpose: a rejected push, a red check, a merge the rules
 * block. A step can be about exactly that, so a replay goes on past it. */
const refused = (out) => /\[(remote )?rejected\]|Some checks were not successful|the base branch policy prohibits the merge/.test(out);
/* the world a track begins in: an empty folder, or what its start builds */
export function startWorld(t) {
    const w = G.freshWorld();
    if (!t.start)
        return w;
    // GitHub's side: the repository, the default labels, no issues, runs or rules
    G.ghInit(w);
    t.start(w, (cmd, who = "you", desk = 0) => {
        const r = exec(w, cmd, who, desk);
        if (!r.ok)
            throw new Error(`start of ${t.id}: ${cmd}\n${r.out}`);
    });
    // what the start did is not something you did in a step
    for (const k of ["rejected", "ruleRejected", "sawLog", "movedHead", "sawChecks", "sawRunLog", "mergeBlocked"])
        delete w.vars[k];
    return w;
}
/* the world as it is at the start of beat (ci, bi), reached the typical way */
export function replayTo(t, ci, bi) {
    const w = startWorld(t);
    const chapters = t.chapters;
    for (let c = 0; c < chapters.length; c++) {
        for (let b = 0; b < chapters[c].beats.length; b++) {
            if (c > ci || (c === ci && b >= bi))
                return w;
            autoBeat(chapters[c].beats[b], w, (cmd, who, d) => {
                const r = exec(w, cmd, who, d);
                if (!r.ok && !refused(r.out))
                    throw new Error(`replay ${t.id} ${chapters[c].beats[b].id}: ${cmd}\n${r.out}`);
            });
        }
    }
    return w;
}
/* beat (ci, bi) done the typical way: the world right after it, and the log of
 * what ran (commands and git's answers), so a step rebuilt after a reload
 * still shows what happened under the hood */
export function finishBeat(t, ci, bi) {
    const w = replayTo(t, ci, bi);
    const log = [];
    autoBeat(t.chapters[ci].beats[bi], w, (cmd, who, d) => {
        log.push({ kind: "cmd", text: cmd, who });
        const r = exec(w, cmd, who, d);
        if (r.out)
            log.push({ kind: r.ok ? "out" : "err", text: r.out, who });
    }, (text, who) => log.push({ kind: "note", text, who }));
    return { w, log };
}
//# sourceMappingURL=engine.js.map