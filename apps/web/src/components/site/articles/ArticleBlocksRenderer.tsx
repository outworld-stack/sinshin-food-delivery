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
	isArticleBlockUrl,
	isHexColor,
	pickContrastText,
} from '@sinshin/shared'

import { defaultParseSearch, Link } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useI18n } from '#/i18n'
import { ArticleLocationMap } from './ArticleLocationMap'
import { observeArticleBlocks } from './articleBlockAnimations'

const cx = (...parts: Array<string | false | undefined>): string =>
	parts
		.filter((x): x is string => typeof x === 'string' && x.length > 0)
		.join(' ')

/** استایلِ رنگ + پد + چینش — inline (hex پویا با کلاس ممکن نیست) */
const blockVisual = (block: ArticleBlock): React.CSSProperties => {
	const style = block.style
	const bg = isHexColor(style?.bg) ? style.bg : undefined
	const fg = isHexColor(style?.fg) ? style.fg : undefined
	return {
		backgroundColor: bg,
		color: fg ?? (bg ? pickContrastText(bg) : undefined),
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/** Persisted JSON may predate validation; one bad block must not break the page. */
const isRenderableBlock = (value: unknown): value is ArticleBlock => {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		!isRecord(value.props)
	)
		return false
	const props = value.props
	const optionalText = (...keys: string[]) =>
		keys.every((key) => props[key] == null || typeof props[key] === 'string')
	switch (value.type) {
		case 'hero':
			return optionalText('src', 'title', 'text')
		case 'heading':
		case 'paragraph':
			return typeof props.text === 'string'
		case 'image':
			return isArticleBlockUrl(props.src) && optionalText('alt', 'caption')
		case 'gallery':
			return (
				Array.isArray(props.images) &&
				props.images.every(
					(image) =>
						isRecord(image) &&
						isArticleBlockUrl(image.src) &&
						(image.alt == null || typeof image.alt === 'string'),
				)
			)
		case 'quote':
			return typeof props.text === 'string' && optionalText('author')
		case 'callout':
			return typeof props.text === 'string' && optionalText('title')
		case 'list':
			return (
				Array.isArray(props.items) &&
				props.items.every((item) => typeof item === 'string')
			)
		case 'cta':
			return (
				typeof props.label === 'string' && optionalText('title', 'text', 'href')
			)
		case 'link':
			// stage-84 — پیوند: label + href معتبر (https یا / نسبی)
			return (
				typeof props.label === 'string' &&
				typeof props.href === 'string' &&
				isArticleBlockUrl(props.href) &&
				optionalText('title', 'text')
			)
		case 'location':
			// stage-84 — موقعیت: مختصات عددی محدوده‌دار
			return (
				typeof props.lat === 'number' &&
				typeof props.lng === 'number' &&
				Number.isFinite(props.lat) &&
				Number.isFinite(props.lng) &&
				props.lat >= -90 &&
				props.lat <= 90 &&
				props.lng >= -180 &&
				props.lng <= 180 &&
				optionalText('title', 'address')
			)
		case 'divider':
			return true
		default:
			return false
	}
}

// ═══════════════ رندرِ یک بلوک ═══════════════

function BlockContent({ block }: { block: ArticleBlock }) {
	const { t } = useI18n()
	const textStyle = blockVisual(block).color ? { color: 'inherit' } : undefined
	switch (block.type) {
		case 'hero': {
			const { src, title, text } = block.props
			return (
				<section className="ab-hero relative grid w-full aspect-video md:aspect-21/9 rounded-3xl overflow-hidden shadow-lg bg-gray-200 dark:bg-[#2a1015]">
					{isArticleBlockUrl(src) ? (
						<img
							src={src}
							alt={title ?? ''}
							className="absolute inset-0 w-full h-full object-cover"
							decoding="async"
							fetchPriority="high"
						/>
					) : (
						<div className="absolute inset-0 bg-linear-to-br from-[#f6339a20] to-[#2fd4d120]" />
					)}
					{(title || text) && (
						<div
							className="relative flex flex-col items-center justify-center text-center gap-2 p-6 bg-black/35"
							style={{ textAlign: block.style?.align }}
						>
							{title && (
								<h2
									style={textStyle}
									className="font-MorabbaBold text-2xl md:text-4xl text-white drop-shadow-lg leading-snug"
								>
									{title}
								</h2>
							)}
							{text && (
								<p
									style={textStyle}
									className="text-sm md:text-base text-white/90 max-w-xl leading-relaxed whitespace-pre-wrap"
								>
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
				<h3
					style={textStyle}
					className="font-DanaDemiBold text-xl md:text-2xl text-gray-800 dark:text-white leading-snug"
				>
					{text}
				</h3>
			) : (
				<h2
					style={textStyle}
					className="font-MorabbaBold text-2xl md:text-3xl text-gray-900 dark:text-white leading-snug"
				>
					{text}
				</h2>
			)
		}
		case 'paragraph':
			return (
				<p
					style={textStyle}
					className="text-gray-700 dark:text-gray-300 leading-loose font-DanaRegular text-[15px] md:text-base whitespace-pre-wrap"
				>
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
						<figcaption
							style={textStyle}
							className="text-center text-xs text-gray-500 dark:text-gray-400 font-DanaMedium"
						>
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
				<blockquote className="border-s-4 border-primary dark:border-dark-primary ps-4 pe-2 py-1">
					<p
						style={textStyle}
						className="text-gray-700 dark:text-gray-200 text-base md:text-lg leading-relaxed font-DanaMedium italic whitespace-pre-wrap"
					>
						{text}
					</p>
					{author && (
						<footer
							style={textStyle}
							className="mt-2 text-xs text-gray-500 dark:text-gray-400 font-DanaMedium"
						>
							— {author}
						</footer>
					)}
				</blockquote>
			)
		}
		case 'callout': {
			const { title, text } = block.props
			return (
				<div
					className={cx(
						'rounded-2xl border border-primary/25 dark:border-dark-primary/25',
						!isHexColor(block.style?.bg) &&
							'p-4 bg-primary/6 dark:bg-dark-primary/6',
					)}
				>
					{title && (
						<p
							style={textStyle}
							className="font-DanaDemiBold text-sm md:text-base mb-1.5 text-primary dark:text-dark-primary"
						>
							{title}
						</p>
					)}
					<p
						style={textStyle}
						className="text-sm md:text-[15px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap"
					>
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
					style={textStyle}
					className={cx(
						'space-y-2 text-gray-700 dark:text-gray-300',
						ordered ? 'list-decimal list-inside' : 'list-none',
					)}
				>
					{items.map((item, i) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: Duplicate items are allowed; the index distinguishes them.
							key={`${item}-${i}`}
							className={ordered ? 'list-item' : 'flex items-start gap-2'}
						>
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
				<div
					style={{ textAlign: block.style?.align }}
					className={cx(
						'rounded-3xl p-6 sm:p-8 text-center space-y-3 border border-primary/20 dark:border-dark-primary/20',
						!isHexColor(block.style?.bg) &&
							'bg-linear-to-br from-[#f6339a15] to-[#2fd4d115] dark:from-[#2fd4d110] dark:to-[#f6339a10]',
					)}
				>
					{title && (
						<p
							style={textStyle}
							className="font-DanaDemiBold text-lg md:text-xl text-gray-800 dark:text-white"
						>
							{title}
						</p>
					)}
					{text && (
						<p
							style={textStyle}
							className="text-sm md:text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap"
						>
							{text}
						</p>
					)}
					{to === 'url' && isArticleBlockUrl(href) ? (
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
		case 'link': {
			// stage-84 — بلوک پیوند: دکمه‌ی پر یا کارت؛ href خارجی
			// (https) → تب جدید؛ مسیر نسبی → همان صفحه.
			const { label, href, title, text, variant } = block.props
			const external = href.startsWith('http')
			const destination = new URL(href, 'https://article.invalid')
			const className =
				'inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer hover:opacity-90 transition'
			const anchor = external ? (
				<a
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className={className}
				>
					{label}
				</a>
			) : href.startsWith('/uploads/') ? (
				<a href={href} className={className}>
					{label}
				</a>
			) : (
				<Link
					to={destination.pathname}
					search={defaultParseSearch(destination.search)}
					hash={destination.hash.slice(1)}
					className={className}
				>
					{label}
				</Link>
			)
			if (variant === 'card') {
				return (
					<div
						style={{ textAlign: block.style?.align }}
						className={cx(
							'rounded-3xl p-6 sm:p-8 space-y-3 border border-primary/20 dark:border-dark-primary/20 text-center',
							!isHexColor(block.style?.bg) &&
								'bg-linear-to-br from-[#2fd4d110] to-[#f6339a10] dark:from-[#2fd4d110] dark:to-[#f6339a0f]',
						)}
					>
						{title && (
							<p
								style={textStyle}
								className="font-DanaDemiBold text-base md:text-lg text-gray-800 dark:text-white"
							>
								{title}
							</p>
						)}
						{text && (
							<p
								style={textStyle}
								className="text-sm md:text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap"
							>
								{text}
							</p>
						)}
						{anchor}
					</div>
				)
			}
			return (
				<div style={{ textAlign: block.style?.align }} className="space-y-2">
					{title && (
						<p
							style={textStyle}
							className="font-DanaDemiBold text-base text-gray-800 dark:text-white"
						>
							{title}
						</p>
					)}
					{text && (
						<p
							style={textStyle}
							className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap"
						>
							{text}
						</p>
					)}
					{anchor}
				</div>
			)
		}
		case 'location': {
			// stage-84 — بلوک موقعیت: عنوان/آدرس + نقشه‌ی تعاملی
			// (کلاینتی — SSR فقط متن) + دکمه‌ی بیرونی.
			const { lat, lng, title, address } = block.props
			const neshanUrl = `https://neshan.org/maps/@${lat},${lng},15z`
			return (
				<div className="space-y-3">
					{(title || address) && (
						<div className="space-y-1">
							{title && (
								<p
									style={textStyle}
									className="font-DanaDemiBold text-base md:text-lg text-gray-800 dark:text-white"
								>
									{title}
								</p>
							)}
							{address && (
								<p
									style={textStyle}
									className="text-sm md:text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed"
								>
									{address}
								</p>
							)}
						</div>
					)}
					<ArticleLocationMap lat={lat} lng={lng} />
					<div style={{ textAlign: block.style?.align }}>
						<a
							href={neshanUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-primary/30 dark:border-dark-primary/30 text-primary dark:text-dark-primary font-DanaMedium text-sm cursor-pointer hover:bg-primary/5 dark:hover:bg-dark-primary/5 transition"
						>
							{t['article.viewMap']}
						</a>
					</div>
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

export function ArticleBlocksRenderer({
	doc,
}: {
	doc: ArticleBlocksDoc | null | undefined
}) {
	const rootRef = useRef<HTMLDivElement | null>(null)

	// reveal-on-scroll — الگوی AOS با یک IO مشترک؛ کلاس ab-js فقط بعد از
	// mount می‌نشیند تا خروجیِ SSR (کرالر/بدون-JS) متنِ مرئی باشد.
	useEffect(() => {
		const root = rootRef.current
		if (!root || !doc) return
		return observeArticleBlocks(root)
	}, [doc])

	const blocks =
		doc?.version === 1 && Array.isArray(doc.blocks)
			? doc.blocks.filter(isRenderableBlock)
			: []
	return (
		<div ref={rootRef} className="ab-viewport my-8 space-y-6">
			{blocks.map((block, index) => {
				const width = block.width ?? 'lg'
				const style = block.style ?? {}
				const pad = style.pad ?? 'md'
				const visual = blockVisual(block)
				// stagger پلکانی — سقف ۵ پله (پایانِ صفحه مه‌آلود نشود)
				const step = Math.min(index, 5)
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
							isHexColor(style.bg) && `ab-pad-${pad}`,
							style.align === 'center' && 'text-center',
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
