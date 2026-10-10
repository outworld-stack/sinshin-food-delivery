// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery — فایل 1 از 5
// مسیر مقصد: apps/web/src/routes/products/$productId.tsx
// تغییر: URL سئو با slug (لودر: نظرات با UUID حل‌شده + canonical/hreflang
//        با slug) و تصویر مستقل هر سایز = اسلاید نخست گالری
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-39 — sinshin-food-delivery — فایل 4 از 5
// مسیر مقصد: apps/web/src/routes/products/$productId.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-five
// ═══════════════════════════════════════════════════════════════

// src/routes/products/$productId.tsx

import { useQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChevronRight } from 'reicon-react'
import { Gallery } from '#/components/Gallery'
import { ProductDetailSkeleton } from '#/components/LoadingSkeletons'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { ProductInfo } from '#/components/site/product-detail/ProductInfo'
import { ProductIngredients } from '#/components/site/product-detail/ProductIngredients'
import { ProductMobileBar } from '#/components/site/product-detail/ProductMobileBar'
import { ProductPriceBox } from '#/components/site/product-detail/ProductPriceBox'
import { ProductReviews } from '#/components/site/product-detail/ProductReviews'
import { ProductSizeSelector } from '#/components/site/product-detail/ProductSizeSelector'
import { useProductPage } from '#/hooks/site/useProductPage'
import { useBack } from '#/hooks/useBack'
import { useI18n } from '#/i18n'
import { SEO } from '#/i18n/seo'
import {
        alternateLinks,
        headLang,
        langUrl,
        localizedFor,
        productJsonLd,
        withBrand,
} from '#/lib/seo'
import { absoluteUrl, DEFAULT_OG_IMAGE } from '#/lib/site'
import { productByIdOptions, productReviewsOptions } from '#/utils/queryOptions'

export const Route = createFileRoute('/products/$productId')({
        component: ProductDetailPage,

        loader: async ({ context, params }) => {
                // stage-56 — پارامتر مسیر UUID یا slug سئویی است که سرور هر دو را
                // می‌پذیرد؛ اما نظرات باید با UUID حل‌شدهٔ محصول بیایند چون
                // endpoint نظرات slug نمی‌فهمد → اول محصول، بعد نظرات (دیگر موازی نیست).
                const product = await context.queryClient.query(
                        productByIdOptions(params.productId),
                )
                if (!product) {
                        throw notFound()
                }
                // stage-56 — prefetch نظرات با UUID حل‌شده (کامپوننت همین کش را
                // می‌خواند). خطا = بدون نظر — صفحه نمی‌شکند (fail-soft قبلی).
                await context.queryClient
                        .query(productReviewsOptions(product.id))
                        .catch(() => undefined)
                return product
        },

        pendingComponent: ProductDetailSkeleton,
        errorComponent: RouteError,
        notFoundComponent: RouteNotFound,

        // رارد ۳۸ — سئوی داینامیک دوزبانه: نام/توضیح عربی با پشتیبان فارسی
        // (قرارداد COALESCE رارد ۳۴)، canonical واریانت زبان، هر سه hreflang،
        // و JSON-LD (Product + BreadcrumbList) با کلید بومی 'script:ld+json'
        // مستقیماً در head — اسکیپ \u003c توسط خود روتر انجام می‌شود.
        head: ({ matches, loaderData }) => {
                const lang = headLang(matches)
                if (!loaderData) {
                        return { meta: [{ title: SEO[lang].notFoundProduct.title }] }
                }
                const ogImage = absoluteUrl(loaderData.profileImage) ?? DEFAULT_OG_IMAGE
                const name = localizedFor(lang, loaderData.nameAr, loaderData.name)
                const description = localizedFor(
                        lang,
                        loaderData.descriptionAr,
                        loaderData.description,
                )
                // stage-56 — URL سئو: slug اگر باشد وگرنه UUID (null = بدون slug)
                const productPath = loaderData.slug || loaderData.id
                const canonical = langUrl(`/products/${productPath}`, lang)
                const title = withBrand(name, lang)
                return {
                        meta: [
                                { title },
                                { name: 'description', content: description },
                                { property: 'og:title', content: title },
                                { property: 'og:description', content: description },
                                { property: 'og:type', content: 'product' },
                                { property: 'og:image', content: ogImage },
                                { 'twitter:card': 'summary_large_image' },
                                { 'twitter:image': ogImage },
                                { 'script:ld+json': productJsonLd(loaderData, lang) },
                        ],
                        links: [
                                { rel: 'canonical', href: canonical },
                                ...alternateLinks(`/products/${productPath}`),
                        ],
                }
        },
})

