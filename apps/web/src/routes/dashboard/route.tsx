//src/routes/dashboard/route.tsx

import { createFileRoute, redirect } from '@tanstack/react-router'
import { DashboardLayout } from '#/components/DashboardLayout'
import { DashboardLayoutSkeleton } from '#/components/LoadingSkeletons'
import { useAuthStore, ensureAuthHydrated } from '#/stores/authStore'
import { ensureSession, hasSession } from '#/lib/auth-session'
import { I18nProvider } from '#/i18n'

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
  // رارد ۳۳ — پنل کاربر دوزبانه شد: Provider در ریشه‌ی همین لایوت می‌نشیند
  // (الگوی لندینگ/ورود از رارد ۳۱ و سایت از رارد ۳۲). زبان از beforeLoad
  // ریشه می‌آید (کوکی sinshin-lang)؛ ادمین/ادمین₂/پیک Provider ندارند و
  // فارسیِ خالص می‌مانند — همان تصمیم ۱ کاربر.
  component: function DashboardShell() {
    const { lang } = Route.useRouteContext()
    return (
      <I18nProvider initialLang={lang ?? 'fa'}>
        <DashboardLayout />
      </I18nProvider>
    )
  },
})
