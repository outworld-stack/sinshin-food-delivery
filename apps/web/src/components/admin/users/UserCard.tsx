// ═══════════════════════════════════════════════════════════════
// stage-70 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/users/UserCard.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: ستون «نام دستگاه» — موبایل: برند + مدل (اپل 16 Pro / سامسونگ A55 /
//        شیائومی Redmi Note 10)؛ رایانه: ویندوز/لینوکس/مک؛ ریسپانسیو در همه‌ی سایزها
// ═══════════════════════════════════════════════════════════════

// src/components/admin/users/UserCard.tsx
import { memo, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { formatPrice, formatDate } from '#/utils/format'
import { Can } from '#/components/shared/PermissionGate'
import { Eye, Ban, Check, Shield, Mobile, Monitor } from 'reicon-react'
import type { AdminUserRow } from '@sinshin/shared'

interface UserCardProps {
  user: AdminUserRow
  canToggle: boolean
  onToggle: (id: string, status: string) => void
}

// ── stage-70 — «نام دستگاه»: نمایش دوخطی برند + مدل ──
// سرور رشته‌ی آماده‌ی display را می‌فرستد (user.device) به‌علاوه‌ی ساختار خام؛
// ساختار خام فقط برای آیکنِ نوع دستگاه استفاده می‌شود.
function DeviceCell({ user }: { user: AdminUserRow }) {
  const isDesktop = user.deviceType === 'desktop'
  const isMobile = user.deviceType === 'mobile' || user.deviceType === 'tablet'
  const known = user.device !== '—'
  return (
    <div className="flex items-center gap-2 min-w-0">
      {known && (isDesktop || isMobile) ? (
        isDesktop ? (
          <Monitor size={15} className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden />
        ) : (
          <Mobile size={15} className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden />
        )
      ) : null}
      <div className="min-w-0">
        <p className="font-DanaMedium text-gray-600 dark:text-gray-300 text-sm truncate leading-5" title={user.device}>
          {user.device}
        </p>
        {/* مدل (اگر باشد) خط دوم ریز — مثل «A55» زیر «سامسونگ» */}
        {user.deviceModel && user.deviceModel !== user.device ? (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate leading-4" title={user.deviceModel}>
            {user.deviceModel}
          </p>
        ) : null}
      </div>
    </div>
  )
}

// کارت کاربر — موبایل وسط‌چین + دسکتاپ تک‌ردیف + Can دور اکشن‌ها
export const UserCard = memo(function UserCard({ user, canToggle, onToggle }: UserCardProps) {
  const handleToggle = useCallback(() => onToggle(user.id, user.status), [onToggle, user.id, user.status])

  // stage-10: حساب ادمین اصلی قابل مسدودسازی نیست — آیکون غیرفعال + توضیح
  const isProtectedAdmin = user.role === 'admin'

  const displayName = user.firstName ? `${user.firstName} ${user.lastName || ''}` : 'ناشناس'
  const mobileName = user.firstName ? `${user.firstName}` : 'ناشناس'

  // رارد ۴۸ (اسکن B11) — بلوک اکشن که قبلاً بایت‌به‌بایت دو بار (موبایل/دسکتاپ) تکرار می‌شد
  const Actions = (
    <>
          <Link to="/admin/users/$userId" params={{ userId: user.id }} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a1015] transition cursor-pointer" title="مشاهده جزئیات">
            <Eye size={18} />
          </Link>
          <Can allowed={canToggle}>
            <button
              onClick={handleToggle}
              disabled={isProtectedAdmin}
              title={isProtectedAdmin ? 'حساب ادمین اصلی قابل مسدودسازی نیست' : user.status === 'ACTIVE' ? 'مسدودسازی' : 'فعال‌سازی'}
              aria-label={isProtectedAdmin ? 'ادمین اصلی — محافظت‌شده' : user.status === 'ACTIVE' ? 'مسدودسازی' : 'فعال‌سازی'}
              className={`p-2 rounded-lg transition ${isProtectedAdmin
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                : user.status === 'ACTIVE'
                  ? 'text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer'
                  : 'text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 cursor-pointer'}`}
            >
              {isProtectedAdmin ? <Shield size={18} /> : user.status === 'ACTIVE' ? <Ban size={18} /> : <Check size={18} />}
            </button>
          </Can>
    </>
  )

  return (
    <div className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">

      {/* موبایل/تبلت — وسط‌چین */}
      <div className="lg:hidden grid grid-cols-3 gap-3 text-center w-full items-center">
        <div className="flex flex-col gap-2 items-center justify-center">
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">نام</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white text-xs">{mobileName}</p>
          </div>
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">موبایل</p>
            <p className="font-DanaMedium text-gray-600 dark:text-gray-300 text-xs" dir="ltr">{user.phone}</p>
          </div>
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">تاریخ ثبت‌نام</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{formatDate(user.registeredAt)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 items-center justify-center">
          <div className="flex flex-col items-center min-w-0">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">نام دستگاه</p>
            <DeviceCell user={user} />
          </div>
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">موجودی</p>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white text-xs">{formatPrice(user.walletBalance)}</p>
          </div>
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">مجموع سفارشات</p>
            <p className="font-DanaDemiBold text-primary dark:text-dark-primary text-xs">{formatPrice(user.totalSpent)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 items-center justify-center">
          {Actions}
        </div>
      </div>

      {/* دسکتاپ — تک‌ردیف */}
      <div className="hidden lg:grid lg:grid-cols-6 gap-4 items-center text-right">
        <div className="flex flex-col min-w-0">
          <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm truncate">{displayName}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500" dir="ltr">{user.phone}</p>
        </div>
        <DeviceCell user={user} />
        <div className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{formatPrice(user.walletBalance)} ت</div>
        <div className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">{formatPrice(user.totalSpent)} ت</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{formatDate(user.registeredAt)}</div>
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-start xl:justify-end gap-2">
          {Actions}
        </div>
      </div>

    </div>
  )
})
