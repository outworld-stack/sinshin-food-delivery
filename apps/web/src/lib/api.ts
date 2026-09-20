// src/lib/api.ts
import { treaty } from '@elysiajs/eden'
import type { App } from '../../../api/src/app-type'

/** base با /api — برای helperهای مسیر-محور (getJson/authJson/FileUploader) */
export function apiBase(): string {
  if (typeof window !== 'undefined') {
    const base = import.meta.env.VITE_API_URL || window.location.origin
    return base + '/api'
  }
  return (process.env.API_URL ?? 'http://localhost:3000') + '/api'
}

/**
 * ریشه بدون /api — برای treaty تایپ‌دار: مسیرهای App prefix داخلی /api
 * دارند → پراکسی client.api یعنی /api/*
 */
export function apiRoot(): string {
  if (typeof window !== 'undefined') {
    return import.meta.env.VITE_API_URL || window.location.origin
  }
  return process.env.API_URL ?? 'http://localhost:3000'
}

const includeCookies = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  fetch(input, { ...init, credentials: 'include' })

// ⬅ phase-4: treaty تایپ‌دار — «as any» مرده؛ مسیرها از App واقعی می‌آیند
const client = treaty<App>(apiRoot(), {
  fetcher: includeCookies as unknown as typeof fetch,
})
/** پراکسی عمومی (بدون auth) — ریشه‌اش /api است */
export const publicApi = client.api