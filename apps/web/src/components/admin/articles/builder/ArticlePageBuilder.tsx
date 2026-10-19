// src/components/admin/articles/builder/ArticlePageBuilder.tsx
// ═══════════════════════════════════════════════════════════════
// stage-82 — صفحه‌سازِ بلوکیِ مقالات (ادیتور ادمین).
//
// الگوها (تحقیقِ استیج — REFERENCE ۲-۱۰-۱۴):
//  · Notion/Puck: پالت + بومِ زنده + تنظیماتِ داخلِ هر بلوک
//  · Base Web/whatwg#3114: درگ فقط روی «دسته» (نه محتوای قابل‌ویرایش)؛
//    پاک‌سازی در dragend (نه فقط drop) — لغو با Esc هم تمیز می‌ماند
//  · RTL: منطقِ فقط-محورِ Y — ذاتاً بی‌خطر از جهت
//  · Redux undo: استکِ snapshot برای متن، تصویر و تغییرات ساختاری
//  · Preview با container-query (نه iframe) — کلاس‌های عرض واقعاً
//    به کانتینر واکنش نشان می‌دهند
// ═══════════════════════════════════════════════════════════════

import type {
	ArticleBlock,
	ArticleBlockStyle,
	ArticleBlocksDoc,
} from '@sinshin/shared'
import { contrastRatio, pickContrastText } from '@sinshin/shared'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
	ArrowDown,
	ArrowsRotate,
	ArrowUp,
	Copy,
	Devices,
	FlagBanner,
	Grid,
	Image as ImageIcon,
	Link as LinkIcon,
	ListCheck,
	Map as MapIcon,
	Minus,
	Play,
	Plus,
	QuoteUp,
	Settings,
	Stickynote,
	TextBlock,
	Text as TextIcon,
	Trash2,
} from 'reicon-react'

import { ImageField } from '#/components/shared/ImageField'
import { useToastStore } from '#/stores/toastStore'
import {
	ANIM_OPTIONS,
	BG_PRESETS,
	BLOCK_PALETTE,
	blocksToPlainText,
	duplicateBlock,
	emptyDoc,
	makeBlock,
	moveBlock,
	WIDTH_OPTIONS,
} from './blockModel'
import { LocationPickerField } from './LocationPickerField'

const PALETTE_ICONS: Record<
	ArticleBlock['type'],
	React.ComponentType<{ size?: number; className?: string }>
> = {
	hero: FlagBanner,
	heading: TextIcon,
	paragraph: TextBlock,
	image: ImageIcon,
	gallery: Grid,
	quote: QuoteUp,
	callout: Stickynote,
	list: ListCheck,
	cta: Play,
	link: LinkIcon,
	location: MapIcon,
	divider: Minus,
}

const BLOCK_LABELS: Record<ArticleBlock['type'], string> = {
	hero: 'هیرو',
	heading: 'تیتر',
	paragraph: 'پاراگراف',
	image: 'تصویر',
	gallery: 'گالری',
	quote: 'نقل‌قول',
	callout: 'باکس نکته',
	list: 'فهرست',
	cta: 'دکمه اقدام',
	link: 'لینک',
	location: 'موقعیت',
	divider: 'جداکننده',
}

/** join شرطی کلاس‌ها — همین فایل (اپ وب cn سراسری ندارد) */
const cx = (...parts: Array<string | false | undefined>): string =>
	parts
		.filter((x): x is string => typeof x === 'string' && x.length > 0)
		.join(' ')

const inputCls =
	'w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary dark:focus:border-dark-primary transition'

interface BuilderProps {
	doc: ArticleBlocksDoc
	onChange: (doc: ArticleBlocksDoc) => void
}

/** یک دکمه‌ی پله‌ای (عرض/انیمیشن/پد/چینش) */
function Pill({
	active,
	onClick,
	children,
	title,
}: {
	active: boolean
	onClick: () => void
	children: React.ReactNode
	title?: string
}) {
	return (
		<button
			type="button"
			title={title}
			aria-pressed={active}
			onClick={onClick}
			className={cx(
				'px-2.5 py-1 rounded-lg text-xs font-DanaMedium border transition-colors cursor-pointer',
				active
					? 'border-primary bg-primary/10 text-primary dark:border-dark-primary dark:bg-dark-primary/10 dark:text-dark-primary'
					: 'border-gray-200 dark:border-[#3a151c] text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-[#4a1a24]',
			)}
		>
			{children}
		</button>
	)
}

// ═══════════════ ویرایشگرِ props هر نوع بلوک ═══════════════

interface FieldCtx {
	block: ArticleBlock
	patchProps: (patch: PropsPatch) => void
}

