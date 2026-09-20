import { createFileRoute, redirect } from '@tanstack/react-router'
import { AdminLayout } from '#/components/AdminLayout'
import { AdminLayoutSkeleton } from '#/components/LoadingSkeletons'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { ensureSession } from '#/lib/auth-session'

const ADMIN2_ALLOWED_PREFIXES = [
  '/admin/admin2',
  '/admin/admin2/dashboard',
  '/admin/orders',
  '/admin/couriers',
  '/admin/products',
  '/admin/users',
  '/admin/settings',
]

export const Route = createFileRoute('/admin')({
  ssr: false,
  pendingComponent: AdminLayoutSkeleton,
  beforeLoad: async ({ location }) => {
    await ensureAuthHydrated()
    const { role } = useAuthStore.getState()

    if (role !== 'admin' && role !== 'admin2') {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    await ensureSession()

    if (role === 'admin' && location.pathname.startsWith('/admin/admin2')) {
      throw redirect({ to: '/admin' })
    }
    if (role === 'admin2' && !ADMIN2_ALLOWED_PREFIXES.some(p => location.pathname.startsWith(p))) {
      throw redirect({ to: '/admin/admin2/live-orders' })
    }
  },
  component: AdminLayout,
})