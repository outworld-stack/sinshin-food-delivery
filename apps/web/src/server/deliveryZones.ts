// src/server/deliveryZones.ts — کامل جایگزین
import { authJson } from '#/lib/api-fetch'

export interface DeliveryZone {
  radiusKm: number
  fee: number
}

export interface DeliveryZonesData {
  zones: DeliveryZone[]
  /** round-13 — مبدأ واقعی محاسبه‌ی فاصله (env > تنظیمات > پیش‌فرض) */
  origin?: { lat: number; lng: number }
}

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
