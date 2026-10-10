// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: packages/shared/src/contracts.ts
// تغییر: Product.slug + ProductSize.image + UserOrdersData/MyOrdersSort
//        (صفحه‌بندی سروریِ سفارشات من)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-43 — sinshin-food-delivery — فایل 1 از 14
// مسیر مقصد: packages/shared/src/contracts.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-eight
// ═══════════════════════════════════════════════════════════════

// packages/shared/src/contracts.ts
// قراردادهای API — منبع واحد حقیقت برای هر دو اپ
// ID های پاسخ برنددار — mirror دقیق schema بک‌اند؛ تایپ‌های درخواست
// (چک‌اوت/سبد) استثنا هستند: شکل خام سیم (رارد ۴۷)
// تغییر API → اینجا آپدیت → هر دو طرف type-error می‌گیرند
//
// ─── phase-0: حذف تعریف‌های تکراری ───
// نکته: اینترفیس‌های هم‌نام در TS «مرج» می‌شوند (نه ارور) و نوع
// فرانکن‌شتاین بی‌صدا می‌سازند. تکراری‌ها حذف و مترادف‌ها alias شدند.

// ─── قرارداد تاریخ (رارد ۴۷) ───
// فیلدهای Date در قراردادها «نوع منطقی»‌اند: تولیدکننده‌ی بک‌اند شیء Date
// می‌سازد و سریال‌ساز HTTP آن را روی سیم به رشته‌ی ISO تبدیل می‌کند؛
// مصرف‌کننده‌ی وب با fmt.date (هر دو شکل را می‌فهمد) یا new Date(...) در
// مرز می‌خواند. رشته‌ی ISO مستقیم فقط جایی است که خودِ تولیدکننده
// toISOString زده است (قوانین/درباره/مقالات/گزارشات).

import type {
  AddressId, CampaignId, CategoryId, ConditionId, CourierId, DeviceId,
  MainCategoryId, OrderId, ProductId, SizeId, UserId,
} from './brand'

// ═══════════ زبان ═══════════

/** رارد ۴۶ — زبان محتوا (fa پیش‌فرض؛ ar = لایه‌ی دوزبانه‌ی round-34).
 *  قبلاً در web/i18n و api/domain/shared/lang دو کپی مستقل بود؛ حالا منبع واحد. */
export type Lang = 'fa' | 'ar'

// ═══════════ احراز هویت ═══════════

/** رارد ۴۷ — نقش کاربر روی سیم — منبع واحد؛ قبلاً سیم رشته‌ی آزاد بود
 *  و انبار فرانت union محلی داشت. مقادیر مجاز = ستون role دیتابیس. */
export type Role = 'user' | 'admin' | 'admin2'

export interface AuthUser {
  id: UserId
  phone: string
  name: string | null
  role: Role
  referralCode: string | null
  createdAt: Date
  lastLoginAt: Date | null
}

/** round-28 — role حذف شد: چکِ قبل از احراز هویت نباید نقش کاربر را فاش کند؛
 *  نقش فقط در پاسخ تایید (VerifyOtpResponse.user.role) برمی‌گردد. */
export interface CheckPhoneResponse {
  isNewUser: boolean
  needsTerms: boolean
}

export interface RequestOtpResponse {
  sent: boolean
  cooldownSeconds: number
  devCode?: string
}

export interface VerifyOtpResponse {
  accessToken: string
  expiresIn: number
  isNewUser: boolean
  queueCount?: number
  user: AuthUser
  device: { id: DeviceId; name?: string | null }
}

// ═══════════ منو ═══════════

export interface MainCategory {
  id: MainCategoryId
  name: string
  /** round-34 — نام عربی (NULL = پشتیبان فارسی)؛ فقط ادمین پر می‌کند */
  nameAr?: string | null
  slug: string
  isActive: boolean
  isDefault: boolean
  sortOrder: number
}

export interface Category {
  id: CategoryId
  mainCategoryId: MainCategoryId
  name: string
  /** round-34 — نام عربی (NULL = پشتیبان فارسی) */
  nameAr?: string | null
  slug: string
  hasSizes: boolean
  sizeNames?: string[] | null
  /** round-34 — قالب نام سایزها به عربی (موازی با sizeNames) */
  sizeNamesAr?: string[] | null
  /**
   * stage-48 — حالت‌های سفارش پایه‌ی محصولاتِ این دسته (مبنا ارث‌بری).
   * مؤثرِ هر محصول = پرچم دسته AND پرچم خود محصول.
   */
  courierEnabled: boolean
  takeawayEnabled: boolean
  dineInEnabled: boolean
}

export interface ProductSize {
  id: SizeId
  name: string
  price: number
  /**
   * stage-47 — تخفیف مستقل این سایز:
   *  • discountPercentage: درصد تنظیم‌شده ادمین (۰ = بدون تخفیف)
   *  • discountActive: آیا الان داخل پنجره‌ی زمانی است؟ (پاسخ سرور)
   *  • finalPrice: قیمت مؤثر همین لحظه = round(price × (۱ − درصد فعال))
   *  • discountStartsAt / discountEndsAt: پنجره (null = بدون محدودیت)
   */
  discountPercentage: number
  discountActive: boolean
  finalPrice: number
  discountStartsAt?: string | null
  discountEndsAt?: string | null
  /** round-34 — نام عربی سایز (فقط پاسخ ادمین؛ NULL = پشتیبان فارسی) */
  nameAr?: string | null
  /**
   * stage-56 — تصویر مستقل این variant/سایز (آدرس آپلودشده؛ null = بدون
   * تصویر → گالری همان تصاویر مشترک محصول). انتخاب سایز → این تصویر اسلاید
   * نخستِ گالری می‌شود و در چیپ سایز بندانگشتی می‌گیرد.
   */
  image?: string | null
}

