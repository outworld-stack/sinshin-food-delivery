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
import type { Lang } from '#/i18n'


interface MyRouterContext {
  queryClient: QueryClient
  /** رارد ۳۱ — زبان فعال از کوکی sinshin-lang؛ قبل از لود ریشه (همیشه set می‌شود) */
  lang?: Lang
  /** رارد ۳۱ — فقط لندینگ: رأی بنر مرورگر قدیمی (سرور: UA درخواست) */
  oldBrowser?: boolean
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
    // رارد ۳۱ — زبان فعال از کوکی (سمت سرور از هدر درخواست) تا متن‌های SSR
    // از همان بایت اول عربی/فارسیِ درست رندر شوند. مسیرهای ادمین/پیک این
    // مقدار را نادیده می‌گیرند — Provider فقط در لایه‌های ترجمه‌شونده است.
    let lang: Lang = 'fa'
    if (import.meta.env.SSR) {
      const { getRequest } = await import('@tanstack/react-start/server')
      const cookie = getRequest()?.headers.get('cookie') ?? ''
      const m = /(?:^|;\s*)sinshin-lang=(fa|ar)(?:;|$)/.exec(cookie)
      if (m) lang = m[1] as Lang
    }
    return { lang }
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
    // رارد ۳۱ — علامت «اپ بالا آمد» برای نگهبانِ بنر مرورگر قدیمی:
    // اگر باندل مدرن در موتور قدیمی کرش کند، این خط هرگز اجرا نمی‌شود و
    // اسکریپت ES5 در head بعد از ۶ ثانیه بنر را روشن می‌کند.
    ;(window as unknown as { __sinshinBooted?: boolean }).__sinshinBooted = true
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
        {/* رارد ۳۱ — سنجش مرورگر قدیمی، کاملاً ES5 و مستقل از باندل اپ:
            ① پیش‌رنگ: lang سند از کوکی، قبل از اولین پینت (ادمین/پیک همیشه fa)
            ② canary: اگر مرورگر oklch یا سینتکس مدرن JS را نفهمد → بنر لندینگ
            ③ watchdog: اگر تا ۶ ثانیه اپ بالا نیامده بود «و» canary خراب بود → بنر
            ④ دکمه‌ی بستن: کوکی ۳۰ روزه — بدون هیچ وابستگی به React/Tailwind.
            کلاً encapsulated در try/catch — هرگز صفحه را نمی‌شکند. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: اسکریپت ES5 سنجش مرورگر قدیمی — ثابت و بدون ورودی کاربر
          dangerouslySetInnerHTML={{ __html: `try{var pl=location.pathname;if(pl.indexOf('/admin')!==0&&pl.indexOf('/courier')!==0){var lm=/(?:^|;\\s*)sinshin-lang=(fa|ar)(?:;|$)/.exec(document.cookie);if(lm)document.documentElement.lang=lm[1]}}catch(e){}try{if(location.pathname==='/'){var dismissed=document.cookie.indexOf('sinshin-obs=1')!==-1;var bad=false;try{bad=!window.CSS||!CSS.supports||!CSS.supports('color','oklch(50% 0 0)')}catch(e){bad=true}if(!bad){try{new Function('({a:1})?.a')}catch(e){bad=true}}var reveal=function(){try{var b=document.getElementById('old-browser-banner');if(b)b.style.display='block'}catch(e){}};var dismiss=function(){try{document.getElementById('old-browser-banner').style.display='none'}catch(e){}try{document.cookie='sinshin-obs=1; path=/; max-age=2592000; samesite=lax'}catch(e){}};var arm=function(){if(bad&&!dismissed)reveal();if(bad&&!dismissed){setTimeout(function(){if(!window.__sinshinBooted)reveal()},6000)}var c=document.getElementById('old-browser-close');if(c)c.onclick=dismiss};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',arm)}else{arm()}}}catch(e){}` }}
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
