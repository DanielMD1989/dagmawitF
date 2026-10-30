import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { isUuid } from '@/domain/form-input';
import { KIND_WORDS } from '@/domain/jobs/kinds';
import { whenLabel } from '@/domain/library/forms';
import { requireUser } from '@/server/session';
import { loadTemplate } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { TemplateForm } from '../TemplateForm';
import { deleteTemplate } from '../actions';
import { AddTemplateStep, TemplateStepEditor } from './TemplateSteps';

export const metadata: Metadata = { title: 'Template' };

/** One template: its steps, each some days before the job's day, as a new job's steps are suggested from it. */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const template = await loadTemplate(await createSupabase(), id);
  if (!template) notFound();
  const steps = [...template.steps].sort((a, b) => b.daysBefore - a.daysBefore || a.sort - b.sort);

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/library">Library</Link> / {template.name}
        </p>
        <h1>{template.name}</h1>
        <p className="lede">
          For a {KIND_WORDS[template.kind].label.toLowerCase()}. A new job with these steps gets their days
          counted back from its day. When the day is nearer than the first step, every step is drawn in to
          fit.
        </p>
      </div>

      <section className="section" aria-labelledby="steps-heading">
        <div className="section__head">
          <h2 id="steps-heading">Steps</h2>
        </div>
        {steps.length === 0 ? (
          <div className="card">
            <p>No steps yet.</p>
          </div>
        ) : (
          <ul className="items">
            {steps.map((s) => (
              <li key={s.id} className="item">
                <div className="item__main">
                  <span className="item__title">{s.title}</span>
                  <span className="hint">
                    {whenLabel(s.daysBefore, s.spanDays)}
                    {s.withClient && ' · with the client'}
                  </span>
                </div>
                <TemplateStepEditor step={s} />
              </li>
            ))}
          </ul>
        )}
        <AddTemplateStep templateId={template.id} />
      </section>

      <section className="section" aria-labelledby="about-heading">
        <div className="section__head">
          <h2 id="about-heading">About this template</h2>
        </div>
        <TemplateForm
          template={{ id: template.id, name: template.name, kind: template.kind, notes: template.notes }}
        />
      </section>

      <section className="section" aria-labelledby="delete-heading">
        <div className="section__head">
          <h2 id="delete-heading">Delete this template</h2>
          <p className="hint">Jobs that took its steps keep them.</p>
        </div>
        <ConfirmAction
          action={deleteTemplate}
          fields={{ id: template.id }}
          label="Delete this template"
          question={`Delete “${template.name}”? This cannot be undone.`}
          confirmLabel="Yes, delete"
          pendingText="Deleting…"
        />
      </section>
    </>
  );
}
