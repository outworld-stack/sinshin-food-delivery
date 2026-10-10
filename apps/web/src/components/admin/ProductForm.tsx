// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery — فرم ادمین محصول
// مسیر مقصد: apps/web/src/components/admin/ProductForm.tsx
// تغییر: slug انگلیسی سئو + تصویر مستقل هر سایز —
//   • slug: فیلد جدا با «پیشنهاد از نام» و پیش‌نمایش /products/<slug>
//     (خالی = آدرس با UUID؛ گارد کلاینت: ^[a-zA-Z0-9-]+$ و ≤ ۸۰ نویسه)
//   • هر سایز: ImageField مستقل (خالی = تصویر مشترک محصول)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// stage-47 — sinshin-food-delivery — فایل ۶
// مسیر مقصد: apps/web/src/components/admin/ProductForm.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: تخفیف‌گذاری حتی با سایزبندی فعال —
//   • هر سایز: درصد تخفیف مستقل + سوییچ «تخفیف زمان‌دار»
//     (پیش‌فرض خاموش = تخفیف دائمی؛ روشن = پنجره‌ی شروع/پایان شمسی)
//   • محصول بدون سایز: همان سوییچ زمان‌دار روی تخفیف خود محصول
//   • پیش‌نمایش زنده: بج تخفیف + قیمت خط‌خورده + شمارنده‌ی معکوس
// ═══════════════════════════════════════════════════════════════

// src/components/admin/ProductForm.tsx

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
	Plus,
	X,
	CalendarX,
	Timer,
	Bicycle,
	Bag,
	Chair,
	BoxRemove,
} from 'reicon-react'
import { ProductCard } from '#/components/ProductCard'
import { ArField } from '#/components/admin/ArField'
import { ImageField } from '#/components/shared/ImageField'
import { PersianDatePicker } from '#/components/shared/PersianDatePicker'
import { Toggle } from '#/components/shared/Toggle'
import { useToastStore } from '#/stores/toastStore'
import type {
	ProductFormData,
	ProductFormSize,
	ProductFormProps,
} from '#/types/forms'
import { formatPrice } from '#/utils/format'
import {
	gregorianToJalali,
	jalaliFromISO,
	jalaliToGregorian,
	jalaliToISO,
} from '#/utils/persianDate'
import { adminCategoriesOptions } from '#/utils/queryOptions'

// ═══ stage-47 — ابزارهای پنجره‌ی زمانی تخفیف (شمسی ↔ ISO) ═══

const pad2 = (n: number) => String(n).padStart(2, '0')

/** ISO میلادی → { jalaliISO, time } — برای دیت‌پیکر و اینپوت ساعت */
function isoToJalaliParts(iso: string | null): {
	j: string | null
	time: string
} {
	if (!iso) return { j: null, time: '00:00' }
	const d = new Date(iso)
	if (Number.isNaN(d.getTime())) return { j: null, time: '00:00' }
	return {
		j: jalaliToISO(gregorianToJalali(d)),
		time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
	}
}

/** شمسی + ساعت → ISO میلادی (قرارداد سرور) */
function jalaliPartsToIso(j: string | null, time: string): string | null {
	if (!j) return null
	const parsed = jalaliFromISO(j)
	if (!parsed) return null
	const d = jalaliToGregorian(parsed)
	const [h, m] = time.split(':').map(Number)
	d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
	return d.toISOString()
}

/** سوییچ روشن شد → پنجره‌ی پیش‌فرض: از امروز ۰۰:۰۰ تا فردا ۲۳:۵۹ */
function defaultWindow(): { startsAt: string; endsAt: string } {
	const s = new Date()
	s.setHours(0, 0, 0, 0)
	const e = new Date()
	e.setDate(e.getDate() + 1)
	e.setHours(23, 59, 0, 0)
	return { startsAt: s.toISOString(), endsAt: e.toISOString() }
}

/** اعتبارسنجی پنجره: هر دو تاریخ باشند → پایان باید بعد از شروع باشد */
function windowValid(startsAt: string | null, endsAt: string | null): boolean {
	if (!startsAt || !endsAt) return true
	const s = new Date(startsAt).getTime()
	const e = new Date(endsAt).getTime()
	if (!Number.isFinite(s) || !Number.isFinite(e)) return true // خراب → سرور null می‌کند
	return e > s
}

/**
 * stage-56 — ساخت slug از نام: کوچک‌سازی، غیرِ [a-z0-9]+ → خط تیره
 * (تجمیع‌شده)، حذف خط تیره‌ی ابتدا/انتها، سقف ۸۰ نویسه (قرارداد سرور).
 */
const slugifyName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-') // غیر از حرف/عدد انگلیسی → '-' (تجمیع)
		.replace(/^-+|-+$/g, '') // خط تیره‌ی ابتدا/انتهایی حذف
		.slice(0, 80)

interface DiscountWindowEditorProps {
	startsAt: string | null
	endsAt: string | null
	onChange: (startsAt: string | null, endsAt: string | null) => void
	/** پیشوند id برای دیت‌پیکرها (یکتا در فرم) */
	idPrefix: string
	/** سوییچ غیرفعال (مثلاً درصد تخفیف صفر است) */
	disabled?: boolean
	/** حالت جمع‌وجور برای داخل کارت سایز */
	compact?: boolean
}

