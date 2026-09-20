// src/utils/queryOptions.ts
// فکتوری‌های queryOptions — الگوی رسمی TanStack Query v5
// مزیت: loader سرور و useQuery کلاینت از همین تعریف استفاده می‌کنن؛
// staleTime/کلید/queryFn هیچ‌وقت از هم دیگه جدا نمی‌شن
import { queryOptions, keepPreviousData } from '@tanstack/react-query'
import { qk } from './queryKeys'
import {
  getActiveMainCategories,
  getProductById,
  getProductsByMain,
  getCategoriesByMain,
  getCategories,
  getAdminMainCategories,
  getAdminProductDetails,
  getAdminProducts,
  getCartDetails,
  type Category,
  type Product,
} from '#/server/products'
import { getArticleCategories, getArticles, getAdminArticles, getAdminArticleDetails } from '#/server/articles'
import {
  getUserProfile, getApprovedProductReviews, getOrderDetails, getLiveTracking,
  getOrderReviewedProducts, getAdminReviews,
} from '#/server/user'
import { getGalleryImages, getAdminGalleryImages } from '#/server/gallery'
import { getAboutContent } from '#/server/about'
import { getCheckoutPreview, getRestaurantStatus } from '#/server/checkout'
import {
  getAdminStats, getAdmin2Options, getCourierOptions, getSubAdminSession,
  getLiveTrackingEnabled, getRestaurantOpen,
  // ⬅ NEW: لیست‌های ادمین حالا فکتوری دارند (پیش‌نیاز loader + query)
  getAdminUsers, getAdminOrders, getSubAdminOrders, getAdminCouriers,
  getAdminUserDetails, getAdmin2Stats, getLiveOrders, getSubAdmins,
  // ⬅ NEW (بچ ۵): جزئیات نقش‌محور + گزینه‌های پنل زنده
  getSubAdminDetails, getOrderDetailsByRole, getAdminCourierDetailsForRole,
  getCouriersForAssignment,
} from '#/server/admin'
import { getTerms } from '#/server/terms'
import { getAdminCoupons } from '#/server/coupons'
import { getDeliveryZones } from '#/server/deliveryZones'
import type { DeliveryType } from '#/types/site/checkout'
import type { OrderRow } from '#/types/admin/orders'
import type { ProductId, SizeId } from '@sinshin/shared'

// دیتای ترکیبی منو — یک کوئری، دو درخواست موازی
export interface MainData {
  products: Product[]
  categories: Category[]
}

// Mainهای فعال — در Header و MainLayout و /products مشترکه (همون کلید قبلی)
export const activeMainCategoriesOptions = queryOptions({
  queryKey: qk.activeMainCategories,
  queryFn: () => getActiveMainCategories(),
  staleTime: 60_000,
})

// محصولات + دسته‌های یک Main — mainSlug تهی = دیتای خالی (مثل رفتار قبلی)
export const productsByMainOptions = (mainSlug: string | null) =>
  queryOptions({
    queryKey: qk.productsByMain(mainSlug),
    queryFn: async (): Promise<MainData> => {
      if (!mainSlug) return { products: [], categories: [] }
      const [products, cats] = await Promise.all([
        getProductsByMain({ data: { mainSlug } }),
        getCategoriesByMain({ data: { mainSlug } }),
      ])
      return { products: products as Product[], categories: cats as Category[] }
    },
  })

// محصول تکی — loader صفحه‌ی جزئیات از همین پرش می‌کنه؛
// نتیجه: برگشت از لیست به جزئیات، آنی از کش (gcTime ۵ دقیقه)
export const productByIdOptions = (productId: ProductId) =>
  queryOptions({
    queryKey: qk.productById(productId),
    queryFn: () => getProductById({ data: { id: productId } }),
  })

// مقاله‌ها
export const articleCategoriesOptions = queryOptions({
  queryKey: qk.articleCategories,
  queryFn: () => getArticleCategories(),
  staleTime: 5 * 60_000,
})

export const articlesOptions = (category: string, subCategory: string) =>
  queryOptions({
    queryKey: qk.articles(category, subCategory),
    queryFn: () => getArticles({ data: { categorySlug: category, subCategorySlug: subCategory } }),
    staleTime: 60_000,
  })

// پروفایل — در ۸ فایل استفاده می‌شه؛ staleTime اینجا متمرکز شد
export const userProfileOptions = queryOptions({
  queryKey: qk.userProfile,
  queryFn: () => getUserProfile(),
  staleTime: 60_000,
});

