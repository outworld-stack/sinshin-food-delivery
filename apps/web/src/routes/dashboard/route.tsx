//src/routes/dashboard/route.tsx

import { createFileRoute, redirect } from '@tanstack/react-router'
import { DashboardLayout } from '#/components/DashboardLayout'
import { DashboardLayoutSkeleton } from '#/components/LoadingSkeletons'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { ensureSession, hasSession } from '#/lib/auth-session'

export const Route = createFileRoute('/dashboard')({
  ssr: false,
  pendingComponent: DashboardLayoutSkeleton,
  beforeLoad: async ({ location }) => {
    await ensureAuthHydrated()
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    // phase-fix: سشن واقعی قبل از عبور چک می‌شود — قبلاً ensureSession بعد از
    // گارد صدا زده می‌شد؛ استورِ کهنه (isAuthenticated=true + کوکی مرده) از
    // میان می‌گذشت و کاربر وسط داشبورد روی صفحه‌ی خطا گیر می‌کرد.
    await ensureSession()
    if (!hasSession()) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: DashboardLayout,
})