/**
 * stage-47 — ویرایشگر «تخفیف زمان‌دار»: سوییچ + دو ردیف شروع/پایان
 * (دیت‌پیکر شمسی + ساعت + دکمه‌ی پاک‌کردن). هر دو طرف اختیاری‌اند؛
 * خالی = آن طرف باز. سوییچ خاموش = پنجره‌ی null (تخفیف دائمی).
 */
function DiscountWindowEditor({
	startsAt,
	endsAt,
	onChange,
	idPrefix,
	disabled = false,
	compact = false,
}: DiscountWindowEditorProps) {
	const timed = startsAt !== null || endsAt !== null

	const startParts = isoToJalaliParts(startsAt)
	const endParts = isoToJalaliParts(endsAt)

	const handleToggle = () => {
		if (disabled) return
		if (timed) {
			onChange(null, null)
		} else {
			const w = defaultWindow()
			onChange(w.startsAt, w.endsAt)
		}
	}

	const label =
		'text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-1 block'
	const timeInput =
		'w-full px-2 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none cursor-pointer'

	return (
		<div className="space-y-2">
			<div
				className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border-2 transition ${
					timed
						? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
						: 'border-gray-200 dark:border-[#3a151c]'
				}`}
			>
				<div className="flex items-center gap-2 min-w-0">
					<Timer
						size={18}
						className={
							timed
								? 'text-primary dark:text-dark-primary shrink-0'
								: 'text-gray-400 shrink-0'
						}
					/>
					<div className="min-w-0">
						<p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200">
							تخفیف زمان‌دار
						</p>
						{!compact && (
							<p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
								{timed
									? 'تخفیف فقط در بازه‌ی زیر فعال است — شمارنده‌ی معکوس تا پایان روی کارت محصول نمایش داده می‌شود.'
									: 'خاموش: تخفیف دائمی و بدون شمارنده. روشن: انتخاب بازه‌ی شروع و پایان.'}
							</p>
						)}
					</div>
				</div>
				<Toggle isOn={timed} onToggle={handleToggle} disabled={disabled} />
			</div>

			{timed && (
				<div
					className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}
				>
					{/* شروع */}
					<div className="p-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c]">
						<span className={label}>شروع (خالی = همین حالا)</span>
						<div className="flex gap-1.5">
							<div className="flex-1 min-w-0">
								<PersianDatePicker
									id={`${idPrefix}-start`}
									value={startParts.j}
									onChange={(iso) =>
										onChange(jalaliPartsToIso(iso, startParts.time), endsAt)
									}
									placeholder="از امروز..."
								/>
							</div>
							<input
								type="time"
								dir="ltr"
								value={startParts.time}
								onChange={(e) =>
									onChange(
										jalaliPartsToIso(startParts.j, e.target.value),
										endsAt,
									)
								}
								className={`${timeInput} w-20 shrink-0`}
							/>
							{startsAt && (
								<button
									type="button"
									onClick={() => onChange(null, endsAt)}
									aria-label="حذف تاریخ شروع"
									title="حذف تاریخ شروع"
									className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg cursor-pointer shrink-0"
								>
									<CalendarX size={16} />
								</button>
							)}
						</div>
					</div>

					{/* پایان */}
					<div className="p-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c]">
						<span className={label}>پایان (خالی = بدون پایان)</span>
						<div className="flex gap-1.5">
							<div className="flex-1 min-w-0">
								<PersianDatePicker
									id={`${idPrefix}-end`}
									value={endParts.j}
									onChange={(iso) =>
										onChange(startsAt, jalaliPartsToIso(iso, endParts.time))
									}
									placeholder="تا کِی؟"
								/>
							</div>
							<input
								type="time"
								dir="ltr"
								value={endParts.time}
								onChange={(e) =>
									onChange(
										startsAt,
										jalaliPartsToIso(endParts.j, e.target.value),
									)
								}
								className={`${timeInput} w-20 shrink-0`}
							/>
							{endsAt && (
								<button
									type="button"
									onClick={() => onChange(startsAt, null)}
									aria-label="حذف تاریخ پایان"
									title="حذف تاریخ پایان"
									className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg cursor-pointer shrink-0"
								>
									<CalendarX size={16} />
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

// ═══ فرم اصلی ═══

const EMPTY_SIZE: ProductFormSize = {
	name: '',
	nameAr: '',
	price: 0,
	discountPercentage: 0,
	discountStartsAt: null,
	discountEndsAt: null,
	// stage-56 — تصویر مستقل این سایز (خالی = تصویر مشترک محصول)
	image: '',
}

export function ProductForm({
	initialData,
	onSubmit,
	isSubmitting,
	canToggleAvailability = true,
}: ProductFormProps) {
	// کتگوری‌ها از فکتوری مشترک (qk.categories) — همون کش فرم کوپن و فیلتر لیست‌ها
	const { data: categories } = useQuery(adminCategoriesOptions)
	const showToast = useToastStore((s) => s.showToast)

	const [formData, setFormData] = useState<ProductFormData>({
		name: '',
		description: '',
		// stage-56 — slug انگلیسی سئو (خالی = آدرس با UUID)
		slug: '',
		originalPrice: 0,
		discountPercentage: 0,
		// stage-47 — پنجره‌ی تخفیف محصول (null = دائمی)
		discountStartsAt: null,
		discountEndsAt: null,
		prepTime: 15,
		packagingCost: 0,
		categoryId: '',
		profileImage: '',
		galleryImages: [],
		ingredients: [],
		sizes: [],
		sizesEnabled: false, // ⬅ پیش‌فرض خاموش (پرسش ۱)
		// stage-48 — موجودی + حالت‌های سفارش (پیش‌فرض = ارث کامل از دسته)
		isAvailable: true,
		courierAllowed: true,
		takeawayAllowed: true,
		dineInAllowed: true,
		// round-34 — فیلدهای عربی (خالی = پشتیبان فارسی)
		nameAr: '',
		descriptionAr: '',
		ingredientsArText: '',
	})

	const [ingredientInput, setIngredientInput] = useState('')

	useEffect(() => {
		if (initialData) {
			setFormData({
				name: initialData.name || '',
				description: initialData.description || '',
				// stage-56 — slug سئو از سرور (null/نیامد = خالی)
				slug: initialData.slug ?? '',
				originalPrice: initialData.originalPrice || 0,
				discountPercentage: initialData.discountPercentage || 0,
				// stage-47 — هیدراته‌کردن پنجره‌ی زمانی از سرور
				discountStartsAt: initialData.discountStartsAt ?? null,
				discountEndsAt: initialData.discountEndsAt ?? null,
				prepTime: initialData.prepTime || 15,
				packagingCost: initialData.packagingCost || 0,
				categoryId: initialData.categoryId || '',
				profileImage: initialData.profileImage || '',
				galleryImages: initialData.galleryImages || [],
				ingredients: initialData.ingredients || [],
				sizes:
					initialData.sizes?.map((s) => ({
						name: s.name,
						nameAr: s.nameAr || '',
						price: s.price,
						// stage-47 — تخفیف مستقِ سایز از سرور
						discountPercentage: s.discountPercentage ?? 0,
						discountStartsAt: s.discountStartsAt ?? null,
						discountEndsAt: s.discountEndsAt ?? null,
						// stage-56 — تصویر مستقل این سایز از سرور
						image: s.image ?? '',
					})) || [],
				sizesEnabled: initialData.sizesEnabled ?? false,
				// stage-48 — موجودی + حالت‌های مؤثر (سروری) برای سوئیچ‌ها
				isAvailable: initialData.isAvailable ?? true,
				courierAllowed: initialData.courierAllowed ?? true,
				takeawayAllowed: initialData.takeawayAllowed ?? true,
				dineInAllowed: initialData.dineInAllowed ?? true,
				// round-34 — مقادیر عربی ذخیره‌شده (مواد اولیه: هر خط یک مورد)
				nameAr: initialData.nameAr || '',
				descriptionAr: initialData.descriptionAr || '',
				ingredientsArText: (initialData.ingredientsAr || []).join('\n'),
			})
		}
	}, [initialData])

	const handleChange = (
		e: React.ChangeEvent<
			HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
		>,
	) => {
		const { name, value, type } = e.target
		setFormData((prev) => ({
			...prev,
			[name]: type === 'number' ? Number(value) : value,
		}))
	}

	// دسته‌ی انتخابی + قالب نام سایزها
	const selectedCategory = categories?.find((c) => c.id === formData.categoryId)
	const sizeTemplate = selectedCategory?.hasSizes
		? (selectedCategory.sizeNames ?? [])
		: []

	// ── stage-48 — قیدهای دسته روی حالت‌های سفارش ──
	// دسته خاموش ⇒ سوئیچ محصول قفل و خاموش (محصول نمی‌تواند باز کند)
	const catCourier = selectedCategory?.courierEnabled ?? true
	const catTakeaway = selectedCategory?.takeawayEnabled ?? true
	const catDineIn = selectedCategory?.dineInEnabled ?? true

	/**
	 * تعویض دسته ⇒ حالت‌ها به ارثِ دسته‌ی جدید برمی‌گردند (پیش‌فرض)
	 * و محدودیت‌های پیشین پاک می‌شوند (به‌جز آنچه دسته اجازه می‌دهد).
	 */
	const handleCategoryChange = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			const nextId = e.target.value
			const nextCat = categories?.find((c) => c.id === nextId)
			setFormData((prev) => ({
				...prev,
				categoryId: nextId,
				// ارث از دسته‌ی تازه (نیامد = روشن — دسته legacy)
				courierAllowed: nextCat?.courierEnabled ?? true,
				takeawayAllowed: nextCat?.takeawayEnabled ?? true,
				dineInAllowed: nextCat?.dineInEnabled ?? true,
			}))
		},
		[categories],
	)

	/** سوئیچ حالت سفارش — فقط وقتی دسته روشنه اجازه‌ی خاموش/روشن دارد */
	const handleModeToggle = useCallback(
		(key: 'courierAllowed' | 'takeawayAllowed' | 'dineInAllowed') => {
			setFormData((prev) => ({ ...prev, [key]: !prev[key] }))
		},
		[],
	)

	/** سوئیچ موجودی — فقط با اجازه (ادمین۲ بدون productsAvailability نمی‌بیند) */
	const handleAvailabilityToggle = useCallback(() => {
		setFormData((prev) => ({ ...prev, isAvailable: !prev.isAvailable }))
	}, [])

	// --- سایزها ---
	const handleSizeChange = (
		index: number,
		field: keyof ProductFormSize,
		value: string | number,
	) => {
		const newSizes = [...(formData.sizes || [])]
		// @ts-expect-error — فیلدهای رشته/عدد ساده؛ فراخواننده مقدار درست می‌دهد
		newSizes[index][field] = value
		setFormData((prev) => ({ ...prev, sizes: newSizes }))
	}

	/** stage-47 — آپدیت پنجره‌ی زمانی تخفیف یک سایز */
	const handleSizeWindow = (
		index: number,
		startsAt: string | null,
		endsAt: string | null,
	) => {
		const newSizes = [...(formData.sizes || [])]
		newSizes[index] = {
			...newSizes[index],
			discountStartsAt: startsAt,
			discountEndsAt: endsAt,
		}
		setFormData((prev) => ({ ...prev, sizes: newSizes }))
	}

	/** stage-56 — تصویر مستقل این سایز (url = آپلود؛ '' = حذف → تصویر مشترک) */
	const handleSizeImage = (index: number, url: string) => {
		setFormData((prev) => {
			const next = [...(prev.sizes || [])]
			next[index] = { ...next[index], image: url }
			return { ...prev, sizes: next }
		})
	}

	const addSize = () =>
		setFormData((prev) => ({
			...prev,
			sizes: [...(prev.sizes || []), { ...EMPTY_SIZE }],
		}))
	const removeSize = (index: number) =>
		setFormData((prev) => ({
			...prev,
			sizes: prev.sizes?.filter((_, i) => i !== index) || [],
		}))

	// روشن کردن → اگه لیست خالیه و قالبی داریم، خودکار از قالب پر می‌کنیم
	const handleToggleSizes = useCallback(() => {
		setFormData((prev) => {
			const next = !prev.sizesEnabled
			if (next && (prev.sizes?.length ?? 0) === 0 && sizeTemplate.length > 0) {
				return {
					...prev,
					sizesEnabled: next,
					sizes: sizeTemplate.map((name) => ({ ...EMPTY_SIZE, name })),
				}
			}
			return { ...prev, sizesEnabled: next }
		})
	}, [sizeTemplate])

	/** stage-47 — پنجره‌ی تخفیف خود محصول */
	const handleProductWindow = useCallback(
		(startsAt: string | null, endsAt: string | null) => {
			setFormData((prev) => ({
				...prev,
				discountStartsAt: startsAt,
				discountEndsAt: endsAt,
			}))
		},
		[],
	)

	// stage-56 — «پیشنهاد از نام»: فقط وقتی نام حرف لاتین دارد فعال است
	const canSuggestSlug = /[a-zA-Z]/.test(formData.name)
	const handleSuggestSlug = () => {
		if (!canSuggestSlug) return
		setFormData((prev) => ({ ...prev, slug: slugifyName(prev.name) }))
	}

	// --- مواد اولیه ---
	const handleAddIngredient = () => {
		if (ingredientInput.trim()) {
			setFormData((prev) => ({
				...prev,
				ingredients: [...(prev.ingredients || []), ingredientInput.trim()],
			}))
			setIngredientInput('')
		}
	}

	// --- عکس‌ها ---

	// --- اعتبارسنجی و ارسال ---
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		if (!formData.categoryId) {
			showToast('دسته‌بندی محصول را انتخاب کنید.', 'error')
			return
		}

		if (!formData.ingredients || formData.ingredients.length < 2) {
			showToast('حداقل باید ۲ ماده اولیه برای محصول وارد کنید.', 'error')
			return
		}
		if (!formData.galleryImages || formData.galleryImages.length === 0) {
			showToast('افزودن حداقل یک عکس برای گالری محصول اجباری است.', 'error')
			return
		}

		// stage-56 — گارد کلاینت slug (سرور خودش sanitize می‌کند) —
		// فقط حروف/عدد انگلیسی و خط تیره؛ حداکثر ۸۰ نویسه
		const slugVal = formData.slug.trim()
		if (slugVal && !/^[a-zA-Z0-9-]+$/.test(slugVal)) {
			showToast('slug فقط می‌تواند حروف انگلیسی، عدد و خط تیره باشد.', 'error')
			return
		}
		if (slugVal.length > 80) {
			showToast('slug حداکثر ۸۰ نویسه می‌تواند باشد.', 'error')
			return
		}

		if (formData.sizesEnabled) {
			const sizes = formData.sizes ?? []
			if (sizes.length === 0) {
				showToast(
					'حداقل یک سایز تعریف کنید یا سایزبندی را خاموش کنید.',
					'error',
				)
				return
			}
			if (sizes.some((s) => !s.name.trim())) {
				showToast('نام همه‌ی سایزها را تعیین کنید.', 'error')
				return
			}
			if (sizes.some((s) => s.price <= 0)) {
				showToast('قیمت همه‌ی سایزها باید بیشتر از صفر باشد.', 'error')
				return
			}
			const names = sizes.map((s) => s.name.trim())
			if (new Set(names).size !== names.length) {
				showToast('نام سایزها نباید تکراری باشد.', 'error')
				return
			}
			// stage-47 — درصد تخفیف سایزها + پنجره‌ها
			if (
				sizes.some(
					(s) =>
						!Number.isFinite(s.discountPercentage) ||
						s.discountPercentage < 0 ||
						s.discountPercentage > 100,
				)
			) {
				showToast('درصد تخفیف سایزها باید بین ۰ تا ۱۰۰ باشد.', 'error')
				return
			}
			const badSizeWindow = sizes.find(
				(s) => !windowValid(s.discountStartsAt, s.discountEndsAt),
			)
			if (badSizeWindow) {
				showToast(
					`پنجره‌ی زمانی تخفیف سایز «${badSizeWindow.name}» نامعتبر است — پایان باید بعد از شروع باشد.`,
					'error',
				)
				return
			}
		} else {
			if (!formData.originalPrice || formData.originalPrice <= 0) {
				showToast('قیمت پایه محصول را وارد کنید.', 'error')
				return
			}
			// stage-47 — پنجره‌ی تخفیف محصول
			if (
				!Number.isFinite(formData.discountPercentage) ||
				formData.discountPercentage < 0 ||
				formData.discountPercentage > 100
			) {
				showToast('درصد تخفیف باید بین ۰ تا ۱۰۰ باشد.', 'error')
				return
			}
			if (!windowValid(formData.discountStartsAt, formData.discountEndsAt)) {
				showToast(
					'پنجره‌ی زمانی تخفیف نامعتبر است — پایان باید بعد از شروع باشد.',
					'error',
				)
				return
			}
		}

		onSubmit(formData)
	}

	// قیمت نمایشی پیش‌نمایش
	const previewFinalPrice = formData.sizesEnabled
		? (formData.sizes?.[0]?.price ?? 0)
		: Math.round(
				(formData.originalPrice || 0) *
					(1 - (formData.discountPercentage || 0) / 100),
			)

	// پیش‌نمایش کاملاً تایپ‌دار (قبلاً as any بود) —
	// دقیقاً همون ساختار ProductCardProps.product؛ سایزها id موقت می‌گیرن
	// stage-47 — فیلدهای تخفیف هم می‌روند تا بج/خط‌خوردگی/شمارنده در
	// پیش‌نمایش دقیقاً مثل کارت واقعی رندر شود
	const previewProduct = {
		id: 'preview',
		name: formData.name,
		description: formData.description,
		originalPrice: formData.originalPrice,
		finalPrice: previewFinalPrice,
		discountPercentage: formData.sizesEnabled ? 0 : formData.discountPercentage,
		discountStartsAt: formData.sizesEnabled ? null : formData.discountStartsAt,
		discountEndsAt: formData.sizesEnabled ? null : formData.discountEndsAt,
		profileImage: formData.profileImage || null,
		sizesEnabled: formData.sizesEnabled,
		// stage-48 — پیش‌نمایش بج‌ها/تاری با همان منطق کارت واقعی
		isAvailable: formData.isAvailable,
		courierAllowed: catCourier && formData.courierAllowed,
		takeawayAllowed: catTakeaway && formData.takeawayAllowed,
		dineInAllowed: catDineIn && formData.dineInAllowed,
		sizes: formData.sizes.map((s, i) => ({
			id: `preview-${i}`,
			name: s.name,
			price: s.price,
			discountPercentage: s.discountPercentage,
			discountStartsAt: s.discountStartsAt,
			discountEndsAt: s.discountEndsAt,
		})),
	}

	const isSizesOn = !!formData.sizesEnabled

	return (
		<form
			onSubmit={handleSubmit}
			className="grid grid-cols-1 lg:grid-cols-3 gap-8"
		>
			{/* ستون اصلی */}
			<div className="lg:col-span-2 space-y-6 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
				{/* ۱. عکس پروفایل */}
				<ImageField
					label="عکس پروفایل محصول (PNG)"
					accept="image/png"
					fileTypeText="PNG"
					images={formData.profileImage ? [formData.profileImage] : []}
					onAdd={(url) =>
						setFormData((prev) => ({ ...prev, profileImage: url }))
					}
					onRemove={() =>
						setFormData((prev) => ({ ...prev, profileImage: '' }))
					}
				/>

				{/* ۲. گالری */}
				<ImageField
					label="عکس‌های گالری (جهت اسلایدر - اجباری)"
					accept="image/webp"
					fileTypeText="افزودن WebP"
					multiple
					images={formData.galleryImages ?? []}
					onAdd={(url) =>
						setFormData((prev) => ({
							...prev,
							galleryImages: [...(prev.galleryImages || []), url],
						}))
					}
					onRemove={(index) =>
						setFormData((prev) => ({
							...prev,
							galleryImages:
								prev.galleryImages?.filter((_, i) => i !== index) || [],
						}))
					}
				/>

				{/* نام و دسته */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
							نام محصول
						</label>
						<input
							type="text"
							name="name"
							value={formData.name}
							onChange={handleChange}
							required
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none"
						/>
					</div>
					<div>
						<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
							دسته‌بندی
						</label>
						<select
							name="categoryId"
							value={formData.categoryId}
							onChange={handleCategoryChange}
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] outline-none cursor-pointer"
						>
							{categories?.map((cat) => (
								<option key={cat.id} value={cat.id}>
									{cat.name}
								</option>
							))}
						</select>
					</div>
				</div>

				{/* round-34 — نام عربی محصول (COALESCE: خالی = همان فارسی) */}
				<ArField
					label="نام محصول"
					value={formData.nameAr}
					onChange={(v) => setFormData((prev) => ({ ...prev, nameAr: v }))}
					arAuto={initialData?.arAuto}
					faReference={formData.name}
					maxLength={120}
				/>

				<div>
					<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
						توضیحات
					</label>
					<textarea
						name="description"
						value={formData.description}
						onChange={handleChange}
						rows={3}
						className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none resize-none"
					></textarea>
				</div>

				{/* round-34 — توضیحات عربی */}
				<ArField
					label="توضیحات"
					value={formData.descriptionAr}
					onChange={(v) =>
						setFormData((prev) => ({ ...prev, descriptionAr: v }))
					}
					arAuto={initialData?.arAuto}
					faReference={formData.description}
					multiline
					rows={3}
					maxLength={2000}
				/>

				{/* stage-56 — slug انگلیسی سئو (اختیاری؛ خالی = آدرس با UUID) */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<label
							htmlFor="product-slug"
							className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300"
						>
							slug انگلیسی (آدرس سئو)
						</label>
						{/* stage-56 — پیشنهاد از نام: فقط وقتی نام حرف لاتین دارد */}
						<button
							type="button"
							onClick={handleSuggestSlug}
							disabled={!canSuggestSlug}
							className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
						>
							پیشنهاد از نام
						</button>
					</div>
					<input
						id="product-slug"
						type="text"
						name="slug"
						dir="ltr"
						value={formData.slug}
						onChange={handleChange}
						placeholder="pepperoni-pizza"
						maxLength={80}
						className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none font-mono text-left"
					/>
					<p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
						فقط حروف انگلیسی کوچک، عدد و خط تیره — خالی بگذارید تا آدرس با
						شناسه‌ی پیش‌فرض بماند.
					</p>
					{/* stage-56 — پیش‌نمایش زنده‌ی آدرس — فقط وقتی slug پر است */}
					{formData.slug.trim() !== '' && (
						<p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 font-DanaMedium">
							آدرس: {' '}
							<span dir="ltr" className="font-mono">
								/products/{formData.slug.trim()}
							</span>
						</p>
					)}
				</div>

				{/* ⬅ سوئیچ سایزبندی — کلید اصلی (پرسش ۱) */}
				<div
					className={`flex items-center justify-between p-4 rounded-xl border-2 transition ${isSizesOn ? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5' : 'border-gray-200 dark:border-[#3a151c]'}`}
				>
					<div className="flex items-center gap-3">
						<span className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center font-DanaDemiBold">
							S
						</span>
						<div>
							<p className="font-DanaDemiBold text-gray-800 dark:text-white">
								قیمت‌گذاری با سایز
							</p>
							<p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
								{isSizesOn
									? 'هر سایز قیمت مستقل و تخفیف مستقل خودش را دارد — قیمت پایه و تخفیفِ محصول اعمال نمی‌شوند.'
									: 'خاموش: قیمت پایه + درصد تخفیف محصول. روشن: قیمت و تخفیف مستقل برای هر سایز.'}
							</p>
						</div>
					</div>
					<Toggle isOn={isSizesOn} onToggle={handleToggleSizes} />
				</div>

				{/* ── stage-48: موجودی + حالت‌های سفارش (ارث از دسته) ── */}
				<div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c] space-y-2">
					<p className="text-xs font-DanaDemiBold text-gray-600 dark:text-gray-300">
						موجودی و حالت‌های سفارش
					</p>

					{canToggleAvailability ? (
						<div
							className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition ${
								formData.isAvailable
									? 'border-green-200 bg-green-50/50 dark:border-green-500/20 dark:bg-green-500/5'
									: 'border-orange-300 bg-orange-50/60 dark:border-orange-500/30 dark:bg-orange-500/10'
							}`}
						>
							<div className="flex items-center gap-2.5 min-w-0">
								<span
									className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
										formData.isAvailable
											? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400'
											: 'bg-orange-100 text-orange-500 dark:bg-orange-500/10 dark:text-orange-400'
									}`}
								>
									<BoxRemove size={16} />
								</span>
								<div className="min-w-0">
									<p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200">
										موجود برای فروش
									</p>
									<p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
										{formData.isAvailable
											? 'قابل افزودن به سبد خرید.'
											: 'کارت محصول تار می‌شود، خرید قفل و چک‌اوت خطا می‌دهد.'}
									</p>
								</div>
							</div>
							<Toggle
								isOn={formData.isAvailable}
								onToggle={handleAvailabilityToggle}
							/>
						</div>
					) : null}

					{[
						{
							key: 'courierAllowed' as const,
							cat: catCourier,
							icon: Bicycle,
							title: 'ارسال با پیک',
							hint: 'پیک به آدرس مشتری.',
						},
						{
							key: 'takeawayAllowed' as const,
							cat: catTakeaway,
							icon: Bag,
							title: 'بیرون‌بر',
							hint: 'تحویل حضوری از سین‌شین.',
						},
						{
							key: 'dineInAllowed' as const,
							cat: catDineIn,
							icon: Chair,
							title: 'سرو در محل',
							hint: 'سرو سر میز — بدون بسته‌بندی.',
						},
					].map(({ key, cat, icon: Icon, title, hint }) => {
						const on = cat && formData[key]
						return (
							<div
								key={key}
								className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition ${
									cat
										? on
											? 'border-green-200 bg-green-50/50 dark:border-green-500/20 dark:bg-green-500/5'
											: 'border-red-200 bg-red-50/50 dark:border-red-500/20 dark:bg-red-500/5'
										: 'border-gray-200 bg-gray-50 dark:border-[#3a151c] dark:bg-[#1a0a0e] opacity-70'
								}`}
								title={
									!cat ? 'دسته‌بندی این حالت را غیرفعال کرده است' : undefined
								}
							>
								<div className="flex items-center gap-2.5 min-w-0">
									<span
										className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
											cat
												? on
													? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400'
													: 'bg-red-100 text-red-500 dark:bg-red-500/10 dark:text-red-400'
												: 'bg-gray-200 text-gray-400 dark:bg-white/5'
										}`}
									>
										<Icon size={16} />
									</span>
									<div className="min-w-0">
										<p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
											{title}
											{!cat && (
												<span className="text-[9px] text-gray-400 font-DanaMedium">
													(دسته: خاموش)
												</span>
											)}
										</p>
										<p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
											{!cat ? 'دسته‌بندی اجازه‌ی این حالت را نمی‌دهد.' : hint}
										</p>
									</div>
								</div>
								<Toggle
									isOn={on}
									disabled={!cat}
									onToggle={() => handleModeToggle(key)}
								/>
							</div>
						)
					})}
					<p className="text-[10px] text-gray-400 leading-relaxed">
						حالت روشن = ارث از دسته (پیش‌فرض)؛ خاموش کردن فقط محدود می‌کند. اگر
						دسته‌ای حالتی را نبندد، محصولاتش هم نمی‌توانند.
					</p>
				</div>

				{/* قیمت‌ها — با روشن بودن سایز، قفل */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
					<div>
						<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
							قیمت پایه (تومان){' '}
							{isSizesOn && (
								<span className="text-xs text-gray-400">
									(قفل — سایز مبناست)
								</span>
							)}
						</label>
						<input
							type="number"
							name="originalPrice"
							value={formData.originalPrice}
							onChange={handleChange}
							required={!isSizesOn}
							disabled={isSizesOn}
							className={`w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none ${isSizesOn ? 'opacity-50 cursor-not-allowed' : ''}`}
						/>
					</div>
					<div>
						<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
							تخفیف (%){' '}
							{isSizesOn && (
								<span className="text-xs text-gray-400">
									(قفل — تخفیف هر سایز پایین)
								</span>
							)}
						</label>
						<input
							type="number"
							name="discountPercentage"
							value={formData.discountPercentage}
							onChange={handleChange}
							min="0"
							max="100"
							disabled={isSizesOn}
							className={`w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none ${isSizesOn ? 'opacity-50 cursor-not-allowed' : ''}`}
						/>
					</div>
					<div>
						<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
							زمان آماده‌سازی
						</label>
						<input
							type="number"
							name="prepTime"
							value={formData.prepTime}
							onChange={handleChange}
							required
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none"
						/>
					</div>
					<div>
						<label
							htmlFor="packagingCost"
							className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2"
						>
							هزینه بسته‌بندی (تومان)
						</label>
						<input
							id="packagingCost"
							type="number"
							name="packagingCost"
							value={formData.packagingCost}
							onChange={handleChange}
							min="0"
							step="500"
							className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none"
						/>
						<p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
							به‌ازای هر واحد — در ارسال با پیک و بیرون‌بر اعمال می‌شود؛ سرو در محل
							بسته‌بندی ندارد.
						</p>
					</div>
				</div>

				{/* stage-47 — تخفیف زمان‌دار محصول (فقط وقتی سایز خاموش) */}
				{!isSizesOn && (
					<div className="border-t border-gray-100 dark:border-white/5 pt-4">
						<DiscountWindowEditor
							idPrefix="product-discount"
							startsAt={formData.discountStartsAt}
							endsAt={formData.discountEndsAt}
							onChange={handleProductWindow}
							disabled={!(formData.discountPercentage > 0)}
						/>
						{!(formData.discountPercentage > 0) && (
							<p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
								برای فعال‌سازی، ابتدا درصد تخفیف محصول را بیشتر از صفر وارد کنید.
							</p>
						)}
					</div>
				)}

				{/* ⬅ ویرایشگر سایزها — فقط وقتی فعال */}
				{isSizesOn && (
					<div className="border-t border-gray-100 dark:border-white/5 pt-6">
						<div className="flex items-center justify-between mb-4">
							<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
								سایزها، قیمت‌ها و تخفیف‌ها
								{sizeTemplate.length > 0 && (
									<span className="text-xs text-gray-400 mr-2">
										(قالب دسته: {sizeTemplate.length} سایز)
									</span>
								)}
							</label>
							<button
								type="button"
								onClick={addSize}
								className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer flex items-center gap-1"
							>
								<Plus size={14} /> افزودن سایز
							</button>
						</div>
						<div className="space-y-3">
							{formData.sizes?.map((size, index) => (
								<div
									key={index}
									className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] space-y-3"
								>
									{/* ردیف ۱: نام + نام عربی + قیمت + حذف */}
									<div className="grid grid-cols-12 gap-2 items-center">
										{sizeTemplate.length > 0 ? (
											<select
												value={size.name}
												onChange={(e) =>
													handleSizeChange(index, 'name', e.target.value)
												}
												className="col-span-4 px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
											>
												<option value="">انتخاب سایز...</option>
												{sizeTemplate.map((sn) => (
													<option key={sn} value={sn}>
														{sn}
													</option>
												))}
											</select>
										) : (
											<input
												type="text"
												value={size.name}
												onChange={(e) =>
													handleSizeChange(index, 'name', e.target.value)
												}
												placeholder="نام سایز (کوچک)"
												className="col-span-4 px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
											/>
										)}
										{/* round-34 — نام عربی سایز (اختیاری) */}
										<input
											type="text"
											dir="rtl"
											value={size.nameAr}
											onChange={(e) =>
												handleSizeChange(index, 'nameAr', e.target.value)
											}
											placeholder="نام عربی (اختیاری)"
											maxLength={60}
											className="col-span-3 px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
										/>
										<input
											type="number"
											placeholder="قیمت (تومان)"
											value={size.price}
											onChange={(e) =>
												handleSizeChange(index, 'price', e.target.value)
											}
											className="col-span-4 px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
										/>
										<button
											type="button"
											onClick={() => removeSize(index)}
											className="col-span-1 p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg cursor-pointer flex justify-center"
										>
											<X size={16} />
										</button>
									</div>

									{/* stage-56 — تصویر مستقل این سایز (اختیاری؛ خالی = تصویر مشترک) */}
									<div className="p-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c]">
										<ImageField
											label="تصویر این سایز (اختیاری)"
											accept="image/webp"
											fileTypeText="افزودن WebP"
											images={size.image ? [size.image] : []}
											onAdd={(url) => handleSizeImage(index, url)}
											onRemove={() => handleSizeImage(index, '')}
										/>
									</div>

									{/* ردیف ۲ (stage-47): تخفیف مستقِ این سایز + سوییچ زمان‌دار */}
									<div className="flex items-center gap-3">
										<div className="w-28 shrink-0">
											<label className="block text-[10px] font-DanaMedium text-gray-500 dark:text-gray-400 mb-1">
												تخفیف این سایز (%)
											</label>
											<input
												type="number"
												min="0"
												max="100"
												value={size.discountPercentage}
												onChange={(e) =>
													handleSizeChange(
														index,
														'discountPercentage',
														Math.max(
															0,
															Math.min(100, Number(e.target.value) || 0),
														),
													)
												}
												placeholder="0"
												className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
											/>
										</div>
										<div className="flex-1 min-w-0">
											<DiscountWindowEditor
												compact
												idPrefix={`size-${index}-discount`}
												startsAt={size.discountStartsAt}
												endsAt={size.discountEndsAt}
												onChange={(s, e) => handleSizeWindow(index, s, e)}
												disabled={!(size.discountPercentage > 0)}
											/>
										</div>
									</div>
								</div>
							))}
							{formData.sizes?.length === 0 && (
								<p className="text-xs text-gray-400 text-center py-2">
									هیچ سایزی تعریف نشده است — حداقل یک سایز لازم است.
								</p>
							)}
						</div>
					</div>
				)}

				{/* مواد اولیه */}
				<div className="border-t border-gray-100 dark:border-white/5 pt-6">
					<label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-1">
						محتویات محصول (اجباری)
					</label>
					<p className="text-[11px] text-red-400 mb-2 font-DanaMedium">
						حداقل باید نام ۲ ماده اولیه وارد شود.
					</p>

					<div className="flex flex-wrap gap-2 mb-3">
						{formData.ingredients?.map((ing, i) => (
							<div
								key={i}
								className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary dark:bg-dark-primary/10 dark:text-dark-primary text-xs"
							>
								{ing}
								<button
									type="button"
									onClick={() =>
										setFormData((prev) => ({
											...prev,
											ingredients:
												prev.ingredients?.filter((_, idx) => idx !== i) || [],
										}))
									}
									className="hover:opacity-70"
								>
									<X size={12} />
								</button>
							</div>
						))}
					</div>

					<div className="flex gap-2">
						<input
							value={ingredientInput}
							onChange={(e) => setIngredientInput(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
							placeholder="نام مواد اولیه را تایپ کنید..."
							className="flex-1 px-4 py-2 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-sm"
						/>
						<button
							type="button"
							onClick={handleAddIngredient}
							className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-700 dark:text-gray-300 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center gap-1"
						>
							<Plus size={16} /> افزودن
						</button>
					</div>

					{/* round-34 — مواد اولیه عربی (هر خط = یک ماده؛ موازی با چیپ‌های بالا) */}
					<div className="mt-4">
						<ArField
							label="محتویات محصول"
							value={formData.ingredientsArText}
							onChange={(v) =>
								setFormData((prev) => ({ ...prev, ingredientsArText: v }))
							}
							arAuto={initialData?.arAuto}
							faSource={(formData.ingredients ?? []).join('\n')}
							placeholder={
								(formData.ingredients ?? []).length > 0
									? `هر خط = معرب یکی از موارد بالا${formData.ingredients.length > 0 ? ` (مثلاً: ${formData.ingredients[0]})` : ''}`
									: 'هر خط = یک ماده اولیه به عربی — خالی = همان فارسی'
							}
							multiline
							rows={3}
						/>
					</div>
				</div>

				<div className="flex gap-3 pt-4">
					<Link
						to="/admin/products"
						className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium text-center cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition"
					>
						انصراف
					</Link>
					<button
						type="submit"
						disabled={isSubmitting}
						className="flex-1 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
					>
						{isSubmitting ? 'در حال ذخیره...' : 'ذخیره محصول'}
					</button>
				</div>
			</div>

			{/* پیش‌نمایش زنده */}
			<div className="lg:col-span-1">
				<div className="sticky top-6 space-y-4">
					<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white text-center">
						پیش‌نمایش زنده
					</h3>
					<div className="p-4 bg-gray-100 dark:bg-[#1a0a0e] rounded-2xl">
						{/* round-12 — interactive=false: لینک‌های preview با id سنتینل
                                'preview' نویز 422 و RouteError می‌ساختند */}
						<ProductCard product={previewProduct} interactive={false} />
					</div>
					<div className="bg-white dark:bg-[#2a1015] p-4 rounded-xl border border-gray-200 dark:border-[#3a151c] text-center">
						<p className="text-xs text-gray-400 mb-1">
							{isSizesOn ? 'قیمت اولین سایز:' : 'قیمت نهایی پایه:'}
						</p>
						<p className="font-MorabbaBold text-xl text-primary dark:text-dark-primary">
							{formatPrice(previewFinalPrice)} تومان
						</p>
					</div>
				</div>
			</div>
		</form>
	)
}