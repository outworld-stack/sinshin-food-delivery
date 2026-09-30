// src/components/LangSwitcher.tsx
// رارد ۳۱ — سوییچر زبان fa/ar.
//
// «pair» (پیش‌فرض): دو دکمه‌ی گرد «فا» و «ع» — آینه‌ی کاملِ ThemeToggle
//   (همان p-2.5، همان بوردر و سایه و رفتار hover) تا در لندینگ قرینه‌ی
//   آیکون دارک (fixed top-6 left-6) در گوشه‌ی مقابل (top-6 right-6) بنشیند
//   و سایت قرینگی بصری پیدا کند — خواسته‌ی صریح کاربر.
// «single»: فقط زبان مقصد — برای موبایلِ صفحات داخلی/پنل که عرض هدر
//   محدود است (تصمیم ۳): در فارسی «ع» را نشان می‌دهد و لمس = تعویض.
import { memo } from 'react'
import { type Lang, useI18n } from '#/i18n'

interface LangSwitcherProps {
	className?: string
	variant?: 'pair' | 'single'
}

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
					? 'flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-primary dark:bg-dark-primary text-white border border-transparent shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 dark:hover:shadow-dark-primary/20 font-DanaDemiBold text-sm cursor-pointer'
					: 'flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-white/10 shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 dark:hover:shadow-dark-primary/20 text-gray-600 dark:text-gray-300 font-DanaDemiBold text-sm cursor-pointer'
			}
		>
			{target === 'fa' ? 'فا' : 'ع'}
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
