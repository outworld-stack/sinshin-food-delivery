// src/components/admin/articles/builder/blockModel.ts
// ═══════════════════════════════════════════════════════════════
// stage-82 — مدلِ صفحه‌سازِ بلوکی مقالات (سمت فرانت):
// پالت بلوک‌ها، پیش‌فرض‌های تازه، تبدیلِ متن⇄بلوک و عملیات‌های ساختاری.
// تایپ‌ها/توابعِ خالص از @sinshin/shared می‌آیند (منبع حقیقت مشترک).
// ═══════════════════════════════════════════════════════════════
import {
	type ArticleBlock,
	type ArticleBlocksDoc,
	blocksToPlainText,
} from '@sinshin/shared'

/** ساخت id پایدار — دوبل‌کردن هم id تازه می‌گیرد (درسِ تحقیق #۳) */
export const newBlockId = (): string => crypto.randomUUID()

export interface PaletteItem {
	type: ArticleBlock['type']
	label: string
	hint: string
}

/** پالت — ترتیبِ منطقیِ ساختِ یک صفحه‌ی غذایی */
export const BLOCK_PALETTE: PaletteItem[] = [
	{ type: 'hero', label: 'هیرو', hint: 'تصویر بزرگ سرِ صفحه + عنوان روی آن' },
	{ type: 'heading', label: 'تیتر', hint: 'سرصفحه‌ی بخش (۲ سطح)' },
	{ type: 'paragraph', label: 'پاراگراف', hint: 'متنِ آزاد' },
	{ type: 'image', label: 'تصویر', hint: 'عکس + زیرنویس' },
	{ type: 'gallery', label: 'گالری', hint: 'چند عکس — شبکه یا اسلایدر' },
	{ type: 'quote', label: 'نقل‌قول', hint: 'حاشیه‌دار + نویسنده' },
	{ type: 'callout', label: 'باکس نکته', hint: 'هایلایت رنگی (نکته‌ی سرآشپز…)' },
	{ type: 'list', label: 'فهرست', hint: 'گلوله‌ای یا شماره‌دار' },
	{ type: 'cta', label: 'دکمه اقدام', hint: 'کارت دعوت به سفارش/مشاهده' },
	{ type: 'link', label: 'لینک', hint: 'پیوند به هر آدرس (دکمه/کارت)' },
	{ type: 'location', label: 'موقعیت', hint: 'نقشه + آدرس مکان' },
	{ type: 'divider', label: 'جداکننده', hint: 'خط / نقطه / فاصله' },
]

/** بلوکِ تازه با پیش‌فرضِ معقولِ هر نوع */
export function makeBlock(type: ArticleBlock['type']): ArticleBlock {
	const id = newBlockId()
	switch (type) {
		case 'hero':
			return {
				id,
				type,
				width: 'full',
				anim: 'fade-up',
				props: { title: '', text: '' },
			}
		case 'heading':
			return {
				id,
				type,
				width: 'lg',
				anim: 'fade-up',
				props: { text: '', level: 2 },
			}
		case 'paragraph':
			return { id, type, width: 'lg', anim: 'fade-up', props: { text: '' } }
		case 'image':
			return { id, type, width: 'lg', anim: 'fade', props: { src: '' } }
		case 'gallery':
			return {
				id,
				type,
				width: 'full',
				anim: 'fade-up',
				props: { images: [], layout: 'grid' },
			}
		case 'quote':
			return { id, type, width: 'md', anim: 'slide', props: { text: '' } }
		case 'callout':
			return {
				id,
				type,
				width: 'md',
				anim: 'zoom',
				style: { pad: 'md' },
				props: { title: '', text: '' },
			}
		case 'list':
			return { id, type, width: 'md', anim: 'fade-up', props: { items: [''] } }
		case 'cta':
			return {
				id,
				type,
				width: 'md',
				anim: 'zoom',
				props: { title: '', text: '', label: 'سفارش بده', to: 'menu' },
			}
		case 'link':
			// stage-84 — بلوک پیوند: دکمه/کارت با مقصدِ آزاد
			return {
				id,
				type,
				width: 'md',
				anim: 'zoom',
				props: { label: 'مشاهده', href: '' },
			}
		case 'location':
			// stage-84 — بلوک موقعیت: پیش‌فرض = موقعیت رستوران
			return {
				id,
				type,
				width: 'lg',
				anim: 'fade-up',
				props: { lat: 37.4822056, lng: 49.4418273, title: '', address: '' },
			}
		case 'divider':
			return { id, type, width: 'lg', anim: 'none', props: { variant: 'line' } }
	}
}

