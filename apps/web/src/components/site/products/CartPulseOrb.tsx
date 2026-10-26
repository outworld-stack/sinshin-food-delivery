// ═══════════════════════════════════════════════════════════════
// stage-100 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/site/products/CartPulseOrb.tsx
// باکس دایره‌ای سبد خرید (صفحه‌ی محصولات):
//   • بعد از کلیک روی دکمه‌ی سبدِ هر محصول ظاهر می‌شود و «تعداد اقلام
//     سبد» را نشان می‌دهد؛ دائمی نیست.
//   • روی محیط دایره، یک خطِ محوشونده به رنگ تم (primary در لایت،
//     dark-primary در دارک) کل محیط را می‌پیماید (conic-gradient چرخان
//     — دنباله‌ی کم‌رنگ‌شونده). پایان پیمایش ⇒ ناپدید شدن باکس.
//   • اگر در میانه‌ی پیمایش محصول دیگری اضافه شود: عدد داخل باکس
//     همان لحظه آپدیت می‌شود و «خط تازه‌ای» از ابتدا محیط را می‌پیماید.
//   • کلیک روی باکس ⇒ هدایت به صفحه‌ی سبد خرید.
// ═══ stage-101 — عیب‌یابی «باکس ظاهر نمی‌شود» ═══
// ریشه: نمایش به «فقط sm و md» (hidden sm:flex lg:hidden) محدود بود — در
// موبایلِ ریز (<۶۴۰px) و دسکتاپِ بزرگ (≥۱۰۲۴px) بنا به خواسته‌ی اولیه
// پنهان بود و کارفرما هرجا تست می‌کرد آن را نمی‌دید. حالا در «همه‌ی
// سایزها» ظاهر می‌شود (چرخ/عدد در موبایل کمی جمع‌وجورتر — w-12 h-12).
// منبع رویداد: cartStore.addTick (رویدادِ «کلیکِ افزودن»، نه مقدار) —
// با partialize ذخیره نمی‌شود؛ رفرش صفحه باکس را برنمی‌گرداند.
// ═══════════════════════════════════════════════════════════════

import { useNavigate } from '@tanstack/react-router'
import { memo, useEffect, useRef, useState } from 'react'
import { tpl, useI18nSafe } from '#/i18n'
import { useCartStore } from '#/stores/cartStore'

/** مدت یک پیمایش کامل خط روی محیط (میلی‌ثانیان) — تعریفِ مشترک CSS/TS:
 *  همان مقدار در styles.css روی --animate-cart-orb-spin تنظیم شده است. */
const ORB_TRAVEL_MS = 3_200
/** انیمیشن ناپدید شدن (فید) */
const ORB_FADE_MS = 180

type OrbPhase = 'hidden' | 'running' | 'fading'

export const CartPulseOrb = memo(function CartPulseOrb() {
	const navigate = useNavigate()
	const totalItems = useCartStore((state) => state.getTotalItems())
	const addTick = useCartStore((state) => state.addTick)
	const { t, fmt } = useI18nSafe()

	const [phase, setPhase] = useState<OrbPhase>('hidden')
	// هر کلیکِ تازه ⇒ کلید تازه ⇒ خط از ابتدا محیط را می‌پیماید
	const [ringKey, setRingKey] = useState(0)
	const travelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastTick = useRef(addTick)

	useEffect(() => {
		// فقط «تغییرِ» tick (کلیک تازه) — نه رندر اولیه
		if (addTick === lastTick.current) return
		lastTick.current = addTick

		if (travelTimer.current) clearTimeout(travelTimer.current)
		if (fadeTimer.current) clearTimeout(fadeTimer.current)

		// عددِ داخل باکس از استور می‌آید و خودکار تازه است
		setRingKey((k) => k + 1)
		setPhase('running')

		// پایان پیمایش خط ⇒ ناپدید شدن (این تایمر منبع حقیقت است؛
		// حتی با prefers-reduced-motion که چرخش را خاموش می‌کند)
		travelTimer.current = setTimeout(() => {
			travelTimer.current = null
			setPhase('fading')
			fadeTimer.current = setTimeout(() => {
				fadeTimer.current = null
				setPhase('hidden')
			}, ORB_FADE_MS)
		}, ORB_TRAVEL_MS)
	}, [addTick])

	// جاروی تایمرها در خروج از صفحه
	useEffect(
		() => () => {
			if (travelTimer.current) clearTimeout(travelTimer.current)
			if (fadeTimer.current) clearTimeout(fadeTimer.current)
		},
		[],
	)

	if (phase === 'hidden') return null

	const fading = phase === 'fading'

	return (
		<button
			type="button"
			onClick={() => {
				if (travelTimer.current) clearTimeout(travelTimer.current)
				if (fadeTimer.current) clearTimeout(fadeTimer.current)
				navigate({ to: '/cart' })
			}}
			aria-label={tpl(t['cart.orbLabel'], { n: fmt.num(totalItems) })}
			title={t['header.cart']}
			// stage-101 — در همه‌ی سایزها دیده می‌شود (قبلاً فقط
			// sm/md بود — عیبِ «ظاهر نمی‌شود» در موبایل/دسکتاپ)
			className={`cart-orb fixed bottom-6 left-6 z-40 flex w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 items-center justify-center rounded-full cursor-pointer transition-opacity transition-transform duration-200 animate-pop-in ${
				fading ? 'opacity-0 scale-75' : 'opacity-100 scale-100'
			}`}
		>
			{/* خطِ محوشونده‌ی متحرک روی محیط — رنگ از CSS تم می‌آید
                            (light: primary / dark: dark-primary) */}
			<span
				key={ringKey}
				aria-hidden="true"
				className={`cart-orb-ring pointer-events-none absolute inset-0 rounded-full ${
					fading ? '' : 'animate-cart-orb-spin'
				}`}
			/>

			{/* مرکز باکس — عدد اقلام سبد */}
			<span
				aria-hidden="true"
				className="cart-orb-center pointer-events-none absolute inset-[3.5px] rounded-full bg-white dark:bg-[#1a0a0e] border border-gray-200 dark:border-white/10 shadow-xl flex items-center justify-center"
			>
				<span className="font-DanaDemiBold text-base md:text-lg text-primary dark:text-dark-primary">
					{fmt.num(totalItems)}
				</span>
			</span>
		</button>
	)
})
