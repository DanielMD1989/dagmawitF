import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOB_KINDS, KIND_WORDS, isJobKind } from './kinds';

const migration = readFileSync(
  join(import.meta.dirname, '../../../supabase/migrations/20261101090000_calendar_first.sql'),
  'utf8',
);

describe('the kinds of job', () => {
  it('are the database’s kinds, in its order, for jobs and for templates', () => {
    const lists = [...migration.matchAll(/check \(kind in \(([^)]*)\)\)/g)].map((m) =>
      [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((k) => k[1]),
    );
    expect(lists).toEqual([[...JOB_KINDS], [...JOB_KINDS]]);
  });

  it('each have their words', () => {
    for (const kind of JOB_KINDS) {
      expect(KIND_WORDS[kind].label.length, kind).toBeGreaterThan(0);
      expect(KIND_WORDS[kind].dueLabel.length, kind).toBeGreaterThan(0);
    }
  });

  it('are recognised, and nothing else is', () => {
    expect(JOB_KINDS.every(isJobKind)).toBe(true);
    expect(isJobKind('repair')).toBe(false);
    expect(isJobKind(undefined)).toBe(false);
  });
});
