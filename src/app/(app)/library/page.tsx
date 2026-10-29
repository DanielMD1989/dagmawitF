import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMinutes } from '@/domain/duration';
import { loadTemplates } from '@/server/planning';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Library' };

/** Her templates: one for each kind of garment she makes, copied into an order when she plans it. */
export default async function LibraryPage() {
  await requireUser();
  const templates = await loadTemplates(await createSupabase());

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Library</p>
        <h1>How she makes things</h1>
        <p className="lede">
          A template is the steps of one kind of garment and how long each takes in her hands. Applying it to
          an order copies it there, where anything can be changed for that order.
        </p>
      </div>

      <div className="btn-row">
        <Link href="/library/new" className="btn">
          New template
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="card">
          <p>No templates yet. Make one for the garment she makes most often.</p>
        </div>
      ) : (
        <ul className="rows rows--links">
          {templates.map((t) => (
            <li key={t.id}>
              <Link href={`/library/${t.id}`} className="row-link">
                <span className="row-link__title">{t.name}</span>
                <span className="hint">
                  {t.garmentType} · {t.tasks} task{t.tasks === 1 ? '' : 's'}
                  {t.workMinutes > 0 && ` · ${formatMinutes(t.workMinutes)} of her time`}
                </span>
                <span className="row-link__side hint">Version {t.version}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
