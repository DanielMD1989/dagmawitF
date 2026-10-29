# DAGMAWIT

Planning and scheduling for one fashion designer's atelier: orders, production plans and the daily schedule.
One web app, installed to the phone's home screen and used on a desktop too.

Start with [docs/architecture.md](docs/architecture.md) (the agreed approach, one page) and
[docs/decisions.md](docs/decisions.md) (why).

**Where it is:** Stage 0 of 6 (the ground the rest is built on). It signs her in, stores her working week and days off,
shows the time she has today, and installs on a phone. Orders, plans and the scheduling engine come next.

## What you need

- Node.js 22 or newer
- A Supabase project (free tier is enough to start): <https://supabase.com>
- For running the database tests locally: either the [Supabase CLI](https://supabase.com/docs/guides/cli) (needs Docker)
  or any PostgreSQL 15+ server you can create databases on

## Run it on your computer

```bash
npm install
cp .env.example .env.local        # then fill in the two values from Supabase: Project Settings > API
npm run dev                       # http://localhost:3000
```

With the Supabase CLI and Docker you can run everything locally instead of using a hosted project:

```bash
supabase start                    # prints the URL and publishable key for .env.local
# sign-in emails land in http://127.0.0.1:54324 (Inbucket); create a user in Studio at http://127.0.0.1:54323
```

## Checks

| Command                 | What it does                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`     | TypeScript, strict                                                                                     |
| `npm run lint`          | ESLint, including the rule that keeps `src/domain` free of framework code                              |
| `npm run test:unit`     | Calendar rules, working-time maths, form parsing, design-token contrast                                |
| `npm run test:db`       | Row-level security and database rules, against a real PostgreSQL (see below)                           |
| `npm run test:e2e`      | Her flows in a real browser against the local Supabase stack (see `docs/testing.md`)                   |
| `npm run plan`          | Print a plan for a sample situation, the way she would read it (`npm run plan -- bridal-gown`)         |
| `npm run test:fuzz`     | Try the scheduling engine on thousands of random situations, with a new seed each time                 |
| `npm run drill:restore` | Export a full set of data, restore it as someone else in a fresh database, compare (also in `test:db`) |
| `npm run restore`       | Put an export back into an account. Replaces everything in it; see `docs/operations.md`                |
| `npm run check`         | Everything above plus the production build. Run before every push; CI runs the same                    |

`test:db` uses `DATABASE_URL`. With the Supabase CLI, `supabase start` (or `supabase db start`) and the default
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` is right. On a plain PostgreSQL server set
`DATABASE_URL` to any database you may create databases from; the tests make their own scratch database and drop it.

## Put it online (once)

In this order. Each step says how to check it before going on.

1. **GitHub.** Push this repository (branch `main`). CI runs the checks, the database tests (with the restore drill)
   and the browser suite against a local Supabase. _Check:_ both CI jobs are green.
2. **Supabase project.** Create one in the region nearest Addis Ababa that Supabase offers, with a strong database
   password kept in a password manager. Its ref (in the project's address) goes in `.github/workflows/database.yml`.
   Then, in GitHub, Settings > Secrets and variables > Actions, add two **repository secrets**:
   - `SUPABASE_ACCESS_TOKEN`: a personal access token from supabase.com/dashboard/account/tokens;
   - `SUPABASE_DB_PASSWORD`: the database password.

   The **Database** workflow then applies the migrations every time CI passes on `main` (or run it from the Actions
   tab). _Check:_ the Database run is green; Table Editor lists `orders`, `task`, `plan_version`; Storage lists the
   private bucket `order-files`.

3. **Sign-in settings** (Authentication; menu names change, the settings do not):
   - turn **off** "Allow new users to sign up" (under Sign In / Providers, the general switch);
   - leave the **Email** provider itself **on**: it is how she signs in with her email and password;
   - set the minimum password length to **10** (the app asks for the same);
   - URL Configuration > Site URL: the app's address from step 5 (come back after step 5).

   No email sender is needed: the app never sends email (decision 0065).

4. **Her account.** Authentication > Users > Add user, with her email and a password, and "Auto Confirm User" ticked
   (and one for you, to try it first). Give her the password in person; she can change it in Settings. Her profile,
   starter templates and measurement list are created automatically.
5. **Hosting** (for example Vercel). Import the repository; set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (Project
   Settings > API). Never the secret key. Put the functions in the region nearest the Supabase project.
   _Check:_ sign in with your own account and its password; the browser's console shows no Content-Security-Policy errors;
   Settings > Download everything gives a zip, and `npm run drill:restore -- --file <zip>` passes on your computer.
6. **Her phone.** Stage 0's exit test below, then Stage 6's.

## Stage 0 exit tests

1. **She signs in on her phone and adds the app to her home screen.** Manual, once it is online.
   iPhone: open the site in Safari > Share > Add to Home Screen. Android: Chrome menu > Install app.
2. **A second account cannot see her rows.** Automatic: `test/db/rls.test.ts`.

After step 1, open Settings, tick her working days, set her hours and save. My Day will show the time she has today.

## Stage 2 exit test

She enters three of her current orders on her phone without help: client, garments, design brief, a photo of the sketch,
measurements, and what each order is waiting for. Wherever she reaches for her notebook, write down what was missing;
that is a field to add. First, in Settings > Your list of measurements, make the list match the measurements she
actually takes.

## Stage 3 exit test

With her, from orders she has made: replace the starter templates' durations with her own (Library), apply a template
to one real order, give its fittings their days, make a proposal, read it, and approve it. Done when she agrees the plan
is believable. Where it is not, write down why: a wrong duration, a missing step, a rule the planner does not know.

## Stage 4 exit test

She runs her working days from My Day for a week: starts and finishes tasks there, quick-adds what walks in, and finishes
each day with the review and tomorrow's plan. Count how often she went back to the notebook, and why.

## Stage 5 exit test

On her real data: when a supplier says the lace will be late, she changes its expected day with "Save and see impact",
reads what moves, and approves or rejects. Done when she trusts what it shows.

## Stage 6 exit test

1. **A restore from backup succeeds.** In Settings, Download everything. Then `npm run drill:restore -- --file <the zip>`
   must end with "The drill passed". Once, also restore a real export into a scratch Supabase project
   (docs/operations.md).
2. **The day's view opens on her phone with no signal.** Open My Day with signal, put the phone in airplane mode, open
   the app from the home screen: her day is there, "as of" the time she last opened it. Mark a task started, turn the
   signal back on, open the app: it says the tap was saved.

## Layout

```
src/domain      plain logic (dates, durations, calendar rules). No framework.
src/backup      the export file: format, zip, comparison
scripts         plan, restore, drill:restore, fuzz
src/server      database, session, secrets. Server only.
src/app         routes, forms and server actions
supabase        migrations (the schema), config, sign-in email template, test stand-in
test/db         tests that run against a real PostgreSQL
e2e             the browser suite (docs/testing.md)
docs            architecture note, decision log, design tokens
```
