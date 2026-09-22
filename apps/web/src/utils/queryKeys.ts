// src/utils/queryKeys.ts
// کارخانه‌ی مرکزی کلیدها — منبع واحد حقیقت
// قانون طلایی: هیچ رشته‌ی خام queryKey خارج از این فایل نوشته نشه؛
// invalidation همیشه از همین‌جا تا scope دقیق باشه

export const qk = {
  // --- کاربر ---
  userProfile: ['user-profile'] as const,
  // کار-۶: پروفایل سبک — زیرمجموعه‌ی همین پریفکس تا invalidateهای موجود
  // (آدرس جدید، سفارش، ویرایش پروفایل، ...) به‌طور خودکار این را هم رفرش کنند
  userProfileLight: ['user-profile', 'light'] as const,
  productReviews: (productId: string) => ['product-reviews', productId] as const,
  // پریفکس — بعد از ثبت نظر تازه، نظرات همه‌ی محصولات رفرش می‌شن
  // (بازخورد سفارش به نظرات محصول تبدیل می‌شه)
  productReviewsPrefix: ['product-reviews'] as const,
  orderDetails: (orderId: string) => ['order-details', orderId] as const,
  liveTracking: (orderId: string) => ['live-tracking', orderId] as const,
  // پریفکس — بعد از تغییر تنظیم ردیابی زنده، پرچم همه‌ی سفارش‌ها رفرش می‌شه
  liveTrackingPrefix: ['live-tracking'] as const,
  orderReviewed: (orderId: string) => ['order-reviewed', orderId] as const,

  // --- منو / محصولات ---
  activeMainCategories: ['active-main-categories'] as const,
  productsByMain: (mainSlug: string | null) => ['products-by-main', mainSlug] as const,
  // پریفکس — بعد از تغییر/حذف دسته‌ی اصلی، لیست محصولات همه‌ی تب‌ها رفرش می‌شه
  productsByMainPrefix: ['products-by-main'] as const,
  productById: (productId: string) => ['product-by-id', productId] as const,
  productByIdAll: ['product-by-id'] as const,

  // --- مقالات ---
  articleCategories: ['article-categories'] as const,
  articles: (category: string, subCategory: string) =>
    ['articles', category, subCategory] as const,

  // --- محتوای سایت ---
  aboutContent: ['about-content'] as const,
  galleryImages: ['gallery-images'] as const,
  adminGalleryImages: ['admin-gallery-images'] as const,
  termsContent: ['terms-content'] as const,

  // --- چک‌اوت ---
  // phase-3: preview — قیمت‌گذاری کامل سروری (کوپن/ناحیه/بسته‌بندی/کیف پول)
  checkoutPreview: (
    items: ReadonlyArray<{ productId: string; sizeId?: string | null; quantity: number }>,
    deliveryType: string,
    addressId: string | null,
    useWallet: boolean,
    couponCode: string | null,
  ) => ['checkout-preview', items, deliveryType, addressId, useWallet, couponCode] as const,
  checkoutPreviewPrefix: ['checkout-preview'] as const,
  restaurantStatus: ['restaurant-status'] as const,

  // --- ادمین۲ (لایو) ---
  admin2Session: ['admin2-session'] as const,
  // پریفکس بدون adminId — برای invalidate از بیرون پنل (مثلاً چک‌اوت بعد از ثبت سفارش)
  // چون adminId تو کلاینت چک‌اوت در دسترس نیست — پیشوند همه‌ی adminIdها رو می‌گیره
  admin2LiveOrdersPrefix: ['admin2-live-orders'] as const,
  admin2LiveOrders: (adminId: string) => ['admin2-live-orders', adminId] as const,
  admin2Stats: (adminId: string) => ['admin2-stats', adminId] as const,

  // --- سبد خرید ---
  // آیتم‌ها مستقیم داخل کلید می‌شینن (hash ساختاری — بدون JSON.stringify)؛
  // مثل checkoutDetails: ترتیب فیلدها مهم نیست، آبجکت مستقیم hash می‌شه
  cartDetails: (
    items: ReadonlyArray<{ productId: string; sizeId: string | null; quantity: number }>,
  ) => ['cart-details', items] as const,

  // --- پنل ادمین ---
  adminStats: ['admin-stats'] as const,
  subAdmins: ['sub-admins'] as const,
  adminReviews: ['admin-reviews'] as const,
  adminCoupons: ['admin-coupons'] as const,
  // phase-9: جزئیات کوپن — صفحه‌ی اختصاصی
  adminCouponDetails: (id: string) => ['admin-coupon-details', id] as const,
  deliveryZones: ['delivery-zones'] as const,

  // ⬅ NEW: پیک‌های قابل تخصیص — مودال تایید سفارش زنده
  // (نام با کلید خام قبلی ['couriers-assignment'] یکیه → کش موجود حفظ می‌شه)
  couriersAssignment: ['couriers-assignment'] as const,

  // مقالات — لیست مدیریت + جزئیات فرم ویرایش
  adminArticles: ['admin-articles'] as const,
  adminArticleDetails: (articleId: string) => ['admin-article-details', articleId] as const,

  // دسته‌های اصلی — مدیر دسته‌ها + سلکت والد در فرم دسته‌بندی
  adminMainCategories: ['admin-main-categories'] as const,

  // جزئیات محصول برای فرم ویرایش (new/edit)
  adminProductDetails: (productId: string) => ['admin-product-details', productId] as const,

  // --- تنظیمات پنل ---
  // پرچم‌های صفحه‌ی تنظیمات — بعد از ذخیره invalidate می‌شن
  settingsTracking: ['settings-tracking'] as const,
  settingsRestaurant: ['settings-restaurant'] as const,
  // round-13 — وضعیت کامل (بسته موقت + علت) برای کارت بسته/باز موقت
  settingsRestaurantStatus: ['settings-restaurant-status'] as const,

  // phase-fix — پرچم «فقط ایران»
  settingsIranOnly: ['settings-iran-only'] as const,

  // کتگوری‌ها — فرم محصول/کوپن + فیلتر لیست‌ها همه از یک کش
  categories: ['categories'] as const,

  // جزئیات یک کاربر (صفحه‌ی $userId + مودال آدرس‌ها)
  adminUserDetails: (userId: string) => ['admin-user-details', userId] as const,

  // گزینه‌های فیلتر سفارشات — فقط ادمین اصلی
  admin2Options: ['admin2-options'] as const,
  courierOptions: ['courier-options'] as const,

  // ⬅ NEW: جزئیات ادمین سطح ۲ (صفحه‌ی $adminId + ادیتور دسترسی‌ها)
  // ادیتور با پریفکس invalidate می‌کنه تا هر صفحه‌ی بازِ ادمین۲ رفرش شه
  subAdminDetails: (adminId: string) => ['sub-admin-details', adminId] as const,
  subAdminDetailsAll: ['sub-admin-details'] as const,

  // ⬅ NEW: جزئیات سفارش پنل ادمین — نقش‌محور (ادمین۲ فقط سفارش خودش).
  // بعد از تایید/تغییر پیک در پنل زنده، پریفکس همه‌ی جزئیات باز رو رفرش می‌کنه
  adminOrderDetails: (orderId: string, admin2Id?: string) =>
    ['admin-order-details', orderId, admin2Id ?? null] as const,
  adminOrderDetailsAll: ['admin-order-details'] as const,

  // ⬅ NEW: جزئیات پیک — نقش‌محور (ادمین۲ فقط تحویل‌های سفارشات خودشه)
  adminCourierDetails: (courierId: string, admin2Id?: string) =>
    ['admin-courier-details', courierId, admin2Id ?? null] as const,

  // --- لیست‌های صفحه‌بندی‌شده: کلید کامل = پریفکس + فیلترهای اعمال‌شده ---
  // قانون: پوزیشن پارامترها با کلیدهای خام قبلی یکیه → hash یکسان، کش حفظ می‌شه
  adminUsers: (f: {
    page: number; limit: number;
    search: string; device: string; status: string;
    sortDate: string; sortWallet: string; sortSpent: string;
  }) => ['admin-users', f.page, f.limit, f.search, f.device, f.status,
    f.sortDate, f.sortWallet, f.sortSpent] as const,
  // پریفکس — بعد از toggle وضعیت/ویرایش، همه‌ی فیلترها رفرش می‌شن
  adminUsersAll: ['admin-users'] as const,

  // نقش هم داخل کلیده — کش ادمین و ادمین۲ جدا (دیتاشون فرق داره)
  adminOrders: (f: {
    page: number; limit: number;
    search: string; status: string;
    sortDate: string; sortAmount: string;
    admin2: string; courier: string;
    role: string | null; admin2Id: string | null;
  }) => ['admin-orders', f.page, f.limit, f.search, f.status,
    f.sortDate, f.sortAmount, f.admin2, f.courier, f.role, f.admin2Id] as const,
  adminOrdersAll: ['admin-orders'] as const,

  adminCouriers: (f: {
    page: number; limit: number;
    search: string; dateFrom: string; dateTo: string;
  }) => ['admin-couriers', f.page, f.limit, f.search, f.dateFrom, f.dateTo] as const,
  adminCouriersAll: ['admin-couriers'] as const,

  adminProducts: (f: {
    page: number; limit: number;
    search: string; status: string; categoryId: string;
  }) => ['admin-products', f.page, f.limit, f.search, f.status, f.categoryId] as const,
  adminProductsAll: ['admin-products'] as const,

  // stage-10: باکس گزارشات داشبورد — کلیدِ همه‌ی فیلترها؛ همان فیلترها =
  // همان کلید = کش (سیستم کشی گزارشات). staleTime در queryOptions.
  adminReport: (f: {
    type: string; from: string | null; to: string | null;
    status: string; deliveryType: string;
    adminUserId: string | null; courierId: string | null; phone: string | null;
  }) => ['admin-report', f.type, f.from, f.to, f.status, f.deliveryType,
    f.adminUserId, f.courierId, f.phone] as const,
} as const