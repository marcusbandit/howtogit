# Design rules: type

The page uses six text sizes, three fonts and three weights. Nothing else.
`design/tokens.json` holds the lists, and `scripts/check-design.mjs` fails CI on any
value that is off them. Run it before you push:

    node scripts/check-design.mjs

It prints each problem as `file:line` with the value it should become.

## Sizes

| px | Use it for |
| --- | --- |
| 12 | The smallest text: counters, tags, captions, mini previews, terminal text on a phone |
| 14 | Small UI: hints, chips, tabs, commands, secondary lines, small buttons |
| 16 | Body text and normal buttons |
| 20 | The big button, sub headings, the lead line |
| 28 | Caveat headings and handwritten labels |
| 44 | The hero title |

Only these values pass. `inherit` is fine, which is how inline `code` should get its size.
A size that grows with the window is allowed as a `clamp()` whose two ends are both steps,
for example `clamp(20px, 3vw, 28px)`. No `em`, `rem` or bare `vw` sizes.

Moving an old value onto the scale: take the nearest step, and a tie goes up.

| Old values | Becomes |
| --- | --- |
| 9.5, 10, 10.5, 11, 11.5, 12, 12.5 | 12 |
| 13, 13.5, 14, 14.5 | 14 |
| 15, 15.5, 16, 16.5, 17, 17.5 | 16 |
| 18, 19, 20, 22 | 20 |
| 24, 26, 27, 28, 30, 32 | 28 |
| 34 and up | 44 |

The nearest step is the starting point, not a law. When two things sit side by side and
should read as different levels, put them on different steps. Never invent a step between
two.

## Fonts and weights

| Font | Variable | For | Weights |
| --- | --- | --- | --- |
| Hanken Grotesk | `var(--ui)` | Everything by default | 400, 600, 700 |
| Caveat | `var(--hand)` | Handwritten headings and labels | 600, 700 |
| Space Mono | `var(--mono)` | Commands, file names, hashes | 400, 700 |

- 400 is regular text, 600 marks the current or chosen thing, 700 is headings, buttons and
  bold.
- Old weights move like this: 500 to 400, 650 to 700, 800 to 700.
- Write weights as numbers, never `bold` or `normal`.
- Caveat has no 400, so every rule that sets `var(--hand)` writes its weight next to it.
  Otherwise it inherits 400 from the page and the browser fakes it.
- A family is always one of the three variables or `inherit`. Never a font name.
- The Google Fonts link in `public/index.html` loads exactly these weights, so a weight
  that is not here cannot be used by accident.

## Changing the rules

Change `design/tokens.json` and this file in the same commit. The check reads the JSON, so
a new step there passes everywhere at once. Add a step only when two real things on screen
need it, and say which two in the commit message.

## Buttons

Buttons come in three heights. They are set with `min-height`, so a label that wraps
can still grow the button instead of spilling out.

| Height | For |
| --- | --- |
| 32 | Pills inside a bar: chapter tabs, the mode switch |
| 40 | Secondary actions: Back, Undo, notes, the theme toggle, `.btn--small` |
| 48 | Every main `.btn`: Next, the action buttons |

The big Start button on the intro is the one exception, and the inline buttons that live
inside text (file names, explain) take the height of their line. The tiny buttons drawn
inside the app previews are pictures of buttons, not buttons, and follow the preview.
