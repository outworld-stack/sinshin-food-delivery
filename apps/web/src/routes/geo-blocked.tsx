// src/routes/geo-blocked.tsx
// ⬅ phase-fix — صفحه‌ی اختصاصی «دسترسی محدود» (IP خارج از ایران).
// وقتی کلید «فقط ایران» روشن باشد، دروازه‌ی SSR کاربر خارجی را به همین
// صفحه می‌فرستد (به‌جای 404 گیج‌کننده). خودِ این روت از بررسی جغرافیایی
// معاف است تا ریدایرکت بی‌نهایت نشود.
// رارد ۳۲ — دوزبانه: Provider در ریشه‌ی همین صفحه (الگوی لندینگ/ورود)؛
// زبان از کوکی sinshin-lang در beforeLoad ریشه می‌آید.
import { createFileRoute } from '@tanstack/react-router'
import { ShieldOff, Refresh } from 'reicon-react'
import { I18nProvider, useI18n } from '#/i18n'

export const Route = createFileRoute('/geo-blocked')({
  head: () => ({
    meta: [
      { title: 'دسترسی محدود | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: GeoBlockedRoute,
})

function GeoBlockedRoute() {
  const { lang } = Route.useRouteContext()
  return (
    <I18nProvider initialLang={lang ?? 'fa'}>
      <GeoBlockedPage />
    </I18nProvider>
  )
}

function GeoBlockedPage() {
  const { t } = useI18n()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center bg-gray-50 dark:bg-[#1a0a0e]">
      <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center text-amber-500 mb-6">
        <ShieldOff size={40} />
      </div>
      <h1 className="font-MorabbaBold text-4xl text-gray-800 dark:text-white mb-2">{t['geo.code']}</h1>
      <h2 className="font-DanaDemiBold text-xl text-gray-700 dark:text-gray-300 mb-4">
        {t['geo.title']}
      </h2>
      <p className="text-gray-500 dark:text-gray-400 font-DanaMedium mb-8 max-w-md leading-7">
        {t['geo.message']}
      </p>
      <button
        type="button"
        onClick={() => window.location.assign('/')}
        className="px-6 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium cursor-pointer hover:opacity-90 transition flex items-center gap-2"
      >
        <Refresh size={18} />
        {t['geo.refresh']}
      </button>
    </div>
  )
}
