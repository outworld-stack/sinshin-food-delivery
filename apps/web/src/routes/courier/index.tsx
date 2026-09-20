// src/routes/courier/index.tsx
// ⬅ phase-5: روت ایندکس پیک — قبلاً /courier وجود نداشت → لاگین به ۴۰۴ می‌رفت
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Bicycle, Logout4 } from 'reicon-react'
import { getCourierToken, clearCourierToken } from '#/utils/courierSession'

export const Route = createFileRoute('/courier/')({
  ssr: false,
  component: CourierHomePage,
})

function CourierHomePage() {
  const navigate = useNavigate()
  const [token] = useState(() => getCourierToken())

  useEffect(() => {
    if (!token) navigate({ to: '/courier/login', replace: true })
  }, [token, navigate])

  if (!token) return null

  const handleLogout = () => {
    clearCourierToken()
    navigate({ to: '/courier/login', replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1a0a0e] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#2a1015] p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-[#3a151c] w-full max-w-md space-y-6 text-center">
        <span className="w-16 h-16 rounded-2xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center mx-auto">
          <Bicycle size={32} />
        </span>
        <div>
          <h1 className="font-MorabbaBold text-2xl text-gray-900 dark:text-white">پیک سین‌شین</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mt-2">
            نشست شما فعال است (حداکثر ۱ ساعت)
          </p>
        </div>
        <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c]">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed">
            برای شروع تحویل، کد QR سفارش را از پنل رستوران اسکن کنید — یا لینک اسکن سفارش را باز کنید.
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-2"
        >
          <Logout4 size={16} />
          خروج از حساب پیک
        </button>
      </div>
    </div>
  )
}