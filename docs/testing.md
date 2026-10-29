# Testing

Four layers, each catching what the one before cannot. The reasons are in decisions 0003, 0014 and 0062.

| Layer          | Command             | What it proves                                                                     | Needs                       |
| -------------- | ------------------- | ---------------------------------------------------------------------------------- | --------------------------- |
| Unit           | `npm run test:unit` | The rules: dates, durations, the engine, forms, the offline taps, the export file. | Nothing                     |
| Database       | `npm run test:db`   | Row-level security, every database rule, the export and restore, the drill.        | PostgreSQL (`DATABASE_URL`) |
| Browser        | `npm run test:e2e`  | Her flows in a real Chromium, against real sign-in, storage and database.          | The local Supabase stack    |
| Engine fuzzing | `npm run test:fuzz` | The engine on thousands of random situations.                                      | Nothing                     |

`npm run check` runs everything but the browser suite and the fuzzer; CI runs the browser suite as its own job.

## The browser suite (`e2e/`)

### Run it on your computer

```
supabase start                         # database, sign-in, storage, and Mailpit for the sign-in codes
supabase status                        # shows the keys below
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_PUBLISHABLE_KEY=<publishable key>
export SUPABASE_SERVICE_ROLE_KEY=<service role / secret key>
npm run build
npx playwright install chromium        # once
npm run test:e2e                       # starts the built app on port 3000, then runs the specs
```

Other settings, with their local defaults: `E2E_BASE_URL` (an app already running, instead of starting one),
`E2E_DATABASE_URL` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), `E2E_MAILPIT_URL`
(`http://127.0.0.1:54324`), `E2E_EMAIL` (`dagmawit.e2e@example.test`).

A failed run leaves a trace for each failed step: `npx playwright show-trace test-results/<step>/trace.zip`.

### How it works

- **One account, one sign-in.** `global-setup.ts` deletes the suite's account (and with it all its data) through
  Supabase's admin API, creates it again, and signs in once with the code read from Mailpit. The session is saved and
  shared: Supabase sends at most one code a minute.
- **Her story, in order.** The specs run one after another in one worker, each on what the one before left:

  | Spec                  | Stage | What she does                                                                     |
  | --------------------- | ----- | --------------------------------------------------------------------------------- |
  | `01-capture.spec.ts`  | 2     | Sets her week; takes three orders with pictures, measurements and preparation.    |
  | `02-plan.spec.ts`     | 3     | Edits her library; plans an order; reviews, approves and rejects proposals.       |
  | `03-day.spec.ts`      | 4     | Lives the day: blocked, start, done, still going, hold, Quick Add, the review.    |
  | `04-change.spec.ts`   | 5     | The lace is late: sees what moves, approves; pins work; the week board.           |
  | `05-harden.spec.ts`   | 6     | No signal and waiting taps; export and the restore drill; tidying; CSP; keyboard. |
  | `06-sign-out.spec.ts` | 6     | Signs out (last: it ends every session of hers, the shared one too).              |

- **Through the screens.** Data changes only through the app. The database is read to check what was stored; the
  one write is ageing a stored file for the tidy-up test.
- **Dates from today.** Every day typed or expected is counted from today in her time zone, so the suite keeps
  working as the calendar moves. Her week is set to every day, so whatever day it runs, today has work.
- **Every screen, every look.** Each spec checks its screens for sideways scrolling and with axe (WCAG 2.2 A and AA)
  on a phone, on a desktop and at night; `05-harden` adds axe's best practices on every screen. Each spec fails if
  the browser reported an error it did not cause on purpose.
- **Local only.** It refuses to run unless the app, Supabase and the database are on this machine
  (`E2E_ALLOW_REMOTE=1` overrides, for a throwaway project only).

### When it fails

A failing step is a question about the app first (rule 2 in architecture.md). Read the trace before changing the
step. Change a step only when the app is right and the step asked the wrong question, and say why in the step.