export const userProfileClientOptions = queryOptions({
  ...userProfileOptions,
  queryFn: async () => {
    // کلاینت-only — اول مطمئن شو توکن هست
    const { ensureSession } = await import('#/lib/auth-session')
    await ensureSession()
    return getUserProfile()
  },
});

// نظرات تأییدشده‌ی یک محصول
export const productReviewsOptions = (productId: string) =>
  queryOptions({
    queryKey: qk.productReviews(productId),
    queryFn: () => getApprovedProductReviews({ data: { productId } }),
    staleTime: 60_000,
  })

// جزئیات سفارش — صفحه‌ی پیگیری سفارش (کلاینت + loader)
export const orderDetailsOptions = (orderId: string) =>
  queryOptions({
    queryKey: qk.orderDetails(orderId),
    queryFn: () => getOrderDetails({ data: { id: orderId } }),
  })

// پرچم ردیابی زنده — از تنظیمات ادمین
export const liveTrackingOptions = (orderId: string) =>
  queryOptions({
    queryKey: qk.liveTracking(orderId),
    queryFn: () => getLiveTracking({ data: { orderId } }),
  })

// محصولاتِ نظرداده‌شده‌ی یک سفارش — جلوگیری از نظر تکراری
export const orderReviewedOptions = (orderId: string) =>
  queryOptions({
    queryKey: qk.orderReviewed(orderId),
    queryFn: () => getOrderReviewedProducts({ data: { orderId } }),
  })

// گالری — به‌ندرت عوض می‌شه
export const galleryImagesOptions = queryOptions({
  queryKey: qk.galleryImages,
  queryFn: () => getGalleryImages(),
  staleTime: 5 * 60_000,
})

// درباره‌ی ما
export const aboutContentOptions = queryOptions({
  queryKey: qk.aboutContent,
  queryFn: () => getAboutContent(),
  staleTime: 5 * 60_000,
})

// وضعیت رستوران — loader چک‌اوت پرش می‌کنه
export const restaurantStatusOptions = queryOptions({
  queryKey: qk.restaurantStatus,
  queryFn: () => getRestaurantStatus(),
  // ۳۰s — باز/بسته بودن نباید کل کش رو شلوغ کنه ولی رفرش هم لازمه
  staleTime: 30_000,
})

// جزئیات چک‌اوت — آیتم‌ها + نوع تحویل + آدرس
// آیتم‌ها مستقیم داخل کلید می‌شینن (hash ساختاری — بدون JSON.stringify)
// placeholderData داخل فکتوری: تعویض آدرس/نوع تحویل بدون فلیک
export const checkoutPreviewOptions = (
  items: ReadonlyArray<{ productId: string; sizeId?: string | null; quantity: number }>,
  deliveryType: DeliveryType,
  addressId: string | null,
  useWallet: boolean,
  couponCode: string | null,
) =>
  queryOptions({
    queryKey: qk.checkoutPreview(items, deliveryType, addressId, useWallet, couponCode),
    queryFn: () => getCheckoutPreview({
      items: items.map(i => ({
        productId: i.productId,
        sizeId: i.sizeId ?? null,
        quantity: i.quantity,
      })),
      deliveryType,
      useWallet,
      addressId,
      couponCode,
    }),
    placeholderData: keepPreviousData,
  })

// ═══════════════ پنل ادمین ═══════════════

// سشن ادمین۲ — سه مصرف‌کننده (usePermissions/AdminLayout/داشبورد) یک کش؛
// تازه‌ترین مصرف‌کننده (Layout با ۱۵s) ملاکه → staleTime ۱۵s
export const admin2SessionOptions = queryOptions({
  queryKey: qk.admin2Session,
  queryFn: () => getSubAdminSession(),
  staleTime: 15_000,
})

// آمار داشبورد ادمین
export const adminStatsOptions = queryOptions({
  queryKey: qk.adminStats,
  queryFn: () => getAdminStats(),
  staleTime: 30_000,
})

// کتگوری‌ها — بین فرم محصول/کوپن و فیلتر لیست‌ها مشترکه
// (قبلاً staleTime نداشت؛ ۶۰s کافیه چون کتگوری ندرتاً عوض می‌شه)
export const adminCategoriesOptions = queryOptions({
  queryKey: qk.categories,
  queryFn: () => getCategories(),
  staleTime: 60_000,
})