export interface Product {
  id: ProductId
  name: string
  /**
   * stage-56 — slug انگلیسیِ سئوپسند برای URL (/products/pepperoni-pizza).
   * null = بدون slug → URL همان UUID قبلی است. لینک‌های sitemap/canonical/
   * کارت‌ها slug را ترجیح می‌دهند؛ GET /menu/products/:id هر دو را می‌پذیرد.
   */
  slug?: string | null
  description: string | null
  originalPrice: number
  finalPrice: number
  discountPercentage: number
  /**
   * stage-47 — تخفیف زمان‌دار محصول (بدون سایز):
   *  • discountActive: تخفیف درصدی همین لحظه فعال است؟ (فارسی/عربی UI بج)
   *  • discountStartsAt / discountEndsAt: پنجره‌ی زمانی (null = همیشه)
   *  • finalPrice: با «درصدِ فعال» محاسبه می‌شود — خارج از پنجره = قیمت پایه
   */
  discountActive?: boolean
  discountStartsAt?: string | null
  discountEndsAt?: string | null
  /** stage-10: هزینه بسته‌بندی هر واحد — فقط DELIVERY/PICKUP */
  packagingCost: number
  categoryId: CategoryId
  categoryName?: string
  profileImage: string | null
  galleryImages: string[]
  sizesEnabled: boolean
  sizes: ProductSize[]
  ingredients: string[]
  prepTime: number
  views: number
  sales: number
  status: string
  /**
   * stage-48 — موجودیِ فروش (فعلاً ناموجود = false؛ جدا از status منو).
   * سرور روی هر پاسخ پرش می‌کند (منو/جزئیات/ادمین).
   */
  isAvailable: boolean
  /** stage-48 — حالت‌های مؤثر سفارش = دسته AND محصول (سروری) */
  courierAllowed: boolean
  takeawayAllowed: boolean
  dineInAllowed: boolean
  /**
   * stage-48 — فقط پاسخ ادمین (adminProductDetails): حالت‌های پایه‌ی دسته
   * برای قفل سوئیچ‌های فرم (دسته خاموش ⇒ محصول نمی‌تواند روشن کند).
   */
  categoryCourierEnabled?: boolean
  categoryTakeawayEnabled?: boolean
  categoryDineInEnabled?: boolean
  /** ═══ round-34 — لایه محتوای دوزبانه (فقط پاسخ ادمین پر می‌کند) ═══ */
  nameAr?: string | null
  descriptionAr?: string | null
  ingredientsAr?: string[] | null
  /** پرچم «ترجمه خودکار» — رارد ۳۵ (مترجم آفلاین) true می‌گذارد؛ ذخیره‌ی دستی ادمین false */
  arAuto?: boolean
}

export interface MainData {
  products: Product[]
  categories: Category[]
}

// ═══════════ سبد ═══════════

/** رارد ۴۷ — شکل خام سیم (شناسه‌های رشته‌ای) — هم‌شکل اسکیمای روت و
 *  کپی سرویس بک‌اند؛ قبلاً برنددار بود و مرز سرور فرانت مجبور به تبدیل نوع بود. */
export interface CartItemInput {
  productId: string
  sizeId?: string | null
  quantity: number
}

export interface CartItemDto {
  id: ProductId
  sizeId: SizeId | null
  sizeName: string | null
  name: string
  profileImage: string | null
  originalPrice: number
  finalPrice: number
  quantity: number
  lineTotal: number
  /** stage-48 — ناموجود: false ⇒ هشدار نارنجی + خارج از جمع + قفل پرداخت */
  available: boolean
  /** stage-48 — حالت‌های مؤثر سفارش (دسته AND محصول) */
  courierAllowed: boolean
  takeawayAllowed: boolean
  dineInAllowed: boolean
}

export interface CartDetails {
  items: CartItemDto[]
  total: number
}

// ═══════════ آدرس ═══════════

export interface AddressDto {
  id: AddressId
  /** رارد ۴۷ — همیشه روی سیم است (ردیف خام دیتابیس)؛ مالک آدرس = خودِ کاربر */
  userId: UserId
  title: string
  address: string
  lat: number
  lng: number
  createdAt: string
  updatedAt: string
}

// ═══════════ چک‌اوت / سفارش ═══════════

export type DeliveryType = 'DELIVERY' | 'PICKUP' | 'DINE_IN'

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'CONFIRMED'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELED'

export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED'


export interface OrderBreakdown {
  foodTotal: number
  discount: number
  walletDeduction: number
  deliveryFee: number
  packagingFee: number
  totalAmount: number
  amountPaidOnline: number
}

export interface CheckoutItemInput {
  productId: string
  sizeId?: string | null
  quantity: number
}

