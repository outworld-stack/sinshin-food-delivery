// src/components/admin/admin2/LiveOrderCard.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { formatPrice, formatDate } from '#/utils/format'
import { Bell, Stickynote, Check, Printer, Phone, Bicycle, Refresh, File } from 'reicon-react'
import type { LiveOrder } from '#/server/admin'
import { StatusBadge } from '#/components/shared/StatusBadge'


interface LiveOrderCardProps {
  order: LiveOrder
  onRequestConfirm: (orderId: string, courierId: string | null, isReassign: boolean) => void  // ⬅️
  onOpenNote: (orderId: string) => void
}


export const LiveOrderCard = memo(function LiveOrderCard({ order, onRequestConfirm, onOpenNote }: LiveOrderCardProps) {
  const hasUnseenNote = order.customerNote && !order.noteSeen
  const isConfirmed = order.status === 'CONFIRMED'
  const isOnTheWay = order.status === 'ON_THE_WAY'

  return (
    <div className={`border rounded-xl p-4 transition-all ${hasUnseenNote
      ? 'border-orange-300 dark:border-orange-500/30 bg-orange-50/50 dark:bg-orange-500/5 animate-pulse'
      : 'border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-[#1a0a0e]'
      }`}>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-right">
        {/* اطلاعات */}
        <div className="flex items-center gap-3">
          <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isConfirmed
            ? 'bg-green-100 dark:bg-green-500/10 text-green-500'
            : isOnTheWay
              ? 'bg-purple-100 dark:bg-purple-500/10 text-purple-500'
              : 'bg-blue-100 dark:bg-blue-500/10 text-blue-500 animate-bounce'
            }`}>
            {isConfirmed || isOnTheWay ? <Check size={22} /> : <Bell size={22} />}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">{order.id}</p>
              <StatusBadge status={order.status} perspective="admin" />
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <span className="text-[11px] text-gray-500">{order.userName}</span>
              <a href={`tel:${order.userPhone}`} className="text-[11px] text-gray-400 hover:text-primary transition flex items-center gap-1" dir="ltr">
                <Phone size={10} /> {order.userPhone}
              </a>
              <span className="text-[11px] text-gray-400">{formatDate(order.date)}</span>
              <span className="font-DanaDemiBold text-primary dark:text-dark-primary text-xs">
                {formatPrice(order.amount)} ت
              </span>
            </div>

            {/* اطلاعات تایید — ادمین، پیک، نکته داخلی */}
            {(order.confirmedByName || order.courierName || order.internalNote) && (
              <div className="mt-2 space-y-1">
                {order.confirmedByName && (
                  <p className="text-[11px] text-gray-500 font-DanaMedium">
                    ثبت‌شده توسط: {order.confirmedByName}
                  </p>
                )}
                {order.courierName && (
                  <p className="text-[11px] text-gray-500 flex items-center gap-1 font-DanaMedium">
                    <Bicycle size={12} />
                    پیک: {order.courierName}
                  </p>
                )}
                {order.internalNote && (
                  <p className="text-[11px] text-blue-500 flex items-center gap-1 font-DanaMedium">
                    <Stickynote size={12} />
                    نکته: {order.internalNote}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* اکشن‌ها */}
        <div className="flex items-center gap-2">
          {/* round-13 — جزئیات و فاکتور: صفحه‌ی مشترک سفارش (آیتم‌ها + چاپ اشپزخانه/فروش) */}
          <Link
            to="/admin/orders/$orderId"
            params={{ orderId: order.id }}
            className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-[#2a1015] text-gray-600 dark:text-gray-300 text-xs font-DanaDemiBold hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center gap-1.5"
            title="جزئیات کامل سفارش + چاپ فاکتور اشپزخانه/فروش"
          >
            <File size={14} />
            جزئیات و فاکتور
          </Link>

          {/* نکته دیده‌نشده → دکمه اجباری */}
          {hasUnseenNote && (
            <button
              type="button"
              onClick={() => onOpenNote(order.id)}
              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-xs font-DanaDemiBold hover:bg-orange-600 transition cursor-pointer flex items-center gap-1.5"
            >
              <Stickynote size={14} />
              مشاهده نکته مشتری
            </button>
          )}

          {/* تایید اولیه — فقط PAID */}
          {order.status === 'PAID' && !hasUnseenNote && (
            <button
              type="button"
              onClick={() => onRequestConfirm(order.id, null, false)}
              className="px-4 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs font-DanaDemiBold hover:opacity-90 transition cursor-pointer flex items-center gap-1.5"
            >
              <Printer size={14} />
              تایید و چاپ
            </button>
          )}

          {/* تغییر پیک — فقط CONFIRMED (قبل رسیدن) */}
          {isConfirmed && (
            <button
              type="button"
              onClick={() => onRequestConfirm(order.id, order.courierId, true)}
              className="px-4 py-2 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs font-DanaDemiBold hover:bg-yellow-500/20 transition cursor-pointer flex items-center gap-1.5"
              title="تا قبل رسیدن پیک به مغازه قابل تغییر است"
            >
              <Refresh size={14} />
              {order.courierId ? 'تغییر پیک' : 'انتخاب پیک'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})