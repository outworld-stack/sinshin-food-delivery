const REF_STORAGE_KEY = 'sinshin-ref'

// Keep the latest choice through navigation when storage is blocked or full.
// A cleared value must also override stale disk data after a failed removal.
let memoryRef: string | null | undefined

function normalizeReferralCode(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  return /^[A-Z0-9_-]{3,16}$/.test(code) ? code : null
}

/** Capture query links before login reads the stored referral. */
export function captureRefFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const ref = url.searchParams.get('ref')
  if (ref === null) return null
  const code = storeReferralCode(ref)
  // Preserve TanStack Router's history state and the destination anchor.
  url.searchParams.delete('ref')
  try {
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch { /* Restricted history does not prevent referral capture. */ }
  return code
}

export function getStoredRef(): string | null {
  if (typeof window === 'undefined') return null
  if (memoryRef !== undefined) return memoryRef
  try {
    const stored = localStorage.getItem(REF_STORAGE_KEY)
    return stored === null ? null : normalizeReferralCode(stored)
  } catch { return null }
}

export function clearStoredRef(): void {
  if (typeof window === 'undefined') return
  memoryRef = null
  try { localStorage.removeItem(REF_STORAGE_KEY) } catch { /* Memory remains cleared. */ }
}

/** Invalid or overlong links cannot silently become another person's code. */
export function storeReferralCode(raw: string): string | null {
  const code = normalizeReferralCode(raw)
  if (typeof window === 'undefined') return code
  if (!code) return null
  memoryRef = code
  try { localStorage.setItem(REF_STORAGE_KEY, code) } catch { /* Use memory until reload. */ }
  return code
}
