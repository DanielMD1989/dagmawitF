import { Client } from 'pg';
import { env } from './env';

/**
 * Reads what the app stored, to check it. The suite changes data only through the app's screens; the one exception
 * is ageing a stored file for the tidy-up test (a file cannot be made an hour old any other way).
 */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: env.databaseUrl });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** The first column of the first row, as text; '' when there is none. */
export async function value(text: string, params: unknown[] = []): Promise<string> {
  const rows = await sql(text, params);
  const first = rows[0];
  if (!first) return '';
  const v = Object.values(first)[0];
  return v === null || v === undefined ? '' : String(v);
}

export async function ownerId(): Promise<string> {
  return value(`select id from auth.users where email = $1`, [env.email]);
}

export async function orderId(number: number): Promise<string> {
  return value(
    `select o.id from public.orders o join auth.users u on u.id = o.owner_id where u.email = $1 and o.number = $2`,
    [env.email, number],
  );
}
