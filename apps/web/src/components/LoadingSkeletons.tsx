// src/components/LoadingSkeletons.tsx
import type { SkeletonProps } from '#/types/shared/ui';

// ۱. اسکلتون پایه (Base)
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`animate-pulse bg-gray-200 dark:bg-[#3a151c] rounded-md ${className}`} />
  );
}

// ۲. اسکلتون کارت محصول
export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col bg-white dark:bg-[#2a1015] rounded-2xl overflow-hidden border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <Skeleton className="w-full aspect-4/3 rounded-none" />
      <div className="p-4 flex flex-col flex-1">
        <Skeleton className="h-5 w-3/4 mb-2" />
        <Skeleton className="h-4 w-full mb-1" />
        <Skeleton className="h-4 w-2/3 mb-4" />
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-12 w-12 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// ۳. اسکلتون کارت مقاله
export function ArticleCardSkeleton() {
  return (
    <div className="flex flex-col bg-white dark:bg-[#2a1015] rounded-2xl overflow-hidden border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <Skeleton className="w-full aspect-video rounded-none" />
      <div className="p-5 flex flex-col flex-1">
        <Skeleton className="h-6 w-full mb-2" />
        <Skeleton className="h-6 w-3/4 mb-4" />
        <Skeleton className="h-4 w-full mb-1" />
        <Skeleton className="h-4 w-5/6 mb-4" />
        <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-white/5 mt-auto">
          <div className="flex items-center gap-2">
            <Skeleton className="w-8 h-8 rounded-full" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-2 w-10" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ۴. اسکلتون اختصاصی صفحه لیست مقالات
export function ArticlesPageSkeleton() {
  return (
    <div className="py-6">
      {/* جای دکمه فیلتر موبایل */}
      <div className="md:hidden mb-4">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>

      {/* جای اسکرولر دسته‌بندی‌ها */}
      <div className="flex items-center gap-2 mb-6">
        <Skeleton className="w-10 h-10 rounded-full" />
        <Skeleton className="w-24 h-10 rounded-full" />
        <Skeleton className="w-32 h-10 rounded-full" />
        <Skeleton className="w-20 h-10 rounded-full" />
        <Skeleton className="w-10 h-10 rounded-full" />
      </div>

      <div className="flex flex-col md:flex-row gap-8 mt-8">
        {/* جای سایدبار فیلترها در دسکتاپ */}
        <aside className="hidden md:block w-64 shrink-0">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </aside>

        {/* جای گرید مقالات */}
        <div className="flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
            {Array.from({ length: 6 }).map((_, i) => <ArticleCardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ۵. اسکلتون اختصاصی صفحه جزئیات مقاله
export function ArticleDetailSkeleton() {
  return (
    <div className="py-10 px-4 max-w-3xl mx-auto space-y-6">
      {/* جای دکمه بازگشت */}
      <Skeleton className="h-6 w-24" />

      {/* جای اطلاعات نویسنده */}
      <div className="flex items-center gap-4 mb-6">
        <Skeleton className="w-14 h-14 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {/* جای عنوان مقاله */}
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-10 w-1/2" />

      {/* جای عکس کاور */}
      <Skeleton className="w-full aspect-video rounded-3xl" />

      {/* جای خلاصه مقاله */}
      <Skeleton className="h-24 w-full rounded-xl" />

      {/* جای متن کامل مقاله */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>

      {/* جای گالری ورق‌خورنده */}
      <Skeleton className="h-72 w-full rounded-2xl" />

      {/* جای باکس روندها */}
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}


// ۶. اسکلتون اختصاصی صفحه سبد خرید
export function CartPageSkeleton() {
  return (
    <div className="py-10 px-4 pb-32 lg:pb-10">
      {/* جای دکمه بازگشت و عنوان */}
      <Skeleton className="h-6 w-24 mb-10" />
      <Skeleton className="h-8 w-40 mb-8" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* جای لیست محصولات */}
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 bg-white dark:bg-[#2a1015] p-4 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
              <Skeleton className="w-20 h-20 rounded-xl" />
              <div className="flex-1 space-y-3 py-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <div className="flex gap-2 items-center">
                  <Skeleton className="w-8 h-8 rounded-lg" />
                  <Skeleton className="w-8 h-4" />
                  <Skeleton className="w-8 h-8 rounded-lg" />
                </div>
              </div>
              <div className="space-y-2 self-end">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>

        {/* جای خلاصه فاکتور در دسکتاپ */}
        <div className="lg:col-span-1 hidden lg:block">
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}


// ۷. اسکلتون اختصاصی صفحه تسویه حساب
export function CheckoutPageSkeleton() {
  return (
    <div className="py-10 px-4">
      <Skeleton className="h-6 w-24 mb-8" />
      <Skeleton className="h-8 w-40 mb-8" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* جای بخش‌های سمت راست */}
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>

        {/* جای خلاصه فاکتور */}
        <div className="lg:col-span-1">
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}


// ۸. اسکلتون اختصاصی صفحه لیست محصولات
export function ProductsPageSkeleton() {
  return (
    <div className="py-6 overflow-x-hidden">
      {/* جای اسکرولر دسته‌بندی‌ها */}
      <div className="flex items-center gap-2 mb-6">
        <Skeleton className="w-10 h-10 rounded-full" />
        <Skeleton className="w-24 h-10 rounded-full" />
        <Skeleton className="w-32 h-10 rounded-full" />
        <Skeleton className="w-20 h-10 rounded-full" />
        <Skeleton className="w-10 h-10 rounded-full" />
      </div>
      <div className="flex flex-col md:flex-row gap-8">
        {/* جای سایدبار در دسکتاپ */}
        <aside className="hidden md:block w-64 shrink-0">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </aside>
        {/* جای گرید محصولات */}
        <div className="flex-1">
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ۹. اسکلتون اختصاصی صفحه جزئیات محصول
export function ProductDetailSkeleton() {
  return (
    <div className="py-10 px-4 max-w-6xl mx-auto pb-32 lg:pb-10">
      <Skeleton className="h-6 w-24 mb-8" />
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
        {/* جای اطلاعات محصول */}
        <div className="w-full lg:w-1/2 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
        {/* جای گالری */}
        <div className="w-full lg:w-1/2 lg:pt-14">
          <Skeleton className="w-full aspect-4/5 lg:aspect-4/3 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}


// ۱۰. اسکلتون اختصاصی صفحه آدرس‌های داشبورد
export function DashboardAddressesSkeleton() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex justify-between items-center mb-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-5 rounded-2xl bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] shadow-sm gap-4">
          <div className="flex items-center gap-4">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}


// ۱۱. اسکلتون اختصاصی صفحه اطلاعات کاربری
export function UserInfoSkeleton() {
  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-2 mb-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-6">
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-32 rounded-xl" />
      </div>
      <div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}


// ۱۲. اسکلتون اختصاصی صفحه سفارشات داشبورد
export function DashboardOrdersSkeleton() {
  return (
    <div className="max-w-6xl space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
          <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-4">
            <Skeleton className="h-6 w-40" />
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        </div>
        <div className="lg:col-span-1">
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}


// ۱۳. اسکلتون اختصاصی صفحه جزئیات سفارش
export function OrderDetailSkeleton() {
  return (
    <div className="max-w-6xl space-y-6">
      <Skeleton className="h-6 w-40" />
      {/* جای هدر سفارش */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-2 flex flex-col md:items-end">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* جای لیست اقلام و نقشه */}
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
        {/* جای اطلاعات تحویل و سود */}
        <div className="lg:col-span-1 space-y-6">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}


// ۱۴. اسکلتون اختصاصی صفحه کیف پول
export function WalletSkeleton() {
  return (
    <div className="max-w-6xl space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Skeleton className="h-40 w-full rounded-3xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}


// ۱۵. اسکلتون اختصاصی صفحه لیست مقالات ادمین
export function AdminArticlesPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between mb-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] space-y-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    </div>
  );
}

// ۱۶. اسکلتون اختصاصی صفحه فرم مقاله
export function AdminArticleFormSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/3 mb-8" />
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}


// ۱۷. اسکلتون اختصاصی صفحه لیست محصولات ادمین
export function AdminProductsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between mb-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-10 w-40 rounded-xl" />
      </div>
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
      </div>
    </div>
  );
}

// ۱۸. اسکلتون اختصاصی صفحه فرم محصول
export function AdminProductFormSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] space-y-6">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
      <div className="lg:col-span-1">
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}


// ۱۹. اسکلتون اختصاصی صفحه لیست سفارشات ادمین
export function AdminOrdersPageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48 mb-8" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] space-y-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
      </div>
    </div>
  );
}

// ۲۰. اسکلتون اختصاصی صفحه جزئیات سفارش ادمین
export function AdminOrderDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-40 mb-8" />
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] flex justify-between">
        <div className="space-y-2"><Skeleton className="h-8 w-24" /><Skeleton className="h-4 w-32" /></div>
        <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-28" /></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}


// ۲۱. اسکلتون اختصاصی صفحه لیست کاربران ادمین
export function AdminUsersListSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48 mb-8" />
      <div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] space-y-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
      </div>
    </div>
  );
}

// ۲۲. اسکلتون اختصاصی صفحه ویرایش کاربر ادمین
export function AdminUserEditSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Skeleton className="h-6 w-40 mb-8" />
      <div className="bg-white dark:bg-[#2a1015] p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="flex gap-3 pt-4">
          <Skeleton className="h-12 flex-1 rounded-xl" />
          <Skeleton className="h-12 flex-1 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// ۲۳. اسکلتون اختصاصی صفحه جزئیات کاربر ادمین
export function AdminUserDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-40 mb-8" />
      <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] flex justify-between">
        <div className="space-y-2"><Skeleton className="h-8 w-32" /><Skeleton className="h-4 w-24" /></div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}