function ProductDetailPage() {
        const product = Route.useLoaderData()
        const back = useBack('/products')
        const page = useProductPage(product)
        const { t } = useI18n()

        const galleryImages = product.galleryImages?.length
                ? product.galleryImages
                : [
                                'from-blue-400 to-purple-500',
                                'from-green-400 to-teal-500',
                                'from-orange-400 to-red-500',
                        ]

        // stage-56 — تصویر مستقل سایزِ انتخاب‌شده (variant): اسلاید نخست گالری؛
        // null = سایز تصویر خود را ندارد → گالری همان تصاویر مشترک محصول
        const leadImage = page.selectedSize?.image ?? null

        const { data: reviews } = useQuery(productReviewsOptions(product.id))

        // رارد ۳۸ — JSON-LD (Product + BreadcrumbList) به head منتقل شد:
        // دوزبانه (بومی‌سازی‌شده) و با اسکیپ بومی روتر — این کامپوننت فقط UI است.

        return (
                <div className="py-10 px-4 max-w-6xl mx-auto pb-32 lg:pb-10">
                        <button
                                type="button"
                                onClick={back}
                                className="flex items-center cursor-pointer gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition mb-8 font-DanaMedium w-fit"
                        >
                                <ChevronRight size={20} />
                                {t['common.back']}
                        </button>

                        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
                                <div className="w-full lg:w-1/2 flex flex-col">
                                        <ProductInfo product={product} />
                                        {page.hasSizes && (
                                                <ProductSizeSelector
                                                        sizes={product.sizes}
                                                        selectedSizeId={page.selectedSizeId}
                                                        onSelect={page.handleSelectSize}
                                                />
                                        )}
                                        <ProductPriceBox
                                                totalPrice={page.totalPrice}
                                                originalTotal={page.originalTotal}
                                                hasDiscount={page.hasDiscount}
                                                quantity={page.quantity}
                                                discountEndsAt={page.discountEndsAt}
                                                onCountdownEnd={page.handleCountdownEnd}
                                                isAvailable={page.isAvailable}
                                                onIncrement={page.handleIncrement}
                                                onDecrement={page.handleDecrement}
                                                onAddToCart={page.handleAddToCart}
                                        />
                                </div>

                                <div className="w-full lg:w-1/2 lg:pt-14">
                                        <Gallery
                                                images={galleryImages}
                                                leadImage={leadImage}
                                        />
                                </div>
                        </div>

                        <ProductIngredients ingredients={product.ingredients || []} />

                        <ProductReviews
                                reviews={(reviews ?? []).map((r) => ({
                                        ...r,
                                        productName: r.productName ?? '',
                                }))}
                        />

                        <ProductMobileBar
                                totalPrice={page.totalPrice}
                                originalTotal={page.originalTotal}
                                hasDiscount={page.hasDiscount}
                                quantity={page.quantity}
                                discountEndsAt={page.discountEndsAt}
                                onCountdownEnd={page.handleCountdownEnd}
                                isAvailable={page.isAvailable}
                                onIncrement={page.handleIncrement}
                                onDecrement={page.handleDecrement}
                                onAddToCart={page.handleAddToCart}
                        />
                </div>
        )
}