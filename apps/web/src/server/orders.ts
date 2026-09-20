// src/server/orders.ts — فلوی وضعیت + فاکتور از API
import { authJson } from '#/lib/api-fetch'

export const ORDER_FLOW = ['PAID', 'CONFIRMED', 'ON_THE_WAY', 'DELIVERED'] as const
export type OrderStatus = (typeof ORDER_FLOW)[number]

export async function getOrderFlowStatus(input: {
  data: { orderId: string }
}): Promise<{ current: string; next: string | null } | null> {
  return authJson<{ current: string; next: string | null } | null>(
    `/orders/${input.data.orderId}`,
    'GET',
  )
}

export async function advanceOrderStatus(input: {
  data: { orderId: string }
}): Promise<{ success: boolean; newStatus?: string; message?: string }> {
  return authJson<{ success: boolean; newStatus?: string; message?: string }>(
    `/orders/${input.data.orderId}/deliver`,
    'POST',
  )
}

export async function getOrderInvoice(input: {
  data: { orderId: string; type: 'kitchen' | 'sales' }
}) {
  return authJson<unknown>(
    `/orders/${input.data.orderId}/invoice?type=${input.data.type}`,
    'GET',
  )
}