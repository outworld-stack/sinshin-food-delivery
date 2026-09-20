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

/**
 * perf-fix (کار-۳): fetchهای سمت سرور بدون timeout بودند — APIِ hang شده
 * یعنی SSR هم hang (کاربر تا timeout نیترو هیچ پاسخی نمی‌گیرد). ۱۰ ثانیه
 * سقف فقط برای SSR؛ سمت مرورگر بدون تغییر (شبکه‌ی ضعیف موبایل + retry خود مرورگر).
 */
export function ssrFetchSignal(): AbortSignal | undefined {
  return typeof window === 'undefined' ? AbortSignal.timeout(10_000) : undefined
}

const includeCookies = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  fetch(input, {
    ...init,
    credentials: 'include',
    // signal صریح caller (اگر باشد) اولویت دارد
    signal: init?.signal ?? ssrFetchSignal(),
  })

// ⬅ phase-4: treaty تایپ‌دار — «as any» مرده؛ مسیرها از App واقعی می‌آیند
const client = treaty<App>(apiRoot(), {
  fetcher: includeCookies as unknown as typeof fetch,
})
/** پراکسی عمومی (بدون auth) — ریشه‌اش /api است */
export const publicApi = client.api