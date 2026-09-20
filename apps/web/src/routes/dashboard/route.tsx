import { createFileRoute, redirect } from '@tanstack/react-router'
import { DashboardLayout } from '#/components/DashboardLayout'
import { DashboardLayoutSkeleton } from '#/components/LoadingSkeletons'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { ensureSession } from '#/lib/auth-session'

export const Route = createFileRoute('/dashboard')({
  ssr: false,
  pendingComponent: DashboardLayoutSkeleton,
  beforeLoad: async ({ location }) => {
    await ensureAuthHydrated()
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    await ensureSession()
  },
  component: DashboardLayout,
})