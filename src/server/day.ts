import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { IsoDate } from '@/domain/dates';
import type { Item, LiveTask } from '@/domain/day/today';
import type { TaskKind } from '@/domain/engine/types';
import { isPrerequisiteState } from '@/domain/orders/prerequisites';
import { orderLabel } from '@/domain/orders/display';
import { isClosed, type OrderStatus } from '@/domain/orders/status';
import { isTaskKind } from '@/domain/planning/words';
import { fail, isoDay, timestamp } from './rows';

/**
 * What My Day needs besides the approved plan: the tasks it shows as they stand now, and what they wait for.
 * Rows are checked here, at the boundary (src/server/rows.ts).
 */

export interface DayFacts {
  tasks: LiveTask[];
  needs: { taskId: string; itemId: string }[];
  items: Item[];
}

const taskRow = z.object({
  id: z.string(),
  order_id: z.string().nullable(),
  title: z.string(),
  kind: z.string().refine(isTaskKind),
  minutes: z.number().int().nullable(),
  status: z.enum(['not_started', 'in_progress', 'done']),
  remaining_minutes: z.number().int().nullable(),
  actual_minutes: z.number().int().nullable(),
  hold_reason: z.string(),
  orders: z
    .object({
      number: z.number().int(),
      status: z.string(),
      order_item: z.array(z.object({ garment_type: z.string(), created_at: timestamp })),
    })
    .nullable(),
});

const TASK_COLUMNS = `id, order_id, title, kind, minutes, status, remaining_minutes, actual_minutes, hold_reason,
  orders(number, status, order_item(garment_type, created_at))`;

/**
 * The tasks on today's plan (`slotTaskIds`), every task in progress, and studio work not yet done: everything the
 * page can show. Tasks of delivered or cancelled orders are left out.
 */
export async function loadDayFacts(
  supabase: SupabaseClient,
  slotTaskIds: readonly string[],
): Promise<DayFacts> {
  const filters = ['status.eq.in_progress', 'and(order_id.is.null,status.neq.done)'];
  if (slotTaskIds.length > 0) filters.push(`id.in.(${slotTaskIds.join(',')})`);
  const { data, error } = await supabase.from('task').select(TASK_COLUMNS).or(filters.join(',')).limit(2000);
  if (error) fail('today’s tasks', error);
  const rows = z
    .array(taskRow)
    .parse(data)
    .filter((r) => r.orders === null || !isClosed(r.orders.status as OrderStatus));

  const ids = rows.map((r) => r.id);
  const needs =
    ids.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('task_requires')
          .select('task_id, prerequisite_id')
          .in('task_id', ids)
          .limit(5000);
  if (needs.error) fail('what the tasks wait for', needs.error);
  const needRows = z.array(z.object({ task_id: z.string(), prerequisite_id: z.string() })).parse(needs.data);

  const itemIds = [...new Set(needRows.map((n) => n.prerequisite_id))];
  const items =
    itemIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('prerequisite')
          .select('id, label, state, expected_on, blocking')
          .in('id', itemIds)
          .limit(5000);
  if (items.error) fail('the preparation', items.error);

  return {
    tasks: rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderLabel: r.orders
        ? orderLabel(
            r.orders.number,
            [...r.orders.order_item]
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map((g) => g.garment_type),
          )
        : null,
      title: r.title,
      kind: r.kind as TaskKind,
      minutes: r.minutes,
      status: r.status,
      remainingMinutes: r.remaining_minutes,
      actualMinutes: r.actual_minutes,
      holdReason: r.hold_reason,
    })),
    needs: needRows.map((n) => ({ taskId: n.task_id, itemId: n.prerequisite_id })),
    items: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          state: z.string().refine(isPrerequisiteState),
          expected_on: isoDay.nullable(),
          blocking: z.boolean(),
        }),
      )
      .parse(items.data)
      .map((i) => ({
        id: i.id,
        label: i.label,
        state: i.state as Item['state'],
        expectedOn: i.expected_on as IsoDate | null,
        blocking: i.blocking,
      })),
  };
}

/** The orders Quick Add can add to: those still open. */
export async function loadOpenOrders(supabase: SupabaseClient): Promise<{ id: string; label: string }[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, number, order_item(garment_type, created_at)')
    .in('status', ['draft', 'active', 'on_hold'])
    .order('number')
    .limit(500);
  if (error) fail('the orders', error);
  return z
    .array(
      z.object({
        id: z.string(),
        number: z.number().int(),
        order_item: z.array(z.object({ garment_type: z.string(), created_at: timestamp })),
      }),
    )
    .parse(data)
    .map((o) => ({
      id: o.id,
      label: orderLabel(
        o.number,
        [...o.order_item].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((g) => g.garment_type),
      ),
    }));
}
