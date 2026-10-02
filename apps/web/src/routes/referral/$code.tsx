// src/routes/referral/$code.tsx
// ⬅ phase-4: روت اختصاصی معرفی — /r/CODE → ذخیره → /login
// رارد ۳۲ — دوزبانه: این روت ssr:false است (کامل کلاینت)؛ Provider بدون
// initialLang — I18nProvider خودش موقع سوار شدن کوکی sinshin-lang را می‌خواند.
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { storeReferralCode } from '#/utils/referralCapture'
import { I18nProvider, useI18n } from '#/i18n'

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
    <I18nProvider>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a0a0e]">
        <RedirectMessage />
      </div>
    </I18nProvider>
  )
}

function RedirectMessage() {
  const { t } = useI18n()
  return (
    <p className="text-gray-500 dark:text-gray-400 font-DanaMedium">{t['referral.redirecting']}</p>
  )
}