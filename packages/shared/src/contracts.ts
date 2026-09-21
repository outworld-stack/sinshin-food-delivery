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

export interface CheckPhoneResponse {
  isNewUser: boolean
  needsTerms: boolean
  role: string | null
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

export interface ApiError {
  code: string
  message: string
  details?: unknown
}

// ═══════════ Menu ═══════════

export interface MainCategory {
  id: MainCategoryId
  name: string
  slug: string
  isActive: boolean
  isDefault: boolean
  sortOrder: number
}

export interface Category {
  id: CategoryId
  mainCategoryId: MainCategoryId
  name: string
  slug: string
  hasSizes: boolean
  sizeNames?: string[] | null
}

export interface ProductSize {
  id: SizeId
  name: string
  price: number
}

export interface Product {
  id: ProductId
  name: string
  description: string | null
  originalPrice: number
  finalPrice: number
  discountPercentage: number
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

export interface CheckoutResult {
  orderCompleted: boolean
  orderId: string // displayId — قابل‌نمایش، برند ندارد
  requiresPayment: boolean
  paymentUrl?: string
  breakdown: OrderBreakdown
}

export interface InvoiceData {
  orderId: string // displayId
  items: { name: string; sizeName?: string | null; quantity: number; price: number }[]
  foodTotal: number
  discount: number
  walletDeduction: number
  deliveryFee: number
  packagingFee: number
  totalAmount: number
  amountPaidOnline: number
  deliveryType: DeliveryType
  customerNote?: string | null
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

export interface CouponDto {
  id: CampaignId
  code: string
  title?: string | null
  discountPercentage: number
  maxUses: number
  isPublic: boolean
  isActive: boolean
  usedCount: number
  expiryDate?: string | null
  rules: CouponRule[]
}

// ═══════════ Articles (ادغام دو بخش تکراری — نسخه‌ی کامل) ═══════════

export interface ArticleSubCategoryDto {
  id: string
  name: string
  slug: string
}

export interface ArticleCategoryDto {
  id: string
  name: string
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
}

export interface ArticlesData {
  articles: ArticleDto[]
}

// ═══════════ Settings / Restaurant ═══════════

export interface RestaurantStatusDto {
  isOpen: boolean
  temporarilyClosed: boolean
  temporaryCloseReason: string | null
  nextOpenTime: string
  anyClosed: boolean
}

// ═══════════ Admin2 / Live ═══════════
// TODO(phase-4): Admin2PermissionsDto و SubAdminPermissionsDto عملاً یک چیزند
// (hall/takeaway ↔ scopeHall/scopeTakeaway) — بعد از ممیزی مصرف‌کننده‌ها ادغام شوند.

export interface Admin2PermissionsDto {
  hall: boolean
  takeaway: boolean
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
}

// ═══════════ Payments / Checkout API ═══════════

export interface PaymentInitResult {
  paymentUrl: string
}

// phase-0: قبلاً کپیِ تکراری از CheckoutInput/Result بودند
export type CheckoutRequest = CheckoutInput
export type CheckoutResponse = CheckoutResult

export interface MockPayRequest {
  success: boolean
}

export interface MockPayResponse {
  orderDisplayId: string
  paymentStatus: 'SUCCESS' | 'FAILED'
}

// ═══════════ Gallery ═══════════

export interface GalleryImageDto {
  id: string
  src: string
  alt: string
  span: 'wide' | 'normal'
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
  updatedAt: string
}

// ═══════════ Coupons (Admin) ═══════════

// phase-0: alias — قبلاً کپیِ تکراری از CouponRule بود
export type CouponRuleDto = CouponRule

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
  firstName?: string | null
  lastName?: string | null
  phone: string
  device: string
  status: string
  walletBalance: number
  totalSpent: number
  registeredAt: Date
}

export interface AdminUsersData {
  users: AdminUserRow[]
  total: number
}

// phase-0: تایپ‌های کمکی چارت — ساختار عوض نشده
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
  scopeHall?: boolean
  scopeTakeaway?: boolean
}

export interface SubAdminRecordDto {
  userId: UserId
  phone: string
  firstName: string | null
  lastName: string | null
  isActive: boolean
  ordersConfirmed: number
  permissions: SubAdminPermissionsDto
  sessions: AdminSessionDto[]
  lastActivity: Date
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

// phase-0: alias — قبلاً کپیِ ساختاریِ تکراری از OrderRow بود
export type AdminOrderRow = OrderRow

// ═══════════ Admin: Dashboard Stats ═══════════

export interface AdminStatsDto {
  totalUsers: number
  activeUsers: number
  totalRevenue: number
  totalOrders: number
  chartData: { date: string; sales: number; rawRegs: number; refRegs: number; views: number }[]
  recentOrders: { id: string; user: string; amount: number; status: string; date: Date }[]
  latestUsers: { id: UserId; phone: string; name: string; device: string; registeredAt: Date }[]
}