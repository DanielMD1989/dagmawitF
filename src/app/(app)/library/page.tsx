import type { Metadata } from 'next';
import Link from 'next/link';
import { JOB_KINDS, KIND_WORDS } from '@/domain/jobs/kinds';
import { requireUser } from '@/server/session';
import { loadTemplates } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Library' };

/** Her templates: the steps a new job starts with, by kind of job (decision 0066). */
export default async function LibraryPage() {
  await requireUser();
  const templates = await loadTemplates(await createSupabase());

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Library</p>
        <h1>Your steps</h1>
        <p className="lede">
          A template is the steps a job starts with, each some days before the job’s day. A new job copies
          them, and you change anything there.
        </p>
      </div>

      <div className="btn-row">
        <Link href="/library/new" className="btn">
          New template
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="card">
          <p>No templates yet. Make one for the kind of job you take most often.</p>
        </div>
      ) : (
        JOB_KINDS.filter((k) => templates.some((t) => t.kind === k)).map((k) => (
          <section key={k} className="section" aria-labelledby={`kind-${k}`}>
            <div className="section__head">
              <h2 id={`kind-${k}`} className="eyebrow">
                {KIND_WORDS[k].plural}
              </h2>
            </div>
            <ul className="rows rows--links">
              {templates
                .filter((t) => t.kind === k)
                .map((t) => {
                  const longest = Math.max(0, ...t.steps.map((s) => s.daysBefore));
                  return (
                    <li key={t.id}>
                      <Link href={`/library/${t.id}`} className="row-link">
                        <span className="row-link__title">{t.name}</span>
                        <span className="hint">
                          {t.steps.length} step{t.steps.length === 1 ? '' : 's'}
                          {longest > 0 && ` · starts ${longest} days before`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
