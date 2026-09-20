// src/hooks/useHydrated.ts
import { useEffect, useState } from 'react'

// آیا استورهای persist با localStorage سینک شدن؟
// سرور/اولین paint → false → بعد از mount → true
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    setHydrated(true)
  }, [])
  return hydrated
}