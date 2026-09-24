// src/server/system.ts — round-18: مانیتورینگ سیستم داشبورد ادمین اصلی
// GET /api/health/metrics — گارد requireAdmin روی خود API.
import type { SystemMetricsDto } from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'

export async function getSystemMetrics(): Promise<SystemMetricsDto> {
        return authJson<SystemMetricsDto>('/health/metrics', 'GET')
}
