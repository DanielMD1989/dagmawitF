# Harden: her data is safe, and the day works without signal

Stage 6. The agreed contract for the export, the restore drill, My Day without signal, the security headers and the
accessibility pass. The reasons are in decisions 0051 to 0060. If code and this page disagree, one of them is a bug.

## The idea in one paragraph

Everything of hers can leave the app as **one file**: Settings → Data → **Download everything**. The file is a zip
with her data as it was at one moment, and her pictures. That file can be **restored** into an empty project by
whoever looks after the app, and a **drill** proves it on every check: export, restore into a fresh database, compare.
On her phone, **My Day opens with no signal**: it shows the day as it was when she last opened it, says from when, and
lets her start a task, mark it done or say how long is left. Those taps wait on the phone and are sent when the signal
comes back; anything that can no longer be applied is reported, never forced.

## The export

`GET /api/export` (signed in) answers with `dagmawit-<her today>.zip`:

| In the zip     | What it is                                                 |
| -------------- | ---------------------------------------------------------- |
| `data.json`    | Every row of hers in every table, as one snapshot (below). |
| `files/<path>` | Each picture, at its stored path.                          |
| `README.txt`   | What the file is and how it is restored, in plain words.   |

`data.json`:

```json
{
  "format": "dagmawit-export",
  "schema": "20261030090000",
  "exported_at": "2026-10-30T09:12:00+03:00",
  "owner_id": "…",
  "tables": { "profile": [ … ], "orders": [ … ], "task": [ … ], … }
}
```

- The rows come from one database function, `public.export_my_data()`, in **one statement**, so the file is one
  moment of her data even if she is tapping on another device while it is made (decision 0051). It runs as her, so
  row-level security decides what is in it; it reads every table in `public`, so a table added later is exported
  without anyone remembering to add it (a test proves both).
- `schema` is the last migration the database has (`app.schema_version()`, guarded by a test against the migrations
  folder). A restore goes into a database at that same version (decision 0053).
- A picture that cannot be read is listed in `README.txt` as missing; the export does not fail for one picture.

## Restore (an operator step)

Restoring **replaces everything of one person** with the contents of a file. That is never a button in the app: a
wrong tap would wipe newer work (decision 0052). It is done by whoever looks after the app:

```
npm run restore -- --file dagmawit-2026-10-30.zip --owner <her user id> [--files]
```

- `DATABASE_URL` points at the database; `--files` also puts the pictures back, using `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`.
- It refuses a file whose `schema` is not the database's. To restore an older file, restore it into a project at that
  version, then apply the later migrations (docs/operations.md).
- `app.restore_owner(owner, data)` does the database part in one transaction: it deletes her rows, inserts the file's
  rows with the owner changed to `--owner` (and the owner part of each picture's path with it), with the app's own
  triggers off, so history, counters and versions are restored as they were, not re-made (decision 0054). The links
  between tables stay checked by the database: tables go in in the order their links allow. Then it moves the history
  counter past the restored rows. Any problem undoes the whole restore. It needs no superuser.

### The drill

`npm run drill:restore [-- --file <zip>]` proves the round trip on a throwaway database:

1. creates a database and applies the migrations;
2. makes a person with a full set of data (orders, garments, tasks with progress, an approved plan, history,
   pictures) — or takes the given file;
3. exports it, restores it as a **different** person into a **second** fresh database, exports again;
4. compares the two exports row by row (owner and picture paths aside), checks every picture arrived, and checks the
   restored person can carry on: a new order, a new history line, a new proposal;
5. drops both databases.

It also runs inside the database tests, so `npm run check` makes the drill every time.

## My Day without signal

### What is kept on the phone

When My Day opens online, it keeps a **snapshot** of what it shows (`src/domain/day/offline.ts`): the day, the
greeting's name, the time planned and usable, and each entry (title, order, garment, minutes today, time, status,
what is left, what it waits for, hold). With it: when it was made, her time zone, and whose it is. Nothing else of hers
is kept on the phone, and signing out removes it.

### Opening with no signal

The service worker (`public/sw.js`, version 2) keeps an **offline page** (`/offline`, built with the app's own styles).
When a page cannot be reached, or does not answer within 8 seconds, it sends her to that page (with where she was going, for **Try again**). The offline page:

- says **"No signal. This is today as of 08:12."**;
- if the snapshot is for an earlier day, says so plainly ("This is Tuesday's list, from Tuesday 17:40") and offers no
  taps (decision 0055);
- shows the entries with the taps that wait applied, marked "Waiting to be sent";
- offers **Start**, **Done** (with the time it took, for work and appointments) and **Still going** (about how long
  is left), and **Undo** on a tap that has not been sent;
- has a **Try again** link.

### The taps that wait

Only status taps are kept: start, done, still going (decision 0057). Holding, Quick Add, plans and everything else
need the signal, because they change the plan.

Each waiting tap records the task, what she did, the **status she saw** when she tapped, the day she did it (in her
time zone) and when. They are sent **in order**, one by one, to `POST /api/progress`, when any page of the app opens
with signal, or when the signal comes back while it is open.

The server applies a tap only if the task is **still in the status she saw** (decision 0056):

| Result    | When                                               | She reads                                             |
| --------- | -------------------------------------------------- | ----------------------------------------------------- |
| `applied` | the task was in the status she saw                 | (counted) "3 taps made without signal were saved."    |
| `stale`   | it moved since (marked on another device, say)     | "Cut the lining was already done; that tap was left." |
| `missing` | the task is gone                                   | "A task was removed; that tap was left."              |
| `invalid` | the tap breaks a rule (a day after her today, say) | the reason, as the form would say it                  |

The same rules as the forms apply: both go through one function, `recordProgress` (`src/server/progress.ts`,
decision 0058). A tap that was not applied is removed from the phone after it is reported; one that could not be sent
(no answer, signed out) stays and is tried again.

## Security headers

Every page carries a **Content-Security-Policy** with a fresh nonce per request (decision 0059), set in `src/proxy.ts`:
scripts only from the app with that nonce; styles from the app; pictures from the app and the storage origin; no
frames, no plugins, forms only to the app. The other headers (Stage 0) stay.

## Accessibility pass

- a **Skip to the content** link first on every page;
- a visible focus ring on everything that takes focus, in both themes;
- motion reduced when the phone asks for it;
- every screen checked with axe (WCAG 2.2 A and AA, and best practices) in both themes and at phone and desktop width;
- the main flows done with the keyboard alone: take an order, approve a plan, mark a task done.

## Language and calendar

She confirmed: English, and Gregorian dates (decision 0061). The unused `locale` and `calendar` settings on her
profile were removed.

## Tidy stored pictures

Settings → Data → **Tidy stored pictures** removes stored pictures that no record points to (Stage 2's known gap: the
server stopped between storing and recording). Only files older than an hour are touched, so an upload in progress is
never taken.

## How it is tested

1. **Domain**: the snapshot (made, read back, refused when malformed or someone else's), the waiting taps (added,
   undone, applied over the snapshot, which taps each status offers), the export file's format, the replay results'
   wording.
2. **Database**: the export holds every table and only hers, one snapshot; the restore round trip as another person;
   the restore refuses a broken link, a wrong schema, a path outside her folder; the history counter after a restore;
   compare-and-set progress.
3. **Drill**: `npm run drill:restore`.
4. **Browser**: My Day opened, the network cut, the app reopened: the offline page shows the day; taps made, the
   network back, the taps saved and reported; a stale tap reported; the export downloaded and opened; axe on every
   screen with no violations and no CSP reports in the console.

## Exit test (manual)

A restore from backup succeeds, and the day's view opens on her phone with no signal.
