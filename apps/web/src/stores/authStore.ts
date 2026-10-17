// src/stores/authStore.ts
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Role } from '@sinshin/shared'

// رارد ۴۷ — union نقش از قرارداد مشترک می‌آید (قبلاً کپی محلی بود)؛
// هنگام زنده‌سازی از localStorage هم پاکسازی می‌شود (مثل sanitizeItems سبد):
// نقشِ خراب/قدیمی = خروج از حساب — گاردهای روت‌ها هرگز مقدار ناشناخته نمی‌بینند.
export type UserRole = Role | null;

/** نقش‌های مجاز انبار — هر چیز دیگر در زنده‌سازی بی‌اعتبار می‌شود */
const KNOWN_ROLES: readonly Role[] = ['user', 'admin', 'admin2']

// Storage is optional: privacy settings, quota errors and corrupt JSON must
// not prevent login or leave route guards waiting for hydration forever.
const authStorage = createJSONStorage<AuthState>(() => ({
  getItem: (name: string) => {
    try {
      const value = localStorage.getItem(name)
      if (value !== null) JSON.parse(value)
      return value
    } catch { return null }
  },
  setItem: (name: string, value: string) => {
    try { localStorage.setItem(name, value) } catch { /* in-memory session */ }
  },
  removeItem: (name: string) => {
    try { localStorage.removeItem(name) } catch { /* storage unavailable */ }
  },
}))

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
      storage: authStorage,
      skipHydration: true,
      // رارد ۴۷ — پاکسازی هنگام خواندن از انبار: نقش ناشناخته → خروج
      merge: (persisted, current) => {
        const p = persisted as Partial<AuthState> | undefined
        const authenticated = p?.isAuthenticated === true &&
          typeof p.role === 'string' && KNOWN_ROLES.includes(p.role)
        const role = authenticated ? p?.role ?? null : null
        return {
          ...current,
          isAuthenticated: authenticated,
          role,
          isAdmin: role === 'admin' || role === 'admin2',
          admin2Id: role === 'admin2' && typeof p?.admin2Id === 'string' ? p.admin2Id : null,
          activeOrderId: authenticated && typeof p?.activeOrderId === 'string' ? p.activeOrderId : null,
        }
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
