// src/server/deliveryZones.ts — کامل جایگزین
// رارد ۴۶ — DeliveryZone/DeliveryZonesData از قرارداد مشترک می‌آیند؛
// re-export برای پایداری مسیر import مصرف‌کننده‌های فعلی است.
import type { DeliveryZone, DeliveryZonesData } from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'

export type { DeliveryZone, DeliveryZonesData }

export async function getDeliveryZones(): Promise<DeliveryZonesData> {
  return authJson<DeliveryZonesData>('/admin/settings/delivery-zones', 'GET')
}

export async function addDeliveryZone(input: {
  radiusKm: number
  fee: number
}): Promise<{ success: boolean; message?: string }> {
  return authJson<{ success: boolean; message?: string }>(
    '/admin/settings/delivery-zones',
    'POST',
    input,
  )
}

export async function updateDeliveryZone(input: {
  radiusKm: number
  newRadiusKm: number
  fee: number
}): Promise<{ success: boolean; message?: string }> {
  return authJson<{ success: boolean; message?: string }>(
    '/admin/settings/delivery-zones/update',
    'POST',
    input,
  )
}

export async function removeDeliveryZone(input: {
  radiusKm: number
}): Promise<{ success: boolean; message?: string }> {
  return authJson<{ success: boolean; message?: string }>(
    '/admin/settings/delivery-zones/remove',
    'POST',
    input,
  )
}