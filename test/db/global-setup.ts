import type { TestProject } from 'vitest/node';
import { connect, scratchDatabase } from '../../scripts/drill/database';

// Supabase's local stack listens here by default (`supabase start`).
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Two ways to run:
 *  - Against Supabase (CI, or `supabase start`): auth.uid() already exists and the stack has
 *    applied our migrations. We use the database as it is; every test rolls back.
 *  - Against plain PostgreSQL: we create a throwaway database, load the small stand-in for
 *    Supabase's auth schema, and apply the migrations ourselves, in order.
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.DATABASE_URL ?? DEFAULT_URL;
  const admin = await connect(adminUrl);
  project.provide('adminUrl', adminUrl);

  const { rows } = await admin.query<{ has_supabase: boolean }>(
    `select to_regprocedure('auth.uid()') is not null as has_supabase`,
  );

  if (rows[0]?.has_supabase) {
    const { rows: tables } = await admin.query(`select to_regclass('public.work_week') as t`);
    await admin.end();
    if (!tables[0]?.t) {
      throw new Error(
        'This Supabase database has no migrations applied. Run `supabase db reset` and try again.',
      );
    }
    project.provide('dbUrl', adminUrl);
    return;
  }

  await admin.end();
  const scratch = await scratchDatabase(adminUrl, 'dagmawit_test');
  project.provide('dbUrl', scratch.url);
  return () => scratch.drop();
}
