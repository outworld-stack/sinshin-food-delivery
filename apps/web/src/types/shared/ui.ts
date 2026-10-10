// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery — فایل 5 از 5
// مسیر مقصد: apps/web/src/types/shared/ui.ts
// تغییر: GalleryProps.leadImage + ProductCardProps (slug + تصویر سایز) —
//        همه اختیاری و افزایشی؛ مصرف‌کننده‌های فعلی دست‌نخورده می‌مانند
// ═══════════════════════════════════════════════════════════════

// src/types/ui.ts

import type { AmountSortDir, UserSortDir } from '#/utils/queryOptions'

export interface PaginationProps {
        currentPage: number
        totalPages: number
        itemsPerPage?: number
        totalItems?: number
        onPageChange: (page: number) => void
        onItemsPerPageChange?: (count: number) => void
        pageSizeOptions?: number[]
}

export interface EmptyStateProps {
        title?: string
        description?: string
}

export interface ProductCardProps {
        product: {
                id: string
                /**
                 * stage-56 — slug سئوپسند محصول (null = URL با UUID). لینک‌های
                 * کارت slug را ترجیح می‌دهند؛ سرور هر دو را می‌پذیرد.
                 */
                slug?: string | null
                name: string
                description: string | null
                originalPrice: number
                finalPrice: number
                discountPercentage: number
                /**
                 * stage-47 — تخفیف زمان‌دار محصول (بدون سایز):
                 * پنجره‌ی ISO (null = بدون محدودیت). discountActive اختیاری است —
                 * اگر نبود، کارت خودش با پنجره محاسبه می‌کند (پیش‌نمایش فرم ادمین).
                 */
                discountStartsAt?: string | null
                discountEndsAt?: string | null
                discountActive?: boolean
                // ⬅ عوض شد: imageGradient → profileImage (قرارداد API)
                profileImage: string | null
                sizesEnabled: boolean
                /** stage-47 — سایزها با تخفیف مستقل (درصد + پنجره + قیمت مؤثر اختیاری) */
                sizes: {
                        id: string
                        name: string
                        price: number
                        /** stage-56 — تصویر مستقل سایز (سازگاری تایپ با پیش‌نمایش فرم؛ کارت چیپ بندانگشتی ندارد) */
                        image?: string | null
                        discountPercentage?: number
                        discountStartsAt?: string | null
                        discountEndsAt?: string | null
                        finalPrice?: number
                        discountActive?: boolean
                }[]
                /**
                 * stage-48 — موجودی فروش (نیامد = موجود؛ پیش‌نمایش فرم هم می‌فرستد).
                 * ناموجود: عکس تار + نوشته‌ی نارنجی + قفل دکمه‌ی سبد.
                 */
                isAvailable?: boolean
                /** stage-48 — حالت‌های مؤثر سفارش (نیامد = هر سه مجاز) */
                courierAllowed?: boolean
                takeawayAllowed?: boolean
                dineInAllowed?: boolean
        }
        /**
         * round-12 — false = حالت پیش‌نمایش (فرم محصول): بدون Link.
         * لینک با id سنتینل باعث preload→422 و کلیک→RouteError می‌شد.
         */
        interactive?: boolean
}

export interface ArticleCardProps {
        article: {
                id: string
                title: string
                excerpt: string
                profileImage: string | null
                author: string
                publishedAt: Date
        }
}

export interface ThemeToggleProps {
        className?: string
}

export interface ScrollerItem {
        id: string
        label: string
        isActive: boolean
        onClick: () => void
}

export interface CategoryScrollerProps {
        items: ScrollerItem[]
}

export interface GalleryProps {
        images: string[]
        /**
         * stage-56 — تصویر مستقل سایزِ انتخاب‌شده (variant): اسلاید نخست گالری؛
         * تغییر آن → slideTo(0). null = بدون تصویر سایز (گالری مشترک محصول).
         */
        leadImage?: string | null
}

export interface FileUploaderProps {
        onUploadComplete: (url: string) => void
        initialImage?: string
        accept?: string
        fileTypeText?: string
}

export interface WordSliderProps {
        words: string[]
        className?: string
}

export interface AdminChartProps {
        chartType: 'bar' | 'pie' | 'line'
        data: { label: string; value: number }[]
}

export interface SkeletonProps {
        className?: string
}

export interface BrandProps {
        textSize?: string
        to?: string
}

export interface FilterProps {
        tempSearch: string
        setTempSearch: (val: string) => void
        tempStatus: string
        setTempStatus: (val: string) => void
        tempSortDate: string
        setTempSortDate: (val: string) => void
        tempSortAmount: string
        setTempSortAmount: (val: string) => void
        applyFilters: () => void
}

export interface StatusConfig {
        text: string
        color: string
}

export interface AdminUserFilterProps {
        tempSearch: string
        setTempSearch: (val: string) => void
        tempDevice: string
        setTempDevice: (val: string) => void
        tempStatus: string
        setTempStatus: (val: string) => void
        tempSortDate: UserSortDir
        setTempSortDate: (val: UserSortDir) => void
        tempSortWallet: AmountSortDir
        setTempSortWallet: (val: AmountSortDir) => void
        tempSortSpent: AmountSortDir
        setTempSortSpent: (val: AmountSortDir) => void
        applyFilters: () => void
}