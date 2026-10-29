import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isOrderStatus, isClosed, type OrderStatus } from '@/domain/orders/status';
import type { IsoDate } from '@/domain/dates';
import { fail, isoDay } from './rows';

const status = z.string().refine(isOrderStatus);

export interface ClientListItem {
  id: string;
  name: string;
  phone: string;
  /** Orders that are not yet delivered or cancelled. */
  openOrders: number;
  orders: number;
}

const listRow = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  orders: z.array(z.object({ status })),
});

/** All of her clients by name, with how many orders each has. */
export async function loadClients(supabase: SupabaseClient): Promise<ClientListItem[]> {
  const { data, error } = await supabase.from('client').select('id, name, phone, orders(status)').limit(2000);
  if (error) fail('her clients', error);
  return z
    .array(listRow)
    .parse(data)
    .map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      orders: c.orders.length,
      openOrders: c.orders.filter((o) => !isClosed(o.status as OrderStatus)).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export interface ClientOrder {
  id: string;
  number: number;
  status: OrderStatus;
  deliveryOn: IsoDate;
  garmentTypes: string[];
}

export interface ClientDetail {
  id: string;
  name: string;
  phone: string;
  notes: string;
  /** Latest handover day first. */
  orders: ClientOrder[];
}

const detailRow = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  notes: z.string(),
  orders: z.array(
    z.object({
      id: z.string(),
      number: z.number().int(),
      status,
      delivery_on: isoDay,
      order_item: z.array(z.object({ garment_type: z.string() })),
    }),
  ),
});

/** One client with her orders, or null if there is no such client (or it is not hers). */
export async function loadClient(supabase: SupabaseClient, id: string): Promise<ClientDetail | null> {
  const { data, error } = await supabase
    .from('client')
    .select('id, name, phone, notes, orders(id, number, status, delivery_on, order_item(garment_type))')
    .eq('id', id)
    .order('delivery_on', { referencedTable: 'orders', ascending: false })
    .order('created_at', { referencedTable: 'orders.order_item' })
    .maybeSingle();
  if (error) fail('the client', error);
  if (!data) return null;
  const c = detailRow.parse(data);
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    orders: c.orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status as OrderStatus,
      deliveryOn: o.delivery_on,
      garmentTypes: o.order_item.map((g) => g.garment_type),
    })),
  };
}
