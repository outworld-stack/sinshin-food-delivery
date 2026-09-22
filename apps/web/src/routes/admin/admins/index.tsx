// src/routes/admin/admins/index.tsx
// ⬅ NEW: کوئری از فکتوری مرکزی (subAdminsOptions) + loader پری‌فچ روی هاور
// + toggle اپتیمیستیک با rollback + pendingComponent/errorComponent + head noindex
import { createFileRoute, Link } from '@tanstack/react-router'
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toggleSubAdmin, type SubAdminRecord } from '#/server/admin'
import { AddAdminModal } from '#/components/admin/admins/AddAdminModal'
import { ConfirmModal } from '#/components/ConfirmModal'
import { useToastStore } from '#/stores/toastStore'
import { formatDate, faNum } from '#/utils/format'
import { subAdminsOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { Plus, ShieldCheck, ShieldOff, Phone, ChevronLeft } from 'reicon-react'
import { AdminsPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'



const AdminsPage = memo(function AdminsPage() {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [confirmToggle, setConfirmToggle] = useState<string | null>(null)

  // ⬅ NEW: کوئری — فکتوری مرکزی؛ همان کلیدی که loader روت با query
  // پر کرده => هاور روی «ادمین‌ها» در سایدبار، ناوبری را آنی می‌کند
  const { data: admins, isLoading } = useQuery(subAdminsOptions)

  // ⬅ NEW: toggle اپتیمیستیک با rollback
  // قبلاً: تایید → انتظار سرور → invalidate → رفرش.
  // حالا: تایید → همان لحظه آیکن/رنگ کارت فلیپ می‌شود → سرور تأیید می‌کند؛
  // اگر خطا شد، snapshot برمی‌گردد (و MutationCache سراسری toast می‌دهد)
  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleSubAdmin(id),
    onMutate: async (id) => {
      // ریفچ در جریان را متوقف کن تا snapshot تمیز باشد
      await queryClient.cancelQueries({ queryKey: qk.subAdmins })
      const previous = queryClient.getQueryData<SubAdminRecord[]>(qk.subAdmins)

      // فلیپ اپتیمیستیک isActive
      queryClient.setQueryData<SubAdminRecord[]>(qk.subAdmins, (old) =>
        old ? old.map(a => (a.userId === id ? { ...a, isActive: !a.isActive } : a)) : old)

      return { previous }
    },
    onError: (_err, _id, ctx) => {
      // rollback — کش به snapshot قبل از کلیک برمی‌گردد
      if (ctx?.previous) queryClient.setQueryData(qk.subAdmins, ctx.previous)
    },
    onSuccess: () => {
      showToast('وضعیت دسترسی ادمین تغییر کرد')
      setConfirmToggle(null)
    },
    onSettled: () => {
      // در هر صورت (موفق/ناموفق) با سرور هم‌تراز شو — منبع حقیقت
      queryClient.invalidateQueries({ queryKey: qk.subAdmins })
    },
  })

  const handleOpenAdd = useCallback(() => setIsAddModalOpen(true), [])
  const handleCloseAdd = useCallback(() => setIsAddModalOpen(false), [])
  const handleRequestToggle = useCallback((id: string) => setConfirmToggle(id), [])
  const handleCancelToggle = useCallback(() => setConfirmToggle(null), [])
  const handleConfirmToggle = useCallback(() => {
    if (confirmToggle) toggleMutation.mutate(confirmToggle)
  }, [confirmToggle, toggleMutation])


  if (isLoading) {
    return <AdminsPageSkeleton />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">مدیریت ادمین‌ها</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
            مدیریت دسترسی ادمین‌های سطح ۲ رستوران
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center gap-2 justify-center"
        >
          <Plus size={16} />
          افزودن ادمین سطح ۲
        </button>
      </div>

      <div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-4" id="admins-list-area">
        {(admins ?? []).length > 0 ? (
          (admins!).map((admin) => (
            <div key={admin.userId} className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">
              {/* هدر — لینک به صفحه جزئیات */}
              <Link
                to="/admin/admins/$adminId"
                params={{ adminId: admin.userId }}
                className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-right pb-3 border-b border-gray-200 dark:border-white/5 hover:border-primary dark:hover:border-dark-primary transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${admin.isActive
                    ? 'bg-green-100 dark:bg-green-500/10 text-green-500'
                    : 'bg-gray-200 dark:bg-[#2a1015] text-gray-400'
                    }`}>
                    {admin.isActive ? <ShieldCheck size={24} /> : <ShieldOff size={24} />}
                  </span>
                  <div>
                    <p className="font-DanaDemiBold text-gray-800 dark:text-white flex items-center gap-1.5">
                      {admin.firstName} {admin.lastName}
                      <ChevronLeft size={14} className="text-gray-400" />
                    </p>
                    <p className="text-xs text-gray-400 flex items-center gap-1 justify-center sm:justify-start" dir="ltr">
                      <Phone size={12} />
                      {admin.phone}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">سفارشات تاییدشده</p>
                    <p className="font-DanaDemiBold text-gray-800 dark:text-white">
                      {faNum(admin.ordersConfirmed)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">آخرین فعالیت</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
                      {/* stage-15 — ادمینِ لاگین‌نکرده null است، نه تاریخ غلط */}
                      {admin.lastActivity ? formatDate(admin.lastActivity) : '—'}
                    </p>
                  </div>
                </div>
              </Link>

              {/* اکشن روی کارت — جدا از لینک */}
              <div className="flex justify-end pt-3">
                <button
                  type="button"
                  onClick={() => handleRequestToggle(admin.userId)}
                  className={`p-2 rounded-lg transition cursor-pointer ${admin.isActive
                    ? 'text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
                    : 'text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10'
                    }`}
                  title={admin.isActive ? 'غیرفعال‌سازی دسترسی' : 'فعال‌سازی دسترسی'}
                >
                  {admin.isActive ? <ShieldOff size={18} /> : <ShieldCheck size={18} />}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-16 text-gray-400 font-DanaMedium">ادمینی ثبت نشده است.</div>
        )}
      </div>

      {isAddModalOpen && <AddAdminModal onClose={handleCloseAdd} />}

      <ConfirmModal
        isOpen={!!confirmToggle}
        title="تغییر دسترسی ادمین"
        message="آیا از تغییر وضعیت دسترسی این ادمین مطمئن هستید؟"
        onConfirm={handleConfirmToggle}
        onCancel={handleCancelToggle}
      />
    </div>
  )
})

export const Route = createFileRoute('/admin/admins/')({
  ssr: false,
  // ⬅ NEW: prefetch — هاور روی لینک «ادمین‌ها» در سایدبار => این loader در کلاینت
  // اجرا و کوئری در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
  loader: async ({ context }) => {
    await context.queryClient.query(subAdminsOptions)
  },

  component: AdminsPage,
  pendingComponent: AdminsPageSkeleton,
  errorComponent: RouteError,

  head: () => ({
    meta: [
      { title: 'مدیریت ادمین‌ها | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})