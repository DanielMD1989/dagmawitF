import { formatDay, isIsoDate, type IsoDate } from '../dates';
import { formatMinutes } from '../duration';
import { ATTACHMENT_KIND_LABEL, isAttachmentKind } from '../files';
import { isOrderStatus, type OrderStatus } from './status';

// Words for events that no longer happen (preparation and plans, before decision 0066), so old history still reads.
const OLD_STATE: Record<string, Record<string, string>> = {
  material: { needed: 'Needed', ordered: 'Ordered', received: 'Received' },
  approval: { needed: 'Needed', ordered: 'Asked', received: 'Approved' },
  measurements: { needed: 'Needed', ordered: 'Booked', received: 'Taken' },
  other: { needed: 'Needed', ordered: 'In progress', received: 'Done' },
};
const OLD_PLAN_STATE: Record<string, string> = {
  on_track: 'on track',
  at_risk: 'at risk',
  infeasible: 'cannot be made in time',
};

/**
 * The history of an order. The database writes one row for each thing that happens, as a code and a few
 * facts (supabase/migrations/..._order_files_and_history.sql). This file is the one place the words are
 * made, so they can be tested and, later, translated. A test compares HISTORY_ACTIONS with the
 * database's own list.
 */

export const HISTORY_ACTIONS = [
  'order_created',
  'status_changed',
  'delivery_changed',
  'buffer_changed',
  'client_changed',
  'garment_added',
  'garment_changed',
  'garment_removed',
  'garment_measurements',
  'prerequisite_added',
  'prerequisite_state',
  'prerequisite_date',
  'prerequisite_blocking',
  'prerequisite_removed',
  'file_added',
  'file_removed',
  'measurements_recorded',
  'template_applied',
  'plan_approved',
  'task_done',
  'task_hold',
] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export function isHistoryAction(value: unknown): value is HistoryAction {
  return typeof value === 'string' && (HISTORY_ACTIONS as readonly string[]).includes(value);
}

export interface HistoryEvent {
  action: HistoryAction;
  details: Record<string, unknown>;
}

const str = (d: Record<string, unknown>, key: string, fallback = ''): string => {
  const v = d[key];
  return typeof v === 'string' ? v : fallback;
};
const num = (d: Record<string, unknown>, key: string): number | null => {
  const v = d[key];
  return typeof v === 'number' ? v : null;
};
const day = (d: Record<string, unknown>, key: string): IsoDate | null => {
  const v = d[key];
  return typeof v === 'string' && isIsoDate(v) ? v : null;
};
const dayText = (iso: IsoDate | null, none = 'no date') => (iso ? formatDay(iso) : none);
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

function statusSentence(from: OrderStatus, to: OrderStatus, d: Record<string, unknown>): string {
  const reason = str(d, 'reason');
  const because = reason ? `: ${reason}` : '';
  if (from === 'draft' && to === 'active') return 'Job confirmed.';
  if (from === 'on_hold' && to === 'active') return 'Job resumed.';
  if (to === 'active') return 'Job reopened.';
  if (to === 'on_hold') return `Put on hold${because}.`;
  if (to === 'delivered') {
    const on = day(d, 'delivered_on');
    return on ? `Finished on ${formatDay(on)}.` : 'Finished.';
  }
  if (to === 'cancelled') return `Job cancelled${because}.`;
  return 'Job reopened as a draft.';
}

function versionWord(n: number | null): string {
  return n === null ? 'no measurements' : `measurements version ${n}`;
}

