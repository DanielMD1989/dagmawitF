import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddTaskForm } from '@/components/AddTaskForm';
import { ConfirmAction } from '@/components/ConfirmAction';
import { TaskList } from '@/components/TaskList';
import { formatMinutes } from '@/domain/duration';
import { isUuid } from '@/domain/form-input';
import { loadTemplate } from '@/server/planning';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { TemplateForm } from '../TemplateForm';
import {
  addTemplateLink,
  addTemplateTask,
  deleteTemplate,
  removeTemplateLink,
  removeTemplateTask,
  saveTemplateNeeds,
  saveTemplateTask,
} from '../actions';
import { AddTemplateItem, TemplateItemRow } from './TemplateItems';

export const metadata: Metadata = { title: 'Template' };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const template = await loadTemplate(await createSupabase(), id);
  if (!template) notFound();

  const work = template.tasks.reduce((sum, t) => sum + (t.minutes ?? 0), 0);
  const actions = {
    save: saveTemplateTask,
    remove: removeTemplateTask,
    addLink: addTemplateLink,
    removeLink: removeTemplateLink,
    saveNeeds: saveTemplateNeeds,
  };

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/library">Library</Link> / {template.name}
        </p>
        <h1>{template.name}</h1>
        <p className="lede">
          {template.tasks.length} task{template.tasks.length === 1 ? '' : 's'}
          {work > 0 && `, ${formatMinutes(work)} of her time`} · version {template.version}
        </p>
        {template.notes && <p className="hint">{template.notes}</p>}
      </div>

      <section className="section" aria-labelledby="tasks-heading">
        <div className="section__head">
          <h2 id="tasks-heading">Tasks</h2>
          <p className="hint">
            In the order the work is done. A task follows the tasks it comes after; one that comes after
            nothing can start as soon as there is time.
          </p>
        </div>
        {template.tasks.length === 0 && (
          <div className="card">
            <p>No tasks yet. Add the first step of making this garment.</p>
          </div>
        )}
        <TaskList
          tasks={template.tasks}
          links={template.links}
          items={template.items}
          needs={template.needs}
          scope="template"
          owner={{ name: 'template-id', id: template.id }}
          actions={actions}
          editable
        />
        <AddTaskForm
          action={addTemplateTask}
          hidden={{ 'template-id': template.id }}
          scope="template"
          idPrefix="new-task"
        />
      </section>

      <section className="section" aria-labelledby="items-heading">
        <div className="section__head">
          <h2 id="items-heading">What it waits for</h2>
          <p className="hint">
            Added to an order’s preparation when the template is applied, unless the order already lists it
            under the same name.
          </p>
        </div>
        {template.items.length > 0 && (
          <ul className="items">
            {template.items.map((i) => (
              <TemplateItemRow key={i.id} item={i} />
            ))}
          </ul>
        )}
        <AddTemplateItem templateId={template.id} />
      </section>

      <section className="section" aria-labelledby="details-heading">
        <div className="section__head">
          <h2 id="details-heading">Details</h2>
        </div>
        <TemplateForm template={template} />
      </section>

      <section className="section" aria-labelledby="delete-heading">
        <div className="section__head">
          <h2 id="delete-heading">Delete this template</h2>
          <p className="hint">Orders already planned from it keep their own copy.</p>
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
