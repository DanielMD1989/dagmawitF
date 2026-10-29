import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { IsoDate } from '@/domain/dates';
import { fromDatabaseTime } from '@/domain/calendar/time';
import { WARNING_CODES, type Slot, type TaskKind } from '@/domain/engine/types';
import {
  isPrerequisiteKind,
  isPrerequisiteState,
  type PrerequisiteKind,
} from '@/domain/orders/prerequisites';
import { isOrderStatus, type OrderStatus } from '@/domain/orders/status';
import type { PlanningFacts } from '@/domain/planning/input';
import type { StoredPlan } from '@/domain/planning/proposal';
import { isPlanStatus, isTaskKind, type PlanStatus } from '@/domain/planning/words';
import { loadCalendarSettings } from './calendar';
import { fail, isoDay, timestamp } from './rows';

/**
 * Everything Stage 3 reads: her library, an order's tasks, the facts the engine plans from, and plans.
 * Rows are checked here, at the boundary (src/server/rows.ts).
 */

const kind = z.string().refine(isTaskKind);
const clock = z
  .string()
  .nullable()
  .transform((v) => (v === null ? null : fromDatabaseTime(v)));

// ---------------------------------------------------------------------------------------------
// The library

export interface TemplateListItem {
  id: string;
  name: string;
  garmentType: string;
  version: number;
  tasks: number;
  /** Her hands only: work and appointments. */
  workMinutes: number;
}

const listRow = z.object({
  id: z.string(),
  name: z.string(),
  garment_type: z.string(),
  version: z.number().int(),
  template_task: z.array(z.object({ kind, minutes: z.number().int().nullable() })),
});

export async function loadTemplates(supabase: SupabaseClient): Promise<TemplateListItem[]> {
  const { data, error } = await supabase
    .from('template')
    .select('id, name, garment_type, version, template_task(kind, minutes)')
    .order('name')
    .limit(500);
  if (error) fail('her templates', error);
  return z
    .array(listRow)
    .parse(data)
    .map((t) => ({
      id: t.id,
      name: t.name,
      garmentType: t.garment_type,
      version: t.version,
      tasks: t.template_task.length,
      workMinutes: t.template_task.reduce((sum, k) => sum + (k.minutes ?? 0), 0),
    }));
}

export interface PlanTask {
  id: string;
  sort: number;
  title: string;
  kind: TaskKind;
  minutes: number | null;
  days: number | null;
}

export interface PlanLink {
  from: string;
  to: string;
  lagDays: number;
}

export interface TemplateItem {
  id: string;
  kind: PrerequisiteKind;
  label: string;
  blocking: boolean;
}

export interface TemplateDetail {
  id: string;
  name: string;
  garmentType: string;
  notes: string;
  version: number;
  tasks: PlanTask[];
  links: PlanLink[];
  items: TemplateItem[];
  /** Which items each task waits for. */
  needs: { taskId: string; itemId: string }[];
}

const taskRow = z.object({
  id: z.string(),
  sort: z.number().int(),
  title: z.string(),
  kind,
  minutes: z.number().int().nullable(),
  days: z.number().int().nullable(),
});
const toTask = (r: z.infer<typeof taskRow>): PlanTask => ({
  id: r.id,
  sort: r.sort,
  title: r.title,
  kind: r.kind as TaskKind,
  minutes: r.minutes,
  days: r.days,
});
const linkRow = z.object({ from_task: z.string(), to_task: z.string(), lag_days: z.number().int() });
const toLink = (r: z.infer<typeof linkRow>): PlanLink => ({
  from: r.from_task,
  to: r.to_task,
  lagDays: r.lag_days,
});

const templateRow = z.object({
  id: z.string(),
  name: z.string(),
  garment_type: z.string(),
  notes: z.string(),
  version: z.number().int(),
  template_task: z.array(taskRow),
  template_edge: z.array(linkRow),
  template_prerequisite: z.array(
    z.object({
      id: z.string(),
      sort: z.number().int(),
      kind: z.string().refine(isPrerequisiteKind),
      label: z.string(),
      blocking: z.boolean(),
    }),
  ),
  template_requires: z.array(z.object({ task_id: z.string(), prerequisite_id: z.string() })),
});