// ۲۴. اسکلتون اختصاصی صفحه کوپن‌های ادمین
export function AdminCouponsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between mb-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-10 w-40 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
      </div>
    </div>
  );
}

// ۲۵. اسکلتون اختصاصی داشبورد اصلی ادمین
export function AdminDashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-2xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}

// ۲۶. اسکلتون جزئیات پیک
export function CourierDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-40 mb-6" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
    </div>
  );
}


// ۲۷. اسکلتون اختصاصی پنل سفارشات زنده
export function LiveOrdersSkeleton() {
  return (
    <div className="space-y-6">
      {/* هدر + دکمه‌ها */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
      </div>

      {/* لیست سفارشات — ساختار کارت‌ها */}
      <div className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* آیکون وضعیت */}
                <Skeleton className="w-11 h-11 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <div className="flex gap-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </div>
              {/* دکمه‌های اکشن */}
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ۲۸. اسکلتون هدر سایت (سایت عمومی)
export function HeaderSkeleton() {
  return (
    <header className="w-full bg-white dark:bg-[#1a0a0e] border-b border-gray-200 dark:border-white/10">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex h-20 items-center justify-between">
        {/* برند */}
        <Skeleton className="h-9 w-28 rounded-lg" />
        {/* ناوبری دسکتاپ */}
        <div className="hidden md:flex items-center gap-8">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
        {/* اکشن‌ها */}
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="w-24 h-10 rounded-lg" />
          <Skeleton className="w-24 h-10 rounded-lg" />
        </div>
      </div>
    </header>
  )
}


// ۲۹. اسکلتون کروم داشبورد کاربر — فقط سایدبار/هدر
export function DashboardLayoutSkeleton() {
  return (
    <>
      <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-[#2a1015] border-l border-gray-200 dark:border-[#3a151c] p-6 fixed right-0 top-0 bottom-0">
        <Skeleton className="h-9 w-28 mb-6" />
        <Skeleton className="h-px w-full mb-6" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-xl mt-auto" />
      </aside>
      <header className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-[#2a1015] w-full">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="w-10 h-10 rounded-full" />
      </header>
    </>
  )
}

// ۳۰. اسکلتون لایوت ادمین (هر دو سطح) — سایدبار + محتوا (نه سفید)
export function AdminLayoutSkeleton() {
  return (
    <>
      <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-[#2a1015] border-l border-gray-200 dark:border-[#3a151c] p-6 fixed right-0 top-0 bottom-0">
        <Skeleton className="h-9 w-28 mb-6" />
        <Skeleton className="h-px w-full mb-6" />
        <nav className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </nav>
        <Skeleton className="h-12 w-full rounded-xl mt-auto" />
      </aside>
      <header className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-[#2a1015] w-full">
        <Skeleton className="h-9 w-28" />
        <div className="flex gap-4">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="w-10 h-10 rounded-lg" />
        </div>
      </header>
    </>
  )
}

// ۳۱. اسکلتون صفحه گالری
export function GalleryPageSkeleton() {
  return (
    <section className="py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-2.5 pb-10 lg:pb-16">
          <Skeleton className="h-10 w-56 mx-auto" />
          <Skeleton className="h-6 w-96 mx-auto" />
        </div>
        <div className="grid md:grid-cols-12 gap-8 mb-7 lg:mb-11">
          <Skeleton className="md:col-span-4 h-69.25 md:h-101 rounded-3xl" />
          <Skeleton className="md:col-span-8 h-69.25 md:h-101 rounded-3xl" />
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-69.25 rounded-3xl" />
          ))}
        </div>
      </div>
    </section>
  )
}

// ۳۲. اسکلتون صفحه درباره ما
export function AboutPageSkeleton() {
  return (
    <div className="py-10 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row gap-8 mb-24">
          <Skeleton className="w-full md:w-2/5 h-69.25 md:h-101 rounded-3xl" />
          <div className="flex-1 space-y-4 pt-8">
            <Skeleton className="h-12 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
        <div className="py-14">
          <Skeleton className="h-10 w-40 mx-auto mb-12" />
          <Skeleton className="h-69.25 md:h-101 w-full rounded-3xl" />
        </div>
      </div>
    </div>
  )
}

// اسکلتون صفحه نظرات ادمین
export function AdminReviewsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      <Skeleton className="h-12 w-full max-w-md rounded-xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  )
}

// اسکلتون صفحه ادمین‌ها
export function AdminsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-40 rounded-xl" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  )
}

// اسکلتون صفحه پیک‌ها
export function CouriersPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-40 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="h-20 w-full rounded-2xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  )
}