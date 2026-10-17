// src/blocks.ts — packages/shared
// ═══════════════════════════════════════════════════════════════
// stage-82 — sinshin-food-delivery
// مدل داده‌ی «صفحه‌ساز بلوکی مقالات» — منبعِ حقیقتِ مشترک بین
// فرانت (ادیتور + رندرر عمومی) و بک (اعتبارسنجی/نرمال‌سازی).
//
// الگوبرداری (تحقیقِ استیج — REFERENCE ۲-۱۰-۱۴):
//  · Editor.js/Puck: سند = { version, blocks[] } — JSON خالص، نه HTML خام
//  · Ghost: عرضِ پله‌ای (sm/md/lg/full) به‌جای گرید پیچیده
//  · AOS: انیمیشن با data-attribute + تأخیر پلکانی + prefers-reduced-motion
//  · WCAG 1.4.3: متنِ روی پس‌زمینه‌ی رنگی با luminance خودکار انتخاب می‌شود
//  · Gutenberg (درس): version در سطح سند + مهاجرت — بلوکِ ناشناخته حذف
//    می‌شود نه کل سند (رندرِ defensive)
//
// هیچ HTML خامی ذخیره نمی‌شود — متن خالص + فقط URL تصویر؛ سطحِ حمله =
// URL ها است که سمت سرور (normalizer) الگوی‌سنجی می‌شوند.
// ═══════════════════════════════════════════════════════════════

/** نوع‌های بلوک — whitelist بسته؛ رندرر بلوک ناشناخته را بی‌صدا رد می‌کند */
export type ArticleBlockType =
	| 'hero'
	| 'heading'
	| 'paragraph'
	| 'image'
	| 'gallery'
	| 'quote'
	| 'callout'
	| 'list'
	| 'cta'
	| 'divider'

/** عرض پله‌ای (الگوی Ghost): sm≈50% · md≈70% · lg=100% ستون متن · full=خروج از حاشیه‌ی متن */
export type ArticleBlockWidth = 'sm' | 'md' | 'lg' | 'full'

/** انیمیشنِ ورود بلوک در صفحه‌ی عمومی (الگوی AOS) */
export type ArticleBlockAnim =
	| 'none'
	| 'fade'
	| 'fade-up'
	| 'slide'
	| 'zoom'
	| 'blur'

/** استایلِ بصری مشترک — رنگ‌ها همیشه hex خالص ۶رقمی (تایپ/سریال‌سازی ساده) */
export interface ArticleBlockStyle {
	/** پس‌زمینه — نبود = شفاف/وراثت تم */
	bg?: string
	/** متن — نبود = خودکار با کنتراستِ WCAG (pickContrastText) */
	fg?: string
	align?: 'start' | 'center'
	pad?: 'sm' | 'md' | 'lg'
}

export interface ArticleHeroProps {
	/** تصویرِ بزرگِ سرِ صفحه (آپلودی — URL نسبی/https) */
	src?: string
	title?: string
	text?: string
}
export interface ArticleHeadingProps {
	text: string
	level: 2 | 3
}
export interface ArticleParagraphProps {
	text: string
}
export interface ArticleImageProps {
	src: string
	alt?: string
	caption?: string
}
export interface ArticleGalleryProps {
	images: { src: string; alt?: string }[]
	layout: 'grid' | 'slider'
}
export interface ArticleQuoteProps {
	text: string
	author?: string
}
export interface ArticleCalloutProps {
	title?: string
	text: string
}
export interface ArticleListProps {
	items: string[]
	ordered?: boolean
}
export interface ArticleCtaProps {
	title?: string
	text?: string
	/** متن دکمه */
	label: string
	/** مقصد: مسیرهای داخل اپ یا URL آزادِ https/نسبی */
	to: 'menu' | 'articles' | 'url'
	href?: string
}
export interface ArticleDividerProps {
	variant: 'line' | 'dots' | 'space'
}

interface ArticleBlockBase {
	/** کلید پایدار (crypto.randomUUID) — رندر/DnD/دوبل‌کردن؛ هرگز ایندکس نیست */
	id: string
	width?: ArticleBlockWidth
	anim?: ArticleBlockAnim
	style?: ArticleBlockStyle
}

export type ArticleBlock =
	| (ArticleBlockBase & { type: 'hero'; props: ArticleHeroProps })
	| (ArticleBlockBase & { type: 'heading'; props: ArticleHeadingProps })
	| (ArticleBlockBase & { type: 'paragraph'; props: ArticleParagraphProps })
	| (ArticleBlockBase & { type: 'image'; props: ArticleImageProps })
	| (ArticleBlockBase & { type: 'gallery'; props: ArticleGalleryProps })
	| (ArticleBlockBase & { type: 'quote'; props: ArticleQuoteProps })
	| (ArticleBlockBase & { type: 'callout'; props: ArticleCalloutProps })
	| (ArticleBlockBase & { type: 'list'; props: ArticleListProps })
	| (ArticleBlockBase & { type: 'cta'; props: ArticleCtaProps })
	| (ArticleBlockBase & { type: 'divider'; props: ArticleDividerProps })

