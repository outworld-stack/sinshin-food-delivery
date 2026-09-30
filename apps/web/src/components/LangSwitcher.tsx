// src/components/LangSwitcher.tsx
// رارد ۳۱ — سوییچر زبان fa/ar.
//
// رارد ۳۳ — برچسب «کامل» به‌جای مخفف (خواسته‌ی صریح کاربر):
//   به‌جای «فا» و «ع» حالا «فارسی» و «العربية» نوشته می‌شود — دکمه‌ها از
//   دایره‌ی ثابت ۴۰px به «قرص» (pill) با عرضِ خودکار تبدیل شدند. نام زبان
//   همیشه «بومی» است (فارسی با خط فارسی، العربية با خط عربی) — استانداردِ
//   سوییچرهای زبان و مستقل از زبانِ فعال؛ tooltip همان نامِ ترجمه‌شده است.
//
// «pair» (پیش‌فرض): دو دکمه‌ی قرصی — لندینگ (قرینه‌ی آیکون دارک، گوشه‌ی
//   راست‌بالا)، صفحه‌ی ورود (گوشه‌ی چپ‌بالا) و هدرِ دسکتاپ.
// «single»: فقط زبان مقصد — موبایلِ صفحات داخلی/پنل که عرض هدر محدود است
//   (تصمیم ۳): در فارسی «العربية» را نشان می‌دهد و لمس = تعویض.
import { memo } from 'react'
import { type Lang, useI18n } from '#/i18n'

interface LangSwitcherProps {
	className?: string
	variant?: 'pair' | 'single'
}

/** نام بومی هر زبان — ثابت و ترجمه‌ناپذیر (مثل ویکی‌پدیا) */
const NATIVE_LABEL: Record<Lang, string> = { fa: 'فارسی', ar: 'العربية' }

/** دکمه‌ی واحد — استایل قرینه‌ی ThemeToggle (خنثی) یا فعال (پُر رنگ اصلی) */
function LangButton({
	target,
	active,
	label,
	onClick,
}: {
	target: Lang
	active: boolean
	label: string
	onClick: () => void
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			title={label}
			className={
				active
					? 'flex h-9 sm:h-10 items-center justify-center rounded-full bg-primary dark:bg-dark-primary text-white border border-transparent shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 dark:hover:shadow-dark-primary/20 font-DanaDemiBold text-xs sm:text-sm px-3.5 sm:px-4 whitespace-nowrap cursor-pointer'
					: 'flex h-9 sm:h-10 items-center justify-center rounded-full bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-white/10 shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 dark:hover:shadow-dark-primary/20 text-gray-600 dark:text-gray-300 font-DanaDemiBold text-xs sm:text-sm px-3.5 sm:px-4 whitespace-nowrap cursor-pointer'
			}
		>
			{NATIVE_LABEL[target]}
		</button>
	)
}

export const LangSwitcher = memo(function LangSwitcher({
	className = '',
	variant = 'pair',
}: LangSwitcherProps) {
	const { lang, setLang, t } = useI18n()

	if (variant === 'single') {
		const target: Lang = lang === 'fa' ? 'ar' : 'fa'
		return (
			<LangButton
				target={target}
				active={false}
				label={target === 'fa' ? t['switcher.farsi'] : t['switcher.arabic']}
				onClick={() => setLang(target)}
			/>
		)
	}

	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<LangButton
				target="fa"
				active={lang === 'fa'}
				label={t['switcher.farsi']}
				onClick={() => setLang('fa')}
			/>
			<LangButton
				target="ar"
				active={lang === 'ar'}
				label={t['switcher.arabic']}
				onClick={() => setLang('ar')}
			/>
		</div>
	)
})
