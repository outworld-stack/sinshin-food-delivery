// src/hooks/useHydrated.ts
import { useEffect, useState } from 'react'

// آیا استورهای persist با localStorage سینک شدن؟
// سرور/اولین رنگ‌آمیزی → false → بعد از سوار شدن → true
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    setHydrated(true)
  }, [])
  return hydrated
}