// ═══════════════════════════════════════════════════════════════
// round-43 — sinshin-food-delivery — فایل 1 از 14
// مسیر مقصد: packages/shared/src/contracts.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-eight
// ═══════════════════════════════════════════════════════════════

// packages/shared/src/contracts.ts
// قراردادهای API — منبع واحد حقیقت برای هر دو اپ
// همه‌ی ID ها برنددار — mirror دقیق schema بک‌اند
// تغییر API → اینجا آپدیت → هر دو طرف type-error می‌گیرند
//
// ─── phase-0: حذف تعریف‌های تکراری ───
// نکته: اینترفیس‌های هم‌نام در TS «مرج» می‌شوند (نه ارور) و نوع
// فرانکن‌شتاین بی‌صدا می‌سازند. تکراری‌ها حذف و مترادف‌ها alias شدند.

import type {
  AddressId, CampaignId, CategoryId, ConditionId, CourierId, DeviceId,
  MainCategoryId, OrderId, ProductId, SizeId, UserId,
} from './brand'

// ═══════════ Lang ═══════════

/** رارد ۴۶ — زبان محتوا (fa پیش‌فرض؛ ar = لایه‌ی دوزبانه‌ی round-34).
 *  قبلاً در web/i18n و api/domain/shared/lang دو کپی مستقل بود؛ حالا منبع واحد. */
export type Lang = 'fa' | 'ar'

// ═══════════ Auth ═══════════

export interface AuthUser {
  id: UserId
  phone: string
  name: string | null
  role: string
  referralCode: string | null
  createdAt: Date
  lastLoginAt: Date | null
}

/** round-28 — role حذف شد: چکِ قبل از احراز هویت نباید نقش کاربر را فاش کند؛
 *  نقش فقط در پاسخ verify (VerifyOtpResponse.user.role) برمی‌گردد. */
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

// ═══════════ Menu ═══════════

export interface MainCategory {
  id: MainCategoryId
  name: string
  /** round-34 — نام عربی (NULL = fallback فارسی)؛ فقط ادمین پر می‌کند */
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
  /** round-34 — نام عربی (NULL = fallback فارسی) */
  nameAr?: string | null
  slug: string
  hasSizes: boolean
  sizeNames?: string[] | null
  /** round-34 — قالب نام سایزها به عربی (موازی با sizeNames) */
  sizeNamesAr?: string[] | null
}

export interface ProductSize {
  id: SizeId
  name: string
  price: number
  /** round-34 — نام عربی سایز (فقط پاسخ ادمین؛ NULL = fallback فارسی) */
  nameAr?: string | null
}

export interface Product {
  id: ProductId
  name: string
  description: string | null
  originalPrice: number
  finalPrice: number
  discountPercentage: number
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

// ═══════════ Cart ═══════════

export interface CartItemInput {
  productId: ProductId
  sizeId?: SizeId | null
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
}

export interface CartDetails {
  items: CartItemDto[]
  total: number
}

// ═══════════ Address ═══════════

export interface AddressDto {
  id: AddressId
  title: string
  address: string
  lat: number
  lng: number
  createdAt?: string
  updatedAt?: string
}

// ═══════════ Checkout / Order ═══════════

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
  productId: ProductId
  sizeId?: SizeId | null
  quantity: number
}

export interface CheckoutInput {
  items: CheckoutItemInput[]
  deliveryType: DeliveryType
  useWallet: boolean
  addressId?: AddressId | null
  customerNote?: string | null
  couponCode?: string | null
  gatewayId?: string | null
}

/**
 * رارد ۴۳ — عمداً با «نوع» تعریف شده نه «اینترفیس»: پاسخ چک‌اوت در
 * جدول idempotency مانند رکورد JSON ذخیره می‌شود؛ فقط نوعِ شیء‌محور
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

export interface CheckoutPreviewData {
  breakdown: OrderBreakdown
  items: { name: string; sizeName: string | null; unitPrice: number; quantity: number }[]
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

// ═══════════ Wallet ═══════════

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

// ═══════════ Profile ═══════════

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

// ═══════════ Review ═══════════

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface ProductReviewDto {
  id: string
  orderId: OrderId
  productId: ProductId
  productName?: string | null
  firstName?: string | null
  lastName?: string | null
  phone: string
  comment: string
  date: Date
  status: ReviewStatus
}

// ═══════════ Coupons ═══════════

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
  /** round-34 — نام عربی (فقط برای فرم ادمین؛ NULL = fallback فارسی) */
  nameAr?: string | null
  slug: string
}

