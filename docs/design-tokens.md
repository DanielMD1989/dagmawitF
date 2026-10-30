# Design tokens

The single source is `src/app/globals.css`. This page only explains it. The numbers below are checked on every test
run by `src/design/contrast.test.ts`, so they cannot go stale.

| Token                        | Day               | Night             | Used for                              |
| ---------------------------- | ----------------- | ----------------- | ------------------------------------- |
| `--bg`                       | #FAF8F5           | #131A14           | Page                                  |
| `--surface`                  | #FFFFFF           | #1C261D           | Cards                                 |
| `--ink`                      | #1A231A           | #E6EEE4           | Main text                             |
| `--muted`                    | #556355           | #A8B8A7           | Secondary text                        |
| `--accent`                   | #1E7B1E           | #7FD883           | Links, selected item, meter           |
| `--tint`                     | #E7F3E5           | #213622           | Selected item background, chips       |
| `--solid` / `--on-solid`     | #1E7B1E / #FFFFFF | #2E7D32 / #F3F7F1 | Main buttons, strong chips            |
| `--solid-hover`              | #186618           | #276B2B           | Main button, pointed at               |
| `--nav-bg`                   | #0D3E0D           | #0A2A0B           | Bottom bar (side bar on wide screens) |
| `--nav-ink` / `--nav-active` | #B9CBB9 / #7FD883 | #A8BCA8 / #8FE092 | Bar: other pages / the open page      |
| `--warn` / `--warn-bg`       | #7A3622 / #FBF0EB | #F0B9A2 / #3D2D27 | Problems and blocked work             |
| `--sand` / `--sand-ink`      | #E8DABB / #4A4333 | #5A5130 / #F0E6C4 | Waiting items                         |
| `--field`                    | #FFFFFF           | #162017           | Text boxes                            |

Her design (decision 0071) named forest green #228B22 for buttons. White on it is 4.4:1, just under the 4.5:1 normal
text needs, so buttons and green text use #1E7B1E, the same green one step deeper (5.4:1). Cards are white with a soft
green-tinted shadow and 16 px corners; the bar has 24 px top corners.

Rules: colour never carries meaning alone (every state also has a word); touch targets are at least 44 px; night never
uses pure black or white. Font: Inter throughout (titles 24 px bold, section headings 18 px semi-bold), served from the
app itself (no calls to Google).
