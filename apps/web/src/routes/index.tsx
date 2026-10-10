// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/routes/index.tsx
// وضعیت: ویرایش فایل موجود (دو تغییر نقطه‌ای)
// تغییر: فونتِ خراب font-da → font-DanaDemiBold + ورود پلکانی هیرو
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-40 — sinshin-food-delivery — فایل 4 از 7
// مسیر مقصد: apps/web/src/routes/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-six
// ═══════════════════════════════════════════════════════════════

import { createFileRoute, Link } from '@tanstack/react-router'
import { Brand } from '#/components/Brand'
import { LangSwitcher } from '#/components/LangSwitcher'
import { ThemeToggle } from '#/components/ThemeToggle'
import { WordSlider } from '#/components/WordSlider'
import { useHydrated } from '#/hooks/useHydrated'
import { I18nProvider, useI18n } from '#/i18n'
import { shouldShowOutdatedBanner } from '#/lib/browserSupport'
import { seoHead } from '#/lib/seo'
import { useAuthStore } from '#/stores/authStore'

export const Route = createFileRoute('/')({
	component: LandingRoute,
	// رارد ۳۸ — سئوی دوزبانه‌ی لندینگ: عنوان/توضیح/og + canonical +
	// هر سه hreflang (fa / ar / x-default) به زبان فعال — بقیه‌ی متادیتای
	// سایت از head ریشه می‌آید (metaByAttribute فرزند برنده است).
	head: seoHead('home'),
	// رارد ۳۱ — رأی بنر مرورگر قدیمی در لودر محاسبه می‌شود تا در خودِ HTML
	// اولیه رندر شود: حتی اگر باندل اپ در موتور قدیمی اصلاً اجرا نشود، کاربر
	// هشدار نارنجی را می‌بیند (خواسته‌ی «هر طور شده»).
	// سمت سرور: UA از هدر درخواست + کوکی بستن؛ سمت کلاینت (ناوبری): navigator.
	// نکته: گارد با document است نه navigator — Bun سمت سرور هم navigator دارد!
	// کرالرها معافند تا اسکرین‌شات نتایج جستجو تمیز بماند (الگوی سئو-۱ geoGate).
	// رارد ۴۰ — شاخه‌ی سرور به ماژول server/ssr-request.ts منتقل شد و گارد
	// از typeof document به import.meta.env.SSR تغییر کرد: گاردِ زمان اجرا در
	// باندل کلاینت می‌ماند و هشدار import-protection می‌داد؛ گارد کامپایل‌تاب
	// در بیلد کلاینت کل شاخه (با درون‌ریزی پویا) را حذف می‌کند (الگوی geoGate).
	beforeLoad: () => {
		if (import.meta.env.SSR) {
			return (async () => {
				const { ssrLandingOldBrowserVote } = await import(
					'#/server/ssr-request'
				)
				return { oldBrowser: ssrLandingOldBrowserVote() }
			})()
		}
		return {
			oldBrowser: shouldShowOutdatedBanner({
				ua: navigator.userAgent,
				dismissed: /(?:^|;\s*)sinshin-obs=1(?:;|$)/.test(document.cookie),
			}),
		}
	},
})

function LandingRoute() {
	const { lang, oldBrowser } = Route.useRouteContext()
	return (
		<I18nProvider initialLang={lang ?? 'fa'}>
			<LandingPage showBanner={oldBrowser ?? false} />
		</I18nProvider>
	)
}

