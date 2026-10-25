import { memo } from 'react'
import { Moon, Sun } from 'reicon-react'
import { useThemeStore } from '#/stores/themeStore'

interface ThemeToggleProps {
	className?: string
}

export const ThemeToggle = memo(function ThemeToggle({
	className = '',
}: ThemeToggleProps) {
	const toggle = useThemeStore((s) => s.toggle)

	return (
		<button
			type="button"
			onClick={toggle}
			// stage-100 — پدینگ موبایل جمع‌تر (p-1.5): فضا برای دکمه‌ی
			// نوتیفیکیشن هدر در 320px؛ از sm به بالا عیناً مانند قبل
			className={`p-1.5 sm:p-2.5 rounded-full bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-white/10 shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 dark:hover:shadow-dark-primary/20 ${className}`}
			aria-label="تغییر تم"
		>
			<Sun
				size={22}
				className="hidden dark:block text-dark-primary h-4.5 w-4.5 sm:h-5.5 sm:w-5.5"
			/>
			<Moon
				size={22}
				className="block dark:hidden text-primary h-4.5 w-4.5 sm:h-5.5 sm:w-5.5"
			/>
		</button>
	)
})
