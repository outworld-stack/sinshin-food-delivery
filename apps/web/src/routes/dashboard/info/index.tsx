// src/routes/dashboard/info/index.tsx
// ⬅ NEW: loader پری‌فچ + pendingComponent (بقیه مثل قبل)
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { userProfileOptions } from '#/utils/queryOptions'
import { useUserInfoPage } from '#/hooks/dashboard/useUserInfoPage'
import { ProfileForm } from '#/components/dashboard/info/ProfileForm'
import { DevicesSection } from '#/components/dashboard/info/DevicesSection'
import { TermsBox } from '#/components/dashboard/info/TermsBox'
import { UserInfoSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { tpl, useI18n } from '#/i18n'


const UserInfoPage = memo(function UserInfoPage() {
  const { data: user, isLoading } = useQuery(userProfileOptions)
  const { t } = useI18n()

  const page = useUserInfoPage(
    user ? {
      firstName: user.name?.split(' ')[0] ?? null,
      lastName: user.name?.split(' ').slice(1).join(' ') || null,
      email: user.email ?? null,
    } : undefined
  )
  if (isLoading || !user) {
    return <UserInfoSkeleton />
  }

  // stage-59 — چیدمان دوستونه‌ی xl: ستون راست = اطلاعات + دستگاه‌ها (باریک‌تر
  // از قبل)، ستون چپِ خالی = باکس قوانین. موبایل: همه تک‌ستونه و قوانین در انتهای
  // صفحه داخل باکسِ ارتفاع-ثابتِ اسکرول‌شونده (خود TermsBox).
  return (
    <div className="w-full max-w-6xl">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(330px,420px)] gap-8 items-start">
        <div className="space-y-8 max-w-3xl">
          <div>
            <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">{t['dash.nav.info']}</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">{tpl(t['dash.info.userPrefix'], { n: user.phone })}</p>
          </div>

          <ProfileForm
            phone={user.phone}
            state={page.state}
            isPending={page.updateMutation.isPending}
            onFieldChange={page.handleFieldChange}
            onSubmit={page.handleSubmit}
          />

          <DevicesSection devices={user.devices.map(d => ({
            id: d.id,
            deviceName: d.name,
            lastActive: d.lastActiveAt,
            isCurrent: d.current,
            // stage-70 — نوع/برند/مدل برای خط دوم «نام دستگاه»
            deviceType: d.deviceType ?? null,
            deviceBrand: d.deviceBrand ?? null,
            deviceModel: d.deviceModel ?? null,
          }))} />
        </div>

        {/* باکس قوانین — موبایل: انتها؛ xl: ستون چپ */}
        <TermsBox />
      </div>
    </div>
  )
});

export const Route = createFileRoute('/dashboard/info/')({

  ssr: false,
  component: UserInfoPage,

  // ⬅ NEW: پری‌فچ — هاور روی «اطلاعات کاربری» در سایدبار => پروفایل در کش؛
  // ناوبری بدون حتی یک اسکلتون. گارد والد قبل از این loader اجرا شده.
  loader: async ({ context }) => {
    await context.queryClient.query(userProfileOptions)
  },

  pendingComponent: UserInfoSkeleton,
  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'اطلاعات کاربری | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});