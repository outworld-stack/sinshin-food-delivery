// src/components/shared/PermissionGate.tsx
import { memo, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ShieldOff } from 'reicon-react'
import { useHydrated } from '#/hooks/useHydrated'
import { Skeleton } from '#/components/LoadingSkeletons'

// اسکلتونِ «در حال بررسی» — موقع SSR/اولین رندر (نقش فقط سمت کلاینته)
const CheckingSkeleton = memo(function CheckingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
})

const NoAccess = memo(function NoAccess({ pageName }: { pageName: string }) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4">
      <span className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-500/10 text-red-500 flex items-center justify-center">
        <ShieldOff size={40} />
      </span>
      <h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">دسترسی ندارید</h1>
      <p className="text-gray-500 dark:text-gray-400 font-DanaMedium text-center max-w-sm">
        شما اجازه مشاهده {pageName} را ندارید. برای دریافت دسترسی با مدیر اصلی تماس بگیرید.
      </p>
      <Link to="/admin/admin2/dashboard" className="px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer">
        بازگشت به پنل
      </Link>
    </div>
  )
})

interface PermissionGateProps {
  hasAccess: boolean
  pageName: string
  children?: ReactNode
  /** دسترسی در حال بررسی از سرور (سشن ادمین۲) */
  isChecking?: boolean
}

export const PermissionGate = memo(function PermissionGate({
  hasAccess, pageName, children, isChecking,
}: PermissionGateProps) {
  const hydrated = useHydrated()

  // نقش/دسترسی هنوز نامعلوم (SSR یا سشن در لود) → اسکلتون، نه «دسترسی ندارید»
  if (!hydrated || isChecking) return <CheckingSkeleton />
  if (!hasAccess) return <NoAccess pageName={pageName} />
  return <>{children ?? null}</>
})

// gate render — مخفی/نمایش بخش‌های کوچک (دکمه‌ها)
export const Can = memo(function Can({
  allowed, children,
}: {
  allowed: boolean
  children?: ReactNode
}) {
  const hydrated = useHydrated()
  // تا قبل از هیدریشن تصمیمی نمی‌گیریم — بدون mismatch با SSR
  if (!hydrated) return null
  return allowed ? <>{children}</> : null
})