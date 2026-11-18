// Replays every beat of every track the typical way and checks each one counts as done.
import { tracks } from "../public/tracks.js";
import { replayTo, startWorld } from "../public/engine.js";
let fails = 0;
for (const t of tracks) {
  let n = 0;
  try { startWorld(t); } catch (e) { fails++; console.log(`THROWS    ${t.id} start: ${e.message}`); continue; }
  t.chapters.forEach((ch, c) => ch.beats.forEach((b, i) => {
    if (b.kind === "next") return;
    n++;
    try {
      const w = replayTo(t, c, i + 1);
      if (!b.done(w)) { fails++; console.log(`NOT DONE  ${t.id} ${c + 1}.${i + 1} ${b.id}`); }
    } catch (e) { fails++; console.log(`THROWS    ${t.id} ${c + 1}.${i + 1} ${b.id}: ${e.message}`); }
  }));
  const ids = t.chapters.flatMap((ch) => ch.beats.map((b) => b.id));
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) { fails++; console.log(`DUPLICATE ${t.id} beat ids: ${dup.join(", ")}`); }
  console.log(`${t.id}: ${n} beats replayed`);
}
const git = tracks[0];
const w = replayTo(git, git.chapters.length - 1, 0);
console.log("final you desk0:", w.repos.you.desks[0].branch, "desks:", w.repos.you.desks.length);
console.log(w.repos.you.desks[0].work["report.md"]);
console.log(fails ? `${fails} problem(s)` : "all beats complete");
process.exitCode = fails ? 1 : 0;