/** سندِ تازه با یک پاراگراف خالی — شروعِ تمیز */
export function emptyDoc(): ArticleBlocksDoc {
	return { version: 1, blocks: [makeBlock('paragraph')] }
}

/**
 * تبدیلِ متنِ ساده‌ی قدیمی → سندِ بلوکی (پلِ مهاجرتِ «متن ساده»→«صفحه‌ساز»):
 * هر پاراگرافِ جداشده با \n\n یک بلوک paragraph می‌شود.
 */
export function plainTextToDoc(content: string): ArticleBlocksDoc {
	const paragraphs = content
		.replace(/\r\n?/g, '\n')
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean)
	// The API caps paragraph text at 5,000 characters. Split long paragraphs
	// before migrating instead of silently truncating an existing article.
	const chunks = paragraphs.flatMap((paragraph) => {
		const result: string[] = []
		for (let start = 0; start < paragraph.length; ) {
			let end = Math.min(start + 5000, paragraph.length)
			if (
				end < paragraph.length &&
				/[\uD800-\uDBFF]/.test(paragraph[end - 1]) &&
				/[\uDC00-\uDFFF]/.test(paragraph[end])
			)
				end--
			result.push(paragraph.slice(start, end))
			start = end
		}
		return result
	})
	const blocks: ArticleBlock[] = chunks.map((text) => ({
		id: newBlockId(),
		type: 'paragraph',
		width: 'lg',
		anim: 'fade-up',
		props: { text },
	}))
	return {
		version: 1,
		blocks: blocks.length > 0 ? blocks : [makeBlock('paragraph')],
	}
}

/** مشتقِ متن از سند — به‌عنوانِ single source برای فیلد content فرم */
export { blocksToPlainText }

/** جابجایی امن (درگ یا دکمه‌های ↑/↓) — خودش را می‌بندد */
export function moveBlock(
	doc: ArticleBlocksDoc,
	from: number,
	to: number,
): ArticleBlocksDoc {
	const blocks = [...doc.blocks]
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from === to ||
		from < 0 ||
		from >= blocks.length ||
		to < 0 ||
		to > blocks.length
	)
		return doc
	const [moved] = blocks.splice(from, 1)
	if (!moved) return doc
	blocks.splice(Math.min(to, blocks.length), 0, moved)
	return { ...doc, blocks }
}

/** دوبل‌کردن — همه‌ی id های تازه (کپیِ key-stable در رندر/DnD) */
export function duplicateBlock(
	doc: ArticleBlocksDoc,
	index: number,
): ArticleBlocksDoc {
	const blocks = [...doc.blocks]
	const src = blocks[index]
	if (!src) return doc
	const clone = { ...structuredClone(src), id: newBlockId() }
	blocks.splice(index + 1, 0, clone)
	return { ...doc, blocks }
}

/** عرض/انیمیشن/رنگ — گزینه‌های اینسپکتور */
export const WIDTH_OPTIONS: {
	value: NonNullable<ArticleBlock['width']>
	label: string
	hint: string
}[] = [
	{ value: 'sm', label: 'کوچک', hint: '۵۰٪' },
	{ value: 'md', label: 'متوسط', hint: '۷۰٪' },
	{ value: 'lg', label: 'پهن', hint: '۱۰۰٪ ستون متن' },
	{ value: 'full', label: 'تمام‌عرض', hint: 'خروج از حاشیه‌ی متن' },
]

export const ANIM_OPTIONS: {
	value: NonNullable<ArticleBlock['anim']>
	label: string
}[] = [
	{ value: 'none', label: 'بدون' },
	{ value: 'fade', label: 'محو' },
	{ value: 'fade-up', label: 'محو + بالا' },
	{ value: 'slide', label: 'کشویی' },
	{ value: 'zoom', label: 'بزرگ‌نمایی' },
	{ value: 'blur', label: 'محوِ نرم' },
]

/** پالتِ رنگِ پیشنهادی — هماهنگ با خانواده‌ی برند (primary/فیروزه‌ای/کهربایی) */
export const BG_PRESETS = [
	'#ed0741',
	'#2fd4d1',
	'#ffc640',
	'#7c3aed',
	'#059669',
	'#0369a1',
	'#1f2937',
	'#fef3c7',
] as const
