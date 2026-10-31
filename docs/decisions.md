# Decision log

Newest at the bottom. Each entry says what we decided, why, and what it costs. If you want to change one, add a new
entry that replaces it; do not rewrite history.

## 0001. A modular monolith on Next.js and Supabase

One deployable app (Next.js, React, TypeScript) on one Supabase project (Postgres, Auth, private Storage). One designer
and a few thousand rows do not need services. The scheduling engine stays a pure function so it can be tested hard and
later extracted if ever needed.

## 0002. Every table is secured one way, and a test enforces it

Tables holding her data carry `owner_id` and are secured by `app.secure_owner_table()`, which forces row-level
security and adds four owner-only policies. `test/db/guard.test.ts` fails the build for any table that is not secured.
Why: the likeliest future mistake is a new table shipped without protection. Checking by hand does not scale; a test does.

## 0003. Sign in with an emailed code, not a link

_Replaced by decision 0065._

She types a six-digit code. A link opened from email lands in the phone's browser, but an app installed on the home
screen keeps its own separate storage, so the link would sign her in somewhere she is not looking. Sign-up is off and
`shouldCreateUser` is false, so the form can never create an account. The form gives the same answer whether or not an
address has an account. Cost: one more step than a link. Accounts are created by hand in the Supabase dashboard.

## 0004. No browser-side database client

All reads and writes go through Next.js server components and server actions. One path for data, one place to check the
user, and no keys in the browser beyond the publishable one the proxy needs. Cost: no live updates; not needed yet.

## 0005. Her week and her days off are data, never constants

`work_week` (one row per working weekday), `calendar_exception` (holidays, half days, leave) and
`profile.planning_ratio` (default 0.70). The planner will use only these. `calendar_exception.date` is named `day`.
`replace_work_week()` saves the week in one transaction so a mistake in one day cannot leave a half-written week.

## 0006. Usable time is rounded down

Usable minutes = working minutes x planning ratio, rounded down, computed in whole percent. The plan must never promise
a minute she does not have. A 7h 30m day at 70% is 5h 15m.

## 0007. Validation lives in two places, tested as one

The database enforces the rules (final authority). The screen repeats them to write plain-language messages. Shared test
cases in `test/fixtures/work-day-cases.ts` run against both, so they cannot disagree. We accept the repetition because the
alternative, hiding database errors behind generic messages, serves her badly.

## 0008. Design tokens live in one file, with day and night values side by side

`src/app/globals.css` defines each colour once as `light-dark(day, night)`. The day values are the white and off-white
design she chose. Night is a soft warm charcoal with cream text, never pure black or white. Her choice (Follow my phone,
Light, Night) is a cookie, so the server renders the right theme with no flash. `src/design/contrast.test.ts` reads the
same file and fails if any text pairing drops below WCAG AA. Requires Chrome 123, Safari 17.5 or Firefox 120 (2024).

## 0009. The service worker stores no personal data

It makes the app installable, shows a friendly page with no signal, and keeps the app's own hashed files. It never caches
pages or anything from Supabase. Offline reading of today's plan comes in Stage 6, after a proper review of what may be
stored on a phone.

## 0010. Database tests run on plain PostgreSQL or on Supabase

`npm run test:db` uses whatever `DATABASE_URL` points to. On Supabase (CI) it runs against the migrated database. On plain
PostgreSQL it makes a scratch database, loads a small stand-in for Supabase's `auth` schema
(`supabase/tests/plain-postgres-shim.sql`) and applies the migrations. Every test runs in a transaction that is rolled back.

## 0011. Dates are text, times are wall-clock

`YYYY-MM-DD` and `HH:MM`, never converted to instants, so a working day cannot slip across midnight because of a time
zone. "Today" always means today in her time zone (`todayIn`).

## 0012. A refused form gives back what she typed

React empties a form when its action finishes, so a refused submission would wipe everything she entered and hide the
error that explains why. Every action that refuses input returns the submitted fields (`typedIn`) and the form shows them
again (`fieldValue`, `fieldTicked` in `src/lib/action-state.ts`). On success nothing is returned and the form shows what
was saved. A new form must follow the same rule.

## 0013. ESLint stays on version 9 for now

`eslint-config-next` bundles the React, import and accessibility rule sets, and none of them declare support for
ESLint 10 yet. Running an unsupported combination can switch rules off without a visible error, so we use the newest
version they do support (9.39). A deliberate violation of a hooks rule, an accessibility rule and a Next rule was
checked and is reported. Move to ESLint 10 when `eslint-config-next` supports it. Lint warnings fail the build
(`--max-warnings 0`) so they cannot pile up.