type PropsPatch =
	| Record<string, unknown>
	| ((props: ArticleBlock['props']) => Record<string, unknown>)

function BlockFields({ block, patchProps }: FieldCtx) {
	switch (block.type) {
		case 'hero':
			return (
				<div className="space-y-2.5">
					<ImageField
						label="تصویر هیرو (WebP/PNG)"
						accept="image/webp,image/png"
						fileTypeText="WebP/PNG"
						images={block.props.src ? [block.props.src] : []}
						onAdd={(url) => patchProps({ src: url })}
						onRemove={() => patchProps({ src: '' })}
					/>
					<input
						className={inputCls}
						placeholder="عنوان روی تصویر (اختیاری)"
						maxLength={160}
						value={block.props.title ?? ''}
						onChange={(e) => patchProps({ title: e.target.value })}
					/>
					<textarea
						className={cx(inputCls, 'resize-y min-h-14')}
						placeholder="متن کوتاه روی تصویر (اختیاری)"
						maxLength={500}
						value={block.props.text ?? ''}
						onChange={(e) => patchProps({ text: e.target.value })}
					/>
				</div>
			)
		case 'heading':
			return (
				<div className="space-y-2 flex flex-col sm:flex-row gap-2">
					<input
						className={inputCls}
						placeholder="متن تیتر"
						maxLength={200}
						value={block.props.text}
						onChange={(e) => patchProps({ text: e.target.value })}
					/>
					<select
						aria-label="سطح تیتر"
						className={cx(inputCls, 'sm:w-32 cursor-pointer')}
						value={block.props.level}
						onChange={(e) =>
							patchProps({ level: Number(e.target.value) === 3 ? 3 : 2 })
						}
					>
						<option value={2}>تیتر بزرگ</option>
						<option value={3}>تیتر کوچک</option>
					</select>
				</div>
			)
		case 'paragraph':
			return (
				<textarea
					className={cx(inputCls, 'resize-y min-h-24 leading-relaxed')}
					placeholder="متن پاراگراف…"
					maxLength={5000}
					value={block.props.text}
					onChange={(e) => patchProps({ text: e.target.value })}
				/>
			)
		case 'image':
			return (
				<div className="space-y-2.5">
					<ImageField
						label="تصویر (WebP/PNG)"
						accept="image/webp,image/png"
						fileTypeText="WebP/PNG"
						images={block.props.src ? [block.props.src] : []}
						onAdd={(url) => patchProps({ src: url })}
						onRemove={() => patchProps({ src: '' })}
					/>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						<input
							className={inputCls}
							placeholder="متن جایگزین (alt — سئو)"
							maxLength={200}
							value={block.props.alt ?? ''}
							onChange={(e) => patchProps({ alt: e.target.value })}
						/>
						<input
							className={inputCls}
							placeholder="زیرنویس تصویر (اختیاری)"
							maxLength={160}
							value={block.props.caption ?? ''}
							onChange={(e) => patchProps({ caption: e.target.value })}
						/>
					</div>
				</div>
			)
		case 'gallery': {
			const images = block.props.images ?? []
			return (
				<div className="space-y-2.5">
					<ImageField
						label="عکس‌های گالری (WebP/PNG)"
						accept="image/webp,image/png"
						fileTypeText="WebP/PNG"
						multiple
						images={images.map((im) => im.src)}
						onAdd={(url) =>
							patchProps((props) => ({
								images: [
									...('images' in props ? props.images : []),
									{ src: url },
								],
							}))
						}
						onRemove={(index) =>
							patchProps({ images: images.filter((_, i) => i !== index) })
						}
					/>
					{images.length > 0 && (
						<div className="space-y-1.5">
							{images.map((im, i) => (
								<input
									// biome-ignore lint/suspicious/noArrayIndexKey: عکس تکراری مجاز است — ایندکس بخشی از یکتایی
									key={`${im.src}-${i}`}
									className={inputCls}
									placeholder={`متن جایگزین عکس ${i + 1} (اختیاری)`}
									maxLength={200}
									value={im.alt ?? ''}
									onChange={(e) => {
										const next = [...images]
										next[i] = e.target.value
											? { src: im.src, alt: e.target.value }
											: { src: im.src }
										patchProps({ images: next })
									}}
								/>
							))}
						</div>
					)}
					<div className="flex gap-1.5">
						<Pill
							active={block.props.layout === 'grid'}
							onClick={() => patchProps({ layout: 'grid' })}
						>
							شبکه‌ای
						</Pill>
						<Pill
							active={block.props.layout === 'slider'}
							onClick={() => patchProps({ layout: 'slider' })}
						>
							اسلایدری
						</Pill>
					</div>
				</div>
			)
		}
		case 'quote':
			return (
				<div className="space-y-2">
					<textarea
						className={cx(inputCls, 'resize-y min-h-16')}
						placeholder="متن نقل‌قول"
						maxLength={1000}
						value={block.props.text}
						onChange={(e) => patchProps({ text: e.target.value })}
					/>
					<input
						className={inputCls}
						placeholder="نویسنده/منبع (اختیاری)"
						maxLength={120}
						value={block.props.author ?? ''}
						onChange={(e) => patchProps({ author: e.target.value })}
					/>
				</div>
			)
		case 'callout':
			return (
				<div className="space-y-2">
					<input
						className={inputCls}
						placeholder="عنوان باکس (مثلاً: نکته سرآشپز)"
						maxLength={160}
						value={block.props.title ?? ''}
						onChange={(e) => patchProps({ title: e.target.value })}
					/>
					<textarea
						className={cx(inputCls, 'resize-y min-h-16')}
						placeholder="متن باکس"
						maxLength={1000}
						value={block.props.text}
						onChange={(e) => patchProps({ text: e.target.value })}
					/>
				</div>
			)
		case 'list': {
			const items = block.props.items ?? []
			const itemsText = items.join('\n')
			return (
				<div className="space-y-2">
					<textarea
						className={cx(inputCls, 'resize-y min-h-18')}
						placeholder={'هر خط = یک مورد…'}
						value={itemsText}
						onChange={(e) =>
							patchProps({
								items: e.target.value
									.split('\n')
									.map((l) => l.slice(0, 300))
									.slice(0, 30),
							})
						}
					/>
					<div className="flex gap-1.5">
						<Pill
							active={!block.props.ordered}
							onClick={() => patchProps({ ordered: false })}
						>
							گلوله‌ای
						</Pill>
						<Pill
							active={block.props.ordered === true}
							onClick={() => patchProps({ ordered: true })}
						>
							شماره‌دار
						</Pill>
					</div>
				</div>
			)
		}
		case 'cta':
			return (
				<div className="space-y-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
					<input
						className={inputCls}
						placeholder="عنوان کارت (اختیاری)"
						maxLength={160}
						value={block.props.title ?? ''}
						onChange={(e) => patchProps({ title: e.target.value })}
					/>
					<input
						className={inputCls}
						placeholder="متن دکمه (اجباری)"
						maxLength={60}
						value={block.props.label}
						onChange={(e) => patchProps({ label: e.target.value })}
					/>
					<input
						className={cx(inputCls, 'sm:col-span-2')}
						placeholder="متن توضیح کارت (اختیاری)"
						maxLength={500}
						value={block.props.text ?? ''}
						onChange={(e) => patchProps({ text: e.target.value })}
					/>
					<select
						aria-label="مقصد دکمه"
						className={cx(inputCls, 'cursor-pointer')}
						value={block.props.to}
						onChange={(e) =>
							patchProps({
								to:
									e.target.value === 'url'
										? 'url'
										: e.target.value === 'articles'
											? 'articles'
											: 'menu',
							})
						}
					>
						<option value="menu">منوی سفارش (محصولات)</option>
						<option value="articles">لیست مقالات</option>
						<option value="url">لینک دلخواه</option>
					</select>
					{block.props.to === 'url' && (
						<input
							className={inputCls}
							dir="ltr"
							placeholder="https://…"
							maxLength={500}
							value={block.props.href ?? ''}
							onChange={(e) => patchProps({ href: e.target.value })}
						/>
					)}
				</div>
			)
		case 'link':
			return (
				<div className="space-y-2">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						<input
							className={inputCls}
							placeholder="متن دکمه (اجباری)"
							maxLength={60}
							value={block.props.label}
							onChange={(e) => patchProps({ label: e.target.value })}
						/>
						<input
							className={inputCls}
							dir="ltr"
							placeholder="https://… یا /مسیر داخلی"
							maxLength={500}
							value={block.props.href ?? ''}
							onChange={(e) => patchProps({ href: e.target.value })}
						/>
					</div>
					<input
						className={inputCls}
						placeholder="عنوان (اختیاری — بالای دکمه)"
						maxLength={160}
						value={block.props.title ?? ''}
						onChange={(e) => patchProps({ title: e.target.value })}
					/>
					<input
						className={inputCls}
						placeholder="توضیح کوتاه (اختیاری)"
						maxLength={500}
						value={block.props.text ?? ''}
						onChange={(e) => patchProps({ text: e.target.value })}
					/>
					<div className="flex gap-1.5">
						<Pill
							active={block.props.variant !== 'card'}
							onClick={() => patchProps({ variant: 'button' })}
						>
							دکمه
						</Pill>
						<Pill
							active={block.props.variant === 'card'}
							onClick={() => patchProps({ variant: 'card' })}
						>
							کارت
						</Pill>
					</div>
				</div>
			)
		case 'location':
			return (
				<div className="space-y-2">
					<input
						className={inputCls}
						placeholder="عنوان مکان (اختیاری — مثلاً: شعبه مرکزی)"
						maxLength={160}
						value={block.props.title ?? ''}
						onChange={(e) => patchProps({ title: e.target.value })}
					/>
					<input
						className={inputCls}
						placeholder="آدرس کامل مکان (اختیاری)"
						maxLength={300}
						value={block.props.address ?? ''}
						onChange={(e) => patchProps({ address: e.target.value })}
					/>
					<LocationPickerField
						lat={block.props.lat}
						lng={block.props.lng}
						onChange={(coords) =>
							patchProps({ lat: coords.lat, lng: coords.lng })
						}
					/>
				</div>
			)
		case 'divider':
			return (
				<div className="flex gap-1.5">
					<Pill
						active={block.props.variant === 'line'}
						onClick={() => patchProps({ variant: 'line' })}
					>
						خط
					</Pill>
					<Pill
						active={block.props.variant === 'dots'}
						onClick={() => patchProps({ variant: 'dots' })}
					>
						نقطه‌چین
					</Pill>
					<Pill
						active={block.props.variant === 'space'}
						onClick={() => patchProps({ variant: 'space' })}
					>
						فاصله
					</Pill>
				</div>
			)
	}
}

