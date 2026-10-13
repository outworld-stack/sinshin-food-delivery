// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 25 از 49
// مسیر مقصد: apps/web/src/lib/api-fetch.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/lib/api-fetch.ts
// هلپرهای fetch مشترک — همه‌ی server/*.ts از اینجا استفاده می‌کنند
// تبدیل نوع فقط اینجا (مرز serde) — به‌علاوه‌ی تبدیل نوع در هر فراخواننده با قرارداد

import { apiBase, ssrFetchSignal } from '#/lib/api'
import { getAccessToken, onUnauthorized, tryRefresh } from '#/lib/auth-session'
import { langHeaders, resolveRequestLang } from '#/lib/lang-header'

export interface FetchOpts {
  /** هدرهای اضافی — با هدرهای پایه ادغام می‌شوند (مثل idempotency-key) */
  headers?: Record<string, string>
}

/**
 * stage-59 — ریشه‌یابی باگ «تعویض بلادرنگ fa↔ar»:
 * سرور محتوای زبان را در هدرِ درخواست می‌فرستد (x-sinshin-lang)، ولی کشِ
 * HTTPِ مرورگر فقط با (method + URL) کلید می‌خورد. رِفچِ فوریِ بعد از
 * تعویض زبان (invalidateQueries + router.invalidate — که همه درست کار
 * می‌کنند) به همان URL می‌رخت و مرورگر تا ۳۰ ثانیه (max-age + SWR تا ۹۰)
 * بدنه‌ی کش‌شده‌ی «زبان قبلی» را از کش HTTP برمی‌گرداند — اسم غذاها و
 * توضیحات عربی نمی‌شد. حل قطعی و مستقل از پشتیبانی Vary در مرورگرها:
 * زبان به‌عنوان پارامتر URL به همه‌ی GETها چسبانده می‌شود → هر زبان ورودیِ
 * کش HTTP اختصاصی خودش را دارد؛ تعویض زبان همان لحظه داده‌ی تازه می‌گیرد.
 * (ا آزمایش شد: Elysia پارامترهای اضافه‌ی query را نادیده می‌گیرد — 200.)
 */
function withLangQuery(path: string, lang: 'fa' | 'ar'): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}lang=${lang}`
}

export async function getJson<T>(path: string): Promise<T> {
  // round-34 — x-sinshin-lang از کوکی (SSR: درخواست ورودی؛ مرورگر: document)
  // stage-59 — زبان در URL (کش HTTP per-lang) + هدر متقارن fa/ar
  const lang = await resolveRequestLang()
  const res = await fetch(apiBase() + withLangQuery(path, lang), {
    credentials: 'include',
    headers: { 'x-sinshin-lang': lang },
    signal: ssrFetchSignal(), // کار-۳: سقف ۱۰s فقط SSR
  })
  return handleResponse<T>(res)
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiBase() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await langHeaders()) },
    body: JSON.stringify(body),
    credentials: 'include',
    signal: ssrFetchSignal(), // کار-۳
  })
  return handleResponse<T>(res)
}

/** با Authorization + جریانِ نوسازیِ توکن روی 401 + هدرهای اختیاری (phase-3) */
export async function authJson<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  opts?: FetchOpts,
): Promise<T> {
  const token = getAccessToken()
  // ⬅ phase-3: هدرهای سفارشی «قبل از» توکن — authorization همیشه
  // توسط خودِ هلپر ست می‌شود؛ فراخواننده نمی‌تواند آن را بازنویسی کند
  // round-34 — هدر زبان هم قبل از توکن ادغام می‌شود (منبع: کوکی)
  // stage-59 — GETهای احراز-دار هم زبان را در URL می‌برند (کش per-lang)
  const lang = await resolveRequestLang()
  const fetchPath = method === 'GET' ? withLangQuery(path, lang) : path
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-sinshin-lang': lang,
    ...(opts?.headers ?? {}),
  }
  if (token) headers['authorization'] = `Bearer ${token}`

  let res = await fetch(apiBase() + fetchPath, {
    method,
    headers,
    credentials: 'include',
    signal: ssrFetchSignal(), // کار-۳
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      const newToken = getAccessToken()
      if (newToken) headers['authorization'] = `Bearer ${newToken}`
      // همان headers (شامل idempotency-key) — تلاش مجدد امن
      res = await fetch(apiBase() + fetchPath, {
        method,
        headers,
        credentials: 'include',
        signal: ssrFetchSignal(), // کار-۳ — سیگنال تازه برای تلاش مجدد
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } else {
      onUnauthorized()
    }
  }

  return handleResponse<T>(res)
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as {
      error?: { message?: string; code?: string }
    } | null
    // phase-fix: کاربری که وسط نشست VPN روشن کرده — رفرش سخت؛
    // دروازه‌ی SSR دوباره اجرا می‌شود و صفحه‌ی «دسترسی محدود» می‌آید
    if (b?.error?.code === 'GEO_BLOCKED' && typeof window !== 'undefined') {
      window.location.reload()
    }
    // phase-fix: status روی خطا — شرطِ ریترایِ TanStack Query این را می‌خواند؛
    // قبلاً 4xx هم دو بار تلاش مجدد می‌شد (سه برابر بار روی API در خطای اعتبارسنجی)
    throw Object.assign(new Error(b?.error?.message ?? `خطای ${res.status}`), {
      status: res.status,
      code: b?.error?.code,
    })
  }
  // ⬅ بدنه‌ی خالی — 204 یا هیچ:
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}