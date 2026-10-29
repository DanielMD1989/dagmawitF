import { TaskEditor, type TaskEditorActions } from '@/components/TaskEditor';
import type { TaskValues } from '@/components/TaskFields';
import { formatDay } from '@/domain/dates';
import { formatMinutes } from '@/domain/duration';
import { inWorkOrder, possiblePredecessors } from '@/domain/planning/links';
import { estimateText } from '@/domain/planning/review';
import { KIND_NAME } from '@/domain/planning/words';

export type ListedTask = TaskValues & {
  id: string;
  sort: number;
  /** An order's task: how far it has come. */
  progress?: {
    status: 'not_started' | 'in_progress' | 'done';
    doneOn: string | null;
    actualMinutes: number | null;
    holdReason: string;
  };
};

/**
 * A list of tasks in the order the work is done (src/domain/planning/links.ts), each with what it comes after and
 * what it waits for, and its editor. The same list for a template and for an order's garment.
 */
export function TaskList({
  tasks,
  links,
  items,
  needs,
  scope,
  owner,
  actions,
  editable,
  planned = {},
  impact = false,
}: {
  tasks: ListedTask[];
  links: { from: string; to: string; lagDays: number }[];
  items: { id: string; label: string }[];
  needs: { taskId: string; itemId: string }[];
  scope: 'template' | 'order';
  owner: { name: 'template-id' | 'order-id'; id: string };
  actions: TaskEditorActions;
  editable: boolean;
  /** When each task is planned in the approved plan, for an order. */
  planned?: Record<string, string>;
  /** Offer "Save and see impact": an active order. */
  impact?: boolean;
}) {
  if (tasks.length === 0) return null;
  const title = new Map(tasks.map((t) => [t.id, t.title]));
  const label = new Map(items.map((i) => [i.id, i.label]));
  const inList = links.filter((l) => title.has(l.from) && title.has(l.to));

  return (
    <ul className="items">
      {inWorkOrder(tasks, inList).map((t) => {
        const before = inList.filter((l) => l.to === t.id);
        const waitIds = new Set(
          needs.filter((n) => n.taskId === t.id && label.has(n.itemId)).map((n) => n.itemId),
        );
        const waits = items.filter((i) => waitIds.has(i.id)).map((i) => i.label);
        const noDay = scope === 'order' && t.kind === 'fixed' && !t.fixedOn;
        const estimate = estimateText(t.kind, t.minutes, t.days);
        return (
          <li key={t.id} className={noDay ? 'item item--undated' : 'item'}>
            <div className="item__head">
              <div className="item__main">
                <span className="item__title">{t.title}</span>
                <span className="task-facts hint">
                  <span>{KIND_NAME[t.kind]}</span>
                  {estimate && <span>{estimate}</span>}
                  {scope === 'order' && t.kind === 'fixed' && t.fixedOn && (
                    <span>
                      {formatDay(t.fixedOn)}
                      {t.fixedTime ? `, ${t.fixedTime}` : ''}
                    </span>
                  )}
                  {t.notBefore && <span>not before {formatDay(t.notBefore)}</span>}
                  {t.pinnedOn && <span>pinned to {formatDay(t.pinnedOn)}</span>}
                </span>
                {noDay && (
                  <span className="item__note">No day yet: it and the work after it are not planned.</span>
                )}
                {before.length > 0 && (
                  <span className="hint">
                    After{' '}
                    {before
                      .map(
                        (b) =>
                          `${title.get(b.from)}${b.lagDays > 0 ? ` (+${b.lagDays} day${b.lagDays === 1 ? '' : 's'})` : ''}`,
                      )
                      .join(', ')}
                  </span>
                )}
                {waits.length > 0 && <span className="hint">Waits for {waits.join(', ')}</span>}
                {t.progress?.status === 'done' && (
                  <span className="hint">
                    Done{t.progress.doneOn ? ` ${formatDay(t.progress.doneOn)}` : ''}
                    {t.progress.actualMinutes !== null &&
                      `, took ${formatMinutes(t.progress.actualMinutes)}${t.minutes !== null ? ` (estimate ${formatMinutes(t.minutes)})` : ''}`}
                  </span>
                )}
                {t.progress?.status === 'in_progress' && <span className="hint">Started</span>}
                {t.progress && t.progress.holdReason !== '' && (
                  <span className="item__note">On hold: {t.progress.holdReason}</span>
                )}
                {planned[t.id] && t.progress?.status !== 'done' && (
                  <span className="hint">Planned {planned[t.id]}</span>
                )}
              </div>
            </div>
            {editable && (
              <TaskEditor
                task={t}
                scope={scope}
                owner={owner}
                before={before.map((b) => ({
                  id: b.from,
                  title: title.get(b.from) ?? '',
                  lagDays: b.lagDays,
                }))}
                candidates={possiblePredecessors(t.id, tasks, inList).map((c) => ({
                  id: c.id,
                  title: c.title,
                }))}
                items={items.map((i) => ({ id: i.id, label: i.label, ticked: waitIds.has(i.id) }))}
                actions={actions}
                impact={impact}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