// گزینه‌های فیلتر سفارشات — فقط ادمین اصلی (enabled رو مصرف‌کننده تعیین می‌کنه)
export const admin2FilterOptions = queryOptions({
  queryKey: qk.admin2Options,
  queryFn: () => getAdmin2Options(),
  staleTime: 60_000,
})

export const courierFilterOptions = queryOptions({
  queryKey: qk.courierOptions,
  queryFn: () => getCourierOptions(),
  staleTime: 60_000,
})

// نظرات مدیریت — برای مودریشن
export const adminReviewsOptions = queryOptions({
  queryKey: qk.adminReviews,
  queryFn: () => getAdminReviews(),
  staleTime: 30_000,
})

// ⬅ NEW: کوپن‌ها — لیست مدیریت (تعداد کم؛ بدون صفحه‌بندی)
// قبلاً کلید خام ['admin-coupons'] داخل خود صفحه بود؛ حالا loader روت
// هم می‌تواند همین کوئری را query کند (پری‌فچ روی هاور)
export const adminCouponsOptions = queryOptions({
  queryKey: qk.adminCoupons,
  queryFn: () => getAdminCoupons(),
  staleTime: 30_000,
})

// ⬅ NEW: ادمین‌های سطح ۲ — لیست مدیریت
export const subAdminsOptions = queryOptions({
  queryKey: qk.subAdmins,
  queryFn: () => getSubAdmins(),
  staleTime: 30_000,
})

// مقالات — لیست مدیریت (بدون صفحه‌بندی)
export const adminArticlesOptions = queryOptions({
  queryKey: qk.adminArticles,
  queryFn: () => getAdminArticles(),
  staleTime: 30_000,
})

// جزئیات مقاله برای فرم ویرایش — بعد از ذخیره خودش invalidate می‌شه
export const adminArticleDetailsOptions = (articleId: string) =>
  queryOptions({
    queryKey: qk.adminArticleDetails(articleId),
    queryFn: () => getAdminArticleDetails(articleId),
  })

// دسته‌های اصلی — مدیر دسته‌ها + سلکت والد در فرم دسته‌بندی؛
// بعد از هر تغییر، mutation خودش invalidate می‌کنه
export const adminMainCategoriesOptions = queryOptions({
  queryKey: qk.adminMainCategories,
  queryFn: () => getAdminMainCategories(),
  staleTime: 60_000,
})

// جزئیات محصول برای فرم ویرایش — بعد از ذخیره invalidate می‌شه
export const adminProductDetailsOptions = (productId: string) =>
  queryOptions({
    queryKey: qk.adminProductDetails(productId),
    queryFn: () => getAdminProductDetails({ data: { id: productId } }),
  })

// ═══════════════ تنظیمات ═══════════════

// پرچم ردیابی زنده — فقط ادمین اصلی (enabled رو مصرف‌کننده تعیین می‌کنه)
export const settingsTrackingOptions = queryOptions({
  queryKey: qk.settingsTracking,
  queryFn: () => getLiveTrackingEnabled(),
})

// وضعیت باز/بسته — staleTime صفر: تغییر ادمین باید فوری دیده شه
export const settingsRestaurantOptions = queryOptions({
  queryKey: qk.settingsRestaurant,
  queryFn: () => getRestaurantOpen(),
  staleTime: 0,
})

// قوانین — نسخه‌دار؛ مودال ثبت‌نام و ادیتور ادمین یک کش مشترک
// (هر ذخیره = نسخه جدید → خودش invalidate می‌کنه)
export const termsContentOptions = queryOptions({
  queryKey: qk.termsContent,
  queryFn: () => getTerms(),
  staleTime: 5 * 60_000,
})

// ═══════════════ سبد خرید ═══════════════

