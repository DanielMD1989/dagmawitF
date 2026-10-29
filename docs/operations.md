# Operations: backups and bringing her data back

For whoever looks after the app. The contract is in [harden.md](harden.md); the reasons in decisions 0051 to 0054.

## Three layers of backup

| Layer                         | What it holds                      | Who makes it                   | How often                   |
| ----------------------------- | ---------------------------------- | ------------------------------ | --------------------------- |
| Her export (Settings → Data)  | Her data and her pictures, one zip | She does, with one tap         | Weekly, and before big jobs |
| Supabase's database backups   | The whole database                 | Supabase (daily on paid plans) | Daily                       |
| `supabase db dump` (optional) | The whole database, as SQL         | You, from the command line     | Before applying a migration |

Supabase's database backups do **not** contain the stored pictures: those live in Storage, beside the database. Her
export is the only layer that holds both. Ask her to download it weekly and keep it off her phone (a computer, a USB
stick, a cloud drive).

## On the free plan

A project on Supabase's free plan pauses after about a week with no use, and has no daily backups. Daily use keeps it
awake; after a long break, wake it from the dashboard (Restore project). Her weekly export is then the only backup, so
it matters more, not less. Moving to a paid plan later needs no change to the app or her data.

## Restoring her export

Restoring **replaces everything** in one account with the file's contents. Work done after the file was made is lost.

1. Have the file, and her account id (Supabase → Authentication → Users). If the project itself was lost: make a new
   project, apply the migrations (`supabase db push`), add her user again, and use the new id.
2. Check the file's schema: the restore prints it. It must be the database's last migration.
   - Same: go on.
   - Older (the app moved on since): restore into a project at the file's version first. In a scratch project, apply
     the migrations up to and including that version, restore, then apply the rest (`supabase db push`). Or prove it
     on your computer first: `npm run drill:restore -- --file <zip>` does exactly that on throwaway databases.
3. Run it against the database, as the database owner (Supabase → Project Settings → Database → connection string,
   the `postgres` user):

   ```
   DATABASE_URL=<connection string> \
   SUPABASE_URL=<project url> SUPABASE_SERVICE_ROLE_KEY=<secret key> \
   npm run restore -- --file dagmawit-2026-10-30.zip --owner <her account id> --files
   ```

   It asks you to type `replace` before it changes anything. The database part is one transaction: if anything in the
   file is wrong (a missing table or column, a row of someone else, a link to nothing), nothing is changed. The
   pictures are put back afterwards; if some fail, run the same command again.

4. Ask her to open My Day: it should show her day, and her orders their history.

Keep the secret key off her devices and out of the repository. It is needed only for `--files`.

## The drill

`npm run drill:restore` proves the round trip on throwaway databases (a person with data in every table, exported,
restored as someone else, compared row by row). It runs on every `npm run check`. Run it with a real file, too, every
few months: `npm run drill:restore -- --file <her latest export>`.

## On the real project

The restore runs as the `postgres` role from the project's connection string: it owns the tables and is not a
superuser, which is all the restore needs (decision 0054). CI's database tests run the drill against the Supabase
stack. Still, restore one real export into a scratch Supabase project before you ever need to, to know the steps.

## Tidy stored pictures

Settings → Data → Tidy stored pictures removes pictures that were stored but never recorded (an upload cut off
halfway). It touches only files older than an hour. Nothing she can see changes.
