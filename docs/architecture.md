# DAGMAWIT: architecture note

This is the short version of the agreed approach. Read it at the start of every working session.
The reasons behind each choice are in [decisions.md](decisions.md).

## What it is

A planning and scheduling web app for one fashion designer's atelier: orders, production plans and the
daily schedule. It is one web app, used on a phone (installed to the home screen) and on a desktop.
Cost, profit and accounting are left out on purpose.

## How it fits together

```
Phone and desktop (installed web app)
        │  pages, forms
        ▼
Next.js server ── server actions: check the user, validate input, write as her
        │            domain services: load data, call the engine, save the result
        │            scheduling engine: a pure function, data in, plan out   (src/domain/engine)
        ▼
Supabase ── Postgres with row-level security · Auth · private file storage
```

| Folder                      | What lives there                                                                                       | May import                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `src/domain`                | Plain logic: dates, durations, calendar rules, later the scheduling engine. No framework, no database. | nothing outside `src/domain`            |
| `src/server`                | Everything that touches the database, the session or secrets. Marked `server-only`.                    | `domain`                                |
| `src/app`                   | Routes. Thin: read data, call `domain`, render. Server actions sit beside the page that uses them.     | `domain`, `server`, `components`, `lib` |
| `src/components`, `src/lib` | Shared interface pieces and small client-safe helpers.                                                 | `domain`                                |
| `supabase/migrations`       | The database, as ordered SQL. The only way the schema changes.                                         |                                         |
| `test/db`                   | Tests that run against a real PostgreSQL.                                                              |                                         |
| `e2e`                       | The browser suite: the app in Chromium against the local Supabase stack (docs/testing.md).             |                                         |
| `src/backup`                | The export file: its format, the zip, the comparison the drill uses. No server, no browser.            | `domain`                                |
| `scripts`                   | Commands run by hand: `plan`, `restore`, `drill:restore`, the fuzzer.                                  | `domain`, `backup`                      |

The rule on `src/domain` is enforced by the linter. It is what lets the engine be tested hard and later run in the
browser as well as on the server.

## Rules we keep

1. **One way to do each thing.** One place for validation of a screen's input (`src/domain/*/forms.ts`), one for
   status rules, one for date handling (`src/domain/dates.ts`), one for how a length of time is written
   (`src/domain/duration.ts`), one way to protect a table (`app.secure_owner_table`). A second way is a bug in the making.
2. **A failing test is a question about the model.** Fix the cause in the model or the rule. Never change a test to
   match a symptom.
3. **The database is the authority.** Screen validation exists to give friendly messages. The database enforces the
   same rules, and shared test cases (`test/fixtures`) run against both so they cannot drift apart.
4. **A stage is done when its exit test passes and `decisions.md` is current.**

## Security model

- Every table that holds her data has `owner_id` and is secured by calling `app.secure_owner_table('public.<table>')`
  at the end of its migration. That switches on and forces row-level security, takes every right away from the
  anonymous role, and adds the four owner-only policies.
- `test/db/guard.test.ts` fails if any table in `public` is not secured that way. Adding a table without it breaks CI.
- The app has no browser-side database client. Pages and actions run on the server, as the signed-in designer, so
  row-level security applies to every query.
- The proxy (`src/proxy.ts`) refreshes the session and redirects, but it is a convenience. The boundary is the
  database, and every page and action also checks the user.
- Accounts are created by hand. Sign-up is off, and the sign-in form cannot create a user.
- Every page carries a Content-Security-Policy with a fresh nonce (decision 0059): scripts only from the app.
- Restoring data is a command, never a button (decision 0052); `app.restore_owner` is not reachable from the API.
- The phone keeps only today's My Day and the taps waiting for the signal, in the browser's storage; signing out
  removes them. The service worker keeps no data (docs/harden.md).

## The engine

`src/domain/engine` is plain logic with no framework, so it runs the same on the server, in the browser and in tests.
The rules are in [engine.md](engine.md). The files, in the order a plan is made:

| File                       | Step                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| `types.ts`                 | Everything that goes in and out. Plain data.                                 |
| `model.ts`                 | Validate the facts and turn them into day numbers; refuse rather than guess. |
| `capacity.ts`, `passes.ts` | Time arithmetic; the forward and backward passes (proven bounds, slack).     |
| `allocate.ts`              | Place pinned things, then everything else, most urgent first.                |
| `check.ts`, `explain.ts`   | Judge each order's promise; put every finding into words.                    |
| `plan.ts`, `diff.ts`       | The one entry point; what changed between two plans.                         |
| `calendar.ts`              | Build the engine's calendar from her saved working week.                     |
| `render.ts`, `fixtures/`   | A plan in plain words; the sample situations (`npm run plan`).               |
| `testing/`                 | The random-situation generator used by the property tests.                   |

## Data conventions