/** One event, in plain words. Unknown or damaged facts never crash it: they read as what is known. */
export function describeEvent(event: HistoryEvent): string {
  const d = event.details;
  switch (event.action) {
    case 'order_created': {
      const n = num(d, 'number');
      return n === null ? 'Job created.' : `Job #${n} created.`;
    }
    case 'status_changed': {
      const from = d.from;
      const to = d.to;
      return isOrderStatus(from) && isOrderStatus(to)
        ? statusSentence(from, to, d)
        : 'The job changed status.';
    }
    case 'delivery_changed':
      return `Day moved from ${dayText(day(d, 'from'))} to ${dayText(day(d, 'to'))}.`;
    case 'buffer_changed': {
      const from = num(d, 'from');
      const to = num(d, 'to');
      return from === null || to === null
        ? 'The buffer before handover changed.'
        : `Buffer before handover changed from ${days(from)} to ${days(to)}.`;
    }
    case 'client_changed':
      return `Client changed from ${str(d, 'from', 'someone')} to ${str(d, 'to', 'someone else')}.`;
    case 'garment_added':
      return `Added ${str(d, 'garment_type', 'a garment')}.`;
    case 'garment_changed': {
      const now = str(d, 'garment_type', 'a garment');
      const was = str(d, 'was');
      return was && was !== now ? `Renamed ${was} to ${now}.` : `Changed the brief for ${now}.`;
    }
    case 'garment_removed':
      return `Removed ${str(d, 'garment_type', 'a garment')}.`;
    case 'garment_measurements': {
      const piece = str(d, 'garment_type', 'The garment');
      const from = num(d, 'from');
      const to = num(d, 'to');
      return from === null
        ? `${piece} is now made to ${versionWord(to)}.`
        : `${piece} now uses ${versionWord(to)} (was ${versionWord(from)}).`;
    }
    case 'prerequisite_added':
      return `Added to preparation: ${str(d, 'label', 'an item')}.`;
    case 'prerequisite_state': {
      const words = OLD_STATE[str(d, 'kind')] ?? OLD_STATE.other!;
      const from = words[str(d, 'from')] ?? '?';
      const to = words[str(d, 'to')] ?? '?';
      return `${str(d, 'label', 'An item')}: ${from} → ${to}.`;
    }
    case 'prerequisite_date': {
      const label = str(d, 'label', 'An item');
      const from = day(d, 'from');
      const to = day(d, 'to');
      if (to === null) return `${label} no longer has an expected date.`;
      return from === null
        ? `${label} expected on ${formatDay(to)}.`
        : `${label} expected on ${formatDay(to)} (was ${formatDay(from)}).`;
    }
    case 'prerequisite_blocking':
      return d.blocking === true
        ? `${str(d, 'label', 'An item')} now holds back the work that needs it.`
        : `${str(d, 'label', 'An item')} is now only a reminder.`;
    case 'prerequisite_removed':
      return `Removed from preparation: ${str(d, 'label', 'an item')}.`;
    case 'file_added':
    case 'file_removed': {
      const kind = isAttachmentKind(d.kind) ? ATTACHMENT_KIND_LABEL[d.kind] : 'Picture';
      const version = num(d, 'version');
      const name = version === null ? kind : `${kind} ${version}`;
      const caption = str(d, 'caption');
      const verb = event.action === 'file_added' ? 'Added' : 'Removed';
      return caption ? `${verb} ${name}: ${caption}.` : `${verb} ${name}.`;
    }
    case 'measurements_recorded': {
      const version = num(d, 'version');
      const taken = day(d, 'taken_on');
      const bits = [
        ...(version === null ? [] : [`version ${version}`]),
        ...(taken === null ? [] : [`taken ${formatDay(taken)}`]),
      ];
      return bits.length > 0
        ? `New measurements recorded (${bits.join(', ')}).`
        : 'New measurements recorded.';
    }
    case 'template_applied': {
      const piece = str(d, 'garment_type', 'A garment');
      const template = str(d, 'template');
      const version = num(d, 'version');
      const tasks = num(d, 'tasks');
      const from = template
        ? `the template “${template}”${version === null ? '' : ` (version ${version})`}`
        : 'a template since deleted';
      return tasks === null
        ? `${piece} planned from ${from}.`
        : `${piece} planned from ${from}: ${tasks} task${tasks === 1 ? '' : 's'}.`;
    }
    case 'plan_approved': {
      const n = num(d, 'number');
      const plan = n === null ? 'A plan' : `Plan ${n}`;
      const state = OLD_PLAN_STATE[str(d, 'state')] ?? null;
      const ready = day(d, 'ready_on');
      const verdict = [
        ...(state === null ? [] : [state]),
        ready === null ? 'not all of its work could be planned' : `ready ${formatDay(ready)}`,
      ].join(', ');
      return `${plan} approved: ${verdict}.`;
    }
    case 'task_done': {
      const title = str(d, 'title', 'A step');
      const actual = num(d, 'actual');
      const estimate = num(d, 'estimate');
      const on = day(d, 'done_on');
      const took =
        actual === null
          ? ''
          : `, in ${formatMinutes(actual)}${estimate === null ? '' : ` (estimate ${formatMinutes(estimate)})`}`;
      return `Done: ${title}${took}${on ? `, ${formatDay(on)}` : ''}.`;
    }
    case 'task_hold': {
      const title = str(d, 'title', 'A task');
      const reason = str(d, 'reason');
      return reason ? `${title} put on hold: ${reason}.` : `${title} no longer on hold.`;
    }
  }
}