/** رارد ۴۷ — شکل خام سیم: هم‌شکل اسکیمای روت، سرویس بک‌اند و پیلود فرانت؛
 *  optional ها آینه‌ی روت‌اند (PICKUP/DINE_IN آدرس نمی‌فرستند). قبلاً
 *  برنددار بود و پیلود فرانت فیلدهایی را required کرده بود که سیم optional دارد. */
export interface CheckoutInput {
  items: CheckoutItemInput[]
  deliveryType: DeliveryType
  useWallet: boolean
  addressId?: string | null
  customerNote?: string | null
  couponCode?: string | null
  gatewayId?: string | null
}

/**
 * رارد ۴۳ — عمداً با «نوع» تعریف شده نه «اینترفیس»: پاسخ چک‌اوت در
 * جدول تکرارناپذیری مانند رکورد JSON ذخیره می‌شود؛ فقط نوعِ شیء‌محور
 * امضای ایندکس ضمنی دارد و مستقیم قابل انتساب است — اینترفیس نه.
 */
export type CheckoutResult = {
  orderCompleted: boolean
  orderId: string // displayId — قابل‌نمایش، برند ندارد
  requiresPayment: boolean
  paymentUrl?: string
  breakdown: OrderBreakdown
}

// ═══════════ پیش‌نمایش چک‌اوت (رارد ۴۳ — منبع واحد دو طرف) ═══════════

export interface CheckoutPreviewCoupon {
  code: string
  valid: boolean
  discount: number
  message?: string
}

export interface CheckoutPreviewItem {
  name: string
  sizeName: string | null
  unitPrice: number
  quantity: number
  /** stage-48 — ناموجود: هشدار نارنجی در چک‌اوت + قفل ثبت */
  available: boolean
  /** stage-48 — حالت‌های مؤثر سفارش (دسته AND محصول) */
  courierAllowed: boolean
  takeawayAllowed: boolean
  dineInAllowed: boolean
}

export interface CheckoutPreviewData {
  breakdown: OrderBreakdown
  items: CheckoutPreviewItem[]
  coupon: CheckoutPreviewCoupon | null
}

// ═══════════ User Order View (mapOne) ═══════════

export interface UserOrderItem {
  productId: ProductId | null
  sizeId: SizeId | null
  sizeName: string | null
  name: string
  quantity: number
  price: number
}

export interface UserOrder {
  id: string // displayId — ord-xxxxxxxx
  date: Date
  totalAmount: number
  itemCount: number
  address: string | null
  courierName: string | null
  courierPhone: string | null
  status: OrderStatus
  deliveryType: DeliveryType
  items: UserOrderItem[]
  courierLocation?: { lat: number; lng: number } | null
  customerLocation?: { lat: number; lng: number } | null
  referralProfit: number
  userFeedback?: string | null
  customerNote?: string | null
  paymentStatus: string
  breakdown: OrderBreakdown
  queued: boolean
}

/**
 * stage-56 — مرتب‌سازی سروریِ «سفارشات من» — همان مقادیرِ sort صفحه‌ی
 * داشبورد (کلیدهای i18n موجود)؛ پیش‌فرض newest.
 */
export type MyOrdersSort = 'newest' | 'oldest' | 'expensive' | 'cheap'

/**
 * stage-56 — صفحه‌بندی سروریِ «سفارشات من» (GET /orders?page&limit&sort):
 *  • orders: ردیف‌های همان صفحه (newest اول به‌جز sortهای دیگر)
 *  • total: کل سفارش‌های کاربر (بدون سقف ۲۰۰) — مبنای شمار صفحات
 *  • totalSpent: جمع مبلغ همه‌ی سفارش‌ها (همان چیزی که قبلاً ردیف‌های
 *    سقف‌دار در کلاینت جمع می‌زدند — الان از SQL واقعی می‌آید)
 */
export interface UserOrdersData {
  orders: UserOrder[]
  total: number
  totalSpent: number
}

// ═══════════ کیف پول ═══════════

export type WalletTxType = 'DEPOSIT' | 'WITHDRAW'

export interface WalletTransactionDto {
  id: string
  type: WalletTxType
  amount: number
  date: Date
  description: string
  orderId?: string | null // displayId یا null
}

export interface ReferralRowDto {
  id: UserId
  phone: string
  registerDate: Date
  totalOrders: number
  totalSpent: number
  myProfit: number
}

// ═══════════ پروفایل ═══════════

export interface DeviceDto {
  id: DeviceId
  name: string
  platform: string | null
  riskScore: number
  lastActiveAt: Date
  createdAt: Date
  current: boolean
}

export interface UserProfileDto {
  id: UserId
  phone: string
  email: string | null
  name: string | null
  walletBalance: number
  referralCode: string | null
  referralLink: string
  referrerCode: string | null
  totalReferralProfit: number
  joinedAt: Date
  devices: DeviceDto[]
  recentOrders: UserOrder[]
  allOrders: UserOrder[]
  addresses: AddressDto[]
  myReferrals: ReferralRowDto[]
  walletTransactions: WalletTransactionDto[]
}

// ═══════════ نظر ═══════════

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface ProductReviewDto {
  id: string
  /** شناسه‌ی UUID سفارش — این اندپوینت عمومی است و خام می‌فرستد؛
   *  نسخه‌ی ادمین (AdminReviewDto) displayId می‌فرستد */
  orderId: OrderId
  productId: ProductId
  /** عمومی همیشه null می‌فرستد (نام نمایشی از firstName/lastName ساخته می‌شود) */
  productName: string | null
  firstName: string | null
  lastName: string | null
  /** ماسک‌شده در اندپوینت عمومی؛ کامل فقط در AdminReviewDto */
  phone: string
  comment: string
  date: Date
  status: ReviewStatus
}