- Dates are plain `YYYY-MM-DD` text and are never turned into instants. Times of day are `HH:MM` on her wall clock.
  Real instants are stored in UTC and shown in her time zone.
- Planning works by day, in minutes per day, not by clock time. Only fixed events have a clock time.
- Changing the database means adding a new migration file. Never edit one that has been applied anywhere real.

## Stage status

| Stage                    | Status                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Ground                 | Built. Exit test 1 (install on her phone) is manual and still to do. Exit test 2 (a second account cannot see her rows) is automatic and passes.                                                                                                                                                                                                                                  |
| 1 Engine, no screens     | Built. `npm run plan` prints a plan for a sample situation; the rules are in [engine.md](engine.md). Needs her real orders and the PRD section 13 text to replace the reconstructed samples.                                                                                                                                                                                      |
| 2 Capture                | Built. Clients, measurement versions, orders, garments, sketches and photos, preparation, status moves and history. Exit test (she enters three real orders unaided) is manual; see [capture.md](capture.md).                                                                                                                                                                     |
| 3 Templates and proposal | Built. Library of templates (three starters), applying one to a garment, tasks with links and needs, proposals for the whole atelier, review, approve and reject; see [planning.md](planning.md). Exit test (one real order with a plan she believes) is manual.                                                                                                                  |
| 4 My Day                 | Built. Today's list from the approved plan, start / done with actual time / still going / hold, computed blocked, Quick Add, end-of-day review into tomorrow's proposal; see [my-day.md](my-day.md). Exit test (a week run from it) is manual.                                                                                                                                    |
| 5 Change                 | Built. Save and see impact on preparation items and tasks, What moves on the review, work pinned to a day, the Planner's week board; see [change.md](change.md). Exit test (the lace delay on her real data) is manual.                                                                                                                                                           |
| 6 Harden                 | Built. Export of everything (Settings → Data), the restore command and its drill, My Day without signal with waiting taps, a nonce Content-Security-Policy, the accessibility pass; English and Gregorian dates only (decision 0061); see [harden.md](harden.md) and [operations.md](operations.md). Exit test (a restore succeeds; her day opens with no signal) is half manual. |

## Known gaps in Stage 6

- The restore runs as the tables' owner, not a superuser (decision 0054), and CI runs the drill against the Supabase
  stack. One restore into a scratch Supabase project before relying on it is still worth doing (operations.md).
- Without signal she can start, finish and update tasks; holding, Quick Add and plans need the signal (decision 0057).
- The offline page appears when a page does not answer in 8 seconds; that path was reasoned about, not driven in a
  browser test (the no-signal path was).

## Known gaps in Stage 5

- A move is made by editing the task (its day, its pin), not by dragging it on the board. Dragging, and a month view,
  were left out of the first release (Build order board).
- Pinning puts all of a task on one day; splitting a long task over chosen days is not offered.

## Known gaps in Stage 4

- Today's list follows the approved plan. When she works ahead of it or falls behind, the list is right again after
  the end-of-day review and the next approval, not by itself during the day.
- The actual times are kept but not yet used to suggest better template durations.
- Quick Add makes work only (her own time), not an appointment or a wait.

## Known gaps in Stage 3

- The starter templates were written without her: every duration is a guess until she replaces it.
- A fitting whose day has passed stops every proposal until it is moved or marked done (Stage 4 added done).

## Known gaps in Stage 2

- The order statuses and their moves were designed from decision 0018, not from the PRD text, which was not available.
  They should be checked against it.
- The starter list of measurements is a guess. She is expected to rename, reorder, hide and add in Settings.
- Storage was tested through its policies on PostgreSQL and through a stand-in in the browser, not against a real
  Supabase Storage. Check one upload on the real project before relying on it.
- If the server stops between storing a picture and recording it, the stored file stays with nothing pointing at it.
  Closed in Stage 6: Settings → Data → Tidy stored pictures.
- HEIC pictures are not accepted. An iPhone normally sends a JPEG when the page asks for one (the picker does the
  conversion), but a HEIC file chosen some other way, on a computer say, is refused with a plain message.
- A delivered order cannot take new photos. Handover and fitting photos after delivery belong to Stage 5.

## Known gaps in Stage 1

- The bridal gown sample is a reconstruction. The PRD section 13 text was not available, so the sample follows its
  outline. It should be replaced with the real text and with fixtures from her actual orders.
- The planner is greedy (decision 0014). On some crowded weeks it can plan an order late that a cleverer search would
  have finished in time. It says `at_risk`, never `infeasible`, in those cases.

## Known gaps in Stage 0

- ~~No strict Content-Security-Policy yet.~~ Closed in Stage 6 (decision 0059).
- ~~No browser end-to-end test in the repository.~~ Closed: the Playwright suite in `e2e/` runs in CI against the
  local Supabase stack (docs/testing.md, decision 0062).
- One break per day in the working-week screen. The database allows up to six.
- Past days off are kept in the database but not listed.