export async function loadTemplate(supabase: SupabaseClient, id: string): Promise<TemplateDetail | null> {
  const { data, error } = await supabase
    .from('template')
    .select(
      `id, name, garment_type, notes, version,
       template_task(id, sort, title, kind, minutes, days),
       template_edge(from_task, to_task, lag_days),
       template_prerequisite(id, sort, kind, label, blocking),
       template_requires(task_id, prerequisite_id)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) fail('the template', error);
  if (!data) return null;
  const t = templateRow.parse(data);
  return {
    id: t.id,
    name: t.name,
    garmentType: t.garment_type,
    notes: t.notes,
    version: t.version,
    tasks: t.template_task.map(toTask),
    links: t.template_edge.map(toLink),
    items: [...t.template_prerequisite]
      .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
      .map((p) => ({ id: p.id, kind: p.kind as PrerequisiteKind, label: p.label, blocking: p.blocking })),
    needs: t.template_requires.map((r) => ({ taskId: r.task_id, itemId: r.prerequisite_id })),
  };
}

// ---------------------------------------------------------------------------------------------
// An order's tasks

export interface OrderTask extends PlanTask {
  garmentId: string;
  fixedOn: IsoDate | null;
  fixedTime: string | null;
  notBefore: IsoDate | null;
  pinnedOn: IsoDate | null;
  progress: TaskProgress;
}

/** How far a task has come (docs/my-day.md). */
export interface TaskProgress {
  status: 'not_started' | 'in_progress' | 'done';
  doneOn: IsoDate | null;
  actualMinutes: number | null;
  holdReason: string;
}

export interface OrderPlanning {
  tasks: OrderTask[];
  links: PlanLink[];
  needs: { taskId: string; itemId: string }[];
  /** Which template each garment was planned from, if any. */
  garments: { id: string; templateName: string | null; templateVersion: number | null }[];
}

const orderTaskRow = taskRow.extend({
  order_item_id: z.string(),
  fixed_on: isoDay.nullable(),
  fixed_time: clock,
  not_before: isoDay.nullable(),
  pinned_on: isoDay.nullable(),
  status: z.enum(['not_started', 'in_progress', 'done']),
  done_on: isoDay.nullable(),
  actual_minutes: z.number().int().nullable(),
  hold_reason: z.string(),
});

export async function loadOrderPlanning(supabase: SupabaseClient, orderId: string): Promise<OrderPlanning> {
  const [tasks, links, needs, garments] = await Promise.all([
    supabase
      .from('task')
      .select(
        'id, sort, title, kind, minutes, days, order_item_id, fixed_on, fixed_time, not_before, pinned_on, status, done_on, actual_minutes, hold_reason',
      )
      .eq('order_id', orderId)
      .order('sort')
      .limit(1000),
    supabase.from('task_edge').select('from_task, to_task, lag_days').eq('order_id', orderId).limit(5000),
    supabase.from('task_requires').select('task_id, prerequisite_id').eq('order_id', orderId).limit(5000),
    supabase
      .from('order_item')
      .select('id, template_version, template:template(name)')
      .eq('order_id', orderId),
  ]);
  if (tasks.error) fail('the order’s tasks', tasks.error);
  if (links.error) fail('the order’s links', links.error);
  if (needs.error) fail('what the tasks wait for', needs.error);
  if (garments.error) fail('the garments', garments.error);
  return {
    tasks: z
      .array(orderTaskRow)
      .parse(tasks.data)
      .map((r) => ({
        ...toTask(r),
        garmentId: r.order_item_id,
        fixedOn: r.fixed_on,
        fixedTime: r.fixed_time,
        notBefore: r.not_before,
        pinnedOn: r.pinned_on,
        progress: {
          status: r.status,
          doneOn: r.done_on,
          actualMinutes: r.actual_minutes,
          holdReason: r.hold_reason,
        },
      })),
    links: z.array(linkRow).parse(links.data).map(toLink),
    needs: z
      .array(z.object({ task_id: z.string(), prerequisite_id: z.string() }))
      .parse(needs.data)
      .map((r) => ({ taskId: r.task_id, itemId: r.prerequisite_id })),
    garments: z
      .array(
        z.object({
          id: z.string(),
          template_version: z.number().int().nullable(),
          template: z.object({ name: z.string() }).nullable(),
        }),
      )
      .parse(garments.data)
      .map((g) => ({
        id: g.id,
        templateName: g.template?.name ?? null,
        templateVersion: g.template_version,
      })),
  };
}

// ---------------------------------------------------------------------------------------------
// The facts the engine plans from

export interface FactsAtEpoch {
  /** The planning epoch, read before anything else: a change while the rest is read makes the proposal refused. */
  epoch: number;
  /** The progress counter, read with it (decision 0041). */
  progress: number;
  facts: PlanningFacts;
}

const epochRow = z.object({ plan_epoch: z.union([z.number(), z.string()]).transform(Number) });

export async function loadEpoch(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.from('profile').select('plan_epoch').single();
  if (error) fail('her plan', error);
  return epochRow.parse(data).plan_epoch;
}

export async function loadPlanningFacts(supabase: SupabaseClient): Promise<FactsAtEpoch> {
  const counters = await supabase.from('profile').select('plan_epoch, progress_epoch').single();
  if (counters.error) fail('her plan', counters.error);
  const { plan_epoch: epoch, progress_epoch: progress } = z
    .object({
      plan_epoch: z.union([z.number(), z.string()]).transform(Number),
      progress_epoch: z.union([z.number(), z.string()]).transform(Number),
    })
    .parse(counters.data);
  const settings = await loadCalendarSettings(supabase);

  const orders = await supabase
    .from('orders')
    .select('id, number, status, delivery_on, buffer_days, order_item(garment_type, created_at)')
    .eq('status', 'active')
    .order('number')
    .limit(1000);
  if (orders.error) fail('the orders', orders.error);
  const orderRows = z
    .array(
      z.object({
        id: z.string(),
        number: z.number().int(),
        status: z.string().refine(isOrderStatus),
        delivery_on: isoDay,
        buffer_days: z.number().int(),
        order_item: z.array(z.object({ garment_type: z.string(), created_at: timestamp })),
      }),
    )
    .parse(orders.data);
  const ids = orderRows.map((o) => o.id);

  const [tasks, links, prerequisites, needs] = await Promise.all([
    supabase
      .from('task')
      .select(
        `id, order_id, title, kind, minutes, days, fixed_on, fixed_time, not_before,
         status, done_on, remaining_minutes, hold_reason, pinned_on, order_item(garment_type)`,
      )
      // The active orders' tasks, and studio work (no order).
      .or(ids.length > 0 ? `order_id.in.(${ids.join(',')}),order_id.is.null` : 'order_id.is.null')
      .limit(20000),
    supabase.from('task_edge').select('from_task, to_task, lag_days').in('order_id', ids).limit(50000),
    supabase
      .from('prerequisite')
      .select('id, order_id, label, state, expected_on, blocking')
      .in('order_id', ids)
      .limit(20000),
    supabase.from('task_requires').select('task_id, prerequisite_id').in('order_id', ids).limit(50000),
  ]);
  if (tasks.error) fail('the tasks', tasks.error);
  if (links.error) fail('the links', links.error);
  if (prerequisites.error) fail('the preparation', prerequisites.error);
  if (needs.error) fail('what the tasks wait for', needs.error);

  return {
    epoch,
    progress,
    facts: {
      today: settings.today,
      calendar: {
        week: settings.week,
        exceptions: settings.exceptions,
        planningRatio: settings.profile.planningRatio,
      },
      orders: orderRows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status as OrderStatus,
        deliveryOn: o.delivery_on,
        bufferDays: o.buffer_days,
        garmentTypes: [...o.order_item]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((g) => g.garment_type),
      })),
      tasks: z
        .array(
          z.object({
            id: z.string(),
            order_id: z.string().nullable(),
            title: z.string(),
            kind,
            minutes: z.number().int().nullable(),
            days: z.number().int().nullable(),
            fixed_on: isoDay.nullable(),
            fixed_time: clock,
            not_before: isoDay.nullable(),
            status: z.enum(['not_started', 'in_progress', 'done']),
            done_on: isoDay.nullable(),
            remaining_minutes: z.number().int().nullable(),
            hold_reason: z.string(),
            pinned_on: isoDay.nullable(),
            order_item: z.object({ garment_type: z.string() }).nullable(),
          }),
        )
        .parse(tasks.data)
        .map((t) => ({
          id: t.id,
          orderId: t.order_id,
          garment: t.order_item?.garment_type ?? null,
          title: t.title,
          kind: t.kind as TaskKind,
          minutes: t.minutes,
          days: t.days,
          fixedOn: t.fixed_on,
          fixedTime: t.fixed_time,
          notBefore: t.not_before,
          status: t.status,
          doneOn: t.done_on,
          remainingMinutes: t.remaining_minutes,
          holdReason: t.hold_reason,
          pinnedOn: t.pinned_on,
        })),
      edges: z.array(linkRow).parse(links.data).map(toLink),
      prerequisites: z
        .array(
          z.object({
            id: z.string(),
            order_id: z.string(),
            label: z.string(),
            state: z.string().refine(isPrerequisiteState),
            expected_on: isoDay.nullable(),
            blocking: z.boolean(),
          }),
        )
        .parse(prerequisites.data)
        .map((p) => ({
          id: p.id,
          orderId: p.order_id,
          label: p.label,
          state: p.state as 'needed' | 'ordered' | 'received',
          expectedOn: p.expected_on,
          blocking: p.blocking,
        })),
      requirements: z
        .array(z.object({ task_id: z.string(), prerequisite_id: z.string() }))
        .parse(needs.data)
        .map((r) => ({ taskId: r.task_id, prerequisiteId: r.prerequisite_id })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Plans

const finding = z.object({
  code: z.enum(WARNING_CODES),
  severity: z.enum(['info', 'warning', 'problem']),
  orderId: z.string().nullable(),
  taskId: z.string().nullable(),
  numbers: z.record(z.string(), z.union([z.number(), z.string()])),
  message: z.string(),
});

/** The engine's own output, as kept. Checked field by field: an old plan that does not read is an error, not a guess. */
const storedPlan = z.object({
  today: isoDay,
  calendar: z.object({ start: isoDay, usable: z.array(z.number().int()) }),
  orders: z.array(
    z.object({
      id: z.string(),
      state: z.enum(['on_track', 'at_risk', 'infeasible']),
      readyOn: isoDay.nullable(),
      earliestReadyOn: isoDay.nullable(),
      lastWorkDay: isoDay,
      slackDays: z.number().nullable(),
      complete: z.boolean(),
      reasons: z.array(finding),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string(),
      orderId: z.string().nullable(),
      placement: z.enum(['planned', 'pinned', 'unplanned', 'done']),
      start: isoDay.nullable(),
      finish: isoDay.nullable(),
      earliestFinish: isoDay.nullable(),
      latestFinish: isoDay.nullable(),
      slackDays: z.number().nullable(),
      critical: z.boolean(),
    }),
  ),
  warnings: z.array(finding),
  critical: z.array(z.string()),
  facts: z.object({
    orders: z.array(
      z.object({ id: z.string(), label: z.string(), deliveryOn: isoDay, bufferDays: z.number().int() }),
    ),
    tasks: z.array(
      z.object({
        id: z.string(),
        orderId: z.string().nullable(),
        garment: z.string().nullable(),
        title: z.string(),
        kind,
        minutes: z.number().int().nullable(),
        days: z.number().int().nullable(),
      }),
    ),
  }),
});

export interface PlanHeader {
  number: number;
  status: PlanStatus;
  baseNumber: number | null;
  epoch: number;
  madeFor: IsoDate;
  createdAt: string;
  decidedAt: string | null;
}

export interface PlanVersion extends PlanHeader {
  stored: StoredPlan;
  slots: Slot[];
}

const headerRow = z.object({
  number: z.number().int(),
  status: z.string().refine(isPlanStatus),
  base_number: z.number().int().nullable(),
  epoch: z.union([z.number(), z.string()]).transform(Number),
  made_for: isoDay,
  created_at: timestamp,
  decided_at: timestamp.nullable(),
});
const HEADER_COLUMNS = 'number, status, base_number, epoch, made_for, created_at, decided_at';
const toHeader = (r: z.infer<typeof headerRow>): PlanHeader => ({
  number: r.number,
  status: r.status as PlanStatus,
  baseNumber: r.base_number,
  epoch: r.epoch,
  madeFor: r.made_for,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

/** Every plan she has made, newest first. */
export async function loadPlanList(supabase: SupabaseClient): Promise<PlanHeader[]> {
  const { data, error } = await supabase
    .from('plan_version')
    .select(HEADER_COLUMNS)
    .order('number', { ascending: false })
    .limit(200);
  if (error) fail('her plans', error);
  return z.array(headerRow).parse(data).map(toHeader);
}

async function loadSlots(supabase: SupabaseClient, planId: string): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('plan_slot')
    .select('task_id, day, minutes, rank, at_time')
    .eq('plan_id', planId)
    .order('day')
    .order('rank')
    .limit(50000);
  if (error) fail('the plan’s days', error);
  return z
    .array(
      z.object({
        task_id: z.string(),
        day: isoDay,
        minutes: z.number().int(),
        rank: z.number().int(),
        at_time: clock,
      }),
    )
    .parse(data)
    .map((s) => ({
      taskId: s.task_id,
      day: s.day,
      minutes: s.minutes,
      rank: s.rank,
      ...(s.at_time ? { time: s.at_time } : {}),
    }));
}

async function loadVersionWhere(
  supabase: SupabaseClient,
  column: 'number' | 'status',
  value: number | string,
): Promise<PlanVersion | null> {
  const { data, error } = await supabase
    .from('plan_version')
    .select(`id, result, ${HEADER_COLUMNS}`)
    .eq(column, value)
    .maybeSingle();
  if (error) fail('the plan', error);
  if (!data) return null;
  const row = headerRow.extend({ id: z.string(), result: storedPlan }).parse(data);
  return { ...toHeader(row), stored: row.result as StoredPlan, slots: await loadSlots(supabase, row.id) };
}

export const loadPlanVersion = (supabase: SupabaseClient, number: number) =>
  loadVersionWhere(supabase, 'number', number);

export const loadApprovedPlan = (supabase: SupabaseClient) =>
  loadVersionWhere(supabase, 'status', 'approved');