/** رارد ۴۷ — ردیف مودریشن ادمین (GET /admin/reviews) — جدا از نسخه‌ی عمومی:
 *  orderId این‌جا displayId است، productName همیشه پر است و شماره کامل است. */
export interface AdminReviewDto {
  id: string
  orderId: string
  productId: ProductId
  productName: string
  firstName: string | null
  lastName: string | null
  phone: string
  comment: string
  date: Date
  status: ReviewStatus
}

// ═══════════ کوپن‌ها ═══════════

export type CouponConditionType =
  | 'MIN_ORDERS_COUNT'
  | 'MIN_TOTAL_SPEND'
  | 'MIN_PRODUCT_ORDERS'
  | 'MIN_CATEGORY_ORDERS'
  | 'REGISTERED_DAYS_AGO'
  | 'MIN_REFERRALS'
  | 'MIN_REFERRAL_ORDERS'
  | 'MIN_REFERRAL_SPEND'
  | 'ORDERS_IN_LAST_DAYS'

export interface CouponRule {
  type: CouponConditionType
  value: string | number
  quantity?: number
}

// ═══════════ Articles (ادغام دو بخش تکراری — نسخه‌ی کامل) ═══════════

export interface ArticleSubCategoryDto {
  id: string
  name: string
  /** round-34 — نام عربی (فقط برای فرم ادمین؛ NULL = پشتیبان فارسی) */
  nameAr?: string | null
  slug: string
}

export interface ArticleCategoryDto {
  id: string
  name: string
  /** round-34 — نام عربی (فقط برای فرم ادمین؛ NULL = پشتیبان فارسی) */
  nameAr?: string | null
  slug: string
  hasSubCategories: boolean
  /** رارد ۴۷ — همیشه آرایه است (شاید خالی)؛ قبلاً optional بود و با تولیدکننده دریفت داشت */
  subCategories: ArticleSubCategoryDto[]
}

export interface ArticleDto {
  id: string
  title: string
  excerpt: string
  content: string
  author: string
  profileImage?: string | null
  galleryImages: string[]
  categoryId: string
  subCategoryId?: string | null
  processes: { title: string; items: string[] }[]
  views: number
  status: string
  /** رارد ۴۷ — تولیدکننده همیشه می‌فرستد (toISOString)؛ قبلاً optional بود */
  publishedAt: string
  /** رارد ۴۷ — دسته/زیردسته ممکن است نباشد: null نه undefined (آینه‌ی تولیدکننده) */
  categorySlug: string | null
  categoryName: string | null
  subCategorySlug: string | null
  subCategoryName: string | null
  /** ═══ round-34 — لایه محتوای دوزبانه (فقط پاسخ ادمین پر می‌کند) ═══ */
  titleAr?: string | null
  excerptAr?: string | null
  contentAr?: string | null
  processesAr?: { title: string; items: string[] }[] | null
  arAuto?: boolean
}

/**
 * round-17 — آیتم لیست مقالات: ArticleDto بدون content و processes و
 * galleryImages (بارِ سنگینِ متنی). اندپوینت‌های «لیست» این را برمی‌گردانند؛
 * «جزئیات» همان ArticleDto کامل. کامپایلر جابه‌جایی اشتباه را می‌گیرد.
 */
export type ArticleSummaryDto = Omit<
  ArticleDto,
  'content' | 'processes' | 'galleryImages'
>

// ═══════════ تنظیمات / رستوران ═══════════

export interface RestaurantStatusDto {
  isOpen: boolean
  temporarilyClosed: boolean
  temporaryCloseReason: string | null
  /** round-29 — زمان باز شدن مجددِ بسته‌ی موقت ('' = ثبت نشده) — جدا از nextOpenTime ساعتی */
  temporaryReopenTime: string
  nextOpenTime: string
  anyClosed: boolean
}

/** رارد ۴۷ — نمای نمایشی وضعیت رستوران در چک‌اوت — view-model عمدی:
 *  «بسته‌ی ساعتی» و «بسته‌ی موقت» (round-29) در یک isOpen ادغام می‌شوند و
 *  علت/زمانِ موقت بر ساعت اصلی مقدم است. مبدل در server/checkout فرانت است. */
export interface RestaurantStatusDisplay {
  isOpen: boolean
  nextOpenTime: string
  closeReason: string | null
}

// ═══════════ Geo (رارد ۳۷ — قفل جغرافیایی) ═══════════
// رارد ۴۶ — قبلاً geo.service بک‌اند و admin/geoGate فرانت کپی‌های موازی
// داشتند؛ حالا قرارداد واحد (شکل‌ها بایت‌به‌بایت همان قبل — فقط جابه‌جایی تعریف).

/** round-37 — دامنه‌ی ورود کاربران خارج از ایران (وقتی قفلِ فقط ایران خاموش است) */
export type OutsideScope = 'iraq' | 'world'

/** round-37 — حالت نهایی دروازه؛ ترکیب کلید + دامنه برای نمایش/پیام‌ها */
export type GeoAccessMode = 'iran-only' | 'iran-iraq' | 'world'

