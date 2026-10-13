// src/lib/auth-session.ts
import { useAuthStore } from '#/stores/authStore'

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string): void {
  accessToken = token
}

export function clearAccessToken(): void {
  accessToken = null
}

export function onUnauthorized(): void {
  clearAccessToken()
  useAuthStore.getState().logout()
}

let refreshPromise: Promise<boolean> | null = null

/** پیامِ 401 نرمِ «رقابتِ چرخش» — همان رشته‌ی session.service (apps/api) */
const RACE_RETRY_MESSAGE = 'نشست هم‌زمان چرخیده است؛ دوباره تلاش کنید.'

/** stage-60 — سقفِ ۲۰ ثانیه‌ای خودِ فراخوانی refresh (SW درخواست‌های POST را نمی‌گیرد) */
const REFRESH_TIMEOUT_MS = 20_000

async function refreshFetch(): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('مهلت نوسازی نشست به پایان رسید.', 'TimeoutError'),
      ),
    REFRESH_TIMEOUT_MS,
  )
  try {
    const base = import.meta.env.VITE_API_URL || window.location.origin
    return await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      let res = await refreshFetch()
      if (res.status === 401) {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string }
        } | null
        if (body?.error?.message === RACE_RETRY_MESSAGE) {
          // stage-60 — رقابتِ چرخش: دو کانتکست هم‌کوکی پشت‌سرهم refresh
          // زدند؛ سرور 401 نرم با پیامِ «retry» می‌دهد. یک مکث کوتاه (کوکیِ
          // تازه از چرخندهٔ برنده در jar می‌نشیند) و یک تلاش دیگر.
          await new Promise((r) => setTimeout(r, 500))
          res = await refreshFetch()
        } else {
          // 401 قطعی (نشست مرده/باطل) — تنها حالتِ مجازِ خروج
          onUnauthorized()
          return false
        }
      }
      if (res.status === 401 || res.status === 403) {
        // بعد از ریتری هم 401/403 — قطعی
        onUnauthorized()
        return false
      }
      if (!res.ok) {
        // stage-60 — 429 (سقف IPِ CGNATِ اشتراکی) / 5xx (ری‌استارت دیپلوی):
        // خروج نیست؛ کاربر می‌ماند و فراخواننده خطای خودش را نشان می‌دهد.
        return false
      }
      const data = (await res.json()) as { accessToken: string }
      setAccessToken(data.accessToken)
      return true
    } catch {
      // خطای شبکه/مهلت — غیرقطعی؛ خروج ممنوع
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export function hasSession(): boolean {
  return accessToken !== null
}

// ─── Boot: بعد از رفرش، اگر توکن نیست، یک‌بار refresh بزن ───
// در کلاینت اجرا می‌شود — قبل از اولین درخواست‌های authJson
if (typeof window !== 'undefined') {
  void tryRefresh()
}

/** اگر توکن نیست و refresh در جریان است — صبر کن تمام شود */
export async function ensureSession(): Promise<void> {
  if (accessToken !== null) return
  await tryRefresh()
}