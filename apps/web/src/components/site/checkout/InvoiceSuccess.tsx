// src/components/site/checkout/InvoiceSuccess.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Receipt } from 'reicon-react'
import { formatPrice } from '#/utils/format'
import type { InvoiceData } from '#/types/site/checkout'

interface InvoiceSuccessProps {
  invoice: InvoiceData
  isRestaurantClosed?: boolean       // ← جدید
  nextOpenTime?: string
}

export const InvoiceSuccess = memo(function InvoiceSuccess({ invoice, isRestaurantClosed, nextOpenTime }: InvoiceSuccessProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white dark:bg-[#2a1015] p-8 rounded-3xl border border-green-200 dark:border-green-500/20 shadow-sm text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-green-100 dark:bg-green-500/10 flex items-center justify-center text-green-500 mb-6">
          <Check size={40} />
        </div>
        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white mb-2">سفارش شما ثبت شد!</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8 font-DanaMedium">
          {invoice.deliveryType === 'DELIVERY'
            ? 'سفارش شما در انتظار تایید ادمین برای ارسال پیک می‌باشد.'
            : 'محصولات زیر برای تحویل حضوری آماده می‌شوند.'}
        </p>
        {isRestaurantClosed && (
          <div className="mb-6 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
            <p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium">
              سفارش شما در صف قرار گرفت و در اولین فرصت بعد از ({nextOpenTime}) پردازش می‌شود.
            </p>
          </div>
        )}

        <div className="text-right space-y-3 mb-6 bg-gray-50 dark:bg-[#1a0a0e] p-4 rounded-xl border border-gray-200 dark:border-white/5">
          <p className="text-sm text-gray-400 font-DanaMedium flex items-center gap-2">
            <Receipt size={16} />
            شماره سفارش: <span className="font-DanaDemiBold text-gray-800 dark:text-white">{invoice.orderId}</span>
          </p>
          {invoice.items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm border-t border-gray-200 dark:border-white/5 pt-3 mt-3">
              <span className="font-DanaMedium text-gray-700 dark:text-gray-200">
                {item.name}{item.sizeName ? <span className="text-primary dark:text-dark-primary"> ({item.sizeName})</span> : null} ({item.quantity.toLocaleString('fa-IR')} عدد)
              </span>
              <span className="font-DanaDemiBold text-gray-800 dark:text-white">{formatPrice(item.price * item.quantity)} ت</span>
            </div>
          ))}

          <div className="space-y-2 pt-3 mt-3 border-t border-gray-200 dark:border-white/5">
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm text-green-500"><span>تخفیف</span><span>- {formatPrice(invoice.discount)} ت</span></div>
            )}
            {invoice.walletDeduction > 0 && (
              <div className="flex justify-between text-sm text-blue-500"><span>پرداخت از کیف پول</span><span>{formatPrice(invoice.walletDeduction)} ت</span></div>
            )}
            <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
              <span>هزینه ارسال</span>
              <span>{invoice.deliveryType === 'DELIVERY' ? `${formatPrice(invoice.deliveryFee)} ت` : 'رایگان'}</span>
            </div>
            <div className="flex justify-between font-DanaDemiBold text-gray-800 dark:text-white pt-2 border-t border-gray-200 dark:border-white/5">
              <span>مبلغ کل</span><span>{formatPrice(invoice.totalAmount)} ت</span>
            </div>
            <div className="flex justify-between bg-primary dark:bg-dark-primary text-white p-3 rounded-lg mt-2">
              <span className="font-DanaMedium text-sm">پرداخت آنلاین:</span>
              <span className="font-MorabbaBold text-lg">{formatPrice(invoice.amountPaidOnline)} تومان</span>
            </div>
          </div>
        </div>

        {invoice.customerNote && (
          <div className="text-right p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-dashed border-gray-300 dark:border-white/10 mb-6">
            <p className="text-xs text-gray-400 font-DanaMedium mb-1">یادداشت شما:</p>
            <p className="text-sm text-gray-600 dark:text-gray-300 font-DanaMedium">{invoice.customerNote}</p>
          </div>
        )}

        <Link
          to="/dashboard/orders/$orderId"
          params={{ orderId: invoice.orderId }}
          className="inline-block px-8 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer"
        >
          مشاهده در صفحه سفارش
        </Link>
      </div>
    </div>
  )
})