/** round-37 — پاسخ /geo/gate برای لایه‌ی SSR فرانت (blocked + mode پیام درست) */
export interface GeoGateVerdict {
  blocked: boolean
  mode: GeoAccessMode
}

/** round-37 — وضعیت زنده‌ی دروازه برای کارت تنظیمات (رنج‌ها/منبع/به‌روزرسانی) */
export interface GeoStatusDto {
  enabled: boolean
  /** round-37 — حالت نهایی دروازه برای پنل/پیام‌ها */
  mode: GeoAccessMode
  /** round-37 — دامنه‌ی خارج از ایران ('iraq' | 'world') */
  outsideScope: OutsideScope
  rangesLoaded: boolean
  rangesLoadedAt: string | null
  /** آخرین منبعی که بازه‌ها را داده (برای پنل ادمین) */
  source: string | null
  /** round-37 — آمار به تفکیک کشور */
  iran: { ipv4Prefixes: number; ipv6Prefixes: number }
  iraq: { ipv4Prefixes: number; ipv6Prefixes: number }
  /** فیلدهای قدیمی (سازگاری با مصرف‌کننده‌های قبلی) = آمار ایران */
  ipv4Prefixes: number
  ipv6Prefixes: number
  bypassIps: number
}

// ═══════════ نواحی ارسال ═══════════

/** رارد ۴۶ — ناحیه‌ی ارسال (شعاع + نرخ) — قبلاً سه کپی: سرویس بک‌اند،
 *  لایه‌ی سرور فرانت و رابط کامپوننت مدیر؛ حالا منبع واحد */
export interface DeliveryZone {
  radiusKm: number
  fee: number
}

export interface DeliveryZonesData {
  zones: DeliveryZone[]
  /** round-13 — مبدأ واقعی محاسبه‌ی فاصله (env > تنظیمات > پیش‌فرض) */
  origin?: { lat: number; lng: number }
}

// ═══════════ پرداخت / رابط چک‌اوت ═══════════

// phase-0: قبلاً کپیِ تکراری از CheckoutInput/Result بودند
export type CheckoutRequest = CheckoutInput
export type CheckoutResponse = CheckoutResult

// ═══════════ گالری ═══════════

/** رارد ۴۶ — پهنای تصویر در گرید گالری — قبلاً در تایپ‌های محلی فرانت
 *  و دو امضای درون‌خطی سرور تکرار می‌شد؛ حالا منبع واحد */
export type GallerySpan = 'wide' | 'normal'

export interface GalleryImageDto {
  id: string
  src: string
  alt: string
  /** round-34 — متن جایگزین عربی (NULL = پشتیبان فارسی) */
  altAr?: string | null
  /** پرچم «ترجمه خودکار» — رارد ۳۵ */
  arAuto?: boolean
  span: GallerySpan
  sortOrder: number
  isActive: boolean
}

// ═══════════ قوانین ═══════════

export interface TermsSection {
  title: string
  items: string[]
}

export interface TermsContentDto {
  sections: TermsSection[]
  /** round-34 — بندهای عربی (NULL = پشتیبان فارسی)؛ ساختار موازی sections */
  sectionsAr?: TermsSection[] | null
  /** پرچم «ترجمه خودکار» — رارد ۳۵ */
  arAuto?: boolean
  version: number
  updatedAt: string
}

// ═══════════ درباره ═══════════

export interface AboutContentDto {
  id: number
  heroTitle: string
  heroText: string
  heroGradient: string
  teamTitle: string
  teamGradient: string
  teamAlt: string
  /** ═══ round-34 — لایه محتوای دوزبانه (گرادیانت‌ها ترجمه نمی‌شوند) ═══ */
  heroTitleAr?: string | null
  heroTextAr?: string | null
  teamTitleAr?: string | null
  teamAltAr?: string | null
  /** پرچم «ترجمه خودکار» — رارد ۳۵ */
  arAuto?: boolean
  updatedAt: string
}

// ═══════════ کوپن‌ها (ادمین) ═══════════

export interface CouponWithConditionsDto {
  coupon: {
    id: CampaignId
    code: string
    title: string | null
    discountPercentage: number
    maxUses: number
    usedCount: number
    isPublic: boolean
    isActive: boolean
    /** stage-48 — عضویت در فرآیند کرون‌جاب کوپن‌ها (اسکن/یادآور) */
    cronEnabled: boolean
    startsAt: string
    endsAt: string | null
    /** رارد ۴۷ — همیشه روی سیم است (ردیف خام دیتابیس)؛ قبلاً در قرارداد جا افتاده بود */
    createdAt: string
  }
  conditions: Array<{ id: ConditionId; type: CouponConditionType; params: Record<string, unknown> }>
  /**
   * phase-9: تعداد گیرندگان فعلی — برای عمومی «-» است ولی برای خصوصی
   * شمارش coupon_grants است (خروجی موتور کمپین / اعطای لحظه‌ای).
   */
  recipientsCount: number
}

// ═══════════ ادمین: کاربران (ادغام — نسخه‌ی غنی با firstName/lastName) ═══════════

/** رارد ۴۷ — مرتب‌سازی لیست کاربران ادمین — منبع واحد؛ فقط اولین معیار
 *  اعمال می‌شود (رفتار موجود سرویس). قبلاً union محلی سرویس بود. */
