// src/components/shared/RouteFallbacks.tsx
import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { AlertCircle, Home, Refresh, Search } from 'reicon-react'
import { useI18nSafe } from '#/i18n'

// رارد ۳۳ — دوزبانه با useI18nSafe: این پشتیبانها روی «همه‌ی» روت‌ها نشسته‌اند
// (ادمین/ادمین₂/پیک هم) — بیرون از Provider همان فارسیِ قبل را برمی‌گرداند.


export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useI18nSafe()
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center px-4 text-center">
      <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center text-red-500 mb-6">
        <AlertCircle size={40} />
      </div>
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white mb-2">{t['rf.errorTitle']}</h1>
      <p className="text-gray-500 dark:text-gray-400 font-DanaMedium mb-8 max-w-md">
        {import.meta.env.DEV
          ? ((error as Error)?.message || t['rf.errorUnknown'])
          : t['rf.errorDesc']}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="px-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium cursor-pointer hover:opacity-90 transition flex items-center gap-2"
        >
          <Refresh size={18} />
          {t['common.retry']}
        </button>
        <Link
          to="/"
          className="px-6 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition flex items-center gap-2"
        >
          <Home size={18} />
          {t['rf.home']}
        </Link>
      </div>
    </div>
  )
}

// کامپوننت 404 مشترک (notFoundComponent)
export function RouteNotFound() {
  const { t } = useI18nSafe()
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center px-4 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/10 dark:bg-dark-primary/10 flex items-center justify-center text-primary dark:text-dark-primary mb-6">
        <Search size={40} />
      </div>
      <h1 className="font-MorabbaBold text-4xl text-gray-800 dark:text-white mb-2">{t['rf.notFoundCode']}</h1>
      <h2 className="font-DanaDemiBold text-xl text-gray-700 dark:text-gray-300 mb-4">{t['rf.notFoundTitle']}</h2>
      <p className="text-gray-500 dark:text-gray-400 font-DanaMedium mb-8">
        {t['rf.notFoundDesc']}
      </p>
      <Link
        to="/products"
        className="px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer hover:opacity-90 transition"
      >
        {t['rf.goProducts']}
      </Link>
    </div>
  )
}

// ⬅ NEW: اسپینر عمومی — defaultPendingComponent روتر.
// برای روت‌های ساده‌ای که pendingComponent اختصاصی ندارند؛
// روت‌های مهم (products/cart/checkout/...) اسکلتون اختصاصی خودشان را دارند
export function RootPendingFallback() {
  const { t } = useI18nSafe()
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <span className="sr-only">{t['rf.loading']}</span>
      <span
        aria-hidden="true"
        className="w-10 h-10 rounded-full border-4 border-gray-200 dark:border-[#3a151c] border-t-primary dark:border-t-dark-primary animate-spin"
      />
    </div>
  )
}