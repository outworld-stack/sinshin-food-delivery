// src/stores/authStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Role } from '@sinshin/shared'

// رارد ۴۷ — union نقش از قرارداد مشترک می‌آید (قبلاً کپی محلی بود)؛
// هنگام زنده‌سازی از localStorage هم پاکسازی می‌شود (مثل sanitizeItems سبد):
// نقشِ خراب/قدیمی = خروج از حساب — گاردهای روت‌ها هرگز مقدار ناشناخته نمی‌بینند.
export type UserRole = Role | null;

/** نقش‌های مجاز انبار — هر چیز دیگر در زنده‌سازی بی‌اعتبار می‌شود */
const KNOWN_ROLES: readonly Role[] = ['user', 'admin', 'admin2']

interface AuthState {
  isAuthenticated: boolean
  isAdmin: boolean
  role: UserRole
  admin2Id: string | null
  activeOrderId: string | null
  login: (isAdmin?: boolean, role?: UserRole, admin2Id?: string | null) => void
  logout: () => void
  setActiveOrderId: (id: string | null) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      isAdmin: false,
      role: null,
      admin2Id: null,
      activeOrderId: null,
      login: (isAdmin = false, role = 'user' as UserRole, admin2Id = null) =>
        set({ isAuthenticated: true, isAdmin, role, admin2Id }),
      logout: () => set({ isAuthenticated: false, isAdmin: false, role: null, admin2Id: null, activeOrderId: null }),
      setActiveOrderId: (id) => set({ activeOrderId: id }),
    }),
    {
      name: 'sinshin-auth',
      skipHydration: true,
      // رارد ۴۷ — پاکسازی هنگام خواندن از انبار: نقش ناشناخته → خروج
      merge: (persisted, current) => {
        const p = persisted as Partial<AuthState> | undefined
        if (p?.role && !KNOWN_ROLES.includes(p.role)) {
          return { ...current }
        }
        return { ...current, ...p }
      },
    }
  )
)

// زنده‌سازی سطح ماژول — سمت کلاینت، هم‌زمان، قبل از هر رندر/روت/گارد
if (typeof window !== 'undefined') {
  useAuthStore.persist.rehydrate()
}

// صبر تا زنده‌سازی — فقط برای گاردهای beforeLoad سمت کلاینت (سرور هرگز لمسش نمی‌کنه)
export function ensureAuthHydrated(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (useAuthStore.persist.hasHydrated()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      unsub()
      resolve()
    })
    if (useAuthStore.persist.hasHydrated()) {
      unsub()
      resolve()
    }
  })
}