// ═══════════════ تنظیماتِ نمایشِ بلوک (رنگ/عرض/انیمیشن/پد/چینش) ═══════════════

function BlockSettings({
	block,
	patchStyle,
	onWidth,
	onAnim,
}: {
	block: ArticleBlock
	patchStyle: (patch: Partial<ArticleBlockStyle>) => void
	onWidth: (w: ArticleBlock['width']) => void
	onAnim: (a: ArticleBlock['anim']) => void
}) {
	const style = block.style ?? {}
	const bg = style.bg
	const showContrastWarn =
		bg !== undefined &&
		style.fg !== undefined &&
		contrastRatio(bg, style.fg) < 4.5

	return (
		<div className="space-y-4 pt-3 border-t border-dashed border-gray-200 dark:border-white/10">
			{/* عرض */}
			<div>
				<p className="text-[11px] font-DanaDemiBold text-gray-500 dark:text-gray-400 mb-1.5">
					عرض در صفحه
				</p>
				<div className="flex flex-wrap gap-1.5">
					{WIDTH_OPTIONS.map((w) => (
						<Pill
							key={w.value}
							active={(block.width ?? 'lg') === w.value}
							onClick={() => onWidth(w.value)}
							title={w.hint}
						>
							{w.label}{' '}
							<span className="text-[9px] opacity-60" dir="ltr">
								{w.hint}
							</span>
						</Pill>
					))}
				</div>
			</div>

			{/* انیمیشن ورود */}
			<div>
				<p className="text-[11px] font-DanaDemiBold text-gray-500 dark:text-gray-400 mb-1.5">
					انیمیشن ورود (اسکرول)
				</p>
				<div className="flex flex-wrap gap-1.5">
					{ANIM_OPTIONS.map((a) => (
						<Pill
							key={a.value}
							active={(block.anim ?? 'fade-up') === a.value}
							onClick={() => onAnim(a.value)}
						>
							{a.label}
						</Pill>
					))}
				</div>
			</div>

			{/* رنگ پس‌زمینه + متن */}
			<div>
				<p className="text-[11px] font-DanaDemiBold text-gray-500 dark:text-gray-400 mb-1.5">
					رنگ پس‌زمینه (خالی = تمِ صفحه)
				</p>
				<div className="flex flex-wrap items-center gap-1.5">
					{BG_PRESETS.map((c) => (
						<button
							key={c}
							type="button"
							aria-label={`رنگ ${c}`}
							title={c}
							onClick={() => patchStyle({ bg: c })}
							className={cx(
								'w-7 h-7 rounded-lg border-2 cursor-pointer transition-transform hover:scale-110',
								bg === c
									? 'border-gray-800 dark:border-white scale-110'
									: 'border-transparent',
							)}
							style={{ backgroundColor: c }}
						/>
					))}
					<label
						className="relative w-7 h-7 rounded-lg border-2 border-dashed border-gray-300 dark:border-[#4a1a24] cursor-pointer overflow-hidden"
						title="رنگ دلخواه"
					>
						<input
							type="color"
							aria-label="رنگ دلخواه"
							className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
							value={bg ?? '#ffffff'}
							onChange={(e) => patchStyle({ bg: e.target.value.toUpperCase() })}
						/>
						<span
							className="absolute inset-0 flex items-center justify-center text-[10px] font-DanaDemiBold"
							style={{ color: bg ? pickContrastText(bg) : '#9ca3af' }}
						>
							+
						</span>
					</label>
					{bg && (
						<button
							type="button"
							onClick={() => patchStyle({ bg: undefined })}
							className="px-2 py-1 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-red-400 cursor-pointer border border-gray-200 dark:border-[#3a151c]"
						>
							حذف رنگ
						</button>
					)}
					{bg && (
						<span
							className="flex items-center gap-1 text-[11px] text-gray-400 font-DanaMedium"
							dir="ltr"
						>
							<span
								className="inline-block rounded px-2 py-0.5 font-DanaDemiBold"
								style={{
									backgroundColor: bg,
									color: style.fg ?? pickContrastText(bg),
								}}
							>
								نمونه‌ی متن
							</span>
						</span>
					)}
				</div>
				{bg && (
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						<span className="text-[11px] text-gray-400 font-DanaMedium">
							رنگ متن:
						</span>
						<Pill
							active={style.fg === undefined}
							onClick={() => patchStyle({ fg: undefined })}
							title="انتخاب خودکار با کنتراست WCAG"
						>
							خودکار{' '}
							{style.fg === undefined
								? `(${pickContrastText(bg) === '#ffffff' ? 'سفید' : 'سیاه'})`
								: ''}
						</Pill>
						<Pill
							active={style.fg === '#ffffff'}
							onClick={() => patchStyle({ fg: '#ffffff' })}
						>
							سفید
						</Pill>
						<Pill
							active={style.fg === '#000000'}
							onClick={() => patchStyle({ fg: '#000000' })}
						>
							سیاه
						</Pill>
					</div>
				)}
				{showContrastWarn && (
					<p className="mt-1.5 text-[11px] text-amber-500 leading-relaxed">
						کنتراست این ترکیب پایین است (WCAG AA) — «خودکار» انتخابِ خواناتری
						می‌سازد.
					</p>
				)}
			</div>

			{/* پدینگ و چینش */}
			<div className="flex flex-wrap gap-4">
				<div>
					<p className="text-[11px] font-DanaDemiBold text-gray-500 dark:text-gray-400 mb-1.5">
						فاصله‌ی داخلی
					</p>
					<div className="flex gap-1.5">
						{(['sm', 'md', 'lg'] as const).map((p) => (
							<Pill
								key={p}
								active={(style.pad ?? 'md') === p}
								onClick={() => patchStyle({ pad: p })}
							>
								{p === 'sm' ? 'کم' : p === 'md' ? 'متوسط' : 'زیاد'}
							</Pill>
						))}
					</div>
				</div>
				<div>
					<p className="text-[11px] font-DanaDemiBold text-gray-500 dark:text-gray-400 mb-1.5">
						چینش محتوا
					</p>
					<div className="flex gap-1.5">
						<Pill
							active={(style.align ?? 'start') === 'start'}
							onClick={() => patchStyle({ align: 'start' })}
						>
							شروع
						</Pill>
						<Pill
							active={style.align === 'center'}
							onClick={() => patchStyle({ align: 'center' })}
						>
							وسط
						</Pill>
					</div>
				</div>
			</div>
		</div>
	)
}

