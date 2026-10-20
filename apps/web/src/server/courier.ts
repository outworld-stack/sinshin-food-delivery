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

/** stage-84 — مسیرِ نمایشی بعد از اسکن (رستوران → مقصد مشتری) */
export interface CourierScanRoute {
        origin: { lat: number; lng: number }
        destination: { lat: number; lng: number } | null
        address: string | null
        polyline: string | null
        distanceMeters: number | null
        durationSeconds: number | null
}

export async function courierScan(input: {
        orderId: string
        courierToken?: string | null
}): Promise<{
        success: boolean
        message?: string
        /** ترمیم اسکنِ استیج-۸۴ — true یعنی اسکنِ مجددِ idempotent (تا ۳ ساعت
         *  پس از اولین اسکن؛ سفارش قبلاً در مسیر بوده) */
        alreadyScanned?: boolean
        trackingEnabled?: boolean
        /** stage-84 — فقط روی موفقیت: مسیر رستوران→مقصد برای نقشه */
        route?: CourierScanRoute
}> {
        return postJson<{
                success: boolean
                message?: string
                alreadyScanned?: boolean
                trackingEnabled?: boolean
                route?: CourierScanRoute
        }>(`/courier/scan/${input.orderId}`, {
                courierToken: input.courierToken ?? undefined,
        })
}

// ─── موقعیت لحظه‌ای ───

export async function updateCourierLocation(input: {
        orderId: string
        courierToken: string
        lat: number
        lng: number
}): Promise<{ success: boolean; message?: string; accepted?: boolean; stopTracking?: boolean }> {
        return postJson<{ success: boolean; message?: string; accepted?: boolean; stopTracking?: boolean }>(
                `/courier/orders/${input.orderId}/location`,
                { courierToken: input.courierToken, lat: input.lat, lng: input.lng },
        )
}
