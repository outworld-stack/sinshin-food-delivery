// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 2 از 18
// مسیر مقصد: web/src/i18n/seo.ts
// وضعیت: فایل جدید — ایجاد شود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/i18n/seo.ts
// رارد ۳۸ — سئوی دوزبانه: دیکشنری تایپ‌شده‌ی متادیتای صفحات (fa + ar).
//
// فلسفه: «یک منبع حقیقت برای هر متنی که به کرالر/شبکه‌های اجتماعی می‌رسد».
// عنوان/توضیح/کلیدواژه/og همه از همین‌جا می‌آیند؛ lib/seo.ts فقط منطق
// ساختِ تگ هاست (canonical، hreflang، og:locale، JSON-LD) و هیچ متنی
// داخلش هاردکد نشده — یعنی تغییر برند/کپی سئو = فقط همین فایل.
//
// عربی برای مخاطب عراقی نوشته شده (عربی استاندارد مدرن + اصطلاحات رایج
// بازار عراق مثل «فود بارك» و «كود الإحالة») — هم‌خانواده‌ی دیکشنری‌های
// روندهای ۳۱-۳۵. فارسی دقیقاً همان رشته‌های سئو‌ی موجود است (رفتار
// صفر-تغییر برای نسخه‌ی فارسی).
import type { Lang } from './index'

/** متادیتای کامل یک صفحه‌ی ایندکس‌شونده */
export interface RouteSeo {
	title: string
	description: string
	/** og:type پیش‌فرض website است؛ about مقاله‌ای است */
	ogType?: 'website' | 'article'
	ogTitle: string
	ogDescription: string
	/** فقط home — alt تصویر og که در head ریشه مصرف می‌شود */
	ogImageAlt?: string
	keywords?: string
}

/** صفحات noindex فقط عنوان می‌خواهند — تب مرورگر */
export interface TitleOnlySeo {
	title: string
}

export interface SeoStrings {
	/** og:site_name + نام WebSite در JSON-LD */
	siteName: string
	/** پسوند برند عنوان‌های داینامیک: «${نام} | سین شین» */
	brand: string
	/** apple-mobile-web-app-title (عنوان اپ نصب‌شده روی هوم‌اسکرین) */
	appleTitle: string
	/** نام Restaurant در JSON-LD */
	restaurantName: string
	servesCuisine: string[]
	home: RouteSeo
	products: RouteSeo
	articles: RouteSeo
	gallery: RouteSeo
	about: RouteSeo
	login: TitleOnlySeo
	cart: TitleOnlySeo
	checkout: TitleOnlySeo
	geoBlocked: TitleOnlySeo
	notFoundProduct: TitleOnlySeo
	notFoundArticle: TitleOnlySeo
	/** نام‌های BreadcrumbList در JSON-LD صفحات محصول/مقاله */
	breadcrumb: { home: string; products: string; articles: string }
}

const fa: SeoStrings = {
	siteName: 'سین‌شین فودپارک',
	brand: '| سین شین',
	appleTitle: 'سین‌شین',
	restaurantName: 'سین‌شین',
	servesCuisine: ['فست‌فود', 'پیتزا', 'کباب', 'سوخاری', 'پاستا'],
	home: {
		title: 'سین شین | فودپارک آنلاین',
		description:
			'سفارش آنلاین غذا، پیتزا، فست‌فود و رستوران با تحویل سریع. ثبت‌نام با کد معرف و دریافت کیف پول.',
		keywords:
			'سین شین, فودپارک, سفارش آنلاین غذا, فست فود, رستوران, پیتزا, کد معرف',
		ogTitle: 'سین شین | فودپارک آنلاین',
		ogDescription: 'سفارش آنلاین غذا با تحویل سریع در فودپارک سین شین',
		ogImageAlt: 'سین‌شین فودپارک — سفارش آنلاین غذا',
	},
	products: {
		title: 'منو محصولات | سین شین',
		description:
			'لیست کامل محصولات فست‌فود و رستوران سین شین با بهترین قیمت و تحویل سریع.',
		keywords: 'منو سین شین, لیست محصولات, فست فود, پیتزا, برگر, کباب',
		ogTitle: 'منو محصولات | سین شین',
		ogDescription: 'لیست کامل محصولات سین شین با بهترین قیمت و تحویل سریع.',
	},
	articles: {
		title: 'مقالات | سین شین',
		description:
			'مقالات آموزشی و معرفی محصولات فودپارک سین شین — دستورپخت، نکات و راهنمای سفارش.',
		keywords: 'مقالات, دستورپخت, راهنمای سفارش, سین شین',
		ogTitle: 'مقالات | سین شین',
		ogDescription: 'مقالات آموزشی و معرفی محصولات فودپارک سین شین.',
	},
	gallery: {
		title: 'گالری سین‌شین | محیط و غذاها',
		description:
			'گالری تصاویر فودپارک سین‌شین — محیط آرام، غذاهای متنوع و لحظه‌های خوش.',
		keywords: 'گالری, تصاویر, محیط رستوران, غذاهای سین شین',
		ogTitle: 'گالری سین‌شین',
		ogDescription: 'گالری تصاویر فودپارک سین‌شین — محیط و غذاها.',
	},
	about: {
		title: 'درباره ما | سین‌شین فودپارک انزلی',
		description:
			'داستان سین‌شین از ۱۳۹۶ در انزلی — کافه‌رستوران متفاوت، طعم، کیفیت و نوستالژی',
		keywords: 'سین شین، انزلی، فود پارک، کافه، رستوران',
		ogType: 'article',
		ogTitle: 'درباره سین‌شین',
		ogDescription: 'داستان سین‌شین — کافه‌رستوران متفاوت',
	},
	login: { title: 'ورود / ثبت‌نام | سین شین' },
	cart: { title: 'سبد خرید | سین شین' },
	checkout: { title: 'تسویه حساب | سین شین' },
	geoBlocked: { title: 'دسترسی محدود | سین شین' },
	notFoundProduct: { title: 'محصول یافت نشد | سین شین' },
	notFoundArticle: { title: 'مقاله یافت نشد | سین شین' },
	breadcrumb: { home: 'خانه', products: 'منو', articles: 'مقالات' },
}

