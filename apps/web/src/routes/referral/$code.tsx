// src/routes/referral/$code.tsx
// ⬅ phase-4: روت اختصاصی معرفی — /r/CODE → ذخیره → /login
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeReferralCode } from '#/utils/referralCapture'

export const Route = createFileRoute('/referral/$code')({
  ssr: false,
  component: ReferralRedirect,
  // سئو-۹: صفحه‌ی ریدایرکت خالی — محتوای نازک؛ ایندکس نشود
  // (هر کد معرف یک URL جدا می‌سازد؛ بدون این، هزاران URL بی‌محتوا)
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
})

function ReferralRedirect() {
  const { code } = Route.useParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (code?.trim()) storeReferralCode(code)
    navigate({ to: '/login', replace: true })
  }, [code, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a0a0e]">
      <p className="text-gray-500 dark:text-gray-400 font-DanaMedium">در حال انتقال به صفحه‌ی ورود…</p>
    </div>
  )
}