// جزئیات سبد — قیمت‌های زنده‌ی سرور؛ هر تغییر سبد = کلید تازه (hash ساختاری)
// placeholderData: تغییر quantity بدون فلیک، مجموع قبلی تا رسیدن جواب تازه
export const cartDetailsOptions = (
  items: ReadonlyArray<{ productId: ProductId; sizeId: SizeId | null; quantity: number }>,
) =>
  queryOptions({
    queryKey: qk.cartDetails(items),
    // کپی mutable برای اسکیمای سرور (مثل checkoutDetails)
    queryFn: () => getCartDetails({ data: { items: items.map(i => ({ ...i })) } }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

// ═══════════════════════════════════════════════════════════════
// ⬅ NEW: فکتوری‌های لیست‌های ادمین
// چرا: تا حالا queryFn های این صفحات داخل هوک‌های صفحه بودند؛
// یعنی loader نمی‌توانست همان کوئری را query کند =>
// نه preloading روی هاور، نه اشتراک کش با بقیه مصرف‌کننده‌ها.
// حالا: route loader ← query(فکتوری) ← useQuery(فکتوری)
// ═══════════════════════════════════════════════════════════════

// --- کاربران: فیلترهای اعمال‌شده از URL (validateSearch روت) ---
export interface AdminUsersFilters {
  page: number
  limit: number
  search: string
  device: string
  status: string
  sortDate: string
  sortWallet: string
  sortSpent: string
}

// ردیف کاربر — مشترک بین سرور و optimistic update
export interface AdminUserRow {
  id: string
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

// sorts سرور از فیلدهای کش‌شده مشتق می‌شه — مپینگ یکجا
function usersSorts(f: AdminUsersFilters) {
  const arr: { field: 'registeredAt' | 'walletBalance' | 'totalSpent'; dir: 'asc' | 'desc' }[] = []
  if (f.sortDate !== 'none') arr.push({ field: 'registeredAt', dir: f.sortDate === 'newest' ? 'desc' : 'asc' })
  if (f.sortWallet !== 'none') arr.push({ field: 'walletBalance', dir: f.sortWallet === 'highest' ? 'desc' : 'asc' })
  if (f.sortSpent !== 'none') arr.push({ field: 'totalSpent', dir: f.sortSpent === 'highest' ? 'desc' : 'asc' })
  return arr
}

export const adminUsersOptions = (f: AdminUsersFilters) =>
  queryOptions({
    queryKey: qk.adminUsers(f),
    queryFn: async (): Promise<AdminUsersData> => getAdminUsers({

      page: f.page,
      limit: f.limit,
      search: f.search,
      device: f.device,
      status: f.status,
      sorts: usersSorts(f),

    }),
    // صفحه‌بندی/فیلتر نرم — بدون پرش اسکلتون بین صفحات
    placeholderData: keepPreviousData,
  })

// --- سفارشات: نقش‌محور (ادمین اصلی vs ادمین۲) ---
export interface AdminOrdersFilters {
  page: number
  limit: number
  search: string
  status: string
  sortDate: string
  sortAmount: string
  admin2: string
  courier: string
  role: string | null
  admin2Id: string | null
}

export interface AdminOrdersData {
  orders: OrderRow[]
  total: number
}

export const adminOrdersOptions = (f: AdminOrdersFilters) =>
  queryOptions({
    queryKey: qk.adminOrders(f),
    queryFn: async (): Promise<AdminOrdersData> => {
      // ادمین۲ → فقط سفارشات خودش
      if (f.role === 'admin2' && f.admin2Id) {
        return getSubAdminOrders({

          page: f.page, limit: f.limit,
          search: f.search || undefined,
          status: f.status,
          sortDate: f.sortDate || undefined,
          sortAmount: f.sortAmount || undefined,
          adminId: f.admin2Id,

        })
      }
      // ادمین اصلی — با فیلتر ادمین۲/پیک
      return getAdminOrders({

        page: f.page, limit: f.limit,
        search: f.search,
        status: f.status,
        sortDate: f.sortDate,
        sortAmount: f.sortAmount,
        confirmedBy: f.admin2,
        courierId: f.courier,

      })
    },
    placeholderData: keepPreviousData,
  })

// --- پیک‌ها ---
export interface AdminCouriersFilters {
  page: number
  limit: number
  search: string
  dateFrom: string
  dateTo: string
}

export const adminCouriersOptions = (f: AdminCouriersFilters) =>
  queryOptions({
    queryKey: qk.adminCouriers(f),
    queryFn: () => getAdminCouriers({

      page: f.page, limit: f.limit,
      search: f.search || undefined,
      dateFrom: f.dateFrom || undefined,
      dateTo: f.dateTo || undefined,

    }),
    placeholderData: keepPreviousData,
  })

// --- محصولات (پنل) ---
export interface AdminProductsFilters {
  page: number
  limit: number
  search: string
  status: string
  categoryId: string
}

export const adminProductsOptions = (f: AdminProductsFilters) =>
  queryOptions({
    queryKey: qk.adminProducts(f),
    queryFn: () => getAdminProducts({
      data: {
        page: f.page, limit: f.limit,
        search: f.search,
        status: f.status,
        categoryId: f.categoryId,
      }
    }),
    placeholderData: keepPreviousData,
  })

// --- جزئیات کاربر (صفحه $userId) ---
// قبلاً loader مستقیم دیتا برمی‌گردوند و invalidate در میوتیشن‌ها
// به query cacheِ خالی اشاره می‌کرد (رفرش واقعی رخ نمی‌داد).
// حالا loader و صفحه یک کش مشترک دارند → invalidate واقعاً کار می‌کنه.
export const adminUserDetailsOptions = (userId: string) =>
  queryOptions({
    queryKey: qk.adminUserDetails(userId),
    queryFn: () => getAdminUserDetails({ data: { id: userId } }),
  })

// --- آمار ادمین۲ (داشبورد شخصی) — قبلاً کلید خام ['admin2-stats', adminId] بود ---
export const admin2StatsOptions = (adminId: string) =>
  queryOptions({
    queryKey: qk.admin2Stats(adminId),
    queryFn: () => getAdmin2Stats({ data: { adminId } }),
  })

// --- سفارشات لایو (پنل ادمین۲) — polling ---
export const admin2LiveOrdersOptions = (adminId: string) =>
  queryOptions({
    queryKey: qk.admin2LiveOrders(adminId),
    queryFn: () => getLiveOrders({ data: { adminId } }),
  })
// ═══════════════════════════════════════════════════════════════
// ⬅ NEW (بچ ۵): فکتوری‌های باقی‌مانده‌ی پنل — آخرین کلیدهای خام مهاجرت‌شده
// ═══════════════════════════════════════════════════════════════

// --- ناحیه‌های ارسال — تنظیمات (هر دو نقش) ---
// قبلاً کلید خام ['delivery-zones'] در DeliveryZonesManager بود (هم‌hash)
export const deliveryZonesOptions = queryOptions({
  queryKey: qk.deliveryZones,
  queryFn: () => getDeliveryZones(),
  staleTime: 60_000,
})

// --- گالری ادمین — مدیریت محتوای تنظیمات ---
// قبلاً contentKeys.adminGallery در useSiteContentSettings بود (هم‌hash)
export const adminGalleryImagesOptions = queryOptions({
  queryKey: qk.adminGalleryImages,
  queryFn: () => getAdminGalleryImages(),
  staleTime: 5 * 60_000,
})

// --- پیک‌های قابل تخصیص — مودال تایید سفارش زنده ---
// قبلاً کلید خام ['couriers-assignment'] بود (هم‌hash → کش حفظ)
export const couriersAssignmentOptions = queryOptions({
  queryKey: qk.couriersAssignment,
  queryFn: () => getCouriersForAssignment(),
  staleTime: 60_000,
})

// --- جزئیات ادمین سطح ۲ — صفحه‌ی $adminId ---
// قبلاً loader مستقیم دیتا برمی‌گردوند و کامپوننت از useLoaderData می‌خواند؛
// حالا loader و کامپوننت یک کش مشترک دارند => invalidate واقعاً رفرش می‌کنه
export const subAdminDetailsOptions = (adminId: string) =>
  queryOptions({
    queryKey: qk.subAdminDetails(adminId),
    queryFn: () => getSubAdminDetails({ data: { id: adminId } }),
  })

// --- جزئیات سفارش پنل ادمین — نقش‌محور ---
// admin2Id فقط برای ادمین۲: سرور فقط سفارشات خودش را برمی‌گرداند
export const adminOrderDetailsOptions = (orderId: string, admin2Id?: string) =>
  queryOptions({
    queryKey: qk.adminOrderDetails(orderId, admin2Id),
    queryFn: () => getOrderDetailsByRole({ data: { orderId, adminId: admin2Id } }),
  })

// --- جزئیات پیک — نقش‌محور ---
// admin2Id فقط برای ادمین۲: سفرها فیلتر می‌شن به تحویل‌های سفارشات خودش
export const adminCourierDetailsOptions = (courierId: string, admin2Id?: string) =>
  queryOptions({
    queryKey: qk.adminCourierDetails(courierId, admin2Id),
    queryFn: () => getAdminCourierDetailsForRole({ data: { id: courierId, adminId: admin2Id } }),
  })