// src/components/site/article/ArticleBlocksRenderer.tsx
// ═══════════════════════════════════════════════════════════════
// stage-82 — رندرِ عمومیِ سندِ بلوکی مقاله (سمت سایت).
//
// طراحیِ رندر (تحقیقِ استیج — REFERENCE ۲-۱۰-۱۴):
//  · جدا از ادیتور (الگوی Puck): همان JSON، دو مصرف‌کننده
//  · انیمیشن: یک IntersectionObserver مشترک (نه per-block) + کلاسِ
//    `ab-js` فقط بعد از mount → SSR/سئو متنِ کاملاً مرئی می‌فرستد؛
//    مخفی‌سازیِ اولیه فقط با JS فعال می‌شود و `once` است (AOS)
//  · prefers-reduced-motion → همه‌چیز مرئی و بی‌حرکت (MDN/C39)
//  · عرضِ پله‌ای (Ghost): sm/md/lg/full + موبایل همه full
//  · رنگ: hex ذخیره‌شده + متنِ خودکار با luminance WCAG
//  · defensive: بلوکِ ناشناخته/خراب skip می‌شود، نه کرشِ صفحه
// ═══════════════════════════════════════════════════════════════

import {
	type ArticleBlock,
	type ArticleBlocksDoc,
	pickContrastText,
} from '@sinshin/shared'

import { Link } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

const cx = (...parts: Array<string | false | undefined>): string =>
	parts
		.filter((x): x is string => typeof x === 'string' && x.length > 0)
		.join(' ')

/** استایلِ رنگ + پد + چینش — inline (hex پویا با کلاس ممکن نیست) */
const blockVisual = (block: ArticleBlock): React.CSSProperties => {
	const style = block.style
	if (!style?.bg) return {}
	return {
		backgroundColor: style.bg,
		color: style.fg ?? pickContrastText(style.bg),
	}
}

// ═══════════════ رندرِ یک بلوک ═══════════════

function BlockContent({ block }: { block: ArticleBlock }) {
	switch (block.type) {
		case 'hero': {
			const { src, title, text } = block.props
			return (
				<section className="ab-hero relative w-full aspect-video md:aspect-21/9 rounded-3xl overflow-hidden shadow-lg bg-gray-200 dark:bg-[#2a1015]">
					{src ? (
						<img
							src={src}
							alt={title ?? 'تصویر سرِ مقاله'}
							className="absolute inset-0 w-full h-full object-cover"
							decoding="async"
							fetchPriority="high"
						/>
					) : (
						<div className="absolute inset-0 bg-linear-to-br from-[#f6339a20] to-[#2fd4d120]" />
					)}
					{(title || text) && (
						<div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 p-6 bg-black/35">
							{title && (
								<h2 className="font-MorabbaBold text-2xl md:text-4xl text-white drop-shadow-lg leading-snug">
									{title}
								</h2>
							)}
							{text && (
								<p className="text-sm md:text-base text-white/90 max-w-xl leading-relaxed">
									{text}
								</p>
							)}
						</div>
					)}
				</section>
			)
		}
		case 'heading': {
			const { text, level } = block.props
			return level === 3 ? (
				<h3 className="font-DanaDemiBold text-xl md:text-2xl text-gray-800 dark:text-white leading-snug">
					{text}
				</h3>
			) : (
				<h2 className="font-MorabbaBold text-2xl md:text-3xl text-gray-900 dark:text-white leading-snug">
					{text}
				</h2>
			)
		}
		case 'paragraph':
			return (
				<p className="text-gray-700 dark:text-gray-300 leading-loose font-DanaRegular text-[15px] md:text-base whitespace-pre-wrap">
					{block.props.text}
				</p>
			)
		case 'image': {
			const { src, alt, caption } = block.props
			return (
				<figure className="space-y-2">
					<div className="rounded-2xl overflow-hidden bg-gray-200 dark:bg-[#2a1015]">
						<img
							src={src}
							alt={alt ?? caption ?? ''}
							className="w-full h-auto object-cover"
							loading="lazy"
							decoding="async"
						/>
					</div>
					{caption && (
						<figcaption className="text-center text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
							{caption}
						</figcaption>
					)}
				</figure>
			)
		}
		case 'gallery': {
			const { images, layout } = block.props
			if (images.length === 0) return null
			if (layout === 'slider') {
				return (
					<div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
						{images.map((im, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: تصویر تکراری (src یکسان) در گالری مجاز است — ایندکس بخشی از یکتایی
								key={`${im.src}-${i}`}
								className="shrink-0 w-[70%] sm:w-[45%] snap-center"
							>
								<img
									src={im.src}
									alt={im.alt ?? ''}
									className="w-full aspect-4/3 object-cover rounded-2xl bg-gray-200 dark:bg-[#2a1015]"
									loading="lazy"
									decoding="async"
								/>
							</div>
						))}
					</div>
				)
			}
			return (
				<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
					{images.map((im, i) => (
						<img
							// biome-ignore lint/suspicious/noArrayIndexKey: تصویر تکراری (src یکسان) در گالری مجاز است — ایندکس بخشی از یکتایی
							key={`${im.src}-${i}`}
							src={im.src}
							alt={im.alt ?? ''}
							className="w-full aspect-square object-cover rounded-2xl bg-gray-200 dark:bg-[#2a1015]"
							loading="lazy"
							decoding="async"
						/>
					))}
				</div>
			)
		}
		case 'quote': {
			const { text, author } = block.props
			return (
				<blockquote className="border-r-4 border-primary dark:border-dark-primary pr-4 pl-2 py-1">
					<p className="text-gray-700 dark:text-gray-200 text-base md:text-lg leading-relaxed font-DanaMedium italic">
						{text}
					</p>
					{author && (
						<footer className="mt-2 text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
							— {author}
						</footer>
					)}
				</blockquote>
			)
		}
		case 'callout': {
			const { title, text } = block.props
			return (
				<div className="rounded-2xl border border-primary/25 dark:border-dark-primary/25 bg-primary/6 dark:bg-dark-primary/6">
					{title && (
						<p className="font-DanaDemiBold text-sm md:text-base mb-1.5 text-primary dark:text-dark-primary">
							{title}
						</p>
					)}
					<p className="text-sm md:text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
						{text}
					</p>
				</div>
			)
		}
		case 'list': {
			const { items, ordered } = block.props
			const Tag = ordered ? 'ol' : 'ul'
			return (
				<Tag
					className={cx(
						'space-y-2 text-gray-700 dark:text-gray-300',
						ordered ? 'list-decimal list-inside' : 'list-none',
					)}
				>
					{items.map((item, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: مورد تکراری در فهرست مجال است — ایندکس بخشی از یکتایی
						<li key={`${item}-${i}`} className="flex items-start gap-2">
							{!ordered && (
								<span
									className="w-2 h-2 rounded-full bg-primary dark:bg-dark-primary mt-2 shrink-0"
									aria-hidden="true"
								/>
							)}
							<span className="text-sm md:text-[15px] font-DanaMedium leading-relaxed">
								{item}
							</span>
						</li>
					))}
				</Tag>
			)
		}
		case 'cta': {
			const { title, text, label, to, href } = block.props
			return (
				<div className="rounded-3xl p-6 sm:p-8 text-center space-y-3 bg-linear-to-br from-[#f6339a15] to-[#2fd4d115] dark:from-[#2fd4d110] dark:to-[#f6339a10] border border-primary/20 dark:border-dark-primary/20">
					{title && (
						<p className="font-DanaDemiBold text-lg md:text-xl text-gray-800 dark:text-white">
							{title}
						</p>
					)}
					{text && (
						<p className="text-sm md:text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed">
							{text}
						</p>
					)}
					{to === 'url' && href ? (
						<a
							href={href}
							className="inline-block px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer hover:opacity-90 transition"
						>
							{label}
						</a>
					) : (
						<Link
							to={to === 'articles' ? '/articles' : '/products'}
							className="inline-block px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer hover:opacity-90 transition"
						>
							{label}
						</Link>
					)}
				</div>
			)
		}
		case 'divider': {
			const { variant } = block.props
			if (variant === 'space') return <div className="h-8" aria-hidden="true" />
			if (variant === 'dots') {
				return (
					<div className="flex justify-center gap-2 py-2" aria-hidden="true">
						<span className="w-1.5 h-1.5 rounded-full bg-primary/50 dark:bg-dark-primary/50" />
						<span className="w-1.5 h-1.5 rounded-full bg-primary/50 dark:bg-dark-primary/50" />
						<span className="w-1.5 h-1.5 rounded-full bg-primary/50 dark:bg-dark-primary/50" />
					</div>
				)
			}
			return <hr className="border-0 h-px bg-gray-200 dark:bg-white/10" />
		}
		default:
			// defensive — بلوک ناشناخته هرگز صفحه را نمی‌شکند
			return null
	}
}

