// src/routes/dashboard/info/index.tsx
// ⬅ NEW: loader پری‌فچ + pendingComponent (بقیه مثل قبل)
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { userProfileOptions } from '#/utils/queryOptions'
import { useUserInfoPage } from '#/hooks/dashboard/useUserInfoPage'
import { ProfileForm } from '#/components/dashboard/info/ProfileForm'
import { DevicesSection } from '#/components/dashboard/info/DevicesSection'
import { UserInfoSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'


const UserInfoPage = memo(function UserInfoPage() {
  const { data: user, isLoading } = useQuery(userProfileOptions)

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

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">اطلاعات کاربری</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">کاربر {user.phone}</p>
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
      }))} />    </div>
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