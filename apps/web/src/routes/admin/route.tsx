import { createFileRoute, redirect } from '@tanstack/react-router'
import { AdminLayout } from '#/components/AdminLayout'
import { AdminLayoutSkeleton } from '#/components/LoadingSkeletons'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { ensureSession } from '#/lib/auth-session'
import { isAdminPathAllowed } from '#/utils/adminAccess'

export const Route = createFileRoute('/admin')({
        ssr: false,
        pendingComponent: AdminLayoutSkeleton,
        beforeLoad: async ({ location }) => {
                await ensureAuthHydrated()
                await ensureSession()
                const { role } = useAuthStore.getState()

                if (role !== 'admin' && role !== 'admin2') {
                        throw redirect({ to: '/login', search: { redirect: location.href } })
                }
                // round-13 — ادمین اصلی به «پنل سفارشات زنده» هم دسترسی دارد (تایید/
                // تخصیص/تغییر پیک مثل ادمین۲)؛ بقیه‌ی صفحات ادمین۲ (داشبورد شخصی) مالِ او نیست.
                if (!isAdminPathAllowed(role, location.pathname)) {
                        throw redirect({ to: role === 'admin' ? '/admin' : '/admin/admin2/live-orders' })
                }
        },
        component: AdminLayout,
})
