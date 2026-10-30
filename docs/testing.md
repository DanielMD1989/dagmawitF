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
supabase start                         # database, sign-in and storage
supabase status                        # shows the keys below
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_PUBLISHABLE_KEY=<publishable key>
export SUPABASE_SERVICE_ROLE_KEY=<service role / secret key>
npm run build
npx playwright install chromium        # once
npm run test:e2e                       # starts the built app on port 3000, then runs the specs
```

Other settings, with their local defaults: `E2E_BASE_URL` (an app already running, instead of starting one),
`E2E_DATABASE_URL` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), `E2E_EMAIL` (`dagmawit.e2e@example.test`).

A failed run leaves a trace for each failed step: `npx playwright show-trace test-results/<step>/trace.zip`.

### How it works

- **One account, one sign-in.** `global-setup.ts` deletes the suite's account (and with it all its data) through
  Supabase's admin API, creates it again with a fresh random password, and signs in once on the sign-in page. The
  session is saved and shared; the password is kept in `e2e/.auth/` (never committed) for the last spec, which changes
  it and signs in again.
- **Her story, in order.** The specs run one after another in one worker, each on what the one before left:

  | Spec                  | What she does                                                                           |
  | --------------------- | --------------------------------------------------------------------------------------- |
  | `01-jobs.spec.ts`     | Her week; builds jobs step by step, with pictures and measurements; statuses; deleting. |
  | `02-calendar.spec.ts` | Today and the month; ticks; her own work; times, clashes; moving days; lists; an event. |
  | `03-harden.spec.ts`   | No signal and waiting ticks; export and the restore drill; tidying; CSP; keyboard.      |
  | `04-sign-out.spec.ts` | Changes her password, signs out (last: it ends every session of hers).                  |

- **Through the screens.** Data changes only through the app. The database is read to check what was stored; the
  one write is ageing a stored file for the tidy-up test.
- **Dates from today.** Every day typed or expected is counted from today in her time zone, so the suite keeps
  working as the calendar moves. Every step's day is the one the test gives it; nothing is suggested.
- **Every screen, every look.** Each spec checks its screens for sideways scrolling and with axe (WCAG 2.2 A and AA)
  on a phone, on a desktop and on a device set to dark mode (where the app stays light); `03-harden` adds axe's best practices on every screen. Each spec fails if
  the browser reported an error it did not cause on purpose.
- **Local only.** It refuses to run unless the app, Supabase and the database are on this machine
  (`E2E_ALLOW_REMOTE=1` overrides, for a throwaway project only).

### When it fails

A failing step is a question about the app first (rule 2 in architecture.md). Read the trace before changing the
step. Change a step only when the app is right and the step asked the wrong question, and say why in the step.
