import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Throwaway databases on a plain PostgreSQL server, made the way the database tests make theirs: the small
 * stand-in for Supabase's auth schema, then our migrations in order. Used by the database tests and the drill.
 */

const root = join(import.meta.dirname, '..', '..');
export const migrationsDir = join(root, 'supabase', 'migrations');
const shimFile = join(root, 'supabase', 'tests', 'plain-postgres-shim.sql');

/** Our migrations, oldest first, with the version each is named by. */
export function migrations(): { version: string; file: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ version: file.slice(0, 14), file }));
}

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Applies the migrations after `from` (or all) up to and including `upTo` (or all). */
export async function migrate(db: Client, options: { from?: string; upTo?: string } = {}): Promise<void> {
  for (const m of migrations()) {
    if (options.from && m.version <= options.from) continue;
    if (options.upTo && m.version > options.upTo) break;
    try {
      await db.query(readFileSync(join(migrationsDir, m.file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${m.file} failed: ${(error as Error).message}`);
    }
  }
}

export interface Scratch {
  url: string;
  drop(): Promise<void>;
}

/** A new database with the auth stand-in and our migrations up to `upTo` (all by default). */
export async function scratchDatabase(adminUrl: string, prefix: string, upTo?: string): Promise<Scratch> {
  const name = `${prefix}_${randomBytes(4).toString('hex')}`;
  const admin = await connect(adminUrl);
  await admin.query(`create database ${name}`);
  const url = withDatabase(adminUrl, name);
  const db = await connect(url);
  try {
    await db.query(readFileSync(shimFile, 'utf8'));
    await migrate(db, { upTo });
  } catch (error) {
    await db.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
    throw error;
  }
  await db.end();
  return {
    url,
    async drop() {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
