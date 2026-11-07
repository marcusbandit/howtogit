// Replays every beat the typical way and checks each one counts as done.
import { chapters } from "../public/story.js";
import { replayTo } from "../public/engine.js";
let fails = 0;
chapters.forEach((ch, c) => ch.beats.forEach((b, i) => {
  if (b.id === "end") return;
  try {
    const w = replayTo(c, i + 1);
    const ok = b.done(w);
    if (!ok) { fails++; console.log(`NOT DONE  ${c + 1}.${i + 1} ${b.id}`); }
  } catch (e) { fails++; console.log(`THROWS    ${c + 1}.${i + 1} ${b.id}: ${e.message}`); }
}));
const w = replayTo(chapters.length - 1, 0);
console.log("final you desk0:", w.repos.you.desks[0].branch, "desks:", w.repos.you.desks.length);
console.log(w.repos.you.desks[0].work["pancakes.md"]);
console.log(fails ? `${fails} problem(s)` : "all beats complete");
process.exitCode = fails ? 1 : 0;
