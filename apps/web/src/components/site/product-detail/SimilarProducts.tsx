// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/product-detail/SimilarProducts.tsx
//
// بلوک «محصولات مشابه» پایین صفحه‌ی محصول — ریلِ افقیِ اسکرول‌خور
// (الگوی گالری مقالات: snap-x + کارت‌های shrink-0) با همان
// ProductCard لیست منو (DRY: تمام رفتار موجودی/تخفیف/سبد مجانی).
//
// عنوان دو حالت دارد (تصمیم سرور در `strict`): لنگرِ موجود →
// «محصولات مشابه» (کارت ناموجود خودش خاکستری می‌ایستد)؛ لنگرِ
// ناموجود → «جایگزین‌های موجود» (سرور فقط موجود را فرستاده).
//
// fail-silent اصولی: لودینگ/خطا/خالی = کل بلوک رندر نمی‌شود —
// توصیه‌گر هرگز صفحه‌ی محصول را نمی‌گیرد.
// ═══════════════════════════════════════════════════════════════

// src/components/site/product-detail/SimilarProducts.tsx
import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { ProductCard } from '#/components/ProductCard'
import { useI18n } from '#/i18n'
import type { Product } from '#/server/products'
import { similarProductsOptions } from '#/utils/queryOptions'

interface SimilarProductsProps {
	/** محصولِ صفحه (لنگرِ توصیه) — فقط id برای کوئری لازم است */
	product: Product
}

export const SimilarProducts = memo(function SimilarProducts({
	product,
}: SimilarProductsProps) {
	const { t } = useI18n()
	const { data } = useQuery(similarProductsOptions(product.id))

	const products = data?.products ?? []
	if (products.length === 0) return null

	return (
		<section
			aria-label={data?.strict ? t['simil.alternatives'] : t['simil.title']}
			className="mt-12"
		>
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-4 pb-4 border-b border-gray-100 dark:border-white/5">
				{data?.strict ? t['simil.alternatives'] : t['simil.title']}
			</h2>
			{/* ریل افقی — موبایل: نیم‌کارت دیده می‌شود تا اسکرول لو برود؛
			    دسکتاپ: ۴ کارت هم‌عرضِ گریدِ منو */}
			<div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory -mx-4 px-4 lg:mx-0 lg:px-0">
				{products.map((p) => (
					<div
						key={p.id}
						className="shrink-0 w-[46%] sm:w-[32%] lg:w-[calc(25%-0.75rem)] snap-start"
					>
						<ProductCard product={p} />
					</div>
				))}
			</div>
		</section>
	)
})
