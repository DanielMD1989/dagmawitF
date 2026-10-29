# Design tokens

The single source is `src/app/globals.css`. This page only explains it. The numbers below are checked on every test
run by `src/design/contrast.test.ts`, so they cannot go stale.

| Token                    | Day               | Night             | Used for                        |
| ------------------------ | ----------------- | ----------------- | ------------------------------- |
| `--bg`                   | #F6F2EA           | #2A2723           | Page                            |
| `--surface`              | #FFFDF8           | #34312B           | Cards, navigation               |
| `--ink`                  | #25231F           | #ECE6D8           | Main text, main button          |
| `--muted`                | #5C574D           | #BDB6A6           | Secondary text                  |
| `--accent`               | #3F5A4B           | #A9C5B1           | Links, selected item, meter     |
| `--tint`                 | #E9EFE8           | #3B4A41           | Selected item background, chips |
| `--solid` / `--on-solid` | #3F5A4B / #FFFFFF | #4D6B5A / #F3EFE4 | Strong chips, chosen option     |
| `--warn` / `--warn-bg`   | #7A3622 / #FBF0EB | #F0B9A2 / #3D2D27 | Problems and blocked work       |
| `--sand` / `--sand-ink`  | #E8DABB / #4A4333 | #5A5130 / #F0E6C4 | Waiting items                   |
| `--field`                | #FFFFFF           | #231F1B           | Text boxes                      |

Rules: colour never carries meaning alone (every state also has a word); touch targets are at least 44 px; night never
uses pure black or white. Fonts: Cormorant Garamond for headings, Instrument Sans for everything else, both served from
the app itself (no calls to Google).
