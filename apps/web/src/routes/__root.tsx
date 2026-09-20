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
import { SITE_URL, DEFAULT_OG_IMAGE, jsonLdScript } from '#/lib/site'


interface MyRouterContext {
  queryClient: QueryClient
}

// سئو-۴: JSON-LD سطح سایت — WebSite + Restaurant (rich results)
// در head رندر می‌شود (SSR) و برای کرالرها بدون اجرای JS قابل خواندن است.
// jsonLdScript: < به \u003c اسکیپ می‌کند تا تزریق «</script>» ناممکن شود.
const SITE_JSON_LD = jsonLdScript({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'سین‌شین فودپارک',
      inLanguage: 'fa-IR',
    },
    {
      '@type': 'Restaurant',
      '@id': `${SITE_URL}/#restaurant`,
      name: 'سین‌شین',
      url: SITE_URL,
      logo: `${SITE_URL}/icons/icon-512-v1.png`,
      image: DEFAULT_OG_IMAGE,
      telephone: '+982112345678',
      servesCuisine: ['فست‌فود', 'پیتزا', 'کباب', 'سوخاری', 'پاستا'],
    },
  ],
})

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
      // سئو-۵: تصویر پیش‌فرض پیش‌نمایش لینک (تلگرام/واتساپ/توییتر/دیسکورد)
      { property: 'og:site_name', content: 'سین‌شین فودپارک' },
      { property: 'og:image', content: DEFAULT_OG_IMAGE },
      { property: 'og:image:width', content: '1155' },
      { property: 'og:image:height', content: '1155' },
      { property: 'og:image:alt', content: 'سین‌شین فودپارک — سفارش آنلاین غذا' },
      { 'twitter:card': 'summary_large_image' },
      { 'twitter:image': DEFAULT_OG_IMAGE },
      { 'twitter:image:alt': 'سین‌شین فودپارک — سفارش آنلاین غذا' },
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
    // استورها سطح ماژول زنده شدن — اینجا کلاس تم و theme-color سینک می‌شن.
    // pwa-۴: theme-color هم با «تم دستی» هم‌گام می‌شود (نه فقط سیستم‌عامل) —
    // نوار مرورگر/وضعیت اپ نصب‌شده در دارک‌مود هم‌رنگِ اپ می‌ماند.
    const syncTheme = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark)
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', isDark ? '#1a0a0e' : '#f6339a')
    }
    syncTheme(useThemeStore.getState().isDark)
    const unsubscribe = useThemeStore.subscribe((s) => syncTheme(s.isDark))
    return () => unsubscribe()
  }, [])

  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('sinshin-theme');if(t&&t.indexOf('"isDark":true')!==-1)document.documentElement.classList.add('dark')}catch(e){}` }}
        />
        <HeadContent />
        {/* سئو-۴: داده‌ی ساختاریافته‌ی سایت — Google آن را در head یا body می‌پذیرد */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD با اسکیپ < — نه HTML، فقط داده */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: SITE_JSON_LD }} />
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