export interface ArticleCategoryDto {
  id: string
  name: string
  /** round-34 — نام عربی (فقط برای فرم ادمین؛ NULL = fallback فارسی) */
  nameAr?: string | null
  slug: string
  hasSubCategories: boolean
  subCategories?: ArticleSubCategoryDto[]
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
  publishedAt?: string
  categorySlug?: string
  categoryName?: string
  subCategorySlug?: string
  subCategoryName?: string
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

// ═══════════ Settings / Restaurant ═══════════

export interface RestaurantStatusDto {
  isOpen: boolean
  temporarilyClosed: boolean
  temporaryCloseReason: string | null
  /** round-29 — زمان باز شدن مجددِ بسته‌ی موقت ('' = ثبت نشده) — جدا از nextOpenTime ساعتی */
  temporaryReopenTime: string
  nextOpenTime: string
  anyClosed: boolean
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

// ═══════════ Delivery Zones ═══════════

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

// ═══════════ Payments / Checkout API ═══════════

// phase-0: قبلاً کپیِ تکراری از CheckoutInput/Result بودند
export type CheckoutRequest = CheckoutInput
export type CheckoutResponse = CheckoutResult

// ═══════════ Gallery ═══════════

/** رارد ۴۶ — پهنای تصویر در گرید گالری — قبلاً در تایپ‌های محلی فرانت
 *  و دو امضای inline سرور تکرار می‌شد؛ حالا منبع واحد */
export type GallerySpan = 'wide' | 'normal'

export interface GalleryImageDto {
  id: string
  src: string
  alt: string
  /** round-34 — متن جایگزین عربی (NULL = fallback فارسی) */
  altAr?: string | null
  /** پرچم «ترجمه خودکار» — رارد ۳۵ */
  arAuto?: boolean
  span: GallerySpan
  sortOrder: number
  isActive: boolean
}

// ═══════════ Terms ═══════════

export interface TermsSection {
  title: string
  items: string[]
}

export interface TermsContentDto {
  sections: TermsSection[]
  /** round-34 — بندهای عربی (NULL = fallback فارسی)؛ ساختار موازی sections */
  sectionsAr?: TermsSection[] | null
  /** پرچم «ترجمه خودکار» — رارد ۳۵ */
  arAuto?: boolean
  version: number
  updatedAt: string
}

// ═══════════ About ═══════════

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

// ═══════════ Coupons (Admin) ═══════════

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
    startsAt: string
    endsAt: string | null
  }
  conditions: Array<{ id: ConditionId; type: CouponConditionType; params: Record<string, unknown> }>
  /**
   * phase-9: تعداد گیرندگان فعلی — برای عمومی «-» است ولی برای خصوصی
   * شمارش coupon_grants است (خروجی موتور کمپین / اعطای لحظه‌ای).
   */
  recipientsCount: number
}

// ═══════════ Admin: Users (ادغام — نسخه‌ی rich با firstName/lastName) ═══════════

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

// ═══════════ Admin: Sessions / SubAdmins / Couriers / Live ═══════════

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
  canToggleTemporaryClose?: boolean
  canEditPackagingFee?: boolean
  /** stage-15 — نام واقعی روی سیم (قبلاً scopeHall/scopeTakeaway بود که API هرگز نمی‌فرستاد) */
  hall?: boolean
  takeaway?: boolean
}

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
  recentOrders: LiveOrderDto[]
}

// ═══════════ Admin: Orders (ادغام) ═══════════

export interface OrderRow {
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
  orders: OrderRow[]
  total: number
}

// ═══════════ Admin: Staff Invoice (فاکتور چاپی — round-12) ═══════════

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

// ═══════════ Admin: Dashboard Stats ═══════════

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

// ═══════════ Admin: Reports (stage-10 — باکس گزارشات داشبورد) ═══════════

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

/** آخرین اجرای یک job زمان‌بندی‌شده — از JobRunRegistry */
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

/** وضعیت job صف ترجمه */
export type TranslationJobStatus = 'pending' | 'running' | 'done' | 'failed'

/** یک job صف ترجمه — GET /admin/translate/jobs */
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
  /** ISO — آخرین job تمام‌شده */
  lastFinishedAt: string | null
}

/** پاسخ POST /admin/translate/preview — پیشنهاد ماشینی برای پر کردن فرم (بدون نوشتن DB) */
export interface TranslationPreviewResult {
  translations: string[]
}