// ═══════════════ رندرِ کلِ سند ═══════════════

export function ArticleBlocksRenderer({ doc }: { doc: ArticleBlocksDoc }) {
	const rootRef = useRef<HTMLDivElement | null>(null)

	// reveal-on-scroll — الگوی AOS با یک IO مشترک؛ کلاس ab-js فقط بعد از
	// mount می‌نشیند تا خروجیِ SSR (کرالر/بدون-JS) متنِ مرئی باشد.
	useEffect(() => {
		const root = rootRef.current
		if (!root) return
		const reduced = window.matchMedia(
			'(prefers-reduced-motion: reduce)',
		).matches
		root.classList.add('ab-js')

		if (reduced) {
			for (const el of root.querySelectorAll('[data-anim]'))
				el.classList.add('ab-inview')
			return
		}

		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue
					entry.target.classList.add('ab-inview')
					io.unobserve(entry.target) // once — بی‌نهایت تکرار نه (AOS)
				}
			},
			{ threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
		)
		for (const el of root.querySelectorAll('[data-anim]')) {
			const anim = el.getAttribute('data-anim')
			if (anim && anim !== 'none') io.observe(el)
			else el.classList.add('ab-inview')
		}
		return () => io.disconnect()
		// doc از loader می‌آید و در عمرِ view ثابت است — observed ها همین‌جا کامل‌اند
	}, [])

	const index = { i: 0 }
	return (
		<div ref={rootRef} className="ab-viewport my-8 space-y-6">
			{doc.blocks.map((block) => {
				const width = block.width ?? 'lg'
				const style = block.style ?? {}
				const pad = style.pad ?? 'md'
				const visual = blockVisual(block)
				// stagger پلکانی — سقف ۵ پله (پایانِ صفحه مه‌آلود نشود)
				const step = Math.min(index.i++, 5)
				return (
					<div
						key={block.id}
						data-anim={block.anim ?? 'fade-up'}
						style={
							{
								'--ab-delay': `${step * 80}ms`,
								...visual,
							} as React.CSSProperties
						}
						className={cx(
							'ab-block',
							`ab-w-${width}`,
							width === 'sm' || width === 'md'
								? style.align === 'center'
									? 'ab-center'
									: 'ab-start'
								: '',
							style.bg && `ab-pad-${pad}`,
							style.align === 'center' && !style.bg && 'text-center',
							'rounded-2xl',
						)}
					>
						<BlockContent block={block} />
					</div>
				)
			})}
		</div>
	)
}
