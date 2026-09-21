// src/components/admin/users/UserCard.tsx
import { memo, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { formatPrice, formatDate } from '#/utils/format'
import { Can } from '#/components/shared/PermissionGate'
import { Eye, Ban, Check, Shield } from 'reicon-react'

interface UserCardProps {
  user: {
    id: string
    firstName?: string | null
    lastName?: string | null
    phone: string
    device: string
    status: string
    walletBalance: number
    totalSpent: number
    registeredAt: Date
    /** stage-10: 'admin' → آیکون مسدودسازی disable (حساب ادمین اصلی محافظت‌شده) */
    role?: string
  }
  canToggle: boolean
  onToggle: (id: string, status: string) => void
}

// کارت کاربر — موبایل وسط‌چین + دسکتاپ تک‌ردیف + Can دور اکشن‌ها
export const UserCard = memo(function UserCard({ user, canToggle, onToggle }: UserCardProps) {
  const handleToggle = useCallback(() => onToggle(user.id, user.status), [onToggle, user.id, user.status])

  // stage-10: حساب ادمین اصلی قابل مسدودسازی نیست — آیکون disable + توضیح
  const isProtectedAdmin = user.role === 'admin'

  const displayName = user.firstName ? `${user.firstName} ${user.lastName || ''}` : 'ناشناس'
  const mobileName = user.firstName ? `${user.firstName}` : 'ناشناس'

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
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-gray-400 font-DanaMedium mb-0.5">دستگاه</p>
            <p className="font-DanaMedium text-gray-600 dark:text-gray-300 text-xs">{user.device}</p>
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
        </div>
      </div>

      {/* دسکتاپ — تک‌ردیف */}
      <div className="hidden lg:grid lg:grid-cols-6 gap-4 items-center text-right">
        <div className="flex flex-col">
          <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{displayName}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500" dir="ltr">{user.phone}</p>
        </div>
        <div className="font-DanaMedium text-gray-600 dark:text-gray-300 text-sm">{user.device}</div>
        <div className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">{formatPrice(user.walletBalance)} ت</div>
        <div className="font-DanaDemiBold text-primary dark:text-dark-primary text-sm">{formatPrice(user.totalSpent)} ت</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{formatDate(user.registeredAt)}</div>
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-start xl:justify-end gap-2">
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
        </div>
      </div>

    </div>
  )
})