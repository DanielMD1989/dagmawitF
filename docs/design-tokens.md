# Design tokens

The single source is `src/app/globals.css`. This page only explains it. For now the app is always light (decision 0073):
the Night column is kept, and checked, for when dark mode returns. The numbers below are checked on every test
run by `src/design/contrast.test.ts`, so they cannot go stale.

| Token                        | Day               | Night             | Used for                              |
| ---------------------------- | ----------------- | ----------------- | ------------------------------------- |
| `--bg`                       | #F4F5F1           | #131A14           | Page                                  |
| `--surface`                  | #FFFFFF           | #1C261D           | Cards                                 |
| `--ink`                      | #1A231A           | #E6EEE4           | Main text                             |
| `--muted`                    | #5B675D           | #A8B8A7           | Secondary text                        |
| `--accent`                   | #0F3F00           | #A6D39A           | Links, selected item, meter           |
| `--tint`                     | #E3ECDD           | #22301D           | Selected item background, chips       |
| `--solid` / `--on-solid`     | #0F3F00 / #FFFFFF | #0F3F00 / #F3F7F1 | Main buttons, strong chips            |
| `--solid-hover`              | #1F5A10           | #1F5A10           | Main button, pointed at               |
| `--nav-bg`                   | #0F3F00           | #0F3F00           | Bottom bar (side bar on wide screens) |
| `--nav-ink` / `--nav-active` | #BCCBB5 / #FFFFFF | #BCCBB5 / #FFFFFF | Bar: other pages / the open page      |
| `--nav-pill`                 | #2F6420           | #2F6420           | Behind the open page                  |
| `--icon-bg`                  | #E6E9E2           | #263327           | Grey circle of a row's icon           |
| `--warn` / `--warn-bg`       | #A23A1E / #FBF0EB | #F0B9A2 / #3D2D27 | Problems and blocked work             |
| `--sand` / `--sand-ink`      | #E8DABB / #4A4333 | #5A5130 / #F0E6C4 | Waiting items                         |
| `--field`                    | #FFFFFF           | #162017           | Text boxes                            |

Her design (decision 0071): one green, #0F3F00, for buttons, green words and the bar; the open page on the bar is
white on a lighter shade of it. Cards are white with a soft green-tinted shadow and 16 px corners; the bar has 24 px
top corners.

Rules: colour never carries meaning alone (every state also has a word); touch targets are at least 44 px; night never
uses pure black or white. Font: Inter throughout (titles 24 px bold, section headings 18 px semi-bold), served from the
app itself (no calls to Google).

## The phone app look (decision 0105)

The page is a cooler light grey, so white lists read as lists; cards no longer cast shadows; the warning colour is a
brighter brick. Checked pairs: muted #5B675D on white 5.9:1, on the page 5.4:1, on the grey of a segmented control
4.8:1; warning #A23A1E on white 6.7:1, on its own ground 5.9:1; green #0F3F00 on its tint 10:1; text on the page 14.8:1.
