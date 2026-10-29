import 'server-only';
import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { IsoDate } from '@/domain/dates';
import { compareAttachments, isAttachmentKind, type AttachmentKind } from '@/domain/files';
import { isHistoryAction, type HistoryAction } from '@/domain/orders/history';
import {
  isPrerequisiteKind,
  isPrerequisiteState,
  readiness,
  type Prerequisite,
  type Readiness,
} from '@/domain/orders/prerequisites';
import { isOrderStatus, type OrderStatus } from '@/domain/orders/status';
import { fail, isoDay, timestamp } from './rows';
import { createSupabase } from './supabase';

const status = z.string().refine(isOrderStatus);

const prerequisiteRow = z.object({
  id: z.string(),
  kind: z.string().refine(isPrerequisiteKind),
  label: z.string(),
  state: z.string().refine(isPrerequisiteState),
  expected_on: isoDay.nullable(),
  blocking: z.boolean(),
  note: z.string(),
});

const PREREQUISITE_COLUMNS = 'id, kind, label, state, expected_on, blocking, note';

function toPrerequisite(r: z.infer<typeof prerequisiteRow>): Prerequisite {
  return {
    id: r.id,
    kind: r.kind as Prerequisite['kind'],
    label: r.label,
    state: r.state as Prerequisite['state'],
    expectedOn: r.expected_on,
    blocking: r.blocking,
    note: r.note,
  };
}

// ---------------------------------------------------------------------------------------------
// The list of orders

export interface OrderListItem {
  id: string;
  number: number;
  status: OrderStatus;
  deliveryOn: IsoDate;
  clientId: string;
  clientName: string;
  garmentTypes: string[];
  readiness: Readiness;
}

const listRow = z.object({
  id: z.string(),
  number: z.number().int(),
  status,
  delivery_on: isoDay,
  client: z.object({ id: z.string(), name: z.string() }),
  order_item: z.array(z.object({ garment_type: z.string() })),
  prerequisite: z.array(prerequisiteRow),
});

/** All of her orders, soonest handover first, with what each is made of and how ready it is. */
export async function loadOrders(supabase: SupabaseClient, today: IsoDate): Promise<OrderListItem[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      `id, number, status, delivery_on, client:client(id, name), order_item(garment_type), prerequisite(${PREREQUISITE_COLUMNS})`,
    )
    .order('delivery_on')
    .order('number')
    .order('created_at', { referencedTable: 'order_item' })
    .limit(2000);
  if (error) fail('her orders', error);
  return z
    .array(listRow)
    .parse(data)
    .map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status as OrderStatus,
      deliveryOn: o.delivery_on,
      clientId: o.client.id,
      clientName: o.client.name,
      garmentTypes: o.order_item.map((g) => g.garment_type),
      readiness: readiness(o.prerequisite.map(toPrerequisite), today),
    }));
}

// ---------------------------------------------------------------------------------------------
// One order

export interface Garment {
  id: string;
  garmentType: string;
  brief: string;
  /** The saved version of the client's measurements this garment is made to; null until she has measured. */
  measurementSetId: string | null;
}

export interface OrderDetail {
  id: string;
  number: number;
  status: OrderStatus;
  deliveryOn: IsoDate;
  bufferDays: number;
  holdReason: string;
  cancelReason: string;
  deliveredOn: IsoDate | null;
  notes: string;
  client: { id: string; name: string; phone: string };
  garments: Garment[];
}

const detailRow = z.object({
  id: z.string(),
  number: z.number().int(),
  status,
  delivery_on: isoDay,
  buffer_days: z.number().int(),
  hold_reason: z.string(),
  cancel_reason: z.string(),
  delivered_on: isoDay.nullable(),
  notes: z.string(),
  client: z.object({ id: z.string(), name: z.string(), phone: z.string() }),
  order_item: z.array(
    z.object({
      id: z.string(),
      garment_type: z.string(),
      brief: z.string(),
      measurement_set_id: z.string().nullable(),
    }),
  ),
});

