import { Pool, type PoolClient } from 'pg';
import { afterAll, inject } from 'vitest';

export const pool = new Pool({ connectionString: inject('dbUrl'), max: 4 });
afterAll(() => pool.end());

/** Runs `fn` inside a transaction that is always rolled back, so tests never leave data behind. */
export async function inTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

/** Creates a user the way Supabase Auth does. Must run as the database owner. */
export async function createUser(c: PoolClient, email: string, name = ''): Promise<string> {
  await c.query('reset role');
  const { rows } = await c.query<{ id: string }>(
    `insert into auth.users (id, email, raw_user_meta_data)
     values (gen_random_uuid(), $1, jsonb_build_object('name', $2::text))
     returning id`,
    [email, name],
  );
  return rows[0]!.id;
}

/** Acts as a signed-in user for the rest of the transaction, exactly as the API would. */
export async function actAs(c: PoolClient, userId: string): Promise<void> {
  await c.query('reset role');
  await c.query(`set local role authenticated`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
}

/** Acts as a visitor who is not signed in. */
export async function actAsAnon(c: PoolClient): Promise<void> {
  await c.query('reset role');
  await c.query(`set local role anon`);
  await c.query(`select set_config('request.jwt.claims', '', true)`);
}

/** Back to the database owner, to check what is really stored. */
export async function actAsOwner(c: PoolClient): Promise<void> {
  await c.query('reset role');
}

export type Attempt =
  | { ok: true; rowCount: number; rows: Record<string, unknown>[] }
  | { ok: false; code: string; message: string };

/**
 * Runs a statement that is expected to maybe fail, without poisoning the transaction.
 * The error code is the PostgreSQL SQLSTATE: 42501 insufficient privilege or row-level
 * security, 23514 check violation, 23505 unique violation, 23502 not null violation.
 */
export async function attempt(c: PoolClient, sql: string, params: unknown[] = []): Promise<Attempt> {
  await c.query('savepoint attempt');
  try {
    const r = await c.query(sql, params);
    await c.query('release savepoint attempt');
    return { ok: true, rowCount: r.rowCount ?? 0, rows: r.rows };
  } catch (error) {
    await c.query('rollback to savepoint attempt');
    const e = error as { code?: string; message: string };
    return { ok: false, code: e.code ?? 'unknown', message: e.message };
  }
}

export const MONDAY = {
  weekday: 1,
  start: '08:30',
  end: '17:00',
  breaks: [{ start: '12:30', end: '13:30' }],
};
