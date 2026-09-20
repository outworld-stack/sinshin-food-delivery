// src/server/deliveryZones.ts — کامل جایگزین
import { authJson } from '#/lib/api-fetch'

export interface DeliveryZone {
  radiusKm: number
  fee: number
}

export async function getDeliveryZones(): Promise<{ zones: DeliveryZone[] }> {
  return authJson<{ zones: DeliveryZone[] }>('/admin/settings/delivery-zones', 'GET')
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

export async function removeDeliveryZone(input: {
  radiusKm: number
}): Promise<{ success: boolean; message?: string }> {
  return authJson<{ success: boolean; message?: string }>(
    '/admin/settings/delivery-zones/remove',
    'POST',
    input,
  )
}

// ─── محاسبه‌ی هزینه برای آدرس — فعلاً سمت سرور در checkout محاسبه می‌شود ───
// این تابع فقط برای نمایش تقریبی است — checkout واقعی از API می‌آید
export const RESTAURANT_LOCATION = { lat: 35.6892, lng: 51.389 }

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}