export interface AdminUserSort {
  field: 'registeredAt' | 'walletBalance' | 'totalSpent'
  dir: 'asc' | 'desc'
}

export interface AdminUserRow {
  id: UserId
  firstName: string | null
  lastName: string | null
  phone: string
  device: string
  status: string
  walletBalance: number
  totalSpent: number
  registeredAt: Date
  /** رارد ۴۳ — همیشه ارسال می‌شود؛ 'admin' → آیکون مسدودسازی در فرانت disable */
  role: string
}

export interface AdminUsersData {
  users: AdminUserRow[]
  total: number
}

// phase-0: تایپ‌های کمکی چارت — ساختار عوض نشده
// stage-15: معنای بازه‌ها عوض شد (سازندهٔ API):
//   daily  = امروز در ۶ ستونِ ۴ساعته | weekly = هفتهٔ جاری شنبه→جمعه
//   monthly = روزهای ماه شمسیِ جاری | yearly = ۱۲ ماه سال شمسیِ جاری
export interface ChartPoint {
  label: string
  value: number
}

export interface RangeCharts {
  daily: ChartPoint[]
  weekly: ChartPoint[]
  monthly: ChartPoint[]
  yearly: ChartPoint[]
}

export interface AdminUserDetailsDto {
  id: UserId
  phone: string
  referralCode: string | null
  firstName?: string | null
  lastName?: string | null
  name: string | null
  email: string | null
  status: string
  device: string
  registeredAt: Date
  walletBalance: number
  totalSpent: number
  referralsCount: number
  referrerId?: UserId | null
  devices: { id: DeviceId; name: string; platform: string | null; lastActiveAt: Date; isCurrent: boolean }[]
  orders: { id: string; date: Date; amount: number; status: string; addressId: AddressId | null }[]
  referrals: { id: UserId; phone: string; registeredAt: Date; totalOrders: number; orderIds?: string[] }[]
  addresses: { id: AddressId; address: string; lat: number; lng: number; orderCount: number }[]
  logs: { id: string; type: string; action: string; timestamp: Date }[]
  chartData: RangeCharts
}

// ═══════════ ادمین: نشست‌ها / ادمین‌های۲ / پیک‌ها / زنده ═══════════

export interface AdminSessionDto {
  loginAt: Date
  logoutAt: Date | null
  wasActive: boolean
}

export interface SubAdminPermissionsDto {
  productsRead: boolean
  productsWrite: boolean
  usersRead: boolean
  usersWrite: boolean
  couriersRead: boolean
  couriersWrite: boolean
  mainCategoriesRead: boolean
  mainCategoriesWrite: boolean
  orderDetailsRead: boolean
  canToggleTemporaryClose: boolean
  canEditPackagingFee: boolean
  /** stage-15 — نام واقعی روی سیم (قبلاً scopeHall/scopeTakeaway بود که API هرگز نمی‌فرستاد) */
  hall: boolean
  takeaway: boolean
  /** stage-48 — مشاهده تاریخچه‌ی نوتیفیکیشن‌ها (پیش‌فرضِ افزودن: true) */
  notificationsRead: boolean
  /** stage-48 — ارسال نوتیفیکیشن عمومی (پیش‌فرضِ افزودن: false) */
  notificationsSend: boolean
  /** stage-48 — موجود/ناموجود کردن محصولات (پیش‌فرضِ افزودن: true) */
  productsAvailability: boolean
}

/** رارد ۴۷ — بدنه‌ی PATCH دسترسی‌ها — به‌روزرسانی جزئی: همه‌ی کلیدها اختیاری.
 *  پاسخ GET همیشه همه‌ی کلیدها را پر می‌فرستد (نسخه‌ی Dto کامل)؛ قبلاً
 *  یک تایپ هم شکلِ درخواست و هم پاسخ بود و مصرف‌کننده مجبور به دفاع ?? false بود. */
export type SubAdminPermissionsPatch = Partial<SubAdminPermissionsDto>

export interface SubAdminRecordDto {
  userId: UserId
  phone: string
  firstName: string | null
  lastName: string | null
  isActive: boolean
  ordersConfirmed: number
  permissions: SubAdminPermissionsDto
  /** فقط در detail پر می‌شود — لیست برای سبکی [] برمی‌گرداند */
  sessions: AdminSessionDto[]
  /** stage-15: ادمینی که هنوز لاگین نکرده → null (کلاینت «—» نشان دهد) */
  lastActivity: Date | null
}

// ═══════════ stage-48 — تاریخچه‌ی ارسال نوتیفیکیشن (پنل ادمین/ادمین۲) ═══════════

export interface NotificationLogDto {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  audience: number
  /** admin | admin2 | system */
  senderRole: string
  senderName: string | null
  createdAt: Date
}

export interface NotificationHistoryData {
  items: NotificationLogDto[]
  total: number
}

export interface CourierOptionDto {
  id: CourierId
  name: string
  phone: string
}

export interface CourierDeliveryDto {
  id: string
  orderId: OrderId
  addressSnapshot: string
  deliveredAt: Date
  amount: number
}

export interface CourierTripDto {
  id: string
  startedAt: Date
  completedAt: Date | null
  deliveries: CourierDeliveryDto[]
}

