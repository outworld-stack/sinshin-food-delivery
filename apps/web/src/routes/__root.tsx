// src/routes/__root.tsx
import { HeadContent, Scripts, createRootRouteWithContext, redirect } from '@tanstack/react-router'
import { Toast } from '#/components/Toast'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import appCss from '#/styles.css?url'
import type { QueryClient } from '@tanstack/react-query'
import { useThemeStore } from '#/stores/themeStore'
import { useEffect } from 'react'
import { captureRefFromUrl } from '#/utils/referralCapture'
import { PwaRegister } from '#/pwa/register-sw'


interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async ({ location }) => {
    // phase-fix: IP خارج از ایران → صفحه‌ی اختصاصی ۴۰۳ (نه 404)؛
    // خودِ صفحه‌ی پیام از بررسی معاف است تا ریدایرکت بی‌نهایت نشود
    if (import.meta.env.SSR && !location.pathname.startsWith('/geo-blocked')) {
      const { isBlockedByGeo } = await import('#/server/geoGate')
      if (await isBlockedByGeo()) {
        throw redirect({ to: '/geo-blocked', replace: true })
      }
    }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'سین شین | فودپارک آنلاین' },
      { name: 'description', content: 'سفارش آنلاین غذا، پیتزا، فست‌فود و رستوران با تحویل سریع. ثبت‌نام با کد معرف و دریافت کیف پول.' },
      { name: 'keywords', content: 'سین شین, فودپارک, سفارش آنلاین غذا, فست فود, رستوران, پیتزا, کد معرف' },
      { name: 'robots', content: 'index, follow' },
      { name: 'theme-color', content: '#f6339a' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      { name: 'apple-mobile-web-app-title', content: 'سین‌شین' },
      { property: 'og:title', content: 'سین شین | فودپارک آنلاین' },
      { property: 'og:description', content: 'سفارش آنلاین غذا با تحویل سریع در فودپارک سین شین' },
      { property: 'og:type', content: 'website' },
      { property: 'og:locale', content: 'fa_IR' },
      { 'twitter:card': 'summary_large_image' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon-v1.png' },
      { rel: 'icon', href: '/icons/favicon-v1.png' },
    ],
  }),
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    captureRefFromUrl()
    // استورها سطح ماژول زنده شدن — اینجا فقط کلاس تم سینک می‌شه
    const isDark = useThemeStore.getState().isDark
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('sinshin-theme');if(t&&t.indexOf('"isDark":true')!==-1)document.documentElement.classList.add('dark')}catch(e){}` }}
        />
        <HeadContent />
      </head>
      <body>
        <Toast />
        <PwaRegister />
        {children}
        <Scripts />
      </body>
    </html>
  )
}