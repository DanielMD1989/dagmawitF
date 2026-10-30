import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { isUuid } from '@/domain/form-input';
import { requireUser } from '@/server/session';
import { loadTemplate } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { TemplateForm } from '../TemplateForm';
import { deleteTemplate } from '../actions';
import { AddTemplateStep, MoveStep, TemplateStepEditor } from './TemplateSteps';

export const metadata: Metadata = { title: 'List of steps' };

/** One saved list: the steps it adds to a job, in order. She gives each its day on the job. */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const template = await loadTemplate(await createSupabase(), id);
  if (!template) notFound();

  return (
    <>
      <div className="page-head">
        <BackLink href="/library">Library</BackLink>
        <h1>{template.name}</h1>
        <p className="lede">
          These steps are added to a job in one tap, in this order. You give each its day on the job.
        </p>
      </div>

      <section className="section" aria-labelledby="steps-heading">
        <div className="section__head">
          <h2 id="steps-heading">Steps</h2>
        </div>
        {template.steps.length === 0 ? (
          <div className="card">
            <p>No steps yet.</p>
          </div>
        ) : (
          <ol className="items">
            {template.steps.map((s, i) => (
              <li key={s.id} className="item">
                <div className="item__head">
                  <div className="item__main">
                    <span className="item__title">{s.title}</span>
                  </div>
                  <MoveStep step={s} first={i === 0} last={i === template.steps.length - 1} />
                </div>
                <TemplateStepEditor step={s} />
              </li>
            ))}
          </ol>
        )}
        <AddTemplateStep templateId={template.id} />
      </section>

      <section className="section" aria-labelledby="about-heading">
        <div className="section__head">
          <h2 id="about-heading">About this list</h2>
        </div>
        <TemplateForm template={{ id: template.id, name: template.name, notes: template.notes }} />
      </section>

      <section className="section" aria-labelledby="delete-heading">
        <div className="section__head">
          <h2 id="delete-heading">Delete this list</h2>
          <p className="hint">Jobs that took its steps keep them.</p>
        </div>
        <ConfirmAction
          action={deleteTemplate}
          fields={{ id: template.id }}
          label="Delete this list"
          question={`Delete “${template.name}”? This cannot be undone.`}
          confirmLabel="Yes, delete"
          pendingText="Deleting…"
        />
      </section>
    </>
  );
}