export interface CourierDetailDto {
  courier: { id: string; name: string; phone: string }
  trips: CourierTripDto[]
  totalDeliveries: number
  totalAmount: number
  chartData: RangeCharts
}

/** رارد ۴۷ — ردیف لیست پیک‌ها (GET /admin/couriers) — createdAt همیشه روی
 *  سیم است؛ کپی محلی فرانت آن را جا انداخته بود. trips زیرمجموعه‌ی سیم است. */
export interface CourierListRowDto {
  id: string
  name: string
  phone: string
  createdAt: Date
  trips: CourierTripDto[]
}

export interface Admin2SessionDto {
  isAdmin2LoggedIn: boolean
  admin: {
    userId: UserId
    firstName: string | null
    lastName: string | null
    permissions: SubAdminPermissionsDto
  } | null
  queueCount?: number
}

export interface LiveOrderDto {
  id: string
  userPhone: string
  userName: string
  amount: number
  date: Date
  status: string
  deliveryType: string
  customerNote: string | null
  noteSeen: boolean
  confirmedBy: UserId | null
  confirmedByName: string | null
  courierId: string | null
  courierName: string | null
  courierPhone: string | null
  courierArrivedAt: Date | null
  courierSecurityEnabled: boolean
  internalNote: string | null
}

/**
 * round-29 — جزئیات کامل سفارش برای صفحه‌ی /admin/orders/$orderId
 * (GET /live/orders/:id). breakdown از LiveOrderDto حذف شد (round-28 آن را از
 * لیست زنده برداشت؛ لیست داغ نیازی به آن ندارد) و به همین DTO جزئیات آمد.
 * items/breakdown همان قرارداد invoiceForStaff است.
 */
export interface LiveOrderDetailDto extends LiveOrderDto {
  address: string | null
  items: { name: string; sizeName: string | null; quantity: number; price: number }[]
  breakdown: OrderBreakdown
}

export interface LiveOrdersDataDto {
  orders: LiveOrderDto[]
  total: number
}

export interface Admin2StatsDto {
  totalOrders: number
  totalAmount: number
  chartData: RangeCharts
  recentOrders: Admin2RecentOrderRowDto[]
}

/** رارد ۴۷ — ردیف سفارش اخیر داشبورد ادمین۲ — فقط پنج فیلد؛ قبلاً به‌اشتباه
 *  LiveOrderDto کامل اعلام می‌شد (تولیدکننده فقط ۴ فیلد می‌فرستاد) و userName
 *  در رابط کاربری خالی رندر می‌شد — تولیدکننده حالا userName هم می‌فرستد. */
export interface Admin2RecentOrderRowDto {
  id: string
  userName: string
  amount: number
  date: Date
  status: string
}

// ═══════════ ادمین: سفارشات (ادغام) ═══════════

/** رارد ۴۷ — از «OrderRow» تغییر نام کرد: ردیف خام دیتابیس هم‌نام بود و
 *  معنای id فرق می‌کرد (اینجا id = displayId قابل‌نمایش، آنجا UUID) — هم‌نامیِ
 *  دو نوع ناهم‌معنا خطر ادغامِ بی‌صدا داشت. */
export interface AdminOrderRowDto {
  id: string
  userPhone: string
  userName: string
  amount: number
  date: Date
  status: string
  customerNote?: string | null
  confirmedByName?: string | null
  courierName?: string | null
}

export interface AdminOrdersData {
  orders: AdminOrderRowDto[]
  total: number
}

// ═══════════ ادمین: فاکتور پرسنلی (فاکتور چاپی — round-12) ═══════════

/** رارد ۴۶ — قرارداد GET /live/orders/:id/invoice — قبلاً فقط در server/admin
 *  فرانت تعریف شده بود و خروجی invoiceForStaff بک‌اند بی‌نام بود؛ حالا منبع واحد */
export interface StaffInvoiceItem {
  name: string
  sizeName: string | null
  quantity: number
  price: number
}

export interface StaffInvoice {
  orderId: string
  date: Date
  status: string
  userName: string | null
  userPhone: string | null
  deliveryType: DeliveryType
  address: string | null
  customerNote: string | null
  courierId: string | null
  courierName: string | null
  courierPhone: string | null
  courierSecurityEnabled: boolean
  /** round-14 — یادداشت ادمین تاییدکننده + پرچم چاپ آن در فاکتور فروش (بیرون‌بر) */
  internalNote: string | null
  internalNotePrint: boolean
  items: StaffInvoiceItem[]
  breakdown: OrderBreakdown
}

// ═══════════ ادمین: آمار داشبورد ═══════════

export interface AdminStatsDto {
  totalUsers: number
  activeUsers: number
  totalRevenue: number
  totalOrders: number
  /** stage-15: چارت‌ها سمت API با buildRangeCharts ساخته می‌شوند */
  chartData: RangeCharts
  recentOrders: { id: string; user: string; amount: number; status: string; date: Date }[]
  latestUsers: { id: UserId; phone: string; name: string; device: string; registeredAt: Date }[]
}

// ═══════════ ادمین: گزارشات (stage-10 — باکس گزارشات داشبورد) ═══════════

/** رارد ۴۶ — قرارداد موتور گزارشات — قبلاً report-query.service بک‌اند و
 *  server/reports فرانت دو نام‌گذاری موازی داشتند؛ حالا منبع واحد.
 *  یک اندپوینت، هفت نوع گزارش — orders/admin2/couriers/coupons/users/user/audit */