## 0014. The engine plans with a greedy scheduler and proves its "cannot" with bounds

Perfectly optimal scheduling of preemptible work with links, waits and fixed events is a hard problem, and she does not
need the optimum. She needs a plan she can read, that does not change for no reason, and honest words when a promise is
in danger. So `plan()` does two separate things. First, bounds: for every task and every order, the earliest it could be
ready if it had every hour of hers. These are proofs, not guesses. When a bound passes the day before handover, the
order is `infeasible`, and that is the only time the engine says "cannot". Second, a list scheduler: tasks are placed one
at a time, the most urgent first, each into the earliest days with time free. It can miss a deadline that a cleverer
search would meet; then the order is `at_risk` ("could be made, the plan is late"), never `infeasible`. The two are
tested against each other and against an exhaustive search (decision 0017). Alternatives considered and left out: an
integer-programming solver (heavy, unreadable results, plans that jump between runs) and a search for the optimum.

## 0015. Something she fixed by hand is never dropped from the plan

A fixed fitting or locked work is an appointment or a commitment. If the work before it is on hold, or has no room, the
engine does not hide it: it stays on its day and the engine says what is missing (the work before it, the lace that has
not arrived, a prerequisite with no date). Only a hold on the task itself, which is her own instruction, removes it.
Two fixed events on one day that are meant to follow each other must have clock times that agree, or the engine refuses.

## 0016. An order has a ready day only when every task of it is planned

`readyOn` was first the day the last planned task ends. With a task left out (on hold, no date to wait for, no room) that
is a promise date that is not true. `readyOn` is now empty until the whole order is in the plan, and the findings say
"the work planned for it ends on ..." instead. A finished order (every task done) is on track: there is nothing left to
plan. A task marked done out of order cuts the chain: the work behind it no longer has to come first.

## 0017. The engine is tested with examples, random situations and an exhaustive search

Hand-written examples show what we meant. Random situations (fast-check) show what we forgot: the rules in
`docs/engine.md` are checked on hundreds of random atelier weeks, and the first run found real faults (a ready day for an
unfinished order, fittings dropped from the plan, a lower bound that ignored a done task). Because "cannot be made" is the
strongest thing the engine says, it is also checked against a search that tries every way of spending her minutes on tiny
orders; for tasks that depend on nothing the two must agree exactly. The normal run uses a fixed seed, so a failure is
never a surprise from nowhere; `npm run test:fuzz` uses a fresh seed and prints it.

## 0018. An order has five stored statuses; everything else is worked out

`draft`, `active`, `on_hold`, `delivered`, `cancelled`. In production, ready, late and blocked are conclusions drawn from
the plan, so they are never stored (the same rule as for tasks). Only `active` orders are planned. The moves between
statuses are one table (`docs/capture.md`), held by the database and used by the buttons on screen, and tested over every
pair. Delivered is an explicit action with its own day; a delivered or cancelled order is frozen until reopened, and a
reopen is logged. The PRD's own status list was not available when this was written. If it differs, this entry is the
thing to revisit, and the table is the one place to change. The table is named `orders` because `order` is reserved in SQL.

## 0019. Every reference between her tables also carries her id

Row-level security hides other people's rows from queries, but a foreign key check does not go through it. A plain
`client_id` reference could point at someone else's client if its id were known, and the error message would confirm that
the row exists. So every parent table has `unique (owner_id, id)` and every child references `(owner_id, parent_id)`. A
reference to another owner's row is then impossible by construction, and a test tries it for every relationship. Cost: a
second column in each key.

## 0020. Rules are held by privileges and triggers, not only by the screens

Things that must never happen are made impossible in the database: a measurement version cannot be updated (the update right
is taken away), an order number cannot change (column-level rights), the history log cannot be written, changed or removed
through the API (only the triggers write it), and only a draft order can be deleted (through one function). Screens repeat
these rules to give plain messages (decision 0007), but they are not the protection.

## 0021. Measurements are immutable versions in her unit

A change to a client's measurements is a new row with the next version number. A garment points at the version it was
planned with, so nothing she cut from can be rewritten. The unit (`cm` or `in`) is a profile setting stored on each
version, so changing the setting does not alter old numbers. Her list of measurement fields is data: fields are renamed or
hidden, never deleted, because old versions still use them.

## 0022. Files are private, shrunk in the browser, and opened through our own address