const ar: SeoStrings = {
	siteName: 'سين شين فود بارك',
	brand: '| سين شين',
	appleTitle: 'سين شين',
	restaurantName: 'سين شين',
	servesCuisine: ['وجبات سريعة', 'بيتزا', 'مشاوي', 'دجاج مقلي', 'معكرونة'],
	home: {
		title: 'سين شين | فود بارك — اطلب طعامك أونلاين',
		description:
			'اطلب طعامك أونلاين من سين شين: بيتزا، وجبات سريعة، مشاوي ومأكولات المطعم مع توصيل سريع. سجّل بكود الإحالة واحصل على رصيد في محفظتك.',
		keywords:
			'سين شين, فود بارك, طلب طعام أونلاين, مطعم, بيتزا, وجبات سريعة, كود إحالة',
		ogTitle: 'سين شين | فود بارك',
		ogDescription: 'اطلب طعامك أونلاين مع توصيل سريع من فود بارك سين شين',
		ogImageAlt: 'سين شين فود بارك — طلب الطعام أونلاين',
	},
	products: {
		title: 'قائمة الطعام | سين شين',
		description:
			'قائمة كاملة بأطباق المطعم والوجبات السريعة في سين شين بأفضل الأسعار وتوصيل سريع.',
		keywords: 'قائمة الطعام, منيو سين شين, وجبات سريعة, بيتزا, برجر, مشاوي',
		ogTitle: 'قائمة الطعام | سين شين',
		ogDescription: 'قائمة كاملة بأطباق سين شين بأفضل الأسعار وتوصيل سريع.',
	},
	articles: {
		title: 'المقالات | سين شين',
		description:
			'مقالات تعريفية بمنتجات فود بارك سين شين — وصفات، نصائح ودليل الطلب.',
		keywords: 'مقالات, وصفات, دليل الطلب, سين شين',
		ogTitle: 'المقالات | سين شين',
		ogDescription: 'مقالات تعريفية بمنتجات فود بارك سين شين.',
	},
	gallery: {
		title: 'معرض صور سين شين | الأجواء والأطباق',
		description:
			'معرض صور فود بارك سين شين — أجواء هادئة، أطباق متنوعة ولحظات سعيدة.',
		keywords: 'معرض صور, صور المطعم, أطباق سين شين',
		ogTitle: 'معرض صور سين شين',
		ogDescription: 'معرض صور فود بارك سين شين — الأجواء والأطباق.',
	},
	about: {
		title: 'من نحن | سين شين فود بارك',
		description:
			'قصة سين شين — مطعم مختلف بالمذاق والجودة وأجواء مميزة تستحق الزيارة.',
		keywords: 'سين شين, مطعم, من نحن, قصة المطعم',
		ogType: 'article',
		ogTitle: 'عن سين شين',
		ogDescription: 'قصة سين شين — مطعم مختلف',
	},
	login: { title: 'تسجيل الدخول / إنشاء حساب | سين شين' },
	cart: { title: 'سلة الطلب | سين شين' },
	checkout: { title: 'إتمام الطلب | سين شين' },
	geoBlocked: { title: 'الوصول مقيّد | سين شين' },
	notFoundProduct: { title: 'المنتج غير موجود | سين شين' },
	notFoundArticle: { title: 'المقال غير موجود | سين شين' },
	breadcrumb: {
		home: 'الرئيسية',
		products: 'قائمة الطعام',
		articles: 'المقالات',
	},
}

export const SEO: Record<Lang, SeoStrings> = { fa, ar }