export type AdminReportType =
  | 'orders'
  | 'admin2'
  | 'couriers'
  | 'coupons'
  | 'users'
  | 'user'
  | 'audit'

export interface AdminReportQuery {
  type: AdminReportType
  /** ISO میلادی (فرانت شمسی را تبدیل می‌کند) */
  from?: string | null
  to?: string | null
  status?: string | null
  deliveryType?: string | null
  adminUserId?: string | null
  courierId?: string | null
  phone?: string | null
}

/** قرارداد مشترک همه‌ی گزارش‌ها — رشته‌ای و آماده‌ی رندر/چاپ */
export interface AdminReportResult {
  title: string
  subtitle: string
  generatedAt: string
  stats: { label: string; value: string }[]
  tables: { title: string; head: string[]; rows: string[][] }[]
}

// ═══════════ round-18: مانیتورینگ — GET /api/health/metrics (ادمین اصلی) ═══════════
// منبع واحد قرارداد: API سریال می‌کند، وب رندر می‌کند (هم‌الگوی بقیه‌ی Dtoها).

/** فرآیند — لحظه‌ای، از memoryUsage + نمونه‌گیر تاخیر حلقهٔ رویداد */
export interface ProcessMetricsDto {
  rssMB: number
  heapUsedMB: number
  heapTotalMB: number
  externalMB: number
  /** میلین‌ثانیه — تاخیر صف‌شدن setImmediate؛ بالا = حلقهٔ رویداد بلاک است */
  eventLoopLagMs: number
}

/** HTTP — شمارندهٔ سلسله‌مرحله‌ای + صدک‌های تاخیر پاسخ */
export interface HttpMetricsDto {
  totalRequests: number
  /** فقط 5xx */
  totalErrors: number
  requestsLast1m: number
  requestsLast5m: number
  errorsLast1m: number
  errorsLast5m: number
  /** null = هنوز نمونه‌ای ثبت نشده */
  latencyMs: { p50: number; p95: number; max: number } | null
}

/** وابستگی‌ها — همان سه چکِ /health به‌علاوهٔ اندازه‌گیری تاخیر */
export interface DepsMetricsDto {
  database: { ok: boolean; latencyMs: number }
  redis: { ok: boolean; latencyMs: number }
  uploads: {
    ok: boolean
    /** null = پوشه در دسترس نیست */
    files: number | null
    totalMB: number | null
    /** به سقف شمارش رسید — مجموع واقعی کمی بیشتر است */
    capped: boolean
  }
}

export interface SseMetricsDto {
  channels: number
  subscribers: number
}

/** آخرین اجرای یک کار زمان‌بندی‌شده — از JobRunRegistry */
export interface JobRunDto {
  name: string
  kind: 'daily' | 'interval'
  /** روزانه «HH:MM» (تهران) | بازه‌ای «every Ns» */
  schedule: string
  lastStartedAt: string | null
  lastDurationMs: number | null
  lastOk: boolean | null
  lastError: string | null
  runningNow: boolean
  runCount: number
  failureCount: number
}

export interface SystemMetricsDto {
  status: 'ok' | 'degraded'
  env: string
  uptimeSeconds: number
  /** ISO — لحظهٔ تولید اسنپ‌شات */
  generatedAt: string
  process: ProcessMetricsDto
  http: HttpMetricsDto
  deps: DepsMetricsDto
  sse: SseMetricsDto
  /** مرتب بر اساس نام */
  jobs: JobRunDto[]
}

// ═══════════ round-35 — Auto-Translation (مترجم آفلاین NLLB) ═══════════

/** نوع موجودیت قابل‌ترجمه — کلید صف translation_jobs */
export type TranslationEntityType =
  | 'product'
  | 'mainCategory'
  | 'category'
  | 'article'
  | 'articleCategory'
  | 'articleSubCategory'
  | 'gallery'
  | 'terms'
  | 'about'

/** وضعیت کار صف ترجمه */
export type TranslationJobStatus = 'pending' | 'running' | 'done' | 'failed'

/** یک کار صف ترجمه — GET /admin/translate/jobs */
export interface TranslationJobDto {
  id: string
  entityType: TranslationEntityType
  entityId: string
  status: TranslationJobStatus
  attempts: number
  maxAttempts: number
  lastError: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** وضعیت صف + شمار رکوردهای فاقد ترجمه — GET /admin/translate/status */
export interface TranslationStatusDto {
  queue: { pending: number; running: number; done: number; failed: number }
  /** تعداد رکورد هر نوع که «حداقل یک» فیلد عربی‌شان خالی است (کاندیدای bulk) */
  missing: Partial<Record<TranslationEntityType, number>>
  /** مترجم آفلاین در دسترس است؟ (کش سلامت ~۳۰ ثانیه) */
  translatorUp: boolean
  /** نام مدل مترجم — از /health کانتینر */
  translatorModel: string
  /** ISO — آخرین کار تمام‌شده */
  lastFinishedAt: string | null
}

/** پاسخ POST /admin/translate/preview — پیشنهاد ماشینی برای پر کردن فرم (بدون نوشتن DB) */
export interface TranslationPreviewResult {
  translations: string[]
}