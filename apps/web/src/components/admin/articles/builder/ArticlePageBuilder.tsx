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
import {
	bindArticleBlockItemIdentities,
	contrastRatio,
	getArticleBlockTextFields,
	readArticleBlockText,
	pickContrastText,
} from '@sinshin/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useArabicBlockTranslations } from './useArabicBlockTranslations'

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
	requireText?: boolean
	docAr?: ArticleBlocksDoc | null
	onArabicChange?: (doc: ArticleBlocksDoc) => void
	translationEntityType?: 'article' | 'about'
	translationEntityId?: string
	initialDoc?: ArticleBlocksDoc | null
	initialDocAr?: ArticleBlocksDoc | null
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
									{ id: crypto.randomUUID(), src: url },
								],
							}))
						}
						onRemove={(index) => {
							const id = images[index]?.id
							if (id) patchProps(props => ({ images: 'images' in props ? props.images.filter(image => image.id !== id) : [] }))
						}}
					/>
					{images.length > 0 && (
						<div className="space-y-1.5">
							{images.map((im, i) => (
								<input
									key={im.id}
									className={inputCls}
									placeholder={`متن جایگزین عکس ${i + 1} (اختیاری)`}
									maxLength={200}
									value={im.alt ?? ''}
									onChange={(e) => {
										const alt = e.target.value
										patchProps(props => ({ images: 'images' in props ? props.images.map(image => image.id === im.id ? { ...image, alt } : image) : [] }))
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
			const itemIds = block.props.itemIds ?? []
			const moveItem = (itemId: string | undefined, direction: number) => {
				if (!itemId) return
				patchProps(props => {
					if (!('items' in props)) return {}
					const nextItems = [...props.items], nextIds = [...(props.itemIds ?? [])]
					const from = nextIds.indexOf(itemId), to = from + direction
					if (from < 0 || to < 0 || to >= nextItems.length) return {}
					const [text] = nextItems.splice(from, 1), [id] = nextIds.splice(from, 1)
					if (text === undefined || id === undefined) return {}
					nextItems.splice(to, 0, text); nextIds.splice(to, 0, id)
					return { items: nextItems, itemIds: nextIds }
				})
			}
			return (
				<div className="space-y-2">
					{items.map((text, index) => <div key={itemIds[index]} className="flex gap-1.5">
						<input className={inputCls} aria-label={`مورد ${index + 1}`} maxLength={300} value={text}
							onChange={event => {
								const id = itemIds[index], text = event.target.value
								if (id) patchProps(props => ({ items: 'items' in props ? props.items.map((value, position) => props.itemIds?.[position] === id ? text : value) : [] }))
							}} />
						<button type="button" aria-label="انتقال مورد به بالا" disabled={index === 0} onClick={() => moveItem(itemIds[index], -1)}><ArrowUp size={16} /></button>
						<button type="button" aria-label="انتقال مورد به پایین" disabled={index === items.length - 1} onClick={() => moveItem(itemIds[index], 1)}><ArrowDown size={16} /></button>
						<button type="button" aria-label="حذف مورد" onClick={() => {
							const id = itemIds[index]
							if (id) patchProps(props => 'items' in props ? { items: props.items.filter((_, position) => props.itemIds?.[position] !== id), itemIds: props.itemIds?.filter(itemId => itemId !== id) } : {})
						}}><Trash2 size={16} /></button>
					</div>)}
					<button type="button" className={inputCls} disabled={items.length >= 30} onClick={() => {
						const id = crypto.randomUUID()
						patchProps(props => 'items' in props && props.items.length < 30 ? { items: [...props.items, ''], itemIds: [...(props.itemIds ?? []), id] } : {})
					}}>افزودن مورد</button>
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

export function ArticlePageBuilder({
	doc: sourceDoc,
	onChange,
	requireText = true,
	docAr,
	onArabicChange,
	translationEntityType,
	translationEntityId,
	initialDoc,
	initialDocAr,
}: BuilderProps) {
	const doc = useMemo(() => bindArticleBlockItemIdentities(sourceDoc), [sourceDoc])
	const showToast = useToastStore((s) => s.showToast)
	// Upload callbacks can resolve after other edits or a block reorder.
	const docRef = useRef(doc)
	docRef.current = doc
	const mountedRef = useRef(true)
	useEffect(() => {
		mountedRef.current = true
		return () => {
			// About language changes replace this editor. Its pending uploads
			// must not publish a stale document over the replacement's edits.
			mountedRef.current = false
		}
	}, [])
	const arabic = useArabicBlockTranslations({
		doc: docRef,
		docAr,
		onChange: onArabicChange,
		mounted: mountedRef,
		showToast,
		translationEntityType,
		translationEntityId,
		initialDoc,
		initialDocAr,
	})
	const commitDoc = useCallback(
		(next: ArticleBlocksDoc) => {
			if (!mountedRef.current) return
			if (onArabicChange) arabic.sourceChanged(next)
			docRef.current = next
			onChange(next)
		},
		[onChange, onArabicChange, arabic.sourceChanged],
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
			const current = docRef.current
			if (current.blocks.length >= 200) {
				showToast('حداکثر ۲۰۰ بلوک مجاز است', 'error')
				return
			}
			pushHistory()
			const block = makeBlock(type)
			const selectedIndex = current.blocks.findIndex((b) => b.id === selectedId)
			const at = selectedIndex >= 0 ? selectedIndex + 1 : current.blocks.length
			const blocks = [...current.blocks]
			blocks.splice(Math.max(at, 0), 0, block)
			commitDoc({ ...current, blocks })
			setSelectedId(block.id)
			if (type !== 'hero' && type !== 'divider') setPaletteOpen(false)
		},
		[commitDoc, pushHistory, selectedId, showToast],
	)

	const removeBlock = useCallback(
		(id: string) => {
			const current = docRef.current
			if (!current.blocks.some(block => block.id === id)) return
			pushHistory()
			const blocks = current.blocks.filter(block => block.id !== id)
			commitDoc({
				...current,
				blocks: blocks.length > 0 ? blocks : emptyDoc().blocks,
			})
		},
		[commitDoc, pushHistory],
	)

	const move = useCallback(
		(id: string, direction: number) => {
			const current = docRef.current
			const from = current.blocks.findIndex(block => block.id === id)
			if (from < 0) return
			const next = moveBlock(current, from, from + direction)
			if (next !== current) {
				pushHistory()
				commitDoc(next)
			}
		},
		[commitDoc, pushHistory],
	)

	const duplicate = useCallback(
		(id: string) => {
			const current = docRef.current
			const index = current.blocks.findIndex(block => block.id === id)
			if (index < 0) return
			if (current.blocks.length >= 200) {
				showToast('حداکثر ۲۰۰ بلوک مجاز است', 'error')
				return
			}
			pushHistory()
			commitDoc(duplicateBlock(current, index))
		},
		[commitDoc, pushHistory, showToast],
	)

	const patchProps = useCallback(
		(id: string, patch: PropsPatch) => {
			if (!mountedRef.current) return
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
		(id: string, patch: Partial<ArticleBlockStyle>) => {
			const current = docRef.current
			if (!current.blocks.some(block => block.id === id)) return
			pushHistory()
			const blocks = current.blocks.map((b) => {
				if (b.id !== id) return b
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
			commitDoc({ ...current, blocks })
		},
		[commitDoc, pushHistory],
	)

	const setWidth = useCallback(
		(id: string, width: ArticleBlock['width']) => {
			const current = docRef.current
			if (!current.blocks.some(block => block.id === id)) return
			pushHistory()
			commitDoc({
				...current,
				blocks: current.blocks.map((b) => (b.id === id ? { ...b, width } : b)),
			})
		},
		[commitDoc, pushHistory],
	)
	const setAnim = useCallback(
		(id: string, anim: ArticleBlock['anim']) => {
			const current = docRef.current
			if (!current.blocks.some(block => block.id === id)) return
			pushHistory()
			commitDoc({
				...current,
				blocks: current.blocks.map((b) => (b.id === id ? { ...b, anim } : b)),
			})
		},
		[commitDoc, pushHistory],
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
			const current = docRef.current
			const from = current.blocks.findIndex((b) => b.id === dragId)
			if (from < 0) return
			const anchor = doc.blocks[to]?.id
			const destination = anchor ? current.blocks.findIndex(block => block.id === anchor) : current.blocks.length
			if (destination < 0) return
			// جایگاهِ پس از حذفِ خودش اصلاح می‌شود
			const adjusted = from < destination ? destination - 1 : destination
			if (adjusted === from) return
			move(dragId, adjusted - from)
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
					{requireText && textBlocks === 0 && (
						<span className="text-amber-500">
							{' '}
							— حداقل یک بلوکِ متنی لازم است
						</span>
					)}
				</span>
			</div>

			{onArabicChange && (
				<div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 dark:border-[#3a151c] p-3">
					<button
						type="button"
						disabled={arabic.busy}
						onClick={() => void arabic.translate()}
						className="px-3 py-2 rounded-lg bg-primary text-white text-xs cursor-pointer disabled:opacity-50"
					>
						{arabic.busy
							? 'در حال ترجمه...'
							: 'ترجمه خودکار همه بلوک‌ها به عربی'}
					</button>
					<button
						type="button"
						disabled={arabic.busy || arabic.changedCount === 0}
						onClick={() => void arabic.translateChanged()}
						className="px-3 py-2 rounded-lg border text-xs cursor-pointer disabled:opacity-50"
					>
						ترجمه فقط فیلدهای تغییرکرده
					</button>
					{arabic.changedCount > 0 && (
						<span className="text-xs text-amber-600">
							{arabic.changedCount} فیلد نیازمند ترجمه مجدد
						</span>
					)}
					<p className="text-xs text-gray-500">
						ترجمه‌های عربی را در هر بلوک بازبینی و ویرایش کنید. فیلد خالی از
						فارسی استفاده می‌کند.
					</p>
				</div>
			)}
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
										onClick={() => move(block.id, -1)}
										className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
									>
										<ArrowUp />
									</button>
									<button
										type="button"
										aria-label="انتقال به پایین"
										disabled={index === doc.blocks.length - 1}
										onClick={() => move(block.id, 1)}
										className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
									>
										<ArrowDown />
									</button>
									<button
										type="button"
										aria-label="دوبل‌کردن بلوک"
										title="دوبل‌کردن (با شناسه‌ی تازه)"
										onClick={() => duplicate(block.id)}
										className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer"
									>
										<Copy />
									</button>
									<button
										type="button"
										aria-label="حذف بلوک"
										onClick={() => removeBlock(block.id)}
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
								{onArabicChange && (
									<details
										className="mt-4 border-t border-gray-200 dark:border-[#3a151c] pt-3"
										data-arabic-block={block.id}
									>
										<summary className="cursor-pointer text-sm font-DanaMedium">
											ترجمه عربی · {BLOCK_LABELS[block.type]}
										</summary>
										<button
											type="button"
											disabled={arabic.busy}
											onClick={() => void arabic.translate(block.id)}
											className="my-3 px-3 py-2 rounded-lg border text-xs cursor-pointer disabled:opacity-50"
										>
											ترجمه خودکار به عربی
										</button>
										{getArticleBlockTextFields(block).map((field) => {
											const translated = arabic.draft?.blocks.find(
												(b) => b.id === block.id && b.type === block.type,
											)
											const status = arabic.status(block.id, field.path)
											const proof = arabic.draft?.translation?.fields.find(state => state.blockId === block.id && state.blockType === block.type
												&& JSON.stringify(state.fieldPath) === JSON.stringify(field.path))
											const progress = arabic.fieldState(block.id, field.path)
											const fieldError = progress.error ?? proof?.error
											const fieldId = `ar-${encodeURIComponent(block.id)}-${field.itemId ?? field.path.join('-')}`
											return (
												<div
													key={field.itemId ?? JSON.stringify(field.path)}
													data-arabic-field={JSON.stringify(field.path)}
													data-arabic-status={status}
													className="block my-3 text-xs text-gray-600 dark:text-gray-300"
												>
													<div className="flex flex-wrap items-center gap-2 mb-2">
														<label htmlFor={fieldId}>
															{field.label} (عربی)
														</label>
														<span
															className={
																status === 'needs-retranslation'
																	? 'text-amber-600'
																	: 'text-gray-400'
															}
														>
															{progress.busy ? 'در حال ترجمه...'
																: status === 'translated'
																? 'ترجمه‌شده'
																: status === 'needs-retranslation'
																	? proof?.origin === 'manual' || proof?.origin === 'legacy' ? 'نیازمند بازبینی' : 'نیازمند ترجمه مجدد'
																	: 'ترجمه نشده'}
														</span>
													{fieldError && !progress.busy && <span className="text-red-500" title={fieldError}>ترجمه ناموفق؛ دوباره تلاش کنید</span>}
														<button
															type="button"
															disabled={
																arabic.busy ||
																status === 'translated' ||
																!field.text.trim()
															}
															onClick={() =>
																void arabic.translate(block.id, field.path, field.itemId)
															}
															className="px-2 py-1 rounded-md border cursor-pointer disabled:opacity-50"
														>
															{progress.busy ? 'در حال ترجمه...' : fieldError ? 'تلاش مجدد این فیلد' : 'ترجمه این فیلد'}
														</button>
													</div>
													{field.text && (
														<span
															className="block my-1 whitespace-pre-line text-gray-400"
															lang="fa"
														>
															{field.text}
														</span>
													)}
													<textarea
														id={fieldId}
														lang="ar"
														dir="rtl"
														rows={field.maxLength > 500 ? 3 : 2}
														maxLength={field.maxLength}
														value={readArticleBlockText(translated, field.path)}
														className={inputCls}
														onChange={(e) =>
															arabic.edit(block.id, field.path, e.target.value, field.itemId)
														}
														placeholder="خالی = نمایش متن فارسی"
													/>
													{status === 'needs-retranslation' && proof?.staleValue && (
														<div className="mt-2 text-amber-600 whitespace-pre-line">
															<p>پیش‌نویس ترجمه قبلی: {proof.staleValue}</p>
															<button type="button" className="underline cursor-pointer" onClick={() => arabic.edit(block.id, field.path, proof.staleValue ?? '', field.itemId)}>
																بازبینی و استفاده از این پیش‌نویس
															</button>
														</div>
													)}
												</div>
											)
										})}
										{getArticleBlockTextFields(block).length === 0 && (
											<p className="text-xs text-gray-400">
												این بلوک متن قابل ترجمه ندارد.
											</p>
										)}
									</details>
								)}

								{/* تنظیماتِ نمایش */}
								{settingsId === block.id && (
									<BlockSettings
										block={block}
										patchStyle={(patch) => patchStyle(block.id, patch)}
										onWidth={(w) => setWidth(block.id, w)}
										onAnim={(a) => setAnim(block.id, a)}
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
