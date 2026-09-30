// src/routes/cart/route.tsx
import { createFileRoute } from '@tanstack/react-router'
import { MainLayout } from '#/components/MainLayout'
import { I18nProvider } from '#/i18n'

// رارد ۳۲ — Provider در ریشه‌ی لایوت همین بخش (الگوی لندینگ/ورود از رارد ۳۱):
// زبان از beforeLoad ریشه (کوکی sinshin-lang) می‌آید و متن SSR از همان بایت
// اول عربی است. ادمین/ادمین₂/پیک هرگز این مسیرها را نمی‌بینند.
function CartLayout() {
  const { lang } = Route.useRouteContext()
  return (
    <I18nProvider initialLang={lang ?? 'fa'}>
      <MainLayout />
    </I18nProvider>
  )
}

export const Route = createFileRoute('/cart')({
  component: CartLayout,
})