Photos live in a private bucket under her id. The browser never talks to storage: it sends the file to a server action,
which checks it (type by content, size) and stores it as her, so decision 0004 still holds. A photo is shrunk to 1600 pixels
before it leaves her phone, which keeps uploads small on a weak connection. Pages link to `/files/<id>`, which checks the
session and ownership and redirects to a one-minute link, so a link copied from a page stops working. Alternatives left out:
public bucket (anyone with the link sees a client's fitting photos), long-lived signed links in the page (they leak and expire).

## 0023. History is written by the database, as codes and facts

A screen cannot forget to log a change that a trigger logs. Rows hold a code and a few facts (`status_changed`, from, to),
never a sentence, so wording lives in one place and could be translated. The wording is tested like the engine's warnings.

## 0024. Capture adds Clients to the navigation

The design board's menu has My Day, Orders, Planner, Library and Settings. Clients are looked up constantly while taking an
order, so they get their own place in the menu rather than a link buried inside Orders. Planner and Library appear when
those stages arrive.

## 0025. A delivered or cancelled order is frozen by the database, children included

The order row was already frozen; its garments, preparation items and pictures now are too
(`app.refuse_change_to_closed_order`, one message for all three). Reopening is the one way to change a closed order, so
its history says when and why. Photos after delivery are a Stage 5 handover feature, not an exception here.

## 0026. The order page is four sub-pages: brief, measurements, preparation, history

Each tab is its own route under `/orders/[id]`, with the header and status buttons in a shared layout. A tab can be
linked to (a new order lands on Preparation; recording measurements returns to Measurements), and a phone loads one tab
at a time. Alternative left out: one long page with client-side tabs.

## 0027. Measurements: a garment keeps its version; only an unmeasured garment is given one

A garment is attached to the client's latest version when it is created. When her first measurements are recorded from an
order, that order's garments without any version get it, because nothing has been cut yet and picking the only version,
garment by garment, is busywork. A garment that already has a version keeps it: a newer version is shown with what changed
and offered, never applied. Reordering her list is one database function (`reorder_measurement_fields`), so a list is never
left half-moved.

## 0028. Every select in a form is keyed by the value it shows

React resets a form after each server action and ignores a later change to a select's `defaultValue`, so a select showed
the value it had when the page opened even after a different one was saved (found in the browser run: an item saved as
Ordered showed Needed). `SelectField` now takes the shown value as its `key`, and every select in the app goes through it,
the time-zone choice in Settings included.

## 0029. Pictures are shown sketches first, in the domain's order

The kinds have an order that matters to her (sketch, inspiration, fabric, fitting, other), so the list is sorted by that
order in code (`compareAttachments`, tested), not alphabetically by the database.

## 0030. A template is copied into the order, with its version recorded

Applying a template copies its tasks, links and preparation into the order, and the garment records which template and
which version. The order is then hers to change, and editing the template later changes nothing already planned (the
data model board's rule). Alternative left out: orders that point at a live template, where one edit in the library
would silently move every plan made from it.

## 0031. A template's preparation is matched to the order's by label

A template says what its garment waits for ("Lace", "Main fabric"). When it is applied, each is matched with the order's
preparation items by label, ignoring capitals and spaces at the ends, and added only if missing. Stage 2's quick-add
buttons use the same words as the starter templates, so items she already listed are linked, not duplicated.

## 0032. An appointment with no day yet is left out of the plan and named

A fitting's day is agreed with the client after the order is taken, so a template's appointment has no day. The engine
used to refuse any fixed event without a day (`fixed_without_time`). Because a proposal plans the whole atelier, one
undated fitting would have stopped every proposal. Now the engine leaves it and the work after it out of the plan and
reports `fixed_undated`, the same way it treats material with no expected date (decision 0015's spirit: say what is
missing, never guess). A time that is not a clock time is still refused.

## 0033. A proposal plans the whole atelier; the review leads with one order

Her hours are shared, so a plan for one order is a plan for all of them. Each proposal is one engine run over every
active order. The review page, opened from an order, starts with that order and then shows what else moves. Approving
it approves the whole plan. Alternative left out: per-order plans, which could each look fine and together need more
hours than she has.

## 0034. A planning epoch makes a stale proposal impossible to approve

`profile.plan_epoch` is raised by triggers whenever a fact the engine reads changes. A proposal stores the epoch it was
made at; `approve_plan` refuses if it differs, if the proposal was made for another day, or if another plan was approved
since. The check is in the database, in the same transaction as the approval, so two windows cannot approve plans
built on different facts. Alternatives left out: a hash of the engine input checked by the server (the database could
not hold the rule), and trusting the screen to refresh.

## 0035. A plan is a numbered version with its slots in a table

A proposal is stored as a `plan_version` (number, status, the plan it was built on, the epoch, the day it was made for,
the engine's findings and the calendar it used) and `plan_slot` rows. My Day will read today's slots of the approved
version by index. The findings are kept as data, so an old plan can be reread exactly as it was proposed. Plans are
written and decided only through database functions; nothing edits them afterwards.

## 0036. Estimates are typed as hours and minutes

Two number fields with the numeric keypad, not one text field to parse ("1h 30", "1.5", "90"), so nothing she types can
be read two ways. They are stored as whole minutes, as the engine uses them.

## 0037. Every account starts with three templates

Like the measurement list (decision 0021), a starting point is easier to correct than an empty page. Their durations are
guesses and say so; the exit test asks for her own.

## 0038. Plans are reached from My Day and the order until the Planner exists

The phone's bottom bar holds five places: My Day, Orders, Clients, Library and Settings. The Planner (the week board)
arrives in Stage 5 and will hold the plans. Until then the list of plans is linked from My Day, which already says
which plan is approved, and from each order's Plan tab.

## 0039. The review shows causes, and folds their effects away

A gown with three fittings not yet dated and three items with no date produced twenty findings, most of them "this
task follows one that is not planned". Those effects disappear on their own when the cause is put right, so the review
lists the causes (with the garment, and a link to fix each) and folds the effects under "N more tasks wait behind
these". The Approve button counts causes only. A fitting whose work before it is missing is not an effect: it stays
on the day she set and is listed.

## 0040. Recording progress does not make the approved plan out of date

Starting a task or marking it done is living the plan, not changing it. If it raised `plan_epoch`, the approved plan
would read "out of date" after her first tap each morning, and the warning would stop meaning anything. Progress raises
its own counter, `progress_epoch`. A hold does raise `plan_epoch`: it removes work from the plan.

## 0041. A proposal made before progress was recorded cannot be approved

A proposal made in the morning plans the morning's work again if it is approved in the afternoon after that work was
done. `approve_plan` compares the proposal's `progress_epoch` with the current one, in the same transaction, like the
plan epoch (decision 0034).

## 0042. The estimate stays; the actual time is kept beside it

Marking a task done records the time it really took, in total. The estimate is not overwritten, so the difference can
teach the templates later (her own durations are the Stage 3 exit test). While a task is in progress she may say about
how long is left; the engine plans that, not the original estimate.

## 0043. Blocked is worked out, never stored

A task is blocked when it waits for a blocking preparation item that has not arrived. That is a fact of two other
rows, so it is computed where it is shown (`buildToday`) and by the engine, never kept in a column that could disagree.

## 0044. Quick Add makes studio work, with an optional order

Work that walks in has no garment and often no order. A task may have no order; the engine plans it after every
promise. When she picks an order, the task joins that order's first garment, so it is planned with the order.

## 0045. The day ends with a review that leads to tomorrow's proposal

The plan is only as good as what she tells it. The review asks, for every task of the day not done, whether it is done
or how long is left, then makes a proposal. Approving stays her decision.

## 0046. A change is saved, then shown as a proposal

"Save and see impact" saves the fact and makes a proposal; it does not show a what-if that is thrown away. The fact is
true (the lace really is late), so it belongs in the database whatever she decides about the plan, and a proposal is
already the thing that is reviewed, approved or rejected (decisions 0033 to 0035). One way to see a plan, not two.

## 0047. The Planner takes Clients' place in the phone's bar

Five places fit a phone's bar. The board's five are My Day, Orders, Planner, Library and Settings. Clients was added in
Stage 2 (decision 0024) for taking orders; the new-order form already picks or adds the client, and the Orders page
links to Clients. On a wider screen the sidebar keeps all six.

## 0048. A pin is for its day

Pinning a piece of work puts all of it on one day. Once that day has passed and the work is not done, the pin cannot be
kept, and refusing every plan until she unpins it would block her for a fact nobody can change. The plan input drops
pins on days before today, and the task is planned like any other; the review's "What moves" shows where it went.

## 0049. Moves are shown from the engine's diff, task by task

"What moves" is the engine's `diff` between the approved plan and the proposal, worded per task. Showing it from the
plans themselves means the screen can never describe a move the plan does not make.

## 0050. The week board shows the approved plan only

The board is what she agreed to. Proposals are read on their review page, so the board never mixes an approved day
with one that is only suggested.

## 0051. The export is one moment of her data, made by the database

The rows come from one stable function called in one statement, so every table is read from the same snapshot. An
export made from many requests could hold a task marked done in one table and its history line missing from another,
if she tapped on her phone while it was made. The function reads every table in `public`, so a table added later is in
the export without anyone remembering to add it; row-level security decides what is hers.

## 0052. Restoring is an operator step, not a button

A restore replaces everything of hers with an older file. A wrong tap would destroy newer work, and nothing in the app
could bring it back. So the app offers the export, and the restore is a command run by whoever looks after the app,
with the file and her account named on purpose. The drill proves the command works on every check.

## 0053. An export goes back into the same schema; migrations do the rest

The file names the last migration of the database it came from. A restore refuses a file from any other version. An
old file is restored into a project at its version, then the later migrations are applied, which are tested already.
Translating old files in code would be a second, untested way to change her data's shape.

## 0054. A restore puts rows back as they were, with the links still checked by the database

The app's own triggers are switched off for the restore, so history, counters, versions and the time a task was
started are the file's, not re-made as if she had just done everything again. The links between tables stay on: the
rows go in in the order the links allow, so the database itself refuses a row that points at nothing. Then the
history counter moves past the restored rows. Any problem undoes the whole restore, triggers included.

It needs only what Supabase's `postgres` role has: it owns the tables, and is not a superuser. A first version turned
every trigger off for the session (`session_replication_role`), which plain PostgreSQL allowed the tests' superuser
and Supabase refused; CI's first run against the Supabase stack found it. A database test now runs the restore as a
non-superuser owner.

## 0055. Without signal, My Day shows what she last saw, and says from when

The offline page is a copy of the last My Day she opened, never a guess of the present. It says the time it was made.
When that was on an earlier day, it says so and offers no taps: a list from yesterday is a reminder, not today's plan.

## 0056. A waiting tap is applied only if the task is still as she saw it

Each tap carries the status the task had when she tapped. The server changes the task only if it still has that
status. If it was marked on another device meanwhile, the tap is left and she is told, rather than undoing what was
done elsewhere. The forms follow the same rule, so a page left open in an old tab cannot undo newer work either.

## 0057. Only status taps wait for the signal

Start, done and still going are what happens at the table all day, and they do not change the plan's shape. Holding,
Quick Add, editing and plans change the plan and need the plan's checks, so they wait until the signal is back.

## 0058. One function records progress

The forms and the waiting taps both call `recordProgress`, which checks the change (the day, the time it took, what is
left, the status she saw) and writes it. There is one set of rules for progress, whichever way it arrives.

## 0059. A strict Content-Security-Policy with a nonce per request

Scripts run only from the app and only with the request's nonce, which Next.js adds to its own scripts. Pictures come
from the app and the storage origin. Every page is already rendered per request (they need her session), so a nonce
costs nothing. It closes the Stage 0 gap.

## 0060. Language and calendar wait for her answer (settled by 0061)

Showing days in the Ethiopian calendar, or the app in Amharic, changes every date and every sentence she reads. It is
worth doing only if she wants it, and how (both calendars side by side, or one) is hers to say. Her profile has held
`locale` and `calendar` since Stage 0, so the data is ready; the screens are not changed until she confirms.

## 0061. English and Gregorian dates; no language or calendar setting

She confirmed it: no Amharic, no Ethiopian calendar. This settles decision 0060. The `locale` and `calendar` columns
kept on her profile since Stage 0 are removed (migration `20261031090000`): nothing read them, and a setting that
changes nothing invites someone to build a second way of showing dates. Days stay as they are written everywhere
(`src/domain/dates.ts`). Her holidays and days off are still hers to enter in Settings.

## 0062. The browser suite lives in the repository and runs against the real local stack

The browser checks had run from outside the repository against a stand-in. They are now `e2e/`, a Playwright suite
that CI runs against `supabase start`: real sign-in, storage and database. It keeps to what she can do:

- One account, made afresh for every run through Supabase's admin API, and **one sign-in** with its password
  (decision 0065). Signing out ends every session, so the session is shared and the password change and signing out
  are the last spec.
- The specs are her story, in order: take orders, plan, live the day, change the plan, work without signal, sign out.
- Data changes only through the screens; the database is read to check what was stored. The one exception is ageing
  a stored file, which no screen can do.
- Every date is counted from today in her time zone, so the suite does not rot.
- It refuses to run against anything but local services unless told otherwise: it deletes its account first.

## 0063. The local stand-in for Supabase follows what CI finds on the real stack

The database tests run on plain PostgreSQL with a small stand-in for Supabase (`supabase/tests/plain-postgres-shim.sql`),
and in CI on the Supabase stack itself. When CI finds a difference, the stand-in is corrected to match Supabase, so the
local tests cannot hide it again. So far: storage buckets are not readable through the API, and a SQL delete on the
storage tables is refused unless it comes from the Storage API (Supabase's `storage.protect_delete` guard, which keeps
a file from being left behind). The app deletes pictures only through the Storage API; the tests that check the delete
policies say they delete as the Storage API does.

## 0064. Migrations reach her project through a workflow, after CI

The database of the live project changes only by the **Database** workflow: when CI has passed on `main`, it applies
the migrations CI has just tested, to exactly that commit, one run at a time. Nobody applies them by hand from a
laptop, so the live database is always at a version that was tested, and no database password is typed anywhere but
GitHub's encrypted secrets. Sign-in settings stay in the dashboard: `config.toml` describes the local stack (its site
address is the local one), so it is never pushed to the live project.

## 0065. Sign in with an email and a password

Replaces 0003. An emailed code needs an email sender of her own: Supabase's built-in one delivers only to members of
the project's organization, and a reliable sender needs a domain she does not have. So she signs in with her email and
a password; the app sends no email at all. A password survives the home-screen app's separate storage as well as a code
did. Accounts are still made by hand (sign-up is off), with a password given to her in person; she changes it in
Settings, where the password she uses now is checked first. At least 10 characters (`src/domain/passwords.ts`, and the
same minimum in Supabase). A wrong password and an unknown email get the same answer. Forgotten: whoever looks after the
app sets a new one (docs/operations.md). Cost: one more thing for her to remember; a password manager or the phone's
own keychain carries it.

## 0066. Calendar first: jobs of a kind, steps on days, no planning engine

Replaces the planning model of decisions 0030 to 0050. On first real use, Dagmawit found the app planned 1 hour of a
41-hour bridal gown and called it at risk: it waited for an hour estimate for every task, a day for every fitting and a
date for every material before it planned anything, and spoke about her rather than to her. She thinks in jobs (a new
order, a fix, an appointment, a sketch, a delivery) whose steps (buy fabric, cut, sew, fit, deliver) each have a day,
with hours optional. So: a job has a kind; its steps have a day, an optional last day and an optional time; a template
suggests the days by counting back from the job's day (drawing every step in proportionally when the day is near, never
before today, on days she works); Today and the month show every step by day; nothing blocks and nothing is approved.
What she had entered keeps its days (an appointment's day and time, a pinned day, the approved plan's days), and
preparation not yet in became steps. The plan in full is [calendar-first.md](calendar-first.md). Cost: the app no longer
checks whether her hours suffice; a clash of times and a step after its job's day are what it points out.

## 0067. A time is taken once; a time with no end is a moment

A start time with no end counted as an hour, so appointments she booked every half hour (14:00, 14:30, 15:00) were all
called overlapping, which they were not. Now a start with no end is that moment: two steps cross only when they start
together or their from–to times overlap (`timesOverlap`). And because the point of the calendar is to use her time
well, a job or a step whose time crosses another is not saved; the message names the step that has the time
(`findClash`, `clashMessage`). Appointments and deliveries can be given an end. An overlap that arises only
indirectly (moving a job's day moves its steps) is still shown on Today, to be moved by hand. Cost: a time typed with
no end does not stop a second one ten minutes later; give an end when it matters.

## 0068. Jobs she builds: no kinds, her steps on her days, events, delete any job

Replaces the kinds and suggested days of 0066. A day of use showed that "kind of job" does not fit how work moves: a
new order may start with an appointment, then a sketch, then fabric and production, then delivery, and any of these
may be missing; a fix may start with an appointment; a bazaar or a fashion show has no client. So a job is for a client
or for nobody (an event, which then needs a name), says in a few words what it is ("Bridal gown"), and has the steps she
builds on the form by tapping her usual ones (those she has used most, then common ones) or a whole list, each with the
day she gives it, a last day and a time if she wants. Nothing is guessed: templates are now plain, ordered lists of step
titles. On Today and the calendar the work is the headline ("Megan · Bridal gown") and the step sits under it, because
every entry read "Appointment" before. Today shows what is coming up with days left: every event ahead, however far,
because preparing for one takes weeks, and deliveries within 30 days. The same step on the same job and day is refused,
since adding it twice was how one job appeared twice. Any job can be deleted, whatever its state, with its steps,
garments, pictures and history; cancelling remains for a job she wants to keep on record. Existing jobs are named after
their first garment. Cost: a new job gets no days unless she gives them, and deleting is final.

## 0069. An event is its name and its day; usual steps are the ones she repeats

Seeing 0068 in use, she asked that an event just be an event: the new-event form showed the tailoring steps and the
garment lists, which are not for a bazaar or a fashion show. An event is now made from "New event" (or "An event"
under For): its name, its day and notes, counted down on Today. Its page has no brief or measurements, and what she
prepares, if she wants it on her calendar, is added under "To prepare" on the days it takes. Buttons and texts say
"event" there, not "job". The step buttons on a client's job offered every title she had ever typed, including
one-offs such as "delivery for Kati"; a title of hers is offered once she has used it twice, after the common ones she
has not used.

## 0070. The month marks a job's own day; pictures by kind; a way back on every inner page

Looking at next month, she saw nothing marked: the month counted only steps, so a job or an event with no step on
its day did not appear at all, which became common once steps were optional (0068). Each confirmed job's own day is
now marked on the month ("Due" for a delivery, "Event" for an event), whether or not it has steps; a day holding
anything is tinted so it stands out; and the chosen day lists what is due on it above its steps.

On a job's Design brief the heading said "Garment" and pictures were added through one form with a "What is it?"
list, so she did not see how to add a fitting photo. The page now says "What is made", and its pictures are grouped
by kind (sketches, the client's inspiration, fabric, fittings, other), each with its own button to add one.

Installed on a phone the app has no browser back button, and the small grey breadcrumb was easy to miss. Every inner
page now starts with a large "← Jobs" (or Clients, Library, Settings, the client) link back to its list.

## 0071. Her green design

She gave a design for the app's look: a warm off-white page (#FAF8F5), white cards with soft shadows and 16 px corners,
pine-black text (#1A231A) and slate green-grey secondary text (#556355), forest-green buttons (#228B22), a deep
pine-green bottom bar (#0D3E0D) with 24 px top corners whose open page shows in bright green, and Inter (titles 24 px
bold, section headings 18 px semi-bold). It replaces the cream, serif and sage look of 0005 through the tokens in
`globals.css`, so every screen follows. Two shades are one step deeper than given, where text sits on them: white on
#228B22 is 4.4:1 and needs 4.5:1, so buttons and green text use #1E7B1E. On the bar she wanted no lime green: the
open page is white, on her forest green #228B22 behind its icon (on a wide screen the row's pill is one shade deeper,
#1A6B1A, because its words sit on it). The layout follows her FinTrack screen too: each row and step is its own white
card with a soft shadow, rows lead with a light grey icon circle, a section title carries its "See all" link on the
right, and a page's main actions are green pill buttons with icons in a sideways-scrolling row. Night keeps the same
design in deep green-charcoal. The contrast test covers the bar and the icon circles.

## 0072. One dark green, #0F3F00

Seeing 0071, she asked for a darker green, #0F3F00, in place of the forest greens. It is now the one green: buttons,
quick actions, green words, links and the bar. The open page on the bar is white on a lighter shade of it (#2F6420),
not a bright or lime green. At night green words take a soft light green (#A6D39A) so they stay readable on the dark
page. White on #0F3F00 is 13:1, so the shades 0071 deepened for readability are no longer needed.

## 0073. Always light, for now

Her computer is set to dark mode and the app followed it, so she saw a dark app beside her light FinTrack design. She
does not want dark mode for now. The app is always light, whatever the phone or computer is set to, and the Appearance
choice is gone from Settings. The night values stay in the tokens, still checked, so dark mode can return by one line
in `globals.css` and a choice in Settings.
The theme cookie the root layout read was also what kept every page rendered per request; without it Next.js
prebuilt the sign-in and offline pages, whose scripts then carried no nonce and were blocked by the
Content-Security-Policy (0059). The root layout now asks for per-request rendering itself (`connection()`), so the
policy no longer depends on an unrelated read.

## 0074. A day lists each job once; phone-sized calendar and job filters

On a day where every job had a step, the calendar listed each job twice: once as due, once through its step. A job is
now listed as due on its day only when none of its steps shows that day (`dueNotShown`); otherwise its step, headed by
the job, already shows it. The month still marks the day "Due". On a phone the calendar's three month buttons took two
lines and the job filters three: the month now sits between two arrow buttons, with "This month" beside the Calendar
label, and the filters are one row that swipes sideways.

## 0075. No lists of steps, no Library

She does not need the Library: her steps are the same few every time, and lists named after garments (Bridal gown,
Dress) suggested otherwise. The Library, its lists and the "all the steps of a list" pickers are gone; the step buttons
on a job (the common steps, then any of hers used more than once) are how steps are added. The `template` and
`template_task` tables, their triggers and the seeding of new accounts are dropped (migration `20261103090000`);
no step ever pointed at a list, so every job keeps its steps. History lines saying a list's steps were added are kept
as written. Clients takes the Library's place in the phone's bottom bar.

## 0076. Less crowded on a phone

Checked screen by screen at 375 px with real-length names: the step's date boxes ran past their card; a long job name
wrapped to three lines beside its "days left"; every job card on the Active list said "Active"; a job's moves took two
lines and each step a line of its own for "Change". Now the date boxes share the row evenly; "days left" sits under the
name on a phone; the status chip shows only under All; a job's details are two short lines (when it is due, then its
steps); a step's "Change" sits in its card's corner; a job's moves fit one line; the page's spacing, quick actions and
cards are a little tighter; and some help text is shorter.

## 0077. The server beside the database; a tap answers at once

She found the app slow to answer. Her Supabase project is in London (`eu-west-2`, read by the "Where it runs"
workflow), while Vercel ran the app's server functions in its default region, Washington (`iad1`): every page waited on
two or three trips across the Atlantic to the database, one after another. `vercel.json` now pins the functions to
London (`lhr1`), beside the database, which is also nearer Addis Ababa. Sessions were not the cause: the project signs
them with an asymmetric key (ES256), so the server checks them without asking Supabase. Pages that waited on one read
before starting the next now start them together (Today, the jobs list, a job, the calendar's settings). And a tap now
shows the shape of the next page at once (`loading.tsx`) instead of leaving the old page still.
With the loading screen a page starts before its data is read, so a job that is not there shows "Page not found" with
status 200 rather than 404 (Next.js sends the status before it knows); for a private app the page is what matters.
The browser tests now wait for the page itself (`ready`, `texts`), not only its address, and pass with every page
slowed by 0.4 s.

## 0078. Coming up is its own page; Today shows each job once

Today listed the jobs due within 30 days under "Coming up", today's included, and today's steps under "Today": a job
due today with a step today appeared twice. She asked for what is coming up to be on a page of its own. Today now
shows only today and the week's steps; "Coming up" (a quick action on Today) is a page of every confirmed delivery and
event from tomorrow on, however far, soonest first with the days left, in "This week" and "Later". A job due today
shows once on Today: by its step when it has one that day, otherwise as "due today" above the steps, so it is not
missed.

## 0079. A simpler new-job form; better text boxes

On a new job the delivery was asked twice (the delivery day, and "Delivery" among the steps), and each step opened
four boxes (day, last day, from, to) and three small buttons. Now the delivery day has a time beside it; given a time,
the delivery goes on the calendar at that hour as a "Delivery" step, and "Delivery" is not offered among the steps.
Each step is its name with a remove button, then its day and a time. A step over several days, or an end time, is set
afterwards with "Change" on the job; the order of steps is the order she taps them. Text boxes everywhere are rounded
like the cards, 16 px (a phone does not zoom into them), with a green ring in use; a phone's date and time boxes keep
the height of the rest; selects have their own arrow.

## 0080. Unfinished steps move to today

She wants a step not done on its day carried to the next day by default. When she opens Today, the calendar, the jobs
list or a job, her unfinished steps whose day has passed move to her today (`public.carry_over()`, run as her, so only
her own), keeping their time; a step over several days whose last day has passed moves as one day. Each remembers the
day it was first meant for (`task.moved_from`), shown as "Moved from Fri 30 Oct" until it is done or she sets its day
herself. Steps of a draft, a paused or a closed job stay where they are: those jobs are not on her calendar. It is
safe to run any number of times: a moved step is on today, so it moves again only tomorrow.

## 0082. A database change goes live before the code that uses it

The app is deployed the moment a commit reaches `main`, while the Database workflow applies migrations only after CI
passes, some ten minutes later. When a commit held both a migration and code that needed it (0080), the new code ran
for those minutes against the old database and pages failed. Now a change to the database is released in two
commits: first the migration alone, written so the app already live keeps working with it, and CI tests exactly that;
then, once the Database workflow has applied it, the code that uses it.
