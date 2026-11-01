// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/cart/CartComplements.tsx
//
// بلوک «مکمل خرید شما» در صفحه‌ی سبد — از مشابه‌های «تا ۳ لنگرِ»
// سبد (useQueries روی همان فکتوریِ صفحه‌ی محصول؛ کش سرور مشترک)
// و ادغام RRF در lib/similar-products (خالص و تست‌شده).
//
// قواعد قفل‌شده: فقط محصولِ «موجود» که خودِ سبد ندارد؛ لنگرِ بیشتر
// از ۳ تا درخواست اضافه نمی‌سازد (سبدِ بزرگ = کاربرِ هدفمند، توصیه
// برایش نویز است). fail-silent: لودینگ/خطا/خالی = بدون بلوک.
// ═══════════════════════════════════════════════════════════════

// src/components/site/cart/CartComplements.tsx
import { useQueries } from '@tanstack/react-query'
import { memo, useMemo } from 'react'
import { ProductCard } from '#/components/ProductCard'
import { useI18n } from '#/i18n'
import { mergeSimilarCandidates } from '#/lib/similar-products'
import { useCartStore } from '#/stores/cartStore'
import { similarProductsOptions } from '#/utils/queryOptions'

/** سقف لنگرها — سبد بزرگ‌تر از این توصیه نمی‌خواهد */
const MAX_ANCHORS = 3
/** تعداد کارتِ بلوک سبد — کمتر از صفحه‌ی محصول (جای سبد تنگ است) */
const CART_BLOCK_LIMIT = 4

export const CartComplements = memo(function CartComplements() {
	const { t } = useI18n()
	const items = useCartStore((s) => s.items)

	// لنگرها = محصول‌های یکتای سبد (سقف‌دار؛ ترتیب افزودن حفظ می‌شود)
	const anchors = useMemo(
		() =>
			[...new Set(items.map((i) => i.productId))].slice(
				0,
				MAX_ANCHORS,
			),
		[items],
	)

	// همان فکتوری صفحه‌ی محصول — کش سرور/کلاینت مشترک بین دو بلوک
	const results = useQueries({
		queries: anchors.map((id) => similarProductsOptions(id)),
	})

	const products = useMemo(() => {
		// حذفِ خودِ اقلام سبد از کاندیدها + فقطِ موجودها (در ادغام)
		const excludeIds = new Set(items.map((i) => i.productId))
		return mergeSimilarCandidates(
			results.map((r) => r.data ?? null),
			{ excludeIds, limit: CART_BLOCK_LIMIT },
		)
	}, [results, items])

	if (products.length === 0) return null

	return (
		<section aria-label={t['simil.cartTitle']} className="mt-10">
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-4 pb-4 border-b border-gray-100 dark:border-white/5">
				{t['simil.cartTitle']}
			</h2>
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