/** سندِ بلوکیِ مقاله — در ستون jsonb `articles.blocks` */
export interface ArticleBlocksDoc {
	version: 1
	blocks: ArticleBlock[]
}

// ═══════════════════ توابع خالص (فرانت + بک) ═══════════════════

const HEX_RE = /^#[0-9a-fA-F]{6}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject raw controls before the URL parser can discard them.
const INVALID_URL_CHARACTERS_RE = /[\s\\\u0000-\u001f\u007f]/u

export function isHexColor(v: unknown): v is string {
	return typeof v === 'string' && HEX_RE.test(v)
}

/** HTTPS or a local root-relative path; never a protocol-relative URL. */
export function isArticleBlockUrl(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		!value ||
		INVALID_URL_CHARACTERS_RE.test(value)
	) {
		return false
	}
	if (value.startsWith('/')) return !value.startsWith('//')
	if (!/^https:\/\/[^/]/i.test(value)) return false
	try {
		const parsed = new URL(value)
		return parsed.protocol === 'https:' && Boolean(parsed.hostname)
	} catch {
		return false
	}
}

/**
 * متنِ روشن/تیره‌ی خوانا روی پس‌زمینه‌ی داده‌شده — فرمولِ luminance نسبیِ
 * WCAG (1.4.3): خطی‌سازی کانال‌ها، وزن sRGB، مقایسه‌ی کنتراست با سیاه/سفید،
 * انتخابِ بزرگ‌تر. پیش‌فرضِ `fg` بلوک‌هاست (رنگِ دستی فقط override).
 */
export function pickContrastText(bg: string): '#000000' | '#ffffff' {
	const hex = bg.replace('#', '')
	const r = Number.parseInt(hex.slice(0, 2), 16) / 255
	const g = Number.parseInt(hex.slice(2, 4), 16) / 255
	const b = Number.parseInt(hex.slice(4, 6), 16) / 255
	const lin = (c: number) =>
		c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
	const withWhite = 1.05 / (l + 0.05)
	const withBlack = (l + 0.05) / 0.05
	return withWhite >= withBlack ? '#ffffff' : '#000000'
}

/** نسبت کنتراست (پس‌زمینه، متن) — برای هشدارِ inline فرم (WCAG AA = ۴٫۵) */
export function contrastRatio(a: string, b: string): number {
	const lum = (hex: string) => {
		const h = hex.replace('#', '')
		const lin = (i: number) => {
			const c = Number.parseInt(h.slice(i, i + 2), 16) / 255
			return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
		}
		return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4)
	}
	const l1 = lum(a)
	const l2 = lum(b)
	const hi = Math.max(l1, l2)
	const lo = Math.min(l1, l2)
	return (hi + 0.05) / (lo + 0.05)
}

/**
 * بازتولیدِ متنِ خالص از سندِ بلوکی — `content` متنیِ مقاله همیشه از
 * بلوک‌ها مشتق می‌شود تا لیست/سئو/جست‌وجو/ترجمه (که روی content سوارند)
 * با صفحه‌ساز هم‌زمان بمانند (درسِ تحقیق: content متنی را «ول نکن»).
 * ترتیب بلوک‌ها حفظ می‌شود؛ بلوک‌های تصویری/جداکننده متن نمی‌سازند.
 */
export function blocksToPlainText(
	doc: ArticleBlocksDoc | null | undefined,
): string {
	if (!doc || !Array.isArray(doc.blocks)) return ''
	const parts: string[] = []
	const cleanText = (value: unknown): string =>
		typeof value === 'string' ? value.trim() : ''
	const append = (value: unknown): void => {
		const text = cleanText(value)
		if (text) parts.push(text)
	}
	for (const b of doc.blocks) {
		if (!b || typeof b !== 'object') continue
		switch (b.type) {
			case 'hero':
			case 'callout':
			case 'cta':
				append(b.props?.title)
				append(b.props?.text)
				break
			case 'heading':
			case 'paragraph':
				append(b.props?.text)
				break
			case 'quote': {
				const text = cleanText(b.props?.text)
				const author = cleanText(b.props?.author)
				if (text) {
					parts.push(author ? `${text} — ${author}` : text)
				}
				break
			}
			case 'list':
				if (Array.isArray(b.props?.items)) {
					append(b.props.items.map(cleanText).filter(Boolean).join('\n'))
				}
				break
			default:
				break
		}
	}
	return parts.join('\n\n').trim()
}

/** نسخه‌ی سند — الگوی Editor.js: مهاجرتِ آینده از همین عدد شروع می‌شود */
export const ARTICLE_BLOCKS_VERSION = 1 as const
