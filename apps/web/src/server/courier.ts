// src/server/courier.ts — پیک: OTP + اسکن + موقعیت — تماماً API
import { postJson } from '#/lib/api-fetch'

// ─── OTP پیک (فقط سفارش‌های securityEnabled) ───

export async function requestCourierOtp(phone: string): Promise<{
  cooldownSeconds: number
  devCode?: string
}> {
  return postJson<{ cooldownSeconds: number; devCode?: string }>(
    '/courier/otp/request',
    { phone },
  )
}

export async function verifyCourierOtp(input: {
  phone: string
  code: string
}): Promise<{ token: string; courierId: string }> {
  return postJson<{ token: string; courierId: string }>('/courier/otp/verify', {
    phone: input.phone,
    code: input.code,
  })
}

// ─── اسکن QR ───

export async function courierScan(input: {
  orderId: string
  courierToken?: string | null
}): Promise<{ success: boolean; message?: string }> {
  return postJson<{ success: boolean; message?: string }>(`/courier/scan/${input.orderId}`, {
    courierToken: input.courierToken ?? undefined,
  })
}

// ─── موقعیت لحظه‌ای ───

export async function updateCourierLocation(input: {
  orderId: string
  courierToken: string
  lat: number
  lng: number
}): Promise<{ success: boolean; message?: string }> {
  return postJson<{ success: boolean; message?: string }>(
    `/courier/orders/${input.orderId}/location`,
    { courierToken: input.courierToken, lat: input.lat, lng: input.lng },
  )
}