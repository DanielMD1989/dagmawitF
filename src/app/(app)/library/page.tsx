import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/server/session';
import { loadTemplates } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Library' };

/** Her saved lists of steps (decision 0068): added to a job in one tap. */
export default async function LibraryPage() {
  await requireUser();
  const templates = await loadTemplates(await createSupabase());

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Library</p>
        <h1>Your lists of steps</h1>
        <p className="lede">
          Steps you often follow together, such as for a bridal gown. On a new job, a list adds all its steps
          in one tap; you give each its day.
        </p>
      </div>

      <div className="btn-row">
        <Link href="/library/new" className="btn">
          New list
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="card">
          <p>No lists yet.</p>
        </div>
      ) : (
        <ul className="rows rows--links">
          {templates.map((t) => (
            <li key={t.id}>
              <Link href={`/library/${t.id}`} className="row-link">
                <span className="row-link__title">{t.name}</span>
                <span className="hint">
                  {t.steps.length === 0 ? 'No steps yet' : t.steps.map((s) => s.title).join(' → ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
