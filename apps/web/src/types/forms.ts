// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 41 از 49
// مسیر مقصد: apps/web/src/types/forms.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/types/forms.ts

// فیلدهای الزامی — فرم‌ها همیشه مقدار اولیه‌ی کامل می‌سازن؛
// اختیاری بودن تاریخی بود و مانع تایپ‌شدن میوتیشن‌ها (data: any) می‌شد.
// نتیجه: createArticle/createAdminProduct الان ورودی کاملاً تایپ‌دار می‌گیرن.
import type { ArticleBlocksDoc, Product } from '@sinshin/shared'
// stage-101 — قرارداد انیمیشن صفحه‌ی محصول ویژه (اختصاصیِ هر محصول)
import type { FeaturedAnimation } from '#/types/site/featured-animation'

export interface ArticleFormData {
	title: string
	author?: string // اختیاری — سرور/فرم پیش‌فرض «سین شین» می‌ذارن (به سرور ارسال نمی‌شه)
	excerpt: string
	content: string
	profileImage: string
	galleryImages: string[]
	categoryId: string
	// تایپ Article این فیلد رو اختیاری داره؛ فرم همیشه null می‌ذاره —
	// مسیرها موقع ارسال با ?? null نرمال می‌کنن (اسکیمای سرور null می‌خواد)
	subCategoryId?: string | null
	processes: { title: string; items: string[] }[]
	/** stage-60 — پرچم «ویژه/سنجاق» (۴ آیتم اول لیست + پس‌زمینه Aurora) */
	isFeatured: boolean
	/**
	 * stage-82 — سندِ بلوکیِ صفحه‌ساز؛ null = حالتِ «متن ساده»
	 * (در فرم: content از بلوک‌ها مشتق می‌شود — منبع واحد)
	 */
	blocks: ArticleBlocksDoc | null
	// ═══ round-34 — محتوای عربی (خالی = حذف ترجمه = بازگشت به فارسی) ═══
	titleAr: string
	excerptAr: string
	contentAr: string
	processesAr: { title: string; items: string[] }[]
	/** پرچم «ترجمه‌ی خودکار» رکورد (بج فرم — رارد ۳۵) */
	arAuto?: boolean
}

export interface ArticleFormProps {
	initialData?: ArticleFormData
	onSubmit: (data: ArticleFormData) => void
	isSubmitting: boolean
}

/**
 * stage-47 — سایز فرم محصول: قیمت + تخفیف مستقل (درصد + پنجره‌ی ISO).
 * window = null یعنی «بدون محدودیت زمانی» (تخفیف همیشه فعال).
 */
export interface ProductFormSize {
	name: string
	nameAr: string
	price: number
	/** درصد تخفیف این سایز (۰ = بدون تخفیف) */
	discountPercentage: number
	/** ISO میلادی | null — شروع پنجره‌ی تخفیف */
	discountStartsAt: string | null
	/** ISO میلادی | null — پایان پنجره‌ی تخفیف (شمارنده‌ی معکوس) */
	discountEndsAt: string | null
	/** stage-56 — تصویر مستقل این variant (آپلود؛ '' = بدون تصویر → تصویر مشترک محصول) */
	image: string
}

export interface ProductFormData {
	name: string
	description: string
	originalPrice: number
	discountPercentage: number
	/** stage-47 — پنجره‌ی تخفیف محصول بدون سایز (ISO | null = بدون محدودیت) */
	discountStartsAt: string | null
	discountEndsAt: string | null
	prepTime: number
	// stage-10: هزینه بسته‌بندی هر واحد — پیک و بیرون‌بر؛ سرو در محل ندارد
	// stage-84: اگر «قلم» انتخاب شده باشد، جمعِ اقلام به‌جای این مقدار اعمال می‌شود
	packagingCost: number
	/** stage-84 — اقلام بسته‌بندیِ انتخابی (id های packaging_items) */
	packagingItemIds: string[]
	/**
	 * stage-60 — همه‌ی دسته‌های این محصول (دسته‌ی اول = اصلی/مبنا؛ بقیه M2M).
	 * اولین عضو همان categoryId قبلی است و مبنای ارث‌بری حالت‌های سفارش.
	 */
	categoryIds: string[]
	/** stage-60 — پرچم «ویژه/سنجاق» (۴ آیتم اول لیست + پس‌زمینه Aurora) */
	isFeatured: boolean
	/**
	 * stage-101 — انیمیشن پس‌زمینه‌ی صفحه‌ی اختصاصیِ همین محصول ویژه:
	 * NULL = ارث از تنظیم سراسری (کارت تنظیمات)؛ مقدار = انتخاب اختصاصی
	 * ادمین در فرم (باکس زیر سوئیچ ویژه). فقط ادمین اصلی.
	 */
	featuredAnimation: FeaturedAnimation | null
	profileImage: string
	galleryImages: string[]
	sizesEnabled: boolean
	ingredients: string[]
	sizes: ProductFormSize[]
	/** stage-48 — موجودی فروش (پیش‌فرض true) */
	isAvailable: boolean
	/** stage-48 — پرچم‌های حالت سفارش (true = ارث از دسته؛ فقط محدودکردن مجاز) */
	courierAllowed: boolean
	takeawayAllowed: boolean
	dineInAllowed: boolean
	// ═══ round-34 — محتوای عربی (خالی = حذف ترجمه = بازگشت به فارسی) ═══
	nameAr: string
	descriptionAr: string
	/** هر خط = یک ماده اولیه (مثل ادیتور قوانین) — خالی = بازگشت به فارسی */
	ingredientsArText: string
	/** stage-56 — slug انگلیسی سئوپسند ('' = بدون slug → URL با UUID) */
	slug: string
}

export interface ProductFormProps {
	initialData?: Product | null
	onSubmit: (data: ProductFormData) => void
	isSubmitting: boolean
	/**
	 * stage-48 — اجازه‌ی نمایش سوئیچ موجودی (ادمین اصلی همیشه؛ ادمین۲ با
	 * productsAvailability). نیامد = اجازه (سازگاری).
	 */
	canToggleAvailability?: boolean
	/**
	 * stage-78 — اجازه‌ی نمایش سوئیچ «محصول ویژه» — فقط ادمین اصلی
	 * (بک هم پرچم را از ادمین۲ حذف می‌کند). نیامد = اجازه (سازگاری).
	 */
	canToggleFeatured?: boolean
	/**
	 * ترمیم اسکنِ استیج-۸۴ — اجازهٔ انتخابِ اقلامِ بسته‌بندی (جمعِ اقلام = هزینهٔ پولی):
	 * ادمین اصلی یا ادمین۲ با canEditPackagingFee. نیامد = اجازه
	 * (سازگاری) — بک هم بدونِ مجوز انتخاب را حذف می‌کند.
	 */
	canPickPackagingItems?: boolean
}
