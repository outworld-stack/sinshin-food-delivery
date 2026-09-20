// src/utils/referralCapture.ts
// حلقه‌ی معرفی — مرحله ۱: گرفتن کد از لینک و نگه‌داشتن تا ثبت‌نام

const REF_STORAGE_KEY = 'sinshin-ref'

// گرفتن کد معرف از آدرس (هر صفحه‌ای) و ذخیره‌ی امن — بعدش پارامتر از آدرس پاک می‌شه
export function captureRefFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const ref = params.get('ref')
  if (ref && ref.trim()) {
    const code = ref.trim().toUpperCase().slice(0, 20)
    try { localStorage.setItem(REF_STORAGE_KEY, code) } catch { /* حافظه پر */ }
    // پاک‌سازی آدرس بدون رفرش — کاربر لینک تمیز می‌بینه
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('ref')
      window.history.replaceState({}, '', url.pathname + (url.search || ''))
    } catch { /* نادیده */ }
    return code
  }
  return null
}

// خواندن کد ذخیره‌شده (برای نمایش تو مرحله‌ی ثبت‌نام)
export function getStoredRef(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(REF_STORAGE_KEY) } catch { return null }
}

// پاک کردن بعد از مصرف (ثبت‌نام انجام شد)
export function clearStoredRef(): void {
  try { localStorage.removeItem(REF_STORAGE_KEY) } catch { /* نادیده */ }
}

/** phase-4 — ذخیره‌ی مستقیم کد (روت /r/:code) — همان کلید و نرمال‌سازی */
export function storeReferralCode(raw: string): string {
  const code = raw.trim().toUpperCase().slice(0, 20)
  if (typeof window === 'undefined' || !code) return code
  try { localStorage.setItem(REF_STORAGE_KEY, code) } catch { /* حافظه پر */ }
  return code
}