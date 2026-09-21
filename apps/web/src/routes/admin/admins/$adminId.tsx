// src/routes/admin/admins/$adminId.tsx
// ⬅ NEW: رفع باگ رفرش — قبلاً loader مستقیماً دیتا برمی‌گرداند (بدون کش)؛
// یعنی ذخیره‌ی دسترسی‌ها در PermissionsEditor هیچ ریفچی روی همین صفحه‌ی باز
// نمی‌ساخت (snapshot کهنه می‌ماند).
// حالا: loader و کامپوننت یک کش مشترک دارند (subAdminDetailsOptions) =>
// invalidate واقعی + پری‌فچ روی هاورِ کارت ادمین در لیست.
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { memo, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { subAdminDetailsOptions } from '#/utils/queryOptions'
import { SessionRow } from '#/components/admin/admins/SessionRow'
import { PermissionsEditor } from '#/components/admin/admins/PermissionsEditor'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { ShieldCheck, Phone } from 'reicon-react'
import { faNum } from '#/utils/format'

// اسکلتون اختصاصی — pendingComponent لودر
function SubAdminDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-40 rounded-lg bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
      <div className="h-28 rounded-2xl bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-24 rounded-2xl bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
        <div className="h-24 rounded-2xl bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
      </div>
      <div className="h-48 rounded-2xl bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
      <div className="h-56 rounded-2xl bg-gray-200 dark:bg-[#2a1015] animate-pulse" />
    </div>
  )
}

const SubAdminDetailPage = memo(function SubAdminDetailPage() {
  const { adminId } = Route.useParams()

  // ⬅ NEW: اشتراک در کش مشترک با loader (فکتوری مرکزی) —
  // بعد از ذخیره‌ی دسترسی‌ها در PermissionsEditor (invalidate پریفکس)،
  // همین کوئری ریفچ می‌شود و آمار/عنوان صفحه به‌روز می‌ماند
  const { data: admin } = useQuery(subAdminDetailsOptions(adminId))

  // آمار مشتق — ساعات حضور
  // (همیشه صدا زده می‌شود — قبل از هر early-return؛ قانون ترتیب هوک‌ها)
  const sessionStats = useMemo(() => {
    if (!admin) return { activeHours: 0, totalSessions: 0 }
    let activeMinutes = 0
    for (const s of admin.sessions) {
      if (!s.logoutAt) continue
      const mins = (new Date(s.logoutAt).getTime() - new Date(s.loginAt).getTime()) / 60000
      if (s.wasActive) activeMinutes += mins
    }
    return {
      activeHours: Math.round((activeMinutes / 60) * 10) / 10, totalSessions: admin.sessions.length,
    }
  }, [admin])

  if (!admin) {
    // در حال ریفچ بعد از invalidate یا ادمین ناموجود
    return <RouteNotFound />
  }

  return (
    <div className="space-y-6" id="admin-detail-print">
      <Link to="/admin/admins" className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium w-fit cursor-pointer">
        بازگشت به ادمین‌ها
      </Link>

      {/* هدر — اطلاعات غیرقابل ویرایش توسط ادمین۲ */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <span className={`w-14 h-14 rounded-2xl flex items-center justify-center ${admin.isActive ? 'bg-green-100 dark:bg-green-500/10 text-green-500' : 'bg-gray-200 dark:bg-[#2a1015] text-gray-400'
            }`}>
            <ShieldCheck size={28} />
          </span>
          <div>
            <h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">
              {admin.firstName} {admin.lastName}
            </h1>
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-1" dir="ltr">
              <Phone size={12} /> {admin.phone}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">سفارشات تاییدشده</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white">{faNum(admin.ordersConfirmed)}</p>
          </div>
        </div>
      </div>

      {/* آمار حضور — ۲ کارت */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-xs text-gray-400 font-DanaMedium mb-1">ساعات حضور</p>
          <p className="font-MorabbaBold text-xl text-green-500">{faNum(sessionStats.activeHours)} ساعت</p>
        </div>
        <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <p className="text-xs text-gray-400 font-DanaMedium mb-1">کل ورودها</p>
          <p className="font-MorabbaBold text-xl text-gray-800 dark:text-white">{faNum(sessionStats.totalSessions)}</p>
        </div>
      </div>

      {/* ویرایش دسترسی‌ها */}
      <PermissionsEditor key={admin.userId} admin={admin} />

      {/* سشن‌ها — گزارش حضور */}
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
          گزارش حضور
        </h2>
        <div className="space-y-2">
          {admin.sessions.map((s, i) => <SessionRow key={i} session={s} />)}
          {admin.sessions.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">سشنی ثبت نشده</p>
          )}
        </div>
      </div>
    </div>
  )
})


export const Route = createFileRoute('/admin/admins/$adminId')({
  component: SubAdminDetailPage,
    ssr: false,
  // ⬅ NEW: prefetch — هاور روی کارت ادمین در لیست => دیتا در کش؛
  // ناوبری به جزئیات بدون حتی یک اسکلتون.
  // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
  loader: async ({ context, params }) => {
    const admin = await context.queryClient.query(subAdminDetailsOptions(params.adminId))
    if (!admin) throw notFound()
  },

  pendingComponent: SubAdminDetailSkeleton,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  head: () => ({ meta: [{ title: 'جزئیات ادمین | سین شین' }, { name: 'robots', content: 'noindex, nofollow' }] }),
})