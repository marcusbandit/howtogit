/* tracks.ts: what you came to learn. Each track is its own lesson with its
 * own chapters and its own saved progress.
 *
 * A track's `start` builds the world it begins from, by running real
 * commands through the engine (run), so the starting world is one git could
 * have made. Without `start` a track begins from an empty folder, as the git
 * track does. Each track other than git lives in its own file under
 * src/tracks/ so they can be written side by side.
 */
import type { World } from "./model.js";
import { chapters, type Chapter, type Who } from "./story.js";
import { github } from "./tracks/github.js";
import { ci } from "./tracks/ci.js";
import { habits } from "./tracks/habits.js";

export type TrackId = "git" | "github" | "ci" | "habits";

/* runs one command in the world as someone (you by default, on desk 0); it
 * throws if git or gh refuses, so a broken start shows up in the checks */
export type RunCmd = (cmd: string, who?: Who, desk?: number) => void;

export interface Track {
  id: TrackId;
  title: string; // on the intro card and the track switcher
  short: string; // a word or two, for tight spots
  word: string; // what its terms are called: "git" gives "git words" and "Git word"
  chapters: Chapter[]; // a last chapter with short "recap" shows every word earned
  start?: (w: World, run: RunCmd) => void;
}

export const git: Track = { id: "git", title: "How git works", short: "git", word: "git", chapters };

export const tracks: Track[] = [git, github, ci, habits];

export const trackById = (id: string | null | undefined): Track | undefined => tracks.find((t) => t.id === id);