/** One order, or null if there is no such order (or it is not hers). */
export async function loadOrder(supabase: SupabaseClient, id: string): Promise<OrderDetail | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      `id, number, status, delivery_on, buffer_days, hold_reason, cancel_reason, delivered_on, notes,
       client:client(id, name, phone), order_item(id, garment_type, brief, measurement_set_id)`,
    )
    .eq('id', id)
    .order('created_at', { referencedTable: 'order_item' })
    .maybeSingle();
  if (error) fail('the order', error);
  if (!data) return null;
  const o = detailRow.parse(data);
  return {
    id: o.id,
    number: o.number,
    status: o.status as OrderStatus,
    deliveryOn: o.delivery_on,
    bufferDays: o.buffer_days,
    holdReason: o.hold_reason,
    cancelReason: o.cancel_reason,
    deliveredOn: o.delivered_on,
    notes: o.notes,
    client: o.client,
    garments: o.order_item.map((g) => ({
      id: g.id,
      garmentType: g.garment_type,
      brief: g.brief,
      measurementSetId: g.measurement_set_id,
    })),
  };
}

/**
 * The order for this request. The page and the layout around it both ask for it, and it is read from the
 * database once. (React's cache lasts for one request only.)
 */
export const getOrder = cache(async (id: string) => loadOrder(await createSupabase(), id));

// ---------------------------------------------------------------------------------------------
// What hangs from an order

/** What the order is waiting for, in the order it was added. */
export async function loadPrerequisites(supabase: SupabaseClient, orderId: string): Promise<Prerequisite[]> {
  const { data, error } = await supabase
    .from('prerequisite')
    .select(PREREQUISITE_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at')
    .order('id')
    .limit(500);
  if (error) fail('what the order is waiting for', error);
  return z.array(prerequisiteRow).parse(data).map(toPrerequisite);
}

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  caption: string;
  /** Sketch 1, Sketch 2: counted per order and kind. */
  version: number;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

const attachmentRow = z.object({
  id: z.string(),
  kind: z.string().refine(isAttachmentKind),
  caption: z.string(),
  version: z.number().int(),
  content_type: z.string(),
  size_bytes: z.number().int(),
  created_at: timestamp,
});

/** The order's sketches and photos, in the order the brief shows them (`compareAttachments`). */
export async function loadAttachments(supabase: SupabaseClient, orderId: string): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from('attachment')
    .select('id, kind, caption, version, content_type, size_bytes, created_at')
    .eq('order_id', orderId)
    .limit(100);
  if (error) fail('the sketches and photos', error);
  return z
    .array(attachmentRow)
    .parse(data)
    .map((a) => ({
      id: a.id,
      kind: a.kind as AttachmentKind,
      caption: a.caption,
      version: a.version,
      contentType: a.content_type,
      sizeBytes: a.size_bytes,
      createdAt: a.created_at,
    }))
    .sort(compareAttachments);
}

export interface HistoryRow {
  seq: number;
  /** When it happened, as an ISO timestamp. */
  at: string;
  action: HistoryAction;
  details: Record<string, unknown>;
}

const historyRow = z.object({
  seq: z.coerce.number().int(),
  at: timestamp,
  action: z.string().refine(isHistoryAction),
  details: z.record(z.string(), z.unknown()),
});

/** What happened to an order, newest first. */
export async function loadHistory(supabase: SupabaseClient, orderId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('seq, at, action, details')
    .eq('order_id', orderId)
    .order('seq', { ascending: false })
    .limit(500);
  if (error) fail('the history', error);
  return z
    .array(historyRow)
    .parse(data)
    .map((h) => ({ seq: h.seq, at: h.at, action: h.action as HistoryAction, details: h.details }));
}

// ---------------------------------------------------------------------------------------------
// Help for the new-order form

export interface OrderHints {
  /** The number the database will give a new order if she does not type one. */
  nextNumber: number;
  /** The garments she has made before, the most common first, to finish a word she starts typing. */
  garmentTypes: string[];
}

const hintsRow = z.object({
  number: z.number().int(),
  order_item: z.array(z.object({ garment_type: z.string() })),
});

export async function loadOrderHints(supabase: SupabaseClient): Promise<OrderHints> {
  const { data, error } = await supabase
    .from('orders')
    .select('number, order_item(garment_type)')
    .limit(5000);
  if (error) fail('her orders', error);
  const rows = z.array(hintsRow).parse(data);
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const g of row.order_item) counts.set(g.garment_type, (counts.get(g.garment_type) ?? 0) + 1);
  return {
    nextNumber: rows.reduce((highest, r) => Math.max(highest, r.number), 0) + 1,
    garmentTypes: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([type]) => type),
  };
}
