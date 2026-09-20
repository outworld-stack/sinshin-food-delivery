// src/hooks/shared/useAuthHydrated.ts
import { useEffect, useState } from 'react'
import { useAuthStore } from '#/stores/authStore'

// آیا استور احراز هویت واقعاً زنده شده؟ — سیگنال خودِ persist، در هر زمان‌بندی
export function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated())

  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true))
    if (useAuthStore.persist.hasHydrated()) setHydrated(true)
    return unsub
  }, [])

  return hydrated
}