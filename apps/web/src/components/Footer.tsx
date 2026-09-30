// src/components/Footer.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { Brand } from '#/components/Brand'
import { Instagram, Phone, Pin, Clock } from 'reicon-react'
import { useI18n, tpl } from '#/i18n'

// لینک‌های ثابت بیرون کامپوننت → بدون ری‌رندر مجدد در هر رندر
// (رارد ۳۲ — برچسب‌ها از دیکشنری می‌آیند؛ مسیرها ثابت‌اند)
const ABOUT_LINKS: { key: 'footer.about' | 'footer.gallery' | 'footer.articles'; to: string }[] = [
	{ key: 'footer.about', to: '/about' },
	{ key: 'footer.gallery', to: '/gallery' },
	{ key: 'footer.articles', to: '/articles' },
] as const

// فوتر کاملا استاتیک → memo برای جلوگیری از هر ری‌رندر
export const Footer = memo(function Footer() {
	const { t, fmt } = useI18n()

	return (
		<footer className="bg-white dark:bg-[#1a0a0e] border-t border-gray-200 dark:border-white/10">
			{/* نوار بالایی فوتر */}
			<div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">
					{/* برند و توضیحات */}
					<div className="flex flex-col items-center sm:items-start gap-5">
						<Brand textSize="text-xl" />
						<p className="text-sm text-gray-500 dark:text-gray-400 font-DanaRegular leading-relaxed text-center sm:text-right">
							{t['footer.brandDesc']}
						</p>
					</div>

					{/* ستون درباره ما — مقالات دقیقا زیر درباره ما و گالری */}
					<div className="flex flex-col items-center sm:items-start">
						<h3
							className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-5 relative pb-2
                           after:absolute after:right-0 after:bottom-0 after:w-10 after:h-0.5 after:bg-primary dark:after:bg-dark-primary"
						>
							{t['footer.about']}
						</h3>
						<ul className="space-y-3">
							{ABOUT_LINKS.map((item) => (
								<li key={item.key}>
									{item.to ? (
										<Link
											to={item.to}
											className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium"
										>
											{t[item.key]}
										</Link>
									) : (
										<span className="text-sm text-gray-400 dark:text-gray-500 font-DanaMedium select-none">
											{t[item.key]}
										</span>
									)}
								</li>
							))}
						</ul>
					</div>

					{/* ستون تماس با ما */}
					<div className="flex flex-col items-center sm:items-start lg:col-start-4">
						<h3
							className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-5 relative pb-2
                           after:absolute after:right-0 after:bottom-0 after:w-10 after:h-0.5 after:bg-primary dark:after:bg-dark-primary"
						>
							{t['footer.contact']}
						</h3>
						{/* round-14 — موبایل: w-fit کل بلوک تماس را هم‌عرضِ widest آیتم می‌کند؛
                والد (items-center) بلوک را وسط می‌چیند و آیکون‌های همهٔ ردیف‌ها
                دقیقاً روی یک خط عمودی می‌نشینند (وسط‌چینیِ با نقطهٔ شروعِ ناهم‌راستا نیست) */}
						<ul className="space-y-4 w-fit">
							<li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
								<span className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
									<Pin size={16} />
								</span>
								<h2 className="text-sm font-MorabbaMedium bg-linear-to-l from-sky-500  to-emerald-500 bg-clip-text text-transparent ">
									{t['footer.address']}
								</h2>
							</li>
							<li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
								<a
									href="tel:01344552313"
									dir="ltr"
									className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0 hover:opacity-80 transition"
								>
									<Phone size={16} />
								</a>
								<span dir="ltr">013-44552313</span>
							</li>
							<li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
								<a
									href="https://www.instagram.com/sinshin_foodpark"
									aria-label={t['footer.instagram']}
									className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0 hover:opacity-80 transition"
								>
									<Instagram size={20} />
								</a>
								<span dir="ltr">sinshin_foodpark</span>
							</li>
							<li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
								<span className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
									<Clock size={16} />
								</span>
								<span>{t['footer.hours']}</span>
							</li>
						</ul>
					</div>
				</div>
			</div>

			{/* نوار پایانی کپی‌رایت */}
			<div className="border-t border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#150910]">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
					<p className="text-xs text-gray-400 dark:text-gray-500 font-DanaRegular">
						{tpl(t['footer.rights'], { n: fmt.num(new Date().getFullYear()) })}
					</p>
					<p className="text-xs text-gray-400 dark:text-gray-500 font-DanaRegular">
						{t['footer.madeWith']}
					</p>
				</div>
			</div>
		</footer>
	)
})
