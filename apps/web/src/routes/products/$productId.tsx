// ═══════════════════════════════════════════════════════════════
// round-39 — sinshin-food-delivery — فایل 4 از 5
// مسیر مقصد: apps/web/src/routes/products/$productId.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-five
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 9 از 18
// مسیر مقصد: web/src/routes/products/$productId.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/routes/products/$productId.tsx

import { asProductId } from '@sinshin/shared'
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
		// ⬅ cast اینجا — مرز URL param → دامنه
		const productId = asProductId(params.productId)
		const [product] = await Promise.all([
			context.queryClient.query(productByIdOptions(productId)),
			context.queryClient
				.query(productReviewsOptions(params.productId))
				.catch(() => undefined),
		])
		if (!product) {
			throw notFound()
		}
		return product
	},

	pendingComponent: ProductDetailSkeleton,
	errorComponent: RouteError,
	notFoundComponent: RouteNotFound,

	// رارد ۳۸ — سئوی داینامیک دوزبانه: نام/توضیح عربی با fallback فارسی
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
		const canonical = langUrl(`/products/${loaderData.id}`, lang)
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
				...alternateLinks(`/products/${loaderData.id}`),
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

	const { data: reviews } = useQuery(productReviewsOptions(product.id))

	// رارد ۳۸ — JSON-LD (Product + BreadcrumbList) به head منتقل شد:
	// دوزبانه (localized) و با اسکیپ بومی روتر — این کامپوننت فقط UI است.

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
						onIncrement={page.handleIncrement}
						onDecrement={page.handleDecrement}
						onAddToCart={page.handleAddToCart}
					/>
				</div>

				<div className="w-full lg:w-1/2 lg:pt-14">
					<Gallery images={galleryImages} />
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
				onIncrement={page.handleIncrement}
				onDecrement={page.handleDecrement}
				onAddToCart={page.handleAddToCart}
			/>
		</div>
	)
}
