# Curiosity Companion — design

Date: 2026-06-22
Status: approved direction, landing instance only for first build

## Problem

The bottom-right explainer is a rigid scaffold: a fixed command heading, a preset
question ("What does it do?"), a click, another preset question ("What's in
`.git/`?"). It reads like a form with slots. It also explains everything up front
("here is what this command *will* do") even when the thing being described does
not exist yet — on the landing, `git init` is the command that *creates* `.git/`,
yet we describe `.git/` before the user has run anything.

Two deeper gaps:

1. **One tense only.** We pre-explain. We never say "here is what just happened"
   after an action, and we never point at where you could change a command to do
   something else.
2. **Explanation lives only on the landing.** The landing is rich with hand-drawn
   callouts and arrows; the moment the user starts typing commands they are pushed
   forward through the flow with no "why" and no pointing. The teaching voice
   abandons them after the first screen.

## Goal

Replace the explainer panel with a **curiosity companion**: a small area, bottom
right, that voices the questions a curious beginner actually asks, in their own
inner voice, and answers them in a gentle mentor voice. When an answer is about a
real thing on the board, it **sketches a hand-drawn arrow from the answer to that
thing**. The companion follows the user down the entire flow — but we build and
perfect it on the landing / `git init` step first, with the machinery general
enough that later steps are just data.

## Decisions (locked with the user)

- **Interaction model: clickable curiosity list.** A handful of naturally-phrased
  questions sit in the area as tappable prompts. Tap one, its answer unfolds in
  place (reuse the existing grid-rows + caret-swing animation already built). The
  user chooses what they are curious about; nothing auto-narrates.
- **Lifecycle: swap, with peek-back.** The area shows the current step's questions.
  As the user advances, old questions clear and fresh ones fade in. A small
  "earlier ↩" affordance lets the curious scroll back to questions/answers from
  steps already passed. Current-focused, history on demand.
- **Answers point.** Opening an answer that is about a concrete on-screen thing
  (the `.git/` row, a node, the HEAD tag, a branch lane) draws a hand-drawn arrow
  from the answer to it, in the project's ink idiom (`note-stroke`, `landing-draw`
  animation). Abstract answers ("why do we need git?") stay text-only. This arrow
  mechanic is the single through-line that spreads pointing across the whole flow.