function LandingPage({ showBanner }: { showBanner: boolean }) {
	const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
	const hydrated = useHydrated()
	const showAuthed = hydrated && isAuthenticated
	const { t } = useI18n()

	const sliderWords = [
		t['landing.word1'],
		t['landing.word2'],
		t['landing.word3'],
		t['landing.word4'],
		t['landing.word5'],
		t['landing.word6'],
	]

	return (
		<>
			{/* بنر مرورگر قدیمی — رارد ۳۱. تمام استایل‌ها درون‌خطی با hex ثابت و
          فونت Tahoma: این بنر باید در مرورگری که CSS مدرن سایت (oklch) را
          اصلاً نمی‌فهمد هم درست دیده شود؛ به همین دلیل عمداً هیچ Tailwind
          یا متغیر تم‌ای در آن نیست. display اولیه از رأی سرور می‌آید و
          اسکریپت ES5 در head (canary/نگهبان) می‌تواند روشنش کند.
          react-بستن دکمه هم در همان اسکریپت است تا با مرگ باندل هم کار کند. */}
			<div
				id="old-browser-banner"
				dir="rtl"
				role="alert"
				style={{
					display: showBanner ? 'block' : 'none',
					position: 'relative',
					width: '100%',
					background: '#fff7ed',
					borderBottom: '3px solid #f97316',
					color: '#9a3412',
					fontFamily: 'Tahoma, Arial, sans-serif',
					fontSize: '14px',
					lineHeight: '1.8',
					textAlign: 'center',
					padding: '12px 48px 12px 16px',
					boxSizing: 'border-box',
					zIndex: 60,
				}}
			>
				⚠ {t['banner.text']}
				<button
					id="old-browser-close"
					type="button"
					aria-label={t['banner.close']}
					title={t['banner.close']}
					style={{
						position: 'absolute',
						left: '12px',
						top: '50%',
						transform: 'translateY(-50%)',
						background: 'transparent',
						border: 'none',
						color: '#9a3412',
						fontSize: '22px',
						lineHeight: '1',
						fontWeight: 'bold',
						cursor: 'pointer',
						padding: '4px 10px',
					}}
				>
					×
				</button>
			</div>

			<ThemeToggle className="fixed top-6 left-6 z-50" />
			{/* سوییچر زبان — قرینه‌ی آیکون دارک: دارک گوشه‌ی چپ‌بالا، زبان راست‌بالا.
          همان اندازه‌ی دکمه و همان سایه/بوردر ThemeToggle → قرینگی کامل. */}
			<LangSwitcher className="fixed top-6 right-6 z-50" />

			<div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden bg-white dark:bg-[#1a0a0e] transition-colors duration-500 px-6 py-10">
				<div className="absolute top-0 -right-20 w-72.5 h-62.5 sm:w-150 sm:h-150 sm:-right-40 bg-primary/20 dark:bg-dark-primary/10 rounded-full blur-[100px] pointer-events-none"></div>
				<div className="absolute bottom-0 -left-20 w-62.5 h-62.5 sm:w-150 sm:h-150 sm:-left-40 bg-dark-primary/35 dark:bg-[#4a1a24]/30 rounded-full blur-[100px] pointer-events-none"></div>

				{/* stage-55 — ورود پلکانی هیرو (CSS-only — hero-stagger) */}
				<div className="relative z-10 text-center max-w-4xl mx-auto flex flex-col items-center hero-stagger">
					<Brand />
					<div className="flex items-center mt-[18vh] sm:mt-[13vh] md:mt-[15vh] lg:mt-[22vh] text-2xl sm:text-4xl md:text-5xl max-sm:-mr-5">
						<div className="font-DanaRegular flex items-center">
							<span>{t['landing.sliderPrefix']}</span>
							<WordSlider
								/* stage-55 — فونت تعریف‌نشده font-da → DanaDemiBold */
								className="text-primary dark:text-dark-primary font-DanaDemiBold mt-1 mr-1 sm:mr-1.5"
								words={sliderWords}
							/>
						</div>
					</div>
					<h1 className="font-MorabbaBold text-3xl sm:text-5xl md:text-7xl text-black dark:text-white my-7 leading-tight tracking-tight">
						{t['landing.heroLine1']}
						<br />
						<span className="text-primary dark:text-dark-primary">
							{t['landing.heroLine2']}
						</span>
					</h1>
					<p className="font-DanaRegular text-base sm:text-lg md:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
						{t['landing.sub']}
					</p>
					<div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
						{showAuthed ? (
							<Link
								to="/dashboard"
								className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-base sm:text-lg transition-all duration-300 shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5"
							>
								{t['landing.profile']}
							</Link>
						) : (
							<Link
								to="/login"
								className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-base sm:text-lg transition-all duration-300 shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5"
							>
								{t['landing.auth']}
							</Link>
						)}
						<Link
							to="/products"
							className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-transparent text-gray-800 dark:text-[#f5e0e6] border-2 border-gray-200 dark:border-[#3a151c] font-DanaDemiBold text-base sm:text-lg hover:border-primary dark:hover:border-dark-primary hover:bg-gray-50 dark:hover:bg-[#2a1015] transition-all duration-300"
						>
							{t['landing.products']}
						</Link>
					</div>
				</div>
			</div>
		</>
	)
}