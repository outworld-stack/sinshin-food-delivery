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

export async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const base = import.meta.env.VITE_API_URL || window.location.origin
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) return false
      const data = (await res.json()) as { accessToken: string }
      setAccessToken(data.accessToken)
      return true
    } catch {
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