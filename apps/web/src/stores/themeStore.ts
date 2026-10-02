// src/stores/themeStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ThemeState {
  isDark: boolean
  toggle: () => void
}

// هلپر — سینک کوکی با استور (سرور می‌خونتش)
function syncCookie(isDark: boolean) {
  if (typeof document !== 'undefined') {
    document.cookie = `sinshin-theme=${isDark ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      toggle: () => set((s) => {
        const next = !s.isDark
        syncCookie(next)  // ⬅️ هر تغییر → کوکی آپدیت
        if (typeof document !== 'undefined') {
          document.documentElement.classList.toggle('dark', next)
        }
        return { isDark: next }
      }),
    }),
    {
      name: 'sinshin-theme',
      skipHydration: true,
      // استور persist هم بمونه (localStorage) — ولی کوکی منبع SSRئه
    }
  )
)


if (typeof window !== 'undefined') {
  useThemeStore.persist.rehydrate()
}