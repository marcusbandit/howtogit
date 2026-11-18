import { chapters } from "./story.js";
import { github } from "./tracks/github.js";
import { ci } from "./tracks/ci.js";
import { habits } from "./tracks/habits.js";
export const git = { id: "git", title: "How git works", short: "git", word: "git", chapters };
export const tracks = [git, github, ci, habits];
export const trackById = (id) => tracks.find((t) => t.id === id);
//# sourceMappingURL=tracks.js.map