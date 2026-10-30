# Design tokens

The single source is `src/app/globals.css`. This page only explains it. For now the app is always light (decision 0073):
the Night column is kept, and checked, for when dark mode returns. The numbers below are checked on every test
run by `src/design/contrast.test.ts`, so they cannot go stale.

| Token                        | Day               | Night             | Used for                              |
| ---------------------------- | ----------------- | ----------------- | ------------------------------------- |
| `--bg`                       | #FAF8F5           | #131A14           | Page                                  |
| `--surface`                  | #FFFFFF           | #1C261D           | Cards                                 |
| `--ink`                      | #1A231A           | #E6EEE4           | Main text                             |
| `--muted`                    | #556355           | #A8B8A7           | Secondary text                        |
| `--accent`                   | #0F3F00           | #A6D39A           | Links, selected item, meter           |
| `--tint`                     | #E8EFE3           | #22301D           | Selected item background, chips       |
| `--solid` / `--on-solid`     | #0F3F00 / #FFFFFF | #0F3F00 / #F3F7F1 | Main buttons, strong chips            |
| `--solid-hover`              | #1F5A10           | #1F5A10           | Main button, pointed at               |
| `--nav-bg`                   | #0F3F00           | #0F3F00           | Bottom bar (side bar on wide screens) |
| `--nav-ink` / `--nav-active` | #BCCBB5 / #FFFFFF | #BCCBB5 / #FFFFFF | Bar: other pages / the open page      |
| `--nav-pill`                 | #2F6420           | #2F6420           | Behind the open page                  |
| `--icon-bg`                  | #EEF0EC           | #263327           | Grey circle of a row's icon           |
| `--warn` / `--warn-bg`       | #7A3622 / #FBF0EB | #F0B9A2 / #3D2D27 | Problems and blocked work             |
| `--sand` / `--sand-ink`      | #E8DABB / #4A4333 | #5A5130 / #F0E6C4 | Waiting items                         |
| `--field`                    | #FFFFFF           | #162017           | Text boxes                            |

Her design (decision 0071): one green, #0F3F00, for buttons, green words and the bar; the open page on the bar is
white on a lighter shade of it. Cards are white with a soft green-tinted shadow and 16 px corners; the bar has 24 px
top corners.

Rules: colour never carries meaning alone (every state also has a word); touch targets are at least 44 px; night never
uses pure black or white. Font: Inter throughout (titles 24 px bold, section headings 18 px semi-bold), served from the
app itself (no calls to Google).
