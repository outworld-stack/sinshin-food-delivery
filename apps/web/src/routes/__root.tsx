// ═══════════════════════════════════════════════════════════════
// round-40 — sinshin-food-delivery — فایل 5 از 7
// مسیر مقصد: apps/web/src/routes/__root.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-six
// ═══════════════════════════════════════════════════════════════

import type { QueryClient } from '@tanstack/react-query'
// src/routes/__root.tsx
import {
	createRootRouteWithContext,
	HeadContent,
	redirect,
	Scripts,
	useRouterState,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { Toast } from '#/components/Toast'
import { type Lang, readLangCookie } from '#/i18n'
import { siteHead } from '#/lib/seo'
import { PwaRegister } from '#/pwa/register-sw'
import { useThemeStore } from '#/stores/themeStore'
import appCss from '#/styles.css?url'
import { captureRefFromUrl } from '#/utils/referralCapture'

interface MyRouterContext {
	queryClient: QueryClient
	/** رارد ۳۱ — زبان فعال؛ رارد ۳۸: ?lang= اولویت دارد (برای کرالر/hreflang) */
	lang?: Lang
	/** رارد ۳۱ — فقط لندینگ: رأی بنر مرورگر قدیمی (سرور: UA درخواست) */
	oldBrowser?: boolean
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	beforeLoad: async ({ location }) => {
		// phase-fix: IP خارج از ایران → صفحه‌ی اختصاصی ۴۰۳ (نه 404)؛
		// خودِ صفحه‌ی پیام از بررسی معاف است تا ریدایرکت بی‌نهایت نشود.
		// round-37 — verdict حالا mode هم دارد؛ اگر مسدود شد و حالت
		// «ایران + عراق» بود، پارامتر m می‌رود تا صفحه‌ی مسدود پیام درست
		// («فقط از ایران و عراق»، نه «اگر از ایران هستید…») را نشان دهد.
		if (import.meta.env.SSR && !location.pathname.startsWith('/geo-blocked')) {
			const { getGeoGate } = await import('#/server/geoGate')
			const gate = await getGeoGate()
			if (gate.blocked) {
				throw redirect({
					to: '/geo-blocked',
					search: { m: gate.mode === 'iran-iraq' ? 'iran-iraq' : undefined },
					replace: true,
				})
			}
		}
		// رارد ۳۱ — زبان فعال از کوکی (سمت سرور از هدر درخواست) تا متن‌های SSR
		// از همان بایت اول عربی/فارسیِ درست رندر شوند. مسیرهای ادمین/پیک این
		// مقدار را نادیده می‌گیرند — Provider فقط در لایه‌های ترجمه‌شونده است.
		//
		// رارد ۳۸ — سئوی دوزبانه: اولویتِ جدیدِ «?lang=» بالاتر از کوکی است —
		// کرالر کوکی ندارد و فقط از طریق URL به واریانت عربی می‌رسد (لینک‌های
		// hreflang و sitemap به ?lang=ar اشاره می‌کنند). با آمدن پارامتر، کوکی
		// هم هم‌راستا می‌شود تا ناوبری‌های بعدیِ همان نشست در همان زبان بمانند.
		// سمت کلاینت (ناوبری SPA) کوکی منبع حقیقت است — همان قرارداد رارد ۳۱.
		//
		// رارد ۴۰ — منطق SSR (getRequest/setCookie) به ماژول server/ssr-request.ts
		// منتقل شد: درون‌ریزی پویای مستقیمِ @tanstack/react-start/server در این فایل
		// (که در گراف کلاینت است) هشدار import-protection می‌داد؛ الگوی geoGate
		// (گارد import.meta.env.SSR + درون‌ریزی پویای ماژول محلی) هم هشدار را
		// می‌بندد و هم نشتی به باندل کلاینت را در بیلد تولیدی.
		let lang: Lang = 'fa'
		if (import.meta.env.SSR) {
			const { ssrResolveRootLang } = await import('#/server/ssr-request')
			lang = ssrResolveRootLang()
		} else {
			lang = readLangCookie() ?? 'fa'
		}
		return { lang }
	},
	// رارد ۳۸ — head ریشه حالا تابع است: متادیتای سایت + og + JSON-LD
	// (WebSite + Restaurant) به زبانِ فعال رندر می‌شود. صفحات فرزند
	// عنوان/توضیح/og خودشان را بازنویسی می‌کنند؛ og:image و og:locale و
	// twitter فقط اینجا تعریف می‌شوند. JSON-LD با کلید بومی 'script:ld+json'
	// مستقیم در head می‌نشیند (اسکیپ \u003c ضد گریز — همان jsonLdScript).
	head: (ctx) => ({
		...siteHead(ctx),
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
	// رارد ۳۸ — lang سند از کانتکست مچ ریشه (نتیجه‌ی beforeLoad بالا) —
	// نه هاردکد «fa». کرالری که ?lang=ar را می‌گیرد HTMLی با lang="ar"
	// می‌بیند؛ کلاینت هم بعد از سوییچ LangSwitcher همان مقدار کوکی را
	// می‌خواند (beforeLoad سمت کلاینت کوکی می‌خواند) → رندر دو طرف یکسان.
	const lang = useRouterState({
		select: (s) =>
			((s.matches[0]?.context as { lang?: Lang } | undefined)?.lang ??
				'fa') as Lang,
	})

	useEffect(() => {
		captureRefFromUrl()
			// رارد ۳۱ — علامت «اپ بالا آمد» برای نگهبانِ بنر مرورگر قدیمی:
			// اگر باندل مدرن در موتور قدیمی کرش کند، این خط هرگز اجرا نمی‌شود و
			// اسکریپت ES5 در head بعد از ۶ ثانیه بنر را روشن می‌کند.
			; (window as unknown as { __sinshinBooted?: boolean }).__sinshinBooted = true
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
		<html lang={lang} dir="rtl" suppressHydrationWarning>
			<head>
				<script
					dangerouslySetInnerHTML={{
						__html: `try{var t=localStorage.getItem('sinshin-theme');if(t&&t.indexOf('"isDark":true')!==-1)document.documentElement.classList.add('dark')}catch(e){}`,
					}}
				/>
				{/* رارد ۳۱ — سنجش مرورگر قدیمی، کاملاً ES5 و مستقل از باندل اپ:
            ① پیش‌رنگ: lang سند از کوکی، قبل از اولین پینت (ادمین/پیک همیشه fa)
            ② canary: اگر مرورگر oklch یا سینتکس مدرن JS را نفهمد → بنر لندینگ
            ③ نگهبان: اگر تا ۶ ثانیه اپ بالا نیامده بود «و» canary خراب بود → بنر
            ④ دکمه‌ی بستن: کوکی ۳۰ روزه — بدون هیچ وابستگی به React/Tailwind.
            کلاً کپسوله در try/catch — هرگز صفحه را نمی‌شکند. */}
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: اسکریپت ES5 سنجش مرورگر قدیمی — ثابت و بدون ورودی کاربر
					dangerouslySetInnerHTML={{
						__html: `try{var pl=location.pathname;if(pl.indexOf('/admin')!==0&&pl.indexOf('/courier')!==0){var lm=/(?:^|;\\s*)sinshin-lang=(fa|ar)(?:;|$)/.exec(document.cookie);if(lm)document.documentElement.lang=lm[1]}}catch(e){}try{if(location.pathname==='/'){var dismissed=document.cookie.indexOf('sinshin-obs=1')!==-1;var bad=false;try{bad=!window.CSS||!CSS.supports||!CSS.supports('color','oklch(50% 0 0)')}catch(e){bad=true}if(!bad){try{new Function('({a:1})?.a')}catch(e){bad=true}}var reveal=function(){try{var b=document.getElementById('old-browser-banner');if(b)b.style.display='block'}catch(e){}};var dismiss=function(){try{document.getElementById('old-browser-banner').style.display='none'}catch(e){}try{document.cookie='sinshin-obs=1; path=/; max-age=2592000; samesite=lax'}catch(e){}};var arm=function(){if(bad&&!dismissed)reveal();if(bad&&!dismissed){setTimeout(function(){if(!window.__sinshinBooted)reveal()},6000)}var c=document.getElementById('old-browser-close');if(c)c.onclick=dismiss};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',arm)}else{arm()}}}catch(e){}`,
					}}
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