- **Before vs after differ.** Each step's questions split into a **pre** set (shown
  before the command runs) and a **post** set (shown after it runs). Before
  `git init`: forward-looking, text-only ("what's git init about to do?", "what
  even is git?"). After it runs and `.git/` appears: the set shifts to "what just
  happened?", "what's this `.git/` that showed up?" (arrow → the `.git/` row),
  "why do we even need it?". The area reacts to the event.
- **Voice.** Warm, lowercase, curious. Questions are the *user's* inner voice;
  answers are the gentle mentor. Match the existing hand voice ("i'll explain
  things over here as you go"). No jargon unless it is the thing being taught.
- **Scope now.** Build the machinery + the landing/`git init` instance only.
  Later steps (`add`, `commit`, `remote`, ...) are deliberately left as empty
  data to fill in afterwards. Nothing in the later flow changes in this build.

## Architecture

The project is TypeScript with no framework or bundler: `src/app.ts` compiles to
committed `public/app.js` via `tsc`; Cloudflare serves `public/`. The lesson is
driven by a step machine — `steps: Step[]`, `stepIndex`, `showStep(i)`,
`seekTo(target)`. Each `Step` already carries a `teach` block. The companion is an
extension of that same data-driven spine.

### Data model

Add an optional `curiosity` field to `Step`:

```ts
interface Curio {
  q: string;            // the question, in the user's inner voice
  a: string;            // the answer, mentor voice; may contain <b> for key terms
  points?: string;      // optional board-target key the answer's arrow points at
}
interface CuriositySet {
  pre?: Curio[];        // shown before the command runs
  post?: Curio[];       // shown after it runs
}
interface Step {
  // ...existing fields...
  curiosity?: CuriositySet;
}
```

`points` is a stable key resolved by the renderer to a live DOM/SVG element — e.g.
`"dotgit"` → the `.git/` row in the file tree, `"node:tip"` → the current HEAD
node, `"tag:HEAD"` → the HEAD label. The resolver is a small `key → () => Element`
map so targets stay declarative in the step data and the geometry lookup lives in
one place. New step data only ever references keys; it never reaches into the DOM.

### Renderer (one unit)

A `renderCuriosity(step, phase)` function, where `phase` is `"pre"` or `"post"`:

- Reads `step.curiosity?.[phase]` and renders the list into the bottom-right area
  (the existing `.note--explainer` region, restyled — no box, the free-text look
  already shipped).
- Each question is a button reusing the shipped tap-to-open mechanic
  (`aria-expanded`, grid-rows reveal, caret swing). No new animation work.
- On open, if the `Curio` has `points`, resolve the target element and draw an
  arrow from the answer to it using the existing ink helpers; on close, retract it.
- Swapping sets (advancing a step, or pre→post on run) fades the old list out and
  the new one in, matching the landing's `landing-fade` / `landing-wipe` timing.

### Wiring into the step machine

- `showStep(i)` (and `seekTo`) call `renderCuriosity(steps[i], "pre")` so the area
  always reflects the step you are on.
- The point where a command successfully runs (after `run()` resolves and the
  board updates) calls `renderCuriosity(steps[i], "post")` to swap to the
  what-just-happened set. This is the moment `.git/` has appeared, the node is
  drawn, etc., so arrow targets exist.
- Peek-back: a lightweight history of `{ stepKey, phase }` the area has shown,
  surfaced behind an "earlier ↩" control; selecting an earlier entry re-renders
  that set read-only (no command re-run).

### Arrows

Reuse the ink idiom already in the file: hand-drawn SVG paths with
`class="note-stroke"`, `pathLength="1"`, drawn on via the `landing-draw` keyframe.
The arrow originates near the open answer and curves to the resolved target. The
arrow layer is positioned over the board like the existing `.landing-notes` /
`.note__arrow` callouts. Because targets are resolved live, arrows stay correct as
the board pans/relayouts (recompute on the same resize hook that already
repositions the stage and re-centres HEAD).

### CSS

Build on what shipped: the unboxed free-text explainer, the question buttons, the
grid-rows answer reveal, the caret. Remove anything that assumed exactly two fixed
questions. The area becomes a vertical list of N questions driven by data.
Reduced-motion: arrows and reveals fall back to instant, consistent with the
existing `prefers-reduced-motion` block.

## Landing content (git init)

**Pre (before running, text-only):**
- "what even is git?" — git keeps a history of your project: every saved version,
  so you can look back, undo, and work without fear of losing anything.
- "what's `git init` about to do?" — it turns this plain folder into a git
  repository, so git can start tracking it. you only do this once per project.

**Post (after running, `.git/` now exists):**
- "wait, what just happened?" — your folder is now a git repository. nothing about
  your files changed; git just added a place to keep track of them.
- "what's this `.git/` that showed up?" *(arrow → `.git/` row)* — that's where git
  stores everything it remembers: every snapshot, every branch, and a pointer
  called HEAD that marks where you are. delete `.git/` and it's an ordinary folder
  again.
- "why do we even need it?" — without it, your files are just files. with it, you
  get history, undo, branches, and a way to share — everything the rest of this
  page teaches.

Exact wording is refinable during build; structure and tense are the contract.

## Success criteria

- The bottom-right shows a data-driven list of naturally-voiced questions for the
  current step, not a fixed two-question scaffold.
- Before `git init` runs, only forward-looking text questions show; the instant it
  runs and `.git/` appears, the set swaps to what-just-happened questions.
- Opening "what's this `.git/`?" draws a hand-drawn arrow to the actual `.git/` row
  in the file tree, in the project's ink style, and retracts on close.
- An "earlier ↩" affordance lets the user revisit a passed step's questions.
- Later steps carry empty/absent `curiosity` and the flow past `git init` is
  visually unchanged by this build.
- `tsc` compiles clean; verified by screenshotting pre-run, post-run, and an open
  pointing answer via headless `google-chrome-stable`.

## Out of scope (this build)

- Authoring curiosity content for `add` / `commit` / `remote` / `branch` / etc.
- User-typed free-form questions.
- Self-surfacing / auto-narrating questions (we chose user-driven clicking).
- Any change to the command-line, graph model, or step sequence.

## Propagation (later, not now)

Once the landing instance feels right, each subsequent step gets its own `pre` /
`post` curiosity data and arrow targets. No new mechanism — fill in data, name the
board targets. The companion thereby threads the whole page, replacing the current
"forced forward with no why" feeling step by step. Track progress in PROJECT.md.