// ═══════════════ ادیتورِ اصلی ═══════════════

export function ArticlePageBuilder({ doc, onChange }: BuilderProps) {
	const showToast = useToastStore((s) => s.showToast)
	// Upload callbacks can resolve after other edits or a block reorder.
	const docRef = useRef(doc)
	docRef.current = doc
	const commitDoc = useCallback(
		(next: ArticleBlocksDoc) => {
			docRef.current = next
			onChange(next)
		},
		[onChange],
	)

	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [settingsId, setSettingsId] = useState<string | null>(null)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [preview, setPreview] = useState<'desktop' | 'mobile'>('desktop')

	// DnD — HTML5 روی دسته؛ منطق فقط-محورِ Y (RTL-safe)
	const dragIdRef = useRef<string | null>(null)
	const [dropIndex, setDropIndex] = useState<number | null>(null)

	// Track content as well as structure, so undo never skips recent text edits.
	const historyRef = useRef<ArticleBlocksDoc[]>([])
	const [historyCount, setHistoryCount] = useState(0)

	const pushHistory = useCallback(() => {
		historyRef.current = [...historyRef.current.slice(-29), docRef.current]
		setHistoryCount(historyRef.current.length)
	}, [])

	const undo = useCallback(() => {
		const prev = historyRef.current.pop()
		setHistoryCount(historyRef.current.length)
		if (!prev) {
			showToast('چیزی برای واگرد نیست', 'error')
			return
		}
		commitDoc(prev)
	}, [commitDoc, showToast])

	// ── عملیات‌های ساختاری (همه قبل از تغییر، snapshot می‌گذارند) ──

	const addBlock = useCallback(
		(type: ArticleBlock['type']) => {
			if (doc.blocks.length >= 200) {
				showToast('حداکثر ۲۰۰ بلوک مجاز است', 'error')
				return
			}
			pushHistory()
			const block = makeBlock(type)
			const selectedIndex = doc.blocks.findIndex((b) => b.id === selectedId)
			const at = selectedIndex >= 0 ? selectedIndex + 1 : doc.blocks.length
			const blocks = [...doc.blocks]
			blocks.splice(Math.max(at, 0), 0, block)
			commitDoc({ ...doc, blocks })
			setSelectedId(block.id)
			if (type !== 'hero' && type !== 'divider') setPaletteOpen(false)
		},
		[doc, commitDoc, pushHistory, selectedId, showToast],
	)

	const removeBlock = useCallback(
		(index: number) => {
			pushHistory()
			const blocks = doc.blocks.filter((_, i) => i !== index)
			commitDoc({
				...doc,
				blocks: blocks.length > 0 ? blocks : emptyDoc().blocks,
			})
		},
		[doc, commitDoc, pushHistory],
	)

	const move = useCallback(
		(from: number, to: number) => {
			const next = moveBlock(doc, from, to)
			if (next !== doc) {
				pushHistory()
				commitDoc(next)
			}
		},
		[doc, commitDoc, pushHistory],
	)

	const duplicate = useCallback(
		(index: number) => {
			if (doc.blocks.length >= 200) {
				showToast('حداکثر ۲۰۰ بلوک مجاز است', 'error')
				return
			}
			pushHistory()
			commitDoc(duplicateBlock(doc, index))
		},
		[doc, commitDoc, pushHistory, showToast],
	)

	const patchProps = useCallback(
		(id: string, patch: PropsPatch) => {
			const current = docRef.current
			if (!current.blocks.some((block) => block.id === id)) return
			pushHistory()
			const blocks = current.blocks.map((b) => {
				if (b.id !== id) return b
				const nextProps = typeof patch === 'function' ? patch(b.props) : patch
				return { ...b, props: { ...b.props, ...nextProps } } as ArticleBlock
			})
			// ویرایشِ محتوا همین بلوک را «انتخاب» می‌کند (جای div تعاملی)
			setSelectedId(id)
			commitDoc({ ...current, blocks })
		},
		[commitDoc, pushHistory],
	)

	const patchStyle = useCallback(
		(index: number, patch: Partial<ArticleBlockStyle>) => {
			pushHistory()
			const blocks = doc.blocks.map((b, i) => {
				if (i !== index) return b
				const style = { ...(b.style ?? {}), ...patch }
				// undefined ها را پاک کن (حذف رنگ/متن دستی)
				for (const k of Object.keys(style) as (keyof ArticleBlockStyle)[]) {
					if (style[k] === undefined) delete style[k]
				}
				return {
					...b,
					style: Object.keys(style).length > 0 ? style : undefined,
				}
			})
			commitDoc({ ...doc, blocks })
		},
		[doc, commitDoc, pushHistory],
	)

	const setWidth = useCallback(
		(index: number, width: ArticleBlock['width']) => {
			pushHistory()
			commitDoc({
				...doc,
				blocks: doc.blocks.map((b, i) => (i === index ? { ...b, width } : b)),
			})
		},
		[doc, commitDoc, pushHistory],
	)
	const setAnim = useCallback(
		(index: number, anim: ArticleBlock['anim']) => {
			pushHistory()
			commitDoc({
				...doc,
				blocks: doc.blocks.map((b, i) => (i === index ? { ...b, anim } : b)),
			})
		},
		[doc, commitDoc, pushHistory],
	)

	// ── DnD handlers (پاک‌سازی در dragend — درسِ تحقیق #۲) ──

	const onHandleDragStart = useCallback((e: React.DragEvent, id: string) => {
		dragIdRef.current = id
		e.dataTransfer.setData('text/plain', id)
		e.dataTransfer.effectAllowed = 'move'
	}, [])

	const onHandleDragEnd = useCallback(() => {
		dragIdRef.current = null
		setDropIndex(null)
	}, [])

	const onCardDragOver = useCallback((e: React.DragEvent, index: number) => {
		if (!dragIdRef.current) return
		e.preventDefault()
		e.dataTransfer.dropEffect = 'move'
		const rect = e.currentTarget.getBoundingClientRect()
		const before = e.clientY < rect.top + rect.height / 2
		setDropIndex(before ? index : index + 1)
	}, [])

	const onCardDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			const dragId = dragIdRef.current
			const to = dropIndex
			onHandleDragEnd()
			if (!dragId || to === null) return
			const from = doc.blocks.findIndex((b) => b.id === dragId)
			if (from < 0) return
			// جایگاهِ پس از حذفِ خودش اصلاح می‌شود
			const adjusted = from < to ? to - 1 : to
			if (adjusted === from) return
			move(from, adjusted)
		},
		[doc.blocks, dropIndex, move, onHandleDragEnd],
	)

	const dropLine = (
		<div
			className="h-1 rounded-full bg-primary dark:bg-dark-primary/70 my-1"
			aria-hidden="true"
		/>
	)

	const textBlocks = useMemo(
		() =>
			doc.blocks.filter((b) =>
				Boolean(blocksToPlainText({ version: 1, blocks: [b] }).trim()),
			).length,
		[doc.blocks],
	)

	return (
		<div className="space-y-4">
			{/* ── هدرِ صفحه‌ساز ── */}
			<div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c]">
				<button
					type="button"
					onClick={() => setPaletteOpen((v) => !v)}
					className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs font-DanaDemiBold cursor-pointer hover:opacity-90 transition"
				>
					<Plus />
					افزودن بلوک
				</button>
				<button
					type="button"
					onClick={undo}
					disabled={historyCount === 0}
					title="واگرد آخرین تغییر متن، تصویر یا چیدمان"
					className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs font-DanaMedium text-gray-600 dark:text-gray-300 cursor-pointer hover:border-gray-400 dark:hover:border-[#4a1a24] transition disabled:opacity-40 disabled:cursor-not-allowed"
				>
					<ArrowsRotate />
					واگرد
				</button>
				<div className="flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c]">
					<button
						type="button"
						aria-pressed={preview === 'desktop'}
						onClick={() => setPreview('desktop')}
						className={cx(
							'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-DanaMedium cursor-pointer transition',
							preview === 'desktop'
								? 'bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary'
								: 'text-gray-400',
						)}
					>
						<Devices />
						دسکتاپ
					</button>
					<button
						type="button"
						aria-pressed={preview === 'mobile'}
						onClick={() => setPreview('mobile')}
						className={cx(
							'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-DanaMedium cursor-pointer transition',
							preview === 'mobile'
								? 'bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary'
								: 'text-gray-400',
						)}
					>
						📱 موبایل
					</button>
				</div>
				<span
					className="text-[11px] text-gray-400 font-DanaMedium mr-auto"
					dir="rtl"
				>
					{doc.blocks.length} بلوک · {textBlocks} متنی
					{textBlocks === 0 && (
						<span className="text-amber-500">
							{' '}
							— حداقل یک بلوکِ متنی لازم است
						</span>
					)}
				</span>
			</div>

			{/* ── پالت ── */}
			{paletteOpen && (
				<div className="p-3 rounded-xl border border-dashed border-primary/40 dark:border-dark-primary/40 bg-primary/3 dark:bg-dark-primary/3">
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
						{BLOCK_PALETTE.map((p) => {
							const Icon = PALETTE_ICONS[p.type]
							return (
								<button
									key={p.type}
									type="button"
									title={p.hint}
									onClick={() => addBlock(p.type)}
									className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] hover:border-primary dark:hover:border-dark-primary text-xs font-DanaMedium text-gray-600 dark:text-gray-300 cursor-pointer transition-colors"
								>
									<Icon />
									<span className="flex-1 text-right">{p.label}</span>
								</button>
							)
						})}
					</div>
					<p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
						بلوک بعد از بلوکِ انتخاب‌شده درج می‌شود (یا آخرِ صفحه). جابجایی: دسته‌ی ⠿
						یا دکمه‌های ↑/↓.
					</p>
				</div>
			)}

			{/* ── بوم — container-query: عرض‌ها به «کانتینرِ پیش‌نمایش» واکنش نشان می‌دهند ── */}
			<div
				className={cx(
					'ab-canvas space-y-3 transition-all mx-auto w-full',
					preview === 'mobile' ? 'max-w-105' : 'max-w-none',
				)}
				data-preview={preview}
			>
				{doc.blocks.map((block, index) => {
					const selected = selectedId === block.id
					const Icon = PALETTE_ICONS[block.type]
					const style = block.style ?? {}
					return (
						<div key={block.id}>
							{dropIndex === index && dropLine}
							<article
								onDragOver={(e) => onCardDragOver(e, index)}
								onDrop={onCardDrop}
								className={cx(
									'rounded-2xl border p-3 sm:p-4 transition-colors',
									selected
										? 'border-primary dark:border-dark-primary bg-primary/3 dark:bg-dark-primary/3'
										: 'border-gray-200 dark:border-[#3a151c] bg-white dark:bg-[#2a1015]',
								)}
								aria-label={`بلوک ${BLOCK_LABELS[block.type]}`}
							>
								{/* نوارِ بلوک: دسته + نوع + ابزارها */}
								<header className="flex items-center gap-1.5 mb-3">
									<button
										type="button"
										draggable
										onDragStart={(e) => onHandleDragStart(e, block.id)}
										onDragEnd={onHandleDragEnd}
										aria-label={`جابجایی بلوک ${BLOCK_LABELS[block.type]}`}
										title="بکش و رها کن (یا از ↑/↓ استفاده کن)"
										className="px-1.5 py-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing transition-colors"
									>
										⠿
									</button>
									<span className="flex items-center gap-1.5 text-[11px] font-DanaDemiBold text-gray-500 dark:text-gray-400 min-w-0">
										<Icon />
										{BLOCK_LABELS[block.type]}
										{index + 1}
									</span>
									<span className="flex-1" />
									<button
										type="button"
										aria-label="انتقال به بالا"
										disabled={index === 0}
										onClick={() => move(index, index - 1)}
										className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
									>
										<ArrowUp />
									</button>
									<button
										type="button"
										aria-label="انتقال به پایین"
										disabled={index === doc.blocks.length - 1}
										onClick={() => move(index, index + 1)}
										className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
									>
										<ArrowDown />
									</button>
									<button
										type="button"
										aria-label="دوبل‌کردن بلوک"
										title="دوبل‌کردن (با شناسه‌ی تازه)"
										onClick={() => duplicate(index)}
										className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer"
									>
										<Copy />
									</button>
									<button
										type="button"
										aria-label="حذف بلوک"
										onClick={() => removeBlock(index)}
										className="p-1.5 rounded-md text-gray-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
									>
										<Trash2 />
									</button>
									<button
										type="button"
										aria-expanded={settingsId === block.id}
										aria-label="تنظیمات نمایش بلوک"
										title="رنگ/عرض/انیمیشن/فاصله"
										onClick={() => {
											setSettingsId(settingsId === block.id ? null : block.id)
											setSelectedId(block.id)
										}}
										className={cx(
											'p-1.5 rounded-md cursor-pointer',
											settingsId === block.id
												? 'bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary'
												: 'text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1a0a0e]',
										)}
									>
										<Settings />
									</button>
								</header>

								{/* نوارِ زنده‌ی عرض — با container-query به پیش‌نمایش واکنش نشان می‌دهد */}
								<div
									className={cx('ab-width-bar', `ab-w-${block.width ?? 'lg'}`)}
									aria-hidden="true"
									title={`عرض در صفحه: ${block.width ?? 'lg'}`}
								/>

								{/* پیش‌نمایشِ زنده‌ی استایل (نوار رنگ) */}
								{style.bg && (
									<div
										className="mb-3 rounded-xl px-3 py-1.5 text-[11px] font-DanaMedium"
										style={{
											backgroundColor: style.bg,
											color: style.fg ?? pickContrastText(style.bg),
										}}
									>
										پس‌زمینه‌ی این بلوک در صفحه همین رنگ می‌شود
									</div>
								)}

								{/* فیلدهای محتوا — ویرایشِ فیلد، بلوک را انتخاب می‌کند (patchProps) */}
								<BlockFields
									block={block}
									patchProps={(patch) => patchProps(block.id, patch)}
								/>

								{/* تنظیماتِ نمایش */}
								{settingsId === block.id && (
									<BlockSettings
										block={block}
										patchStyle={(patch) => patchStyle(index, patch)}
										onWidth={(w) => setWidth(index, w)}
										onAnim={(a) => setAnim(index, a)}
									/>
								)}
							</article>
						</div>
					)
				})}
				{dropIndex === doc.blocks.length && dropLine}
				{doc.blocks.length === 0 && (
					<p className="text-center text-gray-400 text-sm py-8">
						بدون بلوک — از «افزودن بلوک» شروع کن.
					</p>
				)}
			</div>
		</div>
	)
}
